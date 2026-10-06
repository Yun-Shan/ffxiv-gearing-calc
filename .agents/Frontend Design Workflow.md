## Frontend Design Workflow

For substantial user-facing frontend work, apply the following workflow.

### Ownership

The **Root Agent** owns:
- scope and task decomposition
- acceptance criteria
- orchestration
- design approval and design lock
- conflict resolution
- final acceptance against the original goal

Preserve the existing stack, architecture, design system, and project conventions unless the goal explicitly requires changing them.

---

### Design Source of Truth

For substantial frontend design work, **Penpot is the sole source of truth for user-facing UI design**.

The accepted Penpot design is the **only authoritative design specification** for implementation and acceptance. Screenshots, Product Design output, the existing implementation, prose notes, and agent inference may provide context, but they must not define or override the accepted UI design unless the Root Agent explicitly reopens the design phase and updates Penpot.

The specification includes, when applicable:
- page and layer structure
- component and variant identity
- layout and sizing
- Flex/Grid behavior
- spacing and alignment
- typography
- colors, borders, radius, and shadows
- design tokens
- responsive intent
- interaction and component states

Use structured Penpot data as authoritative for all machine-readable design facts.

Do not infer dimensions, spacing, typography, colors, component relationships, variants, tokens, or layout behavior from screenshots when that information is available from Penpot.

Screenshots used during validation must be exported from the accepted Penpot design and are a visual projection of the same source of truth, not an independent design source.

Once the Root Agent accepts a design, treat it as **design-locked**.

Implementation agents must not:
- redesign the accepted surface;
- substantially reinterpret the accepted design;
- modify the Penpot design merely to make the implementation easier or validation pass.

Material design or implementation conflicts must be surfaced to the Root Agent. Existing project conventions may constrain implementation, but they must not silently override the accepted Penpot design. If a conflict requires a design change, update and re-lock Penpot before implementation continues.

---

### Penpot Workflow

Invoke the **Penpot MCP** before implementation when the task requires meaningful:
- UI/UX decisions
- layout or information hierarchy decisions
- navigation or interaction design
- visual direction
- redesign of an existing surface
- design of a new user-facing screen or major feature

The design workflow should normally be:

1. inspect existing project conventions and reusable UI components;
2. inspect existing Penpot libraries, components, variants, and tokens where available;
3. create or refine the design in Penpot;
4. iterate on the structured design rather than repeatedly regenerating whole-screen images;
5. reuse existing design-system components and tokens where appropriate;
6. obtain Root Agent or user acceptance;
7. lock the accepted Penpot design before implementation begins.

Prefer localized Penpot edits for design iteration.

For example, modify the relevant component, token, spacing, layout, or typography property instead of regenerating or replacing an unrelated portion of the design.

---

### Product Design

Use **Product Design** only as a supporting exploration or critique capability. It is never an authoritative design source.

Invoke Product Design when useful for:
- early UX exploration;
- generating substantially different visual directions;
- moodboards and visual-language exploration;
- information-hierarchy exploration;
- auditing an existing user flow or interface;
- obtaining additional UX or visual critique;
- providing optional qualitative critique that may inform a future Penpot revision.

Product Design ImageGen output is **conceptual reference only** and must never be used as an implementation or acceptance specification.

When a Product Design direction is accepted:
1. translate or recreate the accepted direction as a structured Penpot design;
2. refine it in Penpot;
3. treat the resulting Penpot design as authoritative.

Do not implement a substantial final UI directly from an ImageGen mock when a Penpot specification is expected.

Product Design must not override an accepted Penpot design. If Product Design reveals a worthwhile change, the Root Agent must explicitly reopen the design phase, apply the change in Penpot, obtain acceptance, and re-lock Penpot before implementation resumes.

---

### Build Web Apps

Invoke **Build Web Apps** for substantial frontend implementation where broader frontend engineering guidance is useful.

It must:
- implement the accepted Penpot specification faithfully;
- inspect structured Penpot properties rather than relying only on screenshots;
- follow existing project conventions and reusable components;
- map Penpot components and tokens to existing code components and tokens where possible;
- apply relevant frontend, React, component, accessibility, performance, and responsive-design best practices;
- avoid unnecessary framework, dependency, or architecture changes.

Build Web Apps must not independently redesign an accepted Penpot design.

If an exact design decision cannot be implemented because of a material technical constraint, surface the conflict to the Root Agent instead of silently approximating or redesigning it.

---

### Implementation Boundary

Implementation agents should normally have **read-oriented Penpot responsibilities**.

They may inspect:
- design structure
- geometry
- layout
- components
- variants
- tokens
- typography
- styles
- exported visual references

They must not modify the accepted design merely to make the implementation match their existing code.

When design changes are genuinely necessary, return control to the Root Agent or designated design agent.

This separation prevents implementation from changing its own acceptance target.

---

### Validation

For substantial rendered UI changes, validate the **actual running application** rather than relying only on code inspection.

Check as applicable:
- required behavior
- interaction states
- responsive behavior
- layout and overflow
- typography and spacing
- component usage
- visual hierarchy
- obvious accessibility issues
- regressions in affected surfaces

Validation must use both **structured Penpot specification checks** and **screenshot-based visual comparison** for substantial rendered UI changes. Both validation tracks are mandatory and both must pass before completion.

#### Structural Validation

Compare important implementation properties against Penpot, including as applicable:
- dimensions
- position and alignment
- padding and gap
- Flex/Grid behavior
- typography
- colors
- radius
- borders and shadows
- component and variant identity
- design-token usage

Use actual rendered DOM geometry and computed styles for the implementation side of structural comparison.

Do not replace structured validation with subjective visual judgment. Structural validation must compare the rendered implementation against authoritative Penpot data for all material machine-readable properties.

#### Visual Validation

Render the actual application using Browser or Playwright.

For substantial rendered UI changes:
- export or capture the corresponding accepted Penpot reference at the same target viewport and state;
- capture a screenshot of the actual implementation;
- compare the two screenshots directly, using visual-regression tooling where available;
- inspect desktop and every relevant responsive viewport/state covered by the task;
- resolve all material visual discrepancies before acceptance.

Screenshot comparison is mandatory and supplements, rather than replaces, structural validation.

Pixel-perfect equality is not required where browser rendering, font rasterization, or subpixel differences make it unreasonable. However, any tolerated difference must be explainable as a rendering artifact rather than a design mismatch; material visual differences must not be accepted merely because the implementation is "close enough."

---

### Product Design QA

Product Design QA may be used as an **optional qualitative critique** after implementation, but it is not part of the authoritative acceptance evidence.

It may identify:
- possible visual hierarchy or composition concerns;
- possible interaction or UX concerns;
- areas worth reconsidering in a future design iteration.

Any finding that would change the accepted UI must first be applied to Penpot through an explicitly reopened design phase, accepted, and re-locked.

Product Design QA does not replace or override:
- Penpot structured specification checks;
- Penpot-derived screenshot comparison;
- rendered application testing.

---

### Completion

A frontend goal is complete only when:

1. required behavior is implemented;
2. material validation findings are resolved;
3. the implementation faithfully matches the accepted Penpot design;
4. mandatory structured validation against Penpot passes;
5. mandatory screenshot comparison against the accepted Penpot reference passes;
6. material structural discrepancies are resolved;
7. material visual discrepancies are resolved;
8. an independent Tester/Reviewer verifies both validation tracks against the original goal and accepted Penpot design;
9. the Root Agent accepts the final result.

Do not stop at reporting fixable findings when they can be addressed within the task scope.

Do not declare completion merely because the implementation is visually similar, or because only one of the two validation tracks passes.

---

### Skip Unnecessary Workflows

Do **not** invoke Penpot design work for:
- trivial text or content changes;
- isolated CSS/style-value adjustments with an already-known target value;
- small fixes requiring no meaningful design decision;
- pure backend or business-logic work.

Do **not** invoke Product Design for:
- trivial implementation work;
- isolated style-value adjustments;
- straightforward implementation from an already accepted Penpot design;
- tasks where no UX or visual exploration is required.

Do **not** invoke Build Web Apps for:
- trivial text or content changes;
- isolated style-value changes;
- simple prop, attribute, or configuration changes;
- obvious one-line or highly localized frontend fixes;
- changes that can be safely implemented using established project patterns without broader frontend engineering guidance.

For small frontend changes, perform direct implementation with proportionate validation.

---

### Responsibility Boundary

- **Root Agent:** planning, orchestration, acceptance criteria, design approval, design lock, conflict resolution, final acceptance
- **Penpot / Design Agent:** authoritative structured UI specification, components, layout, tokens, and design iteration
- **Product Design:** non-authoritative visual/UX exploration, audit, and critique
- **Build Web Apps:** substantial frontend implementation and engineering guidance
- **Tester:** functional/responsive validation plus mandatory Penpot-structured and screenshot-based comparison
- **Reviewer:** independent verification against the original goal and accepted Penpot specification

When responsibilities overlap, the priority is:

**Original Goal → Root Agent acceptance criteria → accepted Penpot specification (sole UI design source of truth) → existing project conventions → implementation details.**

---

### Repository Workflow for Penpot-Led Frontend Work

For substantial frontend work in this repository:

1. Follow the repository’s Astra Orchestrator requirement when task complexity calls for it; the Root Agent retains architecture, tool ownership, and final acceptance.
2. Read `AGENTS.md`, `README.md`, `docs/PROJECT_RULES.md`, and `docs/前端设计总览.md`. The overview records only the broad visual language and available design viewports; it is not a detailed screen specification.
3. Read `.agents/PENPOT_PLAYWRIGHT_WORKFLOW.md` before opening or querying Penpot. It owns the project-specific MCP and Playwright operating procedure.
4. Inspect the accepted Penpot pages and target artboards before changing the UI. Use Penpot’s structured properties for exact content, hierarchy, dimensions, typography, colors, tokens, and states. When prose documentation conflicts with Penpot, follow Penpot and correct only the affected documentation references.
5. For implementation work, use the Penpot Tailwind HTML template as a starting point when available. Treat generated markup as raw material: preserve the rendered design while simplifying markup, applying React best practices, and extracting reusable components according to stable responsibilities.
6. Map Penpot tokens to the project’s global design tokens. Keep page and component styling local with CSS Modules or Tailwind where practical; avoid introducing new global selectors for a single surface.
7. After replacing a surface, remove obsolete styles that no longer have a matching rendered class and check CSS Module selectors for unused exports. Preserve shared rules that remain used by in-scope screens.
8. Accept substantial UI work only after checking the complete user path and each Penpot-defined viewport/state. Compare both rendered DOM geometry/computed styles against Penpot structure and Playwright screenshots against the corresponding Penpot rendering. Do not infer layouts for viewports or states absent from Penpot.

Keep detailed component structure, exact copy, element measurements, and state-by-state behavior in Penpot rather than duplicating them in this workflow or other project documents. The overview may summarize the shared visual direction and target artboards only.
