/**
 * simplex-vertex-reduction/verify.mjs
 *
 * 目的：为本目录 README.md 的定理 B 提供**有限域证书**：
 *   T1  无条件顶点公式 **已否证**：给出两个完整的精确反例（含三顶点、内部最优点、
 *       反例间隙、边界最大值），并验证每个支持等级都存在反例；
 *   T2  充分条件（所有两属性切片端点最大 => 存在顶点最优解）的**有限实例复核**：
 *       证书成立时逐点验证顶点最优；并寻找「顶点最优但某切片违反端点最大」的实例
 *       以说明该条件不是必要的（若找不到则报告中标记为未解决）；
 *   T3  证书可判定但在真实区间失败：给出具体切片反例见证；
 *   T4  无顶点假设的安全回退：验证 U 等于档位三元组预算公式（定理 A），
 *       以及由部分已认证属性对构造的严格上界 UB_pair >= U。
 *
 * 覆盖范围：支持等级 {50,60,70,80,90,100} × 公式可区分两类 {WHM(普通), BLU} × 显式列出的
 *           baseline / R 网格；全部为精确整数计算（BigInt 乘积），不抽样。
 *   额外：baseStat 影响审计（README §13）——贡献坐标 vs 面板总值的生产交叉验证，
 *         以及逐等级反例只使用职业上限内的 (level, job) 组合（BLU 上限 80）。
 *
 * 证明作用：有限网格上的反例证书与实现对照；一般性证明在 README.md 中。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/simplex-vertex-reduction/verify.mjs
 */
import {
  assert,
  criticalFactor,
  determinationFactor,
  directHitFactor,
  DOCUMENTED_LEVEL_PARAMS,
  factorsAt,
  firstContributionWithTierAtLeast,
  loadCanonicalEvaluator,
  loadGameData,
  tier,
} from "../../verification/canonical-model.mjs";

const LEVELS = [50, 60, 70, 80, 90, 100];
const JOBS = ["WHM", "BLU"];
const STATS = ["CRT", "DHT", "DET"];
const INF = Number.POSITIVE_INFINITY;
const report = [];
let checks = 0;

function record(name, detail) {
  report.push({ name, detail });
}

function check(condition, message) {
  checks += 1;
  assert(condition, message);
}

// baseStat / 职业上限审计所需数据（只读）。BLU 的 maxJobLevel = 80；
// 因此逐等级反例只允许使用职业上限内的 (level, job) 组合。
const gameData = await loadGameData();
const maxJobLevel = (job) => gameData.jobSchemas[job].maxJobLevel;

// ---------------------------------------------------------------------------
// 0. 因子查表：把生产档位模型固定成表，全部枚举都是精确整数。
// ---------------------------------------------------------------------------
const G_MAX = 4200; // 覆盖 baseline <= 200 与 R <= 1500（含 cap 情形 2000 余量）
const factorTables = new Map();
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const stat of STATS) {
      const table = new Array(G_MAX + 1);
      for (let g = 0; g <= G_MAX; g += 1) {
        const t = tier(level, job, stat, g);
        table[g] =
          stat === "CRT" ? criticalFactor(t, job)
            : stat === "DHT" ? directHitFactor(t)
              : determinationFactor(t);
      }
      factorTables.set(`${level}|${job}|${stat}`, table);
    }
  }
}

function factorOf(level, job, stat, g) {
  if (!Number.isInteger(g) || g < 0 || g > G_MAX) throw new RangeError(`${stat} g=${g} 越界`);
  return factorTables.get(`${level}|${job}|${stat}`)[g];
}

function tierOf(level, job, stat, g) {
  return tier(level, job, stat, g);
}

function productAt(level, job, base, c, h, d) {
  const viaTable =
    BigInt(factorOf(level, job, "CRT", base.C + c)) *
    BigInt(factorOf(level, job, "DHT", base.H + h)) *
    BigInt(factorOf(level, job, "DET", base.D + d));
  const viaModel = factorsAt(level, job, {
    CRT: base.C + c,
    DHT: base.H + h,
    DET: base.D + d,
  }).product;
  assert(viaTable === viaModel, "因子表与 canonical-model.factorsAt 不一致");
  return viaTable;
}

// ---------------------------------------------------------------------------
// 1. 单纯形（满预算）与三顶点
// ---------------------------------------------------------------------------
function simplexOptimum(level, job, base, R) {
  let best = -1n;
  let bestPoint = null;
  for (let c = 0; c <= R; c += 1) {
    for (let h = 0; h + c <= R; h += 1) {
      const d = R - c - h;
      const value = productAt(level, job, base, c, h, d);
      if (value > best) {
        best = value;
        bestPoint = { c, h, d };
      }
    }
  }
  return { value: best, point: bestPoint };
}

function boundaryMaximum(level, job, base, R) {
  let best = -1n;
  let bestPoint = null;
  const consider = (c, h, d) => {
    const value = productAt(level, job, base, c, h, d);
    if (value > best) {
      best = value;
      bestPoint = { c, h, d };
    }
  };
  for (let h = 0; h <= R; h += 1) consider(0, h, R - h);
  for (let c = 0; c <= R; c += 1) consider(c, 0, R - c);
  for (let c = 0; c <= R; c += 1) consider(c, R - c, 0);
  return { value: best, point: bestPoint };
}

function vertices(level, job, base, R) {
  return [
    { name: "CRT", point: { c: R, h: 0, d: 0 }, value: productAt(level, job, base, R, 0, 0) },
    { name: "DHT", point: { c: 0, h: R, d: 0 }, value: productAt(level, job, base, 0, R, 0) },
    { name: "DET", point: { c: 0, h: 0, d: R }, value: productAt(level, job, base, 0, 0, R) },
  ];
}

function vertexMaximum(level, job, base, R) {
  return vertices(level, job, base, R).reduce(
    (best, vertex) => (vertex.value > best.value ? vertex : best),
  );
}

function describePoint(level, job, base, point) {
  const C = base.C + point.c;
  const H = base.H + point.h;
  const D = base.D + point.d;
  const tC = tierOf(level, job, "CRT", C);
  const tH = tierOf(level, job, "DHT", H);
  const tD = tierOf(level, job, "DET", D);
  return {
    contributions: { C, H, D },
    tiers: { CRT: tC, DHT: tH, DET: tD },
    factors: {
      critical: criticalFactor(tC, job),
      directHit: directHitFactor(tH),
      determination: determinationFactor(tD),
    },
    product: productAt(level, job, base, point.c, point.h, point.d),
  };
}

function basisPoints(numerator, denominator) {
  return Number((numerator * 1_000_000n) / denominator) / 100;
}

function ppm(numerator, denominator) {
  return Number((numerator * 1_000_000n) / denominator);
}

// ---------------------------------------------------------------------------
// 2. 定理 1 的两个精确反例（逐项算术全部由脚本重算）
// ---------------------------------------------------------------------------
const example1 = { level: 100, job: "WHM", base: { C: 200, H: 200, D: 200 }, R: 610 };
const example2 = { level: 50, job: "BLU", base: { C: 200, H: 200, D: 200 }, R: 1500 };

function analyzeExample(example, interiorPoint) {
  const { level, job, base, R } = example;
  const allVertices = vertices(level, job, base, R);
  const vertexBest = allVertices.reduce((a, b) => (a.value > b.value ? a : b));
  const interior = simplexOptimum(level, job, base, R);
  const boundary = boundaryMaximum(level, job, base, R);
  const interiorDetail = describePoint(level, job, base, interior.point);
  const vertexDetails = allVertices.map((vertex) => ({
    name: vertex.name,
    point: vertex.point,
    ...describePoint(level, job, base, vertex.point),
  }));
  const expectedPoint = interiorPoint;
  check(
    interior.point.c === expectedPoint.c &&
      interior.point.h === expectedPoint.h &&
      interior.point.d === expectedPoint.d,
    `定理 1 反例内部最优点变化：${JSON.stringify(interior.point)} vs ${JSON.stringify(expectedPoint)}`,
  );
  check(interior.value > vertexBest.value, "定理 1 反例：内部最优点必须严格大于顶点最大");
  check(interior.value > boundary.value, "定理 1 反例：内部最优点必须严格大于边界最大");
  check(
    interior.point.c > 0 && interior.point.h > 0 && interior.point.d > 0,
    "定理 1 反例：内部最优点三个坐标必须为正（同时否证 boundary-only）",
  );
  return {
    level,
    job,
    base,
    R,
    vertexBest,
    vertices: vertexDetails,
    interior,
    interiorDetail,
    boundary,
    gapAbsolute: interior.value - vertexBest.value,
    gapBasisPoints: basisPoints(interior.value - vertexBest.value, vertexBest.value),
    gapVsBoundary: interior.value - boundary.value,
    gapVsBoundaryBasisPoints: basisPoints(interior.value - boundary.value, boundary.value),
    gapVsBoundaryPpm: ppm(interior.value - boundary.value, boundary.value),
  };
}

const analysis1 = analyzeExample(example1, { c: 9, h: 245, d: 356 });
const analysis2 = analyzeExample(example2, { c: 1396, h: 1, d: 103 });

// 定理 1：每个支持等级都存在反例。
// 审计要求（README §13）：见证只用职业上限内的 (level, job) 组合；
// BLU 的 maxJobLevel = 80，因此 level 90/100 不能使用 BLU（公式可算但不代表真实职业等级）。
const PER_LEVEL_BASELINES = [
  { C: 200, H: 200, D: 200 },
  { C: 100, H: 100, D: 100 },
];
const PER_LEVEL_R = [50, 61, 100, 200, 300];
const perLevelCounterexamples = [];
for (const level of LEVELS) {
  let found = null;
  const realizableJobs = JOBS.filter((job) => maxJobLevel(job) >= level);
  perLevelSearch:
  for (const job of realizableJobs) {
    for (const base of PER_LEVEL_BASELINES) {
      for (const R of PER_LEVEL_R) {
        const vertexBest = vertexMaximum(level, job, base, R);
        const optimum = simplexOptimum(level, job, base, R);
        if (
          optimum.value > vertexBest.value &&
          optimum.point.c > 0 && optimum.point.h > 0 && optimum.point.d > 0
        ) {
          const boundary = boundaryMaximum(level, job, base, R);
          check(optimum.value > boundary.value, `定理 1 逐等级反例边界失败 ${level}/${job}`);
          check(level <= maxJobLevel(job), `定理 1 逐等级反例必须可实现 ${level}/${job}`);
          found = {
            level,
            job,
            base,
            R,
            vertexMax: vertexBest.value,
            vertexName: vertexBest.name,
            interior: optimum,
            boundary: boundary.value,
            gapBasisPoints: basisPoints(optimum.value - vertexBest.value, vertexBest.value),
          };
          break perLevelSearch;
        }
      }
    }
  }
  check(found !== null, `定理 1：等级 ${level} 未在扫描区间内找到顶点公式反例`);
  perLevelCounterexamples.push(found);
}

// ---------------------------------------------------------------------------
// 3. 端点最大证书与定理 2 的有限实例复核
// ---------------------------------------------------------------------------
const PAIRS = [
  { pair: "CRT-DHT", i: "CRT", j: "DHT", k: "DET" },
  { pair: "CRT-DET", i: "CRT", j: "DET", k: "DHT" },
  { pair: "DHT-DET", i: "DHT", j: "DET", k: "CRT" },
];

/**
 * 端点最大证书：对每对属性 (i,j) 与第三个坐标的每个取值 kappa ∈ [0,R]，
 * 在切片 {i+j = R-k, k 固定} 上，乘积最大值必须由两个端点取得。
 * 返回全部违反见证（若为空则证书成立）。
 */
function endpointMaxViolations(level, job, base, R) {
  const violations = [];
  for (const { pair, i, j, k } of PAIRS) {
    for (let kappa = 0; kappa <= R; kappa += 1) {
      const S = R - kappa;
      const baseI = base[i === "CRT" ? "C" : i === "DHT" ? "H" : "D"];
      const baseJ = base[j === "CRT" ? "C" : j === "DHT" ? "H" : "D"];
      const baseK = base[k === "CRT" ? "C" : k === "DHT" ? "H" : "D"];
      const third = BigInt(factorOf(level, job, k, baseK + kappa));
      let best = -1n;
      let bestX = -1;
      let left = 0n;
      let right = 0n;
      for (let x = 0; x <= S; x += 1) {
        const value =
          BigInt(factorOf(level, job, i, baseI + x)) *
          BigInt(factorOf(level, job, j, baseJ + S - x)) *
          third;
        if (x === 0) left = value;
        if (x === S) right = value;
        if (value > best) {
          best = value;
          bestX = x;
        }
      }
      const endpointsMax = left > right ? left : right;
      if (best > endpointsMax) {
        violations.push({
          pair,
          fixed: { stat: k, value: kappa },
          S,
          xStar: bestX,
          sliceMax: best,
          endpoints: { left, right },
          gapBasisPoints: basisPoints(best - endpointsMax, endpointsMax),
        });
      }
    }
  }
  return violations;
}

/** 部分证书上界：若属性对 (i,j) 的端点最大证书对全部第三坐标成立，则
 *  U ≤ max_kappa max(F_i(base_i + (R-kappa)) F_j(base_j) F_k(base_k+kappa),
 *                   F_i(base_i) F_j(base_j + (R-kappa)) F_k(base_k+kappa))。 */
function pairCertifiedUpperBound(level, job, base, R, pairSpec) {
  const { i, j, k } = pairSpec;
  const coordinate = (stat) => (stat === "CRT" ? "C" : stat === "DHT" ? "H" : "D");
  const baseI = base[coordinate(i)];
  const baseJ = base[coordinate(j)];
  const baseK = base[coordinate(k)];
  let best = -1n;
  for (let kappa = 0; kappa <= R; kappa += 1) {
    const S = R - kappa;
    const third = BigInt(factorOf(level, job, k, baseK + kappa));
    const left = BigInt(factorOf(level, job, i, baseI + S)) * BigInt(factorOf(level, job, j, baseJ)) * third;
    const right = BigInt(factorOf(level, job, i, baseI)) * BigInt(factorOf(level, job, j, baseJ + S)) * third;
    if (left > best) best = left;
    if (right > best) best = right;
  }
  return best;
}

// 3a. 证书成立 => 顶点最优（有限实例复核定理 2 的蕴含）
const certificatePassingExamples = [];
// 3b. 顶点最优但证书失败（说明充分条件不必要；找不到则记为未解决）
const necessityCounterexamples = [];
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const base of [
      { C: 0, H: 0, D: 0 },
      { C: 100, H: 50, D: 20 },
      { C: 200, H: 200, D: 200 },
      { C: 300, H: 0, D: 0 },
    ]) {
      for (let R = 1; R <= 40; R += 1) {
        const optimum = simplexOptimum(level, job, base, R);
        const vertexBest = vertexMaximum(level, job, base, R);
        const vertexOptimal = optimum.value === vertexBest.value;
        if (!vertexOptimal) continue;
        const violations = endpointMaxViolations(level, job, base, R);
        if (violations.length === 0) {
          if (certificatePassingExamples.length < 6) {
            certificatePassingExamples.push({ level, job, base, R, vertexBest: vertexBest.value, optimum });
          }
        } else if (necessityCounterexamples.length < 6) {
          necessityCounterexamples.push({
            level,
            job,
            base,
            R,
            vertexBest: vertexBest.value,
            vertexName: vertexBest.name,
            optimum,
            violation: violations.reduce((a, b) => (a.gapBasisPoints > b.gapBasisPoints ? a : b)),
            violationCount: violations.length,
          });
        }
      }
    }
  }
}
check(certificatePassingExamples.length > 0, "定理 2：未找到证书成立的实例");
for (const example of certificatePassingExamples) {
  check(
    example.optimum.value === example.vertexBest,
    `定理 2：证书成立实例必须顶点最优 ${example.level}/${example.job}`,
  );
}

// 3c. 证书在真实区间失败的直接见证（定理 3）
const theorem3Witnesses = [];
for (const example of [example1, example2]) {
  const violations = endpointMaxViolations(example.level, example.job, example.base, example.R);
  check(violations.length > 0, `定理 3：真实区间必须存在端点最大反例 ${example.level}/${example.job}`);
  const strongest = violations.reduce((a, b) =>
    a.gapBasisPoints > b.gapBasisPoints ? a : b,
  );
  theorem3Witnesses.push({ ...example, violationCount: violations.length, strongest });
}

// ---------------------------------------------------------------------------
// 4. 定理 4：无顶点假设的安全回退
// ---------------------------------------------------------------------------
function tierTable(level, job, stat, base, cap) {
  const top = tier(level, job, stat, base + cap);
  const table = [];
  for (let t = tier(level, job, stat, base); t <= top; t += 1) {
    const first = firstContributionWithTierAtLeast(level, job, stat, t);
    const theta = Math.max(0, first - base);
    const value =
      stat === "CRT" ? criticalFactor(t, job)
        : stat === "DHT" ? directHitFactor(t)
          : determinationFactor(t);
    table.push({ tier: t, theta, factor: BigInt(value) });
  }
  return table;
}

/** 定理 A 的档位三元组预算公式（本脚本内复算，用作安全回退的精确值）。 */
function tierTripleBudgetMax(level, job, base, R) {
  const tables = [
    tierTable(level, job, "CRT", base.C, R),
    tierTable(level, job, "DHT", base.H, R),
    tierTable(level, job, "DET", base.D, R),
  ];
  let best = -1n;
  for (const c of tables[0]) {
    for (const h of tables[1]) {
      const remaining = R - c.theta - h.theta;
      if (remaining < 0) continue;
      for (const d of tables[2]) {
        if (d.theta > remaining) continue;
        const value = c.factor * h.factor * d.factor;
        if (value > best) best = value;
      }
    }
  }
  return best;
}

const fallbackChecks = [];
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const base of [
      { C: 0, H: 0, D: 0 },
      { C: 100, H: 50, D: 20 },
      { C: 200, H: 200, D: 200 },
    ]) {
      for (const R of [13, 21, 34, 61]) {
        const optimum = simplexOptimum(level, job, base, R).value;
        check(
          tierTripleBudgetMax(level, job, base, R) === optimum,
          `定理 4：档位三元组预算公式必须等于 U ${level}/${job} R=${R}`,
        );
        // 每对属性：若该对证书对全部第三坐标成立，则 UB_pair >= U
        for (const pairSpec of PAIRS) {
          const violations = endpointMaxViolations(level, job, base, R).filter(
            (violation) => violation.pair === pairSpec.pair,
          );
          if (violations.length > 0) continue;
          const upper = pairCertifiedUpperBound(level, job, base, R, pairSpec);
          check(
            upper >= optimum,
            `定理 4：已认证属性对的上界必须 >= U ${level}/${job} ${pairSpec.pair}`,
          );
          fallbackChecks.push({ strict: upper > optimum });
        }
        // 三个属性对证书全部成立 => 顶点公式精确；U 必须等于顶点最大
        const allViolations = endpointMaxViolations(level, job, base, R);
        if (allViolations.length === 0) {
          check(
            vertexMaximum(level, job, base, R).value === optimum,
            `定理 4：三对证书成立时 U 必须等于顶点最大 ${level}/${job} R=${R}`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4b. 定理 4(2)：caps 绑定时“两个零 facet”不成立（caps 感知修正）
//     - 反例：L100 WHM、b=0、κ=(14,6,0)、R=20
//     - 正确归约：四类 facet {x_i=0, x_j=0, x_i=κ_i, x_j=κ_j}
//     - 无 cap 绑定（S* <= min(κ_i,κ_j)）时原二零 facet 等式仍成立
// ---------------------------------------------------------------------------
const STAT_INDEX = { CRT: 0, DHT: 1, DET: 2 };
const STAT_KEY = { CRT: "C", DHT: "H", DET: "D" };

/** A(b,R,κ) 上的穷举 U（含 caps；Σx<=R）。 */
function simplexOptimumCapped(level, job, base, kappa, R) {
  const cap = (i) => (Number.isFinite(kappa[i]) ? kappa[i] : R);
  let best = -1n;
  let bestPoint = null;
  for (let c = 0; c <= Math.min(cap(0), R); c += 1) {
    for (let h = 0; h <= Math.min(cap(1), R - c); h += 1) {
      for (let d = 0; d <= Math.min(cap(2), R - c - h); d += 1) {
        const value = productAt(level, job, base, c, h, d);
        if (value > best) {
          best = value;
          bestPoint = { c, h, d };
        }
      }
    }
  }
  return { value: best, point: bestPoint };
}

/** S* = min(R, Σκ)（κ_i=+∞ 视为不参与和）。 */
function fullBudget(level, job, kappa, R) {
  let sum = 0;
  let anyInfinite = false;
  for (const value of kappa) {
    if (!Number.isFinite(value)) anyInfinite = true;
    else sum += value;
  }
  return anyInfinite ? R : Math.min(R, sum);
}

/** H_{ab}(T) = max F_a(base_a+x)·F_b(base_b+T-x)，x∈[max(0,T-κ_b), min(κ_a,T)]；
 * 空区间 / T<0 返回 null（facet 不可行）。 */
function pairSliceMax(level, job, base, kappa, aStat, bStat, T) {
  if (!Number.isInteger(T) || T < 0) return null;
  const a = STAT_INDEX[aStat];
  const b = STAT_INDEX[bStat];
  const capA = Number.isFinite(kappa[a]) ? kappa[a] : T;
  const capB = Number.isFinite(kappa[b]) ? kappa[b] : T;
  const lower = Math.max(0, T - capB);
  const upper = Math.min(capA, T);
  if (lower > upper) return null;
  const baseA = base[STAT_KEY[aStat]];
  const baseB = base[STAT_KEY[bStat]];
  let best = -1n;
  for (let x = lower; x <= upper; x += 1) {
    const value =
      BigInt(factorOf(level, job, aStat, baseA + x)) *
      BigInt(factorOf(level, job, bStat, baseB + T - x));
    if (value > best) best = value;
  }
  return best;
}

/** 四 facet 精确公式（固定属性对 (i,j)，第三属性 k 自由）：
 *  U = max{ F_i(b_i)·H_{jk}(S*), F_j(b_j)·H_{ik}(S*),
 *           [S*>=κ_i] F_i(b_i+κ_i)·H_{jk}(S*-κ_i),
 *           [S*>=κ_j] F_j(b_j+κ_j)·H_{ik}(S*-κ_j) }。
 *  不可行 facet 记 null。 */
function fourFacetUpper(level, job, base, kappa, R, pair) {
  const [i, j, k] = pair;
  const Sstar = fullBudget(level, job, kappa, R);
  const fixedFactor = (stat, capValue) => BigInt(factorOf(level, job, stat, base[STAT_KEY[stat]] + capValue));
  const candidates = [];
  // x_i = 0 与 x_j = 0
  const hJK = pairSliceMax(level, job, base, kappa, j, k, Sstar);
  if (hJK !== null) candidates.push(fixedFactor(i, 0) * hJK);
  const hIK = pairSliceMax(level, job, base, kappa, i, k, Sstar);
  if (hIK !== null) candidates.push(fixedFactor(j, 0) * hIK);
  // x_i = κ_i 与 x_j = κ_j（仅当有限 cap 且 S* >= cap）
  if (Number.isFinite(kappa[STAT_INDEX[i]]) && Sstar >= kappa[STAT_INDEX[i]]) {
    const h = pairSliceMax(level, job, base, kappa, j, k, Sstar - kappa[STAT_INDEX[i]]);
    if (h !== null) candidates.push(fixedFactor(i, kappa[STAT_INDEX[i]]) * h);
  }
  if (Number.isFinite(kappa[STAT_INDEX[j]]) && Sstar >= kappa[STAT_INDEX[j]]) {
    const h = pairSliceMax(level, job, base, kappa, i, k, Sstar - kappa[STAT_INDEX[j]]);
    if (h !== null) candidates.push(fixedFactor(j, kappa[STAT_INDEX[j]]) * h);
  }
  return candidates.length === 0 ? null : candidates.reduce((a, b) => (a > b ? a : b));
}

/** 原二零 facet 公式：只保留 x_i=0 / x_j=0 两个 Δ facet（全预算）；都不可行返回 null。 */
function twoZeroFacetUpper(level, job, base, kappa, R, pair) {
  const [i, j, k] = pair;
  const Sstar = fullBudget(level, job, kappa, R);
  const fixedFactor = (stat, capValue) => BigInt(factorOf(level, job, stat, base[STAT_KEY[stat]] + capValue));
  const candidates = [];
  const hJK = pairSliceMax(level, job, base, kappa, j, k, Sstar);
  if (hJK !== null) candidates.push(fixedFactor(i, 0) * hJK);
  const hIK = pairSliceMax(level, job, base, kappa, i, k, Sstar);
  if (hIK !== null) candidates.push(fixedFactor(j, 0) * hIK);
  return candidates.length === 0 ? null : candidates.reduce((a, b) => (a > b ? a : b));
}

/** “把该坐标固定为 0、其余在 A 内最大化”的边界最大值（caps 感知表中的两个零边界值）。 */
function zeroBoundaryMax(level, job, base, kappa, R, stat) {
  const index = STAT_INDEX[stat];
  const cap = (i) => (Number.isFinite(kappa[i]) ? kappa[i] : R);
  let best = -1n;
  for (let c = 0; c <= Math.min(cap(0), R); c += 1) {
    if (index === 0 && c !== 0) continue;
    for (let h = 0; h <= Math.min(cap(1), R - c); h += 1) {
      if (index === 1 && h !== 0) continue;
      for (let d = 0; d <= Math.min(cap(2), R - c - h); d += 1) {
        if (index === 2 && d !== 0) continue;
        const value = productAt(level, job, base, c, h, d);
        if (value > best) best = value;
      }
    }
  }
  return best;
}

/** Cert_{ij}：对固定第三坐标 kκ ∈ [0,min(κ_k,S*)] 的每个切片，端点最大成立。 */
function pairEndpointCert(level, job, base, kappa, R, pair) {
  const [i, j, k] = pair;
  const Sstar = fullBudget(level, job, kappa, R);
  const capK = Number.isFinite(kappa[STAT_INDEX[k]]) ? kappa[STAT_INDEX[k]] : Sstar;
  const maxThird = Math.min(capK, Sstar);
  for (let kk = 0; kk <= maxThird; kk += 1) {
    const S = Sstar - kk;
    const capI = Number.isFinite(kappa[STAT_INDEX[i]]) ? kappa[STAT_INDEX[i]] : S;
    const capJ = Number.isFinite(kappa[STAT_INDEX[j]]) ? kappa[STAT_INDEX[j]] : S;
    const L = Math.max(0, S - capJ);
    const U = Math.min(capI, S);
    if (L > U) continue; // 空切片：证书空真
    const third = BigInt(factorOf(level, job, k, base[STAT_KEY[k]] + kk));
    const g = (x) =>
      BigInt(factorOf(level, job, i, base[STAT_KEY[i]] + x)) *
      BigInt(factorOf(level, job, j, base[STAT_KEY[j]] + S - x)) *
      third;
    const endpoint = g(L) > g(U) ? g(L) : g(U);
    for (let x = L; x <= U; x += 1) {
      if (g(x) > endpoint) return false;
    }
  }
  return true;
}

/**
 * 文档 §6.4 的端点扫描式（扫描式修正版）：
 *   K_feas = [max(0,S*−κ_i−κ_j), min(κ_k,S*)]
 *   U = max_{κ∈K_feas} max( G_{ij}(L(κ); S*−κ, κ), G_{ij}(U(κ); S*−κ, κ) )
 * 其中 G_{ij} 已含第三因子（§3），外层不再乘 F_k。
 * 选项：doubleFk=true 复现旧错误（外层再乘 F_k）；
 *       fullRange=true 复现旧扫描范围 [0,min(κ_k,S*)]；
 *       skipEmpty=false 复现“空切片仍取端点”。
 */
function documentedScan(level, job, base, kappa, R, pair, options = {}) {
  const { doubleFk = false, fullRange = false, skipEmpty = true } = options;
  const [i, j, k] = pair;
  const Sstar = fullBudget(level, job, kappa, R);
  const capI = kappa[STAT_INDEX[i]];
  const capJ = kappa[STAT_INDEX[j]];
  const capK = kappa[STAT_INDEX[k]];
  const lower = fullRange || !Number.isFinite(capI) || !Number.isFinite(capJ)
    ? 0
    : Math.max(0, Sstar - capI - capJ);
  const upper = Number.isFinite(capK) ? Math.min(capK, Sstar) : Sstar;
  let best = -1n;
  let slices = 0;
  let skipped = 0;
  for (let third = lower; third <= upper; third += 1) {
    const S = Sstar - third;
    const L = Number.isFinite(capJ) ? Math.max(0, S - capJ) : 0;
    const U = Number.isFinite(capI) ? Math.min(capI, S) : S;
    if (L > U) {
      skipped += 1;
      if (skipEmpty) continue;
    }
    const thirdValue = BigInt(factorOf(level, job, k, base[STAT_KEY[k]] + third));
    const g = (x) =>
      BigInt(factorOf(level, job, i, base[STAT_KEY[i]] + x)) *
      BigInt(factorOf(level, job, j, base[STAT_KEY[j]] + S - x)) *
      thirdValue;
    let sliceBest = g(L) > g(U) ? g(L) : g(U);
    if (doubleFk) sliceBest *= thirdValue;
    if (sliceBest > best) best = sliceBest;
    slices += 1;
  }
  return { value: best, slices, skipped, lower, upper };
}

const PAIR_CH = ["CRT", "DHT", "DET"]; // 反例用 (CRT,DHT) 属性对，第三坐标 DET
{
  // ---- caps 绑定反例：caps 绑定，两个零 facet 都严格低于 U ----
  const level = 100;
  const job = "WHM";
  const base = { C: 0, H: 0, D: 0 };
  const kappa = [14, 6, 0];
  const R = 20;
  const Sstar = fullBudget(level, job, kappa, R);
  check(Sstar === 20, "caps 绑定反例：满预算应为 20");

  const optimum = simplexOptimumCapped(level, job, base, kappa, R);
  check(optimum.value === 4_082_824_451_000n, "caps 绑定反例：穷举 U 应为 4,082,824,451,000");
  check(
    optimum.point.c === 14 && optimum.point.h === 6 && optimum.point.d === 0,
    "caps 绑定反例：最优点应为 (14,6,0)",
  );
  check(
    productAt(level, job, base, 14, 6, 0) === 4_082_824_451_000n &&
      productAt(level, job, base, 14, 0, 0) === 4_081_804_000_000n &&
      productAt(level, job, base, 0, 6, 0) === 4_081_020_000_000n,
    "caps 绑定反例：三个乘积数值与审查文档不一致",
  );

  // 两个零边界（A 内 x_i=0 / x_j=0 的最大值）都严格低于 U
  const zeroC = zeroBoundaryMax(level, job, base, kappa, R, "CRT");
  const zeroH = zeroBoundaryMax(level, job, base, kappa, R, "DHT");
  check(zeroC === 4_081_020_000_000n && zeroH === 4_081_804_000_000n,
    "caps 绑定反例：x_C=0 边界最大值=(0,6,0)、x_H=0 边界最大值=(14,0,0)");
  check(zeroC < optimum.value && zeroH < optimum.value,
    "caps 绑定反例：两个零边界都严格低于 U（原二 facet 宣称不成立）");

  // 原二零 facet 公式（全预算 Δ 上）在该实例两个 facet 都为空 ⇒ 公式不可行
  check(
    pairSliceMax(level, job, base, kappa, "DHT", "DET", Sstar) === null &&
      pairSliceMax(level, job, base, kappa, "CRT", "DET", Sstar) === null,
    "caps 绑定反例：两个零 facet 在满预算 Δ 上应为空",
  );
  check(twoZeroFacetUpper(level, job, base, kappa, R, PAIR_CH) === null,
    "caps 绑定反例：原二零 facet 公式应为不可行（−∞ < U）");

  // 四 facet 公式 = 穷举 U；且 (14,6,0) 位于 x_i=κ_i 与 x_j=κ_j 两个 cap facet 上
  check(pairEndpointCert(level, job, base, kappa, R, PAIR_CH),
    "caps 绑定反例：该属性对的端点最大证书应成立（切片被 caps 压成单点，空真）");
  const four = fourFacetUpper(level, job, base, kappa, R, PAIR_CH);
  check(four === optimum.value, "caps 绑定反例：四 facet 公式必须等于穷举 U");
  check(
    four === BigInt(factorOf(level, job, "CRT", 14)) *
      BigInt(factorOf(level, job, "DHT", 6)) *
      BigInt(factorOf(level, job, "DET", 0)),
    "caps 绑定反例：四 facet 最大值应由 cap facet 取到",
  );
  record(
    "T4-caps-binding-counterexample",
    `L100 WHM b=0 κ=(14,6,0) R=20：U=${optimum.value}（(14,6,0)）；零边界最大值 ` +
      `(0,6,0)=${zeroC}、(14,0,0)=${zeroH}（都严格更低 ⇒ 原二 facet 不成立）；` +
      `满预算零 facet 为空（原公式 −∞）；四 facet 公式=${four}=U`,
  );
}

// ---- 无 cap 绑定（S* <= min(κ_i,κ_j)）且 Cert_{ij} 成立时原二零 facet 等式仍成立 ----
{
  const level = 100;
  const job = "WHM";
  const base = { C: 0, H: 0, D: 0 };
  // 搜索一个 caps 存在但不绑定、且 Cert_{ij} 成立的实例（优先取较大的 R，避免只用 R=1 的退化例）
  let found = null;
  for (const kappa of [[100, 100, 100], [20, 20, 20], [14, 6, 0]]) {
    for (const R of [8, 6, 4, 2, 1]) {
      const Sstar = fullBudget(level, job, kappa, R);
      if (Sstar > Math.min(kappa[0], kappa[1])) continue;
      if (!pairEndpointCert(level, job, base, kappa, R, PAIR_CH)) continue;
      found = { kappa, R, Sstar };
      break;
    }
    if (found !== null) break;
  }
  check(found !== null, "无 cap 绑定且证书成立的实例应存在（至少 R=1 的切片长度 <=1）");
  const { kappa, R, Sstar } = found;
  const optimum = simplexOptimumCapped(level, job, base, kappa, R);
  const two = twoZeroFacetUpper(level, job, base, kappa, R, PAIR_CH);
  const four = fourFacetUpper(level, job, base, kappa, R, PAIR_CH);
  check(Sstar <= Math.min(kappa[0], kappa[1]), "无 cap 绑定实例应满足 S* <= min(κ_i,κ_j)");
  check(two !== null && two === optimum.value, "无 cap 绑定且证书成立时原二零 facet 公式必须等于 U");
  check(four === optimum.value, "无 cap 绑定时四 facet 公式也应等于 U");
  record(
    "T4-nonbinding-two-facet-valid",
    `L100 WHM b=0 κ=(${kappa.join(",")}) R=${R}：S*=${Sstar} <= min(κ_i,κ_j) 且 Cert_CH 成立 ⇒ ` +
      `原二零 facet 公式=${two}=U；四 facet 公式=${four}=U`,
  );
}

// ---- 小 caps × 小预算的随机/网格穷举：四 facet 恒等于 U；原二 facet 仅当 C1 成立才等 ----
{
  const levels = [100];
  const jobs = ["WHM"];
  const bases = [
    { C: 0, H: 0, D: 0 },
    { C: 10, H: 5, D: 20 },
  ];
  const capGrid = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [2, 1, 0],
    [14, 6, 0],
    [2, 2, 2],
    [0, 3, 1],
    [3, 0, 2],
    [1, 2, 3],
    [2, 2, 0],
  ];
  let gridChecks = 0;
  let certPassChecks = 0;
  let c1EqualityChecks = 0;
  let certFailPartial = 0;
  let c1FalseLower = 0;
  for (const level of levels) {
    for (const job of jobs) {
      for (const base of bases) {
        for (const caps of capGrid) {
          for (let R = 0; R <= 8; R += 1) {
            const kappa = [caps[0], caps[1], caps[2]];
            const optimum = simplexOptimumCapped(level, job, base, kappa, R);
            const four = fourFacetUpper(level, job, base, kappa, R, PAIR_CH);
            gridChecks += 1;
            const certified = pairEndpointCert(level, job, base, kappa, R, PAIR_CH);
            const two = twoZeroFacetUpper(level, job, base, kappa, R, PAIR_CH);
            const scan = documentedScan(level, job, base, kappa, R, PAIR_CH);
            if (certified) {
              // 定理 4(2) 的四 facet 归约以 Cert_{ij} 为前提
              check(
                four === optimum.value,
                `证书成立时四 facet 公式必须等于 U level=${level}/${job} b=${JSON.stringify(base)} κ=${caps} R=${R}`,
              );
              // 文档 §6.4 的扫描式（扫描式修正版）也必须等于 U
              check(
                scan.value === optimum.value,
                `证书成立时文档端点扫描必须等于 U level=${level}/${job} b=${JSON.stringify(base)} κ=${caps} R=${R}`,
              );
              certPassChecks += 1;
              const Sstar = fullBudget(level, job, kappa, R);
              if (Sstar <= Math.min(caps[0], caps[1])) {
                // 无 cap 绑定 + 证书成立 ⇒ 原二零 facet 等式
                check(two === optimum.value, `C1 成立时原二 facet 公式应等于 U ${JSON.stringify({ caps, R })}`);
                c1EqualityChecks += 1;
              } else if (two === null || two < optimum.value) {
                c1FalseLower += 1;
              }
            } else {
              // 证书不成立时四 facet 公式只是 Δ 子集的最大值 ⇒ 只保证 <= U（不能当 U 用）
              check(four === null || four <= optimum.value, "四 facet 公式不能超过 U（它只取 Δ 的子集）");
              check(scan.value <= optimum.value, "扫描只取可行端点，不能超过 U");
              if (four === null || four < optimum.value) certFailPartial += 1;
            }
          }
        }
      }
    }
  }
  check(certPassChecks > 0, "网格中应存在 Cert_{ij} 成立的实例");
  record(
    "T4-four-facet-grid",
    `${gridChecks} 个 (base,caps,R) 组合：证书成立 ${certPassChecks} 例，四 facet 公式全部 =U；` +
      `其中 C1（S*<=min(κ_i,κ_j)）成立 ${c1EqualityChecks} 例的原二零 facet 等式也成立；` +
      `C1 不成立且原二 facet 严格更低 ${c1FalseLower} 例；证书不成立时四 facet 只 <=U（${certFailPartial} 例严格更低，不能当上界用）`,
  );
}

// ---------------------------------------------------------------------------
// 4c（扫描式修正）：直接实现文档 §6.4 的端点扫描式并对照 U / 四 facet
// ---------------------------------------------------------------------------
{
  const level = 100;
  const job = "WHM";
  const base = { C: 0, H: 0, D: 0 };

  // (1) R=0：正确扫描式 = Phi(0)=4.08e12；旧式（外层再乘 F_k）给 4.08e15
  {
    const kappa = [14, 6, 19];
    const R = 0;
    const optimum = simplexOptimumCapped(level, job, base, kappa, R);
    check(optimum.value === 4_080_000_000_000n, "扫描 R=0：U 应为 4,080,000,000,000");
    const scan = documentedScan(level, job, base, kappa, R, PAIR_CH);
    check(scan.value === optimum.value, "扫描 R=0：修正后的文档扫描必须等于 U");
    const oldDouble = documentedScan(level, job, base, kappa, R, PAIR_CH, { doubleFk: true });
    check(oldDouble.value === 4_080_000_000_000_000n,
      "扫描 R=0：旧式（重复乘 F_k）应为 4,080,000,000,000,000");
    check(oldDouble.value > optimum.value, "扫描 R=0：旧式严格高估，不是精确等式");
    record(
      "T4-scan-double-Fk-counterexample",
      `L100 WHM b=0 R=0：U=${optimum.value}；文档修正扫描=${scan.value}=U；` +
        `旧式外层再乘 F_k=${oldDouble.value}（=U×1000，F2 反例）`,
    );
  }

  // (2) caps 绑定（R1 实例）：正确扫描 = U；旧式重复 F_k 仍严格高估
  {
    const kappa = [14, 6, 0];
    const R = 20;
    const optimum = simplexOptimumCapped(level, job, base, kappa, R);
    const scan = documentedScan(level, job, base, kappa, R, PAIR_CH);
    check(scan.value === optimum.value, "扫描 caps 绑定：修正扫描必须等于 U");
    const oldDouble = documentedScan(level, job, base, kappa, R, PAIR_CH, { doubleFk: true });
    check(oldDouble.value > optimum.value, "扫描 caps 绑定：旧式严格高估");
    record(
      "T4-scan-caps-binding",
      `κ=(14,6,0) R=20：修正扫描=${scan.value}=U=${optimum.value}；旧式=${oldDouble.value}>U`,
    );
  }

  // (3) Σκ=S* 恰满预算 + 空切片反例（F3）：κ=(14,6,19), R=39
  {
    const kappa = [14, 6, 19];
    const R = 39;
    const Sstar = fullBudget(level, job, kappa, R);
    check(Sstar === 39, "空切片反例：S* 应为 39");
    const optimum = simplexOptimumCapped(level, job, base, kappa, R);
    check(optimum.value === 4_082_824_451_000n, "空切片反例：U 应为 4,082,824,451,000");
    const scan = documentedScan(level, job, base, kappa, R, PAIR_CH);
    check(scan.value === optimum.value, "空切片反例：修正扫描（K_feas）必须等于 U");
    check(scan.lower === 19 && scan.upper === 19, "空切片反例：K_feas 应退化为 κ=19 单切片");
    const fullRangeSkip = documentedScan(level, job, base, kappa, R, PAIR_CH, {
      fullRange: true,
      skipEmpty: true,
    });
    check(fullRangeSkip.value === optimum.value && fullRangeSkip.skipped > 0,
      "空切片反例：全范围但跳过空切片也应等于 U");
    const naive = documentedScan(level, job, base, kappa, R, PAIR_CH, {
      fullRange: true,
      skipEmpty: false,
    });
    check(naive.value > optimum.value, "空切片反例：强行取空切片端点会超过 U");
    check(naive.value === 4_085_885_804_000n,
      `空切片反例：强行取端点应为 4,085,885,804,000，实际 ${naive.value}`);
    record(
      "T4-scan-empty-slice-counterexample",
      `κ=(14,6,19) R=39、S*=39：K_feas={19} 修正扫描=${scan.value}=U；` +
        `全范围跳过空切片=${fullRangeSkip.value}=U（跳过 ${fullRangeSkip.skipped} 个空切片）；` +
        `若不跳过、强行取端点=${naive.value}>U（F3 反例）`,
    );
  }

  // (4) 无 cap 绑定正例：扫描 = 四 facet = U
  {
    const kappa = [100, 100, 100];
    const R = 8;
    const optimum = simplexOptimumCapped(level, job, base, kappa, R);
    const scan = documentedScan(level, job, base, kappa, R, PAIR_CH);
    const four = fourFacetUpper(level, job, base, kappa, R, PAIR_CH);
    check(scan.value === optimum.value, "非绑定扫描：必须等于 U");
    check(four === optimum.value, "非绑定四 facet：必须等于 U");
    record(
      "T4-scan-nonbinding",
      `κ=(100,100,100) R=8：文档扫描=${scan.value}=四 facet=U=${optimum.value}`,
    );
  }
}

// ---------------------- E baseStat 影响审计（贡献坐标 vs 面板总值，README §13）
// 本文全部坐标都必须是「档位输入贡献」g = value - offset：
//   CRT/DHT offset = sub，DET offset = main（equipped-effects.ts:127-149）。
// 审计 1：生产 equippedAttributeTier 的 gearAndFoodValue 参数在当前数据下就是贡献 g。
// 审计 2：面板总值误当贡献会改变档位（两种坐标不可混用）。
// 审计 3：本文示例与逐等级反例只使用职业上限内的 (level, job)。
const canonical = await loadCanonicalEvaluator();
const AUDIT_CONTRIBUTIONS = [
  0, 1, 9, 14, 20, 50, 57, 89, 100, 200, 209, 375, 445, 556, 810, 900, 1000, 1186, 1396, 1500, 1596, 1700,
];
let baseStatAuditChecks = 0;
let panelConfusionStrict = 0;
for (const level of LEVELS) {
  const params = DOCUMENTED_LEVEL_PARAMS[level];
  for (const job of JOBS) {
    for (const stat of STATS) {
      const offset = stat === "DET" ? params.main : params.sub;
      for (const g of AUDIT_CONTRIBUTIONS) {
        const productionTier = canonical.equippedAttributeTier(job, level, stat, g);
        const modelTier = tier(level, job, stat, g);
        check(
          productionTier === modelTier,
          `E baseStat 归约失败 ${level}/${job}/${stat} g=${g}: 生产 ${productionTier} vs 模型 ${modelTier}`,
        );
        const panel = offset + g;
        const misusedTier = canonical.equippedAttributeTier(job, level, stat, panel);
        check(
          misusedTier > productionTier,
          `E 面板/贡献坐标混用未改变档位 ${level}/${job}/${stat} g=${g}`,
        );
        baseStatAuditChecks += 2;
        if (misusedTier > productionTier) panelConfusionStrict += 1;
      }
    }
  }
}
// 示例 A/B 的 baseline 是贡献：
// level 100 WHM b=(200,200,200) ↔ 面板 (620,620,640)；
// level 50 BLU b=(200,200,200) ↔ 面板 (541,541,402)。
check(
  DOCUMENTED_LEVEL_PARAMS[100].sub === 420 && DOCUMENTED_LEVEL_PARAMS[100].main === 440,
  "E level 100 偏移参数变化：README §13 的换算表需要同步更新",
);
check(
  DOCUMENTED_LEVEL_PARAMS[50].sub === 341 && DOCUMENTED_LEVEL_PARAMS[50].main === 202,
  "E level 50 偏移参数变化：README §13 的换算表需要同步更新",
);
for (const entry of perLevelCounterexamples) {
  check(
    entry.level <= maxJobLevel(entry.job),
    `E 逐等级反例使用了不可实现的 (level, job)：${entry.level}/${entry.job}`,
  );
}
baseStatAuditChecks += 2;

// ---------------------------------------------------------------------------
// 输出报告（含文档要引用的精确算术）
// ---------------------------------------------------------------------------
record(
  "T1-vertex-refuted",
  `两个完整反例（内部最优点严格优于三顶点且严格优于边界最大）+ ` +
    `${perLevelCounterexamples.length} 个支持等级各一个紧凑反例`,
);
record(
  "T2-sufficiency",
  `证书成立实例 ${certificatePassingExamples.length} 个，全部顶点最优；` +
    `「顶点最优但证书失败」实例 ${necessityCounterexamples.length} 个（充分条件不必要）`,
);
record(
  "T3-certificate-fails-in-practice",
  theorem3Witnesses
    .map((witness) => `${witness.level}/${witness.job}: ${witness.violationCount} 个失败切片`)
    .join("；") + `；最强见证相对差 ${theorem3Witnesses.reduce((m, w) => Math.max(m, w.strongest.gapBasisPoints), 0)} bp`,
);
record(
  "T4-safe-fallback",
  `档位三元组预算公式 = U 全部对照通过；已认证属性对的 UB_pair >= U ` +
    `${fallbackChecks.length} 例（其中严格 ${fallbackChecks.filter((entry) => entry.strict).length} 例）`,
);
record(
  "E-baseStat-audit",
  `${panelConfusionStrict} 个 (level,job,stat,g) 点 × 2 项检查（生产=模型、混用改变档位）+ 2 个偏移复核 = ` +
    `${baseStatAuditChecks} 个检查；逐等级反例的 (level, job) 均在职业上限内；` +
    "level 100 偏移 (420,420,440)、level 50 偏移 (341,341,202) 复核",
);
record("grid", `等级 ${LEVELS.length} × ${JOBS.length} 类 × 显式 baseline/R 网格`);

console.log("simplex-vertex-reduction verification: PASS");
for (const entry of report) console.log(`  [ok] ${entry.name}: ${entry.detail}`);
console.log(`  checks: ${checks}`);
console.log("");
console.log("== 定理 1 反例 A：level 100 WHM baseline (200,200,200) R=610 ==");
printExample(analysis1);
console.log("");
console.log("== 定理 1 反例 B：level 50 BLU baseline (200,200,200) R=1500 ==");
printExample(analysis2);
console.log("");
console.log("== 定理 1：每个支持等级的紧凑反例（贡献坐标；只用职业上限内的组合）==");
for (const entry of perLevelCounterexamples) {
  console.log(
    `  level=${entry.level} job=${entry.job} baseline=(${entry.base.C},${entry.base.H},${entry.base.D}) R=${entry.R} ` +
      `顶点最大(${entry.vertexName})=${entry.vertexMax} ` +
      `内部最优 (c,h,d)=(${entry.interior.point.c},${entry.interior.point.h},${entry.interior.point.d}) ` +
      `乘积=${entry.interior.value} 边界最大=${entry.boundary} 间隙=${entry.gapBasisPoints} bp`,
  );
}
console.log("");
console.log("== 定理 3：真实区间上的端点最大失败见证（最大相对差）==");
for (const witness of theorem3Witnesses) {
  const v = witness.strongest;
  console.log(
    `  level=${witness.level} job=${witness.job} baseline=(${witness.base.C},${witness.base.H},${witness.base.D}) ` +
      `R=${witness.R}：${v.pair} 切片（固定 ${v.fixed.stat}=${v.fixed.value}，S=${v.S}）` +
      ` x*=${v.xStar} 切片最大=${v.sliceMax} 端点=(${v.endpoints.left},${v.endpoints.right}) ` +
      `相对差=${v.gapBasisPoints} bp；总违反切片 ${witness.violationCount} 个`,
  );
}
console.log("");
console.log("== 定理 2：证书成立 => 顶点最优（有限实例）==");
for (const example of certificatePassingExamples) {
  console.log(
    `  level=${example.level} job=${example.job} baseline=(${example.base.C},${example.base.H},${example.base.D}) ` +
      `R=${example.R} 顶点最大=${example.vertexBest} = U=${example.optimum.value}`,
  );
}
console.log("");
console.log("== 定理 2：顶点最优但端点最大证书失败（充分条件不必要）==");
if (necessityCounterexamples.length === 0) {
  console.log("  扫描范围内未找到；必要性记为未解决（不主张必要性）。");
} else {
  for (const example of necessityCounterexamples) {
    const v = example.violation;
    console.log(
      `  level=${example.level} job=${example.job} baseline=(${example.base.C},${example.base.H},${example.base.D}) ` +
        `R=${example.R}：顶点最优值=${example.vertexBest}（${example.vertexName} 顶点）` +
        `，但 ${v.pair} 切片固定 ${v.fixed.stat}=${v.fixed.value} 时 x*=${v.xStar} 的值 ` +
        `${v.sliceMax} > 端点最大 (${v.endpoints.left},${v.endpoints.right})，违反 ${v.gapBasisPoints} bp`,
    );
  }
}
console.log("");
console.log("== 定理 4：部分认证属性对的安全上界检查 ==");
console.log(
  `  已认证属性对且 UB_pair >= U 的实例数：${fallbackChecks.length}` +
    `（其中 UB_pair > U 的严格实例 ${fallbackChecks.filter((entry) => entry.strict).length} 个）`,
);
console.log(`  scope: 有限网格精确证书；一般性证明见本目录 README.md 定理 1-4。`);

function printExample(analysis) {
  console.log(
    `  baseline=(${analysis.base.C},${analysis.base.H},${analysis.base.D}) R=${analysis.R}`,
  );
  for (const vertex of analysis.vertices) {
    console.log(
      `  ${vertex.name} 顶点 (c,h,d)=(${vertex.point.c},${vertex.point.h},${vertex.point.d}) ` +
        `贡献=(${vertex.contributions.C},${vertex.contributions.H},${vertex.contributions.D}) ` +
        `档位=(CRT ${vertex.tiers.CRT}, DHT ${vertex.tiers.DHT}, DET ${vertex.tiers.DET}) ` +
        `因子=${vertex.factors.critical}*${vertex.factors.directHit}*${vertex.factors.determination} ` +
        `乘积=${vertex.product}`,
    );
  }
  console.log(
    `  顶点最大=${analysis.vertexBest.value}（${analysis.vertexBest.name} 顶点）`,
  );
  const interior = analysis.interiorDetail;
  console.log(
    `  全局最优 (c,h,d)=(${analysis.interior.point.c},${analysis.interior.point.h},${analysis.interior.point.d}) ` +
      `贡献=(${interior.contributions.C},${interior.contributions.H},${interior.contributions.D}) ` +
      `档位=(CRT ${interior.tiers.CRT}, DHT ${interior.tiers.DHT}, DET ${interior.tiers.DET}) ` +
      `因子=${interior.factors.critical}*${interior.factors.directHit}*${interior.factors.determination} ` +
      `乘积=${interior.product}`,
  );
  console.log(
    `  边界最大=${analysis.boundary.value}（(c,h,d)=(${analysis.boundary.point.c},` +
      `${analysis.boundary.point.h},${analysis.boundary.point.d})）`,
  );
  console.log(
    `  内部最优 - 顶点最大 = ${analysis.gapAbsolute}（${analysis.gapBasisPoints} bp）；` +
      `内部最优 - 边界最大 = ${analysis.gapVsBoundary}（${analysis.gapVsBoundaryPpm} ppm）`,
  );
}
