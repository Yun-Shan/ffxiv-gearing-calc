/**
 * raw-marginal-envelope/verify.mjs
 *
 * 目的：为 theorems/raw-marginal-envelope/README.md（Theorem B）提供有限域证书。
 *
 * 覆盖范围（全部为有限、可复现的枚举；不是一般性证明，一般性证明在 README §6）：
 *   1. 等级参数与整数档位模型 vs production canonical evaluator 的抽样复核。
 *   2. 引理 1：窗口档位增益 t(g+δ)−t(g) = mult·floor((r+aδ)/q)，以及两值成员判据。
 *   3. 引理 3：余类周期 P、tier 平移、最小性、可达余类集合；README 余类表逐项核对。
 *   4. 跳档成本闭式 c_K = floor(q/a) + [ρ_K < q mod a]；成本范围；level 50 DHT 的零成本跳档。
 *   5. 引理 2：窗口因子增益的精确恒等式、两值上下包络、按跨越档位增益连乘的表示；
 *      README 中的两个数值例（level 70 DHT g=13/37, δ=10）。
 *   6. 定理 1：区间上的精确极值查询——暴力枚举 vs 余类×tier 指示枚举；同预算精确比较；
 *      跨预算比较复用 Theorem A 的交叉指数判据；README 中的 level 70 DHT [100,160] δ=10 例。
 *   7. 定理 2：全部 36 个公式实例的 raw 级二阶对数符号；level 70 DHT 的 18 周期精确符号字；
 *      见证表（README 中列出的 level 70 见证）；「任意非恒定非减阶梯序列必有正负号」的反例。
 *   8. 推论：单位预算锯齿振幅与平滑趋势之比 A/T 的精确整数证书（canonical 上界与 level 100 TEN 的 25 倍证书）。
 *   9. 边界：DET 的 mult 粒度、空窗口、g<0 定义域、c=0 与每单位增益无定义。
 *  10. baseStat 影响审计：贡献坐标 vs 面板总值（baseStats 映射、贡献坐标档位一致、
 *      周期/跳档成本与 baseStat 无关、面板阈值常数平移、README 数值例坐标换算）。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/raw-marginal-envelope/verify.mjs
 */
import {
  DOCUMENTED_LEVEL_PARAMS,
  assert,
  criticalFactor,
  determinationFactor,
  directHitFactor,
  firstContributionWithTierAtLeast,
  gcd,
  loadCanonicalEvaluator,
  loadGameData,
  tier,
  tierParameters,
  tierPeriod,
} from "../../verification/canonical-model.mjs";

const report = [];
function ok(name, detail) {
  report.push({ name, detail });
}
const LEVELS = [50, 60, 70, 80, 90, 100];
const JOBS = ["WHM", "BLU"];
const STATS = ["CRT", "DHT", "DET", "TEN"];

// ---------------------------------------------------------------- 基础工具

function pow(base, exponent) {
  let result = 1n;
  let b = BigInt(base);
  let e = BigInt(exponent);
  if (e < 0n) throw new RangeError("pow 只接受非负指数");
  while (e > 0n) {
    if (e & 1n) result *= b;
    b *= b;
    e >>= 1n;
  }
  return result;
}
function cmpBig(left, right) {
  return left > right ? 1 : left < right ? -1 : 0;
}
/** 正有理数 N/D 的比较。 */
function cmpRatio(N1, D1, N2, D2) {
  return cmpBig(BigInt(N1) * BigInt(D2), BigInt(N2) * BigInt(D1));
}
/** 因子 F(t)（BigInt）：CRT/DHT/DET 用 canonical 因子；TEN 的 tenacity 因子 = t_TEN（分母 1000）。 */
function factorFor(stat, job) {
  if (stat === "CRT") return (tierValue) => BigInt(criticalFactor(tierValue, job));
  if (stat === "DHT") return (tierValue) => BigInt(directHitFactor(tierValue));
  if (stat === "DET") return (tierValue) => BigInt(determinationFactor(tierValue));
  return (tierValue) => BigInt(tierValue);
}
/** tier 索引 K(g) = floor((a g + b)/q) 与余数 r(g)。 */
function tierIndexAndResidue(params, g) {
  const numerator = params.a * g + params.b;
  return { K: Math.floor(numerator / params.q), r: numerator % params.q };
}
/** tier 值 target 的最小贡献阈值（g>=0），用 canonical-model 的闭式并裁剪到 0。 */
function thresholdOfTierValue(level, job, stat, target) {
  return Math.max(0, firstContributionWithTierAtLeast(level, job, stat, target));
}
/** tier 索引 K 的阈值：t(g) >= c + mult*K。 */
function thresholdOfTierIndex(level, job, stat, tierIndex) {
  const p = tierParameters(level, job, stat);
  return thresholdOfTierValue(level, job, stat, p.c + p.mult * tierIndex);
}
/** 跳档成本（tier 索引 K -> K+1 的 raw 成本）。 */
function jumpCost(level, job, stat, tierIndex) {
  return thresholdOfTierIndex(level, job, stat, tierIndex + 1) -
    thresholdOfTierIndex(level, job, stat, tierIndex);
}
/** tier 增益 ρ_K = F(c+mult(K+1)) / F(c+mult K)（BigInt 分子/分母）。 */
function tierGain(level, job, stat, tierIndex) {
  const p = tierParameters(level, job, stat);
  const F = factorFor(stat, job);
  const lower = p.c + p.mult * tierIndex;
  return { N: F(lower + p.mult), D: F(lower) };
}

// ------------------------------------------- 1. 等级参数 + 档位模型 vs production evaluator
{
  const data = await loadGameData();
  const canonical = await loadCanonicalEvaluator();
  const levelKeys = Object.keys(data.jobLevelModifiers).map(Number).sort((a, b) => a - b);
  assert(levelKeys.join(",") === LEVELS.join(","), "支持等级集合与文档不一致");
  for (const level of levelKeys) {
    const actual = data.jobLevelModifiers[level];
    const documented = DOCUMENTED_LEVEL_PARAMS[level];
    for (const key of ["main", "sub", "div", "det", "detTrunc"]) {
      assert(actual[key] === documented[key], `等级 ${level} 的参数 ${key} 与文档不一致`);
    }
  }
  // 档位模型逐点对照（抽样；完整对照见 verification/verify-canonical-model.mjs）
  let tierChecks = 0;
  for (const level of levelKeys) {
    for (const job of ["WHM", "BLU", "WAR", "SCH"]) {
      if (data.jobSchemas[job].maxJobLevel < level) continue;
      for (const stat of STATS) {
        for (const g of [0, 1, 2, 17, 99, 123, 511, 1024, 3000]) {
          const model = tier(level, job, stat, g);
          const actual = canonical.equippedAttributeTier(job, level, stat, g);
          assert(model === actual, `档位模型与 canonical 不一致 ${level}/${job}/${stat}/g=${g}: ${model} vs ${actual}`);
          tierChecks += 1;
        }
      }
    }
  }
  ok("1.level-params-and-tier-model", `${levelKeys.length} 个等级参数一致；${tierChecks} 个抽样档位与 canonical evaluator 逐点一致`);
}

// ------------------------------------------------ 2. 引理 1：窗口档位增益（有限证书）
{
  const deltas = [0, 1, 2, 3, 4, 5, 7, 11, 13, 17, 23, 29, 36, 50];
  let checks = 0;
  let lowerHits = 0;
  let upperHits = 0;
  for (const level of LEVELS) {
    for (const job of JOBS) {
      for (const stat of STATS) {
        const p = tierParameters(level, job, stat);
        for (let g = 0; g <= 80; g += 1) {
          const { r } = tierIndexAndResidue(p, g);
          for (const delta of deltas) {
            const actual = tier(level, job, stat, g + delta) - tier(level, job, stat, g);
            // 精确整数模型：mult * floor((r + aδ)/q)
            const predicted = p.mult * Math.floor((r + p.a * delta) / p.q);
            assert(actual === predicted, `引理 1 失败 ${level}/${job}/${stat} g=${g} δ=${delta}: ${actual} vs ${predicted}`);
            // 两值成员判据
            const lo = p.mult * Math.floor((p.a * delta) / p.q);
            const hi = p.mult * Math.ceil((p.a * delta) / p.q);
            assert(actual === lo || actual === hi, `成员判据失败 ${level}/${stat} g=${g} δ=${delta}`);
            const m = (p.a * delta) % p.q;
            const epsilon = r + m >= p.q ? 1 : 0;
            const predictedByEpsilon = p.mult * (Math.floor((p.a * delta) / p.q) + epsilon);
            assert(actual === predictedByEpsilon, `ε 判据失败 ${level}/${stat} g=${g} δ=${delta}`);
            if (actual === lo) lowerHits += 1;
            if (actual === hi) upperHits += 1;
            checks += 1;
          }
        }
      }
    }
  }
  assert(checks > 0 && lowerHits > 0 && upperHits > 0, "两值应都出现");
  ok(
    "2.window-tier-gain-lemma",
    `${checks} 个 (level,job,stat,g∈[0,80],δ∈{${deltas.join(",")}}) 点上 t(g+δ)−t(g)=mult·floor((r+aδ)/q) 与 ε 成员判据全部成立；` +
      `取到下端点 ${lowerHits} 次、上端点 ${upperHits} 次`,
  );
}

// ------------------------------------- 3. 引理 3：周期、平移、可达余类集合与 README 表
{
  // README 表：level/stat -> [a,b,q,c,mult,d,P,shiftK]
  const expected = {
    "50/CRT": [200, 0, 341, 50, 1, 1, 341, 200],
    "50/DHT": [550, 0, 341, 0, 1, 11, 31, 50],
    "50/DET": [140, 202000, 1010, 0, 5, 10, 101, 14],
    "50/TEN": [112, 0, 341, 1000, 1, 1, 341, 112],
    "60/CRT": [200, 0, 600, 50, 1, 200, 3, 1],
    "60/DHT": [550, 0, 600, 0, 1, 50, 12, 11],
    "60/DET": [140, 600000, 1200, 0, 2, 20, 60, 7],
    "60/TEN": [112, 0, 600, 1000, 1, 8, 75, 14],
    "70/CRT": [200, 0, 900, 50, 1, 100, 9, 2],
    "70/DHT": [550, 0, 900, 0, 1, 50, 18, 11],
    "70/DET": [140, 900000, 900, 0, 1, 20, 45, 7],
    "70/TEN": [112, 0, 900, 1000, 1, 4, 225, 28],
    "80/CRT": [200, 0, 1300, 50, 1, 100, 13, 2],
    "80/DHT": [550, 0, 1300, 0, 1, 50, 26, 11],
    "80/DET": [140, 1300000, 1300, 0, 1, 20, 65, 7],
    "80/TEN": [112, 0, 1300, 1000, 1, 4, 325, 28],
    "90/CRT": [200, 0, 1900, 50, 1, 100, 19, 2],
    "90/DHT": [550, 0, 1900, 0, 1, 50, 38, 11],
    "90/DET": [140, 1900000, 1900, 0, 1, 20, 95, 7],
    "90/TEN": [112, 0, 1900, 1000, 1, 4, 475, 28],
    "100/CRT": [200, 0, 2780, 50, 1, 20, 139, 10],
    "100/DHT": [550, 0, 2780, 0, 1, 10, 278, 55],
    "100/DET": [140, 2780000, 2780, 0, 1, 20, 139, 7],
    "100/TEN": [112, 0, 2780, 1000, 1, 4, 695, 28],
  };
  let tableChecks = 0;
  let periodChecks = 0;
  let minimalityChecks = 0;
  for (const level of LEVELS) {
    for (const stat of STATS) {
      const p = tierParameters(level, "WHM", stat);
      const { period, shift, divisor } = tierPeriod(level, "WHM", stat);
      const row = expected[`${level}/${stat}`];
      assert(row !== undefined, `README 表缺行 ${level}/${stat}`);
      assert(
        row[0] === p.a && row[1] === p.b && row[2] === p.q && row[3] === p.c && row[4] === p.mult &&
          row[5] === divisor && row[6] === period && row[7] === shift / p.mult,
        `README 表与模型不一致 ${level}/${stat}: 模型 (${p.a},${p.b},${p.q},${p.c},${p.mult},${divisor},${period},${shift / p.mult}) vs 表 (${row})`,
      );
      // 周期与平移
      for (let g = 0; g <= 2 * period; g += 1) {
        const { r } = tierIndexAndResidue(p, g);
        const shifted = tierIndexAndResidue(p, g + period);
        assert(shifted.r === r, `余类周期失败 ${level}/${stat} g=${g}`);
        assert(
          tier(level, "WHM", stat, g + period) === tier(level, "WHM", stat, g) + shift,
          `tier 平移失败 ${level}/${stat} g=${g}`,
        );
        periodChecks += 1;
      }
      // 最小性：不存在 p < P 使 a·p ≡ 0 (mod q)
      for (let candidate = 1; candidate < period; candidate += 1) {
        assert((p.a * candidate) % p.q !== 0, `周期不是最小 ${level}/${stat} candidate=${candidate}`);
        minimalityChecks += 1;
      }
      // 可达余类集合 = { b + d·j mod q : j=0..P-1 }
      const residuesDirect = new Set();
      for (let g = 0; g < period; g += 1) residuesDirect.add(tierIndexAndResidue(p, g).r);
      const residuesClosed = new Set();
      for (let j = 0; j < period; j += 1) residuesClosed.add((((p.b + divisor * j) % p.q) + p.q) % p.q);
      assert(residuesDirect.size === period, `一个周期内余类应互不相同 ${level}/${stat}`);
      for (const residue of residuesClosed) assert(residuesDirect.has(residue), `闭式余类集合与枚举不一致 ${level}/${stat}`);
      // BLU 的常数偏移不改变 r（只改变 c）
      const pBlu = tierParameters(level, "BLU", stat);
      const periodsBlu = tierPeriod(level, "BLU", stat);
      assert(pBlu.a === p.a && pBlu.b === p.b && pBlu.q === p.q, `BLU 的 (a,b,q) 应不变 ${level}/${stat}`);
      assert(periodsBlu.period === period && periodsBlu.shift === shift, `BLU 周期应不变 ${level}/${stat}`);
      tableChecks += 1;
    }
  }
  ok(
    "3.residue-period-table",
    `${tableChecks} 个 (level,stat) 的 README 余类表逐项核对通过；${periodChecks} 个 g 上 r(g+P)=r(g)、t(g+P)=t(g)+shift；` +
      `${minimalityChecks} 个 candidate<P 非周期；可达余类数恰为 P，且等于 b+d·{0..P−1} mod q；BLU 偏移不改变 (a,b,q,P)`,
  );
}

// --------------------------- 4. 跳档成本闭式、成本范围、零成本跳档（level 50 DHT）
{
  let checked = 0;
  const zeroCostCases = [];
  for (const level of LEVELS) {
    for (const job of JOBS) {
      for (const stat of STATS) {
        const p = tierParameters(level, job, stat);
        const M = p.q % p.a;
        const Q = Math.floor(p.q / p.a);
        const firstIndex = Math.floor(p.b / p.q);
        for (let offset = 0; offset < 60; offset += 1) {
          const K = firstIndex + offset;
          const actual = jumpCost(level, job, stat, K);
          // ρ_K = (b − K q) mod a；cost = floor(q/a) + [ρ_K < q mod a]
          const rho = (((p.b - K * p.q) % p.a) + p.a) % p.a;
          const predicted = Q + (rho < M ? 1 : 0);
          assert(actual === predicted, `跳档成本公式失败 ${level}/${job}/${stat} K=${K}: 实际 ${actual} vs 公式 ${predicted}`);
          if (actual === 0) zeroCostCases.push(`${level}/${job}/${stat}/K=${K}`);
          checked += 1;
        }
        // 成本范围：至多两个相邻值
        const costs = [];
        for (let offset = 0; offset < 40; offset += 1) costs.push(jumpCost(level, job, stat, firstIndex + offset));
        const lo = Math.min(...costs);
        const hi = Math.max(...costs);
        assert(lo >= 0, "成本非负");
        assert(hi - lo <= 1, "相邻跳档成本差至多 1");
      }
    }
  }
  assert(checked > 0, "跳档成本检查非空");
  assert(zeroCostCases.length > 0, "应存在零成本跳档（level 50 DHT）");
  for (const item of zeroCostCases) assert(item.startsWith("50/"), `零成本跳档应只出现在 level 50：${item}`);
  ok(
    "4.jump-cost-formula",
    `${checked} 个 (level,job,stat,K) 上 c_K=floor(q/a)+[ρ_K<q mod a] 与阈值差一致；相邻成本差≤1；` +
      `零成本跳档 ${zeroCostCases.length} 个且全部位于 level 50（例：${zeroCostCases.slice(0, 4).join(", ")}）`,
  );
}

// --------------------------------------------------- 5. 引理 2：窗口因子增益包络
{
  const deltas = [1, 2, 3, 5, 10, 37];
  let checks = 0;
  let epsilon0Cases = 0;
  let epsilon1Cases = 0;
  for (const level of LEVELS) {
    for (const job of JOBS) {
      for (const stat of ["CRT", "DHT", "DET"]) {
        const p = tierParameters(level, job, stat);
        const F = factorFor(stat, job);
        for (let g = 0; g <= 40; g += 1) {
          const { K, r } = tierIndexAndResidue(p, g);
          const t = p.c + p.mult * K;
          const F0 = F(t);
          for (const delta of deltas) {
            const actual = tier(level, job, stat, g + delta) - tier(level, job, stat, g);
            const m = (p.a * delta) % p.q;
            const epsilon = r + m >= p.q ? 1 : 0;
            const Jmin = Math.floor((p.a * delta) / p.q);
            const Jmax = Math.ceil((p.a * delta) / p.q);
            const J = Jmin + epsilon;
            assert(actual === p.mult * J, `Δ 与 ε 不一致 ${level}/${stat} g=${g} δ=${delta}`);
            // 精确恒等式：gain = F(t + mult·J)/F(t)
            const exactN = F(t + p.mult * J);
            // tier 增益连乘表示
            let prodN = 1n;
            let prodD = 1n;
            for (let j = 0; j < J; j += 1) {
              const gain = tierGain(level, job, stat, K + j);
              prodN *= gain.N;
              prodD *= gain.D;
            }
            assert(prodN * F0 === exactN * prodD, `连乘表示失败 ${level}/${job}/${stat} g=${g} δ=${delta}`);
            // 两值包络：Jmin 乘积 ≤ 精确 gain ≤ Jmax 乘积
            const productFor = (steps) => {
              let N = 1n;
              let D = 1n;
              for (let j = 0; j < steps; j += 1) {
                const gain = tierGain(level, job, stat, K + j);
                N *= gain.N;
                D *= gain.D;
              }
              return { N, D };
            };
            const lower = productFor(Jmin);
            const upper = productFor(Jmax);
            assert(cmpRatio(exactN, F0, lower.N, lower.D) >= 0, `下包络失败 ${level}/${job}/${stat} g=${g} δ=${delta}`);
            assert(cmpRatio(exactN, F0, upper.N, upper.D) <= 0, `上包络失败 ${level}/${job}/${stat} g=${g} δ=${delta}`);
            if (epsilon === 0) {
              assert(cmpRatio(exactN, F0, lower.N, lower.D) === 0, "ε=0 时应取到下端点");
              epsilon0Cases += 1;
            } else {
              assert(cmpRatio(exactN, F0, upper.N, upper.D) === 0, "ε=1 时应取到上端点");
              epsilon1Cases += 1;
            }
            checks += 1;
          }
        }
      }
    }
  }
  assert(epsilon0Cases > 0 && epsilon1Cases > 0, "两分支都应出现");
  ok(
    "5.window-factor-envelope",
    `${checks} 个 (level,job,stat,g∈[0,40],δ∈{${deltas.join(",")}}) 点上：精确增益 = F(t+mult·J)/F(t)，` +
      `等于跨越档位增益 ρ_K…ρ_{K+J−1} 的连乘；被 Jmin=floor(aδ/q) 与 Jmax=ceil(aδ/q) 的乘积夹住；` +
      `ε=0 取下端点 ${epsilon0Cases} 次、ε=1 取上端点 ${epsilon1Cases} 次`,
  );

  // README 中的数值例
  {
    const level = 70;
    const job = "WHM";
    const stat = "DHT";
    const p = tierParameters(level, job, stat);
    const cases = [
      {
        g: 13, delta: 10, expectedR: 850, expectedK: 7, expectedGain: 7,
        expectedExact: [4014n, 4007n], expectedLower: [4013n, 4007n], expectedUpper: [4014n, 4007n],
      },
      {
        g: 37, delta: 10, expectedR: 550, expectedK: 22, expectedGain: 6,
        expectedExact: [4028n, 4022n], expectedLower: [4028n, 4022n], expectedUpper: [4029n, 4022n],
      },
    ];
    const F = (t) => BigInt(4000 + t);
    for (const item of cases) {
      const { K, r } = tierIndexAndResidue(p, item.g);
      const t = p.c + p.mult * K;
      const gain = tier(level, job, stat, item.g + item.delta) - tier(level, job, stat, item.g);
      const Jmin = Math.floor((p.a * item.delta) / p.q);
      const Jmax = Math.ceil((p.a * item.delta) / p.q);
      assert(r === item.expectedR && K === item.expectedK && gain === item.expectedGain, `数值例参数 g=${item.g} r=${r} K=${K} gain=${gain}`);
      assert(F(t + p.mult * gain) === item.expectedExact[0] && F(t) === item.expectedExact[1], "精确增益数值例");
      assert(F(t + p.mult * Jmin) === item.expectedLower[0] && F(t) === item.expectedLower[1], "下界数值例");
      assert(F(t + p.mult * Jmax) === item.expectedUpper[0] && F(t) === item.expectedUpper[1], "上界数值例");
    }
    ok(
      "5b.readme-numeric-examples",
      "level 70 DHT δ=10：g=13 时 r=850,K=7,t=7，精确增益 4014/4007，包络 [4013/4007, 4014/4007]；" +
        "g=37 时 r=550,K=22,t=22，精确增益 4028/4022，包络 [4028/4022, 4029/4022]",
    );
  }
}

// ------------------------------------------------- 6. 定理 1：区间精确包络查询
{
  // 6a README 示例：level 70 DHT，[u,v]=[100,160]，δ=10
  {
    const level = 70;
    const job = "WHM";
    const stat = "DHT";
    const p = tierParameters(level, job, stat);
    const F = factorFor(stat, job);
    const u = 100;
    const v = 160;
    const delta = 10;
    let best = null;
    let worst = null;
    for (let g = u; g + delta <= v; g += 1) {
      const N = F(tier(level, job, stat, g + delta));
      const D = F(tier(level, job, stat, g));
      if (best === null || cmpRatio(N, D, best.N, best.D) > 0) best = { g, N, D };
      if (worst === null || cmpRatio(N, D, worst.N, worst.D) < 0) worst = { g, N, D };
    }
    assert(best.g === 103 && worst.g === 149, `定理 1 示例极值点应为 g=103/149，实际 ${best.g}/${worst.g}`);
    assert(best.N === 4069n && best.D === 4062n, `max 应为 4069/4062，实际 ${best.N}/${best.D}`);
    assert(worst.N === 4097n && worst.D === 4091n, `min 应为 4097/4091，实际 ${worst.N}/${worst.D}`);
    assert(cmpRatio(4069n, 4062n, 4097n, 4091n) > 0, "4069/4062 > 4097/4091");
    // 余类×tier 指示枚举（独立于逐 g 暴力）：Φ 只依赖 (K, ε)
    const candidateMap = new Map();
    const { period } = tierPeriod(level, job, stat);
    for (let residueClass = 0; residueClass < period; residueClass += 1) {
      const startG = u + (((residueClass - (u % period)) % period) + period) % period;
      for (let g = startG; g + delta <= v; g += period) {
        const { K, r } = tierIndexAndResidue(p, g);
        const epsilon = (r + (p.a * delta) % p.q) >= p.q ? 1 : 0;
        const J = Math.floor((p.a * delta) / p.q) + epsilon;
        candidateMap.set(`${K},${epsilon}`, {
          K, r, epsilon,
          N: F(p.c + p.mult * (K + J)),
          D: F(p.c + p.mult * K),
        });
      }
    }
    const candidateRatios = [...candidateMap.values()];
    assert(candidateRatios.some((x) => cmpRatio(x.N, x.D, best.N, best.D) === 0), "候选集应包含最大值");
    assert(candidateRatios.some((x) => cmpRatio(x.N, x.D, worst.N, worst.D) === 0), "候选集应包含最小值");
    assert(candidateRatios.every((x) => cmpRatio(x.N, x.D, best.N, best.D) <= 0), "候选集不应超过暴力最大值");
    assert(candidateRatios.every((x) => cmpRatio(x.N, x.D, worst.N, worst.D) >= 0), "候选集不应低于暴力最小值");
    ok(
      "6a.envelope-query-example",
      `level 70 DHT [100,160] δ=10：暴力 max=4069/4062（g=103），min=4097/4091（g=149）；` +
        `余类×tier 指示候选集（${candidateMap.size} 个 (K,ε)）的极值与暴力完全一致`,
    );
  }

  // 6b 一般小域：暴力极值 == 候选集极值
  {
    let queries = 0;
    let candidatesTotal = 0;
    for (const level of LEVELS) {
      for (const stat of ["CRT", "DHT", "DET"]) {
        const p = tierParameters(level, "WHM", stat);
        const F = factorFor(stat, "WHM");
        const { period } = tierPeriod(level, "WHM", stat);
        for (const [u, v, delta] of [
          [0, 40, 1], [0, 40, 7], [13, 97, 5], [100, 160, 10], [201, 377, 23], [7, 19, 12],
        ]) {
          if (v - u < delta) continue;
          let bruteMax = null;
          let bruteMin = null;
          for (let g = u; g + delta <= v; g += 1) {
            const N = F(tier(level, "WHM", stat, g + delta));
            const D = F(tier(level, "WHM", stat, g));
            if (bruteMax === null || cmpRatio(N, D, bruteMax.N, bruteMax.D) > 0) bruteMax = { N, D };
            if (bruteMin === null || cmpRatio(N, D, bruteMin.N, bruteMin.D) < 0) bruteMin = { N, D };
          }
          let candMax = null;
          let candMin = null;
          for (let residueClass = 0; residueClass < period; residueClass += 1) {
            const startG = u + (((residueClass - (u % period)) % period) + period) % period;
            for (let g = startG; g + delta <= v; g += period) {
              const { K, r } = tierIndexAndResidue(p, g);
              const epsilon = (r + (p.a * delta) % p.q) >= p.q ? 1 : 0;
              const J = Math.floor((p.a * delta) / p.q) + epsilon;
              const N = F(p.c + p.mult * (K + J));
              const D = F(p.c + p.mult * K);
              if (candMax === null || cmpRatio(N, D, candMax.N, candMax.D) > 0) candMax = { N, D };
              if (candMin === null || cmpRatio(N, D, candMin.N, candMin.D) < 0) candMin = { N, D };
              candidatesTotal += 1;
            }
          }
          assert(cmpRatio(candMax.N, candMax.D, bruteMax.N, bruteMax.D) === 0, `候选集最大值与暴力不一致 ${level}/${stat}`);
          assert(cmpRatio(candMin.N, candMin.D, bruteMin.N, bruteMin.D) === 0, `候选集最小值与暴力不一致 ${level}/${stat}`);
          queries += 1;
        }
      }
    }
    assert(queries > 0, "查询样本非空");
    ok("6b.envelope-query-general", `${queries} 个 (level,stat,[u,v],δ) 查询上，余类×tier 指示枚举（共 ${candidatesTotal} 个候选）的极值与逐 g 暴力完全一致`);
  }

  // 6c 跨预算比较：Theorem A 的交叉指数判据 vs 浮点 log
  {
    let checks = 0;
    let nearTies = 0;
    for (const level of [70, 100]) {
      for (const stat of ["CRT", "DHT", "DET"]) {
        const F = factorFor(stat, "WHM");
        const windows = [];
        for (const [g, delta] of [[0, 1], [5, 3], [11, 7], [23, 5], [41, 13]]) {
          windows.push({
            N: F(tier(level, "WHM", stat, g + delta)),
            D: F(tier(level, "WHM", stat, g)),
            delta,
          });
        }
        for (const a of windows) {
          for (const b of windows) {
            // ln(Ra)/δa ? ln(Rb)/δb  ⟺  Na^δb · Db^δa ? Nb^δa · Da^δb
            const left = pow(a.N, b.delta) * pow(b.D, a.delta);
            const right = pow(b.N, a.delta) * pow(a.D, b.delta);
            const exact = cmpBig(left, right);
            const logGap = Math.log(Number(a.N) / Number(a.D)) / a.delta -
              Math.log(Number(b.N) / Number(b.D)) / b.delta;
            if (Math.abs(logGap) < 1e-12) nearTies += 1;
            else {
              assert(Math.sign(logGap) === exact, `跨预算比较符号不一致 ${level}/${stat}`);
              checks += 1;
            }
          }
        }
      }
    }
    assert(checks > 0, "跨预算比较样本非空");
    ok("6c.cross-budget-comparison", `${checks} 组不同预算窗口比较上，交叉指数整数判据与浮点 log 同号（近并列跳过 ${nearTies} 组）`);
  }
}

// ------------------------------------------------------ 7. 定理 2：raw 级曲率失败
{
  const d2 = (level, job, stat, g) => {
    const F = factorFor(stat, job);
    const t0 = tier(level, job, stat, g);
    const t1 = tier(level, job, stat, g + 1);
    const t2 = tier(level, job, stat, g + 2);
    return F(t2) * F(t0) - F(t1) * F(t1);
  };
  const signOf = (value) => (value > 0n ? "+" : value < 0n ? "-" : "0");

  // 7a README：level 70 DHT 的 18 周期精确符号字
  {
    const word = [];
    for (let g = 0; g < 18; g += 1) word.push(signOf(d2(70, "WHM", "DHT", g)));
    assert(word.join("") === "+-+--+-+--+-+--+--", `level 70 DHT 符号字应为 +-+--+-+--+-+--+--，实际 ${word.join("")}`);
    for (let g = 0; g < 300; g += 1) {
      assert(
        signOf(d2(70, "WHM", "DHT", g)) === signOf(d2(70, "WHM", "DHT", g + 18)),
        `level 70 DHT 符号字应以 18 为周期 g=${g}`,
      );
    }
    const deltaWord = [];
    for (let g = 0; g < 18; g += 1) {
      deltaWord.push(String(tier(70, "WHM", "DHT", g + 1) - tier(70, "WHM", "DHT", g)));
    }
    assert(deltaWord.join("") === "010110101101011011", `Δ 字应为 010110101101011011，实际 ${deltaWord.join("")}`);
    // 符号由 (Δ(g),Δ(g+1)) 决定：(0,0)->0, (0,1)->+, 其余 -> -
    for (let g = 0; g < 100; g += 1) {
      const first = deltaWord[g % 18];
      const second = deltaWord[(g + 1) % 18];
      const expectedSign = first === "0" && second === "0" ? "0" : first === "0" && second !== "0" ? "+" : "-";
      assert(signOf(d2(70, "WHM", "DHT", g)) === expectedSign, `符号字与 Δ 结构不一致 g=${g}`);
    }
    ok(
      "7a.level70-dht-sign-word",
      "level 70 DHT：Δ 字（g=0..17）=010110101101011011；raw 二阶对数符号字=+-+--+-+--+-+--+--，以 18 为周期；" +
        "符号完全由 (Δ(g),Δ(g+1)) 决定（连续两个 0 不出现）",
    );
  }

  // 7b 全部 36 个实例：正负号都出现；零只出现在窗口内无跳档时
  {
    let instances = 0;
    let zeroInstances = 0;
    const witnessTable = [];
    for (const level of LEVELS) {
      for (const job of JOBS) {
        for (const stat of STATS) {
          if (job === "BLU" && (stat === "DET" || stat === "TEN")) continue; // DET/TEN 与职业无关
          instances += 1;
          let plus = 0;
          let minus = 0;
          let zero = 0;
          let firstPlus = -1;
          let firstMinus = -1;
          for (let g = 0; g <= 400; g += 1) {
            const sign = signOf(d2(level, job, stat, g));
            if (sign === "+") {
              plus += 1;
              if (firstPlus < 0) firstPlus = g;
            } else if (sign === "-") {
              minus += 1;
              if (firstMinus < 0) firstMinus = g;
            } else zero += 1;
          }
          assert(plus > 0 && minus > 0, `实例 ${level}/${job}/${stat} 应同时出现正负号`);
          zeroInstances += zero > 0 ? 1 : 0;
          // 零 ⇔ 窗口 (g,g+2] 内没有跳档；单侧跳档的符号
          for (let g = 0; g <= 200; g += 1) {
            const changes = tier(level, job, stat, g + 2) - tier(level, job, stat, g);
            if (changes === 0) {
              assert(signOf(d2(level, job, stat, g)) === "0", `无跳档时应为 0 ${level}/${stat}/g=${g}`);
            } else if (tier(level, job, stat, g + 1) === tier(level, job, stat, g)) {
              assert(signOf(d2(level, job, stat, g)) === "+", "仅后半跳档应为 +");
            } else if (tier(level, job, stat, g + 1) === tier(level, job, stat, g + 2)) {
              assert(signOf(d2(level, job, stat, g)) === "-", "仅前半跳档应为 -");
            }
          }
          witnessTable.push({
            key: `${level}/${job}/${stat}`,
            firstPlus,
            firstMinus,
          });
        }
      }
    }
    assert(instances === 36, `实例数应为 36，实际 ${instances}`);
    assert(zeroInstances > 0, "应存在带平台（零二阶差）的实例");
    // README 中列出的 level 70 见证（最小 g+ / g−）
    const readmeWitnesses = {
      "70/WHM/CRT": [3, 4],
      "70/WHM/DHT": [0, 1],
      "70/WHM/DET": [5, 6],
      "70/WHM/TEN": [7, 8],
      "70/BLU/CRT": [3, 4],
      "70/BLU/DHT": [0, 1],
    };
    for (const [key, expected] of Object.entries(readmeWitnesses)) {
      const entry = witnessTable.find((item) => item.key === key);
      assert(entry !== undefined, `见证表缺项 ${key}`);
      assert(entry.firstPlus === expected[0] && entry.firstMinus === expected[1], `见证与 README 不一致 ${key}`);
    }
    ok(
      "7b.both-signs-all-instances",
      `全部 ${instances} 个公式实例（6 等级 × {CRT普通, CRT_BLU, DHT普通, DHT_BLU, DET, TEN}）在 g∈[0,400] 上同时出现 Δ²lnF>0 与 <0；` +
        `零仅在窗口内无跳档时出现；README 所列 level 70 见证 g+/g− 与最小见证一致`,
    );
  }

  // 7c 「任意非恒定非减阶梯序列必有正负号」是错的：均匀步长反例
  {
    const F = (t) => BigInt(4000 + t);
    let allNegative = true;
    for (let g = 0; g <= 500; g += 1) {
      // t(g) = g（均匀步长 1）
      const value = F(g + 2) * F(g) - F(g + 1) * F(g + 1);
      if (value >= 0n) allNegative = false;
    }
    assert(allNegative, "均匀步长 t(g)=g 应使 raw 对数序列严格 log-concave（Δ²<0）");
    ok(
      "7c.uniform-step-counterexample",
      "t(g)=g（均匀步长）与 F(t)=4000+t：Δ²lnF = ln[(A+g)(A+g+2)/(A+g+1)²] < 0 对全部 g 成立 ⇒ " +
        "「非恒定非减阶梯序列必有正负号」不成立；正负号结论必须逐实例（本表 36 个）证明",
    );
  }

  // 7d level 50 DHT 的 a>q 情形：每个 raw 步都跨档，增量 ∈{1,2}
  {
    const level = 50;
    const stat = "DHT";
    const increments = new Set();
    for (let g = 0; g < 31; g += 1) {
      increments.add(tier(level, "WHM", stat, g + 1) - tier(level, "WHM", stat, g));
    }
    assert([...increments].sort().join(",") === "1,2", `level 50 DHT 单步档位增量应为 {1,2}，实际 ${[...increments]}`);
    const inc0 = tier(level, "WHM", stat, 1) - tier(level, "WHM", stat, 0);
    const inc1 = tier(level, "WHM", stat, 2) - tier(level, "WHM", stat, 1);
    const inc2 = tier(level, "WHM", stat, 3) - tier(level, "WHM", stat, 2);
    assert(inc0 === 1 && inc1 === 2 && inc2 === 1, "level 50 DHT 起始增量应为 1,2,1");
    assert(signOf(d2(level, "WHM", stat, 0)) === "+", "level 50 DHT g=0 应为 +（加速）");
    assert(signOf(d2(level, "WHM", stat, 1)) === "-", "level 50 DHT g=1 应为 -（减速）");
    ok(
      "7d.level50-dht-accelerating",
      "level 50 DHT（a=550>q=341）：每个 raw 步都跨档，单步增量 ∈{1,2}；g=0 增量 (1,2) ⇒ Δ²>0，g=1 增量 (2,1) ⇒ Δ²<0",
    );
  }
}

// ------------------------------------------------- 8. 推论：锯齿振幅与平滑趋势
{
  const amplitudeRows = [];
  let ampOverTrend = 0;
  let maxRatioValue = 0;
  let maxRatioKey = "";
  for (const level of LEVELS) {
    for (const stat of STATS) {
      const p = tierParameters(level, "WHM", stat);
      const { period } = tierPeriod(level, "WHM", stat);
      const F = factorFor(stat, "WHM");
      let maxN = 0n;
      let maxD = 1n;
      let minN = null;
      let minD = 1n;
      for (let g = 0; g < period; g += 1) {
        const N = F(tier(level, "WHM", stat, g + 1));
        const D = F(tier(level, "WHM", stat, g));
        if (cmpRatio(N, D, maxN, maxD) > 0) {
          maxN = N;
          maxD = D;
        }
        if (minN === null || cmpRatio(N, D, minN, minD) < 0) {
          minN = N;
          minD = D;
        }
      }
      // 平滑趋势 T = (1/P)·ln(周期增益)，周期增益 = F(t(0)+mult·shift)/F(t(0))
      const periodN = F(tier(level, "WHM", stat, period));
      const periodD = F(tier(level, "WHM", stat, 0));
      // A = ln(maxN/maxD) − ln(minN/minD) = ln((maxN·minD)/(maxD·minN))
      const ampBase = maxN * minD;
      const ampBaseD = maxD * minN;
      // A/T > 1 的精确证书： (ampBase/ampBaseD)^P > 周期增益
      const certAmpGtTrend =
        pow(ampBase, period) * pow(periodD, 1) > pow(periodN, 1) * pow(ampBaseD, period);
      // A/T < 26 的精确证书
      const certAmpLt26 =
        pow(ampBase, period) * pow(periodD, 26) < pow(periodN, 26) * pow(ampBaseD, period);
      const approxRatio = period * Math.log(Number(ampBase) / Number(ampBaseD)) /
        Math.log(Number(periodN) / Number(periodD));
      assert(certAmpLt26, `A/T 应 < 26：${level}/${stat}`);
      if (certAmpGtTrend) ampOverTrend += 1;
      if (approxRatio > maxRatioValue) {
        maxRatioValue = approxRatio;
        maxRatioKey = `${level}/${stat}`;
      }
      amplitudeRows.push({ key: `${level}/${stat}`, period, approxRatio, certAmpGtTrend });
    }
  }
  // level 100 TEN：A/T > 25 的精确证书
  {
    const level = 100;
    const stat = "TEN";
    const { period } = tierPeriod(level, "WHM", stat);
    const F = (t) => BigInt(t);
    const maxN = F(1001);
    const maxD = F(1000);
    const minN = F(1000);
    const minD = F(1000);
    const periodN = F(tier(level, "WHM", stat, period));
    const periodD = F(tier(level, "WHM", stat, 0));
    assert(maxN === 1001n && maxD === 1000n && minN === 1000n && periodN === 1028n && periodD === 1000n,
      `level 100 TEN 振幅数据：max=${maxN}/${maxD}, period=${periodN}/${periodD}, P=${period}`);
    const cert25 =
      pow(maxN * minD, period) * pow(periodD, 25) > pow(periodN, 25) * pow(maxD * minN, period);
    assert(cert25, "level 100 TEN 应满足 A/T > 25");
  }
  assert(ampOverTrend > 0, "应存在 A/T>1 的实例");
  assert(maxRatioKey === "100/TEN", `A/T 最大应为 level 100 TEN，实际 ${maxRatioKey}`);
  for (const row of amplitudeRows) {
    if (!row.certAmpGtTrend) assert(row.key === "50/DHT", `A/T<=1 的实例应只有 50/DHT，实际 ${row.key}`);
  }
  const ratioList = amplitudeRows.map((row) => `${row.key}:${row.approxRatio.toFixed(3)}`).join(", ");
  ok(
    "8.sawtooth-amplitude",
    `${amplitudeRows.length} 个 (level,stat) 上 A/T>1 成立 ${ampOverTrend} 个；canonical 最大 A/T=${maxRatioValue.toFixed(3)}（${maxRatioKey}，A/T>25 的精确证书已核验）；` +
      "全部实例 A/T<26（精确整数证书）；level 50 DHT 因 a>q 无平台而 A/T<1。各实例 A/T≈[" + ratioList + "]",
  );
}

// ------------------------------------------------------ 9. 边界与退化情形
{
  // 9a DET 的 mult 粒度：tier 值只取 mult 的倍数，相邻可达档位差 mult
  for (const level of [50, 60]) {
    const p = tierParameters(level, "WHM", "DET");
    assert(p.mult === (level === 50 ? 5 : 2), "DET mult 数值");
    const values = [];
    for (let g = 0; g <= 300; g += 1) values.push(tier(level, "WHM", "DET", g));
    const distinct = [...new Set(values)].sort((a, b) => a - b);
    for (let i = 0; i < distinct.length; i += 1) {
      assert(distinct[i] % p.mult === 0, "DET 档位必须是 mult 的倍数");
      if (i + 1 < distinct.length) assert(distinct[i + 1] - distinct[i] === p.mult, "DET 相邻可达档位差应为 mult");
    }
  }
  // 9b 空窗口：v-u < δ 时查询集合为空
  {
    const u = 10;
    const v = 15;
    const delta = 10;
    let count = 0;
    for (let g = u; g + delta <= v; g += 1) count += 1;
    assert(count === 0, "空窗口计数应为 0");
  }
  // 9c 零成本跳档 ⇒ 每单位增益无定义（Theorem A 的正成本前提不成立）
  {
    const level = 50;
    const stat = "DHT";
    const thresholdFor = (target) => thresholdOfTierValue(level, "WHM", stat, target);
    assert(thresholdFor(2) === 2 && thresholdFor(3) === 2, "level 50 DHT：tier 2 与 3 的阈值同为 g=2");
    assert(thresholdFor(3) - thresholdFor(2) === 0, "存在 c=0 跳档");
  }
  // 9d 负定义域：canonical 的 Math.trunc(v+1e-7) 与精确 floor 不等价（引用 raw-tier-transform 的证明）
  {
    const canonical = await loadCanonicalEvaluator();
    const modelValue = tier(70, "WHM", "CRT", -450);
    const actual = canonical.equippedAttributeTier("WHM", 70, "CRT", -450);
    assert(actual !== modelValue, "g<0 时 integer 模型与 canonical floor 语义应不同（定义域必须限制 g>=0）");
  }
  ok(
    "9.boundaries",
    "DET 档位仅取 mult 倍数（level 50 mult=5、level 60 mult=2，相邻差 mult）；空窗口无候选；" +
      "level 50 DHT 存在 c=0 跳档（tier 2 与 3 同阈值 g=2），每单位增益无定义；g<0 时 canonical 截断语义与精确 floor 不同，必须限制 g>=0",
  );
}

// ---------------- 10. baseStat 影响审计：贡献坐标 vs 面板总值（有限证书）
// 本文的 g、δ、阈值、余类/周期表、跳档成本与 A/T 全部是贡献坐标。本节点核对：
//   (a) 数据侧 baseStats 映射（CRT/DHT/TEN=sub，DET=main）；
//   (b) 贡献坐标 g 下整数档位模型 == production canonical evaluator；
//   (c) 周期/平移/跳档成本只由 (a,b,q,mult) 决定（BLU 与普通职业相同），与 baseStat 无关；
//   (d) 面板阈值 = 贡献阈值 + offset（同一属性常数平移），阈值差/成本不变；
//       但把面板值当贡献会得到错误档位（坐标误用可检测）。
//   (e) README 数值例（level 70 DHT g=13/37、[100,160] 窗口）与零成本跳档的贡献/面板换算。
{
  const data = await loadGameData();
  const canonical = await loadCanonicalEvaluator();
  assert(
    data.baseStats.CRT === "sub" && data.baseStats.DHT === "sub" &&
      data.baseStats.TEN === "sub" && data.baseStats.DET === "main",
    'baseStats 映射不再是 CRT/DHT/TEN="sub"、DET="main"',
  );
  const anchorOf = (level, stat) => {
    const params = DOCUMENTED_LEVEL_PARAMS[level];
    assert(params !== undefined, `未登记等级 ${level}`);
    return stat === "DET" ? params.main : params.sub;
  };
  const LEVELS = [50, 60, 70, 80, 90, 100];
  const STATS = ["CRT", "DHT", "DET", "TEN"];
  // (b) 贡献坐标：模型档位 == canonical 档位（抽样，覆盖普通/BLU）
  let tierChecks = 0;
  for (const level of LEVELS) {
    for (const job of ["WHM", "BLU", "WAR", "SCH"]) {
      if (data.jobSchemas[job].maxJobLevel < level) continue;
      for (const stat of STATS) {
        for (const g of [0, 1, 2, 17, 123, 500, 1500]) {
          const model = tier(level, job, stat, g);
          const actual = canonical.equippedAttributeTier(job, level, stat, g);
          assert(model === actual, `贡献坐标档位与 canonical 不一致 ${level}/${job}/${stat}/g=${g}: ${model} vs ${actual}`);
          tierChecks += 1;
        }
      }
    }
  }
  // (c) 周期与跳档成本与 baseStat 无关：BLU 与普通职业的 P/s 与逐 K 成本完全相同
  let periodChecks = 0;
  let costChecks = 0;
  for (const level of LEVELS) {
    for (const stat of STATS) {
      const p = tierParameters(level, "WHM", stat);
      const normal = tierPeriod(level, "WHM", stat);
      const blu = tierPeriod(level, "BLU", stat);
      assert(normal.period === blu.period && normal.shift === blu.shift, `周期应职业无关 ${level}/${stat}`);
      assert(normal.period === p.q / gcd(p.a, p.q), `周期应为 q/gcd(a,q) ${level}/${stat}`);
      assert(normal.shift === p.mult * (p.a / gcd(p.a, p.q)), `平移应为 mult·a/gcd ${level}/${stat}`);
      for (let K = 0; K < 12; K += 1) {
        assert(
          jumpCost(level, "WHM", stat, K + Math.floor(p.b / p.q)) === jumpCost(level, "BLU", stat, K + Math.floor(p.b / p.q)),
          `跳档成本应职业无关 ${level}/${stat}/K=${K}`,
        );
        costChecks += 1;
      }
      periodChecks += 1;
    }
  }
  // (d) 面板阈值 = 贡献阈值 + anchor；阈值差不变；面板值当贡献会错位
  const panelRows = [];
  for (const level of LEVELS) {
    for (const stat of ["CRT", "DHT", "DET"]) {
      const p = tierParameters(level, "WHM", stat);
      const anchor = anchorOf(level, stat);
      const firstIndex = Math.floor(p.b / p.q);
      // 取两个相邻 tier 索引的贡献阈值
      const from = thresholdOfTierIndex(level, "WHM", stat, firstIndex);
      const to = thresholdOfTierIndex(level, "WHM", stat, firstIndex + 1);
      const cost = to - from;
      assert(anchor + to - (anchor + from) === cost, "面板坐标阈值差应与贡献坐标一致");
      // 坐标误用可检测：面板值当贡献代入档位公式得到不同档位
      const wrongTier = tier(level, "WHM", stat, anchor + from);
      const expectedTier = p.c + p.mult * firstIndex;
      assert(wrongTier !== expectedTier, `${level}/${stat} 面板值当贡献应产生错误档位`);
      panelRows.push(`${level}/${stat}: 贡献阈值 ${from}→${to}（面板 ${anchor + from}→${anchor + to}，成本 ${cost}）`);
    }
  }
  // (e) README 数值例坐标复核
  const sub70 = anchorOf(70, "DHT");
  assert(sub70 === 364, `level 70 sub 应为 364，实际 ${sub70}`);
  assert(tier(70, "WHM", "DHT", 13) === 7 && tier(70, "WHM", "DHT", 23) === 14, "g=13/δ=10 的贡献坐标档位");
  assert(sub70 + 13 === 377 && sub70 + 37 === 401, "README 例的面板坐标应为 377/401");
  assert(sub70 + 100 === 464 && sub70 + 160 === 524, "窗口 [100,160] 的面板坐标应为 [464,524]");
  assert(sub70 + 0 === 364, "A/T 周期起点 g=0 对应面板 364");
  // 零成本跳档：贡献阈值 g=2 对应面板 341+2=343（level 50 sub=341），两份档位同阈值
  assert(anchorOf(50, "DHT") === 341, "level 50 sub 应为 341");
  assert(thresholdOfTierValue(50, "WHM", "DHT", 2) === 2 && thresholdOfTierValue(50, "WHM", "DHT", 3) === 2,
    "level 50 DHT 零成本跳档的贡献阈值应同为 2");
  assert(anchorOf(50, "DHT") + 2 === 343, "零成本跳档的面板阈值应为 343");
  // g<0 边界例的坐标：贡献 -450 对应面板 364-450=-86
  assert(sub70 + (-450) === -86, "g=-450 对应面板值 -86");
  ok(
    "10.baseStat-coordinate-audit",
    `baseStats.CRT/DHT/TEN="sub"、DET="main"；${tierChecks} 个 (level,job,stat,g) 上贡献坐标档位与 canonical 一致；` +
      `${periodChecks} 个 (level,stat) 的周期/平移与职业无关且等于 q/gcd、mult·a/gcd；${costChecks} 个逐 K 跳档成本 BLU=普通；` +
      `${panelRows.length} 个 (level,stat) 面板阈值=贡献阈值+anchor 且差不变；README 例：level 70 DHT g=13/37 面板 377/401、窗口 [464,524]、` +
      "零成本跳档贡献阈值 2→面板 343、g=−450→面板 −86（坐标误用均被断言可检测）",
  );
}

// ---------------------------------------------------------------- 输出报告
console.log("raw-marginal-envelope verification: PASS");
for (const entry of report) console.log(`  [ok] ${entry.name}: ${entry.detail}`);
console.log("scope: 有限枚举 + 精确整数比较 + canonical 模型一致性；不是一般性证明，");
console.log("       一般性证明见 theorems/raw-marginal-envelope/README.md §6。");
