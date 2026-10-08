import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function readExpected(relativePath) {
  try {
    return readFileSync(new URL(relativePath, import.meta.url), "utf8");
  } catch {
    return "";
  }
}

test("应用壳保留品牌导航和必要挂载点", () => {
  const html = readExpected("../index.html");
  assert.ok(html);
  for (const id of [
    "app-shell",
    "sidebar",
    "main-view",
    "context-panel",
    "modal-root",
    "toast-root",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /wangshang-logo\.png/);
});

test("主导航和控制器只保留三个P0页面", () => {
  const source = `${readExpected("../index.html")}\n${readExpected("../js/app.js")}\n${readExpected("../js/views.js")}`;
  assert.doesNotMatch(source, /复盘与报告|生成本周简报|导出当前视图/);
  assert.match(source, /发起风险分析/);
  assert.match(source, /风险看板/);
  assert.match(source, /风险事项详情/);
  for (const page of ["welcome", "workbench", "detail"]) {
    assert.match(source, new RegExp(`data-page=["']${page}["']`));
  }
});

test("页面显著展示历史模式、基准日和快照信息", () => {
  const views = `${readExpected("../js/views.js")}\n${readExpected("../js/app.js")}`;
  for (const text of ["历史数据验证模式", "验证基准日", "快照版本", "数据时间"]) {
    assert.match(views, new RegExp(text));
  }
});

test("欢迎页以自然语言为主入口并提供次级范围面板", () => {
  const views = readExpected("../js/views.js");
  for (const text of [
    "输入订单号、客户、时间范围",
    "设置查询范围",
    "YYYY-MM-DD",
    "conversation.messages",
    "查看风险看板",
    "打开风险详情",
  ]) {
    assert.match(views, new RegExp(text.replace(/[.]/g, "\\.")));
  }
  assert.doesNotMatch(views, /type="date"/);
});

test("欢迎页初始表单空值保持为空", async () => {
  const [{ createInitialState }, { renderWelcome }] = await Promise.all([
    import("../js/state.js"),
    import("../js/views.js"),
  ]);
  const html = renderWelcome(createInitialState());
  assert.doesNotMatch(html, /value="—"/);
  assert.doesNotMatch(html, />—<\/textarea>/);
});

test("欢迎页默认展示查询范围并提供明确的收起提示", async () => {
  const [{ createInitialState }, { renderWelcome }] = await Promise.all([
    import("../js/state.js"),
    import("../js/views.js"),
  ]);
  const html = renderWelcome(createInitialState());
  assert.match(html, /<details class="range-panel" open>/);
  assert.match(html, /class="range-disclosure"/);
  assert.match(html, /收起设置/);
  assert.match(html, /展开设置/);
});

test("欢迎页呈现为业务任务入口而不是宣传落地页", async () => {
  const [{ createInitialState }, { renderWelcome }] = await Promise.all([
    import("../js/state.js"),
    import("../js/views.js"),
  ]);
  const html = renderWelcome(createInitialState());
  assert.match(html, /发起风险分析/);
  assert.match(html, /常用任务/);
  assert.match(html, /输入订单号、客户、时间范围/);
  assert.doesNotMatch(html, /今天需要优先处理/);
  assert.doesNotMatch(html, /welcome-orbit/);
  assert.doesNotMatch(html, /确定性规则 × 可追溯证据 × 人工决策/);
});

test("AI分析以自然叙事呈现并完整保留六段内容", async () => {
  const [{ createInitialState, startAssistantTask }, { renderWelcome }] = await Promise.all([
    import("../js/state.js"),
    import("../js/views.js"),
  ]);
  const state = startAssistantTask(createInitialState(), {
    query: "分析合同25DMO00001W-AA、产品5756为什么有交付风险？",
  });
  const html = renderWelcome(state);
  for (const text of ["我先说结论", "我为什么这样判断", "目前还不能确认", "建议下一步", "需要你确认"]) {
    assert.match(html, new RegExp(text));
  }
  for (const evidence of ["200", "166", "34", "RISK-01"]) {
    assert.match(html, new RegExp(evidence));
  }
  assert.doesNotMatch(html, /conversation-six-grid/);
  assert.doesNotMatch(html, /AI六段式分析结果/);
});

test("风险看板展示四个确定性指标和独立语义字段", () => {
  const views = readExpected("../js/views.js");
  for (const text of [
    "风险订单数",
    "临近交期风险订单数",
    "包装缺口订单数",
    "数据不足订单数",
    "riskResult",
    "suggestedLevel",
    "caseStatus",
    "recommendationDecision",
  ]) {
    assert.match(views, new RegExp(text));
  }
});

test("风险详情包含PRD要求的同页证据和人工决策区域", () => {
  const views = readExpected("../js/views.js");
  for (const text of [
    "订单事实",
    "未入库数",
    "包装计划",
    "工单与MES预警",
    "规则依据",
    "已确认事实",
    "原因候选",
    "反证",
    "待补信息",
    "人工决策区",
    "操作记录",
  ]) {
    assert.match(views, new RegExp(text));
  }
});

test("看板支持按建议等级筛选", async () => {
  const [{ createInitialState }, { renderWorkbench }] = await Promise.all([
    import("../js/state.js"),
    import("../js/views.js"),
  ]);
  const html = renderWorkbench({ ...createInitialState(), filter: "红色" });
  assert.match(html, /data-filter="红色"/);
  assert.match(html, /25DMO00001W-AA/);
  assert.doesNotMatch(html, /25DMO00002W-BB/);
});

test("详情页展示未入库数和可追溯工单预警", async () => {
  const [{ createInitialState, selectRisk }, { renderDetail }] = await Promise.all([
    import("../js/state.js"),
    import("../js/views.js"),
  ]);
  const initial = createInitialState();
  const risk = initial.risks.find((item) => item.contractNo === "25DMO00001W-AA");
  const html = renderDetail(selectRisk(initial, risk.id));
  assert.match(html, /未入库数[\s\S]*?34/);
  assert.match(html, /MO-2502-056/);
  assert.match(html, /WARN-056-01/);
  assert.match(html, /计划进度/);
  assert.match(html, /生效中/);
});

test("看板和详情页顶部保留AI会话返回入口", async () => {
  const [{ createInitialState, selectRisk, startAssistantTask }, { renderDetail, renderWorkbench }] = await Promise.all([
    import("../js/state.js"),
    import("../js/views.js"),
  ]);
  const task = startAssistantTask(createInitialState(), {
    query: "分析合同25DMO00001W-AA、产品5756为什么有交付风险？",
  });
  const boardHtml = renderWorkbench({ ...task, activeView: "workbench" });
  assert.match(boardHtml, /page-heading-actions[\s\S]*?data-action="return-conversation"[\s\S]*?返回AI任务会话/);

  const detail = selectRisk(task, task.conversation.riskId);
  const detailHtml = renderDetail(detail);
  assert.doesNotMatch(detailHtml, /AI六段式分析/);
  assert.match(detailHtml, /本任务AI原始建议/);
  assert.match(detailHtml, /detail-top-navigation[\s\S]*?data-action="return-conversation"[\s\S]*?返回AI任务会话/);
  assert.ok(detailHtml.indexOf("返回AI任务会话") < detailHtml.indexOf("detail-heading"));
});

test("详情页AI追问复用证据约束回答器", () => {
  const app = readExpected("../js/app.js");
  assert.match(app, /answerTaskFollowUp/);
});

test("视觉系统保留品牌变量并支持窄桌面和减少动效", () => {
  const css = readExpected("../styles.css");
  for (const token of [
    "--brand-red",
    "--paper",
    "--ink",
    "--risk-red",
    "--status-blue",
    "prefers-reduced-motion",
    "@media (max-width: 1200px)",
  ]) {
    assert.match(css, new RegExp(token.replace(/[()]/g, "\\$&")));
  }
});

test("宽屏任务页扩大主内容区和任务卡片宽度", () => {
  const css = readExpected("../styles.css");
  const pageWidthRule = css.match(/\.view-page,\s*\.welcome-content\s*\{([^}]*)\}/)?.[1] || "";
  const taskCardRule = css.match(/\.task-entry-card\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(pageWidthRule, /width:\s*min\(1440px,\s*calc\(100% - 56px\)\)/);
  assert.match(css, /\.welcome-content\s*\{[\s\S]*?max-width:\s*1360px/);
  assert.match(taskCardRule, /width:\s*100%/);
  assert.match(taskCardRule, /max-width:\s*none/);
});

test("侧栏恢复浅色品牌视觉且横向Logo完整显示", () => {
  const css = readExpected("../styles.css");
  assert.match(css, /\.sidebar\s*\{[\s\S]*?#f3f1ed/);
  assert.match(css, /\.brand-logo\s*\{[\s\S]*?width:\s*112px/);
  assert.match(css, /\.brand-logo\s*\{[\s\S]*?height:\s*auto/);
  assert.doesNotMatch(css, /\.brand-logo\s*\{[^}]*object-fit:\s*cover/);
  assert.match(css, /\.assistant-mark img\s*\{[^}]*object-fit:\s*contain/);
});

test("控制器使用新状态和视图模块", () => {
  const app = readExpected("../js/app.js");
  assert.match(app, /from "\.\/state\.js"/);
  assert.match(app, /from "\.\/views\.js"/);
  assert.match(app, /startTask/);
  assert.match(app, /decideRecommendation/);
  assert.match(app, /renderCurrentView/);
  assert.equal(existsSync(new URL("../js/views.js", import.meta.url)), true);
});

test("页面接入任务范围和AI降级恢复", () => {
  const app = readExpected("../js/app.js");
  const views = readExpected("../js/views.js");
  assert.match(views, /visibleRiskIds/);
  assert.match(views, /data-action="simulate-ai-failure"/);
  assert.match(views, /aiRuntime/);
  assert.match(app, /setSimulatedFailure/);
  assert.match(app, /retryFailedStep/);
  assert.match(app, /if \(state\.error\)/);
});
