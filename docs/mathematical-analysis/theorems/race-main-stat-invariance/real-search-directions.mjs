/**
 * real-search-directions.mjs —— 两个追加方向的真实精确搜索复核。
 *
 * 1) 更高页面可选同步等级：BLM sync665（650–795），max−sync=130。
 * 2) 大同步差值：BLM sync475（460–795），max−sync=320 > 150。
 *
 * 两个配置均固定 gcdTarget=2.5；分别用生产精确求解器求 Human/Au Ra 全局最优，
 * 断言“Human 最优装备换到 Au Ra 基值”严格低于 Au Ra 真实最优，且装备 ID 不同。
 *
 * 运行：
 *   node --experimental-strip-types docs/mathematical-analysis/theorems/race-main-stat-invariance/real-search-directions.mjs
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

const RACE_STATS = ["STR", "DEX", "VIT", "INT", "MND"];
const original = {};
for (const stat of RACE_STATS) {
  original[stat] = gameData.clanStats[stat]?.[0];
}

function assert(condition, message, detail = "") {
  if (!condition) throw new Error(`[失败] ${message}${detail === "" ? "" : `：${detail}`}`);
}

function setClan(clanIndex) {
  for (const stat of RACE_STATS) {
    gameData.clanStats[stat][0] = gameData.clanStats[stat][clanIndex];
  }
}

function restoreClan() {
  for (const stat of RACE_STATS) {
    gameData.clanStats[stat][0] = original[stat];
  }
}

async function run(config, clanIndex) {
  try {
    setClan(clanIndex);
    return await runOptimizationLocally(config, {});
  } finally {
    restoreClan();
  }
}

function bases(job, level) {
  const schema = jobSchemas[job];
  const human = calculateBaseStats(schema, level, 0);
  let aura;
  try {
    setClan(10);
    aura = calculateBaseStats(schema, level, 0);
  } finally {
    restoreClan();
  }
  return { schema, human, aura };
}

function evaluateUnderRace(result, schema, level, fromBase, toBase) {
  const stats = { ...result.stats };
  for (const stat of schema.stats) {
    if (fromBase[stat] !== undefined && toBase[stat] !== undefined) {
      stats[stat] += toBase[stat] - fromBase[stat];
    }
  }
  const weaponStat =
    schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  return calculateEffects({
    stats,
    job: schema,
    level,
    weaponDamage: stats[weaponStat] ?? 0,
  }).damage;
}

const signature = (result) =>
  [...result.gear]
    .map((gear) => `${gear.slot}:${gear.id}`)
    .sort()
    .join("|") + `::food=${result.food?.id ?? "none"}`;

const CASES = [
  {
    id: "high-sync-665",
    config: {
      jobId: "BLM",
      minItemLevel: 650,
      maxItemLevel: 795,
      syncLevel: 665,
      gcdTarget: 2.5,
      maximizeTenacity: false,
      excludedSources: [],
      forcedGear: {},
      foodId: 0,
      objective: "damage",
    },
  },
  {
    id: "large-gap-475",
    config: {
      jobId: "BLM",
      minItemLevel: 460,
      maxItemLevel: 795,
      syncLevel: 475,
      gcdTarget: 2.5,
      maximizeTenacity: false,
      excludedSources: [],
      forcedGear: {},
      foodId: 0,
      objective: "damage",
    },
  },
];

for (const { id, config } of CASES) {
  const human = await run(config, 0);
  const aura = await run(config, 10);
  assert(human !== undefined && aura !== undefined, `${id}: 精确搜索无结果`);
  assert(human.gcdTier === 2.5 && aura.gcdTier === 2.5, `${id}: GCD 应为 2.50`);
  assert(
    795 - config.syncLevel >= (id === "large-gap-475" ? 150 : 0),
    `${id}: max−sync 不满足方向要求`,
  );
  const { schema, human: baseHuman, aura: baseAura } = bases(
    config.jobId,
    human.calculationLevel,
  );
  const humanGearUnderAura = evaluateUnderRace(
    human,
    schema,
    human.calculationLevel,
    baseHuman,
    baseAura,
  );
  const auraGearUnderHuman = evaluateUnderRace(
    aura,
    schema,
    aura.calculationLevel,
    baseAura,
    baseHuman,
  );
  assert(
    signature(human) !== signature(aura),
    `${id}: 两族最优装备/食物 ID 应不同`,
  );
  assert(
    humanGearUnderAura < aura.score,
    `${id}: Human 装备换到 Au Ra 后应严格低于 Au Ra 最优`,
    `${humanGearUnderAura} vs ${aura.score}`,
  );
  assert(
    auraGearUnderHuman < human.score,
    `${id}: Au Ra 装备换到 Human 后应严格低于 Human 最优`,
    `${auraGearUnderHuman} vs ${human.score}`,
  );
  console.log(`[ok] ${id} level=${human.calculationLevel} gcd=${human.gcdTier}`);
  console.log(`[ok]   Human=${human.score}, Au Ra=${aura.score}`);
  console.log(`[ok]   Human gear under Au Ra=${humanGearUnderAura}`);
  console.log(`[ok]   Au Ra gear under Human=${auraGearUnderHuman}`);
  console.log(`[ok]   ${signature(human)}`);
  console.log(`[ok]   ${signature(aura)}`);
}

console.log("PASS");
