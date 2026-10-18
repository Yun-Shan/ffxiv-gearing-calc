# 自由资源预算上界 `U(b,R,κ)` 的精确档位三元组刻画

## 1. 标题与状态

- **目录**：`docs/mathematical-analysis/theorems/free-budget-upper-bound/`
- **状态**：**已证明**（定理 1–3、推论 A–D 的数学部分）。有限网格验证证书见 [verify.mjs](verify.mjs)。
- **否证性结论**（不属于本文，只作关联）：三顶点公式 `U = max(三个顶点)` 与 boundary-only 归约**已否证**，反例与证明见 [simplex-vertex-reduction](../simplex-vertex-reduction/README.md)。本文只证明「顶点值是 `U` 的下界」（推论 B），**不**主张两者相等。
- **不涉及**：真实装备候选池、materia/food 组合、搜索、MIP、性能评估。本文只研究公式坐标上的自由资源松弛。

## 2. 范围与依据

本文研究 [Issue #3](../../issue-3-body.md) **证明目标 3** 中定义的 baseline-aware 自由资源上界：

```text
U(C0,H0,D0,R) = max F(C0+c, H0+h, D0+d)
                s.t. c,h,d >= 0, c+h+d <= R
```

并落实 [评论 01 新优先级 3](../../issue-3-comment-01.md)（不要把三顶点公式当作既定实现，先证可降维条件）与 [评论 02 §五](../../issue-3-comment-02.md)（固定等级定理 C：三属性自由预算 simplex 的降维条件；禁止未经证明直接写三顶点公式）的要求。评论 02 §五 要求的「参数化条件定理」在本文中以**不受条件限制的精确公式**形式给出：不需要任何 baseline/区间前提，`U` 恒等于档位三元组的有限预算极值。

权威事实基础：

1. [canonical-evaluator-reference.md](../../canonical-evaluator-reference.md)：等级参数、整数档位模型、精确因子、定义域与截断语义（本文简称「参考文档」）。
2. 源码：
   - `src/domain/search/equipped-effects.ts:110-154`（`equippedAttributeTier`）、`:163-166`（`floor = Math.trunc(v+1e-7)`）；
   - `src/domain/search/equipped-effects.ts:59-104`（`createIntegerDamageFactorEvaluator`，因子公式 `:95-98`）；
   - `src/domain/search/substat-factor-budget.ts:71-171`（`prepareSubstatFactorBudgetQuery`，档位三元组精确预算查询）；
   - `src/domain/search/factor-resource-budget-upper-bound.ts:88-147`（单资源 Lagrangian 上界，回退用）；
   - `src/domain/search/exact-mip-candidate-upper-bound.ts:96-140`（精确乘积与比较语义）。
3. Issue 正文与评论只作背景；与源码不一致处以源码与参考文档为准（参考文档 §7 已登记差异）。

本文的定理是**公式级**的：结论只依赖等级参数、档位公式、因子公式与定义域，不依赖任何装备池；`b`、`R`、`κ` 是运行时输入。

## 3. 符号、量词与定义域

以下记号与参考文档一致；所有数学对象都是整数或整数值函数。

**属性集合**。`I = {C, H, D}` 分别对应 CRT、DHT、DET。`level ∈ {50,60,70,80,90,100}`（参考文档 §2 的全部支持等级）；`job` 只通过「是否 BLU」影响公式（`b_C = 350` 或 `150`，CRT/DHT 档位常数偏移，参考文档 §5），因此公式层面只需区分「普通」与「BLU」两类。

**贡献域**。`g ∈ Z_{>= 0}` 表示装备与食物带来的属性贡献；当前候选模型保证 `g >= 0`，且 `g <= G_max`（运行时输入，见参考文档 §5）。本文所有量词都限定在 `g >= 0` 上；负贡献不在定义域内（参考文档 §3.1 说明 `Math.trunc(v+1e-7)` 与精确 floor 在负值域不等价）。

**档位函数**。按参考文档 §3：

```text
t_i(g) = c_i + m_i * floor((a_i * g + b_i) / q_i)
```

其中 `(a_i, q_i) > 0`、`m_i >= 1` 为整数；`t_i: Z_{>=0} -> Z` **非减**，且是阶梯函数（在档位阈值处跳变）。

**因子函数**。参考文档 §4：

```text
F_C(t) = 1_000_000 + t * (t + b_C)     b_C = 350（普通）或 150（BLU）
F_H(t) = 4_000 + t
F_D(t) = t
f_i(g) = F_i(t_i(g))
```

在档位域（`t_C >= 50` 或 BLU 的 `>= 250`；`t_H >= 0` 或 BLU 的 `>= 200`；`t_D >= 1000`）上 `F_C, F_H, F_D` 都是**严格递增的正整数函数**（证明见 §6 引理 0）。`f_i = F_i ∘ t_i` 因此非减，且在每个档位阈值处严格增。

**定义域参数**。

```text
baseline  b = (C0, H0, D0) ∈ Z_{>=0}^3        （档位输入贡献坐标，不是面板总值；见 §13）
budget    R ∈ Z_{>=0}                          （贡献增量预算，与面板偏移无关）
caps      κ = (κ_C, κ_H, κ_D) ∈ (Z_{>=0} ∪ {+∞})^3   （贡献增量上限）
K = κ_C + κ_H + κ_D ∈ Z_{>=0} ∪ {+∞}                （约定 +∞ + 任意 = +∞）
S* = min(R, K)
```

**可行分配与 `U`**：

```text
A(b,R,κ) = { (c,h,d) ∈ Z^3 : c,h,d >= 0, c+h+d <= R,
                              c <= κ_C, h <= κ_H, d <= κ_D }
U(b,R,κ) = max_{x ∈ A(b,R,κ)} Π_i f_i(b_i + x_i)
```

（`Π_i` 遍历 `i ∈ {C,H,D}`；下面用 `P(b) = Π_i f_i(b_i)` 表示零预算值。）

**档位阈值与档位费用**。对属性 `i`、档位 `t ∈ Z`：

```text
γ_i(t) = min { g ∈ Z_{>=0} : t_i(g) >= t }      （t >= t_i(0) 时存在；t <= t_i(0) 时取 0）
θ_i(t) = max(0, γ_i(t) - b_i)                    （从 baseline b_i 达到「档位 >= t」的最小成本）
```

**可达档位集合**（含 cap 与预算的有效区间）：

```text
T_i(b_i, κ_i, R) = { t ∈ Z : t_i(b_i) <= t <= t_i(b_i + min(κ_i, R)) }
```

约定 `min(+∞, R) = R`。当 `κ_i = +∞` 时 `T_i` 的上界由 `R` 给出，这不是额外假设：`θ_i(t) <= R` 必然推出 `γ_i(t) <= b_i + R`，从而 `t <= t_i(b_i + R)`（§6 引理 3）。

**满预算**。本文称分配 `x` 为满预算的，若 `Σ_i x_i = S* = min(R,K)`（注意：不是 `R`；见定理 2）。

## 4. 假设

- **(A1) canonical 档位模型**：`t_i` 取参考文档 §3 的整数公式，等级参数取参考文档 §2 的六档之一；`t_i` 非减、阶梯，且在 `g >= 0` 上 canonical evaluator 的 `Math.trunc(v+1e-7)` 与精确 floor 一致（参考文档 §3.1；等价性证明见 [raw-tier-transform](../raw-tier-transform/README.md)）。
- **(A2) 因子正性与严格单调**：在档位域上 `F_C, F_H, F_D` 为正整数函数且严格递增（§6 引理 0 给出代数证明；档位域下界由参考文档 §5 保证）。若运行时出现非正因子或档位越界，本文所有结论不适用，必须走安全回退（§10）。
- **(A3) 整数域**：`g`、档位、因子、`b`、`R`、`κ` 均为安全整数；乘积必须用 `BigInt` 精确计算，不使用浮点。
- **(A4) 自由资源松弛**：`A(b,R,κ)` 允许把预算在三个属性间任意拆分，只保留「总和 <= R」与「逐属性 cap」两类约束。它**忽略**真实装备的槽位、共享装备、食物百分比、同步属性上限等耦合，因此是真实装备可行域的**超集**（comment 02 §一）。这是 `U` 可以作为安全上界的全部理由。
- **(A5) 运行时可证明性**：`b`、`R`、`κ` 必须由运行时输入以「已证明的界」给出（§10 的 P1–P4）。数学定理本身不保证任意传入的数值是安全的乐观界。
- **(A6) job 只区分两类**：公式层面普通职业同公式；BLU 只改变 `b_C`、CRT/DHT 档位常数与 `+200` 偏移。武器伤害、主属性、TEN、GCD、特性倍率属于完整伤害的其它乘区，不在 `U` 内（§10 处理）。

## 5. 精确命题

### 定理 1（良定义、单调性与阶跃性）

对任意满足 §3 定义域的 `b, R, κ`：

1. **良定义**：`A(b,R,κ)` 是非空有限集，`U(b,R,κ)` 存在且是正整数。
2. **零预算值**：`U(b,0,κ) = P(b) = Π_i F_i(t_i(b_i))`。
3. **单调性**：`U` 对 `R` 非减；对每个 `b_i` 非减；对每个 `κ_i` 非减。
4. **阶跃性**：`R ↦ U(b,R,κ)` 是非减整数值阶梯函数。其跳变点（满足 `U(b,R,κ) > U(b,R-1,κ)` 的 `R`）必可写成

   ```text
   R = θ_C(t_C) + θ_H(t_H) + θ_D(t_D)
   ```

   对某个 `t_i ∈ Z`。在任意有限前缀 `R ∈ [0, R_max]` 上只有有限个跳变；若全部 `κ_i` 有限，则全局只有有限个跳变（因为可达的因子三元组只有有限多个）。

### 定理 2（满预算最优解的存在性）

1. **无 cap**（`κ = (+∞,+∞,+∞)`，即 `K = +∞`）：存在最优分配满足 `c + h + d = R`。
2. **有 cap**：存在最优分配满足 `c + h + d = S* = min(R, K)`。若 `K` 有限且 `R >= K`（**caps 之和是约束瓶颈**的区间），则 `(κ_C,κ_H,κ_D)` 本身是最优解（它逐坐标支配所有可行点），且此时 `S* = K`。
3. **满预算不等于「任意最优解都用满」**：定理只断言**存在**一个满预算最优解；平台（推论 C）会让某些最优解留在更低总成本上。

### 定理 3（精确档位三元组预算公式，本文主定理）

在 §3–§4 的假设下，**恒有精确等式**

```text
U(b,R,κ) = max { Π_i F_i(t_i)
               : t_i ∈ T_i(b_i,κ_i,R)（i = C,H,D），
                 θ_C(t_C) + θ_H(t_H) + θ_D(t_D) <= R }
```

等式是精确的（既不是仅上界也不是仅下界），并且：

- 右边的可行三元组集合有限、非空（取 `t_i = t_i(b_i)` 时 `θ_i = 0`）；
- `T_i` 可以用整数区间表示而**不需要**只列出「实际被 `t_i` 取到的档位」：未被取到的档位与下一个被取到的档位费用相同（`γ` 相同）而因子更小，因此不改变最大值（§6 引理 2）；
- DET 的 `detTrunc > 1` 情形自动被覆盖：`t_DET` 只取 `detTrunc` 的倍数，非倍数档位与下一个倍数档位同费用、更小因子，被支配。等级 50（`detTrunc = 5`）与等级 60（`detTrunc = 2`）实际触发该情形。

### 推论 A（与生产查询的精确对应）

令 `L_i = { (min: θ_i(t), value: F_i(t)) : t ∈ T_i(b_i,κ_i,R) }`（三个 `SubstatFactorClass` 列表，**CRT、DET、DHT 的顺序**）。`prepareSubstatFactorBudgetQuery(L_C, L_D, L_H)`（`src/domain/search/substat-factor-budget.ts:71-171`）返回的函数在预算 `R` 处返回的 `product` 恰好等于定理 3 的右端，因此**精确等于 `U(b,R,κ)`**。

- 预处理：`|L_C| * |L_D|` 个配对（`cost = min_C + min_D`，`product = value_C * value_D`），按 `cost` 排序后做前缀最大值（`:91-120`）。
- 查询：枚举每个 DHT 档位，二分查找满足 `pair.cost <= R - dht.min` 的最大前缀，取前缀最大乘积再乘 DHT 因子并取全局最大（`:128-159`）。
- 复杂度：预处理 `O(P log P + C)`（`P = |L_C||L_D|`，`C` 为三类档位总数），每次查询 `O(|L_H| log P)`；与三维枚举 `Θ(|L_C||L_H||L_D|)` 相比是精确的降维。
- 返回 `undefined` 的三种情况（预算非法、类非法、`maxWork` 不足）都表示**该层不可用**，调用方必须回退，不能解释为「没有候选」（§10）。

### 推论 B（顶点公式只是下界）

记 caps 受限的「顶点集合」

```text
V(b,R,κ) = { (min(κ_C,R),0,0), (0,min(κ_H,R),0), (0,0,min(κ_D,R)) } ⊂ A(b,R,κ)
```

则

```text
U(b,R,κ) >= max_{v ∈ V(b,R,κ)} Π_i f_i(b_i + v_i)
```

因为每个 `v` 都是可行分配。等式**不**成立（全文）；无条件三顶点公式已被 [simplex-vertex-reduction](../simplex-vertex-reduction/README.md) 用精确反例否证，例如 `level = 100`、WHM、`b = (200,200,200)`、`R = 610` 时

```text
U = 4,315,825,466,400  >  三顶点最大 = 4,312,925,593,600
```

### 推论 C（预算可以被浪费：平台与饱和）

1. `f_i` 在每个档位平台内是常数，因此 `U(R)` 存在大量平台区间；大多数 `R` 上 `U(R) = U(R')`（`R' < R`）。
2. 例：`level = 100`、普通职业、`b = (0,0,0)` 时三个属性的首个跳档成本分别为 `θ_C = 14`、`θ_H = 6`、`θ_D = 20`（由阈值公式算出，见 [verify.mjs](verify.mjs) 的 T/C 段）。于是 `R = 0,1,2,3,4,5` 时任何坐标都无法使档位变化，`U(R) = U(0) = P(b)`；`R = 6` 才发生 DHT 跳档。
3. 「满预算最优」与「预算被浪费」并不矛盾：`R = 5` 时 `(5,0,0)` 是满预算最优解，但它把 5 点预算全部花在 CRT 的平台内，因子与 `R = 0` 完全相同。定理 2 保证的是「存在一个用满预算的最优解」，不保证这个解把预算花在产生档位变化的地方。
4. 饱和：有限 caps 下存在最小总成本 `R_sat = Σ_i θ_i(t_i(b_i + κ_i))`，当 `R >= R_sat` 时 `U(R)` 恒等于 caps 点的乘积（推论 D）。`R_sat` 可以严格小于 `K = Σκ_i`（平台导致）。

### 推论 D（整数域、有效区间与定义域边界）

1. 所有量（档位、阈值、费用、因子、乘积、`U`）都是整数；`U` 必须用 `BigInt` 精确比较（`U` 可超过 `Number.MAX_SAFE_INTEGER`，生产查询内部即用 `BigInt`）。
2. **有效档位区间**：在 `U(b,R,κ)` 中出现的档位恰在 `[t_i(b_i), t_i(b_i + min(κ_i,R))]` 内；区间外的档位不会出现（`c_i <= min(κ_i,R)`）。
3. **饱和**：若全部 `κ_i` 有限，令 `R_sat = Σ_i θ_i(t_i(b_i+κ_i))`；则对所有 `R >= R_sat`，`U(b,R,κ) = Π_i F_i(t_i(b_i+κ_i))`（与 `R` 无关）。
4. **负预算**：`R < 0` 时 `A` 为空，`U` 无定义；生产查询对负预算与非法输入显式返回 `undefined`（`substat-factor-budget.ts:128-130`）。
5. **正性**：在定义域内 `F_C >= 1_000_000`、`F_H >= 4_000`、`F_D >= 1_000`（DET 档位下界 1000），故乘积严格为正、比较语义稳定。

## 6. 证明

### 引理 0（档位非减、因子为正且严格增）

- `t_i(g) = c_i + m_i·floor((a_i g + b_i)/q_i)`，其中 `a_i > 0, q_i > 0, m_i >= 1`。`g` 增大时被 floor 的线性函数非减，floor 非减，乘以正 `m_i` 再加常数，故 `t_i` 非减。
- `F_C(t+1) - F_C(t) = 2t + b_C + 1 > 0` 对 `t >= 0`、`b_C ∈ {150,350}` 成立；`F_H(t+1)-F_H(t) = 1 > 0`；`F_D(t+1)-F_D(t) = 1 > 0`。故在任意整数档位上三者都严格递增。
- 档位域：CRT 档位 `t_C >= 50`（BLU 为 `>= 250`），`F_C >= 10^6`；DHT 档位 `t_H >= 0`，`F_H >= 4000`；DET 档位 `t_D >= 1000`，`F_D >= 1000`。三者都是正整数。

**引理 1（阈值的性质）**。对 `t >= t_i(0)`，`γ_i(t)` 存在、非负、关于 `t` 非减，且满足 `t_i(γ_i(t)) >= t`，并且 `γ_i(t) = 0` 或 `t_i(γ_i(t)-1) < t`（最小性）。证明：`t_i` 取整数值且非减；集合 `{g >= 0 : t_i(g) >= t}` 非空（取充分大的 `g`，或 `t <= t_i(0)` 时取 `g=0`），是 `Z_{>=0}` 的非空子集，故有最小元；`t` 增大时约束变强，最小元非减；最小性由「最小元减 1 不属于集合」直接得到。∎

**引理 2（未取到的档位被下一个取到的档位支配）**。若整数档位 `t` 不被 `t_i` 取到，令 `t' = min{ t'' >= t : t'' 在 t_i 的值域中 }`。则对所有 `g`：`t_i(g) >= t ⇔ t_i(g) >= t'`，故 `γ_i(t) = γ_i(t')`、`θ_i(t) = θ_i(t')`，而 `F_i(t) < F_i(t')`。特别地，`T_i` 中这类档位不会成为最大值来源。证明：`t_i(g)` 是整数，若 `t_i(g) >= t` 且 `t_i(g)` 在值域中，则 `t_i(g) >= t'`；反之显然。∎

**引理 3（费用不超过实际分配）**。对 `i`、`b_i >= 0`、`c >= 0`：`θ_i(t_i(b_i+c)) <= c`。证明：`g = b_i + c` 满足 `t_i(g) = t_i(b_i+c) >= t_i(b_i+c)`，故 `γ_i(t_i(b_i+c)) <= b_i + c`；于是 `θ_i = max(0, γ_i - b_i) <= c`。∎

**引理 4（费用可实现）**。若 `t ∈ T_i(b_i,κ_i,R)` 且 `θ_i(t) <= R`，置 `c_i = θ_i(t)`。则：

- `c_i >= 0` 是整数；
- `c_i <= κ_i`：若 `κ_i = +∞` 无需证；否则由 `t <= t_i(b_i+κ_i)` 得 `γ_i(t) <= b_i + κ_i`，故 `θ_i(t) = max(0, γ_i - b_i) <= κ_i`；
- `t_i(b_i + c_i) >= t`：若 `θ_i = γ_i - b_i > 0`，则 `b_i + c_i = γ_i(t)`，由引理 1 直接得；若 `θ_i = 0`，则 `γ_i(t) <= b_i`，由 `t_i` 非减得 `t_i(b_i) >= t_i(γ_i(t)) >= t`；又 `t >= t_i(b_i)`（因为 `t ∈ T_i`），故 `t = t_i(b_i) = t_i(b_i + c_i)`。∎

### 定理 1 的证明

(1) 由 `c <= min(κ_C,R) <= R` 等，`A ⊆ [0,R]^3 ∩ Z^3` 是有限集；`(0,0,0) ∈ A`（`b_i`、`κ_i`、`R` 均非负），故非空。乘积是有限个整数的乘积，最大值存在；由引理 0 每个因子是正整数，故 `U > 0`。

(2) `R = 0` 时 `c+h+d <= 0` 且各项非负，唯一可行点是原点，取值 `Π_i f_i(b_i) = P(b)`；cap 不影响原点可行性。

(3) 单调性：

- 对 `R`：若 `R_1 <= R_2`，则 `A(b,R_1,κ) ⊆ A(b,R_2,κ)`，在同一有限集上取 max 非减。
- 对 `b_i`：固定其余坐标，`f_i` 非减（引理 0），故对每个可行分配 `x ∈ A(b,R,κ)`，把 `b_i` 增大后同一 `x` 仍可行且目标值不降；因此 max 不降。
- 对 `κ_i`：增大 cap 只扩大可行集。

(4) 阶跃性：`R` 取整数值，`U` 非减且整数值，故为阶梯函数。分两种情形：

- 若 `R > K`（`K` 有限），则 `A(b,R,κ) = A(b,K,κ)`（总成本自动 `<= K`），故 `U(R) = U(K)`，`R` 处不可能跳变。因此跳变只能发生在 `R <= K`（含 `K = +∞`）的区间，此时 `S* = R`，由定理 2 存在满预算（总成本恰为 `R`）最优分配 `x`。
- 设 `R <= K` 且 `U(R) > U(R-1)`。取上述满预算最优分配 `x`，令 `t_i = t_i(b_i + x_i)`。则 `Π_i F_i(t_i) = U(R)`，且由引理 3 有 `θ_i(t_i) <= x_i`，故 `Σθ_i <= Σx_i = R`。若 `Σθ_i <= R-1`，则用 `c_i' = θ_i(t_i)` 构造分配：由引理 4，它满足 `c_i' <= κ_i` 且总成本 `<= R-1`，并且在 `R-1` 处可行；由引理 4 的 `t_i(b_i + c_i') >= t_i` 与引理 0 得目标值 `>= Π_i F_i(t_i) = U(R)`。于是 `U(R-1) >= U(R)`，与单调性一起给出 `U(R-1) = U(R)`，矛盾。故 `Σθ_i = R`，即跳变点必为三个档位费用之和。

有限跳变：在 `[0,R_max]` 内，满足 `Σθ_i <= R_max` 的档位三元组只有有限多个（每个 `θ_i` 非减，故每个 `t_i` 落在有限区间内），每个三元组最多贡献一个跳变值 `Σθ_i`，故跳变集合有限。若全部 `κ_i` 有限，则所有可行分配的档位三维组落在一个有限 box 内，可能的目标值只有有限多个，故全局跳变有限。∎

### 定理 2 的证明

记 `S* = min(R,K)`。

(1) 无 cap（`K = +∞`，`S* = R`）：取任一最优分配 `x`，`σ = Σx_i`。若 `σ = R` 已证。若 `σ < R`，令 `δ = R - σ > 0`，把 `δ` 加到任一坐标（例如 CRT）：`x' = (c+δ,h,d)`。无 cap 可行性显然；`f_C(b_C + c + δ) >= f_C(b_C + c)`（引理 0 非减），其余因子不变，故 `x'` 仍最优且总成本为 `R`。

(2) 有 cap：先证存在最优解总成本为 `S*`。任取最优解 `x`，反复执行：

```text
若 Σx_i = S*：结束。
否则 room_i = κ_i - x_i ∈ Z_{>=0} ∪ {+∞}，且 Σ room_i = K - Σx_i > 0
（Σx_i < S* <= K 保证严格为正；若某 κ_i = +∞ 则该项为 +∞）。
取任一 room_i > 0 的坐标，令 δ = min(room_i, S* - Σx_i) >= 1，
把 x_i 增加 δ。
```

每步都保持可行（`x_i + δ <= κ_i` 且总成本 `<= S*`）且不降低目标值（引理 0）。总成本是整数，严格增加且以 `S*` 为上界，故有限步后必到达 `Σx_i = S*`；所得分配仍最优，即为所求。

若 `K` 有限且 `R >= K`：`S* = K`，且 `(κ_C,κ_H,κ_D) ∈ A(b,R,κ)`（总成本 `K <= R`，逐坐标等于 cap）。对任意可行 `x` 有 `x_i <= κ_i`，再由 `f_i` 非减得 `Π_i f_i(b_i+x_i) <= Π_i f_i(b_i+κ_i)`，故 caps 点是最优解。∎

**注意**：当 `R > K` 时不存在总成本为 `R` 的可行分配（sum 被 caps 限制在 `K`），所以定理 2 的「满预算」只能是 `S* = K`。这正是「caps 之和成为瓶颈」的区间。

### 定理 3 的证明

记右端为 `M(b,R,κ)`。先说明右端有限非空：`t_i = t_i(b_i)` 属于 `T_i` 且 `θ_i = 0`（`γ_i(t_i(b_i)) <= b_i`），故可行。由 §3，`T_i` 的上界是 `t_i(b_i + min(κ_i,R))`，有限（即使 `κ_i = +∞` 也被 `R` 约束）。

**(<=) 任一可行分配的目标值 <= M。** 取 `x ∈ A(b,R,κ)`，令 `t_i = t_i(b_i + x_i)`。因 `x_i <= min(κ_i,R)`、`t_i` 非减，`t_i <= t_i(b_i + min(κ_i,R))`；又 `t_i >= t_i(b_i)`，故 `t_i ∈ T_i`。由引理 3，`θ_i(t_i) <= x_i`，故 `Σθ_i <= Σx_i <= R`。于是该三元组是右端的可行三元组，且右端值 `Π_i F_i(t_i)` 恰等于该分配的目标值。对 `x` 取 max 得 `U <= M`。

**(>=) M 的任一可行三元组值 <= U。** 取三元组 `(t_C,t_H,t_D)`，`t_i ∈ T_i`，`Σθ_i <= R`。令 `c_i = θ_i(t_i)`。由引理 4：`c_i >= 0`、`c_i <= κ_i`、`Σc_i = Σθ_i <= R`，故 `c = (c_C,c_H,c_D) ∈ A(b,R,κ)`；并且 `t_i(b_i+c_i) >= t_i`，由引理 0（`F_i` 在档位域上严格增）得 `f_i(b_i+c_i) = F_i(t_i(b_i+c_i)) >= F_i(t_i)`。于是该分配的目标值 `>= Π_i F_i(t_i)`。对三元组取 max 得 `U >= M`。

两方向合并得 `U = M`。**关于未取到的档位**：若最优三元组中某 `t_i` 未被取到，由引理 2 换成下一个被取到的档位 `t_i' >= t_i`：`θ_i` 不变、`F_i` 更大，仍可行，故存在最优三元组只取实际达到的档位；这就是为什么「整数区间表示」与「实际档位集合」给出同一个最大值。**关于 DET**：`t_DET(g) = detTrunc·floor(...)` 只取 `detTrunc` 的倍数；若 `t` 不是倍数，令 `t' = detTrunc·ceil(t/detTrunc)`，则对任意 `g`：`t_DET(g) >= t ⇔ detTrunc·floor(...) >= t ⇔ floor(...) >= ceil(t/detTrunc) ⇔ t_DET(g) >= t'`，故 `γ_D(t) = γ_D(t')`、`θ_D(t) = θ_D(t')`，而 `F_D(t) = t < t' = F_D(t')`。因此非倍数档位被支配，不影响等式；把 `T_D` 换成「`detTrunc` 倍数的档位」也成立。∎

### 推论 A 的证明

先说明 `M` 与生产查询的对应。`L_C, L_D, L_H` 的每个元素是 `(min, value) = (θ_i(t), F_i(t))`。生产查询：

1. 枚举全部 CRT×DET 配对，记录 `cost = min_C + min_D`、`product = value_C·value_D`，按 `cost` 排序，构造「按 cost 升序的前缀最大 product」数组（`:91-120`）。
2. 对每个 DHT 类（`min_H <= R`）：在排序数组中二分出 `cost <= R - min_H` 的最大前缀（`:136-143`），取该前缀的最大 product 乘以 `value_H`（`:145-146`），再对所有 DHT 类取最大（`:147-154`）。

固定 DHT 类后，「`min_C + min_D <= R - min_H` 下的最大 `value_C·value_D`」正是该前缀最大 product（所有值都是正 BigInt，因此前缀最大就是约束集合上的最大；`:108-120` 的前缀数组对每个 cost 前缀保存最大 product，二分得到最大的可行 cost 前缀）。再乘正常数 `value_H` 后对 DHT 类取 max，恰好是

```text
max { value_C·value_D·value_H : min_C + min_D + min_H <= R }
= max { Π_i F_i(t_i) : Σ_i θ_i(t_i) <= R } = M(b,R,κ) = U(b,R,κ)。
```

细节：`dht.value === 0n` 时实现改用 `prefixEarliest` 只为 tie-break（`:145`），在本文正因子域内不触发；返回值中的 `crtIndex/detIndex/dhtIndex` 是取值索引（`:147-154` 的 tie-break 只影响索引，不影响 `product`）。`cost` 的加法是整数加法，对应自由资源松弛的「费用可加」定义（参考文档 §6.2）。若 `maxWork` 不足、类非法或预算非法，函数返回 `undefined`（`:77-89,128-130`），对应本层不可用，调用方回退（§10）。∎

### 推论 B 的证明

`v = (min(κ_C,R),0,0)`：坐标非负、`≤ κ_C`、`≤ R`，故 `v ∈ A`；其余两个同理。因此 `U` 作为 `A` 上的 max 不小于这三个点的值。严格不等由反例给出（[simplex-vertex-reduction](../simplex-vertex-reduction/README.md) 定理 1；数值复算见本目录 verify.mjs 的 B 段与本目录 §7）。∎

### 推论 C 的证明

(1) 每个 `f_i` 在 `t_i` 的同一取值区间上为常数（`F_i` 只依赖档位）。`U(R)` 是阶梯函数（定理 1(4)），故平台普遍存在。

(2) `level = 100`（`div = 2780`）、普通职业：CRT 档位 `t_C(g) = floor(200g/2780)+50`，从 `g=0` 到 `g=13` 保持 `t_C = 50`；`g = 14` 起为 51（`200·14 = 2800 >= 2780`）。DHT 档位 `t_H(g) = floor(550g/2780)`，`g = 0..5` 为 0，`g = 6` 起为 1（`550·6 = 3300 >= 2780`）。DET 档位 `t_D(g) = floor((140g + 2,780,000)/2780)`，`g = 0..19` 为 1000，`g = 20` 起为 1001（`140·20 = 2800 >= 2780`）。因此 `R <= 5` 时任何可行分配的三个坐标都 `< 6 <= min(14,6,20)`，档位与 `R=0` 相同，`U(R) = U(0)`；`R = 6` 时把 6 点全部给 DHT 得到档位 `t_H = 1`，因子严格增大，故 `U(6) > U(5)`。

(3) 同例 `R = 5`：`(5,0,0) ∈ A` 且总成本 5 = R，是满预算点；其档位与 `(0,0,0)` 相同，目标值 `= U(0) = U(5)`，故它是最优解但预算没有产生任何档位变化。

(4) 饱和：设 `κ` 有限，`R >= R_sat = Σθ_i(t_i(b_i+κ_i))`。caps 点 `(κ_C,κ_H,κ_D)` 是逐坐标最大点，其目标值 `P_caps = Π_i F_i(t_i(b_i+κ_i))` 是任意可行点的上界；另一方面该三元组满足 `Σθ_i = R_sat <= R`，由定理 3 是可行三元组，从而 `U >= P_caps`。故 `U = P_caps` 对所有 `R >= R_sat` 成立。∎

### 推论 D 的证明

(1) 直接来自 §3 的整数定义与 `BigInt` 精确乘法（`exact-mip-candidate-upper-bound.ts:108-111`）。

(2) 对任意 `x ∈ A`，`x_i <= κ_i` 且 `x_i <= Σx_j <= R`，故 `b_i + x_i <= b_i + min(κ_i,R)`；`t_i` 非减，故档位落在区间内；反向，区间内每个档位都在 `T_i` 的定义中，由定理 3 的构造可达（在预算足够时）。

(3) 见推论 C(4) 的证明。

(4) `R < 0` 时 `c,h,d >= 0` 且 `c+h+d <= R < 0` 不可能，`A = ∅`，max 无定义；生产查询对 `budget < 0` 或非安全整数返回 `undefined`（`substat-factor-budget.ts:128-130`）。

(5) 正性由引理 0 与档位域下界给出。∎

## 7. 反例与边界退化

1. **顶点公式不是等式**（否证，详见 [simplex-vertex-reduction](../simplex-vertex-reduction/README.md)）：`level = 100`、WHM、`b = (200,200,200)`、`R = 610` 时，内部点 `(c,h,d) = (9,245,356)` 的乘积 `4,315,825,466,400` 严格大于三顶点最大值 `4,312,925,593,600`（差 `2,899,872,800`，约 `6.72 bp`）。本目录 verify.mjs 的 B 段在有限网格上复核了「`U >=` 顶点最大」且存在严格不等。
2. **boundary-only 归约也被否证**：上例的全局最优三个坐标全部为正，且严格大于边界最大 `4,315,707,397,760`（差 `118,068,640`，约 `27 ppm`）。因此「把预算推到某一坐标为 0 的边界」在无条件下不成立。
3. **`R = 0` / `κ_i = 0` 退化**：`R = 0` 时 `U = P(b)`；`κ_i = 0` 时 `x_i` 只能是 0，问题降为另外两个属性的二维问题。定理 3 的公式在这些退化情形下仍然成立（`T_i` 退化为单点 `{t_i(b_i)}`）。
4. **caps 瓶颈退化**：`R >= K`（`K` 有限）时最优解退化为 caps 点，定理 2(2)。此时 `U` 关于 `R` 饱和。
5. **DET 的 `detTrunc` 粒度**：等级 50、60 的 DET 档位只取 `5`、`2` 的倍数。若忽略该粒度、把档位当连续整数，会高估 `U`；定理 3 已证明非倍数档位被支配，因此正确做法是保留整数区间或只保留倍数——两者给出同一最大值。
6. **负贡献越界**：`g < 0` 不在定义域；此时 canonical 的 `Math.trunc(v+1e-7)` 与精确 floor 不等价（参考文档 §3.1）。任何把定义域扩到负值的「定理」都不成立，本文不主张。正式候选路径的贡献与档位实参恒非负（参考文档 §2.2），故该越界不可达。
7. **自由松弛本身不是反例，但必须记住它是超集**：`U` 可能显著高于真实装备可行域的最优值；这不是定理错误，而是上界应有的保守性。剪枝只依赖「真实解 ⊆ 松弛」，不依赖松弛紧致（§10）。

## 8. 依赖与关联定理

**本文依赖**：

- 档位模型与阈值/周期/单调性：[raw-tier-transform](../raw-tier-transform/README.md)（`t_i` 非减、阈值公式、跳档成本、周期结构）。本文只用到其中「非减 + 阈值存在」与参考文档 §3 的公式。
- 因子正性与（如需要）离散凸凹性质：[tier-log-curvature](../tier-log-curvature/README.md)。本文的定理**不需要**凸凹性；凸凹性只在更精细的边际/降维定理中使用。
- 精确乘积与比较语义：[exact-mip-candidate-upper-bound.ts:96-140]（§9、§10）。

**本文被谁使用**：

- [simplex-vertex-reduction](../simplex-vertex-reduction/README.md)：其定理 4（无顶点假设的安全回退）直接引用本文定理 3 作为精确 fallback；其部分归约的二维切片最大值需要 [pairwise-slice-critical-set](../pairwise-slice-critical-set/README.md) 的有限关键点结论。
- 任何未来的「Level 1 基线感知自由资源上界」候选剪枝都必须以本文定理 3 或其推论 A 为数学依据（本仓库当前**尚未**把 `U` 接入生产搜索；`prepareSubstatFactorBudgetQuery` 目前只在测试中使用，见 §9）。

**平行/相邻结论**：

- [pairwise-endpoint-max](../pairwise-endpoint-max/README.md)：两属性定和切片的端点最大猜想（已有大量精确反例；它与本文的顶点降维直接相关）。
- [marginal-comparison](../marginal-comparison/README.md)：单位预算边际比较的正确形式；本文不依赖它。
- 单资源 Lagrangian 上界 `prepareFactorResourceBudgetUpperBound`（`factor-resource-budget-upper-bound.ts:88-147`）：与本文不同，它对「每个因子独立」的可加对数得分构造上凸包/支撑线上界；它是**另一个**（通常更松的）安全上界，可作为本文查询不可用时的回退。两者不能混用语义（一个用整数因子乘积，一个用整数对数得分）。
- 联合单职业必要界 `joint-candidate-upper-bound.ts:10-22`：不同层级，本文不涉及。
- [substat-sum-upper-bound](../substat-sum-upper-bound/README.md)：为本文 P3 的 `R` 给出最紧安全构造（联合逐槽上界、戒指唯一性精确配对、食物感知上界族、约束 Lagrangian 上界、部分分支滚动界）与「sum-only 类内最紧」的精确表述；本文定理 1（`U` 对 `R` 单调非减）使更紧的 `R` 直接收紧 `U`。
- [substat-sum-lower-bound-pruning](../substat-sum-lower-bound-pruning/README.md)：三属性和的安全下界、slab 收紧与安全剪枝族；其 PR1 可在需要时收紧 frontier 的 `Omega`（不改变 `U`，见该文 Lemma 1）。
- [coordinate-lower-bound-box](../coordinate-lower-bound-box/README.md)：在本文 `Omega`/`κ` 上定义逐坐标屏障 `l_i(B)`、乘积下界 `Phi(l)<=OPT` 与精炼算子 `T`（`B` 为 `Phi` 的已证下界，不是 `U` 的上界）；box 剪枝 = 3 个轴方向支撑，与本文 `U` 正交。

## 9. 与 canonical evaluator 的对应（file:line）

| 数学对象 | 生产实现 | 说明 |
| --- | --- | --- |
| `t_CRT, t_DHT, t_DET` | `src/domain/search/equipped-effects.ts:138-149`（在 `equippedAttributeTier` 内，`:110-154`） | 档位公式与参考文档 §3 一致；函数参数是 `gearAndFoodValue`，当前数据下恰等于档位输入贡献 `g`（`value = baseStats + 参数` 再减偏移；审计见 §13） |
| `floor` | `src/domain/search/equipped-effects.ts:163-166` | `Math.trunc(value + 1e-7)`；`g >= 0` 上等价于精确 floor |
| `F_C, F_H, F_D` | `src/domain/search/equipped-effects.ts:95-98`（在 `createIntegerDamageFactorEvaluator` 内，`:59-104`） | `critical = 10^6 + t(t + b)`、`directHit = 4000 + t`、`determination = t` |
| `U` 的档位三元组精确查询 | `src/domain/search/substat-factor-budget.ts:71-171` | 类列表 `(min, value)` = `(θ_i(t), F_i(t))`；配对 `:91-104`；排序 `:106`；前缀最大 `:108-120`；查询 `:128-159`（DHT 循环 `:132-135`、二分 `:136-143`、乘积 `:145-146`、tie-break `:147-154`） |
| 非法输入/工作量回退 | `substat-factor-budget.ts:77-89,128-130` | 返回 `undefined` = 该层不可用，必须回退 |
| 精确乘积与比较 | `src/domain/search/exact-mip-candidate-upper-bound.ts:108-111`（`exactProduct`）、`:96-106`（`safeDamageFactors`：七因子必须为正安全整数）、`:128-140`（`candidateUpperBoundCannotImproveIncumbent`） | §10 的比较语义 |
| 单资源 Lagrangian 回退 | `src/domain/search/factor-resource-budget-upper-bound.ts:88-147` | 与 `U` 不同的独立安全上界；生产 `loadout-finder-exact-mip.ts:1267,1353` 已使用（作为候选加权资源上界），但那是另一模型，不是本文的 `U` |

对应关系的关键点：**`U` 是「三个因子的档位乘积 + 一份可加总预算」的对象**，而 `prepareSubstatFactorBudgetQuery` 正是该对象的生产实现；`equipped-effects.ts` 提供 `min`（通过阈值公式由 `b_i` 反解）与 `value`（因子公式）。调用方必须自己完成三件事：(i) 把 baseline `b`、预算 `R`、caps `κ` 换算成三类 `(min, value)` 表（`min = θ_i(t)`，需要 `firstContributionWithTierAtLeast` 型的阈值反解；当前生产代码**没有**这个逆函数，只有正向的 `equippedAttributeTier`，因此该表构造目前需要新增实现或离线预计算）；(ii) 用 `BigInt` 比较得到的 `product` 与 incumbent 的完整乘积（§10）；(iii) 在查询返回 `undefined` 时回退。`prepareSubstatFactorBudgetQuery` 本身目前也只在测试中使用，尚未接入生产候选剪枝。

## 10. 应用前提与安全回退

### 10.1 `U` 的用途

`U(b,R,κ)` 用于对**单个候选装备**或**部分分支（partial branch）**给出副属性乘积（`critical·directHit·determination`）的严格乐观上界，从而在进入昂贵求解前排除不可能严格改善 incumbent 的分支。它本身**不是**生产实现，也不改变候选合法性判定。

### 10.2 前提清单（全部必须满足，否则不得使用该层）

- **P1（公式域）**：等级是六个支持等级之一；BLU 标记正确；`g >= 0`、整数；不使用负贡献。`(level, job)` 组合必须在职业上限内（生成数据中 BLU 的 `maxJobLevel = 80`，故不存在 level 90/100 的 BLU 组合；那两类只作为公式层测试）。
- **P2（baseline 是下界）**：`b = (C0,H0,D0)` 是分支中**已确定/已提交**的贡献坐标。更精确地，必须能证明：对分支中每一个合法完成，其最终贡献 `g` 可写成 `g_i = b_i + x_i`，其中 `x_i >= 0` 为整数。若 `b_i` 只取到已提交贡献的**下界**而实际还有未计入的已提交量，则必须把差额并入 `R` 与 `κ`，否则 `U` 可能低估（不安全）。若运行时只有面板总值，必须先按 §13.5 换算为贡献坐标（CRT/DHT 减 `sub`、DET 减 `main`，不能统一平移）。
- **P3（预算上界）**：`R` 是分支中「尚未确定的所有来源（其余槽位装备、materia、食物、自定义武器预算、同步后的可达增量等）」对三属性贡献**总和**的严格上界，即对每个合法完成 `Σ_i x_i <= R`。`R` 是贡献增量，与面板偏移无关。**构造建议**：最紧的安全构造见 [substat-sum-upper-bound](../substat-sum-upper-bound/README.md)：无约束时 `R_gear^uniq = Σ_s max_c S3(c)`（两戒指槽按唯一性精确配对）是 gear 和精确最大值；带食物/速度/TEN 约束时用该文的食物感知上界族与 Lagrangian 上界。逐属性最大相加 `R_sep` 虽然也是合法的和上界，但系统性高估联合和（严格分离例见该文定理 1），不应作为默认构造。
- **P4（caps 上界）**：`κ_i` 是各属性「剩余可增加贡献」的严格上界，即 `x_i <= κ_i`；允许 `κ_i = +∞`（表示无逐属性上界）。caps 必须是真实规则推出的乐观界（同步属性上限、materia/food 上限、自定义武器单/总上限等），不能是经验拟合值。`κ_i` 同样是贡献增量上限（面板偏移在差分中抵消）。
- **P5（因子域）**：七个完整伤害因子（`weaponDamage, mainStat, determination, tenacity, critical, directHit, gcdCentiseconds`）都是正安全整数；否则 `candidateUpperBoundCannotImproveIncumbent` 自身返回 `false`（`exact-mip-candidate-upper-bound.ts:96-106,133`），该层不成立。
- **P6（精确算术）**：`U` 与完整乘积都用 `BigInt` 精确计算；比较用 `exact-mip-candidate-upper-bound.ts:114-140` 的交叉乘法语义，不使用浮点、`Math.log` 或近似。
- **P7（其它乘区取乐观上界）**：`weaponDamage`、攻击主属性、`tenacity`、`traitMultiplier` 取候选池中的严格乐观最大值；DPS 目标取 `gcdCentiseconds` 的严格乐观**最小**值（GCD 越小 DPS 越大）。这些上界与 `U` 是独立取的，因此得到的是完整伤害乘积的合法上界（允许各乘区来自不同候选，是更松的超集上界）。
- **P8（查询可用）**：`prepareSubstatFactorBudgetQuery` 构造成功且预算在 `maxWork` 内；返回 `undefined` 时不得把「无结果」当作「不可能改善」。

### 10.3 上界构造与比较语义

对分支构造「乐观完整因子」：

```text
upperFactors = {
  weaponDamage  = 候选池 weaponDamage 最大上界,
  mainStat      = 攻击主属性最大上界,
  tenacity      = TEN 最大上界,
  gcdCentiseconds = 候选池 GCD 最小下界（DPS 用）,
  critical * directHit * determination <= U(b,R,κ)   （由定理 3 给出）
}
```

由于 `U` 本身是一个乘积上界，可以取定理 3 中的最优档位三元组 `(t_C*,t_H*,t_D*)`，令

```text
critical = F_C(t_C*), directHit = F_H(t_H*), determination = F_D(t_D*)
```

则 `exactProduct(upperFactors) = WD_max · mainStat_max · ten_max · U(b,R,κ)`，是一个可由真实整数因子构成的完整上界。再与 incumbent 做精确比较：

```text
DPS 目标：
  严格更差       : incumbentProduct * upperGcd  >  upperProduct * incumbentGcd
  不能严格改善   : upperProduct * incumbentGcd  <= incumbentProduct * upperGcd
伤害目标：
  严格更差       : incumbentProduct > upperProduct
  不能严格改善   : upperProduct <= incumbentProduct
```

语义区分（必须写清楚）：

- 「**不能严格改善**」是 `<=`：包含「严格更差」与「相等（tie）」两种情形。若搜索要求保留同分装备，只能用「严格更差」剪枝；用 `<=` 剪枝会把 tie 一起删掉。
- 「**严格更差**」是 `>`（DPS 交叉乘法形式）：只删除严格劣于 incumbent 的候选，tie 保留。
- 等号情形属于「不能严格改善」；在只搜索严格改进解的证明模型里（`candidateUpperBoundCannotImproveIncumbent` 的注释 `:127`），可安全剪枝。
- 比较双方的分母（`1,000,000`、`4000`、`1000`）与 `traitMultiplier` 对同一 job/level 是常数，故 `exactProduct` 的比较与真实伤害排序一致（`exact-mip-candidate-upper-bound.ts:108-111` 的注释）。

### 10.4 `U` 是松弛：能证明什么、不能证明什么

- **能证明**：若 `U(b,R,κ)`（连同其它乘区的乐观上界）都不能严格改善 incumbent，则分支中**不存在**任何合法完成能严格改善 incumbent，可以安全剪枝。理由：真实完成的贡献坐标 `g = b + x` 满足 `x ∈ A(b,R,κ)`，故其副属性乘积 `<= U`；其它乘区也都 `<=` 对应乐观上界。
- **不能证明/不能用于**：
  - 不能用于「删除某件真实装备」而不经候选层逻辑：`U` 只说明「在松弛里不可能更好」，并不保证存在合法的替代装备/meld/food 组合；共享装备身份、槽位唯一性等约束被松弛掉了（comment 02 §一、§七）。
  - 不能把 `U` 的最优分配（`c,h,d`）当作真实可实现的属性分配；它一般不满足装备/槽位约束。
  - 不能因 `U` 恰好不紧就使用经验阈值补剪；只能回退到更强的数学界或精确求解（§10.5）。

### 10.5 安全回退顺序

1. **本层**：定理 3 / 推论 A 的精确 `U`。
2. 若 `U` 的 caps/baseline/`R` 无法按 P2–P4 证明为乐观界，或因子非正、档位越界、`maxWork` 不足：**跳过本层**，使用
   - 现有的单资源 Lagrangian 上界 `prepareFactorResourceBudgetUpperBound`（`factor-resource-budget-upper-bound.ts:88-147`；生产 `loadout-finder-exact-mip.ts:1267,1353` 已在使用同类界），或
   - 现有的精确求解器 / 候选层上界。
3. **禁止**：证明不可用 → 用经验 CRT/DHT/DET 阈值或「似乎足够松」的 magic value 剪枝（Issue 正文「不依赖 magic value 的策略要求」；comment 02 §九）。

## 11. 验证

本目录提供 [verify.mjs](verify.mjs)，运行方式：

```text
node --experimental-strip-types docs/mathematical-analysis/theorems/free-budget-upper-bound/verify.mjs
```

它只做有限、确定性的整数计算（BigInt 精确乘积），不启动搜索、不枚举真实装备、不调用 MIP。当前输出（2026-10-18，第二轮 baseStat 审计后）为 `PASS`，`checks: 14165`，覆盖：

- **网格**：等级 `{50,60,70,80,90,100}` × `{WHM(普通), BLU}` × baseline `{(0,0,0),(200,200,200),(50,123,7)}` × `R ∈ {0,1,2,3,5,8,13,21,34}` × caps `{无 cap, (20,∞,5), (3,3,3), (0,∞,∞), (∞,10,∞)}`。
- **T1**：2520 个单调性/初值检查点；331 个跳变点全部落在档位成本三元组之和上（阶跃性证书）。
- **T2**：无 cap 324 例、有 cap 1620 例的「满预算最优」逐点对照；36 个饱和点。
- **T3**：1620 个 `(level, job, baseline, R, caps)` 上「档位三元组预算公式 = 暴力枚举 `U`」逐点一致。
- **A**：1443 个查询与公式/暴力枚举一致（直接 `import` 生产 `prepareSubstatFactorBudgetQuery`），含负预算、非整数预算、`maxWork = 0` 三个安全回退检查。
- **B**：120 例 `U >= 三顶点最大值`（89 例严格不等）。
- **C**：平台区间、满预算浪费实例与 32 个饱和点。
- **D**：档位/因子正性、有效区间端点。
- **E（baseStat 审计，§13）**：684 个 `(level,job,stat,g)` 点 × 2 项检查（生产 `equippedAttributeTier` 档位 = 贡献坐标模型档位；面板误当贡献会改变档位）= 1368 个检查，外加 4 个偏移参数与换算式复核，合计 1372 个检查。

**证明作用**：这是**有限网格证书**，用于排除实现/公式层面的错误、复核具体反例与边界行为；它不替代 §6 的一般性证明。网格外的结论只由 §6 的证明成立。

## 12. 未解决问题

1. **松弛紧致性**：`U` 与真实装备可行域最优之间的距离没有量化；本文只证明它是合法上界。是否存在可证明的「松弛 gap 上界」或可用真实资源 support 收紧的版本，未解决（comment 02 §六 的方向）。
2. **caps/baseline/R 的运行时认证**：§10 的 P2–P4 是使用前提；如何从真实候选池、同步规则、materia/food/custom weapon 约束以可证明且低开销的方式构造这三者是工程+数学的开放问题。本文不提供算法。
3. **多职业联合**：`U` 是单职业公式级上界；联合搜索还需要共享装备耦合与损失和界（`joint-loss-sum-bound`、`joint-substat-reachability` 等方向），本文不涉及。
4. **生产接入与性能**：`U` 尚未接入生产候选剪枝（`prepareSubstatFactorBudgetQuery` 目前只在测试中使用）；类表构造成本、查询成本、`maxWork` policy 与剪枝收益均**未评估**，不能声称有性能收益。
5. **更细的有限关键点结构**：`U` 已由档位三元组精确刻画，但「少量 raw 阈值交点/cap 边界」级别的更紧结构（comment 02 §五「有限关键点」）在本文框架下没有进一步缩减；是否能在不枚举全部档位三元组的前提下得到更少候选，未解决。
6. **与 pairwise 端点最大条件的交互**：当某些属性对满足端点最大条件时，`U` 可以进一步降维（见 [simplex-vertex-reduction](../simplex-vertex-reduction/README.md) 定理 4 的部分归约）；在真实 baseline/R 范围上是否存在可廉价认证的充分条件族，未解决。
7. **浮点/截断边界**：本文依赖「`g >= 0` 时 `Math.trunc(v+1e-7)` 等于精确 floor」；该等价性的完整误差界在 [raw-tier-transform](../raw-tier-transform/README.md)，本文未重复证明，运行时仍需按 §4(A1) 校验定义域。

## 13. baseStat 影响审计（贡献坐标 vs 面板总值）

本节为第二轮核对（用户明确要求）：逐条检查本文的坐标、公式与数值定义在**贡献**还是**面板总值**上，并给出外部调用者的换算契约。**结论：本文的定理、推论与数值复核均不需要修改**——所有命题本来就定义在档位输入贡献坐标上；此前缺少的是显式换算契约，本节补齐。verify.mjs 已加入对应审计（E 段）。

### 13.1 坐标声明

- 本文出现的全部量都是**档位输入贡献**坐标：`g`、baseline `b=(C0,H0,D0)`、分配 `(c,h,d)`、预算 `R`、caps `κ`、`θ_i(t)`、`T_i`，以及 §5/§7 与另一目录反例中的 `(200,200,200)`、`R=610/1500`、顶点/内部点等。
- 精确定义：设面板总值 `P_i` 为 `equipped-effects.ts:127` 的 `value = baseStats[stat] + gearAndFoodValue`，属性偏移

  ```text
  o_CRT = o_DHT = sub        （TEN 也用 sub，但不在 U 内）
  o_DET = main
  ```

  则本文的贡献坐标 `g_i := P_i − o_i`（档位公式真正看到的量）。`R` 与 `κ` 是贡献**增量**，偏移在差分中抵消，因此无需换算。
- 因此：`b=(0,0,0)` **不是**「面板总值为 0」，而是「装备+食物贡献为 0」，对应面板总值 = 基础属性 `(sub, sub, main)`；`b=(200,200,200)` 在 level 100 WHM 下对应面板 `(620,620,640)`（见 §13.4）。

### 13.2 归约链（源码到贡献坐标）

1. `src/domain/search/equipped-effects.ts:127`：`value = (baseStats[stat] ?? 0) + gearAndFoodValue`。
2. `getBaseStats`（同文件 `:178-203`）：`baseStats` 由 `game.baseStats` 决定。生成数据中 `baseStats.CRT = baseStats.DHT = baseStats.TEN = "sub"`、`baseStats.DET = "main"`；`clanStats` 只含 STR/DEX/VIT/INT/MND（不含三副属性）；`jobSchemas[*].statModifiers` 不含 CRT/DHT/DET/TEN/SKS/SPS，故 `?? 100` 缺省生效。于是对全部职业、全部支持等级：

   ```text
   baseStats.CRT = baseStats.DHT = baseStats.TEN = floor(sub * 100 / 100) + 0 = sub
   baseStats.DET = floor(main * 100 / 100) + 0 = main
   ```

3. 分支（`:138-149`）：CRT/DHT/TEN 用 `value − sub`，DET 用 `value − main`。因此档位输入贡献

   ```text
   g_i = value − o_i      （o_CRT = o_DHT = sub，o_DET = main）
   ```

4. 当前数据下 `baseStats[stat] = o_i`，故 `g_i = gearAndFoodValue`；即生产 evaluator 的 `gearAndFoodValue` 参数**就是**本文的 `g`，而不是面板总值。
5. floor 实参非负（可达域）：CRT `200g/div + 50（+200 BLU）` ≥ 50；DHT `550g/div（+200 BLU）` ≥ 0；DET `(140g/det + 1000)/detTrunc` ≥ 1000/detTrunc ≥ 200（`detTrunc ∈ {5,2,1}`）。因此三个 floor 的实参分别 ≥ 50/≥ 0/≥ 200，`Math.trunc(v+1e-7) = floor(v)`（参考文档 §3.1；误差界证明见 [raw-tier-transform](../raw-tier-transform/README.md)）。负贡献域不满足该等价，因此不在本文定义域。
6. **归约是可运行时可核验的数据性质，不是定义**（参考文档 §2.1 的警告）：若未来 `baseStats`/`clanStats`/`statModifiers` 变化，必须重新核验 `baseStats[stat] = o_i`；更稳妥的契约是始终按 §13.5 直接由面板值算 `g_i = P_i − o_i`，这样即使 `baseStats` 与偏移不一致也不会误用坐标。

### 13.3 逐命题判定表

| 命题/位置 | 依赖的坐标 | 是否受 baseStat 影响 | 判定与说明 |
| --- | --- | --- | --- |
| §3 档位函数 `t_i(g)` | 档位输入贡献 `g` | 是（若 `g` 误取面板会全错） | 成立。`g = P − o`；模型与生产在贡献坐标上逐点一致（§13.4、verify E）。 |
| 定理 1（良定义/单调/阶跃） | `b`、`R`、`κ` 全为贡献 | 是（`b`） | 成立。单调性用 `t_i` 对 `g` 非减；`R/κ` 是增量，不受偏移影响。 |
| 定理 2（满预算 `= min(R,K)`） | `b`、`R`、`κ` | 是（`b`） | 成立。只用到可行集与 `f_i` 单调，均定义在贡献坐标。 |
| 定理 3（档位三元组精确公式） | `θ_i(t)=max(0, γ_i(t)−b_i)` | 是（`b_i` 必须是贡献基线） | 成立。若 `b_i` 误用面板，`θ` 与 `T_i` 全部错误；按 §13.5 换算后公式不变。 |
| 推论 A（生产查询对应） | 类表 `min=θ`、`value=F_i(t)` | 是（类表构造） | 成立。类表的 `min` 是贡献增量成本；调用方必须用贡献坐标构造。 |
| 推论 B（顶点下界） | 顶点 `(R,0,0)` 等 | 否（`R` 为增量） | 成立。面板顶点 = `(o_i + 贡献顶点)`，但因子乘积只依赖贡献差，结论不变。 |
| 推论 C（平台/饱和） | 跳档成本 `θ`；`R_sat` | 是（阈值在贡献域） | 成立。贡献阈值 `θ` 与面板阈值 `o_i + θ` 一一对应；平台/饱和性质不变。 |
| 推论 D（整数域/有效区间） | `[t_i(b_i), t_i(b_i+min(κ_i,R))]` | 是（`b_i`） | 成立。区间端点由贡献基线决定；换算后为 `[t_i(P_i^0−o_i), t_i(P_i^0−o_i+min(κ_i,R))]`。 |
| §10 应用前提 P1–P8 | 全部 | 是（P2/P4） | 成立。P2/P4 已补充「面板必须先换算」；P1 补充 BLU 职业上限。 |

结论：**没有任何定理或推论需要重新论证**；需要补的是坐标契约（本节）与运行时换算校验。

### 13.4 数值复核（本文涉及的数字）

level 100 WHM 的偏移 `(o_CRT, o_DHT, o_DET) = (sub, sub, main) = (420, 420, 440)`；level 50 BLU 为 `(341, 341, 202)`。

| 文档位置 | 贡献坐标（本文数值） | 对应面板总值 | 是否按贡献计算 |
| --- | --- | --- | --- |
| §3/§10 baseline `b=(200,200,200)`（level 100 WHM） | (200,200,200) | (620,620,640) | 是 |
| §5 推论 C 平台例 `b=(0,0,0)`（level 100） | (0,0,0) | (420,420,440)（=基础属性面板，不是面板 0） | 是；首跳成本 14/6/20 是贡献增量 |
| 推论 C 面板阈值 | `θ_C=14, θ_H=6, θ_D=20` | CRT 434, DHT 426, DET 460（`o + θ`） | 是 |
| 推论 C 饱和例 caps `(100,60,30)`、`R_sat=174` | 增量 | 无需换算（差分） | 是 |
| 推论 B 引用的反例（完整表见另一目录 §13） | `b=(200,200,200)`、`R=610`、内部点贡献 (209,445,556) | baseline (620,620,640)；内部点面板 (629,865,996) | 是；乘积 4,315,825,466,400 不变 |

坐标混用反例（verify E 段逐点核验）：level 100 WHM 在贡献 `g=200` 处档位为 `(CRT 64, DHT 39, DET 1010)`；若把面板 `(620,620,640)` 误当贡献，档位变成 `(94, 122, 1032)`——数字明显不同，说明本文若混用坐标会立刻产生错误。本文没有混用：所有档位/因子/乘积都由贡献坐标复算，verify E 段对 684 个 `(level,job,stat,g)` 点做了生产与模型的逐点一致检查。

**verify.mjs 输入坐标**：本目录脚本把 `b`、`R`、`κ`、`(c,h,d)` 直接传给 canonical-model 的贡献模型（`tier/factorsAt/firstContributionWithTierAtLeast`），并以生产 `equippedAttributeTier` 交叉验证这些输入就是贡献坐标；第二轮审计新增 E 段（1372 个检查），**无需修改任何既有输入或数值**。

### 13.5 应用契约：面板 → 贡献换算

设外部只有面板总值（`equipped-effects.ts:127` 的 `value`，即角色面板中该属性的总值）：

```text
初始面板   P_i^0 = baseStats[stat] + 已提交 gearAndFoodValue_i
目标面板   P_i   = 最终该属性的面板总值
偏移       o_CRT = o_DHT = sub，o_DET = main
贡献基线   b_i = P_i^0 − o_i
贡献增量   x_i = P_i − P_i^0        （等价于 (P_i − o_i) − (P_i^0 − o_i)）
预算/caps  R、κ_i 不变              （都是贡献增量）
```

**不变性证明**：由 §13.2，`t_i` 的档位输入是 `g_i = P_i − o_i`。定义面板域档位函数

```text
t_i^P(P) := c_i + m_i * floor((a_i * (P − o_i) + b_i) / q_i) = t_i(P − o_i)
```

则对任意最终面板 `P_i`：

```text
Π_i F_i(t_i^P(P_i)) = Π_i F_i(t_i(b_i + x_i))，
且 P_i − P_i^0 = x_i，
故约束 Σx_i <= R、x_i <= κ_i 与面板坐标下的 Σ(P_i−P_i^0) <= R、P_i−P_i^0 <= κ_i 完全一致。
```

所以用 `(b,R,κ)` 计算的 `U` 与用面板坐标 `(P^0,R,κ)` 计算的上界是同一个值：**`U` 的公式对换算不变**。

**注意**：

1. **不能统一平移**：CRT/DHT 的偏移是 `sub`，DET 的偏移是 `main`；三属性偏移不同（level 100 普通职业为 `(420,420,440)`），必须逐属性换算。
2. **`b=0` 的含义**：贡献基线 0 对应面板 = 基础属性 `(o_i)`，不是面板 0。
3. **反向检查**：若只知道面板下限/上限，也应换算成贡献后再放入 `b/κ`；面板差分与贡献差分相同，但绝对 baseline 必须减偏移。
4. **运行时校验**：把 `gearAndFoodValue` 直接当 `g` 前，应验证 `getBaseStats` 归约（`baseStats[stat] = o_i`）在当前数据版本成立；否则改用面板值按上式换算。verify E 段在有限网格上复核了当前数据版本。

### 13.6 结论

- **是否受影响**：**不受影响**。本文所有定理、推论、示例与数值本来就定义在贡献坐标上；`b=(200,200,200)`、`R=610/1500` 等数字全部是贡献而非面板总值。审计未发现任何面板/贡献混用，故**无需修改任何数字或重新论证**。
- **本次改动**：新增本节（坐标声明 / 归约链 / 逐命题表 / 数值复核 / 换算契约）；§3、§9、§10.2 增加指向本节的坐标说明（P1 补充 BLU 职业上限，P2/P4 补充面板换算前提）；§11 更新验证计数并新增 E 段说明；[verify.mjs](verify.mjs) 增加 E 段 baseStat 审计（仍 PASS，`checks: 14165`）。
- **边界**：本节只覆盖 CRT/DHT/DET 三副属性（`U` 的坐标）；TEN 虽同样满足 `baseStats.TEN = sub`，但不在 `U` 内，完整伤害的 TEN 上界按 §10.3 单独处理。
