import type { ForcedGearValue, Materia, MeldedGear } from "../types.ts";
import { highestMateriaGrade } from "./equipment-candidates.ts";

/** Recover physical holes after solving a position-independent materia multiset. */
export function restoreMateriaLayout(
  gear: MeldedGear,
  forced: ForcedGearValue | undefined,
): MeldedGear {
  const requested =
    typeof forced === "object" && "melds" in forced ? forced.melds : undefined;
  if (
    gear.customParameters !== undefined ||
    gear.resistanceWeaponAdjust !== undefined ||
    gear.melds.length === 0
  ) {
    return gear;
  }
  if (requested === undefined) {
    // Canonical candidates can come from the other ring slot. Its hole layout
    // belongs only to that slot's force setting.
    return gear.melds.every((meld) => meld.slotIndex === undefined)
      ? gear
      : { ...gear, melds: gear.melds.map(({ slotIndex: _, ...meld }) => meld) };
  }
  const capacity = gear.materiaAdvanced === true ? 5 : gear.materiaSlots;
  const fail = (): never => {
    throw new Error(`装备 ${gear.id} 的搜索魔晶石组合无法按当前槽位限制还原`);
  };
  if (
    gear.melds.length !== capacity ||
    (requested !== undefined && requested.length !== capacity) ||
    (typeof forced === "object" && forced.id !== gear.id)
  )
    return fail();
  const remaining = gear.melds
    .map(({ stat, value, grade }) => ({ stat, value, grade }))
    .sort(
      (left, right) =>
        left.stat.localeCompare(right.stat) ||
        left.grade - right.grade ||
        left.value - right.value,
    );
  const melds: Materia[] = new Array(capacity);
  // Reserve every fixed gem before filling automatic holes, including legal lower grades.
  for (let index = 0; index < capacity; index++) {
    const fixed = requested?.[index];
    if (fixed == null) continue;
    const found = remaining.findIndex(
      (meld) =>
        meld.stat === fixed.stat &&
        meld.value === fixed.value &&
        meld.grade === fixed.grade,
    );
    if (found < 0) return fail();
    melds[index] = { ...remaining.splice(found, 1)[0]!, slotIndex: index };
  }
  for (let index = 0; index < capacity; index++) {
    if (melds[index] !== undefined) continue;
    const grade = highestMateriaGrade(gear.level, index <= gear.materiaSlots);
    const found = remaining.findIndex((meld) => meld.grade === grade);
    if (found < 0) return fail();
    melds[index] = { ...remaining.splice(found, 1)[0]!, slotIndex: index };
  }
  return { ...gear, melds };
}
