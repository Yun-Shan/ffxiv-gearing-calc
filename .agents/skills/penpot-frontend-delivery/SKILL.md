---
name: penpot-frontend-delivery
description: Read or edit this project's Penpot design, manage its Playwright session, or implement and verify user-facing UI against approved artboards.
---

# Penpot-led frontend work

Use this skill when reading or editing Penpot, controlling its connected Playwright session, adding a screen, or materially changing a screen's visual structure, layout, or interaction. For a small text or style fix with an already-known target, follow the project instructions and use proportionate validation.

## Design authority and approval

- Penpot is the sole source of UI facts: page and component structure, content, layout, appearance, states, and responsive intent. Code, screenshots, and prose can help with implementation, but do not override the accepted Penpot design.
- The [frontend design overview](../../../docs/前端设计总览.md) describes project-level visual direction and target desktop viewports only. Keep screen-specific details in the corresponding Penpot artboards. For implementation, read the [engineering rules](../../../docs/rules/工程规则.md), including SCSS Modules and component ownership; generated Tailwind markup does not override them.
- Ask the user to approve a new design or a material change to an accepted design before implementing it, unless the user has already explicitly approved that change. An implementation request does not by itself approve a newly proposed layout, content hierarchy, navigation, or interaction.
- The Root Agent checks that implementation matches the design the user approved. It does not approve a new or changed design on the user's behalf.
- Surface a technical conflict with the approved design to the Root Agent. Do not silently alter Penpot or substantially reinterpret the screen to fit the code.

## Workflow

1. Read the repository instructions and the overview. Find the relevant Penpot artboard and confirm that its design is approved before implementing a new or materially changed surface.
2. Use Penpot's structured data for exact design facts. Prefer Penpot MCP for reading and writing design content when it supports the operation; use Playwright for the connected browser, rendered behavior, screenshots, and operations MCP does not support.
3. Use only viewports and states represented in Penpot. Do not infer a mobile or other responsive design from a desktop artboard.
4. Validate in proportion to the change. For a substantial rendered UI change, check the real application behavior and compare both material DOM geometry/computed styles and a same-viewport, same-state screenshot against the Penpot design. Resolve material mismatches before asking the Root Agent to verify the result. For a small localized fix, a focused check is enough.

Before using Penpot or Playwright, inspect the tools and documentation available in the current environment; names and interfaces can change. Do not treat a tool name or signature in a reference as current without checking it.

Read [the Penpot and Playwright operating procedure](references/penpot-playwright.md) before operating Penpot. Read [heartbeat recovery](references/heartbeat-recovery.md) only if a Penpot MCP call actually times out or reports a heartbeat/suspended-page error. The Tailwind HTML helper is at `scripts/penpot-tailwind-html-once.template.js` and is optional implementation input, never a design specification.

This skill does not require Product Design, Build Web Apps, or delegation. Use them only when the user or task independently calls for them.
