import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createDamageGcdVectorEvaluator,
  createEquippedEffectsVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  blueMageWeaponDamageAddition,
  equippedAttributeTier,
  equippedEffects,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
  type Job,
} from "./equipped-effects.ts";
import type { Stat } from "../types";

const indexes = new Map<Stat, number>([
  ["PDMG", 0],
  ["MDMG", 1],
  ["STR", 2],
  ["DEX", 3],
  ["INT", 4],
  ["MND", 5],
  ["VIT", 6],
  ["CRT", 7],
  ["DET", 8],
  ["DHT", 9],
  ["TEN", 10],
  ["SKS", 11],
  ["SPS", 12],
  ["PIE", 13],
]);

test("equipped formulas reject unknown jobs, unsupported levels, and non-combat tiers", () => {
  const unknownJob = "UNKNOWN" as Job;
  assert.throws(
    () => createIntegerDamageFactorEvaluator(unknownJob, 100, indexes),
    /未知职业/,
  );
  assert.throws(
    () => equippedEffects("RDM", 999, {}),
    /不支持的等级/,
  );
  assert.throws(
    () => equippedAttributeTier("RDM", 100, "PIE", 0),
    /不参与伤害阈值/,
  );
  assert.throws(
    () => createEquippedEffectsVectorEvaluator(
      "RDM",
      100,
      new Map([["INT", -1]] as const),
    ),
    /向量索引必须是非负整数/,
  );
});

test("tier formulas cover main stat, tank VIT, all damage substats, and both speed roles", () => {
  for (const [job, mainStat] of [
    ["RDM", "INT"],
    ["WHM", "MND"],
    ["PLD", "STR"],
  ] as const) {
    assert.ok(equippedAttributeTier(job, 100, mainStat, 0) >= 100);
  }
  for (const [job, speedStat] of [
    ["SAM", "SKS"],
    ["RDM", "SPS"],
  ] as const) {
    assert.ok(equippedAttributeTier(job, 100, speedStat, 0) >= 1000);
  }
  const defaultClan = equippedEffects("SAM", 100, {})!;
  const lowStrengthClan = equippedEffects("SAM", 100, {}, 4)!;
  assert.ok(lowStrengthClan.damage < defaultClan.damage);
  assert.deepEqual(equippedEffects("SAM", 100, {}, 0), defaultClan);
  assert.throws(() => equippedEffects("SAM", 100, {}, 99), /族群序号无效/);
  for (const stat of ["CRT", "DET", "DHT", "TEN"] as const) {
    assert.ok(equippedAttributeTier("RDM", 100, stat, 0) >= 0);
  }
});

test("speed and mitigation searches validate bounds and return the first feasible attribute", () => {
  assert.throws(() => equippedSpeedRangeForGcd("RDM", 100, 0), /GCD 必须/);
  assert.throws(() => equippedSpeedRangeForGcd("RDM", 100, 2.501), /两位小数/);
  assert.equal(equippedSpeedRangeForGcd("RDM", 100, 3), undefined);
  const range = equippedSpeedRangeForGcd("RDM", 100, 2.5);
  assert.ok(range);
  assert.ok(range.min >= 0 && range.max >= range.min);

  assert.throws(
    () => equippedToughnessForMitigationPercent("PLD", 100, -1),
    /非负有限数字/,
  );
  assert.throws(
    () => equippedToughnessForMitigationPercent("RDM", 100, 1),
    /不使用坚韧属性/,
  );
  assert.throws(
    () => equippedToughnessForMitigationPercent("PLD", 100, 1e308),
    /超出安全整数范围/,
  );
  assert.equal(equippedToughnessForMitigationPercent("PLD", 100, 0), 0);
  assert.ok(equippedToughnessForMitigationPercent("PLD", 100, 5) > 0);
});

test("Blue Mage weapon additions reject invalid and unmeasured contribution indexes", () => {
  assert.equal(blueMageWeaponDamageAddition(0) >= 0, true);
  for (const value of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => blueMageWeaponDamageAddition(value), /非负安全整数/);
  }
  assert.throws(
    () => blueMageWeaponDamageAddition(Number.MAX_SAFE_INTEGER),
    /超出已验证武器伤害数据范围/,
  );
});

test("vector evaluators validate job and level before evaluating factor vectors", () => {
  const noFormulaJob = "UNKNOWN" as Job;
  const unsupported = createDamageGcdVectorEvaluator(noFormulaJob, 100, indexes);
  assert.throws(() => unsupported([]), /未知职业/);
  assert.throws(
    () => createIntegerDamageFactorEvaluator("RDM", 999, indexes),
    /不支持的等级/,
  );
  const evaluator = createIntegerDamageFactorEvaluator("RDM", 100, indexes);
  assert.equal(evaluator([])?.weaponDamage !== undefined, true);
});
