# AGENTS.md

High-level guide for the whole repository. Each area has its own `AGENTS.md` with
the rules that apply only there; the nearest one applies in addition to this file.
Read the area file before changing code in that area.

## Overview

**Korus** is an Electron desktop app for coordinating teams of coding agents with
native conversation and artifact rendering, plus a mobile companion, a hosted
telemetry collector and the public website. Stack: TypeScript throughout, Vue 3 and
Element Plus for UI, Electron Forge for packaging, Vitest for tests.

Core product surfaces: **Teams** (top-level grouping), **Agents** (named teammates
with folders, backend sessions and status), **Conversation** (native chat, tool
calls, approvals, plans, diffs) and **Artifacts** (document, plan, diff, git and file
panes beside the conversation).

## Repository Map

| Area | What it owns | Guide |
| --- | --- | --- |
| `core/` | Platform-neutral product contracts, backend protocol, state primitives. | [core](core/AGENTS.md) |
| `client/` | Desktop: `backend` (local daemon), `electron` (main, preload, packaging), `vue` (shared UI); `cli` (standalone terminal recovery and control). | [client](client/AGENTS.md) |
| `mobile/` | iOS and Android companion apps and their shared engine. | [mobile](mobile/AGENTS.md) |
| `native/` | Native helper binaries shipped with the desktop app. | [native](native/AGENTS.md) |
| `server/` | Hosted telemetry collector and private admin console. | [server](server/AGENTS.md) |
| `website/` | Landing page, privacy policy, VitePress user guide. | [website](website/AGENTS.md) |
| `videos/` | Scripted product films. | [videos](videos/AGENTS.md) |
| `docs/`, `scripts/`, `plans/` | Engineering notes, repo tooling (incl. the architecture lint), saved plans. | |

`core/`, `client/*`, `mobile/` and `server/*` are npm workspaces. `npm run dev`
launches the Electron app.

## Architecture At A Glance

`core/src/product.json` owns product branding and external identity. Keep
identifiers, package names, filenames and CSS brand-neutral; read product metadata
for visible names, paths and packaging. Authored documentation may use the name.

Areas are isolated on purpose and `npm run lint:architecture` enforces it: shared
inputs flow through `core`, and nothing imports across runtime boundaries (mobile
and the collector never import the daemon; the renderer never imports backend
protocol types). On the desktop, Electron main is the adapter, `daemon`
(`client/backend`) owns backends, providers, persistence and filesystem access, and
the renderer owns visual state. See [client/AGENTS.md](client/AGENTS.md) and
[docs/architecture.md](docs/architecture.md).

## Mobile API Compatibility

Every endpoint and wire contract the mobile app consumes must stay strictly
backwards compatible with shipped mobile clients: shared desktop/mobile endpoints,
streamed events, serialized provider data and SDK upgrades alike. Desktop-only
endpoints have no such requirement. Never require a mobile update to keep existing
operations working; keep old request and response semantics, and introduce
incompatible behavior only through explicit opt-in negotiation or a separate version.
Changes affecting mobile need released-client regression evidence at the owning
runtime boundary before handoff, commit or push; tests of only the newest client are
not enough. See [protocol.md](docs/protocol.md#mobile-compatibility) and
[testing.md](docs/testing.md#mobile-compatibility-evidence).

## Documentation

`AGENTS.md` files stay high-level. Docs under `docs/` are reference for the current
state: ownership, invariants, gotchas and their reasons. They do not restate what
code, types, scripts or config say, do not walk through UI behavior (specify that in
tests), and carry no dates, "now/no longer/previously" narrative or decision history
(that is git history). Fix a stale doc in place. Update docs only when an
architecture, process or reusable convention changes.

- `docs/architecture.md`: process model, ownership rules, persistence, remote teams,
  worktrees, Missions, code review, work providers.
- `docs/protocol.md`: JSON-RPC conventions, synchronization, lifecycles.
- `docs/testing.md`: testing principles, Test Value Gate, fixtures, coverage, gates.

Each area file lists the docs that belong to it. Discuss a new doc with Nicolas
first; if approved, add it under `docs/` and link it from the owning area.

## Quality

Every behavior change needs coverage at the owning runtime boundary, and the
behavior test is written before the production change. For docs-only or untestable
changes, say so in the handoff. Prefer E2E and integration tests, apply the Test
Value Gate, never delete or weaken a failing test to pass the suite, and never read
source files as text in a test. Every workspace gates on exactly 85% statement
coverage; do not lower it or shrink the measured surface. All of this, with the CI
behavior, is in [docs/testing.md](docs/testing.md); read it before editing code.

The gate is `npm run lint` plus `npm test`. Run focused tests while iterating and
the relevant gate before handoff.

Fixed real-time sleeps are forbidden in all Vue tests and browser test helpers
(desktop, console, mobile web and website). Use observable conditions or
controlled clocks, as described in [testing.md](docs/testing.md).

## Build

Use the Node 26 reference toolchain (`.nvmrc`, `package.json`). Keep build outputs,
generated bindings and packaged resources separate from source. Packaging and
signing are in [client/AGENTS.md](client/AGENTS.md).

**SDK.** Dev builds run the `~/src/codex-app-sdk` source (`CODEX_APP_SDK_SOURCE=1`), so
SDK changes are live: never cite publishing or the pinned version outside release prep.

## Project Skills

Repo-local skills live in `.agents/skills/`; read the matching `SKILL.md` before
editing. Use `korus-dod` before handing off, committing, pushing or calling work
done. Others: `korus-frontend-dev` (Vue, app shell, design tokens),
`korus-testing-coverage` (Vitest, fakes, coverage), `korus-live-preview` (isolated
Electron previews), `korus-desktop-update` (signed desktop update and restart),
`update-changelog` and `prepare-release` (release notes and tagging).

Never update `CHANGELOG.md` during ordinary implementation, review, handoff, commit
or push; curate it only when Nicolas invokes `update-changelog` or `prepare-release`.

## Working Agreements

- **Plans** only when Nicolas asks or plan mode is active. Review a plan with him
  before saving it under `plans/` (never `~/.Codex/plans`) as `feature-name.md`, with
  implementation strategy, test strategy and commit checkpoints. Update it each phase
  and append learnings at the end.
- **Commits** are single-line, lowercase, prefixed `feat:`, `fix:`, `test:` or
  `chore:` (`chore:` also for docs-only).
- **Before handoff or commit**: `git status --short`, review the diff, stage only
  files relevant to the task, `git diff --check`, run the relevant tests or say why
  not. Do not revert unrelated changes, and never use destructive git commands
  unless Nicolas explicitly asks.
