import assert from "node:assert/strict";
import { test, vi } from "vitest";

const solverMode = vi.hoisted(() => ({
  current: "status" as "status" | "fractional" | "invalid-row" | "infeasible",
}));

vi.mock("highs", () => {
  const columnNames: string[] = [];
  const columnIndexes = new Map<string, number>();
  const rawAttributes = [150, 500, 200, 150, 100, 80, 40];
  const native = {
    options: { set: () => undefined },
    getColByName: (name: string) => {
      let index = columnIndexes.get(name);
      if (index === undefined) {
        index = columnNames.length;
        columnNames.push(name);
        columnIndexes.set(name, index);
      }
      return index;
    },
    setSolution: () => undefined,
    run: () => undefined,
    getModelStatus: () => solverMode.current === "infeasible" ? 2 : solverMode.current === "status" ? 99 : 1,
    getSolution: () => ({
      colValue: columnNames.map((name) => {
        if (solverMode.current === "fractional") return 0.5;
        const attribute = /^(?:raw|final)_(\d+)$/.exec(name);
        if (attribute !== null) return rawAttributes[Number(attribute[1])]!;
        if (name === "weapon_relative") return 150;
        return 0;
      }),
    }),
    getObjectiveValue: () => 0,
  };
  const highs = {
    constants: {
      callbackType: {
        mipImprovingSolution: 4,
        mipLogging: 5,
        mipInterrupt: 6,
      },
      modelStatus: { optimal: 1, infeasible: 2 },
    },
    withModel: (
      _model: unknown,
      run: (solver: typeof native) => unknown,
    ) => run(native),
    solve: () => ({ Status: "状态代码 99", Columns: {}, ObjectiveValue: 0 }),
  };
  return { default: async () => highs };
});

import { findBestLoadoutExactMip } from "./loadout-finder-exact-mip.ts";
import type { ExactMipOptions } from "./loadout-finder-exact-mip.ts";
import type { Stat } from "../types.ts";

const attributeIds = [-1, 1, 2, 3, 4, 5, 6];
const options: ExactMipOptions = {
  job: "RDM",
  jobLevel: 100,
  attributeIds,
  statIndexes: new Map<Stat, number>([
    ["MDMG", 0],
    ["INT", 1],
    ["CRT", 2],
    ["DET", 3],
    ["DHT", 4],
    ["SPS", 5],
    ["TEN", 6],
  ]),
  slots: [[{
    itemId: 1,
    itemLevel: 795,
    key: "fixture",
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
  }]],
  foods: [],
  equipmentAttributeExtractor: (equipment) => [
    ...equipment.baseParams,
    { baseParamId: -1, value: equipment.MDMG },
  ],
  evaluationFunction: () => ({ damage: 100, gcd: 2.5 }),
  objective: "damage",
};

test("exact MIP fails closed on solver status, fractional columns, and invalid integer rows", async () => {
  solverMode.current = "status";
  await assert.rejects(
    findBestLoadoutExactMip(options),
    /精确 MIP 搜索未证明最优：状态代码 99/,
  );

  solverMode.current = "fractional";
  await assert.rejects(
    findBestLoadoutExactMip(options),
    /不是可靠整数/,
  );

  solverMode.current = "invalid-row";
  await assert.rejects(
    findBestLoadoutExactMip(options),
    /不满足整数模型行 slot_0/,
  );
});

test("exact MIP returns no result for solver-proven infeasibility and rejects an unproved max-TEN phase", async () => {
  solverMode.current = "infeasible";
  assert.equal(await findBestLoadoutExactMip(options), undefined);
  assert.equal(
    await findBestLoadoutExactMip({
      ...options,
      toughnessAttributeId: 6,
      constraints: { maxToughnessMode: true },
    }),
    undefined,
  );

  solverMode.current = "status";
  await assert.rejects(
    findBestLoadoutExactMip({
      ...options,
      toughnessAttributeId: 6,
      constraints: { maxToughnessMode: true },
    }),
    /最高坚韧阶段未证明最优：状态代码 99/,
  );
});
