import type { LinearMipRequest, LinearMipRow, LinearMipSolution } from "../linear-mip.ts";
import { throwIfCancelled } from "./cancellation.ts";
import { validateMipSolution } from "./solution-validation.ts";

/** A complete bounded count simplex, already shifted by its observed minima. */
export type MateriaCountFamily = {
  grade: number;
  coordinates: readonly number[];
  units: readonly number[];
  fixedAttributes: readonly number[];
  capacities: readonly number[];
  remaining: number;
  counts: readonly (readonly number[])[];
};
export type MateriaModelFamily = MateriaCountFamily & {
  members: readonly string[];
  slotVariables: readonly string[];
  oneHotRow: LinearMipRow;
  rawRows: readonly LinearMipRow[];
};
export type MateriaFamilyProjectionStatistics = {
  eligibleFamilies: number;
  rejectedFamilies: number;
  familyPoints: number;
  pools: number;
  hallRows: number;
  variablesRemoved: number;
  originalVariables: number;
  solverVariables: number;
  preparationMs: number;
  reconstructionMs: number;
  skipReason?: string;
};
type Limits = { maxMs?: number; maxPoints?: number; maxHallRows?: number };
class Abandon extends Error {}
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
const safe = (value: bigint) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Abandon("unsafe-arithmetic");
  return result;
};

/** Enumerate the entire slice; a caller's work guard must throw, never truncate. */
export function boundedMateriaCounts(capacities: readonly number[], remaining: number, check: () => void = () => {}): number[][] {
  const result: number[][] = [];
  const counts = new Array<number>(capacities.length).fill(0);
  const walk = (axis: number, left: number) => {
    check();
    if (axis === capacities.length) { if (left === 0) result.push([...counts]); return; }
    for (let amount = 0; amount <= Math.min(left, capacities[axis]!); amount++) {
      counts[axis] = amount;
      walk(axis + 1, left - amount);
    }
  };
  walk(0, remaining);
  return result;
}

/** Numeric completeness, including duplicate count vectors and full coordinates. */
export function validMateriaCountFamily(family: MateriaCountFamily, check: () => void = () => {}): boolean {
  if (family === null || typeof family !== "object" || !Array.isArray(family.coordinates) || !Array.isArray(family.units) ||
    !Array.isArray(family.capacities) || !Array.isArray(family.counts) || !Array.isArray(family.fixedAttributes)) return false;
  const { coordinates, units, capacities, remaining, counts, fixedAttributes } = family;
  if (!integer(family.grade) || family.grade === 0 || !integer(remaining) || remaining === 0 || counts.length < 2 ||
    coordinates.length === 0 || coordinates.length > 10 || coordinates.length !== units.length || units.length !== capacities.length ||
    new Set(coordinates).size !== coordinates.length || !coordinates.every((axis) => integer(axis) && axis < fixedAttributes.length) ||
    !units.every((value) => integer(value) && value > 0) || !capacities.every((value) => integer(value) && value <= remaining) ||
    !fixedAttributes.every(integer)) return false;
  const keys = new Set<string>();
  for (const count of counts) {
    check();
    if (!Array.isArray(count) || count.length !== capacities.length || !count.every((value, axis) => integer(value) && value <= capacities[axis]!) ||
      count.reduce((sum, value) => sum + BigInt(value), 0n) !== BigInt(remaining)) return false;
    const key = count.join(",");
    if (keys.has(key)) return false;
    keys.add(key);
  }
  const complete = boundedMateriaCounts(capacities, remaining, check);
  return complete.length === keys.size && complete.every((count) => keys.has(count.join(",")));
}

/** Integral bipartite flow: selected families -> attribute totals. */
export function restoreMateriaCounts(families: readonly MateriaCountFamily[], totals: readonly number[], check: () => void = () => {}): number[][] {
  if (!totals.every(integer) || families.some((family) => family.capacities.length !== totals.length)) throw new Error("T54 flow domain invalid");
  const sink = 1 + families.length + totals.length;
  const graph: { to: number; reverse: number; capacity: number }[][] = Array.from({ length: sink + 1 }, () => []);
  const edge = (from: number, to: number, capacity: number) => {
    const forward = { to, reverse: graph[to]!.length, capacity };
    const backward = { to: from, reverse: graph[from]!.length, capacity: 0 };
    graph[from]!.push(forward); graph[to]!.push(backward);
    return forward;
  };
  const links = families.map((family, index) => {
    edge(0, index + 1, family.remaining);
    return family.capacities.map((capacity, axis) => edge(index + 1, 1 + families.length + axis, capacity));
  });
  totals.forEach((total, axis) => edge(1 + families.length + axis, sink, total));
  const required = safe(families.reduce((sum, family) => sum + BigInt(family.remaining), 0n));
  if (totals.reduce((sum, value) => sum + BigInt(value), 0n) !== BigInt(required)) throw new Error("T54 flow total mismatch");
  let flow = 0;
  while (flow < required) {
    check();
    const parents: ({ from: number; index: number } | undefined)[] = new Array(graph.length);
    const queue = [0];
    for (let head = 0; head < queue.length && parents[sink] === undefined; head++) {
      const from = queue[head]!;
      graph[from]!.forEach((entry, index) => {
        check();
        if (entry.capacity > 0 && entry.to !== 0 && parents[entry.to] === undefined) {
          parents[entry.to] = { from, index }; queue.push(entry.to);
        }
      });
    }
    if (parents[sink] === undefined) throw new Error("T54 Hall flow reconstruction failed");
    let amount = required - flow;
    for (let node = sink; node !== 0;) { const parent = parents[node]!; amount = Math.min(amount, graph[parent.from]![parent.index]!.capacity); node = parent.from; }
    for (let node = sink; node !== 0;) {
      const parent = parents[node]!;
      const forward = graph[parent.from]![parent.index]!;
      forward.capacity -= amount; graph[node]![forward.reverse]!.capacity += amount; node = parent.from;
    }
    flow += amount;
  }
  return links.map((row, index) => row.map((entry, axis) => families[index]!.capacities[axis]! - entry.capacity));
}

export type MateriaFamilyProjection = { request: LinearMipRequest; statistics: MateriaFamilyProjectionStatistics;
  expandSolution: (solution: LinearMipSolution) => LinearMipSolution };

/** T54: exact request-local projection; incompatible families retain every column. */
export function prepareMateriaFamilyProjection(request: LinearMipRequest, limits: Limits = {}): MateriaFamilyProjection | undefined {
  const suppliedFamilies = request.materiaFamilies;
  if (!Array.isArray(suppliedFamilies) || !suppliedFamilies.length) return undefined;
  const families: readonly MateriaModelFamily[] = suppliedFamilies;
  const started = performance.now();
  const statistics: MateriaFamilyProjectionStatistics = { eligibleFamilies: 0, rejectedFamilies: 0, familyPoints: 0,
    pools: 0, hallRows: 0, variablesRemoved: 0, originalVariables: request.variables.length, solverVariables: request.variables.length,
    preparationMs: 0, reconstructionMs: 0 };
  const publish = () => { statistics.preparationMs = performance.now() - started; request.onMateriaFamilyProjection?.({ ...statistics }); };
  let points = 0;
  const check = () => {
    throwIfCancelled(request.isCancelled);
    if (++points > (limits.maxPoints ?? 200_000)) throw new Abandon("work-budget");
    if (performance.now() - started >= (limits.maxMs ?? 100)) throw new Abandon("time-budget");
  };
  try {
    check();
    const bounds = new Map(request.variables.map((bound) => [bound.name, bound]));
    if (bounds.size !== request.variables.length) throw new Abandon("duplicate-variable");
    const binaries = new Set(request.binaryVariables);
    const rows = new Map(request.rows.map((row, index) => [row, index]));
    if (rows.size !== request.rows.length) throw new Abandon("duplicate-row-identity");
    const seen = new Set<string>();
    const accepted: { family: MateriaModelFamily; mode: string; raw: Map<LinearMipRow, number>; key: string }[] = [];
    for (const family of families) {
      if (family === null || typeof family !== "object" || !Array.isArray(family.members) || !Array.isArray(family.slotVariables) ||
        !Array.isArray(family.rawRows)) { statistics.rejectedFamilies++; continue; }
      statistics.familyPoints += Array.isArray(family.counts) ? family.counts.length : 0;
      let valid = validMateriaCountFamily(family, check) && family.members.length === family.counts.length &&
        new Set(family.members).size === family.members.length && new Set(family.slotVariables).size === family.slotVariables.length &&
        family.rawRows.length === family.fixedAttributes.length && new Set(family.rawRows).size === family.rawRows.length;
      const oneHot = family.oneHotRow;
      valid &&= rows.has(oneHot) && oneHot.sense === "=" && oneHot.rhs === 1 && oneHot.terms.size === family.slotVariables.length &&
        family.slotVariables.every((name) => oneHot.terms.get(name) === 1 && binaries.has(name) && bounds.get(name)?.min === 0 && bounds.get(name)?.max === 1);
      valid &&= family.members.every((name) => family.slotVariables.includes(name) && !seen.has(name) &&
        (request.objective.get(name) ?? 0) === 0 && binaries.has(name) && bounds.get(name)?.min === 0 && bounds.get(name)?.max === 1);
      const raw = new Map<LinearMipRow, number>();
      family.rawRows.forEach((row, axis) => raw.set(row, axis));
      valid &&= family.rawRows.every((row) => rows.has(row) && row.sense === "=" && row.rhs === 0);
      if (valid) for (const row of request.rows) {
        check();
        const axis = raw.get(row);
        if (axis === undefined) {
          const coefficient: number = row.terms.get(family.members[0]!) ?? 0;
          if (!Number.isSafeInteger(coefficient) || !family.members.every((name) => (row.terms.get(name) ?? 0) === coefficient)) { valid = false; break; }
        } else {
          for (let member = 0; member < family.members.length; member++) {
            check();
            let value = BigInt(family.fixedAttributes[axis]!);
            family.coordinates.forEach((coordinate, stat) => { if (coordinate === axis) value += BigInt(family.units[stat]!) * BigInt(family.counts[member]![stat]!); });
            if (!Number.isSafeInteger(row.terms.get(family.members[member]!) ?? 0) || BigInt(row.terms.get(family.members[member]!) ?? 0) !== -value) { valid = false; break; }
          }
          if (!valid) break;
        }
      }
      if (!valid) { statistics.rejectedFamilies++; continue; }
      family.members.forEach((name) => seen.add(name));
      const mode = `t54_x_${accepted.length}`;
      if (bounds.has(mode)) throw new Abandon("variable-name-collision");
      // Every actual row identity (including zero unit coefficients) belongs to
      // the observation scope. Quotas never migrate to an unobserved raw block.
      const key = JSON.stringify([family.grade, family.rawRows.map((row, axis) => [rows.get(row),
        family.coordinates.map((coordinate, stat) => coordinate === axis ? family.units[stat] : 0)]), family.coordinates]);
      accepted.push({ family, mode, raw, key });
    }
    statistics.eligibleFamilies = accepted.length;
    const groups = new Map<string, typeof accepted>();
    for (const entry of accepted) { const pool = groups.get(entry.key) ?? []; pool.push(entry); groups.set(entry.key, pool); }
    const pools = [...groups.values()].filter((pool) => pool.reduce((sum, entry) => sum + entry.family.members.length - 1, 0) > pool[0]!.family.coordinates.length);
    const installed = pools.flat();
    if (!installed.length) { statistics.skipReason = "no-variable-reduction"; publish(); return undefined; }
    const removed = new Set(installed.flatMap(({ family }) => [...family.members]));
    const variables = request.variables.filter(({ name }) => !removed.has(name));
    const binaryVariables = request.binaryVariables.filter((name) => !removed.has(name));
    const integerVariables = request.integerVariables.filter((name) => !removed.has(name));
    const termsByRow = request.rows.map((row) => new Map([...row.terms].filter(([name]) => !removed.has(name))));
    const newRows: LinearMipRow[] = [];
    const poolCoordinates: { entries: typeof accepted; totals: string[] }[] = [];
    const put = (terms: Map<string, number>, name: string, coefficient: bigint) => {
      const value = safe(BigInt(terms.get(name) ?? 0) + coefficient);
      if (value === 0) terms.delete(name); else terms.set(name, value);
    };
    for (const { family, mode, raw } of installed) {
      variables.push({ name: mode, min: 0, max: 1 }); binaryVariables.push(mode);
      request.rows.forEach((row, index) => {
        const axis = raw.get(row);
        const coefficient = axis === undefined ? (row.terms.get(family.members[0]!) ?? 0) : -family.fixedAttributes[axis]!;
        put(termsByRow[index]!, mode, BigInt(coefficient));
      });
    }
    for (const [poolIndex, entries] of pools.entries()) {
      check();
      const prototype = entries[0]!.family;
      const totals = prototype.coordinates.map((_, axis) => `t54_y_${poolIndex}_${axis}`);
      totals.forEach((name, axis) => {
        if (bounds.has(name)) throw new Abandon("variable-name-collision");
        const maximum = safe(entries.reduce((sum, { family }) => sum + BigInt(Math.min(family.remaining, family.capacities[axis]!)), 0n));
        variables.push({ name, min: 0, max: maximum }); integerVariables.push(name);
        const rawRow = prototype.rawRows[prototype.coordinates[axis]!]!;
        put(termsByRow[rows.get(rawRow)!]!, name, -BigInt(prototype.units[axis]!));
      });
      const total = new Map(totals.map((name) => [name, 1]));
      for (const { family, mode } of entries) put(total, mode, -BigInt(family.remaining));
      newRows.push({ name: `t54_total_${poolIndex}`, terms: total, sense: "=", rhs: 0 });
      for (let mask = 1; mask < 2 ** totals.length - 1; mask++) {
        check();
        if (++statistics.hallRows > (limits.maxHallRows ?? 4096)) throw new Abandon("subset-budget");
        const terms = new Map(totals.flatMap((name, axis) => mask & 2 ** axis ? [[name, 1] as const] : []));
        for (const { family, mode } of entries) {
          const capacity = family.capacities.reduce((sum, value, axis) => sum + (mask & 2 ** axis ? BigInt(value) : 0n), 0n);
          put(terms, mode, -BigInt(Math.min(family.remaining, safe(capacity))));
        }
        newRows.push({ name: `t54_hall_${poolIndex}_${mask}`, terms, sense: "<=", rhs: 0 });
      }
      poolCoordinates.push({ entries, totals });
    }
    const transformedRows: LinearMipRow[] = [...request.rows.map((row, index) => ({ ...row, terms: termsByRow[index]! })), ...newRows];
    const objective = new Map([...request.objective].filter(([name]) => !removed.has(name)));
    let solutionHint: Map<string, number> | undefined;
    if (request.solutionHint !== undefined) {
      solutionHint = new Map([...request.solutionHint].filter(([name]) => !removed.has(name)));
      let complete = true;
      for (const { entries, totals } of poolCoordinates) {
        const sums = totals.map(() => 0n);
        for (const { family, mode } of entries) {
          if (!family.members.every((name) => request.solutionHint!.has(name))) { complete = false; continue; }
          const values = family.members.map((name) => request.solutionHint!.get(name)!);
          if (!values.every((value) => value === 0 || value === 1)) throw new Abandon("invalid-hint");
          solutionHint.set(mode, values.reduce<number>((sum, value) => sum + value, 0));
          values.forEach((value, member) => { if (value) sums.forEach((sum, axis) => { sums[axis] = sum + BigInt(family.counts[member]![axis]!); }); });
        }
        if (entries.every(({ family }) => family.members.every((name) => request.solutionHint!.has(name)))) totals.forEach((name, axis) => solutionHint!.set(name, safe(sums[axis]!)));
      }
      if (complete && request.variables.every(({ name }) => request.solutionHint!.has(name))) {
        try {
          validateMipSolution(request.rows, request.variables, Object.fromEntries([...request.solutionHint].map(([name, Primal]) => [name, { Primal }])));
          validateMipSolution(transformedRows, variables, Object.fromEntries([...solutionHint].map(([name, Primal]) => [name, { Primal }])));
        } catch {
          // A heuristic hint can become stale after a strict/no-good cut.
          solutionHint = undefined;
        }
      }
    }
    statistics.pools = pools.length;
    statistics.variablesRemoved = request.variables.length - variables.length;
    statistics.solverVariables = variables.length;
    check(); publish();
    return { request: { ...request, objective, rows: transformedRows, variables, binaryVariables, integerVariables,
      materiaFamilies: undefined, solutionHint }, statistics,
    expandSolution(solution) {
      if (solution.Status !== "Optimal") return solution;
      const restoreStarted = performance.now();
      throwIfCancelled(request.isCancelled);
      validateMipSolution(transformedRows, variables, solution.Columns);
      const Columns = { ...solution.Columns };
      const value = (name: string) => Math.round(Columns[name]?.Primal ?? 0);
      for (const { entries, totals } of poolCoordinates) {
        const selected = entries.filter(({ mode }) => value(mode) === 1);
        const counts = restoreMateriaCounts(selected.map(({ family }) => family), totals.map(value), () => throwIfCancelled(request.isCancelled));
        for (const { family } of entries) for (const member of family.members) Columns[member] = { Primal: 0 };
        selected.forEach(({ family }, index) => {
          const member = family.counts.findIndex((count) => count.every((amount, axis) => amount === counts[index]![axis]));
          if (member < 0) throw new Error("T54 restored count has no original candidate");
          Columns[family.members[member]!] = { Primal: 1 };
        });
      }
      validateMipSolution(request.rows, request.variables, Columns);
      for (const { mode } of installed) delete Columns[mode];
      for (const { totals } of poolCoordinates) for (const name of totals) delete Columns[name];
      statistics.reconstructionMs += performance.now() - restoreStarted;
      request.onMateriaFamilyProjection?.({ ...statistics });
      return { ...solution, Columns };
    } };
  } catch (error) {
    if (!(error instanceof Abandon)) throw error;
    statistics.variablesRemoved = 0; statistics.solverVariables = request.variables.length;
    statistics.pools = 0; statistics.hallRows = 0; statistics.skipReason = error.message;
    publish(); return undefined;
  }
}
