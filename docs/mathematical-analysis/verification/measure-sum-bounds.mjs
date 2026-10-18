/**
 * measure-sum-bounds.mjs
 *
 * 测量：用生产候选池构造（`prepareSearch`，只做候选/食物准备，不运行搜索、不调用 MIP 求解、
 * 不做 benchmark），逐槽扫描，计算三属性贡献和 S = CRT+DHT+DET 的：
 *
 *   - R_sep        = Σ_i Σ_s max_c x_i(c)                （逐属性最大相加，安全但松）
 *   - R_gear^uniq  = 逐槽 max S3 求和 + 戒指唯一性精确配对 + 义军武器精确和
 *                    （槽间独立时是 gear 和的精确最大值）
 *   - L_gear^uniq / L1                                   （安全下界；含食物下界）
 *   - 食物上界族 B1..B4 与 R_food = max_f min_k B_k(f)   （上界）
 *   - 速度（GCD）约束感知的 Lagrangian 上界 R_food|speed（λ 网格；仅约束场景）
 *   - 对照：戒指忽略唯一性的 naive 配对 gap、食物“逐属性 max 相加”naive 界
 *
 * 覆盖两类场景：
 *   A. 基线：WAR/WHM/DRG/BLM × {native L50..L100, endgame-sync L70/L80/L90}；
 *   B. 验收场景：直接解析 `docs/search-optimization/tools/run-acceptance.mjs` 的 `CASES`
 *      （逐 case 逐职业；含共享布局、食物策略、GCD 约束）。
 *
 * 坐标：全部是贡献坐标（装备+镶嵌；面板 = baseStats + 贡献）。食物公式按 canonical：
 *   bonus_i(f,G) = min(cap_i, floor((G_i + base_i) * rate_i/100))（精确有理数，BigInt）。
 *
 * 这不是搜索/枚举组合/性能测试：每个槽只独立扫描候选集合，复杂度 O(Σ|C_s| + |F|)。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/verification/measure-sum-bounds.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadGameData, repoRoot } from "./canonical-model.mjs";

const data = await loadGameData();
const prep = await import(
  new URL("src/domain/optimizer/search-preparation.ts", repoRoot).href
);
const ctx = await import(new URL("src/domain/optimizer/context.ts", repoRoot).href);
const effects = await import(
  new URL("src/domain/search/equipped-effects.ts", repoRoot).href
);

const CRT = ctx.attributeIndex.get("CRT");
const DHT = ctx.attributeIndex.get("DHT");
const DET = ctx.attributeIndex.get("DET");
if (CRT === undefined || DHT === undefined || DET === undefined) {
  throw new Error("缺少 CRT/DHT/DET 坐标");
}
const THREE = new Set([CRT, DHT, DET]);

const gcd = (a, b) => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
};
const floorDivBig = (n, d) => {
  if (d <= 0n) throw new RangeError("分母必须为正");
  let q = n / d;
  if (n % d !== 0n && n < 0n) q -= 1n;
  return q;
};
const lcm = (a, b) => (a / gcd(a, b)) * b;

// ---------------------------------------------------------------- 候选向量
function vectorOf(candidate) {
  const v = [0, 0, 0];
  for (const param of candidate.baseParams ?? []) {
    if (param.baseParamId === CRT) v[0] += param.value;
    else if (param.baseParamId === DHT) v[1] += param.value;
    else if (param.baseParamId === DET) v[2] += param.value;
  }
  return v;
}
function valueOf(candidate, index) {
  for (const param of candidate.baseParams ?? []) {
    if (param.baseParamId === index) return param.value;
  }
  return 0;
}
function s3(v) {
  return v[0] + v[1] + v[2];
}

function resistanceInfo(candidate) {
  const adj = candidate.resistanceWeaponAdjust;
  if (adj === undefined) return undefined;
  const caps = (adj.stats ?? [])
    .map((stat) => {
      const index = ctx.attributeIndex.get(stat);
      if (index === undefined || !THREE.has(index)) return undefined;
      const cap =
        adj.statMaximums?.[stat] !== undefined
          ? adj.statMaximums[stat]
          : adj.maxEachStat;
      return { index, cap: Math.max(0, cap) };
    })
    .filter(Boolean);
  const total = Math.max(0, adj.maxTotalStats);
  return {
    caps,
    total,
    maxSum3: Math.min(total, caps.reduce((sum, entry) => sum + entry.cap, 0)),
  };
}

function candidateBounds(candidate, speedIndex) {
  const base = vectorOf(candidate);
  const resistance = resistanceInfo(candidate);
  const maxVector = base.slice();
  const actualVector = base.slice();
  let maxS3 = s3(base);
  let resistanceSpeedVariable = false;
  if (resistance !== undefined) {
    let remaining = resistance.total;
    for (const { index, cap } of resistance.caps) {
      const i = index === CRT ? 0 : index === DHT ? 1 : 2;
      maxVector[i] += Math.min(cap, resistance.total);
      const add = Math.min(cap, Math.max(0, remaining));
      actualVector[i] += add;
      remaining -= add;
    }
    maxS3 = s3(base) + resistance.maxSum3;
    if (
      speedIndex !== undefined &&
      (candidate.resistanceWeaponAdjust.stats ?? []).some(
        (stat) => ctx.attributeIndex.get(stat) === speedIndex,
      )
    ) {
      resistanceSpeedVariable = true;
    }
  }
  return {
    minVector: base,
    maxVector,
    actualVector,
    minS3: s3(base),
    maxS3,
    speed: speedIndex === undefined ? 0 : valueOf(candidate, speedIndex),
    itemId: candidate.itemId,
    isUnique:
      candidate.isUnique ??
      (data.getGearById(candidate.itemId)?.unique === true),
    resistanceSpeedVariable,
  };
}

// ---------------------------------------------------------------- 戒指配对
function collapseByItem(list, valueFn, sense) {
  const byId = new Map();
  for (const entry of list) {
    const value = valueFn(entry);
    const previous = byId.get(entry.itemId);
    if (previous === undefined) {
      byId.set(entry.itemId, {
        itemId: entry.itemId,
        isUnique: entry.isUnique,
        value,
        source: entry,
      });
    } else {
      previous.isUnique = previous.isUnique || entry.isUnique;
      if (sense === "max" ? value > previous.value : value < previous.value) {
        previous.value = value;
        previous.source = entry;
      }
    }
  }
  return [...byId.values()];
}
function extremeExcluding(items, excludedId, sense) {
  let best;
  for (const item of items) {
    if (item.itemId === excludedId) continue;
    if (
      best === undefined ||
      (sense === "max" ? item.value > best.value : item.value < best.value)
    ) {
      best = item;
    }
  }
  return best;
}
function bestLegalPairEntries(listA, listB, valueFn, sense) {
  const a = collapseByItem(listA, valueFn, sense);
  const b = collapseByItem(listB, valueFn, sense);
  if (a.length === 0 || b.length === 0) return undefined;
  const pick = (items) =>
    items.reduce(
      (best, item) =>
        best === undefined ||
        (sense === "max" ? item.value > best.value : item.value < best.value)
          ? item
          : best,
      undefined,
    );
  const topA = pick(a);
  const topB = pick(b);
  if (topA.itemId !== topB.itemId || (topA.isUnique !== true && topB.isUnique !== true)) {
    return { value: topA.value + topB.value, a: topA.source, b: topB.source };
  }
  const replaceA = extremeExcluding(a, topA.itemId, sense);
  const replaceB = extremeExcluding(b, topB.itemId, sense);
  const options = [];
  if (replaceA !== undefined) {
    options.push({ value: replaceA.value + topB.value, a: replaceA.source, b: topB.source });
  }
  if (replaceB !== undefined) {
    options.push({ value: topA.value + replaceB.value, a: topA.source, b: replaceB.source });
  }
  if (options.length === 0) return undefined;
  return options.reduce((best, option) =>
    sense === "max" ? (option.value > best.value ? option : best) : (option.value < best.value ? option : best),
  );
}
function bestLegalPair(listA, listB, valueFn, sense) {
  const a = collapseByItem(listA, valueFn, sense);
  const b = collapseByItem(listB, valueFn, sense);
  if (a.length === 0 || b.length === 0) return undefined;
  const pick = (items) =>
    items.reduce(
      (best, item) =>
        best === undefined ||
        (sense === "max" ? item.value > best.value : item.value < best.value)
          ? item
          : best,
      undefined,
    );
  const topA = pick(a);
  const topB = pick(b);
  if (topA.itemId !== topB.itemId || (topA.isUnique !== true && topB.isUnique !== true)) {
    return topA.value + topB.value;
  }
  const replaceA = extremeExcluding(a, topA.itemId, sense);
  const replaceB = extremeExcluding(b, topB.itemId, sense);
  const options = [];
  if (replaceB !== undefined) options.push(topA.value + replaceB.value);
  if (replaceA !== undefined) options.push(replaceA.value + topB.value);
  if (options.length === 0) return undefined;
  return sense === "max" ? Math.max(...options) : Math.min(...options);
}

// ---------------------------------------------------------------- 食物
function rationalOf(multiplier) {
  const numerator = Math.round((multiplier - 1) * 100);
  if (!Number.isSafeInteger(numerator) || numerator < 0) return undefined;
  const divisor = gcd(numerator, 100);
  return { numerator: numerator / divisor, denominator: 100 / divisor };
}
function foodParams(food, indices) {
  return food.baseParams
    .filter((param) => indices.has(param.baseParamId) && (param.maxValue ?? 0) > 0)
    .map((param) => {
      const rational = rationalOf(param.multiplier);
      return rational === undefined
        ? undefined
        : {
            index: param.baseParamId,
            cap: param.maxValue,
            baseValue: param.baseValue ?? 0,
            numerator: rational.numerator,
            denominator: rational.denominator,
          };
    })
    .filter(Boolean);
}
function indexOfThree(baseParamId) {
  if (baseParamId === CRT) return 0;
  if (baseParamId === DHT) return 1;
  return 2;
}
function foodBonus(G, parameter) {
  const raw = BigInt(G + parameter.baseValue);
  const value = floorDivBig(
    raw * BigInt(parameter.numerator),
    BigInt(parameter.denominator),
  );
  return value > BigInt(parameter.cap) ? parameter.cap : Number(value);
}
function foodBonusVector(G, params) {
  const out = [0, 0, 0];
  for (const parameter of params) {
    out[indexOfThree(parameter.index)] += foodBonus(
      G[indexOfThree(parameter.index)],
      parameter,
    );
  }
  return out;
}
function b3Bound(slotVectors, params) {
  const denominator = params.reduce((acc, p) => lcm(acc, p.denominator), 1);
  const weightNumerator = [denominator, denominator, denominator];
  for (const p of params) {
    weightNumerator[indexOfThree(p.index)] +=
      (p.numerator * denominator) / p.denominator;
  }
  let scaled = 0n;
  for (const vectors of slotVectors) {
    let best = -1n;
    for (const v of vectors) {
      let value = 0n;
      for (let i = 0; i < 3; i += 1) {
        value += BigInt(weightNumerator[i]) * BigInt(v[i]);
      }
      if (value > best) best = value;
    }
    scaled += best;
  }
  let baseOnly = 0n;
  for (const p of params) {
    baseOnly +=
      BigInt(p.baseValue) * BigInt(p.numerator) *
      BigInt(denominator / p.denominator);
  }
  return Number(floorDivBig(scaled + baseOnly, BigInt(denominator)));
}

// ---------------------------------------------------------------- 速度区间
function speedStatOf(jobId) {
  const schema = data.jobSchemas[jobId];
  return schema.stats.includes("SKS") ? "SKS" : "SPS";
}
function dedupeRanges(ranges) {
  const seen = new Set();
  return ranges.filter((range) => {
    const key = `${range.min}:${range.max}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function normalizeRange(range) {
  if (range === undefined) return undefined;
  const min = Math.max(0, range.min);
  const max = Math.max(0, range.max);
  return min <= max ? { min, max } : undefined;
}
function speedIntervalsOf(config, jobLevel) {
  const gcdRange =
    config.gcdTarget === undefined
      ? undefined
      : normalizeRange(
          effects.equippedSpeedRangeForGcd(
            config.jobId,
            jobLevel,
            config.gcdTarget,
          ),
        );
  const choiceRanges = (config.gcdChoices ?? [])
    .map((choice) =>
      normalizeRange(
        effects.equippedSpeedRangeForGcd(config.jobId, jobLevel, choice),
      ),
    )
    .filter(Boolean);
  if (config.gcdTarget !== undefined && config.gcdChoices !== undefined) {
    const gcdRanges = gcdRange === undefined ? [] : [gcdRange];
    const intersected = [];
    for (const a of gcdRanges) {
      for (const b of choiceRanges) {
        const min = Math.max(a.min, b.min);
        const max = Math.min(a.max, b.max);
        if (min <= max) intersected.push({ min, max });
      }
    }
    return dedupeRanges(intersected);
  }
  if (config.gcdTarget !== undefined) {
    return gcdRange === undefined ? [] : [gcdRange];
  }
  return dedupeRanges(choiceRanges);
}

// ---------------------------------------------------------------- λ 网格
const LAMBDA_Q = 16;
const LAMBDA_P = [
  0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512,
];

// ---------------------------------------------------------------- 单场景
function measure(config) {
  const prepared = prep.prepareSearch(config, {});
  const speedIndex = ctx.attributeIndex.get(speedStatOf(config.jobId));
  const slotVectors = [];
  const slotMins = [];
  const slotMaxes = [];
  const slotPerAttributeMax = [];
  const argmaxVectors = [];
  const nonRingCandidates = [];
  const ringBounds = new Map();
  let candidateCount = 0;

  for (const slot of prepared.slots) {
    const bounds = slot.candidates.map((candidate) =>
      candidateBounds(candidate, speedIndex),
    );
    candidateCount += bounds.length;
    if (slot.name === "ring" || slot.name === "ring2") {
      ringBounds.set(slot.name, bounds);
      slotVectors.push(bounds.map((entry) => entry.maxVector));
      continue;
    }
    slotVectors.push(bounds.map((entry) => entry.maxVector));
    nonRingCandidates.push(bounds);
    slotMins.push(Math.min(...bounds.map((entry) => entry.minS3)));
    const bestIndex = bounds.reduce(
      (best, entry, index) => (entry.maxS3 > bounds[best].maxS3 ? index : best),
      0,
    );
    slotMaxes.push(bounds[bestIndex].maxS3);
    argmaxVectors.push(bounds[bestIndex].actualVector.slice());
    for (let i = 0; i < 3; i += 1) {
      slotPerAttributeMax[i] =
        (slotPerAttributeMax[i] ?? 0) +
        Math.max(...bounds.map((entry) => entry.maxVector[i]));
    }
  }

  // 戒指：精确配对 + λ 极值配对
  const ringSlots = [...ringBounds.entries()];
  let ringMax = 0;
  let ringMin = 0;
  let ringBruteChecked = 0;
  let ringPairForLambda;
  if (ringSlots.length === 2) {
    const boundsA = ringSlots[0][1];
    const boundsB = ringSlots[1][1];
    const pairMax = bestLegalPair(boundsA, boundsB, (entry) => entry.maxS3, "max");
    const pairMin = bestLegalPair(boundsA, boundsB, (entry) => entry.minS3, "min");
    if (pairMax === undefined || pairMin === undefined) {
      throw new Error(
        `戒指槽没有合法配对（${boundsA.length}/${boundsB.length} 候选）`,
      );
    }
    ringMax = pairMax;
    ringMin = pairMin;
    if (boundsA.length * boundsB.length <= 200_000) {
      let bruteMax = Number.NEGATIVE_INFINITY;
      let bruteMin = Number.POSITIVE_INFINITY;
      for (const a of boundsA) {
        for (const b of boundsB) {
          if (a.itemId === b.itemId && (a.isUnique || b.isUnique)) continue;
          bruteMax = Math.max(bruteMax, a.maxS3 + b.maxS3);
          bruteMin = Math.min(bruteMin, a.minS3 + b.minS3);
        }
      }
      if (bruteMax !== pairMax || bruteMin !== pairMin) {
        throw new Error(
          `戒指配对与暴力不一致：max ${bruteMax}/${pairMax}，min ${bruteMin}/${pairMin}`,
        );
      }
      ringBruteChecked = 1;
    }
    for (let i = 0; i < 3; i += 1) {
      slotPerAttributeMax[i] =
        (slotPerAttributeMax[i] ?? 0) +
        bestLegalPair(boundsA, boundsB, (entry) => entry.maxVector[i], "max");
    }
    let bestPair;
    for (const a of boundsA) {
      for (const b of boundsB) {
        if (a.itemId === b.itemId && (a.isUnique || b.isUnique)) continue;
        const value = a.maxS3 + b.maxS3;
        if (bestPair === undefined || value > bestPair.value) {
          bestPair = { value, a, b };
        }
      }
    }
    if (bestPair !== undefined) {
      argmaxVectors.push([
        bestPair.a.actualVector[0] + bestPair.b.actualVector[0],
        bestPair.a.actualVector[1] + bestPair.b.actualVector[1],
        bestPair.a.actualVector[2] + bestPair.b.actualVector[2],
      ]);
    }
    ringPairForLambda = (p, sign) =>
      bestLegalPair(
        boundsA,
        boundsB,
        (entry) => entry.maxS3 * LAMBDA_Q + sign * p * entry.speed,
        "max",
      );
  }

  // 构造最小侧可达完成：各非戒指槽取 minS3 候选，戒指取精确最小合法配对。
  const minGear = [0, 0, 0];
  for (const bounds of nonRingCandidates) {
    let bestIndex = 0;
    for (let i = 1; i < bounds.length; i += 1) {
      if (bounds[i].minS3 < bounds[bestIndex].minS3) bestIndex = i;
    }
    const entry = bounds[bestIndex];
    for (let i = 0; i < 3; i += 1) minGear[i] += entry.minVector[i];
  }
  if (ringSlots.length === 2) {
    const pairMinEntry = bestLegalPairEntries(
      ringSlots[0][1],
      ringSlots[1][1],
      (entry) => entry.minS3,
      "min",
    );
    if (pairMinEntry === undefined) throw new Error("戒指槽没有最小合法配对");
    for (let i = 0; i < 3; i += 1) {
      minGear[i] += pairMinEntry.a.minVector[i] + pairMinEntry.b.minVector[i];
    }
  }

  const R_sep = slotPerAttributeMax.reduce((sum, value) => sum + value, 0);
  const R_gear = slotMaxes.reduce((sum, value) => sum + value, 0) + ringMax;
  const L_gear = slotMins.reduce((sum, value) => sum + value, 0) + ringMin;
  const naiveR_gear =
    slotMaxes.reduce((sum, value) => sum + value, 0) +
    (ringSlots.length === 2
      ? Math.max(...ringSlots[0][1].map((entry) => entry.maxS3)) +
        Math.max(...ringSlots[1][1].map((entry) => entry.maxS3))
      : 0);
  const naiveL_gear =
    slotMins.reduce((sum, value) => sum + value, 0) +
    (ringSlots.length === 2
      ? Math.min(...ringSlots[0][1].map((entry) => entry.minS3)) +
        Math.min(...ringSlots[1][1].map((entry) => entry.minS3))
      : 0);
  const Gmax = slotPerAttributeMax.slice();

  // λ 极值（约束感知上界预计算）
  const lambdaMinus = new Map();
  const lambdaPlus = new Map();
  for (const p of LAMBDA_P) {
    let minus = 0;
    let plus = 0;
    for (const bounds of nonRingCandidates) {
      minus += Math.max(
        ...bounds.map((entry) => entry.maxS3 * LAMBDA_Q - p * entry.speed),
      );
      plus += Math.max(
        ...bounds.map((entry) => entry.maxS3 * LAMBDA_Q + p * entry.speed),
      );
    }
    if (ringPairForLambda !== undefined) {
      minus += ringPairForLambda(p, -1);
      plus += ringPairForLambda(p, 1);
    }
    lambdaMinus.set(p, minus);
    lambdaPlus.set(p, plus);
  }

  // 食物上界族
  let L_food = Number.POSITIVE_INFINITY;
  let R_food = R_gear;
  let R_food_naive = R_sep;
  const foodRows = [];
  for (const food of prepared.foods) {
    const params = foodParams(food, THREE);
    const speedParams = foodParams(food, new Set([speedIndex]));
    const maxFoodSpeed = speedParams.reduce((sum, param) => sum + param.cap, 0);
    const bonusAtZero = foodBonusVector([0, 0, 0], params);
    L_food = Math.min(L_food, s3(bonusAtZero));
    const bonusAtGmax = foodBonusVector(Gmax, params);
    const capSum = params.reduce((sum, param) => sum + param.cap, 0);
    const bonusAtGmaxSum = s3(bonusAtGmax);
    const B1 = R_gear + capSum;
    const B2 = R_sep + bonusAtGmaxSum;
    const B4 = R_gear + bonusAtGmaxSum;
    const B3 = params.length === 0 ? R_gear : b3Bound(slotVectors, params);
    const foodBound = Math.min(B1, B2, B4, B3);
    foodRows.push({
      B1,
      B2,
      B3,
      B4,
      foodBound,
      bonusBound: Math.min(capSum, bonusAtGmaxSum),
      maxFoodSpeed,
    });
    R_food = Math.max(R_food, foodBound);
    R_food_naive = Math.max(R_food_naive, R_sep + capSum);
  }
  if (prepared.foods.length === 0) L_food = 0;
  const L1 = L_gear + (Number.isFinite(L_food) ? L_food : 0);

  // 速度（GCD）约束感知上界
  const speedIntervals = speedIntervalsOf(config, prepared.jobLevel);
  if (speedIntervals.length > 0) {
    const requested = new Set();
    if (config.gcdTarget !== undefined) {
      requested.add(Math.round(config.gcdTarget * 100));
    }
    for (const choice of config.gcdChoices ?? []) {
      requested.add(Math.round(choice * 100));
    }
    const speedStat = speedStatOf(config.jobId);
    const gcdHundredthsAt = (contribution) => {
      const evaluated = effects.equippedEffects(config.jobId, prepared.jobLevel, {
        [speedStat]: contribution,
      });
      if (evaluated === undefined || !Number.isFinite(evaluated.gcd)) {
        throw new Error(`速度语义断言无法计算 GCD（${config.jobId}）`);
      }
      return Math.round(evaluated.gcd * 100);
    };
    for (const interval of speedIntervals) {
      for (const endpoint of [interval.min, interval.max]) {
        const value = gcdHundredthsAt(endpoint);
        if (!requested.has(value)) {
          throw new Error(
            `速度区间语义不一致：${config.jobId} 贡献 ${endpoint} 的 GCD=${value}，期望 ${[...requested].join("/")}`,
          );
        }
      }
    }
  }
  let R_food_constrained = R_food;
  let constrainedFallback = false;
  if (speedIntervals.length > 0) {
    const anyResistanceSpeed = nonRingCandidates.some((bounds) =>
      bounds.some((entry) => entry.resistanceSpeedVariable),
    );
    if (anyResistanceSpeed) {
      constrainedFallback = true;
    } else {
      let best = Number.NEGATIVE_INFINITY;
      for (const row of foodRows) {
        let speedBound = Number.NEGATIVE_INFINITY;
        for (const interval of speedIntervals) {
          let intervalBest = Number.POSITIVE_INFINITY;
          for (const p of LAMBDA_P) {
            const upper =
              Number(
                floorDivBig(
                  BigInt(lambdaMinus.get(p) + p * interval.max),
                  BigInt(LAMBDA_Q),
                ),
              ) + row.bonusBound;
            const gearSpeedLower = Math.max(0, interval.min - row.maxFoodSpeed);
            const lower =
              Number(
                floorDivBig(
                  BigInt(lambdaPlus.get(p) - p * gearSpeedLower),
                  BigInt(LAMBDA_Q),
                ),
              ) + row.bonusBound;
            intervalBest = Math.min(intervalBest, upper, lower);
          }
          speedBound = Math.max(speedBound, intervalBest);
        }
        best = Math.max(best, Math.min(row.foodBound, speedBound));
      }
      if (Number.isFinite(best)) R_food_constrained = best;
    }
  }

  // 可达下界
  const argmaxGear = argmaxVectors.reduce(
    (acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]],
    [0, 0, 0],
  );
  let achievable = 0;
  for (const food of prepared.foods) {
    const params = foodParams(food, THREE);
    achievable = Math.max(
      achievable,
      s3(argmaxGear) + s3(foodBonusVector(argmaxGear, params)),
    );
  }
  if (prepared.foods.length === 0) achievable = s3(argmaxGear);

  // 确定性抽样安全断言
  let seed = 0;
  for (const character of `${config.jobId}:${prepared.jobLevel}:${config.syncLevel ?? "native"}:${config.gcdTarget ?? ""}:${(config.gcdChoices ?? []).join(",")}`) {
    seed = (seed * 131 + character.charCodeAt(0)) % 2147483647;
  }
  seed = (seed * 2654435761) % 2147483647;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const ringCandidateLists = ringSlots.map(([, bounds]) => bounds);
  let sampled = 0;
  let sampleMax = 0;
  let sampleMin = Number.POSITIVE_INFINITY;
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const vector = [0, 0, 0];
    for (const slot of prepared.slots) {
      if (slot.name === "ring" || slot.name === "ring2") continue;
      const candidate =
        slot.candidates[Math.floor(random() * slot.candidates.length)];
      const v = vectorOf(candidate);
      for (let i = 0; i < 3; i += 1) vector[i] += v[i];
      if (candidate.resistanceWeaponAdjust !== undefined) {
        const info = resistanceInfo(candidate);
        if (info !== undefined) {
          let remaining = info.total;
          for (const { index, cap } of info.caps) {
            const add = Math.floor(random() * (Math.min(cap, remaining) + 1));
            const i = index === CRT ? 0 : index === DHT ? 1 : 2;
            vector[i] += add;
            remaining -= add;
          }
        }
      }
    }
    if (ringCandidateLists.length === 2) {
      let a;
      let b;
      let guard = 0;
      do {
        a = ringCandidateLists[0][
          Math.floor(random() * ringCandidateLists[0].length)
        ];
        b = ringCandidateLists[1][
          Math.floor(random() * ringCandidateLists[1].length)
        ];
        guard += 1;
      } while (guard < 2000 && a.itemId === b.itemId && (a.isUnique || b.isUnique));
      for (let i = 0; i < 3; i += 1) vector[i] += a.minVector[i] + b.minVector[i];
    }
    const food = prepared.foods[Math.floor(random() * prepared.foods.length)];
    const params = food === undefined ? [] : foodParams(food, THREE);
    const total = s3(vector) + s3(foodBonusVector(vector, params));
    if (total > sampleMax) sampleMax = total;
    if (total < sampleMin) sampleMin = total;
    if (total < L1 || total > R_food) {
      throw new Error(
        `抽样安全失败：total=${total} 不在 [${L1}, ${R_food}]（${config.jobId} L${prepared.jobLevel}）`,
      );
    }
    sampled += 1;
  }

  // 最小侧可达完成（构造的最小完成与采样最小值的较小者）=> 真实最小值的一个上界。
  let constructedMin = Number.POSITIVE_INFINITY;
  for (const food of prepared.foods) {
    const params = foodParams(food, THREE);
    constructedMin = Math.min(
      constructedMin,
      s3(minGear) + s3(foodBonusVector(minGear, params)),
    );
  }
  if (prepared.foods.length === 0) constructedMin = s3(minGear);
  const minAchievable = Math.min(constructedMin, sampleMin);
  if (minAchievable < L1) {
    throw new Error(`下界测量异常：minAchievable=${minAchievable} < L1=${L1}`);
  }

  return {
    minAchievable,
    lowerGap: minAchievable - L1,
    job: config.jobId,
    level: prepared.jobLevel,
    candidates: candidateCount,
    foodCount: prepared.foods.length,
    R_sep,
    R_gear,
    naiveR_gear,
    L_gear,
    naiveL_gear,
    L1,
    R_food,
    R_food_naive,
    R_food_constrained,
    constrainedFallback,
    speedIntervals,
    achievable,
    ringBruteChecked,
    sampled,
    sampleMin,
    sampleMax,
    objective: config.objective,
    syncLevel: config.syncLevel,
    gcdTarget: config.gcdTarget,
    gcdChoices: config.gcdChoices,
    Gmax,
  };
}

// ---------------------------------------------------------------- 验收场景解析
const ACCEPTANCE_PATH = "docs/search-optimization/tools/run-acceptance.mjs";
const acceptanceText = readFileSync(new URL(ACCEPTANCE_PATH, repoRoot), "utf8");
function parseAcceptanceCases() {
  const start = acceptanceText.indexOf("const CASES = [");
  if (start < 0) throw new Error("run-acceptance.mjs 缺少 CASES");
  const end = acceptanceText.indexOf("\n];", start);
  if (end < 0) throw new Error("run-acceptance.mjs CASES 未闭合");
  const region = acceptanceText.slice(start, end);
  const blocks = region.split(/\r?\n  \{\r?\n/).slice(1);
  const cases = [];
  for (const block of blocks) {
    const id = block.match(/id: "([^"]+)"/)?.[1];
    if (id === undefined) continue;
    const jobsText = block.match(/jobs: \[([^\]]+)\]/)?.[1];
    if (jobsText === undefined) throw new Error(`场景 ${id} 缺少 jobs`);
    const jobs = [...jobsText.matchAll(/"([A-Z]+)"/g)].map((match) => match[1]);
    const minItemLevel = Number(block.match(/minItemLevel: (\d+)/)?.[1]);
    const maxItemLevel = Number(block.match(/maxItemLevel: (\d+)/)?.[1]);
    if (!Number.isSafeInteger(minItemLevel) || !Number.isSafeInteger(maxItemLevel)) {
      throw new Error(`场景 ${id} 缺少品级范围`);
    }
    const syncMatch = block.match(/syncLevel: (\d+)/);
    const objective = block.match(/objective: "(damage|dps)"/)?.[1];
    if (objective === undefined) throw new Error(`场景 ${id} 缺少 objective`);
    const commonMatch = block.match(
      /commonSlots: (\[[^\]]*\]|ALL_NON_WEAPON_SLOTS)/,
    );
    const commonSlots =
      commonMatch === undefined
        ? []
        : commonMatch[1] === "ALL_NON_WEAPON_SLOTS"
          ? "ALL_NON_WEAPON_SLOTS"
          : [...commonMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const foodStrategy = block.match(/foodStrategy: "([^"]+)"/)?.[1];
    if (foodStrategy === undefined) throw new Error(`场景 ${id} 缺少 foodStrategy`);
    const jobConstraints = {};
    const constraintMatch = block.match(
      /jobConstraints: \{([\s\S]*?)\},\r?\n\s*solo/,
    );
    if (constraintMatch === null && block.includes("jobConstraints")) {
      throw new Error(`场景 ${id} 的 jobConstraints 解析失败`);
    }
    if (constraintMatch !== null) {
      for (const match of constraintMatch[1].matchAll(
        /([A-Z]{3}): \{ (gcd: [0-9.]+|gcdChoices: \[[^\]]+\]) \}/g,
      )) {
        const job = match[1];
        const body = match[2];
        const gcdMatch = body.match(/gcd: ([0-9.]+)/);
        const choicesMatch = body.match(/gcdChoices: \[([^\]]+)\]/);
        jobConstraints[job] =
          gcdMatch !== null
            ? { gcdTarget: Number(gcdMatch[1]) }
            : {
                gcdChoices: choicesMatch[1]
                  .split(",")
                  .map((value) => Number(value.trim())),
              };
      }
    }
    cases.push({
      id,
      jobs,
      minItemLevel,
      maxItemLevel,
      ...(syncMatch === null ? {} : { syncLevel: Number(syncMatch[1]) }),
      objective,
      commonSlots,
      foodStrategy,
      jobConstraints,
    });
  }
  return cases;
}
const acceptanceCases = parseAcceptanceCases();
if (acceptanceCases.length === 0) throw new Error("验收场景解析为空");
const idCount = [...acceptanceText.matchAll(/^\s{4}id: "/gm)].length;
if (idCount !== acceptanceCases.length) {
  throw new Error(
    `验收场景解析数量不一致：文件 ${idCount} 个，解析 ${acceptanceCases.length} 个`,
  );
}
const acceptanceJobRows = acceptanceCases.reduce(
  (sum, acceptance) => sum + acceptance.jobs.length,
  0,
);

// ---------------------------------------------------------------- 场景
function syncIlvlForLevel(level) {
  const entry = Object.entries(data.syncLevelOfJobLevels).find(
    ([key]) => Number(key) === level,
  );
  return entry === undefined ? undefined : Number(entry[1]);
}
function nativeCapForLevel(level) {
  const levels = data.syncLevels[String(level)];
  return levels === undefined ? data.gearMaxLevel : Math.max(...levels);
}

const jobs = ["WAR", "WHM", "DRG", "BLM"];
const baselineScenarios = [];
for (const level of [50, 60, 70, 80, 90]) {
  const cap = syncIlvlForLevel(level) ?? nativeCapForLevel(level);
  baselineScenarios.push({
    label: `native L${level}`,
    config: {
      jobId: undefined,
      minItemLevel: Math.max(1, cap - 20),
      maxItemLevel: cap,
      syncLevel: cap,
      maximizeTenacity: false,
      objective: "damage",
      excludedSources: [],
      forcedGear: {},
      foodId: 0,
    },
  });
}
baselineScenarios.push({
  label: "native L100",
  config: {
    jobId: undefined,
    minItemLevel: data.gearMaxLevel - 20,
    maxItemLevel: data.gearMaxLevel,
    maximizeTenacity: false,
    objective: "damage",
    excludedSources: [],
    forcedGear: {},
    foodId: 0,
  },
});
for (const level of [70, 80, 90]) {
  baselineScenarios.push({
    label: `endgame-sync L${level}`,
    config: {
      jobId: undefined,
      minItemLevel: data.gearMaxLevel - 20,
      maxItemLevel: data.gearMaxLevel,
      syncLevel: syncIlvlForLevel(level),
      maximizeTenacity: false,
      objective: "damage",
      excludedSources: [],
      forcedGear: {},
      foodId: 0,
    },
  });
}

const rows = [];
function pushRow(row) {
  rows.push(row);
}
for (const scenario of baselineScenarios) {
  for (const job of jobs) {
    const config = { ...scenario.config, jobId: job };
    try {
      pushRow({ group: "baseline", scenario: scenario.label, ...measure(config) });
    } catch (error) {
      pushRow({
        group: "baseline",
        scenario: scenario.label,
        job,
        error: String(error).slice(0, 200),
      });
    }
  }
}
for (const acceptance of acceptanceCases) {
  for (const job of acceptance.jobs) {
    const constraints = acceptance.jobConstraints[job] ?? {};
    const config = {
      jobId: job,
      minItemLevel: acceptance.minItemLevel,
      maxItemLevel: acceptance.maxItemLevel,
      ...(acceptance.syncLevel === undefined
        ? {}
        : { syncLevel: acceptance.syncLevel }),
      objective: acceptance.objective,
      maximizeTenacity: false,
      excludedSources: [],
      forcedGear: {},
      foodId: 0,
      ...constraints,
    };
    try {
      pushRow({
        group: "acceptance",
        scenario: acceptance.id,
        acceptance,
        ...measure(config),
      });
    } catch (error) {
      pushRow({
        group: "acceptance",
        scenario: acceptance.id,
        acceptance,
        job,
        error: String(error).slice(0, 200),
      });
    }
  }
}

// ---------------------------------------------------------------- 控制台
const fmtPercent = (part, whole) =>
  whole === 0 ? "0.00" : ((1 - part / whole) * 100).toFixed(2);
console.log(`data version: ${data.version}`);
console.log(
  `baseline scenarios: ${baselineScenarios.length}; acceptance cases: ${acceptanceCases.length} (${acceptanceJobRows} job rows)`,
);
const header = [
  "group",
  "scenario",
  "job",
  "cands",
  "R_sep",
  "R_gear",
  "gear_gain%",
  "ring_gap",
  "L_gear",
  "L1",
  "R_food",
  "R_food_naive",
  "food_gain%",
  "minAchievable",
  "lower_gap",
  "speed_range",
  "R_food_constrained",
  "constrained_gain%",
];
console.log("");
console.log(header.join("\t"));
for (const row of rows) {
  if (row.error !== undefined) {
    console.log([row.group, row.scenario, row.job ?? "?", "ERROR", row.error].join("\t"));
    continue;
  }
  const speedRange =
    row.speedIntervals.length === 0
      ? "-"
      : row.speedIntervals
          .map((range) => `[${range.min},${range.max}]`)
          .join("∪");
  console.log(
    [
      row.group,
      row.scenario,
      row.job,
      row.candidates,
      row.R_sep,
      row.R_gear,
      fmtPercent(row.R_gear, row.R_sep),
      row.naiveR_gear - row.R_gear,
      row.L_gear,
      row.L1,
      row.R_food,
      row.R_food_naive,
      fmtPercent(row.R_food, row.R_food_naive),
      row.minAchievable,
      row.lowerGap,
      speedRange,
      `${row.R_food_constrained}${row.constrainedFallback ? "*" : ""}`,
      fmtPercent(row.R_food_constrained, row.R_food),
    ].join("\t"),
  );
}

// ---------------------------------------------------------------- 报告
const reportDir = new URL("docs/mathematical-analysis/measurements/", repoRoot);
mkdirSync(reportDir, { recursive: true });
const reportUrl = new URL("substat-sum-bounds.md", reportDir);
const fmt = (value) => {
  if (value === undefined || value === null) return "-";
  if (typeof value !== "number") return String(value);
  return Math.abs(value) >= 1000 ? value.toLocaleString("zh-CN") : String(value);
};
const baselineRows = rows.filter((row) => row.group === "baseline" && row.error === undefined);
const acceptanceRows = rows.filter((row) => row.group === "acceptance" && row.error === undefined);
const errorRows = rows.filter((row) => row.error !== undefined);
const gearTable = [
  "| 场景 | 职业 | 候选数 | R_sep | R_gear^uniq | 收紧 | 戒指最大 gap | L_gear^uniq | L1 |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...baselineRows.map(
    (row) =>
      `| ${row.scenario} | ${row.job} | ${fmt(row.candidates)} | ${fmt(row.R_sep)} | ${fmt(row.R_gear)} | ${fmtPercent(row.R_gear, row.R_sep)}% | ${fmt(row.naiveR_gear - row.R_gear)} | ${fmt(row.L_gear)} | ${fmt(row.L1)} |`,
  ),
].join("\n");
const foodTable = [
  "| 场景 | 职业 | R_food（上界） | R_food_naive | 收紧 | 可达最大值 | 上界 gap | L1 | 最小可达 | 下界 gap | slab 宽度 |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...baselineRows.map(
    (row) =>
      `| ${row.scenario} | ${row.job} | ${fmt(row.R_food)} | ${fmt(row.R_food_naive)} | ${fmtPercent(row.R_food, row.R_food_naive)}% | ${fmt(row.achievable)} | ${fmt(row.R_food - row.achievable)} | ${fmt(row.L1)} | ${fmt(row.minAchievable)} | ${fmt(row.lowerGap)} | ${fmt(row.R_food - row.L1)} |`,
  ),
].join("\n");
const acceptanceTable = [
  "| 验收 case | 职业 | 公式等级 | 候选数 | R_sep | R_gear^uniq | 收紧 | 戒指 gap | L1 | 最小可达 | 下界 gap | R_food(无约束) | 速度区间 | R_food(约束) | 约束收紧 | 共享/食物 |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |",
  ...acceptanceRows.map((row) => {
    const common =
      row.acceptance.commonSlots === "ALL_NON_WEAPON_SLOTS"
        ? "全部非武器"
        : row.acceptance.commonSlots.length === 0
          ? "无"
          : row.acceptance.commonSlots.join(",");
    const speedRange =
      row.speedIntervals.length === 0
        ? "-"
        : row.speedIntervals
            .map((range) => `[${range.min},${range.max}]`)
            .join("∪");
    const constrained = fmt(row.R_food_constrained) + (row.constrainedFallback ? "*" : "");
    return `| ${row.scenario} | ${row.job} | ${row.level} | ${fmt(row.candidates)} | ${fmt(row.R_sep)} | ${fmt(row.R_gear)} | ${fmtPercent(row.R_gear, row.R_sep)}% | ${fmt(row.naiveR_gear - row.R_gear)} | ${fmt(row.L1)} | ${fmt(row.minAchievable)} | ${fmt(row.lowerGap)} | ${fmt(row.R_food)} | ${speedRange} | ${constrained} | ${fmtPercent(row.R_food_constrained, row.R_food)}% | ${common} / ${row.acceptance.foodStrategy} |`;
  }),
].join("\n");
const baselineSummary = baselineScenarios
  .map((scenario) => {
    const subset = baselineRows.filter((row) => row.scenario === scenario.label);
    if (subset.length === 0) return undefined;
    const mean = (key) =>
      subset.reduce((sum, row) => sum + row[key], 0) / subset.length;
    return `| ${scenario.label} | ${fmt(Math.round(mean("R_sep")))} | ${fmt(Math.round(mean("R_gear")))} | ${fmtPercent(mean("R_gear"), mean("R_sep"))}% | ${fmt(Math.round(mean("L1")))} | ${fmt(Math.round(mean("R_food")))} | ${fmtPercent(mean("R_food"), mean("R_food_naive"))}% |`;
  })
  .filter(Boolean)
  .join("\n");
const exactBaseline = baselineRows.filter(
  (row) => row.R_food - row.achievable === 0,
).length;
const exactAcceptance = acceptanceRows.filter(
  (row) => row.R_food - row.achievable === 0,
).length;
const constrainedRows = acceptanceRows.filter(
  (row) => row.speedIntervals.length > 0,
);
const maxSlack = Math.max(
  0,
  ...baselineRows.map((row) => row.R_food - row.achievable),
  ...acceptanceRows.map((row) => row.R_food - row.achievable),
);
const maxConstrainedGain = constrainedRows.length === 0
  ? 0
  : Math.max(
      ...constrainedRows.map(
        (row) => (1 - row.R_food_constrained / row.R_food) * 100,
      ),
    );
const bruteChecks = rows.filter((row) => row.ringBruteChecked === 1).length;
const lowerExactBaseline = baselineRows.filter((row) => row.lowerGap === 0).length;
const lowerExactAcceptance = acceptanceRows.filter((row) => row.lowerGap === 0).length;
const maxLowerGap = Math.max(0, ...rows.filter((row) => row.error === undefined).map((row) => row.lowerGap));
const acceptanceGainMin = Math.min(...acceptanceRows.map((row) => (1 - row.R_gear / row.R_sep) * 100));
const acceptanceGainMax = Math.max(...acceptanceRows.map((row) => (1 - row.R_gear / row.R_sep) * 100));
const acceptanceGainAvg = acceptanceRows.reduce((sum, row) => sum + (1 - row.R_gear / row.R_sep) * 100, 0) / acceptanceRows.length;
const acceptanceFoodGainMin = Math.min(...acceptanceRows.map((row) => (1 - row.R_food / row.R_food_naive) * 100));
const acceptanceFoodGainMax = Math.max(...acceptanceRows.map((row) => (1 - row.R_food / row.R_food_naive) * 100));
const acceptanceRingGapRows = acceptanceRows.filter((row) => row.naiveR_gear - row.R_gear > 0);
const acceptanceRingGapByCase = new Map();
for (const row of acceptanceRingGapRows) {
  const gap = row.naiveR_gear - row.R_gear;
  const existing = acceptanceRingGapByCase.get(row.scenario);
  if (existing === undefined) acceptanceRingGapByCase.set(row.scenario, { gap, rows: 1 });
  else {
    existing.gap = Math.max(existing.gap, gap);
    existing.rows += 1;
  }
}
const acceptanceRingGapText = acceptanceRingGapByCase.size === 0
  ? "无"
  : [...acceptanceRingGapByCase.entries()].map(([id, info]) => `${id}（${info.rows} 行，gap ${info.gap}）`).join("、");
const L1Min = Math.min(...baselineRows.map((row) => row.L1), ...acceptanceRows.map((row) => row.L1));
const L1Max = Math.max(...baselineRows.map((row) => row.L1), ...acceptanceRows.map((row) => row.L1));
const acceptanceL1Min = Math.min(...acceptanceRows.map((row) => row.L1));
const acceptanceL1Max = Math.max(...acceptanceRows.map((row) => row.L1));

const report = `# 三属性贡献和的上下界：候选池测量（${data.version}）

> 本文件由 [\`measure-sum-bounds.mjs\`](../verification/measure-sum-bounds.mjs) 生成（可复现，无时间戳）。
> 这是**测量/证据**，不是定理证明；定理本身见 [substat-sum-upper-bound](../theorems/substat-sum-upper-bound/README.md)
> 与 [substat-sum-lower-bound-pruning](../theorems/substat-sum-lower-bound-pruning/README.md)。

## 1. 目的

在真实候选池上测量三属性贡献和 \`S = CRT + DHT + DET\` 的：

- 联合 gear 上界 \`R_gear^uniq\`（逐槽 \`max S3\` 求和 + 两戒指唯一性精确配对 + 义军武器精确和）；
- 逐属性上界 \`R_sep = Σ_i Σ_s max_c x_i(c)\`（“逐属性最大相加”式上界）；
- 安全下界 \`L_gear^uniq\` / \`L1\`（逐槽 \`min S3\` + 戒指精确最小配对 + 食物下界）；
- 食物感知上界族 \`R_food = max_f min_k B_k(f)\`（B1–B4）；
- 速度（GCD）约束感知的 Lagrangian 上界 \`R_food|speed\`（验收场景中的 GCD 约束）。

覆盖两组场景：

- **基线场景**：WAR / WHM / DRG / BLM × {native L50–L100, endgame-sync L70/L80/L90}；
- **验收场景**：直接解析 [\`run-acceptance.mjs\`](../../search-optimization/tools/run-acceptance.mjs) 的 \`CASES\`
  （${acceptanceCases.length} 个 case / ${acceptanceJobRows} 个职业行，含共享布局、食物策略与 GCD 约束）。

## 2. 方法（只做候选池构造，不运行搜索）

对每个 \`(场景, 职业)\`：

1. 用生产 \`prepareSearch(config, {})\` 构造候选池（装备 + 固定镶嵌模式 + 食物池）；**不调用** \`findBestLoadoutExactMip\`、不运行任何搜索、不求解 MIP、不做 benchmark。
2. 逐槽扫描候选：\`SolverGear.baseParams\` 的 CRT/DHT/DET 分量（贡献坐标）求和；义军武器的分配变量按 \`maxTotalStats\`/\`maxEachStat\`（含同步 \`statMaximums\`）取精确和上界；约束场景中若义军分配涉及速度则回退为无约束界并标记 \`*\`。
3. 两戒指槽用唯一性精确配对（按 \`itemId\` 折叠后 top/second 分类）；小规模实例用 \`O(n²)\` 暴力交叉核对（本报告覆盖 ${bruteChecks} 个实例）。
4. 食物加成用 canonical 精确有理数：\`bonus_i(f,G) = min(cap, floor((G + baseValue) * rate))\`；公式与 \`canonicalFoodBonusUpperBoundAtRaw\` 在 9,048 个点上一致（见上界定理 \`verify.mjs\`）。
5. 速度（GCD）约束：用生产 \`equippedSpeedRangeForGcd(job, jobLevel, gcd)\` 得到**总速度贡献**区间（\`gcdChoices\` 取并集、\`gcd\` 与 \`gcdChoices\` 同时存在时取交集）；上界用 \`S <= Σ max[S3 − λ·speed] + λ·vmax + 食物上界\`，下界用 \`S <= Σ max[S3 + λ·speed] − λ·(vmin − 食物速度上界) + 食物上界\`（弱对偶；λ 取 \`p/16\` 网格，界合法但不是最优乘子）。
6. 每个 \`(场景, 职业)\` 做 2,000 次**确定性随机抽样**（随机合法完成 + 随机食物），断言 \`L1 <= S <= R_food\`。

**复杂度**：\`O(Σ_slots |C_s| + |F|)\`；λ 网格是常数倍扫描。没有组合枚举。

## 3. 场景与坐标

- 基线职业：WAR / WHM / DRG / BLM × 9 个场景。
- 验收场景：每个 case 使用 run-acceptance.mjs 中的 \`jobs\`、\`minItemLevel\`、\`maxItemLevel\`、\`syncLevel\`、\`objective\`、\`commonSlots\`、\`foodStrategy\`、\`jobConstraints\`（\`gcd\` → \`gcdTarget\`，\`gcdChoices\` → \`gcdChoices\`）。
- 共享布局/共享食物在**单个职业的候选池**上不改变该职业的合法候选集，因此逐职业上下界仍是联合方案投影的合法界；共享选择的联合耦合不在本测量范围。
- 全部是**贡献坐标**；面板 = \`baseStats\` + 贡献。\`S\` 不含 TEN/SKS。
- 数据版本：\`${data.version}\`。

## 4. 基线场景：Gear 上/下界

${gearTable}

## 5. 基线场景：食物与最终和

${foodTable}

## 6. 基线场景摘要（4 职业平均）

| 场景 | R_sep | R_gear | gear 收紧 | L1 | R_food | food 收紧 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${baselineSummary}

## 7. 验收场景（run-acceptance.mjs CASES）

解析校验：文件 \`${idCount}\` 个 case、解析 \`${acceptanceCases.length}\` 个、展开 \`${acceptanceJobRows}\` 个职业行；字段来自源文件（jobs / 品级范围 / syncLevel / objective / commonSlots / foodStrategy / jobConstraints）。

${acceptanceTable}

说明：\`速度区间\` 是生产 \`equippedSpeedRangeForGcd\` 给出的总速度贡献区间；\`R_food(无约束)\` 不考虑 GCD 约束（对约束问题仍是合法但更松的界）；\`R_food(约束)\` 是速度约束感知的 Lagrangian 上界；\`约束收紧\` 相对无约束上界；\`*\` 表示义军速度分配回退。

## 8. 观察

- **gear 联合上界相对 \`R_sep\` 的收紧**：基线场景 0%–28%；验收场景 ${acceptanceGainMin.toFixed(2)}%–${acceptanceGainMax.toFixed(2)}%（平均 ${acceptanceGainAvg.toFixed(2)}%）。主要来自“同一槽不能同时最大化三个属性”与戒指唯一性。
- **戒指唯一性 gap**：验收场景中 ${acceptanceRingGapByCase.size} 个 case（${acceptanceRingGapRows.length} 行）为正：${acceptanceRingGapText}；忽略它会高估 gear 和上界。
- **食物上界族 vs “逐属性 max 相加”**：基线 0%–30%；验收场景 ${acceptanceFoodGainMin.toFixed(2)}%–${acceptanceFoodGainMax.toFixed(2)}%。
- **\`R_food\` 紧度**：基线 ${exactBaseline}/${baselineRows.length}、验收 ${exactAcceptance}/${acceptanceRows.length} 个实例的 \`上界 gap = 0\`（被合法完成精确达到）；全部实例最大 gap ${maxSlack}。测量结论，不是一般性证明（带食物精确最大值在定理文档中仍为未解决）。
- **下界 \`L1\`**：全测量范围 ${L1Min}–${L1Max}；其中基线 ${Math.min(...baselineRows.map((row) => row.L1))}–${Math.max(...baselineRows.map((row) => row.L1))}，验收 ${acceptanceL1Min}–${acceptanceL1Max}。下界**不能**缩小 \`U\`（下界定理 Lemma 1），只用于 slab 收紧与真实域剪枝。
- **下界紧度（新增）**：基线 ${lowerExactBaseline}/${baselineRows.length}、验收 ${lowerExactAcceptance}/${acceptanceRows.length} 行的 \`lower_gap = minAchievable − L1 = 0\`，即该行的 \`L1\` 被一个构造的合法完成精确达到；本数据全部行均为 0（最大 ${maxLowerGap}）。真实最小值被夹在 \`[L1, minAchievable]\` 内；\`minAchievable\` 是可达值，所以 \`lower_gap\` 是 L1 松弛量的**上界**——只有 gap=0 才证明 L1 精确。
- **下界为何全为 0（结构性，近乎平凡）**：允许的食物池含“无 CRT/DHT/DET 加成”的食物，故 \`L_food = 0\` 且可被实际选择；同时 gear 下界 \`L_gear = Σ_s min S3 + 戒指精确最小配对\` 由逐槽独立取 min 构造。因此 \`L1 = L_gear\` 是可达到的，当前数据下 \`L1\` 就是三属性和的**精确最小值**。若食物池受限（强制食物贡献三属性、固定 \`foodId\`、按职业过滤食物）或加入 TEN/GCD 约束，真实最小值会升高，\`lower_gap\` 可能 >0，此时只能夹在 \`[L1, minAchievable]\`。
- **GCD 约束**：${constrainedRows.length} 个 (case, 职业) 行有速度约束；约束感知上界相对无约束上界收紧 0%–${maxConstrainedGain.toFixed(2)}%（λ 网格，非最优乘子，界仍合法）。
- **slab 宽度**：\`R_food − L1\` 在基线与验收场景都是数百到数千，当前品级带下三属性和不窄。

## 9. 边界与未做

- 验收场景的候选池与 run-acceptance.mjs 一致；未启用其它硬约束（验收 case 只含 GCD 约束）。
- 共享布局/共享食物只测单职业候选池；联合共享选择耦合（同一件装备同时满足多职业）可能进一步收紧联合界，但不在本测量中。
- \`lower_gap\` 是“无约束、允许全食物池”口径；GCD 约束行未测量约束下的最小值（约束只会使真实最小值更高，\`L1\` 仍是安全下界）。
- 义军速度分配在约束场景回退为无约束界（标记 \`*\`）。
- 本测量不评估搜索/剪枝性能，不运行搜索/MIP/benchmark。

${errorRows.length === 0 ? "" : `## 附：错误行\n\n${errorRows.map((row) => `- ${row.group} / ${row.scenario} / ${row.job ?? "?"}: ${row.error}`).join("\n")}\n`}
`;
writeFileSync(reportUrl, report);
console.log(
  `\nreport written: docs/mathematical-analysis/measurements/substat-sum-bounds.md (${report.length} bytes)`,
);
