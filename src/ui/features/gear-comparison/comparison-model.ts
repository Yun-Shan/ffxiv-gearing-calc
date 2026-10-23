import { jobSchemas, type JobId } from "@/domain";
import type { CoreMetricEntry } from "@/ui/components/results/core-metric-bar/CoreMetricBar";
import { gearSlotLabels } from "@/ui/services/labels";
import type {
  GearTableGearItem,
  GearTableFoodItem,
  GearTableRow,
} from "@/ui/components/results/gear-table/types";
import { buildGearTableGearItem } from "@/ui/components/results/gear-table/result-gear-table-rows";
import type { ComparisonEntry } from "./types";

export const MAX_COMPARISON_ENTRIES = 4;

export function comparisonPlanLabel(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

export function comparisonEntryValidationError(
  entry: ComparisonEntry,
  expectedJob?: JobId,
): string | undefined {
  const { snapshot } = entry;
  if (expectedJob && snapshot.jobId !== expectedJob) {
    return `职业不匹配：当前比较 ${jobSchemas[expectedJob].name}，导入内容为 ${jobSchemas[snapshot.jobId].name}。`;
  }
  if (
    !Number.isFinite(snapshot.calculationLevel) ||
    snapshot.calculationLevel <= 0
  ) {
    return "结果缺少有效的计算等级，无法加入对比。";
  }
  if (
    !Number.isFinite(snapshot.damagePerPotency) ||
    snapshot.damagePerPotency <= 0 ||
    !Number.isFinite(snapshot.damagePerSecond) ||
    snapshot.damagePerSecond <= 0
  ) {
    return "结果伤害指标为 0 或无效值，无法加入对比。";
  }
  const { effects } = snapshot;
  if (
    ![effects.gcd, effects.crtChance, effects.dhtChance].every(
      Number.isFinite,
    ) ||
    effects.gcd <= 0
  ) {
    return "结果缺少有效的 GCD、暴击率或直击率，无法加入对比。";
  }
  if (
    jobSchemas[snapshot.jobId].role === "tank" &&
    !Number.isFinite(effects.tenMitigation)
  ) {
    return "坦克结果缺少有效的坚韧减伤数据，无法加入对比。";
  }
  return undefined;
}

export function appendComparisonEntry(
  entries: readonly ComparisonEntry[],
  entry: ComparisonEntry,
  jobId: JobId,
): ComparisonEntry[] {
  const validationError = comparisonEntryValidationError(entry, jobId);
  if (validationError) throw new Error(validationError);
  if (entries.length >= MAX_COMPARISON_ENTRIES) {
    throw new Error(`最多同时比较 ${MAX_COMPARISON_ENTRIES} 套方案。`);
  }
  if (entries.some(({ snapshot }) => snapshot.jobId !== jobId)) {
    throw new Error("对比方案职业不一致，请清空当前方案后再切换职业。");
  }
  return [...entries, entry];
}

export function removeComparisonEntry(
  entries: readonly ComparisonEntry[],
  index: number,
): ComparisonEntry[] {
  if (!Number.isInteger(index) || index < 0 || index >= entries.length)
    return [...entries];
  return entries.filter((_, entryIndex) => entryIndex !== index);
}

export async function approveComparisonJobChange(
  entries: readonly ComparisonEntry[],
  confirm: () => Promise<boolean>,
): Promise<boolean> {
  return entries.length === 0 || confirm();
}

export function buildComparisonMetricEntries(
  entries: readonly ComparisonEntry[],
): CoreMetricEntry[] {
  const baseline = entries[0]?.snapshot;
  return entries.map(({ snapshot }, index) => {
    const base: CoreMetricEntry = {
      key: comparisonPlanLabel(index),
      label: comparisonPlanLabel(index),
      damagePerPotency: snapshot.damagePerPotency,
      damagePerSecond: snapshot.damagePerSecond,
      gcd: snapshot.effects.gcd,
      criticalRate: snapshot.effects.crtChance,
      directHitRate: snapshot.effects.dhtChance,
      hp: snapshot.effects.hp,
      tenacityMitigation: snapshot.effects.tenMitigation,
    };
    if (!baseline || index === 0) return base;
    return {
      ...base,
      deltas: {
        damagePerPotency: {
          absolute: snapshot.damagePerPotency - baseline.damagePerPotency,
          percent:
            ((snapshot.damagePerPotency - baseline.damagePerPotency) /
              baseline.damagePerPotency) *
            100,
        },
        damagePerSecond: {
          absolute: snapshot.damagePerSecond - baseline.damagePerSecond,
          percent:
            ((snapshot.damagePerSecond - baseline.damagePerSecond) /
              baseline.damagePerSecond) *
            100,
        },
        gcd: snapshot.effects.gcd - baseline.effects.gcd,
        tenacityMitigationPp:
          (snapshot.effects.tenMitigation - baseline.effects.tenMitigation) *
          100,
      },
    };
  });
}

function foodIdentity(entry: ComparisonEntry): string {
  const food = entry.snapshot.food;
  if (!food) return "no-food";
  return JSON.stringify({
    id: food.id,
    name: food.name,
    level: food.level,
    stats: food.stats,
    statRates: food.statRates,
    actualStats: food.actualStats,
    utilization: food.utilization,
    statsMeaning: "actual-gain",
    sourceFile: food.sourceFile,
    best: food.best,
  });
}

function comparisonFoodItem(entry: ComparisonEntry): GearTableFoodItem {
  const food = entry.snapshot.food;
  return food
    ? {
        kind: "food",
        key: foodIdentity(entry),
        itemId: food.id,
        name: food.name,
        level: food.level,
        source: food.sourceFile,
        statsMeaning: "actual-gain",
        actualStats: food.actualStats,
        utilization: food.utilization,
        stats: food.stats,
      }
    : { kind: "food", key: "no-food", name: "无食物", stats: {}, actualStats: {}, utilization: 0 };
}

const comparisonSlotOrder = [
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
] as const;

export function buildComparisonGearTableRows(
  entries: readonly ComparisonEntry[],
): GearTableRow[] {
  const rows: GearTableRow[] = [];
  for (const slot of comparisonSlotOrder) {
    let firstRowForSlot = true;
    const groups = new Map<
      string,
      { item: GearTableGearItem; indexes: number[] }
    >();
    entries.forEach(({ snapshot }, index) => {
      const gear = snapshot.gear.find((candidate) => candidate.slot === slot);
      if (!gear) return;
      const item = buildGearTableGearItem(gear, gear.slot, {
        jobLevel: snapshot.calculationLevel,
        sync: snapshot.sync,
      });
      const group = groups.get(item.key);
      if (group) group.indexes.push(index);
      else groups.set(item.key, { item, indexes: [index] });
    });
    for (const [identity, group] of groups) {
      const marker =
        group.indexes.length === entries.length
          ? "全部"
          : group.indexes.map(comparisonPlanLabel).join("/");
      rows.push({
        key: `gear-${slot}-${identity}`,
        slotLabel: firstRowForSlot
          ? slot === "earrings"
            ? "耳坠"
            : gearSlotLabels[slot]
          : "",
        marker,
        item: group.item,
      });
      firstRowForSlot = false;
    }
  }

  const foodGroups = new Map<
    string,
    { item: GearTableFoodItem; indexes: number[] }
  >();
  entries.forEach((entry, index) => {
    const item = comparisonFoodItem(entry);
    const group = foodGroups.get(item.key);
    if (group) group.indexes.push(index);
    else foodGroups.set(item.key, { item, indexes: [index] });
  });
  [...foodGroups].forEach(([identity, group], index) =>
    rows.push({
      key: `food-${identity}`,
      slotLabel: index === 0 ? "食物" : "",
      marker:
        group.indexes.length === entries.length
          ? "全部"
          : group.indexes.map(comparisonPlanLabel).join("/"),
      item: group.item,
    }),
  );

  entries.forEach(({ snapshot }, index) => {
    const itemLevel =
      snapshot.gear.length > 0
        ? Math.round(
            snapshot.gear.reduce((sum, gear) => sum + gear.level, 0) /
              snapshot.gear.length,
          )
        : undefined;
    const label = comparisonPlanLabel(index);
    rows.push({
      key: `summary-${label}`,
      slotLabel: "总属性",
      marker: label,
      item: {
        kind: "summary",
        key: `summary-${label}`,
        label: `${label} 总属性`,
        itemLevel,
        stats: snapshot.stats,
      },
    });
  });
  return rows;
}
