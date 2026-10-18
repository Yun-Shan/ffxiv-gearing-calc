# 三属性贡献和 `S = CRT + DHT + DET` 的最紧安全上界

## 1. 标题与状态

- **目录**：`docs/mathematical-analysis/theorems/substat-sum-upper-bound/`
- **任务来源**：[free-budget-upper-bound](../free-budget-upper-bound/README.md) §10.2 P3 把 `R` 定义为「对每个合法完成 `Σ_i x_i <= R`」的**和**上界，但没有分析如何构造最紧的安全 `R`。本文把「和上界」做成定理：给出**精确最大值**可算的充分条件、一族可证明安全的上界、约束感知的 Lagrangian 上界、部分分支滚动界，以及「sum-only 类内最紧」的精确表述。
- **验证**：[verify.mjs](verify.mjs)，`node --experimental-strip-types` 运行 **PASS**（`checks: 20537`；小型合成实例逐点穷举 + 生产 canonical 食物公式对照）。

### 1.1 状态总表（精确 / 上界 / 条件成立 / 未解决）

| 定理 | 内容 | 状态 |
| --- | --- | --- |
| 定理 1 | `R_sep`（逐属性最大相加）是 gear 和上界；`R_gear`（逐槽 `S3` 最大相加）是 gear 和的**精确**最大值（条件：槽间独立、无跨槽约束；戒指唯一性交给定理 2）；`R_gear <= R_sep` 且有严格分离例 | **已证明**；`R_gear` 的精确性为**条件成立**（条件见定理 1(b)） |
| 定理 2 | 两戒指槽在唯一性下的精确最大 `S3(a)+S3(b)` 的配对算法与正确性 | **已证明（模型内精确）** |
| 定理 3 | 义军武器整数分配对**三目标属性** `I=stats∩{CRT,DHT,DET}` 的总和最大值精确（`min(T,Σ_{i∈I}m_i)`，非目标属性不计入）；**R_sep 逐属性上界 = `S3(x0)+Σ_{i∈I}min(m_i,T)`（固定目标贡献全部保留，不能只对 `I` 求和）**；Manderville 枚举并入候选；逐属性上界会高估 | **已证明（无约束时精确；非目标 stats / 固定目标不在 I 的反例说明下标规则）** |
| 定理 4 | 食物感知上界族 `B1–B4`、`R_food = max_f min_k B_k(f)`；`B4 <= B1,B2`；`B3` 与 `B4` 不可比；比「逐属性食物 max 相加」紧 | **上界已证明**；**精确性仅条件成立**（无食物 / cap 饱和且可达 / 上界被达到）；带食物的精确最大值**未解决**（§12） |
| 定理 5 | 速度上界 / TEN 下界 / TEN 上界的 Lagrangian 上界；对乘子的精确最小化；食物与约束的安全方向替换；积分间隙反例 | **上界已证明，非精确**（可能有积分间隙，已给精确反例） |
| 定理 6 | 部分分支剩余上界 `R_rem(P)` 的合法性；随 `P` 增大单调不增（含食物/约束项） | **已证明** |
| 定理 7 | sum-only 类内最紧：`U` 对 `R` 单调 ⇒ 最小合法**增量预算** `R* = S* − Σ_i b_i`（`b` 为 baseline；`b=0` 时即 `S*`）给出最小 `U`；任何 P3 可认证的 `R >= R*` | **已证明（仅在 sum-only 类内；`R` 是相对 baseline 的增量，不是最终绝对和 `S*`）** |
| 定理 8 | 层级/支配关系表与安全回退 | **部分已证明、部分不可比（显式标注）** |

**本文不做**：搜索、MIP、benchmark、生产集成、性能收益声称；所有数值/算法是精确整数或有理数；浮点只出现在打印。

## 2. 范围与依据

**范围**：单一职业、固定 formula level、同步已应用（`sync` 后的候选属性）；槽位集合见 §3；食物集合是运行时输入。研究对象是**贡献坐标**下三副属性之和 `S = CRT_contrib + DHT_contrib + DET_contrib` 的安全上界 `R`，供 [free-budget-upper-bound](../free-budget-upper-bound/README.md) 的 `U(b,R,κ)` 使用。

**依据**：

1. [canonical-evaluator-reference.md](../../canonical-evaluator-reference.md) §2.1（基础属性归约与面板↔贡献换算）、§2.2（可达域内贡献 `g >= 0`、档位实参非负）、§5（定义域）。
2. [领域与搜索规则](../../../rules/领域与搜索规则.md)：装备/镶嵌/食物顺序（第 9、20 行）、戒指唯一性（第 18、38 行）、自定义武器/义军武器（第 22–28 行）、速度/坚韧约束（第 34 行）、完整性要求（第 44–47 行）。
3. 源码：
   - 槽位：`src/domain/gear-options.ts:14-18`；`src/domain/optimizer/context.ts:115-117`；
   - 候选生成与镶嵌：`src/domain/optimizer/equipment-candidates.ts:359-410`；
   - Manderville：`equipment-candidates.ts:131-158`；
   - 义军武器：`src/domain/types.ts:66-70`、`equipment-candidates.ts:263-281`、`src/domain/search/loadout-finder-exact-mip.ts:5189-5223,5280-5296`；
   - 戒指对枚举：`src/domain/search/ring-pairs.ts:15-57`；唯一性 MIP 行：`loadout-finder-exact-mip.ts:5318-5340`；
   - 食物：`equipment-candidates.ts:325-357`（`baseValue = baseStats`）、`src/domain/search/exact-mip-candidate-upper-bound.ts:40-94`（canonical 公式）、`src/domain/search/joint-substat-reachability.ts:206-214`（有理数实现）、`src/domain/search/loadout-finder-v3.ts:815-819`；
   - 现有「逐属性食物最大」上界：`loadout-finder-exact-mip.ts:1020-1073`；
   - 精确比较语义：`exact-mip-candidate-upper-bound.ts:96-140`。

**坐标声明（必读）**：本文所有 `x(c)`、`speed(c)`、`ten(c)`、食物 `bonus`、`G_i`、`S`、`R`、`κ`、上界族全部是**档位输入贡献**，不是面板总值。由参考文档 §2.1：

```text
面板总值 P_i = baseStats[stat] + 贡献 g（equipped-effects.ts:127）
baseStats.CRT = baseStats.DHT = sub ，baseStats.DET = main
因此 CRT/DHT 贡献 = P - sub ，DET 贡献 = P - main ；CRT 与 DET 的偏移不同，不能统一平移。
```

同理速度/坚韧的等级基础值为 `sub`；食物参数 `baseValue = baseStats[stat]`（即 `sub`/`main`），见 `equipment-candidates.ts:345`。面板三属性总和 = `S + (sub + sub + main)`（同等级/职业为常数），因此「贡献和上界的紧致性排序」与面板和一致。完整换算与审计见 [free-budget-upper-bound](../free-budget-upper-bound/README.md) §13。

## 3. 符号、量词与定义域

### 3.1 槽位、候选与贡献向量

- **槽位集合** `S`：按 `slotsForJob`（`gear-options.ts:14-18`）取「主手、副手（仅 PLD/BST，含盾牌）、头、身、手、腿、脚、耳、颈、腕、戒指×2」；2H 武器只是主手候选（无副手槽），不是额外情形。当前生产优化器**填满所有槽位**；若某个建模允许空槽/可选槽，把零向量 `(0,0,0)` 作为该槽候选即可（本文的定理对「候选集合」成立，不依赖是否含零向量）。题目中的「两枚戒指」用下面两种等价模型之一：
  - **独立两槽模型**：`ring` 与 `ring2` 两个槽，各自候选集合，唯一性作为两槽之间的耦合（定理 2）；
  - **配好对单槽模型**：一个 `rings` 槽，候选集合已经枚举全部合法戒指对（生产 `buildRingPairEquipInfos`，`ring-pairs.ts:15-57`），此时无跨槽耦合。

- **候选**：槽 `s` 的候选集合 `C_s` 是有限集；候选 `c` 携带贡献向量

  ```text
  x(c) = (x_CRT(c), x_DHT(c), x_DET(c)) ∈ Z_{>=0}^3
  ```

  （已包含装备固有属性、镶嵌、自定义参数/义军分配、同步 cap 的结果）。可选携带 `speed(c) >= 0`（SKS 或 SPS 贡献）与 `ten(c) >= 0`（TEN 贡献），不携带时视为 0。

  **义军武器槽的特殊形式**：它不是静态候选枚举，而是 `x0`（固有属性）+ 有界整数分配域（§3.1 的 `C_s` 应理解成「候选 = 分配变量」的有限族）。定理 1(b)/定理 3 给出该槽对**三目标属性**的 `S3` 与逐属性**精确极值/上界**：固定向量 `x0` 的三个目标贡献**全部保留**，只有可分配增量限于 `I = stats ∩ {CRT,DHT,DET}`（非目标属性分配不进入 `S`，见定理 3(2)）。因此其它家系里出现 `max_{c∈C_s}` 的位置，对义军武器槽替换为「在目标分配域上求该式子的精确整数最大值」即可（该最大化仍是有限整数问题；无约束时定理 3 给闭式，带速度/TEN 约束时见定理 5 的注）。

- **一次 gear 选择**：每个槽选一个候选 `(c_s)_{s∈S}`；gear 贡献

  ```text
  G = Σ_{s∈S} x(c_s) ∈ Z_{>=0}^3 ，G_i = Σ_s x_i(c_s)
  S3(c) := x_CRT(c) + x_DHT(c) + x_DET(c)
  ```

- **戒指唯一性**：装备物品有 `itemId` 与 `unique(itemId) ∈ {true,false}`。两戒指候选 `a,b` **合法**当且仅当

  ```text
  itemId(a) != itemId(b)  或  unique(itemId(a)) = false（同 ID 非唯一允许）
  ```

  `unique` 元数据缺失/不一致视为不可认证（回退，§10）。主手/副手与其它槽之间无唯一性耦合。

- **空槽/可选槽**：把零向量放入 `C_s` 即表示「该槽可选为空」；本文所有结论只依赖候选集合，不依赖槽是否必填。

### 3.2 食物模型

食物集合 `F`（运行时由优化器给出；生产还会按 `config.foodId`/`best` 过滤，见 `equipment-candidates.ts:412-416`，本文不依赖该过滤）。另记 `⊥` 表示「无食物」，`bonus_i^⊥ = 0`。

对 `f ∈ F`、属性 `i ∈ {CRT,DHT,DET}`，食物参数为

```text
cap_i^f >= 0            （每项加成上限，FoodParam.maxValue）
r_i^f = p_i^f / q_i^f   （statRate/100 的既约有理数，p,q 为非负整数，multiplier = 1 + p/q）
base_i                  （= baseStats[stat]：CRT/DHT 为 sub，DET 为 main；equipment-candidates.ts:345）
```

「某属性无食物参数 / rate = 0 / cap = 0」时该属性加成为 0。**canonical 加成公式**（贡献坐标；`G_i` 是装备+镶嵌贡献）：

```text
bonus_i^f(G_i) = min( cap_i^f , floor( (G_i + base_i) · p_i^f / q_i^f ) )
```

这与生产实现逐点一致：`Math.min(maxValue, Math.trunc((raw+baseValue)*(multiplier-1)+1e-7))` 在可达域等于上面的有理数 floor（`exact-mip-candidate-upper-bound.ts:62-75` 用有理数交叉验证；`joint-substat-reachability.ts:206-214` 的 `applyFood` 直接用 `floor(raw+base)*num/den`；verify.mjs 对 9048 个点做了对照）。同一 food 对同一属性最多一个参数（生产 `maximumFoodBonusTables` 在 `matches.length > 1` 时放弃该上界，`loadout-finder-exact-mip.ts:1036-1039`），本文假设该结构成立，否则回退。

**最终三属性贡献与和**：

```text
g_i = G_i + bonus_i^f(G_i)            （i ∈ {CRT,DHT,DET}）
S(G, f) = Σ_i g_i = Σ_i G_i + Σ_i bonus_i^f(G_i)
```

**无食物/有食物的选择**：若优化器允许「无食物」，则实际食物取 `f ∈ F ∪ {⊥}` 之一；若食物必选（生产在有食物时用 `choose_food = 1`，`loadout-finder-exact-mip.ts:5358-5367`），则 `f ∈ F`。**任何上界必须对实际可能的每一个 `f` 都成立**，因此后文对 `f` 取 `max`。

### 3.3 约束

- **速度带上界**：最终速度 = 等级基础 `sub` + gear 速度贡献 + 食物速度加成。GCD/速度上界换算到贡献坐标系：`v_hi ∈ Z` 使得

  ```text
  V(G,f) := Σ_s speed(c_s) + bonus_speed^f(Σ_s speed(c_s)) <= v_hi 。
  ```

  下界 `v_lo` 对**和的上界**没有帮助（放宽它只会变大），本文只用上界；`v_lo` 只在精确求解/DP 时使用。

- **TEN 下界/上界**：最终 TEN = `sub` + gear TEN + 食物 TEN。

  ```text
  T(G,f) := Σ_s ten(c_s) + bonus_TEN^f(Σ_s ten(c_s)) >= t_lo      （最低坚韧/减伤换算）
  T(G,f) <= t_hi                                                   （最高坚韧，若启用）
  ```

  `t_lo, t_hi` 同样是贡献坐标（面板约束减 `sub`）。

- 当某个约束不启用时视为无约束。

### 3.4 「安全上界」「精确最大值」「sum-only 类」

- **合法完成**：一次 gear 选择 + 一个实际食物 `f`，满足戒指唯一性与全部启用的速度/TEN 约束（以及候选集合本身的合法性）。
- **安全上界**：整数/有理数 `R` 满足：对**每个合法完成**，`S(G,f) <= R`。上界不要求可达。
- **精确最大值**：`S* := max_{合法完成} S(G,f)`（**最终绝对贡献和**）。候选集合有限（义军分配也是有限整数域），食物集合有限，故最大值**存在并可达**。注意：`U(b,R,κ)` 的 `R` 是相对 baseline `b` 的**增量**预算；把 `S*` 当 `R` 只在 `b=0` 时正确，一般需用 `R* = S* − Σ_i b_i`（定理 7）。
- **sum-only 类 `C(b,κ)`**：所有只通过一个和上界 `R` 进入 `U(b,R,κ)` 的构造（[free-budget-upper-bound](../free-budget-upper-bound/README.md)）。本文只在这个类内讨论「最紧」。

## 4. 假设

- **(A1) 有限、整数、可认证的候选域**：每个 `C_s` 有限；`x(c)`、`speed(c)`、`ten(c)` 是非负安全整数；戒指 `itemId/unique` 元数据一致（同 ID 同 unique）；义军分配是整数且边界有限。
- **(A2) 槽间结构**：除戒指唯一性外无跨槽耦合；槽候选集合是「该槽允许的全部候选」的超集（若上游做过 Pareto/支配剪枝，必须另有「不改变所考虑最大值」的证明；本文不把未证明的剪枝当作安全前提，见 §10 P2）。
- **(A3) 食物结构**：§3.2 的 canonical 公式与参数校验成立（每个 food 每属性至多一个参数、`cap >= 0`、`multiplier >= 1`、`baseValue = baseStats`、有限）。否则该食物/该食物界不可认证，回退。
- **(A4) 约束坐标**：速度/TEN 带已由最终值换算为贡献坐标（减去等级基础 `sub`）；换算错误会使界不安全，不能在定理内部自动修复。
- **(A5) 无 magic constant**：本文不引入任何经验系数、等级/职业 magic case；所有分支由显式条件（cap 是否绑定、候选是否同时可取、`f` 的取值集合等）决定。
- **(A6) 精确算术**：所有比较多用整数或 `BigInt` 分数；浮点只用于打印/提出猜想。

## 5. 精确命题

### 定理 1（gear 和：可分界 vs 联合值）

记

```text
R_sep  := Σ_i Σ_s max_{c∈C_s} x_i(c)              （逐属性最大相加）
R_gear := Σ_s max_{c∈C_s} S3(c)                    （逐槽总和最大相加；先忽略戒指唯一性）
R_gear^uniq := 同 R_gear，但两戒指槽用定理 2 的精确配对值替换
```

1. **（上界）** 对任意合法 gear 选择：`Σ_i G_i <= R_sep`；若再加「无食物」则 `S = Σ_i G_i <= R_sep`。戒指唯一性只缩小合法对集合，故 `R_sep` 仍是合法上界。
2. **（精确性，条件成立）** 若 (i) 槽间独立（戒指用「配好对单槽」或定理 2 的精确配对；无其它跨槽约束），(ii) 每个槽的候选集合就是该槽的合法候选集，则 `R_gear^uniq` **等于** `max Σ_i G_i`，且存在同时取到每槽最大值的合法 gear 选择。若无速度/TEN 约束且无食物，则它也是 `S*`。
3. **（支配）** `R_gear^uniq <= R_gear <= R_sep`。前一个不等号由定理 2；后一个由 `S3(c) = Σ_i x_i(c) <= Σ_i max_{C_s} x_i` 对每个槽求和。
4. **（严格分离）** `R_gear <= R_sep` 可以严格：单槽候选 `(100,0,0)`、`(0,100,0)` 时 `R_sep = 200`，`R_gear = 100`。「逐属性最大相加」系统性高估**联合和**。
5. **（约束下不再精确）** 若速度/TEN 约束启用，`R_gear` 仍合法但一般不是精确最大值（精确值是带二维约束的背包，§12）；`R_sep` 仍是合法上界（约束只缩小可行集）。

**注意**：`R_sep` 是 **gear 和**的上界，不是带食物时最终 `S` 的上界；带食物时必须加食物项（定理 4）。

### 定理 2（戒指唯一性下的精确配对）

设戒指槽 `A,B` 的候选集合已知（候选可含同 `itemId` 的多个镶嵌变体），合法对定义见 §3.1。则

```text
M_ring := max { S3(a) + S3(b) : (a,b) ∈ C_A × C_B, 合法 }
```

可在 `O(n log n)`（`n = |C_A| + |C_B|`）内精确求出，算法：

1. 每侧按 `itemId` 折叠，只保留该 `itemId` 的最大 `S3`（同一物品的镶嵌变体在单侧只影响总和，取最大即可）。
2. 每侧取 `S3` 最大的物品 `u_A`、`u_B`；若 `u_A != u_B`，答案 `= S3(u_A)+S3(u_B)`（不同物品总是合法）。
3. 若 `u_A = u_B =: u` 且 `unique(u) = false`，答案 `= S3(u_A)+S3(u_B)`（同 ID 非唯一允许）。
4. 若 `u` 唯一，则合法对至少一侧要换物品，答案

   ```text
   = max( S3(u_A) + best_{B, id != u}(S3),   best_{A, id != u}(S3) + S3(u_B) )
   ```

   （不存在次优时该项为 `-∞`；两份都 `-∞` 表示无合法对。）

**正确性**：任意合法对的分量分别不超过 `S3(u_A)`、`S3(u_B)`；唯一不合法的情况是两侧都取同一 unique 物品，此时最优合法对必是「一侧换成次优不同 ID」之一，枚举两侧各一个候选即覆盖。折叠变体不改变最大值（同物品变体在单侧互斥，取最大是支配）。**注意**：变体折叠只在「无速度/TEN 约束的 gear 和最大值」问题中成立；若带约束，速度/TEN 会区分同物品的不同镶嵌，不能先折叠（此时应把变体当作独立候选，用暴力 `O(n²)` 或带约束的配对 DP）。**复杂度**：折叠 `O(n)`，排序/取前二 `O(n log n)`（或按 `S3` 两遍扫描求最大与最大不同 ID 的 `O(n)`）。

**现有实现对照**：生产用 `buildRingPairEquipInfos` 枚举全部合法对（`O(n²)`，`ring-pairs.ts:15-57`），MIP 用唯一性行（`loadout-finder-exact-mip.ts:5318-5340`）。若候选池已经枚举合法对（配好对单槽），定理 1(b) 直接适用，无需再配对。

**更松但安全**：忽略唯一性的 `R_gear = max_A + max_B`（各取本槽最大）仍是合法上界，但可严格高估；verify.mjs 的实例中 `160 > 150`（间隙 10）。间隙可以任意大（缩放两侧同一 unique 物品的 `S3` 即可）。

### 定理 3（自定义参数武器与义军武器）

1. **Manderville（自定义参数武器）**：每次选 1 small + 2 big + 1 空槽、槽位不重复，共 `4 × C(3,2) = 12` 种固定组合（`equipment-candidates.ts:131-158`）。这些组合是**有限静态候选**，直接并入 `C_weapon`；定理 1/2 自动覆盖，无需新算法。四槽结构不成立时生产明确失败（规则第 26 行），本文回退（§10）。
2. **义军武器（Resistance weapon）**：武器槽贡献 = 固定基础向量 `x0`（装备固有属性）+ 整数分配 `y_s`，`s` 遍历 `ResistanceWeaponAdjust.stats`；但本文的 `S3` 只含**三目标属性** `I := stats ∩ {CRT,DHT,DET}`（非目标属性如 SKS/TEN 不进入 `S = CRT+DHT+DET`）：

   ```text
   0 <= y_s <= m_s ，m_s = min(maxEachStat, statMaximum_s)（同步 cap 削减）
   Σ_{s∈stats} y_s <= T ，T = maxTotalStats
   三属性和增量 = Σ_{s∈I} y_s        （非目标分配不进入 S3）
   ```

   对**三属性线性目标**：

   ```text
   max Σ_{s∈I} y_s = min( T , Σ_{s∈I} m_s )     （精确；把预算填给 I 中仍有空间的属性即可；
                                                   I=∅ 时为 0。剩余预算可不分配——生产约束是 Σy<=T）
   因此武器槽对 S3 的最大贡献 = S3(x0) + min(T, Σ_{s∈I} m_s)。
   ```

   **非目标属性警告（必须只对 `I` 求和）**：若把下标取遍全部 `stats`（旧写法），当 `stats` 含速度/TEN 等非目标属性时会虚增。反例：`I` 中只有 CRT cap `1`，另有 SKS cap `9`，`T=10`：旧式 `min(T,1+9)=10`，正确值 `min(T,1)=1`；多出的 `9` 点只能投给非目标属性，不进入 CRT+DHT+DET。（该数值仍是安全高估，但“精确”命题与证明不成立。）

   逐属性上界（用于 `R_sep`）：**三个目标属性的固定贡献 `x0_i` 全部保留**，只有「可分配增量」被限定在 `I`：

   ```text
   对 i ∈ {CRT,DHT,DET}：  bound_i = x0_i + (i ∈ I ? min(m_i, T) : 0)
   相加： R_sep_weapon = Σ_i bound_i = S3(x0) + Σ_{i∈I} min(m_i, T)
                       >= S3(x0) + min(T, Σ_{i∈I} m_i)        （真实最大三属性和）
   ```

   当且仅当 `Σ_{i∈I} min(m_i,T) = min(T, Σ_{i∈I} m_i)` 时取等；否则严格高估。
   **不要把固定项也限制在 `I`**：反例 `x0=(100,40,0)`（三个目标属性都有固定贡献）、`stats={CRT,SKS}`、CRT cap `1`、SKS cap `9`、`T=10` ⇒ `I={CRT}`；错误写法 `Σ_{i∈I}[x0_i + min(m_i,T)] = 100+1 = 101` 会**低估**真实最大三属性和 `100+40+1 = 141`（不安全）；正确写法 `R_sep_weapon = S3(x0)+Σ_{i∈I}min(m_i,T) = 140+1 = 141`。verify.mjs `T3-resistance-fixed-target`。
   另一例（可分配属性均为目标属性）：`x0=(100,40,0)`、`m=(20,20)`、`T=30`：精确和 `170`，逐属性相加 `180`（高估 10）——**这是「逐属性最大相加」在武器槽上的又一个严格分离来源**。非目标属性（SKS/TEN 等）的分配不进入这两个和（只消耗共享预算）；但**固定目标属性**即使不在 `I` 也必须保留其 `x0_i`。
3. **与约束的交互**：义军分配同时可能影响速度/TEN；当这些约束启用时，武器槽的 `(speed,ten)` 与总和目标构成小整数问题，精确解需 DP（§12）；定理 5 的 Lagrangian 上界仍可用（把 `speed(c)/ten(c)` 作为分配变量的函数处理会更细，本文不展开精确解）。非目标属性的分配只可能通过速度/TEN 约束影响可行域，不进入 `S`；因此三属性精确上界仍只依赖 `I` 的 caps 与共享预算 `T`。
4. **规则/实现对应**：`rules/领域与搜索规则.md` 第 27 行（整数步进 1、单项/总上限、不能用静态候选枚举全部合法分配）；生产实现 `loadout-finder-exact-mip.ts:5189-5223` 为 `adjustment.stats` 中**全部**属性建分配变量（非目标属性也会建，用于速度/TEN 约束），`:5280-5296` 是 `Σ y <= T·selected` 行；同步 cap 的 `statMaximums` 在 `equipment-candidates.ts:263-281`。**本文定理只对可分配增量求和（`I`）；固定向量 `x0` 的三目标贡献始终全部保留在 `S3(x0)`**；`verification/measure-sum-bounds.mjs:81-101` 的 `maxSum3 = min(total, Σ_{i∈I} cap_i)` 也以 `S3(base)` 为固定项（`maxS3 = s3(base) + maxSum3`），口径一致。

### 定理 4（食物感知上界族）

对每个可能食物 `f`（含 `⊥`）构造以下整数/有理数上界（记号 `Gmax_i := Σ_s max_{c∈C_s} x_i(c)`，`R_gear` 为定理 1 的精确 gear 和，`R_sep` 见定理 1）：

```text
B1(f) := R_gear + Σ_i cap_i^f
B2(f) := R_sep  + Σ_i bonus_i^f(Gmax_i)
B3(f) := Σ_s max_{c∈C_s} Σ_i (1 + r_i^f) · x_i(c) + Σ_i r_i^f · base_i       （有理数，精确分数计算）
B4(f) := R_gear + Σ_i bonus_i^f(Gmax_i)
```

（`⊥` 时 `cap=r=bonus=0`，故 `B1=B4=R_gear`，`B2=R_sep`，`B3=R_gear`。）

1. **（合法性）** 每个 `B_k(f)` 都是「实际食物为 `f` 时的最终和」的上界；特别对 `⊥`/无食物，`R_gear` 精确（定理 1）。
2. **（支配）** `B4(f) <= B1(f)`（`bonus <= cap`）且 `B4(f) <= B2(f)`（`R_gear <= R_sep`）。
3. **（不可比）** `B3` 与 `B4`（以及 `B3` 与 `B1/B2`）**一般不可比**：cap 绑定时 `B4` 更紧（例：`B4=210 < B3=320`）；均匀小比率且 cap 不绑定时 `B3` 更紧（例：`B3=396 < B4=416`）。只有证明过的关系才写入表（§8）。
4. **（食物耦合上界）**

   ```text
   R_food := max_{f ∈ F ∪ {⊥}}  min_{k ∈ {1,2,3,4}} B_k(f)
   ```

   是**安全上界**。理由：实际食物是某个 `f*`；对 `f*`，`min_k B_k(f*)` 是合法上界；取 `max_f` 只会变大，故对每个可能 `f*` 都成立。（等价形式：对每个 `f` 取任意一族已证明合法界的 min，再对 `f` 取 max。）
5. **（比「gear max + 食物 max 相加」紧）** 常见做法 `R_gear + Σ_i max_f cap_i^f` 把「不同食物的不同属性 cap」相加，会高估。反例：食物 `f1` 只给 CRT cap 50、`f2` 只给 DHT cap 50；无单一食物同时给两项。该做法给 `160 + 50 + 50 = 260`，而真实 `S*=210`；`R_food = 210`（且被达到，故精确）。验证脚本 `T4-food-coupling`。
6. **（精确性条件，仅条件成立）** 当且仅当某个合法完成达到上界值 `R` 时，`R = S*`。可操作的充分条件：
   - (E1) 无食物（`F = ∅` 或实际只允许 `⊥`）：`S* = R_gear`（定理 1(b)）；
   - (E2) **cap 饱和且可达**：存在合法 gear 选择同时取到 `R_gear` 且 `bonus_i^f = cap_i^f` 对每个属性和所选 `f` 成立（或该属性无参数）——此时 `B1=B4= S*`；
   - (E3) 更一般：存在合法完成使 `S = R_food`（上界被达到）。
   不满足时为**严格上界**，例子：`R_gear=180`、`Gmax=(100,100,80)`、cap 全 5 时 `B1=B4=195`，但每个 argmax 的 DHT 贡献为 0，真实 `S*=190` ⇒ 严格高估 5。**「cap 生效」本身不足以保证精确**。
7. **带食物的精确最大值一般不可分**：`bonus_i(G_i)` 依赖**该属性总 gear 贡献** `G_i`，而 `G_i` 由各槽共同决定，所以一般不能逐槽独立最大化；这正是 §12 的未解决问题（需 DP）。

### 定理 5（约束感知的 Lagrangian 上界）

以下 `λ, μ, ν >= 0` 是乘子；`foodTerm_f` 可取 `Σ_i cap_i^f`（cap 型）或 `Σ_i bonus_i^f(Gmax_i)`（单调型，更紧），二者都是合法食物项；`cap_T^f` 是食物 TEN 加成上限。

1. **速度上界** `V <= v_hi`：

   ```text
   S <= Σ_s max_{c∈C_s} [ S3(c) - λ·speed(c) ] + λ·v_hi + foodTerm_f        （cap/单调食物项）
   S <= Σ_s max_{c∈C_s} [ Σ_i (1+r_i^f)·x_i(c) - λ·speed(c) ] + λ·v_hi + Σ_i r_i^f·base_i   （线性比率型）
   ```

2. **TEN 下界** `T >= t_lo`：

   ```text
   S <= Σ_s max_{c∈C_s} [ S3(c) + μ·ten(c) ] + foodTerm_f + μ·cap_T^f - μ·t_lo
   ```

3. **TEN 上界** `T <= t_hi`：

   ```text
   S <= Σ_s max_{c∈C_s} [ S3(c) - ν·ten(c) ] + ν·t_hi + foodTerm_f
   ```

4. **（最小化）** 对固定 `f`，右侧是乘子的凸分段线性函数；**精确最小值**在 `x = 0` 或某个正的「候选仿射交叉点」取得。记每个槽的候选仿射为 `a_c + x·coef_c`，断点集合

   ```text
   X = { 0 } ∪ { (a_j - a_i)/(coef_i - coef_j) : 同一槽 i,j，coef_i != coef_j，(a_j - a_i)/(coef_i - coef_j) > 0 }
   ```

   在每个断点用精确有理数求值并取最小即可（有限、精确）。两个乘子 `(λ,μ)` 同时出现时，右侧是二维凸分段线性函数，等价于一个只有 2 个结构变量的 LP；精确最小值在顶点取得：枚举 `(λ,μ)=(0,0)`、`λ=0` 与 `μ=0` 上的断点、以及两条「同槽候选交叉线」的交点，全部用有理数计算。verify.mjs 用断点法与网格值对照（723 个网格值全部不低于断点最小）。
5. **（合并约束）** 若速度与 TEN 同时启用：任一「只对其中一个约束成立」的界对整个问题仍合法（约束越多、可行集越小），因此取 `min` 安全；更精细的联合形式为

   ```text
   S <= Σ_s max_c [ S3(c) - λ speed(c) + μ ten(c) ] + λ v_hi - μ t_lo + foodTerm_f + μ cap_T^f
   ```

   （对 `λ,μ >= 0` 成立，再对 `(λ,μ)` 精确最小化。）
   **注（义军武器槽）**：`max_{c∈C_s}[…]` 对义军武器槽要理解为「在目标分配域（`I=stats∩{CRT,DHT,DET}`，`0<=y_i<=m_i`，`Σ_{i∈I} y_i + 非目标分配 <= T`）上求该仿射式子的精确整数最大值」；非目标属性只通过速度/TEN 约束项进入可行域（若启用），不进入 `S3` 的仿射部分（定理 3(2)）。该最大化仍是有限整数问题（对固定乘子是线性目标 + 盒/共享总预算，贪心/闭式可解），Lagrange 弱对偶推导不变。
6. **（不是精确值，有积分间隙）** 上述是 LP/Lagrangian 松弛，可能严格大于整数精确最大值。精确反例（verify.mjs）：
   - 速度：候选 `(S3=12, speed=2)`、`(S3=9, speed=0)`，`v_hi=1` ⇒ 精确 `9`，Lagrangian 最小值 `10.5`（`λ*=1.5`），取整安全界 `floor(10.5)=10 > 9`；
   - TEN 下界：候选 `(S3=10, ten=0)`、`(S3=5, ten=100)`，`t_lo=50` ⇒ 精确 `5`，Lagrangian 最小值 `7.5`（`μ*=0.05`），`floor = 7 > 5`；
   - TEN 上界：对称例子同样是 `7.5 > 5`。
7. **（食物与约束的安全方向）** 必须把「食物可能贡献」按**只会更松**的方向并入右端：
   - 速度：`V = V_gear + bonus_V <= v_hi` 且 `bonus_V >= minBonusV_f := bonus_V(raw=0)`（`bonus` 关于 raw 非减，故最小值在 raw=0），于是

     ```text
     V_gear <= v_hi - minBonusV_f <= v_hi - min_{f∈F∪{⊥}} minBonusV_f =: v_hi^gear 。
     ```

     （`⊥` 时 `minBonusV=0`；若食物必选，min 只在 `F` 上取。）用 `v_hi^gear` 代替 `v_hi` 只会**变大/变松**，不会不安全。
   - TEN 下界：`T = T_gear + bonus_T >= t_lo` 且 `bonus_T <= cap_T^f <= max_f cap_T`，于是 `T_gear >= t_lo - max_f cap_T =: t_lo^gear`（只会更松）。
   - TEN 上界：`T_gear <= t_hi - min_f minBonusT_f`。
   - 更紧的方式是保留 `foodTerm_f`（并含 `μ cap_T^f` 等），对 `f` 取 max；它与右端替换都安全，替换版只用于简化。

### 定理 6（部分分支/滚动上界）

设 `P` 是已经选定的槽集合（含各槽已选候选，贡献 `G^P`），`b := G^P` 作为 `U` 的已提交 baseline（[free-budget-upper-bound](../free-budget-upper-bound/README.md) §10.2 P2/P3）。定义

```text
remMax_i(P) := G^P_i + Σ_{s∉P} max_{c∈C_s} x_i(c)
R_rem(P)    := Σ_{s∉P} max_{c∈C_s} S3(c) + max_{f∈F∪{⊥}} Σ_i bonus_i^f(remMax_i(P))   （无其它约束时）
```

1. **（合法性）** 对任何扩展 `P` 的合法完成与任意 `f`：

   ```text
   Σ_i (g_i - b_i) = Σ_{s∉P} Σ_i x_i(c_s) + Σ_i bonus_i^f(G_i) <= R_rem(P) 。
   ```

   因此 `R := R_rem(P)` 满足 `U` 的 P3。
2. **（单调性）** `P ⊆ P'` ⇒ `R_rem(P') <= R_rem(P)`。证明要点：`remMax_i` 是「固定 `P` 后合法完成中 `G_i` 的最大值」，`P` 增大使可行完成集合缩小，故 `remMax_i` 不增；`S3` 剩余槽最大值和不增；`bonus_i` 关于 raw 非减。逐项不增，加法保持。
3. **（约束感知变体）** 对固定乘子 `λ`/`μ`：

   ```text
   R_rem^λ(P) = Σ_{s∉P} max_c [S3(c) - λ speed(c)] + λ(v_hi - V^P) + 食物项
   R_rem^μ(P) = Σ_{s∉P} max_c [S3(c) + μ ten(c)] + μ(T^P - t_lo) + 食物项 (+ μ cap_T)
   ```

   其中 `V^P, T^P` 是已提交部分的 gear 速度/TEN。合法性同定理 5（对任意扩展完成，剩余和 `<=` 右侧）。**单调性**：把槽 `s` 从剩余集合移到 `P` 时，`R_rem^λ` 的变化为

   ```text
   - max_s[S3 - λ speed] - λ·speed(c_s)
   = -(max_s[S3 - λ speed] + λ speed(c_s)) <= -S3(c_s) <= 0 ，
   ```

   `R_rem^μ` 的变化为 `- max_s[S3 + μ ten] + μ·ten(c_s) <= -S3(c_s) <= 0`。对每个固定乘子不增；对乘子取 `min`（点态最小值）保持不增。因此**优化后的界仍随 `P` 单调不增**。
4. **（与 `U` 对接）** 取 `b = b_i`（已提交贡献）与 `R = R_rem(P)`（以及按需的 `κ`），用 `U(b,R,κ)` 即可；`R` 是贡献增量之和的上界，与 P3 的坐标一致（见 §10.4）。

### 定理 7（「sum-only 类里最紧」的精确表述；增量预算 `R*`）

固定 baseline `b` 与 caps `κ`；`U(b,R,κ)` 的自变量 `x` 是**相对 `b` 的剩余增量**，定义域为 `A(b,R,κ) = {x ∈ Z_{>=0}^3 : x <= κ, Σ_i x_i <= R}`。对合法完成 `g`（最终贡献）记其增量 `x_i := g_i − b_i`。定义类

```text
C(b,κ) := { 只通过一个和上界 R 进入 U(b,R,κ) 的构造 } 。
```

1. `U(b,R,κ)` 关于 `R` 单调非减（[free-budget-upper-bound](../free-budget-upper-bound/README.md) 定理 1(3)）。
2. **（最小增量预算 `R*`）** 在 free-budget §10.2 的 **P2**（`b_i <= g_i` 对每个合法完成成立，故 `x_i >= 0`）与 **P4**（`κ_i >= x_i`）下，令

   ```text
   R* := max_{合法完成 g} Σ_i (g_i − b_i) = S* − Σ_i b_i   （Σ_i b_i 为常数）
   ```

   任何按 P3 认证的合法增量上界必须满足 `R >= R*`（否则 `A(b,R,κ)` 漏掉某个合法完成的增量，P3 失效；`U` 不再保证是上界）。`R < R*` 时**不是**可认证的合法预算。
3. **（类内最紧是 `R*`，不是 `S*`）** `R*` 本身使 `A(b,R*,κ)` 覆盖全部合法完成，是 P3 下的最小合法预算；由单调性，`U(b,R*,κ) <= U(b,R,κ)` 对任何 P3-合法 `R` 成立。即：**在 sum-only 类内，用精确增量最大和 `R*` 得到最小的 `U`**。`b = 0` 时 `R* = S*`；一般 `b != 0` 时 `S*` 是**最终绝对和**，不能直接当 `R` 用（`R* = S* − Σ_i b_i`）。
   反例（和级）：唯一合法完成 `g=(101,0,0)`、`b=(100,0,0)`、`κ=(1,0,0)`：`S*=101`、`R*=1`；`R=1` 已覆盖全部完成（`U(b,1,κ)` 是合法上界且等于该完成乘积），而 `R=0 < R*` 会漏掉它——「任何合法 `R >= S*=101`」为假。
   严格乘积级反例（用于说明 `R=0` 确实不安全）：取跨档基线 `b=(97,0,0)`、`κ=(1,0,0)`，唯一完成 `g=(98,0,0)`（CRT 档位 56→57）：`S*=98`、`R*=1`；`U(b,0,κ)=4,090,944,000,000 < 真实乘积=4,092,796,000,000`（漏掉完成 ⇒ 不是上界），`U(b,1,κ)=4,092,796,000,000` 合法。verify.mjs `T7-Rstar-baseline`。
4. **限定（必须写清）**：这不代表 `U(b,R*,κ)` 是任意结构的全局最紧上界。若额外给出逐属性/逐槽结构（例如每属性上界向量、每槽候选信息、cap 与速度/TEN 的联合约束），可能收紧 `U`；那已不属于「sum-only 类」。若 `R*` 无法精确计算（带食物时通常如此），则只能取本文已证明界的最小值作为类内已知最紧（不是理论上的 `R*`）。
5. `U` 对 `R` 的单调可以是平台：`level 100`、WHM、`b=(0,0,0)` 时 `U(0)=…=U(5)=4,080,000,000,000`，`U(6)=4,081,020,000,000`（6 点预算才使 DHT 跨档）。所以「最小合法 `R` 给最小 `U`」成立，但 `R` 增大**不必然**严格改进 `U`。

### 定理 8（层级/支配关系与安全回退）

**支配关系（仅列已证明者）**：

| 关系 | 条件/备注 |
| --- | --- |
| `R_gear^uniq <= R_gear <= R_sep` | 定理 2 + 定理 1(3)；`R_gear` 是「无唯一性」版本 |
| `B4(f) <= B1(f)`、`B4(f) <= B2(f)` | `bonus<=cap`、`R_gear<=R_sep` |
| `R_food <= max_f B1(f)` | `min` 的定义 |
| 约束界的「优化后」`<=` 同一食物项下的 `B4` | 乘子取 0 时即 `Σ max S3 + foodTerm = B4`，最小化只会更小 |
| `R_gear <= S* <= R_food` | 无约束情形；`S*` 是真实最大和 |
| `B3` 与 `B1/B2/B4` 不可比 | 精确例子见 §7 |
| 约束界 `>=` 精确约束最大值 | 弱对偶；间隙可以严格（§7） |

**回退**（任一成分无法认证时）：

1. 若戒指唯一性/`itemId` 元数据不可认证 → 用 `R_gear`（忽略唯一性，安全但松）而不是配对精确值；
2. 若食物参数不合法/难以认证 → 丢掉该食物，改用 `R_gear + Σ_i cap_i^{f?}` 的保守版本或 `R_sep + Σ_i max_f cap_i^f`（总是安全，前提是 cap 可读）；
3. 若候选集合不是「该槽合法候选的超集」（例如用了未证明的支配剪枝）→ **禁用本层**，退回更大候选池/现有精确求解器；
4. 若坐标（贡献 vs 面板）或约束换算（速度/TEN 基础值）不可认证 → 禁用本层；
5. **禁止**：用经验系数、magic cap、或「看起来差不多」的近似上界补洞（规则第 47 行）。

## 6. 证明

### 引理 0（食物加成的性质）

对每个 `f, i`，`bonus_i^f(G) = min(cap_i^f, floor((G+base_i)·p/q))`（`p,q >= 0, q>0`）：

1. `0 <= bonus_i^f(G) <= cap_i^f`；
2. `bonus_i^f` 关于 `G` 非减；
3. `bonus_i^f(G) <= r_i^f·(G+base_i)`，其中 `r_i^f = p/q`（`floor` ≤ 实数；`min` 不增大）；
4. cap 饱和阈值：`cap` 生效当且仅当 `G >= ceil( (cap·q - base·p) / p )`（`p=0` 时任何 cap 均不生效）；最小饱和点记为 `τ_i^f`；该等价由整数除法定义直接得到；
5. `bonus_i^f(0) = min(cap_i^f, floor(base_i·p/q))`（raw=0 的最小加成，因单调）。

证明：(1) `min` 两项均非负，`cap` 是上界；(2) 被 floor 的线性函数在 `p>=0` 时非减；(3) `floor(x) <= x` 且 `min(a,b) <= b`；(4) 反解 `floor((G+base)p/q) >= cap ⟺ (G+base)p >= cap·q ⟺ G >= ceil((cap·q - base·p)/p)`（`p>0`），再与 `min` 比较；(5) 代入 `G=0`。∎

### 定理 1 的证明

1. 对任意合法 gear 选择，`Σ_i G_i = Σ_i Σ_s x_i(c_s) = Σ_s S3(c_s) <= Σ_i Σ_s max_{c∈C_s} x_i(c) = R_sep`（交换有限和并逐项放大）。戒指唯一性只去掉部分组合，不改变该不等式。
2. 在槽间独立时，对每个槽独立取 argmax `c_s^*`，同时选择是合法的（无跨槽约束；戒指已按定理 2 或配好对单槽处理），其和为 `Σ_s max S3 = R_gear^uniq`；同时任何选择的和不超过它（逐槽上界求和）。故 `R_gear^uniq = max ΣG`。无食物时 `S=ΣG`，故也是 `S*`。
3. `S3(c) = Σ_i x_i(c) <= Σ_i max_{C_s} x_i` 对每个 `c` 成立，逐槽取最大后求和得 `R_gear <= R_sep`；`R_gear^uniq <= R_gear` 因合法对集合是笛卡尔积的子集（定理 2 的配对最大值不超过两侧独立最大值之和）。
4. 单槽例子：`R_sep = max(100,0)+max(0,100) = 100+100 = 200`；`R_gear = max(100,100)=100`；`100 < 200`。
5. 约束下：`max_{约束内} ΣG <= max_{无约束} ΣG = R_gear`；一般严格（见 §7 的约束实例：无约束 `12`、约束精确 `9`），故 `R_gear` 仍合法但不是精确值。∎

### 定理 2 的证明

折叠：同一 `itemId` 在单侧的多个镶嵌变体互斥，且目标对每侧可加；对每个 `itemId` 保留最大 `S3` 是支配（替换成最大变体不会破坏合法性：合法性只看 `itemId` 与 `unique`）。设折叠后两侧集合为 `A,B`。

任取合法对 `(a,b)`：
- 若 `itemId(a) != itemId(b)`：`S3(a) <= S3(u_A)`，`S3(b) <= S3(u_B)`（`u_A,u_B` 是两侧最大），故 `<= S3(u_A)+S3(u_B)`；若 `u_A != u_B`，该上界由合法对 `(u_A,u_B)` 达到 → 答案正确。
- 若 `itemId(a) = itemId(b) = u`：合法要求 `unique(u)=false`。若 `u_A = u_B = u` 且 non-unique，`(u_A,u_B)` 合法并达到 `S3(u_A)+S3(u_B)` → 正确。
- 若 `u_A = u_B = u` 且 unique：不存在两侧都取 `u` 的合法对。任取合法对，至少一侧 `itemId != u`；因此它 `<= max(S3(u_A)+best_{B,id != u}, best_{A,id != u}+S3(u_B))`，而右侧两项（存在时）由合法对达到 → 正确。若两侧都没有不同 `itemId`，则无合法对，返回 `-∞`。
∎

### 定理 3 的证明

1. Manderville：候选生成函数返回固定 12 个镶嵌组合，`makeGearCandidates` 把它们与固有属性合并为静态候选；因此它只是 `C_weapon` 的有限子集，定理 1/2 的证明不依赖候选如何生成。
2. 义军：三属性和增量是 `Σ_{s∈I} y_s`（`I=stats∩{CRT,DHT,DET}`），线性；约束为盒 + 共享总预算 `Σ_{s∈stats} y_s <= T`。上界：`Σ_{s∈I} y_s <= Σ_{s∈I} m_s` 且 `<= T`（非目标分配不增加目标，且只会消耗预算）。可达：取任一填充顺序把预算分配给 `I` 中仍有空间的属性，直到 `Σ_{s∈I} y_s = min(T, Σ_{s∈I} m_s)`；整数性保证每步取整数；剩余预算不必分配（生产约束是 `<=T`；即使强制用满，也可投入非目标属性而不改变目标值）。**逐属性上界（必须保留固定项）**：对每个三目标属性 `i∈{CRT,DHT,DET}`，其最终贡献 `= x0_i + (i∈I ? y_i : 0) <= x0_i + (i∈I ? min(m_i,T) : 0)`（固定贡献 `x0_i` 与是否可分配无关）；三式相加得 `R_sep_weapon = S3(x0) + Σ_{i∈I} min(m_i,T) >= S3(x0) + min(T, Σ_{i∈I} m_i)`（真实最大三属性和），差为 `Σ_{i∈I} min(m_i,T) - min(T,Σ_{i∈I}m_i) >= 0`（当 `T <= Σ m_i` 时左边 `>=T` 当且仅当截断无损失；否则 `Σmin=Σm_i` 而 `min(T,Σm)=Σm` 取等）。**错误写法**只对 `i∈I` 求和 `x0_i+min(m_i,T)`：当某目标属性的固定贡献不在 `I`（如 `stats={CRT,SKS}`、`x0=(100,40,0)`、CRT cap1、`T=10`）时它漏掉 DHT 的固定 40，得到 `101 < 141`（低估、不安全）；正确值是 `S3(x0)+Σ_I min = 141`。非目标属性（如 SKS cap 9、CRT cap 1、`T=10`）若被取遍全部 stats 会虚增目标增量 `min(10,1+9)=10`，正确增量是 `min(10,1)=1`；所以**可分配增量**的下标必须限定为 `I`，但**固定目标贡献**始终是 `S3(x0)`。∎

### 定理 4 的证明

在固定实际食物 `f`（或 `⊥`）下：

- **B1**：`S = Σ_i G_i + Σ_i bonus_i <= R_gear + Σ_i cap_i`（定理 1 + 引理 0(1)）。
- **B2**：`Σ_i G_i <= R_sep`；`bonus_i(G_i) <= bonus_i(Gmax_i)`（`G_i <= Gmax_i` 与引理 0(2)）⇒ 相加。
- **B3**：`bound_i(G_i) <= r_i(G_i+base_i)`（引理 0(3)）⇒ `S <= Σ_i (1+r_i)G_i + Σ_i r_i base_i <= Σ_s max_c Σ_i(1+r_i)x_i(c) + Σ_i r_i base_i`（逐槽放大；`r_i >= 0` 保证权重非负、`max` 可逐槽取）。
- **B4**：`Σ_i G_i <= R_gear` 且 `bonus_i(G_i) <= bonus_i(Gmax_i)`。
- **B4 <= B1**：`bonus <= cap`；**B4 <= B2**：`R_gear <= R_sep`。
- **R_food 合法**：实际 `f* ∈ F∪{⊥}`；`min_k B_k(f*)` 是 `f*` 下的合法上界；`max_f min_k B_k(f) >= min_k B_k(f*) >= S`。
- **强于逐属性食物 max 相加**：`Σ_i max_f cap_i^f >=` 任何单一 `f` 的 `Σ_i cap_i^f`；当没有单一 `f` 同时取到各属性 max 时可严格大。实例：`f1` 只给 CRT cap 50、`f2` 只给 DHT cap 50；`R_gear=160` ⇒ 该做法 `260`，而 `max_f Σcap = 50`，`R_food=210=S*`。
- **精确性条件**：若界值被某合法完成达到则为 `S*`（上界且可达 ⇒ 相等）。反条件例子（cap 不饱和）见 §7。∎

### 定理 5 的证明（弱对偶与精确最小化）

- 速度：对任意合法完成，`v_hi - V >= 0`。所以

  ```text
  S = ΣG + Σbonus <= ΣG + Σbonus + λ(v_hi - V)             （λ >= 0）
    = Σ_s (S3(c_s) - λ speed(c_s)) + λ v_hi + [Σ bonus - λ bonus_V]
    <= Σ_s max_c[S3 - λ speed] + λ v_hi + Σ bonus               （-λ bonus_V <= 0）
    <= Σ_s max_c[...] + λ v_hi + foodTerm_f                     （cap 或单调食物上界）
  ```

  线性比率型用 `bonus <= r(G+base)` 把 `Σbonus - λbonus_V` 换成加权和，同定理 4 的 B3 推导。TEN 下界：`T - t_lo >= 0`，故

  ```text
  S <= ΣG + Σbonus + μ(T - t_lo)
    = Σ_s (S3 + μ ten) + Σ bonus + μ bonus_T - μ t_lo
    <= Σ_s max_c[S3 + μ ten] + foodTerm_f + μ cap_T^f - μ t_lo 。
  ```

  TEN 上界：`t_hi - T >= 0`，同理。
- 最小化：每个槽内 `max` 是有限个仿射函数的最大，凸；加线性项仍凸；分段线性。一元凸 PL 函数的最小在 `x=0`、某断点或无穷远边界取得；若在无穷远下降则问题不可行（对偶无界），本文实例/前提排除。断点即同槽两候选仿射相等处，公式见 §5。二维情形是只有两个结构变量的 LP：`min λv_hi - μt_lo + Σ_s z_s + const` s.t. `z_s >= a - λv + μt`、`λ,μ>=0`；LP 最优在顶点取得，顶点由两条作用约束（轴或候选交叉）确定，枚举即得。全部用有理数精确计算。
- 间隙：LP 松弛允许分数选择，整数最优可能更小；给定反例逐项复核即可（verify.mjs）。∎

### 定理 6 的证明

合法性：对扩展 `P` 的完成，剩余贡献和

```text
Σ_i(g_i - b_i) = Σ_{s∉P} S3(c_s) + Σ_i bonus_i(G_i)
              <= Σ_{s∉P} max S3 + Σ_i bonus_i(remMax_i)
```

因为 `G_i <= remMax_i`（`G_i = b_i + Σ_{s∉P} x_i(c_s) <= b_i + Σ_{s∉P} max x_i`）且 `bonus_i` 非减。对 `f` 取 max 仍合法。

单调性：`remMax_i(P) = max_{合法完成扩展 P} G_i`。`P'⊇P` 时可行完成集合缩小，故 `remMax_i(P') <= remMax_i(P)`；`Σ_{s∉P} max S3` 也随剩余槽减少而不增；`bonus_i` 非减 ⇒ 食物项不增。约束变体的差分计算见 §5 定理 6(3)（每步 `<= -S3(c_s) <= 0`）；对乘子取点态 min 保持不增。∎

### 定理 7 的证明

见 §5 的论证：`U` 单调（引用已证明定理 1(3)）。设 `x` 为任意合法完成的增量（`x_i = g_i − b_i >= 0`，P2）。由 `Σ_i x_i <= R*`（`R*` 的定义）知 `x ∈ A(b,R*,κ)`（P4 保证 `x <= κ`），故 `R*` 是 P3 可认证的预算；任何 `R < R*` 至少漏掉一个取到 `R*` 的完成，P3 不成立。于是所有 P3-合法 `R` 满足 `R >= R*`，且由单调性 `U(b,R*,κ) <= U(b,R,κ)`。在 P2 下 `Σ_i b_i` 为常数，故 `R* = S* − Σ_i b_i`（`S* = max Σ_i g_i`）。限定来自「类 `C` 只允许一个和」。平台例子直接计算（verify.mjs）。∎

### 定理 8 的证明

表中每条关系都对应前文定理或单调性；不可比项由 §7 的两组精确数值给出反例。回退的安全性：每一步只把界变大（忽略唯一性、忽略食物、放弃未证明的剪枝），不会把真实值排除在上界之外。∎

## 7. 反例与边界退化

以下数值均来自 [verify.mjs](verify.mjs)（合成实例，贡献坐标）。

1. **`R_gear < R_sep` 的严格分离**：槽 `(100,0,0)/(0,100,0)`、`(60,0,0)/(0,60,0)`、`(0,0,200)/(20,20,20)`：`R_gear = 100+60+200 = 360`，`R_sep = 180+180+200 = 560`，高估 `200`。
2. **戒指唯一性高估**：两戒指槽上同一 unique item 的 `S3` 分别为 100 与 60，次优不同 ID 为 40 与 50 ⇒ 精确 `max = max(100+50, 40+60) = 150`；忽略唯一性给 `160`（gap 10）。
3. **义军武器：只统计三目标属性（但固定目标贡献全部保留）**：`x0=(100,40,0)`、`m=(20,20)`、`T=30`：精确 `170`，逐属性相加 `180`（gap 10，逐属性上界高估）。**非目标属性反例**：`I` 中只有 CRT cap `1`，另有 SKS cap `9`，`T=10`；若对全部 `stats` 求和则 `min(T,1+9)=10`，但三属性最大增量只有 `min(T,1)=1`（多出的 9 点只能给非目标属性，不进入 CRT+DHT+DET）。verify.mjs `T3-resistance-nontarget`。**固定目标属性不在 `I` 的反例（F1）**：`x0=(100,40,0)`、`stats={CRT,SKS}`、CRT cap1、SKS cap9、`T=10` ⇒ `I={CRT}`；错误写法只对 `i∈I` 求和 `x0_i+min(m_i,T)` 得 `100+1=101`，**低估**真实最大三属性和 `100+40+1=141`；正确 `R_sep_weapon = S3(x0)+Σ_{i∈I}min(m_i,T) = 140+1 = 141`。verify.mjs `T3-resistance-fixed-target`。
4. **食物逐属性 max 相加高估（食物耦合）**：`f1` 只给 CRT cap 50、`f2` 只给 DHT cap 50；`R_gear=160`。逐属性食物 max 相加 `260`；真实 `S*=210`；`R_food=210`（被达到，精确）。这说明「食物 max 相加」丢掉了「同一食物必须整体选择」的耦合。
5. **cap 生效但不可同时达到（严格上界）**：`R_gear=180`、`Gmax=(100,100,80)`、cap 全 5：`B1=B4=195`，真实 `S*=190`（每个 argmax 的 DHT 贡献为 0）⇒ 严格高估 5。
6. **`B3` 与 `B4` 不可比**：食物耦合实例 `B4=210 < B3=320`；均匀 10%（cap 不绑定）实例 `B3=396 < B4=416`。因此不存在「`B4` 永远最紧」或「`B3` 永远最紧」的结论。
7. **Lagrangian 积分间隙**：速度实例精确 `9`、界 `10.5`（floor 10）；TEN 下界实例精确 `5`、界 `7.5`（floor 7）；TEN 上界对称。约束界**不是**精确最大值。
8. **平台/边界退化**：
   - `F = ∅`/只允许 `⊥`：`S*=R_gear` 精确（定理 1(b)）；
   - 所有 cap 在可达域饱和且 gear argmax 可取 ⇒ `B1=B4=S*`；
   - 候选集合为单点/空槽零向量：不影响定理，只是退化；
   - 空槽（零向量）不会破坏槽间独立性；2H/盾牌由槽位集合决定（PLD/BST 有副手槽）；
   - 同 ID non-unique 戒指允许同时在两槽（`itemId` 相同但 `unique=false`）；
   - 负贡献/负食物参数不在定义域（参考文档 §2.2）；本文不主张负值域。
9. **坐标边界**：面板总值与贡献差常数 `(sub,sub,main)`；若把面板值当贡献或忘记减去不同的 `sub/main`，档位/食物加成会整体偏移（参见 free-budget 的 §13 数值复核）。本文所有实例都在贡献坐标。
10. **非零 baseline 的 `R*`**：`U(b,R,κ)` 的 `R` 是**相对 baseline 的增量**，而 `S*` 是最终绝对和；只有 `b=0` 时 `R*=S*`。和级反例：唯一完成 `g=(101,0,0)`、`b=(100,0,0)`、`κ=(1,0,0)`：`S*=101`、`R*=1`；`R=1` 合法而 `R=0` 不够，故「任何合法 `R >= S*`」为假。严格乘积级反例（证明 `R=0` 确实导致 `U` 偏低）：`b=(97,0,0)`、唯一完成 `g=(98,0,0)`（CRT 档位 56→57）：`R=0` 时 `U=4,090,944,000,000 < 真实乘积 4,092,796,000,000`（不安全），`R=1` 时 `U=4,092,796,000,000` 合法。verify.mjs `T7-Rstar-baseline`。若把 `S*`（绝对和）误当 `R`，在 `b>=0` 时只会**过松**（`S*>=R*`），不会不安全；反之 `R<R*`（漏掉完成）才不安全。

## 8. 依赖与关联定理

- **依赖**：[free-budget-upper-bound](../free-budget-upper-bound/README.md)（`U` 的定义、P3 的 `R` 语义、定理 1 的单调性、定理 2 的满预算、定理 3 的档位三元组公式）；[canonical-evaluator-reference.md](../../canonical-evaluator-reference.md) §2.1/§2.2/§5；[领域与搜索规则](../../../rules/领域与搜索规则.md)。
- **另需**（未来若把和界升级为结构界）：[pairwise-slice-critical-set](../pairwise-slice-critical-set/README.md) 等只涉及因子/档位结构，与本属性级定理无冲突；本定理不重复单因子/单职业上界。
- **被谁使用**：`free-budget-upper-bound` 的 P3（为 `U` 提供 `R`）；候选/分支剪枝层的输入（本仓库尚未把 `U` 接入生产，见该文 §9）；与精确比较语义（`exact-mip-candidate-upper-bound.ts:96-140`）配合使用。
- **平行结果**：`loadout-finder-exact-mip.ts:1020-1073` 的「逐属性食物最大表」是逐属性上界，不是和上界；本文定理 4(5) 说明为什么不能把逐属性食物 max 相加当和上界的最紧构造。

## 9. 与 canonical evaluator / 生产实现的对应（file:line）

| 数学对象 | 生产位置 | 说明 |
| --- | --- | --- |
| 槽位集合 | `src/domain/gear-options.ts:14-18`（`slotsForJob`）；`src/domain/optimizer/context.ts:115-117`（`jobSlots`） | 主手/副手（PLD/BST）/其余/戒指；2H 只影响主手候选 |
| 候选生成（含镶嵌/同步 cap） | `src/domain/optimizer/equipment-candidates.ts:359-410`、`:110-129`（`mergeCandidateStats`） | 候选贡献向量 `x(c)` 的来源 |
| Manderville 参数 | `equipment-candidates.ts:131-158` | 12 个静态组合；`≤4 槽不成 4 槽结构` 时失败 |
| 义军武器参数与变量 | `src/domain/types.ts:66-70`；`equipment-candidates.ts:263-281`；`loadout-finder-exact-mip.ts:5189-5223,5280-5296` | `maxTotalStats/maxEachStat`、`statMaximums`、整数变量（对全部 stats 建变量，非目标属性仅用于速度/TEN 约束）、`Σ y <= T·selected`；**定理 3 只对 `I=stats∩{CRT,DHT,DET}` 求和** |
| 戒指唯一性 | `src/domain/search/ring-pairs.ts:15-57`；`loadout-finder-exact-mip.ts:5318-5340` | 合法对枚举 / 每个 unique itemId 至多选一次；本文定理 2 给出等价的更快精确最大值 |
| 食物参数结构 | `equipment-candidates.ts:325-357`（`createFoodInfo`，`baseValue = baseStats[stat]`） | `cap=maxValue`，`multiplier=1+rate/100` |
| 食物加成公式 | `src/domain/search/exact-mip-candidate-upper-bound.ts:62-75`；`src/domain/search/loadout-finder-v3.ts:815-819`；`src/domain/search/joint-substat-reachability.ts:206-214` | 与 §3.2 的 `min(cap, floor((raw+base)·p/q))` 逐点一致（verify 对照 9048 点） |
| 食物整体选择（互斥） | `loadout-finder-exact-mip.ts:5358-5367`（`choose_food = 1`） | 解释为何 `R_food` 对 `f` 取 **max** 而非把食物 cap 相加 |
| 现有逐属性食物上界 | `loadout-finder-exact-mip.ts:1020-1073` | 逐属性 `max_f bonus_f(raw)`；本文定理 4(5) 的对照对象 |
| 贡献坐标/基础归约 | `src/domain/search/equipped-effects.ts:127-149`；参考文档 §2.1/§2.2 | 面板 = base + 贡献；`base=sub/sub/main` |
| 精确比较语义 | `src/domain/search/exact-mip-candidate-upper-bound.ts:96-140` | 上界最终要落到 `cannotImprove`/`strictlyWorse` |

## 10. 应用前提与安全回退

### 10.1 用途

把 `R` 作为 [free-budget-upper-bound](../free-budget-upper-bound/README.md) `U(b,R,κ)` 的预算上界：`b` = 已提交贡献，`R` = 剩余贡献和的上界；`U` 再叠加档位/因子结构，得到 CRT/DHT/DET 乘积的严格上界，用于候选/分支剪枝。

### 10.2 前提清单

- **P1（坐标与基础值）**：`x/speed/ten/bonus/R` 都是贡献坐标；速度/TEN 带已减去等级基础 `sub`；食物 `baseValue = baseStats`（`sub`/`main`）。不确定 → 禁用本层。
- **P2（候选域是超集）**：传给本层的 `C_s` 必须是该槽合法候选的**超集**（或所使用的剪枝已另有「不改变本界所依赖的最大值」的证明）。Pareto/支配剪枝、`candidatePools` 的 `paretoSlots` 选项（`equipment-candidates.ts:477-519`）是否保序需要单独证明，**不能默认**；不能确认时用原始候选池。
- **P3（戒指元数据）**：`itemId/unique` 一致；配好对单槽或独立两槽二选一；唯一性语义见规则第 18/38 行。
- **P4（食物结构）**：每个 food 每属性至多一个参数；`cap >= 0`、`multiplier >= 1`、`baseValue` 合法；`F` 与实际优化器允许的食物集合一致（生产 `foodsFor` 过滤，`equipment-candidates.ts:412-416`）。
- **P5（约束换算）**：速度/TEN 的最终值约束换算为贡献带（减 `sub`）；若还有其它硬约束（如最低减伤）参与，必须把其可行域也纳入或证明约束只会缩小可行集（取上界方向安全）。
- **P6（精确算术）**：`R` 的分数部分用 `BigInt` 分数保留或向上取整（因为 `S` 是整数，`R` 可先 `ceil` 到整数；`floor` 对「`upper` 形式」要小心方向：若 `S <= 10.5` 则 `S <= 10`（整数））。比较用 `exact-mip-candidate-upper-bound.ts` 的语义。
- **P7（无经验系数）**：不允许用 magic cap/系数补洞（规则第 47 行）。

### 10.3 计算流程（建议顺序）

```text
输入：槽候选（完整贡献向量）、戒指元数据、食物集合、约束带、baseline b（已提交贡献）
1. 校验 P1–P5；任何一项失败 -> 走回退
2. 计算 R_gear（定理 2 配对）、R_sep、Gmax_i
3. 若允许无约束：对每个 f（含 ⊥）算 B1..B4（绝对和上界），
   A_abs = max_f min_k B_k(f)   （定理 4）
4. 若有速度/TEN 约束：对每个 f 算定理 5 的 Lagrangian 界（断点法精确最小），
   与无约束族取 min（都是绝对和上界）
5. 若是部分分支：用定理 6 的 R_rem(P) 替换 R（R_rem 已是增量）
6. 换算为增量预算：R = A_abs − Σ_i b_i（仅当 b 是每个合法完成的贡献下界时；b=0 则 R=A_abs）；
   部分分支的 R_rem(P) 直接就是增量，不再减 b；输出 R（可向上取整）交给 U(b,R,κ)
```

注意：`U(b,R,κ)` 的 `R` 是**相对 baseline 的增量**预算；本文定理 4/5 给出的是**最终绝对和**的上界 `A_abs`，传给 `U` 前必须减去 `Σ_i b_i`（或直接用定理 6 的增量 `R_rem`）。若 `b=0`，二者相同。

### 10.4 与 `U` 的对接细节

- `U` 的 P3 要求增量预算 `R >= Σ_i x_i = Σ_i(g_i − b_i)`（相对已提交 baseline）。定理 6 的 `R_rem(P)` 正是该增量在贡献坐标下的上界，直接用；定理 4/5 的绝对和上界 `A_abs` 需换算 `R = A_abs − Σ_i b_i`。在 P2 下 `R* = S* − Σ_i b_i` 是最小合法增量（定理 7）；把绝对和误当 `R`（例如直接传 `S*` 或 `A_abs`）会**过松**（不是不安全），但若传了小于 `R*` 的值则**不安全**（P3 失效）。
- `R` 只管「和」；`U` 还需要逐属性 caps `κ`。`R` 的紧致**不能**补偿 `κ` 的松；若掌握逐属性上界，应同时缩 `κ`（本文不做，见 §12）。
- 比较语义（不变）：

  ```text
  不能严格改善：upperProduct * incumbentGcd <= incumbentProduct * upperGcd   （DPS）
              或 upperProduct <= incumbentProduct                            （damage）
  严格更差：   incumbentProduct * upperGcd > upperProduct * incumbentGcd     （DPS）
  ```

  「不能严格改善」包含 tie；只搜索严格改进解时才可用 `<=` 剪枝。`R` 是**上界**，不保证可达到，也不构成合法配装存在性证明。

### 10.5 安全回退

1. 精确 `R* = S* − Σ_i b_i` 可算时（无食物；或约束下用 §12 的 DP 且预算允许）→ 用 `R*`（类内最紧；`b=0` 时即 `S*`）。
2. 否则 → 用 `R_food − Σ_i b_i`（定理 4）/约束 Lagrangian 界减 `Σ_i b_i`（定理 5）的最小值（都是增量；若 `b=0` 则不用减）。
3. 再否则 → 用 `R_sep + Σ_i max_f cap_i^f − Σ_i b_i`（忽略唯一性与食物耦合；总是合法，只要 cap 可读；`b=0` 时不用减）。
4. 候选/元数据/坐标任何一项不可认证 → **禁用本层**，退回现有精确求解器/更大候选池；不得用经验值。

## 11. 验证

本目录提供 [verify.mjs](verify.mjs)：

```text
node --experimental-strip-types docs/mathematical-analysis/theorems/substat-sum-upper-bound/verify.mjs
```

当前输出 **PASS**，`checks: 20537`。它只做小型合成实例与有限域精确计算（BigInt 分数/整数），不启动搜索、不枚举真实装备、不调用 MIP。覆盖：

- **实例**（2–3 槽 × 2–4 候选、≤2 食物、含/不含约束、戒指唯一性、义军整数分配、部分分支）：`separability`、`separability-uniform-food`、`rings`、`paired-ring-slot`、`food-coupling`、`cap-not-attained`、`speed-cap`、`ten-lower`、`ten-upper`、`speed-food`、`ten-food`、`combined-constraints`、`partial-branch`、`partial-branch-speed`。
- **T1**：`R_gear` 精确性、`R_gear <= R_sep`、严格分离（360 vs 560）。
- **T2**：配对算法 vs 暴力枚举（确定性实例 + 80 个随机小实例）；唯一性 gap（160 vs 150）；配好对单槽模型等价。
- **T3**：义军分配精确和（170）vs 逐属性上界（180）；**非目标属性**（`I` 仅 CRT cap=1、另有 SKS cap=9、`T=10`）旧式 `min(T,Σ_all cap)=10` vs 正确 `min(T,Σ_{i∈I} cap)=1`，200 个随机 `(stats,caps,T)` 网格上仅对 `I` 求和的公式 = 穷举最大三属性增量；**固定目标属性不在 `I`**（`x0=(100,40,0)`、`stats={CRT,SKS}`、CRT cap1、`T=10`）：错误 over-I 和 `101` < 真实最大 `141`，正确 `R_sep_weapon = S3(x0)+Σ_I min = 141`，并断言对全部固定/随机 `(x0,stats,caps,T)` 该 R_sep 上界 ≥ 穷举真实最大三属性和。
- **T4**：B1–B4 逐点合法（254 个成员检查）、`B4<=B1/B2`、食物耦合（260 vs 210）、cap 不饱和严格高估（195 vs 190）、`B3<B4` 与 `B4<B3` 两组反例、`R_gear<=S*<=R_food`、取等/严格实例列表。
- **T5**：速度/TEN 下界/TEN 上界的 Lagrangian 合法性与精确最小化（断点法 vs 723 个网格值）；积分间隙（9/10.5、5/7.5）；食物安全方向（`gearSpeed <= 1`、`gearTEN >= 20`）；组合约束取 min 的合法性。
- **T6**：无约束分支 `140->90->60->20`、速度约束分支 `19->10->4->0`（单调不增且对完成安全）。
- **T7**：`U` 在 168 个 `(level, job, b, R)` 点对 `R` 单调非减；`level 100` 平台例子 `U(0)=…=U(5)=4,080,000,000,000`、`U(6)=4,081,020,000,000`。**非零 baseline**：和级 `g=(101,0,0)`、`b=(100,0,0)`、`κ=(1,0,0)` ⇒ `S*=101`、`R*=1`、`U(b,1)` 合法（故「合法 `R>=S*`」为假）；严格乘积级 `b=(97,0,0)`→`g=(98,0,0)`（CRT 档位 56→57）：`U(b,0)=4,090,944,000,000 < 真实乘积 4,092,796,000,000`（`R=0<R*` 不安全），`U(b,1)=4,092,796,000,000` 合法；48 项 `R*=S*−Σb` 恒等式复核。
- **公式对照**：食物加成 9048 个 `(rate, cap, base, raw)` 点与生产 canonical 实现一致；base 偏移 `level 100=(420,420,440)`、`level 50=(341,341,202)`、`level 90=(400,400,390)` 核对。

**证明作用**：有限实例证书 + 反例；一般性证明在 §5–§6。网格外的结论不由脚本证明。

**测量（不是证明）**：真实候选池上覆盖 36 个基线 (场景, 职业) 实例 + `run-acceptance.mjs` 的 18 个验收 case / 52 个职业行（含 GCD 约束），`R_sep` / `R_gear^uniq` / `R_food` / `R_food|speed` 数值与紧度见 [measurements/substat-sum-bounds.md](../../measurements/substat-sum-bounds.md)；测量显示 `R_food` 在基线 18/36、验收 52/52 个实例被合法完成精确达到（最大 gap 30；高品级下食物 cap 饱和）。该测量不改变 §12 的“带食物精确最大值未解决”。注意测量里的 `R_*` 是**最终绝对和**；若要传给 `U(b,R,κ)` 且 `b != 0`，需按定理 7 换算 `R = R_* − Σ_i b_i`（`b=0` 时相同）。

## 12. 未解决问题

1. **带食物的精确最大和**：`S* = max_{gear,f} Σ_i G_i + Σ_i bonus_i^f(G_i)`。`bonus_i` 依赖逐属性总 gear 贡献，一般不能逐槽分离；可能的精确算法是 DP（对每属性的 gear 总量/和建模，或对每个 food 做多维背包），但状态空间与代价未评估；本文只给上界与精确性条件。**这是本定理最主要的开放问题。**
2. **约束 + 食物 + 义军分配的精确最大和**：速度/TEN 带 + 食物非线性 + 义军整数分配构成带 1–2 个约束的背包；精确 DP 的复杂度、是否值得、以及在真实规模下是否可行，未解决/未评估。
3. **更紧的结构类上界**：本文只做 sum-only 类；若加入逐属性上界向量 `(κ)`、逐槽可配对信息、速度/TEN 的联合支撑面，可能比 `U(b,R*,κ)` 更紧。这样的「结构类最紧」定理未解决（需要同时处理 `U` 的内部结构）。
4. **多职业/共享食物**：联合搜索中食物/共享装备耦合；本文只做单职业。
5. **空槽/可选槽与 2H 的完整建模**：当前生产填满槽位；若引入可选空槽，定理仍成立（零向量候选），但生产候选生成与验证未覆盖，未评估。
6. **性能与生产接入**：`U` 尚未接入生产；本文不声称任何剪枝收益、预处理成本或 benchmark 结果。
7. **实数据食物集合的边界**：生产 `foodsFor` 只取 `best` 且 VIT>0 的食物（`equipment-candidates.ts:412-416`）；真实 `F` 的选取是否覆盖所有可选项、以及 `config.foodId` 语义对安全性的影响，属于运行时认证问题（P4），本文未展开。
8. **同步 cap 与义军 `statMaximums` 的精确交互**：`statMaximums = min(maxEachStat, max(0, cap - base))` 与总上限的联合精确解在约束启用时的最优性未分析（无约束时定理 3 对**三目标属性** `I` 已精确；非目标属性只消耗共享预算，不进入 `S3`；固定目标贡献即使不在 `I` 也保留在 `S3(x0)`）。

## 13. baseStat 影响审计（贡献坐标 vs 面板总值）

- **本定理的坐标**：`x_i(c)`、`S3(c)`、`S`、食物 `bonus_i` 中的 `G_i` 全部是**装备+食物贡献**坐标，不是面板总值。面板总值 = 基础属性（CRT/DHT/TEN 为 `sub`、DET 为 `main`）+ 贡献；换算见 [canonical-evaluator-reference.md](../../canonical-evaluator-reference.md) §2.1。
- **baseStat 的影响**：本定理只对贡献求和，`baseStat` 只通过 `value = baseStats + gearAndFoodValue` → `value − offset = G` 的归约进入；正式候选路径 `G >= 0` 是结构性事实（参考模型 §2.2），因此定理中不出现面板坐标、也不需要 `baseStat` 的显式项。食物公式里的 `base_i` 是 canonical 食物加成公式自带的基础项（`bonus_i = min(cap, trunc((G_i + base_i)·r_i + 1e-7))`），已在 `verify.mjs` 的 `canonical-food-formula` 段与生产实现逐点对照（9,048 点）。
- **误用风险**：把面板值当 `G` 会系统性高估（面板 > 贡献），得到"看似安全但过松"的界；不会破坏安全性，但会削弱紧度。`verify.mjs` 的 `base-stat-offsets` 段断言各等级偏移（level 100 = (420,420,440)、level 50 = (341,341,202)、level 90 = (400,400,390)），防止坐标回归。
- **结论**：本定理**不受** baseStat 影响（坐标本来就是贡献）；无定理/数值需要重证或重算。
