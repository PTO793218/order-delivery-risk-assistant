function escapeHTML(value = "") {
  if (value === null || value === undefined || value === "") return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function assistantMark(className = "") {
  return `
    <span class="assistant-mark ${className}" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" /><path d="M20 3v4M18 5h4" /></svg>
    </span>
  `;
}

function semanticTag(kind, value) {
  const classMap = {
    riskResult: value === "有风险" ? "risk" : value === "数据不足" ? "data" : "clear",
    suggestedLevel:
      value === "红色" ? "red" : value === "橙色" ? "orange" : value === "黄色" ? "yellow" : "neutral",
    caseStatus:
      value === "处理中"
        ? "processing"
        : value === "待补信息"
          ? "needs-data"
          : value === "已完成"
            ? "complete"
            : value === "无需处理"
              ? "no-action"
              : "pending",
    recommendationDecision:
      value === "未确认" ? "unconfirmed" : value === "驳回" ? "rejected" : "confirmed",
  };
  return `<span class="semantic-tag ${classMap[kind] || "neutral"}" data-semantic="${kind}">${escapeHTML(value)}</span>`;
}

function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${year}.${month}.${day}`;
}

function snapshotRibbon(state, compact = false) {
  return `
    <div class="snapshot-ribbon ${compact ? "compact" : ""}" aria-label="历史数据验证模式与快照信息">
      <span><b>数据时间</b>${escapeHTML(state.snapshot.dataTime)}</span>
    </div>
  `;
}

export function renderErrorState(error) {
  if (!error) return "";
  return `
    <section class="error-banner" data-error-code="${escapeHTML(error.code)}">
      <span class="error-code">${escapeHTML(error.code)}</span>
      <div>
        <strong>${escapeHTML(error.message)}</strong>
        ${error.affected?.length ? `<p>受影响：${error.affected.map(escapeHTML).join("、")}</p>` : ""}
      </div>
      <div class="error-actions">
        ${(error.actions || [])
          .map(
            (action) =>
              `<button class="button small secondary" type="button" data-error-action="${escapeHTML(action)}">${escapeHTML(action)}</button>`,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderRangePanel(state) {
  return `
    <details class="range-panel" open>
      <summary>
        <span class="range-summary-copy"><strong>设置查询范围</strong><small>可选</small></span>
        <span class="range-disclosure" aria-hidden="true">
          <span class="range-open-label">收起设置</span>
          <span class="range-closed-label">展开设置</span>
          <i>⌄</i>
        </span>
      </summary>
      <div class="analysis-grid">
        <label class="field wide">
          <span>合同号 / 订单号</span>
          <input name="contractNo" aria-label="销售合同号或订单标识" placeholder="例如：25DMO00001W-AA" value="${escapeHTML(state.draftInput?.contractNo || "")}" />
        </label>
        <label class="field">
          <span>品名编码</span>
          <input name="productCode" aria-label="品名编码" placeholder="例如：5756" value="${escapeHTML(state.draftInput?.productCode || "")}" />
        </label>
        <label class="field">
          <span>客户</span>
          <input name="customer" aria-label="客户" placeholder="仅查询授权客户" value="${escapeHTML(state.draftInput?.customer || "")}" />
        </label>
        <label class="field">
          <span>开始日期</span>
          <input type="text" inputmode="numeric" name="dateFrom" aria-label="开始日期" placeholder="YYYY-MM-DD" value="${escapeHTML(state.draftInput?.dateFrom || "")}" />
        </label>
        <label class="field">
          <span>结束日期</span>
          <input type="text" inputmode="numeric" name="dateTo" aria-label="结束日期" placeholder="YYYY-MM-DD" value="${escapeHTML(state.draftInput?.dateTo || "")}" />
        </label>
      </div>
    </details>
  `;
}

function renderIdentifiedScope(scope = {}) {
  const chips = [
    scope.contractNo && `合同 ${scope.contractNo}`,
    scope.productCode && `品名 ${scope.productCode}`,
    scope.customer && `客户 ${scope.customer}`,
    scope.dateFrom && scope.dateTo && `${scope.dateFrom} 至 ${scope.dateTo}`,
  ].filter(Boolean);
  if (!chips.length) return "";
  return `<div class="identified-scope"><span>AI已识别范围</span>${chips.map((item) => `<b>${escapeHTML(item)}</b>`).join("")}</div>`;
}

function sectionByTitle(message, title) {
  return (message.sections || []).find((section) => section.title === title) || {
    summary: "",
    items: [],
  };
}

function renderAnswerItems(items = []) {
  if (!items.length) return "";
  return `<ul>${items.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>`;
}

function renderConversationMessage(message, state) {
  if (message.role === "user") {
    return `<article class="conversation-message user"><p>${escapeHTML(message.text)}</p></article>`;
  }
  if (message.type === "analysis") {
    const conclusion = sectionByTitle(message, "风险结论");
    const evidence = sectionByTitle(message, "事实与证据");
    const candidates = sectionByTitle(message, "原因候选");
    const gaps = sectionByTitle(message, "缺失或冲突证据");
    const recommendation = sectionByTitle(message, "处理建议");
    const confirmation = sectionByTitle(message, "人工确认事项");
    return `
      <article class="conversation-message assistant analysis-answer">
        <header>
          ${assistantMark("conversation")}
          <div><h2>${escapeHTML(message.title)}</h2></div>
          <small>${escapeHTML(message.generatedAt)} · 待人工确认</small>
        </header>
        <div class="natural-answer">
          <p class="answer-lead"><strong>我先说结论：</strong>${escapeHTML(conclusion.summary)}</p>
          <section>
            <h3>我为什么这样判断</h3>
            <p>${escapeHTML(evidence.summary)}</p>
            ${renderAnswerItems(evidence.items)}
          </section>
          <section>
            <h3>目前还不能确认</h3>
            <p>${escapeHTML(candidates.summary)}${candidates.items?.length ? ` 核查：${escapeHTML(candidates.items.join("；"))}。` : ""}</p>
            <p>${escapeHTML(gaps.summary)}</p>
            ${renderAnswerItems(gaps.items)}
          </section>
          <section>
            <h3>建议下一步</h3>
            <p>${escapeHTML(recommendation.summary)}</p>
            ${renderAnswerItems(recommendation.items)}
          </section>
          <section class="confirmation-note">
            <h3>需要你确认</h3>
            <p>${escapeHTML(confirmation.summary)}</p>
            ${renderAnswerItems(confirmation.items)}
          </section>
        </div>
        <p class="ai-answer-boundary"><strong>说明：</strong>${escapeHTML(message.boundary)}</p>
        <div class="conversation-actions">
          <button class="button secondary" type="button" data-action="open-conversation-board">查看风险看板</button>
          ${state.conversation?.riskId ? `<button class="button primary" type="button" data-action="open-conversation-risk">打开风险详情</button>` : ""}
        </div>
      </article>`;
  }
  if (message.type === "clarification") {
    return `
      <article class="conversation-message assistant compact-answer">
        <div>${assistantMark("conversation")}<p>${escapeHTML(message.text)}</p></div>
        <div class="clarification-examples">${(message.examples || []).map((item) => `<button type="button" data-query-example="${escapeHTML(item)}">${escapeHTML(item)}</button>`).join("")}</div>
      </article>`;
  }
  return `
    <article class="conversation-message assistant compact-answer ${message.type === "degraded" || message.type === "error" ? "warning" : ""}">
      <div>${assistantMark("conversation")}<p>${escapeHTML(message.text)}</p></div>
      ${message.boundary ? `<p class="ai-answer-boundary">${escapeHTML(message.boundary)}</p>` : ""}
    </article>`;
}

function renderConversation(state) {
  const messages = state.conversation.messages || [];
  return `
    <section class="conversation-stage" aria-live="polite">
      ${renderIdentifiedScope(state.conversation.identifiedScope)}
      <div class="conversation-stream">${messages.map((message) => renderConversationMessage(message, state)).join("")}</div>
      <form class="conversation-composer" data-form="conversation-followup">
        <textarea name="prompt" rows="2" aria-label="继续追问当前风险" placeholder="继续追问…"></textarea>
        <button class="button primary" type="submit">继续追问 <i>↑</i></button>
      </form>
    </section>`;
}

export function renderWelcome(state) {
  const conversationActive = state.conversation?.phase !== "idle";
  return `
    <section class="welcome-page ${conversationActive ? "conversation-active" : ""}" data-page="welcome">
      <div class="welcome-content">
        ${renderErrorState(state.error)}
        ${
          conversationActive
            ? `
              <header class="task-page-header conversation-page-header">
                <div><h1>风险分析对话</h1></div>
                <button class="button secondary" type="button" data-nav="welcome">发起新任务</button>
              </header>
              ${renderConversation(state)}`
            : `
              <header class="task-page-header">
                <div><h1>发起风险分析</h1></div>
                <dl class="task-data-status">
                  <div><dt>数据时间</dt><dd>${escapeHTML(state.snapshot.dataTime)}</dd></div>
                </dl>
              </header>
              <section class="task-entry-card">
                <form class="analysis-form natural-language-entry" data-form="analysis" novalidate>
                  <label class="natural-query"><div class="query-field"><textarea rows="3" name="query" aria-label="输入风险分析问题" placeholder="输入订单号、客户、时间范围，或描述交付问题"></textarea><button class="button primary" type="submit">发送并分析 <i>→</i></button></div></label>
                  <p class="query-boundary">规则判定风险，AI提供解释与建议。</p>
                  <div class="common-tasks"><span>常用任务</span><div class="quick-tasks" aria-label="快捷任务">
                    <button type="button" data-quick="sample"><span class="quick-index" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg></span><span><strong>按订单号查询</strong></span><i class="quick-arrow" aria-hidden="true">↗</i></button>
                    <button type="button" data-quick="due-soon"><span class="quick-index" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h3M14 15h2M8 18h3" /></svg></span><span><strong>未来7天风险</strong></span><i class="quick-arrow" aria-hidden="true">↗</i></button>
                    <button type="button" data-quick="needs-data"><span class="quick-index" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4M15 3h6v6M21 3l-9 9M7 12h2M7 16h7" /></svg></span><span><strong>待补信息事项</strong></span><i class="quick-arrow" aria-hidden="true">↗</i></button>
                  </div></div>
                  ${renderRangePanel(state)}
                </form>
              </section>`
        }
      </div>
    </section>
  `;
}

function metricCard(label, value, note, tone) {
  return `
    <article class="metric-card ${tone}">
      <span>${label}</span>
      <strong>${String(value).padStart(2, "0")}</strong>
      <small>${note}</small>
    </article>
  `;
}

function filteredRisks(state) {
  const visible = new Set(state.visibleRiskIds || state.risks.map((risk) => risk.id));
  const scopedRisks = state.risks.filter((risk) => visible.has(risk.id));
  const filter = state.filter || "全部";
  if (filter === "有风险") return scopedRisks.filter((risk) => risk.riskResult === "有风险");
  if (filter === "数据不足") return scopedRisks.filter((risk) => risk.riskResult === "数据不足");
  if (filter === "待人工确认") {
    return scopedRisks.filter(
      (risk) => risk.recommendationDecision === "未确认" || risk.caseStatus === "待补信息",
    );
  }
  if (["红色", "橙色", "黄色"].includes(filter)) {
    return scopedRisks.filter((risk) => risk.suggestedLevel === filter);
  }
  return scopedRisks;
}

function ruleBasisLabel(risk) {
  if (risk.ruleHits.length) return risk.ruleHits.join(" / ");
  return risk.evidence?.gaps?.some((item) => item.field === "关联包装计划")
    ? "LINK-001"
    : "DATA-002";
}

function riskCard(risk) {
  const group = risk.productGroups[0];
  return `
    <article class="risk-card" data-risk-card="${escapeHTML(risk.id)}">
      <div class="risk-card-status">
        ${semanticTag("riskResult", risk.riskResult)}
        ${semanticTag("suggestedLevel", risk.suggestedLevel)}
      </div>
      <div class="risk-card-identity">
        <button class="contract-link" type="button" data-action="open-risk" data-risk-id="${escapeHTML(risk.id)}">
          ${escapeHTML(risk.contractNo)}
        </button>
        <strong>${escapeHTML(risk.customer)}</strong>
        <span>${escapeHTML(group.productName)} · ${escapeHTML(group.productCode)}</span>
      </div>
      <div class="risk-card-dates">
        <span><small>客户订单交期</small><b>${formatDate(risk.customerDueDate)}</b></span>
        <span><small>公司评审交期</small><b>${formatDate(risk.companyReviewDueDate)}</b></span>
        <span><small>距离客户交期</small><b>${escapeHTML(risk.metrics.daysToCustomerDue)} 天</b></span>
      </div>
      <div class="risk-card-evidence">
        <span><small>待包装缺口</small><b>${escapeHTML(risk.metrics.packagingGap)} 件</b></span>
        <span><small>证据完整度</small><b>${escapeHTML(risk.evidenceCompleteness)}</b></span>
        <span><small>规则依据</small><b>${escapeHTML(ruleBasisLabel(risk))}</b></span>
      </div>
      <div class="risk-card-action">
        <p>${escapeHTML(risk.finalRecommendation || risk.aiResult.recommendation)}</p>
        <div>
          <span>建议角色：${escapeHTML(risk.responsibleRole)}</span>
          ${semanticTag("caseStatus", risk.caseStatus)}
          <button class="button secondary" type="button" data-action="open-risk" data-risk-id="${escapeHTML(risk.id)}">核验证据</button>
        </div>
      </div>
    </article>
  `;
}

export function renderWorkbench(state) {
  const metrics = state.dashboardMetrics;
  const risks = filteredRisks(state);
  return `
    <section class="view-page workbench-page" data-page="workbench">
      <header class="page-heading">
        <div>
          <h1>风险看板</h1>
        </div>
        <div class="page-heading-actions">
          ${state.conversation?.messages?.length ? `<button class="button secondary conversation-return-button" type="button" data-action="return-conversation">← 返回AI任务会话</button>` : ""}
          <button class="button ghost" type="button" data-action="simulate-ai-failure">演示AI降级</button>
          <button class="button secondary" type="button" data-action="reanalyze">按当前快照重新分析</button>
          <button class="button primary" type="button" data-nav="welcome">＋ 发起新任务</button>
        </div>
      </header>

      ${snapshotRibbon(state, true)}
      ${renderErrorState(state.error)}

      <div class="metric-grid">
        ${metricCard("风险订单数", metrics.riskOrderCount, "合同去重", "red")}
        ${metricCard("临近交期风险订单数", metrics.dueSoonRiskOrderCount, "0–7自然日，不含逾期", "orange")}
        ${metricCard("包装缺口订单数", metrics.packagingGapOrderCount, "库存不重复计算", "ink")}
        ${metricCard("数据不足订单数", metrics.insufficientDataOrderCount, "暂无法判定", "slate")}
      </div>

      <article class="ai-brief ${state.aiRuntime === "unavailable" ? "unavailable" : ""}">
        ${assistantMark("brief")}
        <div>
          <span class="brief-label">${state.aiRuntime === "unavailable" ? "AI解释暂时不可用" : "AI 当前快照简报"}</span>
          ${
            state.aiRuntime === "unavailable"
              ? `<p>指标、规则与证据可查看，可单独重试AI。</p>`
              : `<p>
                  当前任务：有风险 <b>${metrics.riskOrderCount}</b> 项，待补信息 <b>${metrics.insufficientDataOrderCount}</b> 项；筛选后 <b>${risks.length}</b> 项。
                </p>`
          }
        </div>
        <span class="ai-boundary">规则判定 · AI解释</span>
      </article>

      <div class="toolbar">
        <div class="filters" role="group" aria-label="风险筛选">
          ${["全部", "有风险", "数据不足", "待人工确认"]
            .map(
              (filter) =>
                `<button type="button" class="filter-chip ${state.filter === filter || (!state.filter && filter === "全部") ? "active" : ""}" data-filter="${filter}">${filter}</button>`,
            )
            .join("")}
          <span class="filter-divider" aria-hidden="true">建议等级</span>
          ${["红色", "橙色", "黄色"]
            .map(
              (filter) =>
                `<button type="button" class="filter-chip level-filter ${state.filter === filter ? "active" : ""}" data-filter="${filter}">${filter}</button>`,
            )
            .join("")}
        </div>
        <span>按风险、等级、交期排序</span>
      </div>

      <div class="risk-list">
        ${risks.map(riskCard).join("") || `<div class="empty-state">当前筛选条件下没有风险事项</div>`}
      </div>
    </section>
  `;
}

function factsTable(risk) {
  return risk.productGroups
    .map(
      (group) => `
        <tr>
          <td><strong>${escapeHTML(group.productCode)}</strong><small>${escapeHTML(group.productName)}</small></td>
          <td>${escapeHTML(group.item.orderQty)}</td>
          <td>${escapeHTML(group.item.deliveredQty)}</td>
          <td>${escapeHTML(group.item.reservedQty)}</td>
          <td>${escapeHTML(group.item.sourceUnstockedQty) || `<span class="data-missing">待补</span>`}</td>
          <td>${escapeHTML(group.metrics.undeliveredQty)}</td>
          <td>${escapeHTML(group.metrics.packagingGap)}</td>
          <td>${formatDate(group.item.customerDueDate)}</td>
          <td>${formatDate(group.item.companyReviewDueDate)}</td>
          <td><small>销售订单<br />${escapeHTML(risk.orderDataTime)}</small></td>
        </tr>
      `,
    )
    .join("");
}

function workOrderRows(risk) {
  if (!risk.workOrders.length) {
    return `<tr><td colspan="8"><span class="inline-warning">当前未找到可追溯的关联工单</span></td></tr>`;
  }
  return risk.workOrders
    .flatMap((workOrder) => {
      const warnings = risk.warnings.filter(
        (warning) => warning.workOrderId === workOrder.id,
      );
      if (!warnings.length) {
        return [`
          <tr>
            <td><strong>${escapeHTML(workOrder.id)}</strong></td>
            <td>${escapeHTML(workOrder.productCode)}</td>
            <td>${escapeHTML(workOrder.productionStatus)}</td>
            <td>${escapeHTML(workOrder.unfinishedQty)}</td>
            <td colspan="4"><span class="no-warning">无生效MES预警 · 工单更新时间 ${escapeHTML(workOrder.dataTime)}</span></td>
          </tr>
        `];
      }
      return warnings.map(
        (warning) => `
          <tr>
            <td><strong>${escapeHTML(workOrder.id)}</strong><small>${escapeHTML(workOrder.dataTime)}</small></td>
            <td>${escapeHTML(workOrder.productCode)}</td>
            <td>${escapeHTML(workOrder.productionStatus)}</td>
            <td>${escapeHTML(workOrder.unfinishedQty)}</td>
            <td><strong>${escapeHTML(warning.id)}</strong></td>
            <td><span class="warning-chip ${warning.level === "黄色" ? "yellow" : ""}">${escapeHTML(warning.level)}</span>${escapeHTML(warning.type)}</td>
            <td>${escapeHTML(warning.triggeredAt)}</td>
            <td><small>${escapeHTML(warning.status)}<br />更新于 ${escapeHTML(warning.dataTime)}</small></td>
          </tr>
        `,
      );
    })
    .join("");
}

function planRows(risk) {
  const plans = risk.productGroups.flatMap((group) => group.plans);
  if (!plans.length) {
    return `<tr><td colspan="8"><span class="inline-warning">LINK-001 暂未找到可确认的关联包装计划</span></td></tr>`;
  }
  return plans
    .map(
      (plan) => `
        <tr>
          <td><strong>${escapeHTML(plan.id)}</strong></td>
          <td>${escapeHTML(plan.productCode)}</td>
          <td>${escapeHTML(plan.operationNo)}</td>
          <td>${escapeHTML(plan.assignedQty)}</td>
          <td>${escapeHTML(plan.completedQty)}</td>
          <td>${formatDate(plan.processDate)}</td>
          <td>${formatDate(plan.plannedCompletionDate)}</td>
          <td><small>${escapeHTML(plan.status)}<br />${escapeHTML(plan.dataTime)}</small></td>
        </tr>
      `,
    )
    .join("");
}

function evidenceList(items, formatter) {
  if (!items.length) return `<p class="muted-line">当前无此类证据</p>`;
  return `<ul class="evidence-list">${items.map((item) => `<li>${formatter(item)}</li>`).join("")}</ul>`;
}

function actionDock(state, risk) {
  const canFinalize = state.user.role === "计划主管";
  if (!canFinalize) {
    return `
      <div class="action-dock restricted">
        <div><strong>协作模式</strong><span>生产经理无最终确认或跨部门指派权限。</span></div>
        <button class="button secondary" type="button" data-action="ask-context">继续追问AI</button>
      </div>
    `;
  }
  const closed = ["已完成", "无需处理"].includes(risk.caseStatus);
  return `
    <div class="action-dock">
      <div>
        <strong>人工决策区</strong>
      </div>
      <div class="dock-actions">
        ${
          closed
            ? `<button class="button primary" type="button" data-modal="reopen">确认重新打开</button>`
            : `
              <button class="button ghost danger" type="button" data-modal="reject">驳回</button>
              <button class="button secondary" type="button" data-modal="modify">修改后采纳</button>
              <button class="button secondary" type="button" data-modal="accept">采纳建议</button>
              <button class="button primary" type="button" data-modal="assign">指派责任人</button>
              ${risk.caseStatus === "处理中" ? `<button class="button primary dark" type="button" data-modal="complete">确认处理完成</button>` : ""}
            `
        }
      </div>
    </div>
  `;
}

export function renderDetail(state) {
  const risk = state.risks.find((item) => item.id === state.selectedRiskId);
  if (!risk) return renderWorkbench(state);
  return `
    <section class="view-page detail-page" data-page="detail">
      <div class="detail-top-navigation">
        <button class="back-link" type="button" data-nav="workbench">← 返回风险看板</button>
        ${state.conversation?.messages?.length ? `<button class="button secondary conversation-return-button" type="button" data-action="return-conversation">← 返回AI任务会话</button>` : ""}
      </div>
      <header class="detail-heading">
        <div>
          <p class="eyebrow">风险核验 / ${escapeHTML(risk.id)}</p>
          <h1>风险事项详情</h1>
          <div class="detail-identity">
            <strong>${escapeHTML(risk.contractNo)}</strong>
            <span>${escapeHTML(risk.customer)}</span>
            <span>${escapeHTML(risk.productGroups.map((group) => group.productName).join("、"))}</span>
          </div>
        </div>
        <div class="detail-status-stack">
          ${semanticTag("riskResult", risk.riskResult)}
          ${semanticTag("suggestedLevel", risk.suggestedLevel)}
          ${semanticTag("caseStatus", risk.caseStatus)}
          ${semanticTag("recommendationDecision", risk.recommendationDecision)}
          <button class="button secondary" type="button" data-action="toggle-context">AI上下文 ›</button>
        </div>
      </header>

      ${snapshotRibbon(state, true)}
      ${renderErrorState(state.error)}

      <section class="summary-strip">
        <span><small>客户订单交期</small><strong>${formatDate(risk.customerDueDate)}</strong></span>
        <span><small>公司评审交期</small><strong>${formatDate(risk.companyReviewDueDate)}</strong></span>
        <span><small>剩余时间</small><strong>${escapeHTML(risk.metrics.daysToCustomerDue)} 天</strong></span>
        <span><small>待包装缺口</small><strong>${escapeHTML(risk.metrics.packagingGap)} 件</strong></span>
        <span><small>证据完整度</small><strong>${escapeHTML(risk.evidenceCompleteness)}</strong></span>
        <span><small>责任角色/人</small><strong>${escapeHTML(risk.assignee || risk.responsibleRole)}</strong></span>
      </section>

      <div class="detail-stack">
        <article class="section-card">
          <div class="section-head">
            <div><span class="section-index">01</span><h2>订单事实</h2></div>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th scope="col">品名编码</th><th scope="col">订单数</th><th scope="col">已交数</th><th scope="col">预定数</th><th scope="col">未入库数</th><th scope="col">未交数</th><th scope="col">待包装缺口</th><th scope="col">客户交期</th><th scope="col">公司评审交期</th><th scope="col">来源/时间</th></tr></thead>
              <tbody>${factsTable(risk)}</tbody>
            </table>
          </div>
        </article>

        <article class="section-card">
          <div class="section-head">
            <div><span class="section-index">02</span><h2>包装计划</h2></div>
            <span>同合同 + 同品名</span>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th scope="col">日锁定计划号</th><th scope="col">品名</th><th scope="col">工序</th><th scope="col">派工数量</th><th scope="col">已完成</th><th scope="col">加工日期</th><th scope="col">计划完工日期</th><th scope="col">状态/时间</th></tr></thead>
              <tbody>${planRows(risk)}</tbody>
            </table>
          </div>
          <div class="rule-callout">
            <span>规则依据</span>
            <strong>${escapeHTML(ruleBasisLabel(risk))}</strong>
          </div>
        </article>

        <article class="section-card work-order-card">
          <div class="section-head">
            <div><span class="section-index">03</span><h2>工单与MES预警</h2></div>
            <span>预警仅作补充证据</span>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th scope="col">工单号</th><th scope="col">品名</th><th scope="col">生产状态</th><th scope="col">未完成数</th><th scope="col">预警编号</th><th scope="col">等级/类型</th><th scope="col">触发时间</th><th scope="col">状态/更新时间</th></tr></thead>
              <tbody>${workOrderRows(risk)}</tbody>
            </table>
          </div>
        </article>

        <div class="evidence-grid">
          <article class="section-card evidence-card fact">
            <div class="section-head"><div><span class="section-index">04</span><h2>已确认事实</h2></div></div>
            ${evidenceList(risk.evidence.facts, (item) => `<strong>${escapeHTML(item.label)}：${escapeHTML(item.value)}</strong><small>${escapeHTML(item.source)}</small>`)}
          </article>
          <article class="section-card evidence-card candidate">
            <div class="section-head"><div><span class="section-index">05</span><h2>原因候选</h2></div><span>候选 ≠ 根因</span></div>
            ${evidenceList(risk.evidence.candidates, (item) => escapeHTML(item))}
          </article>
          <article class="section-card evidence-card counter">
            <div class="section-head"><div><span class="section-index">06</span><h2>反证</h2></div></div>
            ${evidenceList(risk.evidence.counterEvidence, (item) => escapeHTML(item))}
          </article>
          <article class="section-card evidence-card gap">
            <div class="section-head"><div><span class="section-index">07</span><h2>待补信息</h2></div></div>
            ${evidenceList(risk.evidence.gaps, (item) => `<strong>${escapeHTML(item.field)}</strong><small>${escapeHTML(item.impact)}</small>`)}
          </article>
        </div>

        <article class="section-card ai-recommendation-card">
          <div class="section-head">
            <div>${assistantMark()}<h2>本任务AI原始建议</h2></div>
            <span>生成于 ${escapeHTML(risk.aiResult.generatedAt)}</span>
          </div>
          <div class="recommendation-compare">
            <div><span>AI原建议</span><p>${escapeHTML(risk.aiResult.recommendation)}</p></div>
            <div><span>人工最终建议</span><p>${escapeHTML(risk.finalRecommendation || "尚未形成")}</p></div>
            <div><span>建议处理状态</span><p>${escapeHTML(risk.recommendationDecision)} · ${escapeHTML(risk.caseStatus)}</p></div>
          </div>
          <div class="recommendation-note"><p>原建议保留，人工修改单独记录。</p></div>
        </article>

        <article class="section-card">
          <div class="section-head">
            <div><span class="section-index">08</span><h2>操作记录</h2></div>
          </div>
          <div class="history-list">
            ${risk.history
              .slice()
              .reverse()
              .map(
                (item) => `
                  <div class="history-item">
                    <span>${escapeHTML(item.time)}</span>
                    <div><strong>${escapeHTML(item.action)}</strong><p>${escapeHTML(item.actor)} · ${escapeHTML(item.detail)}</p></div>
                  </div>
                `,
              )
              .join("")}
          </div>
        </article>
      </div>

      ${actionDock(state, risk)}
    </section>
  `;
}

export function renderContextPanel(state) {
  const risk = state.risks.find((item) => item.id === state.selectedRiskId);
  if (!risk || !state.contextOpen) return "";
  const task = state.task || {};
  return `
    <div class="context-inner">
      <header class="context-head">
        <div>${assistantMark()}<span><strong>上下文协作</strong>${state.aiRuntime === "unavailable" ? "<small>AI解释不可用</small>" : ""}</span></div>
        <button class="icon-button" type="button" data-action="toggle-context" aria-label="关闭AI上下文">×</button>
      </header>
      <section class="context-scope">
        <span>原始问题</span><p>${escapeHTML(task.originalQuestion || "默认订单交付风险排查")}</p>
        <dl>
          <div><dt>当前范围</dt><dd>${escapeHTML(risk.contractNo)} · ${escapeHTML(risk.customer)}</dd></div>
          <div><dt>核心结论</dt><dd>${escapeHTML(risk.aiResult.conclusion)}</dd></div>
        </dl>
      </section>
      <div class="chat-stream" id="chat-stream">
        ${state.chat
          .map(
            (message) => `<div class="message ${message.role}"><p>${escapeHTML(message.text)}</p></div>`,
          )
          .join("")}
        <div class="suggestion-list">
          ${[
            "为什么命中这些规则？",
            "还缺少哪些证据？",
            "包装计划更新后要重新判断什么？",
          ]
            .map(
              (prompt) => `<button type="button" data-prompt="${escapeHTML(prompt)}">${escapeHTML(prompt)}</button>`,
            )
            .join("")}
        </div>
      </div>
      <form class="context-composer" data-form="chat">
        <input name="prompt" aria-label="围绕当前风险继续追问" placeholder="围绕当前风险继续追问…" />
        <button type="submit" aria-label="发送追问">↑</button>
      </form>
      <p class="context-boundary">仅限当前订单，正式动作需人工确认。</p>
    </div>
  `;
}

export function renderCurrentView(state) {
  if (state.activeView === "welcome") return renderWelcome(state);
  if (state.activeView === "detail") return renderDetail(state);
  return renderWorkbench(state);
}
