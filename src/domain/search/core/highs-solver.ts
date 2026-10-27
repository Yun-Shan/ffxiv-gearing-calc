import type loadHighs from "highs";
import type { ModelRow } from "./model-types.ts";
import type { VariableBounds } from "./model-types.ts";
import type { LinearMipRequest } from "../linear-mip.ts";
import type { LinearMipSolution } from "../linear-mip.ts";
import { isProfileTimingEnabled } from "./diagnostics.ts";
import { emitSolverProfile } from "./diagnostics.ts";
import type { HighsCallbackName } from "../linear-mip.ts";
import type { CallbackEvent } from "highs";
import { prepareEqualityQuotient } from "./equality-quotient.ts";
import { prepareMateriaFamilyProjection } from "./materia-family-projection.ts";
import type { MateriaFamilyProjectionStatistics } from "./materia-family-projection.ts";
import { throwIfCancelled } from "./cancellation.ts";

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
  request = { ...request, name: `${request.name}#${++linearMipRunSequence}` };

  const profileEnabled = request.onProgress !== undefined && isProfileTimingEnabled();
  const callStartedAt = performance.now();
  const originalVariables = request.variables.length;
  const originalRows = request.rows.length;
  let materiaStatistics: MateriaFamilyProjectionStatistics | undefined;
  const materiaObserver = request.onMateriaFamilyProjection;
  request = { ...request, onMateriaFamilyProjection: (statistics) => { materiaStatistics = statistics; materiaObserver?.(statistics); } };
  const materia = prepareMateriaFamilyProjection(request);
  request = materia?.request ?? request;
  const materiaPreparationMs = performance.now() - callStartedAt;
  const baseRequest = request;
  const equalityStartedAt = performance.now();
  const policy = baseRequest.equalityQuotient;
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
  const selectedDensity = acceptedQuotient === undefined ? baseDensity : candidateDensity;
  let modelNonzeros = selectedDensity === undefined ? 0 : Number(selectedDensity.nonzeros);
  if (selectedDensity === undefined) {
    for (const row of request.rows) {
      throwIfCancelled(request.isCancelled);
      for (const coefficient of row.terms.values()) if (coefficient !== 0) modelNonzeros++;
    }
  }
  if (profileEnabled) emitSolverProfile(request, "highs-call-start", {
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
  const expanded = acceptedQuotient?.expandSolution(result) ?? result;
  const restored = materia?.expandSolution(expanded) ?? expanded;
  if (profileEnabled && materiaStatistics !== undefined) emitSolverProfile(request, "materia-family-projection", {
    ...materiaStatistics, finalSolverVariables: request.variables.length,
  });
  return restored;

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
