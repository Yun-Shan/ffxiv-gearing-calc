import { effectiveGearSyncLevel } from "../../rules.ts";
import type { Gear, JobId, Materia, OptimizationConfig, SyncTarget } from "../../types.ts";
import { forcedMateriaCapacity, forcedAllowedMateriaStats, highestMateriaGrade, materiaAllowedAtPosition, materiaAttributeStats, materiaForGrade, statCapAtLevel } from "./materia-rules.ts";

function* countCombinations(
  attributeCount: number,
  materiaCount: number,
): Generator<number[]> {
  const counts = new Array<number>(attributeCount).fill(0);
  function* walk(index: number, remaining: number): Generator<number[]> {
    if (attributeCount === 0) {
      if (remaining === 0) yield [];
      return;
    }
    if (index === attributeCount - 1) {
      counts[index] = remaining;
      yield counts.slice();
      return;
    }
    for (let amount = 0; amount <= remaining; amount++) {
      counts[index] = amount;
      yield* walk(index + 1, remaining - amount);
    }
  }
  yield* walk(0, materiaCount);
}

function capLevelFor(gear: Gear, jobLevel: number, sync?: SyncTarget): number {
  return effectiveGearSyncLevel(gear, jobLevel, sync) ?? gear.level;
}

export function forcedRegularMateriaMelds(
  gear: Gear,
  jobId: JobId,
  jobLevel: number,
  sync: SyncTarget | undefined,
  requested: readonly (Materia | null)[],
): Materia[][] {
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

  // Sync disables regular materia effects, but retain and validate stored locks so a
  // later unsynced run can apply them without losing their physical positions.
  if (effectiveGearSyncLevel(gear, jobLevel, sync) !== undefined) return [[]];

  const highIndexes = fixed.flatMap((meld, index) =>
    meld === null && index <= gear.materiaSlots ? [index] : [],
  );
  const lowIndexes = fixed.flatMap((meld, index) =>
    meld === null && index > gear.materiaSlots ? [index] : [],
  );
  const automaticStats = materiaAttributeStats(jobId);
  const highGrade = highIndexes.length > 0
    ? highestMateriaGrade(gear.level, true)
    : undefined;
  const lowGrade = lowIndexes.length > 0
    ? highestMateriaGrade(gear.level, false)
    : undefined;
  const highMateria = highGrade === undefined
    ? []
    : automaticStats.map((stat) => materiaForGrade(stat, highGrade));
  const lowMateria = lowGrade === undefined
    ? []
    : automaticStats.map((stat) => materiaForGrade(stat, lowGrade));
  const highIndexSet = new Set(highIndexes);
  const lowIndexSet = new Set(lowIndexes);
  const output: Materia[] = [];
  const candidates: Materia[][] = [];
  function assign(index: number): void {
    if (index === capacity) {
      candidates.push(output.map((meld) => ({ ...meld })));
      return;
    }
    const locked = fixed[index];
    if (locked !== null) {
      output[index] = locked;
      assign(index + 1);
      return;
    }
    const materias = highIndexSet.has(index)
      ? highMateria
      : lowIndexSet.has(index)
        ? lowMateria
        : [];
    for (const materia of materias) {
      output[index] = { ...materia, slotIndex: index };
      assign(index + 1);
    }
  }
  // Preserve each fixed slot position and enumerate only the automatic holes.
  assign(0);
  return candidates;
}

export function regularMateriaMelds(
  gear: Gear,
  jobId: JobId,
  config: OptimizationConfig,
  jobLevel: number,
): Materia[][] {
  const syncApplies =
    effectiveGearSyncLevel(gear, jobLevel, config.sync) !== undefined;
  // 品级同步时普通装备的魔晶石失效。自定义参数武器按独立路径处理：
  // 上游算法保留其十二种参数组合，并在同步后封顶属性。
  if (syncApplies) return [[]];
  if (gear.materiaSlots === 0 && gear.materiaAdvanced !== true) return [[]];

  const stats = materiaAttributeStats(jobId);
  const highGrade = highestMateriaGrade(gear.level, true);
  const highMateria = stats.map((stat) => materiaForGrade(stat, highGrade));
  const canOvermeld = gear.materiaAdvanced === true && gear.materiaSlots < 5;
  const advancedCount = canOvermeld ? Math.max(0, 4 - gear.materiaSlots) : 0;
  const openAndFirstOvermeld = gear.materiaSlots + (canOvermeld ? 1 : 0);
  const lowMateria =
    advancedCount > 0
      ? stats.map((stat) =>
          materiaForGrade(stat, highestMateriaGrade(gear.level, false)),
        )
      : [];
  const unique = new Map<string, Materia[]>();
  for (const highCounts of countCombinations(
    stats.length,
    openAndFirstOvermeld,
  )) {
    for (const lowCounts of countCombinations(stats.length, advancedCount)) {
      const melds: Materia[] = [];
      let valid = true;
      for (let index = 0; index < stats.length; index++) {
        const stat = stats[index]!;
        const highCount = highCounts[index]!;
        const lowCount = lowCounts[index]!;
        const totalValue =
          highCount * highMateria[index]!.value +
          lowCount * (lowMateria[index]?.value ?? 0);
        const level = capLevelFor(gear, jobLevel, config.sync);
        const available =
          statCapAtLevel(gear, stat, level) - (gear.stats[stat] ?? 0);
        const finalMeldValue =
          lowCount > 0 ? lowMateria[index]!.value : highMateria[index]!.value;
        // 最后一颗魔晶石的属性可能被封顶削减；不要用完全不增加属性的魔晶石填孔。
        // 先尝试高等级魔晶石，再尝试可禁断的低等级魔晶石。
        if (
          totalValue > 0 &&
          (available <= 0 || totalValue - finalMeldValue >= available)
        ) {
          valid = false;
          break;
        }
        for (let count = 0; count < highCount; count++)
          melds.push(highMateria[index]!);
        for (let count = 0; count < lowCount; count++)
          melds.push(lowMateria[index]!);
      }
      if (!valid) continue;
      const key = melds
        .map(({ stat, value, grade }) => `${stat}:${value}:${grade}`)
        .join("|");
      if (!unique.has(key)) unique.set(key, melds);
    }
  }
  return [...unique.values()];
}
