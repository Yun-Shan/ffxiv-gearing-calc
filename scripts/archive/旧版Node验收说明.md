> 历史说明：此文件记录目录拆分前的 Node 验收参数和命令，其中路径、场景及命令可能已失效。当前入口请查看 `scripts/node-tests/README.md`；本文件仅作为旧验收记录保存。

# 配装搜索验收

运行入口：`npm run data:test`，默认使用 HiGHS MIP 求解器。求解器和 worker 分别位于 `loadout-finder-exact-mip.ts`、`exact-mip-worker.mjs`；其余根目录模块为数据准备、公式、导出和相关测试。

旧 V1、V2、DP、属性组合统计、并行工具和历史设计报告保存在 `archived/`。原入口仍支持显式选择 `DATA_TEST_ALGORITHM=v2` 或 `dp`，仅在选择时加载归档算法；`npm run data:test:parallel` 使用归档 V2 并行工具。

算法说明、正确性说明和搜索基准记录位于 `../../docs`，完整历史记录位于归档目录。最优性结论限定于传入求解器的候选集合，MIP 的数值最优状态不等同于形式化有理数证明。

## 多职业 V3

`npm run data:test:v3` 使用完整原始候选执行多职业联合搜索，默认赤魔与黑魔共享所有非武器部位及食物。独立运行候选生成进程后才开始搜索计时；搜索包含各职业单独最优基线。正式算法位于 `src/domain/search`，本目录保留验收入口和测试兼容导出。

```powershell
$env:DATA_TEST_JOBS = 'RDM,BLM'
$env:DATA_TEST_COMMON_SLOTS = 'Head,Body,Gloves,Legs,Feet,Ears,Neck,Wrists,Finger'
$env:DATA_TEST_FOOD_STRATEGY = 'shared' # 或 independent
$env:DATA_TEST_OBJECTIVE = 'damage' # 或 dps：伤害除以 GCD
npm run data:test:v3
```

求解接口为 `findBestJointLoadoutV3`，位于 `../../src/domain/search/loadout-finder-v3.ts`。每个职业分别提供 `ExactMipOptions` 和自己的槽位名称数组；共享部位按名称匹配，因此骑士的盾牌槽不会导致槽位索引错位。共享装备包含完整属性方案，双戒指包含各枚戒指的属性方案。目标是最大化各职业每威力伤害期望相对其单独最优值的比例之和。

联合模型直接约束共享装备和食物，用已核验的单职业最优值收紧每个职业的上界，再枚举仍可能改善归一化总和的因子签名。乘积与固定点对数只用于必要条件筛选，最终仍比较 BigInt 有理数总和；存在零权重职业或无共享槽时使用外层分支限界。每次运行从原始候选重新求解，初始共享方案的构造也包含在搜索计时中。

指定的性能验收使用 `DATA_TEST_JOBS=RPR,SAM` 或 `VPR,MCH`，`DATA_TEST_COMMON_SLOTS=Ears,Neck,Wrists,Finger`，`DATA_TEST_FOOD_STRATEGY=shared`，`DATA_TEST_OBJECTIVE=dps`，并清除 GCD、速度和坚韧约束。这时单职业基线和联合优化统一使用每秒每威力伤害期望。

赤魔与绘灵验收配置：

```powershell
$env:DATA_TEST_JOBS = 'RDM,PCT'
$env:DATA_TEST_COMMON_SLOTS = 'Head,Body,Gloves,Legs,Feet,Ears,Neck,Wrists'
$env:DATA_TEST_FOOD_STRATEGY = 'shared'
$env:DATA_TEST_OBJECTIVE = 'dps'
$env:DATA_TEST_JOB_CONSTRAINTS = '{"RDM":{"gcd":2.48},"PCT":{"gcdChoices":[2.48,2.5]}}'
npm run data:test:v3
```

每职业约束可以通过 `DATA_TEST_JOB_CONSTRAINTS` 单独配置；全局 `DATA_TEST_GCD`、速度及坚韧环境变量仍会继承，复现验收时应先清除无关设置。`DATA_TEST_COMMON_SLOTS=none` 可关闭装备共享，食物仍按所选策略处理。

## HiGHS 进度记录

Node 验收当前固定使用 HiGHS。历史算法对照、CP-SAT 运行数据与搜索结论保留在 [搜索基准记录](../../docs/搜索基准记录.md) 和 [算法包性能分析](../../docs/已安装算法包搜索性能分析.md)，但不再提供 CP-SAT 运行入口。

可设置 `DATA_TEST_CANDIDATE_CACHE_PATH` 将候选导出到 JSON，之后重放完全相同的候选和约束；脚本会校验场景与候选 SHA-256。设置 `DATA_TEST_PROGRESS_OUTPUT_PATH` 可保存 HiGHS 的原生 incumbent、bound、gap 和节点事件。正常完成时保存完整轨迹；达到时限或出错时也会保存已收集到的部分轨迹并标记 `complete: false`。候选生成不计入搜索计时，模型构造、求解、回调和 BigInt 复核都计入。

需要细分模型准备与原生求解耗时时，可设置 `FFXIV_PROFILE_TIMING=1`。进度文件会增加 `PROFILE` 日志事件；HiGHS 记录 LP 序列化、导入和求解墙钟，精确 MIP 另记录模型准备、求解、签名带检查及联合阶段总计。该选项会启用额外计时和日志回调。

```powershell
$env:DATA_TEST_CANDIDATE_CACHE_PATH = "$env:TEMP\v3-candidates.json"
$env:DATA_TEST_PROGRESS_OUTPUT_PATH = "$env:TEMP\v3-highs-progress.json"
$env:FFXIV_PROFILE_TIMING = '1' # 可选：写入 PROFILE 阶段计时
npm run data:test:v3
```

HiGHS 回调在 incumbent 改进、原生日志/界更新及约每秒一次的中断检查点触发。

搜索总时限为 235 秒，给四分钟要求保留退出余量；可用 `DATA_TEST_V3_TIMEOUT_MS` 调低。入口在独立线程执行搜索并监控整个进程的 RSS，在 3.5 GiB 保护线停止。没有预先打表文件；运行时缓存有界。超时、内存保护或内层未证明最优均报错，不返回近似方案。停止保护本身不代表通过性能验收，完成场景见 [基准记录](../../docs/搜索基准记录.md)。算法证明范围及数值求解器边界见 [正确性与验收](../../docs/V3正确性与验收.md)。

## 测试

执行相关测试：

```powershell
$files = @(Get-ChildItem scripts/test -Filter '*.test.ts') + @(Get-ChildItem scripts/test/archived -Filter '*.test.ts')
node --experimental-strip-types --test $files.FullName
```
