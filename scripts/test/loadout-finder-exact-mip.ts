import loadHighs from "highs";
import {
  createIntegerDamageFactorEvaluator,
  type IntegerDamageFactors,
} from "./equipped-effects.ts";
import type {
  GcdSpeedRange,
  LoadoutConstraints,
} from "./search-types.ts";
import type {
  EquipmentAttributeExtractor,
  LoadoutSearchResult,
} from "./search-types.ts";
import type {
  EquipInfo,
  FoodInfo,
  ParamInfo,
} from "./types.ts";
import type { Job, JobLevel, Stat } from "../../reference/ffxiv-gearing/src/game.ts";

type RowSense = "=" | "<=" | ">=";

type ModelRow = {
  name: string;
  terms: Map<string, number>;
  sense: RowSense;
  rhs: number;
};

type VariableBounds = {
  name: string;
  min: number;
  max: number;
};

type FactorClass = {
  min: number;
  max: number;
  value: number;
  auxiliary?: number;
  variable: string;
  q: number;
};

type FactorGroup = {
  name: string;
  classes: FactorClass[];
};

type AttributeFoodBonus = {
  foodIndex: number;
  attribute: number;
  bonus: string;
  capped: string;
  numerator: number;
  denominator: number;
  cap: number;
  maximumRaw: number;
};

export type ExactMipSearchStatistics = {
  elapsedMs: number;
  solverRuns: number;
  excludedSignatures: number;
  variables: number;
  constraints: number;
  maximumSurrogate: number;
  nextSurrogate: number | undefined;
  memoryUsage: NodeJS.MemoryUsage;
};

export type ExactMipResult = LoadoutSearchResult & {
  maximumToughness?: number;
  statistics: ExactMipSearchStatistics;
};

export type ExactMipOptions = {
  job: Job;
  jobLevel: JobLevel;
  attributeIds: readonly number[];
  statIndexes: ReadonlyMap<Stat, number>;
  slots: readonly (readonly EquipInfo[])[];
  foods: readonly FoodInfo[];
  constraints?: LoadoutConstraints;
  speedAttributeId?: number;
  toughnessAttributeId?: number;
  gcdToSpeedRange?: (gcdSeconds: number) => GcdSpeedRange | undefined;
  toughnessPercentToMinimum?: (percentage: number) => number;
  equipmentAttributeExtractor?: EquipmentAttributeExtractor;
  evaluationFunction: (
    attributes: readonly number[],
  ) => { damage: number; gcd: number } | undefined;
  maxSearchMs?: number;
  onProgress?: (message: string) => void;
};

const LOG_SCALE = 1_000_000_000_000n;
const FIXED_SCALE = 10n ** 30n;
const LOG_TERMS = 40;

function gcd(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) [left, right] = [right, left % right];
  return left;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Returns round(LOG_SCALE * ln(value)), after proving that the lower and upper
 * fixed-point series bounds round to the same integer.
 */
function roundedLog(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`伤害因子必须是正安全整数：${value}`);
  }
  if (value === 1) return 0;
  const integer = BigInt(value);
  const exponent = integer.toString(2).length - 1;
  const powerOfTwo = 1n << BigInt(exponent);
  const numerator = integer - powerOfTwo;
  const denominator = integer + powerOfTwo;

  const atanhLogBounds = (num: bigint, den: bigint): readonly [bigint, bigint] => {
    if (num === 0n) return [0n, 0n];
    let numPower = num;
    let denPower = den;
    const numSquared = num * num;
    const denSquared = den * den;
    let lower = 0n;
    for (let index = 0; index < LOG_TERMS; index++) {
      lower += (2n * FIXED_SCALE * numPower) /
        (denPower * BigInt(index * 2 + 1));
      numPower *= numSquared;
      denPower *= denSquared;
    }
    const omittedTerms = 2n * BigInt(LOG_TERMS);
    const nextDenominator = BigInt(LOG_TERMS * 2 + 1);
    const remainderUpper = ceilDiv(
      2n * FIXED_SCALE * numPower * denSquared,
      denPower * nextDenominator * (denSquared - numSquared),
    );
    return [lower, lower + omittedTerms + remainderUpper];
  };

  const [mantissaLower, mantissaUpper] = atanhLogBounds(numerator, denominator);
  const [lnTwoLower, lnTwoUpper] = atanhLogBounds(1n, 3n);
  const lower = mantissaLower + BigInt(exponent) * lnTwoLower;
  const upper = mantissaUpper + BigInt(exponent) * lnTwoUpper;
  const roundFixed = (fixed: bigint) =>
    (fixed * LOG_SCALE + FIXED_SCALE / 2n) / FIXED_SCALE;
  const lowerRounded = roundFixed(lower);
  const upperRounded = roundFixed(upper);
  if (lowerRounded !== upperRounded) {
    throw new Error(`固定点对数区间过宽，无法安全量化因子 ${value}`);
  }
  const result = Number(lowerRounded);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`固定点对数超出安全整数：${value}`);
  }
  return result;
}

function addTerm(terms: Map<string, number>, name: string, coefficient: number): void {
  if (coefficient === 0) return;
  const sum = (terms.get(name) ?? 0) + coefficient;
  if (sum === 0) terms.delete(name);
  else terms.set(name, sum);
}

function addRows(
  rows: ModelRow[],
  name: string,
  terms: ReadonlyMap<string, number> | readonly (readonly [string, number])[],
  sense: RowSense,
  rhs: number,
): void {
  const map = terms instanceof Map ? new Map(terms) : new Map(terms);
  for (const [variable, coefficient] of map) {
    if (!Number.isSafeInteger(coefficient)) {
      throw new RangeError(`模型行 ${name} 的系数不是安全整数：${coefficient}`);
    }
    if (coefficient === 0) map.delete(variable);
  }
  if (!Number.isSafeInteger(rhs)) {
    throw new RangeError(`模型行 ${name} 的右侧不是安全整数：${rhs}`);
  }
  rows.push({ name, terms: map, sense, rhs });
}

function expression(terms: ReadonlyMap<string, number>): string {
  const entries = [...terms].filter(([, coefficient]) => coefficient !== 0);
  if (entries.length === 0) return "0";
  return entries.map(([variable, coefficient], index) => {
    const sign = coefficient < 0 ? "-" : "+";
    const magnitude = Math.abs(coefficient);
    return `${index === 0 ? (sign === "-" ? "- " : "") : ` ${sign} `}${magnitude} ${variable}`;
  }).join("");
}

function lpText(
  name: string,
  objective: ReadonlyMap<string, number>,
  rows: readonly ModelRow[],
  bounds: readonly VariableBounds[],
  binaries: readonly string[],
  generals: readonly string[],
): string {
  const output = ["Maximize", ` obj: ${expression(objective)}`, "Subject To"];
  for (const row of rows) {
    output.push(` ${row.name}: ${expression(row.terms)} ${row.sense} ${row.rhs}`);
  }
  output.push("Bounds");
  for (const bound of bounds) {
    output.push(` ${bound.min} <= ${bound.name} <= ${bound.max}`);
  }
  if (generals.length > 0) output.push("Generals", ` ${generals.join(" ")}`);
  if (binaries.length > 0) output.push("Binaries", ` ${binaries.join(" ")}`);
  output.push("End");
  return output.join("\n");
}

function buildFactorClasses(
  groupName: string,
  values: readonly { value: number; auxiliary?: number }[],
): FactorClass[] {
  if (values.length === 0) throw new Error(`因子组 ${groupName} 没有可达值`);
  const result: FactorClass[] = [];
  let start = 0;
  for (let index = 1; index <= values.length; index++) {
    const previous = values[index - 1]!;
    const current = values[index];
    if (
      current !== undefined &&
      current.value === previous.value &&
      current.auxiliary === previous.auxiliary
    ) continue;
    result.push({
      min: start,
      max: index - 1,
      value: previous.value,
      auxiliary: previous.auxiliary,
      variable: `${groupName}_${result.length}`,
      q: roundedLog(previous.value),
    });
    start = index;
  }
  return result;
}

function factorValue(
  factors: IntegerDamageFactors,
  name: "mainStat" | "determination" | "tenacity" | "critical" | "directHit" | "gcdCentiseconds",
): number {
  return factors[name];
}

function makeVector(length: number, index: number, value: number): number[] {
  const result = new Array<number>(length).fill(0);
  result[index] = value;
  return result;
}

function getAttributeVector(
  selection: readonly EquipInfo[],
  food: FoodInfo | undefined,
  attributeIds: readonly number[],
  equipmentAttributeExtractor: EquipmentAttributeExtractor | undefined,
): number[] {
  const indexes = new Map(attributeIds.map((id, index) => [id, index]));
  const result = new Array<number>(attributeIds.length).fill(0);
  for (const equipment of selection) {
    const params = equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
    for (const param of params) {
      const index = indexes.get(param.baseParamId);
      if (index !== undefined) result[index] += param.value;
    }
  }
  if (food !== undefined) {
    for (const param of food.baseParams) {
      const index = indexes.get(param.baseParamId);
      if (index === undefined) continue;
      result[index] += Math.min(
        param.maxValue,
        Math.trunc(result[index]! * (param.multiplier - 1) + 1e-7),
      );
    }
  }
  return result;
}

function exactProduct(factors: IntegerDamageFactors): bigint {
  return BigInt(factors.weaponDamage) * BigInt(factors.mainStat) *
    BigInt(factors.determination) * BigInt(factors.tenacity) *
    BigInt(factors.critical) * BigInt(factors.directHit);
}

function betterFactors(
  candidate: IntegerDamageFactors,
  incumbent: IntegerDamageFactors | undefined,
  useDps: boolean,
): boolean {
  if (incumbent === undefined) return true;
  const candidateProduct = exactProduct(candidate);
  const incumbentProduct = exactProduct(incumbent);
  if (!useDps) return candidateProduct > incumbentProduct;
  return candidateProduct * BigInt(incumbent.gcdCentiseconds) >
    incumbentProduct * BigInt(candidate.gcdCentiseconds);
}

function parseRationalRate(rate: number): { numerator: number; denominator: number } {
  const numerator = Math.round(rate * 100);
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new RangeError(`食物加成比例不是百分比整数：${rate}`);
  }
  const divisor = gcd(numerator, 100);
  return { numerator: numerator / divisor, denominator: 100 / divisor };
}

function validateFoodRate(param: FoodInfo["baseParams"][number], maximumRaw: number): {
  numerator: number;
  denominator: number;
} {
  const rate = parseRationalRate(param.multiplier - 1);
  for (let raw = 0; raw <= maximumRaw; raw++) {
    const expected = Math.min(
      param.maxValue,
      Math.trunc(raw * (param.multiplier - 1) + 1e-7),
    );
    const rational = Math.min(
      param.maxValue,
      Math.floor((raw * rate.numerator) / rate.denominator),
    );
    if (expected !== rational) {
      throw new Error(
        `食物 ${param.baseParamId} 的整数比例模型与 v2 取整不一致：原始值=${raw}`,
      );
    }
  }
  return rate;
}

function factorGroupsForAttribute(
  name: string,
  attributeIndex: number | undefined,
  maximum: number,
  vectorLength: number,
  evaluator: (attributes: readonly number[]) => IntegerDamageFactors | undefined,
  field: "mainStat" | "determination" | "tenacity" | "critical" | "directHit" | "gcdCentiseconds",
  withBluAddition = false,
  weaponBase = 0,
): FactorGroup {
  const values: { value: number; auxiliary?: number }[] = [];
  for (let value = 0; value <= (attributeIndex === undefined ? 0 : maximum); value++) {
    const attributes = attributeIndex === undefined
      ? new Array<number>(vectorLength).fill(0)
      : makeVector(vectorLength, attributeIndex, value);
    const factors = evaluator(attributes);
    if (factors === undefined) throw new Error("当前职业没有可用的整数伤害因子公式");
    values.push({
      value: factorValue(factors, field),
      auxiliary: withBluAddition
        ? factors.weaponDamage - weaponBase
        : undefined,
    });
  }
  const classes = buildFactorClasses(name, values);
  for (let index = 1; index < classes.length; index++) {
    const previous = classes[index - 1]!;
    const current = classes[index]!;
    const decreases = field === "gcdCentiseconds"
      ? current.value > previous.value
      : current.value < previous.value;
    if (decreases) {
      throw new Error(`因子 ${name} 非单调递增，无法压缩成线性区间`);
    }
  }
  return { name, classes };
}

function addClassSelection(
  rows: ModelRow[],
  bounds: VariableBounds[],
  binaryVars: string[],
  group: FactorGroup,
  attributeVariable: string | undefined,
  maximum: number,
): void {
  for (const factorClass of group.classes) {
    bounds.push({ name: factorClass.variable, min: 0, max: 1 });
    binaryVars.push(factorClass.variable);
  }
  const exactlyOne = new Map(group.classes.map((factorClass) => [factorClass.variable, 1]));
  addRows(rows, `${group.name}_one`, exactlyOne, "=", 1);
  if (attributeVariable === undefined) return;
  const lowerTerms = new Map<string, number>();
  const upperTerms = new Map<string, number>();
  addTerm(lowerTerms, attributeVariable, 1);
  addTerm(upperTerms, attributeVariable, 1);
  for (const factorClass of group.classes) {
    addTerm(lowerTerms, factorClass.variable, -factorClass.min);
    addTerm(upperTerms, factorClass.variable, -factorClass.max);
  }
  addRows(rows, `${group.name}_lower`, lowerTerms, ">=", 0);
  addRows(rows, `${group.name}_upper`, upperTerms, "<=", 0);
  if (group.classes.at(-1)!.max !== maximum) {
    throw new Error(`因子组 ${group.name} 的区间未覆盖属性上限`);
  }
}

function addRangeConstraint(
  rows: ModelRow[],
  name: string,
  variable: string,
  minimum: number | undefined,
  maximum: number | undefined,
): void {
  if (minimum !== undefined) {
    addRows(rows, `${name}_min`, [[variable, 1]], ">=", Math.ceil(minimum));
  }
  if (maximum !== undefined) {
    addRows(rows, `${name}_max`, [[variable, 1]], "<=", Math.floor(maximum));
  }
}

function buildLinearAttributeModel(options: ExactMipOptions) {
  const { slots, foods, attributeIds } = options;
  if (slots.some((slot) => slot.length === 0)) return undefined;
  const idToIndex = new Map(attributeIds.map((id, index) => [id, index]));
  const rows: ModelRow[] = [];
  const bounds: VariableBounds[] = [];
  const binaryVars: string[] = [];
  const generalVars: string[] = [];
  const slotVariables: string[][] = [];
  const foodVariables: string[] = [];
  const equipmentAttributes = slots.map((slot) => slot.map((equipment) => {
    const result = new Array<number>(attributeIds.length).fill(0);
    const params = options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
    for (const param of params) {
      const index = idToIndex.get(param.baseParamId);
      if (index !== undefined) result[index] += param.value;
    }
    return result;
  }));
  const rawMaximums = attributeIds.map((_, attribute) =>
    equipmentAttributes.reduce((total, slot) =>
      total + Math.max(0, ...slot.map((values) => values[attribute]!)), 0));
  for (const maximum of rawMaximums) {
    if (!Number.isSafeInteger(maximum) || maximum < 0) {
      throw new RangeError(`装备属性范围不是非负安全整数：${maximum}`);
    }
  }

  slots.forEach((slot, slotIndex) => {
    const variables = slot.map((_, candidateIndex) => `e_${slotIndex}_${candidateIndex}`);
    slotVariables.push(variables);
    variables.forEach((variable) => {
      bounds.push({ name: variable, min: 0, max: 1 });
      binaryVars.push(variable);
    });
    addRows(rows, `slot_${slotIndex}`, variables.map((variable) => [variable, 1] as const), "=", 1);
  });

  const foodBonuses: AttributeFoodBonus[] = [];
  if (foods.length > 0) {
    foods.forEach((_, index) => {
      const variable = `f_${index}`;
      foodVariables.push(variable);
      bounds.push({ name: variable, min: 0, max: 1 });
      binaryVars.push(variable);
    });
    addRows(rows, "choose_food", foodVariables.map((variable) => [variable, 1] as const), "=", 1);
  }

  const rawVariables: string[] = [];
  const finalVariables: string[] = [];
  attributeIds.forEach((_, attribute) => {
    const rawVariable = `raw_${attribute}`;
    const finalVariable = `final_${attribute}`;
    rawVariables.push(rawVariable);
    finalVariables.push(finalVariable);
    bounds.push({ name: rawVariable, min: 0, max: rawMaximums[attribute]! });
    bounds.push({ name: finalVariable, min: 0, max: rawMaximums[attribute]! + Math.max(0, ...foods.map((food) =>
      food.baseParams.find((param) => param.baseParamId === attributeIds[attribute])?.maxValue ?? 0)) });
    generalVars.push(rawVariable, finalVariable);

    const rawTerms = new Map<string, number>([[rawVariable, 1]]);
    slots.forEach((slot, slotIndex) => {
      slot.forEach((_, candidateIndex) => {
        addTerm(rawTerms, slotVariables[slotIndex]![candidateIndex]!, -equipmentAttributes[slotIndex]![candidateIndex]![attribute]!);
      });
    });
    addRows(rows, `raw_sum_${attribute}`, rawTerms, "=", 0);

  });

  for (let foodIndex = 0; foodIndex < foods.length; foodIndex++) {
    const food = foods[foodIndex]!;
    const foodVariable = foodVariables[foodIndex]!;
    for (const param of food.baseParams) {
      const attribute = idToIndex.get(param.baseParamId);
      if (attribute === undefined || param.maxValue <= 0 || param.multiplier <= 1) continue;
      const { numerator, denominator } = validateFoodRate(param, rawMaximums[attribute]!);
      if (numerator === 0) continue;
      const bonus = `b_${foodIndex}_${attribute}`;
      const capped = `c_${foodIndex}_${attribute}`;
      const cap = param.maxValue;
      const bigM = Math.max(
        numerator * rawMaximums[attribute]!,
        denominator * cap,
      );
      bounds.push({ name: bonus, min: 0, max: cap });
      bounds.push({ name: capped, min: 0, max: 1 });
      generalVars.push(bonus);
      binaryVars.push(capped);
      foodBonuses.push({
        foodIndex,
        attribute,
        bonus,
        capped,
        numerator,
        denominator,
        cap,
        maximumRaw: rawMaximums[attribute]!,
      });
      addRows(rows, `food_cap_flag_${foodIndex}_${attribute}`, [[capped, 1], [foodVariable, -1]], "<=", 0);
      addRows(rows, `food_bonus_cap_low_${foodIndex}_${attribute}`, [[bonus, 1], [capped, -cap]], ">=", 0);
      addRows(rows, `food_bonus_cap_high_${foodIndex}_${attribute}`, [[bonus, 1], [foodVariable, -(cap - 1)], [capped, -1]], "<=", 0);
      addRows(rows, `food_floor_low_${foodIndex}_${attribute}`, [[bonus, denominator], [rawVariables[attribute]!, -numerator]], "<=", 0);
      const floorHigh = new Map<string, number>([
        [rawVariables[attribute]!, numerator],
        [bonus, -denominator],
        [capped, -bigM],
        [foodVariable, bigM],
      ]);
      addRows(rows, `food_floor_high_${foodIndex}_${attribute}`, floorHigh, "<=", denominator - 1 + bigM);
      const capThreshold = new Map<string, number>([
        [rawVariables[attribute]!, numerator],
        [capped, -bigM],
      ]);
      addRows(rows, `food_cap_threshold_${foodIndex}_${attribute}`, capThreshold, ">=", denominator * cap - bigM);
    }
  }
  // Rebuild final totals after each food's conditional bonus variables exist.
  attributeIds.forEach((_, attribute) => {
    const finalTerms = new Map<string, number>([[finalVariables[attribute]!, 1], [rawVariables[attribute]!, -1]]);
    for (const bonus of foodBonuses) {
      if (bonus.attribute === attribute) addTerm(finalTerms, bonus.bonus, -1);
    }
    addRows(rows, `final_food_sum_${attribute}`, finalTerms, "=", 0);
  });

  const constraints = options.constraints ?? {};
  const ranges = new Map<number, { min?: number; max?: number }>();
  const mergeRange = (attributeId: number, min?: number, max?: number) => {
    const index = idToIndex.get(attributeId);
    if (index === undefined) throw new RangeError(`属性约束包含未配置的属性 id：${attributeId}`);
    const existing = ranges.get(index) ?? {};
    const combined = {
      min: Math.max(existing.min ?? Number.NEGATIVE_INFINITY, min ?? Number.NEGATIVE_INFINITY),
      max: Math.min(existing.max ?? Number.POSITIVE_INFINITY, max ?? Number.POSITIVE_INFINITY),
    };
    if (combined.min > combined.max) throw new RangeError(`属性 ${attributeId} 的约束范围为空`);
    ranges.set(index, {
      min: Number.isFinite(combined.min) ? combined.min : undefined,
      max: Number.isFinite(combined.max) ? combined.max : undefined,
    });
  };
  if (constraints.gcd !== undefined) {
    if (options.gcdToSpeedRange === undefined) throw new RangeError("按 GCD 搜索需要配置 gcdToSpeedRange");
    const range = options.gcdToSpeedRange(constraints.gcd);
    if (range === undefined) return undefined;
    if (options.speedAttributeId === undefined) throw new RangeError("按 GCD 搜索缺少速度属性 id");
    mergeRange(options.speedAttributeId, range.min, range.max);
  }
  if (constraints.speedMin !== undefined || constraints.speedMax !== undefined) {
    if (options.speedAttributeId === undefined) throw new RangeError("速度约束缺少速度属性 id");
    mergeRange(options.speedAttributeId, constraints.speedMin, constraints.speedMax);
  }
  if (constraints.toughMin !== undefined || constraints.toughnessMinPercent !== undefined || constraints.maxToughnessMode === true) {
    if (options.toughnessAttributeId === undefined) throw new RangeError("坚韧约束需要配置坚韧属性 id");
    if (constraints.toughMin !== undefined) mergeRange(options.toughnessAttributeId, constraints.toughMin);
    if (constraints.toughnessMinPercent !== undefined) {
      if (options.toughnessPercentToMinimum === undefined) throw new RangeError("按坚韧百分比搜索需要配置 toughnessPercentToMinimum");
      mergeRange(options.toughnessAttributeId, options.toughnessPercentToMinimum(constraints.toughnessMinPercent));
    }
  }
  for (const [attribute, range] of ranges) {
    addRangeConstraint(rows, `attribute_range_${attribute}`, finalVariables[attribute]!, range.min, range.max);
  }

  return {
    rows,
    bounds,
    binaryVars,
    generalVars,
    slotVariables,
    foodVariables,
    rawVariables,
    finalVariables,
    rawMaximums,
    equipmentAttributes,
    foodBonuses,
    idToIndex,
    ranges,
  };
}

export async function findBestLoadoutExactMip(
  options: ExactMipOptions,
): Promise<ExactMipResult | undefined> {
  const startedAt = performance.now();
  const maxSearchMs = options.maxSearchMs ?? 110_000;
  if (!Number.isFinite(maxSearchMs) || maxSearchMs <= 0) throw new RangeError("maxSearchMs 必须是正有限值");
  const model = buildLinearAttributeModel(options);
  if (model === undefined) return undefined;
  const factorEvaluator = createIntegerDamageFactorEvaluator(
    options.job,
    options.jobLevel,
    options.statIndexes,
  );
  const zeroFactors = factorEvaluator(new Array<number>(options.attributeIds.length).fill(0));
  if (zeroFactors === undefined) throw new Error(`职业 ${options.job} 没有整数伤害因子公式`);
  const schema = (await import("../../reference/ffxiv-gearing/src/game.ts")).jobSchemas[options.job];
  if (schema.mainStat === undefined) throw new Error(`职业 ${options.job} 缺少主属性公式`);
  const attackStat: Stat = schema.mainStat === "VIT" ? "STR" : schema.mainStat;
  const weaponStat: Stat = schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  const speedStat: Stat = schema.stats?.includes("SKS") ? "SKS" : "SPS";
  const mainIndex = options.statIndexes.get(attackStat);
  const detIndex = options.statIndexes.get("DET");
  const tenIndex = options.statIndexes.get("TEN");
  const crtIndex = options.statIndexes.get("CRT");
  const dhtIndex = options.statIndexes.get("DHT");
  const speedIndex = options.statIndexes.get(speedStat);
  const weaponIndex = options.statIndexes.get(weaponStat);
  const indexForStat = (stat: Stat) => {
    const vectorIndex = options.statIndexes.get(stat);
    if (vectorIndex === undefined) return undefined;
    const id = options.attributeIds[vectorIndex];
    return id === undefined ? undefined : model.idToIndex.get(id);
  };
  const mainAttribute = mainIndex === undefined ? undefined : indexForStat(attackStat);
  const detAttribute = detIndex === undefined ? undefined : indexForStat("DET");
  const tenAttribute = tenIndex === undefined ? undefined : indexForStat("TEN");
  const crtAttribute = crtIndex === undefined ? undefined : indexForStat("CRT");
  const dhtAttribute = dhtIndex === undefined ? undefined : indexForStat("DHT");
  const speedAttribute = speedIndex === undefined ? undefined : indexForStat(speedStat);
  const weaponAttribute = weaponIndex === undefined ? undefined : indexForStat(weaponStat);
  if (mainAttribute === undefined || weaponAttribute === undefined || speedAttribute === undefined) {
    throw new Error("精确 MIP 模型缺少主属性、武器伤害或职业速度属性");
  }
  const finalMaximums = options.attributeIds.map((id, index) =>
    model.rawMaximums[index]! + Math.max(0, ...options.foods.map((food) =>
      food.baseParams.find((param) => param.baseParamId === id)?.maxValue ?? 0)));

  const groups: FactorGroup[] = [];
  groups.push(factorGroupsForAttribute("main", mainAttribute, finalMaximums[mainAttribute]!, options.attributeIds.length, factorEvaluator, "mainStat", options.job === "BLU", zeroFactors.weaponDamage));
  groups.push(factorGroupsForAttribute("det", detAttribute, detAttribute === undefined ? 0 : finalMaximums[detAttribute]!, options.attributeIds.length, factorEvaluator, "determination"));
  groups.push(factorGroupsForAttribute("ten", tenAttribute, tenAttribute === undefined ? 0 : finalMaximums[tenAttribute]!, options.attributeIds.length, factorEvaluator, "tenacity"));
  groups.push(factorGroupsForAttribute("crt", crtAttribute, crtAttribute === undefined ? 0 : finalMaximums[crtAttribute]!, options.attributeIds.length, factorEvaluator, "critical"));
  groups.push(factorGroupsForAttribute("dht", dhtAttribute, dhtAttribute === undefined ? 0 : finalMaximums[dhtAttribute]!, options.attributeIds.length, factorEvaluator, "directHit"));
  groups.push(factorGroupsForAttribute("gcd", speedAttribute, finalMaximums[speedAttribute]!, options.attributeIds.length, factorEvaluator, "gcdCentiseconds"));
  const mainFactorGroup = groups[0]!;
  const bluAdditionValues = mainFactorGroup.classes.map((factorClass) => factorClass.auxiliary ?? 0);
  const bluAdditionMinimum = options.job === "BLU" ? Math.min(...bluAdditionValues) : 0;
  const bluAdditionMaximum = options.job === "BLU"
    ? Math.max(...bluAdditionValues)
    : 0;
  // BLU's reference lookup returns zero outside its source table. Keep the
  // complete relative range, including a possible negative delta from INT=0.
  const weaponRelativeMinimum = bluAdditionMinimum;
  const weaponRelativeMaximum = finalMaximums[weaponAttribute]! + bluAdditionMaximum;
  const weaponGroup: FactorGroup = {
    name: "weapon",
    classes: Array.from({ length: weaponRelativeMaximum - weaponRelativeMinimum + 1 }, (_, offset) => {
      const relative = weaponRelativeMinimum + offset;
      const value = zeroFactors.weaponDamage + relative;
      if (value <= 0) throw new RangeError("武器伤害因子必须为正数");
      return {
      min: relative,
      max: relative,
      value,
      variable: `weapon_${offset}`,
      q: roundedLog(value),
      };
    }),
  };
  groups.unshift(weaponGroup);

  const groupedByAttribute = [
    [groups[0]!, undefined, 0] as const,
    [groups[1]!, model.finalVariables[mainAttribute], finalMaximums[mainAttribute]!] as const,
    [groups[2]!, detAttribute === undefined ? undefined : model.finalVariables[detAttribute], detAttribute === undefined ? 0 : finalMaximums[detAttribute]!] as const,
    [groups[3]!, tenAttribute === undefined ? undefined : model.finalVariables[tenAttribute], tenAttribute === undefined ? 0 : finalMaximums[tenAttribute]!] as const,
    [groups[4]!, crtAttribute === undefined ? undefined : model.finalVariables[crtAttribute], crtAttribute === undefined ? 0 : finalMaximums[crtAttribute]!] as const,
    [groups[5]!, dhtAttribute === undefined ? undefined : model.finalVariables[dhtAttribute], dhtAttribute === undefined ? 0 : finalMaximums[dhtAttribute]!] as const,
    [groups[6]!, model.finalVariables[speedAttribute], finalMaximums[speedAttribute]!] as const,
  ];
  const boundsSet = new Set(model.bounds.map((bound) => bound.name));
  for (const [group, variable, maximum] of groupedByAttribute) {
    if (group.name === "weapon") {
      const relativeVariable = "weapon_relative";
      if (!boundsSet.has(relativeVariable)) {
        model.bounds.push({ name: relativeVariable, min: weaponRelativeMinimum, max: weaponRelativeMaximum });
        model.generalVars.push(relativeVariable);
        boundsSet.add(relativeVariable);
      }
      const wdExpression = new Map<string, number>([[relativeVariable, 1]]);
      if (options.job === "BLU") {
        for (const factorClass of mainFactorGroup.classes) {
          addTerm(wdExpression, factorClass.variable, -(factorClass.auxiliary ?? 0));
        }
      }
      if (weaponAttribute !== undefined) addTerm(wdExpression, model.finalVariables[weaponAttribute]!, -1);
      addRows(model.rows, "weapon_total_sum", wdExpression, "=", 0);
      addClassSelection(model.rows, model.bounds, model.binaryVars, group, relativeVariable, weaponRelativeMaximum);
    } else {
      addClassSelection(model.rows, model.bounds, model.binaryVars, group, variable, maximum);
    }
  }

  const useDps = options.constraints?.gcd === undefined;
  const gcdGroup = groups.find((group) => group.name === "gcd")!;
  if (!useDps) {
    for (const factorClass of gcdGroup.classes) factorClass.q = 0;
  } else {
    for (const factorClass of gcdGroup.classes) factorClass.q = -factorClass.q;
  }
  const qByVariable = new Map<string, number>();
  for (const group of groups) {
    const maximumQ = Math.max(...group.classes.map((factorClass) => factorClass.q));
    for (const factorClass of group.classes) {
      const coefficient = factorClass.q - maximumQ;
      qByVariable.set(factorClass.variable, coefficient);
    }
  }
  const excludedSignatures: string[][] = [];
  const toughnessIndex = options.toughnessAttributeId === undefined
    ? undefined
    : model.idToIndex.get(options.toughnessAttributeId);
  if (options.constraints?.maxToughnessMode === true && toughnessIndex === undefined) {
    throw new RangeError("最高坚韧模式需要配置坚韧属性 id");
  }
  const highs = await loadHighs();
  let solverRuns = 0;
  let maximumSurrogate = Number.NEGATIVE_INFINITY;
  let nextSurrogate: number | undefined;
  let best: { result: LoadoutSearchResult; factors: IntegerDamageFactors; toughness?: number } | undefined;
  const solveModel = (objective: Map<string, number>, phaseName: string) => {
    const remainingMs = maxSearchMs - (performance.now() - startedAt);
    if (remainingMs <= 0) throw new Error("精确 MIP 搜索达到时限，未完成最优性证明");
    const rows = [...model.rows];
    excludedSignatures.forEach((signature, index) => {
      addRows(rows, `nogood_${index}`, signature.map((variable) => [variable, 1] as const), "<=", signature.length - 1);
    });
    const output = highs.solve(
      lpText(phaseName, objective, rows, model.bounds, model.binaryVars, model.generalVars),
      {
        output_flag: false,
        presolve: "on",
        parallel: "off",
        mip_rel_gap: 0,
        mip_abs_gap: 0,
        time_limit: Math.max(0.05, remainingMs / 1000),
      },
    );
    solverRuns++;
    options.onProgress?.(`HiGHS ${phaseName} 状态=${output.Status}；目标=${output.ObjectiveValue}`);
    return output;
  };
  const setRange = (variable: string, minimum?: number, maximum?: number) => {
    addRangeConstraint(model.rows, `max_ten_${model.rows.length}`, variable, minimum, maximum);
  };

  if (options.constraints?.maxToughnessMode === true) {
    const tenVariable = model.finalVariables[toughnessIndex!]!;
    const phaseOne = solveModel(new Map([[tenVariable, 1]]), "maximum_tenacity");
    if (phaseOne.Status === "Infeasible") return undefined;
    if (phaseOne.Status !== "Optimal") throw new Error(`最高坚韧阶段未证明最优：${phaseOne.Status}`);
    const maximumTenacity = phaseOne.Columns[tenVariable]?.Primal;
    if (!Number.isSafeInteger(maximumTenacity)) throw new Error("最高坚韧阶段返回了非整数解");
    setRange(tenVariable, maximumTenacity, maximumTenacity);
  }

  const objective = new Map<string, number>();
  for (const [variable, coefficient] of qByVariable) addTerm(objective, variable, coefficient);
  let firstSurrogate: number | undefined;
  // The score sums seven rounded log factors. Its rounding error is bounded
  // by the factor count, so signatures below the surrogate optimum by more
  // than this band cannot beat that optimum under exact factor comparison.
  const errorBand = groups.length;
  while (true) {
    const output = solveModel(objective, "exact_damage");
    if (output.Status === "Infeasible") {
      if (best === undefined) {
        return undefined;
      }
      break;
    }
    if (output.Status !== "Optimal") throw new Error(`精确 MIP 搜索未证明最优：${output.Status}`);
    const selectedSignature: string[] = [];
    const selectedFactors: Partial<Record<keyof IntegerDamageFactors, number>> = {};
    let surrogate = 0;
    for (const group of groups) {
      let chosen: FactorClass | undefined;
      for (const factorClass of group.classes) {
        if ((output.Columns[factorClass.variable]?.Primal ?? 0) > 0.5) {
          chosen = factorClass;
          selectedSignature.push(factorClass.variable);
          break;
        }
      }
      if (chosen === undefined) throw new Error(`MIP 解缺少因子组 ${group.name}`);
      if (group.name === "weapon") selectedFactors.weaponDamage = chosen.value;
      if (group.name === "main") selectedFactors.mainStat = chosen.value;
      if (group.name === "det") selectedFactors.determination = chosen.value;
      if (group.name === "ten") selectedFactors.tenacity = chosen.value;
      if (group.name === "crt") selectedFactors.critical = chosen.value;
      if (group.name === "dht") selectedFactors.directHit = chosen.value;
      if (group.name === "gcd") selectedFactors.gcdCentiseconds = chosen.value;
      surrogate += chosen.q;
    }
    const selection = slotsForResult(options.slots, model.slotVariables, output.Columns);
    const food = foodForResult(options.foods, model.foodVariables, output.Columns);
    const attributes = getAttributeVector(selection, food, options.attributeIds, options.equipmentAttributeExtractor);
    const factors = factorEvaluator(attributes);
    if (factors === undefined) throw new Error("精确 MIP 返回的属性向量无法评估");
    for (const name of ["weaponDamage", "mainStat", "determination", "tenacity", "critical", "directHit", "gcdCentiseconds"] as const) {
      if (factors[name] !== selectedFactors[name]) {
        throw new Error(`MIP 因子与正式公式不一致：${name}=${selectedFactors[name]}，正式值=${factors[name]}`);
      }
    }
    const evaluation = options.evaluationFunction(attributes);
    if (evaluation === undefined || !Number.isFinite(evaluation.damage) || !Number.isFinite(evaluation.gcd)) {
      throw new Error("MIP 返回的配装无法计算伤害或 GCD");
    }
    const candidate = { result: { selection, food, damage: evaluation.damage }, factors, toughness: toughnessIndex === undefined ? undefined : attributes[toughnessIndex] };
    if (best === undefined || betterFactors(factors, best.factors, useDps)) best = candidate;
    if (firstSurrogate === undefined) {
      firstSurrogate = surrogate;
      maximumSurrogate = surrogate;
    } else nextSurrogate = surrogate;
    if (best !== undefined && surrogate < firstSurrogate - errorBand) break;
    excludedSignatures.push(selectedSignature);
    options.onProgress?.(`精确候选已核验 ${excludedSignatures.length} 个；固定点上界=${surrogate}`);
    if (performance.now() - startedAt >= maxSearchMs) {
      throw new Error("精确 MIP 搜索达到时限，未完成最优性证明");
    }
  }
  if (best === undefined) return undefined;
  const statistics = createStatistics();
  return {
    ...best.result,
    ...(options.constraints?.maxToughnessMode === true && best.toughness !== undefined
      ? { maximumToughness: best.toughness }
      : {}),
    statistics,
  };

  function createStatistics(): ExactMipSearchStatistics {
    return {
      elapsedMs: performance.now() - startedAt,
      solverRuns,
      excludedSignatures: excludedSignatures.length,
      variables: model!.bounds.length,
      constraints: model!.rows.length + excludedSignatures.length,
      maximumSurrogate,
      nextSurrogate,
      memoryUsage: process.memoryUsage(),
    };
  }
}

function slotsForResult(
  slots: readonly (readonly EquipInfo[])[],
  variables: readonly (readonly string[])[],
  columns: Record<string, { Primal: number }>,
): EquipInfo[] {
  return slots.map((slot, slotIndex) => {
    const selected = variables[slotIndex]!.findIndex((variable) =>
      (columns[variable]?.Primal ?? 0) > 0.5);
    if (selected < 0) throw new Error(`MIP 没有为槽位 ${slotIndex} 选择装备`);
    return slot[selected]!;
  });
}

function foodForResult(
  foods: readonly FoodInfo[],
  variables: readonly string[],
  columns: Record<string, { Primal: number }>,
): FoodInfo | undefined {
  if (foods.length === 0) return undefined;
  const selected = variables.findIndex((variable) =>
    (columns[variable]?.Primal ?? 0) > 0.5);
  if (selected < 0) throw new Error("MIP 没有选择食物");
  return foods[selected];
}
