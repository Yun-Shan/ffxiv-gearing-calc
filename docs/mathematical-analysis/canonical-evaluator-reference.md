# Canonical evaluator 参考模型：等级参数、整数档位与精确因子

本文件是 `docs/mathematical-analysis/` 各定理的共同事实基础。它只登记**当前实现**的公式、参数、定义域与源码位置，不替代各定理自己的证明；定理文档引用本文件时，应同时引用下列源码行。

- 抓取日期：2026-10-18（Asia/Shanghai）
- 数据版本：`mcp-2026.09.15.0000.0000-upstream-048376fb6c6c-level-basis-v2`
- 生成数据：`src/data/generated-data.bin`（由 `npm run data:update` 生成，不得手工编辑）

## 0. 约定

- 文中的 `g` 指**装备 + 食物带来的属性贡献**（安全整数，当前候选模型下 `g >= 0`），不是角色面板总值。面板总值 = 基础属性 + `g`，且基础属性恰好等于等级参数里的 `main` / `sub`（见 §2），所以 `g` 就是档位公式真正看到的量。注意：**三属性在 `equipped-effects.ts` 中都是先加 `baseStat` 再减 `sub`/`main`**，因此 `baseStat` 与偏移相等时 `g >= 0` 直接推出档位实参非负（§2.2）；把面板值误当 `g` 会漏掉等级自带的基础属性，换算见 §2.1。
- 所有档位、因子、乘积都是**整数**。凡出现 `floor` 的地方，canonical evaluator 的实现是 `Math.trunc(value + 1e-7)`（`src/domain/search/equipped-effects.ts:163-166`）；本文件登记该语义，等价性证明在 [raw-tier-transform](theorems/raw-tier-transform/README.md)。
- 「严格改善」指精确乘积严格大于 incumbent；「不能改善」指 `<=`，两者语义不同，不可互换（`src/domain/search/exact-mip-candidate-upper-bound.ts:114-140`）。

## 1. 事实来源

| 内容 | 位置 |
| --- | --- |
| 整数档位入口 | `src/domain/search/equipped-effects.ts:110-154`（`equippedAttributeTier`） |
| 精确整数因子入口 | `src/domain/search/equipped-effects.ts:59-104`（`createIntegerDamageFactorEvaluator`） |
| 浮点伤害/GCD 公式 | `src/domain/search/equipped-effects.ts:205-292`（`calculateFromTotalStats`） |
| 截断语义 | `src/domain/search/equipped-effects.ts:163-166`（`floor = Math.trunc(v + 1e-7)`） |
| 基础属性构造 | `src/domain/search/equipped-effects.ts:178-203`（`getBaseStats`） |
| `LevelModifier` 字段 | `src/domain/types.ts:178-189` |
| 数据字段与装载 | `src/domain/data.ts:17-79`（`baseStats`、`clanStats`、`jobSchemas`、`jobLevelModifiers`） |
| 计算等级解析 | `src/domain/job-level.ts`（`jobLevelFor`、`calculationJobLevelFor`） |
| 精确乘积比较 | `src/domain/search/exact-mip-candidate-upper-bound.ts:96-140` |
| 单资源预算拉格朗日上界 | `src/domain/search/factor-resource-budget-upper-bound.ts:88-147` |
| 档位三元组精确预算查询 | `src/domain/search/substat-factor-budget.ts:71-171` |
| 联合单职业必要界 | `src/domain/search/joint-candidate-upper-bound.ts:10-22` |
| 等级参数上游来源 | `reference/ffxiv-gearing/src/game.ts:85-105` |

上游参考实现 `reference/ffxiv-gearing` 的等级参数与生成数据逐项相同；等级 60 的 `det: 600` 在上游带有 `FIXME` 注释，本项目按生成数据原样使用（见 [领域与搜索规则](../rules/领域与搜索规则.md) 对公式完全一致的要求）。

## 2. 等级参数表

`LevelModifier`（`src/domain/types.ts:178-189`）中与本文相关的字段：`main`、`sub`、`div`、`det`、`detTrunc`。生成数据实际支持（即 `jobLevelModifiers` 的键）只有 50、60、70、80、90、100 六档：

| level | main | sub | div | det | detTrunc |
| --- | --- | --- | --- | --- | --- |
| 50 | 202 | 341 | 341 | 202 | 5 |
| 60 | 218 | 354 | 600 | 600 | 2 |
| 70 | 292 | 364 | 900 | 900 | 1 |
| 80 | 340 | 380 | 1300 | 1300 | 1 |
| 90 | 390 | 400 | 1900 | 1900 | 1 |
| 100 | 440 | 420 | 2780 | 2780 | 1 |

- 公式等级由 `calculationJobLevelFor` 解析：不同步时取职业上限（`jobSchema.maxJobLevel`），同步时取 `min(同步品级映射等级, 职业上限)`，所以恒在上述六档内。
- 职业上限：22 个战斗职业为 100，BLU 为 80，BST 为 50（生成数据 `jobSchemas[*].maxJobLevel`）。
- 因此实际会出现的 `(level, detTrunc)` 组合为：50/5、60/2、70/1、80/1、90/1、100/1。

### 2.1 基础属性归约

`equippedAttributeTier` 先取 `value = (baseStats[stat] ?? 0) + gearAndFoodValue`，再减去 `sub` 或 `main`（`src/domain/search/equipped-effects.ts:127-149`）。`getBaseStats`（`:178-203`）的取值规则是：

- 若 `gameData.baseStats[stat]` 是数字，直接用作基础值；
- 若是 `"main"` / `"sub"`，则 `floor(levelMod[kind] * statModifier / 100) + clanStats[stat][0]`。

生成数据中：

- `baseStats` = `{ CRT: "sub", DHT: "sub", DET: "main", TEN: "sub", STR/DEX/INT/MND/VIT/PIE: "main", ... }`；
- `clanStats` 只含 `STR/DEX/VIT/INT/MND`（人族·中原之民取索引 0），**不含** `CRT/DHT/DET/TEN/SKS/SPS`；
- `jobSchemas[*].statModifiers` 不含 `CRT/DHT/DET/TEN/SKS/SPS` 键，故 `?? 100` 缺省生效。

于是对全部职业与全部支持等级：

```text
baseStats.CRT = baseStats.DHT = baseStats.TEN = floor(sub * 100 / 100) + 0 = sub
baseStats.DET = floor(main * 100 / 100) + 0 = main
```

因此 `value - sub`（CRT/DHT/TEN）与 `value - main`（DET）精确等于 `g`，且中间量 `value` 为安全整数。这是 §3 整数模型的第一步，也是「档位只依赖装备+食物贡献」这一结论的来源。**该归约不是定义，而是由当前数据推导出的性质**；若将来 `baseStats`、`clanStats` 或 `statModifiers` 变化，必须重新核验（各定理的验证脚本应覆盖这一点）。

**面板总值与贡献的换算**：面板总值 = 基础属性 + 贡献。对 CRT/DHT/TEN，基础属性恰为 `sub`；对 DET，基础属性恰为 `main`。因此

```text
CRT 贡献 = 面板 CRT - sub
DHT 贡献 = 面板 DHT - sub
DET 贡献 = 面板 DET - main
```

例如 70 级（`main=292`、`sub=364`）评论 01 的面板值 `CRT=739 / DHT=743 / DET=769` 对应贡献 `375 / 379 / 477`，与 canonical 档位 `133 / 231 / 1074` 一致。本目录所有 `g`、阈值、基线、示例都**默认是贡献**，不是面板值；把面板值直接代入档位公式会漏掉等级自带的基础属性。

### 2.2 可达域内档位实参非负（结构性结论）

§3.1 讨论的 `Math.trunc(v+1e-7)` 与精确 `floor` 的差异只在 `v < 0` 时出现。**在真实候选模型下 `v < 0` 不可能发生**，这不是额外假设，而是由「基础属性归约 + 候选贡献非负」推出的：

1. **贡献 `g >= 0`**。候选属性和 = 装备 baseParams 值之和 + 镶嵌值 + 自定义/义军武器分配值 + 食物增益，每一项都非负：
   - 装备属性：生成数据 `gears[*].stats` / `customParameters[*].bigValue/smallValue` 全部 `>= 0`（当前快照最小值分别为 1 与 21）；同步 cap 只做 `min` 截断（`rules.ts:216-246`、`optimizer/equipment-candidates.ts:102-105`），不改变符号；`mergeCandidateStats` 的镶嵌是 `min(cap, base + meld.value)`，魔晶石值 `>= 1`、cap `>= 0`（`optimizer/equipment-candidates.ts:107-131`）；义军分配是步进 1 的非负整数变量，其上界 `Math.max(0, cap - base)`（`optimizer/equipment-candidates.ts:268-278`）；
   - 食物增益：`bonus = min(maxValue, trunc((raw + baseValue) * (multiplier - 1) + 1e-7))`，其中 `raw >= 0`、`baseValue = 基础属性 >= 0`、`multiplier = 1 + statRate/100 >= 1`、`maxValue >= 0`（`optimizer/equipment-candidates.ts:332-350`、`loadout-finder-v3.ts:277-289`、`rules.ts:24-47`）；非负的 `baseValue/multiplier/maxValue` 在读数处被校验，非法值直接拒绝（`exact-mip-candidate-upper-bound.ts:81-92`、`loadout-finder-exact-mip.ts:1041-1047`、`joint-substat-reachability.ts:177-183`）。
2. **档位实参 `v >= 0`**。由 §2.1，`value - sub = g`、`value - main = g`，于是四个分支的 floor 实参为
   ```text
   CRT: 200g/div + 50 + 200β        >= 50
   DHT: 550g/div + 200β             >= 0      （g=0 且普通职业时恰为 0）
   DET: (140g + 1000·det)/(det·detTrunc) = 1000/detTrunc + 140g/(...) >= 200
   TEN: 112g/div + 1000             >= 1000
   ```
   全部 `>= 0`（DHT 可取等号 0），因此 `Math.trunc(v+1e-7) = floor(v)` 在**整个可达域**成立，不需要把 `v >= 0` 当作运行时守卫来满足。
3. **仅定义域外会失效**。能构造 `v < 0` 的只有：给导出的 `equippedAttributeTier` / 向量求值器直接传负贡献；传负的 `FoodParam.baseValue`（生产读取处会拒绝）；或提供自定义 `equipmentAttributeExtractor`（测试/扩展钩子；它一旦存在，canonical 候选上界层会主动禁用，见 `exact-mip-candidate-upper-bound.ts:34`）。这些都不属于正式候选路径，属于**导出 API 稳健性**；各定理仍建议在外部调用边界加断言，但它不是本目录定理正确性的数学前提。

## 3. 整数档位模型

由 `equipped-effects.ts:138-149` 与 §2.1，对 `g >= 0`（单位：属性贡献）：

```text
t_CRT(g) = floor(200 * g / div) + 50 + 200 * [BLU]
t_DHT(g) = floor(550 * g / div) + 200 * [BLU]
t_DET(g) = detTrunc * floor( (140 * g + 1000 * det) / (det * detTrunc) )
t_TEN(g) = floor(112 * g / div) + 1000
```

统一写成 `t(g) = c + floor((a * g + b) / q)`（`a, q > 0`，`b, c` 整数）：

| 属性 | a | b | q | c |
| --- | --- | --- | --- | --- |
| CRT 普通 | 200 | 0 | div | 50 |
| CRT BLU | 200 | 0 | div | 250 |
| DHT 普通 | 550 | 0 | div | 0 |
| DHT BLU | 550 | 0 | div | 200 |
| DET | 140 | 1000·det | det·detTrunc | 0，且整体乘以 `detTrunc` |
| TEN | 112 | 0 | div | 1000 |

逐等级的 `(a, q)` 与周期参数见 [raw-tier-transform](theorems/raw-tier-transform/README.md) 的实例表。

**注意 DET 的两层结构**：`detTrunc > 1` 时档位只取 `detTrunc` 的倍数，且常数 `1000` 在除法**内部**；把 `detTrunc` 合入分母后必须再乘回，不能先乘后除。等级 50、60 会实际触发该分支。

### 3.1 截断语义

canonical evaluator 的 `floor` 是 `Math.trunc(v + 1e-7)`。对 `v >= 0`，`Math.trunc(v + 1e-7) = floor(v)` 当且仅当 `v` 的真值不会因浮点误差跨过整数边界；`+1e-7` 是上游对浮点下溢的容忍项。对 `v < 0` 两者**不等价**（例如真值 `-0.5`：`floor = -1`，`trunc(-0.5 + 1e-7) = 0`）。

**关键**：由 §2.2，真实候选模型下四个副属性分支的 floor 实参恒 `>= 0`（CRT `>= 50`、DHT `>= 0`、DET `>= 200`、TEN `>= 1000`），所以「`v >= 0`」不是需要运行时额外满足的前提，而是**可达域上的结构性事实**；截断等价在可达域内无条件成立。`v < 0` 只能由定义域外输入（负贡献、负食物参数、自定义 extractor）产生，属导出 API 稳健性问题。完整误差界证明见 [raw-tier-transform](theorems/raw-tier-transform/README.md)。

## 4. 精确因子与完整伤害乘积

`createIntegerDamageFactorEvaluator`（`equipped-effects.ts:59-104`）返回：

```text
weaponDamage   = floor(main * statModifiers[attackStat] / 1000) + weaponStat + BLU 武器伤害查表
mainStat       = equippedAttributeTier(job, level, attackStat, g_attack)        （分母 100）
determination  = t_DET(g_DET)                                                   （分母 1000）
tenacity       = t_TEN(g_TEN)                                                   （分母 1000）
critical       = 1_000_000 + t_CRT * (t_CRT + (BLU ? 150 : 350))                （分母 1_000_000）
directHit      = 4000 + t_DHT                                                   （分母 4000）
traitMultiplier, gcdCentiseconds
```

本文只需三个副属性因子：

```text
F_C(t) = 1_000_000 + t * (t + b_C)，b_C = 350（普通）或 150（BLU）
F_H(t) = 4000 + t
F_D(t) = t
```

`exactProduct`（`exact-mip-candidate-upper-bound.ts:108-112`）把 `weaponDamage * mainStat * determination * tenacity * critical * directHit` 用 `BigInt` 相乘；`traitMultiplier` 与各分母对同一职业/等级为常数，因此排序与比较不受影响。DPS 目标额外除以 `gcdCentiseconds`，比较方式为（`exact-mip-candidate-upper-bound.ts:114-140`）：

```text
严格更差   : incumbentProduct * upperGcd  >  upperProduct * incumbentGcd
不能严格改善: upperProduct * incumbentGcd <= incumbentProduct * upperGcd
```

`safeDamageFactors`（`:96-106`）要求七个整数因子都 `> 0`；这说明实现本身就把「正因子」作为前提，任何用到 `log` 或比值交换的定理都必须显式验证该前提。

## 5. 定义域与可达范围

- **贡献域**：`g ∈ Z`，`0 <= g <= G_max`，`G_max` 由当前候选池、同步 cap、魔晶石与食物上界给出，是运行时输入，不是本文件的固定常数。
- **档位域**：`g >= 0` 时 `t_CRT >= 50`（BLU `>= 250`）、`t_DHT >= 0`（BLU `>= 200`）、`t_DET >= 1000`、`t_TEN >= 1000`。
- **贡献与档位实参非负**：由 §2.1 的基础属性归约与 §2.2 的候选贡献非负性，可达域内 `g >= 0` 且四个分支 floor 实参恒 `>= 0`（CRT `>=50`、DHT `>=0`、DET `>=200`、TEN `>=1000`）；`Math.trunc(v+1e-7)=floor(v)` 在可达域无条件成立。
- **因子正性**：`F_C >= 1_000_000`、`F_H >= 4000`、`F_D >= 1000`，在 `g >= 0` 上恒成立。更强的全局性质（`F_C` 对所有整数档位为正）由 [tier-log-curvature](theorems/tier-log-curvature/README.md) 证明。
- **单调性**：`g -> t(g)` 非减（floor 与非减线性函数复合），`t -> F_C/F_H/F_D` 在各自档位域上严格增（除 DET 在 `detTrunc > 1` 时步长为 `detTrunc` 的阶梯），所以 `g -> F(g)` 非减，且在跨档处严格增。严格证明见 [raw-tier-transform](theorems/raw-tier-transform/README.md)。
- **等级/职业限定**：公式与档位只通过 `(level, BLU 标记)` 影响；`b_C` 取 350 或 150，`+200` 档位偏移只对 BLU 生效。职业差异只进入 `baseStats`、武器伤害、主属性、GCD、特性倍率与队伍加成，不进入 `F_C/F_H/F_D`（BLU 的武器伤害查表见 `equipped-effects.ts:445-452`，属完整伤害因子而非副属性因子）。

- **候选池级的和界（搜索层，不是公式级事实）**：三属性贡献和 `S = CRT+DHT+DET` 的安全上/下界依赖候选池、槽位、镶嵌/食物规则与硬约束，不属于固定等级公式；最紧安全上界（含戒指唯一性、食物与约束的 Lagrangian 界、部分分支滚动界）见 [substat-sum-upper-bound](theorems/substat-sum-upper-bound/README.md)，安全下界与剪枝族见 [substat-sum-lower-bound-pruning](theorems/substat-sum-lower-bound-pruning/README.md)。本文件只登记公式级事实，不替代这两篇的候选池依赖论证。

## 6. 与已有上界基础设施的对应

现有实现已提供三类结构，定理必须区分「复用」「收紧」「新增」，避免重复已有单因子/单职业必要条件：

1. **单资源预算拉格朗日上界** `prepareFactorResourceBudgetUpperBound`（`factor-resource-budget-upper-bound.ts:88-147`）：输入每档的 `(min cost, integer log score)`，构造上凸包与支撑线，`query(budget)` 返回整数上界。它是**每个因子独立**的资源预算模型，不含 CRT/DHT/DET 三者的相关结构。
2. **档位三元组精确预算查询** `prepareSubstatFactorBudgetQuery`（`substat-factor-budget.ts:71-171`）：给定 CRT/DET/DHT 三张 `(min, value)` 档位表和预算，返回 `sum(min) <= budget` 下最大乘积。这是把「自由资源松弛」按档位阈值费用精确枚举的实现基础（`U(b,R)` 的精确形式见 [free-budget-upper-bound](theorems/free-budget-upper-bound/README.md) 与 [simplex-vertex-reduction](theorems/simplex-vertex-reduction/README.md)）。注意它假设三属性的费用可加且各自独立达到阈值——这正是自由资源松弛的定义，**不是**真实装备可行域。该模块当前**未接入正式搜索路径**，只作为精确查询与回退基础；正式搜索使用的单资源上界是 `prepareFactorResourceBudgetUpperBound`（`loadout-finder-exact-mip.ts:1267,1353`）。
3. **联合单职业必要界** `candidateUpperBoundCannotImproveJointIncumbent`（`joint-candidate-upper-bound.ts:10-22`）：以 `incumbent - (jobCount - 1)` 为单职业阈值。等价于其余职业损失全部取最乐观值 0；[joint-loss-sum-bound](theorems/joint-loss-sum-bound/README.md) 证明它是损失和判据在 `u_k <= 1` 时的特例。

另外注意 `candidatePareto`、`candidate-resource-support-policy`、`signature-band` 等模块也包含候选层面的界，但它们的定义域是候选/搜索状态而非公式结构；本分析的定理只作用于**公式坐标**（档位、因子、属性贡献），因此不与之冲突，也不替代它们。

## 7. 与 issue 伪代码的差异登记

Issue 正文与评论中的伪代码只作背景。与源码不一致或未覆盖处如下，定理以源码为准：

| 项 | issue 文本 | 源码事实 |
| --- | --- | --- |
| 档位输入 | 直接写 `CRT` / `DHT` / `DET` | 输入是 `baseStats + 贡献`；因 §2.1 才等于贡献 `g` |
| BLU 偏移 | 只说「CRT/DHT 有自己的偏移」 | CRT 常数 `+200`、DHT 常数 `+200`、`b_C = 150` 三处都不同 |
| DET 截断 | `floor(.../detTrunc)*detTrunc` | 常数 `1000` 在除法内部；`detTrunc ∈ {5,2,1}` |
| 截断函数 | 写作 `floor` | 实际 `Math.trunc(v + 1e-7)`；负值域语义不同，但可达域实参恒非负（§2.2），故等价 |
| TEN 因子 | 只在完整乘积中出现名字 | 有独立档位公式 `floor(112g/div + 1000)`；非坦克恒为 1000 |
| 主属性因子 | 未展开 | `floor(ap * (floor(value * partyBonus) - main) / main + 100)`，含 `partyBonus`（1.05，BLU 1.01） |
| 单位预算边际比较 | `(F1*G0)^c1 ? (G1*F0)^c0` | 该式**不等价**于对数比较；正确形式见 [marginal-comparison](theorems/marginal-comparison/README.md) |

## 8. 术语

- **tier 序列**：以档位索引为自变量的序列 `F(t)`。
- **raw 序列**：以属性贡献 `g` 为自变量的序列 `F(t(g))`，含 floor 造成的平台与跳变。
- **档位阈值** `g_k`：使 `t(g) >= k` 成立的最小非负 `g`。
- **跳档成本** `c_k = g_{k+1} - g_k`。
- **自由资源松弛**：以 baseline `(C0,H0,D0)` 与预算 `R` 为输入，允许把 `R` 任意分配到三属性的超集模型。
- **真实装备可行域**：装备固定属性、孔位/meld cap、食物、同步、独占/共享槽等约束下的实际可达集合。
- **incumbent**：当前已证明可达的最优（或搜索中的当前最优），严格改善即精确目标值严格增大。

## 9. 验证

`docs/mathematical-analysis/verification/` 提供：

- `verify-canonical-model.mjs`：把 §3 的整数模型与 canonical evaluator（直接 import `src/domain/search/equipped-effects.ts`，注入生成数据字节）在有限定义域上逐点对照，覆盖全部支持等级、全部职业、BLU/普通、`g ∈ [0, G]`，并检查 §2.1 的基础属性归约、§3.1 的截断语义、§4 的因子值。
- 覆盖范围与证明作用在脚本头部和各定理文档中说明。**有限域对照只是对这些有限点的证书，不构成一般性证明**；一般性证明在各定理文档中给出。
