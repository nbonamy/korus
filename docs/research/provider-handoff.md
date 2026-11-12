# Provider handoff: goal, boundaries, and evidence

Implemented in Korus 0.26.0. This document retains the handoff design decisions,
lifecycle contracts, and dated validation evidence from October 3, 2026.
Worktree setup and validation notes below are historical, not outstanding work.

## Implemented workflow

**Hand off… replaces the current Korus agent with a new agent in the same workspace, using a note written by the current agent.** The old provider conversation and files are preserved.

- Entry in the agent context menu (sidebar and Cockpit) and native Agent menu.
- No permanent header button and no conversation flag.
- Compact dialog: title only, provider and model on one row, optional instructions below; workspace path stays secondary. No explanatory header paragraph.
- Choose the destination provider and model. Optional **Additional handoff instructions** tell the current agent what to emphasize in its note.
- The current agent writes the note using its existing context. Korus waits for that exact turn to finish, saves the note, closes the source, creates the replacement, saves its identity, and starts it with the note.
- The replacement uses the destination provider's normal Korus defaults, including permissions. A selected model overrides the model only. Source-provider permissions are not translated.
- Same-provider replacement is also valid. A handoff is sequential replacement, not a parallel worker.

These decisions supersede the initial research suggestion of selecting transcript excerpts and creating an unsent draft. Nicolas explicitly clarified that the optional text is guidance for the current agent to write the note. No further product decision is required for this scoped MVP.

## Distinguish the three goals

| Goal | Korus behavior |
| --- | --- |
| Replace the current agent, keeping useful context | Hand off: new identity/session, same folder, note, close source |
| Delegate to another agent on the same branch | Existing `create-agent` with the current folder and no worktree creation; source remains |
| Delegate to another agent on a worktree | Existing Delegate to worktree flag and `create-agent` with `createWorktree: true`; source remains |

The current [delegation flag](../../client/backend/src/agents/agent-thread-flag-service.ts) already prompts the source to write a self-contained brief and call `create-agent`. The [MCP creation path](../../client/backend/src/mcp/service.ts) supports backend/model selection, optional worktree creation, the caller's team, and initial-send acceptance. Therefore note authorship and provider-selectable delegation are existing concepts; closing the source and preserving a durable replacement relationship are the missing product behavior.

A **fork** duplicates a provider-native conversation while retaining the source. **Resume/session migration** attaches an existing provider-native session. Neither transfers Codex-native state into Claude or vice versa. Handoff passes ordinary text and keeps each provider's transcript, history implementation, and reducer intact. See [Codex ownership](../codex.md), [driver contract](../../core/src/backend-driver.ts), and [agent operations](../../core/src/agent-manager.ts).

## Synara: reference, not an architecture mandate

Inspected read-only checkout: `/Users/nbonamy/src/synara`, commit `cb760d5b5eace10c3e823feb8dc5a39748f0c67e`.

The [official handoff guide](https://www.trysynara.com/docs/workflows/handoffs), read October 3, presents continuing a task with a different provider in the same environment, rather than parallel delegation. Documentation describes intended use; it does not establish runtime enforcement.

The inspected [bootstrap code](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/orchestration/handoff.ts) mechanically clips transcript text: 32,000 characters overall, six recent messages at up to 2,400 each, older messages at up to 320 each, with omissions. **It does not ask the current agent to write a fresh handoff note.**

The [runtime reactor](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts) and [handoff UI](https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/web/src/hooks/useThreadHandoff.ts) distinguish two paths:

- In-place handoff stops/replaces the source runtime and clears its native resume cursor while retaining the visible task.
- New-thread handoff creates a linked target and navigates to it. The inspected path does not archive or lock the original thread.

Korus adopts sequential replacement and bounded context, not Synara's transcript import or in-place provider rebinding. No Synara runtime was executed during this investigation.

## Context and source linkage

The note requests the objective, user constraints and decisions, completed work, verification evidence, relevant files, unfinished work, and next action. It tells the source to distinguish observation from assumptions, omit secrets, and avoid tools, file changes, agent creation, or Git operations during note preparation. Those are generation instructions, not a new provider tool sandbox.

Additional instructions are bounded to 4,000 JavaScript string units. The generated note must be nonempty and no more than 32,000 units; oversize notes fail instead of silently truncating constraints. Only complete assistant text from the accepted note-writing turn is forwarded. Reasoning, arbitrary tool output, binary attachments, and provider session internals are not mechanically exported. The source can mention relevant files in its note; the replacement sees the same files through its own workspace access.

The immutable source reference contains provider identity and thread/session identity; Claude history also retains its folder. The handoff record retains source title, source Korus ID, target Korus ID, chosen destination, operation ID, phase, note, and error. The current target's team supplies its owning host. A saved-note disclosure and read-only source-conversation viewer are available in Hand off. An interrupted/failed operation also exposes its error and saved note directly above the conversation.

The note is normal application data in the private roster and client snapshot, not a claim of automatic secret detection. Do not log it or send it through collaboration status messages.

## Exact owners and contracts

| Owner | Contract/responsibility |
| --- | --- |
| [AgentHandoffInput / AgentHandoff](../../core/src/agent-handoff.ts) | App-owned request, durable metadata, input limits, product eligibility |
| [AgentHandoffDialog](../../client/vue/src/components/AgentHandoffDialog.vue) | Provider/model selection, optional note-writing instructions, progress/error and saved note; no provider protocol logic |
| [Context menu](../../client/vue/src/components/AgentContextMenu.vue), [Agent menu](../../client/electron/src/main/app-menu.ts), AppShell command routing | Open the same interaction; no header action/flag |
| [Protocol](../../core/src/backend-protocol/methods.ts), preload, Electron controller, web operations | `agent/handoff/start` with `{ agentId, input }`; bounded extended request timeout; owning-host routing |
| [AgentHandoffService](../../client/backend/src/agents/agent-handoff-service.ts) | Serialize one operation by source/operation ID, validate, persist, retire source, create target, transfer product relationships, start once |
| [Handoff note capture](../../client/backend/src/agents/handoff-note.ts) | Observe accepted turn ID, require successful completion, read final assistant text through the provider-owned history boundary |
| [Driver RPC](../../client/backend/src/driver-rpc.ts) | Optional driver `assertHandoffReady`, exposed as `driver/handoff/check`; unsupported implementations fail closed |
| [Codex driver/adapter](../../client/backend/src/codex/codex-host-adapter.ts) | SDK-owned active turn, busy, queued prompts, approvals, client requests; archive through SDK before releasing the Korus attachment |
| [Claude host](../../client/backend/src/claude/claude-host.ts) | Active turn/pending permission readiness; live replica read preserves accepted-turn identity; await session release |
| [Claude SDK transport](../../client/backend/src/claude/agent-sdk-transport.ts) | Close only the source query, then await public iterator cleanup where exposed; no global process restart |
| [Prompt manager](../../client/backend/src/agents/agent-prompt-manager.ts), [send hooks](../../core/src/agent-chat-service.ts), server product routing | Suspend source prompt admission/drain during handoff; internal handoff sends use a backend-only hook |
| [Historical read allowlist](../../client/backend/src/agents/agent-conversation-service.ts) | Permit the retained source reference through the target, including cross-provider historical DTO reads |
| [State persistence](../../client/backend/src/state-persistence.ts), [field policy](../../client/backend/src/persistence/agent-fields.ts), [store](../../client/backend/src/persistence/store.ts) | Round-trip additive metadata in the existing roster; recover interruption without automatic provider replay |

There is no new global transcript reducer, no SDK capability flip, no transcript impersonation, and no universal handoff/delegation framework.

## Idle boundary and workspace policy

Eligibility is checked before note generation and again after it completes. Ordinary folder agents need an existing session and idle status. Block queued prompts, pending requests, active goals, review-owned agents, Mission workers, running native subagents known to Korus, and active delegated Korus children. Quick Chats are outside the MVP.

Provider readiness is checked independently of the Korus status label. Note completion is not itself proof of idle: Codex's SDK queue/requests and Claude's active turn/permission owners must be checked.

Korus prevents competing source mutations during the operation, including team moves. MCP delivery queues incoming messages while handoff is pending; direct steering is guarded in driver RPC. Eligibility is checked again after retirement: a late message keeps the source roster entry and its queue, even if its provider session was already archived/released. Removing the source with its team aborts replacement creation. The ordinary Stop action can interrupt note preparation; an interrupted result is not a valid note. Note capture also bounds the final history read by its deadline.

The same folder, branch, and uncommitted files carry over. There is no checkout, commit, stash, reset, merge, worktree creation, or deletion. PR tracking and work assignments move to the replacement; existing completed-child parent references are updated. The delegating parent's identity remains the parent.

This is a source-to-target lifecycle guarantee within Korus, **not an operating-system filesystem lock**. Other independently created agents and external processes can already use the same directory. Detached terminals, arbitrary background shell processes, and out-of-band CLI clients are not inventoried or killed. Full background-task discovery remains a provider/runtime question, and the Claude capabilities audit was independent; its unreceived runtime conclusions are not assumed here.

Remote handoff executes on the owning daemon. Target choices and model discovery use that host. Neither history reads nor agent creation falls back to the local host when remote access fails. The linked target allows a retry to route back to its owning daemon after the source disappears. A remote daemon without the method must report unsupported; cross-host workspace migration is excluded.

## Ordering, failure, retry, and restart

1. Persist `preparing` on the source before sending the note request.
2. Observe the exact accepted turn's successful completion. Failed/interrupted/missing/oversize notes retain the source.
3. Recheck eligibility/readiness, save the note and `closing`, then archive/release the source runtime.
4. Create the target in the same folder, transfer Korus metadata, remove the source from the active roster, and persist `starting` with the note before sending target work.
5. Persist `complete` once the target's initial prompt is accepted. This means accepted, not that the target finished the task.

A retirement failure keeps the source roster entry and its saved note. A post-retirement failure keeps the replacement and note if already created. Saving can fail after a provider action; Korus cannot atomically commit a provider RPC with a roster rename. The UI reports failure rather than promising rollback.

Repeated requests with the same source/operation identity do not create another target or replay a prompt. Reusing an ID with changed inputs is rejected. A failed operation requires explicit user inspection; reopening Hand off is a new operation. On startup, incomplete records become failed with an explanation and no automatic send. In an uncertain target-send window, inspect provider history before manually sending the note. The target session ID can be unknown if acceptance reached the provider but never reached durable local storage.

Persistence metadata is additive and optional inside the existing agent entity, so schema version 1 is retained. Older writers may discard it; downgrade is not lossless recovery of a handoff record. This does not add a new provider session format, a shared durable workspace lease, or a guarantee of power-loss atomicity across all application files. See [schemas](../../client/backend/src/persistence/schema.ts) and [layout](../../client/backend/src/persistence/layout.ts).

## Rejected complexity

- In-place cross-provider session mutation or transcript translation.
- User-managed transcript selection, attachment packing, and a new global context model.
- A second review-and-send wizard or compulsory header affordance.
- A new worktree option inside handoff; existing delegation owns that choice.
- Automatic stop-and-transfer of active turns, approvals, goals, Missions, or reviews.
- Automatic retry of an ambiguous target start, distributed transactions, global filesystem leases, or cross-host migration.
- A new capability flag for existing Codex/Claude fork/resume/steer support.

## Evidence and validation

Source baselines: Korus `307e2e3530038ca7471d4dab81532514c69415b9` (0.25.0), sibling SDK `576bce8ddc5287425b0f2785ad49f7e3def6c310`, Synara commit above. The original uncommitted comparative report at `./docs/research/synara.md` was read as background.

The isolated worktree was initialized with `npm ci --ignore-scripts --no-audit --no-fund` to avoid shared SDK prepare builds. Its needed existing environment file was kept private (0600); no live Korus state was copied. Dev overrides remain `file:../codex-app-sdk/packages/*`, with `install-links=true`. Installed copies were refreshed directly from the sibling's existing build, without modifying/rebuilding the sibling. All are 0.12.6. Vue initially had stale hash `8bc380b77c38a2cce488185c134f80c3f9c2305bc631c827be477674b13a6561`; refreshed sibling hash is `ba7d1d4d2b1c7cf47e1772e0b898c334d4c9940ec0f39e0af052a8279a0534dc`. The stale bundle caused four existing Claude controlled-pane tests to fail; refreshing resolved them.

Automated validation uses fake provider/SDK boundaries, not live accounts:

- Source failure, persist failure, duplicate requests, ambiguous send, restart recovery, persistence round-trip, late inbox delivery, source removal, and history-read timeout.
- Both Codex→Claude and Claude→Codex server routing; competing prompt rejection; no target start before source runtime release; retained source history access.
- Exact-turn capture, including completion-before-acceptance ordering and interrupted-turn rejection.
- Codex SDK readiness and Claude live final-note identity; awaited Claude transport cleanup.
- Context/native menu actions, dialog instructions and blockers, and failed-operation note visibility.

Browser DOM validation rendered the real menu/dialog components in an isolated synthetic fixture: menu opened the dialog, default model label was correct, and optional instructions reached the synthetic submission callback. This is frontend runtime evidence only, not full desktop/provider handoff proof.

Validation passed: full `npm run test:ai` (337 core, 1,005 backend, 1,276 Vue, 304 Electron, 30 web tests, plus script tests), all workspace typechecks, architecture lint, and Vue CSS/i18n lint. One additional focused remote retry test verifies owning-host routing after the source disappears. Browser DOM inspection confirms the compact dialog has a 50px title header and provider/model fields immediately below. No real provider turns, installed-app restart, commit, push, or merge were performed. No Synara or sibling SDK source changes were made.

Useful primary documentation: [Codex App Server](https://developers.openai.com/codex/app-server), [Claude Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions), and the installed Claude SDK `Query.close()/return()` contract. Documentation/source inspection is not evidence of a live handoff or physical subprocess-exit timing.
