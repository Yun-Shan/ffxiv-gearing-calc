# Issue #3：研究：基于 CRT/DHT/DET 精确边际收益与动态资源上界的安全剪枝

- 来源：https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/3
- 作者：Yun-Shan
- 创建时间：2026-10-17T15:55:27Z
- 更新时间：2026-10-18T00:23:51Z
- 抓取日期：2026-10-18（Asia/Shanghai）

以下为正文原文，未按后续评论改写。

---

## 背景

最近对 `CRT / DHT / DET` 三个副属性按当前装备公式做了 3D 阈值散点可视化。三个轴使用原始属性值，每个实际档位阈值绘制一个点，颜色使用当前精确整数因子中的：

```text
critical * directHit * determination
```

可视化在不同参数范围下形状略有不同，但观察到的趋势比较稳定：

1. 颜色变化整体是连续/渐变的，没有出现彼此分离的多个高值孤岛。
2. 最高档颜色只集中在一块区域，并且贴在 `CRT + DHT + DET` 可行域的斜面/边界上，而不是内部。
3. 最高区域通常位于 **CRT 较高、DHT 较低** 的角落。
4. 这一“角落”不能简单解释为“DHT 价值低”。现实装备通常在未镶嵌魔晶石时不提供或少提供 DHT，而 CRT/DET 更常见，因此三个原始属性轴的可达基线存在明显偏移。也就是说，可视化形状同时包含：
   - 伤害公式本身的边际收益结构；
   - 实际装备池造成的可行域形状。

因此不应直接引入类似 `DHT <= magicValue`、`CRT >= magicValue` 的经验约束。目标应当是：**根据当前 job/level/同步规则/候选装备池/魔晶石/食物/当前 incumbent 动态推导可证明安全的剪枝不等式或上界。**

---

## 当前公式基础

当前 `src/domain/search/equipped-effects.ts` 已经提供精确整数档位和整数伤害因子。

对普通职业：

```text
crtTier = floor(200 * (CRT - sub) / div + 50)
critical = 1_000_000 + crtTier * (crtTier + 350)

dhtTier = floor(550 * (DHT - sub) / div)
directHit = 4000 + dhtTier

detTier = floor(((140 * (DET - main)) / det + 1000) / detTrunc) * detTrunc
determination = detTier
```

BLU 有自己的 CRT/DHT 偏移，所有推导必须沿用当前 `equippedAttributeTier` / `createIntegerDamageFactorEvaluator`，不能把普通职业常量写死。

当前完整 exact damage product 还包括：

```text
weaponDamage * mainStat * determination * tenacity * critical * directHit
```

DPS 搜索还需要结合 `gcdCentiseconds` 做精确交叉乘法比较。已有：

- `candidateUpperBoundIsStrictlyWorse`
- `candidateUpperBoundCannotImproveIncumbent`

可作为最终 exact 安全性基准。

相关现有结构还包括：

- `src/domain/search/factor-resource-budget-upper-bound.ts`
  - factor class
  - upper concave hull
  - Lagrangian support
  - 单一资源预算下的严格上界
- `src/domain/search/loadout-finder-exact-mip.ts`
  - candidate upper bound
  - resource support
  - weighted resource support
  - incumbent cuts

本 issue 的方向应尽量复用这些基础，而不是额外建立一套互不兼容的近似评分。

---

# 核心问题

希望证明或构造一种动态策略，使得大量候选装备、partial branch 或 MIP 区域在进入昂贵求解之前即可安全排除。

最终希望得到的是类似：

```text
输入：
- job / level / sync
- 当前实际候选装备池
- materia/food 可用范围和 cap
- 当前 objective: damage / dps
- 当前 incumbent

动态计算：
- 当前各属性可达基线
- 剩余可分配资源上界
- 各精确档位的边际收益结构
- 若干严格安全的不等式 / upper bound

输出：
- 可直接删除的单件候选
- 可直接删除的 partial branch
- 可加入 MIP 的强化行
```

并且：

> **正确性不依赖手写 magic value；若某一类证明条件无法成立，则该层剪枝自动跳过，而不是退化为经验剪枝。**

---

# 证明目标 1：确认单属性因子与精确阈值结构

首先生成当前实际可达范围内的所有有效阈值：

```text
x0 < x1 < x2 < ...
```

其中 `xi` 是刚好进入下一精确 factor class 所需的最小原始属性贡献，对应：

```text
F0, F1, F2, ...
```

定义从阈值 `i` 到 `i+1` 的资源成本：

```text
ci = x[i+1] - x[i]
```

定义单位原始属性的 log 边际收益：

```text
mi = ln(F[i+1] / F[i]) / ci
```

不要仅验证 `+1 raw stat` 的收益，因为 floor 会导致大量 0 和偶发跳变。

### 精确单调性验证

验证：

```text
m[i+1] <= m[i]
```

可不使用浮点/log，等价于精确整数比较：

```text
F[i+2]^c[i] * F[i]^c[i+1]
<=
F[i+1]^(c[i] + c[i+1])
```

用 `BigInt` 即可严格证明。

需要分别检查：

- CRT
- DHT
- DET
- BLU 特例
- 所有支持等级
- 仅当前实际可达属性范围，而不是无界理论区间

### 预期结果

不应预设三项都全局边际递减。

CRT 因为 factor 是二次项：

```text
1_000_000 + t * (t + 350)
```

其 tier-to-tier 边际在一段区间内可能上升；再加上 raw-stat 阈值间距会出现周期性 13/14、19/20 等锯齿，因此最终更可能得到：

- 精确单调区间；或
- 上/下包络；或
- 不能全局证明单调，但局部可证明。

任何后续算法都应基于验证结果，而不是假设 concavity。

---

# 证明目标 2：跨属性边际收益排序

比“某个属性自身是否单调”更重要的是验证：

```text
mCRT(C) ? mDHT(H)
mCRT(C) ? mDET(D)
mDHT(H) ? mDET(D)
```

如果在某个区域可以严格证明：

```text
mCRT(C) > mDHT(H)
```

则只要存在等成本资源交换，从 DHT 向 CRT 转移就严格有利。

这意味着相应区域中的配置不可能是最优点。

目标是动态求出类似：

```text
mCRT(C) = mDHT(H)
```

形成的精确阶梯边界，而不是写死：

```text
CRT >= X
DHT <= Y
```

同理可构造 CRT/DET、DHT/DET 的边界。

如果这些边界与实际装备资源约束结合后能证明某个候选永远位于“可改进侧”，即可直接剪枝。

---

# 证明目标 3：从“总资源”升级到“带当前基线的条件资源分配上界”

这是目前最值得优先尝试的方向。

现实装备的副属性不是完全自由分配：

```text
最终属性 = 装备固有基线 + materia/food/剩余槽位可提供的资源
```

因此仅使用：

```text
CRT + DHT + DET <= R
```

会丢失大量信息。

对任意当前已选装备或候选装备 `e`，先得到实际基线：

```text
b = (C0, H0, D0)
```

再得到剩余资源的严格乐观上界 `R`。

定义：

```text
U(C0, H0, D0, R)
  = max F(C0 + c, H0 + h, D0 + d)
    s.t. c + h + d <= R
         c,h,d >= 0
```

这里故意把现实中的槽位、cap、装备互斥等限制放松，使所有剩余资源可以自由分配。

因此 `U` 是安全 upper bound。

若：

```text
U <= incumbent 所需副属性阈值
```

则该候选/partial branch 一定不可改进，可以安全删除。

### 重要点

两个剩余资源同样为 `R=500` 的候选：

```text
A: CRT 已高 / DHT 低 / DET 中
B: CRT 低 / DHT 已高 / DET 中
```

理论最佳 upper bound 可能完全不同。

这正是当前 3D 可视化透露、但单一 resource budget 没利用的信息。

---

# 证明目标 4：动态支撑不等式 / 半空间剪枝

对当前 incumbent 推导“至少需要达到的副属性乘积”阈值 `B`。

首先对完整 damage/DPS 中其它乘区取严格乐观上界：

```text
otherMax = weaponDamageMax * mainStatMax * tenacityMax * ...
```

DPS 还需要最乐观 `gcdMin`，并继续使用 exact cross multiplication，避免浮点除法。

得到：

```text
critical(C) * directHit(H) * determination(D) > B
```

才有可能击败 incumbent。

定义可改善区域：

```text
G(B) = { (C,H,D) | F(C,H,D) > B }
```

对任意非负方向：

```text
w = (a,b,c)
```

计算：

```text
K_w(B) = min_{x in G(B)} w · x
```

即可得到严格安全不等式：

```text
a*CRT + b*DHT + c*DET >= K_w(B)
```

任何违反该不等式的点都不可能击败 incumbent。

### 方向 `w` 不应写死

可动态来源于：

1. 精确 frontier 的局部法向；
2. 各属性边际收益平衡点；
3. 当前实际装备可行域的 convex hull / support；
4. 已有 `factor-resource-budget-upper-bound.ts` 的 Lagrangian support 结构。

最终 `K_w` 必须通过精确公式认证；可视化/拟合只用于提出候选方向，不负责正确性。

---

# 证明目标 5：二维 frontier 代替完整三维枚举

因为 `F(C,H,D)` 对各属性都单调不减，可以对固定 `(C,H)` 求：

```text
D_min(C,H,B)
  = min { D | F(C,H,D) > B }
```

可在 DET threshold 数组上二分。

因此改善区域的下边界可以用一个二维 staircase frontier 表示，不需要完整三重枚举：

```text
O(|CRT thresholds| * |DHT thresholds| * log |DET thresholds|)
```

而不是：

```text
O(|CRT| * |DHT| * |DET|)
```

可从这个 exact frontier 生成支撑面，再逐条做严格认证。

---

# 证明目标 6：实际装备可行域自身的动态资源约束

当前图中最高区域之所以经常位于“CRT 高、DHT 低”的角，重要原因之一是：

- 装备天然提供 CRT/DET 的概率和规模较高；
- DHT 更依赖 materia；
- 所以 raw stat 原点/范围存在平移，不同装备池也会变。

因此应从**当前候选装备集合**动态构造资源约束，例如：

```text
w1CRT * CRT + w1DHT * DHT + w1DET * DET <= R1
w2CRT * CRT + w2DHT * DHT + w2DET * DET <= R2
...
```

这些是“现实装备最多能提供多少某种加权资源”的 upper supports。

再和“要击败 incumbent 至少需要多少”的 lower supports：

```text
v1CRT * CRT + v1DHT * DHT + v1DET * DET >= K1
v2CRT * CRT + v2DHT * DHT + v2DET * DET >= K2
...
```

组合后，会把可能最优的区域压缩成很小的一块动态 polytope。

这比轴对齐的 min/max 更适合当前观察到的“斜着的角”。

---

# 建议的多级剪枝架构

希望最终做成**可逐层启用、每层都独立可证明安全**的结构。

## Level 0：现有 exact upper bound

保留当前：

- `candidateUpperBoundCannotImproveIncumbent`
- full exact factors
- DPS exact ratio compare

作为最终安全基线。

## Level 1：基线感知的自由资源分配 upper bound

对每个单件候选或 partial selection：

```text
baseline = 当前必然属性
budget   = 剩余所有资源的严格乐观上界
```

求：

```text
U(baseline, budget)
```

如果都打不过 incumbent，则直接剪枝。

优先级最高，因为：

- 便宜；
- 与当前图形最直接对应；
- 不要求完整 MIP；
- 容易保持 strict upper bound。

## Level 2：pairwise marginal dominance

动态计算 CRT/DHT/DET 的精确边际区间和交叉边界。

如果某个候选在当前 remaining budget 下必然存在严格有利的属性交换，则排除。

不要求全局边际单调；只要当前 reachable interval 上可证明即可。

## Level 3：单个或少量动态 support inequality

从 exact frontier / hull 中选当前最有剪枝价值的 support：

```text
w · stat >= K
```

先加最强的一条，如果收益明显再继续添加。

## Level 4：多 support polytope

当单条不足时增加多条 half-space：

```text
w1 · stat >= K1
w2 · stat >= K2
...
```

与实际候选池的 upper resource supports 联合。

## Level 5：MIP strengthening

把经过认证的 support 直接加入 `loadout-finder-exact-mip.ts` rows，减少 LP relaxation 空间 / branch-and-bound 工作量。

---

# 单件装备预过滤

假设 support 为：

```text
w · x >= K
```

候选装备 `e` 在当前 slot 提供：

```text
s(e) = w · stat(e)
```

对其它 slot 求严格乐观上界：

```text
R = Σ max_{candidate in slot} w · stat(candidate)
```

再加入 materia / food / shared slot 等乐观上界。

如果：

```text
s(e) + R < K
```

则该单件装备即使其它槽位都各自拿到最有利候选，也不可能进入可改善区域，可在建模前直接删除。

注意：

- 其它槽位各自取最大值即使组合现实中不可同时达到也没有问题；
- 这是更松的 superset upper bound，只会减少剪枝，不会误删最优解。

同一逻辑可以用于 partial branch：

```text
w · partial + remainingUpper < K
```

则整支 branch 删除。

---

# 不依赖 magic value 的策略要求

最终实现尽量避免：

```text
固定 CRT 阈值
固定 DHT 阈值
固定支持面数量 8/16/32
固定某等级专用常数
固定某个可视化观察值
```

应尽量从当前输入动态推导：

- `jobLevelModifiers`
- `equippedAttributeTier`
- actual candidate slots
- actual materia values / caps / meldability
- food bonuses
- sync caps
- current incumbent
- objective damage/dps
- 当前可达属性 min/max
- 当前 factor class 数量
- 当前 support/hull 的真实拐点

如果需要控制预处理成本，可以有**性能 policy**，但 policy 只决定：

```text
“这一层要不要启用 / 做多少工作”
```

不能决定数学正确性。

即：

```text
proof succeeded -> 可以剪
proof unavailable / budget exceeded -> 不剪
```

绝不能：

```text
proof unavailable -> 使用经验阈值剪
```

### support 数量也尽量动态

不预设“永远 8 条”。可以考虑：

- 每次加入当前对可行域切除最多的下一条 support；
- 当新增 support 不再严格缩紧候选集合时停止；
- 当 model row 增长成本超过预期剪枝收益时停止；
- 保证停止条件只影响性能，不影响正确性。

---

# 精确边际比较建议

不要以浮点 log 作为证明依据。

对相邻 factor class：

```text
A: F0 -> F1, cost c0
B: G0 -> G1, cost c1
```

比较单位资源 log gain：

```text
ln(F1/F0)/c0 ? ln(G1/G0)/c1
```

可转成整数：

```text
(F1 * G0)^c1 ? (G1 * F0)^c0
```

用 `BigInt` 精确比较。

现有 `loadout-finder-exact-mip.ts` 已有严格的 fixed-point log bounds，如果直接复用该体系更合适，也可以使用现有安全量化逻辑；关键是最终 proof 不依赖普通 `Math.log` 舍入。

---

# 需要特别处理的维度

## weapon/main stat/tenacity

副属性区域只能作为早期 cheap filter。

完整安全判断必须考虑：

```text
weaponDamage
mainStat
tenacity
critical
directHit
determination
```

对其它乘区应取**严格乐观上界**，再反推出 CRT/DHT/DET 至少需要达到的门槛。

## DPS / GCD

DPS 模式必须把：

```text
gcdCentiseconds
```

纳入 upper bound，并保持 exact cross multiplication。

## BLU

CRT/DHT 公式不同，所有 threshold/marginal 表必须按 evaluator 动态生成。

## sync / stat cap

同步后可达属性范围和装备有效属性都变化，因此所有资源上界必须基于 sync 后实际候选属性，而不是 item 原始数据。

## food

食物是带百分比和 cap 的非线性附加，应继续使用当前 canonical food bonus 的严格实现，不要简单视为固定可分配资源。

## materia / slot cap

“自由资源分配”可以用于 upper bound，但资源总量必须是现实规则下严格可达到的上界。

---

# 推荐验证流程

## 1. 公式级 property test

对所有支持 job level / BLU：

- 枚举实际可达 CRT/DHT/DET 档位；
- 生成 factor classes；
- 验证 factor monotonicity；
- 输出 marginal monotonic interval；
- 验证 pairwise marginal compare 的 exact 实现。

## 2. 小规模穷举对照

构造可以完整穷举的 slot/candidate/materia/food 实例：

```text
baseline exhaustive optimum
vs
pruned search optimum
```

要求：

```text
exact same optimum
exact same tie behavior
```

## 3. 随机 property/fuzz

随机生成合法候选池，比较：

```text
无剪枝 exact
vs
Level 1
vs
Level 1+2
vs
Level 1+2+3...
```

任何层都不能改变最优结果。

## 4. 实际装备池 benchmark

至少统计：

```text
candidates before/after
factor classes before/after
MIP variables
MIP rows
nonzeros
LP/root bound
solver runs
solver wall time
model preparation time
total elapsed
memory
```

以及每一层：

```text
pruned candidates
pruned branches
added rows
preparation cost
```

这样才能判断某层虽然理论更紧，但是否值得它带来的预处理/model size。

---

# 希望回答的研究问题

- [ ] CRT/DHT/DET 在各实际可达范围内的精确 marginal 序列分别是什么？
- [ ] 哪些区间可以证明 marginal 单调，哪些只能得到 envelope？
- [ ] CRT/DHT/DET 的 pairwise marginal balance frontier 是什么形状？
- [ ] 这些 frontier 在不同 level/job/sync 下是否仍可动态快速生成？
- [ ] 能否基于当前 baseline + remaining budget 快速计算严格 `U(b, R)`？
- [ ] `U(b,R)` 是否能在候选进入 MIP 前排除大量装备？
- [ ] 一条动态 support 能剪多少？多条 support 的边际收益如何？
- [ ] support 是否可以复用现有 `factor-resource-budget-upper-bound.ts` 的 hull/Lagrangian 逻辑？
- [ ] 能否对单件装备做 slot-wise optimistic residual bound？
- [ ] 能否将同一 proof 同时用于 candidate filtering、partial branch pruning、MIP rows？
- [ ] 在 damage 与 DPS objective 下都能否保持 exact proof？
- [ ] 如何自动决定使用单级还是多级策略，而不依赖手工 magic value？

---

# 最终目标

希望最终形成一套**数据驱动、运行时动态构造、数学上可证明安全**的搜索空间缩减策略：

```text
实际候选装备池
   ↓
动态构造属性可达域 / 基线 / 剩余资源预算
   ↓
精确 factor threshold & marginal 分析
   ↓
便宜的 conditional upper bound
   ↓
必要时增加 pairwise dominance / support half-space
   ↓
单件候选预过滤 + partial pruning + MIP strengthening
   ↓
现有 exact upper bound 做最终认证
```

目标不是找到一组适用于当前截图的经验参数，而是：

> **每次搜索都根据实际属性参数和实际装备可用属性情况，自动计算当前最有价值且可严格证明安全的单级或多级剪枝策略；在典型大候选池中显著减少进入昂贵精确搜索/MIP 的装备与组合数量，同时保证与无剪枝 exact search 完全相同的最优结果。**

