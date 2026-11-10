# client

The desktop product. Follow the root [AGENTS.md](../AGENTS.md) too; shared contracts
live in [`core/`](../core/AGENTS.md). `backend` is the local daemon (`daemon`),
`electron` is desktop main, preload and packaging, `vue` is the shared Vue UI (also
used by the mobile web views), and `cli` owns standalone terminal recovery and
control. The CLI may reuse backend modules while remaining runnable without
Electron or a running daemon. Electron Forge, TypeScript, Vue 3 with Element Plus,
Vitest.

## Process Boundaries

- Electron main is the desktop adapter: windows, preload IPC, native dialogs, app
  lifecycle, packaged resources, and the stdio client that reaches `daemon`.
- `daemon` owns backend processes, drivers, provider protocols, approvals, server
  requests, persistence, filesystem access, git, automations and agent runtime state.
- The renderer owns visual state and interactions. It never talks to a provider,
  spawns tools, reads arbitrary local files or depends on backend protocol types.
- Preload is a small, typed, explicit IPC bridge. Coordination events become
  app-owned before reaching the renderer; provider traffic stays inside an app-owned
  routing envelope.
- Backend-dependent features enter through app-owned contracts and the protocol first:
  extend a driver method or capability behind `daemon`, route Electron through
  `BackendClient`, keep renderer components free of Codex/Claude branches.
- Theme with semantic tokens and CSS variables; no hard-coded product colors.

## Providers

Codex and Claude Code run as provider drivers in `daemon`. Provider conversations
stay provider-owned: `multi-agents-sdk` owns native conversation state, reducers,
replicas and transport primitives; `ai-app-sdk` owns generic conversation UI.
Korus stores the thread reference,
transports snapshots and events, and adds coordination metadata. Fix generic Codex
behavior in the SDK; Codex product policy lives in the driver. `RendererMessage` is an
app-owned DTO where explicitly needed, not a live transcript. New providers arrive as
hosts behind `daemon`, not as a global transcript reducer. `CODEX_APP_SDK_SOURCE=1`
links the sibling SDK source directories (`CODEX_APP_SDK_SOURCE_ROOT` selects
their common parent).

Optional telemetry is isolated by lint: only the local runtime composes the uploader,
provider and pricing code cannot depend on it, and its endpoint is runtime config.

Use the [provider integration checklist](../docs/provider-integration.md)
for new providers and capability changes. Reuse shared coordination and UI; qualify
native behavior independently from transport support.

## Packaging, Docs And Verify

Forge signs and notarizes macOS builds by default, which is slow and reserved for
release work; for verification use `APP_SKIP_SIGNING=1 npm run package` (or `build`).
Read: `docs/backend-architecture.md` (daemon rules, packaging, auto-update, companion
gateway and relay), `docs/codex.md`, `docs/claude.md`, `docs/antigravity.md` and
`docs/cursor.md` (provider integration),
`docs/mcp.md` and `docs/custom-tools.md` (MCP server and tools), `docs/frontend.md`
(UI, with the `korus-frontend-dev` skill), `docs/agent-provider-selection.md`,
`docs/agent-isolation.md` (unimplemented design note), `docs/codex.png` (target shell) and
`docs/research/` for dated evidence. Test with `npm test -w @workspace/backend`,
`-w @workspace/vue`, `-w @workspace/electron` or `npm run test:integration`; check UI
in the real app with `korus-live-preview`.
