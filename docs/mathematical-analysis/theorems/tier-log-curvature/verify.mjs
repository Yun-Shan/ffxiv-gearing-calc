/**
 * tier-log-curvature/verify.mjs
 *
 * 目的：为 theorems/tier-log-curvature/README.md 的定理 B 提供**有限域数值证书**。
 *
 * 覆盖范围（确定性、只读，不启动搜索/优化/MIP）：
 *   1) 离散对数凸凹定义的两向等价（E 与比值单调性）在有限 t 区间逐点核对。
 *   2) CRT 二次因子 E_b(t) 的闭式与切换点：b=350（普通）切换 808/809、b=150（BLU）切换 921/922。
 *   3) F_b(t) 的全局正性（所有整数 t）与最小值位置。
 *   4) DHT/DET 线性因子族的严格对数凹性：任意步长 k 的 E=-k^2（DET 含 detTrunc）。
 *   5) 可达区间前提：t_CRT=808 所需贡献 g_808 与 g_809 逐等级列表。
 *   6) raw 级失败：阶梯/平台机制的精确反例（level 70 DHT、level 70 CRT），
 *      以及全部等级 × 因子族的 E_raw 双符号证书与比值非单调证书。
 *   7) 与 canonical evaluator 的因子对照（有限点）。
 *   8) 边界：跨切换区间、BLU 等级上限、DET 粒度。
 *   9) baseStat 坐标审计（§13）：g_808 的贡献语义、面板↔贡献换算、误用面板值的偏差、
 *      因子/判据/切换点只读档位 t。
 *
 * 证明作用：只是有限点证书；一般性证明在 README.md §5-§7。
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/tier-log-curvature/verify.mjs
 */
import {
  DOCUMENTED_LEVEL_PARAMS,
  assert,
  criticalFactor,
  determinationFactor,
  directHitFactor,
  firstContributionWithTierAtLeast,
  loadCanonicalEvaluator,
  loadGameData,
  tier,
  tierParameters,
} from "../../verification/canonical-model.mjs";

const LEVELS = [50, 60, 70, 80, 90, 100];
const report = [];
function record(name, detail) {
  report.push({ name, detail });
}

const data = await loadGameData();
const canonical = await loadCanonicalEvaluator();

// 精确整数工具（BigInt，避免任何浮点/溢出歧义）
const big = (x) => BigInt(x);
/** F_b(t) = 1e6 + t(t+b) */
const crtFactorAtTier = (t, b) => 1_000_000 + t * (t + b);
/** E_b(t) = F(t+2)F(t) - F(t+1)^2（直接按定义） */
function crtE(t, b) {
  return (
    big(crtFactorAtTier(t + 2, b)) * big(crtFactorAtTier(t, b)) -
    big(crtFactorAtTier(t + 1, b)) ** 2n
  );
}
/** 闭式 E_b(t) = 2e6 - 2t^2 - (2b+4)t - (b+1)^2 */
function crtEClosed(t, b) {
  return 2_000_000 - 2 * t * t - (2 * b + 4) * t - (b + 1) ** 2;
}
const signOf = (value) => (value > 0n ? 1 : value < 0n ? -1 : 0);

// ---------------------------------------------------- 1. 定义等价性（两向）
let equivalenceChecks = 0;
for (const b of [350, 150]) {
  for (let t = 0; t <= 2000; t += 1) {
    const e = crtE(t, b);
    // 比值 r(t+1) ? r(t)  <=>  F(t+2)F(t) ? F(t+1)^2
    const ratioUp = big(crtFactorAtTier(t + 2, b)) * big(crtFactorAtTier(t, b)) >
      big(crtFactorAtTier(t + 1, b)) ** 2n;
    const ratioDown = big(crtFactorAtTier(t + 2, b)) * big(crtFactorAtTier(t, b)) <
      big(crtFactorAtTier(t + 1, b)) ** 2n;
    assert((e > 0n) === ratioUp && (e < 0n) === ratioDown, `E 与比值单调性不等价 b=${b} t=${t}`);
    // 正性前提（log 有定义）
    assert(crtFactorAtTier(t, b) > 0 && crtFactorAtTier(t + 1, b) > 0 && crtFactorAtTier(t + 2, b) > 0, "F_b 非正");
    equivalenceChecks += 1;
  }
}
record("definition-equivalence", `${equivalenceChecks} 个 (b,t) 点验证 E 符号 ⇔ 比值单调性（且 F>0）`);

// ---------------------------------------- 2. 闭式、切换点、单调性、全局正性
let closedFormChecks = 0;
for (const b of [350, 150]) {
  const switchT = b === 350 ? 808 : 921;
  for (let t = -2000; t <= 5000; t += 1) {
    assert(crtEClosed(t, b) === Number(crtE(t, b)), `E 闭式不符 b=${b} t=${t}`);
    closedFormChecks += 1;
    // F_b(t) > 0 对所有整数 t（b∈{150,350}；一般 b^2<4e6 即可）
    assert(crtFactorAtTier(t, b) > 0, `F_b 非正 b=${b} t=${t}`);
  }
  // 严格递减：E(t)-E(t+1)=4t+2b+6>0（t>=0）
  for (let t = 0; t <= 5000; t += 1) {
    assert(crtEClosed(t, b) - crtEClosed(t + 1, b) === 4 * t + 2 * b + 6, "E 差分恒等式不符");
    assert(crtEClosed(t, b) - crtEClosed(t + 1, b) > 0, "E 在 t>=0 上非严格递减");
  }
  // 切换点符号区间
  assert(crtEClosed(switchT, b) > 0, `切换点前一格应为正 b=${b}`);
  assert(crtEClosed(switchT + 1, b) < 0, `切换点后一格应为负 b=${b}`);
  for (let t = 0; t <= switchT; t += 1) assert(crtEClosed(t, b) > 0, `凸区间出现非正 b=${b} t=${t}`);
  for (let t = switchT + 1; t <= 6000; t += 1) assert(crtEClosed(t, b) < 0, `凹区间出现非负 b=${b} t=${t}`);
}
// 精确数值（README 引用）
assert(crtEClosed(808, 350) === 2239 && crtEClosed(809, 350) === -1699, "b=350 切换点数值不符");
assert(crtEClosed(921, 150) === 733 && crtEClosed(922, 150) === -3257, "b=150 切换点数值不符");
assert(crtEClosed(0, 350) === 1_876_799 && crtEClosed(0, 150) === 1_977_199, "E_b(0) 数值不符");
// F_b 全局最小（整数 t）：b=350 -> t=-175, F=969375；b=150 -> t=-75, F=994375
assert(crtFactorAtTier(-175, 350) === 969_375 && crtFactorAtTier(-174, 350) >= 969_375, "b=350 最小值不符");
assert(crtFactorAtTier(-75, 150) === 994_375 && crtFactorAtTier(-74, 150) >= 994_375, "b=150 最小值不符");
record(
  "crt-closed-form-and-switch",
  `${closedFormChecks} 个 (b,t) 点闭式成立；b=350 切换 808/809（E=2239/-1699），b=150 切换 921/922（E=733/-3257）；` +
    "F_b 对所有整数 t 为正（最小值 969375 / 994375）",
);

// ------------------------------------------------------- 3. DHT/DET 严格对数凹
let linearChecks = 0;
for (let t = 0; t <= 2000; t += 1) {
  for (let k = 1; k <= 50; k += 1) {
    const A = 4000;
    const e = big(A + t + 2 * k) * big(A + t) - big(A + t + k) ** 2n;
    assert(e === -(big(k) ** 2n), `DHT 对数凹失败 A=4000 t=${t} k=${k}`);
    const eDet = big(t + 2 * k) * big(t) - big(t + k) ** 2n;
    assert(eDet === -(big(k) ** 2n), `DET 对数凹失败 A=0 t=${t} k=${k}`);
    linearChecks += 2;
  }
}
// DET 含 detTrunc：每档步长 mult=detTrunc，E=-(mult*k)^2
let detSampledChecks = 0;
for (const level of LEVELS) {
  const p = tierParameters(level, "WHM", "DET");
  assert(p.mult === DOCUMENTED_LEVEL_PARAMS[level].detTrunc, `DET mult 参数不符 level=${level}`);
  const t0 = tier(level, "WHM", "DET", 0);
  assert(t0 === 1000, `DET 基线档位不是 1000 level=${level}`);
  for (let k = 1; k <= 50; k += 1) {
    const step = p.mult * k; // 跨 k 个“可达到档位”的步长
    const e = big(t0 + 2 * step) * big(t0) - big(t0 + step) ** 2n;
    assert(e === -(big(step) ** 2n), `DET 采样步长对数凹失败 level=${level} k=${k}`);
    detSampledChecks += 1;
  }
}
record("linear-families", `${linearChecks} 个 (t,k) 点验证 DHT(A=4000)/DET(A=0) 的 E=-k^2`);
record("det-sampling", `${detSampledChecks} 个 (level,k) 点验证含 detTrunc 时 E=-(mult*k)^2，DET 基线恒为 1000`);

// ------------------------------------------ 4. 比值峰值：r_809 / r_922 是严格局部最大
{
  const ratioCompare = (t, b) =>
    signOf(big(crtFactorAtTier(t + 2, b)) * big(crtFactorAtTier(t, b)) - big(crtFactorAtTier(t + 1, b)) ** 2n);
  for (const [b, peak] of [[350, 809], [150, 922]]) {
    // E(t)>0 ⇔ r(t+1)>r(t)；E(t)<0 ⇔ r(t+1)<r(t)
    assert(ratioCompare(peak - 1, b) > 0, `峰值左侧比值未上升 b=${b}`);
    assert(ratioCompare(peak, b) < 0, `峰值右侧比值未下降 b=${b}`);
    // 峰值唯一且全局：t<peak-1 时上升，t>peak 时下降
    for (let t = 0; t < peak - 1; t += 1) assert(ratioCompare(t, b) > 0, `peak 前出现下降 b=${b} t=${t}`);
    for (let t = peak; t <= 5000; t += 1) assert(ratioCompare(t, b) < 0, `peak 后出现上升 b=${b} t=${t}`);
  }
}
record("ratio-peak", "b=350 的比值峰值在 r_809，b=150 在 r_922（严格单峰）");

// ------------------------------------------------- 5. 可达区间前提（g_808 / g_809）
const g808 = new Map();
for (const level of LEVELS) {
  for (const job of ["WHM", "BLU"]) {
    const g = firstContributionWithTierAtLeast(level, job, "CRT", 808);
    g808.set(`${level}/${job}`, g);
    assert(tier(level, job, "CRT", g) === 808, `g_808 档位不符 ${level}/${job}`);
    assert(tier(level, job, "CRT", g - 1) === 807, `g_808-1 档位不符 ${level}/${job}`);
  }
}
// 文档表格中的精确值
const expectedG808 = {
  "50/WHM": 1293, "50/BLU": 952,
  "60/WHM": 2274, "60/BLU": 1674,
  "70/WHM": 3411, "70/BLU": 2511,
  "80/WHM": 4927, "80/BLU": 3627,
  "90/WHM": 7201, "90/BLU": 5301,
  "100/WHM": 10537, "100/BLU": 7757,
};
for (const [key, value] of Object.entries(expectedG808)) {
  assert(g808.get(key) === value, `g_808 表值不符 ${key}: ${g808.get(key)} vs ${value}`);
}
// BLU 的 b_C=150 切换点（t=921）在 L80 的贡献门槛
const bluL80G921 = firstContributionWithTierAtLeast(80, "BLU", "CRT", 921);
assert(bluL80G921 === 4362, `BLU L80 g_921 期望 4362 实际 ${bluL80G921}`);
record(
  "reachable-region",
  "g_808 表值（普通 1293/2274/3411/4927/7201/10537；BLU 952/1674/2511/3627/5301/7757）与 t(g_808)=808 成立；" +
    "BLU L80 的 b=150 切换门槛 g_921=4362",
);

// ------------------------------------- 6. raw 级失败：精确反例与双符号证书
// 6a) level 70 DHT 精确表（g=0..12）
{
  const G = (g) => 4000 + tier(70, "WHM", "DHT", g);
  const expectedG = [4000, 4000, 4001, 4001, 4002, 4003, 4003, 4004, 4004, 4005, 4006, 4006, 4007];
  const expectedE = [4000n, -4001n, 4001n, -1n, -4003n, 4003n, -4004n, 4004n, -1n, -4006n, 4006n, -4007n, 4007n];
  for (let g = 0; g <= 12; g += 1) {
    assert(G(g) === expectedG[g], `L70 DHT G(${g}) 不符`);
    const e = big(G(g + 2)) * big(G(g)) - big(G(g + 1)) ** 2n;
    assert(e === expectedE[g], `L70 DHT E_raw(${g}) 不符：${e} vs ${expectedE[g]}`);
  }
  // 开头三点即已破坏 tier 级凸性：r0<r1, r1>r2
  const ratioUp = big(G(2)) * big(G(0)) - big(G(1)) ** 2n; // E(0) ⇒ r1>r0
  const ratioDown = big(G(3)) * big(G(1)) - big(G(2)) ** 2n; // E(1) ⇒ r2<r1
  assert(ratioUp > 0n && ratioDown < 0n, "L70 DHT 开头比值非单调证书失效");
}
// 6b) level 70 CRT 平台/跳变机制（E_raw 先正后负）
{
  const F = (g) => criticalFactor(tier(70, "WHM", "CRT", g), "WHM");
  assert(F(3) === 1_020_000 && F(5) === 1_020_451, "L70 CRT 平台值不符");
  const e3 = big(F(5)) * big(F(3)) - big(F(4)) ** 2n;
  const e4 = big(F(6)) * big(F(4)) - big(F(5)) ** 2n;
  assert(e3 === 460_020_000n && e4 === -460_223_401n, `L70 CRT E_raw 机制值不符：${e3}, ${e4}`);
}
// 6c) 全实例双符号证书 + raw 比值非单调证书（g∈[0,300]）
const rawFactorFamilies = [];
for (const level of LEVELS) {
  rawFactorFamilies.push({ level, key: "CRT/普通", stat: "CRT", job: "WHM" });
  rawFactorFamilies.push({ level, key: "CRT/BLU", stat: "CRT", job: "BLU" });
  rawFactorFamilies.push({ level, key: "DHT", stat: "DHT", job: "WHM" });
  rawFactorFamilies.push({ level, key: "DET", stat: "DET", job: "WHM" });
  rawFactorFamilies.push({ level, key: "TEN", stat: "TEN", job: "WHM" });
}
let rawChecks = 0;
const rawSigns = [];
for (const family of rawFactorFamilies) {
  const G = (g) => {
    const t = tier(family.level, family.job, family.stat, g);
    if (family.stat === "CRT") return criticalFactor(t, family.job);
    if (family.stat === "DHT") return directHitFactor(t);
    return t; // DET / TEN
  };
  let positive = false;
  let negative = false;
  let zeros = 0;
  for (let g = 0; g <= 300; g += 1) {
    const e = big(G(g + 2)) * big(G(g)) - big(G(g + 1)) ** 2n;
    if (e === 0n) zeros += 1;
    if (e > 0n) positive = true;
    if (e < 0n) negative = true;
    rawChecks += 1;
  }
  assert(positive && negative, `raw E 未出现双符号：${family.level}/${family.key}`);
  rawSigns.push({ family: `${family.level}/${family.key}`, zeros });
}
record(
  "raw-level-refutation",
  `${rawChecks} 个 raw 点：全部 ${rawFactorFamilies.length} 个 (level,因子族) 组合的 E_raw 均出现正负双符号；` +
    "L70 DHT 精确表（E(0)=+4000, E(1)=-4001, E(2)=+4001, E(3)=-1, E(4)=-4003, ...）；" +
    "L70 CRT 平台/跳变 E(3)=+460020000, E(4)=-460223401",
);

// ------------------------------------- 7. 与 canonical evaluator 的因子对照（有限点）
{
  const sampleContributions = [0, 1, 2, 5, 17, 100, 500, 1000, 2000, 3000];
  let factorChecks = 0;
  for (const level of LEVELS) {
    for (const job of ["WHM", "BLU"]) {
      const statIndexes = new Map([["CRT", 0], ["DHT", 1], ["DET", 2], ["TEN", 3]]);
      const evaluate = canonical.createIntegerDamageFactorEvaluator(job, level, statIndexes);
      for (const crt of sampleContributions) {
        for (const dht of sampleContributions) {
          for (const det of sampleContributions) {
            const ten = sampleContributions[(crt + dht + det) % sampleContributions.length];
            const factors = evaluate([crt, dht, det, ten]);
            assert(factors !== undefined, `canonical 因子返回 undefined ${level}/${job}`);
            const b = job === "BLU" ? 150 : 350;
            assert(
              factors.critical === crtFactorAtTier(tier(level, job, "CRT", crt), b),
              `critical 与 tier 级公式不一致 ${level}/${job}/${crt}`,
            );
            assert(
              factors.directHit === 4000 + tier(level, job, "DHT", dht),
              `directHit 与 tier 级公式不一致 ${level}/${job}/${dht}`,
            );
            assert(
              factors.determination === tier(level, job, "DET", det),
              `determination 与 tier 级公式不一致 ${level}/${job}/${det}`,
            );
            assert(factors.critical > 0 && factors.directHit > 0 && factors.determination > 0, "因子非正");
            factorChecks += 1;
          }
        }
      }
    }
  }
  record("canonical-factors", `${factorChecks} 个 (level,job,CRT,DHT,DET) 点的 canonical 因子与 tier 级公式一致且为正`);
}

// ------------------------------------------- 8. 边界与切换区间的处理证书
{
  // b=350 切换区间示例：t∈[800,850] 同时含 E>0 的左侧点与 E<0 的右侧点
  assert(crtEClosed(806, 350) > 0 && crtEClosed(809, 350) < 0, "跨切换示例失效");
  // 可达区间跨切换时既不能整体凸也不能整体凹
  let hasPositive = false;
  let hasNegative = false;
  for (let t = 800; t <= 848; t += 1) {
    if (crtEClosed(t, 350) > 0) hasPositive = true;
    if (crtEClosed(t, 350) < 0) hasNegative = true;
  }
  assert(hasPositive && hasNegative, "跨切换区间的双符号判断失效");
  // BLU 等级上限
  assert(data.jobSchemas.BLU.maxJobLevel === 80, "BLU 上限等级变化");
  // DET 在 detTrunc>1 的等级 50/60 上档位仍为 detTrunc 的倍数
  for (const level of [50, 60]) {
    const p = tierParameters(level, "WHM", "DET");
    for (let g = 0; g <= 3000; g += 1) {
      assert(tier(level, "WHM", "DET", g) % p.mult === 0, `DET 档位粒度失败 level=${level} g=${g}`);
    }
  }
}
record(
  "boundary-cases",
  "切换区间 t∈[800,850] 同时含 E>0/E<0（必须禁用整段曲率层）；BLU 上限 80；L50/L60 的 DET 档位保持 detTrunc 粒度",
);

// --------------------------- 10. baseStat 坐标审计（贡献坐标 vs 面板总值，README §13）
// 10a) 坐标声明：本文的因子/判据/切换点是**档位坐标 t**；g_808/g_809、BLU g_921、raw 表与
//      G_max 是**贡献坐标 g**（面板总值 X = 基础属性 sub/main + g）。本脚本全部输入符合该约定。
// 10b) g_808 是贡献：面板 = sub + g_808；误把面板值当贡献会多算 floor(...) 档，全等级断言。
{
  const misuseRows = [];
  const expectedWrong = { 50: 1008, 70: 888, 100: 838 };
  for (const level of LEVELS) {
    const { sub } = DOCUMENTED_LEVEL_PARAMS[level];
    const g808 = firstContributionWithTierAtLeast(level, "WHM", "CRT", 808);
    assert(tier(level, "WHM", "CRT", g808) === 808, `L${level} g_808 贡献语义不符`);
    const panelValue = sub + g808; // 面板 CRT
    const wrongTier = tier(level, "WHM", "CRT", panelValue); // 误把面板值当贡献
    assert(wrongTier > 808, `L${level} 面板值误用应偏高`);
    assert(tier(level, "WHM", "CRT", panelValue - sub) === 808, `L${level} 正确换算应回到 808`);
    misuseRows.push(`${level}: g_808=${g808}, 面板=${panelValue}, 误代=${wrongTier}(+${wrongTier - 808})`);
    if (expectedWrong[level] !== undefined) {
      assert(wrongTier === expectedWrong[level], `L${level} 误用面板值偏差与 README §13.4 不符`);
    }
  }
  // BLU 等级 80 的 g_921 贡献语义：面板 CRT = sub + g_921
  const { sub: sub80 } = DOCUMENTED_LEVEL_PARAMS[80];
  assert(firstContributionWithTierAtLeast(80, "BLU", "CRT", 921) === 4362, "BLU L80 g_921 不符");
  assert(tier(80, "BLU", "CRT", sub80 + 4362) > 921, "BLU L80 面板值误用应偏高");
  record(
    "coordinate-audit-g808-contribution",
    `g_808 是贡献坐标（面板 = sub + g_808）；误用面板值的偏差：${misuseRows.join("；")}；BLU L80 g_921=4362（面板 ${sub80 + 4362}）`,
  );
}
// 10c) 参考模型 §2.1 的 L70 面板→贡献换算示例复核。
{
  const { main, sub } = DOCUMENTED_LEVEL_PARAMS[70];
  assert(tier(70, "WHM", "CRT", 739 - sub) === 133, "L70 面板 CRT 换算档位不符");
  assert(tier(70, "WHM", "DHT", 743 - sub) === 231, "L70 面板 DHT 换算档位不符");
  assert(tier(70, "WHM", "DET", 769 - main) === 1074, "L70 面板 DET 换算档位不符");
  record(
    "coordinate-audit-panel-conversion",
    "参考模型 §2.1 示例：面板 CRT/DHT/DET=739/743/769 ⇒ 贡献 375/379/477 ⇒ 档位 133/231/1074（面板 = 贡献 + sub/main）",
  );
}
// 10d) 因子/判据/切换点只读档位 t：同一档位值无论来自哪条贡献路径，E 与比值结果相同；
//      并断言切换点 808/809、921/922 是档位坐标（E 符号），不是贡献或面板值。
{
  const e808 = crtEClosed(808, 350);
  const e809 = crtEClosed(809, 350);
  assert(e808 === 2239 && e809 === -1699, "切换点档位坐标复核失败");
  // 档位 t=808 的因子值不含 baseStat：直接由因子公式给出，与贡献来源无关。
  assert(crtFactorAtTier(808, 350) === 1_935_664, "t=808 的 CRT 因子值不符");
  assert(criticalFactor(808, "WHM") === crtFactorAtTier(808, 350), "canonical 因子与档位公式不一致");
  record(
    "coordinate-audit-tier-only",
    "因子/判据/切换点只读档位 t（E(808)=2239, E(809)=-1699；F_350(808)=1,935,664），baseStat 不进入表达式",
  );
}

// ---------------------------------------------------------------- 输出报告
console.log("tier-log-curvature verification: PASS");
for (const entry of report) console.log(`  [ok] ${entry.name}: ${entry.detail}`);
console.log(
  "scope: 全部支持等级 × {CRT 普通, CRT BLU, DHT, DET, TEN} 的有限点证书；" +
    "闭式、切换点、线性族、可达前提、raw 级反例均已覆盖。",
);
console.log("这不是一般性证明；一般性证明见同目录 README.md 的 §5-§7。");
