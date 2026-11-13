---
name: korus-design
description: Explore and refine interface designs in the Design pane: several designs per conversation, artboards, flows, tweaks and what the design format allows.
---

# Design

Use this after the user asked for Design ({{mcpServerName}} `open-design` needs their request or confirmation). The Design pane is the result; keep chat brief.

## Workflow

0. The Design pane must be open, which needs the user's request (`open-design` only after they ask or confirm). Until then `read-design` and `create-design` fail with "Open Design for this conversation" or "Design pane must be open".
1. `read-design` first; it is the only tool that returns the whole document, the others answer with a compact summary (`designId`, `revision`, artboard ids and titles, and for edits the `touched` node ids), so do not read back after every edit. Ground the work in the repository's design tokens, typography, components, assets and existing screens.
2. `create-design` with authored HTML node trees. For an open-ended request propose three meaningfully different directions on separate artboards, each with a short title and `notes` on its tradeoff; vary layout and hierarchy, not only color. For one precise screen or flow, do that instead.
3. Refine with `edit-design` at the exact revision you read (a stale revision is rejected with "Stale design revision: expected N"; `read-design` again and reapply), using targeted edits. Add or duplicate an artboard to explore another direction; keep the originals and every user edit and comment. Never replace the document or regenerate unchanged nodes. `checkpoint-design` before a substantial change.
4. `capture-design` (with `artboardId`) each result and fix clipping, hierarchy, contrast and broken interactions before presenting it. When it fails with "Design capture requires the desktop host", say that visual verification is pending.

## Several designs

A conversation can hold several designs, each its own tab. Every `create-design` adds a new one; its `document.id` is the `designId` for `edit-design`, `capture-design`, `checkpoint-design` and `read-design`. With one design `designId` is optional; with several it is required, and `read-design` without it lists them (`designs`). Only the user deletes a design, by closing its tab.

## Format

- The content object is `{ title, css, comments: [], artboards, tweaks? }`: `css` must be present (an empty string is fine) and `comments` must be present and empty. Node `styles` keys are lowercase kebab-case (`font-size`) or `--custom`, not camelCase.
- HTML tags: {{designTags}}. Attributes: {{designAttributes}}. IDs are unique, immutable and start with a letter. Text goes on leaves; `img`, `input`, `br` and `hr` hold nothing. `width` and `height` on `img` take a number with optional `px` or `%`; CSS sizing works too.
- Images: `src` takes only raster data URIs (`data:image/png|jpeg|webp|gif;base64,...`). SVG images (`data:image/svg+xml`) are not accepted; draw vectors inline instead (below). `href` takes only in-document anchors such as `#node-id`.
- CSS lives in `content.css` (fallback), in each artboard's `css`, and in node `styles`. An artboard's `css` replaces `content.css` rather than extending it, so for shared styles repeat them in every artboard (build the JSON with a script). CSS rejects `url()` (so no `mask` or background images), `@import`, `expression()`, backslash escapes and `<`. No scripts, event handlers, frameworks, external assets or network requests.
- Limits: 12 artboards, 2000 nodes, depth 30, 500000 characters in total; artboards are 240 to 3840 px wide and 160 to 3840 px high.
- Edits: `insert` and `artboard-add` append when `index` is omitted. A rejected create or edit changes nothing, so you can fix and retry; every successful `create-design` adds a design.
- A rejection names the failing node path and rule (for example `artboards[0].root.children[2] (logo): tag "marquee" is not allowed`); fix that and retry.

## Icons and logos

Draw them as inline SVG so they stay sharp and take their color from CSS. Put `fill="currentColor"` on the `svg` (or on its shapes) and set `color` in CSS or `styles` on a parent, so one path serves every state (muted, selected, on a colored background). Size the `svg` with `width` and `height` attributes or CSS. An icon is a tree of nodes like any other:

```json
{ "id": "icon", "tag": "svg", "attributes": { "viewBox": "0 0 24 24", "width": "24", "height": "24", "fill": "currentColor" },
  "children": [{ "id": "icon-shape", "tag": "path", "attributes": { "d": "M12 2L22 22H2Z", "fill-rule": "evenodd" } }] }
```

To reuse an existing icon from the repository, copy the `viewBox` and each path's `d` from its `.svg` file into `svg` and `path` nodes (give every node its own unique id). Only these SVG tags are accepted: {{designSvgTags}}. Only these SVG attributes: {{designSvgAttributes}}. `fill`, `stroke` and `stop-color` take a color, `none`, `currentColor` or `url(#node-id)` for a gradient defined in the same artboard; `clip-path` and `mask` take only `url(#node-id)`; `use` takes `href="#node-id"`. Scripts, `foreignObject`, event handlers, `style` elements and external references are not accepted.

## Large designs

Instead of pasting a big `content` object into `create-design`, write the same object to a `.json` file (a script can assemble shared CSS, icons and many artboards) and pass its absolute `path`; it holds the same content, so the same 500000-character limit applies. Pass exactly one of `content` or `path`.

## Flows and tweaks

- Put each screen of a clickable flow on its own artboard and set `node.interaction` to `{type:"navigate",artboardId}` or `{type:"back"}`; local interactions use `{type:"toggle"|"show"|"hide"|"scroll",nodeId}` on the same artboard. Change or clear one with an `interaction` edit. Native controls and `toggleTargetId` also work.
- Expose a few meaningful controls in `content.tweaks` (range, color with six-digit hex, select, toggle) bound to a stable `nodeId` and CSS property, including CSS variables. Set the initial style on that node. Change them with `tweak-set`, `tweak-remove` and `tweak-value`, and keep user-chosen values in later edits.
