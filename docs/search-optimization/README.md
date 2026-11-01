# 搜索耗时优化资料

本目录保存当前搜索性能基准、验证边界和复测工具。

- [九轮耗时基准](九轮耗时基准.md)：22 个正式场景的当前耗时分布。
- [搜索结果基准](tools/acceptance-baseline.json)：完整场景输入和精确目标。
- [搜索耗时优化总结](搜索耗时优化总结.md)：当前验证结论和测量口径。
- [通用数学策略迁移验收](通用数学策略迁移验收.md)：已知错误完成反例与证明边界。
- [策略启用条件调整验收](策略启用条件调整验收.md)：模型表示的数学条件和性能选择边界。
- [领域与搜索规则](../rules/领域与搜索规则.md)：全局 `auto/on/off` 执行契约及必要复核责任。
- [基线 Worker 品级元数据丢失缺陷](基线Worker品级元数据丢失缺陷.md)：品级传输遗漏的影响、修复及正确性验证。
- `tools/`：性能验收脚本及其 worker。从仓库根目录直接运行：

  ```powershell
  node --max-old-space-size=2560 --experimental-strip-types docs/search-optimization/tools/run-single.mjs
  node docs/search-optimization/tools/run-acceptance.mjs
  node --test docs/search-optimization/tools/*.node-test.mjs
  ```

  可直接在运行器命令后添加参数，例如：

  ```powershell
  node docs/search-optimization/tools/run-acceptance.mjs --strategy stress --timeout-ms unlimited
  node docs/search-optimization/tools/run-acceptance.mjs --list
  ```
- `acceptance-runs/`：性能验收脚本生成的逐场景结果、日志和源码快照。

## 单职业性能对照

`run-single.mjs` 使用生成数据调用正式领域层的 `runOptimizationLocally`。默认场景为 VPR、职业默认品级范围、DPS 目标、所有推荐食物和不限时搜索。可通过环境变量调整场景：

| 环境变量 | 用途 |
| --- | --- |
| `DATA_TEST_SINGLE_JOB` | 职业缩写 |
| `DATA_TEST_SINGLE_MIN_ITEM_LEVEL`、`DATA_TEST_SINGLE_MAX_ITEM_LEVEL` | 品级范围 |
| `DATA_TEST_SINGLE_SYNC_LEVEL` | 显式装备同步品级，与仅等级设置互斥 |
| `DATA_TEST_SINGLE_SYNC_JOB_LEVEL` | 仅同步公式等级，与品级设置互斥 |
| `DATA_TEST_SINGLE_OBJECTIVE` | `damage` 或 `dps` |
| `DATA_TEST_SINGLE_FOOD_ID` | 固定食物 ID |
| `DATA_TEST_JOB_CONSTRAINTS` | 按当前职业缩写设置 GCD、坚韧和装备排除等条件，格式与联合入口相同 |
| `DATA_TEST_SINGLE_TIMEOUT_MS` | 搜索时限，默认 `unlimited` |

结果包括总耗时、候选数量、证明状态、结果属性和求解统计。RSS 保护线为 3.5 GiB。

## 全场景性能验收

`run-acceptance.mjs` 默认顺序运行 22 个性能验收场景。每案通过独立子进程调用 `run-single.mjs` 或正式联合入口 `scripts/node-tests/run-v3.mjs`，并开启 `FFXIV_PROFILE_TIMING=1`。运行器分别检查结果下限、最优性证明、输入一致性与耗时。

使用 `--strategy mip` 可筛选 MIP 接入时验证的 11 案。其中 BLM、BRD、两个品级范围的 VPR＋MCH、四职业及五职业共享饰品共 6 案沿用原场景 ID，仅运行一次。新增 5 案如下。

| 场景 ID | 搜索条件 |
| --- | --- |
| `forced-a` | PLD/WAR/DRK/GNB，780–785，无同步，伤害目标，GCD 均为 2.50，非武器装备与食物共享 |
| `custom-b` | BLM，500–530，同步 530，伤害目标，GCD 2.45 |
| `custom-c` | WAR/DRK/GNB，500–530，同步 530，伤害目标，GCD 均为 2.50，非武器装备与食物共享 |
| `custom-d` | WAR/DRK/GNB，770–780，无同步，伤害目标，GCD 分别为 2.50、2.49、2.48，非武器装备与食物共享 |
| `holdout-food-independent` | VPR/MCH，730–795，同步 735，DPS 目标，耳、项、腕及双戒共享，食物各自选择 |

A–D 每个职业沿用同一份 98 项装备 ID 排除清单。四坦 A 用于复现联合 MIP 路线，该案固定 `sharedStateSearch=off`，优先于全局同名设置。其余策略沿用 `FFXIV_SEARCH_STRATEGIES`。逐案的 `execution.strategies` 记录实际执行设置。

`FFXIV_PROFILE_TIMING=1` 会输出 HiGHS 模型准备、求解阶段、共享选择冲突行和因子类别冲突切面的诊断事件。三职业及以上会报告类别组切面数量与预处理工作量；联合共享组合超过 20,000 时会报告前缀上界搜索的启用状态、检查前缀数及剪枝数。达到可选预处理预算只会少生成加强行，搜索仍执行完整最优性证明；该设置只增加诊断信息，不改变候选、约束或优化目标。

当前正式耗时直接读取领域结果 `statistics.elapsedMs`，从领域搜索入口开始，到候选准备、求解、结果还原与资源清理完成、返回结果前结束。单职业与联合入口使用同一口径，Worker 启动、数据模块加载和结果传输由外层看门狗单独计时并控制超时保护。领域耗时值直接用于报告与比较。

22 个场景的耗时基准来自 2026-11-01 的九轮串行复跑，共 198 次完整搜索。最小值、算术均值、最大值与九个原始毫秒样本保存在 tools/timing-baseline.mjs，运行器的历史最快值采用九轮最小值，详见[九轮耗时基准](九轮耗时基准.md)。完整输入、独立最优分母和精确目标保存在[搜索结果基准](tools/acceptance-baseline.json)。

优化时限与历史耗时独立判断。优化时限为每个职业 30 秒，包含单职业；超时只表示没有达到该搜索预算。历史比较使用该条件的本次九轮最小值和九轮统计：不慢于历史最优为“优化成功”；慢于历史最优但低于九轮均值为“优化成功（提示）”；高于或等于均值且不超过九轮最大值为“耗时无影响”；高于九轮最大值为“劣化”。九轮统计由完整领域耗时直接计算，保留毫秒原始精度。历史结果门槛仍是硬性条件，结果低于门槛即非法，与耗时类别无关。当前耗时来源见[九轮耗时基准](九轮耗时基准.md)。联合结果阈值使用整数分子/分母精确比较。

当前同步宽域压力场景包括 VPR+MCH、四职业与五职业共享饰品/戒指对，以及防护、治疗、智力 DPS 各自的四职业全非武器槽共享搜索；均为 715–795、同步 735。每案父进程看门狗默认为 300 秒。V3 入口最多接受 235 秒有限内部时限，父进程看门狗更长时，验收器让 V3 内部时限不限时，由父进程负责超时控制。

支持 `--list`、`--case ID1,ID2`、`--job-count N`、`--strategy TAG1,TAG2` 和 `--timeout-ms N|unlimited`。过滤器可组合，`--strategy` 按命中任一标签筛选。标签包括 `single`、`joint`、`job-count-N`、`sync`/`unsynced`、`shared-equipment`/`unshared-equipment`、`shared-food`/`independent-food`、`gcd-constrained` 和 `objective-dps`/`objective-damage`。空过滤结果、未知场景或无效参数会报错，不会生成空验收记录。

示例：

```powershell
node docs/search-optimization/tools/run-acceptance.mjs --strategy stress --timeout-ms unlimited
node docs/search-optimization/tools/run-acceptance.mjs --list
node docs/search-optimization/tools/run-acceptance.mjs --strategy mip --list
node docs/search-optimization/tools/run-acceptance.mjs --case single-blm-sync735-730-795-damage,vpr-mch-sync735-rings-pair-dps
node docs/search-optimization/tools/run-acceptance.mjs --job-count 2
node docs/search-optimization/tools/run-acceptance.mjs --strategy joint-2
node docs/search-optimization/tools/run-acceptance.mjs --timeout-ms 180000
```

运行期间按 Ctrl+C 会停止当前搜索并保存已收集的日志、profile、运行时长和未完成状态；尚未开始的场景会跳过。中断案不会被视为完整证明或验收通过。

## 验收记录

每次运行在 `acceptance-runs/<时间戳>/` 建立独立目录。`suite.json` 和 `suite.md` 汇总场景；每个 `cases/<场景ID>/config.json` 保存输入、阈值来源、实际子进程参数、工作目录、堆上限、profile 开关、日志捕获方式及超时；`result.json` 保存最终结果、证明与耗时判定、逐职业单职业分数、联合结果、求解统计、原始 HiGHS profile 事件、阶段列表和策略摘要。完整 stdout/stderr 分别保存在 `stdout.log`、`stderr.log`。

`strategy-snapshot/` 保存 `src/domain`、`src/data` 中的运行时源码、`scripts/node-tests`、`docs/search-optimization/tools` 下的非测试运行时代码和根目录包清单；其中必须包含 `src/data/binary` 下的 `schema.ts`、`types.ts`、`encode.ts` 与 `decode.ts`。`data-snapshot/generated-data.bin` 保存本次使用的运行时数据。套件开始时记录策略文件和二进制数据的 SHA-256；每案启动前、结束后重新比对。输入不一致会跳过该案，运行期间发生变化会使该案失败，并在结果中记录变化路径、基线及观测到的哈希和字节数。`suite.json` 还记录游戏数据版本、Git HEAD、dirty 文件、Node 版本、平台、CPU 和内存信息，不保存进程环境变量或密钥。

验收结果按 `schemaVersion: 7` 记录，重点字段包括：

- `runtime`：Node/V8、可执行文件、平台、架构、CPU、核心数和内存。
- `strategySources[]`：每个策略快照文件的相对路径、SHA-256、字节数和快照路径。
- `inputIntegrityBaseline`：套件开始时策略文件和生成数据的 SHA-256。
- `cases[]`：输入、结果合法性、证明状态、实际耗时和验收检查。`optimizationTarget` 与 `historicalComparison` 分别记录时限和历史分类；`resultPassed` 单独表示结果、证明及输入完整性检查。
- `cases[].soloObjectiveScores[]`：逐职业历史 `soloOptimum.objectiveScore` 下限、本次单职业分数与联合分数、来源和通过状态。
- `cases[].strategy.orderedProfilePhases[]`：按到达顺序记录的求解阶段和 profile 数据。
- `cases[].execution`：Node 执行文件、参数、工作目录、堆上限、profile 开关和时限。

未提供 `--timeout-ms` 时，每案父进程时限为 300000ms；`unlimited` 会关闭该外部时限。单职业结果按场景指定的 damage/DPS 下限检查，多职业结果按精确 `normalizedJointValue` 下限检查。历史禁用场景不纳入套件。历史运行可能使用不同的 MCP 输入、品级/同步范围和探索期脚本，因此与当前正式候选准备路径的数字不一定能直接比较。
