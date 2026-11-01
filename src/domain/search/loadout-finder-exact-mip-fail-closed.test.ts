import assert from "node:assert/strict";
import { test, vi } from "vitest";

const solverMode = vi.hoisted(() => ({
  current: "status" as "status" | "fractional" | "invalid-row" | "infeasible",
}));

vi.mock("highs", () => {
  let columnNames: string[] = [];
  let numRows = 0;
  const optionValues = new Map<string, string | number | boolean>();
  const rawAttributes = [150, 500, 200, 150, 100, 80, 40];
  const metadata = () => ({ status: 0, warnings: [] as string[] });
  const native = {
    options: {
      set: (nameOrValues: string | Readonly<Record<string, string | number | boolean>>, value?: string | number | boolean) => {
        const entries = typeof nameOrValues === "string" ? [[nameOrValues, value] as const] : Object.entries(nameOrValues);
        for (const [name, setting] of entries) {
          if (setting === undefined || (typeof setting === "number" && !Number.isFinite(setting))) {
            throw new Error(`Invalid mock option: ${name}`);
          }
          optionValues.set(name, setting);
        }
        return metadata();
      },
      get: (name: string) => {
        if (!optionValues.has(name)) throw new Error(`Unknown mock option: ${name}`);
        return optionValues.get(name)!;
      },
      read: (text: string) => {
        if (text !== "time_limit = inf\n") throw new Error("Unexpected mock option-file text");
        optionValues.set("time_limit", Infinity);
        return metadata();
      },
    },
    readModel: (input: { format: string; data: string }) => {
      if (input.format !== "lp" || optionValues.get("small_matrix_value") !== 1e-12) {
        throw new Error("Mock LP import requires small_matrix_value = 1e-12 first");
      }
      // Discover the complete imported column set; lookup must never create a
      // column, including when equality preparation removes an original alias.
      columnNames = [...input.data.matchAll(/^\s*\S+ <= (\S+) <= \S+$/gm)].map((match) => match[1]!);
      const rowText = input.data.slice(input.data.indexOf("Subject To\n") + "Subject To\n".length,
        input.data.indexOf("Bounds\n"));
      numRows = [...rowText.matchAll(/^\s*\S+:/gm)].length;
      return metadata();
    },
    getColByName: (name: string) => columnNames.indexOf(name),
    getColName: (index: number) => columnNames[index]!,
    getDimensions: () => ({ numCols: columnNames.length, numRows }),
    info: { get: (name: string) => {
      if (name !== "primal_solution_status") throw new Error(`Unknown mock info: ${name}`);
      return solverMode.current === "fractional" || solverMode.current === "invalid-row" ? 2 : 0;
    } },
    setSolution: (solution: { indices: number[]; values: number[] }) => {
      if (solution.indices.length !== solution.values.length || new Set(solution.indices).size !== solution.indices.length ||
          solution.indices.some((index) => !Number.isInteger(index) || index < 0 || index >= columnNames.length) ||
          solution.values.some((value) => !Number.isFinite(value))) {
        throw new Error("Invalid mock sparse solution");
      }
      return metadata();
    },
    run: () => ({ ...metadata(), modelStatus: solverMode.current === "infeasible" ? 8 : solverMode.current === "status" ? 99 : 7 }),
    getModelStatus: () => solverMode.current === "infeasible" ? 8 : solverMode.current === "status" ? 99 : 7,
    getSolution: () => ({
      colValue: Float64Array.from(columnNames, (name) => {
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
        logging: 0,
        simplexInterrupt: 1,
        ipmInterrupt: 2,
        mipSolution: 3,
        mipImprovingSolution: 4,
        mipLogging: 5,
        mipInterrupt: 6,
        mipCutPool: 7,
        mipUserSolution: 9,
      },
      status: { error: -1, ok: 0, warning: 1 },
      modelStatus: { optimal: 7, infeasible: 8 },
      solutionStatus: { none: 0, infeasible: 1, feasible: 2 },
    },
    withModel: (use: (solver: typeof native) => unknown) => {
      columnNames = [];
      numRows = 0;
      optionValues.clear();
      optionValues.set("small_matrix_value", 1e-9);
      optionValues.set("time_limit", Infinity);
      return use(native);
    },
  };
  return { default: async () => highs };
});

import { findBestLoadoutExactMip } from "./loadout-finder-exact-mip.ts";
import type { ExactMipOptions } from "./loadout-finder-exact-mip.ts";
import type { Stat } from "../types.ts";

const attributeIds = [-1, 1, 2, 3, 4, 5, 6];
test.each(["clanIndex", "objective"])("requires explicit %s before solving", async (field) => {
  await assert.rejects(findBestLoadoutExactMip({ ...options, [field]: undefined } as unknown as ExactMipOptions));
});

const options: ExactMipOptions = {
  clanIndex: 0,
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
  await assert.rejects(findBestLoadoutExactMip(options), /不可行状态与原完整整数模型的可行提示矛盾/);
  assert.equal(await findBestLoadoutExactMip({ ...options, strategies: { feasibleSeeds: "off" } }), undefined);
  assert.equal(
    await findBestLoadoutExactMip({
      ...options,
      strategies: { feasibleSeeds: "off" },
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
