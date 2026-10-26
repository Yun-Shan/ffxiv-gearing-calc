import { describe, expect, test } from "vitest";
import { createSeedResults } from "./warm-start.ts";
import { buildRawAttributes } from "./attributes.ts";
import type { JobContext, JointLoadoutV3Options } from "./types.ts";
import type { SharedSlotProjection } from "../types.ts";
import {
  choice,
  contextFor,
  equip,
  optionsFor,
} from "./fixtures.helper.test.ts";
import { equipmentIdentity } from "../equipment-identity.ts";

function seedFor(
  context: JobContext,
  overrides: Partial<JointLoadoutV3Options> = {},
  projections = new Map<string, SharedSlotProjection>(),
) {
  return createSeedResults({
    options: { ...optionsFor([context]), ...overrides },
    contexts: [context],
    commonSlotProjections: projections,
  });
}

describe("seed feasibility and shared-choice reconstruction", () => {
  test("reconstructs shared choices and preserves the original private choices", () => {
    const originalShared = equip(1, [100, 3000, 400]);
    const projectedShared = equip(2, [100, 3000, 200]);
    const privateOriginal = equip(3, [0, 0, 0], { variantKey: "empty" });
    const privateAlternative = equip(3, [0, 0, 200], { variantKey: "critical-meld" });
    const context = contextFor(
      [[originalShared, projectedShared], [privateOriginal, privateAlternative]],
      ["body", "head"],
    );
    const originalSelection = [...context.optimum.selection];
    const seed = seedFor(context)(
      new Map([["body", choice([context], projectedShared)]]),
      undefined,
    )!;
    expect(seed[0]!.selection).toEqual([projectedShared, privateOriginal]);
    const attributes = buildRawAttributes(context, seed[0]!.selection);
    expect(attributes).toEqual([100, 3000, 200, 0, 0, 0, 0]);
    expect(seed[0]!.damage).toBe(context.job.options.evaluationFunction(attributes)!.damage);
    expect(context.optimum.selection).toEqual(originalSelection);
  });

  test.each([
    { gcd: 9 },
    { gcdChoices: [9] },
    { speedMin: 101 },
    { speedMax: 99 },
    { toughMin: 1 },
    { toughnessMinPercent: 1 },
    { maxToughnessMode: true },
  ])("rejects a reconstructed seed that violates %j", (constraints) => {
    const context = contextFor();
    context.constraints = constraints;
    expect(seedFor(context)(new Map(), undefined)).toBeUndefined();
  });

  test("converted mitigation and global maximum toughness are checked against final food attributes", () => {
    const context = contextFor([
      [equip(1, [100, 3000, 400, 300, 200, 100, 10])],
    ]);
    context.constraints = {
      toughnessMinPercent: 10,
      maxToughnessMode: true,
      toughMin: 11,
    };
    context.job.options.toughnessPercentToMinimum = () => 12;
    context.optimum.maximumToughness = 13;
    const toughFood = {
      itemId: 1,
      itemLevel: 795,
      key: "tough",
      baseParams: [{ baseParamId: 7, multiplier: 1.3, maxValue: 3 }],
    };
    expect(
      seedFor(context)(new Map(), {
        key: "tough",
        foods: new Map([[context.job.id, toughFood]]),
      })![0]!.food,
    ).toBe(toughFood);
    context.optimum.maximumToughness = 14;
    expect(
      seedFor(context)(new Map(), {
        key: "tough",
        foods: new Map([[context.job.id, toughFood]]),
      }),
    ).toBeUndefined();
  });

  test.each([
    "speed-unmapped",
    "speed-absent",
    "tough-unmapped",
    "tough-absent",
  ])("rejects incomplete constraint metadata: %s", (kind) => {
    const context = contextFor();
    context.constraints = kind.startsWith("speed")
      ? { speedMin: 0 }
      : { toughMin: 0 };
    if (kind === "speed-unmapped") context.job.options.speedAttributeId = 99;
    if (kind === "speed-absent") delete context.job.options.speedAttributeId;
    if (kind === "tough-unmapped")
      context.job.options.toughnessAttributeId = 99;
    if (kind === "tough-absent")
      delete context.job.options.toughnessAttributeId;
    expect(seedFor(context)(new Map(), undefined)).toBeUndefined();
  });

  test("rejects undefined factors, missing fixed identity, and nonfinite official evaluations", () => {
    const context = contextFor();
    expect(
      seedFor(context)(
        new Map([["body", choice([context], equip(999))]]),
        undefined,
      ),
    ).toBeUndefined();
    const originalEvaluator = context.factorEvaluator;
    context.factorEvaluator = () => undefined;
    expect(seedFor(context)(new Map(), undefined)).toBeUndefined();
    context.factorEvaluator = originalEvaluator;
    context.job.options.evaluationFunction = () => ({
      damage: Number.NaN,
      gcd: 2.5,
    });
    expect(seedFor(context)(new Map(), undefined)).toBeUndefined();
    context.job.options.evaluationFunction = () => undefined;
    expect(seedFor(context)(new Map(), undefined)).toBeUndefined();
  });

  test("projected ring replacements must exist as a complete ordered legal pair", () => {
    const a = equip(1);
    const b = equip(2);
    const c = equip(3);
    const ab = { ...equip(10), ringEquips: [a, b] as const };
    const cb = { ...equip(11), ringEquips: [c, b] as const };
    const context = contextFor([[ab, cb]], ["pair"]);
    const projections = new Map<string, SharedSlotProjection>([
      ["ring", { commonSlot: "ring", slotName: "pair", ringIndex: 0 }],
    ]);
    const fixed = new Map([["ring", choice([context], c)]]);
    expect(
      seedFor(
        context,
        { commonSlots: ["ring"] },
        projections,
      )(fixed, undefined)![0]!.selection,
    ).toEqual([cb]);
    expect(
      seedFor(
        context,
        { commonSlots: ["ring"] },
        projections,
      )(new Map([["ring", choice([context], equip(99))]]), undefined),
    ).toBeUndefined();
    context.optimum.selection = [equip(10)];
    expect(
      seedFor(
        context,
        { commonSlots: ["ring"] },
        projections,
      )(fixed, undefined),
    ).toBeUndefined();
    expect(equipmentIdentity(c)).not.toBe(equipmentIdentity(a));
  });

  test("factorized ring seeds enforce uniqueness even when only one ring was fixed", () => {
    const a = equip(1, undefined, { ringSlotIndex: 0, isUnique: true });
    const b = equip(2, undefined, { ringSlotIndex: 1, isUnique: true });
    const duplicated = { ...a, ringSlotIndex: 1 as const };
    const context = contextFor([[a], [b, duplicated]], ["ring", "ring2"]);
    const fixed = new Map([["ring2", choice([context], duplicated)]]);
    expect(
      seedFor(context, {
        commonSlots: ["ring2"],
        factorizedSharedRingPair: true,
      })(fixed, undefined),
    ).toBeUndefined();
    expect(
      seedFor(context, {
        commonSlots: ["ring"],
        factorizedSharedRingPair: true,
      })(new Map(), undefined),
    ).toHaveLength(1);
  });
});
