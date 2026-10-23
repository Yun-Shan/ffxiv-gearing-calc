import { describe, expect, test } from "vitest";
import {
  applyFood,
  buildRawAttributes,
  rawAttributeMaximums,
} from "./attributes.ts";
import {
  addRational,
  compareRational,
  createExactScorer,
  factorsForResult,
  integerDamageProduct,
  rational,
} from "./score.ts";
import {
  pruneCommonChoices,
  pruneCommonRingChoices,
  pruneInnerSlots,
  canonicalBaselineDamageAttributes,
  dedupeEquivalentBaselineRingCandidates,
} from "./candidate-dominance.ts";
import { equipmentForCommonSlot } from "./shared-equipment.ts";
import { foodIdentity, pruneSharedFoods } from "./shared-foods.ts";
import { makeJobOptions } from "./job-options.ts";
import { markCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import {
  choice,
  contextFor,
  equip,
  food,
  resultFor,
} from "./fixtures.helper.test.ts";

describe("joint module boundary contracts", () => {
  test("food floors after summing equipment and includes the formula base exactly once", () => {
    const original = [19, 100];
    expect(
      applyFood(
        original,
        {
          ...food(1, 1),
          baseParams: [
            { baseParamId: 1, multiplier: 1.1, maxValue: 5, baseValue: 11 },
            { baseParamId: 99, multiplier: 2, maxValue: 999 },
          ],
        },
        new Map([[1, 0]]),
      ),
    ).toEqual([22, 100]);
    expect(original).toEqual([19, 100]);
    expect(applyFood(original, undefined, new Map())).not.toBe(original);
  });

  test("raw attributes include allocation, ignore foreign params, cache extraction and reject unsafe numbers", () => {
    const gear = equip(1, [2, 3], {
      resistanceAllocation: [{ stat: "CRT", baseParamId: 3, value: 7 }],
    });
    const context = contextFor();
    let calls = 0;
    context.job.options.equipmentAttributeExtractor = () => {
      calls++;
      return [
        { baseParamId: 1, value: 4 },
        { baseParamId: 99, value: 900 },
      ];
    };
    expect(buildRawAttributes(context, [gear, gear])).toEqual([
      8, 0, 14, 0, 0, 0, 0,
    ]);
    expect(calls).toBe(1);
    expect(() =>
      buildRawAttributes(context, [equip(2, [Number.MAX_SAFE_INTEGER + 1])]),
    ).not.toThrow(); // extractor supplies the valid vector
    delete context.job.options.equipmentAttributeExtractor;
    expect(() =>
      buildRawAttributes(context, [equip(3, [Number.MAX_SAFE_INTEGER + 1])]),
    ).toThrow(/安全整数/);
  });

  test("raw maximums conservatively include each independent Resistance coordinate and synced caps", () => {
    const item = equip(1, [100, 3000, 1, 2, 3], {
      resistanceWeaponAdjust: {
        stats: ["CRT", "DET", "DHT"],
        maxTotalStats: 20,
        maxEachStat: 15,
        statMaximums: { CRT: 9 },
      },
    });
    const context = contextFor([[item]]);
    context.job.options.statIndexes = new Map(
      [...context.job.options.statIndexes].filter(([stat]) => stat !== "DHT"),
    );
    expect(rawAttributeMaximums(context, () => {})).toEqual([
      100, 3000, 10, 17, 3, 0, 0,
    ]);
  });

  test("rational sums preserve differences below floating precision and normalize signs", () => {
    expect(rational(2n, -4n)).toEqual({ numerator: -1n, denominator: 2n });
    expect(rational(0n, -8n)).toEqual({ numerator: 0n, denominator: 1n });
    expect(() => rational(1n, 0n)).toThrow(/分母/);
    expect(addRational(rational(-1n, 6n), rational(1n, 4n))).toEqual(
      rational(1n, 12n),
    );
    expect(
      addRational(
        { numerator: 1n, denominator: -2n },
        { numerator: 1n, denominator: -4n },
      ),
    ).toEqual(rational(-3n, 4n));
    const large = 10n ** 30n;
    expect(compareRational(rational(large + 1n, large), rational(1n, 1n))).toBe(
      1,
    );
    expect(compareRational(rational(1n, 1n), rational(large + 1n, large))).toBe(
      -1,
    );
    expect(compareRational(rational(3n, 3n), rational(1n, 1n))).toBe(0);
  });

  test("score uses exact factors, skips inactive jobs, and rejects absent or invalid factors", () => {
    const context = contextFor();
    const factors = factorsForResult(context, context.optimum);
    expect(integerDamageProduct(factors)).toBe(context.optimumProduct);
    expect(() => integerDamageProduct({ ...factors, critical: 0 })).toThrow(
      /正安全整数/,
    );
    expect(() => integerDamageProduct({ ...factors, critical: 1.5 })).toThrow(
      /正安全整数/,
    );
    expect(createExactScorer([context], "damage")([context.optimum])).toEqual(
      rational(1n, 1n),
    );
    expect(createExactScorer([context], "dps")([context.optimum])).toEqual(
      rational(1n, 1n),
    );
    context.active = false;
    expect(createExactScorer([context], "dps")([])).toEqual(rational(0n, 1n));
    context.factorEvaluator = () => undefined;
    expect(() => factorsForResult(context, context.optimum)).toThrow(
      /无法计算/,
    );
    expect(() =>
      equipmentForCommonSlot(context, [], "body", new Map()),
    ).toThrow(/缺少装备/);
  });

  test("bounded dominance falls back to the original candidate domain", () => {
    const low = equip(1, [1, 1]);
    const high = equip(2, [2, 2]);
    const context = contextFor([[low, high]]);
    expect(pruneInnerSlots(context)[0]).toEqual([high]);
    expect(
      pruneInnerSlots(context, new Set(), context.solverSlots, {
        maxDominanceChecks: 0,
        maxDurationMs: 1000,
      })[0],
    ).toBe(context.solverSlots[0]);
    expect(
      pruneInnerSlots(context, new Set(), context.solverSlots, {
        maxDominanceChecks: 100,
        maxDurationMs: -1,
      })[0],
    ).toBe(context.solverSlots[0]);
    expect(pruneInnerSlots(context, new Set([0]))[0]).toBe(
      context.solverSlots[0],
    );
  });

  test("ring pruning preserves the only legal unique counterpart in a tiny exhaustive model", () => {
    const a = equip(1, [100, 3000], { ringSlotIndex: 0, isUnique: true });
    const b = equip(2, [100, 2900], { ringSlotIndex: 0, isUnique: true });
    const right = { ...a, ringSlotIndex: 1 as const };
    const context = contextFor([[a, b], [right]], ["ring", "ring2"]);
    const before = context.solverSlots[0]!.filter(
      (left) => left.itemId !== right.itemId,
    );
    const after = pruneInnerSlots(context)[0]!.filter(
      (left) => left.itemId !== right.itemId,
    );
    expect(after).toEqual(before);
    expect(after).toEqual([b]);
    const choices = [choice([context], a), choice([context], b)];
    expect(
      pruneCommonRingChoices(
        choices,
        [choice([context], right)],
        [context],
        () => {},
      ),
    ).toContain(choices[1]);
    expect(
      pruneCommonRingChoices(
        choices,
        [choice([context], { ...right, isUnique: false })],
        [context],
        () => {},
      ),
    ).toEqual(choices);
    expect(
      pruneCommonRingChoices(
        choices,
        [choice([context], { ...right, isUnique: undefined })],
        [context],
        () => {},
      ),
    ).toEqual(choices);
    expect(
      pruneCommonRingChoices(
        choices,
        [choice([context], right)],
        [
          {
            ...context,
            constraints: { speedMax: 1 },
            attributeIndexes: new Map(),
          },
        ],
        () => {},
      ),
    ).toEqual(choices);
  });

  test.each([{ gcd: 2.5 }, { gcdChoices: [2.5] }, { speedMax: 100 }])(
    "speed equality prevents pruning under %j",
    (constraints) => {
      const low = equip(1, [100, 3000, 1, 1, 1, 0]);
      const high = equip(2, [100, 3000, 1, 1, 1, 10]);
      const context = contextFor([[low, high]]);
      context.constraints = constraints;
      expect(pruneInnerSlots(context)[0]).toHaveLength(2);
      const choices = [choice([context], low), choice([context], high)];
      expect(
        pruneCommonChoices("body", choices, [context], new Map(), () => {}),
      ).toEqual(choices);
    },
  );

  test("shared identity ties prefer the baseline, while projected rings bypass scalar dominance", () => {
    const a = equip(1);
    const b = equip(2);
    const context = contextFor([[b, a]]);
    const choices = [choice([context], a), choice([context], b)];
    expect(
      pruneCommonChoices("body", choices, [context], new Map(), () => {}),
    ).toEqual([choices[1]]);
    expect(
      pruneCommonChoices(
        "ring",
        choices,
        [context],
        new Map([
          ["ring", { commonSlot: "ring", slotName: "body", ringIndex: 0 }],
        ]),
        () => {},
      ),
    ).toEqual(choices);
  });

  test("canonical ring equivalence keeps unique item classes and declines incomplete metadata", () => {
    const a = equip(1, undefined, { ringSlotIndex: 0, isUnique: false });
    const b = equip(2, undefined, { ringSlotIndex: 0, isUnique: false });
    const unique = equip(3, undefined, { ringSlotIndex: 0, isUnique: true });
    const context = contextFor(
      [[a, b, unique], [{ ...a, ringSlotIndex: 1 }]],
      ["ring", "ring2"],
    );
    expect(canonicalBaselineDamageAttributes(context)).toBeUndefined();
    markCanonicalEvaluatorCandidateUpperBound(context.job.options);
    expect(canonicalBaselineDamageAttributes(context)).toEqual(
      new Set([0, 1, 2, 3, 4, 5, 6]),
    );
    expect(
      dedupeEquivalentBaselineRingCandidates(context, context.solverSlots)[0],
    ).toEqual([a, unique]);
    const incomplete = [
      [a, { ...b, isUnique: undefined }],
      context.solverSlots[1]!,
    ];
    expect(dedupeEquivalentBaselineRingCandidates(context, incomplete)).toBe(
      incomplete,
    );
    context.job.options.equipmentAttributeExtractor = (item) => item.baseParams;
    expect(canonicalBaselineDamageAttributes(context)).toBeUndefined();
    expect(
      dedupeEquivalentBaselineRingCandidates(context, context.solverSlots),
    ).toBe(context.solverSlots);
  });

  test("shared food pruning checks every reachable integer before domination and retains speed choices", () => {
    const context = contextFor([[equip(1, [100, 10, 0, 0, 0, 10])]]);
    const fast = food(1, 6, 1.2, 5);
    const slow = food(2, 6, 1.1, 10);
    const choiceFor = (value: typeof fast) => ({
      key: foodIdentity(value),
      foods: new Map([[context.job.id, value]]),
    });
    const choices = [choiceFor(slow), choiceFor(fast)];
    expect(pruneSharedFoods(choices, [context], () => {})).toEqual([
      choices[1],
    ]);
    context.constraints = { speedMax: 11 };
    expect(pruneSharedFoods(choices, [context], () => {})).toEqual(choices);
    const equivalent = { ...slow, itemId: 3, physicalKey: "preferred" };
    context.optimum = resultFor(context, context.optimum.selection, equivalent);
    expect(
      pruneSharedFoods(
        [choiceFor(slow), choiceFor(equivalent)],
        [context],
        () => {},
      ),
    ).toEqual([choiceFor(equivalent)]);
  });

  test("shared food dominance must hold for every job, including job-specific physical-food effects", () => {
    const first = contextFor([[equip(1, [100, 10, 0])]]);
    const second = contextFor([[equip(1, [100, 10, 0])]], ["body"], "DRG");
    const choices = [
      {
        key: "A",
        foods: new Map([
          [first.job.id, food(1, 2, 2, 10)],
          [second.job.id, food(1, 2, 1.1, 10)],
        ]),
      },
      {
        key: "B",
        foods: new Map([
          [first.job.id, food(2, 2, 1.1, 10)],
          [second.job.id, food(2, 2, 2, 10)],
        ]),
      },
    ];
    expect(pruneSharedFoods(choices, [first, second], () => {})).toEqual(
      choices,
    );
    const foreign = {
      key: "foreign",
      foods: new Map([[first.job.id, food(3, 99, 2, 999)]]),
    };
    const empty = { key: "none", foods: new Map([[first.job.id, undefined]]) };
    expect(pruneSharedFoods([foreign, empty], [first], () => {})).toEqual([
      foreign,
    ]);
  });

  test.each(["mixed", "duplicate-slot", "invalid-id", "contradictory-unique"])(
    "ring metadata fallback preserves legal identity classes: %s",
    (kind) => {
      const a = equip(1, undefined, { ringSlotIndex: 0, isUnique: true });
      const b = equip(2, [100, 2900], { ringSlotIndex: 0, isUnique: true });
      const opposite = { ...a, ringSlotIndex: 1 as const };
      const slots =
        kind === "mixed"
          ? [[a, { ...b, ringSlotIndex: undefined }], [opposite]]
          : kind === "duplicate-slot"
            ? [[a, b], [{ ...opposite, ringSlotIndex: 0 as const }]]
            : kind === "invalid-id"
              ? [[{ ...a, itemId: 1.5 }, b], [opposite]]
              : [[a, b], [{ ...opposite, isUnique: false }]];
      const context = contextFor(slots, ["ring", "ring2"]);
      expect(pruneInnerSlots(context)[0]).toEqual(slots[0]);
      markCanonicalEvaluatorCandidateUpperBound(context.job.options);
      if (kind !== "contradictory-unique")
        expect(dedupeEquivalentBaselineRingCandidates(context, slots)).toBe(
          slots,
        );
    },
  );

  test("ring pruning budget exhaustion and unknown shared metadata preserve the complete domain", () => {
    const a = equip(1, undefined, { ringSlotIndex: 0, isUnique: false });
    const b = equip(2, [100, 2900], { ringSlotIndex: 0, isUnique: false });
    const context = contextFor(
      [[a, b], [{ ...a, ringSlotIndex: 1 }]],
      ["ring", "ring2"],
    );
    expect(
      pruneInnerSlots(context, new Set(), context.solverSlots, {
        maxDominanceChecks: 0,
        maxDurationMs: 1000,
      })[0],
    ).toBe(context.solverSlots[0]);
    const values = [choice([context], a), choice([context], b)];
    const missing = { key: "missing", equipments: new Map() };
    expect(
      pruneCommonRingChoices(values, [missing], [context], () => {}),
    ).toEqual(values);
    expect(
      pruneCommonRingChoices(
        values,
        [choice([context], { ...a, PDMG: -1 })],
        [context],
        () => {},
      ),
    ).toEqual(values);
  });

  test("restricted options keep the global maximum toughness and the tightest budget", () => {
    const context = contextFor();
    context.constraints = { maxToughnessMode: true, toughMin: 80 };
    expect(() =>
      makeJobOptions(
        context,
        new Map(),
        new Map(),
        undefined,
        undefined,
        "damage",
      ),
    ).toThrow(/没有返回最大值/);
    context.optimum.maximumToughness = 100;
    context.job.options.maxSearchMs = 25;
    const options = makeJobOptions(
      context,
      new Map(),
      new Map(),
      { key: "no-food", foods: new Map() },
      50,
      "dps",
    );
    expect(options.constraints).toEqual({
      maxToughnessMode: false,
      toughMin: 100,
    });
    expect(options.maxSearchMs).toBe(25);
    expect(options.foods).toEqual([]);
    expect(context.constraints).toEqual({
      maxToughnessMode: true,
      toughMin: 80,
    });
  });
});
