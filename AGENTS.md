# AGENTS.md

This file is the high-level guide for the whole repository. Each area has its own
`AGENTS.md` with the rules that only apply there; the nearest one applies in
addition to this file. Read the area file before changing code in that area.

## Overview

This repository is **Korus**, an Electron desktop app for coordinating
teams of coding agents with native conversation and artifact rendering, plus the
mobile companion, a hosted telemetry collector and the public website.

Stack: TypeScript across main, preload, renderer, shared contracts and tests; Vue 3
and Element Plus for UI; Electron and Electron Forge for the desktop app; Vitest for
unit, component, contract and workflow tests.

Core product surfaces:

- **Teams**: top-level grouping for agents.
- **Agents**: named teammates with avatars, folders, backend sessions, and
  status.
- **Conversation**: native chat rendering for backend messages, tool calls,
  approvals, plans, command output, file changes, and diffs.
- **Artifacts**: document, plan, diff, git, and file panes beside the active
  conversation.

## Repository Map

| Area | What it owns | Guide |
| --- | --- | --- |
| `core/` | Platform-neutral product contracts, the backend protocol and state primitives shared by every other area. | [core/AGENTS.md](core/AGENTS.md) |
| `client/` | The desktop product: `backend` (the local daemon), `electron` (main, preload, packaging) and `vue` (shared Vue UI). | [client/AGENTS.md](client/AGENTS.md) |
| `mobile/` | The iOS and Android companion apps and their shared engine. | [mobile/AGENTS.md](mobile/AGENTS.md) |
| `native/` | Native helper binaries shipped with the desktop app. | [native/AGENTS.md](native/AGENTS.md) |
| `server/` | The hosted telemetry collector and the private admin console. | [server/AGENTS.md](server/AGENTS.md) |
| `website/` | The public landing page, privacy policy and VitePress user guide. | [website/AGENTS.md](website/AGENTS.md) |
| `videos/` | Scripted product films. | [videos/AGENTS.md](videos/AGENTS.md) |
| `docs/` | Internal engineering notes (current-state reference). | see the Documentation Map |
| `scripts/` | Repository tooling, including the architecture lint. | |
| `plans/` | Saved implementation plans. | see Plans |

`core/`, `client/*`, `mobile/` and `server/*` are npm workspaces; `native/` and
`website/` are not. Root `npm run dev` launches the Electron app.

## Architecture At A Glance

`core/src/product.json` owns product branding and external identity. Keep
implementation identifiers, package names, filenames, and CSS brand-neutral;
read product metadata for visible names, instructions, paths, and packaging.
Authored documentation may use the product name.

The areas are isolated from each other on purpose, and `npm run lint:architecture`
enforces it. Shared inputs flow through `core`; nothing imports across runtime
boundaries, for example the mobile app and the hosted collector never import
the desktop daemon, and the renderer never imports backend protocol types.

On the desktop, Electron main is the adapter, `daemon` (`client/backend`) owns
backends, providers, persistence and filesystem access, and the renderer owns
visual state. The ownership rules and the Codex and Claude provider boundaries
are in [client/AGENTS.md](client/AGENTS.md) and [docs/architecture.md](docs/architecture.md).

## Mobile API Compatibility

Every endpoint and wire contract consumed by the mobile application must remain
strictly backwards compatible with shipped mobile clients. This includes shared
desktop/mobile endpoints, streamed events, serialized provider data and changes
introduced through SDK upgrades. Desktop-only endpoints have no such requirement.
Do not require a mobile update to keep existing operations working. Preserve old
requests and response semantics; introduce incompatible new behavior only through
explicit opt-in negotiation or a separate version that retains the old contract.
Changes affecting mobile must include released-client regression evidence through
the owning runtime boundary before handoff, commit or push. Shared current types
and tests of only the newest client are insufficient. See
[protocol.md](docs/protocol.md#mobile-compatibility) and
[testing.md](docs/testing.md#mobile-compatibility-evidence).

## Documentation Map

Keep every `AGENTS.md` high-level. Before changing a feature area, read the
relevant doc. Docs are reference for the current state: ownership, invariants,
gotchas and the reasons behind them. They do not restate what code, types,
scripts or config already say (method catalogs, type listings, command tables,
tool schemas), do not walk through UI behavior (specify that in tests), and carry
no dates, "now/no longer/previously" narrative, or decision history (that is git
history). Fix a stale doc in place rather than appending a correction. Update
docs only when an architecture, process, or reusable convention changes.

Cross-cutting docs:

- `docs/architecture.md`: process model and ownership rules, conversation
  ownership, backend seam, persistence, remote teams, worktrees, durable tasks,
  Missions, code review, work providers.
- `docs/protocol.md`: app-owned JSON-RPC conventions, synchronization, and
  lifecycles; the method catalog itself is in `core/src/backend-protocol/`.
- `docs/testing.md`: testing principles, Test Value Gate, fixtures, coverage and
  gates. Read before editing code.

Each area file lists the other docs that belong to it. When a new doc is needed,
discuss it with Nicolas first. If approved, add it under `docs/` and link it from
the area that owns it.

## Quality

Quality is not optional in this repo. Every behavior change needs coverage at
the owning runtime boundary; write the behavior test before the production
change. For docs-only or impossible-to-test changes, say so explicitly in the
handoff.

- Never write unit tests after you write code.
- Highly prefer E2E or integration tests as the sole testing mechanism. Use them
  to verify complex features work. At the end of those tests, produce a
  verifiable and repeatable artifact.
- If you must test a system in isolation, first write down all the ways it could
  fail, then write the code.
- A test that breaks under a behavior-preserving refactor is asserting
  implementation, not behavior. Do not add it.
- Never delete or weaken a failing test to make the suite pass. Fix the code, or
  ask.

Before adding or retaining a test, apply the mandatory **Test Value Gate** in
`docs/testing.md`. Default to extending an existing owner-boundary workflow,
not adding a new test for each change or helper. A test must protect observable
behavior, an owned contract, a meaningful state transition, or a realistic
error/security/architecture boundary. Prefer E2E and integration tests. Isolate
a system only when a concrete regression cannot be reliably observed at those
boundaries, and write down its failure modes before implementation. When UI
isolation is necessary, mount and exercise the component through its rendered
behavior.
Tests must never read production source files as text to assert their contents;
this includes TypeScript, Vue, stylesheets, scripts, package manifests, and
configuration. Enforce static architecture rules with lint, type, AST, or
dependency tooling instead. Coverage is evidence of exercised behavior, never
a reason to invent a test.

Every workspace, including server/backend and server/frontend, gates on exactly 85%
statement coverage. Lines, branches, and functions remain reported diagnostics
without blocking thresholds. Do not lower the statement threshold or shrink
the measured surface to land a change. Coverage does not replace meaningful
behavioral/regression tests or verification at the owning runtime boundary.
Quality CI enforces coverage on every branch push. Release CI independently
requires the full test suite without coverage; it does not wait for Quality CI.

Before editing code, read `docs/testing.md`. The quality gate is `npm run lint`
plus `npm test`. When scripts exist, run the relevant focused tests while
iterating and the relevant build/test gate before handoff.

## Build

Use the Node 26 reference toolchain for development, tests, and builds. Read
`.nvmrc` for the exact Node version and `package.json` for the npm version.
Keep build outputs, generated bindings, and packaged resources clearly separated
from source code. Packaging and signing are described in
[client/AGENTS.md](client/AGENTS.md).

## Project Skills

Repo-local Codex skills live in `.agents/skills/`. When a task clearly matches
one of those areas, read the relevant `.agents/skills/<name>/SKILL.md` before
editing.

Use `korus-dod` before handing off, committing, pushing, or calling this
application's work done.

Never update `CHANGELOG.md` during ordinary implementation, review, handoff,
commit, or push work. Curate it only when Nicolas explicitly invokes
`update-changelog` or `prepare-release`.

- `korus-dod`: Definition of Done checklist for scope, architecture,
  tests, coverage, security, UX, docs, worktree hygiene, and handoff.
- `korus-desktop-update`: Build and activate a signed macOS desktop update,
  restart the installed app and its owned daemon, or inspect the guarded update.
- `korus-frontend-dev`: Vue, Element Plus, app shell, chat rendering,
  artifact panes, design tokens, themes, and frontend tests.
- `korus-live-preview`: isolated, parallel-safe, branch-faithful Electron
  previews with seeded state for interactively dogfooding any Korus feature.
- `korus-testing-coverage`: Vitest, component isolation, IPC contracts,
  fake Codex transports, coverage triage, and verification gates.
- `update-changelog`: release-time audit of Korus and SDK histories, curated
  Unreleased notes, and an evidence-backed semantic-version recommendation.
- `prepare-release`: invokes `update-changelog`, confirms the recommended
  version and channel, validates the release commit, and hands off one command
  that creates the tag, builds, and publishes.

## Plans

Plans are used for large implementations and are developed collaboratively.

- Only create a plan when Nicolas asks for one or when plan mode is active.
- Before saving a plan to disk, review it with Nicolas.
- Save plans under `plans/` in this repo, never under `~/.Codex/plans`.
- Use `feature-name.md` naming.
- Include implementation strategy, test strategy, and fine-grained commit
  checkpoints.
- Update the plan at the end of each phase.
- At the end of plan execution, append key learnings focused on ways of working
  and design patterns.

## Commits

Use single-line lowercase commit messages.

Valid prefixes:

- `feat:`
- `fix:`
- `test:`
- `chore:`

Use `chore:` for documentation-only commits unless Nicolas asks for a separate
`doc:` prefix.

## Dirty Worktree Hygiene

Before handoff or commit:

- Run `git status --short`.
- Review the diff.
- Stage only files relevant to the task.
- Do not revert unrelated user changes.
- Run `git diff --check`.
- Run the relevant tests or explain exactly why they were not run.

Never use destructive git commands unless Nicolas explicitly asks for them.
