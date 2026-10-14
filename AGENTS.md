# AGENTS.md

## Overview

This repository is **Korus**, an Electron desktop app for coordinating
teams of coding agents with native conversation and artifact rendering.

- Electron + Electron Forge desktop app.
- TypeScript across main, preload, renderer, shared contracts, and tests.
- Vue 3 with TypeScript and Element Plus for the renderer.
- Vitest for unit, component, contract, and desktop workflow tests.
- Codex and Claude Code are supported through provider drivers in `daemon`.
  Electron and the renderer use app-owned contracts rather than talking
  directly to either provider runtime.

Core product surfaces:

- **Teams**: top-level grouping for agents.
- **Agents**: named teammates with avatars, folders, backend sessions, and
  status.
- **Conversation**: native chat rendering for backend messages, tool calls,
  approvals, plans, command output, file changes, and diffs.
- **Artifacts**: document, plan, diff, git, and file panes beside the active
  conversation.

## Architecture

`core/src/product.json` owns product branding and external identity. Keep
implementation identifiers, package names, filenames, and CSS brand-neutral;
read product metadata for visible names, instructions, paths, and packaging.
Authored documentation may use the product name.

Preserve the product and process boundaries:

- Electron main is the desktop adapter. It owns windows, preload IPC, native
  dialogs, app lifecycle, packaged resource resolution, and the stdio client
  used to reach `daemon`.
- `daemon` owns backend process lifecycle beyond the Electron-to-backend stdio
  process, backend drivers, provider protocols, approvals, server requests,
  app persistence, backend-owned filesystem access, git, automations, and agent
  runtime state.
- Renderer owns visual state and interactions. It must not talk directly to
  Codex app-server or any future backend process, spawn tools, read arbitrary
  local files, or depend on backend protocol types.
- Preload exposes a small typed IPC bridge. Keep it boring and explicit.
- Coordination events become app-owned before reaching renderer state.
  Provider conversation traffic keeps its provider-native snapshot/event inside
  an app-owned routing envelope.
- Provider conversations stay provider-owned end to end. For Codex,
  `codex-app-sdk` owns the conversation snapshot/reducer, optimistic messages,
  history, turn mutations, queues, and generic conversation UI. Korus stores the
  thread reference, transports SDK snapshots/events, invokes SDK operations,
  and adds Korus-specific coordination metadata. When generic Codex conversation
  behavior is missing or wrong, fix it in the SDK and consume that fix here.
- Codex-specific product policy belongs in the Codex driver/adapter; generic
  Codex conversation behavior belongs in `codex-app-sdk`, not in Korus
  renderer state or wrappers.
- Backend-dependent Korus product features must enter through app-owned
  contracts and the backend protocol first. Add or extend an optional driver
  method or capability behind `daemon`, route Electron through
  `BackendClient`, and keep renderer components free of Codex/Claude
  protocol branches.
- `RendererMessage` remains an app-owned DTO where Korus explicitly needs one,
  including the normalized Claude host and cross-provider historical reads. It
  is not a live Codex transcript model.
- Future provider support should arrive through provider hosts behind `daemon`,
  app-owned capability seams, and provider-owned conversation replicas—not a
  new global Korus transcript reducer.
- Theme support must use semantic tokens and CSS variables. Do not hard-code
  product colors inside components.

## Documentation Map

Keep `AGENTS.md` high-level. Before changing a feature area, read the relevant
doc. Docs are reference for the current state: ownership, invariants, gotchas
and the reasons behind them. They do not restate what code, types, scripts or
config already say (method catalogs, type listings, command tables, tool
schemas), do not walk through UI behavior (specify that in tests), and carry no
dates, "now/no longer/previously" narrative, or decision history (that is git
history). Fix a stale doc in place rather than appending a correction. Update
docs only when an architecture, process, or reusable convention changes.

- `docs/architecture.md`: process model and ownership rules, conversation
  ownership, backend seam, persistence, remote teams, worktrees, durable tasks,
  Missions, code review, work providers.
- `docs/backend-architecture.md`: `daemon` design rules, transports, runtime
  packaging, GitHub desktop releases, auto-update, security.
- `docs/protocol.md`: app-owned JSON-RPC conventions, synchronization, and
  lifecycles; the method catalog itself is in `core/src/backend-protocol/`.
- `docs/codex.md`: read before changing Codex conversation state, rendering,
  actions, history, or transport; SDK/Korus ownership boundary.
- `docs/claude.md`: Claude Agent SDK integration, homes, history, capabilities.
- `docs/research/claude-capabilities.md`: read before adding Claude steering,
  forks, goals, turn mutations, or context controls; dated runtime evidence.
- `docs/mcp.md`: the app-owned MCP server model: identity, enablement,
  collaboration, contextual tool families, Computer Use, hosted gateway.
- `docs/custom-tools.md`: use when adding or presenting an MCP tool.
- `docs/frontend.md`: renderer ownership, canonical UI, interaction and styling
  conventions, Visualize canvases. Read before editing UI.
- `docs/testing.md`: testing principles, Test Value Gate, fixtures, coverage and
  gates. Read before editing code.
- `docs/agent-provider-selection.md`: how Codex or Claude is chosen for new work.
- `docs/agent-isolation.md`: unimplemented design note on shared-checkout
  warnings.
- `docs/research/provider-handoff.md`: read when designing cross-provider
  continuation; dated evidence.
- `docs/research/synara.md`: competitive analysis; dated source evidence, not a
  roadmap.
- `docs/codex.png`: visual reference for the target shell.
- `website/README.md`: read before changing the public VitePress guide in
  `website/docs/` or the website build and deployment. Public user guides are
  separate from the internal engineering notes in `docs/`.

When a new doc is needed, discuss it with Nicolas first. If approved, add it
under `docs/` and link it here.

## Quality

Quality is not optional in this repo. Every code change must add or update
tests unless it is truly docs-only or impossible to test; in that case, say so
explicitly in the handoff.

Before adding or retaining a test, apply the mandatory **Test Value Gate** in
`docs/testing.md`. A test must protect observable behavior, an owned contract,
a meaningful state transition, or a realistic error/security/architecture
boundary. Mount and exercise UI components through their rendered behavior.
Tests must never read production source files as text to assert their contents;
this includes TypeScript, Vue, stylesheets, scripts, package manifests, and
configuration. Enforce static architecture rules with lint, type, AST, or
dependency tooling instead. Coverage is evidence of exercised behavior, never
a reason to invent a test.

Every workspace (core, backend, vue, electron, web) gates on exactly 85%
statement coverage. Lines, branches, and functions remain reported diagnostics
without blocking thresholds. Do not lower the statement threshold or shrink
the measured surface to land a change. Coverage does not replace meaningful
behavioral/regression tests or verification at the owning runtime boundary.
Quality CI enforces coverage on every push. Release CI independently requires the
full test suite without coverage; it does not wait for Quality CI.

Before editing code, read `docs/testing.md`. Before editing UI, also read
`docs/frontend.md`.

## Build

The app builds through Electron Forge. Keep build outputs, generated protocol
bindings, copied id8 renderer code, and packaged resources clearly separated
from source code.

Electron packaging signs and notarizes macOS builds by default. This can take a
long time and should be reserved for explicit release/signing work. For normal
agent verification that needs Forge packaging, set
`APP_SKIP_SIGNING=1` so Forge skips macOS app signing, notarization, and
bundled helper signing:

```bash
APP_SKIP_SIGNING=1 npm run package
APP_SKIP_SIGNING=1 npm run build
```

When scripts exist, run the relevant focused tests while iterating and the
relevant build/test gate before handoff. Do not invent server/API integration
gates for this project; Korus is a desktop app.

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
- `korus-frontend-dev`: Vue, Element Plus, app shell, chat rendering,
  artifact panes, design tokens, themes, and frontend tests.
- `korus-live-preview`: isolated, parallel-safe, branch-faithful web
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
