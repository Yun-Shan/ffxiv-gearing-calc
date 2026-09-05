import { foods, gears, gameData, materiaGradeRequiredLevels } from "./data";
import { currentLevel, jobSchemas } from "./jobs";
import { addStats, applyFood, calculateBaseStats, calculateEffects, calculateGcdTier, getSpeedStat, isGearUsable, mergeGearStats } from "./rules";
import type { Gear, GearSlot, MeldedGear, Materia, OptimizationConfig, OptimizationResult, Stats } from "./types";

interface Candidate { gear: MeldedGear; stats: Stats; weaponDamage: number }
interface SearchState { items: MeldedGear[]; stats: Stats; weaponDamage: number }
interface SpeedProfile { gearId: number; speed: number; tenacity: number }

const beamWidth = 500;
const gearsPerSlot = 24;
// Keep alternatives at each speed tier for DET/DHT/SPS breakpoint
// combinations to survive until the complete set is assembled.
const targetStatesPerSpeed = 4;
const automaticFoodStatesPerSpeed = 1;

function getJob(config: OptimizationConfig) { return jobSchemas[config.jobId]; }

function candidateValue(stats: Stats, job: ReturnType<typeof getJob>): number {
  const speed = stats[getSpeedStat(job)] ?? 0;
  return (stats[job.attackStat] ?? 0) * 4 + (stats.CRT ?? 0) * 1.05 +
    (stats.DET ?? 0) * 1.1 + (stats.DHT ?? 0) + speed * 0.3 +
    (stats.TEN ?? 0) * (job.role === "tank" ? 1 : 0.1);
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

function forEachMeldCombination(
  gear: Gear,
  job: ReturnType<typeof getJob>,
  visit: (melds: Materia[]) => void,
): void {
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
    const key = JSON.stringify(option.stats);
    if (!unique.has(key)) unique.set(key, option);
  }
  return [...unique.values()].sort((a, b) => candidateValue(b.stats, job) - candidateValue(a.stats, job));
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

function compareStates(
  a: SearchState,
  b: SearchState,
  job: ReturnType<typeof getJob>,
  useDamage = false,
): number {
  if (useDamage) {
    const aDamage = calculateEffects({ stats: a.stats, job, level: currentLevel, weaponDamage: a.weaponDamage }).damage;
    const bDamage = calculateEffects({ stats: b.stats, job, level: currentLevel, weaponDamage: b.weaponDamage }).damage;
    if (aDamage !== bDamage) return bDamage - aDamage;
  }
  return (b.weaponDamage - a.weaponDamage) * 100_000 +
    candidateValue(b.stats, job) - candidateValue(a.stats, job);
}

function foodAdjustedDamage(
  state: SearchState,
  job: ReturnType<typeof getJob>,
  foodChoices: ReturnType<typeof getFoodChoices>,
): number {
  const damages = foodChoices.map((food) => calculateEffects({
    stats: applyFood(state.stats, food.stats, food.statRates),
    job,
    level: currentLevel,
    weaponDamage: state.weaponDamage,
  }).damage);
  return Math.max(...damages);
}

function speedFoodRepresentatives(
  states: SearchState[],
  job: ReturnType<typeof getJob>,
  food: ReturnType<typeof getFoodChoices>[number],
  maxRepresentatives: number,
): SearchState[] {
  const bySpeed = new Map<number, { state: SearchState; damage: number }[]>();
  const speedStat = getSpeedStat(job);
  for (const state of states) {
    const speed = state.stats[speedStat] ?? 0;
    const damage = calculateEffects({
      stats: applyFood(state.stats, food.stats, food.statRates),
      job,
      level: currentLevel,
      weaponDamage: state.weaponDamage,
    }).damage;
    const representatives = bySpeed.get(speed) ?? [];
    representatives.push({ state, damage });
    representatives.sort(
      (a, b) => b.damage - a.damage || compareStates(a.state, b.state, job),
    );
    if (representatives.length > maxRepresentatives) representatives.pop();
    bySpeed.set(speed, representatives);
  }
  return [...bySpeed.values()].flatMap((items) => items.map(({ state }) => state));
}

function stateKey(state: SearchState): string {
  return JSON.stringify(
    state.items.map((item) => ({
      id: item.id,
      melds: item.melds.map(({ stat, value, grade }) => ({ stat, value, grade })),
    })),
  );
}

function expandBeam(states: SearchState[], options: Candidate[], config: OptimizationConfig): SearchState[] {
  const expanded: SearchState[] = [];
  for (const state of states) for (const option of options) {
    if (state.items.some((item) => item.id === option.gear.id)) continue;
    expanded.push({ items: [...state.items, option.gear], stats: addStats(state.stats, option.stats),
      weaponDamage: state.weaponDamage + option.weaponDamage });
  }
  const job = getJob(config);
  const useDamage = config.gcdTarget !== undefined;
  // The final pass evaluates every eligible food with the complete formula.
  // Automatic mode already limits food to the highest-level combat set. Keep
  // that small real-data set in the beam so food caps affect the ranking.
  const foodChoices = useDamage ? getFoodChoices(config) : [];
  const ranked = useDamage && foodChoices.length
    ? expanded
      .map((state) => ({ state, damage: foodAdjustedDamage(state, job, foodChoices) }))
      .sort((a, b) => b.damage - a.damage || compareStates(a.state, b.state, job))
      .map(({ state }) => state)
    : expanded.sort((a, b) => compareStates(a, b, job));
  if (config.gcdTarget === undefined) return ranked.slice(0, beamWidth);

  // A normal damage beam can discard every state at a slower GCD before the
  // final constraint is checked. Keep the best representatives for each
  // cumulative speed. Speed-food rankings are kept independently because a
  // food can change the speed breakpoint before the final food is selected.
  const bySpeed = new Map<number, SearchState[]>();
  const speedStat = getSpeedStat(job);
  for (const state of ranked) {
    const speed = state.stats[speedStat] ?? 0;
    const representatives = bySpeed.get(speed) ?? [];
    if (representatives.length < targetStatesPerSpeed) {
      representatives.push(state);
      bySpeed.set(speed, representatives);
    }
  }
  const speedFoodStates = foodChoices
    .filter((food) => (food.stats[speedStat] ?? 0) > 0)
    .flatMap((food) => speedFoodRepresentatives(
      expanded,
      job,
      food,
      config.foodId === 0 ? automaticFoodStatesPerSpeed : targetStatesPerSpeed,
    ));
  const retained = new Map<string, SearchState>();
  for (const state of [
    ...ranked.slice(0, beamWidth),
    ...[...bySpeed.values()].flat(),
    ...speedFoodStates,
  ]) retained.set(stateKey(state), state);
  return [...retained.values()].sort((a, b) => compareStates(a, b, job, true));
}

function getFoodChoices(config: OptimizationConfig) {
  if (config.foodId) return foods.filter((food) => food.id === config.foodId);
  const combatFoods = foods.filter((food) => food.best && food.stats.VIT);
  const highestLevel = Math.max(...combatFoods.map((food) => food.level));
  return combatFoods.filter((food) => food.level === highestLevel);
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
  const next = new Map<number, number>();
  for (const [speed, tenacity] of states)
    for (const profile of profiles) {
      const combinedSpeed = speed + profile.speed;
      const combinedTenacity = tenacity + profile.tenacity;
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

/**
 * Finds every GCD reachable by the current real gear, food and normal-meld rules.
 * The state keeps only the maximum TEN for each speed because all constraints are
 * lower bounds; no damage score or optimizer beam is used here.
 */
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

export function optimize(config: OptimizationConfig): OptimizationResult | undefined {
  const started = performance.now();
  const job = getJob(config);
  let states: SearchState[] = [{ items: [], stats: calculateBaseStats(job, currentLevel), weaponDamage: 0 }];
  let searchedCandidates = 0;
  for (const slot of searchSlots(config)) {
    const pool = gearOptionsFor(config, slot);
    const forcedId = config.forcedGear[slot];
    const forced = forcedId ? pool.find((gear) => gear.id === forcedId) : undefined;
    // 锁定只禁止替换装备，普通孔魔晶石仍由优化器选择。
    const options = forced ? candidateMelds({ ...forced, slot }, job) : pool
      .sort((a, b) => candidateValue(b.stats, job) - candidateValue(a.stats, job))
      .slice(0, gearsPerSlot).flatMap((gear) => candidateMelds({ ...gear, slot }, job));
    searchedCandidates += options.length;
    if (!options.length) return undefined;
    states = expandBeam(states, options, config);
    if (!states.length) return undefined;
  }
  const foodChoices = getFoodChoices(config);
  let best: OptimizationResult | undefined;
  const maxTenacity = config.maximizeTenacity && job.role === "tank"
    ? Math.max(...states.map((state) => state.stats.TEN ?? 0)) : 0;
  for (const state of states) for (const food of foodChoices) {
    const stats = applyFood(state.stats, food.stats, food.statRates);
    const effects = calculateEffects({ stats, job, level: currentLevel, weaponDamage: state.weaponDamage });
    const requiredTen = config.maximizeTenacity && job.role === "tank" ? maxTenacity : (config.minTenacity ?? 0);
    if ((config.gcdTarget !== undefined && Math.abs(effects.gcd - config.gcdTarget) >= 0.001) || (stats.TEN ?? 0) < requiredTen) continue;
    if (!best || effects.damage > best.score) best = { gear: state.items, food, stats, effects, score: effects.damage,
      gcdTier: effects.gcd, searchedCandidates, durationMs: performance.now() - started };
  }
  return best;
}

export function gearOptionsFor(config: OptimizationConfig, slot: GearSlot): Gear[] {
  const job = getJob(config);
  const actualSlot = sourceSlot(slot);
  return gears.filter((gear) => gear.slot === actualSlot &&
    isGearUsable(gear, job, config.minItemLevel, config.maxItemLevel, config.excludedSources));
}
