import { gameData } from "./data.ts";
import { jobSchemas } from "./jobs.ts";
import { concretizeGearStats } from "./rules.ts";
import type {
  CustomizableStat,
  Gear,
  JobId,
  JobSchema,
  Materia,
  Stat,
  Stats,
} from "./types.ts";

const nonMateriaStats = new Set<Stat>([
  "STR",
  "DEX",
  "INT",
  "MND",
  "VIT",
  "PDMG",
  "MDMG",
  "DLY",
]);

function fail(message: string): never {
  throw new Error(message);
}

function validateCustomStats(customStats: Stats | undefined): Stats {
  const validated: Stats = {};
  for (const [rawStat, value] of Object.entries(customStats ?? {})) {
    if (
      nonMateriaStats.has(rawStat as Stat) ||
      !Number.isSafeInteger(value) ||
      value! < 0 ||
      value! > 1000
    ) {
      fail(`自定义装备属性 ${rawStat} 的数值无效`);
    }
    validated[rawStat as Stat] = value;
  }
  return validated;
}

function statTotals(melds: readonly Materia[]): Stats {
  const result: Stats = {};
  for (const meld of melds) {
    result[meld.stat] = (result[meld.stat] ?? 0) + meld.value;
  }
  return result;
}

function sameStatTotals(left: Stats, right: Stats): boolean {
  const stats = new Set([
    ...Object.keys(left),
    ...Object.keys(right),
  ] as Stat[]);
  return [...stats].every((stat) => (left[stat] ?? 0) === (right[stat] ?? 0));
}

/** The twelve source-defined 2-big + 1-small allocations for Manderville weapons. */
export function customParameterMelds(gear: Gear): Materia[][] {
  const slots = gear.customParameters;
  if (!slots?.length) return [];
  if (slots.length !== 4) {
    throw new Error(
      `自定义参数武器 ${gear.id} 的槽位数 ${slots.length} 不是 4，无法按 2 big + 1 small + 1 空槽规则生成候选`,
    );
  }
  const result: Materia[][] = [];
  for (let smallIndex = 0; smallIndex < slots.length; smallIndex++) {
    const remaining = slots
      .map((_, index) => index)
      .filter((index) => index !== smallIndex);
    for (let first = 0; first < remaining.length; first++) {
      for (let second = first + 1; second < remaining.length; second++) {
        const bigA = slots[remaining[first]!]!;
        const bigB = slots[remaining[second]!]!;
        const small = slots[smallIndex]!;
        result.push([
          { stat: bigA.stat, value: bigA.bigValue, grade: 0 },
          { stat: bigB.stat, value: bigB.bigValue, grade: 0 },
          { stat: small.stat, value: small.smallValue, grade: 0 },
        ]);
      }
    }
  }
  return result;
}

export function fixedCustomParameterMelds(
  gear: Gear,
  customStats: Stats | undefined,
  job: JobSchema,
): Materia[] {
  if (customStats === undefined) {
    return fail(`自定义参数武器 ${gear.id} 缺少完整参数`);
  }
  const overrides = validateCustomStats(customStats);
  const allowedStats = new Set(gear.customParameters?.map(({ stat }) => stat));
  for (const stat of Object.keys(overrides) as Stat[]) {
    if (!allowedStats.has(stat as CustomizableStat)) {
      return fail(`自定义参数武器 ${gear.id} 不支持 ${stat} 参数`);
    }
  }
  const baseStats = concretizeGearStats(gear.stats, job);
  const requestedTotals: Stats = {};
  for (const stat of allowedStats) {
    const absoluteValue = overrides[stat] ?? baseStats[stat] ?? 0;
    const allocation = absoluteValue - (baseStats[stat] ?? 0);
    if (!Number.isSafeInteger(allocation) || allocation < 0) {
      return fail(`自定义参数武器 ${gear.id} 的 ${stat} 参数低于装备基础属性`);
    }
    if (allocation > 0) requestedTotals[stat] = allocation;
  }
  const selected = customParameterMelds(gear).find((melds) =>
    sameStatTotals(requestedTotals, statTotals(melds)),
  );
  if (selected === undefined) {
    return fail(`自定义参数武器 ${gear.id} 的参数不符合 2 大 + 1 小分配规则`);
  }
  return selected;
}

export function resistanceAllocation(
  gear: Gear,
  customStats: Stats | undefined,
  job: JobSchema,
): Materia[] {
  const adjustment = gear.resistanceWeaponAdjust!;
  const resolvedStats = concretizeGearStats(gear.stats, job);
  const overrides = validateCustomStats(customStats);
  const allowedStats = new Set(adjustment.stats);
  for (const stat of Object.keys(overrides) as Stat[]) {
    if (!allowedStats.has(stat as CustomizableStat)) {
      return fail(`义军武器 ${gear.id} 不支持 ${stat} 参数`);
    }
  }
  const allocations: Materia[] = [];
  let total = 0;
  for (const stat of adjustment.stats) {
    const absoluteValue = overrides[stat] ?? resolvedStats[stat] ?? 0;
    const allocation = absoluteValue - (resolvedStats[stat] ?? 0);
    if (
      !Number.isSafeInteger(allocation) ||
      allocation < 0 ||
      allocation > adjustment.maxEachStat
    ) {
      return fail(`义军武器 ${gear.id} 的 ${stat} 分配超过单项上限`);
    }
    total += allocation;
    if (allocation > 0) allocations.push({ stat, value: allocation, grade: 0 });
  }
  if (!Number.isSafeInteger(total) || total > adjustment.maxTotalStats) {
    return fail(
      `义军武器 ${gear.id} 的总分配属性超过 ResistanceWeaponAdjust 上限`,
    );
  }
  return allocations;
}

export function fixedCustomEquipmentMelds(
  gear: Gear,
  jobId: JobId,
  customStats: Stats,
): Materia[] {
  if (
    gear.customParameters === undefined &&
    gear.resistanceWeaponAdjust === undefined
  ) {
    return fail(`装备 ${gear.id} 不支持自定义参数`);
  }
  if (
    gear.customParameters !== undefined &&
    gear.resistanceWeaponAdjust !== undefined
  ) {
    return fail(`装备 ${gear.id} 同时包含两种自定义参数规则`);
  }
  const job = jobSchemas[jobId];
  return gear.customParameters !== undefined
    ? fixedCustomParameterMelds(gear, customStats, job)
    : resistanceAllocation(gear, customStats, job);
}

export function validateCustomEquipmentStats(
  gear: Gear,
  jobId: JobId,
  customStats: Stats,
): Stats {
  const melds = fixedCustomEquipmentMelds(gear, jobId, customStats);
  const base = concretizeGearStats(gear.stats, jobSchemas[jobId]);
  const stats =
    gear.customParameters?.map(({ stat }) => stat) ??
    gear.resistanceWeaponAdjust!.stats;
  const result: Stats = Object.fromEntries(
    stats.map((stat) => [stat, base[stat] ?? 0]),
  );
  for (const meld of melds)
    result[meld.stat] = (result[meld.stat] ?? 0) + meld.value;
  return result;
}
