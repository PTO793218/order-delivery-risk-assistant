import {
  assignRisk,
  completeRisk,
  createInitialState,
  decideRecommendation,
  getSelectedRisk,
  continueAssistantTask,
  openAssistantConversation,
  reopenRisk,
  resetDemo,
  retryFailedStep,
  selectRisk,
  setSimulatedFailure,
  openSnapshotWorkbench,
  startAssistantTask,
  startTask,
  switchUserRole,
} from "./state.js";
import { answerTaskFollowUp } from "./assistant.js";
import { renderContextPanel, renderCurrentView } from "./views.js";

const mainView = document.querySelector("#main-view");
const contextPanel = document.querySelector("#context-panel");
const contentGrid = document.querySelector("#content-grid");
const modalRoot = document.querySelector("#modal-root");
const toastRoot = document.querySelector("#toast-root");

let state = createInitialState();
let modalType = "";

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateShell() {
  const scopedRiskCount = state.task
    ? new Set(state.visibleRiskIds || []).size
    : state.risks.length;
  document.querySelector("#risk-count").textContent = String(scopedRiskCount);
  document.querySelector("#user-avatar").textContent = state.user.name.slice(0, 1);
  document.querySelector("#user-name").textContent = state.user.name;
  document.querySelector("#user-role").textContent = state.user.role;
  document.querySelector("#system-scope").innerHTML = `
    <span class="scope-dot" aria-hidden="true"></span>
    <span>${escapeHTML(state.snapshot.mode)}</span>
    <span class="scope-separator">/</span>
    ${escapeHTML(state.snapshot.organization)}
    <span class="scope-separator">/</span>
    <span>验证基准日 ${escapeHTML(state.snapshot.baselineDate)}</span>
    <span class="scope-separator">/</span>
    <span>快照版本 ${escapeHTML(state.snapshot.snapshotVersion)}</span>
  `;
  document.querySelectorAll("[data-nav]").forEach((button) => {
    const target = button.dataset.nav;
    button.classList.toggle(
      "active",
      target === state.activeView ||
        (target === "workbench" && state.activeView === "detail"),
    );
  });
}

function render() {
  const previousView = mainView.dataset.activeView;
  const scrollTop = mainView.scrollTop;
  mainView.innerHTML = renderCurrentView(state);
  const showContext = state.activeView === "detail" && state.contextOpen;
  contentGrid.classList.toggle("has-context", showContext);
  contextPanel.innerHTML = showContext ? renderContextPanel(state) : "";
  updateShell();
  mainView.dataset.activeView = state.activeView;
  mainView.scrollTop = previousView === state.activeView ? scrollTop : 0;
  requestAnimationFrame(() => {
    const stream = document.querySelector("#chat-stream");
    if (stream) stream.scrollTop = stream.scrollHeight;
  });
}

function toast(title, detail = "原型状态已更新，未写入业务系统", tone = "success") {
  const element = document.createElement("div");
  element.className = `toast ${tone}`;
  element.innerHTML = `
    <span class="toast-icon">${tone === "error" ? "!" : "✓"}</span>
    <span><strong>${escapeHTML(title)}</strong><small>${escapeHTML(detail)}</small></span>
  `;
  toastRoot.append(element);
  window.setTimeout(() => element.remove(), 3600);
}

function closeModal() {
  modalType = "";
  modalRoot.innerHTML = "";
}

function modalLayout(title, description, body, submitLabel, tone = "primary") {
  return `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal-head">
          <div><h2 id="modal-title">${title}</h2><p>${description}</p></div>
          <button class="icon-button" type="button" data-action="close-modal" aria-label="关闭弹窗">×</button>
        </header>
        <form data-form="modal">
          <div class="modal-body">${body}</div>
          <div class="modal-boundary"><b>!</b><span>仅更新演示状态，不写回业务系统。</span></div>
          <footer class="modal-actions">
            <button class="button secondary" type="button" data-action="close-modal">取消</button>
            <button class="button ${tone}" type="submit">${submitLabel}</button>
          </footer>
        </form>
      </section>
    </div>
  `;
}

function openModal(type) {
  const risk = getSelectedRisk(state);
  if (!risk) return;
  modalType = type;
  const configs = {
    accept: modalLayout(
      "采纳AI建议",
      "采纳不改变事项状态。",
      `<div class="decision-preview"><span>AI原建议</span><p>${escapeHTML(risk.aiResult.recommendation)}</p></div>`,
      "确认采纳",
    ),
    modify: modalLayout(
      "修改后采纳",
      "原建议保留，采纳不关闭事项。",
      `
        <div class="decision-preview muted"><span>AI原建议</span><p>${escapeHTML(risk.aiResult.recommendation)}</p></div>
        <label class="field"><span>人工最终建议</span><textarea name="finalRecommendation" rows="5" required>${escapeHTML(risk.finalRecommendation || risk.aiResult.recommendation)}</textarea></label>
      `,
      "保存并采纳",
    ),
    assign: modalLayout(
      "指派责任人",
      risk.caseStatus === "待补信息"
        ? "指派后仍待补信息。"
        : "待确认事项指派后进入处理中。",
      `
        <label class="field"><span>责任人</span>
          <select name="assignee" required>
            <option value="">请选择责任人</option>
            <option>计划主管 · 林芳</option>
            <option>生产经理 · 陈立</option>
          </select>
        </label>
        <label class="field"><span>处理要求</span><textarea name="requirement" rows="3" required>核对包装计划、评审交期和待补证据，并更新原型内处理进度。</textarea></label>
      `,
      "确认指派",
    ),
    reject: modalLayout(
      "驳回AI建议",
      "必须说明驳回理由，并选择采用人工方案或确认无需处理。",
      `
        <label class="field"><span>驳回理由</span><textarea name="rejectionReason" rows="3" required placeholder="说明AI建议不适用的业务依据"></textarea></label>
        <label class="field"><span>后续处理</span>
          <select name="outcome" required>
            <option value="人工方案">采用人工方案并进入处理中</option>
            <option value="无需处理">确认无需处理</option>
          </select>
        </label>
        <label class="field"><span>人工方案</span><textarea name="finalRecommendation" rows="3" placeholder="采用人工方案时必填"></textarea></label>
        <label class="field"><span>责任人</span>
          <select name="assignee">
            <option value="">采用人工方案时请选择</option>
            <option>计划主管 · 林芳</option>
            <option>生产经理 · 陈立</option>
          </select>
        </label>
        <label class="field"><span>无需处理依据</span><textarea name="noActionReason" rows="3" placeholder="选择无需处理时必填"></textarea></label>
      `,
      "二次确认驳回",
      "danger",
    ),
    complete: modalLayout(
      "确认处理完成",
      "完成后事项进入已完成；新证据出现时仍需人工确认才能重新打开。",
      `<label class="field"><span>处理结果</span><textarea name="note" rows="4" required placeholder="记录处理结果和证据"></textarea></label>`,
      "二次确认完成",
    ),
    reopen: modalLayout(
      "重新打开风险事项",
      "请说明新证据与重新打开原因，确认后事项回到待确认。",
      `
        <label class="field"><span>重新打开原因</span><textarea name="reason" rows="3" required></textarea></label>
        <label class="field"><span>新证据</span><textarea name="newEvidence" rows="3" required></textarea></label>
      `,
      "二次确认重新打开",
    ),
  };
  modalRoot.innerHTML = configs[type] || "";
  modalRoot.querySelector("textarea, select, input")?.focus();
}

function submitAssistantTask(input) {
  state = startAssistantTask(state, input);
  render();
  if (state.error) {
    toast("无法开始分析", state.error.message, "error");
    return false;
  }
  if (state.conversation.phase === "clarifying") {
    toast("还需要补充查询范围", "请填写订单标识，或完整的开始与结束日期", "error");
    return false;
  }
  toast("AI分析会话已生成", "确定性规则已完成，六段式回答等待人工核验");
  return true;
}

function askAI(prompt) {
  const risk = getSelectedRisk(state);
  const text = String(prompt || "").trim();
  if (!risk || !text) return;
  if (state.aiRuntime === "unavailable") {
    state = setSimulatedFailure(state, "AI-001");
    render();
    toast("AI解释暂时不可用", "规则结果和事实证据未受影响", "error");
    return;
  }
  state = {
    ...state,
    chat: [
      ...state.chat,
      { role: "user", text },
      { role: "assistant", text: answerTaskFollowUp(text, risk, state.snapshot).text },
    ],
  };
  render();
}

document.addEventListener("click", (event) => {
  if (event.target.matches("[data-modal-backdrop]")) {
    closeModal();
    return;
  }

  const nav = event.target.closest("[data-nav]");
  if (nav) {
    if (nav.dataset.nav === "welcome") {
      state = {
        ...state,
        activeView: "welcome",
        task: null,
        selectedRiskId: null,
        contextOpen: false,
        chat: [],
        draftInput: {},
        conversation: {
          phase: "idle",
          messages: [],
          identifiedScope: null,
          riskId: null,
        },
        error: null,
      };
    } else {
      state = state.task
        ? { ...state, activeView: "workbench", selectedRiskId: null, contextOpen: false }
        : openSnapshotWorkbench(state);
    }
    render();
    return;
  }

  const filter = event.target.closest("[data-filter]");
  if (filter) {
    state = { ...state, filter: filter.dataset.filter };
    render();
    return;
  }

  const quick = event.target.closest("[data-quick]");
  if (quick) {
    if (quick.dataset.quick === "sample") {
      submitAssistantTask({
        query: "分析合同25DMO00001W-AA、产品5756为什么有交付风险？",
        contractNo: "25DMO00001W-AA",
        productCode: "5756",
      });
    } else {
      submitAssistantTask({
        query:
          quick.dataset.quick === "due-soon"
            ? "分析2025-02-12至2025-02-19的交付风险"
            : "分析2025-02-12至2025-03-31有哪些事项需要补充信息",
        dateFrom: state.snapshot.baselineDate,
        dateTo: quick.dataset.quick === "needs-data" ? "2025-03-31" : "2025-02-19",
      });
      state = {
        ...state,
        filter: quick.dataset.quick === "needs-data" ? "数据不足" : "有风险",
      };
      render();
    }
    return;
  }

  const queryExample = event.target.closest("[data-query-example]");
  if (queryExample) {
    submitAssistantTask({ query: queryExample.dataset.queryExample });
    return;
  }

  const openRisk = event.target.closest('[data-action="open-risk"]');
  if (openRisk) {
    state = selectRisk(state, openRisk.dataset.riskId);
    render();
    return;
  }

  const prompt = event.target.closest("[data-prompt]");
  if (prompt) {
    askAI(prompt.dataset.prompt);
    return;
  }

  const modalButton = event.target.closest("[data-modal]");
  if (modalButton) {
    openModal(modalButton.dataset.modal);
    return;
  }

  const errorButton = event.target.closest("[data-error-action]");
  if (errorButton) {
    const errorAction = errorButton.dataset.errorAction;
    if (errorAction.includes("重试")) {
      state = retryFailedStep(state);
      render();
      toast("失败步骤已恢复", "已保留订单事实、规则结果和人工操作记录");
      return;
    }
    if (["补充条件", "修改条件", "返回入口", "返回"].includes(errorAction)) {
      state = {
        ...state,
        activeView: "welcome",
        task: null,
        selectedRiskId: null,
        contextOpen: false,
        chat: [],
        draftInput: {},
        conversation: {
          phase: "idle",
          messages: [],
          identifiedScope: null,
          riskId: null,
        },
        error: null,
      };
      render();
      return;
    }
    if (errorAction === "继续查看事实") {
      state = { ...state, error: null };
      render();
      return;
    }
    toast("已转为人工核验", "当前错误编号和受影响范围已保留在页面中");
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.action;

  if (action === "close-modal") {
    closeModal();
    return;
  }
  if (action === "open-conversation-board") {
    state = { ...state, activeView: "workbench", selectedRiskId: null, contextOpen: false };
    render();
    return;
  }
  if (action === "open-conversation-risk") {
    if (state.conversation?.riskId) state = selectRisk(state, state.conversation.riskId);
    render();
    return;
  }
  if (action === "return-conversation") {
    state = openAssistantConversation(state);
    render();
    return;
  }
  if (action === "toggle-context" || action === "ask-context") {
    state = { ...state, contextOpen: !state.contextOpen };
    render();
    return;
  }
  if (action === "switch-role") {
    const nextRole = state.user.role === "计划主管" ? "生产经理" : "计划主管";
    state = switchUserRole(state, nextRole);
    render();
    toast("演示角色已切换", `当前角色：${nextRole}`);
    return;
  }
  if (action === "reset") {
    state = resetDemo(state.user.role);
    closeModal();
    render();
    toast("演示已重置", "任务、聊天和人工操作已恢复为初始状态");
    return;
  }
  if (action === "reanalyze") {
    toast("已按当前快照重新分析", "快照未变化，因此不会生成新增或持续风险标签");
    return;
  }
  if (action === "simulate-ai-failure") {
    state = setSimulatedFailure(state, "AI-001");
    render();
    toast("已进入AI降级状态", "风险结果、规则和事实证据仍可使用", "error");
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());

  if (form.dataset.form === "analysis") {
    submitAssistantTask(data);
    return;
  }
  if (form.dataset.form === "conversation-followup") {
    state = continueAssistantTask(state, data.prompt);
    form.reset();
    render();
    return;
  }
  if (form.dataset.form === "chat") {
    form.reset();
    askAI(data.prompt);
    return;
  }
  if (form.dataset.form !== "modal") return;

  try {
    if (modalType === "accept") {
      state = decideRecommendation(state, { decision: "采纳" });
    } else if (modalType === "modify") {
      state = decideRecommendation(state, {
        decision: "修改后采纳",
        finalRecommendation: data.finalRecommendation,
      });
    } else if (modalType === "assign") {
      state = assignRisk(state, {
        assignee: data.assignee,
        requirement: data.requirement,
      });
    } else if (modalType === "reject") {
      state = decideRecommendation(state, {
        decision: "驳回",
        outcome: data.outcome,
        rejectionReason: data.rejectionReason,
        finalRecommendation: data.finalRecommendation,
        assignee: data.assignee,
        noActionReason: data.noActionReason,
      });
    } else if (modalType === "complete") {
      state = completeRisk(state, { note: data.note });
    } else if (modalType === "reopen") {
      state = reopenRisk(state, {
        reason: data.reason,
        newEvidence: data.newEvidence,
      });
    }
    closeModal();
    render();
    toast("人工操作已记录", "状态、责任人和操作记录已在原型内更新");
  } catch (error) {
    toast("无法完成操作", error.message, "error");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modalRoot.innerHTML) closeModal();
});

render();
