import type { LinearMipRequest, LinearMipRow, LinearMipSolution, LinearMipVariable } from "../linear-mip.ts";
import { hasMipPoint } from "../linear-mip.ts";
import { throwIfCancelled } from "./cancellation.ts";
import { floorDiv } from "./exact-arithmetic.ts";

const BASE = 65_536n;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
// H: preparation/performance policy, not a condition of the integer proof.
const MINIMUM_COEFFICIENT = 2 ** 32;

function safe(value: bigint): number | undefined {
  return value < -SAFE || value > SAFE ? undefined : Number(value);
}

function digits(value: bigint): bigint[] {
  const result: bigint[] = [];
  do {
    result.push(value % BASE);
    value /= BASE;
  } while (value !== 0n);
  return result;
}

type RowPlan = {
  index: number;
  original: LinearMipRow;
  digitCount: number;
  slackMaximum?: bigint;
  sigma: bigint;
  coefficientDigits: Map<string, bigint[]>;
  rhsDigits: bigint[];
  slackNames: string[];
  carryNames: string[];
  rows: LinearMipRow[];
  variables: LinearMipVariable[];
};

export type RadixRepresentation = {
  request: LinearMipRequest;
  expandSolution: (solution: LinearMipSolution) => LinearMipSolution;
};

/** Exact signed base-65536 row decomposition with bounded integer carries.
 * This representation does not confer native completion authority.
 */
export function prepareRadixRepresentation(request: LinearMipRequest): RadixRepresentation | undefined {
  throwIfCancelled(request.isCancelled);
  const bounds = new Map<string, LinearMipVariable>();
  const names = new Set<string>();
  const rowNames = new Set(request.rows.map(row => row.name));
  for (const variable of request.variables) {
    throwIfCancelled(request.isCancelled);
    if (bounds.has(variable.name)) return undefined;
    bounds.set(variable.name, variable);
    names.add(variable.name);
  }
  const binaries = new Set(request.binaryVariables);
  const integers = new Set([...request.integerVariables, ...request.binaryVariables]);
  for (const name of integers) {
    throwIfCancelled(request.isCancelled);
    if (!bounds.has(name)) return undefined;
  }
  for (const name of request.objective.keys()) {
    throwIfCancelled(request.isCancelled);
    names.add(name);
  }
  let originalNonzeros = 0;
  for (const row of request.rows) {
    throwIfCancelled(request.isCancelled);
    for (const [name, coefficient] of row.terms) {
      throwIfCancelled(request.isCancelled);
      names.add(name);
      if (coefficient !== 0) originalNonzeros++;
    }
  }
  let addedRows = 0;
  let addedVariables = 0;
  let addedNonzeros = 0;
  const plans: RowPlan[] = [];

  for (const [index, row] of request.rows.entries()) {
    throwIfCancelled(request.isCancelled);
    let maximumCoefficient = 0;
    for (const coefficient of row.terms.values()) {
      throwIfCancelled(request.isCancelled);
      maximumCoefficient = Math.max(maximumCoefficient, Math.abs(coefficient));
    }
    if (!(maximumCoefficient >= MINIMUM_COEFFICIENT)) continue;
    if (!Number.isSafeInteger(row.rhs) || !["=", "<=", ">="].includes(row.sense)) {
      continue;
    }
    let minimum = 0n;
    let maximum = 0n;
    let eligible = true;
    const coefficientDigits = new Map<string, bigint[]>();
    const rhsDigits = digits(BigInt(row.rhs));
    let digitCount = rhsDigits.length;
    let originalRowNonzeros = 0;
    for (const [name, coefficient] of row.terms) {
      throwIfCancelled(request.isCancelled);
      const bound = bounds.get(name);
      if (!Number.isSafeInteger(coefficient) || !integers.has(name) || bound === undefined ||
          !Number.isSafeInteger(bound.min) || !Number.isSafeInteger(bound.max) || bound.min > bound.max ||
          (binaries.has(name) && (bound.min < 0 || bound.max > 1))) {
        eligible = false; break;
      }
      const a = BigInt(coefficient);
      const low = a * BigInt(bound.min);
      const high = a * BigInt(bound.max);
      minimum += low < high ? low : high;
      maximum += low > high ? low : high;
      const parts = digits(a);
      coefficientDigits.set(name, parts);
      digitCount = Math.max(digitCount, parts.length);
      if (coefficient !== 0) originalRowNonzeros++;
    }
    if (!eligible) { continue; }
    const sigma = row.sense === "<=" ? 1n : row.sense === ">=" ? -1n : 0n;
    const slackMaximum = sigma === 1n ? BigInt(row.rhs) - minimum
      : sigma === -1n ? maximum - BigInt(row.rhs) : undefined;
    if (slackMaximum !== undefined) {
      if (slackMaximum < 0n) { continue; }
      digitCount = Math.max(digitCount, digits(slackMaximum).length);
    }
    const variableCount = digitCount - 1 + (sigma === 0n ? 0 : digitCount);
    if (addedRows + digitCount - 1 > request.rows.length || addedVariables + variableCount > request.variables.length) {
      continue;
    }
    const plan: RowPlan = {
      index, original: row, digitCount, sigma, coefficientDigits, rhsDigits,
      ...(slackMaximum === undefined ? {} : { slackMaximum }),
      slackNames: [], carryNames: [], rows: [], variables: [],
    };
    let previousMinimum = 0n;
    let previousMaximum = 0n;
    let candidateNonzeros = 0;
    const localNames = new Set<string>();
    const claimName = (name: string): boolean => {
      if (names.has(name) || rowNames.has(name) || localNames.has(name)) return false;
      localNames.add(name); return true;
    };
    for (let j = 0; j < digitCount; j++) {
      throwIfCancelled(request.isCancelled);
      const rowName = `__radix_${index}_digit_${j}`;
      if (!claimName(rowName)) { eligible = false; break; }
      const terms = new Map<string, number>();
      const rhs = rhsDigits[j] ?? 0n;
      let numeratorMinimum = previousMinimum - rhs;
      let numeratorMaximum = previousMaximum - rhs;
      for (const [name, parts] of coefficientDigits) {
        throwIfCancelled(request.isCancelled);
        const digit = parts[j] ?? 0n;
        if (digit === 0n) continue;
        terms.set(name, Number(digit));
        const bound = bounds.get(name)!;
        const low = digit * BigInt(bound.min);
        const high = digit * BigInt(bound.max);
        numeratorMinimum += low < high ? low : high;
        numeratorMaximum += low > high ? low : high;
      }
      if (sigma !== 0n) {
        const name = `__radix_${index}_slack_${j}`;
        if (!claimName(name)) { eligible = false; break; }
        plan.slackNames.push(name);
        plan.variables.push({ name, min: 0, max: Number(BASE - 1n) });
        terms.set(name, Number(sigma));
        if (sigma > 0n) numeratorMaximum += BASE - 1n;
        else numeratorMinimum -= BASE - 1n;
      }
      if (j > 0) terms.set(plan.carryNames[j - 1]!, 1);
      const carryMinimum = -floorDiv(-numeratorMinimum, BASE);
      const carryMaximum = floorDiv(numeratorMaximum, BASE);
      if (carryMinimum > carryMaximum) { eligible = false; break; }
      if (j === digitCount - 1) {
        // The highest carry is exactly zero, never a free auxiliary.
        if (carryMinimum > 0n || carryMaximum < 0n) { eligible = false; break; }
      } else {
        const min = safe(carryMinimum);
        const max = safe(carryMaximum);
        const name = `__radix_${index}_carry_${j}`;
        if (min === undefined || max === undefined || !claimName(name)) { eligible = false; break; }
        plan.carryNames.push(name);
        plan.variables.push({ name, min, max });
        terms.set(name, -Number(BASE));
      }
      previousMinimum = carryMinimum;
      previousMaximum = carryMaximum;
      candidateNonzeros += terms.size;
      plan.rows.push({ name: rowName, terms, sense: "=", rhs: Number(rhs) });
    }
    if (!eligible) { continue; }
    const nonzeroDelta = candidateNonzeros - originalRowNonzeros;
    if (addedNonzeros + nonzeroDelta > 3 * originalNonzeros) { continue; }
    addedRows += digitCount - 1;
    addedVariables += variableCount;
    addedNonzeros += nonzeroDelta;
    for (const name of localNames) names.add(name);
    plans.push(plan);
  }
  if (plans.length === 0) return undefined;

  const auxiliaryNames = plans.flatMap(plan => plan.variables.map(variable => variable.name));
  const planByIndex = new Map(plans.map(plan => [plan.index, plan]));
  const liftRow = (plan: RowPlan, point: ReadonlyMap<string, number>): Map<string, number> | undefined => {
    throwIfCancelled(request.isCancelled);
    let lhs = 0n;
    for (const [name, coefficient] of plan.original.terms) {
      throwIfCancelled(request.isCancelled);
      const value = point.get(name);
      const bound = bounds.get(name)!;
      if (value === undefined || !Number.isSafeInteger(value) || value < bound.min || value > bound.max) return undefined;
      lhs += BigInt(coefficient) * BigInt(value);
    }
    const rhs = BigInt(plan.original.rhs);
    const slack = plan.sigma === 1n ? rhs - lhs : plan.sigma === -1n ? lhs - rhs : 0n;
    if (slack < 0n || (plan.sigma === 0n && lhs !== rhs) ||
        (plan.slackMaximum !== undefined && slack > plan.slackMaximum)) return undefined;
    const slackDigits = digits(slack);
    const result = new Map<string, number>();
    let previous = 0n;
    for (let j = 0; j < plan.digitCount; j++) {
      throwIfCancelled(request.isCancelled);
      let numerator = previous - (plan.rhsDigits[j] ?? 0n);
      for (const [name, parts] of plan.coefficientDigits) {
        throwIfCancelled(request.isCancelled);
        numerator += (parts[j] ?? 0n) * BigInt(point.get(name)!);
      }
      const slackDigit = slackDigits[j] ?? 0n;
      numerator += plan.sigma * slackDigit;
      if (plan.sigma !== 0n) result.set(plan.slackNames[j]!, Number(slackDigit));
      if (numerator % BASE !== 0n) return undefined;
      previous = numerator / BASE;
      if (j < plan.digitCount - 1) {
        const value = safe(previous);
        if (value === undefined) return undefined;
        result.set(plan.carryNames[j]!, value);
      } else if (previous !== 0n) return undefined;
    }
    for (const bound of plan.variables) {
      const value = result.get(bound.name)!;
      if (value < bound.min || value > bound.max) return undefined;
    }
    return result;
  };

  // A stale or partial hint is not a model error. Only lift fully known legal rows.
  const solutionHint = request.solutionHint === undefined ? undefined : new Map<string, number>();
  if (solutionHint !== undefined) for (const [name, value] of request.solutionHint!) {
    throwIfCancelled(request.isCancelled);
    const bound = bounds.get(name);
    if (bound === undefined || !Number.isFinite(value) || value < bound.min || value > bound.max ||
        (integers.has(name) && !Number.isSafeInteger(value)) ||
        (binaries.has(name) && value !== 0 && value !== 1)) { continue; }
    solutionHint.set(name, value);
  }
  if (solutionHint !== undefined) for (const plan of plans) {
    const lifted = liftRow(plan, solutionHint);
    if (lifted !== undefined) for (const [name, value] of lifted) solutionHint.set(name, value);
  }
  throwIfCancelled(request.isCancelled);
  return {
    request: {
      ...request,
      objective: new Map(request.objective),
      rows: request.rows.flatMap((row, index) => planByIndex.get(index)?.rows ?? [{ ...row, terms: new Map(row.terms) }]),
      variables: [...request.variables.map(variable => ({ ...variable })), ...plans.flatMap(plan => plan.variables.map(variable => ({ ...variable })))],
      binaryVariables: [...request.binaryVariables],
      integerVariables: [...request.integerVariables, ...auxiliaryNames],
      ...(solutionHint === undefined ? {} : { solutionHint }),
    },
    expandSolution: (solution) => {
      throwIfCancelled(request.isCancelled);
      if (!hasMipPoint(solution)) return solution;
      const Columns = { ...solution.Columns };
      for (const variable of request.variables) {
        throwIfCancelled(request.isCancelled);
        if (!Object.hasOwn(Columns, variable.name) || !Number.isFinite(Columns[variable.name]?.Primal)) {
          throw new Error(`Radix result missing finite original column: ${variable.name}`);
        }
      }
      for (const name of auxiliaryNames) delete Columns[name];
      return { ...solution, Columns };
    },
  };
}
