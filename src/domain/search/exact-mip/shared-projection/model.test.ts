import { describe, expect, test } from "vitest";
import type { Stat } from "../../../types.ts";
import type { LinearMipRow } from "../../linear-mip.ts";
import type { EquipInfo, FoodInfo } from "../../types.ts";
import { buildLinearAttributeModel } from "../attribute-model.ts";
import { assembleJointModel } from "../joint-model.ts";
import { prepareJointIdentity } from "../joint-identity.ts";
import type { JointPreparedJob, JointSearchOptions } from "../joint-types.ts";
import { expandJointRingPairDomain } from "../ring-domain.ts";
import type { JointMipJob, RingPairCandidate } from "../ring-domain.ts";
import { PROJECTION_AXES } from "./types.ts";
import { prepareProjectionModel } from "./model.ts";

const statNames: Stat[] = ["PDMG", "STR", "DET", "TEN", "CRT", "DHT", "SKS"];
const equipment = (
  itemId: number,
  values = [1, 2, 3, 4, 5, 6, 7],
): EquipInfo => ({
  itemId,
  itemLevel: 795,
  key: String(itemId),
  PDMG: 0,
  MDMG: 0,
  DLY: 0,
  baseParams: values.map((value, baseParamId) => ({ baseParamId, value })),
});
const food = (itemId: number, baseValue: number): FoodInfo => ({
  itemId,
  itemLevel: 795,
  key: String(itemId),
  baseParams: [{ baseParamId: 6, multiplier: 1.25, maxValue: 3, baseValue }],
});
const ring = (
  itemId: number,
  value: number,
  ringSlotIndex: 0 | 1,
): EquipInfo => ({
  ...equipment(itemId, [0, value, 0, 0, 0, 0, value]),
  ringSlotIndex,
  isUnique: itemId === 10,
});
const pair = (first: EquipInfo, second: EquipInfo): RingPairCandidate => ({
  ...equipment(100),
  key: `${first.key}/${second.key}`,
  baseParams: [...first.baseParams, ...second.baseParams],
  ringEquips: [first, second],
  ringUniqueByItemId: [
    [10, true],
    [11, false],
  ],
});

function fixture(
  kind: "ordinary" | "rings" | "split" = "ordinary",
  sharedFood = true,
  configure?: (jobs: JointMipJob[], options: JointSearchOptions) => void,
) {
  const originals: JointMipJob[] = [0, 1].map((index) => {
    const first = [ring(10, 1, 0), ring(11, 2, 0)];
    const second = [ring(10, 1, 1), ring(11, 2, 1)];
    const pairSlot = [
      pair(first[0]!, second[1]!),
      pair(first[1]!, second[0]!),
      pair(first[1]!, second[1]!),
    ];
    const slots =
      kind === "ordinary"
        ? [[equipment(1, [1, 2 + index, 3, 4, 5, 6, 7])], [equipment(2)]]
        : kind === "rings"
          ? [[equipment(1)], first, second, [equipment(2)]]
          : [[equipment(1)], pairSlot, [equipment(2)]];
    return {
      id: `job-${index}`,
      slotNames:
        kind === "ordinary"
          ? ["body", "weapon"]
          : kind === "rings"
            ? ["body", "ring", "ring2", "weapon"]
            : ["body", "rings", "weapon"],
      baseline: {
        weaponDamage: 100,
        mainStat: 100,
        determination: 100,
        tenacity: 100,
        critical: 100,
        directHit: 100,
        gcdCentiseconds: 250,
        traitMultiplier: 1,
      },
      options: {
        job: "WAR",
        jobLevel: 100,
        clanIndex: 0,
        objective: "damage",
        slots,
        attributeIds: statNames.map((_, i) => i),
        statIndexes: new Map(statNames.map((stat, i) => [stat, i])),
        foods: sharedFood ? [food(1, index + 3)] : [food(index + 1, index + 3)],
        equipmentAttributeExtractor: (candidate: EquipInfo) =>
          candidate.baseParams,
        speedAttributeId: 6,
        constraints: { gcdChoices: [2.5, 2.49], speedMin: 5, speedMax: 30 },
        gcdToSpeedRange: (gcd: number) =>
          gcd === 2.5 ? { min: 5, max: 10 } : { min: 20, max: 40 },
        evaluationFunction: () => ({ damage: 1, gcd: 2.5 }),
      },
    };
  });
  const options: JointSearchOptions = {
    jobs: originals,
    commonSlots:
      kind === "ordinary"
        ? ["body"]
        : kind === "rings"
          ? ["ring", "body", "ring2"]
          : ["rings", "body"],
    sharedFood,
    objective: "damage",
    equipmentIdentity: (value) => String(value.itemId),
    foodIdentity: (value) => String(value.itemId),
  };
  configure?.(originals, options);
  const identity = prepareJointIdentity(options);
  const jobs: JointPreparedJob[] = originals.map((originalJob, index) => {
    const ringSplit = identity.activeRingSplits[index];
    const job =
      ringSplit === undefined
        ? originalJob
        : expandJointRingPairDomain(originalJob, ringSplit);
    const model = buildLinearAttributeModel(job.options)!;
    const groups = PROJECTION_AXES.map((name) => ({
      name,
      classes: [
        { min: 0, max: 4, value: 100, variable: `${name}_0`, q: -2 },
        { min: 5, max: 100, value: 101, variable: `${name}_1`, q: 0 },
      ],
    }));
    return {
      job,
      originalJob,
      ...(ringSplit === undefined ? {} : { ringSplit }),
      prepared: {
        model,
        groups,
        useDps: false,
        qByVariable: new Map(
          groups.flatMap((group) =>
            group.classes.map((entry) => [entry.variable, entry.q] as const),
          ),
        ),
      },
    } as unknown as JointPreparedJob;
  });
  const assembled = assembleJointModel(options, jobs, identity, {
    canonicalRingRanks: new Map(),
    canonicalRingSlotIndexes: [],
  })!;
  const necessary: LinearMipRow[] = jobs.map(({ prepared }, index) => ({
    name: `joint_necessary_job_${index}`,
    sense: ">=",
    rhs: -7,
    terms: new Map(
      [...prepared.qByVariable].map(([name, q]) => [
        assembled.prefix(index, name),
        q,
      ]),
    ),
  }));
  const prepare = (check = () => {}) =>
    prepareProjectionModel(options, jobs, assembled, necessary, check);
  return { options, jobs, assembled, necessary, prepare };
}

describe("typed shared projection input", () => {
  test("preserves local contributions, normalized Q, full units, food offsets and disjoint hard GCD", () => {
    const { prepare } = fixture();
    const result = prepare()!;
    expect(result.blocks.map((block) => block.name)).toEqual(["body"]);
    expect(result.jobs[0]!.slots.map((slot) => slot.name)).toEqual([
      "body",
      "weapon",
    ]);
    expect(result.jobs[0]!.slots[0]!.choices[0]!.values).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(result.jobs[1]!.slots[0]!.choices[0]!.values).toEqual([
      1, 3, 3, 4, 5, 6, 7,
    ]);
    expect(
      result.jobs[0]!.axes.map((axis) => [axis.rawMin, axis.rawMax]),
    ).toEqual([
      [2, 2],
      [4, 4],
      [6, 6],
      [8, 8],
      [10, 10],
      [12, 12],
      [14, 14],
    ]);
    expect(result.jobs[0]!.axes[0]!.classes[0]).toMatchObject({
      q: -2,
      selector: "j0_weapon_0",
      value: 100,
    });
    expect(result.jobs[0]!.foods[0]!.bonuses[6]).toEqual({
      numerator: 1,
      denominator: 4,
      cap: 3,
      offset: 3,
    });
    expect(result.jobs[1]!.foods[0]!.bonuses[6]!.offset).toBe(4);
    expect(result.jobs[0]!.speedRanges).toEqual([
      { min: 5, max: 10 },
      { min: 20, max: 30 },
    ]);
  });

  test("keeps independent food domains and each physical identity", () => {
    const result = fixture("ordinary", false).prepare()!;
    expect(
      result.jobs.map((job) => job.foods.map((entry) => entry.sharedKey)),
    ).toEqual([["1"], ["2"]]);
  });

  test("does not bind a GCD choice on DET to the formula's SKS coordinate", () => {
    const { jobs, prepare } = fixture("ordinary", true, (jobs) => {
      jobs.forEach(({ options }) => {
        options.speedAttributeId = 2;
      });
    });
    expect(jobs[0]!.prepared.model.ranges.get(2)).toEqual({ min: 5, max: 30 });
    expect(jobs[0]!.prepared.model.ranges.has(6)).toBe(false);
    const result = prepare()!;
    const speed = result.jobs[0]!.axes[6]!.rawMin + 3;
    expect(speed).toBe(17); // DET=6 is legal, while SKS+food=17 is outside the DET GCD ranges.
    expect(result.jobs[0]!.speedRanges).toEqual([
      { min: 0, max: Number.MAX_SAFE_INTEGER },
    ]);
    expect(
      result.jobs[0]!.speedRanges!.some(
        ({ min, max }) => min <= speed && speed <= max,
      ),
    ).toBe(true);
  });

  test("places the ordered ring rank last and exhaustively retains all unique-legal directions", () => {
    const result = fixture("rings").prepare()!;
    expect(result.blocks.map((block) => block.name)).toEqual([
      "body",
      "orderedRingPair",
    ]);
    expect(result.blocks[1]!.keys).toHaveLength(3);
    expect(
      result.blocks[1]!.keys.every((key) => key.selectors.length === 2),
    ).toBe(true);
    expect(
      result.jobs[0]!.slots[1]!.choices.map((choice) => choice.values[1]),
    ).toEqual([3, 3, 4]);
    expect(result.jobs[0]!.slots.map((slot) => slot.name)).toEqual([
      "body",
      "orderedRingPair",
      "weapon",
    ]);
  });

  test("binds splitPair identities to the original ordered pair domain and consumes both internal slots", () => {
    const { jobs, prepare } = fixture("split");
    expect(jobs.every((job) => job.ringSplit !== undefined)).toBe(true);
    const result = prepare()!;
    expect(result.blocks.map((block) => block.name)).toEqual(["body", "rings"]);
    expect(result.jobs[0]!.slots.map((slot) => slot.name)).toEqual([
      "body",
      "rings",
      "weapon",
    ]);
    expect(
      result.jobs[0]!.slots[1]!.choices.map((choice) => choice.values[1]),
    ).toEqual([3, 4]);
  });

  test("does not invent a unique constraint from ordinary ring names and isUnique alone", () => {
    const { jobs, prepare } = fixture("rings", true, (jobs) => {
      for (const job of jobs)
        for (const slot of job.options.slots)
          for (const candidate of slot) delete candidate.ringSlotIndex;
    });
    expect(
      jobs[0]!.prepared.model.rows.some(
        (row) => row.name === "unique_ring_item_10",
      ),
    ).toBe(false);
    const result = prepare()!;
    expect(result.blocks[1]!.keys).toHaveLength(4);
    expect(
      result.jobs[0]!.slots[1]!.choices.map((choice) => choice.values[1]),
    ).toEqual([2, 3, 3, 4]);
  });

  test("uses the split's unique IDs rather than child isUnique and retains every original direction", () => {
    const { jobs, prepare } = fixture("split", true, (jobs, options) => {
      options.commonSlots = ["ring", "body", "ring2"];
      options.commonSlotProjections = [
        { commonSlot: "ring", slotName: "rings", ringIndex: 1 },
        { commonSlot: "ring2", slotName: "rings", ringIndex: 0 },
      ];
      for (const job of jobs) {
        const pairs = job.options.slots[1]! as RingPairCandidate[];
        pairs.push(pair(pairs[0]!.ringEquips[0], pairs[1]!.ringEquips[1]));
        for (const candidate of pairs) {
          candidate.ringUniqueByItemId = [
            [10, false],
            [11, false],
          ];
          for (const child of candidate.ringEquips) delete child.ringSlotIndex;
        }
      }
    });
    expect(jobs[0]!.ringSplit!.uniqueItemIds.size).toBe(0);
    expect(
      jobs[0]!.prepared.model.rows.some(
        (row) => row.name === "unique_ring_item_10",
      ),
    ).toBe(false);
    const result = prepare()!;
    expect(result.blocks[1]!.keys).toHaveLength(4);
    expect(
      result.jobs[0]!.slots[1]!.choices.map(
        (choice) => choice.values[1],
      ).sort(),
    ).toEqual([2, 3, 3, 4]);
    expect(result.jobs[0]!.slots.map((slot) => slot.name)).toEqual([
      "body",
      "orderedRingPair",
      "weapon",
    ]);
  });

  test("filters projected split endpoints using the certified split unique set", () => {
    const { jobs, prepare } = fixture("split", true, (jobs, options) => {
      options.commonSlots = ["ring", "body", "ring2"];
      options.commonSlotProjections = [
        { commonSlot: "ring", slotName: "rings", ringIndex: 0 },
        { commonSlot: "ring2", slotName: "rings", ringIndex: 1 },
      ];
      for (const job of jobs)
        for (const candidate of job.options.slots[1]! as RingPairCandidate[])
          for (const child of candidate.ringEquips) {
            delete child.ringSlotIndex;
            child.isUnique = false;
          }
    });
    expect(jobs[0]!.ringSplit!.uniqueItemIds.has(10)).toBe(true);
    const result = prepare()!;
    expect(result.blocks[1]!.keys).toHaveLength(3);
    expect(
      result.jobs[0]!.slots[1]!.choices.map(
        (choice) => choice.values[1],
      ).sort(),
    ).toEqual([3, 3, 4]);
  });

  test("uses the shared constructor's actual ranks instead of reconstructing lexical order", () => {
    const { options, jobs, necessary } = fixture("rings");
    options.canonicalSharedRingPair = true;
    const identity = prepareJointIdentity(options);
    const assembled = assembleJointModel(options, jobs, identity, {
      canonicalRingRanks: new Map([
        ["10", 1],
        ["11", 0],
      ]),
      canonicalRingSlotIndexes: jobs.map(() => ({
        firstSlotIndex: 1,
        secondSlotIndex: 2,
      })),
    })!;
    expect(assembled.sharedCanonicalRingOrders[0]!.firstRanks).toEqual([1, 0]);
    const result = prepareProjectionModel(
      options,
      jobs,
      assembled,
      necessary,
      () => {},
    )!;
    expect(result.blocks[1]!.keys.map((key) => key.selectors)).toEqual([
      ["shared_equipment_ring_1", "shared_equipment_ring2_0"],
      ["shared_equipment_ring_1", "shared_equipment_ring2_1"],
    ]);
  });

  test("respects the physical constructor's canonical ranks when ring names reverse physical positions", () => {
    const { jobs, prepare } = fixture("rings", true, (jobs) => {
      for (const job of jobs) {
        delete job.options.equipmentAttributeExtractor;
        for (const candidate of job.options.slots[1]!)
          candidate.ringSlotIndex = 1;
        for (const candidate of job.options.slots[2]!)
          candidate.ringSlotIndex = 0;
      }
    });
    expect(jobs[0]!.prepared.model.canonicalRingOrder!.firstSlotIndex).toBe(2);
    const result = prepare()!;
    expect(result.blocks[1]!.keys).toHaveLength(2);
    expect(
      result.jobs[0]!.slots[1]!.choices.map((choice) => choice.values[1]),
    ).toEqual([3, 4]);
  });

  test("rejects missing or extraneous necessary coefficients and inconsistent normalized Q", () => {
    const first = fixture();
    (first.necessary[0]!.terms as Map<string, number>).delete("j0_main_0");
    expect(first.prepare()).toBeUndefined();
    const second = fixture();
    (second.necessary[0]!.terms as Map<string, number>).set("unowned", 1);
    expect(second.prepare()).toBeUndefined();
    const third = fixture();
    third.jobs[0]!.prepared.qByVariable.set("main_0", -1);
    (third.necessary[0]!.terms as Map<string, number>).set("j0_main_0", -1);
    expect(third.prepare()).toBeUndefined();
  });

  test("checks every repeated shared identity instead of trusting its first contribution", () => {
    const { jobs, assembled, prepare } = fixture();
    const entry = assembled.sharedEquipmentDomains[0]!.choices[0]!.get("1")!;
    const old = jobs[0]!.prepared.model.fixedEquipmentAttributes[0]![0]!;
    (jobs[0]!.job.options.slots[0]! as EquipInfo[]).push(equipment(1));
    jobs[0]!.prepared.model.slotVariables[0]!.push("duplicate");
    const duplicate = [...old];
    jobs[0]!.prepared.model.fixedEquipmentAttributes[0]!.push(duplicate);
    entry.variables.push("j0_duplicate");
    expect(prepare()).toBeDefined();
    duplicate[1] = duplicate[1]! + 1;
    expect(prepare()).toBeUndefined();
  });

  test("refuses variable allocations and propagates caller cancellation unchanged", () => {
    const first = fixture();
    first.jobs[0]!.job.options.slots[0]![0]!.resistanceWeaponAdjust = {
      stats: ["CRT"],
      maxEachStat: 1,
      maxTotalStats: 1,
    };
    expect(first.prepare()).toBeUndefined();
    const cancellation = new Error("cancelled");
    expect(() =>
      fixture().prepare(() => {
        throw cancellation;
      }),
    ).toThrow(cancellation);
  });
});
