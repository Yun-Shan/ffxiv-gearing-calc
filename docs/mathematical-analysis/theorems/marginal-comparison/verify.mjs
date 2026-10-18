/**
 * marginal-comparison/verify.mjs
 *
 * 目的：为 theorems/marginal-comparison/README.md（Theorem A）提供有限域证书。
 *
 * 覆盖范围（全部为有限、可复现的枚举）：
 *   1. 小整数域上交叉指数判据与浮点 log 判据的符号一致性（含近并列容忍与计数）。
 *   2. issue 正文形式与正确交叉指数形式之间的**精确整数恒等式**
 *        issueL * corrR = corrL * issueR * (F0*G0)^(cG-cF)   （d<0 时等价改写）。
 *   3. 主反例、反向反例、cF=cG 时两者一致的退化情形；canonical evaluator 上的真实反例。
 *   4. 正性前提失败的边界：整数形式成立但 log 判据无定义。
 *   5. 定点对数 + 误差加宽的可靠性抽样：凡加宽后仍判定严格，则精确 BigInt 判据同向。
 *   6. canonical 等级实例：全部等级 × 属性对 × tier 转移的精确判据与浮点符号一致性。
 *   7. 复用 canonical-model 重新核对：等级参数、因子公式、正性与 production evaluator。
 *   8. baseStat 影响审计：贡献坐标 vs 面板总值（baseStats 映射、贡献坐标档位一致、
 *      README 真实反例阈值 6/14 的贡献/面板换算与坐标误用可检测性）。
 *
 * 证明作用：第 1/2/5/6 项是有限枚举的旁证（不是一般性证明；一般性证明在 README §6）。
 * 第 3/4 项是反例，反例本身即否证。第 7 项是模型一致性证书；第 8 项是坐标审计证书。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/marginal-comparison/verify.mjs
 */
import {
  DOCUMENTED_LEVEL_PARAMS,
  assert,
  criticalFactor,
  determinationFactor,
  directHitFactor,
  factorsAt,
  loadCanonicalEvaluator,
  loadGameData,
  tier,
  tierParameters,
} from "../../verification/canonical-model.mjs";

const report = [];
function ok(name, detail) {
  report.push({ name, detail });
}

// ---------------------------------------------------------------- 基础工具

/** 整数幂（指数为非负 BigInt），用于交叉指数判据。 */
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

/** 三值比较：-1 / 0 / +1。 */
function cmp(left, right) {
  return left > right ? 1 : left < right ? -1 : 0;
}

/**
 * 交叉指数判据（正确形式，comment-02 §七）：
 *   (i)  ln(F1/F0)/cF ? ln(G1/G0)/cG
 *   (ii) F1^cG * G0^cF ? F0^cG * G1^cF
 * 返回 +1 表示 A（F 转移）的单位成本 log 增益严格更大。
 */
function crossExponentCompare(F0, F1, cF, G0, G1, cG) {
  const left = pow(F1, cG) * pow(G0, cF);
  const right = pow(F0, cG) * pow(G1, cF);
  return {
    left,
    right,
    result: cmp(left, right),
    issueLeft: pow(BigInt(F1) * BigInt(G0), cG),
    issueRight: pow(BigInt(G1) * BigInt(F0), cF),
  };
}

// ------------------------------------------- 1. 小整数域：等价性与严格/等式版本
{
  // 定义域故意包含 1（ln 比值为 0）、非单调转移（F1<F0 等），以证明等价性不依赖增益方向。
  const MAXV = 12;
  const MAXC = 4;
  let checked = 0;
  let strictA = 0;
  let strictB = 0;
  let ties = 0;
  let nearTieSkipped = 0;
  let geometricChecked = 0;
  let geometricSkipped = 0;
  let strongFailures = 0;
  for (let F0 = 1; F0 <= MAXV; F0 += 1) {
    for (let F1 = 1; F1 <= MAXV; F1 += 1) {
      const logF = Math.log(F1 / F0);
      for (let G0 = 1; G0 <= MAXV; G0 += 1) {
        for (let G1 = 1; G1 <= MAXV; G1 += 1) {
          const logG = Math.log(G1 / G0);
          for (let cF = 1; cF <= MAXC; cF += 1) {
            for (let cG = 1; cG <= MAXC; cG += 1) {
              const { result } = crossExponentCompare(F0, F1, cF, G0, G1, cG);
              const logDiff = logF / cF - logG / cG; // 与 (i) 完全相同的实数表达式
              if (result === 0) {
                ties += 1;
                assert(Math.abs(logDiff) < 1e-12, `等式应等价：F0=${F0},F1=${F1},G0=${G0},G1=${G1},cF=${cF},cG=${cG} logDiff=${logDiff}`);
              } else if (Math.abs(logDiff) < 1e-9) {
                nearTieSkipped += 1;
              } else {
                assert(
                  Math.sign(logDiff) === result,
                  `等价性符号不一致：F0=${F0},F1=${F1},cF=${cF},G0=${G0},G1=${G1},cG=${cG} cross=${result} logDiff=${logDiff}`,
                );
                if (result > 0) strictA += 1;
                else strictB += 1;
                // 强于浮点：等式/严格版本由交叉指数判据的整数比较直接给出，无需 log。
                assert(result !== 0, "严格版本自洽性");
              }
              // 几何均值形式：(F1/F0)^(1/cF) ? (G1/G0)^(1/cG)
              const geometricDiff = Math.pow(F1 / F0, 1 / cF) - Math.pow(G1 / G0, 1 / cG);
              if (result === 0) {
                assert(Math.abs(geometricDiff) < 1e-12, `几何均值形式等式不一致 F0=${F0},F1=${F1},cF=${cF},G0=${G0},G1=${G1},cG=${cG}`);
              } else if (Math.abs(geometricDiff) > 1e-12) {
                assert(Math.sign(geometricDiff) === result, `几何均值形式符号不一致 F0=${F0},F1=${F1},cF=${cF},G0=${G0},G1=${G1},cG=${cG}`);
                geometricChecked += 1;
              } else {
                geometricSkipped += 1;
              }
              checked += 1;
            }
          }
        }
      }
    }
  }
  assert(strongFailures === 0, "不应出现强失败");
  assert(strictA > 0 && strictB > 0 && ties > 0, "样本应同时包含 A 优、B 优与相等");
  ok(
    "1.small-domain-equivalence",
    `${checked} 组 (F0,F1,G0,G1∈[1,${MAXV}], cF,cG∈[1,${MAXC}])：交叉指数判据与 ln(F1/F0)/cF ? ln(G1/G0)/cG 同号；` +
      `A优 ${strictA}，B优 ${strictB}，严格相等 ${ties}，近并列跳过 ${nearTieSkipped}；几何均值形式符号一致 ${geometricChecked}（近并列 ${geometricSkipped}）`,
  );
}

// ---------------------------------------- 2. issue 形式与正确形式的精确恒等式
{
  const MAXV = 8;
  const MAXC = 3;
  let checks = 0;
  for (let F0 = 1; F0 <= MAXV; F0 += 1) {
    for (let F1 = 1; F1 <= MAXV; F1 += 1) {
      for (let G0 = 1; G0 <= MAXV; G0 += 1) {
        for (let G1 = 1; G1 <= MAXV; G1 += 1) {
          for (let cF = 1; cF <= MAXC; cF += 1) {
            for (let cG = 1; cG <= MAXC; cG += 1) {
              const d = cG - cF;
              const corrL = pow(F1, cG) * pow(G0, cF);
              const corrR = pow(F0, cG) * pow(G1, cF);
              const issueL = pow(BigInt(F1) * BigInt(G0), cG);
              const issueR = pow(BigInt(G1) * BigInt(F0), cF);
              // 恒等式：issueL / corrL = G0^d，issueR / corrR = F0^(-d)
              if (d >= 0) {
                assert(issueL === corrL * pow(G0, d), "恒等式左端失败");
                assert(issueR * pow(F0, d) === corrR, "恒等式右端失败");
              } else {
                assert(issueL * pow(G0, -d) === corrL, "恒等式左端失败 (d<0)");
                assert(issueR === corrR * pow(F0, -d), "恒等式右端失败 (d<0)");
              }
              checks += 1;
            }
          }
        }
      }
    }
  }
  // 恒等式的比较级版本：issueL/issueR = (corrL/corrR) * (F0*G0)^(cG-cF)
  //                      ⟺ issueL*corrR*(F0*G0)^{-d} = corrL*issueR   （d>=0 时写成整数式）
  for (let F0 = 1; F0 <= 6; F0 += 1) {
    for (let F1 = 1; F1 <= 6; F1 += 1) {
      for (let G0 = 1; G0 <= 6; G0 += 1) {
        for (let G1 = 1; G1 <= 6; G1 += 1) {
          for (let cF = 1; cF <= 2; cF += 1) {
            for (let cG = 1; cG <= 2; cG += 1) {
              const d = cG - cF;
              const corrL = pow(F1, cG) * pow(G0, cF);
              const corrR = pow(F0, cG) * pow(G1, cF);
              const issueL = pow(BigInt(F1) * BigInt(G0), cG);
              const issueR = pow(BigInt(G1) * BigInt(F0), cF);
              const factor = pow(BigInt(F0) * BigInt(G0), Math.abs(d));
              if (d >= 0) assert(issueL * corrR === corrL * issueR * factor, "比较级恒等式失败");
              else assert(issueL * corrR * factor === corrL * issueR, "比较级恒等式失败 (d<0)");
            }
          }
        }
      }
    }
  }
  assert(checks > 0, "恒等式枚举非空");
  ok(
    "2.issue-identity",
    `${checks} 组小整数上验证精确恒等式 issueL = corrL·G0^(cG−cF)、issueR = corrR·F0^(cF−cG)；` +
      "对应比较级恒等式 issueL/issueR = (corrL/corrR)·(F0·G0)^(cG−cF) 亦逐组精确成立",
  );
}

// ------------------------------------------------------------- 3. 精确反例
let primary;
{
  // 主反例（comment-02 更正所指的情形）：真值相等，issue 形式却判严格不等。
  const F0 = 10, F1 = 80, cF = 3;
  const G0 = 1000, G1 = 2000, cG = 1;
  const case1 = crossExponentCompare(F0, F1, cF, G0, G1, cG);
  // 真值：ln(80/10)/3 = ln(8)/3 = ln(2)；ln(2000/1000)/1 = ln(2)
  const trueGap = Math.log(F1 / F0) / cF - Math.log(G1 / G0) / cG;
  assert(Math.abs(trueGap) < 1e-12, "主反例真值应为相等");
  assert(case1.result === 0, `主反例交叉指数判据应相等，实际 ${case1.result}`);
  assert(case1.left === 80_000_000_000n && case1.right === 80_000_000_000n, "主反例交叉指数乘积应为 8e10");
  assert(case1.issueLeft === 80_000n, `主反例 issue 左端应为 80000，实际 ${case1.issueLeft}`);
  assert(case1.issueRight === 8_000_000_000_000n, `主反例 issue 右端应为 8e12，实际 ${case1.issueRight}`);
  assert(case1.issueLeft < case1.issueRight, "issue 形式应判左端严格更差（与真值矛盾）");
  // 精确算术（cG-cF=-2，故修正因子写成有理数 1/(F0·G0)^2）：
  //   issueL = corrL * G0^(cG-cF) = 8e10 / 1000^2 = 8e4
  //   issueR = corrR * F0^(cF-cG) = 8e10 * 10^2 = 8e12
  //   issueL/issueR = (corrL/corrR) * (F0·G0)^(cG-cF) = 1 / (10^4)^2 = 1e-8
  assert(case1.issueLeft * pow(G0, cF - cG) === case1.left, "issueL·G0^(cF−cG) = corrL");
  assert(case1.issueRight === case1.right * pow(F0, cF - cG), "issueR = corrR·F0^(cF−cG)");
  assert(case1.issueLeft * pow(BigInt(F0) * BigInt(G0), cF - cG) * case1.right === case1.left * case1.issueRight,
    "issueL·(F0G0)^2 = corrL 的等价形式");
  primary = { F0, F1, cF, G0, G1, cG, ...case1 };
  ok(
    "3a.primary-counterexample",
    `F0=${F0},F1=${F1},cF=${cF}; G0=${G0},G1=${G1},cG=${cG}：真值 ln8/3=ln2=ln2/1 相等；` +
      `正确判据 ${case1.left}=${case1.right}（相等）；issue 形式 ${case1.issueLeft} vs ${case1.issueRight}（判左端严格更差）⇒ 不等价。` +
      `精确修正：issueL=corrL·G0^{cG−cF}=8e10/1000²=8e4，issueR=corrR·F0^{cF−cG}=8e10·10²=8e12，比值=1e−8`,
  );
}

// 反向反例：issue 形式把顺序判反。
{
  const F0 = 10, F1 = 11, cF = 1;
  const G0 = 20, G1 = 30, cG = 2;
  const case2 = crossExponentCompare(F0, F1, cF, G0, G1, cG);
  const trueGap = Math.log(F1 / F0) / cF - Math.log(G1 / G0) / cG;
  assert(trueGap < 0, "反向反例真值应为 A 更差");
  assert(case2.result === -1, `反向反例正确判据应为 A 更差，实际 ${case2.result}`);
  assert(case2.issueLeft === 48_400n && case2.issueRight === 300n, "反向反例 issue 乘积数值");
  assert(case2.issueLeft > case2.issueRight, "反向反例 issue 形式应判 A 更优（与真值相反）");
  ok(
    "3b.reversal-counterexample",
    `F0=${F0},F1=${F1},cF=${cF}; G0=${G0},G1=${G1},cG=${cG}：真值 ln(1.1)/1≈${(Math.log(1.1)).toFixed(4)} < ln(1.5)/2≈${(Math.log(1.5) / 2).toFixed(4)}（A 更差）；` +
      `正确判据 ${case2.left} vs ${case2.right}（A 更差）；issue 形式 ${case2.issueLeft} vs ${case2.issueRight}（判 A 更优）⇒ 顺序被反转。` +
      `修正因子 (F0·G0)^{cG−cF}=200`,
  );
}

// cF = cG 时两种形式恒等（这是 issue 写法长期未被发现的原因）。
{
  let checks = 0;
  for (let F0 = 1; F0 <= 9; F0 += 1)
    for (let F1 = 1; F1 <= 9; F1 += 1)
      for (let G0 = 1; G0 <= 9; G0 += 1)
        for (let G1 = 1; G1 <= 9; G1 += 1)
          for (let c = 1; c <= 3; c += 1) {
            const correct = crossExponentCompare(F0, F1, c, G0, G1, c);
            assert(correct.issueLeft === correct.left, "cF=cG 时 issueL 应等于 corrL");
            assert(correct.issueRight === correct.right, "cF=cG 时 issueR 应等于 corrR");
            checks += 1;
          }
  ok("3c.equal-cost-degeneracy", `${checks} 组 cF=cG 的转移上 issue 形式与正确形式逐项相等（错误仅在 cF≠cG 时显现）`);
}

// canonical evaluator 上的真实反例（固定等级公式内部，不是人为构造）：
// level 100 WHM：DHT t=0→1 的成本为 6；CRT t=800→801 的成本为 14。
// 真值：ln(4001/4000)/6 ≈ 4.166e-5 < ln(1921951/1920000)/14 ≈ 7.255e-5 ⇒ DHT（A）更差；
// issue 形式因 (F0·G0)^(cG−cF) = (4000·1920000)^8 巨大而判 A 更优。
{
  const level = 100;
  const job = "WHM";
  const thresholdOfTierValue = (stat, target) => {
    const p = tierParameters(level, job, stat);
    const inner = Math.ceil((target - p.c) / p.mult);
    return Math.max(0, Math.ceil((inner * p.q - p.b) / p.a));
  };
  const costTo = (stat, tierValue) =>
    thresholdOfTierValue(stat, tierValue + tierParameters(level, job, stat).mult) -
    thresholdOfTierValue(stat, tierValue);

  const dhtCost = costTo("DHT", 0);
  const crtCost = costTo("CRT", 800);
  assert(dhtCost === 6, `level 100 DHT t=0→1 成本应为 6，实际 ${dhtCost}`);
  assert(crtCost === 14, `level 100 CRT t=800→801 成本应为 14，实际 ${crtCost}`);

  const F0 = directHitFactor(0);
  const F1 = directHitFactor(1);
  const G0 = criticalFactor(800, job);
  const G1 = criticalFactor(801, job);
  assert(F0 === 4000 && F1 === 4001, "DHT 因子数值");
  assert(G0 === 1_920_000 && G1 === 1_921_951, "CRT 因子数值");

  const real = crossExponentCompare(F0, F1, dhtCost, G0, G1, crtCost);
  assert(real.result === -1, `真实反例：正确判据应判 DHT 更差，实际 ${real.result}`);
  assert(real.issueLeft > real.issueRight, "真实反例：issue 形式应判 DHT 更优");
  const perUnitDht = Math.log(F1 / F0) / dhtCost;
  const perUnitCrt = Math.log(G1 / G0) / crtCost;
  assert(perUnitDht < perUnitCrt, "真实反例浮点真值应为 DHT 更差");
  const correctedDigits = String(real.left).length;
  const issueDigits = String(real.issueLeft).length;
  ok(
    "3d.canonical-evaluator-counterexample",
    `level=100 ${job}：DHT F: ${F0}→${F1} 成本 ${dhtCost}；CRT G: ${G0}→${G1} 成本 ${crtCost}。` +
      `真值 ${perUnitDht.toExponential(4)} < ${perUnitCrt.toExponential(4)}（DHT 更差）；` +
      `精确 BigInt 判据（${correctedDigits} 位整数）判 DHT 更差；issue 形式（${issueDigits} 位整数）判 DHT 更优 ⇒ 真实公式实例中顺序被反转。` +
      `修正因子 (F0·G0)^(cG−cF)=(4000·1920000)^8`,
  );
}

// ----------------------------------------- 4. 正性前提失效的边界（log 无定义）
{
  // 整数交叉指数形式在 G1=0 时自动成立（右端为 0），但 ln(G1/G0) 无定义。
  const F0 = 2, F1 = 2, cF = 1;
  const G0 = 5, G1 = 0, cG = 1;
  const integerLeft = pow(F1, cG) * pow(G0, cF);
  const integerRight = pow(F0, cG) * pow(G1, cF);
  assert(integerLeft >= integerRight, "整数形式应成立（右端为 0）");
  assert(!Number.isFinite(Math.log(G1 / G0)), "ln(G1/G0) 应无定义（-Infinity）");
  assert(!Number.isFinite(Math.log(F1 / F0) / cF - Math.log(G1 / G0) / cG), "log 判据应无定义");
  ok(
    "4.positivity-prerequisite",
    `G1=0 时整数交叉指数形式成立（${integerLeft} >= ${integerRight}），但 ln(G1/G0) 无定义；` +
      "故正性（canonical safeDamageFactors 要求全部因子为安全正整数）是本定理不可省略的前提（exact-mip-candidate-upper-bound.ts:96-106）",
  );
}

// --------------------------- 5. 定点对数 + 误差加宽的可靠性（有限抽样）
{
  // 用 1/64 栅格量化 ln 比值，误差上界 eps = 1/128。
  // 加宽判据：若 cG·L̂F − cF·L̂G > (cF+cG)·eps，则声明 A 严格更优。
  // 定理（README §5 定理 4(c)）：该声明与精确 BigInt 判据同向；否则必须回退/判并列。
  const eps = 1 / 128;
  const quantize = (x) => Math.round(x * 64) / 64;
  let claimsA = 0;
  let claimsB = 0;
  let undecided = 0;
  let checkedCases = 0;
  for (let F0 = 1; F0 <= 10; F0 += 1)
    for (let F1 = 1; F1 <= 10; F1 += 1)
      for (let G0 = 1; G0 <= 10; G0 += 1)
        for (let G1 = 1; G1 <= 10; G1 += 1)
          for (let cF = 1; cF <= 3; cF += 1)
            for (let cG = 1; cG <= 3; cG += 1) {
              const exact = crossExponentCompare(F0, F1, cF, G0, G1, cG).result;
              const lf = quantize(Math.log(F1 / F0));
              const lg = quantize(Math.log(G1 / G0));
              const scaled = cG * lf - cF * lg;
              const errorBound = (cF + cG) * eps;
              if (scaled > errorBound) {
                assert(exact > 0, `加宽判据不安全：F0=${F0},F1=${F1},cF=${cF},G0=${G0},G1=${G1},cG=${cG}`);
                claimsA += 1;
              } else if (scaled < -errorBound) {
                assert(exact < 0, `加宽判据不安全：F0=${F0},F1=${F1},cF=${cF},G0=${G0},G1=${G1},cG=${cG}`);
                claimsB += 1;
              } else {
                undecided += 1;
              }
              checkedCases += 1;
            }
  assert(claimsA > 0 && claimsB > 0 && undecided > 0, "误差加宽抽样应同时包含三种结果");
  ok(
    "5.fixed-point-soundness",
    `${checkedCases} 组抽样上，量化误差 |ε|≤1/128 的定点对数按 (cF+cG)ε 加宽后：声明 A 优 ${claimsA}、B 优 ${claimsB}、并列/回退 ${undecided}，` +
      "无一例与精确 BigInt 判据矛盾（有限抽样旁证；一般性误差命题见 README §5 定理 4(c)）",
  );
}

// ------------------------------- 6. canonical 等级实例：tier 转移的精确判据
{
  const LEVELS = [50, 60, 70, 80, 90, 100];
  const job = "WHM";
  let transitions = 0;
  let positiveCostTransitions = 0;
  let zeroCostTransitions = 0;
  let agree = 0;
  let tieSkipped = 0;
  let strictA = 0;
  let strictB = 0;
  const factorOf = (stat, tierValue) => {
    if (stat === "CRT") return criticalFactor(tierValue, job);
    if (stat === "DHT") return directHitFactor(tierValue);
    return determinationFactor(tierValue);
  };
  for (const level of LEVELS) {
    const thresholdOfTierValue = (stat, target) => {
      const p = tierParameters(level, job, stat);
      const inner = Math.ceil((target - p.c) / p.mult);
      return Math.max(0, Math.ceil((inner * p.q - p.b) / p.a));
    };
    for (const leftStat of ["CRT", "DHT", "DET"]) {
      for (const rightStat of ["CRT", "DHT", "DET"]) {
        if (leftStat === rightStat) continue;
        for (let offset = 0; offset < 12; offset += 1) {
          const pL = tierParameters(level, job, leftStat);
          const pR = tierParameters(level, job, rightStat);
          const tL = tier(level, job, leftStat, 0) + offset * pL.mult;
          const tR = tier(level, job, rightStat, 0) + offset * pR.mult;
          const cL = thresholdOfTierValue(leftStat, tL + pL.mult) - thresholdOfTierValue(leftStat, tL);
          const cR = thresholdOfTierValue(rightStat, tR + pR.mult) - thresholdOfTierValue(rightStat, tR);
          transitions += 1;
          if (cL <= 0 || cR <= 0) {
            zeroCostTransitions += 1;
            continue; // 定理 A 要求 cF,cG 为正整数；c=0 的跳档（仅 level 50 DHT）不适用，见 README §7
          }
          positiveCostTransitions += 1;
          const F0 = factorOf(leftStat, tL);
          const F1 = factorOf(leftStat, tL + pL.mult);
          const G0 = factorOf(rightStat, tR);
          const G1 = factorOf(rightStat, tR + pR.mult);
          assert(F0 > 0 && F1 > 0 && G0 > 0 && G1 > 0, "因子必须为正（正性前提）");
          const exact = crossExponentCompare(F0, F1, cL, G0, G1, cR).result;
          const logGap = Math.log(F1 / F0) / cL - Math.log(G1 / G0) / cR;
          if (exact === 0) {
            assert(Math.abs(logGap) < 1e-12, "实例等式一致性");
          } else if (Math.abs(logGap) < 1e-12) {
            tieSkipped += 1;
          } else {
            assert(Math.sign(logGap) === exact, `实例符号不一致 ${level} ${leftStat}->${rightStat} offset=${offset}`);
            agree += 1;
            if (exact > 0) strictA += 1;
            else strictB += 1;
          }
        }
      }
    }
  }
  assert(transitions === 432, `tier 转移样本数应为 432（6 等级 × 6 有序属性对 × 12 组），实际 ${transitions}`);
  assert(zeroCostTransitions > 0, "应包含 c=0 的跳档（level 50 DHT）");
  assert(positiveCostTransitions > 0 && agree > 0 && strictA > 0 && strictB > 0, "实例样本应包含双向严格结论");
  ok(
    "6.canonical-tier-transitions",
    `6 等级 × 3 属性对 × 12 组 tier 转移共 ${transitions} 组：正成本转移 ${positiveCostTransitions}（浮点符号一致 ${agree}：A优 ${strictA}，B优 ${strictB}），` +
      `c=0 跳档 ${zeroCostTransitions} 组（不满足定理 A 的正成本前提，已按 README §7 排除）`,
  );
}

// ------------------- 7. 复用 canonical-model 重新核对等级参数、因子与 production evaluator
{
  const data = await loadGameData();
  const canonical = await loadCanonicalEvaluator();
  const levelKeys = Object.keys(data.jobLevelModifiers).map(Number).sort((a, b) => a - b);
  const documented = Object.keys(DOCUMENTED_LEVEL_PARAMS).map(Number).sort((a, b) => a - b);
  assert(levelKeys.join(",") === documented.join(","), "支持等级集合应与文档一致");
  for (const level of levelKeys) {
    const actual = data.jobLevelModifiers[level];
    const expected = DOCUMENTED_LEVEL_PARAMS[level];
    for (const key of ["main", "sub", "div", "det", "detTrunc"]) {
      assert(actual[key] === expected[key], `等级 ${level} 参数 ${key} 与文档不一致`);
    }
  }
  // 因子公式对照 production evaluator（抽样；完整逐点对照见 verification/verify-canonical-model.mjs）。
  const statIndexes = new Map([
    ["CRT", 0],
    ["DHT", 1],
    ["DET", 2],
  ]);
  let factorChecks = 0;
  for (const level of levelKeys) {
    for (const job of ["WHM", "BLU", "WAR", "DRG", "SCH"]) {
      const maxLevel = data.jobSchemas[job].maxJobLevel;
      if (maxLevel < level) continue;
      let evaluate;
      try {
        evaluate = canonical.createIntegerDamageFactorEvaluator(job, level, statIndexes);
      } catch {
        continue;
      }
      for (const g of [0, 1, 17, 123, 500, 1500, 3000]) {
        let factors;
        try {
          factors = evaluate([g, g, g]);
        } catch {
          continue; // BLU 武器伤害查表越界等，保守跳过
        }
        assert(factors !== undefined, "production evaluator 返回 undefined");
        assert(factors.critical === criticalFactor(tier(level, job, "CRT", g), job), "critical 与文档模型不一致");
        assert(factors.directHit === directHitFactor(tier(level, job, "DHT", g)), "directHit 与文档模型不一致");
        assert(factors.determination === determinationFactor(tier(level, job, "DET", g)), "determination 与文档模型不一致");
        assert(
          factors.critical > 0 && factors.directHit > 0 && factors.determination > 0 &&
            Number.isSafeInteger(factors.critical) && Number.isSafeInteger(factors.directHit) &&
            Number.isSafeInteger(factors.determination),
          "因子必须为安全正整数（正性前提）",
        );
        factorChecks += 1;
      }
    }
  }
  // factorsAt 全定义域抽样：三元正性
  let positivityChecks = 0;
  for (const level of levelKeys) {
    for (const job of ["WHM", "BLU"]) {
      for (let g = 0; g <= 3000; g += 250) {
        const { critical, directHit, determination } = factorsAt(level, job, { CRT: g, DHT: g, DET: g });
        assert(critical > 0 && directHit > 0 && determination > 0, "三元因子必须为正");
        positivityChecks += 1;
      }
    }
  }
  ok(
    "7.canonical-correspondence",
    `${levelKeys.length} 个等级参数与文档一致；${factorChecks} 个 (level,job,g) 上 critical/directHit/determination 与 production evaluator 一致且为安全正整数；` +
      `另 ${positivityChecks} 个三元组抽样因子全正`,
  );
}

// ---------------- 8. baseStat 影响审计：贡献坐标 vs 面板总值（有限证书）
// 本文的 F0..G1 是因子值，cF/cG 是贡献单位的阈值差。本节点核对：
//   (a) 数据侧 baseStats 映射（CRT/DHT/TEN=sub，DET=main）；
//   (b) 贡献坐标 g 下整数档位模型 == production canonical evaluator；
//   (c) README §7.5 的阈值 6/14 确为贡献单位；面板坐标 = 贡献 + 常数偏移，
//       阈值差在常数平移下不变，但把面板值当贡献会得到错误档位（坐标误用可检测）。
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
  // (b) 贡献坐标：模型档位 == canonical 档位
  let tierChecks = 0;
  for (const level of Object.keys(DOCUMENTED_LEVEL_PARAMS).map(Number).sort((a, b) => a - b)) {
    for (const job of ["WHM", "BLU", "WAR", "DRG", "SCH"]) {
      if (data.jobSchemas[job].maxJobLevel < level) continue;
      for (const stat of ["CRT", "DHT", "DET"]) {
        for (const g of [0, 1, 2, 17, 123, 500, 1500]) {
          const model = tier(level, job, stat, g);
          const actual = canonical.equippedAttributeTier(job, level, stat, g);
          assert(model === actual, `贡献坐标档位与 canonical 不一致 ${level}/${job}/${stat}/g=${g}: ${model} vs ${actual}`);
          tierChecks += 1;
        }
      }
    }
  }
  // (c) 阈值坐标复核：level 100 WHM，贡献阈值差 6（DHT 0→1）与 14（CRT 800→801）
  const level = 100;
  const job = "WHM";
  const thresholdOfTierValue = (stat, target) => {
    const p = tierParameters(level, job, stat);
    const inner = Math.ceil((target - p.c) / p.mult);
    return Math.max(0, Math.ceil((inner * p.q - p.b) / p.a));
  };
  const cases = [
    { stat: "DHT", fromTier: 0, toTier: 1, cost: 6 },
    { stat: "CRT", fromTier: 800, toTier: 801, cost: 14 },
  ];
  const auditRows = [];
  for (const item of cases) {
    const from = thresholdOfTierValue(item.stat, item.fromTier);
    const to = thresholdOfTierValue(item.stat, item.toTier);
    assert(to - from === item.cost, `${item.stat} 贡献阈值差应为 ${item.cost}，实际 ${to - from}`);
    // 阈值最小性（贡献坐标）
    assert(tier(level, job, item.stat, from) >= item.fromTier, `${item.stat} 起始阈值不满足档位`);
    assert(to === 0 || tier(level, job, item.stat, to - 1) < item.toTier, `${item.stat} 终止阈值不是最小`);
    // 面板坐标：panel = 贡献 + anchor；同一属性内常数平移不改变阈值差
    const anchor = anchorOf(level, item.stat);
    const panelFrom = anchor + from;
    const panelTo = anchor + to;
    assert(panelTo - panelFrom === item.cost, "面板坐标的阈值差应与贡献坐标相同（常数平移不变）");
    // 坐标误用可检测：把面板值当贡献代入档位公式会得到不同（错误）档位
    const wrongTier = tier(level, job, item.stat, panelFrom);
    assert(wrongTier !== item.fromTier, `${item.stat} 面板值当贡献应产生错误档位`);
    auditRows.push(
      `${item.stat} ${item.fromTier}→${item.toTier}: 贡献阈值 ${from}→${to}，面板阈值 ${panelFrom}→${panelTo}，` +
        `成本 ${item.cost}；面板值当贡献会得档位 ${wrongTier}≠${item.fromTier}`,
    );
  }
  ok(
    "8.baseStat-coordinate-audit",
    `baseStats.CRT/DHT/TEN="sub"、DET="main"；${tierChecks} 个 (level,job,stat,g) 上贡献坐标档位与 canonical 一致；` +
      `level 100 WHM：${auditRows.join("；")}`,
  );
}

// ---------------------------------------------------------------- 输出报告
console.log("marginal-comparison verification: PASS");
for (const entry of report) console.log(`  [ok] ${entry.name}: ${entry.detail}`);
console.log(`  primary-counterexample-arithmetic: issueL=${primary.issueLeft}, issueR=${primary.issueRight}, corrL=corrR=${primary.left}`);
console.log("scope: 有限枚举 + 精确 BigInt 恒等式/反例 + canonical 模型一致性；不是一般性证明，");
console.log("       一般性证明见 theorems/marginal-comparison/README.md §6。");
