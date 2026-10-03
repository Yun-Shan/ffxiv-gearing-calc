import type loadHighs from "highs";
import { gameData } from "../data.ts";
import { getMemoryUsageSnapshot, type MemoryUsageSnapshot } from "./memory-usage.ts";
import { throwIfCancelled } from "./cancellation.ts";
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
  LinearMipRequest,
  LinearMipProgress,
  LinearMipRow,
  LinearMipSolution,
  LinearMipVariable,
} from "./linear-mip.ts";
import type {
  EquipmentAttributeExtractor,
  LoadoutSearchResult,
} from "./search-types.ts";
import type {
  EquipInfo,
  FoodInfo,
  ParamInfo,
  SharedSlotProjection,
} from "./types.ts";
import type { JobId, Stat } from "../types.ts";

type JobLevel = number;

type RowSense = "=" | "<=" | ">=";

type ModelRow = LinearMipRow;
type VariableBounds = LinearMipVariable;

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
  modelPreparationMs?: number;
  greedyMipStartMs?: number;
  solverWallMs?: number;
  otherSearchMs?: number;
  solverRuns: number;
  excludedSignatures: number;
  signatureBandChecks: number;
  signatureBandElapsedMs: number;
  signatureBandProof: boolean;
  variables: number;
  constraints: number;
  maximumSurrogate: number;
  nextSurrogate: number | undefined;
  memoryUsage: MemoryUsageSnapshot;
};

export type ExactMipResult = LoadoutSearchResult & {
  maximumToughness?: number;
  statistics: ExactMipSearchStatistics;
};

export type ExactMipOptions = {
  job: JobId;
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
  onSolverProgress?: (event: LinearMipProgress) => void;
  isCancelled?: () => boolean;
};

const LOG_SCALE = 1_000_000_000_000n;
const FIXED_SCALE = 10n ** 30n;
const LOG_TERMS = 40;
let highsPromise: ReturnType<typeof loadHighs> | undefined;
let linearMipRunSequence = 0;

async function loadHighsRuntime(): ReturnType<typeof loadHighs> {
  const runtimeProcess = (
    globalThis as typeof globalThis & { process?: { versions?: { node?: string } } }
  ).process;
  if (typeof runtimeProcess?.versions?.node !== "string") {
    const { loadBrowserHighs } = await import("./highs-browser.js");
    return loadBrowserHighs();
  }
  const { default: loadHighsInNode } = await import("highs");
  return loadHighsInNode();
}

function getHighs(): ReturnType<typeof loadHighs> {
  if (highsPromise === undefined) {
    highsPromise = loadHighsRuntime().catch((error: unknown) => {
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

function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder < 0n ? quotient - 1n : quotient;
}

function atanhLogFixedBounds(num: bigint, den: bigint): readonly [bigint, bigint] {
  if (num === 0n) return [0n, 0n];
  if (num < 0n || den <= num) throw new RangeError("对数级数参数必须满足 0 <= num < den");
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
}

/** Fixed-point bounds for ln(numerator / denominator), scaled by FIXED_SCALE. */
function logRatioFixedBounds(numerator: bigint, denominator: bigint): readonly [bigint, bigint] {
  if (numerator <= 0n || denominator <= 0n) {
    throw new RangeError("对数有理数的分子和分母必须为正整数");
  }

  let exponent = numerator.toString(2).length - denominator.toString(2).length;
  if (exponent >= 0) {
    if (numerator < (denominator << BigInt(exponent))) exponent--;
  } else if ((numerator << BigInt(-exponent)) < denominator) {
    exponent--;
  }
  const exponentBigInt = BigInt(exponent);
  const mantissaNumerator = exponent >= 0
    ? numerator
    : numerator << BigInt(-exponent);
  const mantissaDenominator = exponent >= 0
    ? denominator << exponentBigInt
    : denominator;
  const [mantissaLower, mantissaUpper] = atanhLogFixedBounds(
    mantissaNumerator - mantissaDenominator,
    mantissaNumerator + mantissaDenominator,
  );
  const [lnTwoLower, lnTwoUpper] = atanhLogFixedBounds(1n, 3n);
  const lower = mantissaLower + (exponent >= 0 ? exponentBigInt * lnTwoLower : exponentBigInt * lnTwoUpper);
  const upper = mantissaUpper + (exponent >= 0 ? exponentBigInt * lnTwoUpper : exponentBigInt * lnTwoLower);
  return [lower, upper];
}

function strictLogThresholdLoss(thresholdNumerator: bigint, denominator: bigint): bigint {
  if (thresholdNumerator <= 0n || thresholdNumerator > denominator) {
    throw new RangeError("联合搜索阈值必须属于 (0, 1]");
  }
  const [lower] = logRatioFixedBounds(thresholdNumerator, denominator);
  // Strict improvement gives integer Qdiff >= floor(L*ln(t))-K+1. The row uses
  // baseline-loss-K, so loss=-ell-1 encodes that strict integer bound.
  const ell = floorDiv(LOG_SCALE * lower, FIXED_SCALE);
  return -ell - 1n;
}

/**
 * Returns round(LOG_SCALE * ln(value)), after proving that the lower and upper
 * fixed-point series bounds round to the same integer.
 */
function roundedLog(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`伤害因子必须是正安全整数：${value}`);
  }
  const [lower, upper] = logRatioFixedBounds(BigInt(value), 1n);
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

async function solveIntegerModel(
  request: LinearMipRequest,
): Promise<LinearMipSolution> {
  request = { ...request, name: `${request.name}#${++linearMipRunSequence}` };

  const profileEnabled = request.onProgress !== undefined && isProfileTimingEnabled();
  const callStartedAt = performance.now();
  const modelNonzeros = request.rows.reduce((sum, row) => sum + row.terms.size, 0);
  if (profileEnabled) emitSolverProfile(request, "highs-call-start", {
    variables: request.variables.length,
    constraints: request.rows.length,
    nonzeros: modelNonzeros,
    objectiveTerms: request.objective.size,
    hintTerms: request.solutionHint?.size ?? 0,
  });
  const highs = await getHighs();
  const highsReadyAt = performance.now();
  const text = lpText(
    request.name,
    request.objective,
    request.rows,
    request.variables,
    request.binaryVariables,
    request.integerVariables,
  );
  const lpReadyAt = performance.now();
  const timeLimit = Math.max(0.05, request.timeLimitMs / 1000);
  const startedAt = performance.now();
  let lastMipCheckpointAt = startedAt;
  let modelReadyMs = 0;
  let nativeRunMs = 0;
  let finalStatus = "unknown";
  const result = await highs.withModel({ format: "lp", data: text }, (native) => {
    modelReadyMs = performance.now() - lpReadyAt;
    native.options.set({ output_flag: false, presolve: "on",
      mip_rel_gap: 0, mip_abs_gap: 0, mip_min_logging_interval: 1, time_limit: timeLimit });
    if (request.solutionHint !== undefined && request.solutionHint.size > 0) {
      const entries = [...request.solutionHint]
        .map(([name, value]) => [native.getColByName(name), value] as const)
        .sort(([left], [right]) => left - right);
      native.setSolution({
        indices: entries.map(([index]) => index),
        values: entries.map(([, value]) => value),
      });
    }
    const callbacks: Parameters<typeof native.run>[0] = {
      [highs.constants.callbackType.mipImprovingSolution]: (event) => {
          emitHighsProgress("incumbent", event.data);
          return undefined;
        },
      [highs.constants.callbackType.mipLogging]: (event) => {
          emitHighsProgress("bound", event.data);
          return undefined;
        },
      [highs.constants.callbackType.mipInterrupt]: (event) => {
          const now = performance.now();
          if (now - lastMipCheckpointAt >= 1000) {
            lastMipCheckpointAt = now;
            emitHighsProgress("bound", event.data);
          }
          return undefined;
        },
    };
    if (profileEnabled) emitSolverProfile(request, "highs-solve-start", {
      getHighsMs: highsReadyAt - callStartedAt,
      lpSerializationMs: lpReadyAt - highsReadyAt,
      modelImportMs: modelReadyMs,
      lpCharacters: text.length,
      variables: request.variables.length,
      constraints: request.rows.length,
      nonzeros: modelNonzeros,
    });
    const nativeStartedAt = performance.now();
    native.run(callbacks);
    nativeRunMs = performance.now() - nativeStartedAt;
    const status = native.getModelStatus();
    const Status = status === highs.constants.modelStatus.optimal ? "Optimal"
      : status === highs.constants.modelStatus.infeasible ? "Infeasible" : `状态代码 ${status}`;
    finalStatus = Status;
    const Columns: Record<string, { Primal: number }> = {};
    if (Status === "Optimal") {
      const solution = native.getSolution();
      for (const { name } of request.variables) {
        Columns[name] = { Primal: solution.colValue[native.getColByName(name)]! };
      }
    }
    return { Status, Columns, ObjectiveValue: native.getObjectiveValue() };
  });
  if (profileEnabled) emitSolverProfile(request, "highs-solve-end", {
    status: finalStatus,
    getHighsMs: highsReadyAt - callStartedAt,
    lpSerializationMs: lpReadyAt - highsReadyAt,
    modelImportMs: modelReadyMs,
    nativeRunMs,
    totalMs: performance.now() - callStartedAt,
    lpCharacters: text.length,
  });
  return result;

  function emitHighsProgress(
    kind: "incumbent" | "bound",
    data: Readonly<Record<string, unknown>>,
  ): void {
    const numeric = (name: string) => {
      const value = data[name];
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    };
    const nodes = data.mip_node_count;
    request.onProgress?.({
      backend: "HiGHS",
      model: request.name,
      kind,
      elapsedMs: numeric("running_time") === undefined
        ? performance.now() - startedAt
        : numeric("running_time")! * 1000,
      ...(numeric("objective_function_value") === undefined ? {} : { objectiveValue: numeric("objective_function_value") }),
      ...(numeric("mip_primal_bound") === undefined ? {} : { objectiveValue: numeric("mip_primal_bound") }),
      ...(numeric("mip_dual_bound") === undefined ? {} : { bestBound: numeric("mip_dual_bound") }),
      ...(numeric("mip_gap") === undefined ? {} : { gap: numeric("mip_gap") }),
      ...(typeof nodes === "bigint" || typeof nodes === "number" ? { nodes: String(nodes) } : {}),
    });
  }
}

function isProfileTimingEnabled(): boolean {
  const runtimeProcess = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  return runtimeProcess?.env?.FFXIV_PROFILE_TIMING === "1";
}

function emitSolverProfile(
  request: LinearMipRequest,
  phase: string,
  fields: Readonly<Record<string, string | number>>,
): void {
  emitProfileEvent(request.onProgress, "HiGHS", request.name, phase, fields);
}

function emitProfileEvent(
  onProgress: ((event: LinearMipProgress) => void) | undefined,
  backend: LinearMipProgress["backend"],
  model: string,
  phase: string,
  fields: Readonly<Record<string, string | number>>,
): void {
  if (!onProgress || !isProfileTimingEnabled()) return;
  onProgress({
    backend,
    model,
    kind: "log",
    message: `PROFILE ${JSON.stringify({ phase, ...fields })}`,
  });
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
        Math.trunc((result[index]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7),
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
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>, useDps: boolean, deadline: number,
  isCancelled: () => boolean): Map<string, number> | undefined {
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
    if (isCancelled() || performance.now() >= deadline) return undefined;
    let changed = false;
    for (let slot = 0; slot < selection.length; slot++) {
      const previous = selection[slot]!;
      let winner = previous;
      for (const candidate of options.slots[slot]!) {
        if ((++checks & 63) === 0 && (isCancelled() || performance.now() >= deadline)) return undefined;
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
      if ((++checks & 63) === 0 && (isCancelled() || performance.now() >= deadline)) return undefined;
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

type RingPairCandidate = EquipInfo & {
  ringEquips: readonly [EquipInfo, EquipInfo];
  ringUniqueByItemId?: readonly (readonly [number, boolean])[];
};

type JointRingSplit = {
  originalSlotIndex: number;
  originalSlotName: string;
  firstSlotIndex: number;
  secondSlotIndex: number;
  firstSlotName: string;
  secondSlotName: string;
  firstCandidates: EquipInfo[];
  secondCandidates: EquipInfo[];
  uniqueItemIds: Set<number>;
  pairByOrderedChildren: Map<string, RingPairCandidate>;
};

type JointPreparedJob = {
  /** Joint-only slot layout; public results are reconstructed from originalJob. */
  job: JointMipJob;
  originalJob: JointMipJob;
  ringSplit?: JointRingSplit;
  prepared: NonNullable<Awaited<ReturnType<typeof prepareExactMipModel>>>;
};

function ringPairCandidate(equipment: EquipInfo): RingPairCandidate | undefined {
  const pair = (equipment as EquipInfo & { ringEquips?: readonly [EquipInfo, EquipInfo] }).ringEquips;
  return !Array.isArray(pair) || pair.length !== 2 || pair[0] === undefined || pair[1] === undefined
    || typeof pair[0] !== "object" || pair[0] === null ||
    typeof pair[1] !== "object" || pair[1] === null
    ? undefined
    : { ...equipment, ringEquips: pair };
}

function hasRingPairProperty(equipment: EquipInfo): boolean {
  return "ringEquips" in equipment;
}

function ringChildStructuralKey(equipment: EquipInfo): string {
  return JSON.stringify({
    itemId: equipment.itemId,
    itemLevel: equipment.itemLevel,
    variantKey: equipment.variantKey,
    key: equipment.key,
    baseParams: equipment.baseParams
      .map(({ baseParamId, value }) => [baseParamId, value] as const)
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]),
    PDMG: equipment.PDMG,
    MDMG: equipment.MDMG,
    DLY: equipment.DLY,
  });
}

function orderedRingChildrenKey(first: string, second: string): string {
  return JSON.stringify([first, second]);
}

function ringPairSharedIdentity(
  equipment: RingPairCandidate,
  equipmentIdentity: (equipment: EquipInfo) => string,
): string {
  return JSON.stringify(equipment.ringEquips.map(equipmentIdentity).sort());
}

function extractedAttributeMap(
  options: ExactMipOptions,
  equipment: EquipInfo,
): Map<number, number> {
  const result = new Map<number, number>();
  const params = options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
  for (const { baseParamId, value } of params) {
    result.set(baseParamId, (result.get(baseParamId) ?? 0) + value);
  }
  return result;
}

function trySplitRingPairDomain(
  job: JointMipJob,
  equipmentIdentity: (equipment: EquipInfo) => string,
): JointRingSplit | undefined {
  if (job.slotNames.length !== job.options.slots.length) return undefined;
  const candidatePairSlots = job.options.slots.flatMap((slot, index) =>
    slot.some(hasRingPairProperty) ? [index] : []);
  if (candidatePairSlots.length !== 1) return undefined;
  const originalSlotIndex = candidatePairSlots[0]!;
  const originalSlotName = job.slotNames[originalSlotIndex];
  const pairSlot = job.options.slots[originalSlotIndex]!;
  if (originalSlotName === undefined || pairSlot.length === 0) return undefined;

  const firstByStructuralKey = new Map<string, EquipInfo>();
  const secondByStructuralKey = new Map<string, EquipInfo>();
  const pairByOrderedChildren = new Map<string, RingPairCandidate>();
  const uniqueByItemId = new Map<number, boolean>();
  const pairCompositionBySharedIdentity = new Map<string, string>();
  for (const equipment of pairSlot) {
    const pair = ringPairCandidate(equipment);
    if (pair === undefined) return undefined;
    const [first, second] = pair.ringEquips;
    const uniquenessMetadata = pair.ringUniqueByItemId;
    if (!Array.isArray(uniquenessMetadata)) return undefined;
    const currentUniqueByItemId = new Map<number, boolean>();
    for (const entry of uniquenessMetadata) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) ||
        typeof entry[1] !== "boolean" || currentUniqueByItemId.has(entry[0])) return undefined;
      currentUniqueByItemId.set(entry[0], entry[1]);
    }
    if ([first, second].some((child) => !Number.isSafeInteger(child.itemId) ||
      !currentUniqueByItemId.has(child.itemId))) return undefined;
    if (uniqueByItemId.size === 0) {
      for (const [itemId, unique] of currentUniqueByItemId) uniqueByItemId.set(itemId, unique);
    } else if (uniqueByItemId.size !== currentUniqueByItemId.size ||
      [...uniqueByItemId].some(([itemId, unique]) => currentUniqueByItemId.get(itemId) !== unique)) {
      return undefined;
    }
    const firstKey = ringChildStructuralKey(first);
    const secondKey = ringChildStructuralKey(second);
    firstByStructuralKey.set(firstKey, first);
    secondByStructuralKey.set(secondKey, second);
    const orderedKey = orderedRingChildrenKey(firstKey, secondKey);
    if (pairByOrderedChildren.has(orderedKey)) return undefined;

    const pairAttributes = extractedAttributeMap(job.options, pair);
    const childAttributes = extractedAttributeMap(job.options, first);
    for (const [attributeId, value] of extractedAttributeMap(job.options, second)) {
      childAttributes.set(attributeId, (childAttributes.get(attributeId) ?? 0) + value);
    }
    for (const attributeId of job.options.attributeIds) {
      if ((pairAttributes.get(attributeId) ?? 0) !== (childAttributes.get(attributeId) ?? 0)) {
        return undefined;
      }
    }
    const compositionCounts = new Map<string, number>();
    for (const child of pair.ringEquips) {
      const identity = equipmentIdentity(child);
      compositionCounts.set(identity, (compositionCounts.get(identity) ?? 0) + 1);
    }
    const sharedIdentity = ringPairSharedIdentity(pair, equipmentIdentity);
    const sharedComposition = JSON.stringify([...compositionCounts].sort(([left], [right]) =>
      left.localeCompare(right)));
    const previousComposition = pairCompositionBySharedIdentity.get(sharedIdentity);
    if (previousComposition !== undefined && previousComposition !== sharedComposition) return undefined;
    pairCompositionBySharedIdentity.set(sharedIdentity, sharedComposition);
    pairByOrderedChildren.set(orderedKey, pair);
  }
  if (firstByStructuralKey.size === 0 || secondByStructuralKey.size === 0) return undefined;

  const expectedPairs = new Set<string>();
  for (const [firstKey, first] of firstByStructuralKey) {
    for (const [secondKey, second] of secondByStructuralKey) {
      if (first.itemId === second.itemId && uniqueByItemId.get(first.itemId) === true) continue;
      expectedPairs.add(orderedRingChildrenKey(firstKey, secondKey));
    }
  }
  if (expectedPairs.size !== pairByOrderedChildren.size ||
    [...expectedPairs].some((key) => !pairByOrderedChildren.has(key))) return undefined;

  let firstSlotName = `__joint_ring_first_${originalSlotIndex}`;
  let secondSlotName = `__joint_ring_second_${originalSlotIndex}`;
  while (job.slotNames.includes(firstSlotName) || job.slotNames.includes(secondSlotName)) {
    firstSlotName = `_${firstSlotName}`;
    secondSlotName = `_${secondSlotName}`;
  }
  const firstSlotIndex = originalSlotIndex;
  const secondSlotIndex = originalSlotIndex + 1;
  return {
    originalSlotIndex,
    originalSlotName,
    firstSlotIndex,
    secondSlotIndex,
    firstSlotName,
    secondSlotName,
    firstCandidates: [...firstByStructuralKey.values()],
    secondCandidates: [...secondByStructuralKey.values()],
    uniqueItemIds: new Set([...uniqueByItemId].flatMap(([itemId, isUnique]) =>
      isUnique ? [itemId] : [])),
    pairByOrderedChildren,
  };
}

function expandJointRingPairDomain(
  job: JointMipJob,
  split: JointRingSplit,
): JointMipJob {
  const slots = [...job.options.slots];
  slots.splice(split.originalSlotIndex, 1, split.firstCandidates, split.secondCandidates);
  const slotNames = [...job.slotNames];
  slotNames.splice(split.originalSlotIndex, 1, split.firstSlotName, split.secondSlotName);
  return {
    ...job,
    slotNames,
    options: { ...job.options, slots },
  };
}

function internalRingSelection(
  job: JointPreparedJob,
  originalSelection: readonly EquipInfo[],
): EquipInfo[] | undefined {
  const split = job.ringSplit;
  if (split === undefined) return [...originalSelection];
  const pair = ringPairCandidate(originalSelection[split.originalSlotIndex]!);
  if (pair === undefined) return undefined;
  const firstKey = ringChildStructuralKey(pair.ringEquips[0]);
  const secondKey = ringChildStructuralKey(pair.ringEquips[1]);
  if (!split.pairByOrderedChildren.has(orderedRingChildrenKey(firstKey, secondKey))) return undefined;
  const result: EquipInfo[] = [];
  for (let index = 0; index < job.job.options.slots.length; index++) {
    if (index === split.firstSlotIndex) result.push(pair.ringEquips[0]);
    else if (index === split.secondSlotIndex) result.push(pair.ringEquips[1]);
    else {
      const originalIndex = index < split.originalSlotIndex ? index : index - 1;
      const selected = originalSelection[originalIndex];
      if (selected === undefined) return undefined;
      result.push(selected);
    }
  }
  return result;
}

function originalRingSelection(
  job: JointPreparedJob,
  internalSelection: readonly EquipInfo[],
): EquipInfo[] {
  const split = job.ringSplit;
  if (split === undefined) return [...internalSelection];
  const first = internalSelection[split.firstSlotIndex];
  const second = internalSelection[split.secondSlotIndex];
  if (first === undefined || second === undefined) throw new Error(`联合 MIP 没有为 ${job.job.id} 重建两枚戒指`);
  const pair = split.pairByOrderedChildren.get(orderedRingChildrenKey(
    ringChildStructuralKey(first), ringChildStructuralKey(second),
  ));
  if (pair === undefined) throw new Error(`联合 MIP 返回了不存在的有序戒指对：${job.job.id}`);
  const result: EquipInfo[] = [];
  for (let index = 0; index < job.originalJob.options.slots.length; index++) {
    if (index === split.originalSlotIndex) result.push(pair);
    else {
      const internalIndex = index < split.originalSlotIndex ? index : index + 1;
      const selected = internalSelection[internalIndex];
      if (selected === undefined) throw new Error(`联合 MIP 结果槽位不完整：${job.job.id}`);
      result.push(selected);
    }
  }
  return result;
}

/** The product is only a necessary upper-bound filter; candidates are ranked by the exact SUM. */
export async function findBestJointFactorMip(options: {
  jobs: readonly JointMipJob[];
  commonSlots: readonly string[];
  commonSlotProjections?: readonly SharedSlotProjection[];
  sharedFood: boolean;
  equipmentIdentity: (equipment: EquipInfo) => string;
  foodIdentity: (food: FoodInfo) => string;
  objective: "damage" | "dps";
  initialResults?: readonly ExactMipResult[];
  maxSearchMs: number;
  onProgress?: (message: string) => void;
  onSolverProgress?: (event: LinearMipProgress) => void;
  isCancelled?: () => boolean;
}): Promise<{ results: ExactMipResult[]; solverRuns: number; signatures: number } | undefined> {
  const startedAt = performance.now();
  const isCancelled = options.isCancelled ?? (() => options.jobs.some((job) => job.options.isCancelled?.() === true));
  const projections = new Map<string, SharedSlotProjection>();
  for (const projection of options.commonSlotProjections ?? []) {
    if (!options.commonSlots.includes(projection.commonSlot) || !projection.slotName ||
      (projection.ringIndex !== 0 && projection.ringIndex !== 1) || projections.has(projection.commonSlot)) {
      throw new RangeError(`联合因子 MIP 的共享槽位投影 ${projection.commonSlot} 无效`);
    }
    projections.set(projection.commonSlot, projection);
  }
  const detectedRingPairs = options.jobs.map((job) => job.options.slots.some((slot) =>
    slot.some(hasRingPairProperty)));
  const ringSplitCandidates = options.jobs.map((job) =>
    trySplitRingPairDomain(job, options.equipmentIdentity));
  let useSplitRings = detectedRingPairs.some(Boolean) &&
    ringSplitCandidates.every((split) => split !== undefined);
  if (useSplitRings) {
    const splitDomains = ringSplitCandidates as JointRingSplit[];
    for (const [commonSlot, projection] of projections) {
      const pointsToPair = splitDomains.some((split) => split.originalSlotName === projection.slotName);
      if (pointsToPair && splitDomains.some((split) => split.originalSlotName !== projection.slotName)) {
        useSplitRings = false;
      }
    }
    for (const commonSlot of options.commonSlots) {
      if (projections.has(commonSlot)) continue;
      const pointsToPair = splitDomains.some((split) => split.originalSlotName === commonSlot);
      if (pointsToPair && splitDomains.some((split) => split.originalSlotName !== commonSlot)) {
        useSplitRings = false;
      }
    }
  }
  const activeRingSplits = useSplitRings
    ? ringSplitCandidates as JointRingSplit[]
    : options.jobs.map(() => undefined);
  const actualSlotName = (commonSlot: string, jobIndex: number) => {
    const projection = projections.get(commonSlot);
    const split = activeRingSplits[jobIndex];
    if (projection !== undefined && split !== undefined && projection.slotName === split.originalSlotName) {
      return projection.ringIndex === 0 ? split.firstSlotName : split.secondSlotName;
    }
    return projection?.slotName ?? commonSlot;
  };
  const projectedEquipment = (equipment: EquipInfo, commonSlot: string, jobIndex: number): EquipInfo => {
    const projection = projections.get(commonSlot);
    if (projection === undefined) return equipment;
    const split = activeRingSplits[jobIndex];
    if (split !== undefined && projection.slotName === split.originalSlotName) return equipment;
    const pair = equipment as EquipInfo & { ringEquips?: readonly [EquipInfo, EquipInfo] };
    const projected = pair.ringEquips?.[projection.ringIndex];
    if (projected === undefined) throw new Error(`共享槽位 ${commonSlot} 缺少完整戒指对候选`);
    return projected;
  };
  const commonEquipmentIdentity = (equipment: EquipInfo, commonSlot: string, jobIndex: number) =>
    options.equipmentIdentity(projectedEquipment(equipment, commonSlot, jobIndex));
  const originalSelectionIdentity = (
    selection: readonly EquipInfo[],
    commonSlot: string,
    jobIndex: number,
  ): string | undefined => {
    const originalJob = options.jobs[jobIndex]!;
    const projection = projections.get(commonSlot);
    const originalSlotName = projection?.slotName ?? commonSlot;
    const slotIndex = originalJob.slotNames.indexOf(originalSlotName);
    const equipment = selection[slotIndex];
    if (slotIndex < 0 || equipment === undefined) return undefined;
    const split = activeRingSplits[jobIndex];
    if (split !== undefined && projection?.slotName === split.originalSlotName) {
      const pair = ringPairCandidate(equipment);
      const child = pair?.ringEquips[projection.ringIndex];
      return child === undefined ? undefined : options.equipmentIdentity(child);
    }
    if (split !== undefined && projection === undefined && commonSlot === split.originalSlotName) {
      const pair = ringPairCandidate(equipment);
      return pair === undefined ? undefined : ringPairSharedIdentity(pair, options.equipmentIdentity);
    }
    return options.equipmentIdentity(projectedEquipment(equipment, commonSlot, jobIndex));
  };
  throwIfCancelled(isCancelled);
  const preparedJobs: JointPreparedJob[] = [];
  const modelPreparationStartedAt = performance.now();
  for (let jobIndex = 0; jobIndex < options.jobs.length; jobIndex++) {
    throwIfCancelled(isCancelled);
    const originalJob = options.jobs[jobIndex]!;
    const ringSplit = activeRingSplits[jobIndex];
    const job = ringSplit === undefined
      ? originalJob
      : expandJointRingPairDomain(originalJob, ringSplit);
    const prepared = await prepareExactMipModel({ ...job.options, objective: options.objective });
    throwIfCancelled(isCancelled);
    if (prepared === undefined) return undefined;
    preparedJobs.push({ job, originalJob, ...(ringSplit === undefined ? {} : { ringSplit }), prepared });
  }
  const modelPreparationMs = performance.now() - modelPreparationStartedAt;
  const modelAssemblyStartedAt = performance.now();
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
    const { job, ringSplit, prepared } = preparedJobs[index]!;
    const { model, groups, qByVariable } = prepared;
    for (const row of model.rows) rows.push({ ...row, name: prefix(index, row.name),
      terms: new Map([...row.terms].map(([name, value]) => [prefix(index, name), value])) });
    if (ringSplit !== undefined) {
      for (const itemId of ringSplit.uniqueItemIds) {
        const terms = new Map<string, number>();
        for (const slotIndex of [ringSplit.firstSlotIndex, ringSplit.secondSlotIndex]) {
          job.options.slots[slotIndex]!.forEach((candidate, candidateIndex) => {
            if (candidate.itemId === itemId) {
              addTerm(terms, prefix(index, model.slotVariables[slotIndex]![candidateIndex]!), 1);
            }
          });
        }
        addRows(rows, prefix(index, `ring_unique_${itemId}`), terms, "<=", 1);
      }
    }
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
    if (keys.length === 0) return undefined;
    const selectors = new Map<string, string>();
    for (let choiceIndex = 0; choiceIndex < keys.length; choiceIndex++) {
      const key = keys[choiceIndex]!;
      const selector = `shared_${name}_${choiceIndex}`;
      bounds.push({ name: selector, min: 0, max: 1 });
      binaries.push(selector);
      selectors.set(key, selector);
      for (let jobIndex = 0; jobIndex < choices.length; jobIndex++) {
        const terms = new Map<string, number>([[selector, -1]]);
        for (const variable of choices[jobIndex]!.get(key)!) addTerm(terms, variable, 1);
        addRows(rows, `link_${name}_${choiceIndex}_${jobIndex}`, terms, "=", 0);
      }
    }
    addRows(rows, `shared_one_${name}`, [...selectors.values()].map((selector) => [selector, 1] as const), "=", 1);
    // Choices absent from the intersection must be disabled explicitly.
    const allowed = new Set(keys);
    choices.forEach((choice, jobIndex) => {
      for (const [key, variables] of choice) if (!allowed.has(key)) {
        addRows(rows, `shared_absent_${name}_${jobIndex}_${rows.length}`,
          variables.map((variable) => [variable, 1] as const), "=", 0);
      }
    });
    return selectors;
  };
  type SharedEquipmentEntry = {
    equipment: EquipInfo;
    variables: string[];
    childIdentityCounts?: Map<string, number>;
  };
  type SharedEquipmentDomain = {
    slot: string;
    choices: Map<string, SharedEquipmentEntry>[];
    keys: Set<string>;
    splitPair?: boolean;
  };
  const sharedEquipmentDomains: SharedEquipmentDomain[] = options.commonSlots.map((slot) => {
    const pairSplits = preparedJobs.map(({ ringSplit }) => {
      const projection = projections.get(slot);
      return projection === undefined && ringSplit !== undefined && ringSplit.originalSlotName === slot
        ? ringSplit
        : undefined;
    });
    const splitPair = pairSplits.length > 0 && pairSplits.every((split) => split !== undefined);
    if (splitPair) {
      const choices = preparedJobs.map(({ originalJob }, jobIndex) => {
        const split = pairSplits[jobIndex]!;
        const byKey = new Map<string, SharedEquipmentEntry>();
        for (const equipment of originalJob.options.slots[split.originalSlotIndex]!) {
          const pair = ringPairCandidate(equipment);
          if (pair === undefined) throw new Error(`共享槽位 ${slot} 包含非戒指对候选`);
          const key = ringPairSharedIdentity(pair, options.equipmentIdentity);
          const childIdentityCounts = new Map<string, number>();
          for (const child of pair.ringEquips) {
            const identity = options.equipmentIdentity(child);
            childIdentityCounts.set(identity, (childIdentityCounts.get(identity) ?? 0) + 1);
          }
          if (!byKey.has(key)) byKey.set(key, { equipment: pair, variables: [], childIdentityCounts });
        }
        return byKey;
      });
      const keys = new Set([...choices[0]!.keys()].filter((key) => choices.every((choice) => choice.has(key))));
      return { slot, choices, keys, splitPair: true };
    }

    const choices = preparedJobs.map(({ job, prepared }, jobIndex) => {
      const slotIndex = job.slotNames.indexOf(actualSlotName(slot, jobIndex));
      if (slotIndex < 0) throw new Error(`共享槽位 ${slot} 不存在于 ${job.id}`);
      const byKey = new Map<string, SharedEquipmentEntry>();
      job.options.slots[slotIndex]!.forEach((equipment, candidateIndex) => {
        const projected = projectedEquipment(equipment, slot, jobIndex);
        const key = options.equipmentIdentity(projected);
        const entry: SharedEquipmentEntry = byKey.get(key) ?? { equipment: projected, variables: [] };
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
  const sharedEquipmentSelectors = new Map<string, Map<string, string>>();
  for (const domain of sharedEquipmentDomains) {
    let selectors: Map<string, string> | undefined;
    if (domain.splitPair) {
      selectors = new Map();
      const keys = [...domain.keys];
      for (let choiceIndex = 0; choiceIndex < keys.length; choiceIndex++) {
        const key = keys[choiceIndex]!;
        const selector = `shared_equipment_${domain.slot}_${choiceIndex}`;
        bounds.push({ name: selector, min: 0, max: 1 });
        binaries.push(selector);
        selectors.set(key, selector);
        domain.choices.forEach((choice) => choice.get(key)!.variables.push(selector));
      }
      addRows(rows, `shared_one_equipment_${domain.slot}`,
        [...selectors.values()].map((selector) => [selector, 1] as const), "=", 1);
      for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
        const { job, ringSplit, prepared } = preparedJobs[jobIndex]!;
        if (ringSplit === undefined) throw new Error(`共享戒指对槽 ${domain.slot} 缺少拆分模型`);
        const childIdentities = new Set<string>();
        for (const slotIndex of [ringSplit.firstSlotIndex, ringSplit.secondSlotIndex]) {
          job.options.slots[slotIndex]!.forEach((candidate) =>
            childIdentities.add(options.equipmentIdentity(candidate)));
        }
        for (const childIdentity of childIdentities) {
          const terms = new Map<string, number>();
          for (const slotIndex of [ringSplit.firstSlotIndex, ringSplit.secondSlotIndex]) {
            job.options.slots[slotIndex]!.forEach((candidate, candidateIndex) => {
              if (options.equipmentIdentity(candidate) === childIdentity) {
                addTerm(terms, prefix(jobIndex, prepared.model.slotVariables[slotIndex]![candidateIndex]!), 1);
              }
            });
          }
          for (const key of domain.keys) {
            const count = domain.choices[jobIndex]!.get(key)!.childIdentityCounts?.get(childIdentity) ?? 0;
            if (count > 0) addTerm(terms, selectors.get(key)!, -count);
          }
          addRows(rows, `link_equipment_${domain.slot}_${jobIndex}_${rows.length}`, terms, "=", 0);
        }
      }
    } else {
      const choices = domain.choices.map((choice) => new Map(
        [...choice].map(([key, entry]) => [key, entry.variables] as const),
      ));
      selectors = linkChoices(`equipment_${domain.slot}`, choices);
    }
    if (selectors === undefined) return undefined;
    sharedEquipmentSelectors.set(domain.slot, selectors);
  }
  // Keep a universal attribute profile: it includes EVERY job's extractor and
  // attribute coordinates. A single projected ring is shared by its full
  // physical identity while the other ring remains free inside each complete,
  // unique-legal pair candidate.
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
  let sharedFoodSelectors: Map<string, string> | undefined;
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
    sharedFoodSelectors = linkChoices("food", choices);
    if (sharedFoodSelectors === undefined) return undefined;
  }

  type ExactRatio = { numerator: bigint; denominator: bigint };
  type FixedSharedChoice =
    | { kind: "equipment"; commonSlot: string; key: string }
    | { kind: "food"; key: string };
  type FixedEquipmentChoice = Extract<FixedSharedChoice, { kind: "equipment" }>;
  type SharedKeyDomain = {
    kind: FixedSharedChoice["kind"];
    name: string;
    selectors: Map<string, string>;
  };
  const sharedKeyDomains: SharedKeyDomain[] = [
    ...sharedEquipmentDomains.map((domain) => ({
      kind: "equipment" as const,
      name: domain.slot,
      selectors: sharedEquipmentSelectors.get(domain.slot)!,
    })),
    ...(sharedFoodSelectors === undefined ? [] : [{
      kind: "food" as const,
      name: "food",
      selectors: sharedFoodSelectors,
    }]),
  ];
  const sharedBoundPreprocessingStartedAt = performance.now();
  const gearSlotMaximums = preparedJobs.map(({ job, prepared }) => job.options.slots.map((slot, slotIndex) => {
    const maximums = new Array<number>(job.options.attributeIds.length).fill(0);
    for (let candidateIndex = 0; candidateIndex < slot.length; candidateIndex++) {
      for (let attribute = 0; attribute < maximums.length; attribute++) {
        maximums[attribute] = Math.max(maximums[attribute]!,
          prepared.model.equipmentAttributes[slotIndex]![candidateIndex]![attribute]!);
      }
    }
    return maximums;
  }));
  const gearKeySlotMaximums = new Map<string, Map<string, number[]>[]>();
  for (const domain of sharedEquipmentDomains) {
    const selectorKeys = new Set(sharedEquipmentSelectors.get(domain.slot)!.keys());
    const perJob = preparedJobs.map(({ job, originalJob, ringSplit, prepared }, jobIndex) => {
      const maximumsByKey = new Map([...selectorKeys].map((key) =>
        [key, new Array<number>(job.options.attributeIds.length).fill(0)]));
      if (domain.splitPair) {
        if (ringSplit === undefined) return maximumsByKey;
        for (const candidate of originalJob.options.slots[ringSplit.originalSlotIndex]!) {
          const pair = ringPairCandidate(candidate);
          if (pair === undefined) continue;
          const key = ringPairSharedIdentity(pair, options.equipmentIdentity);
          const maximums = maximumsByKey.get(key);
          if (maximums === undefined) continue;
          const attributes = extractedAttributeMap(job.options, pair);
          for (let attribute = 0; attribute < maximums.length; attribute++) {
            const attributeId = job.options.attributeIds[attribute]!;
            maximums[attribute] = Math.max(maximums[attribute]!, attributes.get(attributeId) ?? 0);
          }
        }
        return maximumsByKey;
      }
      const slotIndex = job.slotNames.indexOf(actualSlotName(domain.slot, jobIndex));
      if (slotIndex < 0) return maximumsByKey;
      const slot = job.options.slots[slotIndex]!;
      for (let candidateIndex = 0; candidateIndex < slot.length; candidateIndex++) {
        const key = commonEquipmentIdentity(slot[candidateIndex]!, domain.slot, jobIndex);
        const maximums = maximumsByKey.get(key);
        if (maximums === undefined) continue;
        for (let attribute = 0; attribute < maximums.length; attribute++) {
          maximums[attribute] = Math.max(maximums[attribute]!,
            prepared.model.equipmentAttributes[slotIndex]![candidateIndex]![attribute]!);
        }
      }
      return maximumsByKey;
    });
    gearKeySlotMaximums.set(domain.slot, perJob);
  }
  const coordinateUpperAttributes = (
    jobIndex: number,
    fixedChoices: readonly FixedSharedChoice[],
  ): number[] | undefined => {
    const { job, prepared } = preparedJobs[jobIndex]!;
    const rawUpper = new Array<number>(job.options.attributeIds.length).fill(0);
    const fixedEquipmentBySlot = new Map<number, FixedEquipmentChoice[]>();
    const fixedPairChoices: FixedEquipmentChoice[] = [];
    let fixedFoodKey: string | undefined;
    for (const choice of fixedChoices) {
      if (choice.kind === "food") {
        if (fixedFoodKey !== undefined) return undefined;
        fixedFoodKey = choice.key;
        continue;
      }
      const pairDomain = sharedEquipmentDomains.find((domain) =>
        domain.slot === choice.commonSlot && domain.splitPair);
      if (pairDomain !== undefined) {
        fixedPairChoices.push(choice);
        continue;
      }
      const slotIndex = job.slotNames.indexOf(actualSlotName(choice.commonSlot, jobIndex));
      if (slotIndex < 0) return undefined;
      const restrictions = fixedEquipmentBySlot.get(slotIndex) ?? [];
      restrictions.push(choice);
      fixedEquipmentBySlot.set(slotIndex, restrictions);
    }
    for (let slotIndex = 0; slotIndex < job.options.slots.length; slotIndex++) {
      const candidates = job.options.slots[slotIndex]!;
      const ringSplit = preparedJobs[jobIndex]!.ringSplit;
      const fixedPair = fixedPairChoices[0];
      if (ringSplit !== undefined && fixedPair !== undefined &&
        (slotIndex === ringSplit.firstSlotIndex || slotIndex === ringSplit.secondSlotIndex)) {
        if (slotIndex === ringSplit.firstSlotIndex) {
          const maximums = gearKeySlotMaximums.get(fixedPair.commonSlot)?.[jobIndex]?.get(fixedPair.key);
          if (maximums === undefined) return undefined;
          for (let attribute = 0; attribute < rawUpper.length; attribute++) {
            rawUpper[attribute] += maximums[attribute]!;
          }
        }
        continue;
      }
      const restrictions = fixedEquipmentBySlot.get(slotIndex);
      if (restrictions === undefined) {
        for (let attribute = 0; attribute < rawUpper.length; attribute++) {
          rawUpper[attribute] += gearSlotMaximums[jobIndex]![slotIndex]![attribute]!;
        }
        continue;
      }
      if (restrictions.length === 1) {
        const restriction = restrictions[0]!;
        const maximums = gearKeySlotMaximums.get(restriction.commonSlot)?.[jobIndex]?.get(restriction.key);
        if (maximums === undefined) return undefined;
        for (let attribute = 0; attribute < rawUpper.length; attribute++) rawUpper[attribute] += maximums[attribute]!;
        continue;
      }
      // Two projections can refer to the same complete Finger pair. Intersect
      // both identities against legal pair candidates before taking pair sums.
      const coordinateMaximums = new Array<number>(rawUpper.length).fill(0);
      let foundCandidate = false;
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
        const equipment = candidates[candidateIndex]!;
        if (restrictions.some((restriction) =>
          commonEquipmentIdentity(equipment, restriction.commonSlot, jobIndex) !== restriction.key)) continue;
        foundCandidate = true;
        for (let attribute = 0; attribute < rawUpper.length; attribute++) {
          coordinateMaximums[attribute] = Math.max(coordinateMaximums[attribute]!,
            prepared.model.equipmentAttributes[slotIndex]![candidateIndex]![attribute]!);
        }
      }
      if (!foundCandidate) return undefined;
      for (let attribute = 0; attribute < rawUpper.length; attribute++) rawUpper[attribute] += coordinateMaximums[attribute]!;
    }

    // A single food is chosen. For each coordinate independently, retain the
    // largest exact, capped bonus among foods allowed by the fixed food key.
    const foodBonuses = new Array<number>(rawUpper.length).fill(0);
    for (const bonus of prepared.model.foodBonuses) {
      const food = job.options.foods[bonus.foodIndex];
      if (food === undefined || (fixedFoodKey !== undefined && options.foodIdentity(food) !== fixedFoodKey)) continue;
      const param = food.baseParams.find((entry) => entry.baseParamId === job.options.attributeIds[bonus.attribute]);
      if (param === undefined || !Number.isSafeInteger(param.baseValue ?? 0) ||
        !Number.isSafeInteger(bonus.numerator) || !Number.isSafeInteger(bonus.denominator)) return undefined;
      const rawWithBase = BigInt(rawUpper[bonus.attribute]!) + BigInt(param.baseValue ?? 0);
      if (rawWithBase < 0n) return undefined;
      const uncapped = BigInt(bonus.numerator) * rawWithBase / BigInt(bonus.denominator);
      const capped = uncapped >= BigInt(bonus.cap) ? bonus.cap : Number(uncapped);
      foodBonuses[bonus.attribute] = Math.max(foodBonuses[bonus.attribute]!, capped);
    }
    return rawUpper.map((value, attribute) => value + foodBonuses[attribute]!);
  };
  const exactUpperRatio = (jobIndex: number, attributes: readonly number[]): ExactRatio | undefined => {
    const { job, prepared } = preparedJobs[jobIndex]!;
    const factors = prepared.factorEvaluator(attributes);
    if (factors === undefined || factors.gcdCentiseconds <= 0) return undefined;
    return {
      numerator: exactProduct(factors) * (options.objective === "dps" ? BigInt(job.baseline.gcdCentiseconds) : 1n),
      denominator: exactProduct(job.baseline) * (options.objective === "dps" ? BigInt(factors.gcdCentiseconds) : 1n),
    };
  };
  type FactorClassUpperBound = {
    jobIndex: number;
    variable: string;
    rowName: string;
    ratio: ExactRatio;
  };
  const factorClassUpperBounds: FactorClassUpperBound[] = [];
  for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
    const { job, prepared } = preparedJobs[jobIndex]!;
    const damageGroups = prepared.groups.filter((group) => group.name !== "gcd");
    const gcdGroup = prepared.groups.find((group) => group.name === "gcd");
    const maximumByGroup = new Map<FactorGroup, bigint>();
    let validDomain = damageGroups.length > 0 && exactProduct(job.baseline) > 0n;
    for (const group of damageGroups) {
      if (group.classes.length === 0 || group.classes.some((factorClass) =>
        !Number.isSafeInteger(factorClass.value) || factorClass.value <= 0)) {
        validDomain = false;
        break;
      }
      maximumByGroup.set(group, BigInt(Math.max(...group.classes.map((factorClass) => factorClass.value))));
    }
    let minimumGcd: bigint | undefined;
    if (options.objective === "dps") {
      if (gcdGroup === undefined || gcdGroup.classes.length === 0 || gcdGroup.classes.some((factorClass) =>
        !Number.isSafeInteger(factorClass.value) || factorClass.value <= 0) ||
        !Number.isSafeInteger(job.baseline.gcdCentiseconds) || job.baseline.gcdCentiseconds <= 0) {
        validDomain = false;
      } else {
        minimumGcd = BigInt(Math.min(...gcdGroup.classes.map((factorClass) => factorClass.value)));
      }
    }
    if (!validDomain) continue;
    const baselineProduct = exactProduct(job.baseline);
    const baselineGcd = options.objective === "dps" ? BigInt(job.baseline.gcdCentiseconds) : 1n;
    for (const group of damageGroups) {
      for (let classIndex = 0; classIndex < group.classes.length; classIndex++) {
        const factorClass = group.classes[classIndex]!;
        const otherMaximumProduct = damageGroups.reduce((product, otherGroup) =>
          otherGroup === group ? product : product * maximumByGroup.get(otherGroup)!, 1n);
        const ratio: ExactRatio = {
          numerator: otherMaximumProduct * BigInt(factorClass.value) * baselineGcd,
          denominator: baselineProduct * (minimumGcd ?? 1n),
        };
        factorClassUpperBounds.push({
          jobIndex,
          variable: factorClass.variable,
          rowName: `joint_necessary_class_${jobIndex}_${group.name}_${classIndex}`,
          ratio,
        });
      }
    }
    if (options.objective === "dps" && gcdGroup !== undefined) {
      const maximumDamageProduct = damageGroups.reduce((product, group) =>
        product * maximumByGroup.get(group)!, 1n);
      for (let classIndex = 0; classIndex < gcdGroup.classes.length; classIndex++) {
        const factorClass = gcdGroup.classes[classIndex]!;
        factorClassUpperBounds.push({
          jobIndex,
          variable: factorClass.variable,
          rowName: `joint_necessary_class_${jobIndex}_gcd_${classIndex}`,
          ratio: {
            numerator: maximumDamageProduct * baselineGcd,
            denominator: baselineProduct * BigInt(factorClass.value),
          },
        });
      }
    }
  }
  const sharedEquipmentUpperBounds = sharedEquipmentDomains.flatMap((domain, domainIndex) => {
    const selectors = sharedEquipmentSelectors.get(domain.slot)!;
    return [...selectors].map(([key, selector], choiceIndex) => ({
      selector,
      key,
      fixedChoice: { kind: "equipment" as const, commonSlot: domain.slot, key },
      rowName: `joint_shared_equipment_bound_${domainIndex}_${choiceIndex}`,
      jobRatios: preparedJobs.map((_, jobIndex) => {
        const attributes = coordinateUpperAttributes(jobIndex, [{ kind: "equipment", commonSlot: domain.slot, key }]);
        return attributes === undefined ? undefined : exactUpperRatio(jobIndex, attributes);
      }),
    }));
  });
  const sharedFoodUpperBounds = sharedFoodSelectors === undefined ? [] : [...sharedFoodSelectors].map(
    ([key, selector], choiceIndex) => ({
      selector,
      key,
      fixedChoice: { kind: "food" as const, key },
      rowName: `joint_shared_food_bound_${choiceIndex}`,
      jobRatios: preparedJobs.map((_, jobIndex) => {
        const attributes = coordinateUpperAttributes(jobIndex, [{ kind: "food", key }]);
        return attributes === undefined ? undefined : exactUpperRatio(jobIndex, attributes);
      }),
    }),
  );
  type SharedPairUpperBound = {
    selectorA: string;
    selectorB: string;
    rowName: string;
    ratio: ExactRatio;
  };
  const sharedPairCandidateUpperBound = sharedKeyDomains.reduce((total, domain, index) => {
    for (let other = index + 1; other < sharedKeyDomains.length; other++) {
      total += BigInt(domain.selectors.size) * BigInt(sharedKeyDomains[other]!.selectors.size);
    }
    return total;
  }, 0n);
  const sharedPairCandidateLimit = 20_000n;
  let sharedPairCandidateCount = 0;
  let sharedPairCandidatesEvaluated = 0;
  let sharedPairPreprocessingMs = performance.now() - sharedBoundPreprocessingStartedAt;
  let sharedPairPreprocessingSkipped = false;
  let sharedPairUpperBounds: SharedPairUpperBound[] | undefined;
  const sharedPairConflictRows = new Set<string>();
  const factorClassConflictRows = new Set<string>();
  const ratioAtOrBelowThreshold = (ratio: ExactRatio, numerator: bigint, denominator: bigint) =>
    ratio.numerator * denominator <= ratio.denominator * numerator;
  const cannotBeatThreshold = (
    ratios: readonly (ExactRatio | undefined)[],
    numerator: bigint,
    denominator: bigint,
  ) => ratios.some((ratio) => ratio !== undefined && ratioAtOrBelowThreshold(ratio, numerator, denominator));
  const prepareSharedPairUpperBounds = (thresholdNumerator: bigint, thresholdDenominator: bigint) => {
    if (sharedPairUpperBounds !== undefined || thresholdNumerator <= 0n) return;
    const preprocessingStartedAt = performance.now();
    const singleKeyBoundsBySelector = new Map(
      [...sharedEquipmentUpperBounds, ...sharedFoodUpperBounds].map((bound) => [bound.selector, bound]),
    );
    const choicesByDomain = sharedKeyDomains.map((domain) => [...domain.selectors].flatMap(([key, selector]) => {
      const singleKeyBound = singleKeyBoundsBySelector.get(selector);
      if (singleKeyBound !== undefined && cannotBeatThreshold(
        singleKeyBound.jobRatios, thresholdNumerator, thresholdDenominator,
      )) return [];
      const fixedChoice: FixedSharedChoice = domain.kind === "equipment"
        ? { kind: "equipment", commonSlot: domain.name, key }
        : { kind: "food", key };
      return [{ key, selector, fixedChoice }];
    }));
    let candidateCount = 0n;
    for (let domainIndex = 0; domainIndex < choicesByDomain.length; domainIndex++) {
      for (let other = domainIndex + 1; other < choicesByDomain.length; other++) {
        candidateCount += BigInt(choicesByDomain[domainIndex]!.length) * BigInt(choicesByDomain[other]!.length);
      }
    }
    sharedPairCandidateCount = candidateCount > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(candidateCount);
    sharedPairPreprocessingSkipped = candidateCount > sharedPairCandidateLimit;
    const pairBounds: SharedPairUpperBound[] = [];
    if (!sharedPairPreprocessingSkipped) {
      for (let domainIndex = 0; domainIndex < choicesByDomain.length; domainIndex++) {
        for (let other = domainIndex + 1; other < choicesByDomain.length; other++) {
          for (const choiceA of choicesByDomain[domainIndex]!) {
            for (const choiceB of choicesByDomain[other]!) {
              sharedPairCandidatesEvaluated++;
              const jobRatios = preparedJobs.map((_, jobIndex) => {
                const attributes = coordinateUpperAttributes(jobIndex, [choiceA.fixedChoice, choiceB.fixedChoice]);
                return attributes === undefined ? undefined : exactUpperRatio(jobIndex, attributes);
              });
              if (jobRatios.some((ratio) => ratio === undefined)) continue;
              const firstRatio = jobRatios[0];
              if (firstRatio === undefined) continue;
              let minimumRatio: ExactRatio = firstRatio;
              for (let jobIndex = 1; jobIndex < jobRatios.length; jobIndex++) {
                const current = jobRatios[jobIndex];
                if (current !== undefined &&
                  current.numerator * minimumRatio.denominator < minimumRatio.numerator * current.denominator) {
                  minimumRatio = current;
                }
              }
              pairBounds.push({
                selectorA: choiceA.selector,
                selectorB: choiceB.selector,
                rowName: `joint_shared_pair_bound_${domainIndex}_${other}_${sharedPairCandidatesEvaluated - 1}`,
                ratio: minimumRatio,
              });
            }
          }
        }
      }
    }
    sharedPairUpperBounds = pairBounds;
    sharedPairPreprocessingMs += performance.now() - preprocessingStartedAt;
  };
  throwIfCancelled(isCancelled);
  const excluded: string[][] = [];
  let solverRuns = 0;
  let best: { numerator: bigint; denominator: bigint; results: ExactMipResult[] } | undefined;
  if (options.initialResults !== undefined) {
    if (options.initialResults.length !== preparedJobs.length) throw new Error("联合初始方案职业数不匹配");
    let numerator = 0n;
    let denominator = 1n;
    for (let index = 0; index < preparedJobs.length; index++) {
      const jointJob = preparedJobs[index]!;
      const { job, prepared } = jointJob;
      const result = options.initialResults[index]!;
      const modelSelection = internalRingSelection(jointJob, result.selection);
      if (modelSelection === undefined || modelSelection.length !== job.options.slots.length ||
        modelSelection.some((equipment, slot) => !job.options.slots[slot]!.some((candidate) =>
          jointJob.ringSplit !== undefined &&
          (slot === jointJob.ringSplit.firstSlotIndex || slot === jointJob.ringSplit.secondSlotIndex)
            ? ringChildStructuralKey(candidate) === ringChildStructuralKey(equipment)
            : options.equipmentIdentity(candidate) === options.equipmentIdentity(equipment)))) {
        throw new Error("联合初始方案装备不属于模型候选");
      }
      if (result.food === undefined ? job.options.foods.length > 0 :
        !job.options.foods.some((food) => options.foodIdentity(food) === options.foodIdentity(result.food!))) {
        throw new Error("联合初始方案食物不属于模型候选");
      }
      const attributes = getAttributeVector(modelSelection, result.food, job.options.attributeIds, job.options.equipmentAttributeExtractor);
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
        const currentIdentity = originalSelectionIdentity(result.selection, slot, index);
        const firstIdentity = originalSelectionIdentity(options.initialResults[0]!.selection, slot, 0);
        if (currentIdentity === undefined || firstIdentity === undefined || currentIdentity !== firstIdentity) {
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
  if (best !== undefined) {
    const thresholdNumerator = best.numerator - BigInt(options.jobs.length - 1) * best.denominator;
    if (thresholdNumerator > 0n) prepareSharedPairUpperBounds(thresholdNumerator, best.denominator);
  }
  const modelAssemblyMs = performance.now() - modelAssemblyStartedAt;
  const profileBackend = "HiGHS";
  if (options.onSolverProgress !== undefined) emitProfileEvent(
    options.onSolverProgress,
    profileBackend,
    "joint_factor_product",
    "joint-model-ready",
    {
      modelPreparationMs,
      modelAssemblyMs,
      variables: bounds.length,
      constraints: rows.length,
      nonzeros: rows.reduce((sum, row) => sum + row.terms.size, 0),
      objectiveTerms: objective.size,
      factorGroups: groupCount,
      factorClasses: preparedJobs.reduce((sum, { prepared }) =>
        sum + prepared.groups.reduce((groupSum, group) => groupSum + group.classes.length, 0), 0),
      sharedPairCandidateUpperBound: sharedPairCandidateUpperBound.toString(),
      sharedPairCandidateCount,
      sharedPairCandidatesEvaluated,
      sharedPairPreprocessingMs,
      sharedPairPreprocessingSkipped: Number(sharedPairPreprocessingSkipped),
      factorClassUpperBoundCount: factorClassUpperBounds.length,
    },
  );
  let solverWallMs = 0;
  let iterationModelBuildMs = 0;
  let postSolveMs = 0;
  while (true) {
    throwIfCancelled(isCancelled);
    if (best !== undefined) {
      const thresholdNumerator = best.numerator - BigInt(options.jobs.length - 1) * best.denominator;
      if (thresholdNumerator > 0n) prepareSharedPairUpperBounds(thresholdNumerator, best.denominator);
    }
    const remaining = options.maxSearchMs - (performance.now() - startedAt);
    if (remaining <= 0) throw new Error("联合因子 MIP 达到时限，未完成最优性复核");
    const memory = getMemoryUsageSnapshot();
    if (memory.rssBytes !== undefined && memory.rssBytes > 3.5 * 1024 ** 3) {
      throw new Error("联合因子 MIP 达到内存保护线");
    }
    const iterationModelBuildStartedAt = performance.now();
    const solveRows = [...rows];
    if (best !== undefined) {
      const thresholdNumerator = best.numerator - BigInt(options.jobs.length - 1) * best.denominator;
      if (thresholdNumerator > 0n) {
        const loss = strictLogThresholdLoss(thresholdNumerator, best.denominator);
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
        for (const upperBound of [...sharedEquipmentUpperBounds, ...sharedFoodUpperBounds]) {
          if (cannotBeatThreshold(upperBound.jobRatios, thresholdNumerator, best.denominator)) {
            addRows(solveRows, upperBound.rowName, [[upperBound.selector, 1]], "=", 0);
          }
        }
        for (const upperBound of sharedPairUpperBounds ?? []) {
          if (ratioAtOrBelowThreshold(upperBound.ratio, thresholdNumerator, best.denominator)) {
            addRows(solveRows, upperBound.rowName,
              [[upperBound.selectorA, 1], [upperBound.selectorB, 1]], "<=", 1);
            sharedPairConflictRows.add(upperBound.rowName);
          }
        }
        for (const upperBound of factorClassUpperBounds) {
          if (ratioAtOrBelowThreshold(upperBound.ratio, thresholdNumerator, best.denominator)) {
            addRows(solveRows, upperBound.rowName,
              [[prefix(upperBound.jobIndex, upperBound.variable), 1]], "=", 0);
            factorClassConflictRows.add(upperBound.rowName);
          }
        }
      }
    }
    excluded.forEach((signature, index) => addRows(solveRows, `joint_nogood_${index}`,
      signature.map((name) => [name, 1] as const), "<=", signature.length - 1));
    throwIfCancelled(isCancelled);
    const solutionHint = new Map<string, number>();
    if (best !== undefined) {
      for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
        const jointJob = preparedJobs[jobIndex]!;
        const { job, prepared } = jointJob;
        const result = best.results[jobIndex]!;
        const modelSelection = internalRingSelection(jointJob, result.selection);
        if (modelSelection === undefined) throw new Error(`联合解提示无法展开戒指对：${job.id}`);
        modelSelection.forEach((equipment, slotIndex) => {
          const isSplitRingSlot = jointJob.ringSplit !== undefined &&
            (slotIndex === jointJob.ringSplit.firstSlotIndex || slotIndex === jointJob.ringSplit.secondSlotIndex);
          const candidate = job.options.slots[slotIndex]!.findIndex((entry) => isSplitRingSlot
            ? ringChildStructuralKey(entry) === ringChildStructuralKey(equipment)
            : options.equipmentIdentity(entry) === options.equipmentIdentity(equipment));
          if (candidate < 0) throw new Error(`联合解提示装备不属于模型候选：${job.id}/${slotIndex}`);
          solutionHint.set(prefix(jobIndex, prepared.model.slotVariables[slotIndex]![candidate]!), 1);
        });
        if (result.food !== undefined) {
          const foodIndex = job.options.foods.findIndex((entry) =>
            options.foodIdentity(entry) === options.foodIdentity(result.food!));
          solutionHint.set(prefix(jobIndex, prepared.model.foodVariables[foodIndex]!), 1);
        }
      }
    }
    iterationModelBuildMs += performance.now() - iterationModelBuildStartedAt;
    const solverCallStartedAt = performance.now();
    const output = await solveIntegerModel({
      name: "joint_factor_product",
      objective: best === undefined ? objective : new Map(),
      rows: solveRows,
      variables: bounds,
      binaryVariables: binaries,
      integerVariables: generals,
      timeLimitMs: remaining,
      ...(solutionHint.size === 0 ? {} : { solutionHint }),
      ...(options.onSolverProgress === undefined ? {} : { onProgress: options.onSolverProgress }),
    });
    solverWallMs += performance.now() - solverCallStartedAt;
    const postSolveStartedAt = performance.now();
    throwIfCancelled(isCancelled);
    solverRuns++;
    options.onProgress?.(`HiGHS 联合因子 MIP 状态=${output.Status}；已检查签名=${excluded.length}；耗时=${Math.round(performance.now() - startedAt)}ms`);
    if (output.Status === "Infeasible") {
      postSolveMs += performance.now() - postSolveStartedAt;
      break;
    }
    if (output.Status !== "Optimal") throw new Error(`联合因子 MIP 未证明最优：${output.Status}`);
    validateMipSolution(solveRows, bounds, output.Columns);
    const signature: string[] = [];
    const results: ExactMipResult[] = [];
    let numerator = 0n;
    let denominator = 1n;
    for (let index = 0; index < preparedJobs.length; index++) {
      const jointJob = preparedJobs[index]!;
      const { job, prepared } = jointJob;
      const columns = Object.fromEntries(prepared.model.bounds.map(({ name }) =>
        [name, output.Columns[prefix(index, name)] ?? { Primal: 0 }]));
      const modelSelection = slotsForResult(job.options.slots, prepared.model.slotVariables, columns);
      const selection = originalRingSelection(jointJob, modelSelection);
      const food = foodForResult(job.options.foods, prepared.model.foodVariables, columns);
      const attributes = getAttributeVector(modelSelection, food, job.options.attributeIds, job.options.equipmentAttributeExtractor);
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
        nextSurrogate: undefined, memoryUsage: getMemoryUsageSnapshot(),
      } });
    }
    if (best === undefined || numerator * best.denominator > best.numerator * denominator) {
      best = { numerator, denominator, results };
      options.onProgress?.(`联合因子 MIP 当前最优归一化总和=${Number(numerator) / Number(denominator)}`);
    }
    postSolveMs += performance.now() - postSolveStartedAt;
    if (best.numerator === BigInt(options.jobs.length) * best.denominator) break;
    excluded.push(signature);
  }
  if (best === undefined) return undefined;
  const elapsedMs = performance.now() - startedAt;
  const profile = {
    elapsedMs,
    modelPreparationMs,
    modelAssemblyMs,
    iterationModelBuildMs,
    solverWallMs,
    postSolveMs,
    otherMs: Math.max(0, elapsedMs - modelPreparationMs - modelAssemblyMs - iterationModelBuildMs - solverWallMs - postSolveMs),
    solverRuns,
    signatures: excluded.length,
    variables: bounds.length,
    constraints: rows.length + excluded.length,
    sharedPairCandidateUpperBound: sharedPairCandidateUpperBound.toString(),
    sharedPairCandidateCount,
    sharedPairCandidatesEvaluated,
    sharedPairConflictCuts: sharedPairConflictRows.size,
    sharedPairPreprocessingMs,
    sharedPairPreprocessingSkipped: Number(sharedPairPreprocessingSkipped),
    factorClassUpperBoundCount: factorClassUpperBounds.length,
    factorClassConflictCuts: factorClassConflictRows.size,
  };
  if (options.onSolverProgress !== undefined) emitProfileEvent(
    options.onSolverProgress,
    profileBackend,
    "joint_factor_product",
    "joint-search-summary",
    profile,
  );
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
      Math.trunc((raw + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7),
    );
    const rational = Math.min(
      param.maxValue,
      Math.floor(((raw + (param.baseValue ?? 0)) * rate.numerator) / rate.denominator),
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
        ? Math.min(param.maxValue, Math.trunc((rawMinimums[attribute]! + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7))
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
      const offset = numerator * (param.baseValue ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("食物基础属性必须为非负安全整数");
      const bigM = Math.max(
        numerator * rawMaximums[attribute]! + offset,
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
        maximumRaw: rawMaximums[attribute]! + (param.baseValue ?? 0),
      });
      addRows(rows, `food_cap_flag_${foodIndex}_${attribute}`, [[capped, 1], [foodVariable, -1]], "<=", 0);
      addRows(rows, `food_bonus_cap_low_${foodIndex}_${attribute}`, [[bonus, 1], [capped, -cap]], ">=", 0);
      addRows(rows, `food_bonus_cap_high_${foodIndex}_${attribute}`, [[bonus, 1], [foodVariable, -(cap - 1)], [capped, -1]], "<=", 0);
      addRows(rows, `food_floor_low_${foodIndex}_${attribute}`, [[bonus, denominator], [rawVariables[attribute]!, -numerator]], "<=", offset);
      const floorHigh = new Map<string, number>([
        [rawVariables[attribute]!, numerator],
        [bonus, -denominator],
        [capped, -bigM],
        [foodVariable, bigM],
      ]);
      addRows(rows, `food_floor_high_${foodIndex}_${attribute}`, floorHigh, "<=", denominator - 1 + bigM - offset);
      const capThreshold = new Map<string, number>([
        [rawVariables[attribute]!, numerator],
        [capped, -bigM],
      ]);
      addRows(rows, `food_cap_threshold_${foodIndex}_${attribute}`, capThreshold, ">=", denominator * cap - bigM - offset);
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
  throwIfCancelled(options.isCancelled);
  const model = buildLinearAttributeModel(options);
  throwIfCancelled(options.isCancelled);
  if (model === undefined) return undefined;
  const factorEvaluator = createIntegerDamageFactorEvaluator(
    options.job,
    options.jobLevel,
    options.statIndexes,
  );
  const zeroFactors = factorEvaluator(new Array<number>(options.attributeIds.length).fill(0));
  if (zeroFactors === undefined) throw new Error(`职业 ${options.job} 没有整数伤害因子公式`);
  const schema = gameData.jobSchemas[options.job];
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
  const bluAdditionValues = options.job === "BLU"
    ? mainFactorGroup.classes.map((factorClass) => {
      if (factorClass.auxiliary === undefined) {
        throw new Error("青魔法师主属性因子缺少武器伤害附加值");
      }
      return factorClass.auxiliary;
    })
    : [0];
  const bluAdditionMinimum = Math.min(...bluAdditionValues);
  const bluAdditionMaximum = Math.max(...bluAdditionValues);
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
          if (factorClass.auxiliary === undefined) {
            throw new Error("青魔法师主属性因子缺少武器伤害附加值");
          }
          addTerm(wdExpression, factorClass.variable, -factorClass.auxiliary);
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
  throwIfCancelled(options.isCancelled);
  const maxSearchMs = options.maxSearchMs ?? 110_000;
  if (!Number.isFinite(maxSearchMs) || maxSearchMs <= 0) throw new RangeError("maxSearchMs 必须是正有限值");
  const modelPreparationStartedAt = performance.now();
  const prepared = await prepareExactMipModel(options);
  const modelPreparationMs = performance.now() - modelPreparationStartedAt;
  throwIfCancelled(options.isCancelled);
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
  throwIfCancelled(options.isCancelled);
  let solverRuns = 0;
  let solverWallMs = 0;
  const greedyMipStartStartedAt = performance.now();
  const initialStart = greedyMipStart(options, model, useDps,
    Math.min(startedAt + maxSearchMs, performance.now() + 100),
    () => options.isCancelled?.() === true || performance.now() >= startedAt + maxSearchMs);
  const greedyMipStartMs = performance.now() - greedyMipStartStartedAt;
  let maximumSurrogate = Number.NEGATIVE_INFINITY;
  let nextSurrogate: number | undefined;
  let best: { result: LoadoutSearchResult; factors: IntegerDamageFactors; toughness?: number } | undefined;
  let maximumToughness: number | undefined;
  const solverName = "HiGHS";
  const solveModel = async (
    objective: Map<string, number>,
    phaseName: string,
    minimumSurrogate?: number,
  ): Promise<LinearMipSolution> => {
    throwIfCancelled(options.isCancelled);
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
    throwIfCancelled(options.isCancelled);
    const solverCallStartedAt = performance.now();
    const output = await solveIntegerModel({
      name: phaseName,
      objective,
      rows,
      variables: model.bounds,
      binaryVariables: model.binaryVars,
      integerVariables: model.generalVars,
      timeLimitMs: remainingMs,
      ...(initialStart === undefined || excludedSignatures.length > 0
        ? {}
        : { solutionHint: initialStart }),
      ...(options.onSolverProgress === undefined
        ? {}
        : { onProgress: options.onSolverProgress }),
    });
    solverWallMs += performance.now() - solverCallStartedAt;
    throwIfCancelled(options.isCancelled);
    solverRuns++;
    throwIfCancelled(options.isCancelled);
    if (output.Status === "Optimal") validateMipSolution(rows, model.bounds, output.Columns);
    options.onProgress?.(`${solverName} ${phaseName} 状态=${output.Status}；目标=${output.ObjectiveValue}`);
    return output;
  };
  const setRange = (variable: string, minimum?: number, maximum?: number) => {
    addRangeConstraint(model.rows, `max_ten_${model.rows.length}`, variable, minimum, maximum);
  };

  if (options.constraints?.maxToughnessMode === true) {
    const tenVariable = model.finalVariables[toughnessIndex!]!;
    const phaseOne = await solveModel(new Map([[tenVariable, 1]]), "maximum_tenacity");
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
    throwIfCancelled(options.isCancelled);
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
      ? await solveModel(objective, "exact_damage_initial")
      : await solveModel(new Map(), "exact_damage_band_feasibility", firstSurrogate - errorBand);
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
        throw new Error(`${solverName} 返回了不满足 surrogate 带宽约束的签名`);
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
  if (options.onSolverProgress !== undefined && isProfileTimingEnabled()) {
    options.onSolverProgress({
      backend: "HiGHS",
      model: `exact_search_${options.job}`,
      kind: "log",
      message: `PROFILE ${JSON.stringify({ phase: "exact-search-summary", job: options.job, ...statistics })}`,
    });
  }
  return {
    ...best.result,
    ...(options.constraints?.maxToughnessMode === true && best.toughness !== undefined
      ? { maximumToughness: best.toughness }
      : {}),
    statistics,
  };

  function createStatistics(): ExactMipSearchStatistics {
    const elapsedMs = performance.now() - startedAt;
    return {
      elapsedMs,
      ...(isProfileTimingEnabled() ? {
        modelPreparationMs,
        greedyMipStartMs,
        solverWallMs,
        otherSearchMs: Math.max(0,
          elapsedMs - modelPreparationMs - greedyMipStartMs - solverWallMs - signatureBandElapsedMs),
      } : {}),
      solverRuns,
      excludedSignatures: excludedSignatures.length,
      signatureBandChecks,
      signatureBandElapsedMs,
      signatureBandProof,
      variables: model!.bounds.length,
      constraints: model!.rows.length + excludedSignatures.length,
      maximumSurrogate,
      nextSurrogate,
      memoryUsage: getMemoryUsageSnapshot(),
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
