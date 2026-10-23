import { createHash } from "node:crypto";
import { MAX_RSS_BYTES, UNLIMITED_SEARCH_MS } from "./limits.mjs";

const slotLabels = {
  weapon: "主手",
  offhand: "副手",
  head: "头部",
  body: "身体",
  hands: "手部",
  legs: "腿部",
  feet: "脚部",
  earrings: "耳饰",
  necklace: "项链",
  bracelet: "手镯",
  ring: "戒指1",
  ring2: "戒指2",
  rings: "戒指对",
};

export function summarizeGear(gear) {
  return {
    slot: slotLabels[gear.slot] ?? gear.slot,
    itemId: gear.id,
    name: gear.name,
    itemLevel: gear.level,
    attributes: gear.finalStats,
    materia: gear.melds.map(({ stat, value, grade }) => ({ stat, value, grade })),
  };
}

export function summarizeFood(food) {
  if (!food) return null;
  return {
    itemId: food.id,
    name: food.name,
    itemLevel: food.level,
    attributes: food.stats,
  };
}

export function summarizeOptimization(job, result) {
  if (!result) return null;
  return {
    job,
    damagePerPotency: result.effects.damage,
    gcd: result.gcdTier,
    damagePerSecond: result.damagePerSecond,
    objectiveScore: result.score,
    totalAttributes: result.stats,
    maximumTenacity: result.maximumTenacity,
    durationMs: result.durationMs,
    searchedCandidates: result.searchedCandidates,
    food: summarizeFood(result.food),
    equipment: result.gear.map(summarizeGear),
  };
}

export function summarizeJointResult(result, jobs) {
  return {
    objective: result.objective,
    normalizedJointValue: result.value,
    commonFood: summarizeFood(result.commonFood),
    commonEquipment: Object.fromEntries(
      Object.entries(result.commonGear).map(([slot, gears]) => [
        slotLabels[slot] ?? slot,
        gears?.map(summarizeGear) ?? [],
      ]),
    ),
    jobs: Object.fromEntries(jobs.map((job) => [
      job,
      {
        joint: summarizeOptimization(job, result.jobResults[job]),
        soloOptimum: summarizeOptimization(job, result.optima[job]),
      },
    ])),
    proof: result.proof,
    statistics: result.statistics,
  };
}

export function buildV3Output(result, jobs, {
  maxSearchMs,
  elapsedMs,
  peakRssBytes,
  rssLimitBytes = MAX_RSS_BYTES,
}) {
  const output = summarizeJointResult(result, jobs);
  if (maxSearchMs === UNLIMITED_SEARCH_MS) output.statistics.timeLimitMs = "unlimited";
  output.runtime = {
    elapsedMs: Math.round(elapsedMs),
    peakRssBytes,
    rssLimitBytes,
    timeoutMs: maxSearchMs === UNLIMITED_SEARCH_MS ? "unlimited" : maxSearchMs,
  };
  return output;
}

export function digestV3Output(output) {
  return createHash("sha256").update(JSON.stringify(output)).digest("hex");
}
