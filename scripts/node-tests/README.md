# Node 测试与验收

本目录只放 Node 测试、进程/Worker 启动和结果输出包装。游戏数据读取、候选生成、属性公式和搜索算法都由 `src/domain` 提供。

## 命令

```powershell
npm run test:data       # MCP 数据导入器的 Node 测试
npm run data:test:v3    # 正式领域层的多职业联合搜索验收
npm test                # Vitest 单元测试，包括 src/domain 中的规则与算法测试
```

`data:test:v3` 从 `src/data/generated-data.json` 读取经更新器生成的数据，并调用 `runJointOptimizationLocally`。默认场景使用赤魔与黑魔、职业数据中的默认品级范围、共享非武器装备槽与共享食物、每威力伤害期望目标，搜索时限为 235 秒，进程 RSS 保护线为 3.5 GiB。验收时打印输入场景、数据版本、各职业的联合结果与单独最优基线、证明信息和统计。

历史验收结果可能使用不同的 MCP 查询输入、品级/同步范围和探索期脚本。当前入口使用生成数据和 UI 共用的正式候选准备路径，因此新旧记录的数字不构成同一输入场景的直接性能比较；旧运行说明保存在 `scripts/archive/旧版Node验收说明.md`。

## 场景配置

以下环境变量可用于配置联合验收：

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `DATA_TEST_JOBS` | 参与搜索的职业缩写，至少两个且不能重复 | `RDM,BLM` |
| `DATA_TEST_COMMON_SLOTS` | 共享槽位，逗号分隔；接受 `mainhand`/`offhand`、装备槽英文名及 `Finger`/`rings`；`none` 表示不共享装备 | 除武器外的可用槽位 |
| `DATA_TEST_FOOD_STRATEGY` | `shared` 或 `independent` | `shared` |
| `DATA_TEST_OBJECTIVE` | `damage` 或 `dps` | `damage` |
| `DATA_TEST_JOB_CONSTRAINTS` | 按职业配置约束的 JSON 对象 | `{}` |
| `DATA_TEST_GCD`、`DATA_TEST_SPEED_MIN`、`DATA_TEST_SPEED_MAX` | 所有职业使用的 GCD 或速度约束 | 无 |
| `DATA_TEST_TOUGH_PERCENT`、`DATA_TEST_TOUGH_MIN`、`DATA_TEST_MAX_TOUGHNESS` | 所有职业使用的坚韧约束 | 无 |
| `DATA_TEST_GCD_CHOICES` | 所有职业可选的 GCD 数组，JSON 格式 | 无 |
| `DATA_TEST_V3_TIMEOUT_MS` | 搜索时限，必须在 1 至 235000 毫秒之间 | `235000` |

`DATA_TEST_JOB_CONSTRAINTS` 的属性名接受 `gcd`、`gcdTarget`、`gcdChoices`、`speedMin`、`speedMax`、`toughMin`、`minTenacity`、`toughnessMin`、`toughnessMinPercent`、`maxToughnessMode` 和 `maximizeTenacity`。约束可用正有限数字配置；`gcdChoices` 是正有限数字数组，最大坚韧开关使用布尔值。

赤魔与绘灵的共享装备、DPS 目标示例：

```powershell
$env:DATA_TEST_JOBS = 'RDM,PCT'
$env:DATA_TEST_COMMON_SLOTS = 'Head,Body,Gloves,Legs,Feet,Ears,Neck,Wrists'
$env:DATA_TEST_FOOD_STRATEGY = 'shared'
$env:DATA_TEST_OBJECTIVE = 'dps'
$env:DATA_TEST_JOB_CONSTRAINTS = '{"RDM":{"gcd":2.48},"PCT":{"gcdChoices":[2.48,2.5]}}'
npm run data:test:v3
```

正式搜索的规则测试和算法验收位于 `src/domain`，通过 `npm test` 或 `npm run test:coverage` 运行。历史算法代码和探索记录保存在 `scripts/archive`，手动复现方式见该目录的说明。
