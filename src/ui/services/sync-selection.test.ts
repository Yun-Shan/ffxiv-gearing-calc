import { describe, expect, it } from "vitest";
import { gameData } from "@/domain";
import { makeConfig } from "./app-config";
import {
  jointConfigForDomain,
  optimizationConfigForDomain,
} from "./search-config";
import { syncSummaryLabel, syncTargetLabel } from "./sync-selection";
import { jobConditionDraftFromConfig } from "@/ui/features/job-condition/draft";
import { compileJobCondition } from "@/ui/features/job-condition/compiler";
import {
  gcdAnalysisInputFromConfig,
  gcdAnalysisKey,
} from "@/ui/features/job-condition/gcd-analysis";

const duties = gameData.sync.groups.flatMap(({ options }) => options);

describe("selected sync duty provenance", () => {
  it.each(["itemLevel", "jobLevel"] as const)(
    "round-trips the selected %s duty and formats its own name",
    (kind) => {
      const duty = duties.find(({ target }) => target.kind === kind)!;
      const config = {
        ...makeConfig("PLD"),
        sync: duty.target,
        syncDuty: duty.name,
      };
      const draft = jobConditionDraftFromConfig(config);
      const compiled = compileJobCondition(draft, { jobId: "PLD" }).config;
      expect(draft.range.syncDuty).toBe(duty.name);
      expect(compiled.syncDuty).toBe(duty.name);
      expect(syncSummaryLabel(compiled.sync, compiled.syncDuty)).toBe(
        `${duty.name}(${kind === "itemLevel" ? `品级${duty.target.value}` : `${duty.target.value}级`})`,
      );
      expect(syncTargetLabel(compiled.sync, compiled.syncDuty)).toBe(
        syncSummaryLabel(compiled.sync, compiled.syncDuty),
      );
    },
  );

  it("keeps numeric selections numeric without deriving a duty name", () => {
    const duty = duties.find(({ target }) => target.kind === "itemLevel")!;
    expect(syncSummaryLabel(duty.target)).toBe(String(duty.target.value));
    expect(syncTargetLabel(duty.target)).toBe(`品级 ${duty.target.value}`);
    expect(syncTargetLabel({ kind: "jobLevel", value: 90 })).toBe("90级");
    expect(syncSummaryLabel({ kind: "jobLevel", value: 90 })).toBe("90级");
  });

  it("excludes duty metadata from domain requests and GCD identity", () => {
    const duty = duties.find(({ target }) => target.kind === "itemLevel")!;
    const config = {
      ...makeConfig("PLD"),
      sync: duty.target,
      syncDuty: duty.name,
    };
    const { syncDuty: _name, ...numericConfig } = config;
    expect(optimizationConfigForDomain(config)).toEqual(numericConfig);
    expect(optimizationConfigForDomain(config)).not.toHaveProperty("syncDuty");
    const joint = {
      objective: "damage" as const,
      jobs: [config],
      commonSlots: [],
      foodStrategy: "shared" as const,
    };
    expect(jointConfigForDomain(joint).jobs[0]).toEqual(numericConfig);
    const input = gcdAnalysisInputFromConfig(config);
    expect(input).not.toHaveProperty("syncDuty");
    expect(gcdAnalysisKey(input)).toBe(
      gcdAnalysisKey(gcdAnalysisInputFromConfig(numericConfig)),
    );
    expect(config.syncDuty).toBe(duty.name);
  });
});
