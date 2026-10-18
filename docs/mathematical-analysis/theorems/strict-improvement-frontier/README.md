# 严格改善 frontier 与动态必要半空间

## 1 状态

| 编号 | 命题 | 状态 |
| --- | --- | --- |
| Lemma 0 | 由 incumbent 推导严格阈值 `B`（damage / DPS / tie 三种语义）；同分点存在性用像集 `Phi(Omega)`（同分点可达性） | 已证明（并修正「整除 ⇒ 同分点」的旧表述，见 §5.1、§7.7） |
| Theorem 1 | `D_min(C,H;B)` 的存在唯一性、关于 C/H 单调不增、DET 档位表二分算法、staircase 紧致表示（**仅对盒式 Ω**） | 已证明 |
| Theorem 1.5 | slab `Omega_slab` 上只保留逐点公式与全枚举 `K_w^{slab}`；盒域单调/单元代表/最小反链算法**不继承**（slab 非上集） | 已证明（并给出反例，见 §5.2、§7.6） |
| Theorem 2 | `K_w(B)=min{w·x : x∈G(B)}` 的取到性、最小反链刻画、精确计算、关于 w/B 的单调性与正比例齐次性（**仅对盒式 Ω**） | 已证明（并修正任务书对「argmin = 最小元」的过强表述，见 §5.2 与 §7.4） |
| Theorem 3 | 必要半空间 `w·x >= K_w(B)`；低估安全方向；高估误删反例；tie 语义 | 已证明 |
| Theorem 4 | 空改善区域与退化情形；**`B=P*` 时非严格域 = argmax 非空**（非严格域） | 已证明（见 §5.5、§7.5） |
| Theorem 5 | 支撑族非冗余、任意子集正确性、支撑数量只是性能 policy | 已证明 |
| §10 | 应用前提与安全回退 | 已给出契约（不声明性能收益） |

> 修订说明：本文已包含 slab（`Ω_slab` 非上集，盒域档位算法不继承）、`B=P*` 非严格域非空、同分点需商可达三项修正；对应有限证书见 §11 的 A13。

- 适用范围：固定 `(level, job)` 的 canonical 整数档位模型（`docs/mathematical-analysis/canonical-evaluator-reference.md` §2–§4），定义域为 CRT/DHT/DET **贡献** `g >= 0` 的盒式松弛 `Omega`。
- 本文只处理三个副属性因子的乘积阈值；完整伤害的其它乘区（WD、主属性档位、TEN、GCD）只以**乐观上界**身份进入 Lemma 0，不进入 frontier 的几何结构。
- 与真实装备可行域的关系：`Omega` 是真实可达贡献的**超集**，本定理因此只能用于「不能严格改善 incumbent」这一方向的剪枝；把本定理用于删除真实装备候选的合法性边界见 [attribute-swap-criterion](../attribute-swap-criterion/README.md)（评论 2 §七，定理 E）。
- 有限域证书：[`verify.mjs`](verify.mjs)（`node --experimental-strip-types docs/mathematical-analysis/theorems/strict-improvement-frontier/verify.mjs`）。全部结论为有限点证书 + 本文的一般性代数证明，脚本不替代证明。

## 2 范围与依据

### 2.1 依据

- Issue #3 正文「证明目标 4：动态支撑不等式 / 半空间剪枝」与「证明目标 5：二维 frontier 代替完整三维枚举」（[issue-3-body.md](../../issue-3-body.md)：`证明目标 4`、`证明目标 5` 两节）。
- 评论 02 §六「固定等级定理 D：改善 incumbent 的单调 frontier 和动态必要半空间」（[issue-3-comment-02.md](../../issue-3-comment-02.md) 第 119–144 行）。该节明确要求：
  - 严格改善须 `F_C(C)·F_H(H)·F_D(D) > B`；
  - `D_min(C,H;B)=min{D | ...}` 关于 C/H 单调不增、可在 DET thresholds 上二分；
  - `K_w(B)=min{w·x | ...}` 只要**精确求得或保守取不大于真值的下界**即可得到安全必要条件；
  - support 方向族与数量应由当前模型动态决定，**正确性不依赖固定 support 数量**。
- 源码事实：整数档位与因子（`src/domain/search/equipped-effects.ts:59-166`）、精确乘积与严格/非严格比较（`src/domain/search/exact-mip-candidate-upper-bound.ts:96-140`）、单资源 Lagrangian 上界（`src/domain/search/factor-resource-budget-upper-bound.ts:88-147`）。
- 共同事实基础：[canonical-evaluator-reference.md](../../canonical-evaluator-reference.md)（下称「参考模型」）。

### 2.2 不在本文范围

- 自由资源松弛 `U(b,R)` 的**最优值**求解（见 [free-budget-upper-bound](../free-budget-upper-bound/README.md)、[simplex-vertex-reduction](../simplex-vertex-reduction/README.md)）；本文只把它当作 `Omega` 的一种来源。
- 多职业联合上界（见 [joint-loss-sum-bound](../joint-loss-sum-bound/README.md)）。
- 真实装备/魔晶石/食物的删除正确性（见 [attribute-swap-criterion](../attribute-swap-criterion/README.md)）。
- 任何「剪掉多少候选」「加速多少」的性能结论。本文不声明性能收益；support 数量与启用层次都只是性能 policy。

## 3 符号、量词与定义域

### 3.1 固定等级事实

记等级 `level ∈ {50,60,70,80,90,100}`，职业 `job`，普通职业与 BLU 的差异只经 `(b_C, +200 偏移)` 进入。对 `sigma ∈ {C,H,D}`（依次对应 CRT/DHT/DET）与贡献 `g ∈ Z`：

```text
t_sigma(g) = c_sigma + mult_sigma * floor((a_sigma * g + b_sigma) / q_sigma)
F_C(t) = 1_000_000 + t * (t + b_C),   b_C = 350（普通）/ 150（BLU）
F_H(t) = 4000 + t
F_D(t) = t
Phi_sigma(g) := F_sigma(t_sigma(g))
```

参数表取自参考模型 §2–§3（`main/sub/div/det/detTrunc` 六档），且 `a_sigma, q_sigma > 0`、`mult_sigma ∈ {1, detTrunc}`。本文所有 `t_sigma` 只按 canonical evaluator 的**贡献坐标** `g` 求值（**不是面板总值**）；`g = 0` 表示装备+食物贡献为 0，此时面板总值恰为 `baseStats`。面板与贡献的换算见参考模型 §2.1，其结构性非负性见 §2.2；完整坐标审计见 §13。

### 3.2 松弛定义域

```text
Omega = { (C,H,D) ∈ Z^3 : 0 <= C <= kappa_C, 0 <= H <= kappa_H, 0 <= D <= kappa_D }
```

`kappa_C, kappa_H, kappa_D` 是运行时输入：要求对每个被考虑的真实候选/分支，其 CRT/DHT/DET 贡献三元组 `(C,H,D)` 都落在 `Omega` 内（即 `kappa_sigma` 是可达贡献的上界）。`Omega` 允许比真实可达集合大得多——这正是剪枝安全性的来源，而不是缺陷。

**可选收紧（slab）——只继承集合安全，不继承盒域算法。** 若另有同一上下文下已证明的安全和界 `L <= S(gamma) <= R`（`S = C+H+D` 为三属性贡献和；构造见 [substat-sum-upper-bound](../substat-sum-upper-bound/README.md) 与 [substat-sum-lower-bound-pruning](../substat-sum-lower-bound-pruning/README.md)），可令

```text
Omega_slab = Omega ∩ { (C,H,D) : L <= C+H+D <= R } 。
```

**可以继承的部分（集合/安全方向）**：若 `L/R` 是经证明的界且 `Reach ⊆ Omega`，则 `Reach ⊆ Omega_slab`；因此

1. 任何在 `Omega_slab` 上算出的 `K_w^{slab}(B)` 所给出的半空间 `w·x >= K_w^{slab}(B)` 对全部真实可达改善点仍必要（安全方向保持）；
2. `K_w^{slab}(B) >= K_w(B)`（小集合上的 min 更大），所以用它替代 `K_w` 只会剪得更多且仍安全；
3. 若 `G_> ∩ Omega_slab = ∅`，结论是「`Omega_slab` 内没有严格改善点（因而真实可达改善点为空）」，这是比半空间更强的结论，`K_w^{slab}=+infinity` **不是剪枝失效**。

**不能继承的部分（必须显式警告）**：`Omega_slab` 一般**不是坐标上集**（下界 `S>=L` 与上界 `S<=R` 都破坏逐坐标向上/向下封闭性），因此：

1. `D_min_slab(C,H;B) := min{ D∈[0,kappa_D] : (C,H,D)∈Omega_slab, Phi_D(D) > B/(Phi_C(C)Phi_H(H)) }` **不再关于 C/H 单调**；
2. `D_min_slab` **不再在盒域 tier 单元内为常值**；
3. Theorem 1.2（单调不增）、Theorem 1.3（tier 单元代表元二分）、Theorem 2.2/2.3（最小反链与 tier 单元枚举）的**算法/结构结论不能直接搬到 `Omega_slab`**。本节 §5.2 的 Theorem 1.5 只给出 `Omega_slab` 上的**逐点公式**与正确的**全枚举**计算式；紧凑 breakpoint 表示需要重新推导（见 §5.2、§7.6）。

**`Omega_slab` 上正确的计算式（逐点公式；不是档位代表枚举）**：

```text
D_min_slab(C,H) = max( D_min(C,H), max(0, L−C−H) )            若 D_min(C,H) 有限；
                  上界截断 D <= min(kappa_D, R−C−H)；
                  若 D_min(C,H)=+∞ 或 max(D_min, max(0,L−C−H)) > min(kappa_D, R−C−H)，则 +infinity。
K_w^{slab}(B) = min_{ (C,H) ∈ [0,kappa_C]×[0,kappa_H] } [ w_C*C + w_H*H + w_D*D_min_slab(C,H) ]   （跳过 +infinity 的截面）
```

`K_w^{slab}` 的**精确**计算至少需要枚举 `(C,H)` 的全部格点（`(kappa_C+1)*(kappa_H+1)` 次 O(1) 点值查询；`D_min(C,H)` 可查盒域 tier 单元表），**不是** `|A_C||A_H|` 个 tier 代表元；若要用紧凑表示，须把 `C+H = L−D`、`C+H = R−D` 这类反对角线与 tier 单元的交点作为额外 breakpoint 重新推导，本文不声称已给出该最简表示。若实现只按盒域代表元枚举，会得到**错误（偏小）**的 `K_w^{slab}` 并误删改善点（§7.6 给出 `L100, κ=(1,1,1), L=R=1, B=1` 的反例：真实 `K_w(0,1,1)=0`，代表元算法给出 `1`）。

**前提与禁止**：`L/R` 必须是经证明的界且 `Omega_slab` 仍包含所有被考虑的真实可达点；实现必须使用 `Omega_slab` 上的正确计算式（或自行证明的新 breakpoint 表示），不能直接复用盒域的 `D_min`/`K_w` 枚举；**禁止**把 slab 当作 `U` 的额外约束（它不改变 `U`，且 `U` 的满预算面上可能没有真实点）。进一步说明见 [substat-sum-lower-bound-pruning](../substat-sum-lower-bound-pruning/README.md) PR1 与 §7.6。

> 量词约定：`∀x ∈ Omega` 指对所有格点；`x <= y` 指逐坐标 `<=`。`P* := max_{x∈Omega} Phi_C(C)Phi_H(H)Phi_D(D)`（因 §4 单调性，等于顶角值）。

### 3.3 阈值与改善区域

- `P_inc`：incumbent 的**完整伤害整数乘积**（参考模型 §4 的 `exactProduct`，含 `weaponDamage * mainStat * determination * tenacity * critical * directHit`）。
- `O`：其它乘区（`weaponDamage、mainStat、tenacity`）的**乐观乘积上界**；即对所考虑的真实候选集合，任意候选的其它三因子乘积 `<= O`。`O` 可以为任意这样的上界（逐分支取更紧上界仍然安全）。
- `gcdMin`：DPS 目标下候选 `gcdCentiseconds` 的**乐观下界**（越小越乐观，`0 < gcdMin <= gcd(x)`）；`I_G` 为 incumbent 的 `gcdCentiseconds`。
- `B`：严格阈值（整数，运行时取 `B >= 1` 或 `B = 0`，讨论见 Theorem 4）。

对整数 `B` 定义：

```text
G_>(B)  = { x ∈ Omega : Phi_C(C) * Phi_H(H) * Phi_D(D) >  B }     （严格改善候选超集）
G_>=(B) = { x ∈ Omega : Phi_C(C) * Phi_H(H) * Phi_D(D) >= B }     （保留 tie 的候选超集）
```

`G_>`、`G_>=` 只依赖 `B`、等级参数与 `Omega`，不依赖具体候选池。

记 **像集**（`Omega` 有限，故为有限整数集合）：

```text
Phi(Omega) := { Phi_C(C) * Phi_H(H) * Phi_D(D) : (C,H,D) ∈ Omega } ⊂ Z_{>0}
```

同分点的存在性、`G_>` 与 `G_>=` 何时相等、以及 DPS 的 tie 处理都必须使用该像集，而不能只看整数整除（Lemma 0.3、§7.7）。

### 3.4 待研究对象

```text
D_min(C,H;B) = min { D ∈ [0, kappa_D] : Phi_C(C) * Phi_H(H) * Phi_D(D) > B }   （不存在则 +infinity）
K_w(B)       = min { w_C * C + w_H * H + w_D * D : x ∈ G_>(B) }                （G 空则 +infinity）
w = (w_C, w_H, w_D) ∈ Z_{>=0}^3,  w != 0
```

扩展序约定：`D_min = +infinity` 视为最大元；`K_w = +infinity` 表示 `G_>(B) = ∅`。

### 3.5 tier 单元与档位表

对一个属性 `sigma` 与上界 `kappa_sigma`，定义

```text
A_sigma = { t_sigma(g) : 0 <= g <= kappa_sigma } = {u_0 < u_1 < ... < u_{J_sigma}}   （严格递增、有限）
c_j     = min { g ∈ [0, kappa_sigma] : t_sigma(g) = u_j }                                （tier 单元最小代表）
```

即 `c_j` 是达到该 tier 的最小贡献；`Phi_sigma` 在 `[c_j, c_{j+1}-1]` 上为常数 `F_sigma(u_j)`。对 DET 另记 `V = A_D = {v_0 < ... < v_K}`、`d_k = c_k`（DET 的可达档位表）。

## 4 假设

- **(A1) 定义域非负（结构性，不是额外假设）。** 所有贡献 `g >= 0`：由参考模型 §2.1 的基础属性归约（`value = baseStats[stat] + gearAndFoodValue`，再减 `sub`/`main`）与 §2.2 的正式候选贡献逐项非负推出。它是本文定义域 `Omega` 与 §3.1 截断语义的事实基础；若通过导出 API 传入负贡献，属于定义域外使用，本层必须禁用。
- **(A2) 截断语义。** `floor` 使用生产实现 `Math.trunc(v + 1e-7)`；在可达域上四个分支的 floor 实参恒 `>= 0`（CRT `>=50`、DHT `>=0`、DET `>=200`、TEN `>=1000`），故 `Math.trunc(v+1e-7) = floor(v)` **无条件成立**（参考模型 §2.2；误差界证明见 [raw-tier-transform](../raw-tier-transform/README.md)）。负实参只可能来自定义域外输入，本文不使用。
- **(A3) 因子正性。** 在 `g >= 0` 上 `Phi_C >= 1_000_000`、`Phi_H >= 4000`、`Phi_D >= 1000`（普通与 BLU 均成立）。更强的全局正性见 [tier-log-curvature](../tier-log-curvature/README.md)；本定理只要求定义域内正。
- **(A4) 单调性。** `g -> t_sigma(g)` 非减；`t -> F_sigma(t)` 在各自档位域上严格增。因此 `g -> Phi_sigma(g)` 非减，且跨 tier 阈值时严格增（证明见 [raw-tier-transform](../raw-tier-transform/README.md)）。
- **(A5) 乐观界合法。** `O >= 所考虑集合中任意候选的其它三因子乘积`；`gcdMin <= 所考虑集合中任意候选的 gcdCentiseconds`；`O, P_inc, I_G` 均为正安全整数或 BigInt。生产侧 `safeDamageFactors`（`exact-mip-candidate-upper-bound.ts:96-106`）要求七因子正，运行时必须先通过同等校验。
- **(A6) 松弛包含。** `Omega` 包含所有被考虑候选/分支的贡献三元组。`kappa_sigma` 必须由候选池、同步 cap、魔石/食物上界给出；无法认证时禁用本层（§10）。
- **(A7) tie 语义显式化。** 调用方必须声明模型属于「只搜索严格改善」还是「保留同分/身份」。两者使用不同的 `B` 与不同比较（Theorem 3.3、§7.3），不可混用。
- **(A8) 精确整数。** 阈值推导、比较、`K_w` 查询全部使用整数/BigInt 精确运算；`Math.log`、浮点除法不参与正确性判定（`exact-mip-candidate-upper-bound.ts:108-140` 的 BigInt 交叉乘法是最终基准）。

> **关键结构观察。** 由 (A3)+(A4)：`G_>(B)`、`G_>=(B)` 是 `Omega` 中的**上集**（若 `x ∈ G` 且 `y >= x` 则 `y ∈ G`）；`Phi_sigma` 在 tier 单元内为常数。后文的单调性、staircase 与 `K_w` 的计算都只依赖这两条，不依赖因子的具体代数形状。

## 5 精确命题

### 5.1 Lemma 0：由 incumbent 推导严格阈值

#### Lemma 0.1（伤害目标）

设 incumbent 的完整乘积为 `P_inc`，其它乘区上界为 `O > 0`。定义

```text
B_damage = floor(P_inc / O)        （整数；运行时允许 B = max(1, B_damage) 或 B = 0）
```

则对任意真实候选（其贡献三元组 `x ∈ Omega`、其它三因子乘积 `other <= O`）：

```text
候选完整伤害严格大于 incumbent   =>   Phi_C(C) * Phi_H(H) * Phi_D(D) > B_damage
```

由整数整除引理（§6.1），对任意 `O > 0` 都有

```text
Phi_C * Phi_H * Phi_D > B_damage   <=>   O * Phi_C * Phi_H * Phi_D > P_inc
```

因此 `G_>(B_damage)` 也可等价刻画为「乐观其它因子取值下的比较超过 `P_inc`」的集合；当 `O` 恰为候选池其它因子的真实最大乘积时，这一刻画就是「在乐观其它因子下仍可能严格改善」的精确超集。（若 `O` 未被任何候选取到，该刻画仍是安全超集，只是可能更松。）

#### Lemma 0.2（DPS 目标）

设 incumbent `gcd` 为 `I_G > 0`，候选 `gcd` 的下界为 `gcdMin`（`0 < gcdMin <= gcd_c`），其余同上。定义

```text
B_dps = floor( P_inc * gcdMin / (O * I_G) )
```

则对任意真实候选：

```text
候选 DPS 严格大于 incumbent   =>   Phi_C(C) * Phi_H(H) * Phi_D(D) > B_dps
```

其中「DPS 严格大于」采用生产的精确交叉乘法
`upperProduct * I_G > P_inc * gcd_c`（`exact-mip-candidate-upper-bound.ts:127-140` 的否定），`upperProduct = other * Phi_C * Phi_H * Phi_D`。

#### Lemma 0.3（严格阈值与非严格阈值；tie 结构）

定义非严格阈值

```text
B_nonstrict = ceil(P_inc / O)
```

则：

1. `B_nonstrict - B_damage ∈ {0, 1}`，且差为 `1` 当且仅当 `O ∤ P_inc`；
2. `{x : Phi(x) * O >= P_inc} = G_>=(B_nonstrict)`；
3. `G_>(B_damage) ⊆ G_>=(B_nonstrict)`；**等号成立当且仅当 `q := P_inc/O ∉ Phi(Omega)`，即当且仅当不存在同分点**（注意：`O | P_inc` 只是 `q` 为整数的条件，不足以保证 `q` 在像集中）；
4. 存在「恰好同分」的点（`Phi(x) * O = P_inc`）当且仅当 `q := P_inc/O ∈ Phi(Omega)`（等价地：`O | P_inc` **且** `q ∈ Phi(Omega)`）；此时这些点满足 `Phi(x) = B_damage = B_nonstrict = q`，被 `G_>=` 包含、被 `G_>` 排除。**反例**：`Omega={(0,0,0)}`、`P_inc = Phi(0,0,0)`、`O = P_inc` 时 `O | P_inc` 但 `q=1 ∉ Phi(Omega)`，不存在同分点（§7.7）。
5. DPS 的非严格阈值 `B_nonstrict,dps = ceil(P_inc * gcdMin / (O * I_G))` 只给出「保留 tie 的**超集**阈值」；**整除不是 tie 点存在的充分条件**，也不能用「`P_inc*gcdMin/(O*I_G)` 为整数」判定 tie。精确 tie 条件必须使用交叉等式与实际可达的 `(other,gcd)`：存在 `x∈Omega` 与可达的其它因子 `other <= O`、`gcd_c >= gcdMin` 使

```text
other * Phi(x) * I_G = P_inc * gcd_c      （精确交叉等式；而不是仅整除乐观商）
```

若这组 `(other,gcd_c)` 不可达/无解，则只是非严格区域更大而并无 tie 点；tie 模型可安全使用 `G_>=(B_nonstrict,dps)` 作为保守超集，但**不能声称其中的边界点都是 tie 点**。

#### Corollary 0.4（阈值只经乐观极大值依赖候选池；安全方向）

固定 `P_inc`。若 `O_2 >= O_1 > 0`，则 `floor(P_inc/O_2) <= floor(P_inc/O_1)`，即更乐观的其它因子上界给出**更小**的 `B` 与**更大**的 `G_>`；反之，把 `O` 取成小于真实候选其它因子（非乐观界）会给出更大的 `B` 并可能删除改善点（反例 §7.1）。同理 `gcdMin` 必须取下界；取大于真实最小 gcd 的值不安全。

换言之：`B` 对候选池的依赖只经 `O`（DPS 再加 `gcdMin`）；只要 `O/gcdMin` 保持乐观，候选池变化不会破坏安全性。

### 5.2 Theorem 1：`D_min` frontier

**Theorem 1.1（存在唯一性）。** 固定 `B ∈ Z` 与 `(C,H)`。令 `X = Phi_C(C)Phi_H(H) > 0`、`S_{C,H} = {D∈[0,kappa_D] : Phi_D(D) > B/X}`。则：

1. `S_{C,H}` 是上区间：`D∈S` 且 `D' >= D` ⟹ `D'∈S`；
2. `S_{C,H} = ∅` 当且仅当 `Phi_D(kappa_D) * X <= B`；
3. `D_min(C,H;B) := min S_{C,H}`（`∅` 时取 `+infinity`）存在且唯一。

**Theorem 1.2（单调不增）。** 对固定 `B`，`D_min(C,H;B)` 关于 `C`、关于 `H` 单调不增（扩展序：`+infinity` 最大）。

**Theorem 1.3（精确算法）。** 记 CRT/DHT 的 tier 单元表 `{(u_j, c_j)}`、`{(w_l, e_l)}`，DET 可达档位表 `V = {v_0<...<v_K}` 与最小贡献 `d_k`。对每个 tier 单元对 `(j,l)`：

```text
X := F_C(u_j) * F_H(w_l)
若 F_D(v_K) * X <= B :  D_min 单元值 := +infinity
否则:  k* := 最小的 k 使 F_D(v_k) * X > B     （在 V 上二分）
       D_min 单元值 := d_{k*}
```

则对任意 `(C,H)`，把 `(C,H)` 换成其所属 tier 单元的代表后查表所得值恰为 `D_min(C,H;B)`。总工作量 `O(|A_C| * |A_H| * log |V|)`；本文**不声明**该复杂度在运行时的性能收益。

**Theorem 1.4（staircase 紧致表示）。** `D_min(C,H;B)` 只通过 `(t_C(C), t_H(H))` 依赖 `C,H`；因此至多用 `|A_C| * |A_H|` 个整数即可完整表示整个 frontier。由于 `D_min` 关于两个 tier 指标单调不增，每个水平集 `{(C,H) : D_min <= d}` 是 tier 网格上的上集；frontier 是单调 staircase。若两种属性的 tier 值在定义域内连续（本实现的 CRT 各级、DHT 多数等级），则 `|A_sigma| = K_sigma + 1`（`K_sigma := t_sigma(kappa_sigma)-t_sigma(0)`），单元数 `<= (K_C+1)(K_H+1)`，与 issue 评论 02 §六「按等级证明分段结构」的预期规模一致；若有跳档（如 50 级 DHT 的 `550/341>1` 可能跳 tier），实际单元数只会更少。

**Theorem 1.5（slab 上只保留逐点公式；盒域算法不继承——slab 非上集）。** 设 `L/R` 为同一上下文的安全和界，`Omega_slab = Omega ∩ {L <= C+H+D <= R}`，`D_min` 为盒域值。则：

1. **逐点公式（正确）**：对固定 `(C,H)`，定义

```text
D_min_slab(C,H) = max( D_min(C,H), max(0, L−C−H) )            若 D_min(C,H) 有限；
                  上界截断 D <= min(kappa_D, R−C−H)；
                  若 D_min(C,H)=+∞ 或 max(D_min, max(0,L−C−H)) > min(kappa_D, R−C−H)，则 +infinity。
```

该式与「在 `Omega_slab` 上按定义重新取最小 `D`」逐点一致（证明见 §6.2）。

2. **不再成立的结构结论**：`Omega_slab` 一般不是坐标上集（`L <= Σ <= R` 同时破坏向上/向下封闭），因此 `D_min_slab` **不再关于 C/H 单调不增**、**不再在盒域 tier 单元内常值**；Theorem 1.2/1.3/1.4 的单调性、tier 代表元查询与 staircase 表示**不能直接搬到 `Omega_slab`**。

3. **`K_w` 的正确计算**：

```text
K_w^{slab}(B) = min_{ (C,H) ∈ [0,kappa_C]×[0,kappa_H] } [ w_C*C + w_H*H + w_D*D_min_slab(C,H) ]   （跳过 +infinity 截面）
```

这是**精确**公式；它至少需要 `(kappa_C+1)*(kappa_H+1)` 个 `(C,H)` 格点的 O(1) 查询（`D_min` 可先查盒域 tier 单元表），**不是** `|A_C||A_H|` 个 tier 代表元。紧凑表示需要把 `C+H = L−D_min`、`C+H = R−D_min` 等反对角线引入 breakpoint 后重新推导；本文不声称给出最简表示。

4. **安全替代**：若只用 `K_w` 的下界（低估方向），可安全使用 `K_w^{slab} >= K_w` 或其它已证明下界；但不能用「盒域代表元枚举」得到的值。

反例见 §7.6：`L100, κ=(1,1,1), L=R=1, B=1` 时真实 `K_w^{slab}(0,1,1)=0`，而盒域 tier 代表元 `(0,0)` 会给出 `1`（偏大，误删）。

> Theorem 2.2/2.3 的最小反链/tier 枚举同样以「`Omega` 是盒域/`G_>` 是上集」为前提；在 `Omega_slab` 上必须改用 Theorem 1.5 的全枚举或另行证明新结构。安全半空间（Theorem 3.1）只需 `K_w^{slab}` 的**正确值或下界**，因此仍成立（见 Theorem 3.1 的适用说明）。

### 5.3 Theorem 2：`K_w` 与最小反链

**Theorem 2.1（取到性与空集）。** `Omega` 有限，故 `G_>(B) != ∅ ⟺ K_w(B) < +infinity`，且 `K_w` 在 `G_>` 上取到；`G_> = ∅` 时 `K_w = +infinity`。

**Theorem 2.2（最小元刻画；修正版）。** 记 `M(G) := {x∈G : 不存在 y∈G, y != x, y <= x}` 为最小元集合（反链）。则：

1. `K_w(B) = min { w·m : m ∈ M(G) }`（下确界由最小元取到）；
2. `argmin := {x∈G : w·x = K_w(B)}` 非空；对每个 `x∈argmin`，存在 `m∈M(G)∩argmin` 使 `m <= x`；
3. **`argmin` 不必等于 `M(G)`**：`w` 的零分量方向（或存在平台时）会使非最小元也取到同一 `w·x`。反例见 §7.4。

> 与任务书的差异：任务书要求证明「minimizers are exactly the minimal elements of the upper set G(B)（antichain characterization）」。该更强表述为假，本文证明并采用修正版 2.2；`K_w = min_M w·m` 仍然成立，因此安全半空间与所有应用不受影响。

**Theorem 2.3（精确计算）。** 记 `J_C = {(u_j,c_j)}`、`J_H = {(w_l,e_l)}` 为 tier 单元表（`c_j` 为最小贡献），`D_min(j,l)` 由 Theorem 1.3 给出。则

```text
K_w(B) = min { w_C*c_j + w_H*e_l + w_D*D_min(j,l) : (j,l), D_min(j,l) < +infinity }
```

且该式与 `min_{m∈M(G)} w·m` 相等。计算量 `O(|A_C||A_H| log|V|)`，不依赖 `kappa_C kappa_H kappa_D` 的完整体积。

**Theorem 2.4（单调性与齐次性）。**

1. `w <= w'`（逐分量）⟹ `K_w(B) <= K_{w'}(B)`；
2. `B_1 <= B_2` ⟹ `K_w(B_1) <= K_w(B_2)`（等号在 `G` 变化不改变最优方向值时可能成立）；
3. 对任意正整数 `lambda`：`K_{lambda w}(B) = lambda * K_w(B)`（若把 `K` 的定义推广到非负实方向向量，则正实数 `lambda` 同样成立）。

### 5.4 Theorem 3：严格安全的必要半空间

**Theorem 3.1（必要条件）。** 对任意 `w ∈ Z_{>=0}^3 \ {0}`、`B ∈ Z`：

```text
∀ x ∈ G_>(B) :  w·x >= K_w(B)
```

因此对任意整数 `L <= K_w(B)`，删除集合 `{ x∈Omega : w·x < L }` 是安全的（不会删除任何可严格改善 incumbent 的点）。**适用对象**：`K_w` 必须在与 `G_>` 相同的域上计算；若在 `Omega_slab` 上计算，必须使用 Theorem 1.5 的正确公式/全枚举（或已证明的下界），不能沿用盒域代表元枚举。`G_>` 为空时 `K_w=+infinity`：对 `G_>` 的必要半空间论域为空，但结合 `Reach ⊆ Omega_slab` 可给出更强的「无改善点」结论（Theorems 4.1、4.3）。

**Theorem 3.2（安全方向：低估安全，高估不安全）。**

1. **低估安全**：若 `L' <= K_w(B)`，则 `{x : w·x < L'}` 中不含 `G_>` 的点；
2. **高估不安全**：若 `L'' > K_w(B)`，则至少存在一个 `x*∈G_>` 满足 `w·x* = K_w(B) < L''`，即被误删；具体构造见 §7.2；
3. **单调性**：`L` 越大删除集越大；`L <= K_w` 时安全。允许的保守做法包括：只用 `K_w` 的已证明下界、或对 `w·x` 使用更弱的界；**不允许**使用未证明的上界。

**Theorem 3.3（tie 语义；严格 frontier 不能用于删除同分方案）。** 设系统要求保留与 incumbent 同分（或按身份/并列）的方案，则必须使用非严格区域与阈值：

```text
可删除点 := { x : Phi_C*Phi_H*Phi_D < B_nonstrict }，  半空间使用 L <= K_w^{>=}(B_nonstrict)，
其中 K_w^{>=}(B) := min { w·x : x ∈ G_>=(B) }。
```

若此时改用严格 `G_>(B_damage)` 的补集删除，则**当存在同分点时**（`q := P_inc/O ∈ Phi(Omega)`，见 Lemma 0.3；仅 `O | P_inc` 不足）会删除 `Phi*O = P_inc` 的同分点（§7.3 给出数值反例，§7.7 给出「整除但无同分点」的反例：此时两个集合相等、无 tie 方案可误删）。三种模型必须显式区分：

| 模型 | 保留集合 | 阈值/区域 | 半空间 |
| --- | --- | --- | --- |
| 只找严格改善 | `G_>(B_damage)` | `>` | `L <= K_w(B_damage)` |
| 保留 tie / 需要比较同分 | `G_>=(B_nonstrict)` | `>=` | `L <= K_w^{>=}(B_nonstrict)` |
| 需要身份/全部同分方案 | 不能用本层删除同分点 | 只能做「不能严格改善」判定 | 仅用于证明「该点非严格改善」，不得用于枚举剪枝 |

后两种语义下，本定理只能作为「严格改善」的过滤器；**「不能严格改善 incumbent」与「可以删除同分方案」是不同命题，后者不由本定理蕴含**。

### 5.5 Theorem 4：空改善区域与退化情形

**Theorem 4.1（空改善区域；严格与非严格必须分开——非严格域）。** 令 `P* = max_{x∈Omega} Phi_C Phi_H Phi_D`（由单调性等于顶角值，且顶角达到，故 `G_>=(P*) != ∅`）。则：

1. **严格域**：`G_>(B) = ∅ ⟺ B >= P*`；
2. **非严格域**：`G_>=(B) = ∅ ⟺ B > P*`；特别地 `B = P*` 时 `G_>=(P*)` 恰为 `argmax_{Omega} Phi`，**非空**，必须保留（这是 tie/身份模型的关键边界：把 `G_>=` 判空会删除最大值的同分方案）；
3. 当 `B >= P*` 时**每一个** `x∈Omega` 都不能严格改善 incumbent（比「半空间在该点成立」更强的结论）；此时严格核 `K_w(B) = +infinity`（对一切 `w`）；
4. `B = P*` 时严格 `K_w(P*)=+infinity`，但非严格核

```text
K_w^{>=}(P*) = min { w·x : x ∈ G_>=(P*) } = min { w·x : Phi(x) = P* }
```

**有限**（argmax 集合非空），且对 tie/身份模型是必须使用的阈值；
5. `B > P*` 时两个核都为空（`K_w = K_w^{>=} = +infinity`）：严格与非严格模型都可直接返回「无改善/无同分方案」，这已经是比半空间更强的结论。

若仅有 `G_> ∩ R = ∅`（某子区域 `R`），则半空间在 `R` 上为空真；不能据此对该区域外的点下结论。§11 的 A9/A13 覆盖 `B=P*` 用例（`G_>` 空、`G_>=` 非空、`K_w=+∞`、`K_w^{>=}` 有限）。

**Theorem 4.2（退化情形）。**

1. `B <= 0`：因三因子在 `Omega` 上恒 `>= 1_000_000*4000*1000 > 0`，`G_>(B) = Omega`；`K_w = 0`（原点在 `Omega` 且 `w>=0`），半空间 `w·x >= 0` 平凡。此情形不应被误当作有效剪枝。
2. `B = 1`：等价于 `G_> = Omega`（同上，因最小乘积远大于 1）。一般地若 `B < min_{Omega} Phi_C Phi_H Phi_D`，则 `G_> = Omega`。
3. 退化维度：`kappa_D = 0`（DET 贡献固定为 0）时 `|V| = 1`，`D_min ∈ {0, +infinity}`；`kappa_C = 0` 或 `kappa_H = 0` 同理（`A_C`/`A_H` 只有一个单元）。Theorem 1.3 的算法对这些情形自动成立（§11 覆盖）。
4. `w` 的分量为 0：允许（只要 `w != 0`）。分量 0 意味着该坐标不进入半空间；Theorem 2.2/2.3 的证明只用到 `w >= 0`。`w = 0` 被排除（`K_0 ≡ 0`，半空间平凡）。
5. `G_>` 非空但 `K_w = +infinity` 不会发生：`G_> != ∅ ⟺ K_w < ∞`（Theorem 2.1）。
6. `+infinity` 的处理：实现中必须显式区分「`G` 空」与「`D_min = +infinity` 的单元」，禁止把 `+infinity` 当作大整数参与比较或溢出。

### 5.6 Theorem 5：参数化支撑族与非冗余

设运行时对同一 `B` 认证了一族方向 `w_1,...,w_m ∈ Z_{>=0}^3\{0}` 与阈值 `K_i := K_{w_i}(B)`。剪枝区域为

```text
D_prune = ∪_{i=1..m} { x∈Omega : w_i·x < K_i }.
```

**Theorem 5.1（任意子集正确性）。** 对任意子集 `S ⊆ {1..m}`，用 `∪_{i∈S}` 剪枝都不会删除 `G_>(B)` 的任何点。故 `m`、`S`、方向选择都只影响剪枝强度，**不影响正确性**。

**Theorem 5.2（冗余的精确判据）。** 记 `H_i = {x∈Omega : w_i·x >= K_i}`。支撑 `i` 是冗余的（去掉它不改变 `D_prune`）当且仅当

```text
∩_{j != i} H_j  ⊆  H_i          （等价地  min_{x ∈ ∩_{j≠i}H_j ∩ Omega} w_i·x >= K_i）
```

因此一个**充分**（且对有限可枚举域可判定）的检查是：在 `Omega` 上求 `min w_i·x s.t. 其它半空间成立`，若其值 `>= K_i` 则删除该支撑不会损失任何剪枝。特殊情形：

1. **比例蕴含**：若 `w_j = lambda * w_i`（`lambda > 0`）且 `K_j >= lambda * K_i`，则 `H_j ⊆ H_i`，支撑 `i` 冗余；
2. **空支撑**：若 `K_i <= min_{x∈Omega} w_i·x`（`w_i>=0`、原点在 `Omega` 时即 `K_i <= 0`），则删除集为空，支撑冗余；
3. **空改善区域**：`G_> = ∅` 时全部支撑都冗余（且更强结论成立，见 Theorem 4.1）。

**Theorem 5.3（正确性不依赖支撑数量）。** 由 Theorem 5.1，任何 `m` 与任何子集都安全；`m` 的选取（「当前剪枝收益最大」「边际收紧小于阈值就停止」等）是性能 policy。本文不声明任何性能收益，也不给出最优 `m` 的证明。

## 6 证明

### 6.1 Lemma 0

**Lemma 0.1 证明。** 设候选贡献三元组为 `x`，其它三因子乘积 `other_c`。由 `other_c <= O` 与因子正性：

```text
P_inc < other_c * Phi(x) <= O * Phi(x)   =>   Phi(x) > P_inc / O.
```

`Phi(x)` 为整数，故 `Phi(x) > P_inc/O` 等价于 `Phi(x) >= floor(P_inc/O)+1`，即 `Phi(x) > B_damage`。反向只是一个**等价刻画**而非候选池断言：由下面的整除引理，`Phi(x) > B_damage ⟺ O*Phi(x) > P_inc`（对任意 `O>0`）；故 `G_>(B_damage)` 恰是「乐观其它因子取值下的比较超过 `P_inc`」的贡献三元组集合。是否存在真实候选取到 `O` 属于候选池信息，不参与剪枝安全性（剪枝只用正向蕴含）。

**引理（floor 整除恒等）。** 对正整数 `P,O` 与整数 `phi`：`phi*O > P ⟺ phi > floor(P/O)`。证明：设 `P = qO + r`，`0 <= r < O`。若 `r = 0`：`phi*O > qO ⟺ phi > q = floor(P/O)`；若 `r>0`：`phi*O > qO + r ⟺ phi >= q+1 ⟺ phi > q`（因为 `phi*O <= qO` 时 `<= qO < P`，而 `phi >= q+1` 时 `phi*O >= qO+O > qO+r`）。∎

**Lemma 0.2 证明。** 候选 DPS 严格更优即 `upperProduct * I_G > P_inc * gcd_c`，其中 `upperProduct = other_c * Phi(x) <= O*Phi(x)`、`gcd_c >= gcdMin`。于是

```text
P_inc * gcdMin <= P_inc * gcd_c < upperProduct * I_G <= O * Phi(x) * I_G
=>  Phi(x) * O * I_G > P_inc * gcdMin  =>  Phi(x) > P_inc*gcdMin/(O*I_G)  =>  Phi(x) > B_dps.
```

**Lemma 0.3 证明。** 由 `B_nonstrict = ceil(P_inc/O)`：对整数 `phi`，`phi >= ceil(P/O) ⟺ phi*O >= P`（与 Lemma 0.1 引理对偶），故 2 成立；1 由 `ceil - floor ∈ {0,1}` 且差 1 当且仅当 `O ∤ P`。

**3 的证明（修正）**：`G_>` 与 `G_>=` 仅可能在 `Phi` 值等于阈值 `floor(q)` 的间隙处不同（`q=P_inc/O`）。若 `q` 非整数，则 `floor(q)+1 = ceil(q)`，两集合都等于 `{Phi >= ceil(q)}`；若 `q` 为整数但不属于像集 `Phi(Omega)`，则 `{Phi >= q}` 中没有 `Phi=q` 的点，也等于 `{Phi >= q+1}`；两种情形都无同分点、两集合相等。反之若 `q ∈ Phi(Omega)`，则存在 `x` 使 `Phi(x)=q`，该点属于 `G_>=` 而不属于 `G_>`，两集合不相等。故等号 ⟺ `q ∉ Phi(Omega)` ⟺ 不存在同分点。

**4 的证明（修正）**：同分点要求 `Phi(x)*O = P_inc`，即 `Phi(x)=q`；因 `Phi(x)` 为整数，这等价于 `O | P_inc`（`q` 为整数）**且** `q ∈ Phi(Omega)`（像集可达）。仅 `O | P_inc` 不足：§7.7 的 `Omega={(0,0,0)}`、`q=1` 反例中整除成立但 `1 ∉ Phi(Omega)`，无同分点。当条件成立时，这些点满足 `Phi = B_damage = B_nonstrict = q`。

**5 的证明（DPS，修正）**：`B_nonstrict,dps = ceil(P_inc*gcdMin/(O*I_G))` 只由乐观界推出，是保留 tie 的**超集**阈值；tie 点存在性要求实际可达的 `(other,gcd_c)` 满足交叉等式 `other*Phi(x)*I_G = P_inc*gcd_c`（`other <= O`、`gcd_c >= gcdMin` 且可达）。该条件不能由「商为整数」推出（整除只是乐观商为整数的必要条件），也不能由它反推不存在 tie；因此 DPS 的 tie 处理必须用精确交叉等式/可达 gcd 集合核对，或保守使用 `G_>=(B_nonstrict,dps)` 作为超集。∎

**Corollary 0.4 证明。** 对正整数 `O_2 >= O_1`，`floor(P/O_2) <= floor(P/O_1)`；于是 `B_2 <= B_1` 且 `G_>(B_1) ⊆ G_>(B_2)`。`O` 取小于真实候选乘积时，Lemma 0.1 的 `other_c <= O` 前提失效，正向蕴含不再可得（反例 §7.1）。∎

### 6.2 Theorem 1

**1.1 证明。** 记 `X = Phi_C(C)Phi_H(H) > 0`。由 (A4)，`D -> Phi_D(D)` 非减，故若 `D∈S` 且 `D'>=D` 则 `Phi_D(D') >= Phi_D(D) > B/X`，上区间性成立。`D <= kappa_D`，故 `S` 非空当且仅当最大点 `kappa_D ∈ S`，即 `Phi_D(kappa_D)X > B`。有限非空整数集有唯一最小元。∎

**1.2 证明。** 固定 `H`。若 `C_1 <= C_2`，由 (A4) `Phi_C(C_1) <= Phi_C(C_2)`，故对任意 `D`：`Phi_C(C_1)Phi_H(H)Phi_D(D) > B ⟹ Phi_C(C_2)Phi_H(H)Phi_D(D) > B`，即 `S_{C_1,H} ⊆ S_{C_2,H}`。于是 `min S_{C_2,H} <= min S_{C_1,H}`（`∅` 视为 `+infinity`；`S_1=∅` 时右边为 `+infinity`，不等式自动成立）。关于 `H` 同理。∎

**1.3 证明（算法正确性）。** 先证表构造正确：对每个 `j`，`c_j` 是达到 tier `u_j` 的最小贡献，由 (A4) 与 `A_sigma` 定义存在且 `Phi_sigma(c_j)=F_sigma(u_j)`；且 `c_j` 递增。将任一 `C` 映射到其 tier 单元 `j(C)`（`t_C(C)=u_j`），则 `Phi_C(C)=F_C(u_j)`；故 `X` 在单元内为常数，算法对单元代表值成立即对单元内所有点成立。
对单元值 `X`：由 (A4)，`k -> F_D(v_k)` 严格递增。若 `F_D(v_K)X <= B`，则对任意 `D`，`Phi_D(D) ∈ V` 且 `<= F_D(v_K)`，故 `Phi_D(D)X <= B`，`S=∅`，`D_min=+infinity`。否则集合 `{k : F_D(v_k)X > B}` 非空且是上区间，二分返回其最小元 `k*`。
最后证 `d_{k*}` 是 `[0,kappa_D]` 中最小的满足条件者：由 `A_D` 的构造，`d_k` 是达到 `v_k` 的最小贡献，且对 `D < d_k` 有 `Phi_D(D) ∈ {v_0,...,v_{k-1}}`（严格递增性）。当 `k*>0` 时，由二分返回最小 `k*` 知 `v_{k*-1}·X <= B`，故对任意 `D < d_{k*}`，`Phi_D(D) <= v_{k*-1} <= B/X`，不满足严格条件；而 `Phi_D(d_{k*}) = v_{k*} > B/X`。因此 `d_{k*}` 是最小可行 `D`。∎

> 严格 / 非严格：把谓词 `F_D(v_k)X > B` 换成 `>= B_nonstrict`，证明逐字成立；两者不可混用（Theorem 3.3）。

**1.4 证明。** 由 1.3 的单元不变性，`D_min` 是 `(j(C), l(H))` 的函数，至多 `|A_C||A_H|` 个取值。单调不增（1.2）在 tier 指标网格上意味着：若 `D_min(j,l) <= d`，则 `j'>=j, l'>=l` 时 `D_min(j',l') <= d`，即水平集是上集。上集在二维网格中的边界是单调 staircase；给定全部 `|A_C||A_H|` 个单元值即可精确重构边界。`|A_sigma| <= K_sigma+1`（`K_sigma` 为 tier 跨度）给出任务书要求的规模形式；有跳档时更小。∎

**1.5 证明（slab）。** 对固定 `(C,H)`，`Omega_slab` 在该截面上允许的 `D` 集合为 `[max(0,L−C−H), min(kappa_D,R−C−H)]`（与 `[0,kappa_D]` 的交），而 `G_>` 的截面是 `D >= D_min(C,H)`。两者交非空当且仅当 `max(D_min,max(0,L−C−H)) <= min(kappa_D,R−C−H)`，且最小元就是 `max(D_min,max(0,L−C−H))`（若 `D_min=+∞` 则空）。这是逐点定义，不涉及 tier 单元常值或 C/H 单调性。

**不继承的反例（§7.6）**：`L100, κ=(1,1,1), L=R=1, B=1`。所有点的 `Phi > 1`，故 `G_> ∩ Omega_slab` 恰为 `(1,0,0),(0,1,0),(0,0,1)`；`D_min_slab(0,0)=1`、`D_min_slab(1,0)=0`、`D_min_slab(1,1)=+∞`，在 C 上递增（违反 Theorem 1.2），且 `(0,0)` 与 `(1,0)` 属于同一盒域 tier 单元（贡献 0 与 1 的档位相同）却取值不同（违反 Theorem 1.3/1.4 的单元常值）。`K_w^{slab}` 只能按 Theorem 1.5 的全枚举计算：对 `w=(0,1,1)`，真实值为 `0`（由 `(1,0,0)`）；若沿用盒域 tier 代表元 `(0,0)`（`D_min_slab=1`）会得到 `1`（偏大、不安全）。∎

### 6.3 Theorem 2

**2.1 证明。** `Omega` 有限、`w·x` 为整数值函数，`G_> != ∅` 时最小值在有限集上取到。空集其上确界按约定为 `+infinity`，且不存在有限点。∎

**2.2 证明。** 1) 对任意 `x∈G_>`，因 `Omega` 有限且坐标有下界，沿「坐标递减且仍在 `G` 中」的链必终止于最小元 `m<=x`；由 `w>=0`，`w·m <= w·x`。故 `inf_{G} w·x = min_M w·m`，且两边都取到。2) `argmin` 非空（2.1）。对 `x∈argmin`，取上述 `m<=x`；`w·m <= w·x = K_w`，又 `K_w` 是 `G` 上最小，故 `w·m=K_w`，即 `m∈argmin`。3) 反例见 §7.4：`w=(1,0,0)` 时所有 `x=(K_w, H, D)∈G` 都是 argmin，但只有其中坐标极小的少数是最小元。∎

**2.3 证明。** 对固定 `(C,H)`，`w_D >= 0` 且 `D -> w_D D` 非减，故 `G` 在该截面上的最小值在最小可行 `D`（即 `D_min(C,H)`）取到；该截面非空当且仅当 `D_min < +infinity`。于是

```text
K_w = min_{C,H} [ w_C C + w_H H + w_D D_min(C,H) ]   （截面为空则跳过）.
```

再由 1.3 的单元不变性：`D_min` 只依赖 `(j(C),l(H))`；`w_C C + w_H H` 在单元内由 `w>=0` 在最小代表 `c_j, e_l` 取最小。故只需枚举 tier 单元对。与 2.2 的最小反链公式相等由 2.2(1)。∎

**2.4 证明。** 1) 对同一 `x∈G`，`w<=w'` 且 `x>=0` 给出 `w·x <= w'·x`；两边取 `min` 得 `K_w <= K_{w'}`。2) `B_1 <= B_2 ⟹ G_>(B_2) ⊆ G_>(B_1)`，在更大集合上取下确界不增。3) 对 `lambda>0`，`min_x lambda f(x) = lambda min_x f(x)`。∎

### 6.4 Theorem 3

**3.1 证明。** 由 `K_w` 定义，对 `x∈G_>` 有 `w·x >= min_{y∈G} w·y = K_w`。若 `L <= K_w` 且 `w·x < L`，则 `w·x < K_w`，与上式矛盾，故 `x∉G_>`；删除点都不是可严格改善点。∎

**3.2 证明。** 1) 是 3.1 的直接推论（`L' <= K_w`）。2) 由 2.1，存在 `x*∈G_>` 取到 `w·x*=K_w`；若 `L''>K_w` 则 `x*` 满足 `w·x* < L''`，被删除但属于 `G_>`。3) 删除集 `{w·x < L}` 关于 `L` 单调。低估即 `L <= K_w`，由 3.1 安全；高估即 `L > K_w`，由 2) 不安全。注意：使用「`K_w` 的已证明下界 `L`」属于低估方向，安全；使用「`K_w` 的未证明上界」或近似值则不安全。∎

**3.3 证明。** 由 Lemma 0.3，`G_>=(B_nonstrict) = {Phi*O >= P_inc}` 恰是「在乐观其它因子下仍可能同分或更好」的集合；其补集才是可安全删除的点。严格区域 `G_>` 的补集多出边界点 `{Phi*O = P_inc}`：这些点**在存在同分点时**（`q∈Phi(Omega)`）精确同分，删除它们会改变保留 tie 的搜索结果；若 `q∉Phi(Omega)`（例如 `Omega` 不取到该商或 `O∤P`），则不存在这样的边界点，两个集合相等，严格补集与 tie 补集一致（§7.7）。`K_w^{>=}` 的单调性/半空间安全性证明与 3.1 完全相同（把 `G_>` 换成 `G_>=`）。∎

### 6.5 Theorem 4

**4.1 证明。** `P*` 为 `Omega` 上最大乘积，且由 (A4) 逐坐标单调在顶角取得，故 `argmax != ∅`、`P* ∈ Phi(Omega)`。于是：

- 严格：`B >= P*` 时对一切 `x`，`Phi(x) <= P* <= B`，故 `x∉G_>(B)`，`G_>=∅`；`B < P*` 时顶角 `Phi=P* > B`，`G_>≠∅`。故 `G_>(B)=∅ ⟺ B>=P*`。
- 非严格：`B > P*` 时对一切 `x`，`Phi(x) <= P* < B`，`x∉G_>=(B)`；`B = P*` 时顶角 `Phi=P* >= B`，故 `G_>=(P*) = argmax_{Omega} Phi` 非空。故 `G_>=(B)=∅ ⟺ B>P*`。
- `B=P*` 时严格核 `K_w=+infinity`（`G_>` 空），非严格核 `K_w^{>=}(P*) = min{w·x : Phi(x)=P*}` 在非空有限 argmax 上取得，有限。
- 异常空真与「逐点不可改善」的区别见正文。∎

**4.2 证明。** 1/2 由三因子在 `Omega` 上 `>= 1_000_000*4000*1000`（(A3)）与 `B <= 1` 得 `Phi(x) > B` 恒成立。3) `kappa_sigma=0` 时 `A_sigma` 单元素，1.3 的二分在 `|V|=1` 时退化为直接比较；`D_min∈{0,+∞}`。4) `w` 的零分量不影响 `w>=0` 前提、2.1–2.4 的证明与 `K_w` 取到性；`w=0` 时 `K_w=0` 且半空间对全部点成立（无剪枝能力）。5) 由 2.1。6) 是表示约定，实现必须用显式哨兵（如 `null`/`Infinity`）而非大整数。∎

### 6.6 Theorem 5

**5.1 证明。** 由 3.1，`G_> ⊆ ∩_{i=1..m} H_i ⊆ ∩_{i∈S} H_i`，故 `∪_{i∈S} D_i` 与 `G_>` 不交（`D_i = H_i` 的补）。∎

**5.2 证明。** `D_prune` 去掉支撑 `i` 后不变 ⟺ `D_i ⊆ ∪_{j≠i} D_j` ⟺ 取补得 `∩_{j≠i} H_j ⊆ H_i`。后一包含式等价于 `min_{x∈∩_{j≠i}H_j} w_i·x >= K_i`（`∩_{j≠i}H_j` 为 `Omega` 的有限子集）。比例蕴含：`w_j = lambda w_i`、`K_j >= lambda K_i` 时，`w_i·x >= K_i ⟸ w_j·x >= K_j`（因 `w_j·x = lambda w_i·x`）。空支撑：`K_i <= min_Omega w_i·x` 时 `H_i = Omega`，`D_i=∅`。∎

**5.3 证明。** 由 5.1 对任意子集成立。支撑数量由运行时 policy 决定（例如按当前域上的删除体积排序并截断），但任何截断都只减少删除量、不改变「保留下来的点包含 `G_>`」这一安全性。本文不声明收益。∎

### 6.7 应用规则的安全性（由以上定理合成）

见 §10 的契约。核心是：所有删除决定都必须能归结为「该点/该区域与 `G_>`（或 tie 语义下的 `G_>=`）不相交」；`B` 必须由乐观界推出；`L` 必须 `<= K_w`；最终候选认证仍由 `candidateUpperBoundCannotImproveIncumbent`（精确 BigInt 比较）完成。

## 7 反例与边界退化

以下数值均由 [`verify.mjs`](verify.mjs) 在 canonical 模型上复现（level=100 WHM，松弛盒 `{C:0..140, H:0..100, D:0..220}`；盒内乘积上界 `4,163,163,941,400 < 2^53`，可用安全整数精确复现）。

### 7.1 非乐观其它因子上界会删除改善点

设 incumbent 完整乘积 `P_inc = 519,436,866,684,330,000,000`（由 incumbent 因子 `W=700, main=180, TEN=1000` 与副属性乘积 `4,122,514,814,955` 构成）。真实候选池中其它因子可达 `O = 730*190*1050 = 145,635,000`。正确的 `B_damage = floor(P_inc/O) = 3,566,703,516,904`。

若误把 `O` 取成 `O' = 690*175*980 = 118,335,000`（并非上界），得到 `B' = 4,389,545,499,508 > B_damage`。此时点 `x=(0,0,0)`：副属性乘积 `Phi = 4,080,000,000,000`，而存在其它因子为 `O` 的真实候选使 `O*Phi = 5.94e20 > P_inc`，即该点（在乐观模型下）可严格改善；但 `Phi = 4.08e12 <= B'`，会被错误删除。结论：`O` 必须是**上界**（越大越安全），Lemma 0 的蕴含方向不可反用。

### 7.2 `L > K_w` 会删除改善点（显式构造）

取 `w=(1,0,0)`、`B = prod(56,100,220) - 1 = 4,151,851,967,543`（即顶角 `(56,100,220)` 是最小 `C` 使某截面可改善）。则 `K_w(B) = 56`，且 `x*=(56,100,220) ∈ G_>(B)`。若误用 `L = K_w+1 = 57`，则 `w·x* = 56 < 57`，`x*` 被删除——尽管它严格改善。低估方向 `L <= 56`（例如 `L=56` 或 `L=0`）不删除任何改善点。

### 7.3 tie 语义：用严格 frontier 删除同分方案是错的

取可整除构造 `P_inc = 4,113,667,312,800 * 1000`（即存在点 `x_t=(70,45,90)` 满足 `Phi(x_t)*1000 = P_inc`）。此时 `B_damage = B_nonstrict = 4,113,667,312,800 = Phi(x_t)`；该点与 incumbent 精确同分：

- `G_>` 不包含 `x_t`（要求 `>`）；
- `G_>=` 包含 `x_t`（要求 `>=`），并且在本盒内比 `G_>` 多出 `2800` 个同分点。

若系统要求保留同分方案/比较并列，使用 `G_>` 的补集删除会把 `x_t` 及其它 2799 个同分点删除，从而改变搜索输出。**同分点存在的正确条件**是 `q := P_inc/O ∈ Phi(Omega)`（Lemma 0.3）；`O | P_inc` 只是 `q` 为整数的必要条件，不足以保证 `q` 可达。当 `q ∉ Phi(Omega)`（无论 `O` 是否整除 `P_inc`）时 `G_>` 与 `G_>=` 作为集合相等、不存在同分点，严格 frontier 不会误删 tie（§7.7 给出「整除但商不可达」的反例）。这也纠正了「tie 句柄只在可整除时出现」的旧表述：可整除但商不可达时没有 tie 句柄。

### 7.4 「argmin = 最小元」的过强表述为假（修正任务书）

在 `B = prod(100,70,150)-1` 的同一松弛盒上取 `w=(1,0,0)`：`K_w = 0`。`argmin` 包含 `900` 个点（所有 `C=0` 且可改善的 `(H,D)`），但其中只有 `3` 个是最小元；其余 `897` 个都支配着某个更小的 argmin 点。每个 argmin 都支配至少一个最小 argmin（`900/900` 验证）。因此正确命题是 Theorem 2.2 的版本：`K_w = min_M w·m`，且每个 argmin 支配一个最小 argmin；不能声称 argmin 集合等于最小反链。

### 7.5 空改善区域、`B=P*` 的严格/非严格边界（非严格域）与「某子区域为空」

主盒 `P* = 4,163,163,941,400`（顶角乘积）：

- **严格核**：`B >= P*` 时 `G_>(B)=∅`，盒内严格改善点数为 `0`，`K_w(B)=+infinity`（对全部测试方向）；这给出比「半空间在该区域成立」更强的结论。
- **非严格核**：`B = P*` 时 `G_>=(P*) = argmax_{Ω} Phi` **非空**（顶角及同乘积点），`K_w^{>=}(P*)` 有限；把 `G_>=` 判空会删除最大值的同分方案。`B > P*` 时 `G_>=(B)` 才为空（`K_w^{>=}=+infinity`）。§11 的 A13 用 `B=P*` 断言 `G_>` 空、`G_>=` 非空、`K_w` 与 `K_w^{>=}` 的不同语义。
- 若只知道某分支子区域 `R` 上 `G∩R=∅`，则只能剪掉 `R`，不能对其外部下结论，也不能把该空真半空间当作全局界。

### 7.6 slab 不继承盒域档位算法（slab 反例）

取 L100 WHM、`κ=(1,1,1)`、`L=R=1`、`B=1`。三因子乘积恒 `> 1`（远大于 1），故 `G_> = Ω`；但 slab `Σ=1` 内只剩

```text
(1,0,0), (0,1,0), (0,0,1)
```

`D_min_slab`（固定 `(C,H)` 在 slab 上取最小 `D`）：

| `(C,H)` | `D_min_slab` | 说明 |
| --- | ---: | --- |
| `(0,0)` | 1 | 唯一 slab 点 `(0,0,1)` |
| `(1,0)` | 0 | `(1,0,0)` |
| `(1,1)` | `+∞` | 需 `D=−1` |

这**违反** Theorem 1.2 的 C 单调不增（在 `H=1` 行：`D_min_slab(0,1)=0` 而 `D_min_slab(1,1)=+∞`，C 增大而值增大），也**违反** Theorem 1.3/1.4 的 tier 单元常值：贡献 `0` 与 `1` 的档位相同（`t_CRT(0)=t_CRT(1)=50`、DHT 同理、DET 同理），但 `(0,0)` 与 `(1,0)` 的 `D_min_slab` 不同。取 `w=(0,1,1)`：

```text
真实 K_w^{slab} = min{w·x : x ∈ G_>∩Omega_slab} = 0   （由 (1,0,0)）
盒域 tier 代表元 (0,0) 的算法值 = 0+1 = 1             （偏大、不安全：L=1 > 0 会删掉改善点 (1,0,0)）
```

正确做法是 Theorem 1.5 的 `(C,H)` 全枚举：`K_w^{slab} = min_{(C,H)} [w_C C+w_H H+w_D D_min_slab(C,H)]`（跳过 `+∞`），该式在本例给出 `0`（§11 A13）。

### 7.7 整除不足以存在同分点（同分点可达性反例）与 DPS 的 tie 条件

取 `Ω={(0,0,0)}`、`Φ0 = Φ(0,0,0) = 4,080,000,000,000`、`P_inc = Φ0`、`O = P_inc`（合法的乐观上界：其它因子恰取该值时等于 incumbent）。则：

```text
O | P_inc 成立，q = P_inc/O = 1；但 Phi(Omega) = {Φ0}，1 ∉ Phi(Omega)
B_damage = B_nonstrict = 1
G_>(1) = {Phi > 1} = Ω，G_>=(1) = {Phi >= 1} = Ω     （两集合相等）
```

**不存在**同分点；严格 frontier 与 tie frontier 在这里一致，旧的「`O|P_inc` ⇒ 存在同分点」会错误地要求保留 tie。反过来，只有当 `q∈Phi(Ω)` 时才存在 `Phi=q` 的同分点，`G_>=` 比 `G_>` 多出该像点。

**DPS 对应检查**：取 `I_G = gcdMin = 25`，则乐观商 `P_inc*gcdMin/(O*I_G) = 25/25 = 1` 为整数，但 `1 ∉ Phi(Ω)`，`B_nonstrict,dps` 与严格阈值仍相等、无 tie。更一般地，tie 点存在性必须核对实际可达 `(other, gcd_c)` 的精确交叉等式 `other*Phi(x)*I_G = P_inc*gcd_c`（`other <= O`、`gcd_c >= gcdMin` 且真实可达）；整除只是乐观商的整数性，既不充分也不必要。§11 A13 覆盖该反例。

## 8 依赖与关联定理

| 依赖 | 用途 |
| --- | --- |
| [canonical-evaluator-reference.md](../../canonical-evaluator-reference.md) | 等级参数表、整数档位/因子定义、基础属性归约（贡献坐标，§2.1）、可达域截断等价（§2.2）、精确乘积（§4）（权威事实基础） |
| [raw-tier-transform](../raw-tier-transform/README.md) | `g>=0` 上 `Math.trunc(v+1e-7)=floor(v)` 的等价性；档位单调性；阈值反查公式（本文 `c_j/d_k` 的依据） |
| [tier-log-curvature](../tier-log-curvature/README.md) | 因子正性（(A3) 的完整证明）；离散 log 凸凹与边际结构（本文不用于几何结构，但用于理解 frontier 形状的可选背景） |
| [marginal-comparison](../marginal-comparison/README.md) | 单位成本边际比较与交叉指数判据（[attribute-swap-criterion](../attribute-swap-criterion/README.md) 使用；本文的 `B` 推导不需要 log） |
| [free-budget-upper-bound](../free-budget-upper-bound/README.md)、[simplex-vertex-reduction](../simplex-vertex-reduction/README.md) | `U(b,R,kappa)` 自由资源松弛的精确档位三元组刻画；`Omega` 可取为 simplex 的外接盒，或在 simplex 切片上逐片使用 frontier |
| 单资源 Lagrangian 上界（`factor-resource-budget-upper-bound.ts:88-147`） | 不可认证时的安全回退层 |
| [joint-loss-sum-bound](../joint-loss-sum-bound/README.md) | 多职业联合层；与本层正交（不同乘区/不同域） |
| [pairwise-endpoint-max](../pairwise-endpoint-max/README.md)、[pairwise-slice-critical-set](../pairwise-slice-critical-set/README.md) | 替代/互补的 pairwise 结构证明；本文不依赖它们成立 |
| [attribute-swap-criterion](../attribute-swap-criterion/README.md) | 自由松弛内的合法状态删除；与 frontier 共用同一松弛域，但那条定理不用于删除真实装备 |
| [substat-sum-upper-bound](../substat-sum-upper-bound/README.md)、[substat-sum-lower-bound-pruning](../substat-sum-lower-bound-pruning/README.md) | 三属性和 `S=C+H+D` 的安全上/下界与 slab 收紧（可选）：`Omega_slab = Omega ∩ {L<=S<=R}` 时仅**集合安全**可继承（`K_w(Omega_slab)>=K_w(Omega)`、半空间仍必要）；盒域 `D_min` 单调/档位代表/最小反链枚举**不继承**——必须用 Theorem 1.5 的逐点公式与 `(C,H)` 全枚举（§3.2、§7.6）。slab 不改变 `U` |
| [coordinate-lower-bound-box](../coordinate-lower-bound-box/README.md) | 轴方向支撑 `w=e_i` 的显式坐标屏障形式（`l_i(B)=K_{e_i}^{>=}(B)`）、乘积下界 `Phi(l)<=OPT`、超集小域上的有效性、精炼算子 `T` 的幂等/阈值；box 剪枝不超出本文支撑族（不增剪枝强度） |

## 9 与 canonical evaluator 的对应（file:line）

| 本文对象 | 生产实现 |
| --- | --- |
| `t_CRT(g)` | `src/domain/search/equipped-effects.ts:138-140` |
| `t_DET(g)`（`detTrunc` 两层结构） | `src/domain/search/equipped-effects.ts:141-143` |
| `t_DHT(g)`（BLU 偏移） | `src/domain/search/equipped-effects.ts:144-146` |
| `t_TEN(g)`（本文只以乐观界出现） | `src/domain/search/equipped-effects.ts:147-149` |
| `floor = Math.trunc(v + 1e-7)` | `src/domain/search/equipped-effects.ts:163-166` |
| `F_C/F_H/F_D` 装配 | `src/domain/search/equipped-effects.ts:92-101`（critical 97、directHit 98、determination 95） |
| 档位入口 `equippedAttributeTier` | `src/domain/search/equipped-effects.ts:110-154` |
| 基础属性归约（贡献坐标；`value = baseStats + gearAndFoodValue`，再减 `sub`/`main`） | `src/domain/search/equipped-effects.ts:127-149`、`178-203`；参考模型 §2.1、§2.2 |
| 精确完整乘积 `exactProduct` | `src/domain/search/exact-mip-candidate-upper-bound.ts:108-112` |
| 因子正性校验 `safeDamageFactors` | `src/domain/search/exact-mip-candidate-upper-bound.ts:96-106` |
| 严格更差 / 不能严格改善（含 DPS 交叉乘法） | `src/domain/search/exact-mip-candidate-upper-bound.ts:113-140` |
| 单资源 Lagrangian 上界（回退层） | `src/domain/search/factor-resource-budget-upper-bound.ts:88-147` |
| DET 档位表二分与阈值反查 | 本文算法；数值原语见 `docs/mathematical-analysis/verification/canonical-model.mjs:106-117`（`tier`、`firstContributionWithTierAtLeast`）与 `:126-154`（因子） |

说明：`B`、`D_min`、`K_w`、`L` 是**本文引入的派生量**，生产代码目前没有对应函数；若实现，必须按 §10 的契约调用现有精确比较函数做最终认证，不得替换 `candidateUpperBoundCannotImproveIncumbent`。

## 10 应用前提与安全回退

### 10.1 输入与前提检查（全部通过才启用本层）

1. `(level, job)` 解析成功且在支持表内；得到普通/BLU 参数（参考模型 §2）。
2. `Omega` 的 `kappa_C,kappa_H,kappa_D` 已由当前候选池、同步 cap、魔石/食物上界认证为**贡献**上界（不是面板 max；换算见 §13）；无法认证 → 禁用本层。
3. `P_inc` 由 `exactProduct(incumbent)` 得到且 `safeDamageFactors(incumbent)` 为真；`O` 由当前搜索范围的其它因子**上界**得到（逐分支更紧的上界合法）；DPS 时 `gcdMin` 为下界。
4. `B_damage = floor(P_inc/O)`（或 DPS 的 `B_dps`）用 BigInt 计算；tie 模型使用 `B_nonstrict = ceil(...)`；模型类型（严格改善 / 保留 tie / 需要身份）显式声明。
5. 因子的正性与档位单调性通过参考模型/`raw-tier-transform` 的前提（当前数据下恒成立；生成数据或基础属性规则变化时重新核验，参考模型 §2.1）。

### 10.2 三类使用方式

- **单点过滤**：候选的精确贡献三元组 `x`（贡献 = 面板 − `sub`/`main`，见 §13）；若 `Phi(x) <= B_damage`（严格模型），则该候选不能严格改善 incumbent，可移出严格改善搜索。tie 模型改用 `Phi(x) < B_nonstrict` 判断「不能同分或更好」。
- **分支过滤（盒）**：分支给每个坐标区间 `[lo_sigma, hi_sigma]`（贡献单位）；由单调性，区域最大副属性乘积为 `Phi_C(hi_C)Phi_H(hi_H)Phi_D(hi_D)`；`<= B` 即整支不可严格改善。
- **半空间过滤**：已认证方向族 `(w_i, K_i)`（`x`、`K_i` 均为贡献坐标）；点 `w_i·x < K_i` 或分支最大 `w_i·hi < K_i`（`w>=0`）即整支不可严格改善。`K_i` 必须是 `K_{w_i}` 的已证明值或**下界**；否则禁用该 support。若工程上必须用面板存储，先按 §13.5 换算，禁止混用。

### 10.3 安全回退（按顺序）

1. 若任一前提失败（`Omega` 不可认证、`O/gcdMin` 非合法乐观界、incumbent 因子非正、tie 语义未声明、**使用 slab 但未按 Theorem 1.5 重算 `D_min_slab`/`K_w^{slab}`**）→ **不做任何删除**，回退到现有 exact upper bound。
2. 若 `G_>(B)` 为空（严格模型）→ 直接返回「无严格改善解」（Theorem 4.1，比半空间更强）。tie 模型必须检查 `G_>=(B)`：`B=P*` 时 `G_>=(P*)` 是 argmax 集合、**非空**，不能判空（非严格域）；只有 `B>P*` 时非严格域才为空。tie 模型使用 `K_w^{>=}`；`B=P*` 时它有限（argmax 上的最小加权和）。
3. 若 frontier/minimal set 无法认证（例如 `Omega` 缺失、`B` 推导有误、`D_min` 表构造失败、slab 上的 `K_w^{slab}` 未按 Theorem 1.5 全枚举）→ 跳过本层，改用单资源 Lagrangian 上界（`factor-resource-budget-upper-bound.ts:88-147`）。
4. 若需要 tie 语义，还必须确认「同分点是否存在」使用 `q := P_inc/O ∈ Phi(Omega)`（Lemma 0.3，同分点可达性）而不是仅 `O|P_inc`；DPS 必须用精确交叉等式/可达 gcd 检查（不得用整除判定 tie）。
5. **最终认证**：任何被保留或删除的候选，最终仍以 `candidateUpperBoundCannotImproveIncumbent`（`exact-mip-candidate-upper-bound.ts:127-140`）的精确 BigInt 比较为准；本层只是它的必要过滤，不能替代它。
6. 禁止经验阈值：`B`、`L`、`kappa`、方向族全部来自当前输入的整数推导；任何「先剪再补」的经验近似都不满足本文前提。

## 11 验证

脚本：[`verify.mjs`](verify.mjs)。运行：

```text
node --experimental-strip-types docs/mathematical-analysis/theorems/strict-improvement-frontier/verify.mjs
```

覆盖范围（全部为**有限域**证书，不构成一般性证明；一般性证明见 §6）：

| 编号 | 覆盖 |
| --- | --- |
| A0 | level=100 WHM 盒 `{140,100,220}` 上三因子逐单位非减、顶角乘积 |
| A1 | 伤害阈值 `B=floor(P_inc/O)` 与 `G(B)` 在 3,147,261 个盒内点逐点等价；3 个候选/19,845 个采样点的安全蕴含；非乐观 `O'` 误删反例；`ceil/floor` 与 tie 点结构 |
| A2 | DPS 阈值（乐观 gcd 下界）在 167,475 个采样点的安全蕴含；非乐观 gcd 下界误删反例 |
| A3 | `D_min` 暴力扫描 vs DET 可达档位表二分：14,241 个 `(C,H)` 点完全一致（11,777 有限 / 2,464 `+∞`），严格性/最小性/上区间性 |
| A3b | `detTrunc>1`（level 50，步长 5）与 BLU（level 80）上的同样逐点一致 |
| A4 | 28,240 个相邻比较的单调不增（扩展序） |
| A5 | 220 个 tier 单元的 D_min 表示、14,241 点还原、水平集上集（staircase）检查 |
| A6 | 6 个方向的 `K_w` 三路一致（暴力 / frontier 公式 / 最小反链）；argmin 与最小元关系（含过强表述反例） |
| A7 | `w` 分量单调、`B` 单调、`K_{lambda w}=lambda K_w` |
| A8 | 6 个方向对全部改善点的半空间安全、`K_w` 紧性、`L=K+1` 误删改善点（显式数值）、`L<=K` 安全 |
| A9 | `B>=P*` 的严格核空、`B=P*` 的非严格核=argmax 非空与 `K_w^{>=}` 有限（非严格域）、`B=max-1`、`B<=0`、`kappa_D=0` 退化维度 |
| A10 | 可整除且商可达的严格 vs 非严格集合差异（2,800 个同分点）；整除但商不可达时两集合相等（同分点可达性） |
| A11 | 比例蕴含、空支撑、冗余充分检查、任意子集删除不触碰改善点 |
| A12 | baseStat 影响审计：六个等级 × 普通/BLU 的贡献 0 档位、`CRT/DHT/TEN` 偏移 = `sub`、`DET` 偏移 = `main`；7 个示例按贡献坐标复算、贡献/面板换算与「误当面板会改变档位」检查 |
| A13 | 安全修复证书：slab 反例（`κ=(1,1,1), L=R=1, B=1` 下 `D_min_slab` 非单调/非单元常值、`K_w^{slab}` 全枚举=0 vs 代表元=1）；非严格域 `B=P*` 用例；同分点商不可达反例与 DPS 整除反例。**全链 BigInt**——`P_inc=gapQ²=16,650,480,250,000,000,000,000,000`（Number 误差 `-395,902,976`、`Number(P+1)===Number(P)`），覆盖 `P−1/P/P+1` 的精确 floor/ceil（`(Q−1,Q)/(Q,Q)/(Q,Q+1)`）与浮点 `ceil` 丢失 `+1` 的对照 |

关键输出（脚本原样摘录）：

- `A1.damage-threshold`: `P_inc=519436866684330000000`，`O_max=145635000`，`B_strict=3566703516904`；盒内 3,147,261 点满足 `prod*O_max>P_inc <=> prod>B_strict`。
- `A3.Dmin-binary`: `B=4134840270108` 在 14,241 个 `(C,H)` 上暴力扫描与二分完全一致。
- `A6.Kw-paths`: 6 个方向三路一致；`w=(1,0,0)` 的 argmin 900 个中仅 3 个是最小元。
- `A8.halfspace-safety`: 显式反例 `K=56`、`L=57` 删除改善点 `(56,100,220)`。
- `A9.empty-degenerate`: `B=max product` 时改善点 0 且 `K_w=+inf`；`kappa_D=0` 时 `D_min∈{0,+inf}`。
- `A10.tie-semantics`: 严格 frontier 比非严格区域少 2,800 个同分点。
- `A11.supports`: `w2=(2,2,2)` 蕴含 `w1=(1,1,1)`；任意子集不删改善点。
- `A12.baseStat-audit`: 贡献 0 的档位 = 面板为 baseStats 时的档位；7 个示例（原点、A8 顶角、tie 点、frontier 点、`P*` 顶角等）按贡献复算通过；`w=(1,0,0)` 的 K=56 是贡献 C（面板等价 476）。
- `A13.safety-fixes`: slab（`D_min_slab(0,0)=1,(1,0)=0,(1,1)=+∞`；`w=(0,1,1)` 全枚举 `K=0` vs tier 代表元 `=1`）；非严格域（`B=P*`：`G_>` 空、`G_>=` 非空、`K_w=+∞`、`K_w^{>=}` 有限）；同分点可达性（`O|P_inc` 但 `q=1∉Phi(Ω)` 时 `G_>`=`G_>=`、无同分点；DPS 整除反例同理）。**F5 BigInt 证书**：`P_inc=Q²=16,650,480,250,000,000,000,000,000`（`Q=4,080,500,000,000`），Number 误差 `-395,902,976`、`Number(P+1)===Number(P)`；精确 `(floor,ceil)` 对 `P−1/P/P+1` 为 `(Q−1,Q)/(Q,Q)/(Q,Q+1)`，BigInt `ceil(P+1)=Q+1` 而浮点 `ceil` 仍为 `Q`；`gapQ±1/0` 不可达且两集合相等；DPS 乐观商=`1n` 无 tie。

另有独立核对脚本 `docs/mathematical-analysis/verification/verify-theorem-claims.mjs`（共享）覆盖边际比较旧形式反例等；与本文的 `A1`/tie 结构互为旁证。

## 12 未解决问题

1. **frontier 的解析结构。** 本文证明 `D_min` 可用 `|A_C||A_H|` 个单元精确表示，但未给出单元值 `D_min(j,l)` 关于 `(j,l,B)` 的闭式公式；staircase 断点位置与 DET 阈值序列的定量关系（跳档成本 13/14、19/20 等锯齿如何决定断点）尚未证明。
2. **最小反链枚举复杂度。** `K_w` 的 `O(|A_C||A_H| log|V|)` 计算不依赖完整三维体积，但若要显式列出最小反链（用于同时回答多个方向族），其最坏规模/枚举算法未分析。
3. **支撑族选择的最优性。** Theorem 5 只证明正确性与冗余判据；「哪些 `w` 在当前域上删除体积最大」「多少条 support 最优」没有理论结果，只能作为运行时 policy（且本文不声明收益）。
4. **DPS 的更紧阈值。** 本文用全局 `gcdMin` 把 `gcd` 折进阈值；候选的 gcd 有平台结构，能否在 frontier 层用更细的分段 gcd 上界收紧 `B_dps` 尚未研究。
5. **四维扩展。** 若把 TEN/SKS/main stat 也作为松弛变量，`G` 不再只是三维上集；`D_min`/`K_w` 的对应推广（4 维 staircase）是否仍有 `O(|A|^3)` 表示未证明。
6. **与真实可行域的结合。** `Omega` 取盒式或 simplex 外接盒都合法；如何取「最紧且可认证」的 `Omega`（例如用现有 Lagrangian support 的反向界）未给出最优构造。
7. **空改善区域的高效判定。** Theorem 4.1 给出 `B >= P*`（严格）与 `B > P*`（非严格）的判定；`P*` 是顶角乘积，代价低，但 `Omega` 非盒式（如 simplex）时 `max` 的精确计算见 [free-budget-upper-bound](../free-budget-upper-bound/README.md)，本文未展开。
8. **slab 上的紧凑 frontier。** 本文给出 `Omega_slab` 上的逐点公式与 `(C,H)` 全枚举（Theorem 1.5），未证明引入 `C+H = L−D`、`C+H = R−D` 等反对角线后的最简 breakpoint 表示；`D_min_slab` 的单调性/单元结构已确认不成立（§7.6）。
9. **DPS 的精确 tie 集合。** Lemma 0.3 的 DPS tie 条件需要可达 `(other,gcd)` 的交叉等式；如何在候选池上高效枚举该集合/证明其空性未研究（本文只给出可检查表述与整除反例）。
10. **数值实现边界。** 生产 `Number` 安全整数/BigInt 的切换边界、`1e-7` 容差在运行时阈值反查中的复核，需要实现侧另写验收（本文只登记前提）。

## 13. baseStat 影响审计（贡献坐标 vs 面板总值）

本节是第二轮坐标审计：逐条核对本文的松弛域、baseline、`B` 的推导、`D_min`、`K_w`、半空间以及全部数值示例是**贡献**还是**面板总值**。**审计结论：未发现面板/贡献混用**；本文原本就使用贡献坐标，本节把坐标声明、归约链、逐命题判定、数值复核与运行契约显式登记，并修正了两处容易被误读的表述（§3.1 的 `g=0` 与 §4 的 (A1)/(A2)）。

### 13.1 坐标声明与换算

本文全部记号 —— `Omega` 的 `C,H,D`、`kappa_sigma`、`D_min`、`w·x`、`K_w`、`L`、`B` 推导中的 `Phi_sigma` 输入，以及 §7 的全部数值 —— 都是**贡献** `g`，不是面板总值：

```text
面板 CRT/DHT/TEN = baseStats(sub)  + 贡献
面板 DET         = baseStats(main) + 贡献
```

由参考模型 §2.1（基础属性归约；`equipped-effects.ts:127`、`getBaseStats` `:178-203`）：

| 属性 | 基础属性 | 贡献 = 面板 − 基础属性 |
| --- | --- | --- |
| CRT | `sub` | `C = 面板CRT − sub` |
| DHT | `sub` | `H = 面板DHT − sub` |
| DET | `main` | `D = 面板DET − main` |
| TEN | `sub` | 本文只作乐观界；贡献坐标同理 |

本文数值示例使用 level=100 WHM：`sub = 420`、`main = 440`（等级参数见参考模型 §2）。本文的松弛域直接写成贡献盒 `Omega = [0,kappa_C]×[0,kappa_H]×[0,kappa_D]`（未单独引入 baseline 变量）；若实现内部有 baseline `b=(C0,H0,D0)`，它同样是**贡献**基线，`kappa_sigma` 是基线之上（或直接）的**贡献**上界，`x = b + 分配量` 仍落在贡献坐标中。审计时只需确认 `b` 与 `kappa` 的输入不是面板值。

### 13.2 归约链（为什么档位/因子只吃贡献）

1. `equippedAttributeTier` 先算 `value = baseStats[stat] + gearAndFoodValue`，再减偏移 `sub`（CRT/DHT/TEN）或 `main`（DET）后进入 floor（`equipped-effects.ts:127-149`）。
2. 由 `getBaseStats` 的当前数据：`baseStats.CRT = baseStats.DHT = baseStats.TEN = sub`、`baseStats.DET = main`，故 `value − 偏移 = gearAndFoodValue = g`；档位 `t_sigma(g)` 只依赖贡献（参考模型 §2.1）。这一步不是定义，而是由当前生成数据推出的性质；数据变化时必须重新核验。
3. 正式候选路径贡献逐项非负（参考模型 §2.2），故 `g >= 0`；四个分支的 floor 实参恒 `>= 0`（CRT≥50、DHT≥0、DET≥200、TEN≥1000），`Math.trunc(v+1e-7)=floor(v)` 在可达域无条件成立（参考模型 §2.2；[raw-tier-transform](../raw-tier-transform/README.md)）。
4. 因此 `F_C/F_H/F_D` 以及 `Phi_sigma(g) = F_sigma(t_sigma(g))` 的自变量必须是贡献；把面板值直接喂给 `t_sigma` 会把基础属性重复计入，得到错误档位。
5. `B` 推导中的其它因子（`mainStat`、`tenacity` 因子）同样是各自贡献坐标上的 `t_sigma` 输出，其 baseStat 偏移也在各自档位函数内部消去；`weaponDamage` 等非档位因子本来就不含 baseStat 偏移。因此 `B` 的数值与**任何属性**的 `sub/main` 偏移无关（见 §13.4 要点 4）。

### 13.3 逐命题判定表

| 命题 | 使用的坐标 | 是否受 baseStat/偏移影响 | 判定 |
| --- | --- | --- | --- |
| Def §3.2/§3.4（`Omega`、`kappa_sigma`；baseline） | 贡献上界/贡献基线 | 否：只要求输入是贡献；面板 max 需换算 | 契约补充（§13.5） |
| Lemma 0.1（`B_damage`） | `x∈Omega` 为贡献；`P_inc`、`O` 为因子乘积 | 否：`B=floor(P_inc/O)` 只用整数因子乘积；偏移在 `t_sigma` 内部已消去 | 无需改动（输入须贡献） |
| Lemma 0.2（`B_dps`） | 同上；`gcdMin` 为速度坐标 | 否：`gcdMin` 与 CRT/DHT/DET 偏移无关，且只以乐观下界进入整数除法 | 无需改动 |
| Lemma 0.3 / Corollary 0.4 | 同 Lemma 0.1；tie 结构额外使用像集 `Phi(Omega)` | 否（只依赖整数乘积/像集与乐观界方向） | 已按同分点可达性修正：同分点条件 `q:=P_inc/O ∈ Phi(Omega)`（§5.1） |
| Theorem 1（`D_min`） | `C,H,D` 贡献 | 否：单调性与二分只要求输入是贡献；面板偏移不进入 `t_sigma` 的贡献参数 | 无需改动；声明已明确 |
| Theorem 2（`K_w`） | `w·(C,H,D)` 贡献 | 数值依赖坐标选择：面板坐标下需做平移（§13.5） | 无需改动；补运行契约 |
| Theorem 3（半空间） | `w·x >= L`，`L` 为贡献 | 面板坐标等价式为 `w·panel >= L + Σ_i w_i·offset_i` | 无需改动；禁止混用 |
| Theorem 4（空区域/退化） | `P* = max_{Omega}` 贡献 | 否：`P*` 是贡献盒上的乘积最大值 | 无需改动 |
| Theorem 5（支撑族） | 方向与阈值贡献 | 否：冗余/蕴含在贡献坐标下证明 | 无需改动 |
| §10 应用规则 | κ、点/分支、`L` 全为贡献 | 运行时转换在 §13.5 | 补契约 |

### 13.4 数值复核（全部按贡献复算；面板等价仅作说明）

level=100 WHM，`sub=420`、`main=440`；下表乘积为 `Phi_C(C)Phi_H(H)Phi_D(D)`（`verify.mjs` 的 `A12.baseStat-audit` 用 canonical 档位按贡献重算并断言相等）：

| 示例 | 贡献 `(C,H,D)` | 面板 `(CRT,DHT,DET)` | 复算乘积 | 文档引用 |
| --- | --- | --- | --- | --- |
| 原点 | `(0,0,0)` | `(420,420,440)` | 4,080,000,000,000 | §7.1、§11 A1 |
| A8 显式反例顶角 | `(56,100,220)` | `(476,520,660)` | 4,151,851,967,544（`B=…543`） | §7.2、§11 A8 |
| tie 构造 | `(70,45,90)` | `(490,465,530)` | 4,113,667,312,800 | §7.3、§11 A10 |
| frontier B 点 | `(100,70,150)` | `(520,490,590)` | 4,134,840,270,109（`B=…108`） | §5.2、§11 A3/A6 |
| `P*` 顶角 | `(140,100,220)` | `(560,520,660)` | 4,163,163,941,400 | §7.5、§11 A9 |
| `w=(1,0,0)` 的 K=56 点 | `C=56`（`H=100,D=220`） | `CRT=476` | — | §7.2、§11 A8 |
| `w=(1,0,0)` 的 L=57 | 贡献 `C=57` | `CRT=477` | — | §7.2 |

要点：

1. 这些数字若被解释为面板值，则贡献 = 面板 − `(sub,sub,main)` 会出现负分量（例如 `(56,100,220)` 的贡献为 `(-364,-320,-220)`），超出正式候选的 `g >= 0` 定义域；故它们只能是贡献。
2. `w=(1,0,0)` 的 `K_w=0`（§7.4 的 900 个 argmin）也是**贡献** C；面板等价阈值是 `0 + 420 = 420`，不是 0。argmin 的**计数**在面板坐标下不变（平移是双射），但坐标标注必须按贡献理解。
3. `K=56 / L=57` 是贡献 C；面板等价为 `476 / 477`。
4. `B`、`O`、`gcdMin` 的数值与 baseStat 无关（只经因子乘积与乐观最大值），所以本节的换算只影响「坐标标签」与半空间阈值，不影响 `B` 的推导。

### 13.5 应用契约（防止坐标混用）

1. `kappa_C,kappa_H,kappa_D` 必须是**贡献**上界（由候选池/同步/魔石/食物的贡献汇总得到），不是面板 max。
2. 候选的 `x=(C,H,D)` 必须是贡献汇总（装备+镶嵌+食物的属性贡献，逐项非负）；若内部数据是面板值，先按 §13.1 减 `sub`/`main` 再进入本层。
3. `B`、`O`、`gcdMin`、`P_inc` 只涉及因子乘积与其它乘区乐观最大值，**与 baseStat 偏移无关**；但 `Phi_sigma` 的自变量必须是贡献。
4. 半空间 `w·x >= L` 的 `x`、`L` 同为贡献。若展示或其它层必须用面板坐标，等价不等式为

```text
w·panel >= L + (w_C*offset_C + w_H*offset_H + w_D*offset_D)，offset_CRT=offset_DHT=sub，offset_DET=main
```

`offset` 随 `(level, job)` 变化（BLU 的偏移只进档位常数，不改 `sub/main`），必须在同一 `(level, job)` 上换算，禁止跨等级/跨 BLU 混用。
5. DPS 的 `gcdMin` 属于 SKS/SPS 速度坐标，不含 CRT/DHT/DET 偏移；与本层无耦合，但同样不要与面板速度混用。
6. 无法确认输入是贡献时：禁用本层，回退到 exact upper bound（§10.3）。
7. **tie 语义的坐标无关性（同分点可达性）**：同分点存在性用 `q := P_inc/O ∈ Phi(Omega)` 判定（不是整除）；`B=P*` 时非严格域=argmax 非空，tie 模型必须保留（非严格域）；DPS 的 tie 必须按实际可达 `(other,gcd)` 的精确交叉等式核对，不能用整除乐观商。
8. **slab（slab 非上集）**：`Omega_slab` 上 `D_min_slab`/`K_w^{slab}` 必须按 Theorem 1.5 的逐点公式与 `(C,H)` 全枚举计算（贡献坐标）；不得沿用盒域 tier 代表元/最小反链枚举，也不得把 slab 用作 `U` 的约束。

### 13.6 结论

- **未受影响**：本文的松弛域、`B` 推导、`D_min`、`K_w`、半空间与全部数值示例本来就是贡献坐标，审计没有发现面板/贡献混用；因此定理陈述与证明不需要改变。
- **修正与澄清**：§3.1 的「`g=0` 对应基础属性 baseStats」改为「贡献 0 时面板 = baseStats」；§4 (A1)/(A2) 改为引用参考模型 §2.1/§2.2 的结构性非负结论；新增本节与 `verify.mjs` 的 `A12.baseStat-audit`（PASS）。数值没有因审计改变：所有引用数值都是贡献坐标下的 canonical 值，复算一致。
- **后续数据变化**：若 `baseStats`/`clanStats`/`statModifiers` 变化（参考模型 §2.1），必须重新核验偏移表与本节的换算；`A12` 会在偏移不再等于 `sub/main` 时失败。
