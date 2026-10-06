// 使用说明
// 1. 在 Playwright MCP 控制的浏览器中登录 Penpot，并打开目标设计文件。
// 2. 在 Penpot MCP 中查询目标页面和图层。页面信息使用：
//    return { id: penpot.currentPage.id, name: penpot.currentPage.name };
//    按图层名称查询完整层级（图层名称重复时，请在 findShape 条件中补充父级条件）：
//    const target = penpotUtils.findShape(s => s.name === "目标图层名", penpot.root);
//    if (!target) throw new Error("未找到目标图层");
//    const path = [];
//    for (let node = target; node && node !== penpot.root; node = node.parent) {
//      path.unshift({ id: node.id, name: node.name, type: node.type });
//    }
//    return { page: { id: penpot.currentPage.id, name: penpot.currentPage.name }, path };
// 3. 将 MCP 返回的 page 填入 targetPage，将 path 填入 targetLayerPath；不要包含 Root Frame。
// 4. 通过 Playwright MCP 的 browser_run_code_unsafe 运行本文件，例如：
//    { filename: ".agents/penpot-tailwind-html-once.template.js" }
//    脚本会切换到目标页面，必要时打开 Tailwind HTML 插件，逐层展开并选中图层，
//    等待 1 秒后直接读取插件中的 HTML，不会点击复制按钮。
(async (page) => {
  const targetPage = {
    id: "",
    name: "",
  };
  const targetLayerPath = [];
  const pluginFrameMarker = "grafikart.github.io/penpot-plugins/tailwind-html";

  if (!targetPage.id || !targetPage.name) {
    throw new Error("请先填写 Penpot MCP 返回的目标页面 ID 和名称。");
  }
  if (targetLayerPath.length === 0) {
    throw new Error("请先填写 Penpot MCP 返回的目标图层层级路径。");
  }

  if (!page.url().startsWith("https://design.penpot.app/")) {
    throw new Error(`Expected a logged-in Penpot page; current URL is ${page.url()}`);
  }

  const pageRow = page.locator(`[data-testid="page-${targetPage.id}"]`);
  await pageRow.waitFor({ state: "visible", timeout: 10000 });
  const pageName = (await pageRow.locator('[data-testid="page-name"]').innerText()).trim();
  if (pageName !== targetPage.name) {
    throw new Error(`Penpot page mismatch for ${targetPage.id}: ${pageName}`);
  }

  let switchedPage = false;
  const pageIdFromUrl = () => {
    const hashQuery = new URL(page.url()).hash.split("?")[1] ?? "";
    return new URLSearchParams(hashQuery).get("page-id");
  };
  if (pageIdFromUrl() !== targetPage.id) {
    await pageRow.click();
    switchedPage = true;
    await page.waitForFunction(
      (id) => new URLSearchParams(location.hash.split("?")[1] ?? "").get("page-id") === id,
      targetPage.id,
      { timeout: 10000 },
    );
  }

  const findPluginFrame = () =>
    page.frames().find((frame) => frame.url().includes(pluginFrameMarker));

  let frame = findPluginFrame();
  let openedPlugin = false;

  if (!frame) {
    const pluginTitle = page.getByText("Tailwind HTML", { exact: true });
    const titleVisible = await pluginTitle.isVisible().catch(() => false);

    if (!titleVisible) {
      await page.getByRole("button", { name: /插件/ }).click();
      await pluginTitle.waitFor({ state: "visible", timeout: 10000 });
    }

    const pluginCard = pluginTitle.locator(
      "xpath=ancestor::*[.//button[normalize-space()='打开']][1]",
    );
    await pluginCard.getByRole("button", { name: "打开" }).click();
    openedPlugin = true;

    for (let attempt = 0; attempt < 60 && !frame; attempt += 1) {
      await page.waitForTimeout(250);
      frame = findPluginFrame();
    }
  }

  if (!frame) {
    throw new Error("Tailwind HTML plugin iframe did not appear after opening the plugin.");
  }

  for (const ancestor of targetLayerPath.slice(0, -1)) {
    const row = page.locator(
      `[data-testid="layer-row"][id="${ancestor.id}"]`,
    );
    await row.waitFor({ state: "visible", timeout: 10000 });
    const name = (await row.locator('[id^="layer-name-"]').innerText()).trim();
    if (name !== ancestor.name) {
      throw new Error(`Penpot hierarchy mismatch for ${ancestor.id}: ${name}`);
    }

    if ((await row.locator('[class*="__is-parent"]').count()) > 0) {
      const toggle = row.getByTestId("toggle-content");
      const expanded = await toggle.evaluate((element) =>
        element.className.includes("__inverse"),
      );
      if (!expanded) await toggle.click();
    }
  }

  const target = targetLayerPath[targetLayerPath.length - 1];
  const layer = page.locator(
    `[data-testid="layer-row"][id="${target.id}"]`,
  );
  await layer.waitFor({ state: "visible", timeout: 10000 });
  const layerName = (await layer.locator('[id^="layer-name-"]').innerText()).trim();
  if (layerName !== target.name) {
    throw new Error(`Penpot hierarchy mismatch for ${target.id}: ${layerName}`);
  }

  if ((await layer.getAttribute("aria-checked")) !== "true") {
    await layer.click();
  }

  await frame.locator("body").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(1000);

  let html = "";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    html = (await frame.locator("body").innerText()).trim();
    if (html.startsWith("<")) break;
    await page.waitForTimeout(250);
  }
  if (!html.startsWith("<")) {
    throw new Error("The Tailwind HTML plugin did not produce HTML for the selected layer.");
  }

  return {
    targetPage,
    activePageId: pageIdFromUrl(),
    switchedPage,
    targetLayerPath,
    selected: (await layer.getAttribute("aria-checked")) === "true",
    openedPlugin,
    readDirectlyFromPlugin: true,
    html,
  };
})
