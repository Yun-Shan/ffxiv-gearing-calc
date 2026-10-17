import { afterEach, describe, expect, it } from "vitest";
import { gameData } from "./data";
import { currentLevel, jobIds, jobSchemas } from "./jobs";
import { calculationJobLevelFor, jobLevelFor } from "./job-level";
import type { JobId } from "./types";

const originalSamCap = jobSchemas.SAM.maxJobLevel;
const originalSyncGroups = structuredClone(gameData.syncLevels);
const originalExactMappings = { ...gameData.syncLevelOfJobLevels };
afterEach(() => {
  jobSchemas.SAM.maxJobLevel = originalSamCap;
  gameData.syncLevels = structuredClone(originalSyncGroups);
  gameData.syncLevelOfJobLevels = { ...originalExactMappings };
});

describe("job cap and formula level resolution", () => {
  it("uses every job's own cap without a character-level input", () => {
    for (const jobId of jobIds) {
      const cap = jobSchemas[jobId].maxJobLevel ?? currentLevel;
      expect(jobLevelFor({ jobId })).toBe(cap);
      expect(calculationJobLevelFor({ jobId })).toBe(cap);
    }
    jobSchemas.SAM.maxJobLevel = undefined;
    expect(jobLevelFor({ jobId: "SAM" })).toBe(currentLevel);
  });
  it("uses sync-group mappings and clamps them to the limited job cap", () => {
    for (const [mapped, syncLevels] of Object.entries(originalSyncGroups)) {
      for (const syncLevel of syncLevels) {
        expect(calculationJobLevelFor({ jobId: "SAM", syncLevel })).toBe(
          Math.min(Number(mapped), currentLevel),
        );
        expect(calculationJobLevelFor({ jobId: "BLU", syncLevel })).toBe(
          Math.min(Number(mapped), jobSchemas.BLU.maxJobLevel!),
        );
      }
    }
  });
  it("accepts an exact level mapping outside the common groups", () => {
    gameData.syncLevels = {};
    const syncLevel = originalExactMappings[80]!;
    expect(calculationJobLevelFor({ jobId: "SAM", syncLevel })).toBe(80);
  });
  it("rejects missing job rules, invalid caps and unsupported sync mappings", () => {
    expect(() => jobLevelFor({ jobId: "NOPE" as JobId })).toThrow(
      "缺少职业 NOPE",
    );
    for (const cap of [70.5, 999]) {
      jobSchemas.SAM.maxJobLevel = cap;
      expect(() => jobLevelFor({ jobId: "SAM" })).toThrow("不支持的职业等级");
    }
    jobSchemas.SAM.maxJobLevel = originalSamCap;
    expect(() =>
      calculationJobLevelFor({ jobId: "SAM", syncLevel: -1 }),
    ).toThrow("不支持的等级同步品级");
    gameData.syncLevels = {};
    for (const invalidLevel of [70.5, 49]) {
      gameData.syncLevelOfJobLevels = { [invalidLevel]: 123456 };
      expect(() =>
        calculationJobLevelFor({ jobId: "SAM", syncLevel: 123456 }),
      ).toThrow("不支持的职业等级");
    }
  });
});
