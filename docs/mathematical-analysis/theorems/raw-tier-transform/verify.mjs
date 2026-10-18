/**
 * raw-tier-transform/verify.mjs
 *
 * 目的：为 theorems/raw-tier-transform/README.md 的定理 A 提供**有限域数值证书**。
 *
 * 覆盖范围（确定性、只读，不启动搜索/优化/MIP）：
 *   1) 归约前提的数据事实：baseStats/clanStats/statModifiers/jobLevelModifiers。
 *   2) 归约数值对照：全部支持等级 × 全部职业 × {CRT,DHT,DET,TEN} × g∈[0,500]，
 *      把整数模型 t(g)=c+mult*floor((ag+b)/q) 与生产 canonical evaluator 逐点对照。
 *   3) 截断等价证书：全部支持等级 × {WHM,BLU} × 四种属性 × g∈[0,20000] 逐点，
 *      复现生产代码的双精度表达式并核对 Math.trunc(v+1e-7)=精确 floor；
 *      另对每个实例的阈值邻域 g_k+{-2..2} 逐点核对。
 *   4) 定义域外稳健性：g<0 时 canonical 与精确 floor 不一致的显式证书（正式候选路径不可达）。
 *   5) 阈值公式（最小性）、跳档成本闭式、周期恒等式、单调性、因子正性。
 *   6) README 实例表与 issue 评论 2 的 13/14、5/6、19/20 交叉核对。
 *   7) baseStat 坐标审计（§13）：贡献坐标声明、档位实参最小值 V(0)、面板↔贡献换算、
 *      误用面板值的偏差证书。
 *
 * 证明作用：这些只是有限点上的证书；一般性证明（任意 g、任意 k）在 README 中给出。
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/raw-tier-transform/verify.mjs
 */
import {
  DOCUMENTED_LEVEL_PARAMS,
  assert,
  ceilDiv,
  criticalFactor,
  directHitFactor,
  determinationFactor,
  firstContributionWithTierAtLeast,
  floorDiv,
  gcd,
  loadCanonicalEvaluator,
  loadGameData,
  tier,
  tierParameters,
  tierPeriod,
} from "../../verification/canonical-model.mjs";

const LEVELS = [50, 60, 70, 80, 90, 100];
const STATS = ["CRT", "DHT", "DET", "TEN"];
const JOBS_WITH_BLU = ["WHM", "BLU"]; // WHM: 普通 b_C=350；BLU: b_C=150 且 CRT/DHT 档位 +200
const report = [];
function record(name, detail) {
  report.push({ name, detail });
}

const data = await loadGameData();
const canonical = await loadCanonicalEvaluator();
const jobs = Object.keys(data.jobSchemas);

// 本脚本对任意整数 k（含低于最小档位、阈值为负的情形）使用带符号的精确 ceil，
// 并把它与共享工具 firstContributionWithTierAtLeast 在全部 k 上交叉核对。
// 共享工具 verification/canonical-model.mjs 的 ceilDiv 现已正确处理负分子
// （BigInt 商向零截断：n<0 时商已是 ceil，n>0 且余数非零时 +1）；本地实现保留为独立复核。
function ceilDivSigned(numerator, denominator) {
  const n = BigInt(numerator);
  const q = BigInt(denominator);
  assert(q > 0n, "ceilDivSigned 分母必须为正");
  const quotient = n / q; // BigInt 除法向零截断：负分子时即为 ceil
  return Number(n < 0n ? quotient : n % q === 0n ? quotient : quotient + 1n);
}

// 定理 2 的闭式 g_k = ceil((n_k q - b)/a)，n_k = ceil((k-c)/mult)；对任意整数 k 成立。
function thresholdG(level, job, stat, k) {
  const { a, b, q, c, mult } = tierParameters(level, job, stat);
  const n = ceilDivSigned(k - c, mult);
  return ceilDivSigned(n * q - b, a);
}

// ---------------------------------------------------------- 1. 归约前提的数据事实
assert(
  data.baseStats.CRT === "sub" && data.baseStats.DHT === "sub" && data.baseStats.TEN === "sub",
  "baseStats.CRT/DHT/TEN 不再是 sub",
);
assert(data.baseStats.DET === "main", "baseStats.DET 不再是 main");
const freeStats = ["CRT", "DHT", "DET", "TEN"];
assert(
  freeStats.every((stat) => data.clanStats[stat] === undefined),
  "clanStats 出现了 CRT/DHT/DET/TEN 键：基础属性归约需重新证明",
);
for (const job of jobs) {
  const schema = data.jobSchemas[job];
  for (const stat of freeStats) {
    assert(
      schema.statModifiers[stat] === undefined,
      `职业 ${job} 的 statModifiers 出现了 ${stat} 键：基础属性归约需重新证明`,
    );
  }
  for (const stat of ["CRT", "DHT", "DET"]) {
    assert(
      schema.stats.includes(stat),
      `职业 ${job} 的 stats 不再包含 ${stat}：getBaseStats 归约需重新证明`,
    );
  }
  assert(
    LEVELS.includes(schema.maxJobLevel),
    `职业 ${job} 的上限等级 ${schema.maxJobLevel} 不在支持集合内`,
  );
}
record(
  "data-facts",
  `${jobs.length} 个职业：baseStats 映射成立，statModifiers/clanStats 均无 ${freeStats.join("/")} 键；` +
    "CRT/DHT/DET 在所有职业 stats 中（TEN 由 getBaseStats 默认值覆盖）",
);

// 等级参数表与文档一致
const levelKeys = Object.keys(data.jobLevelModifiers).map(Number).sort((a, b) => a - b);
assert(
  levelKeys.join(",") === LEVELS.join(","),
  `支持等级集合变化：${levelKeys} vs ${LEVELS}`,
);
for (const level of LEVELS) {
  for (const key of ["main", "sub", "div", "det", "detTrunc"]) {
    assert(
      data.jobLevelModifiers[level][key] === DOCUMENTED_LEVEL_PARAMS[level][key],
      `等级 ${level} 的 ${key} 与文档不一致`,
    );
  }
}
record("level-parameters", "6 个等级的 main/sub/div/det/detTrunc 与文档表一致");

// ------------------------------------------------- 2. 归约数值对照（有限证书）
let reductionChecks = 0;
for (const level of LEVELS) {
  for (const job of jobs) {
    for (const stat of STATS) {
      for (let g = 0; g <= 500; g += 1) {
        assert(
          tier(level, job, stat, g) === canonical.equippedAttributeTier(job, level, stat, g),
          `归约/模型不一致 ${level}/${job}/${stat}/g=${g}`,
        );
        reductionChecks += 1;
      }
    }
  }
}
record(
  "canonical-reduction",
  `${reductionChecks} 个 (level,job,stat,g) 的整数模型与 canonical evaluator 一致（g∈[0,500]）`,
);

// --------------------------------------------- 3. 截断等价证书（双精度路径）
const U = 2 ** -52; // 宽松的 binary64 相对误差上界（2 倍 unit roundoff）
function doubleFloorArgument(level, job, stat, g) {
  const p = tierParameters(level, job, stat);
  if (stat === "DET") {
    const { det, detTrunc } = DOCUMENTED_LEVEL_PARAMS[level];
    return ((140 * g) / det + 1000) / detTrunc;
  }
  // 生产代码：a*(value-sub)/q + c，value-sub = g（归约后）
  return (p.a * g) / p.q + p.c;
}
let truncChecks = 0;
let maxObservedError = 0;
const truncMismatch = [];
for (const level of LEVELS) {
  for (const job of JOBS_WITH_BLU) {
    for (const stat of STATS) {
      const p = tierParameters(level, job, stat);
      const exactFloorAt = (g) => floorDiv(p.a * g + p.b, p.q) * p.mult + p.c;
      for (let g = 0; g <= 20000; g += 1) {
        const fl = doubleFloorArgument(level, job, stat, g);
        // 仅用于观测误差；判定使用精确整数 floor。
        const exactValue = (p.a * g + p.b) / p.q + (stat === "DET" ? 0 : p.c);
        maxObservedError = Math.max(maxObservedError, Math.abs(fl - exactValue));
        const truncated = Math.trunc(fl + 1e-7);
        // DET 的 detTrunc 在 canonical 的 floor 之外乘回；统一模型把它记为 mult。
        const modeled = stat === "DET" ? p.mult * truncated : truncated;
        if (modeled !== exactFloorAt(g)) {
          truncMismatch.push({ level, job, stat, g, fl, truncated, expected: exactFloorAt(g) });
          if (truncMismatch.length > 8) break;
        }
        truncChecks += 1;
      }
    }
  }
}
assert(
  truncMismatch.length === 0,
  `截断等价失败样例：${JSON.stringify(truncMismatch.slice(0, 5))}`,
);
assert(maxObservedError < 1e-8, `观测到的双精度误差 ${maxObservedError} 超过 1e-8`);
record(
  "trunc-equivalence",
  `${truncChecks} 个 (level,job,stat,g) 点满足 Math.trunc(fl+1e-7)=精确 floor（g∈[0,20000]，观测最大误差 ${maxObservedError.toExponential(3)}）`,
);

// 阈值邻域逐点核对（含分数部分接近 1 的困难点）
let boundaryChecks = 0;
for (const level of LEVELS) {
  for (const job of JOBS_WITH_BLU) {
    for (const stat of STATS) {
      const p = tierParameters(level, job, stat);
      const t0 = tier(level, job, stat, 0);
      for (let offset = -2; offset <= 60; offset += 1) {
        const k = t0 + offset * p.mult;
        const gk = firstContributionWithTierAtLeast(level, job, stat, k);
        if (gk < 0) continue;
        for (let delta = -2; delta <= 2; delta += 1) {
          const g = gk + delta;
          if (g < 0) continue;
          assert(
            canonical.equippedAttributeTier(job, level, stat, g) ===
              tier(level, job, stat, g),
            `阈值邻域截断不一致 ${level}/${job}/${stat}/g=${g}`,
          );
          boundaryChecks += 1;
        }
      }
    }
  }
}
record("threshold-boundaries", `${boundaryChecks} 个阈值邻域点 canonical 与精确模型一致`);

// ----------------------------------------- 4. 定义域外 g<0 的截断差异（稳健性证书）
const negativeCases = [
  { level: 70, job: "WHM", stat: "CRT", g: -450, expectedCanonical: -49, expectedFloor: -50 },
  { level: 70, job: "WHM", stat: "CRT", g: -1000, expectedCanonical: -172, expectedFloor: -173 },
  { level: 70, job: "WHM", stat: "DHT", g: -1, expectedCanonical: 0, expectedFloor: -1 },
];
for (const item of negativeCases) {
  const p = tierParameters(item.level, item.job, item.stat);
  const exactFloor = floorDiv(p.a * item.g + p.b, p.q) * p.mult + p.c;
  const actualCanonical = canonical.equippedAttributeTier(
    item.job,
    item.level,
    item.stat,
    item.g,
  );
  assert(actualCanonical === item.expectedCanonical, `定义域外反例 canonical 值变化：${JSON.stringify(item)}`);
  assert(exactFloor === item.expectedFloor, `定义域外反例精确 floor 值变化：${JSON.stringify(item)}`);
  assert(
    actualCanonical !== exactFloor,
    `定义域外反例失效（canonical 与精确 floor 相等）：${JSON.stringify(item)}`,
  );
}
record(
  "out-of-domain-truncation-difference",
  "g<0（正式候选路径不可达）时 canonical 与精确 floor 不一致的显式证书（L70 CRT g=-450: -49 vs -50 等）",
);

// --------------------------------------------------- 5. 阈值、跳档成本、周期恒等式
let thresholdChecks = 0;
let costChecks = 0;
for (const level of LEVELS) {
  for (const job of JOBS_WITH_BLU) {
    for (const stat of STATS) {
      const p = tierParameters(level, job, stat);
      const { period, shift, divisor } = tierPeriod(level, job, stat);
      assert(period === p.q / divisor && shift === (p.mult * p.a) / divisor, "周期参数不一致");
      assert(gcd(p.a, p.q) === divisor, "gcd 参数不一致");
      const minCost = floorDiv(p.q, p.a);
      const maxCost = ceilDiv(p.q, p.a);
      const t0 = tier(level, job, stat, 0);
      for (let offset = -20; offset <= 200; offset += 1) {
        const k = t0 + offset * p.mult;
        const gk = thresholdG(level, job, stat, k);
        const gkNext = thresholdG(level, job, stat, k + p.mult);
        // 与共享工具 firstContributionWithTierAtLeast 交叉核对（含 k 低于最小档位、阈值为负的情形；
        // 共享 ceilDiv 已修复负分子语义，两边应在全部 k 上一致）。
        assert(
          firstContributionWithTierAtLeast(level, job, stat, k) === gk,
          `阈值与共享工具不一致 ${level}/${job}/${stat}/k=${k}`,
        );
        // 最小性（不截断到 0 的整数公式，k 与 g_k 均可为负）
        assert(tier(level, job, stat, gk) >= k, `阈值不满足 t(g_k)>=k ${level}/${job}/${stat}/k=${k}`);
        assert(
          tier(level, job, stat, gk - 1) < k,
          `阈值不是最小 ${level}/${job}/${stat}/k=${k}`,
        );
        // 截断到非负域后的最小性
        const gkDomain = Math.max(0, gk);
        assert(tier(level, job, stat, gkDomain) >= k, `域内阈值不满足 ${level}/${job}/${stat}/k=${k}`);
        assert(
          gkDomain === 0 || tier(level, job, stat, gkDomain - 1) < k,
          `域内阈值不是最小 ${level}/${job}/${stat}/k=${k}`,
        );
        // 跳档成本闭式
        // k = c + mult*(floor(b/q)+offset) => n_k = ceil((k-c)/mult) = floor(b/q) + offset
        const n = floorDiv(p.b, p.q) + offset;
        const s = (((n * p.q - p.b + p.a - 1) % p.a) + p.a) % p.a;
        const predicted = floorDiv(p.q, p.a) + (s + (p.q % p.a) >= p.a ? 1 : 0);
        const actual = gkNext - gk;
        assert(
          actual === predicted,
          `跳档成本闭式失败 ${level}/${job}/${stat}/k=${k}: 实际 ${actual} vs ${predicted}`,
        );
        assert(actual >= minCost && actual <= maxCost, `跳档成本越界 ${level}/${job}/${stat}`);
        thresholdChecks += 1;
        costChecks += 1;
      }
      // 周期恒等式（含负 g，验证是全整数恒等式）
      for (let g = -1000; g <= 3000; g += 1) {
        assert(
          tier(level, job, stat, g + period) === tier(level, job, stat, g) + shift,
          `周期恒等式失败 ${level}/${job}/${stat}/g=${g}`,
        );
      }
      // 阈值周期：g_{k+shift} = g_k + P（未截断的整数公式）
      for (let offset = -10; offset <= 100; offset += 1) {
        const k = t0 + offset * p.mult;
        assert(
          thresholdG(level, job, stat, k + shift) === thresholdG(level, job, stat, k) + period,
          `阈值周期失败 ${level}/${job}/${stat}/k=${k}`,
        );
      }
      // 跳档成本周期：c_{k+shift} = c_k
      for (let offset = -10; offset <= 100; offset += 1) {
        const k = t0 + offset * p.mult;
        const costAt = (kk) =>
          thresholdG(level, job, stat, kk + p.mult) - thresholdG(level, job, stat, kk);
        assert(costAt(k + shift) === costAt(k), `跳档成本周期失败 ${level}/${job}/${stat}/k=${k}`);
      }
      // 余数周期：r(g+P)=r(g)
      for (let g = -500; g <= 1500; g += 1) {
        const residue = (x) => (((p.a * x + p.b) % p.q) + p.q) % p.q;
        assert(residue(g + period) === residue(g), `余数周期失败 ${level}/${job}/${stat}/g=${g}`);
      }
    }
  }
}
record("thresholds", `${thresholdChecks} 个 (level,job,stat,k) 的阈值最小性与域内截断成立`);
record("jump-costs", `${costChecks} 个跳档成本满足闭式 c_k=floor(q/a)+[s+(q mod a)>=a] 且落在 {floor,ceil}`);
record("periodicity", "周期恒等式 t(g+P)=t(g)+shift、g_{k+shift}=g_k+P、跳档成本/余数周期全部成立");

// --------------------------------------------------- 6. 单调性、因子正性、实例表交叉核对
let monotoneChecks = 0;
let factorChecks = 0;
for (const level of LEVELS) {
  for (const job of JOBS_WITH_BLU) {
    for (const stat of STATS) {
      const p = tierParameters(level, job, stat);
      const tierSeq = (g) => tier(level, job, stat, g);
      for (let g = 0; g <= 3000; g += 1) {
        assert(tierSeq(g + 1) >= tierSeq(g), `档位非单调 ${level}/${job}/${stat}/g=${g}`);
        monotoneChecks += 1;
      }
      for (let g = 0; g <= 3000; g += 1) {
        const t = tierSeq(g);
        if (stat === "CRT") assert(criticalFactor(t, job) > 0, "CRT 因子非正");
        if (stat === "DHT") assert(directHitFactor(t) > 0, "DHT 因子非正");
        if (stat === "DET") assert(determinationFactor(t) > 0, "DET 因子非正");
        factorChecks += 1;
      }
      // 文档界：CRT>=50/250、DHT>=0/200、DET>=1000、TEN>=1000
      const t0 = tierSeq(0);
      if (stat === "CRT") assert(t0 === (job === "BLU" ? 250 : 50), `CRT t(0) 变化 ${level}/${job}`);
      if (stat === "DHT") assert(t0 === (job === "BLU" ? 200 : 0), `DHT t(0) 变化 ${level}/${job}`);
      if (stat === "DET") assert(t0 === 1000, `DET t(0) 变化 ${level}`);
      if (stat === "TEN") assert(t0 === 1000, `TEN t(0) 变化 ${level}`);
      // DET 档位粒度
      if (stat === "DET") {
        for (let g = 0; g <= 3000; g += 1) {
          assert(tierSeq(g) % p.mult === 0, `DET 档位不是 ${p.mult} 的倍数`);
        }
      }
    }
  }
}
record("monotonicity-and-positivity", `${monotoneChecks} 个相邻原始点非减；${factorChecks} 个因子点为正`);
record("tier-baselines", "t(0) 与 canonical-evaluator-reference.md §5 的档位下界一致（BLU 偏移正确）");

// README 实例表交叉核对（含 issue 评论 2 提到的 13/14、5/6、19/20）
const expectedCostRange = {
  "100/CRT": [13, 14],
  "100/DHT": [5, 6],
  "100/DET": [19, 20],
};
for (const [key, [min, max]] of Object.entries(expectedCostRange)) {
  const [levelText, stat] = key.split("/");
  const level = Number(levelText);
  const p = tierParameters(level, "WHM", stat);
  assert(floorDiv(p.q, p.a) === min && ceilDiv(p.q, p.a) === max, `L100 ${stat} 跳档成本区间不符`);
}
record("issue-cross-check", "L100 的 13/14、5/6、19/20 跳档成本区间与 issue 评论 2 一致");

// ------------------------------- 8. baseStat 坐标审计（贡献坐标 vs 面板总值，README §13）
// 8a) 坐标声明：本脚本全部循环输入 g 都是**贡献坐标**（gearAndFoodValue），阈值 g_k、G_max 同理；
//     面板总值 X = 基础属性(sub/main) + g（参考模型 §2.1）。生产 equippedAttributeTier 的第四参数
//     也是贡献（README A6），本脚本对 canonical 的调用一律传贡献。
// 8b) 档位实参最小值 V(0) = b/q + c >= 0：精确有理数核对结构性下界（参考模型 §2.2 / Lemma 4.3b）。
let argumentChecks = 0;
for (const level of LEVELS) {
  for (const job of JOBS_WITH_BLU) {
    for (const stat of STATS) {
      const { a, b, q, c, mult } = tierParameters(level, job, stat);
      assert(a > 0 && q > 0, `档位参数非正：${level}/${job}/${stat}`);
      const numerator = BigInt(b) + BigInt(c) * BigInt(q);
      assert(numerator >= 0n, `档位实参最小值 V(0) < 0：${level}/${job}/${stat}`);
      const blu = job === "BLU";
      if (stat === "CRT") {
        assert(numerator === BigInt(blu ? 250 : 50) * BigInt(q), `CRT V(0) 边界不符 ${level}/${job}`);
      } else if (stat === "DHT") {
        assert(numerator === BigInt(blu ? 200 : 0) * BigInt(q), `DHT V(0) 边界不符 ${level}/${job}`);
      } else if (stat === "TEN") {
        assert(numerator === 1000n * BigInt(q), `TEN V(0) 边界不符 ${level}/${job}`);
      } else {
        // DET: V(0) = (1000·det)/(det·detTrunc) = 1000/detTrunc，detTrunc∈{1,2,5} ⇒ >= 200
        assert(numerator * BigInt(mult) === 1000n * BigInt(q), `DET V(0) 表达式不符 ${level}`);
        assert(numerator >= 200n * BigInt(q), `DET V(0) < 200 ${level}`);
      }
      argumentChecks += 1;
    }
  }
}
record(
  "coordinate-audit-argument-minimum",
  `${argumentChecks} 个 (level,job,stat) 的档位实参 V(0)=b/q+c 满足结构性下界（CRT 50/250、DHT 0/200、DET>=200、TEN 1000），因此 g>=0 时 V>=0`,
);

// 8c) 面板↔贡献换算：参考模型 §2.1 的 L70 示例（评论 01 的面板值）。
{
  const { main, sub } = DOCUMENTED_LEVEL_PARAMS[70];
  const panels = { CRT: 739, DHT: 743, DET: 769 };
  const contributions = { CRT: panels.CRT - sub, DHT: panels.DHT - sub, DET: panels.DET - main };
  assert(contributions.CRT === 375 && contributions.DHT === 379 && contributions.DET === 477, "L70 面板→贡献换算不符");
  assert(tier(70, "WHM", "CRT", contributions.CRT) === 133, "L70 CRT 贡献档位不符");
  assert(tier(70, "WHM", "DHT", contributions.DHT) === 231, "L70 DHT 贡献档位不符");
  assert(tier(70, "WHM", "DET", contributions.DET) === 1074, "L70 DET 贡献档位不符");
  // 生产 evaluator 同样以贡献为输入：传贡献得到同一档位。
  assert(canonical.equippedAttributeTier("WHM", 70, "CRT", contributions.CRT) === 133, "canonical L70 CRT");
  assert(canonical.equippedAttributeTier("WHM", 70, "DHT", contributions.DHT) === 231, "canonical L70 DHT");
  assert(canonical.equippedAttributeTier("WHM", 70, "DET", contributions.DET) === 1074, "canonical L70 DET");
  record(
    "coordinate-audit-panel-conversion",
    "参考模型 §2.1 示例复核：面板 CRT/DHT/DET=739/743/769 ⇒ 贡献 375/379/477 ⇒ 档位 133/231/1074（面板 = 贡献 + sub/main）",
  );
}

// 8d) 误用面板值（把面板值当贡献传入）的偏差证书：说明外部必须先减 sub/main。
{
  const misuseRows = [];
  for (const level of LEVELS) {
    const { sub, div } = DOCUMENTED_LEVEL_PARAMS[level];
    const g808 = firstContributionWithTierAtLeast(level, "WHM", "CRT", 808);
    const panelValue = sub + g808; // 把面板值直接当贡献
    const wrongTier = tier(level, "WHM", "CRT", panelValue);
    assert(wrongTier > 808, `误用面板值应偏高 ${level}`);
    assert(tier(level, "WHM", "CRT", panelValue - sub) === 808, `正确换算应回到 808 ${level}`);
    misuseRows.push(`${level}: g_808=${g808}, 面板=${panelValue}, 误代=${wrongTier}(+${wrongTier - 808})`);
    // 文档 §13.4 的三个精确值
    if (level === 50) assert(wrongTier === 1008, "L50 误用面板值偏差不符");
    if (level === 70) assert(wrongTier === 888, "L70 误用面板值偏差不符");
    if (level === 100) assert(wrongTier === 838, "L100 误用面板值偏差不符");
  }
  record("coordinate-audit-panel-misuse", `误用面板值的偏差证书（g_808 为贡献）：${misuseRows.join("；")}`);
}

// ---------------------------------------------------------------- 输出报告
console.log("raw-tier-transform verification: PASS");
for (const entry of report) console.log(`  [ok] ${entry.name}: ${entry.detail}`);
console.log(
  "scope: 全部支持等级 × {" + JOBS_WITH_BLU.join(",") + "} × {CRT,DHT,DET,TEN} 的有限点证书；" +
    "负值反例与跳档/阈值/周期恒等式均在本脚本覆盖。",
);
console.log("这不是一般性证明；一般性证明见同目录 README.md 的 §5-§7。");
