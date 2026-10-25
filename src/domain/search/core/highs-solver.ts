import type loadHighs from "highs";
import type { ModelRow } from "./model-types.ts";
import type { VariableBounds } from "./model-types.ts";
import type { LinearMipRequest } from "../linear-mip.ts";
import type { LinearMipSolution } from "../linear-mip.ts";
import { isProfileTimingEnabled } from "./diagnostics.ts";
import { emitSolverProfile } from "./diagnostics.ts";
import type { HighsCallbackName } from "../linear-mip.ts";
import type { CallbackEvent } from "highs";

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

export async function solveIntegerModel(
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
