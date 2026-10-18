# 配装工坊

纯前端的 FFXIV 自动配装优化器，使用 React、Base UI 和 TypeScript。单职业与同组多职业联合搜索支持装备/食物筛选、同步、装备锁定、GCD 和坚韧约束，以及共享装备与镶嵌。联合目标按各职业单独最优基线归一化；搜索完成最优性复核后返回结果，支持进度、取消及本地历史。

业务行为与候选域见[领域与搜索规则](docs/rules/领域与搜索规则.md)；界面方向和文字版风格参考见[前端设计总览](docs/前端设计总览.md)。

## 页面与功能

- `/single`：单职业搜索；同步结果支持同属性装备替换并回写同一历史记录。
- `/lab`：实验室入口；`/joint` 提供多职业联合搜索，种族、装备品级范围与同步品级为全职业共享条件，各职业单独设置 GCD、食物与坚韧条件。
- `/gear-comparison`：同职业最多四方案对比，可从 Single/Joint 已完成历史或完整 Asvel 分享链接添加。导入按当前数据计算固定配装，保留合法镶嵌与自定义参数，不启动搜索或新增历史；装备表区域允许滚动查看全部内容。
- `/faq`：常见问题；每条问答使用同一组件展示，列表在容器内滚动。
- `/about`：关于；列出项目使用的参考项目、数据与图标来源以及主要依赖。
- 结果食物包含各项上限、比例、实际增益和真实利用率；单职业与多职业高级设置共用同一对话框，目前无实际设置项。

界面结构与滚动边界见[前端设计总览](docs/前端设计总览.md)，交付验收要求见[工程规则](docs/rules/工程规则.md)。四方案容量合成预览仅在开发环境 `/gear-comparison?ui-preview=comparison-capacity` 启用。

## 开发

```bash
npm install
npm run dev
npm run build
npm run preview
```

## 验证与性能验收

按[工程规则](docs/rules/工程规则.md)选择与改动相关的检查：

```bash
npm test
npm run test:coverage
npx vitest run src/ui
npm run test:data
npm run data:test:v3
```

覆盖率门槛与正式搜索验收是不同检查，不能用测试命令成功代替覆盖率达标或完整证明。Node 测试和多职业验收的配置见[运行说明](scripts/node-tests/README.md)。

全场景性能验收：

```bash
node docs/search-optimization/tools/run-acceptance.mjs
```

场景筛选、时间保护、计时边界、历史对比和产物说明见[性能验收说明](docs/search-optimization/README.md)。浏览器正式搜索不设时限，Node 验收的保护时限不等于产品性能目标。

## 更新数据

来源、回退条件和版本要求见[数据规则](docs/rules/数据规则.md)。先查询 MCP 保存可复现输入，再由统一更新器生成运行时二进制快照：

```bash
npm run data:mcp
npm run data:update
```

本机需配置游戏目录、EXDSchema 与 Lumina MCP 可执行文件。可用 `FFXIV_MCP_LUMINA_COMMAND`、`McpLumina__GamePath`、`McpLumina__SchemaPath` 和 `FFXIV_MCP_LUMINA_CONCURRENCY` 覆盖查询脚本默认配置。

参考项目默认检出到 `reference/ffxiv-gearing`，可用 `FFXIV_GEARING_ROOT` 指定其他本地检出。已有 MCP 快照及参考导出时可离线生成，不启动 MCP 或访问网络：

```bash
node scripts/update-data.mjs --offline
```

仅补充已有同版本快照的同步等级和可变等级装备查询输入时，可运行 `node scripts/query-mcp-lumina.mjs --level-basis-data-only`，再离线生成；版本不一致时失败。

运行时产物为 `src/data/generated-data.bin`，MCP 输入保存在 `src/data/mcp-lumina.snapshot.json`。版本、数量和缺口以来源元数据为准；二进制契约见[格式规范](docs/运行时数据二进制格式.md)。`npm run data:benchmark` 用于测量数据加载与解码。

装备与食物图标使用统一数字 ID URL helper，从 XIVAPI CDN 加载 PNG；映射元数据位于 `src/ui/services/generated/`，不保留旧本地职业 PNG。图标映射生成入口为 `scripts/generate-ui-item-icons.mjs` 与 `scripts/generate-ui-job-icons.mjs`。

## 文档入口

| 目的 | 入口 |
| --- | --- |
| 代理任务与按需阅读 | [AGENTS.md](AGENTS.md) |
| 当前规则分类 | [项目规则索引](docs/PROJECT_RULES.md) |
| 稳定架构与设计取舍 | [顶层设计](自动配装优化项目设计方案.md) |
| 当前搜索模型与边界 | [联合搜索模型](docs/V3正确性与验收.md)、[条件最优性证明](docs/当前搜索算法最优性证明.md) |
| 界面风格与交付验收 | [前端设计总览](docs/前端设计总览.md)、[工程规则](docs/rules/工程规则.md) |
| 性能证据 | [优化总结](docs/search-optimization/搜索耗时优化总结.md)及其引用的验收记录 |

`scripts/archive` 仅保存历史探索，不作为当前入口；旧记录不定义当前规则，也不代表当前性能。
