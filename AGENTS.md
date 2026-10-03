# AGENTS.md

**scripts/archive 目录用于保留已归档的算法探索代码与记录，不作为当前项目入口；其中内容不需要遵守以下除数据来源/引用方式外的项目规范。**

## 项目定位

本项目是一个使用 React、Radix UI 和 TypeScript 开发的纯前端 FFXIV 自动配装优化器，编译目标为 ESNext。业务规则集中在 `src/domain`，以便后续将其独立导出为通用逻辑库。

修改项目行为前必须阅读：

1. `自动配装优化项目设计方案.md`：项目的目标设计。
2. `docs/PROJECT_RULES.md`：已实现规则、已知问题和当前边界。
3. `README.md`：开发与数据更新命令。

## 不可违反的数据规则

- 禁止虚构、合成、近似或添加用于生产环境的演示游戏数据。
- `Item.Name` 为空或仅含空白的物品视为已移除，导入时排除，不参与后续计算；不得用参考项目旧名称恢复。名称字段缺失或格式错误必须明确失败。
- 游戏资料必须优先使用对应 MCP 服务器提供的数据；仅当目标资料无法从 MCP 获取时，才允许回退到本地检出的 `Asvel/ffxiv-gearing` 参考项目。不得因为参考项目更方便而跳过可用的 MCP 数据。
- 所有生产数据必须通过 `scripts/update-data.mjs` 从可复现的 MCP 查询产物和/或参考项目原始导出生成，禁止手动编辑 `src/data/generated-data.json`。
- 必须按数据项保留来源信息。MCP 数据至少记录服务器、Sheet/类型/成员、查询范围、查询或导入时间以及可取得的游戏/文档版本；参考项目数据至少记录仓库 URL、精确 commit、导入时间和源文件清单。
- 必需数据在 MCP 与参考项目中均缺失或格式错误时必须明确失败。禁止为装备、食物、职业、魔晶石、属性上限或武器伤害添加虚构、近似或内置兜底数据。
- 仅允许在隔离的单元测试中使用合成测试对象，生产代码不得访问这些对象。

## MCP 文档与游戏数据服务器引用规范

编写或修改依赖游戏数据、外部 API 或底层结构的解析器、领域类型、公式和测试前，必须先按目标资料的命名空间或数据归属查询对应的 MCP 服务器。不允许凭记忆或训练数据硬写 API 签名、字段偏移、Sheet 名、字段名、行 ID 或枚举值。此判断基于资料归属，与本项目使用 TypeScript 还是 C# 无关。

- 目标资料属于 `Lumina.*` 所代表的游戏数据表时，使用 `ffxiv-mcp-lumina`。装备、食物、职业、技能、状态等 Sheet 的结构使用 `describe_sheet` / `list_sheets`；具体行、行 ID 和枚举值使用 `get_row` / `get_rows` / `search_rows` 或对应的 `get_*` 便捷工具。当前项目的大多数游戏数据查询应使用此服务器。
- 仅当任务实际引用 `Dalamud.*` 类型时，使用 `ffxiv-mcp-dalamud-api` 查询插件服务、钩子、UI、命令以及 `IClientState` / `IDataManager` / `IFramework` 等接口与成员。使用 `list_services`、`get_type`、`get_member`、`search`、`search_members` 或 `find_events`；不得用 Lumina 的表结构查询替代 Dalamud API 文档。
- 仅当任务实际引用 `FFXIVClientStructs.*` 类型时，使用 `ffxiv-mcp-clientstructs` 查询 unmanaged struct、字段偏移、嵌套指针和命名空间。使用 `search_types`、`get_type` 或 `get_namespace`；不得根据相似类型或旧版本布局推测偏移。
- 判断顺序是：先确认目标符号或资料属于 `Lumina.*`、`Dalamud.*` 还是 `FFXIVClientStructs.*`，再查询对应服务器。不确定归属时必须先搜索确认，三类来源不得混用。
- 能由 MCP 返回的目标版本资料必须采用 MCP 结果。只有在对应服务器不存在该 Sheet、类型、成员、字段、目标行或必要查询能力，并确认不是查询名称或方法错误后，才可使用 `Asvel/ffxiv-gearing` 中的对应资料；回退时必须记录 MCP 缺失项和参考项目位置。
- MCP 与参考项目结果不一致时，必须先核对目标游戏版本、MCP 数据/文档版本和参考仓库 commit。版本一致且 MCP 能提供该资料时以 MCP 为准，并同步修正导入逻辑或显式失败；版本无法对齐时禁止静默拼接为同一批生产数据。
- MCP 查询结果进入生产数据前必须形成可复现、可校验且带来源元数据的导入产物，并由 `scripts/update-data.mjs` 统一生成运行时 JSON。不得把聊天文本或一次性查询结果直接手工抄入生成文件。
- MCP 仅因验证版本滞后而报告 `GameVersionMismatch` 时，只有服务器明确声明通用查询不受该警告影响、Schema 可用且全部查询批次为同一当前游戏版本，才可使用通用查询更新整批快照；必须保留检测版本、验证版本、警告和查询来源。其他降级仍须失败，不得混合不同游戏版本的生产表数据。

## 游戏规则正确性

- 所有公式必须在数学意义上与上游实现一致，包括每一个 `floor`、`round`、倍率和运算顺序。
- 最终属性必须从等级、职业和种族基础属性开始计算，不能从零开始。
- 魔晶石必须填满全部可用孔；可禁忌镶嵌的普通装备必须填满五孔，不提供关闭禁忌镶嵌的选项。同步普通装备的魔晶石按同步规则失效，自定义参数武器遵循独立参数槽规则。必须使用上游 `levelCaps`、`slotCaps` 和 `roleCaps` 对单件装备进行属性封顶。
- 魔晶石等级必须根据上游等级要求选择，禁止写死十二型或数值 54。
- 食物必须在基础属性、装备属性和实际生效的魔晶石属性合并后应用。
- 每威力伤害期望必须包含职业武器伤害修正和队伍主属性加成。
- 骑士和驯兽师具有独立盾牌槽。
- 两个戒指槽中使用相同装备ID时必须确保该装备不属于unique装备。

## 前端文案与结果展示

- 用户可见固定文案使用中文；只保留 `GCD` 这一业务专有名词，以及原始数据中的装备名称和来源名称。
- 属性名称使用项目中的中文映射，不得直接把 `STR`、`CRT` 等内部属性代码展示给用户。
- 结果页必须在同一页展示推荐配装、装备逐行属性、食物和配装总属性。
- 装备行显示实际最终属性；普通孔魔晶石造成的单件属性上限截断必须反映在该列数值中。
- 装备原生副属性达到单件上限时加粗，判定必须保持与参考项目 `statHighlights` 一致。
- 伤害指标统一称为“每威力伤害期望”，计算必须复用领域层公式，禁止在 UI 层重新计算。
- GCD 速度属性必须按职业角色读取：坦克、力量职业和灵巧职业使用 `SKS`，治疗职业和智力职业使用 `SPS`。
- GCD 可行性查询输出的每个档位都必须能交给正式优化生成对应结果。

## 架构要求

- 禁止将 React 或 Radix UI 相关代码放入 `src/domain`。
- 除模块加载时的严格数据校验外，领域函数应保持确定性、无副作用。
- 优先扩展现有领域类型和纯函数，禁止在 UI 组件中重复实现游戏公式。
- 上游数据解析必须放在 `scripts/update-data.mjs`。生成的 JSON 是运行时产物，不是人工维护的数据源。
- 只有在能够消除真实重复或隔离稳定业务规则时才增加抽象。

## 用户要求与项目规则冲突时的处理

- 当用户要求修改、新增或删除功能，而该要求与 `AGENTS.md`、`docs/PROJECT_RULES.md` 或《自动配装优化项目设计方案.md》中的现有项目规则冲突时，不得直接实施，也不得擅自忽略用户要求。
- 必须先向用户明确说明发生冲突的具体规则、预期影响，以及需要调整的规则内容，并请求用户确认是否修改项目规则。
- 用户确认修改规则后，才能实施对应的功能变更；同时必须更新所有受影响的项目规则文档，使代码、测试、用户可见行为和文档保持一致。
- 用户未确认修改规则时，应保持现有规则和行为不变，并说明当前无法继续实施冲突部分。
- 如果用户的新要求明确表示要修改现有项目规则，则该要求本身视为修改意图，但仍需在实施前说明将被修改的具体规则及影响，避免因隐含冲突造成非预期变更。

## 编辑纪律

- 保留与任务无关的用户改动，避免大范围格式化文件。
- 注释应集中说明不直观的游戏规则和算法取舍，避免重复描述代码本身。
- 游戏规则、当前边界、数据来源或重要实现方向变化时，必须同步更新 `docs/PROJECT_RULES.md`。
- 命令、安装方式或用户可见能力变化时，必须同步更新 `README.md`。


# Codex project instructions

For complex coding tasks, use the `astra-orchestrator` skill when its trigger conditions match.

The root agent owns architecture, decomposition, integration, and final verification.
Prefer specialized subagents for bounded exploration, implementation, testing, review, and technical research.

Do not delegate trivial work merely for parallelism.
Do not let multiple implementation agents edit the same files without explicit ownership boundaries.
User instructions always take precedence over this orchestration policy.


# Frontend Workflow

When a task involves substantial user-facing frontend work, UI/UX design, layout, interaction design, visual redesign, or non-trivial frontend implementation, read and follow:

`.agents/Frontend Design Workflow.md`

Do not read or apply that file for trivial text/content edits, isolated style-value changes, simple prop/attribute changes, pure backend work, or other small frontend fixes that require no meaningful design or broader frontend engineering decisions.
