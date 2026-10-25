import { clanCount } from "./clans.ts";
import { syncTargetCalculationError } from "./job-level.ts";
import { jobSchemas } from "./jobs.ts";
import { assertForcedGearValue, forcedGearEqual } from "./types.ts";
import type {
  EquipmentRestrictions,
  ForcedGearValue,
  GearSlot,
  JointOptimizationConfig,
  OptimizationConfig,
  Stat,
  SyncTarget,
} from "./types.ts";

const configKeys = new Set([
  "jobId",
  "minItemLevel",
  "maxItemLevel",
  "sync",
  "clanIndex",
  "gcdChoices",
  "speedMin",
  "speedMax",
  "minTenacity",
  "toughnessMinPercent",
  "maximizeTenacity",
  "objective",
  "excludedSources",
  "excludedGearIds",
  "forcedGear",
  "foodId",
  "maxSearchMs",
]);
const jointKeys = new Set([
  "jobs",
  "commonSlots",
  "foodStrategy",
  "objective",
  "maxSearchMs",
  "cacheLimit",
]);
const gearSlots = new Set<GearSlot>([
  "weapon",
  "offhand",
  "head",
  "body",
  "hands",
  "legs",
  "feet",
  "earrings",
  "necklace",
  "bracelet",
  "ring",
  "ring2",
]);
const materiaStats = new Set<Stat>([
  "CRT",
  "DET",
  "DHT",
  "SKS",
  "SPS",
  "TEN",
  "PIE",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonnegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isObjective(value: unknown): boolean {
  return value === "damage" || value === "dps";
}

function validForcedValue(
  value: unknown,
): value is ForcedGearValue | undefined {
  try {
    assertForcedGearValue(value);
  } catch {
    return false;
  }
  if (value === undefined || typeof value === "number") return true;
  if ("customStats" in value) {
    return Object.entries(value.customStats).every(
      ([stat, amount]) =>
        materiaStats.has(stat as Stat) && isNonnegativeNumber(amount),
    );
  }
  return value.melds.every(
    (meld) =>
      meld === null ||
      (isObject(meld) &&
        materiaStats.has(meld.stat as Stat) &&
        isNonnegativeNumber(meld.value) &&
        isPositiveInteger(meld.grade) &&
        (meld.slotIndex === undefined ||
          (Number.isSafeInteger(meld.slotIndex) &&
            meld.slotIndex >= 0 &&
            meld.slotIndex < 5))),
  );
}

/** Validates the current request shape without converting previous representations. */
export function optimizationConfigError(value: unknown): string | undefined {
  if (
    !isObject(value) ||
    Object.keys(value).some((key) => !configKeys.has(key))
  )
    return "搜索配置包含无效字段";
  if (
    typeof value.jobId !== "string" ||
    !Object.hasOwn(jobSchemas, value.jobId)
  )
    return "职业配置无效";
  if (
    !Number.isSafeInteger(value.minItemLevel) ||
    !Number.isSafeInteger(value.maxItemLevel) ||
    (value.minItemLevel as number) > (value.maxItemLevel as number)
  )
    return "装备品级范围无效";
  if (
    !Number.isSafeInteger(value.clanIndex) ||
    (value.clanIndex as number) < 0 ||
    (value.clanIndex as number) >= clanCount
  )
    return "族群序号无效";
  if (!isObjective(value.objective)) return "搜索目标必须为 damage 或 dps";
  if (value.sync !== undefined) {
    const error = syncTargetCalculationError(value.sync as SyncTarget);
    if (error) return error;
  }
  if (
    value.gcdChoices !== undefined &&
    (!Array.isArray(value.gcdChoices) ||
      value.gcdChoices.length === 0 ||
      !value.gcdChoices.every((gcd) => isFiniteNumber(gcd) && gcd > 0) ||
      new Set(value.gcdChoices).size !== value.gcdChoices.length)
  )
    return "GCD 档位必须是无重复的正有限数值";
  if (
    (value.speedMin !== undefined && !isNonnegativeNumber(value.speedMin)) ||
    (value.speedMax !== undefined && !isNonnegativeNumber(value.speedMax)) ||
    (value.speedMin !== undefined &&
      value.speedMax !== undefined &&
      (value.speedMin as number) > (value.speedMax as number))
  )
    return "战斗速度范围无效";
  if (
    value.gcdChoices !== undefined &&
    (value.speedMin !== undefined || value.speedMax !== undefined)
  )
    return "GCD 档位与战斗速度范围只能选择一种";
  if (
    typeof value.maximizeTenacity !== "boolean" ||
    (value.minTenacity !== undefined &&
      !isNonnegativeNumber(value.minTenacity)) ||
    (value.toughnessMinPercent !== undefined &&
      (!isNonnegativeNumber(value.toughnessMinPercent) ||
        value.toughnessMinPercent > 100))
  )
    return "坚韧条件无效";
  if (
    Number(value.minTenacity !== undefined) +
      Number(value.toughnessMinPercent !== undefined) +
      Number(value.maximizeTenacity) >
    1
  )
    return "坚韧条件只能选择一种策略";
  if (
    (value.minTenacity !== undefined ||
      value.toughnessMinPercent !== undefined ||
      value.maximizeTenacity) &&
    jobSchemas[value.jobId as OptimizationConfig["jobId"]].role !== "tank"
  )
    return `职业 ${value.jobId} 不使用坚韧属性`;
  if (
    value.excludedSources !== undefined &&
    (!Array.isArray(value.excludedSources) ||
      !value.excludedSources.every((source) => typeof source === "string"))
  )
    return "装备来源排除配置无效";
  if (
    value.excludedGearIds !== undefined &&
    (!Array.isArray(value.excludedGearIds) ||
      !value.excludedGearIds.every(isPositiveInteger))
  )
    return "装备排除配置无效";
  if (
    value.forcedGear !== undefined &&
    (!isObject(value.forcedGear) ||
      !Object.entries(value.forcedGear).every(
        ([slot, force]) =>
          gearSlots.has(slot as GearSlot) && validForcedValue(force),
      ))
  )
    return "强制装备配置无效";
  if (!Number.isSafeInteger(value.foodId) || (value.foodId as number) < 0)
    return "食物配置无效";
  if (
    value.maxSearchMs !== undefined &&
    (!isFiniteNumber(value.maxSearchMs) || value.maxSearchMs <= 0)
  )
    return "搜索时限无效";
  return undefined;
}

export function assertOptimizationConfig(
  value: unknown,
): asserts value is OptimizationConfig {
  const error = optimizationConfigError(value);
  if (error) throw new TypeError(error);
}

export function normalizeOptimizationConfig(
  config: OptimizationConfig,
): OptimizationConfig & Required<EquipmentRestrictions> {
  assertOptimizationConfig(config);
  return {
    ...config,
    excludedSources: config.excludedSources ?? [],
    excludedGearIds: config.excludedGearIds ?? [],
    forcedGear: config.forcedGear ?? {},
  };
}

function sameSet(
  left: readonly (string | number)[],
  right: readonly (string | number)[],
): boolean {
  const values = new Set(left);
  return (
    values.size === new Set(right).size &&
    right.every((value) => values.has(value))
  );
}

export function jointOptimizationConfigError(
  value: unknown,
): string | undefined {
  if (!isObject(value) || Object.keys(value).some((key) => !jointKeys.has(key)))
    return "联合配置包含无效字段";
  if (!Array.isArray(value.jobs) || value.jobs.length < 2)
    return "多职业联合搜索至少需要两个职业";
  for (const job of value.jobs) {
    const error = optimizationConfigError(job);
    if (error) return error;
  }
  const jobs = value.jobs as OptimizationConfig[];
  if (new Set(jobs.map((job) => job.jobId)).size !== jobs.length)
    return "联合配置包含重复职业";
  if (new Set(jobs.map((job) => jobSchemas[job.jobId].role)).size !== 1)
    return "多职业联合搜索只接受同组职业";
  if (
    !isObjective(value.objective) ||
    jobs.some((job) => job.objective !== value.objective)
  )
    return "联合搜索中所有职业必须使用相同的 damage 或 dps 目标";
  if (
    !Array.isArray(value.commonSlots) ||
    !value.commonSlots.every(
      (slot) => gearSlots.has(slot) && slot !== "weapon" && slot !== "offhand",
    )
  )
    return "共享槽位配置无效";
  if (new Set(value.commonSlots).size !== value.commonSlots.length)
    return "共享槽位列表包含重复项";
  if (value.foodStrategy !== "shared" && value.foodStrategy !== "independent")
    return "联合食物策略无效";
  const first = jobs[0]!;
  if (
    jobs.some(
      (job) =>
        job.minItemLevel !== first.minItemLevel ||
        job.maxItemLevel !== first.maxItemLevel ||
        job.clanIndex !== first.clanIndex ||
        job.sync?.kind !== first.sync?.kind ||
        job.sync?.value !== first.sync?.value,
    )
  )
    return "联合搜索的装备品级范围、同步目标和族群必须一致";
  if (
    jobs.some(
      (job) => !sameSet(job.excludedSources ?? [], first.excludedSources ?? []),
    )
  )
    return "联合搜索的装备来源排除必须一致";
  if (
    value.foodStrategy === "shared" &&
    jobs.some((job) => job.foodId !== first.foodId)
  )
    return "共享食物配置必须一致";
  for (const slot of value.commonSlots as GearSlot[]) {
    if (
      jobs.some(
        (job) =>
          !forcedGearEqual(job.forcedGear?.[slot], first.forcedGear?.[slot]),
      )
    )
      return `共享槽位 ${slot} 的强制配置必须在所有职业中一致`;
  }
  if (
    value.maxSearchMs !== undefined &&
    (!isFiniteNumber(value.maxSearchMs) || value.maxSearchMs <= 0)
  )
    return "搜索时限无效";
  if (value.cacheLimit !== undefined && !isPositiveInteger(value.cacheLimit))
    return "联合缓存上限无效";
  return undefined;
}

export function assertJointOptimizationConfig(
  value: unknown,
): asserts value is JointOptimizationConfig {
  const error = jointOptimizationConfigError(value);
  if (error) throw new TypeError(error);
}
