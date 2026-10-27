<p align="center">
  <img src="public/icons/logo-128.png" alt="自动配装器 Logo" width="96" height="96">
</p>

<h1 align="center">最终幻想14自动配装器</h1>

<p align="center">为你的职业自动寻找配装，兼顾多职业的装备共享。</p>

<p align="center">
  <a href="https://ffxiv-gear.yunshan.dev/"><strong>在线使用 · ffxiv-gear.yunshan.dev</strong></a>
</p>

<p align="center">
  <a href="https://github.com/Yun-Shan/ffxiv-gearing-calc/actions/workflows/deploy-pages.yml">
    <img src="https://github.com/Yun-Shan/ffxiv-gearing-calc/actions/workflows/deploy-pages.yml/badge.svg" alt="GitHub Pages 部署状态">
  </a>
</p>

一款在浏览器中运行的 FFXIV 自动配装工具。选择职业并设置装备范围、GCD 等条件，即可搜索装备、魔晶石与食物的搭配，减少手动比较配装的时间。计算在本地完成，无需安装或登录。

目前已开放使用，部分功能仍在开发。多职业联合搜索与装备对比可从「实验室」进入。

## 特色功能

- **单职业自动配装**：按装备品级、获取来源和 GCD 等条件寻找配装。GCD 可选择单个档位、多个档位（也可只选一档）或设置速度范围。可以排除不想使用的装备，或锁定已有装备、镶嵌与自定义参数，让工具优化其余部分。
- **多职业共享配装**：为同组职业一起规划装备与镶嵌。自行选择共享部位，分别设置各职业的 GCD 等条件，在多个职业之间寻找合适的共同方案。
- **同步配装**：支持按等级、品级或副本设置同步目标，为绝境战、幻巧战等场景寻找装备搭配。
- **查看结果**：查看完整装备、镶嵌、食物、总属性和伤害期望，可在[Asvel 配装器](https://asvel.github.io/ffxiv-gearing/)中打开方案，或点击「分享配装结果」选择复制分享链接或不含操作按钮的结果图片。分享链接直接恢复配装与条件，不自动启动搜索或写入历史；接收者可主动以该条件重算。同步单职业结果页提供「可替换」功能，可换用最终生效属性相同的装备，保持配装指标不变。
- **阶段导航与刷新恢复**：单职业和联合工作台的条件、进度与结果分别显示在独立地址中，并支持浏览器前进和后退。同一浏览器会话刷新可恢复当前页的已提交条件或结果；刷新进度页回到条件，不会恢复正在运行的搜索。

## 界面预览

配装结果：

![骑士在品级 605 同步、最低减伤 1% 条件下的配装结果，展示装备、属性、图片分享与「可替换」入口](docs/images/search-result.png)

<details>
<summary>更多截图</summary>

**单职业搜索**：设置装备范围、食物、GCD、坚韧和装备限制，示例选择「最低减伤百分比」。

![单职业搜索条件设置，坚韧策略选择最低减伤百分比，示例下限为 1%](docs/images/single-search.png)

**多职业联合搜索**：选择共享部位与食物策略，通过职业标签分别设置条件。

![骑士与战士的联合搜索条件设置](docs/images/joint-search.png)

</details>

## 使用说明

支持 20 个普通战斗职业，以及青魔法师、驯兽师；联合搜索目前开放普通战斗职业。具体数据版本请查看结果页。

建议在桌面浏览器中使用。搜索比较的是纸面伤害期望，未针对具体副本时间轴或职业循环调整，实际配装请结合自己的打法选择。

首次打开时会等待应用和游戏数据就绪；等待较久时显示加载提示。启动失败会停留在错误页，可查看详情并点击「重新加载」，本地搜索历史不会因此清空。

复杂条件下，尤其是多职业联合搜索，可能需要较长时间。搜索中可查看进度或随时取消。更多说明见[常见问题](https://ffxiv-gear.yunshan.dev/faq)。

## 反馈

[提交 Bug 或建议 → GitHub Issues](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/new/choose)

## 开发与致谢

开发与维护说明见[开发指南](docs/开发指南.md)。

页面路由使用 [TanStack Router](https://tanstack.com/router)；项目采用其 React 文件路由，并由 Vite 插件生成路由树。

部署基路径在 `index.html` 中通过 `<base href="/">` 设置，默认位于 `/`。部署到子目录时，由部署方在构建前修改其 `href` 并重新构建；操作说明见[开发指南](docs/开发指南.md#github-pages-部署)。

感谢以下社区项目：

- [Asvel / ffxiv-gearing](https://github.com/Asvel/ffxiv-gearing)：配装、公式与数据参考。
- [Lumina](https://github.com/NotAdam/Lumina) / [EXDSchema](https://github.com/xivdev/EXDSchema) / [mcp-ffxiv-lumina](https://github.com/MelkyWay/mcp-ffxiv-lumina)：游戏数据读取、字段定义与 MCP 查询服务。
- [thewakingsands/xivapi-v2](https://github.com/thewakingsands/xivapi-v2)：装备与职业图标服务。
