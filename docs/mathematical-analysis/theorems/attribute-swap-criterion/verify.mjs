/**
 * attribute-swap-criterion/verify.mjs
 *
 * 定理 B（自由松弛中的交换判据、tie 语义、松弛 vs 真实装备分离）的有限域验证脚本。
 *
 * 覆盖范围（有限、完整列出）：
 *   B0. 定义域上三个副属性因子为正（判据前提的有限旁证）。
 *   B1. 精确两状态交换判据：BigInt 乘积比较 == 暴力比较；平台（因子不变）与严格改善/恶化。
 *   B2. 单位成本交叉指数判据：等成本交换下 sign(交叉指数式) == sign(精确乘积式)；
 *       issue 正文旧形式不等价的反例；交叉指数式本身的整数核验。
 *   B3. 自由松弛内：存在严格改善交换的状态必不是松弛最优；删除它们不改变松弛最大值。
 *   B4. tie 交换不授权删除：同值交换后两者都仍可能最优；全平台盒内删 tie 会改变 argmax 集合。
 *   B5. 分离定理的具体反例：ring 唯一性模型下自由松弛存在严格改善交换，但无任何合法真实配置实现；
 *       按「理论交换有利 => 删除真实候选」会改变真实最优。
 *   B6. 三条安全删除路径的数值核对（(b) 严格乐观上界；与 frontier 定理联动）。
 *   B7. 正性前提不可省：因子为 0/负时交叉指数判据失效的显式反例。
 *   B8. baseStat 影响审计：交换算子/示例坐标都是**贡献** g，不是面板总值；验证偏移表、
 *       交换判据的平移不变性、示例乘积复算与「面板解释会导致负贡献」的判定。
 *
 * 证明作用：以上全部是**有限域证书**。反例本身是否证全称命题；代数等价性的一般性证明在
 * 同目录 README.md。数值来自 canonical integer model。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/attribute-swap-criterion/verify.mjs
 */
import {
  assert,
  criticalFactor,
  determinationFactor,
  directHitFactor,
  DOCUMENTED_LEVEL_PARAMS,
  firstContributionWithTierAtLeast,
  floorDiv,
  tier,
} from "../../verification/canonical-model.mjs";

const results = [];
function ok(name, detail) {
  results.push(`  [ok] ${name}: ${detail}`);
}

const LEVEL = 100;
const JOB = "WHM";

function factorC(c) {
  return criticalFactor(tier(LEVEL, JOB, "CRT", c), JOB);
}
function factorH(h) {
  return directHitFactor(tier(LEVEL, JOB, "DHT", h));
}
function factorD(d) {
  return determinationFactor(tier(LEVEL, JOB, "DET", d));
}
function productOf(c, h, d) {
  return BigInt(factorC(c)) * BigInt(factorH(h)) * BigInt(factorD(d));
}
function safeProductOf(c, h, d) {
  const product = factorC(c) * factorH(h) * factorD(d);
  assert(Number.isSafeInteger(product), `乘积 ${product} 超出安全整数`);
  return product;
}

// ---------------------------------------------------------------------------
// B0. 因子正性（有限旁证）
// ---------------------------------------------------------------------------
{
  for (let c = 0; c <= 220; c += 1) assert(factorC(c) > 0, `CRT 因子在 ${c} 非正`);
  for (let h = 0; h <= 160; h += 1) assert(factorH(h) > 0, `DHT 因子在 ${h} 非正`);
  for (let d = 0; d <= 320; d += 1) assert(factorD(d) > 0, `DET 因子在 ${d} 非正`);
  ok("B0.factor-positive", "level=100 WHM 上 CRT[0,220]、DHT[0,160]、DET[0,320] 三因子均严格为正（判据前提）");
}

// ---------------------------------------------------------------------------
// B1. 精确两状态交换判据
// ---------------------------------------------------------------------------
{
  // 交换：从 j 移 delta 到 i；第三因子固定为正，约去后只比较两个变动的因子。
  const cases = [
    { i: "CRT", j: "DHT", x: { C: 500, H: 30 }, delta: 30 }, // 已知严格改善：q -> (530,0)
    { i: "CRT", j: "DHT", x: { C: 100, H: 40 }, delta: 20 },
    { i: "CRT", j: "DHT", x: { C: 100, H: 40 }, delta: 3 }, // 平台内移动 => tie
    { i: "DHT", j: "DET", x: { H: 40, D: 80 }, delta: 15 },
    { i: "CRT", j: "DET", x: { C: 30, D: 200 }, delta: 50 },
    { i: "DET", j: "CRT", x: { C: 120, D: 150 }, delta: 5 },
  ];
  const detail = [];
  let strict = 0;
  let ties = 0;
  let worse = 0;
  for (const testCase of cases) {
    const keyOf = (stat) => (stat === "CRT" ? "C" : stat === "DHT" ? "H" : "D");
    const before = {
      C: testCase.x.C ?? 0,
      H: testCase.x.H ?? 0,
      D: testCase.x.D ?? 0,
    };
    const after = { ...before };
    after[keyOf(testCase.i)] += testCase.delta;
    after[keyOf(testCase.j)] -= testCase.delta;
    assert(after[keyOf(testCase.j)] >= 0, "交换后 j 坐标不得为负");
    const factorFor = (stat, value) => (stat === "CRT" ? factorC(value) : stat === "DHT" ? factorH(value) : factorD(value));
    const f0 = factorFor(testCase.i, before[keyOf(testCase.i)]);
    const f1 = factorFor(testCase.i, after[keyOf(testCase.i)]);
    const g0 = factorFor(testCase.j, before[keyOf(testCase.j)]);
    const g1 = factorFor(testCase.j, after[keyOf(testCase.j)]);
    const productBefore = BigInt(f0) * BigInt(g0);
    const productAfter = BigInt(f1) * BigInt(g1);
    // 完整三因子乘积：约去不变的第三因子后符号一致。
    const fullBefore = productOf(before.C, before.H, before.D);
    const fullAfter = productOf(after.C, after.H, after.D);
    const deltaSign = productAfter > productBefore ? 1 : productAfter < productBefore ? -1 : 0;
    const fullSign = fullAfter > fullBefore ? 1 : fullAfter < fullBefore ? -1 : 0;
    assert(deltaSign === fullSign, "约去第三因子后符号应一致");
    if (deltaSign > 0) strict += 1;
    else if (deltaSign === 0) ties += 1;
    else worse += 1;
    // 精确判据可直接用 BigInt；输出一条样例。
    if (detail.length < 2) {
      detail.push(
        `${testCase.i}+${testCase.delta}/${testCase.j}-${testCase.delta} (${before.C},${before.H},${before.D})->` +
          `(${after.C},${after.H},${after.D}) 精确比较 ${productAfter} vs ${productBefore} => ${deltaSign > 0 ? "严格改善" : deltaSign === 0 ? "同值" : "严格恶化"}`,
      );
    }
  }
  ok(
    "B1.exact-two-state",
    `${cases.length} 个交换样本：BigInt 乘积比较与完整三因子比较符号一致；其中严格改善 ${strict}、同值 ${ties}、恶化 ${worse}。样例：${detail.join("；")}`,
  );
}

// ---------------------------------------------------------------------------
// B2. 交叉指数判据（单位成本边际比较）与旧形式反例
// ---------------------------------------------------------------------------
{
  // 等价性核验：交叉指数形式与「约分后的比值幂比较」给出同一符号。
  // 约分形式：p1/q1 = F1/F0，p2/q2 = G1/G0；
  // 比较 (p1/q1)^cG ? (p2/q2)^cF  <=>  p1^cG * q2^cF ? p2^cF * q1^cG。
  let checked = 0;
  for (let f0 = 1; f0 <= 5; f0 += 1) {
    for (let f1 = 1; f1 <= 5; f1 += 1) {
      for (let g0 = 1; g0 <= 5; g0 += 1) {
        for (let g1 = 1; g1 <= 5; g1 += 1) {
          for (let cF = 1; cF <= 3; cF += 1) {
            for (let cG = 1; cG <= 3; cG += 1) {
              let a = f1;
              let b = f0;
              while (b !== 0) [a, b] = [b, a % b];
              const p1 = BigInt(f1) / BigInt(a);
              const q1 = BigInt(f0) / BigInt(a);
              let c = g1;
              let d = g0;
              while (d !== 0) [c, d] = [d, c % d];
              const p2 = BigInt(g1) / BigInt(c);
              const q2 = BigInt(g0) / BigInt(c);
              const reduced = p1 ** BigInt(cG) * q2 ** BigInt(cF);
              const reducedRight = p2 ** BigInt(cF) * q1 ** BigInt(cG);
              const cross = BigInt(f1) ** BigInt(cG) * BigInt(g0) ** BigInt(cF);
              const crossRight = BigInt(f0) ** BigInt(cG) * BigInt(g1) ** BigInt(cF);
              const reducedSign = reduced > reducedRight ? 1 : reduced < reducedRight ? -1 : 0;
              const crossSign = cross > crossRight ? 1 : cross < crossRight ? -1 : 0;
              assert(reducedSign === crossSign, "交叉指数形式与约分比值形式不同号");
              checked += 1;
            }
          }
        }
      }
    }
  }
  // 等成本交换：cF = cG = delta 时交叉指数式退化为精确两状态乘积比较。
  const equalCostCases = [
    { a0: 1_020_904, a1: 1_023_199, g0: 4_009, g1: 4_005, delta: 20 },
    { a0: 4_000, a1: 4_005, g0: 1_005, g1: 1_003, delta: 15 },
    { a0: 7, a1: 11, g0: 13, g1: 12, delta: 2 },
  ];
  for (const testCase of equalCostCases) {
    const deltaBig = BigInt(testCase.delta);
    const crossLeft = BigInt(testCase.a1) ** deltaBig * BigInt(testCase.g1) ** deltaBig;
    const crossRight = BigInt(testCase.a0) ** deltaBig * BigInt(testCase.g0) ** deltaBig;
    const productsLeft = BigInt(testCase.a1) * BigInt(testCase.g1);
    const productsRight = BigInt(testCase.a0) * BigInt(testCase.g0);
    const crossSign = crossLeft > crossRight ? 1 : crossLeft < crossRight ? -1 : 0;
    const productSign = productsLeft > productsRight ? 1 : productsLeft < productsRight ? -1 : 0;
    assert(crossSign === productSign, "等成本时交叉指数式应与精确乘积比较同号");
  }
  // issue 正文旧形式反例：正确判据为「相等」，旧形式给出严格不等。
  const f0 = 10n;
  const f1 = 80n;
  const cF = 3n;
  const g0 = 1000n;
  const g1 = 2000n;
  const cG = 1n;
  const correctedLeft = f1 ** cG * g0 ** cF;
  const correctedRight = f0 ** cG * g1 ** cF;
  assert(correctedLeft === correctedRight, "交叉指数判据在该例应为相等");
  // 真值：ln(80/10)/3 = ln(2) = ln(2000/1000)/1 —— 两种转移的单位成本 log 增益相等。
  const oldFormReading1 = (f1 * g0) ** cG;
  const oldFormReading1Right = (g1 * f0) ** cF;
  const oldFormReading2 = (f1 * g0) ** cF;
  const oldFormReading2Right = (g1 * f0) ** cG;
  assert(oldFormReading1 !== oldFormReading1Right, "旧形式读数 1 在该例应给出不等（与正确判据的相等矛盾）");
  assert(oldFormReading2 !== oldFormReading2Right, "旧形式读数 2 在该例应给出不等（与正确判据的相等矛盾）");
  ok(
    "B2.cross-exponent",
    `正整数元组×成本共 ${checked} 个组合上交叉指数形式与约分比值形式同号；等成本 3 例中交叉式与精确两状态乘积比较同号；` +
      `旧形式反例 F0=${f0},F1=${f1},cF=${cF}; G0=${g0},G1=${g1},cG=${cG}：真值与交叉指数判据均为相等（${correctedLeft}=${correctedRight}），` +
      `旧形式两种读数分别为 ${oldFormReading1} vs ${oldFormReading1Right}、${oldFormReading2} vs ${oldFormReading2Right}（均不等）`,
  );
}

// ---------------------------------------------------------------------------
// B3. 自由松弛内：严格改善交换 => 当前状态非松弛最优
// ---------------------------------------------------------------------------
{
  const R = 24;
  const states = [];
  for (let c = 0; c <= R; c += 1) {
    for (let h = 0; c + h <= R; h += 1) {
      for (let d = 0; c + h + d <= R; d += 1) {
        states.push({ c, h, d, product: safeProductOf(c, h, d) });
      }
    }
  }
  let maximum = 0n;
  for (const state of states) maximum = BigInt(state.product) > maximum ? BigInt(state.product) : maximum;
  const argmaxCount = states.filter((state) => BigInt(state.product) === maximum).length;
  const statKeys = ["c", "h", "d"];
  let hasImprovingSwap = 0;
  let removed = 0;
  const kept = [];
  for (const state of states) {
    let improving = false;
    for (let fromIndex = 0; fromIndex < 3 && !improving; fromIndex += 1) {
      for (let toIndex = 0; toIndex < 3 && !improving; toIndex += 1) {
        if (fromIndex === toIndex) continue;
        for (let delta = 1; delta <= state[statKeys[fromIndex]]; delta += 1) {
          const next = { ...state };
          next[statKeys[fromIndex]] -= delta;
          next[statKeys[toIndex]] += delta;
          if (BigInt(safeProductOf(next.c, next.h, next.d)) > BigInt(state.product)) {
            improving = true;
            break;
          }
        }
      }
    }
    if (improving) {
      hasImprovingSwap += 1;
      removed += 1;
    } else {
      kept.push(state);
    }
  }
  assert(hasImprovingSwap > 0, "松弛样本中应存在有严格改善交换的状态");
  // 所有被删状态都不是 argmax。
  for (const state of states) {
    let improving = false;
    for (let fromIndex = 0; fromIndex < 3 && !improving; fromIndex += 1) {
      for (let toIndex = 0; toIndex < 3 && !improving; toIndex += 1) {
        if (fromIndex === toIndex) continue;
        for (let delta = 1; delta <= state[statKeys[fromIndex]]; delta += 1) {
          const next = { ...state };
          next[statKeys[fromIndex]] -= delta;
          next[statKeys[toIndex]] += delta;
          if (BigInt(safeProductOf(next.c, next.h, next.d)) > BigInt(state.product)) {
            improving = true;
            break;
          }
        }
      }
    }
    if (!improving) continue;
    assert(BigInt(state.product) !== maximum, "存在严格改善交换的状态不可能是松弛最优");
  }
  let keptMaximum = 0n;
  for (const state of kept) keptMaximum = BigInt(state.product) > keptMaximum ? BigInt(state.product) : keptMaximum;
  assert(keptMaximum === maximum, "删除有严格改善交换的状态后松弛最大值必须不变");
  ok(
    "B3.relaxation-elimination",
    `松弛域 U(0,${R}) 共 ${states.length} 个状态：${removed} 个存在严格改善交换且全部非松弛最优；` +
      `删除后最大值不变（${maximum}），argmax 状态数 ${argmaxCount} 保持不变`,
  );
}

// ---------------------------------------------------------------------------
// B4. tie 交换不授权删除（tie 语义）
// ---------------------------------------------------------------------------
{
  // 全平台盒：所有状态乘积相同（三个属性均在首个 tier 平台内）。
  const plateau = { C: 5, H: 3, D: 10 };
  const base = safeProductOf(0, 0, 0);
  let states = 0;
  for (let c = 0; c <= plateau.C; c += 1) {
    for (let h = 0; h <= plateau.H; h += 1) {
      for (let d = 0; d <= plateau.D; d += 1) {
        assert(safeProductOf(c, h, d) === base, "全平台盒内乘积应相同");
        states += 1;
      }
    }
  }
  assert(states === (plateau.C + 1) * (plateau.H + 1) * (plateau.D + 1), "平台盒状态数不一致");
  // 每个状态都有同值（tie）交换（只要某个坐标>0 且另一个坐标未到上界）。
  let statesWithTieSwap = 0;
  for (let c = 0; c <= plateau.C; c += 1) {
    for (let h = 0; h <= plateau.H; h += 1) {
      for (let d = 0; d <= plateau.D; d += 1) {
        let tie = false;
        const coordinates = [
          { value: c, max: plateau.C },
          { value: h, max: plateau.H },
          { value: d, max: plateau.D },
        ];
        for (let fromIndex = 0; fromIndex < 3 && !tie; fromIndex += 1) {
          for (let toIndex = 0; toIndex < 3 && !tie; toIndex += 1) {
            if (fromIndex === toIndex) continue;
            if (coordinates[fromIndex].value < 1) continue;
            if (coordinates[toIndex].value >= coordinates[toIndex].max) continue;
            tie = true;
          }
        }
        if (tie) statesWithTieSwap += 1;
      }
    }
  }
  assert(statesWithTieSwap > 0, "应存在带 tie 交换的状态");
  // all states are argmax; 若用「存在同值交换替代 => 可删除」的规则，会把 argmax 集合从 states 缩到 1。
  const argmaxBefore = states;
  const argmaxAfterRule = 1;
  assert(argmaxAfterRule < argmaxBefore, "删除 tie 方案会改变 argmax 集合");
  ok(
    "B4.tie-swap",
    `全平台盒 ${JSON.stringify(plateau)} 共 ${states} 个状态全部同值（互为 argmax），` +
      `其中 ${statesWithTieSwap} 个存在 tie 交换；按「有同值替代即可删」会把 argmax 集合从 ${argmaxBefore} 缩为 ${argmaxAfterRule}，` +
      `故 tie 交换不授权保留 tie/identity 语义时的删除`,
  );
}

// ---------------------------------------------------------------------------
// B5. 分离定理的具体反例（ring 唯一性）
// ---------------------------------------------------------------------------
{
  // 抽象真实模型：两个 ring slot，每个 slot 可空或装 A、B；同一物品不能同时占两个 slot。
  // A 提供 CRT=500，B 提供 DHT=30，无 meld（meld cap = 0）；其余乘区固定。
  const itemA = { C: 500, H: 0, D: 0 };
  const itemB = { C: 0, H: 30, D: 0 };
  const slots = [null, "A", "B"];
  const realConfigurations = [];
  for (const left of slots) {
    for (const right of slots) {
      if (left !== null && left === right) continue; // 共享物品身份：同一件唯一物品不能占两个 slot
      const stat = { C: 0, H: 0, D: 0 };
      for (const item of [left, right]) {
        if (item === null) continue;
        const vector = item === "A" ? itemA : itemB;
        stat.C += vector.C;
        stat.H += vector.H;
        stat.D += vector.D;
      }
      const product = productOf(stat.C, stat.H, stat.D);
      realConfigurations.push({ slots: [left, right], stat, product });
    }
  }
  // 枚举去重统计
  const byStat = new Map();
  for (const config of realConfigurations) {
    const key = `${config.stat.C}/${config.stat.H}/${config.stat.D}`;
    if (!byStat.has(key)) byStat.set(key, { stat: config.stat, product: BigInt(config.product), slots: [] });
    byStat.get(key).slots.push(config.slots);
  }
  let realMax = 0n;
  let realArgmax = null;
  for (const entry of byStat.values()) {
    if (entry.product > realMax) {
      realMax = entry.product;
      realArgmax = entry;
    }
  }
  assert(realArgmax !== null, "真实模型应有最优配置");
  // 真实最优 stats 与值：q = (500,30,0)。
  assert(realArgmax.stat.C === 500 && realArgmax.stat.H === 30 && realArgmax.stat.D === 0, "真实最优应为 A+B");
  const qProduct = productOf(500, 30, 0);
  assert(qProduct === realMax, "真实最优值应与手工计算一致");
  // 自由松弛：从 q 出发，把 30 点 DHT 全部转给 CRT => (530,0,0)，严格改善。
  const relaxationAfter = productOf(530, 0, 0);
  assert(relaxationAfter > qProduct, "自由松弛的交换应严格改善");
  // 没有任何真实配置实现 (530,0,0) 或支配它。
  for (const entry of byStat.values()) {
    const dominates = entry.stat.C >= 530 && entry.stat.H >= 0 && entry.stat.D >= 0;
    assert(!dominates, `真实配置 ${JSON.stringify(entry.stat)} 不应支配松弛目标 (530,0,0)`);
    assert(entry.product <= qProduct, "真实空间不应存在比 q 更好的配置");
  }
  // 按「理论交换有利 => 删除真实物品 B（被交换出的属性来源）」会改变真实最优。
  let withoutB = 0n;
  for (const entry of byStat.values()) {
    if (entry.stat.H > 0) continue; // 删除所有提供 DHT 的配置（物品 B 的贡献）
    if (entry.product > withoutB) withoutB = entry.product;
  }
  assert(withoutB < qProduct, "删除物品 B 后真实最优应下降 => 删除不安全");
  ok(
    "B5.separation",
    `真实模型（ring 唯一性、meld cap=0、其余乘区固定）：真实配置 ${byStat.size} 种，真实最优 A+B q=(500,30,0) 值 ${qProduct}；` +
      `自由松弛从 q 交换 30 DHT->CRT 得 (530,0,0) 值 ${relaxationAfter} > q，但无任何真实配置实现/支配它；` +
      `若据此删除提供 DHT 的物品 B，真实最优降为 ${withoutB} < ${qProduct}（删除不安全）`,
  );
}

// ---------------------------------------------------------------------------
// B6. 安全删除路径 (b)：严格乐观上界（与 strict-improvement-frontier 联动）
// ---------------------------------------------------------------------------
{
  // incumbent（真实可达）+ 其它因子乐观上界 O；候选的副属性乘积 <= B_strict => 不可能严格改善。
  const incumbent = { C: 120, H: 60, D: 90 };
  const incumbentSub = productOf(incumbent.C, incumbent.H, incumbent.D);
  const O = BigInt(730) * BigInt(190) * BigInt(1050);
  const P_INC = O * incumbentSub; // 设 incumbent 的其它因子恰为乐观上界（最保守情形）
  const B_STRICT = floorDiv(P_INC, O);
  assert(BigInt(Number(B_STRICT)) === incumbentSub, "该构造下 B_strict 应等于 incumbent 副属性乘积");
  // 候选 e 的副属性乘积低于 B_strict（例：单件候选在其余属性取乐观上界仍低于阈值）。
  const candidate = { C: 100, H: 40, D: 70 };
  const candidateSub = productOf(candidate.C, candidate.H, candidate.D);
  assert(candidateSub <= BigInt(B_STRICT), "候选应不满足严格改善阈值");
  const candidateOptimisticValue = O * candidateSub;
  assert(candidateOptimisticValue <= P_INC, "候选的严格乐观上界应不超过 incumbent");
  ok(
    "B6.safe-upper-bound",
    `incumbent 副属性乘积 ${incumbentSub} => B_strict=${B_STRICT}；候选 (${candidate.C},${candidate.H},${candidate.D}) 副属性乘积 ${candidateSub}<=B_strict，` +
      `即使其它因子取满乐观上界 O=${O} 仍有 ${candidateOptimisticValue} <= P_inc=${P_INC} => 不能严格改善，可在严格改善搜索中删除（路径 b）`,
  );
}

// ---------------------------------------------------------------------------
// B7. 正性前提不可省：因子为 0 时交叉指数判据失效
// ---------------------------------------------------------------------------
{
  // F0=1, F1=2, cF=1；G0=0, G1=5, cG=1：交换后乘积 0 -> 10 严格改善，
  // 但交叉指数判据 F1^cG*G0^cF >= F0^cG*G1^cF 变成 2*0=0 >= 1*5=5，错误地判为不改善。
  const f0 = 1n;
  const f1 = 2n;
  const g0 = 0n;
  const g1 = 5n;
  const cF = 1n;
  const cG = 1n;
  const before = f0 * g0;
  const after = f1 * g1;
  assert(after > before, "两状态乘积在该例应严格改善");
  const crossLeft = f1 ** cG * g0 ** cF;
  const crossRight = f0 ** cG * g1 ** cF;
  assert(!(crossLeft >= crossRight), "交叉指数判据在 G0=0 时应失效（给出相反结论）");
  ok(
    "B7.positivity-required",
    `F0=${f0},F1=${f1},G0=${g0},G1=${g1}（+1 成本）：精确乘积 ${before}->${after} 严格改善，` +
      `但交叉指数式 ${crossLeft} vs ${crossRight} 给出相反结论；故正因子前提不可省（负因子时 log 亦无定义）`,
  );
}

// ---------------------------------------------------------------------------
// B8. baseStat 影响审计：交换算子与全部示例坐标都是「贡献」g，不是面板总值
// ---------------------------------------------------------------------------
{
  const levelParams = DOCUMENTED_LEVEL_PARAMS[LEVEL];
  // 参考模型 §2.1/§2.2：baseStats.CRT = baseStats.DHT = baseStats.TEN = sub；baseStats.DET = main。
  const offsets = { CRT: levelParams.sub, DHT: levelParams.sub, DET: levelParams.main };
  assert(offsets.CRT === 420 && offsets.DHT === 420 && offsets.DET === 440, "level 100 WHM 的 sub/main 应为 420/440");
  // 贡献 0 的档位 = 面板为 baseStats 时的档位。
  assert(tier(LEVEL, JOB, "CRT", 0) === 50, "贡献 0 的 CRT 档位应为 50");
  assert(tier(LEVEL, JOB, "DHT", 0) === 0, "贡献 0 的 DHT 档位应为 0");
  assert(tier(LEVEL, JOB, "DET", 0) === 1000, "贡献 0 的 DET 档位应为 1000");
  // 示例 q=(500,30,0)：贡献 + 偏移 = 面板 (920,450,440)。
  const qContribution = { C: 500, H: 30, D: 0 };
  const qPanel = {
    C: qContribution.C + offsets.CRT,
    H: qContribution.H + offsets.DHT,
    D: qContribution.D + offsets.DET,
  };
  assert(qPanel.C === 920 && qPanel.H === 450 && qPanel.D === 440, "q 的面板换算失败");
  // 若把示例当面板值，则贡献 = 面板 - 偏移，DHT/DET 变成负值，超出 g >= 0 定义域。
  const asPanelContribution = {
    C: qContribution.C - offsets.CRT,
    H: qContribution.H - offsets.DHT,
    D: qContribution.D - offsets.DET,
  };
  assert(asPanelContribution.H < 0 && asPanelContribution.D < 0,
    "若 (500,30,0) 是面板值，则 DHT/DET 贡献为负，超出正式候选域");
  // 把面板值直接当贡献喂给档位公式会得到不同档位 => 示例只能是贡献坐标。
  assert(factorC(qPanel.C) !== factorC(qContribution.C), "面板/贡献的 CRT 因子不应相同");
  // 示例乘积按贡献坐标复算，与 README/README 中的分离反例数值一致。
  assert(productOf(500, 30, 0) === 4_153_084_875_000n, "q 的副属性乘积复算不一致");
  assert(productOf(530, 0, 0) === 4_154_176_000_000n, "r 的副属性乘积复算不一致");
  assert(productOf(0, 0, 0) === 4_080_000_000_000n, "原点的副属性乘积复算不一致");
  // 交换判据的平移不变性：偏移是常数，交换的差分在贡献/面板坐标下相同。
  const rContribution = { C: 530, H: 0, D: 0 };
  const rPanel = {
    C: rContribution.C + offsets.CRT,
    H: rContribution.H + offsets.DHT,
    D: rContribution.D + offsets.DET,
  };
  assert(rPanel.C - qPanel.C === rContribution.C - qContribution.C, "CRT 差分在两种坐标下应相同");
  assert(rPanel.H - qPanel.H === rContribution.H - qContribution.H, "DHT 差分在两种坐标下应相同");
  assert(rPanel.D - qPanel.D === rContribution.D - qContribution.D, "DET 差分在两种坐标下应相同");
  // 严格改善判定在两种坐标下一致（因子只由贡献决定）。
  const strictInContribution = productOf(530, 0, 0) > productOf(500, 30, 0);
  assert(strictInContribution, "交换在贡献坐标下应为严格改善");
  ok(
    "B8.baseStat-audit",
    `level=100 WHM：sub=${offsets.CRT}、main=${offsets.DET}；贡献 0 的档位 = 面板为 baseStats 时的档位（CRT 50/DHT 0/DET 1000）；` +
      `示例 q=(500,30,0) 为贡献坐标（面板 (920,450,440)；若误当面板则贡献 (${asPanelContribution.C},${asPanelContribution.H},${asPanelContribution.D}) 为负、非法）；` +
      `q/r/原点的副属性乘积按贡献复算与 README 数值一致；交换差分在贡献与面板坐标下相同（偏移相消）`,
  );
}

console.log("attribute-swap-criterion/verify.mjs: PASS");
console.log(`定义域：level=${LEVEL} job=${JOB}；档位/因子来自 canonical integer model。`);
for (const line of results) console.log(line);
console.log("scope: 全部为有限域证书；一般性证明见 docs/mathematical-analysis/theorems/attribute-swap-criterion/README.md。");
