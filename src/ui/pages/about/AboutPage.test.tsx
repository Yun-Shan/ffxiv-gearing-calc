// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { AboutPage } from "./AboutPage";
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function normalizedText(element: Element): string {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

describe("关于页", () => {
  it("列出本项目依赖的社区项目", () => {
    const host = document.createElement("div"),
      root = createRoot(host);
    act(() => root.render(<AboutPage />));

    expect(host.querySelector("h1")?.textContent).toBe("关于自动配装器");
    expect(host.querySelector("#about-project")?.textContent).toBe("自动配装器");
    expect(host.querySelector("#about-community")?.textContent).toBe("本项目依赖的社区项目");

    const links = [
      ...host.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'),
    ];
    expect(links.map(normalizedText)).toEqual([
      "Asvel / ffxiv-gearing",
      "MIT License",
      "thewakingsands/xivapi-v2",
      "Lumina",
      "EXDSchema",
      "mcp-ffxiv-lumina",
    ]);
    expect(links.map((link) => link.href)).toEqual([
      "https://github.com/Asvel/ffxiv-gearing",
      "https://github.com/Asvel/ffxiv-gearing#license",
      "https://github.com/thewakingsands/xivapi-v2",
      "https://github.com/NotAdam/Lumina",
      "https://github.com/xivdev/EXDSchema",
      "https://github.com/MelkyWay/mcp-ffxiv-lumina",
    ]);
    expect(links.every((link) => link.rel.includes("noreferrer"))).toBe(true);

    const cards = [...host.querySelectorAll("li")].filter(
      (item) => item.querySelector("a") !== null,
    );
    expect(cards).toHaveLength(3);
    const cardOf = (href: string) =>
      host.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!.closest("li")!;
    expect(cardOf("https://github.com/NotAdam/Lumina")).toBe(
      cardOf("https://github.com/xivdev/EXDSchema"),
    );
    expect(cardOf("https://github.com/NotAdam/Lumina")).toBe(
      cardOf("https://github.com/MelkyWay/mcp-ffxiv-lumina"),
    );

    const text = normalizedText(host);
    for (const keyword of [
      "通过 Lumina 读取",
      "装备与职业图标",
      "社区解包项目",
      "游戏内容数据",
      "数据表字段定义",
    ]) {
      expect(text).toContain(keyword);
    }
    expect(text).not.toContain("配装分享格式");
    expect(text).not.toContain("数据经 MCP 服务查询");

    act(() => root.unmount());
  });
});
