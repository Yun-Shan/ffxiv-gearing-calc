import assert from "node:assert/strict";
import { test } from "node:test";
import { excludeReferenceGearSource, includeGearInCatalog, referenceGearSource } from "../gear-catalog-policy.mjs";

test("source exclusions match original reference substrings even for obsolete gear", () => {
  for (const source of ["古董系列", "兑换/古董系列/防具", "军票", "军票/黑涡团", "旧军票装备"]) {
    assert.equal(excludeReferenceGearSource({ source }), true);
    assert.equal(excludeReferenceGearSource({ source, obsolete: true }), true);
  }
  for (const source of [undefined, "", "已废弃", "零式/重量级", "军用装备"]) {
    assert.equal(excludeReferenceGearSource({ source }), false);
  }
});

test("catalog excludes all five source prefixes before source normalization", () => {
  for (const prefix of ["狼印战绩", "成就", "金碟币", "制作特定道具兑换", "采集特定道具兑换"]) {
    for (const source of [prefix, `${prefix}/装备`, `${prefix}/装备/其他`, `${prefix}→诗学`]) {
      assert.equal(excludeReferenceGearSource({ source }), true);
      assert.equal(excludeReferenceGearSource({ source, obsolete: true }), true);
    }
    assert.equal(excludeReferenceGearSource({ source: `其他/${prefix}` }), false);
  }
  for (const source of ["生产制作", "制作装强化", "怪物狩猎战利品", "职业任务", undefined]) {
    assert.equal(excludeReferenceGearSource({ source }), false);
  }
});

test("obsolete overrides any reference source, including a missing source", () => {
  assert.equal(referenceGearSource({ obsolete: true, source: "旧来源" }), "已废弃");
  assert.equal(referenceGearSource({ obsolete: true }), "已废弃");
  assert.equal(referenceGearSource({ obsolete: false, source: "现有来源" }), "现有来源");
  assert.equal(referenceGearSource({ source: "现有来源" }), "现有来源");
  assert.equal(referenceGearSource({}), undefined);
});

test("reference source suffixes normalize currencies without rewriting unrelated labels", () => {
  for (const [source, expected] of [
    ["旧点数→诗学", "点数/诗学"], ["兑换/诗学", "点数/诗学"], ["点数/诗学", "点数/诗学"],
    ["旧点数→战利品", "怪物狩猎战利品"], ["旧点数→兵团", "兵团徽章"], ["旧点数→同盟", "同盟徽章"],
    ["遗产装备→雇员探险", "雇员探险"],
    ["点数/哲学→无限城古迹、日影地修炼所、野营地", "迷宫挑战/无限城古迹、日影地修炼所、野营地"],
    ["遗产装备→雇员探险/其他", "遗产装备→雇员探险/其他"],
    ["旧点数→诗学/其他", "旧点数→诗学/其他"], ["旧点数→其他", "旧点数→其他"],
    ["零式/重量级", "零式/重量级"], [undefined, undefined],
  ]) {
    assert.equal(referenceGearSource({ source }), expected);
    assert.equal(referenceGearSource({ source, obsolete: true }), "已废弃");
  }
});

test("all crafting subcategories collapse before suffix mappings while obsolete still wins", () => {
  for (const source of ["生产制作/", "生产制作/海德林武器", "生产制作/古武素材/其他", "生产制作/诗学", "生产制作/其他→雇员探险"]) {
    assert.equal(referenceGearSource({ source }), "生产制作");
    assert.equal(referenceGearSource({ source, obsolete: true }), "已废弃");
  }
  for (const source of ["生产制作", "其他/生产制作/武器", "生产制作武器"]) {
    assert.equal(referenceGearSource({ source }), source);
  }
});

test("catalog removes gear only when both strict lower thresholds hold", () => {
  for (const [equipLevel, level, expected] of [
    [49, 89, false], [1, 1, false], [50, 89, true],
    [49, 90, true], [50, 90, true], [100, 795, true],
  ]) {
    assert.equal(includeGearInCatalog({ equipLevel, level }), expected, `${equipLevel}/${level}`);
  }
});
