# Issue #3 评论 1

- 来源：https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/3#issuecomment-6236437253
- 评论 ID：6236437253
- 作者：Yun-Shan
- 顺序：按 GitHub 评论 ID 升序（发布时间顺序）
- 抓取日期：2026-10-18（Asia/Shanghai）
- 时间说明：连接器未返回此评论的创建与更新时间，不推测补写。

以下为评论原文。

---

## 补充验证：70 级 / iLv320 均衡副属性装备下，最高区域仍稳定落在 CRT 角

又做了一组更有控制意义的可视化验证：**70 级、320 品级装备**。这一档装备在未镶嵌魔晶石时三个副属性的天然分布相对均衡，因此可以较好地排除“因为高等级装备天然更少提供 DHT，所以最高区域才偏向 CRT 高 / DHT 低角落”这一解释。

本次可视化范围：

```text
CRT: 739 ~ 1349
DHT: 743 ~ 1353
DET: 769 ~ 1379
```

三者跨度完全相同：

```text
1349 - 739 = 610
1353 - 743 = 610
1379 - 769 = 610
```

同时固定：

```text
CRT + DHT + DET = 2861
```

三个最小值之和：

```text
739 + 743 + 769 = 2251
```

因此如果做平移：

```text
c = CRT - 739
h = DHT - 743
d = DET - 769
```

则可行域正好变成非常干净的二维 simplex：

```text
c >= 0
h >= 0
d >= 0
c + h + d = 610
```

也就是说，这一组图基本把三个属性放到了**相同的可分配资源尺度**上，几何可行域本身近似完全对称。

然而视觉结果仍和高等级测试一致：

1. 最高亮度只出现在 `c+h+d=610` 的斜面上，而不在内部；
2. 最高区域只是一块局部，不是沿整个斜面均匀铺开；
3. 在 CRT-DHT 投影上仍然稳定集中在 **CRT 高、DHT 低** 的角；
4. 颜色由低到高整体呈连续渐变，没有观察到彼此隔离的多个高值孤岛。

因此可以更有把握地认为：

> “最高区域位于 CRT 高 / DHT 低角落”并不只是实际装备池 DHT 基线偏低造成的；在 70 级这组相对对称的资源可行域内，`critical * directHit * determination` 本身就表现出明显的 CRT 集中倾向。

---

## 极端顶点的精确整数公式校验

70 级参数：

```text
main = 292
sub = 364
div = 900
det = 900
detTrunc = 1
```

按当前 `equippedAttributeTier` / exact integer factors 计算三个 simplex 顶点：

### 610 点全部投入 CRT

```text
CRT/DHT/DET = 1349 / 743 / 769
crtTier = 268
dhtTier = 231
detTier = 1074

critical      = 1,165,624
directHit     = 4,231
determination = 1,074

product = 5,296,705,024,656
```

### 610 点全部投入 DHT

```text
CRT/DHT/DET = 739 / 1353 / 769
crtTier = 133
dhtTier = 604
detTier = 1074

critical      = 1,064,239
directHit     = 4,604
determination = 1,074

product = 5,262,338,326,344
```

### 610 点全部投入 DET

```text
CRT/DHT/DET = 739 / 743 / 1379
crtTier = 133
dhtTier = 231
detTier = 1169

critical      = 1,064,239
directHit     = 4,231
determination = 1,169

product = 5,263,767,599,321
```

CRT 顶点分别比 DHT / DET 顶点高约：

```text
+0.653%
+0.626%
```

这只能证明三个极端顶点之间 CRT 顶点更高，**不能单独证明整个 simplex 的全局最优一定在 CRT 顶点**；但它与 3D 可视化观察一致，值得进一步做严格结构证明。

---

# 对研究方向的修正：优先研究 pairwise single-crossing 和边界极值，而不是先假设 concavity

原 issue 中提出了“边际收益分析”。新的 70 级对称 simplex 验证提示：不能把问题套成经典的“所有属性都边际收益递减，所以 `mCRT=mDHT=mDET` 是内部最优平衡点”。

这里 CRT 的 exact factor 为：

```text
critical(t) = 1_000_000 + t * (t + 350)
```

而 DHT / DET 对应 factor 在 tier 上分别近似线性：

```text
directHit(t)     = 4000 + t
determination(t) = t
```

CRT 的二次结构意味着在实际可达区间内，CRT 的 tier-to-tier 相对收益可能出现**递增区间**；再叠加 raw stat -> tier 的 floor/阈值间距锯齿，不能预设 `log factor` 对 raw stat 全局 concave。

因此建议把证明优先级调整为：

---

## 新优先级 1：验证两属性固定预算下的离散 single-crossing

固定第三个属性与两属性总资源，例如 CRT-DHT：

```text
C + H = S
D = const
```

定义：

```text
G_CH(C) = Critical(C) * DirectHit(S - C)
```

不需要浮点导数，直接对**实际 threshold 序列**做 exact discrete difference / ratio compare。

希望验证的不是：

```text
G 始终单调
```

而是更宽松、更可能成立、但对优化极有价值的：

```text
离散增量符号最多发生一次变化：

- - - - 0 + + + +
```

即 `G` 至多有一个内部极小区域，最大值必然在可行区间两个端点之一。

必须排除这种多次反转：

```text
+ - + - +
```

同样分别验证：

```text
CRT <-> DHT
CRT <-> DET
DHT <-> DET
```

### exact compare

对于两个相邻可达分配状态 `x -> x'`，直接比较 factor product：

```text
Critical(C') * DirectHit(H')
?
Critical(C)  * DirectHit(H)
```

用 `BigInt` 做交叉乘法，不依赖 `Math.log`。

如果步长不等或比较的是单位 raw-resource 边际，可以沿用原 issue 中的指数交叉乘法方式。

### 动态证明范围

只要求在**当前搜索实际 reachable interval** 上成立，不要求对数学上无限区间全局证明。

例如某次搜索得到：

```text
CRT in [Cmin, Cmax]
DHT in [Hmin, Hmax]
```

只证明这个矩形与当前 budget slice 相交的区间即可。

如果 proof 成功，启用端点上界；如果失败，自动回退，不使用经验假设。

---

## 新优先级 2：证明三属性固定总资源时，内部点是否必然可改进

对于：

```text
c + h + d = R
```

若能证明任意内部点都至少存在一个 pairwise resource-transfer direction 可以不减并在非 tie 情况下严格提升：

```text
(C,H,D) -> (C+δ,H-δ,D)
或
(C,H,D) -> (C+δ,H,D-δ)
或
(C,H,D) -> (C,H+δ,D-δ)
```

则内部点不可能成为严格全局最优。

这样：

```text
2D simplex optimization
```

可以严格降维成：

```text
3 条边上的 1D optimization
```

若三条边进一步满足 single-crossing / endpoint-max，则可能继续降为非常少的边界候选点。

目标不是预先写死“CRT 顶点一定赢”，而是运行时通过 exact factor evaluator 自动比较实际边界候选。

---

## 新优先级 3：将 baseline-aware free-resource upper bound 降维

原 issue Level 1 定义：

```text
U(C0,H0,D0,R)
  = max F(C0+c, H0+h, D0+d)
    s.t. c+h+d <= R
```

这是非常安全但如果直接二维/三维枚举，可能预处理成本仍高。

如果新 proof 得到：

1. 内部点不可能优于边界；
2. pairwise slice 具有 single-crossing / endpoint-max；

那么 `U` 可以从完整 simplex 枚举降成非常少的边界计算。

理想情况：

```text
U = max(
  F(C0+R, H0,   D0),
  F(C0,   H0+R, D0),
  F(C0,   H0,   D0+R),
  少量因为 cap / threshold / food / materia 边界产生的额外候选
)
```

注意：**不能把上述 3 顶点公式直接当成既定实现**。只有在当前 reachable interval 上完成 proof 后才能退化成这些候选；否则应保留 edge/frontier 或现有 resource upper bound fallback。

这种 proof 若成立，对 candidate pruning 非常有价值，因为可以把：

```text
“给该装备剩余全部资源完全自由分配”
```

这个乐观 upper bound 算得非常便宜。

---

# 边际收益分析的重新定位

边际收益仍然重要，但用途需要调整。

原本容易直觉地认为：

```text
mCRT = mDHT = mDET
```

是资源最优分配条件。

如果 objective 对资源不是 concave，则这个内部 balance point 可能反而对应局部/全局**低谷**，而最大值落在边界。

因此建议：

### A. 单属性 marginal

继续计算精确 threshold-to-threshold：

```text
mi = ln(F[i+1] / F[i]) / cost_i
```

但用途是确认：

- 单调区间；
- 反单调区间；
- 锯齿 envelope；
- 是否存在有限次数的趋势反转。

而不是要求三个属性全部 diminishing return。

### B. pairwise marginal difference

研究：

```text
mCRT(C) - mDHT(H)
mCRT(C) - mDET(D)
mDHT(H) - mDET(D)
```

最重要的是其**符号变化次数**。

如果在固定资源 slice 上只会 single-crossing，那么即可证明 pairwise objective 的“单谷/端点最大”结构。

### C. 不用浮点 log 负责 proof

`Math.log` 可以用于诊断/可视化，但 correctness 仍使用 exact integer factors / BigInt compare，或者复用当前 fixed-point log interval 证明实现。

---

# 为什么这比直接拟合 support plane 更值得先尝试

如果上述结构成立：

```text
完整三维可达域
  -> 固定资源 simplex
  -> 最优只可能在 boundary
  -> 每条 edge 最大只可能在 endpoint / 少量 threshold candidate
```

则这是比“用很多半空间逼近高值区域”更强的结构性结论：

- 预处理更少；
- 不需要拟合；
- 不需要固定 support 数量；
- 更容易做 exact proof；
- 对 `U(baseline, remainingBudget)` 这种 candidate upper bound 特别便宜。

因此建议把后续路线调整为：

```text
1. pairwise exact single-crossing 检验
2. simplex interior non-optimal proof
3. boundary reduction
4. 由此构造 baseline-aware free-resource upper bound
5. 若 proof 不成立或不够紧，再回退 exact frontier / dynamic support half-space
```

support plane 方向仍保留，但更适合作为结构证明失败时的第二层方案，而不是第一选择。

---

# 动态算法建议（仍然不依赖 magic value）

建议预处理过程按当前搜索输入自动执行：

```text
job / level / BLU
sync
actual candidate slots
materia / food / caps
objective
current incumbent
```

得到：

### 1. 当前 reachable intervals

```text
CRT [min,max]
DHT [min,max]
DET [min,max]
```

同时生成 exact factor thresholds。

### 2. 当前可用 resource budget / baseline

对每个 candidate 或 partial selection：

```text
baseline = 当前已经必然获得的 raw stats
remaining = 尚未选择槽位 + materia + food 的严格乐观资源上界
```

### 3. 动态尝试 structural proof

依次检查：

```text
CRT-DHT edge single-crossing?
CRT-DET edge single-crossing?
DHT-DET edge single-crossing?
```

以及是否能证明 simplex interior 不优于 boundary。

### 4. 根据 proof 自动选择 upper-bound evaluator

可能形成如下 fallback 链：

```text
A. proof: vertex-only
   -> 只检查少量端点

B. proof: boundary-only
   -> 只检查 3 条 edge

C. proof: pairwise single-crossing partially available
   -> 对可证明 edge 用 endpoints，其余 edge 用精确 threshold search

D. proof unavailable
   -> 使用 exact 2D frontier / existing Lagrangian resource upper bound
```

**算法层级由当前数据证明结果自动决定，不是由手写 level/job 条件决定。**

---

# 与实际装备候选剪枝结合

对于候选 `e`：

```text
baseline(e)
remainingUpper(e)
```

用上述动态 evaluator 得到：

```text
U(e)
```

并把 WD/main/TEN/GCD 等其它乘区仍取严格 optimistic bound。

如果完整 upper bound：

```text
cannot improve incumbent
```

则 `e` 可以在进入昂贵 MIP 前删除。

相同 evaluator 还可以复用于 partial branch：

```text
U(partial, remaining) <= incumbent
=> prune entire branch
```

最后也可以根据结构 proof 生成 MIP strengthening rows，但这应当排在 cheap candidate filtering 之后 benchmark。

---

# 建议新增测试重点

在原 issue 测试计划之外，增加专门的 structural property tests：

## pairwise slice exhaustive test

对所有实际支持 level / BLU，在实际 reachable range 中枚举：

```text
固定 C+H=S -> G_CH
固定 C+D=S -> G_CD
固定 H+D=S -> G_HD
```

统计：

```text
离散差分符号变化次数
最大值位置
局部 extrema 数量
```

验证是否满足：

```text
sign change <= 1
```

或能否给出更弱但仍可用于 proof 的区间性质。

## simplex exhaustive oracle

对小资源范围完整枚举：

```text
c+h+d=R
```

记录：

- 全局最大是否位于 boundary；
- 是否位于 vertex；
- structural evaluator 给出的 upper bound 是否 >= exhaustive optimum；
- proof 声称 vertex-only 时是否 exact equal。

## 参数覆盖

必须覆盖：

```text
50/60/70/80/90/100
BLU/non-BLU
不同 baseline
不同 R
sync cap
不同 food/materia availability
```

不要只根据当前 70 级图固化性质。

---

# 当前阶段的结论

这次 70 级 / iLv320 的对称资源实验使研究假设更强了一步：

> 即使 CRT/DHT/DET 的可分配范围被做成相同宽度，并固定成一个几何上对称的 simplex，最高副属性乘积仍稳定集中在 CRT 高、DHT 低的边界角落。

因此后续最值得优先证明的，不再只是“为什么现实装备池让图形偏到某个角”，而是：

> **当前 exact factor 公式在实际 reachable interval 上是否具有 pairwise single-crossing、内部非最优、边界/端点极值等离散结构。**

如果这些性质可以运行时动态证明，就有机会把原 issue 中最重要的 `baseline + remaining resource` upper bound 从多维优化压缩成极少数 exact boundary evaluations，从而形成非常便宜、无 magic value、可严格保证不漏最优解的第一层大规模剪枝。

如果结构证明不成立，则不影响正确性：自动回退到原 issue 中的 exact frontier / dynamic support / existing Lagrangian upper-bound 路径即可。

