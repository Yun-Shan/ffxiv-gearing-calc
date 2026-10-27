import type { LinearMipRequest, LinearMipSolution } from "../linear-mip.ts";

type Dyadic = { numerator: bigint; exponent: number };

const doubleBits = new DataView(new ArrayBuffer(8));

function asDyadic(value: number): Dyadic {
  if (Number.isInteger(value)) return { numerator: BigInt(value), exponent: 0 };
  doubleBits.setFloat64(0, value, false);
  const bits = doubleBits.getBigUint64(0, false);
  const fraction = bits & ((1n << 52n) - 1n);
  const encodedExponent = Number((bits >> 52n) & 0x7ffn);
  const sign = (bits >> 63n) === 0n ? 1n : -1n;
  return encodedExponent === 0
    ? { numerator: sign * fraction, exponent: -1074 }
    : { numerator: sign * ((1n << 52n) | fraction), exponent: encodedExponent - 1075 };
}

/** Sum the actual binary coefficients, preserving their exact value and scale. */
function exactSum(values: readonly number[]): number | undefined {
  const dyadics = values.map(asDyadic);
  let exponent = dyadics[0]!.exponent;
  for (const value of dyadics) exponent = Math.min(exponent, value.exponent);
  let numerator = dyadics.reduce((sum, value) =>
    sum + (value.numerator << BigInt(value.exponent - exponent)), 0n);
  if (numerator === 0n) return 0;
  while (numerator % 2n === 0n) {
    numerator /= 2n;
    exponent++;
  }
  const significand = Number(numerator);
  if (!Number.isSafeInteger(significand) || BigInt(significand) !== numerator) return undefined;
  const result = significand * 2 ** exponent;
  if (!Number.isFinite(result) || result === 0 || Math.abs(result) > Number.MAX_SAFE_INTEGER) return undefined;
  const restored = asDyadic(result);
  const commonExponent = Math.min(exponent, restored.exponent);
  return (numerator << BigInt(exponent - commonExponent)) ===
    (restored.numerator << BigInt(restored.exponent - commonExponent))
    ? result
    : undefined;
}

export type EqualityQuotient = {
  request: LinearMipRequest;
  aliases: ReadonlyMap<string, string>;
  variablesRemoved: number;
  rowsRemoved: number;
  expandSolution: (solution: LinearMipSolution) => LinearMipSolution;
};

/**
 * T57: only explicit a(x-y)=0 rows authorize sharing a coordinate. Unknown or
 * inexact inputs abandon the whole transformation, leaving the original model.
 */
export function prepareEqualityQuotient(request: LinearMipRequest): EqualityQuotient | undefined {
  const edges: [string, string][] = [];
  for (const row of request.rows) {
    if (row.sense !== "=" || row.rhs !== 0 || row.terms.size !== 2) continue;
    const [[left, a], [right, b]] = [...row.terms] as [[string, number], [string, number]];
    if (Number.isFinite(a) && a !== 0 && a === -b) edges.push([left, right]);
  }
  if (edges.length === 0) return undefined;

  const indexByName = new Map<string, number>();
  for (const [index, variable] of request.variables.entries()) {
    if (indexByName.has(variable.name) || !Number.isFinite(variable.min) ||
      !Number.isFinite(variable.max) || variable.min > variable.max) return undefined;
    indexByName.set(variable.name, index);
  }
  const parents = request.variables.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root]!;
    while (parents[index] !== index) {
      const next = parents[index]!;
      parents[index] = root;
      index = next;
    }
    return root;
  };
  for (const [left, right] of edges) {
    const leftIndex = indexByName.get(left);
    const rightIndex = indexByName.get(right);
    if (leftIndex === undefined || rightIndex === undefined) return undefined;
    const a = find(leftIndex);
    const b = find(rightIndex);
    parents[Math.max(a, b)] = Math.min(a, b);
  }

  const aliases = new Map(request.variables.map((variable, index) =>
    [variable.name, request.variables[find(index)]!.name]));
  if ([...aliases].every(([name, representative]) => name === representative)) return undefined;
  const binaries = new Set<string>();
  const integers = new Set<string>();
  for (const name of request.binaryVariables) {
    const representative = aliases.get(name);
    if (representative === undefined) return undefined;
    binaries.add(representative);
  }
  for (const name of request.integerVariables) {
    const representative = aliases.get(name);
    if (representative === undefined) return undefined;
    integers.add(representative);
  }
  for (const name of binaries) integers.delete(name);

  const bounds = new Map<string, { name: string; min: number; max: number }>();
  for (const variable of request.variables) {
    const name = aliases.get(variable.name)!;
    const bound = bounds.get(name) ?? { name, min: variable.min, max: variable.max };
    bound.min = Math.max(bound.min, variable.min, binaries.has(name) ? 0 : -Infinity);
    bound.max = Math.min(bound.max, variable.max, binaries.has(name) ? 1 : Infinity);
    // Let the original solver handle contradictions rather than fabricate a status.
    if (bound.min > bound.max) return undefined;
    bounds.set(name, bound);
  }

  const combine = (terms: ReadonlyMap<string, number>): Map<string, number> | undefined => {
    const groups = new Map<string, number | number[]>();
    for (const [name, coefficient] of terms) {
      const representative = aliases.get(name);
      if (representative === undefined || !Number.isFinite(coefficient) ||
        Math.abs(coefficient) > Number.MAX_SAFE_INTEGER) return undefined;
      if (coefficient === 0) continue;
      const previous = groups.get(representative);
      if (previous === undefined) groups.set(representative, coefficient);
      else if (typeof previous === "number") groups.set(representative, [previous, coefficient]);
      else previous.push(coefficient);
    }
    const combined = new Map<string, number>();
    for (const [name, coefficients] of groups) {
      const coefficient = typeof coefficients === "number" ? coefficients : exactSum(coefficients);
      if (coefficient === undefined) return undefined;
      if (coefficient !== 0) combined.set(name, coefficient);
    }
    return combined;
  };
  const objective = combine(request.objective);
  if (objective === undefined) return undefined;
  const rows: LinearMipRequest["rows"][number][] = [];
  for (const row of request.rows) {
    if (!Number.isFinite(row.rhs)) return undefined;
    const terms = combine(row.terms);
    if (terms === undefined) return undefined;
    if (terms.size === 0) {
      const tautology = row.sense === "=" ? row.rhs === 0
        : row.sense === "<=" ? row.rhs >= 0 : row.rhs <= 0;
      if (!tautology) return undefined;
      continue;
    }
    rows.push({ ...row, terms });
  }

  let solutionHint: Map<string, number> | undefined;
  if (request.solutionHint !== undefined) {
    solutionHint = new Map();
    for (const [name, value] of request.solutionHint) {
      const representative = aliases.get(name);
      if (representative === undefined || !Number.isFinite(value) ||
        (solutionHint.has(representative) && solutionHint.get(representative) !== value)) return undefined;
      solutionHint.set(representative, value);
    }
  }
  return {
    request: {
      ...request,
      objective,
      rows,
      variables: [...bounds.values()],
      binaryVariables: [...binaries],
      integerVariables: [...integers],
      ...(solutionHint === undefined ? {} : { solutionHint }),
    },
    aliases,
    variablesRemoved: request.variables.length - bounds.size,
    rowsRemoved: request.rows.length - rows.length,
    expandSolution: (solution) => {
      if (solution.Status !== "Optimal") return solution;
      const Columns: LinearMipSolution["Columns"] = {};
      for (const [name, representative] of aliases) {
        const column = solution.Columns[representative];
        if (column === undefined) throw new Error(`等式商求解结果缺少代表变量：${representative}`);
        Columns[name] = { Primal: column.Primal };
      }
      return { ...solution, Columns };
    },
  };
}
