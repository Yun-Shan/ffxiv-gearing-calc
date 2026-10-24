import { afterEach, expect, it, vi } from "vitest";
const { loadHighs } = vi.hoisted(() => ({ loadHighs: vi.fn() }));
vi.mock("highs", () => ({ default: loadHighs }));
import { loadBrowserHighs } from "./highs-browser.ts";

afterEach(() => vi.resetAllMocks());

it("initializes HiGHS only when called and resolves the emitted WASM asset URL", async () => {
  expect(loadHighs).not.toHaveBeenCalled();
  const instance = {};
  loadHighs.mockResolvedValueOnce(instance);
  expect(await loadBrowserHighs()).toBe(instance);
  expect(loadHighs.mock.calls[0]![0].locateFile()).toMatch(/highs.*\.wasm/);
});

it("preserves the failure cause without showing compiler instructions to users", async () => {
  const cause = new Error("Aborted. Build with -sASSERTIONS for more info.");
  loadHighs.mockRejectedValueOnce(cause);
  await expect(loadBrowserHighs()).rejects.toMatchObject({
    message: "计算组件加载失败，请重新加载页面后重试。",
    cause,
  });
});
