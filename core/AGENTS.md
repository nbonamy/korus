# core

`@workspace/core` holds the platform-neutral product contracts and state
primitives that every other area builds on: app-owned types, the backend protocol,
snapshot and reducer logic, and pure helpers shared by the desktop, the mobile
app and the hosted console. Its modules are imported by path (`@workspace/core/<module>`
maps to `src/<module>.ts`). Follow the root [AGENTS.md](../AGENTS.md) as well.

## Rules

- **Stay platform-neutral.** No Electron, daemon, harness runtime or browser-only
  dependencies. The mobile app and the hosted console import `core` too, so a new
  import here widens what they can reach. Keep helpers pure and side-effect free.
  SDK imports are limited to `multi-agent-sdk`'s neutral contracts and replicas and
  `agent-ui-sdk`'s `/host` and `/browser` leaves; harness drivers, providers, ACP,
  tools, `codex-sdk` and the renderer and trusted-runtime exports are forbidden
  (`npm run lint:architecture` enforces it).
- **Contracts are harness-neutral.** No harness-named fields or branches: describe
  differences as capabilities, models and settings. `team` is the code and wire name
  of what the product calls a workspace; do not rename it, since shipped phones and
  older remote hosts use it.
- **App-owned contracts first.** Backend-dependent product features enter through
  the contracts and the backend protocol in `src/backend-protocol/`, then the
  daemon, then the renderer. `docs/protocol.md` has the conventions; the method
  catalog is the code.
- **Wire contracts are compatibility surfaces.** Anything the mobile app reads
  (companion protocol, projections, notifications, shared endpoints) must stay
  backwards compatible with shipped mobile clients. Extend with optional fields or
  explicit negotiation; never repurpose or remove one. See the Mobile API
  Compatibility section of the root file and `docs/testing.md`.
- **Product identity lives in `src/product.json`.** Read it for visible names,
  URLs and paths; do not hard-code the product name in identifiers, package
  names, filenames or CSS.
- **Telemetry and usage contracts are closed.** The telemetry projection, the
  collector and the private console may import only an allowlist of `core`
  modules; `npm run lint:architecture` enforces it. Add a field only with its
  consumers in view, and never put prompts, paths or other user content into a
  telemetry contract.
- **Days are decided on read.** Usage is stored with exact timestamps and the
  reader's timezone decides which day a turn belongs to (`usage-time`).

## Verify

- `npm test -w @workspace/core` and `npm run lint -w @workspace/core`; the
  statement coverage gate is 85% like every workspace.
- Contract changes need a test at the owning runtime boundary in the consumer
  (daemon, renderer, mobile), not only in `core`.
