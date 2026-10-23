import { describe, expect, test } from "vitest";
import type { IntegerDamageFactors } from "../equipped-effects.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import type { JointPreparedJob, JointSearchOptions } from "./joint-types.ts";
import {
  decodeJointSolution,
  validateJointInitialResults,
} from "./joint-results.ts";
import { createJointSolutionHint } from "./joint-solution-hint.ts";

const equipment = (itemId = 10): EquipInfo => ({
  itemId,
  itemLevel: 100,
  key: String(itemId),
  baseParams: [{ baseParamId: 1, value: 50 }],
  PDMG: 0,
  MDMG: 0,
  DLY: 0,
});
const food = (itemId = 20): FoodInfo => ({
  itemId,
  itemLevel: 100,
  key: String(itemId),
  baseParams: [],
});
const baseline: IntegerDamageFactors = {
  weaponDamage: 1,
  mainStat: 100,
  determination: 1,
  tenacity: 1,
  critical: 1,
  directHit: 1,
  gcdCentiseconds: 250,
  traitMultiplier: 1,
};

function fixture(objective: "damage" | "dps" = "damage") {
  const options: Pick<
    JointSearchOptions,
    | "objective"
    | "commonSlots"
    | "equipmentIdentity"
    | "foodIdentity"
    | "sharedFood"
  > = {
    objective,
    commonSlots: ["head"],
    sharedFood: true,
    equipmentIdentity: ({ key }) => key,
    foodIdentity: ({ key }) => key,
  };
  const jobs = [0, 1].map((index) => {
    const job: JointPreparedJob["job"] = {
      id: `job${index}`,
      slotNames: ["head"],
      baseline: { ...baseline },
      options: {
        job: "RDM",
        jobLevel: 100,
        attributeIds: [1],
        statIndexes: new Map(),
        slots: [[equipment()]],
        foods: [food()],
        evaluationFunction: (attributes) => ({
          damage: attributes[0]! * 2,
          gcd: 2,
        }),
      },
    };
    // A minimal deterministic stage contract isolates reconstruction from MIP solving.
    const prepared = {
      model: {
        bounds: ["gear", "food", "main", "gcd", "attribute"].map((name) => ({
          name,
          min: 0,
        })),
        slotVariables: [["gear"]],
        resistanceAllocationVariables: [],
        foodVariables: ["food"],
        finalVariables: ["attribute"],
        ranges: new Map(),
      },
      groups: [
        { name: "main", classes: [{ variable: "main", value: 50 }] },
        { name: "gcd", classes: [{ variable: "gcd", value: 200 }] },
      ],
      factorEvaluator: (attributes: readonly number[]) => ({
        ...baseline,
        mainStat: attributes[0]!,
        gcdCentiseconds: 200,
      }),
    } as unknown as JointPreparedJob["prepared"];
    return { job, originalJob: job, prepared } satisfies JointPreparedJob;
  });
  const columns: Record<string, { Primal: number }> = {};
  for (let index = 0; index < jobs.length; index++) {
    for (const name of ["gear", "food", "main", "gcd"])
      columns[`j${index}_${name}`] = { Primal: 1 };
    columns[`j${index}_attribute`] = { Primal: 50 };
  }
  const statistics = {
    startedAt: performance.now(),
    solverRuns: 2,
    excludedSignatures: 3,
    variables: 10,
    constraints: 5,
  };
  const decode = () => decodeJointSolution(options, jobs, columns, statistics);
  const initial = decode().results;
  const identity = (
    selection: readonly EquipInfo[],
    slot: string,
    jobIndex: number,
  ) => {
    const index = jobs[jobIndex]!.job.slotNames.indexOf(slot);
    return index < 0 ? undefined : selection[index]?.key;
  };
  const validate = () =>
    validateJointInitialResults(options, jobs, initial, identity);
  return { options, jobs, columns, initial, decode, validate, identity };
}

describe("joint result decoding", () => {
  test.each([
    ["damage", 1n, 1n],
    ["dps", 5n, 4n],
  ] as const)(
    "reconstructs exact normalized %s sums from chosen factors",
    (objective, numerator, denominator) => {
      const { decode, validate } = fixture(objective);
      const decoded = decode();
      expect(decoded.numerator * denominator).toBe(
        decoded.denominator * numerator,
      );
      expect(decoded.signature).toEqual([
        "j0_main",
        "j0_gcd",
        "j1_main",
        "j1_gcd",
      ]);
      expect(
        decoded.results.map(({ damage, selection, food: selected }) => [
          damage,
          selection[0]!.itemId,
          selected!.itemId,
        ]),
      ).toEqual([
        [100, 10, 20],
        [100, 10, 20],
      ]);
      expect(decoded.results[0]!.statistics).toMatchObject({
        solverRuns: 2,
        excludedSignatures: 3,
        variables: 10,
        constraints: 5,
        signatureBandProof: false,
      });
      const validated = validate()!;
      expect(validated.numerator * denominator).toBe(
        validated.denominator * numerator,
      );
      expect(validated.results).toHaveLength(2);
    },
  );

  test.each([
    "no-factors",
    "no-evaluation",
    "nonfinite-damage",
    "unselected-factor",
    "wrong-factor",
    "wrong-attribute",
    "above-baseline",
  ] as const)("fails closed for a corrupted solver result: %s", (reason) => {
    const { jobs, columns, decode } = fixture();
    let error: RegExp;
    switch (reason) {
      case "no-factors":
        jobs[0]!.prepared.factorEvaluator = () => undefined;
        error = /结果无法计算/;
        break;
      case "no-evaluation":
        jobs[0]!.job.options.evaluationFunction = () => undefined;
        error = /结果无法计算/;
        break;
      case "nonfinite-damage":
        jobs[0]!.job.options.evaluationFunction = () => ({
          damage: NaN,
          gcd: 2,
        });
        error = /结果无法计算/;
        break;
      case "unselected-factor":
        delete columns.j0_main;
        error = /因子重建不一致.*main/;
        break;
      case "wrong-factor":
        jobs[0]!.prepared.groups[0]!.classes[0]!.value = 51;
        error = /因子重建不一致.*main/;
        break;
      case "wrong-attribute":
        columns.j0_attribute = { Primal: 51 };
        error = /最终属性重建不一致/;
        break;
      case "above-baseline":
        jobs[0]!.job.baseline.mainStat = 49;
        error = /超过已证明单职业基线/;
        break;
    }
    expect(decode).toThrow(error);
  });

  test("supports a no-food model and fills omitted zero columns conservatively", () => {
    const { jobs, columns, decode } = fixture();
    for (const { job, prepared } of jobs) {
      job.options.foods = [];
      prepared.model.foodVariables = [];
    }
    delete columns.j0_food;
    const result = decode();
    expect(
      result.results.every(({ food: selected }) => selected === undefined),
    ).toBe(true);
  });
});

describe("joint initial result validation", () => {
  test("an absent initial solution is not mistaken for a feasible incumbent", () => {
    const { options, jobs, identity } = fixture();
    expect(
      validateJointInitialResults(options, jobs, undefined, identity),
    ).toBeUndefined();
  });

  test.each([
    "job-count",
    "slot-count",
    "foreign-equipment",
    "missing-food",
    "foreign-food",
    "minimum",
    "maximum",
    "no-factors",
    "scalar-gcd",
    "gcd-set",
    "shared-equipment",
    "shared-food",
    "unknown-shared-slot",
    "above-baseline",
  ] as const)("rejects invalid initial results: %s", (reason) => {
    const { options, jobs, initial, validate } = fixture();
    let error: RegExp;
    switch (reason) {
      case "job-count":
        initial.pop();
        error = /职业数不匹配/;
        break;
      case "slot-count":
        initial[0]!.selection = [];
        error = /装备不属于模型候选/;
        break;
      case "foreign-equipment":
        initial[0]!.selection = [equipment(999)];
        error = /装备不属于模型候选/;
        break;
      case "missing-food":
        initial[0]!.food = undefined;
        error = /食物不属于模型候选/;
        break;
      case "foreign-food":
        initial[0]!.food = food(999);
        error = /食物不属于模型候选/;
        break;
      case "minimum":
        jobs[0]!.prepared.model.ranges.set(0, { min: 51 });
        error = /不满足属性约束/;
        break;
      case "maximum":
        jobs[0]!.prepared.model.ranges.set(0, { max: 49 });
        error = /不满足属性约束/;
        break;
      case "no-factors":
        jobs[0]!.prepared.factorEvaluator = () => undefined;
        error = /无法计算整数因子/;
        break;
      case "scalar-gcd":
        jobs[0]!.job.options.constraints = { gcd: 2.01 };
        error = /标量 GCD 约束/;
        break;
      case "gcd-set":
        jobs[0]!.job.options.constraints = { gcdChoices: [2.01, 2.02] };
        error = /GCD 集合/;
        break;
      case "shared-equipment": {
        const alternate = equipment(11);
        jobs[1]!.job.options.slots = [[equipment(), alternate]];
        initial[1]!.selection = [alternate];
        error = /装备不共享/;
        break;
      }
      case "shared-food": {
        const alternate = food(21);
        jobs[1]!.job.options.foods = [food(), alternate];
        initial[1]!.food = alternate;
        error = /食物不共享/;
        break;
      }
      case "unknown-shared-slot":
        options.commonSlots = ["missing"];
        error = /装备不共享/;
        break;
      case "above-baseline":
        jobs[0]!.job.baseline.mainStat = 49;
        error = /超过单职业基线/;
        break;
    }
    expect(validate).toThrow(error);
  });

  test("accepts exact hard-constraint boundaries and no-food sharing", () => {
    const { jobs, initial, validate } = fixture();
    for (let index = 0; index < jobs.length; index++) {
      jobs[index]!.prepared.model.ranges.set(0, { min: 50, max: 50 });
      jobs[index]!.job.options.constraints = { gcd: 2, gcdChoices: [1.99, 2] };
      jobs[index]!.job.options.foods = [];
      initial[index]!.food = undefined;
    }
    expect(validate()).toBeDefined();
  });

  test("rejects two individually admitted copies of the same unique ring", () => {
    const { jobs, initial, options, validate } = fixture();
    options.commonSlots = [];
    const first = {
      ...equipment(10),
      ringSlotIndex: 0 as const,
      isUnique: true,
    };
    const second = {
      ...equipment(10),
      ringSlotIndex: 1 as const,
      isUnique: true,
    };
    jobs[0]!.job.options.slots = [[first], [second]];
    initial[0]!.selection = [first, second];
    expect(validate).toThrow(/重复使用唯一戒指/);
  });
});

describe("joint solution hints", () => {
  function hintFixture() {
    const current = fixture();
    const best = current.validate()!;
    const model = {
      prefix: (job: number, name: string) => `j${job}_${name}`,
      sharedEquipmentDomains: [
        { slot: "head", choices: [], keys: new Set(["10"]) },
      ],
      sharedEquipmentSelectors: new Map([
        ["head", new Map([["10", "shared_head"]])],
      ]),
      sharedFoodSelectors: new Map([["20", "shared_food"]]),
    };
    const hint = (solverRuns = 0) =>
      createJointSolutionHint(
        current.options,
        current.jobs,
        model,
        current.identity,
        best,
        solverRuns,
      );
    return { ...current, best, model, hint };
  }

  test("hints each chosen candidate and its shared physical selectors", () => {
    const { hint } = hintFixture();
    expect([...hint()]).toEqual([
      ["j0_gear", 1],
      ["j0_food", 1],
      ["j1_gear", 1],
      ["j1_food", 1],
      ["shared_head", 1],
      ["shared_food", 1],
    ]);
    expect(hint(1).size).toBe(0);
  });

  test("missing incumbents produce no hints", () => {
    const { options, jobs, model, identity } = hintFixture();
    expect(
      createJointSolutionHint(options, jobs, model, identity, undefined, 0)
        .size,
    ).toBe(0);
  });

  test.each([
    "equipment",
    "food",
    "shared-equipment",
    "unknown-shared-slot",
    "shared-food",
    "missing-food",
  ] as const)(
    "fails explicitly when the hint cannot be mapped: %s",
    (reason) => {
      const { initial, model, hint } = hintFixture();
      let error: RegExp;
      switch (reason) {
        case "equipment":
          initial[0]!.selection = [equipment(999)];
          error = /装备不属于模型候选/;
          break;
        case "food":
          initial[0]!.food = food(999);
          error = /食物不属于模型候选/;
          break;
        case "shared-equipment":
          model.sharedEquipmentSelectors.clear();
          error = /缺少共享装备选择/;
          break;
        case "unknown-shared-slot":
          model.sharedEquipmentDomains[0]!.slot = "missing";
          error = /缺少共享装备选择/;
          break;
        case "shared-food":
          model.sharedFoodSelectors.clear();
          error = /缺少共享食物选择/;
          break;
        case "missing-food":
          initial[0]!.food = undefined;
          error = /缺少共享食物选择/;
          break;
      }
      expect(() => hint()).toThrow(error);
    },
  );

  test("allocation annotations do not change the underlying candidate identity", () => {
    const { initial, options, hint } = hintFixture();
    initial[0]!.selection = [{ ...equipment(), resistanceAllocation: [] }];
    options.equipmentIdentity = (entry) =>
      `${entry.key}:${entry.resistanceAllocation?.length ?? "unallocated"}`;
    expect(hint().get("j0_gear")).toBe(1);
  });
});
