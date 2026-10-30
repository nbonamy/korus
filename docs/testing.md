# Testing

Focused tests while iterating; the relevant full gate before handoff or commit.

"Contract" and "workflow" tests here mean Electron IPC, the Korus WebSocket
adapter, client state, renderer behavior, or a fake backend transport (Korus is a
desktop app: no server/API integration gates). Fakes sit at ownership boundaries:

| Under test | Fake |
| --- | --- |
| App controller / state routing | unified backend fake |
| Real Codex driver | typed Codex SDK surface (never the real SDK against a fake app-server; that boundary belongs to the SDK repo) |
| Real Claude driver | fake Claude SDK query |
| Mounted UI / `App` | `vue/src/test/client-api-mock.ts` + `backend-fixture.ts` |

Korus tests its adapter translations and product behavior, not either SDK. Wire
framing, decoding and lifecycle tests for its own process/socket transports remain.
Real provider smoke tests are opt-in and never part of the normal gate.

Mission screenshot fixtures use reserved synthetic sessions. The daemon rebuilds
their conversations from the persisted fixture identity and rejects provider
operations for those sessions. They exercise the real Mission and conversation
components without starting model turns; they are presentation fixtures, not
evidence that live provider execution works. Keep failure and recovery fixtures
separate from screenshot presets.
Debug workspace rows never grant filesystem ownership. Deleting a fixture keeps
borrowed agents and provider conversations; synthetic screenshot agents are removed
locally without provider operations.

## Quality Bar

Every behavior change needs coverage at the owning runtime boundary; write the
behavior test before the production change. Never write unit tests after code.
Prefer E2E or integration tests as the sole testing mechanism, especially for
complex features, and produce a verifiable, repeatable artifact from those tests.
If a system must be tested in isolation, write down all the ways it could fail
first. If a test cannot be run or a change is truly untestable or docs-only, say
so explicitly and name what to run next.

All six workspaces (`core`, `backend`, `vue`, `electron`, `web`, `mobile`) gate on exactly
**85% statements**; lines, branches and functions are diagnostics. Never lower the
threshold or shrink includes/exclusions to land a change. Coverage is evidence of
exercised behavior, not a reason to invent a test. Leave no broad untested areas
around IPC, protocol adapters, persistence, reducers, agent status, tool rendering,
approvals, diffs, filesystem, git or teams.

## Principles

- Test behavior, not implementation: assert what users see, what IPC emits, what
  state changes, what contracts return. Prefer E2E or integration workflows over
  isolated tests, and follow a mutation with a read, list, event, persisted
  snapshot or cleanup check.
- Use `toStrictEqual()` for app-owned contracts and fixtures; do not cherry-pick
  fields with scattered `toHaveProperty()` when the full shape is the contract.
- Isolate and clean up: tests are idempotent, close streams, child processes, file
  handles and subscriptions in `finally`.
- Mock external boundaries, never the logic under test.
- Native Compose effect deadlines use the Compose test clock. Let lifecycle and
  composition updates settle before advancing it; real elapsed waits belong to
  platform handlers and WebView deadlines that use elapsed time.
- Native touch automation waits for stable screen coordinates when opening
  system-animated sheets. Compose idleness does not settle window or keyboard
  animations.

## Test Value Gate

Start with the existing owner-boundary tests. Extend the closest workflow and
remove checks it supersedes. Add a separate test only for a concrete regression
those workflows cannot catch; a new function, branch or file is not sufficient
reason. Keep scenarios independently readable rather than combining unrelated
behaviors to reduce the test count.

Name the regression a test protects in one sentence. Accept it only if:

1. it exercises production behavior through the closest owning public seam;
2. that regression would fail it for the right reason;
3. a harmless refactor, rewording, file move or equivalent implementation keeps it
   green;
4. no existing owner-boundary test already proves the same behavior.

Otherwise do not add it, and remove an existing test that fails the gate when no
realistic regression risk is lost. A test that survives replacing the implementation
with a constant, or breaks on harmless rewording, fails the gate. Accepted tests
protect a user-visible outcome, an owned or external contract, a state transition or
persistence guarantee, or an error/security/architecture boundary.

- Prefer rendered E2E or integration workflows for UI behavior. Isolate Vue
  components only when a concrete regression cannot be reliably observed at a
  higher boundary; first write down the failure modes, then assert rendered DOM,
  accessibility state, interactions or resulting behavior. When behavior depends
  on CSS, use the production styles; use a real browser for layout geometry.
- Do not assert every sentence of tool descriptions, prompts or help text. Test
  interpolation, conditional sections, schemas and the behavior they enable; keep one
  assertion where exact copy is itself the contract.
- **Never read production `.vue`, TypeScript, stylesheets, scripts, manifests or
  config as text to assert their contents.** Enforce architecture and security rules
  with lint, TypeScript, AST or dependency tooling. Tests may read source only when it
  is product input, via a fixture, and may inspect generated artifacts that are the
  output under test.
- Keep one strong test at the closest boundary that proves the observable
  behavior. Add a lower-level test only for distinct behavior that the
  higher-boundary test cannot reliably observe. Table-driven rows must be
  distinct behaviors.
- Keep snapshots rare; prefer explicit assertions.
- Report the behavior proved and remaining limits. Raw test counts and coverage
  percentages alone do not establish correctness.

## Main Process And Preload

Without a real backend process by default, cover: RPC parsing, request/response
matching, notifications, malformed responses and client callbacks; app-server
lifecycle (spawn/connect, readiness, restart, shutdown, cleanup); driver routing and
policy (create/resume/archive, submit/steer/interrupt, status projection);
routing-envelope and replica revision handling without a second Korus reducer;
approval and input coordination; persistence, migrations, settings, teams, agents and
window state; filesystem and git at the app boundary. Host-boundary tests prove Korus
forwards SDK snapshots, events and promise-returning actions without duplicating SDK
behavior.

Preload is a security boundary and must stay narrow: test allowed channels and
argument validation, typed returns, subscribe/unsubscribe cleanup, reload snapshot
behavior and renderer-safe errors. Never expose broad Electron or Node primitives.

## Renderer

Prefer rendered E2E or integration workflows for UI behavior. If a distinct
rendering regression cannot be reliably observed there, component isolation may use
Vue Test Utils, Vitest and jsdom. Co-locate specs in `__tests__/`; use small store
fakes only when the contract depends on a store; stub IPC at the app boundary, not
inside the tree; do not use Codex app-server fixtures for visual components. Test
only the states that represent distinct, observable behavior. If isolation is
necessary, write down the failure modes first.

- The shared setup supplies lightweight Element Plus controls that preserve rendered
  and emitted contracts (DOM, classes, aria, slots, model events). A placeholder that
  only makes a test mount is not acceptable. Mount the real control when its own
  interaction, validation, focus, teleport or accessibility is under test.
- Avoid product-component stubs unless the child is covered elsewhere. App-shell
  tests use contract-faithful child stubs by default and real children only for
  representative composition workflows.
- SDK-owned behavior (composer, message rendering, clipboard, attachments, paste/drop,
  transcription, approval and ask-user UI) is tested in the SDK; Korus tests only its
  wrapper, adapter and product policy.
- Test capabilities through a visible control and its interaction result, not
  forwarded props. Assert event retention before supplying a later navigation
  snapshot that could repair lost state.

## Mobile Compatibility Evidence

Every change to a mobile-consumed contract or its producer must extend the owning
daemon, companion gateway or relay workflow with a released-client regression case.
Exercise the existing client's request against the current implementation, verify
the operation's result, and check the response and streamed events against the
older client's decoding expectations. Keep those expectations independent of shared
current types. SDK upgrades and serialization changes are subject to the same gate.

Preserve released-client fixtures and assertions when adding a new contract; do not
regenerate or weaken them to match an incompatible implementation. New functionality
must also demonstrate that unnegotiated old clients retain their existing behavior.
These cases belong in the normal test suites and CI, not an optional manual check.
The handoff identifies the affected mobile boundary, released-client baseline and
compatibility evidence. Desktop-only changes need no mobile compatibility fixture.

## Fixtures

Scripted, never simulators: `backend/src/codex/__tests__/sdk-surface-fixture.ts`
(typed SDK methods, per-conversation snapshots, explicit events; tests supply the
provider's resulting state, so the fixture must not grow a reducer),
`backend/src/claude/__tests__/sdk-query-fixture.ts` (independently controlled query
iterators; inputs, permissions and failures observable at the SDK boundary), and
`vue/src/test/client-api-mock.ts` (exhaustive typed `AppApi` fake with production
initialization, disposable subscriptions, I/O-free defaults, and throwing
consequential operations unless scripted). Per-test overrides merge into the complete
fake; use `stubLegacyElectronTestWindow` only to test missing-method compatibility,
and await asynchronous initialization before exercising controls.

`sdk-boundary-*.spec.ts`, Claude's `sdk-boundary.spec.ts` and `*backend-boundary.spec.ts`
run in the normal glob and CI (`npm run test:integration` is a fast entry). Keep
lower-level tests for Korus-owned algorithms, provider translation, wire security,
persistence, filesystem and Git safety only when an integrated workflow cannot
reliably expose the regression. A provider-independent service needs no artificial
Codex and Claude variants.

- Store captured fixtures next to their tests; include malformed and partial-stream
  cases and enough original payload shape to catch protocol drift.
- Drive the real adapter from SDK-shaped fixtures and renderer composition from the
  resulting app-owned contract; renderer tests never import generated Codex types.
- When replacing tests, record the retained Korus behavior and its new owning suite;
  delete SDK-owned optimistic-message, raw-reduction and slash-copy assertions rather
  than transplanting them, and never trade failure, identity or ordering tests for
  call-through smoke tests.
- To prove a regression family is caught, inject a temporary deliberate fault (drop a
  review event, remove a queue lock), watch it fail, restore and rerun green. These
  probes are local validation, never committed switches.

## Conversation Ownership

Provider suites own transcript semantics. Korus tests only: targeted operations never
cross agent or conversation identity; one reset plus revisioned deltas yields one row
per provider message; stale or gapped revisions trigger rehydration; Electron
forwards frames without reducing; snapshot persistence and sync stay transcript-free;
projections (plans, diffs, unread, sidebar activity) are read-only and cannot
resurrect or mutate provider turns. Plan review decisions are explicit commands:
test pending-review persistence, identity, idempotence and failed acceptance. Client
isolation tests assert no implicit runtime loading and that snapshot queries do no
maintenance. Use captured long-conversation fixtures for deterministic performance
regressions; do not reintroduce a transcript reducer to benchmark provider traffic.

## Shared-chat relay probe

The manual **Shared chat relay probe** Actions workflow runs a headless guest
against the product relay. The repository secret `TEST_SHARED_LINK` supplies its
invitation; the owner desktop must remain online with that share active. Each run
joins once and leaves one pending suggestion containing its UTC send timestamp.
It does not send the suggestion to the provider or retry uncertain delivery.

The job summary and retained JSON artifact report connection, join and monotonic
send-to-ack timing. The acknowledgment includes owner processing and persistence;
it does not measure rendering or one-way latency. Comparing the suggestion timestamp
with desktop receipt time requires synchronized clocks. Results exclude invitations,
peer identities and transcript contents; failures retain a sanitized stage and error.

Run the same probe locally with `node scripts/shared-chat-probe.mjs [results.json]`
and `TEST_SHARED_LINK` in the environment. A relay override requires both
`APP_COMPANION_RELAY_URL` and `APP_COMPANION_RELAY_PEER_ID`; invitations cannot
override the relay. Without an output argument, results go under `.app-dev/`.

## Gates

Run local checks with the Node 26 reference toolchain pinned in `.nvmrc` and
the npm version declared in `package.json` so results use the same toolchain as CI.

`package.json` scripts are the reference. `npm test`, `npm run test:coverage`,
`npm run lint` (includes every workspace typecheck and the Knip dead-code check) and
`npm run build`. Prefer `npm run test:ai` for agent-driven full runs: same suites,
quiet output, `[TESTS:DONE]` after each workspace. Host-only iteration uses suffixed
commands (`test:electron`, `typecheck:web`, …). For visual changes add a local
app/screenshot check when the app can boot; for protocol or persistence changes run
the touched module's tests plus the full coverage gate.

The independent Quality workflow runs on branch pushes, PRs and manual dispatch.
Tag pushes do not trigger it. It owns lint/typechecks, the full suite under
coverage, script tests, and retained coverage reports. The README badge combines
covered and total statement counts
from every declared workspace. Only successful runs for the current `main` commit
publish badge data to the separate `badges` branch; PRs have no publication authority.
The publishing job alone has repository write permission and retains badge history
independently of application source. The release workflow runs ordinary workspace
and script tests, without coverage, before builds and publication. The workflows are independent:
Quality failures do not block releases; release test failures do. Run against the
installed SDK package boundary; source aliases do not substitute for package
verification. Desktop smoke (boot, create or
select an agent, pick a folder, send, stream, interrupt or approve, restore after
reload) and screenshot checks for shell, sidebars, composer, artifact panes, diffs
and theme switching apply once the
chosen desktop tool is configured.

The Design acceptance smoke runs the built web shell and an isolated daemon:
`npm run build:web && node scripts/verify-design-workspace.mjs [output-directory]`.
It copies existing local Codex authentication only to pass shell onboarding, submits
no model turns, and removes its temporary profile afterward. Deterministic authored
content exercises user edits, targeted batches, stale-write rejection, reload,
iframe isolation, Play, recovery, shared-canvas navigation, inspector toggling,
alternatives, layer/layout editing, drag/resize conflicts, prototype navigation with
form-state recovery, live tweak previews, stale-tweak recovery, and offline HTML
playback. The output directory
retains a JSON check report, document, handoff, HTML and screenshots. Add `--live`
to exercise the configured provider with an open-ended brief and verify three
directions with tradeoffs and generated controls; this consumes provider usage. Native capture requires
separate desktop verification.
