# client

The desktop product. Follow the root [AGENTS.md](../AGENTS.md) as well; the shared
contracts live in [`core/`](../core/AGENTS.md).

- `client/backend` (`@workspace/backend`): the local daemon, called `daemon`.
- `client/electron` (`@workspace/electron`): desktop main, preload, packaging.
- `client/vue` (`@workspace/vue`): the shared Vue UI used by the desktop renderer
  and the mobile web views.

Electron and Electron Forge, TypeScript throughout, Vue 3 with Element Plus for the
renderer, Vitest for unit, component, contract and desktop workflow tests.

## Process Boundaries

Preserve the product and process boundaries:

- Electron main is the desktop adapter. It owns windows, preload IPC, native
  dialogs, app lifecycle, packaged resource resolution, and the stdio client
  used to reach `daemon`.
- `daemon` owns backend process lifecycle beyond the Electron-to-backend stdio
  process, backend drivers, provider protocols, approvals, server requests,
  app persistence, backend-owned filesystem access, git, automations, and agent
  runtime state.
- Renderer owns visual state and interactions. It must not talk directly to
  Codex app-server or any future backend process, spawn tools, read arbitrary
  local files, or depend on backend protocol types.
- Preload exposes a small typed IPC bridge. Keep it boring and explicit.
- Coordination events become app-owned before reaching renderer state.
  Provider conversation traffic keeps its provider-native snapshot/event inside
  an app-owned routing envelope.
- Backend-dependent Korus product features must enter through app-owned
  contracts and the backend protocol first. Add or extend an optional driver
  method or capability behind `daemon`, route Electron through
  `BackendClient`, and keep renderer components free of Codex/Claude
  protocol branches.
- Theme support must use semantic tokens and CSS variables. Do not hard-code
  product colors inside components.

## Providers

Codex and Claude Code are supported through provider drivers in `daemon`.
Electron and the renderer use app-owned contracts rather than talking directly to
either provider runtime.

- Provider conversations stay provider-owned end to end. For Codex,
  `codex-app-sdk` owns the conversation snapshot/reducer, optimistic messages,
  history, turn mutations, queues, and generic conversation UI. Korus stores the
  thread reference, transports SDK snapshots/events, invokes SDK operations,
  and adds Korus-specific coordination metadata. When generic Codex conversation
  behavior is missing or wrong, fix it in the SDK and consume that fix here.
- Codex-specific product policy belongs in the Codex driver/adapter; generic
  Codex conversation behavior belongs in `codex-app-sdk`, not in Korus
  renderer state or wrappers.
- `RendererMessage` remains an app-owned DTO where Korus explicitly needs one,
  including the normalized Claude host and cross-provider historical reads. It
  is not a live Codex transcript model.
- Future provider support should arrive through provider hosts behind `daemon`,
  app-owned capability seams, and provider-owned conversation replicas, not a
  new global Korus transcript reducer.

Development uses installed `codex-app-sdk` packages by default. Set
`CODEX_APP_SDK_SOURCE=1` to link the sibling `../codex-app-sdk` source instead;
set `CODEX_APP_SDK_SOURCE_ROOT` to use another checkout. Source linking does not
require rebuilding, releasing or reinstalling the SDK during development.

## Telemetry

Optional telemetry is isolated by lint: only the local runtime composes the
uploader, provider and pricing code cannot depend on telemetry, and the endpoint
comes from runtime configuration only. Do not add another transport, scheduler
or reader of its contracts.

## Build And Packaging

The desktop app builds through Electron Forge. Keep build outputs, generated
protocol bindings, copied renderer code, and packaged resources clearly separated
from source code.

Packaging signs and notarizes macOS builds by default, which can take a long time
and is reserved for explicit release or signing work. For normal agent
verification that needs Forge packaging, set `APP_SKIP_SIGNING=1` so Forge skips
macOS app signing, notarization, and bundled helper signing:

```bash
APP_SKIP_SIGNING=1 npm run package
APP_SKIP_SIGNING=1 npm run build
```

## Docs To Read

- `docs/backend-architecture.md`: `daemon` design rules, transports, runtime
  packaging, GitHub desktop releases, auto-update, security. Read its companion
  gateway and relay invariants before changing or reviewing mobile access.
- `docs/codex.md`: read before changing Codex conversation state, rendering,
  actions, history, or transport; SDK/Korus ownership boundary.
- `docs/claude.md`: Claude Agent SDK integration, homes, history, capabilities.
- `docs/research/claude-capabilities.md`: read before adding Claude steering,
  forks, goals, turn mutations, or context controls; dated runtime evidence.
- `docs/mcp.md`: the app-owned MCP server model: identity, enablement,
  collaboration, contextual tool families, Computer Use, hosted gateway.
- `docs/custom-tools.md`: use when adding or presenting an MCP tool.
- `docs/frontend.md`: renderer ownership, canonical UI, interaction and styling
  conventions, Visualize canvases. Read before editing UI, together with the
  `korus-frontend-dev` skill.
- `docs/agent-provider-selection.md`: how Codex or Claude is chosen for new work.
- `docs/agent-isolation.md`: unimplemented design note on shared-checkout
  warnings.
- `docs/research/provider-handoff.md`: read when designing cross-provider
  continuation; dated evidence.
- `docs/research/synara.md`: competitive analysis; dated source evidence, not a
  roadmap.
- `docs/codex.png`: visual reference for the target shell.

## Verify

`npm test -w @workspace/backend`, `-w @workspace/vue` and `-w @workspace/electron`,
or the focused `npm run test:integration`. UI changes are also checked in the real
app with the `korus-live-preview` skill.
