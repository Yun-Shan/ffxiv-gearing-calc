# 精确配装搜索实验

运行入口：`npm run data:test`，默认使用 HiGHS MIP 求解器。求解器和 worker 分别位于 `loadout-finder-exact-mip.ts`、`exact-mip-worker.mjs`；其余根目录模块为数据准备、公式、导出和相关测试。

旧 V1、V2、DP、属性组合统计、并行工具和历史设计报告保存在 `archived/`。原入口仍支持显式选择 `DATA_TEST_ALGORITHM=v2` 或 `dp`，仅在选择时加载归档算法；`npm run data:test:parallel` 使用归档 V2 并行工具。

根目录的搜索基准记录保留新算法结果，完整历史记录位于归档目录。最优性结论限定于传入求解器的候选集合，MIP 的数值最优状态不等同于形式化有理数证明。

执行相关测试：

```powershell
$files = @(Get-ChildItem scripts/test -Filter '*.test.ts') + @(Get-ChildItem scripts/test/archived -Filter '*.test.ts')
node --experimental-strip-types --test $files.FullName
```
