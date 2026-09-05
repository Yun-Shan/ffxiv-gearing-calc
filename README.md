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

结果页使用中文固定文案（保留 GCD、原始装备名称和来源名称），同页展示推荐配装、每件装备的最终属性、魔晶石和配装总属性。装备原生副属性达到单件上限时会加粗；“每威力伤害期望”沿用参考项目的取整顺序和计算公式。

## 更新数据

更新脚本会拉取参考项目 [Asvel/ffxiv-gearing](https://github.com/Asvel/ffxiv-gearing)，直接解析其 `data/out/gears-*.js`、`foods.js`、`jobCategories.js` 和 `src/game.ts`，再生成 `src/data/generated-data.json`：

```bash
npm run data:update
```

参考仓库默认位于 `reference/ffxiv-gearing`，可用 `FFXIV_GEARING_ROOT` 指向另一份本地检出。已有本地数据时可运行 `node scripts/update-data.mjs --offline`，该模式不会访问网络。

生成数据记录参考仓库 URL、精确 commit、导入时间和所有源文件。解析器会严格校验数量、重复 ID、职业、魔晶石及必需字段；源数据缺失或异常时直接失败，运行时也没有演示数据或合成数据回退。

## 维护文档

- [项目规则与实现记录](docs/PROJECT_RULES.md)：游戏规则、数据约束、已修复问题、算法边界和正确演进方向。
- [AGENTS.md](AGENTS.md)：后续编码代理必须遵守的项目约束与验证流程。
