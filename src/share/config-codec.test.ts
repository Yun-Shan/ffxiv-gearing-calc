import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/real-search.json";
import {
  configsRead,
  configsWrite,
  modeRead,
  modeWrite,
  prepareConfigs,
} from "./config-codec.ts";
import { PatternPool } from "./patterns.ts";
import { Reader, Writer } from "./binary.ts";
import { dutyById } from "./tables.ts";
import { type ShareConfig, type ShareDocument } from "./types.ts";

const original = fixtures.find((f) => f.label === "combo-pld-id")!
  .document as unknown as ShareDocument;
const base: ShareConfig = {
  jobId: "PLD",
  clanIndex: 0,
  minItemLevel: 90,
  maxItemLevel: 795,
  objective: "damage",
  maximizeTenacity: false,
  foodId: 0,
  excludedSources: [],
  excludedGearIds: [],
  forcedGear: {},
};
function roundTrip(configs: ShareConfig[]) {
  const pool = new PatternPool(),
    rows = prepareConfigs(configs, pool),
    ctx = { itemBase: 1, pool },
    w = new Writer();
  configsWrite(w, rows, ctx);
  const r = new Reader(w.finish()),
    values = configsRead(r, ctx);
  r.finish();
  return { values, bytes: w.finish() };
}

describe("config boundary fixtures (not search results)", () => {
  it("retains optional inherit/delete/set states and local list masks", () => {
    const a = {
      ...base,
      excludedSources: Array.from({ length: 70 }, (_, i) => `source-${i}`),
      excludedGearIds: [100, 200, 300],
      forcedGear: { head: 100 } as NonNullable<ShareConfig["forcedGear"]>,
    };
    const b = structuredClone(a);
    b.jobId = "WAR";
    b.excludedSources[33] = "changed";
    b.excludedGearIds.pop();
    b.forcedGear = {};
    const c = {
      ...structuredClone(base),
      jobId: "DRK" as const,
      excludedSources: [
        ...b.excludedSources.slice(0, 1),
        { unknownSourceId: 5000 },
      ],
      forcedGear: { ring2: 300 },
    };
    const { values } = roundTrip([a, b, c]);
    expect(values).toEqual([a, b, c]);
  });
  it("does not rebase inherited absolute max/sync when the minimum changes", () => {
    const a = {
      ...base,
      minItemLevel: 100,
      sync: { kind: "itemLevel" as const, value: 90 },
    };
    const b = { ...a, jobId: "WAR" as const, minItemLevel: 110 };
    const c = {
      ...b,
      jobId: "DRK" as const,
      minItemLevel: 90,
      maxItemLevel: 790,
      sync: { kind: "itemLevel" as const, value: 100 },
    };
    expect(roundTrip([a, b, c]).values).toEqual([a, b, c]);
  });
  it("preserves full U24 and delta U36 high-slot values without 32-bit truncation", () => {
    const allForces = Object.fromEntries(
      original.rows[0].gear.map((c) => [
        c.slot,
        original.identities[c.identity].itemId,
      ]),
    );
    const a = { ...structuredClone(base), forcedGear: allForces };
    const b = structuredClone(a);
    b.jobId = "WAR";
    b.forcedGear.ring2 = allForces.ring;
    const c = structuredClone(b);
    c.jobId = "DRK";
    delete c.forcedGear.ring2;
    expect(roundTrip([a, b, c]).values).toEqual([a, b, c]);
  });
  it("rejects reserved forced delta states, forward bases and mask padding", () => {
    const { bytes } = roundTrip([base]);
    const malformed = bytes.slice();
    malformed[1] = 1;
    expect(() =>
      configsRead(new Reader(malformed), {
        itemBase: 1,
        pool: new PatternPool(),
      }),
    ).toThrow(/前向引用/);
    const reserved = new Writer();
    reserved.u(1);
    reserved.u(0);
    reserved.u(19);
    reserved.u(0);
    reserved.u(90);
    reserved.u(0);
    reserved.byte(0);
    reserved.u(0);
    reserved.flag(false);
    reserved.flag(false);
    reserved.flag(true);
    reserved.u(2 ** 24);
    expect(() =>
      configsRead(new Reader(reserved.finish()), {
        itemBase: 1,
        pool: new PatternPool(),
      }),
    ).toThrow(/模式图/);
  });
  it("covers all mode payloads without deriving the optimization objective", () => {
    const duty = dutyById(0);
    const gcds = [
      {},
      { gcdChoices: [2.5] },
      { gcdChoices: [2.5, 2.49] },
      { speedMax: 0 },
      { speedMin: 0, speedMax: 127 },
    ];
    const syncs = [
      {},
      { sync: { kind: "jobLevel" as const, value: 90 } },
      { sync: { kind: "itemLevel" as const, value: 90 } },
      { sync: duty.target, syncDuty: duty.name },
    ];
    const tens = [
      {},
      { minTenacity: 0 },
      { toughnessMinPercent: 5.7 },
      { maximizeTenacity: true },
    ];
    for (const objective of ["damage", "dps"] as const)
      for (const gcd of gcds)
        for (const sync of syncs)
          for (const ten of tens) {
            const value = {
                objective,
                maximizeTenacity: false,
                ...gcd,
                ...sync,
                ...ten,
              },
              w = new Writer();
            modeWrite(w, value, 100);
            const r = new Reader(w.finish());
            expect(modeRead(r, 100)).toEqual(value);
            r.finish();
          }
  });
});
