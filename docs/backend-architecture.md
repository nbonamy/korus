# Backend Architecture

`daemon` is the Korus product backend: a separate Node process that orchestrates
Codex app-server, Claude Code, Antigravity ACP, the Korus MCP server, git, files,
automations, work integrations and persistent state behind one app-owned protocol. It is not a
replacement for Codex app-server. Ownership rules live in
[architecture.md](architecture.md); message contracts in [protocol.md](protocol.md).

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

## Antigravity

`backend/src/antigravity` owns installation and discovery of the ACP
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

## Transports

The protocol is transport-neutral JSON-RPC 2.0, one message per line.

| Transport | Use |
| --- | --- |
| stdio (`korusd --stdio`) | bundled local backend; same framing SSH uses |
| Unix socket (`korusd serve`, `APP_HOME/daemon.sock`) | optional always-on single-host daemon |
| SSH stdio | remote locations: `ssh <host> "node ~/.korus/daemon.mjs connect \|\| exec node ~/.korus/daemon.mjs --stdio"` |
| WebSocket (web host) | browser, allowlisted operations only |

- Electron's default `APP_BACKEND_MODE=auto` connects to a running local daemon,
  else starts the bundled stdio process. On reconnect it retries the same
  transport with bounded backoff and **never** falls back to a fresh bundled
  daemon after an established connection drops: that would fork authoritative
  state.
- `connect` bridges SSH stdio to a remote `daemon serve` socket when one is
  running, else the shell fallback starts a one-shot stdio backend. Sync never
  installs, starts or restarts a persistent remote daemon.
- No unauthenticated LAN server. Keep Unix sockets in a user-private `APP_HOME`;
  bind any HTTP transport (including the MCP server) to loopback. Add per-user
  tokens before named pipes, cross-user access or any network transport. TCP or
  WebSocket remote control needs its own authenticated design first.
- `stdout` is reserved for JSON-RPC in stdio mode; diagnostics go to stderr and
  `$APP_HOME/logs/daemon.log` (structured JSONL, size-rotated). Redact prompts,
  tokens, OAuth codes, command secrets and file contents from logs.
- Requests carry deadlines (`core/src/backend-protocol/request-timeout.ts`) so no
  client waits forever; Electron adds a grace period so a remote timeout reaches
  the desktop first.

### Companion gateway and relay

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
Retained conversation routing data excludes app snapshots, is capped at 64 agents,
and is pruned against workspace membership; disabling access or stopping the service
clears it. The gateway exposes no generic RPC, filesystem or shell forwarding.
Prompt admission carries the captured session identity through remote routing and
provider preflight. The owning daemon checks it before dispatch; a stale session is
a confirmed rejection rather than a prompt in a replacement conversation.

The desktop's remote-access keep-awake preference covers both Codex remote access
and Korus mobile access. The companion publishes durable access enablement into
daemon client state, including after restart; relay reconnects do not release it.
Electron applies the policy only on AC power and owns the native sleep blocker.

Mobile updates use one authenticated duplex stream per phone. A workspace reset
and a subscribe-before-read conversation barrier precede ordered provider-native
deltas. The phone uses the existing provider replicas, never a second transcript
reducer. Workspace projections are sent on change; heartbeat messages carry no
app state. Sequence gaps, provider revision gaps and reconnects rehydrate from the
authoritative daemon. Stream queues and subscription counts are bounded; revocation
and stream closure dispose listeners and buffered work.

Pending questions, tool confirmations and approvals travel in the workspace's
app-owned request projection. Responses carry the owning host, team, agent,
session and request conversation identity. The gateway checks that identity and
the daemon request owner validates the decision scope and consumes the request.
The native sheet retains entered answers on failure; a failed acknowledgment
triggers reconciliation, never automatic replay or authorization.

The visible conversation remains subscribed. Leaving it starts a five-minute
expiry while its replica continues to receive events. Viewing it again cancels
expiry; incoming events do not extend it. Expiry discards the replica and removes
the subscription. Session changes invalidate the old replica, and app backgrounding
closes the update stream and clears the subscription cache.

The separate relay executable has a persistent pinned identity. Public admission
accepts fresh laptop identities without accounts or operator enrollment. Short-lived,
bounded host leases own routing state; the laptop refreshes its device grants and
pairing windows while connected. Temporary pairing routes remain time/rate bounded;
paired routes derive from daemon grants. Endpoints enforce companion methods after
Noise authentication; the relay cannot inspect encrypted application frames. Circuit
duration and data budgets force an explicit reconnect and authoritative rehydrate.
An optional nonempty `hostIds` configuration restricts a privately operated relay.
Public admission never replaces pairing proof or explicit desktop approval.

Both endpoints initiate outbound WSS connections. The product metadata supplies the
public relay URL and pinned peer identity. `APP_COMPANION_RELAY_URL` and
`APP_COMPANION_RELAY_PEER_ID` override these together; the daemon also honors a relay
saved by an explicit `enable` call when no environment override exists. The phone
build reads the same environment pair, so a phone needs only a pairing code.
Changing the phone build's relay clears saved pairings for other relays; the phone
pairs again instead of restoring a stale development connection. The first
invitation turns mobile access on. An invalid or partial environment pair
fails closed instead of silently selecting another relay.

The host deployment templates under `backend/companion-relay/deploy` terminate TLS
in nginx and keep relay and health listeners on loopback. Certbot uses the nginx
ACME webroot and reloads nginx after successful renewal. Only published Cloudflare
proxy ranges may supply the client address used for connection and request limits;
direct clients retain their socket address. nginx overwrites `X-Real-IP` and the
relay accepts it only in explicit `trustedProxy` mode on a loopback listener.
Connection rates, concurrent sockets and laptop leases are bounded per source,
so rotating peer identities does not consume an unrelated client’s allowance.
Circuit reservations and admission leases share a bounded lifetime.
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

The phone pins the introduced laptop identity when establishing its Noise circuit.
The laptop independently consumes the invitation for that authenticated phone and
requires explicit desktop approval before granting app access. Approval persists the
phone identity; the phone stores the laptop and relay identities in protected storage,
never the code. Rejection, expiry and daemon restart invalidate pending invitations.
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

### Background daemon (macOS)

Settings can install a per-user LaunchAgent that runs `daemon serve`, so agents and
automations survive closing the window. Enabling it does not move the current
session off its transport; the next launch in `auto` mode connects to it. At
startup Electron compares the packaged `korusd --version` with the running
daemon's health version: a stale idle daemon is refreshed silently, while active
agents or automation runs prompt for a restart.

### Remote Hosts (SSH)

Connection records live in `daemon`. Sync uploads the self-contained `daemon.mjs`,
mirrors `provider-tokens.json` and asks the remote to reload connections. It never
installs provider CLIs or copies state files, shell profiles or conversation data.
Provider detection and authentication run on the owning host. Version
discovery still accepts the previous `daemon` CLI name for hosts not yet upgraded.

## Development

`npm run dev` is the Electron-first entrypoint. It builds `daemon` to a dev bundle
and supervises a fresh local stdio backend instead of reusing an installed daemon
of the same version. Backend changes rebuild and restart the process (no HMR) and
the client re-syncs with `snapshot/get`; only durable state survives, and active
turns, pending approvals and in-memory MCP sessions are interrupted. Protocol
changes may require restarting both processes. Renderer changes keep Vite HMR.

`npm run dev:web` is the web equivalent: it builds `daemon` once, watches the web
server bundle (restarting server and daemon on change) and serves the client from Vite
with HMR, proxying `/app` to the server. `CODEX_APP_SDK_SOURCE=1` links the sibling SDK
sources for HMR, as in desktop dev. Use `APP_HOME` to keep it off your real state.
`APP_BACKEND_MODE=in-process` exists for bisecting.

Folder-changing provider actions are rejected while chats are active because they
restart `daemon` and its provider processes; Electron closes hosted Browser panes
first and the client reloads from the synchronized snapshot so no cached
conversation or sequence cursor outlives the backend instance.

## Runtime And Packaging

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
- Provider CLIs are external prerequisites discovered on the owning host's PATH.
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
latest`) is the only release command. It requires a clean checkout of the default
branch whose HEAD is pushed, creates the remote `v<version>` tag at HEAD (reusing
one already at HEAD, refusing one elsewhere or an already published release),
dispatches **one** workflow from that tag, and watches it to completion, printing
one line per job state change. Never move a release tag.

- The workflow (`.github/workflows/desktop-build.yml`) is quality, four native
  builds, publish. Because it is dispatched from the tag, the workflow, scripts and
  app source all come from the same immutable commit; a release-tooling fix means a
  new version.
- Release tests run on Linux; macOS-only signing cleanup tests gate the macOS
  build. Publishing requires both the release test gate and every native build.
- The independent Quality workflow runs on every push, PR and manual dispatch,
  retaining coverage reports and enforcing the five 85% statement gates. Release
  tests run without coverage and have no dependency on the Quality workflow.
- Only the final job has contents-write permission. It requires every platform to
  ship its full installer set, stages them on a draft release, then publishes the
  requested channel. Published releases are never modified; an interrupted run
  leaves a draft that a rerun completes.
- Artifact names carry no run attempt, so `gh run rerun <id> --failed` yields a
  complete set. Resume watching with `npm run release:watch -- <run-id>`.
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

`npm run dev:relay` reads `APP_COMPANION_APNS_KEY_ID`,
`APP_COMPANION_APNS_TEAM_ID`, `APP_COMPANION_APNS_KEY_FILE` and
`APP_COMPANION_APNS_ENVIRONMENT` (`development` or `production`) from the environment
or ignored `.env`. Without APNs configuration the foreground notification stream
remains available. An APNs acceptance response is not proof of OS delivery; verify
background delivery and tap navigation on a signed device separately.
