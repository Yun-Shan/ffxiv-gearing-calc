import { throwIfCancelled } from "../cancellation.ts";
import { hasCanonicalEvaluatorCandidateUpperBound } from "../exact-mip-candidate-upper-bound.ts";
import { addRows } from "../core/model-builder.ts";
import type { ModelRow } from "../core/model-types.ts";
import { validateMipSolution } from "../core/solution-validation.ts";
import { getAttributeVector } from "./attributes.ts";
import type { GreedyMipStart } from "./initial-solution.ts";
import type { prepareExactMipModel } from "./model-preparation.ts";
import type { ExactMipOptions, FactorClass, FoodProductBoundStatistics } from "./types.ts";

type PreparedModel = NonNullable<Awaited<ReturnType<typeof prepareExactMipModel>>>;
type NonCrtName = "weapon" | "main" | "det" | "ten" | "dht";
type FactorName = NonCrtName | "crt";
export type SupportPoint = { c: number; p: number };
type Work = (amount?: number) => void;
type FoodParameter = { base: number; numerator: number; denominator: number; cap: number };
type FactorInterval = Pick<FactorClass, "min" | "max" | "value">;
type BoundInput = {
  slots: readonly (readonly Record<string, number>[])[];
  foods: readonly Record<string, FoodParameter | undefined>[];
  classes: Record<FactorName, readonly FactorInterval[]>;
  seedFactors: Record<FactorName, number>;
  maximumWeaponAuxiliary?: number;
  maximumTenacityUnfrozen?: boolean;
  allowedSpeedsByFood?: readonly (readonly number[])[];
};
type BoundLimits = { maxWork?: number; maxPoints?: number; deadline?: number; cancelled?: () => boolean };
type KernelStatistics = { work: number; fibers: number; peakPoints: number; foods: number; nonconstant: number };
type AffineCertificate = { name: string; weight: bigint; intercept: bigint; anchor: number };
type KernelResult = { status: "complete"; products: bigint[]; certificates: AffineCertificate[]; statistics: KernelStatistics; elapsedMs: number }
  | { status: "skipped"; reason: string; statistics: KernelStatistics };

const SCALE = 65_536n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const product = (factors: Record<FactorName, number>) => (["weapon", "main", "det", "ten", "dht", "crt"] as const)
  .reduce((value, name) => value * BigInt(factors[name]), 1n);

export class Abandon extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
const safe = (value: bigint) => {
  if (value < 0n || value > MAX_SAFE) throw new Abandon("unsafe-arithmetic");
  return Number(value);
};

export function upperChain(points: readonly SupportPoint[], work: Work = () => {}) {
  const sorted = [...points].sort((a, b) => {
    work();
    return a.c - b.c || b.p - a.p;
  });
  const chain: SupportPoint[] = [];
  for (const point of sorted) {
    work();
    if (![point.c, point.p].every((value) => Number.isSafeInteger(value) && value >= 0))
      throw new Abandon("unsafe-arithmetic");
    if (chain.at(-1)?.c === point.c) continue;
    while (chain.length >= 2) {
      work();
      const a = chain.at(-2)!;
      const b = chain.at(-1)!;
      const cross = BigInt(b.c - a.c) * BigInt(point.p - b.p) -
        BigInt(b.p - a.p) * BigInt(point.c - b.c);
      if (cross < 0n) break;
      chain.pop();
    }
    chain.push(point);
  }
  return chain;
}

export function minkowski(a: readonly SupportPoint[], b: readonly SupportPoint[], work: Work = () => {}) {
  if (!a.length || !b.length) return [];
  let i = 0;
  let j = 0;
  const points: SupportPoint[] = [];
  const append = () => {
    work();
    points.push({ c: safe(BigInt(a[i].c) + BigInt(b[j].c)), p: safe(BigInt(a[i].p) + BigInt(b[j].p)) });
  };
  append();
  while (i + 1 < a.length || j + 1 < b.length) {
    work();
    if (i + 1 === a.length) j++;
    else if (j + 1 === b.length) i++;
    else {
      const difference = BigInt(a[i + 1].p - a[i].p) * BigInt(b[j + 1].c - b[j].c) -
        BigInt(b[j + 1].p - b[j].p) * BigInt(a[i + 1].c - a[i].c);
      if (difference >= 0n) i++;
      if (difference <= 0n) j++;
    }
    append();
  }
  return points;
}

export function maxProfit(chain: readonly SupportPoint[], lower: number, upper: number, work: Work = () => {}) {
  if (!chain.length || lower > upper || upper < chain[0].c || lower > chain.at(-1)!.c) return undefined;
  lower = Math.max(lower, chain[0].c);
  upper = Math.min(upper, chain.at(-1)!.c);
  let result: bigint | undefined;
  const retain = (value: bigint) => { if (result === undefined || value > result) result = value; };
  for (let index = 0; index < chain.length; index++) {
    work();
    const a = chain[index];
    if (a.c >= lower && a.c <= upper) retain(BigInt(a.p));
    const b = chain[index + 1];
    if (!b) continue;
    for (const x of [lower, upper]) {
      if (x <= a.c || x >= b.c) continue;
      const width = BigInt(b.c - a.c);
      retain(ceil(BigInt(a.p) * width + BigInt(b.p - a.p) * BigInt(x - a.c), width));
    }
  }
  return result;
}

const exactBonus = (raw: number, parameter: FoodParameter | undefined) => {
  if (!parameter) return 0;
  const value = (BigInt(raw) + BigInt(parameter.base)) * BigInt(parameter.numerator) / BigInt(parameter.denominator);
  return Number(value < BigInt(parameter.cap) ? value : BigInt(parameter.cap));
};

/** Input factor classes must cover every actual final integer coordinate. */
export function completeProductBounds(input: BoundInput, limits: BoundLimits = {}): KernelResult {
  const started = performance.now();
  const statistics = { work: 0, fibers: 0, peakPoints: 0, foods: 0, nonconstant: 0 };
  const maxWork = limits.maxWork ?? 2_000_000;
  const maxPoints = limits.maxPoints ?? 200_000;
  const deadline = limits.deadline ?? Infinity;
  const work: Work = (amount = 1) => {
    statistics.work += amount;
    if (limits.cancelled?.()) { const error = new Error("cancelled"); error.name = "AbortError"; throw error; }
    if (statistics.work > maxWork) throw new Abandon("work-budget");
    if (performance.now() >= deadline) throw new Abandon("time-budget");
  };
  const memory = (size: number) => {
    statistics.peakPoints = Math.max(statistics.peakPoints, size);
    if (size > maxPoints) throw new Abandon("memory-budget");
  };
  try {
    work(0);
    if (input.maximumTenacityUnfrozen) return { status: "skipped", reason: "maximum-tenacity-unfrozen", statistics };
    if (!Number.isSafeInteger(input.maximumWeaponAuxiliary ?? 0) || (input.maximumWeaponAuxiliary ?? 0) < 0 ||
      !input.classes.crt?.length || input.classes.crt.some(({ min, max, value }) =>
        ![min, max, value].every(Number.isSafeInteger) || min < 0 || min > max || value < 1))
      throw new Abandon("invalid-domain");
    let constant = 1n;
    let anchors = 1n;
    let bias = 0n;
    const weights: Record<string, bigint> = {};
    const certificates: AffineCertificate[] = [];
    for (const name of ["weapon", "main", "det", "ten", "dht"] as const) {
      const classes = input.classes[name];
      const anchor = input.seedFactors[name];
      if (!Number.isSafeInteger(anchor) || anchor < 1 || !classes?.length || classes.some(({ min, max, value }) =>
        ![min, max, value].every(Number.isSafeInteger) || min < 0 || min > max || value < 1))
        throw new Abandon("invalid-domain");
      if (classes.every(({ value }) => value === classes[0].value)) {
        constant *= BigInt(classes[0].value);
        continue;
      }
      const first = classes[0];
      const last = classes.at(-1)!;
      const proposal = Math.round(Number(SCALE) * (last.value - first.value) / (anchor * (last.max - first.min)));
      const weight = BigInt(Number.isSafeInteger(proposal) && proposal >= 0 ? proposal : 0);
      let intercept: bigint | undefined;
      for (const entry of classes) {
        work();
        const needed = ceil(SCALE * BigInt(entry.value), BigInt(anchor)) - weight * BigInt(entry.min);
        if (intercept === undefined || needed > intercept) intercept = needed;
      }
      for (const entry of classes) {
        work();
        if ((weight * BigInt(entry.min) + intercept!) * BigInt(anchor) < SCALE * BigInt(entry.value))
          throw new Abandon("invalid-certificate");
      }
      weights[name] = weight;
      bias += intercept! + (name === "weapon" ? weight * BigInt(input.maximumWeaponAuxiliary ?? 0) : 0n);
      anchors *= BigInt(anchor);
      statistics.nonconstant++;
      certificates.push({ name, weight, intercept: intercept!, anchor });
    }
    // T11 covers every feasible food/speed pair. With nonnegative candidate
    // speeds, a prefix plus the remaining slot minima cannot exceed the largest
    // allowed raw speed and later return to a feasible fiber.
    let maximumAllowedSpeed: bigint | undefined;
    const suffixMinimumSpeeds = new Array<bigint>(input.slots.length + 1).fill(0n);
    if (input.allowedSpeedsByFood !== undefined) {
      if (input.allowedSpeedsByFood.length !== input.foods.length) throw new Abandon("invalid-domain");
      maximumAllowedSpeed = -1n;
      for (const speeds of input.allowedSpeedsByFood) for (const speed of speeds) {
        work();
        if (!Number.isSafeInteger(speed) || speed < 0) throw new Abandon("invalid-domain");
        if (BigInt(speed) > maximumAllowedSpeed) maximumAllowedSpeed = BigInt(speed);
      }
      for (let index = input.slots.length - 1; index >= 0; index--) {
        let minimum: number | undefined;
        for (const candidate of input.slots[index]!) {
          work();
          if (!Number.isSafeInteger(candidate.speed) || candidate.speed < 0) throw new Abandon("invalid-domain");
          if (minimum === undefined || candidate.speed < minimum) minimum = candidate.speed;
        }
        suffixMinimumSpeeds[index] = suffixMinimumSpeeds[index + 1]! + BigInt(minimum ?? 0);
      }
    }
    let fibers = new Map<number, SupportPoint[]>([[0, [{ c: 0, p: 0 }]]]);
    for (let slotIndex = 0; slotIndex < input.slots.length; slotIndex++) {
      const slot = input.slots[slotIndex]!;
      const slotFibers = new Map<number, SupportPoint[]>();
      let slotPointCount = 0;
      for (const candidate of slot) {
        work();
        if (!["weapon", "main", "det", "ten", "dht", "crt", "speed"].every((name) =>
          Number.isSafeInteger(candidate[name]) && candidate[name] >= 0)) throw new Abandon("invalid-domain");
        const speed = input.allowedSpeedsByFood ? candidate.speed : 0;
        const otherSlotsMinimum = suffixMinimumSpeeds[0]! -
          (suffixMinimumSpeeds[slotIndex]! - suffixMinimumSpeeds[slotIndex + 1]!);
        if (maximumAllowedSpeed !== undefined && BigInt(speed) + otherSlotsMinimum > maximumAllowedSpeed) continue;
        const p = safe(Object.entries(weights).reduce((sum, [name, weight]) => sum + weight * BigInt(candidate[name]), 0n));
        const points = slotFibers.get(speed) ?? [];
        points.push({ c: candidate.crt, p });
        memory(++slotPointCount);
        slotFibers.set(speed, points);
      }
      for (const [speed, points] of slotFibers) slotFibers.set(speed, upperChain(points, work));
      const next = new Map<number, SupportPoint[]>();
      const dirty = new Set<number>();
      let pending = 0;
      const compact = (speed: number) => {
        const points = next.get(speed)!;
        const hull = upperChain(points, work);
        pending += hull.length - points.length;
        next.set(speed, hull);
        dirty.delete(speed);
      };
      for (const [previousSpeed, previous] of fibers) for (const [speed, chain] of slotFibers) {
        work();
        const speedSum = BigInt(previousSpeed) + BigInt(speed);
        if (maximumAllowedSpeed !== undefined && speedSum + suffixMinimumSpeeds[slotIndex + 1]! > maximumAllowedSpeed) continue;
        const totalSpeed = safe(speedSum);
        const sum = minkowski(previous, chain, work);
        pending += sum.length;
        const old = next.get(totalSpeed);
        if (old) {
          for (const point of sum) old.push(point);
          dirty.add(totalSpeed);
          // Batch complete unions; taking their full hull discards no support.
          if (old.length >= 256) compact(totalSpeed);
        }
        else next.set(totalSpeed, sum);
        if (pending > maxPoints) {
          for (const speed of dirty) {
            compact(speed);
            if (pending <= maxPoints) break;
          }
        }
        // Count retained points, rather than all points generated before a
        // complete union was compacted. The original RSS guard still applies.
        memory(pending);
      }
      for (const speed of dirty) compact(speed);
      fibers = next;
    }
    statistics.fibers = fibers.size;
    const products: bigint[] = [];
    const n = BigInt(statistics.nonconstant);
    const denominator = n ? (n * SCALE) ** n : 1n;
    for (let index = 0; index < input.foods.length; index++) {
      work();
      const food = input.foods[index];
      let foodBias = bias;
      for (const [name, weight] of Object.entries(weights)) foodBias += weight * BigInt(food[name]?.cap ?? 0);
      const allowed = input.allowedSpeedsByFood ? new Set(input.allowedSpeedsByFood[index]) : undefined;
      const points: SupportPoint[] = [];
      for (const [speed, chain] of fibers) {
        if (allowed && !allowed.has(speed)) continue;
        for (const point of chain) points.push(point);
        memory(points.length);
      }
      const chain = upperChain(points, work);
      let maximum = 0n;
      if (chain.length) {
        const finalCrt = (raw: number) => { work(); return safe(BigInt(raw) + BigInt(exactBonus(raw, food.crt))); };
        const lowerEndpoint = (target: number) => {
          let lower = chain[0].c;
          let upper = chain.at(-1)!.c;
          if (finalCrt(upper) < target) return undefined;
          while (lower < upper) {
            const middle = lower + Math.floor((upper - lower) / 2);
            if (finalCrt(middle) >= target) upper = middle;
            else lower = middle + 1;
          }
          return lower;
        };
        const upperEndpoint = (target: number) => {
          let lower = chain[0].c;
          let upper = chain.at(-1)!.c;
          if (finalCrt(lower) > target) return undefined;
          while (lower < upper) {
            const middle = lower + Math.ceil((upper - lower) / 2);
            if (finalCrt(middle) <= target) lower = middle;
            else upper = middle - 1;
          }
          return lower;
        };
        for (const entry of input.classes.crt) {
          work();
          const lower = lowerEndpoint(entry.min);
          const upper = upperEndpoint(entry.max);
          if (lower === undefined || upper === undefined || lower > upper) continue;
          const support = maxProfit(chain, lower, upper, work);
          if (support === undefined) continue;
          const sum = support + foodBias;
          const numerator = n === 0n ? constant * BigInt(entry.value) : sum <= 0n ? 0n :
            constant * anchors * BigInt(entry.value) * sum ** n;
          const bound = ceil(numerator, denominator);
          if (bound > maximum) maximum = bound;
        }
      }
      products.push(maximum);
      statistics.foods++;
    }
    work(0);
    return { status: "complete", products, certificates, statistics, elapsedMs: performance.now() - started };
  } catch (error) {
    if (error instanceof Abandon) return { status: "skipped", reason: error.reason, statistics };
    throw error;
  }
}

export type FoodProductBoundResult = {
  rows: readonly ModelRow[];
  upperProducts?: readonly bigint[];
  gcdLowerBound?: number;
  statistics: FoodProductBoundStatistics;
};

/** T34 optional certificate: all returned rows are atomic and strictly incumbent-safe. */
export function prepareFoodProductBound(
  options: ExactMipOptions,
  prepared: PreparedModel,
  incumbent: GreedyMipStart | undefined,
  limits: Omit<BoundLimits, "cancelled"> = {},
): FoodProductBoundResult {
  const startedAt = performance.now();
  const statistics: FoodProductBoundStatistics = {
    execution: "skipped", elapsedMs: 0, work: 0, speedFibers: 0,
    peakSupportPoints: 0, foodsEvaluated: 0, foodsExcluded: 0, nonConstantFactors: 0,
  };
  const skip = (skipReason: string): FoodProductBoundResult => {
    statistics.skipReason = skipReason;
    statistics.elapsedMs = performance.now() - startedAt;
    return { rows: [], statistics };
  };
  const deadline = limits.deadline ?? startedAt + 500;
  const maxWork = limits.maxWork ?? 2_000_000;
  const checkpoint = () => {
    throwIfCancelled(options.isCancelled);
    if (performance.now() >= deadline) throw new Abandon("time-budget");
    if (statistics.work > maxWork) throw new Abandon("work-budget");
  };
  const { model, groups } = prepared;
  try {
    checkpoint();
    if (!Number.isSafeInteger(maxWork) || maxWork < 1 ||
      (limits.maxPoints !== undefined && (!Number.isSafeInteger(limits.maxPoints) || limits.maxPoints < 1)))
      return skip("invalid-budget");
    if (!hasCanonicalEvaluatorCandidateUpperBound(options)) return skip("untrusted-evaluator");
    if (options.equipmentAttributeExtractor !== undefined) return skip("custom-attributes");
    if (options.constraints?.maxToughnessMode === true) return skip("maximum-toughness-not-frozen");
    if (model.resistanceAllocationVariables.length > 0) return skip("variable-attributes");
    if (options.foods.length < 2) return skip("no-food-choice");
    if (incumbent === undefined) return skip("no-feasible-incumbent");
    const constrainedSpeed = options.constraints !== undefined &&
      [options.constraints.gcd, options.constraints.gcdChoices, options.constraints.speedMin,
        options.constraints.speedMax].some((value) => value !== undefined);
    if (constrainedSpeed && model.speedFoodProjection === undefined) return skip("speed-projection-unavailable");
    if (incumbent.selection.length !== options.slots.length || incumbent.hint.size !== model.bounds.length ||
      new Set(model.bounds.map(({ name }) => name)).size !== model.bounds.length) return skip("invalid-incumbent");
    const selectedFood = incumbent.food === undefined ? -1 : options.foods.indexOf(incumbent.food);
    if (selectedFood < 0 || incumbent.hint.get(model.foodVariables[selectedFood]!) !== 1) return skip("invalid-incumbent");
    const ringIds = new Map<number, boolean | undefined>();
    for (let index = 0; index < options.slots.length; index++) {
      statistics.work++;
      checkpoint();
      const selected = incumbent.selection[index]!;
      const candidate = options.slots[index]!.indexOf(selected);
      if (candidate < 0 || incumbent.hint.get(model.slotVariables[index]![candidate]!) !== 1) return skip("invalid-incumbent");
      const children = (selected as typeof selected & { ringEquips?: readonly typeof selected[] }).ringEquips;
      if (children !== undefined && (!Array.isArray(children) || children.length !== 2)) return skip("invalid-incumbent");
      const rings = children ?? (selected.ringSlotIndex === undefined ? [] : [selected]);
      for (const ring of rings) {
        if (!Number.isSafeInteger(ring.itemId) || ring.itemId < 1 ||
          (ringIds.has(ring.itemId) && (ringIds.get(ring.itemId) !== false || ring.isUnique !== false)))
          return skip("invalid-incumbent");
        ringIds.set(ring.itemId, ring.isUnique);
      }
    }
    if (model.bounds.some(({ name }) => !Number.isSafeInteger(incumbent.hint.get(name)))) return skip("invalid-incumbent");
    statistics.work += model.rows.length + model.bounds.length;
    checkpoint();
    try {
      validateMipSolution(model.rows, model.bounds,
        Object.fromEntries([...incumbent.hint].map(([name, Primal]) => [name, { Primal }])));
    } catch { return skip("invalid-incumbent"); }
    checkpoint();
    const attributes = getAttributeVector(incumbent.selection, incumbent.food, options.attributeIds, undefined, options.statIndexes);
    if (model.finalVariables.some((name, index) => incumbent.hint.get(name) !== attributes[index])) return skip("invalid-incumbent");
    const factors = prepared.factorEvaluator(attributes);
    if (factors === undefined) return skip("invalid-incumbent");
    const seedFactors = { weapon: factors.weaponDamage, main: factors.mainStat, det: factors.determination,
      ten: factors.tenacity, dht: factors.directHit, crt: factors.critical };
    if ([...Object.values(seedFactors), factors.gcdCentiseconds].some((value) => !Number.isSafeInteger(value) || value < 1))
      return skip("invalid-incumbent");
    if ((options.constraints?.gcd !== undefined && Math.round(options.constraints.gcd * 100) !== factors.gcdCentiseconds) ||
      (options.constraints?.gcdChoices !== undefined && !options.constraints.gcdChoices.some((gcd) => Math.round(gcd * 100) === factors.gcdCentiseconds)))
      return skip("invalid-incumbent");
    const axes: Record<FactorName, number | undefined> = { weapon: prepared.weaponAttribute, main: prepared.mainAttribute,
      det: prepared.detAttribute, ten: prepared.tenAttribute, dht: prepared.dhtAttribute, crt: prepared.crtAttribute };
    const classes = {} as BoundInput["classes"];
    for (const name of Object.keys(axes) as FactorName[]) {
      const group = groups.find((entry) => entry.name === name);
      if (!group?.classes.length || group.classes.some(({ min, max, value }) =>
        ![min, max, value].every(Number.isSafeInteger) || min < 0 || min > max || value < 1)) return skip("unproved-factor-domain");
      if (axes[name] === undefined && !group.classes.every(({ value }) => value === group.classes[0]!.value))
        return skip("unproved-factor-domain");
      classes[name] = group.classes;
    }
    const auxiliary = groups.find(({ name }) => name === "main")!.classes.map((entry) => entry.auxiliary);
    const hasAuxiliary = auxiliary.some((value) => value !== undefined);
    if (hasAuxiliary && auxiliary.some((value) => !Number.isSafeInteger(value) || value! < 0)) return skip("unproved-weapon-coupling");
    let maximumWeaponAuxiliary = 0;
    if (hasAuxiliary) for (const value of auxiliary) maximumWeaponAuxiliary = Math.max(maximumWeaponAuxiliary, value!);
    const gcdClasses = groups.find(({ name }) => name === "gcd")?.classes;
    if (!gcdClasses?.length || gcdClasses.some(({ value }) => !Number.isSafeInteger(value) || value < 1)) return skip("unproved-gcd-domain");
    const gcdLowerBound = gcdClasses.reduce((best, entry) => Math.min(best, entry.value), Infinity);
    const slots: Record<string, number>[][] = [];
    for (let index = 0; index < model.fixedEquipmentAttributes.length; index++) {
      const slot = model.fixedEquipmentAttributes[index]!;
      if (!slot.length || slot.length !== options.slots[index]?.length) return skip("unproved-candidate-domain");
      const points: Record<string, number>[] = [];
      for (const vector of slot) {
        statistics.work++;
        if ((statistics.work & 255) === 0) checkpoint();
        const point: Record<string, number> = { speed: constrainedSpeed ? vector[prepared.speedAttribute]! : 0 };
        for (const [name, axis] of Object.entries(axes)) point[name] = axis === undefined ? 0 : vector[axis]!;
        if (Object.values(point).some((value) => !Number.isSafeInteger(value) || value < 0)) return skip("unproved-candidate-domain");
        points.push(point);
      }
      slots.push(points);
    }
    const foods: Record<string, FoodParameter | undefined>[] = [];
    for (let foodIndex = 0; foodIndex < options.foods.length; foodIndex++) {
      const food: Record<string, FoodParameter | undefined> = {};
      for (const [name, axis] of Object.entries(axes)) {
        if (axis === undefined) continue;
        const parameters = options.foods[foodIndex]!.baseParams.filter((parameter) => parameter.baseParamId === options.attributeIds[axis]);
        const bonuses = model.foodBonuses.filter((bonus) => bonus.foodIndex === foodIndex && bonus.attribute === axis);
        if (parameters.length > 1 || bonuses.length > 1) return skip("unproved-food-domain");
        const parameter = parameters[0];
        const bonus = bonuses[0];
        const hasBonus = parameter !== undefined && parameter.multiplier > 1 && parameter.maxValue > 0;
        if (hasBonus !== (bonus !== undefined)) return skip("unproved-food-domain");
        if (!bonus) continue;
        const base = parameter?.baseValue ?? 0;
        if (![base, bonus.numerator, bonus.denominator, bonus.cap].every(Number.isSafeInteger) ||
          base < 0 || bonus.numerator < 0 || bonus.denominator < 1 || bonus.cap < 0) return skip("unproved-food-domain");
        food[name] = { base, numerator: bonus.numerator, denominator: bonus.denominator, cap: bonus.cap };
      }
      foods.push(food);
    }
    checkpoint();
    const result = completeProductBounds({ slots, foods, classes, seedFactors, maximumWeaponAuxiliary,
      ...(constrainedSpeed ? { allowedSpeedsByFood: model.speedFoodProjection!.rawSpeedsByFood } : {}),
    }, { ...limits, deadline, maxWork: maxWork - statistics.work, cancelled: options.isCancelled });
    statistics.work += result.statistics.work;
    statistics.speedFibers = result.statistics.fibers;
    statistics.peakSupportPoints = result.statistics.peakPoints;
    statistics.foodsEvaluated = result.statistics.foods;
    statistics.nonConstantFactors = result.statistics.nonconstant;
    if (result.status === "skipped") return skip(result.reason);
    checkpoint();
    const rows: ModelRow[] = [];
    const seedProduct = product(seedFactors);
    for (let index = 0; index < result.products.length; index++) {
      checkpoint();
      const upper = result.products[index]!;
      const strictlyWorse = prepared.useDps ? upper * BigInt(factors.gcdCentiseconds) < seedProduct * BigInt(gcdLowerBound) : upper < seedProduct;
      if (strictlyWorse && !model.speedFoodProjection?.excludedFoodIndexes.includes(index))
        addRows(rows, `food_product_exclude_${index}`, [[model.foodVariables[index]!, 1]], "=", 0);
    }
    statistics.execution = "completed";
    statistics.foodsExcluded = rows.length;
    statistics.elapsedMs = performance.now() - startedAt;
    return { rows, upperProducts: result.products, gcdLowerBound, statistics };
  } catch (error) {
    if (error instanceof Abandon) return skip(error.reason);
    throw error;
  }
}
