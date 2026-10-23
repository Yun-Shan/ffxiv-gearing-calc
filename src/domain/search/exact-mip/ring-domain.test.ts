import { describe, expect, test } from "vitest";
import type { EquipInfo } from "../types.ts";
import type { JointMipJob, RingPairCandidate } from "./ring-domain.ts";
import {
  expandJointRingPairDomain,
  extractedAttributeMap,
  hasUniqueRingConflict,
  internalRingSelection,
  originalRingSelection,
  ringChildStructuralKey,
  ringPairCandidate,
  ringPairSharedIdentity,
  trySplitRingPairDomain,
} from "./ring-domain.ts";

const equipment = (itemId: number, value = 0): EquipInfo => ({
  itemId,
  key: String(itemId),
  itemLevel: 100,
  baseParams: [{ baseParamId: 1, value }],
  PDMG: 0,
  MDMG: 0,
  DLY: 0,
});
const identity = (gear: EquipInfo) =>
  `${gear.itemId}:${gear.variantKey ?? "base"}`;
function pair(first: EquipInfo, second: EquipInfo): RingPairCandidate {
  return {
    ...equipment(100),
    key: `${first.key}/${second.key}`,
    baseParams: [...first.baseParams, ...second.baseParams],
    ringEquips: [first, second],
    ringUniqueByItemId: [
      [1, true],
      [2, false],
    ],
  };
}
function fixture() {
  const first = equipment(1, 3);
  const second = equipment(2, 4);
  const pairs = [
    pair(first, second),
    pair(second, first),
    pair(second, second),
  ];
  const weapon = equipment(10, 2);
  const body = equipment(20, 5);
  const job: JointMipJob = {
    id: "test",
    slotNames: ["weapon", "rings", "body"],
    baseline: {
      weaponDamage: 1,
      mainStat: 1,
      determination: 1,
      tenacity: 1,
      critical: 1,
      directHit: 1,
      gcdCentiseconds: 250,
      traitMultiplier: 1,
    },
    options: {
      job: "RDM",
      jobLevel: 100,
      attributeIds: [1, 2],
      statIndexes: new Map(),
      slots: [[weapon], pairs, [body]],
      foods: [],
      evaluationFunction: () => ({ damage: 1, gcd: 2.5 }),
    },
  };
  const split = () => trySplitRingPairDomain(job, identity);
  return { first, second, pairs, weapon, body, job, split };
}

describe("ordered ring-domain decomposition", () => {
  test("round-trips every allowed direction and preserves nonunique multiplicity", () => {
    const { job, pairs, first, second, weapon, body, split } = fixture();
    const ringSplit = split()!;
    expect(ringSplit.uniqueItemIds).toEqual(new Set([1]));
    expect(ringSplit.firstCandidates).toEqual([first, second]);
    expect(ringSplit.secondCandidates).toEqual([second, first]);
    const domain = {
      job: expandJointRingPairDomain(job, ringSplit),
      originalJob: job,
      ringSplit,
    };
    expect(domain.job.options.slots).toEqual([
      [weapon],
      [first, second],
      [second, first],
      [body],
    ]);
    for (const candidate of pairs) {
      const internal = internalRingSelection(domain, [
        weapon,
        candidate,
        body,
      ])!;
      expect(internal).toEqual([weapon, ...candidate.ringEquips, body]);
      expect(originalRingSelection(domain, internal)).toEqual([
        weapon,
        candidate,
        body,
      ]);
    }
    expect(ringPairSharedIdentity(pairs[0]!, identity)).toBe(
      ringPairSharedIdentity(pairs[1]!, identity),
    );
    expect(ringPairSharedIdentity(pairs[2]!, identity)).toBe(
      JSON.stringify([identity(second), identity(second)]),
    );
  });

  test.each([
    "slot-count",
    "no-pair",
    "two-pair-slots",
    "missing-slot-name",
    "mixed-plain",
    "missing-metadata",
    "missing-child-metadata",
    "unsafe-child-id",
    "inconsistent-size",
    "inconsistent-value",
    "duplicate-order",
    "wrong-sum",
    "incomplete-cartesian",
  ] as const)(
    "retains the original domain when decomposition cannot be proved: %s",
    (reason) => {
      const { job, pairs, split } = fixture();
      switch (reason) {
        case "slot-count":
          job.slotNames = ["weapon"];
          break;
        case "no-pair":
          job.options.slots = [
            [equipment(10)],
            [equipment(1)],
            [equipment(20)],
          ];
          break;
        case "two-pair-slots":
          job.options.slots = [pairs, pairs, [equipment(20)]];
          break;
        case "missing-slot-name":
          job.slotNames = ["weapon", undefined!, "body"];
          break;
        case "mixed-plain":
          pairs.push(equipment(99) as RingPairCandidate);
          break;
        case "missing-metadata":
          pairs[0]!.ringUniqueByItemId = undefined;
          break;
        case "missing-child-metadata":
          pairs[0]!.ringUniqueByItemId = [[1, true]];
          break;
        case "unsafe-child-id":
          pairs[0]!.ringEquips[0].itemId = NaN;
          break;
        case "inconsistent-size":
          pairs[1]!.ringUniqueByItemId = [
            [1, true],
            [2, false],
            [3, false],
          ];
          break;
        case "inconsistent-value":
          pairs[1]!.ringUniqueByItemId = [
            [1, false],
            [2, false],
          ];
          break;
        case "duplicate-order":
          pairs.push({ ...pairs[0]! });
          break;
        case "wrong-sum":
          pairs[0]!.baseParams = [{ baseParamId: 1, value: 8 }];
          break;
        case "incomplete-cartesian":
          pairs.pop();
          break;
      }
      expect(split()).toBeUndefined();
    },
  );

  test.each([
    ["not an array", 3],
    ["bad entry", [null]],
    ["wrong length", [[1, true, 3]]],
    ["unsafe id", [[NaN, true]]],
    ["unknown uniqueness", [[1, "yes"]]],
    [
      "duplicate id",
      [
        [1, true],
        [1, false],
      ],
    ],
  ])("rejects malformed uniqueness metadata: %s", (_reason, metadata) => {
    const { pairs, split } = fixture();
    pairs[0]!.ringUniqueByItemId =
      metadata as unknown as RingPairCandidate["ringUniqueByItemId"];
    expect(split()).toBeUndefined();
  });

  test("generated split slot names avoid every existing slot name", () => {
    const { job, split } = fixture();
    job.slotNames = ["__joint_ring_first_1", "rings", "___joint_ring_second_1"];
    expect(split()!.firstSlotName).toBe("____joint_ring_first_1");
    expect(split()!.secondSlotName).toBe("____joint_ring_second_1");
  });

  test("missing, foreign or truncated selections cannot be reconstructed", () => {
    const { job, weapon, body, first, pairs, split } = fixture();
    const ringSplit = split()!;
    const domain = {
      job: expandJointRingPairDomain(job, ringSplit),
      originalJob: job,
      ringSplit,
    };
    expect(
      internalRingSelection(domain, [weapon, equipment(99), body]),
    ).toBeUndefined();
    expect(
      internalRingSelection(domain, [weapon, pair(first, first), body]),
    ).toBeUndefined();
    expect(internalRingSelection(domain, [weapon, pairs[0]!])).toBeUndefined();
    expect(() => originalRingSelection(domain, [weapon])).toThrow(
      /重建两枚戒指/,
    );
    expect(() =>
      originalRingSelection(domain, [weapon, first, first, body]),
    ).toThrow(/不存在的有序戒指对/);
    expect(() =>
      originalRingSelection(domain, [weapon, ...pairs[0]!.ringEquips]),
    ).toThrow(/结果槽位不完整/);
    const plain = { job, originalJob: job };
    expect(internalRingSelection(plain, [weapon, body])).toEqual([
      weapon,
      body,
    ]);
    expect(originalRingSelection(plain, [weapon, body])).toEqual([
      weapon,
      body,
    ]);
  });

  test("structural identity ignores parameter order and sums repeated extracted coordinates", () => {
    const { job, first } = fixture();
    const duplicate = {
      ...first,
      baseParams: [
        { baseParamId: 2, value: 1 },
        { baseParamId: 1, value: 5 },
        { baseParamId: 1, value: 3 },
      ],
    };
    expect(ringChildStructuralKey(duplicate)).toBe(
      ringChildStructuralKey({
        ...duplicate,
        baseParams: [...duplicate.baseParams].reverse(),
      }),
    );
    expect(extractedAttributeMap(job.options, duplicate)).toEqual(
      new Map([
        [2, 1],
        [1, 8],
      ]),
    );
    job.options.equipmentAttributeExtractor = () => [
      { baseParamId: 2, value: 7 },
      { baseParamId: 2, value: 8 },
    ];
    expect(extractedAttributeMap(job.options, first)).toEqual(
      new Map([[2, 15]]),
    );
  });
});

describe("ring uniqueness validation", () => {
  test("repeated positions are invalid even for distinct nonunique items", () => {
    expect(
      hasUniqueRingConflict([
        { ...equipment(1), ringSlotIndex: 0 },
        { ...equipment(2), ringSlotIndex: 0 },
      ]),
    ).toBe(true);
  });
  test("pair metadata and child uniqueness both prohibit duplicate unique items", () => {
    const duplicate = pair(equipment(1), equipment(1));
    expect(hasUniqueRingConflict([duplicate])).toBe(true);
    duplicate.ringUniqueByItemId = undefined;
    duplicate.ringEquips[1].isUnique = true;
    expect(hasUniqueRingConflict([duplicate])).toBe(true);
    duplicate.ringEquips[1].isUnique = false;
    expect(hasUniqueRingConflict([duplicate])).toBe(false);
    expect(
      hasUniqueRingConflict([
        { ...equipment(1), ringSlotIndex: 0, isUnique: false },
        { ...equipment(1), ringSlotIndex: 1, isUnique: true },
      ]),
    ).toBe(true);
    expect(
      hasUniqueRingConflict([
        { ...equipment(1), ringSlotIndex: 0 },
        { ...equipment(1), ringSlotIndex: 1 },
      ]),
    ).toBe(false);
  });
  test.each(
    [null, [], [null, {}], [{}, null], [{}, 1], [1, {}]].map((ringEquips) => ({
      ringEquips,
    })),
  )(
    "malformed pairs are not interpreted as two rings: %j",
    ({ ringEquips }) => {
      expect(
        ringPairCandidate({
          ...equipment(1),
          ringEquips,
        } as unknown as EquipInfo),
      ).toBeUndefined();
    },
  );
});
