# Issue #3 评论 2

- 来源：https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/3#issuecomment-6243686548
- 评论 ID：6243686548
- 作者：Yun-Shan
- 顺序：按 GitHub 评论 ID 升序（发布时间顺序）
- 抓取日期：2026-10-18（Asia/Shanghai）
- 时间说明：连接器未返回此评论的创建与更新时间，不推测补写。

以下为评论原文。

---


## 后续研究重点：证明“固定等级伤害公式的可复用定理”，而不是按单次装备范围重新做几何拟合

这条评论综合本 issue 前面的 3D 散点观察、70 级均衡资源实验、单/多职业搜索优化讨论，并进一步明确优先级：

**优先研究由某个固定等级的属性参数与精确伤害公式决定、能够一次性证明并反复应用到任何后续装备搜索的数学定理。** 运行时只代入真实装备池产生的 baseline、remaining budget、caps、共享装备约束和 incumbent，检查定理适用前提并快速查询严格上界。不希望每次对特定装备范围再次枚举 3D 图、拟合斜面或从统计结果猜规律。

不同等级 / 普通职业与 BLU 可以有不同的定理或证书。定理必须说明全局成立域、条件成立域与反例；**证明失败时安全回退**，不引入经验 CRT/DHT/DET 阈值。

---

### 一、先区分三个数学对象，不把观察当证明

1. **固定等级公式**：等级参数、原始贡献 + 职业基线、整数 tier、CRT/DHT/DET 因子与精确伤害/DPS。这里可以证明完全不依赖装备池的性质。
2. **自由资源松弛**：以某个 baseline (C0,H0,D0) 和资源 R 为输入，允许把剩余资源自由投入 CRT/DHT/DET。它是实际装备空间的**超集**；用于安全伤害上界。
3. **真实装备可行域**：装备固定属性、孔位和 meld cap、食物、sync、独占装备/共享槽、武器/主属性/TEN/GCD 等约束。自由资源松弛中“可以交换属性”不代表装备实际上可以交换，也不能直接作为删除真实装备的理由。

图中最高值贴着 CRT+DHT+DET 的斜面，主要符合因子坐标单调不减与资源上限：只要能增加某项属性，就存在不更差的满预算解；这不证明所有内部解严格劣势，也不证明最优只能在顶点。图中 CRT 高/DHT 低的单角趋势在 70 级均衡 simplex 仍出现，提示公式自身有非对称结构，但该现象**只能用来提出定理猜想**，不能当证明或无条件剪枝规则。

### 二、已经能给出的代数结论：CRT tier 的离散对数凸凹切换

公式见 [equipped-effects.ts](https://github.com/Yun-Shan/ffxiv-gearing-calc/blob/main/src/domain/search/equipped-effects.ts)。固定等级先用 canonical equippedAttributeTier 将原始属性变为 tier，然后：

    普通职业：F_C(t)=1,000,000+t(t+350)
    BLU：       F_C(t)=1,000,000+t(t+150)
    DHT：       F_H(t)=4,000+t
    DET：       F_D(t)=t（可能有 detTrunc 的阶梯）

令 F_b(t)=1,000,000+t(t+b)，其对数离散二阶判据可以完全代数展开：

    E_b(t)=F_b(t+2)F_b(t)-F_b(t+1)^2
          =2,000,000-2t^2-(2b+4)t-(b+1)^2

当因子为正时，E>0 意味着每增加一个 tier 的**相对收益递增**（log-convex），E<0 为递减（log-concave）。

* 普通职业 b=350：E=-2t²-704t+1,876,799；在非负整数 t=0..808 时严格 >0，t>=809 时严格 <0。
* BLU b=150：E=-2t²-304t+1,977,199；t=0..921 时严格 >0，t>=922 时严格 <0。
* DHT/DET 的等距 tier 因子是 F(t)=A+t，对任意正步长 k 有 F(t+2k)F(t)-F(t+k)²=-k²<0，故等距档位相对收益递减。

这些切换位置由**代数公式推导**，不是 magic value。但绝不能直接推出“原始属性每点收益递增/递减”：raw→tier 含 floor，实际相邻阈值花费可能交替 13/14、5/6、19/20 等，产生锯齿；部分等级甚至会跳过某些 tier。必须严格区分 tier 级定理与 raw stat 级定理。

### 三、固定等级定理 A：阈值周期与资源边际收益的精确包络

将档位映射改写为 integer floor((a*x+b)/q) 的形式，CRT 对应 a=200/q=div，DHT 对应 550/div，DET 可将 detTrunc 合入分母 det*detTrunc（最后乘回 detTrunc）。纯整数理论下，阈值的余数规律由

    P=q/gcd(a,q)

决定；平移 P 后 tier 按固定整数增加。BLU 偏移与职业 base stats 改变原点，但不改变此种周期结构。

希望按等级一次性证明/导出：

* raw 属性进入每个 tier 的**精确整数阈值公式**、跳档成本、周期模余类；
* 在任意 raw 区间上每单位预算的 factor/log-gain 的严格上包络和下包络（考虑阈值宽度锯齿）；
* 能否用“有限余类 + 因子多项式不等式”得到边际收益趋势反转次数的严格上界；
* 对 JS 的 Math.trunc(value+1e-7) 容忍截断与上述整数推导做边界等价验证。若不完全等价，证明器必须以 canonical evaluator 的定义为准，不能使用近似阈值误剪。

希望产物是公式级别可重用的阈值/边际查询器，而不是特定装备范围的离散点云。

### 四、固定等级定理 B：任意两属性固定预算的端点最大 / 有限转折

对三对属性（CRT-DHT、CRT-DET、DHT-DET）分别研究，固定剩余一轴和两轴预算 S：

    G_ij(x;S)=F_i(base_i+x) * F_j(base_j+S-x)

证明目标按从强到弱排序：

1. **全域端点最大定理**：在所有允许 baseline、S、整数 raw 值和因子有效区间上，G 的最大值是否一定由左右端点取得？
2. **条件端点定理**：若全域不成立，是否能仅由固定等级参数推导易判断的 tier/baseline/budget 前提 P，使满足 P 的任意区间均端点最大？
3. **有限转折/有限关键点定理**：是否能证明除了两端点，只需检查有限个以 threshold、模余数或 cap 为特征的点？
4. **严格上界定理**：若不能减少到少量真实候选点，能否构造证明为上界的分段线性/凸包 majorant？

研究 single-crossing 时应谨慎：连续近似的边际平衡只意味着微分趋势，floor 后 G(x+1)-G(x) 的符号可能出现 +/0/-/+ 多次跳变。因此建议优先验证更直接且足以用于优化的形式：

    对所有允许 x：
    G_ij(x;S) <= max(G_ij(x_min;S),G_ij(x_max;S))

使用精确整数交叉乘法证明或找反例，不能用平滑颜色来替代。

### 五、固定等级定理 C：三属性自由预算 simplex 的降维条件

定义需要频繁查询的松弛上界：

    U(b,R)=max F_C(C0+c)*F_H(H0+h)*F_D(D0+d)
           s.t. c,h,d>=0 且 c+h+d<=R

因各因子单调不减，在无额外 cap 的有效正因子区间，**存在**满资源最优解；因此可研究 c+h+d=R 的二维 simplex。

重点证明：

* **边界定理**：对任意内部点是否存在一条允许的两属性交换路径、始终不降低目标并最终到达边界？
* **顶点定理**：如果所有两属性定和切片均可证明端点最大，便可逐次把资源推向端点，最终证明**至少存在顶点最优解**；可以给出这个充分条件的严格证明。
* **部分归约**：如果仅有部分属性对的端点定理成立，是否足以证明最优落在特定若干条 edge/facet？
* **有限关键点**：如果边界/顶点结论有反例，是否还能证明全局最优只须检查少数 raw threshold intersections、cap boundaries 或区间分段端点？

**禁止未经证明直接写 U=max(全部资源分别给 CRT/DHT/DET 的三个顶点)**。CRT tier 某区间 log-convex，并不单独保证三维乘积在顶点最大；DHT/DET 的 log-concavity、raw floor 与 caps 可能导致某条边的内部极值更好。

更理想的成果是可预先证明的**参数化条件定理**：

    固定 level / 普通或 BLU 的因子公式
    对所有 baseline、R、允许 caps
    若前提 P(tier-range,baseline,R,caps) 成立
    则 U 恰等于少量候选点集合 V 的最大因子乘积

这样运行时只需代入参数检查 P 和 V，不能满足 P 则调用精确 frontier / 拉格朗日资源上界 fallback。

### 六、固定等级定理 D：改善 incumbent 的单调 frontier 和动态必要半空间

虽然 incumbent 与其它乘区上界随搜索变化，**曲面本身及其数学结构固定**。

如果要严格改善 incumbent，副属性乘积须达到某个严格阈值 B：

    F_C(C)*F_H(H)*F_D(D)>B

三个因子单调意味着二维 exact frontier

    D_min(C,H;B)=min{D | F_C(C)F_H(H)F_D(D)>B}

关于 C/H 单调不增；可在 DET thresholds 上二分。希望进一步按等级证明其分段结构、可查询的变化点规律、与加权资源面的关系，避免每次完整三维遍历。

对非负整数方向 w 定义：

    K_w(B)=min{w·(C,H,D) | F_C(C)F_H(H)F_D(D)>B}

只要 K 在一个包含所有真实可改善状态的松弛域中**精确求得或保守取不大于真值的下界**，就得到严格安全的必要条件：

    w·(CRT,DHT,DET)>=K_w(B)

这里应研究按固定等级可验证的方向族、parametric support、快速 K_w 查询定理，而不是从某张截图经验拟合 w；实际启用哪些方向可根据对当前模型的剪枝增益动态决定，正确性不依赖固定 support 数量。

如不能证明顶点/边界极值，可采用已有的 [factor-resource-budget-upper-bound.ts](https://github.com/Yun-Shan/ffxiv-gearing-calc/blob/main/src/domain/search/factor-resource-budget-upper-bound.ts) 上凸包与 Lagrangian 上界思想，或者对 log factor 构造严格的**向上**包络。注意凸函数切线通常是**下界**、弦线是上界；凹函数相反，证明方向错了会产生不安全剪枝。

### 七、固定等级定理 E：安全属性交换判据及可行性前提

用整数因子精确比较两属性定和交换：

    F_C(C+delta)*F_H(H-delta)
         ? F_C(C)*F_H(H)

同理 CRT-DET、DHT-DET。希望证明某些固定等级、区间、余类与交换成本条件下，方向的严格优势对**全部状态**成立。

但要特别区分：

* 在**自由资源松弛**中使用该交换定理来减少计算状态，是安全的。
* 在**真实装备空间**删除某件装备时，仅仅证明理论交换有利仍不够，必须保证存在合法的可替代装备/meld/food 配置，或用乐观上界证明该候选不可能改善 incumbent；共享装备身份不能被任意交换破坏。

另对原 issue 的单位 raw 成本边际比较给出精确更正。若收益分别为 F0→F1 成本 cF、G0→G1 成本 cG，则：

    ln(F1/F0)/cF >= ln(G1/G0)/cG

等价于：

    F1^cG * G0^cF >= F0^cG * G1^cF

指数应交叉使用对方的成本；此前写成两侧乘积整体各自取一个成本次方，在 cF!=cG 时并不等价。离线证明可用 BigInt，运行时可用有上下界证明的定点对数运算。

### 八、对多职业联合搜索的真正收益：用固定等级定理缩紧联合上界

现有实现有 [joint-candidate-upper-bound.ts](https://github.com/Yun-Shan/ffxiv-gearing-calc/blob/main/src/domain/search/joint-candidate-upper-bound.ts) 的**单职业必要上界**、联合 MIP 的 candidate upper、factor pair/triple cuts、shared accessory dominance 与 CRT/DHT reachability。因此应避免重复已有单因子/单职业必要条件。

设职业 j 的独立全局最优分数 B_j、在同一共享装备方案 s 下的完整乐观分数上界 U_j(s)，则归一化比值满足：

    r_j(s)<=u_j(s)=min(1,U_j(s)/B_j)

当前联合 incumbent 为 J* 时：

    Σ_j u_j(s)<=J*  =>  共享方案 s 不能严格改善 incumbent

等价于在 n 职业联合时，累计不可避免损失：

    Σ_j(1-u_j(s)) >= n-J*

这可能剪掉**每个职业单独都未触发已有必要阈值**的共享方案。固定等级定理的贡献是：快速、严格地求比“其它槽位每个属性分别取最大值再相乘”更紧的 U_j(s)，保留 CRT/DHT/DET 有限总预算及其相关性。

再进一步探索**共享选择耦合**带来的额外上界：

    max_s Σ_j u_j(s) <= Σ_j max_s u_j(s)

右侧允许每个职业虚构不同的最优共享装备，是松的；左侧要求同一共享选择，可用动态 resource support / 严格线性 majorant / 小规模共享松弛问题计算严格联合上界。此处研究结果应同现有 cross-job factor class pair/triple cuts 比较，找到非冗余的强化能力。

目标是在代码中共享**等级定理证书**，而不是每职业每装备重新证一遍公式。相同公式类型和等级可复用阈值、包络、端点定理；职业专属 base stats、GCD、TEN、武器/主属性及 BLU weapon special 则必须纳入完整上界。DPS 使用最乐观 GCD 下界与 exact ratio cross multiplication；共享食物与戒指约束不能丢失安全性。

### 九、希望形成的证明产物与分层回退

建议将离线证明结果整理为可审计的 level/formula theorem certificates，而非写死单次搜索阈值：

    LevelFactorTheorems(level, normal_or_BLU):
      exact raw-tier transformation + period + boundary semantics
      factor monotonicity
      exact CRT log-convex/concave tier intervals
      DHT/DET factor concavity
      certified pairwise endpoint or finite-turning conditions
      certified simplex boundary/vertex/finite-critical conditions
      certified majorants / support family
      validity preconditions (ranges, positivity, caps, costs)
      counterexamples to stronger false conjectures

在运行时输入 baseline/budget/caps，自动选择：

    A: 可证 vertex-only => 极少数 exact factor evaluations
    B: 可证 boundary-only => 少量边界搜索
    C: 可证 finite-critical => 少量阈值交点/余类候选
    D: 上述不可用 => exact frontier / strict factor-resource upper bound
    E: 证明组件不可用 => 现有 exact solver，不做该层剪枝

以上**不同层级是由证明和前提检查决定的**，不是固定职业/品级 magic case。计算开销 policy 可以决定使用多少条 support、何时放弃预处理，但不能决定一个不成立的数学条件“近似成立”。

### 十、验证与验收建议

**公式级证明：**
- [ ] 对支持的所有等级、普通/BLU，提供与 canonical evaluator 一致的整数阈值模型，并证明模余数周期。
- [ ] 固化 CRT 离散 log-convex/concave 的代数推导及条件。
- [ ] 按等级对三种属性对寻找 endpoint-max、single-crossing 反例；出现反例立即收紧条件，不把有限测试当成一般定理。
- [ ] 对三属性 simplex 搜索 vertex/boundary 假设的最小反例；把真正成立的充分条件和 exact upper bound 定理分别记录。
- [ ] 可选 SMT / Lean 4 为有限整数范围或符号不等式出可验证证书；并独立验证证书与运行时 floor/浮点容忍语义一致。

**上界和安全性：**
- [ ] 在小实例上对比 exhaustive optimum，保证每个上界 >= 真最优。
- [ ] 通过大范围基线/预算/cap/materia/food/sync 随机输入验证定理的所有前提和 fallback。
- [ ] 完整伤害因子包括 WD、main、TEN、CRT、DHT、DET；DPS 考虑 GCD，保留 exact BigInt 比值比较及现有 tie semantics。
- [ ] 严格改进型模型的 upper<=incumbent 可以排除新严格改善解；若系统还要求保留或比较同分装备，须额外验证 tie handling。

**性能收益：**
- [ ] 对比原 candidate upper bound、新 level theorem oracle、以及多级组合的候选剪枝量 / bound gap。
- [ ] 在多职业联合中区分 single-job necessary cuts 和新 joint loss-sum cuts 的**增量**剪枝数量。
- [ ] 对比 model rows、nonzeros、root dual bound、节点数、证明时间、总耗时、峰值内存；预处理时间必须计入总成本。
- [ ] 50/60/70/80/90/100、普通/BLU、不同 sync 和职业组合都要覆盖；70 级 iLv320、100 级散点仅是回归案例，不是定理适用范围或 magic values。

**最终目标**：

> 先找出固定等级、固定伤害公式下可数学证明的通用结构：周期性、离散凸凹、条件端点最大、simplex 降维、参数化精确支撑与严格 upper bound。将这些证明复用到任意实际装备池；运行时只检查条件并廉价求界，再用多个职业的共享装备条件和归一化损失预算放大剪枝效果。对于不成立的强猜想保留反例与安全 fallback，不牺牲全局最优性证明。


