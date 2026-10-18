/**
 * verify.mjs —— pairwise-endpoint-max / pairwise-slice-critical-set 两个定理文档的验证脚本。
 *
 * 覆盖范围（全部为有限、确定性的整数计算；不启动配装搜索、不调用 MIP/求解器）：
 *   §1  三个显式端点最大反例 + 两个 S=50 紧凑反例（BigInt 精确复核）。
 *   §2  实际尺度网格上的端点最大反例普查（与 verification/search-counterexamples.mjs §1b 同网格，
 *       逐 (pair,level,job) 复核反例个数与最大相对差 bp）。
 *   §3  切片阶梯结构：上升/下降/平坦步分类、平台对应、非单峰符号变化、精确计数证书。
 *   §4  条件单调引理与端点最大精确判据；逐点比率分离条件必然失效。
 *   §5  边界退化：S=0、cap 区间、DHT tier=0 平台、BLU、detTrunc、死区预算浪费。
 *   §6  有限关键集定理：两种方向 K_L / K_R 的精确性与大小上界；阈值公式枚举。
 *   §7  周期/交错结构：档位周期、跳变指示最小周期、步型词周期、每周期事件计数、tier 漂移。
 *   §8  O(1) 分段上界族 U_m 的合法性、单调收紧与相对紧度对比。
 *   §9  关键集不可再小的证据（argmax 覆盖），不作为不可能性证明。
 *   §10 canonical evaluator 逐点对照（生产代码，只读）。
 *   §11 baseStat 坐标审计：贡献坐标 vs 面板总值（归约链、70 级换算、误用反例、示例的面板等价）。
 *
 * 坐标约定（重要）：本脚本所有 baseline `b_i,b_j`、预算 `S`、cap `lo/hi` 与贡献参数 `g` 都是
 * **贡献坐标**（装备+食物贡献），不是角色面板总值。面板总值 = 基础属性 + 贡献，其中
 * CRT/DHT 的基础属性是 `sub`、DET 的基础属性是 `main`（见
 * docs/mathematical-analysis/canonical-evaluator-reference.md §2.1）。
 * canonical evaluator 的导出函数 `equippedAttributeTier(job, level, stat, g)` 的输入同样是贡献 g。
 *
 * 证明作用：§1/§2 的反例本身即否证；§3/§4/§6/§7/§8 的代数证明见两份 README，
 * 本脚本只在有限网格上核对数值、给出证书。有限 ≠ 一般性证明。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/pairwise-endpoint-max/verify.mjs
 */
import {
  assert,
  criticalFactor,
  determinationFactor,
  directHitFactor,
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
const JOBS = ["WHM", "BLU"];
const PAIRS = Object.freeze({
  "CRT-DHT": ["CRT", "DHT"],
  "CRT-DET": ["CRT", "DET"],
  "DHT-DET": ["DHT", "DET"],
});
const FACTOR = {
  CRT: (t, job) => criticalFactor(t, job),
  DHT: (t) => directHitFactor(t),
  DET: (t) => determinationFactor(t),
};
const report = [];
function ok(name, detail) {
  report.push(`  [ok] ${name}: ${detail}`);
}
/** 因子查表缓存：本脚本所有贡献 <= 4000，因子值 < 2^40，Float64 精确表示整数。 */
const MAX_CONTRIBUTION = 4000;
const factorTables = new Map();
function factorValue(level, job, stat, contribution) {
  assert(contribution >= 0 && contribution <= MAX_CONTRIBUTION,
    `贡献越界：${contribution}（本脚本缓存范围 0..${MAX_CONTRIBUTION}）`);
  const key = `${level}|${job}|${stat}`;
  let table = factorTables.get(key);
  if (table === undefined) {
    table = new Float64Array(MAX_CONTRIBUTION + 1);
    factorTables.set(key, table);
  }
  if (table[contribution] === 0) {
    table[contribution] = FACTOR[stat](tier(level, job, stat, contribution), job);
  }
  return table[contribution];
}
/** 单值乘积（Number；本脚本中所有乘积 < 2^40，远小于 2^53，无精度损失）。 */
function productNumber(level, job, pair, bL, bR, S, x) {
  const [statL, statR] = PAIRS[pair];
  return factorValue(level, job, statL, bL + x) * factorValue(level, job, statR, bR + S - x);
}
function factorsOf(level, job, stat, contribution) {
  const t = tier(level, job, stat, contribution);
  return { tier: t, factor: FACTOR[stat](t, job) };
}
function pairPoint(level, job, pair, bL, bR, S, x) {
  const [statL, statR] = PAIRS[pair];
  const left = factorsOf(level, job, statL, bL + x);
  const right = factorsOf(level, job, statR, bR + S - x);
  return { x, left, right, product: BigInt(left.factor) * BigInt(right.factor) };
}
/** 逐点扫描整个切片（小 S 用）。 */
function sliceScan(level, job, pair, bL, bR, S) {
  const points = [];
  let best = null;
  for (let x = 0; x <= S; x += 1) {
    const p = pairPoint(level, job, pair, bL, bR, S, x);
    points.push(p);
    if (best === null || p.product > best.product) best = p;
  }
  const endpointMax = points[0].product > points[S].product ? points[0].product : points[S].product;
  return { points, best, endpointMax, leftEnd: points[0].product, rightEnd: points[S].product };
}
/** 左档位跳变指示（步 x-1 -> x）。 */
function leftJump(level, job, pair, bL, x) {
  const [statL] = PAIRS[pair];
  return tier(level, job, statL, bL + x) > tier(level, job, statL, bL + x - 1);
}
/** 某档位序列“跳变指示”的最小周期（必整除档位周期 P = q/gcd(a,q)）。 */
function indicatorPeriod(level, job, stat, period) {
  const indicator = (g) => (tier(level, job, stat, g + 1) > tier(level, job, stat, g) ? 1 : 0);
  for (let candidate = 1; candidate <= period; candidate += 1) {
    if (period % candidate !== 0) continue;
    let holds = true;
    for (let g = 0; g < 3 * period; g += 1) {
      if (indicator(g + candidate) !== indicator(g)) { holds = false; break; }
    }
    if (holds) return candidate;
  }
  return period;
}

// ===========================================================================
// §1 三个显式端点最大反例 + 两个 S=50 紧凑反例
// ===========================================================================
{
  // 1a. CRT-DHT：level 60 BLU，bases (0,0)，S=50，x*=3
  {
    const cases = [
      [0, 250, 1_100_000, 245, 4245, 4_669_500_000n],
      [3, 251, 1_100_651, 243, 4243, 4_670_062_193n],
      [50, 266, 1_110_656, 200, 4200, 4_664_755_200n],
    ];
    for (const [x, expectedTC, expectedFC, expectedTH, expectedFH, expectedProduct] of cases) {
      const p = pairPoint(60, "BLU", "CRT-DHT", 0, 0, 50, x);
      assert(p.left.tier === expectedTC && p.left.factor === expectedFC, `CRT-DHT L60 BLU F_C ${x}`);
      assert(p.right.tier === expectedTH && p.right.factor === expectedFH, `CRT-DHT L60 BLU F_H ${x}`);
      assert(p.product === expectedProduct, `CRT-DHT L60 BLU 乘积 ${x}`);
    }
    const scan = sliceScan(60, "BLU", "CRT-DHT", 0, 0, 50);
    assert(scan.best.x === 3, "CRT-DHT 反例的 argmax 应为 x=3");
    assert(scan.best.product > scan.leftEnd && scan.best.product > scan.rightEnd,
      "CRT-DHT 反例内部点必须严格大于两端");
    ok("A1.counterexample.CRT-DHT",
      "L60 BLU bases=(0,0) S=50 x*=3：F_C=1,100,651 F_H=4243 乘积=4,670,062,193 > 端点 4,669,500,000 / 4,664,755,200（唯一 argmax）");
  }
  // 1b. CRT-DET：level 70 WHM，bases (800,500)，S=50，x*=42
  {
    const cases = [
      [42, 237, 1_139_119, 1079, 1_229_109_401n],
      [0, 227, 1_130_979, 1085, 1_227_112_215n],
      [50, 238, 1_139_944, 1077, 1_227_719_688n],
    ];
    for (const [x, expectedTC, expectedFC, expectedTD, expectedProduct] of cases) {
      const p = pairPoint(70, "WHM", "CRT-DET", 800, 500, 50, x);
      assert(p.left.tier === expectedTC && p.left.factor === expectedFC, `CRT-DET F_C ${x}`);
      assert(p.right.tier === expectedTD, `CRT-DET F_D ${x}`);
      assert(p.product === expectedProduct, `CRT-DET 乘积 ${x}`);
    }
    const scan = sliceScan(70, "WHM", "CRT-DET", 800, 500, 50);
    assert(scan.best.x === 42, "CRT-DET 反例的 argmax 应为 x=42");
    assert(scan.best.product > scan.leftEnd && scan.best.product > scan.rightEnd, "CRT-DET 内部点严格大于两端");
    ok("A1.counterexample.CRT-DET",
      "L70 WHM bases=(800,500) S=50 x*=42：F_C=1,139,119 F_D=1079 乘积=1,229,109,401 > 端点 1,227,112,215 / 1,227,719,688");
  }
  // 1c. DHT-DET：level 70 WHM，bases (0,100)，S=2000，x*=1026
  {
    const cases = [
      [1026, 627, 4627, 1167, 5_399_709n],
      [0, 0, 4000, 1326, 5_304_000n],
      [2000, 1222, 5222, 1015, 5_300_330n],
    ];
    for (const [x, expectedTH, expectedFH, expectedTD, expectedProduct] of cases) {
      const p = pairPoint(70, "WHM", "DHT-DET", 0, 100, 2000, x);
      assert(p.left.tier === expectedTH && p.left.factor === expectedFH, `DHT-DET F_H ${x}`);
      assert(p.right.tier === expectedTD, `DHT-DET F_D ${x}`);
      assert(p.product === expectedProduct, `DHT-DET 乘积 ${x}`);
    }
    const scan = sliceScan(70, "WHM", "DHT-DET", 0, 100, 2000);
    assert(scan.best.x === 1026, "DHT-DET 反例的 argmax 应为 x=1026");
    assert(scan.best.product > scan.leftEnd && scan.best.product > scan.rightEnd, "DHT-DET 内部点严格大于两端");
    ok("A1.counterexample.DHT-DET",
      "L70 WHM bases=(0,100) S=2000 x*=1026：F_H=4627 F_D=1167 乘积=5,399,709 > 端点 5,304,000 / 5,300,330");
  }
  // 1d. 两个 S=50 的紧凑反例（来自 search-counterexamples.mjs §1 的最紧凑证书）
  {
    const crtDet = sliceScan(50, "WHM", "CRT-DET", 0, 0, 50);
    assert(crtDet.best.x === 6, "L50 WHM CRT-DET S=50 argmax 应为 x=6");
    assert(crtDet.best.product === 1_051_999_770n, "L50 WHM CRT-DET S=50 内部最大值");
    assert(crtDet.leftEnd === 1_050_600_000n && crtDet.rightEnd === 1_033_891_000n,
      "L50 WHM CRT-DET S=50 端点值");
    const dhtDet = sliceScan(50, "WHM", "DHT-DET", 0, 0, 50);
    assert(dhtDet.best.x === 6, "L50 WHM DHT-DET S=50 argmax 应为 x=6");
    assert(dhtDet.best.product === 4_129_270n, "L50 WHM DHT-DET S=50 内部最大值");
    assert(dhtDet.leftEnd === 4_120_000n && dhtDet.rightEnd === 4_080_000n,
      "L50 WHM DHT-DET S=50 端点值");
    ok("A1.compact.S50",
      "S=50 紧凑反例：L50 WHM CRT-DET x*=6 -> 1,051,999,770（端点 1,050,600,000 / 1,033,891,000）；" +
        "L50 WHM DHT-DET x*=6 -> 4,129,270（端点 4,120,000 / 4,080,000）");
  }
}

// ===========================================================================
// §2 实际尺度网格端点最大反例普查
// 与 verification/search-counterexamples.mjs §1b 完全同网格：
//   baselines {0,100,300,500,800,1000,1500,2000}^2，S {50,100,200,400,610,800,1000,1500,2000}
// 期望值取自该权威脚本输出，本脚本独立重算并逐项核对。
// ===========================================================================
const REALISTIC_BASES = [0, 100, 300, 500, 800, 1000, 1500, 2000];
const REALISTIC_S = [50, 100, 200, 400, 610, 800, 1000, 1500, 2000];
const EXPECTED_GRID = {
  "CRT-DHT|50|WHM": [245, 4], "CRT-DHT|50|BLU": [244, 4],
  "CRT-DHT|60|WHM": [304, 4], "CRT-DHT|60|BLU": [316, 5],
  "CRT-DHT|70|WHM": [371, 6], "CRT-DHT|70|BLU": [399, 6],
  "CRT-DHT|80|WHM": [412, 7], "CRT-DHT|80|BLU": [460, 6],
  "CRT-DHT|90|WHM": [444, 8], "CRT-DHT|90|BLU": [492, 7],
  "CRT-DHT|100|WHM": [446, 7], "CRT-DHT|100|BLU": [509, 7],
  "CRT-DET|50|WHM": [498, 1048], "CRT-DET|50|BLU": [498, 1171],
  "CRT-DET|60|WHM": [199, 12], "CRT-DET|60|BLU": [189, 14],
  "CRT-DET|70|WHM": [327, 11], "CRT-DET|70|BLU": [316, 11],
  "CRT-DET|80|WHM": [434, 12], "CRT-DET|80|BLU": [437, 11],
  "CRT-DET|90|WHM": [476, 14], "CRT-DET|90|BLU": [503, 12],
  "CRT-DET|100|WHM": [464, 12], "CRT-DET|100|BLU": [505, 12],
  "DHT-DET|50|WHM": [543, 887], "DHT-DET|50|BLU": [546, 744],
  "DHT-DET|60|WHM": [494, 364], "DHT-DET|60|BLU": [494, 329],
  "DHT-DET|70|WHM": [509, 180], "DHT-DET|70|BLU": [493, 160],
  "DHT-DET|80|WHM": [548, 92], "DHT-DET|80|BLU": [532, 81],
  "DHT-DET|90|WHM": [558, 49], "DHT-DET|90|BLU": [542, 44],
  "DHT-DET|100|WHM": [549, 27], "DHT-DET|100|BLU": [523, 24],
};
{
  let checked = 0;
  const worstByPairLevel = {};
  for (const level of LEVELS) {
    for (const job of JOBS) {
      for (const pair of Object.keys(PAIRS)) {
        let violations = 0;
        let worstBp = 0;
        for (const bL of REALISTIC_BASES) {
          for (const bR of REALISTIC_BASES) {
            for (const S of REALISTIC_S) {
              let best = -1;
              let leftEnd = 0;
              let rightEnd = 0;
              for (let x = 0; x <= S; x += 1) {
                const product = productNumber(level, job, pair, bL, bR, S, x);
                if (x === 0) leftEnd = product;
                if (x === S) rightEnd = product;
                if (product > best) best = product;
              }
              const endpointMax = leftEnd > rightEnd ? leftEnd : rightEnd;
              if (best > endpointMax) {
                violations += 1;
                const bp = Math.floor(((best - endpointMax) * 10000) / endpointMax);
                if (bp > worstBp) worstBp = bp;
              }
            }
          }
        }
        const expected = EXPECTED_GRID[`${pair}|${level}|${job}`];
        assert(expected !== undefined, `缺少期望网格值 ${pair}|${level}|${job}`);
        assert(violations === expected[0],
          `${pair}|${level}|${job} 反例个数不一致：重算 ${violations} vs 权威 ${expected[0]}`);
        assert(worstBp === expected[1],
          `${pair}|${level}|${job} 最大相对差 bp 不一致：重算 ${worstBp} vs 权威 ${expected[1]}`);
        assert(violations > 0, `${pair}|${level}|${job} 必须至少有一个反例`);
        worstByPairLevel[`${pair}|${level}|${job}`] = worstBp;
        checked += 1;
      }
    }
  }
  ok("A1b.grid-census",
    `${checked} 个 (pair,level,job) 组合全部存在端点最大反例（共 36 个组合 × ${REALISTIC_BASES.length ** 2}×${REALISTIC_S.length} 个切片）；` +
    `反例个数与最大相对差 bp 与 search-counterexamples.mjs 权威输出逐项一致`);
  for (const level of [60, 70, 80, 90, 100]) {
    const crtDht = Math.max(worstByPairLevel[`CRT-DHT|${level}|WHM`], worstByPairLevel[`CRT-DHT|${level}|BLU`]);
    const crtDet = Math.max(worstByPairLevel[`CRT-DET|${level}|WHM`], worstByPairLevel[`CRT-DET|${level}|BLU`]);
    const dhtDet = Math.max(worstByPairLevel[`DHT-DET|${level}|WHM`], worstByPairLevel[`DHT-DET|${level}|BLU`]);
    assert(crtDht <= 8, `L${level} CRT-DHT 最大相对差应 <= 8bp`);
    assert(crtDet >= 11 && crtDet <= 14, `L${level} CRT-DET 最大相对差应在 11-14bp`);
    assert(dhtDet > crtDet && dhtDet > crtDht, `L${level} DHT-DET 应为三者最大`);
  }
  assert(worstByPairLevel["CRT-DET|50|WHM"] === 1048 && worstByPairLevel["CRT-DET|50|BLU"] === 1171,
    "L50 CRT-DET 应出现 1048/1171bp 的大反例（detTrunc=5 量化）");
  assert(worstByPairLevel["DHT-DET|50|WHM"] === 887 && worstByPairLevel["DHT-DET|50|BLU"] === 744,
    "L50 DHT-DET 最大相对差应为 887/744bp");
  ok("A1b.pattern",
    "level>=60：CRT-DHT <=8bp、CRT-DET 11-14bp、DHT-DET 最大（L60 364bp / L70 180bp / L80 92bp / L90 49bp / L100 27bp）；" +
    "level 50：detTrunc=5 把 CRT-DET 放大到 1048/1171bp、DHT-DET 887/744bp");
}

// ===========================================================================
// §3 切片阶梯结构与平台定理（Theorem 2）
// ===========================================================================
function analyzeSlice(level, job, pair, bL, bR, S, lo = 0, hi = S) {
  const [statL, statR] = PAIRS[pair];
  const value = (x) => BigInt(factorsOf(level, job, statL, bL + x).factor) *
    BigInt(factorsOf(level, job, statR, bR + S - x).factor);
  const steps = [];
  for (let x = lo + 1; x <= hi; x += 1) {
    const upC = leftJump(level, job, pair, bL, x);
    const downH = tier(level, job, statR, bR + S - x) <
      tier(level, job, statR, bR + S - x + 1);
    const delta = value(x) - value(x - 1);
    steps.push({ x, upC, downH, sign: delta > 0n ? 1 : delta < 0n ? -1 : 0 });
  }
  const counts = { C: 0, H: 0, both: 0, neither: 0, inc: 0, dec: 0, flat: 0, bothUp: 0, bothDown: 0, bothFlat: 0 };
  for (const s of steps) {
    if (s.upC && s.downH) counts.both += 1;
    else if (s.upC) counts.C += 1;
    else if (s.downH) counts.H += 1;
    else counts.neither += 1;
    if (s.sign > 0) counts.inc += 1; else if (s.sign < 0) counts.dec += 1; else counts.flat += 1;
    if (s.upC && s.downH) {
      if (s.sign > 0) counts.bothUp += 1; else if (s.sign < 0) counts.bothDown += 1; else counts.bothFlat += 1;
    }
  }
  const plateaus = [];
  for (const s of steps) {
    if (s.sign !== 1) continue;
    let end = s.x;
    while (end + 1 <= hi && value(end + 1) === value(end)) end += 1;
    plateaus.push({ start: s.x, end, atBoundary: end === hi });
  }
  let signChanges = 0;
  let previousSign = 0;
  for (const s of steps) {
    if (previousSign === 1 && s.sign === -1) signChanges += 1;
    if (s.sign !== 0) previousSign = s.sign;
  }
  // 真正的严格局部极大平台：压缩掉 0 后，一个 + 后面紧跟一个 -，
  // 对应“上升步开始的平台恰以严格下降步结束”。仅此类平台是严格局部极大平台。
  const compressed = steps.filter((s) => s.sign !== 0).map((s) => s.sign);
  let increaseRuns = 0;
  let strictInteriorMaxPlateaus = 0;
  for (let i = 0; i < compressed.length; i += 1) {
    if (compressed[i] !== 1) continue;
    if (i === 0 || compressed[i - 1] !== 1) increaseRuns += 1;
    if (i + 1 < compressed.length && compressed[i + 1] === -1) strictInteriorMaxPlateaus += 1;
  }
  let bestValue = value(lo);
  let bestX = lo;
  for (let x = lo + 1; x <= hi; x += 1) {
    const v = value(x);
    if (v > bestValue) { bestValue = v; bestX = x; }
  }
  return {
    value, steps, counts, plateaus, signChanges, increaseRuns, strictInteriorMaxPlateaus, bestValue, bestX,
  };
}
{
  // 3a. 结构引理：上升步 ⊂ 左跳变；下降步 ⊂ 右掉档；仅左跳变步必上升。
  for (const level of LEVELS) {
    for (const job of JOBS) {
      for (const pair of Object.keys(PAIRS)) {
        const st = analyzeSlice(level, job, pair, 137, 271, 233);
        for (const s of st.steps) {
          if (s.sign > 0) assert(s.upC, `${pair} L${level}: 上升步 ${s.x} 必须是左档位跳变步`);
          if (s.sign < 0) assert(s.downH, `${pair} L${level}: 下降步 ${s.x} 必须是右档位下降步`);
          if (s.upC && !s.downH) assert(s.sign > 0, `${pair} L${level}: 仅左跳变步 ${s.x} 必须严格上升`);
          if (s.downH && !s.upC) assert(s.sign < 0, `${pair} L${level}: 仅右下降步 ${s.x} 必须严格下降`);
          if (!s.upC && !s.downH) assert(s.sign === 0, `${pair} L${level}: 无事件步 ${s.x} 必须平坦`);
        }
        const inc = st.counts.inc;
        let previousEnd = -1;
        for (const p of st.plateaus) {
          assert(p.start > previousEnd, "平台必须互不相交且有序");
          previousEnd = p.end;
        }
        assert(st.plateaus.filter((p) => p.atBoundary).length <= 1, "至多一个平台触及右端点");
        assert(st.plateaus.length === inc, "上升步与平台应一一对应");
        // 真正的严格局部极大平台数 = “+ 后紧跟 -”的个数；它不超过上升步数与下降步数。
        assert(st.strictInteriorMaxPlateaus <= inc &&
          st.strictInteriorMaxPlateaus <= st.counts.dec &&
          st.strictInteriorMaxPlateaus <= st.increaseRuns,
        "严格局部极大平台数应不超过上升步数/下降步数/上升段数");
        assert(st.increaseRuns <= inc, "上升段数应不超过上升步数");
      }
    }
  }
  ok("A2.structure-lemma",
    "全部等级 × WHM/BLU × 三属性对（bases=(137,271), S=233）：上升步必为左档位跳变步、下降步必为右档位下降步、" +
      "仅左跳变步必严格上升、仅右下降步必严格下降、无事件步必平坦；每个上升步开启一个平台，平台互不相交");
}
{
  // 3b. 精确计数证书：level 70 WHM CRT-DHT bases=(300,500) S=610（与 Lead 脚本一致）
  const st = analyzeSlice(70, "WHM", "CRT-DHT", 300, 500, 610);
  assert(st.counts.C === 68 && st.counts.both === 68 && st.counts.bothUp === 68 && st.counts.bothDown === 0,
    "L70 证书：CRT 跳变 136 = 68 仅 CRT + 68 联合（全部上升）");
  const jumps = st.counts.C + st.counts.both;
  const drops = st.counts.H + st.counts.both;
  assert(st.counts.H === 305, `L70 证书：仅 DHT 下降步应为 305，实际 ${st.counts.H}`);
  assert(jumps === 136 && drops === 373,
    `L70 证书：CRT 跳变 136 / DHT 档位下降步 373（= 仅 DHT 305 + 联合 68），实际 ${jumps}/${drops}`);
  assert(st.counts.inc === 136 && st.counts.dec === 305 && st.counts.flat === 169,
    "L70 证书：G 上升步 136 / G 下降步 305 / 平坦 169");
  assert(st.plateaus.length === 136, "L70 证书：上升步开启的平台 136 个");
  assert(st.strictInteriorMaxPlateaus === 136 && st.increaseRuns === 136,
    "L70 证书：每个上升步都单独成段且后接下降步，严格局部极大平台 = 136");
  const firstSix = st.plateaus.slice(0, 6).map((p) => `${p.start}..${p.end}`).join(",");
  assert(firstSix === "2..2,6..7,11..12,15..15,20..20,24..25", `L70 证书首平台不符：${firstSix}`);
  assert(st.signChanges === 136, "L70 证书：+ -> - 转折应为 136");
  assert(st.bestX === 609 && st.bestValue === 4_959_237_424n, "L70 证书：切片最大值应在 x=609 取到 4,959,237,424");
  assert(st.value(0) === 4_930_873_968n && st.value(610) === 4_958_085_720n, "L70 证书：端点值不符");
  assert(st.bestValue > st.value(0) && st.bestValue > st.value(610), "L70 (300,500,610) 也是端点最大反例");
  const expectedJumpUpper = Math.ceil((610 * 200) / 900);
  assert(jumps === expectedJumpUpper, `L70 CRT 跳变数应为 ceil(610·200/900)=${expectedJumpUpper}`);
  ok("A2.certificate.L70",
    "L70 WHM CRT-DHT bases=(300,500) S=610：CRT 跳变 136（68 仅 CRT + 68 联合，全部上升）、DHT 档位下降步 373、" +
      "G 上升步 J+=136、G 下降步 305、平坦 169、上升步开启平台 136 个且全部以严格下降步结束（严格局部极大平台 136）；" +
      "前六个平台区间 2..2,6..7,11..12,15..15,20..20,24..25；" +
      "切片最大值 4,959,237,424 在 x=609 取得（> 端点 4,930,873,968 / 4,958,085,720）");
  // 3c. comment-01 的贡献坐标切片（面板 739/743/769 -> 贡献 375/379/477；见参考模型 §2.1）。
  //     所有 b_i,b_j,S 都是贡献单位，不是面板总值。
  const comment = analyzeSlice(70, "WHM", "CRT-DHT", 375, 379, 610);
  const commentJumps = comment.counts.C + comment.counts.both;
  assert(comment.counts.C === 67 && comment.counts.both === 68 && comment.counts.bothUp === 68 &&
    comment.counts.bothDown === 0, "comment-01 贡献切片：CRT 跳变 135 = 67 仅 CRT + 68 联合（全部上升）");
  assert(commentJumps === 135, "comment-01 贡献切片：CRT 跳变 135");
  assert(comment.counts.H === 305 && comment.counts.H + comment.counts.both === 373,
    "comment-01 贡献切片：DHT 档位下降步 373（305 仅 DHT + 68 联合）");
  assert(comment.counts.inc === 135 && comment.counts.dec === 305 && comment.counts.flat === 170,
    "comment-01 贡献切片：G 上升 135 / 下降 305 / 平坦 170");
  assert(comment.strictInteriorMaxPlateaus === 135 && comment.increaseRuns === 135,
    "comment-01 贡献切片：严格局部极大平台 135");
  assert(comment.bestX === 606 && comment.bestValue === 4_935_252_016n,
    "comment-01 贡献切片：最大值应在 x=606 取得 4,935,252,016");
  assert(comment.value(0) === 4_899_756_356n && comment.value(610) === 4_931_755_144n,
    "comment-01 贡献切片：端点值应为 4,899,756,356 / 4,931,755,144");
  assert(comment.bestValue > comment.value(0) && comment.bestValue > comment.value(610),
    "comment-01 贡献切片：内部最大仍严格大于两端（端点最大反例）");
  // 对照：若错误地把面板总值 739/743 当作贡献输入，事件结构会质变（0 个仅 CRT 跳变步、135 个联合步），
  // 数值也不同。该对照只用于说明坐标审计的必要性，不是本文的有效示例。
  const panelMisuse = analyzeSlice(70, "WHM", "CRT-DHT", 739, 743, 610);
  assert(panelMisuse.counts.C === 0 && panelMisuse.counts.both === 135,
    "面板误用对照：把 739/743 当贡献会得到 0 个仅 CRT 步 + 135 个联合步");
  ok("A2.certificate.comment01",
    "L70 WHM CRT-DHT 评论 01 贡献切片 bases=(375,379) S=610（面板 739/743 减 sub=364）：" +
      "135 个 CRT 跳变（67 仅 CRT + 68 联合，全部上升）、DHT 档位下降步 373；G 上升 135 / 下降 305 / 平坦 170、" +
      "严格局部极大平台 135；最大值 4,935,252,016 在 x=606（端点 4,899,756,356 / 4,931,755,144）。" +
      "对照：把面板值 739/743 直接当贡献会得到 0 个仅 CRT 步 + 135 个联合步、最大值 5,541,801,705——坐标误用会质变结构与数值");
  // 3d. level 50 WHM DHT-DET bases=(100,100) S=1000：左(DHT)每步跳变，联合步全部下降
  const level50 = analyzeSlice(50, "WHM", "DHT-DET", 100, 100, 1000);
  assert(level50.counts.C === 861 && level50.counts.both === 139 && level50.counts.bothDown === 139,
    "L50 DHT-DET：左跳变 1000 = 861 仅 DHT + 139 联合（全部下降）");
  assert(level50.counts.inc === 861 && level50.counts.dec === 139 && level50.counts.flat === 0,
    "L50 DHT-DET：上升 861 / 下降 139 / 平坦 0");
  assert(level50.strictInteriorMaxPlateaus <= level50.counts.inc,
    "L50 DHT-DET：严格局部极大平台数应 <= 上升步数");
  assert(level50.increaseRuns <= level50.counts.dec + 1, "L50 DHT-DET：上升段数应 <= 下降步数+1");
  assert(level50.plateaus.length === 861, "L50 DHT-DET：上升步开启平台 861 个");
  assert(level50.bestX === 3 && level50.bestValue === 7_332_160n, "L50 DHT-DET：最大值应在 x=3 取得 7,332,160");
  assert(level50.value(0) === 7_323_360n && level50.value(1000) === 6_149_310n, "L50 DHT-DET：端点值不符");
  ok("A2.certificate.L50",
    "L50 WHM DHT-DET bases=(100,100) S=1000：左(DHT)档位每步跳变 1000 次（861 仅 DHT 上升 + 139 联合且全部下降）；" +
      `上升步 J+=861（每个上升步开启一个长度 1 的平台）、下降步 139、上升段 ${level50.increaseRuns}、` +
      `真正的严格局部极大平台 ${level50.strictInteriorMaxPlateaus}（J+ 在此不等于局部极大数，说明“平台”与“局部极大平台”必须区分）；` +
      "最大值 7,332,160 在 x=3（端点 7,323,360 / 6,149,310）");
}
{
  // 3e. 联合步方向并非总由类型决定：L50 CRT-DHT 双档下降反例（a_DHT=550 > q=341，可一步掉 2 档）
  const st = analyzeSlice(50, "WHM", "CRT-DHT", 0, 0, 200);
  const downJoint = st.steps.filter((s) => s.upC && s.downH && s.sign < 0);
  assert(downJoint.length >= 8, `L50 CRT-DHT (0,0,200) 联合下降步应至少 8 个，实际 ${downJoint.length}`);
  const p5 = pairPoint(50, "WHM", "CRT-DHT", 0, 0, 200, 5);
  const p6 = pairPoint(50, "WHM", "CRT-DHT", 0, 0, 200, 6);
  assert(p5.left.tier === 52 && p6.left.tier === 53 && p5.right.tier === 314 && p6.right.tier === 312,
    "L50 CRT-DHT x=6 联合步档位数不符");
  assert(p5.product === 4_404_179_856n && p6.product === 4_404_100_008n, "L50 CRT-DHT x=6 联合步乘积不符");
  assert(p6.product < p5.product, "L50 CRT-DHT x=6 联合步应使 G 下降");
  ok("A2.joint-step-sign-caveat",
    `L50 WHM CRT-DHT bases=(0,0) S=200：${downJoint.length} 个联合步使 G 下降（反例 x=6：t_C 52->53、t_H 314->312，` +
      "G 4,404,179,856->4,404,100,008）；联合步方向不能仅由类型判定，必须用精确乘积比较");
}
{
  // 3f. 每相对相位的联合步计数：给出 J+ 的无条件下界（仅左跳变步数）。
  const phaseSummary = {};
  for (const level of LEVELS) {
    for (const pair of Object.keys(PAIRS)) {
      const [statL, statR] = PAIRS[pair];
      const pl = tierPeriod(level, "WHM", statL);
      const pr = tierPeriod(level, "WHM", statR);
      const L = (pl.period * pr.period) / gcd(pl.period, pr.period);
      const g = gcd(pl.period, pr.period);
      const jointCounts = [];
      for (let phase = 0; phase < g; phase += 1) {
        let joint = 0;
        let cSteps = 0;
        let hSteps = 0;
        for (let x = 0; x < L; x += 1) {
          const upC = tier(level, "WHM", statL, x + 1) > tier(level, "WHM", statL, x);
          const y = L + phase - x;
          const downH = tier(level, "WHM", statR, y) > tier(level, "WHM", statR, y - 1);
          if (upC) cSteps += 1;
          if (downH) hSteps += 1;
          if (upC && downH) joint += 1;
        }
        jointCounts.push(joint);
        assert(cSteps === (tierParameters(level, "WHM", statL).a <= tierParameters(level, "WHM", statL).q
          ? (tierParameters(level, "WHM", statL).a * L) / tierParameters(level, "WHM", statL).q : L),
        "每周期左跳变数不符");
        assert(hSteps === (tierParameters(level, "WHM", statR).a <= tierParameters(level, "WHM", statR).q
          ? (tierParameters(level, "WHM", statR).a * L) / tierParameters(level, "WHM", statR).q : L),
        "每周期右下降数不符");
      }
      const paramL = tierParameters(level, "WHM", statL);
      phaseSummary[`${pair}|${level}`] = {
        L,
        g,
        minJoint: Math.min(...jointCounts),
        maxJoint: Math.max(...jointCounts),
        expectedC: paramL.a <= paramL.q ? (paramL.a * L) / paramL.q : L,
      };
    }
  }
  const crtDht70 = phaseSummary["CRT-DHT|70"];
  ok("A2.phase-joint-census",
    `全部等级/属性对的每周期事件计数与相位类（gcd(P_L,P_R) 类）核对通过；例：L70 CRT-DHT 周期 L=18、9 个相对相位类、` +
      `每周期 CRT 跳变 4 / DHT 下降 11、联合步 ${crtDht70.minJoint}..${crtDht70.maxJoint}（故仅 CRT 跳变步下界 ` +
      `${crtDht70.expectedC - crtDht70.maxJoint}..${crtDht70.expectedC - crtDht70.minJoint}）`);
}
{
  // 3g. 非单峰/非 single-crossing：符号序列 + -> - 转折 >= 2 的触发条件（数值核对）
  for (const [level, job, pair, bL, bR, S] of [
    [70, "WHM", "CRT-DHT", 300, 500, 610],
    [70, "WHM", "CRT-DHT", 739, 743, 610],
    [50, "WHM", "DHT-DET", 100, 100, 1000],
    [60, "BLU", "CRT-DHT", 0, 0, 300],
    [100, "WHM", "CRT-DET", 250, 150, 800],
  ]) {
    const st = analyzeSlice(level, job, pair, bL, bR, S);
    if (st.counts.inc >= 2 && st.counts.dec >= 1) {
      assert(st.signChanges >= 2, `${pair} L${level} 应至少两次符号转折`);
    }
  }
  ok("A2.non-unimodal",
    "所有含 >=2 个上升步且有下降步的抽样切片，符号序列的 + -> - 转折均 >=2：G 既非单峰，也不满足“离散增量符号至多一次变化”");
}

// ===========================================================================
// §4 条件端点定理、精确判据、逐点比率分离的失效
// ===========================================================================
{
  function criticalSetLeft(level, job, pair, bL, S, lo, hi) {
    const [statL] = PAIRS[pair];
    const positions = new Set([lo]);
    const params = tierParameters(level, job, statL);
    const tierAtLo = tier(level, job, statL, bL + lo);
    const tierAtHi = tier(level, job, statL, bL + hi);
    for (let k = tierAtLo + params.mult; k <= tierAtHi; k += params.mult) {
      const g = firstContributionWithTierAtLeast(level, job, statL, k);
      const x = g - bL;
      if (x > lo && x <= hi) positions.add(x);
    }
    const brute = new Set([lo]);
    for (let x = lo + 1; x <= hi; x += 1) {
      if (tier(level, job, statL, bL + x) > tier(level, job, statL, bL + x - 1)) brute.add(x);
    }
    assert(positions.size === brute.size && [...positions].every((x) => brute.has(x)),
      `阈值公式关键集与暴力跳变集不一致 ${pair} L${level} bases=${bL} [${lo},${hi}]`);
    return positions;
  }
  function criticalSetRight(level, job, pair, bR, S, lo, hi) {
    const [, statR] = PAIRS[pair];
    const positions = new Set([hi]);
    const params = tierParameters(level, job, statR);
    const yLow = bR + S - hi;
    const yHigh = bR + S - lo;
    const tierLow = tier(level, job, statR, yLow);
    const tierHigh = tier(level, job, statR, yHigh);
    for (let k = tierLow + params.mult; k <= tierHigh; k += params.mult) {
      const y = firstContributionWithTierAtLeast(level, job, statR, k);
      const x = bR + S - y;
      if (x >= lo && x < hi) positions.add(x);
    }
    const brute = new Set([hi]);
    for (let x = hi - 1; x >= lo; x -= 1) {
      const y = bR + S - x;
      if (tier(level, job, statR, y) > tier(level, job, statR, y - 1)) brute.add(x);
    }
    assert(positions.size === brute.size && [...positions].every((x) => brute.has(x)),
      `阈值公式右关键集与暴力不一致 ${pair} L${level} bases=${bR} [${lo},${hi}]`);
    return positions;
  }
  let checks = 0;
  for (const level of LEVELS) {
    for (const job of JOBS) {
      for (const pair of Object.keys(PAIRS)) {
        for (const bL of [0, 300, 1200]) {
          for (const bR of [0, 300, 1200]) {
            for (const S of [120, 610, 2000]) {
              for (const [lo, hi] of [[0, S], [Math.floor(S / 3), Math.floor((2 * S) / 3)]]) {
                const kLeft = criticalSetLeft(level, job, pair, bL, S, lo, hi);
                const kRight = criticalSetRight(level, job, pair, bR, S, lo, hi);
                let fullMax = -1n;
                for (let x = lo; x <= hi; x += 1) {
                  const p = pairPoint(level, job, pair, bL, bR, S, x).product;
                  if (p > fullMax) fullMax = p;
                }
                let leftMax = -1n;
                for (const x of kLeft) {
                  const p = pairPoint(level, job, pair, bL, bR, S, x).product;
                  if (p > leftMax) leftMax = p;
                }
                let rightMax = -1n;
                for (const x of kRight) {
                  const p = pairPoint(level, job, pair, bL, bR, S, x).product;
                  if (p > rightMax) rightMax = p;
                }
                assert(leftMax === fullMax && rightMax === fullMax,
                  `关键集最大值不等于全扫描最大值 ${pair} L${level} b=(${bL},${bR}) S=${S} [${lo},${hi}]`);
                const pLo = pairPoint(level, job, pair, bL, bR, S, lo).product;
                const pHi = pairPoint(level, job, pair, bL, bR, S, hi).product;
                const endpointMax = pLo > pHi ? pLo : pHi;
                const endpointMaxHolds = fullMax <= endpointMax;
                let criticalBeatsEndpoints = false;
                for (const x of kLeft) {
                  const p = pairPoint(level, job, pair, bL, bR, S, x).product;
                  if (p > endpointMax) { criticalBeatsEndpoints = true; break; }
                }
                assert(endpointMaxHolds === !criticalBeatsEndpoints,
                  `端点判据等价性失败 ${pair} L${level} b=(${bL},${bR}) S=${S} [${lo},${hi}]`);
                checks += 1;
              }
            }
          }
        }
      }
    }
  }
  ok("A3.decision-criterion",
    `${checks} 个切片（全部等级 × WHM/BLU × 三属性对 × 3×3 baselines × 3 个 S × 2 个 [lo,hi]）上：` +
      `max_{[lo,hi]} G = max_{K_L} G = max_{K_R} G；且“端点最大”当且仅当关键集无点严格超过两端——这是精确判据而非采样`);
}
{
  // 4b. 条件单调引理：左档位恒定 => G 非增；右档位恒定 => G 非减。
  //     构造方式：取左属性在 lo 处、向右连续宽度 Lw 内档位恒定的最大切片；
  //     取右属性在 [0, Rw] 上档位恒定的最大切片。
  let checked = 0;
  let skippedRight = 0;
  let skippedLeft = 0;
  for (const level of LEVELS) {
    for (const pair of Object.keys(PAIRS)) {
      const [statL, statR] = PAIRS[pair];
      // 左档位恒定切片：找到 lo 使 t_L(lo) == t_L(lo+1)，再扩展到最大宽度。
      let lo = -1;
      for (let candidate = 0; candidate <= 40 && lo < 0; candidate += 1) {
        if (tier(level, "WHM", statL, candidate) === tier(level, "WHM", statL, candidate + 1)) {
          lo = candidate;
        }
      }
      if (lo >= 0) {
        const tierAtLo = tier(level, "WHM", statL, lo);
        let hiLeft = lo + 1;
        while (tier(level, "WHM", statL, hiLeft + 1) === tierAtLo) hiLeft += 1;
        const st = analyzeSlice(level, "WHM", pair, 0, 0, hiLeft, lo, hiLeft);
        let previous = st.value(lo);
        for (let x = lo + 1; x <= hiLeft; x += 1) {
          assert(!leftJump(level, "WHM", pair, 0, x), `左档位恒定假设失败 ${pair} L${level} x=${x}`);
          const current = st.value(x);
          assert(current <= previous, `左档位恒定时 G 必须非增 ${pair} L${level} x=${x}`);
          previous = current;
        }
      } else {
        // 例：L50 DHT 的 a=550 > q=341，每一步档位都变，左档位恒定区间宽度为 0，条件为空真。
        skippedLeft += 1;
      }
      // 右档位恒定切片：右贡献从 S 降到 0 全程同一档位。
      const tierAtZero = tier(level, "WHM", statR, 0);
      let widthR = 0;
      while (tier(level, "WHM", statR, widthR + 1) === tierAtZero) widthR += 1;
      if (widthR >= 1) {
        const stR = analyzeSlice(level, "WHM", pair, 0, 0, widthR, 0, widthR);
        let previousR = stR.value(0);
        for (let x = 1; x <= widthR; x += 1) {
          const y = widthR - x;
          assert(tier(level, "WHM", statR, y) === tier(level, "WHM", statR, y + 1),
            `右档位恒定假设失败 ${pair} L${level} x=${x}`);
          const current = stR.value(x);
          assert(current >= previousR, `右档位恒定时 G 必须非减 ${pair} L${level} x=${x}`);
          previousR = current;
        }
      } else {
        // 例：L50 DHT 的 a=550 > q=341，每一步档位都变，右档位恒定区间宽度为 0（无可用步骤），
        // 引理 (b) 的条件在该等级/属性上为空真，不作为数值检查点。
        skippedRight += 1;
      }
      checked += 1;
    }
  }
  ok("A3.monotone-lemmas",
    `${checked} 组（全部等级 × 三属性对）左档位恒定切片上 G 逐点非增、右档位恒定切片上 G 逐点非减；` +
      `其中 ${skippedRight} 组（L50 DHT 作右属性）因档位每步都变而无宽度 >=1 的右档位恒定切片，条件为空真`);
}
{
  // 4c. 逐点比率分离条件必然失效
  const st = analyzeSlice(70, "WHM", "CRT-DHT", 300, 500, 610);
  const [statL, statR] = PAIRS["CRT-DHT"];
  const ratioL = (x) => factorsOf(70, "WHM", statL, 300 + x).factor / factorsOf(70, "WHM", statL, 300 + x - 1).factor;
  const ratioR = (x) => factorsOf(70, "WHM", statR, 500 + 610 - x + 1).factor /
    factorsOf(70, "WHM", statR, 500 + 610 - x).factor;
  const pureLeft = st.steps.find((s) => s.upC && !s.downH);
  const pureRight = st.steps.find((s) => !s.upC && s.downH);
  assert(pureLeft !== undefined && pureRight !== undefined, "应同时存在仅左跳变步与仅右下降步");
  assert(ratioL(pureLeft.x) > 1 && Math.abs(ratioR(pureLeft.x) - 1) < 1e-15,
    "仅左跳变步：F_i 比率>1 且 F_j 比率=1");
  assert(Math.abs(ratioL(pureRight.x) - 1) < 1e-15 && ratioR(pureRight.x) > 1,
    "仅右下降步：F_i 比率=1 且 F_j 比率>1");
  ok("A3.separation-failure",
    `L70 CRT-DHT (300,500,610)：仅左跳变步 x=${pureLeft.x} 处 F_C 比率>1、F_H 比率=1；` +
      `仅右下降步 x=${pureRight.x} 处 F_C 比率=1、F_H 比率>1。任何形如“每步 F_C 相对增益 >= F_H 相对增益”的逐点分离条件` +
      "必在右下降步被违反；反过来也必在左跳变步被违反——逐点分离无法给出端点最大");
}

// ===========================================================================
// §5 边界退化
// ===========================================================================
{
  for (const level of LEVELS) {
    for (const pair of Object.keys(PAIRS)) {
      const p = pairPoint(level, "WHM", pair, 0, 0, 0, 0);
      assert(p.product > 0n, "S=0 乘积必须为正");
    }
  }
  const st = analyzeSlice(70, "WHM", "CRT-DHT", 300, 500, 610, 100, 500);
  assert(st.bestX >= 100 && st.bestX <= 500, "cap 区间 [100,500] 的 argmax 必须落在区间内");
  assert(st.value(st.bestX) === st.bestValue, "cap 区间 argmax 值必须等于区间最大值");
  ok("A.boundary.S0-caps",
    "S=0 时切片退化为单点，端点最大平凡成立（全部等级/属性对）；cap 区间 [lo,hi] 的论证与 K 枚举已在 §4 全覆盖，" +
      `示例 [100,500]（bases=(300,500), S=610）的区间最大值为 ${st.bestValue}（x=${st.bestX}）`);
}
{
  const st = analyzeSlice(70, "WHM", "CRT-DHT", 0, 0, 1);
  assert(st.value(0) === st.value(1), "L70 S=1 DHT 贡献 0..1 均 tier=0，G 应相等");
  // DHT 贡献 <= 1 的尾部区间（x = 9,10 时贡献 1,0）上 F_H 恒为 4000。
  const st2 = analyzeSlice(70, "WHM", "CRT-DHT", 0, 0, 10);
  assert(tier(70, "WHM", "DHT", 1) === 0 && tier(70, "WHM", "DHT", 0) === 0,
    "L70 DHT 贡献 0/1 应均为 tier=0");
  assert(st2.value(10) === st2.value(9), "DHT tier=0 尾部区间上 G 应平坦（CRT 同类时）");
  ok("A.boundary.dht-zero",
    "L70 DHT 贡献 0 或 1 时 tier=0（F_H 恒 4000）；在该平台区间内 G 只随 CRT 非减，不会出现下降步");
}
{
  const blu = pairPoint(60, "BLU", "CRT-DHT", 0, 0, 50, 3);
  const whm = pairPoint(60, "WHM", "CRT-DHT", 0, 0, 50, 3);
  assert(blu.left.tier === whm.left.tier + 200 && blu.right.tier === whm.right.tier + 200,
    "L60 BLU 相对 WHM 的 CRT/DHT 档位应各 +200");
  assert(blu.left.factor !== whm.left.factor, "BLU 的 F_C 因 b_C=150 而不同");
  ok("A.boundary.blu",
    "L60 BLU vs WHM：CRT/DHT 档位各 +200 且 b_C=150；A1 的 CRT-DHT 反例正是 BLU（结构定理不依赖 BLU 标记）");
}
{
  const det50 = tierParameters(50, "WHM", "DET");
  assert(det50.mult === 5 && det50.q === 1010, "L50 DET 参数应为 mult=5, q=1010");
  const det60 = tierParameters(60, "WHM", "DET");
  assert(det60.mult === 2 && det60.q === 1200, "L60 DET 参数应为 mult=2, q=1200");
  for (let g = 0; g <= 200; g += 1) {
    assert(tier(50, "WHM", "DET", g) % 5 === 0, "L50 DET 档位必须是 5 的倍数");
  }
  ok("A.boundary.detTrunc", "L50/L60 DET 档位步长分别为 5/2（detTrunc），L50 的 DET 跳变密度最低，直接放大 DHT-DET/CRT-DET 的反例幅度");
}
{
  const p996 = pairPoint(70, "WHM", "CRT-DHT", 300, 500, 1000, 996);
  const p1000 = pairPoint(70, "WHM", "CRT-DHT", 300, 500, 1000, 1000);
  assert(p996.left.tier === 338 && p996.left.factor === 1_232_544, "死区例：x=996 CRT 档位/因子");
  assert(p996.right.tier === 308 && p996.right.factor === 4308, "死区例：x=996 DHT 档位/因子");
  assert(p996.product === 5_309_799_552n, "死区例：x=996 乘积");
  assert(p1000.left.tier === 338 && p1000.left.factor === 1_232_544, "死区例：x=1000 CRT 档位/因子");
  assert(p1000.right.tier === 305 && p1000.right.factor === 4305, "死区例：x=1000 DHT 档位/因子");
  assert(p1000.product === 5_306_101_920n, "死区例：x=1000 乘积");
  assert(p996.product > p1000.product, "死区例：x=996 应严格优于 x=1000");
  const nextCrt = firstContributionWithTierAtLeast(70, "WHM", "CRT", 339);
  assert(nextCrt === 1301, "L70 CRT 339 档的阈值应为 1301");
  ok("A.boundary.dead-zone",
    "L70 CRT-DHT bases=(300,500) S=1000：x=996 时 CRT 贡献 1296（档位 338，下一档阈值 1301，死区 1296..1300），" +
      "再投入 4 点到 x=1000 只浪费预算、DHT 却从 308 掉到 305：G 5,309,799,552 -> 5,306,101,920");
}

// ===========================================================================
// §6 Theorem B1：有限关键集
// ===========================================================================
{
  let worstRatio = 0;
  for (const level of LEVELS) {
    for (const job of JOBS) {
      for (const pair of Object.keys(PAIRS)) {
        const [statL] = PAIRS[pair];
        for (const [lo, hi] of [[0, 2000], [137, 1500]]) {
          let jumpCount = 0;
          for (let x = lo + 1; x <= hi; x += 1) {
            if (tier(level, job, statL, x) > tier(level, job, statL, x - 1)) jumpCount += 1;
          }
          const params = tierParameters(level, job, statL);
          const sizeBound = floorDiv(params.a * (hi - lo), params.q) + 2;
          assert(jumpCount + 1 <= sizeBound,
            `关键集大小超过上界 ${pair} L${level} ${job}：${jumpCount + 1} > ${sizeBound}`);
          worstRatio = Math.max(worstRatio, (jumpCount + 1) / (hi - lo + 1));
        }
      }
    }
  }
  ok("B1.size-bound",
    "对全部等级 × WHM/BLU × 三属性对：|K_L| <= floor(a_L·(hi-lo)/q_L)+2（对称地 |K_R| 同理）；" +
      `实测最大 |K_L|/(切片长度) = ${(worstRatio * 100).toFixed(1)}%`);
}
{
  for (const [level, job, pair, bL, bR, S] of [
    [70, "WHM", "CRT-DHT", 300, 500, 610],
    [70, "WHM", "DHT-DET", 0, 100, 2000],
    [50, "WHM", "DHT-DET", 100, 100, 1000],
  ]) {
    const [statL, statR] = PAIRS[pair];
    let jumpCount = 0;
    for (let x = 1; x <= S; x += 1) {
      if (tier(level, job, statL, bL + x) > tier(level, job, statL, bL + x - 1)) jumpCount += 1;
    }
    let dropCount = 0;
    for (let x = 1; x <= S; x += 1) {
      const y = bR + S - x;
      if (tier(level, job, statR, y + 1) > tier(level, job, statR, y)) dropCount += 1;
    }
    const paramL = tierParameters(level, job, statL);
    const paramR = tierParameters(level, job, statR);
    const densityL = paramL.a <= paramL.q ? paramL.a / paramL.q : 1;
    const densityR = paramR.a <= paramR.q ? paramR.a / paramR.q : 1;
    assert(Math.abs(jumpCount - densityL * S) <= 2, `左跳变计数与密度不符 ${pair} L${level}`);
    assert(Math.abs(dropCount - densityR * S) <= 2, `右下降计数与密度不符 ${pair} L${level}`);
    ok(`B1.worked.${pair}.L${level}`,
      `${pair} L${level} bases=(${bL},${bR}) S=${S}：|K_L|=${jumpCount + 1}（左密度 ${densityL.toFixed(4)}）、` +
        `|K_R|=${dropCount + 1}（右密度 ${densityR.toFixed(4)}）`);
  }
}

// ===========================================================================
// §7 Theorem B2：周期与交错结构
// ===========================================================================
{
  for (const level of LEVELS) {
    for (const job of JOBS) {
      for (const stat of ["CRT", "DHT", "DET"]) {
        const { period, shift } = tierPeriod(level, job, stat);
        for (let g = 0; g <= 300; g += 1) {
          assert(tier(level, job, stat, g + period) === tier(level, job, stat, g) + shift,
            `档位周期性质失败 ${level}/${job}/${stat}/${g}`);
        }
        const minimal = indicatorPeriod(level, job, stat, period);
        assert(period % minimal === 0, "跳变指示最小周期应整除档位周期");
        if (level === 50 && stat === "DHT") assert(minimal === 1, "L50 DHT 每步都跳变，指示最小周期应为 1");
      }
    }
  }
  ok("B2.tier-periodicity",
    "全部等级 × 属性：t(g+P)=t(g)+shift（P=q/gcd(a,q)）；跳变指示序列以 P 为周期，其最小周期整除 P（仅 L50 DHT 退化为 1）");
}
{
  const summary = {};
  for (const level of LEVELS) {
    for (const pair of Object.keys(PAIRS)) {
      const [statL, statR] = PAIRS[pair];
      const pl = tierPeriod(level, "WHM", statL).period;
      const pr = tierPeriod(level, "WHM", statR).period;
      const L = (pl * pr) / gcd(pl, pr);
      const wordAt = (x, phase) => {
        const up = tier(level, "WHM", statL, x + 1) > tier(level, "WHM", statL, x);
        const y = L + phase - x;
        const down = tier(level, "WHM", statR, y) > tier(level, "WHM", statR, y - 1);
        return up && down ? "B" : up ? "C" : down ? "H" : ".";
      };
      const g = gcd(pl, pr);
      for (let phase = 0; phase < g; phase += 1) {
        for (const x of [0, 1, 7, 100]) {
          for (const s of [0, 1, Math.floor(L / 3), Math.floor(L / 2)]) {
            assert(wordAt(x + s + L, phase) === wordAt(x + s, phase),
              `步型词周期失败 ${pair} L${level} phase=${phase} x=${x + s}`);
          }
        }
      }
      const paramL = tierParameters(level, "WHM", statL);
      const paramR = tierParameters(level, "WHM", statR);
      const driftL = (paramL.mult * paramL.a * L) / paramL.q;
      const driftR = (paramR.mult * paramR.a * L) / paramR.q;
      const counts = { C: 0, H: 0, B: 0, ".": 0 };
      for (let x = 0; x < L; x += 1) counts[wordAt(x, 0)] += 1;
      summary[`${pair}|${level}`] = { L, pl, pr, g, driftL, driftR, counts };
      // 每周期“跳变步数” = a·L/q（a<=q 时）；a>q 时每一步都跳变，为 L。
      const jumpStepsL = paramL.a <= paramL.q ? (paramL.a * L) / paramL.q : L;
      const jumpStepsR = paramR.a <= paramR.q ? (paramR.a * L) / paramR.q : L;
      assert(counts.C + counts.B === jumpStepsL,
        `每周期左跳变步数应等于 a_L·L/q_L ${pair} L${level}: ${counts.C + counts.B} vs ${jumpStepsL}`);
      assert(counts.H + counts.B === jumpStepsR,
        `每周期右下降步数应等于 a_R·L/q_R ${pair} L${level}: ${counts.H + counts.B} vs ${jumpStepsR}`);
      assert(counts.C + counts.H + counts.B + counts["."] === L, "步型词计数之和应等于 L");
    }
  }
  ok("B2.word-periodicity",
    "全部 (level,pair)：步型词（C/H/B/无事件）以 L=lcm(P_L,P_R) 为周期；每周期左跳变数 = a_L·L/q_L（a>q 时为 L），" +
      "右下降数 = a_R·L/q_R；tier 每周期漂移 (+a_L·L/q_L, -a_R·L/q_R)");
  for (const key of ["CRT-DHT|70", "CRT-DET|70", "DHT-DET|70", "CRT-DHT|50", "DHT-DET|50", "CRT-DHT|100"]) {
    const s = summary[key];
    ok(`B2.period.${key}`,
      `L=${s.L}（P_L=${s.pl}, P_R=${s.pr}, gcd=${s.g}）每周期计数 C/B/H/无 = ${s.counts.C}/${s.counts.B}/${s.counts.H}/${s.counts["."]}，` +
        `tier 漂移 (+${s.driftL}, -${s.driftR})`);
  }
}
{
  // 7c. 交错方式计数：步型词的最小周期 p_word = lcm(p_L, p_R)；随相位变化的互异步型词数 = p_L·p_R；
  //     平移等价（把切片整体平移视为同一交错方式）后的互异交错方式数 = p_L·p_R / p_word = gcd(p_L, p_R)。
  const table = [];
  for (const level of LEVELS) {
    const row = [];
    for (const pair of Object.keys(PAIRS)) {
      const [statL, statR] = PAIRS[pair];
      const pl = tierPeriod(level, "WHM", statL).period;
      const pr = tierPeriod(level, "WHM", statR).period;
      const pL = indicatorPeriod(level, "WHM", statL, pl);
      const pR = indicatorPeriod(level, "WHM", statR, pr);
      const pWord = (pL * pR) / gcd(pL, pR);
      const distinctWords = pL * pR;
      const rotationClasses = gcd(pL, pR);
      assert(pWord <= (pl * pr) / gcd(pl, pr), "步型词最小周期不应超过 L");
      assert(distinctWords / pWord === rotationClasses, "互异词数应等于交错方式数 × 词最小周期");
      row.push(`${pair}: L=${(pl * pr) / gcd(pl, pr)}, 词最小周期=${pWord}, 互异词=${distinctWords}, 平移等价类=${rotationClasses}`);
    }
    table.push(`L${level} ${row.join("；")}`);
  }
  ok("B2.interleavings",
    "互异步型词数与平移等价交错方式数（p_stat 为跳变指示最小周期）：" + table.join(" | "));
}

// ===========================================================================
// §8 O(1) 分段上界族 U_m（Theorem B3）
// ===========================================================================
{
  function boundU(level, job, pair, bL, bR, S, m, lo = 0, hi = S) {
    const [statL, statR] = PAIRS[pair];
    const D = hi - lo;
    let best = 0;
    for (let j = 0; j < m; j += 1) {
      const a = lo + floorDiv(j * D, m);
      const b = lo + floorDiv((j + 1) * D, m);
      const value = factorValue(level, job, statL, bL + b) * factorValue(level, job, statR, bR + S - a);
      if (value > best) best = value;
    }
    return best;
  }
  function exactMax(level, job, pair, bL, bR, S, lo = 0, hi = S) {
    const [statL, statR] = PAIRS[pair];
    let best = -1;
    for (let x = lo; x <= hi; x += 1) {
      const value = factorValue(level, job, statL, bL + x) * factorValue(level, job, statR, bR + S - x);
      if (value > best) best = value;
    }
    return best;
  }
  let checks = 0;
  for (const level of LEVELS) {
    for (const job of JOBS) {
      for (const pair of Object.keys(PAIRS)) {
        for (const [bL, bR, S] of [[300, 500, 610], [0, 100, 2000], [0, 0, 50], [1200, 800, 1000]]) {
          const exact = exactMax(level, job, pair, bL, bR, S);
          let previous = Infinity;
          for (const m of [1, 2, 4, 8, 16]) {
            const u = boundU(level, job, pair, bL, bR, S, m);
            assert(u >= exact, `U${m} 必须是上界 ${pair} L${level} m=${m}: ${u} < ${exact}`);
            assert(u <= previous + 1e-9, `U_m 应随 m 单调收紧 ${pair} L${level} m=${m}`);
            previous = u;
            checks += 1;
          }
        }
      }
    }
  }
  ok("B3.bound-validity",
    `${checks} 个 (level,job,pair,bases,S,m) 检查：U_m >= 精确最大值，且 U_1 >= U_2 >= U_4 >= U_8 >= U_16（分块细化单调收紧）；` +
      "U_1 = F_i(hi 处档位)·F_j(lo 处档位) 为独立极值上界，m 充分大时退化为精确枚举");
  const tightExamples = [
    [70, "WHM", "CRT-DHT", 300, 500, 610],
    [70, "WHM", "CRT-DHT", 375, 379, 610], // 评论 01 的贡献坐标切片（面板 739/743 − sub=364）
    [70, "WHM", "DHT-DET", 0, 100, 2000],
    [50, "WHM", "DHT-DET", 100, 100, 1000],
  ];
  for (const [level, job, pair, bL, bR, S] of tightExamples) {
    const exact = exactMax(level, job, pair, bL, bR, S);
    const parts = [`exact=${exact}`];
    for (const m of [1, 2, 4, 8, 16]) {
      const u = boundU(level, job, pair, bL, bR, S, m);
      parts.push(`U${m}=${u}(${Math.floor(((u - exact) * 10000) / exact)}bp)`);
    }
    ok(`B3.tightness.${pair}.L${level}`, `${pair} L${level} bases=(${bL},${bR}) S=${S}：${parts.join(" ")}`);
    assert(boundU(level, job, pair, bL, bR, S, 1) > exact, "U1 应严格大于精确最大值（不是精确算法）");
  }
}

// ===========================================================================
// §9 关键集不可再小的证据（argmax 覆盖）
// ===========================================================================
{
  const coverage = {};
  for (const [level, pair] of [[70, "CRT-DHT"], [70, "CRT-DET"], [50, "DHT-DET"], [100, "CRT-DHT"]]) {
    const [statL] = PAIRS[pair];
    const period = tierPeriod(level, "WHM", statL).period;
    // 跳变“步”残类 J = {g : t(g+1) > t(g)}；关键点“位置”残类 = J+1（因为关键点是 t(x) > t(x-1)）。
    const jumpStepResidues = new Set();
    for (let g = 0; g < period; g += 1) {
      if (tier(level, "WHM", statL, g + 1) > tier(level, "WHM", statL, g)) jumpStepResidues.add(g);
    }
    const jumpPositionResidues = new Set([...jumpStepResidues].map((r) => (r + 1) % period));
    const argmaxResidues = new Set();
    let argmaxCount = 0;
    let interiorCount = 0;
    for (const bL of REALISTIC_BASES) {
      for (const bR of REALISTIC_BASES) {
        for (const S of REALISTIC_S) {
          let best = -1;
          let bestX = 0;
          for (let x = 0; x <= S; x += 1) {
            const value = productNumber(level, "WHM", pair, bL, bR, S, x);
            if (value > best) { best = value; bestX = x; }
          }
          argmaxCount += 1;
          if (bestX > 0 && bestX < S && leftJump(level, "WHM", pair, bL, bestX)) {
            interiorCount += 1;
            argmaxResidues.add(((bL + bestX) % period + period) % period);
          }
        }
      }
    }
    const covered = [...jumpPositionResidues].every((r) => argmaxResidues.has(r));
    assert(covered,
      `内部 argmax 应覆盖全部关键点位置残类 ${pair} L${level}：位置残类 {${[...jumpPositionResidues]}} vs argmax {${[...argmaxResidues]}}`);
    coverage[`${pair}|${level}`] = {
      period,
      jumpPositionResidues: [...jumpPositionResidues],
      argmaxResidues: [...argmaxResidues],
      argmaxCount,
      interiorCount,
    };
  }
  ok("B4.argmax-evidence",
    "实际尺度网格上，内部 argmax 的关键点贡献残类覆盖情况：" +
      Object.entries(coverage).map(([key, c]) =>
        `${key}（P=${c.period}，关键点位置残类 {${c.jumpPositionResidues.join(",")}}，内部 argmax 覆盖 {${[...c.argmaxResidues].sort((a, b) => a - b).join(",")}}，` +
        `${c.interiorCount}/${c.argmaxCount} 个切片 argmax 在内部关键点）`).join("；") +
      "。四个抽样均覆盖全部关键点位置残类：这不是不可能性证明，但说明按残类/端点进一步降维会漏解（见 README §7、§12）");
}

// ===========================================================================
// §10 与 canonical evaluator 的逐点对照
// ===========================================================================
{
  const data = await loadGameData();
  const canonical = await loadCanonicalEvaluator();
  const jobs = Object.keys(data.jobSchemas);
  const sampleContributions = [0, 1, 7, 100, 500, 1234, 2000, 3000];
  let tierChecks = 0;
  let factorChecks = 0;
  for (const level of LEVELS) {
    for (const job of jobs) {
      if (data.jobSchemas[job].maxJobLevel < level) continue;
      for (const stat of ["CRT", "DHT", "DET"]) {
        for (const g of sampleContributions) {
          const model = tier(level, job, stat, g);
          const actual = canonical.equippedAttributeTier(job, level, stat, g);
          assert(model === actual, `canonical tier 不一致 ${job}/${level}/${stat}/${g}: ${model} vs ${actual}`);
          tierChecks += 1;
        }
      }
      const evaluator = canonical.createIntegerDamageFactorEvaluator(
        job, level, new Map([["CRT", 0], ["DHT", 1], ["DET", 2]]));
      for (const [crt, dht, det] of [[0, 0, 0], [37, 41, 23], [200, 333, 450], [511, 900, 1200], [1000, 1800, 2400]]) {
        const factors = evaluator([crt, dht, det]);
        assert(factors !== undefined, `canonical 因子求值失败 ${job}/${level}`);
        assert(factors.critical === criticalFactor(tier(level, job, "CRT", crt), job), "canonical critical 不一致");
        assert(factors.directHit === directHitFactor(tier(level, job, "DHT", dht)), "canonical directHit 不一致");
        assert(factors.determination === determinationFactor(tier(level, job, "DET", det)), "canonical determination 不一致");
        factorChecks += 1;
      }
    }
  }
  const negative = { job: "WHM", level: 70, stat: "CRT", g: -450 };
  assert(
    canonical.equippedAttributeTier(negative.job, negative.level, negative.stat, negative.g) !==
      tier(negative.level, negative.job, negative.stat, negative.g),
    "负贡献截断语义反例应成立（定义域限制 g>=0 的理由）");
  ok("canonical-correspondence",
    `${tierChecks} 个 (job,level,stat,g) 档位点与 ${factorChecks} 个 (job,level,CRT,DHT,DET) 因子点与生产 canonical evaluator 逐点一致；` +
      `g=-450 处 canonical 与精确 floor 不等价，故所有定理定义域限制为 g>=0`);
}

// ===========================================================================
// §11 baseStat 坐标审计：贡献坐标 vs 面板总值
// 结论：本脚本所有 b_i,b_j,S,lo,hi 都是**贡献** g 坐标；面板值必须减去
//       baseStats（CRT/DHT/TEN: sub；DET: main）后才可代入档位公式。
// ===========================================================================
{
  const data = await loadGameData();
  const canonical = await loadCanonicalEvaluator();
  const levelParams = data.jobLevelModifiers;
  // (a) 归约链的结构性事实：baseStats 映射到 sub/main。
  assert(data.baseStats.CRT === "sub" && data.baseStats.DHT === "sub" && data.baseStats.DET === "main",
    "生成数据 baseStats 映射应为 CRT/DHT->sub、DET->main");
  let levelsChecked = 0;
  for (const level of LEVELS) {
    const { sub, main } = levelParams[level];
    assert(sub !== main, `L${level} sub 与 main 不应相等（DET 平移与 CRT/DHT 不同）`);
    for (const [stat, expectedBase] of [["CRT", sub], ["DHT", sub], ["DET", main]]) {
      // 贡献 0 时模型档位 == canonical 在 g=0 的档位（canonical 内部加 baseStats 再减偏移）。
      assert(tier(level, "WHM", stat, 0) === canonical.equippedAttributeTier("WHM", level, stat, 0),
        `L${level}/${stat} 贡献 0 档位应与 canonical 一致`);
      // 面板 = 贡献 + base；base 本身是正数（因此“面板 0”不可达，0 基线只能是贡献坐标）。
      assert(expectedBase > 0, `L${level}/${stat} base 应为正`);
      // DET 的平移量是 main、CRT/DHT 是 sub：把面板换算成贡献时三者不同（本审计关键点）。
      assert((stat === "DET") === (expectedBase === main), `L${level}/${stat} 的 base 映射不符`);
    }
    levelsChecked += 1;
  }
  // (b) 参考模型 §2.1 的显式换算：70 级评论 01 面板 739/743/769 -> 贡献 375/379/477 -> 档位 133/231/1074。
  const l70 = levelParams[70];
  const panel = { CRT: 739, DHT: 743, DET: 769 };
  const contribution = {
    CRT: panel.CRT - l70.sub,
    DHT: panel.DHT - l70.sub,
    DET: panel.DET - l70.main,
  };
  assert(contribution.CRT === 375 && contribution.DHT === 379 && contribution.DET === 477,
    "70 级面板 739/743/769 应换算为贡献 375/379/477");
  assert(tier(70, "WHM", "CRT", contribution.CRT) === 133 &&
    tier(70, "WHM", "DHT", contribution.DHT) === 231 &&
    tier(70, "WHM", "DET", contribution.DET) === 1074,
  "70 级贡献 375/379/477 的档位应为 133/231/1074（与参考模型 §2.1 一致）");
  // (c) 反例：把面板值直接当贡献会得到不同档位（本审计修正的正是这类误用）。
  assert(tier(70, "WHM", "CRT", panel.CRT) !== 133 &&
    tier(70, "WHM", "DHT", panel.DHT) !== 231 &&
    tier(70, "WHM", "DET", panel.DET) !== 1074,
  "把面板值直接当贡献应得到不同档位（坐标误用反例）");
  // (d) 本文/姊妹文档所有示例的 baseline 都是贡献坐标；列出面板等价（贡献 + base）供复核。
  const exampleBaselines = [
    { tag: "R1 CRT-DHT L60 BLU", level: 60, bases: { CRT: 0, DHT: 0 } },
    { tag: "R2 CRT-DET L70 WHM", level: 70, bases: { CRT: 800, DET: 500 } },
    { tag: "R3 DHT-DET L70 WHM", level: 70, bases: { DHT: 0, DET: 100 } },
    { tag: "R4 L50 WHM", level: 50, bases: { CRT: 0, DHT: 0, DET: 0 } },
    { tag: "L70 (300,500) CRT-DHT", level: 70, bases: { CRT: 300, DHT: 500 } },
    { tag: "comment-01 贡献切片", level: 70, bases: { CRT: 375, DHT: 379, DET: 477 } },
    { tag: "L50 DHT-DET (100,100)", level: 50, bases: { DHT: 100, DET: 100 } },
  ];
  const panelEquivalents = [];
  for (const example of exampleBaselines) {
    const params = levelParams[example.level];
    const parts = [];
    for (const [stat, contributionValue] of Object.entries(example.bases)) {
      assert(contributionValue >= 0, `${example.tag}: 贡献 baseline 必须非负`);
      const base = stat === "DET" ? params.main : params.sub;
      parts.push(`${stat}=${contributionValue}（面板 ${contributionValue + base}）`);
    }
    panelEquivalents.push(`${example.tag}: ${parts.join("，")}`);
    // b=0 只可能是贡献坐标：面板等价为 base > 0。
    if (Object.values(example.bases).every((v) => v === 0)) {
      assert(params.sub > 0 && params.main > 0, `${example.tag}: 面板等价必须为正`);
    }
  }
  ok("baseStat-coordinate-audit",
    `${levelsChecked} 个等级归约核对：CRT/DHT base=sub、DET base=main（且 sub≠main）；` +
      "70 级面板 739/743/769 -> 贡献 375/379/477 -> 档位 133/231/1074（与参考模型 §2.1 一致）；" +
      "把面板值直接当贡献会得到不同档位（审计修正的误用模式）。示例 baseline 的贡献/面板等价：" +
      panelEquivalents.join("；"));
}

// ===========================================================================
// 输出
// ===========================================================================
console.log("pairwise-endpoint-max / pairwise-slice-critical-set verification: PASS");
for (const line of report) console.log(line);
console.log("scope: 有限域证书（反例本身即否证；其余为代数证明的有限数值旁证）。");
console.log("这不是一般性证明；一般性证明见两个定理 README 的 §6。");
