import { calculationJobLevelFor } from "../../gear-options.ts";
import { jobSchemas } from "../../jobs.ts";
import { capGearStatsAtLevel, concretizeGearStats, effectiveGearSyncLevel } from "../../rules.ts";
import { equipmentIdentity } from "../../search/equipment-identity.ts";
import { applyItemSpecialBonus, enabledItemSpecialBonusesForJob } from "../../item-special-bonus.ts";
import { filterStatsForJob } from "../../job-stats.ts";
import { customParameterMelds, fixedCustomEquipmentMelds } from "../../custom-gear-parameters.ts";
import type { ForcedGearValue, Gear, GearSlot, JobSchema, Materia, MeldedGear, OptimizationConfig, Stat, Stats, SyncTarget } from "../../types.ts";
import { assertForcedGearValue, forcedGearId } from "../../types.ts";
import { attributeIndex, type GearCandidate, type SolverGear } from "../context.ts";
import { mergeCandidateStats, statCapAtLevel } from "./materia-rules.ts";
import { forcedRegularMateriaMelds, regularMateriaMelds } from "./materia-enumeration.ts";

export function forcedValueForSlot(
  config: OptimizationConfig,
  slot: GearSlot,
): ForcedGearValue | undefined {
  if (config.forcedGear === undefined) return undefined;
  if (
    typeof config.forcedGear !== "object" ||
    config.forcedGear === null ||
    Array.isArray(config.forcedGear)
  ) {
    throw new TypeError("强制装备配置必须是按槽位索引的对象");
  }
  const value: unknown = config.forcedGear[slot];
  try {
    assertForcedGearValue(value);
  } catch (error) {
    throw new TypeError(
      `槽位 ${slot} 的强制装备配置无效：${(error as Error).message}`,
    );
  }
  return value;
}

function toSolverEquipment(
  gear: MeldedGear,
  job: JobSchema,
  resistanceWeaponAdjust = gear.resistanceWeaponAdjust,
  includeResistanceAllocation = true,
): SolverGear {
  const baseParams = Object.entries(filterStatsForJob(gear.finalStats, job))
    .flatMap(([key, value]) => {
      const index = attributeIndex.get(key as Stat);
      return index === undefined || !value
        ? []
        : [{ baseParamId: index, value }];
    })
    .sort((left, right) => left.baseParamId - right.baseParamId);
  const key = baseParams.map(({ baseParamId }) => baseParamId).join("-");
  const variantKey = JSON.stringify(gear.melds
    .map(({ stat, value, grade }) => [stat, value, grade] as const)
    .sort((left, right) =>
      left[0].localeCompare(right[0]) ||
      left[2] - right[2] ||
      left[1] - right[1],
    ));
  return {
    itemId: gear.id,
    itemLevel: gear.level,
    variantKey,
    key,
    baseParams,
    PDMG: gear.finalStats.PDMG ?? 0,
    MDMG: gear.finalStats.MDMG ?? 0,
    DLY: gear.finalStats.DLY ?? 0,
    ...(!includeResistanceAllocation || resistanceWeaponAdjust === undefined
      ? {}
      : { resistanceWeaponAdjust }),
  };
}

function resistanceAdjustmentForSearch(
  gear: Gear,
  finalStats: Stats,
  jobLevel: number,
  sync?: SyncTarget,
) {
  const adjustment = gear.resistanceWeaponAdjust;
  if (adjustment === undefined) return undefined;
  const effectiveLevel = effectiveGearSyncLevel(gear, jobLevel, sync);
  if (effectiveLevel === undefined) return adjustment;
  const statMaximums = Object.fromEntries(adjustment.stats.map((stat) => [
    stat,
    Math.min(
      adjustment.maxEachStat,
      Math.max(0, statCapAtLevel(gear, stat, effectiveLevel) - (finalStats[stat] ?? 0)),
    ),
  ])) as Partial<Record<(typeof adjustment.stats)[number], number>>;
  return { ...adjustment, statMaximums };
}

export function makeGearCandidates(
  gear: Gear,
  slot: GearSlot,
  config: OptimizationConfig,
  gearsByIdentity: Map<string, MeldedGear>,
): GearCandidate[] {
  const forcedValue = forcedValueForSlot(config, slot);
  const forcedId = forcedGearId(forcedValue);
  if (forcedId !== undefined && forcedId !== gear.id) return [];
  const job = jobSchemas[config.jobId];
  // 参考实现的 store.jobLevel 在同步搜索中等于同步映射等级；
  // 候选穿戴资格已由 gearOptionsFor 按职业上限过滤，这里只用于 Gear.syncedLevel。
  const syncJobLevel = calculationJobLevelFor(config);
  const resolvedGear: Gear = {
    ...gear,
    stats: concretizeGearStats(gear.stats, job),
  };
  let options: Materia[][];
  let suppressResistanceAllocation = false;
  let fixedCustomStats: Stats | undefined;
  if (forcedValue !== undefined && typeof forcedValue !== "number" && "melds" in forcedValue) {
    options = forcedRegularMateriaMelds(
      resolvedGear,
      config.jobId,
      syncJobLevel,
      config.sync,
      forcedValue.melds,
    );
  } else if (forcedValue !== undefined && typeof forcedValue !== "number") {
    options = [fixedCustomEquipmentMelds(resolvedGear, config.jobId, forcedValue.customStats)];
    fixedCustomStats = forcedValue.customStats;
    suppressResistanceAllocation = resolvedGear.resistanceWeaponAdjust !== undefined;
  } else if (resolvedGear.resistanceWeaponAdjust !== undefined) {
    options = [[]];
  } else if (resolvedGear.customParameters?.length) {
    options = customParameterMelds(resolvedGear);
  } else {
    options = regularMateriaMelds(resolvedGear, config.jobId, config, syncJobLevel);
  }
  const candidates = new Map<string, GearCandidate>();
  const enabledItemSpecialBonuses = enabledItemSpecialBonusesForJob(config.jobId);
  for (const melds of options) {
    // Custom parameters are absolute equipment stats, not materia contributions:
    // apply them over the base gear and only apply the gear sync cap when active.
    // Ordinary materia follows the regular per-materia caps below.
    const mergedStats = fixedCustomStats === undefined
      ? mergeCandidateStats(
          resolvedGear,
          melds,
          syncJobLevel,
          config.sync,
        )
      : customCandidateStats(
          resolvedGear,
          fixedCustomStats,
          syncJobLevel,
          config.sync,
        );
    // 参考实现先完成同步封顶，再追加特殊加成且不再封顶。
    const finalStats = applyItemSpecialBonus(
      mergedStats,
      resolvedGear,
      job,
      enabledItemSpecialBonuses,
    );
    const damageStat =
      job.mainStat === "INT" || job.mainStat === "MND"
        ? "MDMG"
        : "PDMG";
    const meldedGear: MeldedGear = {
      ...resolvedGear,
      slot,
      weaponDamage: finalStats[damageStat] ?? gear.weaponDamage,
      melds: melds.map((meld) => ({ ...meld })),
      finalStats,
    };
    const equipment = toSolverEquipment(
      meldedGear,
      job,
      resistanceAdjustmentForSearch(
        resolvedGear,
        finalStats,
        syncJobLevel,
        config.sync,
      ),
      !suppressResistanceAllocation,
    );
    const identity = equipmentIdentity(equipment);
    if (candidates.has(identity)) continue;
    candidates.set(identity, { equipment, gear: meldedGear });
    gearsByIdentity.set(identity, meldedGear);
  }
  return [...candidates.values()];
}

function customCandidateStats(
  gear: Gear,
  customStats: Stats,
  jobLevel: number,
  sync?: SyncTarget,
): Stats {
  // Keep custom weapon values absolute, matching fixed gearset calculation.
  const finalStats: Stats = { ...gear.stats, ...customStats };
  const synchronizedLevel = effectiveGearSyncLevel(gear, jobLevel, sync);
  return synchronizedLevel === undefined
    ? finalStats
    : capGearStatsAtLevel(gear, finalStats, synchronizedLevel);
}
