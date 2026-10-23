import { gameData } from "./data.ts";
import { currentLevel, jobSchemas } from "./jobs.ts";
import type { OptimizationConfig, SyncTarget } from "./types.ts";

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
  config: Pick<OptimizationConfig, "jobId" | "sync">,
): number {
  const maxLevel = jobLevelFor(config);
  const target = config.sync;
  if (target === undefined) return maxLevel;
  const mappedLevel = syncTargetJobLevel(target);
  const level = Math.min(mappedLevel, maxLevel);
  if (
    !Number.isSafeInteger(level) ||
    !Object.hasOwn(gameData.jobLevelModifiers, level)
  ) {
    throw new RangeError(`不支持的职业等级：${level}`);
  }
  return level;
}

/** Resolves a target's declared job level before applying a selected job's cap. */
export function syncTargetJobLevel(target: SyncTarget): number {
  if (!isSyncTarget(target)) throw new RangeError("同步目标无效");
  if (target.kind === "jobLevel") {
    assertSupportedJobLevel(target.value);
    return target.value;
  }
  if (target.value < 90)
    throw new RangeError("同步品级必须是大于等于 90 的安全整数。");
  const mappedLevel = resolveItemLevelJobLevel(target.value);
  if (mappedLevel === undefined)
    throw new RangeError("此品级暂无可用计算等级。");
  assertSupportedItemLevel(target.value);
  return mappedLevel;
}

export function syncTargetCalculationError(target: SyncTarget): string | undefined {
  if (!isSyncTarget(target)) return "同步目标无效。";
  if (target.kind === "jobLevel") {
    if (!gameData.sync.levels.some(({ jobLevel }) => jobLevel === target.value))
      return "不支持此等级同步。";
    return undefined;
  }
  if (target.value < 90)
    return "同步品级必须是大于等于 90 的安全整数。";
  try {
    const level = resolveItemLevelJobLevel(target.value);
    if (level === undefined) return "此品级暂无可用计算等级。";
    assertSupportedItemLevel(target.value);
  } catch {
    return "此品级暂无完整属性上限数据。";
  }
  return undefined;
}

function resolveItemLevelJobLevel(itemLevel: number): number | undefined {
  return gameData.sync.levels
    .findLast(({ minItemLevel }) => minItemLevel <= itemLevel)?.jobLevel;
}

function isSyncTarget(target: SyncTarget): boolean {
  return target !== null && typeof target === "object" &&
    (target.kind === "jobLevel" || target.kind === "itemLevel") &&
    Number.isSafeInteger(target.value);
}

function assertSupportedJobLevel(level: number): void {
  if (!gameData.sync.levels.some(({ jobLevel }) => jobLevel === level))
    throw new RangeError(`不支持的等级同步：${level}`);
}

function assertSupportedItemLevel(itemLevel: number): void {
  if (!gameData.levelCaps.level.includes(itemLevel))
    throw new RangeError("此品级暂无完整属性上限数据。");
}
