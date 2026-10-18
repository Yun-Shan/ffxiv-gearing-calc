# 定理：Raw-to-Tier Transform（装备+食物贡献到整数档位的精确映射）

状态：**已证明**（在 §3 的编号假设下）。核心结论对任意整数 `g >= 0` 成立；其中「生产代码的 `Math.trunc(v + 1e-7)` 等价于精确整数 floor」的证明限制在 `0 <= g <= 10^7`（远高于游戏数据实际范围，只用于浮点误差界）。**`g >= 0` 且档位实参非负是可达域上的结构性结论**（§4 Lemma 4.3b：由基础属性归约 + 候选贡献非负推出），不是需要运行时额外满足的假设；`g < 0` 的截断差异只在定义域外输入下出现（Lemma 4.5 作稳健性登记，正式候选路径不可达）。

---

## 1. 范围与依据

### 1.1 任务来源

本文对应 Issue #3 最新要求（评论 2）的「固定等级定理 A」：

- `docs/mathematical-analysis/issue-3-comment-02.md` §一（区分固定等级公式 / 自由资源松弛 / 真实装备可行域）、§三（阈值周期、跳档成本、`Math.trunc(value+1e-7)` 与整数推导的边界等价验证）、§九（`exact raw-tier transformation + period + boundary semantics`）、§十（验证要求）。
- `docs/mathematical-analysis/issue-3-body.md` 的「证明目标 1」与 `issue-3-comment-01.md` 只作背景；其优先级已被评论 2 取代（见 [数学分析资料说明](../../README.md) 的阅读入口说明）。

本文**只处理固定等级公式本身**（数学对象 1），不涉及装备池、自由资源松弛、搜索、MIP 或任何经验阈值。

### 1.2 源码依据（行号以 2026-10-18 工作区为准）

| 内容 | 位置 |
| --- | --- |
| 整数档位入口 `equippedAttributeTier` | `src/domain/search/equipped-effects.ts:110-154` |
| 档位输入的构造：`value = (baseStats[stat] ?? 0) + gearAndFoodValue` | `src/domain/search/equipped-effects.ts:125-127` |
| CRT 分支 | `src/domain/search/equipped-effects.ts:138-140` |
| DET 分支 | `src/domain/search/equipped-effects.ts:141-143` |
| DHT 分支 | `src/domain/search/equipped-effects.ts:144-146` |
| TEN 分支 | `src/domain/search/equipped-effects.ts:147-149` |
| 截断语义 `floor(value) = Math.trunc(value + 1e-7)` | `src/domain/search/equipped-effects.ts:163-166` |
| 基础属性构造 `getBaseStats` | `src/domain/search/equipped-effects.ts:178-203` |
| 整数因子求值器（直接以「装备+食物贡献」为输入） | `src/domain/search/equipped-effects.ts:59-104` |
| `LevelModifier` 字段 `main/sub/div/det/detTrunc` | `src/domain/types.ts:178-189` |
| 生成数据字段 `baseStats/clanStats/jobSchemas/jobLevelModifiers` | `src/domain/data.ts:17-43` |
| 生成数据装载 | `src/domain/data.ts:45-79` |

数据版本：`mcp-2026.09.15.0000.0000-upstream-048376fb6c6c-level-basis-v2`（`src/data/generated-data.bin`，由 `npm run data:update` 生成，不得手工编辑；抓取日期 2026-10-18，Asia/Shanghai）。

共同事实基础：[canonical-evaluator-reference.md](../../canonical-evaluator-reference.md) §2（等级参数表）、§2.1（基础属性归约与面板↔贡献换算）、§2.2（可达域内档位实参非负的结构性结论）、§3（整数档位模型）、§3.1（截断语义）、§5（定义域与可达范围）。

### 1.3 验证依据

- `docs/mathematical-analysis/verification/canonical-model.mjs`：整数模型工具（`tier`、`tierParameters`、`tierPeriod`、`firstContributionWithTierAtLeast`、`floorDiv` 等）。
- `docs/mathematical-analysis/verification/verify-canonical-model.mjs`：有限域逐点对照（本文 §10 引用其 PASS 结果）。
- 本目录 `verify.mjs`：为本文每条命题提供有限域证书（§10）。

---

## 2. 符号、量词与定义域

### 2.1 符号

| 符号 | 含义 |
| --- | --- |
| `ℒ` | 支持等级集合 `{50, 60, 70, 80, 90, 100}`，即生成数据 `jobLevelModifiers` 的全部键（脚本断言） |
| `𝒥` | 生成数据的全部职业（23 个，含 `BLU`、`BST`） |
| `β` | BLU 指示量：`β(j) = 1` 当 `j = BLU`，否则 `0` |
| `σ` | 副属性，`σ ∈ {CRT, DHT, DET, TEN}` |
| `ℓ` | 公式等级，`ℓ = level ∈ ℒ` |
| `(main, sub, div, det, detTrunc)` | 等级参数表（§1.2 canonical 参考 §2） |
| `g` | **装备 + 食物带来的属性贡献**（整数，不是面板总值；面板总值 = 基础属性 `sub`/`main` + `g`，换算见参考模型 §2.1） |
| `G_max` | 运行时贡献上界（候选池 + 同步 cap + 魔晶石 + 食物上界给出；运行时输入，本文不固定其值） |
| `t` | 档位值（整数） |
| `a, b, q, c, mult` | 统一档位形式 `t(g) = c + mult·floor((a·g + b)/q)` 的实例参数（§2.2） |
| `g_k` | 使 `t(g) >= k` 成立的最小整数 `g`（未按 `g >= 0` 截断） |
| `ĝ_k` | 域内阈值 `max(0, g_k)` |
| `c_k` | 跳档成本 `g_{k+mult} - g_k`（要求 `k ∈ c + mult·ℤ`） |
| `d, P, shift` | 周期参数：`d = gcd(a, q)`，`P = q/d`，`shift = mult·a/d` |
| `r(g)` | 余数类 `r(g) = (a·g + b) mod q ∈ {0, ..., q-1}` |
| `⌊x⌋`, `⌈x⌉` | 精确实数向下/向上取整（证明内部只对整数/有理数使用） |

### 2.2 统一档位模型

对 `ℓ ∈ ℒ`、职业 `j`、`σ ∈ {CRT, DHT, DET, TEN}`，定义实例参数：

| 属性 | `a` | `b` | `q` | `c` | `mult` |
| --- | ---: | ---: | ---: | ---: | ---: |
| CRT | 200 | 0 | `div(ℓ)` | `50 + 200β` | 1 |
| DHT | 550 | 0 | `div(ℓ)` | `200β` | 1 |
| DET | 140 | `1000·det(ℓ)` | `det(ℓ)·detTrunc(ℓ)` | 0 | `detTrunc(ℓ)` |
| TEN | 112 | 0 | `div(ℓ)` | 1000 | 1 |

并定义**整数档位模型**

```text
T_{ℓ,j,σ}(g) := c + mult · floor((a·g + b) / q)
```

以及阈值 `g_k := ⌈(n_k·q - b)/a⌉`，其中 `n_k := ⌈(k - c)/mult⌉`；跳档成本 `c_k := g_{k+mult} - g_k`。

### 2.3 量词约定与定义域

- 「`∀g`」指全部整数；「`∀g ∈ 𝒟`」指 `g ∈ ℤ` 且 `0 <= g <= G_max`；「`∀ℓ`」指 `ℓ ∈ ℒ`；「`∀j`」指 `j ∈ 𝒥`。
- **贡献坐标（本文默认坐标系）**：本文的 `g`、阈值 `g_k`、`ĝ_k`、跳档成本 `c_k`、可达域 `[0, G_max]`、实例表与全部示例的输入都是**贡献坐标**，不是面板总值。面板总值 `X(σ)` 与贡献的换算为 `X_CRT = sub + g`、`X_DHT = sub + g`、`X_TEN = sub + g`、`X_DET = main + g`（参考模型 §2.1）；把面板值直接代入档位公式会重复计算基础属性（详见 §13 审计）。
- **整数贡献域**：`g ∈ ℤ`。本文所有阈值/周期命题对整数 `g` 成立；实际可用域是 `𝒟 = {g ∈ ℤ : 0 <= g <= G_max}`。其中 `0 <= g` 由 A8（候选贡献非负性）结构性成立、`g <= G_max` 是候选池/同步 cap/魔晶石/食物的运行时上界。
- **截断等价域**：`0 <= g <= 10^7`（§3 A3；这是 §5.3 Lemma 4.4 浮点误差界的充分条件，不是游戏数据事实；`V >= 0` 部分由 Lemma 4.3b 在可达域结构性成立）。
- 等级：`ℓ ∈ ℒ`；BLU 实际可达等级 `<= 80`、BST `<= 50`，但代数恒等式对全部 `(ℓ, j)` 组合成立（脚本覆盖）。
- 证明内部不使用浮点近似、不使用 `明显`、不使用「数值上成立」；浮点只在 §5.3 Lemma 4.4 的误差界中使用，且以显式常数控制。

---

## 3. 假设（编号，均运行时可校验）

- **A1（等级）**：`ℓ ∈ ℒ = {50, 60, 70, 80, 90, 100}`，即 `gameData.jobLevelModifiers` 的键集合；等级参数 `(main, sub, div, det, detTrunc)` 与 §4 表一致。
- **A2（属性）**：`σ ∈ {CRT, DHT, DET, TEN}`；不涉及主属性分支（`:130-137`）与 SKS/SPS 分支（`:150-152`）。
- **A3（贡献域与浮点上界）**：`g` 为**整数**；可达域内 `0 <= g <= G_max`（`G_max` 为运行时输入）。`0 <= g` 不是额外假设：由 A4 的基础属性归约与 A8 的候选贡献非负性推出（Lemma 4.3b）。`10^7` 只是 §5.3 Lemma 4.4 浮点误差界的安全上界，不进入游戏语义；实际 `G_max` 远小于它。
- **A4（数据事实，版本相关）**：
  1. `baseStats.CRT = baseStats.DHT = baseStats.TEN = "sub"`，`baseStats.DET = "main"`；
  2. 所有职业的 `jobSchemas[j].statModifiers` **不含** `CRT/DHT/DET/TEN` 键；
  3. `clanStats` 只含 `STR/DEX/VIT/INT/MND`，不含四个副属性键；
  4. 所有职业的 `jobSchemas[j].stats` 含 `CRT/DHT/DET`；`TEN` 由 `getBaseStats` 的预设值 `TEN: levelMod.sub` 覆盖（`:186`）；
  5. 所有职业上限 `maxJobLevel ∈ {50, 80, 100}`；BLU 上限 80，BST 上限 50。
- **A5（源码语义）**：`equippedAttributeTier` 的四个分支公式与 `floor(value) = Math.trunc(value + 1e-7)`（`:163-166`）未改变；生产运行于 IEEE-754 binary64 + 就近舍入（RN），无 FMA 重结合等改变舍入路径的优化。
- **A6（调用语义）**：调用方传入 `gearAndFoodValue = g`（整数贡献），`baseStats` 由 `equippedAttributeTier` 内部补齐；`createIntegerDamageFactorEvaluator` 的搜索路径正是如此（`:81-85`），`equippedEffects` 路径先 `addStats(baseStats, gearAndFoodStats)`（`:304-308`）再由分支减去基线，等价性由 §5.1 Lemma 4.2 保证。
- **A7（数据稳定性）**：生成数据没有在 §4 表之外新增等级，也没有改变 `LevelModifier` 的相关字段含义。A4/A5 任一失败 ⇒ 本文的闭式层禁用并回退 canonical evaluator（§9）。
- **A8（候选贡献非负性，数据与构造事实）**：正式候选路径上，装备/镶嵌/自定义与义军武器/食物的属性贡献逐项非负：生成数据 `gears[*].stats`、`customParameters[*].bigValue/smallValue`、`materias`、`foods[*].stats/statRates`、`bluMdmgAdditions` 均非负（当前快照最小值分别为 1、21、1、1、7 与 12）；同步 cap 与镶嵌只做 `min`（`rules.ts:216-246`、`optimizer/equipment-candidates.ts:102-131`）；义军分配是步进 1 的非负整数变量，其上界为 `Math.max(0, cap - base)`（`optimizer/equipment-candidates.ts:268-278`）；食物增益 `min(maxValue, trunc((raw + baseValue)(multiplier-1)+1e-7))` 在 `raw, baseValue >= 0`、`multiplier >= 1`、`maxValue >= 0` 下非负，且这些参数在读取处被校验（`exact-mip-candidate-upper-bound.ts:81-92`、`loadout-finder-exact-mip.ts:1041-1047`）。自定义 `equipmentAttributeExtractor` 不在本假设内（测试/扩展钩子；存在时 canonical 候选上界层主动禁用，`exact-mip-candidate-upper-bound.ts:34`）。A8 由 `verify.mjs` 的归约前提检查与 `verification/verify-canonical-model.mjs` 的数据扫描断言。

---

## 4. 精确命题

### Definition 4.1（档位模型与阈值）

沿用 §2.2 的 `T_{ℓ,j,σ}(g) = c + mult·floor((a·g + b)/q)`、`g_k`、`ĝ_k`、`c_k`、`d, P, shift`、`r(g)` 定义。

### Lemma 4.2（基础属性归约）

对 `∀ℓ ∈ ℒ`、`∀j ∈ 𝒥`、`∀σ ∈ {CRT, DHT, DET, TEN}`：

```text
baseStats.CRT = baseStats.DHT = baseStats.TEN = sub(ℓ)
baseStats.DET = main(ℓ)
value(σ) := baseStats[σ] + g = base(σ) + g
value(σ) - base(σ) = g           （base(CRT/DHT/TEN) = sub，base(DET) = main）
```

因此生产分支真正看到的量就是贡献 `g`；中间量 `value` 与 `g` 都是安全整数。

### Lemma 4.3（canonical 表达式归约为统一形式）

在 A1–A6 下，对 `∀g >= 0`，canonical 分支的**精确实数表达式**化简为（把生产截断替换为精确 floor 需要 Lemma 4.4，其成立范围为 `g <= 10^7`）：

```text
equippedAttributeTier(j, ℓ, CRT, g) = 50 + 200β + floor(200·g / div(ℓ))
equippedAttributeTier(j, ℓ, DHT, g) = 200β     + floor(550·g / div(ℓ))
equippedAttributeTier(j, ℓ, DET, g) = detTrunc(ℓ) · floor((140·g + 1000·det(ℓ)) / (det(ℓ)·detTrunc(ℓ)))
equippedAttributeTier(j, ℓ, TEN, g) = 1000     + floor(112·g / div(ℓ))
```

即 `= T_{ℓ,j,σ}(g) = c + mult·floor((a·g + b)/q)`。

### Lemma 4.3b（可达域内档位实参非负；结构性）

在 A1–A8 下，对 `∀ℓ ∈ ℒ`、`∀j ∈ 𝒥`、`∀σ ∈ {CRT, DHT, DET, TEN}`、可达域内 `∀g ∈ ℤ`（`0 <= g <= G_max`），canonical 分支的 floor 实参 `V(g) = (a·g+b)/q + c` 满足

```text
CRT: V >= 50          （g = 0、普通职业时取到 50；BLU 为 250）
DHT: V >= 0           （g = 0、普通职业时恰为 0）
DET: V >= 200         （= 1000/detTrunc + 140g/(det·detTrunc)，最小在 level 50：detTrunc = 5）
TEN: V >= 1000
```

因此 `V >= 0`，`Math.trunc(V̂ + 1e-7)` 的论证不需要「`V >= 0`」这一额外前提——它在整个可达域自动成立。

**证明**：由 Lemma 4.2，`value - offset = g`（CRT/DHT/TEN 的 offset 为 `sub`，DET 为 `main`）。由 A8，`g >= 0`。代入四个分支（`equipped-effects.ts:138-149`）：

- CRT：`V = 200g/div + 50 + 200β >= 50`；
- DHT：`V = 550g/div + 200β >= 0`；
- DET：`V = (140g + 1000·det)/(det·detTrunc) = 1000/detTrunc + 140g/(det·detTrunc)`，`detTrunc ∈ {1,2,5}` ⇒ `V >= 1000/5 = 200`；
- TEN：`V = 112g/div + 1000 >= 1000`。

四式都只用 `g >= 0`（A8）、`div > 0`、`det > 0`、`detTrunc > 0`、`β ∈ {0,1}`。∎

**可达性说明**：A8 的逐项非负性由生成数据与候选构造给出（装备/魔晶石/自定义与义军武器分配/食物增益），当前快照上的最小值与构造代码位置见 §3 A8 与参考模型 §2.2。因此 Lemma 4.4 的假设在正式候选路径上**结构性成立**，不是需要运行时检查后才会满足的条件。

### Lemma 4.4（binary64 截断等价）

令 `V(g) = (a·g + b)/q + c`（DET 的 `c = 0`，其余 `c` 为整数），并令 `V̂(g)` 为生产代码按 binary64 就近舍入逐次计算得到的结果（CRT/DHT/TEN 为「一次除法 + 一次加整数」；DET 为「一次除法 + 加 1000 + 一次除法」）。则对 `∀g ∈ ℤ`，`0 <= g <= 10^7`（由 Lemma 4.3b 可达域内 `V >= 0`）：

```text
Math.trunc(V̂(g) + 1e-7) = floor(V(g))
```

并因此 `canonical 档位 = c + mult·floor(V(g))`（DET 的 `mult` 在 canonical 中乘在 floor 之外，模型把它记入 `t`）。

### Lemma 4.5（定义域外 `g < 0` 的截断差异；正式候选路径不可达）

`g < 0` 时 Lemma 4.4 的结论不成立（`trunc` 对负值向零取整，且 `+1e-7` 会把精确负整数推过整数边界）。这只是**定义域外**的稳健性说明：由 Lemma 4.3b 与 A8，正式候选路径的 `g` 与档位实参恒非负，该分支不可达。精确反例（脚本用生产 `equippedAttributeTier` **直接传入负贡献**验证，属定义域外输入）：

| 等级 / 职业 / 属性 | `g` | 精确 `floor(V)` | canonical 值 |
| --- | ---: | ---: | ---: |
| 70 / WHM / CRT | -450 | -50 | **-49** |
| 70 / WHM / CRT | -1000 | -173 | -172 |
| 70 / WHM / DHT | -1 | -1 | **0** |

### Theorem 4.6（canonical tier 恒等式）

在 A1–A8 下，对 `∀ℓ ∈ ℒ`、`∀j ∈ 𝒥`、`∀σ ∈ {CRT, DHT, DET, TEN}`、`∀g ∈ ℤ` 且 `0 <= g <= min(G_max, 10^7)`：

```text
equippedAttributeTier(j, ℓ, σ, g) = T_{ℓ,j,σ}(g) = c + mult·floor((a·g + b)/q)
```

### Theorem 4.7（阈值闭式、最小性与单调性）

对 `∀ℓ, j, σ`、`∀k ∈ ℤ`，令 `n_k = ⌈(k - c)/mult⌉`、`g_k = ⌈(n_k·q - b)/a⌉`。则：

1. **充分性**：`t(g_k) >= k`；
2. **最小性**：`∀g ∈ ℤ, g < g_k ⟹ t(g) < k`；
3. **单调性**：`k_1 <= k_2 ⟹ g_{k_1} <= g_{k_2}`；
4. **域裁剪**：若 `k <= t(0)`，则 `g_k <= 0`，域内最小见证为 `ĝ_k = 0`；若 `k > t(0)`，则 `g_k >= 1`；
5. 对不在档位格 `c + mult·ℤ` 上的 `k`，阈值等于下一个格点的阈值：`g_k = g_{c + mult·n_k}`。

### Theorem 4.8（跳档成本闭式）

对 `∀k ∈ c + mult·ℤ`，记 `n = (k - c)/mult`、`s = (n·q - b + a - 1) mod a ∈ {0, ..., a-1}`（`mod` 取非负余数）。则

```text
c_k = g_{k+mult} - g_k = floor(q/a) + [ s + (q mod a) >= a ]
```

其中 `[·]` 为 0/1 指示量。推论：`c_k ∈ { floor(q/a), ceil(q/a) }`。

### Theorem 4.9（周期与平移）

令 `d = gcd(a, q)`、`P = q/d`、`shift = mult·a/d`。则：

1. `∀g ∈ ℤ`：`t(g + P) = t(g) + shift`；
2. `∀k ∈ ℤ`：`g_{k+shift} = g_k + P`（未截断的整数阈值）；
3. `∀k ∈ c + mult·ℤ`：`c_{k+shift} = c_k`；
4. `∀g ∈ ℤ`：`r(g + P) = r(g)`；进一步，对 `∀δ >= 0`，`t(g+δ) - t(g) = mult·floor((r(g) + a·δ)/q)`（该窗口引理的独立证明见 [raw-marginal-envelope](../raw-marginal-envelope/README.md)，本文只登记周期性部分）。

注：域裁剪后 `ĝ_{k+shift} = ĝ_k + P` 在边界处可能失效（两边都被截断为 0）；周期性质在未截断阈值上精确成立。

### Corollary 4.10（单调性）

1. `g ↦ t(g)` 非减：`t(g+1) - t(g) = mult·(floor((a(g+1)+b)/q) - floor((ag+b)/q)) >= 0`。
2. 严格跳变恰好发生在阈值处：`t(g) > t(g-1) ⟺ ∃k ∈ c + mult·ℤ : g = g_k`（即 `g` 是某个档位的最小见证）。
3. 因子 `F_C(t) = 1e6 + t·(t + b_C)`（`b_C = 350` 普通 / `150` BLU）、`F_H(t) = 4000 + t`、`F_D(t) = t` 在各自档位域上严格增（`F_C(t+1) - F_C(t) = 2t + b_C + 1 > 0`，`F_H` 差 1，`F_D` 差 `mult`），因此 `g ↦ 因子` 非减，且严格增当且仅当 `t(g) > t(g-1)`。

### Corollary 4.11（档位/因子正性与下界）

在 `g >= 0` 上：

```text
t_CRT >= 50（普通） / 250（BLU）      F_C >= 1,020,000 / 1,100,000
t_DHT >= 0（普通）  / 200（BLU）      F_H >= 4,000 / 4,200
t_DET >= 1,000（档位粒度 detTrunc）   F_D >= 1,000
t_TEN >= 1,000（不进入副属性乘积）     TEN 因子 >= 1,000
```

所有因子严格为正，满足 `safeDamageFactors` 的正性要求（`src/domain/search/exact-mip-candidate-upper-bound.ts:96-106`）。

### Corollary 4.12（cap / `G_max` 边界语义）

1. 闭式与周期恒等式是**整数恒等式**，但可用域是 `0 <= g <= G_max`；`g_k > G_max` 的阈值在本次搜索中**不可达**，查询应返回「不可达」而不是外推。
2. `g_k <= 0` 的阈值按 `ĝ_k = 0` 裁剪；`k <= t(0)` 的档位在域内从 `g = 0` 起即满足。
3. cap 作用在贡献上：进入档位公式的是 cap 之后的最终贡献；cap 饱和后 `g` 不再增长（档位进入平台），超出 cap 的查询没有物理意义，但代数恒等式仍成立。
4. `g < 0`：不接受（Lemma 4.5），必须回退 canonical evaluator 或拒绝调用。
5. `g > 10^7`：本文的截断等价证明不覆盖（A3）；生产不可能出现，运行时守卫应拒绝。
6. A4/A5 失败：闭式层禁用，回退 canonical evaluator。

### 4.13 实例表（全部等级 × 全部档位公式实例）

`t(0)` 为基线档位；`{c_k}` 为全部跳档成本取值集合（= `{floor(q/a), ceil(q/a)}`）；`d/P/shift` 为 Theorem 4.9 的周期参数；「粒度」为档位取值格间距 `mult`。**表中 `a, b, q, c` 是公式参数，`t(0)` 是档位坐标；正文对 `g_k`、阈值、跳档成本的引用一律是贡献坐标**（面板总值 = 基础属性 `sub`/`main` + 贡献，见参考模型 §2.1 与本文 §13）。

| level | 属性/职业 | a | b | q | c | mult | d | P | shift | t(0) | 跳档成本 c_k | 档位粒度 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 50 | CRT 普通 | 200 | 0 | 341 | 50 | 1 | 1 | 341 | 200 | 50 | {1,2} | 1（整数档位） |
| 50 | CRT BLU | 200 | 0 | 341 | 250 | 1 | 1 | 341 | 200 | 250 | {1,2} | 1（整数档位） |
| 50 | DHT 普通 | 550 | 0 | 341 | 0 | 1 | 11 | 31 | 50 | 0 | {0,1} | 1（整数档位） |
| 50 | DHT BLU | 550 | 0 | 341 | 200 | 1 | 11 | 31 | 50 | 200 | {0,1} | 1（整数档位） |
| 50 | DET | 140 | 202000 | 1010 | 0 | 5 | 10 | 101 | 70 | 1000 | {7,8} | 5（5 的倍数） |
| 50 | TEN | 112 | 0 | 341 | 1000 | 1 | 1 | 341 | 112 | 1000 | {3,4} | 1（整数档位） |
| 60 | CRT 普通 | 200 | 0 | 600 | 50 | 1 | 200 | 3 | 1 | 50 | {3} | 1（整数档位） |
| 60 | CRT BLU | 200 | 0 | 600 | 250 | 1 | 200 | 3 | 1 | 250 | {3} | 1（整数档位） |
| 60 | DHT 普通 | 550 | 0 | 600 | 0 | 1 | 50 | 12 | 11 | 0 | {1,2} | 1（整数档位） |
| 60 | DHT BLU | 550 | 0 | 600 | 200 | 1 | 50 | 12 | 11 | 200 | {1,2} | 1（整数档位） |
| 60 | DET | 140 | 600000 | 1200 | 0 | 2 | 20 | 60 | 14 | 1000 | {8,9} | 2（2 的倍数） |
| 60 | TEN | 112 | 0 | 600 | 1000 | 1 | 8 | 75 | 14 | 1000 | {5,6} | 1（整数档位） |
| 70 | CRT 普通 | 200 | 0 | 900 | 50 | 1 | 100 | 9 | 2 | 50 | {4,5} | 1（整数档位） |
| 70 | CRT BLU | 200 | 0 | 900 | 250 | 1 | 100 | 9 | 2 | 250 | {4,5} | 1（整数档位） |
| 70 | DHT 普通 | 550 | 0 | 900 | 0 | 1 | 50 | 18 | 11 | 0 | {1,2} | 1（整数档位） |
| 70 | DHT BLU | 550 | 0 | 900 | 200 | 1 | 50 | 18 | 11 | 200 | {1,2} | 1（整数档位） |
| 70 | DET | 140 | 900000 | 900 | 0 | 1 | 20 | 45 | 7 | 1000 | {6,7} | 1（整数档位） |
| 70 | TEN | 112 | 0 | 900 | 1000 | 1 | 4 | 225 | 28 | 1000 | {8,9} | 1（整数档位） |
| 80 | CRT 普通 | 200 | 0 | 1300 | 50 | 1 | 100 | 13 | 2 | 50 | {6,7} | 1（整数档位） |
| 80 | CRT BLU | 200 | 0 | 1300 | 250 | 1 | 100 | 13 | 2 | 250 | {6,7} | 1（整数档位） |
| 80 | DHT 普通 | 550 | 0 | 1300 | 0 | 1 | 50 | 26 | 11 | 0 | {2,3} | 1（整数档位） |
| 80 | DHT BLU | 550 | 0 | 1300 | 200 | 1 | 50 | 26 | 11 | 200 | {2,3} | 1（整数档位） |
| 80 | DET | 140 | 1300000 | 1300 | 0 | 1 | 20 | 65 | 7 | 1000 | {9,10} | 1（整数档位） |
| 80 | TEN | 112 | 0 | 1300 | 1000 | 1 | 4 | 325 | 28 | 1000 | {11,12} | 1（整数档位） |
| 90 | CRT 普通 | 200 | 0 | 1900 | 50 | 1 | 100 | 19 | 2 | 50 | {9,10} | 1（整数档位） |
| 90 | CRT BLU | 200 | 0 | 1900 | 250 | 1 | 100 | 19 | 2 | 250 | {9,10} | 1（整数档位） |
| 90 | DHT 普通 | 550 | 0 | 1900 | 0 | 1 | 50 | 38 | 11 | 0 | {3,4} | 1（整数档位） |
| 90 | DHT BLU | 550 | 0 | 1900 | 200 | 1 | 50 | 38 | 11 | 200 | {3,4} | 1（整数档位） |
| 90 | DET | 140 | 1900000 | 1900 | 0 | 1 | 20 | 95 | 7 | 1000 | {13,14} | 1（整数档位） |
| 90 | TEN | 112 | 0 | 1900 | 1000 | 1 | 4 | 475 | 28 | 1000 | {16,17} | 1（整数档位） |
| 100 | CRT 普通 | 200 | 0 | 2780 | 50 | 1 | 20 | 139 | 10 | 50 | {13,14} | 1（整数档位） |
| 100 | CRT BLU | 200 | 0 | 2780 | 250 | 1 | 20 | 139 | 10 | 250 | {13,14} | 1（整数档位） |
| 100 | DHT 普通 | 550 | 0 | 2780 | 0 | 1 | 10 | 278 | 55 | 0 | {5,6} | 1（整数档位） |
| 100 | DHT BLU | 550 | 0 | 2780 | 200 | 1 | 10 | 278 | 55 | 200 | {5,6} | 1（整数档位） |
| 100 | DET | 140 | 2780000 | 2780 | 0 | 1 | 20 | 139 | 7 | 1000 | {19,20} | 1（整数档位） |
| 100 | TEN | 112 | 0 | 2780 | 1000 | 1 | 4 | 695 | 28 | 1000 | {24,25} | 1（整数档位） |

交叉核对：等级 100 的跳档成本区间 `{13,14}`（CRT）、`{5,6}`（DHT）、`{19,20}`（DET）与 Issue #3 评论 2 §二 末尾给出的 13/14、5/6、19/20 完全一致。

### 4.14 三个必记实例（阈值/贡献均为贡献坐标）

1. **普通阈值与锯齿**（等级 100 CRT 普通）：`g_50=0, g_51=14, g_52=28, ..., g_59=126, g_60=139`；前 9 个跳档成本为 14，`c_59=13`。锯齿来源是 `q mod a = 2780 mod 200 = 180`，成本只能在 `{13,14}` 间切换。这里 `g_k` 是贡献：若用面板总值，需先减 `sub`（等级 100 为 420）。
2. **跳档成本为 0 = 跳档**（等级 50 DHT 普通）：`t(0)=0, t(1)=1, t(2)=3`；`g_2 = g_3 = 2`，`c_2 = 0`，即没有任何 `g` 满足 `t(g)=2`（档位 2 被跳过）。只有 `a > q` 的实例（唯一：等级 50 DHT，`550 > 341`）可能出现成本 0。
3. **固定周期**（等级 70 CRT 普通）：`d=100, P=9, shift=2`；`t(g+9) = t(g) + 2`，`g_{k+2} = g_k + 9`。等级 60 CRT 是退化例：`d=200, P=3, shift=1`，所有跳档成本恒为 3。

---

## 5. 证明

### 5.1 Lemma 4.2（基础属性归约）的证明

`getBaseStats`（`equipped-effects.ts:178-203`）的执行过程：

1. 若 `schema.stats` 或 `schema.statModifiers` 不存在则返回 `{}`；A4 下全部战斗职业两者都存在。
2. 初始对象为 `{ PDMG: 0, MDMG: 0, DLY: 0, TEN: levelMod.sub }`（`:186`）。
3. 对 `schema.stats` 中每个 `stat` 取 `baseStat = game.baseStats[stat] ?? 0`：
   - 若 `baseStat` 是数字，直接赋值；
   - 否则 `stats[stat] = floor(levelMod[baseStat] · (statModifiers[stat] ?? 100) / 100) + (clanStats[stat]?.[0] ?? 0)`（`:194-200`）。

逐属性：

- `CRT`、`DHT`：由 A4(4) 在 `schema.stats` 中；由 A4(1) `baseStat = "sub"`；由 A4(2) `statModifiers[stat]` 缺失 ⇒ 系数 `100`；由 A4(3) `clanStats[stat]` 缺失 ⇒ 加数 `0`。于是

  ```text
  stats[CRT] = floor(sub·100/100) + 0 = floor(sub) = sub
  stats[DHT] = sub
  ```

  其中 `floor(sub·100/100)` 的实参恰为整数 `sub`（binary64 精确表示），`Math.trunc(sub + 1e-7) = sub`。
- `TEN`：由 A4(4) `TEN` 不在任何 `schema.stats` 中，第 3 步不会覆盖预设值；预设值即 `levelMod.sub`。即使未来数据把 `TEN` 加入 `schema.stats`，A4(1) 的 `"sub"` 映射同样给出 `sub`。故 `stats[TEN] = sub`。
- `DET`：`baseStat = "main"`；系数缺省 100；加数 0：

  ```text
  stats[DET] = floor(main·100/100) + 0 = main
  ```

- 面板值 `value = (baseStats[stat] ?? 0) + gearAndFoodValue`（`:127`），其中 `gearAndFoodValue = g`（A6）。于是

  ```text
  value(CRT) - sub = g,  value(DHT) - sub = g,  value(TEN) - sub = g,  value(DET) - main = g
  ```

  且 `|value| <= |sub| + |g| <= 420 + 10^7 < 2^53`，是精确整数。∎

**说明**：这是**由数据推导出的性质**，不是定义。A4 是版本相关前提，数据更新后必须由 `verify.mjs` 第 1 节重新核验。

### 5.2 Lemma 4.3（canonical 归约形式）的证明

由 Lemma 4.2，`value - base = g`。对四个分支把 `equipped-effects.ts:138-149` 的实参写成有理数：

- CRT（`:139`）：`200·(value-sub)/div + 50 + 200β = 200g/div + c`，其中 `c = 50 + 200β`。
- DHT（`:145`）：`550·(value-sub)/div + 200β = 550g/div + c`，`c = 200β`。
- TEN（`:148`）：`112·(value-sub)/div + 1000 = 112g/div + 1000`，`c = 1000`。
- DET（`:142`）：记 `x = 140g`、`m = detTrunc`、`D = det`。实参为

  ```text
  ((140·g)/D + 1000)/m = (140g + 1000D)/(D·m)   （有理数恒等式，通分）
  ```

  故 `= (a·g + b)/q`，其中 `a=140, b=1000D, q=D·m = D·detTrunc`；分支结果再乘以 `m`，即 `mult = detTrunc`。

对 CRT/DHT/TEN，`c` 是整数，所以对实数 floor 有 `floor(200g/div + c) = c + floor(200g/div)`；对 DET，`c = 0`、`mult = detTrunc`。把「floor」替换为生产截断需要 Lemma 4.4。∎

### 5.3 Lemma 4.4（截断等价）的证明

固定 `ℓ, j, σ`，记实例参数 `(a, b, q, c, mult)`，`V(g) = (a·g + b)/q + c`（DET 时 `c = 0`）。

**第 1 步：精确有理数的分数部分下界。** `V(g)` 的分数部分来自 `(a·g + b)/q`：若 `V(g) ∉ ℤ`，则对任意整数 `m`，

```text
|V(g) - m| = |(a·g + b) - m·q| / q >= 1/q >= 1/2780 > 3.59·10^-4
```

因为分子是非零整数（`V(g) ∉ ℤ` 保证 `a·g+b ≠ m·q`），且 `q` 的最大值出现在等级 100 的 `div=2780` 与 `det·detTrunc = 2780`。同时注意 `g >= 0`、`b >= 0`、`c >= 0` ⇒ `V(g) >= 0`。

**第 2 步：binary64 计算的绝对误差界。** 生产代码中与 `V(g)` 有关的运算为（不计精确整数乘法/加法）：

- CRT/DHT/TEN：一次除法 `a·g / q`，一次加整数 `c`（`2` 次舍入）；
- DET：一次除法 `140·g / D`，一次加整数 `1000`，一次除法 `/ m`（`3` 次舍入）。

所有精确中间量的量级上界：`a·g/q <= 550·g/341 < 1.62g`，`140·g/D <= 140·g/202 < 0.70g`，加上常数后

```text
M <= 2g + 2000
```

（`g <= 10^7` 时 `M < 2.0002·10^7`）。设 `U = 2^-52`（RN 下相对误差的保守上界），由标准浮点误差分析，`m_r <= 3` 次舍入后

```text
|V̂(g) - V(g)| <= γ_{m_r}·M,   γ_{m_r} = m_r·U/(1 - m_r·U) < 3.0001·U
|V̂(g) - V(g)| < 3.0001·2^-52·(2·10^7 + 2000) < 1.5·10^-8
```

（实现验证：在 `g ∈ [0, 20000]`、全部实例共 960048 个点上观测到的最大绝对误差为 `9.095·10^-13`，远小于解析界。）

**第 3 步：非整数情形。** 若 `V(g) ∉ ℤ`，则

```text
|V̂(g) + 1e-7 - V(g)| <= |V̂(g) - V(g)| + 1e-7 < 1.2·10^-7 < 1/q
```

- 下侧：`V̂ + 1e-7 > V - 1.2·10^-7 > floor(V)`，因为 `V - floor(V) >= 1/q > 3.5·10^-4`；
- 上侧：`V̂ + 1e-7 < V + 1.2·10^-7 <= floor(V) + 1 - (1/q - 1.2·10^-7) < floor(V) + 1`。

所以 `V̂ + 1e-7 ∈ (floor(V), floor(V)+1)`；对非负数 `trunc` 等于 `floor`，故 `Math.trunc(V̂+1e-7) = floor(V)`。

**第 4 步：整数情形。** 若 `V(g) ∈ ℤ`，由第 2 步 `|V̂ - V| < 1e-7`，于是

```text
V <= V̂ + 1e-7 < V + 1e-7 + 1e-7 < V + 1
```

第一个不等号来自 `V̂ > V - 1e-7`；两端都是非负数，`trunc` 保持区间 `[V, V+1)` 的下确界 `V`，故 `trunc(V̂+1e-7) = V = floor(V)`。∎

**注 1**：整数情形也覆盖了「`V` 是整数的除法恰好正确舍入」这一常见直觉；本文不依赖该直觉，只依赖误差界 `< 1e-7`。

**注 2**：`1e-7` 容差对负值是错误方向的（见 Lemma 4.5）。第 3 步需要 `V >= 0` 才能把 `trunc` 当作 `floor`；在正式候选路径上 `V >= 0` 由 Lemma 4.3b 结构性成立（`g >= 0` 来自 A8），**不是**额外的运行时前提；`g <= 10^7` 才是本引理自己的浮点误差界安全上限。两条缺一不可：`V >= 0` 保证取整方向一致，误差界保证不跨整数边界。

### 5.4 Theorem 4.6 的证明

`∀g ∈ [0, min(G_max, 10^7)]`：Lemma 4.2 给出 `value - base = g`；Lemma 4.3 给出 canonical 表达式的实参为 `V(g)` 或 `mult·floor(V(g))` 形式；Lemma 4.4 把生产的 `Math.trunc(·+1e-7)` 替换为精确 `floor`；合并即得 `equippedAttributeTier = c + mult·floor((ag+b)/q)`。∎

### 5.5 Lemma 4.5 的证明（定义域外反例）

逐条由定义直接计算（`verify.mjs` 第 4 节调用**生产** `equippedAttributeTier` 断言）：

- `ℓ=70, j=WHM, σ=CRT, g=-450`：`div=900`，实参 `V = 200·(-450)/900 + 50 = -50`（精确整数）。生产 `Math.trunc(-50 + 1e-7) = Math.trunc(-49.9999999) = -49`；精确 floor 为 `-50`。不一致。
- `g=-1000`：`V = -222.222... + 50 = -172.222...`；精确 floor `-173`；`trunc(V+1e-7) = trunc(-172.2222...) = -172`。不一致。
- `ℓ=70, j=WHM, σ=DHT, g=-1`：`V = -550/900 = -0.6111...`；精确 floor `-1`；`trunc(-0.6111...) = 0`。不一致。

失败机理：对负实参，`trunc` 是向零取整（= `ceil`），而 `+1e-7` 又把精确负整数向上推过整数边界；两者叠加使 canonical 值一般比精确 floor 大 1（或 2）。生产候选模型只产生非负贡献（装备/魔晶石/食物副属性均非负，cap 只截断上界），所以这不是可达缺陷（Lemma 4.3b + A8 保证正式候选路径 `g >= 0`）；但 `equippedAttributeTier` 是导出函数，建议在外部调用边界保留 `g >= 0` 断言以防误用，该断言是防御性的，不是本文定理的正确性前提。∎

### 5.6 Theorem 4.7（阈值）的证明

对 `∀k ∈ ℤ`，`n_k = ⌈(k-c)/mult⌉` 是满足 `mult·n >= k - c` 的最小整数 `n`。对任意整数 `g`：

```text
t(g) >= k
⟺ c + mult·floor((a·g+b)/q) >= k
⟺ mult·floor((a·g+b)/q) >= k - c
⟺ floor((a·g+b)/q) >= n_k                 （mult > 0，两侧同除；左边整数，取最小可行 n）
⟺ (a·g+b)/q >= n_k                        （floor(x) >= n ⟺ x >= n，n 为整数）
⟺ a·g + b >= n_k·q
⟺ a·g >= n_k·q - b
⟺ g >= (n_k·q - b)/a
⟺ g >= ⌈(n_k·q - b)/a⌉ = g_k               （g 为整数，a > 0）
```

由此：

1. `g = g_k` 满足全部等价式，故 `t(g_k) >= k`；
2. 若整数 `g < g_k`，最后一步不成立，等价链反向给出 `t(g) < k`，即最小性；
3. `k_1 <= k_2 ⟹ n_{k_1} <= n_{k_2} ⟹ n_{k_1}q - b <= n_{k_2}q - b ⟹ g_{k_1} <= g_{k_2}`（`⌈·⌉` 单调）；
4. `t(0) >= k ⟺ 0 >= g_k`（由 1、2：`g_k` 是最小见证，而 `0` 是域内候选）。因此 `k <= t(0) ⇒ g_k <= 0 ⇒ ĝ_k = 0`；`k > t(0) ⇒ 0` 不是见证 ⇒ `g_k >= 1`；
5. 对非格点 `k`，`n_k = n_{c+mult·n_k}`，故阈值相同。∎

### 5.7 Theorem 4.8（跳档成本）的证明

设 `k ∈ c + mult·ℤ`，`n = (k-c)/mult ∈ ℤ`，`N = n·q - b`。则 `g_k = ⌈N/a⌉`、`g_{k+mult} = ⌈(N+q)/a⌉`。

对整数 `N, a > 0` 有恒等式 `⌈N/a⌉ = floor((N + a - 1)/a)`。令

```text
M = N + a - 1 = a·floor(M/a) + s,   s = M mod a ∈ {0, ..., a-1}
```

于是 `g_k = floor(M/a)`，且

```text
M + q = a·floor(M/a) + a·floor(q/a) + (s + q mod a)
```

其中 `0 <= s + (q mod a) <= (a-1)+(a-1) < 2a`。因此

```text
g_{k+mult} = floor((M+q)/a) = floor(M/a) + floor(q/a) + floor((s + q mod a)/a)
c_k = g_{k+mult} - g_k = floor(q/a) + [s + (q mod a) >= a]
```

而 `s = (N + a - 1) mod a = (n·q - b + a - 1) mod a`。由于右端指示量只取 0/1 且 `floor(q/a) <= q/a <= ceil(q/a) = floor(q/a) + [q mod a > 0]`，得 `c_k ∈ {floor(q/a), ceil(q/a)}`。∎

**成本 0 的语义**：若 `c_k = 0`，则 `g_{k+mult} = g_k =: g*`，由最小性有 `t(g*-1) < k`，由充分性有 `t(g*) >= k+mult`。若存在整数 `g` 使 `t(g) = k`：由 `t(g) >= k` 得 `g >= g_k = g*`；若 `g = g*` 则 `t(g*) >= k+mult > k`；若 `g > g*` 则 `t(g) >= t(g*) >= k+mult > k`。两种情况都矛盾，故**没有任何整数 `g` 满足 `t(g) = k`**（档位 `k` 被跳过）。由公式，`floor(q/a) = 0 ⟺ q < a`；在本项目参数中唯一满足的是等级 50 DHT（`q=341 < a=550`，脚本实测成本集 `{0,1}`），其余实例 `q > a` 故成本至少 1。∎

### 5.8 Theorem 4.9（周期）的证明

1. 由 `d = gcd(a,q)`，`P = q/d`、`a·P/q = a/d ∈ ℤ`。对 `∀g ∈ ℤ`：

   ```text
   floor((a(g+P)+b)/q) = floor((ag+b)/q + aP/q) = floor((ag+b)/q) + a/d
   ```

   （floor 平移整数不变），故 `t(g+P) = c + mult·(floor((ag+b)/q) + a/d) = t(g) + mult·a/d = t(g) + shift`。对负 `g` 同样成立（floor 是整数平移不变的）。
2. 记 `S_k = {g ∈ ℤ : t(g) >= k}`。由 1，`S_{k+shift} = {g : t(g) >= k+shift} = {g : t(g-P) >= k} = S_k + P`。两个集合都非空且都有下界（`t` 随 `g → +∞` 无界增长），故最小值相差 `P`：`g_{k+shift} = g_k + P`。
3. `c_{k+shift} = g_{k+shift+mult} - g_{k+shift} = (g_{k+mult} + P) - (g_k + P) = c_k`。
4. `a·P = a·q/d = q·(a/d) ≡ 0 (mod q)`，故 `r(g+P) = r(g) = a·g+b mod q`。
5. 窗口引理：`floor((a(g+δ)+b)/q) - floor((ag+b)/q) = floor((r(g) + a·δ)/q)`（因为 `a·g+b = q·floor((ag+b)/q) + r(g)`）；乘 `mult` 即得。∎

**边界说明**：第 2 条在未截断整数阈值上成立；定义域裁剪后的 `ĝ_k = max(0, g_k)` 在 `g_k <= 0` 或 `g_{k+shift} <= 0` 的边界处会被同时压到 0，因此 `ĝ_{k+shift} = ĝ_k + P` 可能失效（这是定义域裁剪的伪影，不是周期性的失败）。

### 5.9 Corollary 4.10 的证明

1. `t(g+1) - t(g) = c + mult·floor((a(g+1)+b)/q) - c - mult·floor((ag+b)/q)`
   `= mult·(floor((ag+b+a)/q) - floor((ag+b)/q)) >= 0`，因为 `a/q > 0` 且 floor 单调。
2. **严格跳变**：若 `t(g) > t(g-1)`，则 `t(g)` 是档位格值且 `t(g-1) < t(g)`，故 `g` 是档位 `t(g)` 的最小见证，`g = g_{t(g)}`。反之若 `g = g_k`（`k ∈ c + mult·ℤ`），由 Theorem 4.7 有 `t(g-1) < k <= t(g)`，故 `t(g) > t(g-1)`。
3. 因子差：`F_C(t+1) - F_C(t) = (t+1)(t+1+b_C) - t(t+b_C) = 2t + 1 + b_C > 0`（`t >= 0`，`b_C > 0`）；`F_H(t+1) - F_H(t) = 1`；`F_D(t+mult) - F_D(t) = mult > 0`（档位增量为 `mult`）。`g ↦ F(t(g))` 是「非减序列 ∘ 非减映射」，故非减；严格增当且仅当该步 `t` 严格增，即 `g = g_k`。∎

### 5.10 Corollary 4.11 的证明

由实例表 `t(0)`：CRT `c + mult·floor(b/q) = 50+0 = 50`（普通）/ `250`（BLU）；DHT `0` / `200`；DET `detTrunc·floor(1000·det/(det·detTrunc)) = detTrunc·floor(1000/detTrunc) = 1000`（`detTrunc ∈ {1,2,5}` 均整除 1000）；TEN `1000 + 0 = 1000`。再由 Corollary 4.10 的单调性，`g >= 0` 时档位不低于 `t(0)`，代入因子即得下界；`F_C(50)=1e6+50·400=1,020,000`、`F_C(250)=1e6+250·400=1,100,000`（BLU 的 `b_C=150`：`F_C(250)=1e6+250·400`，此处 `t+b_C = 250+150 = 400`，同值）、`F_H(0)=4000`、`F_H(200)=4200`、`F_D(1000)=1000`。∎

### 5.11 Corollary 4.12 的证明

1–2：由 Theorem 4.6/4.7 的域限制直接得到（闭式只在 `[0, G_max]` 内是搜索的可用语义）；`g_k > G_max` 时不存在域内见证，返回「不可达」是唯一正确语义。
3：cap 在档位公式之前作用于贡献；`g` 是 cap 之后的值，所以定理直接作用于最终贡献；cap 饱和意味着 `g` 到达平台，档位不再变化。
4–5：Lemma 4.5 与 A3。
6：A4/A5 是 Lemma 4.2–4.4 的前置条件，失败即闭式链断裂。∎

---

## 6. 反例 / 边界与退化情形

1. **定义域外负贡献（不可达，仅稳健性）**：Lemma 4.5 的三个精确反例。`g = -450` 给出 canonical `-49` vs 精确 `-50`。由 Lemma 4.3b + A8，正式候选路径不产生负贡献，故这不是可达缺陷；导出 API 仍建议在外部边界加断言以避免误用。
2. **非整数贡献（定义域外）**：Theorem 4.7/4.8 的阈值语义只对整数 `g` 定义；Lemma 4.4 的 `1/q` 间隔论证也依赖 `a·g+b` 为整数。若未来模型允许小数贡献，必须重新证明，不能沿用本文阈值。
3. **跳档成本 0（跳档）**：等级 50 DHT 普通 `t(0)=0, t(1)=1, t(2)=3`，档位 2 被跳过，`c_2 = 0`。这是 `a > q`（550 > 341）的退化情形，不是错误；所有「档位唯一对应一段贡献区间」的直觉在此失效。
4. **跳档成本恒定**：等级 60 CRT 普通 `d = 200`，`P = 3`，`shift = 1`，成本恒为 3（`q mod a = 0`），没有 min/max 锯齿。
5. **BLU 等级上限**：BLU `maxJobLevel = 80`，因此 `(BLU, 90)`、`(BLU, 100)` 实际不可达；本文代数恒等式仍对它们成立（脚本覆盖），但任何「BLU 100 级」结论都必须先证可达性，不能默认。
6. **`G_max` 边界**：阈值 `g_k > G_max` 不可达；所有查询必须与 `G_max` 比较，不能外推。例如等级 50 DHT 普通在 `G_max < g_1 = 1` 时域内只有基线档位（`t = 0`），任何 `t >= 1` 的档位查询都应返回「不可达」。
7. **数据漂移**：A4 的四条是当前生成数据的事实。若 `baseStats`/`clanStats`/`statModifiers`/`schema.stats` 变化（例如新增一个给 CRT 提供 `main` 加成的职业），Lemma 4.2 立即失效，档位不再等于 `g` 的函数；`verify.mjs` 第 1 节会失败，必须以失败告警为准并重新证明。
8. **浮点语义漂移**：A5 假设 binary64 RN；若运行环境使用扩展精度/FMA 重结合改变了舍入路径，Lemma 4.4 的误差界需重算（现代 V8 的普通数运算符合 binary64 RN）。

---

## 7. 依赖与关联定理

| 关联 | 关系 |
| --- | --- |
| [canonical-evaluator-reference.md](../../canonical-evaluator-reference.md) | 共同事实基础：等级参数表、基础属性归约、整数模型、截断语义、定义域。本文把其 §2.1/§3/§3.1 的结论证明到「任意整数 `g`」并补齐误差界与周期/阈值闭式 |
| [tier-log-curvature](../tier-log-curvature/README.md) | 下游（评论 2 §二）：在本文的档位域 `t >= 0` 与因子定义上证明 CRT 的对数凸凹切换、DHT/DET 的对数凹；其可达区间前提使用本文的阈值 `g_808` |
| [raw-marginal-envelope](../raw-marginal-envelope/README.md) | 使用本文 Theorem 4.9 的周期/余数结论，进一步证明窗口增益引理与 raw 级严格包络 |
| [marginal-comparison](../marginal-comparison/README.md) | 跨属性边际比较需要本文的阈值与跳档成本作为输入 |
| [free-budget-upper-bound](../free-budget-upper-bound/README.md)、[simplex-vertex-reduction](../simplex-vertex-reduction/README.md) | 档位三元组精确预算查询使用本文阈值费用 `g_k` 与 `c_k` |
| [joint-loss-sum-bound](../joint-loss-sum-bound/README.md) | 联合上界在档位坐标上使用本文的单调性/正性结论 |
| `verification/canonical-model.mjs` | 有限域工具；`verify-canonical-model.mjs` 已对 1,572,524 个档位点与 39,744 个因子点逐点对照生产 evaluator（PASS） |

---

## 8. 与 canonical evaluator 的对应

| 本文结论 | 生产实现位置 | 状态 |
| --- | --- | --- |
| 基础属性归约 `base = sub`（CRT/DHT/TEN）、`main`（DET） | `equipped-effects.ts:186-201`（`getBaseStats`）+ 生成数据 `baseStats/clanStats/statModifiers` | 已实现（数据驱动，非硬编码） |
| 面板值构造 `value = base + g` | `equipped-effects.ts:125-127` | 已实现 |
| CRT 公式 `50+200β+floor(200g/div)` | `equipped-effects.ts:138-140` | 已实现（含 `Math.trunc(+1e-7)` 截断） |
| DHT 公式 `200β+floor(550g/div)` | `equipped-effects.ts:144-146` | 已实现 |
| DET 公式 `detTrunc·floor((140g+1000·det)/(det·detTrunc))` | `equipped-effects.ts:141-143` | 已实现（常数 `1000` 在除法内部；`detTrunc` 在 floor 外乘回） |
| TEN 公式 `1000+floor(112g/div)` | `equipped-effects.ts:147-149` | 已实现 |
| 截断语义 `Math.trunc(v+1e-7)` | `equipped-effects.ts:163-166` | 已实现；本文 Lemma 4.4 证明其在可达域（`g >= 0`，由 Lemma 4.3b 结构性成立）上等价精确 floor；`g < 0` 不可达（Lemma 4.5 仅稳健性） |
| 因子 `F_C/F_H/F_D` | `equipped-effects.ts:97-98`（CRT/DHT）、`:95-96`（DET/TEN 因子） | 已实现 |
| 阈值公式 `g_k` | 无生产实现；验证工具 `verification/canonical-model.mjs:115-120` | **未实现于生产**（本文给出可实现的闭式；若落地需遵守 §9 前提） |
| 周期公式 `P/shift` | 无生产实现；验证工具 `canonical-model.mjs:123-127` | **未实现于生产** |
| 跳档成本 `c_k` | 无生产实现；验证工具 `verify-canonical-model.mjs` 第 6c 节有有限域对照 | **未实现于生产** |
| 精确乘积与安全比较 | `exact-mip-candidate-upper-bound.ts:96-111`、`:114-140` | 已实现；本文 Corollary 4.11 的正性满足其 `safeDamageFactors` 前提 |

生产 `equippedAttributeTier` 目前在**每个 `g` 上直接套公式**，不查询阈值/周期表；本文的闭式只用于「一次性证明、复用查询」的分析层，不改变生产语义。

---

## 9. 应用前提与安全回退

### 9.1 运行时前提清单（全部通过才允许使用闭式/阈值/周期层）

1. `ℓ ∈ ℒ = {50,60,70,80,90,100}`，且 `jobSchemas[j]`、`jobLevelModifiers[ℓ]` 存在（否则回退 canonical）。
2. `σ ∈ {CRT, DHT, DET, TEN}`；`β` 与 `j = BLU` 一致；BLU 的等级 `<= 80`（`BST <= 50`）。
3. `g` 为整数且 `0 <= g <= min(G_max, 10^7)`；其中 `g >= 0` 由 A4 + A8 结构性成立（Lemma 4.3b），**无需运行时检查**。若本层被外部调用方用于非正式候选输入（负贡献），则不进入本文定理（见 Lemma 4.5）；导出 API 边界的防御性断言可保留。
4. A4 + A8 数据事实在启动时（或数据版本变更时）重新核验：`baseStats` 映射、`statModifiers`/`clanStats` 无四属性键、`schema.stats` 含 `CRT/DHT/DET`、等级参数表未变；生成数据与候选构造的贡献项逐项非负（装备属性、自定义参数值、魔晶石、食物 `stats/statRates`、非负食物参数校验）。任一失败 ⇒ 闭式层禁用；`g >= 0` 与档位实参非负（Lemma 4.3b）依赖 A4+A8。
5. A5 源码语义未变（`floor = Math.trunc(v+1e-7)`、四分支公式）；若源码变更，本文引用行号与证明前提失效。
6. 阈值查询：`k` 应落在档位格 `c + mult·ℤ`（或按 Theorem 4.7(5) 映射到下一格点）；若 `g_k > G_max` 返回「不可达」，若 `g_k <= 0` 用 `ĝ_k = 0`。
7. 周期查询：只对未截断的整数阈值使用 `g_{k+shift} = g_k + P`；域裁剪后的 `ĝ` 序列在边界处可能破坏该等式。
8. **坐标契约（外部输入）**：本层全部 `g`、阈值、`G_max` 均是贡献坐标。若调用方只有面板总值 `X(σ)`，必须先换算 `g_CRT = g_DHT = g_TEN = X − sub(ℓ)`、`g_DET = X − main(ℓ)`（等级参数表见参考模型 §2）；不得把面板值直接传入，否则会重复计入基础属性（§13.5 给出 `L70 CRT` 的偏差证书：808 档 vs 888 档）。

### 9.2 条件失败时的安全回退（分层，禁止经验阈值）

- **闭式层不可用**（前提 1–5 任一失败）⇒ 直接调用生产 `equippedAttributeTier` / `createIntegerDamageFactorEvaluator`（与最终安全比较使用同一语义，见 `exact-mip-candidate-upper-bound.ts:128-140`），不做任何近似。
- **只有档位级结论而贡献区间含边界** ⇒ 用精确整数因子逐点求值；不得把定理外推到 `g < 0`。
- **需要上界而曲率/阈值层条件不满足** ⇒ 使用既有严格上界基础设施 `prepareFactorResourceBudgetUpperBound`（`factor-resource-budget-upper-bound.ts:88-147`，基于每档 `(min cost, integer log score)` 的上凸包与 Lagrange 支撑线），它与本文的曲率假设无关，是现成的严格回退。
- **任何情况下都不引入** `CRT >= X`、`DHT <= Y` 之类的经验阈值（Issue #3 正文与评论 2 明确禁止；本文只允许由公式和参数推导出的、带前提检查的结论）。

---

## 10. 验证

### 10.1 本目录 `verify.mjs`（`node --experimental-strip-types docs/mathematical-analysis/theorems/raw-tier-transform/verify.mjs`）

覆盖与结果（PASS）：

| 节 | 内容 | 覆盖量 |
| --- | --- | --- |
| 1 | 归约前提数据事实：`baseStats` 映射、`statModifiers/clanStats` 无四属性键、`schema.stats`、职业上限、等级参数表 | 23 个职业 × 6 个等级的完整检查 |
| 2 | 归约数值对照：整数模型 vs 生产 `equippedAttributeTier` | 276,552 个 `(level,job,stat,g)`，`g ∈ [0,500]` |
| 3 | 截断等价证书：复现生产双精度表达式并核对 `Math.trunc(v+1e-7) = 精确 floor` | 960,048 个 `(level,job,stat,g)`，`g ∈ [0,20000]`；阈值邻域 14,548 点；观测最大浮点误差 `9.095·10^-13` |
| 4 | 定义域外负贡献的截断差异（正式候选路径不可达，仅稳健性） | 3 个显式反例（调用生产 evaluator 断言） |
| 5 | 阈值最小性（含域裁剪）、跳档成本闭式、周期恒等式（含负 `g`）、阈值/成本/余数周期 | 10,608 个阈值点；6 个等级 × 2 种职业 × 4 属性的周期全域检查 |
| 6 | 单调性、因子正性、`t(0)` 基线与 BLU 偏移、DET 档位粒度 | 144,048 个相邻点与因子点 |
| 7 | 实例表与 issue 评论 2 的 13/14、5/6、19/20 交叉核对 | 3 个等级 100 实例 |
| 8 | **baseStat 坐标审计（§13）**：贡献坐标声明、档位实参最小值边界（`V(0)`）、面板↔贡献换算示例、误用面板值的偏差证书 | 6 个等级 × 2 种职业 × 4 个属性的 `V(0)` 有理数边界 + 参考模型 §2.1 的 L70 换算示例 |

### 10.2 既有验证脚本

- `verification/verify-canonical-model.mjs`：PASS；1,572,524 个 `(level,job,stat,g)` 档位点与 39,744 个因子三元组逐点对照生产 evaluator；**第 7 节证书**核对生成数据的贡献非负性（装备属性/自定义参数/魔晶石/食物 `stats/statRates`/BLU 武器伤害查表最小值均 `>= 0`）并逐实例核对 552 个 `(level,blu,stat)` 的档位实参最小值 `V(0)=b/q+c >= 0`（全局最小 0，普通 DHT），即 Lemma 4.3b 的结构性结论；另含 `g=-450` 的定义域外截断差异断言（由 Lemma 4.3b，正式候选路径不可达）。该脚本覆盖 `g ∈ [0,3000]` 的全部职业；本目录 `verify.mjs` 在此基础上补充了 `g` 到 20,000 的截断证书、阈值/成本/周期闭式与 `k` 可为负的阈值最小性。
- `verification/search-counterexamples.mjs`：不属于本文（用于后续否证性定理），未调用。

### 10.3 证明作用与边界

- 上述脚本是**有限域证书**：它们排除「在所列范围内定理与生产实现不一致」，并锁定数据/源码前提；它们**不构成一般性证明**。
- 一般性证明在 §5：Lemma 4.2/4.3 由源码与数据事实推导，Lemma 4.3b 给出可达域内实参非负；Lemma 4.4 是解析误差界（对任意 `g ∈ [0,10^7]`），Theorem 4.7/4.8/4.9 是纯整数恒等式（对任意 `k`、任意整数 `g`）。
- 脚本对 `k` 为负、`g` 为负的周期恒等式使用**精确整数 floor**（`canonical-model.mjs` 的 `floorDiv`）而非生产浮点；这些点已超出生产可用域，只用于验证恒等式本身。
- §13 的坐标审计另有独立断言（第 8 节）：贡献坐标声明、档位实参最小值边界、面板↔贡献换算示例与「误用面板值」的偏差证书。

---

## 11. 未解决问题

1. **`G_max` 的真实上界未由本文给出**。`G_max` 是运行时输入（候选池、同步 cap、魔晶石、食物上界）；本文只要求 `G_max <= 10^7`。若未来模型允许更大贡献，Lemma 4.4 的误差常数需重算（`3·2^-52·M < 1e-7` 对 `M` 有显式上限）。
2. **浮点语义未形式化**。Lemma 4.4 依赖 IEEE-754 binary64 + RN 的标准误差界；未用 SMT/Lean 对 JS 语义出形式化证书。不同引擎若引入扩展精度或 FMA 重结合，需要重新验证（当前 V8 普通运算符合 binary64 RN）。
3. **数据归约的自动断言未落地**。A4 是数据事实，`verify.mjs` 在测试时检查；建议在生成数据装载处（`src/domain/data.ts`）或搜索初始化时加轻量断言，数据更新失败即拒绝闭式层（目前只有测试脚本覆盖）。
4. **主属性与 SKS/SPS 分支不在本文**：`equipped-effects.ts:130-137`（主属性，含 `partyBonus`）与 `:150-152`（SKS/SPS）有各自的公式结构，可能需要单独的归约与浮点等价证明。
5. **导出 API 的定义域外行为**：`equippedAttributeTier` 内部没有 `g >= 0` 检查；正式候选路径由 A4 + A8 保证非负（Lemma 4.3b），但公开 API 若被传入负贡献、负食物参数或自定义 extractor，会进入 Lemma 4.5 的差异区。本文只给反例并建议在外部边界加断言。
6. **阈值/周期查询器未实现于生产**：若要在搜索/MIP 中使用，需要定义接口契约（不可达返回值、域裁剪、BLU 等级上限、与 `G_max` 的一致性），本文只给出数学形式。
7. **共享验证工具的负分子 `ceilDiv`（已修复）**：本文初稿发现 `verification/canonical-model.mjs` 的 `ceilDiv(n, q)` 对 `n < 0` 会多进 1（BigInt 商向零截断，旧实现只在余数非零时统一 `+1`）。该函数已修复为：`n < 0` 且余数非零时直接返回截断商（它已经是 `ceil`），`n > 0` 且余数非零时才 `+1`；修复后 `ceilDiv(-5,2) = -2`、`ceilDiv(-7,3) = -2`、`ceilDiv(-1,3) = 0`，`verify-canonical-model.mjs` 与 `verify-theorem-claims.mjs` 仍 PASS。本文 `verify.mjs` 保留本地 `ceilDivSigned` 作为独立复核，并进一步在**全部 `k`**（含 `k < t(0)` 的负阈值）上与共享 `firstContributionWithTierAtLeast` 交叉断言一致。

---

## 13. baseStat 影响审计（贡献坐标 vs 面板总值）

> 本节是对「基础属性是否影响定理 A」的逐条审计（用户要求的第二轮核对）。审计结论：**本文的定理内容不受 baseStat 影响，无需重新证明**；受影响的是**输入坐标契约**——所有外部数值必须先换算到贡献坐标。除 Lemma 4.2（归约本身）外，本文没有命题需要面板坐标。

### 13.1 坐标声明

本文涉及三种坐标，逐一定义并注明使用者：

| 坐标 | 定义 | 本文中的出现位置 |
| --- | --- | --- |
| **面板总值** `X(σ)` | 角色面板显示的 CRT/DHT/DET/TEN 总值（`equippedEffects` 路径里 `equippedStats[stat]`） | 仅 §5.1 Lemma 4.2 的归约证明（`value = base + g`）与 §13.5 契约；**没有任何定理以面板值为自变量** |
| **贡献坐标** `g` | 装备 + 镶嵌 + 自定义/义军武器 + 食物带来的属性贡献；生产候选模型的直接变量 | `g`、`g_k`、`ĝ_k`、`c_k`、可达域 `[0, G_max]`、§4.13 实例表的阈值、§4.14 示例、§6/§9 的区间、§10 验证循环 |
| **档位坐标** `t` | `equippedAttributeTier` 的输出 | 因子 `F_C/F_H/F_D`、档位下界 `t(0)`、DET 粒度；不直接参与本文阈值公式（阈值以贡献表示） |

换算（参考模型 §2.1，等级参数 `main/sub` 见参考模型 §2）：

```text
X_CRT = sub + g,   X_DHT = sub + g,   X_TEN = sub + g,   X_DET = main + g
⟺ g_CRT = g_DHT = g_TEN = X − sub,   g_DET = X − main
```

**判定**：§2.3 的定义域、§3 A3、§4.13/§4.14、§6、§9 的「区间/阈值/示例」全部是贡献坐标，表述明确；未发现把面板总值称为 `g` 或把 `g` 当作面板值的命题。

### 13.2 baseStat 归约链（引用参考模型 §2.1/§2.2）

1. **构造**：`equipped-effects.ts:127` 先算 `value = (baseStats[stat] ?? 0) + gearAndFoodValue`，再在四个分支减去 `sub`（CRT/DHT/TEN）或 `main`（DET）。
2. **基础值**：`getBaseStats`（`:178-203`）+ 数据事实 A4 —— `baseStats.CRT = baseStats.DHT = baseStats.TEN = "sub"`、`baseStats.DET = "main"`；`statModifiers` 缺省 100；`clanStats` 无四个副属性键；TEN 由预设值 `levelMod.sub` 覆盖（`:186`）。
3. **抵消**：`value − sub = g`、`value − main = g`（Lemma 4.2），因此档位只依赖贡献 `g`、`(level, BLU)` 与 `σ`。
4. **非负**：正式候选路径的贡献逐项非负（A8；生成数据扫描与构造代码见参考模型 §2.2），故可达域内 `g >= 0`。
5. **实参非负**：`g >= 0` ⇒ 四个分支 floor 实参 `V >= 0`（Lemma 4.3b：CRT `>= 50`、DHT `>= 0`、DET `>= 200`、TEN `>= 1000`）。
6. **截断等价**：`V >= 0` 使 `Math.trunc(V + 1e-7) = floor(V)` 在可达域无条件成立（截断方向一致）；浮点误差界（`< 1e-7`）是另立的第二条件（Lemma 4.4，`g <= 10^7` 仅为该误差界的安全上界）。

共享证书：`verification/verify-canonical-model.mjs` 第 7 节（`reachable-domain-nonnegativity`）在生成数据上扫描出贡献项最小值 `{gearStat:1, customParameterValue:21, materiaValue:1, foodStat:1, foodStatRate:7, bluWeaponAddition:12}`（均 `>= 0`），并对 552 个 `(level, blu, stat)` 组合核对档位实参最小值 `V(0) = b/q + c >= 0`（全局最小 `0/341`，即 50 级普通 DHT 在 `g=0` 处的 0）。本目录 `verify.mjs` 第 8 节重复了该边界并加入坐标换算断言。

### 13.3 逐命题受影响判定

| 命题 | 坐标 | 直接依赖 baseStat？ | 判定与理由 |
| --- | --- | --- | --- |
| Definition 4.1（档位模型/阈值） | `g`、`t` | 否 | 模型以贡献 `g` 为输入；阈值由 `(a,b,q,c,mult)` 定义 |
| Lemma 4.2（基础属性归约） | **面板 `value` 与 `g`** | **是（归约本身）** | 唯一使用面板坐标的命题：显式证明 `base = sub/main` 且 `value − offset = g`；这正是把面板换算到贡献的桥梁 |
| Lemma 4.3（canonical 归约形式） | `g` | 是（经 Lemma 4.2 抵消） | 分支实参写成 `200g/div+c` 等，`base` 已抵消；不受影响 |
| Lemma 4.3b（实参非负） | `g`、`V` | 是（经 Lemma 4.2） | 由 `g >= 0` 与分支常数推出 `V >= 0`；不受影响 |
| Lemma 4.4（binary64 截断等价） | `g`、`V` | 是（经 Lemma 4.2/4.3b，仅作为实参来源） | 实参 `V(g)` 是贡献导出的有理数，与面板无关；可达域内 `V >= 0` 结构性成立。误差界是独立的第二条证明 |
| Lemma 4.5（定义域外 `g<0` 差异） | `g`（负） | 是（经 Lemma 4.2） | 定义域外稳健性说明；正式候选路径由 A8 保证不可达 |
| Theorem 4.6（tier 恒等式） | `g` | 是（经 4.2→4.4，链式抵消） | 结论 `t = c + mult·floor((ag+b)/q)` 只含 `g/level/BLU/σ`；不受影响 |
| Theorem 4.7（阈值闭式） | `g_k` | 否 | 纯整数恒等式；`g_k` 是贡献阈值 |
| Theorem 4.8（跳档成本） | `g_k` | 否 | 纯整数恒等式 |
| Theorem 4.9（周期/平移） | `g`、`t` | 否 | 纯整数恒等式 |
| Corollary 4.10（单调性） | `g`→`t`、`t`→因子 | 是（经 4.2 的 `t(g)` 映射） | 单调性是贡献→档位映射的性质；不受影响 |
| Corollary 4.11（正性/下界） | `t` | 是（下界来自 `t(0)`，经 4.2） | `t(0)` 由贡献 `g=0` 的公式给出；因子只依赖 `t` |
| Corollary 4.12（cap/`G_max` 边界） | `g` | 否 | 讨论贡献域截断与不可达语义 |
| §4.13 实例表 | `g_k`、`t(0)` | 否 | 公式参数与阈值均为贡献/档位坐标 |
| §4.14 示例 | `g`、`t` | 否 | 已逐项注明贡献坐标 |

### 13.4 数值复核结果

逐个复核本文全部数值示例、反例与表格的输入坐标：

1. **未发现坐标混用的数字**（旧数字=新数字，0 处需要改正）。§4.13 表格、§4.14 示例、§6 边界示例、Theorem 4.9 的 `g_{k+shift}=g_k+P` 实例全部以贡献为输入；`t(0)`、因子下界等以档位为输入。
2. **参考模型 §2.1 换算示例复核**（`L70`：`main=292`、`sub=364`；评论 01 的面板值）：
   - 面板 CRT `739` → 贡献 `375` → `t = 50 + floor(200·375/900) = 133`；
   - 面板 DHT `743` → 贡献 `379` → `t = floor(550·379/900) = 231`；
   - 面板 DET `769` → 贡献 `477` → `t = floor((140·477+1000·900)/900) = 1074`。
   三个档位与评论 01/参考模型 §2.1 的 `133/231/1074` 一致（`verify.mjs` 第 8 节断言）。
3. **误用面板值的偏差证书**（说明为什么必须换算，而不是说本文数字有错）：把面板值直接当贡献代入会多算基础属性的档位：
   - `L70 CRT`：阈值 `g_808 = 3411` 是贡献；面板值为 `364 + 3411 = 3775`。若误把 `3775` 当贡献：`t = 50 + floor(200·3775/900) = 888`，比正确值 `808` 多 `80 = floor(200·364/900)` 档。
   - 全等级偏差（`verify.mjs` 第 8 节断言）：L50 `+200`（`1008` vs `808`）、L60 `+118`（`926` vs `808`）、L70 `+80`（`888` vs `808`）、L80 `+58`（`866` vs `808`）、L90 `+42`（`850` vs `808`）、L100 `+30`（`838` vs `808`）。
   - 在上述 `g_808` 处，偏差恰等于该等级「基础属性自身带来的档位数」（即 `floor((200g_808 + 200·base)/div) − floor(200g_808/div)`，此处为 200/118/80/58/42/30）；一般 `g` 处的偏差还取决于余数类（窗口增量 `mult·floor((r(g)+aδ)/q)`，Theorem 4.9），因此不能用一个常数修正，必须换算输入坐标。
4. **负贡献反例** `g = -450/−1000/−1`：这是「直接向导出 API 传负贡献」的**定义域外**探测（贡献坐标，值为负），不是面板值；正式候选路径由 A8 保证 `g >= 0`，故不构成可达反例。文档已按此措辞（Lemma 4.5/§6.1）。
5. **`G_max`**：定义在贡献坐标（候选池上限减基础值后的可分配贡献）；面板上限 = `base + G_max`。文档未把 `G_max` 解释为面板值。

### 13.5 应用契约（外部只有面板值时）

1. 若调用方持有面板总值 `X(σ)`，先换算到贡献坐标：`g_CRT = g_DHT = g_TEN = X − sub(ℓ)`，`g_DET = X − main(ℓ)`；`(main, sub)` 见参考模型 §2。
2. 不得把面板值直接传给 `equippedAttributeTier(j, ℓ, σ, g)`：该 API 的第四参数是 `gearAndFoodValue`，内部会再加一次 `base`（A6）；传入面板值会重复加基础属性。
3. 不得把贡献值当成面板值传给 `equippedEffects`（`equipped-effects.ts:297-310` 会先 `addStats(baseStats, gearAndFoodStats)`）；两条路径的坐标必须分开。
4. 阈值/周期/`G_max` 的比较全部在贡献坐标进行；结果转面板显示时再 `X = base + g`。
5. 若只有面板值而 `(ℓ, β)` 未知，先用 `jobLevelFor` / `calculationJobLevelFor` 解析等级与 BLU 标记，再按第 1 条换算。
6. 本文不修改任何生产 API 的坐标语义；以上契约只约束「使用本文定理的分析层」。

### 13.6 结论

- **定理内容：不受影响**。除 Lemma 4.2 显式使用面板 `value` 并证明 `base` 抵消外，其余命题只依赖贡献 `g`、档位 `t`、实例参数与整数恒等式；baseStat 不进入任何结论的最终表达式，因此**没有命题需要重新论证**。
- **数值：无需改正**。全部数值示例/反例/表格已复核为贡献坐标（0 处混用）；补充的偏差证书（§13.4 第 3 条）是「误用面板值会怎样」的说明，不是对本文数字的修正。
- **文档与契约：已补强**。§2.3 明确贡献坐标；§3 A3/A6/A8、Lemma 4.3b/4.4/4.5 与 §9.1(8) 给出结构性非负与输入换算契约；本节汇总审计证据。
- **验证：PASS**。`verify.mjs` 第 8 节新增坐标审计断言（贡献坐标、`V(0)` 边界、L70 换算复核、误用偏差证书），与既有全部断言一并 PASS；`verify-canonical-model.mjs` 第 7 节的 552 个实参最小值与数据非负扫描仍 PASS。
