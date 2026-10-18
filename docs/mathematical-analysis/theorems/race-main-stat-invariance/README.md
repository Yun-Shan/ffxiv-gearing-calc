# 种族主属性变化与最优配装：公式域与真实候选域

## 1. 标题与状态

- **目录**：`docs/mathematical-analysis/theorems/race-main-stat-invariance/`
- **对象**：种族/氏族变化只改变攻击主属性的基础值 `B`（`value = B + a(x)`，`a(x)` 是装备+食物贡献；CRT/DHT/DET/TEN/SKS/SPS 的基础偏移不随种族变化）。问题：同一职业、等级、候选池、食物池、约束与目标（damage/DPS）下，换种族后原最优配装是否仍最优；是否存在更优配装使换种族后的最优值超过“简单换种族”的值。
- **结论（按范围分开）**：
  - **实际候选域、允许任意受支持等级**：**已否证**。真实精确搜索在**页面可选**的 `L70`（sync375）`BLM` 上找到反例：人族最优配装换到敖龙族后的评分为 `12.341774441851111`，而敖龙族真实最优为 `12.354601735047163`；两者装备 ID 不同（§5.2）。该反例由**精确求解器**在相同候选池/食物/约束下分别求得两个种族的全局最优，不是“两个构造向量相对比较”。
- **追加两个方向**：页面可选的高同步 `sync665`（L90，max−sync=130）和大幅度差 `sync475`（L80，max−sync=320）也都有严格反例；配置、GCD 2.50、精确最优分数和分享链接见 §5.2.1/§5.2.2。
  - **仅等级 100**：**未解决（有限实例验证）**。对 21 个 100 级职业（无同步 770–795、damage）以及 BLM/SAM/WHM/BRD/PLD 的 710–795、640–795 范围，Human/Au Ra 精确最优的装备与食物 ID 完全一致；只差基础主属性/VIT。未发现反例，但这不是一般性证明（§5.3、§12）。
  - **一般代数模型（任意可解属性向量）**：不存在无条件不变性；两解翻转判据已证明（§4 定理 1）。
  - **充分条件**：所有可行解攻击主属性贡献相同 / 攻击因子按公共正比例变化 / 攻击档位逐点不变时，最优集合确实不变（定理 2–4）。
  - **当前实现**：规则固定人族·中原之民，优化配置没有种族输入；`getBaseStats` 固定 `clanStats[stat][0]`。因此 UI 换种族不改变优化器输入是**实现范围事实**，不是数学不变性。
- **验证**：
  - [verify.mjs](verify.mjs)：公式域/充分条件的有限证书，`node --experimental-strip-types`，PASS。
  - [real-search-verify.mjs](real-search-verify.mjs)：真实候选域反例的精确搜索复核（页面可选 L70 sync375；Human/Au Ra 两次精确求解 + 换族后评分对照），PASS。
  - [real-search-directions.mjs](real-search-directions.mjs)：两个追加方向（sync665 高同步、sync475 大差值 max−sync=320）的精确搜索复核，PASS。

### 1.1 状态总表

| 命题 | 内容 | 状态 |
| --- | --- | --- |
| 实际候选域原命题（任意受支持等级） | 换种族后原最优配装仍最优，且不存在更优解 | **已否证**（页面可选 L70 BLM sync375 精确搜索反例，§5.2） |
| 实际候选域原命题（仅等级 100） | 同上，限制在 L100 候选/食物/约束 | **未解决（有限实例验证）**：21 职业 + 多范围精确搜索未发现反例；一般证明未完成 |
| 公式域两解翻转判据 | `r_B·q` 的精确比较与翻转区间 | **已证明**（定理 1） |
| 等主属性贡献充分条件 | 所有可行解主属性贡献相同 ⇒ 最优集合不变 | **已证明**（定理 2） |
| 攻击因子公共比例充分条件 | `A_{B2}=c·A_{B1}` ⇒ 目标整体正比 | **已证明**（定理 3） |
| 档位逐点不变充分条件 | 每个可达 `a` 的攻击档位不变 ⇒ 目标完全相同 | **已证明**（定理 4） |
| 有限域最优集合判据 | 最优集合不变 ⇔ 所有两两比较符号不变 | **已证明**（定理 5） |
| 当前实现范围 | 固定人族·中原之民，无种族输入 | **条件成立（实现事实）** |

## 2. 范围、记号与假设

### 2.1 记号

固定 `(job, level, 候选池, 食物池, 约束, 目标)`。对负载 `x`：

```text
a(x) : 攻击主属性贡献（装备+食物；不是面板总值）
B    : 种族决定的攻击主属性基础值
Q(x) : 除攻击主属性以外的伤害因子乘积
A_B(a): 攻击主属性档位因子（canonical evaluator 的 mainStat）
D_B(x) = A_B(a(x)) · Q(x)
```

DPS 比较用 `D_B(x)/gcd(x)` 与交叉乘法 `D_B(x)·gcd(y) ? D_B(y)·gcd(x)`；`gcd` 与种族无关。

**等价**：两个解若最终伤害因子向量（含 gcd）相同，或最终贡献向量与 gcd 相同，则视为等价；主属性/副属性最终值不同的解不等价。

### 2.2 假设

1. **A1（种族作用范围）**：种族只改变攻击主属性基础值 `B`；CRT/DHT/DET/TEN/SKS/SPS 基础偏移不变；装备/食物贡献、候选池、约束和目标不变。VIT/HP 的种族变化不进入 damage/DPS 目标；若有 HP/TEN 约束或食物百分比耦合，另见 §7.4。
2. **A2（同一条件）**：换种族时 job/level/候选池/食物池/共享身份/戒指唯一性/目标完全不变。
3. **A3（精确比较）**：`A_B,Q,gcd` 为正整数，精确整数/BigInt 比较；不用浮点近似决定胜负。
4. **A4（数据前提）**：canonical 参考模型的 `baseStats`/`clanStats` 归约与当前数据版本一致；攻击主属性由 job schema 与等级参数决定。

## 3. 攻击档位因子与种族参数

当前 canonical evaluator 的攻击档位（`equipped-effects.ts:130-136`）：

```text
C_B = floor(levelMod.main * statModifier[attackStat] / 100) + clanStats[attackStat][clanIndex]
B   = C_B
A_B(a) = floor( (ap * (floor((B+a) * partyBonus) - main)) / main + 100 )
```

- `B` 只来自基础属性/氏族；`a` 只来自装备+食物贡献。
- `A_B(a)` 是**非减阶梯函数**，不是线性函数；`B` 的变化可改变不同 `a` 的档位差。
- 当前规则固定人族·中原之民（索引 0）；敖龙族·晨曦之民对应索引 10。BLM 的 INT 基础值：人族 `3`（23-20），敖龙族 `0`（20-20）；WHM 的 MND：人族 `-1`、敖龙族 `+3`。这些数据事实由 `verify.mjs` 与 `real-search-verify.mjs` 读取生成数据后断言。

## 4. 精确命题

### 定理 1（两解翻转判据）

设两个解 `x,y`，`a_x=a(x), a_y=a(y)`，`Q_x=Q(x), Q_y=Q(y)>0`，`B` 为攻击主属性基础值：

```text
r_B := A_B(a_x) / A_B(a_y) > 0
q   := Q_x / Q_y > 0
```

1. `x` 在 `B` 下严格优于 `y` ⇔ `r_B·q > 1`；相等 ⇔ `=1`。
2. 若 `r_{B_1} ≠ r_{B_2}`，存在 `x,y` 使胜负严格翻转 ⇔ `q` 严格位于 `1/r_{B_1}` 与 `1/r_{B_2}` 之间。
3. 因此不能从“只改攻击主属性基础值”推出无条件不变性；真实候选域是否出现翻转取决于候选池中是否存在满足 (2) 的两解。

**证明。** 正性交叉乘法即可；翻转由 `r_{B_1}q>1>r_{B_2}q`（或反向）解出。∎

### 定理 2（等主属性贡献 ⇒ 不变）

若所有可行解的 `a(x)` 相同（记 `a0`），则

```text
D_{B_2}(x) = (A_{B_2}(a0)/A_{B_1}(a0)) · D_{B_1}(x)
```

公共正因子不改变排序；最优集合（按最终因子等价类）不变。∎

### 定理 3（攻击因子公共比例 ⇒ 不变）

若存在 `c>0` 使对所有可行解 `x` 有 `A_{B_2}(a(x)) = c·A_{B_1}(a(x))`，则 `D_{B_2}=c·D_{B_1}`，最优/tie 集合不变。∎

### 定理 4（档位逐点不变 ⇒ 不变）

若对所有可行解 `x` 有 `A_{B_1}(a(x))=A_{B_2}(a(x))`，则目标函数完全相同，最优集合相同。推论：种族差不使任何可达 `a` 跨攻击档位边界时成立。∎

### 定理 5（有限域最优集合判据）

设可行域 `Ω` 有限。以下等价：

1. 两个种族下的最优解集合（按最终因子等价类）相同；
2. 对所有 `x,y∈Ω`，`sign(D_{B_1}(x)-D_{B_1}(y)) = sign(D_{B_2}(x)-D_{B_2}(y))`（含 0 符号一致）。

**证明。** 有限全序由两两比较决定；符号全同 ⇒ 同一最大值集合；反向由最优集合相同推出每对相对关系不可能交换。∎

### 命题 6（当前实现范围）

[领域与搜索规则](../../../rules/领域与搜索规则.md) 第 9 行规定“当前族群固定为人族·中原之民”；`getBaseStats` 使用 `clanStats[stat][0]`；优化配置没有种族/氏族输入。因此当前优化器不会因 UI 切种族而改变输入——这是实现范围事实，不是“任何种族变化都不影响最优解”的数学证明。若接入种族参数，必须重新计算并复核本定理的充分条件。

## 5. 真实候选域精确搜索

> 本节使用精确求解器 `findBestLoadoutExactMip`（经 `runOptimizationLocally`）在**真实候选池**上分别求 Human/Au Ra 的完整最优解；这是用户明确允许的搜索验证，不是性能测试。所有比较都是同一配置、同一候选池/食物/约束，只把 `clanStats[*][0]` 的基值替换为敖龙族·晨曦之民（索引 10）的基值。

### 5.1 实验方法

1. 读取生成数据；记录人族 clanIndex 0 的 STR/DEX/VIT/INT/MND 基值；配置显式固定 `gcdTarget=2.5`（两族结果 GCD 均为 2.50）。
2. 对给定配置跑 `runOptimizationLocally(config)`（Human）。
3. 将上述五项 `clanStats[stat][0]` 临时替换为 clanIndex 10 的值，跑同一配置（Au Ra），再恢复数据。
4. 比较 `gear` 的 `(slot,itemId)` 集合、食物 `id`、`stats`、`score`；并用 `calculateEffects` 把 Human 最优装备的 panel stats 换到 Au Ra 基值下，得到“换种族但不换装”的评分。
5. 精确求解器分别给出两个种族目标下的全局最优；`score` 与 `calculateEffects` 逐项一致（见复算断言）。

### 5.2 实际反例（L70，BLM，sync375；页面可选同步等级）

配置：

```text
jobId=BLM, minItemLevel=360, maxItemLevel=390, syncLevel=375,
gcdTarget=2.5, objective=damage, foodId=0, maximizeTenacity=false
calculationLevel=70
```

两族结果 GCD 均为 **2.50**（与 `gcdTarget=2.5` 一致；加该约束后两次精确最优的装备/分数不变）。

同步品级 `375` 是页面可选值：`src/ui/services/app-config.ts` 的 `selectableSyncLevels` 源自 `popularSyncLevels = [795, 735, 700, 695, 665, 635, 605, 475, 375, 345, 300, ...]`（第 36–39 行）；因此这个反例可以直接用页面上的同步品级复现，不依赖特殊构造向量。

结果：

| 量 | 人族·中原之民 | 敖龙族·晨曦之民 |
| --- | ---: | ---: |
| 最优 `score` | `12.385384952246342` | `12.354601735047163` |
| 最优装备 | `body:21546, bracelet:24424, earrings:21555, feet:21455, hands:24406, head:21545, legs:24407, necklace:24419, ring:21476, ring2:21476, weapon:23403` | `body:21546, bracelet:21565, earrings:21555, feet:21455, hands:24406, head:21545, legs:24407, necklace:24419, ring:21476, ring2:21476, weapon:23403` |
| 食物 id | `49245` | `49245` |
| 关键面板 | `INT=1320, CRT=780, DET=1012, DHT=1322` | `INT=1316, CRT=715, DET=1025, DHT=1377` |

- **人族最优装备换到敖龙族基值下**（不换装备、不换食物）评分为 `12.341774441851111`；
- 敖龙族真实最优为 `12.354601735047163`，严格高于换族后的值（差 `0.012827293196052`）；两者装备 ID 不同（bracelet `24424 → 21565`），不是等价变化。
- 反过来，敖龙族最优装备换到人族基值下为 `12.376429653306962`，低于人族真实最优 `12.385384952246342`。
- **配装器分享链接**（Asvel 固定配装格式；均含 BLM/L70/sync375：食物 `49245`）：
  - 人族最优：<https://asvel.github.io/ffxiv-gearing/?ABoe3N5w0dSHGGo1a7OhbOLSSnA73sYbgxU6TGCt14K1iX823>
  - 敖龙族最优：<https://asvel.github.io/ffxiv-gearing/?AFXUbFijlHBTAXIZovbcIjwezxWKeVb5Ix7ThavYCgW05wyZF>
  - 两条链接都已用 `parseReferenceGearset` 复核：job=BLM、jobLevel=70、syncLevel=375、foodId=49245，装备 ID 与 §5.2 表一致。

因此**“把人族最优配装简单改成敖龙族即是最优”在真实候选域不成立**；存在相同条件下的更优配装。该反例是精确求解器在两个种族下分别认证的全局最优，不是相对比较的构造向量。

> 补充：`L90`（sync660，645–675）也能复现同类反例（Human 最优 `54.07734825443796`，Au Ra 最优 `54.02124083642048`，Human 装备换族后 `54.01215555009264`），但 `660` 不在页面常用同步列表；页面可复现的反例以上面的 `sync375` 为准。
### 5.2.1 方向 1：更高页面可选同步等级（BLM sync665）

配置：

```text
jobId=BLM, minItemLevel=650, maxItemLevel=795, syncLevel=665,
gcdTarget=2.5, objective=damage, foodId=0, maximizeTenacity=false
calculationLevel=90
```

`665` 是页面 `selectableSyncLevels` 的常用值（§5.2 引用同一列表）；品级范围最大值 795 − 同步 665 = 130。

| 量 | 人族·中原之民 | 敖龙族·晨曦之民 |
| --- | ---: | ---: |
| 最优 `score` | `56.15142038085938` | `56.107528658166046` |
| 最优装备差异 | — | earrings `40224 → 42051`（其余槽位相同） |
| GCD | 2.50 | 2.50 |
| 食物 | `49240` | `49240` |

- Human 最优装备换到 Au Ra 基值后：`56.08516501757813`，低于 Au Ra 真实最优 `56.107528658166046`；
- Au Ra 最优装备换回 Human：`56.14070874607743`，低于 Human 真实最优 `56.15142038085938`。

分享链接（Asvel 固定配装格式，BLM/L90/sync665/食物 49240）：

- 人族最优：<https://asvel.github.io/ffxiv-gearing/?hFGaRYPrf3c0qEd0KYEffbjFA9dj8n6W1iazuOQAP8oY2eUOz6YjkU9IGOYF8Zl>
- 敖龙族最优：<https://asvel.github.io/ffxiv-gearing/?abolY4EyFms1NIeK22RGSg5GV4q56CoTdxziylVvxUvPPGGsw0NnmiEGZvhpd3t>

两条链接已用 `parseReferenceGearset` 复核：job=BLM、jobLevel=90、syncLevel=665、foodId=49240，装备 ID 与上表一致。

### 5.2.2 方向 2：最大品级比同步等级大 150 以上（BLM sync475）

配置：

```text
jobId=BLM, minItemLevel=460, maxItemLevel=795, syncLevel=475,
gcdTarget=2.5, objective=damage, foodId=0, maximizeTenacity=false
calculationLevel=80
```

品级范围最大值 795 − 同步 475 = **320 > 150**；同步品级 `475` 也是页面可选常用值。

| 量 | 人族·中原之民 | 敖龙族·晨曦之民 |
| --- | ---: | ---: |
| 最优 `score` | `20.039108423178103` | `20.004779323047984` |
| 最优装备差异 | — | head `25602 → 37981`（其余槽位相同） |
| GCD | 2.50 | 2.50 |
| 食物 | `49240` | `49240` |

- Human 最优装备换到 Au Ra 基值后：`19.98919781689372`，低于 Au Ra 真实最优 `20.004779323047984`；
- Au Ra 最优装备换回 Human：`20.029722938164003`，低于 Human 真实最优 `20.039108423178103`。

分享链接（Asvel 固定配装格式，BLM/L80/sync475/食物 49240）：

- 人族最优：<https://asvel.github.io/ffxiv-gearing/?6wURr5j5rpQv4zqthEenLPJUTzL7SIXoz6xRDPtGqVLMmquB2Gi8F>
- 敖龙族最优：<https://asvel.github.io/ffxiv-gearing/?ibmSG1tU3EVcJNZlfGRx9MAeVFQgzFT8h93NokjZyx5ZjoRdXSTf>

两条链接已用 `parseReferenceGearset` 复核：job=BLM、jobLevel=80、syncLevel=475、foodId=49240，装备 ID 与上表一致。
### 5.3 等级 100 的有限验证（未发现反例）

使用同样的精确求解器与种族替换，测试：

- **21 个 100 级职业**，无同步，`minItemLevel=770,maxItemLevel=795`，`objective=damage`：Human/Au Ra 的装备 ID 集合与食物 ID **全部相同**；只有基础主属性/VIT 不同，`score` 相应变化。
- BLM/SAM/WHM/BRD/PLD 的 `710–795` 与 `640–795` 范围：同样装备/食物 ID 相同。
- 其中 BRD 另测 `objective=dps`（770–795）：装备/食物相同。

**这不是一般性证明**：只说明这些具体候选池/食物/约束/目标下未出现反例。等级 100 的原命题仍是 §12 的开放问题。

### 5.4 页面可选同步等级的扫描（BLM/WHM/SAM）

以下同步等级均来自页面 `selectableSyncLevels` 列表的常用值：

| 职业 | sync665（L90） | sync635（L90） | sync605（L90） | sync475（L80） | sync375（L70） | sync345（L70） | sync300（L70） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BLM | **不同** | 同 | 同 | 同 | **不同** | **不同** | **不同** |
| WHM | 同 | **不同** | 同 | **不同** | 同 | 同 | 同 |
| SAM | 同 | 同 | 同 | **不同** | **不同** | **不同** | **不同** |

“不同”指装备/食物最优 ID 集合不同；这些是实际精确搜索结果。它说明**一般性（跨等级）不成立**；页面可选的 L70 `sync375` BLM 是本文的主反例。等级 100 的同一性需要在更大范围继续验证/证明。
### 5.5 等价语义与 tie

- 允许的等价变化要求最终伤害因子向量（含 gcd）相同；本次反例的装备 ID 与最终面板属性不同（主属性/副属性均不同），不属于等价变化。
- 若两个解最终属性贡献相同，则种族只改变公共基础值，二者在所有种族下同值；这就是定理 2 的特例。
- 不等价翻转的判据由定理 1 给出；`q` 位于区间端点时是 tie，不属于严格翻转。

## 6. 证明

- 定理 1：正性交叉乘法，见 §4。
- 定理 2/3/4：目标函数逐点乘公共正因子/完全相同，直接代入。
- 定理 5：有限全序由两两符号决定，见 §4。
- 真实反例：由精确求解器分别返回 Human/Au Ra 的全局最优；`real-search-verify.mjs` 复算两个最优分数、装备签名、换族后的 `calculateEffects` 评分，并断言换族后值严格小于对方最优。求解器的最优性证书由精确 MIP 搜索给出；本文件不重复其内部证明。

## 7. 依赖、适用前提与开放问题

### 7.1 依赖

- [canonical-evaluator-reference.md](../../canonical-evaluator-reference.md)：baseStats/clanStats、攻击档位、整数因子、贡献坐标。
- [raw-tier-transform](../raw-tier-transform/README.md)：档位/因子单调性与精确整数性。
- [free-budget-upper-bound](../free-budget-upper-bound/README.md)：整数乘积/比较语义。
- [strict-improvement-frontier](../strict-improvement-frontier/README.md)：完整伤害因子与 tie 语义。
- 规则：[领域与搜索规则](../../../rules/领域与搜索规则.md) 第 9 行（当前固定人族·中原之民）。
- 生产对应：`getBaseStats`（`equipped-effects.ts:178-203`）、`equippedAttributeTier`（`:110-166`）、`createIntegerDamageFactorEvaluator`（`:59-104`）、`exact-mip-candidate-upper-bound.ts` 的 BigInt 交叉比较、`rules.ts:49-58` 的 `calculateBaseStats(job, level, clanIndex)`。

### 7.2 应用前提与安全回退

- **不能**默认“换种族后原配装仍最优”：页面可选的 L70 BLM sync375 实际反例已证实相反，跨等级没有一般性。
- 若要在实现中支持多族：
  1. 先检查定理 2/3/4 的条件；或
  2. 用目标种族基值重新运行精确优化；不能复用旧种族结果宣称最优；
  3. 等级 100 是否普遍成立尚未证明；即使当前测试未发现反例，也必须按实现侧回归/验证确认。
- 当前实现固定 clanIndex 0：UI 切种族不会改变输入；若将来写入 base stats，必须重新验证候选上界、frontier、tie 语义与全部 verify 脚本。
- `B` 必须来自同一数据版本/同一 clanIndex；面板值 = base + 贡献，不能直接当 `B` 或 `a`。

### 7.3 未解决

1. **等级 100 的一般性**：目前只做了 21 职业 + 若干 item range 的精确搜索，未证明所有 L100 候选/食物/约束/目标下不变；需要更一般的结构证明或更大范围反例搜索。
2. 约束（GCD/TEN/共享身份/共享食物）与种族的交互；本反例是无这些约束的 BLM damage 配置。
3. 食物百分比/HP 与种族基础属性的耦合（§7.4）。
4. 更低等级的完整反例分类（当前只抽样 BLM/WHM/SAM）。

### 7.4 其它种族属性与食物

- 种族还改变 VIT、部分主属性；若目标/硬约束包含 HP/TEN 或食物按面板百分比计算，`Q` 不再与种族无关，A1 前提失效，需要扩展到 `Q_B(x)`。
- 坦克主属性为 VIT 时攻击使用 STR；种族对 STR 的差异进入 `B`，VIT/HP 影响不在本文范围。
- 食物若依赖总属性 `G` 且 `G` 含基础值，换族可能改变食物加成；本文精确搜索的实验配置中食物模型按装备贡献+food baseValue 计算，未引入该耦合。

## 8. 与 canonical evaluator 的对应

- `getBaseStats`（`equipped-effects.ts:178-203`）：`floor(levelMod[kind]*statModifier/100)+clanStats[stat][0]`；CRT/DHT/TEN 的 base 为 `sub`、DET 为 `main`，与种族无关；攻击主属性 base 含 clanStats。
- `equippedAttributeTier`（`:110-166`）：`value = baseStats[stat] + gearAndFoodValue`，攻击主属性档位由此变化。
- `createIntegerDamageFactorEvaluator`（`:59-104`）：返回七个整数因子；比较用 `exactProduct`/BigInt 交叉乘法（`exact-mip-candidate-upper-bound.ts:96-140`）。
- 精确搜索入口：`runOptimizationLocally` → `findBestLoadoutExactMip`；`real-search-verify.mjs` 直接调用生产入口，不复制求解器。

## 9. 应用方向

- **跨等级结论**：不能假设种族不变；页面可选的 L70 BLM sync375 已有实际反例。实现若支持种族，必须重算。
- **等级 100**：当前测试未发现装备/食物 ID 变化；可作为实现回归的前提，但不能作为数学证明或替代重算。
- **缓存**：若种族未接入，明确说明固定人族；不要用旧种族结果自称目标种族最优。
- **剪枝/上界**：种族进入 `B` 后，所有基于 `A_B` 的界、frontier、完整乘积与 `U` 之外的计算必须重新做；不能沿用旧证书。

## 10. 验证

### 10.1 公式域 `verify.mjs`

覆盖：

1. 数据事实：`clanStats` 索引 0/10；WHM L100 与攻击档位（真实脚本另断言 BLM L70）。
2. 两解翻转判据与翻转区间（精确整数）。
3. 等主属性贡献/公共比例/档位不变三类充分条件的有限检查。
4. 有限域最优集合判据与等价语义。
5. 坐标：`B` 是 base、`a` 是贡献；面板值不能当贡献。

运行：

```bash
node --experimental-strip-types docs/mathematical-analysis/theorems/race-main-stat-invariance/verify.mjs
```

### 10.2 真实候选域 `real-search-verify.mjs`

执行两次精确优化（Human / Au Ra Raen）并断言：

- 页面可选 L70 BLM sync375 下两族最优装备 ID 集合不同；两族 GCD 均为 2.50；
- 人族最优装备换到敖龙族基值后的 `calculateEffects` 评分严格低于敖龙族精确最优；
- 敖龙族最优装备换回人族基值后严格低于人族精确最优；
- 食物 ID 相同、配置/候选池相同；
- 双方 `score` 与 `calculateEffects` 复算一致。

运行（会实际运行精确求解器）：

```bash
node --experimental-strip-types docs/mathematical-analysis/theorems/race-main-stat-invariance/real-search-verify.mjs
node --experimental-strip-types docs/mathematical-analysis/theorems/race-main-stat-invariance/real-search-directions.mjs
```

## 11. 验证证据与边界

- `verify.mjs`：有限公式域证书 PASS。
- `real-search-verify.mjs`：页面可选 L70 BLM sync375 的真实精确搜索反例 PASS；`real-search-directions.mjs`：sync665 高同步与 sync475 大差值（max−sync=320）两个方向 PASS；本次已手工在 **21 个 L100 职业**（770–795 damage）与 BLM/SAM/WHM/BRD/PLD 的 710–795、640–795 范围跑过 Human/Au Ra 对照，结果装备/食物 ID 全部一致；该 sweep 未固化进脚本（耗时/配置较多），作为 §5.3 的测量记录。
- 未做性能/benchmark 结论；精确搜索只用于最优性验证，不评估耗时收益。

## 12. 未解决问题

1. 等级 100 上“种族不改变最优配装”的一般证明或更大范围反例搜索（当前有限实例未发现反例）。
2. 约束与共享耦合下的扩展（GCD/TEN/共享身份/共享食物）。
3. 食物百分比/HP 与种族的耦合模型。
4. 更低等级的完整反例分类与对实现的影响。

## 13. baseStat 影响审计（贡献坐标 vs 面板总值）

| 对象 | 坐标 | 是否受 baseStat 影响 | 判定 |
| --- | --- | --- | --- |
| `a(x)`（攻击主属性贡献） | 装备+食物贡献 | 否（种族不改贡献） | 精确搜索中两族使用同一候选/食物 |
| `B`（攻击主属性基础） | 面板基础 | 是（clanStats） | 只改 `B` |
| `A_B(a)`（攻击档位） | 由 `B+a` 计算 | 是 | 跨族差异来源 |
| `Q(x)`（其它因子） | 贡献坐标 | 否（A1 前提；CRT/DHT/DET/TEN 基础偏移与种族无关） | 反例中其它因子随装备选择变化 |
| 面板总值 | base + 贡献 | 是（攻击主属性含 base；CRT/DHT/TEN 减 sub、DET 减 main） | 不得把面板当 `a` 或 `B` |

结论：本定理的坐标全部是贡献/基础分离的；`B` 是攻击主属性基础值（含 clanStats），`a` 是贡献。真实搜索的 `result.stats` 是面板值，实验脚本严格用 `baseStats` 差值做换族换算，不把面板值当贡献。
