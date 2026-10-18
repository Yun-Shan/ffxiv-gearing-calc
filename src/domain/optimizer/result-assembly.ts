import { describeFoodResult } from "../food-result.ts";
import {
  addStats,
  applyFood,
  calculateBaseStats,
  calculateEffects,
} from "../rules.ts";
import { isRingPairEquipInfo } from "../search/ring-pairs.ts";
import {
  equipmentCandidateIdentity,
} from "../search/equipment-identity.ts";
import {
  findBestLoadoutExactMip,
  type ExactMipResult,
} from "../search/loadout-finder-exact-mip.ts";
import type {
  Effects,
  CustomizableStat,
  Food,
  GearSlot,
  MeldedGear,
  OptimizationConfig,
  OptimizationResult,
  Stats,
} from "../types.ts";
import { foodIdentity, foodStatsForJob } from "./equipment-candidates.ts";
import type { PreparedSearch, SolverFood } from "./context.ts";
import type { EquipInfo } from "../search/types.ts";

export function candidateGearFromInfo(
  equipment: EquipInfo,
  slot: GearSlot,
  prepared: Pick<PreparedSearch, "gearsByIdentity">,
): MeldedGear {
  const canonical = prepared.gearsByIdentity.get(equipmentCandidateIdentity(equipment));
  if (!canonical) {
    throw new Error(`精确搜索返回了未生成的装备候选：${equipment.itemId}`);
  }
  if (equipment.resistanceAllocation === undefined) return { ...canonical, slot };
  const adjustment = canonical.resistanceWeaponAdjust;
  if (adjustment === undefined) {
    throw new Error(`装备 ${equipment.itemId} 返回了不支持的义军武器属性分配`);
  }
  const seen = new Set<CustomizableStat>();
  let allocatedTotal = 0;
  const finalStats = { ...canonical.finalStats };
  const allocations = equipment.resistanceAllocation.map(({ stat, value }) => {
    if (!adjustment.stats.includes(stat) || seen.has(stat) ||
      !Number.isSafeInteger(value) || value <= 0 || value > adjustment.maxEachStat) {
      throw new Error(`义军武器 ${equipment.itemId} 返回了无效的 ${stat} 属性分配`);
    }
    seen.add(stat);
    allocatedTotal += value;
    finalStats[stat] = (finalStats[stat] ?? 0) + value;
    return { stat, value, grade: 0 as const };
  });
  if (!Number.isSafeInteger(allocatedTotal) || allocatedTotal > adjustment.maxTotalStats) {
    throw new Error(`义军武器 ${equipment.itemId} 的总分配属性超过 ResistanceWeaponAdjust 上限`);
  }
  return {
    ...canonical,
    slot,
    finalStats,
    melds: [...canonical.melds, ...allocations],
  };
}

function resultGear(
  result: ExactMipResult,
  prepared: PreparedSearch,
): MeldedGear[] {
  const gear: MeldedGear[] = [];
  for (let index = 0; index < result.selection.length; index++) {
    const equipment = result.selection[index]!;
    const slotName = prepared.slots[index]?.name;
    if (slotName === "rings") {
      if (!isRingPairEquipInfo(equipment)) {
        throw new Error("戒指搜索结果缺少完整戒指对");
      }
      gear.push(
        candidateGearFromInfo(equipment.ringEquips[0], "ring", prepared),
      );
      gear.push(
        candidateGearFromInfo(equipment.ringEquips[1], "ring2", prepared),
      );
    } else {
      if (!slotName) throw new Error(`搜索结果包含未知槽位索引 ${index}`);
      gear.push(
        candidateGearFromInfo(equipment, slotName as GearSlot, prepared),
      );
    }
  }
  return gear;
}

export function resultFood(
  result: ExactMipResult,
  prepared: PreparedSearch,
): Food {
  if (!result.food) throw new Error("精确搜索结果缺少食物");
  const food = prepared.foodsByIdentity.get(foodIdentity(result.food));
  if (!food)
    throw new Error(`精确搜索返回了未生成的食物候选：${result.food.itemId}`);
  return food;
}

export function assembleResult(
  result: ExactMipResult,
  config: OptimizationConfig,
  prepared: PreparedSearch,
): OptimizationResult {
  const selectedGear = resultGear(result, prepared);
  const food = resultFood(result, prepared);
  const baseStats = calculateBaseStats(
    prepared.jobSchema,
    prepared.jobLevel,
    prepared.clanIndex,
  );
  const gearStats = addStats(...selectedGear.map((gear) => gear.finalStats));
  const unbuffedStats = addStats(baseStats, gearStats);
  const applicableFood = foodStatsForJob(food, config.jobId);
  const stats = applyFood(
    unbuffedStats,
    applicableFood.stats,
    applicableFood.statRates,
  );
  const weaponStat =
    prepared.jobSchema.mainStat === "INT" ||
    prepared.jobSchema.mainStat === "MND"
      ? "MDMG"
      : "PDMG";
  const effects: Effects = calculateEffects({
    stats,
    job: prepared.jobSchema,
    level: prepared.jobLevel,
    weaponDamage: stats[weaponStat] ?? 0,
    clanIndex: prepared.clanIndex,
  });
  const damagePerSecond = effects.damage / effects.gcd;
  return {
    calculationLevel: prepared.jobLevel,
    gear: selectedGear,
    food: describeFoodResult(food, unbuffedStats, stats),
    stats,
    effects,
    score: prepared.objective === "dps" ? damagePerSecond : effects.damage,
    objective: prepared.objective,
    damagePerSecond,
    gcdTier: effects.gcd,
    searchedCandidates: prepared.searchedCandidates,
    durationMs: result.statistics.elapsedMs,
    ...(result.maximumToughness !== undefined
      ? {
          maximumTenacity: result.maximumToughness + (baseStats.TEN ?? 0),
        }
      : {}),
    statistics: result.statistics,
  };
}
