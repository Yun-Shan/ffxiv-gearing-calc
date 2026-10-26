import { gameData } from "../domain/data.ts";
import { fixedCustomEquipmentMelds } from "../domain/custom-gear-parameters.ts";
import { slotsForJob } from "../domain/gear-options.ts";
import { calculationJobLevelFor, jobLevelFor } from "../domain/job-level.ts";
import { addStatsForJob } from "../domain/job-stats.ts";
import {
  applyItemSpecialBonus,
  enabledItemSpecialBonusesForJob,
} from "../domain/item-special-bonus.ts";
import { describeFoodResult } from "../domain/food-result.ts";
import {
  applyFood,
  calculateBaseStats,
  calculateEffects,
  capGearStatsAtLevel,
  concretizeGearStats,
  effectiveGearSyncLevel,
} from "../domain/rules.ts";
import { foodStatsForJob } from "../domain/optimizer/candidates/foods.ts";
import {
  forcedAllowedMateriaStats,
  forcedMateriaCapacity,
  materiaAllowedAtPosition,
  materiaForGrade,
  mergeCandidateStats,
} from "../domain/optimizer/candidates/materia-rules.ts";
import { attachEquivalentGear } from "../domain/optimizer/equivalent-gear.ts";
import type { GearSlot, MeldedGear, Materia, Stats } from "../domain/types.ts";
import { check, equal } from "./binary.ts";
import { documentFromToken } from "./codec.ts";
import { resolvePattern } from "./patterns.ts";
import { domainConfig, validateConfigs } from "./validation.ts";
import {
  isUnknownSource,
  type ShareConfig,
  type ShareDocument,
  type ShareIdentity,
  type ShareResult,
  type ShareView,
} from "./types.ts";

function totals(melds: readonly Materia[]): Stats {
  const out: Stats = {};
  for (const m of melds) out[m.stat] = (out[m.stat] ?? 0) + m.value;
  return out;
}
function sameTotals(a: readonly Materia[], b: readonly Materia[]): boolean {
  const x = totals(a),
    y = totals(b);
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].every(
    (key) =>
      (x[key as Materia["stat"]] ?? 0) === (y[key as Materia["stat"]] ?? 0),
  );
}

/** Rebuild one selected item. This invokes no search or candidate enumeration. */
export function restoreItem(
  config: ShareConfig,
  identity: ShareIdentity,
  slot: GearSlot,
  level: number,
): MeldedGear {
  const raw = gameData.getGearById(identity.itemId),
    job = gameData.jobSchemas[config.jobId];
  check(raw && job, "装备或职业不存在");
  check(
    raw.jobs.includes(config.jobId) &&
      raw.slot === (slot === "ring2" ? "ring" : slot) &&
      raw.equipLevel <= jobLevelFor(config),
    "装备不适用于职业或槽位",
  );
  const resolved = { ...raw, stats: concretizeGearStats(raw.stats, job) },
    sync = effectiveGearSyncLevel(resolved, level, config.sync);
  const physical = resolvePattern(raw.id, identity.pattern),
    custom =
      raw.customParameters !== undefined ||
      raw.resistanceWeaponAdjust !== undefined;
  check(
    !(raw.customParameters && raw.resistanceWeaponAdjust),
    "装备自定义参数族冲突",
  );
  const melds: Materia[] = physical.flatMap((m, i) => {
    if (m === null) return [];
    if (m.grade === 0) {
      check(custom && m.value !== undefined);
      return [{ stat: m.stat, grade: 0, value: m.value }];
    }
    check(!custom);
    return [{ ...materiaForGrade(m.stat, m.grade), slotIndex: i }];
  });
  const force = config.forcedGear?.[slot];
  if (force !== undefined)
    check(
      (typeof force === "number" ? force : force.id) === raw.id,
      "选择与强制装备不一致",
    );
  let finalStats: Stats;
  if (custom) {
    check(
      new Set(melds.map((m) => m.stat)).size === melds.length,
      "重复自定义属性",
    );
    let before = { ...resolved.stats };
    for (const m of melds) before[m.stat] = (before[m.stat] ?? 0) + m.value;
    const absolute: Stats = Object.fromEntries(
      (
        raw.customParameters?.map((p) => p.stat) ??
        raw.resistanceWeaponAdjust!.stats
      ).map((stat) => [stat, before[stat] ?? 0]),
    );
    const expected = fixedCustomEquipmentMelds(
      resolved,
      config.jobId,
      absolute,
    );
    check(sameTotals(expected, melds), "自定义贡献不合法");
    if (typeof force === "object" && "customStats" in force) {
      check(
        sameTotals(
          fixedCustomEquipmentMelds(resolved, config.jobId, force.customStats),
          melds,
        ),
        "强制自定义分配不一致",
      );
      before = { ...resolved.stats, ...force.customStats };
    }
    finalStats =
      sync === undefined ? before : capGearStatsAtLevel(resolved, before, sync);
  } else {
    check(physical.length <= forcedMateriaCapacity(raw), "孔位超出装备容量");
    const allowed = forcedAllowedMateriaStats(config.jobId);
    for (const m of melds)
      check(
        allowed.includes(m.stat) &&
          materiaAllowedAtPosition(raw, m.slotIndex!, m),
        "魔晶石与物品不兼容",
      );
    if (sync === undefined && typeof force === "object" && "melds" in force) {
      force.melds.forEach((fixed, i) => {
        if (fixed !== null)
          check(
            melds.some(
              (m) =>
                m.slotIndex === i &&
                m.stat === fixed.stat &&
                m.grade === fixed.grade &&
                m.value === fixed.value,
            ),
            "固定魔晶石不一致",
          );
      });
    }
    finalStats = mergeCandidateStats(
      resolved,
      sync === undefined ? melds : [],
      level,
      config.sync,
    );
  }
  finalStats = applyItemSpecialBonus(
    finalStats,
    resolved,
    job,
    enabledItemSpecialBonusesForJob(config.jobId),
  );
  const weaponStat =
    job.mainStat === "INT" || job.mainStat === "MND" ? "MDMG" : "PDMG";
  return {
    ...resolved,
    slot,
    melds,
    finalStats,
    weaponDamage: finalStats[weaponStat] ?? raw.weaponDamage,
  };
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("恢复已取消", "AbortError");
}
export function restoreDocument(
  input: ShareDocument,
  signal?: AbortSignal,
): ShareView {
  validateConfigs(input);
  checkAbort(signal);
  const document = structuredClone(input),
    unknownSourceIds = [
      ...new Set(
        document.configs.flatMap((config) =>
          (config.excludedSources ?? [])
            .filter(isUnknownSource)
            .map((s) => s.unknownSourceId),
        ),
      ),
    ];
  const results = document.configs.map((config, i): ShareResult => {
    checkAbort(signal);
    const row = document.rows[i];
    check(row);
    const job = gameData.jobSchemas[config.jobId],
      level = calculationJobLevelFor(config),
      required = slotsForJob(config.jobId);
    check(
      row.gear.length === required.length &&
        required.every(
          (slot) => row.gear.filter((g) => g.slot === slot).length === 1,
        ),
      "配装槽位不完整",
    );
    const gear = row.gear.map((c) => {
      const identity = document.identities[c.identity];
      check(identity);
      return restoreItem(config, identity, c.slot, level);
    });
    const unique = new Set<number>();
    for (const item of gear) {
      check(!item.unique || !unique.has(item.id), "唯一装备重复");
      unique.add(item.id);
    }
    const before = addStatsForJob(
        job,
        calculateBaseStats(job, level, config.clanIndex),
        ...gear.map((g) => g.finalStats),
      ),
      rawFood = gameData.foods.find((food) => food.id === row.foodId);
    check(rawFood, `未知食物 ${row.foodId}`);
    const food = foodStatsForJob(rawFood, config.jobId),
      stats = applyFood(before, food.stats, food.statRates);
    const effects = calculateEffects({
      stats,
      job,
      level,
      weaponDamage:
        stats[
          job.mainStat === "INT" || job.mainStat === "MND" ? "MDMG" : "PDMG"
        ] ?? 0,
      clanIndex: config.clanIndex,
    });
    const result: ShareResult = {
      gear,
      food: describeFoodResult(rawFood, before, stats),
      stats,
      effects,
      calculationLevel: level,
      objective: config.objective,
      score:
        config.objective === "damage"
          ? effects.damage
          : effects.damage / effects.gcd,
      damagePerSecond: effects.damage / effects.gcd,
      gcdTier: effects.gcd,
      statistics: { elapsedMs: document.elapsedMs },
    };
    // Joint result pages currently offer no item replacement. Mirror that contract.
    return document.mode === "single" && unknownSourceIds.length === 0
      ? attachEquivalentGear(result, domainConfig(config), { signal })
      : result;
  });
  if (document.mode === "joint") {
    for (let i = 1; i < document.rows.length; i++)
      for (const slot of document.commonSlots) {
        const first = document.rows[0].gear.find((g) => g.slot === slot),
          next = document.rows[i].gear.find((g) => g.slot === slot);
        check(
          first &&
            next &&
            equal(
              document.identities[first.identity],
              document.identities[next.identity],
            ),
          "共享配装不一致",
        );
      }
    if (document.foodStrategy === "shared")
      check(
        document.rows.every((row) => row.foodId === document.rows[0].foodId),
        "共享食物不一致",
      );
  }
  checkAbort(signal);
  return { document, results, unknownSourceIds };
}
export function restoreShare(token: string, signal?: AbortSignal): ShareView {
  return restoreDocument(documentFromToken(token), signal);
}
