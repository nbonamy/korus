# Claude conversation capability audit

Historical evidence: October 3–4, 2026. The steering, native fork, and goal
integration described below is merged and included in Korus 0.26.0. Baseline
capability tables and worktree validation notes record the investigation at
that time; they are not a current backlog or release gate. Read
[Claude integration](../claude.md) for the maintained integration guidance.

## Implementation follow-up

Nicolas subsequently authorized implementation. This section supersedes the audit's original missing-integration classifications and research-only handoff below.

| Capability | Implemented behavior | Evidence |
| --- | --- | --- |
| Steering | Implemented. Inputs enter the active SDK query; UUID replay acknowledgments keep Korus busy through any additional result. Stopping a steered turn closes its owned query so queued work cannot survive into the next send. | Fake-SDK → real driver → backend RPC tests; authenticated driver probe below. |
| Native fork/resume | Implemented. Same-folder, idle forks use `forkSession`; selected turns resolve to native persisted boundaries, including trailing goal records. Incomplete tool chains have no selectable cutoff. Child messages get their own native IDs; existing resume reapplies query configuration. | Native helper boundary test, history safety fixture, real driver fork/child recall; earlier R5 proves fresh-process independence. |
| Goals | Implemented. Set/clear invoke native `/goal`; structured `goal_status` transcript attachments drive completion, clearing and hydration. Interrupted/error turns map active goals to paused/blocked. Unknown or unreadable goal state cannot claim completion. | Goal parsing/lifecycle tests, bounded real native goal and resumed-clear probes. |

These remain Korus-owned integration changes behind the existing driver/RPC contracts. No renderer provider protocol branch, sibling SDK change or new global reducer was added. Existing controls are enabled by the three Claude capabilities. Edit/retry/delete and other context-control flags remain as audited. Resume was already implemented.

Delivery is still **tool-boundary or next-turn input**, not immediate preemption. Stopping the owned query does not undo tool side effects. Native goal hooks must be enabled; goal token budgets and Codex-specific status semantics are not implemented. Goal state uses the observed CLI transcript format because SDK 0.3.226 does not expose `active_goal` through its public iterator. The adapter bounds disk refresh retries and rejects stale refreshes after newer work or release. Live goal iteration counters are not streamed.

The next separate slice is edit/retry by native branching at a retained boundary. Decide its visible branch/replacement behavior before implementation. Cross-workspace forks, remote/account-store migration, compacted histories, and restoring file checkpoints/background processes remain outside this slice.

### R7 — real Korus driver integration

Loaded the actual worktree transport/host through Vite's server-side module loader in a disposable Node process. The injected **real SDK query factory** retained Korus lifecycle logic but constrained the probe: scratch cwd, Sonnet, no built-in tools or production MCP servers, empty settings sources, native goal hooks enabled, four turns, USD 0.15 per query, and a 60-second whole-probe watchdog. This is real driver/SDK/CLI evidence, **not installed-Korus UI evidence**. SDK/CLI versions match the table below.

1. Ask for numbers 1–80. At the first assistant delta, call the driver's `steerPrompt` with a request for `CLAW_STEER_GREEN`. The final collected output contains both 80 and the marker, and one Korus completion arrives after the steered answer.
2. Call `forkConversation` with that completed Korus turn ID. The native child ID differs. Start the child via the same driver and ask for the prior marker; it recalls `CLAW_STEER_GREEN`.
3. Call `setGoal` requesting `CLAW_GOAL_GREEN`. Observe a provider-derived `conversation.goalUpdated` with status `complete`. Call `clearGoal`; it returns `cleared: true`.

Sanitized final probe output:

```json
{"event":"steering_finished","sawOriginal":true,"sawUpdate":true}
{"event":"fork","independent":true}
{"event":"child_resume","recalled":true}
{"event":"goal","status":"complete","objective":"The assistant has replied with exactly CLAW_GOAL_GREEN."}
{"event":"goal_clear","cleared":true}
```

The initial integration run found a real history lookup bug: Korus replaced only path separators, whereas Claude replaces all non-alphanumeric characters in project-directory names. A scratch folder containing a dot reproduced it. The adapter now uses the native encoding, and a persisted-history test covers dots/underscores. No shared SDK artifacts were rebuilt.

Additional native goal evidence: a fresh bounded goal requiring a future user marker hit `error_max_turns`; a new process resumed it and `/goal clear` returned `Goal cleared`. Only these structured attachment fields were retained:

```json
{"type":"goal_status","met":false,"sentinel":true,"condition":"…"}
{"type":"goal_status","met":false,"condition":"…","reason":"…"}
{"type":"goal_status","met":true,"sentinel":true,"condition":"…"}
```

Successful evaluation instead emits `met: true` without the sentinel, with `iterations`, `durationMs` and `tokens`. This distinction prevents confusing explicit clear with completion. UUID replay probing also confirmed that `--replay-user-messages` returns the exact injected UUID with `isReplay: true`; enqueue alone is never used as the completion receipt.

The report retains reproduction inputs/results; sanitized fixtures live in the relevant tests. Raw account-bearing transcripts and scratch probe logs are not repository artifacts. Source inspection and mocked boundary tests do not stand in for R7's real model calls.

### Implementation verification

- Final `npm run test:ai` **passed**: core 338, backend 1,001, Vue 1,273, Electron 304, web 30, and script checks 12 (2,958 total). Core, backend and Vue typechecks also passed against the refreshed SDK artifacts described below.
- Mounted shell/split-pane steering checks pass, including the correct target agent and queued-prompt button. The unsupported-runtime fallback test now explicitly supplies `steerPrompt: false` instead of assuming all Claude runtimes lack steering.
- After final review caught attachment preparation reordering queued input, the transport now serializes submissions. Its real-filesystem regression proves original prompt → attached steering → subsequent steering ordering. Focused transport/backend boundary tests were rerun after that fix.
- Backend, core and Vue typechecks, architecture lint, script tests (12), and `git diff --check` passed. No coverage threshold or production policy was relaxed.
- The initial Electron failures were caused by concurrent extraction of an incomplete dependency installation inside this worktree. Its generated `dist` was moved aside and installed once; all 304 Electron tests then passed. This did not launch Electron or touch installed Korus.

The earlier failures in `AgentConversationPanel.spec.ts` (“composer approval”) and `AppShell.spec.ts` (“projects Claude approvals”) were **stale installed SDK artifacts, not an established owner-code defect**. Replacing the changed core modules with `HEAD` still used those same stale artifacts, so that baseline experiment did not isolate the SDK package boundary. Main identified the missing provenance check. The worktree's five local `@codex-app-sdk` copies were 0.12.6; main's existing built set was 0.13.0. Only those worktree-local dependency copies were refreshed from `/Users/nbonamy/src/codex-claw/node_modules/@codex-app-sdk/{backend,core,electron,vue,web}`. Complete package-content digests then matched main for all five packages, and both approval tests passed in the full suite.

Vue `dist/index.js` SHA-256 before refresh: `8bc380b77c38a2cce488185c134f80c3f9c2305bc631c827be477674b13a6561`. Validated artifact SHA-256 after refresh: `24cf0413b70e21dc8dcaa94900b0867071f59da447a76e8a0b2e2d3574a3882a`. This validation depends on that existing 0.13.0 artifact set; repository manifests, lockfiles and source aliases were not changed. No approval code change was needed. The sibling SDK and Synara remain unchanged. Investigation and validation involved no shared SDK rebuild, commit, push, merge, installed-app restart or live-agent interruption; Nicolas subsequently authorized committing and pushing this branch.

## Original audit findings and recommended decision

Korus's disabled Claude capabilities are **not a reliable inventory of runtime limitations**. Authenticated SDK probes now establish that queued input can change work **after a tool finishes, within the original turn**, while input sent during text generation waits for a second turn. Both native fork APIs preserved a selected history prefix and left the source unchanged; the helper-created parent and child resumed independently in fresh Node/CLI processes. A native `/goal` workflow also ran successfully. These are missing Korus integrations, with important delivery and lifecycle differences still to handle. [C1], [R4], [R5], [R6]

Recommend an **idle, same-workspace native fork** as the next implementation slice. The basic runtime prerequisite is now proven for text history; completed tool/compaction boundaries and Korus integration still need tests. Active-turn input follows with explicit queued/delivered semantics and ownership of subsequent result events. Keep existing capability flags unchanged until implementation and its gates pass. Do not introduce a global conversation reducer or implement provider behavior in renderer components. [C2], [C3], [R4], [R5]

The steering result is model-sensitive: Sonnet followed the injected update; Haiku referred to the update within the same turn but rejected it as prompt injection, with both a minimal system prompt and the Claude Code preset. Delivery is demonstrated; uniform obedience is not. No running tool was cancelled and no immediate preemption was demonstrated. [R4]

The comparative report at the main checkout's `docs/research/synara.md` motivated this audit; it was read there because it is uncommitted and absent from this worktree. Synara is a reference implementation, not runtime proof.

## Evidence levels and environment

- **Implemented in Korus** means inspected production integration, not a claim of live validation this turn.
- **Missing integration** means an owning SDK/runtime contract exists but the Korus workflow is absent.
- **Runtime unsupported** is reserved for a specific unsupported operation, not inferred from a false Korus flag.
- **Unproven** means public/source evidence or this probe cannot establish the requested semantics.

| Component | Inspected version |
| --- | --- |
| Korus | 0.25.0; `307e2e3530038ca7471d4dab81532514c69415b9` |
| Worktree branch | `research/claude-capabilities` |
| Synara | `cb760d5b5eace10c3e823feb8dc5a39748f0c67e` |
| Installed `@anthropic-ai/claude-agent-sdk` | 0.3.226, installed with this worktree's `npm ci` |
| Claude executable | `~/.local/bin/claude`, `2.1.288 (Claude Code)`; init event also reported 2.1.288 |
| Probe models | `haiku` → `claude-haiku-4-5-20251001`; `sonnet` → `claude-sonnet-5-5`, as reported by runtime init |
| Host | macOS 27.0.1 arm64; Node v22.19.0 |
| SDK bundle SHA-256 | `70c16db85d75e8aa46f558d35ab34138ec6f18d6e260f78e62e2cae4d24967a8` |

Primary evidence comprises Korus/Synara source, installed SDK declarations and implementation, official documentation, an offline fork fixture, and authenticated steering/fork/resume/goal/context probes. R1/R3 retain earlier authentication/quota failures as historical evidence; those blockers were resolved before R4–R6. Official web docs can describe newer or differently configured runtime behavior. SDK package version and CLI version are independent; Korus explicitly selects an external executable. [C4]

## Audit baseline capability classification

| Capability | Classification | Evidence and qualification | Owner of remaining work |
| --- | --- | --- | --- |
| Persistent multi-turn input | **Implemented in Korus** | One streaming-input query per session, subsequent idle turns pushed into its queue. | Korus transport; Anthropic owns runtime semantics. [C4] |
| Active-turn queued input | **Missing integration**; tool-boundary delivery **runtime-proven** | Sonnet skipped the second tool after injected input; text-only input produced a later second result. Haiku received but rejected the tool-boundary update. | Korus host/transport, delivery state and app capability contract. [C4], [C5], [S1], [R4] |
| Immediate preemptive steering / Codex-equivalent receipt | **Unproven** as a broader capability | Ordinary queue insertion was not preemptive in the text-generation probe. No interrupt/send-now operation was tested; queue acceptance is not a consumption receipt. | Anthropic SDK/runtime contract first, then Korus adapter. [K2], [R4] |
| Native resume | **Implemented in Korus** | Same-provider/folder validation and SDK `resume`. Authenticated parent/child recall after fresh Node/CLI starts passed at the SDK boundary, not through the installed Korus UI. | Existing Korus integration. [C4], [C5], [R5] |
| Native conversation fork | **Missing integration**; text-history behavior **runtime-proven** | Both public APIs preserved the selected prefix and source. Helper fork had fresh message IDs and independent cold-resumed histories. | Korus fork driver method and native cursor mapping. [C2], [K1], [R2], [R5] |
| Goals | **Missing integration**; lifecycle mapping **unproven** | Native set/answer/status/clear flow succeeded; failed Haiku goal continued until max-turn bound. No `active_goal` event appeared in these SDK streams. | Korus goal contract/host; Anthropic SDK if structured state is not publicly exposed. [C1], [C5], [K3], [R6] |
| Edit/retry a past turn | **Missing integration**; exact workflow **unproven** | Fork plus `resumeSessionAt` demonstrably excludes a later text turn. This proves a primitive, not Korus edit/retry semantics or in-place rollback. | Korus transaction, native boundary mapping, hydration. [C2], [K4], [R5] |
| Delete/truncate suffix of turns | **Missing integration**; exact workflow **unproven** | Can select earlier context on restart/fork; that is not in-place deletion of persisted history. | Korus semantics and transaction; do not promise physical deletion. [K4] |
| Arbitrary in-place deletion of one historical turn | **Unproven / no public operation found** | No corresponding public Query/session mutation API in installed declarations. Retained-transcript bootstrap is a new conversation. Absence is not proof of impossibility in all Claude interfaces. | Runtime API if native mutation required; Korus if explicit reconstruction is desired. [K1], [K4], [S2] |
| Context usage gauge | **Implemented in Korus** | Live `getContextUsage()` returned token/category totals before and after a model response. Korus also has a non-persisting cold inspection path, not exercised here. | Existing Korus integration. [C4], [R6] |
| Manual/automatic compaction | **Implemented in Korus** | `/compact [instructions]`, status/boundary handling and history restoration. No compaction runtime probe this turn. | Existing Korus integration. [C5], [C6] |
| Replace conversation with summary | **Missing integration** | Korus's generic method exists, Claude driver lacks it. A summary/new-session product flow is possible but is not native `/compact`. | Korus transaction; coordinate separately with handoff design if implemented. [C2] |
| File rewind as conversation rollback | **Runtime unsupported for that meaning** | `rewindFiles()` restores tracked filesystem changes; it does not rewind conversation context. | Separate Korus workspace-recovery feature, if desired. [A4], [K4] |
| Model/effort controls | **Implemented in Korus** | Catalog dynamically enables reasoning effort; transport applies model and effort changes before idle turns. Static `reasoningEffort: false` is overridden by catalog support. | Existing integration; do not infer missing support from static table alone. [C4], [C7] |
| Explicit thinking-token budget | **Missing integration** | Korus flag false; SDK exposes thinking options and deprecated setter. Different from context compaction or a goal budget. | Korus product choice, then adapter. [C1], [K2] |

## Active-turn input: where the boundary actually is

Synara's `steerTurn` builds a normal user message, calls `Queue.offer(context.promptQueue, ...)`, emits `turn.steered`, and returns the existing turn ID. It falls back to normal send when there is no live non-synthetic turn. **Its emitted event acknowledges application enqueue, not provider/model consumption.** No consumption receipt is awaited in this method. [S1]

Official interactive-mode documentation says queued messages reach Claude once running tool calls finish, within the same turn; remaining messages run after the turn ends. Streaming-input documentation describes sequential queued input. R4 now demonstrates both cases through the installed Agent SDK: Sonnet changed course after a controlled tool returned, whereas text generation completed before the update produced a second result. This supports **tool-boundary input**, not immediate modification of an in-progress model completion or cancellation of an in-flight tool. [A1], [A5], [R4]

The installed SDK's `SDKUserMessage` includes `uuid`, `priority: 'now' | 'next' | 'later'`, and `shouldQuery`. `shouldQuery: false` appends context without starting a response. Its declaration does not document enough priority behavior to justify choosing `now` as a supported Codex-equivalent steer. `Query.interrupt()` returns a receipt on capable CLIs; queued input can survive interruption. The lower-level interrupt request type additionally describes `cancel_queued`, while public `Query.interrupt()` has no options argument. Do not reach into private transport methods to manufacture a stronger contract. [K2]

The real probe's init advertised `interrupt_receipt_v1`, `interrupt_cancel_queued_v1`, `interrupt_send_now_v1`, and `msg_lifecycle_v1`. Those control capabilities remain advertisement-only evidence; R4 used ordinary UUID-stamped user messages without a `priority` override and did not call interrupt. The Haiku refusal is model-output evidence, not proof that the runtime classified the update as malicious. [R1], [R4]

Korus currently associates one active transport callback with a query and resolves it on the first `result`. The host also completes/removes its active turn at that event. A flag-only enablement could accept extra input, then orphan output arriving after the original result. Idle messages are not handled as an independent new turn by that transport callback. Implement acceptance, delivery, result-boundary ownership, interruption and retained queue state together. The existing ordinary multi-turn path is not sufficient. [C4], [C5]

Reproduction method used for R4; remaining race/cancellation cases must pass before product exposure:

1. Use a fresh disposable cwd, no production MCP servers, no built-in filesystem/shell tools, and a controlled SDK MCP gate. Bound each query by six model/tool turns, USD 0.15, and a 60-second watchdog.
2. Ask for gate one, then gate two, then `ORIGINAL_RED`. While gate one is held, inject a UUID-stamped user message requesting skip gate two and answer `STEERED_GREEN`; do not interrupt.
3. Record injection, any provider receipt, gate release, subsequent tool/model messages, and **all results until the injected message settles**. A first-result-only collector is insufficient for a negative finding.
4. Same-turn evidence requires the changed behavior before the original result boundary, after gate one returns. A later second response establishes next-turn delivery. Enqueue or echo alone proves neither.
5. Separately inject during text generation (done). Multiple queued messages, interruption with queued input, late acceptance at the result race, and reconnect remain untested. Do not infer these outcomes from the single tool-gate case.

## Native fork and resume

Two supported SDK entry points must not be conflated:

- `forkSession(sourceId, { dir, upToMessageId?, title? })` copies stored transcript entries immediately without starting a model. The cutoff is inclusive. It returns a fresh session ID; message UUIDs and parent links are remapped. File-history snapshots are not copied. [K1]
- `query({ prompt, options: { resume: sourceId, forkSession: true } })` creates a branch as a runtime query. `resumeSessionAt` limits the loaded chain; `sessionId` can supply a custom destination only with the supported fork combination. [K4], [A2]

The offline fixture proves helper-level independence and persistence. The subsequent authenticated probe supplies the missing text-history evidence: the child remembered its shared seed and child marker, the parent remembered its seed and parent marker, and neither acquired the other's private marker. Every query used a fresh Node process and CLI child. The separate query-fork path also honored the earlier cutoff and preserved the source. Real tool/compaction histories still require validation. [R2], [R5]

Relevant constraints:

- Fork an **idle completed source**, freeze the exact native chain boundary and serialize source selection against new work. A tool-use assistant entry can precede its result; selecting it would leave an incomplete tool transaction. Structured-output/end-turn-tool sessions may end on a tool-result carrier plus attachment, not an assistant entry. [K4], [S2]
- Store app turn IDs separately from native chain UUIDs. Korus synthesizes normalized IDs and groups assistant parts; those display IDs are not safe arguments to `upToMessageId` or `resumeSessionAt`. The fork remaps UUIDs, so source native pins must not be retained as child pins. [C6], [K1]
- Use the owning daemon's configured Claude home for **both** in-process session helpers and CLI subprocesses. `dir` selects the project, not an account. Korus already deliberately aligns these environments. Synara refuses stopped account-scoped native forks when it cannot safely identify the store. [C4], [S2]
- Disk history must be retained; `persistSession: false` cannot supply later cold resume. A new query must reapply model, instructions, tools, MCP configuration and permission policy. The transcript is not a saved live process. [C4], [K4]
- Keep the first slice in the same workspace. Korus validates resume folder equality. Session independence does **not** isolate filesystem writes; two branches in one folder still share files. Moving to a different cwd/worktree needs explicit mapping and validation. [C5], [A2]
- Do not restore or claim copied undo snapshots/background tasks/subagent processes. The helper is a conversation-history branch; those resources are not demonstrated to transfer. [K1]
- Same-host same-store cold read and CLI restart with actual model recall were proven for text history. Crash recovery, account-scoped forks, remote hosts, cross-worktree resume and incomplete tool histories remain unproven here. [R5]

The installed minified implementation (`forkSession` export → `_$/b$` at SDK bundle line 123) filters sidechain entries, slices at a matching UUID, remaps IDs/parent links, skips progress entries, records `forkedFrom`, and writes a new file in the source project store. This supports the fixture result. It does not validate that every possible cutoff is a safe semantic turn boundary. [K1]

## Goals, turn mutation, and context controls

### Goals

The old blanket claim that Claude lacks goals is outdated. Official docs describe `/goal` as a session-scoped Stop-hook evaluator, including non-interactive execution, clear/status and restore-on-resume behavior. Hook/trust policy can disable it. This is a native Claude workflow, not evidence of identical Codex budget/status semantics. [A3]

SDK 0.3.226 exports `SDKActiveGoalMessage` with condition, iterations, start time/token baseline and last reason. However, its public `SDKMessage` union used by `Query` does **not** include that type; the internal stdout union does. R6 observed native goal behavior but no `active_goal` event in the public query iterator. Structured state exposure remains unresolved; do not infer it from the existence of a declaration. Korus's message handler currently handles system, assistant, stream, user and result messages, not `active_goal`. [K3], [C5], [R6]

Korus's app-owned goal model includes active/paused/blocked/usageLimited/budgetLimited/complete states. Mapping `active_goal.value === null` to complete would discard the distinction between clear, success and failure. Budget enforcement, cancellation and restored state need a deliberate mapping. R6 enabled native hooks in an isolated configuration and observed set → answer → no-active-goal plus a bounded failure loop. Clear of an already-empty goal is not proof of cancelling an active goal; resume and active cancellation remain untested. [C8], [A3], [R6]

### Edit, retry, delete

Synara's adapter explicitly rejects `rollbackThread` and delegates session restart plus retained-transcript bootstrap to its ProviderService. That is an application fallback, not native rollback evidence. [S2]

For Korus, prefer a branch/restart transaction preserving the original over editing SDK JSONL files directly. Edit/retry can fork at the **last kept chain entry**, then submit revised/original input. First-turn replacement can create a fresh session. Decide whether the UI creates a visible branch or replaces the selected reference; do not silently describe a new provider session as an in-place edit. [K1], [K4]

`resumeDropsTurn` is a useful installed SDK guard for truncating headless resumes: it rejects a discarded tail containing unrelated queued input or task notifications. The declaration requires recovery by dropping the pending rewind target and resuming normally, not retrying the same rejected truncation. It also warns that interactive/background-worker routes ignore this pair. This is version/lane-specific, so do not blindly pass it across all execution modes. [K4]

Conversation truncation never proves filesystem rollback. Native file checkpoints cover selected editing tools, not arbitrary Bash effects, and `rewindFiles` explicitly leaves conversation context intact. Destructive erasure of original persisted messages is a separate requirement from excluding them in a new branch. [A4]

### Context

Context gauge, `/compact`, and compaction lifecycle already belong to the Claude host/transport. Preserve that implementation. A user-selected replacement summary, selective history removal and explicit thinking budget are separate features. Do not use `/clear` or a synthesized summary as an undocumented substitute for native forks. [C4], [C5], [C6]

## Reproduction evidence

### R1 — live executable, authentication blocked

The scratch probe used `query()` with an asynchronous user-message queue, `persistSession: false`, `settingSources: []`, `settings: { disableAllHooks: true }`, `tools: []`, strict MCP configuration and one harmless in-process gate tool. Only the gate was allowed. It inherited the existing account environment (`CLAUDE_CONFIG_DIR` was present); no credential values or account identity were read/logged, copied or changed. These intentionally reduced settings differ from Korus's normal user/project/local settings, so the failure does **not** establish that installed Korus or every configured Claude account is unauthenticated. [A6]

Observed sanitized event sequence, milliseconds from probe start:

```text
451  system/init: CLI 2.1.288, model claude-haiku-4-5-20251001
462  assistant text: Not logged in · Please run /login
462  result: subtype success, same login text, total_cost_usd 0
1003 cleanup complete; gate calls []
```

A subsequent read-only `claude auth status --json` check reported `loggedIn: false` both with the inherited default-home override and with that override removed. Only the boolean was retained. Korus normally removes an explicit default-home override because credential lookup differs; see `client/backend/src/claude/config-directory.ts`. No login was attempted.

The result subtype alone is not evidence of model success. No gate ran, no second prompt was injected, no steering timing was measured. The query was closed in `finally`. No further authenticated probe was attempted during that initial pass; the authentication question was raised with Nicolas. He first chose to finish with runtime findings unproven, then signed in and requested continuation; see R3. Raw generated logs remain disposable scratch data, not repository fixtures.

### R2 — actual installed SDK, synthetic disk fixture, no model

Used an empty scratch `CLAUDE_CONFIG_DIR`, not live Korus/Claude state. Constructed one minimal four-entry JSONL chain (`COMMON_SEED`, `COMMON_ACK`, `PARENT_TAIL`, `PARENT_ACK`) with valid session/message UUIDs, `parentUuid`, cwd, timestamps, user/assistant roles and terminal assistant stop reasons. Then:

```js
const fork = await forkSession(sourceId, {
  dir: canonicalScratchCwd,
  upToMessageId: firstAssistantUuid,
  title: 'Synthetic capability fixture',
});
const source = await getSessionMessages(sourceId, { dir: canonicalScratchCwd });
const child = await getSessionMessages(fork.sessionId, { dir: canonicalScratchCwd });
```

Assertions passed: source length 4; child length 2; different session IDs; all child message UUIDs fresh; second child entry points at the first child UUID; source bytes unchanged. Appended a synthetic `CHILD_ONLY` user entry to the **scratch child**. In a separate Node process, source length stayed 4 and child length became 3; source excluded `CHILD_ONLY`, child excluded `PARENT_TAIL`.

The first fixture attempt used `/tmp` rather than its macOS canonical `/private/tmp` path and failed lookup. Canonicalizing cwd before deriving the project directory made it pass. This is evidence that fixture/project-directory lookup must use the same canonicalization as the SDK, not a general assertion about all production path aliases.

These assertions exercise the installed public fork/read seam and protect a meaningful independence boundary. No permanent unit test was added: a synthetic fixture cannot certify authenticated continuation. The report preserves the inputs, method, assertions and limitations without checking generated transcripts into source control.

### R3 — authenticated follow-up, blocked by session usage limit

After Nicolas reported signing in, a read-only `claude auth status --json` check with the default-home override removed returned `loggedIn: true`. Probes used the same CLI/SDK versions as above. No credentials were printed or copied, and the agent made no login changes.

The repeated controlled-gate streaming probe retained the R1 restrictions and bounds. Its collector remained open for 3.5 seconds after the result, rather than stopping at the first result. Observed sequence:

```text
618   system/init: CLI 2.1.288, model claude-haiku-4-5-20251001
870   assistant text: You've hit your session limit · resets 6:20pm (America/Chicago)
872   result: subtype success, same limit text, total_cost_usd 0
4957  cleanup complete; gate calls []; results 1
```

A separately started fork probe attempted only its seed prompt (`Remember seed=ORCHID_481. Reply exactly ACK_SEED.`), with built-in tools disabled, strict MCP configuration, no user/project/local settings, a three-turn/USD 0.10 bound, and a 45-second watchdog. It returned the same session-limit message with **`subtype: success`, `is_error: true`, cost 0**; the SDK also raised an error result. The probe's success assertion rejected it before any parent continuation or fork operation. All later steps were skipped.

This resolves authentication but adds **no positive steering, model recall, fork-continuation or cold-resume evidence**. Result `subtype: success` must be interpreted together with `is_error` and actual output. The earlier synthetic offline fork result remains valid. Both child queries ended, no live Korus session was reused, and no retry or wait-until-reset loop was started. The reset time is the runtime's message from this attempt, not a guaranteed future availability claim.

### R4 — authenticated input during tool work and text generation

On October 4 UTC, the unchanged SDK 0.3.226 / CLI 2.1.288 could make model requests. All streaming-input probes used a new query, `persistSession: false`, `settingSources: []`, strict MCP configuration, built-in `tools: []`, and no live Korus session. The tool probe allowed only the in-process `mcp__probe__gate` tool, held for 1.8 seconds; it performed no filesystem or network work. Inputs were UUID-stamped `SDKUserMessage`s with no explicit priority. The queue stayed open and output consumption continued 3.5 seconds beyond the result before cleanup.

Exact first prompt:

```text
Call mcp__probe__gate with stage one. After that result, call it with stage two. After both gates, reply exactly ORIGINAL_RED. Do the calls sequentially.
```

Injected while gate one was executing:

```text
Update now: after the current gate returns, skip the second gate and reply exactly STEERED_GREEN. This replaces the earlier finish instruction.
```

The minimal system prompt was `Follow the user instructions exactly. This is a harmless synthetic protocol experiment. Be concise.` The additional Haiku run used the Claude Code system-prompt preset with a brief probe appendix, as Korus uses that preset. Each tool query was limited to six turns, USD 0.15, and 60 seconds. The actual model names below came from init, not inferred aliases.

| Trial | Injected | Gate one returned | Observed continuation | First result | Gate calls / results |
| --- | --- | --- | --- | --- | --- |
| Haiku 4.5, minimal system prompt | 2,228 ms | 4,030 ms | At 8,619 ms, explicitly described the update as prompt injection; called gate two | 11,103 ms: `ORIGINAL_RED` | `[one, two]` / 1 |
| Sonnet 5.5, same prompts/tool | 2,111 ms | 3,912 ms | At 7,357 ms, answered `STEERED_GREEN`; no gate two | 7,367 ms: `STEERED_GREEN` | `[one]` / 1 |
| Haiku 4.5, Claude Code preset | 2,257 ms | 4,058 ms | At 8,797 ms, again rejected the update and called gate two | 9,867 ms: `ORIGINAL_RED` | `[one, two]` / 1 |

The tool handler's return was only `Gate completed.`; the revised instruction was sent through the **separate SDK input queue**. Haiku's claim that it came from the tool result is its interpretation, not how the probe submitted it. Its detailed reference to the update before the first result proves access within the original turn even though the requested redirection failed. Sonnet's skipped second gate and changed answer provide stronger behavioral proof. None of these runs interrupted gate one or showed a separate delivery receipt.

The text-generation trial used Sonnet, no tools, partial streaming events, a three-turn/USD 0.10 bound and 45-second watchdog. Initial prompt: `Output the integers from 1 to 120, one per line, without tools or commentary.` On the first text delta, inject: `Change the remaining response: stop listing numbers and reply exactly TEXT_UPDATE_GREEN.`

```text
1281 ms  first text delta (1, 2, 3, 4); update injected
2743 ms  original assistant response completed all numbers through 120
2757 ms  result 1: success, is_error false, original 371-character response
4198 ms  assistant: TEXT_UPDATE_GREEN
4233 ms  result 2: success, is_error false, TEXT_UPDATE_GREEN
4748 ms  query closed; two results observed
```

This demonstrates the second-result case that a first-result-only Korus adapter must not orphan. It does not establish timing guarantees for every model, permission wait, background tool or multiple queued messages. Reported cumulative costs: USD 0.009660 (Haiku minimal), 0.0088106 (Sonnet tool), 0.0222902 (Haiku preset), and 0.007468 (Sonnet text; latest result, not the sum of results).

### R5 — authenticated native fork, independence and cold resume

Six bounded Haiku queries ran in **six separate Node processes**, each launching a fresh CLI. All used canonical scratch cwd, default configured Claude home, strict MCP configuration, no built-in tools, no filesystem setting sources, hooks and auto-memory disabled, and the same concise memory-test system prompt. Each query had a three-turn/USD 0.10 bound and 45-second watchdog. Persistence was enabled only for these newly created scratch sessions; normal provider transcript storage was used, not live Korus state.

1. Create parent: `Remember seed=ORCHID_481. Reply exactly ACK_SEED.` It returned `ACK_SEED`; capture its terminal assistant UUID.
2. Resume parent: `Remember parent_only=COBALT_729. Reply exactly ACK_PARENT.` It returned `ACK_PARENT`.
3. Call `forkSession(parentId, { dir: cwd, upToMessageId: seedAssistantUuid })`. The public reader returned six parent entries and three child entries (native assistant/thinking segmentation, not six/three user turns). The child session/message IDs were fresh, the parent-only marker was absent from the child, and source bytes were unchanged.
4. Resume child with `Remember child_only=AMBER_356. List exact stored values for seed, parent_only, child_only, one per line. Use NONE for unknown.`
5. Cold-resume parent, then child, each with `List exact stored values for seed, parent_only, child_only, one per line. Use NONE for unknown.`
6. Independently call `query()` with `resume: parentId, forkSession: true, resumeSessionAt: seedAssistantUuid` and the same recall prompt. It produced a third session, excluded both branch markers, and left parent bytes unchanged.

| Model recall | Shared seed | Parent-only value | Child-only value |
| --- | --- | --- | --- |
| Child after adding its marker | `ORCHID_481` | `NONE` | `AMBER_356` |
| Parent in a fresh process | `ORCHID_481` | `COBALT_729` | `NONE` |
| Child in another fresh process | `ORCHID_481` | `NONE` | `AMBER_356` |
| Query fork pinned at seed boundary | `ORCHID_481` | `NONE` | `NONE` |

Assertions also compared the actual source bytes before/after helper forking and child continuation, and child bytes before/after parent continuation. All passed. Every model result was success with `is_error: false`; combined reported cost was USD 0.020786. This proves separate native text histories with working cold resume, not copied processes, filesystem isolation, or arbitrary cutoff safety. No tool or compaction history was included.

### R6 — native goals and context inspection

The goal condition was `The assistant has replied with exactly GOAL_PROBE_DONE.`, submitted as `/goal <condition>`. Probes enabled native hooks (`disableAllHooks: false`) while keeping `settingSources: []`, no tools, strict MCP configuration and no persisted session. Three-turn limits, USD 0.10–0.15 budgets and 35–45 second watchdogs bounded the work.

- Haiku with a minimal custom system prompt rejected the native goal framing, received further in-loop feedback and answered three times before `error_max_turns` (`is_error: true`, USD 0.014210). The runtime continued toward the goal; the model did not cooperate. No unbounded retry followed.
- Sonnet with the Claude Code system-prompt preset emitted a native `Goal set: ...` confirmation and answered `GOAL_PROBE_DONE`, with a successful result. A streaming follow-up `/goal` returned `No goal set. Usage: /goal <condition>`; `/goal clear` returned `No goal set`. These are command responses observed from the SDK, not a claim that textual parsing is an adequate app state contract.
- Across these goal iterators, **no `active_goal` message was observed**, despite its exported declaration. Successful model output plus no active goal is consistent with completion, but there was no structured completed/cleared/failed discriminator to map directly into Korus's goal UI.
- Live `getContextUsage()` on the final Sonnet streaming query returned 1,513 total tokens before input and 1,941 after the response, with `maxTokens: 1000000` and rounded percentage 0 both times. Only safe counts/category names were retained. This verifies live control-request operation, not gauge accuracy against an independent tokenizer or cold-history inspection.

The final streaming sequence completed in about 2.6 seconds, with three success/non-error results and cumulative reported cost USD 0.0018748. An earlier collector attempted context inspection after breaking out of the async iterator and got `ProcessTransport is not ready for writing`; inspection was moved before iterator exit and passed. This was probe lifecycle misuse, not a Korus defect. Goal resume, active-goal cancellation, evaluator failure reasons and compaction remain untested.

## Original recommended slice and acceptance gates

**Slice 1: idle native fork, same provider/home/workspace.** Implement `forkConversation` in the Claude host/transport behind the existing app-owned driver/RPC seam. Resolve an authoritative completed native boundary, create the native fork, then publish the destination session reference and hydrate its Claude replica. Handle failure without modifying the source or leaving an apparently successful destination. Keep remote location/account ownership explicit. [C2], [C3]

Before enabling the capability:

- Preserve R5's proven text-history contract in the implementation: shared-prefix recall, independent branch markers and fresh-process resume for both native IDs. The runtime prerequisite passed; the Korus workflow remains to be built and verified.
- Parent bytes/history stay unchanged by forking/child continuation; chosen cutoff excludes later parent work. Include a completed tool transaction and a compaction case, not only text.
- Reject busy sources and invalid/native-missing boundaries; cover failure before/after native creation and clean up only a destination owned by that operation.
- Korus focused seam tests prove source/target identity, configured store, RPC result and replica hydration. A narrow rendered test verifies the capability-driven workflow. Do not duplicate Anthropic parsing tests in Korus.

**Slice 2: active input.** Build on R4's proven tool-boundary versus next-turn distinction. Add explicit accepted/queued/delivered semantics and correlate UUIDs/results in the Claude host. Never label queue acceptance as consumed or promise immediate preemption. Verify stop behavior with outstanding input, multiple inputs and result races before exposing it through shared composer controls. Keep the observed Haiku refusal visible in qualification evidence rather than treating successful delivery as guaranteed redirection.

**Later:** goal lifecycle mapping, followed by edit/retry from native boundaries. Keep deletion semantics and workspace recovery separate. No shared SDK artifact rebuild is needed for this research. Implementation belongs primarily to Korus; only generic shared conversation UI deficiencies belong in `codex-app-sdk`, and runtime/API guarantees belong to Anthropic. No sibling changes are proposed in this diff.

## Original research handoff (before implementation authorization)

There is **no current authentication/quota blocker**: after Nicolas requested continuation, R4–R6 made successful model calls. Earlier auth/limit failures remain recorded above. No login change, credential export, wait-until-reset retry loop or quota workaround was performed by the agent. Remaining uncertainty is behavioral: queue interruption/races, structured goal lifecycle, tool/compaction fork boundaries and nonlocal stores. No cross-provider handoff contract decision was needed, so the handoff co-agent was not interrupted.

`npm ci` completed. Needed `.env` files were privately copied with owner-only permissions and confirmed ignored; values were not printed. npm reported existing dependency advisories and install-script warnings; no dependency remediation or package/lockfile changes were made. No shared SDK build, application restart, live-session reuse, capability flip, commit, push or merge occurred. Main-checkout documentation/UI changes were left untouched; Synara and the sibling SDK were read-only.

Docs-only repository diff: this report and its AGENTS.md pointer. `git diff --check` and report link/source consistency checks passed. No production code or automated suite changed; test/typecheck/lint/build gates are not applicable to this docs-only change. Runtime evidence is exactly R1–R6. Probe code and raw scratch logs were not added to the repository; the report retains the versioned inputs, timing, assertions and material failures. No installed-Korus UI workflow or production integration success is claimed.

## Evidence index

Local source references are pinned by the Korus commit above; line numbers are navigation hints for this snapshot.

[C1]: ../../core/src/backend-capabilities.ts
[C2]: ../../core/src/backend-driver.ts
[C3]: ../../client/backend/src/driver-rpc.ts
[C4]: ../../client/backend/src/claude/agent-sdk-transport.ts
[C5]: ../../client/backend/src/claude/claude-host.ts
[C6]: ../../client/backend/src/claude/transcript-history-adapter.ts
[C7]: ../../client/backend/src/claude/claude-provider-catalog.ts
[C8]: ../../core/src/contracts/conversation.ts
[S1]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/provider/Layers/ClaudeAdapter.ts#L7071
[S2]: https://github.com/Emanuele-web04/synara/blob/cb760d5b5eace10c3e823feb8dc5a39748f0c67e/apps/server/src/provider/Layers/ClaudeAdapter.ts#L7268
[A1]: https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works
[A2]: https://code.claude.com/docs/en/agent-sdk/sessions
[A3]: https://code.claude.com/docs/en/goal
[A4]: https://code.claude.com/docs/en/agent-sdk/file-checkpointing
[A5]: https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
[A6]: https://code.claude.com/docs/en/agent-sdk/claude-code-features
[K1]: ../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
[K2]: ../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
[K3]: ../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
[K4]: ../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
[R1]: #r1--live-executable-authentication-blocked
[R2]: #r2--actual-installed-sdk-synthetic-disk-fixture-no-model
[R3]: #r3--authenticated-follow-up-blocked-by-session-usage-limit
[R4]: #r4--authenticated-input-during-tool-work-and-text-generation
[R5]: #r5--authenticated-native-fork-independence-and-cold-resume
[R6]: #r6--native-goals-and-context-inspection

Installed SDK evidence is version-specific (0.3.226), not a dependency on tracking `node_modules`:

- K1: `forkSession`/`ForkSessionOptions`, lines 686–718; `SessionMutationOptions`, 4931–4947; `sdk.mjs` exported fork implementation at line 123.
- K2: `Query.interrupt`, 2358–2370; thinking setter documentation, 2405 onward; `SDKControlInterruptRequest/Response`, 3634 onward; `SDKUserMessage`, 4772 onward.
- K3: `SDKActiveGoalMessage`, 2988–3002; `SDKMessage`, 4184; internal `StdoutMessage`, 7066.
- K4: `Options.persistSession`, 1604–1610; fork option, 1519–1524; `resume`, `sessionId`, `resumeSessionAt`, `resumeDropsTurn`, 1825–1891; `Query.rewindFiles`, 2554–2566.

Additional Korus navigation: transport active-turn guards 111–159, context reads 194–230, queue submission/result settlement 296–381, options 527–578, home alignment 823–834; host send guard 269–283, resume 473–499, event handling 565–631; history normalized turn construction 173–272; catalog capability override 36–40. Existing fake-SDK tests in `client/backend/src/claude/__tests__/agent-sdk-transport.spec.ts` cover multi-turn reuse, resume, overlap rejection and context reads; they were inspected, not executed or treated as live runtime proof.
