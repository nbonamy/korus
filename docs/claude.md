# Claude Code Integration

Korus drives Claude through the official `@anthropic-ai/claude-agent-sdk`, only from
`daemon` (`backend/src/claude/`). The SDK launches Claude Code with its native
settings, skills, hooks and project instructions; Korus never calls the Messages API
or replaces Claude Code with a generic model loop. Read this before changing
Claude sessions, history, permissions or capabilities. Dated runtime evidence and
unsupported cases are in
[research/claude-capabilities.md](research/claude-capabilities.md); read it before
adding steering, forks, goals, turn mutations or context controls.

## Session Model

- Each live session owns one long-running SDK query; later turns use its streaming
  input rather than a new process per prompt. A persisted agent without a live query
  resumes through the SDK `resume` option. At most one idle live query is kept per
  agent: switching conversations releases the previous one, and an identity,
  instruction, MCP or permission-safety change restarts and resumes it so stale
  configuration cannot leak into later turns.
- The transport configures the Claude Code system-prompt and tool presets, user,
  project and local setting sources, the agent's folder/model/permission mode, the
  Korus MCP server and its allow rule ([mcp.md](mcp.md)), and partial streaming
  events. Prompt and developer text travels over the SDK input stream and is kept
  out of process logs. The executable is launched directly, not through a shell;
  the shared runtime resolver supplies the login-shell executable and child PATH
  because GUI-launched Electron can inherit a different environment.
  An installed CLI takes precedence over the SDK-owned native runtime packaged with
  Korus; source development can use the SDK optional dependency directly.
  `APP_CLAUDE_COMMAND` overrides resolution without falling back if it is broken.
  Detection, queries, authentication and version inspection share this policy.
  The packaged runtime updates with Korus, not through a CLI package manager.
- The Claude conversation host is the sole owner of the normalized transcript. It
  maps SDK stream messages to immutable `ClaudeConversationEvent`s, keeps one
  snapshot per agent and publishes a bounded reset plus revisioned deltas
  (`claude.conversation*` frames). `AppSnapshot` never contains Claude messages.
  Conversation refreshes republish the open live session; transcript history is read
  only when no live session exists, and an in-flight history read cannot replace a
  session started meanwhile.
- A shared semantic adapter turns tool use (Bash, Read/Write/Edit/Glob/Grep, web,
  Skill, MCP, and tools such as todos, tasks, subagents and worktrees)
  into app-owned titles, paths and statistics for both live and historical
  records. Read/Write/Edit/NotebookEdit also emit file activity so file links and
  Git status stay current.
- Native Agent/Task executions project into the shared subagent tree, including
  completions after the parent turn ends. Child transcript reads carry the parent
  session and child ID; sidechain messages stay out of the parent's conversation.
  Cold history rebuilds children from structured native tool results and marks
  unfinished workers interrupted when their owning query is gone.
- Tool rows reach the renderer as the same status descriptors Codex produces, so
  both providers read alike. Simple read-only shell commands (`cat`, `ls`, `rg`,
  and similar) are classified into read, list and search; anything with shell
  syntax or an unrecognized flag stays a plain run, because a wrong summary is
  worse than the literal command. Tools with no file or command shape carry a
  `scope` and `operation` in the descriptor, and the renderer owns the wording.
  A tool the adapter does not know falls back to the SDK's generic title.
- **Outcome ordering.** Explicit interruption is reported before failure, and
  failure before success. An error result or unexpected iterator end emits a failed
  outcome even after a durable task result was submitted (that result stays
  provisional). An asynchronous interrupt callback settles only its own turn and
  cannot clear a newer one on the same session. Readiness and task success are
  separate.
- Text has no work/final phase and stays unphased; Korus does not guess a
  final-answer boundary.

## Homes And Authentication

- Korus honors one process-wide `CLAUDE_CONFIG_DIR` for SDK queries, transcript
  hydration, Resume discovery, personal skills and plan streaming; per-query
  overrides are unsupported. Startup applies the persisted home. Defaults, sharing,
  isolation and roster-reset rules are in
  [architecture.md](architecture.md#provider-homes).
- **Leave `CLAUDE_CONFIG_DIR` unset for the default `~/.claude`.** The CLI treats
  setting even that same path differently for credential lookup, so auth checks, SDK
  child processes and displayed login commands must agree; local authentication
  returns a null `configDirectory` for the default. Keyless Console profiles live
  outside `CLAUDE_CONFIG_DIR` and are not isolated credentials.
- Credentials stay Claude-owned: Korus never copies tokens or settings, and they
  never enter IPC, snapshots or renderer state. Login is `claude auth login
  --claudeai` (subscription) or `--console` (API billing) run by the user on the
  owning host, including SSH hosts, which each authenticate their own home. Login
  commands use the selected executable path, so a separate CLI install is optional
  on desktop. Expired logins are renewed by Claude Code, not Korus.
- Authentication failures emit `provider.authenticationChanged` with
  credential-free metadata; the daemon updates its observation and publishes
  immediately, leaving enablement and existing conversations intact (service errors
  and usage limits do not imply logout). Before admitting new work the daemon
  re-probes an engine last seen disconnected, so an external login makes the next
  retry succeed. This is not continuous polling.
- Subscription usage is fetched on demand by `daemon` from the CLI-internal
  `api.anthropic.com/api/oauth/usage` endpoint (needs `user:inference` and
  `user:profile`) using the configured home's login in place. It is not a stable
  public API: errors are bounded and reported separately from accounts without
  quotas, and API-key billing has no usage row.
- Installation is user-managed. Welcome and Settings link to Anthropic's official
  instructions and can recheck PATH on the owning host without running an installer.
  Discovery adds `~/.local/bin` for non-interactive SSH launches.
  Onboarding offers both engines independently and needs at least one authenticated.

## History And Resume

Transcripts are read from Claude Code's JSONL files at
`<home>/projects/<project-dir>/<session-id>.jsonl` (project dir is the absolute
folder with non-alphanumerics replaced by `-`; `sessions-index.json` can point to
the file), not through the CLI. Only displayable records are read: user text,
assistant text, tool use/result (same adapter as live), and structured `goal_status`
records. Queue operations, `last-prompt`, sidechains and meta command records are
ignored. Hydration also restores the latest model and effort, falling back to the
agent's last used.

The host opens the newest history window and prepends older pages through the
driver history seam. Each page has both a message-count and serialized-byte
budget; pages use immutable message/turn identities from one normalized transcript
read, so appends cannot move the older-history cursor. Cold reads still parse the
native file on the owning backend; the retained history and cursor are ephemeral
and cleared on release or session replacement. Reads overtaken by a newer load,
release, or live turn cannot replace that conversation.

Oversized message content stays on the owning host behind an agent/session-scoped
content reference. The conversation carries a preview; explicit reads retrieve the
exact message JSON in bounded base64 chunks, including duplicated native tool
fields and Unicode. Content updates invalidate superseded references. Clients
render fetched content locally and never put it back into provider snapshots.
History prepends and context updates are revisioned deltas. Reconnect snapshots
contain a bounded recent window rather than accumulated scroll-back pages; the
companion forwards older-page frames directly and rechecks authorization after
content reads.

A long conversation never travels whole: the daemon opens the most recent rows within a
byte budget (so one event stays far under the 4 MiB limit and a phone never receives a
frame it cannot take) and prepends older pages on demand. A row is shown as it is. Only a
part that is huge on its own (a screenshot, a file dump) is cut to a preview, and a row
that would still not fit is cut part by part, never dropped. The exact row stays readable
by content ID in bounded chunks. The desktop pane reads a cut row in the background as it
appears and shows nothing to press: a row too large to be worth reading keeps its preview,
as does a client that cannot read content, such as the phone.

**Canonical cwd gotcha:** Claude stores the resolved path (`/tmp` is
`/private/tmp` on macOS), so history and Resume discovery check both the logical
and the resolved path, dedupe session IDs, and keep reads working for removed
workspaces. Resume lists an agent folder's sessions newest first, returns opaque
`ConversationSummary` rows, and is allowed only while the agent is idle.
Folderless Quick Chats use the home directory as cwd (user skills only) and keep a
null folder reference.

## Capabilities And Policy

- **Scheduling:** sessions connected to Korus exclude Claude's native cron and
  wakeup tools through SDK `disallowedTools`. Recurring prompts use Korus's
  persisted automations and require an explicit user request ([mcp.md](mcp.md)).
- **Models:** local aliases `opus`, `sonnet` (default), `haiku` until a short-lived,
  non-persisting SDK query reads the live catalog on agent selection; names,
  descriptions and supported efforts come from the SDK, so the effort selector
  appears only for models that advertise it. Effort is passed on the first turn and
  updated later via the runtime settings API.
- **Speed:** models advertising native fast-mode support use the shared speed
  selector. Speed changes resume the native session in a new query, since the SDK
  requires launch-time opt-in. Managed/account restrictions remain authoritative;
  explicit fast-mode unavailability fails before prompt submission. Usage stores the configured
  tier, not a guarantee that every request avoids a provider cooldown.
- **Permissions:** Claude's own modes (`default`, `acceptEdits`, `dontAsk`, `auto`,
  `bypassPermissions`) are exposed through a capability-driven submenu and routed
  as opaque mode IDs the driver validates against what it advertises;
  `bypassPermissions` also sets the SDK's dangerous-skip gate. Native `plan` stays
  behind the separate Plan control. These are distinct from Codex approval presets.
  Permission callbacks and `AskUserQuestion` normalize into the provider snapshot
  and project into the composer's `confirm_tool` requests using the exact
  transcript part ID; responses use the agent-targeted client-response path.
- **Plan mode** is `planMode: "prompted"`: the driver keeps the prompt unchanged and
  starts the turn with native `permissionMode: "plan"` (not the `/plan` slash
  command, which is unavailable in some SDK environments). `EnterPlanMode` and
  `system/status.permissionMode: "plan"` mark planning; the private plan-file
  `Write` streams as `turn.proposedPlanDelta` and is not rendered as a tool;
  `ExitPlanMode.input.plan` becomes `turn.proposedPlanCompleted`. The app-owned
  agent plan is the source of truth, not Claude's file. Comments keep Plan mode and
  send a follow-up; confirming clears it and sends the implementation prompt.
- **Task lists:** confirmed native Task tool results and legacy `TodoWrite` updates
  project into the existing execution-plan panel. Task IDs come from structured
  results; failed operations do not advance progress. The Claude host retains the
  session's task projection, rebuilds it from native history before paging, and
  transports the resulting plan with conversation frames. Proposed-plan review
  remains separate. Sessions opt into native todo tools for progress display.
- **Attachments:** supported images, PDFs and text/source files go as native content
  blocks; other binaries are available by trusted local path.
- **Context and compaction:** usage comes from `getContextUsage()` after init, turns
  and compaction, plus a short-lived non-persisting query when a persisted
  conversation is selected. `/compact` is Claude-owned and routed silently;
  boundaries are restored from history and reuse the common compaction lifecycle.
- **Skills:** listed from the filesystem (user skills under the configured home,
  project skills under `<folder>/.claude/skills`, project overriding global,
  symlinked directories followed, broken links skipped).
- **Goals, steering, same-folder forks, resume:** implemented. Steering is
  boundary-dependent, not an immediate interrupt; the transport owns queued input
  until the SDK replays its UUID and the work completes, and stopping a steered turn
  closes its query. Fork cutoffs come from persisted native boundaries; goal state
  comes from structured `goal_status` records, with clear distinct from completion.
- Worktree delegation uses the SDK's native session fork in the source store,
  then resumes the child query in the worker's folder with its own model,
  permissions, system appendix and MCP identity. A running source is cut at its
  last completed live native boundary; without one it starts a fresh handoff.
  The persisted session keeps its native transcript folder separately from the
  execution folder; reads, further forks and deletion use that storage reference.
  Interactive same-folder forks retain their idle-source guard.
- Rollback, edit, retry and delete-turn stay unsupported; enabling any further
  control needs evidence at the SDK and driver boundaries first.
- **Code review** defaults to a separate visible reviewer in the same workspace
  ([architecture.md](architecture.md#code-review)). Inspection turns must call
  `finish_review_round({ findingCount })` and Korus waits for the turn to end;
  native `ReportFindings` calls do not populate the ledger.

## Tests

`configured-home.spec.ts` covers restart, history and resume routing, symlinked
skills, private plan streaming and real SDK deletion against temporary homes. Its
scripted queries prove Korus routing, not browser login or live-model persistence;
verify those against a real Claude Code install. Normal tests use a fake SDK query
([testing.md](testing.md)).
