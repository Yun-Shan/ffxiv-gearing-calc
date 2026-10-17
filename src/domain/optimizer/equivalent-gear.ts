import { gearOptionsFor } from "../gear-options.ts";
import type {
  CustomizableStat,
  GearSlot,
  MeldedGear,
  OptimizationConfig,
  OptimizationResult,
  SearchOptions,
  Stats,
} from "../types.ts";
import type { GearCandidate } from "./context.ts";
import { makeGearCandidates } from "./equipment-candidates.ts";
import { candidateGearFromInfo } from "./result-assembly.ts";
import { attributeIndex, throwIfAborted } from "./context.ts";

function normalizedStats(stats: Stats) {
  return Object.entries(stats)
    .filter(([, value]) => value !== undefined && value !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

/** Includes every final stat, both damage types, weapon delay and resolved weapon performance. */
function effectKey(gear: MeldedGear): string {
  return JSON.stringify([
    gear.slot === "ring2" ? "ring" : gear.slot,
    normalizedStats(gear.finalStats),
    gear.weaponDamage ?? 0,
  ]);
}

function identity(gear: MeldedGear): string {
  return JSON.stringify([
    gear.id,
    effectKey(gear),
    gear.melds
      .map(({ stat, value, grade }) => [stat, value, grade])
      .sort((a, b) => String(a).localeCompare(String(b))),
  ]);
}

/** Solve only the one allocation implied by exact target stats, never enumerate its integer domain. */
function matchingCandidate(
  candidate: GearCandidate,
  target: MeldedGear,
  map: Map<string, MeldedGear>,
): MeldedGear | undefined {
  const adjustment = candidate.equipment.resistanceWeaponAdjust;
  if (!adjustment)
    return effectKey(candidate.gear) === effectKey(target)
      ? candidate.gear
      : undefined;
  const allocation: {
    stat: CustomizableStat;
    baseParamId: number;
    value: number;
  }[] = [];
  let total = 0;
  for (const stat of adjustment.stats) {
    const value =
      (target.finalStats[stat] ?? 0) - (candidate.gear.finalStats[stat] ?? 0);
    const max = adjustment.statMaximums?.[stat] ?? adjustment.maxEachStat;
    if (!Number.isSafeInteger(value) || value < 0 || value > max)
      return undefined;
    if (value > 0)
      allocation.push({ stat, baseParamId: attributeIndex.get(stat)!, value });
    total += value;
  }
  if (total > adjustment.maxTotalStats) return undefined;
  const gear = candidateGearFromInfo(
    { ...candidate.equipment, resistanceAllocation: allocation },
    candidate.gear.slot,
    { gearsByIdentity: map },
  );
  return effectKey(gear) === effectKey(target) ? gear : undefined;
}

/** Presentation alternatives are collected after solving, from the original legal pool before Pareto pruning. */
export function attachEquivalentGear(
  result: OptimizationResult,
  config: OptimizationConfig,
  options: SearchOptions = {},
): OptimizationResult {
  if (config.syncLevel === undefined) return result;
  const groups: Record<string, readonly MeldedGear[]> = {};
  const groupKeys = new Map<string, string>();
  const cache = new Map<string, { all?: string; unique?: string }>();
  const intern = (gears: MeldedGear[]): string => {
    const sorted = gears.toSorted(
      (a, b) =>
        a.level - b.level ||
        a.id - b.id ||
        identity(a).localeCompare(identity(b)),
    );
    const signature = JSON.stringify(sorted.map(identity));
    const existing = groupKeys.get(signature);
    if (existing !== undefined) return existing;
    const key = `equivalent-${groupKeys.size}`;
    groupKeys.set(signature, key);
    groups[key] = sorted;
    return key;
  };
  const gear = result.gear.map((selected) => {
    throwIfAborted(options.signal);
    const slot = selected.slot;
    const physicalSlot: GearSlot = slot === "ring2" ? "ring" : slot;
    const forced = config.forcedGear[slot];
    const signature = JSON.stringify([effectKey(selected), forced ?? null]);
    let keys = cache.get(signature);
    if (!keys) {
      const matches = new Map<string, MeldedGear>();
      for (const raw of gearOptionsFor(config, slot)) {
        throwIfAborted(options.signal);
        if (forced !== undefined && raw.id !== forced) continue;
        const map = new Map<string, MeldedGear>();
        for (const candidate of makeGearCandidates(
          raw,
          physicalSlot,
          config,
          map,
        )) {
          const match = matchingCandidate(candidate, selected, map);
          if (match) matches.set(identity(match), match);
        }
      }
      if (!matches.has(identity(selected)))
        throw new Error(`槽位 ${slot} 的当前装备不在合法同属性候选中`);
      // Retain the exact selected meld/allocation snapshot in its complete group.
      matches.set(identity(selected), { ...selected, slot: physicalSlot });
      const all = [...matches.values()];
      keys =
        all.length <= 1
          ? {}
          : physicalSlot === "ring"
            ? {
                all: intern(all),
                unique: intern(all.filter((item) => item.unique)),
              }
            : { all: intern(all) };
      cache.set(signature, keys);
    }
    return {
      ...selected,
      ...(keys.all === undefined ? {} : { replacementGroupKey: keys.all }),
      ...(keys.unique === undefined
        ? {}
        : { uniqueReplacementGroupKey: keys.unique }),
    };
  });
  return {
    ...result,
    gear,
    ...(Object.keys(groups).length ? { equivalentGear: groups } : {}),
  };
}
