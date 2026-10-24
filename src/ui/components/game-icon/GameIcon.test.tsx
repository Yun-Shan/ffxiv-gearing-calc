// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { foods, gameData, gears, jobIds } from "@/domain";
import { GameIcon } from "./GameIcon";

afterEach(() => vi.unstubAllGlobals());

describe("GameIcon", () => {
  it("resolves every equipment and food item from its item ID", () => {
    for (const item of [...gears, ...foods]) {
      const markup = renderToStaticMarkup(<GameIcon itemId={item.id} />);
      const file = String(item.icon).padStart(6, "0");
      const folder = String(Math.floor(item.icon / 1000) * 1000).padStart(
        6,
        "0",
      );
      expect(markup).toContain(`ui/icon/${folder}/${file}.tex`);
      expect(markup).toContain('crossorigin="anonymous"');
    }
  });

  it("resolves each job's numeric row ID plus 62100 and accepts a style class", () => {
    for (const jobId of jobIds) {
      const markup = renderToStaticMarkup(
        <GameIcon jobId={jobId} className="custom-icon" />,
      );
      expect(markup).toContain(
        `ui/icon/062000/0${gameData.jobs[jobId].id + 62100}.tex`,
      );
      expect(markup).toContain('crossorigin="anonymous"');
      expect(markup).toContain("custom-icon");
    }
  });

  it("uses a styled placeholder when item metadata is missing", () => {
    for (const itemId of [undefined, -1]) {
      const markup = renderToStaticMarkup(
        <GameIcon itemId={itemId} className="custom-icon" />,
      );
      expect(markup).not.toContain("<img");
      expect(markup).toContain("缺少图标资料");
      expect(markup).toContain("custom-icon");
    }
  });

  it("falls back after an image error and retries when its ID changes", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      act(() => root.render(<GameIcon jobId="PLD" className="custom-icon" />));
      act(() => host.querySelector("img")!.dispatchEvent(new Event("error")));
      expect(host.querySelector("img")).toBeNull();
      expect(host.querySelector("span")?.title).toBe("图标加载失败");
      expect(host.querySelector("span")?.className).toContain("custom-icon");

      act(() => root.render(<GameIcon jobId="WAR" className="custom-icon" />));
      expect(host.querySelector("img")?.src).toContain("062121.tex");
      expect(host.querySelector("img")?.crossOrigin).toBe("anonymous");
    } finally {
      act(() => root.unmount());
    }
  });
});
