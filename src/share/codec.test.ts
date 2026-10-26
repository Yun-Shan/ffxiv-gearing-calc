import { describe, expect, it } from "vitest";
import realSearch from "./__fixtures__/real-search.json";
import dutyMetadata from "./__fixtures__/duty-metadata.json";
import { gameData } from "../domain/data.ts";
import {
  highestMateriaGrade,
  materiaForGrade,
} from "../domain/optimizer/candidates/materia-rules.ts";
import {
  bit,
  elapsedTicks,
  mixedRead,
  mixedWrite,
  q7,
  q7Units,
  readQ7,
  Reader,
  writeQ7,
  Writer,
} from "./binary.ts";
import {
  decodeShareBinary,
  documentFromToken,
  encodeShareBinary,
  fromBase64url,
  shareUrl as encodeUrl,
  toBase64url,
} from "./codec.ts";
import { listRead, listWrite, modeRead, modeWrite } from "./config-codec.ts";
import { patternRead, patternWrite, resolvePattern } from "./patterns.ts";
import { projectShareInput } from "./projection.ts";
import {
  restoreDocument,
  restoreShare,
} from "./restore.ts";
import { dutyById, sourceById } from "./tables.ts";
import {
  MAX_LINK_CHARS,
  type ShareDocument,
  type ShareJointConfig,
} from "./types.ts";
import { sharePrefix } from "./url.ts";
const TEST_BASE = "https://ffxiv-gear.yunshan.dev/";
const SHARE_PREFIX = sharePrefix(TEST_BASE);
const shareUrl = (document: ShareDocument) => encodeUrl(document, TEST_BASE);

const samples = realSearch as unknown as {
  label: string;
  document: ShareDocument;
  expected: {
    stats: unknown;
    effects: unknown;
    gear: { slot: string; finalStats: unknown; weaponDamage?: number }[];
  }[];
  binary: string;
}[];
const sample = (label: string): ShareDocument =>
  structuredClone(samples.find((f) => f.label === label)!.document);

describe("real saved searches from the current data version", () => {
  it.each(samples)(
    "restores every attribute, effect and original binary for $label",
    (fixture) => {
      const bytes = encodeShareBinary(fixture.document);
      expect(toBase64url(bytes)).toBe(fixture.binary);
      const view = restoreShare(fixture.binary);
      expect(encodeShareBinary(view.document)).toEqual(bytes);
      view.results.forEach((result, i) => {
        expect(result.stats).toEqual(fixture.expected[i].stats);
        expect(result.effects).toEqual(fixture.expected[i].effects);
        for (const gear of result.gear) {
          const original = fixture.expected[i].gear.find(
            (g) => g.slot === gear.slot,
          )!;
          expect(gear.finalStats).toEqual(original.finalStats);
          expect(gear.weaponDamage).toBe(original.weaponDamage);
        }
      });
      expect(view.unknownSourceIds).toEqual([]);
      const projected = projectShareInput({
        mode: view.document.mode,
        config:
          view.document.mode === "single"
            ? view.document.configs[0]
            : ({
                jobs: view.document.configs,
                commonSlots: view.document.commonSlots,
                foodStrategy: view.document.foodStrategy,
                objective: view.document.configs[0].objective,
              } satisfies ShareJointConfig),
        results: view.results,
        dataVersion: view.document.dataVersion,
        elapsedMs: view.document.elapsedMs,
        baselines: view.document.baselines,
        jointValue: view.document.jointValue,
      });
      expect(encodeShareBinary(projected)).toEqual(bytes);
    },
  );
  it("rebuilds complete pools without changing the original selection", () => {
    const original = restoreDocument(sample("nin-sync90"));
    const selected = original.results[0].gear.find(g => g.slot === "head")!;
    const pool = original.results[0].equivalentGear![selected.replacementGroupKey!]!;
    expect(pool).toHaveLength(21);
    expect(pool.some(g => g.id === selected.id)).toBe(true);
    expect(original.document.rows).toEqual(sample("nin-sync90").rows);
  });
});

describe("missing catalog references", () => {
  it("preserves literal multibyte UTF-8 sources", () => {
    const doc = sample("brd-open");
    doc.configs[0].excludedSources = ["未收录来源", "🪷/来源"];
    const bytes = encodeShareBinary(doc), decoded = decodeShareBinary(bytes);
    expect(decoded.configs[0].excludedSources).toEqual(doc.configs[0].excludedSources);
    expect(encodeShareBinary(decoded)).toEqual(bytes);
  });
  it("preserves fixed materia conditions while synced selected materia remain inactive", () => {
    const doc = sample("nin-sync90"),
      cell = doc.rows[0].gear.find((g) => g.slot === "head")!,
      raw = gameData.getGearById(doc.identities[cell.identity].itemId)!;
    const grade = highestMateriaGrade(raw.level, true);
    doc.configs[0].forcedGear = {
      head: {
        id: raw.id,
        melds: Array.from(
          { length: raw.materiaAdvanced ? 5 : raw.materiaSlots },
          (_, i) => (i === 0 ? materiaForGrade("CRT", grade) : null),
        ),
      },
    };
    const view = restoreShare(toBase64url(encodeShareBinary(doc)));
    expect(view.results[0].gear.find((g) => g.slot === "head")!.melds).toEqual(
      [],
    );
    expect(view.results[0].stats).toEqual(
      restoreDocument(sample("nin-sync90")).results[0].stats,
    );
    expect(view.document.configs[0].forcedGear?.head).toMatchObject({
      id: raw.id,
    });
  });
  it.each(dutyMetadata)(
    "preserves the real catalog option in metadata fixture $label",
    (fixture) => {
      const doc = sample(fixture.sourceLabel);
      doc.configs.forEach((config) => {
        expect(config.sync).toEqual(fixture.duty.target);
        config.syncDuty = fixture.duty.name;
      });
      const bytes = encodeShareBinary(doc);
      expect(toBase64url(bytes)).toBe(fixture.binary);
      const view = restoreShare(fixture.binary);
      expect(
        view.document.configs.every((c) => c.syncDuty === fixture.duty.name),
      ).toBe(true);
      expect(encodeShareBinary(view.document)).toEqual(bytes);
    },
  );
  it("uses source and duty zero without a sentinel offset", () => {
    expect(sourceById(0)).toBe(
      gameData.gearSources[gameData.shareTables.sourceRefs[0]],
    );
    expect(dutyById(0)).toEqual(
      gameData.sync.groups.flatMap((g) => g.options)[
        gameData.shareTables.dutyRefs[0]
      ],
    );
    const doc = sample("blm-sync"),
      option = dutyById(0);
    Object.assign(doc.configs[0], {
      sync: option.target,
      syncDuty: option.name,
      excludedSources: [sourceById(0)],
    });
    const decoded = documentFromToken(shareUrl(doc).slice(SHARE_PREFIX.length));
    expect(decoded.configs[0].syncDuty).toBe(option.name);
    expect(decoded.configs[0].sync).toEqual(option.target);
  });
  it("preserves unknown numeric sources through import and reshare; does not create pools", () => {
    const doc = sample("nin-sync90");
    doc.configs[0].excludedSources = [
      { unknownSourceId: 6000 },
      "未收录的来源前缀",
    ];
    const url = shareUrl(doc),
      view = restoreShare(url.slice(SHARE_PREFIX.length));
    expect(view.unknownSourceIds).toEqual([6000]);
    expect(view.document.configs[0].excludedSources).toEqual(
      doc.configs[0].excludedSources,
    );
    expect(view.results[0].equivalentGear).toBeUndefined();
    expect(view.results[0].stats).toEqual(
      restoreDocument(sample("nin-sync90")).results[0].stats,
    );
    expect(shareUrl(view.document)).toBe(url);
  });
  it("rejects an unresolved duty even with unknown sources", () => {
    const doc = sample("blm-sync"),
      option = dutyById(0);
    Object.assign(doc.configs[0], {
      sync: option.target,
      syncDuty: option.name,
      excludedSources: [{ unknownSourceId: 6000 }],
    });
    const bytes = encodeShareBinary(doc),
      prior = gameData.shareTables.dutyRefs[0];
    try {
      gameData.shareTables.dutyRefs[0] = gameData.sync.groups.flatMap(
        (g) => g.options,
      ).length;
      expect(() => decodeShareBinary(bytes)).toThrow(/未知同步副本/);
    } finally {
      gameData.shareTables.dutyRefs[0] = prior;
    }
    doc.configs[0].syncDuty = undefined;
    doc.configs[0].sync = { kind: "itemLevel", value: 89 };
    expect(() => encodeShareBinary(doc)).toThrow(/同步/);
  });
  it("rejects unknown items, food, versions and different joint unknown conditions", () => {
    for (const kind of ["item", "food", "version"] as const) {
      const doc = sample("brd-open");
      if (kind === "item") doc.identities[0].itemId = 0xffffffff;
      else if (kind === "food") doc.rows[0].foodId = 0xffffffff;
      else doc.dataVersion = "unknown";
      expect(() => encodeShareBinary(doc)).toThrow(/未知/);
    }
    const joint = sample("caster-shared");
    joint.configs.forEach(
      (c, i) => (c.excludedSources = [{ unknownSourceId: 5000 + i }]),
    );
    expect(() => encodeShareBinary(joint)).toThrow(/联合来源/);
  });
});

describe("bounded binary primitives", () => {
  it.each([0, 1, 127, 128, 16383, 16384, 0xffffffff, Number.MAX_SAFE_INTEGER])(
    "U round trips %s",
    (value) => {
      const w = new Writer();
      w.u(value);
      const r = new Reader(w.finish());
      expect(r.u()).toBe(value);
      r.finish();
    },
  );
  it("rejects nonminimal, truncated, overflowing and oversized fields before loops", () => {
    for (const bytes of [
      [128, 0],
      [128],
      Array(9).fill(255),
      [255, 255, 255, 255, 255, 255, 255, 127],
    ])
      expect(() => new Reader(Uint8Array.from(bytes)).u()).toThrow();
    expect(() => documentFromToken("A".repeat(MAX_LINK_CHARS + 1))).toThrow(
      /容量/,
    );
    const payload = fromBase64url(samples[0].binary);
    expect(() => decodeShareBinary(payload.slice(0, -1))).toThrow();
    const extra = new Uint8Array(payload.length + 1);
    extra.set(payload);
    extra[extra.length - 1] = 255;
    expect(() => decodeShareBinary(extra)).toThrow();
    for (const value of ["A", "AQ=", "A+", "AR"])
      expect(() => fromBase64url(value)).toThrow();
  });
  it("stores Q7 as four unsigned little-endian bytes with toFixed rounding", () => {
    const w = new Writer();
    writeQ7(w, 429.4967295);
    expect([...w.finish()]).toEqual([255, 255, 255, 255]);
    expect(readQ7(new Reader(w.finish()))).toBe(429.4967295);
    for (const value of [0, 1, 1.23456789, 1.99999999, 214.7483648]) {
      const x = new Writer();
      writeQ7(x, value);
      expect(x.finish().length).toBe(4);
      expect(readQ7(new Reader(x.finish()))).toBe(Number(value.toFixed(7)));
    }
    for (const value of [-0, -1, NaN, Infinity, 429.49672950001])
      expect(() => q7Units(value)).toThrow();
    const joint = sample("caster-shared");
    joint.jointValue = 1.99999999;
    const first = encodeShareBinary(joint);
    expect(decodeShareBinary(first).jointValue).toBe(2);
    expect(encodeShareBinary(decodeShareBinary(first))).toEqual(first);
    joint.baselines[0] = 0.00000001;
    expect(() => encodeShareBinary(joint)).toThrow(/联合/);
    expect(q7(1.23456785)).toBe(Number((1.23456785).toFixed(7)));
  });
  it("retains flag order across bytes and rejects nonzero padding", () => {
    const w = new Writer();
    w.byte(20);
    for (let i = 0; i < 19; i++) w.flag(i % 3 === 0);
    const bytes = w.finish(),
      r = new Reader(bytes);
    expect(r.byte()).toBe(20);
    for (let i = 0; i < 19; i++) expect(r.flag()).toBe(i % 3 === 0);
    r.finish();
    bytes[1] |= 128;
    const bad = new Reader(bytes);
    bad.byte();
    for (let i = 0; i < 19; i++) bad.flag();
    expect(() => bad.finish()).toThrow(/补齐/);
  });
  it("uses exact Mixed integer ranges including zero-byte constant blocks", () => {
    const w = new Writer();
    mixedWrite(w, [1, 6, 2], [2, 7, 3]);
    expect([...w.finish()]).toEqual([41]);
    expect(mixedRead(new Reader(w.finish()), [2, 7, 3])).toEqual([1, 6, 2]);
    const zero = new Writer();
    mixedWrite(zero, [0, 0], [1, 1]);
    expect(zero.finish().length).toBe(0);
    expect(() => mixedRead(new Reader(Uint8Array.of(42)), [2, 7, 3])).toThrow(
      /溢出/,
    );
  });
  it("encodes list masks locally beyond 32 and 53 positions", () => {
    const old = Array.from({ length: 130 }, (_, i) => i),
      next = [...old];
    next[0] = 500;
    next[63] = 600;
    next[129] = 700;
    const w = new Writer();
    listWrite(w, next, old, (w, x) => w.u(x));
    expect(w.flags).toEqual([]);
    const r = new Reader(w.finish());
    expect(listRead(r, old, (r) => r.u())).toEqual(next);
    r.finish();
    for (const values of [
      [],
      old.slice(0, 2),
      [...old, 700],
      [old[1], old[0], ...old.slice(2)],
    ]) {
      const x = new Writer();
      listWrite(x, values, old, (w, v) => w.u(v));
      const y = new Reader(x.finish());
      expect(listRead(y, old, (r) => r.u())).toEqual(values);
      y.finish();
    }
  });
  it("uses fixed 3+5 materia tokens, exact holes and StatCode masks", () => {
    const patterns = [
      [],
      [null],
      [null, { stat: "CRT" as const, grade: 31 }, null],
      [
        { stat: "TEN" as const, grade: 0, value: 0 },
        { stat: "PIE" as const, grade: 0, value: 400 },
      ],
    ];
    for (const p of patterns) {
      const w = new Writer();
      patternWrite(w, p);
      const r = new Reader(w.finish());
      expect(patternRead(r)).toEqual(p);
      r.finish();
    }
    for (const bytes of [[63], [143], [156], [2, 224], [2, 0]])
      expect(() => patternRead(new Reader(Uint8Array.from(bytes)))).toThrow();
    expect(bit(2 ** 14 + 1, 14)).toBe(true);
  });
  it("preserves explicit zero, single-sided speed and mode payload order", () => {
    const config = {
      objective: "dps" as const,
      speedMin: 0,
      sync: { kind: "itemLevel" as const, value: 90 },
      minTenacity: 0,
      maximizeTenacity: false,
    };
    const w = new Writer();
    modeWrite(w, config, 100);
    expect(w.bytes[0]).toBe(55);
    expect(w.bytes[1]).toBe(1);
    const r = new Reader(w.finish());
    expect(modeRead(r, 100)).toEqual(config);
    r.finish();
    expect(elapsedTicks(12345)).toBe(123);
    expect(elapsedTicks(0)).toBe(0);
  });
  it("rejects fractional speed/TEN and overly precise mitigation", () => {
    for (const field of [
      "speedMin",
      "speedMax",
      "minTenacity",
      "toughnessMinPercent",
    ] as const) {
      const d = sample("war-tenacity");
      delete d.configs[0].minTenacity;
      delete d.configs[0].toughnessMinPercent;
      d.configs[0].maximizeTenacity = false;
      d.configs[0][field] = 5.71;
      expect(() => encodeShareBinary(d)).toThrow();
    }
  });
  it("aborts reconstruction without changing the original snapshot", () => {
    const d = sample("nin-sync90"),
      signal = AbortSignal.abort();
    expect(() => restoreDocument(d, signal)).toThrow(/取消/);
    const invalid = sample("nin-sync90");
    const item = invalid.identities[0];
    item.pattern = resolvePattern(item.itemId, item.pattern);
    if (Array.isArray(item.pattern))
      item.pattern = [{ stat: "CRT", grade: 0, value: 99999 }];
    expect(() => restoreDocument(invalid)).toThrow();
  });
});
