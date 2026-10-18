/**
 * free-budget-upper-bound/verify.mjs
 *
 * 目的：为本目录 README.md 的定理 A 提供**有限域证书**：
 *   T1  良定义 / 单调 / 阶跃（有限前缀跳变）
 *   T2  满预算最优（无 cap 与带 cap 两种情形，含 sum = min(R, Σκ)）
 *   T3  精确档位三元组预算公式（与穷举逐点对照）
 *   A   与生产 `prepareSubstatFactorBudgetQuery` 的对应（直接 import 生产实现）
 *   B   顶点公式只是下界（U ≥ 顶点最大值；严格不等的实例见 simplex-vertex-reduction）
 *   C   预算可被浪费（平台区间）；跳变点必为档位成本三元组之和
 *   D  整数域 / 饱和 / 负预算未定义 / 因子正性 / 有效档位区间
 *   E  baseStat 影响审计：生产 evaluator 交叉验证「贡献坐标 = gearAndFoodValue」，
 *      并给出「面板总值被误当贡献」的坐标混用反例（README §13）
 *
 * 覆盖范围：所有支持等级 {50,60,70,80,90,100} × 公式可区分的两类 {WHM(普通), BLU}
 *           × 显式列出的 baseline / R / caps 网格，逐点精确整数计算（BigInt 乘积）。
 *
 * 证明作用：这是**有限网格证书**，用于排除实现/公式层面的错误并给出反例；
 * 一般性证明在 README.md 的定理陈述与证明中。网格外结论不由此脚本证明。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/free-budget-upper-bound/verify.mjs
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
  tier,
} from "../../verification/canonical-model.mjs";
import { prepareSubstatFactorBudgetQuery } from "../../../../src/domain/search/substat-factor-budget.ts";

const LEVELS = [50, 60, 70, 80, 90, 100];
const JOBS = ["WHM", "BLU"]; // 公式只通过 BLU 标记区分；WHM 代表全部普通职业
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

// ---------------------------------------------------------------------------
// 0. 因子表（把生产档位模型固定成查表，避免反复做 BigInt floorDiv）
// ---------------------------------------------------------------------------
const G_MAX = 4200; // 覆盖本脚本所有 baseline + R + cap 组合
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

function factorAt(level, job, stat, g) {
  if (!Number.isInteger(g) || g < 0 || g > G_MAX) throw new RangeError(`${stat} g=${g} 越界`);
  return factorTables.get(`${level}|${job}|${stat}`)[g];
}

function productAt(level, job, base, c, h, d) {
  // 直接复用 canonical-model 的 factorsAt（生产模型），交叉检查产品一致性。
  const viaTable =
    BigInt(factorAt(level, job, "CRT", base.C + c)) *
    BigInt(factorAt(level, job, "DHT", base.H + h)) *
    BigInt(factorAt(level, job, "DET", base.D + d));
  const viaModel = factorsAt(level, job, {
    CRT: base.C + c,
    DHT: base.H + h,
    DET: base.D + d,
  }).product;
  assert(viaTable === viaModel, "因子表与 canonical-model.factorsAt 不一致");
  return viaTable;
}

// ---------------------------------------------------------------------------
// 1. 穷举：U(b,R,κ) 的严格定义（c+h+d <= R，逐坐标 cap）
// ---------------------------------------------------------------------------
function uBrute(level, job, base, R, caps) {
  const [kC, kH, kD] = caps;
  let best = -1n;
  let bestPoint = null;
  for (let c = 0; c <= Math.min(R, kC); c += 1) {
    for (let h = 0; h <= Math.min(R - c, kH); h += 1) {
      for (let d = 0; d <= Math.min(R - c - h, kD); d += 1) {
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

/** 只允许 c+h+d = total 的穷举（用于 T2 对照）。 */
function uBruteWithSum(level, job, base, total, caps) {
  const [kC, kH, kD] = caps;
  let best = -1n;
  let bestPoint = null;
  for (let c = Math.max(0, total - kH - kD); c <= Math.min(total, kC); c += 1) {
    for (let h = Math.max(0, total - c - kD); h <= Math.min(total - c, kH); h += 1) {
      const d = total - c - h;
      if (d < 0) continue;
      const value = productAt(level, job, base, c, h, d);
      if (value > best) {
        best = value;
        bestPoint = { c, h, d };
      }
    }
  }
  return { value: best, point: bestPoint };
}

// ---------------------------------------------------------------------------
// 2. 档位三元组表：theta_i(t) = max(0, g_i(t) - base_i)，value = F_i(t)
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
    table.push({ tier: t, theta, value, factor: BigInt(value) });
  }
  // theta 非减、因子严格增；重复 theta 的档位被后一个档位支配（费用相同、值更大）。
  for (let i = 1; i < table.length; i += 1) {
    assert(table[i].theta >= table[i - 1].theta, "档位阈值的成本 theta 必须非减");
    assert(table[i].value > table[i - 1].value, "因子必须严格增");
  }
  return table;
}

function uTierTriple(level, job, base, R, caps) {
  const effectiveCap = (cap) => Math.min(cap, R); // cap=∞ 时退化为 R
  const tables = [
    tierTable(level, job, "CRT", base.C, effectiveCap(caps[0])),
    tierTable(level, job, "DHT", base.H, effectiveCap(caps[1])),
    tierTable(level, job, "DET", base.D, effectiveCap(caps[2])),
  ];
  let best = -1n;
  let bestTriple = null;
  for (const c of tables[0]) {
    for (const h of tables[1]) {
      const remaining = R - c.theta - h.theta;
      if (remaining < 0) continue;
      for (const d of tables[2]) {
        if (d.theta > remaining) continue;
        const value = c.factor * h.factor * d.factor;
        if (value > best) {
          best = value;
          bestTriple = { tC: c.tier, tH: h.tier, tD: d.tier, thetaC: c.theta, thetaH: h.theta, thetaD: d.theta };
        }
      }
    }
  }
  return { value: best, triple: bestTriple, tables };
}

// ---------------------------------------------------------------------------
// 3. 网格定义
// ---------------------------------------------------------------------------
const BASELINES = [
  { C: 0, H: 0, D: 0 },
  { C: 200, H: 200, D: 200 },
  { C: 50, H: 123, D: 7 },
];
const R_VALUES = [0, 1, 2, 3, 5, 8, 13, 21, 34];
const CAP_SETS = [
  [INF, INF, INF],
  [20, INF, 5],
  [3, 3, 3],
  [0, INF, INF],
  [INF, 10, INF],
];

// ---------------------------------------------------------------- T1 单调性
let monotoneChecks = 0;
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const base of BASELINES) {
      for (const caps of CAP_SETS) {
        let previous = -1n;
        for (const R of [0, 1, 2, 3, 5, 8, 13, 21, 34, 55]) {
          const { value } = uBrute(level, job, base, R, caps);
          check(value >= previous, `T1 单调性失败 ${level}/${job} R=${R}`);
          previous = value;
          monotoneChecks += 1;
        }
        // baseline 坐标单调：提高任一坐标不能使 U 下降
        const baseValue = uBrute(level, job, base, 13, caps).value;
        for (const [key, delta] of [["C", 7], ["H", 11], ["D", 5]]) {
          const lifted = { ...base, [key]: base[key] + delta };
          check(
            uBrute(level, job, lifted, 13, caps).value >= baseValue,
            `T1 baseline 单调性失败 ${level}/${job} ${key}`,
          );
          monotoneChecks += 1;
        }
      }
    }
  }
}
// U(0,κ) = baseline 处的因子乘积（任意 cap 都可行因为 c=h=d=0）
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const base of BASELINES) {
      for (const caps of CAP_SETS) {
        check(
          uBrute(level, job, base, 0, caps).value === productAt(level, job, base, 0, 0, 0),
          `T1 U(0) 不等于 baseline 乘积 ${level}/${job}`,
        );
        monotoneChecks += 1;
      }
    }
  }
}

// 阶跃：对固定 (level,job,base,caps)，U(R) 非减整数序列，跳变点有限；
// 并且 U(R) > U(R-1) 时必存在档位三元组使 theta 和恰为 R。
let stepChecks = 0;
for (const level of [50, 70, 100]) {
  for (const job of JOBS) {
    for (const base of [{ C: 0, H: 0, D: 0 }, { C: 100, H: 50, D: 20 }]) {
      const caps = [INF, INF, INF];
      const series = [];
      for (let R = 0; R <= 40; R += 1) series.push(uBrute(level, job, base, R, caps).value);
      // 跳变点集合
      const achievableSums = new Set();
      const tables = [
        tierTable(level, job, "CRT", base.C, 40),
        tierTable(level, job, "DHT", base.H, 40),
        tierTable(level, job, "DET", base.D, 40),
      ];
      for (const c of tables[0]) {
        for (const h of tables[1]) {
          for (const d of tables[2]) achievableSums.add(c.theta + h.theta + d.theta);
        }
      }
      for (let R = 1; R <= 40; R += 1) {
        if (series[R] > series[R - 1]) {
          check(achievableSums.has(R), `T1 跳变点 ${R} 不是档位成本三元组之和 ${level}/${job}`);
          stepChecks += 1;
        }
      }
    }
  }
}

// ------------------------------------------------------- T2 满预算最优（无 cap）
let fullBudgetChecks = 0;
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const base of BASELINES) {
      for (const R of R_VALUES) {
        const caps = [INF, INF, INF];
        const relaxed = uBrute(level, job, base, R, caps).value;
        const full = uBruteWithSum(level, job, base, R, caps).value;
        check(relaxed === full, `T2 无 cap 满预算失败 ${level}/${job} R=${R}`);
        fullBudgetChecks += 1;
      }
    }
  }
}

// ------------------------------------------------------ T2 满预算最优（有 cap）
let cappedChecks = 0;
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const base of BASELINES) {
      for (const caps of CAP_SETS) {
        const finiteSum = caps.reduce((sum, cap) => (cap === INF ? INF : sum + cap), 0);
        for (const R of [0, 1, 2, 3, 5, 8, 13, 21, 34]) {
          const relaxed = uBrute(level, job, base, R, caps).value;
          const target = Math.min(R, finiteSum);
          const limited = uBruteWithSum(level, job, base, target, caps).value;
          check(relaxed === limited, `T2 有 cap 满预算失败 ${level}/${job} R=${R} caps=${caps}`);
          cappedChecks += 1;
        }
      }
    }
  }
}
// R >= Σκ 时 caps 顶点 (κC,κH,κD) 同时是逐坐标最大点，必为最优
let saturationChecks = 0;
for (const level of LEVELS) {
  for (const job of JOBS) {
    const base = { C: 0, H: 0, D: 0 };
    const caps = [100, 60, 30];
    const capPoint = productAt(level, job, base, caps[0], caps[1], caps[2]);
    for (const R of [190, 191, 500]) {
      check(
        uBrute(level, job, base, R, caps).value === capPoint,
        `T2 饱和点失败 ${level}/${job} R=${R}`,
      );
      saturationChecks += 1;
    }
  }
}

// --------------------------------------------- T3 精确档位三元组预算公式（核心）
let tierTripleChecks = 0;
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const base of BASELINES) {
      for (const caps of CAP_SETS) {
        for (const R of R_VALUES) {
          const brute = uBrute(level, job, base, R, caps);
          const formula = uTierTriple(level, job, base, R, caps);
          check(
            brute.value === formula.value,
            `T3 档位三元组公式失败 ${level}/${job} base=${JSON.stringify(base)} ` +
              `R=${R} caps=${JSON.stringify(caps)}：穷举 ${brute.value} vs 公式 ${formula.value}`,
          );
          tierTripleChecks += 1;
        }
      }
    }
  }
}
// 只保留实际达到的档位（DET 取 detTrunc 的倍数）不改变公式最大值
for (const [level, job] of [[50, "WHM"], [60, "BLU"], [70, "WHM"], [100, "BLU"]]) {
  const base = { C: 200, H: 200, D: 200 };
  const R = 40;
  const all = uTierTriple(level, job, base, R, [INF, INF, INF]);
  // 非倍数 DET 档位与下一个倍数档位同费用但因子更小，因此不改变最大值；
  // 这里只验证同费用档位的支配关系与倍数档位非空。
  for (let i = 1; i < all.tables[2].length; i += 1) {
    const previous = all.tables[2][i - 1];
    const current = all.tables[2][i];
    if (current.theta === previous.theta) {
      check(current.factor >= previous.factor, `T3 DET 同费用档位支配失败 ${level}/${job}`);
    }
  }
  const detMultiple = all.tables[2].filter((entry) => entry.tier % 5 === 0 || entry.tier % 2 === 0);
  check(detMultiple.length > 0, "T3 DET 倍数档位为空");
}

// ------------------------------------- A 与生产 prepareSubstatFactorBudgetQuery 对应
function classesOf(table) {
  return table.map((entry) => ({ min: entry.theta, value: entry.value }));
}
let productionChecks = 0;
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const base of BASELINES) {
      for (const caps of CAP_SETS) {
        for (const R of [0, 1, 2, 5, 8, 13, 21, 34]) {
          const formula = uTierTriple(level, job, base, R, caps);
          const [crtTable, dhtTable, detTable] = [
            formula.tables[0],
            formula.tables[1],
            formula.tables[2],
          ];
          const query = prepareSubstatFactorBudgetQuery(
            classesOf(crtTable),
            classesOf(detTable),
            classesOf(dhtTable),
          );
          check(query !== undefined, `A 生产查询构造失败 ${level}/${job}`);
          const result = query(R);
          check(result !== undefined, `A 生产查询返回 undefined ${level}/${job} R=${R}`);
          check(
            result.product === formula.value,
            `A 生产查询与档位三元组公式不一致 ${level}/${job} R=${R}：` +
              `${result.product} vs ${formula.value}`,
          );
          check(
            result.product === uBrute(level, job, base, R, caps).value,
            `A 生产查询与穷举不一致 ${level}/${job} R=${R}`,
          );
          productionChecks += 1;
        }
      }
    }
  }
}
// 负预算 / 非整数预算 / 工作量界：生产查询显式返回 undefined（安全回退）
{
  const table = tierTable(100, "WHM", "CRT", 200, 20);
  const det = tierTable(100, "WHM", "DET", 200, 20);
  const dht = tierTable(100, "WHM", "DHT", 200, 20);
  const query = prepareSubstatFactorBudgetQuery(classesOf(table), classesOf(det), classesOf(dht));
  check(query !== undefined, "A 负预算用例构造失败");
  check(query(-1) === undefined, "A 负预算必须返回 undefined");
  check(query(1.5) === undefined, "A 非整数预算必须返回 undefined");
  const disabled = prepareSubstatFactorBudgetQuery(
    classesOf(table),
    classesOf(det),
    classesOf(dht),
    { maxWork: 0 },
  );
  check(disabled === undefined, "A maxWork 不足时必须返回 undefined（安全回退）");
  productionChecks += 3;
}

// ------------------------------------------- B 顶点公式只是下界（非恒等）
let vertexBoundChecks = 0;
let vertexTight = 0;
let vertexStrict = 0;
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const base of [{ C: 0, H: 0, D: 0 }, { C: 200, H: 200, D: 200 }]) {
      for (const R of [5, 13, 21, 34, 61]) {
        const vertexValues = [
          productAt(level, job, base, R, 0, 0),
          productAt(level, job, base, 0, R, 0),
          productAt(level, job, base, 0, 0, R),
        ];
        const vertexMax = vertexValues.reduce((a, b) => (a > b ? a : b));
        const actual = uBrute(level, job, base, R, [INF, INF, INF]).value;
        check(actual >= vertexMax, `B U 小于顶点最大值 ${level}/${job} R=${R}`);
        if (actual > vertexMax) vertexStrict += 1;
        else vertexTight += 1;
        vertexBoundChecks += 1;
      }
    }
  }
}
check(vertexStrict > 0, "B 未找到顶点公式严格失效的实例");

// ------------------------------------- C 平台区间 / 饱和 / 预算可被浪费
// level 100 普通：CRT 首个跳档成本 14、DHT 6、DET 20 —— R<=5 时任何坐标都无法跨档。
const flatLevel = 100;
const flatJob = "WHM";
const flatBase = { C: 0, H: 0, D: 0 };
const flatSeries = [];
for (let R = 0; R <= 6; R += 1) {
  flatSeries.push(uBrute(flatLevel, flatJob, flatBase, R, [INF, INF, INF]).value);
}
for (let R = 0; R <= 5; R += 1) {
  check(flatSeries[R] === flatSeries[0], `C 平台区间失败 level 100 R=${R}`);
}
check(flatSeries[6] > flatSeries[5], "C level 100 R=6 应发生 DHT 跳档");
// 满预算但预算完全浪费：R=5 的满预算点 (5,0,0) 与零预算同为最优值
{
  const wasted = productAt(flatLevel, flatJob, flatBase, 5, 0, 0);
  check(wasted === flatSeries[0], "C 满预算浪费实例失败");
}
// 饱和：有限 cap 下，达到 caps 的最小总成本之后 U 不再增长
let saturationFlatChecks = 0;
for (const level of [50, 60, 70, 100]) {
  for (const job of JOBS) {
    const base = { C: 0, H: 0, D: 0 };
    const caps = [120, 90, 60];
    const costOf = (stat, cap, statBase) => {
      const topTier = tier(level, job, stat, statBase + cap);
      return Math.max(
        0,
        firstContributionWithTierAtLeast(level, job, stat, topTier) - statBase,
      );
    };
    const rSat =
      costOf("CRT", caps[0], base.C) +
      costOf("DHT", caps[1], base.H) +
      costOf("DET", caps[2], base.D);
    const atSat = uBrute(level, job, base, rSat, caps).value;
    for (const extra of [1, 7, 100, 1000]) {
      check(
        uBrute(level, job, base, rSat + extra, caps).value === atSat,
        `C 饱和失败 ${level}/${job} R_sat=${rSat} extra=${extra}`,
      );
      saturationFlatChecks += 1;
    }
  }
}

// ------------------------------------------------- D 整数域 / 正性 / 有效区间
for (const level of LEVELS) {
  for (const job of JOBS) {
    for (const stat of STATS) {
      for (const g of [0, 1, 17, 200, 1000]) {
        const truth = tier(level, job, stat, g);
        check(Number.isSafeInteger(truth), `D 档位必须是安全整数 ${level}/${job}/${stat}`);
        const factor = factorAt(level, job, stat, g);
        check(Number.isSafeInteger(factor) && factor > 0, `D 因子必须为正安全整数`);
      }
    }
        // 有效档位区间上界 = tier(base + min(cap,R))；区间外档位在公式中不出现
    const base = 200;
    const R = 21;
    const table = tierTable(level, job, "CRT", base, R);
    check(table[0].tier === tier(level, job, "CRT", base), "D 有效区间下界失败");
    check(
      table[table.length - 1].tier === tier(level, job, "CRT", base + R),
      "D 有效区间上界失败",
    );
  }
}

// ---------------------- E baseStat 影响审计（贡献坐标 vs 面板总值，README §13）
// 本文全部坐标都必须是「档位输入贡献」g = value - offset：
//   CRT/DHT offset = sub，DET offset = main（equipped-effects.ts:127-149）。
// 审计 1：生产 `equippedAttributeTier` 的 `gearAndFoodValue` 参数在当前数据下就是贡献 g
//         （内部 value = baseStats + gearAndFoodValue，而 baseStats 恰为 offset）。
// 审计 2：把「面板总值」误当贡献传入会改变档位，证明两种坐标不可混用。
const canonical = await loadCanonicalEvaluator();
const AUDIT_CONTRIBUTIONS = [
  0, 1, 9, 14, 20, 50, 57, 89, 200, 209, 375, 445, 556, 810, 900, 1000, 1186, 1596, 1700,
];
let baseStatAuditChecks = 0;
let panelConfusionStrict = 0;
for (const level of LEVELS) {
  const params = DOCUMENTED_LEVEL_PARAMS[level];
  for (const job of JOBS) {
    for (const stat of STATS) {
      const offset = stat === "DET" ? params.main : params.sub;
      for (const g of AUDIT_CONTRIBUTIONS) {
        // (a) 生产 evaluator 的 gearAndFoodValue = 贡献 g（baseStats 归约）
        const productionTier = canonical.equippedAttributeTier(job, level, stat, g);
        const modelTier = tier(level, job, stat, g);
        check(
          productionTier === modelTier,
          `E baseStat 归约失败 ${level}/${job}/${stat} g=${g}: 生产 ${productionTier} vs 模型 ${modelTier}`,
        );
        // (b) 面板总值 = offset + g；把它误当贡献会得到不同（更高）档位
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
// 文档 §13 的换算表以 level 100 WHM 的偏移 (sub,sub,main) = (420,420,440) 为实例：
// b=(200,200,200) ↔ 面板 (620,620,640)；b=0 ↔ 面板 (420,420,440)（基础属性，不是面板 0）。
check(
  DOCUMENTED_LEVEL_PARAMS[100].sub === 420 && DOCUMENTED_LEVEL_PARAMS[100].main === 440,
  "E level 100 偏移参数变化：README §13 的换算表需要同步更新",
);
check(200 + DOCUMENTED_LEVEL_PARAMS[100].sub === 620, "E baseline 面板换算失败 CRT");
check(200 + DOCUMENTED_LEVEL_PARAMS[100].main === 640, "E baseline 面板换算失败 DET");
check(
  DOCUMENTED_LEVEL_PARAMS[50].sub === 341 && DOCUMENTED_LEVEL_PARAMS[50].main === 202,
  "E level 50 BLU 偏移参数变化：README §13 的换算表需要同步更新",
);

// ------------------------------------------------------------------ 输出报告
record("T1-monotone-step", `${monotoneChecks} 个单调性/初值点，${stepChecks} 个跳变点`);
record("T2-full-budget", `无 cap ${fullBudgetChecks} 例；有 cap ${cappedChecks} 例；饱和 ${saturationChecks} 例`);
record("T3-tier-triple-exact", `${tierTripleChecks} 个 (level,job,base,R,caps) 与穷举逐点一致`);
record("A-production-correspondence", `${productionChecks} 个查询与公式/穷举一致（含 3 个非法输入回退）`);
record("B-vertex-lower-bound", `${vertexBoundChecks} 例 U >= 顶点最大值；严格不等 ${vertexStrict} 例，相等 ${vertexTight} 例`);
record("C-wasted-budget-saturation", `平台区间 + 满预算浪费 + ${saturationFlatChecks} 个饱和点`);
record("D-integer-domain", "档位/因子为安全正整数；有效区间端点正确");
record(
  "E-baseStat-audit",
  `${panelConfusionStrict} 个 (level,job,stat,g) 点 × 2 项检查（生产=模型、混用改变档位）= ` +
    `${baseStatAuditChecks} 个检查，另 4 个偏移/换算式复核；` +
    "level 100 偏移 (420,420,440)、level 50 偏移 (341,341,202) 复核",
);
record("grid", `等级 ${LEVELS.length} × ${JOBS.length} 类 × baseline ${BASELINES.length} × R ${R_VALUES.length} × caps ${CAP_SETS.length}`);

console.log("free-budget-upper-bound verification: PASS");
for (const entry of report) console.log(`  [ok] ${entry.name}: ${entry.detail}`);
console.log(`  checks: ${checks}`);
console.log(
  "scope: 有限网格上的精确整数证书；一般性证明见本目录 README.md 定理 1-3 与推论 A-D。",
);
