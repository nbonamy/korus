# Project overview

Status: phase 1 in progress on `feat/project-overview`. Local commits only; no push,
merge, release or changelog entry.

## Goal

Give every repository group a read-only **Project overview**: one screen that lets a
developer check in on the wider project without leaving the app. It joins two views:

- **Inner loop**: what the coding harness did here. Git history as a narrative, and
  the agent sessions that ran against the repository.
- **Outer loop**: what is happening around the code. Backlog flow from connected work
  providers, CI activity per branch, and the integration risk of the current branch.

Non-goals: it is not an action centre. It never starts, assigns, merges or closes
work, and it has no notifications of its own. Existing surfaces keep those jobs.

## Feasibility

Feasible in this repository without new dependencies or a new process.

| Need | What already exists | Gap |
| --- | --- | --- |
| Git narrative | Bounded read-only git in `client/backend/src/git/agent-git-history-service.ts` | Aggregated history, tags, branch drift and overlap reads |
| Agent sessions | `executions` table in `usage/usage-ledger.ts` keyed by repository, provider, session and turn | A per-session read; nothing new is recorded |
| Live agents | `AppSnapshot.agents` with workspace branch and status | None |
| Backlog flow | `WorkProviderDriver` for GitHub, GitLab and Linear, API or CLI credentials | Drivers list open items only; a windowed activity read is new |
| CI state | Nothing reads pipelines today | New optional driver read (GitHub Actions first) |
| Transport | Agent-scoped requests route to the owning host through `routeAgentResultRequest` | One new desktop-only method |
| Surface | `AppShell` full-pane surfaces (`backlog`, `automations`) | One new surface and a repository menu entry |

Constraints that shape the design:

- The daemon owns git, the ledger and provider credentials. The renderer only draws
  an app-owned DTO.
- The request is agent-scoped (any agent of the repository group), so remote
  repositories are read on their owning host and no path crosses the boundary.
- The method is desktop-only. No mobile-consumed contract changes; `WorkItem`,
  usage and telemetry contracts are untouched.
- The usage ledger holds statistics only. The overview reads session identity,
  engine, model, timing and outcome, never prompts or transcript content.

## Information architecture

Reading order is top to bottom, coarse to fine. Each zone answers one question and
names its source.

```text
+--------------------------------------------------------------------------+
| Header: repository, branch, sources feeding the page, time window        |
+--------------+--------------+--------------+--------------+--------------+
| Commits      | Sessions     | Open backlog | CI on base   | Integration  |
| (git)        | (ledger)     | (providers)  | (code host)  | risk (both)  |
+--------------+--------------+--------------+--------------+--------------+
| Story: chapters | releases | commits by type | merges | sessions by      |
| engine, all on one time axis                                             |
+----------------------------------------------+---------------------------+
| Work in flight: one row per active branch    | Backlog flow: opened vs   |
| (agent, drift, pull request, CI runs, risk)  | closed, state mix, latest |
+----------------------------------------------+---------------------------+
```

| Zone | Question | Source | Loop |
| --- | --- | --- | --- |
| Pulse | Does anything need a closer look? | all | both |
| Story | What happened, and what agent work was behind it? | git, ledger | inner |
| Work in flight | Who is working where, and is it safe to integrate? | git, agents, code host | both |
| Backlog flow | Is the backlog growing or shrinking? | work providers | outer |

Rules: every zone stands alone (a missing source empties its own zone only); every
number carries its source and window; a risk level is always shown with its reasons.

## Behaviour specification

Each item is observable and has a test at the boundary named in Test strategy.

Opening and scope

- B1. A repository group's context menu offers **Project overview**. Choosing it
  shows the overview in the main pane for that repository and keeps the sidebar.
- B2. Selecting an agent, a Mission or another surface leaves the overview.
- B3. The overview loads when opened and when the window changes. A manual refresh
  control reloads it. It never polls while hidden.
- B4. The header shows the repository name, the current branch of the agent it was
  opened from, the base branch, and one status per source: available, not connected,
  unavailable or failed.
- B5. The time window is one of 7 days, 30 days, 12 weeks or 1 year. Seven and
  thirty days bucket by day; twelve weeks and one year bucket by Monday-started
  week. The choice is remembered for the session.

Story (git and sessions)

- B6. Each bucket shows commits split by kind: `feat`, `fix`, `test`, `chore` (which
  includes `docs`, `refactor`, `perf`, `build`, `ci`, `style`) and other. Merge
  commits are counted separately and are not in the kind split.
- B7. Releases are tags reachable from the base branch, placed in their bucket.
- B8. Chapters name consecutive buckets after the branches merged in them. A chapter
  title comes from merged branch names only, never from generated text.
- B9. Sessions are grouped per bucket and engine from recorded turns for this
  repository: session count, turn count, failed turns. A session belongs to the
  bucket of its first turn in the window.
- B10. A repository with no commits in the window shows an empty Story with the
  window stated, not an error.

Work in flight

- B11. One row per local branch with commits in the last 30 days or with a live
  agent, capped at 12, most recently active first. The base branch is always the
  first row.
- B12. A row shows commits behind and ahead of the base branch, files changed since
  the merge base, and the agents working on that branch with engine and status.
- B13. The row for the branch the overview was opened from is marked as the current
  branch.
- B14. When a code host is connected, a row also shows its pull request state and
  its most recent pipeline runs, oldest to newest.

Integration risk

- B15. The current branch gets a level of low, medium or high with reasons in
  words. Inputs: commits behind base, files it changed that other active branches
  also changed, base commits per day over the last seven days, and failing latest
  pipeline run when known.
- B16. Risk is computed from git alone when no code host is connected, and says so.
- B17. On the base branch itself there is no risk level.

Outer loop

- B18. Backlog flow shows items opened and closed per bucket, the open count, open
  items by state, and the latest changes, for the provider that hosts the
  repository.
- B19. With no connected provider for the repository the zone says so and names
  where to connect. Nothing else on the page changes.
- B20. A provider error empties only the zones fed by that provider and marks the
  source as failed. Git and sessions still render.

Robustness

- B21. A folder that is not a git repository shows sessions only and marks git as
  unavailable.
- B22. Reads are bounded: git calls have a time and output limit, history is capped
  (20,000 commits), provider reads are capped (300 items, 100 runs).
- B23. Results are cached per repository and window for 30 seconds on the daemon,
  so reopening is instant and repeated opens cannot hammer a provider.

## Architecture

```text
ProjectOverviewView (renderer)
  -> AppApi.getProjectOverview(agentId, input)           core/src/contracts.ts
  -> ipc 'project:overview:get'                          preload, Electron main
  -> backend 'project/overview/get' { agentId, input }   routed to the owning host
  -> ProjectOverviewService (daemon)
       |- ProjectOverviewGitReader   git history, tags, branches, drift, overlap
       |- UsageLedger.sessions()     recorded sessions for the repository
       |- snapshot agents            live agents on each branch
       `- outer-loop port            backlog activity and pipeline runs
             `- WorkIntegrationManager -> WorkProviderDriver (GitHub first)
```

Contracts (`core/src/project-overview.ts`, platform-neutral so a later server and
other clients can produce or read the same shape):

- `ProjectOverviewInput { window?, timeZone? }`
- `ProjectOverview { generatedAt, repository, window, sources, story, sessions,
  branches, risk, backlog, pipelines }`. Zones are `null` when their source is not
  available, so the renderer never infers a state from an empty array.
- Pure policy shared by every producer: `projectOverviewCommitKind`,
  `projectOverviewBucketStart`, `projectOverviewChapters`,
  `projectOverviewIntegrationRisk`.

Daemon (`client/backend/src/project-overview/`):

- `ProjectOverviewGitReader`: read-only, `GIT_OPTIONAL_LOCKS=0`, bounded time and
  output, no fetch and no network. Base branch is `origin/HEAD` when set, otherwise
  the workspace default branch, otherwise `main` or `master`.
- `ProjectOverviewService.get(agent, input)`: validates input, resolves the
  repository from the agent workspace, runs sources in parallel, isolates each
  failure into its source status, caches the result.
- `UsageLedger.sessions(repository, since)`: one row per provider session.
- Outer-loop port: `backlog(repositoryId, since)` and `pipelines(repositoryId,
  since)`, each returning `null` when no provider is connected. Implemented by
  `WorkIntegrationManager` over two optional driver methods,
  `listBacklogActivity` and `listPipelineRuns`. GitHub implements both through the
  existing API and CLI request path. GitLab and Linear follow in phase 2.

Renderer (`client/vue/src/components/`):

- `AppShell` gains an `overview` surface next to `backlog` and `automations`.
- `use-project-overview.ts` owns loading, stale-response rejection and the window.
- `ProjectOverviewView` composes four zone components. Charts are plain DOM and
  CSS grid driven by the DTO, so they are assertable in jsdom and need no canvas.
- Copy lives in `i18n/messages.ts`. Colours are semantic variables.

Integration risk model (`projectOverviewIntegrationRisk`), deterministic and
explainable. Points: behind base (1 for 1 to 9 commits, 2 for 10 to 29, 3 for 30 or
more); size (1 for 30 to 99 changed files, 2 for 100 to 199, 3 for 200 or more);
overlapping files with other active branches (1 for 1 to 2 files, 2 for 3 or more);
base velocity (1 at 10 or more commits a day); failing latest pipeline run (2). Low
is 0 to 2 points, medium 3 to 5, high 6 or more. Each scored input yields a reason
the UI renders.

## Phases and commit checkpoints

Phase 1, this branch:

1. `feat: add project overview contracts and risk policy`: core types, pure policy
   and their tests.
2. `feat: read project history and sessions for the project overview`: git reader,
   ledger session read, service, protocol method, server routing, runtime wiring.
3. `feat: expose the project overview to the desktop renderer`: IPC channel,
   preload, main handler.
4. `feat: show the project overview surface`: view, zones, composable, shell
   surface, repository menu entry, copy.
5. `feat: read github backlog activity and pipeline runs for the project overview`:
   driver methods, manager port, GitHub mapping.

Phase 2: GitLab issues and pipelines; Linear state changes mapped through the
configured Linear team or project; pull request state per branch; command palette
and Quick Open entries; a sidebar row per repository group as in the mockups.

Phase 3: generated chapter summaries through the existing utility text generation,
labelled as generated and cached per chapter; session drill-in to a conversation.

Phase 4: shared state. The same `ProjectOverview` DTO produced by a server for a
Team, pushed to clients; session lane fed by an external trace store (OpenTelemetry,
LangSmith, Braintrust) through a `ProjectOverviewSessionSource` port that the local
ledger also implements.

## Test strategy

Written before the production change in each checkpoint.

| Boundary | Suite | Proves |
| --- | --- | --- |
| Core policy | `core/src/__tests__/project-overview.spec.ts` | B6 kinds, B5 bucket starts across time zones, B8 chapter grouping, B15 to B17 risk levels and reasons |
| Git | `client/backend/src/project-overview/__tests__/project-overview-git.spec.ts` against real temporary repositories | B6, B7, B10, B11, B12, B21, B22: merges, tags, drift, overlap, non-repository folder, detached HEAD |
| Ledger | extend `usage/__tests__/usage-ledger.spec.ts` | B9: sessions grouped by provider and session, scoped to repository and window |
| Service | `project-overview/__tests__/project-overview-service.spec.ts` | B4, B16, B18 to B20, B23: source statuses, failure isolation, not connected, cache |
| Daemon routing | `client/backend/src/__tests__/server-project-overview.spec.ts` | request validation, local handling, routing to the owning host without a local read |
| GitHub driver | extend `work-integrations/__tests__/github-driver.spec.ts` | B18, B14: activity and run mapping, pagination cap, malformed rows dropped |
| Electron | extend `client/electron/src/main/__tests__/agent-git-ipc.spec.ts` | channel forwards agent and input to the backend method |
| Renderer | `client/vue/tests/integration/ProjectOverviewView.spec.ts` with the typed client mock | B3 to B5, B10, B13 to B20 as rendered text, roles and states; stale responses ignored |
| Shell | extend `client/vue/tests/integration/AppShell.navigation.spec.ts` | B1, B2 |

Gates before handoff: `npm run lint`, `npm test -w @workspace/core`,
`-w @workspace/backend`, `-w @workspace/vue`, `-w @workspace/electron`, coverage
gate unchanged at 85% statements. No mobile compatibility fixture is needed: no
mobile-consumed contract changes.

## Guidance for a coding agent

- Read `client/AGENTS.md`, `core/AGENTS.md`, `docs/testing.md` and
  `docs/frontend.md` first. Use the `korus-frontend-dev`,
  `korus-testing-coverage` and `korus-dod` skills.
- Contract first: `core`, then daemon, then Electron, then renderer. The renderer
  never imports backend protocol types and never computes from raw git or provider
  payloads.
- Keep every read side-effect free. No `git fetch`, no writes, no provider
  mutations. A new driver method is optional so other providers stay valid.
- Never widen `WorkItem`, usage or telemetry contracts for this feature.
- Fail closed per source. A thrown provider error becomes a `failed` source status
  with no provider text passed through.
- No fixed sleeps in Vue tests. Use deferred promises for load and stale-response
  cases.
- Do not add a chart library; reuse semantic variables and existing shared
  primitives (`WorkspaceHeader`, `AppMenu`, `CountedFilterRow` where they fit).
- Do not edit `CHANGELOG.md` or `docs/`.

## Progress and learnings

Done and green on `feat/project-overview` (focused suites and typechecks for core,
backend and electron):

- Core contract and policy (`core/src/project-overview.ts`), 29 tests.
- Daemon: git reader on real temporary repositories, ledger session read, service
  with per-source failure isolation and a 30 second cache, `project/overview/get`
  routed to the owning host, runtime wiring.
- GitHub backlog activity and pipeline runs through the existing API and CLI
  request path, exposed by `WorkIntegrationManager`.
- Electron: `AppApi.getProjectOverview`, IPC channel, preload and main handler.

Not started: checkpoint 4, the renderer surface (view, zones, composable, shell
surface, repository menu entry, copy) and its integration tests. Not yet run:
`npm run lint` (architecture, Knip, CSS, i18n), the Vue and mobile typechecks, the
full suites and the coverage gate. Knip may flag exports that only the renderer
will consume.

Learnings:

- GitHub drivers address repositories as `owner/name`, while the workspace origin
  resolves to `github.com/owner/name`; the manager converts at its boundary.
- `handleMessage` rejects when a local handler throws; assert with `rejects`.
- Chapters are fixed equal spans named from merged branch subjects, so squash
  merges produce no chapter. Generated summaries stay in phase 3.
