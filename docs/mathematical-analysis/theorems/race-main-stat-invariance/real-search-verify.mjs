/**
 * real-search-verify.mjs —— 真实候选域反例的精确搜索复核（页面可选同步等级）。
 *
 * 允许真实搜索后新增：在相同 job/level/候选池/食物/约束下，分别用精确求解器
 * （runOptimizationLocally -> findBestLoadoutExactMip）求 Human 与 Au Ra 的全局最优，
 * 再断言“把 Human 最优装备直接换到 Au Ra 基值”不是 Au Ra 最优。
 *
 * 运行：
 *   node --experimental-strip-types docs/mathematical-analysis/theorems/race-main-stat-invariance/real-search-verify.mjs
 *
 * 这不是性能测试；只用于最优性/反例验证。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
const bytes = new Uint8Array(
  readFileSync(path.join(REPO_ROOT, "src/data/generated-data.bin")),
);
globalThis.__FFXIV_GENERATED_DATA_BINARY__ = bytes;

const { gameData } = await import(
  new URL("../../../../src/domain/data.ts", import.meta.url)
);
const { jobSchemas } = await import(
  new URL("../../../../src/domain/jobs.ts", import.meta.url)
);
const { runOptimizationLocally } = await import(
  new URL("../../../../src/domain/optimizer/single-search.ts", import.meta.url)
);
const { calculateEffects, calculateBaseStats } = await import(
  new URL("../../../../src/domain/rules.ts", import.meta.url)
);

function assert(condition, message, detail = "") {
  if (!condition) {
    throw new Error(`[失败] ${message}${detail === "" ? "" : `：${detail}`}`);
  }
}

const RACE_STATS = ["STR", "DEX", "VIT", "INT", "MND"];
const HUMAN_CLAN_INDEX = 0;
const AURA_CLAN_INDEX = 10; // 敖龙族·晨曦之民

const original = {};
for (const stat of RACE_STATS) {
  original[stat] = gameData.clanStats[stat]?.[HUMAN_CLAN_INDEX];
  assert(original[stat] !== undefined, `缺少 clanStats.${stat}`);
}

function setClan(clanIndex) {
  for (const stat of RACE_STATS) {
    const values = gameData.clanStats[stat];
    const value = values?.[clanIndex];
    if (value === undefined) throw new Error(`clanStats.${stat}[${clanIndex}] 不存在`);
    values[HUMAN_CLAN_INDEX] = value;
  }
}

function restoreClan() {
  for (const stat of RACE_STATS) {
    gameData.clanStats[stat][HUMAN_CLAN_INDEX] = original[stat];
  }
}

const config = {
  jobId: "BLM",
  minItemLevel: 360,
  maxItemLevel: 390,
  syncLevel: 375,
  gcdTarget: 2.5,
  maximizeTenacity: false,
  excludedSources: [],
  forcedGear: {},
  foodId: 0,
  objective: "damage",
};

let human;
let aura;
try {
  setClan(HUMAN_CLAN_INDEX);
  human = await runOptimizationLocally(config, {});
  setClan(AURA_CLAN_INDEX);
  aura = await runOptimizationLocally(config, {});
} finally {
  restoreClan();
}

assert(human !== undefined && aura !== undefined, "精确搜索未返回结果");
assert(human.calculationLevel === 70, "该反例的公式等级应为 70", `${human.calculationLevel}`);
assert(human.gcdTier === 2.5, "Human 结果 GCD 应为 2.50", `${human.gcdTier}`);
assert(aura.gcdTier === 2.5, "Au Ra 结果 GCD 应为 2.50", `${aura.gcdTier}`);

const schema = jobSchemas.BLM;
assert(schema !== undefined && schema.mainStat === "INT", "BLM 主属性应为 INT");
const level = human.calculationLevel;
const weaponStat = schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";

// 预先计算 Human/Au Ra 的基础属性（Au Ra 通过临时替换 clan 0 后读取）。
const baseHuman = calculateBaseStats(schema, level, HUMAN_CLAN_INDEX);
let baseAura;
try {
  setClan(AURA_CLAN_INDEX);
  baseAura = calculateBaseStats(schema, level, HUMAN_CLAN_INDEX);
} finally {
  restoreClan();
}

const signature = (result) =>
  [...result.gear]
    .map((gear) => `${gear.slot}:${gear.id}`)
    .sort()
    .join("|") + `::food=${result.food?.id ?? "none"}`;

function evaluateUnderRace(result, fromBase, toBase) {
  const stats = { ...result.stats };
  for (const stat of schema.stats) {
    if (fromBase[stat] !== undefined && toBase[stat] !== undefined) {
      stats[stat] += toBase[stat] - fromBase[stat];
    }
  }
  const effects = calculateEffects({
    stats,
    job: schema,
    level,
    weaponDamage: stats[weaponStat] ?? 0,
  });
  return effects.damage;
}

const humanScore = human.score;
const auraScore = aura.score;
const humanRecalculated = evaluateUnderRace(human, baseHuman, baseHuman);
const auraRecalculated = evaluateUnderRace(aura, baseAura, baseAura);
const humanGearUnderAura = evaluateUnderRace(human, baseHuman, baseAura);
const auraGearUnderHuman = evaluateUnderRace(aura, baseAura, baseHuman);

assert(
  Math.abs(humanScore - humanRecalculated) < 1e-9,
  "Human 最优 score 与 calculateEffects 复算不一致",
  `${humanScore} vs ${humanRecalculated}`,
);
assert(
  Math.abs(auraScore - auraRecalculated) < 1e-9,
  "Au Ra 最优 score 与 calculateEffects 复算不一致",
  `${auraScore} vs ${auraRecalculated}`,
);
assert(
  signature(human) !== signature(aura),
  "反例要求两族最优装备/食物 ID 集合不同",
  `${signature(human)} vs ${signature(aura)}`,
);
assert(
  human.food?.id === aura.food?.id,
  "反例应保持相同食物 ID（同一食物池/选择）",
  `${human.food?.id} vs ${aura.food?.id}`,
);
assert(
  humanGearUnderAura < auraScore,
  "Human 最优装备换到 Au Ra 后应严格低于 Au Ra 真实最优",
  `${humanGearUnderAura} vs ${auraScore}`,
);
assert(
  auraGearUnderHuman < humanScore,
  "Au Ra 最优装备换回 Human 后应严格低于 Human 真实最优",
  `${auraGearUnderHuman} vs ${humanScore}`,
);

console.log("[ok] 真实精确搜索反例（L70 BLM sync375；页面可选同步等级）");
console.log(`[ok] Human optimal score=${humanScore} gcd=${human.gcdTier}`);
console.log(`[ok] Au Ra optimal score=${auraScore} gcd=${aura.gcdTier}`);
console.log(`[ok] Human gear under Au Ra=${humanGearUnderAura}`);
console.log(`[ok] Au Ra gear under Human=${auraGearUnderHuman}`);
console.log(`[ok] Human gear=${signature(human)}`);
console.log(`[ok] Au Ra gear=${signature(aura)}`);
console.log("PASS");
