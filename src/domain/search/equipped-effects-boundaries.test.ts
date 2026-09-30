import assert from "node:assert/strict";
import { test } from "vitest";
import { gameData } from "../data.ts";
import type { Stat } from "../types.ts";
import {
  blueMageWeaponDamageAddition,
  createDamageGcdVectorEvaluator,
  createEquippedEffectsVectorEvaluator,
  createIntegerDamageFactorEvaluator,
  equippedAttributeTier,
  equippedEffects,
  equippedSpeedRangeForGcd,
  equippedToughnessForMitigationPercent,
  type Job,
} from "./equipped-effects.ts";

const unknownJob = "UNKNOWN" as Job;

test("public evaluators reject unsupported jobs, levels, and malformed vector indexes", () => {
  assert.throws(
    () => equippedAttributeTier(unknownJob, 100, "CRT", 0),
    /未知职业/,
  );
  assert.throws(
    () => equippedSpeedRangeForGcd(unknownJob, 100, 2.5),
    /缺少属性配置/,
  );
  assert.throws(
    () => createEquippedEffectsVectorEvaluator("RDM", 999, new Map()),
    /不支持的等级/,
  );
  assert.throws(
    () => createEquippedEffectsVectorEvaluator(
      "RDM",
      100,
      new Map<Stat, number>([["INT", 0.5]]),
    ),
    /向量索引必须是非负整数/,
  );

  const noIndexes = createIntegerDamageFactorEvaluator("RDM", 100, new Map());
  assert.ok(noIndexes([]), "missing stat indexes contribute zero instead of reading a negative slot");
});

test("empty gear and food contributions retain level-based stats and HP scaling", () => {
  const direct = equippedEffects("RDM", 100, {});
  const vector = createEquippedEffectsVectorEvaluator("RDM", 100, new Map())([]);
  assert.deepEqual(vector, direct);
  assert.deepEqual(equippedEffects("RDM", 100, { INT: undefined }), direct);
  assert.ok(direct && direct.hp > 0);

  const tank = equippedEffects("PLD", 100, {})!;
  const tankWithOneVit = equippedEffects("PLD", 100, { VIT: 1 })!;
  const caster = equippedEffects("RDM", 100, {})!;
  const casterWithOneVit = equippedEffects("RDM", 100, { VIT: 1 })!;
  assert.ok(tank.hp > 0 && caster.hp > 0);
  assert.ok(
    tankWithOneVit.hp - tank.hp > casterWithOneVit.hp - caster.hp,
    "tank HP uses the tank Vitality coefficient while a caster uses the standard coefficient",
  );
});

test("missing formula metadata fails closed across damage, GCD, and tier evaluators", () => {
  const mutableSchema = gameData.jobSchemas.RDM as unknown as {
    traitDamageMultiplier?: number;
  };
  const originalTrait = mutableSchema.traitDamageMultiplier;
  try {
    delete mutableSchema.traitDamageMultiplier;
    assert.equal(createIntegerDamageFactorEvaluator("RDM", 100, new Map())([]), undefined);
    assert.equal(equippedEffects("RDM", 100, {}), undefined);
    assert.equal(createDamageGcdVectorEvaluator("RDM", 100, new Map())([]), undefined);
    assert.throws(
      () => equippedSpeedRangeForGcd("RDM", 100, 2.5),
      /不支持 GCD 计算/,
    );
  } finally {
    mutableSchema.traitDamageMultiplier = originalTrait;
  }
});

test("missing main-stat and HP modifiers trigger their documented guards", () => {
  const mutableMainStat = gameData.jobSchemas.RDM as unknown as {
    mainStat?: string;
  };
  const originalMainStat = mutableMainStat.mainStat;
  try {
    delete mutableMainStat.mainStat;
    assert.throws(
      () => equippedAttributeTier("RDM", 100, "CRT", 0),
      /不支持战斗属性阈值计算/,
    );
  } finally {
    mutableMainStat.mainStat = originalMainStat;
  }

  const mutableHp = gameData.jobSchemas.PLD.statModifiers as unknown as {
    hp?: number;
  };
  const originalHp = mutableHp.hp;
  try {
    delete mutableHp.hp;
    assert.throws(
      () => equippedEffects("PLD", 100, {}),
      /缺少生命值修正/,
    );
  } finally {
    mutableHp.hp = originalHp;
  }
});

test("mitigation percentages honor their epsilon-aware per-mille boundary", () => {
  const exact = equippedToughnessForMitigationPercent("PLD", 100, 5);
  const withinTolerance = equippedToughnessForMitigationPercent("PLD", 100, 5.000000009);
  const nextPerMille = equippedToughnessForMitigationPercent("PLD", 100, 5.00000002);
  assert.equal(withinTolerance, exact);
  assert.ok(nextPerMille > exact);
  assert.ok(equippedEffects("PLD", 100, { TEN: nextPerMille })!.tenMitigation >= 0.051);
});

test("a missing Blue Mage weapon-damage table entry throws instead of falling back", () => {
  const table = gameData.bluMdmgAdditions;
  const original = table[0]!;
  try {
    table[0] = undefined as unknown as number;
    assert.throws(
      () => blueMageWeaponDamageAddition(0),
      /超出已验证武器伤害数据范围/,
    );
  } finally {
    table[0] = original;
  }
});

test("a tank with missing formula metadata fails closed in the toughness search", () => {
  const mutableSchema = gameData.jobSchemas.PLD as unknown as {
    traitDamageMultiplier?: number;
  };
  const originalTrait = mutableSchema.traitDamageMultiplier;
  try {
    delete mutableSchema.traitDamageMultiplier;
    assert.throws(
      () => equippedToughnessForMitigationPercent("PLD", 100, 1),
      /不支持坚韧计算/,
    );
  } finally {
    mutableSchema.traitDamageMultiplier = originalTrait;
  }
});
