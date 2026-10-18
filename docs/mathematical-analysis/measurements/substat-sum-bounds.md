# 三属性贡献和的上下界：候选池测量（mcp-2026.09.15.0000.0000-upstream-048376fb6c6c-level-basis-v2）

> 本文件由 [`measure-sum-bounds.mjs`](../verification/measure-sum-bounds.mjs) 生成（可复现，无时间戳）。
> 这是**测量/证据**，不是定理证明；定理本身见 [substat-sum-upper-bound](../theorems/substat-sum-upper-bound/README.md)
> 与 [substat-sum-lower-bound-pruning](../theorems/substat-sum-lower-bound-pruning/README.md)。

## 1. 目的

在真实候选池上测量三属性贡献和 `S = CRT + DHT + DET` 的：

- 联合 gear 上界 `R_gear^uniq`（逐槽 `max S3` 求和 + 两戒指唯一性精确配对 + 义军武器精确和）；
- 逐属性上界 `R_sep = Σ_i Σ_s max_c x_i(c)`（“逐属性最大相加”式上界）；
- 安全下界 `L_gear^uniq` / `L1`（逐槽 `min S3` + 戒指精确最小配对 + 食物下界）；
- 食物感知上界族 `R_food = max_f min_k B_k(f)`（B1–B4）；
- 速度（GCD）约束感知的 Lagrangian 上界 `R_food|speed`（验收场景中的 GCD 约束）。

覆盖两组场景：

- **基线场景**：WAR / WHM / DRG / BLM × {native L50–L100, endgame-sync L70/L80/L90}；
- **验收场景**：直接解析 [`run-acceptance.mjs`](../../search-optimization/tools/run-acceptance.mjs) 的 `CASES`
  （18 个 case / 52 个职业行，含共享布局、食物策略与 GCD 约束）。

## 2. 方法（只做候选池构造，不运行搜索）

对每个 `(场景, 职业)`：

1. 用生产 `prepareSearch(config, {})` 构造候选池（装备 + 固定镶嵌模式 + 食物池）；**不调用** `findBestLoadoutExactMip`、不运行任何搜索、不求解 MIP、不做 benchmark。
2. 逐槽扫描候选：`SolverGear.baseParams` 的 CRT/DHT/DET 分量（贡献坐标）求和；义军武器的分配变量按 `maxTotalStats`/`maxEachStat`（含同步 `statMaximums`）取精确和上界；约束场景中若义军分配涉及速度则回退为无约束界并标记 `*`。
3. 两戒指槽用唯一性精确配对（按 `itemId` 折叠后 top/second 分类）；小规模实例用 `O(n²)` 暴力交叉核对（本报告覆盖 80 个实例）。
4. 食物加成用 canonical 精确有理数：`bonus_i(f,G) = min(cap, floor((G + baseValue) * rate))`；公式与 `canonicalFoodBonusUpperBoundAtRaw` 在 9,048 个点上一致（见上界定理 `verify.mjs`）。
5. 速度（GCD）约束：用生产 `equippedSpeedRangeForGcd(job, jobLevel, gcd)` 得到**总速度贡献**区间（`gcdChoices` 取并集、`gcd` 与 `gcdChoices` 同时存在时取交集）；上界用 `S <= Σ max[S3 − λ·speed] + λ·vmax + 食物上界`，下界用 `S <= Σ max[S3 + λ·speed] − λ·(vmin − 食物速度上界) + 食物上界`（弱对偶；λ 取 `p/16` 网格，界合法但不是最优乘子）。
6. 每个 `(场景, 职业)` 做 2,000 次**确定性随机抽样**（随机合法完成 + 随机食物），断言 `L1 <= S <= R_food`。

**复杂度**：`O(Σ_slots |C_s| + |F|)`；λ 网格是常数倍扫描。没有组合枚举。

## 3. 场景与坐标

- 基线职业：WAR / WHM / DRG / BLM × 9 个场景。
- 验收场景：每个 case 使用 run-acceptance.mjs 中的 `jobs`、`minItemLevel`、`maxItemLevel`、`syncLevel`、`objective`、`commonSlots`、`foodStrategy`、`jobConstraints`（`gcd` → `gcdTarget`，`gcdChoices` → `gcdChoices`）。
- 共享布局/共享食物在**单个职业的候选池**上不改变该职业的合法候选集，因此逐职业上下界仍是联合方案投影的合法界；共享选择的联合耦合不在本测量范围。
- 全部是**贡献坐标**；面板 = `baseStats` + 贡献。`S` 不含 TEN/SKS。
- 数据版本：`mcp-2026.09.15.0000.0000-upstream-048376fb6c6c-level-basis-v2`。

## 4. 基线场景：Gear 上/下界

| 场景 | 职业 | 候选数 | R_sep | R_gear^uniq | 收紧 | 戒指最大 gap | L_gear^uniq | L1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native L50 | WAR | 6,957 | 1,068 | 803 | 24.81% | 0 | 0 | 0 |
| native L50 | WHM | 3,498 | 996 | 757 | 24.00% | 0 | 0 | 0 |
| native L50 | DRG | 2,967 | 1,076 | 807 | 25.00% | 0 | 0 | 0 |
| native L50 | BLM | 3,235 | 1,074 | 808 | 24.77% | 0 | 0 | 0 |
| native L60 | WAR | 4,425 | 1,945 | 1,428 | 26.58% | 0 | 0 | 0 |
| native L60 | WHM | 2,684 | 1,735 | 1,286 | 25.88% | 0 | 0 | 0 |
| native L60 | DRG | 2,037 | 2,037 | 1,468 | 27.93% | 0 | 0 | 0 |
| native L60 | BLM | 2,012 | 2,043 | 1,472 | 27.95% | 0 | 0 | 0 |
| native L70 | WAR | 7,438 | 2,753 | 2,187 | 20.56% | 0 | 188 | 188 |
| native L70 | WHM | 4,034 | 2,756 | 2,107 | 23.55% | 5 | 328 | 328 |
| native L70 | DRG | 2,323 | 3,060 | 2,385 | 22.06% | 0 | 822 | 822 |
| native L70 | BLM | 2,323 | 3,065 | 2,412 | 21.31% | 0 | 823 | 823 |
| native L80 | WAR | 7,435 | 4,036 | 3,203 | 20.64% | 0 | 334 | 334 |
| native L80 | WHM | 3,582 | 4,037 | 3,300 | 18.26% | 0 | 625 | 625 |
| native L80 | DRG | 2,356 | 4,431 | 3,449 | 22.16% | 0 | 1,389 | 1,389 |
| native L80 | BLM | 2,356 | 4,422 | 3,453 | 21.91% | 0 | 1,219 | 1,219 |
| native L90 | WAR | 6,824 | 5,698 | 4,728 | 17.02% | 0 | 901 | 901 |
| native L90 | WHM | 3,182 | 5,699 | 4,795 | 15.86% | 0 | 926 | 926 |
| native L90 | DRG | 2,138 | 6,463 | 5,008 | 22.51% | 0 | 2,253 | 2,253 |
| native L90 | BLM | 2,138 | 6,461 | 4,949 | 23.40% | 0 | 2,067 | 2,067 |
| native L100 | WAR | 754 | 7,445 | 6,549 | 12.03% | 148 | 2,291 | 2,291 |
| native L100 | WHM | 474 | 7,555 | 6,353 | 15.91% | 8 | 2,560 | 2,560 |
| native L100 | DRG | 454 | 9,101 | 6,705 | 26.33% | 0 | 4,241 | 4,241 |
| native L100 | BLM | 454 | 9,134 | 6,705 | 26.59% | 0 | 3,361 | 3,361 |
| endgame-sync L70 | WAR | 86 | 1,987 | 1,987 | 0.00% | 69 | 992 | 992 |
| endgame-sync L70 | WHM | 86 | 2,056 | 1,900 | 7.59% | 0 | 974 | 974 |
| endgame-sync L70 | DRG | 86 | 2,859 | 2,164 | 24.31% | 0 | 1,621 | 1,621 |
| endgame-sync L70 | BLM | 86 | 2,877 | 2,164 | 24.78% | 0 | 1,166 | 1,166 |
| endgame-sync L80 | WAR | 86 | 2,861 | 2,861 | 0.00% | 99 | 1,381 | 1,381 |
| endgame-sync L80 | WHM | 86 | 2,960 | 2,735 | 7.60% | 0 | 1,354 | 1,354 |
| endgame-sync L80 | DRG | 86 | 4,116 | 3,068 | 25.46% | 0 | 2,285 | 2,285 |
| endgame-sync L80 | BLM | 86 | 4,143 | 3,068 | 25.95% | 0 | 1,678 | 1,678 |
| endgame-sync L90 | WAR | 86 | 4,183 | 4,183 | 0.00% | 145 | 1,969 | 1,969 |
| endgame-sync L90 | WHM | 86 | 4,328 | 3,999 | 7.60% | 0 | 1,930 | 1,930 |
| endgame-sync L90 | DRG | 86 | 6,018 | 4,436 | 26.29% | 0 | 3,291 | 3,291 |
| endgame-sync L90 | BLM | 86 | 6,057 | 4,436 | 26.76% | 0 | 2,454 | 2,454 |

## 5. 基线场景：食物与最终和

| 场景 | 职业 | R_food（上界） | R_food_naive | 收紧 | 可达最大值 | 上界 gap | L1 | 最小可达 | 下界 gap | slab 宽度 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native L50 | WAR | 916 | 1,310 | 30.08% | 910 | 6 | 0 | 0 | 0 | 916 |
| native L50 | WHM | 872 | 1,238 | 29.56% | 863 | 9 | 0 | 0 | 0 | 872 |
| native L50 | DRG | 922 | 1,318 | 30.05% | 917 | 5 | 0 | 0 | 0 | 922 |
| native L50 | BLM | 918 | 1,316 | 30.24% | 915 | 3 | 0 | 0 | 0 | 918 |
| native L60 | WAR | 1,598 | 2,187 | 26.93% | 1,585 | 13 | 0 | 0 | 0 | 1,598 |
| native L60 | WHM | 1,458 | 1,977 | 26.25% | 1,438 | 20 | 0 | 0 | 0 | 1,458 |
| native L60 | DRG | 1,645 | 2,279 | 27.82% | 1,623 | 22 | 0 | 0 | 0 | 1,645 |
| native L60 | BLM | 1,637 | 2,285 | 28.36% | 1,627 | 10 | 0 | 0 | 0 | 1,637 |
| native L70 | WAR | 2,409 | 2,995 | 19.57% | 2,387 | 22 | 188 | 188 | 0 | 2,221 |
| native L70 | WHM | 2,329 | 2,998 | 22.31% | 2,299 | 30 | 328 | 328 | 0 | 2,001 |
| native L70 | DRG | 2,614 | 3,302 | 20.84% | 2,596 | 18 | 822 | 822 | 0 | 1,792 |
| native L70 | BLM | 2,640 | 3,307 | 20.17% | 2,625 | 15 | 823 | 823 | 0 | 1,817 |
| native L80 | WAR | 3,445 | 4,278 | 19.47% | 3,437 | 8 | 334 | 334 | 0 | 3,111 |
| native L80 | WHM | 3,542 | 4,279 | 17.22% | 3,538 | 4 | 625 | 625 | 0 | 2,917 |
| native L80 | DRG | 3,691 | 4,673 | 21.01% | 3,691 | 0 | 1,389 | 1,389 | 0 | 2,302 |
| native L80 | BLM | 3,695 | 4,664 | 20.78% | 3,695 | 0 | 1,219 | 1,219 | 0 | 2,476 |
| native L90 | WAR | 4,970 | 5,940 | 16.33% | 4,970 | 0 | 901 | 901 | 0 | 4,069 |
| native L90 | WHM | 5,037 | 5,941 | 15.22% | 5,037 | 0 | 926 | 926 | 0 | 4,111 |
| native L90 | DRG | 5,250 | 6,705 | 21.70% | 5,250 | 0 | 2,253 | 2,253 | 0 | 2,997 |
| native L90 | BLM | 5,191 | 6,703 | 22.56% | 5,191 | 0 | 2,067 | 2,067 | 0 | 3,124 |
| native L100 | WAR | 6,791 | 7,687 | 11.66% | 6,791 | 0 | 2,291 | 2,291 | 0 | 4,500 |
| native L100 | WHM | 6,595 | 7,797 | 15.42% | 6,595 | 0 | 2,560 | 2,560 | 0 | 4,035 |
| native L100 | DRG | 6,947 | 9,343 | 25.64% | 6,947 | 0 | 4,241 | 4,241 | 0 | 2,706 |
| native L100 | BLM | 6,947 | 9,376 | 25.91% | 6,947 | 0 | 3,361 | 3,361 | 0 | 3,586 |
| endgame-sync L70 | WAR | 2,203 | 2,229 | 1.17% | 2,203 | 0 | 992 | 992 | 0 | 1,211 |
| endgame-sync L70 | WHM | 2,123 | 2,298 | 7.62% | 2,114 | 9 | 974 | 974 | 0 | 1,149 |
| endgame-sync L70 | DRG | 2,385 | 3,101 | 23.09% | 2,364 | 21 | 1,621 | 1,621 | 0 | 764 |
| endgame-sync L70 | BLM | 2,380 | 3,119 | 23.69% | 2,366 | 14 | 1,166 | 1,166 | 0 | 1,214 |
| endgame-sync L80 | WAR | 3,103 | 3,103 | 0.00% | 3,103 | 0 | 1,381 | 1,381 | 0 | 1,722 |
| endgame-sync L80 | WHM | 2,977 | 3,202 | 7.03% | 2,977 | 0 | 1,354 | 1,354 | 0 | 1,623 |
| endgame-sync L80 | DRG | 3,310 | 4,358 | 24.05% | 3,302 | 8 | 2,285 | 2,285 | 0 | 1,025 |
| endgame-sync L80 | BLM | 3,310 | 4,385 | 24.52% | 3,310 | 0 | 1,678 | 1,678 | 0 | 1,632 |
| endgame-sync L90 | WAR | 4,425 | 4,425 | 0.00% | 4,425 | 0 | 1,969 | 1,969 | 0 | 2,456 |
| endgame-sync L90 | WHM | 4,241 | 4,570 | 7.20% | 4,241 | 0 | 1,930 | 1,930 | 0 | 2,311 |
| endgame-sync L90 | DRG | 4,678 | 6,260 | 25.27% | 4,678 | 0 | 3,291 | 3,291 | 0 | 1,387 |
| endgame-sync L90 | BLM | 4,678 | 6,299 | 25.73% | 4,678 | 0 | 2,454 | 2,454 | 0 | 2,224 |

## 6. 基线场景摘要（4 职业平均）

| 场景 | R_sep | R_gear | gear 收紧 | L1 | R_food | food 收紧 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| native L50 | 1,054 | 794 | 24.66% | 0 | 907 | 29.99% |
| native L60 | 1,940 | 1,414 | 27.14% | 0 | 1,585 | 27.38% |
| native L70 | 2,909 | 2,273 | 21.86% | 540 | 2,498 | 20.71% |
| native L80 | 4,232 | 3,351 | 20.80% | 892 | 3,593 | 19.68% |
| native L90 | 6,080 | 4,870 | 19.90% | 1,537 | 5,112 | 19.14% |
| native L100 | 8,309 | 6,578 | 20.83% | 3,113 | 6,820 | 20.24% |
| endgame-sync L70 | 2,445 | 2,054 | 15.99% | 1,188 | 2,273 | 15.41% |
| endgame-sync L80 | 3,520 | 2,933 | 16.68% | 1,675 | 3,175 | 15.60% |
| endgame-sync L90 | 5,147 | 4,264 | 17.16% | 2,411 | 4,506 | 16.39% |

## 7. 验收场景（run-acceptance.mjs CASES）

解析校验：文件 `18` 个 case、解析 `18` 个、展开 `52` 个职业行；字段来自源文件（jobs / 品级范围 / syncLevel / objective / commonSlots / foodStrategy / jobConstraints）。

| 验收 case | 职业 | 公式等级 | 候选数 | R_sep | R_gear^uniq | 收紧 | 戒指 gap | L1 | 最小可达 | 下界 gap | R_food(无约束) | 速度区间 | R_food(约束) | 约束收紧 | 共享/食物 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- |
| single-blm-sync735-730-795-damage | BLM | 100 | 446 | 8,424 | 6,047 | 28.22% | 0 | 2,151 | 2,151 | 0 | 6,289 | - | 6,289 | 0.00% | 无 / independent |
| single-brd-unsynced-770-795-dps | BRD | 100 | 1,068 | 9,442 | 7,261 | 23.10% | 0 | 3,753 | 3,753 | 0 | 7,503 | - | 7,503 | 0.00% | 无 / independent |
| rdm-blm-780-795-shared-all-damage | RDM | 100 | 445 | 9,134 | 6,705 | 26.59% | 0 | 3,504 | 3,504 | 0 | 6,947 | - | 6,947 | 0.00% | 全部非武器 / shared |
| rdm-blm-780-795-shared-all-damage | BLM | 100 | 445 | 9,134 | 6,705 | 26.59% | 0 | 3,361 | 3,361 | 0 | 6,947 | - | 6,947 | 0.00% | 全部非武器 / shared |
| rdm-blm-780-795-independent-damage | RDM | 100 | 445 | 9,134 | 6,705 | 26.59% | 0 | 3,504 | 3,504 | 0 | 6,947 | - | 6,947 | 0.00% | 无 / independent |
| rdm-blm-780-795-independent-damage | BLM | 100 | 445 | 9,134 | 6,705 | 26.59% | 0 | 3,361 | 3,361 | 0 | 6,947 | - | 6,947 | 0.00% | 无 / independent |
| rpr-sam-sync735-rings-pair-dps | RPR | 100 | 446 | 8,424 | 6,050 | 28.18% | 0 | 3,193 | 3,193 | 0 | 6,292 | - | 6,292 | 0.00% | earrings,necklace,bracelet,rings / shared |
| rpr-sam-sync735-rings-pair-dps | SAM | 100 | 446 | 8,424 | 6,055 | 28.12% | 0 | 2,912 | 2,912 | 0 | 6,297 | - | 6,297 | 0.00% | earrings,necklace,bracelet,rings / shared |
| rpr-sam-sync735-rings-split-dps | RPR | 100 | 446 | 8,424 | 6,050 | 28.18% | 0 | 3,193 | 3,193 | 0 | 6,292 | - | 6,292 | 0.00% | earrings,necklace,bracelet,ring,ring2 / shared |
| rpr-sam-sync735-rings-split-dps | SAM | 100 | 446 | 8,424 | 6,055 | 28.12% | 0 | 2,912 | 2,912 | 0 | 6,297 | - | 6,297 | 0.00% | earrings,necklace,bracelet,ring,ring2 / shared |
| rdm-pct-sync735-gcd-shared-armor-dps | RDM | 100 | 446 | 8,424 | 6,047 | 28.22% | 0 | 2,373 | 2,373 | 0 | 6,289 | [107,192] | 6,195 | 1.49% | head,body,hands,legs,feet,earrings,necklace,bracelet / shared |
| rdm-pct-sync735-gcd-shared-armor-dps | PCT | 100 | 446 | 8,424 | 6,047 | 28.22% | 0 | 2,373 | 2,373 | 0 | 6,289 | [107,192]∪[0,21] | 6,289 | 0.00% | head,body,hands,legs,feet,earrings,necklace,bracelet / shared |
| vpr-mch-sync735-rings-pair-dps | VPR | 100 | 446 | 8,424 | 6,052 | 28.16% | 0 | 2,789 | 2,789 | 0 | 6,294 | - | 6,294 | 0.00% | earrings,necklace,bracelet,rings / shared |
| vpr-mch-sync735-rings-pair-dps | MCH | 100 | 446 | 8,424 | 6,055 | 28.12% | 0 | 2,934 | 2,934 | 0 | 6,297 | - | 6,297 | 0.00% | earrings,necklace,bracelet,rings / shared |
| vpr-mch-sync735-wide715-795-rings-dps | VPR | 100 | 659 | 8,424 | 6,052 | 28.16% | 0 | 2,761 | 2,761 | 0 | 6,294 | - | 6,294 | 0.00% | earrings,necklace,bracelet,rings / shared |
| vpr-mch-sync735-wide715-795-rings-dps | MCH | 100 | 659 | 8,424 | 6,055 | 28.12% | 0 | 2,905 | 2,905 | 0 | 6,297 | - | 6,297 | 0.00% | earrings,necklace,bracelet,rings / shared |
| rdm-blm-pct-sync735-gcd-shared-all-dps | RDM | 100 | 446 | 8,424 | 6,047 | 28.22% | 0 | 2,373 | 2,373 | 0 | 6,289 | [107,192] | 6,195 | 1.49% | 全部非武器 / shared |
| rdm-blm-pct-sync735-gcd-shared-all-dps | BLM | 100 | 446 | 8,424 | 6,047 | 28.22% | 0 | 2,151 | 2,151 | 0 | 6,289 | [107,192]∪[0,21] | 6,289 | 0.00% | 全部非武器 / shared |
| rdm-blm-pct-sync735-gcd-shared-all-dps | PCT | 100 | 446 | 8,424 | 6,047 | 28.22% | 0 | 2,373 | 2,373 | 0 | 6,289 | [107,192]∪[0,21] | 6,289 | 0.00% | 全部非武器 / shared |
| brd-dnc-mch-sync735-shared-all-dps | BRD | 100 | 446 | 8,424 | 6,055 | 28.12% | 0 | 2,934 | 2,934 | 0 | 6,297 | - | 6,297 | 0.00% | 全部非武器 / shared |
| brd-dnc-mch-sync735-shared-all-dps | DNC | 100 | 446 | 8,424 | 6,055 | 28.12% | 0 | 2,934 | 2,934 | 0 | 6,297 | - | 6,297 | 0.00% | 全部非武器 / shared |
| brd-dnc-mch-sync735-shared-all-dps | MCH | 100 | 446 | 8,424 | 6,055 | 28.12% | 0 | 2,934 | 2,934 | 0 | 6,297 | - | 6,297 | 0.00% | 全部非武器 / shared |
| brd-dnc-mch-vpr-unsynced-independent-dps | BRD | 100 | 1,068 | 9,442 | 7,261 | 23.10% | 0 | 3,753 | 3,753 | 0 | 7,503 | - | 7,503 | 0.00% | 无 / independent |
| brd-dnc-mch-vpr-unsynced-independent-dps | DNC | 100 | 1,068 | 9,442 | 7,261 | 23.10% | 0 | 3,753 | 3,753 | 0 | 7,503 | - | 7,503 | 0.00% | 无 / independent |
| brd-dnc-mch-vpr-unsynced-independent-dps | MCH | 100 | 1,068 | 9,442 | 7,261 | 23.10% | 0 | 3,753 | 3,753 | 0 | 7,503 | - | 7,503 | 0.00% | 无 / independent |
| brd-dnc-mch-vpr-unsynced-independent-dps | VPR | 100 | 1,068 | 9,451 | 7,261 | 23.17% | 0 | 3,729 | 3,729 | 0 | 7,503 | - | 7,503 | 0.00% | 无 / independent |
| brd-dnc-mch-vpr-sync735-wide715-795-shared-accessories-dps | BRD | 100 | 659 | 8,424 | 6,055 | 28.12% | 0 | 2,905 | 2,905 | 0 | 6,297 | - | 6,297 | 0.00% | earrings,necklace,bracelet,rings / shared |
| brd-dnc-mch-vpr-sync735-wide715-795-shared-accessories-dps | DNC | 100 | 659 | 8,424 | 6,055 | 28.12% | 0 | 2,905 | 2,905 | 0 | 6,297 | - | 6,297 | 0.00% | earrings,necklace,bracelet,rings / shared |
| brd-dnc-mch-vpr-sync735-wide715-795-shared-accessories-dps | MCH | 100 | 659 | 8,424 | 6,055 | 28.12% | 0 | 2,905 | 2,905 | 0 | 6,297 | - | 6,297 | 0.00% | earrings,necklace,bracelet,rings / shared |
| brd-dnc-mch-vpr-sync735-wide715-795-shared-accessories-dps | VPR | 100 | 659 | 8,424 | 6,052 | 28.16% | 0 | 2,761 | 2,761 | 0 | 6,294 | - | 6,294 | 0.00% | earrings,necklace,bracelet,rings / shared |
| brd-dnc-mch-nin-vpr-sync735-independent-dps | BRD | 100 | 659 | 8,424 | 6,055 | 28.12% | 0 | 2,905 | 2,905 | 0 | 6,297 | - | 6,297 | 0.00% | 无 / independent |
| brd-dnc-mch-nin-vpr-sync735-independent-dps | DNC | 100 | 659 | 8,424 | 6,055 | 28.12% | 0 | 2,905 | 2,905 | 0 | 6,297 | - | 6,297 | 0.00% | 无 / independent |
| brd-dnc-mch-nin-vpr-sync735-independent-dps | MCH | 100 | 659 | 8,424 | 6,055 | 28.12% | 0 | 2,905 | 2,905 | 0 | 6,297 | - | 6,297 | 0.00% | 无 / independent |
| brd-dnc-mch-nin-vpr-sync735-independent-dps | NIN | 100 | 659 | 8,424 | 6,052 | 28.16% | 0 | 2,761 | 2,761 | 0 | 6,294 | - | 6,294 | 0.00% | 无 / independent |
| brd-dnc-mch-nin-vpr-sync735-independent-dps | VPR | 100 | 659 | 8,424 | 6,052 | 28.16% | 0 | 2,761 | 2,761 | 0 | 6,294 | - | 6,294 | 0.00% | 无 / independent |
| brd-dnc-mch-nin-vpr-sync735-wide715-795-shared-accessories-dps | BRD | 100 | 659 | 8,424 | 6,055 | 28.12% | 0 | 2,905 | 2,905 | 0 | 6,297 | - | 6,297 | 0.00% | earrings,necklace,bracelet,rings / shared |
| brd-dnc-mch-nin-vpr-sync735-wide715-795-shared-accessories-dps | DNC | 100 | 659 | 8,424 | 6,055 | 28.12% | 0 | 2,905 | 2,905 | 0 | 6,297 | - | 6,297 | 0.00% | earrings,necklace,bracelet,rings / shared |
| brd-dnc-mch-nin-vpr-sync735-wide715-795-shared-accessories-dps | MCH | 100 | 659 | 8,424 | 6,055 | 28.12% | 0 | 2,905 | 2,905 | 0 | 6,297 | - | 6,297 | 0.00% | earrings,necklace,bracelet,rings / shared |
| brd-dnc-mch-nin-vpr-sync735-wide715-795-shared-accessories-dps | NIN | 100 | 659 | 8,424 | 6,052 | 28.16% | 0 | 2,761 | 2,761 | 0 | 6,294 | - | 6,294 | 0.00% | earrings,necklace,bracelet,rings / shared |
| brd-dnc-mch-nin-vpr-sync735-wide715-795-shared-accessories-dps | VPR | 100 | 659 | 8,424 | 6,052 | 28.16% | 0 | 2,761 | 2,761 | 0 | 6,294 | - | 6,294 | 0.00% | earrings,necklace,bracelet,rings / shared |
| pld-war-drk-gnb-sync735-wide715-795-shared-all-dps | PLD | 100 | 979 | 6,858 | 6,005 | 12.44% | 7 | 986 | 986 | 0 | 6,247 | - | 6,247 | 0.00% | 全部非武器 / shared |
| pld-war-drk-gnb-sync735-wide715-795-shared-all-dps | WAR | 100 | 939 | 6,858 | 5,971 | 12.93% | 7 | 986 | 986 | 0 | 6,213 | - | 6,213 | 0.00% | 全部非武器 / shared |
| pld-war-drk-gnb-sync735-wide715-795-shared-all-dps | DRK | 100 | 939 | 6,858 | 5,971 | 12.93% | 7 | 986 | 986 | 0 | 6,213 | - | 6,213 | 0.00% | 全部非武器 / shared |
| pld-war-drk-gnb-sync735-wide715-795-shared-all-dps | GNB | 100 | 939 | 6,858 | 5,971 | 12.93% | 7 | 986 | 986 | 0 | 6,213 | - | 6,213 | 0.00% | 全部非武器 / shared |
| whm-sch-ast-sge-sync735-wide715-795-shared-all-dps | WHM | 100 | 722 | 6,858 | 5,885 | 14.19% | 88 | 1,580 | 1,580 | 0 | 6,127 | - | 6,127 | 0.00% | 全部非武器 / shared |
| whm-sch-ast-sge-sync735-wide715-795-shared-all-dps | SCH | 100 | 722 | 6,858 | 5,885 | 14.19% | 88 | 1,580 | 1,580 | 0 | 6,127 | - | 6,127 | 0.00% | 全部非武器 / shared |
| whm-sch-ast-sge-sync735-wide715-795-shared-all-dps | AST | 100 | 722 | 6,858 | 5,885 | 14.19% | 88 | 1,580 | 1,580 | 0 | 6,127 | - | 6,127 | 0.00% | 全部非武器 / shared |
| whm-sch-ast-sge-sync735-wide715-795-shared-all-dps | SGE | 100 | 722 | 6,858 | 5,885 | 14.19% | 88 | 1,580 | 1,580 | 0 | 6,127 | - | 6,127 | 0.00% | 全部非武器 / shared |
| blm-smn-rdm-pct-sync735-wide715-795-shared-all-dps | BLM | 100 | 659 | 8,424 | 6,047 | 28.22% | 0 | 2,147 | 2,147 | 0 | 6,289 | - | 6,289 | 0.00% | 全部非武器 / shared |
| blm-smn-rdm-pct-sync735-wide715-795-shared-all-dps | SMN | 100 | 659 | 8,424 | 6,047 | 28.22% | 0 | 2,369 | 2,369 | 0 | 6,289 | - | 6,289 | 0.00% | 全部非武器 / shared |
| blm-smn-rdm-pct-sync735-wide715-795-shared-all-dps | RDM | 100 | 659 | 8,424 | 6,047 | 28.22% | 0 | 2,369 | 2,369 | 0 | 6,289 | - | 6,289 | 0.00% | 全部非武器 / shared |
| blm-smn-rdm-pct-sync735-wide715-795-shared-all-dps | PCT | 100 | 659 | 8,424 | 6,047 | 28.22% | 0 | 2,369 | 2,369 | 0 | 6,289 | - | 6,289 | 0.00% | 全部非武器 / shared |

说明：`速度区间` 是生产 `equippedSpeedRangeForGcd` 给出的总速度贡献区间；`R_food(无约束)` 不考虑 GCD 约束（对约束问题仍是合法但更松的界）；`R_food(约束)` 是速度约束感知的 Lagrangian 上界；`约束收紧` 相对无约束上界；`*` 表示义军速度分配回退。

## 8. 观察

- **gear 联合上界相对 `R_sep` 的收紧**：基线场景 0%–28%；验收场景 12.44%–28.22%（平均 25.30%）。主要来自“同一槽不能同时最大化三个属性”与戒指唯一性。
- **戒指唯一性 gap**：验收场景中 2 个 case（8 行）为正：pld-war-drk-gnb-sync735-wide715-795-shared-all-dps（4 行，gap 7）、whm-sch-ast-sge-sync735-wide715-795-shared-all-dps（4 行，gap 88）；忽略它会高估 gear 和上界。
- **食物上界族 vs “逐属性 max 相加”**：基线 0%–30%；验收场景 12.01%–27.43%。
- **`R_food` 紧度**：基线 18/36、验收 52/52 个实例的 `上界 gap = 0`（被合法完成精确达到）；全部实例最大 gap 30。测量结论，不是一般性证明（带食物精确最大值在定理文档中仍为未解决）。
- **下界 `L1`**：全测量范围 0–4241；其中基线 0–4241，验收 986–3753。下界**不能**缩小 `U`（下界定理 Lemma 1），只用于 slab 收紧与真实域剪枝。
- **下界紧度（新增）**：基线 36/36、验收 52/52 行的 `lower_gap = minAchievable − L1 = 0`，即该行的 `L1` 被一个构造的合法完成精确达到；本数据全部行均为 0（最大 0）。真实最小值被夹在 `[L1, minAchievable]` 内；`minAchievable` 是可达值，所以 `lower_gap` 是 L1 松弛量的**上界**——只有 gap=0 才证明 L1 精确。
- **下界为何全为 0（结构性，近乎平凡）**：允许的食物池含“无 CRT/DHT/DET 加成”的食物，故 `L_food = 0` 且可被实际选择；同时 gear 下界 `L_gear = Σ_s min S3 + 戒指精确最小配对` 由逐槽独立取 min 构造。因此 `L1 = L_gear` 是可达到的，当前数据下 `L1` 就是三属性和的**精确最小值**。若食物池受限（强制食物贡献三属性、固定 `foodId`、按职业过滤食物）或加入 TEN/GCD 约束，真实最小值会升高，`lower_gap` 可能 >0，此时只能夹在 `[L1, minAchievable]`。
- **GCD 约束**：5 个 (case, 职业) 行有速度约束；约束感知上界相对无约束上界收紧 0%–1.49%（λ 网格，非最优乘子，界仍合法）。
- **slab 宽度**：`R_food − L1` 在基线与验收场景都是数百到数千，当前品级带下三属性和不窄。

## 9. 边界与未做

- 验收场景的候选池与 run-acceptance.mjs 一致；未启用其它硬约束（验收 case 只含 GCD 约束）。
- 共享布局/共享食物只测单职业候选池；联合共享选择耦合（同一件装备同时满足多职业）可能进一步收紧联合界，但不在本测量中。
- `lower_gap` 是“无约束、允许全食物池”口径；GCD 约束行未测量约束下的最小值（约束只会使真实最小值更高，`L1` 仍是安全下界）。
- 义军速度分配在约束场景回退为无约束界（标记 `*`）。
- 本测量不评估搜索/剪枝性能，不运行搜索/MIP/benchmark。


