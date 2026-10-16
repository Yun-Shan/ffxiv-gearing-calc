---
name: astra-orchestrator
description: Coordinate complex repository work when bounded delegation, parallel execution, or independent review adds value; keep small tasks with the primary agent.
---

# 项目协作

主代理负责架构判断、任务拆分、整合与最终验证。是否委派取决于并行收益和独立核查价值，不以文件数量或固定角色链触发。

- 探索、实现、测试和复核分别划定目标、范围、约束与交付证据；独立任务可并行，有依赖的操作顺序执行。
- 多个实现代理不同时修改同一文件，除非事先划清边界；避免为拆分而拆分简单工作。
- 重大或高风险改动使用独立复核；复核原始目标与最终结果，解决实质问题后再交付。
- 模型、推理等级和并发配置以 `.codex/config.toml` 及 `.codex/agents/` 为准，不在 skill 复制具体型号。不改变当前会话模型；所需角色或配置不可用时说明实际限制，按可用能力完成其余工作，不声称已完成独立复核。
- 验证按[工程规则](../../../docs/rules/工程规则.md)选择，报告实际结果和未完成项；不要机械启用全部角色或重复运行无关验证。

用户的授权、范围和具体要求优先。新设计或产品规则变更的授权不能由代理之间的批准代替。
