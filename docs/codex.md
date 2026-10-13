# Codex Integration

Korus talks to Codex through `codex app-server`, and only from `daemon`. Electron
forwards app-owned RPC and fans events out; the renderer never imports generated
Codex types, spawns Codex or touches `CODEX_HOME`. Read this before changing Codex
conversation state, rendering, actions, history or transport.

## Ownership

The local `codex-app-sdk` owns: executable discovery, generated app-server types,
request/response inference, bidirectional routing, stdio JSONL framing, targeted
conversation operations, snapshots and reducers, optimistic submissions, history
reconciliation, queues, turn mutations and the generic conversation UI
(`CodexConversationPane`). `daemon` is the product adapter: explicit executable
selection, initialization metadata, agent/session policy, approval presets, the
routing envelope (agent, thread, revision) and recovery.

- Generic Codex conversation behavior missing or wrong? Fix it in the SDK and
  consume it. Product policy never goes into the SDK to make a Korus call compile.
- Korus must not add a parallel message store, optimistic row, history or queue
  reducer, or turn-mutation state machine. Korus's own admission queue (whether a
  prompt starts now or waits for the agent) is coordination state, distinct from the
  provider-native queue in the SDK snapshot, and must not be substituted for it.
- Agent text keeps the app-server's optional `commentary`/`final_answer` phase.
  Only app-server reasoning summaries are kept, never raw reasoning content.
- The TypeScript `codex exec` SDK is not an integration boundary; app-server is,
  because the product needs thread list/resume, steering, approval routing, turn
  diffs and server-initiated requests.
- Unimplemented server-initiated request types log `not implemented` and answer a
  JSON-RPC error so app-server never waits forever; unhandled notifications are
  logged. Optional questions do not hold an agent in `awaitingInput`, which is
  reserved for blocking requests and approvals.
- **Readiness is not outcome.** A native thread-idle update releases readiness and
  queued prompts but never fabricates `turn.completed`. Durable task results stay
  provisional until the submitting turn's authoritative terminal event; a late
  terminal event belongs to its original turn and cannot clear a newer active turn.

## Process And Home

- Executable selection uses the host's discovered PATH, including login-shell and common
  user bin directories for GUI launches, unless an explicit backend
  `codexBinaryPath` override is saved. Korus supplies an explicit command to
  the SDK rather than enabling app-bundle fallback. Welcome and Settings link to
  official installation documentation; the backend rechecks external installs
  and refreshes a newly available driver without installing or updating a CLI.
- Codex is an external prerequisite; development, packaging and release checks
  do not download or pin the CLI. The app packages its own Node runtime and daemon.
- `CODEX_HOME` is always `$APP_HOME/codex-home`, ignoring any inherited home. Skills
  and plugins sharing, isolation and the roster-reset rules are in
  [architecture.md](architecture.md#provider-homes). Folder-changing actions restart
  `daemon` and need idle chats. Never copy normal Codex thread or auth files.
- Process-wide app-server overrides enable memories and streamed patch events, and
  disable the bundled unified Computer Use plugin (Korus's own MCP tools replace it)
  and the curated GitHub/Linear plugins ([mcp.md](mcp.md)).
- Authentication goes through the SDK account surface: signed-out renders a landing
  gate; browser login (local) or device-code login (SSH host, with its exact login
  ID for cancellation) is SDK-driven. Korus never implements token exchange, copies
  credentials or owns refresh, and raw account types never reach the renderer.
- Shutdown: Electron allows `daemon` 15 s; the SDK closes app-server stdin first so
  provider history flushes before bounded signal escalation.

## Threads And Agents

Codex owns history and thread storage; Korus maps team, agent, folder, display name,
status and `backendSession { kind: "codex", threadId }`. One app-server hosts many
threads, routed by `threadId` and `agentId`.

- A persisted session is resumed with `thread/resume` before the next turn; new
  agents use `thread/start` and set the conversation title to the agent name
  (matching titles are a no-op; renaming the agent renames the conversation).
  Active sessions are SDK-memory-authoritative and are not re-resumed on selection;
  after relaunch `agent/conversation/load` rebinds the persisted reference.
- Archive/reconcile/resume rules are in
  [architecture.md](architecture.md#backend-seam). Resume searches active and
  archived catalogs with the agent folder as exact `cwd`; `storageState` marks
  archived rows; a failed load rearchives the target and restores the current runtime.
- Fork (agent- or turn-level) calls the SDK conversation handle's `fork()` /
  `forkTurn()`; raw fork types stay out of product contracts. It requires an idle
  agent with an existing conversation and creates a new selected agent below the
  source.
- Worktree delegation forks through the same SDK handle with the worker's cwd,
  model, effort, service tier, permissions and extension context. A running
  source forks at its last completed turn; without a completed boundary it
  falls back to a fresh handoff. Worker instructions explicitly bind the current
  identity and folder so inherited parent assignments cannot redirect execution.
- **Compress Session is session rollover, not Codex compaction.** For an idle agent:
  ask the SDK conversation for a bounded handoff with a temporary fast model/effort
  override, wait for that exact turn, create a replacement conversation in the same
  folder with the original settings, send the handoff inside a real initial prompt
  (the SDK strips its `<context>` block from the visible message), and only then
  archive the old thread and update the persisted reference. The handoff turn's
  settings and events are internal and must not change persisted defaults. If
  creation or archiving fails the agent keeps its old thread. Never build a parallel
  handoff transcript or synthetic message.
- Continue on an interrupted turn is a dedicated action that starts a turn with empty
  input after confirming the latest turn is interrupted; it never submits the text
  "continue".
- Review: independent or current-thread rules are in
  [architecture.md](architecture.md#code-review). Review rounds replace the normal
  MCP URL with the review-session URL ([mcp.md](mcp.md)). `review/start` uses inline
  delivery and a different returned review thread ID is a protocol error rather than
  a session move; the `exitedReviewMode` body renders as assistant text.
- Personalization edits `AGENTS.md` (or `CLAUDE.md`) in each provider's configured
  home on the owning host; changes apply when sessions start or resume, never as a
  message in an active turn. Mission contracts and developer instructions are
  applied at session configuration, never injected as user messages.

## Settings And Policy

- **Approval presets** are app-owned shortcuts over thread settings; the renderer
  sees only the preset ID and `daemon` maps it to `approvalPolicy`,
  `approvalsReviewer` and sandbox for `thread/start|resume` and live updates. Do not
  reuse them for Claude's permission modes. Before applying one, `daemon` reads
  `configRequirements/read`: a disallowed preset clamps to the best compatible
  (`approve-for-me`, `ask-for-approval`, `full-access`), and if none fits `daemon`
  omits approval/sandbox overrides and lets app-server use its effective
  configuration rather than sending a known-invalid request. The generated
  `SandboxPolicy` shape is returned directly.
- **Models and effort** come from `model/list` (never hard-coded), adapted to
  `BackendModelOption[]`. An explicit picker choice is saved immediately in
  `backendDefaults` as user-selected and later thread events cannot replace it; each
  prompt captures model, effort and service tier in its options, including queued
  ones. The service tier (Fast mode) is emitted with thread settings, including an
  explicit `null`, so a stale toggle never survives an agent switch or reload.
- **Skills** are folder-scoped (`skills/list` per agent `cwd`), adapted to
  `BackendSkillSummary[]`. `$skill` mentions resolve against the active catalog and
  are sent as `skill` input items beside the text, not left for Codex to infer.
  `skills/changed` becomes `skills.changed` and invalidates folder-keyed caches.
- **Composer commands:** `@` files, `$` skills, `/` commands then skills. `/compact`
  (bare, menu action or Command-K) opens Compress Session; `/compact <text>` is an
  ordinary prompt. Bare `/review` opens Korus's review setup without a visible turn
  (same for Claude); `/review <text>` calls `review/start`. `/plan` toggles composer
  Plan mode (bare, or with a prompt submitted as `planMode: true`). `/goal` mutates
  thread metadata without a turn (`/goal clear` works while busy;
  pause/resume are unsupported).
- **Plan mode** uses `turn/start.collaborationMode`. It must be sent even without a
  selected model (`daemon` omits `settings.model`, uses the Plan preset's `medium`
  effort and `developer_instructions: null`). Because Codex persists the mode,
  leaving Plan mode must send `mode: "default"`; omitting it keeps the thread in
  Plan.
- **Plans:** `turn/plan/updated` is the structured execution plan (complete only when
  every step is, finalized as incomplete/interrupted/failed at `turn/completed`).
  `item/plan/delta` drafts a proposed plan (experimental); the completed `plan` item
  is authoritative and overwrites the draft. Raw response messages are diagnostic
  only, and plan Markdown never renders as assistant text. Plan preview actions:
  Confirm exits Plan mode and sends `implement the plan`; Cancel exits and sends
  nothing; Comment keeps Plan mode and sends the inline comments as a refinement.
- **Goals** are durable thread metadata; the goal shelf and pending-goal pill are SDK
  UI. `thread/goal/*` notifications become app-owned goal events.
- **Usage:** context occupancy is `last.totalTokens / modelContextWindow` (`total` is
  cumulative and can exceed the window; cap displayed numerators).
  `account/rateLimits/updated` is a sparse, account-level update emitted
  opportunistically during streaming, so `daemon` persists the latest value.
  Banked resets use a dedicated, bounded account read through the optional public
  SDK rate-limit surface. Their authoritative decimal count and optional bounded
  details and account credit balances are settings-only responses, never workspace
  snapshots or telemetry. Opaque credit IDs stay in the driver; temporary
  account-bound references identify confirmed redemption selections. Uncertain
  attempts retain their idempotency key, including renderer reloads. Account
  changes invalidate selections and pending operations. Quota notifications do
  not trigger banked-reset reads; confirmed outcomes trigger a fresh account read.
- **Compaction:** the SDK converts the `contextCompaction` item (and the deprecated
  `thread/compacted`) into provider events; Korus transports them and never
  synthesizes its own lifecycle.

## Server Requests

`daemon` stores each pending request, emits an app-owned prompt event and resolves or
rejects the server request when the client answers. MCP approval maps to
`confirm_tool` ([mcp.md](mcp.md)). `item/tool/requestUserInput` maps to an `ask_user`
request (stable question IDs, options, multi-select, secret flags); user
cancellation answers an empty map so app-server does not wait. Generated types live
in the SDK; never encode tool calls as id8-style `<tool>` text tags.

## Tests

Integration tests use a typed fake Codex SDK surface with the real Korus driver,
adapter and server; the SDK repository owns app-server transport and
conversation-reducer tests. A real app-server smoke test is opt-in behind an
environment variable. See [testing.md](testing.md).
