import { describe, expect, it } from "vitest";
import type { OptimizationResult } from "@/domain";
import type { SearchHistoryRecord } from "@/ui/services/search-history";
import {
  historyComparisonEntry,
  historyComparisonOptions,
} from "./history-entry";

const result = {
  calculationLevel: 80,
  gear: [],
  food: {
    id: 100,
    name: "saved food",
    level: 700,
    stats: { DET: 20 },
    statRates: {},
    sourceFile: "saved.json",
  },
  stats: { STR: 1234 },
  effects: {
    crtChance: 0.2,
    crtDamage: 1.4,
    detDamage: 1.1,
    dhtChance: 0.05,
    tenDamage: 1,
    tenMitigation: 0.01,
    damage: 456.78,
    gcd: 2.5,
    hp: 1000,
    mp: 1000,
  },
  damagePerSecond: 789.12,
} as unknown as OptimizationResult;

function record(overrides: Record<string, unknown> = {}): SearchHistoryRecord {
  return {
    id: "history-1",
    kind: "single",
    status: "completed",
    startedAtISO: "2026-10-17T00:00:00.000Z",
    dataVersion: "saved-version",
    config: { jobId: "PLD", syncLevel: 660 },
    result,
    ...overrides,
  } as unknown as SearchHistoryRecord;
}

describe("history comparison adapter", () => {
  it("uses the stored result snapshot without recalculating stats or effects", () => {
    const adapted = historyComparisonEntry(record(), "PLD");
    expect(adapted.dataVersion).toBe("saved-version");
    expect(adapted.snapshot.calculationLevel).toBe(80);
    expect(adapted.snapshot.gear).toBe(result.gear);
    expect(adapted.snapshot.food).toBe(result.food);
    expect(adapted.snapshot.stats).toBe(result.stats);
    expect(adapted.snapshot.effects).toBe(result.effects);
    expect(adapted.snapshot.damagePerPotency).toBe(456.78);
    expect(adapted.snapshot.damagePerSecond).toBe(789.12);
  });

  it("extracts only the requested completed Joint profession result", () => {
    const jointRecord = record({
      kind: "joint",
      config: { jobs: [{ jobId: "PLD", syncLevel: 660 }, { jobId: "WAR" }] },
      result: { jobResults: { PLD: result, WAR: undefined } },
    });
    expect(historyComparisonOptions([jointRecord], "PLD")).toHaveLength(1);
    expect(historyComparisonOptions([jointRecord], "WAR")).toHaveLength(0);
    expect(
      historyComparisonEntry(jointRecord, "PLD").snapshot.damagePerSecond,
    ).toBe(789.12);
  });

  it("does not offer unfinished, wrong-job, or missing-level history records", () => {
    const unfinished = record({ status: "running" });
    const wrongJob = record({ config: { jobId: "WAR" } });
    const noLevel = record({
      result: { ...result, calculationLevel: undefined },
    });
    expect(
      historyComparisonOptions([unfinished, wrongJob, noLevel], "PLD"),
    ).toEqual([]);
  });
});
