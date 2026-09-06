import { foods, gears, gameData, materiaGradeRequiredLevels } from "./data";
import { currentLevel, jobSchemas } from "./jobs";
import { addStats, applyFood, calculateBaseStats, calculateEffects, calculateGcdTier, getSpeedStat, isGearUsable, mergeGearStats } from "./rules";
import type { Gear, GearSlot, MeldedGear, Materia, OptimizationConfig, OptimizationResult, Stat, Stats } from "./types";

interface Candidate {
  gear: MeldedGear;
  stats: Stats;
  weaponDamage: number;
}

interface SearchState {
  items: MeldedGear[];
  stats: Stats;
  weaponDamage: number;
}

interface SpeedProfile {
  gearId: number;
  speed: number;
  tenacity: number;
}

interface GroupOption {
  gears: MeldedGear[];
  stats: Stats;
  weaponDamage: number;
}

function getJob(config: OptimizationConfig) {
  return jobSchemas[config.jobId];
}

function materiaFor(stat: Materia["stat"], itemLevel: number): Materia {
  let grade = 1;
  for (let index = 0; index < materiaGradeRequiredLevels.length; index++)
    if (materiaGradeRequiredLevels[index] <= itemLevel) grade = index + 1;
  const value = gameData.materias[stat]?.[grade - 1];
  if (value === undefined) throw new Error(`魔晶石 ${stat} 缺少 ${grade} 级数值`);
  return { stat, value, grade };
}

function relevantMateriaStats(job: ReturnType<typeof getJob>): Materia["stat"][] {
  return job.role === "tank"
    ? ["CRT", "DET", "TEN", "SKS"]
    : job.role === "healer"
      ? ["CRT", "DET", "PIE", "SPS"]
      : ["CRT", "DET", "DHT", job.role === "int" ? "SPS" : "SKS"];
}

// 自定义参数武器：每个槽只能从 MCP 返回的 big/small 两档数值中二选一，生成 2^N 个完整候选。
function forEachMeldCombination(
  gear: Gear,
  job: ReturnType<typeof getJob>,
  visit: (melds: Materia[]) => void,
): void {
  if (gear.customParameters && gear.customParameters.length > 0) {
    const slots = gear.customParameters;
    const walk = (index: number, melds: Materia[]) => {
      if (index === slots.length) {
        visit(melds);
        return;
      }
      const slot = slots[index];
      walk(index + 1, [...melds, { stat: slot.stat, value: slot.bigValue, grade: 0 }]);
      walk(index + 1, [...melds, { stat: slot.stat, value: slot.smallValue, grade: 0 }]);
    };
    walk(0, []);
    return;
  }
  const relevant = relevantMateriaStats(job);
  const meldCount = Math.min(gear.materiaSlots, 2);
  const walk = (index: number, melds: Materia[]) => {
    if (index === meldCount) {
      visit(melds);
      return;
    }
    for (const stat of relevant)
      walk(index + 1, [...melds, materiaFor(stat, gear.level)]);
  };
  walk(0, []);
}

function candidateMelds(gear: Gear, job: ReturnType<typeof getJob>): Candidate[] {
  const options: Candidate[] = [];
  forEachMeldCombination(gear, job, (melds) => {
    const stats = mergeGearStats(gear, melds.map((meld) => ({ [meld.stat]: meld.value })));
    options.push({ gear: { ...gear, melds, finalStats: stats }, stats, weaponDamage: gear.weaponDamage ?? 0 });
  });
  const unique = new Map<string, Candidate>();
  for (const option of options) {
    const key = JSON.stringify(option.stats) + "|" + option.weaponDamage;
    if (!unique.has(key)) unique.set(key, option);
  }
  return [...unique.values()];
}

function dominanceDimensions(job: ReturnType<typeof getJob>): Stat[] {
  return [job.attackStat, "CRT", "DET", "DHT", "TEN"];
}

function candidateOrder(a: Candidate, b: Candidate, job: ReturnType<typeof getJob>): number {
  for (const stat of dominanceDimensions(job)) {
    const difference = (b.stats[stat] ?? 0) - (a.stats[stat] ?? 0);
    if (difference) return difference;
  }
  return b.weaponDamage - a.weaponDamage;
}

// 帕雷主导：候选 A 在主导维度全部不弱于 B 且至少一项严格更强时 A 主导 B；
// GCD 目标模式下同一速度分桶内才可比，所以同一桶内的 A 可安全取代 B。
function candidateDominates(
  a: Candidate,
  b: Candidate,
  job: ReturnType<typeof getJob>,
  gcdTargeted: boolean,
): boolean {
  if (gcdTargeted &&
      (a.stats[getSpeedStat(job)] ?? 0) !== (b.stats[getSpeedStat(job)] ?? 0)) return false;
  let strictlyBetter = a.weaponDamage > b.weaponDamage;
  if (a.weaponDamage < b.weaponDamage) return false;
  for (const stat of dominanceDimensions(job)) {
    const aValue = a.stats[stat] ?? 0;
    const bValue = b.stats[stat] ?? 0;
    if (aValue < bValue) return false;
    if (aValue > bValue) strictlyBetter = true;
  }
  return strictlyBetter;
}

// 阶段一：单部位领先剩余减。在同一性质集合下，同一维度越高越好，
// 属性越高的候选可以在后续装备选择中被安全取代，从源头减少被选装备。
function pruneCandidateOptions(
  options: Candidate[],
  job: ReturnType<typeof getJob>,
  gcdTargeted: boolean,
): Candidate[] {
  const groups = new Map<number | string, Candidate[]>();
  const speedStat = getSpeedStat(job);
  for (const option of options) {
    const groupKey = gcdTargeted ? (option.stats[speedStat] ?? 0) : "all";
    const group = groups.get(groupKey) ?? [];
    if (group.some((candidate) => candidateDominates(candidate, option, job, gcdTargeted))) continue;
    for (let index = group.length - 1; index >= 0; index--)
      if (candidateDominates(option, group[index], job, gcdTargeted)) group.splice(index, 1);
    group.push(option);
    groups.set(groupKey, group);
  }
  return [...groups.values()].flat();
}

function speedProfilesForGear(gear: Gear, job: ReturnType<typeof getJob>): SpeedProfile[] {
  const speedStat = getSpeedStat(job);
  const profiles = new Map<string, SpeedProfile>();
  forEachMeldCombination(gear, job, (melds) => {
    const stats = mergeGearStats(gear, melds.map((meld) => ({ [meld.stat]: meld.value })));
    const profile = {
      gearId: gear.id,
      speed: stats[speedStat] ?? 0,
      tenacity: stats.TEN ?? 0,
    };
    const key = `${profile.speed}:${profile.tenacity}`;
    if (!profiles.has(key)) profiles.set(key, profile);
  });
  return [...profiles.values()];
}

function getFoodChoices(config: OptimizationConfig) {
  if (config.foodId) return foods.filter((food) => food.id === config.foodId);
  const combatFoods = foods.filter((food) => food.best && food.stats.VIT);
  const highestLevel = Math.max(...combatFoods.map((food) => food.level));
  return combatFoods.filter((food) => food.level === highestLevel);
}

function makeGroups(optionsBySlot: Candidate[][]): GroupOption[][] {
  return optionsBySlot.map((options) =>
    options.map((option) => ({
      gears: [option.gear],
      stats: option.stats,
      weaponDamage: option.weaponDamage,
    })));
}

function sourceSlot(slot: GearSlot): GearSlot { return slot === "ring2" ? "ring" : slot; }

function searchSlots(config: OptimizationConfig): GearSlot[] {
  return ["weapon", ...(config.jobId === "PLD" ? ["offhand" as GearSlot] : []), "head", "body", "hands", "legs",
    "feet", "earrings", "necklace", "bracelet", "ring", "ring2"];
}

function speedProfilesForSlot(config: OptimizationConfig, slot: GearSlot): SpeedProfile[] {
  const job = getJob(config);
  const pool = gearOptionsFor(config, slot);
  const forcedId = config.forcedGear[slot];
  const forced = forcedId ? pool.find((gear) => gear.id === forcedId) : undefined;
  if (forced) {
    // 锁定装备本体，但仍保留普通孔魔晶石方案。
    return speedProfilesForGear({ ...forced, slot }, job);
  }
  return pool.flatMap((gear) => speedProfilesForGear(gear, job));
}

function combineSpeedProfiles(
  states: Map<number, number>,
  profiles: SpeedProfile[],
): Map<number, number> {
  const bestProfiles = new Map<number, number>();
  for (const profile of profiles)
    bestProfiles.set(profile.speed, Math.max(bestProfiles.get(profile.speed) ?? 0, profile.tenacity));
  const next = new Map<number, number>();
  for (const [speed, tenacity] of states)
    for (const [profileSpeed, profileTenacity] of bestProfiles) {
      const combinedSpeed = speed + profileSpeed;
      const combinedTenacity = tenacity + profileTenacity;
      next.set(combinedSpeed, Math.max(next.get(combinedSpeed) ?? 0, combinedTenacity));
    }
  return next;
}

function ringPairProfiles(config: OptimizationConfig): SpeedProfile[] {
  const first = speedProfilesForSlot(config, "ring");
  const second = speedProfilesForSlot(config, "ring2");
  const pairs = new Map<string, SpeedProfile>();
  for (const left of first) for (const right of second) {
    if (left.gearId === right.gearId) continue;
    const profile = {
      gearId: left.gearId,
      speed: left.speed + right.speed,
      tenacity: left.tenacity + right.tenacity,
    };
    const key = `${profile.speed}:${profile.tenacity}`;
    if (!pairs.has(key)) pairs.set(key, profile);
  }
  return [...pairs.values()];
}

export function findFeasibleGcds(config: OptimizationConfig): number[] {
  const job = getJob(config);
  const speedStat = getSpeedStat(job);
  const base = calculateBaseStats(job, currentLevel);
  let states = new Map<number, number>([[base[speedStat] ?? 0, base.TEN ?? 0]]);
  for (const slot of searchSlots(config).filter((item) => !item.startsWith("ring"))) {
    states = combineSpeedProfiles(states, speedProfilesForSlot(config, slot));
    if (!states.size) return [];
  }
  states = combineSpeedProfiles(states, ringPairProfiles(config));
  if (!states.size) return [];

  const foodChoices = getFoodChoices(config);
  const finalStates = new Map<number, number>();
  for (const [speed, tenacity] of states) for (const food of foodChoices) {
    const withFood = applyFood(
      { [speedStat]: speed, TEN: tenacity },
      food.stats,
      food.statRates,
    );
    const finalSpeed = withFood[speedStat] ?? speed;
    const finalTenacity = withFood.TEN ?? tenacity;
    finalStates.set(finalSpeed, Math.max(finalStates.get(finalSpeed) ?? 0, finalTenacity));
  }
  if (!finalStates.size) return [];

  const requiredTenacity = config.maximizeTenacity && job.role === "tank"
    ? Math.max(...finalStates.values())
    : config.minTenacity ?? 0;
  return [...finalStates.entries()]
    .filter(([, tenacity]) => tenacity >= requiredTenacity)
    .map(([speed]) => calculateGcdTier({ [speedStat]: speed }, job, currentLevel))
    .filter((gcd, index, all) => all.indexOf(gcd) === index)
    .sort((a, b) => b - a);
}

// 顶档宽用于限定保留到下一阶段的帕雷候选基数。
const beamWidth = 2000;
const targetStatesPerSpeed = 4;

function stateKey(state: SearchState): string {
  return JSON.stringify(state.items.map((item) => ({
    id: item.id,
    melds: item.melds.map(({ stat, value, grade }) => ({ stat, value, grade })),
  })));
}

// 阶段二 + 阶段三：组合使用帕雷状态剩余减 + 目标 GCD 分桶 + 速度食物代表。
// 这一步不是严格帕雷主导而是启发式宽度限制，但所有原始候选都被阶段一严格主导过滤过，
// 因此只是减少被考虑的组合数，而不是任意选择代表性候选。
function speedFoodRepresentatives(
  expanded: SearchState[],
  job: ReturnType<typeof getJob>,
  food: ReturnType<typeof getFoodChoices>[number],
  maxPerSpeed: number,
): SearchState[] {
  const speedStat = getSpeedStat(job);
  const bySpeed = new Map<number, { state: SearchState; damage: number }[]>();
  for (const state of expanded) {
    const speed = state.stats[speedStat] ?? 0;
    const stats = applyFood(state.stats, food.stats, food.statRates);
    const damage = calculateEffects({ stats, job, level: currentLevel, weaponDamage: state.weaponDamage }).damage;
    const reps = bySpeed.get(speed) ?? [];
    reps.push({ state, damage });
    reps.sort((a, b) => b.damage - a.damage || (
      b.state.weaponDamage - a.state.weaponDamage
    ));
    if (reps.length > maxPerSpeed) reps.pop();
    bySpeed.set(speed, reps);
  }
  return [...bySpeed.values()].flatMap((items) => items.map(({ state }) => state));
}

function expandBeam(states: SearchState[], options: Candidate[], config: OptimizationConfig): SearchState[] {
  const expanded: SearchState[] = [];
  for (const state of states) for (const option of options) {
    if (state.items.some((item) => item.id === option.gear.id)) continue;
    expanded.push({
      items: [...state.items, option.gear],
      stats: addStats(state.stats, option.stats),
      weaponDamage: state.weaponDamage + option.weaponDamage,
    });
  }
  const job = getJob(config);
  const foodChoices = config.gcdTarget !== undefined ? getFoodChoices(config) : [];
  // 中间档位以原始结构加权为评分，避免被未达到目标 GCD 的候选例行偏量打乱。
  const scored = expanded.map((state) => {
    const attack = state.stats[job.attackStat] ?? 0;
    return {
      state,
      score: state.weaponDamage * 1_000_000
        + attack * 100
        + (state.stats.CRT ?? 0) * 4
        + (state.stats.DET ?? 0) * 4
        + (state.stats.DHT ?? 0) * 3
        + (state.stats.TEN ?? 0) * (job.role === "tank" ? 1 : 0),
    };
  });
  const ranked = scored.sort((a, b) => b.score - a.score).slice(0, beamWidth).map(({ state }) => state);

  if (config.gcdTarget === undefined) return ranked;
  // 速度食物代表：保证能提供速度的食物在各速度档位上都能选上高伤害状态。
  const speedStat = getSpeedStat(job);
  const speedFoodStates = foodChoices
    .filter((food) => (food.stats[speedStat] ?? 0) > 0)
    .flatMap((food) => speedFoodRepresentatives(expanded, job, food, targetStatesPerSpeed));
  // 同一速度分组保留多个代表，避免某个高速度档位被顶层排序丢弃。
  const bySpeed = new Map<number, SearchState[]>();
  for (const state of ranked) {
    const speed = state.stats[speedStat] ?? 0;
    const reps = bySpeed.get(speed) ?? [];
    if (reps.length < targetStatesPerSpeed) reps.push(state);
    bySpeed.set(speed, reps);
  }
  const retained = new Map<string, SearchState>();
  for (const state of [...ranked, ...speedFoodStates, ...[...bySpeed.values()].flat()])
    retained.set(stateKey(state), state);
  return [...retained.values()];
}

export function optimize(config: OptimizationConfig): OptimizationResult | undefined {
  const started = performance.now();
  const job = getJob(config);
  const foodChoices = getFoodChoices(config);
  if (!foodChoices.length) return undefined;
  const slots = searchSlots(config);
  const optionsBySlot: Candidate[][] = [];
  let searchedCandidates = 0;
  for (const slot of slots) {
    const pool = gearOptionsFor(config, slot);
    const forcedId = config.forcedGear[slot];
    const forced = forcedId ? pool.find((gear) => gear.id === forcedId) : undefined;
    const rawOptions = forced
      ? candidateMelds({ ...forced, slot }, job)
      : pool.flatMap((gear) => candidateMelds({ ...gear, slot }, job));
    const options = slot.startsWith("ring")
      ? rawOptions
      : pruneCandidateOptions(rawOptions, job, config.gcdTarget !== undefined);
    options.sort((a, b) => candidateOrder(a, b, job));
    console.error("candidate-count", slot, pool.length, rawOptions.length, options.length);
    if (!options.length) return undefined;
    optionsBySlot.push(options);
    searchedCandidates += options.length;
  }
  const groups = makeGroups(optionsBySlot);

  let states: SearchState[] = [{ items: [], stats: calculateBaseStats(job, currentLevel), weaponDamage: 0 }];
  const frontierSizes: number[] = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const before = states.length;
    const groupOptions: Candidate[] = groups[groupIndex].map((option) => ({
      gear: option.gears[0],
      stats: option.stats,
      weaponDamage: option.weaponDamage,
    }));
    states = expandBeam(states, groupOptions, config);
    frontierSizes.push(states.length);
    console.info("optimizer-frontier", { slot: groupIndex, expanded: before * groups[groupIndex].length, retained: states.length });
    if (!states.length) return undefined;
  }

  const maxTenacity = config.maximizeTenacity && job.role === "tank"
    ? Math.max(...states.map((state) => state.stats.TEN ?? 0)) : 0;
  const requiredTenacity = config.maximizeTenacity && job.role === "tank" ? maxTenacity : (config.minTenacity ?? 0);
  let best: OptimizationResult | undefined;
  for (const state of states) for (const food of foodChoices) {
    const stats = applyFood(state.stats, food.stats, food.statRates);
    const effects = calculateEffects({ stats, job, level: currentLevel, weaponDamage: state.weaponDamage });
    if ((config.gcdTarget !== undefined && Math.abs(effects.gcd - config.gcdTarget) >= 0.001) ||
        (stats.TEN ?? 0) < requiredTenacity) continue;
    if (!best || effects.damage > best.score) best = {
      gear: state.items,
      food,
      stats,
      effects,
      score: effects.damage,
      gcdTier: effects.gcd,
      searchedCandidates,
      durationMs: performance.now() - started,
    };
  }
  console.info("optimizer-complete", { frontierSizes, finalStates: states.length, found: Boolean(best), durationMs: performance.now() - started });
  return best;
}

export function gearOptionsFor(config: OptimizationConfig, slot: GearSlot): Gear[] {
  const job = getJob(config);
  const actualSlot = sourceSlot(slot);
  return gears.filter((gear) => gear.slot === actualSlot &&
    isGearUsable(gear, job, config.minItemLevel, config.maxItemLevel, config.excludedSources));
}
