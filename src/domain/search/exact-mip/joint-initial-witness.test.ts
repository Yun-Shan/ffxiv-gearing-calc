import { expect, test } from "vitest";
import type { EquipInfo, FoodInfo } from "../types.ts";
import type { IntegerDamageFactors } from "../equipped-effects.ts";
import type { JointPreparedJob } from "./joint-types.ts";
import type { ExactMipResult } from "./types.ts";
import { getAttributeVector } from "./attributes.ts";
import { buildLinearAttributeModel } from "./attribute-model.ts";
import { prepareJointIdentity } from "./joint-identity.ts";
import { validateJointInitialResults } from "./joint-results.ts";
import { expandJointRingPairDomain, trySplitRingPairDomain, type RingPairCandidate } from "./ring-domain.ts";

const baseline: IntegerDamageFactors = { weaponDamage: 1, mainStat: 1_000, determination: 1,
  tenacity: 1, critical: 1, directHit: 1, gcdCentiseconds: 200, traitMultiplier: 1 };
const equipment = (main: number, det = 10): EquipInfo => ({ itemId: 100, itemLevel: 100, key: "same-equipment",
  baseParams: [{ baseParamId: 1, value: main }, { baseParamId: 2, value: det }], PDMG: 0, MDMG: 0, DLY: 0 });
const food = (attribute: number): FoodInfo => ({ itemId: 700, itemLevel: 100, key: "same-food",
  baseParams: [{ baseParamId: attribute, multiplier: 1.2, maxValue: 10 }] });
const statistics: ExactMipResult["statistics"] = { elapsedMs: 0, solverRuns: 0, excludedSignatures: 0,
  signatureBandChecks: 0, signatureBandElapsedMs: 0, signatureBandProof: false, variables: 0,
  constraints: 0, maximumSurrogate: 0, nextSurrogate: undefined, memoryUsage: {} };

function fixture() {
  const options: Parameters<typeof validateJointInitialResults>[0] = { objective: "damage",
    commonSlots: ["head"], sharedFood: true, equipmentIdentity: item => `${item.itemId}:${item.key}`,
    foodIdentity: item => `${item.itemId}:${item.key}` };
  const jobs: JointPreparedJob[] = [0, 1].map(index => {
    const job: JointPreparedJob["job"] = { id: `job_${index}`, slotNames: ["head"], baseline,
      options: { job: index === 0 ? "WAR" : "DRK", jobLevel: 100, clanIndex: 0, objective: "damage",
        attributeIds: [1, 2], statIndexes: new Map([["STR", 0], ["DET", 1]]),
        slots: [[equipment(index === 0 ? 100 : 50)]], foods: [food(index === 0 ? 1 : 2)],
        evaluationFunction: attributes => ({ damage: attributes[0] * 10 + attributes[1], gcd: 2 }) } };
    let current: JointPreparedJob;
    const prepared = { model: { ranges: new Map(), resistanceAllocationVariables: [], gcdChoiceRanges: [],
      get foodBonuses() { return buildLinearAttributeModel({ ...current.job.options, constraints: undefined })!.foodBonuses; },
      get rawMaximums() { return buildLinearAttributeModel({ ...current.job.options, constraints: undefined })!.rawMaximums; },
      get idToIndex() { return new Map(current.job.options.attributeIds.map((id, index) => [id, index])); },
      get fixedEquipmentAttributes() {
        const options = current.job.options;
        return options.slots.map(slot => slot.map(item => options.attributeIds.map(id =>
          (options.equipmentAttributeExtractor?.(item) ?? item.baseParams)
            .filter(param => param.baseParamId === id).reduce((sum, param) => sum + param.value, 0))));
      },
    },
      factorEvaluator: (attributes: readonly number[]) => ({ ...baseline, mainStat: attributes[0] + attributes[1] }),
    } as unknown as JointPreparedJob["prepared"];
    current = { job, originalJob: job, prepared };
    return current;
  });
  const seeds: ExactMipResult[] = jobs.map(({ job }) => ({ selection: structuredClone(job.options.slots.map(slot => slot[0])),
    food: structuredClone(job.options.foods[0]), damage: 999_999, statistics: { ...statistics } }));
  const validate = () => {
    const identity = prepareJointIdentity({ ...options, jobs: jobs.map(({ originalJob }) => originalJob) });
    return validateJointInitialResults(options, jobs, seeds, identity.originalSelectionIdentity)!;
  };
  return { jobs, seeds, options, validate };
}

test("same physical equipment identities cannot import another job's higher attributes below its baseline", () => {
  const f = fixture();
  f.seeds[1].selection = structuredClone(f.seeds[0].selection);
  expect(() => f.validate()).toThrow(/装备不属于模型候选或属性向量不匹配/);
});

test("same physical food identity cannot import another job's bonus coordinate", () => {
  const f = fixture();
  f.seeds[1].food = structuredClone(f.seeds[0].food);
  expect(() => f.validate()).toThrow(/食物不属于模型候选/);
});

test("canonical current candidates and food reconstruct both the exact score and public damage", () => {
  const f = fixture();
  const original = structuredClone(f.seeds);
  const best = f.validate();
  expect(best.numerator * 1_000n).toBe(182n * best.denominator);
  expect(best.results.map(result => result.damage)).toEqual([1_110, 512]);
  for (let j = 0; j < f.jobs.length; j++) {
    expect(best.results[j].selection[0]).toBe(f.jobs[j].job.options.slots[0][0]);
    expect(best.results[j].food).toBe(f.jobs[j].job.options.foods[0]);
    const attributes = getAttributeVector(best.results[j].selection, best.results[j].food,
      f.jobs[j].job.options.attributeIds, undefined, f.jobs[j].job.options.statIndexes);
    expect(best.results[j].damage).toBe(f.jobs[j].job.options.evaluationFunction(attributes)!.damage);
  }
  expect(f.seeds).toEqual(original);
  f.seeds[0].selection[0].baseParams[0].value = 900;
  f.seeds[0].food!.baseParams[0].multiplier = 99;
  f.seeds[0].selection = [equipment(950)];
  f.seeds[0].food = food(2);
  f.seeds[0].damage = Infinity;
  expect(best.results[0].selection[0].baseParams[0].value).toBe(100);
  expect(best.results[0].food!.baseParams[0].multiplier).toBe(1.2);
  expect(best.results[0].damage).toBe(1_110);
});

test("matching examines every candidate and food sharing an identity, rather than trusting the first one", () => {
  const f = fixture(), currentEquipment = f.jobs[0].job.options.slots[0][0], currentFood = f.jobs[0].job.options.foods[0];
  f.jobs[0].job.options.slots = [[equipment(70), currentEquipment]];
  f.jobs[0].job.options.foods = [{ ...food(1), baseParams: [{ baseParamId: 1, multiplier: 1.01, maxValue: 1 }] }, currentFood];
  const best = f.validate();
  expect(best.results[0].selection[0]).toBe(currentEquipment);
  expect(best.results[0].food).toBe(currentFood);
  expect(best.results[0].damage).toBe(1_110);
});

test("a supplied seed cannot hide a duplicate food attribute behind a matching identity", () => {
  const f = fixture();
  const candidate = f.seeds[0].food!;
  candidate.baseParams.push({ ...candidate.baseParams[0]!, multiplier: 1, maxValue: 0 });
  expect(() => f.validate()).toThrow(/属性 1 重复/);
});

test.each(["equipment", "food"] as const)("stale numerical %s data cannot be admitted by a surviving identity", kind => {
  const f = fixture();
  if (kind === "equipment") f.seeds[0].selection[0].baseParams[0].value++;
  else f.seeds[0].food!.baseParams[0].maxValue++;
  expect(() => f.validate()).toThrow(/不属于模型候选/);
});

test("an extractor's actual attribute vector participates in the candidate match", () => {
  const f = fixture();
  f.jobs[0].job.options.equipmentAttributeExtractor = item => [
    ...item.baseParams, { baseParamId: 1, value: item.PDMG },
  ];
  f.seeds[0].selection[0].PDMG = 5;
  expect(() => f.validate()).toThrow(/属性向量不匹配/);
});

test("a reference-sensitive extractor retains an unallocated candidate's original object", () => {
  const f = fixture(), candidate = f.jobs[0].job.options.slots[0][0];
  const known = new WeakMap<EquipInfo, EquipInfo["baseParams"]>([[candidate, candidate.baseParams]]);
  f.jobs[0].job.options.equipmentAttributeExtractor = item => known.get(item) ?? [];
  f.seeds[0].selection = [candidate];
  expect(f.validate().results[0].damage).toBe(1_110);
});

test.each([0, 5, 10, 11, 19, 20, 25, 26])("custom discrete GCD intervals retain their union at speed %s", speed => {
  const f = fixture(), current = f.jobs[0].job;
  current.options.slots = [[equipment(100, speed)]];
  current.options.speedAttributeId = 2;
  current.options.constraints = { gcdChoices: [2, 2.1] };
  current.options.gcdToSpeedRange = value => value === 2 ? { min: 5, max: 10 } : { min: 20, max: 25 };
  const model = buildLinearAttributeModel(current.options)!;
  expect(model).toBeDefined();
  f.jobs[0].prepared.model = model;
  f.seeds[0].selection = structuredClone([current.options.slots[0][0]]);
  // Both allowed factor GCD and a broad attribute hull alone would admit 11..19.
  if ((speed >= 5 && speed <= 10) || (speed >= 20 && speed <= 25)) {
    expect(f.validate()).toBeDefined();
  } else expect(() => f.validate()).toThrow(/GCD 速度区间并集/);
});

test("a discrete GCD interval requires the original speed attribute's configured index", () => {
  const f = fixture();
  f.jobs[0].job.options.speedAttributeId = 999;
  f.jobs[0].prepared.model.gcdChoiceRanges = [{ min: 0, max: 100 }];
  expect(() => f.validate()).toThrow(/GCD 速度区间并集/);
});

function resistanceFixture() {
  const f = fixture();
  const candidate: EquipInfo = { ...equipment(100, 0),
    resistanceWeaponAdjust: { stats: ["DET"], maxEachStat: 5, maxTotalStats: 4, statMaximums: { DET: 3 } } };
  f.jobs[0].job.options.slots = [[candidate]];
  f.jobs[0].prepared.model.resistanceAllocationVariables = [{ slotIndex: 0, candidateIndex: 0,
    stat: "DET", baseParamId: 2, attributeIndex: 1, maxValue: 3, maxTotalStats: 4, variable: "allocation" }];
  f.seeds[0].selection = [{ ...structuredClone(candidate), resistanceAllocation: [{ stat: "DET", baseParamId: 2, value: 3 }] }];
  return f;
}

test("legal resistance allocations are copied onto the current candidate and retain their original caps", () => {
  const f = resistanceFixture(), best = f.validate();
  expect(best.results[0].damage).toBe(1_103);
  expect(best.results[0].selection[0].resistanceWeaponAdjust).toBe(f.jobs[0].job.options.slots[0][0].resistanceWeaponAdjust);
  expect(best.results[0].selection[0].resistanceAllocation).toEqual([{ stat: "DET", baseParamId: 2, value: 3 }]);
  expect(best.results[0].selection[0].resistanceAllocation).not.toBe(f.seeds[0].selection[0].resistanceAllocation);
});

test("a resistance annotation cannot trigger extra STR outside the bare candidate's linear model", () => {
  const f = resistanceFixture(), current = f.jobs[0].job;
  current.options.equipmentAttributeExtractor = item => [...item.baseParams,
    ...(item.resistanceAllocation?.length ? [{ baseParamId: 1, value: 300 }] : []),
  ];
  f.jobs[0].prepared.model = buildLinearAttributeModel(current.options)!;
  const seeded = getAttributeVector(f.seeds[0].selection, f.seeds[0].food,
    current.options.attributeIds, current.options.equipmentAttributeExtractor, current.options.statIndexes);
  expect(seeded[0]).toBe(410);
  expect(f.jobs[0].prepared.model.fixedEquipmentAttributes[0][0][0]).toBe(100);
  expect(() => f.validate()).toThrow(/属性向量不匹配/);
});

test("food decoding must agree with the prepared auxiliary floor and cap, not just another seed object", () => {
  const f = fixture(), current = f.jobs[0].job;
  const original = buildLinearAttributeModel(current.options)!;
  f.jobs[0].prepared.model = original;
  // Simulate stale model food metadata, while both the seed and domain food
  // claim the same stronger bonus. Identity and object-to-object checks agree.
  current.options.foods[0].baseParams[0].maxValue = 11;
  f.seeds[0].food!.baseParams[0].maxValue = 11;
  expect(() => f.validate()).toThrow(/食物属性与原整数模型不一致/);
});

test.each([{ cap: 50, bonus: 13 }, { cap: 5, bonus: 5 }])("food auxiliary reconstruction preserves base offset, rational flooring and cap $cap", ({ cap, bonus }) => {
  const f = fixture(), current = f.jobs[0].job;
  current.options.foods[0].baseParams = [{ baseParamId: 1, baseValue: 7, multiplier: 1.13, maxValue: cap }];
  f.seeds[0].food = structuredClone(current.options.foods[0]);
  f.jobs[0].prepared.model = buildLinearAttributeModel(current.options)!;
  expect(f.validate().results[0].damage).toBe((100 + bonus) * 10 + 10);
});

test("an input food offset changed after building the model cannot inflate the seed score", () => {
  const f = fixture(), job = f.jobs[0].job;
  const parameter = { baseParamId: 1, baseValue: 0, multiplier: 1.1, maxValue: 100 };
  job.options.foods[0].baseParams = [parameter];
  f.jobs[0].prepared.model = buildLinearAttributeModel(job.options)!;
  parameter.baseValue = 100;
  f.seeds[0].food = structuredClone(job.options.foods[0]);
  expect(() => f.validate()).toThrow(/食物属性与原整数模型不一致/);
});

test("a negative food rate skipped by model auxiliaries cannot become a scored seed", () => {
  const f = fixture(), current = f.jobs[0].job;
  const original = buildLinearAttributeModel(current.options)!;
  original.foodBonuses = [];
  f.jobs[0].prepared.model = original;
  current.options.foods[0].baseParams[0].multiplier = 0.9;
  f.seeds[0].food = structuredClone(current.options.foods[0]);
  expect(() => f.validate()).toThrow(/食物加成比例.*负值/);
});

test.each(["stat-cap", "total-cap", "duplicate", "wrong-attribute", "wrong-stat", "fraction"] as const)("a seed cannot relax the original resistance allocation rules: %s", reason => {
  const f = resistanceFixture(), selected = f.seeds[0].selection[0];
  selected.resistanceWeaponAdjust = { stats: ["DET", "CRT"], maxEachStat: 100, maxTotalStats: 100 };
  if (reason === "stat-cap") selected.resistanceAllocation = [{ stat: "DET", baseParamId: 2, value: 4 }];
  if (reason === "total-cap") {
    f.jobs[0].job.options.attributeIds = [1, 2, 3];
    f.jobs[0].job.options.statIndexes = new Map([["STR", 0], ["DET", 1], ["CRT", 2]]);
    f.jobs[0].job.options.slots[0][0].resistanceWeaponAdjust!.stats = ["DET", "CRT"];
    const variable = f.jobs[0].prepared.model.resistanceAllocationVariables[0];
    f.jobs[0].prepared.model.resistanceAllocationVariables.push({ ...variable, stat: "CRT", baseParamId: 3,
      attributeIndex: 2, variable: "allocation_crt" });
    selected.resistanceAllocation = [{ stat: "DET", baseParamId: 2, value: 3 }, { stat: "CRT", baseParamId: 3, value: 2 }];
  }
  if (reason === "duplicate") selected.resistanceAllocation = [{ stat: "DET", baseParamId: 2, value: 1 }, { stat: "DET", baseParamId: 2, value: 2 }];
  if (reason === "wrong-attribute") selected.resistanceAllocation = [{ stat: "DET", baseParamId: 1, value: 3 }];
  if (reason === "wrong-stat") selected.resistanceAllocation = [{ stat: "CRT", baseParamId: 2, value: 3 }];
  if (reason === "fraction") selected.resistanceAllocation = [{ stat: "DET", baseParamId: 2, value: 0.5 }];
  expect(() => f.validate()).toThrow(/装备不属于模型候选/);
});

test("same-identity resistance candidates are disambiguated by their own legal allocation domains", () => {
  const f = resistanceFixture(), current = f.jobs[0].job.options.slots[0][0];
  f.jobs[0].job.options.slots = [[{ ...current, resistanceWeaponAdjust: { stats: ["DET"], maxEachStat: 1, maxTotalStats: 1 } }, current]];
  const variable = f.jobs[0].prepared.model.resistanceAllocationVariables[0];
  f.jobs[0].prepared.model.resistanceAllocationVariables = [{ ...variable, maxValue: 1, maxTotalStats: 1 },
    { ...variable, candidateIndex: 1, variable: "allocation_second" }];
  expect(f.validate().results[0].selection[0].resistanceWeaponAdjust).toBe(current.resistanceWeaponAdjust);
});

test("a fixed parameter candidate does not acquire automatic allocation variables from a seed", () => {
  const f = fixture();
  f.seeds[0].selection[0].resistanceWeaponAdjust = { stats: ["DET"], maxEachStat: 10, maxTotalStats: 10 };
  f.seeds[0].selection[0].resistanceAllocation = [{ stat: "DET", baseParamId: 2, value: 1 }];
  expect(() => f.validate()).toThrow(/装备不属于模型候选/);
});

test("current uniqueness metadata defeats a forged nonunique seed annotation", () => {
  const f = fixture();
  const rings = [0, 1].map(ringSlotIndex => ({ ...equipment(20, 0), ringSlotIndex: ringSlotIndex as 0 | 1, isUnique: true }));
  f.jobs[0].job.slotNames = ["ring", "ring2"];
  f.jobs[0].job.options.slots = rings.map(ring => [ring]);
  f.options.commonSlots = [];
  f.seeds[0].selection = rings.map(ring => ({ ...structuredClone(ring), isUnique: false }));
  expect(() => f.validate()).toThrow(/重复使用唯一戒指/);
});

function splitRingFixture() {
  const f = fixture();
  f.options.commonSlots = ["rings"];
  for (let j = 0; j < f.jobs.length; j++) {
    const first = { ...equipment(40, 0), itemId: 501, key: "first" };
    const second = { ...equipment(50, 0), itemId: 502, key: "second" };
    const pair: RingPairCandidate = { ...equipment(90, 0), itemId: 0, key: "pair", ringEquips: [first, second],
      ringUniqueByItemId: [[501, true], [502, true]] };
    const original = f.jobs[j].originalJob;
    original.slotNames = ["rings"];
    original.options.slots = [[pair]];
    const ringSplit = trySplitRingPairDomain(original, f.options.equipmentIdentity)!;
    expect(ringSplit).toBeDefined();
    f.jobs[j].ringSplit = ringSplit;
    f.jobs[j].job = expandJointRingPairDomain(original, ringSplit);
    f.seeds[j].selection = [structuredClone(pair)];
  }
  return f;
}

test("split rings rebuild a legal original pair and ignore untrusted aggregate pair attributes", () => {
  const f = splitRingFixture();
  f.seeds[0].selection[0].baseParams[0].value = 900;
  const best = f.validate();
  expect(best.results[0].selection[0]).toBe(f.jobs[0].originalJob.options.slots[0][0]);
  expect(best.results[0].selection).toHaveLength(1);
  expect(best.results[0].damage).toBe(1_000);
});

test("split rings still reject missing original pairs and extra original slots", () => {
  const f = splitRingFixture();
  const pair = f.seeds[0].selection[0] as RingPairCandidate;
  pair.ringEquips = [pair.ringEquips[0], pair.ringEquips[0]];
  expect(() => f.validate()).toThrow(/装备不属于模型候选/);
  const extra = splitRingFixture();
  extra.seeds[0].selection.push(equipment(1));
  expect(() => extra.validate()).toThrow(/装备不属于模型候选/);
});

test.each([undefined, NaN] as const)("public evaluation must produce finite damage: %s", damage => {
  const f = fixture();
  f.jobs[0].job.options.evaluationFunction = () => damage === undefined ? undefined : ({ damage, gcd: 2 });
  expect(() => f.validate()).toThrow(/无法计算伤害/);
});
