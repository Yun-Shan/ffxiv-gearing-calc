# 验证脚本与证书

本目录保存 `docs/mathematical-analysis/theorems/` 的**有限域证书**与可复核数值产物。

**坐标约定**：脚本中的 `g`、阈值、baseline、预算 `S`/`R` 都是**属性贡献**（装备+食物），不是角色面板总值；面板总值 = 基础属性 + 贡献（CRT/DHT/TEN 的基础属性为 `sub`，DET 为 `main`，见[参考模型 §2.1](../canonical-evaluator-reference.md)）。把面板值直接当贡献输入会使档位偏移，脚本不这么做。所有脚本都是纯整数计算，**不启动装备搜索、装备组合穷举、MIP/求解器、benchmark 或正式验收**；它们只调用纯函数、生成数据字节与 canonical evaluator 的纯计算入口。

## 运行

```text
node --experimental-strip-types docs/mathematical-analysis/verification/<script>.mjs
```

依赖：Node（类型剥离，直接 import 生产 `.ts` 源码）与仓库内 `src/data/generated-data.bin`（只读）。脚本不写任何文件。

## 文件与覆盖范围

### `canonical-model.mjs`

共享的整数模型库（被其它脚本与定理目录的 `verify.mjs` 引用）：

- `DOCUMENTED_LEVEL_PARAMS`：文档登记的六档等级参数（生成数据变化时脚本会断言不一致）。
- `loadGameData()` / `loadCanonicalEvaluator()`：注入 `generated-data.bin` 字节后直接 import `src/domain/data.ts` 与 `src/domain/search/equipped-effects.ts`（生产 canonical evaluator，不是重新实现）。
- `tier(level, job, stat, g)`：`t(g) = c + mult*floor((a*g + b)/q)` 整数档位模型。
- `firstContributionWithTierAtLeast(...)`：阈值闭式 `g_k = ceil((ceil((k-c)/mult)*q - b)/a)`。
- `tierPeriod(...)`：`d = gcd(a,q)`、`P = q/d`、档位平移量 `mult*a/d`。
- `criticalFactor` / `directHitFactor` / `determinationFactor` / `factorsAt`：精确因子与乘积。
- `floorDiv` / `ceilDiv`：BigInt 精确整数取整，避免浮点边界。
- `assert`。

### `verify-canonical-model.mjs`

**有限域逐点对照**（不是抽样）：

| 项 | 规模 |
| --- | --- |
| 等级参数与文档一致性 | 6 档 × 5 字段 |
| 基础属性归约（`g=0` 档位） | 92 个 (job, level, stat) 组合 |
| 档位模型 vs canonical `equippedAttributeTier` | 1,572,524 个 (level, job, stat, g)，`g ∈ [0, 3000]` |
| 因子模型 vs canonical `createIntegerDamageFactorEvaluator` | 39,744 个 (level, job, CRT, DHT, DET) 组合 |
| 阈值/跳档成本闭式 | 16,974 个点 |
| 窗口档位增益引理 `t(g+δ)-t(g)=mult*floor((r+aδ)/q)` | 65,016 个点 |
| 可达域档位实参非负（`V(0)=b/q+c >= 0`，552 个 `(level,blu,stat)`）与数据侧贡献非负性扫描 | 全部 `>= 0`，全局最小 `0`（普通 DHT，贡献 0） |

另含**定义域外截断差异的反例**：`level=70, WHM, CRT, g=-450` 时 canonical 给 `-49`，精确 floor 为 `-50`。该差异只在 `g < 0` 时出现；正式候选路径的贡献逐项非负（数据扫描见上表），且 `baseStat(CRT/DHT/TEN)=sub`、`baseStat(DET)=main` 使档位实参恒 `>= 0`（CRT `>=50`、DHT `>=0`、DET `>=200`、TEN `>=1000`），因此负实参**不可达**。结构性证明见 [raw-tier-transform](../theorems/raw-tier-transform/README.md) Lemma 4.3b 与[参考模型 §2.2](../canonical-evaluator-reference.md)；上面的反例只作导出 API 稳健性说明。

**证明作用**：排除「整数模型与生产实现不一致」这一类错误，覆盖上述有限点。**不是**一般性证明；一般性证明在对应定理 README。

### `search-counterexamples.mjs`

**否证性证书**：在显式列出的有限网格上精确搜索反例。

| 节 | 内容 |
| --- | --- |
| §1 | 三属性对 × 六等级 × BLU/普通 × baseline ∈ {0,100,200,300,500,800,1200,2000}² × `S ∈ {50,100,200,400,610,800,1000,1500,2000}`：端点最大反例，给出最小反例与典型明细 |
| §1b | 实际尺度网格上的反例计数与最大相对差（CRT-DHT ≈ 4–8 bp，CRT-DET ≈ 11–14 bp，DHT-DET 最大 ≈ 180 bp @ 70 / ≈ 1048 bp @ 50） |
| §2 | 三属性自由预算：`baseline` × `R ∈ {50,100,200,400,610,800,1200}` 的完整 simplex 枚举与三顶点比较 |
| §2b | 较大预算 `R ∈ {300,610,1000,1500}` 的顶点公式反例 |
| §3 | raw 序列（floor 后）二阶对数差符号序列，证明 raw 层既非对数凸也非对数凹 |

**证明作用**：反例本身即全称命题的否证（精确整数，可手工复核）。网格「未发现反例」的结论**不构成**证明，脚本输出中已明确标注。

### `verify-theorem-claims.mjs`

**定理断言的独立核对**（不依赖定理文档作者的自述）：

| 节 | 核对内容 | 作用 |
| --- | --- | --- |
| A | `E_b(t) = 2e6 - 2t² - (2b+4)t - (b+1)²` 与符号切换：b=350 在 808/809（E(808)=2239，E(809)=-1699），b=150 在 921/922（E(921)=733，E(922)=-3257） | 代数证明的有限旁证 |
| B | `F(t)=A+t` 族二阶判据 `F(t+2k)F(t)-F(t+k)² = -k²` | 代数证明的有限旁证 |
| C | 三个属性对的端点最大反例（精确乘积与端点值） | 否证证书 |
| D | 切片平台结构：上升步数 = 内部局部极大平台数；level 70 CRT-DHT (300,500,610) 为 136；level 50 DHT-DET (100,100,1000) 为 861 | 结构性非单峰的证书 |
| E | `U(b,R)` 的 tier-triple 预算公式 vs 暴力枚举（90 组） | 公式实现的有限核验；一般性证明在 free-budget-upper-bound |
| F | 三顶点公式反例：level 100 baseline (200,200,200) R=610（内部 4,315,825,466,400 > 顶点 4,312,925,593,600）；level 50 BLU R=1500 | 否证证书 |
| G | 交叉指数判据 vs issue 正文形式：`F0=10,F1=80,cF=3; G0=1000,G1=2000,cG=1` 时真值相等，正文形式给出不等 | 否证证书（正文公式不等价） |
| H | 现有 `prepareSubstatFactorBudgetQuery` 的返回值与 `U(0,R)` 精确公式一致（30 组） | 「U 的精确形式已被现有实现覆盖」的对应性证书 |
| I | 小域 `Omega=[0,60]³`、`B=4.1e12`：`D_min` 关于 C/H 非增；5 个方向的 `K_w` 前沿公式与暴力一致；所有改善点满足 `w·x >= K_w` | 前沿/半空间正确性的有限核验 |

### `verify-sum-bounds-independent.mjs`

**Lead 侧独立交叉核验**（与两个定理目录的 `verify.mjs` 实现相互独立，只复用 `canonical-model.mjs` 的整数工具）：

- 199 个随机小模型（2–3 槽、每槽 1–4 候选、戒指唯一性、2 食物、含/不含约束）逐点穷举：
  `L1 <= min S`、`max S <= R_food`、`R_gear^uniq = 穷举 maxGear`、`R_gear <= R_sep`、`B1–B4` 安全且 `B4<=B1,B2`；
- 600 个 (模型, 乘子) 点：速度 `<= v_hi`、TEN `>= t_lo`、TEN `<= t_hi` 的弱对偶上界 `>=` 穷举约束最大值；
- 81 个 `(C,H)` 格点：PR1 的 `D_min` slab 重定义公式与 slab 内直接定义逐点一致；
- 抽象乘积模型：`Σ < K_sum` 的点都不是严格改善点（K_sum 割安全性）。

运行：`node --experimental-strip-types docs/mathematical-analysis/verification/verify-sum-bounds-independent.mjs`。**证明作用**：有限随机安全性的反证器（发现反例即定理失效）；不是一般性证明。

### `measure-sum-bounds.mjs`（测量，不是证明）

用生产 `prepareSearch(config, {})` **只构造候选池**（不运行搜索、不调用 MIP 求解、不做 benchmark），逐槽扫描 CRT/DHT/DET 贡献：

- 计算 `R_sep`、联合 gear 上界 `R_gear^uniq`（含戒指唯一性精确配对与义军武器精确和）、安全下界 `L_gear^uniq`/`L1`、食物上界族 `R_food` 与 naive 对照；
- 36 个基线 (场景, 职业) 实例（WAR/WHM/DRG/BLM × native L50–L100 + endgame-sync L70/L80/L90）；
- **验收场景**：直接解析 [run-acceptance.mjs](../../search-optimization/tools/run-acceptance.mjs) 的 `CASES`（18 个 case / 52 个职业行；含共享布局、食物策略与 GCD 约束），逐 case 逐职业测量；
- GCD 约束：用生产 `equippedSpeedRangeForGcd` 得速度贡献区间，并计算速度约束感知的 Lagrangian 上界（λ 网格）；同时断言区间端点的 GCD 与目标一致（语义检查）；
- 每实例 2,000 次确定性抽样断言 `L1 <= S <= R_food`；小规模戒指实例用 `O(n²)` 暴力交叉核对配对算法；
- 下界紧度：构造最小侧合法完成并与抽样最小值取小得 `minAchievable`，测 `lower_gap = minAchievable − L1`（基线 36/36、验收 52/52 行为 0；当前食物池允许无三属性加成的食物，故 `L1` 可达、是精确最小值）；
- 生成可复现报告 [measurements/substat-sum-bounds.md](../measurements/substat-sum-bounds.md)。

运行：`node --experimental-strip-types docs/mathematical-analysis/verification/measure-sum-bounds.mjs`。**证明作用**：测量/证据，用于检验候选池尺度的收紧与紧度；不替代定理证明。

## 证书的边界

- 上述所有内容都是**有限域证书**或**反例**。有限域逐点核对不能替代一般性证明；反例可以否证全称命题，但不能证明任何肯定性命题。
- 一般性证明、适用前提、反例的代数结构与安全回退写在 `docs/mathematical-analysis/theorems/<name>/README.md`。
- 证书依赖的等级参数、基础属性归约与生成数据版本登记在 [canonical-evaluator-reference.md](../canonical-evaluator-reference.md)；数据变化时必须重跑 `verify-canonical-model.mjs`，失败即表示文档事实基础失效。
