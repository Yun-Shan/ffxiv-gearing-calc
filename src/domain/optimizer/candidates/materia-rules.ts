import { gameData, materiaGradeRequiredLevels } from "../../data.ts";
import { jobSchemas } from "../../jobs.ts";
import { capGearStatsAtLevel, effectiveGearSyncLevel, getGearStatCap } from "../../rules.ts";
import type { Gear, JobId, Materia, Stat, Stats, SyncTarget } from "../../types.ts";

export function materiaAttributeStats(jobId: JobId): Materia["stat"][] {
  const role = jobSchemas[jobId].role;
  if (role === "tank") return ["CRT", "DET", "DHT", "SKS", "TEN"];
  if (role === "healer" || role === "int") return ["CRT", "DET", "DHT", "SPS"];
  return ["CRT", "DET", "DHT", "SKS"];
}

export function materiaForGrade(stat: Materia["stat"], grade: number): Materia {
  const value = gameData.materias[stat]?.[grade - 1];
  if (!Number.isSafeInteger(value) || value! <= 0) {
    throw new Error(`魔晶石 ${stat} 缺少 ${grade} 级数值`);
  }
  return { stat, value: value!, grade };
}

export function highestMateriaGrade(itemLevel: number, unrestricted: boolean): number {
  const restrictedGrades = gameData.materiaGradeIsRestricted;
  if (restrictedGrades.length !== materiaGradeRequiredLevels.length + 1) {
    throw new Error("魔晶石禁断等级数据与等级要求数据长度不一致");
  }
  for (let grade = materiaGradeRequiredLevels.length; grade >= 1; grade--) {
    if (materiaGradeRequiredLevels[grade - 1]! > itemLevel) continue;
    if (!unrestricted && restrictedGrades[grade]) continue;
    return grade;
  }
  throw new Error(
    unrestricted
      ? `装备品级 ${itemLevel} 没有可用魔晶石等级`
      : `装备品级 ${itemLevel} 没有限制孔可用的魔晶石等级`,
  );
}

export function statCapAtLevel(gear: Gear, stat: Stat, level: number): number {
  return getGearStatCap(gear, stat, level);
}

export function mergeCandidateStats(
  gear: Gear,
  melds: readonly Materia[],
  jobLevel: number,
  sync?: SyncTarget,
): Stats {
  const synchronizedLevel = effectiveGearSyncLevel(gear, jobLevel, sync);
  const level = synchronizedLevel ?? gear.level;
  const finalStats: Stats = synchronizedLevel === undefined
    ? { ...gear.stats }
    : capGearStatsAtLevel(gear, gear.stats, level);
  for (const meld of melds) {
    const cap = statCapAtLevel(gear, meld.stat, level);
    finalStats[meld.stat] = Math.min(
      cap,
      (finalStats[meld.stat] ?? 0) + meld.value,
    );
  }
  return finalStats;
}

export function forcedMateriaCapacity(gear: Gear): number {
  return gear.materiaAdvanced === true ? 5 : gear.materiaSlots;
}

export function materiaAllowedAtPosition(
  gear: Gear,
  index: number,
  materia: Materia,
): boolean {
  const restrictedGrades = gameData.materiaGradeIsRestricted;
  if (restrictedGrades.length !== materiaGradeRequiredLevels.length + 1) {
    throw new Error("魔晶石禁断等级数据与等级要求数据长度不一致");
  }
  const grade = materia.grade;
  if (!Number.isSafeInteger(grade) || grade < 1 || grade > materiaGradeRequiredLevels.length) return false;
  const value = gameData.materias[materia.stat]?.[grade - 1];
  if (!Number.isSafeInteger(value) || value! <= 0 || materia.value !== value) return false;
  if (materiaGradeRequiredLevels[grade - 1]! > gear.level) return false;
  return index <= gear.materiaSlots || !restrictedGrades[grade];
}

export function forcedAllowedMateriaStats(jobId: JobId): Materia["stat"][] {
  const stats = materiaAttributeStats(jobId);
  if (jobSchemas[jobId].role === "healer") stats.push("PIE");
  return stats;
}

/** Validate stored physical locks without enumerating automatic holes. */
export function validateForcedRegularMateria(gear: Gear, jobId: JobId, requested: readonly (Materia | null)[]): (Materia | null)[] {
  if (gear.customParameters !== undefined || gear.resistanceWeaponAdjust !== undefined) {
    throw new RangeError(`自定义参数装备 ${gear.id} 不能使用普通魔晶石锁定`);
  }
  const capacity = forcedMateriaCapacity(gear);
  if (requested.length !== capacity) {
    throw new RangeError(`装备 ${gear.id} 的强制魔晶石数组长度必须是 ${capacity}`);
  }
  const allowedStats = new Set(forcedAllowedMateriaStats(jobId));
  const fixed = Array.from({ length: requested.length }, (_, index) => {
    const meld = requested[index];
    if (meld === null) return null;
    if (typeof meld !== "object" || Array.isArray(meld)) {
      throw new TypeError(`装备 ${gear.id} 的第 ${index + 1} 个强制魔晶石数据无效`);
    }
    if (Object.keys(meld).some((key) => !["stat", "value", "grade", "slotIndex"].includes(key))) {
      throw new TypeError(`装备 ${gear.id} 的第 ${index + 1} 个强制魔晶石包含未知字段`);
    }
    if (!allowedStats.has(meld.stat)) {
      throw new RangeError(`职业 ${jobId} 不能镶嵌 ${String(meld.stat)} 属性魔晶石`);
    }
    if (meld.slotIndex !== undefined && meld.slotIndex !== index) {
      throw new RangeError(`装备 ${gear.id} 的第 ${index + 1} 个魔晶石位置与 slotIndex 不一致`);
    }
    if (!materiaAllowedAtPosition(gear, index, meld)) {
      throw new RangeError(`装备 ${gear.id} 的第 ${index + 1} 个魔晶石等级或属性值不合法`);
    }
    return { ...meld, slotIndex: index };
  });

  return fixed;
}
