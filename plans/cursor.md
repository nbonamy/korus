# Cursor provider qualification and integration

Status: Phase 0 measured on 2026-11-03 with Cursor CLI **2026.10.22-27dcf5f**
(minimum supported candidate: 2026.10.08). ACP session creation is permitted
with the existing Enterprise team login. **Full provider qualification is blocked**:
file edits bypassed permission callbacks, session-supplied MCP still prompted,
and authenticated home isolation failed; several Enterprise controls remain
unverified.
Native Cursor execution remains unavailable; the implementation checkpoints below
add shared transport and provider identity only.

## Objective and scope

Add Cursor as a peer provider through the existing backend seam, preserving
Korus approvals, plans, history and workflow behavior. Advertise only measured
capabilities. This plan records native transport evidence, not app integration,
fixture tests, or production readiness. Approved requirements revision 2 and
Mission tickets revision 15 define the remaining work.

Use ACP over stdio, sharing the Antigravity connection implementation. Keep this
transport decision conditional on resolving the approval failures below. Do not
switch to SDK or headless print mode to evade team policy or missing callbacks.

## Phase 0 method and evidence

All results below apply specifically to **2026.10.22-27dcf5f**. Native executable:
the installed `~/.local/bin/agent`. The initial no-prompt sequence was
`initialize → authenticate(cursor_login) → session/new`; all three succeeded.
The probe identified itself honestly as `korus-phase0`, version `0.0.0`.

Private scratch directory: `$TMPDIR/korus-cursor-phase0.BA5074` (mode 0700).
Synthetic workspace: its `workspace/` child. Evidence helpers stayed outside Git.
Each wire record includes the CLI version, direction and JSON-RPC message.
Credentials, Keychain, `auth.json` and global config contents were never read.
Stderr was drained and discarded. No API key or auth token was supplied; neither
corresponding environment variable was present. Existing native login was reused.

The bounded probes issued 25 small prompts, primarily with `composer-2.5`.
Request deadlines were 25–65 seconds; owned process groups received SIGTERM then
SIGKILL during cleanup. No company repository was used as the Cursor cwd.
No global permission configuration, persistent approval or team setting was changed.
The initial model selection `auto-smart` and measured Opus effort `high` were
restored through ACP after testing.

Scratch evidence groups (ephemeral, not prerequisites for future tests):

| Files | Purpose |
| --- | --- |
| `chat.jsonl`, `replay.jsonl`, `tool-replay.jsonl`, `audit-summary.txt` | Two turns, cold text/tool replay and disk timestamp check |
| `deny.jsonl`, `allow.jsonl`, `auto-review.jsonl`, `force.jsonl`, `gates-summary.txt` | Permission responses and native disk effects |
| `questions*.jsonl`, `plan-accept.jsonl`, `plan-reject.jsonl` | Questions, native plan approval and todos |
| `identity*.jsonl`, `mcp-calls.jsonl` | Two simultaneous same-cwd sessions with distinct synthetic stdio MCP identities |
| `no-picker.jsonl`, `model-effort.jsonl`, `effort.jsonl` | Config options and picker negotiation |
| `cancel.jsonl`, `shell-cancel.jsonl`, `extra-summary.txt` | Cancellation and recovery, auxiliary text and text attachment |
| `image.jsonl`, `subagent.jsonl`, `overlap.jsonl`, `final-summary.txt` | Image, child activity and concurrent prompts |
| `isolated.jsonl`, `home-metadata-audit.json` | Unauthenticated isolated initialization and filename/stat audit |
| `isolation-auth.jsonl`, `isolation-replay.jsonl`, `isolation-auth-audit.json`, `isolation-auth-summary.txt`, `isolation-logout-summary.json` | User-completed isolated login, native chat/replay, full-tree metadata audit and isolated logout |

The sanitized wire excerpts below are the durable fixture source. Do not copy
whole raw discovery payloads into fixtures: native slash-command discovery
includes user-installed skill descriptions. No such descriptions are saved here.

### Gate outcomes

“Blocked” includes partial proof whose remaining acceptance needs a follow-up.
A failed gate is a qualification result, not permission to relax app acceptance.

| Gate | CLI version | Outcome and measured evidence | Consequence / follow-up |
| --- | --- | --- | --- |
| 1. Handshake | 2026.10.22-27dcf5f | **Pass.** Protocol 1; native auth; session creation with no prompt. With picker metadata: base model IDs and model-specific options. Without: bracket-parameterized variants. | Use negotiated protocol and runtime catalog; do not claim capabilities merely from advertisement. |
| 2. Auth | 2026.10.22-27dcf5f | **Blocked (partial).** Existing native auth works. Fresh home initially reported unauthenticated; user completed explicit browser login, then isolated status/authenticate/session/new/prompt/load succeeded. Native isolated logout returned exit 0; isolated status became unauthenticated while existing-home status stayed authenticated. | Login/logout detection measured without reading credentials or logging out the active home. Expiry and team-switch disconnect remain unverified follow-ups; never claim those transitions are qualified. |
| 3. Home isolation | 2026.10.22-27dcf5f | **Fail for full isolation.** After user browser login, `CURSOR_CONFIG_DIR=<scratch>/isolated AGENT_CLI_CREDENTIAL_STORE=file` authenticated and stored ACP config/chats under scratch; cold replay succeeded. Full-tree filename/stat comparison still found six changed paths in real `~/.cursor` (inventory below). Shell/MCP prompted; edit bypass reproduced. | Isolated Korus home is **unsupported**. Config/chats/credential state redirect, but other native state is shared. Keep existing-home semantics; do not advertise isolated approvals/MCP trust or infer global allowlist independence. |
| 4. Chat and replay | 2026.10.22-27dcf5f | **Pass, with caveats.** Two streamed turns recalled `KORUS_C0_7A`. New process `session/load` emitted both prompts, thoughts and replies. Tool-session load replayed both tools without permission requests or changing the shell-output file mtime. | Replay tool IDs changed; timestamps absent. Replace/hydrate a replica, do not append replay into live transcript or infer tool continuity from IDs. |
| 5. Approvals | 2026.10.22-27dcf5f | **Fail for full contract.** Rejected shell write absent; allowed shell and edit both exactly `ALLOWED`. Rejection probe still created `denied-edit.txt`: edit had **no permission request**. MCP reject prevented actual call; allow-once reached the recorder. Auto-review still prompted for printf; force ran it without callback. | `approvals:false` for the complete Korus contract until native edit approval is resolved. No fake edit dialog. Details below. |
| 6. Questions/plans/todos | 2026.10.22-27dcf5f | **Blocked (partial).** In plan mode, native `cursor/create_plan` requests accepted and rejected successfully; planned file absent after both turns. Reject could cause another proposal in the same turn. Structured `plan` updates carried todos. Two explicit question prompts (agent/plan modes) produced textual questions, no `cursor/ask_question`. No `cursor/update_todos` observed. | Native plan review is a candidate. Questions remain false; todo-extension mapping and implementation-after-separate-acceptance still need proof. |
| 7. Two-agent MCP identity | 2026.10.22-27dcf5f | **Fail for approval-free contract.** Two live same-cwd sessions launched distinct supplied stdio servers. Once individually allowed, recorder returned only `SYNTHETIC_AGENT_A` / `SYNTHETIC_AGENT_B` to the matching session. Each call needed a permission response. Shell still prompted and was denied. | Identity routing works at synthetic transport boundary; approval-free trust is unqualified. `codeReview:false` pending trusted scoped bridge proof. No production Korus MCP identity claim. |
| 8. Model/effort | 2026.10.22-27dcf5f | **Blocked (partial).** Initial native catalog contained 42 entries; model config accepted composer. GPT mini selection returned selected ID with an empty model-options array. No served-model attestation in turn output. | Native model discovery is qualified; actual model/effort execution is not. Preserve config IDs/options, never infer served model from a setter acknowledgement. |
| 9. Cancellation | 2026.10.22-27dcf5f | **Pass.** Cancel after first text and during approved `sleep 20` each returned `stopReason:cancelled`; next prompt returned `RECOVERED`, `end_turn`. | Interrupt candidate qualified. Host must still reject late approvals and bound process teardown. No owned sleep or runtime remained at cleanup. |
| 10. Attachments/usage/subagents/concurrency | 2026.10.22-27dcf5f | **Fail for native serialization; partial pass elsewhere.** Embedded text marker returned exactly. Synthetic 1×1 PNG accepted and described as blank white. No usage-update/consumption event observed. Subagent read synthetic file and emitted `cursor/task` with request ID. Overlapping prompts cancelled first, completed second (`SECOND`). | Attachments candidate true. Usage unknown, USD unavailable. Serialize in host. Child-session capability comparison not completed; subagent controls remain disabled. |
| 11. Auxiliary generation | 2026.10.22-27dcf5f | **Blocked (partial).** No MCP, reject-all callbacks, title prompt returned `Green Kite Memory` with no tool calls or client filesystem requests. | This is tool abstention, not enforced tool-free execution: edit bypass in Gate 5 remains. Leave `generateText` absent until native tool exclusion is proven. |
| 12. Enterprise policy | 2026.10.22-27dcf5f | **Blocked (partial).** Existing team permits ACP sessions and prompts with browser credentials and no API key. Force and Auto-review outcomes measured below. | No policy-block error occurred. Admin-enforced approval mode, managed rules/hooks, dashboard MCP absence and catalog restriction parity remain unverified; no team settings were changed to force proof. |

### Home and Enterprise policy limits

The isolated logged-out `status` check created `isolated/cli-config.json`
(filename only inspected). A filename/size/mtime snapshot of the existing
`~/.cursor` before/after that isolated check found **no changed paths**.
This result covers that status call only. After the user completed browser login,
the authenticated ACP session and cold replay were audited separately. Full-tree
filename/size/mtime snapshots found the following **complete observed change set**
under real `~/.cursor` during that bounded interval (no created/deleted paths).
Team and workspace identifiers are sanitized; no file contents were read:

| Remaining real-home path | Observed change |
| --- | --- |
| `ai-tracking/ai-code-tracking.db` | Metadata changed |
| `managed/team_<team>/hooks/restrict-browser-mcp` | Metadata changed |
| `managed/team_<team>/hooks/restrict-playwright-cli` | Metadata changed |
| `projects/<short-workspace-key>/worker.sock` | Socket metadata changed |
| `projects/<workspace-key>/worker.log` | Metadata changed |
| `skills-cursor/.sync-manifest.json` | Metadata changed |

This is an interval-based inventory, not syscall attribution or a guarantee for
all future operations. Process inspection found no other Cursor runtime running
after cleanup. No managed-hook content or account identifier is included here.

Under the isolated directory, the run created `acp-config.json`,
`acp-sessions/<session>/meta.json`, `store.db`, `store.db-shm`, `store.db-wal`
(the database files within that session directory), and `statsig-cache.json`;
`cli-config.json` metadata changed. Cold replay restored the synthetic marker
and tools with no new permission requests. Ordinary shell printf and supplied
MCP calls each prompted and were rejected; no shell-output file appeared, but
the edit file still appeared without an approval request. No persistent
allow-always grant was used, so persistent approval independence remains
unproven. Full home isolation fails regardless of that unverified subcase.

Native logout was then applied only with the isolated config and file-store
environment: exit 0, isolated `isAuthenticated:false,status:unauthenticated`,
existing home `isAuthenticated:true,status:authenticated`. That verifies local
credential-state separation without extracting credentials. Do not offer an
isolated Korus home on the basis of config/chat redirection alone.

Existing-home sessions retain native chats/settings. The approved prerequisite
observation was allowlist mode, allow `Shell(ls)`, no denies, sandbox disabled.
The probes did not read that config or alter its allowlist. An unlisted printf
command triggered `Not in allowlist: printf`, consistent with that observation;
the isolated session also ran ls without a callback. This does not distinguish
inherited allowlisting from native defaults, so allowlist independence remains
unverified.

Measured permission modes:

| Launch | Shell printf write | Edit/MCP implications |
| --- | --- | --- |
| `agent acp` | Requests permission; reject prevented disk write, allow-once allowed exact bytes | In-workspace edit ran without callback. Supplied stdio MCP prompted; reject prevented server call, allow-once reached it. |
| `agent --auto-review acp` | Still requested approval; reject left file absent | Does not prove classifier activation or team override; do not label it effective Auto-review without more evidence. Edit/MCP cross-product not established. |
| `agent --force acp` | No callback; file created | Qualification-only synthetic test. Not a released Korus mode. No proof about explicit denies or team-enforced mode precedence. |

No allow-always decision was sent. Force did not establish any team-enforcement
bypass and must not be used to solve callback gaps. Managed hooks/rules were not
inspected or executed as a separate probe: their contents could include company
data. Authenticated-isolation metadata showed two managed hook cache files
changing in the real home; this proves shared cache activity, not hook execution
or enforcement. An administrator-approved synthetic policy fixture is needed
to verify loading/precedence safely. An empty app-supplied MCP list alone cannot prove
dashboard MCP absence without knowing an approved test server exists there.
Likewise, native catalog discovery alone cannot prove team restriction parity.

## Protocol details to preserve

These excerpts are native measurements from **2026.10.22-27dcf5f**, with cwd,
session, tool and child identifiers replaced by placeholders. JSON-RPC is one
JSON object per line. IDs are directional: server permission requests started
at numeric ID 0 independently of outstanding client requests.

Handshake request and result:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"korus-phase0","version":"0.0.0"},"clientCapabilities":{"_meta":{"parameterizedModelPicker":true}}}}
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"mcpCapabilities":{"http":true,"sse":true},"promptCapabilities":{"audio":false,"embeddedContext":false,"image":true},"sessionCapabilities":{"list":{}}},"authMethods":[{"id":"cursor_login","name":"Cursor Login","description":"Authenticate using existing Cursor login credentials. Run 'agent login' first if not logged in."}]}}
{"jsonrpc":"2.0","id":2,"method":"authenticate","params":{"methodId":"cursor_login"}}
{"jsonrpc":"2.0","id":2,"result":{}}
{"jsonrpc":"2.0","id":3,"method":"session/new","params":{"cwd":"<scratch-workspace>","mcpServers":[]}}
```

Session result contains `sessionId`, `modes`, `models`, `configOptions`.
Mode IDs: `agent`, `plan`, `ask`. Config select options use `value`,
while legacy available models use `modelId`. Never interchange these fields.

Measured config IDs:

- Initial Auto: `mode`, `model`, `optimize_for` with values
  `intelligence|balanced|cost` (current `balanced`).
- Composer: `fast`, string values `false|true`, current `true`.
- Opus 4.8: `thinking` (`false|true`), `context` (`300k|1m`),
  `effort` (`low|medium|high|xhigh|max`), `fast` (`false|true`).
  Setting effort low changed the returned currentValue from high to low.
  This is metadata proof only; no paid Opus turn was used to infer execution.
- Without picker metadata: model variants such as
  `claude-opus-4-8[thinking=true,context=300k,effort=high,fast=false]`.
- Config categories included `mode`, `model`, `model_config`,
  `thought_level`. Do not hardcode one effort spelling across models.

```json
{"jsonrpc":"2.0","id":4,"method":"session/set_config_option","params":{"sessionId":"<session>","configId":"model","value":"composer-2.5"}}
{"jsonrpc":"2.0","id":5,"method":"session/set_config_option","params":{"sessionId":"<session>","configId":"effort","value":"low"}}
```

Each successful config setter returns a full `configOptions` array. A successful
setter with empty options is not a model-execution proof. Native model names,
descriptions and allowed values belong to the catalog, including future team
restrictions; do not synthesize a union from a static list.

Permission exchange (sanitized native shell request):

```json
{"jsonrpc":"2.0","id":0,"method":"session/request_permission","params":{"sessionId":"<session>","toolCall":{"toolCallId":"<tool>","title":"`printf PHASE0_DENY > denied-shell.txt`","kind":"execute","status":"pending","content":[{"type":"content","content":{"type":"text","text":"Not in allowlist: printf"}}]},"options":[{"optionId":"allow-once","name":"Allow once","kind":"allow_once"},{"optionId":"allow-always","name":"Allow always","kind":"allow_always"},{"optionId":"reject-once","name":"Reject","kind":"reject_once"}]}}
{"jsonrpc":"2.0","id":0,"result":{"outcome":{"outcome":"selected","optionId":"reject-once"}}}
```

The option ID contains hyphens; the kind contains underscores. Use exact native
IDs, never `allow-always`. An MCP denial had `rawOutput:{"rejected":true}`
even though its tool update was `completed` and the prompt ended `end_turn`.
Success of the turn or tool lifecycle does not prove success of the action.

File edits streamed `tool_call` then `tool_call_update`, with `kind:edit`,
`rawInput`, `locations` and final content. No permission-time diff callback
was measured. Preserve available content but do not claim a reviewable diff
before an edit has already happened.

Native plan request shape (text shortened; field structure preserved):

```json
{"jsonrpc":"2.0","id":0,"method":"cursor/create_plan","params":{"toolCallId":"<tool>","name":"Add planned.txt","overview":"Create a synthetic file and verify it.","plan":"# Add synthetic planned.txt\n\n1. Create file.\n2. Verify.","todos":[{"id":"create-planned-txt","content":"Create planned.txt at workspace root with content HELLO","status":"pending"},{"id":"verify-planned-txt","content":"Verify planned.txt exists and contains HELLO","status":"pending"}],"isProject":false,"phases":[]}}
{"jsonrpc":"2.0","id":0,"result":{"outcome":{"outcome":"accepted"}}}
{"jsonrpc":"2.0","id":1,"result":{"outcome":{"outcome":"rejected","reason":"Synthetic Phase 0 qualification"}}}
```

Session `plan` notification has `entries:[{content,priority:"medium",status}]`;
it has no stable native todo ID in the observed entries. Retain IDs from
`create_plan.todos` where present. Do not invent `cursor/update_todos` wire
fixtures from that different event. No `cursor/ask_question` request was
observed; its documented shape is not yet a measured fixture.

A subagent emitted this **request**, despite documentation classifying the
extension as a notification:

```json
{"jsonrpc":"2.0","id":0,"method":"cursor/task","params":{"toolCallId":"<tool>","description":"Read synthetic.txt content","prompt":"<synthetic read instruction>","subagentType":"unspecified","model":"composer-2.5-fast","agentId":"<child>","durationMs":3967}}
```

The probe returned unsupported-method error to that request; the child had
already completed and the parent returned the file. Do not infer child-session
control or successful extension handling from this result. The advertised
subagent experiment used `clientCapabilities._meta.subagents:true`; a paired
comparison and supported response contract remain follow-ups.

Replay and lifecycle:

- `session/load` streams user, thought, assistant and tool updates **before**
  its response. It returns modes/models/config but no new sessionId.
- Original native tool IDs became `replay-0-1`, `replay-0-2`; neither replay
  nor live updates supplied measured timestamp fields. Keep prompt presentation
  metadata separate from the native transcript.
- Live output was chunked; replay text was consolidated. Do not expect
  byte-for-byte event segmentation or reappend a terminal answer.
- `session/cancel` is a notification with `{sessionId}`; prompt settles with
  `{"stopReason":"cancelled"}`. Successful turns returned `end_turn`.
- Concurrent prompts are destructive: the first settled cancelled. Queue
  at the host boundary and never rely on the native server to serialize.
- Commands appeared in `available_commands_update.availableCommands`, including
  native skills. Discovery is not proof that Korus skill controls work.
- Accepted inputs included text, image (`mimeType,data`) and embedded resource
  (`resource:{uri,mimeType,text}`). The latter worked despite
  `embeddedContext:false`; require explicit adapter tests.
- No measured token-consumption or price payload. Do not count context occupancy,
  model-config descriptions, command descriptions or child timing as usage.

## Capability matrix after Phase 0

“Qualified candidate” means native evidence permits implementation, not that a
flag can be enabled before its owning ticket and tests. Ticket 3 starts with
every boolean false and planMode unsupported.

| Capability | Final Phase 0 decision | Gate / limitation |
| --- | --- | --- |
| `approvals` | **false** | 5: shell/MCP callbacks work, file edit prevention fails |
| `questions` | **false** | 6: textual fallback only; native request not elicited |
| `planMode`, `planReview` | Qualified candidate: `native`, true | 6: real accept/reject and no file creation; retain separate implementation turn |
| `interrupt` | Qualified candidate: true | 9: text and shell recovery |
| `history`, `conversationResume` | Qualified candidate: true | 4: cold replay, changed IDs, absent timestamps |
| `models` | Qualified candidate: true for discovery | 8: served selection and restriction parity still blocked |
| `reasoningEffort` | **false** | 8: setters/options measured, served behavior unproven |
| `attachments` | Qualified candidate: true for tested image/text | 10: desktop input forms tested; Web acceptance needs owning ticket |
| `skills` | **false** | 10: commands advertised, execution/management unqualified |
| `codeReview` | **false** | 7: no approval-free scoped MCP proof |
| `steerPrompt`, `goals`, `conversationFork`, `editTurn`, `retryTurn`, `deleteTurn` | **false** | No native qualified contracts |
| `conversationArchive`, `conversationReplaceWithSummary`, `plugins`, `remoteControl`, `serviceTier`, `thinkingBudget` | **false** | Approved non-capabilities; do not imitate |
| Permission presets/modes | No qualified presets; Ask candidate only | Auto-review effective behavior unproven; force excluded |
| Usage / pricing | Unknown coverage; USD unavailable | 10: no consumption evidence, never fabricate zero |
| Auxiliary `generateText` | Absent | 11: tool abstention does not enforce tool-free operation |
| Subagent controls | Disabled | 10: completion activity observed, child routing unqualified |
| Isolated provider home | **Unsupported**: authenticated run changed six real-home paths | 3: config/chats redirect, full isolation fails |

## Current-code integration map

Source inspection began at repository baseline `d035d1fb`; the transport and
identity rows reflect the implementation checkpoints below. Other rows identify integration
seams, not implemented Cursor features.

| Owner | Existing seam and intended Cursor integration |
| --- | --- |
| Core identity | `core/src/contracts/shared.ts`, `contracts/backend.ts`, `backend-driver.ts`, `backend-capabilities.ts`, `settings.ts`, provider-setup contracts: Cursor identity registered, capabilities disabled and per-provider settings preserved |
| ACP transport | `client/backend/src/acp/acp-connection.ts`: shared framing, ID separation, bounded buffers, deadlines and teardown; provider-supplied display name and optional login marker; stderr stays private |
| Session/driver | `antigravity/session.ts`, `antigravity-host.ts`, `provider-lifecycle.ts`, `driver-rpc.ts`: Cursor owns normalization/lifecycle, provider health and explicit denial; no renderer protocol parsing |
| Replay | `antigravity/transcript.ts`, `prompt-journal.ts`; core Antigravity replica/contracts: native history remains authoritative, journal presentation metadata only |
| MCP | `antigravity/mcp-bridge.ts`, `sessionMcpServer`: shared scoped identity bridge; prove HTTP/SSE trust separately from these stdio probes |
| Settings/model selection | `requirements.ts`, execution selection and persistence schemas; `client/vue/src/components/SettingsAntigravityPanel.vue`, `BackendSelector.vue`: add Cursor through existing contracts |
| Conversation | Core provider envelopes; `client/vue/src/antigravity-conversation-state.ts`, `components/use-agent-conversation.ts`: provider-owned replica, shared UI |
| Usage/collector | Backend usage ledger; core usage/telemetry; collector metrics: unknown pricing and collector deployment before Cursor desktop emission |
| Mobile/workflows | Companion boundary must preserve released-client decoding. Mechanical provider registration only in Missions/review/automation/delegation; their workflow behavior stays unchanged |

## Remaining phases and commit checkpoints

Each ticket owns behavior tests before implementation and its approved local
commit. This mapping describes the approved work; it does not expand ticket 1.

| Mission ticket | Phase / checkpoint |
| --- | --- |
| 1 | This native qualification evidence; resolve blocked/failed gates before enabling affected controls |
| 2 | Shared ACP process connection, Antigravity regression evidence |
| 3 | Cursor identity, contracts, persistence; all capabilities initially false |
| 4 | Lifecycle, auth and Settings; existing home only until Gate 3 qualifies |
| 5 | Streaming host, replica, serialization and interrupt; deny pending permissions |
| 6 | Native approvals/questions and effective permission modes; Gate 5 edit failure is a blocker |
| 7 | Cold history hydration/resume with replay identity caveats |
| 8 | Runtime model catalog and per-model effort; add served-model proof |
| 9 | Plan preview/acceptance, todos and separate accepted implementation turn |
| 10 | Scoped Korus MCP identity/trust; current stdio approval-free result fails |
| 11 | Attachments, skills and subagent activity only where native evidence permits |
| 12 | Honest usage and collector acceptance; deploy collector before desktop emission |
| 13 | Released mobile regression evidence with Cursor agents present |
| 14 | Review/Mission/automation/delegation through unchanged workflow seams; omit auxiliary generation until tool-free enforcement qualifies |
| 15 | Integrated native proofs, Web/remote verification, durable docs and full lint/test/85% coverage gates |

## Shared transport checkpoint (Mission ticket 2)

The ACP connection and its real-child-process tests live under
`client/backend/src/acp`. Antigravity imports that connection directly and
supplies its existing display name and native stderr login marker. Error text,
framing, deadlines, callback routing and teardown retain their native behavior;
stderr diagnostics and URLs remain private. No Cursor runtime or MCP bridge
behavior is introduced by this extraction.

The transport tests cover colliding directional IDs, split frames, malformed and
oversized frames, EOF, timeout, close with pending requests, sanitized errors,
optional split login-marker recognition and process-group teardown. The new
label/marker tests failed against the original implementation before extraction.
The Antigravity and shared ACP suites pass together (75 tests).
`npm run lint` passes, including architecture checks, backend/all-workspace
typechecks and dead-code analysis. No mobile-facing contract changed.
`npm run test:coverage -w @workspace/backend -- --maxWorkers=2` passes:
2,786 tests passed, 9 skipped; 89.22% statements overall and 89.55% for the shared
connection, with the 85% gate unchanged. The initial unrestricted coverage run
hit five-second deadlines in eight real-Git tests; limiting workers resolved
those failures without changing deadlines, test assertions or coverage scope.

Learning: the installed application's signed Node runtime rejects third-party
native test bindings under macOS library validation. Local verification uses the
checksum-verified repository-pinned Node 26.12.1 distribution and npm 10.9.4.
Background worktree setup failed with `spawn npm ENOENT`; explicit worktree-local
`npm ci` completed after that failure, without changing dependency inputs.

## Identity and persistence checkpoint (Mission ticket 3)

`cursor` is a recognized provider in app-owned contracts, snapshot/event guards,
execution selections and stored roster/task records. Sessions retain a native
session ID; defaults retain model selection and optional permission mode without
inheriting another provider's defaults. Settings use `providerEnabled` and
`providerHomes`; no provider-specific enable flag is introduced. Review and
delegation registration changes are limited to provider/session discriminants.
Automation execution records preserve Cursor conversation references on reload.
Existing store schema versions remain unchanged; no migration is necessary.

The default driver registry contains an unavailable Cursor driver. Metadata reads
report `notConfigured` and the fully conservative capability constant (every
boolean false, `planMode: unsupported`); native operations reject with
`Cursor is not available`. Subscription registration and closing are inert so
the registry can initialize and shut down safely. Update inspection rejects
before executable/package probing. No Cursor runtime, model discovery, login or
workflow execution is implemented by this ticket.

Type expansion required small renderer guards: an unimplemented provider icon is
omitted, account labels require account metadata, and subagent reads remain
restricted to supported providers. The Cursor icon and connection UI belong to
ticket 4. No companion/mobile wire producer or telemetry emitter is changed;
released-client behavior for workspaces containing Cursor agents remains ticket
13's release gate, and Cursor telemetry belongs to ticket 12.

Boundary tests were written before implementation. They cover app-event identity
and authentication decoding, exact disk roster/task round-trips, mismatched
session/default rejection, settings isolation, review ledger decoding, unavailable
driver routing, updater rejection and provider-specific model requirements.
Malformed Cursor model restrictions remain errors rather than unrestricted input.
The shared selection helpers already handle the new identity through their
provider guard; no duplicated Cursor selection resolver is needed.

Validation uses Node 26.12.1 and npm 10.9.4. Core coverage passes with 668 tests
and 85.89% statements. Backend coverage with two workers passes with 2,797 tests,
9 skipped, and 89.23% statements. The 85% thresholds and coverage surfaces are
unchanged. Mounted renderer checks pass (24 tests), and full lint covers all
workspace typechecks, architecture, CSS/i18n and dead-code checks. Backend
coverage includes the existing released-client companion regression suites;
it does not replace ticket 13's Cursor-containing-workspace compatibility proof.

## Verification and learnings

- Phase 0 was docs-only: no runtime contract or app code changed. App suite,
  typecheck and coverage were not required for ticket 1; native probes are
  qualification evidence, not deterministic regression tests.
- Phase 0 worktree initialization reported `spawn npm ENOENT`; no installation
  or app suite was attempted at that checkpoint. Ticket 2 setup recovery is
  recorded above.
- Cleanup: process inspection found no remaining Cursor runtime, Node helper or
  sleep process from the probes. Synthetic files and private evidence remain only
  in the scratch directory. Browser login was completed by the user; isolated
  credentials were subsequently logged out through the native CLI.
- Document check: `git diff --check` passed. The staged diff and scope were
  inspected before the ticket's local checkpoint commit. No push, merge, PR or
  changelog change.
- Native capability claims must follow effects, not lifecycle status. Completed
  MCP tools can contain rejection, edits can happen without callbacks, and
  end_turn can follow denial.
- Trust is transport-sensitive. Supplied stdio MCP identity worked after
  allow-once; approval-free HTTP/SSE Korus bridge behavior is still an open gate.
- Metadata configuration and served execution are separate proofs. Model
  options are conditional, and one successful setter returned an empty catalog.
- Native replay regenerates tool IDs and omits observed timestamps. Durable
  replica hydration must tolerate both.
- The authenticated isolated-home audit overturned the unauthenticated status
  result: config/chats redirect while tracking, hook caches, skill sync and
  workspace worker state still touch the real home. Keep isolated-home support off.
- Docs and runtime differed for `cursor/task` notification/request framing.
  Preserve the measured request ID and fail honestly on unknown shapes.

Reference: [Cursor ACP documentation](https://cursor.com/docs/cli/acp) describes
stdio transport, extension methods and unsupported dashboard MCP. Those are
documentation claims; this checkpoint qualifies only the native results above.
