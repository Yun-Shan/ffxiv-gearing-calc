# UI 重构文档

状态：本轮重构主 specification；2026-10-18 最终验收通过。M01–M04 已真实接入，装备对比采用已确认的表格区域滚动，当前状态见[Mock 盘点与真实接入](07-Mock盘点与真实接入.md)。整理日期：2026-10-16。已确认的产品和架构边界直接按本文档执行；具体 domain 方案在对应功能中提交确认。

## 阅读顺序

| 文档 | 内容 |
| --- | --- |
| [冲突与修改边界](00-冲突与修改边界.md) | 设计权威、修改范围、domain 确认与规则维护边界 |
| [架构与状态](01-架构与状态.md) | phase、Draft/Snapshot、scope、源码所有权、Selection |
| [条件与编译](02-条件与编译.md) | 等级、GCD、Food、装备事务、validation |
| [搜索与历史](03-搜索与历史.md) | controller、竞态、耗时、History、版本与持久化 |
| [结果与实验室](04-结果与实验室.md) | 指标、Joint tabs、GearTable、等价替换、Comparison、导入 |
| [布局与样式](05-布局与样式.md) | 视觉依据、几何、样式所有权、Base UI、滚动边界 |
| [实施与验收](06-实施与验收.md) | 依赖顺序、验证矩阵、未展开的设计与交付证据 |
| [Mock 盘点与真实接入](07-Mock盘点与真实接入.md) | 当前 mock/待接入清单、逐项确认的契约与验证证据 |
| [最终验收](08-最终验收.md) | 两种目标视口的真实浏览器流程、完整测试与最终通过项 |

## 来源与归并口径

依据[重构UI设计讨论](chatgpt-conversation://6ad19d13-1898-83ec-9ec8-1b4a11faa724)与 [Issue #2](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2)。本次读取了聊天接口返回的最近讨论（接口无更早分页游标）及 Issue 正文、评论结论；较早讨论通过 issue 中的结论归纳承接，不声称已逐条读取完整聊天原文。

| 来源 | 作用 |
| --- | --- |
| [正文](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2) | 基础状态、scope、条件与工作流模型 |
| [回顾补充](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6209390218) | 提出 7 项缺口；由最终设计补充解决 |
| [最终设计补充](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6210161797) | 覆盖等级、目标、装备、validation、反馈、历史与取消冲突 |
| [实验室与源码所有权](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6210358727) | 平级路由、page-local 与跨页 feature 边界 |
| [装备对比](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6212437647) | Comparison 与 row-driven GearTable |
| [同属性替换](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6212659992) | Single 同步结果替换与同记录回写 |
| [配装链接导入](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6212897982) | 扩展 Comparison 来源，覆盖“第一版仅历史” |
| [样式约束](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6216126292) | 尺寸、tab、滚动与全部现有 @media 删除 |
| [最终决断](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6218665833) | 跨 scope 事务、Comparison 行为、设计权威、修改范围与按功能接入 domain |

本组文档按主题合并最终结论，不将已被覆盖的旧建议并列为备选。类型和函数名为契约示意，具体命名可随实现调整。

## 设计权威与实施边界

本组文档及用户确认是本次重构的第一权威。以[最终决断](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6218665833)为准归并 Issue 结论；被覆盖的旧建议不再作为实施选项。

Penpot 已弃用。本目录各文档中涉及 Penpot 的设计依据、风格参考及画板一致性验收等说明均已失效，统一改为参考[前端设计总览](../前端设计总览.md)中的文字版风格描述；结构、内容、布局与流程仍按本组文档及用户确认执行。

主要修改范围为 src/ui；完成已确认 UI 重构所需的最小全局样式、App/UI entry 和直接相关测试一并纳入。src/styles.scss 的旧全局控件样式与全部现有 @media 必须清理，不保留为目录外残留。

按功能的真实依赖推进：UI 基础能力 → 需要新的 domain 契约时提交具体方案、文件范围、行为影响和验证方案 → 用户确认 → 实现真实契约并接入该功能 → 集成验证。mock 可用于前置组件开发，不能将所有真实 domain 接入积压到最后。具体范围见[冲突与修改边界](00-冲突与修改边界.md)，实施顺序见[实施与验收](06-实施与验收.md)。

## 数据兼容与规则维护

不设计旧 schema / IndexedDB migration 兼容流程，不兼容旧分享链接格式。现有 schema 下不同 dataVersion 的 completed History result 必须允许查看与 Comparison，保持历史原值；跨版本编辑条件确认后使用当前数据重新搜索。

本组定义目标设计，不表示当前生产代码或现行规则已经符合。README、工程/领域规则与前端总览已按用户授权同步当前交付契约。已确认的本次例外见边界文档，不重复询问；新的 domain 实现方案与浏览器证明设计无法成立的情况按规定确认。
