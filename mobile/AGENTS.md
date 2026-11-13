# mobile

The iOS and Android companion apps and the engine they share. They reach a paired
desktop through the companion relay. Follow the root [AGENTS.md](../AGENTS.md) as
well; shared contracts live in [`core/`](../core/AGENTS.md).

## Layout

- `src/`: the shared TypeScript engine (companion transport, request ledger,
  conversation and draft state, caches). Tested with Vitest.
- `web/`: the Vue views hosted inside the native apps, built on the shared
  `@workspace/vue` UI.
- `native/`: the Noise session bundle the native shells use for the secure link.
- `ios/`: the SwiftUI app, its Swift package and tests.
- `android/`: the Kotlin app and its tests.
- `app-store/`: store artwork and listing assets.
- `scripts/`: native and browser verification runners.

## Rules

- **Strict backwards compatibility.** Every endpoint and wire contract the app
  consumes must keep working for shipped clients. This is the root Mobile API
  Compatibility rule; the evidence belongs at the owning runtime boundary and the
  handoff names the released-client baseline.
- **Mobile is isolated from the desktop runtime.** It never imports Electron, the
  daemon, desktop packages, harness drivers or `codex-sdk`; it consumes `core`
  contracts, the companion protocol and the SDKs' portable entries (neutral
  `multi-agent-sdk` contracts and replicas, `agent-ui-sdk` browser UI) only.
  `npm run lint:architecture` enforces it. It supports whatever harnesses the desktop
  runs and never branches on one: show capabilities the desktop reports.
- **The wire says `team`, the screens say Workspace.** Keep the protocol names for
  shipped clients; user-visible text follows the product word.
- **The desktop owns the work.** The phone shows and drives agents that run on the
  laptop. Do not add behavior that assumes the phone can run agents, hold
  provider credentials or reach a repository directly.
- **Keep the native shells thin.** Product logic, state and caching live in the
  engine so iOS and Android behave the same and can be tested in Vitest. Native
  code owns platform concerns: secure storage, notifications, dictation, layout.
- **Apple toolchain.** Run Xcode commands through
  `node mobile/scripts/ios.mjs xcode <arguments>`, including archives and exports.
  The wrapper gives Apple's system tools precedence over user-installed copies
  so distribution packaging uses compatible tools.

## Verify

- `npm test -w @workspace/mobile` and `npm run lint -w @workspace/mobile`.
- Native, scroll and release checks are separate scripts in `package.json`
  (`test:native`, `test:native:*`, `test:scroll`); run the ones for the platform
  you changed. Build or install on a device only when the task asks for it.
- Docs: `docs/backend-architecture.md` (companion gateway and relay invariants)
  and `docs/testing.md#mobile-compatibility-evidence`.
