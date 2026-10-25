import type { Gear, JobId, JobSchema, Stat, Stats } from "./types.ts";

const beastmasterItemSpecialBonuses = [11] as const;

/** The supported bonus is enabled only for Beastmaster. */
export function enabledItemSpecialBonusesForJob(jobId: JobId): number[] {
  return jobId === "BST" ? [...beastmasterItemSpecialBonuses] : [];
}

/**
 * 参考实现 `Gear.stats` 的特殊加成：先完成同步封顶与魔晶石封顶，再按职业解析并追加
 * `specialStats`，且追加值不参与任何封顶。未启用或不匹配的加成不追加。
 */
export function itemSpecialBonusAdditions(
  gear: Pick<Gear, "itemSpecialBonus" | "specialStats">,
  job: JobSchema,
  enabledBonuses: readonly number[] = [],
): Stats {
  if (
    gear.itemSpecialBonus === undefined ||
    !enabledBonuses.includes(gear.itemSpecialBonus) ||
    gear.specialStats === undefined
  ) {
    return {};
  }
  const additions: Stats = {};
  for (const [rawStat, value] of Object.entries(gear.specialStats)) {
    if (value === undefined) continue;
    const stat: Stat = rawStat === "main"
      ? job.mainStat
      : rawStat === "secondary"
        ? job.secondaryStat
        : rawStat as Stat;
    additions[stat] = (additions[stat] ?? 0) + value;
  }
  return additions;
}

/** 把已启用的特殊加成追加到已封顶的最终属性上。 */
export function applyItemSpecialBonus(
  stats: Stats,
  gear: Pick<Gear, "itemSpecialBonus" | "specialStats">,
  job: JobSchema,
  enabledBonuses: readonly number[] = [],
): Stats {
  const additions = itemSpecialBonusAdditions(gear, job, enabledBonuses);
  if (Object.keys(additions).length === 0) return stats;
  const result: Stats = { ...stats };
  for (const [stat, value] of Object.entries(additions) as [Stat, number][])
    result[stat] = (result[stat] ?? 0) + value;
  return result;
}
