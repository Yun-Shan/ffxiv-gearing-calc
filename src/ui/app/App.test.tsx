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
      "关于配装工坊",
    );
    expect(currentNav()).toBe("关于");

    clickNav("单职业搜索");
    await testSupport.settleApp();
    expect(testSupport.host.querySelector("h1")?.textContent).toBe("选择职业");
    expect(currentNav()).toBe("单职业搜索");
  });
});
