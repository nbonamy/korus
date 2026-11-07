# Cursor provider qualification and integration

Status: The agreed everyday desktop scope is implemented and verified. It includes
conversations, tools, history, model/enum-effort selection, attachments, native Plan
mode, scoped MCP, account credits/quota
and analytics. See the [implementation audit](#full-provider-implementation-audit)
for current acceptance evidence and provider boundaries. Full native qualification
remains incomplete: edits can bypass permission callbacks, structured question
emission is unverified, and served-model/token/cost data is unavailable. Separate
home setup is excluded at the user's direction. The Phase 0 measurements below
retain their original CLI versions and evidence limits.

## Objective and scope

The user-confirmed completion boundary is everyday Cursor workflows with native
limitations documented, rather than full parity with every Korus provider feature.
This covers connection and provider selection, conversations, tools and native
requests, history, models/effort, attachments, account credits/quota and analytics.
Separate-home setup is excluded at the user's direction. Unsupported or unqualified
controls remain disabled; their evidence is retained below.

Use ACP over stdio, sharing the existing ACP transport. Native callback handling
does not promise interception of edits that Cursor executes without a callback.
Do not switch transport or change shared native policy to evade that boundary.
Native transport evidence and deterministic app integration tests are recorded
separately. Earlier qualification checkpoints retain their original scope; the
implementation audit records acceptance against the agreed everyday scope.

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
flag can be enabled before its owning ticket and tests. Ticket 3 started with
every boolean false and planMode unsupported; ticket 5 enables only interrupt.

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

Source inspection began at repository baseline `d035d1fb`; the transport,
identity and lifecycle rows reflect the implementation checkpoints below.
Other rows identify integration seams, not implemented Cursor features.

| Owner | Existing seam and intended Cursor integration |
| --- | --- |
| Core identity | `core/src/contracts/shared.ts`, `contracts/backend.ts`, `backend-driver.ts`, `backend-capabilities.ts`, `settings.ts`, provider-setup contracts: Cursor identity registered, capabilities disabled and per-provider settings preserved |
| ACP transport | `client/backend/src/acp/acp-connection.ts`: shared framing, ID separation, bounded buffers, deadlines and teardown; provider-supplied display name and optional login marker; stderr stays private |
| Session/driver | `cursor/cursor-host.ts`, `cursor/session.ts`, `cursor/transcript.ts`, `driver-rpc.ts`: native ACP startup, serialized turns, bounded cancellation, denial and disconnected observations |
| Lifecycle/auth/updates | `cursor/provider-lifecycle.ts`, `cursor/authentication.ts`, `cursor/runtime.ts`: shared runtime discovery, existing home only, bounded native observations and explicit login; `provider-update-runtime.ts` uses native about/update through the shared idle/consent service |
| Replay | `antigravity/transcript.ts`, `prompt-journal.ts`; core Antigravity replica/contracts: native history remains authoritative, journal presentation metadata only |
| MCP | `antigravity/mcp-bridge.ts`, `sessionMcpServer`: shared scoped identity bridge; prove HTTP/SSE trust separately from these stdio probes |
| Settings/model selection | `SettingsCursorPanel.vue`, onboarding and remote connection rows expose detection/authentication/enablement and official installation instructions. Model selection remains an integration seam through `requirements.ts`, execution selection and `BackendSelector.vue` |
| Conversation | Core Cursor contracts/guards/replica and revisioned app envelopes; `client/vue/src/cursor-conversation-state.ts`, `app-state.ts`, `components/use-agent-conversation.ts`: provider-owned replica, shared UI |
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

## Lifecycle and connection checkpoint (Mission ticket 4)

Cursor has a detect-only lifecycle and a native authentication owner behind
`AgentBackendDriver.authenticate`. Discovery uses the shared runtime resolver for
`agent`, then `cursor-agent`; detection alone means installed. Builds older than
`2026.10.08` remain installed but disconnected with an update hint. Background
version/status checks set `NO_OPEN_BROWSER=1`; only an explicit login launches
`agent login`. Login cancellation and driver disposal terminate the process group.
Authentication observes `isAuthenticated` and selects display-safe email/team
names; account identifiers, credentials and diagnostics are discarded. No
credential file or store is read by Korus.

Gate 3's failed authenticated isolation proof means existing `~/.cursor` is the
only supported home. Neither Settings nor onboarding offers a separate Cursor
home or skill-sharing choice. Child environments clear ambient Cursor credentials
and pin that existing config directory. Undefined environment overrides are
intentional: the shared PATH helper merges inherited environments, so deletion
alone would reintroduce credentials during update commands.

Settings, onboarding and remote connection rows distinguish installed,
authenticated and enabled. Cursor observations never persist enablement; the
toggle remains an explicit setting and the last usable-engine guard still applies.
Remote login directs the user to run `agent login` on that host. Installation
shows the official command and documentation without executing an installer.
The update service reads dated native versions from `about --format json`, binds
consent to the checked installation and invokes `agent update` only while idle.
An in-flight login counts as busy. Updates replace drivers without resetting
conversation identities.

New-work admission rechecks Cursor authentication and still rejects with
`Cursor is not available yet`. All Cursor execution capabilities remain false;
this checkpoint does not implement ACP execution or lift the Phase 0 gates.
Companion/mobile producers and telemetry emission are unchanged.

The production authentication adapter passed a read-only native check against
CLI **2026.10.22-27dcf5f**: connected and supported, with display account and
team metadata present. The retained smoke result contains only those booleans
and the CLI version. No browser, model prompt, installer or native update was run.

Behavior tests precede implementation and exercise real fake-executable child
processes, including alias detection, version rejection, safe parsing, external
login retry, explicit login/cancel, sanitized update environments and login/upgrade
exclusion. Mounted Settings, onboarding and remote rows cover separate enablement,
existing-home controls, installation instructions and unsupported-version hints.

Validation uses Node 26.12.1 and npm 10.9.4. Full affected-workspace coverage
(`npm run test:coverage -w @workspace/core -w @workspace/backend -w @workspace/vue -- --maxWorkers=2 --silent`)
passes: core 668 tests / 85.89% statements, backend 2,807 tests / 89.22%
statements (9 skipped), Vue 2,303 tests / 86.83% statements. Coverage thresholds
and measured surfaces are unchanged. Full `npm run lint` passes architecture,
all workspace typechecks, CSS/i18n and dead-code checks. The mounted checks are
the visible-UI evidence; no installed-app rebuild or replacement is required.

The broader `VITEST_MAX_WORKERS=2 npm run test:ai` run passes all seven
workspace Vitest suites (6,648 tests, 9 skipped). Its tooling stage encountered
one existing diff-treemap tooltip timeout; the complete tooling suite passes
all 103 tests when rerun with `node --test --test-concurrency=1` and the same
file set. The default-worker Git timeouts are absent with two workers. Validation
also repaired a partial Electron dependency extraction and started the stopped
Docker VM; container tests used scratch directories within its home mount.
Dependency inputs, test timeouts and coverage rules are unchanged.

## Streaming checkpoint (Mission ticket 5)

The Cursor host replaces the unavailable driver. A new agent or Quick Chat
checks the native CLI version/authentication, launches `agent acp` without a
shell and uses `initialize` → `authenticate(cursor_login)` → `session/new`.
The client advertises only `_meta.parameterizedModelPicker: true`; no client
filesystem, terminal, subagent or interactive request capabilities are claimed.
Session creation supplies the agent's workspace and an empty MCP list. Quick
Chats use a private `cursor-quick-chats` directory. Developer instructions use
the shared `appDeveloperInstructions` service in a context block; the visible
user message retains only the submitted text and presentation metadata.

Each agent has its own process, session, FIFO admission and revision sequence.
Concurrent starts share only the in-flight safe authentication observation.
The Cursor transcript projects text, thoughts and tool updates into its own
core replica; generic coordination reducers never own transcript transitions.
Native tool titles travel through app-owned display metadata into the shared
pane. Permission callbacks select the exact native `reject_once` option ID,
or cancel when none is offered. A rejected tool remains visibly failed even
when native updates say completed. Unsupported blocking `cursor/*` requests
return `{outcome:{outcome:"cancelled"}}`; they never authorize an action.

Interrupt sends `session/cancel`, waits for prompt settlement, then performs a
workspace-filtered `session/list` round trip before releasing queued work.
The cancellation guard stays active through that round trip so buffered text
and late permissions cannot contaminate the next turn. The native handshake
must advertise list support, as measured in Phase 0. This use retains no history
metadata and does not enable history controls. A five-second cancellation
deadline falls back to the shared transport's bounded process-group teardown.
The fallback preserves an interrupted replica; it does not silently create a
new native conversation after losing the process. Cold resume and recovery of
that process belong to ticket 7. The round-trip fence is adapter fixture proof;
its integrated native proof remains part of ticket 15. The protocol's
[session-list definition](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/session-list.mdx)
documents the advertised capability and working-directory filter.

Unexpected EOF, malformed frames, incompatible handshakes and safe classified
team/policy errors become disconnected observations and terminal replicas.
The shared transport recognizes fixed provider-supplied stderr markers and
formats RPC errors through a provider callback; raw diagnostics, native URLs
and arbitrary error data are discarded. Version gating and existing-home
semantics remain intact. Native edit/approval limitations from Gate 5 remain;
denying callbacks does not enforce prevention for actions that bypass callbacks.

Only `interrupt` becomes true. Models, plans, approvals, questions, history,
attachments, workflow integration and usage remain disabled/unimplemented by
this slice. Cursor emits no usage observations or telemetry. No native model
prompt was run for this checkpoint; deterministic fixtures use sanitized
**2026.10.22-27dcf5f** shapes with synthetic content and no credentials.

Contract expansion required two defensive guards: guest frame indexing checks
for event payloads, and the mobile conversation cache discards desktop-only
Cursor frames. Companion frame/reset filters and wire output remain unchanged;
these guards do not enable mobile Cursor conversations. The existing released
phone subscription and snapshot regressions remain applicable; ticket 13 still
owns the Cursor-containing-workspace compatibility proof.

Behavior tests precede implementation. The real-child fixture covers split
frames, two turns, queued admission, multi-agent separation, developer context,
permission denial, cancelled extensions, normal and bounded fallback interrupt,
duplicate completion/late chunks/late permissions, EOF, malformed protocol,
team/policy errors, minimum version, incompatible capability metadata and release
during startup. The public app boundary switches a fresh Codex agent to Cursor
before its first prompt. Core tests cover frame identity and terminal-turn
idempotence; renderer tests cover revision-gap recovery, session attachment identity,
app-state routing and the mounted shared pane's text/tool/interrupt behavior.

Validation uses Node 26.12.1 and npm 10.9.4. Full affected-workspace coverage
passes with two workers: core 670 tests / 85.73% statements; backend 2,827
tests / 89.19% (9 skipped); Vue 2,307 tests / 86.84%; mobile 289 tests /
91.38%. The initial core run exposed the old all-false capability expectation;
it now asserts the exact interrupt-only surface, and a full core coverage rerun
passes. Coverage thresholds and measured surfaces are unchanged. Focused backend
checks include all Antigravity and shared ACP tests (154 tests). Full lint passes
architecture, every workspace typecheck, CSS/i18n and dead-code checks.

The broader `VITEST_MAX_WORKERS=2 npm run test:ai` run passed core, Vue,
Electron (534), mobile, collector (35) and console (12). Backend had one existing
five-second Git provisioning-retry timeout; its unchanged full file then passed
all 21 tests with one worker, and full backend coverage had already passed.
The complete tooling set ran serially: 102/103 passed. The diff-treemap browser
test still times out waiting for its tiny-tile tooltip, including an isolated
retry. This same failure is recorded under ticket 4; the treemap component and
test are unchanged here. Thus the broader entrypoint is not reported green.
An archived-baseline attempt failed fixture bootstrap and is not regression
evidence. No test assertion or timeout was weakened. The task's focused tests,
lint and affected coverage pass; the unrelated browser failure remains for its
owning quality work. Background initialization still reports cached
`spawn npm ENOENT`; validation used the recovered dependencies recorded above.

## Approval qualification blocker (Mission ticket 6)

Ticket 6 cannot enable the complete approval contract on the qualified CLI
**2026.10.22-27dcf5f**. A fresh bounded native probe tested the remaining
client-filesystem hypothesis: advertise both filesystem capabilities, reject
every permission callback, and reject every client write request before writing.
The client identified itself as `korus-phase6-qualification`, version `0.0.0`.
It used the existing native login and a private mode-0700 scratch workspace,
with an empty MCP list, no shell transport and `NO_OPEN_BROWSER=1`.

The initialization differed from Phase 0 only in its explicit client filesystem
and terminal capabilities:

```json
{"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"korus-phase6-qualification","version":"0.0.0"},"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":false,"_meta":{"parameterizedModelPicker":true}}}}
```

After `authenticate(cursor_login)` and `session/new`, the probe requested
`composer-2.5` through `session/set_config_option`. That setter acknowledgement
does not attest the served model. One synthetic prompt asked native editor tools
to create `new.txt` and change `existing.txt`, each to exactly `AFTER\n`, and to
stop an action if denied. The pre-existing file contained exactly `BEFORE\n`.
No company files, credentials, global permission settings or managed policy
contents were read or changed by the helper.

| Measurement | Native result, CLI 2026.10.22-27dcf5f |
| --- | --- |
| `session/request_permission` requests | 0 |
| `fs/read_text_file` requests | 0 |
| `fs/write_text_file` requests | 0 |
| Tool kinds observed | `read`, `search`, `edit` |
| Prompt settlement | `stopReason: end_turn` |
| Newly created `new.txt` | Present, exactly `AFTER\n` |
| Modified `existing.txt` | Changed, exactly `AFTER\n` |

Thus advertising client filesystem support did not make these native edits
interceptable. No permission or client write request was available to deny.
This independently reproduces Gate 5's edit-prevention failure; a fixture that
emits a file-edit permission request would not qualify the real runtime.
The documented [ACP permission exchange](https://cursor.com/docs/cli/acp)
describes requests when a tool needs approval; it does not promise a callback
for every edit. The documented
[permission tokens](https://cursor.com/docs/cli/reference/permissions) describe
native allow/deny configuration, not a measured per-edit Korus decision path.
No global/team configuration was altered to seek a workaround.

The release surface stays unchanged: `approvals:false`, `questions:false`,
`permissionModes:[]`. The streaming host continues rejecting every native
permission callback and cancelling unsupported blocking extensions. That does
not prevent native actions which bypass callbacks. Gate 6 still lacks a native
`cursor/ask_question` exchange; Gate 5/12 still lack effective Auto-review and
team-mode precedence proof. No new claim is made for those gates, and no Ask or
Auto-review control is exposed on the basis of deterministic fixtures alone.

To resume ticket 6, qualify a supported native mechanism/build that exposes a
pre-write allow/deny decision, then prove denied creation leaves no file and
denied modification preserves the exact original bytes. Also capture a native
question exchange and effective approval-mode evidence, including team override
handling. Implement the fixture-driven routing and UI only against that proven
contract. Do not substitute force, allow-always, transport changes, post-write
dialogs or policy changes for the missing prevention boundary.

Only sanitized counters, event-kind names and synthetic file comparisons were
retained; raw discovery payloads, stderr, account and session identifiers were
discarded. The probe settled, its process group was torn down, and process cwd
inspection found no remaining process in the scratch tree. Helpers remained
outside Git. This checkpoint changes only this evidence document: `git diff
--check` is the applicable check; app tests, lint and coverage are not rerun for
a docs-only blocker record. Worktree initialization still reports its cached
`spawn npm ENOENT`; no dependency installation is needed for this checkpoint.
Ticket 6 remains blocked and is not submitted as completed implementation.

## Verification and learnings

### Full-provider continuation: local analytics and current-runtime discovery

The user requested complete Cursor support, including analytics and credits/quota,
and authorized regular local commits. The full objective remains active; this
checkpoint is a milestone, not completion of the provider integration.

Live executions emit start and terminal usage observations. Local analytics retain
Cursor turns across ledger reload, expose a provider filter, measure first
assistant output, and settle release/shutdown as interrupted. No served model,
tokens or cost is invented. Cursor remains excluded from the old telemetry
projection until the collector's acceptance and rollout are implemented.

Native discovery against **2026.11.05-86047df** authenticated and created an ACP
session. It advertised loadSession, session/list, HTTP/SSE MCP and image prompts;
session creation returned Agent/Plan/Ask modes and the runtime model catalog.
A scratch approval probe ended with no tool attempts, no permission callbacks
and no file changes. That result is inconclusive and does not supersede the
earlier edit-bypass evidence.

The installed CLI's public distribution includes a feature-gated `/usage` screen.
Its usage-data implementation calls DashboardService.GetCurrentPeriodUsage,
GetHardLimit and GetPlanInfo, with an enterprise billing fallback. The period
response schema includes plan usage, spend-limit usage and billing-cycle dates.
A read-only native-authenticated request to
`https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`
returned **HTTP 200**, with billing-cycle dates, plan-usage percentages and
spend-limit fields. The access token stayed in process memory, was sent only to
the native Cursor endpoint, and was neither printed nor retained. No account,
team or monetary values are stored in this record. This is a qualified source
for the forthcoming quota adapter, not implemented quota UI or per-turn pricing.

The public credential implementation uses the macOS Keychain account
`cursor-user`, service `cursor-access-token`; the file-backed implementation
uses platform-specific auth.json storage independently of CURSOR_CONFIG_DIR.
Home qualification must cover credential separation as well as ACP/config paths;
do not infer it from changing CURSOR_CONFIG_DIR alone.

The native billing adapter is implemented behind getAccountRateLimits. It reads
the native account's credential in place, queries the three fixed DashboardService
endpoints and returns app-owned plan, included-balance and on-demand-limit data.
Bounded reads, no redirects, safe failures and absent-login handling keep tokens
and diagnostics out of the response. Protobuf default scalar omission is handled
only inside present buckets; missing buckets remain unknown. A zero allowance
does not become a 100%-remaining quota, and pooled team credit is not treated as a
personal limit. The production adapter passed a native read-only check: the
current account reports Free and on-demand billing disabled. No billing settings
or payment methods were inspected or changed. Enabling the desktop quota surface,
rendering credit balances, account-change races and mobile negotiation remain
integration work; the full goal is not complete.

### Desktop billing and account-race checkpoint

Cursor subscription quota is enabled in the desktop account menu. Optional,
validated app-owned billing metadata supplies plan, included USD credits and
on-demand status/budget, including Free accounts without quota windows. Monetary
rows use the existing menu and share a right edge without clipping normal plan
names. Stored monetary data is withheld pending a fresh read. Token changes,
provider disconnection/disablement and account changes fence late quota results
at the native adapter, daemon and renderer boundaries. Shipped phone usage
responses retain the Codex/Claude-only provider set, tested with Cursor present.

TDD covers the provider quota RPC races, native token/switch validation, typed
billing event decoding, mounted menu data/account lifecycle, and real Chromium
geometry/Free-account behavior. Full lint passed. The all-workspace run passed
core (740), backend (2,973; 9 skipped), CLI (27), Electron (651), mobile (291),
collector (35) and console (14). Vue passed 2,477 tests but hit two browser
timeouts: the new billing fixture's startup and the existing inline diagram.
Billing's Vite cache is now private to its fixture instead of shared with
concurrent browser servers; both browser files passed the targeted recheck.
The original all-workspace command is not reported as a clean invocation.

The user authorized same-worktree co-agents and centralized coordination of
commits. Runtime, analytics/collector and home/auth owners inspect in parallel;
the coordinator owns general UI/workflow/mobile integration and final validation.

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

## Full-provider implementation audit

The shared [provider contract](../docs/provider-integration.md)
and [Cursor capability checklist](../docs/cursor.md#capability-checklist) distinguish
implemented, partial and unavailable operations.

The desktop integration includes native sign-in/status, enabled-provider selection,
serialized streaming conversations, tool rendering and once-only confirmations,
structured question adaptation, model selection, local text/image attachments,
workspace-filtered native history, cold replay, explicit resume, continuation,
account-change invalidation and native Plan mode. Prompt presentation metadata
restores authored content without exposing injected developer context on replay.
Scoped app and hosted MCP endpoints retain per-agent identity through the shared
ACP bridge. The primary shell and split panes consume Cursor-owned replicas.

Local analytics record observed executions and timing, retaining unknown tokens,
served models and pricing. Native billing reads expose plan, included credits and
on-demand limits, with account-safe refresh. Cursor telemetry requires collector
schema 8 and identity-free versioned capability discovery; mixed frozen reports
wait without spending POST attempts against older collectors. Collector rollout
remains an operator deployment action, separate from these local commits.

Separate-directory setup was dropped at the user's direction after native installer
inspection found no destination override. New isolated choices are rejected before
setup mutation; saved private contexts and credentials are preserved. Existing
native login and installation remain the supported setup.

Released companion and guest protocols retain their three-provider contract.
Mixed workspaces omit unsupported Cursor choices, agents and indirect references;
admission rejects guessed targets and unsupported creation selections. Cursor
sharing is explicitly disabled independently of desktop conversation references.

### Native acceptance evidence

Installed CLI `2026.11.05-86047df` passed a production-host text request, discovery
of 47 model options, native history listing, fresh-host cold replay and authored
prompt restoration. The live turn emitted two execution observations; replay
emitted none. The smoke exposed a real `session_info_update` incompatibility;
its subprocess regression precedes the fix. Native subagent metadata is ignored
without pretending to implement child-session routing.

A native planning request presented one plan proposal. Accepting it left the
proposed `planned.txt` target absent; a normal follow-up restored Agent mode.
The tightened adapter separately validated native mode acknowledgments for
`plan` and `agent` without starting a model turn. These results do not attest to
the served model, all native tools, or effective approval enforcement.

A separate no-model-turn probe selected another advertised native model and
restored the initial value. Both acknowledgments matched their requested model
IDs. Missing, contradictory or foreign-config acknowledgments are rejected
before prompt admission; this validates configuration rather than served-model
attestation.

The production session adapter discovered the extended native model catalog and
confirmed exact enum effort changes for two distinct native config IDs, including
a model with independent boolean thinking. Thinking remained unchanged, parameters
and the initial model were restored, and no model turn ran.
Final selection guards also passed native Plan/Agent mode transitions after effort
selection, with the requested model and effort preserved. The app's rendered
composer regression selects an exact `extra-high` value and proves the outbound
execution selection; switching to a model without effort removes inherited effort.

The installed `2026.11.05-86047df` also reproduced the native approval boundary:
a scratch file changed from its before marker to the requested after marker even
though the production host granted none of the two app requests received during
the turn. The native file-change projection reached the conversation. This confirms
the approval limitation on the installed build rather than relying on Phase 0's
older CLI evidence; full approvals and automatic review remain disabled.

A delegated-filesystem probe advertised client `fs.writeTextFile` support and
provided a rejecting handler. The scratch file still changed, with zero delegated
write requests. Client filesystem advertisement therefore did not establish an
edit-interception seam on this build. Source inspection also did not establish a
process-scoped ACP plugin-hook injection; existing shared user/project/team hooks
are not changed by this integration.

A production-host native todo request created two synthetic checklist items and
marked both completed. Both todo snapshots reached the app-owned conversation.
The installed CLI frames `cursor/update_todos` as a request despite documentation
describing a notification; the adapter accepts both forms and rejects explicitly
foreign session identities. The subprocess regression first reproduced a
cancelled response and missing todo projection before the fix.

### Remaining provider boundaries

- Native edits can bypass permission callbacks. Full approval presets, automatic
  review and approval-free code review remain unavailable; once-only callbacks
  cover only requests the provider actually sends.
- Structured questions have documented-contract subprocess coverage; native
  emission has not been elicited, including a production-host clarification
  probe. The question capability flag remains false.
- Image-extension observations are live-only and require contained, bounded
  regular-image reads. Suggested or existing paths do not prove successful
  generation, freshness or historical reconstruction.
- Served-model/effort execution, token consumption and API pricing remain unknown.
  No substitute values are inferred from configuration or timing.
- Native and Markdown plan proposals use the shared interactive sidebar. Native
  callbacks are registered with the daemon; sidebar save/approve has native
  acceptance evidence. Saved comments and confirmed choices feed native revisions.
  Tool-free auxiliary generation, skill management and native subagent controls
  remain unqualified. Plan mode does not establish those separate capabilities.
- Archive, compaction, fork/edit/delete/retry, remote-control and unsupported
  provider controls remain absent rather than inheriting Codex shortcuts.

### Verification

| Agreed requirement | Acceptance evidence |
| --- | --- |
| Connection and existing-home setup | Native authenticated ACP startup; connection/setup/update owning-boundary tests; no isolated-home choices. |
| Everyday conversations, history and selection | Native text, history list/replay, mode and effort probes; host tests cover resume, serialization, cancellation, recovery, attachments and identity isolation. |
| Tools and requests | Native file-change/todo observations; subprocess callback and scoped MCP workflows; rendered file links, media, confirmations and continuation. |
| Credits/quota | Native billing adapter and rendered settings workflows cover balances, Free/disabled billing and stale-account responses. |
| Analytics | Persistent execution ledger, uploader negotiation, real Postgres collector and authenticated proxy/browser console workflows; unavailable measurements stay unknown. |
| Existing-client compatibility | Released-provider companion admission/subscription/Live Activity regressions and explicit Cursor sharing exclusion. |

| Affected workspace | Full coverage suite | Statements |
| --- | --- | --- |
| Backend | 3,047 passed; 9 existing skips | 89.39% |
| Core | 744 passed | 86.18% |
| Vue | 2,488 passed | 86.81% |

Repository-wide lint passed. Independent review closed the same-model reset defect
after prompt-admission assertions verified retained effort and thinking values.
Native acceptance above remains distinct from subprocess and rendered fixtures.
Local commits do not authorize push, deployment, account migration or billing changes.
