# 数学分析资料：Issue #3 固定等级伤害公式的可复用定理

本目录保存 [Issue #3](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/3) 的原文快照、共同事实基础、按定理拆分的严格数学分析，以及可复核的有限域证书。

**范围声明**：本目录是**纯数学分析**。所有文件均为文档或只读验证脚本；没有修改生产代码、游戏数据或生成文件，没有启动装备搜索、候选组合穷举、MIP/求解器、搜索验收、benchmark 或性能测试，也**没有**通过测试/脚本间接启动它们。性能收益与生产搜索验收**本轮未评估**（见 §8）。

## 1. 快照与同步核对

- 抓取与核对日期：2026-10-18（Asia/Shanghai）。
- 本目录快照：[Issue 正文](issue-3-body.md)、[评论 01](issue-3-comment-01.md)、[评论 02](issue-3-comment-02.md)。原文分别保存，不合并改写；评论按 GitHub 评论 ID 升序编号，后续新增评论应继续编号。
- **开始分析前已核对 GitHub Issue #3**：抓取时 issue 状态 `open`、`updated_at = 2026-10-18T00:23:51Z`、评论数 `2`；两条评论 ID 为 `6236437253`、`6243686548`，其 `created_at` 与 `updated_at` 均未变化（说明没有编辑）。因此**没有新增或需要同步的评论**，无需新增快照；本地两份评论快照与远端正文抽样逐行核对，缺失 0 行。
- 核对方式：通过本地 git 凭据访问 GitHub REST API（该仓库不是公开可匿名读取的仓库；未认证请求返回 404）。若后续要复核，应重复同一流程：拉取 issue 与全部评论，比较 ID 集合、`created_at`/`updated_at` 与正文，再决定是否新增 `<comment-NN>.md` 并更新本索引。

研究以最新评论（评论 02）的修正与优先级为准，正文与评论 01 作为背景；评论 01 的研究路线（single-crossing / 顶点归约）已被本目录的否证结果取代。

## 2. 阅读入口

1. [Issue 正文](issue-3-body.md)（背景；其单位预算边际比较公式已被更正，见 [marginal-comparison](theorems/marginal-comparison/README.md)）
2. [评论 01](issue-3-comment-01.md)（70 级均衡资源实验；其猜想已被检验）
3. [评论 02](issue-3-comment-02.md)（**当前权威要求**：固定等级可复用定理、安全回退、多职业联合上界）
4. [canonical evaluator 参考模型](canonical-evaluator-reference.md)（共同事实基础：等级参数、整数档位模型、精确因子、源码行号、定义域）
5. [验证脚本与证书](verification/README.md)
6. 各定理目录（见 §4 映射表）
7. [候选池测量：三属性和上下界](measurements/substat-sum-bounds.md)（生成文件；测量证据，不是定理证明）
8. [装备搜索优化价值排序](search-value-ranking.md)（把全部定理与测量整理成工程排序/实施路线；预期效果是**估算**，本轮未接入/未 benchmark）
9. [大整数处置方式](large-integer-handling.md)（精确约分、尺度与阈值映射、Number/BigInt 分界、HiGHS 接口与安全回退；§10 为定理使用路径审计结论）

## 3. 三个数学对象（评论 02 §一）

本目录的定理严格区分以下对象，不把观察当证明：

1. **固定等级公式**：等级参数、装备+食物贡献 `g`、整数档位、`F_C/F_H/F_D` 与精确伤害/DPS。可证明完全不依赖装备池的性质（`raw-tier-transform`、`tier-log-curvature`、`marginal-comparison`、`raw-marginal-envelope`）。
2. **自由资源松弛**：以 baseline `(C0,H0,D0)` 与预算 `R` 为输入，允许把剩余资源任意投入三属性。它是真实装备空间的**超集**，只能用于安全上界（`free-budget-upper-bound`、`strict-improvement-frontier`）；松弛内“属性可交换”不代表真实装备可以交换。
3. **真实装备可行域**：装备固定属性、孔位/meld cap、食物、同步、独占/共享槽、武器/主属性/TEN/GCD 等约束。删除真实候选只能依据显式合法替代、严格乐观上界或全坐标支配，不能仅凭松弛内存在有利交换（`attribute-swap-criterion`）。

## 4. 评论 02 研究目标 → 定理目录映射

> 评论 02 的字母编号（定理 A = §三、B = §四、C = §五、D = §六、E = §七）与各定理文档内部的局部标签不完全一致；**以本表的目录名 + 评论章节号为准**。

| 评论 02 目标 | 定理目录 | 状态 |
| --- | --- | --- |
| §二 CRT tier 离散对数凸凹切换（代数结论） | [theorems/tier-log-curvature](theorems/tier-log-curvature/README.md) | 已证明（tier 级）；tier→raw 直接转移**已否证** |
| §三 / 定理 A：阈值周期、跳档成本、截断语义、正因子域、单调性 | [theorems/raw-tier-transform](theorems/raw-tier-transform/README.md) | 已证明（可达域 `g ∈ [0, min(G_max, 10^7)]` 整数；实参非负是结构性结论）；定义域外 `g<0` 的截断差异仅作稳健性登记（搜索路径不可达） |
| §三 / 定理 A：raw 级单位预算增益的严格包络、余类周期、锯齿 | [theorems/raw-marginal-envelope](theorems/raw-marginal-envelope/README.md) | 已证明；raw 级 log-convex 与 log-concave **均否证** |
| §七（对正文边际比较公式的更正） | [theorems/marginal-comparison](theorems/marginal-comparison/README.md) | 已证明（交叉指数判据）；正文旧形式**已否证** |
| §四 / 定理 B 目标 1–3：端点最大、条件端点最大、非单峰结构 | [theorems/pairwise-endpoint-max](theorems/pairwise-endpoint-max/README.md) | 全域端点最大**已否证**；结构定理与条件定理已证明 |
| §四 / 定理 B 目标 3–4：有限关键点、严格上界 | [theorems/pairwise-slice-critical-set](theorems/pairwise-slice-critical-set/README.md) | 有限关键集、交错周期、O(1) 上界族已证明；“关键集不可再小”未解决 |
| §五 / 定理 C：满预算最优解、simplex 降维、`U(b,R)` | [theorems/free-budget-upper-bound](theorems/free-budget-upper-bound/README.md) | 已证明（含 `U` 的精确 tier-triple 预算公式） |
| §五 / 定理 C：顶点/边界归约与降维充分条件 | [theorems/simplex-vertex-reduction](theorems/simplex-vertex-reduction/README.md) | 三顶点/边界归约**已否证**；充分条件、精确回退已证明；**部分归约已修正为 caps 感知**（无 cap 绑定⇒两零 facet；一般 caps⇒四 facet）；端点扫描已去重 `F_k` 并只扫非空切片 |
| §六 / 定理 D：严格改善 frontier、`K_w` 必要半空间 | [theorems/strict-improvement-frontier](theorems/strict-improvement-frontier/README.md) | 已证明；slab 继承范围（非上集，盒域算法不继承）、`B=P*` 非严格域非空、同分点需商可达已修正；tie 证书已改为 BigInt 精确实现 |
| §七 / 定理 E：精确交换判据、松弛 vs 真实装备 | [theorems/attribute-swap-criterion](theorems/attribute-swap-criterion/README.md) | 已证明（含分离定理与三条安全删除路径） |
| §八：多职业归一化联合上界、损失和、共享耦合 | [theorems/joint-loss-sum-bound](theorems/joint-loss-sum-bound/README.md) | 损失和判据与耦合不等式已证明；可计算紧联合耦合界未解决 |
| §九/§十：证书与验证 | [verification/](verification/README.md) + 各目录 `verify.mjs` | 有限域证书全部通过；形式化证明未做 |
| 综合工程排序（非定理） | [search-value-ranking.md](search-value-ranking.md) | 按"预期搜索耗时优化价值"排序的定理/工具清单、实施路线与估算；**估算未测量**，不构成性能承诺 |
| **本轮扩展**：三属性和的最紧安全上界（服务 §三/§五 的 `R` 构造） | [theorems/substat-sum-upper-bound](theorems/substat-sum-upper-bound/README.md) | 安全性已证明；`R_gear^uniq` 精确性条件成立；义军只统计目标属性且 `R_sep` 保留固定目标贡献、增量预算 `R*=S*−Σb`；食物耦合精确值未解决 |
| **本轮扩展**：三属性和的安全下界与剪枝族（服务 §六 frontier / 分支剪枝） | [theorems/substat-sum-lower-bound-pruning](theorems/substat-sum-lower-bound-pruning/README.md) | 下界与 PR1–PR8 安全性已证明；**PR4/5 仅在相同约束口径下**被乘积界支配；**PR6 含加权方向，不能默认排除**（逐方向评估互补或证明冗余）；PR2 限制已证明；`Ω_slab` 非上集、盒域代表元算法不继承 |
| **用户扩展**：三属性逐坐标下界 box、乘积下界与精炼迭代 | [theorems/coordinate-lower-bound-box](theorems/coordinate-lower-bound-box/README.md) | 屏障/乘积下界已证明（`B` 须为同域下界）；`T` 幂等、阈值 `M` 精确；box 不超出 frontier 轴支撑；真实域 `l` 可达性未解决 |
| **用户扩展**：种族/主属性变化对最优配装的不变性 | [theorems/race-main-stat-invariance](theorems/race-main-stat-invariance/README.md) | **实际候选域一般命题已否证**（页面可选 L70 BLM sync375 精确搜索反例；Human 最优换族后 < Au Ra 真实最优）；L100 的 21 职业有限验证未发现反例但**未证明**；等主属性贡献/攻击因子公共比例/档位逐点不变等充分条件已证明；食物/HP 耦合未解决 |

## 5. 已证明结果（摘要）

全部命题的完整假设、量词、证明与适用前提见对应 README。这里只列 headline。

**A. raw→tier 精确变换**（[raw-tier-transform](theorems/raw-tier-transform/README.md)）

- 基础属性归约：`base(CRT)=base(DHT)=base(TEN)=sub`、`base(DET)=main`，因此档位只看装备+食物贡献 `g`（面板总值 = 基础属性 + `g`；评论 01 的 739/743/769 在 70 级对应贡献 375/379/477）。**可达域内档位实参恒非负**：贡献逐项非负（装备/镶嵌/自定义与义军武器/食物）且 `baseStat` 等于对应偏移，故 CRT 实参 `>=50`、DHT `>=0`、DET `>=200`、TEN `>=1000`，`Math.trunc(v+1e-7)=floor(v)` 在可达域无条件成立。
- canonical 恒等式：对 6 个等级 × 23 职业 × `{CRT,DHT,DET,TEN}`、整数 `0 <= g <= min(G_max, 10^7)`，
  `equippedAttributeTier = c + mult·floor((a·g+b)/q)`；生产 `floor = Math.trunc(v+1e-7)` 在该定义域上等于精确 floor（binary64 误差界 `< 1.5e-8 < 1e-7`，分母 `q <= 2780` 保证非整数距离 `>= 1/q`）。
- 阈值闭式 `g_k = ceil((ceil((k-c)/mult)·q - b)/a)`，含充分性、最小性、单调性与域裁剪。
- 跳档成本 `c_k = floor(q/a) + [s + (q mod a) >= a]`，只取 `{floor(q/a), ceil(q/a)}`；`a > q` 时出现成本 0（档位被跳过，仅等级 50 DHT）。
- 周期：`d = gcd(a,q)`、`P = q/d`、`shift = mult·a/d`，`t(g+P) = t(g)+shift`（对任意整数 `g`）；`g_{k+shift} = g_k + P`；成本与余类序列周期。
- 36 行实例表（6 等级 × 6 公式实例）；等级 100 的 `{13,14}/{5,6}/{19,20}` 与评论 02 一致。
- 正性/单调性：`t_CRT >= 50/250`、`t_DHT >= 0/200`、`t_DET >= 1000`、`t_TEN >= 1000`；因子严格为正；`g→t→F` 非减，跨档严格增。

**B. tier 级离散曲率**（[tier-log-curvature](theorems/tier-log-curvature/README.md)）

- `E_b(t) := F_b(t+2)F_b(t) - F_b(t+1)^2 = 2,000,000 - 2t² - (2b+4)t - (b+1)²`；`E>0 ⇔ 比值序列递增 ⇔ log-convex`（两向等价）。
- 普通 `b=350`：`E = 1,876,799-2t²-704t`，`E(808)=2239>0`、`E(809)=-1699<0` ⇒ `t ∈ [0,808]` log-convex、`t >= 809` log-concave，比值峰值 `r_809`。
- BLU `b=150`：`E = 1,977,199-2t²-304t`，切换 921/922（`E(921)=733`、`E(922)=-3257`），峰值 `r_922`。
- DHT/DET：`(A+t+2k)(A+t)-(A+t+k)² = -k² < 0`，任意步长严格 log-concave；DET 的 `detTrunc` 采样版本强度 `-(mult·k)²`。
- `F_b(t) > 0` 对一切整数 `t`；可达区间前提（`g_808` 表）作为**运行时检查**给出，不是游戏数据假设。

**C. 单位资源边际比较**（[marginal-comparison](theorems/marginal-comparison/README.md)）

- 正因子、正整数成本下
  `ln(F1/F0)/cF >= ln(G1/G0)/cG  ⇔  F1^{cG}·G0^{cF} >= F0^{cG}·G1^{cF}  ⇔  几何均值形式`（严格/等式版本同样成立）。
- 指数交叉使用对方成本；正文旧形式 `(F1·G0)^{cG} >= (G1·F0)^{cF}` **不等价**，偏差恒等式 `A'/B' = (A/B)·(F0·G0)^{cG-cF}`。

**D. raw 级边际包络**（[raw-marginal-envelope](theorems/raw-marginal-envelope/README.md)）

- 窗口档位增益引理（精确）：`t(g+δ) - t(g) = mult·floor((r(g)+a·δ)/q)`，`r(g) = (a·g+b) mod q`；两值成员判据。
- 余类周期 `P = q/gcd(a,q)`；窗口因子增益的严格两值包络（宽度恰为一个相邻档位增益）与连乘表示。
- 区间上单位预算 log 增益的极值在有限可枚举候选集取得；比较不需 log（同预算交叉相乘，异预算复用 C 的交叉指数判据）。
- 锯齿振幅精确公式 `A = P·ln(maxR/minR)/ln(periodGain)`；24 组 `(level,stat)` 的 `A/T` 表（最大 25.155，全部 `<26` 有精确证书）；参数族 `det = 140m` 给出 `A/T = m` 无界构造（参数族意义，不是现有六等级）。

**E. 两属性定和切片**（[pairwise-endpoint-max](theorems/pairwise-endpoint-max/README.md)、[pairwise-slice-critical-set](theorems/pairwise-slice-critical-set/README.md)）

- 步分类：只有左档位跳变步（C 步）可能使 `G` 上升，只有右档位掉档步（R 步）可能使其下降；联合步符号由精确交叉乘法决定（并给出等价不等式）。
- 平台对应：每个上升步开启一个极大常量区间；内部严格局部极大平台数 `L_max` = 压缩符号序列中 `(+,-)` 的个数，`L_max <= min(J+, J-)`。
- 非单峰：存在上升步 `u < w(下降) < v(上升)` ⇒ 压缩符号序列至少两次符号变化 ⇒ 评论 01 的 single-crossing 猜想被结构性否证。
- 条件端点定理：左/右档位在区间上恒定时 `G` 分别非增/非减。
- 精确判据（完整刻画）：`max_{[lo,hi]} G = max_{K_L} G`，其中 `K_L = {lo} ∪ {C 步位置}`；因此
  `端点最大 ⇔ max_{K_L} G <= max(G(lo), G(hi))`，是精确判定而非采样，`|K_L| <= floor(a·D/q)+2`。
- 关键集可闭式枚举（阈值公式），对称关键集 `K_R`；交错周期结构：档位周期 `P=q/gcd(a,q)`、步型词周期 `lcm(P_L,P_R)`、相位类/漂移。
- O(1) 严格上界族 `U_m`：合法、随 `m` 单调收紧，但**非精确**（已证明），用于只要求保守上界时。

**F. 三属性自由预算 `U(b,R)`**（[free-budget-upper-bound](theorems/free-budget-upper-bound/README.md)）

- `U` 良定义、整数、关于 `R`/各 baseline/各 cap 非减、是 `R` 的非减阶梯函数。
- 满预算最优存在：无 cap 时存在最优分配满足 `c+h+d=R`；有 cap 时存在最优分配满足 `c+h+d = min(R, Σκ)`。
- **精确 tier-triple 预算公式**（主定理，双向证明）：
  `U(b,R,κ) = max{ Π_i F_i(t_i) : t_i ∈ T_i, Σ_i θ_i(t_i) <= R }`，
  其中 `θ_i(t) = max(0, g_i(t)-base_i)` 为达到档位的最小成本。该式是**等式**（不是上界），已与既有 `prepareSubstatFactorBudgetQuery`（`substat-factor-budget.ts:71-171`）的语义逐项对应。
- 推论：三顶点公式只是 `U` 的**下界**；预算可被浪费（平台），`U` 有平坦区间与饱和点。
- 该模块当前**未接入正式搜索路径**；正式搜索使用完整资源/加权资源上界 `prepareResourceBudgetCandidateBounds`（`loadout-finder-exact-mip.ts:1222–1285`，内部调用 `prepareFactorResourceBudgetUpperBound`：`:1267,1353`）。`U` 是另一个三副属性松弛，应与之取更紧，不能假设替代（同域比较）。

**G. 顶点/边界归约**（[simplex-vertex-reduction](theorems/simplex-vertex-reduction/README.md)）

- 充分条件（已证明）：若三对属性在**所有**固定第三坐标切片上满足端点最大，则 `U` **存在**顶点最优解（迭代归约，≤2 次；caps 版本、边界刻画已证明）。这只说明“存在”，不说明“所有最优解都在顶点”。
- 该充分条件**不必要**（已给出顶点最优但证书失败的实例）。
- 精确反例已证明三顶点公式与边界归约都不成立（见 §6）。
- 部分归约（已证明，caps 感知）：仅**一对**属性被认证时，若 `S*<=min(κ_i,κ_j)`（caps 不绑定），最优解落在两个零 facet 之一且 `U` 可由两个二维精确切片给出；一般 caps 下必须用**四 facet** `{x_i=0,x_j=0,x_i=κ_i,x_j=κ_j}` 的精确公式（每 facet 是 2D 精确问题），原二 facet 公式可能为 `-∞` 或严格偏低（不安全）。§7.4 有反例。**端点扫描式**中 `G_{ij}` 已含第三因子 `F_k`，外层不得再乘（否则 `R=0` 时得 `4.08e15` 而非 `4.08e12`）；且只能扫描 `K_feas=[max(0,S*−κ_i−κ_j), min(κ_k,S*)]` 的非空切片（`L>U` 的空切片强行取端点会得到越 cap 的非法点并可能 `>U`）。
- 安全回退：直接用 F 的精确 tier-triple 公式，或既有 factor-resource 上界。

**H. 严格改善 frontier 与 `K_w`**（[strict-improvement-frontier](theorems/strict-improvement-frontier/README.md)）

- 严格阈值推导：伤害 `B = floor(P_inc/O)`、DPS `B = floor(P_inc·gcdMin/(O·I_G))`、非严格 `ceil(P_inc/O)`；取整方向与乐观性方向均有证明与反例。
- `D_min(C,H;B)` 存在唯一（`+infinity` 表示无解）、关于 `C/H` 单调不增、DET 档位表上二分精确计算、staircase 紧致表示 `<= (K_C+1)(K_H+1)` 单元。
- `K_w(B) = min{w·x : x ∈ G_>(B)}`：`G_>` 非空当且仅当有限；`K_w = min` 在最小反链上取到；精确计算公式；关于 `w`/`B` 单调、正比例齐次。
- 必要半空间：所有严格改善点满足 `w·x >= K_w`；`L <= K_w` 安全、`L > K_w` 会误删改善点（显式反例并指出 `argmin` 不必等于最小元集合）。
- tie 语义：严格 frontier 只能排除严格改善，不能用于删除同分方案；非严格模型必须用 `G_>=` 与 `ceil` 阈值。
- 空改善区域：`G_>(B)=∅ ⇔ B>=P*`；`G_>=(B)=∅ ⇔ B>P*`。`B=P*` 时非严格域 = argmax 非空（tie/最优方案必须保留），严格 `K_w=+∞`、非严格 `K_w>=` 有限；`B>P*` 两者才都空。
- 支撑族：任意子集都安全（正确性不依赖支撑数量）；冗余判据与蕴含检查；支撑数量只是性能 policy。

**I. 精确属性交换**（[attribute-swap-criterion](theorems/attribute-swap-criterion/README.md)）

- 两状态交换的精确整数乘积判据；单位成本形式归约到 C 的交叉指数判据（仅当成本相等时两种形式一致，不等成本必须用交换判据，已给反例）。
- 松弛内：严格改善交换 ⇒ 该状态不是松弛最优 ⇒ 可从松弛状态集删除；tie 交换**不**授权删除（保留 tie/身份语义时）。
- **分离定理**（已证明 + 精确反例）：松弛内严格改善的自由交换**不蕴含**存在合法真实替代；据此删除真实物品/镶嵌/食物会改变真实最优（戒指唯一性模型：真实最优 `4,153,084,875,000`，松弛点 `4,154,176,000,000` 不可实现，删除 DHT 物品后真实最优降至 `4,147,900,000,000`）。
- 三条安全真实删除路径：(a) 显式合法替代集；(b) 严格乐观上界；(c) 全坐标支配（超出本文范围，仅登记）。共享身份、戒指唯一性、食物、GCD/坚韧约束必须保持。

**J. 多职业联合**（[joint-loss-sum-bound](theorems/joint-loss-sum-bound/README.md)）

- `0 < r_j(s) = f_j(s_j)/B_j <= 1`，且 `r_j(s) <= u_j(s) = min(1, U_j(s)/B_j)`（同一共享方案 `s`、同一目标与约束下的已证上界）。
- 损失和判据：`Σ_j u_j(s) <= J*  ⇔  Σ_j (1-u_j(s)) >= n-J*`；因此该共享方案不能**严格**改善 incumbent；严格变体与 tie 语义已证明，精确有理比较算法与整数缩放取整方向已给出。
- 既有单职业必要界 `candidateUpperBoundCannotImproveJointIncumbent`（`joint-candidate-upper-bound.ts:10-22`）是 `u_k = 1 (k != j)` 的实例；单职业判据的拒绝集 ⊆ 损失和判据的拒绝集；非冗余精确实例与一般 `n` 的充要条件 `n >= 2 且 J* < n`。
- 共享选择耦合：`max_s Σ_j u_j(s) <= Σ_j max_s u_j(s)`（已证明）；耦合损失语义与拉格朗日界；**可计算的紧联合耦合界未解决**。

**K. 三属性和的联合上界**（[substat-sum-upper-bound](theorems/substat-sum-upper-bound/README.md)）

- 目标：为 `free-budget-upper-bound` 的 `R`（三属性和上界）给出尽量紧的安全构造，并证明层级关系。
- 已证明：`R_sep = Σ_i Σ_s max_c x_i(c)` 是 gear 和上界；`R_gear = Σ_s max_c S3(c)` 在槽间独立/戒指另行配对时是 gear 和的**精确最大值**；`R_gear^uniq <= R_gear <= R_sep`，且有严格分离例（如单槽 `(100,0,0)/(0,100,0)`：`R_sep=200`、`R_gear=100`）。
- 戒指唯一性：给出 `O(n log n)` 精确配对算法与正确性证明（同 unique ID 必须换一侧；实际实现可再用生产 `buildRingPairEquipInfos` 的配对候选）。
- 义军武器：只对目标属性 `I=stats∩{CRT,DHT,DET}` 精确 `S3(x0)+min(T,Σ_{i∈I}m_i)`；非目标属性（SKS/TEN）不进入 `S3`（反例：CRT cap1/SKS cap9/T=10 ⇒ 10 vs 1）。**R_sep 的逐属性上界为 `S3(x0)+Σ_{i∈I}min(m_i,T)`**：三个目标属性的**固定贡献全部保留**，只把可分配增量限定在 `I`（反例 `x0=(100,40,0)`、`I={CRT}`：错误 over-I 和 101 会低估真实最大 141，F1）；可分配属性全在 `I` 时逐属性上界会严格高估（示例 170 vs 180）。
- 食物：B1–B4 上界族已证明；`R_food = max_f min_k B_k(f)` 安全；`B4 <= B1,B2`；`B3` 与 `B4` 不可比；带食物精确最大值**未解决**。
- 约束：速度/TEN 的 Lagrangian 上界已证明、乘子最小化可精确计算，但**非精确**（有积分间隙反例）；食物与约束的安全方向替换已给出。
- `sum-only` 类内最紧：`R` 是**相对 baseline `b` 的增量**；最小合法增量预算为 `R* = S* − Σ_i b_i`（`b=0` 时即 `S*`），`U(b,R*,κ)` 在类内最小。把最终绝对和 `S*` 当 `R` 只会过松（`S*>=R*`）；`R<R*` 漏完成才不安全（限定类，不声称任意结构全局最紧）。

**L. 三属性和下界与安全剪枝族**（[substat-sum-lower-bound-pruning](theorems/substat-sum-lower-bound-pruning/README.md)）

- 已证明：`L_gear = Σ_s min_c S3(c)`、`L_food = min_f Σ_i bonus_i(f,0)`、`L1 = L_gear + L_food` 是安全下界；戒指唯一性下可给更紧的精确最小合法配对；约束只缩小可行域，故无约束下界仍安全。
- 已证明（关键限制）：**和的下界不能改变最高值**——三因子单调 + 满预算最优 ⇒ 把区域限制到 `Σ >= L` 不改变 `U`；下界只能用于"删除不可达区域/收紧必要区域"，不能用于缩小上界。PR3 的切片跳过**仅限真实域**，不得用于松弛最大值的计算或顶点/部分归约证书（附反例）。
- 剪枝族 PR1–PR8（均含安全证明与适用对象）：slab 收紧（`Omega_slab`：集合安全/半空间必要/`K_w(Ω_slab)>=K_w(Ω)` 可继承；但 `Ω_slab` 非上集，D_min 单调与 tier 单元常值**不继承**，盒域代表元/最小反链算法需全枚举或重新推导）、分支不可行（全局界字面形式只能命中空分支，已证明；可用形式为目标窗口）、区域/切片排除（仅真实域）、incumbent 和割 `K_sum`（被乘积界支配，仅作廉价早筛）、候选级必要和可达性（同被乘积界支配）、半空间组合（`w=(1,1,1)` 是支撑族方向）、多职业逐职业可行性与目标窗口（条件成立）、tie/身份语义表。
- 支配表：**PR4/5（和割/候选和割）仅在相同约束口径下**被精确乘积界支配，不声称更强；**PR6 含任意加权方向**，与 `U` 互补，不能默认排除——须逐方向评估互补能力或逐条证明冗余；PR1 是新增能力（收紧 frontier 必要域）；所有方向规则（低估安全、高估不安全）与不安全反例已写入。
- **测量（[measurements/substat-sum-bounds.md](measurements/substat-sum-bounds.md)）**：覆盖 **36 个基线 (场景, 职业) 实例** + **18 个验收 case / 52 个职业行**（直接解析 `docs/search-optimization/tools/run-acceptance.mjs` 的 `CASES`，含共享布局、食物策略与 GCD 约束）。联合 gear 上界相对逐属性相加收紧：基线 **0–28%**、验收 **12.4–28.2%**（平均 25.3%）；食物上界族相对“逐属性食物 max 相加”收紧：基线 **0–30%**、验收 **12.0–27.4%**；`R_food` 在基线 **18/36**、验收 **52/52** 个实例被合法完成精确达到（最大 gap 30 点；高品级下食物 cap 饱和）；安全下界 `L1`：基线 L50/L60 为 0、L100 为 2,291–4,241，验收 **986–3,753**；GCD 约束感知 Lagrangian 上界额外收紧最多 **1.49%**（λ 网格，非最优乘子）。**下界紧度**：`lower_gap = minAchievable − L1` 在基线 **36/36**、验收 **52/52** 行均为 **0**——`L1` 被构造的合法完成精确达到，因而当前数据下 `L1` 就是三属性和的精确最小值。原因是结构性的：允许食物池含“无 CRT/DHT/DET 加成”的食物（`L_food=0` 可实际选择），且 `L_gear` 由逐槽独立 min + 戒指精确最小配对可达；若食物池受限或加入 TEN/GCD 约束，`lower_gap` 可能 >0，真实最小值只能夹在 `[L1, minAchievable]`。测量只做候选池逐槽扫描，不运行搜索/MIP/benchmark；它是测量证据，不替代 §5 的证明。

**M. 三属性逐坐标下界 box、乘积下界与精炼迭代（用户扩展）**（[coordinate-lower-bound-box](theorems/coordinate-lower-bound-box/README.md)）

- **对象形式化**：`l_i(B) = min{ x_i : Phi(x) >= B }`（`Phi=F_C(C)F_H(H)F_D(D)`，`B` 是 `OPT_Phi` 的已证下界），取**全 3D 改善集**的坐标投影——不是"固定一个属性的 2D 切片"分析（那是对固定第三坐标的切片最大/端点/临界集，见 [pairwise-slice-critical-set](theorems/pairwise-slice-critical-set/README.md)）。
- **已证明（屏障 + 乘积下界）**：任意 maximizer `x*` 满足 `x*_i >= l_i(B)`；任意点只要某个坐标 `< l_i(B)` 就有 `Phi < B <= OPT`，即使其它坐标取多大都不是 maximizer；`Phi(l(B)) <= OPT`。`B` 必须是同域、经证明的下界；`B` 非法时屏障/乘积界失效（精确反例）。
- **盒域闭式**：`l_i^cap(B) = min{ c : F_i(c)·Π_{j≠i}F_j(κ_j) >= B }` 与 `l_i` 在盒域上**恒等**（一元、`O(#tiers)`/二分）；一般子域上 `l^cap <= l^D`（安全但更弱，slab 可严格：`(0,0,0)` vs `(0,66,80)`）。
- **精炼算子 `T(B)=max(B,Phi(l(B)))`**：安全、单调且**幂等** ⇒ 至多**一次**严格改进即稳定；精确阈值 `M = max_i F_i(c_i^opt−1)Π_{j≠i}F_j(κ_j)`，`T(B)=OPT ⇔ B>M`，`B<=M ⇒ T(B)<=M`（示例 `M/OPT≈0.99975`）；`B` 较低时通常立即停滞（`Phi(l)<B`）。
- **超集屏障（定理 1′）**：若 `D⊂Ω`、`B<=OPT_D`（`B` 是 **小域 D** 上的下界），则对 **D 的**每个 maximizer 有 `x*_i>=l_i^Ω(B)`、`Phi(l^Ω)<=OPT_D`、`T_Ω(B)<=OPT_D`——屏障/乘积下界/迭代对真实小域也有效（`l^Ω` 不必可达，不能当 incumbent；作为 `OPT_D` 的非构造下界合法）。若只知 `B<=OPT_Ω` 而 `B>OPT_D`，全部失效（精确反例 `D2`）。
- **价值判定**：box 剪枝恰是 [strict-improvement-frontier](theorems/strict-improvement-frontier/README.md) 的 **3 个轴方向支撑**，不增加剪枝强度；新增价值是**显式坐标屏障证书**、`Phi(l)` 的**非构造性 OPT 下界**、以及无需新真实见证的一次性精炼。**没有概率/经验依据**说"较大出现足够高的下界"；`B` 低时易停滞；不声称性能收益。真实域 `l` 的可达性、其它伤害因子耦合为未解决（§12）。

**N. 种族主属性变化与最优配装的不变性（用户扩展）**（[race-main-stat-invariance](theorems/race-main-stat-invariance/README.md)）

- **对象**：种族只改变攻击主属性的基础值 `B`（`value=B+a`，`a` 是装备+食物贡献）；目标 `D_B(x)=A_B(a(x))·Q(x)`；比较 damage/DPS 时问：换种族后原最优解是否仍最优、是否存在更优解。
- **实际候选域一般命题：已否证（真实精确搜索）**。在相同配置/候选池/食物/约束下，用精确求解器分别求 Human/Au Ra 全局最优：**页面可选**的 L70 BLM（sync375，360–390，`gcdTarget=2.5`，damage）Human 最优 `score=12.385384952246342`（GCD 2.50），Au Ra 最优 `score=12.354601735047163`（GCD 2.50）；Human 最优装备换到 Au Ra 基值后评分 `12.341774441851111`，**低于** Au Ra 真实最优 `12.354601735047163`，且两族最优装备 ID 不同（bracelet `24424→21565`）。这是两个种族各自精确最优之间的对照，不是“相对更优的构造向量”。
- **配装器分享链接**（Asvel 固定配装格式，含 BLM/L70/sync375/食物 49245）：
  - 人族最优：<https://asvel.github.io/ffxiv-gearing/?ABoe3N5w0dSHGGo1a7OhbOLSSnA73sYbgxU6TGCt14K1iX823>
  - 敖龙族最优：<https://asvel.github.io/ffxiv-gearing/?AFXUbFijlHBTAXIZovbcIjwezxWKeVb5Ix7ThavYCgW05wyZF>
- **追加方向反例（均为页面可选同步等级，`gcdTarget=2.5`）**：
  - 更高同步 BLM `sync665`（650–795，max−sync=130）：Human `56.15142038085938`/Au Ra `56.107528658166046`；Human 装备换族后 `56.08516501757813`，严格更低。链接：[Human](https://asvel.github.io/ffxiv-gearing/?hFGaRYPrf3c0qEd0KYEffbjFA9dj8n6W1iazuOQAP8oY2eUOz6YjkU9IGOYF8Zl) · [Au Ra](https://asvel.github.io/ffxiv-gearing/?abolY4EyFms1NIeK22RGSg5GV4q56CoTdxziylVvxUvPPGGsw0NnmiEGZvhpd3t)
  - 大同步差值 BLM `sync475`（460–795，max−sync=320）：Human `20.039108423178103`/Au Ra `20.004779323047984`；Human 装备换族后 `19.98919781689372`，严格更低。链接：[Human](https://asvel.github.io/ffxiv-gearing/?6wURr5j5rpQv4zqthEenLPJUTzL7SIXoz6xRDPtGqVLMmquB2Gi8F) · [Au Ra](https://asvel.github.io/ffxiv-gearing/?ibmSG1tU3EVcJNZlfGRx9MAeVFQgzFT8h93NokjZyx5ZjoRdXSTf)
- **等级 100 有限验证（未证明）**：21 个 100 级职业（无同步 770–795 damage）及 BLM/SAM/WHM/BRD/PLD 的 710–795、640–795 范围，Human/Au Ra 精确最优装备/食物 ID 全部相同；只有基础主属性/VIT 不同。未发现反例，但这不是一般性证明；L100 命题仍列为开放。
- **已证明的充分条件**：所有可行解主属性贡献相同（公共正因子）；攻击因子满足 `A_{B2}=c·A_{B1}`；或两族对每个可行主属性档位逐点相同（不跨档）。
- **有限域判据**：最优集合（按最终因子等价类）不变 ⇔ 所有两两比较符号不变。
- **当前实现范围**：规则固定人族·中原之民、`getBaseStats` 用 `clanStats[stat][0]`、优化配置无种族输入；UI 换种族不改变优化器输入是**实现事实**，不是数学不变性。
- **未解决**：L100 上的一般性证明/更大范围反例；约束/共享/食物百分比/HP/TEN 与种族耦合；见该目录 §7、§12。

## 6. 被否证的强猜想与精确反例

反例本身即否证；每条都可用 §10 的脚本复算。

| 被否证命题 | 精确反例（BigInt 复核） |
| --- | --- |
| 三对属性的**全域端点最大**：`G(x) <= max(G(0),G(S))` 对所有输入成立 | CRT-DHT：`level 60 BLU, b=(0,0), S=50, x*=3` → `4,670,062,193 > max(4,669,500,000, 4,664,755,200)`。CRT-DET：`level 70 WHM, b=(800,500), S=50, x*=42` → `1,229,109,401 > max(1,227,112,215, 1,227,719,688)`。DHT-DET：`level 70 WHM, b=(0,100), S=2000, x*=1026` → `5,399,709 > max(5,304,000, 5,300,330)`。实际尺度网格 36 个 `(pair,level,job)` 组合 × 20,736 切片**全部**出现反例；相对差：CRT-DHT 4–8 bp，CRT-DET 11–14 bp（50 级可达 1048/1171 bp），DHT-DET 27–364 bp（60–100 级）与 887/744 bp（50 级）。 |
| 评论 01 的 **single-crossing**：离散增量符号至多变化一次（`--0++`） | 步分类 + 平台对应定理：`level 70 WHM CRT-DHT b=(300,500) S=610` 切片 `J+=136`、`J-=305`、内部严格局部极大平台 `L_max=136`；`level 50 WHM DHT-DET b=(100,100) S=1000` 切片 `J+=861`、`J-=139`、`L_max=139`。符号多次变化，`G` 非单峰。 |
| **tier 级 log-convex/log-concave 可转移到 raw 坐标** | `level 70 DHT` 的 raw 二阶对数符号字为 `+-+--+-+--+-+--+--`（周期 18），**同时**取正负；36 个公式实例全部如此。raw 级既不 log-convex 也不 log-concave。 |
| “任意非恒定非减阶梯序列都同时出现两种二阶对数符号” | 假：`t(g)=g`、`F(t)=4000+t` 时 `Δ²log F < 0` 对所有 `g` 成立。故 raw 级结论必须逐实例证明/检查。 |
| **三顶点公式** `U = max(F(C0+R,H0,D0), F(C0,H0+R,D0), F(C0,H0,D0+R))` | `level 100 WHM, baseline=(200,200,200), R=610`：顶点最大 `4,312,925,593,600`，内部 `(c,h,d)=(9,245,356)` 得 `4,315,825,466,400`。`level 50 BLU, baseline=(200,200,200), R=1500`：顶点最大 `14,073,535,555,730`，内部 `(1396,1,103)` 得 `14,147,634,483,840`。每个支持等级都有精确反例。 |
| **边界归约**（最优解总可取在 simplex 边界） | 同上反例的内部点三个坐标全 `> 0`；且 `level 100` 例的内部值 `4,315,825,466,400` 严格大于边界最大值 `4,315,707,397,760`。 |
| **正文旧边际比较形式** `(F1·G0)^{cG} >= (G1·F0)^{cF}` 等价于单位成本对数比较 | `F0=10,F1=80,cF=3; G0=1000,G1=2000,cG=1`：真值与交叉指数判据均为**相等**（`8×10^10 = 8×10^10`），旧形式给出 `80,000` vs `8×10^12`（判“严格更差”）。另有顺序反转例（`F0=10,F1=11,cF=1; G0=20,G1=30,cG=2`）与 canonical 真实档位转移上的反转例（`level 100`：DHT `t0→1` 成本 6 vs CRT `t800→801` 成本 14）。 |
| `Math.trunc(v+1e-7) = floor(v)` 在**定义域外** `g < 0` 时也成立 | 定义域外输入：`level 70 WHM CRT, g=-450` → canonical `-49`，精确 floor `-50`；`g=-1000` → `-172` vs `-173`；`level 70 WHM DHT, g=-1` → `0` vs `-1`。注意：正式候选路径的贡献与档位实参恒非负（见 §5 A），该差异**不可达**，只作导出 API 稳健性说明。 |
| `K_w` 的 minimizer **恰好**是最小元集合 | 假：`w=(1,0,0)`、`B = F(100,70,150)-1` 时 900 个 argmin 中只有 3 个最小元（897 个非最小）；修正版 `K_w = min_{最小反链}` 与全部半空间结论仍成立。 |
| 顶点归约充分条件也是**必要**条件 | 假：存在 6 个精确实例（如 `level 50 WHM, b=0, R=15`）顶点最优但端点最大证书在同一切片失败。 |
| 单职业必要界的反向蕴含（损失和判据 ⇒ 单职业判据） | 假：`n=2, J*=8/5, u=(9/10,7/10)` 时两个单职业判据都不触发，损失和判据触发。正确方向是单职业判据的拒绝集 ⊆ 损失和判据的拒绝集。 |

## 7. 条件成立、未解决与开放问题

**条件成立（结论只在可检查前提下可用，否则必须回退）**

- `raw-tier-transform`：闭式/周期层的所有结论要求整数 `g` 落在可达域 `0 <= g <= min(G_max, 10^7)`（其中 `g >= 0` 与实参非负由基础属性归约 + 候选贡献非负结构性成立）、六档等级参数与当前数据事实未变、`floor = Math.trunc(v+1e-7)` 的 binary64 语义未变；任一失败 ⇒ 回退生产 evaluator。定义域外（负贡献/负食物参数/自定义 extractor）不属于正式候选路径。
- `tier-log-curvature`：凸/凹分支只在可达档位区间**不跨** 808/809（普通）或 921/922（BLU）时整体可用；跨切换必须分段或回退。
- `pairwise-endpoint-max`：端点最大只在 `max_{K_L} G <= max(G(lo),G(hi))`（精确判据）通过时成立；两条常量档位引理是仅有的闭式充分条件。逐点比率分离型条件被证明**必然失效**。
- `simplex-vertex-reduction`：顶点归约只在三对属性全切片端点最大证书通过时可用；实践中该证书经常失败，因此默认应使用 `free-budget-upper-bound` 的精确公式。
- `strict-improvement-frontier` / `joint-loss-sum-bound`：`B`、`U_j(s)`、`B_j`、`J*` 必须是已证明的**严格乐观**界且用精确有理/BigInt 比较；任一不成立 ⇒ 跳过该层，不允许用经验阈值替代。

**未解决/开放**

1. 端点最大成立域的**精确刻画**与除两条单调引理外的闭式充分条件（现状：只有精确判据，没有更便宜的闭式条件）。
2. 关键集 `K` 能否在不加结构的前提下继续缩小（只有端点/单峰/残类反例证据，未证明不可能）。
3. 联合步符号的闭式判据；无条件、相位无关的 `L_max = Θ(...)` 下界（现有为“已证明的界 + 精确计数证书”）。
4. 顶点最优性的**最紧可检查条件**；参数化/离线证书覆盖 `(b,R,κ)` 区间；部分归约之外的边界分类。
5. 可计算的**紧联合耦合界**（不枚举共享方案集、不求解 `|S|` 规模 LP，且严格优于解耦界）。
6. 真实装备域中交换封闭性的条件、共享身份/戒指/食物的形式化、食物与 GCD 的耦合。
7. 三因子联合边际、整数预算+异步档位下贪心策略的正确性、包络查询的最优复杂度、两不等步长跳档的完整符号分类。
8. 与既有 fixed-point log 体系的对接；`ceil` 缩放取整的运行时契约；tie/身份语义在搜索层的接口。
9. 生产集成与形式化：阈值/周期查询器未实现；浮点截断等价未用 SMT/Lean 形式化；数据前提（A4）只由验证脚本覆盖，建议在装载处加断言。
10. 自定义武器（Manderville/义军）/BLU 的 `U_j(s)` 构造、仅“基线上界”语义、混合目标与不活跃职业。
11. 三属性和的**带食物精确最大值**（`bonus` 依赖总贡献 `G`，逐槽不再可分离；需 DP 或更细的耦合上界，见 [substat-sum-upper-bound](theorems/substat-sum-upper-bound/README.md) §12）；以及约束（速度/TEN 带）下的精确最大值（二维背包/DP）。
12. 真实域（候选池可达集）上的逐坐标屏障 `l^Reach`：需要真实改善集坐标投影/固定切片 2D 最大值与可达性认证；`q/g`（武器/主属性/坚韧/GCD）与三属性耦合时的乘积下界紧致化（[coordinate-lower-bound-box](theorems/coordinate-lower-bound-box/README.md) §12）。
13. 等级 100 上“换种族/主属性基础值变化”是否普遍保持最优：已有 21 职业 + 多范围精确搜索未发现反例，但未证明；等级 90 的真实反例已确认。需要更大范围最优性复核/一般结构证明，以及约束/共享/食物百分比/HP/TEN 耦合模型（[race-main-stat-invariance](theorems/race-main-stat-invariance/README.md) §7.3–§7.4）。

## 8. 未做的性能验证（明确未评估）

评论 02 §十 的性能收益清单**本轮全部未做**，且不得据此宣称任何提速或生产搜索验收：

- 候选剪枝数量、分支剪枝数量、MIP rows/nonzeros、root dual bound、节点数、证明时间、总耗时、峰值内存；
- 预处理成本（阈值表、关键集、支持族、周期表）与 `bound gap` 的取舍；
- 单职业 vs 联合的**增量**剪枝对比（single-job necessary cuts vs joint loss-sum cuts）；
- 50/60/70/80/90/100、普通/BLU、不同 sync 与职业组合的覆盖基准；
- 与现有 `candidateUpperBound*`、`factor-resource-budget-upper-bound` 的公平对照。

本轮**没有修改任何生产代码/生成数据**，因此也不存在搜索验收结果；`verify.mjs` 与验证脚本只是有限域数学证书，不是性能测试。

## 9. baseStat 影响审计（第二轮）

用户指出：三属性在 `equipped-effects.ts` 中都是先加 `baseStats` 再减偏移，因此需要核对各定理是否受「等级自带基础属性」影响。六个子代理对各自负责的定理目录做了逐条审计，结论与处置如下；每篇定理 README 末尾均有统一标题的 **`## 13. baseStat 影响审计（贡献坐标 vs 面板总值）`**（坐标声明、归约链、逐命题判定表、数值复核、应用契约、结论）。

**统一事实链**：`value = baseStats[stat] + gearAndFoodValue`；`baseStats.CRT = baseStats.DHT = baseStats.TEN = sub`、`baseStats.DET = main`（[参考模型 §2.1](canonical-evaluator-reference.md)）⇒ `value − offset = 贡献 g`。正式候选路径贡献逐项非负，故档位实参恒非负（CRT `>=50`、DHT `>=0`、DET `>=200`、TEN `>=1000`），`Math.trunc(v+1e-7)=floor(v)` 结构性成立（[参考模型 §2.2](canonical-evaluator-reference.md)）。**所有定理的自变量本来就是贡献 `g`，数学结论与证明不受影响、无需改述**；受影响的是「坐标标签是否显式」以及个别示例的输入坐标。

| 定理目录 | 是否受 baseStat 影响 | 处置 |
| --- | --- | --- |
| [raw-tier-transform](theorems/raw-tier-transform/README.md) | 否（Lemma 4.2 是唯一显式用面板值的命题，即归约本身） | 补 A8、Lemma 4.3b、坐标契约；无定理/数字改动 |
| [tier-log-curvature](theorems/tier-log-curvature/README.md) | 否（`F/E/比值/切换点` 只定义在档位 `t`） | 补 `g_808`/raw 表的贡献语义；新增面板误用偏差表（L50 +200 … L100 +30） |
| [marginal-comparison](theorems/marginal-comparison/README.md) | 否（纯代数；因子值 + 贡献单位成本） | 补坐标前提与换算；verify 新增坐标审计 |
| [raw-marginal-envelope](theorems/raw-marginal-envelope/README.md) | 否（窗口/周期/成本只由 `(a,b,q,mult)` 决定） | 补坐标声明与面板等价；verify 新增坐标审计 |
| [pairwise-endpoint-max](theorems/pairwise-endpoint-max/README.md) | **是（1 处坐标标签错误）** | 评论 01 复现切片原把面板 `(739,743,610)` 当贡献；改为贡献 `(375,379,610)` 并**重算**（见下） |
| [pairwise-slice-critical-set](theorems/pairwise-slice-critical-set/README.md) | 命题否；同一表行误标 | 修正 `U_m` 紧度表行；新增相位敏感性说明（面板 `739 mod 9 = 1` vs 贡献 `375 mod 9 = 6`） |
| [free-budget-upper-bound](theorems/free-budget-upper-bound/README.md) | 否 | 补 `U(b,R,κ)` 的贡献坐标契约（`b` 贡献基线、`R` 贡献预算、`κ` 贡献 cap）；verify 新增 E 段 |
| [simplex-vertex-reduction](theorems/simplex-vertex-reduction/README.md) | 否 | 另修正一处**非 baseStat** 可实现性问题（见下） |
| [strict-improvement-frontier](theorems/strict-improvement-frontier/README.md) | 否（`B` 只经因子乘积与其它乘子乐观最大值） | 补坐标声明、面板换算契约；verify 新增 A12 |
| [attribute-swap-criterion](theorems/attribute-swap-criterion/README.md) | 否（交换判据平移不变，偏移在差分中消去） | 补坐标声明与面板等价；verify 新增 B8 |
| [joint-loss-sum-bound](theorems/joint-loss-sum-bound/README.md) | 否（目标值/归一化比例命题） | 补 `U_j(s)` 与 `U(b,R,κ)` 契约对齐；verify 新增 V10；另登记攻击主属性基值一般 `!= main`（本文不依赖） |

**审计中发现并已修正的两处问题**

1. **坐标标签错误（pairwise-endpoint-max，唯一 baseStat 实质影响）**：评论 01 的复现切片原写作 `bases=(739,743), S=610`，但 739/743 是**面板总值**。70 级 `sub=364`、`main=292`，正确贡献为 CRT/DHT `375/379`、固定 DET `477`。修正后全部数字重算：
   - 最大值 `5,541,801,705 @x=607` → **`4,935,252,016 @x=606`**；端点 `4,899,756,356 / 4,931,755,144`（仍高于右端点 7.1 bp，端点最大反例成立）；
   - 事件结构质变：CRT 跳变 `0 纯 + 135 联合` → **`67 纯 + 68 联合`**；DHT 下降 `237/135` → **`305/68`**；上升/下降/平坦 `135/237/238` → **`135/305/170`**；`L_max=135` 不变；
   - 命名的证明与结论不变（自变量本就是贡献），`verify.mjs` 增加「面板误用对照」断言防回归。
2. **可实现性问题（simplex-vertex-reduction，非 baseStat）**：level 90 见证原用 `level 90 + BLU`，但生成数据 BLU `maxJobLevel=80`，不可实现。改为 `level 90 WHM, baseline 贡献 (100,100,100), R=100`：内部最优 `(5,59,36)=4,188,911,638,660` > 顶点最大 `4,185,899,815,400` > 边界最大 `4,188,024,835,800`（gap 7.19 bp / 2 bp）；Lead 已用独立实现复算一致。

**方法论与运行契约**

- 运行时唯一合法坐标是**贡献 `g`**；面板→贡献：CRT/DHT/TEN 减 `sub`、DET 减 `main`（三者偏移不同，**不可统一平移**）。
- 把面板值直接代入贡献公式会改变档位与相位（例：level 100 贡献 `g=200` 的档位 `(64,39,1010)`；若把面板 `620` 当贡献则得 `(94,122,1032)`）。
- 同一属性内阈值差（跳档成本）在纯常数平移下不变，但**跨属性/跨坐标混用会使成本不可比**；因此不得因「差不变」而混用坐标。
- 导出 API 边界的 `g >= 0` 防御性断言保留，但它是稳健性措施；正式候选路径由数据与构造保证非负，不是定理正确性前提。
## 10. 验证与证书

所有脚本均为只读、纯整数计算；运行方式：

```text
node --experimental-strip-types docs/mathematical-analysis/verification/<script>.mjs
node --experimental-strip-types docs/mathematical-analysis/theorems/<name>/verify.mjs
```

**共享脚本**（[verification/README.md](verification/README.md) 有完整覆盖说明）：

- `verify-canonical-model.mjs`：整数模型 vs 生产 canonical evaluator，**1,572,524** 个档位点 + **39,744** 个因子点逐点一致；数据侧贡献非负性扫描与 552 个档位实参最小值 `>= 0` 的结构性证书；另含定义域外截断差异反例（不可达，稳健性）。PASS。
- `verify-theorem-claims.mjs`：独立核对 E_b 闭式与切换点、DHT/DET `-k²`、三组端点最大反例、平台/局部极大计数、U 的 tier-triple 公式（90 组）、顶点反例、旧边际形式反例、U 与 `prepareSubstatFactorBudgetQuery` 一致性（30 组）、`D_min`/`K_w`/半空间安全性。PASS。
- `search-counterexamples.mjs`：端点最大与顶点公式的精确反例搜索（含实际尺度网格统计）；raw 级符号序列。PASS。
- `verify-sum-bounds-independent.mjs`（Lead 侧独立交叉核验）：199 个随机小模型逐点穷举核对 `L1<=minS`、`maxS<=R_food`、`R_gear^uniq=穷举 maxGear`、`R_gear<=R_sep`、`B1-B4` 安全；600 个 Lagrangian 乘子点核对速度/TEN 弱对偶上界；81 个 `(C,H)` 格点核对 PR1 的 D_min slab 公式；K_sum 割安全性抽查。PASS。
- `measure-sum-bounds.mjs`（**测量，不是证明**）：用生产 `prepareSearch` 只构造候选池，逐槽扫描 36 个基线 (场景, 职业) 实例，并解析 `run-acceptance.mjs` 的 18 个验收 case / 52 个职业行；含 2,000 次/实例确定性抽样断言 `L1 <= S <= R_food`、戒指配对暴力交叉核对、速度区间语义断言（`equippedSpeedRangeForGcd` 端点 GCD 必须等于目标）、GCD 约束感知的 Lagrangian 上界，以及**下界紧度** `lower_gap = minAchievable − L1`（基线 36/36、验收 52/52 行为 0：当前食物池下 `L1` 可达，是精确最小值）；生成 [measurements/substat-sum-bounds.md](measurements/substat-sum-bounds.md)。不运行搜索/MIP/benchmark。

**15 个定理目录的 `verify.mjs` 全部 PASS**（2026-10-18 复核）：`raw-tier-transform`、`tier-log-curvature`、`marginal-comparison`、`raw-marginal-envelope`、`pairwise-endpoint-max`、`pairwise-slice-critical-set`、`free-budget-upper-bound`、`simplex-vertex-reduction`、`strict-improvement-frontier`、`attribute-swap-criterion`、`joint-loss-sum-bound`、`substat-sum-upper-bound`、`substat-sum-lower-bound-pruning`、`coordinate-lower-bound-box`、`race-main-stat-invariance`。覆盖量与证明作用见各 README §10/§11 与脚本头部。另：`race-main-stat-invariance/real-search-verify.mjs` 与 `real-search-directions.mjs` 用生产精确求解器复核页面可选 L70/L90 的反例及 sync665/sync475 两个方向，PASS（不属于公式域证书；会运行搜索）。

### 修订后的实现前提（由安全修订归纳）

| 修正点 | 实现前提 / 禁止项 | 详见 |
| --- | --- | --- |
| caps 绑定的部分归约 | 无 cap 绑定（`S*<=min(κ_i,κ_j)`）⇒ 两零 facet；一般 caps 必须用四类 facet `{x_i=0,x_j=0,x_i=κ_i,x_j=κ_j}` 精确公式；不得把二 facet 低值当上界 | [simplex-vertex-reduction](theorems/simplex-vertex-reduction/README.md) §5 定理 4(2)、§7.4 |
| 端点扫描 | `G_{ij}` 已含第三因子 `F_k`，外层不得再乘；只扫描 `K_feas=[max(0,S*−κ_i−κ_j), min(κ_k,S*)]` 的非空切片，`L>U` 的空切片不可强行取端点 | [simplex-vertex-reduction](theorems/simplex-vertex-reduction/README.md) §6.4、§11 |
| slab 收紧 | `Ω_slab` 非坐标上集：半空间安全/`K_w` 集合单调可继承；D_min 单调、tier 单元常值、最小反链/代表元枚举**不继承**，须 `(C,H)` 全枚举或重新推导 | [strict-improvement-frontier](theorems/strict-improvement-frontier/README.md) Theorem 1.5、§7.6；[substat-sum-lower-bound-pruning](theorems/substat-sum-lower-bound-pruning/README.md) PR1 |
| `B=P*` 的空改善域 | `G_>(B)=∅ ⇔ B>=P*`；`G_>=(B)=∅ ⇔ B>P*`。`B=P*` 时非严格域 = argmax 非空，tie/最优方案必须保留 | [strict-improvement-frontier](theorems/strict-improvement-frontier/README.md) Theorem 4.1、§7.5 |
| 同分点/整除 | `O` 整除 `P_inc` 只是整数性，不足以保证同分点；需 `P_inc/O ∈ Φ(Ω)`；DPS 需实际可达 `(other,gcd)` 的精确交叉等式 | [strict-improvement-frontier](theorems/strict-improvement-frontier/README.md) Lemma 0.3、§7.7 |
| 义军武器 `R_sep` | 三个目标属性的**固定贡献全部保留**，只把可分配增量限定在 `I=stats∩{CRT,DHT,DET}`：`R_sep_weapon=S3(x0)+Σ_{i∈I}min(m_i,T)`；不可只对 `i∈I` 求和（会低估） | [substat-sum-upper-bound](theorems/substat-sum-upper-bound/README.md) 定理 3、§7 |
| 增量预算 | `U(b,R,κ)` 的 `R` 是相对 baseline 的增量；最小合法增量预算 `R*=S*−Σ_i b_i`（`b=0` 时即 `S*`），不是最终绝对和 `S*` | [substat-sum-upper-bound](theorems/substat-sum-upper-bound/README.md) 定理 7 |
| 界的可比性/PR6 | `U` 与 frontier/PR6 保留的约束不同，不能全序比较；PR4/5 仅在相同约束口径下讨论支配，PR6 含加权方向、默认不能排除 | [search-value-ranking.md](search-value-ranking.md) §2.2、§4 |
| tie 证书的整数精度 | 构造 `P_inc` 起全链 BigInt + 精确 floor/ceil；禁止 >2^53 的 Number 中间值，必须验证 `P±1` 边界 | [strict-improvement-frontier](theorems/strict-improvement-frontier/verify.mjs) A13、README §11 |

历史审查记录已并入本表；**不能**以旧 `verify.mjs` 仍 PASS 作为关闭依据。接入生产剪枝前，上表各项必须通过实现侧回归与 A/B（本轮未做）。

**边界**：有限域证书只排除“在所列点上定理与生产实现不一致”，**不构成一般性证明**；反例是否证（单个反例即足以否证全称命题），但不证明任何肯定性命题。一般性证明在两个层次的文档中给出（`canonical-evaluator-reference.md` 提供事实基础，各定理 README §5/§6 给证明）。

**审阅记录**：Lead 对每个定理目录做了独立复核（重新推导关键不等式、用独立实现交叉核对数值、检查状态标签与回退前提）。复核中修正的实质错误包括：raw 级“严格交替”表述（实际为 18 周期字）、等级 50 DHT-DET 的局部极大平台数（`139`，不是 `861`）、正文旧形式的对数偏差恒等式（`(cG-cF)ln(F0G0)`，不是 `(cG-cF)ln(G0/F0)`）、`free-budget-full-solution` 目录命名、跨文档定理字母标签。第二轮 baseStat 审计（§9）又修正了评论 01 切片的坐标标签（面板值当贡献）与 level 90+BLU 不可达见证。所有修正已落入对应文档。

## 11. 与 canonical evaluator 的对应和适用边界

- **事实基础**：[canonical evaluator 参考模型](canonical-evaluator-reference.md) 登记等级参数、基础属性归约、整数档位模型、精确因子、源码 `file:line`、定义域与数据版本；各定理引用它而不是复制公式。
- **生产入口**：`equippedAttributeTier` / `createIntegerDamageFactorEvaluator`（`equipped-effects.ts:59-166,205-292`）；精确比较 `candidateUpperBoundIsStrictlyWorse` / `candidateUpperBoundCannotImproveIncumbent`（`exact-mip-candidate-upper-bound.ts:96-140`）；联合单职业界 `joint-candidate-upper-bound.ts:10-22`；正式搜索使用的单资源上界 `prepareFactorResourceBudgetUpperBound`（`factor-resource-budget-upper-bound.ts:88-147`，调用点 `loadout-finder-exact-mip.ts:1267,1353`）；`prepareSubstatFactorBudgetQuery`（`substat-factor-budget.ts:71-171`）是 `U` 精确公式的实现基础但**未接入正式搜索**。
- **适用边界**：定理只在公式坐标上成立；不认证真实装备合法性、不替代最终 exact 比较。任何一层剪枝的最终认证仍是 `candidateUpperBoundCannotImproveIncumbent`（伤害与 DPS 的精确 BigInt 交叉乘法）。“不能严格改善 incumbent”（`<=`）与“可以删除同分方案”是不同命题，后者只能由显式 tie 语义与身份比较处理。
- **数据/源码依赖**：数据版本 `mcp-2026.09.15.0000.0000-upstream-048376fb6c6c-level-basis-v2`；若生成数据或公式源码变化，必须重跑 `verify-canonical-model.mjs` 并重新核验各定理的数据前提（A4/A5 等）。

## 12. 目录结构与新增约定

```text
docs/mathematical-analysis/
  README.md                     本索引
  issue-3-body.md               正文快照（背景）
  issue-3-comment-01.md         评论快照
  issue-3-comment-02.md         最新评论快照（权威要求）
  canonical-evaluator-reference.md   共同事实基础
  theorems/<english-theorem-name>/README.md
  theorems/<english-theorem-name>/verify.mjs   （可选）有限域证书
  verification/                 共享模型与证书脚本
```

- 每个**独立定理**一个英文 lowercase-kebab-case 子目录；相关引理随所属定理组织；跨定理依赖用相对链接。
- 每个定理 README 必须含：状态（已证明/已否证/条件成立/未解决）、符号与量词、完整假设与定义域、精确命题、逐步证明或精确反例、边界/退化、依赖与关联、与 canonical evaluator 的对应、应用前提与安全回退、验证证书及其覆盖范围、未解决问题。
- 有限样本不能替代一般性证明；有限域穷举必须写明完整定义域、覆盖性论证与可复验证书。不得用“显然凸/数值上成立”替代关键论证；必须区分充分与必要、以及“存在顶点最优解”与“所有最优解都在顶点”。
- 不引入经验阈值。证明或前提不可用时跳过该层剪枝或回退已有严格上界；保留 tie semantics。
- 后续新增评论：先按 §1 流程同步为 `<comment-NN>.md` 并更新本索引与映射表，再开始分析。
