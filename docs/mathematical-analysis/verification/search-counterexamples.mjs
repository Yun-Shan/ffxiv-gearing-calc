/**
 * search-counterexamples.mjs
 *
 * 目的：为 docs/mathematical-analysis/theorems/ 中的**否证性**结论生成可复核的精确反例。
 *
 * 本脚本只做有限、确定性的整数计算，不启动配装搜索、不枚举真实装备组合、不调用 MIP/求解器。
 *
 * 坐标约定：所有 baseline、预算 S/R、`x`、档位阈值都是**属性贡献**（装备+食物），不是面板总值；
 * 三属性面板 = 基础属性（CRT/DHT/TEN 为 sub，DET 为 main）+ 贡献（参考模型 §2.1/§2.2）。
 *
 * 覆盖范围（完整定义域，可复核）：
 *   1) 两属性定和切片的端点最大猜想：全部支持等级 × 三属性对 × 显式列出的
 *      (baseline, S) 网格，逐整数点精确比较。
 *   2) 三属性自由预算的「顶点最大」猜想：全部支持等级 × 显式列出的
 *      (baseline, R) 网格，在 c+h+d=R 的完整 simplex 上逐点精确枚举并与三顶点比较。
 *   3) raw 序列的对数凸/凹：显式反例。
 *
 * 证明作用：给出**反例证书**（具体输入与精确整数输出），用于否证全称命题。
 * 对「在所列网格中未发现反例」的结论，只说明该网格无证书，**不构成通用证明**。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/verification/search-counterexamples.mjs
 */
import {
  factorsAt,
  criticalFactor,
  directHitFactor,
  determinationFactor,
  tier,
} from "./canonical-model.mjs";

const LEVELS = [50, 60, 70, 80, 90, 100];
const JOBS = ["WHM", "BLU"]; // WHM: b_C=350；BLU: b_C=150 且 tier 偏移 +200；公式只区分这两类

function pairFactors(level, job, pair, leftValue, rightValue) {
  switch (pair) {
    case "CRT-DHT":
      return {
        left: criticalFactor(tier(level, job, "CRT", leftValue), job),
        right: directHitFactor(tier(level, job, "DHT", rightValue)),
        leftLabel: "CRT",
        rightLabel: "DHT",
        leftTier: tier(level, job, "CRT", leftValue),
        rightTier: tier(level, job, "DHT", rightValue),
      };
    case "CRT-DET":
      return {
        left: criticalFactor(tier(level, job, "CRT", leftValue), job),
        right: determinationFactor(tier(level, job, "DET", rightValue)),
        leftLabel: "CRT",
        rightLabel: "DET",
        leftTier: tier(level, job, "CRT", leftValue),
        rightTier: tier(level, job, "DET", rightValue),
      };
    case "DHT-DET":
      return {
        left: directHitFactor(tier(level, job, "DHT", leftValue)),
        right: determinationFactor(tier(level, job, "DET", rightValue)),
        leftLabel: "DHT",
        rightLabel: "DET",
        leftTier: tier(level, job, "DHT", leftValue),
        rightTier: tier(level, job, "DET", rightValue),
      };
    default:
      throw new RangeError(pair);
  }
}

function pairProduct(level, job, pair, leftValue, rightValue) {
  const f = pairFactors(level, job, pair, leftValue, rightValue);
  return { product: BigInt(f.left) * BigInt(f.right), factors: f };
}

// ------------------------------------------------- 1. 两属性定和切片的端点最大
const SLICE_BASELINES = [0, 100, 200, 300, 500, 800, 1200, 2000];
const SLICE_S = [50, 100, 200, 400, 610, 800, 1000, 1500, 2000];
const sliceViolations = new Map(); // pair -> best (most compact) violation

for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const pair of ["CRT-DHT", "CRT-DET", "DHT-DET"]) {
      const [leftStat, rightStat] = pair.split("-");
      for (const leftBase of SLICE_BASELINES) {
        for (const rightBase of SLICE_BASELINES) {
          for (const S of SLICE_S) {
            let bestX = -1;
            let bestProduct = -1n;
            const productAt = (x) => {
              const leftValue = leftStat === "DHT" || leftStat === "CRT"
                ? leftBase + x
                : leftBase + x;
              const rightValue = rightBase + (S - x);
              return pairProduct(level, job, pair, leftValue, rightValue);
            };
            for (let x = 0; x <= S; x += 1) {
              const { product } = productAt(x);
              if (product > bestProduct) {
                bestProduct = product;
                bestX = x;
              }
            }
            const leftEnd = productAt(0).product;
            const rightEnd = productAt(S).product;
            const endpointMax = leftEnd > rightEnd ? leftEnd : rightEnd;
            if (bestProduct > endpointMax) {
              const candidate = {
                level,
                job,
                pair,
                leftBase,
                rightBase,
                S,
                bestX,
                bestProduct,
                leftEnd,
                rightEnd,
                endpointMax,
              };
              const previous = sliceViolations.get(`${pair}|${level}`) ?? null;
              const compactness = S + leftBase + rightBase;
              const previousCompactness = previous === null
                ? Number.POSITIVE_INFINITY
                : previous.S + previous.leftBase + previous.rightBase;
              if (compactness < previousCompactness) {
                sliceViolations.set(`${pair}|${level}`, candidate);
              }
            }
          }
        }
      }
    }
  }
}

console.log("== 1. 两属性定和切片：端点最大猜想的反例 ==");
for (const pair of ["CRT-DHT", "CRT-DET", "DHT-DET"]) {
  const perLevel = LEVELS.map((level) => sliceViolations.get(`${pair}|${level}`) ?? null);
  const found = perLevel.filter((entry) => entry !== null);
  if (found.length === 0) {
    console.log(`  ${pair}: 在扫描网格（${SLICE_BASELINES.length}^2 baselines × ${SLICE_S.length} S × 全部等级/职业）内未发现反例 — 该网格未否证端点最大，但这不是证明`);
    continue;
  }
  const compactest = found.reduce((best, entry) =>
    entry.S + entry.leftBase + entry.rightBase < best.S + best.leftBase + best.rightBase ? entry : best);
  console.log(
    `  ${pair}: 反例等级 ${found.map((e) => e.level).join("/")}` +
      `；最小反例 level=${compactest.level} job=${compactest.job} ` +
      `leftBase=${compactest.leftBase} rightBase=${compactest.rightBase} S=${compactest.S} ` +
      `x*=${compactest.bestX} product=${compactest.bestProduct} ` +
      `endpoints=(${compactest.leftEnd},${compactest.rightEnd})`,
  );
  // 打印一个等级 70 的完整明细，便于手工复核
  const sample = found.find((entry) => entry.level === 70) ?? compactest;
  const f = pairProduct(sample.level, sample.job, sample.pair,
    (sample.pair.startsWith("CRT") ? sample.leftBase : sample.leftBase) + sample.bestX,
    sample.rightBase + (sample.S - sample.bestX)).factors;
  console.log(
    `     明细 level=${sample.level} ${sample.pair}: x*=${sample.bestX} ` +
      `${f.leftLabel}Tier=${f.leftTier} ${f.rightLabel}Tier=${f.rightTier} ` +
      `factor=${f.left}*${f.right}=${sample.bestProduct}`,
  );
}

// ------------------------------------- 2. 三属性自由预算：顶点最大猜想的反例
const SIMPLEX_BASELINES = [
  { C0: 0, H0: 0, D0: 0 },
  { C0: 200, H0: 200, D0: 200 },
  { C0: 800, H0: 800, D0: 800 },
];
const SIMPLEX_R = [50, 100, 200, 400, 610, 800, 1200];
const vertexFailures = [];

for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const { C0, H0, D0 } of SIMPLEX_BASELINES) {
      for (const R of SIMPLEX_R) {
        const productOf = (c, h, d) => {
          const f = factorsAt(level, job, { CRT: C0 + c, DHT: H0 + h, DET: D0 + d });
          return f;
        };
        const vertices = [
          productOf(R, 0, 0),
          productOf(0, R, 0),
          productOf(0, 0, R),
        ].map((entry) => entry.product);
        const vertexMax = vertices.reduce((a, b) => (a > b ? a : b));
        let best = -1n;
        let bestPoint = null;
        let bestFactors = null;
        for (let c = 0; c <= R; c += 1) {
          for (let h = 0; h + c <= R; h += 1) {
            const d = R - c - h;
            const factors = productOf(c, h, d);
            if (factors.product > best) {
              best = factors.product;
              bestPoint = { c, h, d };
              bestFactors = factors;
            }
          }
        }
        if (best > vertexMax && bestPoint !== null &&
          (bestPoint.c > 0 && bestPoint.h > 0 && bestPoint.d > 0)) {
          vertexFailures.push({
            level,
            job,
            C0,
            H0,
            D0,
            R,
            vertexMax,
            best,
            bestPoint,
            bestFactors,
            compactness: R,
          });
        }
      }
    }
  }
}

console.log("");
console.log("== 2. 三属性自由预算 U：顶点公式的反例 ==");
if (vertexFailures.length === 0) {
  console.log("  扫描网格内未发现反例");
} else {
  const compactest = vertexFailures.reduce((best, entry) =>
    entry.compactness < best.compactness ? entry : best);
  console.log(
    `  反例总数 ${vertexFailures.length}；最小 R 反例：level=${compactest.level} job=${compactest.job} ` +
      `baseline=(${compactest.C0},${compactest.H0},${compactest.D0}) R=${compactest.R}`,
  );
  console.log(
    `   顶点最大 ${compactest.vertexMax}；内部点 (c,h,d)=(${compactest.bestPoint.c},` +
      `${compactest.bestPoint.h},${compactest.bestPoint.d}) 乘积 ${compactest.best}`,
  );
  console.log(
    `   该点档位 CRT=${compactest.bestFactors.crtTier} DHT=${compactest.bestFactors.dhtTier} ` +
      `DET=${compactest.bestFactors.detTier}，因子 ` +
      `${compactest.bestFactors.critical}*${compactest.bestFactors.directHit}*${compactest.bestFactors.determination}`,
  );
  // 打印一个 level 100 的例子，便于文档引用
  const level100 = vertexFailures.find((entry) => entry.level === 100);
  if (level100 !== undefined) {
    console.log(
      `   level 100 例：baseline=(${level100.C0},${level100.H0},${level100.D0}) R=${level100.R} ` +
        `顶点最大=${level100.vertexMax} 内部最优 (c,h,d)=(${level100.bestPoint.c},${level100.bestPoint.h},` +
        `${level100.bestPoint.d}) 乘积=${level100.best} ` +
        `档位=(${level100.bestFactors.crtTier},${level100.bestFactors.dhtTier},${level100.bestFactors.detTier})`,
    );
  }
}

// -------------------------------- 1b. 实际尺度区间上的端点最大反例统计
// 说明：定理需要知道「端点最大在什么范围内会失败」。这里只统计，不构成证明。
function factorOf(level, job, stat, contribution) {
  if (stat === "CRT") return criticalFactor(tier(level, job, "CRT", contribution), job);
  if (stat === "DHT") return directHitFactor(tier(level, job, "DHT", contribution));
  return determinationFactor(tier(level, job, "DET", contribution));
}

const REALISTIC_BASES = [0, 100, 300, 500, 800, 1000, 1500, 2000];
const REALISTIC_S = [50, 100, 200, 400, 610, 800, 1000, 1500, 2000];
const realisticTally = {};
const realisticWorst = {};
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const [leftStat, rightStat] of [["CRT", "DHT"], ["CRT", "DET"], ["DHT", "DET"]]) {
      let violations = 0;
      let worst = null;
      for (const leftBase of REALISTIC_BASES) {
        for (const rightBase of REALISTIC_BASES) {
          for (const S of REALISTIC_S) {
            let bestProduct = -1n;
            let bestX = -1;
            let leftProduct = 0n;
            let rightProduct = 0n;
            for (let x = 0; x <= S; x += 1) {
              const product = BigInt(factorOf(level, job, leftStat, leftBase + x)) *
                BigInt(factorOf(level, job, rightStat, rightBase + S - x));
              if (x === 0) leftProduct = product;
              if (x === S) rightProduct = product;
              if (product > bestProduct) {
                bestProduct = product;
                bestX = x;
              }
            }
            const endpointMax = leftProduct > rightProduct ? leftProduct : rightProduct;
            if (bestProduct > endpointMax) {
              violations += 1;
              const basisPoints = Number(((bestProduct - endpointMax) * 10_000n) / endpointMax);
              if (worst === null || basisPoints > worst.basisPoints) {
                worst = {
                  level, job, leftBase, rightBase, S, bestX,
                  bestProduct, endpointMax, basisPoints,
                  leftTier: leftStat === "CRT"
                    ? tier(level, job, "CRT", leftBase + bestX)
                    : tier(level, job, "DHT", leftBase + bestX),
                  rightTier: rightStat === "DHT"
                    ? tier(level, job, "DHT", rightBase + S - bestX)
                    : tier(level, job, "DET", rightBase + S - bestX),
                };
              }
            }
          }
        }
      }
      realisticTally[`${leftStat}-${rightStat}|L${level}|${job}`] = violations;
      if (worst !== null) realisticWorst[`${leftStat}-${rightStat}|L${level}|${job}`] = worst;
    }
  }
}
console.log("");
console.log("== 1b. 实际尺度网格上的端点最大反例统计（仅为有限网格证书，不是证明）==");
for (const [key, worst] of Object.entries(realisticWorst)) {
  console.log(
    `  ${key}: 反例 ${realisticTally[key]} 个；最大相对差 ${worst.basisPoints} bp ` +
      `(leftBase=${worst.leftBase} rightBase=${worst.rightBase} S=${worst.S} x*=${worst.bestX} ` +
      `interior=${worst.bestProduct} endpointsMax=${worst.endpointMax})`,
  );
}
const pairsWithoutAnyRealisticViolation = Object.keys(realisticTally)
  .filter((key) => realisticTally[key] === 0);
console.log(`  在网格内没有反例的 (pair,level,job) 组合：${pairsWithoutAnyRealisticViolation.length === 0 ? "无" : pairsWithoutAnyRealisticViolation.join("; ")}`);

// ------------------------------ 2b. 三属性自由预算：较大 R 的顶点公式反例
console.log("");
console.log("== 2b. 三属性自由预算 U：较大预算 R 的顶点公式反例 ==");
const largeRFindings = [];
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const { C0, H0, D0 } of SIMPLEX_BASELINES) {
      for (const R of [300, 610, 1000, 1500]) {
        const vertices = [
          { c: R, h: 0, d: 0 },
          { c: 0, h: R, d: 0 },
          { c: 0, h: 0, d: R },
        ].map(({ c, h, d }) => factorsAt(level, job, { CRT: C0 + c, DHT: H0 + h, DET: D0 + d }).product);
        const vertexMax = vertices.reduce((a, b) => (a > b ? a : b));
        let best = -1n;
        let point = null;
        for (let c = 0; c <= R; c += 1) {
          for (let h = 0; c + h <= R; h += 1) {
            const d = R - c - h;
            const { product } = factorsAt(level, job, { CRT: C0 + c, DHT: H0 + h, DET: D0 + d });
            if (product > best) {
              best = product;
              point = { c, h, d };
            }
          }
        }
        if (best > vertexMax && point !== null && point.c > 0 && point.h > 0 && point.d > 0) {
          largeRFindings.push({
            level, job, C0, H0, D0, R, vertexMax, best, point,
            basisPoints: Number(((best - vertexMax) * 10_000n) / vertexMax),
          });
        }
      }
    }
  }
}
if (largeRFindings.length === 0) {
  console.log("  R∈{300,610,1000,1500} 的网格内未发现反例 — 该网格未否证顶点公式，但不是证明");
} else {
  const strongest = largeRFindings.reduce((best, entry) =>
    entry.basisPoints > best.basisPoints ? entry : best);
  console.log(
    `  反例 ${largeRFindings.length} 个；最大相对差 ${strongest.basisPoints} bp：` +
      `level=${strongest.level} job=${strongest.job} baseline=(${strongest.C0},${strongest.H0},${strongest.D0}) ` +
      `R=${strongest.R} 顶点最大=${strongest.vertexMax} 内部最优=${JSON.stringify(strongest.point)} 乘积=${strongest.best}`,
  );
  const atLimit = largeRFindings.find((entry) => entry.level === 100);
  if (atLimit !== undefined) {
    console.log(
      `  level 100 例：baseline=(${atLimit.C0},${atLimit.H0},${atLimit.D0}) R=${atLimit.R} ` +
        `顶点=${atLimit.vertexMax} 内部=${JSON.stringify(atLimit.point)}=${atLimit.best}`,
    );
  }
}

// ------------------------------------- 3. raw 序列的对数凸/凹：显式反例
console.log("");
console.log("== 3. raw 序列（floor 后）不保持 tier 序列的对数凸/凹 ==");
function rawLogConvexSign(level, job, stat, g) {
  const f0 = stat === "CRT"
    ? criticalFactor(tier(level, job, "CRT", g), job)
    : stat === "DHT"
      ? directHitFactor(tier(level, job, "DHT", g))
      : determinationFactor(tier(level, job, "DET", g));
  const f1 = stat === "CRT"
    ? criticalFactor(tier(level, job, "CRT", g + 1), job)
    : stat === "DHT"
      ? directHitFactor(tier(level, job, "DHT", g + 1))
      : determinationFactor(tier(level, job, "DET", g + 1));
  const f2 = stat === "CRT"
    ? criticalFactor(tier(level, job, "CRT", g + 2), job)
    : stat === "DHT"
      ? directHitFactor(tier(level, job, "DHT", g + 2))
      : determinationFactor(tier(level, job, "DET", g + 2));
  const left = BigInt(f2) * BigInt(f0);
  const right = BigInt(f1) * BigInt(f1);
  return left > right ? 1 : left < right ? -1 : 0;
}
for (const [level, stat] of [[70, "DHT"], [70, "CRT"], [70, "DET"]]) {
  const signs = [];
  for (let g = 0; g <= 60 && signs.length < 6; g += 1) {
    signs.push({ g, sign: rawLogConvexSign(level, "WHM", stat, g) });
  }
  console.log(`  level ${level} ${stat}: 前若干 g 的符号(F(g+2)F(g)-F(g+1)^2) = ${JSON.stringify(signs)}`);
}
