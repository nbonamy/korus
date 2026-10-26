# MCP Servers

Korus runs local MCP endpoints inside `daemon` for agent collaboration and for
credentialed access to provider-hosted MCP servers. They are app surfaces, not
Codex-specific: every provider gets the same endpoints through session-local
configuration, and each driver translates only that into its native launch
contract. Tool schemas and descriptions are the reference for individual tools
(`backend/src/mcp/`); this document records the model around them. To add a tool,
read [custom-tools.md](custom-tools.md).

## Boundary

- `daemon` owns the server, collaboration state and tool effects. Electron main
  never starts it; it only receives app-owned backend events or client requests
  for desktop effects. The renderer never calls MCP.
- Only advertise tools backed by real Korus product capabilities, and never
  filesystem, worktree or process-control tools the product does not own.
- Streamable HTTP on loopback, ephemeral port, JSON responses, started before
  provider drivers so sessions receive a valid URL. `POST /mcp` only: the server is
  stateless per HTTP request while a process-local coordinator owns collaboration
  state, so `GET`/`DELETE /mcp` are rejected.
- All providers see the server as `product.mcpServerName` (`korus`). Claude Code
  reserves `workspace` and silently drops a dynamic server with that name; tool
  presentation still recognizes `workspace` for retained history. Allow rules,
  review prompts and instructions use the same namespace.

## Enablement And Identity

Backends receive the server through request- or session-local configuration, never
by mutating user-global tool config.

- The caller is identified by `?agentId=<id>` in the agent-scoped URL. Tools infer
  it; models never pass their own agent ID or `from`. The same ID is injected into
  developer instructions and returned by `list-agents`.
- **Codex:** `thread/start|resume` config sets `mcp_servers.korus.url` and
  `default_tools_approval_mode = "approve"`, scoped to Korus tools; the rest of the
  session keeps normal approvals.
- **Claude:** the Agent SDK gets the same URL in `mcpServers`. Korus approves
  `mcp__korus__*` in its `canUseTool` callback rather than the SDK's `allowedTools`
  option, which would bypass the callback for other tools. Hosted servers keep
  their normal permission flow.
- **Antigravity:** the daemon selects native `allow_once` for MCP calls whose
  metadata identifies the session-supplied Korus server. Questions, built-in tools
  and other servers keep native approvals; tool titles never establish trust.
- `daemon` appends developer instructions with the agent's ID, name and folder and
  the workflows models do not reliably infer from schemas. They distinguish
  engine-native subagents (inside the Codex/Claude session) from Korus co-agents
  (`create-agent`); ambiguous requests to delegate require a clarifying question.
- App-owned procedures are bundled Markdown skills, loaded on demand through
  `read-skill`. Its response carries the full procedure in both text content and
  `structuredContent.markdown`, so clients that prefer structured results still
  deliver the instructions. The body is not injected separately. Injected
  instructions contain their catalog and essential policy,
  not full skill bodies or filesystem paths. The reader serves only registered
  names and rechecks tool-module availability, feature enablement, active review
  context and the caller's Mission stage. It cannot read personal skills or
  arbitrary files. Workflow skills named by
  tools need not add entries to every agent's baseline catalog. Loading a skill
  grants no permission to perform its actions. The daemon bundle carries the same
  content
  on desktop and remote hosts, independent of provider filesystem permissions.
- Codex approval of an MCP tool call arrives as `mcpServer/elicitation/request`.
  Korus never auto-accepts it: it becomes a `confirm_tool` request, resolved by the
  user (`allow`, `allow_conversation` and `always_allow` map to `accept` with
  `_meta.persist` of none, `session`, `always`; `deny` to `decline`).

## Collaboration Model

- Visibility is team-scoped (agents without a team see other no-team agents).
  Ambiguous recipient names fail with the visible IDs, names and folders so an
  agent can recover after compaction; errors are `isError` results with plain text.
- Messages are delivered as normal backend prompts, not as a "check your inbox"
  instruction. An idle recipient starts a turn; a busy recipient is steered when the
  provider supports it, otherwise the message waits in the visible prompt queue
  (owned by `daemon`) and all pending messages drain into one delivery after the
  turn. `check-messages` is manual recovery only.
- The delivery prompt carries a versioned, JSON-encoded envelope between stable
  marker lines (`<<<APP_AGENT_MESSAGES_V1>>>`). The renderer parses only the
  envelope, so delivery guidance can change without breaking sender labels; it also
  still recognizes the earlier prose envelope in hydrated history.
- Inbox and connection state is process-local and bounded. Durable collaboration
  history, if ever added, is app state and never a copy of provider transcripts.

### Status, flags and completion

- `set-status` stores a short `statusText` (cleared when the provider turn
  completes), emits `agent.updated`, and may carry the start `announcement`. Stable
  instructions make it the first action of a task.
- `finish_turn` is the last tool action of a substantive turn. It always clears
  status; optionally sets one flag (`delegate_to_worktree`, `ready_for_review`),
  a finish announcement and a celebration. A flag replaces the current proposal;
  omitting it leaves it. A new user prompt clears `ready_for_review` only. A failed
  flag action stays available for retry. Instructions forbid choosing
  `delegate_to_worktree` and then continuing the work, and require assessing review
  readiness at every handoff (omit it when review is deferred or the user asked for
  immediate commit/push). Flags are persisted app state cleared with the
  conversation runtime.
- Prompt suggestions are agent-scoped Korus metadata, not provider conversation
  state or draft text. The renderer uses the SDK's placeholder contract; a
  suggestion never authorizes or submits work. Suggestions reuse the active
  model's finish-turn call rather than invoking a separate model.

### Delegation

- `create-agent` creates a Korus co-agent in the caller's team without selecting it,
  optionally with an isolated worktree, and stays pending until the new agent
  accepts its initial prompt. `prompt` is the concise visible request;
  `instructions` supplements canonical task references with missing context,
  decisions and delivery constraints, prepended inside an escaped `<context>`
  block (presentation separation, not secret storage: both stay in the transcript).
  Model and effort inherit from the caller only for the same backend; another
  backend uses its own defaults. Target-provider saved approval settings apply
  before the initial prompt; explicit or inherited model selections override
  model defaults without replacing that approval policy.
- With a `task` contract (`title`, `doneWhen`), a stable parent-scoped `requestId`
  is mandatory and reused after a timeout. Returned `taskId`/`agentId`/status
  describe accepted startup, not completed work.
- `complete-task` (worker, before `finish_turn`) saves a provisional result that
  finalizes only after that exact turn succeeds. `wait-tasks` (`any|all`, 0–30 s)
  ends on completion, failure, cancellation, interruption or needs-input; a timeout
  leaves work running. `cancel-task` interrupts only the recorded execution.
  Unrelated agents cannot read, complete or cancel another's tasks. Guarantees and
  retention are in [architecture.md](architecture.md#durable-delegated-tasks).
- `create-project` exists only for Quick Chats and reuses the New Project service;
  a later failure leaves the created folder or agent for recovery.
- Agent closure is authorized by the owning daemon against the authenticated
  caller and the persisted `delegatedByAgentId` link, which follows parent handoff.
  Only the creator can close an idle worker without pending prompts, requests or
  unfinished durable tasks. The shared close lifecycle retires its conversation
  and removes it from the roster; worktrees, branches and task records are retained.
  User-initiated closure remains unrestricted by agent ownership.
- `display-markdown` takes exactly one of `path` or `markdown`. Paths must resolve
  inside the caller's folder, be regular files and fit the preview limit (renderer
  previews, by contrast, accept paths outside the agent folder).
- `update-work-item` changes the caller's own assignment status (`blocked` requires
  a note). Automation completion is owned by the scheduled conversation's turn,
  not by work-item status.

### Scheduled prompts

`create-automation` uses the same persisted automation definitions and scheduler
as the UI. It is available to local agents and Quick Chats, excluding managed
review and Mission workers. Targets stay within the caller's team. Existing
conversations retain their backend, model, effort and approvals; overrides are
accepted only for new Quick Chats. Caller-scoped request IDs make retries
idempotent, and success means the schedule was saved, not that its prompt ran.

Descriptions and injected instructions require an explicit user request and
direct Korus scheduling to this tool rather than other schedulers. This is
model-facing policy, not independent consent verification. Calendar requests use
an RRULE and IANA timezone through the same recurrence module as the UI and
daemon; elapsed intervals are a separate choice. The response includes the next
occurrence. Missed occurrences coalesce into one catch-up run when the daemon returns.
Claude sessions connected to Korus disable native cron/wakeup tools through the
SDK's tool-denial option; Codex uses the scheduling instructions without a
native-tool suppression claim.

### Automatic review

`start_automatic_review` creates an independent reviewer without selecting it and
returns `reviewId`/`reviewerAgentId` once startup is persisted. It is not offered to
Quick Chats or review agents and nested or duplicate reviews are rejected. Scope is
`uncommitted` or `branch` with `baseRef`; provider, model and effort default to the
caller's (another provider uses its own defaults); `maxPriority`/`maxRounds` fall
back to saved settings and `autoCommit` is always false unless explicitly
requested. Descriptions and instructions require an explicit user request (and
separate authorization for local commits); generic review/ship requests, teammate
messages and readiness are not authorization. This is model-facing policy, not
consent verification. After launch the agent stops editing the reviewed files and
does not relaunch to poll.

Each review session gets a stable URL derived from its durable session ID (provider
conversations may retain their initial MCP config) adding `report_finding`,
`update_finding`, `delete_finding` and `finish_review_round`. They mutate the
persisted ledger before returning and are model-only; user decisions are backend
commands. Finding updates reject unknown arguments before mutating the ledger;
provider-native finding tools do not populate it. Tool deferral belongs to the
provider: review prompts require schema discovery before calls when schemas are
deferred or absent, rather than changing provider-wide discovery behavior.
`finish_review_round({ findingCount })` must equal the round's saved
finding count across all priorities (zero must be confirmed explicitly); a mismatch
errors and tells the model to reconcile via `report_finding`. A later finding
mutation invalidates an earlier acknowledgment, restarted inspections need a fresh
one, and the acknowledgment alone does not advance the workflow: the provider turn
must also end successfully. A missing confirmation fails the round and pauses
automatic mode.

## Contextual Tool Families

Registered per authenticated request by independent modules
([custom-tools.md](custom-tools.md)).

- **Visualize** tools are advertised from session start because providers may cache
  tool catalogs, but calls are accepted only while the agent owns an open Visualize
  session for its current conversation. Instructions say tool availability alone
  does not activate Visualize. Mermaid is limited to the families `beautiful-mermaid`
  renders (flowchart, state, sequence, class, ER, XY); other types use SVG, and
  unsupported Mermaid is rejected before it reaches durable state. Generated-image
  inputs must resolve inside the generated-images root (10 MiB cap); snapshots keep
  only the relative path, MIME type and alt text. Source-diagram replacement is
  last-write-wins; **editable canvases require an expected revision** (a stale
  revision is reread, never blindly retried), validate a bounded edit batch against
  stable IDs before applying, and serialize writes per visualization across agents.
  Whole replacement is rejected once a canvas exists. The view tool reports
  unavailable while a changed scene has no fresh preview.
- **Mission** tools register for authenticated Mission workers by their recorded
  assignments, not current turn or run status, so failed or finished attempts can
  still read artifacts; ordinary agents never receive them. Availability permits
  inspection; backend ownership checks separately control mutations and reject
  stale or superseded attempts. A failed attempt stays recoverable: its worker can
  continue and submit later, and success clears the error. Mission and run IDs are
  inferred from identity, never model input. Implementation workers read their
  explicit ticket assignment through `get-mission-assignment` and submit evidence
  against its stable ticket ID; the daemon owns backlog updates and aggregation.
  Existing full-artifact submissions remain compatible, with assignment errors
  identifying the expected ticket and recovery call. Other stages still submit
  complete artifacts. Mission workers get no generic
  thread-flag tools. Behavior is in
  [architecture.md](architecture.md#missions).
- **GitLab** tools (`gitlab-list-issues`, `gitlab-list-merge-requests`,
  `gitlab-get-issue`, `gitlab-get-merge-request`, `gitlab-comment`,
  `gitlab-create-merge-request`) are implemented in `mcp/gitlab-tools.ts` but
  currently **not registered** (see the commented block in `runtime.ts`). When
  enabled they register while GitLab is connected. They use
  GitLab's REST API with the `api` scope through `WorkIntegrationManager`, so they
  work for direct and CLI connections and do not depend on GitLab's hosted MCP
  server or its group-level access setting. Projects are gitlab.com only and are
  accepted as `group/project`, a URL or a git remote. Reads return bounded text
  (20,000 characters per field, the last 50 human comments); comments are posted as
  the connected user; merge requests are created as drafts from a pushed branch into
  the default branch.
- **Browser:** `browser-open` opens the agent's Browser workspace without changing
  selection and waits for load; other `browser-*` tools operate the sandboxed page
  through `client/browser/open|execute`. The renderer never exposes DOM, cookies or
  screenshots to page scripts.
  Viewport changes reuse the renderer's device controls; the desktop waits for
  the targeted pane to acknowledge layout before reading the guest's actual CSS
  dimensions. Hidden/closed panes cannot report a successful resize. Device presets
  change viewport size only, not user agent, touch input or pixel density.

## Image generation

Non-Codex agents can request raster images through an internal Codex Luna
conversation on the owning daemon. Codex must be enabled and connected. The job
uses the existing SDK conversation operations without creating a Korus teammate
or changing the caller's conversation or model settings. Only media attached to
completed image-generation items is returned; assistant-authored image links
are not generation results.

The tool points agents to the bundled `korus-imagegen` procedure for generation,
asset placement and inline image responses. Its result includes Markdown image
syntax with the actual saved path, so the requesting agent can embed its selected
output in the answer rather than only reading the image or reporting a filename.

The composer offers this procedure as `$imagegen` to eligible non-Codex agents,
alongside their native skills. Its `korus:skill/` catalog path identifies a bundled
MCP procedure, not a filesystem skill. An existing native `imagegen` keeps its name;
Codex retains its native image-generation skill.

The daemon saves images with unique filenames under the app-owned Codex home's
generated-images folder and returns image content with those paths. Provider file
results must resolve inside that folder. Project assets are copied into the
workspace by the requesting agent. Cancellation interrupts the internal turn,
and completion or failure deletes its conversation.

## Mobile Simulators

The provider-independent simulator tool routes authenticated caller identity through
`client/mobileSimulator/execute` to Electron's local device service. The pane uses
the same service through typed preload IPC. It is unavailable on web hosts and to
remote agents. Attaching, from the pane or through the tool, needs no prompt: the simulators are local
to the user's own machine. Either grants one agent an exclusive attachment;
input and observations require its opaque attachment ID. Detach, shutdown, agent removal,
backend disconnect and desktop shutdown revoke that authority. `shutdown` powers the
attached device off and is available to its owner; rotation is pane-only. An agent's
attach opens the pane and its detach or shutdown closes it, while the user's own
detach or power-off in the pane leaves it open. Otherwise devices remain running and
their data is never erased as cleanup.

The visible pane uses a native video stream and continuous touch input through
an attachment-scoped view lease. Electron keeps only the latest frame; the renderer
has one outstanding read and coalesces pointer movement without dropping release.
Idle Android screens keep their lease through empty replies. Closing the pane,
changing agents or revoking the attachment cancels capture and releases held input.
Video stays outside provider transcripts and product snapshots.

Agent screenshots remain explicit PNG observations. Input uses observed framebuffer
pixels; the iOS adapter converts pixels to device points. Live Android frames carry
an orientation epoch, so stale coordinates are rejected before input reaches the
physical display. Rotation during a held gesture releases input and requires
reconnecting. iOS accessibility frames remain in UI-oriented points, which can
differ from the raw framebuffer after rotation; locate input in the screenshot. iOS keeps a portrait framebuffer when the
device rotates and draws the turned UI inside it, so live frames carry a clockwise
quarter-turn hint, the pane rotates image and bezel, and live touches use the
upright (displayed) coordinate space.
Android accessibility bounds are pixels. Missing accessibility is reported
explicitly as screenshot fallback. Screen content is untrusted observation.

Xcode and an iOS runtime remain user-installed prerequisites. Korus bundles a
pinned Meta idb companion and speaks its protobuf/gRPC protocol directly over a
private Unix socket; Python, Homebrew and a separate idb installation are not
required. One companion belongs to each iOS attachment. Detach closes the channel,
cancels outstanding calls, and stops only that child. The global idb registry is
never consulted. Native framework compatibility depends on the bundled
companion/Xcode pair; a helper update ships with an app update.

The macOS ARM64 build prepares the checksum-pinned native distribution, runtime
resources, protocol and third-party notices before Forge copies them into app
resources. GitHub Actions owns packaging, signing/notarization and the packaged
helper smoke check. Development uses the same prepared assets;
`APP_MOBILE_COMPANION_PATH` can select an isolated native installation in development
only. Packaged apps always select their own helper. Android uses user-installed
SDK Platform Tools and Emulator. ADB handles device management and agent actions;
the pane uses the emulator's native gRPC video/touch service and installed protocol.
Discovery must match the selected serial, a live local process and the expected
AVD identity, and requires a bearer token on loopback. Physical devices and remote
endpoints are excluded. Korus does not install Xcode, runtimes or Android SDK tooling.

## Computer Use

A local macOS capability exposed through the same server. A signed helper (pinned in
`computer-use-release.json`; local builds via `npm run build:computer-use:local`)
runs under Electron main, which executes it only in response to
`client/computerUse/*` requests; `daemon` never spawns it. Korus and the helper move
together with no compatibility layer. Tools appear only when the user enables
Computer Use in Settings → Plugins; Chrome control is the bundled ChatGPT plugin, not
a Korus tool, and Korus disables Codex's `node_repl` MCP server unless Chrome is
enabled. Instructions require loading `korus-computer-use` through `read-skill` before the first action;
cross-tool workflow lives there, not in descriptions.

Invariants the tool schemas cannot enforce:

- **Explicit window targeting.** Agents pass a session-local `window_id` from
  `computer-use-list-windows` to state, screenshots, focus and every action. There
  is no implicit current-window fallback; a changed window set means list again.
  `window_not_found`, `window_mismatch`, `window_focus_failed` and
  `window_capture_ambiguous` require refreshing the list.
- Observations are full on first read, then per-window diffs by `stateRevision`;
  element indexes are valid only in the selected window and for the latest
  observation (`stale_element` otherwise). A lost observation forces a new full
  baseline; an already-delivered action is **never replayed**, and `actionDelivered`
  survives a failed follow-up observation.
- Coordinate actions use absolute logical screen points, never window-relative
  positions or screenshot pixels. Physical clicks and drags require the target app
  frontmost and unobstructed; AX actions and background typing do not.
- One helper process lives for the session so IDs and diff baselines stay valid;
  every call resets a 30-second inactivity timeout, after which the next
  interaction starts with a fresh observation. Native callbacks have a 35-second
  outer deadline. Normal MCP approval applies per call.

## Hosted MCP Gateway

Provider-hosted servers (GitHub, GitLab, Linear) are reached through a transparent reverse
proxy at `/mcp/providers/<provider>?agentId=…`, backed by a small catalog of public
transport facts (server ID, upstream URL, owning work integration). Connecting an
integration enables its eligible entry; sessions see local servers named `github`,
`gitlab`, and `linear` with the upstream tool names and schemas.

- `WorkIntegrationManager` is the credential authority. The gateway asks it for an
  authorization header on every upstream request, replaces any caller
  `Authorization`, and on upstream `401` rotates the credential and retries
  **once**. A refresh failure marks only that provider as needing reconnection.
- CLI connections supply app-owned operations through `gh` or `glab`, without
  bearer credentials. They do not enable hosted MCP or permit token extraction.
- GitLab MCP requires a direct OAuth token with the `mcp` scope. Settings offers
  explicit authorization with `api mcp`; ordinary repository authorization requests
  only `api`. Register both scopes on the Korus public OAuth application. The daemon
  verifies MCP initialize and tool discovery before publishing its local URL, and
  rechecks eligibility on hydration or Settings retry. GitLab.com additionally
  requires a top-level group that allows MCP client access under Settings → General
  → Permissions and group features. Group and project permissions still apply to
  individual tools. See [GitLab's MCP prerequisites](https://docs.gitlab.com/user/model_context_protocol/mcp_server/).
  GitLab caches group eligibility and invalidates it asynchronously after group
  settings change. A group-denied result can persist after access is enabled.
  Retry the MCP check in Settings after propagation; another OAuth grant does not
  clear GitLab's server-side eligibility cache. See the
  [GitLab eligibility cache](https://gitlab.com/gitlab-org/gitlab/-/blob/master/ee/app/models/concerns/ai/user_authorizable.rb).
- GitLab MCP eligibility is public metadata separate from API connection state.
  Missing scope, group denial, or an unavailable MCP endpoint does not disconnect
  native repository/backlog/MR access or another provider. A cached gateway URL
  checks eligibility again; HTTP permission denial disables only GitLab MCP.
  Permission upgrades retain native credentials and coordinate with their refresh.
  Denial, cancellation, expiry, and a different OAuth account preserve the original
  connection. Cancellation during credential storage restores the original token
  through the serialized token-store boundary. Only the daemon holds grant tokens;
  snapshots and harness configuration contain capability state and local URLs.
- Never configure a provider's remote URL or bearer token directly in Codex, Claude
  or user-global MCP settings: that exposes a rotating secret to the harness and
  prevents safe refresh. Tokens never appear in session config, URLs, tool I/O,
  renderer state or logs.
- Disconnecting disables the entry for future sessions; a running session keeps its
  local URL but calls fail until reconnect. Every request requires a known agent.
- Codex app-server is launched with the curated GitHub/Linear plugins disabled,
  process-locally, to avoid duplicate tool surfaces; the shared Codex config is
  untouched. The ChatGPT GitHub connector is disabled per thread only when that
  thread receives Korus's authenticated `github` proxy, so a missing integration
  leaves the connector as a fallback.

## Tests

Cover each layer a change touches: coordinator contracts (connection, visibility,
messaging, status, errors), Streamable HTTP round trips (listing and calls), gateway
behavior (header filtering, credential injection, session forwarding, one-time
refresh retry), and backend session tests proving the URL and developer instructions
are injected. Add coordinator tests first.
