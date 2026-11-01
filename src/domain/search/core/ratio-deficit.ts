import type { LinearMipProgress, LinearMipRequest, LinearMipRow, LinearMipSolution, LinearMipVariable } from "../linear-mip.ts";
import { hasMipPoint } from "../linear-mip.ts";
import { throwIfCancelled } from "./cancellation.ts";

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function safe(value: bigint): number | undefined {
  return value < -SAFE || value > SAFE ? undefined : Number(value);
}

export type RatioDeficitMetadata = {
  /** Explicit caller certificate identifying the ratio auxiliaries in this request. */
  variables: readonly string[];
  scale: number;
};

export type RatioDeficitRepresentation = {
  request: LinearMipRequest;
  centeredRows: number;
  expandSolution: (solution: LinearMipSolution) => LinearMipSolution;
};

type Ratio = { name: string; maximum: bigint };

/** Exact q = scale - deficit representation for an explicitly certified ratio model.
 * Completion and exact point validation remain the caller's responsibility.
 */
export function prepareRatioDeficitRepresentation(
  request: LinearMipRequest,
  metadata: RatioDeficitMetadata,
): RatioDeficitRepresentation | undefined {
  throwIfCancelled(request.isCancelled);
  if (!Number.isSafeInteger(metadata.scale) || metadata.scale <= 0 || metadata.variables.length === 0 ||
      new Set(metadata.variables).size !== metadata.variables.length) return undefined;
  const numericScale = metadata.scale;
  const scale = BigInt(numericScale);
  const bounds = new Map<string, LinearMipVariable>();
  const names = new Set<string>();
  const binary = new Set(request.binaryVariables);
  const general = new Set(request.integerVariables);
  for (const bound of request.variables) {
    throwIfCancelled(request.isCancelled);
    if (bounds.has(bound.name)) return undefined;
    bounds.set(bound.name, bound);
    names.add(bound.name);
  }
  for (const name of [...binary, ...general]) {
    throwIfCancelled(request.isCancelled);
    if (!bounds.has(name)) return undefined;
  }
  for (const [name, coefficient] of request.objective) {
    throwIfCancelled(request.isCancelled);
    if (!bounds.has(name) || !Number.isSafeInteger(coefficient)) return undefined;
    names.add(name);
  }
  let originalNonzeros = 0;
  for (const row of request.rows) {
    throwIfCancelled(request.isCancelled);
    names.add(row.name);
    if (!Number.isSafeInteger(row.rhs) || !["=", "<=", ">="].includes(row.sense)) return undefined;
    for (const [name, coefficient] of row.terms) {
      throwIfCancelled(request.isCancelled);
      if (!bounds.has(name) || !Number.isSafeInteger(coefficient)) return undefined;
      if (coefficient !== 0) originalNonzeros++;
      names.add(name);
    }
  }
  const ratios = new Map<string, Ratio>();
  for (const [index, originalName] of metadata.variables.entries()) {
    throwIfCancelled(request.isCancelled);
    const original = bounds.get(originalName);
    const name = `__ratio_deficit_${index}`;
    if (original === undefined || original.min !== 0 || original.max !== numericScale ||
        !general.has(originalName) || binary.has(originalName) || names.has(name)) return undefined;
    names.add(name);
    ratios.set(originalName, { name, maximum: scale });
  }

  // The real sum-of-ratios row gives a necessary upper bound for every deficit.
  // A negative maximum is a contradiction, not permission to fabricate Infeasible.
  for (const row of request.rows) {
    throwIfCancelled(request.isCancelled);
    if (row.sense !== ">=" || row.terms.size === 0) continue;
    let ratioSum = true;
    for (const [name, coefficient] of row.terms) {
      throwIfCancelled(request.isCancelled);
      if (!ratios.has(name) || coefficient !== 1) { ratioSum = false; break; }
    }
    if (!ratioSum) continue;
    const maximum = BigInt(row.terms.size) * scale - BigInt(row.rhs);
    if (maximum < 0n) return undefined;
    for (const name of row.terms.keys()) {
      throwIfCancelled(request.isCancelled);
      const ratio = ratios.get(name)!;
      if (maximum < ratio.maximum) ratio.maximum = maximum;
    }
  }

  const oneHot: LinearMipRow[] = [];
  for (const row of request.rows) {
    throwIfCancelled(request.isCancelled);
    if (row.sense !== "=" || row.rhs !== 1 || row.terms.size === 0) continue;
    let certified = true;
    for (const [name, coefficient] of row.terms) {
      throwIfCancelled(request.isCancelled);
      const bound = bounds.get(name)!;
      if (coefficient !== 1 || !binary.has(name) || bound.min !== 0 || bound.max !== 1) { certified = false; break; }
    }
    if (certified) oneHot.push(row);
  }
  oneHot.sort((left, right) => right.terms.size - left.terms.size);

  let offset = 0n;
  const objective = new Map<string, number>();
  for (const [name, coefficient] of request.objective) {
    throwIfCancelled(request.isCancelled);
    const ratio = ratios.get(name);
    if (ratio !== undefined) {
      offset += BigInt(coefficient) * scale;
      objective.set(ratio.name, -coefficient);
    } else objective.set(name, coefficient);
  }
  const rows: LinearMipRow[] = [];
  let centeredRows = 0;
  // H: bound sparse-row matching work, without restricting any feasible point.
  const centeringBudget = Math.max(1024, Math.min(2_000_000, 4 * originalNonzeros));
  let centeringWork = 0;
  let centeringExhausted = false;
  const consumeCenteringWork = (): boolean => {
    throwIfCancelled(request.isCancelled);
    if (centeringWork >= centeringBudget) { centeringExhausted = true; return false; }
    centeringWork++;
    return true;
  };
  for (const row of request.rows) {
    throwIfCancelled(request.isCancelled);
    let rhs = BigInt(row.rhs);
    const terms = new Map<string, bigint>();
    const containedRatios: number[] = [];
    for (const [name, coefficient] of row.terms) {
      throwIfCancelled(request.isCancelled);
      const ratio = ratios.get(name);
      if (ratio !== undefined) {
        rhs -= BigInt(coefficient) * scale;
        terms.set(ratio.name, -BigInt(coefficient));
        if (coefficient !== 0) containedRatios.push(coefficient);
      } else terms.set(name, BigInt(coefficient));
    }
    if (containedRatios.length === 1 && containedRatios[0] === 1) {
      let group: LinearMipRow | undefined;
      for (const candidate of oneHot) {
        if (centeringExhausted || !consumeCenteringWork()) break;
        let allNegative = true;
        for (const name of candidate.terms.keys()) {
          if (!consumeCenteringWork()) { allNegative = false; break; }
          if (!((row.terms.get(name) ?? 0) < 0)) { allNegative = false; break; }
        }
        if (centeringExhausted) break;
        if (allNegative) {
          // Reserve the complete application before changing any row term/RHS.
          if (centeringWork + candidate.terms.size > centeringBudget) { centeringExhausted = true; break; }
          group = candidate; break;
        }
      }
      if (group !== undefined) {
        for (const name of group.terms.keys()) {
          consumeCenteringWork();
          terms.set(name, terms.get(name)! + scale);
        }
        rhs += scale;
        centeredRows++;
      }
    }
    const numericTerms = new Map<string, number>();
    for (const [name, coefficient] of terms) {
      throwIfCancelled(request.isCancelled);
      const value = safe(coefficient);
      if (value === undefined) return undefined;
      if (value !== 0) numericTerms.set(name, value);
    }
    const numericRhs = safe(rhs);
    if (numericRhs === undefined) return undefined;
    rows.push({ ...row, terms: numericTerms, rhs: numericRhs });
  }
  const variables: LinearMipVariable[] = [];
  for (const bound of request.variables) {
    throwIfCancelled(request.isCancelled);
    const ratio = ratios.get(bound.name);
    if (ratio === undefined) variables.push({ ...bound });
    else {
      const max = safe(ratio.maximum);
      if (max === undefined || max < 0) return undefined;
      variables.push({ name: ratio.name, min: 0, max });
    }
  }

  // Invalid/stale hints never make a valid original model fail preparation.
  const solutionHint = request.solutionHint === undefined ? undefined : new Map<string, number>();
  if (solutionHint !== undefined) for (const [name, value] of request.solutionHint!) {
    throwIfCancelled(request.isCancelled);
    const bound = bounds.get(name);
    if (bound === undefined || !Number.isFinite(value) || value < bound.min || value > bound.max ||
        ((general.has(name) || binary.has(name)) && !Number.isSafeInteger(value)) ||
        (binary.has(name) && value !== 0 && value !== 1)) { continue; }
    const ratio = ratios.get(name);
    if (ratio === undefined) {
      solutionHint.set(name, value);
      continue;
    }
    if (!Number.isSafeInteger(value) || value < 0 || value > numericScale) { continue; }
    const deficit = scale - BigInt(value);
    if (deficit <= ratio.maximum) solutionHint.set(ratio.name, Number(deficit));
  }

  const restoreUpperBound = (rawDual: number): number | undefined => {
    throwIfCancelled(request.isCancelled);
    if (!Number.isFinite(rawDual)) return undefined;
    const rounded = Math.ceil(rawDual);
    if (!Number.isSafeInteger(rounded)) return undefined;
    return safe(offset + BigInt(rounded));
  };
  const restoreObjective = (raw: number | undefined): number | undefined => {
    if (raw === undefined || !Number.isSafeInteger(raw)) return undefined;
    return safe(offset + BigInt(raw));
  };
  const restoreProgress = (event: LinearMipProgress): LinearMipProgress => {
    const restored = { ...event };
    if (event.objectiveValue !== undefined) {
      const objectiveValue = restoreObjective(event.objectiveValue);
      if (objectiveValue === undefined) delete restored.objectiveValue;
      else restored.objectiveValue = objectiveValue;
    }
    if (event.bestBound !== undefined) {
      const bestBound = restoreUpperBound(event.bestBound);
      if (bestBound === undefined) delete restored.bestBound;
      else restored.bestBound = bestBound;
    }
    // The raw relative gap is not invariant under an objective translation.
    delete restored.gap;
    return restored;
  };
  throwIfCancelled(request.isCancelled);
  return {
    request: {
      ...request,
      objective, rows, variables,
      binaryVariables: [...request.binaryVariables],
      integerVariables: request.integerVariables.map(name => ratios.get(name)?.name ?? name),
      ...(solutionHint === undefined ? {} : { solutionHint }),
      ...(request.stopWhenDualBoundProvesOptimal === undefined ? {} : {
        stopWhenDualBoundProvesOptimal: (rawDual: number) => {
          const restored = restoreUpperBound(rawDual);
          return restored === undefined ? false : request.stopWhenDualBoundProvesOptimal!(restored);
        },
      }),
      ...(request.onProgress === undefined ? {} : {
        onProgress: (event: LinearMipProgress) => {
          throwIfCancelled(request.isCancelled);
          request.onProgress!(restoreProgress(event));
        },
      }),
    },
    centeredRows,
    expandSolution: (solution) => {
      throwIfCancelled(request.isCancelled);
      const restored = { ...solution };
      if (solution.ObjectiveValue !== undefined) {
        const objective = restoreObjective(solution.ObjectiveValue);
        if (objective === undefined) delete restored.ObjectiveValue;
        else restored.ObjectiveValue = objective;
      }
      if (!hasMipPoint(solution)) return restored;
      const Columns = Object.assign(Object.create(null) as LinearMipSolution["Columns"], solution.Columns);
      for (const bound of request.variables) {
        throwIfCancelled(request.isCancelled);
        const ratio = ratios.get(bound.name);
        const source = ratio?.name ?? bound.name;
        const value = Object.hasOwn(Columns, source) ? Columns[source]?.Primal : undefined;
        if (value === undefined || !Number.isFinite(value)) throw new Error(`Deficit result missing finite column: ${source}`);
        // The integer native point is validated before expansion. Round in the
        // small deficit coordinate before subtracting a potentially large scale.
        const integer = Math.round(value);
        if (ratio !== undefined && (!Number.isSafeInteger(integer) || Math.abs(value - integer) > 1e-5)) {
          throw new Error(`Deficit result has unreliable integer column: ${source}`);
        }
        const primal = ratio === undefined ? value : numericScale - integer;
        Columns[bound.name] = { Primal: primal };
        if (ratio !== undefined) delete Columns[source];
      }
      return { ...restored, Columns };
    },
  };
}
