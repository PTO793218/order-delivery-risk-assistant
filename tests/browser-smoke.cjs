const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright-core");

const root = path.resolve(__dirname, "..");
const screenshotDir = process.env.SCREENSHOT_DIR || "";
const initialViewport = {
  width: Number(process.env.VIEWPORT_WIDTH || 1440),
  height: Number(process.env.VIEWPORT_HEIGHT || 900),
};
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

function serveFile(request, response) {
  const urlPath = new URL(request.url, "http://127.0.0.1").pathname;
  const requestPath = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
  const filePath = path.resolve(root, requestPath);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
}

async function capture(page, name, fullPage = true) {
  if (!screenshotDir) return;
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage });
}

async function run() {
  assert.ok(fs.existsSync(chromePath), "Google Chrome should be installed");
  const server = http.createServer(serveFile);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const page = await browser.newPage({ viewport: initialViewport });
  page.setDefaultTimeout(8000);
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "发起风险分析" }).waitFor();
    assert.equal(await page.getByText("历史数据验证模式", { exact: true }).first().isVisible(), true);
    const logoBox = await page.locator(".brand-logo").boundingBox();
    assert.ok(logoBox && logoBox.width / logoBox.height > 1.9, "横向Logo应完整显示而不是方形裁切");
    assert.equal(await page.locator("details.range-panel").getAttribute("open"), "");
    assert.equal(await page.getByText("收起设置", { exact: true }).isVisible(), true);
    assert.equal(await page.locator('input[name="contractNo"]').isVisible(), true);
    assert.equal(await page.locator('input[name="contractNo"]').inputValue(), "");
    assert.equal(await page.locator('input[name="customer"]').inputValue(), "");
    assert.equal(await page.locator('input[name="dateFrom"]').getAttribute("placeholder"), "YYYY-MM-DD");
    await capture(page, "01-welcome-1440.png");

    await page.locator('[data-nav="workbench"]').first().click();
    await page.getByRole("heading", { name: "风险看板" }).waitFor();
    assert.equal(await page.locator("[data-risk-card]").count(), 3);
    assert.match(await page.locator(".metric-grid").textContent(), /风险订单数\s*02/);
    await page.locator('[data-nav="welcome"]').first().click();

    await page.getByLabel("输入风险分析问题").fill("分析合同25DMO00001W-AA、产品5756为什么有交付风险？");
    await page.getByRole("button", { name: /发送并分析/ }).click();
    await page.getByRole("heading", { name: /合同 25DMO00001W-AA 的交付风险分析/ }).waitFor();
    for (const title of ["我为什么这样判断", "目前还不能确认", "建议下一步", "需要你确认"]) {
      assert.equal(await page.getByRole("heading", { name: title }).isVisible(), true);
    }
    assert.equal(await page.getByText(/我先说结论/).isVisible(), true);
    assert.equal(await page.locator(".conversation-six-grid").count(), 0);
    assert.equal(await page.getByText("AI六段式分析结果", { exact: true }).count(), 0);
    assert.match(await page.locator(".analysis-answer").textContent(), /订单数 200.*预定数 166.*待包装缺口 34/s);
    await capture(page, "02-ai-conversation-1440.png");

    await page.getByLabel("继续追问当前风险").fill("为什么命中这些规则？");
    await page.getByRole("button", { name: /继续追问/ }).click();
    assert.match(await page.locator(".conversation-stream").textContent(), /RISK-01/);

    await page.getByRole("button", { name: "查看风险看板" }).click();
    await page.getByRole("heading", { name: "风险看板" }).waitFor();
    assert.equal(await page.getByRole("button", { name: /返回AI任务会话/ }).isVisible(), true);
    assert.equal(await page.getByText("25DMO00001W-AA", { exact: true }).isVisible(), true);
    assert.equal(await page.locator("[data-risk-card]").count(), 1);
    assert.match(await page.locator(".metric-grid").textContent(), /风险订单数\s*01/);
    await page.getByRole("button", { name: "红色", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "红色", exact: true }).getAttribute("class"), "filter-chip level-filter active");
    await capture(page, "03-workbench-1440.png");

    await page.locator(".contract-link").click();
    await page.getByRole("heading", { name: "风险事项详情" }).waitFor();
    assert.equal(await page.getByText(/RISK-01/).first().isVisible(), true);
    assert.equal(await page.getByRole("heading", { name: "包装计划" }).isVisible(), true);
    assert.equal(await page.getByText("DL-250212-001", { exact: true }).isVisible(), true);
    const orderFactsCard = page.locator(".section-card").filter({ hasText: "订单事实" });
    assert.equal(await orderFactsCard.getByRole("columnheader", { name: "未入库数" }).isVisible(), true);
    assert.equal((await orderFactsCard.locator("tbody td").nth(4).textContent()).trim(), "34");
    assert.equal(await page.getByRole("heading", { name: "工单与MES预警" }).isVisible(), true);
    assert.equal(await page.getByText("MO-2502-056", { exact: true }).isVisible(), true);
    assert.equal(await page.getByText("WARN-056-01", { exact: true }).isVisible(), true);
    assert.equal(await page.getByText(/生效中/).isVisible(), true);
    assert.equal(await page.getByRole("heading", { name: "AI六段式分析" }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: "本任务AI原始建议" }).isVisible(), true);
    const conversationReturnBox = await page.getByRole("button", { name: /返回AI任务会话/ }).boundingBox();
    assert.ok(conversationReturnBox && conversationReturnBox.y >= 62 && conversationReturnBox.y < 180, "返回AI任务会话应位于详情页顶部可见区域");
    await capture(page, "04-detail-1440.png");

    await page.getByRole("button", { name: /返回AI任务会话/ }).click();
    assert.match(await page.locator(".conversation-stream").textContent(), /为什么命中这些规则/);
    await page.getByRole("button", { name: "打开风险详情" }).click();
    const detailHeadingBox = await page.getByRole("heading", { name: "风险事项详情", exact: true }).boundingBox();
    assert.ok(detailHeadingBox && detailHeadingBox.y >= 62 && detailHeadingBox.y < 280, "从较长的AI会话进入详情应回到页面顶部");
    await page.locator("#main-view").evaluate((element) => { element.scrollTop = 350; });
    await page.getByRole("button", { name: "关闭AI上下文" }).click();
    assert.ok(Math.abs(await page.locator("#main-view").evaluate((element) => element.scrollTop) - 350) <= 1, "同页关闭上下文面板应保留滚动位置");
    await page.locator("#main-view").evaluate((element) => { element.scrollTop = 0; });
    await page.getByRole("button", { name: /AI上下文/ }).click();

    await page.getByRole("button", { name: "修改后采纳" }).click();
    await page
      .locator('textarea[name="finalRecommendation"]')
      .fill("先锁定34件包装缺口，并由计划主管确认调整方案。");
    await capture(page, "05-modify-modal-1440.png", false);
    await page.getByRole("button", { name: "保存并采纳" }).click();
    await page.locator('[data-semantic="recommendationDecision"]').getByText("修改后采纳").waitFor();
    assert.equal(await page.locator('[data-semantic="caseStatus"]').getByText("待确认").isVisible(), true);
    assert.equal(await page.getByText("AI原建议", { exact: true }).isVisible(), true);

    await page.getByRole("button", { name: "指派责任人" }).click();
    await page.locator('select[name="assignee"]').selectOption({ label: "计划主管 · 林芳" });
    await page.getByRole("button", { name: "确认指派" }).click();
    await page.locator('[data-semantic="caseStatus"]').getByText("处理中").waitFor();
    await capture(page, "06-processing-1440.png");

    await page.getByRole("button", { name: "为什么命中这些规则？" }).click();
    assert.equal(await page.locator(".message.user").count(), 1);

    await page.locator('[data-nav="welcome"]').first().click();
    await page.getByRole("button", { name: /按订单号查询/ }).click();
    await page.getByRole("button", { name: "打开风险详情" }).click();
    assert.equal(await page.locator(".message.user").count(), 0, "new task should clear old chat");

    await page.getByRole("button", { name: /返回风险看板/ }).click();
    await page.getByRole("button", { name: "演示AI降级" }).click();
    await page.getByText("AI-001", { exact: true }).waitFor();
    assert.equal(await page.getByText("AI解释暂时不可用", { exact: true }).first().isVisible(), true);
    assert.match(await page.locator(".metric-grid").textContent(), /风险订单数\s*01/);
    await capture(page, "07-ai-fallback-1440.png");
    await page.getByRole("button", { name: "重试AI" }).click();
    await page.getByText("AI 当前快照简报", { exact: true }).waitFor();
    assert.equal(await page.locator(".error-banner").count(), 0);

    if (screenshotDir) {
      await page.setViewportSize({ width: 1100, height: 800 });
      await capture(page, "08-workbench-1100.png");
      await page.locator(".contract-link").click();
      await page.getByRole("heading", { name: "风险事项详情" }).waitFor();
      await capture(page, "09-detail-1100.png");
    }

    await page.locator('[data-nav="welcome"]').first().click();
    await page.getByRole("button", { name: /未来7天风险/ }).click();
    await page.getByRole("heading", { name: /合同 25DMO00002W-BB 的交付风险分析/ }).waitFor();
    await page.getByRole("button", { name: "查看风险看板" }).click();
    assert.equal(await page.locator("[data-risk-card]").count(), 1);
    assert.equal(await page.getByText("25DMO00002W-BB", { exact: true }).isVisible(), true);
    assert.match(await page.locator(".metric-grid").textContent(), /临近交期风险订单数\s*01/);

    await page.locator('[data-nav="welcome"]').first().click();
    await page.getByRole("button", { name: /待补信息事项/ }).click();
    await page.getByRole("heading", { name: /合同 25DMO00003W-CC 的交付风险分析/ }).waitFor();
    const needsDataAnswer = await page.locator(".analysis-answer").textContent();
    assert.doesNotMatch(needsDataAnswer, /null|undefined|reservedQty|companyReviewDueDate|theoreticalProductionDays/i);
    assert.match(needsDataAnswer, /数据不足|待补/);
    await page.getByRole("button", { name: "查看风险看板" }).click();
    assert.equal(await page.locator("[data-risk-card]").count(), 1);
    assert.equal(await page.getByText("25DMO00003W-CC", { exact: true }).isVisible(), true);

    assert.deepEqual(consoleErrors, []);
    process.stdout.write(
      `${JSON.stringify({
        welcome: true,
        directWorkbench: true,
        scopedWorkbench: true,
        deterministicEvidence: true,
        modifiedAndAccepted: true,
        assignedAndProcessing: true,
        chatIsolation: true,
        aiFallbackAndRetry: true,
        quickTaskScoping: true,
        dataInsufficiencyLanguage: true,
        consoleErrors: 0,
        screenshots: screenshotDir ? 9 : 0,
      })}\n`,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
