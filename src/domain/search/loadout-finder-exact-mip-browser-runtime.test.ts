import assert from "node:assert/strict";
import loadHighs from "highs";
import { test, vi } from "vitest";
import type { Stat } from "../types.ts";
import { createDamageGcdVectorEvaluator } from "./equipped-effects.ts";
import type { ExactMipOptions } from "./loadout-finder-exact-mip.ts";

test("exact MIP dispatches to the browser HiGHS loader when the Node runtime marker is absent", async () => {
  const nodeVersion = Object.getOwnPropertyDescriptor(process.versions, "node")!;
  let browserLoaderCalls = 0;
  vi.resetModules();
  Object.defineProperty(process.versions, "node", { ...nodeVersion, value: undefined });
  vi.doMock("./highs-browser.js", () => ({
    loadBrowserHighs: async () => {
      browserLoaderCalls++;
      // 测试环境没有浏览器 WebAssembly 运行时。先覆盖浏览器分派分支，再复用已安装的 HiGHS 适配器。
      Object.defineProperty(process.versions, "node", nodeVersion);
      return loadHighs();
    },
  }));

  try {
    const { findBestLoadoutExactMip } = await import("./loadout-finder-exact-mip.ts");
    const attributeIds = [-1, 1, 2, 3, 4, 5, 6];
    const indexes = new Map<Stat, number>([
      ["MDMG", 0], ["INT", 1], ["CRT", 2], ["DET", 3], ["DHT", 4], ["SPS", 5], ["TEN", 6],
    ]);
    const equipment = {
      itemId: 1,
      itemLevel: 795,
      key: "browser-fallback-fixture",
      baseParams: [
        { baseParamId: 1, value: 500 },
        { baseParamId: 2, value: 200 },
        { baseParamId: 3, value: 150 },
        { baseParamId: 4, value: 100 },
        { baseParamId: 5, value: 80 },
        { baseParamId: 6, value: 40 },
      ],
      PDMG: 0,
      MDMG: 150,
      DLY: 0,
    };
    const options: ExactMipOptions = {
      job: "RDM",
      jobLevel: 100,
      attributeIds,
      statIndexes: indexes,
      slots: [[equipment]],
      foods: [],
      equipmentAttributeExtractor: (item) => [
        ...item.baseParams,
        { baseParamId: -1, value: item.MDMG },
      ],
      evaluationFunction: createDamageGcdVectorEvaluator("RDM", 100, indexes),
      objective: "damage",
    };

    const result = await findBestLoadoutExactMip(options);

    assert.ok(result);
    assert.equal(result.selection[0]?.itemId, equipment.itemId);
    assert.equal(browserLoaderCalls, 1);
  } finally {
    vi.doUnmock("./highs-browser.js");
    Object.defineProperty(process.versions, "node", nodeVersion);
    vi.resetModules();
  }
});
