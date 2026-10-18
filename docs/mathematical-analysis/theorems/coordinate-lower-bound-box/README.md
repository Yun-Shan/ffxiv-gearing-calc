# 三属性因子乘积的逐坐标下界 box、乘积下界与精炼迭代

## 1. 标题与状态

- **目录**：`docs/mathematical-analysis/theorems/coordinate-lower-bound-box/`
- **对象**：`Phi(C,H,D) = F_C(C) · F_H(H) · F_D(D)`（贡献坐标）。希望得到逐属性下界 `l_C,l_H,l_D`，使 (1) 任何使 `Phi` 最大的可行点 `x*` 都满足 `x*_i >= l_i`（于是把某属性降到 `l_i` 以下——即使同时提高另一个属性——也不可能得到因子最大解），(2) `Phi(l_C,l_H,l_D)` 是最大乘积的下界。
- **验证**：[verify.mjs](verify.mjs)，`node --experimental-strip-types` 运行 **PASS**（`checks: 395`；盒域 `κ=(100,100,100)` 全枚举 1,030,301 点 + 并集域 + 两个 slab 子域 + 小域超集屏障正/反例）。

### 1.1 状态总表（精确 / 上界 / 条件成立 / 未解决）

| 定理 | 内容 | 状态 |
| --- | --- | --- |
| 定理 1 | 逐坐标下界 `l_i(B)` 的存在性、屏障性质、`Phi(l) <= OPT`、严格/非严格语义；`B` 非下界时失效 | **已证明（条件：`B <= OPT` 是经证明的下界）**；失效反例已给 |
| **定理 1′** | **小域上的超集屏障**：`D ⊆ Omega`、`B` 是 **`D` 上的**下界（`B <= OPT_D`）⇒ `l^Omega(B)` 的坐标屏障/乘积下界/`T_Omega` 对 `OPT_D` **有效**；`l^Omega` 不是可达点（非 incumbent/achievable），但 `Phi(l^Omega(B))` 是 `OPT_D` 的**合法非构造下界**；若只有 `B <= OPT_Omega` 而 `B > OPT_D` 则全部失效 | **已证明（条件：`B <= OPT_D`）**；跨域失效反例已给（§7.9） |
| 定理 2 | 盒域的 maximizer 刻画 `{x : x_i >= c_i^opt}`、`l(OPT)=c^opt`、方法能达到的最强坐标屏障 | **已证明（盒域）** |
| 定理 3 | 便宜的一元式 `l_i^cap(B)`：盒域上**精确等于** `l_i`；一般子域上 `<=`（安全但更弱），可严格 | **已证明**（盒域精确；子域为条件成立的上界形式） |
| 定理 4 | 精炼算子 `T(B)=max(B,Phi(l(B)))`：安全、单调、**幂等** `T∘T=T`（故迭代至多一次严格改进）、有限稳定、不动点条件、`T=OPT ⇔ B>M` 的精确阈值；改进/停滞/严格-非严格混用/非法 B 反例；对 `D⊆Omega` 当 `B<=OPT_D` 时 `T_Omega(B)` 仍是 `OPT_D` 的合法下界（定理 1′） | **已证明 + 精确反例** |
| 定理 5 | 与 [strict-improvement-frontier](../strict-improvement-frontier/README.md) 的关系：`l_i(B)=K_{e_i}^{>=}(B)`（严格版 `K_{e_i}`）；box 剪枝 = 3 个轴方向支撑；价值判断 | **已证明（等价性）**；价值判断是分析性结论，**不声称性能收益** |
| 定理 6 | 与 [pairwise-slice-critical-set](../pairwise-slice-critical-set/README.md) / [pairwise-endpoint-max](../pairwise-endpoint-max/README.md) 的关系：不同命题；在非盒域上可组合（用切片最大值算 `l_i`）；slab 严格分离例 | **已证明/关系说明** |
| 定理 7 | 扩展到完整伤害因子（`WD/mainStat/TEN/GCD`）：下界与改善必要条件的公式、方向、适用条件 | **已证明（条件成立：其它因子有独立已证上/下界）** |
| 定理 8 | 价值判定：box 不超出 3 个支撑；`Phi(l)` 作为 **`OPT_D` 的合法非构造下界**（在 `B<=OPT_D` 时）可用于 `UB_branch < LB` 剪枝/存在性推理，但**不是 incumbent/achievable value**；`T` 至多一次改进且 `B<=M` 时封顶为 `M << OPT`；「更大可能出现足够高下界吗」的机制回答 | **已证明（分析性；不作搜索/性能收益声明）** |

**一句话结论**：`l_i(B)` 与乘积下界都成立，并且是**用户直觉的正确实现**：`l_i` 由「全 3D 改善集」的坐标投影定义，而不是固定切片；盒域上可闭式一元计算。但作为**剪枝**它恰是 3 个轴方向支撑（不超出 frontier 支撑族），新增价值在**显式坐标屏障证书**、**`Phi(l)` 乘积下界**与**无需真实 incumbent 的精炼迭代**；迭代可证明**至多一次严格改进**，且当初始 `B<=M` 时封顶在 `M`（远低于 `OPT`），通常停滞。注意 `l^Omega(B)` 不是可达配装（非 incumbent/achievable），但当 `B` 是小域 `D⊆Omega` 上的下界（`B<=OPT_D`）时，`Phi(l^Omega(B))` 是 `OPT_D` 的合法非构造下界（定理 1′）。

## 2. 范围与依据

### 2.1 用户对象（准确复述）

用户要的对象是：

```text
Phi(C,H,D) = F_C(C) · F_H(H) · F_D(D)，(C,H,D) 为贡献坐标（非面板总值）。
希望得到逐属性下界 l_C,l_H,l_D，使得：
  (1) 任何使 Phi 最大的可行点 x* 都满足 x*_i >= l_i；
      因此「把某个属性降到 l_i 以下、即使同时提高另一个属性」也不可能是因子最大的解；
  (2) Phi(l_C,l_H,l_D) 是最大乘积的一个下界。
用户进一步问：这是否就是「固定一个属性、对另外两个属性求下界」的推广？若可推广到三属性，价值如何？
```

本文先给出**正确的形式化**（`l_i` 必须由**全 3D 改善集**的坐标投影定义，见 §3），再逐条证明/否证/评估上述期望。**先厘清的关键点**：`Phi` 对每个坐标单调非减，所以「降低一个属性、同时提高另一个」不会发生在同一个点上——被比较的另一个点本身必须仍在「可能最优/可改善集合」里；因此 `l_i` 的定义域必须是整个改善集合，固定一个切片的分析不足以给出它（固定切片是 pairwise 对象，见 §5.6）。

### 2.2 对用户问题的直接回答

- **「是否就是固定一个属性、对另外两个属性求下界的推广？」** 不是同一个命题。固定一个属性、对另外两个的分析是**固定第三坐标的 2D 切片**（pairwise）：在切片上研究两属性定和/定界时的最大值、端点与临界点。本文的 `l_i` 是**全 3D 改善集在坐标轴上的投影极小元**（对另外两个坐标的所有取值取 min），三个坐标的下界是**同时**成立的 box，不是逐对的 2D 条件。二者可以组合（§5 定理 6：非盒域上 `l_i` 的内层就是固定 `x_i` 的 2D 最大值），但不是同一对象。
- **「能否推广到三属性？」** 能：定理 1/2/3 给出三个坐标下界的**同时**定义、屏障性质、乘积下界与盒域闭式；定理 4 给出可迭代的精炼算子（并证明幂等/阈值），定理 6/7 给出与切片、完整伤害因子的组合方式。
- **「价值如何？」** 见定理 5/8：作为**剪枝**，它恰是 3 个轴方向支撑，**不超出** [strict-improvement-frontier](../strict-improvement-frontier/README.md) 的支撑族（没有额外剪枝强度）；其新增价值是**显式坐标屏障证书**、**`Phi(l)` 乘积下界**、以及**无需真实 incumbent 的精炼迭代**（`T` 至多一次严格改进，`B<=M` 时封顶在 `M<<OPT`，常停滞）。注意区分两件事：`l^Omega (B)` 一般**不是可达配装**（不能当 incumbent/achievable value），但若 `B` 还是某个小域 `D⊆Omega` 上的下界（`B<=OPT_D`），则 `Phi(l^Omega (B)) <= OPT_D` 是 **`OPT_D` 的合法（非构造性）下界**（定理 1′），可用于 `UB_branch < LB` 剪枝与「LB 高于所有已知 witness ⇒ 存在更好可行解」的推理；**不声称**搜索/性能收益。

### 2.3 依据

1. [canonical-evaluator-reference.md](../../canonical-evaluator-reference.md) §2.1（面板↔贡献换算）、§2.2（可达域贡献非负/档位实参非负）、§3（整数档位）、§4（因子公式）。
2. [领域与搜索规则](../../../rules/领域与搜索规则.md)：公式精确性（第 10 行）、完整性/最优性（第 44–49 行）。
3. 姊妹定理：
   - [strict-improvement-frontier](../strict-improvement-frontier/README.md)：`G_>(B)`、`G_>=(B)`、`K_w(B)`、支撑半空间与 tie 语义（本文 `l_i` 即 `w=e_i` 的特例）；
   - [pairwise-slice-critical-set](../pairwise-slice-critical-set/README.md)、[pairwise-endpoint-max](../pairwise-endpoint-max/README.md)：固定第三坐标的 2D 切片最大/临界集（本文 §5.6 的关系）；
   - [free-budget-upper-bound](../free-budget-upper-bound/README.md)：`U(b,R,κ)` 与 P3；[substat-sum-upper-bound](../substat-sum-upper-bound/README.md)：slab 域来源。
4. 源码：`src/domain/search/equipped-effects.ts:110-154`（档位）、`:59-104`（因子，`determination/critical/directHit` 在 `:95-99`）、`:163-166`（`floor=Math.trunc(v+1e-7)`）；`src/domain/search/exact-mip-candidate-upper-bound.ts:96-140`（精确比较语义）。
5. 验证工具：`docs/mathematical-analysis/verification/canonical-model.mjs`（只读模型；`tier/criticalFactor/...`）。

**不涉及**：真实候选池枚举、搜索、MIP、benchmark、生产集成；本文的数是公式值，`l_i` 的可达性只在松弛域 `Omega` 内讨论。

## 3. 符号、量词与定义域

### 3.1 贡献坐标与因子

固定等级 `level`、职业 `job`（公式层只区分普通/BLU）。对 `sigma ∈ {C,H,D}`（依次 CRT/DHT/DET）与贡献 `g ∈ Z_{>=0}`：

```text
t_sigma(g) = c_sigma + mult_sigma * floor((a_sigma g + b_sigma)/q_sigma)
F_C(t) = 1_000_000 + t(t + b_C)    b_C = 350（普通）/150（BLU）
F_H(t) = 4_000 + t
F_D(t) = t
Phi_sigma(g) := F_sigma(t_sigma(g))          （正整数、关于 g 非减；跨档严格增）
Phi(C,H,D)   := Phi_C(C) · Phi_H(H) · Phi_D(D)
```

**坐标声明**：本文所有 `C,H,D,g,l_i`、`B`、`Phi` 都是**档位输入贡献**，不是面板总值。面板总值 `P_i = baseStats[stat] + 贡献`，`baseStats.CRT = baseStats.DHT = sub`、`baseStats.DET = main`（参考文档 §2.1）；完整审计见 §13。若上下文带 baseline `b=(b_C,b_H,b_D)`（已提交贡献），可把 `x` 平移：`Phi_b(x) := Phi(b+x)`，全部定理对平移不变（把 `Omega` 平移到 `[b, κ]` 即可）；本文取 `b=0` 记法。

### 3.2 盒域、一般有限域与 OPT

```text
Omega = { x=(C,H,D) ∈ Z^3 : 0 <= x_i <= kappa_i }     （盒域；kappa_i 为已证明的贡献上界）
OPT   = max_{x∈Omega} Phi(x) = Phi(kappa)              （因 Phi 对每个坐标单调非减，顶角取到）
D     ⊆ Omega 为任意非空有限域（如 slab、真实可达点集；定理 1 在一般 D 上成立）
OPT_D = max_{x∈D} Phi(x)
```

**"已知下界" `B`**：整数，且 `B <= OPT`（对一般域为 `B <= OPT_D`）。`B` 的来源必须是**下界**：某个可行点/记录点的 `Phi` 值（例如 incumbent 的副属性乘积）、或其它已证明的下界、或上一轮精炼得到的 `B`。**不能**用上界/松弛值（如 `U` 的值、某个上界族）充当 `B`；失效反例见 §7。

### 3.3 改善集合、坐标下界、严格/非严格

```text
I_>=(B) = { x ∈ D (或 Omega) : Phi(x) >= B }
I_>(B)  = { x ∈ D (或 Omega) : Phi(x) >  B }
l_i^>=(B) = min { x_i : x ∈ I_>=(B) }        （空集时取 +infinity）
l_i^>(B)  = min { x_i : x ∈ I_>(B) }         （空集时取 +infinity）
```

**严格/非严格语义**：

- **保留 tie**（搜索需要同分/比较 `>=`）：目标是不删除任何 `Phi >= B` 的点，用 `I_>=(B)`；允许 `B = OPT`。
- **只找严格改进**（`>`）：目标是不删除任何 `Phi > B` 的点，用 `I_>(B)`；必须 `B < OPT`，否则集合为空、该层失效（混用见 §7）。
- 两者的屏障结论分别成立（§5 定理 1），但**不能把严格核用于 `B=OPT` 后仍主张屏障**（会得到 `+infinity`）。

**结构澄清（关键）**：`I` 是 3D 上集（`x∈I`、`y>=x` ⇒ `y∈I`），`l_i` 是它在坐标轴上的**投影极小元**；`{x : x_i >= l_i ∀i}` 是一个 box，是 `I` 的**坐标投影松弛**（box ⊇ I）。它与「固定一个属性、对另外两个求下界」的 **2D 切片**对象不同（见 §5.6）：后者固定第三坐标后研究两属性定和/定界切片的最大值；前者对**所有**另外两个坐标取 min。用户所说的「把某属性降到 `l_i` 以下、即使提高另一个也不可能是最优」正是 box 屏障：由于 `Phi` 单调，被比较的点 `x` 只要 `x_i < l_i`，它**自己**的 `Phi(x) < B <= OPT`，与其它坐标取多大无关。

### 3.4 maximizer、最优档位阈值

```text
c_i^opt := min { g ∈ [0, kappa_i] : Phi_i(g) = Phi_i(kappa_i) }    （达到最大因子的最小贡献）
```

盒域上 `c^opt = (c_C^opt,c_H^opt,c_D^opt)`；若某属性 `kappa_i=0`，则 `c_i^opt=0`。

### 3.5 完整伤害因子（§5 定理 7 用）

```text
Psi_damage(x,q) = Phi(x) · q ，   q := weaponDamage·mainStat·tenacity > 0
Psi_dps(x,q,g)  = Phi(x) · q / g ，g := gcdCentiseconds > 0
q ∈ [q_lo,q_hi]、g ∈ [g_lo,g_hi]：已证明的其它乘区上下界（独立于 x）。
B_full：完整目标的严格阈值（例如由 incumbent 完整乘积 + 1，或 tie 语义下的 incumbent 值）。
```

### 3.6 量词约定

`∀x∈Omega` 指所有格点；`x<=y` 指逐坐标；`+infinity` 只用于空集/失效标记，不参与普通算术；所有比较用整数/BigInt 精确值（浮点只用于打印）。

## 4. 假设

- **(A1) 单调正因子**：`Phi_C,Phi_H,Phi_D` 在 `[0,κ]` 上为正整数、关于各自贡献非减（参考文档 §5；严格证明见 [raw-tier-transform](../raw-tier-transform/README.md)）。这是全部定理的唯一结构前提（不依赖具体二次/线性形状）。
- **(A2) `B` 是所用域上的经证明下界**：全盒域分析要求 `B <= OPT`；小域 `D⊆Omega` 分析（定理 1′）要求 **`B <= OPT_D`**。**只知 `B <= OPT_Omega` 不能替代 `B <= OPT_D`**（§7.9 反例：`B` 取自更大域时屏障/乘积下界/迭代全部失效）。来源须是可达点/已证下界；若 `B` 来自上界、其它域、或未经验证的估计，则定理不成立。
- **(A3) 域包含性**：`D`（或 `Omega`）包含所有被考虑的点；`κ_i` 是已证明的贡献上界。若 `κ` 漏掉真实可取点，结论可能失效（同 (A2) 的域外反例）。
- **(A4) 精确整数**：`Phi`、`B`、`l`、比较全部为整数；`c_i^opt`、一元式阈值用档位/二分精确求（生产 `equippedAttributeTier` 是正向函数，阈值反解需要新增实现或离线表，见 §9）。
- **(A5) 严格/非严格一致**：`I` 的选取与搜索目标（保留 tie / 只找严格改进）一致；禁止混用（§7）。
- **(A6) 扩展因子的界**：§3.5 的 `q_lo,q_hi,g_lo,g_hi,q_lower` 等必须是已证明的界；坐标 box 只作用于三属性，其它因子需要独立界。
- **(A7) 无 magic 常数**：不引入经验系数/等级职业特例；所有分支由 `B`、`κ`、档位参数决定。
- **(A8) `l` 不必可行**：`l` 可能不在真实可达域（甚至不在某些子域 `D` 内）；它是**坐标屏障/乘积下界**，不是可行配装见证。

## 5. 精确命题

### 定理 1（坐标屏障与乘积下界；一般有限域 D / 盒域 Omega）

设 `D ⊆ Z_{>=0}^3` 非空有限（盒域是特例），`B <= OPT_D` 为整数下界。

1. **（非空与屏障）** `I_>=(B) != ∅`；对每个 maximizer `x* ∈ argmax_D Phi`：`x*_i >= l_i^>=(B)`（`i=C,H,D`）。若 `B < OPT_D`，则 `I_>(B) != ∅`，且同样的结论对 `l_i^>(B)` 成立。
2. **（"降低一个、提高另一个"也救不回来）** 对任意 `x ∈ D`，若某 `i` 满足 `x_i < l_i^>=(B)`，则 `Phi(x) < B <= OPT_D`，故 `x` **不是** maximizer；严格版：若 `x_i < l_i^>(B)`，则 `Phi(x) <= B < OPT_D`（`B<OPT_D`），故 `x` 也不是 maximizer。这里不要求 `x` 的其它坐标小；其它坐标取多大都不影响 `Phi(x) < B` 这一事实。
3. **（乘积下界）** `Phi(l^>=(B)) = Π_i F_i(l_i^>=(B)) <= OPT_D`。证明只用坐标单调与非负：每个 maximizer `x*` 满足 `x*_i >= l_i`，故 `Phi(l) <= Phi(x*) = OPT_D`。
4. **（盒域特化）** 对 `D = Omega`：`l_i^>=(B) = min{ c ∈ [0,κ_i] : F_i(c)·Π_{j≠i}F_j(κ_j) >= B }`（令 `O_i := Π_{j≠i}F_j(κ_j)`）；`l_i^>` 同式把 `>=` 换成 `>`。`l ∈ Omega`，故 `Phi(l)` 在盒域内**可构造**（点 `l` 本身）。
5. **（`l` 不必可行）** 对一般 `D`，`l` 的三个坐标可能来自不同的点，`l ∉ D`；例如并集域 `D3={(100,0,0),(0,100,0),(0,0,100)}`、`B=1` 时 `l=(0,0,0) ∉ D3`，而 `Phi(l) <= OPT_D3` 仍成立（verify.mjs `T5`）。乘积下界不要求 `l` 可行。
6. **（`B` 非法时失效）** 若 `B > OPT`，则 `I_>=(B) = I_>(B) = ∅`，`l = (+inf,+inf,+inf)`；若实现把空集/上界误当 `B`（或把 `l` 截断到 `κ`），屏障结论会**排除真实 maximizer**。精确反例见 §7.1。
7. **（域不匹配时失效）** 若 `B` 来自更大的域（`B <= OPT_{Ω'}` 但 `B > OPT_Ω`，`Ω⊂Ω'`），在 `Ω` 上同样得到空集；若用 `Ω'` 的 `l` 套到 `Ω` 上，最优点的坐标可能小于 `l_i`（同 §7.1）。

### 定理 1′（小域上的超集屏障；`D ⊆ Omega`）

设 `D ⊆ Omega`（例如 `D = Reach` 真实可达集、slab 子域或并集子域），`B` 是整数且 **`B <= OPT_D`**（即 `B` 是 **`D` 上的**已证下界，例如真实 incumbent 的精确目标值）。记 `l^Omega(B) := l^>=(B)` 为 **`Omega` 上**按定理 1 定义的坐标下界（盒域一元式，定理 3）。则：

1. **（真实域最优解的坐标屏障）** 对每个 `x* ∈ argmax_D Phi`：`x* ∈ D ⊆ Omega` 且 `Phi(x*) = OPT_D >= B` ⇒ `x* ∈ I_Omega(B)` ⇒ `x*_i >= l_i^Omega(B)`（`i=C,H,D`）。**即使 `l^Omega` 的坐标组合不是 `D` 内可达点，屏障仍对真实域最优解成立。**
2. **（乘积下界对真实域有效）** `Phi(l^Omega(B)) <= OPT_D`。注意 `l^Omega` 一般不是 `D` 内可达点，故这不是“找到更好的可行解”；它只是 `OPT_D` 的一个**合法（非构造性）下界**。
3. **（精炼迭代对真实域 sound）** `T_Omega(B) := max(B, Phi(l^Omega(B)))` 满足 `B <= T_Omega(B) <= OPT_D`。
4. **（用途区分：合法下界 ≠ incumbent/achievable）** `l^Omega` 不是真实可达配装 ⇒ `Phi(l^Omega(B))` **不能**当 incumbent/achievable value（不能作为“已找到解”提交、也不能当真实搜索中的 LB 替代 incumbent）。但作为 `OPT_D` 的下界它合法，可用于：
   - **分支剪枝**：若某分支的已证上界 `UB_branch < Phi(l^Omega(B))`，则该分支内任一点的 `Phi <= UB_branch < Phi(l^Omega(B)) <= OPT_D`，故该分支不可能包含 `D` 的任何最优解，可安全删除（此推理在保留 tie 的语义下也成立，因为分支内点严格低于 `OPT_D`，连 tie 都没有）；
   - **存在性推理**：若 `Phi(l^Omega(B))` 高于所有已知可行 witness 的值，则因 `OPT_D >= Phi(l^Omega(B))` 且 `OPT_D` 被 `D` 中某点达到，**存在**一个优于所有已知 witness 的可行解（无需显式构造它）；
   - **严格改善阈值**：若搜索目标是严格优于 incumbent 值 `B_inc`，可用 `B = B_inc`（当 `B_inc <= OPT_D`）走非严格核做“`Phi >= B_inc` 的点不排除、`Phi < B_inc` 的点排除”；若只找严格改进，用严格核 `l^Omega,>` 并要求 `B < OPT_D`（`D` 的 maximizer 满足 `Phi=OPT_D>B`，故仍在严格改善集中）。
5. **（条件必须写死：`B` 是 `D` 上的下界）** 若只有 `B <= OPT_Omega` 而 **`B > OPT_D`**（例如 `B` 取自更大域/更放宽的盒域、或把 `Omega` 的上界侧值当 `B`），则上述 1–4 **全部失效**：`I_Omega(B)` 可能完全不含 `D` 的点；`l^Omega(B)` 可以更大并排除真实 optimizer；`Phi(l^Omega(B))` 可以 `> OPT_D`；“`T_Omega` 有界”也不再成立。精确反例见 §7.9（`D={C+H+D<=294}`，`B=OPT_D+1`）。

**证明（3–5 行）**：(1) `x*∈D⊆Omega`、`Phi(x*)=OPT_D≥B`，故 `x*` 属于 `Omega` 上改善集，`l_i^Omega(B)` 是该集合第 `i` 坐标的最小值，故 `x*_i≥l_i^Omega(B)`。(2) 由 (1) 对任一固定 `x*` 有 `l^Omega(B)≤x*` 逐坐标，`Phi` 单调 ⇒ `Phi(l^Omega(B))≤Phi(x*)=OPT_D`。(3) 由 (2) 与 `B≤OPT_D` 得 `max(B,Phi(l^Omega(B)))≤OPT_D`；`T≥B` 由定义。(4) 见正文语义说明（`l^Omega` 未必在 `D` 内，故非 incumbent；下界不等式仍成立）。(5) `B>OPT_D` ⇒ `∀x∈D, Phi(x)≤OPT_D<B` ⇒ `D∩I_Omega(B)=∅`，屏障失去与真实最优解的联系；§7.9 给出具体数值。∎

### 定理 2（盒域 maximizer 与最强坐标屏障）

在 `Omega` 上：

1. `OPT = Phi(κ)`（单调性），且 `argmax_{Omega} Phi = { x : x_i >= c_i^opt（i=C,H,D） }`（因 `Phi` 每个因子在达到 `Phi_i(κ_i)` 后不再增加）。若 `c_i^opt=0` 则该坐标无约束。
2. `l_i^>=(OPT) = c_i^opt`，且 `Phi(c^opt) = OPT`。
3. 对任意 `B <= OPT`：`l_i^>=(B) <= c_i^opt`。因此**用本方法能证明的最强坐标屏障**是 `c^opt`；更低的 `B` 只会给出更弱的 `l`。注意 `c^opt` 需要知道 `OPT`（或 `Phi(κ)`），这对盒域是已知的；对真实域 `OPT` 未知，屏障只能按 `B` 做。
4. `Phi(l^>=(B)) = OPT` 当且仅当 `l^>=(B) = c^opt`（因为 `l_i <= c_i^opt` 且 `Phi` 单调正）；这又等价于 `B > M`，其中 `M := max_i M_i`、`M_i := F_i(c_i^opt-1)·Π_{j≠i}F_j(κ_j)`（`c_i^opt=0` 时 `M_i` 视为 −∞/0）。精确证明见定理 4。

### 定理 3（便宜的两属性特化 `l_i^cap`，盒域精确、子域仅下界）

定义

```text
l_i^cap(B) := min { c ∈ [0,κ_i] : F_i(c) · Π_{j≠i} F_j(κ_j) >= B }      （严格版把 >= 换成 >）
```

1. **盒域上精确**：`l_i^cap(B) = l_i^>=(B)`（`D=Omega`）。理由：对固定 `x_i=c`，`Phi(c,x_j,x_k)` 在 `x_j=κ_j, x_k=κ_k` 处最大（单调）；故 `I_>=(B)` 中存在 `x_i=c` 的点 iff `F_i(c)·O_i >= B`。这正是用户说的「固定另外两个属性在各自 cap 的最大值，只解一元」。
2. **一般子域上仍是安全下界**：`l_i^cap(B) <= l_i^{D,>=}(B)`（`D ⊆ Omega`）。理由：若 `x ∈ D` 且 `Phi(x) >= B`，则 `F_i(x_i)·Π_{j≠i}F_j(x_j) >= B`，且 `x_j <= κ_j` ⇒ `F_i(x_i)·O_i >= B` ⇒ `x_i >= l_i^cap`；对 `I_>=(B)∩D` 取 min 即得。等号一般不成立，可严格（§7.3 的 slab 例子）。
3. **计算**：`F_i` 在 `[0,κ_i]` 上只取有限个档位值（单调），`l_i^cap` = 最小 `c` 使 `F_i(c) >= ceil(B/O_i)`（严格版 `> B/O_i`）；等价于在档位表上二分/线性扫描，复杂度 `O(#tiers_i)` 或 `O(log #tiers_i)`，不需要任何 3D 枚举。整数实现：`F_i(c)·O_i >= B` 直接用 BigInt 比较（`O_i` 可能很大，用 BigInt；`B` 也为 BigInt）。
4. **闭式/单调性**：`l_i^cap` 关于 `B` 非减；`B` 增大到超过 `F_i(c^opt-1)O_i` 时 `l_i^cap` 跳到 `c_i^opt`（§定理 4 的 `M_i`）。
5. **与固定切片（pairwise）的关系**：`l_i^cap` 是「把另两属性固定在 cap」的**退化 2D 切片最大值**的一元反解；真正的固定第三坐标 2D 切片分析见 §5.6，它在非盒域上可给出更强的 `l_i^{D}`。

### 定理 4（精炼算子 `T`：安全、单调、幂等、精确阈值）

对 `B <= OPT` 定义（盒域；`l(B)=l^>=(B)` 的非严格核）

```text
T(B) := max( B, Phi(l(B)) ) 。
```

1. **（安全）** `B <= T(B) <= OPT`。证明：`B<=OPT`；`Phi(l(B)) <= OPT`（定理 1(3)）。
2. **（单调）** `B_1 <= B_2 ⇒ T(B_1) <= T(B_2)`。证明：`I_>=(B_1) ⊇ I_>=(B_2)` ⇒ 坐标 min 满足 `l_i(B_1) <= l_i(B_2)` ⇒ `Phi(l(B_1)) <= Phi(l(B_2))`；再与 `max(·,B)` 单调合并。
3. **（幂等，关键）** `T(T(B)) = T(B)` 对一切 `B <= OPT`。证明：记 `B_1=T(B)`。若 `B_1=B` 则显然。否则 `B_1=Phi(l(B))>B`。对每个 `i`：

   ```text
   F_i(l_i) · O_i / B_1 = O_i / Π_{j≠i} F_j(l_j)
                        = Π_{j≠i} (F_j(κ_j)/F_j(l_j)) >= 1 ，
   ```

   因为 `l_j <= κ_j` 且 `F_j` 非减、为正。故 `F_i(l_i)·O_i >= B_1`，即 `l_i(B_1) <= l_i`；于是 `Phi(l(B_1)) <= Phi(l(B)) = B_1`，从而 `T(B_1)=B_1`。∎

   推论：**从任意 `B_0 <= OPT` 迭代 `B_{n+1}=T(B_n)` 至多发生一次严格改进即稳定**（不是“可能多轮上升”）；稳定值 ∈ `{B_0, Phi(l(B_0))}`。
4. **（不动点判定）** `B` 是 `T` 的不动点 ⇔ `Phi(l(B)) <= B`。若 `Phi(l(B)) > B`，则 `T` 严格改进且改进值为 `Phi(l(B))`。
5. **（精确阈值 `M`）** 令

   ```text
   M_i := F_i(c_i^opt - 1) · Π_{j≠i} F_j(κ_j)      （c_i^opt>0；c_i^opt=0 时 M_i := -∞ 或 0）
   M   := max_i M_i 。
   ```

   则对 `B <= OPT`：`T(B)=OPT ⇔ B > M`；并且 `B <= M ⇒ T(B) <= M`。证明：`l_i(B)=c_i^opt ⇔ B > M_i`（因为 `c<c_i^opt` 时 `F_i(c)·O_i <= F_i(c_i^opt-1)·O_i = M_i`；`c_i^opt` 处等于 `OPT`）；故 `Phi(l(B))=OPT ⇔ l=c^opt ⇔ B>M`。若 `B<=M`，取 `i*` 使 `M_{i*}=M`；`B<=M_{i*}` ⇒ `l_{i*}(B) <= c_{i*}^opt-1` ⇒ `Phi(l(B)) <= F_{i*}(c_{i*}^opt-1)·Π_{j≠i*}F_j(κ_j) = M`；与 `B<=M` 合并得 `T(B)<=M`。∎
6. **（无需真实可行见证的改进；改进值不是 incumbent/achievable，但可以是 `OPT_D` 的合法下界）** 若 `Phi(l(B))>B`，则 `B' = Phi(l(B))` 是 `OPT` 的更高有效下界，且**不需要新的外部可行点**：`l(B) ∈ Omega`（盒域）所以 `Phi(l(B))` 由盒域内点 `l(B)` 取到。**但** `Omega` 是松弛域：`l(B)` 一般不是真实装备可达点，故 `B'` **不是**真实搜索的 incumbent/achievable value（不能当“已找到解”）。**然而**，若 `B` 同时还是某个小域 `D⊆Omega` 上的下界（`B<=OPT_D`，例如 `D=Reach`、`B` 是真实 incumbent 的乘积），则由定理 1′ 有 `B<=B'<=OPT_D`：`B'` 是 **`OPT_D` 的合法（非构造性）下界**，可用于 `UB_branch < B'` 剪枝与“`B'` 高于所有已知 witness ⇒ 存在更好可行解”的推理。区分标准是：**能否作为待提交/可达解（incumbent）** vs **能否作为 `OPT_D` 的下界**；前者需要可达性，后者只需要 `B<=OPT_D`。
7. **（严格核）** 把 `I_>=` 换成 `I_>`、`l` 换成 `l^>` 可定义 `T^>`；同样的安全/单调性成立，但阈值要求 `B<OPT`。幂等性证明的等式步骤可能出现 `F_i(l_i)O_i = B_1` 的等号；此时严格集合在 `B_1` 处可能为空 → `T^>` 失效，应回退到非严格核或禁用该层（§7.4 给混用反例）。
8. **（轨迹与反例）** 改进型：`T(OPT-1)=OPT`（因为 `OPT-1 > M`，见 §7.5）；`T(M-1)=M`。停滞型：`B=Phi(0)` 是不动点（`Phi(l)=B`）；`B=Phi(100,0,0)` 立即不动且 `Phi(l(B))<B`（严格无改进）。详细数值见 §7.5、§7.6。

### 定理 5（与 strict-improvement-frontier 的关系与价值判定）

1. **（等价）** 对 `w=e_i`（第 `i` 个单位方向），frontier 的 `K_w^{>=}(B) = min{w·x : x∈G_>=(B)} = min{x_i : Phi(x)>=B} = l_i^>=(B)`；严格版 `K_{e_i}(B)`（定义在 `G_>(B)` 上）等于 `l_i^>(B)`。证明：`w=e_i` 时 `w·x=x_i`，按定义即得。
2. **（剪枝等价）** 「删除 `∃i: x_i < l_i(B)`」恰是三个半空间 `{x_i >= K_{e_i}^{>=}(B)}` 的交的补；它**不超出** frontier 的支撑族（任意方向 `w` 的支撑 `w·x >= K_w` 都比这三个轴支撑中的某些更强或至少不同）。因此**新增剪枝能力不是本对象的贡献**；对任意非轴方向，存在 box 无法排除而该支撑能排除的点（真实 frontier 的 `K_w` 由最小反链/D_min 机制给出）。
3. **（相对 frontier 的弱点）** box 只保留三个坐标轴的投影；`l` 点本身可能 `Phi(l) < B`（停滞例：`B=Phi(100,0,0)`、`l=(0,0,0)`、`Phi(l)=4.08e12 < B=4.0928e12`），即 box 区域严格大于改善集，box 剪枝会漏掉大量可排除点。
4. **（新增价值）** (i) **显式坐标屏障/证书**：`x*_i >= l_i` 是可直接书写/审计的定理；(ii) **乘积下界** `Phi(l) <= OPT`，且在盒域内由点 `l` 取到；(iii) **无需真实 incumbent 的精炼迭代** `T`：任意已知 `B` 都可能被 `T` 提升，且该提升不依赖新外部可行点。
5. **（价值上限，定量）** 由定理 4：`T` 至多一次严格改进；若初始 `B <= M`，最终值 `<= M`；若 `B > M`，`T(B)=OPT`。`M = 4,131,769,649,910`、`OPT = 4,132,797,964,905`、`OPT - M = 1,028,314,995`（本实例），即 `M/OPT ≈ 0.99975`。**但** `OPT` 是松弛盒域最大值；真实可达最优 `OPT_Reach <= OPT` 可能明显更低，`B`（真实 incumbent）常常 `<= M`，于是迭代封顶在 `M` 且通常直接停滞。**不声称**这能在真实搜索中提供性能收益。
6. **（什么时候 `T` 能改进）** 充要：`T(B) > B ⇔ Phi(l(B)) > B`。由定理 4(5)，若 `B>M` 则一步到 `OPT`；若 `B<=M`，改进上限为 `M`，且当 `l(B)` 的三个坐标 min 取到不同的“边缘点”时 `Phi(l)` 常 `< B`（停滞）——`l_i(B)` 是三个独立一元反解，乘积 `Π l_i` 一般小于“使三者同时可行”的点。

### 定理 6（与固定第三坐标的 pairwise 切片分析的关系）

1. **（不同对象）** pairwise 分析固定第三坐标 `k` 与两属性预算 `S`，研究 2D 切片上 `G_{ij}(x)=F_i(b_i+x)F_j(b_j+S-x)` 的**最大值/端点/临界点结构**（[pairwise-slice-critical-set](../pairwise-slice-critical-set/README.md) 定理 1；[pairwise-endpoint-max](../pairwise-endpoint-max/README.md) 定理 1–3）；本对象的 `l_i(B)` 是 **3D** 改善集在坐标轴上的**投影极值**，不是固定切片上的最值。二者不可互相替代。
2. **（组合：非盒域上的更强 `l`）** 对一般 `D ⊆ Omega`，`l_i^{D}(B) = min { c : max_{x∈D, x_i=c} Phi(x) >= B }`；右侧的内层最大值是「固定 `x_i=c` 后剩余两属性的 2D 最大化」。因此：
   - 用 [pairwise-slice-critical-set](../pairwise-slice-critical-set/README.md) 的有限关键集可**精确**计算该 2D max ⇒ 得到非盒域的精确 `l_i^D`；
   - 若在相关区间上 [pairwise-endpoint-max](../pairwise-endpoint-max/README.md) 的**条件端点定理**成立，可 O(1) 判定（端点之一是否达 `B`），得到便宜的更强 `l_i^D`；
   - 注意 pairwise-endpoint-max 的**全域**端点最大已被否证，不能无条件用它替代 2D 精确关键集。
3. **（盒域是退化情形）** 盒域上「固定 `x_i=c` 后剩余 2D max」在 `(x_j,x_k)=(κ_j,κ_k)` 取到（无其它约束），于是退化为 `l_i^cap` 的一元式；即定理 3 是定理 6 组合公式在盒域上的闭式特化。
4. **（严格分离数值）** slab 子域 `Smax=150`：`l^cap=(0,0,0)` 但 `l^slab=(0,66,80)`（严格）；`Smax=250`：`l^cap=(56,66,80)`、`l^slab=(56,91,100)`（严格）。见 §7.3。

### 定理 7（扩展到完整伤害因子）

记 `q=weaponDamage·mainStat·tenacity`（正），DPS 再除以 `g=gcdCentiseconds`（正）；设 `q∈[q_lo,q_hi]`、`g∈[g_lo,g_hi]` 为已证明的独立界（`q_lo>0`、`g_lo>0`）。

1. **（完整目标下界）** 在盒域内点 `l` 处：`Psi_damage(l,q) = Phi(l)·q >= Phi(l)·q_lo`，`Psi_dps(l,q,g) = Phi(l)·q/g >= Phi(l)·q_lo/g_hi`。因此

   ```text
   max Psi_damage >= Phi(l)·q_lo        （松弛域内可达点 l）
   max Psi_dps    >= Phi(l)·q_lo/g_hi
   ```

   （成立条件：`l` 在考虑的松弛域内；`q_lo/g_hi` 是独立已证界。见 (A6)。）
2. **（改善的必要条件，用于把阈值翻译成三属性阈值）** 对严格改进 `Psi > B_full`：
   - damage：`Phi·q > B_full`，`q <= q_hi` ⇒ `Phi > B_full/q_hi`。取整数阈值 `B_sub := floor(B_full/q_hi)+1`（`Phi` 为整数），则改善点满足 `Phi >= B_sub`；用 `l^>=(B_sub)` 做坐标屏障（保留 tie 时按 `>=` 语义；只找严格改进时用 `l^>(B_sub-1)` 或等价严格阈值，注意 (A5)）。
   - DPS：`Phi·q > B_full·g`，`g >= g_lo` ⇒ `Phi·q > B_full·g_lo`，`q <= q_hi` ⇒ `Phi > B_full·g_lo/q_hi`。取 `B_sub := floor(B_full·g_lo/q_hi)+1` 同理。
3. **（适用条件与限制）** 这里的 `q_lo/q_hi/g_lo/g_hi` 必须**独立于三属性**（例如来自候选池的全局乐观界/悲观界）；若 `q` 与 `x` 强耦合（同一件装备同时决定主属性与副属性），独立界只给出合法但可能较松的界，紧致化需要联合处理（§12）。坐标 box 只对三属性，其它因子不进 box。

### 定理 8（价值判定：什么时候有用、什么时候停滞）

1. **（不增加剪枝强度）** 见定理 5(2)：box 剪枝 = 3 个轴支撑，是 frontier 支撑族的子集；任何多 support 系统加入这 3 条不会比已有非轴支撑更强（除非原本没有轴支撑）。
2. **（乘积下界：合法下界 ≠ incumbent/achievable）** `Phi(l) <= OPT` 且 `l ∈ Omega`；`l` 一般不是真实可达配装，故 `Phi(l)` **不能**当真实搜索的 incumbent/achievable value（不能作为“已找到解”提交，除非另有可达性证明）。但若 `B` 还是某个小域 `D⊆Omega` 上的下界（`B<=OPT_D`），则由定理 1′ `Phi(l^Omega(B))<=OPT_D` 是 **`OPT_D` 的合法（非构造性）下界**，可用于 `UB_branch < LB` 剪枝与存在性推理（“LB 高于所有已知 witness ⇒ 存在更好可行解”）。对 `D=Reach`（真实可达点集），`l^Omega(B)` 的上游条件仅是 `B<=OPT_Reach`；`l` 的可达性与代价另论（不在本文范围、未评估）。
3. **（迭代能力有限）** `T` 幂等 ⇒ 至多一次严格改进；且 `T(B) <= M`（当 `B<=M`）或 `=OPT`（当 `B>M`）。因此：
   - 若真实 incumbent 的 `B` 落在 `(M, OPT]`（距离松弛最优 `~2.5e-4` 以内），`T` 一步到松弛 `OPT`——但这是松弛值，不是真实值；
   - 若 `B <= M`，最多提升到 `M`（或更小），且常常立即停滞；`Phi(l(B)) < B` 的严格停滞实例见 §7.6。
4. **（“较大可能出现足够高的下界吗”）** 从机制看：`l_i` 由三个独立的一元阈值给出，`Phi(l)` 通常低于 `B`（除非 `B` 已接近 `OPT`）；真实 incumbent `B` 距松弛 `OPT` 的差距未知（`OPT` 是松弛上界），所以不能保证 `B>M`。本文**不做**概率/经验断言，也不声称该迭代在真实搜索中有收益。
5. **（结论）** box 的真正价值是**可审计的坐标屏障证书 + 乘积下界 + 无需新真实见证的迭代分析**，而不是“更强的剪枝”或“性能收益”。

## 6. 证明

### 引理 0（单调性与阈值基本性质）

(a) `Phi` 对每个坐标非减且为正（参考文档 §5 + 档位非减）。因此 `I_>=(B)`、`I_>(B)` 是上集：`x∈I`、`y>=x` ⇒ `y∈I`。
(b) 对盒域，`max_{x_j,x_k} Phi(c,x_j,x_k) = F_i(c)·O_i`，`O_i=Π_{j≠i}F_j(κ_j)`。
(c) `c_i^opt = min{g : F_i(g)=F_i(κ_i)}` 存在且唯一（`F_i` 单调、整数有限）。
(d) `l_i(B)` 关于 `B` 非减（集合随 `B` 收缩、坐标 min 不降）；`l_i^cap(B)` 同理。
证明：均为定义 + 单调性直接推论。∎

### 定理 1 的证明

1. `B<=OPT_D` ⇒ `I_>=(B)` 含任一 maximizer（`Phi(x*)=OPT_D>=B`），故非空。`l_i^>=` 有限。`x*_i >= min{x_i : x∈I_>=(B)}` 由定义。严格版：`B<OPT_D` ⇒ `x*∈I_>(B)` 非空。
2. 若 `x_i<l_i^>=(B)`，则 `x∉I_>=(B)`（否则 `x_i` 不会小于该集合的最小第 `i` 坐标），故 `Phi(x)<B<=OPT_D`，不是 maximizer。严格版：`x∉I_>(B)` ⇒ `Phi(x)<=B<OPT_D`。
3. 由 1 得 `l_i <= x*_i` 对每个 `i`；`Phi` 逐坐标非减 ⇒ `Phi(l)<=Phi(x*)=OPT_D`。
4. 盒域一元式由引理 0(b)：`∃ x_j,x_k`（在 `[0,κ]`）使 `Phi(c,x_j,x_k)>=B` ⇔ `F_i(c)O_i>=B`。故坐标 min 即该一元最小解；`l∈[0,κ]` 显然。
5. 一般域 `D3` 的 `l` 坐标由不同点取到 ⇒ `l∉D3`；乘积不等式仍由 3 得出（只用到 `l_i<=x*_i`）。
6. 若 `B>OPT`：`∀x, Phi(x)<=OPT<B` ⇒ `I=∅`、`l=+∞`；屏障 `x*_i>=+∞` 无解，定理前提失效。把 `l` 截断到 `κ` 后 `x*_i>=κ_i` 一般不成立（反例中 `c_C^opt=98<κ_C=100`）。
7. 域不匹配同理：`B>OPT_Ω` ⇒ 在 `Ω` 上空集；用 `Ω'` 的 `l` 时 `Ω` 的 maximizer 可能坐标更小。∎

### 定理 1′ 的证明

(1) `x*∈D⊆Omega`、`Phi(x*)=OPT_D≥B`，故 `x*∈I_Omega(B)`；`l_i^Omega(B)` 是该集合第 `i` 坐标的最小值，故 `x*_i≥l_i^Omega(B)`。(2) 固定任一 `x*`，由 (1) 得 `l^Omega(B)≤x*` 逐坐标；`Phi` 逐坐标非减 ⇒ `Phi(l^Omega(B))≤Phi(x*)=OPT_D`。(3) 由 (2) 与 `B≤OPT_D`：`max(B,Phi(l^Omega(B)))≤OPT_D`；又 `T≥B` 由定义 ⇒ `B≤T_Omega(B)≤OPT_D`。(4) 若 `l^Omega∉D`，则 `Phi(l^Omega)` 不是 `D` 内可行点的函数值（非 incumbent/achievable），但 (2) 只用到单调性，故作为 `OPT_D` 的下界合法；分支剪枝：`UB_branch<Phi(l^Omega)≤OPT_D` ⇒ 分支内所有点严格低于 `OPT_D`；存在性：`D` 有限且 `OPT_D` 被某点达到，若 `Phi(l^Omega)>` 所有已知 witness，则达到 `OPT_D` 的点优于所有已知 witness。(5) `B>OPT_D` ⇒ `∀x∈D, Phi(x)≤OPT_D<B`，故 `x*∉I_Omega(B)`，屏障不再关联真实最优解；`Phi(l^Omega(B))` 可 `>OPT_D`；反例 §7.9。∎

### 定理 2 的证明

1. `OPT=Phi(κ)`：单调 ⇒ 顶角最大。`Phi(x)=OPT` ⇔ 每个因子都取到最大值 `F_i(κ_i)`（因子为正，任何一项严格小则乘积严格小） ⇔ `x_i>=c_i^opt`（`F_i` 在达到 `c_i^opt` 后恒为 `F_i(κ_i)`）。若 `c_i^opt=0` 则恒成立。
2. `I_>=(OPT)` 恰是 maximizer 集合，其第 `i` 坐标 min = `c_i^opt`（集合 = `{x_i>=c_i^opt∀i}`）；`Phi(c^opt)=OPT` 由 1。
3. 对 `B<=OPT`，`I_>=(B) ⊇ I_>=(OPT)` ⇒ 坐标 min `<= c_i^opt`。
4. `l(B)=c^opt` ⇔ 每个坐标达到上界；`Phi` 对每个坐标在 `[c_i^opt,κ_i]` 为常数，故 `Phi(l)=OPT` ⇔ `l_i>=c_i^opt`；结合 `l_i<=c_i^opt` 得 `l=c^opt`。∎

### 定理 3 的证明

见 §5 定理 3 的两条理由；`l_i^cap` 的单调性由 `F_i` 非减。整数实现：`F_i(c)·O_i >= B` 用 BigInt 精确比较；`l_i^cap` 可在档位表二分（`F_i` 在每个档位区间常数）。∎

### 定理 4 的证明

- 安全/单调见 §5 的证明。
- 幂等：见 §5 定理 4(3) 的比值不等式；注意 `F_j(l_j)>0`，除法为整数之比，`l_j<=κ_j` ⇒ `F_j(κ_j)/F_j(l_j)>=1`。
- 阈值：见 §5 定理 4(5) 的充要推导；`c_i^opt=0` 时该坐标无下界约束，`M_i` 不参与（置 −∞）。
- 严格核：等式边界见 §5 定理 4(7)；`I_>(B)` 在 `B>=OPT` 时为空（`B=OPT` 时无点 `Phi>OPT`）。
- 反例数值见 §7.5–§7.6，均由 verify.mjs 精确复算。∎

### 定理 5/6/7/8 的证明

- 5(1)：按 `K_w` 与 `l` 的定义直接代入 `w=e_i`（[strict-improvement-frontier](../strict-improvement-frontier/README.md) §3.4/§5.4）。
- 5(2)：box 删除集可写成三个半空间的并；frontier 的任意方向 `w` 支撑给出一个半空间，box 的每个轴半空间也只是其中一个（`w=e_i`），故 box 的剪枝集合不超出支撑族；非轴支撑可不同（可能存在 box 不能排除而它能排除的点）。
- 5(3)：停滞例 `B=Phi(100,0,0)` 时 `l=(0,0,0)`，box 不排除任何点，而 `Phi(0)=4.08e12<B` ⇒ 点 `(0,0,0)` 被 box 保留却不可能达标。
- 5(4)/(5)：由定理 4 的幂等与阈值结论直接得到。
- 6：由「固定 `x_i=c` 的 2D max」定义直接得到组合公式；pairwise 定理给出该 max 的精确关键集/条件端点判定；盒域上 2D max 在顶角取到（引理 0(b)）。
- 7：`q>=q_lo>0`、`g<=g_hi` 时 `q/g >= q_lo/g_hi`；在点 `l` 处取值即得下界。必要条件由 `g>=g_lo`、`q<=q_hi` 的代数方向得出（见 §5 定理 7(2)）。
- 8：汇总定理 4、5 的结论；`l` 非真实可达点（定理 1(5)）说明它是**非构造性**的，不能当 incumbent；但由定理 1′，当 `B` 是小域 `D` 上的下界时 `Phi(l^Omega(B))<=OPT_D` 仍是 `OPT_D` 的合法下界。∎

## 7. 反例与边界退化

以下数值全部由 [verify.mjs](verify.mjs) 在 `level=100`、WHM、`κ=(100,100,100)`（贡献坐标）上精确复算。

### 7.1 `B` 非下界（空改善集；屏障失效）

- 盒域 `OPT = 4,132,797,964,905`；取另一盒域 `κ'=(200,200,200)` 的点 `(200,200,200)` 的乘积

  ```text
  badB = Phi_{κ'}(200,200,200) = 4,187,477,517,440 > OPT 。
  ```

  在 `κ=(100,100,100)` 上 `I_>=(badB)=∅`、`l=+∞`、`T` 失效。若把空集/上界误当 `B`、并把 `l` 截断为 `κ=(100,100,100)`，则宣称的屏障 `x*_i>=κ_i` 会排除真实 maximizer `(98,97,100)`（例如 `98<100`）⇒ 屏障结论**假**。
- 这正是 §4(A2)(A3) 的必要性：`B` 必须是同域、同等级/职业、经证明的下界。

### 7.2 严格/非严格混用

- `B=OPT`：非严格 `I_>=(OPT)` = maximizer 集合（非空），`l^>=(OPT)=c^opt=(98,97,100)`；严格 `I_>(OPT)=∅`，`l^>=+∞`。
- 若实现用严格核却在 `B=OPT`（tie/精确最优场景）下仍声称屏障，则得到 `x*_i>=+∞`（矛盾）或空集处理不当而误删 incumbent。必须：**保留 tie → 非严格核**；**只找严格改进 → 严格核且要求 `B<OPT`**。

### 7.3 slab 子域：`l^cap <= l^slab` 可严格

`Omega_slab = {x∈Omega : C+H+D <= Smax}`：

| Smax | `OPT_slab`（点） | `l^cap` | `l^slab` | 说明 |
| --- | --- | --- | --- | --- |
| 150 | 4,109,633,040,000（(0,66,80)） | (0,0,0) | (0,66,80) | 严格：cap 公式要求另外两属性同时取 100，和 200>150 不可行 |
| 250 | 4,126,184,971,440 | (56,66,80) | (56,91,100) | 三个坐标均非平凡且严格 |

这说明定理 3(2) 的 `l^cap <= l^{D}` 可以严格；一般子域上若想要精确 `l`，需要 2D 切片最大值（定理 6 的组合公式）。

### 7.4 一般域上 `l` 不必可行

并集域 `D3={(100,0,0),(0,100,0),(0,0,100)}`：`OPT_D3=4,100,400,000,000`（在 `(0,0,100)`）。`B=1` 时 `l=(0,0,0) ∉ D3`，但 `Phi(l)=4,080,000,000,000 <= OPT_D3`。屏障 `x*_i>=l_i` 仍成立（2 个坐标为 0 的坐标下界是 0），乘积下界不要求 `l` 可行。

### 7.5 改进型轨迹

- `T(1) = Phi(0,0,0) = 4,080,000,000,000`，随后不动（`l(Phi(0))=(0,0,0)`）。
- `T(OPT-1) = OPT`：`OPT-1 = 4,132,797,964,904 > M = 4,131,769,649,910`，`l = c^opt` ⇒ `Phi(l)=OPT`。
- `T(M-1) = M`：`M-1` 时 `l=(98,91,100)`、`Phi(l)=M`；到 `M` 后不动。
- `T(M+1) = OPT`（`l=c^opt`）。
- 幂等：所有轨迹最多一次严格改进（`T∘T=T`）。

### 7.6 停滞型

- `B = Phi(0,0,0) = 4,080,000,000,000`：`l=(0,0,0)`，`Phi(l)=B` ⇒ `T(B)=B` 不动（与 `OPT` 差 `52,797,964,905`）。
- `B = Phi(100,0,0) = 4,092,796,000,000`：`l=(0,0,0)`，`Phi(l)=4,080,000,000,000 < B` ⇒ `T(B)=B`，**严格无改进**；与 `OPT` 差 `40,001,964,905`。说明「坐标 min 由低值组合取到、`Phi(l)` 低于 `B`」是常见停滞机制。

### 7.7 阈值 `M` 与盒域最优点

- `M_C=4,130,927,863,920`（把 `c^opt` 的 C 坐标降一档）、`M_H=4,131,769,649,910`、`M_D=4,128,685,728,124`；`M=M_H`，`OPT-M=1,028,314,995`。
- `l(M)=(98,91,100)`（注意 H 的阈值可在 `g=91` 就取到低于最优一档的因子值 4018；`c_H^opt=97` 只是达到最大因子 4019 的最小点）。
- `T(OPT)=OPT`（非严格核）；`T^>(OPT)` 失效（空集）。

### 7.8 其它退化

- `κ_i=0`：该属性无改善维度；`c_i^opt=0`、`l_i(B)=0`、`M_i` 不参与。
- 平台：`Phi` 在档位区间常值，`argmax` 是一个 box `{x_i>=c_i^opt}`（本例 12 个点：C∈{98,99,100}、H∈{97..100}、D={100}）；`l(OPT)=c^opt` 是其中“最小坐标”的组合，但 `c^opt` 本身可行（在 `Omega` 内），这说明盒域内 `Phi(l)=OPT` 可实现。
- `B<=0`：`Phi` 恒正 ⇒ `I_>= = Omega`、`l=0`、`Phi(0)>0>=B`，屏障平凡（不应误当有效剪枝）。
- 负贡献/负参数不在定义域（参考文档 §2.2）。

### 7.9 `B` 只满足 `B <= OPT_Omega` 而 `B > OPT_D`：定理 1′ 全部失效

**正例（`B` 是 `D` 上的下界 ⇒ 定理 1′ 成立）**：`D_1 = {C+H+D <= 200}`（⊂ `Omega`），`OPT_{D1}=4,119,876,900,000`（10 个 optimizer，例如 `(0,97,100)`）。取 `B=OPT_{D1}`：

```text
l^Omega(B) = (0,36,40)          （盒域一元式）
全部 10 个 D1-optimizer 满足 x*_i >= l_i^Omega(B)
Phi(l^Omega(B)) = 4,095,314,280,000 <= OPT_{D1}
T_Omega(B) = max(B, Phi(l^Omega)) = 4,119,876,900,000 ∈ [B, OPT_{D1}]
```

**反例（只知 `B <= OPT_Omega`，`B > OPT_D` ⇒ 屏障/乘积下界/迭代全部失效）**：`D_2 = {C+H+D <= 294}`（真子域；`c^opt` 的最小和为 `98+97+100=295`，故 `D_2` 恰好排除整个 top region）：

```text
OPT_{D2} = 4,131,769,649,910     （optimizer 例如 (98,91,100)）
取 B = OPT_{D2} + 1 = 4,131,769,649,911
  满足 B <= OPT_Omega = 4,132,797,964,905，但 B > OPT_{D2}
l^Omega(B) = c^opt = (98,97,100)    （因 B > M = 4,131,769,649,910）
真实 optimizer (98,91,100) 的 H=91 < l_H=97       ⇒ 坐标屏障失效
Phi(l^Omega(B)) = 4,132,797,964,905 > OPT_{D2}    ⇒ 乘积"下界"失效
T_Omega(B)      = 4,132,797,964,905 > OPT_{D2}    ⇒ 精炼下界失效
l^Omega(B) ∉ D_2（98+97+100=295 > 294）           ⇒ 也不是 D_2 的可行点
```

这正是 §4(A2) 的条件必须写死的原因：**`B` 必须是所用小域 `D` 上的下界**；仅 `B <= OPT_Omega` 不够（即使 `B` 是 `Omega` 上的合法下界/可达值）。verify.mjs `T9-superset-barrier-positive` / `T9-superset-barrier-failure` 精确复核以上全部数值。

## 8. 依赖与关联定理

- **依赖**：[raw-tier-transform](../raw-tier-transform/README.md)（档位单调/阈值）、[canonical-evaluator-reference.md](../../canonical-evaluator-reference.md) §2–§4、[strict-improvement-frontier](../strict-improvement-frontier/README.md)（`G`/`K_w`/支撑族的定义与 tie 语义）。
- **被谁使用/可组合**：
  - [free-budget-upper-bound](../free-budget-upper-bound/README.md) 的 `U(b,R,κ)`：`l_i` 提供逐坐标下界，可作为 `κ`/baseline 的补充信息（本文不改变 `U` 的公式）；
  - [substat-sum-upper-bound](../substat-sum-upper-bound/README.md)：slab 域的来源（`L<=S<=R`），把 `D` 从盒域换成 slab 可用定理 6 组合出更强 `l`；
  - [pairwise-slice-critical-set](../pairwise-slice-critical-set/README.md)：非盒域上精确 2D 切片最大值，用于定理 6 的组合公式；
  - [pairwise-endpoint-max](../pairwise-endpoint-max/README.md)：条件端点定理可在成立区间上便宜地判定 2D max 是否达 `B`（不能无条件用）。
- **不重复**：`l_i` 的坐标半空间是 [strict-improvement-frontier](../strict-improvement-frontier/README.md) 的 `w=e_i` 特例；本文的新内容是**盒域闭式/精度、乘积下界、`T` 迭代的幂等与阈值 `M`、以及价值判定**。

## 9. 与 canonical evaluator / 生产实现的对应（file:line）

| 对象 | 位置 | 说明 |
| --- | --- | --- |
| 档位 `t_sigma(g)` | `src/domain/search/equipped-effects.ts:110-154`（CRT/DHT/DET 分支 `:138-149`） | 贡献坐标；单调非减 |
| 因子 `F_C,F_H,F_D` | `equipped-effects.ts:95-98`（`determination/critical/directHit`） | 正、单调；本文 `Phi` 的因子 |
| 截断语义 | `equipped-effects.ts:163-166` | `Math.trunc(v+1e-7)`；可达域等价 floor（参考文档 §2.2） |
| 阈值反解（参考实现） | `docs/mathematical-analysis/verification/canonical-model.mjs:112-117`（`firstContributionWithTierAtLeast`） | `c_i^opt`/`l_i^cap` 需要「档位 → 最小贡献」的反解；生产目前只有正向 `equippedAttributeTier`，该反解需新增实现或离线表 |
| 精确比较语义 | `src/domain/search/exact-mip-candidate-upper-bound.ts:96-140` | `Phi`/完整目标最终用 BigInt 交叉乘法比较 |
| `G_>(B)/G_>=(B)/K_w` | [strict-improvement-frontier](../strict-improvement-frontier/README.md) §3.3/§3.4/§5.4 | 本文 `l_i=K_{e_i}`；tie 语义表 §5.4 |
| 2D 切片关键集/条件端点 | [pairwise-slice-critical-set](../pairwise-slice-critical-set/README.md) §5.1；[pairwise-endpoint-max](../pairwise-endpoint-max/README.md) §5.1–§5.3 | 定理 6 组合公式的组件 |
| `U(b,R,κ)`/P3 | [free-budget-upper-bound](../free-budget-upper-bound/README.md) §10.2 | 下游使用方式 |

**注意**：本文是公式级定理，不依赖候选池；生产代码没有实现 `l_i`/`T`（不改变任何现有行为）。

## 10. 应用前提与安全回退

### 10.1 安全用法

1. **B 的来源**：必须是同等级/职业、同域（或子域）的**已证明下界**：真实候选/incumbent 的 `Phi` 值，或其它已证明下界。**禁止**用 `U` 的上界、 relaxation 值、更大的盒域乘积、或经验估计当 `B`。
2. **κ 的来源**：已证明的贡献上界，且 `Omega`（或 `D`）包含所有被考虑的点；若候选池做过未证明的支配剪枝，`D` 必须换成原始超集（`equipped-effects`/candidate 层规则：完整性不被性能优化削弱）。
3. **tie 语义**：保留 tie 用非严格核 `l^>=(B)`（`B` 可为 incumbent 值）；只找严格改进用 `l^>(B)` 且 `B<OPT`。确定目标后不可混用。
4. **坐标/等级**：贡献坐标；面板值必须先按 §13 换算；公式等级、BLU 标记必须正确。
5. **乘积下界 `Phi(l)` 的双重身份**：它不是 incumbent/achievable value（`l` 一般不是真实可达配装，不能当“已找到解”），但当 `B` 是某个小域 `D⊆Omega` 上的下界（`B<=OPT_D`）时，由定理 1′ 它是 **`OPT_D` 的合法（非构造性）下界**，可用于 `UB_branch < Phi(l^Omega(B))` 的严格剪枝与“`Phi(l^Omega(B))` 高于所有已知 witness ⇒ 存在更好可行解”的推理。若 `B` 不满足 `B<=OPT_D`（例如 `B` 来自更大域/上界侧），**禁止**把它当 `OPT_D` 下界。若需真实 incumbent/achievable 解，另需可达性证明。
6. **剪枝语义**：对候选/分支 `x`，若存在 `i` 使 `x_i < l_i^>=(B)`，则 `Phi(x)<B`，可安全删除（保留 tie 场景用非严格；严格改进场景用严格核且 `B<OPT`）。这**不**依赖 `x` 的其它坐标。
7. **与完整目标组合**：按定理 7 把完整阈值翻译成 `B_sub`；`q/g` 的界必须是已证明的独立界；否则退回更保守的界或禁用该层。

### 10.2 安全回退

- `B` 不能认证为下界 → **禁用本层**（不得用上界冒充）；退回只用真实 incumbent 比较的精确层。
- `largest B` 可能来自另一域/另一等级 → 禁用或重算。
- `l^cap` 在非盒域只是下界；若需要更强 `l` 而无法证明 2D 切片结构 → 使用盒域 `l^cap`（安全但更弱）或禁用。
- `T` 的改进值 `Phi(l)` 不能当真实 incumbent/achievable 值；但若 `B<=OPT_D`（`D` 为所用小域），它是 `OPT_D` 的合法非构造下界（定理 1′），可用于剪枝/存在性推理；若搜索需要真实可行解，仍只能来自真实可行见证。
- `B` 只满足 `B<=OPT_Omega` 但 `B>OPT_D`（例如 `B` 来自更大域/上界侧）：**禁用定理 1′ 相关用法**（屏障/乘积下界/迭代全部可能失效，§7.9）。
- 任何 `+∞`/空集/溢出/非安全整数：显式失败并禁用该层（不要截断/补 magic 值）。
- 禁止经验系数/等级职业 magic case（规则第 47 行）。

## 11. 验证

本目录 [verify.mjs](verify.mjs)：

```text
node --experimental-strip-types docs/mathematical-analysis/theorems/coordinate-lower-bound-box/verify.mjs
```

当前输出 **PASS**，`checks: 395`（另计 8,242,504 个逐点屏障检查、1,030,301 个 maximizer 点核对）。覆盖：

- **盒域** `level=100 WHM`、`κ=(100,100,100)` 全枚举 1,030,301 点：`OPT=Phi(κ)`、maximizer 刻画、`c^opt`、`l` 的暴力定义 vs 一元式（24 点）、屏障（含“降任一坐标到 `l_i-1`、其它取 cap 仍 <B”）、`Phi(l)<=OPT`、`l` 关于 `B` 单调、严格/非严格语义。
- **`T`**：7 条轨迹的安全/单调/有界/幂等；`T=OPT ⇔ B>M` 的阈值点（`M-1/M/M+1/OPT-1`）；改进/停滞数值；非法 `B`（空集 + 截断错误）反例。
- **一般域**：并集 `D3` 的 `l∉D` 与乘积下界。
- **slab 子域**：`Smax=150`、`250` 的 `l^cap <= l^slab` 严格分离与 `Phi(l)=OPT_slab`。
- **小域超集屏障（定理 1′）**：`T9-superset-barrier-positive`（`D={sum<=200}`，`B=OPT_D`：全部 10 个 optimizer ≥ `l^Omega=(0,36,40)`、`Phi(l^Omega)=4,095,314,280,000<=OPT_D`、`T_Omega(B)∈[B,OPT_D]`）；`T9-superset-barrier-failure`（`D={sum<=294}`，`B=OPT_D+1=4,131,769,649,911` 只 ≤ `OPT_Omega`：真实 optimizer 违反 `l_H`、`Phi(l^Omega)=OPT_Omega>OPT_D`、`T_Omega(B)>OPT_D`）。
- **frontier 对应**：24 个 `(B,i)` 点 `l_i=K_{e_i}^{>=}`。
- **完整伤害扩展**：下界与必要条件的 36 个样本方向复核。
- **baseStat 坐标**：`Phi(0)=1,020,000·4,000·1,000` 等。

**证明作用**：有限域证书 + 反例；一般性证明在 §5–§6。

## 12. 未解决问题

1. **真实可达域 `Reach` 上的坐标下界/实现**：本文 `Omega` 是松弛盒域；定理 1′ 已证明只要 `B<=OPT_Reach`，`l^Omega(B)` 的屏障/乘积下界/`T_Omega` 对 `OPT_Reach` 有效；但 `l^Omega` 的**真实可达性**（把 `Phi(l^Omega)` 升级为 incumbent/构造可行见证）与 `l^Reach` 的精确计算/代价未评估（本文不声称性能）。
2. **`Phi(l)` 从“非构造下界”到“可达解”**：定理 1′ 给出 `Phi(l^Omega(B))<=OPT_D` 的合法下界（无需 `l` 可达），可用于剪枝/存在性推理；如何在不枚举全部候选的前提下**构造**达到该值的真实可行解（把 LB 变成 witness/incumbent），未解决。
3. **与 arbitrary supports 的联合最紧**：box 只是 3 个轴支撑；如何把 `l_i` 与非轴支撑、2D 切片条件（slab/真实资源约束）组合成“在给定支撑数下最紧”的证明体系，部分在 [strict-improvement-frontier](../strict-improvement-frontier/README.md)（支撑族本身），但“box + 切片 + 支撑”的最优组合未解决。
4. **真实候选池的 `κ`/`B` 认证**：`κ` 必须来自候选池上界、`B` 必须是所用域上的下界（小域 `D` 上要求 `B<=OPT_D`，见定理 1′ 条件 5）；多来源/同步/共享食物下的安全构造见 [substat-sum-upper-bound](../substat-sum-upper-bound/README.md) 与 joint 文档，本文不重复。
5. **耦合的其它乘区**：定理 7 假设 `q/g` 与三属性独立；同一装备同时决定主属性/武器伤害/副属性时，联合界可更紧，未解决。
6. **多步/非幂等变体**：本文证明非严格核 `T` 幂等；若引入 2D 切片、slab 或更多信息（如 `l` 的联合可行性），可能得到可多步提升的算子；是否存在这样的安全算子及其价值未解决。
7. **严格核的幂等性边界**：定理 4(7) 指出等号边界可能使严格 `T^>` 需要一步回退；严格的完整刻画/实现细节未展开。
8. **经验/统计问题**：「真实 incumbent 距松弛 OPT 通常多远」属于数据/搜索问题，本文不做经验断言；不能把本文的阈值 `M` 当作真实可达到界。

## 13. baseStat 影响审计（贡献坐标 vs 面板总值）

本节为坐标审计：本文所有量必须是**档位输入贡献**；面板总值的换算如下。

### 13.1 坐标声明

- `C,H,D`、`l_C,l_H,l_D`、`c^opt`、`B`、`Phi`、`κ`、`Smax` 全部是贡献坐标；**不是**面板总值。
- 精确定义：面板总值 `P_i = baseStats[stat] + 贡献 g`（`equipped-effects.ts:127`）；属性偏移

  ```text
  o_CRT = o_DHT = sub          （TEN 也用 sub，但不在本文三属性内）
  o_DET = main
  贡献 g_i = P_i - o_i 。
  ```

- 因此 `Phi(0,0,0)` 表示「装备+食物贡献全为 0」，对应面板 = `(sub, sub, main)`，**不是面板 0**。level 100 普通职业：`o=(420,420,440)`。

### 13.2 归约链（源码到贡献坐标）

1. `equipped-effects.ts:127`：`value = baseStats[stat] + gearAndFoodValue`。
2. `getBaseStats`（`:178-203`）：生成数据 `baseStats.CRT = baseStats.DHT = baseStats.TEN = "sub"`、`baseStats.DET = "main"`；`clanStats` 只含 STR/DEX/VIT/INT/MND；`jobSchemas[*].statModifiers` 不含三副属性（缺省 100）⇒ 对全部职业/等级 `baseStats.CRT = baseStats.DHT = sub`、`baseStats.DET = main`。
3. 分支（`:138-149`）分别减 `sub`/`main` ⇒ 档位实参 = `value - o_i` = 贡献 `g_i`；当前数据下 `g_i = gearAndFoodValue`。
4. floor 实参非负（可达域）：CRT ≥ 50、DHT ≥ 0、DET ≥ 200、TEN ≥ 1000（参考文档 §2.2），故 `Math.trunc(v+1e-7)=floor(v)`；负贡献域不在定义域。
5. `F_i` 只依赖贡献 → 本文 `Phi` 的坐标全部是贡献；若外部只有面板值，必须先做 `g_i = P_i - o_i`（逐属性偏移不同，不能统一平移）。

### 13.3 逐命题判定表

| 命题 | 依赖的坐标 | 是否受 baseStat 影响 | 判定 |
| --- | --- | --- | --- |
| 定理 1 屏障/乘积 | `x`、`B`、`l` 为贡献 | 是（若用面板会整体偏移） | 成立；`B` 必须是同坐标域的下界 |
| 定理 2 `c^opt`/maximizer | 贡献 | 是 | 成立；`c^opt` 是贡献阈值，面板阈值 = `o_i + c_i^opt` |
| 定理 3 `l^cap` | 贡献 | 是 | 成立；一元式比较在贡献坐标 |
| 定理 4 `T`/`M` | 贡献；`M` 为乘积 | 是 | 成立；`M` 与 `OPT` 都是贡献乘积 |
| 定理 5/8 语义 | 同上 | 是 | 成立 |
| 定理 6 组合 | 贡献 + 子域定义 | 是 | 成立；slab 的 `Smax` 也是贡献和 |
| 定理 7 完整因子 | `Phi` 贡献；`q/g` 为另一坐标系 | 均需独立认证 | 成立（条件）；`q/g` 与面板/贡献无关 |
| §13 换算 | — | — | 见下 |

结论：**没有任何命题需要因 baseStat 改写**；需要的是运行时把面板值换算为贡献、并保证 `B/κ` 来自同一贡献坐标域。

### 13.4 数值复核（贡献 vs 面板）

| 量 | 贡献坐标 | 面板等价（level 100 普通职业） |
| --- | --- | --- |
| `(0,0,0)` | `Phi=4,080,000,000,000` | 面板 = `(420,420,440)` |
| `κ=(100,100,100)` | `OPT=4,132,797,964,905` | 面板 = `(520,520,540)` |
| `c^opt=(98,97,100)` | `Phi=OPT` | 面板 = `(518,517,540)` |
| slab `Smax=150` | 贡献和 ≤150 | 面板和 ≤ `150+420+420+440=1,430` |

坐标混用反例（与 [free-budget-upper-bound](../free-budget-upper-bound/README.md) §13 一致）：面板 `(620,620,640)` 若被当作贡献传入，会把 `C=620` 解释成贡献 → 档位/因子整体偏离；本文全部实例与 verify.mjs 都在贡献坐标上计算，且 `Phi(0)`、`OPT` 等数值均已与贡献坐标核对。

### 13.5 应用契约（面板 → 贡献）

```text
b_i = P_i^0 - o_i          （baseline 贡献；o_CRT=o_DHT=sub，o_DET=main）
x_i = P_i - P_i^0          （增量；偏移抵消）
B   必须是贡献坐标的 Phi 下界（由可达点/证明给出）
κ_i 是贡献上界（不是面板上限）
```

若只有面板值：先逐属性减偏移得到贡献，再计算 `Phi/l/(T)`；面板总和与贡献总和差常数 `(sub+sub+main)`（同等级职业），紧致性排序不变。

### 13.6 结论

- **是否受影响**：**不受影响**。本文全部定理、例子与数值定义在贡献坐标；经审计无面板/贡献混用。
- **审计边界**：本文只覆盖 CRT/DHT/DET；TEN、面板其它属性不在 `Phi` 内。
