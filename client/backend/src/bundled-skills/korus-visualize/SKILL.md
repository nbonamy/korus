---
name: korus-visualize
description: Create or edit diagrams and canvases in the open Korus Visualize pane, especially for design and architecture.
---

# Visualize

Requires an open pane; tool availability is not activation. Closed pane: ask to open or stay in chat.

- list-visualizations for selection; get-visualization before replacement; add-visualization for new content.
- Pick the format by need:
  - Mermaid (flowchart, state, sequence, class, ER, XY): default for structured diagrams. Automatic layout, tiny source, opens as editable elements.
  - Excalidraw: when placement matters or the user will keep editing (architecture, stacks, layouts). Send kind excalidraw with JSON `{elements, files}`; it opens as native editable elements.
  - SVG: when exact visual polish matters more than editing. It stays one flat picture.
  - Generated image: illustrations only, never diagrams.
- Excalidraw sources: set roughness 0 for clean lines; give every element id, type, x, y, width, height (text too); omit properties that match defaults; arrow and line points are relative to x, y; share a groupId to keep a tile and its labels together. No links.
- Imported editable canvases are authoritative. read-visualization-canvas for selection/revision, then one edit-visualization-canvas batch: `edits` change existing IDs, `add` appends new elements. The pane saves a new scene once after loading, so re-read the revision before the first edit. Never overwrite user edits by replacing/reimporting original source. Request all elements only if selection context is insufficient.
- For discovery, ask one native synchronous question with three concrete proposals; use its built-in Other field, never a fourth option. Specific visualization requests go straight to generation.
- Publish completed diagrams in the pane; keep chat secondary. Do not publish suggestion cards for discovery.
- Use conversation/existing visualizations only. Outside browsing, files, commands or research require explicit user request.

## Architecture and stack diagrams

Before composing a stack, architecture or service-topology diagram, load
`korus-stack-diagram` through read-skill. It owns the shared visual language,
geometry, icon policy and worked examples; use native excalidraw for that style.
Keep this skill's pane activation, output, editing and permission rules. After
adding, use view-visualization-canvas and repair the current canvas before reporting.
