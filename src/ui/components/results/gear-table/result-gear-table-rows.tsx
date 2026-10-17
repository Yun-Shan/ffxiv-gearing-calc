import {
  type GearSlot,
  type MeldedGear,
  type OptimizationConfig,
  type OptimizationResult,
  type Stats,
} from "@/domain";
import { gearSlotLabels, statName, statValue } from "@/ui/services/labels";
import { GearTableView } from "./GearTableView";
import type { GearTableGearItem, GearTableRow } from "./types";

export type OptimizationResultWithEquivalentGear = OptimizationResult;

export interface ResultGearTableOptions {
  onReplacementSelect?: (slot: GearSlot, replacement: MeldedGear) => void;
}

const displaySlots: readonly GearSlot[] = [
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
];

export function equivalentGearKey(gear: MeldedGear): string {
  const identityExtension = gear as MeldedGear & {
    variantKey?: string;
    hq?: boolean;
    isHq?: boolean;
  };
  const sortStats = (stats: Record<string, number | undefined>) =>
    Object.fromEntries(
      Object.entries(stats).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  return JSON.stringify({
    id: gear.id,
    slot: gear.slot,
    level: gear.level,
    variantKey: identityExtension.variantKey,
    highQuality: identityExtension.hq ?? identityExtension.isHq,
    baseStats: sortStats(gear.stats),
    weaponDamage: gear.weaponDamage,
    customParameters: gear.customParameters
      ?.map((parameter) => ({ ...parameter }))
      .sort(
        (left, right) =>
          left.stat.localeCompare(right.stat) ||
          left.materiaId - right.materiaId,
      ),
    resistanceWeaponAdjust: gear.resistanceWeaponAdjust
      ? {
          maxTotalStats: gear.resistanceWeaponAdjust.maxTotalStats,
          maxEachStat: gear.resistanceWeaponAdjust.maxEachStat,
          stats: [...gear.resistanceWeaponAdjust.stats].sort(),
        }
      : undefined,
    melds: [...gear.melds]
      .map(({ stat, value, grade, slotIndex }, index) => ({
        stat,
        value,
        grade,
        ...(grade > 0 ? { slotIndex: slotIndex ?? index } : {}),
      }))
      .sort(
        (left, right) =>
          left.stat.localeCompare(right.stat) ||
          left.grade - right.grade ||
          left.value - right.value,
      ),
    finalStats: sortStats(gear.finalStats),
  });
}

function gearItem(
  gear: MeldedGear,
  displaySlot: GearSlot = gear.slot,
): GearTableGearItem {
  const displayStats = Object.fromEntries(
    Object.entries(gear.finalStats).filter(
      ([stat]) => stat !== "PDMG" && stat !== "MDMG" && stat !== "DLY",
    ),
  );
  const performance: string[] = [];
  for (const stat of ["PDMG", "MDMG"] as const) {
    const value = gear.finalStats[stat];
    if (value !== undefined)
      performance.push(`${statName(stat)} ${statValue(stat, value)}`);
  }
  if (performance.length === 0 && gear.weaponDamage !== undefined) {
    performance.push(`武器伤害 ${gear.weaponDamage.toLocaleString()}`);
  }
  const delay = gear.finalStats.DLY;
  if (delay !== undefined && delay > 0)
    performance.push(`${statName("DLY")} ${statValue("DLY", delay)}`);
  return {
    kind: "gear",
    key: equivalentGearKey(gear),
    itemId: gear.id,
    slot: displaySlot,
    name: gear.name,
    level: gear.level,
    source: gear.source,
    stats: displayStats,
    melds: gear.melds.map(({ stat, value, grade, slotIndex }, index) => ({
      stat,
      value,
      isOvermeld: grade > 0 && (slotIndex ?? index) >= gear.materiaSlots,
    })),
    ...(gear.slot === "weapon" && performance.length > 0
      ? { weaponPerformance: performance.join(" · ") }
      : {}),
  };
}

type ResultGear = OptimizationResultWithEquivalentGear["gear"][number];

function replacementCandidates(
  result: OptimizationResultWithEquivalentGear,
  gear: ResultGear,
): MeldedGear[] {
  const byKey = new Map<string, MeldedGear>();
  for (const groupKey of gear.replacementGroupKey === undefined
    ? []
    : [gear.replacementGroupKey]) {
    for (const candidate of result.equivalentGear?.[groupKey] ?? []) {
      // Shared ring groups store their physical slot as `ring`; the second
      // result row must compare and select the same candidate as `ring2`.
      const normalized =
        gear.slot === "ring2" && candidate.slot === "ring"
          ? { ...candidate, slot: "ring2" as const }
          : candidate;
      byKey.set(equivalentGearKey(normalized), normalized);
    }
  }
  return [...byKey.values()].sort((a, b) => a.level - b.level || a.id - b.id);
}

function conflictingUniqueRing(
  result: OptimizationResultWithEquivalentGear,
  slot: GearSlot,
  candidate: MeldedGear,
): boolean {
  if (slot !== "ring" && slot !== "ring2") return false;
  const current = result.gear.find((gear) => gear.slot === slot);
  const unique =
    current?.uniqueReplacementGroupKey === undefined
      ? []
      : (result.equivalentGear?.[current.uniqueReplacementGroupKey] ?? []);
  const otherSlot = slot === "ring" ? "ring2" : "ring";
  const other = result.gear.find((gear) => gear.slot === otherSlot);
  return (
    other?.id === candidate.id &&
    unique.some((gear) => gear.id === candidate.id)
  );
}

export { gearItem as buildGearTableGearItem };

/**
 * Adapts a completed result to the display-only GearTable row contract.
 * The table itself has no access to search configs or domain objects.
 */
export function buildResultGearTableRows(
  result: OptimizationResultWithEquivalentGear,
  config: OptimizationConfig,
  options: ResultGearTableOptions = {},
): GearTableRow[] {
  // Config stays in this adapter's API for existing Result callers. Result rows
  // are built exclusively from the stored result snapshot; config is not used
  // to recalculate historical values against current game data.
  void config;
  const rows: GearTableRow[] = [];
  for (const slot of displaySlots) {
    const gear = result.gear.find((candidate) => candidate.slot === slot);
    if (!gear) continue;
    const item = gearItem(gear, slot);
    const candidates = replacementCandidates(result, gear);
    const candidateByKey = new Map(
      candidates.map((candidate) => [equivalentGearKey(candidate), candidate]),
    );
    const selectedKey = equivalentGearKey(gear);
    const replacements = candidates.map((candidate) => ({
      ...gearItem(candidate, slot),
      replacementSelected: equivalentGearKey(candidate) === selectedKey,
      replacementDisabled: conflictingUniqueRing(result, slot, candidate),
    }));
    rows.push({
      key: `gear-${slot}`,
      slotLabel: slot === "earrings" ? "耳坠" : gearSlotLabels[slot],
      item,
      ...(replacements.length > 0 && options.onReplacementSelect
        ? {
            replacements,
            onReplacementSelect: (replacement) => {
              const domainGear = candidateByKey.get(replacement.key);
              if (domainGear) options.onReplacementSelect?.(slot, domainGear);
            },
          }
        : {}),
    });
  }

  rows.push({
    key: `food-${result.food.id}`,
    slotLabel: "食物",
    item: {
      kind: "food",
      key: `food-${result.food.id}`,
      name: result.food.name,
      level: result.food.level,
      source: "上游食物数据",
      statsMeaning: "actual-gain",
      actualStats: result.food.actualStats,
      utilization: result.food.utilization,
      stats: result.food.stats,
    },
  });

  const averageItemLevel =
    result.gear.length > 0
      ? Math.round(
          result.gear.reduce((sum, gear) => sum + gear.level, 0) /
            result.gear.length,
        )
      : undefined;
  rows.push({
    key: "summary-total",
    slotLabel: "总属性",
    item: {
      kind: "summary",
      key: "summary-total",
      label: "总属性",
      itemLevel: averageItemLevel,
      stats: result.stats,
    },
  });
  return rows;
}

/**
 * Updates one selected equivalent item while preserving complete replacement
 * groups and search metadata.
 */
export function replaceEquivalentGear(
  result: OptimizationResultWithEquivalentGear,
  slot: GearSlot,
  replacementKey: string,
): OptimizationResultWithEquivalentGear {
  const current = result.gear.find((gear) => gear.slot === slot);
  const replacements = current
    ? replacementCandidates(result, current)
    : undefined;
  const replacement = replacements?.find(
    (gear) => equivalentGearKey(gear) === replacementKey,
  );
  if (!current || !replacements || !replacement) {
    throw new Error(`无法在 ${gearSlotLabels[slot]} 槽位选择该等价装备。`);
  }
  if (conflictingUniqueRing(result, slot, replacement))
    throw new Error("该唯一戒指已装备在另一戒指槽位。");

  return {
    ...result,
    gear: result.gear.map((gear) =>
      gear.slot === slot
        ? {
            ...replacement,
            slot,
            replacementGroupKey: gear.replacementGroupKey,
            uniqueReplacementGroupKey: gear.uniqueReplacementGroupKey,
          }
        : gear,
    ),
  };
}

export function ResultGearTable({
  result,
  config,
  onReplacementSelect,
}: {
  result: OptimizationResultWithEquivalentGear;
  config: OptimizationConfig;
  onReplacementSelect?: (slot: GearSlot, replacement: MeldedGear) => void;
}) {
  return (
    <GearTableView
      rows={buildResultGearTableRows(result, config, { onReplacementSelect })}
    />
  );
}
