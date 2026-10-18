/**
 * verify-canonical-model.mjs
 *
 * 目的：把 canonical-evaluator-reference.md §2-§4 的整数模型与**生产代码**逐点对照。
 *
 * 覆盖范围（完整定义域）：
 *   - 全部支持等级 L = {50, 60, 70, 80, 90, 100}（即 jobLevelModifiers 的全部键）
 *   - 全部职业（生成数据 jobSchemas 的全部键，含 BLU）
 *   - 属性 {CRT, DHT, DET, TEN}
 *   - 贡献 g ∈ [0, G_MAX]，G_MAX = 3000（逐点，不抽样）
 *   - 因子对照：CRT/DHT/DET 三元组在网格上逐点对照
 *
 * 证明作用：在有限域上排除「整数模型与 canonical evaluator 不一致」。它**不能**替代
 * 一般性证明；一般性证明在 theorems/raw-tier-transform/README.md 与
 * theorems/tier-log-curvature/README.md。
 *
 * 运行：node --experimental-strip-types docs/mathematical-analysis/verification/verify-canonical-model.mjs
 */
import {
  DOCUMENTED_LEVEL_PARAMS,
  assert,
  ceilDiv,
  criticalFactor,
  directHitFactor,
  determinationFactor,
  firstContributionWithTierAtLeast,
  floorDiv,
  gcd,
  loadCanonicalEvaluator,
  loadGameData,
  tier,
  tierParameters,
  tierPeriod,
} from "./canonical-model.mjs";

const G_MAX = 3000;
const STATS = ["CRT", "DHT", "DET", "TEN"];
const report = [];

function record(name, detail) {
  report.push({ name, detail });
}

const data = await loadGameData();
const canonical = await loadCanonicalEvaluator();

// ---------------------------------------------------------------- 1. 等级参数
const levelKeys = Object.keys(data.jobLevelModifiers).map(Number).sort((a, b) => a - b);
const documentedKeys = Object.keys(DOCUMENTED_LEVEL_PARAMS).map(Number).sort((a, b) => a - b);
assert(
  levelKeys.join(",") === documentedKeys.join(","),
  `支持等级集合变化：数据 ${levelKeys} vs 文档 ${documentedKeys}`,
);
for (const level of levelKeys) {
  const actual = data.jobLevelModifiers[level];
  const documented = DOCUMENTED_LEVEL_PARAMS[level];
  for (const key of ["main", "sub", "div", "det", "detTrunc"]) {
    assert(
      actual[key] === documented[key],
      `等级 ${level} 的 ${key} 变化：数据 ${actual[key]} vs 文档 ${documented[key]}`,
    );
  }
}
record("level-parameters", `${levelKeys.length} 个等级参数与文档一致`);

// ------------------------------------------------------- 2. 基础属性归约（g=0）
const jobs = Object.keys(data.jobSchemas);
let reductionChecks = 0;
for (const job of jobs) {
  const maxLevel = data.jobSchemas[job].maxJobLevel;
  assert(levelKeys.includes(maxLevel), `职业 ${job} 的上限等级 ${maxLevel} 不在支持集合内`);
  for (const stat of STATS) {
    const modelAtZero = tier(maxLevel, job, stat, 0);
    const canonicalAtZero = canonical.equippedAttributeTier(job, maxLevel, stat, 0);
    assert(
      modelAtZero === canonicalAtZero,
      `基础属性归约在 ${job}/${maxLevel}/${stat} 处不一致：模型 ${modelAtZero} vs canonical ${canonicalAtZero}`,
    );
    reductionChecks += 1;
  }
}
record("base-stat-reduction", `${reductionChecks} 个 (job,level,stat) 的 g=0 档位一致`);

// ------------------------------------------------- 3. 档位模型 vs canonical（逐点）
let tierChecks = 0;
const mismatches = [];
for (const level of levelKeys) {
  for (const job of jobs) {
    if (maxLevelOf(data, job) < level) continue; // 公式等级可以高于职业上限（同步），仍然合法
    for (const stat of STATS) {
      for (let g = 0; g <= G_MAX; g += 1) {
        const model = tier(level, job, stat, g);
        const actual = canonical.equippedAttributeTier(job, level, stat, g);
        tierChecks += 1;
        if (model !== actual && mismatches.length < 10) {
          mismatches.push({ level, job, stat, g, model, actual });
        }
      }
    }
  }
}
assert(mismatches.length === 0, `档位不一致样例：${JSON.stringify(mismatches)}`);
record("tier-model", `${tierChecks} 个 (level,job,stat,g) 逐点一致`);

function maxLevelOf(gameData, job) {
  return gameData.jobSchemas[job].maxJobLevel;
}

// --------------------------------------------------- 4. 因子对照（canonical evaluator）
let factorChecks = 0;
let bluSkipped = false;
for (const level of levelKeys) {
  for (const job of jobs) {
    const statIndexes = new Map([
      ["CRT", 0],
      ["DHT", 1],
      ["DET", 2],
    ]);
    let evaluate;
    try {
      evaluate = canonical.createIntegerDamageFactorEvaluator(job, level, statIndexes);
    } catch {
      continue; // 职业/等级组合不允许（不会发生），保守跳过
    }
    for (const crt of [0, 1, 37, 200, 511, 1000, 1750, G_MAX]) {
      for (const dht of [0, 41, 333, 900, 1800, G_MAX]) {
        for (const det of [0, 23, 450, 1200, 2400, G_MAX]) {
          let factors;
          try {
            factors = evaluate([crt, dht, det]);
          } catch {
            bluSkipped = true;
            continue;
          }
          assert(factors !== undefined, `因子求值返回 undefined：${job}/${level}`);
          const expectedCritical = criticalFactor(tier(level, job, "CRT", crt), job);
          const expectedDirectHit = directHitFactor(tier(level, job, "DHT", dht));
          const expectedDetermination = determinationFactor(tier(level, job, "DET", det));
          assert(
            factors.critical === expectedCritical,
            `critical 不一致 ${job}/${level}/${crt}: ${factors.critical} vs ${expectedCritical}`,
          );
          assert(
            factors.directHit === expectedDirectHit,
            `directHit 不一致 ${job}/${level}/${dht}: ${factors.directHit} vs ${expectedDirectHit}`,
          );
          assert(
            factors.determination === expectedDetermination,
            `determination 不一致 ${job}/${level}/${det}: ${factors.determination} vs ${expectedDetermination}`,
          );
          assert(factors.critical > 0 && factors.directHit > 0 && factors.determination > 0,
            "因子必须为正");
          factorChecks += 1;
        }
      }
    }
  }
}
record("factors", `${factorChecks} 个 (level,job,CRT,DHT,DET) 因子逐点一致${bluSkipped ? "（BLU 武器伤害查表越界的点已跳过）" : ""}`);

// ------------------------------------------------------- 5. 截断语义与负值域警告
// g >= 0 时 canonical 的 Math.trunc(v + 1e-7) 与精确 floor 一致（由第 3 项覆盖）。
// g < 0 时不保证一致；给出具体反例，说明为何定义域必须限制为 g >= 0。
const negativeExample = { level: 70, job: "WHM", stat: "CRT", g: -450 };
const canonicalNegative = canonical.equippedAttributeTier(
  negativeExample.job,
  negativeExample.level,
  negativeExample.stat,
  negativeExample.g,
);
const exactFloorNegative = tier(
  negativeExample.level,
  negativeExample.job,
  negativeExample.stat,
  negativeExample.g,
);
assert(
  canonicalNegative !== exactFloorNegative,
  `负贡献反例失效：canonical ${canonicalNegative} vs exact floor ${exactFloorNegative}`,
);
record(
  "trunc-domain-warning",
  `定义域外输入 g=${negativeExample.g} 时 canonical=${canonicalNegative}，精确 floor=${exactFloorNegative}；` +
    "正式候选路径不会产生负贡献（见 §2.2 结构性结论与本脚本第 7 节），故该差异不可达，仅作导出 API 稳健性说明",
);

// --------------------------------------- 6. 阈值公式 / 跳档成本 / 周期（有限范围）
const thresholdChecks = [];
for (const level of levelKeys) {
  for (const job of jobs) {
    for (const stat of ["CRT", "DHT", "DET"]) {
      const params = tierParameters(level, job, stat);
      const { period, shift } = tierPeriod(level, job, stat);
      // 6a 周期：t(g + P) = t(g) + shift
      for (let g = 0; g <= 500; g += 1) {
        assert(
          tier(level, job, stat, g + period) === tier(level, job, stat, g) + shift,
          `周期性质失败 ${level}/${job}/${stat} g=${g}`,
        );
      }
      // 6b 阈值公式：g_k = ceil(((k-c)/mult * q - b)/a)，并检查最小性
      const firstK = tier(level, job, stat, 0);
      const mult = params.mult;
      for (let offset = 0; offset <= 40; offset += 1) {
        const k = firstK + offset * mult;
        const predicted = firstContributionWithTierAtLeast(level, job, stat, k);
        assert(
          predicted >= 0,
          `阈值公式给出负贡献 ${level}/${job}/${stat} k=${k}: ${predicted}`,
        );
        assert(
          tier(level, job, stat, predicted) >= k,
          `阈值不满足 t(g_k)>=k ${level}/${job}/${stat} k=${k}`,
        );
        assert(
          predicted === 0 || tier(level, job, stat, predicted - 1) < k,
          `阈值不是最小 ${level}/${job}/${stat} k=${k}`,
        );
        thresholdChecks.push(1);
      }
      // 6c 跳档成本公式 c_k = floor(q/a) + [s + (q mod a) >= a]
      const a = params.a;
      const q = params.q;
      for (let offset = 0; offset <= 40; offset += 1) {
        const n = firstK + offset * mult; // 当前 inner floor 值
        const k = n;
        const gk = firstContributionWithTierAtLeast(level, job, stat, k);
        const gkNext = firstContributionWithTierAtLeast(level, job, stat, k + mult);
        const actualCost = gkNext - gk;
        const innerN = ceilDiv(k - params.c, mult);
        const s = (((innerN * q - params.b + a - 1) % a) + a) % a;
        const predictedCost = floorDiv(q, a) + (s + (q % a) >= a ? 1 : 0);
        assert(
          actualCost === predictedCost,
          `跳档成本公式失败 ${level}/${job}/${stat} k=${k}: 实际 ${actualCost} vs 公式 ${predictedCost}`,
        );
      }
    }
  }
}
record("thresholds-and-jumps", `${thresholdChecks.length} 个阈值/跳档成本点与闭式公式一致`);

// ------------------------------------------------- 7. 窗口档位增益引理（有限证书）
let windowChecks = 0;
for (const level of levelKeys) {
  for (const job of ["WHM", "BLU"]) {
    for (const stat of ["CRT", "DHT", "DET"]) {
      const params = tierParameters(level, job, stat);
      for (let g = 0; g <= 300; g += 1) {
        const residue = (((params.a * g + params.b) % params.q) + params.q) % params.q;
        for (const delta of [0, 1, 2, 5, 17, 100]) {
          const actualGain = tier(level, job, stat, g + delta) - tier(level, job, stat, g);
          const predictedGain = params.mult * floorDiv(residue + params.a * delta, params.q);
          assert(
            actualGain === predictedGain,
            `窗口增益引理失败 ${level}/${job}/${stat} g=${g} delta=${delta}`,
          );
          windowChecks += 1;
        }
      }
    }
  }
}
record("window-gain-lemma", `${windowChecks} 个 (level,job,stat,g,delta) 点符合 t(g+δ)-t(g)=mult*floor((r+aδ)/q)`);

// ------------------- 7. 可达域内档位实参非负（结构性结论的有限证书）
// 三属性在 canonical 中按 value = baseStat + 贡献 计算；由 baseStat(CRT/DHT/TEN)=sub、
// baseStat(DET)=main（§2.1），floor 实参 = a*g/q + c（DET 为 (140g+1000det)/(det*detTrunc)）。
// 只要候选贡献 g >= 0，实参即 >= 0；本节点同时核对数据/构造侧的贡献非负性。
const negativeData = [];
const dataMinima = {
  gearStat: Number.POSITIVE_INFINITY,
  customParameterValue: Number.POSITIVE_INFINITY,
  materiaValue: Number.POSITIVE_INFINITY,
  foodStat: Number.POSITIVE_INFINITY,
  foodStatRate: Number.POSITIVE_INFINITY,
  bluWeaponAddition: Number.POSITIVE_INFINITY,
};
for (const gear of data.gears) {
  for (const value of Object.values(gear.stats ?? {})) {
    if (typeof value !== "number") continue;
    dataMinima.gearStat = Math.min(dataMinima.gearStat, value);
    if (value < 0) negativeData.push({ where: `gear ${gear.id} stats`, value });
  }
  for (const parameter of gear.customParameters ?? []) {
    for (const value of [parameter.bigValue, parameter.smallValue]) {
      dataMinima.customParameterValue = Math.min(dataMinima.customParameterValue, value);
      if (value < 0) negativeData.push({ where: `gear ${gear.id} customParameters`, value });
    }
  }
}
for (const values of Object.values(data.materias ?? {})) {
  for (const value of values) {
    dataMinima.materiaValue = Math.min(dataMinima.materiaValue, value);
    if (value < 0) negativeData.push({ where: "materias", value });
  }
}
for (const addition of data.bluMdmgAdditions ?? []) {
  dataMinima.bluWeaponAddition = Math.min(dataMinima.bluWeaponAddition, addition);
  if (addition < 0) negativeData.push({ where: "bluMdmgAdditions", value: addition });
}
for (const food of data.foods) {
  for (const value of Object.values(food.stats ?? {})) {
    if (typeof value !== "number") continue;
    dataMinima.foodStat = Math.min(dataMinima.foodStat, value);
    if (value < 0) negativeData.push({ where: `food ${food.id} stats`, value });
  }
  for (const value of Object.values(food.statRates ?? {})) {
    if (typeof value !== "number") continue;
    dataMinima.foodStatRate = Math.min(dataMinima.foodStatRate, value);
    if (value < 0) negativeData.push({ where: `food ${food.id} statRates`, value });
  }
}
assert(
  negativeData.length === 0,
  `生成数据出现负贡献（定义域假设 A8 失效）：${JSON.stringify(negativeData.slice(0, 5))}`,
);

// 档位实参 V(g) 关于 g 单调不减（a > 0），故可达域最小值在 g = 0 取得；
// 用精确有理数比较 V(0) = b/q + c >= 0。
let argumentChecks = 0;
const argumentMinima = {};
for (const level of levelKeys) {
  for (const job of jobs) {
    for (const stat of STATS) {
      const { a, b, q, c } = tierParameters(level, job, stat);
      assert(a > 0 && q > 0, `档位参数非正：${level}/${job}/${stat}`);
      const numerator = BigInt(b) + BigInt(c) * BigInt(q);
      assert(numerator >= 0n, `档位实参最小值 < 0：${level}/${job}/${stat} -> ${numerator}/${q}`);
      const key = `${level}/${job === "BLU" ? "BLU" : "普通"}/${stat}`;
      argumentMinima[key] = `${numerator}/${q}`;
      argumentChecks += 1;
    }
  }
}
let globalArgumentMinimum = null;
for (const [key, value] of Object.entries(argumentMinima)) {
  const [numerator, denominator] = value.split("/").map(Number);
  const ratio = numerator / denominator;
  if (globalArgumentMinimum === null || ratio < globalArgumentMinimum.ratio) {
    globalArgumentMinimum = { key, ratio, value };
  }
}
record(
  "reachable-domain-nonnegativity",
  `数据侧最小值 ${JSON.stringify(dataMinima)}（全部 >= 0）；` +
    `${argumentChecks} 个 (level,blu,stat) 的档位实参最小值 V(0) = b/q + c >= 0，` +
    `全局最小为 ${globalArgumentMinimum.value}（${globalArgumentMinimum.key}）——即普通 DHT 在贡献 0 处的实参 0`,
);

// ------------------------------------------------------------------ 输出报告
const stat = {
  tiers: tierChecks,
  factors: factorChecks,
  thresholds: thresholdChecks.length,
  windows: windowChecks,
};
console.log("canonical-model verification: PASS");
for (const entry of report) console.log(`  [ok] ${entry.name}: ${entry.detail}`);
console.log(`  checks: ${JSON.stringify(stat)}`);
console.log(
  "scope: 全部支持等级 × 全部职业 × 指定属性 × g∈[0," + G_MAX + "]，逐点对照生产 evaluator。",
);
console.log("这不是一般性证明；一般性证明见 theorems/ 下对应 README。");
