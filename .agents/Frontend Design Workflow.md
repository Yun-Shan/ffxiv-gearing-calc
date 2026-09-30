## Frontend Design Workflow

For substantial user-facing frontend work, apply the following workflow.

### Ownership

The **Root Agent** owns:
- scope and task decomposition
- acceptance criteria
- orchestration
- final acceptance against the original goal

Preserve the existing stack, architecture, design system, and project conventions unless the goal explicitly requires changing them.

### Product Design

Invoke **Product Design** before implementation when the task requires meaningful:
- UI/UX decisions
- layout or information hierarchy decisions
- navigation or interaction design
- visual direction
- redesign of an existing surface
- design of a new user-facing screen or major feature

Its accepted output becomes the **design specification** for implementation.

Once a design direction is accepted, implementation agents must not independently replace or substantially reinterpret it unless a material implementation constraint is discovered. Such conflicts must be surfaced to the Root Agent.

### Build Web Apps

Invoke **Build Web Apps** for substantial frontend implementation where broader frontend engineering guidance is useful.

It must:
- implement the accepted design specification faithfully
- follow existing project conventions and reusable components
- apply relevant frontend, React, component, accessibility, and responsive-design best practices
- avoid unnecessary framework, dependency, or architecture changes

Build Web Apps must not independently redesign an accepted Product Design direction.

### Validation

For substantial rendered UI changes, validate the actual application rather than relying only on code inspection.

Check as applicable:
- required behavior
- interaction states
- responsive behavior
- layout and overflow
- typography and spacing
- visual hierarchy
- obvious accessibility issues
- regressions in affected surfaces

For substantial visual work, run **Product Design QA** after implementation and resolve material discrepancies from the accepted design specification.

### Completion

A frontend goal is complete only when:
1. required behavior is implemented;
2. material validation findings are resolved;
3. substantial visual work matches the accepted design direction;
4. an independent Tester/Reviewer verifies the result against the original goal; and
5. the Root Agent accepts the final result.

Do not stop at reporting fixable findings when they can be addressed within the task scope.

### Skip unnecessary workflows

Do **not** invoke Product Design for:
- trivial text or content changes
- isolated CSS/style-value adjustments
- small fixes requiring no meaningful design decision
- pure backend or business-logic work

Do **not** invoke Build Web Apps for:
- trivial text or content changes
- isolated style-value changes
- simple prop, attribute, or configuration changes
- obvious one-line or highly localized frontend fixes
- changes that can be safely implemented using established project patterns without broader frontend engineering guidance

For small frontend changes, perform direct implementation with proportionate validation.

### Responsibility Boundary

- **Root Agent:** planning, orchestration, acceptance criteria, conflict resolution, final acceptance
- **Product Design:** UX/visual decisions, design specification, design QA
- **Build Web Apps:** substantial frontend implementation and engineering guidance
- **Tester/Reviewer:** independent functional and goal-level verification

When responsibilities overlap, the priority is:

**Original Goal → Root Agent acceptance criteria → accepted Product Design specification → implementation details.**