import type { LinearMipRow, LinearMipVariable } from "../linear-mip.ts";
import type { IntegerDamageFactors } from "../equipped-effects.ts";
import type { FactorClass } from "./types.ts";
import type { prepareExactMipModel } from "./model-preparation.ts";
import { exactProduct } from "./factor-model.ts";

type ProductionModel = NonNullable<Awaited<ReturnType<typeof prepareExactMipModel>>>;
type PreparedModel = Pick<ProductionModel, "groups" | "useDps" | "mainAttribute" | "detAttribute" |
  "tenAttribute" | "crtAttribute" | "dhtAttribute" | "speedAttribute"> & {
    model: Pick<ProductionModel["model"], "finalVariables" | "gcdChoiceRanges" | "gcdChoiceVariables">;
  };
type CoverLimits = {
  halfCombinations: number;
  memoryBytes: number;
  maxWork: number;
  localMs: number;
  maxTargets: number;
};
type CoverOptions = {
  prepared: PreparedModel;
  gcdChoiceAttribute?: number;
  rows: readonly LinearMipRow[];
  variables: readonly LinearMipVariable[];
  incumbent: IntegerDamageFactors;
  qMinimum: number;
  /** Proven optimum of the preceding original surrogate maximization. */
  qMaximum: number;
  checkActive: () => void;
  limits?: Partial<CoverLimits>;
};
export type StrictImprovementCover =
  | { status: "covered"; rows: LinearMipRow[]; targetCount: number }
  | { status: "skipped"; reason: string };

const damageNames = ["weapon", "main", "det", "ten", "crt", "dht"] as const;
const names = [...damageNames, "gcd"] as const;
const defaultLimits: CoverLimits = {
  halfCombinations: 2_000_000,
  memoryBytes: 32 * 1024 * 1024,
  maxWork: 100_000_000,
  localMs: 1800,
  maxTargets: 8,
};
type CoverGroup = { index: number; classes: FactorClass[] };
type HalfTable = { groups: CoverGroup[]; q: Float64Array };
class CoverUnavailable extends Error {}

/**
 * Cover every strictly improving damage signature in the proven q band.
 * This consumes the production model directly: class intervals are tied to its
 * original targets, and pure selector rows are checked with BigInt arithmetic.
 * Other equipment/food rows are relaxed here and remain in the native request.
 * The projected rows may retain non-improving cross-products; infeasibility is
 * nevertheless sufficient to exclude every strict improvement. Empty covers
 * deliberately add no rows and leave completion to the original proof path.
 */
export function prepareStrictImprovementCover(options: CoverOptions): StrictImprovementCover {
  const startedAt = performance.now();
  const limits = { ...defaultLimits, ...options.limits };
  let work = 0;
  let callerFailed = false;
  const need = (condition: boolean, reason: string): void => {
    if (!condition) throw new CoverUnavailable(reason);
  };
  const check = () => {
    // The caller owns cancellation and the overall deadline. Never turn its
    // exception into an optional-strategy fallback.
    try { options.checkActive(); } catch (error) { callerFailed = true; throw error; }
    need(performance.now() - startedAt < limits.localMs, "local time budget");
    need(work <= limits.maxWork, "work budget");
  };
  const tick = () => { if ((++work & 1023) === 0) check(); };
  try {
    for (const limit of Object.values(limits)) need(Number.isSafeInteger(limit) && limit > 0, "invalid budget");
    need(limits.halfCombinations <= defaultLimits.halfCombinations && limits.maxTargets <= 8, "unsupported budget");
    check();
    const { prepared, rows, variables, qMinimum, qMaximum } = options;
    const { model, groups } = prepared;
    need(!prepared.useDps, "DPS objective");
    need(Number.isSafeInteger(qMinimum) && Number.isSafeInteger(qMaximum) && qMinimum <= qMaximum, "invalid q band");
    need(groups.length === names.length && new Set(groups.map((group) => group.name)).size === names.length &&
      names.every((name) => groups.some((group) => group.name === name)), "unsupported factor groups");
    let metadataBytes = variables.length * 128 + rows.length * 96;
    for (const group of groups) metadataBytes += group.classes.length * 192;
    need(metadataBytes <= limits.memoryBytes, "metadata memory budget");
    const bounds = new Map<string, LinearMipVariable>();
    for (const bound of variables) {
      tick();
      need(Number.isSafeInteger(bound.min) && Number.isSafeInteger(bound.max) && bound.min <= bound.max, "unsupported bounds");
      bounds.set(bound.name, bound);
    }
    const targetForGroup = new Map<string, string | undefined>([
      ["weapon", "weapon_relative"],
      ...([
        ["main", prepared.mainAttribute], ["det", prepared.detAttribute], ["ten", prepared.tenAttribute],
        ["crt", prepared.crtAttribute], ["dht", prepared.dhtAttribute], ["gcd", prepared.speedAttribute],
      ] as const).map(([name, attribute]) => {
        const variable = attribute === undefined ? undefined : model.finalVariables[attribute];
        need(attribute === undefined || variable !== undefined, "missing original attribute target");
        return [name, variable] as const;
      }),
    ]);
    const selectors = new Set<string>();
    const orderedGroups = names.map((name) => groups.find((group) => group.name === name)!);
    let qMagnitude = 0n;
    const possible: CoverGroup[] = orderedGroups.map((group, index) => {
      need(group.classes.length > 0, "missing factor classes");
      const targetName = targetForGroup.get(group.name);
      const target = targetName === undefined ? undefined : bounds.get(targetName);
      need(targetName === undefined ? group.classes.length === 1 : target !== undefined, "missing original class target");
      const forced = group.classes.filter((entry) => (bounds.get(entry.variable)?.min ?? 0) > 0);
      let maximumMagnitude = 0;
      const classes = group.classes.filter((entry) => {
        tick();
        need(!selectors.has(entry.variable), "duplicate class identity");
        selectors.add(entry.variable);
        need([entry.min, entry.max, entry.q, entry.value].every(Number.isSafeInteger) &&
          entry.min >= 0 && entry.min <= entry.max && entry.value > 0 && entry.auxiliary === undefined,
        "unsupported factor class");
        need(group.name !== "gcd" || entry.q === 0, "nonzero damage GCD q");
        maximumMagnitude = Math.max(maximumMagnitude, Math.abs(entry.q));
        const bound = bounds.get(entry.variable);
        need(bound !== undefined && bound.min >= 0 && bound.max <= 1, "missing original selector");
        if (bound!.max < 1 || forced.some((other) => other !== entry)) return false;
        const minimum = Math.max(entry.min, target?.min ?? entry.min);
        const maximum = Math.min(entry.max, target?.max ?? entry.max);
        if (minimum > maximum) return false;
        // These ranges and choice columns are emitted together by the original
        // attribute model. Keep the union; never fill gaps between GCD choices.
        if (group.name === "gcd" && model.gcdChoiceRanges.length > 0 &&
            options.gcdChoiceAttribute !== undefined && options.gcdChoiceAttribute === prepared.speedAttribute) {
          return model.gcdChoiceRanges.some((range, choice) => {
            tick();
            if (Math.max(minimum, range.min) > Math.min(maximum, range.max)) return false;
            return model.gcdChoiceVariables.every((variable, other) => {
              tick();
              const choiceBound = bounds.get(variable);
              need(choiceBound !== undefined, "missing original GCD choice");
              const value = other === choice ? 1 : 0;
              return value >= choiceBound!.min && value <= choiceBound!.max;
            });
          });
        }
        return true;
      });
      qMagnitude += BigInt(maximumMagnitude);
      return { index, classes };
    });
    const safe = BigInt(Number.MAX_SAFE_INTEGER);
    need(qMagnitude + BigInt(Math.max(Math.abs(qMinimum), Math.abs(qMaximum))) <= safe, "unsafe q arithmetic");
    const incumbentValues = [options.incumbent.weaponDamage, options.incumbent.mainStat,
      options.incumbent.determination, options.incumbent.tenacity, options.incumbent.critical, options.incumbent.directHit];
    need(incumbentValues.every((value) => Number.isSafeInteger(value) && value > 0), "unsupported incumbent");
    const incumbent = exactProduct(options.incumbent);
    const pureRows: { sense: LinearMipRow["sense"]; rhs: bigint; terms: Map<string, bigint> }[] = [];
    for (const row of rows) {
      tick();
      let pure = true;
      for (const [variable, coefficient] of row.terms) {
        tick();
        if (coefficient !== 0 && !selectors.has(variable)) { pure = false; break; }
      }
      if (!pure) continue;
      need(Number.isSafeInteger(row.rhs), "unsafe selector row");
      const terms = new Map<string, bigint>();
      for (const [variable, coefficient] of row.terms) {
        tick();
        need(Number.isSafeInteger(coefficient), "unsafe selector coefficient");
        if (coefficient !== 0) terms.set(variable, BigInt(coefficient));
      }
      metadataBytes += terms.size * 80;
      need(metadataBytes <= limits.memoryBytes, "selector row memory budget");
      pureRows.push({ terms, sense: row.sense, rhs: BigInt(row.rhs) });
    }
    const empty = (): StrictImprovementCover => ({ status: "covered", rows: [], targetCount: 0 });
    if (possible.some((group) => group.classes.length === 0)) { check(); return empty(); }
    const damage = possible.slice(0, 6);
    let partition: { left: CoverGroup[]; right: CoverGroup[]; leftSize: number; rightSize: number; total: bigint } | undefined;
    for (let mask = 1; mask < 63; mask += 2) {
      tick();
      let left = damage.filter((_, index) => (mask & (1 << index)) !== 0);
      let right = damage.filter((_, index) => (mask & (1 << index)) === 0);
      let a = left.reduce((count, group) => count * BigInt(group.classes.length), 1n);
      let b = right.reduce((count, group) => count * BigInt(group.classes.length), 1n);
      if (a > b) { [a, b] = [b, a]; [left, right] = [right, left]; }
      if (b > BigInt(limits.halfCombinations)) continue;
      // q arrays, rank order and conservative sorting scratch.
      if (16n * a + 8n * b + BigInt(metadataBytes) > BigInt(limits.memoryBytes)) continue;
      if (partition === undefined || a + b < partition.total) {
        partition = { left, right, leftSize: Number(a), rightSize: Number(b), total: a + b };
      }
    }
    need(partition !== undefined, "half-table or memory budget");
    const enumerate = (halfGroups: CoverGroup[], size: number): HalfTable => {
      const q = new Float64Array(size);
      let rank = 0;
      const visit = (depth: number, sum: number): void => {
        tick();
        if (depth === halfGroups.length) { q[rank++] = sum; return; }
        for (const entry of halfGroups[depth]!.classes) visit(depth + 1, sum + entry.q);
      };
      visit(0, 0);
      return { groups: halfGroups, q };
    };
    const left = enumerate(partition!.left, partition!.leftSize);
    const right = enumerate(partition!.right, partition!.rightSize);
    const order = new Uint32Array(left.q.length);
    for (let index = 0; index < order.length; index++) { tick(); order[index] = index; }
    check();
    order.sort((a, b) => { tick(); return left.q[a]! - left.q[b]! || a - b; });
    check();
    const boundary = (q: number, strict: boolean): number => {
      let lo = 0, hi = order.length;
      while (lo < hi) {
        tick();
        const mid = lo + Math.floor((hi - lo) / 2);
        const value = left.q[order[mid]!]!;
        if (strict ? value <= q : value < q) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const selected: FactorClass[] = new Array(names.length);
    const decode = (table: HalfTable, rank: number): void => {
      for (let index = table.groups.length - 1; index >= 0; index--) {
        tick();
        const group = table.groups[index]!;
        selected[group.index] = group.classes[rank % group.classes.length]!;
        rank = Math.floor(rank / group.classes.length);
      }
    };
    const signatures: string[][] = [];
    for (let rank = 0; rank < right.q.length; rank++) {
      tick();
      const q = right.q[rank]!;
      const lo = boundary(qMinimum - q, false), hi = boundary(qMaximum - q, true);
      for (let match = lo; match < hi; match++) {
        tick();
        decode(left, order[match]!);
        decode(right, rank);
        let product = 1n;
        for (let index = 0; index < 6; index++) product *= BigInt(selected[index]!.value);
        if (product <= incumbent) continue;
        for (const gcd of possible[6]!.classes) {
          tick();
          selected[6] = gcd;
          const passes = pureRows.every((row) => {
            let lhs = 0n;
            for (const entry of selected) { tick(); lhs += row.terms.get(entry.variable) ?? 0n; }
            return row.sense === "=" ? lhs === row.rhs : row.sense === "<=" ? lhs <= row.rhs : lhs >= row.rhs;
          });
          if (!passes) continue;
          need(signatures.length < limits.maxTargets, "too many strict-improvement targets");
          signatures.push(selected.map((entry) => entry.variable));
        }
      }
    }
    check();
    if (signatures.length === 0) return empty();
    const coverRows = orderedGroups.map((group, index): LinearMipRow => {
      const name = `strict_improvement_cover_${group.name}`;
      need(!rows.some((row) => row.name === name), "cover row collision");
      const retained = new Set(signatures.map((signature) => signature[index]!));
      return { name, terms: new Map(group.classes.filter((entry) => retained.has(entry.variable))
        .map((entry) => [entry.variable, 1])), sense: ">=", rhs: 1 };
    });
    check();
    return { status: "covered", rows: coverRows, targetCount: signatures.length };
  } catch (error) {
    if (callerFailed) throw error;
    // A partial enumeration, unsupported numeric domain or failed allocation
    // cannot justify any row. The caller submits its unchanged original model.
    return { status: "skipped", reason: error instanceof Error ? error.message : String(error) };
  }
}
