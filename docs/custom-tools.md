# Custom MCP Tools

How to add a tool to the `korus` MCP server ([mcp.md](mcp.md) describes the model).
A tool is a product capability, not an MCP schema: `daemon` owns its behavior, the
app-owned protocol carries any client effect, and Vue owns its presentation. Use the
smallest path that works: a pure coordinator query needs no renderer event; a native
desktop action does.

```text
backend agent -> korus MCP tool -> daemon coordinator/service
              -> optional app-owned event or client request -> renderer / Electron
```

Provider adapters only make the server available; tool semantics stay
provider-neutral.

## Steps

1. Define the domain input and result.
2. Implement it in `AppMcpAgentCoordinator` (agent/team state transitions, effects
   injected as callbacks so it has no renderer or Electron dependency) or in
   `AppMcpService` when it needs the snapshot, a driver, persistence or an app
   event. Shared event payloads go in `core/src/contracts.ts`, durable reductions in
   core, transient visual effects in Vue. Route through Electron only for genuinely
   native capabilities.
3. Register the schema and handler in the module that owns the behavior.
4. Add an app-owned event or client request only if the effect crosses the backend
   boundary.
5. Add tool-row presentation if the generic `Ran …` title is not enough.
6. Cover every boundary crossed (below).

Done means the tool is model-discoverable, its result is bounded and useful, its UI
effect is observable, and live and restored rows render the same meaning.

## Registration

Tool families are self-contained modules resolved per authenticated request;
`backend/src/mcp/tools.ts` only composes the modules its providers return. A
contextual family (such as Visualize) is an `AppMcpToolModuleProvider` whose
`resolve` returns a module only for an agent in that context, attached via
`AppMcpServiceOptions.toolModuleProviders`. Never add a family-specific branch to
the composer or to unrelated modules. Provider and module IDs are unique and
composition rejects duplicates. A module can claim a shared workflow capability
(Mission owns proposed actions, so the collaboration `finish_turn` schema omits the
generic proposal flags).

- Descriptions state the operation's contract, scope and essential restraints;
  parameter descriptions explain inputs, not workflows. Multi-step procedures
  belong in bundled skills, reached by a short trigger in the owning tool or
  assignment. Keep identity, authorization and turn-lifecycle essentials in
  `backend/src/mcp/agent-prompts.ts`; task prompts supply actual scope, state and
  delivery authority rather than repeating the procedure.
- Caller identity comes from the agent-scoped URL; never add an agent ID to a schema.
- Wrap handlers in `loggedToolResult()`; raise deliberate domain errors with
  `McpToolError` (anything else still becomes an `isError` result).

## Status Has Two Meanings

`set-status` changes the agent (`statusText`, cleared when the turn completes, short
and about current activity), independent of runtime state (`idle`, `working`,
`awaitingInput`, `error`). A tool that changes agent state makes the transition
explicit and emits its app-owned event; never infer state from how a row renders.

A tool-call's `running`/`completed`/`failed` lifecycle is presentation of the
conversation row only and never touches `statusText`. `set-status` and `finish_turn`
are hidden from the conversation (dedicated UI) but remain in the provider
transcript.

## Structured Results And Bounded Data

Return results with `structuredToolResult()` (stable keys such as `success`,
`kind`, `message`). Korus does not persist arbitrary tool input and output, since
provider payloads can contain large output, screenshots, file content or secrets.
`backend/src/codex/codex-surface-adapter.ts` projects an **allowlist** of
presentation-safe keys before messages enter state. To surface a new value: use a
small scalar or bounded object, add only that key to the projection, add a
real-shape adapter regression proving it survives live and hydrated history, and
keep large or sensitive siblings out. A denylist is wrong here because a new
provider field would reach durable snapshots before anyone classified it.

## Tool-Row Presentation

`vue/src/tool-presentation.ts` (recognized tools, icons), `tool-title-presenter.ts`
(phase-aware titles and targets) and `i18n/messages.ts` (running, completed, failed
strings). A visible tool needs a `TOOL_KEYS` entry, a semantic icon group and all
three lifecycle strings ("Creating / Created / Failed creating worktree
feature/x"). Presenters must tolerate missing fields (older persisted
conversations lack new metadata). Rows are status summaries; raw IDs and payloads
belong in expanded content or logs.

## Client Effects

Transient effects (celebrations, spoken acknowledgments) are requested, never
guaranteed: the result confirms `requested`, not `displayed`.

- `finish_turn` can pick one flag, one finish announcement and one celebration in a
  single call. Flags come from a strict allowlist in core and describe typed thread
  state, not presentation. `announcement.text` is trimmed to 160 characters
  and the phase is implied by the tool.
- Celebration requests are boolean. The daemon randomly chooses a visual effect,
  excluding its previous choice; receiving clients still apply display eligibility.
- Spoken acknowledgments: `daemon` applies persisted enablement and dictated-input
  policy and sends the provider-neutral `client/spokenAnnouncement/queue` request
  with no voice or client assumption. Electron picks the current client's voice,
  rechecks mute, selected-agent and foreground eligibility at playback, cancels
  speech that becomes ineligible, and returns as soon as its single no-overlap queue
  accepts the phrase (it coalesces and rate-limits). Phrase text and suppression
  reasons stay out of the MCP result and the normalized renderer projections.
  Synthesis failure is silent and never fails or delays the task; there is no
  system-voice fallback. A new platform implements the same one-phrase helper
  protocol behind this seam, with no renderer branches or provider-specific tools.

## Tests

One focused test per seam crossed: registration/schema/routing
(`backend/src/mcp/__tests__/tools.spec.ts`), domain behavior
(`agent-coordinator.spec.ts`), snapshot mutation, events and client effects
(`service.spec.ts`), bounded projection (`codex-surface-adapter.spec.ts`), durable
reducers (`core/src/__tests__`), titles and icons
(`vue/src/__tests__/tool-title-presenter.spec.ts`, `tool-presentation.spec.ts`), and
component or app-state tests for visible effects. Start with the smallest red test.
