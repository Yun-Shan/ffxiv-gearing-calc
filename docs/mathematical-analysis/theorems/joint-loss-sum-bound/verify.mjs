/**
 * joint-loss-sum-bound/verify.mjs
 *
 * 目的：为本目录 README.md 的定理提供**有限域/有限有理网格证书**：
 *   V1  Thm 1：归一化比值 0 < r <= 1、r <= u = min(1, U/B)（用生产整数因子求值器与
 *              坐标极大 U 构造在有限样本宇宙上逐点核验）
 *   V2  Thm 2.1：损失和等价形式（精确有理比较，无浮点）
 *   V3  Thm 2.4：BigInt 累加/交叉相乘比较等价于 Σu <= J*（网格）
 *   V4  Thm 2.5：整数缩放向上取整时的必要性方向（实现 loadout-finder-exact-mip.ts 的取整约定）
 *   V5  Thm 3.1：生产函数 candidateUpperBoundCannotImproveJointIncumbent 与
 *              “其余职业 u_k = 1”的损失和判据逐点相同（含 tie 与保守护卫）
 *   V6  Thm 3.3/3.4：非冗余精确实例、严格变体、一般 n 的非冗余充要条件
 *   V7  Thm 4.1/4.3：共享选择耦合不等式、耦合损失实例、拉格朗日弱对偶与 λ=0 回退
 *   V8  边界退化：无效基线导致不健全、J* = n、浮点比较两类错误、J* 向上取整不安全
 *   V9  与生产精确比较函数 candidateUpperBoundCannotImproveIncumbent 的 damage/DPS 语义对照
 *   V10 baseStat 归约契约：baseStats.CRT/DHT/TEN(=SKS/SPS)=sub、DET=main；贡献→档位；
 *       面板值误用反例；参考模型 §2.1 的 70 级面板→贡献→档位例子；攻击主属性基值注意事项
 *
 * 覆盖范围：有限网格（精确有理数分母 <= 若干小整数；整数因子样本宇宙为固定伪随机样本）
 *          与有限档位/属性区间；对生产实现的对照只覆盖被调用的纯函数。
 *          所有属性样本/上界构造都在**贡献坐标** g（装备+食物）上，不是面板总值；
 *          V10 显式核验该坐标契约（参考模型 §2.1/§2.2）。
 *
 * 证明作用：这些是**有限证书**，用于排除实现/公式层面的错误并给出反例；
 *          一般性证明在 README.md 的定理陈述与证明中。网格外结论不由此脚本证明。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/joint-loss-sum-bound/verify.mjs
 */
import {
  assert,
  factorsAt,
  floorDiv,
  loadCanonicalEvaluator,
  loadGameData,
  tier,
} from "../../verification/canonical-model.mjs";
import { candidateUpperBoundCannotImproveJointIncumbent as perJobCut } from
  "../../../../src/domain/search/joint-candidate-upper-bound.ts";
import { candidateUpperBoundCannotImproveIncumbent as exactCannotImprove } from
  "../../../../src/domain/search/exact-mip-candidate-upper-bound.ts";

const report = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  assert(condition, message);
}

function record(name, detail) {
  report.push({ name, detail });
}

// ---------------------------------------------------------------------------
// 0. 精确有理数工具（全部 BigInt，无浮点）
// ---------------------------------------------------------------------------
function gcdBig(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function rat(numerator, denominator = 1n) {
  let n = BigInt(numerator);
  let d = BigInt(denominator);
  if (d === 0n) throw new RangeError("有理数分母不得为 0");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcdBig(n, d);
  return { numerator: n / divisor, denominator: d / divisor };
}

const ZERO = rat(0n);
const ONE = rat(1n);

function addRat(left, right) {
  return rat(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function subRat(left, right) {
  return addRat(left, rat(-right.numerator, right.denominator));
}

function mulRat(left, right) {
  return rat(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
}

function cmpRat(left, right) {
  const difference =
    left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function leRat(left, right) {
  return cmpRat(left, right) <= 0;
}

function ltRat(left, right) {
  return cmpRat(left, right) < 0;
}

function minRat(left, right) {
  return cmpRat(left, right) <= 0 ? left : right;
}

function sumRat(items) {
  return items.reduce((total, item) => addRat(total, item), ZERO);
}

function ratText(value) {
  return `${value.numerator}/${value.denominator}`;
}

function minOne(value) {
  return minRat(ONE, value);
}

/** 生产实现 sumCappedRatios 的等价累加（逐项 cap 到 1 并约分）。 */
function sumCappedRatios(ratios) {
  return sumRat(ratios.map((ratio) =>
    ratio.numerator > ratio.denominator ? ONE : minOne(ratio)));
}

/** Thm 2.4 的交叉相乘比较：Σu <= p/q。 */
function lossSumAtOrBelow(sum, threshold) {
  return sum.numerator * threshold.denominator <=
    threshold.numerator * sum.denominator;
}

/** 生产 loadout-finder-exact-mip.ts:2758-2760 的向上取整缩放（cap 到 scale）。 */
function scaledUpCoefficient(ratio, scale) {
  const scaled = (ratio.numerator * scale + ratio.denominator - 1n) /
    ratio.denominator;
  return scaled >= scale ? scale : scaled;
}

// ---------------------------------------------------------------------------
// 1. Thm 1：有限样本宇宙上的 r <= 1、r <= u 与 U 构造
// ---------------------------------------------------------------------------
record("V1 Thm1 归一化范围与 U 支配", "有限样本宇宙 + 生产整数因子求值器");

const canonical = await loadCanonicalEvaluator();
const gameData = await loadGameData();
const LEVELS = [100, 90, 70];
const JOBS = ["RDM", "WAR", "WHM"];

function statIndexesForJob(job) {
  const schema = gameData.jobSchemas[job];
  const attackStat = schema.attackStat ?? (schema.mainStat === "VIT" ? "STR" : schema.mainStat);
  const weaponStat = schema.mainStat === "INT" || schema.mainStat === "MND" ? "MDMG" : "PDMG";
  const speedStat = schema.stats.includes("SKS") ? "SKS" : "SPS";
  const names = [attackStat, weaponStat, "CRT", "DET", "DHT", "TEN", speedStat];
  return new Map(names.map((name, index) => [name, index]));
}

let randomState = 0x2f6e2b1n;
const RANDOM_MODULUS = 2147483647n;
function randomInt(modulus) {
  randomState = (randomState * 48271n) % RANDOM_MODULUS;
  return Number(randomState % BigInt(modulus));
}

const ATTACK = [0, 400, 1500, 3000];
const WEAPON = [0, 50, 120, 180];
const SECONDARY = [0, 600, 1500, 2400, 3200];
const SPEED = [0, 400, 1000, 1800];

function sampleVector() {
  return [
    ATTACK[randomInt(ATTACK.length)],
    WEAPON[randomInt(WEAPON.length)],
    SECONDARY[randomInt(SECONDARY.length)],
    SECONDARY[randomInt(SECONDARY.length)],
    SECONDARY[randomInt(SECONDARY.length)],
    SECONDARY[randomInt(SECONDARY.length)],
    SPEED[randomInt(SPEED.length)],
  ];
}

function factorProduct(factors) {
  return BigInt(factors.weaponDamage) * BigInt(factors.mainStat) *
    BigInt(factors.determination) * BigInt(factors.tenacity) *
    BigInt(factors.critical) * BigInt(factors.directHit);
}

const FACTOR_NAMES = [
  "weaponDamage", "mainStat", "determination", "tenacity",
  "critical", "directHit", "gcdCentiseconds",
];

function validFactors(factors) {
  return factors !== undefined && FACTOR_NAMES.every((name) =>
    Number.isSafeInteger(factors[name]) && factors[name] > 0);
}

let factorSampleCount = 0;
let ratioCheckCount = 0;

for (const level of LEVELS) {
  for (const job of JOBS) {
    const indexes = statIndexesForJob(job);
    const evaluate = canonical.createIntegerDamageFactorEvaluator(job, level, indexes);
    const universe = [];
    for (let sample = 0; sample < 40; sample += 1) {
      universe.push(sampleVector());
    }
    // 坐标极大向量：仅由样本宇宙定义的松弛 U 构造（§10.1 的有限版本）。
    const coordinateMax = [0, 1, 2, 3, 4, 5, 6].map((coordinate) =>
      Math.max(...universe.map((vector) => vector[coordinate])));
    const maxFactors = evaluate(coordinateMax);
    check(validFactors(maxFactors), `V1 坐标极大向量因子无效 ${level}/${job}`);

    for (const vector of universe) {
      const factors = evaluate(vector);
      check(validFactors(factors), `V1 因子正性失败 ${level}/${job}`);
      factorSampleCount += 1;
      // 与 canonical-model 的档位因子逐点一致（CRT/DHT/DET）。
      const modelFactors = factorsAt(level, job, {
        CRT: vector[2], DHT: vector[4], DET: vector[3],
      });
      check(BigInt(factors.critical) === BigInt(modelFactors.critical),
        `V1 critical 与 canonical-model 不一致 ${level}/${job}`);
      check(BigInt(factors.directHit) === BigInt(modelFactors.directHit),
        `V1 directHit 与 canonical-model 不一致 ${level}/${job}`);
      check(BigInt(factors.determination) === BigInt(modelFactors.determination),
        `V1 determination 与 canonical-model 不一致 ${level}/${job}`);
      // 单坐标 +delta 单调性（P 分量非减、speed 分量 gcd 非增）。
      for (let coordinate = 0; coordinate < 6; coordinate += 1) {
        const bumped = [...vector];
        bumped[coordinate] += 400;
        const bumpedFactors = evaluate(bumped);
        if (!validFactors(bumpedFactors)) continue;
        check(factorProduct(bumpedFactors) >= factorProduct(factors),
          `V1 目标对坐标 ${coordinate} 非单调 ${level}/${job}`);
      }
      const faster = [...vector];
      faster[6] += 400;
      const fasterFactors = evaluate(faster);
      if (validFactors(fasterFactors)) {
        check(fasterFactors.gcdCentiseconds <= factors.gcdCentiseconds,
          `V1 gcd 对速度非单调不增 ${level}/${job}`);
      }
    }

    const evaluated = universe.map((vector) => {
      const factors = evaluate(vector);
      return { factors, product: factorProduct(factors) };
    });

    // damage 目标：B = max P；U = P(坐标极大向量)。
    const baselineProduct = evaluated.reduce((best, entry) =>
      entry.product > best ? entry.product : best, 0n);
    check(baselineProduct > 0n, `V1 damage 基线非正 ${level}/${job}`);
    const upperProduct = factorProduct(maxFactors);
    for (const entry of evaluated) {
      const ratio = rat(entry.product, baselineProduct);
      check(leRat(ratio, ONE), `V1 damage r > 1 ${level}/${job}`);
      check(entry.product <= upperProduct, `V1 damage U 未支配 ${level}/${job}`);
      const u = minOne(rat(upperProduct, baselineProduct));
      check(leRat(ratio, u), `V1 damage r <= u 失败 ${level}/${job}`);
      ratioCheckCount += 2;
    }

    // dps 目标：f = P / gcd；B = max P/gcd（精确有理数）。
    const bestRatioEntry = evaluated.reduce((best, entry) => {
      // 直接比较 P_x / c_x 与 P_best / c_best（交叉相乘，BigInt）。
      const comparison = entry.product * BigInt(best.factors.gcdCentiseconds) -
        best.product * BigInt(entry.factors.gcdCentiseconds);
      return comparison > 0n ? entry : best;
    }, evaluated[0]);
    const baselineNumerator = bestRatioEntry.product;
    const baselineGcd = BigInt(bestRatioEntry.factors.gcdCentiseconds);
    check(baselineNumerator > 0n, `V1 dps 基线非正 ${level}/${job}`);
    const dpsUpperRatio = rat(
      upperProduct * baselineGcd,
      baselineNumerator * BigInt(maxFactors.gcdCentiseconds),
    );
    const dpsU = minOne(dpsUpperRatio);
    for (const entry of evaluated) {
      const ratio = rat(
        entry.product * baselineGcd,
        baselineNumerator * BigInt(entry.factors.gcdCentiseconds),
      );
      check(leRat(ratio, ONE), `V1 dps r > 1 ${level}/${job}`);
      check(leRat(ratio, dpsU), `V1 dps r <= u 失败 ${level}/${job}`);
      ratioCheckCount += 2;
    }
    check(dpsU.numerator > 0n, `V1 dps u 非正 ${level}/${job}`);
  }
}

record("V1 统计", `因子样本=${factorSampleCount}；r<=1 与 r<=u 检查=${ratioCheckCount}`);

// ---------------------------------------------------------------------------
// 2. Thm 2.1：损失和等价形式（精确有理）
// ---------------------------------------------------------------------------
record("V2 Thm2.1 损失和等价形式", "n<=4、分母<=6 的完整有理网格");

let equivalenceChecks = 0;
for (let n = 1; n <= 4; n += 1) {
  for (let thresholdDenominator = 1; thresholdDenominator <= 6; thresholdDenominator += 1) {
    for (let thresholdNumerator = 1;
      thresholdNumerator <= n * thresholdDenominator;
      thresholdNumerator += 1) {
      const threshold = rat(thresholdNumerator, thresholdDenominator);
      const ratioChoices = [];
      for (let denominator = 1; denominator <= 5; denominator += 1) {
        for (let numerator = 1; numerator <= denominator; numerator += 1) {
          ratioChoices.push(rat(numerator, denominator));
        }
      }
      // 小 n 完整笛卡尔积；n=3/4 用确定性前缀抽样控制规模。
      const totalCombinations = ratioChoices.length ** n;
      const step = totalCombinations <= 400 ? 1 : Math.ceil(totalCombinations / 400);
      for (let index = 0; index < totalCombinations; index += step) {
        const ratios = [];
        let remainder = index;
        for (let position = 0; position < n; position += 1) {
          ratios.push(ratioChoices[remainder % ratioChoices.length]);
          remainder = Math.floor(remainder / ratioChoices.length);
        }
        const sum = sumCappedRatios(ratios);
        const lossSum = sumRat(ratios.map((ratio) => subRat(ONE, ratio)));
        const left = leRat(sum, threshold);
        // 形式 B：Σ(1-u) >= n - J*
        const rightDirect = cmpRat(lossSum, subRat(rat(n), threshold)) >= 0;
        check(left === rightDirect, `V2 等价失败 n=${n} ${ratText(threshold)}`);
        equivalenceChecks += 1;
      }
    }
  }
}
record("V2 统计", `等价检查=${equivalenceChecks}`);

// ---------------------------------------------------------------------------
// 3. Thm 2.4：BigInt 累加 + 交叉相乘 == Σu <= p/q
// ---------------------------------------------------------------------------
record("V3 Thm2.4 交叉相乘比较", "同 V2 网格");

let crossChecks = 0;
for (let n = 1; n <= 4; n += 1) {
  for (let q = 1; q <= 5; q += 1) {
    for (let p = 1; p <= n * q; p += 1) {
      const threshold = rat(p, q);
      const ratios = [];
      for (let job = 0; job < n; job += 1) {
        const denominator = 1 + (job * 3 + p) % 5;
        ratios.push(rat(1 + (job + q) % denominator, denominator));
      }
      // 独立路径：公共分母直接求和（不约分）与逐项约分累加。
      const commonDenominator = ratios.reduce((product, ratio) =>
        product * ratio.denominator, 1n);
      const commonNumerator = ratios.reduce((total, ratio) =>
        total + ratio.numerator * (commonDenominator / ratio.denominator), 0n);
      const direct = commonNumerator * BigInt(q) <= BigInt(p) * commonDenominator;
      const accumulated = lossSumAtOrBelow(sumCappedRatios(ratios), threshold);
      check(direct === accumulated, `V3 交叉相乘不一致 n=${n} J*=${p}/${q}`);
      crossChecks += 1;
    }
  }
}
record("V3 统计", `交叉相乘检查=${crossChecks}`);

// ---------------------------------------------------------------------------
// 4. Thm 2.5：整数缩放向上取整的必要性方向
// ---------------------------------------------------------------------------
record("V4 Thm2.5 缩放取整安全性", "scale=10、分母<=5 网格");

let scalingChecks = 0;
for (let n = 1; n <= 4; n += 1) {
  for (let q = 1; q <= 5; q += 1) {
    for (let p = 1; p <= n * q; p += 1) {
      const threshold = rat(p, q);
      const scale = 10n;
      for (let pattern = 0; pattern < 40; pattern += 1) {
        const ratios = [];
        for (let job = 0; job < n; job += 1) {
          const denominator = 1n + BigInt((pattern + job * 3) % 5);
          const numerator = 1n + BigInt((pattern * 7 + job * 11) % Number(denominator));
          ratios.push(rat(numerator, denominator));
        }
        const sum = sumCappedRatios(ratios);
        const coefficients = ratios.map((ratio) => scaledUpCoefficient(ratio, scale));
        const coefficientSum = coefficients.reduce((total, value) => total + value, 0n);
        const minimumScaledSum = (threshold.numerator * scale) / threshold.denominator + 1n;
        if (ltRat(threshold, sum)) {
          // 严格超过阈值（可能严格改善）必然要求整数缩放和 >= floor(T*s)+1。
          check(coefficientSum >= minimumScaledSum,
            `V4 缩放必要性失败 n=${n} J*=${p}/${q}`);
          scalingChecks += 1;
        }
        // 反向（剪枝方向）：缩放和低于阈值下界 => 精确和 <= 阈值。
        if (coefficientSum < minimumScaledSum) {
          check(leRat(sum, threshold), `V4 剪枝方向不安全 n=${n}`);
          scalingChecks += 1;
        }
      }
    }
  }
}
record("V4 统计", `缩放检查=${scalingChecks}`);

// ---------------------------------------------------------------------------
// 5. Thm 3.1：生产单职业判据 == 其余 u_k = 1 的损失和判据
// ---------------------------------------------------------------------------
record("V5 Thm3.1 生产判据恒等", "n<=5、分母<=6 网格 + 边界输入");

let identityChecks = 0;
let conservativeBoundaryCount = 0;
function perJobExpected(rawRatio, incumbent, jobCount) {
  const thresholdNumerator = incumbent.numerator -
    BigInt(jobCount - 1) * incumbent.denominator;
  if (thresholdNumerator <= 0n) return false;
  return rawRatio.numerator * incumbent.denominator <=
    rawRatio.denominator * thresholdNumerator;
}

for (let n = 1; n <= 5; n += 1) {
  for (let q = 1; q <= 6; q += 1) {
    for (let p = 1; p <= n * q; p += 1) {
      const incumbent = rat(p, q);
      const thresholdNumerator = incumbent.numerator - BigInt(n - 1) * incumbent.denominator;
      for (let b = 1; b <= 8; b += 1) {
        for (let a = 0; a <= b; a += 1) {
          const rawRatio = rat(a, b);
          const actual = perJobCut(
            { numerator: rawRatio.numerator, denominator: rawRatio.denominator },
            { numerator: incumbent.numerator, denominator: incumbent.denominator },
            n,
          );
          const expected = perJobExpected(rawRatio, incumbent, n);
          check(actual === expected, `V5 恒等失败 n=${n} J*=${p}/${q} u=${a}/${b}`);
          identityChecks += 1;
          // 损失和 specialization：u_j = min(1, u)，其余 u_k = 1。
          const capped = minOne(rawRatio);
          const specialization = sumRat([
            ...new Array(n - 1).fill(ONE),
            capped,
          ]);
          const lossFires = lossSumAtOrBelow(specialization, incumbent);
          if (thresholdNumerator > 0n) {
            check(actual === lossFires,
              `V5 损失和 specialization 失败 n=${n} J*=${p}/${q} u=${a}/${b}`);
          } else if (actual === false && lossFires === true) {
            // T <= 0 且 raw u = 0、J* = n-1：生产实现保守地不剪枝。
            conservativeBoundaryCount += 1;
            check(cmpRat(rawRatio, ZERO) === 0 && cmpRat(incumbent, rat(n - 1)) === 0,
              "V5 保守边界情形不符合预期");
          }
        }
      }
    }
  }
}
// 生产测试 loadout-finder-exact-mip-joint.test.ts:565-579 的 tie 语义。
{
  const incumbent = rat(5, 3);
  const incumbentInput = { numerator: 5n, denominator: 3n };
  check(perJobCut({ numerator: 2n, denominator: 3n }, incumbentInput, 2) === true,
    "V5 等号应触发（不能严格改善）");
  check(perJobCut({ numerator: 6_667n, denominator: 10_000n }, incumbentInput, 2) === false,
    "V5 高于阈值不应触发");
  check(perJobCut({ numerator: 1n, denominator: 3n }, incumbentInput, 2) === true,
    "V5 低于阈值应触发");
}
// 非法输入守卫：与生产实现同样返回 false。
check(perJobCut({ numerator: 1n, denominator: 2n }, { numerator: 1n, denominator: 1n }, 0) === false,
  "V5 jobCount=0 应拒绝");
check(perJobCut({ numerator: 1n, denominator: 2n }, { numerator: 1n, denominator: 1n }, 2.5) === false,
  "V5 非整数 jobCount 应拒绝");
check(perJobCut({ numerator: -1n, denominator: 2n }, { numerator: 1n, denominator: 1n }, 2) === false,
  "V5 负比值应拒绝");
check(perJobCut({ numerator: 1n, denominator: 0n }, { numerator: 1n, denominator: 1n }, 2) === false,
  "V5 零分母应拒绝");
check(perJobCut({ numerator: 1n, denominator: 2n }, { numerator: 1n, denominator: 0n }, 2) === false,
  "V5 incumbent 零分母应拒绝");

record("V5 统计", `恒等检查=${identityChecks}；保守边界=${conservativeBoundaryCount}`);

// ---------------------------------------------------------------------------
// 6. Thm 3.3/3.4：非冗余精确实例与一般 n 条件
// ---------------------------------------------------------------------------
record("V6 Thm3.3 非冗余实例", "n=2, J*=8/5, u=(9/10,7/10) 与严格变体");

function perJobFiresForRatio(rawRatioNumerator, rawRatioDenominator, incumbent, jobCount) {
  return perJobCut(
    { numerator: BigInt(rawRatioNumerator), denominator: BigInt(rawRatioDenominator) },
    { numerator: incumbent.numerator, denominator: incumbent.denominator },
    jobCount,
  );
}

{
  const n = 2;
  const incumbent = rat(8, 5);
  const incumbentInput = { numerator: 8n, denominator: 5n };
  const u1 = rat(9, 10);
  const u2 = rat(7, 10);
  // 单职业阈值 τ = J* - (n-1) = 3/5。
  const tau = subRat(incumbent, rat(n - 1));
  check(cmpRat(tau, rat(3, 5)) === 0, "V6 τ 计算错误");
  check(cmpRat(u1, tau) > 0 && cmpRat(u2, tau) > 0, "V6 两个上界都应高于单职业阈值");
  check(!perJobFiresForRatio(9, 10, incumbent, n), "V6 职业 1 不应触发单职业判据");
  check(!perJobFiresForRatio(7, 10, incumbent, n), "V6 职业 2 不应触发单职业判据");
  const sum = sumRat([u1, u2]);
  check(cmpRat(sum, incumbent) === 0, "V6 损失和应等于 J*（等号触发）");
  check(lossSumAtOrBelow(sum, incumbent), "V6 损失和判据应触发");
  const loss = sumRat([subRat(ONE, u1), subRat(ONE, u2)]);
  const budget = subRat(rat(n), incumbent);
  check(cmpRat(loss, budget) === 0, "V6 损失预算应为 2/5");
  // 严格变体：u=(9/10,13/20)。
  const strictU2 = rat(13, 20);
  check(cmpRat(strictU2, tau) > 0, "V6 严格变体 u2 应高于阈值");
  check(!perJobFiresForRatio(13, 20, incumbent, n), "V6 严格变体职业 2 不应触发");
  const strictSum = sumRat([u1, strictU2]);
  check(ltRat(strictSum, incumbent), "V6 严格变体损失和应严格小于 J*");
  record("V6 严格变体", `Σu=${ratText(strictSum)} < J*=${ratText(incumbent)}`);
}

record("V6 Thm3.4 一般 n 条件", "构造见证 + 网格核验");

/** 依 Thm 3.4 证明构造非冗余见证；不存在时返回 undefined。 */
function nonRedundancyWitness(n, incumbent) {
  if (n < 2 || cmpRat(incumbent, rat(n)) >= 0) return undefined;
  const tau = subRat(incumbent, rat(n - 1));
  if (cmpRat(tau, ZERO) <= 0) {
    return new Array(n).fill(rat(incumbent.numerator, incumbent.denominator * BigInt(n)));
  }
  // ε = (J* - nτ) / (2n)，u_j = τ + ε。
  const gap = subRat(incumbent, mulRat(rat(n), tau));
  const epsilon = rat(gap.numerator, gap.denominator * BigInt(2 * n));
  const u = addRat(tau, epsilon);
  return new Array(n).fill(u);
}

let witnessChecks = 0;
for (let n = 1; n <= 5; n += 1) {
  for (let q = 1; q <= 6; q += 1) {
    for (let p = 1; p <= n * q; p += 1) {
      const incumbent = rat(p, q);
      const witness = nonRedundancyWitness(n, incumbent);
      const condition = n >= 2 && cmpRat(incumbent, rat(n)) < 0;
      check((witness !== undefined) === condition,
        `V6 一般条件失败 n=${n} J*=${p}/${q}`);
      if (witness === undefined) continue;
      const tau = subRat(incumbent, rat(n - 1));
      for (const u of witness) {
        check(cmpRat(u, ZERO) > 0 && leRat(u, ONE), "V6 见证越界");
        if (cmpRat(tau, ZERO) > 0) check(cmpRat(u, tau) > 0, "V6 见证未超过阈值");
        check(!perJobFiresForRatio(Number(u.numerator), Number(u.denominator),
          incumbent, n), "V6 见证不应触发单职业判据");
      }
      check(lossSumAtOrBelow(sumRat(witness), incumbent), "V6 见证损失和应触发");
      witnessChecks += 1;
    }
  }
}
// n=2 穷举确认“存在非冗余向量 <=> J* < 2”。
{
  const grid = [];
  for (let denominator = 1; denominator <= 20; denominator += 1) {
    for (let numerator = 1; numerator <= denominator; numerator += 1) {
      grid.push(rat(numerator, denominator));
    }
  }
  for (let q = 1; q <= 6; q += 1) {
    for (let p = 1; p <= 2 * q; p += 1) {
      const incumbent = rat(p, q);
      const tau = subRat(incumbent, rat(1)); // n=2 的单职业阈值
      const perJobFails = (u) => cmpRat(tau, ZERO) <= 0 || cmpRat(u, tau) > 0;
      let bruteForce = false;
      for (const u1 of grid) {
        for (const u2 of grid) {
          if (!(perJobFails(u1) && perJobFails(u2))) continue;
          if (lossSumAtOrBelow(sumRat([u1, u2]), incumbent)) {
            bruteForce = true;
            break;
          }
        }
        if (bruteForce) break;
      }
      const proven = cmpRat(incumbent, rat(2)) < 0;
      // 网格只是见证搜索空间：proven true 时网格应找到；proven false 时网格必找不到。
      check(bruteForce === proven, `V6 穷举与证明不一致 J*=${p}/${q}`);
    }
  }
}
record("V6 统计", `见证检查=${witnessChecks}`);

// ---------------------------------------------------------------------------
// 7. Thm 4：共享选择耦合不等式、耦合损失、拉格朗日弱对偶
// ---------------------------------------------------------------------------
record("V7 Thm4.1 耦合不等式", "有限 S、精确有理 u");

let couplingChecks = 0;
function randomRatio() {
  const denominator = 1 + randomInt(6);
  return rat(randomInt(denominator + 1), denominator);
}
for (let trial = 0; trial < 300; trial += 1) {
  const schemeCount = 2 + randomInt(4);
  const jobCount = 1 + randomInt(4);
  const table = [];
  for (let scheme = 0; scheme < schemeCount; scheme += 1) {
    table.push([]);
    for (let job = 0; job < jobCount; job += 1) table[scheme].push(randomRatio());
  }
  const perSchemeSums = table.map((ratios) => sumRat(ratios));
  const bestCommon = perSchemeSums.reduce((best, sum) =>
    cmpRat(sum, best) > 0 ? sum : best, rat(-1));
  const perJobMaxima = [];
  for (let job = 0; job < jobCount; job += 1) {
    perJobMaxima.push(table.reduce((best, ratios) =>
      cmpRat(ratios[job], best) > 0 ? ratios[job] : best, rat(-1)));
  }
  const decoupled = sumRat(perJobMaxima);
  check(leRat(bestCommon, decoupled), "V7 耦合不等式失败");
  check(leRat(decoupled, rat(jobCount)), "V7 cap 后解耦界应 <= n");
  couplingChecks += 1;
}
// 耦合损失精确实例（u 全为正，符合 U/B > 0）：
// S={s1,s2}，u_1=(1, 1/10)，u_2=(1/10, 1) → max_s Σu=11/10，Σ_j max_s u_j=2。
{
  const table = [[rat(1), rat(1, 10)], [rat(1, 10), rat(1)]];
  const perSchemeSums = table.map((ratios) => sumRat(ratios));
  const bestCommon = perSchemeSums.reduce((best, sum) =>
    cmpRat(sum, best) > 0 ? sum : best, rat(-1));
  const decoupled = decoupledGlobalExample(table);
  check(cmpRat(bestCommon, rat(11, 10)) === 0, "V7 实例 max 应等于 11/10");
  check(cmpRat(decoupled, rat(2)) === 0, "V7 实例 Σmax 应等于 2");
  record("V7 耦合损失实例",
    `max_s Σu = ${ratText(bestCommon)} < Σ_j max_s u_j = ${ratText(decoupled)}（Δ=9/10）`);
  // 每个具体方案都满足损失和判据（J*=3/2），但解耦界无法给出该结论。
  const incumbent = rat(3, 2);
  for (const ratios of table) {
    check(lossSumAtOrBelow(sumRat(ratios), incumbent),
      "V7 实例的每个方案都应满足损失和判据");
  }
  check(cmpRat(decoupled, incumbent) > 0, "V7 解耦界应高于 J*（无法判定具体方案）");
  // 反向演示：解耦界 <= J* 时构成全局“无方案可改善”证书。
  const certificateTable = [[rat(1, 2), rat(1, 2)], [rat(1, 4), rat(1, 2)]];
  const certificateIncumbent = rat(11, 10);
  const certificateDecoupled = decoupledGlobalExample(certificateTable);
  check(leRat(certificateDecoupled, certificateIncumbent), "V7 全局证书界应 <= J*");
  for (const ratios of certificateTable) {
    check(lossSumAtOrBelow(sumRat(ratios), certificateIncumbent),
      "V7 全局证书应覆盖每个具体方案");
  }
  record("V7 全局证书实例",
    `Σ_j max_s u_j = ${ratText(certificateDecoupled)} <= J*=${ratText(certificateIncumbent)}`);
}
function decoupledGlobalExample(table) {
  const jobCount = table[0].length;
  const perJobMaxima = [];
  for (let job = 0; job < jobCount; job += 1) {
    perJobMaxima.push(table.reduce((best, ratios) =>
      cmpRat(ratios[job], best) > 0 ? ratios[job] : best, rat(-1)));
  }
  return sumRat(perJobMaxima);
}
// 拉格朗日弱对偶：n=2 时 bound(λ) = max_s(u1+λ_s) + max_s(u2-λ_s) >= max_s(u1+u2)。
{
  let lagrangianChecks = 0;
  for (let trial = 0; trial < 200; trial += 1) {
    const schemeCount = 2 + randomInt(4);
    const u1 = [];
    const u2 = [];
    for (let scheme = 0; scheme < schemeCount; scheme += 1) {
      u1.push(randomRatio());
      u2.push(randomRatio());
    }
    const lambda = [];
    for (let scheme = 0; scheme < schemeCount; scheme += 1) {
      lambda.push(rat(randomInt(7) - 3, 1 + randomInt(4)));
    }
    const first = u1.map((value, scheme) => addRat(value, lambda[scheme]));
    const second = u2.map((value, scheme) => subRat(value, lambda[scheme]));
    const bound = addRat(
      first.reduce((best, value) => cmpRat(value, best) > 0 ? value : best, rat(-1)),
      second.reduce((best, value) => cmpRat(value, best) > 0 ? value : best, rat(-1)),
    );
    const primal = u1.map((value, scheme) => addRat(value, u2[scheme]))
      .reduce((best, value) => cmpRat(value, best) > 0 ? value : best, rat(-1));
    check(leRat(primal, bound), "V7 拉格朗日弱对偶失败");
    // λ = 0 回退到解耦界。
    const zeroBound = addRat(
      u1.reduce((best, value) => cmpRat(value, best) > 0 ? value : best, rat(-1)),
      u2.reduce((best, value) => cmpRat(value, best) > 0 ? value : best, rat(-1)),
    );
    const decoupled = decoupledGlobalExample(
      u1.map((value, scheme) => [value, u2[scheme]]));
    check(cmpRat(zeroBound, decoupled) === 0, "V7 λ=0 应等于解耦界");
    lagrangianChecks += 1;
  }
  // 精确实例：u_1=(1,0), u_2=(0,1)，λ=(-1/2, +1/2) 使界达到原始最优 1。
  const u1 = [rat(1), rat(0)];
  const u2 = [rat(0), rat(1)];
  const lambda = [rat(-1, 2), rat(1, 2)];
  const firstMax = [addRat(u1[0], lambda[0]), addRat(u1[1], lambda[1])]
    .reduce((best, value) => cmpRat(value, best) > 0 ? value : best, rat(-1));
  const secondMax = [subRat(u2[0], lambda[0]), subRat(u2[1], lambda[1])]
    .reduce((best, value) => cmpRat(value, best) > 0 ? value : best, rat(-1));
  const tightBound = addRat(firstMax, secondMax);
  check(cmpRat(tightBound, rat(1)) === 0, "V7 拉格朗日实例应达到原始最优 1");
  record("V7 拉格朗日实例", `λ=(-1/2,+1/2) 时界=${ratText(tightBound)}，λ=0 时界=2`);
  record("V7 统计", `弱对偶检查=${lagrangianChecks}`);
}

// ---------------------------------------------------------------------------
// 8. 边界退化
// ---------------------------------------------------------------------------
record("V8 无效基线反例", "B 未支配可行值 → 剪枝不健全");

{
  const baseline = rat(3, 2);   // 声称的归一化基线（无效：小于可行值 2）
  const feasibleValue = rat(2); // 真实可行目标值
  const upperBound = rat(2);    // 合法上界 U = 2
  const incumbent = rat(11, 10);
  const ratio = mulRat(feasibleValue, rat(baseline.denominator, baseline.numerator));
  check(cmpRat(ratio, ONE) > 0, "V8 反例中 r 应大于 1");
  const u = minOne(mulRat(upperBound, rat(baseline.denominator, baseline.numerator)));
  check(cmpRat(u, ratio) < 0, "V8 反例中 u 应小于 r");
  check(lossSumAtOrBelow(u, incumbent),
    "V8 反例中损失和判据仍会触发（证明其不健全）");
  check(cmpRat(ratio, incumbent) > 0,
    "V8 反例中真实比值严格改善 incumbent（与剪枝结论矛盾）");
}

record("V8 J*=n 边界", "所有单职业判据都触发；无非冗余空间");

{
  const n = 3;
  const incumbent = rat(n);
  for (let b = 1; b <= 6; b += 1) {
    for (let a = 0; a <= b; a += 1) {
      check(perJobFiresForRatio(a, b, incumbent, n),
        "V8 J*=n 时所有 u<=1 都应触发单职业判据");
    }
  }
  check(nonRedundancyWitness(n, incumbent) === undefined,
    "V8 J*=n 时不应存在非冗余见证");
}

record("V8 浮点比较风险", "两类方向相反的误判");

{
  // 精确 1/10 + 7/10 = 8/10；double 求和为 0.7999999999999999 < 0.8。
  const exactSum = sumRat([rat(1, 10), rat(7, 10)]);
  check(cmpRat(exactSum, rat(8, 10)) === 0, "V8 精确和应为 8/10");
  const doubleSum = 1 / 10 + 7 / 10;
  check(doubleSum < 0.8, "V8 double 和应小于 0.8");
  // 精确 sum > 8/10，但 double 求和仍 <= 0.8：非严格浮点判据会错误剪枝。
  const bigTen = 10n * 10n ** 17n;
  const exactUnsafe = sumRat([rat(1, 10), rat(7n * 10n ** 17n + 1n, bigTen)]);
  check(cmpRat(exactUnsafe, rat(8, 10)) > 0, "V8 精确和应严格大于 8/10");
  const doubleUnsafe = 1 / 10 + (7 / 10 + 1 / Number(bigTen));
  check(doubleUnsafe <= 0.8, "V8 double 和应 <= 0.8（错误剪枝方向）");
  check(lossSumAtOrBelow(exactUnsafe, rat(8, 10)) === false,
    "V8 精确判据不应触发");
  record("V8 浮点实例",
    `exact=8/10+1/(10·10^17) > 8/10，double=${doubleUnsafe} <= 0.8：浮点会错误剪枝`);
}

record("V8 J* 向上取整不安全", "J*_used > 真实 incumbent");

{
  const trueIncumbent = rat(3, 2);
  const inflatedIncumbent = rat(2); // 向上取整后的阈值
  const u = rat(1); // 合法归一化上界（该方案实际 J = 19/10）
  check(lossSumAtOrBelow(u, inflatedIncumbent),
    "V8 膨胀阈值会触发损失和判据");
  check(!lossSumAtOrBelow(u, trueIncumbent) ||
    cmpRat(rat(19, 10), trueIncumbent) > 0,
    "V8 但该方案实际严格改善真实 incumbent");
  // 若用真实 incumbent 作阈值，本方案不应被剪枝：
  check(cmpRat(rat(19, 10), trueIncumbent) > 0,
    "V8 方案 J=19/10 应严格改善 J*=3/2");
}

record("V8 τ<=0 边界", "单职业判据关闭、损失和判据仍可触发");

{
  const n = 2;
  const incumbent = rat(1, 2);
  check(perJobExpected(rat(1, 4), incumbent, n) === false,
    "V8 τ<=0 时单职业判据应关闭");
  check(lossSumAtOrBelow(sumRat([rat(1, 4), rat(1, 4)]), incumbent),
    "V8 损失和判据仍可触发");
}

// ---------------------------------------------------------------------------
// 9. 与生产精确比较函数的 damage/DPS 语义对照
// ---------------------------------------------------------------------------
record("V9 生产精确比较语义", "damage 乘积 / DPS 交叉相乘");

function randomFactors() {
  return {
    weaponDamage: 1 + randomInt(400),
    mainStat: 1 + randomInt(4000),
    determination: 1 + randomInt(2000),
    tenacity: 1 + randomInt(1200),
    critical: 1 + randomInt(2_000_000),
    directHit: 1 + randomInt(6000),
    traitMultiplier: 1,
    gcdCentiseconds: 1 + randomInt(400),
  };
}

let exactCompareChecks = 0;
for (let trial = 0; trial < 500; trial += 1) {
  const incumbent = randomFactors();
  const upper = randomFactors();
  const incumbentProduct = factorProduct(incumbent);
  const upperProduct = factorProduct(upper);
  const damageExpected = upperProduct <= incumbentProduct;
  check(exactCannotImprove(incumbent, upper, false) === damageExpected,
    "V9 damage 语义不一致");
  const dpsExpected = upperProduct * BigInt(incumbent.gcdCentiseconds) <=
    incumbentProduct * BigInt(upper.gcdCentiseconds);
  check(exactCannotImprove(incumbent, upper, true) === dpsExpected,
    "V9 DPS 语义不一致");
  exactCompareChecks += 2;
}
// 非正因子（违反正性前提）时生产实现返回 false（不做不安全剪枝）。
{
  const incumbent = randomFactors();
  const upper = randomFactors();
  upper.critical = 0;
  check(exactCannotImprove(incumbent, upper, false) === false,
    "V9 非正因子应保守返回 false");
}

record("V9 统计", `精确比较检查=${exactCompareChecks}`);

// ---------------------------------------------------------------------------
// 10. baseStat 归约契约（贡献坐标 vs 面板总值）
//    参考模型 §2.1/§2.2：equippedAttributeTier 先 value = baseStats[stat] + g，
//    再减 sub/main；由生成数据派生 baseStats.CRT=DHT=TEN(=SKS=SPS)=sub、DET=main，
//    故档位公式真正看到的是贡献 g，而不是面板总值。本段把该契约固化为有限证书。
// ---------------------------------------------------------------------------
record("V10 baseStat 归约契约", "baseStats=sub/main、贡献→档位、面板误用、§2.1 数值例子");

const auditLevelModifiers = gameData.jobLevelModifiers;
const AUDIT_LEVELS = Object.keys(auditLevelModifiers).map(Number).sort((a, b) => a - b);
const AUDIT_JOBS = ["RDM", "WAR", "WHM"];

/** 按 equipped-effects.ts:178-203（getBaseStats）的规则从生成数据重算基础属性。 */
function baseStatFor(level, job, stat) {
  const levelMod = auditLevelModifiers[level];
  const schema = gameData.jobSchemas[job];
  const baseStat = gameData.baseStats[stat] ?? 0;
  if (typeof baseStat === "number") return baseStat;
  return floorDiv(
    levelMod[baseStat] * (schema.statModifiers?.[stat] ?? 100),
    100,
  ) + (gameData.clanStats[stat]?.[0] ?? 0);
}

let baseContractChecks = 0;
let contributionTierChecks = 0;
for (const level of AUDIT_LEVELS) {
  const levelMod = auditLevelModifiers[level];
  for (const job of AUDIT_JOBS) {
    const schema = gameData.jobSchemas[job];
    // (a) 副属性基值：CRT/DHT/TEN/SKS/SPS = sub，DET = main（参考模型 §2.1 的数据推导）。
    for (const stat of ["CRT", "DHT", "TEN", "SKS", "SPS"]) {
      check(baseStatFor(level, job, stat) === levelMod.sub,
        `V10 ${stat} 基值应等于 sub（${level}/${job}）`);
      baseContractChecks += 1;
    }
    check(baseStatFor(level, job, "DET") === levelMod.main,
      `V10 DET 基值应等于 main（${level}/${job}）`);
    baseContractChecks += 1;
    // (b) 档位输入是贡献 g：equippedAttributeTier(g) 与 canonical-model t(g) 逐点一致。
    for (const stat of ["CRT", "DHT", "DET", "TEN"]) {
      for (let contribution = 0; contribution <= 3000; contribution += 137) {
        check(canonical.equippedAttributeTier(job, level, stat, contribution) ===
          tier(level, job, stat, contribution),
          `V10 档位输入必须是贡献（${level}/${job}/${stat} g=${contribution}）`);
        contributionTierChecks += 1;
      }
    }
    // (b2) 速度档位：base = sub ⇒ t_speed(g) = floor(130g/div)+1000（也是贡献坐标）。
    const speedStat = schema.stats.includes("SKS") ? "SKS" : "SPS";
    for (let contribution = 0; contribution <= 2000; contribution += 211) {
      check(canonical.equippedAttributeTier(job, level, speedStat, contribution) ===
        floorDiv(130 * contribution, levelMod.div) + 1000,
        `V10 速度档位输入必须是贡献（${level}/${job} g=${contribution}）`);
      contributionTierChecks += 1;
    }
    // (c) 面板值误用反例：把 面板总值（基值 + g）当作贡献传入会得到不同（更大）档位。
    const crtBase = baseStatFor(level, job, "CRT");
    const detBase = baseStatFor(level, job, "DET");
    check(canonical.equippedAttributeTier(job, level, "CRT", crtBase) >
      canonical.equippedAttributeTier(job, level, "CRT", 0),
      `V10 面板值误用应改变 CRT 档位（${level}/${job}）`);
    check(canonical.equippedAttributeTier(job, level, "DET", detBase) >
      canonical.equippedAttributeTier(job, level, "DET", 0),
      `V10 面板值误用应改变 DET 档位（${level}/${job}）`);
    baseContractChecks += 2;
  }
}
// (d) 参考模型 §2.1 的 70 级面板→贡献→档位数值例子。
{
  const level = 70;
  const levelMod = auditLevelModifiers[level];
  const crtContribution = 739 - levelMod.sub;
  const dhtContribution = 743 - levelMod.sub;
  const detContribution = 769 - levelMod.main;
  check(crtContribution === 375 && dhtContribution === 379 && detContribution === 477,
    "V10 参考模型 70 级面板换算数字不一致");
  check(tier(level, "WHM", "CRT", crtContribution) === 133, "V10 例子 CRT 档位应为 133");
  check(tier(level, "WHM", "DHT", dhtContribution) === 231, "V10 例子 DHT 档位应为 231");
  check(tier(level, "WHM", "DET", detContribution) === 1074, "V10 例子 DET 档位应为 1074");
  baseContractChecks += 6;
}
// (e) 审计注意事项：攻击主属性基值一般 != main（statModifiers、clanStats）；
//     其“面板−main”换算不成立，但求值器输入仍是贡献 g_attack（以 getBaseStats 为基准）。
{
  const level = 100;
  const levelMod = auditLevelModifiers[level];
  const attackStat = gameData.jobSchemas["WAR"].attackStat;
  const attackBase = baseStatFor(level, "WAR", attackStat);
  check(attackBase !== levelMod.main,
    "V10 攻击主属性基值一般 != main（面板−main 换算只对 CRT/DHT/TEN/DET 成立）");
  record("V10 攻击主属性基值示例",
    `WAR L100 ${attackStat} base=${attackBase}，main=${levelMod.main}（≠；面板↔贡献按 getBaseStats 基准）`);
  baseContractChecks += 1;
}

record("V10 统计", `base 检查=${baseContractChecks}；贡献→档位检查=${contributionTierChecks}`);
record("V10 坐标结论", "本文所有属性样本/档位/U 构造均在贡献坐标 g 上（V10 显式核验）");


// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
console.log("joint-loss-sum-bound 有限证书全部通过");
for (const entry of report) {
  console.log(`- ${entry.name}: ${entry.detail}`);
}
console.log(`总断言数: ${checks}`);
