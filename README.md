# 配装工坊

纯前端的 FFXIV 自动配装优化器。项目把游戏规则、属性公式和搜索算法放在 `src/domain` 中，UI 层只负责配置与结果展示，方便未来把领域层单独发布成库。

## 开发

```bash
npm install
npm run dev
```

## 验证

```bash
npm run build
npm run test:coverage
```

覆盖率门槛对纯逻辑层的语句、分支、函数和行均为 90%。规则层包含基础属性与职业修正、伤害期望、GCD、食物封顶、单件装备属性上限、装备过滤、魔晶石候选、可行 GCD 查询和 Beam Search 优化逻辑。界面中的 GCD 可先手动输入任意值，也可以按当前约束计算全部真实可行档位后直接选择；查询出的武士可行档位均有对应的回归测试，指定档位不会因伤害 Beam 裁剪而无结果。法系 GCD 按 `SPS` 计算，最高档位从基础 2.50 秒开始。

## 多线程优化

优化器运行在 Web Worker 中（src/domain/optimizer.worker.ts），避免主线程被复杂的赋予搜索阻塞。默认以首个装备槽候选为划分将任务拆为多个子任务后分发到多个 worker，每个 worker 跑完整搜索后主线程取最优。拆分本身不会改变输出的全局最优性：各个子任务状态集互不包含同一装备 ID，合并后的最优解仍为全局最优。
结果页使用中文固定文案（保留 GCD、原始装备名称和来源名称），同页展示推荐配装、每件装备的最终属性、魔晶石和配装总属性。装备原生副属性达到单件上限时会加粗；“每威力伤害期望”沿用参考项目的取整顺序和计算公式。

## 更新数据

项目的数据来源是 MCP 优先、参考项目补缺：能从对应 MCP 服务器取得的目标版本游戏资料必须使用 MCP，只有确认 MCP 缺失的资料才使用 [Asvel/ffxiv-gearing](https://github.com/Asvel/ffxiv-gearing)。MCP 与参考项目的适用范围、回退条件和版本一致性要求见 [项目规则与实现记录](docs/PROJECT_RULES.md)。

先由脚本启动环境提供的 `ffxiv-mcp-lumina` stdio 服务器并生成可复现快照，再由统一更新器合并参考项目中 MCP 未覆盖的领域常量：

```bash
npm run data:mcp
npm run data:update
```

`data:mcp` 默认查询参考项目中的全部装备、战斗食物、职业分类、食物效果、属性上限、魔晶石和当前已确认的自定义参数武器表（`MandervilleWeaponEnhance`），并写入 `src/data/mcp-lumina.snapshot.json`。它要求本机配置的游戏目录、EXDSchema 和 Lumina MCP 可执行文件；可用 `FFXIV_MCP_LUMINA_COMMAND`、`McpLumina__GamePath`、`McpLumina__SchemaPath` 和 `FFXIV_MCP_LUMINA_CONCURRENCY` 覆盖默认值。脚本会先校验 MCP 游戏版本等于验证版本，任一批次重试失败都会终止。

参考仓库默认位于 `reference/ffxiv-gearing`，可用 `FFXIV_GEARING_ROOT` 指向另一份本地检出。已有快照和本地参考数据时可运行 `node scripts/update-data.mjs --offline`，该模式不会访问网络，也不会直接启动 MCP。

生成数据记录 MCP 游戏/验证版本、查询时间、Sheet、字段和行范围，以及参考仓库 URL、精确 commit、导入时间和源文件。解析器会严格校验数量、重复 ID、职业、魔晶石及必需字段；当前快照覆盖 21927 件可用战斗装备和 420 种战斗食物；`ItemFood` 行 1800 当前未被参考项目用作食物效果参数，导入器会记录该查询缺口但不把它作为必需效果行，并使用同一动作中其余 MCP 效果字段。源数据缺失或异常时直接失败，运行时没有演示数据或合成数据回退。

## 维护文档

- [项目规则与实现记录](docs/PROJECT_RULES.md)：游戏规则、数据约束、已修复问题、算法边界和正确演进方向。
- [AGENTS.md](AGENTS.md)：后续编码代理必须遵守的项目约束与验证流程。
