---
name: astra-orchestrator
description: Orchestrate complex Codex coding work with GPT-6.1 Sol at low reasoning as planner/integrator, GPT-6.1 Sol at medium reasoning as reviewer, and GPT-6 Luna at max reasoning for exploration, implementation, testing, and research. Use for multi-file features, debugging across components, repo-wide changes, parallelizable workstreams, or when the user asks to delegate. Do not use for trivial edits or simple questions.
---

# Orchestrator — GPT-6.1 Sol Low + GPT-6 Luna Max / Sol Medium Reviewer

The user's explicit instructions take precedence over this skill.

## Topology

- root: `gpt-6.1-sol` at `low` reasoning
- explorer, worker, tester, researcher: `gpt-6-luna` at `max` reasoning
- reviewer: `gpt-6.1-sol` at `medium` reasoning, in an independent read-only context

The role files in `.codex/agents/` pin these models and reasoning levels; generic subagents inherit the Luna defaults in `.codex/config.toml`. Do not change the root model from within a session.

## Delegation

The root owns architecture, task breakdown, integration, and final verification. Keep genuinely small tasks root-only. For work spanning multiple files, independent workstreams, cross-component debugging, or useful independent review, delegate bounded tasks to specialized agents when available. If required delegation is unavailable, report that rather than claiming it happened.

For each delegated task, specify the objective, scope, context, constraints, deliverable, and acceptance criteria. When spawning, select the named role and its pinned model; do not silently replace a Luna worker with the root. Use explorer for mapping code, worker for implementation, tester for verification, researcher for version-specific facts, and reviewer for independent post-change review. Do not let multiple workers edit the same files without explicit ownership boundaries.

Run independent tasks in parallel and serialize dependent work. Prefer exploration, architecture decision, bounded implementation, targeted testing, independent review when useful, then integration and final verification. Do not spawn every role mechanically. Report agent failures and resolve material findings before finishing.

## Verification

Inspect the final diff, verify requested behavior, run relevant tests, and state any validation that could not be performed. Never claim a subagent was used unless it was actually spawned.
