# Backend Protocol

The app-owned JSON-RPC 2.0 protocol between clients (Electron main, the web
adapter, SSH peers) and `daemon`, one JSON message per line over stdio, the local
Unix socket and SSH stdio. Provider protocols (Codex app-server, Claude stream
messages, Antigravity ACP, MCP) never cross it.

**The catalog is the code.** Methods are in `core/src/backend-protocol/methods.ts`,
typed params/results in the shared request map, error codes in
`core/src/backend-protocol/rpc.ts`, event unions in `core/src/contracts/events.ts`
(`BackendPublishedEvent`: domain facts, provider conversation frames and explicit
client effects are separate exported unions; `client.connectionChanged` is
renderer-local). This document records the conventions behind them.

## Conventions

Creation commands can return an explicit created-agent identity with their client
snapshot when requested. Callers use that identity rather than inferring a command
outcome from the currently selected agent. Legacy snapshot responses retain their
shape; client navigation remains separate from the shared product operation.

- Names are `resource[/subresource]/verb`, lower camel case, action last.
  Renames have no aliases: stale local or remote daemons must be restarted or
  synced.
- State-mutating methods return the authoritative `AppSnapshot`. Mutations persist
  before `snapshot.updated` is published. Read acknowledgments use a bounded agent
  metadata event instead of resending the workspace and complete after persistence.
- Scope prefixes matter: `client/*` methods mutate one client's profile
  (navigation, ordering, preferences) and never another client's; the rest are
  backend-scoped. `_clientId` request metadata selects the profile and is stripped
  before dispatch. Forwarded daemon calls use a separate remote-controller profile,
  never the remote desktop's.
- Client commands never load conversations as a side effect. Clients request
  `agent/conversation/load` explicitly, and snapshot queries perform no
  maintenance (startup maintenance is runtime initialization).
- Location-scoped methods take optional `remoteConnectionId` / `location`; omitted
  means local. Agent-scoped methods route through the agent's owning location.
- Unsupported optional capabilities answer deterministically: archive returns
  `{ supported: false }`; unsupported history or summary reads are errors, never
  empty successes. Provider catalog UI respects advertised capabilities.
- `driver/*`, `workspace/*` and a few `source/*` methods are backend-internal. Client
  code uses the app-level methods.

## Directions

- **Client → daemon:** product requests.
- **daemon → client notifications:** one method, `backend/event/notify`, carrying a
  sequenced `AppBackendEvent` and a small derived `clientState`.
- **daemon → client requests:** host callbacks for native effects only (open
  external, browser open/execute, spoken announcement, permission surfaces),
  currently implemented by Electron. Unknown methods answer `methodNotFound`; a
  throwing callback answers `internalError`. Each side owns the request IDs it
  sends.

## Synchronization

`snapshot/get` returns `{ snapshot, lastEventSeq, clientState }`. The snapshot is
authoritative and transcript-free; between snapshots clients replay only sequenced
`daemon` events through the shared reducer.

Electron and the renderer use a subscribe-buffer-snapshot barrier: subscribe, buffer
notifications while reading `snapshot/get`, discard events at or below
`lastEventSeq`, apply only contiguous events above it. A gap triggers a fresh
barrier. After a global gap the renderer also invalidates cached provider frames
and re-requests conversation snapshots (including inactive and split-pane ones),
because an app snapshot cannot replace a missed provider completion event.
Clients ignore unknown event types.

Provider conversations travel as one bounded reset followed by revisioned deltas in
`codex.conversation*`, `claude.conversation*` and `antigravity.conversation*` frames.
Electron forwards them unreduced; clients validate session identity, reject stale
or gapped revisions and rehydrate through app-owned conversation operations.

Event ingress is untrusted on every transport (stdio, socket, SSH, WebSocket):
decode the complete typed event before publishing. A malformed notification is
logged with structural path/reason only (never payload values) and dropped without
closing the connection or disturbing pending requests. Malformed JSON or JSON-RPC
framing keeps each transport's own error and reconnect policy.

## Lifecycles Owned By The Protocol

- **Agent requests** (approvals, questions, tool confirmations) appear in
  `AppSnapshot.agentRequests` through `agentRequest.created` / `.resolved`, with
  native transcript frames unchanged. Provider handles are never persisted;
  responses route by agent and request ID, guard concurrent submissions, allow retry
  after transport failure, and are invalidated by release or resolution. An
  untargeted response is accepted only when its request ID is unambiguous.
  Antigravity native questions/approvals use app-owned answered/decision/cancelled
  outcomes; clients never interpret ACP frames.
- **Plan review** persists proposal identity, content and decision status
  (`Agent.planReview`). Replaying a completion never reopens a resolved proposal;
  the response command rejects stale or conflicting decisions, accepts an identical
  one idempotently, and stays pending until prompt acceptance succeeds. Cancel
  submits nothing.
- **Provider authentication:** `provider/authenticate` routes explicit Antigravity
  native login/cancellation to the owning daemon. Connection observations remain
  separate from saved enablement.
- **Provider usage:** quota events update per-engine state; remote quota stays on
  its owning host. Missing utilization is not zero. `provider/usage/get` returning
  `null` means no subscription quota, not a failure. Authentication metadata on
  connection observations is runtime-only and credential-free.
- **Reconnect:** a dropped established connection retries the same transport; it
  never starts a fresh bundled daemon (see
  [backend-architecture.md](backend-architecture.md#transports)).

## Attachments

Local desktop registry resolution is the trusted ingestion boundary; renderer paths
are never provider input. Web prompts reject attachments until trusted upload exists;
remote prompts reject them before forwarding until trusted transfer exists.

## Ownership

Product state belongs to `daemon`; Electron and the renderer cache snapshots and
replay events and never invent mutations. Filesystem reads, git, provider tokens
and calls, automations and scheduling stay in `daemon`. Electron owns only native
affordances (windows, menus, dialogs, `openExternal`, native permission callbacks,
speech helper and playback, process launching, transport plumbing).
