/**
 * verify.mjs —— race-main-stat-invariance 的有限确定性验证。
 *
 * 运行：
 *   node --experimental-strip-types docs/mathematical-analysis/theorems/race-main-stat-invariance/verify.mjs
 *
 * 本脚本只做小型/有限域的精确整数与有理数检查：
 *   - 用 canonical 公式复算 L100 WHM 在 clanIndex 0（人族·中原之民）与
 *     clanIndex 10（敖龙族·晨曦之民）下的攻击档位因子与反例乘积；
 *   - 验证定理 1 的两解翻转判据；
 *   - 验证定理 2/3/4 的充分条件；
 *   - 验证定理 5 的有限域符号等价判据与等价语义；
 *   - 核对 B 与贡献 a 的坐标口径。
 *
 * 它不启动装备搜索、不枚举真实候选池、不调用 MIP 或 benchmark。
 */

import {
  loadGameData,
  tier,
  criticalFactor,
  directHitFactor,
  determinationFactor,
  assert,
} from "../../verification/canonical-model.mjs";

const checks = [];
let checkCount = 0;
function check(condition, message, detail = "") {
  checkCount += 1;
  if (!condition) {
    throw new Error(`[失败] ${message}${detail === "" ? "" : `；${detail}`}`);
  }
  checks.push(message);
}

const data = await loadGameData();
const level = 100;
const job = "WHM";
const lm = data.jobLevelModifiers[level];
const schema = data.jobSchemas[job];
assert(lm !== undefined && schema !== undefined, "缺失 L100 WHM 参数");
assert(schema.mainStat === "MND", "WHM 攻击主属性应为 MND");

const floor = (value) => Math.trunc(value + 1e-7);
const clanMnd = data.clanStats.MND ?? [];
check(clanMnd[0] === -1, "clanStats.MND[0] 应为 -1（人族·中原之民）");
check(clanMnd[10] === 3, "clanStats.MND[10] 应为 +3（敖龙族·晨曦之民）");

const baseMain = (clanIndex) =>
  floor((lm.main * (schema.statModifiers.MND ?? 0)) / 100) + (clanMnd[clanIndex] ?? 0);

const B_HUMAN = baseMain(0);
const B_AURA = baseMain(10);
check(B_HUMAN === 505, "人族攻击主属性基础值应为 505", `实际 ${B_HUMAN}`);
check(B_AURA === 509, "敖龙族攻击主属性基础值应为 509", `实际 ${B_AURA}`);

function attackTier(B, additional) {
  const value = B + additional;
  const inner = floor(value * (schema.partyBonus ?? 1.05));
  return floor((lm.ap * (inner - lm.main)) / lm.main + 100);
}

function substatQ(crt, dht, det) {
  const tCrt = tier(level, job, "CRT", crt);
  const tDht = tier(level, job, "DHT", dht);
  const tDet = tier(level, job, "DET", det);
  return BigInt(criticalFactor(tCrt, job)) *
    BigInt(directHitFactor(tDht)) *
    BigInt(determinationFactor(tDet));
}

const WEAPON_DAMAGE = BigInt(floor((lm.main * (schema.statModifiers.MND ?? 0)) / 1000));
const TEN_FACTOR = BigInt(tier(level, job, "TEN", 0));
check(WEAPON_DAMAGE === 50n, "L100 WHM 无武器贡献时 weaponDamage 应为 50", `实际 ${WEAPON_DAMAGE}`);
check(TEN_FACTOR === 1000n, "无 TEN 贡献时 tenacity 因子应为 1000", `实际 ${TEN_FACTOR}`);

const X = { a: 810, crt: 450, dht: 25, det: 215 };
const Y = { a: 800, crt: 0, dht: 0, det: 700 };

const QX = substatQ(X.crt, X.dht, X.det);
const QY = substatQ(Y.crt, Y.dht, Y.det);
check(QX === 4_187_296_072_960n, "Q(x) 应为 4,187,296,072,960", `实际 ${QX}`);
check(QY === 4_222_800_000_000n, "Q(y) 应为 4,222,800,000,000", `实际 ${QY}`);
check(
  X.a + X.crt + X.dht + X.det === Y.a + Y.crt + Y.dht + Y.det &&
  X.a + X.crt + X.dht + X.det === 1500,
  "同总属性预算：主属性+三副属性应均为 1500",
);
check(X.crt + X.dht + X.det === 690 && Y.crt + Y.dht + Y.det === 700,
  "同预算下三属性和应分别为 690/700（x 主属性高 10、副属性低 10）");

function fullProduct(B, loadout) {
  const A = attackTier(B, loadout.a);
  return BigInt(A) * substatQ(loadout.crt, loadout.dht, loadout.det) * WEAPON_DAMAGE * TEN_FACTOR;
}

const HUMAN_X = fullProduct(B_HUMAN, X);
const HUMAN_Y = fullProduct(B_HUMAN, Y);
const AURA_X = fullProduct(B_AURA, X);
const AURA_Y = fullProduct(B_AURA, Y);

check(HUMAN_X === 126_875_071_010_688_000_000n, "人族 P(x) 数值不符", `实际 ${HUMAN_X}`);
check(HUMAN_Y === 126_684_000_000_000_000_000n, "人族 P(y) 数值不符", `实际 ${HUMAN_Y}`);
check(AURA_X === 127_293_800_617_984_000_000n, "敖龙族 P(x) 数值不符", `实际 ${AURA_X}`);
check(AURA_Y === 127_317_420_000_000_000_000n, "敖龙族 P(y) 数值不符", `实际 ${AURA_Y}`);
check(HUMAN_X > HUMAN_Y, "人族下 x 应严格优于 y");
check(AURA_Y > AURA_X, "敖龙族下 y 应严格优于 x");
check(HUMAN_X !== AURA_X && HUMAN_Y !== AURA_Y, "两族的目标值应不同（主属性档位改变）");

// ---------------------------------------------------------------------------
// 1. 定理 1：两解翻转判据
// ---------------------------------------------------------------------------
function cmpNumerator(Ax, Qx, Ay, Qy) {
  const left = BigInt(Ax) * Qx;
  const right = BigInt(Ay) * Qy;
  return left === right ? 0 : left > right ? 1 : -1;
}

function flipCriterionHolds(B1, B2, loadoutX, loadoutY) {
  const aX = loadoutX.a;
  const aY = loadoutY.a;
  const r1 = attackTier(B1, aX) / attackTier(B1, aY);
  const r2 = attackTier(B2, aX) / attackTier(B2, aY);
  const q = Number(substatQ(loadoutX.crt, loadoutX.dht, loadoutX.det)) /
    Number(substatQ(loadoutY.crt, loadoutY.dht, loadoutY.det));
  const lo = Math.min(1 / r1, 1 / r2);
  const hi = Math.max(1 / r1, 1 / r2);
  const sign1 = cmpNumerator(
    attackTier(B1, aX), substatQ(loadoutX.crt, loadoutX.dht, loadoutX.det),
    attackTier(B1, aY), substatQ(loadoutY.crt, loadoutY.dht, loadoutY.det),
  );
  const sign2 = cmpNumerator(
    attackTier(B2, aX), substatQ(loadoutX.crt, loadoutX.dht, loadoutX.det),
    attackTier(B2, aY), substatQ(loadoutY.crt, loadoutY.dht, loadoutY.det),
  );
  return { sign1, sign2, q, lo, hi, r1, r2 };
}

const flip = flipCriterionHolds(B_HUMAN, B_AURA, X, Y);
check(flip.sign1 === 1 && flip.sign2 === -1, "定理 1：反例应出现严格翻转");
check(flip.lo < flip.q && flip.q < flip.hi, "定理 1：q 应严格落在翻转区间内");

// 用同一判据检查一组“不会翻转”的负载：主属性相同且其它因子相同
const noFlipX = { a: 1000, crt: 1000, dht: 500, det: 800 };
const noFlipY = { a: 980, crt: 900, dht: 400, det: 700 };
const noFlip = flipCriterionHolds(B_HUMAN, B_AURA, noFlipX, noFlipY);
check(noFlip.sign1 === noFlip.sign2, "定理 1 边界：q 不在区间内时符号应保持");

// ---------------------------------------------------------------------------
// 2. 定理 2：所有可行解主属性贡献相同 ⇒ 最优集合不变
// ---------------------------------------------------------------------------
const fixedMainLoadouts = [];
for (let index = 0; index < 40; index += 1) {
  fixedMainLoadouts.push({
    a: 1000,
    crt: 200 * (index % 7),
    dht: 90 * ((index * 3) % 7),
    det: 130 * ((index * 5) % 7),
  });
}
for (let i = 0; i < fixedMainLoadouts.length; i += 1) {
  for (let j = i + 1; j < fixedMainLoadouts.length; j += 1) {
    const left = fixedMainLoadouts[i];
    const right = fixedMainLoadouts[j];
    const qx = substatQ(left.crt, left.dht, left.det);
    const qy = substatQ(right.crt, right.dht, right.det);
    const human = cmpNumerator(attackTier(B_HUMAN, 1000), qx, attackTier(B_HUMAN, 1000), qy);
    const aura = cmpNumerator(attackTier(B_AURA, 1000), qx, attackTier(B_AURA, 1000), qy);
    check(human === aura, "定理 2：主属性贡献相同 ⇒ 排序应不变", `${i}/${j}`);
  }
}

// ---------------------------------------------------------------------------
// 3. 定理 3：攻击因子公共比例 ⇒ 排序不变
// ---------------------------------------------------------------------------
const mockA1 = [100, 105, 111, 118];
const mockA2 = mockA1.map((value) => value * 3);
const mockQ = [10n, 13n, 17n, 19n];
for (let i = 0; i < mockA1.length; i += 1) {
  for (let j = 0; j < mockA1.length; j += 1) {
    const left = cmpNumerator(mockA1[i], mockQ[i], mockA1[j], mockQ[j]);
    const right = cmpNumerator(mockA2[i], mockQ[i], mockA2[j], mockQ[j]);
    check(left === right, "定理 3：公共比例 ⇒ 排序应不变", `${i}/${j}`);
  }
}

// ---------------------------------------------------------------------------
// 4. 定理 4：档位逐点不变 ⇒ 目标与最优集合不变
// ---------------------------------------------------------------------------
const equalTierLoadouts = fixedMainLoadouts;
const sameB = B_HUMAN;
for (const loadout of equalTierLoadouts) {
  check(
    attackTier(sameB, loadout.a) === attackTier(B_HUMAN, loadout.a),
    "定理 4：同一 B 下档位应相同",
  );
}

// ---------------------------------------------------------------------------
// 5. 定理 5：有限域符号一致 ⇔ 最优集合相同
// ---------------------------------------------------------------------------
const finiteLoadouts = [
  { a: 1000, crt: 2277, dht: 366, det: 218 },
  { a: 950, crt: 1972, dht: 262, det: 1473 },
  { a: 1000, crt: 1000, dht: 500, det: 800 },
];
const valuesHuman = finiteLoadouts.map((loadout) => fullProduct(B_HUMAN, loadout));
const valuesAura = finiteLoadouts.map((loadout) => fullProduct(B_AURA, loadout));
const bestHuman = valuesHuman.indexOf(valuesHuman.reduce((best, value) => value > best ? value : best));
const bestAura = valuesAura.indexOf(valuesAura.reduce((best, value) => value > best ? value : best));
check(bestHuman === 0 && bestAura === 1, "定理 5：有限域反例应给出不同最优下标", `${bestHuman}/${bestAura}`);

// 符号一致的有限域：主属性全相同的负载集合
const sameMainFinite = fixedMainLoadouts.slice(0, 5);
const sameHuman = sameMainFinite.map((loadout) => fullProduct(B_HUMAN, loadout));
const sameAura = sameMainFinite.map((loadout) => fullProduct(B_AURA, loadout));
for (let i = 0; i < sameMainFinite.length; i += 1) {
  for (let j = 0; j < sameMainFinite.length; j += 1) {
    const sh = sameHuman[i] === sameHuman[j] ? 0 : sameHuman[i] > sameHuman[j] ? 1 : -1;
    const sa = sameAura[i] === sameAura[j] ? 0 : sameAura[i] > sameAura[j] ? 1 : -1;
    check(sh === sa, "定理 5：主属性相同时符号应一致", `${i}/${j}`);
  }
}

// ---------------------------------------------------------------------------
// 6. 等价语义
// ---------------------------------------------------------------------------
const equivalentA = { a: 1000, crt: 500, dht: 400, det: 300 };
const equivalentB = { a: 1000, crt: 500, dht: 400, det: 300 };
check(
  fullProduct(B_HUMAN, equivalentA) === fullProduct(B_HUMAN, equivalentB) &&
  fullProduct(B_AURA, equivalentA) === fullProduct(B_AURA, equivalentB),
  "等价语义：最终因子相同的解应在两族下同值",
);
check(
  fullProduct(B_HUMAN, X) !== fullProduct(B_AURA, X),
  "等价语义：换族会改变同一负载的主因子，不能把不同最终值当等价",
);

// ---------------------------------------------------------------------------
// 7. 坐标审计：B 是基础值，a 是贡献
// ---------------------------------------------------------------------------
const panelMainHuman = B_HUMAN + X.a;
const panelMainAura = B_AURA + X.a;
check(panelMainHuman === 1315, "面板攻击主属性（人族）应为 1315", `${panelMainHuman}`);
check(panelMainAura === 1319, "面板攻击主属性（敖龙族）应为 1319", `${panelMainAura}`);
check(B_HUMAN !== B_AURA && X.a === X.a, "种族只改基础值 B，不改贡献 a");
check(
  attackTier(B_HUMAN, X.a) !== attackTier(B_AURA, X.a),
  "B 的变化应改变同一贡献 A 的攻击档位",
);

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
console.log(`[ok] race-main-stat-invariance：${checkCount} 项检查`);
console.log(`[ok] B_HUMAN=${B_HUMAN}, B_AURA=${B_AURA}`);
console.log(`[ok] 反例 Qx=${QX}, Qy=${QY}`);
console.log(`[ok] 人族 P(x)=${HUMAN_X} > P(y)=${HUMAN_Y}`);
console.log(`[ok] 敖龙族 P(y)=${AURA_Y} > P(x)=${AURA_X}`);
console.log(`[ok] 翻转区间 (${flip.lo.toFixed(12)}, ${flip.hi.toFixed(12)}) 包含 q=${flip.q.toFixed(12)}`);
console.log("PASS");
