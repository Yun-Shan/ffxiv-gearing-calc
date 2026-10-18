import type loadHighs from "highs";
import type { CallbackEvent } from "highs";
import { gameData } from "../data.ts";
import { getMemoryUsageSnapshot, type MemoryUsageSnapshot } from "./memory-usage.ts";
import { throwIfCancelled } from "./cancellation.ts";
import {
  createIntegerDamageFactorEvaluator,
  type IntegerDamageFactorEvaluator,
  type IntegerDamageFactors,
} from "./equipped-effects.ts";
import { hasStrictlyBetterFactorCombination } from "./signature-band.ts";
import {
  canonicalFoodBonusAtRawWithRate,
  candidateUpperBoundCannotImproveIncumbent,
  candidateUpperBoundIsStrictlyWorse,
  hasCanonicalEvaluatorCandidateUpperBound,
  inheritCanonicalEvaluatorCandidateUpperBound,
  shouldEnableCanonicalCandidateUpperBound,
} from "./exact-mip-candidate-upper-bound.ts";
import { candidateUpperBoundCannotImproveJointIncumbent } from "./joint-candidate-upper-bound.ts";
import {
  findStrictlyDominatedSharedAccessoryPairs,
  type SharedAccessoryPairCandidate,
} from "./shared-accessory-pair-dominance.ts";
import {
  canUseSharedAccessoryPairDominance,
  hasSharedAccessoryPairDominancePath,
  sharedAccessoryPairDominanceLimitsFor,
} from "./shared-accessory-pair-dominance-policy.ts";
import {
  prepareFactorResourceBudgetUpperBound,
  type PreparedFactorResourceBudgetUpperBound,
} from "./factor-resource-budget-upper-bound.ts";
import type {
  GcdSpeedRange,
  LoadoutConstraints,
} from "./search-types.ts";
import type {
  HighsCallbackName,
  HighsCallbackTrace,
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
import type { CustomizableStat, JobId, Stat } from "../types.ts";
import type {
  CandidateResourceSupportProfile,
  ResourceBudgetCandidateProfile,
} from "./candidate-resource-support-policy.ts";

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
  reachableFactorClassesRemoved?: number;
  reachableAttributePruningSkipped?: number;
  reachableWeaponFactorClassesRemoved?: number;
  reachableWeaponPruningSkipped?: number;
  maximumSurrogate: number;
  nextSurrogate: number | undefined;
  memoryUsage: MemoryUsageSnapshot;
  candidateUpperBound?: {
    candidatesBefore: number;
    candidatesAfter: number;
    elapsedMs: number;
  };
  resourceBudgetCandidateBound?: {
    candidates: number;
    supportCount: number;
    preparationMs: number;
  };
  resourceBudgetCandidateCuts?: number;
  primaryResourceSupportsEnabled?: boolean;
  mainStatResourceSupportEnabled?: boolean;
  incumbentCandidateUpperBoundCuts?: number;
  conditionalResourceSupport?: {
    candidateBands: number;
    rowsAdded: number;
    weightedRowsAdded?: number;
    nonzerosAdded: number;
    weightedResourceWeights?: Readonly<Record<string, number>>;
    skipReason?: "disabled-by-policy" | "no-out-of-window-candidates" | "no-strictly-tighter-bands" | "ring-pair-candidates" | "model-budget";
  };
};

export type ExactMipResult = LoadoutSearchResult & {
  maximumToughness?: number;
  statistics: ExactMipSearchStatistics;
};

export type ExactMipOptions = {
  job: JobId;
  jobLevel: JobLevel;
  /** 族群基础属性索引；未提供时使用 0（人族·中原之民）。 */
  clanIndex?: number;
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
  /** 默认按不固定 GCD 的 DPS 搜索，以保持原有搜索行为。 */
  objective?: "damage" | "dps";
  /** 仅用于强化精确 MIP 资源松弛的内部区间。 */
  candidateItemLevelRanges?: readonly { min: number; max: number }[];
  /** V3 内部策略：根据品级先验构造条件约束行的数量。 */
  candidateResourceSupportProfile?: CandidateResourceSupportProfile;
  /** 在此前测量过的精确候选上界档位中进行内部选择。 */
  resourceBudgetCandidateProfile?: ResourceBudgetCandidateProfile;
  /** V3 基线内部策略；添加隐含的主属性或加权资源不等式。 */
  primaryResourceSupports?: boolean;
  /** V3 内部策略；仅添加主属性资源不等式。 */
  mainStatResourceSupport?: boolean;
  maxSearchMs?: number;
  onProgress?: (message: string) => void;
  onSolverProgress?: (event: LinearMipProgress) => void;
  onSolverCallback?: (event: HighsCallbackTrace) => void;
  isCancelled?: () => boolean;
};

const LOG_SCALE = 1_000_000_000_000n;
const FIXED_SCALE = 10n ** 30n;
const LOG_TERMS = 40;
const SURROGATE_OBJECTIVE_SCALE = 65_536;
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

/** ln(numerator / denominator) 的定点上下界，按 FIXED_SCALE 缩放。 */
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
  // 严格改进要求整数 Qdiff >= floor(L*ln(t))-K+1。约束行使用 baseline-loss-K，
  // 因此令 loss=-ell-1 即可编码该严格整数下界。
  const ell = floorDiv(LOG_SCALE * lower, FIXED_SCALE);
  return -ell - 1n;
}

/**
 * 返回 round(LOG_SCALE * ln(value))；只有证明定点级数的上下界取整后相同才返回结果。
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

const MAX_LP_LINE_LENGTH = 1_000;

function expressionLines(
  prefixText: string,
  terms: ReadonlyMap<string, number>,
  suffixText = "",
): string[] {
  const entries = [...terms].filter(([, coefficient]) => coefficient !== 0);
  if (entries.length === 0) return [`${prefixText}0${suffixText}`];

  const lines: string[] = [];
  let line = prefixText;
  for (let index = 0; index < entries.length; index++) {
    const [variable, coefficient] = entries[index]!;
    const sign = coefficient < 0 ? "-" : "+";
    const magnitude = Math.abs(coefficient);
    const term = `${index === 0 ? (sign === "-" ? "- " : "") : `${sign} `}${magnitude} ${variable}`;
    const addition = index === 0 ? term : ` ${term}`;
    const reserveSuffix = index === entries.length - 1 ? suffixText.length : 0;
    if (line !== prefixText && line.length + addition.length + reserveSuffix > MAX_LP_LINE_LENGTH) {
      lines.push(line);
      line = `  ${term}`;
    } else {
      line += addition;
    }
  }
  line += suffixText;
  lines.push(line);
  return lines;
}

function appendVariableSection(output: string[], title: string, variables: readonly string[]) {
  if (variables.length === 0) return;
  output.push(title);
  let line = " ";
  for (const variable of variables) {
    const addition = line === " " ? variable : ` ${variable}`;
    if (line.length + addition.length > MAX_LP_LINE_LENGTH) {
      output.push(line);
      line = ` ${variable}`;
    } else {
      line += addition;
    }
  }
  if (line !== " ") output.push(line);
}

function lpText(
  name: string,
  objective: ReadonlyMap<string, number>,
  rows: readonly ModelRow[],
  bounds: readonly VariableBounds[],
  binaries: readonly string[],
  generals: readonly string[],
): string {
  const output = ["Maximize", ...expressionLines(" obj: ", objective), "Subject To"];
  for (const row of rows) {
    output.push(...expressionLines(` ${row.name}: `, row.terms, ` ${row.sense} ${row.rhs}`));
  }
  output.push("Bounds");
  for (const bound of bounds) {
    output.push(` ${bound.min} <= ${bound.name} <= ${bound.max}`);
  }
  appendVariableSection(output, "Generals", generals);
  appendVariableSection(output, "Binaries", binaries);
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
  const timeLimit = request.timeLimitMs === undefined
    ? undefined
    : Math.max(0.05, request.timeLimitMs / 1000);
  const startedAt = performance.now();
  let lastMipCheckpointAt = startedAt;
  let modelReadyMs = 0;
  let nativeRunMs = 0;
  let finalStatus = "unknown";
  let stoppedByDualBound = false;
  let lastObjectiveBoundCheckAt = Number.NEGATIVE_INFINITY;
  const result = await highs.withModel({ format: "lp", data: text }, (native) => {
    modelReadyMs = performance.now() - lpReadyAt;
    const hasProgress = request.onProgress !== undefined;
    const hasCallbackTrace = request.onCallback !== undefined;
    native.options.set({
      output_flag: hasProgress || hasCallbackTrace,
      log_to_console: false,
      presolve: "on",
      mip_rel_gap: 0,
      mip_abs_gap: 0,
      mip_min_logging_interval: 1,
      ...(timeLimit === undefined ? {} : { time_limit: timeLimit }),
    });
    let solutionHintEntries: readonly (readonly [number, number])[] | undefined;
    if (request.solutionHint !== undefined && request.solutionHint.size > 0) {
      const entries = [...request.solutionHint]
        .map(([name, value]) => [native.getColByName(name), value] as const)
        .sort(([left], [right]) => left - right);
      solutionHintEntries = entries;
      native.setSolution({
        indices: entries.map(([index]) => index),
        values: entries.map(([, value]) => value),
      });
    }
    let userSolutionAttempted = false;
    const callbacks: NonNullable<Parameters<typeof native.run>[0]> = {
      ...(hasProgress || hasCallbackTrace ? {
        [highs.constants.callbackType.mipImprovingSolution]: (event) => {
          if (hasCallbackTrace) emitFullCallback("mipImprovingSolution", event);
          if (hasProgress) emitHighsProgress("incumbent", event.data);
          return undefined;
        },
        [highs.constants.callbackType.mipLogging]: (event) => {
          if (hasCallbackTrace) emitFullCallback("mipLogging", event);
          if (hasProgress) emitHighsProgress("bound", event.data);
          return undefined;
        },
      } : {}),
      ...(hasCallbackTrace || request.stopWhenDualBoundProvesOptimal !== undefined ? {
        [highs.constants.callbackType.mipInterrupt]: (event) => {
          if (hasCallbackTrace) emitFullCallback("mipInterrupt", event);
          const now = performance.now();
          const dualBound = event.data.mip_dual_bound;
          if (!stoppedByDualBound && request.stopWhenDualBoundProvesOptimal !== undefined &&
            now - lastObjectiveBoundCheckAt >= 100 && typeof dualBound === "number" &&
            Number.isFinite(dualBound)) {
            lastObjectiveBoundCheckAt = now;
            if (request.stopWhenDualBoundProvesOptimal(dualBound)) {
              stoppedByDualBound = true;
              event.interrupt();
              return undefined;
            }
          }
          if (hasCallbackTrace && now - lastMipCheckpointAt >= 1000) {
            lastMipCheckpointAt = now;
            if (hasProgress) emitHighsProgress("bound", event.data);
          }
          return undefined;
        },
      } : {}),
      ...(hasCallbackTrace ? {
        [highs.constants.callbackType.logging]: (event) => {
          emitFullCallback("logging", event);
          return undefined;
        },
        [highs.constants.callbackType.simplexInterrupt]: (event) => {
          emitFullCallback("simplexInterrupt", event);
          return undefined;
        },
        [highs.constants.callbackType.ipmInterrupt]: (event) => {
          emitFullCallback("ipmInterrupt", event);
          return undefined;
        },
        [highs.constants.callbackType.mipSolution]: (event) => {
          emitFullCallback("mipSolution", event);
          return undefined;
        },
        [highs.constants.callbackType.mipCutPool]: (event) => {
          emitFullCallback("mipCutPool", event);
          return undefined;
        },
      } : {}),
      ...(hasCallbackTrace || solutionHintEntries !== undefined ? {
        [highs.constants.callbackType.mipUserSolution]: (event) => {
          if (hasCallbackTrace) emitFullCallback("mipUserSolution", event);
          if (!userSolutionAttempted && solutionHintEntries !== undefined) {
            userSolutionAttempted = true;
            const status = event.setSolution({
              indices: solutionHintEntries.map(([index]) => index),
              values: solutionHintEntries.map(([, value]) => value),
            });
            if (status.status !== highs.constants.status.error) event.repairSolution();
          }
          return undefined;
        },
      } : {}),
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
    const Status = stoppedByDualBound ? "DualBound"
      : status === highs.constants.modelStatus.optimal ? "Optimal"
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
  request.onProgress?.({
    backend: "HiGHS",
    model: request.name,
    kind: "bound",
    elapsedMs: performance.now() - startedAt,
    variableCount: request.variables.length,
    rowCount: request.rows.length,
    status: result.Status,
    completed: result.Status === "Optimal",
  });
  return result;

  function emitFullCallback(callbackName: HighsCallbackName, event: CallbackEvent): void {
    request.onCallback?.({
      model: request.name,
      callbackType: event.type,
      callbackName,
      event: {
        ownKeys: Object.keys(event),
        type: event.type,
        message: event.message,
        data: event.data,
        controlMethods: {
          interrupt: "interrupt" in event,
          setSolution: "setSolution" in event,
          repairSolution: "repairSolution" in event,
        },
      },
    });
  }

  function emitHighsProgress(
    kind: "incumbent" | "bound",
    data: Readonly<Record<string, unknown>>,
  ): void {
    const numeric = (name: string) => {
      const value = data[name];
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    };
    const runningTime = numeric("running_time");
    const elapsedMs = runningTime === undefined
      ? performance.now() - startedAt
      : runningTime * 1000;
    const primalBound = numeric("mip_primal_bound") ?? numeric("objective_function_value");
    const nodes = nonNegativeCount(data.mip_node_count);
    const totalLpIterations = nonNegativeCount(data.mip_total_lp_iterations);
    request.onProgress?.({
      backend: "HiGHS",
      model: request.name,
      kind,
      elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : performance.now() - startedAt,
      ...(primalBound === undefined ? {} : { objectiveValue: primalBound }),
      ...(numeric("mip_dual_bound") === undefined ? {} : { bestBound: numeric("mip_dual_bound") }),
      ...(numeric("mip_gap") === undefined ? {} : { gap: numeric("mip_gap") }),
      ...(nodes === undefined ? {} : { nodes }),
      ...(totalLpIterations === undefined ? {} : { totalLpIterations }),
      variableCount: request.variables.length,
      rowCount: request.rows.length,
    });
  }
}

function nonNegativeCount(value: unknown): string | undefined {
  if (typeof value === "bigint") return value < 0n ? undefined : value.toString();
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  }
  if (typeof value !== "string") return undefined;
  const raw = value.endsWith("n") ? value.slice(0, -1) : value;
  if (!/^\d+$/.test(raw)) return undefined;
  return BigInt(raw).toString();
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
  statIndexes: ReadonlyMap<Stat, number>,
): number[] {
  const indexes = new Map(attributeIds.map((id, index) => [id, index]));
  const result = new Array<number>(attributeIds.length).fill(0);
  for (const equipment of selection) {
    const params = equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
    for (const param of params) {
      const index = indexes.get(param.baseParamId);
      if (index !== undefined) result[index] += param.value;
    }
    const allocations = equipment.resistanceAllocation ?? [];
    if (allocations.length > 0) {
      const adjustment = equipment.resistanceWeaponAdjust;
      if (adjustment === undefined) {
        throw new Error(`装备 ${equipment.itemId} 的属性分配缺少 ResistanceWeaponAdjust 参数`);
      }
      const seen = new Set<CustomizableStat>();
      let total = 0;
      for (const allocation of allocations) {
        const maximum = adjustment.statMaximums?.[allocation.stat] ?? adjustment.maxEachStat;
        const statIndex = statIndexes.get(allocation.stat);
        const expectedAttributeId = statIndex === undefined ? undefined : attributeIds[statIndex];
        const index = indexes.get(allocation.baseParamId);
        if (!adjustment.stats.includes(allocation.stat) || seen.has(allocation.stat) ||
          !Number.isSafeInteger(maximum) || maximum < 0 ||
          !Number.isSafeInteger(allocation.value) || allocation.value <= 0 ||
          allocation.value > maximum || expectedAttributeId !== allocation.baseParamId ||
          index === undefined) {
          throw new Error(`装备 ${equipment.itemId} 的 ${allocation.stat} 属性分配无效`);
        }
        seen.add(allocation.stat);
        total += allocation.value;
        result[index] += allocation.value;
      }
      if (!Number.isSafeInteger(total) || total > adjustment.maxTotalStats) {
        throw new Error(`装备 ${equipment.itemId} 的总分配属性超过 ResistanceWeaponAdjust 上限`);
      }
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

function factorObjectiveLogScore(factors: IntegerDamageFactors, useDps: boolean): number {
  return roundedLog(factors.weaponDamage) + roundedLog(factors.mainStat) +
    roundedLog(factors.determination) + roundedLog(factors.tenacity) +
    roundedLog(factors.critical) + roundedLog(factors.directHit) -
    (useDps ? roundedLog(factors.gcdCentiseconds) : 0);
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

type GreedyMipStart = {
  hint: Map<string, number>;
  selection: EquipInfo[];
  food: FoodInfo | undefined;
};

function sparseMipStart(
  slots: readonly (readonly EquipInfo[])[],
  foods: readonly FoodInfo[],
  slotVariables: readonly (readonly string[])[],
  foodVariables: readonly string[],
  selection: readonly EquipInfo[],
  food: FoodInfo | undefined,
): Map<string, number> | undefined {
  if (slots.length !== selection.length || slotVariables.length !== slots.length) return undefined;
  const hint = new Map<string, number>();
  const uniqueRingItems = new Set<number>();
  for (let slot = 0; slot < selection.length; slot++) {
    const candidateIndex = slots[slot]!.indexOf(selection[slot]!);
    const variable = slotVariables[slot]?.[candidateIndex];
    if (candidateIndex < 0 || variable === undefined) return undefined;
    const equipment = selection[slot]!;
    if (equipment.ringSlotIndex !== undefined && equipment.isUnique === true) {
      if (uniqueRingItems.has(equipment.itemId)) return undefined;
      uniqueRingItems.add(equipment.itemId);
    }
    hint.set(variable, 1);
  }
  if (foods.length > 0) {
    if (food === undefined) return undefined;
    const foodIndex = foods.indexOf(food);
    const variable = foodVariables[foodIndex];
    if (foodIndex < 0 || variable === undefined) return undefined;
    hint.set(variable, 1);
  } else if (food !== undefined) {
    return undefined;
  }
  return hint;
}

function greedyMipStart(options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>, useDps: boolean, deadline: number,
  isCancelled: () => boolean): GreedyMipStart | undefined {
  const selection = options.slots.map((slot) => slot[0]!);
  let chosenFood = options.foods[0];
  const speedIndex = options.speedAttributeId === undefined ? undefined : model.idToIndex.get(options.speedAttributeId);
  const toughnessIndex = options.toughnessAttributeId === undefined ? undefined : model.idToIndex.get(options.toughnessAttributeId);
  const choiceRanges = options.constraints?.gcdChoices?.flatMap((gcd) => {
    const range = options.gcdToSpeedRange?.(gcd);
    return range === undefined ? [] : [range];
  });
  const ringSlotIndexes = new Map<0 | 1, number>();
  options.slots.forEach((slot, index) => {
    const ringSlotIndex = slot[0]?.ringSlotIndex;
    if (ringSlotIndex === 0 || ringSlotIndex === 1) ringSlotIndexes.set(ringSlotIndex, index);
  });
  const evaluate = () => {
    const attributes = getAttributeVector(selection, chosenFood, options.attributeIds, options.equipmentAttributeExtractor, options.statIndexes);
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
    const firstRing = ringSlotIndexes.get(0);
    const secondRing = ringSlotIndexes.get(1);
    if (firstRing !== undefined && secondRing !== undefined &&
      selection[firstRing]!.itemId === selection[secondRing]!.itemId &&
      selection[firstRing]!.isUnique === true && selection[secondRing]!.isUnique === true) {
      violation = Number.POSITIVE_INFINITY;
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
  type FeasibleStart = { selection: EquipInfo[]; food: FoodInfo | undefined; score: HeuristicScore };
  let bestFeasible: FeasibleStart | undefined;
  const rememberFeasible = (score: HeuristicScore | undefined) => {
    if (score === undefined || score.violation !== 0 ||
      (bestFeasible !== undefined && !better(score, bestFeasible.score))) return;
    bestFeasible = { selection: [...selection], food: chosenFood, score };
  };
  const createStart = (): GreedyMipStart | undefined => {
    if (bestFeasible === undefined) return undefined;
    const selection = [...bestFeasible.selection];
    if (model.canonicalRingOrder !== undefined) {
      const { firstSlotIndex, secondSlotIndex, firstRanks, secondRanks } = model.canonicalRingOrder;
      const firstCandidateIndex = options.slots[firstSlotIndex]!.indexOf(selection[firstSlotIndex]!);
      const secondCandidateIndex = options.slots[secondSlotIndex]!.indexOf(selection[secondSlotIndex]!);
      if (firstCandidateIndex < 0 || secondCandidateIndex < 0) return undefined;
      if (firstRanks[firstCandidateIndex]! > secondRanks[secondCandidateIndex]!) {
        const firstReplacement = firstRanks.indexOf(secondRanks[secondCandidateIndex]!);
        const secondReplacement = secondRanks.indexOf(firstRanks[firstCandidateIndex]!);
        if (firstReplacement < 0 || secondReplacement < 0) return undefined;
        selection[firstSlotIndex] = options.slots[firstSlotIndex]![firstReplacement]!;
        selection[secondSlotIndex] = options.slots[secondSlotIndex]![secondReplacement]!;
      }
    }
    const hint = sparseMipStart(
      options.slots,
      options.foods,
      model.slotVariables,
      model.foodVariables,
      selection,
      bestFeasible.food,
    );
    return hint === undefined ? undefined : { hint, selection, food: bestFeasible.food };
  };
  rememberFeasible(current);
  let checks = 0;
  // 这段有界坐标搜索只为 MIP 提供提示，绝不作为答案或上界；
  // 每个最终结果仍须经过完整证明。
  for (let pass = 0; pass < 6; pass++) {
    if (isCancelled()) return undefined;
    if (performance.now() >= deadline) return createStart();
    let changed = false;
    for (let slot = 0; slot < selection.length; slot++) {
      const previous = selection[slot]!;
      let winner = previous;
      for (const candidate of options.slots[slot]!) {
        if ((++checks & 63) === 0) {
          if (isCancelled()) {
            selection[slot] = winner;
            return undefined;
          }
          if (performance.now() >= deadline) {
            selection[slot] = winner;
            return createStart();
          }
        }
        selection[slot] = candidate;
        const score = evaluate();
        if (better(score, current)) { winner = candidate; current = score; }
        rememberFeasible(score);
      }
      selection[slot] = winner;
      changed ||= winner !== previous;
    }
    const previousFood = chosenFood;
    let winningFood = previousFood;
    for (const food of options.foods) {
      if ((++checks & 63) === 0) {
        if (isCancelled()) {
          chosenFood = winningFood;
          return undefined;
        }
        if (performance.now() >= deadline) {
          chosenFood = winningFood;
          return createStart();
        }
      }
      chosenFood = food;
      const score = evaluate();
      if (better(score, current)) { winningFood = food; current = score; }
      rememberFeasible(score);
    }
    chosenFood = winningFood;
    changed ||= chosenFood !== previousFood;
    if (!changed) break;
  }
  return createStart();
}

type CandidateUpperBoundResult = {
  slots: readonly (readonly EquipInfo[])[];
  candidateUpperFactorsBySlot: readonly ReadonlyMap<EquipInfo, IntegerDamageFactors>[];
  candidatesBefore: number;
  candidatesAfter: number;
  elapsedMs: number;
};

function candidateUpperBoundAttributeIndexes(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
): number[] | undefined {
  const schema = gameData.jobSchemas[options.job];
  if (schema?.mainStat === undefined) return undefined;
  const attackStat: Stat = schema.mainStat === "VIT" ? "STR" : schema.mainStat;
  const weaponStat: Stat = schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  const speedStat: Stat = schema.stats.includes("SKS") ? "SKS" : "SPS";
  const requiredStats = new Set<Stat>([attackStat, weaponStat, speedStat]);
  const relevantStats = new Set<Stat>([
    attackStat, weaponStat, speedStat, "CRT", "DET", "TEN", "DHT",
  ]);
  const indexes = new Set<number>();
  for (const stat of relevantStats) {
    const vectorIndex = options.statIndexes.get(stat);
    if (vectorIndex === undefined) {
      if (requiredStats.has(stat)) return undefined;
      continue;
    }
    const attributeId = options.attributeIds[vectorIndex];
    const modelIndex = attributeId === undefined ? undefined : model.idToIndex.get(attributeId);
    if (modelIndex === undefined || options.attributeIds[modelIndex] !== attributeId) {
      if (requiredStats.has(stat)) return undefined;
      continue;
    }
    indexes.add(modelIndex);
  }
  return [...indexes];
}

function maximumFoodBonusTables(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  attributeIndexes: readonly number[],
  deadline: number,
  isCancelled: () => boolean,
): Map<number, Float64Array> | undefined {
  const maxFoodEvaluations = 20_000_000;
  let foodEvaluations = 0;
  const tables = new Map<number, Float64Array>();
  if (options.foods.length === 0) return tables;
  for (const attribute of attributeIndexes) {
    const maximumRaw = model.rawMaximums[attribute];
    const attributeId = options.attributeIds[attribute];
    if (!Number.isSafeInteger(maximumRaw) || maximumRaw! < 0 || attributeId === undefined ||
      maximumRaw! >= 2_000_000) return undefined;
    const parameters = options.foods.map((food) => {
      const matches = food.baseParams.filter((param) => param.baseParamId === attributeId);
      if (matches.length > 1) return undefined;
      const param = matches[0];
      if (param === undefined) return null;
      const baseValue = param.baseValue ?? 0;
      if (!Number.isSafeInteger(baseValue) || baseValue < 0 ||
        !Number.isFinite(param.multiplier) || param.multiplier < 1 ||
        !Number.isSafeInteger(param.maxValue) || param.maxValue < 0) return undefined;
      try {
        const { numerator, denominator } = parseRationalRate(param.multiplier - 1);
        return { baseValue, multiplier: param.multiplier, maxValue: param.maxValue, numerator, denominator };
      } catch {
        return undefined;
      }
    });
    if (parameters.some((parameter) => parameter === undefined)) return undefined;
    const requiredEvaluations = (maximumRaw! + 1) * parameters.length;
    if (!Number.isSafeInteger(requiredEvaluations) || requiredEvaluations > maxFoodEvaluations - foodEvaluations) {
      return undefined;
    }
    foodEvaluations += requiredEvaluations;
    const table = new Float64Array(maximumRaw! + 1);
    for (let raw = 0; raw <= maximumRaw!; raw++) {
      if ((raw & 1023) === 0 && (isCancelled() || performance.now() >= deadline)) return undefined;
      let maximumBonus = 0;
      for (const parameter of parameters) {
        if (parameter === null || parameter === undefined) continue;
        const bonus = canonicalFoodBonusAtRawWithRate(raw, parameter);
        if (bonus === undefined) return undefined;
        maximumBonus = Math.max(maximumBonus, bonus);
      }
      table[raw] = maximumBonus;
    }
    tables.set(attribute, table);
  }
  return tables;
}

function safeDamageFactors(factors: IntegerDamageFactors | undefined): factors is IntegerDamageFactors {
  if (factors === undefined) return false;
  return [
    factors.weaponDamage,
    factors.mainStat,
    factors.determination,
    factors.tenacity,
    factors.critical,
    factors.directHit,
    factors.gcdCentiseconds,
  ].every((value) => Number.isSafeInteger(value) && value > 0);
}

function pruneCandidatesByIncumbentUpperBound(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  factorEvaluator: IntegerDamageFactorEvaluator,
  useDps: boolean,
  incumbent: GreedyMipStart,
  deadline: number,
  isCancelled: () => boolean,
): CandidateUpperBoundResult | undefined {
  if (!hasCanonicalEvaluatorCandidateUpperBound(options) ||
    options.equipmentAttributeExtractor !== undefined ||
    options.constraints?.maxToughnessMode === true ||
    incumbent.selection.length !== options.slots.length) return undefined;
  const startedAt = performance.now();
  const incumbentAttributes = getAttributeVector(
    incumbent.selection,
    incumbent.food,
    options.attributeIds,
    options.equipmentAttributeExtractor,
    options.statIndexes,
  );
  const incumbentFactors = factorEvaluator(incumbentAttributes);
  if (!safeDamageFactors(incumbentFactors)) return undefined;
  const attributeIndexes = candidateUpperBoundAttributeIndexes(options, model);
  if (attributeIndexes === undefined) return undefined;
  const foodBonusTables = maximumFoodBonusTables(options, model, attributeIndexes, deadline, isCancelled);
  if (foodBonusTables === undefined) return undefined;

  let maximumsProcessed = 0;
  const slotMaximums = options.slots.map((_, slotIndex) => {
    const maximums = new Array<number>(attributeIndexes.length).fill(0);
    for (const candidate of model.equipmentAttributes[slotIndex] ?? []) {
      if ((maximumsProcessed++ & 255) === 0 &&
        (isCancelled() || performance.now() >= deadline)) return undefined;
      for (let index = 0; index < attributeIndexes.length; index++) {
        const value = candidate[attributeIndexes[index]!]!;
        if (!Number.isSafeInteger(value)) return undefined;
        maximums[index] = Math.max(maximums[index]!, value);
      }
    }
    return maximums;
  });
  if (slotMaximums.some((maximums) => maximums === undefined)) return undefined;
  const totalMaximums = new Array<number>(attributeIndexes.length).fill(0);
  for (const maximums of slotMaximums) {
    for (let index = 0; index < attributeIndexes.length; index++) {
      totalMaximums[index] += maximums![index]!;
      if (!Number.isSafeInteger(totalMaximums[index]!)) return undefined;
    }
  }

  let candidatesBefore = 0;
  let candidatesAfter = 0;
  const prunedSlots: EquipInfo[][] = [];
  const candidateUpperFactorsBySlot: Map<EquipInfo, IntegerDamageFactors>[] = [];
  let processed = 0;
  for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
    const slot = options.slots[slotIndex]!;
    const equipmentVectors = model.equipmentAttributes[slotIndex];
    const kept: EquipInfo[] = [];
    const upperFactorsByCandidate = new Map<EquipInfo, IntegerDamageFactors>();
    candidatesBefore += slot.length;
    for (let candidateIndex = 0; candidateIndex < slot.length; candidateIndex++) {
      const candidate = slot[candidateIndex]!;
      if ((processed++ & 63) === 0 && (isCancelled() || performance.now() >= deadline)) {
        kept.push(...slot.slice(candidateIndex));
        break;
      }
      const isInitialIncumbent = candidate === incumbent.selection[slotIndex];
      const upperAttributes = new Array<number>(options.attributeIds.length).fill(0);
      let canBound = true;
      for (let attributeIndex = 0; attributeIndex < attributeIndexes.length; attributeIndex++) {
        const modelAttribute = attributeIndexes[attributeIndex]!;
        const rawUpper = equipmentVectors?.[candidateIndex]?.[modelAttribute]! +
          totalMaximums[attributeIndex]! - slotMaximums[slotIndex]![attributeIndex]!;
        const rawMaximum = model.rawMaximums[modelAttribute];
        if (!Number.isSafeInteger(rawUpper) || rawUpper < 0 || rawUpper > rawMaximum!) {
          canBound = false;
          break;
        }
        const foodBonuses = foodBonusTables.get(modelAttribute);
        const foodBonus = foodBonuses === undefined ? 0 : foodBonuses[rawUpper];
        const finalUpper = rawUpper + (foodBonus ?? 0);
        if (!Number.isSafeInteger(finalUpper) || finalUpper < 0) {
          canBound = false;
          break;
        }
        upperAttributes[modelAttribute] = finalUpper;
      }
      let upperFactors: IntegerDamageFactors | undefined;
      if (canBound) {
        try {
          upperFactors = factorEvaluator(upperAttributes);
        } catch {
          canBound = false;
        }
      }
      if (upperFactors !== undefined && safeDamageFactors(upperFactors)) {
        upperFactorsByCandidate.set(candidate, upperFactors);
      }
      if (isInitialIncumbent || !canBound || upperFactors === undefined || !safeDamageFactors(upperFactors) ||
        !candidateUpperBoundIsStrictlyWorse(incumbentFactors, upperFactors, useDps)) {
        kept.push(candidate);
      }
    }
    candidatesAfter += kept.length;
    prunedSlots.push(kept);
    candidateUpperFactorsBySlot.push(upperFactorsByCandidate);
  }
  return {
    slots: prunedSlots,
    candidateUpperFactorsBySlot,
    candidatesBefore,
    candidatesAfter,
    elapsedMs: performance.now() - startedAt,
  };
}

type ResourceBudgetCandidateQuery = {
  weights: readonly number[];
  attributes: readonly number[];
  budget: PreparedFactorResourceBudgetUpperBound;
};

type ResourceBudgetCandidateBoundResult = {
  bySlot: readonly ReadonlyMap<EquipInfo, bigint>[];
  budget: PreparedFactorResourceBudgetUpperBound;
  queryBudgets: readonly ResourceBudgetCandidateQuery[];
  additionalBudgetCount: number;
  candidateCount: number;
  supportCount: number;
  elapsedMs: number;
};

function prepareResourceBudgetCandidateBounds(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  groups: readonly FactorGroup[],
  resourceAttributeIndexes: ReadonlyMap<string, number | undefined>,
  deadline: number,
  isCancelled: () => boolean,
  includeAllCandidates = false,
): ResourceBudgetCandidateBoundResult | undefined {
  const startedAt = performance.now();
  const profile = options.resourceBudgetCandidateProfile ?? "default";
  if (profile === "disabled") return undefined;
  const resourceAxes = (["main", "weapon", "det", "ten", "crt", "dht", "gcd"] as const).flatMap((name) => {
    const attribute = resourceAttributeIndexes.get(name);
    return attribute === undefined ? [] : [[name, attribute] as const];
  });
  if (resourceAxes.length === 0 || model.equipmentAttributes.length !== options.slots.length) return undefined;

  const outsidePriorRanges = (equipment: EquipInfo): boolean => {
    if (!Number.isSafeInteger(equipment.itemLevel)) return false;
    const ranges = options.candidateItemLevelRanges;
    return ranges === undefined || ranges.length === 0 ||
      !ranges.some(({ min, max }) => equipment.itemLevel! >= min && equipment.itemLevel! <= max);
  };
  const includeCandidate = (equipment: EquipInfo) => includeAllCandidates || outsidePriorRanges(equipment);
  let candidateCount = 0;
  for (const slot of options.slots) for (const equipment of slot) {
    if (includeCandidate(equipment)) candidateCount++;
  }
  if (!Number.isSafeInteger(candidateCount) || candidateCount === 0) return undefined;

  const bluAdditionMaximum = options.job === "BLU"
    ? Math.max(0, ...(groups.find((group) => group.name === "main")?.classes
      .map((factorClass) => factorClass.auxiliary ?? 0) ?? [0]))
    : 0;
  const pricedGroups = groups.map((group) => ({
    classes: group.classes.map((factorClass) => ({
      min: group.name === "weapon"
        ? Math.max(0, factorClass.min - bluAdditionMaximum)
        : factorClass.min,
      // `prepareExactMipModel` 已将 GCD 的 q 转换为有符号 DPS 贡献（伤害模式下为零），
      // 因此这里保留精确的目标 q 值。
      score: factorClass.q,
    })),
  }));
  const budget = prepareFactorResourceBudgetUpperBound(pricedGroups, { maxWork: 250_000 });
  if (budget === undefined) return undefined;
  if (candidateCount * budget.supportCount > 500_000) return undefined;

  const maximumFoodResource = Math.max(0, ...options.foods.map((food) => {
    let total = 0;
    for (const [, attribute] of resourceAxes) {
      const attributeId = options.attributeIds[attribute];
      if (attributeId === undefined) return Number.NaN;
      const matching = food.baseParams.filter((parameter) => parameter.baseParamId === attributeId);
      if (matching.length > 1) return Number.NaN;
      const cap = matching[0]?.maxValue ?? 0;
      if (!Number.isSafeInteger(cap) || cap < 0 || !Number.isSafeInteger(total + cap)) return Number.NaN;
      total += cap;
    }
    return total;
  }));
  if (!Number.isSafeInteger(maximumFoodResource) || maximumFoodResource < 0) return undefined;

  const resourcesBySlot: number[][] = [];
  const slotMaximums: number[] = [];
  for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
    const vectors = model.equipmentAttributes[slotIndex];
    const candidates = options.slots[slotIndex]!;
    if (vectors === undefined || vectors.length !== candidates.length) return undefined;
    const resources = vectors.map((vector) => {
      let total = 0;
      for (const [, attribute] of resourceAxes) {
        const value = vector[attribute];
        if (!Number.isSafeInteger(value) || value! < 0 || !Number.isSafeInteger(total + value!)) return undefined;
        total += value!;
      }
      return total;
    });
    if (resources.length === 0 || resources.some((value) => value === undefined)) return undefined;
    resourcesBySlot.push(resources as number[]);
    slotMaximums.push((resources as number[]).reduce((maximum, value) => Math.max(maximum, value), 0));
  }
  const maximumGearResource = slotMaximums.reduce((total, maximum) => total + maximum, 0);
  const maximumResource = maximumGearResource + maximumFoodResource;
  if (!Number.isSafeInteger(maximumGearResource) || !Number.isSafeInteger(maximumResource)) return undefined;

  type WeightedCandidateBudget = {
    weights: readonly number[];
    budget: PreparedFactorResourceBudgetUpperBound;
    maximumFoodResource: number;
    resourcesBySlot: readonly (readonly number[])[];
    slotMaximums: readonly number[];
    maximumGearResource: number;
  };
  const additionalBudgets: WeightedCandidateBudget[] = [];
  let supportCount = budget.supportCount;
  const hasCandidatesBelow730 = options.slots.some((slot) => slot.some((equipment) =>
    Number.isSafeInteger(equipment.itemLevel) && equipment.itemLevel! < 730));
  if (profile === "weighted" || (profile === "default" && hasCandidatesBelow730)) {
    const axes = resourceAxes.map(([name]) => name);
    const allOnes = axes.map(() => 1);
    const priceVectors = [
      axes.map((name) => name === "main" || name === "weapon" ? 1 : 0),
      ...factorResourceWeightVectors(groups, axes),
    ];
    const uniquePriceVectors = [...new Map(priceVectors
      .filter((weights) => weights.length === axes.length &&
        weights.every((weight) => Number.isSafeInteger(weight) && weight >= 0) &&
        weights.some((weight) => weight > 0))
      .map((weights) => [weights.join(":"), weights] as const))];
    uniquePriceVectors.splice(0, uniquePriceVectors.length,
      ...uniquePriceVectors.filter(([key]) => key !== allOnes.join(":")));
    let remainingQueryWork = 500_000 - candidateCount * budget.supportCount;
    for (const [, weights] of uniquePriceVectors) {
      if (isCancelled()) return undefined;
      if (performance.now() >= deadline) break;
      const pricedGroups = groups.map((group) => {
        const axisIndex = axes.findIndex((name) => name === group.name);
        const weight = axisIndex < 0 ? 0 : weights[axisIndex]!;
        return {
          classes: group.classes.map((factorClass) => ({
            min: (group.name === "weapon"
              ? Math.max(0, factorClass.min - bluAdditionMaximum)
              : factorClass.min) * weight,
            score: factorClass.q,
          })),
        };
      });
      if (pricedGroups.some((group) => group.classes.some((factorClass) =>
        !Number.isSafeInteger(factorClass.min) || factorClass.min < 0))) continue;
      const weightedBudget = prepareFactorResourceBudgetUpperBound(pricedGroups, { maxWork: 50_000 });
      if (weightedBudget === undefined) continue;
      const queryWork = candidateCount * weightedBudget.supportCount;
      if (!Number.isSafeInteger(queryWork) || queryWork > remainingQueryWork) continue;

      const weightedFoodMaximum = Math.max(0, ...options.foods.map((food) => {
        let total = 0;
        for (let axisIndex = 0; axisIndex < resourceAxes.length; axisIndex++) {
          const [, attribute] = resourceAxes[axisIndex]!;
          const attributeId = options.attributeIds[attribute];
          if (attributeId === undefined) return Number.NaN;
          const matching = food.baseParams.filter((parameter) => parameter.baseParamId === attributeId);
          if (matching.length > 1) return Number.NaN;
          const cap = matching[0]?.maxValue ?? 0;
          const contribution = cap * weights[axisIndex]!;
          if (!Number.isSafeInteger(cap) || cap < 0 || !Number.isSafeInteger(contribution) ||
              !Number.isSafeInteger(total + contribution)) return Number.NaN;
          total += contribution;
        }
        return total;
      }));
      if (!Number.isSafeInteger(weightedFoodMaximum) || weightedFoodMaximum < 0) continue;

      const weightedResourcesBySlot: number[][] = [];
      const weightedSlotMaximums: number[] = [];
      let validWeightedResources = true;
      for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
        const vectors = model.equipmentAttributes[slotIndex];
        const candidates = options.slots[slotIndex]!;
        if (vectors === undefined || vectors.length !== candidates.length) return undefined;
        const resources = vectors.map((vector) => {
          let total = 0;
          for (let axisIndex = 0; axisIndex < resourceAxes.length; axisIndex++) {
            const [, attribute] = resourceAxes[axisIndex]!;
            const value = vector[attribute];
            const contribution = value! * weights[axisIndex]!;
            if (!Number.isSafeInteger(value) || value! < 0 || !Number.isSafeInteger(contribution) ||
                !Number.isSafeInteger(total + contribution)) {
              validWeightedResources = false;
              return undefined;
            }
            total += contribution;
          }
          return total;
        });
        if (resources.length === 0) return undefined;
        if (resources.some((value) => value === undefined)) {
          validWeightedResources = false;
          break;
        }
        weightedResourcesBySlot.push(resources as number[]);
        weightedSlotMaximums.push((resources as number[]).reduce((maximum, value) => Math.max(maximum, value), 0));
      }
      if (!validWeightedResources) continue;
      const weightedGearMaximum = weightedSlotMaximums.reduce((total, maximum) => total + maximum, 0);
      if (!Number.isSafeInteger(weightedGearMaximum) ||
          !Number.isSafeInteger(weightedGearMaximum + weightedFoodMaximum)) continue;
      additionalBudgets.push({
        weights,
        budget: weightedBudget,
        maximumFoodResource: weightedFoodMaximum,
        resourcesBySlot: weightedResourcesBySlot,
        slotMaximums: weightedSlotMaximums,
        maximumGearResource: weightedGearMaximum,
      });
      supportCount += weightedBudget.supportCount;
      remainingQueryWork -= queryWork;
    }
  }

  const bySlot: Map<EquipInfo, bigint>[] = [];
  let found = 0;
  for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
    if (isCancelled() || performance.now() >= deadline) return undefined;
    const candidates = options.slots[slotIndex]!;
    const outside = new Map<EquipInfo, bigint>();
    const otherGearMaximum = maximumGearResource - slotMaximums[slotIndex]!;
    if (!Number.isSafeInteger(otherGearMaximum) || otherGearMaximum < 0) return undefined;
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      if ((candidateIndex & 31) === 0 && (isCancelled() || performance.now() >= deadline)) return undefined;
      const equipment = candidates[candidateIndex]!;
      if (!includeCandidate(equipment)) continue;
      const candidateResource = resourcesBySlot[slotIndex]![candidateIndex]!;
      const candidateBudget = candidateResource + otherGearMaximum + maximumFoodResource;
      if (!Number.isSafeInteger(candidateBudget) || candidateBudget > maximumResource) return undefined;
      let scoreUpper = budget.query(candidateBudget);
      for (const weighted of additionalBudgets) {
        const weightedOtherMaximum = weighted.maximumGearResource - weighted.slotMaximums[slotIndex]!;
        const weightedCandidateBudget = weighted.resourcesBySlot[slotIndex]![candidateIndex]! +
          weightedOtherMaximum + weighted.maximumFoodResource;
        if (!Number.isSafeInteger(weightedOtherMaximum) || weightedOtherMaximum < 0 ||
            !Number.isSafeInteger(weightedCandidateBudget) || weightedCandidateBudget >
              weighted.maximumGearResource + weighted.maximumFoodResource) return undefined;
        const weightedUpper = weighted.budget.query(weightedCandidateBudget);
        if (weightedUpper !== undefined && (scoreUpper === undefined || weightedUpper < scoreUpper)) {
          scoreUpper = weightedUpper;
        }
      }
      if (scoreUpper !== undefined) {
        outside.set(equipment, scoreUpper);
        found++;
      }
    }
    bySlot.push(outside);
  }
  if (performance.now() >= deadline || isCancelled()) return undefined;
  return {
    bySlot,
    budget,
    queryBudgets: [
      {
        weights: resourceAxes.map(() => 1),
        attributes: resourceAxes.map(([, attribute]) => attribute),
        budget,
      },
      ...additionalBudgets.map(({ weights, budget: weightedBudget }) => ({
        weights,
        attributes: resourceAxes.map(([, attribute]) => attribute),
        budget: weightedBudget,
      })),
    ],
    additionalBudgetCount: additionalBudgets.length,
    candidateCount: found,
    supportCount,
    elapsedMs: performance.now() - startedAt,
  };
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
  /** 仅供联合求解使用的槽位布局；公开结果会根据 originalJob 重建。 */
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

function hasUniqueRingConflict(selection: readonly EquipInfo[]): boolean {
  const independentRings = new Map<0 | 1, EquipInfo>();
  for (const equipment of selection) {
    if ((equipment.ringSlotIndex === 0 || equipment.ringSlotIndex === 1) &&
      independentRings.has(equipment.ringSlotIndex)) return true;
    if (equipment.ringSlotIndex === 0 || equipment.ringSlotIndex === 1) {
      independentRings.set(equipment.ringSlotIndex, equipment);
    }
    const pair = ringPairCandidate(equipment);
    if (pair === undefined || pair.ringEquips[0].itemId !== pair.ringEquips[1].itemId) continue;
    const metadata = pair.ringUniqueByItemId?.find(([itemId]) => itemId === pair.ringEquips[0].itemId)?.[1];
    if (metadata === true || pair.ringEquips.some((ring) => ring.isUnique === true)) return true;
  }
  const first = independentRings.get(0);
  const second = independentRings.get(1);
  return first !== undefined && second !== undefined && first.itemId === second.itemId &&
    (first.isUnique === true || second.isUnique === true);
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
    options: inheritCanonicalEvaluatorCandidateUpperBound(job.options, { ...job.options, slots }),
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

/** 乘积仅用于必要的上界筛选；候选排序使用精确总和。 */
export async function findBestJointFactorMip(options: {
  jobs: readonly JointMipJob[];
  commonSlots: readonly string[];
  commonSlotProjections?: readonly SharedSlotProjection[];
  sharedFood: boolean;
  equipmentIdentity: (equipment: EquipInfo) => string;
  foodIdentity: (food: FoodInfo) => string;
  objective: "damage" | "dps";
  /** 完全共享且未强制指定的戒指对所用的内部对称性破除策略。 */
  canonicalSharedRingPair?: boolean;
  /** 默认为当前精确松弛；禁用时跳过可选的配对上界约束行。 */
  ratioUpperPairPolicy?: "default" | "disabled";
  /** 精确优化器内部路径；仅添加严格且替换安全的首饰对支配约束行。 */
  sharedAccessoryPairDominance?: boolean;
  initialResults?: readonly ExactMipResult[];
  maxSearchMs?: number;
  onProgress?: (message: string) => void;
  onSolverProgress?: (event: LinearMipProgress) => void;
  onSolverCallback?: (event: HighsCallbackTrace) => void;
  isCancelled?: () => boolean;
}): Promise<{
  results: ExactMipResult[];
  solverRuns: number;
  signatures: number;
  innerSolverStatus: "Optimal" | "DualBound";
} | undefined> {
  const startedAt = performance.now();
  const jointMaxSearchMs = options.maxSearchMs;
  const jointPreprocessingBudgetBaseMs = jointMaxSearchMs ?? 235_000;
  const jointTimeLimitReached = () =>
    jointMaxSearchMs !== undefined && performance.now() - startedAt >= jointMaxSearchMs;
  const isCancelled = options.isCancelled ?? (() => options.jobs.some((job) => job.options.isCancelled?.() === true));
  const sharedAccessoryPairDominanceEnabled = canUseSharedAccessoryPairDominance({
    trustedPolicyPath: hasSharedAccessoryPairDominancePath(options),
    requested: options.sharedAccessoryPairDominance === true,
    jobs: options.jobs.map(({ id, options: jobOptions }) => ({
      id,
      job: jobOptions.job,
      objective: jobOptions.objective,
      hasCanonicalEvaluator: hasCanonicalEvaluatorCandidateUpperBound(jobOptions),
      hasCustomAttributeExtractor: jobOptions.equipmentAttributeExtractor !== undefined,
      hasConstraints: Object.values(jobOptions.constraints ?? {}).some((value) => value !== undefined),
    })),
    commonSlots: options.commonSlots,
    hasCommonSlotProjections: (options.commonSlotProjections?.length ?? 0) > 0,
    sharedFood: options.sharedFood,
    objective: options.objective,
    canonicalSharedRingPair: options.canonicalSharedRingPair === true,
  });
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
  const jointJobs: readonly JointMipJob[] = options.jobs;
  const providedInitialResults = options.initialResults;
  throwIfCancelled(isCancelled);
  const preparedJobs: JointPreparedJob[] = [];
  const modelPreparationStartedAt = performance.now();
  for (let jobIndex = 0; jobIndex < jointJobs.length; jobIndex++) {
    throwIfCancelled(isCancelled);
    const originalJob = jointJobs[jobIndex]!;
    const ringSplit = activeRingSplits[jobIndex];
    const job = ringSplit === undefined
      ? originalJob
      : expandJointRingPairDomain(originalJob, ringSplit);
    const jobModelOptions = inheritCanonicalEvaluatorCandidateUpperBound(job.options, {
      ...job.options,
      objective: options.objective,
    });
    const prepared = await prepareExactMipModel(jobModelOptions, true);
    throwIfCancelled(isCancelled);
    if (prepared === undefined) return undefined;
    preparedJobs.push({ job, originalJob, ...(ringSplit === undefined ? {} : { ringSplit }), prepared });
  }
  const canonicalRingRanks = new Map<string, number>();
  const canonicalRingSlotIndexes: { firstSlotIndex: number; secondSlotIndex: number }[] = [];
  if (options.canonicalSharedRingPair) {
    if (!options.commonSlots.includes("ring") || !options.commonSlots.includes("ring2") ||
      projections.has("ring") || projections.has("ring2") ||
      preparedJobs.some(({ job }) => job.options.equipmentAttributeExtractor !== undefined)) {
      throw new RangeError("共享完整戒指对的规范排序仅支持无投影、默认属性提取的对称槽位");
    }
    const allIdentities = new Set<string>();
    for (const { job } of preparedJobs) {
      const firstSlotIndex = job.slotNames.indexOf("ring");
      const secondSlotIndex = job.slotNames.indexOf("ring2");
      const firstSlot = job.options.slots[firstSlotIndex];
      const secondSlot = job.options.slots[secondSlotIndex];
      if (firstSlotIndex < 0 || secondSlotIndex < 0 || firstSlot === undefined || secondSlot === undefined ||
        job.slotNames.lastIndexOf("ring") !== firstSlotIndex || job.slotNames.lastIndexOf("ring2") !== secondSlotIndex) {
        throw new RangeError(`共享完整戒指对缺少独立戒指槽：${job.id}`);
      }
      const collectIdentities = (slot: readonly EquipInfo[], expectedIndex: 0 | 1) => {
        const identities = new Set<string>();
        for (const equipment of slot) {
          if (equipment.ringSlotIndex !== expectedIndex || !Number.isSafeInteger(equipment.itemId) ||
            typeof equipment.isUnique !== "boolean") {
            throw new RangeError(`共享完整戒指对候选缺少槽位或唯一性元数据：${job.id}`);
          }
          identities.add(options.equipmentIdentity(equipment));
        }
        return identities;
      };
      const firstIdentities = collectIdentities(firstSlot, 0);
      const secondIdentities = collectIdentities(secondSlot, 1);
      if (firstIdentities.size === 0 || firstIdentities.size !== secondIdentities.size ||
        [...firstIdentities].some((identity) => !secondIdentities.has(identity))) {
        throw new RangeError(`共享完整戒指对的两个槽位候选身份不对称：${job.id}`);
      }
      canonicalRingSlotIndexes.push({ firstSlotIndex, secondSlotIndex });
      for (const identity of firstIdentities) allIdentities.add(identity);
    }
    [...allIdentities].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      .forEach((identity, rank) => canonicalRingRanks.set(identity, rank));
  }
  if (providedInitialResults !== undefined && providedInitialResults.length !== preparedJobs.length) {
    throw new Error("联合初始方案职业数不匹配");
  }
  const jointInitialResults = providedInitialResults?.map((result, jobIndex) => {
    if (!options.canonicalSharedRingPair) return result;
    const { firstSlotIndex, secondSlotIndex } = canonicalRingSlotIndexes[jobIndex]!;
    const first = result.selection[firstSlotIndex];
    const second = result.selection[secondSlotIndex];
    if (first === undefined || second === undefined) return result;
    const firstIdentity = options.equipmentIdentity(first);
    const secondIdentity = options.equipmentIdentity(second);
    if (canonicalRingRanks.get(firstIdentity)! <= canonicalRingRanks.get(secondIdentity)!) return result;
    const firstReplacement = jointJobs[jobIndex]!.options.slots[firstSlotIndex]!
      .find((equipment) => options.equipmentIdentity(equipment) === secondIdentity);
    const secondReplacement = jointJobs[jobIndex]!.options.slots[secondSlotIndex]!
      .find((equipment) => options.equipmentIdentity(equipment) === firstIdentity);
    if (firstReplacement === undefined || secondReplacement === undefined) {
      throw new Error(`共享完整戒指对无法规范化初始方案：${jointJobs[jobIndex]!.id}`);
    }
    const selection = [...result.selection];
    selection[firstSlotIndex] = firstReplacement;
    selection[secondSlotIndex] = secondReplacement;
    return { ...result, selection };
  });
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
    // 每个联合可行职业的结果都受其独立证明的最优值约束。
    // 显式添加上界还能防止 LP 松弛用不可能的超最优职业结果，抵消其他职业的次优结果。
    addRows(rows, `solo_bound_${index}`, terms, "<=", individualBaselineQ + groups.length - offset);
  }
  if (options.canonicalSharedRingPair) {
    for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
      const { job, prepared } = preparedJobs[jobIndex]!;
      const { firstSlotIndex, secondSlotIndex } = canonicalRingSlotIndexes[jobIndex]!;
      const terms = new Map<string, number>();
      for (const [slotIndex, direction] of [[firstSlotIndex, 1], [secondSlotIndex, -1]] as const) {
        job.options.slots[slotIndex]!.forEach((equipment, candidateIndex) => {
          const rank = canonicalRingRanks.get(options.equipmentIdentity(equipment));
          if (rank === undefined) throw new Error(`共享戒指身份缺少规范排序：${job.id}`);
          if (rank !== 0) addTerm(terms, prefix(jobIndex, prepared.model.slotVariables[slotIndex]![candidateIndex]!), rank * direction);
        });
      }
      addRows(rows, prefix(jobIndex, "canonical_shared_ring_pair"), terms, "<=", 0);
    }
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
    // 必须显式禁用不属于交集的选择。
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
    attributes?: readonly number[];
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
        const attributes = projections.has(slot)
          ? undefined
          : prepared.model.equipmentAttributes[slotIndex]?.[candidateIndex];
        const entry = byKey.get(key);
        if (entry === undefined) {
          byKey.set(key, {
            equipment: projected,
            variables: [],
            ...(attributes === undefined ? {} : { attributes }),
          });
        } else if (attributes === undefined || entry.attributes === undefined ||
          attributes.length !== entry.attributes.length ||
          attributes.some((value, index) => value !== entry.attributes![index])) {
          delete entry.attributes;
        }
        const linkedEntry = byKey.get(key)!;
        linkedEntry.variables.push(prefix(jobIndex, prepared.model.slotVariables[slotIndex]![candidateIndex]!));
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
  // 保留通用属性档案：其中包含每个职业的提取器和属性坐标。
  // 单个投影戒指按其完整实体身份共享，另一枚戒指则可在每个完整且满足唯一性规则的戒指对候选中自由选择。
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
          const attributeToken = attributeId < 0 ? `n${-attributeId}` : `p${attributeId}`;
          addRows(rows, `shared_profile_${targetJob}_${attributeToken}_${sourceJob}`, terms, "=", 0);
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
      // 两个投影可能指向同一完整的戒指对。计算配对属性和前，
      // 先将两个身份都与合法戒指对候选求交集。
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

    // 只能选择一种食物。对每个坐标分别保留固定食物键允许的食物中，
    // 经精确封顶后的最大加成。
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
  const resourceBudgetScoreUpperForAttributes = (
    jobIndex: number,
    attributes: readonly number[],
  ): bigint | undefined => {
    const budgets = factorResourceBudgetByJob[jobIndex];
    if (budgets === undefined) return undefined;
    let bestUpper: bigint | undefined;
    for (const weighted of budgets) {
      if (weighted.weights.length !== weighted.attributes.length) return undefined;
      let totalResource = 0;
      for (let index = 0; index < weighted.attributes.length; index++) {
        const value = attributes[weighted.attributes[index]!];
        const contribution = value! * weighted.weights[index]!;
        if (!Number.isSafeInteger(value) || value! < 0 ||
          !Number.isSafeInteger(contribution) || !Number.isSafeInteger(totalResource + contribution)) {
          return undefined;
        }
        totalResource += contribution;
      }
      // `coordinateUpperAttributes` 分别最大化各资源轴，
      // 因而每个加权和都能约束此共享前缀的所有补全方案。
      const upper = weighted.budget.query(totalResource);
      if (upper !== undefined && (bestUpper === undefined || upper < bestUpper)) bestUpper = upper;
    }
    return bestUpper;
  };
  const exactUpperRatio = (jobIndex: number, attributes: readonly number[]): ExactRatio | undefined => {
    const { job, prepared } = preparedJobs[jobIndex]!;
    const factors = prepared.factorEvaluator(attributes);
    if (factors === undefined || ![
      factors.weaponDamage,
      factors.mainStat,
      factors.determination,
      factors.tenacity,
      factors.critical,
      factors.directHit,
      factors.gcdCentiseconds,
    ].every((value) => Number.isSafeInteger(value) && value > 0)) return undefined;
    return {
      numerator: exactProduct(factors) * (options.objective === "dps" ? BigInt(job.baseline.gcdCentiseconds) : 1n),
      denominator: exactProduct(job.baseline) * (options.objective === "dps" ? BigInt(factors.gcdCentiseconds) : 1n),
    };
  };
  type CandidateSpecificUpperBound = {
    variable: string;
    rowName: string;
    ratio: ExactRatio;
  };
  const candidateSpecificUpperBounds: CandidateSpecificUpperBound[] = [];
  let candidateSpecificUpperBoundPreparationMs = 0;
  let candidateSpecificUpperBoundSkippedJobs = 0;
  const candidateSpecificUpperBoundPreparationStartedAt = performance.now();
  const candidateSpecificUpperBoundPreparationBudgetMs = Math.min(
    500,
    Math.max(10, jointPreprocessingBudgetBaseMs * 0.02),
  );
  for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
    const { job, prepared } = preparedJobs[jobIndex]!;
    if (job.options.equipmentAttributeExtractor !== undefined ||
      job.options.constraints?.maxToughnessMode === true || job.options.job === "BLU") {
      candidateSpecificUpperBoundSkippedJobs++;
      continue;
    }
    if (![job.baseline.weaponDamage, job.baseline.mainStat, job.baseline.determination,
      job.baseline.tenacity, job.baseline.critical, job.baseline.directHit,
      job.baseline.gcdCentiseconds].every((value) => Number.isSafeInteger(value) && value > 0)) {
      candidateSpecificUpperBoundSkippedJobs++;
      continue;
    }
    const equipmentAttributes = prepared.model.equipmentAttributes;
    if (equipmentAttributes.some((slot) => slot.some((attributes) =>
      attributes.length !== job.options.attributeIds.length ||
      attributes.some((value) => !Number.isSafeInteger(value)))) ||
      prepared.model.rawMaximums.some((value) => !Number.isSafeInteger(value))) {
      candidateSpecificUpperBoundSkippedJobs++;
      continue;
    }
    type FoodBonusBound = {
      attribute: number;
      numerator: number;
      denominator: number;
      cap: number;
      baseValue: number;
    };
    const foodBonusBoundsByFood = new Map<number, Map<number, FoodBonusBound[]>>();
    let validFoodBounds = true;
    for (const food of job.options.foods) {
      const seenAttributes = new Set<number>();
      for (const param of food.baseParams) {
        if (seenAttributes.has(param.baseParamId)) {
          validFoodBounds = false;
          break;
        }
        seenAttributes.add(param.baseParamId);
      }
      if (!validFoodBounds) break;
    }
    for (const bonus of prepared.model.foodBonuses) {
      if (!validFoodBounds) break;
      const food = job.options.foods[bonus.foodIndex];
      const attributeId = job.options.attributeIds[bonus.attribute];
      const param = food?.baseParams.find((entry) => entry.baseParamId === attributeId);
      if (food === undefined || attributeId === undefined || param === undefined ||
        !Number.isSafeInteger(param.baseValue ?? 0) ||
        !Number.isSafeInteger(bonus.numerator) || bonus.numerator < 0 ||
        !Number.isSafeInteger(bonus.denominator) || bonus.denominator <= 0 ||
        !Number.isSafeInteger(bonus.cap) || bonus.cap < 0) {
        validFoodBounds = false;
        break;
      }
      const byAttribute = foodBonusBoundsByFood.get(bonus.foodIndex) ?? new Map<number, FoodBonusBound[]>();
      const boundsForAttribute = byAttribute.get(bonus.attribute) ?? [];
      if (boundsForAttribute.length > 0) {
        // 规范求值器会针对逐步更新后的属性累加重复食物约束行。
        // 跳过这个可选上界，避免根据单个原始坐标计算出过低的估计值。
        validFoodBounds = false;
        break;
      }
      boundsForAttribute.push({
        attribute: bonus.attribute,
        numerator: bonus.numerator,
        denominator: bonus.denominator,
        cap: bonus.cap,
        baseValue: param.baseValue ?? 0,
      });
      byAttribute.set(bonus.attribute, boundsForAttribute);
      foodBonusBoundsByFood.set(bonus.foodIndex, byAttribute);
    }
    if (!validFoodBounds) {
      candidateSpecificUpperBoundSkippedJobs++;
      continue;
    }
    let jobPreprocessingComplete = true;
    for (let slotIndex = 0; slotIndex < job.options.slots.length && jobPreprocessingComplete; slotIndex++) {
      const candidates = job.options.slots[slotIndex]!;
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
        if ((candidateIndex & 255) === 0) {
          throwIfCancelled(isCancelled);
          if (performance.now() - candidateSpecificUpperBoundPreparationStartedAt >=
            candidateSpecificUpperBoundPreparationBudgetMs ||
            jointTimeLimitReached()) {
            jobPreprocessingComplete = false;
            break;
          }
        }
        const rawUpper = [...equipmentAttributes[slotIndex]![candidateIndex]!];
        for (let otherSlot = 0; otherSlot < job.options.slots.length; otherSlot++) {
          if (otherSlot === slotIndex) continue;
          for (let attribute = 0; attribute < rawUpper.length; attribute++) {
            rawUpper[attribute] += gearSlotMaximums[jobIndex]![otherSlot]![attribute]!;
          }
        }
        if (rawUpper.some((value) => !Number.isSafeInteger(value))) continue;

        // 食物必须整体选择。对不同食物分别取各坐标最大值，
        // 这样会放宽食物间的耦合，同时保留每项精确的向下取整和上限规则。
        const foodBonusUpper = new Array<number>(rawUpper.length).fill(0);
        let validCandidateFoodUpper = true;
        for (const byAttribute of foodBonusBoundsByFood.values()) {
          for (const [attribute, boundsForAttribute] of byAttribute) {
            const bonus = boundsForAttribute[0]!;
            const rawWithBase = BigInt(rawUpper[attribute]!) + BigInt(bonus.baseValue);
            if (rawWithBase < 0n) {
              validCandidateFoodUpper = false;
              break;
            }
            const uncapped = BigInt(bonus.numerator) * rawWithBase / BigInt(bonus.denominator);
            const foodBonus = uncapped >= BigInt(bonus.cap) ? BigInt(bonus.cap) : uncapped;
            foodBonusUpper[attribute] = Math.max(foodBonusUpper[attribute]!, Number(foodBonus));
          }
          if (!validCandidateFoodUpper) break;
        }
        if (!validCandidateFoodUpper) continue;
        const attributes = rawUpper.map((value, attribute) => value + foodBonusUpper[attribute]!);
        if (attributes.some((value) => !Number.isSafeInteger(value))) continue;
        const ratio = exactUpperRatio(jobIndex, attributes);
        if (ratio === undefined || ratio.denominator <= 0n) continue;
        candidateSpecificUpperBounds.push({
          variable: prefix(jobIndex, prepared.model.slotVariables[slotIndex]![candidateIndex]!),
          rowName: "joint_candidate_upper_" + jobIndex + "_" + slotIndex + "_" + candidateIndex,
          ratio,
        });
      }
    }
    if (!jobPreprocessingComplete) candidateSpecificUpperBoundSkippedJobs++;
  }
  type ResourceBudgetCandidateUpperBound = {
    jobIndex: number;
    variable: string;
    rowName: string;
    scoreUpper: bigint;
    baselineScore: bigint;
    roundingSlack: bigint;
  };
  const resourceBudgetCandidateUpperBounds: ResourceBudgetCandidateUpperBound[] = [];
  const factorResourceBudgetByJob: (readonly ResourceBudgetCandidateQuery[] | undefined)[] =
    new Array(preparedJobs.length).fill(undefined);
  let resourceBudgetCandidateUpperBoundSkippedJobs = 0;
  let resourceBudgetCandidateUpperBoundPreparationMs = 0;
  const resourceBudgetCandidateUpperBoundPreparationStartedAt = performance.now();
  const resourceBudgetCandidateUpperBoundProofRows = new Map<string, ModelRow>();
  for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
    // 在四职业和五职业档位中，逐候选资源查询没有产生剪枝，
    // 反而显著降低了共享前缀预处理的效率。
    if (preparedJobs.length >= 4) {
      resourceBudgetCandidateUpperBoundSkippedJobs++;
      continue;
    }
    const { job, prepared } = preparedJobs[jobIndex]!;
    const resourceBudgetProfile = job.options.resourceBudgetCandidateProfile ?? "default";
    if (resourceBudgetProfile === "disabled") {
      resourceBudgetCandidateUpperBoundSkippedJobs++;
      continue;
    }
    if (job.options.equipmentAttributeExtractor !== undefined ||
      job.options.constraints?.maxToughnessMode === true || job.options.job === "BLU") {
      resourceBudgetCandidateUpperBoundSkippedJobs++;
      continue;
    }
    const remainingPreparationMs = candidateSpecificUpperBoundPreparationBudgetMs -
      (performance.now() - candidateSpecificUpperBoundPreparationStartedAt);
    if (remainingPreparationMs <= 0) {
      resourceBudgetCandidateUpperBoundSkippedJobs++;
      continue;
    }
    const resourceBudgetDeadline = Math.min(
      candidateSpecificUpperBoundPreparationStartedAt + candidateSpecificUpperBoundPreparationBudgetMs,
      performance.now() + Math.min(150, remainingPreparationMs / Math.max(1, preparedJobs.length - jobIndex)),
    );
    const resourceBounds = prepareResourceBudgetCandidateBounds(
      job.options,
      prepared.model,
      prepared.groups,
      new Map([
        ["main", prepared.mainAttribute], ["weapon", prepared.weaponAttribute],
        ["det", prepared.detAttribute], ["ten", prepared.tenAttribute],
        ["crt", prepared.crtAttribute], ["dht", prepared.dhtAttribute],
        ["gcd", prepared.speedAttribute],
      ]),
      resourceBudgetDeadline,
      () => isCancelled(),
      true,
    );
    if (resourceBounds === undefined || resourceBounds.bySlot.length !== job.options.slots.length ||
      resourceBounds.bySlot.some((slot, slotIndex) =>
        job.options.slots[slotIndex]!.length !== prepared.model.slotVariables[slotIndex]!.length ||
        slot.size === 0)) {
      resourceBudgetCandidateUpperBoundSkippedJobs++;
      continue;
    }
    factorResourceBudgetByJob[jobIndex] = resourceBudgetProfile === "weighted"
      ? resourceBounds.queryBudgets
      : resourceBounds.queryBudgets.slice(0, 1);
    const baselineScore = BigInt(factorObjectiveLogScore(job.baseline, prepared.useDps));
    const roundingSlack = BigInt(prepared.groups.length);
    for (let slotIndex = 0; slotIndex < job.options.slots.length; slotIndex++) {
      const candidates = job.options.slots[slotIndex]!;
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
        const scoreUpper = resourceBounds.bySlot[slotIndex]!.get(candidates[candidateIndex]!);
        if (scoreUpper === undefined) continue;
        resourceBudgetCandidateUpperBounds.push({
          jobIndex,
          variable: prefix(jobIndex, prepared.model.slotVariables[slotIndex]![candidateIndex]!),
          rowName: `joint_candidate_resource_upper_${jobIndex}_${slotIndex}_${candidateIndex}`,
          scoreUpper,
          baselineScore,
          roundingSlack,
        });
      }
    }
  }
  resourceBudgetCandidateUpperBoundPreparationMs =
    performance.now() - resourceBudgetCandidateUpperBoundPreparationStartedAt;
  candidateSpecificUpperBoundPreparationMs =
    performance.now() - candidateSpecificUpperBoundPreparationStartedAt;
  const useResourceBudgetSharedPrefixBounds = preparedJobs.length < 4 &&
    factorResourceBudgetByJob.some((budget) => budget !== undefined);
  type FactorClassUpperBound = {
    jobIndex: number;
    groupName: string;
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
          groupName: group.name,
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
          groupName: gcdGroup.name,
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
  const compareExactRatios = (left: ExactRatio, right: ExactRatio) => {
    const comparison = left.numerator * right.denominator - right.numerator * left.denominator;
    return comparison < 0n ? -1 : comparison > 0n ? 1 : 0;
  };
  const factorClassUpperBoundsByJobAndGroup = preparedJobs.map(({ prepared }, jobIndex) => {
    const groups = new Map(prepared.groups.map((group) => [group.name, [] as FactorClassUpperBound[]] as const));
    for (const bound of factorClassUpperBounds) {
      if (bound.jobIndex === jobIndex) groups.get(bound.groupName)?.push(bound);
    }
    for (const boundsForGroup of groups.values()) {
      boundsForGroup.sort((left, right) => compareExactRatios(left.ratio, right.ratio) ||
        left.variable.localeCompare(right.variable));
    }
    return groups;
  });
  const ratioUpperBoundScale = 1_000_000_000n;
  const ratioUpperBoundVariables = preparedJobs.map((_, jobIndex) => "joint_ratio_upper_" + jobIndex);
  const ratioUpperBoundObjectiveEnabled = true;
  const ratioUpperBoundObjective = new Map<string, number>();
  let ratioUpperBoundPairCutCount = 0;
  let ratioUpperBoundPairPreprocessingWork = 0;
  const ratioUpperCoefficientExact = (ratio: ExactRatio): bigint => {
    const scaled = (ratio.numerator * ratioUpperBoundScale + ratio.denominator - 1n) / ratio.denominator;
    return scaled >= ratioUpperBoundScale ? ratioUpperBoundScale : scaled;
  };
  const ratioUpperCoefficient = (ratio: ExactRatio): number =>
    Number(ratioUpperCoefficientExact(ratio));
  for (let jobIndex = 0; jobIndex < ratioUpperBoundVariables.length; jobIndex++) {
    const name = ratioUpperBoundVariables[jobIndex]!;
    bounds.push({ name, min: 0, max: Number(ratioUpperBoundScale) });
    generals.push(name);
    const groups = preparedJobs[jobIndex]!.prepared.groups.filter((group) =>
      group.name !== "gcd" || options.objective === "dps");
    for (const group of groups) {
      const classBounds = factorClassUpperBounds.filter((bound) =>
        bound.jobIndex === jobIndex && bound.groupName === group.name);
      if (classBounds.length !== group.classes.length) {
        throw new Error(`联合因子上界缺少完整类别：${jobIndex}/${group.name}`);
      }
      const terms = new Map<string, number>([[name, 1]]);
      for (const bound of classBounds) {
        terms.set(prefix(jobIndex, bound.variable), -ratioUpperCoefficient(bound.ratio));
      }
      addRows(rows, `joint_ratio_upper_${jobIndex}_${group.name}`, terms, "<=", 0);
    }
  }

  // 单因子上界可能会把其他组中彼此不兼容的最大值组合起来。
  // 同时约束两个不同组，可以收紧 q。单组原始最大值共用精确包络 U*：U_ab = U_a*U_b/U*。
  const pairCutCandidates: {
    jobIndex: number;
    rowName: string;
    anchorVariable: string;
    anchorCoefficient: number;
    otherVariables: readonly string[];
    otherCoefficients: readonly number[];
    rhs: number;
    tightening: number;
  }[] = [];
  const pairCutRowLimit = preparedJobs.length === 2 ? 512 : 256;
  const pairCutNonzeroLimit = preparedJobs.length === 2 ? 150_000 : 50_000;
  const pairPreprocessingWorkLimit = preparedJobs.length === 2 ? 300_000 : 50_000;
  const pairWorkLimitPerJob = Math.floor(pairPreprocessingWorkLimit / ratioUpperBoundVariables.length);
  const preferredPairRanks = new Map([
    ["crt|dht", 0],
    ["det|gcd", 1],
    ["crt|gcd", 2],
  ]);
  for (let jobIndex = 0; jobIndex < ratioUpperBoundVariables.length; jobIndex++) {
    if (options.ratioUpperPairPolicy === "disabled") continue;
    const groups = preparedJobs[jobIndex]!.prepared.groups.filter((group) =>
      group.name !== "gcd" || options.objective === "dps");
    const upperBoundsByGroup = groups.map((group) => ({
      group,
      bounds: group.classes.map((factorClass) => factorClassUpperBounds.find((entry) =>
        entry.jobIndex === jobIndex && entry.groupName === group.name &&
        entry.variable === factorClass.variable)),
    }));
    const groupMaxima: FactorClassUpperBound[] = [];
    let completePairDomain = true;
    for (const { bounds: classBounds, group } of upperBoundsByGroup) {
      const validBounds = classBounds.filter((entry): entry is FactorClassUpperBound => entry !== undefined);
      if (validBounds.length !== group.classes.length || validBounds.length === 0) {
        completePairDomain = false;
        break;
      }
      groupMaxima.push(validBounds.reduce((maximum, entry) =>
        compareExactRatios(entry.ratio, maximum.ratio) > 0 ? entry : maximum));
    }
    if (!completePairDomain) continue;
    const commonEnvelope = groupMaxima[0]?.ratio;
    if (commonEnvelope === undefined || groupMaxima.some((maximum) =>
      compareExactRatios(maximum.ratio, commonEnvelope) !== 0)) continue;

    const groupPairs: {
      left: typeof upperBoundsByGroup[number];
      right: typeof upperBoundsByGroup[number];
      combinations: number;
      priority: number;
    }[] = [];
    for (let leftIndex = 0; leftIndex < upperBoundsByGroup.length; leftIndex++) {
      const left = upperBoundsByGroup[leftIndex]!;
      if (left.bounds.length < 2) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < upperBoundsByGroup.length; rightIndex++) {
        const right = upperBoundsByGroup[rightIndex]!;
        if (right.bounds.length < 2) continue;
        const combinations = left.bounds.length * right.bounds.length;
        const key = [left.group.name, right.group.name].sort().join("|");
        groupPairs.push({
          left,
          right,
          combinations,
          priority: preferredPairRanks.get(key) ?? Number.MAX_SAFE_INTEGER,
        });
      }
    }
    groupPairs.sort((left, right) => left.priority - right.priority ||
      left.combinations - right.combinations ||
      `${left.left.group.name}|${left.right.group.name}`.localeCompare(
        `${right.left.group.name}|${right.right.group.name}`));

    let jobPairWork = 0;
    for (const pair of groupPairs) {
      if (pairWorkLimitPerJob <= 0 || pair.combinations > pairWorkLimitPerJob - jobPairWork) continue;
      jobPairWork += pair.combinations;
      ratioUpperBoundPairPreprocessingWork += pair.combinations;
      const pairCoefficients: number[][] = [];
      for (const leftBound of pair.left.bounds) {
        const row: number[] = [];
        for (const rightBound of pair.right.bounds) {
          const numerator = leftBound!.ratio.numerator * rightBound!.ratio.numerator * commonEnvelope.denominator;
          const denominator = leftBound!.ratio.denominator * rightBound!.ratio.denominator * commonEnvelope.numerator;
          if (denominator <= 0n) {
            row.push(Number(ratioUpperBoundScale));
            continue;
          }
          let coefficient = ratioUpperCoefficientExact({ numerator, denominator });
          coefficient = coefficient < ratioUpperCoefficientExact(leftBound!.ratio)
            ? coefficient
            : ratioUpperCoefficientExact(leftBound!.ratio);
          const rightSingleCoefficient = ratioUpperCoefficientExact(rightBound!.ratio);
          if (coefficient > rightSingleCoefficient) coefficient = rightSingleCoefficient;
          row.push(Number(coefficient));
        }
        pairCoefficients.push(row);
      }

      const addAnchoredRows = (
        anchor: typeof pair.left,
        other: typeof pair.right,
        coefficients: readonly (readonly number[])[],
        reverse: boolean,
      ) => {
        for (let anchorIndex = 0; anchorIndex < anchor.bounds.length; anchorIndex++) {
          const anchorBound = anchor.bounds[anchorIndex]!;
          const classCoefficients = other.bounds.map((_, otherIndex) =>
            reverse ? coefficients[otherIndex]![anchorIndex]! : coefficients[anchorIndex]![otherIndex]!);
          const minimumPairCoefficient = classCoefficients.reduce((minimum, coefficient) =>
            Math.min(minimum, coefficient), Number.MAX_SAFE_INTEGER);
          const anchorSingleCoefficient = Number(ratioUpperCoefficientExact(anchorBound!.ratio));
          if (minimumPairCoefficient >= anchorSingleCoefficient) continue;
          const activation = Number(ratioUpperBoundScale) - minimumPairCoefficient;
          if (activation <= 0) continue;
          const rowName = `joint_ratio_pair_upper_${jobIndex}_${anchor.group.name}_${anchorIndex}_${other.group.name}`;
          pairCutCandidates.push({
            jobIndex,
            rowName,
            anchorVariable: prefix(jobIndex, anchorBound!.variable),
            anchorCoefficient: activation,
            otherVariables: other.bounds.map((entry) => prefix(jobIndex, entry!.variable)),
            otherCoefficients: classCoefficients,
            rhs: activation,
            tightening: activation,
          });
        }
      };
      addAnchoredRows(pair.left, pair.right, pairCoefficients, false);
      addAnchoredRows(pair.right, pair.left, pairCoefficients, true);
    }
  }
  pairCutCandidates.sort((left, right) => right.tightening - left.tightening ||
    left.otherVariables.length - right.otherVariables.length ||
    left.rowName.localeCompare(right.rowName));
  let selectedPairCutNonzeros = 0;
  for (const cut of pairCutCandidates) {
    const nonzeros = cut.otherVariables.length + 2;
    if (ratioUpperBoundPairCutCount >= pairCutRowLimit ||
      selectedPairCutNonzeros + nonzeros > pairCutNonzeroLimit) continue;
    addRows(rows, cut.rowName, [
      [ratioUpperBoundVariables[cut.jobIndex]!, 1],
      [cut.anchorVariable, cut.anchorCoefficient],
      ...cut.otherVariables.map((variable, index) => [variable, -cut.otherCoefficients[index]!] as const),
    ], "<=", cut.rhs);
    ratioUpperBoundPairCutCount++;
    selectedPairCutNonzeros += nonzeros;
  }
  ratioUpperBoundVariables.forEach((name) => ratioUpperBoundObjective.set(name, 1));
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
    jobRatios: readonly ExactRatio[];
  };
  type SharedAssignmentUpperBound = {
    selectors: readonly string[];
    rowName: string;
    jobRatios: readonly ExactRatio[];
    jobScoreUppers?: readonly (bigint | undefined)[];
  };
  const sharedPairCandidateUpperBound = sharedKeyDomains.reduce((total, domain, index) => {
    for (let other = index + 1; other < sharedKeyDomains.length; other++) {
      total += BigInt(domain.selectors.size) * BigInt(sharedKeyDomains[other]!.selectors.size);
    }
    return total;
  }, 0n);
  const sharedPairCandidateLimit = 50_000n;
  let sharedPairCandidateCount = 0;
  let sharedPairCandidatesEvaluated = 0;
  let sharedPairPreprocessingMs = performance.now() - sharedBoundPreprocessingStartedAt;
  let sharedPairPreprocessingSkipped = false;
  let sharedPairUpperBounds: SharedPairUpperBound[] | undefined;
  const sharedAssignmentCandidateUpperBound = sharedKeyDomains.reduce((product, domain) =>
    product * BigInt(domain.selectors.size), 1n);
  const sharedAssignmentCompleteEnumerationCandidateLimit = 20_000n;
  const sharedAssignmentTwoJobPrefixCutSkipThreshold = 1_000_000n;
  const useLargeJointSharedAssignmentPolicy = preparedJobs.length >= 4 &&
    sharedAssignmentCandidateUpperBound > sharedAssignmentCompleteEnumerationCandidateLimit;
  const useRatioOrderedSharedAssignmentPrefixChoices =
    preparedJobs.length >= 4 &&
    sharedAssignmentCandidateUpperBound > sharedAssignmentCompleteEnumerationCandidateLimit;
  const sharedAssignmentPrefixChoiceOrder = useRatioOrderedSharedAssignmentPrefixChoices
    ? "ascending-exact-capped-single-key-ratio-sum-stable"
    : "input-map-order";
  const sharedAssignmentDomainOrder = sharedKeyDomains.map((domain) => `${domain.kind}:${domain.name}`).join("> ");
  const sharedAssignmentPrefixEvaluationLimit = useLargeJointSharedAssignmentPolicy ? 100_000 : 20_000;
  const sharedAssignmentUpperBoundLimit = useLargeJointSharedAssignmentPolicy ? 2_000 : Number.MAX_SAFE_INTEGER;
  let sharedAssignmentCandidateCount = sharedAssignmentCandidateUpperBound > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(sharedAssignmentCandidateUpperBound);
  let sharedAssignmentCandidatesEvaluated = 0;
  let sharedAssignmentPrefixesEvaluated = 0;
  let sharedAssignmentPreprocessingMs = 0;
  let sharedAssignmentPreprocessingSkipped = false;
  let sharedAssignmentPrefixSearchUsed = false;
  let sharedAssignmentUpperBounds: SharedAssignmentUpperBound[] | undefined;
  let sharedAccessoryPairDominanceCandidateCount = 0;
  let sharedAccessoryPairDominanceComparisons = 0;
  let sharedAccessoryPairDominanceCuts = 0;
  let sharedAccessoryPairDominancePreprocessingMs = 0;
  let sharedAccessoryPairDominanceMaximumCuts = 0;
  let sharedAccessoryPairDominanceMaximumComparisons = 0;
  let sharedAccessoryPairDominancePreprocessingBudgetMs = 0;
  let sharedAccessoryPairDominanceLimitReached = false;
  let sharedAccessoryPairDominanceCandidateUpperBound = 0n;
  const sharedAssignmentCutPrefixDepthCounts: Record<string, number> = {};
  const sharedAssignmentUpperBoundKeys = new Set<string>();
  let sharedAssignmentCompleteEnumerationDone = false;
  let sharedAssignmentProcessedIncumbentKey: string | undefined;
  // 大型共享域的单进程吞吐较低，需要足够的墙钟预算来构造同样的安全前缀剪枝；
  // 该预算仍限制在搜索总时间的 2% 以内。
  const sharedAssignmentPreprocessingBudgetMs = Math.min(
    useLargeJointSharedAssignmentPolicy ? 1_500 : 250,
    jointPreprocessingBudgetBaseMs * 0.02,
  );
  if (sharedAccessoryPairDominanceEnabled) {
    const preprocessingStartedAt = performance.now();
    const accessoryDomains = ["earrings", "necklace", "bracelet"]
      .map((slot) => sharedEquipmentDomains.find((domain) => domain.slot === slot && !domain.splitPair))
      .filter((domain): domain is SharedEquipmentDomain => domain !== undefined && !projections.has(domain.slot));
    const domainPairs = accessoryDomains.flatMap((left, index) =>
      accessoryDomains.slice(index + 1).map((right) => ({
        left,
        right,
        count: BigInt(left.keys.size) * BigInt(right.keys.size),
      })));
    sharedAccessoryPairDominanceCandidateUpperBound = domainPairs.reduce(
      (total, pair) => total + pair.count,
      0n,
    );
    const dominanceLimits = sharedAccessoryPairDominanceLimitsFor(
      preparedJobs.length,
      sharedAccessoryPairDominanceCandidateUpperBound,
    );
    const maximumCandidates = dominanceLimits.maxCandidates;
    const maximumComparisons = dominanceLimits.maxComparisons;
    const maximumCuts = dominanceLimits.maxCuts;
    const preprocessingBudgetMs = Math.max(
      0,
      Math.min(dominanceLimits.maxPreprocessingMs, jointPreprocessingBudgetBaseMs * 0.02),
    );
    sharedAccessoryPairDominanceMaximumCuts = maximumCuts;
    sharedAccessoryPairDominanceMaximumComparisons = maximumComparisons;
    sharedAccessoryPairDominancePreprocessingBudgetMs = preprocessingBudgetMs;
    const preprocessingDeadline = preprocessingStartedAt + preprocessingBudgetMs;
    const shouldStopPreprocessing = () =>
      performance.now() >= preprocessingDeadline || isCancelled();
    domainPairs.sort((left, right) => left.count < right.count ? -1 : left.count > right.count ? 1 : 0);
    const slotItemIds = (equipment: EquipInfo): number[] => {
      const ids = [equipment.itemId];
      const pair = ringPairCandidate(equipment);
      if (pair !== undefined) ids.push(...pair.ringEquips.map((ring) => ring.itemId));
      return ids;
    };
    for (const { left, right } of domainPairs) {
      const remainingCandidates = maximumCandidates - sharedAccessoryPairDominanceCandidateCount;
      if (remainingCandidates <= 0 || sharedAccessoryPairDominanceCuts >= maximumCuts ||
        sharedAccessoryPairDominanceComparisons >= maximumComparisons ||
        performance.now() - preprocessingStartedAt >= preprocessingBudgetMs) {
        sharedAccessoryPairDominanceLimitReached = true;
        break;
      }
      const potentialCount = BigInt(left.keys.size) * BigInt(right.keys.size);
      if (potentialCount > BigInt(remainingCandidates)) {
        sharedAccessoryPairDominanceLimitReached = true;
        continue;
      }
      let outsideCandidateWork = 0;
      let outsidePreprocessingStopped = false;
      const outsideIdsByJob = preparedJobs.map(({ originalJob }) => {
        const leftIndex = originalJob.slotNames.indexOf(left.slot);
        const rightIndex = originalJob.slotNames.indexOf(right.slot);
        if (leftIndex < 0 || rightIndex < 0 || leftIndex === rightIndex) return undefined;
        const excluded = new Set([leftIndex, rightIndex]);
        const ids = new Set<number>();
        for (let slotIndex = 0; slotIndex < originalJob.options.slots.length; slotIndex++) {
          if (excluded.has(slotIndex)) continue;
          for (const equipment of originalJob.options.slots[slotIndex]!) {
            if (((++outsideCandidateWork) & 127) === 0 && shouldStopPreprocessing()) {
              outsidePreprocessingStopped = true;
              return undefined;
            }
            for (const itemId of slotItemIds(equipment)) {
              if (!Number.isSafeInteger(itemId)) return undefined;
              ids.add(itemId);
            }
          }
        }
        return ids;
      });
      if (outsidePreprocessingStopped || shouldStopPreprocessing()) {
        sharedAccessoryPairDominanceLimitReached = true;
        break;
      }
      const pairCandidates: SharedAccessoryPairCandidate[] = [];
      const leftSelectors = sharedEquipmentSelectors.get(left.slot);
      const rightSelectors = sharedEquipmentSelectors.get(right.slot);
      if (leftSelectors === undefined || rightSelectors === undefined) continue;
      let stopBuilding = false;
      let inspectedPairKeys = 0;
      for (const keyA of left.keys) {
        const entryAByJob = left.choices.map((choice) => choice.get(keyA));
        if (entryAByJob.some((entry) => entry?.attributes === undefined)) continue;
        const itemIdAByJob = entryAByJob.map((entry) => entry!.equipment.itemId);
        for (const keyB of right.keys) {
          if (((++inspectedPairKeys) & 127) === 0 && shouldStopPreprocessing()) {
            sharedAccessoryPairDominanceLimitReached = true;
            stopBuilding = true;
            break;
          }
          if (pairCandidates.length >= remainingCandidates) {
            sharedAccessoryPairDominanceLimitReached = true;
            stopBuilding = true;
            break;
          }
          const entryBByJob = right.choices.map((choice) => choice.get(keyB));
          if (entryBByJob.some((entry) => entry?.attributes === undefined)) continue;
          const values: number[] = [];
          let validValues = true;
          let canDominate = true;
          for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
            const entryA = entryAByJob[jobIndex]!;
            const entryB = entryBByJob[jobIndex]!;
            const attributesA = entryA.attributes!;
            const attributesB = entryB.attributes!;
            if (attributesA.length !== attributesB.length) {
              validValues = false;
              break;
            }
            for (let attribute = 0; attribute < attributesA.length; attribute++) {
              const value = attributesA[attribute]! + attributesB[attribute]!;
              if (!Number.isSafeInteger(value) || value < 0) {
                validValues = false;
                break;
              }
              values.push(value);
            }
            if (!validValues) break;
            const itemIdA = itemIdAByJob[jobIndex]!;
            const itemIdB = entryB.equipment.itemId;
            const outsideIds = outsideIdsByJob[jobIndex];
            if (!Number.isSafeInteger(itemIdA) || !Number.isSafeInteger(itemIdB) ||
              itemIdA === itemIdB || outsideIds === undefined ||
              outsideIds.has(itemIdA) || outsideIds.has(itemIdB)) {
              canDominate = false;
            }
          }
          if (!validValues) continue;
          const selectorA = leftSelectors.get(keyA);
          const selectorB = rightSelectors.get(keyB);
          if (selectorA === undefined || selectorB === undefined) continue;
          pairCandidates.push({
            keyA,
            keyB,
            selectorA,
            selectorB,
            values,
            canDominate,
          });
        }
        if (stopBuilding) break;
      }
      sharedAccessoryPairDominanceCandidateCount += pairCandidates.length;
      const result = findStrictlyDominatedSharedAccessoryPairs(pairCandidates, {
        maxCuts: maximumCuts - sharedAccessoryPairDominanceCuts,
        maxComparisons: maximumComparisons - sharedAccessoryPairDominanceComparisons,
        deadlineAt: preprocessingDeadline,
        shouldStop: isCancelled,
      });
      sharedAccessoryPairDominanceComparisons += result.comparisons;
      sharedAccessoryPairDominanceLimitReached ||=
        result.comparisonLimitReached || result.preprocessingLimitReached;
      for (const { dominated } of result.cuts) {
        addRows(rows, `shared_accessory_pair_dominance_${sharedAccessoryPairDominanceCuts}`, [
          [dominated.selectorA, 1],
          [dominated.selectorB, 1],
        ], "<=", 1);
        sharedAccessoryPairDominanceCuts++;
      }
      if (stopBuilding) break;
    }
    sharedAccessoryPairDominancePreprocessingMs = performance.now() - preprocessingStartedAt;
  }
  const sharedPairConflictRows = new Set<string>();
  const factorClassConflictRows = new Set<string>();
  const factorClassPairConflictRows = new Set<string>();
  const factorClassJointPairConflictRows = new Map<string, ModelRow>();
  let factorClassJointPairCutSequence = 0;
  const factorClassJointTripleConflictRows = new Map<string, ModelRow>();
  const factorClassJointTripleCutIncumbentKeys = new Set<string>();
  let factorClassJointTripleCutSequence = 0;
  let factorClassJointTripleCutNonzeros = 0;
  const factorClassTripleConflictRows = new Set<string>();
  const factorClassTripleCutRows = new Map<string, ModelRow>();
  const factorClassTripleCutIncumbentKeys = new Set<string>();
  let factorClassTriplePreprocessingWork = 0;
  let factorClassTriplePreprocessingSkipped = false;
  const factorClassTriplePreprocessingWorkLimit = 1_000_000;
  const sharedAssignmentConflictRows = new Set<string>();
  const sharedAssignmentResourceScoreConflictRows = new Set<string>();
  const ratioUpperNecessaryRows = new Set<string>();
  const ratioAtOrBelowThreshold = (ratio: ExactRatio, numerator: bigint, denominator: bigint) =>
    ratio.numerator > ratio.denominator
      ? denominator <= numerator
      : ratio.numerator * denominator <= ratio.denominator * numerator;
  const baselineFactorScores = preparedJobs.map(({ job, prepared }) =>
    BigInt(factorObjectiveLogScore(job.baseline, prepared.useDps)));
  const factorScoreUpperCannotBeatThreshold = (
    scoreUppers: readonly (bigint | undefined)[],
    numerator: bigint,
    denominator: bigint,
  ): boolean => {
    if (numerator <= 0n || numerator > denominator || scoreUppers.length !== preparedJobs.length) return false;
    const loss = strictLogThresholdLoss(numerator, denominator);
    for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
      const scoreUpper = scoreUppers[jobIndex];
      if (scoreUpper === undefined) continue;
      const roundingSlack = BigInt(preparedJobs[jobIndex]!.prepared.groups.length);
      // 比值严格高于阈值时，整数对数得分必须达到此值；
      // 每组因子的对数取最近整数后，候选与基线之间最多产生一个单位的松弛。
      const requiredScore = baselineFactorScores[jobIndex]! - roundingSlack - loss;
      if (scoreUpper < requiredScore) return true;
    }
    return false;
  };
  const candidateSpecificUpperBoundProofRows = new Map<string, ModelRow>();
  const candidateSpecificUpperBoundEqualityRows = new Set<string>();
  const addCandidateSpecificUpperBoundProofRows = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    const incumbent = { numerator: incumbentNumerator, denominator: incumbentDenominator };
    const thresholdNumerator = incumbentNumerator -
      BigInt(preparedJobs.length - 1) * incumbentDenominator;
    for (const upperBound of candidateSpecificUpperBounds) {
      if (candidateSpecificUpperBoundProofRows.has(upperBound.rowName) ||
        !candidateUpperBoundCannotImproveJointIncumbent(upperBound.ratio, incumbent, preparedJobs.length)) continue;
      candidateSpecificUpperBoundProofRows.set(upperBound.rowName, {
        name: upperBound.rowName,
        terms: new Map([[upperBound.variable, 1]]),
        sense: "=",
        rhs: 0,
      });
      if (thresholdNumerator > 0n &&
        upperBound.ratio.numerator * incumbentDenominator ===
          upperBound.ratio.denominator * thresholdNumerator) {
        candidateSpecificUpperBoundEqualityRows.add(upperBound.rowName);
      }
    }
    solveRows.push(...candidateSpecificUpperBoundProofRows.values());
    if (thresholdNumerator > 0n) {
      const loss = strictLogThresholdLoss(thresholdNumerator, incumbentDenominator);
      for (const upperBound of resourceBudgetCandidateUpperBounds) {
        const requiredScore = upperBound.baselineScore - upperBound.roundingSlack - loss;
        if (upperBound.scoreUpper >= requiredScore ||
          resourceBudgetCandidateUpperBoundProofRows.has(upperBound.rowName)) continue;
        resourceBudgetCandidateUpperBoundProofRows.set(upperBound.rowName, {
          name: upperBound.rowName,
          terms: new Map([[upperBound.variable, 1]]),
          sense: "=",
          rhs: 0,
        });
      }
    }
    solveRows.push(...resourceBudgetCandidateUpperBoundProofRows.values());
  };
  const cannotBeatThreshold = (
    ratios: readonly (ExactRatio | undefined)[],
    numerator: bigint,
    denominator: bigint,
  ) => ratios.some((ratio) => ratio !== undefined && ratioAtOrBelowThreshold(ratio, numerator, denominator));
  const bigintGcd = (left: bigint, right: bigint) => {
    let a = left < 0n ? -left : left;
    let b = right < 0n ? -right : right;
    while (b !== 0n) [a, b] = [b, a % b];
    return a;
  };
  const sumCappedRatios = (ratios: readonly (ExactRatio | undefined)[]): ExactRatio | undefined => {
    if (ratios.some((ratio) => ratio === undefined || ratio.denominator <= 0n)) return undefined;
    let sumNumerator = 0n;
    let sumDenominator = 1n;
    for (const entry of ratios) {
      const candidate = entry!;
      const ratio = candidate.numerator > candidate.denominator
        ? { numerator: 1n, denominator: 1n }
        : candidate;
      const sharedDivisor = bigintGcd(sumDenominator, ratio.denominator);
      sumNumerator = sumNumerator * (ratio.denominator / sharedDivisor) +
        ratio.numerator * (sumDenominator / sharedDivisor);
      sumDenominator *= ratio.denominator / sharedDivisor;
      const reduction = bigintGcd(sumNumerator, sumDenominator);
      if (reduction > 1n) {
        sumNumerator /= reduction;
        sumDenominator /= reduction;
      }
    }
    return { numerator: sumNumerator, denominator: sumDenominator };
  };
  const compareCappedRatioSums = (left: ExactRatio | undefined, right: ExactRatio | undefined) => {
    if (left === undefined) return right === undefined ? 0 : 1;
    if (right === undefined) return -1;
    const difference = left.numerator * right.denominator - right.numerator * left.denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  };
  const ratioSumAtOrBelowThreshold = (
    ratios: readonly (ExactRatio | undefined)[],
    numerator: bigint,
    denominator: bigint,
  ) => {
    if (ratios.some((ratio) => ratio === undefined || ratio.denominator <= 0n)) return false;
    let sumNumerator = 0n;
    let sumDenominator = 1n;
    for (const entry of ratios) {
      const candidate = entry!;
      const ratio = candidate.numerator > candidate.denominator
        ? { numerator: 1n, denominator: 1n }
        : candidate;
      const sharedDivisor = bigintGcd(sumDenominator, ratio.denominator);
      sumNumerator = sumNumerator * (ratio.denominator / sharedDivisor) +
        ratio.numerator * (sumDenominator / sharedDivisor);
      sumDenominator *= ratio.denominator / sharedDivisor;
      const reduction = bigintGcd(sumNumerator, sumDenominator);
      if (reduction > 1n) {
        sumNumerator /= reduction;
        sumDenominator /= reduction;
      }
    }
    return sumNumerator * denominator <= numerator * sumDenominator;
  };
  const addCrossJobFactorClassGroupPairCuts = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    const jobCount = preparedJobs.length;
    if (jobCount < 2) return;
    const individualThreshold = incumbentNumerator - BigInt(jobCount - 1) * incumbentDenominator;
    const pairThreshold = incumbentNumerator - BigInt(jobCount - 2) * incumbentDenominator;
    if (pairThreshold <= 0n) return;

    // 若联合总和有所提升，任意两个职业的比值都必须超过 B-(n-2)，
    // 因为其余 n-2 个比值都至多为 1。
    const compareRatios = (left: ExactRatio, right: ExactRatio) => {
      const comparison = left.numerator * right.denominator - right.numerator * left.denominator;
      return comparison < 0n ? -1 : comparison > 0n ? 1 : 0;
    };
    const eligibleByJobAndGroup = preparedJobs.map(({ prepared }, jobIndex) =>
      prepared.groups.map((group) => factorClassUpperBounds
        .filter((bound) => bound.jobIndex === jobIndex && bound.groupName === group.name &&
          bound.ratio.numerator < bound.ratio.denominator &&
          !ratioAtOrBelowThreshold(bound.ratio, individualThreshold, incumbentDenominator))
        .sort((left, right) => compareRatios(left.ratio, right.ratio) ||
          left.variable.localeCompare(right.variable))));

    const pendingByJobPair = new Map<string, {
      rowName: string;
      jobA: number;
      jobB: number;
      prefixA: readonly FactorClassUpperBound[];
      prefixB: readonly FactorClassUpperBound[];
      coverage: number;
    }[]>();
    for (let jobA = 0; jobA < jobCount; jobA++) {
      for (let jobB = jobA + 1; jobB < jobCount; jobB++) {
        for (let groupAIndex = 0; groupAIndex < eligibleByJobAndGroup[jobA]!.length; groupAIndex++) {
          const groupA = eligibleByJobAndGroup[jobA]![groupAIndex]!;
          if (groupA.length === 0) continue;
          for (let groupBIndex = 0; groupBIndex < eligibleByJobAndGroup[jobB]!.length; groupBIndex++) {
            const groupB = eligibleByJobAndGroup[jobB]![groupBIndex]!;
            if (groupB.length === 0) continue;
            let prefixBLength = groupB.length;
            let coverage = 0;
            let prefixALength = 0;
            for (let candidateA = 1; candidateA <= groupA.length; candidateA++) {
              while (prefixBLength > 0 && !ratioSumAtOrBelowThreshold(
                [groupA[candidateA - 1]!.ratio, groupB[prefixBLength - 1]!.ratio],
                pairThreshold,
                incumbentDenominator,
              )) prefixBLength--;
              const candidateCoverage = candidateA * prefixBLength;
              if (candidateCoverage > coverage) {
                coverage = candidateCoverage;
                prefixALength = candidateA;
              }
            }
            if (coverage === 0) continue;
            const groupAName = preparedJobs[jobA]!.prepared.groups[groupAIndex]!.name;
            const groupBName = preparedJobs[jobB]!.prepared.groups[groupBIndex]!.name;
            const key = `${jobA}:${jobB}`;
            const cuts = pendingByJobPair.get(key) ?? [];
            cuts.push({
              rowName: `joint_necessary_class_group_pair_${jobA}_${groupAName}_${jobB}_${groupBName}`,
              jobA,
              jobB,
              prefixA: groupA.slice(0, prefixALength),
              prefixB: groupB.slice(0, Math.floor(coverage / prefixALength)),
              coverage,
            });
            pendingByJobPair.set(key, cuts);
          }
        }
      }
    }

    const selectedCuts = [...pendingByJobPair.values()].flatMap((cuts) => cuts
      .sort((left, right) => right.coverage - left.coverage || left.rowName.localeCompare(right.rowName))
      .slice(0, 8))
      .sort((left, right) => right.coverage - left.coverage || left.rowName.localeCompare(right.rowName))
      .slice(0, 32);
    for (const cut of selectedCuts) {
      addRows(solveRows, cut.rowName, [
        ...cut.prefixA.map((bound) => [prefix(cut.jobA, bound.variable), 1] as const),
        ...cut.prefixB.map((bound) => [prefix(cut.jobB, bound.variable), 1] as const),
      ], "<=", 1);
      factorClassPairConflictRows.add(cut.rowName);
    }
  };
  const addTwoJobWithinJobFactorPairCuts = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    for (const row of factorClassJointPairConflictRows.values()) solveRows.push(row);
    if (preparedJobs.length !== 2) return;
    const necessaryJobNumerator = incumbentNumerator - incumbentDenominator;
    if (necessaryJobNumerator <= 0n) return;

    const pendingCuts: {
      key: string;
      rowName: string;
      jobIndex: number;
      prefixA: readonly FactorClassUpperBound[];
      prefixB: readonly FactorClassUpperBound[];
      coverage: number;
    }[] = [];
    for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
      const groups = preparedJobs[jobIndex]!.prepared.groups
        .filter((group) => group.name !== "gcd" || options.objective === "dps")
        .map((group) => ({
        group,
        bounds: factorClassUpperBoundsByJobAndGroup[jobIndex]!.get(group.name) ?? [],
      }));
      if (groups.some(({ group, bounds: groupBounds }) => groupBounds.length !== group.classes.length ||
        groupBounds.length === 0)) continue;
      const groupMaxima = groups.map(({ bounds: groupBounds }) => groupBounds.reduce((maximum, bound) =>
        compareExactRatios(bound.ratio, maximum) > 0 ? bound.ratio : maximum,
      { numerator: 0n, denominator: 1n } as ExactRatio));
      const envelope = groupMaxima[0]!;
      if (envelope.numerator <= 0n || groupMaxima.some((maximum) =>
        compareExactRatios(maximum, envelope) !== 0)) continue;

      for (let groupAIndex = 0; groupAIndex < groups.length; groupAIndex++) {
        const groupA = groups[groupAIndex]!;
        const eligibleA = groupA.bounds
          .filter((bound) => !ratioAtOrBelowThreshold(
            bound.ratio, necessaryJobNumerator, incumbentDenominator,
          ))
          .sort((left, right) => compareExactRatios(left.ratio, right.ratio) ||
            left.variable.localeCompare(right.variable));
        if (eligibleA.length === 0) continue;
        for (let groupBIndex = groupAIndex + 1; groupBIndex < groups.length; groupBIndex++) {
          const groupB = groups[groupBIndex]!;
          const eligibleB = groupB.bounds
            .filter((bound) => !ratioAtOrBelowThreshold(
              bound.ratio, necessaryJobNumerator, incumbentDenominator,
            ))
            .sort((left, right) => compareExactRatios(left.ratio, right.ratio) ||
              left.variable.localeCompare(right.variable));
          if (eligibleB.length === 0) continue;

          const pairRatioAtOrBelowThreshold = (left: FactorClassUpperBound, right: FactorClassUpperBound) => {
            const pairRatio = {
              numerator: left.ratio.numerator * right.ratio.numerator * envelope.denominator,
              denominator: left.ratio.denominator * right.ratio.denominator * envelope.numerator,
            };
            return ratioAtOrBelowThreshold(pairRatio, necessaryJobNumerator, incumbentDenominator);
          };
          let prefixBLength = eligibleB.length;
          let bestCoverage = 0;
          let bestPrefixALength = 0;
          let bestPrefixBLength = 0;
          for (let prefixALength = 1; prefixALength <= eligibleA.length; prefixALength++) {
            while (prefixBLength > 0 && !pairRatioAtOrBelowThreshold(
              eligibleA[prefixALength - 1]!, eligibleB[prefixBLength - 1]!,
            )) prefixBLength--;
            const coverage = prefixALength * prefixBLength;
            if (coverage > bestCoverage) {
              bestCoverage = coverage;
              bestPrefixALength = prefixALength;
              bestPrefixBLength = prefixBLength;
            }
          }
          if (bestCoverage === 0) continue;
          const prefixA = eligibleA.slice(0, bestPrefixALength);
          const prefixB = eligibleB.slice(0, bestPrefixBLength);
          const key = JSON.stringify([
            jobIndex,
            groupA.group.name,
            groupB.group.name,
            prefixA.map((bound) => bound.variable),
            prefixB.map((bound) => bound.variable),
          ]);
          if (factorClassJointPairConflictRows.has(key)) continue;
          pendingCuts.push({
            key,
            rowName: `joint_necessary_factor_pair_candidate_${jobIndex}_${groupA.group.name}_${groupB.group.name}_${pendingCuts.length}`,
            jobIndex,
            prefixA,
            prefixB,
            coverage: bestCoverage,
          });
        }
      }
    }

    const selectedCuts = pendingCuts
      .sort((left, right) => right.coverage - left.coverage || left.rowName.localeCompare(right.rowName))
      .slice(0, 32);
    let addedNonzeros = 0;
    for (const cut of selectedCuts) {
      const nonzeros = cut.prefixA.length + cut.prefixB.length;
      if (addedNonzeros + nonzeros > 25_000) continue;
      addRows(solveRows, `joint_necessary_factor_pair_${factorClassJointPairCutSequence++}`, [
        ...cut.prefixA.map((bound) => [prefix(cut.jobIndex, bound.variable), 1] as const),
        ...cut.prefixB.map((bound) => [prefix(cut.jobIndex, bound.variable), 1] as const),
      ], "<=", 1);
      addedNonzeros += nonzeros;
      factorClassJointPairConflictRows.set(cut.key, solveRows[solveRows.length - 1]!);
    }
  };
  const addTwoJobWithinJobFactorTripleCuts = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    for (const row of factorClassJointTripleConflictRows.values()) solveRows.push(row);
    if (preparedJobs.length !== 2) return;
    const incumbentKey = `${incumbentNumerator}/${incumbentDenominator}`;
    if (factorClassJointTripleCutIncumbentKeys.has(incumbentKey)) return;
    factorClassJointTripleCutIncumbentKeys.add(incumbentKey);
    const necessaryJobNumerator = incumbentNumerator - incumbentDenominator;
    if (necessaryJobNumerator <= 0n) return;

    const pendingCuts: {
      key: string;
      rowName: string;
      jobIndex: number;
      prefixes: readonly [readonly FactorClassUpperBound[], readonly FactorClassUpperBound[], readonly FactorClassUpperBound[]];
      coverage: number;
    }[] = [];
    const ratioProductAtOrBelowThreshold = (
      ratios: readonly ExactRatio[],
      envelope: ExactRatio,
    ) => {
      if (ratios.some((ratio) => ratio.denominator <= 0n) || envelope.numerator <= 0n) return false;
      const productNumerator = ratios.reduce((product, ratio) => product * ratio.numerator, 1n) *
        envelope.denominator ** BigInt(ratios.length - 1);
      const productDenominator = ratios.reduce((product, ratio) => product * ratio.denominator, 1n) *
        envelope.numerator ** BigInt(ratios.length - 1);
      return productNumerator * incumbentDenominator <=
        necessaryJobNumerator * productDenominator;
    };
    const samplePrefixLengths = (length: number) => [...new Set([
      1,
      Math.max(1, Math.floor(length / 4)),
      Math.max(1, Math.floor(length / 2)),
      length,
    ])];

    for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
      const groups = preparedJobs[jobIndex]!.prepared.groups
        .filter((group) => group.name !== "gcd" || options.objective === "dps")
        .map((group) => ({
        group,
        bounds: factorClassUpperBoundsByJobAndGroup[jobIndex]!.get(group.name) ?? [],
      }));
      if (groups.some(({ group, bounds: groupBounds }) => groupBounds.length !== group.classes.length ||
        groupBounds.length === 0)) continue;
      const groupMaxima = groups.map(({ bounds: groupBounds }) => groupBounds.reduce((maximum, bound) =>
        compareExactRatios(bound.ratio, maximum) > 0 ? bound.ratio : maximum,
      { numerator: 0n, denominator: 1n } as ExactRatio));
      const envelope = groupMaxima[0]!;
      if (envelope.numerator <= 0n || groupMaxima.some((maximum) =>
        compareExactRatios(maximum, envelope) !== 0)) continue;
      const eligibleByGroup = groups.map(({ group, bounds: groupBounds }) => ({
        group,
        bounds: groupBounds
          .filter((bound) => !ratioAtOrBelowThreshold(
            bound.ratio, necessaryJobNumerator, incumbentDenominator,
          ))
          .sort((left, right) => compareExactRatios(left.ratio, right.ratio) ||
            left.variable.localeCompare(right.variable)),
      }));

      for (let groupAIndex = 0; groupAIndex < eligibleByGroup.length; groupAIndex++) {
        const groupA = eligibleByGroup[groupAIndex]!;
        if (groupA.bounds.length === 0) continue;
        for (let groupBIndex = groupAIndex + 1; groupBIndex < eligibleByGroup.length; groupBIndex++) {
          const groupB = eligibleByGroup[groupBIndex]!;
          if (groupB.bounds.length === 0) continue;
          for (let groupCIndex = groupBIndex + 1; groupCIndex < eligibleByGroup.length; groupCIndex++) {
            const groupC = eligibleByGroup[groupCIndex]!;
            if (groupC.bounds.length === 0) continue;
            let bestCoverage = 0;
            let bestLengths: readonly [number, number, number] | undefined;
            for (const prefixALength of samplePrefixLengths(groupA.bounds.length)) {
              for (const prefixBLength of samplePrefixLengths(groupB.bounds.length)) {
                let low = 0;
                let high = groupC.bounds.length;
                while (low < high) {
                  const middle = Math.ceil((low + high) / 2);
                  if (ratioProductAtOrBelowThreshold([
                    groupA.bounds[prefixALength - 1]!.ratio,
                    groupB.bounds[prefixBLength - 1]!.ratio,
                    groupC.bounds[middle - 1]!.ratio,
                  ], envelope)) low = middle;
                  else high = middle - 1;
                }
                const coverage = prefixALength * prefixBLength * low;
                if (coverage > bestCoverage) {
                  bestCoverage = coverage;
                  bestLengths = [prefixALength, prefixBLength, low];
                }
              }
            }
            if (bestLengths === undefined || bestCoverage === 0) continue;
            const prefixes = [
              groupA.bounds.slice(0, bestLengths[0]),
              groupB.bounds.slice(0, bestLengths[1]),
              groupC.bounds.slice(0, bestLengths[2]),
            ] as const;
            const key = JSON.stringify([
              jobIndex,
              groupA.group.name,
              groupB.group.name,
              groupC.group.name,
              ...prefixes.map((prefixBounds) => prefixBounds.map((bound) => bound.variable)),
            ]);
            if (factorClassJointTripleConflictRows.has(key)) continue;
            pendingCuts.push({
              key,
              rowName: `joint_necessary_factor_triple_${jobIndex}_${groupA.group.name}_${groupB.group.name}_${groupC.group.name}_${factorClassJointTripleConflictRows.size + pendingCuts.length}`,
              jobIndex,
              prefixes,
              coverage: bestCoverage,
            });
          }
        }
      }
    }

    const selectedCuts = pendingCuts
      .sort((left, right) => right.coverage - left.coverage || left.rowName.localeCompare(right.rowName))
      .slice(0, Math.max(0, 24 - factorClassJointTripleConflictRows.size));
    for (const cut of selectedCuts) {
      const nonzeros = cut.prefixes.reduce((sum, prefixBounds) => sum + prefixBounds.length, 0);
      if (factorClassJointTripleCutNonzeros + nonzeros > 25_000) continue;
      addRows(solveRows, `joint_necessary_factor_triple_${factorClassJointTripleCutSequence++}`, cut.prefixes.flatMap((prefixBounds) =>
        prefixBounds.map((bound) => [prefix(cut.jobIndex, bound.variable), 1] as const)), "<=", 2);
      factorClassJointTripleCutNonzeros += nonzeros;
      factorClassJointTripleConflictRows.set(cut.key, solveRows[solveRows.length - 1]!);
    }
  };
  const addCrossJobFactorClassGroupTripleCuts = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    for (const row of factorClassTripleCutRows.values()) solveRows.push(row);
    const incumbentKey = `${incumbentNumerator}/${incumbentDenominator}`;
    if (factorClassTripleCutIncumbentKeys.has(incumbentKey)) return;
    factorClassTripleCutIncumbentKeys.add(incumbentKey);

    const jobCount = preparedJobs.length;
    if (jobCount < 3) return;
    const individualThreshold = incumbentNumerator - BigInt(jobCount - 1) * incumbentDenominator;
    const tripleThreshold = incumbentNumerator - BigInt(jobCount - 3) * incumbentDenominator;
    if (tripleThreshold <= 0n) return;
    if (factorClassTriplePreprocessingSkipped ||
      factorClassTriplePreprocessingWork >= factorClassTriplePreprocessingWorkLimit) {
      factorClassTriplePreprocessingSkipped = true;
      return;
    }
    const consumeWork = (work: number): boolean => {
      const previousWork = factorClassTriplePreprocessingWork;
      factorClassTriplePreprocessingWork += work;
      if (factorClassTriplePreprocessingWork > factorClassTriplePreprocessingWorkLimit) {
        factorClassTriplePreprocessingSkipped = true;
        return false;
      }
      if (Math.floor(factorClassTriplePreprocessingWork / 256) > Math.floor(previousWork / 256)) {
        throwIfCancelled(isCancelled);
        if (jointTimeLimitReached()) {
          factorClassTriplePreprocessingSkipped = true;
          return false;
        }
      }
      return true;
    };
    const eligibleByJobAndGroup = [] as { groupName: string; bounds: FactorClassUpperBound[] }[][];
    for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
      const groups: { groupName: string; bounds: FactorClassUpperBound[] }[] = [];
      for (const [groupName, boundsForGroup] of factorClassUpperBoundsByJobAndGroup[jobIndex]!) {
        if (!consumeWork(boundsForGroup.length + 1)) return;
        groups.push({
          groupName,
          bounds: boundsForGroup.filter((bound) =>
            bound.ratio.numerator < bound.ratio.denominator &&
            !ratioAtOrBelowThreshold(bound.ratio, individualThreshold, incumbentDenominator)),
        });
      }
      eligibleByJobAndGroup.push(groups);
    }
    const pendingByJobTriple = new Map<string, {
      rowName: string;
      jobs: readonly [number, number, number];
      prefixes: readonly [readonly FactorClassUpperBound[], readonly FactorClassUpperBound[], readonly FactorClassUpperBound[]];
      coverage: number;
    }[]>();

    tripleCandidates:
    for (let jobA = 0; jobA < jobCount; jobA++) {
      for (let jobB = jobA + 1; jobB < jobCount; jobB++) {
        for (let jobC = jobB + 1; jobC < jobCount; jobC++) {
          if (!consumeWork(1)) break tripleCandidates;
          const groupsA = eligibleByJobAndGroup[jobA]!;
          const groupsB = eligibleByJobAndGroup[jobB]!;
          const groupsC = eligibleByJobAndGroup[jobC]!;
          const groupTriples: {
            groupA: typeof groupsA[number];
            groupB: typeof groupsB[number];
            groupC: typeof groupsC[number];
            estimatedCoverage: number;
          }[] = [];
          for (const groupA of groupsA) {
            if (groupA.bounds.length === 0) continue;
            for (const groupB of groupsB) {
              if (groupB.bounds.length === 0) continue;
              for (const groupC of groupsC) {
                if (groupC.bounds.length === 0 || !ratioSumAtOrBelowThreshold([
                  groupA.bounds[0]!.ratio,
                  groupB.bounds[0]!.ratio,
                  groupC.bounds[0]!.ratio,
                ], tripleThreshold, incumbentDenominator)) continue;
                const samplePrefixLengths = (length: number) => [...new Set([
                  1,
                  Math.max(1, Math.floor(length / 4)),
                  Math.max(1, Math.floor(length / 2)),
                  length,
                ])];
                let estimatedCoverage = 0;
                const sampleA = samplePrefixLengths(groupA.bounds.length);
                const sampleB = samplePrefixLengths(groupB.bounds.length);
                for (const prefixALength of sampleA) {
                  for (const prefixBLength of sampleB) {
                    let low = 0;
                    let high = groupC.bounds.length;
                    while (low < high) {
                      const middle = Math.ceil((low + high) / 2);
                      if (ratioSumAtOrBelowThreshold([
                        groupA.bounds[prefixALength - 1]!.ratio,
                        groupB.bounds[prefixBLength - 1]!.ratio,
                        groupC.bounds[middle - 1]!.ratio,
                      ], tripleThreshold, incumbentDenominator)) low = middle;
                      else high = middle - 1;
                    }
                    estimatedCoverage = Math.max(
                      estimatedCoverage,
                      prefixALength * prefixBLength * low,
                    );
                  }
                }
                if (estimatedCoverage > 0) groupTriples.push({
                  groupA,
                  groupB,
                  groupC,
                  estimatedCoverage,
                });
              }
            }
          }
          groupTriples.sort((left, right) => right.estimatedCoverage - left.estimatedCoverage ||
            `${left.groupA.groupName}|${left.groupB.groupName}|${left.groupC.groupName}`.localeCompare(
              `${right.groupA.groupName}|${right.groupB.groupName}|${right.groupC.groupName}`));
          for (const { groupA: groupAEntry, groupB: groupBEntry, groupC: groupCEntry } of groupTriples) {
            if (!consumeWork(1)) break tripleCandidates;
            const groupA = groupAEntry.bounds;
            const groupB = groupBEntry.bounds;
            const groupC = groupCEntry.bounds;

            let coverage = 0;
            let prefixALength = 0;
            let prefixBLength = 0;
            for (let candidateA = 1; candidateA <= groupA.length; candidateA++) {
              if (!consumeWork(1)) break tripleCandidates;
              // 上一个 candidateA 可能为最后一个 B 缩小了 C 的范围；
              // 开始当前外层前缀遍历时，需重新使用完整的 C 范围。
              let prefixCLength = groupC.length;
              for (let candidateB = 1; candidateB <= groupB.length; candidateB++) {
                if (!consumeWork(1)) break tripleCandidates;
                while (prefixCLength > 0 && !ratioSumAtOrBelowThreshold([
                  groupA[candidateA - 1]!.ratio,
                  groupB[candidateB - 1]!.ratio,
                  groupC[prefixCLength - 1]!.ratio,
                ], tripleThreshold, incumbentDenominator)) {
                  prefixCLength--;
                  if (!consumeWork(1)) break tripleCandidates;
                }
                const candidateCoverage = candidateA * candidateB * prefixCLength;
                if (candidateCoverage > coverage) {
                  coverage = candidateCoverage;
                  prefixALength = candidateA;
                  prefixBLength = candidateB;
                }
              }
            }
            if (coverage === 0) continue;
            const key = `${jobA}:${jobB}:${jobC}`;
            const cuts = pendingByJobTriple.get(key) ?? [];
            cuts.push({
              rowName: `joint_necessary_class_group_triple_${jobA}_${groupAEntry.groupName}_${jobB}_${groupBEntry.groupName}_${jobC}_${groupCEntry.groupName}`,
              jobs: [jobA, jobB, jobC],
              prefixes: [
                groupA.slice(0, prefixALength),
                groupB.slice(0, prefixBLength),
                groupC.slice(0, Math.floor(coverage / prefixALength / prefixBLength)),
              ],
              coverage,
            });
            pendingByJobTriple.set(key, cuts);
          }
        }
      }
    }
    const selectedCuts = [...pendingByJobTriple.values()].flatMap((cuts) => cuts
      .sort((left, right) => right.coverage - left.coverage || left.rowName.localeCompare(right.rowName))
      .slice(0, 8))
      .sort((left, right) => right.coverage - left.coverage || left.rowName.localeCompare(right.rowName))
      .slice(0, 32);
    for (const cut of selectedCuts) {
      const [jobA, jobB, jobC] = cut.jobs;
      const firstNewRowIndex = solveRows.length;
      addRows(solveRows, cut.rowName, [
        ...cut.prefixes[0].map((bound) => [prefix(jobA, bound.variable), 1] as const),
        ...cut.prefixes[1].map((bound) => [prefix(jobB, bound.variable), 1] as const),
        ...cut.prefixes[2].map((bound) => [prefix(jobC, bound.variable), 1] as const),
      ], "<=", 2);
      for (const row of solveRows.slice(firstNewRowIndex)) factorClassTripleCutRows.set(row.name, row);
      factorClassTripleConflictRows.add(cut.rowName);
    }
  };
  const prepareSharedPairUpperBounds = (incumbentNumerator: bigint, incumbentDenominator: bigint) => {
    if (sharedPairUpperBounds !== undefined || incumbentNumerator <= 0n) return;
    const preprocessingStartedAt = performance.now();
    // 共享配对候选与完整的当前最优总和比较。即使单职业阈值不为正，
    // 配对剪枝仍可能有效。
    const individualThresholdNumerator = incumbentNumerator -
      BigInt(options.jobs.length - 1) * incumbentDenominator;
    const singleKeyBoundsBySelector = new Map(
      [...sharedEquipmentUpperBounds, ...sharedFoodUpperBounds].map((bound) => [bound.selector, bound]),
    );
    const choicesByDomain = sharedKeyDomains.map((domain) => [...domain.selectors].flatMap(([key, selector]) => {
      const singleKeyBound = singleKeyBoundsBySelector.get(selector);
      if (singleKeyBound !== undefined && (
        (individualThresholdNumerator > 0n &&
          cannotBeatThreshold(singleKeyBound.jobRatios, individualThresholdNumerator, incumbentDenominator)) ||
        ratioSumAtOrBelowThreshold(singleKeyBound.jobRatios, incumbentNumerator, incumbentDenominator)
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
              pairBounds.push({
                selectorA: choiceA.selector,
                selectorB: choiceB.selector,
                rowName: `joint_shared_pair_bound_${domainIndex}_${other}_${sharedPairCandidatesEvaluated - 1}`,
                jobRatios: jobRatios as ExactRatio[],
              });
            }
          }
        }
      }
    }
    sharedPairUpperBounds = pairBounds;
    sharedPairPreprocessingMs += performance.now() - preprocessingStartedAt;
  };
  const prepareSharedAssignmentUpperBounds = () => {
    if (best === undefined) return;
    const incumbentKey = `${best.numerator}/${best.denominator}`;
    const isCompleteDomain = sharedAssignmentCandidateUpperBound <= sharedAssignmentCompleteEnumerationCandidateLimit;
    // 对特别大的双职业候选域，反复测量发现两万条浅层前缀剪枝会让严格不可行性证明
    // 比求解未裁剪的小模型慢得多。因此仅在较小的候选域或更大的职业组中保留前缀剪枝。
    if (preparedJobs.length === 2 &&
      sharedAssignmentCandidateUpperBound > sharedAssignmentTwoJobPrefixCutSkipThreshold) {
      sharedAssignmentPreprocessingSkipped = true;
      return;
    }
    if (isCompleteDomain && sharedAssignmentCompleteEnumerationDone) return;
    if (!isCompleteDomain && sharedAssignmentProcessedIncumbentKey === incumbentKey) return;
    sharedAssignmentProcessedIncumbentKey = incumbentKey;
    sharedAssignmentUpperBounds ??= [];
    sharedAssignmentPreprocessingSkipped = !isCompleteDomain;
    if (!isCompleteDomain) sharedAssignmentPrefixSearchUsed = true;

    const preprocessingStartedAt = performance.now();
    const remainingBudgetMs = sharedAssignmentPreprocessingBudgetMs - sharedAssignmentPreprocessingMs;
    if (remainingBudgetMs <= 0) {
      sharedAssignmentPreprocessingSkipped = true;
      return;
    }
    const preprocessingDeadline = preprocessingStartedAt + remainingBudgetMs;
    let workSinceDeadlineCheck = 0;
    let stoppedEarly = false;
    const shouldStop = () => {
      if ((sharedAssignmentUpperBounds?.length ?? 0) >= sharedAssignmentUpperBoundLimit) {
        stoppedEarly = true;
        sharedAssignmentPreprocessingSkipped = true;
        return true;
      }
      if (sharedAssignmentPrefixesEvaluated >= sharedAssignmentPrefixEvaluationLimit) {
        stoppedEarly = true;
        sharedAssignmentPreprocessingSkipped = true;
        return true;
      }
      if ((++workSinceDeadlineCheck & 7) !== 0) return false;
      throwIfCancelled(isCancelled);
      if (performance.now() >= preprocessingDeadline || jointTimeLimitReached()) {
        stoppedEarly = true;
        sharedAssignmentPreprocessingSkipped = true;
        return true;
      }
      return false;
    };
    const recordUpperBound = (
      selectors: readonly string[],
      jobRatios: readonly ExactRatio[],
      jobScoreUppers?: readonly (bigint | undefined)[],
    ) => {
      const key = JSON.stringify(selectors);
      if (sharedAssignmentUpperBoundKeys.has(key)) return;
      sharedAssignmentUpperBoundKeys.add(key);
      sharedAssignmentUpperBounds!.push({
        selectors,
        rowName: `joint_shared_assignment_bound_${sharedAssignmentUpperBounds!.length}`,
        jobRatios,
        ...(jobScoreUppers === undefined ? {} : { jobScoreUppers }),
      });
      const depth = String(selectors.length);
      sharedAssignmentCutPrefixDepthCounts[depth] = (sharedAssignmentCutPrefixDepthCounts[depth] ?? 0) + 1;
    };
    try {
      const chosen: { selector: string; fixedChoice: FixedSharedChoice }[] = [];
      const singleKeyBoundsBySelector = new Map(
        [...sharedEquipmentUpperBounds, ...sharedFoodUpperBounds].map((bound) => [bound.selector, bound]),
      );
      const orderedSelectorsByDomain = sharedKeyDomains.map((domain) => {
        const selectors = [...domain.selectors];
        if (!useRatioOrderedSharedAssignmentPrefixChoices) return selectors;
        return selectors.map(([key, selector], originalIndex) => ({
          key,
          selector,
          originalIndex,
          ratioSum: sumCappedRatios(singleKeyBoundsBySelector.get(selector)?.jobRatios ?? [undefined]),
        }))
          .sort((left, right) => compareCappedRatioSums(left.ratioSum, right.ratioSum) ||
            left.originalIndex - right.originalIndex)
          .map(({ key, selector }) => [key, selector] as const);
      });
      const visit = (domainIndex: number): void => {
        if (stoppedEarly || shouldStop()) return;
        if (domainIndex === sharedKeyDomains.length) {
          sharedAssignmentCandidatesEvaluated++;
          const jobRatios: ExactRatio[] = [];
          const jobScoreUppers: (bigint | undefined)[] | undefined =
            useResourceBudgetSharedPrefixBounds ? [] : undefined;
          for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
            if (shouldStop()) return;
            const attributes = coordinateUpperAttributes(
              jobIndex, chosen.map((entry) => entry.fixedChoice),
            );
            const ratio = attributes === undefined
              ? undefined
              : exactUpperRatio(jobIndex, attributes);
            if (ratio === undefined) return;
            jobRatios.push(ratio);
            if (jobScoreUppers !== undefined) {
              jobScoreUppers.push(resourceBudgetScoreUpperForAttributes(jobIndex, attributes!));
            }
          }
          recordUpperBound(chosen.map((entry) => entry.selector), jobRatios, jobScoreUppers);
          return;
        }
        const domain = sharedKeyDomains[domainIndex]!;
        for (const [key, selector] of orderedSelectorsByDomain[domainIndex]!) {
          if (stoppedEarly || shouldStop()) return;
          chosen.push({
            selector,
            fixedChoice: domain.kind === "equipment"
              ? { kind: "equipment", commonSlot: domain.name, key }
              : { kind: "food", key },
          });
          sharedAssignmentPrefixesEvaluated++;
          if (isCompleteDomain) {
            visit(domainIndex + 1);
          } else {
            const jobRatios: ExactRatio[] = [];
            const jobScoreUppers: (bigint | undefined)[] | undefined =
              useResourceBudgetSharedPrefixBounds ? [] : undefined;
            let hasUnknownBound = false;
            for (let jobIndex = 0; jobIndex < preparedJobs.length; jobIndex++) {
              if (shouldStop()) return;
              const attributes = coordinateUpperAttributes(
                jobIndex, chosen.map((entry) => entry.fixedChoice),
              );
              const ratio = attributes === undefined
                ? undefined
                : exactUpperRatio(jobIndex, attributes);
              if (ratio === undefined) {
                hasUnknownBound = true;
                break;
              }
              jobRatios.push(ratio);
              if (jobScoreUppers !== undefined) {
                jobScoreUppers.push(domainIndex + 1 === sharedKeyDomains.length
                  ? resourceBudgetScoreUpperForAttributes(jobIndex, attributes!)
                  : undefined);
              }
            }
            // 每项属性分别取最大值会高估此此前缀下的所有补全方案，
            // 因此可用一条约束排除不可能改进的前缀，而不必遍历其余共享选择。
            if (!stoppedEarly && !hasUnknownBound && (
              (jobScoreUppers !== undefined && factorScoreUpperCannotBeatThreshold(
                jobScoreUppers,
                best!.numerator - BigInt(preparedJobs.length - 1) * best!.denominator,
                best!.denominator,
              )) || ratioSumAtOrBelowThreshold(jobRatios, best!.numerator, best!.denominator)
            )) {
              recordUpperBound(chosen.map((entry) => entry.selector), jobRatios, jobScoreUppers);
            } else if (!stoppedEarly && domainIndex + 1 < sharedKeyDomains.length) {
              visit(domainIndex + 1);
            } else if (!stoppedEarly && !hasUnknownBound && domainIndex + 1 === sharedKeyDomains.length) {
              sharedAssignmentCandidatesEvaluated++;
            } else if (!stoppedEarly && hasUnknownBound && domainIndex + 1 === sharedKeyDomains.length) {
              sharedAssignmentCandidatesEvaluated++;
            }
          }
          chosen.pop();
          if (stoppedEarly) return;
        }
      };
      visit(0);
      if (isCompleteDomain && !stoppedEarly) sharedAssignmentCompleteEnumerationDone = true;
    } finally {
      sharedAssignmentPreprocessingMs += performance.now() - preprocessingStartedAt;
    }
  };
  const addRatioUpperNecessaryCuts = (
    solveRows: ModelRow[],
    incumbentNumerator: bigint,
    incumbentDenominator: bigint,
  ) => {
    const jobCount = preparedJobs.length;
    const addSubsetCut = (jobIndexes: readonly number[]) => {
      const thresholdNumerator = incumbentNumerator - BigInt(jobCount - jobIndexes.length) * incumbentDenominator;
      if (thresholdNumerator <= 0n) return;
      // 要使总和有所提升，所选子集必须超过此界，因为所有未选职业的归一化比值都至多为 1。
      // 整数比值上界变量会向上取整每个精确比值，因此这个严格缩放下界既必要又安全。
      const minimumScaledSum = thresholdNumerator * ratioUpperBoundScale / incumbentDenominator + 1n;
      if (minimumScaledSum > BigInt(Number.MAX_SAFE_INTEGER)) return;
      const rowName = `joint_necessary_ratio_sum_${jobIndexes.join("_")}`;
      addRows(solveRows, rowName,
        jobIndexes.map((jobIndex) => [ratioUpperBoundVariables[jobIndex]!, 1] as const),
        ">=", Number(minimumScaledSum));
      ratioUpperNecessaryRows.add(rowName);
    };
    const visitSubsets = (size: number, start: number, selected: number[]) => {
      if (selected.length === size) {
        addSubsetCut(selected);
        return;
      }
      const needed = size - selected.length;
      for (let index = start; index <= jobCount - needed; index++) {
        selected.push(index);
        visitSubsets(size, index + 1, selected);
        selected.pop();
      }
    };
    for (let subsetSize = 1; subsetSize <= jobCount; subsetSize++) {
      if (subsetSize > 3 && subsetSize < jobCount) continue;
      visitSubsets(subsetSize, 0, []);
    }
  };
  throwIfCancelled(isCancelled);
  const excluded: string[][] = [];
  let solverRuns = 0;
  let innerSolverStatus: "Optimal" | "DualBound" = "Optimal";
  let best: { numerator: bigint; denominator: bigint; results: ExactMipResult[] } | undefined;
  if (jointInitialResults !== undefined) {
    if (jointInitialResults.length !== preparedJobs.length) throw new Error("联合初始方案职业数不匹配");
    let numerator = 0n;
    let denominator = 1n;
    for (let index = 0; index < preparedJobs.length; index++) {
      const jointJob = preparedJobs[index]!;
      const { job, prepared } = jointJob;
      const result = jointInitialResults[index]!;
      const modelSelection = internalRingSelection(jointJob, result.selection);
      if (modelSelection === undefined || modelSelection.length !== job.options.slots.length ||
        modelSelection.some((equipment, slot) => !job.options.slots[slot]!.some((candidate) =>
          jointJob.ringSplit !== undefined &&
          (slot === jointJob.ringSplit.firstSlotIndex || slot === jointJob.ringSplit.secondSlotIndex)
            ? ringChildStructuralKey(candidate) === ringChildStructuralKey(equipment)
            : options.equipmentIdentity(candidate) === options.equipmentIdentity(
              equipment.resistanceAllocation === undefined
                ? equipment
                : { ...equipment, resistanceAllocation: undefined },
            )))) {
        throw new Error("联合初始方案装备不属于模型候选");
      }
      if (hasUniqueRingConflict(modelSelection)) {
        throw new Error("联合初始方案重复使用唯一戒指");
      }
      if (result.food === undefined ? job.options.foods.length > 0 :
        !job.options.foods.some((food) => options.foodIdentity(food) === options.foodIdentity(result.food!))) {
        throw new Error("联合初始方案食物不属于模型候选");
      }
      const attributes = getAttributeVector(modelSelection, result.food, job.options.attributeIds, job.options.equipmentAttributeExtractor, job.options.statIndexes);
      for (const [attribute, range] of prepared.model.ranges) {
        if ((range.min !== undefined && attributes[attribute]! < range.min) ||
          (range.max !== undefined && attributes[attribute]! > range.max)) throw new Error("联合初始方案不满足属性约束");
      }
      const factors = prepared.factorEvaluator(attributes);
      if (factors === undefined) throw new Error("联合初始方案无法计算整数因子");
      const constraints = job.options.constraints;
      if (constraints?.gcd !== undefined &&
        Math.round(constraints.gcd * 100) !== factors.gcdCentiseconds) {
        throw new Error("联合初始方案不满足标量 GCD 约束");
      }
      if (constraints?.gcdChoices !== undefined &&
        !constraints.gcdChoices.some((value) => Math.round(value * 100) === factors.gcdCentiseconds)) {
        throw new Error("联合初始方案不满足 GCD 集合");
      }
      for (const slot of options.commonSlots) {
        const currentIdentity = originalSelectionIdentity(result.selection, slot, index);
        const firstIdentity = originalSelectionIdentity(jointInitialResults[0]!.selection, slot, 0);
        if (currentIdentity === undefined || firstIdentity === undefined || currentIdentity !== firstIdentity) {
          throw new Error("联合初始方案装备不共享");
        }
      }
      if (options.sharedFood && (result.food === undefined ? "none" : options.foodIdentity(result.food)) !==
        (jointInitialResults[0]!.food === undefined ? "none" : options.foodIdentity(jointInitialResults[0]!.food!))) {
        throw new Error("联合初始方案食物不共享");
      }
      const ratioNumerator = exactProduct(factors) * (options.objective === "dps" ? BigInt(job.baseline.gcdCentiseconds) : 1n);
      const ratioDenominator = exactProduct(job.baseline) * (options.objective === "dps" ? BigInt(factors.gcdCentiseconds) : 1n);
      if (ratioNumerator > ratioDenominator) throw new Error("联合初始方案超过单职业基线");
      numerator = numerator * ratioDenominator + ratioNumerator * denominator;
      denominator *= ratioDenominator;
    }
    best = { numerator, denominator, results: [...jointInitialResults] };
  }
  const groupCount = preparedJobs.reduce((sum, { prepared }) => sum + prepared.groups.length, 0);
  if (best !== undefined) {
    prepareSharedPairUpperBounds(best.numerator, best.denominator);
    prepareSharedAssignmentUpperBounds();
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
      reachableFactorClassesRemoved: preparedJobs.reduce((sum, { prepared }) =>
        sum + prepared.reachableFactorClassesRemoved, 0),
      reachableAttributePruningSkipped: preparedJobs.reduce((sum, { prepared }) =>
        sum + prepared.reachableAttributePruningSkipped, 0),
      reachableWeaponFactorClassesRemoved: preparedJobs.reduce((sum, { prepared }) =>
        sum + prepared.reachableWeaponFactorClassesRemoved, 0),
      reachableWeaponPruningSkipped: preparedJobs.reduce((sum, { prepared }) =>
        sum + prepared.reachableWeaponPruningSkipped, 0),
      factorClassGroupSummary: JSON.stringify(preparedJobs.map(({ job, prepared }, jobIndex) => ({
        job: job.id,
        groups: prepared.groups.map((group) => {
          const boundsForGroup = factorClassUpperBoundsByJobAndGroup[jobIndex]!.get(group.name) ?? [];
          const maximum = boundsForGroup.reduce((best, bound) =>
            compareExactRatios(bound.ratio, best) > 0 ? bound.ratio : best,
            { numerator: 0n, denominator: 1n } as ExactRatio);
          return {
            name: group.name,
            classes: group.classes.length,
            maximumRatio: `${maximum.numerator}/${maximum.denominator}`,
          };
        }),
      }))),
      ratioUpperBoundPairCuts: ratioUpperBoundPairCutCount,
      ratioUpperBoundPairPreprocessingWork,
      ratioUpperBoundPairPolicy: options.ratioUpperPairPolicy ?? "default",
      sharedAccessoryPairDominancePolicy: sharedAccessoryPairDominanceEnabled
        ? "strict-with-safe-replacement"
        : "disabled",
      sharedAccessoryPairDominanceCandidateUpperBound: sharedAccessoryPairDominanceCandidateUpperBound.toString(),
      sharedAccessoryPairDominanceCandidates: sharedAccessoryPairDominanceCandidateCount,
      sharedAccessoryPairDominanceComparisons,
      sharedAccessoryPairDominanceCuts,
      sharedAccessoryPairDominanceMaximumCuts,
      sharedAccessoryPairDominanceMaximumComparisons,
      sharedAccessoryPairDominancePreprocessingMs,
      sharedAccessoryPairDominancePreprocessingBudgetMs,
      sharedAccessoryPairDominanceLimitReached: Number(sharedAccessoryPairDominanceLimitReached),
      sharedPairCandidateUpperBound: sharedPairCandidateUpperBound.toString(),
      sharedPairCandidateCount,
      sharedPairCandidatesEvaluated,
      sharedPairPreprocessingMs,
      sharedPairPreprocessingSkipped: Number(sharedPairPreprocessingSkipped),
      sharedAssignmentCandidateUpperBound: sharedAssignmentCandidateUpperBound.toString(),
      sharedAssignmentCandidateCount,
      sharedAssignmentCandidatesEvaluated,
      sharedAssignmentPrefixChoiceOrder,
      sharedAssignmentDomainOrder,
      sharedAssignmentUpperBoundCount: sharedAssignmentUpperBounds?.length ?? 0,
      sharedAssignmentCutPrefixDepthCounts: JSON.stringify(sharedAssignmentCutPrefixDepthCounts),
      sharedAssignmentPrefixEvaluationLimit,
      sharedAssignmentUpperBoundLimit,
      sharedAssignmentPreprocessingBudgetMs,
      sharedAssignmentPreprocessingMs,
      sharedAssignmentPreprocessingSkipped: Number(sharedAssignmentPreprocessingSkipped),
      factorClassUpperBoundCount: factorClassUpperBounds.length,
      resourceBudgetCandidateUpperBoundCandidates: resourceBudgetCandidateUpperBounds.length,
      resourceBudgetCandidateUpperBoundPreparationMs,
      resourceBudgetCandidateUpperBoundSkippedJobs,
    },
  );
  let solverWallMs = 0;
  let iterationModelBuildMs = 0;
  let postSolveMs = 0;
  while (true) {
    throwIfCancelled(isCancelled);
    if (best !== undefined) {
      const thresholdNumerator = best.numerator - BigInt(options.jobs.length - 1) * best.denominator;
      prepareSharedPairUpperBounds(best.numerator, best.denominator);
      prepareSharedAssignmentUpperBounds();
    }
    const remaining = options.maxSearchMs === undefined
      ? undefined
      : options.maxSearchMs - (performance.now() - startedAt);
    if (remaining !== undefined && remaining <= 0) {
      throw new Error("联合因子 MIP 达到时限，未完成最优性复核");
    }
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
          // 要使总和超过当前最优值且其他比值均不超过 1，还要求每个比值都大于 t。
          const individualRhs = BigInt(surrogate.baseline - surrogate.offset - surrogate.error) - loss;
          if (individualRhs >= BigInt(Number.MIN_SAFE_INTEGER) && individualRhs <= BigInt(Number.MAX_SAFE_INTEGER)) {
            addRows(solveRows, `joint_necessary_job_${index}`, surrogate.terms, ">=", Number(individualRhs));
          }
        }
        for (const upperBound of factorClassUpperBounds) {
          if (ratioAtOrBelowThreshold(upperBound.ratio, thresholdNumerator, best.denominator)) {
            addRows(solveRows, upperBound.rowName,
              [[prefix(upperBound.jobIndex, upperBound.variable), 1]], "=", 0);
            factorClassConflictRows.add(upperBound.rowName);
          }
        }
        addCandidateSpecificUpperBoundProofRows(solveRows, best.numerator, best.denominator);
      }
      for (const upperBound of [...sharedEquipmentUpperBounds, ...sharedFoodUpperBounds]) {
        if (
          (thresholdNumerator > 0n &&
            cannotBeatThreshold(upperBound.jobRatios, thresholdNumerator, best.denominator)) ||
          ratioSumAtOrBelowThreshold(upperBound.jobRatios, best.numerator, best.denominator)
        ) {
          addRows(solveRows, upperBound.rowName, [[upperBound.selector, 1]], "=", 0);
        }
      }
      for (const upperBound of sharedPairUpperBounds ?? []) {
        if (
          (thresholdNumerator > 0n &&
            cannotBeatThreshold(upperBound.jobRatios, thresholdNumerator, best.denominator)) ||
          ratioSumAtOrBelowThreshold(upperBound.jobRatios, best.numerator, best.denominator)
        ) {
          addRows(solveRows, upperBound.rowName,
            [[upperBound.selectorA, 1], [upperBound.selectorB, 1]], "<=", 1);
          sharedPairConflictRows.add(upperBound.rowName);
        }
      }
      addTwoJobWithinJobFactorPairCuts(solveRows, best.numerator, best.denominator);
      addTwoJobWithinJobFactorTripleCuts(solveRows, best.numerator, best.denominator);
      addCrossJobFactorClassGroupPairCuts(solveRows, best.numerator, best.denominator);
      addCrossJobFactorClassGroupTripleCuts(solveRows, best.numerator, best.denominator);
      addRatioUpperNecessaryCuts(solveRows, best.numerator, best.denominator);
      for (const upperBound of sharedAssignmentUpperBounds ?? []) {
        const resourceScoreCut = upperBound.jobScoreUppers !== undefined &&
          factorScoreUpperCannotBeatThreshold(
            upperBound.jobScoreUppers,
            thresholdNumerator,
            best.denominator,
          );
        if (resourceScoreCut || ratioSumAtOrBelowThreshold(
          upperBound.jobRatios, best.numerator, best.denominator,
        )) {
          addRows(solveRows, upperBound.rowName,
            upperBound.selectors.map((selector) => [selector, 1] as const), "<=", upperBound.selectors.length - 1);
          sharedAssignmentConflictRows.add(upperBound.rowName);
          if (resourceScoreCut) sharedAssignmentResourceScoreConflictRows.add(upperBound.rowName);
        }
      }
    }
    excluded.forEach((signature, index) => addRows(solveRows, `joint_nogood_${index}`,
      signature.map((name) => [name, 1] as const), "<=", signature.length - 1));
    throwIfCancelled(isCancelled);
    const solutionHint = new Map<string, number>();
    // 在证明工作量较大的双职业重跑中，部分当前最优解提示并未帮助 HiGHS 修复出可行解；
    // 省略该提示不会改变模型。
    if (best !== undefined && !(preparedJobs.length === 2 && solverRuns > 0)) {
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
            : options.equipmentIdentity(entry) === options.equipmentIdentity(
              equipment.resistanceAllocation === undefined
                ? equipment
                : { ...equipment, resistanceAllocation: undefined },
            ));
          if (candidate < 0) throw new Error(`联合解提示装备不属于模型候选：${job.id}/${slotIndex}`);
          solutionHint.set(prefix(jobIndex, prepared.model.slotVariables[slotIndex]![candidate]!), 1);
        });
        if (result.food !== undefined) {
          const foodIndex = job.options.foods.findIndex((entry) =>
            options.foodIdentity(entry) === options.foodIdentity(result.food!));
          if (foodIndex < 0) throw new Error(`联合解提示食物不属于模型候选：${job.id}`);
          solutionHint.set(prefix(jobIndex, prepared.model.foodVariables[foodIndex]!), 1);
        }
      }
      for (const domain of sharedEquipmentDomains) {
        const key = originalSelectionIdentity(best.results[0]!.selection, domain.slot, 0);
        const selector = key === undefined ? undefined : sharedEquipmentSelectors.get(domain.slot)?.get(key);
        if (selector === undefined) throw new Error(`联合解提示缺少共享装备选择：${domain.slot}`);
        solutionHint.set(selector, 1);
      }
      if (sharedFoodSelectors !== undefined) {
        const food = best.results[0]!.food;
        const key = food === undefined ? undefined : options.foodIdentity(food);
        const selector = key === undefined ? undefined : sharedFoodSelectors.get(key);
        if (selector === undefined) throw new Error("联合解提示缺少共享食物选择");
        solutionHint.set(selector, 1);
      }
    }
    iterationModelBuildMs += performance.now() - iterationModelBuildStartedAt;
    if (options.onSolverProgress !== undefined) emitProfileEvent(
      options.onSolverProgress,
      profileBackend,
      "joint_factor_product",
      "joint-model-iteration-ready",
      {
        solverRuns,
        variables: bounds.length,
        constraints: solveRows.length,
        nonzeros: solveRows.reduce((sum, row) => sum + row.terms.size, 0),
        sharedPairConflictCuts: sharedPairConflictRows.size,
        sharedAssignmentConflictCuts: sharedAssignmentConflictRows.size,
        sharedAssignmentResourceScoreCuts: sharedAssignmentResourceScoreConflictRows.size,
        factorClassConflictCuts: factorClassConflictRows.size,
        factorClassPairConflictCuts: factorClassPairConflictRows.size,
        factorClassJointPairConflictCuts: factorClassJointPairConflictRows.size,
        factorClassJointTripleConflictCuts: factorClassJointTripleConflictRows.size,
        factorClassTripleConflictCuts: factorClassTripleConflictRows.size,
        ratioUpperNecessaryCuts: ratioUpperNecessaryRows.size,
        candidateSpecificUpperBoundCandidates: candidateSpecificUpperBounds.length,
        candidateSpecificUpperBoundCutRows: candidateSpecificUpperBoundProofRows.size,
        candidateSpecificUpperBoundEqualityCuts: candidateSpecificUpperBoundEqualityRows.size,
        resourceBudgetCandidateUpperBoundCandidates: resourceBudgetCandidateUpperBounds.length,
        resourceBudgetCandidateUpperBoundCutRows: resourceBudgetCandidateUpperBoundProofRows.size,
        candidateSpecificUpperBoundSkippedJobs,
      },
    );
    const optimizingRatioUpperBound = ratioUpperBoundObjectiveEnabled;
    const solverCallStartedAt = performance.now();
    const output = await solveIntegerModel({
      name: "joint_factor_product",
      objective: ratioUpperBoundObjectiveEnabled ? ratioUpperBoundObjective : new Map(),
      rows: solveRows,
      variables: bounds,
      binaryVariables: binaries,
      integerVariables: generals,
      timeLimitMs: remaining,
      ...(solutionHint.size === 0 ? {} : { solutionHint }),
      ...(best === undefined ? {} : {
        stopWhenDualBoundProvesOptimal: (dualBound: number) => {
          const conservativeIntegerUpperBound = Math.ceil(dualBound);
          if (!Number.isSafeInteger(conservativeIntegerUpperBound)) return false;
          return BigInt(conservativeIntegerUpperBound) * best!.denominator <=
            best!.numerator * ratioUpperBoundScale;
        },
      }),
      ...(options.onSolverProgress === undefined ? {} : { onProgress: options.onSolverProgress }),
      ...(options.onSolverCallback === undefined ? {} : { onCallback: options.onSolverCallback }),
    });
    solverWallMs += performance.now() - solverCallStartedAt;
    const postSolveStartedAt = performance.now();
    throwIfCancelled(isCancelled);
    solverRuns++;
    options.onProgress?.(`HiGHS 联合因子 MIP 状态=${output.Status}；已检查签名=${excluded.length}；耗时=${Math.round(performance.now() - startedAt)}ms`);
    if (output.Status === "DualBound") {
      innerSolverStatus = "DualBound";
      postSolveMs += performance.now() - postSolveStartedAt;
      break;
    }
    if (output.Status === "Infeasible") {
      postSolveMs += performance.now() - postSolveStartedAt;
      break;
    }
    if (output.Status !== "Optimal") throw new Error(`联合因子 MIP 未证明最优：${output.Status}`);
    validateMipSolution(solveRows, bounds, output.Columns);
    const upperBoundScaled = optimizingRatioUpperBound
      ? ratioUpperBoundVariables.reduce((sum, name) =>
          sum + BigInt(Math.round(output.Columns[name]?.Primal ?? 0)), 0n)
      : undefined;
    const signature: string[] = [];
    const results: ExactMipResult[] = [];
    let numerator = 0n;
    let denominator = 1n;
    for (let index = 0; index < preparedJobs.length; index++) {
      const jointJob = preparedJobs[index]!;
      const { job, prepared } = jointJob;
      const columns = Object.fromEntries(prepared.model.bounds.map(({ name }) =>
        [name, output.Columns[prefix(index, name)] ?? { Primal: 0 }]));
      const modelSelection = slotsForResultWithResistanceAllocations(
        job.options.slots,
        prepared.model.slotVariables,
        prepared.model.resistanceAllocationVariables,
        columns,
      );
      const selection = originalRingSelection(jointJob, modelSelection);
      const food = foodForResult(job.options.foods, prepared.model.foodVariables, columns);
      const attributes = getAttributeVector(modelSelection, food, job.options.attributeIds, job.options.equipmentAttributeExtractor, job.options.statIndexes);
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
    if (upperBoundScaled !== undefined &&
      upperBoundScaled * best.denominator <= best.numerator * ratioUpperBoundScale) {
      postSolveMs += performance.now() - postSolveStartedAt;
      break;
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
    sharedAssignmentCandidateUpperBound: sharedAssignmentCandidateUpperBound.toString(),
    sharedAssignmentCandidateCount,
    sharedAssignmentCandidatesEvaluated,
    sharedAssignmentPrefixChoiceOrder,
    sharedAssignmentDomainOrder,
    sharedAssignmentConflictCuts: sharedAssignmentConflictRows.size,
    sharedAssignmentResourceScoreCuts: sharedAssignmentResourceScoreConflictRows.size,
    sharedAssignmentUpperBoundCount: sharedAssignmentUpperBounds?.length ?? 0,
    sharedAssignmentCutPrefixDepthCounts: JSON.stringify(sharedAssignmentCutPrefixDepthCounts),
    sharedAssignmentPrefixEvaluationLimit,
    sharedAssignmentUpperBoundLimit,
    sharedAssignmentPreprocessingBudgetMs,
    sharedAssignmentPreprocessingMs,
    sharedAssignmentPreprocessingSkipped: Number(sharedAssignmentPreprocessingSkipped),
    factorClassUpperBoundCount: factorClassUpperBounds.length,
    factorClassConflictCuts: factorClassConflictRows.size,
    factorClassPairConflictCuts: factorClassPairConflictRows.size,
    factorClassJointPairConflictCuts: factorClassJointPairConflictRows.size,
    factorClassJointTripleConflictCuts: factorClassJointTripleConflictRows.size,
    factorClassTripleConflictCuts: factorClassTripleConflictRows.size,
    factorClassTriplePreprocessingWork,
    factorClassTriplePreprocessingSkipped: Number(factorClassTriplePreprocessingSkipped),
    candidateSpecificUpperBoundPreparationMs,
    candidateSpecificUpperBoundSkippedJobs,
    candidateSpecificUpperBoundCandidates: candidateSpecificUpperBounds.length,
    candidateSpecificUpperBoundCutRows: candidateSpecificUpperBoundProofRows.size,
    candidateSpecificUpperBoundEqualityCuts: candidateSpecificUpperBoundEqualityRows.size,
    resourceBudgetCandidateUpperBoundCandidates: resourceBudgetCandidateUpperBounds.length,
    resourceBudgetCandidateUpperBoundPreparationMs,
    resourceBudgetCandidateUpperBoundSkippedJobs,
    resourceBudgetCandidateUpperBoundCutRows: resourceBudgetCandidateUpperBoundProofRows.size,
    ratioUpperBoundPairCuts: ratioUpperBoundPairCutCount,
    ratioUpperBoundPairPreprocessingWork,
    ratioUpperBoundPairPolicy: options.ratioUpperPairPolicy ?? "default",
    sharedAccessoryPairDominancePolicy: sharedAccessoryPairDominanceEnabled
      ? "strict-with-safe-replacement"
      : "disabled",
    sharedAccessoryPairDominanceCandidateUpperBound: sharedAccessoryPairDominanceCandidateUpperBound.toString(),
    sharedAccessoryPairDominanceCandidates: sharedAccessoryPairDominanceCandidateCount,
    sharedAccessoryPairDominanceComparisons,
    sharedAccessoryPairDominanceCuts,
    sharedAccessoryPairDominanceMaximumCuts,
    sharedAccessoryPairDominanceMaximumComparisons,
    sharedAccessoryPairDominancePreprocessingMs,
    sharedAccessoryPairDominancePreprocessingBudgetMs,
    sharedAccessoryPairDominanceLimitReached: Number(sharedAccessoryPairDominanceLimitReached),
    sharedAssignmentPrefixSearchUsed: Number(sharedAssignmentPrefixSearchUsed),
    sharedAssignmentPrefixesEvaluated,
    ratioUpperNecessaryCuts: ratioUpperNecessaryRows.size,
  };
  if (options.onSolverProgress !== undefined) emitProfileEvent(
    options.onSolverProgress,
    profileBackend,
    "joint_factor_product",
    "joint-search-summary",
    profile,
  );
  return { results: best.results, solverRuns, signatures: excluded.length, innerSolverStatus };
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

function factorResourceWeightVectors(
  groups: readonly FactorGroup[],
  axisNames: readonly string[],
): number[][] {
  const slopeAt = (name: string) => {
    const group = groups.find((entry) => entry.name === name);
    if (group === undefined || group.classes.length < 2) return 0;
    const first = group.classes[0]!;
    const last = group.classes[group.classes.length - 1]!;
    const span = last.max - first.min;
    const gain = last.q - first.q;
    return span > 0 && gain > 0 ? gain / span : 0;
  };

  const gcd = (left: number, right: number): number => {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b !== 0) [a, b] = [b, a % b];
    return a;
  };
  const vectors = new Map<string, number[]>();
  const slopes = axisNames.map(slopeAt);
  const maximumSlope = Math.max(0, ...slopes);
  if (maximumSlope === 0) return [];
  for (const scale of [16, 64, 256]) {
    const weights = slopes.map((slope) => slope <= 0
      ? 0
      : Math.max(1, Math.round((slope / maximumSlope) * scale)));
    const divisor = weights.reduce((value, weight) => weight === 0 ? value : gcd(value, weight), 0);
    if (divisor <= 0) continue;
    const normalized = weights.map((weight) => weight / divisor);
    const active = normalized.filter((weight) => weight > 0);
    if (active.length < 2 || active.every((weight) => weight === active[0])) continue;
    vectors.set(normalized.join(":"), normalized);
  }
  return [...vectors.values()];
}

type ConditionalResourceSupportStats = {
  candidateBands: number;
  rowsAdded: number;
  weightedRowsAdded?: number;
  nonzerosAdded: number;
  weightedResourceWeights?: Readonly<Record<string, number>>;
  skipReason?: "disabled-by-policy" | "no-out-of-window-candidates" | "no-strictly-tighter-bands" | "ring-pair-candidates" | "model-budget";
};

const CANDIDATE_LEVEL_BAND_SIZE = 20;
const MAX_CONDITIONAL_BANDS_PER_SLOT = 12;
const MAX_CONDITIONAL_RESOURCE_ROWS = 128;
const MAX_CONDITIONAL_RESOURCE_NONZEROS = 250_000;
const MAX_COMPACT_RESOURCE_THRESHOLDS_PER_SLOT = 1;

function addCandidateLevelConditionalResourceSupports(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  groups: readonly FactorGroup[],
  foodMaximumBonuses: readonly (readonly number[])[],
  resourceAttributeIndexes: ReadonlyMap<string, number | undefined>,
): ConditionalResourceSupportStats | undefined {
  const profile = options.candidateResourceSupportProfile ?? "balanced";
  if (profile === "disabled") {
    return { candidateBands: 0, rowsAdded: 0, nonzerosAdded: 0, skipReason: "disabled-by-policy" };
  }
  const ranges = options.candidateItemLevelRanges;
  if (ranges === undefined || ranges.length === 0 || options.equipmentAttributeExtractor !== undefined ||
    ranges.some(({ min, max }) => !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max)) {
    return undefined;
  }
  if (options.slots.some((slot) => slot.some(hasRingPairProperty))) {
    return { candidateBands: 0, rowsAdded: 0, nonzerosAdded: 0, skipReason: "ring-pair-candidates" };
  }
  // 对所有与伤害相关的属性资源进行预算。尤其是品级较低但主属性或武器伤害更高的候选，
  // 在与暴击、信念或直击属性权衡时仍须保留这部分贡献。
  const resourceAxes = (["main", "weapon", "det", "ten", "crt", "dht", "gcd"] as const).flatMap((name) => {
    const attribute = resourceAttributeIndexes.get(name);
    const group = groups.find((candidate) => candidate.name === name);
    return attribute === undefined || group === undefined ? [] : [[name, attribute, group] as const];
  });
  if (resourceAxes.length === 0 || model.slotVariables.length !== options.slots.length ||
    model.equipmentAttributes.length !== options.slots.length) return undefined;

  const inPriorRanges = (itemLevel: number) => ranges.some(({ min, max }) => itemLevel >= min && itemLevel <= max);
  const outsidePriorCandidatesBySlot: number[][] = [];
  let candidateBands = 0;
  let exceedsPerSlotBudget = false;
  for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
    const candidates = options.slots[slotIndex]!;
    const vectors = model.equipmentAttributes[slotIndex];
    const variables = model.slotVariables[slotIndex];
    if (vectors === undefined || variables === undefined ||
      vectors.length !== candidates.length || variables.length !== candidates.length) return undefined;
    const bands = new Set<number>();
    const outsidePriorCandidates: number[] = [];
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      const equipment = candidates[candidateIndex]!;
      const vector = vectors[candidateIndex];
      if (!Number.isSafeInteger(equipment.itemLevel) || equipment.itemLevel < 0 ||
        vector === undefined || variables[candidateIndex] === undefined) return undefined;
      if (inPriorRanges(equipment.itemLevel)) continue;
      const band = Math.floor(equipment.itemLevel / CANDIDATE_LEVEL_BAND_SIZE);
      bands.add(band);
      outsidePriorCandidates.push(candidateIndex);
    }
    exceedsPerSlotBudget ||= bands.size > MAX_CONDITIONAL_BANDS_PER_SLOT;
    candidateBands += bands.size;
    outsidePriorCandidatesBySlot.push(outsidePriorCandidates);
  }
  if (candidateBands === 0) {
    return { candidateBands: 0, rowsAdded: 0, nonzerosAdded: 0, skipReason: "no-out-of-window-candidates" };
  }
  if (exceedsPerSlotBudget || candidateBands > MAX_CONDITIONAL_RESOURCE_ROWS) {
    return { candidateBands, rowsAdded: 0, nonzerosAdded: 0, skipReason: "model-budget" };
  }

  const resourceForVector = (vector: readonly number[]): number | undefined => {
    let total = 0;
    for (const [, attribute] of resourceAxes) {
      const value = vector[attribute];
      if (!Number.isSafeInteger(value) || value! < 0) return undefined;
      total += value!;
      if (!Number.isSafeInteger(total)) return undefined;
    }
    return total;
  };
  const resourcesBySlot: number[][] = [];
  const slotMaximums: number[] = [];
  for (const vectors of model.equipmentAttributes) {
    const resources = vectors.map(resourceForVector);
    if (resources.length === 0 || resources.some((value) => value === undefined)) return undefined;
    const validResources = resources as number[];
    resourcesBySlot.push(validResources);
    slotMaximums.push(validResources.reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY));
  }
  const maximumFoodResource = foodMaximumBonuses.reduce((maximum, bonuses) => {
    let total = 0;
    for (const [, attribute] of resourceAxes) {
      const value = bonuses[attribute];
      if (!Number.isSafeInteger(value) || value! < 0) return Number.NaN;
      total += value!;
      if (!Number.isSafeInteger(total)) return Number.NaN;
    }
    return Math.max(maximum, total);
  }, 0);
  if (!Number.isSafeInteger(maximumFoodResource) || maximumFoodResource < 0) return undefined;
  const maximumGearResource = slotMaximums.reduce((total, value) => total + value, 0);
  const globalBudget = maximumGearResource + maximumFoodResource;
  if (!Number.isSafeInteger(maximumGearResource) || !Number.isSafeInteger(globalBudget)) return undefined;

  const resourceTerms = new Map<string, number>();
  const maximumBluWeaponAddition = options.job === "BLU"
    ? Math.max(0, ...(groups.find((group) => group.name === "main")?.classes
      .map((factorClass) => factorClass.auxiliary ?? 0) ?? [0]))
    : 0;
  for (const [name, , group] of resourceAxes) {
    for (const factorClass of group.classes) {
      if (!Number.isSafeInteger(factorClass.min) || factorClass.min < 0) return undefined;
      // 青魔法师的武器因子包含依赖 INT 的加成。减去该加成的最大值后，
      // 对所有主属性与武器伤害组合，此约束行仍由装备原始属性蕴含，同时保留有用的下界。
      const minimum = name === "weapon"
        ? Math.max(0, factorClass.min - maximumBluWeaponAddition)
        : factorClass.min;
      addTerm(resourceTerms, factorClass.variable, minimum);
    }
  }
  if (resourceTerms.size === 0) return { candidateBands, rowsAdded: 0, nonzerosAdded: 0 };

  const pendingRows: { name: string; terms: Map<string, number>; sense: "<="; rhs: number }[] = [];
  let nonzerosAdded = 0;
  const maxThresholdsPerSlot = profile === "compact" || profile === "compact-weighted"
    ? MAX_COMPACT_RESOURCE_THRESHOLDS_PER_SLOT
    : MAX_CONDITIONAL_BANDS_PER_SLOT;
  for (let slotIndex = 0; slotIndex < outsidePriorCandidatesBySlot.length; slotIndex++) {
    const slotMaximum = slotMaximums[slotIndex]!;
    const otherGearMaximum = maximumGearResource - slotMaximum;
    if (!Number.isSafeInteger(otherGearMaximum) || otherGearMaximum < 0) return undefined;
    const variables = model.slotVariables[slotIndex]!;
    const outsideCandidates = outsidePriorCandidatesBySlot[slotIndex]!;
    const thresholds = [...new Set(outsideCandidates
      .map((candidateIndex) => resourcesBySlot[slotIndex]![candidateIndex]!)
      .filter((resource) => resource < slotMaximum))].sort((left, right) => left - right);
    const selectedThresholds = thresholds.length <= maxThresholdsPerSlot
      ? thresholds
      : maxThresholdsPerSlot === 1
      ? [thresholds.at(-1)!]
      : Array.from({ length: maxThresholdsPerSlot }, (_, index) =>
          thresholds[Math.round(index * (thresholds.length - 1) / (maxThresholdsPerSlot - 1))]!)
        .filter((threshold, index, values) => values.indexOf(threshold) === index);
    for (let thresholdIndex = 0; thresholdIndex < selectedThresholds.length; thresholdIndex++) {
      const resourceThreshold = selectedThresholds[thresholdIndex]!;
      const activationVariables = outsideCandidates.flatMap((candidateIndex) =>
        resourcesBySlot[slotIndex]![candidateIndex]! <= resourceThreshold
          ? [variables[candidateIndex]!]
          : []);
      if (activationVariables.some((variable) => variable === undefined) || activationVariables.length === 0) return undefined;
      const conditionalBudget = resourceThreshold + otherGearMaximum + maximumFoodResource;
      const relaxation = slotMaximum - resourceThreshold;
      if (!Number.isSafeInteger(conditionalBudget) || conditionalBudget < 0 ||
        !Number.isSafeInteger(relaxation) || relaxation < 0 ||
        conditionalBudget !== globalBudget - relaxation) return undefined;

      const terms = new Map(resourceTerms);
      for (const variable of activationVariables) addTerm(terms, variable, relaxation);
      nonzerosAdded += terms.size;
      if (pendingRows.length + 1 > MAX_CONDITIONAL_RESOURCE_ROWS ||
        nonzerosAdded > MAX_CONDITIONAL_RESOURCE_NONZEROS) {
        return { candidateBands, rowsAdded: 0, nonzerosAdded: 0, skipReason: "model-budget" };
      }
      pendingRows.push({
        name: `factor_resource_level_${slotIndex}_${thresholdIndex}`,
        terms,
        sense: "<=",
        rhs: globalBudget,
      });
    }
  }

  // 早期四职业未同步证明快照会将均匀支撑行与一个非负因子斜率方向配合使用。
  // 加权行仍由精确装备资源预算蕴含，只用于强化 HiGHS 的松弛模型。
  let weightedRowsAdded = 0;
  let selectedWeightedResourceWeights: Readonly<Record<string, number>> | undefined;
  if (profile === "compact-weighted") {
    const resourceAxisNames = resourceAxes.map(([name]) => name);
    const mainAxisIndex = resourceAxisNames.indexOf("main");
    const weightedResourceWeights = factorResourceWeightVectors(groups, resourceAxisNames).at(-1);
    if (weightedResourceWeights !== undefined && mainAxisIndex >= 0 &&
      weightedResourceWeights[mainAxisIndex]! > 0) {
      const weightedResourceForVector = (vector: readonly number[]): number | undefined => {
        let total = 0;
        for (let index = 0; index < resourceAxes.length; index++) {
          const weight = weightedResourceWeights[index]!;
          const value = vector[resourceAxes[index]![1]];
          if (!Number.isSafeInteger(weight) || weight < 0 || !Number.isSafeInteger(value) || value! < 0 ||
            value! > Math.floor((Number.MAX_SAFE_INTEGER - total) / Math.max(1, weight))) return undefined;
          total += value! * weight;
        }
        return total;
      };
      const weightedResourcesBySlot = model.equipmentAttributes.map((vectors) =>
        vectors.map(weightedResourceForVector));
      if (weightedResourcesBySlot.every((resources) => resources.length > 0 &&
        resources.every((resource) => resource !== undefined))) {
        const weightedSlotMaximums = weightedResourcesBySlot.map((resources) =>
          (resources as number[]).reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY));
        const weightedFoodMaximum = foodMaximumBonuses.reduce((maximum, bonuses) => {
          let total = 0;
          for (let index = 0; index < resourceAxes.length; index++) {
            const weight = weightedResourceWeights[index]!;
            const value = bonuses[resourceAxes[index]![1]];
            if (!Number.isSafeInteger(value) || value! < 0 ||
              value! > Math.floor((Number.MAX_SAFE_INTEGER - total) / Math.max(1, weight))) return Number.NaN;
            total += value! * weight;
          }
          return Math.max(maximum, total);
        }, 0);
        const weightedGearMaximum = weightedSlotMaximums.reduce((total, value) => total + value, 0);
        const weightedGlobalBudget = weightedGearMaximum + weightedFoodMaximum;
        const maximumWeightedBluWeaponAddition = options.job === "BLU"
          ? Math.max(0, ...(groups.find((group) => group.name === "main")?.classes
            .map((factorClass) => factorClass.auxiliary ?? 0) ?? [0]))
          : 0;
        const weightedResourceTerms = new Map<string, number>();
        let validWeightedTerms = Number.isSafeInteger(weightedGlobalBudget) && weightedGlobalBudget >= 0;
        for (let axisIndex = 0; axisIndex < resourceAxes.length && validWeightedTerms; axisIndex++) {
          const [name, , group] = resourceAxes[axisIndex]!;
          const weight = weightedResourceWeights[axisIndex]!;
          if (weight === 0) continue;
          for (const factorClass of group.classes) {
            if (!Number.isSafeInteger(factorClass.min) || factorClass.min < 0 ||
              factorClass.min > Math.floor(Number.MAX_SAFE_INTEGER / weight)) {
              validWeightedTerms = false;
              break;
            }
            const minimum = name === "weapon"
              ? Math.max(0, factorClass.min - maximumWeightedBluWeaponAddition)
              : factorClass.min;
            addTerm(weightedResourceTerms, factorClass.variable, minimum * weight);
          }
        }
        if (validWeightedTerms && weightedResourceTerms.size > 0) {
          const weightedPendingRows: typeof pendingRows = [];
          let weightedNonzeros = 0;
          for (let slotIndex = 0; slotIndex < outsidePriorCandidatesBySlot.length; slotIndex++) {
            const slotMaximum = weightedSlotMaximums[slotIndex]!;
            const outsideCandidates = outsidePriorCandidatesBySlot[slotIndex]!;
            const resources = weightedResourcesBySlot[slotIndex]! as number[];
            const thresholds = [...new Set(outsideCandidates
              .map((candidateIndex) => resources[candidateIndex]!)
              .filter((resource) => resource < slotMaximum))].sort((left, right) => left - right);
            if (thresholds.length === 0) continue;
            const resourceThreshold = thresholds.at(-1)!;
            const relaxation = slotMaximum - resourceThreshold;
            if (!Number.isSafeInteger(relaxation) || relaxation < 0) {
              validWeightedTerms = false;
              break;
            }
            const activationVariables = outsideCandidates.flatMap((candidateIndex) =>
              resources[candidateIndex]! <= resourceThreshold
                ? [model.slotVariables[slotIndex]![candidateIndex]!]
                : []);
            if (activationVariables.length === 0) continue;
            const terms = new Map(weightedResourceTerms);
            for (const variable of activationVariables) addTerm(terms, variable, relaxation);
            weightedNonzeros += terms.size;
            weightedPendingRows.push({
              name: `factor_resource_weighted_level_${slotIndex}`,
              terms,
              sense: "<=",
              rhs: weightedGlobalBudget,
            });
          }
          if (validWeightedTerms && pendingRows.length + weightedPendingRows.length <= MAX_CONDITIONAL_RESOURCE_ROWS &&
            nonzerosAdded + weightedNonzeros <= MAX_CONDITIONAL_RESOURCE_NONZEROS) {
            pendingRows.push(...weightedPendingRows);
            nonzerosAdded += weightedNonzeros;
            weightedRowsAdded = weightedPendingRows.length;
            if (weightedRowsAdded > 0) {
              selectedWeightedResourceWeights = Object.fromEntries(resourceAxisNames.map((name, index) =>
                [name, weightedResourceWeights[index]!]));
            }
          }
        }
      }
    }
  }

  for (const row of pendingRows) {
    // 选择窗口外且低于此资源阈值的候选，会收紧全局预算。
    addRows(model.rows, row.name, row.terms, row.sense, row.rhs);
  }
  return {
    candidateBands,
    rowsAdded: pendingRows.length - weightedRowsAdded,
    weightedRowsAdded,
    nonzerosAdded,
    ...(selectedWeightedResourceWeights === undefined ? {} : { weightedResourceWeights: selectedWeightedResourceWeights }),
    ...(pendingRows.length === 0 ? { skipReason: "no-strictly-tighter-bands" as const } : {}),
  };
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

function ringEquipmentIdentity(equipment: EquipInfo): string {
  return JSON.stringify({
    itemId: equipment.itemId,
    ...(equipment.variantKey === undefined ? {} : { variantKey: equipment.variantKey }),
    itemLevel: equipment.itemLevel,
    baseParams: equipment.baseParams
      .map(({ baseParamId, value }) => [baseParamId, value] as const)
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]),
    PDMG: equipment.PDMG,
    MDMG: equipment.MDMG,
    DLY: equipment.DLY,
  });
}

function symmetricRingSlotOrder(
  slots: readonly (readonly EquipInfo[])[],
  ringSlots: ReadonlyMap<0 | 1, number>,
  hasCustomExtractor: boolean,
): { firstSlotIndex: number; secondSlotIndex: number; firstRanks: number[]; secondRanks: number[] } | undefined {
  if (hasCustomExtractor || ringSlots.size !== 2) return undefined;
  const firstSlotIndex = ringSlots.get(0)!;
  const secondSlotIndex = ringSlots.get(1)!;
  const firstIdentities = slots[firstSlotIndex]!.map(ringEquipmentIdentity);
  const secondIdentities = slots[secondSlotIndex]!.map(ringEquipmentIdentity);
  if (firstIdentities.length !== secondIdentities.length) return undefined;
  const firstSorted = [...firstIdentities].sort();
  const secondSorted = [...secondIdentities].sort();
  if (firstSorted.some((identity, index) => identity !== secondSorted[index])) return undefined;
  const rankByIdentity = new Map<string, number>();
  [...new Set(firstSorted)].forEach((identity, rank) => rankByIdentity.set(identity, rank));
  return {
    firstSlotIndex,
    secondSlotIndex,
    firstRanks: firstIdentities.map((identity) => rankByIdentity.get(identity)!),
    secondRanks: secondIdentities.map((identity) => rankByIdentity.get(identity)!),
  };
}

type ResistanceAllocationVariable = {
  slotIndex: number;
  candidateIndex: number;
  stat: CustomizableStat;
  baseParamId: number;
  attributeIndex: number;
  maxValue: number;
  variable: string;
  maxTotalStats: number;
};

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
  const gcdChoiceVariables: string[] = [];
  const gcdChoiceRanges: GcdSpeedRange[] = [];
  const fixedEquipmentAttributes = slots.map((slot) => slot.map((equipment) => {
    const result = new Array<number>(attributeIds.length).fill(0);
    const params = options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
    for (const param of params) {
      const index = idToIndex.get(param.baseParamId);
      if (index !== undefined) result[index] += param.value;
    }
    return result;
  }));
  const resistanceAllocationVariables: ResistanceAllocationVariable[] = slots.flatMap((slot, slotIndex) =>
    slot.flatMap((equipment, candidateIndex) => {
      const adjustment = equipment.resistanceWeaponAdjust;
      if (adjustment === undefined) return [];
      if (!Number.isSafeInteger(adjustment.maxTotalStats) || adjustment.maxTotalStats < 0 ||
        !Number.isSafeInteger(adjustment.maxEachStat) || adjustment.maxEachStat < 0 ||
        !Array.isArray(adjustment.stats) || adjustment.stats.length === 0 ||
        new Set(adjustment.stats).size !== adjustment.stats.length) {
        throw new RangeError(`义军武器 ${equipment.itemId} 的 ResistanceWeaponAdjust 参数无效`);
      }
      return adjustment.stats.flatMap((stat) => {
        const vectorIndex = options.statIndexes.get(stat);
        const attributeId = vectorIndex === undefined ? undefined : attributeIds[vectorIndex];
        const attributeIndex = attributeId === undefined ? undefined : idToIndex.get(attributeId);
        if (attributeId === undefined || attributeIndex === undefined) {
          throw new RangeError(`义军武器 ${equipment.itemId} 的属性 ${stat} 不在搜索属性向量中`);
        }
        const statMaximum = adjustment.statMaximums?.[stat] ?? adjustment.maxEachStat;
        if (!Number.isSafeInteger(statMaximum) || statMaximum < 0) {
          throw new RangeError(`义军武器 ${equipment.itemId} 的属性 ${stat} 分配上限无效`);
        }
        const maxValue = Math.min(adjustment.maxTotalStats, adjustment.maxEachStat, statMaximum);
        return maxValue === 0 ? [] : [{
          slotIndex,
          candidateIndex,
          stat,
          baseParamId: attributeId,
          attributeIndex,
          maxValue,
          variable: `rw_${slotIndex}_${candidateIndex}_${stat}`,
          maxTotalStats: adjustment.maxTotalStats,
        }];
      });
    }),
  );
  const equipmentAttributes = fixedEquipmentAttributes.map((slot, slotIndex) =>
    slot.map((fixed, candidateIndex) => {
      const maximum = [...fixed];
      for (const allocation of resistanceAllocationVariables) {
        if (allocation.slotIndex === slotIndex && allocation.candidateIndex === candidateIndex) {
          maximum[allocation.attributeIndex] += allocation.maxValue;
        }
      }
      return maximum;
    }),
  );
  const rawMaximums = attributeIds.map((_, attribute) =>
    equipmentAttributes.reduce((total, slot) =>
      total + Math.max(0, ...slot.map((values) => values[attribute]!)), 0));
  const rawMinimums = attributeIds.map((_, attribute) =>
    fixedEquipmentAttributes.reduce((total, slot) =>
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
  const allocationVariablesByCandidate = new Map<string, typeof resistanceAllocationVariables>();
  for (const allocation of resistanceAllocationVariables) {
    const key = `${allocation.slotIndex}:${allocation.candidateIndex}`;
    const candidateAllocations = allocationVariablesByCandidate.get(key) ?? [];
    candidateAllocations.push(allocation);
    allocationVariablesByCandidate.set(key, candidateAllocations);
    bounds.push({ name: allocation.variable, min: 0, max: allocation.maxValue });
    generalVars.push(allocation.variable);
    const selected = slotVariables[allocation.slotIndex]![allocation.candidateIndex]!;
    addRows(rows, `${allocation.variable}_selected`, [
      [allocation.variable, 1],
      [selected, -allocation.maxValue],
    ], "<=", 0);
  }
  for (const [candidateKey, allocations] of allocationVariablesByCandidate) {
    const [slotIndexText, candidateIndexText] = candidateKey.split(":");
    const slotIndex = Number(slotIndexText);
    const candidateIndex = Number(candidateIndexText);
    if (!Number.isSafeInteger(slotIndex) || !Number.isSafeInteger(candidateIndex)) {
      throw new Error("义军武器 MIP 候选索引无效");
    }
    const adjustment = slots[slotIndex]![candidateIndex]!.resistanceWeaponAdjust!;
    const terms = new Map<string, number>();
    for (const allocation of allocations) addTerm(terms, allocation.variable, 1);
    addTerm(terms, slotVariables[slotIndex]![candidateIndex]!, -adjustment.maxTotalStats);
    addRows(rows, `rw_total_${slotIndex}_${candidateIndex}`, terms, "<=", 0);
  }
  const ringSlots = new Map<0 | 1, number>();
  slots.forEach((slot, slotIndex) => {
    const marked = slot.filter((equipment) => equipment.ringSlotIndex !== undefined);
    if (marked.length === 0) return;
    const ringSlotIndex = marked[0]!.ringSlotIndex;
    if ((ringSlotIndex !== 0 && ringSlotIndex !== 1) || marked.length !== slot.length ||
      marked.some((equipment) => equipment.ringSlotIndex !== ringSlotIndex) ||
      ringSlots.has(ringSlotIndex)) {
      throw new RangeError("独立戒指槽标记不完整或重复");
    }
    for (const equipment of marked) {
      if (!Number.isSafeInteger(equipment.itemId) || typeof equipment.isUnique !== "boolean") {
        throw new RangeError(`戒指 ${equipment.itemId} 缺少有效的 IsUnique 元数据`);
      }
    }
    ringSlots.set(ringSlotIndex, slotIndex);
  });
  if (ringSlots.size !== 0 && ringSlots.size !== 2) {
    throw new RangeError("独立戒指模型必须同时包含戒指1和戒指2槽");
  }
  if (ringSlots.size === 2) {
    const uniqueByItemId = new Map<number, boolean>();
    for (const ringSlotIndex of [0, 1] as const) {
      for (const equipment of slots[ringSlots.get(ringSlotIndex)!]!) {
        const known = uniqueByItemId.get(equipment.itemId);
        if (known !== undefined && known !== equipment.isUnique) {
          throw new RangeError(`戒指 ${equipment.itemId} 的 IsUnique 元数据不一致`);
        }
        uniqueByItemId.set(equipment.itemId, equipment.isUnique!);
      }
    }
    for (const [itemId, isUnique] of uniqueByItemId) {
      if (!isUnique) continue;
      const terms = new Map<string, number>();
      for (const ringSlotIndex of [0, 1] as const) {
        const slotIndex = ringSlots.get(ringSlotIndex)!;
        slots[slotIndex]!.forEach((equipment, candidateIndex) => {
          if (equipment.itemId === itemId) addTerm(terms, slotVariables[slotIndex]![candidateIndex]!, 1);
        });
      }
      // 一条约束行覆盖该实体物品在两个槽位中的所有镶嵌变体。
      if (terms.size > 1) addRows(rows, `unique_ring_item_${itemId}`, terms, "<=", 1);
    }
  }
  const canonicalRingOrder = symmetricRingSlotOrder(
    slots,
    ringSlots,
    options.equipmentAttributeExtractor !== undefined,
  );
  if (canonicalRingOrder !== undefined) {
    const terms = new Map<string, number>();
    canonicalRingOrder.firstRanks.forEach((rank, candidateIndex) => {
      addTerm(terms, slotVariables[canonicalRingOrder.firstSlotIndex]![candidateIndex]!, rank);
    });
    canonicalRingOrder.secondRanks.forEach((rank, candidateIndex) => {
      addTerm(terms, slotVariables[canonicalRingOrder.secondSlotIndex]![candidateIndex]!, -rank);
    });
    addRows(rows, "canonical_ring_slot_order", terms, "<=", 0);
  }

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
        addTerm(rawTerms, slotVariables[slotIndex]![candidateIndex]!, -fixedEquipmentAttributes[slotIndex]![candidateIndex]![attribute]!);
      });
    });
    for (const allocation of resistanceAllocationVariables) {
      if (allocation.attributeIndex === attribute) addTerm(rawTerms, allocation.variable, -1);
    }
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
  // 各食物的条件加成变量创建后，重新构造最终属性总和。
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
    const lowerTerms = new Map<string, number>([[finalVariables[speedIndex]!, 1]]);
    const upperTerms = new Map<string, number>([[finalVariables[speedIndex]!, 1]]);
    for (const [index, range] of [...choices.values()].entries()) {
      const variable = `gcd_choice_${index}`;
      gcdChoiceVariables.push(variable);
      gcdChoiceRanges.push(range);
      bounds.push({ name: variable, min: 0, max: 1 });
      binaryVars.push(variable);
      addTerm(lowerTerms, variable, -range.min);
      addTerm(upperTerms, variable, -range.max);
    }
    addRows(rows, "choose_gcd_choice", gcdChoiceVariables.map((variable) => [variable, 1] as const), "=", 1);
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
    gcdChoiceVariables,
    gcdChoiceRanges,
    rawVariables,
    finalVariables,
    rawMaximums,
    rawMinimums,
    finalMinimums,
    equipmentAttributes,
    fixedEquipmentAttributes,
    resistanceAllocationVariables,
    foodBonuses,
    idToIndex,
    ranges,
    canonicalRingOrder,
  };
}

// 忽略共享约束和跨属性约束后，精确的边际可达集合会成为原集合的超集。
// 任一工作量保护条件失败时，都放弃整个属性轴，避免不完整的前沿排除合法取值。
function reachableFinalAttributeValues(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  attribute: number,
): number[] | undefined {
  const maximumTransitionWork = 1_000_000;
  const maximumFoodEvaluations = 1_000_000;
  const slotValues: number[][] = [];
  for (let slotIndex = 0; slotIndex < model.fixedEquipmentAttributes.length; slotIndex++) {
    const slot = model.fixedEquipmentAttributes[slotIndex]!;
    const values = new Set<number>();
    for (let candidateIndex = 0; candidateIndex < slot.length; candidateIndex++) {
      const candidate = slot[candidateIndex]!;
      const maximumAllocation = model.resistanceAllocationVariables
        .filter((allocation) => allocation.slotIndex === slotIndex &&
          allocation.candidateIndex === candidateIndex && allocation.attributeIndex === attribute)
        .reduce((total, allocation) => total + allocation.maxValue, 0);
      if (!Number.isSafeInteger(maximumAllocation) || maximumAllocation < 0 ||
        maximumAllocation + 1 > maximumTransitionWork) return undefined;
      for (let increment = 0; increment <= maximumAllocation; increment++) {
        values.add(candidate[attribute]! + increment);
      }
    }
    slotValues.push([...values]);
  }
  if (slotValues.some((values) => values.length === 0 || values.some((value) => !Number.isSafeInteger(value)))) {
    return undefined;
  }

  let minimum = 0;
  let maximum = 0;
  let reachableCount = 1;
  let reachable = Uint8Array.of(1);
  for (const values of slotValues) {
    if (reachableCount > Math.floor(maximumTransitionWork / values.length)) return undefined;
    const nextMinimum = minimum + Math.min(...values);
    const nextMaximum = maximum + Math.max(...values);
    const width = nextMaximum - nextMinimum + 1;
    if (!Number.isSafeInteger(width) || width <= 0 || width > 200_000) return undefined;
    const next = new Uint8Array(width);
    let nextReachableCount = 0;
    for (let index = 0; index < reachable.length; index++) {
      if (reachable[index] !== 1) continue;
      const previous = minimum + index;
      for (const value of values) {
        const target = previous + value - nextMinimum;
        if (next[target] === 0) {
          next[target] = 1;
          nextReachableCount++;
        }
      }
    }
    reachable = next;
    reachableCount = nextReachableCount;
    minimum = nextMinimum;
    maximum = nextMaximum;
  }

  const foods: readonly (FoodInfo | undefined)[] = options.foods.length > 0 ? options.foods : [undefined];
  if (reachableCount > Math.floor(maximumFoodEvaluations / foods.length)) return undefined;
  const attributeId = options.attributeIds[attribute];
  if (attributeId === undefined) return undefined;
  const foodParams = foods.map((food) => {
    const matchingParams = food?.baseParams.filter((entry) => entry.baseParamId === attributeId) ?? [];
    return { duplicate: matchingParams.length > 1, param: matchingParams[0] };
  });
  if (foodParams.some(({ duplicate }) => duplicate)) return undefined;
  const finalValues = new Set<number>();
  for (let index = 0; index < reachable.length; index++) {
    if (reachable[index] !== 1) continue;
    const raw = minimum + index;
    for (const { param } of foodParams) {
      const bonus = param !== undefined && param.maxValue > 0 && param.multiplier > 1
        ? Math.min(param.maxValue,
          Math.trunc((raw + (param.baseValue ?? 0)) * (param.multiplier - 1) + 1e-7))
        : 0;
      const finalValue = raw + bonus;
      if (!Number.isSafeInteger(finalValue)) return undefined;
      finalValues.add(finalValue);
    }
  }
  return finalValues.size === 0 ? undefined : [...finalValues].sort((left, right) => left - right);
}

function retainReachableFactorClasses(group: FactorGroup, reachableValues: readonly number[]): number {
  const retained: FactorClass[] = [];
  let valueIndex = 0;
  for (const factorClass of group.classes) {
    while (valueIndex < reachableValues.length && reachableValues[valueIndex]! < factorClass.min) valueIndex++;
    const firstIndex = valueIndex;
    while (valueIndex < reachableValues.length && reachableValues[valueIndex]! <= factorClass.max) valueIndex++;
    if (valueIndex > firstIndex) retained.push({
      ...factorClass,
      min: reachableValues[firstIndex]!,
      max: reachableValues[valueIndex - 1]!,
    });
  }
  if (retained.length === 0) return 0;
  const removed = group.classes.length - retained.length;
  group.classes = retained;
  return removed;
}

async function prepareExactMipModel(
  options: ExactMipOptions,
  addPrimaryResourceSupports = false,
  prebuiltModel?: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  addMainStatResourceSupport = false,
) {
  throwIfCancelled(options.isCancelled);
  const model = prebuiltModel ?? buildLinearAttributeModel(options);
  throwIfCancelled(options.isCancelled);
  if (model === undefined) return undefined;
  const factorEvaluator = createIntegerDamageFactorEvaluator(
    options.job,
    options.jobLevel,
    options.statIndexes,
    options.clanIndex ?? 0,
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
  const groupAttributes = [mainAttribute, detAttribute, tenAttribute, crtAttribute, dhtAttribute, speedAttribute];
  let reachableFactorClassesRemoved = 0;
  let reachableAttributePruningSkipped = 0;
  const reachableValuesByAttribute = new Map<number, number[]>();
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const attribute = groupAttributes[groupIndex];
    if (attribute === undefined) continue;
    let reachableValues = reachableValuesByAttribute.get(attribute);
    if (reachableValues === undefined) {
      reachableValues = reachableFinalAttributeValues(options, model, attribute);
      if (reachableValues === undefined) {
        reachableAttributePruningSkipped++;
        continue;
      }
      reachableValuesByAttribute.set(attribute, reachableValues);
    }
    reachableFactorClassesRemoved += retainReachableFactorClasses(groups[groupIndex]!, reachableValues);
  }
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
  let weaponRelativeMinimum = model.finalMinimums[weaponAttribute]! + bluAdditionMinimum;
  let weaponRelativeMaximum = finalMaximums[weaponAttribute]! + bluAdditionMaximum;
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
  let reachableWeaponFactorClassesRemoved = 0;
  let reachableWeaponPruningSkipped = 0;
  const reachableWeaponValues = reachableFinalAttributeValues(options, model, weaponAttribute);
  const reachableWeaponAdditions = options.job === "BLU"
    ? [...new Set(mainFactorGroup.classes.map((factorClass) => factorClass.auxiliary))]
    : [0];
  const maximumWeaponTransitionWork = 1_000_000;
  if (reachableWeaponValues === undefined || reachableWeaponAdditions.some((value) =>
    value === undefined || !Number.isSafeInteger(value)) || reachableWeaponAdditions.length === 0 ||
    reachableWeaponValues.length > Math.floor(maximumWeaponTransitionWork / reachableWeaponAdditions.length)) {
    reachableWeaponPruningSkipped++;
  } else {
    const reachableRelativeValues = new Set<number>();
    let validReachableSums = true;
    for (const weaponValue of reachableWeaponValues) {
      for (const addition of reachableWeaponAdditions) {
        const relative = weaponValue + addition!;
        if (!Number.isSafeInteger(relative)) {
          validReachableSums = false;
          break;
        }
        reachableRelativeValues.add(relative);
      }
      if (!validReachableSums) break;
    }
    const sortedReachableRelativeValues = [...reachableRelativeValues].sort((left, right) => left - right);
    const hasReachableClass = sortedReachableRelativeValues.some((value) =>
      value >= weaponRelativeMinimum && value <= weaponRelativeMaximum);
    if (!validReachableSums || !hasReachableClass) {
      reachableWeaponPruningSkipped++;
    } else {
      reachableWeaponFactorClassesRemoved = retainReachableFactorClasses(
        weaponGroup,
        sortedReachableRelativeValues,
      );
      if (reachableWeaponFactorClassesRemoved > 0) {
        reachableFactorClassesRemoved += reachableWeaponFactorClassesRemoved;
        weaponRelativeMinimum = weaponGroup.classes[0]!.min;
        weaponRelativeMaximum = weaponGroup.classes.at(-1)!.max;
      }
    }
  }
  groups.unshift(weaponGroup);

  const groupedByAttribute = [
    [groups[0]!, undefined, 0] as const,
    [groups[1]!, model.finalVariables[mainAttribute], groups[1]!.classes.at(-1)!.max] as const,
    [groups[2]!, detAttribute === undefined ? undefined : model.finalVariables[detAttribute], groups[2]!.classes.at(-1)!.max] as const,
    [groups[3]!, tenAttribute === undefined ? undefined : model.finalVariables[tenAttribute], groups[3]!.classes.at(-1)!.max] as const,
    [groups[4]!, crtAttribute === undefined ? undefined : model.finalVariables[crtAttribute], groups[4]!.classes.at(-1)!.max] as const,
    [groups[5]!, dhtAttribute === undefined ? undefined : model.finalVariables[dhtAttribute], groups[5]!.classes.at(-1)!.max] as const,
    [groups[6]!, model.finalVariables[speedAttribute], groups[6]!.classes.at(-1)!.max] as const,
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
      addClassSelection(model.rows, model.bounds, model.binaryVars, group, relativeVariable,
        group.classes.at(-1)!.max);
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

  const resourceAxes = ([
    ...(addPrimaryResourceSupports ? [["main", mainAttribute] as const] : []),
    ["det", detAttribute], ["ten", tenAttribute], ["crt", crtAttribute],
    ["dht", dhtAttribute], ["gcd", speedAttribute],
  ] as const).filter((entry): entry is readonly ["main" | "det" | "ten" | "crt" | "dht" | "gcd", number] => entry[1] !== undefined);
  const foodMaximumBonuses = options.foods.map(() => new Array<number>(options.attributeIds.length).fill(0));
  for (const bonus of model.foodBonuses) {
    const uncapped = BigInt(bonus.maximumRaw) * BigInt(bonus.numerator) / BigInt(bonus.denominator);
    foodMaximumBonuses[bonus.foodIndex]![bonus.attribute] += uncapped >= BigInt(bonus.cap) ? bonus.cap : Number(uncapped);
  }
  // 这些支撑不等式由实际装备和食物资源蕴含。将它们直接施加到因子选择变量上，
  // 以强化整数松弛。
  for (let mask = 1; mask < 1 << resourceAxes.length; mask++) {
    const axes = resourceAxes.filter((_, index) => (mask & (1 << index)) !== 0);
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
  if (addMainStatResourceSupport && !addPrimaryResourceSupports) {
    const gearMaximum = model.equipmentAttributes.reduce((total, slot) => total + Math.max(...slot.map((candidate) =>
      candidate[mainAttribute]!)), 0);
    const foodMaximum = Math.max(0, ...foodMaximumBonuses.map((bonuses) => bonuses[mainAttribute]!));
    const maximum = gearMaximum + foodMaximum;
    if (Number.isSafeInteger(maximum)) {
      const terms = new Map<string, number>();
      for (const entry of mainFactorGroup.classes) addTerm(terms, entry.variable, entry.min);
      addRows(model.rows, "factor_resource_main", terms, "<=", maximum);
    }
  }
  const weightedResourceVectors = addPrimaryResourceSupports
    ? factorResourceWeightVectors(groups, resourceAxes.map(([name]) => name))
    : [];
  for (let vectorIndex = 0; vectorIndex < weightedResourceVectors.length; vectorIndex++) {
    const weights = weightedResourceVectors[vectorIndex]!;
    const axes = resourceAxes.flatMap(([name, attribute], index) => {
      const weight = weights[index]!;
      return weight > 0 ? [[name, attribute, weight] as const] : [];
    });
    const gearMaximum = model.equipmentAttributes.reduce((total, slot) => total + Math.max(...slot.map((candidate) =>
      axes.reduce((sum, [, attribute, weight]) => sum + candidate[attribute]! * weight, 0))), 0);
    const foodMaximum = Math.max(0, ...foodMaximumBonuses.map((bonuses) =>
      axes.reduce((sum, [, attribute, weight]) => sum + bonuses[attribute]! * weight, 0)));
    const maximum = gearMaximum + foodMaximum;
    if (!Number.isSafeInteger(maximum)) continue;
    const terms = new Map<string, number>();
    for (const [name, , weight] of axes) for (const entry of groups.find((group) => group.name === name)!.classes) {
      addTerm(terms, entry.variable, entry.min * weight);
    }
    addRows(model.rows, `factor_resource_weighted_${vectorIndex}`, terms, "<=", maximum);
  }
  const conditionalResourceSupport = addCandidateLevelConditionalResourceSupports(
    options,
    model,
    groups,
    foodMaximumBonuses,
    new Map([
      ["main", mainAttribute],
      ["weapon", weaponAttribute],
      ["det", detAttribute],
      ["ten", tenAttribute],
      ["crt", crtAttribute],
      ["dht", dhtAttribute],
      ["gcd", speedAttribute],
    ]),
  );
  return { model, groups, factorEvaluator, useDps, qByVariable,
    mainAttribute, weaponAttribute, detAttribute, tenAttribute, crtAttribute, dhtAttribute, speedAttribute,
    reachableFactorClassesRemoved, reachableAttributePruningSkipped,
    reachableWeaponFactorClassesRemoved, reachableWeaponPruningSkipped, conditionalResourceSupport,
    primaryResourceSupportsEnabled: addPrimaryResourceSupports,
    mainStatResourceSupportEnabled: addMainStatResourceSupport && !addPrimaryResourceSupports };
}

function completeFeasibleMipStart(
  options: ExactMipOptions,
  model: NonNullable<ReturnType<typeof buildLinearAttributeModel>>,
  groups: readonly FactorGroup[],
  factorEvaluator: IntegerDamageFactorEvaluator,
  greedyStart: GreedyMipStart,
  factorAttributeIndexes: Readonly<Record<string, number | undefined>>,
): Map<string, number> {
  const sparseFallback = greedyStart.hint;
  const reject = () => sparseFallback;
  try {
    if (options.slots.length !== greedyStart.selection.length ||
      model.slotVariables.length !== options.slots.length ||
      model.equipmentAttributes.length !== options.slots.length) return reject();

    const values = new Map<string, number>(model.bounds.map(({ name }) => [name, 0]));
    const rawAttributes = new Array<number>(model.rawVariables.length).fill(0);
    for (let slotIndex = 0; slotIndex < options.slots.length; slotIndex++) {
      const candidateIndex = options.slots[slotIndex]!.indexOf(greedyStart.selection[slotIndex]!);
      if (candidateIndex < 0 || model.slotVariables[slotIndex]?.[candidateIndex] === undefined) {
        return reject();
      }
      values.set(model.slotVariables[slotIndex]![candidateIndex]!, 1);
      const equipmentAttributes = model.fixedEquipmentAttributes[slotIndex]?.[candidateIndex];
      if (equipmentAttributes === undefined || equipmentAttributes.length !== rawAttributes.length) {
        return reject();
      }
      for (let attribute = 0; attribute < rawAttributes.length; attribute++) {
        rawAttributes[attribute] += equipmentAttributes[attribute]!;
      }
    }

    let selectedFoodIndex = -1;
    if (options.foods.length > 0) {
      if (greedyStart.food === undefined) return reject();
      selectedFoodIndex = options.foods.indexOf(greedyStart.food);
      if (selectedFoodIndex < 0 || model.foodVariables[selectedFoodIndex] === undefined) {
        return reject();
      }
      values.set(model.foodVariables[selectedFoodIndex]!, 1);
    } else if (greedyStart.food !== undefined || model.foodVariables.length !== 0) {
      return reject();
    }

    const finalAttributes = [...rawAttributes];
    const selectedFood = selectedFoodIndex < 0 ? undefined : options.foods[selectedFoodIndex];
    for (const bonus of model.foodBonuses) {
      if (bonus.foodIndex !== selectedFoodIndex) continue;
      const baseParamId = options.attributeIds[bonus.attribute];
      if (baseParamId === undefined || selectedFood === undefined) return reject();
      const parameter = selectedFood.baseParams.find((candidate) => candidate.baseParamId === baseParamId);
      if (parameter === undefined) return reject();
      const amount = canonicalFoodBonusAtRawWithRate(rawAttributes[bonus.attribute]!, {
        baseValue: parameter.baseValue ?? 0,
        multiplier: parameter.multiplier,
        maxValue: parameter.maxValue,
        numerator: bonus.numerator,
        denominator: bonus.denominator,
      });
      if (amount === undefined || amount > bonus.cap) return reject();
      values.set(bonus.bonus, amount);
      values.set(bonus.capped, Number(amount === bonus.cap));
      finalAttributes[bonus.attribute] += amount;
    }
    for (let attribute = 0; attribute < rawAttributes.length; attribute++) {
      values.set(model.rawVariables[attribute]!, rawAttributes[attribute]!);
      values.set(model.finalVariables[attribute]!, finalAttributes[attribute]!);
    }

    if (model.gcdChoiceVariables.length !== model.gcdChoiceRanges.length) return reject();
    if (model.gcdChoiceVariables.length > 0) {
      const speedAttribute = options.speedAttributeId === undefined
        ? undefined
        : model.idToIndex.get(options.speedAttributeId);
      if (speedAttribute === undefined) return reject();
      const speed = finalAttributes[speedAttribute]!;
      const choiceIndex = model.gcdChoiceRanges.findIndex((range) => speed >= range.min && speed <= range.max);
      if (choiceIndex < 0 || model.gcdChoiceVariables[choiceIndex] === undefined) return reject();
      values.set(model.gcdChoiceVariables[choiceIndex]!, 1);
    }

    const factors = factorEvaluator(finalAttributes);
    const zeroFactors = factorEvaluator(new Array<number>(options.attributeIds.length).fill(0));
    if (factors === undefined || zeroFactors === undefined) return reject();
    const factorTargets: Record<string, { value: number; attribute?: number }> = {
      weapon: {
        value: factors.weaponDamage,
        attribute: factors.weaponDamage - zeroFactors.weaponDamage,
      },
      main: { value: factors.mainStat },
      det: { value: factors.determination },
      ten: { value: factors.tenacity },
      crt: { value: factors.critical },
      dht: { value: factors.directHit },
      gcd: { value: factors.gcdCentiseconds },
    };
    for (const group of groups) {
      const target = factorTargets[group.name];
      if (target === undefined) return reject();
      const attribute = group.name === "weapon"
        ? target.attribute
        : factorAttributeIndexes[group.name];
      const attributeValue = group.name === "weapon"
        ? target.attribute!
        : attribute === undefined ? 0 : finalAttributes[attribute]!;
      const matching = group.classes.filter((factorClass) =>
        factorClass.value === target.value &&
        attributeValue >= factorClass.min && attributeValue <= factorClass.max);
      if (matching.length !== 1) return reject();
      values.set(matching[0]!.variable, 1);
      if (group.name === "weapon") {
        if (!values.has("weapon_relative")) return reject();
        values.set("weapon_relative", attributeValue);
      }
    }

    if (values.size !== model.bounds.length || model.bounds.some(({ name }) => !values.has(name))) {
      return reject();
    }
    const columns = Object.fromEntries(model.bounds.map(({ name }) => [name, { Primal: values.get(name)! }]));
    validateMipSolution(model.rows, model.bounds, columns);
    return values;
  } catch {
    return reject();
  }
}

export async function findBestLoadoutExactMip(
  options: ExactMipOptions,
): Promise<ExactMipResult | undefined> {
  const startedAt = performance.now();
  throwIfCancelled(options.isCancelled);
  const maxSearchMs = options.maxSearchMs;
  if (maxSearchMs !== undefined && (!Number.isFinite(maxSearchMs) || maxSearchMs <= 0)) {
    throw new RangeError("maxSearchMs 必须是正有限值");
  }
  const searchDeadline = maxSearchMs === undefined ? Number.POSITIVE_INFINITY : startedAt + maxSearchMs;
  const preparationBudgetBaseMs = maxSearchMs ?? 110_000;
  const timeLimitReached = () =>
    maxSearchMs !== undefined && performance.now() - startedAt >= maxSearchMs;
  const modelPreparationStartedAt = performance.now();
  const candidateUpperBoundCandidateCount = options.slots.reduce((total, slot) => total + slot.length, 0);
  const canonicalCandidateUpperBoundTrusted = hasCanonicalEvaluatorCandidateUpperBound(options);
  const candidateUpperBoundEnabled = shouldEnableCanonicalCandidateUpperBound(
    options,
    canonicalCandidateUpperBoundTrusted,
  );
  const primaryResourceSupportsEnabled = candidateUpperBoundEnabled || options.primaryResourceSupports === true;
  const mainStatResourceSupportEnabled = !primaryResourceSupportsEnabled &&
    options.mainStatResourceSupport === true;
  if (isProfileTimingEnabled() && options.onSolverProgress !== undefined) {
    options.onSolverProgress({
      backend: "HiGHS",
      model: `${options.job}:candidate_upper_bound_gate`,
      kind: "log",
      message: `PROFILE ${JSON.stringify({
        phase: "candidate-upper-bound-gate",
        job: options.job,
        candidateCount: candidateUpperBoundCandidateCount,
        trustedCanonicalEvaluator: canonicalCandidateUpperBoundTrusted,
        enabled: candidateUpperBoundEnabled,
        resourceBudgetCandidateProfile: options.resourceBudgetCandidateProfile ?? "default",
      })}`,
    });
  }
  let modelOptions = options;
  let initialMipStart: GreedyMipStart | undefined;
  let candidateUpperBound: ExactMipSearchStatistics["candidateUpperBound"];
  let candidateUpperFactorsBySlot: CandidateUpperBoundResult["candidateUpperFactorsBySlot"] | undefined;
  const incumbentCandidateUpperBoundCuts = new Set<string>();
  const resourceBudgetCandidateUpperBoundCuts = new Set<string>();
  let resourceBudgetCandidateScoreUpperBySlot: readonly ReadonlyMap<EquipInfo, bigint>[] | undefined;
  let resourceBudgetCandidateBound: ExactMipSearchStatistics["resourceBudgetCandidateBound"];
  let greedyMipStartMs = 0;
  let modelPreparationMs = 0;
  let prepared: Awaited<ReturnType<typeof prepareExactMipModel>> | undefined;
  if (candidateUpperBoundEnabled) {
    let initialModel = buildLinearAttributeModel(options);
    if (initialModel === undefined) return undefined;
    const initialBuildMs = performance.now() - modelPreparationStartedAt;
    const greedyStartedAt = performance.now();
    const candidateUseDps = options.objective === undefined
      ? options.constraints?.gcd === undefined
      : options.objective === "dps";
    const candidateGreedyStart = greedyMipStart(
      options,
      initialModel,
      candidateUseDps,
      Math.min(searchDeadline, performance.now() + 1_000),
      () => options.isCancelled?.() === true || timeLimitReached(),
    );
    greedyMipStartMs = performance.now() - greedyStartedAt;
    let candidateBoundMs = 0;
    const remainingAfterGreedyMs = searchDeadline - performance.now();
    if (candidateGreedyStart !== undefined && remainingAfterGreedyMs > 1_000) {
      const candidateBoundStartedAt = performance.now();
      const boundDeadline = Math.min(
        searchDeadline,
        performance.now() + Math.min(10_000, remainingAfterGreedyMs - 1_000),
      );
      let pruning: CandidateUpperBoundResult | undefined;
      try {
        pruning = pruneCandidatesByIncumbentUpperBound(
          options,
          initialModel,
          createIntegerDamageFactorEvaluator(options.job, options.jobLevel, options.statIndexes, options.clanIndex ?? 0),
          candidateUseDps,
          candidateGreedyStart,
          boundDeadline,
          () => options.isCancelled?.() === true,
        );
      } catch {
        // 上界不确定只会错过一次优化；原始模型仍会证明结果。
      }
      candidateBoundMs = performance.now() - candidateBoundStartedAt;
      if (pruning !== undefined) {
        candidateUpperFactorsBySlot = pruning.candidateUpperFactorsBySlot;
        candidateUpperBound = {
          candidatesBefore: pruning.candidatesBefore,
          candidatesAfter: pruning.candidatesAfter,
          elapsedMs: pruning.elapsedMs,
        };
        if (pruning.candidatesAfter < pruning.candidatesBefore) {
          modelOptions = { ...options, slots: pruning.slots };
          initialModel = undefined;
        }
      }
    }
    const fullPreparationStartedAt = performance.now();
    prepared = await prepareExactMipModel(
      modelOptions,
      // 在较宽的规范基线中保留更强的主属性和加权资源支撑约束。
      primaryResourceSupportsEnabled,
      modelOptions === options ? initialModel : undefined,
      mainStatResourceSupportEnabled,
    );
    const fullPreparationMs = performance.now() - fullPreparationStartedAt;
    modelPreparationMs = initialBuildMs + candidateBoundMs + fullPreparationMs;
    if (prepared !== undefined && modelOptions !== options && candidateGreedyStart !== undefined) {
      const hint = sparseMipStart(
        modelOptions.slots,
        modelOptions.foods,
        prepared.model.slotVariables,
        prepared.model.foodVariables,
        candidateGreedyStart.selection,
        candidateGreedyStart.food,
      );
      initialMipStart = hint === undefined
        ? undefined
        : { ...candidateGreedyStart, hint };
    } else {
      initialMipStart = candidateGreedyStart;
    }
  } else {
    const ordinaryPreparationStartedAt = performance.now();
    prepared = await prepareExactMipModel(
      options,
      primaryResourceSupportsEnabled,
      undefined,
      mainStatResourceSupportEnabled,
    );
    modelPreparationMs = performance.now() - ordinaryPreparationStartedAt;
  }
  throwIfCancelled(options.isCancelled);
  if (prepared === undefined) return undefined;
  const { model, groups, factorEvaluator, useDps, qByVariable,
    mainAttribute, weaponAttribute, detAttribute, tenAttribute, crtAttribute, dhtAttribute, speedAttribute } = prepared;
  if (candidateUpperBoundEnabled && candidateUpperFactorsBySlot !== undefined && options.job !== "BLU" &&
      options.resourceBudgetCandidateProfile !== "disabled") {
    const remainingAfterModelMs = searchDeadline - performance.now() - 1_000;
    if (remainingAfterModelMs > 0) {
      const resourceBudgetStartedAt = performance.now();
      const resourceBudgetDeadline = Math.min(
        searchDeadline - 1_000,
        performance.now() + Math.min(250, Math.max(1, preparationBudgetBaseMs * 0.02)),
      );
      const resourceBudgetBounds = prepareResourceBudgetCandidateBounds(
        { ...modelOptions, slots: modelOptions.slots },
        model,
        groups,
        new Map([
          ["main", mainAttribute], ["weapon", weaponAttribute], ["det", detAttribute],
          ["ten", tenAttribute], ["crt", crtAttribute], ["dht", dhtAttribute], ["gcd", speedAttribute],
        ]),
        resourceBudgetDeadline,
        () => options.isCancelled?.() === true,
      );
      const elapsedMs = performance.now() - resourceBudgetStartedAt;
      modelPreparationMs += elapsedMs;
      if (resourceBudgetBounds !== undefined) {
        resourceBudgetCandidateScoreUpperBySlot = resourceBudgetBounds.bySlot;
        resourceBudgetCandidateBound = {
          candidates: resourceBudgetBounds.candidateCount,
          supportCount: resourceBudgetBounds.supportCount,
          preparationMs: resourceBudgetBounds.elapsedMs,
        };
        if (isProfileTimingEnabled() && options.onSolverProgress !== undefined) {
          options.onSolverProgress({
            backend: "HiGHS",
            model: `${options.job}:resource_budget_candidate_bound`,
            kind: "log",
            message: `PROFILE ${JSON.stringify({
              phase: "resource-budget-candidate-upper-bound",
              job: options.job,
              profile: options.resourceBudgetCandidateProfile ?? "default",
              candidates: resourceBudgetBounds.candidateCount,
              supportCount: resourceBudgetBounds.supportCount,
              preparationMs: resourceBudgetBounds.elapsedMs,
            })}`,
          });
        }
      }
    }
  }
  if (!candidateUpperBoundEnabled) {
    const greedyMipStartStartedAt = performance.now();
    initialMipStart = greedyMipStart(options, model, useDps,
      Math.min(searchDeadline, performance.now() + 100),
      () => options.isCancelled?.() === true || timeLimitReached());
    greedyMipStartMs = performance.now() - greedyMipStartStartedAt;
  }
  if (initialMipStart !== undefined) {
    const completeHint = completeFeasibleMipStart(
      modelOptions,
      model,
      groups,
      factorEvaluator,
      initialMipStart,
      {
        main: mainAttribute,
        det: detAttribute,
        ten: tenAttribute,
        crt: crtAttribute,
        dht: dhtAttribute,
        gcd: speedAttribute,
      },
    );
    initialMipStart = { ...initialMipStart, hint: completeHint };
  }
  const initialStart = initialMipStart?.hint;
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
    // 初始 MIP 已有可行解时，筛选后的组不应为空；若数值边界情况导致其为空，
    // 则保留未筛选的超集。
    if (classes.length === 0) classes = group.classes;
    return {
      name: group.name,
      classes: classes.map(({ q, value }) => ({ q, value })),
    };
  });
  const minimumAttributeByGroupAndQ = new Map<string, Map<number, number>>();
  for (const group of groups) {
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
  const resourceAttributes = [
    ["main", mainAttribute],
    ["det", detAttribute],
    ["ten", tenAttribute],
    ["crt", crtAttribute],
    ["dht", dhtAttribute],
    ["gcd", speedAttribute],
  ] as const;
  const presentResourceAttributes = resourceAttributes.flatMap(([name, attribute]) =>
    attribute === undefined ? [] : [[name, attribute] as const]);
  const maximumFoodBonuses = options.foods.map(() =>
    new Array<number>(options.attributeIds.length).fill(0));
  for (const bonus of model.foodBonuses) {
    const rawBonus = BigInt(bonus.maximumRaw) * BigInt(bonus.numerator) /
      BigInt(bonus.denominator);
    const cappedBonus = rawBonus >= BigInt(bonus.cap) ? bonus.cap : Number(rawBonus);
    maximumFoodBonuses[bonus.foodIndex]![bonus.attribute] += cappedBonus;
  }
  const subsetBudgets: { axes: readonly (readonly [string, number, number])[]; maximum: number }[] = [];
  for (let mask = 1; mask < 1 << presentResourceAttributes.length; mask++) {
    const included = presentResourceAttributes.filter((_, index) => (mask & (1 << index)) !== 0);
    const axes = included.map(([name, attribute]) => [name, attribute, 1] as const);
    let maximum = 0;
    for (const slot of model.equipmentAttributes) {
      let slotMaximum = Number.NEGATIVE_INFINITY;
      for (const candidate of slot) {
        const contribution = axes.reduce((total, [, attribute, weight]) =>
          total + candidate[attribute]! * weight, 0);
        slotMaximum = Math.max(slotMaximum, contribution);
      }
      maximum += slotMaximum;
    }
    let foodMaximum = 0;
    for (let foodIndex = 0; foodIndex < options.foods.length; foodIndex++) {
      const foodContribution = axes.reduce((total, [, attribute, weight]) =>
        total + maximumFoodBonuses[foodIndex]![attribute]! * weight, 0);
      foodMaximum = Math.max(foodMaximum, foodContribution);
    }
    maximum += foodMaximum;
    if (Number.isSafeInteger(maximum)) {
      subsetBudgets.push({ axes, maximum });
    }
  }
  for (const weights of factorResourceWeightVectors(groups, presentResourceAttributes.map(([name]) => name))) {
    const axes = presentResourceAttributes.flatMap(([name, attribute], index) => {
      const weight = weights[index]!;
      return weight > 0 ? [[name, attribute, weight] as const] : [];
    });
    const gearMaximum = model.equipmentAttributes.reduce((total, slot) => {
      let slotMaximum = Number.NEGATIVE_INFINITY;
      for (const candidate of slot) {
        const contribution = axes.reduce((sum, [, attribute, weight]) =>
          sum + candidate[attribute]! * weight, 0);
        slotMaximum = Math.max(slotMaximum, contribution);
      }
      return total + slotMaximum;
    }, 0);
    let foodMaximum = 0;
    for (let foodIndex = 0; foodIndex < options.foods.length; foodIndex++) {
      const foodContribution = axes.reduce((total, [, attribute, weight]) =>
        total + maximumFoodBonuses[foodIndex]![attribute]! * weight, 0);
      foodMaximum = Math.max(foodMaximum, foodContribution);
    }
    const maximum = gearMaximum + foodMaximum;
    if (Number.isSafeInteger(maximum)) {
      subsetBudgets.push({ axes, maximum });
    }
  }
  const isPossiblyFeasibleFactorTuple = (
    signature: readonly { name: string; q: number; value: number }[],
  ): boolean => {
    const qByGroup = new Map(signature.map((factor) => [factor.name, factor.q]));
    for (const budget of subsetBudgets) {
      let minimum = 0;
      for (const [name, , weight] of budget.axes) {
        const q = qByGroup.get(name);
        const attributeMinimum = q === undefined
          ? undefined
          : minimumAttributeByGroupAndQ.get(name)?.get(q);
        // 映射未知时必须保留该元组；只有完整的下界才能将其排除。
        if (attributeMinimum === undefined) {
          minimum = Number.NEGATIVE_INFINITY;
          break;
        }
        minimum += attributeMinimum * weight;
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
    const remainingMs = maxSearchMs === undefined
      ? undefined
      : maxSearchMs - (performance.now() - startedAt);
    if (remainingMs !== undefined && remainingMs <= 0) {
      throw new Error("精确 MIP 搜索达到时限，未完成最优性证明");
    }
    const rows = [...model.rows];
    const strictImprovementCandidateVariables = new Set<string>();
    if (phaseName === "exact_damage_band_feasibility" && best !== undefined &&
        options.job !== "BLU" && candidateUpperFactorsBySlot !== undefined) {
      const incumbentLogScore = BigInt(factorObjectiveLogScore(best.factors, useDps));
      const roundingSlack = BigInt(groups.length);
      for (let slotIndex = 0; slotIndex < modelOptions.slots.length; slotIndex++) {
        const candidates = modelOptions.slots[slotIndex]!;
        const candidateBounds = candidateUpperFactorsBySlot[slotIndex];
        const resourceCandidateBounds = resourceBudgetCandidateScoreUpperBySlot?.[slotIndex];
        const variables = model.slotVariables[slotIndex]!;
        if (candidateBounds === undefined || candidates.length !== variables.length) continue;
        for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
          const candidate = candidates[candidateIndex]!;
          const upperFactors = candidateBounds.get(candidate);
          const independentBoundProvesNoImprovement = upperFactors !== undefined &&
            candidateUpperBoundCannotImproveIncumbent(best.factors, upperFactors, useDps);
          const resourceScoreUpper = resourceCandidateBounds?.get(candidate);
          const resourceBoundProvesNoImprovement = resourceScoreUpper !== undefined &&
            resourceScoreUpper + roundingSlack < incumbentLogScore;
          if (!independentBoundProvesNoImprovement && !resourceBoundProvesNoImprovement) continue;
          strictImprovementCandidateVariables.add(variables[candidateIndex]!);
          if (resourceBoundProvesNoImprovement) {
            resourceBudgetCandidateUpperBoundCuts.add(variables[candidateIndex]!);
          }
        }
      }
      for (const variable of strictImprovementCandidateVariables) {
        incumbentCandidateUpperBoundCuts.add(variable);
      }
    }
    const solveBounds = strictImprovementCandidateVariables.size === 0
      ? model.bounds
      : model.bounds.map((bound) => strictImprovementCandidateVariables.has(bound.name)
        ? { ...bound, max: 0 }
        : bound);
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
      variables: solveBounds,
      binaryVariables: model.binaryVars,
      integerVariables: model.generalVars,
      timeLimitMs: remainingMs,
      ...(initialStart === undefined || excludedSignatures.length > 0
        ? {}
        : { solutionHint: initialStart }),
      ...(options.onSolverProgress === undefined
        ? {}
        : { onProgress: options.onSolverProgress }),
      ...(options.onSolverCallback === undefined ? {} : { onCallback: options.onSolverCallback }),
    });
    solverWallMs += performance.now() - solverCallStartedAt;
    throwIfCancelled(options.isCancelled);
    solverRuns++;
    throwIfCancelled(options.isCancelled);
    if (output.Status === "Optimal") validateMipSolution(rows, solveBounds, output.Columns);
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
  // q 是整数；采用二进制缩放可保持系数精确，并使目标步长为 1/65,536，
  // 其精度超过 HiGHS 默认 1e-6 MIP 容差的 15 倍。
  for (const [variable, coefficient] of qByVariable) {
    addTerm(objective, variable, coefficient / SURROGATE_OBJECTIVE_SCALE);
  }
  let firstSurrogate: number | undefined;
  let signatureBandChecks = 0;
  let signatureBandElapsedMs = 0;
  let signatureBandProof = false;
  let lastSignatureBandIncumbent: string | undefined;
  let lastSignatureBandMayContainBetter = true;
  // 得分是七个取整对数因子的总和，取整误差不超过因子数量。
  // 因此，签名得分若低于代理最优值超过此误差带，就不可能在精确因子比较中胜出。
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
          deadline: timeLimitReached,
          isPossiblyFeasible: isPossiblyFeasibleFactorTuple,
        });
        signatureBandElapsedMs += performance.now() - bandStartedAt;
        lastSignatureBandIncumbent = incumbentKey;
      }
      if (timeLimitReached()) {
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
    const selection = slotsForResultWithResistanceAllocations(
      modelOptions.slots,
      model.slotVariables,
      model.resistanceAllocationVariables,
      output.Columns,
    );
    const food = foodForResult(options.foods, model.foodVariables, output.Columns);
    const attributes = getAttributeVector(selection, food, options.attributeIds, options.equipmentAttributeExtractor, options.statIndexes);
    const rawAttributes = new Array<number>(options.attributeIds.length).fill(0);
    const attributeIndexes = new Map(options.attributeIds.map((id, index) => [id, index]));
    for (const equipment of selection) {
      const params = options.equipmentAttributeExtractor?.(equipment) ?? equipment.baseParams;
      for (const param of params) {
        const index = attributeIndexes.get(param.baseParamId);
        if (index !== undefined) rawAttributes[index] += param.value;
      }
      for (const allocation of equipment.resistanceAllocation ?? []) {
        const index = attributeIndexes.get(allocation.baseParamId);
        if (index !== undefined) rawAttributes[index] += allocation.value;
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
    if (timeLimitReached()) {
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
      message: `PROFILE ${JSON.stringify({
        phase: "exact-search-summary",
        job: options.job,
        ...statistics,
      })}`,
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
      ...(candidateUpperBound === undefined ? {} : { candidateUpperBound }),
      ...(resourceBudgetCandidateBound === undefined ? {} : { resourceBudgetCandidateBound }),
      resourceBudgetCandidateCuts: resourceBudgetCandidateUpperBoundCuts.size,
      primaryResourceSupportsEnabled: prepared!.primaryResourceSupportsEnabled,
      mainStatResourceSupportEnabled: prepared!.mainStatResourceSupportEnabled,
      solverRuns,
      incumbentCandidateUpperBoundCuts: incumbentCandidateUpperBoundCuts.size,
      excludedSignatures: excludedSignatures.length,
      signatureBandChecks,
      signatureBandElapsedMs,
      signatureBandProof,
      variables: model!.bounds.length,
      constraints: model!.rows.length + excludedSignatures.length,
      reachableFactorClassesRemoved: prepared!.reachableFactorClassesRemoved,
      reachableAttributePruningSkipped: prepared!.reachableAttributePruningSkipped,
      reachableWeaponFactorClassesRemoved: prepared!.reachableWeaponFactorClassesRemoved,
      reachableWeaponPruningSkipped: prepared!.reachableWeaponPruningSkipped,
      maximumSurrogate,
      nextSurrogate,
      memoryUsage: getMemoryUsageSnapshot(),
      ...(prepared!.conditionalResourceSupport === undefined
        ? {}
        : { conditionalResourceSupport: prepared!.conditionalResourceSupport }),
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

function slotsForResultWithResistanceAllocations(
  slots: readonly (readonly EquipInfo[])[],
  slotVariables: readonly (readonly string[])[],
  allocations: readonly ResistanceAllocationVariable[],
  columns: Record<string, { Primal: number }>,
): EquipInfo[] {
  const selection = slotsForResult(slots, slotVariables, columns);
  return selection.map((equipment, slotIndex) => {
    const candidateIndex = slotVariables[slotIndex]!.findIndex((variable) =>
      (columns[variable]?.Primal ?? 0) > 0.5);
    const resistanceAllocation = allocations
      .filter((allocation) => allocation.slotIndex === slotIndex &&
        allocation.candidateIndex === candidateIndex)
      .map((allocation) => {
        const raw = columns[allocation.variable]?.Primal ?? 0;
        const value = Math.round(raw);
        if (!Number.isSafeInteger(value) || Math.abs(value - raw) > 1e-6 ||
          value < 0 || value > allocation.maxValue) {
          throw new Error(`义军武器 ${equipment.itemId} 的 ${allocation.stat} 分配不是有效整数`);
        }
        return { stat: allocation.stat, baseParamId: allocation.baseParamId, value };
      })
      .filter(({ value }) => value > 0);
    if (resistanceAllocation.length === 0) return equipment;
    const allocatedTotal = resistanceAllocation.reduce((total, { value }) => total + value, 0);
    const maximum = equipment.resistanceWeaponAdjust?.maxTotalStats;
    if (maximum === undefined || !Number.isSafeInteger(allocatedTotal) || allocatedTotal > maximum) {
      throw new Error(`义军武器 ${equipment.itemId} 的总分配属性超过 ResistanceWeaponAdjust 上限`);
    }
    return { ...equipment, resistanceAllocation };
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
