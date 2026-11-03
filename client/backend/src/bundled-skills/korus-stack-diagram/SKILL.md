---
name: korus-stack-diagram
description: Compose stack and system architecture diagrams with icon tiles, subsystem groups, clear connections and deliberate native canvas geometry. Shared by Visualize and Polished Diff Viz.
---

# Stack diagrams

Use this visual grammar for system architecture, infrastructure, stacks and service
relationships. The caller supplies the facts, output schema and allowed tools.
Keep those contracts: this skill does not grant browsing, filesystem access, script
execution or a different output format. The examples illustrate composition, not
facts to insert into the user's system.

## Content and hierarchy

- Identify the actors, interfaces, services, stores and external systems that
  explain the requested architecture. Name responsibilities, not implementation
  activities or file paths. Use concrete names of one to four words.
- Give the diagram a specific short title. Put explanations in the caller's review
  annotations or surrounding document, not paragraphs inside diagram nodes.
- A node has an icon tile and a name below it, at most two short lines. Add a short
  lowercase role below the name only when useful and supported by the caller.
- Groups mean shared runtime, subsystem, vendor or repository ownership. Name the
  boundary. Nest one level when it reveals a real distinction; omit decorative
  frames and bands of incidental helpers or tests.
- Place the principal flow left to right where practical. Put independent stores,
  workers and alternate implementations on additional rows or columns. Show real
  branches and shared dependencies; do not invent a journey or force a long chain.
- Keep the composition balanced: use rows and columns to make labels readable at
  fit-to-view scale. A small group can sit beside a larger group. Do not stretch
  groups to fill every empty region or squeeze a wide chain into a narrow pane.

## Visual language

Use clean rounded square tiles with prominent centered icons and short captions
outside them. Avoid wide cards containing tiny icons and body copy. Use a quiet
canvas, subtly filled group boundaries, generous corridors and consistent type.
Do not draw a legend or header inside the canvas when the caller provides one.

- Tiles: light neutral plates, thin borders, restrained corner radius; no heavy
  shadows or decorative gradients. Keep supplied logos on a suitable contrasting
  plate, including in dark mode.
- Type: readable sans-serif names and group headings. Short technical roles and
  connection labels may use monospace when supported. Do not shrink text to force
  an overfull composition to fit; shorten labels or rearrange the diagram.
- Connections: one accent for the principal request/data path; neutral solid for
  secondary internal links; neutral dashed for dev/deploy/supporting relationships.
  Use these distinctions only through the styling controls the caller exposes.
  Diff change state colors remain separate from connection meaning.
- Groups: a soft neutral or restrained vendor tint, a fine solid border and a
  top-left title. Nested boundaries may use a dashed border when distinguishable
  from connection semantics. Keep titles out of node and routing corridors.
- The host owns theme colors when specified. Do not emit CSS variables into a
  native canvas or invent schema fields to force a palette. Check contrast in both
  themes when rendering tools are available.

## Icons

- Use an official mark for an explicitly named technology when a supplied or
  authorized asset is available. Do not redraw, recolor or approximate brand logos.
  A vendor's sub-products can reuse its mark with distinct node names.
- Use consistent line pictograms for abstract concepts: user, browser, service,
  database, queue, repository, security, synchronization. No emoji, letter tiles or
  text pretending to be an icon. Prefer available app-owned role icons.
- An icon occupies roughly half the tile's width. Center it optically; a wide logo
  can be wider while keeping clear padding. Preserve aspect ratio.
- If icon retrieval is available and authorized, prefer exact technology matches
  from svgl, then devicon, then gilbarbara/logos or the official repository. Use
  official AWS Architecture Icons for AWS services. Reject a fuzzy near-match;
  use a generic role pictogram when the correct asset is unavailable.
- Preserve source attribution and available light/dark variants. A white mark
  needs a dark plate; a black mark needs a light plate. Never fix contrast by
  changing the brand's colors. Do not redistribute icon packs as part of a diagram.
- No icon-fetching tool is implied by this skill. In Diff Viz, use only the
  caller's component.icon enum: the app supplies the image. Never return an image
  URL or run fetch_icons.py through the read-only workspace tools. In Visualize,
  use supplied assets or supported native pictograms; fetch only with authorization
  and an available capability. Do not claim an icon was fetched when it was not.

## Geometry

Treat a node as its tile PLUS the captions below it. These dimensions match the
Polished Diff Viz renderer and also provide a native Visualize layout scale. Use
18px names, about 20px group titles and, when supported, 13px roles/edge labels:

| Item | Geometry |
| --- | --- |
| Tile | 80 × 80; its position is `(cx − 40, top)` |
| Icon | About 42 × 42, centered inside the tile |
| Name | Centered in a 168px-wide caption box, beginning at `top + 92` |
| Full node footprint | `cx ± 84`, from `top` to `top + 144` |
| Same-row centers | At least 220px apart; increase for long captions or edge labels |
| Consecutive tile rows | At least 220px between tile tops |
| Group sides | At least 108px outside the outermost tile centers, symmetrically |
| Group top/bottom | Top = first tile top − 60; bottom ≥ last tile top + 168 |
| Group title | About 16px inset from top and left, clear of nodes and arrows |
| Nested group | At least 28px side/bottom inset; 52px below the parent top |

The 144px footprint fits a two-line name OR a one-line name with a role. For a
two-line name plus a role, expand its footprint to at least 168px, start downward
connections below `top + 176`, and extend its group bottom 24px beyond the actual
footprint. Use extra room for longer labels, not smaller type. When a caller explicitly uses
another scale, scale ALL tile, caption, padding and routing dimensions together.
In native Excalidraw, group a tile, icon and captions for editing. A subsystem
boundary is a separate background shape, not a substitute for that editing group.

### Connection anchoring

- Horizontal, same row: run tile-side to tile-side at `y = top + 40`.
  Start at `source.cx + 48`, end at `target.cx − 48` (reverse for leftward flow).
- Downward vertical: start BELOW the whole upper node at `upper.top + 152`;
  end at `lower.top − 8`. Never connect tile bottom to tile top through a caption.
  For upward flow, reverse those endpoints.
- Different row and column: put vertical segments in corridors outside every
  node's full footprint. Put horizontal elbows in the empty band above the next
  row, clear of group titles. Crossing an edge is acceptable; crossing a node or
  caption is not.
- Leave at least 8px at tile/caption boundaries. Put horizontal edge labels above
  the line; put vertical labels beside it, with about 12px clearance. Use one or
  two useful words, not sentences. Reserve their bounding boxes as obstacles too.
- Arrow/line points are relative to the element's x/y. Keep orthogonal segments
  orthogonal. Native bindings must preserve the planned clearance: leave an
  endpoint unbound if the caller cannot express a gap below the caption.
- Use an arrowhead in the data/dependency direction. Add a second arrowhead only
  for a meaningful two-way relationship. Do not make every call bidirectional.
- Labels should have quiet backing/halos when the format supports them. These
  improve legibility; they do not justify routing through text.

## Worked examples

### A request path with storage below

Use a client outside an application boundary, with the interface and API inside.
Storage is a separate dependency below the API. These are example identities:

| Node | Center x | Tile top | Footprint |
| --- | --- | --- | --- |
| Client | 120 | 100 | x 36–204, y 100–244 |
| Web interface | 400 | 100 | x 316–484, y 100–244 |
| API | 640 | 100 | x 556–724, y 100–244 |
| Database | 640 | 360 | x 556–724, y 360–504 |

Application group: x 292, y 40, width 456, height 228. It wraps the interface and
API, including their captions. A separate storage group, if meaningful, is x 532,
y 300, width 216, height 228. The client stays outside both groups.

- Client → interface: `(168,140)` to `(352,140)`; label centered above the line.
- Interface → API: `(448,140)` to `(592,140)`.
- API → database: `(640,252)` to `(640,352)`; label beside x 652. Starting at y 180
  would cross the API's caption; y 252 clears its full footprint.

Native Visualize connection fragment (adapt IDs to the requested system). Diff Viz
adds end arrowheads itself: omit `endArrowhead` when its schema does not expose it:

```json
{"id":"store_query","type":"arrow","x":640,"y":252,"width":0,"height":100,"points":[[0,0],[0,100]],"endArrowhead":"arrow"}
```

For a Visualize native scene, the API tile can be a rectangle at `(600,100)` with
size `80×80`, an icon centered at `(640,140)` and unbound text centered in
`(556,192,168,45)`. Use a common groupId to move that node together. For Diff Viz,
put the label and component metadata on the `(600,100,80,80)` semantic shape;
the app creates the icon/caption. Do not duplicate those as native text or images.

### A shared service branching to alternate providers

Keep the service at `(cx 640, top 100)`. Put Provider A at `(cx 920, top 100)` and
Provider B at `(cx 920, top 360)` inside one provider boundary: x 812, y 40,
width 216, height 488. This reveals alternatives without flattening their identity.

- First branch: `(688,140)` to `(872,140)`.
- Lower branch: `(688,140)` → `(780,140)` → `(780,400)` → `(872,400)`.
- The x 780 corridor lies outside both the service's footprint (ends at x 724)
  and the provider footprints (start at x 836). Put labels on clear segments.
- A background worker, queue or cache belongs on another branch only when the
  supplied facts establish that dependency. Do not add it to mimic this example.

## Output and inspection

Keep native shapes, icons, labels and connections separate when the caller allows
editing. Background groups go first, connections next, nodes/captions last. Use
roughness 0, stable unique IDs and explicit finite bounds. Preserve the caller's
output envelope, component identity, change status and navigation metadata.

When a canvas view/render tool is available, render and inspect before reporting:
check each edge against full node footprints and labels; check icons, text and
contrast; check equal group padding, nesting, clipping and fit-to-view readability.
Repair the current canvas through its edit/revision mechanism rather than
replacing user edits. Recheck the result after the repair.

For a utility without a rendering tool, check the planned bounds and every segment
before returning its structured scene. Do not claim a screenshot was inspected or
invent access to a canvas tool. The attached reference, when supplied, is visual
guidance; its technology names and topology are not facts about the requested system.

## Upstream attribution

Self-contained adaptation of caru-ini/stack-diagram's SKILL.md, geometry.md and
icon-selection guidance: https://github.com/caru-ini/stack-diagram . Its TSX export
instructions are not needed for native canvases; its Python icon-fetching and
HTML/PNG build scripts are separate capabilities, not included by these instructions.

MIT License — Copyright (c) 2026 caru-ini

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in the
Software without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
