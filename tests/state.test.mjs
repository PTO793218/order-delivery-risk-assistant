import test from "node:test";
import assert from "node:assert/strict";
import {
  assignRisk,
  completeRisk,
  createInitialState,
  decideRecommendation,
  getSelectedRisk,
  reopenRisk,
  selectRisk,
  startAssistantTask,
  startTask,
  continueAssistantTask,
  openAssistantConversation,
} from "../js/state.js";

function selectBy(state, predicate) {
  const risk = state.risks.find(predicate);
  assert.ok(risk, "应存在符合条件的风险事项");
  return selectRisk(state, risk.id);
}

test("初始状态使用PRD四套独立语义", () => {
  const state = createInitialState();
  assert.equal(state.activeView, "welcome");
  assert.equal(state.snapshot.mode, "历史数据验证模式");
  for (const risk of state.risks) {
    assert.match(risk.riskResult, /^(有风险|数据不足)$/);
    assert.match(risk.suggestedLevel, /^(红色|橙色|黄色|未分级)$/);
    assert.match(risk.caseStatus, /^(待确认|待补信息)$/);
    assert.equal(risk.recommendationDecision, "未确认");
  }
});

test("修改后采纳保留AI原文且不改变事项状态", () => {
  let state = selectBy(createInitialState(), (risk) => risk.riskResult === "有风险");
  const original = getSelectedRisk(state).aiResult.recommendation;
  state = decideRecommendation(state, {
    decision: "修改后采纳",
    finalRecommendation: "核对34件待包装计划后重新执行风险判断",
  });
  const risk = getSelectedRisk(state);
  assert.equal(risk.caseStatus, "待确认");
  assert.equal(risk.recommendationDecision, "修改后采纳");
  assert.equal(risk.aiResult.recommendation, original);
  assert.match(risk.finalRecommendation, /34件/);
  assert.equal(risk.history.at(-1).action, "修改后采纳AI建议");
});

test("采纳建议不直接改变风险事项状态", () => {
  let state = selectBy(createInitialState(), (risk) => risk.riskResult === "有风险");
  state = decideRecommendation(state, { decision: "采纳" });
  assert.equal(getSelectedRisk(state).recommendationDecision, "采纳");
  assert.equal(getSelectedRisk(state).caseStatus, "待确认");
});

test("待补信息事项指派后仍保持待补信息", () => {
  let state = selectBy(createInitialState(), (risk) => risk.caseStatus === "待补信息");
  state = assignRisk(state, {
    assignee: "生产经理 · 陈立",
    requirement: "补充包装计划关联字段",
  });
  const risk = getSelectedRisk(state);
  assert.equal(risk.caseStatus, "待补信息");
  assert.equal(risk.assignee, "生产经理 · 陈立");
});

test("待确认事项指派后进入处理中", () => {
  let state = selectBy(createInitialState(), (risk) => risk.caseStatus === "待确认");
  state = assignRisk(state, {
    assignee: "计划主管 · 林芳",
    requirement: "核对包装计划并更新处理进度",
  });
  assert.equal(getSelectedRisk(state).caseStatus, "处理中");
});

test("驳回后采用人工方案必须包含方案和责任人", () => {
  let state = selectBy(createInitialState(), (risk) => risk.caseStatus === "待确认");
  assert.throws(
    () => decideRecommendation(state, { decision: "驳回", outcome: "人工方案" }),
    /人工方案和责任人/,
  );
  state = decideRecommendation(state, {
    decision: "驳回",
    outcome: "人工方案",
    rejectionReason: "原建议缺少客户交期核对",
    finalRecommendation: "先核对客户交期，再调整包装计划",
    assignee: "计划主管 · 林芳",
  });
  const risk = getSelectedRisk(state);
  assert.equal(risk.recommendationDecision, "驳回");
  assert.equal(risk.caseStatus, "处理中");
});

test("完成与重新打开需要计划主管明确确认", () => {
  let state = selectBy(createInitialState(), (risk) => risk.caseStatus === "待确认");
  state = assignRisk(state, {
    assignee: "计划主管 · 林芳",
    requirement: "核对包装计划",
  });
  state = completeRisk(state, { note: "包装计划已确认" });
  assert.equal(getSelectedRisk(state).caseStatus, "已完成");
  state = reopenRisk(state, {
    reason: "计划完工日期发生变化",
    newEvidence: "DL-250212-001更新为2025-03-15",
  });
  assert.equal(getSelectedRisk(state).caseStatus, "待确认");
});

test("新任务不继承旧订单上下文", () => {
  let state = selectBy(createInitialState(), (risk) => risk.riskResult === "有风险");
  state = {
    ...state,
    chat: [{ role: "assistant", text: "旧订单结论" }],
  };
  state = startTask(state, { contractNo: "25DMO00001W-AA" });
  assert.equal(state.selectedRiskId, null);
  assert.deepEqual(state.chat, []);
  assert.equal(state.task.contractNo, "25DMO00001W-AA");
});

test("客户交期时间范围真正限制风险事项和看板指标", () => {
  const state = startTask(createInitialState(), {
    dateFrom: "2025-02-12",
    dateTo: "2025-02-19",
  });
  assert.deepEqual(
    state.visibleRiskIds.map(
      (id) => state.risks.find((risk) => risk.id === id).contractNo,
    ),
    ["25DMO00002W-BB"],
  );
  assert.deepEqual(state.dashboardMetrics, {
    riskOrderCount: 1,
    dueSoonRiskOrderCount: 1,
    packagingGapOrderCount: 1,
    insufficientDataOrderCount: 0,
  });
});

test("待补信息查询优先解释数据不足事项", () => {
  const state = startAssistantTask(createInitialState(), {
    query: "分析2025-02-12至2025-03-31有哪些事项需要补充信息",
    dateFrom: "2025-02-12",
    dateTo: "2025-03-31",
  });
  const risk = state.risks.find((item) => item.id === state.conversation.riskId);
  assert.equal(risk.riskResult, "数据不足");
  const answer = state.conversation.messages.at(-1);
  assert.match(answer.sections[0].summary, /数据无法确认|数据不足/);
  const answerText = answer.sections
    .flatMap((section) => [section.summary, ...(section.items || [])])
    .join(" ");
  assert.doesNotMatch(answerText, /null|undefined/);
  assert.doesNotMatch(answerText, /reservedQty|companyReviewDueDate|theoreticalProductionDays/);
  assert.match(answerText, /待补|补充/);
  assert.match(answerText, /预定数|公司评审交期|理论生产周期/);
});

test("欢迎页提交完整任务后保留在会话并生成六段式消息", () => {
  const state = startAssistantTask(createInitialState(), {
    query: "分析合同25DMO00001W-AA为什么有风险",
  });
  assert.equal(state.activeView, "welcome");
  assert.equal(state.error, null);
  assert.equal(state.task.contractNo, "25DMO00001W-AA");
  assert.equal(state.conversation.phase, "answered");
  assert.equal(state.conversation.riskId, state.visibleRiskIds[0]);
  assert.equal(state.conversation.messages[0].role, "user");
  assert.equal(state.conversation.messages.at(-1).sections.length, 6);
});

test("范围不足时只追问且不进入规则计算", () => {
  const state = startAssistantTask(createInitialState(), {
    query: "帮我分析交付风险",
  });
  assert.equal(state.activeView, "welcome");
  assert.equal(state.task, null);
  assert.equal(state.conversation.phase, "clarifying");
  assert.match(state.conversation.messages.at(-1).text, /合同号|时间范围/);
});

test("任务追问继承当前事项且可从详情返回AI会话", () => {
  let state = startAssistantTask(createInitialState(), {
    query: "分析合同25DMO00001W-AA为什么有风险",
  });
  state = continueAssistantTask(state, "为什么命中这些规则？");
  assert.equal(state.conversation.messages.at(-2).role, "user");
  assert.match(state.conversation.messages.at(-1).text, /RISK-01/);
  state = selectRisk(state, state.conversation.riskId);
  state = openAssistantConversation(state);
  assert.equal(state.activeView, "welcome");
  assert.equal(state.conversation.phase, "answered");
});

test("生产经理不能执行最终采纳或跨部门指派", () => {
  let state = selectBy(
    createInitialState("生产经理"),
    (risk) => risk.riskResult === "有风险",
  );
  assert.throws(
    () => decideRecommendation(state, { decision: "采纳" }),
    /AUTH-001/,
  );
  assert.throws(
    () =>
      assignRisk(state, {
        assignee: "计划主管 · 林芳",
        requirement: "跨部门处理",
      }),
    /AUTH-001/,
  );
});
