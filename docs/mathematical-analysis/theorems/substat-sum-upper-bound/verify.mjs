/**
 * substat-sum-upper-bound/verify.mjs
 *
 * 目的：为 docs/mathematical-analysis/theorems/substat-sum-upper-bound/README.md 提供
 * **有限合成实例上的精确证书**（本定理主要是属性级，不依赖伤害因子）：
 *   T1  R_sep（逐属性最大相加）与 R_gear（逐槽 S3 最大相加）的关系、精确性与严格分离例子；
 *   T2  戒指唯一性下两戒指槽的最大 S3 和：精确配对算法 vs 暴力枚举；
 *   T3  义军武器整数分配的总和最大值（线性目标）与逐属性上界的高估；
 *   T4  食物感知上界族 B1–B4 的合法性、支配/不可比例子、R_food = max_f min_k B_k(f)；
 *   T5  速度上界 / TEN 下界的 Lagrangian 上界：合法性、对乘子的精确最小化、积分间隙反例；
 *   T6  部分分支 R_rem(P) 的合法性 + 随 P 增大单调不增；
 *   T7  sum-only 类内最紧：U 对 R 的单调性（引用/有限复核）+ 最小合法增量预算
 *       R* = S* − Σ_i b_i（相对 baseline 的增量；非零 baseline 用例）；
 *   T8  层级/支配关系与严格分离数值；
 *   另：食物加成公式与生产 canonical 实现逐点对照；baseStat 偏移（sub/sub/main）核对。
 *
 * 覆盖范围：显式列出的小型合成实例（2–3 槽 × 2–4 候选，≤2 食物，含/不含约束、戒指唯一性），
 *          逐点穷举全部合法组合；所有比较用精确有理数（BigInt）或整数，不抽样、不用浮点作判断。
 *
 * 证明作用：有限实例上的证书与反例；一般性证明见 README.md。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/substat-sum-upper-bound/verify.mjs
 */
import { canonicalFoodBonusAtRawWithRate } from "../../../../src/domain/search/exact-mip-candidate-upper-bound.ts";
import { DOCUMENTED_LEVEL_PARAMS, assert, factorsAt } from "../../verification/canonical-model.mjs";

// ---------------------------------------------------------------------------
// 0. 精确有理数工具（所有上界/比较都用整数或 BigInt 分数，不用浮点判断）
// ---------------------------------------------------------------------------
function gcdBig(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

/** 分数 n/d（d > 0，既约）。 */
function F(n, d = 1n) {
  let numerator = BigInt(n);
  let denominator = BigInt(d);
  if (denominator === 0n) throw new Error("分母为 0");
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = gcdBig(numerator, denominator) || 1n;
  return { n: numerator / divisor, d: denominator / divisor };
}

function fadd(a, b) {
  return F(a.n * b.d + b.n * a.d, a.d * b.d);
}
function fsub(a, b) {
  return F(a.n * b.d - b.n * a.d, a.d * b.d);
}
function fmul(a, b) {
  return F(a.n * b.n, a.d * b.d);
}
function fcmp(a, b) {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}
function fmin(a, b) {
  return fcmp(a, b) <= 0 ? a : b;
}
function fmax(a, b) {
  return fcmp(a, b) >= 0 ? a : b;
}
function ffloor(a) {
  const quotient = a.n / a.d;
  return a.n % a.d !== 0n && a.n < 0n ? quotient - 1n : quotient;
}
function ftoNumber(a) {
  return Number(a.n) / Number(a.d);
}
function fshow(a) {
  return a.d === 1n ? `${a.n}` : `${a.n}/${a.d}（≈${ftoNumber(a).toFixed(6)}）`;
}
function isZeroFraction(a) {
  return a.n === 0n;
}

const report = [];
let checks = 0;
function record(name, detail) {
  report.push({ name, detail });
}
function check(condition, message) {
  checks += 1;
  assert(condition, message);
}

// ---------------------------------------------------------------------------
// 1. 食物加成公式（贡献坐标；与生产 canonical 实现对照见 §6）
//     bonus_i(f, G) = min(cap_i^f, floor((G + base_i) * p_i^f / q_i^f))
//     p/q = statRate/100 的既约形式；无参数 → 0。
// ---------------------------------------------------------------------------
function bonusOf(param, gearContribution) {
  if (param === undefined) return 0;
  const { cap, numerator, denominator, base } = param;
  if (cap <= 0 || numerator === 0) return 0;
  const raw = BigInt(gearContribution) + BigInt(base);
  let uncapped = (raw * BigInt(numerator)) / BigInt(denominator);
  if (raw < 0n) throw new Error("食物 raw 为负");
  if (uncapped > BigInt(cap)) uncapped = BigInt(cap);
  return Number(uncapped);
}

function makeFood(name, paramSpecs) {
  // paramSpecs: { CRT?: {cap, ratePercent, base}, ... }；ratePercent 为整数百分比
  const params = {};
  for (const [attribute, spec] of Object.entries(paramSpecs)) {
    const mode = spec.mode ?? "absolute";
    if (mode === "absolute") {
      if (spec.ratePercent !== undefined) throw new Error("absolute 食物不应带 ratePercent");
      params[attribute] = { cap: spec.cap, numerator: 0, denominator: 1, base: spec.base ?? 0 };
      continue;
    }
    const rate = F(BigInt(spec.ratePercent), 100n);
    params[attribute] = {
      cap: spec.cap,
      numerator: Number(rate.n),
      denominator: Number(rate.d),
      base: spec.base ?? 0,
    };
  }
  return { name, params };
}

// ---------------------------------------------------------------------------
// 2. 合成实例模型
//    slot candidate: { x:[CRT,DHT,DET] 贡献, speed, ten, itemId?, unique? }
//    instance: { name, slots:[{candidates}], ringPair?: {a,b}, foods:[], allowNoFood,
//                speedMax?, tenMin?, tenMax? }
//    坐标声明：x/speed/ten 都是贡献（面板 = 等级/种族基础 + 贡献）。
// ---------------------------------------------------------------------------
const ATTRIBUTES = ["CRT", "DHT", "DET"];

function enumerateCompletions(instance) {
  const choices = instance.slots.map(() => []);
  const results = [];
  const n = instance.slots.length;
  const pick = new Array(n).fill(0);
  const build = (slotIndex) => {
    if (slotIndex === n) {
      // 戒指唯一性过滤
      if (instance.ringPair !== undefined) {
        const { a, b } = instance.ringPair;
        const candidateA = instance.slots[a].candidates[pick[a]];
        const candidateB = instance.slots[b].candidates[pick[b]];
        const sameItem = candidateA.itemId === candidateB.itemId;
        if (sameItem) {
          if (candidateA.unique !== candidateB.unique) {
            throw new Error("同一 itemId 的 unique 元数据不一致");
          }
          if (candidateA.unique === true) return;
        }
      }
      const gear = [0, 0, 0];
      let speed = 0;
      let ten = 0;
      for (let slotIndex = 0; slotIndex < n; slotIndex += 1) {
        const candidate = instance.slots[slotIndex].candidates[pick[slotIndex]];
        for (let i = 0; i < 3; i += 1) gear[i] += candidate.x[i];
        speed += candidate.speed ?? 0;
        ten += candidate.ten ?? 0;
      }
      const foodIndexes = instance.foods.map((_, index) => index);
      const foodChoices = instance.allowNoFood ? [...foodIndexes, null] : foodIndexes;
      for (const foodIndex of foodChoices) {
        const food = foodIndex === null ? null : instance.foods[foodIndex];
        const bonuses = ATTRIBUTES.map((attribute) =>
          bonusOf(food?.params[attribute], gear[ATTRIBUTES.indexOf(attribute)]));
        const finalSpeed = speed + bonusOf(food?.params.SKS ?? food?.params.SPS, speed);
        const finalTen = ten + bonusOf(food?.params.TEN, ten);
        const sum = gear.reduce((total, value, i) => total + value + bonuses[i], 0);
        results.push({
          picks: pick.slice(),
          food: foodIndex,
          gear: gear.slice(),
          bonuses,
          finalSpeed,
          finalTen,
          sum,
          speed,
          ten,
        });
      }
      return;
    }
    const candidates = instance.slots[slotIndex].candidates;
    for (let index = 0; index < candidates.length; index += 1) {
      pick[slotIndex] = index;
      build(slotIndex + 1);
    }
  };
  build(0);
  return results;
}

function isFeasible(instance, completion) {
  if (instance.speedMax !== undefined && completion.finalSpeed > instance.speedMax) return false;
  if (instance.speedMin !== undefined && completion.finalSpeed < instance.speedMin) return false;
  if (instance.tenMin !== undefined && completion.finalTen < instance.tenMin) return false;
  if (instance.tenMax !== undefined && completion.finalTen > instance.tenMax) return false;
  return true;
}

function analyze(instance) {
  const all = enumerateCompletions(instance);
  const feasible = all.filter((completion) => isFeasible(instance, completion));
  check(feasible.length > 0, `${instance.name}: 可行域为空，无法验证`);
  const best = feasible.reduce((left, right) => (right.sum > left.sum ? right : left));
  const bestUnconstrained = all.reduce((left, right) => (right.sum > left.sum ? right : left));
  return { all, feasible, best, bestUnconstrained };
}

// ---------------------------------------------------------------------------
// 3. Gear 部分的量：R_gear / R_sep / 戒指配对
// ---------------------------------------------------------------------------
function slotMaxS3(slot) {
  let best = -Infinity;
  for (const candidate of slot.candidates) {
    const sum = candidate.x[0] + candidate.x[1] + candidate.x[2];
    if (sum > best) best = sum;
  }
  return best;
}

function slotMaxAttribute(slot, attributeIndex) {
  let best = -Infinity;
  for (const candidate of slot.candidates) {
    const value = candidate.x[attributeIndex];
    if (value > best) best = value;
  }
  return best;
}

/**
 * 戒指唯一性下的精确配对最大值（算法见 README 定理 2）：
 * 1) 每侧按 itemId 折叠，只保留该 item 的最大 S3；
 * 2) 若两侧最优 item 不同 → 直接相加（不同物品总是合法）；
 * 3) 若相同且该物品 non-unique → 直接相加（同 ID 非唯一允许）；
 * 4) 若相同且 unique → 必须至少一侧换 item：max(次优A+优B, 优A+次优B)。
 */
function ringPairExactMaximum(slotA, slotB) {
  const collapse = (slot) => {
    const byItem = new Map();
    for (const candidate of slot.candidates) {
      if (candidate.itemId === undefined) throw new Error("戒指候选缺少 itemId");
      const sum = candidate.x[0] + candidate.x[1] + candidate.x[2];
      const existing = byItem.get(candidate.itemId);
      if (existing === undefined || sum > existing.sum) {
        byItem.set(candidate.itemId, { itemId: candidate.itemId, unique: candidate.unique === true, sum });
      } else if (existing.unique !== (candidate.unique === true)) {
        throw new Error("同一 itemId 的 unique 元数据不一致");
      }
    }
    return [...byItem.values()].sort((left, right) =>
      right.sum - left.sum || left.itemId - right.itemId);
  };
  const left = collapse(slotA);
  const right = collapse(slotB);
  check(left.length > 0 && right.length > 0, "戒指槽候选为空");
  const topLeft = left[0];
  const topRight = right[0];
  if (topLeft.itemId !== topRight.itemId) return topLeft.sum + topRight.sum;
  const sameIdUnique = topLeft.unique || topRight.unique;
  if (!sameIdUnique) return topLeft.sum + topRight.sum;
  const secondLeft = left.find((entry) => entry.itemId !== topLeft.itemId);
  const secondRight = right.find((entry) => entry.itemId !== topRight.itemId);
  let best = -Infinity;
  if (secondLeft !== undefined) best = Math.max(best, secondLeft.sum + topRight.sum);
  if (secondRight !== undefined) best = Math.max(best, topLeft.sum + secondRight.sum);
  return best;
}

function ringPairBruteMaximum(slotA, slotB) {
  let best = -Infinity;
  for (const candidateA of slotA.candidates) {
    for (const candidateB of slotB.candidates) {
      if (candidateA.itemId === candidateB.itemId && candidateA.unique === true) continue;
      const sum = candidateA.x[0] + candidateA.x[1] + candidateA.x[2] +
        candidateB.x[0] + candidateB.x[1] + candidateB.x[2];
      if (sum > best) best = sum;
    }
  }
  return best;
}

function gearBounds(instance) {
  const slotMaxima = instance.slots.map(slotMaxS3);
  let independentlySummed = 0;
  for (const maximum of slotMaxima) independentlySummed += maximum;
  // 逐属性最大相加（R_sep）：每个属性各自取所有槽的最大再相加
  const attributeMaxima = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    for (const slot of instance.slots) attributeMaxima[i] += slotMaxAttribute(slot, i);
  }
  const separable = attributeMaxima.reduce((total, value) => total + value, 0);
  // 含戒指唯一性的精确 gear 和
  let exactGearSum;
  if (instance.ringPair !== undefined) {
    const { a, b } = instance.ringPair;
    let sum = 0;
    for (let slotIndex = 0; slotIndex < instance.slots.length; slotIndex += 1) {
      if (slotIndex === a || slotIndex === b) continue;
      sum += slotMaxima[slotIndex];
    }
    sum += ringPairExactMaximum(instance.slots[a], instance.slots[b]);
    exactGearSum = sum;
  } else {
    exactGearSum = independentlySummed;
  }
  return {
    slotMaxima,
    independentlySummed,
    exactGearSum,
    separable,
    attributeMaxima,
  };
}

// ---------------------------------------------------------------------------
// 4. 食物感知上界族 B1–B4（每个 f 单独构造；⊥ 视作零参数）
// ---------------------------------------------------------------------------
function foodBounds(instance, food) {
  const gear = gearBounds(instance);
  const R_gear = F(gear.exactGearSum);
  const R_sep = F(gear.separable);
  const Gmax = gear.attributeMaxima;
  const caps = ATTRIBUTES.map((attribute) => F(food?.params[attribute]?.cap ?? 0));
  const bonusAtGmax = ATTRIBUTES.map((attribute, i) =>
    F(bonusOf(food?.params[attribute], Gmax[i])));
  // B1 = R_gear + Σ cap
  let B1 = R_gear;
  for (const cap of caps) B1 = fadd(B1, cap);
  // B2 = R_sep + Σ bonus(Gmax)
  let B2 = R_sep;
  for (const bonus of bonusAtGmax) B2 = fadd(B2, bonus);
  // B4 = R_gear + Σ bonus(Gmax)
  let B4 = R_gear;
  for (const bonus of bonusAtGmax) B4 = fadd(B4, bonus);
  // B3 = Σ_s max_c Σ_i (1+r_i) x_i(c) + Σ_i r_i base_i
  const rates = ATTRIBUTES.map((attribute) => {
    const param = food?.params[attribute];
    if (param === undefined || param.numerator === 0) return F(0n);
    return F(BigInt(param.numerator), BigInt(param.denominator));
  });
  let B3 = F(0n);
  for (const slot of instance.slots) {
    let slotBest = null;
    for (const candidate of slot.candidates) {
      let weighted = F(0n);
      for (let i = 0; i < 3; i += 1) {
        weighted = fadd(weighted, fmul(fadd(F(1n), rates[i]), F(candidate.x[i])));
      }
      if (slotBest === null || fcmp(weighted, slotBest) > 0) slotBest = weighted;
    }
    B3 = fadd(B3, slotBest);
  }
  for (let i = 0; i < 3; i += 1) {
    const base = food?.params[ATTRIBUTES[i]]?.base ?? 0;
    B3 = fadd(B3, fmul(rates[i], F(base)));
  }
  let best = B1;
  for (const bound of [B2, B3, B4]) best = fmin(best, bound);
  return { B1, B2, B3, B4, best };
}

/** 逐属性分别对食物取最大 cap 再相加（常见的“gear max + 食物 max”做法）。 */
function perAttributeFoodCapSum(instance, gear) {
  const caps = [0, 0, 0];
  const foods = instance.allowNoFood ? [...instance.foods, null] : instance.foods;
  for (let i = 0; i < 3; i += 1) {
    for (const food of foods) {
      caps[i] = Math.max(caps[i], food?.params[ATTRIBUTES[i]]?.cap ?? 0);
    }
  }
  return gear.exactGearSum + caps.reduce((total, value) => total + value, 0);
}

function foodAwareBound(instance) {
  const gear = gearBounds(instance);
  const foods = instance.allowNoFood ? [...instance.foods, null] : instance.foods;
  // 实际食物是 F∪{⊥} 中的某一个；界必须对每个可能选择都成立，故取 max。
  let best = null;
  let bestBreakdown = null;
  for (const food of foods) {
    const bounds = foodBounds(instance, food);
    const candidate = { food, ...bounds };
    if (best === null || fcmp(bounds.best, best.bound) > 0) {
      best = { food, bound: bounds.best };
      bestBreakdown = candidate;
    }
  }
  check(best !== null, "没有可用食物选择");
  return { bound: best.bound, breakdown: bestBreakdown, gear };
}

// ---------------------------------------------------------------------------
// 5. 约束感知 Lagrangian 上界（速度上界 λ、TEN 下界 μ、TEN 上界 ν）
//    单乘子函数 g(λ) 是凸分段线性：在 λ=0 与所有正断点处取最小即为精确最小。
// ---------------------------------------------------------------------------
function candidateAffine(slot, mode) {
  // 返回 [{ a: F, v: number, t: number }]
  return slot.candidates.map((candidate) => {
    const s3 = F(candidate.x[0] + candidate.x[1] + candidate.x[2]);
    return { a: s3, v: candidate.speed ?? 0, t: candidate.ten ?? 0 };
  });
}

function minOverMultiplier(termsPerSlot, linear, constant) {
  // g(x) = Σ_s max_c (a + x*coef) + x*linear + constant。
  // g 是凸分段线性函数；断点在每个槽内两候选仿射函数相等处。
  // 精确最小值出现在 x=0 或某个正断点（若 g 在无穷远处下降则该问题不可行，
  // 本脚本的实例均满足弱对偶有界性）。
  const breakpoints = [F(0n)];
  for (const terms of termsPerSlot) {
    for (let i = 0; i < terms.length; i += 1) {
      for (let j = 0; j < terms.length; j += 1) {
        if (i === j) continue;
        const slopeDifference = terms[i].coef - terms[j].coef; // 整数
        if (slopeDifference === 0) continue;
        // a_i + x·c_i = a_j + x·c_j  →  x = (a_j - a_i)/(c_i - c_j)
        const numerator = fsub(terms[j].a, terms[i].a);
        const value = F(numerator.n, numerator.d * BigInt(slopeDifference));
        if (value.n > 0n) breakpoints.push(value);
      }
    }
  }
  const unique = [];
  const seen = new Set();
  for (const value of breakpoints) {
    const key = `${value.n}/${value.d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  let best = null;
  for (const x of unique) {
    let total = fadd(constant, fmul(x, linear));
    for (const terms of termsPerSlot) {
      let slotBest = null;
      for (const term of terms) {
        const value = fadd(term.a, fmul(x, F(BigInt(term.coef))));
        if (slotBest === null || fcmp(value, slotBest) > 0) slotBest = value;
      }
      total = fadd(total, slotBest);
    }
    if (best === null || fcmp(total, best) < 0) best = total;
  }
  return best;
}

function evaluateMultiplier(termsPerSlot, linear, constant, x) {
  let total = fadd(constant, fmul(x, linear));
  for (const terms of termsPerSlot) {
    let slotBest = null;
    for (const term of terms) {
      const value = fadd(term.a, fmul(x, F(BigInt(term.coef))));
      if (slotBest === null || fcmp(value, slotBest) > 0) slotBest = value;
    }
    total = fadd(total, slotBest);
  }
  return total;
}

/**
 * 速度上界 V <= vHi 的 Lagrangian 上界：
 *   gear 部分：Σ_s max_c (S3(c) - λ·speed(c)) + λ·vHi
 *   食物项：variant "cap" → Σ cap_i^f；variant "mono" → Σ bonus_i^f(Gmax_i)
 *   （bonus_i(G_i) <= bonus_i(Gmax_i) <= cap_i^f，两项都合法）
 */
function speedUpperBound(instance, food, variant) {
  const gear = gearBounds(instance);
  const foodTerm = variant === "cap"
    ? ATTRIBUTES.reduce((total, attribute) => total + (food?.params[attribute]?.cap ?? 0), 0)
    : ATTRIBUTES.reduce((total, attribute, i) =>
      total + bonusOf(food?.params[attribute], gear.attributeMaxima[i]), 0);
  const terms = instance.slots.map((slot) => candidateAffine(slot).map((entry) => ({
    a: entry.a,
    coef: -entry.v,
  })));
  return minOverMultiplier(terms, F(instance.speedMax), F(foodTerm));
}

/**
 * TEN 下界 T >= tLo 的 Lagrangian 上界：
 *   gear 部分：Σ_s max_c (S3(c) + μ·ten(c)) - μ·tLo
 *   食物项：Σ bonus_i^f(Gmax_i) + μ·capT^f（<= Σ cap_i^f + μ capT^f，也合法）
 */
function tenLowerBound(instance, food, variant) {
  const gear = gearBounds(instance);
  let foodTerm = ATTRIBUTES.reduce((total, attribute, i) =>
    total + bonusOf(food?.params[attribute], gear.attributeMaxima[i]), 0);
  if (variant === "cap") {
    foodTerm = ATTRIBUTES.reduce((total, attribute) =>
      total + (food?.params[attribute]?.cap ?? 0), 0);
  }
  const capT = food?.params.TEN?.cap ?? 0;
  const terms = instance.slots.map((slot) => candidateAffine(slot).map((entry) => ({
    a: entry.a,
    coef: entry.t,
  })));
  // g(μ) = Σ max(S3 + μ·ten) - μ·tLo + foodTerm + μ·capT
  const bound = minOverMultiplier(terms, F(-instance.tenMin + capT), F(foodTerm));
  return bound;
}

/** TEN 上界 T <= tHi：Σ max(S3 - ν·ten) + ν·tHi + 食物项（丢弃 -ν·bonusTEN ≤ 0 的保守方向）。 */
function tenUpperBound(instance, food, variant) {
  const gear = gearBounds(instance);
  const foodTerm = variant === "cap"
    ? ATTRIBUTES.reduce((total, attribute) => total + (food?.params[attribute]?.cap ?? 0), 0)
    : ATTRIBUTES.reduce((total, attribute, i) =>
      total + bonusOf(food?.params[attribute], gear.attributeMaxima[i]), 0);
  const terms = instance.slots.map((slot) => candidateAffine(slot).map((entry) => ({
    a: entry.a,
    coef: -entry.t,
  })));
  return minOverMultiplier(terms, F(instance.tenMax), F(foodTerm));
}

function constraintBound(instance) {
  check(instance.speedMax !== undefined || instance.tenMin !== undefined || instance.tenMax !== undefined,
    "constraintBound 需要一个约束");
  const foods = instance.allowNoFood ? [...instance.foods, null] : instance.foods;
  const bounds = [];
  for (const food of foods) {
    const parts = [];
    if (instance.speedMax !== undefined) {
      parts.push(speedUpperBound(instance, food, "cap"));
      parts.push(speedUpperBound(instance, food, "mono"));
    }
    if (instance.tenMin !== undefined) {
      parts.push(tenLowerBound(instance, food, "cap"));
      parts.push(tenLowerBound(instance, food, "mono"));
    }
    if (instance.tenMax !== undefined) {
      parts.push(tenUpperBound(instance, food, "cap"));
      parts.push(tenUpperBound(instance, food, "mono"));
    }
    if (parts.length === 0) continue;
    let tightest = parts[0];
    for (const part of parts) tightest = fmin(tightest, part);
    bounds.push({ food, bound: tightest, parts });
  }
  let best = null;
  for (const entry of bounds) {
    if (best === null || fcmp(entry.bound, best.bound) > 0) best = entry;
  }
  return { bound: best.bound, entries: bounds };
}

// ---------------------------------------------------------------------------
// 6. 食物加成公式与生产 canonical 实现对照 + baseStat 偏移核对
// ---------------------------------------------------------------------------
function verifyFoodFormulaAgainstCanonical() {
  const rates = [0, 1, 5, 10, 11, 15, 20, 25, 30, 50, 100, 150, 200];
  const caps = [0, 5, 20, 100, 1000, 5000];
  const bases = [0, 100, 341, 420];
  let comparisons = 0;
  for (const ratePercent of rates) {
    for (const cap of caps) {
      for (const base of bases) {
        const rate = F(BigInt(ratePercent), 100n);
        const parameter = {
          baseValue: base,
          multiplier: 1 + ratePercent / 100,
          maxValue: cap,
          numerator: Number(rate.n),
          denominator: Number(rate.d),
        };
        const ours = { cap, numerator: Number(rate.n), denominator: Number(rate.d), base };
        for (let raw = 0; raw <= 200; raw += 7) {
          const canonical = canonicalFoodBonusAtRawWithRate(raw, parameter);
          check(canonical !== undefined, "canonical 食物加成返回 undefined");
          check(
            canonical === bonusOf(ours, raw),
            `食物公式与生产实现不一致 rate=${ratePercent}% cap=${cap} base=${base} raw=${raw}：` +
              `${canonical} vs ${bonusOf(ours, raw)}`,
          );
          comparisons += 1;
        }
      }
    }
  }
  record("canonical-food-formula", `${comparisons} 个 (rate, cap, base, raw) 点与生产 canonical 实现一致`);
}

function verifyBaseStatOffsets() {
  const level100 = DOCUMENTED_LEVEL_PARAMS[100];
  const level50 = DOCUMENTED_LEVEL_PARAMS[50];
  const level90 = DOCUMENTED_LEVEL_PARAMS[90];
  check(level100.sub === 420 && level100.main === 440, "level 100 参数变化，需要更新 §3 的 base 偏移");
  check(level50.sub === 341 && level50.main === 202, "level 50 参数变化，需要更新 §3 的 base 偏移");
  check(level90.sub === 400 && level90.main === 390, "level 90 参数变化，需要更新 §3 的 base 偏移");
  record(
    "base-stat-offsets",
    "贡献坐标：base_CRT = base_DHT = sub，base_DET = main；" +
      "level 100 = (420,420,440)，level 50 = (341,341,202)，level 90 = (400,400,390)",
  );
}

// ---------------------------------------------------------------------------
// 7. U 对 R 的单调性（引用 free-budget-upper-bound 定理 1 的有限复核）
// ---------------------------------------------------------------------------
function uBrute(level, job, baseline, budget) {
  let best = -1n;
  for (let c = 0; c <= budget; c += 1) {
    for (let h = 0; h + c <= budget; h += 1) {
      const d = budget - c - h;
      const product = factorsAt(level, job, {
        CRT: baseline[0] + c,
        DHT: baseline[1] + h,
        DET: baseline[2] + d,
      }).product;
      if (product > best) best = product;
    }
  }
  return best;
}

function verifyUMonotoneInR() {
  let comparisons = 0;
  let flatPrefix = null;
  for (const level of [50, 100]) {
    for (const job of ["WHM", "BLU"]) {
      for (const baseline of [[0, 0, 0], [200, 200, 200]]) {
        let previous = -1n;
        for (let R = 0; R <= 20; R += 1) {
          const value = uBrute(level, job, baseline, R);
          check(value >= previous, `U 对 R 单调失败 ${level}/${job}/${baseline} R=${R}`);
          if (previous >= 0n && value === previous && flatPrefix === null && R === 5) {
            flatPrefix = { level, job, baseline, R };
          }
          previous = value;
          comparisons += 1;
        }
      }
    }
  }
  record("U-monotone-in-R", `${comparisons} 个 (level,job,baseline,R) 点 U(R) 非减（free-budget 定理 1 的有限复核）`);
  return flatPrefix;
}

// ---------------------------------------------------------------------------
// 7b（R7 审查修正）：最小合法预算 R* = S* − Σ_i b_i（相对 baseline 的增量）
// ---------------------------------------------------------------------------
/** U(b,R,κ) 的穷举定义：x∈[0,κ]，Σx<=R，最大化 Π F_i(b_i+x_i)。 */
function uCapped(level, job, baseline, kappa, budget) {
  let best = -1n;
  for (let c = 0; c <= Math.min(kappa[0], budget); c += 1) {
    for (let h = 0; h <= Math.min(kappa[1], budget - c); h += 1) {
      for (let d = 0; d <= Math.min(kappa[2], budget - c - h); d += 1) {
        const product = factorsAt(level, job, {
          CRT: baseline[0] + c,
          DHT: baseline[1] + h,
          DET: baseline[2] + d,
        }).product;
        if (product > best) best = product;
      }
    }
  }
  return best;
}
{
  const level = 100;
  const job = "WHM";
  // 审查给定的和级反例：唯一完成 g=(101,0,0)、b=(100,0,0)、κ=(1,0,0)
  const baseline = [100, 0, 0];
  const kappa = [1, 0, 0];
  const trueProduct = factorsAt(level, job, { CRT: 101, DHT: 0, DET: 0 }).product;
  const Sstar = 101;
  const sumBaseline = 100;
  const Rstar = Sstar - sumBaseline;
  check(Rstar === 1, "增量预算反例：R* 应为 1");
  check(Rstar < Sstar, "增量预算反例：最小合法增量预算 R* 应小于绝对和 S*");
  const u1 = uCapped(level, job, baseline, kappa, 1);
  check(u1 >= trueProduct, "增量预算反例：R=1 应为合法上界（覆盖唯一完成）");
  // 把绝对和 S* 当 R 用：安全但更松（tier 平台可能使值相等）
  const uS = uCapped(level, job, baseline, kappa, Sstar);
  check(uS >= trueProduct, "R7：把绝对和 S* 当 R 仍应是合法但更松的上界");

  // 严格乘积版反例：选跨档的 baseline（97→98 使 CRT 档位 56→57）
  const baselineStrict = [97, 0, 0];
  const kappaStrict = [1, 0, 0];
  const trueProductStrict = factorsAt(level, job, { CRT: 98, DHT: 0, DET: 0 }).product;
  const u0Strict = uCapped(level, job, baselineStrict, kappaStrict, 0);
  const u1Strict = uCapped(level, job, baselineStrict, kappaStrict, 1);
  check(u0Strict < trueProductStrict, "R7 严格反例：R=0 应低于真实乘积（P3 失效，不安全）");
  check(u1Strict === trueProductStrict, "R7 严格反例：R=1 应为合法上界且取等");
  check(98 - 97 === 1, "R7 严格反例：R* = S*−Σb = 1");

  // 通用恒等式：任意小实例上 R* = S* − Σb（b 为逐坐标下界）
  let identityChecks = 0;
  for (const level2 of [50, 100]) {
    for (const baseline2 of [[100, 0, 0], [50, 20, 0], [0, 0, 0]]) {
      for (const kappa2 of [[1, 0, 0], [2, 1, 0], [1, 1, 1], [2, 2, 2]]) {
        let maxSumIncrement = 0;
        let maxAbsoluteSum = 0;
        for (let c = 0; c <= kappa2[0]; c += 1) {
          for (let h = 0; h <= kappa2[1]; h += 1) {
            for (let d = 0; d <= kappa2[2]; d += 1) {
              maxSumIncrement = Math.max(maxSumIncrement, c + h + d);
              maxAbsoluteSum = Math.max(
                maxAbsoluteSum,
                baseline2[0] + c + baseline2[1] + h + baseline2[2] + d,
              );
            }
          }
        }
        const sumB = baseline2.reduce((sum, value) => sum + value, 0);
        check(maxAbsoluteSum === maxSumIncrement + sumB,
          "R7：S* = R* + Σb 恒等式失败");
        check(maxAbsoluteSum - sumB === maxSumIncrement,
          "R7：R* = S* − Σb 恒等式失败");
        identityChecks += 2;
      }
    }
  }
  record(
    "T7-Rstar-baseline",
    `和级：g=(101,0,0)、b=(100,0,0)、κ=(1,0,0) ⇒ S*=101、Σb=100、R*=${Rstar}；` +
      `R=1 合法（U=${u1}≥真实乘积），R<S*=101 即可，故“任何合法 R>=S*”为假；` +
      `乘积级严格例：b=(97,0,0)→g=(98,0,0)（CRT 档位 56→57），R=0 时 U=${u0Strict}<真实乘积=${trueProductStrict}（不安全），` +
      `R=1 时 U=${u1Strict}=真实乘积；${identityChecks} 项 R*=S*−Σb 恒等式复核`,
  );
}

// ===========================================================================
// 实例与断言
// ===========================================================================
const zero = { x: [0, 0, 0] };

// ---- 实例 1：可分 vs 联合（无食物） ----
const instanceSeparable = {
  name: "separability",
  allowNoFood: true,
  foods: [],
  slots: [
    { candidates: [
      { x: [100, 0, 0] }, { x: [0, 100, 0] }, { x: [10, 10, 0] },
    ] },
    { candidates: [{ x: [60, 0, 0] }, { x: [0, 60, 0] }] },
    { candidates: [{ x: [0, 0, 200] }, { x: [20, 20, 20] }] },
  ],
};
{
  const { best } = analyze(instanceSeparable);
  const gear = gearBounds(instanceSeparable);
  check(gear.exactGearSum === best.sum, "T1 无食物时 R_gear 应等于真实最大和");
  check(gear.exactGearSum <= gear.separable, "T1 应满足 R_gear <= R_sep");
  check(gear.exactGearSum < gear.separable, "T1 严格分离例子失效");
  check(best.sum === gear.exactGearSum, "T1 无食物真实最大和应等于 R_gear");
  record(
    "T1-gear-vs-separable",
    `R_gear=${gear.exactGearSum}（=无食物真实最大 S*）；R_sep=${gear.separable}（严格更大，` +
      `高估 ${gear.separable - gear.exactGearSum}）；R_gear <= R_sep 已证`,
  );
}

// ---- 实例 1b：同一实例 + 均匀 10% 食物（B3 更紧且精确） ----
const instanceUniformFood = {
  ...instanceSeparable,
  name: "separability-uniform-food",
  allowNoFood: true,
  foods: [makeFood("uniform10", {
    CRT: { mode: "rate", ratePercent: 10, cap: 1000, base: 0 },
    DHT: { mode: "rate", ratePercent: 10, cap: 1000, base: 0 },
    DET: { mode: "rate", ratePercent: 10, cap: 1000, base: 0 },
  })],
};
{
  const { best } = analyze(instanceUniformFood);
  const foodBound = foodAwareBound(instanceUniformFood);
  check(fcmp(foodBound.bound, F(best.sum)) >= 0, "T4 食物界必须 >= 真实最大");
  record(
    "T4-B3-tighter",
    `R_gear=360；B3=${fshow(foodBound.breakdown.B3)}，B4=${fshow(foodBound.breakdown.B4)}，` +
      `R_food=min 界=${fshow(foodBound.bound)}，真实 S*=${best.sum}（B3 更紧且取等）`,
  );
}

// ---- 实例 2：戒指唯一性 ----
const instanceRings = {
  name: "rings",
  allowNoFood: true,
  foods: [],
  ringPair: { a: 0, b: 1 },
  slots: [
    { candidates: [
      { x: [100, 0, 0], itemId: 1, unique: true },
      { x: [40, 0, 0], itemId: 3, unique: false },
      { x: [90, 0, 0], itemId: 1, unique: true },
    ] },
    { candidates: [
      { x: [60, 0, 0], itemId: 1, unique: true },
      { x: [0, 50, 0], itemId: 3, unique: false },
      { x: [0, 0, 30], itemId: 2, unique: true },
    ] },
  ],
};
{
  const { best } = analyze(instanceRings);
  const exact = ringPairExactMaximum(instanceRings.slots[0], instanceRings.slots[1]);
  const brute = ringPairBruteMaximum(instanceRings.slots[0], instanceRings.slots[1]);
  check(exact === brute, "T2 配对算法与暴力枚举不一致");
  check(best.sum === exact, "T2 真实最大和应等于配对精确值");
  const gear = gearBounds(instanceRings);
  check(gear.independentlySummed === 160, "T2 未加唯一性约束的最大和应为 160");
  check(exact === 150, "T2 精确配对值应为 150");
  check(gear.independentlySummed > exact, "T2 忽略唯一性会严格高估");
  record(
    "T2-ring-uniqueness",
    `忽略唯一性的逐槽最大和 = ${gear.independentlySummed}（仍安全但更松）；` +
      `精确配对 = ${exact}（与暴力枚举一致）；真实 S* = ${best.sum}；` +
      "虚拟最优对 (item1,item1) 非法（unique 同 ID），严格间隙 " +
      `${gear.independentlySummed - exact}`,
  );
}

// ---- 实例 2b：把“合法戒指对”作为单槽候选（配好对模型）时，逐槽最大即精确 ----
{
  const pairCandidates = [];
  for (const candidateA of instanceRings.slots[0].candidates) {
    for (const candidateB of instanceRings.slots[1].candidates) {
      if (candidateA.itemId === candidateB.itemId && candidateA.unique === true) continue;
      pairCandidates.push({
        x: [candidateA.x[0] + candidateB.x[0], candidateA.x[1] + candidateB.x[1],
          candidateA.x[2] + candidateB.x[2]],
      });
    }
  }
  const pairedSlotInstance = {
    name: "paired-ring-slot",
    allowNoFood: true,
    foods: [],
    slots: [{ candidates: pairCandidates }],
  };
  const { best } = analyze(pairedSlotInstance);
  const gear = gearBounds(pairedSlotInstance);
  check(gear.exactGearSum === best.sum, "T2b 合法对单槽模型应逐槽最大即精确");
  check(best.sum === 150, "T2b 合法对单槽模型真实最大应为 150");
  record(
    "T2b-paired-ring-slot",
    `若候选池直接枚举合法戒指对（buildRingPairEquipInfos 的做法），单槽最大 = ${gear.exactGearSum} = 真实 S*；` +
      "与独立两槽 + 配对算法得到同一个精确值",
  );
}

// ---- 实例 2c：随机小实例上与暴力枚举对照配对算法（含 unique/non-unique、同 item 多变体、并列） ----
{
  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }
  let randomCases = 0;
  for (let trial = 0; trial < 80; trial += 1) {
    const rand = seededRandom(1234 + trial * 7919);
    const uniqueById = new Map();
    // 保证总存在一个 non-unique item（item 99），使合法对非空
    uniqueById.set(99, false);
    const buildSlot = (count) => {
      const candidates = [];
      for (let index = 0; index < count; index += 1) {
        const itemId = index === 0 ? 99 : 1 + Math.floor(rand() * 6);
        if (!uniqueById.has(itemId)) uniqueById.set(itemId, rand() < 0.6);
        candidates.push({
          itemId,
          unique: uniqueById.get(itemId),
          x: [Math.floor(rand() * 80), Math.floor(rand() * 80), Math.floor(rand() * 80)],
        });
      }
      return candidates;
    };
    const slotA = { candidates: buildSlot(1 + Math.floor(rand() * 4)) };
    const slotB = { candidates: buildSlot(1 + Math.floor(rand() * 4)) };
    const exact = ringPairExactMaximum(slotA, slotB);
    const brute = ringPairBruteMaximum(slotA, slotB);
    check(exact === brute, `T2c 随机配对不一致 trial=${trial}: ${exact} vs ${brute}`);
    randomCases += 1;
  }
  record("T2c-random-pairing", `${randomCases} 个随机小实例上配对算法 = 暴力枚举（含 unique/non-unique/变体/并列）`);
}

// ---- 实例 3：食物耦合（max_f Σcap 比逐属性 max 更紧，且达到精确值） ----
const instanceFoodCoupling = {
  name: "food-coupling",
  allowNoFood: true,
  foods: [
    makeFood("crt-food", { CRT: { mode: "rate", ratePercent: 100, cap: 50, base: 0 } }),
    makeFood("dht-food", { DHT: { mode: "rate", ratePercent: 100, cap: 50, base: 0 } }),
  ],
  slots: [
    { candidates: [{ x: [100, 0, 0] }, { x: [0, 100, 0] }] },
    { candidates: [{ x: [60, 0, 0] }, { x: [0, 60, 0] }] },
  ],
};
{
  const { best } = analyze(instanceFoodCoupling);
  const { bound, breakdown, gear } = foodAwareBound(instanceFoodCoupling);
  check(fcmp(bound, F(best.sum)) >= 0, "T4 食物界必须 >= 真实最大");
  check(gear.exactGearSum === 160, "T4 实例 R_gear 应为 160");
  check(best.sum === 210, "T4 食物耦合实例真实最大应为 210");
  check(ftoNumber(bound) === 210, "T4 食物界应取到 210");
  const naive = perAttributeFoodCapSum(instanceFoodCoupling, gear);
  check(naive === 260, "T4 逐属性食物最大相加应为 260");
  check(naive > best.sum, "T4 逐属性食物最大相加应严格高估");
  record(
    "T4-food-coupling",
    `逐属性食物 max 相加 =${naive}（高估，没有单一食物同时提供 CRT/DHT cap）；` +
      `max_f Σcap 界 =${ftoNumber(breakdown.B1)}；B4=${ftoNumber(breakdown.B4)}；` +
      `R_food=${ftoNumber(bound)}=真实 S*=${best.sum}`,
  );
}

// ---- 实例 3b：cap 生效但不可同时达到（B1 严格松于真实值） ----
const instanceCapNotAttained = {
  name: "cap-not-attained",
  allowNoFood: true,
  foods: [makeFood("cap5", {
    CRT: { mode: "rate", ratePercent: 100, cap: 5, base: 0 },
    DHT: { mode: "rate", ratePercent: 100, cap: 5, base: 0 },
    DET: { mode: "rate", ratePercent: 100, cap: 5, base: 0 },
  })],
  slots: [
    { candidates: [{ x: [100, 0, 0] }, { x: [0, 100, 0] }] },
    { candidates: [{ x: [0, 0, 80] }] },
  ],
};
{
  const { best } = analyze(instanceCapNotAttained);
  const { bound, breakdown } = foodAwareBound(instanceCapNotAttained);
  check(best.sum === 190, "T4 cap 实例真实最大应为 190");
  check(ftoNumber(breakdown.B1) === 195, "T4 cap 实例 B1 应为 195");
  check(ftoNumber(breakdown.B4) === 195, "T4 cap 实例 B4 应为 195");
  check(ftoNumber(bound) === 195, "T4 cap 实例最紧界应为 195");
  check(ftoNumber(bound) > best.sum, "T4 cap 实例界应严格高估真实值");
  record(
    "T4-cap-not-attained",
    `R_gear=180，逐属性 Gmax=(100,100,80)，Σcap=15 ⇒ B1=B4=195；真实 S*=190` +
      `（DHT 贡献在每个 argmax 都是 0，DHT 的 cap 无法饱和）⇒ 严格高估 5：` +
      "“cap 生效”本身不足以保证精确",
  );
}

// ---- 实例 4：速度上界 / TEN 下界的 Lagrangian 与积分间隙 ----
const instanceSpeed = {
  name: "speed-cap",
  allowNoFood: true,
  foods: [],
  speedMax: 1,
  slots: [
    { candidates: [{ x: [12, 0, 0], speed: 2 }, { x: [9, 0, 0], speed: 0 }] },
    { candidates: [{ x: [0, 0, 0], speed: 0 }] },
  ],
};
{
  const { best } = analyze(instanceSpeed);
  check(best.sum === 9, "T5 速度实例真实最大应为 9");
  const bound = speedUpperBound(instanceSpeed, null, "mono");
  check(fcmp(bound, F(best.sum)) >= 0, "T5 速度 Lagrangian 上界必须 >= 真实最大");
  check(ftoNumber(bound) === 10.5, "T5 速度 Lagrangian 精确最小值应为 10.5");
  check(fcmp(bound, F(12)) < 0, "T5 速度 Lagrangian 优化后应严格优于 λ=0 的无约束 gear 界 12");
  check(Number(ffloor(bound)) === 10 && Number(ffloor(bound)) > best.sum,
    "T5 速度界取整后仍严格松于真实值（积分间隙反例）");
  record(
    "T5-speed-lagrangian-gap",
    `真实 S*=9；Lagrangian 精确最小 = ${fshow(bound)}（λ*=1.5；λ=0 时为 12）；floor = 10 > 9 ⇒ 积分间隙 1`,
  );
}

const instanceTen = {
  name: "ten-lower",
  allowNoFood: true,
  foods: [],
  tenMin: 50,
  slots: [
    { candidates: [{ x: [10, 0, 0], ten: 0 }, { x: [5, 0, 0], ten: 100 }] },
    { candidates: [{ x: [0, 0, 0], ten: 0 }] },
  ],
};
{
  const { best } = analyze(instanceTen);
  check(best.sum === 5, "T5 TEN 实例真实最大应为 5");
  const bound = tenLowerBound(instanceTen, null, "mono");
  check(fcmp(bound, F(best.sum)) >= 0, "T5 TEN Lagrangian 上界必须 >= 真实最大");
  check(ftoNumber(bound) === 7.5, "T5 TEN Lagrangian 精确最小值应为 7.5");
  check(fcmp(bound, F(10)) < 0, "T5 TEN Lagrangian 优化后应严格优于 μ=0 的无约束界 10");
  check(Number(ffloor(bound)) === 7 && Number(ffloor(bound)) > best.sum,
    "T5 TEN 界取整后仍严格松于真实值");
  record(
    "T5-ten-lagrangian-gap",
    `真实 S*=5；Lagrangian 精确最小 = ${fshow(bound)}（μ*=0.05；μ=0 时为 10）；floor = 7 > 5 ⇒ 积分间隙 2`,
  );
}

// ---- 实例 4b：带食物 + 速度上界：安全方向替换 min_f 食物速度 ----
const instanceSpeedFood = {
  name: "speed-food",
  allowNoFood: false,
  foods: [
    makeFood("speed-food", {
      // 食物在 raw=0 时也提供 1 点速度（base=1, rate=100%, cap=1）
      SKS: { mode: "rate", ratePercent: 100, cap: 1, base: 1 },
      CRT: { mode: "rate", ratePercent: 100, cap: 2, base: 0 },
    }),
  ],
  speedMax: 2,
  slots: [
    { candidates: [{ x: [5, 0, 0], speed: 2 }, { x: [4, 0, 0], speed: 1 }] },
    { candidates: [{ x: [1, 0, 0], speed: 0 }] },
  ],
};
{
  const { feasible } = analyze(instanceSpeedFood);
  // 安全替换：gear speed <= speedMax - min_f minBonusSpeed（F 为实际可用食物集合；
  // 若允许“无食物”，则 ⊥ 的 bonus=0 也必须计入 min）
  const allowedFoods = instanceSpeedFood.allowNoFood ? [...instanceSpeedFood.foods, null] : instanceSpeedFood.foods;
  const minBonusSpeed = Math.min(
    ...allowedFoods.map((food) => bonusOf(food?.params.SKS, 0)),
  );
  const gearSpeedLimit = instanceSpeedFood.speedMax - minBonusSpeed;
  for (const completion of feasible) {
    check(completion.speed <= gearSpeedLimit, "T5 食物速度安全替换方向失效（gear speed 超过上界）");
  }
  const limitWithoutFood = instanceSpeedFood.speedMax;
  check(minBonusSpeed === 1, "T5 食物速度最小加成应为 1（base=1）");
  check(gearSpeedLimit === 1 && gearSpeedLimit < limitWithoutFood, "T5 安全替换应收紧 gear 速度上界");
  record(
    "T5-food-speed-safe-direction",
    `min_f foodSpeed(raw=0)=${minBonusSpeed} ⇒ gearSpeed <= ${gearSpeedLimit}` +
      `（由 V<=${instanceSpeedFood.speedMax} 与 bonus>=${minBonusSpeed} 推出；只会更松/更弱，不会不安全）`,
  );
}

// ---- 实例 4c：TEN 上界（T <= tHi）与 TEN 食物安全方向 ----
const instanceTenUpper = {
  name: "ten-upper",
  allowNoFood: true,
  foods: [],
  tenMax: 50,
  slots: [
    { candidates: [{ x: [10, 0, 0], ten: 100 }, { x: [5, 0, 0], ten: 0 }] },
    { candidates: [{ x: [0, 0, 0], ten: 0 }] },
  ],
};
{
  const { best } = analyze(instanceTenUpper);
  check(best.sum === 5, "T5 TEN 上界实例真实最大应为 5");
  const bound = tenUpperBound(instanceTenUpper, null, "mono");
  check(fcmp(bound, F(best.sum)) >= 0, "T5 TEN 上界 Lagrangian 必须 >= 真实最大");
  check(ftoNumber(bound) === 7.5, "T5 TEN 上界 Lagrangian 精确最小应为 7.5");
  check(fcmp(bound, F(10)) < 0, "T5 TEN 上界 Lagrangian 优化后应严格优于 ν=0 的无约束界 10");
  record(
    "T5-ten-upper-lagrangian-gap",
    `真实 S*=5；TEN 上界 Lagrangian 精确最小 = ${fshow(bound)}（ν*=0.05；ν=0 时为 10）；floor = 7 > 5 ⇒ 积分间隙 2`,
  );
}

const instanceTenFood = {
  name: "ten-food",
  allowNoFood: false,
  foods: [makeFood("ten-food", {
    TEN: { mode: "rate", ratePercent: 100, cap: 30, base: 0 },
  })],
  tenMin: 50,
  slots: [
    { candidates: [{ x: [10, 0, 0], ten: 0 }, { x: [5, 0, 0], ten: 40 }] },
    { candidates: [{ x: [0, 0, 0], ten: 0 }] },
  ],
};
{
  const { feasible } = analyze(instanceTenFood);
  const maxFoodTenCap = Math.max(
    ...instanceTenFood.foods.map((food) => food.params.TEN?.cap ?? 0),
  );
  const gearTenFloor = instanceTenFood.tenMin - maxFoodTenCap;
  for (const completion of feasible) {
    check(completion.ten >= gearTenFloor, "T5 食物 TEN 安全替换方向失效（gear TEN 低于下界）");
  }
  check(gearTenFloor === 20, "T5 安全替换得到的 gear TEN 下界应为 20");
  record(
    "T5-food-ten-safe-direction",
    `max_f foodTEN cap=${maxFoodTenCap} ⇒ gearTEN >= t_lo - ${maxFoodTenCap} = ${gearTenFloor}` +
      "（由 T>=t_lo 与 bonus<=cap 推出；只会更松/更弱，不会不安全）",
  );
}

// ---- 实例 4d：速度与 TEN 同时约束：单约束界取 min 仍然合法 ----
const instanceCombined = {
  name: "combined-constraints",
  allowNoFood: true,
  foods: [],
  speedMax: 1,
  tenMin: 50,
  slots: [
    { candidates: [{ x: [10, 0, 0], speed: 1, ten: 0 }, { x: [6, 0, 0], speed: 0, ten: 100 }] },
    { candidates: [{ x: [0, 0, 0], speed: 0, ten: 0 }] },
  ],
};
{
  const { best } = analyze(instanceCombined);
  check(best.sum === 6, "T5 组合约束实例真实最大应为 6");
  const speedBound = speedUpperBound(instanceCombined, null, "mono");
  const tenBound = tenLowerBound(instanceCombined, null, "mono");
  check(fcmp(speedBound, F(best.sum)) >= 0, "T5 组合: 速度界单独必须合法");
  check(fcmp(tenBound, F(best.sum)) >= 0, "T5 组合: TEN 界单独必须合法");
  const combined = fmin(speedBound, tenBound);
  check(fcmp(combined, F(best.sum)) >= 0, "T5 组合: min 仍须合法");
  record(
    "T5-combined-constraints",
    `真实 S*=6；速度界=${fshow(speedBound)}，TEN 界=${fshow(tenBound)}，min=${fshow(combined)}` +
      "（单约束界对“两约束同时成立”的问题仍合法，取 min 也合法）",
  );
}

// ---- 实例 4e：单乘子精确最小的独立性核验（网格值都必须 >= 找到的最小值） ----
{
  let gridChecks = 0;
  const cases = [];
  {
    const terms = instanceSpeed.slots.map((slot) => candidateAffine(slot).map((entry) => ({
      a: entry.a,
      coef: -entry.v,
    })));
    const bound = minOverMultiplier(terms, F(instanceSpeed.speedMax), F(0n));
    for (let k = 0; k <= 240; k += 1) {
      const lambda = F(BigInt(k), 20n);
      const value = evaluateMultiplier(terms, F(instanceSpeed.speedMax), F(0n), lambda);
      check(fcmp(bound, value) <= 0, `T5 网格核验失败：λ=${k}/20`);
      gridChecks += 1;
    }
    cases.push("速度 λ");
  }
  {
    const terms = instanceTen.slots.map((slot) => candidateAffine(slot).map((entry) => ({
      a: entry.a,
      coef: entry.t,
    })));
    const bound = minOverMultiplier(terms, F(-instanceTen.tenMin), F(0n));
    for (let k = 0; k <= 240; k += 1) {
      const mu = F(BigInt(k), 20n);
      const value = evaluateMultiplier(terms, F(-instanceTen.tenMin), F(0n), mu);
      check(fcmp(bound, value) <= 0, `T5 网格核验失败：μ=${k}/20`);
      gridChecks += 1;
    }
    cases.push("TEN 下界 μ");
  }
  {
    const terms = instanceTenUpper.slots.map((slot) => candidateAffine(slot).map((entry) => ({
      a: entry.a,
      coef: -entry.t,
    })));
    const bound = minOverMultiplier(terms, F(instanceTenUpper.tenMax), F(0n));
    for (let k = 0; k <= 240; k += 1) {
      const nu = F(BigInt(k), 20n);
      const value = evaluateMultiplier(terms, F(instanceTenUpper.tenMax), F(0n), nu);
      check(fcmp(bound, value) <= 0, `T5 网格核验失败：ν=${k}/20`);
      gridChecks += 1;
    }
    cases.push("TEN 上界 ν");
  }
  record(
    "T5-multiplier-grid",
    `${gridChecks} 个网格乘子值全部 >= 断点法得到的最小值（${cases.join("、")}，` +
      "说明断点法结果不高于网格采样，且取到的是凸分段线性的精确最小点）",
  );
}

// ---- 实例 5：部分分支 R_rem(P) 的合法性与单调性（无约束 + 食物） ----
const instanceBranch = {
  name: "partial-branch",
  allowNoFood: true,
  foods: [makeFood("crt20", {
    CRT: { mode: "rate", ratePercent: 100, cap: 20, base: 0 },
  })],
  slots: [
    { candidates: [{ x: [50, 0, 0] }, { x: [0, 50, 0] }] },
    { candidates: [{ x: [30, 0, 0] }, { x: [0, 30, 0] }] },
    { candidates: [{ x: [0, 0, 40] }, { x: [10, 10, 10] }] },
  ],
};
{
  const gear = gearBounds(instanceBranch);
  const all = enumerateCompletions(instanceBranch);
  const feasible = all.filter((completion) => isFeasible(instanceBranch, completion));
  const prefixCommitted = [
    [],
    [{ slot: 0, candidate: 0 }],
    [{ slot: 0, candidate: 0 }, { slot: 1, candidate: 0 }],
    [{ slot: 0, candidate: 0 }, { slot: 1, candidate: 0 }, { slot: 2, candidate: 0 }],
  ];
  const remainingBounds = [];
  for (const committed of prefixCommitted) {
    const committedSlots = new Set(committed.map((entry) => entry.slot));
    const committedGear = [0, 0, 0];
    for (const entry of committed) {
      const candidate = instanceBranch.slots[entry.slot].candidates[entry.candidate];
      for (let i = 0; i < 3; i += 1) committedGear[i] += candidate.x[i];
    }
    // R_rem = Σ_rem max S3 + Σ_i bonus_i(remMax_i)，remMax_i = committed_i + Σ_rem max x_i
    let gearRemaining = 0;
    for (let slotIndex = 0; slotIndex < instanceBranch.slots.length; slotIndex += 1) {
      if (committedSlots.has(slotIndex)) continue;
      gearRemaining += slotMaxS3(instanceBranch.slots[slotIndex]);
    }
    const remMax = [0, 0, 0];
    for (let i = 0; i < 3; i += 1) {
      remMax[i] = committedGear[i];
      for (let slotIndex = 0; slotIndex < instanceBranch.slots.length; slotIndex += 1) {
        if (committedSlots.has(slotIndex)) continue;
        remMax[i] += slotMaxAttribute(instanceBranch.slots[slotIndex], i);
      }
    }
    let foodMaxExtra = 0;
    for (let i = 0; i < 3; i += 1) {
      let bestBonus = 0;
      const foods = instanceBranch.allowNoFood ? [...instanceBranch.foods, null] : instanceBranch.foods;
      for (const food of foods) {
        bestBonus = Math.max(bestBonus, bonusOf(food?.params[ATTRIBUTES[i]], remMax[i]));
      }
      foodMaxExtra += bestBonus;
    }
    const bound = F(gearRemaining + foodMaxExtra);
    // 合法性：对每个可行完成，剩余和 <= bound
    let checked = 0;
    for (const completion of feasible) {
      let matches = true;
      for (const entry of committed) {
        if (completion.picks[entry.slot] !== entry.candidate) matches = false;
      }
      if (!matches) continue;
      const remainingSum = completion.sum -
        committed.reduce((total, entry) => {
          const candidate = instanceBranch.slots[entry.slot].candidates[entry.candidate];
          return total + candidate.x[0] + candidate.x[1] + candidate.x[2];
        }, 0);
      check(fcmp(bound, F(remainingSum)) >= 0, "T6 部分分支剩余上界失效");
      checked += 1;
    }
    check(checked > 0, "T6 部分分支没有可验证的完成");
    remainingBounds.push(ftoNumber(bound));
  }
  for (let i = 1; i < remainingBounds.length; i += 1) {
    check(remainingBounds[i] <= remainingBounds[i - 1], "T6 R_rem(P) 应随 P 增大单调不增");
  }
  record(
    "T6-partial-branch",
    `R_rem(P) 随已提交槽数增加：${remainingBounds.join(" -> ")}（单调不增，且对可行完成安全）`,
  );
}

// ---- 实例 5b：速度约束下的部分分支界单调性 ----
const instanceBranchSpeed = {
  name: "partial-branch-speed",
  allowNoFood: true,
  foods: [],
  speedMax: 2,
  slots: [
    { candidates: [{ x: [10, 0, 0], speed: 1 }, { x: [8, 0, 0], speed: 0 }] },
    { candidates: [{ x: [6, 0, 0], speed: 1 }, { x: [5, 0, 0], speed: 0 }] },
    { candidates: [{ x: [4, 0, 0], speed: 1 }, { x: [3, 0, 0], speed: 0 }] },
  ],
};
{
  const all = enumerateCompletions(instanceBranchSpeed);
  const feasible = all.filter((completion) => isFeasible(instanceBranchSpeed, completion));
  const committedSets = [[], [0], [0, 1], [0, 1, 2]];
  const bounds = [];
  for (const committedSlots of committedSets) {
    const committed = new Set(committedSlots);
    // 已提交速度取最小（对"剩余上界"最保守的方向：允许的剩余速度上界最大）
    let committedSpeed = 0;
    for (const slotIndex of committed) {
      let minimum = Infinity;
      for (const candidate of instanceBranchSpeed.slots[slotIndex].candidates) {
        minimum = Math.min(minimum, candidate.speed ?? 0);
      }
      committedSpeed += minimum;
    }
    const remainingSpeedLimit = instanceBranchSpeed.speedMax - committedSpeed;
    // 对每个可行的 λ 取最小；这里直接枚举候选 λ 断点
    const terms = [];
    for (let slotIndex = 0; slotIndex < instanceBranchSpeed.slots.length; slotIndex += 1) {
      if (committed.has(slotIndex)) continue;
      terms.push(instanceBranchSpeed.slots[slotIndex].candidates.map((candidate) => ({
        a: F(candidate.x[0] + candidate.x[1] + candidate.x[2]),
        coef: -(candidate.speed ?? 0),
      })));
    }
    const bound = minOverMultiplier(terms, F(remainingSpeedLimit), F(0n));
    bounds.push(ftoNumber(bound));
    // 合法性：对所有可行完成，剩余 S3 和 <= bound
    for (const completion of feasible) {
      let matches = true;
      for (const slotIndex of committed) {
        // 已提交的候选未知（只固定槽位集合），跳过具体匹配，只验证以最小提交速度推导的界
        matches = matches && true;
      }
      if (!matches) continue;
      let remainingSum = 0;
      for (let slotIndex = 0; slotIndex < instanceBranchSpeed.slots.length; slotIndex += 1) {
        if (committed.has(slotIndex)) continue;
        const candidate = instanceBranchSpeed.slots[slotIndex].candidates[completion.picks[slotIndex]];
        remainingSum += candidate.x[0] + candidate.x[1] + candidate.x[2];
      }
      check(fcmp(bound, F(remainingSum)) >= 0, "T6 速度约束部分分支界失效");
    }
  }
  for (let i = 1; i < bounds.length; i += 1) {
    check(bounds[i] <= bounds[i - 1], "T6 速度约束下 R_rem 应单调不增");
  }
  record(
    "T6-partial-branch-speed",
    `速度约束下 R_rem = ${bounds.join(" -> ")}（对全部可行完成安全，且单调不增）`,
  );
}

// ---- 实例 6：义军武器的整数分配与逐属性上界高估 ----
// 义军武器槽：基础属性 x0（不可变）+ 整数分配 y_i ∈ [0, m_i]，Σ_i y_i <= maxTotal。
// 线性目标和 Σ_i y_i 的精确最大值 = min(maxTotal, Σ_i m_i)（任意可行分配都可达到）。
// 逐属性上界（用于 R_sep）对属性 i 取 x0_i + min(m_i, maxTotal)，相加后会高估。
{
  const x0 = [100, 40, 0]; // 武器基础贡献（CRT,DHT,DET）
  const maxTotal = 30;
  const perStatMax = [20, 20]; // 两个可分配属性的单项上限
  const exact = x0[0] + x0[1] + x0[2] +
    Math.min(maxTotal, perStatMax[0] + perStatMax[1]);
  const perAttributeUpper = (x0[0] + Math.min(perStatMax[0], maxTotal)) +
    (x0[1] + Math.min(perStatMax[1], maxTotal)) + x0[2];
  check(exact === 170, "T3 义军武器精确和应为 170");
  check(perAttributeUpper === 180, "T3 逐属性上界相加应为 180");
  check(perAttributeUpper > exact, "T3 逐属性上界应严格高估线性目标最大值");
  record(
    "T3-resistance-weapon",
    `义军分配 x0=(100,40,0), maxTotal=30, perStatMax=(20,20)：Σ 的精确最大 = ` +
      `100+40+min(30,40)=${exact}；逐属性上界相加 = (100+min(20,30))+(40+min(20,30)) = ` +
      `${perAttributeUpper} ⇒ 高估 ${perAttributeUpper - exact}（= Σ_i min(m_i, maxTotal) - min(...)）`,
  );
}

// ---- 实例 6b（R6 审查修正）：义军武器只统计三目标属性 I=stats∩{CRT,DHT,DET} ----
// 非目标属性（SKS/TEN 等）的分配不进入 S，只消耗共享预算 T。
// 旧式（对全部 stats 求和）会把非目标 cap 计入而虚增。
{
  const T = 10;
  const capsAll = { CRT: 1, SKS: 9 }; // stats 含非目标属性 SKS
  const target = ["CRT", "DHT", "DET"];
  const oldFormula = Math.min(T, Object.values(capsAll).reduce((sum, cap) => sum + cap, 0)); // 10
  const correctFormula = Math.min(
    T,
    target.reduce((sum, stat) => sum + (capsAll[stat] ?? 0), 0),
  ); // 1
  check(oldFormula === 10, "R6 非目标反例：旧式（全部 stats 求和）应为 10");
  check(correctFormula === 1, "R6 非目标反例：正确（仅 I）应为 1");
  // 穷举分配验证：y_CRT∈[0,1]、y_SKS∈[0,9]、总和<=T，最大化 Σ_{i∈I} y_i
  let bruteTargetSum = 0;
  for (let yCrt = 0; yCrt <= capsAll.CRT; yCrt += 1) {
    for (let ySks = 0; ySks <= capsAll.SKS; ySks += 1) {
      if (yCrt + ySks > T) continue;
      if (yCrt > bruteTargetSum) bruteTargetSum = yCrt;
    }
  }
  check(bruteTargetSum === 1, "R6 非目标反例：穷举三属性最大增量应为 1");
  // 随机小 caps 网格：仅对 I 求和的公式 = 穷举最大目标增量
  const statPool = ["CRT", "DHT", "DET", "SKS", "TEN"];
  let gridChecks = 0;
  const lcg = (() => {
    let state = 12345;
    return () => {
      state = (state * 1103515245 + 12345) >>> 0;
      return state / 4294967296;
    };
  })();
  for (let trial = 0; trial < 200; trial += 1) {
    const statCount = 1 + Math.floor(lcg() * 3);
    const stats = statPool.slice(0, statCount);
    const caps = stats.map(() => Math.floor(lcg() * 6));
    const T2 = Math.floor(lcg() * 12);
    // 穷举全部分配（cap<=5、stats<=3：最多 6^3=216）
    let brute = 0;
    const recurse = (index, remaining, targetSum) => {
      if (index === stats.length) {
        if (targetSum > brute) brute = targetSum;
        return;
      }
      const cap = caps[index];
      const isTarget = target.includes(stats[index]);
      for (let value = 0; value <= Math.min(cap, remaining); value += 1) {
        recurse(index + 1, remaining - value, targetSum + (isTarget ? value : 0));
      }
    };
    recurse(0, T2, 0);
    const formula = Math.min(
      T2,
      stats.reduce((sum, stat, index) => sum + (target.includes(stat) ? caps[index] : 0), 0),
    );
    check(brute === formula, `R6 网格：仅 I 求和公式 ${formula} != 穷举 ${brute} (${JSON.stringify({ stats, caps, T2 })})`);
    gridChecks += 1;
  }
  record(
    "T3-resistance-nontarget",
    `I 中仅 CRT cap=1、另有 SKS cap=9、T=10：旧式 min(T,Σ_all cap)=${oldFormula}，` +
      `正确 min(T,Σ_{i∈I} cap)=${correctFormula}=穷举 ${bruteTargetSum}；${gridChecks} 个随机 caps/stats 网格上仅对 I 求和的公式=穷举最大目标增量`,
  );
}

// ---- 实例 6c（固定目标贡献修正）：固定目标属性不在 I 时 R_sep 必须保留 S3(x0) ----
// 固定向量 x0 的三个目标贡献全部保留；只有可分配增量限于 I。
{
  const target = ["CRT", "DHT", "DET"];
  const x0 = { CRT: 100, DHT: 40, DET: 0 };
  const s3x0 = x0.CRT + x0.DHT + x0.DET; // 140
  const stats = ["CRT", "SKS"];
  const caps = { CRT: 1, SKS: 9 };
  const T = 10;
  const I = stats.filter((stat) => target.includes(stat)); // ["CRT"]
  const incrementMax = Math.min(T, I.reduce((sum, stat) => sum + caps[stat], 0)); // 1
  const trueMaxTargetSum = s3x0 + incrementMax; // 141
  const wrongOverISum = I.reduce(
    (sum, stat) => sum + (x0[stat] ?? 0) + Math.min(caps[stat], T),
    0,
  ); // 101
  const rsepWeapon = s3x0 + incrementMax; // 141
  check(wrongOverISum === 101, "F1 反例：错误 over-I 和应为 101");
  check(trueMaxTargetSum === 141, "F1 反例：真实最大三属性和应为 141");
  check(rsepWeapon === trueMaxTargetSum, "F1 反例：正确 R_sep 应为 141");
  check(wrongOverISum < trueMaxTargetSum, "F1 反例：错误 over-I 和低估真实值");
  // 穷举分配验证真实最大三属性和 = S3(x0) + min(T, Σ_I m)
  let bruteAllocations = 0;
  let bruteMax = -1;
  for (let yCrt = 0; yCrt <= caps.CRT; yCrt += 1) {
    for (let ySks = 0; ySks <= caps.SKS; ySks += 1) {
      if (yCrt + ySks > T) continue;
      for (let yDht = 0; yDht <= 0; yDht += 1) {
        const sum = x0.CRT + yCrt + (x0.DHT + yDht) + x0.DET;
        if (sum > bruteMax) bruteMax = sum;
      }
      bruteAllocations += 1;
    }
  }
  check(bruteMax === trueMaxTargetSum, "F1：穷举真实最大三属性和应为 141");
  // 随机小实例：正确 R_sep 上界 >= 穷举真实最大三属性和（且主精确公式一致）
  const statPool = ["CRT", "DHT", "DET", "SKS", "TEN"];
  let gridChecks = 0;
  const lcg2 = (() => {
    let state = 777;
    return () => {
      state = (state * 1103515245 + 12345) >>> 0;
      return state / 4294967296;
    };
  })();
  for (let trial = 0; trial < 300; trial += 1) {
    const x0Random = {
      CRT: Math.floor(lcg2() * 120),
      DHT: Math.floor(lcg2() * 120),
      DET: Math.floor(lcg2() * 120),
    };
    const statCount = 1 + Math.floor(lcg2() * 3);
    const statsRandom = statPool.slice(0, statCount);
    const capsRandom = {};
    for (const stat of statsRandom) capsRandom[stat] = Math.floor(lcg2() * 6);
    const TRandom = Math.floor(lcg2() * 12);
    const IRandom = statsRandom.filter((stat) => target.includes(stat));
    const increment = Math.min(
      TRandom,
      IRandom.reduce((sum, stat) => sum + capsRandom[stat], 0),
    );
    const s3 = x0Random.CRT + x0Random.DHT + x0Random.DET;
    const bound = s3 + increment;
    // 穷举分配（目标属性固定部分 + 可分配增量），最大化三属性最终和
    let brute = -1;
    const recurse = (index, remaining, added) => {
      if (index === statsRandom.length) {
        if (s3 + added > brute) brute = s3 + added;
        return;
      }
      const stat = statsRandom[index];
      const cap = capsRandom[stat];
      const isTarget = target.includes(stat);
      for (let value = 0; value <= Math.min(cap, remaining); value += 1) {
        recurse(index + 1, remaining - value, added + (isTarget ? value : 0));
      }
    };
    recurse(0, TRandom, 0);
    check(brute === bound, `F1 网格：主精确公式 ${bound} != 穷举 ${brute}`);
    check(bound >= brute, "F1 网格：R_sep 上界必须 >= 真实最大值");
    gridChecks += 1;
  }
  record(
    "T3-resistance-fixed-target",
    `x0=(100,40,0)、stats={CRT,SKS}、CRT cap=1、SKS cap=9、T=10 ⇒ I={CRT}：` +
      `错误 over-I 和=${wrongOverISum} < 真实最大=${trueMaxTargetSum}=S3(x0)+min(T,Σ_I m)（安全上界）; ` +
      `穷举 ${bruteAllocations} 个分配确认 141；${gridChecks} 个随机 (x0,stats,caps,T) 网格上主精确公式=穷举且 R_sep>=真实最大`,
  );
}

// ---- 实例 7：B3 与 B4 不可比（一个实例 B4 更紧，另一个 B3 更紧） ----
{
  const coupling = foodAwareBound(instanceFoodCoupling);
  const uniform = foodAwareBound(instanceUniformFood);
  check(ftoNumber(coupling.breakdown.B4) < ftoNumber(coupling.breakdown.B3),
    "T8 食物耦合实例应 B4 < B3");
  check(ftoNumber(uniform.breakdown.B3) < ftoNumber(uniform.breakdown.B4),
    "T8 均匀食物实例应 B3 < B4");
  record(
    "T8-B3-vs-B4-incomparable",
    `食物耦合实例：B4=${ftoNumber(coupling.breakdown.B4)} < B3=${ftoNumber(coupling.breakdown.B3)}；` +
      `均匀 10% 实例：B3=${fshow(uniform.breakdown.B3)} < B4=${fshow(uniform.breakdown.B4)} ⇒ 不可比`,
  );
}

// ---- 实例 7b：B1–B4 逐一合法性、B4 支配 B1/B2、R_gear <= S* <= R_food ----
{
  const noConstraintInstances = [
    instanceSeparable,
    instanceUniformFood,
    instanceRings,
    instanceFoodCoupling,
    instanceCapNotAttained,
  ];
  let memberChecks = 0;
  for (const instance of noConstraintInstances) {
    const { all, best } = analyze(instance);
    const gear = gearBounds(instance);
    const foods = instance.allowNoFood ? [...instance.foods, null] : instance.foods;
    for (const food of foods) {
      const bounds = foodBounds(instance, food);
      for (const completion of all) {
        const completionFood = completion.food === null ? null : instance.foods[completion.food];
        if (completionFood !== food) continue;
        for (const key of ["B1", "B2", "B3", "B4"]) {
          check(
            fcmp(bounds[key], F(completion.sum)) >= 0,
            `${instance.name}: ${key} 对食物 ${food?.name ?? "⊥"} 失效`,
          );
          memberChecks += 1;
        }
      }
      check(fcmp(bounds.B4, bounds.B1) <= 0, `${instance.name}: 应满足 B4 <= B1`);
      check(fcmp(bounds.B4, bounds.B2) <= 0, `${instance.name}: 应满足 B4 <= B2`);
      memberChecks += 2;
    }
    const foodBound = foodAwareBound(instance);
    check(gear.exactGearSum <= best.sum, `${instance.name}: 应满足 R_gear <= S*（bonus >= 0）`);
    check(fcmp(foodBound.bound, F(best.sum)) >= 0, `${instance.name}: 应满足 R_food >= S*`);
  }
  record(
    "T4-member-validity",
    `${memberChecks} 个 (实例,食物,完成,B_k) / 支配关系检查：每个 B_k 合法，B4<=B1、B4<=B2，` +
      "且各无约束实例满足 R_gear <= S* <= R_food",
  );
}

// ---- 实例 7c：哪些实例的上界取等（= 真实最大值），哪些严格更松 ----
{
  const exactCases = [];
  const strictCases = [];
  for (const instance of [instanceSeparable, instanceUniformFood, instanceFoodCoupling,
    instanceCapNotAttained, instanceRings]) {
    const { best } = analyze(instance);
    const { bound } = foodAwareBound(instance);
    if (fcmp(bound, F(best.sum)) === 0) exactCases.push(`${instance.name}=${best.sum}`);
    else strictCases.push(`${instance.name}: ${ftoNumber(bound)} > ${best.sum}`);
  }
  check(exactCases.length > 0, "T4 应至少有一个取等实例");
  check(strictCases.length > 0, "T4 应至少有一个严格更松实例");
  record(
    "T4-exact-vs-strict",
    `上界取等（R_food = S*）的实例：${exactCases.join("；")}；严格更松的实例：${strictCases.join("；")}`,
  );
}

// ---- 实例 8：层级/支配关系与合法性总检 ----
{
  let validations = 0;
  for (const instance of [instanceSeparable, instanceUniformFood, instanceRings, instanceFoodCoupling,
    instanceCapNotAttained, instanceSpeed, instanceTen, instanceSpeedFood, instanceTenUpper,
    instanceTenFood, instanceCombined]) {
    const { all, best, bestUnconstrained } = analyze(instance);
    const gear = gearBounds(instance);
    check(gear.exactGearSum <= gear.separable, `${instance.name}: R_gear <= R_sep`);
    check(gear.independentlySummed >= gear.exactGearSum, `${instance.name}: 独立最大和 >= 精确配对`);
    check(gear.exactGearSum <= bestUnconstrained.sum, `${instance.name}: R_gear <= 无约束真实最大`);
    check(best.sum <= bestUnconstrained.sum, `${instance.name}: 约束只会降低真实最大`);
    // 逐属性最大相加确实是 gear 和的合法上界（任意合法完成）
    let maxGearSum = 0;
    for (const completion of all) {
      const sum = completion.gear.reduce((total, value) => total + value, 0);
      if (sum > maxGearSum) maxGearSum = sum;
    }
    check(maxGearSum <= gear.separable, `${instance.name}: R_sep 必须 >= 任意完成的 gear 和`);
    if (instance.speedMax === undefined && instance.tenMin === undefined && instance.tenMax === undefined) {
      const { bound } = foodAwareBound(instance);
      check(fcmp(bound, F(best.sum)) >= 0, `${instance.name}: 食物界必须 >= 真实最大`);
      validations += 1;
    } else {
      const { bound } = constraintBound(instance);
      check(fcmp(bound, F(best.sum)) >= 0, `${instance.name}: 约束界必须 >= 真实最大`);
      validations += 1;
    }
  }
  record("T8-validity-sweep", `${validations} 个实例的全部已证明上界 >= 穷举真实最大`);
}

// ---- 食物公式 + baseStat + U 单调性 ----
verifyFoodFormulaAgainstCanonical();
verifyBaseStatOffsets();
const flatPrefix = verifyUMonotoneInR();

// ---- 实例 7d：U 的平台例子（最小合法 R 给出最小 U，但增大 R 不一定改进 U） ----
{
  const series = [];
  for (let R = 0; R <= 6; R += 1) series.push(uBrute(100, "WHM", [0, 0, 0], R));
  check(series[5] === series[0], "T7 U 平台例子失效（U(0..5) 应相等）");
  check(series[6] > series[5], "T7 U 平台例子失效（U(6) 应严格更大）");
  record(
    "T7-U-flat-example",
    `level 100 WHM b=(0,0,0)：U(0)=…=U(5)=${series[0]}，U(6)=${series[6]}` +
      "（6 点预算才使 DHT 跨档）。说明 U 对 R 单调非减但可以是平台函数：" +
      "最小合法和 R 给出最小 U，而增大 R 不必然改进 U",
  );
  check(flatPrefix !== null, "U 平台前缀未被记录");
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
console.log("substat-sum-upper-bound verification: PASS");
for (const entry of report) console.log(`  [ok] ${entry.name}: ${entry.detail}`);
console.log(`  checks: ${checks}`);
console.log(
  "scope: 小型合成实例（2–3 槽 × 2–4 候选、≤2 食物、含/不含约束与戒指唯一性）逐点穷举；" +
    "精确有理数比较。一般性证明见 README.md。",
);
