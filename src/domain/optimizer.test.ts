import { describe, expect, it, test } from "vitest";
import { foods, gameData, gears } from "./data";
import { findFeasibleGcds, gearOptionsFor, optimize, optimizeJoint } from "./optimizer";
import { mergeGearStats } from "./rules";
import type { OptimizationConfig } from "./types";

const maxLevel = Math.max(...gears.map((gear) => gear.level));
const base: OptimizationConfig = {
  jobId: "SAM",
  minItemLevel: maxLevel - 15,
  maxItemLevel: maxLevel,
  maximizeTenacity: false,
  excludedSources: [],
  forcedGear: {},
  sharedSlots: [],
  foodId: 0,
};

describe("optimizer with imported game data", () => {
  it("finds a complete set with two distinct rings", async () => {
    const result = (await optimize(base));
    expect(result).toBeDefined();
    expect(result?.gear).toHaveLength(11);
    expect(result?.gear.filter((gear) => gear.slot.startsWith("ring"))).toHaveLength(2);
    expect(new Set(result?.gear.map((gear) => gear.id)).size).toBe(11);
    expect(result?.score).toBeGreaterThan(0);
    expect(result?.food.level).toBe(
      Math.max(...foods.filter((food) => food.best && food.stats.VIT).map((food) => food.level)),
    );
  });

  it("honors a real forced gear id", async () => {
    // 排除自定义参数武器，避免影响镶嵌列表数量断言；
    // 自定义参数武器的 12 种组合由单独用例覆盖。
    const weapon = gearOptionsFor(base, "weapon")
      .find((gear) => gear.materiaSlots > 0 && !gear.customParameters)!;
    const result = (await optimize({ ...base, forcedGear: { weapon: weapon.id } }));
    expect(result?.gear[0].id).toBe(weapon.id);
    expect(result?.gear[0].melds).toHaveLength(weapon.materiaAdvanced ? 5 : weapon.materiaSlots);
    expect(result?.gear[0].finalStats).toEqual(
      mergeGearStats(
        weapon,
        result!.gear[0].melds.map((meld) => ({ [meld.stat]: meld.value })),
      ),
    );
  });

  it("generates 12 combinations for custom parameter weapons", async () => {
    // 上游游戏机制：4 个槽中选 1 个小值、2 个大值和 1 个空槽，每个槽至多选一次。
    // 候选数 C(4,1) × C(3,2) = 4 × 3 = 12。
    const weapons = gearOptionsFor(base, "weapon")
      .filter((gear) => gear.customParameters && gear.customParameters.length === 4);
    expect(weapons.length).toBeGreaterThan(0);
    const custom = weapons[0];
    const result = (await optimize({ ...base, forcedGear: { weapon: custom.id } }));
    expect(result).toBeDefined();
    expect(result!.gear[0].id).toBe(custom.id);
    expect(result!.gear[0].melds).toHaveLength(3);
    // 每个槽至多出现一次：大值出现 2 次，小值出现 1 次。
    const slots = custom.customParameters!;
    let bigCount = 0;
    let smallCount = 0;
    const usedSlotIndices = new Set<number>();
    for (const meld of result!.gear[0].melds) {
      const idx = slots.findIndex(
        (slot) => slot.stat === meld.stat && (slot.bigValue === meld.value || slot.smallValue === meld.value),
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(usedSlotIndices.has(idx)).toBe(false);
      usedSlotIndices.add(idx);
      if (meld.value === slots[idx].bigValue) bigCount++;
      else if (meld.value === slots[idx].smallValue) smallCount++;
    }
    expect(bigCount).toBe(2);
    expect(smallCount).toBe(1);
    expect(usedSlotIndices.size).toBe(3);
  });

  it("returns no result for an unknown forced id", async () =>
    expect(await optimize({ ...base, forcedGear: { weapon: 999_999 } })).toBeUndefined());

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects invalid numeric forced id %s", async (id) => {
    await expect(optimize({ ...base, forcedGear: { weapon: id } })).rejects.toThrow("ID 必须是正安全整数");
  });

  it("returns no result when all real weapon sources are excluded", async () => {
    const sources = gearOptionsFor(base, "weapon").flatMap((gear) => gear.source ? [gear.source] : []);
    expect((await optimize({ ...base, excludedSources: [...new Set(sources)] }))).toBeUndefined();
  });

  it("honors a selected real combat food", async () => {
    const food = foods.find((item) => item.best && item.stats.VIT)!;
    expect((await optimize({ ...base, foodId: food.id }))?.food.id).toBe(food.id);
  });

  it("rejects unavailable food and impossible constraints", async () => {
    expect((await optimize({ ...base, foodId: -1 }))).toBeUndefined();
    expect((await optimize({ ...base, gcdTarget: 9 }))).toBeUndefined();
    expect((await optimize({ ...base, jobId: "WAR", minTenacity: 999_999 }))).toBeUndefined();
  });

  it("supports GCD and maximum-tenacity tank passes", async () => {
    const tank = { ...base, jobId: "WAR" as const };
    const unconstrained = (await optimize(tank))!;
    expect((await optimize({ ...tank, gcdTarget: unconstrained.effects.gcd }))?.effects.gcd)
      .toBe(unconstrained.effects.gcd);
    expect((await optimize({ ...tank, maximizeTenacity: true }))?.stats.TEN).toBeGreaterThan(0);
  });

  it("supports the PLD shield slot and ring alias", async () => {
    const paladin = (await optimize({ ...base, jobId: "PLD" }));
    expect(paladin?.gear.some((gear) => gear.slot === "offhand")).toBe(true);
    expect(gearOptionsFor(base, "ring2")).toEqual(gearOptionsFor(base, "ring"));
  });

  it("filters candidate sources and supports healer speed melds", async () => {
    const weapons = gearOptionsFor(base, "weapon");
    const source = weapons.find((gear) => gear.source)?.source!;
    expect(gearOptionsFor({ ...base, excludedSources: [source] }, "weapon").length).toBeLessThan(weapons.length);
    expect((await optimize({ ...base, jobId: "WHM" }))?.effects.gcd).toBeGreaterThan(0);
  });

  it("finds all reachable GCD values without using damage ranking", async () => {
    const gcds = (await findFeasibleGcds(base));
    expect(gcds.length).toBeGreaterThan(1);
    expect(gcds).toEqual([...gcds].sort((a, b) => b - a));
    expect(new Set(gcds).size).toBe(gcds.length);
    expect(gcds).toContain(2.17);
    expect(gcds).toContain(2.16);
    expect((await optimize({ ...base, gcdTarget: 2.16 }))?.effects.gcd).toBe(2.16);
  });

  it("uses SPS and exposes multiple real GCD values for casters", async () => {
    const gcds = (await findFeasibleGcds({ ...base, jobId: "BLM" }));
    expect(gcds).toContain(2.5);
    expect(gcds.length).toBeGreaterThan(1);
    expect(gcds).not.toContain(2.55);
    expect((await optimize({ ...base, jobId: "BLM", gcdTarget: 2.5 }))?.effects.gcd).toBe(2.5);
  });

  // 用户参考配装（黑魔法士 7.55）：总冠军咒杖 + 改良型王国黄铜咏咒系列 + 焦糖爆米花☆，
  // 每威力伤害期望 = 131.75160。
  // 自定义参数武器上游规则改为「2 个大值、1 个小值和 1 个空槽」（2026-09 用户确认）后，
  // 优化器仍使用幻境咒杖·秘影的自定义参数路径，得分上升至 132.4391；总分仍高于参考配装。
  // 这里断言 score > 132，以锁定新规则下可达的最高 2.45 GCD 期望。
  it("keeps the known BLM 2.45 reference damage reachable under the 2+1+empty custom-weapon rule", async () => {
    const result = (await optimize({
      ...base,
      jobId: "BLM",
      foodId: 49240,
      gcdTarget: 2.45,
    }));
    expect(result?.effects.gcd).toBe(2.45);
    expect(result?.score).toBeGreaterThan(132);
  }, 30_000);

  it("keeps the known BLM 2.17 reference reachable with automatic food", async () => {
    const weapon = gearOptionsFor({ ...base, jobId: "BLM" }, "weapon")
      .find((gear) => gear.name === "总冠军咒杖")!;
    const result = (await optimize({
      ...base,
      jobId: "BLM",
      forcedGear: { weapon: weapon.id },
      gcdTarget: 2.17,
    }));
    expect(result?.effects.gcd).toBe(2.17);
    expect(result?.food.id).toBe(49243);
    expect(result?.score).toBeGreaterThan(117.4569);
  }, 30_000);

  it("honors forced gear, food and tenacity constraints during GCD discovery", async () => {
    const weapon = gearOptionsFor(base, "weapon").find((gear) => gear.materiaSlots > 0)!;
    const forcedConfig = { ...base, forcedGear: { weapon: weapon.id } };
    const gcds = (await findFeasibleGcds(forcedConfig));
    expect(gcds.length).toBeGreaterThan(0);
    const gcdResult = (await optimize({ ...forcedConfig, gcdTarget: gcds[0] }));
    if (!weapon.customParameters) {
      expect(gcdResult?.gear[0].melds).toHaveLength(weapon.materiaAdvanced ? 5 : weapon.materiaSlots);
    } else {
      // 自定义参数武器按上游规则以 2 个大值、1 个小值和 1 个空槽生成候选，魔晶石列表长度为 3。
      expect(gcdResult?.gear[0].melds).toHaveLength(3);
    }
    expect((await findFeasibleGcds({ ...base, foodId: -1 }))).toEqual([]);
    await expect(findFeasibleGcds({ ...base, minTenacity: 999_999 })).rejects.toThrow("不使用坚韧属性");
    expect((await findFeasibleGcds({ ...base, jobId: "WHM" })).length).toBeGreaterThan(0);
    expect((await findFeasibleGcds({ ...base, jobId: "WAR", maximizeTenacity: true })).length).toBeGreaterThan(0);
  });

  it("rejects an impossible pair of identical forced rings", async () => {
    const ring = gearOptionsFor(base, "ring")[0];
    expect(
      (await findFeasibleGcds({ ...base, forcedGear: { ring: ring.id, ring2: ring.id } })),
    ).toEqual([]);
  });

});


describe("formal search adapter", () => {
  const mage = { ...base, jobId: "RDM" as const, syncLevel: gameData.syncLevelOfJobLevels[80]!, foodId: 49240 };
  const mage2 = { ...mage, jobId: "BLM" as const };
  it("assembles shared equipment, shared food and independent baselines", async () => {
    const forced = (config: OptimizationConfig): OptimizationConfig => {
      const forcedGear: OptimizationConfig["forcedGear"] = {};
      for (const slot of ["weapon", "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "ring", "ring2"] as const) {
        const pool = gearOptionsFor(config, slot).filter(item => !item.customParameters);
        forcedGear[slot] = pool.find(item => slot !== "ring2" || item.id !== forcedGear.ring || !item.unique)!.id;
      }
      return { ...config, forcedGear };
    };
    const jobs = [forced(mage), forced(mage2)];
    const result = await optimizeJoint({ jobs, commonSlots: ["head", "rings"], foodStrategy: "shared", objective: "damage" });
    expect(result).toBeDefined();
    const expectedCalculationLevel = Number(
      Object.entries(gameData.syncLevels).find(([, levels]) => levels.includes(mage.syncLevel!))?.[0] ??
      Object.entries(gameData.syncLevelOfJobLevels).find(([, level]) => level === mage.syncLevel)?.[0],
    );
    expect(result!.commonFood?.id).toBe(mage.foodId);
    expect(result!.commonGear.rings).toHaveLength(2);
    for (const job of jobs) {
      const loadout = result!.jobResults[job.jobId]!;
      expect(loadout.calculationLevel).toBe(expectedCalculationLevel);
      expect(loadout.gear).toHaveLength(11);
      expect(loadout.effects.damage).toBe(result!.optima[job.jobId]!.effects.damage);
      expect(loadout.gear.every(item => item.melds.length === 0)).toBe(true);
      expect(loadout.effects.damage).toBeGreaterThan(0);
    }
    expect(result!.value.approximate).toBeCloseTo(2, 10);
  });
  it("rejects malformed constraints and supports cancellation before candidate generation", async () => {
    await expect(optimize({ ...base, minItemLevel: 800, maxItemLevel: 790 })).rejects.toThrow("范围无效");
    await expect(optimize({ ...base, syncLevel: -1 })).rejects.toThrow("正整数");
    await expect(optimizeJoint({ jobs: [mage], commonSlots: [], foodStrategy: "independent" })).rejects.toThrow("至少需要两个职业");
    const controller = new AbortController(); controller.abort();
    await expect(optimize(base, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(optimize({ ...mage, minTenacity: 500 })).rejects.toThrow("不使用坚韧");
    await expect(optimizeJoint({ jobs: [{ ...mage, objective: "dps" }, mage2], objective: "damage", commonSlots: [], foodStrategy: "shared" })).rejects.toThrow("相同");
    await expect(optimizeJoint({ jobs: [mage, mage2], commonSlots: ["head", "head"], foodStrategy: "shared" })).rejects.toThrow("重复");
    await expect(optimizeJoint({ jobs: [mage, mage2], commonSlots: ["ring", "rings"], foodStrategy: "shared" })).rejects.toThrow("混合");
  });
});


test("non-unique rings may occupy both ring slots while unique rings may not", async () => {
  const ring = gearOptionsFor(base, "ring").find(item => item.unique === false)!;
  expect(ring).toBeDefined();
  const result = await optimize({ ...base, foodId: 49240, forcedGear: { ring: ring.id, ring2: ring.id } });
  expect(result).toBeDefined();
  expect(result!.gear.filter(item => item.slot === "ring" || item.slot === "ring2").map(item => item.id)).toEqual([ring.id, ring.id]);
});

test("crafted equipment always receives all five permitted materia", async () => {
  const config = { ...base, minItemLevel: 770, foodId: 49240 };
  const crafted = gearOptionsFor(config, "body").find(item => item.materiaAdvanced)!;
  expect(crafted).toBeDefined();
  const result = await optimize({ ...config, forcedGear: { body: crafted.id } });
  expect(result).toBeDefined();
  const body = result!.gear.find(item => item.slot === "body")!;
  expect(body.melds).toHaveLength(5);
  expect(body.finalStats).toEqual(mergeGearStats(crafted, body.melds.map(meld => ({ [meld.stat]: meld.value }))));
});

test("a forced piece conflicting with candidate restrictions makes the loadout infeasible", async () => {
  const body = gearOptionsFor(base, "body")[0]!;
  expect(await optimize({ ...base, forcedGear: { body: body.id }, excludedGearIds: [body.id] })).toBeUndefined();
  expect(await optimize({ ...base, forcedGear: { body: body.id }, minItemLevel: body.level + 1, maxItemLevel: maxLevel + 1 })).toBeUndefined();
});
