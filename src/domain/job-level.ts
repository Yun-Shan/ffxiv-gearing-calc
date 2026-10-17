import { gameData } from "./data.ts";
import { currentLevel, jobSchemas } from "./jobs.ts";
import type { OptimizationConfig } from "./types.ts";

/** Wearability always follows the selected job's current level cap. */
export function jobLevelFor(config: Pick<OptimizationConfig, "jobId">): number {
  const schema = jobSchemas[config.jobId];
  if (schema === undefined)
    throw new RangeError(`缺少职业 ${config.jobId} 的领域规则`);
  const level = schema.maxJobLevel ?? currentLevel;
  if (
    !Number.isSafeInteger(level) ||
    !Object.hasOwn(gameData.jobLevelModifiers, level)
  ) {
    throw new RangeError(`不支持的职业等级：${level}`);
  }
  return level;
}

/** Formula level is independent of the equipment candidate pool. */
export function calculationJobLevelFor(
  config: Pick<OptimizationConfig, "jobId" | "syncLevel">,
): number {
  const maxLevel = jobLevelFor(config);
  if (config.syncLevel === undefined) return maxLevel;
  const syncGroup = Object.entries(gameData.syncLevels).find(([, levels]) =>
    levels.includes(config.syncLevel!),
  );
  const exactMatch = Object.entries(gameData.syncLevelOfJobLevels).find(
    ([, syncLevel]) => syncLevel === config.syncLevel,
  );
  const mappedLevel = syncGroup?.[0] ?? exactMatch?.[0];
  if (mappedLevel === undefined) {
    throw new RangeError(`不支持的等级同步品级：${config.syncLevel}`);
  }
  const level = Math.min(Number(mappedLevel), maxLevel);
  if (
    !Number.isSafeInteger(level) ||
    !Object.hasOwn(gameData.jobLevelModifiers, level)
  ) {
    throw new RangeError(`不支持的职业等级：${level}`);
  }
  return level;
}
