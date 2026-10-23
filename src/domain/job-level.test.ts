import { afterEach, describe, expect, it } from "vitest";
import { gameData } from "./data";
import { currentLevel, jobIds, jobSchemas } from "./jobs";
import {
  calculationJobLevelFor,
  jobLevelFor,
  syncTargetCalculationError,
  syncTargetJobLevel,
} from "./job-level";
import type { JobId } from "./types";

const originalSamCap = jobSchemas.SAM.maxJobLevel;
const originalSync = structuredClone(gameData.sync);
const originalLevelCaps = structuredClone(gameData.levelCaps);
afterEach(() => {
  jobSchemas.SAM.maxJobLevel = originalSamCap;
  gameData.sync = structuredClone(originalSync);
  gameData.levelCaps = structuredClone(originalLevelCaps);
});

describe("job cap and formula level resolution", () => {
  it("uses each job cap when sync is disabled and clamps explicit targets to that cap", () => {
    for (const jobId of jobIds) {
      const cap = jobSchemas[jobId].maxJobLevel ?? currentLevel;
      expect(jobLevelFor({ jobId })).toBe(cap);
      expect(calculationJobLevelFor({ jobId })).toBe(cap);
      for (const { jobLevel } of gameData.sync.levels) {
        expect(calculationJobLevelFor({ jobId, sync: { kind: "jobLevel", value: jobLevel } })).toBe(
          Math.min(jobLevel, cap),
        );
      }
    }
    jobSchemas.SAM.maxJobLevel = undefined;
    expect(jobLevelFor({ jobId: "SAM" })).toBe(currentLevel);
  });

  it("maps item levels by their generated lower bounds, including gaps", () => {
    for (let index = 0; index < gameData.sync.levels.length; index++) {
      const row = gameData.sync.levels[index]!;
      expect(syncTargetJobLevel({ kind: "itemLevel", value: row.minItemLevel })).toBe(row.jobLevel);
      expect(calculationJobLevelFor({ jobId: "SAM", sync: { kind: "itemLevel", value: row.minItemLevel } })).toBe(row.jobLevel);
      if (index > 0) {
        expect(syncTargetJobLevel({ kind: "itemLevel", value: row.minItemLevel - 1 })).toBe(gameData.sync.levels[index - 1]!.jobLevel);
      }
    }
    expect(syncTargetCalculationError({ kind: "itemLevel", value: 89 })).toBe("同步品级必须是大于等于 90 的安全整数。");
  });

  it("checks custom item levels against complete stat caps", () => {
    const target = { kind: "itemLevel", value: gameData.sync.levels[0]!.minItemLevel } as const;
    expect(syncTargetCalculationError(target)).toBeUndefined();
    expect(syncTargetJobLevel(target)).toBe(gameData.sync.levels[0]!.jobLevel);
    gameData.levelCaps.level = gameData.levelCaps.level.filter((level) => level !== target.value);
    expect(syncTargetCalculationError(target)).toBe("此品级暂无完整属性上限数据。");
    expect(() => syncTargetJobLevel(target)).toThrow("此品级暂无完整属性上限数据。");
  });

  it("rejects missing job rules and malformed or unsupported targets", () => {
    expect(() => jobLevelFor({ jobId: "NOPE" as JobId })).toThrow("缺少职业 NOPE");
    for (const cap of [70.5, 999]) {
      jobSchemas.SAM.maxJobLevel = cap;
      expect(() => jobLevelFor({ jobId: "SAM" })).toThrow("不支持的职业等级");
    }
    jobSchemas.SAM.maxJobLevel = originalSamCap;
    expect(() => calculationJobLevelFor({ jobId: "SAM", sync: { kind: "jobLevel", value: 49 } })).toThrow("不支持的等级同步");
    expect(() => calculationJobLevelFor({ jobId: "SAM", sync: { kind: "itemLevel", value: 89 } })).toThrow("同步品级必须");
    expect(() => calculationJobLevelFor({ jobId: "SAM", sync: { kind: "invalid", value: 90 } as never })).toThrow("同步目标无效");
    expect(syncTargetCalculationError({ kind: "invalid", value: 90 } as never)).toBe("同步目标无效。");
  });
});
