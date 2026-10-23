# 领域层模块化拆分验收（2026-10-23）

## 目标与范围

本次从 `58ce7fca5d673028b709c04fd27a73a83b1b10c7` 新建 `codex/domain-module-boundaries` 分支，将装备候选准备、单职业精确搜索、联合整数搜索和联合外层协调按职责拆分。GitHub Issue #4 只用于方向参考；本次验收依据现行领域规则、工程规则及下列独立确定的等价性检查，不将该 issue 的阶段或策略清单作为规格。

- 原有 `equipment-candidates.ts`、`loadout-finder-exact-mip.ts`、`loadout-finder-v3.ts` 保留公开入口和类型契约，调用方继续走原正式路径。
- `optimizer/candidates` 持有合法镶嵌、装备方案、食物及候选池职责；候选身份和结果还原索引的生命周期保持不变。
- `search/core` 持有精确算术、模型行、HiGHS 执行、诊断和整数解校验。`search/exact-mip` 按属性/因子建模、候选上界、戒指域、共享约束、结果重建与搜索协调拆分；联合循环的约束生成阶段也已拆出。
- `search/joint-loadout` 持有独立最优基线、共享候选准备、初始解和受限搜索。跨迭代缓存、预算、模型数组及统计保持每次搜索独占，不在阶段调用中重置。
- 未改游戏数据、公式、候选合法性、目标函数、硬约束、完整证明条件或界面流程。

稳定的依赖和状态所有权见[顶层设计](../自动配装优化项目设计方案.md)。边界测试检查可达搜索模块无运行时循环依赖，底层和叶模块不反向导入协调器；类型依赖也纳入方向检查。

## 正确性与生产路径对照

冻结基线为上述提交的独立临时 checkout，使用相同已提交二进制数据和依赖；基线与拆分版各运行现有全部 18 个正式场景。两轮逐案运行前后均校验源码和数据 SHA。基线完整原始单元测试为 91 文件、764 测试通过。

数据版本：`2026.09.15.0000.0000`；参考提交：`8d75ef89c317401727066a28025fb4d860a92f20`；`generated-data.bin` SHA-256：`4436a1374320e70ab60b8915e9b71a09a55a1a716658b63b43398ba9ca51989b`。

18/18 场景的合法性与完整最优性证明通过。两版目标值、最终属性、GCD、装备、食物和证明字段相同；16 个联合场景用 BigInt 交叉相乘检查精确分数相等。HiGHS 各调用的变量、约束、非零项、目标项及 hint 项数量指纹相同；该检查是模型规模指纹，不单独作为系数等价证明。

独立只读复核同时核对旧文件与拆分函数的 AST：原候选函数保持等价，单职业流程内联拆出的签名可行性阶段后等价，联合求解循环内联阶段并还原显式参数/getter 后等价。复核重点包括延迟调用闭包、共享模型引用、跨轮缓存/预算和最终精确复核，未发现生产逻辑缺陷。

17/18 场景的外层工作计数相同；`rdm-blm-pct-sync735-gcd-shared-all-dps` 的 innerSolves/cacheMisses/cacheEntries 从 6/6/5 变为 5/5/4，模型规模指纹及结果一致，属于并行基线提前完成时的调度记账差异。

## 性能记录与未达项

以下为同机单轮对照，单位为秒。它足以记录本次运行的差异，不构成稳定提速结论。

| 正式场景 | 冻结基线 | 拆分版 |
| --- | ---: | ---: |
| single-blm-sync735-730-795-damage | 3.09 | 3.15 |
| single-brd-unsynced-770-795-dps | 11.55 | 11.36 |
| rdm-blm-780-795-shared-all-damage | 1.27 | 1.36 |
| rdm-blm-780-795-independent-damage | 1.60 | 1.68 |
| rpr-sam-sync735-rings-pair-dps | 9.21 | 9.19 |
| rpr-sam-sync735-rings-split-dps | 8.86 | 8.73 |
| rdm-pct-sync735-gcd-shared-armor-dps | 4.92 | 4.79 |
| vpr-mch-sync735-rings-pair-dps | 43.91 | 42.41 |
| vpr-mch-sync735-wide715-795-rings-dps | 76.60 | 74.59 |
| rdm-blm-pct-sync735-gcd-shared-all-dps | 8.42 | 8.13 |
| brd-dnc-mch-sync735-shared-all-dps | 11.97 | 11.87 |
| brd-dnc-mch-vpr-unsynced-independent-dps | 46.14 | 45.09 |
| brd-dnc-mch-vpr-sync735-wide715-795-shared-accessories-dps | 69.00 | 66.71 |
| brd-dnc-mch-nin-vpr-sync735-independent-dps | 15.30 | 14.67 |
| brd-dnc-mch-nin-vpr-sync735-wide715-795-shared-accessories-dps | 63.22 | 58.92 |
| pld-war-drk-gnb-sync735-wide715-795-shared-all-dps | 29.66 | 28.46 |
| whm-sch-ast-sge-sync735-wide715-795-shared-all-dps | 10.85 | 10.49 |
| blm-smn-rdm-pct-sync735-wide715-795-shared-all-dps | 19.61 | 19.24 |
| 总计 | 435.20 | 420.82 |

两版均为 17/18 达到每职业 30 秒目标：VPR+MCH 的 715–795 宽品级域超过 60 秒目标，但均正常完成完整证明。四职业未同步独立场景均被现有历史分类判为“劣化”（46.14 → 45.09 秒）；这与本次冻结基线对照的方向不同。

因此，现有综合性能 runner 两版均退出 1、综合通过 16/18；不能表述为“全套性能验收通过”。本次模块化等价性、合法性和证明检查通过，既有性能目标未达项仍保留，不通过修改候选或证明范围解决。

## 测试与覆盖率

最终全量覆盖率命令成功退出：1081 个测试通过。纯领域覆盖率为语句 **95.05%**（8945/9410）、分支 **91.23%**（6380/6993）、函数 **98.93%**（1485/1501）、行 **96.84%**（7884/8141），四项均超过 90% 门槛。复核发现的 HiGHS 空结果部分匹配断言已改为严格比较；对应 8 个测试随后重新通过，未改变生产代码或覆盖路径。

`npm run test:domain:coverage` 固定领域生产代码四项 90% 门槛。范围为 `src/domain/**/*.ts`，排除测试、类型声明、`*.worker.ts`、`worker-client.ts`、`domain/node/**`、`search/highs-browser.ts` 和 `parallel-baseline-browser-adapter.ts`。这些排除项负责传输或环境加载；纯 worker 策略、并行执行器、所有搜索建模与证明模块仍计入统计。具体配置见 [vitest.domain.config.ts](../vitest.domain.config.ts)。

覆盖率命令额外启用真实 2/4/5 职业共享场景，以正式顺序基线路径在同进程采集覆盖，精确目标来自冻结基线；普通 `npm test` 跳过这 3 个较慢场景。Worker 路径由正式 18 场景、原有传输测试和浏览器实际交互覆盖。小域穷举测试独立枚举可行组合，验证候选剪枝保留最优点、约束保留全部严格改进点，并验证约束确实生效。

已执行的其他验证：`npm run build`；`npm run test:v3:runner`（14/14）；计时验收工具的 Node 测试（8 个断言）；TypeScript 检查和 `git diff --check`。构建成功，仅保留已有的大 chunk 提示。

Playwright 实际访问 `/single`，选择赤魔法师、获取可行 GCD 并选择 2.50、执行配装搜索，成功展示完整装备结果：伤害 134.8333696、DPS 53.9333479、GCD 2.50。浏览器控制台 0 error / 0 warning，覆盖实际 GCD Worker 与搜索 Worker/浏览器 HiGHS 路径。

## 本地证据与复现入口

- 基线原始 suite：`artifacts/domain-modularization/baseline`，run ID `20261023T110137360Z`。
- 拆分版原始 suite：`docs/search-optimization/acceptance-runs/20261023T111449600Z`，包含源码快照、数据快照、18 份输入/输出和完整过程日志。
- 对照工具与结果：`artifacts/domain-modularization/compare-runs.mjs`、`comparison.json`。
- 完整覆盖率日志：`artifacts/domain-modularization/coverage-final.log`；覆盖明细和 HTML：`coverage/`。
- 浏览器截图及控制台：`artifacts/domain-modularization/browser-single-result.png`、`browser-console.log`。

上述原始运行目录按仓库现有规则忽略并留在本地；本验收记录、测试、覆盖配置与实现一起提交。重新验证使用 `npm run test:domain:coverage`、`npm run build` 和 `node docs/search-optimization/tools/run-acceptance.mjs`。正式 runner 包含历史性能比较，仍可能因上述既有目标未达项退出非零。
