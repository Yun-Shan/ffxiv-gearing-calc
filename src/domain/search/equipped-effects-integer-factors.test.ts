import assert from "node:assert/strict";
import { test } from "vitest";
import { gameData } from "../data.ts";
import { jobSchemas } from "../jobs";
import { addStats, calculateBaseStats, calculateEffects, getSpeedStat } from "../rules";
import type { Job, JobLevel } from "./equipped-effects.ts";
import type { Stat, Stats } from "../types.ts";
import {
  createDamageGcdVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  equippedEffects,
  equippedAttributeTier,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
} from "./equipped-effects.ts";

const names: Stat[] = ["PDMG", "MDMG", "STR", "INT", "VIT", "CRT", "DET", "DHT", "TEN", "SKS", "SPS", "MND", "DEX", "PIE"];
const indexes = new Map(names.map((name, index) => [name, index] as const));
const max = names.map(() => 20_000);

function vector(values: Partial<Record<Stat, number>>): number[] {
  return names.map((name) => values[name] ?? 0);
}

function reconstruct(factors: ReturnType<ReturnType<typeof createIntegerDamageFactorEvaluator>>): number {
  assert.ok(factors);
  return 0.01 * factors.weaponDamage * (factors.mainStat / 100) *
    (factors.determination / 1000) * (factors.tenacity / 1000) *
    factors.traitMultiplier * (factors.critical / 1_000_000) *
    (factors.directHit / 4000);
}

for (const job of ["RDM", "BLU"] as Job[]) {
  test(`${job} integer factors reconstruct exact evaluator damage incl. food contributions`, () => {
    const contributions = vector({
      PDMG: 0,
      MDMG: 165,
      STR: 320,
      INT: 430,
      VIT: 510,
      CRT: 740,
      DET: 410,
      DHT: 255,
      TEN: 190,
      SPS: 210,
    });
    // 模拟调用方已应用食物属性的情况（这是求值器的约定）。
    contributions[indexes.get("CRT")!] += 125;
    contributions[indexes.get("INT")!] += 80;
    const factors = createIntegerDamageFactorEvaluator(job, 100, indexes)(contributions);
    const exact = equippedEffects(job, 100, Object.fromEntries(
      names.map((name, index) => [name, contributions[index]]),
    ));
    const optimized = createDamageGcdVectorEvaluator(job, 100, indexes, max)(contributions);
    assert.ok(factors && exact && optimized);
    assert.ok(Math.abs(reconstruct(factors) - exact.damage) < 1e-12);
    assert.equal(factors.gcdCentiseconds, Math.round(exact.gcd * 100));
    assert.ok(Math.abs(reconstruct(factors) - optimized.damage) < 1e-12);
  });
}

test("unknown jobs are rejected instead of using embedded constants", () => {
  const unsupportedJob = "UNKNOWN" as unknown as Job;
  assert.throws(() => createIntegerDamageFactorEvaluator(unsupportedJob, 100 as JobLevel, indexes), /未知职业/);
  assert.throws(() => createDamageGcdVectorEvaluator(unsupportedJob, 100 as JobLevel, indexes, max)([]), /未知职业/);
});

test("integer factors preserve damage ranking over known RDM vectors", () => {
  const evaluateFactors = createIntegerDamageFactorEvaluator("RDM", 100, indexes);
  const evaluateExact = (attributes: number[]) => equippedEffects(
    "RDM", 100, Object.fromEntries(names.map((name, index) => [name, attributes[index]])),
  )!.damage;
  const vectors = [
    vector({ MDMG: 160, INT: 700, CRT: 900, DET: 600, DHT: 300, SPS: 250 }),
    vector({ MDMG: 162, INT: 690, CRT: 920, DET: 610, DHT: 280, SPS: 270 }),
    vector({ MDMG: 155, INT: 720, CRT: 850, DET: 640, DHT: 340, SPS: 220 }),
  ];
  const order = (a: number, b: number) => Math.sign(a - b);
  for (let left = 0; left < vectors.length; left++) {
    for (let right = left + 1; right < vectors.length; right++) {
      const a = evaluateFactors(vectors[left]!);
      const b = evaluateFactors(vectors[right]!);
      assert.ok(a && b);
      assert.equal(order(reconstruct(a), reconstruct(b)), order(evaluateExact(vectors[left]!), evaluateExact(vectors[right]!)));
    }
  }
});


test("search factors and displayed formulas agree for every supported job", () => {
  for (const schema of Object.values(jobSchemas)) {
    for (const level of [50, 60, 70, 80, 90, 100].filter(level => level <= (schema.maxJobLevel ?? 100))) {
      const contribution = Object.fromEntries(names.filter(stat => stat !== "TEN" || schema.role === "tank").map(stat => [stat, stat === "PDMG" || stat === "MDMG" ? 158 : schema.id === "BLU" && stat === "INT" ? 1000 : 1700]));
      const effects = equippedEffects(schema.id, level, contribution)!;
      const display = calculateEffects({ clanIndex: 0, job: schema, level, stats: addStats(calculateBaseStats(schema, level), contribution), weaponDamage: 158 });
      const { ssDamage, ...commonEffects } = effects;
      assert.deepEqual(display, commonEffects);
      const factors = createIntegerDamageFactorEvaluator(schema.id, level, indexes)(vector(contribution))!;
      assert.ok(Math.abs(reconstruct(factors) - effects.damage) < 1e-10);
      assert.equal(factors.gcdCentiseconds, Math.round(effects.gcd * 100));
    }
    for (const stat of [schema.mainStat, "CRT", "DET", "DHT", "TEN", getSpeedStat(schema)] as Stat[]) {
      assert.ok(Number.isSafeInteger(equippedAttributeTier(schema.id, 100, stat, 1700)));
    }
    const range = equippedSpeedRangeForGcd(schema.id, 100, equippedEffects(schema.id, 100, {})!.gcd)!;
    assert.equal(range.min, 0);
    assert.equal(equippedSpeedRangeForGcd(schema.id, 100, 9), undefined);
    if (schema.role === "tank") {
      const threshold = equippedToughnessForMitigationPercent(schema.id, 100, 5);
      assert.ok(equippedEffects(schema.id, 100, { TEN: threshold })!.tenMitigation >= 0.05);
      assert.ok(equippedEffects(schema.id, 100, { TEN: threshold - 1 })!.tenMitigation < 0.05);
      assert.equal(equippedToughnessForMitigationPercent(schema.id, 100, 0), 0);
    }
  }
});

test("tank STR main preserves legacy AP, HP, and integer damage factors", () => {
  const job = jobSchemas.PLD;
  const level = 100;
  const levelMod = gameData.jobLevelModifiers[level]!;
  const baseStats = calculateBaseStats(job, level);
  const stats: Stats = {
    ...baseStats,
    PDMG: 160,
    STR: 5_000,
    VIT: 8_000,
    CRT: 3_200,
    DET: 2_600,
    DHT: 2_100,
    TEN: 1_600,
    SKS: 1_200,
  };
  const contributions: Stats = Object.fromEntries(Object.entries(stats).map(([rawStat, value]) => {
    const stat = rawStat as Stat;
    return [stat, value - (baseStats[stat] ?? 0)];
  }));
  const contributionVector = vector(contributions);
  const factors = createIntegerDamageFactorEvaluator(job.id, level, indexes)(contributionVector)!;
  const equipped = equippedEffects(job.id, level, contributions)!;
  const displayed = calculateEffects({ clanIndex: 0, stats, job, level, weaponDamage: stats.PDMG! });
  const floor = (value: number) => Math.trunc(value + 1e-7);
  const expectedMainFactor = floor(
    (levelMod.apTank * (floor(stats.STR! * (job.partyBonus ?? 1.05)) - levelMod.main)) /
      levelMod.main +
      100,
  );
  const expectedHp = levelMod.hp * job.statModifiers.hp! +
    floor(levelMod.vitTank * (stats.VIT! - levelMod.main));

  assert.equal(job.mainStat, "STR");
  assert.equal("attackStat" in job, false);
  assert.equal(factors.mainStat, expectedMainFactor);
  assert.equal(equippedAttributeTier(
    job.id,
    level,
    "STR",
    contributions.STR!,
  ), expectedMainFactor);
  assert.equal(displayed.hp, expectedHp);
  assert.equal(equipped.hp, expectedHp);
  const { ssDamage: _ssDamage, ...equippedDisplay } = equipped;
  assert.deepEqual(displayed, equippedDisplay);
  assert.ok(Math.abs(reconstruct(factors) - equipped.damage) < 1e-12);
});

test("formula thresholds reject unsupported attributes, levels and invalid percentages", () => {
  assert.throws(() => equippedAttributeTier("RDM", 100, "VIT", 0), /不参与/);
  assert.throws(() => equippedAttributeTier("RDM", 1, "CRT", 0), /等级/);
  for (const value of [NaN, 0, -1, Infinity, 2.451]) assert.throws(() => equippedSpeedRangeForGcd("RDM", 100, value), RangeError);
  for (const value of [NaN, -1, Infinity]) assert.throws(() => equippedToughnessForMitigationPercent("WAR", 100, value), RangeError);
  assert.throws(() => equippedToughnessForMitigationPercent("RDM", 100, 5), /不使用/);
});
