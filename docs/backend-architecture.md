# Backend Architecture

`daemon` is the Korus product backend: a separate Node process that orchestrates
Codex app-server, Claude Code, Antigravity ACP, the Korus MCP server, git, files,
automations, work integrations and persistent state behind one app-owned protocol. It is not a
replacement for Codex app-server. Ownership rules live in
[architecture.md](architecture.md); message contracts in [protocol.md](protocol.md).

Provider safety stops are terminal conversation errors. The daemon preserves the
provider details and blocked status across restarts, retains unsent prompts, and
stops queue retries, quota continuation and automatic work recovery for that
conversation. Provider history is preserved; the application does not unblock or
rewrite provider safety decisions. An explicit user review can continue only
when fresh provider findings include both an explanation and a continuation
instruction; the backend validates that the reviewed findings are unchanged.

The executable is `korusd` (`product.daemonName`). Source filenames, RPC methods,
log and socket paths, npm scripts and launchd labels stay brand-neutral.

## Design Rules

- Routers validate and route; focused services own stateful workflow (retries,
  timers, persistence callbacks, cleanup). Do not grow a request switch into the
  owner of the workflow it exposes.
- Transport-specific clients own only process or socket lifecycle. One shared
  session implementation owns JSON-RPC framing, pending requests, timeouts and
  server callbacks; never copy lifecycle logic into a second transport.
- Provider setup follows the same split: `ProviderLifecycle` adapters own
  executable detection, home preparation and resource sharing;
  `ProviderSetup` owns locking, serialization, persistence and driver replacement.
  Authentication enters through the optional `AgentBackendDriver.authenticate`
  capability; the server caches the app-owned result and never interprets
  credentials or probes provider CLIs itself.
- Provider updates are backend-owned, per installation and host. Version checks
  never install software; explicit consent is tied to a checked installation and
  target version. Waiting upgrades are process-local and cancellable. The runtime
  scheduler starts them only when the provider is idle; admission is blocked while
  its processes are stopped, updated and replaced. Conversation identities remain
  intact. The original installation method/channel is preserved; unknown or
  unsupported installations use official instructions. No provider is installed
  automatically and no app restart is scheduled. Preferences and queued upgrades
  must not be mistaken for permission to interrupt running work.
- Provider detection and launches share `core/runtime-discovery`: the owning
  host's login-shell PATH precedes inherited and fallback directories. Shell PATH
  output is framed so startup messages cannot corrupt executable selection;
  unavailable shells fall back to inherited PATH. Launches resolve the executable
  and child environment together, preserving explicit executable overrides.
  The desktop's private Node is only a child-PATH fallback. npm ownership checks
  and upgrades run the selected npm CLI with its adjacent Node, never whichever
  Node an app-private PATH happens to select.
- Domain modules never self-register global timers. A runtime scheduler runs
  registered tasks (automation scans, PR monitoring) without overlap.
- Queued prompt delivery removes an item only after backend acceptance; transport
  failure keeps the FIFO head and retries with bounded backoff, without duplicate
  user messages.
- Agent creation (protocol, MCP delegation, independent review) goes through one
  `AgentCreationService`; callers only adapt their input.
- Short text utilities use `driver/text/generate` with the initiating agent's
  provider, prompt, optional instructions and output schema. Callers declare task
  complexity instead of provider model IDs; omission retains the simple tier.
  `utilityTextModel` resolves the tier from that provider's native catalog. A
  missing model is an error; utilities never switch providers, send a conversation
  prompt or change the agent's selected model. Provider hosts own isolated
  generation and cleanup. Cancellable utilities carry request IDs across RPC;
  their owning host maps those IDs to local abort signals. Cancellation targets
  the isolated provider conversation and acknowledges its settlement, independently
  of the agent's main conversation. Diff visualization sets `timeoutMs: null`
  across utility RPC and provider generation to wait until completion or cancellation.
  A separate tools flag opts inspection utilities
  into read-only workspace inspection; omission disables workspace-tool access. This
  policy does not control provider-configured tools unrelated to the workspace.
  Diff visualization supplies the agent's working folder and selected Git scope,
  including section filters. The model retrieves focused evidence through tools;
  patch contents are not embedded in its prompt. Native shapes own their component
  and review metadata; navigation stays limited to files and line ranges present
  in the selected comparison. Role icons resolve to app-owned assets in the
  renderer; fetched marks are embedded as bounded image payloads. The renderer sanitizes
  SVG and retains each saved diagram's image bytes without an external registry.
  The bundled `korus-stack-diagram` skill owns the shared architecture-diagram
  guidance. Visualize loads it through `read-skill`; Polished Diff Viz injects the
  same skill text into its utility request. Caller-specific output and evidence
  contracts stay separate from that visual guidance. Composition targets are
  advisory: usable drawings survive extra components, groups, connections and
  longer labels. Optional review metadata is recovered independently; unsupported
  annotations and out-of-scope links are omitted, and dangling bindings become
  standalone geometry. Rendering and safety constraints still reject unusable
  or unsafe content.
  Polished Viz attaches an app-owned PNG composition reference from the runtime
  assets root. Forge ships it outside `app.asar`; standalone daemon staging and
  SSH installation carry the same file beside the daemon. Utility image inputs
  are host-resolved absolute paths, validated as bounded image attachments before
  provider dispatch, and do not enable workspace tools.
- Repository acquisition and branch-to-agent setup share daemon-owned modules
  across desktop and companion adapters. Access adapters may revalidate a grant
  before each write, but do not duplicate checkout selection or clone-reuse rules.
  Close previews come from the daemon; review availability, reviewer defaults and
  quota eligibility use shared product policy. Mutation handlers revalidate their
  conditions before provider or filesystem side effects.
- Optional operator requirements load from `$APP_HOME/requirements.json` before
  services start, separately from app-written settings. Invalid requirements stop
  startup. Model catalog filtering and provider availability belong to the owning
  daemon; clients consume the filtered results. See
  [host requirements](agent-provider-selection.md#host-requirements).

## Antigravity

`client/backend/src/antigravity` owns installation and discovery of the ACP
runtime/harness, OAuth observations, and the provider replica. The agy CLI is not
the execution path. OAuth renewal stays native, background checks suppress login UI,
and child environments sanitize Google credentials/projects with isolated
`GEMINI_HOME` and temporary storage. Home routing is not a filesystem sandbox.
An explicit installation request downloads a pinned Google-hosted archive into
private temporary storage. Size and SHA-256 checks precede bounded extraction of
regular executable files; an ACP handshake in a disposable home verifies the
qualified runtime before atomic activation. Installation never authenticates,
and runtime binaries remain outside app release resources. Provider setup
serializes installation with home changes and detection refreshes. Discovery
accepts the managed pair, paired executables on PATH, explicit runtime/harness
environment paths, or an existing versioned runtime directory.

Each agent owns a process/session with serialized prompts and bounded cancellation.
Cold replay validates session identity and rebuilds atomically: replay tool IDs
differ and later updates may reverse tool status. Unknown timestamps stay absent;
the private prompt journal preserves presentation metadata, never a second transcript.
Session MCP identity/review scope travels in bridge child environments under
`product.mcpServerName`, never shared configuration. Auxiliary generation uses a
separate session with MCP, built-ins and client filesystem requests disabled.

Native catalogs remain authoritative; Korus never impersonates an allowlisted
editor to expose third-party models. Native plan artifacts feed app-owned review,
with implementation in a separate accepted turn. [The plan](../plans/antigravity.md)
records transport evidence, model restrictions, attachment support and unsupported
capabilities.

Account quotas come from the runtime's `/usage` command, which it answers without
a model turn; the reply is text, so the quota section is parsed defensively and
anything unfamiliar shows no limits. Each read opens a short-lived hidden session,
so reads are shared and reused for two minutes. Quota windows carry the model group
as their label, and mobile does not list this engine because its clients cannot show
that label.

### Request pricing evidence

Antigravity executions carry the model selected in the session and, when the runtime
reports it, the per-turn token totals from `PromptResponse.usage`. The qualified
Google-hosted ACP 1.4.5 server populates it for completed, failed and cancelled
turns. Request coverage stays partial with `acp-request-evidence-unavailable`:
the ACP exposes no identity for each underlying model call, no served model or
billing tier, and no subagent consumption.

Measured turns on Gemini models are priced as an API-equivalent estimate at the
Google standard tier from the selected model, thinking-level suffix removed. Other
selected models, or turns without usage, return unavailable USD rather than zero.
`PromptResponse.usage` reports input inclusive of cached reads and leaves thoughts
out of output; Korus stores thoughts as part of output. Non-zero cached writes are unmodeled and leave the turn
unmeasured. `usage_update` (`used`/`size`) is context occupancy only and never
becomes consumption; neither does cumulative session `cost`.

The qualified executable reports protocol 2 with the v1-shaped wire contract. Its
bundled Python adapter is the evidence boundary; the public CLI, Python SDK and
Gemini Interactions API are different interfaces. The
[pinned public registry](https://github.com/agentclientprotocol/registry/blob/02b460362cfedf4d43b03df7aad6d79a353fe064/antigravity-acp/agent.json)
identifies the distribution. [Fixture provenance](../client/backend/src/antigravity/__tests__/fixtures/usage-capability.json)
records the archive hash and source locations. Fixtures are source-derived wire
shapes with synthetic numbers, not a live billing capture.

| Evidence | Public ACP surface | Pricing consequence |
| --- | --- | --- |
| Billable request identity and timestamp | Session ID and prompt correlation only | Request count stays unknown; a prompt can contain several calls and retries |
| Model and underlying API provider | Selected model in `configOptions`/`models`; no served-model report | Gemini selections map to the Google catalog; Anthropic, OpenAI and other routes stay unpriced |
| Token categories | `PromptResponse.usage`: input, output, cached read, cached write, thoughts | Standard-tier estimate per turn |
| Cache-write lifetimes | `cachedWriteTokens` is always 0 | No lifetime assumptions |
| Pricing context | Context window occupancy only | Context premiums are ignored, as for Codex |
| Served tier/mode | Session mode describes permissions | Standard tier assumed, never the requested one |
| Subagents | Turn usage covers the main trajectory | Subagent tokens are not priced |

The adapter-to-SQLite-to-`usage/get` workflow is repeatable with
`npm run test -w @workspace/backend -- antigravity/__tests__/session.spec.ts`.
It covers mixed model selections, context changes, optional schema totals,
duplicate/late events, cancellation, failure, history replay and ledger restart.

## Local desktop replacement

Local macOS desktop replacement is owned by the
[`korus-desktop-update` skill](../.agents/skills/korus-desktop-update/SKILL.md) and
its bundled updater. It stages a signed, notarized build or a copy of the installed
app, then uses independent one-shot installer and recovery LaunchAgents. The
installer retains the previous bundle and preserves pairing; startup verification
checks the new desktop and its owned backend before declaring success. Private
transaction logs and profile backups stay in the application home, outside the
source checkout. Provider history is retained in place during activation and
recovery.

## Transports

The protocol is transport-neutral JSON-RPC 2.0, one message per line.

| Transport | Use |
| --- | --- |
| stdio (`korusd --stdio`) | bundled local backend; same framing SSH uses |
| Unix socket (`korusd serve`, `APP_HOME/daemon.sock`) | optional always-on single-host daemon |
| SSH stdio | remote locations: noninteractive SSH with keepalives, an app-private Node runtime, and a version-checked socket bridge or one-shot backend |

- Electron's default `APP_BACKEND_MODE=auto` connects to a running local daemon,
  else starts the bundled stdio process. On reconnect it retries the same
  transport with bounded backoff and **never** falls back to a fresh bundled
  daemon after an established connection drops: that would fork authoritative
  state.
- `connect` checks the running socket owner's version before bridging SSH stdio.
  Only an unavailable socket permits a one-shot stdio backend; an incompatible
  live owner requires restarting its service and never permits a second state
  writer. Setup never installs or restarts a persistent remote service.
- No unauthenticated LAN server. Keep Unix sockets in a user-private `APP_HOME`;
  bind any HTTP transport (including the MCP server) to loopback. Add per-user
  tokens before named pipes, cross-user access or any network transport. TCP or
  WebSocket remote control needs its own authenticated design first.
- `stdout` is reserved for JSON-RPC in stdio mode; diagnostics go to stderr and
  `$APP_HOME/logs/daemon.log` (structured JSONL, size-rotated). Redact prompts,
  tokens, OAuth codes, command secrets and file contents from logs.
- `CODEX_APP_SDK_TRACE_CONVERSATION_LOAD=1` enables conversation-load timings
  across Electron, the daemon, the renderer and the SDK backend. It is disabled
  by default. Set it in the desktop/daemon launch environment (or the development
  `.env`) and restart those processes; a reused daemon keeps its own environment.
  Preload exposes only the boolean opt-in to the renderer. Trace records contain
  stages, IDs, durations, byte counts and render counts, not conversation content.
- Request deadline policy lives in `core/src/backend-protocol/request-timeout.ts`.
  Diff visualization explicitly waits until completion or cancellation; other
  requests retain bounded deadlines. Electron adds a grace period so a remote
  timeout reaches the desktop first.

### Conversation share authority

The daemon owns one durable bearer link for each immutable provider conversation
and execution session. Agent entries referring to the same binding reuse that
link. Protected share records live separately from roster/preferences and paired
phone grants, in the `sharing` section of `APP_HOME/collaboration.json`, with private directory/file
permissions and serialized atomic, synced writes. Creation and revocation persist
before success; revoked records retain their identity, and replacement links use
fresh credentials. Session changes and deletion invalidate the original binding.

Invitations are cryptographically random UUIDv4 bearer secrets, also accepted as
`korus://share/<uuid>` links. The daemon uses its configured relay origin and pin;
invites cannot choose a relay. A domain-separated SHA-256 digest, truncated to 128
bits, is the routing handle. The UUID itself travels only inside the encrypted
owner channel. Share status events exclude credentials and full links; only
explicit create/copy replies return bearer material. Sharing uses protocol and section version 2. The collaboration store serializes
atomic section updates so owner and guest writes preserve each other. Reusing the companion identity does not enable
paired-phone access.

Installed desktop guests keep a separate protected app identity and joined-link
store in the `guestJoins` section of `APP_HOME/collaboration.json`. It stores the UUID link, a relay-bound join
identity, owner pin, display name, original team and an immutable target fingerprint,
never transcript content. The discovered owner pin persists before the UUID is
sent; reconnection rejects a different owner.
A shared Quick Chat row is a navigation reference to this join, not a local provider
session. Reopening the invitation focuses that row in its original team.
Only the daemon can read these records; renderer projections contain no bearer
material. Opening a saved entry reconnects and replaces its memory-only provider
baseline through the guest client. Concurrent opens reuse the session; switching
entries disposes the old subscription. Temporary disconnect retains the loaded
view with an unavailable status. An authenticated revocation clears the view and
saved authorization; failed local removal is explicit and cannot reopen access.
An ended conversation retains a memory-only navigation entry until it is closed;
that entry has no transcript or saved authorization and cannot reconnect.
Leaving persists removal before disposing its session. Canceling an unconfirmed
invitation discards its temporary session without changing saved joins.

Sharing is a Korus workflow, independent of provider capabilities. A local agent
with a bound conversation can share it; shared guest entries cannot reshare it.
Guest write access is off by default and belongs to an authenticated peer on one
active share, never to its display name or invitation. The owner grants it only
while that peer is connected. Disconnecting the last session for a peer, share
revocation, target invalidation and daemon restart clear that authority. Automatic
admission waits in the existing sharing coordination queue and rechecks the exact
access grant before dispatch. Revocation returns waiting automatic prompts to
pending review; enabling access never promotes existing suggestions. An authorized
guest chooses queue or steer when sending a prompt. That choice is captured with
the prompt and deduplicated with its identity: queue waits for normal admission,
while steer uses the normal owner steering operation. Read-only suggestions discard
the guest's choice; the owner decides how to send them through the composer.
Both retain the immutable conversation binding and plain-text guest policy;
write access grants no workspace or other conversation actions.
Moving a suggestion into the owner's draft dismisses it for the collaborator and
carries no execution authority. The owner edits and sends that draft through the
ordinary composer; this handoff requires no provider message identity. Pending proposals and decisions are private to the
owner and proposer. Persisted dispatch intent is never replayed after uncertain
submission; restart exposes delivery unresolved. Dismiss never submits. Guests
can withdraw only their own pending proposals; withdrawal and owner decisions
share the serialized authority boundary. Provider receipts contribute only message
and turn identifiers to share records. Terminal proposals retain a text fingerprint
for deduplication instead of discarded text. The loader removes the known legacy
provider-session field while preserving invitations and receipts, and rejects other
unexpected fields. Active proposal text has a two-MiB budget per link, alongside
count limits.

Guest rendezvous uses its own versioned protocols and an in-memory handle directory.
Only a Noise-authenticated owner registers its routing hashes; active hashes cannot
be registered by a second owner. Lookups receive no admission secret and return the
owner peer identity with routing status. Initial owner discovery trusts the pinned
relay; subsequent connections enforce the saved owner pin. The guest authenticates
that peer through the encrypted circuit. A routing permission grants no application
operation; the dedicated guest gateway must authorize the UUID inside that channel.
Missing guest protocols report upgrade-required without falling back to the phone API.

The owner advertises saved active handles on startup, every relay reconnection and
every 20-second renewal; revocation withdraws them. Routes and temporary circuit
permissions have 120-second leases and disappear on relay restart. Relay identity
remains owned by the persisted relay key. Phone claimed-code tombstones are separate.
The guest directory has 5,000 global slots with explicit capacity refusal and no
per-owner product quota. A refused addition still renews retained routes. Owners
with more saved handles preserve creation order, report capacity and retry overflow
as slots become available; links are never rotated or revoked to fit routing.

`WindowBudget` limits full registration snapshots to 30/minute per owner and
60/minute per source network, protecting decoding and directory replacement costs.
Guest lookups allow 30/minute per peer and 120/minute per source network. Temporary
permissions are bounded at 200 per owner, 200 per source network and 10,000 globally.
These transient admission bounds sit alongside existing source socket, frame and
circuit limits; they are not durable sharing quotas. Full owner snapshots have a
192-KiB frame bound; lookups have a 4-KiB bound. Existing phone admission, pairing,
paired routing and push policies retain their independent budgets.

The daemon shares its outbound reservation between guest routing and mobile access.
Mobile-disabled endpoints advertise no device grants or pairing codes and refuse
phone streams even when a guest lookup permits a circuit. Libp2p's IP-based inbound
threshold is unsuitable at the owner because all circuits arrive from one relay;
real-source budgets belong to relay ingress, while endpoint pending connections,
connections and STOP streams stay bounded.

Guest admission checks the bearer credential against protected daemon state inside
that authenticated channel. The authenticated app peer supplies participant identity;
a trimmed display name is presentation. Authorization and proposal ownership use
the peer identity even when names match. Joining never consumes the link or adds
a phone grant. Active session counts
are separate from durable links and feed owner Share status. Revocation and target
invalidation dispose subscriptions and queued writes; asynchronous reads and each
queued delivery recheck the original grant.

A guest session exposes only its bound provider conversation, history and proven
transcript content. Its wire requests cannot select another target or forward RPC.
The daemon uses the existing conversation source and journal; the guest cache calls
the existing provider replicas. Provider resets and events keep their immutable
identity checks. Codex account/catalog state and unsent owner queues are excluded
from the guest projection. Non-transcript provider events advance coordination
revisions without sending their payloads or inventing transcript events. A revision
gap, including one during catch-up, requests an authoritative reset.

Content access uses a bounded index of references proven by authorized provider
reads/pages, so older media remains readable after a recent-window reload without
retaining a second transcript. The index is discarded with the session and fails
explicitly at capacity. Existing frame, response, writer/backpressure and source
network budgets remain in force. Endpoint and relay STOP stream caps accommodate
the guest owner session budget alongside phone connections; source network socket
limits can reject a circuit before application admission.

### Companion gateway and relay

Each companion safety property has one owner. Extend the owner instead of adding a
parallel check, counter or state flag:

- Device authorization and target binding: the gateway operation table. Agent
  operations go through its target check and act on the workspace that check read,
  checking the grant after the last read; none accepts a bare agent ID.
- At-most-once prompt admission: `CommandLedger`, the only holder of in-flight state.
- Rate limits: `WindowBudget`. Limits that protect other clients are keyed by
  `sourceNetwork`; counters keyed by a peer identity only reduce noise.
- Stream framing and backpressure: the shared frame readers and `sendWithBackpressure`.
  Companion peers negotiate compressed response protocols with legacy JSON fallback.
  Gzip preserves provider payloads within separate wire and decoded-response bounds;
  requests retain their smaller inbound limit. Embedded Codex images cross as SDK
  references, with their bytes fetched through bounded content reads on demand.
  The provider validates each reference against its current session snapshot;
  fetching image bytes must not reload or republish conversation history. Transport
  entries retain provider strings rather than duplicate full binary buffers.

A review finding against this area names the invariant below that it breaks. Behavior
listed as outside the relay's guarantees is not a defect.

`CompanionManager` runs inside the authoritative daemon and delegates reads and
prompt admission to existing app-owned handlers, including remote-team routing.
Its protected state owns a stable Noise identity, device grants and a command
receipt ledger. Serialized atomic writes precede grants and prompt dispatch. An
interrupted admission stays unresolved; reconnect reads its receipt instead of
repeating the provider operation. Conversation reads serve the provider's own replica:
Codex is asked each time (it republishes its whole snapshot), while Claude and
Antigravity are followed from their reset and revisioned updates, because asking again
re-reads the transcript from disk and can discard the turn in flight. A revision gap, or
a copy that has gone quiet for 30 seconds, sends the read back to the provider.
Published resets remain available while shared hydration finishes saving; a history
failure invalidates them instead of serving stale data as a successful read.
Retained conversation routing data excludes app snapshots, is capped at 64 agents,
and is pruned against workspace membership; disabling access or stopping the service
clears it. The gateway exposes no generic RPC, filesystem or shell forwarding.
Account usage is an on-demand read of the paired laptop's enabled, connected quota
providers through the same backend operation as the desktop menu. Only quota windows
cross the companion seam; billing and credit details stay on the laptop. Reads recheck
the device grant before returning, and do not depend on the selected conversation.
Missions cross as read-only progress: stage, status and each ticket's state, derived the
way the desktop's implementation board derives it, for active missions and the most
recent twenty. The workers implementing tickets stay out of the agent list but are
listed separately, so a phone can open one from its mission. A worker is talked to like any agent (prompts, answers
to its questions and approvals, interrupts, model and permission choices), but the phone cannot rename, restart,
close, duplicate or re-engine it; the laptop refuses those. Repository workers are titled by repository name;
the mission lead is selected independently from non-implementation stages. Host paths stay on the laptop. Mission actions are limited to continuing a completed implementation to review, accepting a ticket's run that awaits
acceptance, and, during review, selecting an open finding, fixing the selected ones, reviewing again and accepting the submitted review after its findings are fixed or skipped. Acceptance uses the desktop operation; shipping remains desktop-owned.
A review's findings cross with titles, explanations and locations trimmed to the last two path segments. Review readiness comes from the latest run's submitted result, independently of findings that arrive while it is running; missing readiness on an older daemon does not authorize remediation. Every action carries the mission revision the phone saw and is checked against the mission as it stands.
Standalone code reviews use the desktop-owned review ledger and lifecycle. Phones read
findings, discussion, decisions and remediation across rounds through a target-bound
projection without reviewer provider sessions or absolute location paths. Mutations
name the displayed review, active round and ledger revision; stale selections are
refused. Only a ready, idle manual round accepts arbitration or remediation. An
uncertain action requires a fresh status read before another submission. Review
screens refresh while visible and foregrounded; they do not create a second ledger.
Git status counts and available diff scopes cross as presentation metadata, without
host paths or patch contents. Diffs are fetched through a target-bound, read-only
gateway operation that uses the owning daemon’s Git service; the gateway rechecks
the device grant and conversation identity before returning the patch.
Transcript file previews use the same target-bound reads and the desktop's file-preview
and Git operations. Only the selected file's bounded patch and current source cross
the companion seam. A turn's patch stays distinct from the current file; unavailable
historical diffs never silently become uncommitted changes. Both native clients host
the shared file pane, whose memory-only cache is bounded and cleared on conversation
or connection identity changes. Switching Diff/Source reuses the loaded response.
Project acquisition uses the owning team's desktop operations for new repositories,
local repository selection, GitHub and GitLab discovery, and URL cloning. The phone
sends names, catalog IDs or network Git URLs rather than filesystem paths. The local catalog
contains repository roots, with linked worktrees nested beneath them; only roots
become selectable opaque IDs. Repository targets include the owning host in their
opaque path identity, so equal checkout paths on different machines cannot select
each other's work. Provider catalog selections are bound to the daemon lifetime,
provider, owning host location and current catalog identity; branch reads
and creation revalidate them. Legacy GitHub operations retain their existing IDs
for compatible native clients. Integration credentials and checkout paths stay on
the owning host; each write rechecks the grant, team location and available engine.
Branch browsing uses the owning host’s connected integration without preparing a
checkout. Selecting a branch reuses its checked-out worktree or fetches and prepares
a linked worktree, preserving the primary checkout. Long-running acquisition uses
the same device-scoped creation receipts as new chats. Local branch selection uses the
host’s branch catalog without requiring a remote fetch. Agent duplication is bound to
the captured conversation target and creates a fresh agent in the same checkout; an
explicit backend choice uses the target provider’s defaults without copying history.
New repository branches use a catalog-validated base on the owning host, refresh its
remote tip and create a separate worktree. Existing branch names are rejected;
the primary checkout and its local base branch stay untouched.
New worktree branches do not inherit the base's tracking configuration. Remote
deletion requires a same-named tracked branch and excludes the primary worktree's
branch; an arbitrary upstream never authorizes remote deletion. Companion previews
and desktop dialogs use the same eligibility policy as the backend deletion guard.
Released mobile execution fields are normalized at the gateway before entering the
shared execution-selection contract. Unknown fields and conflicting old/new formats
remain invalid.

Conversation image reads accept only image references in the authoritative conversation,
bound to its current host and session. The owning daemon resolves and reads the file;
the phone receives bounded image bytes on demand. Image reads do not persist a copy;
deleted source files are unavailable. Embedded image references resolve against the
current provider session, never a retained copy of a previous conversation. The
existing image-read operation also serves released phones without new wire methods.

Every agent operation names a full target (host, location, team, agent and session); a
session the laptop has replaced is stale and never retargeted. Prompts, goals and reviews
carry the target the native composer captured; other commands use the engine's latest
workspace when sent. Reads recheck the target after
the provider answers.
Prompt admission carries the captured session identity through remote routing and
provider preflight. The owning daemon checks it before dispatch; a stale session is
a confirmed rejection rather than a prompt in a replacement conversation.

The desktop's remote-access keep-awake preference covers both Codex remote access
and Korus mobile access. The companion publishes durable access enablement into
daemon client state, including after restart; relay reconnects do not release it.
Electron applies the remote-access policy only on AC power. Agent activity and
remote access share a native `prevent-app-suspension` assertion, which protects
system availability while allowing display sleep and configured automatic locking.
Computer Use cannot operate a locked session. Under Settings → Plugins → Computer Use,
`computerUseLockPrevention` chooses when Electron holds the single native blocker at
`prevent-display-sleep`, including idle periods and battery power: Off (default),
On demand or Always. Always holds it whenever Korus runs with Computer Use enabled.
On demand holds it only while a hold lasts; the lock in the sidebar rail, above the Korus button (shown only in
this mode, only while Computer Use is enabled) starts one for an hour, until the next
morning (9:00 local time, or the same day's 9:00 before 5 AM) or until the user turns it
off, and its open-lock state turns protection back on at once. A hold is the stored
setting `computerUseLockHold` (`{ until }`, a millisecond expiry or null, or `false`), so it
survives a restart. Electron ends it by writing `false` through the ordinary settings
path at the expiry, with no prompt, and also when Computer Use is disabled or another
mode is chosen; an expiry that passed while Korus was closed is cleared at startup without
ever holding the display. Quitting Korus releases the blocker and falls back to the policy
above. The earlier boolean `computerUseKeepUnlocked` migrates to Always. Preventing
automatic locking does not stop manual locking or lid-close sleep, which macOS controls.

Mobile updates use one authenticated duplex stream per phone. A workspace reset
and a subscribe-before-read conversation barrier precede ordered provider-native
deltas. The phone uses the existing provider replicas, never a second transcript
reducer. Workspace projections are sent on change; heartbeat messages carry no
app state. Sequence gaps, provider revision gaps and reconnects rehydrate from the
authoritative daemon. A phone holds one update channel: a newer one replaces a stale
one from an older connection. Stream queues are bounded in frames and bytes, and
subscription counts are bounded; revocation and stream closure dispose listeners and
buffered work. A long catch-up replay waits on the stream writer instead of queueing
every frame at once, and live frames that outrun a catch-up fail that catch-up only.

Liveness belongs to the update channel. A slow request times out alone and its late
reply is ignored; only the heartbeat speaks for the link, and its deadline is extended
while other authenticated traffic arrives. The transport's own pings are advisory on
both endpoints: a ping that times out during a brief stall does not abort a circuit.
The laptop treats repeated unanswered relay admissions as a dead relay link and
reconnects it. The laptop's transport is three parts, `RelayLink` (the node and its
reconnection), `RelayClient` (admission and push, one admission at a time) and
`StreamServer` (request and update streams). The phone's is `relay-network` (the node
and device identity), `relay-pairing` (stored laptops and the pairing flow) and
`relay-session` (one laptop connection and the conversation caches later sessions share).
Protected-storage read failures are distinct from missing records. A locked Keychain cannot
turn a saved pairing or device identity into an empty value. Failed pairing restores remain
retryable, and foreground activation retries startup after protected storage becomes available.

The phone's state (`companion-state`) keeps the connection, the selection and the conversation, and composes small
parts for the rest: `remote-list` (every list read from the laptop on demand, dropped when its context changes),
`draft-ledger` and `receipts` (what was typed, what was sent and whether it arrived), `session-actions` (rename,
interrupt, restart and close) and `composer-state` (the model menu and permission choices).

The iOS encrypted reader serializes native decryption with transport flow control.
Its receive-window credit stays below the paused-buffer capacity: pausing cannot
recall bytes already granted to the sender, and resuming can dispatch buffered
bytes synchronously. A retained transcript is presentation-only during reconnect;
render acknowledgments are bound to the current connection/selection generation,
not compared against an earlier connection's revision counter. Selection generations
are scoped to an engine-page instance; a retained transcript accepts a restarted
engine's first transfer even when native coalescing omits intermediate frames.

Pending questions, tool confirmations and approvals travel in the workspace's
app-owned request projection. Responses carry the owning host, team, agent,
session and request conversation identity. The gateway checks that identity and
the daemon request owner validates the decision scope and consumes the request.
The native sheet retains entered answers on failure; a failed acknowledgment
triggers reconciliation, never automatic replay or authorization.

The visible conversation remains subscribed. Leaving it starts a five-minute
expiry while its replica continues to receive events. Viewing it again cancels
expiry; incoming events do not extend it. Expiry removes the subscription while
the bounded memory cache retains the last usable replica. Session identity changes
invalidate that replica. App backgrounding
delays intentional transport teardown for five minutes, matching the native lock grace.
Heartbeat deadlines and automatic reconnects pause while hidden; background presence
still enables APNs delivery immediately. The native iOS host holds one finite
execution assertion while the app is connected or streaming, so a short app switch
keeps the authenticated link, and releases it on completion or expiry; iOS decides how
long it lasts, and it does not grant indefinite execution to the WebView engine. If iOS
terminates the engine's web content process, the host reloads the engine and tells it
again whether the app is visible. Reconnecting and updating indicators appear only if
recovery outlasts a short delay, and the retained transcript stays in place meanwhile. Foreground recovery
uses a short liveness probe independently of workspace/presence refresh. A stale
probe retires the host and relay routes before reconnecting so a new stream cannot
reuse a half-open circuit. Restoration also checks elapsed wall time because iOS
may pause timers. Transport loss preserves bounded conversation caches; checkpoint
replay covers missing events when the host retains continuity, otherwise an
authoritative snapshot replaces the baseline.

The separate relay executable has a persistent pinned identity. Public admission
accepts fresh laptop identities without accounts or operator enrollment. Short-lived,
bounded host leases own routing state; the laptop refreshes its device grants and
pairing windows while connected. Temporary pairing routes remain time/rate bounded;
paired routes derive from daemon grants. Endpoints enforce companion methods after
Noise authentication; the relay cannot inspect encrypted application frames. Circuit
duration and data budgets force an explicit reconnect and authoritative rehydrate.
An optional nonempty `hostIds` configuration restricts a privately operated relay.
Public admission never replaces endpoint authorization.

The relay is untrusted infrastructure. It must preserve confidentiality, endpoint
authentication and authorization, and bound its own memory, sockets and outbound APNs
traffic. Code guessing is bounded by the code space, its lifetime and desktop approval;
relay guess counters only reduce noise. Availability under distributed abuse, and
identity introduction by a compromised relay during pairing, are outside its guarantees.

Both endpoints initiate outbound WSS connections. The product metadata supplies the
public relay URL and pinned peer identity. Desktop and phone builds carry only
`APP_COMPANION_RELAY_URL` and `APP_COMPANION_RELAY_PEER_ID` from the build environment
or `.env`, never the environment file or its credentials. A runtime environment
pair takes precedence over the packaged pair; either overrides a relay saved by
an explicit `enable` call. Without these deployment overrides, saved configuration
precedes product metadata. A partial pair fails closed instead of mixing sources.
A phone needs only a pairing code.
Changing the phone build's relay clears saved pairings for other relays; the phone
pairs again instead of restoring a stale development connection. The first
invitation turns mobile access on. An invalid or partial environment pair
fails closed instead of silently selecting another relay.

The host deployment templates under `client/backend/companion-relay/deploy` terminate TLS
in nginx and keep relay and health listeners on loopback. Certbot uses the nginx
ACME webroot and reloads nginx after successful renewal. Only published Cloudflare
proxy ranges may supply the client address used for connection and request limits;
direct clients retain their socket address. nginx overwrites `X-Real-IP` and the
relay accepts it only in explicit `trustedProxy` mode on a loopback listener.
Connection rates, concurrent sockets, laptop leases and push requests are bounded per
source network: an IPv4 address or an IPv6 /64. Peer identities cost nothing to create, so
no limit that protects other clients is keyed on one. Full rate counters evict their oldest
window rather than refusing new clients; the bounded laptop lease table refuses new hosts
when full.
Circuit reservations and admission leases share a bounded lifetime.
Dependency installation applies a version-checked repair for `retimeable-signal`
so renewed reservation deadlines discard their obsolete timers. Its installed-runtime
regression test protects renewal and cancellation until the upstream repair is consumed.
The systemd service runs without root,
with bounded memory and a read-only system filesystem. Versioned bundles live under
`/opt/companion-relay`; configuration and push keys belong under
`/etc/companion-relay`. The private identity under `/var/lib/companion-relay` must
survive service and bundle replacements: changing it invalidates installed peer
pins. Container deployments can instead provide TLS directly to the executable.

Pairing uses a short code (`XXXX-XXXX`, 40 bits) with a five-minute lifetime.
The laptop advertises each full code and its original expiry over its authenticated
connection to the pinned relay. The relay is trusted for the initial introduction:
resolving a code atomically binds it to one authenticated phone and returns the
laptop identity. Repeated lookups by that phone recover a lost reply; another phone
cannot claim it. Advertisements cannot extend expiry or rearm withdrawn codes.
Lookup attempts, invitations and temporary routes are bounded.

A shared review environment can use an operator-configured reusable code. Both the
relay and the destination daemon read the JSON file named by
`APP_COMPANION_PAIRING_CONFIG` at startup. The file contains `code` and `hostId`;
when the variable is unset, no pairing configuration is read and ordinary
invitation pairing works without a reusable code or operator repository.
[the example](../client/backend/companion-relay/pairing.example.json) shows the format, with
`hostId` replaced by the destination daemon's companion identity. Deployment codes,
identities and service configuration belong in the operator's private inventory.
Point both services to the same file so routing and approval use one definition.
Malformed configuration fails closed. A restricted
relay's `hostIds` must include the destination; the configured code does not bypass
normal host admission or circuit reservations.

Resolving that code grants a bounded, five-minute circuit permission to the named
host. Other hosts cannot advertise invitations with the reserved code. Only a daemon
whose own identity matches `hostId` automatically accepts claims for that code. It
serializes and atomically persists normal device grants before confirming approval,
then advertises them to the relay. Existing device limits and revocation apply; a
holder of the reusable code can pair again after revocation. Mobile access must be
enabled on that daemon, and its companion identity and grants must survive restarts.
Every approved device shares access to the daemon's workspace.

The phone pins the introduced laptop identity when establishing its Noise circuit.
For ordinary invitations, the laptop independently consumes the invitation for that
authenticated phone and requires explicit desktop approval before granting app access.
Approval persists the phone identity; the phone stores the laptop and relay identities
in protected storage, never the code. Rejection, expiry and daemon restart invalidate pending invitations.
Relay restarts cannot bypass the laptop's single-use claim. Subsequent reconnects
use saved pins without another introduction. A compromised relay during initial
pairing could substitute identities; after correct pairing it can disrupt delivery
but cannot impersonate either pinned endpoint or decrypt conversations.

Admission and rendezvous use version 2 and do not downgrade to another pairing
scheme. Relay, desktop and mobile must support that version for new pairing;
persisted identities and device grants retain their format. Existing companion
conversation and push protocols keep their authenticated, encrypted boundaries.

The iOS engine uses CryptoKit for X25519, Ed25519, SHA-256, HKDF and
ChaCha20-Poly1305. The pinned upstream Noise XX/cipher state machine runs in a
private JavaScriptCore context on a serial worker, supplied with synchronous Apple
primitives. Bounded, ordered record batches cross the asynchronous WebView bridge;
backpressure preserves ordering without running cryptography on the UI thread.
The same adapter secures both the relay connection and the inner laptop circuit.
Ed25519 protobuf serialization preserves existing device identities and Keychain
pairings. Unsupported key types or an unavailable native service fail closed.
The iOS build rejects bundled third-party cryptographic implementations, including
transitive fallbacks; upstream Noise upgrades require interoperability revalidation.
Desktop and relay use their existing libp2p implementations.

### Companion push delivery

The relay's optional `apns` configuration supplies `teamId`, the product app ID as
`topic`, and `development` and/or `production` entries containing `keyId` and
`privateKeyFile`. Signing keys are read from operator-managed files; they never enter
client bundles or source control. The Apple App ID must enable Push Notifications,
and the installed app's signed `aps-environment` entitlement must match the key's
environment. Device tokens are opaque and rotate; the phone registers at launch and
forwards updates through its authenticated laptop session. The phone signs each
registration with its pairing identity, binding the token, environment, laptop,
relay and expiration. The relay verifies this consent and a current paired route
before contacting Apple. Global, host and token budgets bound delivery even when
clients rotate identities; concurrent duplicate notifications share one send.
Apple invalid-token responses remove only the registration that produced the failure.

iOS Live Activities use ActivityKit and a WidgetKit extension, independently of alert
notification permission. The selected laptop aggregates running agents and requests
across teams, including Mission workers, without transporting conversation contents.
The daemon owns the laptop name, distinct active-agent count and the start of each
continuous work interval it observes. Token rotation preserves those elapsed-time
anchors. At most two rows are projected: attention first, then active work, then
recently completed work when space remains. Counts include all active agents;
completed rows do not count as active. An all-idle workspace ends the activity.
Native settings and the system's Live Activity authorization control participation.
Switching laptops or opting out ends the activity and withdraws its registrations.
Row links carry the host and agent identities. The native app defers navigation
until its selected laptop connects; the engine resolves the current authorized
workspace and rejects a missing agent or different laptop rather than redirecting
to another conversation.

ActivityKit push-to-start and activity-update tokens have separate, phone-signed
consent bound to the paired host, relay, environment and activity instance. A dedicated
relay protocol preserves ordinary notification requests and released clients. The
daemon persists activity identity before starting it, coalesces workspace changes,
and sends bounded APNs `liveactivity` payloads through the relay's existing Apple key.
ActivityKit background wakes exchange rotated tokens over a short authenticated
request without subscribing to conversations. The phone's pairing and device-identity
Keychain items remain device-only and support background access after first unlock;
existing items migrate on a successful read. Drafts retain unlocked-device protection.
Updates refresh stale dates; an idle
workspace ends the activity. Disconnected hosts become visibly stale instead of
claiming fresh status. APNs acceptance does not prove display or background wake;
signed-device delivery must be checked separately from simulator lifecycle tests.
A renewed start registration can replace an accepted start whose update token never
arrived after its stale window; heartbeats never retry that start, and live or
dismissed update-token instances are preserved.
After an app build changes, the native client withdraws a saved registration if
ActivityKit has no matching active instance, before requesting a fresh start.
Ordinary relaunches preserve pending starts and existing activities.

Attention alerts are suppressed when the desktop is focused on the exact active
conversation, matched by host, location, team, agent and session. Other conversations
remain eligible regardless of where the prompt started; unavailable desktop focus
information does not suppress alerts. Read-clearing events are always delivered.
Nonblocking questions never send attention alerts. Mission leads and repository
workers alert only for blocking questions and approvals;
finishing a turn does not send a Mission alert.
A brief grace period lets visible clients acknowledge the attention revision before
delivery; the daemon rechecks the shared read checkpoint after that period.
A foreground phone receives live in-app alerts
instead of system push. Delivered alerts carry the daemon's persisted agent read
revision. Acknowledgments from any client clear notifications through that revision on every paired phone;
newer turns remain unread. Native clients retain the read checkpoint to reject late
alerts, and reconcile it from the workspace after reconnecting. These checkpoints
span conversation replacements within the same agent and are scoped to the paired
host, location, team and agent. Local banner dismissal does not acknowledge a turn.
Clear events travel on the live stream and through APNs background or FCM data
messages. Apple may delay or omit background delivery; foreground reconciliation
removes stale delivered notifications without relying on a silent push. Visible
alerts replace earlier alerts for the same host, location, team, agent and
conversation. Alert delivery keys are separate from read-clear keys, so a silent
clear cannot collapse a newer visible alert.

Android push uses the relay's optional `fcm.serviceAccountFile`, an operator-managed
Google service-account JSON file with permission to send FCM messages in its project.
The Android client configuration must name that project and the product application
ID; the build accepts `APP_COMPANION_FIREBASE_CONFIG` or an ignored local
`mobile/android/app/google-services.json`. Client configuration never contains the
service-account key. FCM registrations carry an installation ID in the opaque token
field and bind the push service in the phone's consent signature. The relay sends
data-only attention metadata through the HTTP v1 API with bounded, scoped OAuth
authentication. Only an explicit unregistered-device response invalidates a saved
registration; payload, authentication and temporary failures remain retryable.
Without FCM configuration, companion connectivity and foreground alerts remain
available. The relay remains a standalone artifact with its dependencies bundled.

Android release signing uses operator-provided environment credentials; signing keys
and passwords belong outside the public checkout and generated client assets. The
release build command requires a complete signing configuration and produces both
an APK and App Bundle with the supplied certificate. Debug and isolated native-test
builds retain their development identities and require no upload key.

`npm run dev:relay` reads `APP_COMPANION_APNS_KEY_ID`,
`APP_COMPANION_APNS_TEAM_ID`, `APP_COMPANION_APNS_KEY_FILE` and
`APP_COMPANION_APNS_ENVIRONMENT` (`development` or `production`) from the environment
or ignored `.env`. Without APNs configuration the foreground notification stream
remains available. An APNs acceptance response is not proof of OS delivery; verify
background delivery and tap navigation on a signed device separately.

### Background daemon (macOS)

Settings can install a per-user LaunchAgent that runs `daemon serve`, so agents and
automations survive closing the window. Enabling it does not move the current
session off its transport; the next launch in `auto` mode connects to it. At
startup Electron compares the packaged `korusd --version` with the running
daemon's health version: a stale idle daemon is refreshed silently, while active
agents or automation runs prompt for a restart.

### Remote Hosts (SSH)

Connection records live in `daemon`. Saving a host is independent of read-only
inspection and installation. Initialization requires an explicit selection of
providers; progress is persisted on the connection record. Setup installs the checksum-pinned Node
runtime from `node-runtime-release.json` into the remote user's private app
directory, verifies the staged self-contained `daemon.mjs` before replacing it,
and confirms activation through the remote backend. System Node and shell
profiles remain user-owned. SSH uses key authentication, keepalives and first-use
host-key trust; changed host keys remain rejected.

Updates close the app's SSH client and reconnect after installation. Known active
turns or pending input block the update. Retrying a saved host retains its
connection identity and team pointers. Failed activation is persisted as a
recoverable connection error, rather than reported as ready. Version inspection
does not install software or close a running client.

Setup mirrors a local `provider-tokens.json` when present; absence of a local file
preserves the remote host's credentials. It never copies app state or conversation
data. Only selected providers are installed; existing engine installations are
preserved. Engine installation runs on the owning host: Codex uses the user's
`~/.local` npm prefix and Claude uses its native installer. Detection, account
sign-in and provider upgrades belong to that host, independently of Korus updates.
User-local Codex upgrades verify package ownership and retain the `~/.local` npm
prefix even when the Node runtime has a different default global directory.
Version discovery accepts the previous daemon CLI name for hosts not yet upgraded.

An SSH daemon owns its host's home exclusively. Each connection launches its own
stdio daemon with its own in-memory state, so two live daemons on one home overwrite
each other's saves and agents or teams vanish and reappear. The launch sets
`APP_EXCLUSIVE_HOME=1`, which holds a SQLite exclusive transaction in
`daemon-lock.sqlite` for the daemon's lifetime. The OS releases it on process exit;
the lock database is never removed for stale-owner recovery. `daemon.lock` contains
diagnostic owner metadata only. A live owner is waited for briefly while it shuts
down; otherwise the new daemon exits with a message naming the duplicate session. Two saved
connections to the same machine therefore cannot both be active. Local and
`serve` daemons do not take the lock.

Every connect, install and reconnect (the read-only inspection) links the host's `codex` and `claude` into the
private `bin` directory, which the SSH launch puts first on PATH, and drops the link
of an engine that is gone. The daemon resolves a linked engine with one file check
and starts no login shell, which otherwise costs seconds per probe on slow hosts.
Unlinked tools and dangling links fall back to full discovery, so a failed link
only makes startup slower. A link is a cache: an engine moved by a version manager
is picked up at the next reconnect.

## Standalone CLI

`client/cli` owns the standalone terminal diagnostics and control workspace, with
its own package, build and tests. It can bundle reusable backend modules; imports
must not require Electron or start the daemon at module load. `client/cli/build.mjs`
emits a dependency-free installable package under `client/cli/dist` and rejects
Electron or external runtime dependencies. Product metadata supplies the public
package name; the internal workspace is `@workspace/cli`. Its version is independent
of the desktop release, while its internal core dependency follows the desktop version.
The standalone CLI requires Node 22 or newer independently of the repository’s
Node reference toolchain. Its workspace engine declaration supplies both the
bundle target and runtime diagnostic minimum.

Doctor reads state envelopes without migrations or writes and bounds every process,
socket and MCP probe. Warnings and absent optional services do not fail the command;
invalid state, unsupported runtimes and failed explicitly requested MCP probes do.
Terminal reports use coloured sections; redirected output and JSON remain plain,
and `NO_COLOR` disables colour. Each coding client reports its version, effective home
and authentication through bounded status commands. Persisted provider-home choices
take precedence over environment defaults, and probes and triage use that same home; credentials and account details
are not included in the report. The MCP check uses a loopback GET without an agent identity;
reachability does not establish provider tool-delivery correctness. Structured inspection output retains its data source. Agent and Mission commands are
read-only and can fall back to saved metadata without a running daemon.

Triage selects the first installed, authenticated terminal client in the order
Claude, Codex, Antigravity (`agy`), unless explicitly overridden. Bounded
non-interactive login-status probes are used for Claude and Codex; Antigravity
is checked through its model catalog. Account details and probe errors are
discarded. Selection does not start model turns or read credential files.
Triage runs the chosen external CLI with private context/playbook files. Support
bundles contain redacted metadata by default; log excerpts require an explicit flag.
Neither operation uploads data. Log following emits complete lines before redaction,
preserves filters across file replacement and supports pipes. JSON following emits
one event per line, including the initial tail. Cancellation propagates to requests,
probes, prompts and launched clients; SIGINT and SIGTERM return 130 and 143.
Declining an interactive confirmation is a successful no-op; non-interactive
service control requires explicit confirmation. Background service control is limited
to an installed macOS LaunchAgent whose APP_HOME matches the selected installation, and requires
confirmation. A missing socket can also mean a desktop-owned stdio backend;
diagnostics never start or replace a daemon implicitly. Backend status probes the
socket first, then the advertised loopback MCP endpoint. An absent connection is
a successful status result, not a service-control failure.

## Development

Use the Node 26 reference toolchain for local development and verification.
The repository's `.nvmrc` pins the exact version; the root README covers setup.
The packaged daemon uses the private runtime described below independently of
the developer's shell.

`npm run dev` is the Electron-first entrypoint. It builds `daemon` to a dev bundle
and supervises a fresh local stdio backend instead of reusing an installed daemon
of the same version. Backend changes rebuild and restart the process (no HMR) and
the client re-syncs with `snapshot/get`; only durable state survives, and active
turns, pending approvals and in-memory MCP sessions are interrupted. Protocol
changes may require restarting both processes. Renderer changes keep Vite HMR.

Desktop URL testing uses a dedicated native development target. The target binds
one worktree and an explicit isolated profile to a stable `korus-dev-<hash>` alias,
private Electron user-data directory and bundled stdio backend. Its per-profile
single-instance lock forwards later launches to that target. It never replaces
the installed product's URL handler. The ordinary Forge process remains separate
unless it was launched with the target's profile and alias.

`scripts/dev-link.mjs register --home <absolute-profile>` registers the compiled
worktree's native launcher; `open` reads a normal product link from stdin and
hands the equivalent alias URL to the operating system. `unregister` removes only
that target. Build the current desktop assets before registering. On macOS, a
small signed-ad-hoc launcher bundle lives under the user's Applications directory
so Launch Services retains its URL registration. Windows uses a current-user
scheme registration that launches Node directly without a shell; Linux uses a
private desktop entry and `xdg-mime`. The launcher fixes the profile, app path and
backend executable so installed-app environment overrides cannot redirect it.
The opt-in `client/electron/scripts/guest-desktop.runtime.mjs` workflow builds the
worktree, uses an isolated encrypted relay with a stable test key, performs native
URL delivery, and removes its temporary profile and registration. Its scripted
provider transcript is not live-provider execution evidence.


Folder-changing provider actions are rejected while chats are active because they
restart `daemon` and its provider processes; Electron closes hosted Browser panes
first and the client reloads from the synchronized snapshot so no cached
conversation or sequence cursor outlives the backend instance.

## Runtime And Packaging

- Installation applies a version-checked patch to Forge's `cross-zip` dependency
  so Windows ZIP creation uses the Node 26 filesystem API. The packaging regression
  exercises the installed maker and verifies an extractable archive; Windows builds
  also run it with native PowerShell.
- On macOS, launching a packaged app outside Applications installs it through
  Electron's native relocation API before creating backend resources or taking
  the single-instance lock. Electron relaunches the installed copy or focuses an
  already running installation. A write-access preflight keeps protected installs
  out of Electron's destructive privileged replacement path; users authorize those
  installations through Finder instead, with the existing app untouched. Ordinary
  replacement requires confirmation; cancellation or failure exits without starting
  the daemon. Installer diagnostics use the main log. The DMG presents one app icon;
  its background SVG and 1x/2x PNG assets share the Finder window's logical size.
- Desktop ships a private, checksum-verified Node runtime beside the daemon bundle
  (`Resources/runtime/node`, `Resources/daemon/korusd` + `daemon.mjs`). No system
  Node is required and the launcher is never put on `PATH`.
  `node-runtime-release.json` pins version and SHA-256 per platform/arch; Forge
  prepares and verifies it (cached archives included) before signing. Runtime
  updates ship with app updates.
- **Why not the alternatives:** Node SEA cannot load filesystem dependencies and
  needs native add-ons extracted at runtime; Electron `ELECTRON_RUN_AS_NODE`
  requires enabling the `RunAsNode` fuse, a real security regression because the
  app executable becomes a Node runtime (`forge.config.ts` keeps it off);
  `utilityProcess` cannot pipe stdin, so it would force a second transport.
  Author the backend as a plain Node program and keep the runtime pluggable.
- The bundle imports no `electron`, leaves Node built-ins external, ships
  sourcemaps, and avoids native dependencies unless their packaging and signing
  are designed.
- Provider selection prefers an installed CLI on the owning host. Codex can use
  the CLI embedded in ChatGPT on macOS when no CLI is found. Claude falls back to
  the SDK-matched native executable shipped beside the daemon, outside ASAR, with
  its license and release metadata. Packaging requires the target platform/architecture
  optional SDK dependency at the matching SDK version; it never substitutes the
  build host's executable. macOS signing preserves the runtime's native entitlements.
  Development and packaging do not download, pin or bundle Codex. Release smoke
  checks reject a bundled Codex resource directory and probe the packaged daemon's
  health and provider detection without requiring a provider installation or login.
- The iOS simulator companion is a pinned native resource, prepared from an
  upstream archive with SHA-256 verification, including cached downloads. Its
  protocol and native dependency notices travel with the resource directory.
  Electron uses direct gRPC on owned Unix sockets; there is no Python runtime or
  system idb dependency. Forge signs the companion and its nested native resources;
  GitHub Actions probes the packaged executable with a minimal PATH. Xcode and
  simulator runtimes remain external prerequisites.
- Computer Use, Screenshots, the iOS companion and Apple speech helpers are macOS-only; packaging
  another OS does not enable them.
- Release builds sign and notarize; use `APP_SKIP_SIGNING=1` for local
  verification. Every build must still start the packaged backend and answer
  `backend/health/get`.

### Platform Matrix

macOS ARM64, Windows x64, Linux x64 and ARM64. Intel macOS is deferred because the
Computer Use helper is ARM64-only; Windows ARM64 is experimental. Passing builds do
not prove GUI installation, login or a full agent turn on a clean machine: do that
acceptance check before promoting the first release for an OS. Windows installers
are **unsigned** (SmartScreen warnings are expected; no certificate prerequisite).
The selected provider runtimes are separately installed prerequisites, as are
Git/GitHub tools. Antigravity requires the paired ACP runtime/harness described
above, not an editor or CLI installation alone.

## GitHub desktop releases

`npm run prerelease` (or, for an explicitly approved stable release, `npm run
latest`) is the only release command. It requires committed desktop inputs on the
default branch whose HEAD is pushed, creates the remote `v<version>` tag at HEAD (reusing
one already at HEAD, refusing one elsewhere or an already published release),
dispatches **one** workflow from that tag, and watches it to completion, printing
one line per job state change. Never move a release tag.

- The workflow (`.github/workflows/desktop-build.yml`) is quality, four native
  builds, publish. Because it is dispatched from the tag, the workflow, scripts and
  app source all come from the same immutable commit; a release-tooling fix means a
  new version.
- Uncommitted server, website, mobile, engineering documentation and console-only
  telemetry metrics contracts produce a warning rather than blocking desktop
  releases. They remain untouched and are excluded from the remote tag. Desktop,
  other shared source, dependency/lock files and build/release tooling must be
  committed. Renames cannot hide a changed desktop input in an unrelated area.
- Release tests run on Linux; macOS-only signing cleanup tests gate the macOS
  build. Publishing requires both the release test gate and every native build.
- The independent Quality workflow runs on branch pushes, PRs and manual dispatch.
  It excludes tag pushes, retains coverage reports and enforces every workspace's 85%
  statement gates. Release tests run without coverage and have no dependency on
  the Quality workflow.
- Only the final job has contents-write permission. It requires every platform to
  ship its full installer set, stages them on a draft release, then publishes the
  requested channel. Published releases are never modified; an interrupted run
  leaves a draft that a rerun completes.
- The publisher stages and verifies the same artifacts in the update repository and
  the source repository before publishing either release. `DESKTOP_RELEASE_TOKEN`
  grants Contents write access to the update repository; the workflow token owns
  the source release. Mirror tags reference the update repository's default branch.
- Artifact names carry no run attempt, so `gh run rerun <id> --failed` yields a
  complete set. Resume watching with `npm run release:watch -- <run-id>`.
- Source-map ZIPs use underscores around platform and architecture names so the
  update service cannot mistake them for installers. They retain the
  `-sourcemaps.zip` suffix for profile symbolication and do not satisfy installer checks.
- Build-only validation: `npm run release:build` dispatches the current pushed
  branch with `channel=none`, which skips the tag check and publication.
- Install dependencies with `npm ci` and run `node node_modules/electron/install.js`
  before parallel tests or Forge (the lazy Electron download races between workers).
- Account and OAuth client IDs are GitHub **Secrets**, not Actions variables, to
  keep them private and masked. They still ship inside the app and can be
  extracted. Never put OAuth client secrets in the app. macOS signing uses a
  temporary keychain that is always cleaned up, and no signing credential reaches
  dependency installation or other OS jobs.
- Prereleases are manual downloads on every platform. Website links must use
  `/releases/tag/v<version>` or `/releases/download/v<version>/<asset>`;
  `/releases/latest` excludes prereleases. Asset names derive from product
  metadata; Windows `*-full.nupkg` and `RELEASES` bytes must stay intact because
  Squirrel's manifest references them.

### Desktop auto-update

Packaged macOS and Squirrel-installed Windows use Electron's native `autoUpdater`
against the public update service
(`update.electronjs.org/<owner>/<repo>/<platform>-<arch>/<version>`; origin
overridable with `APP_UPDATE_BASE_URL`), with the native Squirrel protocol, not
`serverType: 'json'`. The service ignores drafts and prereleases, so only promoted
stable releases update clients. Development, portable Windows and Linux report
automatic updates as disabled. On Windows and Linux, manual update requests fall
back to the repository's latest stable release downloads when the native updater
is disabled.

Installed macOS clients predating this still read
`meetkorus.dev/desktop/releases/darwin/arm64/RELEASES.json` and the DMG download
URL. Preserve both during prereleases. At the first approved **stable** cutover,
the website owner publishes a bridge entry in the existing JSON schema pointing to
a signed GitHub ZIP of a newer version that contains the new updater, keeping
history and verifying the download first. Never redirect that URL to the Electron
service: old clients expect a different response format.

Release notes in the What's New dialog are generated from `CHANGELOG.md`
(`npm run release-notes:generate`). `release-notes:check` runs before packaging and
fails on version mismatches, a missing changelog section or stale generated JSON.

## State Ownership

Durable state, files and token storage are described in
[architecture.md](architecture.md#state). Electron keeps only desktop window state
(bounds restored only when they intersect a connected display) and a volatile
snapshot cache advanced by sequenced `daemon` events; it never writes product state.
Persistent files are `daemon`-only.

## Security

`daemon` can read source trees, run coding backends, mutate git, store tokens and
manage MCP tools: treat it as a privileged control plane.

- Keep capability checks in `daemon`, not only in renderer UI.
- Never expose raw provider protocols to the renderer or to unauthenticated local
  clients.
- Keep the Korus MCP server loopback-only.
- Standalone `daemon` must not import Electron; secret storage sits behind an
  abstract token-store port.

## Local usage statistics

### Historical API prices

`npm run pricing:update` collects Models.dev provider pricing from the public
GitHub API and raw source files at one immutable revision. The collector verifies
Git blob hashes, requires all three providers, validates pricing rules and the
existing history, and atomically appends dated cost events only to models whose
pricing content changes. Revision, comments and source links do not trigger events.
`client/backend/src/pricing/history.json` is keyed by provider, then exact model ID; each
model has shared metadata and a `cost` array. Each event retains rates, pricing
rules and immutable source evidence. Removal records an event without erasing
past prices; reappearance appends another event. The baseline is effective October
1, 2026 UTC. Automatic refreshes record when a change was observed. A launch-date
entry for a newly listed model requires published pricing evidence.

The pricing workflow runs daily in the public release repository and supports
manual dispatch on `main`. It validates the collector and publisher before
committing changed history and its content-addressed manifest with the repository's Actions token;
unchanged prices preserve the manifest revision and publication time.
Concurrent pricing runs are serialized. If `main` advances during collection,
the push fails rather than replacing newer repository changes. Bot pushes do not
trigger the separate Quality workflow, so pricing validation runs before the push.
The workflow publishes immutable versioned catalogs and then replaces the latest
manifest on a dedicated, non-latest pricing prerelease. Pricing assets never use
the app release tags or GitHub's latest app release. Publication retries reuse
uploaded catalogs and cannot advance the manifest after a failed catalog upload.

The catalog retains context predicates, service tiers, mode mappings, category-specific multipliers,
cache reads, and cache-write lifetime maps. Missing rates remain absent; explicit
zero rates remain zero. Models without source prices are marked unpriced. The
schema retains explicit billing units: token and character prices are USD per
million, other prices are per unit, cache storage is per million tokens per hour,
and web search is per thousand calls. Non-token charges must not enter token-cost
estimates.

Matching source overrides merge fields in order, including nested cache fields;
all matching multipliers then apply only to the categories they name. Mode
configuration maps names to request fields but does not establish a request's
actually served tier. Each pricing event retains its source revision, collection
time and blob hash; model metadata retains the source path and documentation
links for coverage diagnosis. Removal events reference the revision that omits
the model and have no source blob.
The daemon embeds a catalog and matching manifest for offline startup. Its pricing
service loads a validated local cache. `RuntimeScheduler` runs its due check at
startup and once per minute; the persisted timestamp limits public manifest
requests to once every 24 hours across restarts. Network access never blocks
startup or analytics queries. Schema validation, a bounded download and a content
digest precede atomic cache replacement. The newest compatible publication wins
between cache and bundle; failed checks retain usable prices and their check time
survives restart. The common scheduler owns the timer; shutdown stops scheduling
before the pricing service cancels pending downloads.

Usage queries price retained measurements against one current catalog snapshot;
cost totals are not persisted. New catalogs can correct historical estimates
without rewriting usage. Sealed telemetry bodies retain the estimates captured
at sealing; refreshed prices affect new previews and future seals. Event dates
select the applicable historical price,
while source collection and catalog publication times describe discovery and
delivery. An effective-date correction requires provider evidence; downloading
newer data does not establish an earlier effective date. After editing history,
`node scripts/pricing-release.mjs` prepares its matching bundled manifest and assets.

### Execution measurements

The owning daemon records live provider executions in a bounded SQLite ledger.
History hydration, inherited forks and context occupancy never become consumed
tokens. Provider conversations remain the sole owners of prompts, responses and
tool arguments; analytics stores only execution references, numeric measurements,
outcomes and local grouping metadata. Configured reasoning effort and service tier
are captured at turn start and retained through completion and late usage corrections.
Unsupported measurements remain unknown. Codex consumption can be replaced or
invalidated after completion.
The local Codex surface enables SDK-owned native-history usage verification so
resumed executions and compaction charges do not depend solely on a live counter
baseline. Daemon startup marks persisted open executions interrupted, retaining
their measurements and accepting later usage replacements; read-only projections
and explicit repair clients do not perform this startup transition.
Claude execution consumption covers the main agent loop; independently observed billable requests retain their own identities.
Reasoning is included in output. Cache categories must not be added to input.
Provider quotas remain separate account-scoped views.
Claude SDK `<synthetic>` assistant notices are not model responses or billable
requests; retained placeholder request rows are ignored by usage queries.

Request measurements have a separate identity scoped by backend provider, session,
turn and request. Providers emit them through the optional `onRequestUsage` seam;
the usage service serializes execution and request observations together. The
parent execution must exist first. Numeric samples retain actual API provider/model,
request time, token inclusion semantics, cache-write lifetime buckets, context and
region evidence, requested/reported tiers, served mode and finality. Corrections
increase a persistent revision; stale revisions, changed request timestamps and
final-to-provisional updates cannot replace newer evidence. Requests and their
parent grouping metadata survive restart without storing conversation content.

The backend prices each final request using that model's latest cost event
effective at the request timestamp. Exact model IDs are required; requested tiers
do not establish served tiers. A documented default requires explicit producer evidence. Context
predicates use their authored strict/inclusive operators, matching overrides merge
in order, and matching multipliers affect only their named categories. Included
cache reads/writes are subtracted from input and included reasoning is separated
from ordinary output before applying rates. Missing usage, inclusion semantics,
cache rates/lifetimes, context, region, tier or model evidence leaves a request
unpriced with a reason. Codex executions and legacy Claude executions without
request observations are priced from their retained model and measured token
counters, with cached reads priced separately, normal pricing for missing tiers,
and no long-context premium. Legacy Claude cache creation uses the default
five-minute write rate; its normalized input includes both cache categories.
Claude rows carrying request-coverage evidence require request attribution, so
unresolved cloud/proxy routing cannot select a direct Anthropic estimate. Real
request observations supersede an execution estimate. Non-token charges remain
outside the estimate.

Cost and coverage accompany summary, daily and grouped results. USD sums only
priced usage; a known zero differs from an unavailable total. Observed request
counts do not claim to count unknown legacy requests. Producers must explicitly
attest a complete execution request set; otherwise coverage retains an execution
with an unknown additional request count, even when some requests were captured.
Execution token/timing fields keep their execution-start date and model attribution.
Cost uses request dates/models, so a cost contribution may create a group/day with
zero execution starts. Backend-provider filters retain their existing meaning;
API-provider grouping/filtering uses the underlying billing provider separately.
Unknown legacy coverage keeps its retained execution attribution. Clearing,
execution deletion and retention also delete request evidence. The standalone and
desktop resource bundles calculate these costs from embedded prices offline.

Model grouping uses the raw model ID and normalized service tier together.
Normal, default and standard tiers share a standard variant; OpenAI priority and
fast share a Fast variant. Anthropic's reported Fast inference mode distinguishes
its Fast variant from standard capacity. Missing tiers remain a separate unknown
variant. Each tier-separated model row and daily group exposes an opaque `key` and a
`modelVariant` descriptor; the raw model ID remains unchanged for pricing and
filtering. Execution performance uses its captured start tier, while request cost
uses served evidence, including downgrades. OpenAI's served Fast alias resolves to
the catalog's priority pricing rules without an additional multiplier. Retained
ledgers regroup directly from stored tier evidence without rewriting records.
Local Analytics queries may explicitly combine service tiers within a model.
This sums the same token, timing and cost contributions; rates still use summed
measurements and each request retains its tier-specific price.

Hourly telemetry retains canonical provider/model/tier groups using the same execution-start
and served-request attribution. Only closed tier labels are sent; missing or unrecognized
tiers become unknown, and legacy reports remain valid as unknown-tier groups. Raw model
IDs retain their pricing identity. The private console separates variants by default;
its Group service tiers option combines them with weighted timing sums.

The backend turn clock excludes waits for user input and in-flight tools, with
parallel tool waits counted once. Speed combines provider-reported output tokens
with measured working time after the first generated output. A turn without both
measurements has no speed.

The ledger retains up to one year and 50,000 executions and exposes grouped
queries to Analytics through app-owned contracts. Daily groups carry the same
additive timing samples as period totals, so rates use summed output divided by
summed generation time rather than averaging per-turn rates. Clearing statistics
deletes the local measurements without changing provider history. Storage failures leave analytics unavailable without blocking
provider work. No reporting endpoint, upload queue or hosted analytics service is
part of this path.

### Private daily payload projection

The local telemetry preview drains pending ledger observations and uses a numeric
projection of that same SQLite ledger for one UTC reporting day. Tokens and
turns retain execution-start attribution; costs retain request-day/model
attribution. Cost-only groups have zero execution tokens. Token fields retain
known subtotals with a measured-turn count; an entirely unmeasured group remains
null. Estimated costs retain the known subtotal with separate complete, partial
or unavailable coverage. Missing measurements never erase measured contributions.

Model names are uploaded exactly as recorded locally, including custom aliases,
independently of the pricing catalog. Missing names become `unknown`.
The serializer rejects extra fields, constructs every wire field explicitly, sorts
provider/model/tier groups and returns immutable canonical JSON text. Hourly
reports include a UTC hour; daily previews and legacy reports omit it. Its UTF-8 bytes are
the sealed-body representation shared by preview and delivery callers. Preview
does not persist, queue, schedule or send; identity and consent owners must supply
the UTC reporting bucket. The preview result carries only the body, never a ledger
row, provider object or filesystem path. An unavailable ledger is an error, not an
empty active day.

The private `telemetry` section of `settings.json` contains an installation UUID,
an optional `enabled` choice, and the latest `enabledAt` timestamp. Unset shows
the notice without sending; false
is off and true is on. The common settings writer preserves these fields across
ordinary snapshot saves without projecting them into generic snapshots,
coordination events or agent tools. Existing `telemetry.json` identities and
choices are imported before retiring the old file. Each off-to-on transition sets
`enabledAt`; repeated enable calls and restarts preserve it. Automatic reports
start with the next full UTC hour. The partial hour and time while sharing was off
are excluded. Existing enabled settings without a timestamp start a fresh window
when loaded. Explicit historical backfills are separate from enabling sharing.
Invalid telemetry metadata makes sharing unavailable without blocking ordinary startup.

Only explicit desktop operations return the credential-free sharing choice. The
desktop bridge accepts an action or reporting day, never an identity override.
The conversation-top notice uses the backend consent authority. Its one-minute
foreground timer starts only when the notice is eligible, pauses while hidden or
unfocused, and retains its elapsed time across pane changes in the renderer session.
Timeout persists the enabled setting through the same desktop operation as an
explicit enable, while retaining the notice for the rest of that session until
dismissed. Saved settings suppress the notice on later starts; failed automatic
writes retain an error without repeated automatic attempts. Reset replaces
the identity and turns sharing off. Companion clients do not expose profile actions.

The consent owner delegates transitions to `TelemetryDeliveryPort`; it does not
send, schedule or manage a queue. One backend `TelemetryUploadService` per local
installation runtime owns sealing, the private durable queue, telemetry HTTP,
acknowledgements and cancellation. RuntimeScheduler checks delivery each minute.
Each installation uploads at the UTC minute given by its UUID modulo 60, once
per hour; startup respects the same slot. The stable slot spreads clients across
the hour independently of local timezone and restarts. It discovers reporting
hours from the local ledger, including
all unsent retained history inside the current sharing window. Electron also signals observed
open/focus/resume activity, and scheduled uploads confirm foreground presence so
an active hour without turns can report empty usage. Remote ledgers and mobile
companions cannot supply local reporting data; an idle daemon cannot invent empty
activity hours.

Delivery state is bound to the installation UUID. It retains the local ledger's
year of hourly buckets, with a 10,000-bucket bound. Frozen pending bodies survive
until delivery finishes; older acknowledgements keep a digest for unchanged-total
comparison. Discovery never reconstructs zero totals from expired source data.
Each flush sends at most ten reports, prioritizing the current hour before older
unsent history. A persisted 30-attempt rolling-hour budget survives restart, and
a 429 pauses the whole backlog. A bounded rotating scan checks acknowledged
buckets for late corrections. Queue writes are atomic and private;
attempts are recorded before transport. Restart preserves frozen bodies and the
six-attempt budget. A lost acknowledgement may cause identical physical retries;
pending reports retry their original bytes. After acknowledgment, a changed
hourly projection replaces that bucket's totals; unchanged projections are skipped.
Corrupt state fails closed rather than reconstructing already-sealed history.

Desktop release builds embed `APP_TELEMETRY_ENDPOINT` from the build environment
as a public fallback in the daemon bundle. A runtime value overrides it; an
explicitly blank runtime value disables it. With neither a runtime value nor a
bundled endpoint, there are no requests, discovery or health checks. Its value is supplied outside Git; HTTPS is required except for explicit
loopback HTTP test receivers. Requests have a ten-second deadline, no credentials
or provider headers, and no redirect following. Network failures, 408, 429 and 5xx
retry with bounded jittered backoff and a capped Retry-After; other responses end
the report. Bodies and response contents never enter logs. App actions do not
wait for telemetry work or present delivery failures.

Disable/reset abort transport and purge activity/pending work
without waiting for ledger reads or acknowledgement. Revocation becomes visible
in memory as soon as requested, including while an earlier consent callback is
pending. Every await before sending is followed by an authority guard;
obsolete work cannot restore a purged report. Preview I/O does not hold the consent
mutation lock, and obsolete preview results are rejected after a transition.
Cancellation is requested even when saving consent fails. Failed user actions
remain visible; durable opt-out still requires a successful local consent write.

The uploader workflow uses temporary real SQLite/private files, fake time and a
loopback HTTP receiver. Repeat with
`npm run test -w @workspace/backend -- telemetry/__tests__/upload-service.spec.ts`.
Set `TELEMETRY_TEST_EVIDENCE` to an untracked output file to retain the off/on trace
and exact retry body. This proves local transport behavior, not production
infrastructure privacy. Dependency/AST lint isolates telemetry callers from
transport/timers and allows only runtime composition of the upload service.

Profile preview resolves identity inside the backend. Previews while sharing is
off are hypothetical and cannot enqueue history. An unfinished UTC day is
provisional. For a completed day, a legacy daily report supplied by the delivery owner
takes precedence and returns its body verbatim. Preview and copy preserve that
text without parsing or reserialization.
The repeatable `npm run test:telemetry-dom -w @workspace/vue` harness exercises real
Vue/Element Plus controls with a synthetic desktop API and writes screenshots and
DOM evidence outside Git; temporary-ledger workflows own persistence evidence.
The consent no-IP-storage statement requires collector, proxy and upstream
verification before release activation; a local fixture cannot establish it.

Inclusive input includes cache reads and Claude cache creation. Cached input means
reads only; output already includes reasoning. The input-minus-read remainder
includes writes, so it is not an ordinary-rate fresh-input measurement. Claude's
request observer retains write lifetimes, while execution totals collapse them.
Codex execution cache-write counters, including a schema default of zero, do not
establish inclusion semantics, write lifetime or independently billable request
evidence. The projection uses existing ledger estimate coverage, including its
execution fallbacks; it neither invents request evidence nor reprices usage. Its
omitted cache-write categories prevent exact downstream repricing. Estimated USD
is API-equivalent usage, not billing.

The server-usage workflow compares persisted Claude/Codex measurements against
`client/backend/src/usage/__tests__/fixtures/daily-telemetry.json`, the exact canonical
macOS UTF-8 body without a trailing newline. Other platforms substitute only the
coarse OS value. Repeat with
`npm run test -w @workspace/backend -- usage/__tests__/server-usage.spec.ts`.
It covers UTC bucket attribution, model changes, nulls and
content/local-dimension canaries without an endpoint. Architecture AST lint limits
projection dependencies and rejects direct network/timer operations.

Claude throughput timing consumes transient SDK response activity, including thinking
and tool-input generation. Tool rows can appear before their inputs finish streaming;
response generation keeps the clock active until the response ends, then outstanding
tools pause it. These numeric signals stay in the daemon and are not persisted or
sent to clients. Stored historical timing samples retain their recorded values.

Performance reuses the ledger's additive speed samples: measured output tokens,
active generation milliseconds, summed time to first output, and their turn
counts. Only hourly provider/model/tier sums enter the optional closed performance
object; no per-turn timing or timestamps are exported. Missing samples are
unavailable, not zero. The read API divides the summed output by summed time and
the summed first-output time by its measured-turn count. It never averages
per-install rates. Older reports remain valid without performance fields.
The consent file's second format pauses an older enabled opt-in and presents the
updated explanation before any expanded sharing. Existing declines stay declined.

Hosted ingestion, authentication, reporting and deployment live under `server/`.
See [the hosted server documentation](../server/README.md) for that independent
process boundary. Desktop consent, projection and upload remain daemon-owned.
