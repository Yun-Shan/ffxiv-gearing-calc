# UI 重构文档

状态：重构设计方案，尚未实施或验收；与现行规则冲突的部分须逐项确认，不能由历史讨论代替本轮确认。整理日期：2026-10-16。本轮只整理文档，不修改生产代码、游戏数据、Penpot 或 GitHub 内容；不考虑旧数据兼容。

## 阅读顺序

| 文档 | 内容 |
| --- | --- |
| [冲突与修改边界](00-冲突与修改边界.md) | 本轮适用依据、待确认冲突、src/ui 外审批与规则更新时点 |
| [架构与状态](01-架构与状态.md) | phase、Draft/Snapshot、scope、源码所有权、Selection |
| [条件与编译](02-条件与编译.md) | 等级、GCD、Food、装备事务、validation |
| [搜索与历史](03-搜索与历史.md) | controller、竞态、耗时、History、版本与持久化 |
| [结果与实验室](04-结果与实验室.md) | 指标、Joint tabs、GearTable、等价替换、Comparison、导入 |
| [布局与样式](05-布局与样式.md) | 视觉依据、几何、样式所有权、Base UI、滚动边界 |
| [实施与验收](06-实施与验收.md) | 依赖顺序、验证矩阵、未展开的设计与交付证据 |

## 来源与归并口径

依据[重构UI设计讨论](chatgpt-conversation://6ad19d13-1898-83ec-9ec8-1b4a11faa724)与 [Issue #2](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2)。本次读取了聊天接口返回的最近讨论（接口无更早分页游标）及 issue 正文与全部 7 条评论；较早讨论通过 issue 中的结论归纳承接，不声称已逐条读取完整聊天原文。

| 来源 | 作用 |
| --- | --- |
| [正文](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2) | 基础状态、scope、条件与工作流模型 |
| [回顾补充](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6209390218) | 提出 7 项缺口；由最终设计补充解决 |
| [最终设计补充](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6210161797) | 覆盖等级、目标、装备、validation、反馈、历史与取消冲突 |
| [实验室与源码所有权](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6210358727) | 平级路由、page-local 与跨页 feature 边界 |
| [装备对比](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6212437647) | Comparison 与 row-driven GearTable |
| [同属性替换](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6212659992) | Single 同步结果替换与同记录回写 |
| [配装链接导入](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6212897982) | 扩展 Comparison 来源，覆盖“第一版仅历史” |
| [样式约束](https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/2#issuecomment-6216126292) | 最终尺寸、tab、滚动与全部现有 @media 删除 |

本组文档按主题合并最终结论，不将已被覆盖的旧建议并列为备选。类型和函数名为契约示意，具体命名可随实现调整。

## 本轮核对与适用优先级

本次重新读取 GitHub Issue 正文及全部 7 条评论后逐项核对。当前聊天中用户后续指示优先于 Issue：Penpot 仅风格参考、规则完成后更新、仅 src/ui 重构并先 mock，全部 UI 完成后最终 Playwright 前才确认具体 domain 方案。Issue 内由后续明确覆盖的评论优先于早期正文；未被覆盖的内容继续适用。

已修正 controller 旁路图、Result 的类型配对与来源上下文、Comparison 基准措辞和版本字段等。源讨论本身尚不明确的行为集中记录在[冲突与修改边界](00-冲突与修改边界.md)，不能把“已归并”理解为所有实施细节都已定稿。

## 与当前仓库规则的关系

本组是重构设计，不表示当前实现或现行规则已经改变。Penpot 尚未按本方案修改，本次仅作为视觉风格参考；页面结构、内容、布局、流程和验收依据为本组设计及用户后续确认，不要求匹配旧画板。

具体冲突及确认状态见[冲突与修改边界](00-冲突与修改边界.md)。发现与现行规则的冲突时先列明原规则、目标变化和影响，向用户逐项确认；未确认前不实施冲突部分。规则文档在重构完成后，经用户确认修改范围再更新，不在设计期提前改成目标规则。

实施的默认可修改范围仅为 `src/ui/**`。凡涉及该目录以外的修改，必须先列明文件、原因、行为影响及验证方案，再由用户确认；已有设计结论不等于目录外修改授权。本轮用户要求的重构文档修订仅授权此次说明整理，不授权后续实现或现行规则变更。

代码实施顺序固定为：仅在 src/ui 完成重构及 mock 组件测试 → 汇总真实 domain 缺口与具体方案 → 用户确认 → 修改获批的 src/domain 范围并验证 → 最终 Playwright 测试复核。不能提前改 domain，也不能将 mock 测试当作真实集成验收。
