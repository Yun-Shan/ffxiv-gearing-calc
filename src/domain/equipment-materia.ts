import { jobSchemas } from "./jobs.ts";
import { calculationJobLevelFor } from "./job-level.ts";
import {
  concretizeGearStats,
  effectiveGearSyncLevel,
  getGearStatCap,
} from "./rules.ts";
import {
  highestMateriaGrade,
  materiaForGrade,
  mergeCandidateStats,
  forcedAllowedMateriaStats,
} from "./optimizer/equipment-candidates.ts";
import {
  applyItemSpecialBonus,
  enabledItemSpecialBonusesForJob,
} from "./item-special-bonus.ts";
import type { Gear, Materia, OptimizationConfig } from "./types.ts";

export type EquipmentMateriaChoice = "auto" | Materia["stat"];
export type EquipmentMateriaConfig = Pick<
  OptimizationConfig,
  "jobId" | "syncLevel"
>;

/** Equipment facts do not depend on the current hole selections and can be retained by the UI. */
export function prepareEquipmentMateria(
  gear: Gear,
  config: EquipmentMateriaConfig,
) {
  const job = jobSchemas[config.jobId];
  const jobLevel = calculationJobLevelFor(config);
  const syncLevel = effectiveGearSyncLevel(gear, jobLevel, config.syncLevel);
  const stats = forcedAllowedMateriaStats(config.jobId);
  const resolvedGear = { ...gear, stats: concretizeGearStats(gear.stats, job) };
  const custom =
    gear.customParameters !== undefined ||
    gear.resistanceWeaponAdjust !== undefined;
  const disabledReason = custom
    ? "自定义武器不使用普通魔晶石孔"
    : syncLevel !== undefined
      ? "品级同步后魔晶石不生效"
      : undefined;
  const count = custom
    ? 0
    : gear.materiaAdvanced === true
      ? 5
      : gear.materiaSlots;
  const slots = Array.from({ length: count }, (_, index) => ({
    safe: index < gear.materiaSlots,
    options: disabledReason
      ? []
      : stats.map((stat) =>
          materiaForGrade(
            stat,
            highestMateriaGrade(gear.level, index <= gear.materiaSlots),
          ),
        ),
  }));
  const base = mergeCandidateStats(
    resolvedGear,
    [],
    jobLevel,
    config.syncLevel,
  );
  const current = applyItemSpecialBonus(
    base,
    gear,
    job,
    enabledItemSpecialBonusesForJob(config.jobId),
  );
  return {
    slots,
    synchronized: syncLevel !== undefined && !custom,
    disabledReason,
    attributes: stats.map((stat) => ({
      stat,
      current: current[stat] ?? 0,
      meldBase: base[stat] ?? 0,
      cap: getGearStatCap(gear, stat, syncLevel ?? gear.level),
    })),
  };
}

export type PreparedEquipmentMateria = ReturnType<
  typeof prepareEquipmentMateria
>;

/** Only the hint totals change when a hole is selected. Auto adds no assumed stats. */
export function evaluateEquipmentMateria(
  prepared: PreparedEquipmentMateria,
  selections: readonly EquipmentMateriaChoice[] = [],
) {
  const melds = prepared.slots.flatMap((slot, index) =>
    slot.options.filter((option) => option.stat === selections[index]),
  );
  return {
    slots: prepared.slots,
    synchronized: prepared.synchronized,
    disabledReason: prepared.disabledReason,
    attributes: prepared.attributes.map(({ stat, current, meldBase, cap }) => {
      const added = melds.reduce(
        (total, meld) => total + (meld.stat === stat ? meld.value : 0),
        0,
      );
      return {
        stat,
        current: prepared.disabledReason || added === 0
          ? current
          : Math.min(cap, meldBase + added) + current - meldBase,
        total: current + added,
        cap,
      };
    }),
  };
}
