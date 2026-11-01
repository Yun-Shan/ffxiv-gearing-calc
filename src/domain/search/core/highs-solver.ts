import type loadHighs from "highs";
import type { ModelRow } from "./model-types.ts";
import type { VariableBounds } from "./model-types.ts";
import type { LinearMipRequest } from "../linear-mip.ts";
import type { LinearMipSolution } from "../linear-mip.ts";
import { hasMipPoint } from "../linear-mip.ts";
import { isProfileTimingEnabled } from "./diagnostics.ts";
import { emitSolverProfile } from "./diagnostics.ts";
import type { HighsCallbackName } from "../linear-mip.ts";
import type { CallbackEvent } from "highs";
import type { InterruptCallbackEvent } from "highs";
import { prepareEqualityQuotient } from "./equality-quotient.ts";
import { prepareMateriaFamilyProjection } from "./materia-family-projection.ts";
import type { MateriaFamilyProjectionStatistics } from "./materia-family-projection.ts";
import { throwIfCancelled } from "./cancellation.ts";
import { normalizeSearchStrategies } from "./strategies.ts";
import { validateMipSolution } from "./solution-validation.ts";
import { prepareRatioDeficitRepresentation } from "./ratio-deficit.ts";
import { prepareRadixRepresentation } from "./radix-representation.ts";

let highsPromise: ReturnType<typeof loadHighs> | undefined;

let linearMipRunSequence = 0;

async function loadHighsRuntime(): ReturnType<typeof loadHighs> {
  const runtimeProcess = (
    globalThis as typeof globalThis & { process?: { versions?: { node?: string } } }
  ).process;
  if (typeof runtimeProcess?.versions?.node !== "string") {
    const { loadBrowserHighs } = await import("../highs-browser.js");
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

export type NonzeroRowDensity = { nonzeros: bigint; nonzeroRows: bigint };

/** Count actual nonzeros, leaving rows and their explicit zero terms untouched. */
export function measureNonzeroRowDensity(
  rows: LinearMipRequest["rows"],
  isCancelled?: () => boolean,
): NonzeroRowDensity | undefined {
  throwIfCancelled(isCancelled);
  let nonzeros = 0n;
  let nonzeroRows = 0n;
  let measurable = true;
  scan: for (const row of rows) {
    throwIfCancelled(isCancelled);
    let nonempty = false;
    for (const coefficient of row.terms.values()) {
      throwIfCancelled(isCancelled);
      if (!Number.isFinite(coefficient)) { measurable = false; break scan; }
      if (coefficient !== 0) { nonzeros += 1n; nonempty = true; }
    }
    if (nonempty) nonzeroRows += 1n;
  }
  throwIfCancelled(isCancelled);
  return measurable ? { nonzeros, nonzeroRows } : undefined;
}

export async function solveIntegerModel(
  request: LinearMipRequest,
): Promise<LinearMipSolution> {
  const callStartedAt = performance.now();
  const validationRequest = request;
  const budgetMs = request.timeLimitMs;
  if (budgetMs !== undefined && (!Number.isFinite(budgetMs) || budgetMs < 0)) {
    throw new Error("HiGHS 请求时间预算必须是非负有限毫秒数");
  }
  const deadline = budgetMs === undefined ? Number.POSITIVE_INFINITY : callStartedAt + budgetMs;
  let nativeInterruption: { error: unknown } | undefined;
  checkRequest();
  validateJointObjective();
  request = { ...request, strategies: normalizeSearchStrategies(request.strategies), name: `${request.name}#${++linearMipRunSequence}` };
  // Existing preparation/recovery loops also obey the original absolute deadline.
  request = { ...request, isCancelled: () => { checkRequest(); return false; } };
  if (request.strategies?.feasibleSeeds === "off") request = { ...request, solutionHint: undefined };

  const profileEnabled = request.onProgress !== undefined && isProfileTimingEnabled();
  const originalVariables = request.variables.length;
  const originalRows = request.rows.length;
  let materiaStatistics: MateriaFamilyProjectionStatistics | undefined;
  const materiaObserver = request.onMateriaFamilyProjection;
  request = { ...request, onMateriaFamilyProjection: (statistics) => { materiaStatistics = statistics; materiaObserver?.(statistics); } };
  checkRequest();
  const materia = prepareMateriaFamilyProjection(request);
  checkRequest();
  request = materia?.request ?? request;
  const materiaPreparationMs = performance.now() - callStartedAt;
  const baseRequest = request;
  const equalityStartedAt = performance.now();
  const equalityMode = baseRequest.strategies?.equalityQuotient;
  const policy = equalityMode === "off" ? false : equalityMode === "on" ? true : baseRequest.equalityQuotient;
  const densityPolicy = typeof policy === "object" && policy !== null;
  const maximumGrowth = densityPolicy ? policy.maxRowDensityGrowth : undefined;
  const minimumReduction = densityPolicy ? (policy.minVariableReductionPercent === undefined ? 0 : policy.minVariableReductionPercent) : undefined;
  const validDensityPolicy = densityPolicy && Number.isSafeInteger(maximumGrowth) && maximumGrowth! > 0 &&
    Number.isSafeInteger(minimumReduction) && minimumReduction! >= 0 && minimumReduction! <= 100;
  const automaticPolicy = policy === undefined || policy === true;
  let acceptedQuotient: ReturnType<typeof prepareEqualityQuotient>;
  let baseDensity: NonzeroRowDensity | undefined;
  let candidateDensity: NonzeroRowDensity | undefined;
  let candidateVariables: { base: number; candidate: number; removed: number } | undefined;
  let equalityDecision = policy === false ? "disabled" : "invalid-policy";
  const equalityPolicy = policy === false ? "disabled" : automaticPolicy ? "auto" : densityPolicy ? "row-density" : "invalid";
  throwIfCancelled(baseRequest.isCancelled);
  if (automaticPolicy || validDensityPolicy) {
    throwIfCancelled(baseRequest.isCancelled);
    const candidate = prepareEqualityQuotient(baseRequest);
    throwIfCancelled(baseRequest.isCancelled);
    equalityDecision = "no-certificate";
    if (candidate !== undefined) {
      const baseVariables = baseRequest.variables.length;
      const quotientVariables = candidate.request.variables.length;
      if (Number.isSafeInteger(baseVariables) && baseVariables > 0 && Number.isSafeInteger(quotientVariables) &&
          quotientVariables >= 0 && quotientVariables <= baseVariables) {
        candidateVariables = { base: baseVariables, candidate: quotientVariables, removed: baseVariables - quotientVariables };
      }
      if (automaticPolicy) {
        acceptedQuotient = candidate;
        equalityDecision = "accepted";
      } else {
        baseDensity = measureNonzeroRowDensity(baseRequest.rows, baseRequest.isCancelled);
        candidateDensity = measureNonzeroRowDensity(candidate.request.rows, baseRequest.isCancelled);
        if (baseDensity === undefined || candidateDensity === undefined) equalityDecision = "unmeasurable";
        else if (baseDensity.nonzeroRows === 0n) equalityDecision = "empty-base";
        else if ((candidateDensity.nonzeroRows === 0n && candidateDensity.nonzeros === 0n) ||
          (candidateDensity.nonzeroRows > 0n && candidateDensity.nonzeros * baseDensity.nonzeroRows <=
            BigInt(maximumGrowth!) * baseDensity.nonzeros * candidateDensity.nonzeroRows)) {
          if (candidateVariables === undefined) equalityDecision = "unmeasurable";
          else if (100n * BigInt(candidateVariables.removed) >= BigInt(minimumReduction!) * BigInt(candidateVariables.base)) {
            acceptedQuotient = candidate;
            equalityDecision = "accepted";
          } else equalityDecision = "variable-reduction-rejected";
        } else equalityDecision = "density-rejected";
      }
    }
  }
  throwIfCancelled(baseRequest.isCancelled);
  request = acceptedQuotient?.request ?? baseRequest;
  const equalityPreparationMs = automaticPolicy || validDensityPolicy ? performance.now() - equalityStartedAt : 0;
  const equalityRequest = request;
  let ratioDeficit: ReturnType<typeof prepareRatioDeficitRepresentation>;
  let radix: ReturnType<typeof prepareRadixRepresentation>;
  if (validationRequest.jointObjective?.kind === "ratio-bound") {
    const variables = [...new Set(validationRequest.jointObjective.variables.map((name) =>
      acceptedQuotient?.aliases.get(name) ?? name))];
    checkRequest();
    const candidate = prepareRatioDeficitRepresentation(request, { variables, scale: validationRequest.jointObjective.scale });
    checkRequest();
    if (candidate !== undefined && candidate.centeredRows > 0) {
      ratioDeficit = candidate;
      request = candidate.request;
    }
    radix = prepareRadixRepresentation(request);
    checkRequest();
    request = radix?.request ?? request;
  }
  const selectedDensity = ratioDeficit !== undefined || radix !== undefined ? undefined
    : acceptedQuotient === undefined ? baseDensity : candidateDensity;
  let modelNonzeros = selectedDensity === undefined ? 0 : Number(selectedDensity.nonzeros);
  if (selectedDensity === undefined) {
    for (const row of request.rows) {
      throwIfCancelled(request.isCancelled);
      for (const coefficient of row.terms.values()) if (coefficient !== 0) modelNonzeros++;
    }
  }
  if (profileEnabled) emitSolverProfile(request, "highs-call-start", {
    jointObjective: validationRequest.jointObjective?.kind ?? "native",
    ratioDeficit: ratioDeficit === undefined ? 0 : 1,
    ratioDeficitCenteredRows: ratioDeficit?.centeredRows ?? 0,
    radix: radix === undefined ? 0 : 1,
    equalityOriginalVariables: originalVariables,
    equalityOriginalRows: originalRows,
    equalityVariablesRemoved: acceptedQuotient?.variablesRemoved ?? 0,
    equalityRowsRemoved: acceptedQuotient?.rowsRemoved ?? 0,
    equalityPreparationMs,
    equalityQuotientPolicy: equalityPolicy,
    equalityQuotientDecision: equalityDecision,
    ...(validDensityPolicy ? { equalityDensityMaxGrowth: maximumGrowth! } : {}),
    ...(validDensityPolicy ? { equalityMinVariableReductionPercent: minimumReduction! } : {}),
    ...(candidateVariables === undefined ? {} : { equalityCandidateBaseVariables: candidateVariables.base,
      equalityCandidateVariables: candidateVariables.candidate, equalityCandidateVariablesRemoved: candidateVariables.removed }),
    ...(baseDensity === undefined ? {} : { equalityBaseNonzeros: baseDensity.nonzeros.toString(), equalityBaseNonzeroRows: baseDensity.nonzeroRows.toString() }),
    ...(candidateDensity === undefined ? {} : { equalityCandidateNonzeros: candidateDensity.nonzeros.toString(), equalityCandidateNonzeroRows: candidateDensity.nonzeroRows.toString() }),
    materiaPreparationMs,
    materiaVariablesRemoved: materia?.statistics.variablesRemoved ?? 0,
    materiaFamilies: materia?.statistics.eligibleFamilies ?? 0,
    materiaPools: materia?.statistics.pools ?? 0,
    materiaHallRows: materia?.statistics.hallRows ?? 0,
    variables: request.variables.length,
    constraints: request.rows.length,
    nonzeros: modelNonzeros,
    objectiveTerms: request.objective.size,
    hintTerms: request.solutionHint?.size ?? 0,
  });
  checkRequest();
  const highs = await getHighs();
  checkRequest();
  const highsReadyAt = performance.now();
  const text = lpText(
    request.name,
    request.objective,
    request.rows,
    request.variables,
    request.binaryVariables,
    request.integerVariables,
  );
  checkRequest();
  const lpReadyAt = performance.now();
  const startedAt = performance.now();
  let lastMipCheckpointAt = startedAt;
  let modelReadyMs = 0;
  let nativeRunMs = 0;
  let finalStatus = "unknown";
  let stoppedByDualBound = false;
  let lastObjectiveBoundCheckAt = Number.NEGATIVE_INFINITY;
  const result = await highs.withModel((native) => {
    checkRequest();
    requireSuccessfulCall("options.set.small_matrix_value.before-import", native.options.set("small_matrix_value", 1e-12));
    requireSmallMatrixValue("before-import");
    checkRequest();
    let importMetadata: ReturnType<typeof native.readModel> | undefined;
    try {
      importMetadata = native.readModel({ format: "lp", data: text });
    } finally {
      try {
        requireSmallMatrixValue("after-import");
      } finally {
        checkRequest();
      }
    }
    requireSuccessfulCall("readModel", importMetadata);
    modelReadyMs = performance.now() - lpReadyAt;
    const hasProgress = request.onProgress !== undefined;
    const hasCallbackTrace = request.onCallback !== undefined;
    requireSuccessfulCall("options.set.initial", native.options.set({
      output_flag: hasProgress || hasCallbackTrace,
      log_to_console: false,
      presolve: "on",
      mip_min_logging_interval: 1,
    }));
    let solutionHintEntries: readonly (readonly [number, number])[] | undefined;
    if (request.solutionHint !== undefined && request.solutionHint.size > 0) {
      const entries = [...request.solutionHint]
        .map(([name, value]) => [native.getColByName(name), value] as const)
        .sort(([left], [right]) => left - right);
      solutionHintEntries = entries;
      try {
        const hintStatus: { status: number } | undefined = native.setSolution({
          indices: entries.map(([index]) => index),
          values: entries.map(([, value]) => value),
        });
        if (hintStatus?.status !== highs.constants.status.error) requireSuccessfulCall("setSolution", hintStatus);
      } catch (error) {
        // The persistent HiGHS wrapper throws for a native -1 from setSparseSolution.
        if (!(error instanceof Error && "status" in error && error.status === highs.constants.status.error &&
          "operation" in error && error.operation === "setSparseSolution")) throw error;
      }
      checkRequest();
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
      [highs.constants.callbackType.mipInterrupt]: (event) => {
        if (interruptIfStopped(event)) return undefined;
        if (hasCallbackTrace) emitFullCallback("mipInterrupt", event);
        if (interruptIfStopped(event)) return undefined;
        const now = performance.now();
        const dualBound = event.data.mip_dual_bound;
        if (!stoppedByDualBound && request.stopWhenDualBoundProvesOptimal !== undefined &&
          now - lastObjectiveBoundCheckAt >= 100 && typeof dualBound === "number" &&
          Number.isFinite(dualBound)) {
          lastObjectiveBoundCheckAt = now;
          const proved = request.stopWhenDualBoundProvesOptimal(dualBound);
          if (interruptIfStopped(event)) return undefined;
          if (proved) {
            stoppedByDualBound = true;
            event.interrupt();
            return undefined;
          }
        }
        if (hasCallbackTrace && now - lastMipCheckpointAt >= 1000) {
          lastMipCheckpointAt = now;
          if (hasProgress) emitHighsProgress("bound", event.data);
        }
        interruptIfStopped(event);
        return undefined;
      },
      [highs.constants.callbackType.simplexInterrupt]: (event) => {
        if (interruptIfStopped(event)) return undefined;
        if (hasCallbackTrace) emitFullCallback("simplexInterrupt", event);
        interruptIfStopped(event);
        return undefined;
      },
      [highs.constants.callbackType.ipmInterrupt]: (event) => {
        if (interruptIfStopped(event)) return undefined;
        if (hasCallbackTrace) emitFullCallback("ipmInterrupt", event);
        interruptIfStopped(event);
        return undefined;
      },
      ...(hasCallbackTrace ? {
        [highs.constants.callbackType.logging]: (event) => {
          emitFullCallback("logging", event);
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
            // A rejected heuristic hint is not a failed model or a proof result.
            if (status.status !== highs.constants.status.error) {
              requireSuccessfulCall("callback.setSolution", status);
              const repairStatus = event.repairSolution();
              if (repairStatus.status !== highs.constants.status.error) {
                requireSuccessfulCall("callback.repairSolution", repairStatus);
              }
            }
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
    checkRequest();
    // Reset every proof-affecting limit at the actual run boundary, including
    // the unlimited case so an earlier purpose cannot leak its time limit.
    const nativeTimeLimit = remainingNativeSeconds();
    const absoluteGap = validationRequest.jointObjective?.kind === "signature" ? 1024 : 0;
    if (nativeTimeLimit === undefined) {
      // The installed wrapper rejects numeric Infinity in options.set, while
      // its native options-file parser supports the explicit infinite limit.
      requireSuccessfulCall("options.read.unlimited-time", native.options.read("time_limit = inf\n"));
    }
    requireSuccessfulCall("options.set.before-run", native.options.set({
      small_matrix_value: 1e-12,
      mip_abs_gap: absoluteGap,
      mip_rel_gap: 0,
      mip_max_improving_sols: 2_147_483_647,
      ...(nativeTimeLimit === undefined ? {} : { time_limit: nativeTimeLimit }),
    }));
    requireSmallMatrixValue("before-run");
    if (native.options.get("mip_abs_gap") !== absoluteGap || native.options.get("mip_rel_gap") !== 0 ||
        native.options.get("mip_max_improving_sols") !== 2_147_483_647 ||
        native.options.get("time_limit") !== (nativeTimeLimit ?? Number.POSITIVE_INFINITY)) {
      throw new Error("HiGHS 原生证明选项未按本次请求正确复位");
    }
    checkRequest();
    const nativeStartedAt = performance.now();
    let runMetadata: ReturnType<typeof native.run> | undefined;
    try {
      runMetadata = native.run(callbacks);
    } finally {
      nativeRunMs = performance.now() - nativeStartedAt;
      try {
        requireSmallMatrixValue("after-run");
      } finally {
        checkRequest();
      }
    }
    requireSuccessfulCall("run", runMetadata);
    checkRequest();
    const status = native.getModelStatus();
    if (runMetadata?.modelStatus !== status) throw new Error("HiGHS 运行与模型的终止状态不一致");
    if (status === highs.constants.modelStatus.infeasible) {
      const primalStatus = native.info.get("primal_solution_status");
      checkRequest();
      if (primalStatus === highs.constants.solutionStatus.feasible) {
        throw new Error("HiGHS 不可行状态与可行原生 primal 矛盾");
      }
      if (primalStatus !== highs.constants.solutionStatus.none && primalStatus !== highs.constants.solutionStatus.infeasible) {
        throw new Error("HiGHS 不可行结果的 primal 状态未知");
      }
      const hint = validationRequest.solutionHint;
      if (hint !== undefined) {
        const hintedColumns: Record<string, { Primal: number }> = Object.create(null);
        for (const { name } of validationRequest.variables) {
          checkRequest();
          const value = hint.get(name);
          if (value !== undefined) hintedColumns[name] = { Primal: value };
        }
        if (isFeasibleWitness(validationRequest, hintedColumns)) {
          throw new Error("HiGHS 不可行状态与原完整整数模型的可行提示矛盾");
        }
      }
      // An infeasible solve may leave an absent, zero, or invalid buffer. It is
      // only a contradiction when every native integer row really accepts it;
      // failure to find a witness is not an independent infeasibility proof.
      const { numCols } = native.getDimensions();
      const solution = native.getSolution();
      if (numCols === request.variables.length && solution.colValue.length === numCols) {
        const candidate: Record<string, { Primal: number }> = Object.create(null);
        const indices = new Set<number>();
        for (const { name } of request.variables) {
          checkRequest();
          const index = native.getColByName(name);
          const value = solution.colValue[index];
          if (!Number.isInteger(index) || index < 0 || index >= numCols || indices.has(index)
            || Object.hasOwn(candidate, name) || native.getColName(index) !== name
            || value === undefined || !Number.isFinite(value)) break;
          indices.add(index);
          candidate[name] = { Primal: value };
        }
        if (indices.size === numCols && isFeasibleWitness(request, candidate)) {
          throw new Error("HiGHS 不可行状态与原生完整整数模型的可行列值矛盾");
        }
      }
    }
    const Status = stoppedByDualBound && status === highs.constants.modelStatus.interrupted ? "DualBound"
      : status === highs.constants.modelStatus.optimal
        ? validationRequest.jointObjective?.kind === "signature" || validationRequest.jointObjective?.kind === "feasibility"
          ? "FeasibleSignature" : "Optimal"
      : status === highs.constants.modelStatus.infeasible ? "Infeasible" : `状态代码 ${status}`;
    finalStatus = Status;
    const Columns: Record<string, { Primal: number }> = Object.create(null);
    if (hasMipPoint({ Status, Columns })) {
      if (native.info.get("primal_solution_status") !== highs.constants.solutionStatus.feasible) {
        throw new Error("HiGHS 最优状态没有可行原生 primal");
      }
      const { numCols } = native.getDimensions();
      const solution = native.getSolution();
      if (numCols !== request.variables.length || solution.colValue.length !== numCols) {
        throw new Error("HiGHS 最优解原生列数或稠密 primal 长度不完整");
      }
      const indices = new Set<number>();
      for (const { name } of request.variables) {
        checkRequest();
        const index = native.getColByName(name);
        if (!Number.isInteger(index) || index < 0 || index >= numCols || indices.has(index) ||
            Object.hasOwn(Columns, name) || native.getColName(index) !== name) {
          throw new Error(`HiGHS 原生变量名与列索引不是双射：${name}`);
        }
        const value = solution.colValue[index];
        if (value === undefined || !Number.isFinite(value)) {
          throw new Error(`HiGHS 最优解缺少显式有限列：${name}`);
        }
        indices.add(index);
        Columns[name] = { Primal: value };
      }
    }
    const nativeResult = { Status, Columns, ObjectiveValue: native.getObjectiveValue() };
    validateCompleteSolution(request, nativeResult);
    return nativeResult;

    function requireSmallMatrixValue(phase: string): void {
      if (native.options.get("small_matrix_value") !== 1e-12) {
        throw new Error(`HiGHS small_matrix_value 未保持 1e-12：${phase}`);
      }
    }
  });
  checkRequest();
  if (profileEnabled) emitSolverProfile(request, "highs-solve-end", {
    status: finalStatus,
    jointObjective: validationRequest.jointObjective?.kind ?? "native",
    ratioDeficit: ratioDeficit === undefined ? 0 : 1,
    radix: radix === undefined ? 0 : 1,
    getHighsMs: highsReadyAt - callStartedAt,
    lpSerializationMs: lpReadyAt - highsReadyAt,
    modelImportMs: modelReadyMs,
    nativeRunMs,
    totalMs: performance.now() - callStartedAt,
    lpCharacters: text.length,
  });
  checkRequest();
  const unradixed = radix?.expandSolution(result) ?? result;
  checkRequest();
  if (radix !== undefined) validateCompleteSolution(ratioDeficit?.request ?? equalityRequest, unradixed);
  checkRequest();
  const uncentered = ratioDeficit?.expandSolution(unradixed) ?? unradixed;
  checkRequest();
  if (ratioDeficit !== undefined) validateCompleteSolution(equalityRequest, uncentered);
  checkRequest();
  const expanded = acceptedQuotient?.expandSolution(uncentered) ?? uncentered;
  checkRequest();
  validateCompleteSolution(baseRequest, expanded);
  checkRequest();
  const restored = materia?.expandSolution(expanded) ?? expanded;
  checkRequest();
  validateCompleteSolution(validationRequest, restored);
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
  if (profileEnabled && materiaStatistics !== undefined) emitSolverProfile(request, "materia-family-projection", {
    ...materiaStatistics, finalSolverVariables: request.variables.length,
  });
  checkRequest();
  return restored;

  function checkRequest(): void {
    throwIfCancelled(validationRequest.isCancelled);
    if (nativeInterruption !== undefined) throw nativeInterruption.error;
    if (performance.now() >= deadline) {
      throw new Error("HiGHS 请求时间预算已耗尽，完整最优性复核未完成");
    }
  }

  function remainingNativeSeconds(): number | undefined {
    checkRequest();
    if (budgetMs === undefined) return undefined;
    const remaining = deadline - performance.now();
    if (remaining <= 0) checkRequest();
    return remaining / 1000;
  }

  function interruptIfStopped(event: InterruptCallbackEvent): boolean {
    try {
      checkRequest();
      return false;
    } catch (error) {
      nativeInterruption ??= { error };
      stoppedByDualBound = false;
      event.interrupt();
      return true;
    }
  }

  function requireSuccessfulCall(operation: string, metadata: { readonly status: number } | undefined): void {
    if (metadata == null || (metadata.status !== highs.constants.status.ok && metadata.status !== highs.constants.status.warning)) {
      throw new Error(`HiGHS 原生调用失败或返回未知状态：${operation}`);
    }
  }

  function validateCompleteSolution(model: LinearMipRequest, solution: LinearMipSolution): void {
    checkRequest();
    if (!hasMipPoint(solution)) return;
    const names = new Set<string>();
    for (const { name } of model.variables) {
      checkRequest();
      if (names.has(name) || !Object.hasOwn(solution.Columns, name) ||
          !Number.isFinite(solution.Columns[name]?.Primal)) {
        throw new Error(`HiGHS 最优解缺少唯一的显式有限列：${name}`);
      }
      names.add(name);
    }
    validateMipSolution(model.rows, model.variables, solution.Columns);
    checkRequest();
  }

  function isFeasibleWitness(model: LinearMipRequest, columns: Record<string, { Primal: number }>): boolean {
    checkRequest();
    for (const { name } of model.variables) {
      checkRequest();
      if (!Object.hasOwn(columns, name) || !Number.isFinite(columns[name]?.Primal)) return false;
    }
    let feasible = false;
    try {
      // This pure validator has no cancellation callbacks; only an invalid
      // candidate is swallowed. Request interruption remains outside the catch.
      validateMipSolution(model.rows, model.variables, columns);
      feasible = true;
    } catch { /* An unusable buffer supplies no existence witness. */ }
    checkRequest();
    return feasible;
  }

  function validateJointObjective(): void {
    const purpose = validationRequest.jointObjective;
    if (purpose === undefined) return;
    if (purpose.kind === "signature" || purpose.kind === "feasibility") {
      if (validationRequest.stopWhenDualBoundProvesOptimal !== undefined) {
        throw new Error("HiGHS 签名访问请求不能使用比例对偶界证明回调");
      }
      if (purpose.kind === "feasibility" && [...validationRequest.objective.values()].some((value) => value !== 0)) {
        throw new Error("HiGHS 可行性访问请求必须使用零目标");
      }
      return;
    }
    if (purpose.kind !== "ratio-bound" || !Array.isArray(purpose.variables) || purpose.variables.length === 0 ||
        new Set(purpose.variables).size !== purpose.variables.length || !Number.isSafeInteger(purpose.scale) || purpose.scale <= 0) {
      throw new Error("HiGHS 联合比例目标声明无效");
    }
    const variables = new Set(validationRequest.variables.map(({ name }) => name));
    const ratios = new Set(purpose.variables);
    for (const name of ratios) {
      checkRequest();
      if (!variables.has(name) || validationRequest.objective.get(name) !== 1) {
        throw new Error(`HiGHS 联合比例目标缺少原始 +1 比例列：${name}`);
      }
    }
    for (const [name, coefficient] of validationRequest.objective) {
      checkRequest();
      if (coefficient !== 0 && (!ratios.has(name) || coefficient !== 1)) {
        throw new Error(`HiGHS 联合比例目标含非比例目标项：${name}`);
      }
    }
  }

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
    const primalBound = numeric("mip_primal_bound") ?? numeric("objective_function_value");
    const nodes = nonNegativeCount(data.mip_node_count);
    const totalLpIterations = nonNegativeCount(data.mip_total_lp_iterations);
    request.onProgress?.({
      backend: "HiGHS",
      model: request.name,
      kind,
      elapsedMs: performance.now() - startedAt,
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
