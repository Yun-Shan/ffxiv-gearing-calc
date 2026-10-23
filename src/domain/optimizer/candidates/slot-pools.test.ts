import { afterEach, describe, expect, test, vi } from "vitest";
import * as data from "../../data.ts";
import * as gearOptions from "../../gear-options.ts";
import type {
  Gear,
  GearSlot,
  MeldedGear,
  OptimizationConfig,
  Stats,
} from "../../types.ts";
import { equipmentIdentity } from "../../search/equipment-identity.ts";
import { candidatePools } from "./slot-pools.ts";

function gear(
  id: number,
  slot: GearSlot,
  stats: Stats,
  extra: Partial<Gear> = {},
): Gear {
  return {
    id,
    slot,
    name: `fixture-${id}`,
    level: 795,
    equipLevel: 100,
    rawSlot: 0,
    roleId: 0,
    jobCategory: 0,
    stats,
    materiaSlots: 0,
    jobs: ["SAM"],
    ...extra,
  };
}

function config(
  overrides: Partial<OptimizationConfig> = {},
): OptimizationConfig {
  return {
    jobId: "SAM",
    minItemLevel: 1,
    maxItemLevel: 795,
    maximizeTenacity: false,
    excludedSources: [],
    forcedGear: {},
    foodId: 0,
    ...overrides,
  };
}

function pools(items: readonly Gear[]) {
  vi.spyOn(gearOptions, "gearOptionsFor").mockImplementation((_, slot) =>
    items.filter((item) => item.slot === (slot === "ring2" ? "ring" : slot)),
  );
  vi.spyOn(data, "getGearById").mockImplementation((id) => {
    const item = items.find((candidate) => candidate.id === id);
    return item === undefined ? undefined : { ...item, icon: item.icon ?? 0 };
  });
}

afterEach(() => vi.restoreAllMocks());

describe("slot pool identity and pairing contracts", () => {
  test("unforced rings use unordered multisets while preserved order retains both orientations", () => {
    const a = gear(1, "ring", { STR: 10 });
    const b = gear(2, "ring", { CRT: 10 });
    pools([a, b]);
    const unordered = candidatePools(
      config(),
      new Map(),
      false,
      false,
    ).slots.find((slot) => slot.name === "rings")!.candidates;
    const ordered = candidatePools(config(), new Map(), true, false).slots.find(
      (slot) => slot.name === "rings",
    )!.candidates;
    expect(unordered).toHaveLength(3);
    expect(ordered).toHaveLength(4);
    const unorderedIds = unordered.map((pair) =>
      pair
        .ringEquips!.map((item) => item.itemId)
        .sort()
        .join(","),
    );
    expect(new Set(unorderedIds)).toEqual(new Set(["1,1", "1,2", "2,2"]));
    expect(
      ordered.map((pair) =>
        pair.ringEquips!.map((item) => item.itemId).join(","),
      ),
    ).toEqual(["1,1", "1,2", "2,1", "2,2"]);
  });

  test("forced ring positions survive pairing and restore their separate result slots", () => {
    const a = gear(1, "ring", { STR: 10 }, { unique: true });
    const b = gear(2, "ring", { CRT: 10 }, { unique: true });
    pools([a, b]);
    const identities = new Map<string, MeldedGear>();
    const slots = candidatePools(
      config({ forcedGear: { ring: b.id, ring2: a.id, body: 999 } }),
      identities,
      false,
      false,
    ).slots;
    expect(slots.find((slot) => slot.name === "body")!.candidates).toEqual([]);
    const pairs = slots.find((slot) => slot.name === "rings")!.candidates;
    expect(pairs).toHaveLength(1);
    const [first, second] = pairs[0]!.ringEquips!;
    expect([first.itemId, second.itemId]).toEqual([b.id, a.id]);
    expect(identities.get(equipmentIdentity(first))!.slot).toBe("ring");
    expect(identities.get(equipmentIdentity(second))!.slot).toBe("ring2");
    const missing = candidatePools(
      config({ forcedGear: { ring: 999 } }),
      new Map(),
      false,
      false,
    );
    expect(
      missing.slots.find((slot) => slot.name === "rings")!.candidates,
    ).toEqual([]);
  });

  test("independent ring pruning preserves the only legal unique counterpart and removes stale identities", () => {
    const unique = gear(1, "ring", { STR: 30 }, { unique: true });
    const repeatable = gear(2, "ring", { STR: 20 }, { unique: false });
    const dominated = gear(3, "ring", { STR: 10 }, { unique: false });
    pools([unique, repeatable, dominated]);
    const identities = new Map<string, MeldedGear>();
    const slots = candidatePools(
      config({ forcedGear: { ring2: unique.id } }),
      identities,
      false,
      true,
      undefined,
      true,
    ).slots;
    const first = slots.find((slot) => slot.name === "ring")!.candidates;
    const second = slots.find((slot) => slot.name === "ring2")!.candidates;
    expect(first.map((item) => item.itemId)).toEqual([
      unique.id,
      repeatable.id,
    ]);
    expect(second.map((item) => item.itemId)).toEqual([unique.id]);
    expect(
      first.every(
        (item) => "ringSlotIndex" in item && item.ringSlotIndex === 0,
      ),
    ).toBe(true);
    expect(
      second.every(
        (item) => "ringSlotIndex" in item && item.ringSlotIndex === 1,
      ),
    ).toBe(true);
    expect(
      [...identities.values()].some((item) => item.id === dominated.id),
    ).toBe(false);
    expect(
      first
        .filter((left) => left.itemId !== second[0]!.itemId)
        .map((item) => item.itemId),
    ).toEqual([repeatable.id]);
  });

  test("slot dominance forgets replaced identities while keeping adjustable weapons outside the frontier", () => {
    const weak = gear(1, "body", { STR: 10 });
    const strong = gear(2, "body", { STR: 20 });
    const variable = gear(
      3,
      "weapon",
      { STR: 1 },
      {
        resistanceWeaponAdjust: {
          maxTotalStats: 10,
          maxEachStat: 10,
          stats: ["CRT"],
        },
      },
    );
    const normalWeapon = gear(4, "weapon", { STR: 20 });
    pools([weak, strong, variable, normalWeapon]);
    const identities = new Map<string, MeldedGear>();
    const result = candidatePools(
      config(),
      identities,
      false,
      true,
      new Set(["body", "weapon"]),
    );
    expect(
      result.slots
        .find((slot) => slot.name === "body")!
        .candidates.map((item) => item.itemId),
    ).toEqual([strong.id]);
    expect(
      result.slots
        .find((slot) => slot.name === "weapon")!
        .candidates.map((item) => item.itemId),
    ).toEqual([variable.id, normalWeapon.id]);
    expect([...identities.values()].some((item) => item.id === weak.id)).toBe(
      false,
    );
    expect(
      [...identities.values()].some((item) => item.id === variable.id),
    ).toBe(true);
  });

  test("a speed ceiling retains otherwise dominated speed values in independent rings", () => {
    pools([
      gear(1, "ring", { STR: 20, SKS: 10 }),
      gear(2, "ring", { STR: 10, SKS: 0 }),
    ]);
    const slots = candidatePools(
      config({ speedMax: 5 }),
      new Map(),
      false,
      true,
      undefined,
      true,
    ).slots;
    expect(
      slots
        .find((slot) => slot.name === "ring")!
        .candidates.map((item) => item.itemId),
    ).toEqual([1, 2]);
  });

  test("large explicit ring domains fail before materializing a million ordered pairs", () => {
    pools(
      Array.from({ length: 1001 }, (_, index) =>
        gear(index + 1, "ring", { STR: 10 }),
      ),
    );
    expect(() => candidatePools(config(), new Map(), true, false)).toThrow(
      /超过候选内存保护线；未返回搜索结果/,
    );
  });
});
