export interface SubstatFactorClass {
  /** 此因子档位代表的最低装备与食物属性贡献。 */
  min: number;
  /** 此档位对应的精确整数因子。 */
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
   * 保守的工作量估算上限，分别应用于预处理和每次查询。
   * 预处理计入配对生成和 n log2(n) 排序估算；查询计入扫描 DHT 档位及对应的配对成本查找。
   * 默认值为 2,000,000；限制无效时不启用此界。
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
 * 预先构造可复用的精确 CRT × DET × DHT 因子预算查询。
 * 配对乘积和前缀最大值只构造一次；返回的每次查询只需扫描 DHT 档位，并对已排序的配对成本执行二分查找。
 * 输入无效或工作量过大时返回 undefined，让调用方跳过此优化界。
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

/** 供只需查询单个预算的调用方使用的便捷封装。 */
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
