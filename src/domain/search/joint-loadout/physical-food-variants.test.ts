import { describe, expect, test, vi } from "vitest";
import type { ExactMipOptions, ExactMipResult } from "../loadout-finder-exact-mip.ts";
import * as mip from "../loadout-finder-exact-mip.ts";
import type { EquipInfo, FoodInfo } from "../types.ts";
import { equipmentIdentity } from "../equipment-identity.ts";
import { findBestJointLoadoutV3 } from "./coordinator.ts";
import { prepareCandidates } from "./candidate-preparation.ts";
import { makeJobOptions } from "./job-options.ts";
import { createRestrictedSearch } from "./restricted-search.ts";
import { foodCandidateIdentity, foodIdentity, foodsForChoice, pruneSharedFoods } from "./shared-foods.ts";
import { contextFor, equip, food, optionsFor, resultFor, statistics } from "./fixtures.helper.test.ts";
import type { FoodChoice, JobContext, Rational } from "./types.ts";

const compare = (a: Rational, b: Rational) => a.numerator * b.denominator - b.numerator * a.denominator;
const add = (a: Rational, b: Rational): Rational => ({
  numerator: a.numerator * b.denominator + b.numerator * a.denominator,
  denominator: a.denominator * b.denominator,
});
function cartesian<T>(slots: readonly (readonly T[])[]): T[][] {
  return slots.reduce<T[][]>((rows, slot) => rows.flatMap((row) => slot.map((value) => [...row, value])), [[]]);
}

// Complete tiny-domain oracle: construct raw vectors and per-attribute food gains
// directly, then use the canonical job formula and exact normalized fractions.
function candidates(context: JobContext, options: ExactMipOptions = context.job.options) {
  const rows: { result: ExactMipResult; value: Rational; toughness: number }[] = [];
  for (const selection of cartesian(options.slots)) for (const selectedFood of options.foods.length ? options.foods : [undefined]) {
    const attributes = options.attributeIds.map((id) => selection.reduce((total, equipment) =>
      total + equipment.baseParams.filter((param) => param.baseParamId === id).reduce((sum, param) => sum + param.value, 0), 0));
    for (const param of selectedFood?.baseParams ?? []) {
      const index = options.attributeIds.indexOf(param.baseParamId);
      if (index >= 0) attributes[index]! += Math.min(param.maxValue,
        Math.trunc((attributes[index]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7));
    }
    const speed = attributes[options.attributeIds.indexOf(options.speedAttributeId!)]!;
    const toughness = attributes[options.attributeIds.indexOf(options.toughnessAttributeId!)]!;
    if (speed < (options.constraints?.speedMin ?? -Infinity) || speed > (options.constraints?.speedMax ?? Infinity) ||
      toughness < (options.constraints?.toughMin ?? -Infinity)) continue;
    const factors = context.factorEvaluator(attributes)!;
    const product = [factors.weaponDamage, factors.mainStat, factors.determination, factors.tenacity, factors.critical, factors.directHit]
      .reduce((value, factor) => value * BigInt(factor), 1n);
    rows.push({ result: resultFor(context, selection, selectedFood), toughness,
      value: { numerator: product, denominator: options.objective === "dps" ? BigInt(factors.gcdCentiseconds) : 1n } });
  }
  const maximumToughness = Math.max(...rows.map((row) => row.toughness));
  return options.constraints?.maxToughnessMode ? rows.filter((row) => row.toughness === maximumToughness) : rows;
}

function fixture(explicit: boolean, objective: "damage" | "dps", sharedSlot: boolean) {
  const bodies = [equip(10, [0, 0, 600, 0, 0, 0, 0]), equip(11, [0, 0, 0, 600, 0, 100, 0])];
  const contexts = [0, 1].map((job) => {
    const context = contextFor([bodies, [equip(20 + job, [100, 3000, 100, 200, 100, 100, 100])]], ["body", "weapon"], `job-${job}`);
    const variant = (base: number): FoodInfo => ({ ...food(60, 2, 1.1, 500),
      ...(explicit ? { physicalKey: "A" } : {}), key: `A-${base}`,
      baseParams: [{ baseParamId: 2, multiplier: 1.1, maxValue: 500, baseValue: base }] });
    const weak = variant(0);
    const strong = variant(500 + job * 200);
    const middle = { ...food(61, 2, 1.1, 500), baseParams: [{ ...weak.baseParams[0]!, baseValue: 100 }] };
    const privateFood = { ...food(70 + job, 2, 1.1, 500), baseParams: [{ ...weak.baseParams[0]!, baseValue: 2000 }] };
    context.job.options.foods = job === 0 ? [weak, strong, middle, privateFood] : [strong, weak, middle, privateFood];
    context.job.options.objective = objective;
    return context;
  });
  return { contexts, options: { ...optionsFor(contexts), commonSlots: sharedSlot ? ["body"] : [],
    objective, foodStrategy: "shared" as const, strategies: { sharedStateSearch: "on" as const } } };
}

describe("shared physical food candidate domains", () => {
  test("a malformed food is rejected before shared candidates are pruned or baselines are solved", async () => {
    const { contexts, options } = fixture(true, "damage", true);
    const candidate = contexts[1]!.job.options.foods[0]!;
    candidate.baseParams.push({ baseParamId: 999, multiplier: 1, maxValue: 0 }, { baseParamId: 999, multiplier: 1, maxValue: 0 });
    contexts[0]!.job.options.slots = contexts[0]!.job.options.slots.map(() => []);
    await expect(findBestJointLoadoutV3(options)).rejects.toThrow(/食物 60 的属性 999 重复/);
  });

  test.each(cartesian([[false, true], [false, true]]))(
    "all same-key variants match exhaustive normalized damage and DPS (explicit=%s, shared slot=%s)",
    async (explicit, sharedSlot) => {
      for (const objective of ["damage", "dps"] as const) {
        const { contexts, options } = fixture(explicit!, objective, sharedSlot!);
        const rows = contexts.map((context) => candidates(context));
        const baselines = rows.map((domain) => domain.reduce((best, row) => compare(row.value, best.value) > 0n ? row : best));
        let expected: Rational | undefined;
        for (const pair of cartesian(rows)) {
          if (foodIdentity(pair[0]!.result.food!) !== foodIdentity(pair[1]!.result.food!)) continue;
          if (sharedSlot && equipmentIdentity(pair[0]!.result.selection[0]!) !== equipmentIdentity(pair[1]!.result.selection[0]!)) continue;
          const score = pair.reduce((sum, row, index) => add(sum, {
            numerator: row.value.numerator * baselines[index]!.value.denominator,
            denominator: row.value.denominator * baselines[index]!.value.numerator,
          }), { numerator: 0n, denominator: 1n });
          if (expected === undefined || compare(score, expected) > 0n) expected = score;
        }
        const result = await findBestJointLoadoutV3(options);
        expect(result?.proof.complete).toBe(true);
        expect(compare({ numerator: BigInt(result!.value.numerator), denominator: BigInt(result!.value.denominator) }, expected!)).toBe(0n);
        expect(compare(expected!, { numerator: 2n, denominator: 1n })).toBeLessThan(0n);
        for (let index = 0; index < contexts.length; index++) {
          const id = contexts[index]!.job.id;
          expect(result!.optima[id]!.food!.itemId).toBe(70 + index);
          expect(result!.jobResults[id]!.food!.key).toBe(`A-${500 + index * 200}`);
          expect(result!.optima[id]!.damage).toBe(baselines[index]!.result.damage);
        }
      }
    },
  );

  test("group representatives cannot remove a key or narrow its restricted domain", () => {
    const { contexts, options } = fixture(true, "damage", true);
    const prepared = prepareCandidates(options, () => {})!;
    const a = prepared.foodChoices.find((choice) => choice.key === "A")!;
    expect(foodsForChoice(a, contexts[0]!.job.id)).toEqual(contexts[0]!.job.options.foods.slice(0, 2));
    expect(makeJobOptions(prepared.contexts[0]!, new Map(), new Map(), a, undefined, "damage").foods).toHaveLength(2);
    expect(pruneSharedFoods(prepared.foodChoices, prepared.contexts, () => {})).toEqual(prepared.foodChoices);
  });

  test("maximum toughness remains the independent full-domain requirement", async () => {
    const { contexts, options } = fixture(true, "damage", false);
    for (const context of contexts) {
      context.job.options.constraints = { maxToughnessMode: true };
      context.job.options.foods = context.job.options.foods.map((candidate) => ({ ...candidate,
        baseParams: [...candidate.baseParams, { baseParamId: 7, multiplier: 3,
          maxValue: candidate.itemId >= 70 ? 200 : candidate.key.startsWith("A-0") ? 0 : 100 }] }));
    }
    // Only private, non-intersecting foods attain the original maximum.
    expect(await findBestJointLoadoutV3(options)).toBeUndefined();
  });

  test("restricted caches and parent reuse distinguish same physical keys with different effects", async () => {
    const context = contextFor();
    const weak = { ...food(60, 2, 1.1, 500), physicalKey: "A" };
    const strong = { ...weak, baseParams: [{ ...weak.baseParams[0]!, baseValue: 1000 }] };
    context.job.options.foods = [weak, strong];
    context.optimum = resultFor(context, context.optimum.selection, strong);
    const executor = vi.fn(async (tasks: readonly ExactMipOptions[]) => tasks.map((task) =>
      resultFor(context, context.optimum.selection, task.foods[0])));
    const mutable = statistics();
    const search = createRestrictedSearch({ options: { ...optionsFor([context]), baselineExecutor: executor }, contexts: [context],
      commonSlotProjections: new Map(), objective: "damage", mutable, cacheLimit: 8,
      assertWithinBudget: () => {}, remainingTimeLimit: () => undefined, remainingWorkerTimeLimit: () => 1000,
      timeLimitMs: undefined, cancellationRequested: () => false, baselineConcurrency: 1,
      exactScore: () => ({ numerator: 1n, denominator: 1n }), updateBest: () => {}, isAtProvenCeiling: () => false });
    const choice = (candidate: FoodInfo): FoodChoice => ({ key: "A", foods: new Map([[context.job.id, candidate]]) });
    const first = await search.refineSeedJobs(undefined, new Map(), choice(weak), [0], [context.optimum]);
    expect(first[0]!.food).toBe(weak);
    const second = await search.refineSeedJobs(undefined, new Map(), choice(strong), [0], first);
    expect(second[0]!.food).toBe(strong);
    expect(mutable.parentResultReuses).toBe(0);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(search.cache.size).toBe(2);
    expect(foodCandidateIdentity(weak)).not.toBe(foodCandidateIdentity(strong));
  });
});

test("a joint MIP empty result contradicting a legal refined seed fails closed", async () => {
  const bodies: EquipInfo[] = Array.from({ length: 9 }, (_, index) => equip(100 + index, [0, 0, 0, 0, 0, index * 100, 0]));
  const contexts = [0, 1].map((job) => {
    const context = contextFor([bodies, [equip(200 + job * 10, [100, 3000, 400, 300, 200, job * 800, 0]),
      equip(201 + job * 10, [90, 3000, 400, 300, 200, (1 - job) * 800, 0])]], ["body", "weapon"], `job-${job}`);
    context.job.options.constraints = { speedMin: 800, speedMax: 800 };
    context.job.options.objective = "damage";
    return context;
  });
  const joint = vi.spyOn(mip, "findBestJointFactorMip").mockResolvedValue(undefined);
  try {
    await expect(findBestJointLoadoutV3({ ...optionsFor(contexts),
      strategies: { candidateDominance: "off", sharedStateSearch: "off" },
      baselineExecutor: async (tasks) => tasks.map((task) => {
        const domain = candidates(contexts[0]!, task);
        return domain.length ? domain.reduce((best, row) => compare(row.value, best.value) > 0n ? row : best).result : undefined;
      }),
    })).rejects.toThrow(/与已有可行配装矛盾/);
    expect(joint).toHaveBeenCalledTimes(1);
    expect(joint.mock.calls[0]![0].initialResults).toHaveLength(2);
  } finally { joint.mockRestore(); }
});
