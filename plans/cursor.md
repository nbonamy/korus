# Cursor provider qualification and integration

Status: Phase 0 measured on 2026-11-03 with Cursor CLI **2026.10.22-27dcf5f**
(minimum supported candidate: 2026.10.08). ACP session creation is permitted
with the existing Enterprise team login. **Full provider qualification is blocked**:
file edits bypassed permission callbacks, session-supplied MCP still prompted,
and fresh-home login and several Enterprise controls remain unverified.
No Cursor provider code is implemented by this checkpoint.

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

The bounded probes issued 24 small prompts, primarily with `composer-2.5`.
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

The sanitized wire excerpts below are the durable fixture source. Do not copy
whole raw discovery payloads into fixtures: native slash-command discovery
includes user-installed skill descriptions. No such descriptions are saved here.

### Gate outcomes

“Blocked” includes partial proof whose remaining acceptance needs a follow-up.
A failed gate is a qualification result, not permission to relax app acceptance.

| Gate | CLI version | Outcome and measured evidence | Consequence / follow-up |
| --- | --- | --- | --- |
| 1. Handshake | 2026.10.22-27dcf5f | **Pass.** Protocol 1; native auth; session creation with no prompt. With picker metadata: base model IDs and model-specific options. Without: bracket-parameterized variants. | Use negotiated protocol and runtime catalog; do not claim capabilities merely from advertisement. |
| 2. Auth | 2026.10.22-27dcf5f | **Blocked (partial).** Existing login authenticates with empty result. Fresh config plus file credential store reports `isAuthenticated:false,status:unauthenticated` through bounded `status --format json`, with no login invocation. | Explicit browser login, logout after isolated login, expiry and team-switch disconnect still require native proof. No logout/team switch was applied to the user's active account. |
| 3. Home isolation | 2026.10.22-27dcf5f | **Blocked.** `CURSOR_CONFIG_DIR=<scratch>/isolated AGENT_CLI_CREDENTIAL_STORE=file` does not reuse native login. Isolated `initialize` works. Browser login requested from user; not completed at this checkpoint. | Isolated Korus home is **not qualified/supported**. Keep existing-home semantics. Authenticated chats, permissions and MCP approval isolation require login and before/after filesystem audit. |
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
This result covers that status call only. It does **not** establish an exhaustive
list of writes for authenticated isolated ACP: that list is blocked on fresh-home
login. Config, chats, ordinary approvals and MCP approvals must all be audited
before offering a Korus-specific Cursor home. Never copy credentials to finish it.

Existing-home sessions retain native chats/settings. The approved prerequisite
observation was allowlist mode, allow `Shell(ls)`, no denies, sandbox disabled.
The probes did not read that config or alter its allowlist. An unlisted printf
command triggered `Not in allowlist: printf`, consistent with that observation;
a direct comparison of allowlisted ls versus an isolated home remains pending.

Measured permission modes:

| Launch | Shell printf write | Edit/MCP implications |
| --- | --- | --- |
| `agent acp` | Requests permission; reject prevented disk write, allow-once allowed exact bytes | In-workspace edit ran without callback. Supplied stdio MCP prompted; reject prevented server call, allow-once reached it. |
| `agent --auto-review acp` | Still requested approval; reject left file absent | Does not prove classifier activation or team override; do not label it effective Auto-review without more evidence. Edit/MCP cross-product not established. |
| `agent --force acp` | No callback; file created | Qualification-only synthetic test. Not a released Korus mode. No proof about explicit denies or team-enforced mode precedence. |

No allow-always decision was sent. Force did not establish any team-enforcement
bypass and must not be used to solve callback gaps. Managed hooks/rules were not
inspected or executed as a separate probe: their contents could include company
data. An administrator-approved synthetic policy fixture is needed to verify
loading/precedence safely. An empty app-supplied MCP list alone cannot prove
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
| Isolated provider home | Unsupported pending browser login/audit | 3 |

## Current-code integration map

Source inspection at repository baseline `d035d1fb`; paths describe existing seams,
not files implemented in this ticket.

| Owner | Existing seam and intended Cursor integration |
| --- | --- |
| Core identity | `core/src/contracts/shared.ts`, `contracts/backend.ts`, `backend-driver.ts`, `backend-capabilities.ts`, `settings.ts`, provider-setup contracts: additive identity, conservative capabilities and per-provider settings |
| ACP transport | `client/backend/src/antigravity/acp-connection.ts`: share framing, ID separation, bounded buffers, deadlines and teardown; preserve stderr privacy |
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

## Verification and learnings

- Docs-only change: no runtime contract or app code changed. App suite,
  typecheck and coverage are not required for this ticket; native probes are
  qualification evidence, not deterministic regression tests.
- Worktree initialization reported `spawn npm ENOENT`. No installation was
  attempted and no app-suite success is claimed. Later implementation must
  resolve the setup failure before dependency-dependent checks.
- Cleanup: process inspection found no remaining Cursor runtime, Node helper or
  sleep process from the probes. Synthetic files and private evidence remain only
  in the scratch directory; browser login is user-owned and was not launched.
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
- The authenticated isolated-home write inventory is deliberately unresolved;
  “no changes” for an unauthenticated status probe is insufficient.
- Docs and runtime differed for `cursor/task` notification/request framing.
  Preserve the measured request ID and fail honestly on unknown shapes.

Reference: [Cursor ACP documentation](https://cursor.com/docs/cli/acp) describes
stdio transport, extension methods and unsupported dashboard MCP. Those are
documentation claims; this checkpoint qualifies only the native results above.
