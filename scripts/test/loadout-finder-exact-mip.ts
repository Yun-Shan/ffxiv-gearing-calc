import loadHighs from "highs";
import {
  createIntegerDamageFactorEvaluator,
  type IntegerDamageFactors,
} from "./equipped-effects.ts";
import { hasStrictlyBetterFactorCombination } from "./signature-band.ts";
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
  signatureBandChecks: number;
  signatureBandElapsedMs: number;
  signatureBandProof: boolean;
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
  /** Defaults to DPS without a fixed GCD, preserving the original search behavior. */
  objective?: "damage" | "dps";
  maxSearchMs?: number;
  onProgress?: (message: string) => void;
};

const LOG_SCALE = 1_000_000_000_000n;
const FIXED_SCALE = 10n ** 30n;
const LOG_TERMS = 40;
let highsPromise: ReturnType<typeof loadHighs> | undefined;

function getHighs(): ReturnType<typeof loadHighs> {
  if (highsPromise === undefined) {
    highsPromise = loadHighs().catch((error: unknown) => {
      highsPromise = undefined;
      throw error;
    });
  }
  return highsPromise;
}

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
  firstValue = 0,
): FactorClass[] {
  if (values.length === 0) throw new Error(`因子组 ${groupName} 没有可达值`);
  const result: FactorClass[] = [];
  let start = firstValue;
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
      max: firstValue + index - 1,
      value: previous.value,
      auxiliary: previous.auxiliary,
      variable: `${groupName}_${result.length}`,
      q: roundedLog(previous.value),
    });
    start = firstValue + index;
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

function greedyMipStart(options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>, useDps: boolean, deadline: number): Map<string, number> | undefined {
  const selection = options.slots.map((slot) => slot[0]!);
  let chosenFood = options.foods[0];
  const speedIndex = options.speedAttributeId === undefined ? undefined : model.idToIndex.get(options.speedAttributeId);
  const toughnessIndex = options.toughnessAttributeId === undefined ? undefined : model.idToIndex.get(options.toughnessAttributeId);
  const choiceRanges = options.constraints?.gcdChoices?.flatMap((gcd) => {
    const range = options.gcdToSpeedRange?.(gcd);
    return range === undefined ? [] : [range];
  });
  const evaluate = () => {
    const attributes = getAttributeVector(selection, chosenFood, options.attributeIds, options.equipmentAttributeExtractor);
    const evaluation = options.evaluationFunction(attributes);
    if (evaluation === undefined || !Number.isFinite(evaluation.damage) || !Number.isFinite(evaluation.gcd) || evaluation.gcd <= 0) return undefined;
    let violation = 0;
    for (const [attribute, range] of model.ranges) {
      violation += Math.max(0, (range.min ?? attributes[attribute]!) - attributes[attribute]!,
        attributes[attribute]! - (range.max ?? attributes[attribute]!));
    }
    if (choiceRanges !== undefined && speedIndex !== undefined) {
      violation += Math.min(...choiceRanges.map((range) => Math.max(0,
        range.min - attributes[speedIndex]!, attributes[speedIndex]! - range.max)));
    }
    return { violation, toughness: toughnessIndex === undefined ? 0 : attributes[toughnessIndex]!,
      score: useDps ? evaluation.damage / evaluation.gcd : evaluation.damage };
  };
  type HeuristicScore = NonNullable<ReturnType<typeof evaluate>>;
  const better = (candidate: HeuristicScore | undefined, current: HeuristicScore | undefined) => {
    if (candidate === undefined) return false;
    if (current === undefined || candidate.violation < current.violation) return true;
    if (candidate.violation !== current.violation) return false;
    if (options.constraints?.maxToughnessMode === true && candidate.toughness !== current.toughness) {
      return candidate.toughness > current.toughness;
    }
    return candidate.score > current.score;
  };
  let current = evaluate();
  let checks = 0;
  // This bounded coordinate search supplies ONLY a MIP hint. It never serves
  // as an answer or a bound, and every final result retains the complete proof.
  for (let pass = 0; pass < 6; pass++) {
    if (performance.now() >= deadline) return undefined;
    let changed = false;
    for (let slot = 0; slot < selection.length; slot++) {
      const previous = selection[slot]!;
      let winner = previous;
      for (const candidate of options.slots[slot]!) {
        if ((++checks & 63) === 0 && performance.now() >= deadline) return undefined;
        selection[slot] = candidate;
        const score = evaluate();
        if (better(score, current)) { winner = candidate; current = score; }
      }
      selection[slot] = winner;
      changed ||= winner !== previous;
    }
    const previousFood = chosenFood;
    let winningFood = previousFood;
    for (const food of options.foods) {
      if ((++checks & 63) === 0 && performance.now() >= deadline) return undefined;
      chosenFood = food;
      const score = evaluate();
      if (better(score, current)) { winningFood = food; current = score; }
    }
    chosenFood = winningFood;
    changed ||= chosenFood !== previousFood;
    if (!changed) break;
  }
  if (current === undefined || current.violation !== 0) return undefined;
  const start = new Map<string, number>();
  selection.forEach((equipment, slot) => start.set(model.slotVariables[slot]![options.slots[slot]!.indexOf(equipment)]!, 1));
  if (chosenFood !== undefined) start.set(model.foodVariables[options.foods.indexOf(chosenFood)]!, 1);
  return start;
}

type JointMipJob = {
  id: string;
  slotNames: readonly string[];
  options: ExactMipOptions;
  baseline: IntegerDamageFactors;
};

/** The product is only a necessary upper-bound filter; candidates are ranked by the exact SUM. */
export async function findBestJointFactorMip(options: {
  jobs: readonly JointMipJob[];
  commonSlots: readonly string[];
  sharedFood: boolean;
  equipmentIdentity: (equipment: EquipInfo) => string;
  foodIdentity: (food: FoodInfo) => string;
  objective: "damage" | "dps";
  initialResults?: readonly ExactMipResult[];
  maxSearchMs: number;
  onProgress?: (message: string) => void;
}): Promise<{ results: ExactMipResult[]; solverRuns: number; signatures: number } | undefined> {
  const startedAt = performance.now();
  const preparedJobs: { job: JointMipJob; prepared: NonNullable<Awaited<ReturnType<typeof prepareExactMipModel>>> }[] = [];
  for (const job of options.jobs) {
    const prepared = await prepareExactMipModel({ ...job.options, objective: options.objective });
    if (prepared === undefined) return undefined;
    preparedJobs.push({ job, prepared });
  }
  const rows: ModelRow[] = [];
  const bounds: VariableBounds[] = [];
  const binaries: string[] = [];
  const generals: string[] = [];
  const objective = new Map<string, number>();
  const jobSurrogates: { terms: Map<string, number>; offset: number; baseline: number; error: number }[] = [];
  let maximumOffset = 0;
  let baselineQ = 0;
  const prefix = (index: number, name: string) => `j${index}_${name}`;
  for (let index = 0; index < preparedJobs.length; index++) {
    const { job, prepared } = preparedJobs[index]!;
    const { model, groups, qByVariable } = prepared;
    for (const row of model.rows) rows.push({ ...row, name: prefix(index, row.name),
      terms: new Map([...row.terms].map(([name, value]) => [prefix(index, name), value])) });
    for (const bound of model.bounds) bounds.push({ ...bound, name: prefix(index, bound.name) });
    binaries.push(...model.binaryVars.map((name) => prefix(index, name)));
    generals.push(...model.generalVars.map((name) => prefix(index, name)));
    const terms = new Map([...qByVariable].map(([name, value]) => [prefix(index, name), value]));
    for (const [name, value] of terms) objective.set(name, value);
    const offset = groups.reduce((sum, group) => sum + Math.max(...group.classes.map((entry) => entry.q)), 0);
    maximumOffset += offset;
    const factors = job.baseline;
    let individualBaselineQ = [factors.weaponDamage, factors.mainStat, factors.determination,
      factors.tenacity, factors.critical, factors.directHit].reduce((sum, value) => sum + roundedLog(value), 0);
    if (options.objective === "dps") individualBaselineQ -= roundedLog(factors.gcdCentiseconds);
    baselineQ += individualBaselineQ;
    jobSurrogates.push({ terms, offset, baseline: individualBaselineQ, error: groups.length });
    // Every joint-feasible job is bounded by its independently proved optimum.
    // Explicit bounds also prevent an LP relaxation from trading an impossible
    // super-optimal job against a suboptimal one.
    addRows(rows, `solo_bound_${index}`, terms, "<=", individualBaselineQ + groups.length - offset);
  }
  if (!Number.isSafeInteger(maximumOffset) || !Number.isSafeInteger(baselineQ)) {
    throw new Error("联合固定点目标超出安全整数范围");
  }
  const linkChoices = (name: string, choices: readonly ReadonlyMap<string, readonly string[]>[]) => {
    const keys = [...choices[0]!.keys()].filter((key) => choices.every((choice) => choice.has(key)));
    if (keys.length === 0) return false;
    const selectors: string[] = [];
    for (let choiceIndex = 0; choiceIndex < keys.length; choiceIndex++) {
      const selector = `shared_${name}_${choiceIndex}`;
      bounds.push({ name: selector, min: 0, max: 1 });
      binaries.push(selector);
      selectors.push(selector);
      for (let jobIndex = 0; jobIndex < choices.length; jobIndex++) {
        const terms = new Map<string, number>([[selector, -1]]);
        for (const variable of choices[jobIndex]!.get(keys[choiceIndex]!)!) addTerm(terms, variable, 1);
        addRows(rows, `link_${name}_${choiceIndex}_${jobIndex}`, terms, "=", 0);
      }
    }
    addRows(rows, `shared_one_${name}`, selectors.map((name) => [name, 1] as const), "=", 1);
    // Choices absent from the intersection must be disabled explicitly.
    const allowed = new Set(keys);
    choices.forEach((choice, jobIndex) => {
      for (const [key, variables] of choice) if (!allowed.has(key)) {
        addRows(rows, `shared_absent_${name}_${jobIndex}_${rows.length}`,
          variables.map((variable) => [variable, 1] as const), "=", 0);
      }
    });
    return true;
  };
  const sharedEquipmentDomains = options.commonSlots.map((slot) => {
    const choices = preparedJobs.map(({ job, prepared }, jobIndex) => {
      const slotIndex = job.slotNames.indexOf(slot);
      if (slotIndex < 0) throw new Error(`共享槽位 ${slot} 不存在于 ${job.id}`);
      const byKey = new Map<string, { equipment: EquipInfo; variables: string[] }>();
      job.options.slots[slotIndex]!.forEach((equipment, candidateIndex) => {
        const key = options.equipmentIdentity(equipment);
        const entry: { equipment: EquipInfo; variables: string[] } = byKey.get(key) ?? { equipment, variables: [] };
        entry.variables.push(prefix(jobIndex, prepared.model.slotVariables[slotIndex]![candidateIndex]!));
        byKey.set(key, entry);
      });
      return byKey;
    });
    const keys = new Set([...choices[0]!.keys()].filter((key) => choices.every((choice) => choice.has(key))));
    choices.forEach((choice, jobIndex) => {
      for (const [key, entry] of choice) if (!keys.has(key)) addRows(rows,
        `shared_absent_${slot}_${jobIndex}_${rows.length}`,
        entry.variables.map((variable) => [variable, 1] as const), "=", 0);
    });
    return { slot, choices, keys };
  });
  if (sharedEquipmentDomains.some((domain) => domain.keys.size === 0)) return undefined;
  // Keep a universal attribute profile: it includes EVERY job's extractor and
  // attribute coordinates. Equal totals allow replacing each job's shared
  // pattern by job 0's real pattern without changing any model attribute.
  // Domains remain the full identity intersection for EACH slot, so this
  // replacement also preserves slot legality and complete shared identities.
  const profileRows = new Set<string>();
  for (let targetJob = 0; targetJob < preparedJobs.length; targetJob++) {
    const target = preparedJobs[targetJob]!.job.options;
    for (const attributeId of target.attributeIds) {
      const contributions = sharedEquipmentDomains.map((domain) => new Map([...domain.keys].map((key) => {
        const equipment = domain.choices[targetJob]!.get(key)!.equipment;
        const params = target.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
        return [key, params.reduce((sum, param) => sum + (param.baseParamId === attributeId ? param.value : 0), 0)];
      })));
      for (let sourceJob = 1; sourceJob < preparedJobs.length; sourceJob++) {
        const terms = new Map<string, number>();
        sharedEquipmentDomains.forEach((domain, domainIndex) => {
          for (const key of domain.keys) {
            const coefficient = contributions[domainIndex]!.get(key)!;
            for (const variable of domain.choices[sourceJob]!.get(key)!.variables) addTerm(terms, variable, coefficient);
            for (const variable of domain.choices[0]!.get(key)!.variables) addTerm(terms, variable, -coefficient);
          }
        });
        const rowKey = JSON.stringify([...terms].sort(([left], [right]) => left.localeCompare(right)));
        if (terms.size > 0 && !profileRows.has(rowKey)) {
          profileRows.add(rowKey);
          addRows(rows, `shared_profile_${targetJob}_${attributeId}_${sourceJob}`, terms, "=", 0);
        }
      }
    }
  }
  if (options.sharedFood && preparedJobs.some(({ job }) => job.options.foods.length > 0)) {
    const choices = preparedJobs.map(({ job, prepared }, jobIndex) => {
      const byKey = new Map<string, string[]>();
      job.options.foods.forEach((food, foodIndex) => {
        const key = options.foodIdentity(food);
        const variables = byKey.get(key) ?? [];
        variables.push(prefix(jobIndex, prepared.model.foodVariables[foodIndex]!));
        byKey.set(key, variables);
      });
      return byKey;
    });
    if (!linkChoices("food", choices)) return undefined;
  }
  const highs = await getHighs();
  const excluded: string[][] = [];
  let solverRuns = 0;
  let best: { numerator: bigint; denominator: bigint; results: ExactMipResult[] } | undefined;
  if (options.initialResults !== undefined) {
    if (options.initialResults.length !== preparedJobs.length) throw new Error("联合初始方案职业数不匹配");
    let numerator = 0n;
    let denominator = 1n;
    for (let index = 0; index < preparedJobs.length; index++) {
      const { job, prepared } = preparedJobs[index]!;
      const result = options.initialResults[index]!;
      if (result.selection.length !== job.options.slots.length || result.selection.some((equipment, slot) =>
        !job.options.slots[slot]!.some((candidate) => options.equipmentIdentity(candidate) === options.equipmentIdentity(equipment)))) {
        throw new Error("联合初始方案装备不属于模型候选");
      }
      if (result.food === undefined ? job.options.foods.length > 0 :
        !job.options.foods.some((food) => options.foodIdentity(food) === options.foodIdentity(result.food!))) {
        throw new Error("联合初始方案食物不属于模型候选");
      }
      const attributes = getAttributeVector(result.selection, result.food, job.options.attributeIds, job.options.equipmentAttributeExtractor);
      for (const [attribute, range] of prepared.model.ranges) {
        if ((range.min !== undefined && attributes[attribute]! < range.min) ||
          (range.max !== undefined && attributes[attribute]! > range.max)) throw new Error("联合初始方案不满足属性约束");
      }
      const factors = prepared.factorEvaluator(attributes);
      if (factors === undefined) throw new Error("联合初始方案无法计算整数因子");
      const requested = job.options.constraints?.gcdChoices ??
        (job.options.constraints?.gcd === undefined ? undefined : [job.options.constraints.gcd]);
      if (requested !== undefined && !requested.some((value) => Math.round(value * 100) === factors.gcdCentiseconds)) {
        throw new Error("联合初始方案不满足 GCD 集合");
      }
      for (const slot of options.commonSlots) {
        if (options.equipmentIdentity(result.selection[job.slotNames.indexOf(slot)]!) !==
          options.equipmentIdentity(options.initialResults[0]!.selection[options.jobs[0]!.slotNames.indexOf(slot)]!)) {
          throw new Error("联合初始方案装备不共享");
        }
      }
      if (options.sharedFood && (result.food === undefined ? "none" : options.foodIdentity(result.food)) !==
        (options.initialResults[0]!.food === undefined ? "none" : options.foodIdentity(options.initialResults[0]!.food!))) {
        throw new Error("联合初始方案食物不共享");
      }
      const ratioNumerator = exactProduct(factors) * (options.objective === "dps" ? BigInt(job.baseline.gcdCentiseconds) : 1n);
      const ratioDenominator = exactProduct(job.baseline) * (options.objective === "dps" ? BigInt(factors.gcdCentiseconds) : 1n);
      if (ratioNumerator > ratioDenominator) throw new Error("联合初始方案超过单职业基线");
      numerator = numerator * ratioDenominator + ratioNumerator * denominator;
      denominator *= ratioDenominator;
    }
    best = { numerator, denominator, results: [...options.initialResults] };
  }
  const groupCount = preparedJobs.reduce((sum, { prepared }) => sum + prepared.groups.length, 0);
  while (true) {
    const remaining = options.maxSearchMs - (performance.now() - startedAt);
    if (remaining <= 0) throw new Error("联合因子 MIP 达到时限，未完成最优性复核");
    if (process.memoryUsage.rss() > 3.5 * 1024 ** 3) throw new Error("联合因子 MIP 达到内存保护线");
    const solveRows = [...rows];
    if (best !== undefined) {
      const thresholdNumerator = best.numerator - BigInt(options.jobs.length - 1) * best.denominator;
      if (thresholdNumerator > 0n) {
        // For t in (0,1], ln(t) >= 1 - 1/t. Rounding errors in candidate
        // and baseline log sums total at most groupCount. All arithmetic is exact.
        const loss = ceilDiv(LOG_SCALE * (best.denominator - thresholdNumerator), thresholdNumerator);
        const minimumQ = BigInt(baselineQ) - loss - BigInt(groupCount);
        const rhs = minimumQ - BigInt(maximumOffset);
        if (rhs >= BigInt(Number.MIN_SAFE_INTEGER) && rhs <= BigInt(Number.MAX_SAFE_INTEGER)) {
          addRows(solveRows, "joint_necessary_product", objective, ">=", Number(rhs));
        }
        for (let index = 0; index < jobSurrogates.length; index++) {
          const surrogate = jobSurrogates[index]!;
          // sum > incumbent and all other ratios <= 1 also require EACH ratio > t.
          const individualRhs = BigInt(surrogate.baseline - surrogate.offset - surrogate.error) - loss;
          if (individualRhs >= BigInt(Number.MIN_SAFE_INTEGER) && individualRhs <= BigInt(Number.MAX_SAFE_INTEGER)) {
            addRows(solveRows, `joint_necessary_job_${index}`, surrogate.terms, ">=", Number(individualRhs));
          }
        }
      }
    }
    excluded.forEach((signature, index) => addRows(solveRows, `joint_nogood_${index}`,
      signature.map((name) => [name, 1] as const), "<=", signature.length - 1));
    const output = highs.withModel({ format: "lp", data: lpText("joint_factor_product",
      best === undefined ? objective : new Map(), solveRows, bounds, binaries, generals) }, (native) => {
      native.options.set({ output_flag: false, presolve: "on", mip_rel_gap: 0, mip_abs_gap: 0,
        time_limit: Math.max(0.05, remaining / 1000) });
      if (best !== undefined) {
        const start = new Map<number, number>();
        for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
          const { job, prepared } = preparedJobs[jobIndex]!;
          const result = best.results[jobIndex]!;
          result.selection.forEach((equipment, slotIndex) => {
            const candidate = job.options.slots[slotIndex]!.findIndex((entry) =>
              options.equipmentIdentity(entry) === options.equipmentIdentity(equipment));
            start.set(native.getColByName(prefix(jobIndex, prepared.model.slotVariables[slotIndex]![candidate]!)), 1);
          });
          if (result.food !== undefined) {
            const foodIndex = job.options.foods.findIndex((entry) => options.foodIdentity(entry) === options.foodIdentity(result.food!));
            start.set(native.getColByName(prefix(jobIndex, prepared.model.foodVariables[foodIndex]!)), 1);
          }
        }
        const entries = [...start].sort(([left], [right]) => left - right);
        native.setSolution({ indices: entries.map(([index]) => index), values: entries.map(([, value]) => value) });
      }
      native.run();
      const status = native.getModelStatus();
      const Status = status === highs.constants.modelStatus.optimal ? "Optimal"
        : status === highs.constants.modelStatus.infeasible ? "Infeasible" : `状态代码 ${status}`;
      const Columns: Record<string, { Primal: number }> = {};
      if (Status === "Optimal") {
        const solution = native.getSolution();
        for (const { name } of bounds) Columns[name] = { Primal: solution.colValue[native.getColByName(name)]! };
      }
      return { Status, Columns };
    });
    solverRuns++;
    options.onProgress?.(`联合因子 MIP 状态=${output.Status}；已检查签名=${excluded.length}；耗时=${Math.round(performance.now() - startedAt)}ms`);
    if (output.Status === "Infeasible") break;
    if (output.Status !== "Optimal") throw new Error(`联合因子 MIP 未证明最优：${output.Status}`);
    validateMipSolution(solveRows, bounds, output.Columns);
    const signature: string[] = [];
    const results: ExactMipResult[] = [];
    let canonicalSharedSelection: readonly EquipInfo[] | undefined;
    let numerator = 0n;
    let denominator = 1n;
    for (let index = 0; index < preparedJobs.length; index++) {
      const { job, prepared } = preparedJobs[index]!;
      const columns = Object.fromEntries(prepared.model.bounds.map(({ name }) =>
        [name, output.Columns[prefix(index, name)] ?? { Primal: 0 }]));
      const selection = slotsForResult(job.options.slots, prepared.model.slotVariables, columns);
      if (index === 0) canonicalSharedSelection = selection;
      else for (const domain of sharedEquipmentDomains) {
        const key = options.equipmentIdentity(canonicalSharedSelection![options.jobs[0]!.slotNames.indexOf(domain.slot)]!);
        selection[job.slotNames.indexOf(domain.slot)] = domain.choices[index]!.get(key)!.equipment;
      }
      const food = foodForResult(job.options.foods, prepared.model.foodVariables, columns);
      const attributes = getAttributeVector(selection, food, job.options.attributeIds, job.options.equipmentAttributeExtractor);
      const factors = prepared.factorEvaluator(attributes);
      const evaluation = job.options.evaluationFunction(attributes);
      if (factors === undefined || evaluation === undefined || !Number.isFinite(evaluation.damage)) {
        throw new Error(`联合因子 MIP 结果无法计算：${job.id}`);
      }
      const fields = { weapon: "weaponDamage", main: "mainStat", det: "determination", ten: "tenacity",
        crt: "critical", dht: "directHit", gcd: "gcdCentiseconds" } as const;
      for (const group of prepared.groups) {
        const chosen = group.classes.find((entry) => (columns[entry.variable]?.Primal ?? 0) > 0.5);
        if (chosen === undefined || factors[fields[group.name as keyof typeof fields]] !== chosen.value) {
          throw new Error(`联合因子 MIP 因子重建不一致：${job.id}/${group.name}`);
        }
        signature.push(prefix(index, chosen.variable));
      }
      for (let attribute = 0; attribute < attributes.length; attribute++) {
        if (attributes[attribute] !== Math.round(columns[prepared.model.finalVariables[attribute]!]!.Primal)) {
          throw new Error(`联合因子 MIP 最终属性重建不一致：${job.id}/${attribute}`);
        }
      }
      const ratioNumerator = exactProduct(factors) * (options.objective === "dps" ? BigInt(job.baseline.gcdCentiseconds) : 1n);
      const ratioDenominator = exactProduct(job.baseline) * (options.objective === "dps" ? BigInt(factors.gcdCentiseconds) : 1n);
      if (ratioNumerator > ratioDenominator) throw new Error(`联合方案超过已证明单职业基线：${job.id}`);
      numerator = numerator * ratioDenominator + ratioNumerator * denominator;
      denominator *= ratioDenominator;
      results.push({ selection, food, damage: evaluation.damage, statistics: {
        elapsedMs: performance.now() - startedAt, solverRuns, excludedSignatures: excluded.length,
        signatureBandChecks: 0, signatureBandElapsedMs: 0, signatureBandProof: false,
        variables: bounds.length, constraints: solveRows.length, maximumSurrogate: 0,
        nextSurrogate: undefined, memoryUsage: process.memoryUsage(),
      } });
    }
    if (best === undefined || numerator * best.denominator > best.numerator * denominator) {
      best = { numerator, denominator, results };
      options.onProgress?.(`联合因子 MIP 当前最优归一化总和=${Number(numerator) / Number(denominator)}`);
    }
    if (best.numerator === BigInt(options.jobs.length) * best.denominator) break;
    excluded.push(signature);
  }
  if (best === undefined) return undefined;
  return { results: best.results, solverRuns, signatures: excluded.length };
}

function validateMipSolution(
  rows: readonly ModelRow[],
  bounds: readonly VariableBounds[],
  columns: Record<string, { Primal: number }>,
): void {
  const integerValues = new Map<string, bigint>();
  for (const bound of bounds) {
    const primal = columns[bound.name]?.Primal;
    const value = primal ?? (bound.min === 0 ? 0 : bound.min === bound.max ? bound.min : undefined);
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error(`HiGHS 最优解缺少变量 ${bound.name}`);
    }
    const rounded = Math.round(value);
    if (!Number.isSafeInteger(rounded) || Math.abs(value - rounded) > 1e-5) {
      throw new Error(`HiGHS 变量 ${bound.name} 不是可靠整数：${value}`);
    }
    if (rounded < bound.min || rounded > bound.max) {
      throw new Error(`HiGHS 变量 ${bound.name} 超出上下界：${rounded}`);
    }
    integerValues.set(bound.name, BigInt(rounded));
  }
  for (const row of rows) {
    let lhs = 0n;
    for (const [name, coefficient] of row.terms) {
      const value = integerValues.get(name);
      if (value === undefined) throw new Error(`模型行 ${row.name} 引用了未知变量 ${name}`);
      lhs += BigInt(coefficient) * value;
    }
    const rhs = BigInt(row.rhs);
    const valid = row.sense === "=" ? lhs === rhs : row.sense === "<=" ? lhs <= rhs : lhs >= rhs;
    if (!valid) {
      throw new Error(`HiGHS 最优解不满足整数模型行 ${row.name}：${lhs} ${row.sense} ${rhs}`);
    }
  }
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
  minimum = 0,
): FactorGroup {
  const values: { value: number; auxiliary?: number }[] = [];
  const firstValue = attributeIndex === undefined ? 0 : minimum;
  for (let value = firstValue; value <= (attributeIndex === undefined ? 0 : maximum); value++) {
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
  const classes = buildFactorClasses(name, values, firstValue);
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
  const rawMinimums = attributeIds.map((_, attribute) =>
    equipmentAttributes.reduce((total, slot) =>
      total + Math.min(...slot.map((values) => values[attribute]!)), 0));
  for (const maximum of rawMaximums) {
    if (!Number.isSafeInteger(maximum) || maximum < 0) {
      throw new RangeError(`装备属性范围不是非负安全整数：${maximum}`);
    }
  }
  for (const minimum of rawMinimums) {
    if (!Number.isSafeInteger(minimum) || minimum < 0) {
      throw new RangeError(`装备属性下界不是非负安全整数：${minimum}`);
    }
  }
  const finalMinimums = attributeIds.map((id, attribute) => {
    if (foods.length === 0) return rawMinimums[attribute]!;
    return Math.min(...foods.map((food) => {
      const param = food.baseParams.find((entry) => entry.baseParamId === id);
      const bonus = param !== undefined && param.maxValue > 0 && param.multiplier > 1
        ? Math.min(param.maxValue, Math.trunc(rawMinimums[attribute]! * (param.multiplier - 1) + 1e-7))
        : 0;
      return rawMinimums[attribute]! + bonus;
    }));
  });

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
    bounds.push({ name: rawVariable, min: rawMinimums[attribute]!, max: rawMaximums[attribute]! });
    bounds.push({ name: finalVariable, min: finalMinimums[attribute]!, max: rawMaximums[attribute]! + Math.max(0, ...foods.map((food) =>
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
  if (constraints.gcdChoices !== undefined) {
    if (constraints.gcdChoices.length === 0) return undefined;
    if (options.gcdToSpeedRange === undefined) throw new RangeError("多个 GCD 搜索需要配置 gcdToSpeedRange");
    if (options.speedAttributeId === undefined) throw new RangeError("多个 GCD 搜索缺少速度属性 id");
    const choices = new Map<string, GcdSpeedRange>();
    for (const gcdChoice of constraints.gcdChoices) {
      if (!Number.isFinite(gcdChoice) || gcdChoice <= 0) {
        throw new RangeError(`GCD 备选值必须为正有限数：${gcdChoice}`);
      }
      const range = options.gcdToSpeedRange(gcdChoice);
      if (range === undefined) continue;
      if (!Number.isSafeInteger(range.min) || !Number.isSafeInteger(range.max) || range.min > range.max) {
        throw new RangeError(`GCD ${gcdChoice} 对应的速度范围无效`);
      }
      choices.set(`${range.min}:${range.max}`, range);
    }
    if (choices.size === 0) return undefined;
    const speedIndex = idToIndex.get(options.speedAttributeId);
    if (speedIndex === undefined) throw new RangeError(`GCD 搜索的速度属性未配置：${options.speedAttributeId}`);
    const choiceVariables: string[] = [];
    const lowerTerms = new Map<string, number>([[finalVariables[speedIndex]!, 1]]);
    const upperTerms = new Map<string, number>([[finalVariables[speedIndex]!, 1]]);
    for (const [index, range] of [...choices.values()].entries()) {
      const variable = `gcd_choice_${index}`;
      choiceVariables.push(variable);
      bounds.push({ name: variable, min: 0, max: 1 });
      binaryVars.push(variable);
      addTerm(lowerTerms, variable, -range.min);
      addTerm(upperTerms, variable, -range.max);
    }
    addRows(rows, "choose_gcd_choice", choiceVariables.map((variable) => [variable, 1] as const), "=", 1);
    addRows(rows, "gcd_choice_speed_min", lowerTerms, ">=", 0);
    addRows(rows, "gcd_choice_speed_max", upperTerms, "<=", 0);
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
    rawMinimums,
    finalMinimums,
    equipmentAttributes,
    foodBonuses,
    idToIndex,
    ranges,
  };
}

async function prepareExactMipModel(
  options: ExactMipOptions,
) {
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
  groups.push(factorGroupsForAttribute("main", mainAttribute, finalMaximums[mainAttribute]!, options.attributeIds.length, factorEvaluator, "mainStat", options.job === "BLU", zeroFactors.weaponDamage, model.finalMinimums[mainAttribute]!));
  groups.push(factorGroupsForAttribute("det", detAttribute, detAttribute === undefined ? 0 : finalMaximums[detAttribute]!, options.attributeIds.length, factorEvaluator, "determination", false, 0, detAttribute === undefined ? 0 : model.finalMinimums[detAttribute]!));
  groups.push(factorGroupsForAttribute("ten", tenAttribute, tenAttribute === undefined ? 0 : finalMaximums[tenAttribute]!, options.attributeIds.length, factorEvaluator, "tenacity", false, 0, tenAttribute === undefined ? 0 : model.finalMinimums[tenAttribute]!));
  groups.push(factorGroupsForAttribute("crt", crtAttribute, crtAttribute === undefined ? 0 : finalMaximums[crtAttribute]!, options.attributeIds.length, factorEvaluator, "critical", false, 0, crtAttribute === undefined ? 0 : model.finalMinimums[crtAttribute]!));
  groups.push(factorGroupsForAttribute("dht", dhtAttribute, dhtAttribute === undefined ? 0 : finalMaximums[dhtAttribute]!, options.attributeIds.length, factorEvaluator, "directHit", false, 0, dhtAttribute === undefined ? 0 : model.finalMinimums[dhtAttribute]!));
  groups.push(factorGroupsForAttribute("gcd", speedAttribute, finalMaximums[speedAttribute]!, options.attributeIds.length, factorEvaluator, "gcdCentiseconds", false, 0, model.finalMinimums[speedAttribute]!));
  const mainFactorGroup = groups[0]!;
  const bluAdditionValues = mainFactorGroup.classes.map((factorClass) => factorClass.auxiliary ?? 0);
  const bluAdditionMinimum = options.job === "BLU" ? Math.min(...bluAdditionValues) : 0;
  const bluAdditionMaximum = options.job === "BLU"
    ? Math.max(...bluAdditionValues)
    : 0;
  // BLU's reference lookup returns zero outside its source table. Keep the
  // complete relative range, including a possible negative delta from INT=0.
  const weaponRelativeMinimum = model.finalMinimums[weaponAttribute]! + bluAdditionMinimum;
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

  const useDps = options.objective === undefined
    ? options.constraints?.gcd === undefined
    : options.objective === "dps";
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

  const secondaryAxes = ([
    ["det", detAttribute], ["ten", tenAttribute], ["crt", crtAttribute],
    ["dht", dhtAttribute], ["gcd", speedAttribute],
  ] as const).filter((entry): entry is readonly ["det" | "ten" | "crt" | "dht" | "gcd", number] => entry[1] !== undefined);
  const foodMaximumBonuses = options.foods.map(() => new Array<number>(options.attributeIds.length).fill(0));
  for (const bonus of model.foodBonuses) {
    const uncapped = BigInt(bonus.maximumRaw) * BigInt(bonus.numerator) / BigInt(bonus.denominator);
    foodMaximumBonuses[bonus.foodIndex]![bonus.attribute] += uncapped >= BigInt(bonus.cap) ? bonus.cap : Number(uncapped);
  }
  // These support inequalities are implied by real gear/food resources. Put
  // them directly on factor selectors to strengthen the integer relaxation.
  for (let mask = 1; mask < 1 << secondaryAxes.length; mask++) {
    const axes = secondaryAxes.filter((_, index) => (mask & (1 << index)) !== 0);
    const gearMaximum = model.equipmentAttributes.reduce((total, slot) => total + Math.max(...slot.map((candidate) =>
      axes.reduce((sum, [, attribute]) => sum + candidate[attribute]!, 0))), 0);
    const foodMaximum = Math.max(0, ...foodMaximumBonuses.map((bonuses) =>
      axes.reduce((sum, [, attribute]) => sum + bonuses[attribute]!, 0)));
    const maximum = gearMaximum + foodMaximum;
    if (!Number.isSafeInteger(maximum)) continue;
    const terms = new Map<string, number>();
    for (const [name] of axes) for (const entry of groups.find((group) => group.name === name)!.classes) {
      addTerm(terms, entry.variable, entry.min);
    }
    addRows(model.rows, `factor_resource_${mask}`, terms, "<=", maximum);
  }
  return { model, groups, factorEvaluator, useDps, qByVariable,
    mainAttribute, detAttribute, tenAttribute, crtAttribute, dhtAttribute, speedAttribute };
}

export async function findBestLoadoutExactMip(
  options: ExactMipOptions,
): Promise<ExactMipResult | undefined> {
  const startedAt = performance.now();
  const maxSearchMs = options.maxSearchMs ?? 110_000;
  if (!Number.isFinite(maxSearchMs) || maxSearchMs <= 0) throw new RangeError("maxSearchMs 必须是正有限值");
  const prepared = await prepareExactMipModel(options);
  if (prepared === undefined) return undefined;
  const { model, groups, factorEvaluator, useDps, qByVariable,
    mainAttribute, detAttribute, tenAttribute, crtAttribute, dhtAttribute, speedAttribute } = prepared;
  const attributeForFactorGroup = new Map<string, number>([
    ["main", mainAttribute],
    ["det", detAttribute ?? -1],
    ["ten", tenAttribute ?? -1],
    ["crt", crtAttribute ?? -1],
    ["dht", dhtAttribute ?? -1],
    ["gcd", speedAttribute],
  ]);
  const speedRange = model.ranges.get(speedAttribute);
  const clippedSpeedRange = (range: GcdSpeedRange): GcdSpeedRange | undefined => {
    const min = Math.max(range.min, speedRange?.min ?? Number.NEGATIVE_INFINITY);
    const max = Math.min(range.max, speedRange?.max ?? Number.POSITIVE_INFINITY);
    return min <= max ? { min, max } : undefined;
  };
  const requestedGcds = options.constraints?.gcdChoices !== undefined
    ? options.constraints.gcdChoices
    : options.constraints?.gcd === undefined
    ? undefined
    : [options.constraints.gcd];
  const scalarGcdRange = options.constraints?.gcd === undefined
    ? undefined
    : options.gcdToSpeedRange?.(options.constraints.gcd);
  const validGcdRanges = requestedGcds?.flatMap((gcdChoice) => {
    const rawRange = options.gcdToSpeedRange?.(gcdChoice);
    if (rawRange === undefined) return [];
    let combined = clippedSpeedRange(rawRange);
    if (combined === undefined) return [];
    if (scalarGcdRange !== undefined) {
      const intersected = clippedSpeedRange({
        min: Math.max(combined.min, scalarGcdRange.min),
        max: Math.min(combined.max, scalarGcdRange.max),
      });
      if (intersected === undefined) return [];
      combined = intersected;
    }
    return [{ centiseconds: Math.round(gcdChoice * 100), range: combined }];
  });
  const intersectsRange = (minimum: number, maximum: number, range: GcdSpeedRange): boolean =>
    maximum >= Math.ceil(range.min) && minimum <= Math.floor(range.max);
  const signatureBandGroups = groups.map((group) => {
    const attribute = attributeForFactorGroup.get(group.name);
    let classes = group.classes;
    if (attribute !== undefined && attribute >= 0) {
      const range = model.ranges.get(attribute);
      if (range !== undefined) {
        classes = classes.filter((factorClass) =>
          intersectsRange(factorClass.min, factorClass.max, {
            min: range.min ?? Number.NEGATIVE_INFINITY,
            max: range.max ?? Number.POSITIVE_INFINITY,
          }));
      }
    }
    if (group.name === "gcd" && validGcdRanges !== undefined) {
      classes = classes.filter((factorClass) => validGcdRanges.some((choice) =>
        factorClass.value === choice.centiseconds &&
        intersectsRange(factorClass.min, factorClass.max, choice.range)));
    }
    // An empty filtered group cannot occur after a feasible initial MIP solve;
    // keep the unfiltered superset if numeric edge cases make it appear empty.
    if (classes.length === 0) classes = group.classes;
    return {
      name: group.name,
      classes: classes.map(({ q, value }) => ({ q, value })),
    };
  });
  const minimumAttributeByGroupAndQ = new Map<string, Map<number, number>>();
  for (const group of groups) {
    const attribute = attributeForFactorGroup.get(group.name);
    if (attribute === undefined || attribute < 0) continue;
    const filteredGroup = signatureBandGroups.find((candidate) => candidate.name === group.name)!;
    const classBySignature = new Map(filteredGroup.classes.map(({ q, value }) => [`${q}:${value}`, true]));
    const minimaByQ = new Map<number, number>();
    for (const factorClass of group.classes) {
      if (!classBySignature.has(`${factorClass.q}:${factorClass.value}`)) continue;
      const previous = minimaByQ.get(factorClass.q);
      if (previous === undefined || factorClass.min < previous) {
        minimaByQ.set(factorClass.q, factorClass.min);
      }
    }
    minimumAttributeByGroupAndQ.set(group.name, minimaByQ);
  }
  const secondaryAttributes = [
    ["det", detAttribute],
    ["ten", tenAttribute],
    ["crt", crtAttribute],
    ["dht", dhtAttribute],
    ["gcd", speedAttribute],
  ] as const;
  const presentSecondaryAttributes = secondaryAttributes.flatMap(([name, attribute]) =>
    attribute === undefined ? [] : [[name, attribute] as const]);
  const maximumFoodBonuses = options.foods.map(() =>
    new Array<number>(options.attributeIds.length).fill(0));
  for (const bonus of model.foodBonuses) {
    const rawBonus = BigInt(bonus.maximumRaw) * BigInt(bonus.numerator) /
      BigInt(bonus.denominator);
    const cappedBonus = rawBonus >= BigInt(bonus.cap) ? bonus.cap : Number(rawBonus);
    maximumFoodBonuses[bonus.foodIndex]![bonus.attribute] += cappedBonus;
  }
  const subsetBudgets: { groups: readonly string[]; maximum: number }[] = [];
  for (let mask = 1; mask < 1 << presentSecondaryAttributes.length; mask++) {
    const included = presentSecondaryAttributes.filter((_, index) => (mask & (1 << index)) !== 0);
    let maximum = 0;
    for (const slot of model.equipmentAttributes) {
      let slotMaximum = Number.NEGATIVE_INFINITY;
      for (const candidate of slot) {
        const contribution = included.reduce((total, [, attribute]) => total + candidate[attribute]!, 0);
        slotMaximum = Math.max(slotMaximum, contribution);
      }
      maximum += slotMaximum;
    }
    let foodMaximum = 0;
    for (let foodIndex = 0; foodIndex < options.foods.length; foodIndex++) {
      const foodContribution = included.reduce((total, [, attribute]) =>
        total + maximumFoodBonuses[foodIndex]![attribute]!, 0);
      foodMaximum = Math.max(foodMaximum, foodContribution);
    }
    maximum += foodMaximum;
    if (Number.isSafeInteger(maximum)) {
      subsetBudgets.push({ groups: included.map(([name]) => name), maximum });
    }
  }
  const isPossiblyFeasibleFactorTuple = (
    signature: readonly { name: string; q: number; value: number }[],
  ): boolean => {
    const qByGroup = new Map(signature.map((factor) => [factor.name, factor.q]));
    for (const budget of subsetBudgets) {
      let minimum = 0;
      for (const name of budget.groups) {
        const q = qByGroup.get(name);
        const attributeMinimum = q === undefined
          ? undefined
          : minimumAttributeByGroupAndQ.get(name)?.get(q);
        // Unknown mappings must retain the tuple; only a complete lower bound can reject it.
        if (attributeMinimum === undefined) {
          minimum = Number.NEGATIVE_INFINITY;
          break;
        }
        minimum += attributeMinimum;
      }
      if (Number.isSafeInteger(minimum) && minimum > budget.maximum) return false;
    }
    return true;
  };
  const excludedSignatures: string[][] = [];
  const toughnessIndex = options.toughnessAttributeId === undefined
    ? undefined
    : model.idToIndex.get(options.toughnessAttributeId);
  if (options.constraints?.maxToughnessMode === true && toughnessIndex === undefined) {
    throw new RangeError("最高坚韧模式需要配置坚韧属性 id");
  }
  const highs = await getHighs();
  let solverRuns = 0;
  const initialStart = greedyMipStart(options, model, useDps, Math.min(startedAt + maxSearchMs, performance.now() + 100));
  let maximumSurrogate = Number.NEGATIVE_INFINITY;
  let nextSurrogate: number | undefined;
  let best: { result: LoadoutSearchResult; factors: IntegerDamageFactors; toughness?: number } | undefined;
  let maximumToughness: number | undefined;
  const solveModel = (
    objective: Map<string, number>,
    phaseName: string,
    minimumSurrogate?: number,
  ) => {
    const remainingMs = maxSearchMs - (performance.now() - startedAt);
    if (remainingMs <= 0) throw new Error("精确 MIP 搜索达到时限，未完成最优性证明");
    const rows = [...model.rows];
    if (minimumSurrogate !== undefined) {
      const maximumOffset = groups.reduce((total, group) =>
        total + Math.max(...group.classes.map((factorClass) => factorClass.q)), 0);
      addRows(
        rows,
        "surrogate_band_cutoff",
        qByVariable,
        ">=",
        minimumSurrogate - maximumOffset,
      );
    }
    excludedSignatures.forEach((signature, index) => {
      addRows(rows, `nogood_${index}`, signature.map((variable) => [variable, 1] as const), "<=", signature.length - 1);
    });
    const text = lpText(phaseName, objective, rows, model.bounds, model.binaryVars, model.generalVars);
    const output = initialStart !== undefined && excludedSignatures.length === 0
      ? highs.withModel({ format: "lp", data: text }, (native) => {
          native.options.set({ output_flag: false, presolve: "on", mip_rel_gap: 0, mip_abs_gap: 0,
            time_limit: Math.max(0.05, remainingMs / 1000) });
          const entries = [...initialStart].map(([name, value]) => [native.getColByName(name), value] as const)
            .sort(([left], [right]) => left - right);
          native.setSolution({ indices: entries.map(([index]) => index), values: entries.map(([, value]) => value) });
          native.run();
          const status = native.getModelStatus();
          const Status = status === highs.constants.modelStatus.optimal ? "Optimal"
            : status === highs.constants.modelStatus.infeasible ? "Infeasible" : `状态代码 ${status}`;
          const Columns: Record<string, { Primal: number }> = {};
          if (Status === "Optimal") {
            const solution = native.getSolution();
            for (const { name } of model.bounds) Columns[name] = { Primal: solution.colValue[native.getColByName(name)]! };
          }
          return { Status, Columns, ObjectiveValue: native.getObjectiveValue() };
        })
      : highs.solve(
      text,
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
    if (output.Status === "Optimal") validateMipSolution(rows, model.bounds, output.Columns);
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
    maximumToughness = maximumTenacity;
    setRange(tenVariable, maximumTenacity, maximumTenacity);
  }

  const objective = new Map<string, number>();
  for (const [variable, coefficient] of qByVariable) addTerm(objective, variable, coefficient);
  let firstSurrogate: number | undefined;
  let signatureBandChecks = 0;
  let signatureBandElapsedMs = 0;
  let signatureBandProof = false;
  let lastSignatureBandIncumbent: string | undefined;
  let lastSignatureBandMayContainBetter = true;
  // The score sums seven rounded log factors. Its rounding error is bounded
  // by the factor count, so signatures below the surrogate optimum by more
  // than this band cannot beat that optimum under exact factor comparison.
  const errorBand = groups.length;
  while (true) {
    if (firstSurrogate !== undefined && best !== undefined) {
      const incumbentKey = [
        best.factors.weaponDamage,
        best.factors.mainStat,
        best.factors.determination,
        best.factors.tenacity,
        best.factors.critical,
        best.factors.directHit,
        best.factors.gcdCentiseconds,
      ].join(":");
      if (incumbentKey !== lastSignatureBandIncumbent) {
        signatureBandChecks++;
        const bandStartedAt = performance.now();
        lastSignatureBandMayContainBetter = hasStrictlyBetterFactorCombination({
          groups: signatureBandGroups,
          objective: useDps ? "dps" : "damage",
          incumbent: best.factors,
          qMinimum: firstSurrogate - errorBand,
          qMaximum: firstSurrogate,
          deadline: () => performance.now() - startedAt >= maxSearchMs,
          isPossiblyFeasible: isPossiblyFeasibleFactorTuple,
        });
        signatureBandElapsedMs += performance.now() - bandStartedAt;
        lastSignatureBandIncumbent = incumbentKey;
      }
      if (performance.now() - startedAt >= maxSearchMs) {
        throw new Error("精确 MIP 搜索达到时限，未完成最优性证明");
      }
      if (!lastSignatureBandMayContainBetter) {
        signatureBandProof = true;
        options.onProgress?.("签名带 BigInt 组合上界证明无更优伤害因子，跳过完整 MIP 带宽可行性求解");
        break;
      }
    }
    const output = firstSurrogate === undefined
      ? solveModel(objective, "exact_damage_initial")
      : solveModel(new Map(), "exact_damage_band_feasibility", firstSurrogate - errorBand);
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
    const rawAttributes = new Array<number>(options.attributeIds.length).fill(0);
    const attributeIndexes = new Map(options.attributeIds.map((id, index) => [id, index]));
    for (const equipment of selection) {
      const params = options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
      for (const param of params) {
        const index = attributeIndexes.get(param.baseParamId);
        if (index !== undefined) rawAttributes[index] += param.value;
      }
    }
    for (let index = 0; index < options.attributeIds.length; index++) {
      const expectedRaw = rawAttributes[index]!;
      const expectedFinal = attributes[index]!;
      const mipRaw = Math.round(output.Columns[model.rawVariables[index]!]?.Primal ?? 0);
      const mipFinal = Math.round(output.Columns[model.finalVariables[index]!]?.Primal ?? 0);
      if (mipRaw !== expectedRaw || mipFinal !== expectedFinal) {
        throw new Error(
          `MIP 属性重建不一致：属性 ${options.attributeIds[index]}，装备=${mipRaw}/${expectedRaw}，含食物=${mipFinal}/${expectedFinal}`,
        );
      }
      const range = model.ranges.get(index);
      if (range !== undefined &&
          ((range.min !== undefined && expectedFinal < range.min) ||
           (range.max !== undefined && expectedFinal > range.max))) {
        throw new Error(`MIP 返回属性 ${options.attributeIds[index]}=${expectedFinal}，不满足约束范围`);
      }
    }
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
    const requestedGcds = options.constraints?.gcdChoices ??
      (options.constraints?.gcd === undefined ? undefined : [options.constraints.gcd]);
    if (requestedGcds !== undefined && !requestedGcds.some((gcdChoice) =>
      Math.round(gcdChoice * 100) === factors.gcdCentiseconds)) {
      throw new Error(`精确 MIP 返回 GCD=${factors.gcdCentiseconds / 100}，不在请求集合 ${requestedGcds.join(", ")} 中`);
    }
    const candidate = { result: { selection, food, damage: evaluation.damage }, factors, toughness: toughnessIndex === undefined ? undefined : attributes[toughnessIndex] };
    if (maximumToughness !== undefined && candidate.toughness !== maximumToughness) {
      throw new Error(`最高坚韧阶段固定值不一致：${candidate.toughness}，预期 ${maximumToughness}`);
    }
    if (best === undefined || betterFactors(factors, best.factors, useDps)) best = candidate;
    if (firstSurrogate === undefined) {
      firstSurrogate = surrogate;
      maximumSurrogate = surrogate;
    } else {
      nextSurrogate = surrogate;
      if (surrogate < firstSurrogate - errorBand) {
        throw new Error("HiGHS 返回了不满足 surrogate 带宽约束的签名");
      }
    }
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
      signatureBandChecks,
      signatureBandElapsedMs,
      signatureBandProof,
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
