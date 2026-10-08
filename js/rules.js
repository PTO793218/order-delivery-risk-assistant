const REQUIRED_FIELDS = [
  "productCode",
  "orderQty",
  "deliveredQty",
  "reservedQty",
  "customerDueDate",
  "companyReviewDueDate",
  "theoreticalProductionDays",
];

const FIELD_LABELS = {
  productCode: "品名编码",
  orderQty: "订单数",
  deliveredQty: "已交数",
  reservedQty: "预定数",
  customerDueDate: "客户订单交期",
  companyReviewDueDate: "公司评审交期",
  theoreticalProductionDays: "理论生产周期",
  关联包装计划: "关联包装计划",
};

const RESULT_ORDER = new Map([
  ["有风险", 0],
  ["数据不足", 1],
  ["暂无明确风险", 2],
]);

const LEVEL_ORDER = new Map([
  ["红色", 0],
  ["橙色", 1],
  ["黄色", 2],
  ["未分级", 3],
]);

function daysBetween(from, to) {
  if (!from || !to) return null;
  return Math.round(
    (new Date(`${to}T00:00:00`).getTime() -
      new Date(`${from}T00:00:00`).getTime()) /
      86400000,
  );
}

function present(value) {
  return value !== null && value !== undefined && value !== "";
}

function matchingPlans(snapshot, contractNo, productCode) {
  return snapshot.packagingPlans.filter(
    (plan) =>
      plan.contractNo === contractNo && plan.productCode === productCode,
  );
}

function validCoveragePlans(plans) {
  return plans
    .filter(
      (plan) =>
        present(plan.plannedCompletionDate) &&
        present(plan.assignedQty) &&
        present(plan.completedQty),
    )
    .map((plan) => ({
      plan,
      outstandingQty: Math.max(
        Number(plan.assignedQty) - Number(plan.completedQty),
        0,
      ),
    }))
    .filter((item) => item.outstandingQty > 0)
    .sort(
      (a, b) =>
        a.plan.plannedCompletionDate.localeCompare(
          b.plan.plannedCompletionDate,
        ) || String(a.plan.id || "").localeCompare(String(b.plan.id || "")),
    );
}

function plansUsedToCoverGap(plans, packagingGap) {
  if (!present(packagingGap) || packagingGap <= 0) return [];
  let remainingQty = packagingGap;
  const selected = [];
  for (const candidate of validCoveragePlans(plans)) {
    if (remainingQty <= 0) break;
    const coverageQty = Math.min(candidate.outstandingQty, remainingQty);
    selected.push({ ...candidate, coverageQty });
    remainingQty -= coverageQty;
  }
  return selected;
}

export function calculateItemMetrics(orderItem, plans, baselineDate) {
  const hasQuantityInputs = [
    orderItem.orderQty,
    orderItem.deliveredQty,
    orderItem.reservedQty,
  ].every(present);
  const undeliveredQty =
    present(orderItem.orderQty) && present(orderItem.deliveredQty)
      ? Math.max(orderItem.orderQty - orderItem.deliveredQty, 0)
      : null;
  const packagingGap = hasQuantityInputs
    ? Math.max(
        orderItem.orderQty - orderItem.deliveredQty - orderItem.reservedQty,
        0,
      )
    : null;
  const deliverableCoverageRate =
    hasQuantityInputs && orderItem.orderQty > 0
      ? Math.round(
          ((orderItem.deliveredQty + orderItem.reservedQty) /
            orderItem.orderQty) *
            100,
        )
      : null;
  const assignedQty = plans.reduce(
    (sum, plan) => sum + (Number(plan.assignedQty) || 0),
    0,
  );
  const completedQty = plans.reduce(
    (sum, plan) => sum + (Number(plan.completedQty) || 0),
    0,
  );
  const dueCoverageQty = validCoveragePlans(plans)
    .filter(
      ({ plan }) =>
        orderItem.customerDueDate &&
        plan.plannedCompletionDate <= orderItem.customerDueDate,
    )
    .reduce((sum, item) => sum + item.outstandingQty, 0);
  const packagingCoverageGap = present(packagingGap)
    ? Math.max(packagingGap - dueCoverageQty, 0)
    : null;
  return {
    undeliveredQty,
    packagingGap,
    deliverableCoverageRate,
    assignedQty,
    completedQty,
    packagingPlanCompletionRate:
      assignedQty > 0 ? Math.round((completedQty / assignedQty) * 100) : null,
    dueCoverageQty,
    packagingCoverageGap,
    deliveryDateDeviationDays: daysBetween(
      orderItem.customerDueDate,
      orderItem.companyReviewDueDate,
    ),
    daysToCustomerDue: daysBetween(baselineDate, orderItem.customerDueDate),
  };
}

export function evaluateItemRisk(orderItem, plans, metrics, baselineDate) {
  const missingFields = REQUIRED_FIELDS.filter(
    (field) => !present(orderItem[field]),
  );
  const coveragePlans = plansUsedToCoverGap(plans, metrics.packagingGap);
  const needsPlanEvidence = metrics.packagingGap > 0;
  if (needsPlanEvidence && !coveragePlans.length) {
    missingFields.push("关联包装计划");
  }
  const hits = [];
  if (
    metrics.undeliveredQty > 0 &&
    present(orderItem.companyReviewDueDate) &&
    present(orderItem.customerDueDate) &&
    orderItem.companyReviewDueDate > orderItem.customerDueDate
  ) {
    hits.push("RISK-01");
  }
  if (metrics.undeliveredQty > 0 && metrics.daysToCustomerDue < 0) {
    hits.push("RISK-02");
  }
  if (
    coveragePlans.length > 0 &&
    metrics.packagingGap > 0 &&
    present(orderItem.theoreticalProductionDays) &&
    metrics.daysToCustomerDue >= 0 &&
    metrics.daysToCustomerDue <= orderItem.theoreticalProductionDays &&
    metrics.packagingCoverageGap > 0
  ) {
    hits.push("RISK-03");
  }
  if (
    metrics.undeliveredQty > 0 &&
    coveragePlans.some(
      ({ plan }) =>
        plan.plannedCompletionDate &&
        orderItem.customerDueDate &&
        plan.plannedCompletionDate > orderItem.customerDueDate,
    )
  ) {
    hits.push("RISK-04");
  }
  if (
    metrics.undeliveredQty > 0 &&
    present(orderItem.companyReviewDueDate) &&
    (baselineDate > orderItem.companyReviewDueDate ||
      coveragePlans.some(
        ({ plan }) =>
          plan.plannedCompletionDate &&
          plan.plannedCompletionDate > orderItem.companyReviewDueDate,
      ))
  ) {
    hits.push("RISK-05");
  }
  if (
    coveragePlans.length > 0 &&
    metrics.packagingGap > 0 &&
    present(orderItem.theoreticalProductionDays) &&
    metrics.daysToCustomerDue >= 0 &&
    metrics.daysToCustomerDue <= orderItem.theoreticalProductionDays &&
    metrics.packagingCoverageGap === 0 &&
    coveragePlans.every(
      ({ plan }) =>
        !plan.plannedCompletionDate ||
        !orderItem.companyReviewDueDate ||
        plan.plannedCompletionDate <= orderItem.companyReviewDueDate,
    )
  ) {
    hits.push("RISK-06");
  }
  if (
    coveragePlans.length > 0 &&
    metrics.packagingGap > 0 &&
    present(orderItem.theoreticalProductionDays) &&
    metrics.daysToCustomerDue > orderItem.theoreticalProductionDays &&
    metrics.packagingCoverageGap > 0
  ) {
    hits.push("RISK-07");
  }

  const red = hits.some((hit) => ["RISK-01", "RISK-02", "RISK-03", "RISK-04"].includes(hit));
  const orange = hits.some((hit) => ["RISK-05", "RISK-06"].includes(hit));
  const yellow = hits.includes("RISK-07");
  const riskEstablished = hits.length > 0;
  const riskResult = riskEstablished
    ? "有风险"
    : missingFields.length
      ? "数据不足"
      : "暂无明确风险";
  return {
    riskResult,
    suggestedLevel: red
      ? "红色"
      : orange
        ? "橙色"
        : yellow
          ? "黄色"
          : "未分级",
    ruleHits: [...new Set(hits)],
    missingFields,
    evidenceCompleteness:
      riskResult === "数据不足"
        ? "数据不足"
        : missingFields.length
          ? "部分缺失"
          : "完整",
  };
}

function aggregateMetrics(groups) {
  const values = (key) =>
    groups.map((group) => group.metrics[key]).filter((value) => value !== null);
  const sum = (key) => values(key).reduce((total, value) => total + value, 0);
  return {
    undeliveredQty: sum("undeliveredQty"),
    packagingGap: sum("packagingGap"),
    deliverableCoverageRate:
      groups.length === 1 ? groups[0].metrics.deliverableCoverageRate : null,
    assignedQty: sum("assignedQty"),
    completedQty: sum("completedQty"),
    packagingPlanCompletionRate:
      sum("assignedQty") > 0
        ? Math.round((sum("completedQty") / sum("assignedQty")) * 100)
        : null,
    deliveryDateDeviationDays: Math.max(
      ...values("deliveryDateDeviationDays"),
      0,
    ),
    daysToCustomerDue: Math.min(...values("daysToCustomerDue"), 9999),
  };
}

function buildEvidence(order, groups, snapshot) {
  const facts = groups.flatMap((group) => [
    {
      label: `${group.productCode} 订单数量`,
      value: group.item.orderQty,
      source: `销售订单 · ${order.dataTime}`,
    },
    {
      label: `${group.productCode} 待包装缺口`,
      value: group.metrics.packagingGap,
      source: `规则服务 · ${snapshot.dataTime}`,
    },
  ]);
  const gaps = groups.flatMap((group) =>
    group.risk.missingFields.map((field) => ({
      field: FIELD_LABELS[field] || field,
      impact: "依赖该字段的风险规则不执行",
    })),
  );
  return {
    facts,
    candidates: ["评审交期或包装计划安排可能需要业务复核"],
    counterEvidence: ["候选因素尚未被确认为最终业务根因"],
    gaps,
  };
}

function recommendationFor(riskResult, packagingGap) {
  if (riskResult === "数据不足") {
    return "补充缺失字段或修复包装计划关联后重新执行风险判断。";
  }
  return `核对${packagingGap}件待包装数量对应的包装计划，确认计划完工日期后，由计划主管决定是否调整计划或启动客户沟通。`;
}

export function buildRiskCases(snapshot) {
  return snapshot.orders.flatMap((order, orderIndex) => {
    const productGroups = order.items.map((item) => {
      const plans = matchingPlans(snapshot, order.contractNo, item.productCode);
      const metrics = calculateItemMetrics(item, plans, snapshot.baselineDate);
      const risk = evaluateItemRisk(item, plans, metrics, snapshot.baselineDate);
      return {
        productCode: item.productCode,
        productName: item.productName,
        item,
        plans,
        planIds: plans.map((plan) => plan.id),
        metrics,
        risk,
      };
    });
    const resultOrder = productGroups.map((group) => group.risk.riskResult);
    if (!resultOrder.some((result) => result !== "暂无明确风险")) return [];
    const riskResult = resultOrder.includes("有风险")
      ? "有风险"
      : "数据不足";
    const levels = productGroups.map((group) => group.risk.suggestedLevel);
    const suggestedLevel = [...LEVEL_ORDER.keys()].find((level) =>
      levels.includes(level),
    );
    const metrics = aggregateMetrics(productGroups);
    const evidenceCompleteness = riskResult === "数据不足"
      ? "数据不足"
      : productGroups.some((group) => group.risk.evidenceCompleteness !== "完整")
        ? "部分缺失"
        : "完整";
    const recommendation = recommendationFor(
      riskResult,
      metrics.packagingGap,
    );
    const workOrders = snapshot.workOrders.filter(
      (item) => item.contractNo === order.contractNo,
    );
    const workOrderIds = new Set(workOrders.map((item) => item.id));
    return [{
      id: `RC-${snapshot.baselineDate.replaceAll("-", "")}-${String(orderIndex + 1).padStart(3, "0")}`,
      contractNo: order.contractNo,
      customer: order.customer,
      orderStatus: order.orderStatus,
      orderDataTime: order.dataTime,
      productGroups,
      workOrders,
      warnings: snapshot.warnings.filter((item) => workOrderIds.has(item.workOrderId)),
      riskResult,
      suggestedLevel: suggestedLevel || "未分级",
      ruleHits: [...new Set(productGroups.flatMap((group) => group.risk.ruleHits))],
      metrics,
      evidenceCompleteness,
      evidence: buildEvidence(order, productGroups, snapshot),
      customerDueDate: productGroups[0]?.item.customerDueDate || null,
      companyReviewDueDate:
        productGroups[0]?.item.companyReviewDueDate || null,
      caseStatus: riskResult === "有风险" ? "待确认" : "待补信息",
      recommendationDecision: "未确认",
      responsibleRole: riskResult === "数据不足" ? "计划主管" : "计划主管",
      assignee: "",
      aiResult: {
        status: "available",
        conclusion:
          riskResult === "有风险"
            ? `该销售合同存在交付风险，建议等级为${suggestedLevel || "未分级"}。`
            : "现有数据无法确认或排除交付风险。",
        recommendation,
        generatedAt: snapshot.dataTime,
      },
      finalRecommendation: "",
      changeLabel: snapshot.previousSnapshotVersion ? "快照变化" : "当前快照",
      history: [
        {
          time: snapshot.dataTime,
          actor: "确定性规则服务",
          action: "创建风险事项",
          detail: `风险结果：${riskResult}；建议等级：${suggestedLevel || "未分级"}`,
        },
      ],
    }];
  });
}

export function calculateDashboardMetrics(cases) {
  const unique = new Map(cases.map((risk) => [risk.contractNo, risk]));
  const values = [...unique.values()];
  return {
    riskOrderCount: values.filter((risk) => risk.riskResult === "有风险").length,
    dueSoonRiskOrderCount: values.filter(
      (risk) =>
        risk.riskResult === "有风险" &&
        risk.metrics.daysToCustomerDue >= 0 &&
        risk.metrics.daysToCustomerDue <= 7,
    ).length,
    packagingGapOrderCount: values.filter(
      (risk) => risk.metrics.packagingGap > 0,
    ).length,
    insufficientDataOrderCount: values.filter(
      (risk) => risk.riskResult === "数据不足",
    ).length,
  };
}

export function sortRiskCases(cases) {
  return [...cases].sort((a, b) => {
    const resultDelta =
      RESULT_ORDER.get(a.riskResult) - RESULT_ORDER.get(b.riskResult);
    if (resultDelta) return resultDelta;
    if (a.riskResult === "有风险") {
      const levelDelta =
        LEVEL_ORDER.get(a.suggestedLevel) - LEVEL_ORDER.get(b.suggestedLevel);
      if (levelDelta) return levelDelta;
    }
    return a.metrics.daysToCustomerDue - b.metrics.daysToCustomerDue;
  });
}
