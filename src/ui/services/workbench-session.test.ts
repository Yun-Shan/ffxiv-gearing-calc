// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import realSearch from "@/share/__fixtures__/real-search.json";
import { restoreShare } from "@/share/restore";
import { workbenchResultFromShare } from "./share-link";
import { currentDataVersion, makeConfig } from "./app-config";
import { jobConditionDraftFromConfig } from "@/ui/features/job-condition/draft";
import { createJointWorkbenchDraft } from "@/ui/pages/joint-workbench/joint-workbench-state";
import type { SingleDraft } from "@/ui/pages/single-workbench/state/useSingleController";
import {
  clearWorkbenchSession,
  readWorkbenchSession,
  sessionError,
  writeWorkbenchSession,
} from "./workbench-session";
import type {
  WorkbenchSession,
  WorkbenchSessionOptions,
} from "./workbench-session";

function singleDraft(): SingleDraft {
  return {
    jobId: "PLD",
    condition: {
      ...jobConditionDraftFromConfig(makeConfig("PLD")),
      gcd: { mode: "tiers", tiers: [] },
      tank: { strategy: "tenacity" },
    },
    equipment: { excludedSources: [], excludedGearIds: [], forcedGear: {} },
  };
}
function conditions(): WorkbenchSession {
  return { mode: "single", phase: "conditions", draft: singleDraft() };
}
function storedKey(): string {
  return window.sessionStorage.key(0)!;
}
function rewriteRecord(change: (record: Record<string, unknown>) => void) {
  const key = storedKey();
  const record = JSON.parse(window.sessionStorage.getItem(key)!);
  change(record);
  window.sessionStorage.setItem(key, JSON.stringify(record));
}
beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("workbench refresh session", () => {
  it("silently handles missing data and preserves successful reads until explicitly cleared", () => {
    expect(readWorkbenchSession()).toEqual({});
    const session = conditions();
    expect(writeWorkbenchSession(session)).toBeUndefined();
    expect(readWorkbenchSession()).toEqual({ session });
    expect(readWorkbenchSession()).toEqual({ session });
    clearWorkbenchSession();
    expect(readWorkbenchSession()).toEqual({});
  });

  it("round-trips incomplete single Drafts without compiling them to searchable configs", () => {
    const draft = singleDraft();
    draft.condition.range = {
      ...draft.condition.range,
      minItemLevel: 800,
      maxItemLevel: 700,
    };
    draft.condition.food = { mode: "specific", foodId: 123456 };
    for (const tank of [
      { strategy: "tenacity" },
      { strategy: "reduction" },
    ] as const) {
      draft.condition.tank = tank;
      const session: WorkbenchSession = {
        mode: "single",
        phase: "conditions",
        draft,
      };
      expect(writeWorkbenchSession(session)).toBeUndefined();
      expect(readWorkbenchSession()).toEqual({ session });
    }
    draft.condition.gcd = { mode: "speed", min: 1200, max: undefined };
    expect(
      writeWorkbenchSession({ mode: "single", phase: "conditions", draft }),
    ).toBeUndefined();
    expect(readWorkbenchSession().session).toEqual({
      mode: "single",
      phase: "conditions",
      draft,
    });
  });

  it("retains hidden committed joint foods, empty tiers, missing tank values and forced materia", () => {
    const draft = createJointWorkbenchDraft(["PLD", "WAR"]);
    draft.conditions = {
      ...draft.conditions,
      PLD: {
        ...draft.conditions.PLD,
        food: { mode: "specific", foodId: 123456 },
        tank: { strategy: "reduction" },
      },
    };
    draft.shared.equipment.jobs.PLD = {
      excludedGearIds: [123],
      forcedGear: {
        head: {
          id: 123,
          melds: [null, { stat: "DET", value: 54, grade: 12, slotIndex: 1 }],
        },
      },
    };
    draft.shared.equipment.shared.forcedGear.weapon = {
      id: 456,
      customStats: { CRT: 100, TEN: 0 },
    };
    const session: WorkbenchSession = {
      mode: "joint",
      phase: "conditions",
      draft,
    };
    expect(writeWorkbenchSession(session)).toBeUndefined();
    expect(readWorkbenchSession()).toEqual({ session });
  });

  it.each(realSearch)(
    "round-trips shared and ordinary presentation results: $label",
    (fixture) => {
      const value = workbenchResultFromShare(restoreShare(fixture.binary));
      const shared: WorkbenchSession =
        value.mode === "single"
          ? { mode: "single", phase: "result", value }
          : { mode: "joint", phase: "result", value };
      expect(writeWorkbenchSession(shared)).toBeUndefined();
      expect(readWorkbenchSession()).toEqual({ session: shared });
      const ordinary = structuredClone(shared);
      if (ordinary.mode === "single" && ordinary.phase === "result") {
        Object.assign(ordinary.value.result, {
          searchedCandidates: 82,
          maximumTenacity: 1700,
        });
        ordinary.historyLink = {
          id: "history-config-id",
          startedAtISO: "2026-10-26T01:00:00.000Z",
          dataVersion: currentDataVersion,
          configSignature: "full-config",
          resultSignature: "full-result",
        };
      } else if (ordinary.mode === "joint" && ordinary.phase === "result") {
        Object.assign(ordinary.value.result, {
          proof: { complete: true },
          statistics: { elapsedMs: 30, outerNodes: 123 },
        });
        for (const result of Object.values(ordinary.value.result.jobResults))
          Object.assign(result!, { searchedCandidates: 82 });
      }
      expect(writeWorkbenchSession(ordinary)).toBeUndefined();
      expect(readWorkbenchSession()).toEqual({ session: ordinary });
    },
  );

  it("keeps one active-workbench record per deployment base", () => {
    const first = conditions();
    const second: WorkbenchSession = {
      mode: "joint",
      phase: "conditions",
      draft: createJointWorkbenchDraft(["RDM", "BLM"]),
    };
    expect(writeWorkbenchSession(first, { baseUrl: "/one/" })).toBeUndefined();
    expect(writeWorkbenchSession(second, { baseUrl: "/one/" })).toBeUndefined();
    expect(writeWorkbenchSession(first, { baseUrl: "/two/" })).toBeUndefined();
    expect(window.sessionStorage.length).toBe(2);
    clearWorkbenchSession({ baseUrl: "/one/" });
    expect(readWorkbenchSession({ baseUrl: "/one/" })).toEqual({});
    expect(readWorkbenchSession({ baseUrl: "/two/" })).toEqual({
      session: first,
    });
  });

  it.each([
    (record: Record<string, unknown>) => {
      record.schemaVersion = 2;
    },
    (record: Record<string, unknown>) => {
      record.currentDataVersion = "old-data";
    },
    (record: Record<string, unknown>) => {
      record.mode = "joint";
    },
    (record: Record<string, unknown>) => {
      record.payload = { mode: "single", phase: "conditions", draft: {} };
    },
  ])(
    "clears damaged or version-incompatible records with a warning",
    (change) => {
      writeWorkbenchSession(conditions());
      rewriteRecord(change);
      expect(readWorkbenchSession()).toEqual({ warning: expect.any(String) });
      expect(window.sessionStorage.length).toBe(0);
    },
  );

  it("clears malformed JSON and numerically overflowing JSON", () => {
    for (const raw of [
      "{",
      '{"schemaVersion":1,"currentDataVersion":"' +
        currentDataVersion +
        '","mode":"single","payload":{"mode":"single","phase":"conditions","draft":{"jobId":"PLD","condition":{"range":{"clanIndex":0,"minItemLevel":1e999,"maxItemLevel":800},"gcd":{"mode":"any"},"food":{"mode":"auto"},"tank":{"strategy":"any"}},"equipment":{"excludedSources":[],"excludedGearIds":[],"forcedGear":{}}}}}',
    ]) {
      writeWorkbenchSession(conditions());
      window.sessionStorage.setItem(storedKey(), raw);
      expect(readWorkbenchSession().warning).toBeTruthy();
      expect(window.sessionStorage.length).toBe(0);
    }
  });

  it("rejects damaged shapes, runtime data and nonfinite values before JSON can discard them", () => {
    const base = conditions();
    const invalid = [
      {},
      { ...base, phase: "progress" },
      { ...base, draft: { ...singleDraft(), jobId: "unknown" } },
      { ...base, runtime: {} },
      {
        ...base,
        draft: {
          ...singleDraft(),
          condition: { ...singleDraft().condition, gcd: { mode: "tiers" } },
        },
      },
      ...[NaN, Infinity, -Infinity].map((amount) => ({
        ...base,
        draft: {
          ...singleDraft(),
          equipment: {
            excludedSources: [],
            excludedGearIds: [amount],
            forcedGear: {},
          },
        },
      })),
      {
        ...base,
        draft: {
          ...singleDraft(),
          equipment: {
            excludedSources: [],
            excludedGearIds: [],
            forcedGear: { head: { id: 123, melds: [{}] } },
          },
        },
      },
      { ...base, persist: () => {} },
      { ...base, worker: new Date() },
    ];
    for (const value of invalid) expect(sessionError(value)).toBeTruthy();
    const result = workbenchResultFromShare(
      restoreShare(realSearch[0]!.binary),
    );
    const session = { mode: result.mode, phase: "result", value: result };
    const broken = structuredClone(session);
    if (broken.value.mode === "single")
      delete (
        broken.value.result.effects as Partial<
          typeof broken.value.result.effects
        >
      ).damage;
    else
      delete broken.value.result.jobResults[broken.value.config.jobs[0]!.jobId];
    expect(sessionError(broken)).toBeTruthy();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(sessionError(cyclic)).toBeTruthy();
  });

  it("invalidates previous records on rejected and quota-failed writes", () => {
    writeWorkbenchSession(conditions());
    expect(writeWorkbenchSession({} as WorkbenchSession)).toBeTruthy();
    expect(window.sessionStorage.length).toBe(0);
    writeWorkbenchSession(conditions());
    const quota = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
    expect(writeWorkbenchSession(conditions())).toBeTruthy();
    expect(window.sessionStorage.length).toBe(0);
    quota.mockRestore();
  });

  it("handles blocked getters and all Storage operations without escaping exceptions", () => {
    const deniedProperty = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readWorkbenchSession().warning).toBeTruthy();
    expect(writeWorkbenchSession(conditions())).toBeTruthy();
    expect(() => clearWorkbenchSession()).not.toThrow();
    deniedProperty.mockRestore();
    const blocked: WorkbenchSessionOptions = {
      storage: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    expect(readWorkbenchSession(blocked).warning).toBeTruthy();
    expect(writeWorkbenchSession(conditions(), blocked)).toBeTruthy();
    expect(() => clearWorkbenchSession(blocked)).not.toThrow();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("read blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("remove blocked");
    });
    expect(readWorkbenchSession().warning).toBeTruthy();
    expect(() => clearWorkbenchSession()).not.toThrow();
  });
});
