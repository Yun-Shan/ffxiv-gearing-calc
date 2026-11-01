import { afterEach, describe, expect, test, vi } from "vitest";
import { findBestJointLoadoutV3 } from "./coordinator.ts";
import { contextFor, equip, food, optionsFor } from "./fixtures.helper.test.ts";
import * as statistics from "./statistics.ts";
import type { JobContext, JointLoadoutV3Options } from "./types.ts";

afterEach(() => vi.restoreAllMocks());

function singleJobOptions(context: JobContext): JointLoadoutV3Options {
  return {
    ...optionsFor([context]),
    commonSlots: [],
    foodStrategy: "independent",
    strategies: {
      candidateDominance: "off",
      sharedStateSearch: "off",
      restrictedResultReuse: "on",
    },
    baselineExecutor: async () => [context.optimum],
  };
}

describe("联合搜索协调器的截止与取消边界", () => {
  test("共享候选交集为空时，在候选准备后的截止检查抛出超时", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const first = contextFor([[equip(1)]], ["body"], "SAM");
    const second = contextFor([[equip(1)]], ["body"], "MCH");
    first.job.options.foods = [{ ...food(1, 2), physicalKey: "A" }];
    second.job.options.foods = [{ ...food(2, 2), get physicalKey() { now = 1; return "B"; } }];

    await expect(findBestJointLoadoutV3({
      ...optionsFor([first, second]),
      foodStrategy: "shared",
      maxSearchMs: 1,
      strategies: { candidateDominance: "off" },
    })).rejects.toThrow(/超过 1ms.*候选准备/);
  });

  test("结果指标与证明组装后仍检查取消，并让取消先于同时到期的截止", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const context = contextFor([[equip(1)]]);
    const snapshot = statistics.statisticsSnapshot;
    vi.spyOn(statistics, "statisticsSnapshot").mockImplementation((...args) => {
      const result = snapshot(...args);
      now = 1;
      return result;
    });

    await expect(findBestJointLoadoutV3({
      ...singleJobOptions(context),
      maxSearchMs: 1,
      isCancelled: () => now >= 1,
    })).rejects.toThrow("搜索已取消");
  });
});
