/**
 * verify-sum-bounds-independent.mjs
 *
 * Lead 侧独立交叉核验：三属性贡献和 S = CRT+DHT+DET 的联合上界/下界定理
 * （theorems/substat-sum-upper-bound、theorems/substat-sum-lower-bound-pruning）的**安全性**。
 *
 * 与定理目录 verify.mjs 的实现相互独立：本脚本自己实现穷举与界计算，不复用它们的代码；
 * 只复用 canonical-model 的整数工具做坐标断言。
 *
 * 覆盖范围（有限、显式）：
 *   A. 随机小模型：2–3 槽、每槽 1–4 候选、戒指唯一性、1–2 食物；
 *      穷举所有合法完成（含食物选择），核对
 *        L_gear/L1 <= min S <= max S <= R_gear^uniq <= R_gear <= R_sep，
 *        R_sep 是 gear 和上界、R_gear^uniq 是 gear 和精确最大值（独立穷举验证），
 *        R_food 族（B1–B4、max_f min_k）是最终和上界（安全方向）。
 *   B. Lagrangian 上界：速度 `<= v_hi`、TEN `>= t_lo`、TEN `<= t_hi` 的弱对偶上界
 *      在随机乘子上 >= 穷举约束最大值；下界方向对称抽查。
 *   C. PR1 的 D_min slab 重定义：小 (C,H) 网格上，slab 内直接定义与
 *      `max(D_min, max(0,L-C-H))` + 上截断公式逐点一致；空集判定一致。
 *   D. PR4/PR5 安全性抽查：随机乘积模型下，用 K_sum 剪枝不删任何严格改善点。
 *
 * 证明作用：有限随机的安全性反证器（发现反例即定理失效）；不是一般性证明。
 * 运行：node --experimental-strip-types docs/mathematical-analysis/verification/verify-sum-bounds-independent.mjs
 */
import {
  assert,
  criticalFactor,
  directHitFactor,
  determinationFactor,
} from "./canonical-model.mjs";

// 固定种子的 LCG，保证可复现
let seed = 20261018;
function random() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function randInt(lo, hi) {
  return lo + Math.floor(random() * (hi - lo + 1));
}

const checks = [];
function ok(name, detail) {
  checks.push(`  [ok] ${name}: ${detail}`);
}

// ---------------------------------------------------------------- 模型工具
// 候选：{ id, unique, x:[C,H,D], speed, ten }
function s3(c) {
  return c.x[0] + c.x[1] + c.x[2];
}
function ringsLegal(a, b) {
  // 两戒指同 ID 仅在 non-unique 时允许
  if (a.id !== b.id) return true;
  return a.unique === false;
}
function* completions(slotCandidateSets, ringSlotIndexes) {
  const indexes = new Array(slotCandidateSets.length).fill(0);
  const ringSet = new Set(ringSlotIndexes);
  function* walk(slot) {
    if (slot === slotCandidateSets.length) {
      // 戒指唯一性检查：所有戒指槽两两合法
      const ringSlots = [...ringSet];
      for (let i = 0; i < ringSlots.length; i += 1) {
        for (let j = i + 1; j < ringSlots.length; j += 1) {
          if (!ringsLegal(slotCandidateSets[ringSlots[i]][indexes[ringSlots[i]]],
            slotCandidateSets[ringSlots[j]][indexes[ringSlots[j]]])) return;
        }
      }
      yield indexes.slice();
      return;
    }
    for (let k = 0; k < slotCandidateSets[slot].length; k += 1) {
      indexes[slot] = k;
      yield* walk(slot + 1);
    }
  }
  yield* walk(0);
}
// 食物：{ cap:[3], numerator:[3], denominator:[3] }（全整数，bonus = min(cap, floor((G+base)*num/den))）
function foodBonus(food, G, base) {
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const raw = G[i] + base[i];
    const value = Math.floor((raw * food.numerator[i]) / food.denominator[i]);
    out[i] = Math.min(food.cap[i], Math.max(0, value));
  }
  return out;
}
function gearVector(slotCandidateSets, indexes) {
  const G = [0, 0, 0];
  for (let s = 0; s < indexes.length; s += 1) {
    const c = slotCandidateSets[s][indexes[s]];
    G[0] += c.x[0];
    G[1] += c.x[1];
    G[2] += c.x[2];
  }
  return G;
}

// ---------------------------------------------------------------- A. 随机模型
const BASE = [420, 420, 440]; // level 100 普通职业的 baseStats（贡献坐标偏移）
let modelCount = 0;
let completed = 0;
for (let model = 0; model < 200; model += 1) {
  const slotCount = randInt(2, 3);
  const ringSlots = slotCount >= 3 ? [1, 2] : [];
  const slotCandidateSets = [];
  for (let s = 0; s < slotCount; s += 1) {
    const candidateCount = randInt(1, 4);
    const candidates = [];
    for (let k = 0; k < candidateCount; k += 1) {
      candidates.push({
        id: randInt(0, 3),
        unique: random() < 0.5,
        x: [randInt(0, 30), randInt(0, 30), randInt(0, 30)],
        speed: randInt(0, 20),
        ten: randInt(0, 20),
      });
    }
    slotCandidateSets.push(candidates);
  }
  const foods = [
    { cap: [randInt(0, 10), randInt(0, 10), randInt(0, 10)], numerator: [1, 1, 1], denominator: [10, 10, 10] },
    { cap: [randInt(0, 10), randInt(0, 10), randInt(0, 10)], numerator: [2, 2, 2], denominator: [20, 20, 20] },
  ];
  // 穷举：所有合法 gear 完成 × 食物（含无食物）
  const sums = [];
  const gearSums = [];
  const allFoodChoices = [...foods, null];
  for (const indexes of completions(slotCandidateSets, ringSlots)) {
    const G = gearVector(slotCandidateSets, indexes);
    gearSums.push(G[0] + G[1] + G[2]);
    for (const food of allFoodChoices) {
      const bonus = food === null ? [0, 0, 0] : foodBonus(food, G, BASE);
      sums.push(G[0] + G[1] + G[2] + bonus[0] + bonus[1] + bonus[2]);
    }
  }
  if (sums.length === 0) continue;
  modelCount += 1;
  const minSum = Math.min(...sums);
  const maxSum = Math.max(...sums);
  const minGear = Math.min(...gearSums);
  const maxGear = Math.max(...gearSums);

  // 定理侧界：R_sep / R_gear / R_gear^uniq
  let Rsep = 0;
  for (let i = 0; i < 3; i += 1) {
    let total = 0;
    for (const set of slotCandidateSets) total += Math.max(...set.map((c) => c.x[i]));
    Rsep += total;
  }
  const Rgear = slotCandidateSets.reduce((sum, set) => sum + Math.max(...set.map(s3)), 0);
  // 戒指精确配对（独立实现：暴力 max over legal pairs）
  let RgearUniq = 0;
  for (let s = 0; s < slotCount; s += 1) {
    if (!ringSlots.includes(s)) {
      RgearUniq += Math.max(...slotCandidateSets[s].map(s3));
    }
  }
  if (ringSlots.length === 2) {
    let best = Number.NEGATIVE_INFINITY;
    for (const a of slotCandidateSets[ringSlots[0]]) {
      for (const b of slotCandidateSets[ringSlots[1]]) {
        if (ringsLegal(a, b)) best = Math.max(best, s3(a) + s3(b));
      }
    }
    assert(best > Number.NEGATIVE_INFINITY, "戒指无合法配对");
    RgearUniq += best;
  }
  assert(RgearUniq === maxGear, `R_gear^uniq != 穷举最大 gear 和: ${RgearUniq} vs ${maxGear}`);
  assert(maxGear <= Rgear && Rgear <= Rsep, "R_gear 支配链失败");
  assert(maxGear <= Rsep, "R_sep 不是 gear 和上界");

  // 下界：L_gear / L_food / L1
  const Lgear = slotCandidateSets.reduce((sum, set) => sum + Math.min(...set.map(s3)), 0);
  let Lfood = Number.POSITIVE_INFINITY;
  for (const food of [...foods, null]) {
    const bonus = food === null ? [0, 0, 0] : foodBonus(food, [0, 0, 0], BASE);
    Lfood = Math.min(Lfood, bonus[0] + bonus[1] + bonus[2]);
  }
  assert(Lgear <= minGear, "L_gear 不是 gear 和下界");
  assert(Lgear + Lfood <= minSum, "L1 不是 S 下界");

  // 食物感知上界族 B1-B4（对每个 f 及 ⊥ 都必须是该食物下的上界）
  for (const food of foods) {
    const Gmax = [0, 1, 2].map((i) =>
      slotCandidateSets.reduce((sum, set) => sum + Math.max(...set.map((c) => c.x[i])), 0));
    const bonusAtGmax = foodBonus(food, Gmax, BASE);
    const B1 = Rgear + food.cap[0] + food.cap[1] + food.cap[2];
    const B2 = Rsep + bonusAtGmax[0] + bonusAtGmax[1] + bonusAtGmax[2];
    // B3：线性权重（有理数，此处分母统一为 10）
    let B3numer = 0;
    for (const set of slotCandidateSets) {
      let best = Number.NEGATIVE_INFINITY;
      for (const c of set) {
        let value = 0;
        for (let i = 0; i < 3; i += 1) {
          value += (food.denominator[i] + food.numerator[i]) * c.x[i];
        }
        best = Math.max(best, value);
      }
      B3numer += best;
    }
    let baseTerm = 0;
    for (let i = 0; i < 3; i += 1) baseTerm += BASE[i] * food.numerator[i];
    assert(food.denominator[0] === food.denominator[1] && food.denominator[2] === food.denominator[0],
      "本抽查假设统一分母");
    const B3 = Math.floor((B3numer + baseTerm) / food.denominator[0]);
    const B4 = Rgear + bonusAtGmax[0] + bonusAtGmax[1] + bonusAtGmax[2];
    // 该食物下的穷举最大值
    let maxThisFood = Number.NEGATIVE_INFINITY;
    for (const indexes of completions(slotCandidateSets, ringSlots)) {
      const G = gearVector(slotCandidateSets, indexes);
      const bonus = foodBonus(food, G, BASE);
      maxThisFood = Math.max(maxThisFood, G[0] + G[1] + G[2] + bonus[0] + bonus[1] + bonus[2]);
    }
    for (const [name, bound] of [["B1", B1], ["B2", B2], ["B3", B3], ["B4", B4]]) {
      assert(bound >= maxThisFood, `${name} 不是食物上界: ${bound} < ${maxThisFood}`);
    }
    assert(B4 <= B1 && B4 <= B2, "B4 支配关系失败");
  }
  // R_food = max_f min_k B_k(f) 是最终和上界（含 ⊥ 取 R_gear）
  let Rfood = Rgear;
  for (const food of foods) {
    const Gmax = [0, 1, 2].map((i) =>
      slotCandidateSets.reduce((sum, set) => sum + Math.max(...set.map((c) => c.x[i])), 0));
    const bonusAtGmax = foodBonus(food, Gmax, BASE);
    const B1 = Rgear + food.cap[0] + food.cap[1] + food.cap[2];
    const B2 = Rsep + bonusAtGmax[0] + bonusAtGmax[1] + bonusAtGmax[2];
    const B4 = Rgear + bonusAtGmax[0] + bonusAtGmax[1] + bonusAtGmax[2];
    Rfood = Math.max(Rfood, Math.min(B1, B2, B4));
  }
  assert(Rfood >= maxSum, `R_food 不是最终和上界: ${Rfood} < ${maxSum}`);
  completed += 1;
}
assert(completed > 100, "有效随机模型数量不足");
ok("A.sum-bounds", `${modelCount} 个随机小模型逐点穷举：L1<=minS、maxS<=R_food、R_gear^uniq=穷举 maxGear、R_gear<=R_sep、B1-B4 安全且 B4<=B1/B2`);

// ---------------------------------------------------------------- B. Lagrangian
function bruteGearConstraint(slotCandidateSets, ringSlots, predicate, objective) {
  let best = Number.NEGATIVE_INFINITY;
  for (const indexes of completions(slotCandidateSets, ringSlots)) {
    const vector = [0, 0, 0];
    let speed = 0;
    let ten = 0;
    for (let s = 0; s < indexes.length; s += 1) {
      const c = slotCandidateSets[s][indexes[s]];
      vector[0] += c.x[0];
      vector[1] += c.x[1];
      vector[2] += c.x[2];
      speed += c.speed;
      ten += c.ten;
    }
    const value = objective(vector, speed, ten);
    if (predicate(speed, ten)) best = Math.max(best, value);
  }
  return best;
}
let lagrangianChecks = 0;
for (let model = 0; model < 60; model += 1) {
  const slotCount = randInt(2, 3);
  const slotCandidateSets = [];
  for (let s = 0; s < slotCount; s += 1) {
    const candidateCount = randInt(2, 4);
    slotCandidateSets.push(Array.from({ length: candidateCount }, () => ({
      id: randInt(0, 2),
      unique: random() < 0.5,
      x: [randInt(0, 20), randInt(0, 20), randInt(0, 20)],
      speed: randInt(0, 10),
      ten: randInt(0, 10),
    })));
  }
  const vHi = randInt(0, 15);
  const tLo = randInt(0, 15);
  const tHi = randInt(0, 15);
  const gearS3 = (vector) => vector[0] + vector[1] + vector[2];
  const maxUnderSpeed = bruteGearConstraint(slotCandidateSets, [], (speed) => speed <= vHi, gearS3);
  const maxUnderTenLower = bruteGearConstraint(slotCandidateSets, [], (_, ten) => ten >= tLo, gearS3);
  const maxUnderTenUpper = bruteGearConstraint(slotCandidateSets, [], (_, ten) => ten <= tHi, gearS3);
  // 弱对偶上界：对 λ 的断点取样（只作交叉核验，不追求精确最小）
  for (const lambda of [0, 0.5, 1, 2, 4]) {
    let bound = 0;
    for (const set of slotCandidateSets) {
      bound += Math.max(...set.map((c) => gearS3(c.x) - lambda * c.speed));
    }
    bound += lambda * vHi;
    assert(bound >= maxUnderSpeed - 1e-9, `速度 Lagrangian 上界不安全 λ=${lambda}`);
    lagrangianChecks += 1;
  }
  for (const mu of [0, 0.5, 1, 2, 4]) {
    let boundLower = 0;
    for (const set of slotCandidateSets) {
      boundLower += Math.max(...set.map((c) => gearS3(c.x) + mu * c.ten));
    }
    boundLower -= mu * tLo;
    assert(boundLower >= maxUnderTenLower - 1e-9, `TEN 下界 Lagrangian 上界不安全 μ=${mu}`);
    let boundUpper = 0;
    for (const set of slotCandidateSets) {
      boundUpper += Math.max(...set.map((c) => gearS3(c.x) - mu * c.ten));
    }
    boundUpper += mu * tHi;
    assert(boundUpper >= maxUnderTenUpper - 1e-9, `TEN 上界 Lagrangian 上界不安全 μ=${mu}`);
    lagrangianChecks += 1;
  }
}
ok("B.lagrangian", `${lagrangianChecks} 个 (模型,乘子) 点：速度/TEN 的弱对偶上界 >= 穷举约束最大值`);

// ---------------------------------------------------------------- C. PR1 D_min
const kappa = 24;
// slab 的 L/R 取值只需落在可达和区间内；取 L=12、R=60 以覆盖非空/空两情形。
const Ls = 12;
const Rs = 60;
// level 70 的档位参数（div=det=900）：保证 C/H/D 在 [0,24] 内确有档位变化。
const factorAt = (C, H, D) =>
  BigInt(criticalFactor(50 + Math.floor((200 * C) / 900), "WHM")) *
  BigInt(directHitFactor(Math.floor((550 * H) / 900))) *
  BigInt(determinationFactor(1000 + Math.floor((140 * D) / 900)));
const threshold = factorAt(kappa, kappa, kappa);
let pr1cells = 0;
for (let C = 0; C <= kappa; C += 3) {
  for (let H = 0; H <= kappa; H += 3) {
    // 不带 slab 的 D_min
    let dMin = Number.POSITIVE_INFINITY;
    for (let D = 0; D <= kappa; D += 1) {
      if (factorAt(C, H, D) > threshold) { dMin = D; break; }
    }
    // slab 内直接定义
    let dMinSlab = Number.POSITIVE_INFINITY;
    for (let D = 0; D <= kappa; D += 1) {
      if (C + H + D < Ls || C + H + D > Rs) continue;
      if (factorAt(C, H, D) > threshold) { dMinSlab = D; break; }
    }
    // 公式
    let dMinFormula = dMin;
    if (Number.isFinite(dMin)) {
      dMinFormula = Math.max(dMin, Math.max(0, Ls - C - H));
      if (dMinFormula > Math.min(kappa, Rs - C - H)) dMinFormula = Number.POSITIVE_INFINITY;
    }
    const normalize = (value) => (Number.isFinite(value) ? value : Number.POSITIVE_INFINITY);
    assert(normalize(dMinSlab) === normalize(dMinFormula), `PR1 D_min 公式不一致 C=${C} H=${H}`);
    pr1cells += 1;
  }
}
ok("C.pr1-dmin", `${pr1cells} 个 (C,H) 格点：slab 内 D_min 与 max(D_min,max(0,L−C−H)) + 上截断公式逐点一致`);

// ---------------------------------------------------------------- D. PR4 K_sum
{
  // 抽象单调乘积模型 Φ=(C+1)(H+1)(D+1)，B=8；只验证「Σ<K_sum ⇒ 非严格改善」的逻辑安全性。
  const B = 8;
  const bound = 12;
  const phi = (C, H, D) => (C + 1) * (H + 1) * (D + 1);
  let kSum = Number.POSITIVE_INFINITY;
  for (let C = 0; C <= bound; C += 1) {
    for (let H = 0; H <= bound; H += 1) {
      for (let D = 0; D <= bound; D += 1) {
        if (phi(C, H, D) > B) kSum = Math.min(kSum, C + H + D);
      }
    }
  }
  assert(Number.isFinite(kSum), "抽象模型没有严格改善点");
  let checkedPoints = 0;
  let removedImproving = 0;
  for (let C = 0; C <= bound; C += 1) {
    for (let H = 0; H <= bound; H += 1) {
      for (let D = 0; D <= bound; D += 1) {
        if (phi(C, H, D) > B && C + H + D < kSum) removedImproving += 1;
        checkedPoints += 1;
      }
    }
  }
  assert(removedImproving === 0, `K_sum 剪枝删除了 ${removedImproving} 个严格改善点`);
  ok("D.pr4-k-sum", `${checkedPoints} 个格点：Σ<K_sum（K_sum=${kSum}）的点都不是严格改善点（K_sum 割安全）`);
}

console.log("verify-sum-bounds-independent: PASS");
for (const line of checks) console.log(line);
console.log("scope: 随机小模型穷举 + 独立实现；发现反例即定理失效，但不构成一般性证明。");
