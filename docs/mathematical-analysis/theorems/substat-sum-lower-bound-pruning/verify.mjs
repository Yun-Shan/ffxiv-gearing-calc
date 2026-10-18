/**
 * substat-sum-lower-bound-pruning/verify.mjs
 *
 * 定理：三属性贡献和 S = CRT+DHT+DET 的安全下界与安全剪枝族（PR1–PR8）的有限域验证。
 *
 * 覆盖范围（有限、完整列出）：
 *   A. 合成实例：合法完成枚举、S 的 min/max、L1/R 安全界。
 *   B. L1 安全性；约束只缩小可行域；逐属性 min 相加更弱；面板值当 L 不安全。
 *   C. 戒指唯一性：精确最小合法配对 vs 朴素逐槽 min。
 *   D. 滚动界：分支区间包含扩展完成；L_rem 非增、分支下界非减、O(1) 增量更新。
 *   E. PR1 slab：可达集 ⊆ Ω'；D_min' 公式（含上界截断与 +∞）与暴力一致；K_w(Ω')>=K_w(Ω)。
 *   E2. slab 不继承盒域档位算法（D_min' 非单调/非单元常值；代表元 K_w 偏大，全枚举正确）。
 *   F. 下界不能改变 U（free-budget 松弛上独立复核）：Σ>=L 不改 U；L>S* 时区域为空。
 *   G. PR2 分支不可行：全局界形式的极限（非空分支必相交）；两个方向的精确命中实例；目标窗口形式。
 *   H. PR3 区域/切片排除：与 [L,R] 不相交的区域无真实可达点；pairwise 切片条件。
 *   I. PR4 incumbent 和割 K_sum：安全性；与乘积精确界的支配关系。
 *   J. PR5 候选级必要和可达性：安全性与支配关系。
 *   K. PR6 半空间组合/冗余；PR7 多职业可行性（离散冲突 / 条件目标窗）；PR8 tie 反例。
 *   L. 方向规则：L 太小/太大；Upper-as-L；逐属性 min；Lagrangian 约束下界（含方向）。
 *
 * 证明作用：有限域证书；反例即否证；代数命题的有限核对不替代 README 的一般性证明。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/theorems/substat-sum-lower-bound-pruning/verify.mjs
 */
import {
  assert,
  criticalFactor,
  determinationFactor,
  directHitFactor,
  DOCUMENTED_LEVEL_PARAMS,
  tier,
} from "../../verification/canonical-model.mjs";

const results = [];
function ok(name, detail) {
  results.push(`  [ok] ${name}: ${detail}`);
}

const LEVEL = 100;
const JOB = "WHM";
const PARAMS = DOCUMENTED_LEVEL_PARAMS[LEVEL];
const BASE = { C: PARAMS.sub, H: PARAMS.sub, D: PARAMS.main };
const STATS = ["C", "H", "D"];

function sum3(value) {
  return value.c + value.h + value.d;
}

/** 副属性乘积 Phi（Number；测试域内 < 2^53）。 */
function phi(value) {
  const c = criticalFactor(tier(LEVEL, JOB, "CRT", value.c), JOB);
  const h = directHitFactor(tier(LEVEL, JOB, "DHT", value.h));
  const d = determinationFactor(tier(LEVEL, JOB, "DET", value.d));
  const product = c * h * d;
  assert(Number.isSafeInteger(product), `Phi 超出安全整数：${product}`);
  return product;
}

function candidate(id, itemId, nonUnique, c, h, d, ten = 0, spd = 0) {
  return { id, itemId, nonUnique, c, h, d, ten, spd };
}

// ---------------------------------------------------------------------------
// 合成实例 M1：3 槽（head + 两个戒指槽）、2 食物；戒指 X 同 ID 且 unique。
// ---------------------------------------------------------------------------
function makeMainInstance() {
  return {
    name: "M1",
    slots: [
      {
        name: "head",
        candidates: [
          candidate("h1", "h1", false, 20, 10, 0, 0, 1),
          candidate("h2", "h2", false, 0, 15, 5, 1, 0),
          candidate("h3", "h3", false, 10, 0, 22, 2, 0),
          candidate("h4", "h4", false, 5, 5, 5, 0, 2),
        ],
      },
      {
        name: "ringA",
        candidates: [candidate("X", "X", false, 7, 7, 2, 1, 0), candidate("A2", "A2", false, 10, 10, 3, 0, 1)],
      },
      {
        name: "ringB",
        candidates: [candidate("X", "X", false, 7, 7, 2, 0, 1), candidate("B2", "B2", false, 10, 10, 3, 1, 0)],
      },
    ],
    foods: [
      { id: "f1", rates: { C: 0.02, H: 0, D: 0.02 }, caps: { C: 20, H: 0, D: 15 } },
      { id: "f2", rates: { C: 0, H: 0.03, D: 0 }, caps: { C: 0, H: 20, D: 0 } },
    ],
    optionalFood: false,
    constraints: null,
  };
}

/** 食物加成（贡献坐标）：bonus_i(f,G) = min(cap, trunc((G_i + base_i) * rate_i + 1e-7))。 */
function foodBonusAt(food, stat, gearContribution) {
  if (food === null) return 0;
  const rate = food.rates[stat];
  const cap = food.caps[stat];
  if (rate === 0 || cap === 0) return 0;
  const raw = Math.trunc((gearContribution + BASE[stat]) * rate + 1e-7);
  return Math.min(cap, raw);
}

function foodBonusSum(food, gearVector) {
  return (
    foodBonusAt(food, "C", gearVector.C) +
    foodBonusAt(food, "H", gearVector.H) +
    foodBonusAt(food, "D", gearVector.D)
  );
}

/** 同一 unique itemId 不能出现在两个槽。 */
function identityConflict(chosen) {
  const seen = new Set();
  for (const item of chosen) {
    if (item === null || item === undefined) continue;
    if (item.nonUnique) continue;
    if (seen.has(item.itemId)) return true;
    seen.add(item.itemId);
  }
  return false;
}

/** 枚举全部合法完成（含食物选择与可选硬约束）。 */
function enumerateCompletions(instance) {
  const completions = [];
  const foodChoices = instance.optionalFood ? [null, ...instance.foods] : [...instance.foods];
  const chosen = new Array(instance.slots.length).fill(null);
  const walk = (index) => {
    if (index === instance.slots.length) {
      if (identityConflict(chosen)) return;
      const gear = { C: 0, H: 0, D: 0 };
      let ten = 0;
      let spd = 0;
      for (const item of chosen) {
        gear.C += item.c;
        gear.H += item.h;
        gear.D += item.d;
        ten += item.ten;
        spd += item.spd;
      }
      for (const food of foodChoices) {
        const bonus = {
          C: foodBonusAt(food, "C", gear.C),
          H: foodBonusAt(food, "H", gear.H),
          D: foodBonusAt(food, "D", gear.D),
        };
        const final = { C: gear.C + bonus.C, H: gear.H + bonus.H, D: gear.D + bonus.D };
        const total = final.C + final.H + final.D;
        if (instance.constraints !== null) {
          const c = instance.constraints;
          if (c.tenLo !== undefined && ten < c.tenLo) continue;
          if (c.tenHi !== undefined && ten > c.tenHi) continue;
          if (c.spdLo !== undefined && spd < c.spdLo) continue;
          if (c.spdHi !== undefined && spd > c.spdHi) continue;
        }
        completions.push({ chosen: [...chosen], food, gear, bonus, final, total, ten, spd });
      }
      return;
    }
    for (const item of instance.slots[index].candidates) {
      chosen[index] = item;
      walk(index + 1);
    }
    chosen[index] = null;
  };
  walk(0);
  return completions;
}

function minMax(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  assert(Number.isFinite(min) && Number.isFinite(max), "样本为空");
  return { min, max };
}

const M1 = makeMainInstance();
const completions = enumerateCompletions(M1);
const totals = completions.map((completion) => completion.total);
const legalRange = minMax(totals);
const slotMin = M1.slots.map((slot) => Math.min(...slot.candidates.map(sum3)));
const slotMax = M1.slots.map((slot) => Math.max(...slot.candidates.map(sum3)));
const naiveGearLower = slotMin.reduce((a, b) => a + b, 0);
const foodLowerAtZero = M1.optionalFood ? 0 : Math.min(...M1.foods.map((food) => foodBonusSum(food, { C: 0, H: 0, D: 0 })));
const L1 = naiveGearLower + foodLowerAtZero;
const gearMaxUpper = slotMax.reduce((a, b) => a + b, 0);
const gearAttributeMax = {
  C: M1.slots.reduce((sum, slot) => sum + Math.max(...slot.candidates.map((item) => item.c)), 0),
  H: M1.slots.reduce((sum, slot) => sum + Math.max(...slot.candidates.map((item) => item.h)), 0),
  D: M1.slots.reduce((sum, slot) => sum + Math.max(...slot.candidates.map((item) => item.d)), 0),
};
const foodUpper = M1.optionalFood
  ? Math.max(0, ...M1.foods.map((food) => foodBonusSum(food, gearAttributeMax)))
  : Math.max(...M1.foods.map((food) => foodBonusSum(food, gearAttributeMax)));
const R1 = gearMaxUpper + foodUpper;
{
  assert(completions.length === 24, `M1 合法完成数应为 24，实际 ${completions.length}`);
  const maxC = Math.max(...completions.map((completion) => completion.final.C));
  const maxH = Math.max(...completions.map((completion) => completion.final.H));
  const maxD = Math.max(...completions.map((completion) => completion.final.D));
  assert(maxC <= 60 && maxH <= 60 && maxD <= 60, `M1 可达坐标应 <= 60：${maxC}/${maxH}/${maxD}`);
  ok(
    "A.instance",
    `M1 共 ${completions.length} 个合法完成；S∈[${legalRange.min},${legalRange.max}]；` +
      `L_gear(逐槽 min)=${naiveGearLower}，L_food=${foodLowerAtZero}，L1=${L1}；R_gear=${gearMaxUpper}，R_food=${foodUpper}，R=${R1}；坐标最大 ${maxC}/${maxH}/${maxD}`,
  );
}

// ---------------------------------------------------------------------------
// B. L1 安全性；逐属性 min 更弱；面板值不安全；约束下安全
// ---------------------------------------------------------------------------
{
  assert(L1 <= legalRange.min, `L1 必须是安全下界：${L1} > ${legalRange.min}`);
  assert(R1 >= legalRange.max, `R 必须是安全上界：${R1} < ${legalRange.max}`);
  const perAttributeLower =
    STATS.reduce((sum, stat) => {
      let value = 0;
      for (const slot of M1.slots) value += Math.min(...slot.candidates.map((item) => item[stat.toLowerCase()]));
      return sum + value;
    }, 0) + foodLowerAtZero;
  assert(perAttributeLower <= L1, "逐属性 min 相加应不高于逐槽 min 之和");
  assert(perAttributeLower <= legalRange.min, "逐属性 min 相加仍是安全下界");
  const panelInflation = PARAMS.sub + PARAMS.sub + PARAMS.main;
  assert(L1 + panelInflation > legalRange.max, "面板值当贡献会把 L 推过真实最大值");
  // 约束只会缩小可行域：无约束 L1 仍是约束下的安全下界。
  const constrained = makeMainInstance();
  constrained.constraints = { tenLo: 2 };
  const constrainedCompletions = enumerateCompletions(constrained);
  assert(constrainedCompletions.length > 0, "约束实例不应为空");
  const constrainedMin = minMax(constrainedCompletions.map((completion) => completion.total)).min;
  assert(L1 <= constrainedMin, "L1 在约束下也应安全");
  ok(
    "B.L1",
    `L1=${L1} <= min S=${legalRange.min}；R=${R1} >= max S=${legalRange.max}；` +
      `逐属性 min 相加=${perAttributeLower} <= L1（安全更弱）；面板换算 +${panelInflation} 会使 L=${L1 + panelInflation} > max S（不安全）；` +
      `约束 ten>=2 下 min S=${constrainedMin}，L1 仍安全`,
  );
}

// ---------------------------------------------------------------------------
// C. 戒指唯一性：精确最小合法配对 vs 朴素逐槽 min
// ---------------------------------------------------------------------------
function exactPairMin(slotA, slotB) {
  let best = Infinity;
  for (const left of slotA.candidates) {
    for (const right of slotB.candidates) {
      if (identityConflict([left, right])) continue;
      best = Math.min(best, sum3(left) + sum3(right));
    }
  }
  return best;
}
{
  const ringA = M1.slots.find((slot) => slot.name === "ringA");
  const ringB = M1.slots.find((slot) => slot.name === "ringB");
  const exact = exactPairMin(ringA, ringB);
  const naive = slotMin[1] + slotMin[2];
  assert(exact === 39, `精确最小合法配对应为 39，实际 ${exact}`);
  assert(naive === 32, `朴素逐槽 min 应为 32，实际 ${naive}`);
  assert(exact > naive, "唯一性冲突应使精确最小严格大于朴素 min");
  const headMin = slotMin[0];
  const exactGearLower = headMin + exact;
  assert(exactGearLower === 54, `精确 L_gear 应为 54，实际 ${exactGearLower}`);
  const refinedL1 = exactGearLower + foodLowerAtZero;
  assert(refinedL1 <= legalRange.min, "戒指精确下界仍安全");
  assert(refinedL1 > L1, "戒指精确下界应严格强于朴素 L1");
  ok(
    "C.ring-unique",
    `朴素逐槽 min=${naive}（X+X 非法）；精确最小合法配对=${exact}（X+B2/A2+X）；` +
      `精确 L_gear=${exactGearLower}、精化 L1'=${refinedL1} <= min S=${legalRange.min}（比朴素 L1=${L1} 更强）`,
  );
}

// ---------------------------------------------------------------------------
// D. 滚动界：分支区间包含扩展完成；L_rem 非增、分支下界非减；O(1) 增量更新
// ---------------------------------------------------------------------------
function branchBounds(instance, committed) {
  let gear = 0;
  let remainingMin = 0;
  let remainingMax = 0;
  const aggregateMax = { C: 0, H: 0, D: 0 };
  instance.slots.forEach((slot, index) => {
    const chosen = committed[index];
    if (chosen !== null && chosen !== undefined) {
      gear += sum3(chosen);
      aggregateMax.C += chosen.c;
      aggregateMax.H += chosen.h;
      aggregateMax.D += chosen.d;
    } else {
      remainingMin += Math.min(...slot.candidates.map(sum3));
      remainingMax += Math.max(...slot.candidates.map(sum3));
      aggregateMax.C += Math.max(...slot.candidates.map((item) => item.c));
      aggregateMax.H += Math.max(...slot.candidates.map((item) => item.h));
      aggregateMax.D += Math.max(...slot.candidates.map((item) => item.d));
    }
  });
  const foodMin = instance.optionalFood ? 0 : Math.min(...instance.foods.map((food) => foodBonusSum(food, { C: 0, H: 0, D: 0 })));
  const foodMax = instance.optionalFood
    ? Math.max(0, ...instance.foods.map((food) => foodBonusSum(food, aggregateMax)))
    : Math.max(...instance.foods.map((food) => foodBonusSum(food, aggregateMax)));
  return { gear, remainingMin, remainingMax, lower: gear + remainingMin + foodMin, upper: gear + remainingMax + foodMax };
}
{
  let branches = 0;
  let nonEmpty = 0;
  const visit = (index, committed) => {
    if (index === M1.slots.length) {
      branches += 1;
      const bounds = branchBounds(M1, committed);
      const extending = completions.filter((completion) =>
        committed.every((item, slotIndex) => item === null || completion.chosen[slotIndex].id === item.id),
      );
      if (extending.length === 0) return;
      nonEmpty += 1;
      const range = minMax(extending.map((completion) => completion.total));
      assert(bounds.lower <= range.min && bounds.upper >= range.max,
        `分支区间未包含扩展完成 ${JSON.stringify(committed.map((item) => (item === null ? null : item.id)))}`);
      return;
    }
    for (const item of [...M1.slots[index].candidates, null]) {
      committed.push(item);
      visit(index + 1, committed);
      committed.pop();
    }
  };
  visit(0, []);
  // 单调 + 增量更新
  const committed = [null, null, null];
  let gear = 0;
  let remainingMin = slotMin.reduce((a, b) => a + b, 0);
  let lowerRem = remainingMin + foodLowerAtZero;
  let previousLower = -Infinity;
  let previousLowerRem = lowerRem;
  const steps = [
    [0, M1.slots[0].candidates[0]],
    [1, M1.slots[1].candidates[0]],
    [2, M1.slots[2].candidates[1]],
  ];
  for (const [index, item] of steps) {
    committed[index] = item;
    gear += sum3(item);
    remainingMin -= slotMin[index];
    lowerRem = remainingMin + foodLowerAtZero;
    assert(lowerRem <= previousLowerRem, "L_rem 应随提交非减（数值不增）");
    previousLowerRem = lowerRem;
    const branchLower = gear + lowerRem;
    assert(branchLower >= previousLower, "分支下界应随提交非减");
    previousLower = branchLower;
    const recomputed = branchBounds(M1, committed);
    assert(recomputed.lower === branchLower, "O(1) 增量更新与重算不一致");
  }
  ok(
    "D.rolling",
    `枚举部分提交 ${branches} 个（非空 ${nonEmpty} 个）：[s_P+L_rem, s_P+R_rem] 全部包含扩展完成的 S；` +
      `依次提交 head/ringA/ringB 时 L_rem 非增、分支下界非减，且 O(1) 增量更新（s+=S3(c)、L_rem-=min_s）与重算一致`,
  );
}

// ---------------------------------------------------------------------------
// E. PR1 slab：Ω' = Ω ∩ {L <= Σ <= R}；可达集 ⊆ Ω'；D_min' 公式；K_w 单调
// ---------------------------------------------------------------------------
const OMEGA_MAX = 60;
const N = OMEGA_MAX + 1;
const PHI_TABLE = new Float64Array(N * N * N);
for (let c = 0; c <= OMEGA_MAX; c += 1) {
  for (let h = 0; h <= OMEGA_MAX; h += 1) {
    for (let d = 0; d <= OMEGA_MAX; d += 1) {
      PHI_TABLE[(c * N + h) * N + d] = phi({ c, h, d });
    }
  }
}
function phiAt(c, h, d) {
  return PHI_TABLE[(c * N + h) * N + d];
}
const phiFinal = (final) => phi({ c: final.C, h: final.H, d: final.D });
const reachableProducts = completions.map((completion) => phiFinal(completion.final)).sort((left, right) => right - left);
const B_TARGET = reachableProducts[0] - 1;
const SLAB_L = L1;
const SLAB_R = R1;
function kSumOverBox(B) {
  let best = null;
  for (let c = 0; c <= OMEGA_MAX; c += 1) {
    for (let h = 0; h <= OMEGA_MAX; h += 1) {
      for (let d = 0; d <= OMEGA_MAX; d += 1) {
        if (phiAt(c, h, d) <= B) continue;
        const total = c + h + d;
        if (best === null || total < best) best = total;
      }
    }
  }
  return best;
}
const K_SUM = kSumOverBox(B_TARGET);
const REACHABLE_IMPROVING = completions.filter((completion) => phiFinal(completion.final) > B_TARGET);
{
  for (const completion of completions) {
    assert(SLAB_L <= completion.total && completion.total <= SLAB_R, "可达完成必须落在 slab 内");
    assert(completion.final.C <= OMEGA_MAX && completion.final.H <= OMEGA_MAX && completion.final.D <= OMEGA_MAX,
      "可达坐标必须落在 Ω 内");
  }
  // D_min 朴素（全 Ω）与 slab 重定义公式；含上界截断与 +∞ 语义。
  const plainDMin = (c, h) => {
    for (let d = 0; d <= OMEGA_MAX; d += 1) if (phiAt(c, h, d) > B_TARGET) return d;
    return null;
  };
  const formulaDMin = (c, h) => {
    const plain = plainDMin(c, h);
    if (plain === null) return null; // D_min=+inf：任何 D 都不改善
    const lower = Math.max(0, SLAB_L - c - h);
    const upper = Math.min(OMEGA_MAX, SLAB_R - c - h);
    if (upper < lower) return null;
    const value = Math.max(plain, lower);
    return value <= upper ? value : null;
  };
  let checked = 0;
  let finite = 0;
  let empty = 0;
  for (let c = 0; c <= OMEGA_MAX; c += 1) {
    for (let h = 0; h <= OMEGA_MAX; h += 1) {
      const formula = formulaDMin(c, h);
      let brute = null;
      const lower = Math.max(0, SLAB_L - c - h);
      const upper = Math.min(OMEGA_MAX, SLAB_R - c - h);
      for (let d = lower; d <= upper; d += 1) {
        if (phiAt(c, h, d) > B_TARGET) {
          brute = d;
          break;
        }
      }
      assert(formula === brute, `D_min' 公式与暴力不一致 (${c},${h})：${formula} vs ${brute}`);
      checked += 1;
      if (brute === null) empty += 1;
      else finite += 1;
    }
  }
  // K_w(Ω) 与 K_w(Ω')
  const directions = [
    [1, 1, 1],
    [2, 1, 0],
    [1, 0, 2],
    [1, 1, 0],
    [3, 2, 1],
  ];
  const dot = (w, c, h, d) => w[0] * c + w[1] * h + w[2] * d;
  const kwBox = (w, slabOnly) => {
    let best = null;
    for (let c = 0; c <= OMEGA_MAX; c += 1) {
      for (let h = 0; h <= OMEGA_MAX; h += 1) {
        for (let d = 0; d <= OMEGA_MAX; d += 1) {
          if (phiAt(c, h, d) <= B_TARGET) continue;
          const total = c + h + d;
          if (slabOnly && (total < SLAB_L || total > SLAB_R)) continue;
          const value = dot(w, c, h, d);
          if (best === null || value < best) best = value;
        }
      }
    }
    return best;
  };
  let monotoneChecks = 0;
  for (const w of directions) {
    const kOmega = kwBox(w, false);
    const kSlab = kwBox(w, true);
    if (kOmega === null) {
      assert(kSlab === null, "Ω 上无改善点则 Ω' 上也应无");
      continue;
    }
    if (REACHABLE_IMPROVING.length > 0) {
      assert(kSlab !== null, "可达改善点都在 Ω' 内，故 G∩Ω' 非空");
      assert(kSlab >= kOmega, `K_w(Ω') 应 >= K_w(Ω)：${kSlab} vs ${kOmega}`);
      for (const completion of REACHABLE_IMPROVING) {
        assert(
          dot(w, completion.final.C, completion.final.H, completion.final.D) >= kSlab,
          "可达改善点必须满足 Ω' 上的必要半空间",
        );
      }
      monotoneChecks += 1;
    }
  }
  // G∩Ω' 空的语义：极高阈值时 K=+∞，但结论是“Ω' 内无改善点”（更强），不是剪枝失效。
  const B_EMPTY = phiAt(OMEGA_MAX, OMEGA_MAX, OMEGA_MAX);
  let emptySlabCount = 0;
  for (let c = 0; c <= OMEGA_MAX; c += 1) {
    for (let h = 0; h <= OMEGA_MAX; h += 1) {
      for (let d = 0; d <= OMEGA_MAX; d += 1) {
        if (phiAt(c, h, d) <= B_EMPTY) continue;
        const total = c + h + d;
        if (total >= SLAB_L && total <= SLAB_R) emptySlabCount += 1;
      }
    }
  }
  // G∩Ω'=∅ 时 K_w=+∞（更强结论：Ω' 内无改善点），不是剪枝失效。
  let kSlabAtEmpty = null;
  for (let c = 0; c <= OMEGA_MAX; c += 1) {
    for (let h = 0; h <= OMEGA_MAX; h += 1) {
      for (let d = 0; d <= OMEGA_MAX; d += 1) {
        if (phiAt(c, h, d) <= B_EMPTY) continue;
        const total = c + h + d;
        if (total < SLAB_L || total > SLAB_R) continue;
        kSlabAtEmpty = "nonempty";
      }
    }
  }
  assert(kSlabAtEmpty === null, "B=P* 时 Ω' 内应无改善点");
  assert(REACHABLE_IMPROVING.every((completion) => phiFinal(completion.final) <= B_EMPTY), "B=P* 时无可达改善点");
  ok(
    "E.PR1-slab",
    `B=${B_TARGET}（最大可达乘积-1），K_sum(Ω)=${K_SUM}；可达完成全部满足 L1=${SLAB_L} <= Σ <= R=${SLAB_R}；` +
      `D_min' 公式在 ${checked} 个 (C,H) 上与“slab∩Ω 上重新定义 D_min”的暴力一致（有限 ${finite} / +∞ ${empty}）；` +
      `${monotoneChecks} 个方向满足 K_w(Ω')>=K_w(Ω) 且全部可达改善点满足半空间；` +
      `极高阈值 B=P* 时 G∩Ω' 计数=${emptySlabCount}，K_w=+∞ 表示 Ω' 内无改善点（更强结论）`,
  );
}

// ---------------------------------------------------------------------------
// E2. slab 不继承盒域档位算法（与 frontier §7.6/§11 A13 同一反例）
// ---------------------------------------------------------------------------
{
  const KAPPA = 1;
  const SLAB_L2 = 1;
  const SLAB_R2 = 1;
  const SLAB_B2 = 1;
  const phi3 = (c, h, d) => phi({ c, h, d });
  const slabImproving = [];
  for (let c = 0; c <= KAPPA; c += 1) {
    for (let h = 0; h <= KAPPA; h += 1) {
      for (let d = 0; d <= KAPPA; d += 1) {
        if (phi3(c, h, d) <= SLAB_B2) continue;
        if (c + h + d < SLAB_L2 || c + h + d > SLAB_R2) continue;
        slabImproving.push({ c, h, d });
      }
    }
  }
  const keyOf = (point) => `${point.c}/${point.h}/${point.d}`;
  assert(slabImproving.length === 3, `slab 内应有 3 个改善点，实际 ${slabImproving.length}`);
  assert(
    ["1/0/0", "0/1/0", "0/0/1"].every((key) => slabImproving.some((point) => keyOf(point) === key)),
    "slab 改善点应恰为 (1,0,0),(0,1,0),(0,0,1)",
  );
  const dMinPrime = (C, H) => {
    const lower = Math.max(0, SLAB_L2 - C - H);
    const upper = Math.min(KAPPA, SLAB_R2 - C - H);
    if (upper < lower) return null;
    for (let d = lower; d <= upper; d += 1) if (phi3(C, H, d) > SLAB_B2) return d;
    return null;
  };
  assert(dMinPrime(0, 0) === 1, "D_min'(0,0) 应为 1");
  assert(dMinPrime(1, 0) === 0, "D_min'(1,0) 应为 0");
  assert(dMinPrime(1, 1) === null, "D_min'(1,1) 应为 +infinity");
  // 非单调：H=1 时 C 从 0 增到 1，D_min' 由 0 变 +∞（违反非增）
  assert(dMinPrime(0, 1) === 0 && dMinPrime(1, 1) === null, "R2 非单调见证错误");
  // 非单元常值：贡献 0 与 1 同 tier，但 (0,0)/(1,0) 取不同值
  assert(tier(LEVEL, JOB, "CRT", 0) === tier(LEVEL, JOB, "CRT", 1), "CRT 0/1 应同 tier");
  assert(tier(LEVEL, JOB, "DHT", 0) === tier(LEVEL, JOB, "DHT", 1), "DHT 0/1 应同 tier");
  assert(tier(LEVEL, JOB, "DET", 0) === tier(LEVEL, JOB, "DET", 1), "DET 0/1 应同 tier");
  assert(dMinPrime(0, 0) !== dMinPrime(1, 0), "同一 tier 单元内 D_min' 不应相同");
  // 真实 K_w vs 盒域 tier 代表元算法
  const w = [0, 1, 1];
  const trueK = Math.min(...slabImproving.map((point) => w[0] * point.c + w[1] * point.h + w[2] * point.d));
  const repK = w[2] * dMinPrime(0, 0); // 盒域 tier 代表元 (0,0)
  assert(trueK === 0, `真实 K_w 应为 0，实际 ${trueK}`);
  assert(repK === 1, `盒域代表元算法应为 1，实际 ${repK}`);
  assert(repK > trueK, "代表元算法偏大（不安全）");
  // §5.6 PR1 的全枚举公式：与直接枚举一致（正确算法）
  let formulaK = null;
  for (let C = 0; C <= KAPPA; C += 1) {
    for (let H = 0; H <= KAPPA; H += 1) {
      const D = dMinPrime(C, H);
      if (D === null) continue;
      const value = w[0] * C + w[1] * H + w[2] * D;
      if (formulaK === null || value < formulaK) formulaK = value;
    }
  }
  assert(formulaK === trueK, "PR1 的 (C,H) 全枚举公式应与直接枚举一致");
  ok(
    "E2.slab-not-inherit",
    `Ω=[0,1]^3,L=R=1,B=1：slab 改善点 3 个；D_min'(0,0)=1,(1,0)=0,(1,1)=+∞；H=1 方向 0→+∞ 非单调、0/1 同 tier 但值不同；` +
      `w=(0,1,1) 真实 K=0、盒域 tier 代表元=1（偏大、不安全）；(C,H) 全枚举公式=${formulaK}（=直接枚举，正确）`,
  );
}

// ---------------------------------------------------------------------------
// F. 下界不能改变 U（在 free-budget 松弛上独立复核）
// ---------------------------------------------------------------------------
{
  const budget = 15;
  const caps = 20;
  const allocations = [];
  for (let c = 0; c <= caps; c += 1) {
    for (let h = 0; h <= caps; h += 1) {
      for (let d = 0; d <= caps; d += 1) {
        if (c + h + d <= budget) allocations.push({ c, h, d, sum: c + h + d, value: phi({ c, h, d }) });
      }
    }
  }
  const U = Math.max(...allocations.map((allocation) => allocation.value));
  const sStar = Math.min(budget, caps * 3);
  assert(sStar === 15, "S* 应为 min(R,K)=15");
  const restrictedMax = (L) => {
    let best = null;
    for (const allocation of allocations) {
      if (allocation.sum < L) continue;
      if (best === null || allocation.value > best) best = allocation.value;
    }
    return best;
  };
  for (const L of [0, 1, 7, 14, 15]) {
    assert(restrictedMax(L) === U, `Σ>=${L} 不应改变 U`);
  }
  assert(restrictedMax(16) === null, "L>S*=15 时松弛区域为空");
  // 满预算最优解的存在性（free-budget 定理 2）：断言 Σ=15 的最优点达到 U。
  const fullBudgetMax = Math.max(...allocations.filter((allocation) => allocation.sum === 15).map((allocation) => allocation.value));
  assert(fullBudgetMax === U, "应存在满预算最优解（Σ=S*=15）");
  // 禁止混用：把真实域 slab 的下界 SLAB_L 当作松弛 Σx 的下界，会清空松弛并丢掉 U 的满预算最大值面。
  assert(restrictedMax(SLAB_L) === null, "真实域 L 用作松弛下界会清空松弛（禁止混用反例）");
  ok(
    "F.U-invariance",
    `free-budget 松弛 b=0,R=15,κ=20：U=${U}；对 L=0,1,7,14,15，限制 Σ>=L 后最大值仍为 ${U}（不改变 U）；` +
      `L=16 时区域为空；满预算面 Σ=15 上的最大值为 ${fullBudgetMax}=U（定理 2）`,
  );
}

// ---------------------------------------------------------------------------
// G. PR2 分支不可行
// ---------------------------------------------------------------------------
function enumeratePartialBranches(instance) {
  const branches = [];
  const committed = new Array(instance.slots.length).fill(null);
  const walk = (index) => {
    if (index === instance.slots.length) {
      branches.push([...committed]);
      return;
    }
    for (const item of [...instance.slots[index].candidates, null]) {
      committed[index] = item;
      walk(index + 1);
    }
    committed[index] = null;
  };
  walk(0);
  return branches;
}
{
  // (G1) 全局界形式：证明非空分支必与 [L,R] 相交（限制说明）。
  let total = 0;
  let nonEmpty = 0;
  let disjointNonEmpty = 0;
  let disjointEmpty = 0;
  for (const committed of enumeratePartialBranches(M1)) {
    total += 1;
    const bounds = branchBounds(M1, committed);
    const extending = completions.filter((completion) =>
      committed.every((item, slotIndex) => item === null || completion.chosen[slotIndex].id === item.id),
    );
    const disjoint = bounds.upper < SLAB_L || bounds.lower > SLAB_R;
    if (extending.length > 0) {
      nonEmpty += 1;
      assert(!disjoint, "非空分支的保证区间必须与 [L,R] 相交");
      if (disjoint) disjointNonEmpty += 1;
    } else if (disjoint) {
      disjointEmpty += 1;
    }
  }
  // (G2) 精确命中：两个方向各一个“非法完全提交”分支（保证区间落在 [L,R] 外）。
  const makeRingInstance = (candidatesA, candidatesB) => ({
    slots: [
      { name: "ringA", candidates: candidatesA },
      { name: "ringB", candidates: candidatesB },
    ],
    foods: [{ id: "f0", rates: { C: 0, H: 0, D: 0 }, caps: { C: 0, H: 0, D: 0 } }],
    optionalFood: false,
    constraints: null,
  });
  const Xbig = () => candidate("Xbig", "X", false, 50, 40, 10);
  const Y = () => candidate("Y", "Y", false, 5, 5, 0);
  const instanceHighIllegal = makeRingInstance([Xbig(), Y()], [Xbig(), Y()]);
  const highCompletions = enumerateCompletions(instanceHighIllegal);
  const highRange = minMax(highCompletions.map((completion) => completion.total));
  const highIllegalBounds = branchBounds(instanceHighIllegal, [Xbig(), Xbig()]);
  const highIllegalEmpty = highCompletions.filter((completion) =>
    completion.chosen[0].id === "Xbig" && completion.chosen[1].id === "Xbig",
  ).length;
  assert(highIllegalEmpty === 0, "Xbig+Xbig 应非法");
  assert(highIllegalBounds.lower > highRange.max, "PR2 方向 (lower > R) 未命中");
  const Xsmall = () => candidate("Xsmall", "X", false, 5, 0, 0);
  const BigA = () => candidate("BigA", "A", false, 50, 40, 10);
  const BigB = () => candidate("BigB", "B", false, 50, 40, 10);
  const instanceLowIllegal = makeRingInstance([Xsmall(), BigA()], [Xsmall(), BigB()]);
  const lowCompletions = enumerateCompletions(instanceLowIllegal);
  const lowRange = minMax(lowCompletions.map((completion) => completion.total));
  const lowIllegalBounds = branchBounds(instanceLowIllegal, [Xsmall(), Xsmall()]);
  assert(lowIllegalBounds.upper < lowRange.min, "PR2 方向 (upper < L) 未命中");
  // (G3) 目标窗口形式：严格改善所需和 K_SUM；分支上界 < K_SUM => 无改善完成。
  let targetHits = 0;
  for (const committed of enumeratePartialBranches(M1)) {
    const bounds = branchBounds(M1, committed);
    if (bounds.upper >= K_SUM) continue;
    targetHits += 1;
    const improving = REACHABLE_IMPROVING.filter((completion) =>
      committed.every((item, slotIndex) => item === null || completion.chosen[slotIndex].id === item.id),
    );
    assert(improving.length === 0, "目标窗口剪枝删除了严格改善完成");
  }
  ok(
    "G.PR2-branch",
    `全局界形式：部分提交分支 ${total} 个（非空 ${nonEmpty}），非空分支保证区间全部与 [L,R] 相交（不相交 ${disjointNonEmpty} 个）；` +
      `空分支中不相交 ${disjointEmpty} 个（该形式只能证空分支）。精确命中（非法完全提交）：上界方向 branch.lower=${highIllegalBounds.lower} > R=${highRange.max}；` +
      `下界方向 branch.upper=${lowIllegalBounds.upper} < L=${lowRange.min}；两个分支均无合法完成。` +
      `目标窗口形式（W_lo=K_sum=${K_SUM}）命中 ${targetHits} 个分支且均无严格改善完成`,
  );
}

// ---------------------------------------------------------------------------
// H. PR3 区域/切片排除（真实域可行性/枚举）
// ---------------------------------------------------------------------------
{
  // 区域 1：Σ <= L-1 的点不含真实完成。
  let reachableBelow = 0;
  for (const completion of completions) if (completion.total < SLAB_L) reachableBelow += 1;
  assert(reachableBelow === 0, "Σ<L 的区域不应含真实完成");
  // 区域 2：小盒 [0,10]^3 不含真实完成（其 Σ <= 30 < L）。
  let reachableInSmallBox = 0;
  for (const completion of completions) {
    const { C, H, D } = completion.final;
    if (C <= 10 && H <= 10 && D <= 10) reachableInSmallBox += 1;
  }
  assert(reachableInSmallBox === 0, "小盒内不应有真实完成");
  // 区域 3：pairwise 切片。固定第三坐标 d0、另两属性预算 S_pair：总 Σ = S_pair + d0。
  // 条件 S_pair + d0 ∈ [L,R]；否则该切片不含真实完成。
  let sliceHits = 0;
  for (const completion of REACHABLE_IMPROVING) {
    const d0 = completion.final.D;
    const pairBudget = completion.final.C + completion.final.H;
    assert(SLAB_L <= pairBudget + d0 && pairBudget + d0 <= SLAB_R, "可达点应满足切片可行性");
    // 构造一个不相交切片：同一 d0 下把 pairBudget 取到不可行值。
    const infeasiblePairBudget = SLAB_L - d0 - 1;
    if (infeasiblePairBudget >= 0) {
      const containsReachable = completions.some(
        (candidateCompletion) =>
          candidateCompletion.final.D === d0 &&
          candidateCompletion.final.C + candidateCompletion.final.H === infeasiblePairBudget,
      );
      assert(!containsReachable, "恒等切片条件失败");
      sliceHits += 1;
    }
  }
  ok(
    "H.PR3-region",
    `Σ<=L-1 的区域真实完成数=0；小盒 [0,10]^3 真实完成数=0；` +
      `pairwise 切片条件 S_pair+d0 ∈ [L,R] 对 ${REACHABLE_IMPROVING.length} 个可达改善点成立，并构造 ${sliceHits} 个不相交切片均无真实完成`,
  );
}

// ---------------------------------------------------------------------------
// I. PR4 incumbent 和割 K_sum：安全性与支配关系
// ---------------------------------------------------------------------------
function exactMaxPhiForCompletions(list) {
  let best = null;
  for (const completion of list) {
    const value = phiFinal(completion.final);
    if (best === null || value > best) best = value;
  }
  return best;
}
{
  let hits = 0;
  let productStrictlyStronger = 0;
  for (const committed of enumeratePartialBranches(M1)) {
    const bounds = branchBounds(M1, committed);
    const extending = completions.filter((completion) =>
      committed.every((item, slotIndex) => item === null || completion.chosen[slotIndex].id === item.id),
    );
    const exactMaxPhi = extending.length > 0 ? exactMaxPhiForCompletions(extending) : null;
    const sumPrunes = bounds.upper < K_SUM;
    const productPrunes = exactMaxPhi !== null && exactMaxPhi <= B_TARGET;
    if (sumPrunes) {
      hits += 1;
      assert(extending.every((completion) => phiFinal(completion.final) <= B_TARGET),
        "和割剪掉的分支不应含严格改善完成");
    }
    // 支配关系：非空分支上，和割（必要条件和）删掉的分支，精确乘积界也一定能删（乘积界更强）。
    if (sumPrunes && extending.length > 0) assert(productPrunes, "非空分支：和割可删时应也被精确乘积界删去");
    if (productPrunes && !sumPrunes) productStrictlyStronger += 1;
  }
  ok(
    "I.PR4-sum-cut",
    `K_sum(Ω')=${kSumOverBox(B_TARGET) >= SLAB_L ? kSumOverBox(B_TARGET) : SLAB_L}（阈值 B=${B_TARGET}）；` +
      `和割在 ${hits} 个分支触发且这些分支无严格改善完成；和割可删的分支全部也被精确乘积界删去（乘积界更强）；` +
      `存在 ${productStrictlyStronger} 个分支“乘积界可删但和割不触发”（例证支配方向）`,
  );
}

// ---------------------------------------------------------------------------
// J. PR5 候选级必要和可达性
// ---------------------------------------------------------------------------
{
  let hits = 0;
  let productStrictlyStronger = 0;
  for (let slotIndex = 0; slotIndex < M1.slots.length; slotIndex += 1) {
    for (const item of M1.slots[slotIndex].candidates) {
      const committed = new Array(M1.slots.length).fill(null);
      committed[slotIndex] = item;
      const bounds = branchBounds(M1, committed);
      const using = completions.filter((completion) => completion.chosen[slotIndex].id === item.id);
      if (bounds.upper < K_SUM) {
        hits += 1;
        assert(using.every((completion) => phiFinal(completion.final) <= B_TARGET),
          "和可达性剪枝删除了使用该候选的严格改善完成");
      }
      const exactMaxPhi = exactMaxPhiForCompletions(using);
      const sumPrunes = bounds.upper < K_SUM;
      const productPrunes = exactMaxPhi !== null && exactMaxPhi <= B_TARGET;
      if (sumPrunes && using.length > 0) assert(productPrunes, "非空候选：和割可删时应也被精确乘积界删去");
      if (productPrunes && !sumPrunes) productStrictlyStronger += 1;
    }
  }
  // M4 小实例：构造真正命中的候选级和可达性（tiny 候选不可能参与严格改善）。
  const M4 = {
    slots: [
      { name: "s1", candidates: [candidate("t", "t", false, 0, 0, 0), candidate("b", "b", false, 30, 30, 10)] },
      { name: "s2", candidates: [candidate("u", "u", false, 20, 20, 10)] },
    ],
    foods: [],
    optionalFood: true,
    constraints: null,
  };
  const m4Completions = enumerateCompletions(M4);
  const m4Products = m4Completions.map((completion) => phiFinal(completion.final)).sort((left, right) => right - left);
  const B4 = m4Products[0] - 1;
  const K_SUM4 = kSumOverBox(B4);
  const tinyCommitted = [M4.slots[0].candidates[0], null];
  const tinyBounds = branchBounds(M4, tinyCommitted);
  const m4UsingTiny = m4Completions.filter((completion) => completion.chosen[0].id === "t");
  assert(m4UsingTiny.length === 1, "M4 中 tiny 候选的完成数应为 1");
  assert(tinyBounds.upper < K_SUM4, "M4 的 tiny 候选应命中候选级和可达性");
  assert(m4UsingTiny.every((completion) => phiFinal(completion.final) <= B4), "tiny 候选不应参与严格改善完成");
  ok(
    "J.PR5-candidate",
    `候选级和可达性（maxΣ_using_c < K_sum=${K_SUM}）在 M1 上命中 ${hits} 个候选（均不参与严格改善完成）；` +
      `存在 ${productStrictlyStronger} 个候选“乘积界可删但和可达性不触发”（乘积界更强）；` +
      `M4 实例中 tiny 候选 maxΣ=${tinyBounds.upper} < K_sum=${K_SUM4}，命中 1 个候选且该候选不参与严格改善完成`,
  );
}

// ---------------------------------------------------------------------------
// K. PR6 半空间组合；PR7 多职业；PR8 tie
// ---------------------------------------------------------------------------
{
  // PR6：和半空间是 w=(1,1,1) 支撑；与其它方向组合，任意子集安全。
  const directions = [
    [1, 1, 1],
    [2, 1, 0],
    [1, 0, 2],
    [1, 1, 0],
    [3, 2, 1],
  ];
  const dot = (w, c, h, d) => w[0] * c + w[1] * h + w[2] * d;
  const kwSlab = (w) => {
    let best = null;
    for (let c = 0; c <= OMEGA_MAX; c += 1) {
      for (let h = 0; h <= OMEGA_MAX; h += 1) {
        for (let d = 0; d <= OMEGA_MAX; d += 1) {
          if (phiAt(c, h, d) <= B_TARGET) continue;
          const total = c + h + d;
          if (total < SLAB_L || total > SLAB_R) continue;
          const value = dot(w, c, h, d);
          if (best === null || value < best) best = value;
        }
      }
    }
    return best;
  };
  const supports = directions.map((w) => ({ w, k: kwSlab(w) }));
  const reachableImproving = REACHABLE_IMPROVING;
  let subsetChecks = 0;
  for (let mask = 1; mask < 1 << supports.length; mask += 1) {
    const subset = supports.filter((_support, index) => (mask >> index) & 1);
    if (subset.some((support) => support.k === null)) continue;
    for (const completion of reachableImproving) {
      for (const support of subset) {
        assert(
          dot(support.w, completion.final.C, completion.final.H, completion.final.D) >= support.k,
          "任意支撑子集删除了可达改善点",
        );
      }
    }
    subsetChecks += 1;
  }
  // 和半空间被 (2,2,2),K=2K_sum 蕴含；并验证 K_{(1,1,1)}(Ω')=max(K_sum,L)。
  const sumK = kwSlab([1, 1, 1]);
  assert(sumK !== null, "和支撑应有限");
  for (let c = 0; c <= OMEGA_MAX; c += 1) {
    for (let h = 0; h <= OMEGA_MAX; h += 1) {
      for (let d = 0; d <= OMEGA_MAX; d += 1) {
        if (2 * (c + h + d) < 2 * K_SUM) continue;
        assert(c + h + d >= K_SUM, "比例支撑 (2,2,2) 应蕴含和半空间");
      }
    }
  }
  assert(sumK === Math.max(K_SUM, SLAB_L), `K_{(1,1,1)}(Ω') 应为 max(K_sum,L)=${Math.max(K_SUM, SLAB_L)}，实际 ${sumK}`);
  ok(
    "K.PR6-support",
    `支撑方向 ${supports.length} 个；任意非空子集（${subsetChecks} 个）均不删可达改善点；` +
      `(2,2,2),K=2K_sum 蕴含和半空间；K_{(1,1,1)}(Ω')=${sumK}=max(K_sum,L)=${Math.max(K_SUM, SLAB_L)}`,
  );
}
{
  // PR7：共享槽位 + 各职业专属槽；离散冲突导致某职业无合法完成 => 联合分支可剪。
  const jointInstance = {
    slots: [
      {
        name: "ringA",
        candidates: [candidate("X", "X", false, 7, 7, 2), candidate("A2", "A2", false, 10, 10, 3)],
      },
      {
        name: "ringB",
        candidates: [candidate("X", "X", false, 7, 7, 2), candidate("B2", "B2", false, 10, 10, 3)],
      },
      // 职业 1 专属槽：唯一候选 Z1，itemId 与共享戒指 X 冲突（unique）。
      { name: "headJ1", candidates: [candidate("Z1", "X", false, 0, 0, 0)] },
      // 职业 2 专属槽：唯一候选 Z2，无冲突。
      { name: "headJ2", candidates: [candidate("Z2", "Z2", false, 0, 0, 0)] },
    ],
    foods: [{ id: "f0", rates: { C: 0, H: 0, D: 0 }, caps: { C: 0, H: 0, D: 0 } }],
    optionalFood: false,
    constraints: null,
  };
  const jointCompletions = enumerateCompletions(jointInstance);
  const withRingX = jointCompletions.filter((completion) =>
    completion.chosen[0].itemId === "X" || completion.chosen[1].itemId === "X",
  );
  assert(withRingX.length === 0, "共享戒指 X 应使职业 1 无合法完成");
  // 共享方案 (ringA=X, ringB=B2)：职业 1 专属槽唯一候选与 X 冲突 => job1 不可行 => 联合分支可剪。
  const sharedWithX = jointCompletions.filter(
    (completion) => completion.chosen[0].id === "X" && completion.chosen[1].id === "B2",
  );
  assert(sharedWithX.length === 0, "共享方案含 X 时不应有联合合法完成");
  // 条件目标窗：若联合模型要求每个职业严格改善，则 job1 分支上界 < W1 时可剪（这里用构造的 W1）。
  const job1Completions = completions; // 用 M1 作为 job1 的可行集（示意），条件规则本身是逻辑结论。
  const W1 = K_SUM; // job1 严格改善所需的必要和（与 PR4 同一阈值）
  let branchesPrunedByTarget = 0;
  for (const committed of enumeratePartialBranches(M1)) {
    const bounds = branchBounds(M1, committed);
    if (bounds.upper >= W1) continue;
    branchesPrunedByTarget += 1;
    const improving = REACHABLE_IMPROVING.filter((completion) =>
      committed.every((item, slotIndex) => item === null || completion.chosen[slotIndex].id === item.id),
    );
    assert(improving.length === 0, "条件目标窗剪枝不应删除 job1 的严格改善完成");
  }
  assert(branchesPrunedByTarget > 0, "应存在被条件目标窗剪掉的 job1 分支");
  ok(
    "K.PR7-joint",
    `共享戒指 X 与职业 1 专属唯一候选同 itemId：联合合法完成中含 X 的=${withRingX.length}，共享方案 (X,B2) 联合完成数=0（离散不可行）；` +
      `条件目标窗（要求每个职业都严格改善时）job1 分支剪枝 ${branchesPrunedByTarget} 个且均无合法完成`,
  );
}
{
  // PR8：tie 模型。抽象正因子乘积模型 Φ=x1*x2*x3（单调、正），B=8，tie 点 t=(2,2,2)（Φ=8）。
  // G_>(8)={Φ>8} 的最小和 K_sum=7（如 (1,3,3) 的和 7）；tie 点的和=6 < K_sum。
  const abstractPhi = (x) => x[0] * x[1] * x[2];
  const B_TIE = 8;
  let kSumAbstract = null;
  for (let a = 0; a <= 12; a += 1) {
    for (let b = 0; b <= 12; b += 1) {
      for (let c = 0; c <= 12; c += 1) {
        if (abstractPhi([a, b, c]) <= B_TIE) continue;
        const total = a + b + c;
        if (kSumAbstract === null || total < kSumAbstract) kSumAbstract = total;
      }
    }
  }
  const tiePoint = [2, 2, 2];
  assert(abstractPhi(tiePoint) === B_TIE, "tie 点乘积应恰等于阈值");
  assert(tiePoint[0] + tiePoint[1] + tiePoint[2] < kSumAbstract, "tie 点的和应小于 K_sum（反例成立）");
  assert(kSumAbstract === 7, `抽象模型 K_sum 应为 7，实际 ${kSumAbstract}`);
  // 严格改善模型可删 tie 点；tie 保留模型不可删（它是最优同分点）。
  const strictSurvivors = [[2, 2, 2]].filter((x) => abstractPhi(x) > B_TIE);
  assert(strictSurvivors.length === 0, "严格模型应排除 tie 点");
  ok(
    "K.PR8-tie",
    `抽象模型 Φ=x1x2x3,B=8：tie 点 (2,2,2) 的 Φ=8、Σ=6；G_>(8) 的 K_sum=${kSumAbstract}>6。` +
      `严格改善模型排除 tie 点；tie/身份保留模型若用“Σ<K_sum”剪枝会删掉该同分点（规则失效）`,
  );
}

// ---------------------------------------------------------------------------
// L. 方向规则：L 太大不安全；Upper-as-L；逐属性 min；Lagrangian 约束下界（方向）
// ---------------------------------------------------------------------------
{
  // L 取太大（> 真实最小值）：会排除合法完成。
  const L_TOO_LARGE = legalRange.min + 1;
  const excluded = completions.filter((completion) => completion.total < L_TOO_LARGE);
  assert(excluded.length > 0, "L 取太大应排除合法完成（不安全反例）");
  // Upper-as-L：把上界当 L，更明显不安全。
  const L_UPPER = R1;
  assert(completions.some((completion) => completion.total < L_UPPER), "把 R 当 L 会排除合法完成");
  // R 取太小（< 真实最大值）同样不安全。
  const R_TOO_SMALL = legalRange.max - 1;
  assert(completions.some((completion) => completion.total > R_TOO_SMALL), "R 取太小会排除合法完成");
  // 逐属性 min 相加：安全但更弱。
  const perAttributeLower =
    STATS.reduce((sum, stat) => {
      let value = 0;
      for (const slot of M1.slots) value += Math.min(...slot.candidates.map((item) => item[stat.toLowerCase()]));
      return sum + value;
    }, 0) + foodLowerAtZero;
  assert(perAttributeLower <= L1, "逐属性 min 相加应 <= 逐槽 min 下界");
  // Lagrangian 约束下界：约束 TEN >= tLo（方向：-ν·ten + ν·tLo，ν>=0）。
  const constrained = makeMainInstance();
  constrained.constraints = { tenLo: 2 };
  const constrainedCompletions = enumerateCompletions(constrained);
  const constrainedMin = minMax(constrainedCompletions.map((completion) => completion.total)).min;
  const lagrangianLower = Array.from({ length: 21 }, (_unused, nu) => {
    let bound = foodLowerAtZero;
    for (const slot of M1.slots) {
      bound += Math.min(...slot.candidates.map((item) => sum3(item) - nu * item.ten));
    }
    bound += nu * 2;
    return bound;
  });
  for (const bound of lagrangianLower) assert(bound <= constrainedMin, "TEN>=tLo 的 Lagrangian 下界方向错误");
  const bestLagrangian = Math.max(...lagrangianLower);
  // 上侧约束 TEN <= tHi（方向：+μ·ten − μ·tHi，μ>=0）。
  const constrainedHigh = makeMainInstance();
  constrainedHigh.constraints = { tenHi: 1 };
  const highCompletions = enumerateCompletions(constrainedHigh);
  const highMin = minMax(highCompletions.map((completion) => completion.total)).min;
  const lagrangianUpper = Array.from({ length: 21 }, (_unused, mu) => {
    let bound = foodLowerAtZero;
    for (const slot of M1.slots) {
      bound += Math.min(...slot.candidates.map((item) => sum3(item) + mu * item.ten));
    }
    bound -= mu * 1;
    return bound;
  });
  for (const bound of lagrangianUpper) assert(bound <= highMin, "TEN<=tHi 的 Lagrangian 下界方向错误");
  ok(
    "L.direction",
    `不安全方向：L=${L_TOO_LARGE} 排除 ${excluded.length} 个合法完成；把 R=${L_UPPER} 当 L 会排除合法完成。` +
      `安全更弱：逐属性 min 相加=${perAttributeLower} <= L1=${L1}。` +
      `Lagrangian（TEN>=2）：约束下 min S=${constrainedMin}，max_ν LB=${bestLagrangian}（<=真实值，方向正确）；` +
      `TEN<=1：约束下 min S=${highMin}，max_μ LB=${Math.max(...lagrangianUpper)}`,
  );
}

// ---------------------------------------------------------------------------
console.log("substat-sum-lower-bound-pruning/verify.mjs: PASS");
console.log(`定义域：level=${LEVEL} job=${JOB}；S=CRT+DHT+DET（贡献坐标）。M1 合法完成 ${completions.length} 个。`);
for (const line of results) console.log(line);
console.log("scope: 有限域证书；一般性证明见 docs/mathematical-analysis/theorems/substat-sum-lower-bound-pruning/README.md。");
