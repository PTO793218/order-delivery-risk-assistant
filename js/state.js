import { cloneSnapshot } from "./fixtures.js";
import { buildRiskCases, calculateDashboardMetrics, sortRiskCases } from "./rules.js";
import {
  answerTaskFollowUp,
  buildSixSectionMessage,
  interpretTaskInput,
} from "./assistant.js";

const FINAL_ACTIONS = new Set([
  "finalDecision",
  "complete",
  "reopen",
  "markNoAction",
]);

const ERROR_CATALOG = {
  "QUERY-001": {
    code: "QUERY-001",
    message: "请补充订单标识或查询时间范围",
    affected: ["数据查询", "风险规则计算"],
    actions: ["补充条件"],
  },
  "DATA-001": {
    code: "DATA-001",
    message: "未找到符合当前条件的订单",
    affected: ["当前查询结果"],
    actions: ["修改条件", "返回入口"],
  },
  "DATA-002": {
    code: "DATA-002",
    message: "部分数据缺失或存在冲突，当前结论可能不完整",
    affected: ["依赖缺失字段的风险规则"],
    actions: ["查看缺失项", "补充证据"],
  },
  "LINK-001": {
    code: "LINK-001",
    message: "暂未找到可确认的关联包装计划",
    affected: ["包装计划证据", "依赖计划的风险规则"],
    actions: ["核对关联字段", "转人工"],
  },
  "RULE-001": {
    code: "RULE-001",
    message: "风险判断暂时无法完成",
    affected: ["风险结果", "建议等级"],
    actions: ["重试规则", "转人工"],
  },
  "AI-001": {
    code: "AI-001",
    message: "AI解释暂时不可用，风险结果和证据仍可查看",
    affected: ["AI六段式解释"],
    actions: ["重试AI", "继续查看事实"],
  },
  "AI-002": {
    code: "AI-002",
    message: "暂时无法理解该问题，请参考示例重新描述",
    affected: ["当前自然语言追问"],
    actions: ["查看示例", "返回入口", "转人工"],
  },
  "AUTH-001": {
    code: "AUTH-001",
    message: "当前账号无权查看或执行该操作",
    affected: ["受限数据或动作"],
    actions: ["返回", "申请人工协助"],
  },
  "SAVE-001": {
    code: "SAVE-001",
    message: "本次操作未保存，请重试",
    affected: ["本次人工操作"],
    actions: ["重试", "返回详情"],
  },
};

function clone(value) {
  return structuredClone(value);
}

function errorFor(code, message) {
  const error = ERROR_CATALOG[code];
  if (!error) throw new Error(`未知错误编号：${code}`);
  return {
    ...clone(error),
    message: message || error.message,
  };
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function userFor(role) {
  if (role === "生产经理") {
    return {
      name: "陈立",
      role,
      organization: "示例制造中心 · 生产部",
    };
  }
  return {
    name: "林芳",
    role: "计划主管",
    organization: "示例制造中心 · 计划部",
  };
}

function taskId() {
  return `TASK-${Date.now()}`;
}

function emptyConversation() {
  return {
    phase: "idle",
    messages: [],
    identifiedScope: null,
    riskId: null,
  };
}

function assertPermission(user, action, payload = {}) {
  if (user.role === "计划主管") return;
  if (FINAL_ACTIONS.has(action)) {
    throw new Error(`AUTH-001 当前角色“${user.role}”无权执行最终确认`);
  }
  if (action === "assign") {
    const targetRole = String(payload.assignee || "").split("·")[0].trim();
    if (targetRole !== "生产经理") {
      throw new Error("AUTH-001 生产经理不可跨部门指派");
    }
  }
}

function auditSnapshot(risk) {
  return {
    recommendationDecision: risk.recommendationDecision,
    caseStatus: risk.caseStatus,
    assignee: risk.assignee,
    finalRecommendation: risk.finalRecommendation,
  };
}

function appendAudit(risk, user, action, before, detail) {
  const after = auditSnapshot(risk);
  risk.history = [
    ...risk.history,
    {
      time: nowLabel(),
      actor: `${user.role} · ${user.name}`,
      action,
      detail,
      before,
      after,
    },
  ];
  return risk;
}

function replaceSelectedRisk(state, updated) {
  return {
    ...state,
    risks: state.risks.map((risk) => (risk.id === updated.id ? updated : risk)),
    error: null,
  };
}

function transitionSelected(state, action, payload, mutate) {
  const selected = getSelectedRisk(state);
  if (!selected) throw new Error("请先选择风险事项");
  assertPermission(state.user, action, payload);
  if (state.simulatedFailure === "SAVE-001") {
    return {
      ...state,
      error: clone(ERROR_CATALOG["SAVE-001"]),
    };
  }
  const before = auditSnapshot(selected);
  const updated = mutate(clone(selected));
  return replaceSelectedRisk(
    state,
    appendAudit(
      updated,
      state.user,
      payload.auditAction,
      before,
      payload.auditDetail,
    ),
  );
}

export function createInitialState(role = "计划主管") {
  const snapshot = cloneSnapshot();
  const risks = sortRiskCases(buildRiskCases(snapshot));
  return {
    activeView: "welcome",
    selectedRiskId: null,
    contextOpen: false,
    task: null,
    snapshot: {
      mode: snapshot.mode,
      baselineDate: snapshot.baselineDate,
      snapshotVersion: snapshot.snapshotVersion,
      dataTime: snapshot.dataTime,
      organization: snapshot.organization,
    },
    user: userFor(role),
    risks,
    visibleRiskIds: risks.map((risk) => risk.id),
    dashboardMetrics: calculateDashboardMetrics(risks),
    draftInput: {},
    conversation: emptyConversation(),
    chat: [],
    aiRuntime: "available",
    error: null,
    simulatedFailure: null,
  };
}

export function validateTaskInput(input = {}) {
  const contractNo = String(input.contractNo || "").trim();
  const dateFrom = String(input.dateFrom || "").trim();
  const dateTo = String(input.dateTo || "").trim();
  if (!contractNo && !(dateFrom && dateTo)) {
    return {
      ok: false,
      code: "QUERY-001",
      message: "请补充订单标识或查询时间范围",
    };
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return {
      ok: false,
      code: "QUERY-001",
      message: "开始日期不得晚于结束日期",
    };
  }
  return { ok: true };
}

export function getSelectedRisk(state) {
  return state.risks.find((risk) => risk.id === state.selectedRiskId) || null;
}

export function openSnapshotWorkbench(state) {
  return {
    ...state,
    activeView: "workbench",
    selectedRiskId: null,
    contextOpen: false,
    task: null,
    visibleRiskIds: state.risks.map((risk) => risk.id),
    dashboardMetrics: calculateDashboardMetrics(state.risks),
    draftInput: {},
    filter: "全部",
    conversation: emptyConversation(),
    chat: [],
    error: null,
  };
}

export function startTask(state, input) {
  const draftInput = {
    contractNo: String(input.contractNo || "").trim(),
    productCode: String(input.productCode || "").trim(),
    customer: String(input.customer || "").trim(),
    dateFrom: String(input.dateFrom || "").trim(),
    dateTo: String(input.dateTo || "").trim(),
    businessQuestion: String(input.businessQuestion || "").trim(),
  };
  const validation = validateTaskInput(draftInput);
  if (!validation.ok) {
    return {
      ...state,
      activeView: "welcome",
      selectedRiskId: null,
      contextOpen: false,
      task: null,
      draftInput,
      conversation: emptyConversation(),
      error: errorFor(validation.code, validation.message),
    };
  }
  const visibleRisks = state.risks.filter((risk) => {
    const contractMatches =
      !draftInput.contractNo ||
      risk.contractNo.toLowerCase() === draftInput.contractNo.toLowerCase();
    const productMatches =
      !draftInput.productCode ||
      risk.productGroups.some(
        (group) =>
          group.productCode.toLowerCase() ===
          draftInput.productCode.toLowerCase(),
      );
    const customerMatches =
      !draftInput.customer ||
      risk.customer.toLowerCase().includes(draftInput.customer.toLowerCase());
    const dateMatches =
      !(draftInput.dateFrom && draftInput.dateTo) ||
      risk.productGroups.some(
        (group) =>
          group.item.customerDueDate &&
          group.item.customerDueDate >= draftInput.dateFrom &&
          group.item.customerDueDate <= draftInput.dateTo,
      );
    return contractMatches && productMatches && customerMatches && dateMatches;
  });
  if (!visibleRisks.length) {
    return {
      ...state,
      activeView: "welcome",
      selectedRiskId: null,
      contextOpen: false,
      task: null,
      draftInput,
      conversation: emptyConversation(),
      error: errorFor("DATA-001"),
    };
  }
  return {
    ...state,
    activeView: "workbench",
    selectedRiskId: null,
    contextOpen: false,
    task: {
      id: taskId(),
      originalQuestion: draftInput.businessQuestion,
      contractNo: draftInput.contractNo,
      productCode: draftInput.productCode,
      customer: draftInput.customer,
      dateFrom: draftInput.dateFrom,
      dateTo: draftInput.dateTo,
      baselineDate: state.snapshot.baselineDate,
      snapshotVersion: state.snapshot.snapshotVersion,
      organization: state.snapshot.organization,
      role: state.user.role,
    },
    visibleRiskIds: visibleRisks.map((risk) => risk.id),
    dashboardMetrics: calculateDashboardMetrics(visibleRisks),
    draftInput,
    filter: "全部",
    conversation: emptyConversation(),
    chat: [],
    error: null,
  };
}

export function startAssistantTask(state, input = {}) {
  const query = String(input.query || input.businessQuestion || "").trim();
  const scope = interpretTaskInput(query, input);
  const userMessage = {
    role: "user",
    type: "query",
    text: query || "按当前查询范围分析订单交付风险",
  };
  const taskState = startTask(state, scope);

  if (taskState.error?.code === "QUERY-001") {
    return {
      ...taskState,
      activeView: "welcome",
      error: null,
      conversation: {
        phase: "clarifying",
        identifiedScope: scope,
        riskId: null,
        messages: [
          userMessage,
          {
            role: "assistant",
            type: "clarification",
            text: "我还需要销售合同号/订单标识，或完整的开始与结束时间范围，才能查询订单并执行确定性风险规则。",
            examples: [
              "分析合同25DMO00001W-AA为什么有风险",
              "分析2025-02-12至2025-02-19的交付风险",
            ],
          },
        ],
      },
    };
  }

  if (taskState.error) {
    return {
      ...taskState,
      activeView: "welcome",
      conversation: {
        phase: "error",
        identifiedScope: scope,
        riskId: null,
        messages: [
          userMessage,
          {
            role: "assistant",
            type: "error",
            text: taskState.error.message,
            code: taskState.error.code,
          },
        ],
      },
    };
  }

  const scopedRisks = taskState.risks.filter((item) =>
    taskState.visibleRiskIds.includes(item.id),
  );
  const wantsNeedsData = /待补|补充信息|数据不足|缺失/.test(query);
  const risk =
    (wantsNeedsData
      ? scopedRisks.find((item) => item.riskResult === "数据不足")
      : null) || scopedRisks[0];
  const assistantMessage =
    taskState.aiRuntime === "unavailable"
      ? {
          role: "assistant",
          type: "degraded",
          text: "AI解释暂时不可用，但确定性风险结果和结构化证据已经完成，可以继续查看风险看板。",
          code: "AI-001",
        }
      : {
          role: "assistant",
          ...buildSixSectionMessage(risk, taskState.snapshot),
        };

  return {
    ...taskState,
    activeView: "welcome",
    selectedRiskId: null,
    contextOpen: false,
    error: taskState.aiRuntime === "unavailable" ? errorFor("AI-001") : null,
    conversation: {
      phase: taskState.aiRuntime === "unavailable" ? "degraded" : "answered",
      identifiedScope: scope,
      riskId: risk?.id || null,
      messages: [userMessage, assistantMessage],
    },
  };
}

export function continueAssistantTask(state, prompt) {
  const text = String(prompt || "").trim();
  if (!text) return state;
  const risk = state.risks.find(
    (item) => item.id === state.conversation?.riskId,
  );
  if (!risk) {
    return startAssistantTask(state, { query: text });
  }
  const assistantMessage =
    state.aiRuntime === "unavailable"
      ? {
          role: "assistant",
          type: "degraded",
          text: "AI解释仍不可用。规则结果、订单事实和包装计划不受影响，你可以进入看板继续人工核验。",
          code: "AI-001",
        }
      : {
          role: "assistant",
          ...answerTaskFollowUp(text, risk, state.snapshot),
        };
  return {
    ...state,
    activeView: "welcome",
    error: state.aiRuntime === "unavailable" ? errorFor("AI-001") : null,
    conversation: {
      ...state.conversation,
      phase: state.aiRuntime === "unavailable" ? "degraded" : "answered",
      messages: [
        ...state.conversation.messages,
        { role: "user", type: "query", text },
        assistantMessage,
      ],
    },
  };
}

export function openAssistantConversation(state) {
  return {
    ...state,
    activeView: "welcome",
    selectedRiskId: null,
    contextOpen: false,
  };
}

export function setSimulatedFailure(state, code) {
  const error = errorFor(code);
  return {
    ...state,
    simulatedFailure: code,
    aiRuntime: code === "AI-001" || code === "AI-002" ? "unavailable" : state.aiRuntime,
    error,
  };
}

export function retryFailedStep(state) {
  return {
    ...state,
    simulatedFailure: null,
    aiRuntime: "available",
    error: null,
  };
}

export function selectRisk(state, riskId) {
  if (!state.risks.some((risk) => risk.id === riskId)) {
    throw new Error("DATA-001 未找到风险事项");
  }
  return {
    ...state,
    activeView: "detail",
    selectedRiskId: riskId,
    contextOpen: true,
    error: null,
  };
}

export function decideRecommendation(state, payload) {
  const decision = payload.decision;
  if (!["采纳", "修改后采纳", "驳回"].includes(decision)) {
    throw new Error("请选择有效的建议处理结果");
  }
  if (decision === "修改后采纳" && !payload.finalRecommendation?.trim()) {
    throw new Error("修改后采纳必须填写人工最终建议");
  }
  if (decision === "驳回" && payload.outcome === "人工方案") {
    if (!payload.finalRecommendation?.trim() || !payload.assignee?.trim()) {
      throw new Error("驳回后采用人工方案必须填写人工方案和责任人");
    }
    if (!payload.rejectionReason?.trim()) {
      throw new Error("驳回必须填写理由");
    }
  }
  if (decision === "驳回" && payload.outcome === "无需处理") {
    if (!payload.rejectionReason?.trim() || !payload.noActionReason?.trim()) {
      throw new Error("确认无需处理必须填写驳回理由和业务依据");
    }
  }
  if (decision === "驳回" && !["人工方案", "无需处理"].includes(payload.outcome)) {
    throw new Error("驳回后必须选择人工方案或无需处理");
  }

  const action = decision === "驳回" ? "finalDecision" : "finalDecision";
  return transitionSelected(
    state,
    action,
    {
      ...payload,
      auditAction:
        decision === "修改后采纳"
          ? "修改后采纳AI建议"
          : decision === "采纳"
            ? "采纳AI建议"
            : "驳回AI建议",
      auditDetail:
        decision === "驳回"
          ? payload.rejectionReason
          : "建议处理结果已在原型内记录，未写入业务系统",
    },
    (risk) => {
      risk.recommendationDecision = decision;
      if (decision === "采纳") {
        risk.finalRecommendation = risk.aiResult.recommendation;
      }
      if (decision === "修改后采纳") {
        risk.finalRecommendation = payload.finalRecommendation.trim();
      }
      if (decision === "驳回" && payload.outcome === "人工方案") {
        risk.finalRecommendation = payload.finalRecommendation.trim();
        risk.assignee = payload.assignee.trim();
        risk.responsibleRole = risk.assignee.split("·")[0].trim();
        risk.caseStatus = "处理中";
      }
      if (decision === "驳回" && payload.outcome === "无需处理") {
        risk.finalRecommendation = "";
        risk.caseStatus = "无需处理";
      }
      return risk;
    },
  );
}

export function assignRisk(state, payload) {
  const assignee = String(payload.assignee || "").trim();
  const requirement = String(payload.requirement || "").trim();
  if (!assignee || !requirement) {
    throw new Error("指派必须填写责任人和处理要求");
  }
  return transitionSelected(
    state,
    "assign",
    {
      ...payload,
      auditAction: "指派责任人",
      auditDetail: `${assignee}：${requirement}`,
    },
    (risk) => {
      risk.assignee = assignee;
      risk.responsibleRole = assignee.split("·")[0].trim();
      risk.followupRequirement = requirement;
      if (risk.caseStatus === "待确认") risk.caseStatus = "处理中";
      return risk;
    },
  );
}

export function completeRisk(state, payload) {
  if (!payload.note?.trim()) throw new Error("确认完成必须填写处理结果");
  return transitionSelected(
    state,
    "complete",
    {
      ...payload,
      auditAction: "确认处理完成",
      auditDetail: payload.note.trim(),
    },
    (risk) => {
      if (risk.caseStatus !== "处理中") {
        throw new Error("只有处理中的事项可以确认完成");
      }
      risk.caseStatus = "已完成";
      return risk;
    },
  );
}

export function reopenRisk(state, payload) {
  if (!payload.reason?.trim() || !payload.newEvidence?.trim()) {
    throw new Error("重新打开必须填写原因和新证据");
  }
  return transitionSelected(
    state,
    "reopen",
    {
      ...payload,
      auditAction: "重新打开风险事项",
      auditDetail: `${payload.reason.trim()}；新证据：${payload.newEvidence.trim()}`,
    },
    (risk) => {
      if (!["已完成", "无需处理"].includes(risk.caseStatus)) {
        throw new Error("只有已完成或无需处理的事项可以重新打开");
      }
      risk.caseStatus = "待确认";
      risk.newEvidencePendingReview = false;
      return risk;
    },
  );
}

export function switchUserRole(state, role) {
  return {
    ...state,
    user: userFor(role),
    error: null,
  };
}

export function resetDemo(role = "计划主管") {
  return createInitialState(role);
}
