function clean(value) {
  return String(value || "").trim();
}

function firstMatch(text, pattern) {
  return text.match(pattern)?.[1] || "";
}

function readable(value, suffix = "") {
  return value === null || value === undefined || value === ""
    ? "待补"
    : `${value}${suffix}`;
}

export function interpretTaskInput(query, explicitInput = {}) {
  const text = clean(query);
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
  const inferredContract = firstMatch(
    text.toUpperCase(),
    /(?:合同|订单|销售合同)?\s*[:：]?\s*([0-9]{2}[A-Z]{3}[0-9]{5}[A-Z]?-[A-Z0-9-]+)/,
  );
  const inferredProduct = firstMatch(
    text,
    /(?:品名|产品)(?:编码)?\s*[:：]?\s*(\d{4,})/,
  );

  return {
    contractNo: clean(explicitInput.contractNo) || inferredContract,
    productCode: clean(explicitInput.productCode) || inferredProduct,
    customer: clean(explicitInput.customer),
    dateFrom: clean(explicitInput.dateFrom) || dates[0] || "",
    dateTo: clean(explicitInput.dateTo) || dates[1] || "",
    businessQuestion: text,
  };
}

function factItems(risk, snapshot) {
  const group = risk.productGroups[0];
  const item = group.item;
  return [
    `销售合同 ${risk.contractNo}，品名编码 ${group.productCode}（${group.productName}）`,
    `订单数 ${readable(item.orderQty)}，已交数 ${readable(item.deliveredQty)}，未交数 ${readable(group.metrics.undeliveredQty)}`,
    `预定数 ${readable(item.reservedQty)}，待包装缺口 ${readable(group.metrics.packagingGap)}，可交付覆盖率 ${readable(group.metrics.deliverableCoverageRate, "%")}`,
    `客户订单交期 ${readable(item.customerDueDate)}，公司评审交期 ${readable(item.companyReviewDueDate)}`,
    `数据时间 ${risk.orderDataTime}，验证基准日 ${snapshot.baselineDate}`,
  ];
}

export function buildSixSectionMessage(risk, snapshot) {
  if (!risk) throw new Error("DATA-001 未找到可解释的风险事项");
  const group = risk.productGroups[0];
  const gaps = risk.evidence.gaps.map(
    (item) => `${item.field}：${item.impact}`,
  );
  const missingSummary = gaps.length
    ? gaps
    : [
        "规则字段齐全，业务根因待人工核实。",
      ];

  return {
    type: "analysis",
    title: `合同 ${risk.contractNo} 的交付风险分析`,
    generatedAt: risk.aiResult.generatedAt,
    scope: {
      contractNo: risk.contractNo,
      productCodes: risk.productGroups.map((item) => item.productCode),
      customer: risk.customer,
      baselineDate: snapshot.baselineDate,
      snapshotVersion: snapshot.snapshotVersion,
    },
    sections: [
      {
        index: "01",
        title: "风险结论",
        summary: `${risk.aiResult.conclusion} 命中规则 ${risk.ruleHits.join("、") || "待补数据"}。`,
      },
      {
        index: "02",
        title: "事实与证据",
        summary: `来源：销售订单、包装计划、规则 · ${risk.orderDataTime}。`,
        items: factItems(risk, snapshot),
      },
      {
        index: "03",
        title: "原因候选",
        summary: "原因候选，尚未确认根因。",
        items: risk.evidence.candidates,
      },
      {
        index: "04",
        title: "缺失或冲突证据",
        summary: `证据完整度：${risk.evidenceCompleteness}。`,
        items: missingSummary,
      },
      {
        index: "05",
        title: "处理建议",
        summary: risk.aiResult.recommendation,
        items:
          risk.riskResult === "数据不足"
            ? [
                "补齐字段或修复订单与计划关联，再重算受影响规则。",
                "补证前保留事实，不判定无风险。",
                `建议责任角色：${risk.responsibleRole}。`,
              ]
            : [
                `核对 ${readable(group.metrics.packagingGap)} 件缺口对应的有效包装计划。`,
                "计划更新后，重算受影响的数量、日期和完成率规则。",
                `建议责任角色：${risk.responsibleRole}。`,
              ],
      },
      {
        index: "06",
        title: "人工确认事项",
        summary:
          risk.riskResult === "数据不足"
            ? "计划主管确认字段来源、补证责任人及重算时点。"
            : "计划主管确认评审交期、包装调整方案及是否沟通客户。",
        items: [
          "仅记录演示状态，不变更交期、不排产、不写回或外发。",
        ],
      },
    ],
    boundary:
      "风险由规则判定，AI组织证据；正式动作需人工确认。",
  };
}

export function answerTaskFollowUp(prompt, risk, snapshot) {
  if (!risk) throw new Error("DATA-001 未找到当前任务的风险事项");
  const text = clean(prompt);
  const gap = risk.metrics.packagingGap;
  let reply;

  if (/规则|为什么|依据/.test(text)) {
    reply = `合同 ${risk.contractNo} 当前命中 ${risk.ruleHits.join("、")}。其中公司评审交期 ${risk.companyReviewDueDate} 晚于客户订单交期 ${risk.customerDueDate}，且待包装缺口为 ${gap} 件，所以确定性规则返回“${risk.riskResult}”、建议等级“${risk.suggestedLevel}”。`;
  } else if (/缺少|缺失|证据|冲突/.test(text)) {
    const gaps = risk.evidence.gaps.map((item) => item.field).join("、");
    reply = gaps
      ? `合同 ${risk.contractNo} 还缺少或需要核对：${gaps}。已确认的订单、日期和数量事实会继续保留，只暂停依赖缺失字段的判断。`
      : `合同 ${risk.contractNo} 当前适用规则的关键事实和证据完整；但现有证据只能支持原因候选，具体业务根因仍需计划主管结合现场执行情况确认。`;
  } else if (/更新|重算|重新/.test(text)) {
    reply = `包装计划更新后，系统只重算合同 ${risk.contractNo} 下相同品名编码的派工数量、完成数量、计划完成率和受影响的风险规则；已确认事实、人工修改与操作记录不会被清空。`;
  } else if (/建议|怎么处理|责任/.test(text)) {
    reply = `${risk.aiResult.recommendation} 建议责任角色为${risk.responsibleRole}；涉及调整交期、包装计划或客户沟通的动作必须由计划主管确认。`;
  } else {
    reply = `当前任务只围绕合同 ${risk.contractNo}、基准日 ${snapshot.baselineDate} 和授权范围回答。该事项为“${risk.riskResult}”，建议等级“${risk.suggestedLevel}”，待包装缺口 ${gap} 件。你可以继续问规则依据、缺失证据或处理建议。`;
  }

  return {
    type: "followup",
    text: reply,
    boundary: "原因候选不等同最终根因；正式判断和业务动作仍需人工确认。",
  };
}
