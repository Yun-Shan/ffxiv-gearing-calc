export interface ResourceBudgetFactorClass {
  /** Minimum gear-plus-food attribute contribution represented by this class. */
  min: number;
  /** Integer log-score contribution; DPS GCD classes use the negative log score. */
  score: number;
}

export interface ResourceBudgetFactorGroup {
  classes: readonly ResourceBudgetFactorClass[];
}

export interface FactorResourceBudgetUpperBoundOptions {
  /** Maximum support-line preprocessing work; invalid or excessive inputs fail open. */
  maxWork?: number;
}

export interface PreparedFactorResourceBudgetUpperBound {
  minimumCost: number;
  supportCount: number;
  query: (budget: number) => bigint | undefined;
}

type Point = { cost: number; score: number };
type Support = { numerator: bigint; denominator: bigint; intercept: bigint };

const DEFAULT_MAX_WORK = 2_000_000;

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function slope(left: Point, right: Point): readonly [bigint, bigint] | undefined {
  const numerator = BigInt(right.score) - BigInt(left.score);
  const denominator = BigInt(right.cost) - BigInt(left.cost);
  if (denominator <= 0n || numerator < 0n) return undefined;
  if (numerator === 0n) return [0n, 1n];
  const divisor = gcd(numerator, denominator);
  return [numerator / divisor, denominator / divisor];
}

function compareRationals(left: readonly [bigint, bigint], right: readonly [bigint, bigint]): number {
  const a = left[0] * right[1];
  const b = right[0] * left[1];
  return a < b ? -1 : a > b ? 1 : 0;
}

function upperConcaveHull(classes: readonly ResourceBudgetFactorClass[]): Point[] | undefined {
  if (!Array.isArray(classes) || classes.length === 0) return undefined;
  const bestByCost = new Map<number, number>();
  for (const entry of classes) {
    if (entry === null || typeof entry !== "object" ||
      !Number.isSafeInteger(entry.min) || entry.min < 0 ||
      !Number.isSafeInteger(entry.score)) return undefined;
    bestByCost.set(entry.min, Math.max(bestByCost.get(entry.min) ?? Number.NEGATIVE_INFINITY, entry.score));
  }
  const points = [...bestByCost].map(([cost, score]) => ({ cost, score }))
    .sort((left, right) => left.cost - right.cost);
  const hull: Point[] = [];
  for (const point of points) {
    const previous = hull.at(-1);
    if (previous !== undefined && point.score <= previous.score) continue;
    while (hull.length >= 2) {
      const firstSlope = slope(hull[hull.length - 2]!, hull[hull.length - 1]!);
      const secondSlope = slope(hull[hull.length - 1]!, point);
      if (firstSlope === undefined || secondSlope === undefined) return undefined;
      if (compareRationals(firstSlope, secondSlope) > 0) break;
      hull.pop();
    }
    hull.push(point);
  }
  return hull.length === 0 ? undefined : hull;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder !== 0n && numerator > 0n ? quotient + 1n : quotient;
}

/**
 * Builds a rigorous Lagrangian upper bound for the best additive log score
 * under a single raw-resource budget. It does not approximate damage with a
 * weighted stat sum: callers supply each exact factor class's integer log
 * score and minimum resource cost. Every nonnegative price gives a safe bound;
 * the upper-hull segment prices provide the exact LP-relaxation envelope.
 */
export function prepareFactorResourceBudgetUpperBound(
  groups: readonly ResourceBudgetFactorGroup[],
  options: FactorResourceBudgetUpperBoundOptions = {},
): PreparedFactorResourceBudgetUpperBound | undefined {
  if (!Array.isArray(groups) || groups.length === 0 || options === null || typeof options !== "object") {
    return undefined;
  }
  const maxWork = options.maxWork ?? DEFAULT_MAX_WORK;
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;
  const hulls = groups.map((group) => upperConcaveHull(group?.classes ?? []));
  if (hulls.some((hull) => hull === undefined)) return undefined;
  const validHulls = hulls as Point[][];
  let minimumCost = 0;
  const slopeMap = new Map<string, readonly [bigint, bigint]>([["0/1", [0n, 1n]]]);
  for (const hull of validHulls) {
    const first = hull[0]!;
    if (!Number.isSafeInteger(minimumCost + first.cost)) return undefined;
    minimumCost += first.cost;
    for (let index = 1; index < hull.length; index += 1) {
      const line = slope(hull[index - 1]!, hull[index]!);
      if (line === undefined) return undefined;
      slopeMap.set(`${line[0]}/${line[1]}`, line);
    }
  }
  const slopes = [...slopeMap.values()].sort(compareRationals);
  const classWork = validHulls.reduce((sum, hull) => sum + hull.length, 0);
  if (!Number.isSafeInteger(classWork) || classWork * slopes.length > maxWork) return undefined;

  const supports: Support[] = [];
  for (const [numerator, denominator] of slopes) {
    let intercept = 0n;
    for (const hull of validHulls) {
      let maximum: bigint | undefined;
      for (const point of hull) {
        const value = denominator * BigInt(point.score) - numerator * BigInt(point.cost);
        if (maximum === undefined || value > maximum) maximum = value;
      }
      if (maximum === undefined) return undefined;
      intercept += maximum;
    }
    supports.push({ numerator, denominator, intercept });
  }

  return {
    minimumCost,
    supportCount: supports.length,
    query(budget: number): bigint | undefined {
      if (!Number.isSafeInteger(budget) || budget < minimumCost || budget < 0) return undefined;
      const budgetBig = BigInt(budget);
      let best: bigint | undefined;
      for (const support of supports) {
        const upper = ceilDiv(
          support.numerator * budgetBig + support.intercept,
          support.denominator,
        );
        if (best === undefined || upper < best) best = upper;
      }
      return best;
    },
  };
}
