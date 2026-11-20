# Project overview

Status: phase 1 built on `feat/project-overview` and passing lint and tests; not
yet checked in the running app or against a real engine (see Progress). Local
commits only; no push, merge, release or changelog entry.

## Goal

Give every repository group a read-only **Project overview** that lets a developer
check in on the wider project without leaving the app. It answers two questions and
nothing else:

- **What is this project working on, and how is each workstream going?** A few
  sentences of analysis, written from the code and its issues.
- **Where is the work right now, and where is it stuck?** A live factory-style flow
  from backlog to shipped.

Non-goals:

- It is not an action centre. It never starts, assigns, merges or closes work.
- It is not a mirror of upstream tools. It never lists tickets, commits, pull
  requests or pipeline runs; those stay in the tools that own them.
- It has no controls, filters, tables or time-window pickers of its own.

## Feasibility

Feasible in this repository without new dependencies or a new process.

| Need | What already exists | Gap |
| --- | --- | --- |
| Repository evidence | Bounded read-only git; `ProjectOverviewGitReader` on this branch | Merge sizes, first and last commit per branch, lines changed |
| Live agents | `AppSnapshot.agents` with workspace branch and status | None |
| Issues | `WorkProviderDriver` for GitHub, GitLab, Linear; `listBacklogActivity` on this branch (GitHub) | GitLab and Linear |
| Pull requests | `listItems` returns open pull requests without draft or approval state | One optional driver read for open pull requests |
| Pipelines | `listPipelineRuns` on this branch (GitHub) | GitLab |
| Written narrative | `driver/text/generate` with `outputSchema`, used for commit and pull request messages; `agents/utility-text-model.ts` picks a lightweight model per engine | Evidence builder, prompt, validation, persistence |
| Transport | Agent-scoped requests route to the owning host; `project/overview/get` on this branch | One more method to rewrite the narrative |
| Surface | `AppShell` full-pane surfaces (`backlog`, `automations`) | One new surface and a repository menu entry |

Constraints that shape the design:

- The daemon owns git, provider credentials and generation. The renderer draws an
  app-owned DTO and never computes from raw git, provider or model output.
- Requests are agent-scoped (any agent of the repository group), so a remote
  repository is read, and its narrative written, on the host that owns it.
- Everything is desktop-only. No mobile-consumed contract changes; `WorkItem`,
  usage and telemetry contracts are untouched.
- Generation spends the user's own engine allowance, so it is bounded, cached and
  only runs while the page is open.

## Information architecture

```text
+------------------------------------------------------------------------+
| korus · Project overview                     Live · updated 2 min ago  |
|                                                                        |
| Lead: one or two sentences on the state of the project.                |
|                                                                        |
| o Workstream  State     # Workstream  State     @ Workstream  State    |
|   Two sentences of        Two sentences of        Two sentences of     |
|   analysis.               analysis.               analysis.            |
|   From <basis>            From <basis>            From <basis>         |
|                                                                        |
| Written by <engine> from the code and its issues.                      |
+------------------------------------------------------------------------+
| Where the work is right now              o # @ . legend of workstreams |
|                                              Constraint                |
| [Backlog] -..-> [Building] -..-> [Review] -.-> [CI] -..-> [Shipped]    |
|    47              5 oo#..         6 oo@...     3 o..        31        |
| 9 arrived       4 agents        oldest 3 days  1 failing   this week   |
|                                                                        |
| One sentence naming the constraint and why.                            |
+------------------------------------------------------------------------+
```

| Zone | Question | Produced by | Source |
| --- | --- | --- | --- |
| Narrative | What is being worked on, and how is it going? | An engine, from daemon-built evidence | git, issues, agent sessions |
| Flow | Where is the work, and where is it stuck? | Deterministic policy, no model | git, agents, pull requests, pipelines, issues |

Rules:

- Analysis, not a copy. Text only: no lists of upstream records, no links, no tables.
- Workstreams link the zones. The mark beside a workstream name is the mark on its
  work in the flow. Marks differ in shape as well as colour.
- A missing source removes its stations and its sentences and says so in one line.
- Reading time: ten seconds for the lead and the constraint, a minute for the page.

Mockups (three boards on a private design canvas): all sources connected, repository
only, and this structure. Narrative text in the mockups uses real facts from this
repository; station counts are sample data.

## Behaviour specification

Each item is observable and has a test at the boundary named in Test strategy.

Opening

- B1. A repository group's context menu offers **Project overview**. Choosing it
  shows the overview in the main pane for that repository and keeps the sidebar.
- B2. Selecting an agent, a Mission or another surface leaves the overview.
- B3. The page has two zones, narrative then flow, and no controls of its own.
- B4. The header shows the repository name and one live line: when the page was last
  updated, and "repository only" when no issue or code-host source is connected.

Lookback

- B5a. The narrative covers the shortest window with enough activity: the last 30
  days for an active project, otherwise 90, 180, 365 or 730 days, otherwise the
  whole history from the first commit. Activity is base commits, plus merges into
  the base and branch tips weighted more heavily (4 and 3 points), against a
  threshold of 40 points.
- B5b. Issues and agent sessions are read over the same window. The flow keeps its
  own present-tense windows (in flight 30 days, shipped and arrived 7 days).
- B5c. The narrative names its window ("Covers the last 180 days" or "Covers the
  whole history, since May 25, 2024").

Narrative

- B5. The narrative is one lead of at most two sentences and one to four
  workstreams. A workstream has a name, a state word, at most two sentences of
  analysis and a basis line.
- B6. The state word is one of: starting, moving, settling, recurring, waiting,
  stalled.
- B7. Generated text is rendered as plain text. Length limits (lead 280 characters,
  analysis 360, name 40) keep it from becoming a list.
- B8. The narrative is grounded. Every workstream cites evidence facts; every
  branch or issue it claims exists in the evidence; every number written in digits
  in the lead or an analysis appears in a cited fact. A narrative that fails is
  rejected, retried once with the failures stated, then reported as unavailable.
- B9. The basis line is composed by the daemon from the cited facts' labels, never
  by the model.
- B10. A provenance line names the engine that wrote the narrative and its age.
- B11. Freshness. The last narrative shows at once from cache. It is rewritten when
  the evidence has changed, at most once every 15 minutes per repository, and only
  while the overview is open. While rewriting, the previous text stays with a quiet
  "updating" hint.
- B12. The narrative survives a restart: reopening with unchanged evidence spends
  nothing.
- B13. Without an issue source the narrative is written from the repository alone
  and says so.
- B14. When no engine can write it (no utility model, two failed attempts, or
  nothing happened in 30 days) the zone states which in one line. The flow is
  unaffected.

Flow

- B15. Five stations in fixed order: Backlog, Building, Review, CI, Shipped. Each
  shows its name, a count and one note.
- B16. A unit of work is a branch with commits ahead of the base branch, with its
  pull request when it has one. Its station is the first that applies:
  Building when it has no pull request or a draft one; Review when its pull request
  is open and not approved; CI when its pull request is approved and not merged.
  When the provider cannot report approvals, a pull request whose latest pipeline
  run is running or failed is in CI and any other is in Review.
- B17. Backlog counts open issues and notes how many arrived in seven days. Shipped
  counts merges into the base branch in seven days. Building notes how many agents
  are working, Review how long the oldest has waited, CI how many are failing.
- B18. Marks inside Building, Review and CI show each unit's workstream. A unit the
  narrative does not claim is "Other work". The legend lists only marks in use.
- B19. A link between two stations carries one moving token per unit that reached
  the next station in the last 24 hours, at most three. With reduced motion the
  tokens are still. A link nothing crossed is empty.
- B20. The constraint is the station among Building, Review and CI with the most
  total waiting time, named only when it holds at least two units and its oldest
  has waited over 24 hours. Waiting time is time since arrival for Review and CI,
  and time since the last commit for a Building unit no agent is working on. The
  page labels that station and adds one sentence with the count, the oldest wait
  and the workstreams involved. With no constraint it says nothing is stuck.
- B21. A station whose source is not connected is drawn dashed with no count and
  "not connected". One sentence names where to connect.
- B22. The flow is live: while the overview is visible it refreshes when an agent
  of the repository changes status or git state, debounced, and every 60 seconds.
  It never refreshes while hidden, and a refresh never rewrites the narrative.
- B23. A provider error marks only the stations it feeds as unavailable.

Robustness

- B24. A folder that is not a git repository shows one line saying so.
- B25. Reads are bounded: git calls have time and output limits; history is capped
  at 20,000 commits; provider reads at 300 issues, 100 pull requests, 100 runs;
  evidence sent to an engine at 150 commit subjects and 60 issue titles.
- B26. Flow results are cached for 30 seconds per repository on the daemon.
- B27. Commit subjects, branch names and issue titles are untrusted text. They are
  fenced as data in the prompt, and nothing generated is treated as markup, a link
  or an instruction.

## Architecture

```text
ProjectOverviewView (renderer)
  -> AppApi.getProjectOverview(agentId)                 flow + cached narrative
  -> AppApi.refreshProjectNarrative(agentId)            rewrites when stale
  -> ipc 'project:overview:get' / 'project:overview:narrative:refresh'
  -> backend 'project/overview/get' / 'project/overview/narrative/refresh'
       routed to the owning host
  -> ProjectOverviewService (daemon)
       |- ProjectOverviewGitReader    base history, merges, branches in flight
       |- snapshot agents             who is working on which branch
       |- outer-loop port             issues, open pull requests, pipeline runs
       |     `- WorkIntegrationManager -> WorkProviderDriver
       |- flow policy (core)          stations, marks, tokens, constraint
       `- ProjectNarrativeWriter
             |- evidence builder      numbered facts computed by code
             |- driver/text/generate  utility model, outputSchema
             |- narrative policy (core)  validation and grounding
             `- narrative store       last narrative per repository, with its
                                      evidence hash, in a daemon-private file
```

Contract (`core/src/project-overview.ts`, platform-neutral so a later server can
produce the same shape):

- `ProjectOverview { generatedAt, repository, sources, narrative, narrativeStatus,
  flow }`.
- `ProjectNarrative { lead, workstreams[{ id, name, state, analysis, basis }],
  writtenBy, writtenAt }`; `narrativeStatus` is fresh, stale, missing or
  unavailable with a reason.
- `ProjectFlow { stations[{ kind, status, count, note, marks }], links[{ from, to,
  tokens }], constraint }`.
- Pure policy shared by every producer: station assignment, waiting time,
  constraint choice, token selection, mark assignment, narrative validation.

Evidence. The daemon computes numbered facts, each one plain sentence with its
numbers already worked out, plus a short label for the basis line. Kinds: latest
release; branches merged in 30 days with the commits each brought; themes (how many
`fix` or `feat` subjects mention a term); each branch in flight with drift, size and
agents; base velocity; issues opened, closed and open; issue themes; agent sessions
per engine with failed turns; the current flow and constraint. Raw lists (commit
subjects, issue titles) go along for interpretation only. The evidence hash excludes
timestamps so an unchanged project never looks stale.

Generation. `ProjectNarrativeWriter` calls the existing `driver/text/generate`
through an agent's driver with `cwd`, `developerInstructions`, the fenced evidence
and an `outputSchema` of `{ lead, workstreams[{ name, state, analysis, facts,
branches, issues }] }`. It uses the requesting agent's engine; when that engine has
no utility model (Cursor today) it uses another agent of the same repository whose
engine has one. One generation per repository at a time; concurrent requests share
it. The validated result is stored with the evidence hash, engine and model.

Flow. Built on every `get` from git facts, snapshot agents, open pull requests and
pipeline runs, with no model involved, so it stays cheap enough to refresh live.

Outer-loop port: `backlog`, `pullRequests` and `pipelines`, each `null` when no
connected provider serves the repository. Driver methods are optional:
`listBacklogActivity` and `listPipelineRuns` exist for GitHub; `listOpenPullRequests`
(branch, draft, approved or unknown, opened at) is new.

Renderer (`client/vue/src/components/`):

- `AppShell` gains an `overview` surface next to `backlog` and `automations`.
- `use-project-overview.ts` owns loading, stale-response rejection, the narrative
  rewrite call, and live refresh tied to visibility.
- `ProjectOverviewView` composes `ProjectOverviewNarrative` and
  `ProjectOverviewFlow`. The flow is plain DOM with absolutely placed stations,
  links and tokens driven by the DTO; token motion is a CSS animation disabled
  under reduced motion. No chart library, no canvas.
- Copy lives in `i18n/messages.ts`; state words, station names and the constraint
  sentence are app copy composed from DTO values. Colours are semantic variables.

Privacy. Evidence holds commit subjects, branch names and issue titles. It goes only
to the engine already working in that repository, on the host that owns it, exactly
as commit-message generation sends diffs today. Nothing from the overview enters
telemetry.

## Phases and commit checkpoints

Done on this branch (see Progress): plan, first contract and policy, git reader,
GitHub issue and pipeline reads, routing, desktop bridge.

Phase 1, remaining:

1. `refactor: reshape the project overview contract around narrative and flow`:
   contract, flow policy, narrative validation; remove the window input, buckets,
   chapters and the per-zone backlog and pipeline shapes.
2. `feat: read open pull requests and branch timing for the project overview`:
   optional driver read with GitHub mapping, manager port, git reader additions.
3. `feat: build the project flow from branches, agents, pull requests and
   pipelines`: flow builder in the service, source statuses, cache.
4. `feat: write the project narrative from repository and issue evidence`:
   evidence builder, writer, validation and retry, store, rewrite method.
5. `feat: expose the project narrative rewrite to the desktop renderer`: channel,
   preload, main handler.
6. `feat: show the project overview surface`: view, two zones, composable, shell
   surface, repository menu entry, copy.
7. Gates, then remove anything the dead-code lint reports as unused.

Phase 2: GitLab issues, merge requests and pipelines; Linear issues through the
configured team or project; command palette entry; a sidebar row per repository.

Phase 3: show what a workstream rests on (its facts) on demand; session traces from
an external store (OpenTelemetry, LangSmith, Braintrust) behind the same evidence
port the local ledger feeds.

Phase 4: shared state. A server produces the same `ProjectOverview` for a Team and
pushes it to clients, so everyone reads one narrative and one flow.

## Test strategy

Written before the production change in each checkpoint.

| Boundary | Suite | Proves |
| --- | --- | --- |
| Core flow policy | `core/src/__tests__/project-overview.spec.ts` | B16 to B20: station rules including unknown approvals, waiting time, constraint threshold and ties, token cap, mark assignment |
| Core narrative policy | same suite | B5 to B8: shape and length limits, closed state set, unknown fact or reference rejected, a digit not present in cited facts rejected, words for numbers allowed |
| Git | `project-overview/__tests__/project-overview-git.spec.ts`, real temporary repositories | merges with sizes, branches in flight with first and last commit, non-repository folder, detached HEAD, bounds |
| GitHub driver | extend `work-integrations/__tests__/github-driver.spec.ts` | open pull request mapping (draft, approval, unknown), caps, malformed rows dropped |
| Manager | extend `work-integrations/__tests__/manager.spec.ts` | each read answers null when no connected provider serves the repository |
| Flow service | `project-overview/__tests__/project-overview-service.spec.ts`, ports faked | B15 to B23, B26: full flow from facts, not connected and failed sources isolated, cache |
| Narrative writer | `project-overview/__tests__/project-narrative-writer.spec.ts`, scripted generation port | B8 to B14, B27: evidence document and hash, one retry then unavailable, rate limit, shared in-flight generation, persistence across a new instance, fallback engine, fenced untrusted text |
| Daemon routing | extend `__tests__/server-project-overview.spec.ts` | both methods handled locally and routed to the owning host without a local read |
| Electron | extend `main/__tests__/agent-git-ipc.spec.ts` | both channels forward to their backend methods |
| Renderer | `client/vue/tests/integration/ProjectOverviewView.spec.ts`, typed client mock, deferred promises and a fake clock | B3 to B5, B10, B11, B13 to B15, B18 to B22 as rendered text, roles and states; rewrite requested once when stale; no refresh while hidden; stale responses ignored |
| Shell | extend `client/vue/tests/integration/AppShell.navigation.spec.ts` | B1, B2 |

Not covered by automated tests: the quality of the writing. Check it by hand in a
live preview against two or three real repositories before handoff, and keep one
captured evidence document and its accepted narrative as a fixture.

Gates before handoff: `npm run lint`, `npm test -w @workspace/core`,
`-w @workspace/backend`, `-w @workspace/vue`, `-w @workspace/electron`, coverage
gate unchanged at 85% statements. No mobile compatibility fixture is needed.

## Guidance for a coding agent

- Read `client/AGENTS.md`, `core/AGENTS.md`, `docs/testing.md` and
  `docs/frontend.md` first. Use the `korus-frontend-dev`,
  `korus-testing-coverage` and `korus-dod` skills.
- Contract first: `core`, then daemon, then Electron, then renderer.
- The model writes sentences and nothing else. Counts, dates, station placement,
  the constraint and the basis line are computed by code. Never ask the model for a
  number and never show one it produced that the evidence does not contain.
- Keep every read side-effect free: no `git fetch`, no writes to the repository,
  no provider mutations. New driver methods are optional.
- Never widen `WorkItem`, usage or telemetry contracts for this feature.
- Fail closed per source and per zone. No provider, git or model error text
  reaches the renderer; only an app-owned status and reason.
- Follow how `agent-git-workflow-service.ts` calls `driver/text/generate` and how
  `utility-text-model.ts` chooses a model; do not add a second generation path.
- Generation must never run from a background timer, at startup, or for a
  repository whose overview is not open.
- No fixed sleeps in Vue tests. Use deferred promises and controlled clocks for the
  rewrite, debounce and 60 second refresh.
- Do not add a chart library. Do not edit `CHANGELOG.md` or `docs/`.

## Open questions

1. Station order. The mockups draw Review before CI, which fits approval followed
   by checks before merge. A project that gates review on green checks would read
   better as CI before Review. Pick one order, or derive it from branch protection.
2. Spend. The plan writes the narrative automatically while the page is open, at
   most every 15 minutes. The alternative is an opt-in setting under Workflows.
3. Sessions. Agent sessions feed the narrative as evidence only and are not drawn
   on the page. Confirm that is enough for the "sessions run against this project"
   part of the original brief.

## Progress and learnings

Built on `feat/project-overview` to the redesigned plan:

| Checkpoint | State |
| --- | --- |
| Contract, flow policy and narrative grounding (`core/src/project-overview.ts`) | Done |
| Git reader: base history, branches in flight with timing and change size | Done |
| GitHub issues, open pull requests (draft and review decision) and pipeline runs | Done |
| Flow built in the daemon from branches, agents, pull requests and pipelines | Done |
| Narrative: evidence builder, writer with one retry, 15 minute interval, fallback engine, store | Done |
| `project/overview/get` and `project/overview/narrative/refresh`, routed to the owning host | Done |
| Desktop bridge: both channels, preload, main handler | Done |
| Renderer: page, narrative and flow zones, live refresh, shell surface, repository menu entry | Done |

Verified: `npm run lint` (architecture, every workspace typecheck, CSS, i18n, dead
code) and the focused suites for every boundary in Test strategy.

Not done or not verified:

- No check in the running app. The page has only been exercised through rendered
  tests; layout, the token animation and both themes need a live preview.
- No narrative has been written by a real engine. Prompt and grounding rules are
  tested against scripted replies only; check the writing by hand on real
  repositories and capture one evidence document with its accepted narrative.
- The 85% coverage gate and the renderer's browser project have not been run.
- GitLab and Linear reads, the command palette entry and the sidebar row (phase 2).
- Live refresh follows agent status changes and the one minute timer; it does not
  yet react to git state events.
- Station order and narrative spend follow the plan's defaults; the open questions
  above are still open.

Learnings:

- The first design reported the upstream data back (tiles, lanes, tables). Review
  feedback: too busy, no narrative. The page must interpret, in a few sentences, and
  show movement, not inventory.
- GitHub drivers address repositories as `owner/name`, while the workspace origin
  resolves to `github.com/owner/name`; the manager converts at its boundary.
- `handleMessage` rejects when a local handler throws; assert with `rejects`.
- Squash merges leave no merge commit, so "merged branches" evidence undercounts
  them; pull request data covers the gap when a code host is connected.
- The Cursor engine has no utility text model, so it cannot write the narrative.
- A narrative that cites figures is only safe when the facts already state them the
  way a person would say them ("about 26,000"), so the engine can repeat a figure
  exactly and the check can be a plain match.
- The evidence key must leave out anything that moves with the clock (ages, the
  current flow), or an idle project looks stale every minute.
- Dead-code lint flags exported types nothing imports; keep helper types local.
- A fixed 30-day window left quiet repositories with nothing to write about. The
  lookback is now chosen from the repository's own history, so the git reader
  returns the whole bounded base history and the service picks the window.
