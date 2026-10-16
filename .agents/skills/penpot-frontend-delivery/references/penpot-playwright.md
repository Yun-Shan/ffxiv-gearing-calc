# Penpot and Playwright operating procedure

Use this reference before reading or editing the project's Penpot file. First inspect the Penpot and Playwright tools currently exposed in the environment and read their current tool documentation, including the Penpot overview. Some names below may reflect earlier integrations; verify the live names, parameters, and behavior before calling anything.

## Browser session and tool ownership

- Use Playwright to establish and control the browser session connected to Penpot. Do not open the same Penpot document in another browser controller, CUA, or the built-in browser, as that can disconnect the MCP plugin.
- Reuse the connected Penpot tab. One agent at a time may control that Playwright session; finish the current browser operation before handing control to another agent.
- A second tab in the same Playwright session may be used for the local application, under the same session controller.

## Read and write Penpot content

- Prefer Penpot MCP for reading or changing pages, artboards, layers, components, variants, and styles whenever the current MCP supports the operation. Do not repeat an MCP-supported write through Playwright.
- Before a Penpot write, verify the current API documentation for the method and parameters. After writing, read back the affected structure/properties and export or render the target artboard to confirm the saved result.
- For a cross-page write, use the currently documented page activation API and confirm the active page before changing anything.
- Use Playwright for browser connection/state, rendered behavior, screenshots, and a necessary Penpot UI action that MCP does not support. Before using Playwright to write Penpot content, verify that MCP cannot perform that action; then read the result back through MCP where possible.

## Inspecting the design

- Locate the page and target artboard first. Query only the target artboard or a relevant subtree; avoid exporting an unbounded whole-file object graph.
- Retain the structured source properties needed to implement and review the target: hierarchy and child order, text, geometry, visibility, layout, fills/strokes, typography, tokens, components/variants, and relevant states. Keep the response associated with its page, artboard, and layer path. Mark any truncated traversal as incomplete. When traversing objects, use a WeakSet for reference cycles, layer IDs for repeated output, and explicit depth/node limits; preserve legitimate component references and child order. Start with a small connectivity query and split slow queries rather than expanding them.
- Use structured Penpot properties for machine-readable facts. A screenshot is useful for rendered appearance, but does not replace the structure.

## Optional Tailwind HTML helper

When generated markup is useful, use `../scripts/penpot-tailwind-html-once.template.js` against one specific component or artboard subtree. Fill `targetPage` and `targetLayerPath` using current Penpot MCP results, then run it with the currently documented Playwright capability that executes code in the connected page. The helper's comments mention a historical tool identifier; verify today's tool name and interface before use. It reads generated HTML directly from the plugin and does not click its copy button.

Treat the resulting HTML as implementation input only. Simplify it to match existing project conventions and the approved Penpot structure; do not let generated classes or markup override design facts.

## Render comparison

Use the actual artboard viewport and state. Prefer a Penpot export as the reference; when an editor screenshot is necessary, exclude editor chrome and verify the full artboard and scale. Compare it with the actual running application's screenshot. For substantial changes, also compare material DOM geometry and computed styles with Penpot's structured values. Do not claim a precise match for a viewport or state that Penpot does not define.
