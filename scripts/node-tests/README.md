# Node 测试与验收

正式搜索耗时统一取领域结果 `statistics.elapsedMs`，覆盖领域入口至完整结果返回前的全部工作。输出与性能判定直接使用该值，不校验或修正耗时；Worker 与父进程的看门狗计时仅负责超时保护，不替代搜索耗时。历史基准保留原来的计时范围，跨口径分类仅作参考。

本目录包含项目原有 Node 测试与正式多职业搜索入口。游戏数据读取、候选生成、属性公式和搜索算法由 `src/domain` 提供。

## 命令

```powershell
npm run test:data       # MCP 查询、数据导入与二进制回归
npm run test:v3:runner  # 联合验收入口的配置、报告与 Worker 保护回归
npm run data:test:v3    # 正式领域层的多职业联合搜索验收
npm test                # Vitest 单元测试，包括 src/domain 中的规则与算法测试
```

`data:test:v3` 从 `src/data/generated-data.bin` 读取经更新器生成的数据，并调用 `runJointOptimizationLocally`。默认场景使用赤魔与黑魔、职业数据中的默认品级范围、共享非武器装备槽与共享食物、每威力伤害期望目标，搜索时限为 235 秒，进程 RSS 保护线为 3.5 GiB。验收时打印输入场景、数据版本、各职业的联合结果与单独最优基线、证明信息和统计。

## 场景配置

以下环境变量可用于配置联合验收：

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `DATA_TEST_JOBS` | 参与搜索的职业缩写，至少两个且不能重复 | `RDM,BLM` |
| `DATA_TEST_COMMON_SLOTS` | 共享槽位，逗号分隔；使用具体非武器槽英文名，两枚戒指分别为 `ring`、`ring2`；`none` 表示不共享装备 | 除武器外的可用槽位 |
| `DATA_TEST_FOOD_STRATEGY` | `shared` 或 `independent` | `shared` |
| `DATA_TEST_OBJECTIVE` | `damage` 或 `dps` | `damage` |
| `DATA_TEST_MIN_ITEM_LEVEL`、`DATA_TEST_MAX_ITEM_LEVEL` | 覆盖共享装备品级范围；未设置的一端沿用首个职业默认值 | 首个职业默认范围 |
| `DATA_TEST_SYNC_LEVEL` | 为所有所选职业设置显式同步品级（至少 90） | 无 |
| `DATA_TEST_SYNC_JOB_LEVEL` | 为所有所选职业设置仅等级同步；与 `DATA_TEST_SYNC_LEVEL` 互斥 | 无 |
| `DATA_TEST_JOB_CONSTRAINTS` | 按职业配置约束的 JSON 对象 | `{}` |
| `DATA_TEST_SPEED_MIN`、`DATA_TEST_SPEED_MAX` | 所有职业使用的速度约束 | 无 |
| `DATA_TEST_TOUGH_PERCENT`、`DATA_TEST_MIN_TENACITY`、`DATA_TEST_MAX_TOUGHNESS` | 所有职业使用的坚韧约束 | 无 |
| `DATA_TEST_GCD_CHOICES` | 所有职业可选的 GCD 数组，JSON 格式 | 无 |
| `DATA_TEST_V3_TIMEOUT_MS` | 搜索时限，接受 1 至 235000 毫秒或 `unlimited`；无限时仍保留 RSS 保护线 | `235000` |

`DATA_TEST_JOB_CONSTRAINTS` 使用当前领域字段 `gcdChoices`、`speedMin`、`speedMax`、`minTenacity`、`toughnessMinPercent` 和 `maximizeTenacity`。GCD 档位与速度范围互斥，坚韧只选择一种策略；`gcdChoices` 是无重复的正有限数字数组，单值使用单元素数组。每个职业配置显式写入所选目标和族群索引 0；共享范围沿用首个职业的默认范围。装备排除与强制值缺省时按空集合处理。

赤魔与绘灵的共享装备、DPS 目标示例：

```powershell
$env:DATA_TEST_JOBS = 'RDM,PCT'
$env:DATA_TEST_COMMON_SLOTS = 'head,body,hands,legs,feet,earrings,necklace,bracelet'
$env:DATA_TEST_FOOD_STRATEGY = 'shared'
$env:DATA_TEST_OBJECTIVE = 'dps'
$env:DATA_TEST_JOB_CONSTRAINTS = '{"RDM":{"gcdChoices":[2.48]},"PCT":{"gcdChoices":[2.48,2.5]}}'
npm run data:test:v3
```

正式搜索的规则测试和算法验收位于 `src/domain`，通过 `npm test` 或 `npm run test:coverage` 运行。历史算法和探索记录可通过 Git 历史查阅。
