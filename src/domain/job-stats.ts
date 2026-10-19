import type { JobSchema, Stat, Stats } from "./types.ts";

/** 参考实现中基础属性表始终包含的属性，与职业 schema 无关。 */
const universalGearStats: ReadonlySet<Stat> = new Set(["PDMG", "MDMG", "DLY"]);

/**
 * 参考实现 `Store.equippedStatsWithoutFood` 只合并职业属性结构中已有的属性。
 * 不属于职业的属性（例如驯兽师可穿戴装备上的坚韧、信仰）不参与总属性计算。
 */
export function isStatApplicableToJob(job: JobSchema, stat: Stat): boolean {
  return universalGearStats.has(stat) || job.stats.includes(stat);
}

/** 仅保留该职业参与总属性计算的属性。 */
export function filterStatsForJob(stats: Stats, job: JobSchema): Stats {
  const result: Stats = {};
  for (const [key, value] of Object.entries(stats)) {
    if (value === undefined) continue;
    const stat = key as Stat;
    if (!isStatApplicableToJob(job, stat)) continue;
    result[stat] = value;
  }
  return result;
}

/** 按职业适用属性合并多项属性来源。 */
export function addStatsForJob(job: JobSchema, ...items: readonly Stats[]): Stats {
  const result: Stats = {};
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined) continue;
      const stat = key as Stat;
      if (!isStatApplicableToJob(job, stat)) continue;
      result[stat] = (result[stat] ?? 0) + value;
    }
  }
  return result;
}
