---
name: korus-frontend-dev
description: Use when working on Korus frontend development, including Vue components, Element Plus controls, app shell, agent/team/Bench UI, chat rendering, artifact panes, design tokens, themes, or frontend component tests.
---

# Korus Frontend Development

Use this skill for renderer work: Vue components, Element Plus controls, chat
rendering, app shell, agent/team/Bench surfaces, artifact panes, themes, and
frontend tests.

## First Read

Read `docs/frontend.md` before editing UI. Read `docs/testing.md` before adding
or updating component tests.

## Principles

- Split UI into small named components with one clear job.
- Keep views thin. Views coordinate state and compose components.
- Keep raw Codex payloads out of renderer components; render app-owned state.
- Use typed props and emits for every component.
- Use Element Plus for standard controls when practical.
- Use semantic CSS variables for product colors and repeated design-system
  spacing, radii, shadows, typography, and diff values. Keep genuinely
  component-specific geometry local.
- Use `docs/codex.png` for the shell direction.
- Keep operational UI dense, quiet, and scannable.
- Avoid nested cards and decorative layouts.
- Prevent layout jumps during streaming, loading, approvals, and artifact pane
  changes.

## Reuse Audit

Before creating or styling a picker, menu, dialog, list, popover, settings
layout, button pattern, operation state, or icon control:

1. Read `docs/frontend.md` through **Canonical UI primitives**.
2. Search `client/vue/src/shared/` and `client/vue/src/components/` for the interaction and
   product concept, including existing wrappers and tests.
3. Reuse or extend the canonical primitive. A product wrapper may configure
   copy, slots, placement, and domain events; it must delegate the shared
   interaction and visual behavior.
4. If no primitive fits, put a genuinely reusable primitive under
   `client/vue/src/shared/`, add it to the inventory, and cover its public behavior in
   an isolated test. Keep one-off product composition in `client/vue/src/components/`.

The audit is complete when the implementation imports the matching primitive,
or the handoff identifies the concrete contract mismatch that required a new
one. Do not infer non-reuse from a component's historical product-specific
name; inspect its contract first.

## Tests And Verification

- Add or update colocated component tests when a component contract changes.
- Test components in isolation when behavior is local.
- Assert rendered output, emitted events, disabled states, selected state, and
  visible status changes.
- For shared rendering behavior, run the broad relevant test gate once scripts
  exist.
- For visual changes, run the app and check screenshots when tooling exists.
