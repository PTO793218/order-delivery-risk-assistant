import test from "node:test";
import assert from "node:assert/strict";
import { snapshotFixture } from "../js/fixtures.js";
import { buildRiskCases } from "../js/rules.js";
import {
  answerTaskFollowUp,
  buildSixSectionMessage,
  interpretTaskInput,
} from "../js/assistant.js";

const sampleRisk = buildRiskCases(snapshotFixture).find(
  (risk) => risk.contractNo === "25DMO00001W-AA",
);

test("自然语言识别PRD样例合同与品名", () => {
  const scope = interpretTaskInput(
    "请分析合同25DMO00001W-AA、品名5756为什么有交付风险",
    {},
  );
  assert.equal(scope.contractNo, "25DMO00001W-AA");
  assert.equal(scope.productCode, "5756");
  assert.match(scope.businessQuestion, /为什么有交付风险/);
});

test("显式范围优先且可以识别YYYY-MM-DD时间范围", () => {
  const scope = interpretTaskInput(
    "分析2025-02-12至2025-02-19的风险",
    { contractNo: "25DMO00001W-AA", productCode: "5756" },
  );
  assert.equal(scope.contractNo, "25DMO00001W-AA");
  assert.equal(scope.dateFrom, "2025-02-12");
  assert.equal(scope.dateTo, "2025-02-19");
});

test("PRD样例生成可追溯的六段式AI回复", () => {
  const message = buildSixSectionMessage(sampleRisk, snapshotFixture);
  assert.equal(message.type, "analysis");
  assert.deepEqual(
    message.sections.map((section) => section.title),
    [
      "风险结论",
      "事实与证据",
      "原因候选",
      "缺失或冲突证据",
      "处理建议",
      "人工确认事项",
    ],
  );
  const serialized = JSON.stringify(message);
  for (const expected of ["红色", "200", "166", "34", "RISK-01", "计划主管"]) {
    assert.match(serialized, new RegExp(expected));
  }
  assert.match(serialized, /验证基准日 2025-02-12/);
  assert.doesNotMatch(serialized, /undefined/);
  assert.doesNotMatch(serialized, /建议等级为红色。\s*建议等级为红色/);
});

test("追问回答继承当前合同、规则和证据", () => {
  const ruleReply = answerTaskFollowUp(
    "为什么命中这些规则？",
    sampleRisk,
    snapshotFixture,
  );
  assert.match(ruleReply.text, /25DMO00001W-AA/);
  assert.match(ruleReply.text, /RISK-01/);
  assert.match(ruleReply.text, /34/);

  const evidenceReply = answerTaskFollowUp(
    "还缺哪些证据？",
    sampleRisk,
    snapshotFixture,
  );
  assert.match(evidenceReply.text, /事实|证据|缺失|完整/);
  assert.match(evidenceReply.boundary, /最终根因|人工确认/);
});
