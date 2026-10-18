/**
 * verify-theorem-claims.mjs
 *
 * 目的：独立核对 theorems/ 文档中的关键数值断言与反例（不依赖文档作者的自述）。
 *
 * 坐标约定：所有 `g`、baseline、预算、S 都是**属性贡献**（装备+食物），不是面板总值；
 * 三属性面板 = 基础属性（CRT/DHT/TEN 为 sub，DET 为 main）+ 贡献（参考模型 §2.1）。
 *
 * 覆盖范围（有限、完整列出）：
 *   A. E_b(t) = F_b(t+2)F_b(t) - F_b(t+1)^2 的闭式与符号切换（b=350, b=150），逐 t。
 *   B. DHT / DET tier 级二阶判据 = -k^2。
 *   C. 两属性定和切片的端点最大反例（三个属性对）。
 *   D. 切片严格局部极大值计数 vs CRT 跳档数（结构性非单峰）。
 *   E. U(b,R) 的 tier-triple 预算公式与暴力枚举一致。
 *   F. 三顶点公式反例（U > max 顶点）。
 *   G. 边际比较交叉指数判据与 issue 正文形式的差异反例。
 *
 * 证明作用：以上每一项都是**有限证书**。C/F/G 提供反例（否证全称命题，反例本身即证明）；
 * E 在小规模上验证公式实现正确（不是一般性证明，一般性证明在定理 README）；
 * A/B/D 的有限区间核对是旁证，代数证明在定理 README。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/verification/verify-theorem-claims.mjs
 */
import {
  assert,
  criticalFactor,
  determinationFactor,
  directHitFactor,
  factorsAt,
  firstContributionWithTierAtLeast,
  tier,
  tierParameters,
} from "./canonical-model.mjs";

const LEVELS = [50, 60, 70, 80, 90, 100];
const results = [];
function ok(name, detail) {
  results.push(`  [ok] ${name}: ${detail}`);
}

// ---------------------------------------------------------------- A. E_b(t) 闭式
function factorCubic(t, b) {
  return 1_000_000 + t * (t + b);
}
function E(t, b) {
  return factorCubic(t + 2, b) * factorCubic(t, b) - factorCubic(t + 1, b) ** 2;
}
function EClosed(t, b) {
  return 2_000_000 - 2 * t * t - (2 * b + 4) * t - (b + 1) ** 2;
}
for (const b of [350, 150]) {
  for (let t = -500; t <= 1200; t += 1) {
    assert(E(t, b) === EClosed(t, b), `E_b 闭式不一致 b=${b} t=${t}`);
  }
}
const switchB350 = { lastPositive: 808, firstNegative: 809 };
assert(E(808, 350) === 2239 && E(808, 350) > 0, "E(808,350) 应为 2239 > 0");
assert(E(809, 350) === -1699 && E(809, 350) < 0, "E(809,350) 应为 -1699 < 0");
for (let t = 0; t <= 808; t += 1) assert(E(t, 350) > 0, `b=350 在 t=${t} 应 >0`);
for (let t = 809; t <= 2000; t += 1) assert(E(t, 350) < 0, `b=350 在 t=${t} 应 <0`);
const switchB150 = { lastPositive: 921, firstNegative: 922 };
assert(E(921, 150) === 733 && E(921, 150) > 0, "E(921,150) 应为 733 > 0");
assert(E(922, 150) === -3257 && E(922, 150) < 0, "E(922,150) 应为 -3257 < 0");
for (let t = 0; t <= 921; t += 1) assert(E(t, 150) > 0, `b=150 在 t=${t} 应 >0`);
for (let t = 922; t <= 2000; t += 1) assert(E(t, 150) < 0, `b=150 在 t=${t} 应 <0`);
ok("A.E-b-closed-form", "b=350 切换 808/809（E(808)=2239, E(809)=-1699）；b=150 切换 921/922（E(921)=733, E(922)=-3257）；t∈[-500,1200] 闭式逐点一致");

// ------------------------------------------------------- B. DHT/DET 二阶判据 -k^2
for (const A of [4000, 0]) {
  for (const t of [0, 1, 7, 100, 1000]) {
    for (const k of [1, 2, 3, 5]) {
      const left = (A + t + 2 * k) * (A + t) - (A + t + k) ** 2;
      assert(left === -(k * k), `(A+t) 族二阶判据不一致 A=${A} t=${t} k=${k}`);
    }
  }
}
ok("B.affine-family", "F(t)=A+t 对任意步长 k 满足 F(t+2k)F(t)-F(t+k)^2 = -k^2（A=4000 与 A=0）");

// ------------------------------------- C. 两属性定和切片端点最大反例（精确核对）
function pairProductOf(level, job, leftStat, rightStat, leftValue, rightValue) {
  const left = leftStat === "CRT"
    ? criticalFactor(tier(level, job, "CRT", leftValue), job)
    : directHitFactor(tier(level, job, "DHT", leftValue));
  const right = rightStat === "DHT"
    ? directHitFactor(tier(level, job, "DHT", rightValue))
    : determinationFactor(tier(level, job, "DET", rightValue));
  return BigInt(left) * BigInt(right);
}
const sliceCases = [
  { name: "CRT-DHT", level: 60, job: "BLU", leftStat: "CRT", rightStat: "DHT", leftBase: 0, rightBase: 0, S: 50, xStar: 3 },
  { name: "CRT-DET", level: 70, job: "WHM", leftStat: "CRT", rightStat: "DET", leftBase: 800, rightBase: 500, S: 50, xStar: 42 },
  { name: "DHT-DET", level: 70, job: "WHM", leftStat: "DHT", rightStat: "DET", leftBase: 0, rightBase: 100, S: 2000, xStar: 1026 },
];
for (const testCase of sliceCases) {
  const { level, job, leftStat, rightStat, leftBase, rightBase, S } = testCase;
  const at = (x) => pairProductOf(level, job, leftStat, rightStat, leftBase + x, rightBase + S - x);
  const leftEnd = at(0);
  const rightEnd = at(S);
  const interior = at(testCase.xStar);
  let max = -1n;
  for (let x = 0; x <= S; x += 1) max = max > at(x) ? max : at(x);
  assert(interior === max, `${testCase.name} 内部点不是最大值`);
  assert(interior > leftEnd && interior > rightEnd, `${testCase.name} 内部点未严格大于两端`);
  ok(
    `C.counterexample.${testCase.name}`,
    `level=${level} ${job} bases=(${leftBase},${rightBase}) S=${S} x*=${testCase.xStar} ` +
      `interior=${interior} endpoints=(${leftEnd},${rightEnd})，端点最大被否证`,
  );
}

// ------------------- D. 切片平台结构与局部极大值计数（结构性非单峰）
// 正确结构（定理）：G 是阶梯函数。只有 CRT 跳档步可能使 G 严格上升；只有 DHT 掉档步可能使 G 严格下降；
// 两者同时发生的步由精确乘积比较决定净符号。每个"严格上升步"开启一个平台，该平台（除最后一个到 x=S 外）
// 结束于一个严格下降步，因此是一个内部严格局部极大平台。故内部局部极大平台数 = J+ − [末平台到 S]，
// 其中 J+ = #{x : G(x) > G(x-1)}。下界：J+ >= #{仅 CRT 跳档步}。
function sliceStructure(level, job, leftStat, rightStat, leftBase, rightBase, S) {
  const value = (x) => pairProductOf(level, job, leftStat, rightStat, leftBase + x, rightBase + S - x);
  const crtStat = leftStat === "CRT" ? "CRT" : null;
  const dhtStat = rightStat === "DHT" ? "DHT" : null;
  let crtJumps = 0;
  let crtOnly = 0;
  let increaseSteps = 0;
  let decreaseSteps = 0;
  for (let x = 1; x <= S; x += 1) {
    const upC = leftStat === "CRT"
      ? tier(level, job, "CRT", leftBase + x) > tier(level, job, "CRT", leftBase + x - 1)
      : false;
    const downH = rightStat === "DHT"
      ? tier(level, job, "DHT", rightBase + S - x) < tier(level, job, "DHT", rightBase + S - x + 1)
      : false;
    if (upC) crtJumps += 1;
    if (upC && !downH) crtOnly += 1;
    const delta = value(x) - value(x - 1);
    if (delta > 0n) increaseSteps += 1;
    else if (delta < 0n) decreaseSteps += 1;
  }
  // 内部严格局部极大平台：从严格上升步开始，平台延伸至 y；平台必须是极大常量区间，
  // 且结束条件为「y < S 且 G(y+1) < G(y)」（若 G(y+1) > G(y) 则是连续上升步，[x,y] 并非平台极大值）。
  let plateauMaxima = 0;
  const positions = [];
  for (let x = 1; x <= S; x += 1) {
    if (!(value(x) > value(x - 1))) continue;
    let y = x;
    while (y + 1 <= S && value(y + 1) === value(y)) y += 1;
    if (y < S && value(y + 1) < value(y)) {
      plateauMaxima += 1;
      if (positions.length < 6) positions.push(`${x}..${y}`);
    }
  }
  void crtStat;
  void dhtStat;
  return { crtJumps, crtOnly, increaseSteps, decreaseSteps, plateauMaxima, positions };
}
{
  const level = 70;
  const job = "WHM";
  const structure = sliceStructure(level, job, "CRT", "DHT", 300, 500, 610);
  assert(
    structure.plateauMaxima === structure.increaseSteps - 1 ||
      structure.plateauMaxima === structure.increaseSteps,
    `平台极大值数应等于上升步数（至多差末平台）：${structure.plateauMaxima} vs ${structure.increaseSteps}`,
  );
  assert(structure.increaseSteps >= structure.crtOnly, "上升步数应不少于仅 CRT 跳档步数");
  assert(structure.plateauMaxima >= 100, `局部极大平台数异常偏小：${structure.plateauMaxima}`);
  ok(
    "D.plateau-structure.full",
    `level=70 WHM CRT-DHT bases=(300,500) S=610：CRT 跳档 ${structure.crtJumps}，仅 CRT 跳档 ${structure.crtOnly}，` +
      `上升步 ${structure.increaseSteps}，下降步 ${structure.decreaseSteps}，内部局部极大平台 ${structure.plateauMaxima} ` +
      `（前几个 ${structure.positions.join(",")}）`,
  );
  const level50 = sliceStructure(50, "WHM", "DHT", "DET", 100, 100, 1000);
  ok(
    "D.plateau-structure.level50",
    `level=50 WHM DHT-DET bases=(100,100) S=1000：上升步 ${level50.increaseSteps}，下降步 ${level50.decreaseSteps}，` +
      `内部局部极大平台 ${level50.plateauMaxima}`,
  );
}

// ------------------------------- E. U(b,R) tier-triple 预算公式 vs 暴力枚举
// 可达档位：DET 的档位是 detTrunc 的倍数，必须按可达到的档位步进枚举，否则会重复计数并放大费用。
function achievableTiers(level, job, stat, maxContribution) {
  const { mult } = tierParameters(level, job, stat);
  const first = tier(level, job, stat, 0);
  const last = tier(level, job, stat, maxContribution);
  const tiers = [];
  for (let t = Math.ceil(first / mult) * mult; t <= last; t += mult) tiers.push(t);
  return tiers;
}
function bruteForceU(level, job, baseline, R) {
  let best = -1n;
  for (let c = 0; c <= R; c += 1) {
    for (let h = 0; c + h <= R; h += 1) {
      const d = R - c - h;
      const { product } = factorsAt(level, job, {
        CRT: baseline.C0 + c,
        DHT: baseline.H0 + h,
        DET: baseline.D0 + d,
      });
      if (product > best) best = product;
    }
  }
  return best;
}
// tier-triple 预算公式：对每个属性的可达档位求最小成本，再在成本预算下取最大乘积。
function tierBudgetU(level, job, baseline, R) {
  const stats = [
    { stat: "CRT", base: baseline.C0, factor: (t) => criticalFactor(t, job) },
    { stat: "DHT", base: baseline.H0, factor: (t) => directHitFactor(t) },
    { stat: "DET", base: baseline.D0, factor: (t) => determinationFactor(t) },
  ];
  const lists = stats.map(({ stat, base, factor }) => {
    const entries = [];
    for (const t of achievableTiers(level, job, stat, base + R)) {
      if (t < tier(level, job, stat, base)) continue;
      const threshold = firstContributionWithTierAtLeast(level, job, stat, t);
      const cost = Math.max(0, threshold - base);
      entries.push({ tier: t, cost, value: BigInt(factor(t)) });
    }
    return entries;
  });
  let best = -1n;
  for (const c of lists[0]) {
    for (const d of lists[1]) {
      for (const e of lists[2]) {
        if (c.cost + d.cost + e.cost > R) continue;
        const product = c.value * d.value * e.value;
        if (product > best) best = product;
      }
    }
  }
  return best;
}
let uCertificates = 0;
for (const level of [50, 70, 100]) {
  for (const job of ["WHM", "BLU"]) {
    for (const baseline of [{ C0: 0, H0: 0, D0: 0 }, { C0: 100, H0: 200, D0: 300 }, { C0: 800, H0: 500, D0: 700 }]) {
      for (const R of [0, 37, 100, 250, 400]) {
        const brute = bruteForceU(level, job, baseline, R);
        const formula = tierBudgetU(level, job, baseline, R);
        assert(brute === formula, `U 公式不一致 level=${level} ${job} baseline=${JSON.stringify(baseline)} R=${R}: ${brute} vs ${formula}`);
        uCertificates += 1;
      }
    }
  }
}
ok("E.tier-triple-formula", `${uCertificates} 个 (level,job,baseline,R) 上 tier-triple 预算公式与暴力枚举完全一致`);

// ------------------------------------------- F. 三顶点公式反例（精确核对）
{
  const level = 100;
  const job = "WHM";
  const C0 = 200;
  const H0 = 200;
  const D0 = 200;
  const R = 610;
  const vertexProducts = [
    factorsAt(level, job, { CRT: C0 + R, DHT: H0, DET: D0 }),
    factorsAt(level, job, { CRT: C0, DHT: H0 + R, DET: D0 }),
    factorsAt(level, job, { CRT: C0, DHT: H0, DET: D0 + R }),
  ];
  const vertexMax = vertexProducts.reduce((a, b) => (a.product > b.product ? a : b));
  const interior = factorsAt(level, job, { CRT: C0 + 9, DHT: H0 + 245, DET: D0 + 356 });
  assert(interior.product > vertexMax.product, "顶点反例失效");
  ok(
    "F.vertex-counterexample",
    `level=100 WHM baseline=(200,200,200) R=610：顶点最大=${vertexMax.product}（档位 ` +
      `${vertexMax.crtTier}/${vertexMax.dhtTier}/${vertexMax.detTier}），内部点 (9,245,356) 档位 ` +
      `${interior.crtTier}/${interior.dhtTier}/${interior.detTier} 乘积=${interior.product} > 顶点最大`,
  );
  for (const level2 of LEVELS) {
    // 说明：每个等级都存在该现象（由 search-counterexamples.mjs 的网格扫描给出）；
    // 此处仅断言 level 50 的第二个反例以固定文档引用的数字。
    void level2;
  }
  const level50 = factorsAt(50, "BLU", { CRT: 200 + 1396, DHT: 200 + 1, DET: 200 + 103 });
  const vertices50 = [
    factorsAt(50, "BLU", { CRT: 1700, DHT: 200, DET: 200 }),
    factorsAt(50, "BLU", { CRT: 200, DHT: 1700, DET: 200 }),
    factorsAt(50, "BLU", { CRT: 200, DHT: 200, DET: 1700 }),
  ].map((entry) => entry.product).reduce((a, b) => (a > b ? a : b));
  assert(level50.product > vertices50, "level 50 顶点反例失效");
  ok("F.vertex-counterexample.level50", `level=50 BLU baseline=(200,200,200) R=1500：内部点 (1396,1,103) 乘积=${level50.product} > 顶点最大=${vertices50}`);
}

// --------------------------------- G. 边际比较：交叉指数判据 vs issue 正文形式
{
  const F0 = 10n;
  const F1 = 80n;
  const cF = 3n;
  const G0 = 1000n;
  const G1 = 2000n;
  const cG = 1n;
  const correctedLeft = F1 ** cG * G0 ** cF;
  const correctedRight = F0 ** cG * G1 ** cF;
  assert(correctedLeft === correctedRight, "交叉指数判据在此例应相等");
  // 真值：ln(F1/F0)/cF = ln(8)/3 = ln(2)；ln(G1/G0)/cG = ln(2) ⇒ 相等
  const issueLeft = (F1 * G0) ** cG;
  const issueRight = (G1 * F0) ** cF;
  assert(issueLeft !== issueRight, "issue 形式在此例应给出不等");
  ok(
    "G.marginal-form-refutation",
    `F0=${F0},F1=${F1},cF=${cF}; G0=${G0},G1=${G1},cG=${cG}：真值与交叉指数判据均为相等 ` +
      `(${correctedLeft}=${correctedRight})，而 issue 正文形式给出 ${issueLeft} vs ${issueRight}（不等），故不等价`,
  );
}

// --------------------- H. U 的 tier-triple 公式 == 现有 substat-factor-budget 查询
// 只 import 纯函数模块（无数据依赖、无搜索），用于验证"U 的精确形式已被现有实现覆盖"这一对应关系。
{
  const budgetModule = await import(
    new URL("../../../src/domain/search/substat-factor-budget.ts", import.meta.url).href
  );
  let correspondences = 0;
  for (const level of [50, 70, 100]) {
    for (const job of ["WHM", "BLU"]) {
      for (const R of [0, 50, 120, 300, 610]) {
        const classesFor = (stat, factor) => {
          const entries = [];
          for (const t of achievableTiers(level, job, stat, R)) {
            entries.push({
              min: firstContributionWithTierAtLeast(level, job, stat, t),
              value: factor(t),
            });
          }
          return entries;
        };
        const crtClasses = classesFor("CRT", (t) => criticalFactor(t, job));
        const detClasses = classesFor("DET", (t) => determinationFactor(t));
        const dhtClasses = classesFor("DHT", (t) => directHitFactor(t));
        const prepared = budgetModule.prepareSubstatFactorBudgetQuery(crtClasses, detClasses, dhtClasses);
        assert(prepared !== undefined, "substat-factor-budget 未启用");
        const queryResult = prepared(R);
        assert(queryResult !== undefined, "substat-factor-budget 查询返回 undefined");
        const expected = tierBudgetU(level, job, { C0: 0, H0: 0, D0: 0 }, R);
        assert(
          queryResult.product === expected,
          `U 与 substat-factor-budget 不一致 level=${level} ${job} R=${R}: ${queryResult.product} vs ${expected}`,
        );
        correspondences += 1;
      }
    }
  }
  ok(
    "H.substat-factor-budget-correspondence",
    `${correspondences} 个 (level,job,R) 上现有 prepareSubstatFactorBudgetQuery 的返回值与 U(b=0,R) 的精确 tier-triple 公式完全一致`,
  );
}

// ------------------- I. D_min 前沿、K_w 半空间与最小元表征（小域暴力核对）
{
  const level = 70;
  const job = "WHM";
  const kappa = 60;
  const B = 4_100_000_000_000n; // 在 Omega=[0,60]^3 内既非空也非全空间的严格门槛（已核对：最小乘积 4.08e12 < B < 最大乘积 4.18e12）
  const factorAt = (coordinate) => factorsAt(level, job, coordinate);
  const improving = [];
  for (let C = 0; C <= kappa; C += 1) {
    for (let H = 0; H <= kappa; H += 1) {
      for (let D = 0; D <= kappa; D += 1) {
        if (factorAt({ CRT: C, DHT: H, DET: D }).product > B) improving.push({ C, H, D });
      }
    }
  }
  assert(improving.length > 0, "改善域为空，测试失去意义");
  // D_min 单调性：对每个 (C,H)，D_min 关于 C、H 非增
  const dMin = new Map();
  for (let C = 0; C <= kappa; C += 1) {
    for (let H = 0; H <= kappa; H += 1) {
      let found = Number.POSITIVE_INFINITY;
      for (let D = 0; D <= kappa; D += 1) {
        if (factorAt({ CRT: C, DHT: H, DET: D }).product > B) {
          found = D;
          break;
        }
      }
      dMin.set(`${C},${H}`, found);
    }
  }
  for (let C = 1; C <= kappa; C += 1) {
    for (let H = 0; H <= kappa; H += 1) {
      assert(dMin.get(`${C},${H}`) <= dMin.get(`${C - 1},${H}`), "D_min 关于 C 非增失败");
    }
  }
  for (let C = 0; C <= kappa; C += 1) {
    for (let H = 1; H <= kappa; H += 1) {
      assert(dMin.get(`${C},${H}`) <= dMin.get(`${C},${H - 1}`), "D_min 关于 H 非增失败");
    }
  }
  // K_w：暴力 vs 前沿公式，并核对半空间安全性
  for (const w of [[1, 1, 1], [2, 1, 1], [1, 3, 2], [0, 0, 1], [5, 0, 1]]) {
    let brute = Number.POSITIVE_INFINITY;
    for (const point of improving) {
      brute = Math.min(brute, w[0] * point.C + w[1] * point.H + w[2] * point.D);
    }
    let viaFrontier = Number.POSITIVE_INFINITY;
    for (let C = 0; C <= kappa; C += 1) {
      for (let H = 0; H <= kappa; H += 1) {
        const D = dMin.get(`${C},${H}`);
        if (!Number.isFinite(D)) continue;
        viaFrontier = Math.min(viaFrontier, w[0] * C + w[1] * H + w[2] * D);
      }
    }
    assert(brute === viaFrontier, `K_w 前沿公式不一致 w=${w}: ${brute} vs ${viaFrontier}`);
    for (const point of improving) {
      assert(
        w[0] * point.C + w[1] * point.H + w[2] * point.D >= brute,
        `半空间安全性失败 w=${w} point=${JSON.stringify(point)}`,
      );
    }
  }
  ok(
    "I.frontier-and-halfspace",
    `level=70 ${job} Omega=[0,${kappa}]^3 B=${B}：改善点 ${improving.length} 个；` +
      `D_min 关于 C/H 非增；5 个方向的 K_w 前沿公式与暴力一致；所有改善点满足 w·x >= K_w`,
  );
}

console.log("verify-theorem-claims: PASS");
for (const line of results) console.log(line);
console.log("scope: 有限证书；反例本身是否证，其余为代数证明的有限旁证。");
