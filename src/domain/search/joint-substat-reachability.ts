import type { FoodParam } from "./types.ts";

export type JointSubstatFactorClass = {
  min: number;
  max: number;
  variable: string;
};

export type JointSubstatFood = {
  baseParams: readonly FoodParam[];
};

export type JointSubstatFoodBonus = {
  foodIndex: number;
  attribute: number;
  numerator: number;
  denominator: number;
  cap: number;
  maximumRaw: number;
};

export type JointSubstatSupportRow = {
  name: string;
  terms: readonly (readonly [string, number])[];
  sense: "<=" | ">=";
  rhs: number;
};

export type JointSubstatConditionalExtrema = {
  classVariable: string;
  classMin: number;
  classMax: number;
  otherMin: number;
  otherMax: number;
};

export type JointSubstatReachabilityDiagnostics = {
  elapsedMs: number;
  crtTransitions: number;
  dhtTransitions: number;
  foodEvaluations: number;
  crtConditionalClasses: number;
  dhtConditionalClasses: number;
  maxConditionalClassesPerDirection: number;
  rowsAdded: number;
  skippedReason?:
    | "missing-axis"
    | "invalid-input"
    | "invalid-food-metadata"
    | "transition-budget"
    | "indexed-width"
    | "food-evaluation-budget"
    | "unsafe-integer"
    | "empty-domain";
};

export type JointSubstatReachabilityResult = {
  rows: JointSubstatSupportRow[];
  crtConditionals: JointSubstatConditionalExtrema[];
  dhtConditionals: JointSubstatConditionalExtrema[];
  diagnostics: JointSubstatReachabilityDiagnostics;
};

export type JointSubstatReachabilityInput = {
  /** One candidate-attribute vector per candidate in each slot. */
  equipmentAttributes: readonly (readonly (readonly number[])[])[];
  attributeIds: readonly number[];
  crtAttribute: number;
  dhtAttribute: number;
  crtClasses: readonly JointSubstatFactorClass[];
  dhtClasses: readonly JointSubstatFactorClass[];
  foods: readonly JointSubstatFood[];
  foodBonuses: readonly JointSubstatFoodBonus[];
  rawMaximums: readonly number[];
  crtFinalVariable: string;
  dhtFinalVariable: string;
  crtGlobalMinimum: number;
  crtGlobalMaximum: number;
  dhtGlobalMinimum: number;
  dhtGlobalMaximum: number;
};

/** Lower test-only limits are accepted; callers can never raise the production caps. */
export type JointSubstatReachabilityLimits = {
  maxTransitionsPerDirection?: number;
  maxIndexedWidth?: number;
  maxFoodEvaluations?: number;
  /** Optional sparse MIP policy; omitted means retain every conditional class. */
  maxConditionalClassesPerDirection?: number;
};

const HARD_MAX_TRANSITIONS_PER_DIRECTION = 1_000_000;
const HARD_MAX_INDEXED_WIDTH = 200_000;
const HARD_MAX_FOOD_EVALUATIONS = 1_000_000;
const HARD_MAX_CONDITIONAL_CLASSES_PER_DIRECTION = 200_000;

type AxisFoodBonus = { numerator: bigint; denominator: bigint; cap: bigint; baseValue: bigint };
type IndexedExtrema = {
  minimum: number;
  maximum: number;
  reachable: Uint8Array;
  otherMinimum: Float64Array;
  otherMaximum: Float64Array;
  reachableCount: number;
  transitions: number;
};

type DpResult = { value?: IndexedExtrema; skippedReason?: JointSubstatReachabilityDiagnostics["skippedReason"] };

function safeLimit(value: number | undefined, hardMaximum: number): number {
  return value === undefined || !Number.isFinite(value)
    ? hardMaximum
    : Math.min(hardMaximum, Math.max(0, Math.floor(value)));
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function sameRational(
  leftNumerator: number,
  leftDenominator: number,
  rightNumerator: number,
  rightDenominator: number,
): boolean {
  return BigInt(leftNumerator) * BigInt(rightDenominator) ===
    BigInt(rightNumerator) * BigInt(leftDenominator);
}

function prepareFoodBonuses(
  input: JointSubstatReachabilityInput,
): { byAxis: AxisFoodBonus[][]; foodCount: number } | undefined {
  const foodCount = Math.max(1, input.foods.length);
  const axes = [input.crtAttribute, input.dhtAttribute] as const;
  const ids = [input.attributeIds[input.crtAttribute], input.attributeIds[input.dhtAttribute]] as const;
  const byAxis: AxisFoodBonus[][] = [[], []];
  const bonusesByKey = new Map<string, JointSubstatFoodBonus>();

  for (const bonus of input.foodBonuses) {
    if (!Number.isSafeInteger(bonus.foodIndex) || bonus.foodIndex < 0 || bonus.foodIndex >= input.foods.length ||
      !Number.isSafeInteger(bonus.attribute) || !Number.isSafeInteger(bonus.numerator) || bonus.numerator <= 0 ||
      !Number.isSafeInteger(bonus.denominator) || bonus.denominator <= 0 ||
      !Number.isSafeInteger(bonus.cap) || bonus.cap <= 0 || !Number.isSafeInteger(bonus.maximumRaw) ||
      bonus.maximumRaw < 0) return undefined;
    if (bonus.attribute !== axes[0] && bonus.attribute !== axes[1]) continue;
    const key = `${bonus.foodIndex}:${bonus.attribute}`;
    if (bonusesByKey.has(key)) return undefined;
    bonusesByKey.set(key, bonus);
  }

  for (let axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
    const attribute = axes[axisIndex]!;
    const attributeId = ids[axisIndex];
    const rawMaximum = input.rawMaximums[attribute];
    if (attributeId === undefined || !Number.isSafeInteger(attributeId) ||
      !Number.isSafeInteger(rawMaximum) || rawMaximum! < 0) return undefined;

    for (let foodIndex = 0; foodIndex < foodCount; foodIndex += 1) {
      if (input.foods.length === 0) {
        byAxis[axisIndex]!.push({ numerator: 0n, denominator: 1n, cap: 0n, baseValue: 0n });
        continue;
      }
      const food = input.foods[foodIndex];
      if (food === undefined) return undefined;
      const matches = food.baseParams.filter((param) => param.baseParamId === attributeId);
      if (matches.length > 1) return undefined;
      const param = matches[0];
      if (param === undefined) {
        if (bonusesByKey.has(`${foodIndex}:${attribute}`)) return undefined;
        byAxis[axisIndex]!.push({ numerator: 0n, denominator: 1n, cap: 0n, baseValue: 0n });
        continue;
      }
      const baseValue = param.baseValue ?? 0;
      if (!Number.isSafeInteger(param.baseParamId) || !Number.isSafeInteger(baseValue) || baseValue < 0 ||
        !Number.isFinite(param.multiplier) || param.multiplier < 0 ||
        !Number.isSafeInteger(param.maxValue) || param.maxValue < 0) return undefined;
      if (param.maxValue === 0 || param.multiplier <= 1) {
        if (bonusesByKey.has(`${foodIndex}:${attribute}`)) return undefined;
        byAxis[axisIndex]!.push({ numerator: 0n, denominator: 1n, cap: 0n, baseValue: BigInt(baseValue) });
        continue;
      }
      const percentNumerator = Math.round((param.multiplier - 1) * 100);
      if (!Number.isSafeInteger(percentNumerator) || percentNumerator <= 0) return undefined;
      const divisor = gcd(percentNumerator, 100);
      const numerator = percentNumerator / divisor;
      const denominator = 100 / divisor;
      const bonus = bonusesByKey.get(`${foodIndex}:${attribute}`);
      if (bonus === undefined || bonus.cap !== param.maxValue ||
        !sameRational(bonus.numerator, bonus.denominator, numerator, denominator) ||
        bonus.maximumRaw !== rawMaximum! + baseValue || !Number.isSafeInteger(bonus.maximumRaw)) return undefined;
      byAxis[axisIndex]!.push({
        numerator: BigInt(bonus.numerator),
        denominator: BigInt(bonus.denominator),
        cap: BigInt(bonus.cap),
        baseValue: BigInt(baseValue),
      });
    }
  }
  return { byAxis, foodCount };
}

function applyFood(raw: number, bonus: AxisFoodBonus): number | undefined {
  if (!Number.isSafeInteger(raw) || raw < 0) return undefined;
  const rawBig = BigInt(raw);
  const uncapped = ((rawBig + bonus.baseValue) * bonus.numerator) / bonus.denominator;
  const foodBonus = uncapped < bonus.cap ? uncapped : bonus.cap;
  const finalValue = rawBig + foodBonus;
  if (finalValue > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(finalValue);
}

function buildIndexedExtrema(
  input: JointSubstatReachabilityInput,
  indexAxis: 0 | 1,
  maxTransitions: number,
  maxWidth: number,
): DpResult {
  const indexAttribute = indexAxis === 0 ? input.crtAttribute : input.dhtAttribute;
  const otherAttribute = indexAxis === 0 ? input.dhtAttribute : input.crtAttribute;
  if (input.equipmentAttributes.length === 0 ||
    input.equipmentAttributes.some((slot) => slot.length === 0)) return { skippedReason: "empty-domain" };

  let minimum = 0;
  let maximum = 0;
  let reachableCount = 1;
  let reachable = Uint8Array.of(1);
  let otherMinimum = Float64Array.of(0);
  let otherMaximum = Float64Array.of(0);
  let transitions = 0;

  for (const slot of input.equipmentAttributes) {
    const uniquePairs = new Map<string, readonly [number, number]>();
    let pairMinimum = Number.POSITIVE_INFINITY;
    let pairMaximum = Number.NEGATIVE_INFINITY;
    for (const candidate of slot) {
      if (candidate === undefined || !Number.isSafeInteger(candidate[indexAttribute]) ||
        !Number.isSafeInteger(candidate[otherAttribute])) return { skippedReason: "invalid-input" };
      const pair = [candidate[indexAttribute]!, candidate[otherAttribute]!] as const;
      uniquePairs.set(`${pair[0]}:${pair[1]}`, pair);
      pairMinimum = Math.min(pairMinimum, pair[0]);
      pairMaximum = Math.max(pairMaximum, pair[0]);
      if (uniquePairs.size > Math.floor((maxTransitions - transitions) / reachableCount)) {
        return { skippedReason: "transition-budget" };
      }
    }
    const pairs = [...uniquePairs.values()];
    if (pairs.length === 0) return { skippedReason: "empty-domain" };
    if (reachableCount > Math.floor((maxTransitions - transitions) / pairs.length)) {
      return { skippedReason: "transition-budget" };
    }
    const nextMinimum = minimum + pairMinimum;
    const nextMaximum = maximum + pairMaximum;
    const width = nextMaximum - nextMinimum + 1;
    if (!Number.isSafeInteger(nextMinimum) || !Number.isSafeInteger(nextMaximum) ||
      !Number.isSafeInteger(width) || width <= 0) return { skippedReason: "unsafe-integer" };
    if (width > maxWidth) return { skippedReason: "indexed-width" };

    const nextReachable = new Uint8Array(width);
    const nextOtherMinimum = new Float64Array(width);
    const nextOtherMaximum = new Float64Array(width);
    let nextReachableCount = 0;
    for (let previousIndex = 0; previousIndex < reachable.length; previousIndex += 1) {
      if (reachable[previousIndex] !== 1) continue;
      const previousIndexed = minimum + previousIndex;
      for (const pair of pairs) {
        const indexed = previousIndexed + pair[0];
        const otherMin = otherMinimum[previousIndex]! + pair[1];
        const otherMax = otherMaximum[previousIndex]! + pair[1];
        if (!Number.isSafeInteger(indexed) || !Number.isSafeInteger(otherMin) ||
          !Number.isSafeInteger(otherMax)) return { skippedReason: "unsafe-integer" };
        const target = indexed - nextMinimum;
        if (nextReachable[target] === 0) {
          nextReachable[target] = 1;
          nextOtherMinimum[target] = otherMin;
          nextOtherMaximum[target] = otherMax;
          nextReachableCount += 1;
        } else {
          nextOtherMinimum[target] = Math.min(nextOtherMinimum[target]!, otherMin);
          nextOtherMaximum[target] = Math.max(nextOtherMaximum[target]!, otherMax);
        }
      }
    }
    transitions += reachableCount * pairs.length;
    reachable = nextReachable;
    otherMinimum = nextOtherMinimum;
    otherMaximum = nextOtherMaximum;
    reachableCount = nextReachableCount;
    minimum = nextMinimum;
    maximum = nextMaximum;
  }
  return {
    value: { minimum, maximum, reachable, otherMinimum, otherMaximum, reachableCount, transitions },
  };
}

function validateClasses(classes: readonly JointSubstatFactorClass[]): boolean {
  if (classes.length === 0) return false;
  let previousMaximum = Number.NEGATIVE_INFINITY;
  for (const entry of classes) {
    if (!Number.isSafeInteger(entry.min) || !Number.isSafeInteger(entry.max) || entry.min > entry.max ||
      typeof entry.variable !== "string" || entry.variable.length === 0 || entry.min <= previousMaximum) return false;
    previousMaximum = entry.max;
  }
  return true;
}

function classIndexForValue(classes: readonly JointSubstatFactorClass[], value: number): number {
  let low = 0;
  let high = classes.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = classes[middle]!;
    if (value < candidate.min) high = middle - 1;
    else if (value > candidate.max) low = middle + 1;
    else return middle;
  }
  return -1;
}

function collectConditionals(
  indexed: IndexedExtrema,
  indexedClasses: readonly JointSubstatFactorClass[],
  indexedFoodBonuses: readonly AxisFoodBonus[],
  otherFoodBonuses: readonly AxisFoodBonus[],
  foodCount: number,
): JointSubstatConditionalExtrema[] | undefined {
  const minima = new Array<number>(indexedClasses.length).fill(Number.POSITIVE_INFINITY);
  const maxima = new Array<number>(indexedClasses.length).fill(Number.NEGATIVE_INFINITY);
  for (let rawIndex = 0; rawIndex < indexed.reachable.length; rawIndex += 1) {
    if (indexed.reachable[rawIndex] !== 1) continue;
    const rawIndexed = indexed.minimum + rawIndex;
    for (let foodIndex = 0; foodIndex < foodCount; foodIndex += 1) {
      const indexedValue = applyFood(rawIndexed, indexedFoodBonuses[foodIndex]!);
      const otherMin = applyFood(indexed.otherMinimum[rawIndex]!, otherFoodBonuses[foodIndex]!);
      const otherMax = applyFood(indexed.otherMaximum[rawIndex]!, otherFoodBonuses[foodIndex]!);
      if (indexedValue === undefined || otherMin === undefined || otherMax === undefined) return undefined;
      const classIndex = classIndexForValue(indexedClasses, indexedValue);
      if (classIndex < 0) continue;
      minima[classIndex] = Math.min(minima[classIndex]!, otherMin);
      maxima[classIndex] = Math.max(maxima[classIndex]!, otherMax);
    }
  }
  return indexedClasses.flatMap((factorClass, index) =>
    Number.isFinite(minima[index]) && Number.isFinite(maxima[index])
      ? [{
        classVariable: factorClass.variable,
        classMin: factorClass.min,
        classMax: factorClass.max,
        otherMin: minima[index]!,
        otherMax: maxima[index]!,
      }]
      : []);
}

function addConditionalRows(
  rows: JointSubstatSupportRow[],
  prefix: string,
  conditionals: readonly JointSubstatConditionalExtrema[],
  conditionedVariable: string,
  globalMinimum: number,
  globalMaximum: number,
): void {
  for (let index = 0; index < conditionals.length; index += 1) {
    const conditional = conditionals[index]!;
    if (conditional.otherMax < globalMaximum && conditional.otherMax >= globalMinimum) {
      const slack = globalMaximum - conditional.otherMax;
      if (Number.isSafeInteger(slack) && slack > 0) rows.push({
        name: `${prefix}_${index}_upper`,
        terms: [[conditionedVariable, 1], [conditional.classVariable, slack]],
        sense: "<=",
        rhs: globalMaximum,
      });
    }
    if (conditional.otherMin > globalMinimum && conditional.otherMin <= globalMaximum) {
      const slack = conditional.otherMin - globalMinimum;
      if (Number.isSafeInteger(slack) && slack > 0) rows.push({
        name: `${prefix}_${index}_lower`,
        terms: [[conditionedVariable, 1], [conditional.classVariable, -slack]],
        sense: ">=",
        rhs: globalMinimum,
      });
    }
  }
}

function strongestConditionals(
  conditionals: readonly JointSubstatConditionalExtrema[],
  globalMinimum: number,
  globalMaximum: number,
  limit: number,
): JointSubstatConditionalExtrema[] {
  return [...conditionals]
    .sort((left, right) => {
      const leftStrength = globalMaximum - left.otherMax + left.otherMin - globalMinimum;
      const rightStrength = globalMaximum - right.otherMax + right.otherMin - globalMinimum;
      return rightStrength - leftStrength || left.classMin - right.classMin || left.classMax - right.classMax;
    })
    .slice(0, limit);
}

export function buildJointSubstatReachabilitySupports(
  input: JointSubstatReachabilityInput,
  limits: JointSubstatReachabilityLimits = {},
): JointSubstatReachabilityResult {
  const startedAt = performance.now();
  const empty = (skippedReason: JointSubstatReachabilityDiagnostics["skippedReason"]): JointSubstatReachabilityResult => ({
    rows: [],
    crtConditionals: [],
    dhtConditionals: [],
    diagnostics: {
      elapsedMs: performance.now() - startedAt,
      crtTransitions: 0,
      dhtTransitions: 0,
      foodEvaluations: 0,
      crtConditionalClasses: 0,
      dhtConditionalClasses: 0,
      maxConditionalClassesPerDirection: safeLimit(
        limits.maxConditionalClassesPerDirection,
        HARD_MAX_CONDITIONAL_CLASSES_PER_DIRECTION,
      ),
      rowsAdded: 0,
      ...(skippedReason === undefined ? {} : { skippedReason }),
    },
  });

  if (input.crtAttribute === input.dhtAttribute || !validateClasses(input.crtClasses) ||
    !validateClasses(input.dhtClasses)) return empty("missing-axis");
  if (!Number.isSafeInteger(input.crtAttribute) || input.crtAttribute < 0 ||
    !Number.isSafeInteger(input.dhtAttribute) || input.dhtAttribute < 0 ||
    input.crtAttribute >= input.attributeIds.length || input.dhtAttribute >= input.attributeIds.length ||
    !Number.isSafeInteger(input.crtGlobalMinimum) || !Number.isSafeInteger(input.crtGlobalMaximum) ||
    input.crtGlobalMinimum > input.crtGlobalMaximum ||
    !Number.isSafeInteger(input.dhtGlobalMinimum) || !Number.isSafeInteger(input.dhtGlobalMaximum) ||
    input.dhtGlobalMinimum > input.dhtGlobalMaximum ||
    !input.crtFinalVariable || !input.dhtFinalVariable) return empty("invalid-input");

  const food = prepareFoodBonuses(input);
  if (food === undefined) return empty("invalid-food-metadata");
  const maxTransitions = safeLimit(limits.maxTransitionsPerDirection, HARD_MAX_TRANSITIONS_PER_DIRECTION);
  const maxWidth = safeLimit(limits.maxIndexedWidth, HARD_MAX_INDEXED_WIDTH);
  const maxFoodEvaluations = safeLimit(limits.maxFoodEvaluations, HARD_MAX_FOOD_EVALUATIONS);
  const maxConditionalClassesPerDirection = safeLimit(
    limits.maxConditionalClassesPerDirection,
    HARD_MAX_CONDITIONAL_CLASSES_PER_DIRECTION,
  );
  const crtIndexed = buildIndexedExtrema(input, 0, maxTransitions, maxWidth);
  if (crtIndexed.value === undefined) return empty(crtIndexed.skippedReason ?? "invalid-input");
  const dhtIndexed = buildIndexedExtrema(input, 1, maxTransitions, maxWidth);
  if (dhtIndexed.value === undefined) return empty(dhtIndexed.skippedReason ?? "invalid-input");
  const foodEvaluationsBig = BigInt(crtIndexed.value.reachableCount + dhtIndexed.value.reachableCount) *
    BigInt(food.foodCount);
  if (foodEvaluationsBig > BigInt(maxFoodEvaluations)) return empty("food-evaluation-budget");
  if (foodEvaluationsBig > BigInt(Number.MAX_SAFE_INTEGER)) return empty("unsafe-integer");

  const crtConditionals = collectConditionals(
    crtIndexed.value,
    input.crtClasses,
    food.byAxis[0]!,
    food.byAxis[1]!,
    food.foodCount,
  );
  const dhtConditionals = collectConditionals(
    dhtIndexed.value,
    input.dhtClasses,
    food.byAxis[1]!,
    food.byAxis[0]!,
    food.foodCount,
  );
  if (crtConditionals === undefined || dhtConditionals === undefined) return empty("unsafe-integer");

  const rows: JointSubstatSupportRow[] = [];
  const selectedCrtConditionals = strongestConditionals(
    crtConditionals, input.dhtGlobalMinimum, input.dhtGlobalMaximum, maxConditionalClassesPerDirection,
  );
  const selectedDhtConditionals = strongestConditionals(
    dhtConditionals, input.crtGlobalMinimum, input.crtGlobalMaximum, maxConditionalClassesPerDirection,
  );
  addConditionalRows(rows, "substat_crt_class_dht", selectedCrtConditionals, input.dhtFinalVariable,
    input.dhtGlobalMinimum, input.dhtGlobalMaximum);
  addConditionalRows(rows, "substat_dht_class_crt", selectedDhtConditionals, input.crtFinalVariable,
    input.crtGlobalMinimum, input.crtGlobalMaximum);
  return {
    rows,
    crtConditionals,
    dhtConditionals,
    diagnostics: {
      elapsedMs: performance.now() - startedAt,
      crtTransitions: crtIndexed.value.transitions,
      dhtTransitions: dhtIndexed.value.transitions,
      foodEvaluations: Number(foodEvaluationsBig),
      crtConditionalClasses: crtConditionals.length,
      dhtConditionalClasses: dhtConditionals.length,
      maxConditionalClassesPerDirection,
      rowsAdded: rows.length,
    },
  };
}
