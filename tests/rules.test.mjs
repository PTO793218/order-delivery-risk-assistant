import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRiskCases,
  calculateItemMetrics,
  calculateDashboardMetrics,
  evaluateItemRisk,
  sortRiskCases,
} from "../js/rules.js";
import { snapshotFixture } from "../js/fixtures.js";

test("PRD附录B样例由确定性规则得到红色风险", () => {
  const risk = buildRiskCases(snapshotFixture).find(
    (item) => item.contractNo === "25DMO00001W-AA",
  );
  assert.ok(risk);
  assert.equal(risk.metrics.undeliveredQty, 200);
  assert.equal(risk.metrics.packagingGap, 34);
  assert.equal(risk.metrics.deliverableCoverageRate, 83);
  assert.equal(risk.riskResult, "有风险");
  assert.equal(risk.suggestedLevel, "红色");
  assert.ok(risk.ruleHits.includes("RISK-01"));
});

test("包装计划不得跨合同或品名汇总", () => {
  const risk = buildRiskCases(snapshotFixture).find(
    (item) => item.contractNo === "25DMO00001W-AA",
  );
  assert.deepEqual(risk.productGroups[0].planIds, ["DL-250212-001"]);
  assert.equal(risk.metrics.assignedQty, 34);
  assert.equal(risk.metrics.completedQty, 0);
});

test("风险看板指标按合同号去重", () => {
  const metrics = calculateDashboardMetrics(buildRiskCases(snapshotFixture));
  assert.deepEqual(metrics, {
    riskOrderCount: 2,
    dueSoonRiskOrderCount: 1,
    packagingGapOrderCount: 2,
    insufficientDataOrderCount: 1,
  });
});

test("风险事项按照结果、建议等级和交期距离排序", () => {
  const cases = sortRiskCases(buildRiskCases(snapshotFixture));
  assert.deepEqual(
    cases.map((item) => [item.contractNo, item.riskResult, item.suggestedLevel]),
    [
      ["25DMO00001W-AA", "有风险", "红色"],
      ["25DMO00002W-BB", "有风险", "橙色"],
      ["25DMO00003W-CC", "数据不足", "未分级"],
    ],
  );
});

test("单一快照不生成今日新增或持续风险标签", () => {
  for (const risk of buildRiskCases(snapshotFixture)) {
    assert.equal(risk.changeLabel, "当前快照");
  }
});

test("无关联包装计划时不执行依赖计划的风险规则", () => {
  const item = {
    productCode: "TEST",
    orderQty: 100,
    deliveredQty: 0,
    reservedQty: 50,
    customerDueDate: "2025-02-17",
    companyReviewDueDate: "2025-02-16",
    theoreticalProductionDays: 10,
  };
  const metrics = calculateItemMetrics(item, [], "2025-02-12");
  const result = evaluateItemRisk(item, [], metrics, "2025-02-12");
  assert.equal(result.riskResult, "数据不足");
  assert.equal(result.suggestedLevel, "未分级");
  assert.deepEqual(result.ruleHits, []);
  assert.ok(result.missingFields.includes("关联包装计划"));
});

test("多余晚期计划不参与已经覆盖完成的待包装缺口", () => {
  const item = {
    productCode: "TEST",
    orderQty: 100,
    deliveredQty: 0,
    reservedQty: 50,
    customerDueDate: "2025-02-17",
    companyReviewDueDate: "2025-02-16",
    theoreticalProductionDays: 10,
  };
  const plans = [
    {
      id: "EARLY-COVER",
      assignedQty: 50,
      completedQty: 0,
      plannedCompletionDate: "2025-02-16",
    },
    {
      id: "LATE-EXTRA",
      assignedQty: 10,
      completedQty: 0,
      plannedCompletionDate: "2025-02-20",
    },
  ];
  const metrics = calculateItemMetrics(item, plans, "2025-02-12");
  const result = evaluateItemRisk(item, plans, metrics, "2025-02-12");
  assert.ok(result.ruleHits.includes("RISK-06"));
  assert.ok(!result.ruleHits.includes("RISK-04"));
  assert.ok(!result.ruleHits.includes("RISK-05"));
  assert.equal(result.suggestedLevel, "橙色");
});
