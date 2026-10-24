// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { gears, foods, gameData, type OptimizationResult } from "@/domain";
import { makeConfig } from "./app-config";
import {
  createSearchHistory,
  finishSearchHistory,
  getSearchHistoryRecord,
  replaceSearchHistoryResult,
} from "./search-history";
import {
  equivalentGearKey,
  replaceEquivalentGear,
} from "@/ui/components/results/gear-table/result-gear-table-rows";
/** Tiny asynchronous IDB transport fixture: no game logic or search results are calculated here. */
function fakeDatabase() {
  const records = new Map<string, unknown>();
  const database = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      let pending = 0,
        aborted = false;
      const transaction: {
        oncomplete?: () => void;
        onerror?: () => void;
        onabort?: () => void;
        error?: Error;
        abort(): void;
        objectStore(): unknown;
      } = {
        abort() {
          aborted = true;
          transaction.onabort?.();
        },
        objectStore: () => store,
      };
      function request(action: () => unknown) {
        const request: {
          result?: unknown;
          onsuccess?: () => void;
          onerror?: () => void;
        } = {};
        pending++;
        setTimeout(() => {
          if (aborted) return;
          try {
            request.result = action();
            request.onsuccess?.();
          } catch {
            request.onerror?.();
          }
          pending--;
          if (!pending)
            setTimeout(() => {
              if (!pending && !aborted) transaction.oncomplete?.();
            }, 0);
        }, 2);
        return request;
      }
      const store = {
        add: (record: { id: string }) =>
          request(() => {
            records.set(record.id, structuredClone(record));
            return record.id;
          }),
        get: (id: string) => request(() => structuredClone(records.get(id))),
        put: (record: { id: string }) =>
          request(() => {
            records.set(record.id, structuredClone(record));
            return record.id;
          }),
        getAll: () =>
          request(() => [...records.values()].map((x) => structuredClone(x))),
      };
      return transaction;
    },
  };
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        const request: { result: unknown; onsuccess?: () => void } = {
          result: database,
        };
        setTimeout(() => request.onsuccess?.(), 0);
        return request;
      },
    },
  });
  return records;
}
function fixtureResult(): OptimizationResult {
  const gear = gears.find(
    (x) => x.jobs.includes("SAM") && x.slot === "weapon",
  )!;
  return {
    calculationLevel: 100,
    gear: [{ ...gear, melds: [], finalStats: gear.stats }],
    food: { ...foods[0]!, actualStats: {}, utilization: 0 },
    stats: { CRT: 100 },
    effects: {
      crtChance: 0.1,
      crtDamage: 1.4,
      detDamage: 1,
      dhtChance: 0.1,
      tenDamage: 1,
      tenMitigation: 0,
      damage: 100,
      gcd: 2.5,
      hp: 100,
      mp: 100,
    },
    score: 100,
    objective: "damage",
    damagePerSecond: 40,
    gcdTier: 2.5,
    searchedCandidates: 1,
    durationMs: 1,
  };
}
describe("history result write ordering", () => {
  it("complete then consecutive equivalent presentations preserve the last choice and original metadata", async () => {
    fakeDatabase();
    const original = fixtureResult();
    original.food = {
      ...original.food,
      actualStats: { DET: 12 },
      utilization: 40,
    };
    const start = "2026-10-16T00:00:00.000Z",
      finish = "2026-10-16T00:00:01.250Z";
    const record = await createSearchHistory({
      kind: "single",
      config: makeConfig("SAM"),
      dataVersion: "snapshot-version",
      startedAtISO: start,
    });
    const first = {
      ...original,
      gear: original.gear.map((x) => ({ ...x, name: "equivalent A" })),
    };
    const last = {
      ...original,
      gear: original.gear.map((x) => ({ ...x, name: "equivalent B" })),
    };
    await Promise.all([
      finishSearchHistory(record.id, {
        status: "completed",
        result: original,
        finishedAtISO: finish,
      }),
      replaceSearchHistoryResult(record.id, first),
      replaceSearchHistoryResult(record.id, last),
    ]);
    const saved = await getSearchHistoryRecord(record.id);
    expect(
      saved?.result && "gear" in saved.result && saved.result.gear[0]?.name,
    ).toBe("equivalent B");
    expect(
      saved?.result && "food" in saved.result && saved.result.food.actualStats,
    ).toEqual({ DET: 12 });
    expect(
      saved?.result && "food" in saved.result && saved.result.food.utilization,
    ).toBe(40);
    expect(saved?.startedAtISO).toBe(start);
    expect(saved?.finishedAtISO).toBe(finish);
    expect(saved?.dataVersion).toBe("snapshot-version");
    expect(saved?.config).toEqual(record.config);
  });

  it("round-trips complete replacement groups through a real result replacement", async () => {
    fakeDatabase();
    const base = fixtureResult();
    const weapon = base.gear[0]!;
    const headData = gears.find(
      (gear) => gear.jobs.includes("SAM") && gear.slot === "head",
    )!;
    const head = { ...headData, melds: [], finalStats: headData.stats };
    const ringData = gears.find(
      (gear) => gear.jobs.includes("SAM") && gear.slot === "ring",
    )!;
    const ringBase = {
      ...ringData,
      melds: [],
      finalStats: ringData.stats,
      unique: false,
    };
    const weaponGroupKey = "weapon-candidates";
    const headGroupKey = "head-candidates";
    const allRingGroupKey = "all-ring-candidates";
    const uniqueRingGroupKey = "unique-ring-candidates";
    const selectedWeapon = {
      ...weapon,
      replacementGroupKey: weaponGroupKey,
    };
    const replacementA = {
      ...weapon,
      id: weapon.id + 1000,
      name: "同属性武器 A",
    };
    const replacementB = {
      ...weapon,
      id: weapon.id + 2000,
      name: "同属性武器 B",
    };
    const selectedHead = {
      ...head,
      replacementGroupKey: headGroupKey,
    };
    const replacementHead = {
      ...head,
      id: head.id + 1000,
      name: "同属性头部装备",
    };
    const selectedRing = {
      ...ringBase,
      replacementGroupKey: allRingGroupKey,
      uniqueReplacementGroupKey: uniqueRingGroupKey,
    };
    const selectedRing2 = {
      ...ringBase,
      id: ringBase.id + 1,
      name: "当前戒指 2",
      slot: "ring2" as const,
      replacementGroupKey: allRingGroupKey,
      uniqueReplacementGroupKey: uniqueRingGroupKey,
    };
    const ordinaryRing = { ...ringBase, id: ringBase.id + 2 };
    const uniqueRing = { ...ringBase, id: ringBase.id + 3, unique: true };
    const anotherUniqueRing = {
      ...ringBase,
      id: ringBase.id + 4,
      unique: true,
    };
    const completeGroups = {
      [weaponGroupKey]: [weapon, replacementA, replacementB],
      [headGroupKey]: [head, replacementHead],
      [allRingGroupKey]: [
        ringBase,
        ordinaryRing,
        uniqueRing,
        anotherUniqueRing,
      ],
      [uniqueRingGroupKey]: [uniqueRing, anotherUniqueRing],
    };
    const original = {
      ...base,
      gear: [selectedWeapon, selectedHead, selectedRing, selectedRing2],
      equivalentGear: completeGroups,
    };
    const startedAtISO = "2026-10-17T03:00:00.000Z";
    const finishedAtISO = "2026-10-17T03:00:01.500Z";
    const record = await createSearchHistory({
      kind: "single",
      config: makeConfig("SAM"),
      dataVersion: "replacement-group-snapshot",
      startedAtISO,
    });
    await finishSearchHistory(record.id, {
      status: "completed",
      result: original,
      finishedAtISO,
    });

    const firstRead = await getSearchHistoryRecord(record.id);
    expect(firstRead?.kind).toBe("single");
    if (firstRead?.kind !== "single" || !firstRead.result)
      throw new Error("无法读取已完成的单职业记录。");
    expect(firstRead.result.equivalentGear).toEqual(completeGroups);
    expect(firstRead.result.gear[0]).toMatchObject({
      id: weapon.id,
      replacementGroupKey: weaponGroupKey,
    });

    const changed = replaceEquivalentGear(
      firstRead.result,
      "weapon",
      equivalentGearKey(replacementB),
    );
    await replaceSearchHistoryResult(record.id, changed);

    const secondRead = await getSearchHistoryRecord(record.id);
    expect(secondRead?.kind).toBe("single");
    if (secondRead?.kind !== "single" || !secondRead.result)
      throw new Error("无法读取替换后的单职业记录。");
    expect(secondRead.result.gear[0]).toMatchObject({
      id: replacementB.id,
      slot: "weapon",
      replacementGroupKey: weaponGroupKey,
    });
    expect(secondRead.result.gear[1]).toMatchObject({
      id: head.id,
      replacementGroupKey: headGroupKey,
    });
    expect(secondRead.result.gear[2]).toMatchObject({
      replacementGroupKey: allRingGroupKey,
      uniqueReplacementGroupKey: uniqueRingGroupKey,
    });
    expect(secondRead.result.gear[3]).toMatchObject({
      slot: "ring2",
      replacementGroupKey: allRingGroupKey,
      uniqueReplacementGroupKey: uniqueRingGroupKey,
    });
    expect(secondRead.result.equivalentGear).toEqual(completeGroups);
    expect(
      secondRead.result.equivalentGear?.[weaponGroupKey]?.map(({ id }) => id),
    ).toEqual([weapon.id, replacementA.id, replacementB.id]);
    expect(
      secondRead.result.equivalentGear?.[weaponGroupKey]?.some(
        ({ id }) => id === secondRead.result!.gear[0]?.id,
      ),
    ).toBe(true);
    expect(
      secondRead.result.equivalentGear?.[allRingGroupKey]?.map(({ id }) => id),
    ).toEqual([
      ringBase.id,
      ordinaryRing.id,
      uniqueRing.id,
      anotherUniqueRing.id,
    ]);
    expect(
      secondRead.result.equivalentGear?.[uniqueRingGroupKey]?.map(
        ({ id }) => id,
      ),
    ).toEqual([uniqueRing.id, anotherUniqueRing.id]);
    expect(secondRead.result).toMatchObject({
      calculationLevel: original.calculationLevel,
      food: original.food,
      stats: original.stats,
      effects: original.effects,
      score: original.score,
      objective: original.objective,
      damagePerSecond: original.damagePerSecond,
      gcdTier: original.gcdTier,
      searchedCandidates: original.searchedCandidates,
      durationMs: original.durationMs,
    });
    expect(secondRead.startedAtISO).toBe(startedAtISO);
    expect(secondRead.finishedAtISO).toBe(finishedAtISO);
    expect(secondRead.dataVersion).toBe("replacement-group-snapshot");
    expect(secondRead.config).toEqual(record.config);
  });
});

describe("history list tolerates individual invalid payloads", () => {
  it("lists completed searches despite invalid single/joint records without deleting or migrating them", async () => {
    vi.resetModules();
    const service = await import("./search-history");
    const stored = fakeDatabase();
    const first = await service.createSearchHistory({
      kind: "single",
      config: makeConfig("SAM"),
      dataVersion: "test",
      startedAtISO: "2026-10-18T00:00:00.000Z",
    });
    await service.finishSearchHistory(first.id, {
      status: "completed",
      result: fixtureResult(),
      finishedAtISO: "2026-10-18T00:00:01.000Z",
    });
    const second = await service.createSearchHistory({
      kind: "single",
      config: { ...makeConfig("SAM"), minItemLevel: 10 },
      dataVersion: "test",
      startedAtISO: "2026-10-18T00:00:02.000Z",
    });
    await service.finishSearchHistory(second.id, {
      status: "completed",
      result: fixtureResult(),
      finishedAtISO: "2026-10-18T00:00:03.000Z",
    });
    const obsolete = {
      ...(await service.getSearchHistoryRecord(first.id)),
      id: "obsolete-single",
      result: { ...fixtureResult(), food: foods[0] },
    };
    const malformed = {
      id: "invalid-joint",
      kind: "joint",
      status: "completed",
    };
    stored.set(obsolete.id, obsolete);
    stored.set(malformed.id, malformed);
    expect(
      (await service.listSearchHistory("single")).map((record) => record.id),
    ).toEqual([second.id, first.id]);
    expect(
      (await service.listSearchHistory()).map((record) => record.id),
    ).toEqual([second.id, first.id]);
    expect(await service.listSearchHistory("joint")).toEqual([]);
    expect((await service.getSearchHistoryRecord(second.id))?.status).toBe(
      "completed",
    );
    await expect(service.getSearchHistoryRecord(obsolete.id)).rejects.toThrow(
      "结果缺少必要字段",
    );
    expect(stored.size).toBe(4);
    expect(stored.get(obsolete.id)).toEqual(obsolete);
    expect(stored.get(malformed.id)).toEqual(malformed);
  });
  it("still reports a database read failure", async () => {
    vi.resetModules();
    const service = await import("./search-history");
    fakeDatabase();
    const spy = vi.spyOn(window.indexedDB, "open").mockImplementation(() => {
      throw new Error("database unavailable");
    });
    await expect(service.listSearchHistory()).rejects.toThrow(
      "database unavailable",
    );
    spy.mockRestore();
  });
});

describe("completed-only history", () => {
  it("saves and replaces the same configuration regardless of missing or changed version metadata", async () => {
    vi.resetModules();
    const service = await import("./search-history");
    const stored = fakeDatabase();
    const input = {
      kind: "single" as const,
      config: makeConfig("SAM"),
      result: fixtureResult(),
      startedAtISO: "2026-10-19T00:00:00.000Z",
      finishedAtISO: "2026-10-19T00:00:01.000Z",
    };
    const first = await service.saveCompletedSearchHistory(input);
    const second = await service.saveCompletedSearchHistory({ ...input, dataVersion: "display-only" });
    const third = await service.saveCompletedSearchHistory(input);
    expect(first.id).toBe(second.id);
    expect(second.id).toBe(third.id);
    expect(stored.size).toBe(1);
    expect(await service.listSearchHistory()).toEqual([third]);
  });
  it("saves a complete snapshot in a single write and preserves search timestamps", async () => {
    vi.resetModules();
    const service = await import("./search-history");
    const stored = fakeDatabase();
    const changed = vi.fn();
    window.addEventListener("search-history-changed", changed);
    try {
      const input = {
        kind: "single" as const,
        config: {
          ...makeConfig("SAM"),
          forcedGear: {
            weapon: {
              id: 39920,
              customStats: { CRT: 209, DET: 209, SKS: 51, TEN: 0 },
            },
            head: {
              id: gears.find((gear) => gear.slot === "head")!.id,
              melds: [
                { stat: "DHT" as const, value: 54, grade: 12 },
                null,
              ],
            },
          },
        },
        result: fixtureResult(),
        dataVersion: "snapshot-version",
        startedAtISO: "2026-10-19T00:00:00.000Z",
        finishedAtISO: "2026-10-19T00:00:02.000Z",
      };
      const pending = service.saveCompletedSearchHistory(input);
      expect(stored.size).toBe(0);
      expect(changed).not.toHaveBeenCalled();
      const record = await pending;
      expect(record).toMatchObject({
        ...input,
        config: JSON.parse(JSON.stringify(input.config)),
        status: "completed",
      });
      expect(stored.size).toBe(1);
      expect(stored.get(record.id)).toEqual(record);
      expect(changed).toHaveBeenCalledOnce();
      const restored = await service.listSearchHistory();
      expect(restored).toEqual([record]);
      expect(restored[0]!.kind).toBe("single");
      if (restored[0]!.kind === "single")
        expect(restored[0]!.config.forcedGear).toEqual(input.config.forcedGear);
      for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
        for (const forcedValue of [id, { id, melds: [] }, { id, customStats: {} }]) {
          expect(() => service.validateSearchHistoryRecord({
            ...record,
            config: { ...input.config, forcedGear: { weapon: forcedValue } },
          })).toThrow();
        }
      }
    } finally {
      window.removeEventListener("search-history-changed", changed);
    }
  });

  it("hashes the entire stable config and replaces matching keys across versions", async () => {
    vi.resetModules();
    const service = await import("./search-history");
    const stored = fakeDatabase();
    const config = makeConfig("SAM");
    const input = {
      kind: "single" as const,
      config,
      result: fixtureResult(),
      dataVersion: "first",
      startedAtISO: "2026-10-19T00:00:00.000Z",
      finishedAtISO: "2026-10-19T00:00:01.000Z",
    };
    const first = await service.saveCompletedSearchHistory(input);
    stored.set(first.id, { ...first, error: "旧字段", legacyField: true });
    const reordered = Object.fromEntries(
      Object.entries(config).reverse(),
    ) as typeof config;
    const second = await service.saveCompletedSearchHistory({
      ...input,
      config: reordered,
      dataVersion: "second",
      result: { ...input.result, durationMs: 42 },
      startedAtISO: "2026-10-19T00:00:01.000Z",
      finishedAtISO: "2026-10-19T00:00:02.000Z",
    });
    expect(first.id).toMatch(/^[a-f0-9]{64}$/);
    expect(second.id).toBe(first.id);
    expect(stored.size).toBe(1);
    expect(stored.get(first.id)).toEqual(second);
    expect(stored.get(first.id)).not.toHaveProperty("error");
    expect(stored.get(first.id)).not.toHaveProperty("legacyField");
    expect(await service.listSearchHistory()).toEqual([second]);
    expect(second.kind === "single" && second.result.durationMs).toBe(42);
    const different = await service.saveCompletedSearchHistory({
      ...input,
      config: { ...config, minItemLevel: config.minItemLevel + 1 },
    });
    expect(different.id).not.toBe(first.id);
    expect(stored.size).toBe(2);
  });

  it("persists the clicked duty in completed snapshots without changing the sync target", async () => {
    vi.resetModules();
    const service = await import("./search-history");
    fakeDatabase();
    const duty = gameData.sync.groups.flatMap(({ options }) => options).find(({ target }) => target.kind === "itemLevel")!;
    const record = await service.saveCompletedSearchHistory({
      kind: "single",
      config: { ...makeConfig("SAM"), sync: duty.target, syncDuty: duty.name },
      result: fixtureResult(),
      startedAtISO: "2026-10-24T00:00:00.000Z",
      finishedAtISO: "2026-10-24T00:00:01.000Z",
    });
    const restored = await service.getSearchHistoryRecord(record.id);
    expect(restored?.config).toMatchObject({ sync: duty.target, syncDuty: duty.name });
    expect(() => service.validateSearchHistoryRecord({ ...record, config: { ...record.config, syncDuty: 123 } })).toThrow();
  });

  it("omits legacy unsuccessful records from history without rewriting stored data", async () => {
    vi.resetModules();
    const service = await import("./search-history");
    const stored = fakeDatabase();
    const running = await service.createSearchHistory({
      kind: "single",
      config: makeConfig("SAM"),
      dataVersion: "test",
    });
    for (const [index, status] of ([
      "cancelled",
      "failed",
      "no-result",
      "interrupted",
    ] as const).entries()) {
      const record = await service.createSearchHistory({
        kind: "single",
        config: { ...makeConfig("SAM"), minItemLevel: index + 1 },
        dataVersion: "test",
      });
      await service.finishSearchHistory(
        record.id,
        status === "failed" ? { status, error: "failed" } : { status },
      );
    }
    expect(await service.listSearchHistory()).toEqual([]);
    expect(stored.size).toBe(5);
    expect(await service.getSearchHistoryRecord(running.id)).toEqual(running);
  });
});
