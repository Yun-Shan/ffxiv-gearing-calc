// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import * as testSupport from "../../test-utils/workbench.helper.test";
import { normalizedText } from "../../test-utils/workbench.helper.test";

function navLabels(): string[] {
  return [
    ...testSupport.host.querySelectorAll('nav[aria-label="主导航"] a'),
  ].map((link) => normalizedText(link));
}

function clickNav(label: string): void {
  const link = [
    ...testSupport.host.querySelectorAll<HTMLAnchorElement>(
      'nav[aria-label="主导航"] a',
    ),
  ].find((item) => normalizedText(item) === label);
  if (!link) throw new Error(`找不到导航「${label}」`);
  act(() => link.click());
}

function currentNav(): string | undefined {
  const link = testSupport.host.querySelector<HTMLAnchorElement>(
    'nav[aria-label="主导航"] a[aria-current="page"]',
  );
  return link ? normalizedText(link) : undefined;
}

function breadcrumbItems(): string[] {
  return [
    ...testSupport.host.querySelectorAll('nav[aria-label="面包屑"] li'),
  ].map((item) => normalizedText(item));
}

function clickLink(selector: string): void {
  const link = testSupport.host.querySelector<HTMLAnchorElement>(selector);
  if (!link) throw new Error(`找不到链接「${selector}」`);
  act(() => link.click());
}

function clickBodyButton(label: string): void {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => normalizedText(item) === label);
  if (!button) throw new Error(`找不到按钮「${label}」`);
  act(() => button.click());
}

describe("应用导航", () => {
  it("提供常见问题与关于入口，并按路由切换页面", async () => {
    expect(navLabels()).toEqual(["单职业搜索", "实验室", "常见问题", "关于"]);
    expect(currentNav()).toBe("单职业搜索");

    clickNav("常见问题");
    await testSupport.settleApp();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe("常见问题");
    expect(currentNav()).toBe("常见问题");

    clickNav("关于");
    await testSupport.settleApp();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe(
      "关于自动配装器",
    );
    expect(currentNav()).toBe("关于");

    clickNav("单职业搜索");
    await testSupport.settleApp();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe("选择职业");
    expect(currentNav()).toBe("单职业搜索");
  });

  it("每个页面都渲染同一份面包屑路径", async () => {
    expect(breadcrumbItems()).toEqual(["单职业搜索"]);

    clickNav("实验室");
    await testSupport.settleApp();
    expect(breadcrumbItems()).toEqual(["实验室"]);

    clickLink('a[href="/joint"]');
    await testSupport.settleApp();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe(
      "选择实验性工具",
    );
    expect(document.body.textContent).toContain(
      "联合搜索暂不支持职业优先级设置",
    );
    clickBodyButton("继续前往");
    await testSupport.settleApp();
    expect(breadcrumbItems()).toEqual(["实验室", "多职业联合搜索"]);

    clickNav("实验室");
    await testSupport.settleApp();
    clickLink('a[href="/gear-comparison"]');
    await testSupport.settleApp();
    expect(breadcrumbItems()).toEqual(["实验室", "装备对比"]);

    clickNav("常见问题");
    await testSupport.settleApp();
    expect(breadcrumbItems()).toEqual(["常见问题"]);

    clickNav("关于");
    await testSupport.settleApp();
    expect(breadcrumbItems()).toEqual(["关于"]);

    expect(
      testSupport.host.querySelectorAll('nav[aria-label="面包屑"]'),
    ).toHaveLength(1);
  });

  it("实验室卡片需确认警告后才进入对应页面", async () => {
    clickNav("实验室");
    await testSupport.settleApp();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe(
      "选择实验性工具",
    );

    clickLink('a[href="/joint"]');
    await testSupport.settleApp();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe(
      "选择实验性工具",
    );
    expect(document.body.textContent).toContain(
      "非共享槽位的唯一装备可能被多个职业同时选用",
    );

    clickBodyButton("取消");
    await testSupport.settleApp();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe(
      "选择实验性工具",
    );
    expect(breadcrumbItems()).toEqual(["实验室"]);
  });
});
