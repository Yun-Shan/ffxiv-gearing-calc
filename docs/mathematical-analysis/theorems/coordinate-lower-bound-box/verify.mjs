/**
 * coordinate-lower-bound-box/verify.mjs
 *
 * 目的：为 docs/mathematical-analysis/theorems/coordinate-lower-bound-box/README.md 提供
 * **有限域精确证书**（小型盒域 / 一般有限域 / slab 子域 / 单点并集）：
 *   T1  逐坐标下界 l_i(B) 的定义、屏障性质、乘积下界 Phi(l)<=OPT；
 *   T2  maximizer 的刻画 {x: x_i >= c_i^opt}；l(OPT)=c^opt；
 *   T3  便宜的一元充要式 l_i^cap 在盒域上 = l_i（精确），在 subdomain 上 <= 且可严格；
 *   T4  精炼算子 T(B)=max(B,Phi(l(B)))：安全、单调、幂等（T∘T=T）、有限稳定、
 *      不动点条件、T=OPT 的精确阈值；改进/停滞/严格-非严格混用/非法 B 反例；
 *   T5  与 strict-improvement-frontier 的 K_{e_i} 对应、与 pairwise 切片分析的关系（数值复核）；
 *   T6  完整伤害因子扩展的必要/下界公式的数值复核；
 *   T9  小域 D⊂Omega 上的超集屏障（定理 1'）：B<=OPT_D 时屏障/乘积下界/T 有效；
 *       B 只 <= OPT_Omega 而 > OPT_D 时全部失效（精确反例）；
 *   另：baseStat 贡献坐标偏移核对。
 *
 * 证明作用：有限实例上的证书与反例；一般性证明在 README.md。
 * 所有确定性比较使用整数/BigInt（盒域枚举用小整数 Number，但每个乘积都断言在 2^53 内精确）。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/coordinate-lower-bound-box/verify.mjs
 */
import {
  assert,
  criticalFactor,
  determinationFactor,
  directHitFactor,
  firstContributionWithTierAtLeast,
  tier,
} from "../../verification/canonical-model.mjs";

const report = [];
let checks = 0;
function record(name, detail) {
  report.push({ name, detail });
}
function check(condition, message) {
  checks += 1;
  assert(condition, message);
}

const LEVEL = 100;
const JOB = "WHM"; // 普通职业；BLU 只改 b_C 与 +200 偏移，本文定理与职业无关
const G_MAX = 240; // 覆盖盒域上限 100 与 §7 非法 B 反例用的 200
const KAPPA = [100, 100, 100]; // 盒域 Omega
const N = KAPPA[0] + 1;

// ---------------------------------------------------------------------------
// 0. 因子表（贡献坐标；精确整数）
// ---------------------------------------------------------------------------
const fCBig = [];
const fHBig = [];
const fDBig = [];
const fCNum = [];
const fHNum = [];
const fDNum = [];
for (let g = 0; g <= G_MAX; g += 1) {
  const c = criticalFactor(tier(LEVEL, JOB, "CRT", g), JOB);
  const h = directHitFactor(tier(LEVEL, JOB, "DHT", g));
  const d = determinationFactor(tier(LEVEL, JOB, "DET", g));
  fCBig.push(BigInt(c));
  fHBig.push(BigInt(h));
  fDBig.push(BigInt(d));
  fCNum.push(c);
  fHNum.push(h);
  fDNum.push(d);
}

function phiBig(x) {
  return fCBig[x[0]] * fHBig[x[1]] * fDBig[x[2]];
}
function phiNum(x) {
  return fCNum[x[0]] * fHNum[x[1]] * fDNum[x[2]];
}

// 盒域全枚举（用于 l 的暴力定义、屏障与 maximizer 核验）
const total = N * N * N;
const phiTable = new Float64Array(total);
let idx = 0;
for (let c = 0; c < N; c += 1) {
  for (let h = 0; h < N; h += 1) {
    for (let d = 0; d < N; d += 1) {
      phiTable[idx] = phiNum([c, h, d]);
      idx += 1;
    }
  }
}
function tableIndex(x) {
  return (x[0] * N + x[1]) * N + x[2];
}
function phiTableAt(x) {
  return phiTable[tableIndex(x)];
}
// 枚举后一次性核对所有 Phi 值都是 < 2^53 的安全整数（本实例最大 OPT≈4.13e12）
{
  let bad = 0;
  for (let i = 0; i < total; i += 1) {
    if (!Number.isSafeInteger(phiTable[i])) bad += 1;
  }
  check(bad === 0, `盒域 Phi 表存在超出 2^53 的值：${bad} 个`);
}

const OPT = phiBig(KAPPA); // 因 Phi 单调非减，盒域最大值 = 顶角值
{
  let maximum = 0;
  for (let i = 0; i < total; i += 1) if (phiTable[i] > maximum) maximum = phiTable[i];
  check(BigInt(maximum) === OPT, `盒域最大值应等于 Phi(kappa)=${OPT}，实际 ${maximum}`);
}

// ---------------------------------------------------------------------------
// 1. 定义：l^>=(B) / l^>(B) 的暴力定义（盒域）
// ---------------------------------------------------------------------------
function lNonstrictBrute(i, B) {
  let best = Infinity;
  const target = Number(B);
  for (let c = 0; c < N; c += 1) {
    for (let h = 0; h < N; h += 1) {
      for (let d = 0; d < N; d += 1) {
        const value = phiTable[(c * N + h) * N + d];
        if (value >= target) {
          const coordinate = i === 0 ? c : i === 1 ? h : d;
          if (coordinate < best) best = coordinate;
        }
      }
    }
  }
  return best;
}
function lStrictBrute(i, B) {
  let best = Infinity;
  const target = Number(B);
  for (let c = 0; c < N; c += 1) {
    for (let h = 0; h < N; h += 1) {
      for (let d = 0; d < N; d += 1) {
        const value = phiTable[(c * N + h) * N + d];
        if (value > target) {
          const coordinate = i === 0 ? c : i === 1 ? h : d;
          if (coordinate < best) best = coordinate;
        }
      }
    }
  }
  return best;
}

/** 便宜的一元式：固定另外两个属性在各自 cap。 */
function lCapBig(i, B) {
  const others = [
    fHBig[KAPPA[1]] * fDBig[KAPPA[2]],
    fCBig[KAPPA[0]] * fDBig[KAPPA[2]],
    fCBig[KAPPA[0]] * fHBig[KAPPA[1]],
  ][i];
  const factors = [fCBig, fHBig, fDBig][i];
  for (let c = 0; c <= KAPPA[i]; c += 1) {
    if (factors[c] * others >= B) return c;
  }
  return Infinity;
}

function lVec(B) {
  return [0, 1, 2].map((i) => lCapBig(i, B));
}

/** 精炼算子 T(B) = max(B, Phi(l(B)))。B 非法（>OPT）时返回 +Infinity 以标记失效。 */
function refine(B) {
  if (B > OPT) return null;
  const l = lVec(B);
  if (!l.every(Number.isFinite)) return null;
  const product = phiBig(l);
  return product > B ? product : B;
}

// ---------------------------------------------------------------------------
// 2. 盒域关键量：OPT、c^opt、M 阈值、l(OPT)
// ---------------------------------------------------------------------------
function topTierThreshold(stat, cap) {
  const top = tier(LEVEL, JOB, stat, cap);
  return firstContributionWithTierAtLeast(LEVEL, JOB, stat, top);
}
const cOpt = [
  topTierThreshold("CRT", KAPPA[0]),
  topTierThreshold("DHT", KAPPA[1]),
  topTierThreshold("DET", KAPPA[2]),
];
check(phiBig(cOpt) === OPT, "Phi(c^opt) 必须等于 OPT");

// 低于最优一档的最大乘积 M_i = Phi(c^opt 但第 i 坐标 = c_i^opt - 1)
const belowOptimal = [];
for (let i = 0; i < 3; i += 1) {
  const point = cOpt.slice();
  point[i] = Math.max(0, point[i] - 1);
  belowOptimal.push(phiBig(point));
}
const MThreshold = belowOptimal.reduce((left, right) => (left > right ? left : right));
check(belowOptimal[0] === 4_130_927_863_920n, "M_C 数值变化需同步 README");
check(belowOptimal[1] === 4_131_769_649_910n, "M_H 数值变化需同步 README");
check(belowOptimal[2] === 4_128_685_728_124n, "M_D 数值变化需同步 README");
check(MThreshold === belowOptimal[1], "M 应取 M_H（本实例）");
check(phiBig([0, 0, 0]) === 4_080_000_000_000n, "Phi(0) 数值变化需同步 README");
check(phiBig([100, 0, 0]) === 4_092_796_000_000n, "Phi(100,0,0) 数值变化需同步 README");
check(OPT === 4_132_797_964_905n, "OPT 数值变化需同步 README");
record(
  "T4-M-threshold-values",
  `M_C=${belowOptimal[0]}，M_H=${belowOptimal[1]}，M_D=${belowOptimal[2]}，M=${MThreshold}，OPT-M=${OPT - MThreshold}`,
);

// 盒域 maximizer = {x: x_i >= c_i^opt}
{
  let optimizerCount = 0;
  let mismatches = 0;
  let checkedPoints = 0;
  for (let c = 0; c < N; c += 1) {
    for (let h = 0; h < N; h += 1) {
      for (let d = 0; d < N; d += 1) {
        const optimal = phiTable[(c * N + h) * N + d] === Number(OPT);
        const inTopRegion = c >= cOpt[0] && h >= cOpt[1] && d >= cOpt[2];
        if (optimal !== inTopRegion) mismatches += 1;
        if (optimal) optimizerCount += 1;
        checkedPoints += 1;
      }
    }
  }
  check(mismatches === 0, `maximizer 刻画失败：${mismatches} 个不一致点`);
  record(
    "T2-optimal-set",
    `OPT=${OPT}，c^opt=(${cOpt.join(",")})；盒域 maximizer 恰为 {x: x_i>=c_i^opt}（${optimizerCount} 个点，` +
      `${checkedPoints} 个点核对）`,
  );
}

// 所有 B<=OPT 的 l 坐标 <= c^opt
const B_VALUES = [
  1n,
  phiBig([0, 0, 0]),
  phiBig([100, 0, 0]),
  MThreshold - 1n,
  MThreshold,
  MThreshold + 1n,
  OPT - 1n,
  OPT,
];
{
  for (const B of B_VALUES) {
    const l = lVec(B);
    for (let i = 0; i < 3; i += 1) {
      check(l[i] <= cOpt[i], `l_i(B) <= c_i^opt 失败 B=${B} i=${i}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. T1/T3：l 的暴力定义 = 一元式；屏障；乘积下界；严格/非严格语义
// ---------------------------------------------------------------------------
{
  let equalityChecks = 0;
  let barrierChecks = 0;
  let productChecks = 0;
  for (const B of B_VALUES) {
    const l = lVec(B);
    // (a) 与暴力定义一致（盒域上 l^cap 恰等于 l^>=）
    for (let i = 0; i < 3; i += 1) {
      check(l[i] === lNonstrictBrute(i, B), `l 定义不一致 B=${B} i=${i}`);
      equalityChecks += 1;
    }
    // (b) 屏障：每个 maximizer 的坐标 >= l
    const target = Number(B);
    for (let c = 0; c < N; c += 1) {
      for (let h = 0; h < N; h += 1) {
        for (let d = 0; d < N; d += 1) {
          if (phiTable[(c * N + h) * N + d] === Number(OPT)) {
            check(c >= l[0] && h >= l[1] && d >= l[2], `屏障性质失败 B=${B}`);
            barrierChecks += 1;
          }
        }
      }
    }
    // (c) 把某个坐标压到 l_i-1（其它坐标即使取 cap）也不可能达到 B
    for (let i = 0; i < 3; i += 1) {
      if (!Number.isFinite(l[i]) || l[i] === 0) continue;
      const lowered = KAPPA.slice();
      lowered[i] = l[i] - 1;
      check(phiBig(lowered) < B, `降坐标反例失败 B=${B} i=${i}`);
    }
    // (d) 任意点只要某坐标 < l_i 就 Phi < B（含同时提高其它坐标的点）
    let loweredViolations = 0;
    let containmentViolations = 0;
    for (let c = 0; c < N; c += 1) {
      for (let h = 0; h < N; h += 1) {
        for (let d = 0; d < N; d += 1) {
          const value = phiTable[(c * N + h) * N + d];
          if (c < l[0] || h < l[1] || d < l[2]) {
            if (!(value < target)) loweredViolations += 1;
          }
          if (value >= target) {
            if (!(c >= l[0] && h >= l[1] && d >= l[2])) containmentViolations += 1;
          }
          barrierChecks += 1;
        }
      }
    }
    check(loweredViolations === 0, `l 屏障（任意点）失败 B=${B}`);
    check(containmentViolations === 0, `l 是坐标下界（集合包含）失败 B=${B}`);
    // (e) 乘积下界 Phi(l) <= OPT
    const product = phiBig(l);
    check(product <= OPT, `Phi(l) <= OPT 失败 B=${B}`);
    productChecks += 1;
  }
  record(
    "T1-barrier-and-product",
    `${equalityChecks} 个 l 定义点、${barrierChecks} 个屏障点、${productChecks} 个 Phi(l)<=OPT 检查全部通过；` +
      "含“把任一坐标降到 l_i-1、其它坐标取 cap”仍 < B 的精确反例检查",
  );
}

// 严格版 semantics：B<OPT 时非空且 l^>(B) >= l^>=(B)；B=OPT 时 I_>(OPT)=∅
{
  const strictB = OPT - 1n;
  const lGreater = [0, 1, 2].map((i) => lStrictBrute(i, strictB));
  const lGreaterEqual = lVec(strictB);
  for (let i = 0; i < 3; i += 1) {
    check(lGreater[i] >= lGreaterEqual[i], "l^>(B) >= l^>=(B) 失败");
    check(lGreater[i] === cOpt[i], "B=OPT-1 时严格版应给出 c^opt（只剩最优点的严格改善）");
  }
  check(lStrictBrute(0, OPT) === Infinity, "B=OPT 时 I_>(OPT) 应为空（l^>=+Infinity）");
  check(lNonstrictBrute(0, OPT) === cOpt[0], "B=OPT 时非严格版应给出 c^opt");
  record(
    "T1-strict-tie-semantics",
    `B=OPT-1：l^>=(98,97,100)=l^>=c^opt；B=OPT：I_> 为空（l^>=+∞），非严格 I_>= 给出 c^opt；` +
      "混用（strict kernel + B=OPT）会得到 +∞（层必须禁用）",
  );
}

// l 关于 B 单调非减 / Phi(l) 单调非增；T 安全与单调
{
  const sorted = [...B_VALUES].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  let monotoneChecks = 0;
  let previousL = null;
  let previousProduct = null;
  let previousT = null;
  for (const B of sorted) {
    const l = lVec(B);
    const product = phiBig(l);
    const t = refine(B);
    check(product <= OPT, "Phi(l) <= OPT 失败");
    if (previousL !== null) {
      for (let i = 0; i < 3; i += 1) check(l[i] >= previousL[i], "l 关于 B 应非减");
      check(product >= previousProduct, "Phi(l) 关于 B 应非减");
      check(t >= previousT, "T 关于 B 应非减");
    }
    previousL = l;
    previousProduct = product;
    previousT = t;
    monotoneChecks += 1;
  }
  record(
    "T1-monotone-in-B",
    `${monotoneChecks} 个 B 点上 l(B) 坐标非减、Phi(l(B)) 非减、T(B) 非减，且 B<=OPT ⇒ T(B)<=OPT`,
  );
}

// ---------------------------------------------------------------------------
// 4. T4：精炼算子的安全/单调/幂等/稳定/不动点/阈值/反例
// ---------------------------------------------------------------------------
{
  let idempotentChecks = 0;
  const trajectories = [];
  for (const start of [1n, phiBig([0, 0, 0]), phiBig([100, 0, 0]), MThreshold - 1n, MThreshold, MThreshold + 1n, OPT - 1n]) {
    const chain = [start];
    let current = start;
    for (let step = 0; step < 20; step += 1) {
      const next = refine(current);
      check(next !== null, "T 在合法 B 上不应为 null");
      check(next >= current, "T 应单调非减");
      check(next <= OPT, "T 应 <= OPT");
      if (next === current) break;
      chain.push(next);
      current = next;
    }
    const t1 = refine(start);
    check(refine(t1) === t1, `T 幂等失败 start=${start}`);
    idempotentChecks += 1;
    trajectories.push({ start, chain });
  }
  record(
    "T4-refinement-trajectories",
    `${idempotentChecks} 条轨迹最多一次严格改进后稳定（T∘T=T）；轨迹：` +
      trajectories
        .map((entry) => `${entry.start}→${entry.chain.slice(1).join("→") || "（不动点）"}`)
        .join("；"),
  );
}

// T=OPT 的精确阈值：B > M ⇔ T(B)=OPT（B<=OPT）
{
  check(refine(MThreshold) === MThreshold, `B=M 时 T(B) 应为 M（此处应为不动点）`);
  check(refine(MThreshold + 1n) === OPT, `B=M+1 时 T(B) 应跳到 OPT`);
  check(refine(OPT - 1n) === OPT, `B=OPT-1 时 T(B) 应跳到 OPT`);
  const lAboveThreshold = lVec(MThreshold + 1n);
  check(
    lAboveThreshold.every((value, i) => value === cOpt[i]),
    `B=M+1 时 l 应等于 c^opt，实际 (${lAboveThreshold.join(",")})`,
  );
  const beforeThreshold = refine(MThreshold - 1n);
  check(beforeThreshold === MThreshold, `B=M-1 时应先改进到 M：${beforeThreshold}`);
  record(
    "T4-threshold-M",
    `M=max_i(把 c^opt 的第 i 坐标降 1 的乘积)=${MThreshold}；l(M)=(${lVec(MThreshold).join(",")})、` +
      `Phi(l(M))=M ⇒ 不动点；l(M+1)=c^opt ⇒ 一步到 OPT。T=OPT ⇔ B>M（B<=OPT）`,
  );
}

// 改进/停滞数值
{
  const base = phiBig([0, 0, 0]);
  check(refine(1n) === base, "T(1) 应等于 Phi(0)");
  check(refine(base) === base, "T(Phi(0)) 应为不动点（停滞）");
  const stallB = phiBig([100, 0, 0]);
  check(refine(stallB) === stallB, "B=Phi(100,0,0) 应为不动点（Phi(l)<B 的严格停滞）");
  check(phiBig(lVec(stallB)) < stallB, "该停滞点应满足 Phi(l)<B");
  record(
    "T4-improve-stall",
    `改进：T(1)=${base}，之后不动；T(OPT-1)=OPT。停滞：B=Phi(0)=${base} 是不动点（Phi(l)=B）；` +
      `B=Phi(100,0,0)=${stallB} 立即不动且 Phi(l)=${phiBig(lVec(stallB))}<B（严格无改进）；` +
      `停滞点距 OPT 仍有 ${OPT - stallB}`,
  );
}

// 非法 B：B>OPT（例如把上界/更大盒域的乘积当 B）⇒ I 为空；naive clamp 到 kappa 的屏障是假的
{
  const biggerBoxPoint = [200, 200, 200];
  const badB = fCBig[biggerBoxPoint[0]] * fHBig[biggerBoxPoint[1]] * fDBig[biggerBoxPoint[2]];
  check(badB > OPT, "非法 B 应大于盒域 OPT");
  check(lNonstrictBrute(0, badB) === Infinity, "B>OPT 时 I_>= 应为空");
  check(refine(badB) === null, "B>OPT 时 T 应返回 null（失效）");
  const naiveBarrier = KAPPA;
  const optimizer = [98, 97, 100];
  check(optimizer[0] < naiveBarrier[0], "非法 B 下把 l 截断为 kappa 会排除真实 maximizer");
  record(
    "T4-invalid-B-counterexample",
    `badB=Phi_{κ=200}(200,200,200)=${badB} > OPT=${OPT} ⇒ I_>=(badB)=∅、T 失效；` +
      `若把空集/上界误当 B 并把 l 截为 κ=${naiveBarrier}，会排除真实 maximizer (98,97,100) ⇒ 屏障性质失效`,
  );
}

// ---------------------------------------------------------------------------
// 5. 一般有限域（非盒）：l 不必可行；乘积下界仍成立
// ---------------------------------------------------------------------------
{
  const domain = [[100, 0, 0], [0, 100, 0], [0, 0, 100]];
  const values = domain.map((x) => phiBig(x));
  const optD = values.reduce((left, right) => (left > right ? left : right));
  const lDomain = [0, 1, 2].map((i) => {
    let best = Infinity;
    for (let k = 0; k < domain.length; k += 1) {
      if (values[k] >= 1n && domain[k][i] < best) best = domain[k][i];
    }
    return best;
  });
  const lPoint = lDomain;
  const inDomain = domain.some((x) => x.every((v, i) => v === lPoint[i]));
  const product = phiBig(lPoint);
  check(!inDomain, "并集域例子的 l 应不在域内");
  check(product <= optD, "非盒域 Phi(l) <= OPT 仍应成立");
  record(
    "T5-nonbox-l-infeasible",
    `D3={(100,0,0),(0,100,0),(0,0,100)}：OPT_D=${optD}；B=1 时 l=(${lPoint.join(",")})∉D，` +
      `但 Phi(l)=${product} <= OPT_D（乘积下界不要求 l 可行；屏障 x*_i>=l_i 仍由单调性给出）`,
  );
}

// ---------------------------------------------------------------------------
// 6. Slab 子域：l^cap <= l^slab（可严格）；乘积下界与屏障
// ---------------------------------------------------------------------------
function slabOptimumAndBarriers(sumMax, B) {
  let opt = 0;
  let optPoint = null;
  let best = [Infinity, Infinity, Infinity];
  const target = Number(B);
  for (let c = 0; c < N; c += 1) {
    for (let h = 0; h < N; h += 1) {
      if (c + h > sumMax) continue;
      for (let d = 0; d < N; d += 1) {
        if (c + h + d > sumMax) continue;
        const value = phiTable[(c * N + h) * N + d];
        if (value > opt) {
          opt = value;
          optPoint = [c, h, d];
        }
        if (value >= target) {
          if (c < best[0]) best[0] = c;
          if (h < best[1]) best[1] = h;
          if (d < best[2]) best[2] = d;
        }
      }
    }
  }
  return { opt, optPoint, l: best };
}
{
  const SEARCH_MAX = 150;
  const slab = slabOptimumAndBarriers(SEARCH_MAX, null);
  const B = BigInt(slab.opt);
  const slabBarriers = slabOptimumAndBarriers(SEARCH_MAX, B).l;
  const capBarriers = lVec(B);
  let strict = false;
  for (let i = 0; i < 3; i += 1) {
    check(capBarriers[i] <= slabBarriers[i], `l^cap <= l^slab 失败 i=${i}`);
    if (capBarriers[i] < slabBarriers[i]) strict = true;
  }
  check(strict, "slab 例子应出现严格分离");
  check(phiBig(slabBarriers) <= B, "slab 的 Phi(l) <= OPT_slab");
  check(phiBig(slabBarriers) === B, "slab 最优点的 l（非严格）应取到 OPT_slab");
  record(
    "T6-slab-strict-separation",
    `Smax=${SEARCH_MAX}：OPT_slab=${slab.opt}（在 (${slab.optPoint.join(",")})）；` +
      `盒域一元式 l^cap=(${capBarriers.join(",")})，slab 子域 l^slab=(${slabBarriers.join(",")}) ⇒ ` +
      `l^cap <= l^slab 且严格（其它两属性不能同时取 cap）；Phi(l^slab)=OPT_slab`,
  );
}

// 第二个 slab 例子（三个坐标都为正的严格分离）
{
  const SEARCH_MAX = 250;
  const slab = slabOptimumAndBarriers(SEARCH_MAX, null);
  const B = BigInt(slab.opt);
  const slabBarriers = slabOptimumAndBarriers(SEARCH_MAX, B).l;
  const capBarriers = lVec(B);
  let strict = false;
  for (let i = 0; i < 3; i += 1) {
    check(capBarriers[i] <= slabBarriers[i], `l^cap <= l^slab 失败 i=${i}`);
    if (capBarriers[i] < slabBarriers[i]) strict = true;
  }
  check(strict, "第二 slab 例子应出现严格分离");
  check(phiBig(slabBarriers) === BigInt(slab.opt), "第二 slab 的 l 应取到 OPT_slab（本实例）");
  record(
    "T6-slab-strict-separation-2",
    `Smax=${SEARCH_MAX}：OPT_slab=${slab.opt}；l^cap=(${capBarriers.join(",")}) < l^slab=(${slabBarriers.join(",")})` +
      "（第二个例子三个坐标均非平凡）",
  );
}

// ---------------------------------------------------------------------------
// 7b. 小域 D ⊂ Omega 上的超集屏障（定理 1'）
//     B 必须是 D 上的下界：l^Omega(B) 的屏障/乘积下界/T_Omega 对 OPT_D 有效；
//     B 只满足 B<=OPT_Omega 而 B>OPT_D 时全部失效（精确反例）。
// ---------------------------------------------------------------------------
function smallDomainStats(sumMax) {
  let opt = -1n;
  const optimizers = [];
  for (let c = 0; c < N; c += 1) {
    for (let h = 0; h < N; h += 1) {
      if (c + h > sumMax) continue;
      for (let d = 0; d < N; d += 1) {
        if (c + h + d > sumMax) continue;
        const value = phiBig([c, h, d]);
        if (value > opt) {
          opt = value;
          optimizers.length = 0;
          optimizers.push([c, h, d]);
        } else if (value === opt) {
          optimizers.push([c, h, d]);
        }
      }
    }
  }
  return { opt, optimizers };
}
{
  // 正例：D = {C+H+D <= 200}（真子域），B = OPT_D
  const D = smallDomainStats(200);
  const B = D.opt;
  const l = lVec(B); // Omega 上的 l
  check(!l.every((value) => value === 0), "正例应得到非平凡（非全零）l^Omega");
  let barrierChecks = 0;
  for (const x of D.optimizers) {
    check(x[0] >= l[0] && x[1] >= l[1] && x[2] >= l[2], "定理 1' 屏障失败（D 的 optimizer 应 >= l^Omega）");
    barrierChecks += 1;
  }
  const product = phiBig(l);
  check(product <= B, "定理 1'：Phi(l^Omega) <= OPT_D 失败");
  const t = refine(B);
  check(t >= B && t <= B, "定理 1'：T_Omega 应有界于 [B, OPT_D]（本例取等）");
  record(
    "T9-superset-barrier-positive",
    `D={C+H+D<=200}：OPT_D=${D.opt}，optimizer ${D.optimizers.length} 个（例如 (${D.optimizers[0].join(",")})）；` +
      `l^Omega(B)=(${l.join(",")})，${barrierChecks} 个 optimizer 满足 x*_i>=l_i；Phi(l^Omega)=${product}<=OPT_D；` +
      `T_Omega(B)=${t}∈[B,OPT_D]`,
  );
}

{
  // 反例：B 只满足 B<=OPT_Omega 而 B>OPT_D ⇒ 屏障/乘积下界/T 全部失效
  const D = smallDomainStats(294); // 真子域：恰好排除 top region（最小 sum=295）
  const badB = D.opt + 1n;
  check(D.opt < badB && badB <= OPT, "反例应满足 OPT_D < B <= OPT_Omega");
  const l = lVec(badB);
  check(
    l[0] === cOpt[0] && l[1] === cOpt[1] && l[2] === cOpt[2],
    "反例中 B>M 应给出 l^Omega=c^opt",
  );
  const realOptimizer = D.optimizers[0];
  const violatesBarrier = realOptimizer[0] < l[0] || realOptimizer[1] < l[1] || realOptimizer[2] < l[2];
  check(violatesBarrier, "反例：D 的真实 optimizer 应违反坐标屏障");
  const product = phiBig(l);
  check(product > D.opt, "反例：Phi(l^Omega) 应 > OPT_D（乘积下界失效）");
  const t = refine(badB);
  check(t > D.opt, "反例：T_Omega(B) 应 > OPT_D（精炼下界失效）");
  check(l.every((value, i) => value >= 0), "反例 l 仍应有限");
  record(
    "T9-superset-barrier-failure",
    `D={C+H+D<=294}：OPT_D=${D.opt}（optimizer (${realOptimizer.join(",")})）；` +
      `取 B=OPT_D+1=${badB}（满足 B<=OPT_Omega=${OPT} 但 B>OPT_D）；` +
      `l^Omega(B)=c^opt=(${l.join(",")}) ⇒ 真实 optimizer 的 H=${realOptimizer[1]}<l_H=${l[1]}（屏障失效）；` +
      `Phi(l^Omega)=${product}>OPT_D（乘积"下界"失效）；T_Omega(B)=${t}>OPT_D（精炼失效）`,
  );
}

// ---------------------------------------------------------------------------
// 7. 与 strict-improvement-frontier 的 K_{e_i} 对应（数值复核）
// ---------------------------------------------------------------------------
{
  // K_{e_i}^>=(B) := min{x_i : Phi(x) >= B}（盒域）恰为 l_i(B)
  let relationChecks = 0;
  for (const B of B_VALUES) {
    for (let i = 0; i < 3; i += 1) {
      const kSupport = lNonstrictBrute(i, B); // 按 frontier 的定义（方向 e_i）在此盒域上的值
      check(kSupport === lVec(B)[i], `l_i 与 K_{e_i}^>= 不一致 B=${B} i=${i}`);
      relationChecks += 1;
    }
  }
  record(
    "T7-frontier-relation",
    `${relationChecks} 个 (B,i) 点确认 l_i(B) = K_{e_i}^>=(B)（strict 版对应 K_{e_i}）；` +
      "box 剪枝 = 3 个轴方向半空间，不超出支撑族",
  );
}

// ---------------------------------------------------------------------------
// 8. 完整伤害因子扩展（数值复核；符号与方向见 README 定理 7）
// ---------------------------------------------------------------------------
{
  // 合成其它乘区：Q ∈ [Q_lo, Q_ub]，gcd ∈ [gcd_lo, gcd_hi]
  const Q_lo = 2000n;
  const Q_ub = 2500n;
  const gcd_lo = 24n;
  const gcd_hi = 30n;
  const B_full = OPT; // 任意严格阈值，仅用于复核公式方向
  // 下界：在点 l（盒域可行）处 full >= Phi(l) * Q_lo / gcd_hi
  const l = lVec(B_full);
  const lowerBound = (phiBig(l) * Q_lo) / gcd_hi;
  check(lowerBound <= (phiBig(l) * Q_ub) / gcd_lo, "完整目标下界方向检查");
  // 必要条件：full > B_full ⇒ Phi > B_full * gcd_lo / Q_ub
  const thresholdSub = (B_full * gcd_lo) / Q_ub;
  let necessaryChecks = 0;
  for (const samplePhi of [OPT, OPT - 1n, phiBig(cOpt), phiBig([0, 0, 0])]) {
    for (const Q of [Q_lo, 2100n, Q_ub]) {
      for (const g of [gcd_lo, 27n, gcd_hi]) {
        const full = (samplePhi * Q) / g;
        if (full > B_full) {
          check(samplePhi > thresholdSub, "完整伤害必要条件方向失败");
        }
        necessaryChecks += 1;
      }
    }
  }
  record(
    "T8-full-damage-extension",
    `下界式 Phi(l)*Q_lo/gcd_hi=${lowerBound}（点 l 可行）；必要条件 Phi > B_full*gcd_lo/Q_ub=${thresholdSub}；` +
      `${necessaryChecks} 个 (Phi,Q,gcd) 样本方向复核`,
  );
}

// ---------------------------------------------------------------------------
// 9. baseStat 贡献坐标核对（§13）
// ---------------------------------------------------------------------------
{
  check(fCBig[0] === 1_020_000n, "level 100 CRT 基础因子应为 1,020,000");
  check(fHBig[0] === 4000n, "level 100 DHT 基础因子应为 4,000");
  check(fDBig[0] === 1000n, "level 100 DET 基础因子应为 1,000");
  check(cOpt[0] === 98 && cOpt[1] === 97 && cOpt[2] === 100, "c^opt 数值变化需同步 README");
  record(
    "baseStat-coordinate",
    "贡献坐标：Phi(0,0,0)=1,020,000*4,000*1,000=4,080,000,000,000；" +
      "面板总值 = 等级/种族基础 (sub,sub,main) + 贡献（level 100 = (420,420,440)）",
  );
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
console.log("coordinate-lower-bound-box verification: PASS");
for (const entry of report) console.log(`  [ok] ${entry.name}: ${entry.detail}`);
console.log(`  checks: ${checks}`);
console.log(
  "scope: 盒域 κ=(100,100,100)（level 100 WHM）全枚举 1,030,301 点 + 并集域 + 两个 slab 子域 + " +
    "小域超集屏障正例/反例；精确整数比较。一般性证明见 README.md。",
);
