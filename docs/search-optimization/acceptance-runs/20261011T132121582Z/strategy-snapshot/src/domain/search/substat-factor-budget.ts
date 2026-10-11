export interface SubstatFactorClass {
  /** Minimum gear-plus-food contribution represented by this factor class. */
  min: number;
  /** Exact integer factor represented by this class. */
  value: number;
}

export interface SubstatFactorBudgetMaximum {
  product: bigint;
  crtIndex: number;
  detIndex: number;
  dhtIndex: number;
}

export interface SubstatFactorBudgetOptions {
  /**
   * Conservative work estimate limit, applied independently to preparation and
   * each query. Preparation includes pair generation and an n log2(n) sort
   * bound; a query includes scanning DHT classes and their pair-cost searches.
   * Defaults to 2,000,000; invalid limits fail open.
   */
  maxWork?: number;
}

export type PreparedSubstatFactorBudgetQuery = (
  budget: number,
) => SubstatFactorBudgetMaximum | undefined;

const DEFAULT_MAX_WORK = 2_000_000;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

interface Pair {
  cost: number;
  product: bigint;
  crtIndex: number;
  detIndex: number;
}

interface DhtClass {
  min: number;
  value: bigint;
  index: number;
}

function validClasses(classes: readonly SubstatFactorClass[]): boolean {
  if (!Array.isArray(classes)) return false;
  for (const entry of classes) {
    if (entry === null || typeof entry !== "object" ||
      !Number.isSafeInteger(entry.min) || entry.min < 0 ||
      !Number.isSafeInteger(entry.value) || entry.value < 0) return false;
  }
  return true;
}

function lexicallyPrecedes(a: Pair, b: Pair): boolean {
  return a.crtIndex < b.crtIndex ||
    (a.crtIndex === b.crtIndex && a.detIndex < b.detIndex);
}

function estimatedPreparationWork(pairCount: number, classCount: number): number | undefined {
  if (!Number.isSafeInteger(pairCount)) return undefined;
  const sortLevels = pairCount > 1 ? Math.ceil(Math.log2(pairCount)) : 0;
  const estimate = classCount + pairCount + pairCount * sortLevels;
  return Number.isSafeInteger(estimate) ? estimate : undefined;
}

/**
 * Prepares a reusable exact CRT × DET × DHT factor-budget query. Pair products
 * and prefix maxima are built once; each returned query only scans DHT classes
 * and binary-searches the sorted pair costs. Invalid input or excessive work
 * returns undefined so callers can fail open.
 */
export function prepareSubstatFactorBudgetQuery(
  crtClasses: readonly SubstatFactorClass[],
  detClasses: readonly SubstatFactorClass[],
  dhtClasses: readonly SubstatFactorClass[],
  options: SubstatFactorBudgetOptions = {},
): PreparedSubstatFactorBudgetQuery | undefined {
  if (options === null || typeof options !== "object" ||
    !validClasses(crtClasses) || !validClasses(detClasses) || !validClasses(dhtClasses)) return undefined;

  const maxWork = options.maxWork ?? DEFAULT_MAX_WORK;
  if (!Number.isSafeInteger(maxWork) || maxWork < 0) return undefined;

  const pairCount = crtClasses.length * detClasses.length;
  const classCount = crtClasses.length + detClasses.length + dhtClasses.length;
  const preparationWork = estimatedPreparationWork(pairCount, classCount);
  const queryLevels = pairCount > 0 ? Math.ceil(Math.log2(pairCount + 1)) : 0;
  const queryWork = dhtClasses.length + dhtClasses.length * queryLevels;
  if (preparationWork === undefined || preparationWork > maxWork ||
    !Number.isSafeInteger(queryWork) || queryWork > maxWork) return undefined;

  const pairs: Pair[] = [];
  for (let crtIndex = 0; crtIndex < crtClasses.length; crtIndex += 1) {
    const crt = crtClasses[crtIndex];
    for (let detIndex = 0; detIndex < detClasses.length; detIndex += 1) {
      const det = detClasses[detIndex];
      if (det.min > MAX_SAFE_INTEGER - crt.min) continue;
      pairs.push({
        cost: crt.min + det.min,
        product: BigInt(crt.value) * BigInt(det.value),
        crtIndex,
        detIndex,
      });
    }
  }

  pairs.sort((a, b) => a.cost - b.cost || a.crtIndex - b.crtIndex || a.detIndex - b.detIndex);

  const prefixBest: Pair[] = [];
  const prefixEarliest: Pair[] = [];
  let bestPair: Pair | undefined;
  let earliestPair: Pair | undefined;
  for (const pair of pairs) {
    if (bestPair === undefined || pair.product > bestPair.product ||
      (pair.product === bestPair.product && lexicallyPrecedes(pair, bestPair))) {
      bestPair = pair;
    }
    if (earliestPair === undefined || lexicallyPrecedes(pair, earliestPair)) earliestPair = pair;
    prefixBest.push(bestPair);
    prefixEarliest.push(earliestPair);
  }

  const preparedDht: DhtClass[] = dhtClasses.map((entry, index) => ({
    min: entry.min,
    value: BigInt(entry.value),
    index,
  }));

  return (budget: number): SubstatFactorBudgetMaximum | undefined => {
    if (!Number.isSafeInteger(budget) || budget < 0) return undefined;

    let best: SubstatFactorBudgetMaximum | undefined;
    for (const dht of preparedDht) {
      if (dht.min > budget) continue;
      const pairBudget = budget - dht.min;

      let low = 0;
      let high = pairs.length;
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (pairs[middle].cost <= pairBudget) low = middle + 1;
        else high = middle;
      }
      if (low === 0) continue;

      const pair = dht.value === 0n ? prefixEarliest[low - 1] : prefixBest[low - 1];
      const product = pair.product * dht.value;
      if (best === undefined || product > best.product ||
        (product === best.product &&
          (pair.crtIndex < best.crtIndex ||
            (pair.crtIndex === best.crtIndex &&
              (pair.detIndex < best.detIndex ||
                (pair.detIndex === best.detIndex && dht.index < best.dhtIndex)))))) {
        best = { product, crtIndex: pair.crtIndex, detIndex: pair.detIndex, dhtIndex: dht.index };
      }
    }

    return best;
  };
}

/** Convenience wrapper for callers that only need to answer one budget. */
export function maxSubstatFactorProductWithinBudget(
  crtClasses: readonly SubstatFactorClass[],
  detClasses: readonly SubstatFactorClass[],
  dhtClasses: readonly SubstatFactorClass[],
  budget: number,
  options: SubstatFactorBudgetOptions = {},
): SubstatFactorBudgetMaximum | undefined {
  if (!Number.isSafeInteger(budget) || budget < 0) return undefined;
  return prepareSubstatFactorBudgetQuery(crtClasses, detClasses, dhtClasses, options)?.(budget);
}
