import test from "node:test";
import assert from "node:assert/strict";
import {
  assignRisk,
  createInitialState,
  getSelectedRisk,
  retryFailedStep,
  selectRisk,
  setSimulatedFailure,
  startTask,
  validateTaskInput,
} from "../js/state.js";

function selectFirst(state) {
  return selectRisk(state, state.risks[0].id);
}

test("空范围不进入规则计算", () => {
  assert.deepEqual(validateTaskInput({}), {
    ok: false,
    code: "QUERY-001",
    message: "请补充订单标识或查询时间范围",
  });
  const state = startTask(createInitialState(), {});
  assert.equal(state.activeView, "welcome");
  assert.equal(state.task, null);
  assert.equal(state.error.code, "QUERY-001");
});

test("时间范围必须完整且开始日期不得晚于结束日期", () => {
  assert.equal(validateTaskInput({ dateFrom: "2025-02-12" }).code, "QUERY-001");
  assert.deepEqual(
    validateTaskInput({ dateFrom: "2025-02-20", dateTo: "2025-02-12" }),
    {
      ok: false,
      code: "QUERY-001",
      message: "开始日期不得晚于结束日期",
    },
  );
});

test("无匹配合同不创建事项并保留输入", () => {
  const state = startTask(createInitialState(), { contractNo: "NOT-FOUND" });
  assert.equal(state.activeView, "welcome");
  assert.equal(state.error.code, "DATA-001");
  assert.equal(state.draftInput.contractNo, "NOT-FOUND");
});

test("单合同任务只展示该合同并重算看板指标", () => {
  const state = startTask(createInitialState(), {
    contractNo: "25DMO00001W-AA",
  });
  assert.deepEqual(state.visibleRiskIds.length, 1);
  assert.equal(state.dashboardMetrics.riskOrderCount, 1);
  assert.equal(state.dashboardMetrics.insufficientDataOrderCount, 0);
});

test("AI失败保留确定性结果和结构化证据", () => {
  const initial = createInitialState();
  const state = setSimulatedFailure(initial, "AI-001");
  assert.equal(state.risks.length, initial.risks.length);
  assert.equal(state.risks[0].riskResult, initial.risks[0].riskResult);
  assert.equal(state.error.code, "AI-001");
  assert.equal(state.aiRuntime, "unavailable");
});

test("保存失败不改变事项且不追加成功记录", () => {
  let state = selectFirst(createInitialState());
  const before = structuredClone(getSelectedRisk(state));
  state = setSimulatedFailure(state, "SAVE-001");
  state = assignRisk(state, {
    assignee: "计划主管 · 林芳",
    requirement: "核对包装计划",
  });
  assert.deepEqual(getSelectedRisk(state), before);
  assert.equal(state.error.code, "SAVE-001");
});

test("重试只清除失败阶段并保留任务和人工记录", () => {
  let state = startTask(createInitialState(), {
    contractNo: "25DMO00001W-AA",
  });
  state = selectRisk(state, state.visibleRiskIds[0]);
  const taskBefore = structuredClone(state.task);
  const risksBefore = structuredClone(state.risks);
  state = setSimulatedFailure(state, "AI-001");
  state = retryFailedStep(state);
  assert.deepEqual(state.task, taskBefore);
  assert.deepEqual(state.risks, risksBefore);
  assert.equal(state.error, null);
  assert.equal(state.aiRuntime, "available");
});
