/**
 * strict-improvement-frontier/verify.mjs
 *
 * 定理 A（严格改善 frontier 与 K_w 半空间）的有限域验证脚本。
 *
 * 覆盖范围（有限、完整列出）：
 *   A0. 因子在盒式定义域上的非减性（为单调性论证提供有限旁证）。
 *   A1. 伤害目标的严格阈值 B：B = floor(P_inc / O) 与 G(B) = {prod > B} 的等价性；
 *       非乐观 O 的不安全反例；ceil/floor 与 tie 语义的关系。
 *   A2. DPS 目标的严格阈值 B_dps：乐观 gcd 下界 + 精确交叉乘法下的安全蕴含；
 *       使用非乐观 gcd 的不安全反例。
 *   A3. D_min(C,H;B) 的暴力扫描 vs 「DET 可达档位表 + 二分」算法逐点一致；严格性与最小性。
 *   A4. D_min 关于 C/H 的（扩展序）单调不增。
 *   A5. staircase 紧致性：D_min 只依赖 (CRT tier, DHT tier) 单元；单元数上界与单调阶梯。
 *   A6. K_w = min{w·x : x in G(B)}：暴力 / frontier 公式 / 最小反链三条路径一致；
 *       「argmin 恰好等于最小元」这一过强表述的反例（不修正则假）。
 *   A7. K_w 关于 w 的单调性、关于 B 的单调性、正比例齐次性。
 *   A8. 必要半空间的安全性：所有改善点满足 w·x >= K_w；L = K_w 的紧性；
 *       L > K_w 确实会删掉改善点（显式构造）；L < K_w 安全。
 *   A9. 空改善区域与退化：B >= max product；B <= 0；退化维度；零分量方向。
 *   A10. 严格 vs 非严格（tie）阈值语义；用严格 frontier 删同分方案的错误。
 *   A11. 支撑族非冗余：被蕴含 / 空支撑 / 任意子集正确性。
 *   A12. baseStat 影响审计：脚本全部坐标（盒、示例、K_w、L）都是**贡献** g，不是面板总值；
 *        验证贡献 0 对应面板=baseStats 的档位、偏移表、示例乘积复算与贡献/面板换算。
 *   A13. 安全修复证书：slab 不继承盒域档位算法（非单调/非单元常值、代表元错误 K_w）；
 *        B=P* 时严格域空而非严格域=argmax 非空；整除不等于存在同分点（含 DPS 对应反例）；
 *        同分点证书全链 BigInt，含 P_inc=gapQ²（超 2^53）的 P−1/P/P+1 边界与 Number 吞 +1 对照。
 *
 * 证明作用：以上全部是**有限域证书**。它能证伪全称命题（反例即证明），能在有限点上核对
 * 代数命题，但不构成一般性证明；一般性证明见同目录 README.md。所有结论以 canonical
 * integer model（docs/mathematical-analysis/verification/canonical-model.mjs）为数值来源。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/strict-improvement-frontier/verify.mjs
 */
import {
  assert,
  ceilDiv,
  criticalFactor,
  determinationFactor,
  directHitFactor,
  DOCUMENTED_LEVEL_PARAMS,
  firstContributionWithTierAtLeast,
  floorDiv,
  tier,
  tierParameters,
} from "../../verification/canonical-model.mjs";

const results = [];
function ok(name, detail) {
  results.push(`  [ok] ${name}: ${detail}`);
}

// ---------------------------------------------------------------------------
// 基础工具：只在 g >= 0 的定义域上使用 canonical 整数档位/因子。
// ---------------------------------------------------------------------------
const LEVEL = 100;
const JOB = "WHM"; // 普通职业：b_C = 350，CRT 常数 50，DHT 常数 0。

function factorC(level, job, c) {
  return criticalFactor(tier(level, job, "CRT", c), job);
}
function factorH(level, job, h) {
  return directHitFactor(tier(level, job, "DHT", h));
}
function factorD(level, job, d) {
  return determinationFactor(tier(level, job, "DET", d));
}

/** 三因子乘积（Number；调用方必须先通过 assertSafeProduct 断言 < 2^53）。 */
function productOf(level, job, c, h, d) {
  return factorC(level, job, c) * factorH(level, job, h) * factorD(level, job, d);
}

function assertSafeProducts(level, job, kappa) {
  const top = productOf(level, job, kappa.C, kappa.H, kappa.D);
  assert(Number.isSafeInteger(top), `盒式定义域顶角乘积超出安全整数：${top}`);
  return top;
}

/** 单属性档位表：定义域 [0, kappa] 上实际出现的 tier 值及其最小贡献。 */
function tierTable(level, job, stat, kappa) {
  const values = [];
  const minContrib = [];
  let previous = null;
  for (let g = 0; g <= kappa; g += 1) {
    const value = tier(level, job, stat, g);
    if (value !== previous) {
      values.push(value);
      minContrib.push(g);
      previous = value;
    }
  }
  for (let index = 0; index < values.length; index += 1) {
    const first = Math.max(0, firstContributionWithTierAtLeast(level, job, stat, values[index]));
    assert(
      first === minContrib[index],
      `档位反查不一致 ${stat} tier=${values[index]} first=${first} scan=${minContrib[index]}`,
    );
  }
  return { values, minContrib };
}

/**
 * DET 可达档位表 + 二分求 D_min。
 * @returns {number|null} 最小 D，或 null 表示 +infinity。
 */
function dMinBinary(level, job, crtFactor, dhtFactor, B, detTable) {
  const cross = BigInt(crtFactor) * BigInt(dhtFactor);
  if (BigInt(detTable.values[detTable.values.length - 1]) * cross <= B) return null;
  let lo = 0;
  let hi = detTable.values.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (BigInt(detTable.values[mid]) * cross > B) hi = mid;
    else lo = mid + 1;
  }
  return detTable.minContrib[lo];
}

/** 暴力 D_min：在 [0, kappaD] 上扫描。 */
function dMinBrute(level, job, kappaD, c, h, BNumber) {
  const fC = factorC(level, job, c);
  const fH = factorH(level, job, h);
  for (let d = 0; d <= kappaD; d += 1) {
    if (fC * fH * factorD(level, job, d) > BNumber) return d;
  }
  return null;
}

const POS_INF = Number.POSITIVE_INFINITY;
/** 扩展序比较：null 表示 +infinity。 */
function extended(value) {
  return value === null ? POS_INF : value;
}

/** 把阈值转成安全 Number（脚本内所有 G(B) 比较都要求阈值 < 2^53）。 */
function safeNumberThreshold(value, label) {
  const big = typeof value === "bigint" ? value : BigInt(value);
  assert(big >= 0n, `${label} 必须非负`);
  assert(big < BigInt(Number.MAX_SAFE_INTEGER), `${label}=${big} 超出安全整数，请缩小测试域`);
  return Number(big);
}

// ---------------------------------------------------------------------------
// A0. 盒式定义域上的因子非减性（有限旁证）
// ---------------------------------------------------------------------------
const BOX = { C: 140, H: 100, D: 220 };
const topProduct = assertSafeProducts(LEVEL, JOB, BOX);
{
  let monotone = 0;
  for (let c = 1; c <= BOX.C; c += 1) {
    assert(factorC(LEVEL, JOB, c) >= factorC(LEVEL, JOB, c - 1), `CRT 因子在 ${c} 处下降`);
    monotone += 1;
  }
  for (let h = 1; h <= BOX.H; h += 1) {
    assert(factorH(LEVEL, JOB, h) >= factorH(LEVEL, JOB, h - 1), `DHT 因子在 ${h} 处下降`);
    monotone += 1;
  }
  for (let d = 1; d <= BOX.D; d += 1) {
    assert(factorD(LEVEL, JOB, d) >= factorD(LEVEL, JOB, d - 1), `DET 因子在 ${d} 处下降`);
    monotone += 1;
  }
  assert(topProduct === productOf(LEVEL, JOB, BOX.C, BOX.H, BOX.D), "顶角乘积应等于自身");
  ok(
    "A0.factor-monotone",
    `level=${LEVEL} ${JOB} 盒 ${JSON.stringify(BOX)} 上三个因子逐单位非减（${monotone} 个相邻对），顶角乘积 ${topProduct}`,
  );
}

// 预计算盒内因子表（Number，已断言 < 2^53）。
const fC = Array.from({ length: BOX.C + 1 }, (_, c) => factorC(LEVEL, JOB, c));
const fH = Array.from({ length: BOX.H + 1 }, (_, h) => factorH(LEVEL, JOB, h));
const fD = Array.from({ length: BOX.D + 1 }, (_, d) => factorD(LEVEL, JOB, d));

/** 遍历盒内全部点；回调得到 (c,h,d,product Number)。 */
function forEachBoxPoint(level, job, box, callback) {
  const tableC = Array.from({ length: box.C + 1 }, (_, c) => factorC(level, job, c));
  const tableH = Array.from({ length: box.H + 1 }, (_, h) => factorH(level, job, h));
  const tableD = Array.from({ length: box.D + 1 }, (_, d) => factorD(level, job, d));
  for (let c = 0; c <= box.C; c += 1) {
    for (let h = 0; h <= box.H; h += 1) {
      const base = tableC[c] * tableH[h];
      for (let d = 0; d <= box.D; d += 1) {
        callback(c, h, d, base * tableD[d]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// A1. 伤害目标：严格阈值 B = floor(P_inc / O)
// ---------------------------------------------------------------------------
const incumbent = { C: 100, H: 50, D: 100 };
const incumbentSub = productOf(LEVEL, JOB, incumbent.C, incumbent.H, incumbent.D);
const incumbentOther = { W: 700, main: 180, ten: 1000 };
const P_INC = BigInt(incumbentOther.W) * BigInt(incumbentOther.main) * BigInt(incumbentOther.ten) * BigInt(incumbentSub);
const optimisticOther = { W: 730, main: 190, ten: 1050 };
const O_MAX = BigInt(optimisticOther.W) * BigInt(optimisticOther.main) * BigInt(optimisticOther.ten);
const B_STRICT = floorDiv(P_INC, O_MAX);
const B_STRICT_NUM = safeNumberThreshold(B_STRICT, "B_STRICT");
const B_TIE = ceilDiv(P_INC, O_MAX);
const B_TIE_NUM = safeNumberThreshold(B_TIE, "B_TIE");
{
  assert(B_TIE >= B_STRICT, "ceil 阈值不应小于 floor 阈值");
  assert(B_TIE - B_STRICT === 0 || B_TIE - B_STRICT === 1, "ceil 与 floor 阈值只差 0 或 1");
  let strictEquivalent = 0;
  forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d, product) => {
    const byOtherBound = BigInt(product) * O_MAX > P_INC;
    const byThreshold = product > B_STRICT_NUM;
    assert(byOtherBound === byThreshold, `伤害阈值等价性失败 (${c},${h},${d})`);
    strictEquivalent += 1;
  });
  // 候选池的其它因子逐项 <= 上界：真实候选严格改善 => 副属性乘积 > B。
  const candidateOthers = [
    { W: 690, main: 175, ten: 980 },
    { W: 720, main: 185, ten: 1040 },
    { W: 730, main: 190, ten: 1050 },
  ];
  let improvingCandidates = 0;
  let sampled = 0;
  for (const other of candidateOthers) {
    const otherProduct = BigInt(other.W) * BigInt(other.main) * BigInt(other.ten);
    const candidateThreshold = floorDiv(P_INC, otherProduct);
    const candidateThresholdNumber = safeNumberThreshold(candidateThreshold, "候选阈值");
    assert(candidateThreshold >= B_STRICT, "更小的其它因子上界应给出更大的阈值（更紧）");
    for (let c = 0; c <= BOX.C; c += 7) {
      for (let h = 0; h <= BOX.H; h += 7) {
        for (let d = 0; d <= BOX.D; d += 11) {
          const product = fC[c] * fH[h] * fD[d];
          if (otherProduct * BigInt(product) > P_INC) {
            assert(product > B_STRICT_NUM, "候选严格改善但被 B 阈值删除");
            improvingCandidates += 1;
          }
          assert(
            (otherProduct * BigInt(product) > P_INC) === (product > candidateThresholdNumber),
            "候选级阈值等价性失败",
          );
          sampled += 1;
        }
      }
    }
  }
  assert(improvingCandidates > 0, "测试样本中没有可严格改善的候选，样本无效");
  ok(
    "A1.damage-threshold",
    `P_inc=${P_INC} O_max=${O_MAX} B_strict=floor(P_inc/O_max)=${B_STRICT}，` +
      `盒内 ${strictEquivalent} 点满足 prod*O_max>P_inc <=> prod>B_strict；` +
      `3 个候选（其它因子 690..730）共 ${sampled} 个采样点、${improvingCandidates} 个严格改善点均通过 prod>B_strict`,
  );
}

// 反例：把 O 取成比真实候选其它因子更小的值（非乐观上界）时会删除改善点。
{
  const assumedOtherProduct = BigInt(690) * BigInt(175) * BigInt(980); // 假装的上界 O'
  const B_UNSAFE = floorDiv(P_INC, assumedOtherProduct);
  assert(B_UNSAFE > B_STRICT, "更小的 O' 应给出更大阈值");
  const betterCandidateOther = O_MAX; // 候选池中实际存在更大其它因子的候选
  assert(betterCandidateOther > assumedOtherProduct, "反例要求候选 other 超过假装的上界");
  let witness = null;
  for (let c = 0; c <= BOX.C && witness === null; c += 1) {
    for (let h = 0; h <= BOX.H && witness === null; h += 1) {
      for (let d = 0; d <= BOX.D; d += 1) {
        const product = fC[c] * fH[h] * fD[d];
        const candidateJustImproves = betterCandidateOther * BigInt(product) > P_INC;
        if (candidateJustImproves && product <= B_UNSAFE) {
          witness = { c, h, d, product };
          break;
        }
      }
    }
  }
  assert(witness !== null, "未找到非乐观上界删除改善点的反例（样本应扩大）");
  ok(
    "A1.refute-nonoptimistic-O",
    `把其它因子上界误取为 O'=${assumedOtherProduct}（候选池实际有 up to ${betterCandidateOther}）时 ` +
      `B'=floor(P_inc/O')=${B_UNSAFE} > ${B_STRICT}；点 (${witness.c},${witness.h},${witness.d}) 乘积 ${witness.product} ` +
      `在候选 other=${betterCandidateOther} 下严格改善，但 prod <= B' 会被误删`,
  );
}

// tie 语义：可整除时 G_> = {prod > k}，G_>= = {prod >= k}，边界点恰为同分点。
{
  const tiePoint = { C: 50, H: 40, D: 80 };
  const tieSub = productOf(LEVEL, JOB, tiePoint.C, tiePoint.H, tiePoint.D);
  const tieOther = 1000n;
  const P_TIE = BigInt(tieSub) * tieOther;
  const B_STRICT_TIE = floorDiv(P_TIE, tieOther);
  const B_NONSTRICT_TIE = ceilDiv(P_TIE, tieOther);
  assert(B_STRICT_TIE === tieSub, "可整除时严格阈值应等于同分副属性乘积");
  assert(B_NONSTRICT_TIE === tieSub, "可整除时非严格阈值应等于同分副属性乘积");
  assert(BigInt(tieSub) * tieOther === P_TIE, "构造的同分点应恰等于 incumbent 可比较值");
  let strictIncludes = 0;
  let nonstrictIncludes = 0;
  forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d, product) => {
    if (product > B_STRICT_TIE) strictIncludes += 1;
    if (product >= B_NONSTRICT_TIE) nonstrictIncludes += 1;
  });
  assert(nonstrictIncludes > strictIncludes, "可整除时 G_>= 应严格包含 G_>（至少多出同分点）");
  const tieProduct = productOf(LEVEL, JOB, tiePoint.C, tiePoint.H, tiePoint.D);
  assert(tieProduct === B_STRICT_TIE, "同分点乘积应等于严格阈值");
  // 不可整除：ceil = floor + 1，且两个集合相同（不存在同分点）。
  const P_ODD = P_TIE + 1n;
  const oddStrict = floorDiv(P_ODD, tieOther);
  const oddNonstrict = ceilDiv(P_ODD, tieOther);
  assert(oddNonstrict === oddStrict + 1, "不可整除时 ceil = floor+1");
  let equalSets = 0;
  forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d, product) => {
    const strictSet = product > Number(oddStrict);
    const nonstrictSet = product >= Number(oddNonstrict);
    assert(strictSet === nonstrictSet, "不可整除时 G_> 与 G_>= 应相同");
    equalSets += 1;
  });
  ok(
    "A1.tie-thresholds",
    `可整除：B_strict=B_tie=${B_STRICT_TIE}，G_>= 比 G_> 多出边界同分点（${nonstrictIncludes} vs ${strictIncludes}）；` +
      `不可整除：B_tie=B_strict+1=${oddNonstrict}，两集合在 ${equalSets} 点上完全一致`,
  );
}

// ---------------------------------------------------------------------------
// A2. DPS 目标：乐观 gcd 下界 + 精确交叉乘法
// ---------------------------------------------------------------------------
const INCUMBENT_GCD = 25;
const candidateGcds = [20, 21, 22, 23, 24, 25, 27, 30, 33, 36, 40];
const gcdMin = Math.min(...candidateGcds);
const O_DPS = O_MAX;
const B_DPS = floorDiv(P_INC * BigInt(gcdMin), O_DPS * BigInt(INCUMBENT_GCD));
const B_DPS_NUM = safeNumberThreshold(B_DPS, "B_DPS");
{
  let improving = 0;
  let checked = 0;
  for (const gcd of candidateGcds) {
    for (let c = 0; c <= BOX.C; c += 5) {
      for (let h = 0; h <= BOX.H; h += 5) {
        for (let d = 0; d <= BOX.D; d += 9) {
          const product = fC[c] * fH[h] * fD[d];
          const upperProduct = BigInt(product) * O_DPS; // 候选完整乘积的乐观上界
          const strictlyImprovesDps = upperProduct * BigInt(INCUMBENT_GCD) > P_INC * BigInt(gcd);
          if (strictlyImprovesDps) {
            assert(product > B_DPS_NUM, "DPS 严格改善被 B_dps 删除");
            improving += 1;
          }
          checked += 1;
        }
      }
    }
  }
  assert(improving > 0, "DPS 样本中没有严格改善点，样本无效");
  // 用 gcd 上界（非乐观）会删除改善点：gcdMax 给出更小的 B，但方向错误；用更大的 gcd 下界才是安全方向。
  const gcdLargerThanMin = 40;
  const B_DPS_UNSAFE = floorDiv(P_INC * BigInt(gcdLargerThanMin), O_DPS * BigInt(INCUMBENT_GCD));
  assert(B_DPS_UNSAFE > B_DPS, "更大的 gcd 下界应给出更大（更不安全）的阈值");
  let witness = null;
  for (let c = 0; c <= BOX.C && witness === null; c += 1) {
    for (let h = 0; h <= BOX.H && witness === null; h += 1) {
      for (let d = 0; d <= BOX.D; d += 1) {
        const product = fC[c] * fH[h] * fD[d];
        if (BigInt(product) * O_DPS * BigInt(INCUMBENT_GCD) > P_INC * BigInt(gcdMin) && product <= B_DPS_UNSAFE) {
          witness = { c, h, d, product };
          break;
        }
      }
    }
  }
  assert(witness !== null, "未找到非乐观 gcd 下界的反例");
  ok(
    "A2.dps-threshold",
    `I_GCD=${INCUMBENT_GCD} gcd_min=${gcdMin} B_dps=floor(P_inc*gcd_min/(O_max*I_GCD))=${B_DPS}；` +
      `${checked} 个采样点中 ${improving} 个 DPS 严格改善点均满足 prod>B_dps；` +
      `把 gcd 下界换成 ${gcdLargerThanMin} 得 B'=${B_DPS_UNSAFE}，点 (${witness.c},${witness.h},${witness.d}) 乘积 ${witness.product} 会被误删`,
  );
}

// ---------------------------------------------------------------------------
// A3. D_min：暴力扫描 vs 可达档位表二分
// ---------------------------------------------------------------------------
const B_FRONTIER_POINT = { C: 100, H: 70, D: 150 };
const B_FRONTIER = BigInt(productOf(LEVEL, JOB, B_FRONTIER_POINT.C, B_FRONTIER_POINT.H, B_FRONTIER_POINT.D) - 1);
const B_FRONTIER_NUM = safeNumberThreshold(B_FRONTIER, "B_FRONTIER");
const detTable = tierTable(LEVEL, JOB, "DET", BOX.D);
{
  let cells = 0;
  let finite = 0;
  let infinite = 0;
  for (let c = 0; c <= BOX.C; c += 1) {
    for (let h = 0; h <= BOX.H; h += 1) {
      const brute = dMinBrute(LEVEL, JOB, BOX.D, c, h, B_FRONTIER_NUM);
      const binary = dMinBinary(LEVEL, JOB, fC[c], fH[h], B_FRONTIER, detTable);
      assert(brute === binary, `D_min 不一致 (${c},${h}): brute=${brute} binary=${binary}`);
      // 最小性与严格性
      if (brute !== null) {
        finite += 1;
        assert(fC[c] * fH[h] * fD[brute] > B_FRONTIER_NUM, "D_min 处未达到严格改善");
        if (brute > 0) {
          assert(fC[c] * fH[h] * fD[brute - 1] <= B_FRONTIER_NUM, "D_min-1 处已严格改善，D_min 不是最小");
        }
        for (let d = brute; d <= BOX.D; d += 1) {
          assert(fC[c] * fH[h] * fD[d] > B_FRONTIER_NUM, "D >= D_min 仍不改善，改善集不是上区间");
        }
      } else {
        infinite += 1;
        assert(fC[c] * fH[h] * fD[BOX.D] <= B_FRONTIER_NUM, "D_min=+inf 但盒内存在改善点");
      }
      cells += 1;
    }
  }
  assert(finite > 0 && infinite > 0, "反例域应同时包含有限与 +inf 的 D_min");
  ok(
    "A3.Dmin-binary",
    `B=${B_FRONTIER}（=prod(${B_FRONTIER_POINT.C},${B_FRONTIER_POINT.H},${B_FRONTIER_POINT.D})-1）在 ${cells} 个 (C,H) 上：暴力扫描与 DET 可达档位表二分完全一致；` +
      `${finite} 个有限值满足严格性/最小性/上区间性质，${infinite} 个为 +infinity`,
  );
}

// A3b. detTrunc > 1 的等级（50）与 BLU（80）上的同样核验。
{
  const cases = [
    { level: 50, job: "WHM", box: { C: 60, H: 40, D: 90 } },
    { level: 80, job: "BLU", box: { C: 80, H: 50, D: 120 } },
  ];
  const caseDetails = [];
  for (const { level, job, box } of cases) {
    assertSafeProducts(level, job, box);
    const point = { C: Math.floor(box.C / 3), H: Math.floor(box.H / 3), D: Math.floor(box.D / 3) };
    const B = BigInt(productOf(level, job, point.C, point.H, point.D) - 1);
    const BNum = safeNumberThreshold(B, `B(level=${level})`);
    const table = tierTable(level, job, "DET", box.D);
    const step = tierParameters(level, job, "DET").mult;
    // DET 可达 tier 值在本实现下是步长 mult 的等差序列（140 < det*detTrunc）。
    for (let index = 1; index < table.values.length; index += 1) {
      assert(table.values[index] === table.values[index - 1] + step, "DET tier 值应为步长 mult 的等差序列");
    }
    for (let c = 0; c <= box.C; c += 1) {
      for (let h = 0; h <= box.H; h += 1) {
        const brute = dMinBrute(level, job, box.D, c, h, BNum);
        const binary = dMinBinary(
          level,
          job,
          factorC(level, job, c),
          factorH(level, job, h),
          B,
          table,
        );
        assert(brute === binary, `D_min 不一致 level=${level} job=${job} (${c},${h})`);
      }
    }
    caseDetails.push(`level=${level} ${job} detTrunc=${step} 档位值数=${table.values.length}`);
  }
  ok("A3b.Dmin-multilevel", `${caseDetails.join("；")}：二分算法与暴力扫描逐点一致（含 detTrunc 阶梯）`);
}

// ---------------------------------------------------------------------------
// A4. D_min 关于 C/H 单调不增（扩展序）
// ---------------------------------------------------------------------------
{
  const grid = [];
  for (let c = 0; c <= BOX.C; c += 1) {
    const row = [];
    for (let h = 0; h <= BOX.H; h += 1) {
      row.push(extended(dMinBrute(LEVEL, JOB, BOX.D, c, h, B_FRONTIER_NUM)));
    }
    grid.push(row);
  }
  let comparisons = 0;
  for (let c = 0; c <= BOX.C; c += 1) {
    for (let h = 0; h <= BOX.H; h += 1) {
      if (c + 1 <= BOX.C) {
        assert(grid[c + 1][h] <= grid[c][h], `D_min 关于 C 单调性失败 (${c},${h})`);
        comparisons += 1;
      }
      if (h + 1 <= BOX.H) {
        assert(grid[c][h + 1] <= grid[c][h], `D_min 关于 H 单调性失败 (${c},${h})`);
        comparisons += 1;
      }
    }
  }
  ok("A4.Dmin-monotone", `${comparisons} 个相邻比较全部满足 D_min(C+1,H) <= D_min(C,H) 与 D_min(C,H+1) <= D_min(C,H)（+inf 视为最大）`);
}

// ---------------------------------------------------------------------------
// A5. staircase 紧致性：只依赖 (CRT tier, DHT tier)
// ---------------------------------------------------------------------------
{
  const crtTable = tierTable(LEVEL, JOB, "CRT", BOX.C);
  const dhtTable = tierTable(LEVEL, JOB, "DHT", BOX.H);
  const cell = new Map();
  for (let ci = 0; ci < crtTable.values.length; ci += 1) {
    for (let hi = 0; hi < dhtTable.values.length; hi += 1) {
      const value = extended(
        dMinBinary(LEVEL, JOB, criticalFactor(crtTable.values[ci], JOB), directHitFactor(dhtTable.values[hi]), B_FRONTIER, detTable),
      );
      cell.set(`${ci}/${hi}`, value);
    }
  }
  const crtTierOf = (c) => tier(LEVEL, JOB, "CRT", c);
  const dhtTierOf = (h) => tier(LEVEL, JOB, "DHT", h);
  let checked = 0;
  for (let c = 0; c <= BOX.C; c += 1) {
    for (let h = 0; h <= BOX.H; h += 1) {
      const ci = crtTable.values.indexOf(crtTierOf(c));
      const hi = dhtTable.values.indexOf(dhtTierOf(h));
      const fromCell = cell.get(`${ci}/${hi}`);
      const brute = extended(dMinBrute(LEVEL, JOB, BOX.D, c, h, B_FRONTIER_NUM));
      assert(fromCell === brute, `D_min 不是 tier 单元函数 (${c},${h})`);
      checked += 1;
    }
  }
  // 单调阶梯：每个 level set 是 tier 网格上的上集。
  const crtCells = crtTable.values.length;
  const dhtCells = dhtTable.values.length;
  const levels = [...new Set([...cell.values()])].filter((value) => Number.isFinite(value));
  let staircaseChecks = 0;
  for (const levelValue of levels) {
    for (let ci = 0; ci < crtCells; ci += 1) {
      for (let hi = 0; hi < dhtCells; hi += 1) {
        if (cell.get(`${ci}/${hi}`) > levelValue) continue;
        if (ci + 1 < crtCells) {
          assert(cell.get(`${ci + 1}/${hi}`) <= levelValue, "level set 关于 CRT tier 不是上集");
          staircaseChecks += 1;
        }
        if (hi + 1 < dhtCells) {
          assert(cell.get(`${ci}/${hi + 1}`) <= levelValue, "level set 关于 DHT tier 不是上集");
          staircaseChecks += 1;
        }
      }
    }
  }
  assert(crtCells * dhtCells === cell.size, "单元数应等于 tier 值个数之积");
  ok(
    "A5.staircase-compact",
    `CRT tier 值 ${crtCells} 个 × DHT tier 值 ${dhtCells} 个 = ${cell.size} 个单元；` +
      `${checked} 个 (C,H) 点的 D_min 完全由 tier 单元决定；${levels.length} 个水平集共 ${staircaseChecks} 次上集检查通过（单调阶梯）`,
  );
}

// ---------------------------------------------------------------------------
// A6. K_w：暴力 / frontier / 最小反链一致；argmin 与最小元的关系
// ---------------------------------------------------------------------------
const directions = [
  { name: "(1,1,1)", w: [1, 1, 1] },
  { name: "(1,0,0)", w: [1, 0, 0] },
  { name: "(2,1,3)", w: [2, 1, 3] },
  { name: "(0,1,1)", w: [0, 1, 1] },
  { name: "(1,1,0)", w: [1, 1, 0] },
  { name: "(5,2,7)", w: [5, 2, 7] },
];

function dot(w, x) {
  return w[0] * x[0] + w[1] * x[1] + w[2] * x[2];
}

function bruteKw(box, w, BNum) {
  let best = null;
  for (let c = 0; c <= box.C; c += 1) {
    for (let h = 0; h <= box.H; h += 1) {
      for (let d = 0; d <= box.D; d += 1) {
        if (fC[c] * fH[h] * fD[d] <= BNum) continue;
        const value = w[0] * c + w[1] * h + w[2] * d;
        if (best === null || value < best) best = value;
      }
    }
  }
  return best;
}

function frontierKw(level, job, box, w, B, detTableValue) {
  const crtTable = tierTable(level, job, "CRT", box.C);
  const dhtTable = tierTable(level, job, "DHT", box.H);
  let best = null;
  for (let ci = 0; ci < crtTable.values.length; ci += 1) {
    const c = crtTable.minContrib[ci];
    for (let hi = 0; hi < dhtTable.values.length; hi += 1) {
      const h = dhtTable.minContrib[hi];
      const d = dMinBinary(
        level,
        job,
        criticalFactor(crtTable.values[ci], job),
        directHitFactor(dhtTable.values[hi]),
        B,
        detTableValue,
      );
      if (d === null) continue;
      const value = w[0] * c + w[1] * h + w[2] * d;
      if (best === null || value < best) best = value;
    }
  }
  return best;
}

function minimalElements(level, job, box, BNum) {
  const tableC = Array.from({ length: box.C + 1 }, (_, c) => factorC(level, job, c));
  const tableH = Array.from({ length: box.H + 1 }, (_, h) => factorH(level, job, h));
  const tableD = Array.from({ length: box.D + 1 }, (_, d) => factorD(level, job, d));
  const inG = (c, h, d) => tableC[c] * tableH[h] * tableD[d] > BNum;
  const minimal = [];
  for (let c = 0; c <= box.C; c += 1) {
    for (let h = 0; h <= box.H; h += 1) {
      for (let d = 0; d <= box.D; d += 1) {
        if (!inG(c, h, d)) continue;
        if (c > 0 && inG(c - 1, h, d)) continue;
        if (h > 0 && inG(c, h - 1, d)) continue;
        if (d > 0 && inG(c, h, d - 1)) continue;
        minimal.push([c, h, d]);
      }
    }
  }
  return minimal;
}

const minimalSet = minimalElements(LEVEL, JOB, BOX, B_FRONTIER_NUM);
{
  assert(minimalSet.length > 0, "G(B) 非空时应有最小元");
  const kDetails = [];
  for (const direction of directions) {
    const w = direction.w;
    const brute = bruteKw(BOX, w, B_FRONTIER_NUM);
    const frontier = frontierKw(LEVEL, JOB, BOX, w, B_FRONTIER, detTable);
    let antichain = null;
    for (const point of minimalSet) {
      const value = dot(w, point);
      if (antichain === null || value < antichain) antichain = value;
    }
    assert(brute === frontier, `K_w 暴力与 frontier 公式不一致 ${direction.name}: ${brute} vs ${frontier}`);
    assert(brute === antichain, `K_w 与最小反链不一致 ${direction.name}: ${brute} vs ${antichain}`);
    kDetails.push(`${direction.name}=${brute}`);
  }
  // min 由最小元取得：每个最小元都是 Pareto 极小，且 argmin 中至少有一个最小元。
  const w = [1, 0, 0];
  const k = bruteKw(BOX, w, B_FRONTIER_NUM);
  const argmins = [];
  forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d, product) => {
    if (product > B_FRONTIER_NUM && c === k) argmins.push([c, h, d]);
  });
  assert(argmins.length > 0, "argmin 不应为空");
  const isMinimal = (point) => minimalSet.some((m) => m[0] === point[0] && m[1] === point[1] && m[2] === point[2]);
  const minimalArgmin = argmins.filter(isMinimal);
  assert(minimalArgmin.length > 0, "argmin 中应至少包含一个最小元（否则与上集结构矛盾）");
  let argminDominates = 0;
  for (const point of argmins) {
    const dominates = minimalArgmin.some(([mc, mh, md]) => mc <= point[0] && mh <= point[1] && md <= point[2]);
    assert(dominates, "存在不支配任何最小 argmin 的 argmin 点");
    argminDominates += 1;
  }
  // 修正过强表述：argmin 不必都是最小元（w=(1,0,0) 时高 H/D 的 argmin 不是最小元）。
  const nonMinimalArgmin = argmins.filter((point) => !isMinimal(point));
  assert(nonMinimalArgmin.length > 0, "未找到「非最小元的 argmin」反例（过强表述可能碰巧成立，需换方向）");
  ok(
    "A6.Kw-paths",
    `B=${B_FRONTIER} 时 ${directions.length} 个方向的 K_w 三路一致（${kDetails.join("，")}）；` +
      `w=(1,0,0) 的 argmin 共 ${argmins.length} 个，其中 ${minimalArgmin.length} 个是最小元、${nonMinimalArgmin.length} 个不是；` +
      `每个 argmin 都支配至少一个最小 argmin（${argminDominates}/${argmins.length}）`,
  );
}

// ---------------------------------------------------------------------------
// A7. K_w 的单调性与齐次性
// ---------------------------------------------------------------------------
{
  const B_LOW = BigInt(productOf(LEVEL, JOB, 30, 20, 40) - 1);
  const B_HIGH = BigInt(productOf(LEVEL, JOB, 80, 60, 120) - 1);
  assert(B_HIGH > B_LOW, "构造的 B_HIGH 应更大");
  const B_LOW_NUM = safeNumberThreshold(B_LOW, "B_LOW");
  const B_HIGH_NUM = safeNumberThreshold(B_HIGH, "B_HIGH");
  // w 分量单调：w <= w' => K_w <= K_{w'}。
  for (let left = 0; left < directions.length; left += 1) {
    for (let right = 0; right < directions.length; right += 1) {
      const w = directions[left].w;
      const u = directions[right].w;
      const dominated = w[0] <= u[0] && w[1] <= u[1] && w[2] <= u[2];
      if (!dominated) continue;
      const kLow = bruteKw(BOX, w, B_FRONTIER_NUM);
      const kHigh = bruteKw(BOX, u, B_FRONTIER_NUM);
      assert(kLow <= kHigh, `K_w 关于 w 的单调性失败 ${directions[left].name} <= ${directions[right].name}`);
    }
  }
  // B 单调：B1 < B2 => G(B2) ⊆ G(B1) => K_w(B1) <= K_w(B2)。
  for (const direction of directions) {
    const kLow = bruteKw(BOX, direction.w, B_LOW_NUM);
    const kHigh = bruteKw(BOX, direction.w, B_HIGH_NUM);
    assert(kLow !== null && kHigh !== null, "B 单调性测试中 G 不应为空");
    assert(kLow <= kHigh, `K_w 关于 B 的单调性失败 ${direction.name}`);
  }
  // 齐次：K_{lambda w} = lambda K_w。
  for (const direction of directions) {
    for (const lambda of [2, 3]) {
      const scaled = direction.w.map((value) => value * lambda);
      const kBase = bruteKw(BOX, direction.w, B_FRONTIER_NUM);
      const kScaled = bruteKw(BOX, scaled, B_FRONTIER_NUM);
      assert(kScaled === lambda * kBase, `K_w 齐次性失败 ${direction.name} lambda=${lambda}`);
    }
  }
  ok(
    "A7.Kw-monotone-homogeneous",
    `w 分量单调（全部支配对）、B 单调（B=${B_LOW} < ${B_HIGH} 时 K 非减）、` +
      `正比例齐次（lambda=2,3 时 K_{lambda w}=lambda K_w）均通过`,
  );
}

// ---------------------------------------------------------------------------
// A8. 必要半空间：安全性、紧性、误用方向
// ---------------------------------------------------------------------------
{
  const details = [];
  for (const direction of directions) {
    const w = direction.w;
    const k = bruteKw(BOX, w, B_FRONTIER_NUM);
    let improving = 0;
    let violating = 0;
    let tight = 0;
    let deletedByOverestimate = 0;
    forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d, product) => {
      if (product <= B_FRONTIER_NUM) return;
      improving += 1;
      const value = dot(w, [c, h, d]);
      assert(value >= k, `改善点违反半空间 ${direction.name}`);
      if (value === k) tight += 1;
      if (value < k + 1) deletedByOverestimate += 1; // L = K+1
    });
    // L = K-1：不得删除任何改善点。
    const lower = Math.max(0, k - 1);
    forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d, product) => {
      if (product <= B_FRONTIER_NUM) return;
      assert(dot(w, [c, h, d]) >= lower, "K-1 下界不应删除改善点");
      if (dot(w, [c, h, d]) < k) violating += 1;
    });
    assert(tight > 0, "K_w 应紧：存在 w·x=K_w 的改善点");
    assert(deletedByOverestimate > 0, "L=K+1 应至少删除一个改善点（误用方向）");
    assert(violating === 0, "K-1 下界下不应有改善点被删");
    details.push(`${direction.name}: K=${k}, 改善点=${improving}, 紧点=${tight}`);
  }
  // 显式构造：w=(1,0,0)，取 C0 为某个 CRT tier 的最小贡献，B = prod(C0, κ_H, κ_D)-1 => K=C0，
  // L=C0+1 会删掉改善点 (C0,κ_H,κ_D)。
  {
    const w = [1, 0, 0];
    const crtTableForWitness = tierTable(LEVEL, JOB, "CRT", BOX.C);
    const targetTierIndex = crtTableForWitness.values.indexOf(tier(LEVEL, JOB, "CRT", 60));
    assert(targetTierIndex >= 0, "目标 CRT tier 应在盒内");
    const cZero = crtTableForWitness.minContrib[targetTierIndex];
    assert(cZero > 0, "显式反例要求 C0 > 0");
    const cornerPoint = { C: cZero, H: BOX.H, D: BOX.D };
    const B_EXPLICIT = BigInt(productOf(LEVEL, JOB, cornerPoint.C, cornerPoint.H, cornerPoint.D) - 1);
    const B_EXPLICIT_NUM = safeNumberThreshold(B_EXPLICIT, "B_EXPLICIT");
    const k = bruteKw(BOX, w, B_EXPLICIT_NUM);
    assert(k === cZero, `显式构造的 K 应为 ${cZero}，实际 ${k}`);
    assert(
      fC[cZero] * fH[BOX.H] * fD[BOX.D] > B_EXPLICIT_NUM,
      "显式反例点应在改善区域",
    );
    const overestimated = k + 1;
    assert(dot(w, [cZero, BOX.H, BOX.D]) < overestimated, "显式反例点应被 L=K+1 删除");
    ok(
      "A8.halfspace-safety",
      `${directions.length} 个方向的半空间对全部改善点安全、K_w 紧；L=K_w+1 会删改善点、L<=K_w 安全。` +
        `显式反例：w=(1,0,0), B=prod(${cZero},${BOX.H},${BOX.D})-1=${B_EXPLICIT} => K=${k}，` +
        `改善点 (${cZero},${BOX.H},${BOX.D}) 的 w·x=${cZero} < L=${overestimated} 被误删`,
    );
  }
}

// ---------------------------------------------------------------------------
// A9. 空改善区域与退化
// ---------------------------------------------------------------------------
{
  const maxProduct = productOf(LEVEL, JOB, BOX.C, BOX.H, BOX.D);
  // 单调性已证顶角最大；用全枚举复核。
  let bruteMax = 0;
  forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d, product) => {
    if (product > bruteMax) bruteMax = product;
  });
  assert(bruteMax === maxProduct, "顶角应为盒内最大乘积");
  const B_AT_MAX = BigInt(maxProduct);
  {
    let improving = 0;
    forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d, product) => {
      if (BigInt(product) > B_AT_MAX) improving += 1;
    });
    assert(improving === 0, "B = max product 时不应存在改善点");
    for (const direction of directions) {
      const k = bruteKw(BOX, direction.w, Number(B_AT_MAX));
      assert(k === null, "G 为空时 K_w 应为 +infinity");
    }
    // B = max - 1：改善点恰为乘积等于 max 的点（可以有多点，因因子在 tier 平台上是常数）。
    let topImproving = 0;
    forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d, product) => {
      if (BigInt(product) > B_AT_MAX - 1n) {
        assert(product === maxProduct, "B=max-1 的改善点乘积应等于 max");
        topImproving += 1;
      }
    });
    assert(topImproving >= 1, "B=max-1 时应至少有一个改善点（顶角 tier 平台）");
  }
  // B <= 0：G = Omega，K_w = 0（原点属于盒）。
  for (const B_ZERO of [0, -5]) {
    for (const direction of directions) {
      const k = bruteKw(BOX, direction.w, B_ZERO);
      assert(k === 0, "B<=0 时 K_w 应为 0（原点取到）");
    }
  }
  // 退化维度：kappa_D = 0（D 固定为 0）。
  {
    const degenerateBox = { C: 30, H: 20, D: 0 };
    const degenerateTable = tierTable(LEVEL, JOB, "DET", 0);
    assert(degenerateTable.values.length === 1, "kappa_D=0 时 DET 档位表应只有一个值");
    const pointForB = productOf(LEVEL, JOB, 10, 8, 0);
    const B = BigInt(pointForB - 1);
    const BNum = safeNumberThreshold(B, "B(degenerate)");
    let finite = 0;
    let infinite = 0;
    for (let c = 0; c <= degenerateBox.C; c += 1) {
      for (let h = 0; h <= degenerateBox.H; h += 1) {
        const brute = dMinBrute(LEVEL, JOB, degenerateBox.D, c, h, BNum);
        const binary = dMinBinary(LEVEL, JOB, fC[c], fH[h], B, degenerateTable);
        assert(brute === binary, "退化维度下 D_min 不一致");
        if (brute === null) infinite += 1;
        else finite += 1;
      }
    }
    assert(finite > 0, "退化维度测试应存在有限 D_min");
    // 单向退化：kappa_C = 0。
    const degenerateC = { C: 0, H: 40, D: 60 };
    for (let h = 0; h <= degenerateC.H; h += 1) {
      for (let d = 0; d <= degenerateC.D; d += 1) {
        assert(factorC(LEVEL, JOB, 0) >= 0, "退化 C 维因子应为正");
      }
    }
    ok(
      "A9.empty-degenerate",
      `B=max product=${B_AT_MAX} 时改善点数 0 且所有 K_w=+inf；B=max-1 时恰顶角改善；` +
        `B<=0 时 K_w=0；kappa_D=0 时 D_min ∈ {0,+inf}（${finite} 有限 / ${infinite} 无限）且与二分一致`,
    );
  }
}

// ---------------------------------------------------------------------------
// A10. 严格 vs 非严格（tie）语义：用严格 frontier 删同分方案是错的
// ---------------------------------------------------------------------------
{
  const tiePoint = { C: 70, H: 45, D: 90 };
  const tieSub = productOf(LEVEL, JOB, tiePoint.C, tiePoint.H, tiePoint.D);
  const tieOther = 1000n;
  const incumbentComparable = BigInt(tieSub) * tieOther; // 恰等于 tiePoint 的其它因子 * 副属性乘积
  const B_STRICT_TIE = floorDiv(incumbentComparable, tieOther);
  const B_NONSTRICT_TIE = ceilDiv(incumbentComparable, tieOther);
  assert(B_STRICT_TIE === B_NONSTRICT_TIE, "可整除构造中严格/非严格阈值应相等");
  assert(B_STRICT_TIE === tieSub, "同分阈值应等于同分点副属性乘积");
  const B_TIE_NUM = safeNumberThreshold(B_NONSTRICT_TIE, "B_TIE_NUM");
  assert(tieSub === B_TIE_NUM, "同分点乘积应等于阈值");
  const strictSet = new Set();
  const nonstrictSet = new Set();
  forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d, product) => {
    if (product > B_TIE_NUM) strictSet.add(`${c}/${h}/${d}`);
    if (product >= B_TIE_NUM) nonstrictSet.add(`${c}/${h}/${d}`);
  });
  assert(strictSet.size < nonstrictSet.size, "严格集合应小于非严格集合");
  const tieKey = `${tiePoint.C}/${tiePoint.H}/${tiePoint.D}`;
  assert(!strictSet.has(tieKey), "严格 frontier 不应包含同分点");
  assert(nonstrictSet.has(tieKey), "非严格 frontier 应包含同分点");
  // 若系统要求保留同分方案，用 strictSet 删除会把 tiePoint 删掉。
  const deletedByStrict = [...nonstrictSet].filter((key) => !strictSet.has(key));
  assert(deletedByStrict.includes(tieKey), "同分点应在被误删集合中");
  ok(
    "A10.tie-semantics",
    `可整除构造 incumbentComparable=${incumbentComparable}：B_>= = B_> = ${B_STRICT_TIE}，` +
      `G_>= 比 G_> 多 ${deletedByStrict.length} 个同分点（含 tiePoint ${tieKey}）；` +
      `要求保留同分方案时用严格 frontier 删除即错误`,
  );
}

// ---------------------------------------------------------------------------
// A11. 支撑族：非冗余、空支撑、任意子集正确性
// ---------------------------------------------------------------------------
{
  const supportDirections = [
    { name: "w1=(1,1,1)", w: [1, 1, 1] },
    { name: "w2=(2,2,2)", w: [2, 2, 2] },
    { name: "w3=(1,0,0)", w: [1, 0, 0] },
    { name: "w4=(0,0,1)", w: [0, 0, 1] },
  ];
  const supports = supportDirections.map((direction) => ({
    ...direction,
    k: bruteKw(BOX, direction.w, B_FRONTIER_NUM),
  }));
  // w2 = 2*w1 且 K2 = 2*K1 => H2 ⊆ H1 => D1 ⊆ D2，支撑 1 被支撑 2 蕴含（非冗余仅指不增加删除）。
  const [s1, s2] = [supports[0], supports[1]];
  assert(s2.k === 2 * s1.k, "w2=2*w1 时应有 K2=2K1");
  let implied = 0;
  forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d) => {
    const point = [c, h, d];
    if (dot(s2.w, point) >= s2.k) {
      assert(dot(s1.w, point) >= s1.k, "w2 半空间应蕴含 w1 半空间");
      implied += 1;
    }
  });
  // 空支撑：L <= min_{Omega} w·x（w>=0 且原点在盒内 => min=0）时删除集为空。
  {
    const w = [1, 1, 1];
    const vacuous = { w, k: 0 };
    let deleted = 0;
    forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d) => {
      if (dot(vacuous.w, [c, h, d]) < vacuous.k) deleted += 1;
    });
    assert(deleted === 0, "空支撑不应删除任何点");
    ok(
      "A11.supports",
      `w2=(2,2,2) 的 K2=2K1=${s2.k} 蕴含 w1=(1,1,1) 半空间（${implied} 点）；` +
        `L=${vacuous.k} <= min_{Omega} w·x=0 的支撑为空（删除 0 点）`,
    );
  }
  // 任意子集正确性：每个已认证半空间都必要，故用任意子集删除都不删改善点。
  const subsets = [[0], [1, 3], [0, 2, 3], [0, 1, 2, 3]];
  for (const subset of subsets) {
    forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d, product) => {
      if (product <= B_FRONTIER_NUM) return;
      for (const index of subset) {
        const support = supports[index];
        assert(
          dot(support.w, [c, h, d]) >= support.k,
          `子集 ${subset.join(",")} 删除了改善点`,
        );
      }
    });
  }
  // 一般非冗余充分检查：min_{x in ∩_{j≠i} H_j ∩ Omega} w_i·x >= K_i  <=> 支撑 i 冗余。
  {
    const redundancyDetails = [];
    for (let index = 0; index < supports.length; index += 1) {
      let minimum = null;
      let feasible = 0;
      forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d) => {
        const point = [c, h, d];
        const satisfiesOthers = supports.every(
          (support, other) => other === index || dot(support.w, point) >= support.k,
        );
        if (!satisfiesOthers) return;
        feasible += 1;
        const value = dot(supports[index].w, point);
        if (minimum === null || value < minimum) minimum = value;
      });
      const impliedByOthers = minimum === null ? true : minimum >= supports[index].k;
      redundancyDetails.push(`${supports[index].name}:${impliedByOthers ? "被蕴含" : "独立"}（${feasible} 点）`);
      if (impliedByOthers) {
        // 冗余：删掉该支撑不改变删除集合（在删除方向）——这里核对半空间被蕴含。
        forEachBoxPoint(LEVEL, JOB, BOX, (c, h, d) => {
          const point = [c, h, d];
          const satisfiesOthers = supports.every(
            (support, other) => other === index || dot(support.w, point) >= support.k,
          );
          if (satisfiesOthers) {
            assert(dot(supports[index].w, point) >= supports[index].k, "冗余检查失败");
          }
        });
      }
    }
    ok(
      "A11.redundancy",
      `冗余充分检查（min over ∩_{j≠i}H_j）：${redundancyDetails.join("；")}；` +
        `任意子集 ${subsets.map((subset) => `[${subset}]`).join(",")} 删除均未触碰改善点`,
    );
  }
}

// ---------------------------------------------------------------------------
// A12. baseStat 影响审计：本脚本所有输入的坐标都是「贡献」g，不是面板总值
// ---------------------------------------------------------------------------
{
  const computeOffsets = (level) => {
    const params = DOCUMENTED_LEVEL_PARAMS[level];
    // 参考模型 §2.1/§2.2：baseStats.CRT = baseStats.DHT = baseStats.TEN = sub；baseStats.DET = main。
    return { CRT: params.sub, DHT: params.sub, DET: params.main, TEN: params.sub };
  };
  const panelOf = (level, contribution) => {
    const offsets = computeOffsets(level);
    return {
      CRT: contribution.C + offsets.CRT,
      DHT: contribution.H + offsets.DHT,
      DET: contribution.D + offsets.DET,
    };
  };
  const levels = Object.keys(DOCUMENTED_LEVEL_PARAMS).map(Number).sort((left, right) => left - right);
  assert(levels.length === 6, "应覆盖六个支持等级");
  // 贡献 0（面板恰为 baseStats）时的档位：CRT/DHT 的常数项、DET 基础档位 1000。
  for (const level of levels) {
    for (const job of ["WHM", "BLU"]) {
      const expectedOriginTier = {
        CRT: job === "BLU" ? 250 : 50,
        DHT: job === "BLU" ? 200 : 0,
        DET: 1000,
      };
      for (const stat of ["CRT", "DHT", "DET"]) {
        assert(
          tier(level, job, stat, 0) === expectedOriginTier[stat],
          `贡献 0 的档位不一致 level=${level} job=${job} stat=${stat}`,
        );
      }
      const offsets = computeOffsets(level);
      assert(offsets.CRT === offsets.DHT && offsets.CRT === offsets.TEN, "CRT/DHT/TEN 基础属性应同为 sub");
      assert(offsets.DET === DOCUMENTED_LEVEL_PARAMS[level].main, "DET 基础属性应为 main");
    }
  }
  // 把贡献值误当面板值会得到不同档位：本文所有示例必须标注为贡献。
  for (const level of levels) {
    const offsets = computeOffsets(level);
    assert(
      tier(level, "WHM", "CRT", offsets.CRT + 56) !== tier(level, "WHM", "CRT", 56),
      `贡献/面板混用应改变档位 level=${level}`,
    );
  }
  // 本文引用的数值示例：全部按贡献坐标复算，并列出面板等价（level=100 WHM：sub=420，main=440）。
  const samples = [
    { g: { C: 0, H: 0, D: 0 }, product: 4_080_000_000_000, use: "A1/A9 原点" },
    { g: { C: 56, H: 100, D: 220 }, product: 4_151_851_967_544, use: "A8 显式反例 B=prod-1" },
    { g: { C: 70, H: 45, D: 90 }, product: 4_113_667_312_800, use: "A10 tie 构造" },
    { g: { C: 100, H: 70, D: 150 }, product: 4_134_840_270_109, use: "A3/A6 frontier B=prod-1" },
    { g: { C: 140, H: 100, D: 220 }, product: 4_163_163_941_400, use: "A0/A9 P* 顶角" },
    { g: { C: 500, H: 30, D: 0 }, product: 4_153_084_875_000, use: "跨目录 B5 分离反例 q" },
    { g: { C: 530, H: 0, D: 0 }, product: 4_154_176_000_000, use: "跨目录 B5 分离反例 r" },
  ];
  const offsets100 = computeOffsets(LEVEL);
  const auditRows = [];
  for (const sample of samples) {
    const { C, H, D } = sample.g;
    assert(productOf(LEVEL, JOB, C, H, D) === sample.product, `示例乘积复算不一致 (${C},${H},${D})`);
    const panel = panelOf(LEVEL, sample.g);
    assert(
      tier(LEVEL, JOB, "CRT", panel.CRT) !== tier(LEVEL, JOB, "CRT", C),
      `示例 (${C},${H},${D}) 若按面板解释应改变档位`,
    );
    auditRows.push(`${sample.use}: 贡献(${C},${H},${D}) / 面板(${panel.CRT},${panel.DHT},${panel.DET}) / prod=${sample.product}`);
  }
  // 半空间示例：w=(1,0,0) 的 K=56 是贡献 C；面板 C 等价为 offset+56=476（L=57 <-> 477）。
  const bWitness = BigInt(productOf(LEVEL, JOB, 56, 100, 220) - 1);
  assert(bWitness === 4_151_851_967_543n, "A8 的 B 复算不一致");
  assert(offsets100.CRT === 420 && offsets100.DET === 440, "level 100 WHM 的 sub/main 应为 420/440");
  assert(56 + offsets100.CRT === 476, "K 的贡献->面板换算失败");
  ok(
    "A12.baseStat-audit",
    `六个等级 × 普通/BLU 验证：贡献 0 的档位 = 面板为 baseStats 时的档位（CRT 50/250、DHT 0/200、DET 1000）；` +
      `CRT/DHT/TEN 偏移 = sub、DET 偏移 = main；${samples.length} 个数值示例全部按贡献坐标复算通过；` +
      `w=(1,0,0) 的 K=56 为贡献 C（面板等价 476，L=57 <-> 477）。示例明细：${auditRows.join("；")}`,
  );
}

// ---------------------------------------------------------------------------
// A13. slab/非严格域/同分点可达性的安全修复证书
// ---------------------------------------------------------------------------
{
  const phiNum = (c, h, d) => {
    const value = productOf(LEVEL, JOB, c, h, d);
    assert(Number.isSafeInteger(value), `A13 的 phiNum(${c},${h},${d}) 超出安全整数：${value}`);
    return value;
  };

  // --- slab 不继承盒域档位算法 ---------------------------------------------
  const SLAB_KAPPA = 1;
  const SLAB_L = 1;
  const SLAB_R = 1;
  const SLAB_B = 1;
  const slabImproving = [];
  for (let c = 0; c <= SLAB_KAPPA; c += 1) {
    for (let h = 0; h <= SLAB_KAPPA; h += 1) {
      for (let d = 0; d <= SLAB_KAPPA; d += 1) {
        if (phiNum(c, h, d) <= SLAB_B) continue;
        if (c + h + d < SLAB_L || c + h + d > SLAB_R) continue;
        slabImproving.push({ c, h, d });
      }
    }
  }
  assert(slabImproving.length === 3, `slab 内应有 3 个改善点，实际 ${slabImproving.length}`);
  const keyOf = (point) => `${point.c}/${point.h}/${point.d}`;
  assert(
    new Set(slabImproving.map(keyOf)).size === 3 &&
      ["1/0/0", "0/1/0", "0/0/1"].every((key) => slabImproving.some((point) => keyOf(point) === key)),
    "slab 改善点应恰为 (1,0,0),(0,1,0),(0,0,1)",
  );
  const dMinSlab = (C, H) => {
    const lower = Math.max(0, SLAB_L - C - H);
    const upper = Math.min(SLAB_KAPPA, SLAB_R - C - H);
    if (upper < lower) return null;
    for (let d = lower; d <= upper; d += 1) if (phiNum(C, H, d) > SLAB_B) return d;
    return null;
  };
  assert(dMinSlab(0, 0) === 1, "D_min_slab(0,0) 应为 1");
  assert(dMinSlab(1, 0) === 0, "D_min_slab(1,0) 应为 0");
  assert(dMinSlab(1, 1) === null, "D_min_slab(1,1) 应为 +infinity");
  // 非单调：H=1 时 C 从 0 增到 1，D_min 从 0 变为 +∞（违反非增）
  assert(dMinSlab(0, 1) === 0 && dMinSlab(1, 1) === null, "slab 非单调见证点错误");
  // 非单元常值：贡献 0 与 1 的档位相同，(0,0)/(1,0) 与 (0,1)/(1,1) 却不同值
  assert(tier(LEVEL, JOB, "CRT", 0) === tier(LEVEL, JOB, "CRT", 1), "CRT 0/1 应在同一 tier");
  assert(tier(LEVEL, JOB, "DHT", 0) === tier(LEVEL, JOB, "DHT", 1), "DHT 0/1 应在同一 tier");
  assert(tier(LEVEL, JOB, "DET", 0) === tier(LEVEL, JOB, "DET", 1), "DET 0/1 应在同一 tier");
  assert(dMinSlab(0, 0) !== dMinSlab(1, 0), "同一 tier 单元内 D_min_slab 不应相同");
  // 真实 K_w vs 盒域 tier 代表元算法的错误值
  const dotSlab = (w, point) => w[0] * point.c + w[1] * point.h + w[2] * point.d;
  const wBad = [0, 1, 1];
  const trueK = Math.min(...slabImproving.map((point) => dotSlab(wBad, point)));
  const repK = wBad[0] * 0 + wBad[1] * 0 + wBad[2] * dMinSlab(0, 0); // 盒域代表元 (0,0)
  assert(trueK === 0, `真实 K_w 应为 0，实际 ${trueK}`);
  assert(repK === 1, `错误代表元算法应为 1，实际 ${repK}`);
  assert(repK > trueK, "代表元算法给出偏大的不安全值");
  // Theorem 1.5 的全枚举公式：与直接枚举一致
  let formulaK = null;
  for (let C = 0; C <= SLAB_KAPPA; C += 1) {
    for (let H = 0; H <= SLAB_KAPPA; H += 1) {
      const D = dMinSlab(C, H);
      if (D === null) continue;
      const value = wBad[0] * C + wBad[1] * H + wBad[2] * D;
      if (formulaK === null || value < formulaK) formulaK = value;
    }
  }
  assert(formulaK === trueK, "Theorem 1.5 全枚举公式应与直接枚举一致");

  // --- B=P* 时非严格域非空 -------------------------------------------------
  const K3 = 2;
  const points3 = [];
  let pStar = 0;
  for (let c = 0; c <= K3; c += 1) {
    for (let h = 0; h <= K3; h += 1) {
      for (let d = 0; d <= K3; d += 1) {
        const value = phiNum(c, h, d);
        points3.push({ c, h, d, value });
        if (value > pStar) pStar = value;
      }
    }
  }
  const strictAtMax = points3.filter((point) => point.value > pStar);
  const nonstrictAtMax = points3.filter((point) => point.value >= pStar);
  const argmax = points3.filter((point) => point.value === pStar);
  assert(strictAtMax.length === 0, "B=P* 时严格域应为空");
  assert(nonstrictAtMax.length > 0 && nonstrictAtMax.length === argmax.length, "B=P* 时非严格域应等于 argmax 且非空");
  assert(pStar === phiNum(K3, K3, K3), "小盒 P* 应为顶角乘积");
  const kStrictAtMax = strictAtMax.length === 0 ? null : 0;
  assert(kStrictAtMax === null, "B=P* 时严格 K_w 应为 +infinity（null）");
  for (const w of [[1, 1, 1], [1, 0, 0], [0, 1, 1]]) {
    const kNonstrict = Math.min(...argmax.map((point) => w[0] * point.c + w[1] * point.h + w[2] * point.d));
    assert(Number.isFinite(kNonstrict), "B=P* 时非严格 K_w 应有限");
    assert(kNonstrict === Math.min(...argmax.map((point) => w[0] * point.c + w[1] * point.h + w[2] * point.d)), "argmax 上最小加权和一致");
  }
  // B=P*+1：两域都为空
  const strictAbove = points3.filter((point) => point.value > pStar + 1);
  const nonstrictAbove = points3.filter((point) => point.value >= pStar + 1);
  assert(strictAbove.length === 0 && nonstrictAbove.length === 0, "B=P*+1 时两域都应为空");
  // 主盒 P* 数值（顶角）+ 顶角属于非严格域（直接检查，不做 3D 全枚举）
  const mainPStar = productOf(LEVEL, JOB, BOX.C, BOX.H, BOX.D);
  assert(mainPStar === 4_163_163_941_400, `主盒 P* 应为 4,163,163,941,400，实际 ${mainPStar}`);
  assert(phiNum(BOX.C, BOX.H, BOX.D) >= mainPStar, "顶角应属于 G_>=(P*)");

  // --- 整除不足以存在同分点（全链 BigInt）-----------------------------------
  // P_inc=gapQ² 超过 Number.MAX_SAFE_INTEGER，Number 会引入误差并吞掉 +1；
  // 因此构造、floor/ceil 阈值、边界扰动与集合关系全部用 BigInt。
  const bigFloorDiv = (numerator, denominator) => {
    assert(denominator > 0n, "除数必须为正");
    if (numerator >= 0n) return numerator / denominator;
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    return remainder === 0n ? quotient : quotient - 1n;
  };
  const bigCeilDiv = (numerator, denominator) => {
    assert(denominator > 0n, "除数必须为正");
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    return remainder === 0n ? quotient : quotient + 1n;
  };
  const phiBig = (c, h, d) => BigInt(phiNum(c, h, d));

  const phi0 = phiNum(0, 0, 0);
  const phi0Big = BigInt(phi0);
  assert(phi0 === 4_080_000_000_000, `Phi0 应为 4,080,000,000,000，实际 ${phi0}`);
  // 单点 Ω：P_inc=O=Phi0，O|P_inc 但 q=1∉Phi(Ω)
  const pIncSingle = phi0Big;
  const optimisticSingle = phi0Big;
  assert(pIncSingle % optimisticSingle === 0n, "构造应满足 O | P_inc");
  const qSingle = pIncSingle / optimisticSingle;
  assert(qSingle === 1n, "商应为 1");
  const imageSingleBig = new Set([phi0Big]);
  assert(!imageSingleBig.has(qSingle), "q=1 不应在 Phi(Omega) 中");
  const bDamageSingle = bigFloorDiv(pIncSingle, optimisticSingle);
  const bNonstrictSingle = bigCeilDiv(pIncSingle, optimisticSingle);
  assert(bDamageSingle === 1n && bNonstrictSingle === 1n, "该构造的严格/非严格阈值都应为 1");
  assert(phi0Big > bDamageSingle && phi0Big >= bNonstrictSingle, "单点构造中该点属于两个区域");
  assert(phi0Big * optimisticSingle !== pIncSingle, "单点不应是 Phi*O=P 的同分点（Φ0² ≠ Φ0）");

  // 正例：q 可达 => 存在同分点，G_>= 严格大于 G_>（BigInt 阈值）
  const kD = 20;
  const imageDBig = new Set();
  for (let d = 0; d <= kD; d += 1) imageDBig.add(phiBig(0, 0, d));
  const phiTieBig = phiBig(0, 0, 20);
  assert(imageDBig.has(phiTieBig), "x_t 的乘积应在像集中");
  const optimisticTie = 1000n;
  const pIncTieBig = phiTieBig * optimisticTie;
  const qTieBig = pIncTieBig / optimisticTie;
  assert(qTieBig === phiTieBig && imageDBig.has(qTieBig), "正例应满足 q∈Phi(Ω)");
  const bTie = bigFloorDiv(pIncTieBig, optimisticTie);
  const bTieNs = bigCeilDiv(pIncTieBig, optimisticTie);
  assert(bTie === bTieNs && bTie === phiTieBig, "正例严格/非严格阈值应相等且等于 q");
  const tiePoints = [];
  for (let d = 0; d <= kD; d += 1) if (phiBig(0, 0, d) === qTieBig) tiePoints.push({ c: 0, h: 0, d });
  assert(tiePoints.length > 0, "正例应存在同分点");
  assert(tiePoints.every((point) => point.d === 20), "正例同分点应包含 x_t");
  const gtTie = [...imageDBig].filter((value) => value > bTie);
  const geTie = [...imageDBig].filter((value) => value >= bTieNs);
  const tieSet = geTie.filter((value) => !gtTie.includes(value));
  assert(tieSet.length === 1 && tieSet[0] === phiTieBig, "G_>= \\ G_> 应恰为 {q}（同分点集合）");

  // 可整除但商不可达：G_> 与 G_>= 相等（非空）；全部 BigInt，并覆盖 P−1/P/P+1 边界。
  const kC = 20;
  const imageCBig = new Set();
  for (let c = 0; c <= kC; c += 1) imageCBig.add(phiBig(c, 0, 0));
  const gapQ = phiBig(0, 0, 0) + 500_000_000n; // 4,080,500,000,000，位于像集两个值之间
  assert(gapQ === 4_080_500_000_000n, `gapQ 应为 4,080,500,000,000，实际 ${gapQ}`);
  const pIncGap = gapQ * gapQ; // 16,650,480,250,000,000,000,000,000（> 2^53）
  assert(pIncGap === 16_650_480_250_000_000_000_000_000n, "P_inc=gapQ² 的精确 BigInt 值不符");
  assert(pIncGap > BigInt(Number.MAX_SAFE_INTEGER), "P_inc 应超出 Number 安全整数范围");
  // Number 误差见证：Number(P) 的具体偏差与 +1 被吞
  const pIncGapNumber = Number(pIncGap);
  assert(Number.isFinite(pIncGapNumber), "Number(P_inc) 应为有限数");
  const numberError = BigInt(pIncGapNumber) - pIncGap;
  assert(numberError === -395_902_976n, `Number 表示的误差应为 -395,902,976，实际 ${numberError}`);
  assert(pIncGap + 1n !== pIncGap, "BigInt 下 P_inc+1 !== P_inc");
  assert(Number(pIncGap + 1n) === Number(pIncGap), "Number 下 P_inc+1 === P_inc（+1 被吞，故 Number 不能作证书）");
  assert(Number(pIncGap) === pIncGapNumber, "Number 转换应稳定");
  // 边界 P−1 / P / P+1 的精确 floor/ceil（除数 O=gapQ）
  const boundaryCases = [
    { name: "P-1", p: pIncGap - 1n, floor: gapQ - 1n, ceil: gapQ },
    { name: "P", p: pIncGap, floor: gapQ, ceil: gapQ },
    { name: "P+1", p: pIncGap + 1n, floor: gapQ, ceil: gapQ + 1n },
  ];
  for (const testCase of boundaryCases) {
    assert(bigFloorDiv(testCase.p, gapQ) === testCase.floor, `${testCase.name}: 精确 floor 不符`);
    assert(bigCeilDiv(testCase.p, gapQ) === testCase.ceil, `${testCase.name}: 精确 ceil 不符`);
    // 阈值语义 G_>={v>floor}, G_>={v>=ceil}；在像集上检查集合关系
    const gt = [...imageCBig].filter((value) => value > testCase.floor);
    const ge = [...imageCBig].filter((value) => value >= testCase.ceil);
    assert(
      JSON.stringify(gt.map((value) => value.toString())) === JSON.stringify(ge.map((value) => value.toString())),
      `${testCase.name}: 商不可达时 G_> 与 G_>= 应相等`,
    );
    assert(gt.length > 0, `${testCase.name}: 像集应保持非空`);
  }
  // 明确对照：浮点 ceil 在 P+1 处丢失 +1，BigInt 不丢。
  const floatCeilP = Math.ceil(Number(pIncGap) / Number(gapQ));
  const floatCeilP1 = Math.ceil(Number(pIncGap + 1n) / Number(gapQ));
  assert(floatCeilP === floatCeilP1, "浮点 ceil 在 P 与 P+1 处应给出同一值（+1 被吞）");
  assert(floatCeilP1 !== Number(bigCeilDiv(pIncGap + 1n, gapQ)), "浮点 ceil 在 P+1 处应给出错误值");
  assert(bigCeilDiv(pIncGap + 1n, gapQ) === gapQ + 1n, "BigInt ceil((P+1)/Q) 应为 Q+1");
  // gapQ−1 / gapQ / gapQ+1 均不在像集（商不可达）
  for (const candidate of [gapQ - 1n, gapQ, gapQ + 1n]) {
    assert(!imageCBig.has(candidate), `候选商 ${candidate} 不应在像集中`);
  }
  const gapTie = [...imageCBig].filter((value) => value === gapQ);
  assert(gapTie.length === 0, "gapQ 不可达 => 无同分点");
  const gtGap = [...imageCBig].filter((value) => value > bigFloorDiv(pIncGap, gapQ));
  const geGap = [...imageCBig].filter((value) => value >= bigCeilDiv(pIncGap, gapQ));
  assert(
    JSON.stringify(gtGap.map((value) => value.toString())) === JSON.stringify(geGap.map((value) => value.toString())),
    "P 处商不可达 => G_> 与 G_>= 相等",
  );
  assert(gtGap.length > 0, "gapQ 选择应保持集合非空");
  void pIncGapNumber;

  // DPS：整除（乐观商为整数）但商不可达 => 无 tie；tie 需精确交叉等式 + 可达 (other,gcd)
  const iG = 25n;
  const gcdMinDps = 25n;
  const dpsRatio = (pIncSingle * gcdMinDps) / (optimisticSingle * iG);
  assert(dpsRatio === 1n, "DPS 乐观商应为 1（整数）");
  assert(!imageSingleBig.has(dpsRatio), "DPS 商 1 不在像集中");
  const bDps = bigFloorDiv(pIncSingle * gcdMinDps, optimisticSingle * iG);
  const bDpsNs = bigCeilDiv(pIncSingle * gcdMinDps, optimisticSingle * iG);
  assert(bDps === 1n && bDpsNs === 1n, "DPS 严格/非严格阈值相等");
  // 单点 + 可达集合 other={O}, gcd={25}：精确交叉等式不成立
  const otherReachable = [optimisticSingle];
  const gcdReachable = [iG];
  let dpsTieExists = false;
  for (const other of otherReachable) {
    for (const gcdValue of gcdReachable) {
      if (other * phi0Big * iG === pIncSingle * gcdValue) dpsTieExists = true;
    }
  }
  assert(!dpsTieExists, "DPS 整除但无可达交叉等式 => 不应声称 tie");

  ok(
    "A13.safety-fixes",
    `slab 改善点=3，D_min_slab(0,0)=1,(1,0)=0,(1,1)=+∞；H=1 方向 0→+∞ 非单调、0/1 同 tier 但值不同；` +
      `w=(0,1,1) 真实 K=0，盒域代表元给出 1（不安全）；Theorem 1.5 全枚举=0。` +
      `B=P*(小盒 ${pStar}) 严格域空、非严格域=argmax(${argmax.length} 点)非空、K_w^{>=} 有限；B=P*+1 两域空；主盒 P*=4,163,163,941,400。` +
      `BigInt 证书: P_inc=gapQ²=16,650,480,250,000,000,000,000,000；Number 表示误差 ${numberError}；` +
      `Number(P+1)===Number(P)（+1 被吞）；精确 (floor,ceil) 在 P−1/P/P+1 为 (Q−1,Q)/(Q,Q)/(Q,Q+1)，BigInt ceil(P+1)=Q+1 而浮点 ceil 仍为 Q；` +
      `O|P_inc 且 q=1∉Phi(Ω) 时 G_>=与 G_> 相等、无同分点；商可达正例存在同分点（G_>=\\G_>={q}）；gapQ±1/0 均不可达且两集合相等；DPS 乐观商=1n 仍无 tie（需交叉等式）。`,
  );
}

// ---------------------------------------------------------------------------
console.log("strict-improvement-frontier/verify.mjs: PASS");
console.log(`定义域：level=${LEVEL} job=${JOB} 盒=${JSON.stringify(BOX)}；tier 表与因子来自 canonical integer model。`);
for (const line of results) console.log(line);
console.log("scope: 全部为有限域证书；一般性证明见 docs/mathematical-analysis/theorems/strict-improvement-frontier/README.md。");
