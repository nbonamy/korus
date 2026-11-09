# Cursor Integration

Shared requirements are in the [Provider Integration checklist](provider-integration.md).

The Cursor lifecycle detects `agent` or `cursor-agent` through shared runtime
discovery; installation remains an operator action through official instructions.
It uses the existing `~/.cursor` setup. Separate setup choices are rejected before
setup mutation: the native updater has no destination override, and its install
path is tied to the child home. Saved private contexts retain their captured
home and credential reader for compatibility; startup never migrates or deletes
them or silently selects another account.

Native authentication is owned by the Cursor driver. Bounded version/status
checks suppress browser opening and reject CLI builds older than `2026.10.08`.
Authentication checks expose only authentication state, validated version and
display-safe account/team metadata; credentials and native diagnostics stay private.
The usage adapter reads the native login in place (macOS Keychain, or the native
credential file on other platforms), retaining its access token only in memory.
It queries fixed Cursor DashboardService read endpoints without redirects or
credential refresh, and returns only validated plan, quota and balance fields.
Zero allowances, disabled on-demand billing and absent data remain distinct;
pooled team limits are not treated as personal spend limits.
Monetary billing metadata is an optional app-owned extension of account quotas;
legacy quota frames remain valid. Native reads reject a changed credential,
and the daemon discards responses after provider disablement, disconnection or
authentication changes. The renderer waits for a fresh read before showing stored
monetary balances and drops responses after the account or menu lifecycle changes.
Explicit login owns a cancellable process group. Connection observations never
enable Cursor, and new-work admission refreshes authentication before selection.
Observed logout, expiry, account or team changes close cached native sessions and
settle pending callbacks. Same-account reconnection can rehydrate only the saved
workspace-validated session; a changed identity requires explicit history selection.
Each agent owns a native `agent acp` process through the shared ACP connection.
The host serializes prompts and projects text, thoughts, tool updates, structured
file changes, embedded resources and images into a Cursor-owned revisioned replica. App developer instructions travel in prompt
context blocks; the renderer receives only app-owned messages. Quick Chats use
private working directories. Native plan mode selects a catalog mode before
prompt admission and restores agent mode for a normal follow-up. Continuation
uses the saved native session and the same serialized prompt path. Model selection preserves native config values
and requires a matching native acknowledgment before prompt admission;
trusted local attachments become native content blocks. Configured model choice
is not evidence of the served model or billing. Permission callbacks enter the daemon request registry and become once-only app
tool confirmations. Duplicate and stale responses are rejected, and interruption
or teardown cancels pending callbacks. Plan-mode Markdown and native plan proposals
open the shared sidebar review, including interactive choices and section comments.
Completed Markdown proposals use follow-up prompts for revision and implementation;
blocking native proposals receive the decision through their existing request.
Revision feedback includes saved comments and confirmed choices. Native request
cancellation settles its review; saved content survives restart without reviving
a process-owned approval callback. The session-injected
Korus MCP server is preapproved only through a current-turn tool-call identity,
using the native once-only option. Display titles, other MCP servers and native
shell/file tools do not grant that authorization. Native edits
can bypass permission callbacks, so permission choices do not establish full edit
prevention. Structured questions map displayed choices back to native option
identities and reject ambiguous or stale answers. Native plan entries and todo
updates remain observed metadata. Todo extensions accept both request and
notification framing; requests acknowledge only the validated projected state.
Unsupported blocking extensions are cancelled.
Image-extension requests and notifications can display an observed workspace
image after bounded, contained file validation. Suggested paths do not establish
generation success; missing, replaced or outside files produce no media. These
observations are live presentation, without historical freshness claims.
Per-agent app and
hosted MCP endpoints use the shared session bridge with identity scoped in each
child process; this does not establish approval-free native tool execution.

Explicit quota-exhaustion RPC failures end the turn without closing its usable
session or marking the account signed out. Known future reset metadata permits
the shared one-shot continuation policy; missing reset data leaves retry manual.
Congestion, generic throttling and unknown diagnostics do not invent quota state.

## Code review

Code review uses the shared prompt-and-MCP workflow: inspection, finding discussion,
selected remediation and follow-up rounds run in the reviewer conversation.
Each review scope supplies its own Korus MCP endpoint and tool list, including
reviewer skill loading and finding reporting. Normal application and hosted MCP
endpoints are replaced for the review scope and restored for normal conversation.
The native conversation reference, model and reasoning selection are retained;
cancellation, permissions and execution accounting use the normal Cursor turn path.
Review scope limits Korus MCP access; permission callbacks use the conversation's
Ask/Full access choice. Native filesystem access is not isolated by review scope.

## Steering fallback

Native in-place steering is unavailable. `cursorSteeringFallbackEnabled` is an
explicit, default-off opt-in to interrupt-and-resend. The host cancels and fences
the running turn before submitting the update, attachments and selection as a
new turn in the same saved session. The interrupted turn remains visible.
Opt-out, session/account/workspace changes and release are revalidated before
resend admission; concurrent steering cannot replace that operation. Capability
updates reach existing conversations when the host setting changes.

## Conversation approval policy

The shared Permissions menu offers Ask for approval and Full access. This is a
per-conversation client policy for callbacks Cursor actually sends, independent
of native Agent/Plan/Ask execution modes. Ask presents those callbacks; Full access
selects a unique native `allow_once` option automatically. Missing or ambiguous
once-only options cancel the request rather than creating a persistent allow rule.
Changing to Full access also settles existing tool-permission requests, while plan
review and questions retain their separate explicit decisions. Returning to Ask
restores prompts for subsequent callbacks without restarting the native session.
The choice is saved on the current agent and as the default for new Cursor
conversations, including Quick Chats. Existing conversations retain their saved
choice. Model selection is also retained for new conversations. These defaults
belong to Korus and do not modify shared Cursor configuration.

These choices do not establish interception of every native file operation.
Full edit-approval enforcement remains unavailable.

The extended native model catalog supplies per-model enum reasoning choices and
selected context-capacity labels. Capacity stays native descriptive metadata; it
is not used-token occupancy or an inferred percentage.
Values and config identities remain native; independent boolean thinking controls
are preserved without being relabeled as effort. A model change clears inherited
app effort. Reusing a confirmed model avoids repeating its setter, protecting
native thought settings from model-default resets when effort is explicitly null.
Admission validates the selected model's live controls and setter acknowledgments,
checks mode after effort, then verifies the complete selection before prompting.
Failed acknowledgments require confirmed model selection before another prompt.
Only a typed method-not-found response permits fallback to the session catalog;
authentication, policy, transport and malformed-catalog failures remain failures.

Interactive prompt requests have no wall-clock deadline: long-running execution
and human approval/review waits settle through completion, explicit interruption
or process failure. Setup/control requests and cancellation retain bounded
deadlines. A conversation process/protocol failure closes that session and keeps
its terminal replica; it does not change the provider's authentication observation.
A subsequent request validates authentication and reloads the saved session.
Only native authentication, team-change or ACP-policy failures publish a
disconnected observation.

Cancellation waits for prompt settlement and a bounded, workspace-filtered
`session/list` round trip before admitting the next prompt. This drains buffered
cancelled-turn updates without retaining history metadata. The handshake requires
that advertised native capability. Process teardown bounds non-cooperative
cancellation. A lost process keeps its terminal replica rather than silently
creating a replacement conversation. A fresh host loads persisted native session
references after checking workspace ownership against the native catalog. Replay
hydrates a fresh replica, generates no live execution observations, and leaves
unreported timestamps unknown. A presentation journal under the selected home
restores authored prompt content and attachment parts only when native replay
text exactly matches an admitted prompt. Workspace-filtered history listing
does not create a session; explicit resume validates and hydrates its replacement
before adopting it, and provides recovery from a lost process. Stored message
reads use validated replay without changing the active session or emitting usage. Known team-switch and
policy markers produce fixed safe errors and disconnected observations; raw
diagnostics and URLs are discarded.

Cursor live turns emit execution observations to the local usage ledger. The
daemon measures working time and time to first assistant output; release and
shutdown settle active executions as interrupted. Snapshot reads do not count as
executions. Token counts, served models and costs stay unknown without native
measurements. The ledger projects Cursor rows through the shared provider-name
telemetry contract. Collectors must have the provider-name migration before
clients send additional providers; uploads do not negotiate provider admission.

Updates inspect native `about --format json` metadata and use native `update`
through the shared consent and idle scheduler. Child environments explicitly
clear ambient Cursor credentials even when PATH discovery merges environments.
Existing-home login and updates preserve native conversation identities. Saved
private contexts expose version inspection and manual updates. Update admission
rechecks the selected home before executing, preventing a second installation
under a private home.

## Capability checklist

`[x]` means the stated implementation has owning-boundary evidence. `[ ]` means
partial, absent or unqualified support; it is not a promise that the native ACP
runtime can supply the missing operation. Native evidence and its build-specific
limits are retained in the [Cursor qualification record](../plans/cursor.md#native-acceptance-evidence).
The [host suite][cursor-host-tests] runs the production adapter against an ACP
subprocess fixture. Native measurements do not attest to every model or tool.

| Check | Capability | Implementation and evidence |
| --- | --- | --- |
| [x] | Setup and authentication | Existing-home discovery/login/logout/cancel, account/team invalidation and idle updates; [connection tests][cursor-auth-tests]. Separate-home setup is unsupported. |
| [x] | Instructions and scoped MCP | Per-agent app/hosted MCP bridge and current-turn preapproval of identified Korus calls; [host tests][cursor-host-tests]. Other servers and native tools retain their own decisions. |
| [x] | Streaming conversations | Serialized prompts, terminal/error lifecycle and revisioned snapshots; [host tests][cursor-host-tests]. |
| [x] | Models | Native discovery, exact model selection and matching acknowledgments; [host tests][cursor-host-tests] and native catalog/selection measurements. |
| [x] | Enum reasoning effort | Exact per-model native IDs/values and final model/effort/mode validation; independent boolean thinking is preserved. [Host tests][cursor-host-tests] and native setter measurements. Boolean thinking/tier controls are not implemented. |
| [x] | Individual approval callbacks | Once-only native permission responses enter the daemon request registry; real server/driver/subprocess workflows cover denial, plans, questions, duplicate answers and cancellation. [Host tests][cursor-host-tests]. |
| [x] | Conversation approval policy | Ask for approval / Full access control reported permission callbacks through shared settings and request routing; saved policy, live switching, isolated agents and explicit plan decisions are covered by [host tests][cursor-host-tests]. |
| [ ] | Enforced native approvals | Partial: native edits can bypass callbacks. Native edit and rejecting-filesystem probes establish the limit; full enforcement and native approval presets remain disabled. |
| [x] | Text/image attachments | Trusted UTF-8 files/images, binary rejection and replay presentation; [host tests][cursor-host-tests]. Audio/video and arbitrary binary attachments are unsupported. |
| [x] | Optional steering fallback | Explicit default-off interrupt-and-resend preserves the session and creates a new turn after bounded cancellation. [Owning workflow][cursor-steering-tests] covers dynamic opt-in/out, identities, cancellation fences and resend races. Native in-place steering remains unavailable. |
| [x] | Interrupt and Continue | Bounded cancellation, late-frame isolation and saved-session continuation; [host tests][cursor-host-tests]. Continue submits a serialized follow-up in the same session. |
| [x] | Native Plan mode | Catalog-validated mode selection, acknowledgment and normal-mode restoration; [host tests][cursor-host-tests] and native mode measurements. |
| [x] | Interactive plan sidebar | Native proposals and completed Plan-mode Markdown use shared review. Saved comments/confirmed choices flow through Revise; accept/cancel settle the live native callback. [Daemon workflows][cursor-host-tests], [rendered editor][cursor-sidebar-tests] and [shell routing][cursor-shell-tests]. Native sidebar save/approve was measured. |
| [ ] | Goal mode | Absent: no native goal/update/clear lifecycle; the goal control is disabled and [RPC requests are rejected][cursor-host-tests]. |
| [ ] | Manual compaction | Absent: no Cursor compaction command or summary-replacement implementation; [RPC rejection coverage][cursor-host-tests]. |
| [ ] | Automatic compaction/context | Unqualified: no app-owned automatic-compaction control, events or context measurement. Native usage updates are not projected; autonomous provider behavior is not inferred. |
| [ ] | Forking | Absent: no native fork operation; fork control is disabled and [RPC requests are rejected][cursor-host-tests]. |
| [x] | Saved history | Workspace-filtered list/read/load/resume; replay neither creates a replacement session nor emits execution usage. [Host tests][cursor-host-tests] and native list/cold-replay measurements. |
| [x] | Startup auto-resume | Shared daemon persists active-work markers, respects Stop and continues only marked saved sessions; [restart workflow][cursor-restart-tests] includes Cursor. The native adapter's saved-session continuation is covered separately by [host tests][cursor-host-tests]; a full native daemon-restart continuation is not measured. |
| [ ] | Connection recovery | Partial: saved-reference rehydration supports a subsequent request after process loss or same-account sign-in. There is no autonomous in-flight recovery/retry; changed accounts require explicit history selection. [Host tests][cursor-host-tests]. |
| [ ] | Quota auto-resume | The [shared scheduler workflow][cursor-quota-tests] and [host workflow][cursor-host-tests] cover explicit limit/reset observations, one-shot delivery and preferences. Explicit quota-exhaustion RPC failures keep the native session usable. The production host/daemon subprocess workflow covers known-reset continuation and manual retry without a reset; a live exhausted-account reset cycle is not measured. Billing-cycle data alone does not prove an executable continuation path. |
| [x] | Tool-call display | Shared MCP formatting, file links/diffs/locations, readable resources, media and native failures; live/replay [host tests][cursor-host-tests] and [rendered conversation tests][cursor-pane-tests]. Observed image files do not establish generation success. |
| [ ] | Native structured questions | Adapter, exact ID validation and daemon responses are implemented in [host tests][cursor-host-tests]; native emission is unqualified and the capability stays disabled. Plan-sidebar choices remain usable. |
| [x] | Auth, transport and policy failures | Safe terminal errors, pending-request settlement, identity invalidation and bounded shutdown; [host tests][cursor-host-tests] and [authentication tests][cursor-auth-tests]. Quota normalization is the separate partial item above. |
| [x] | Account quota and billing reads | Validated included/on-demand balances, reset metadata and stale-account protection; [account tests][cursor-billing-tests]. These are account observations, not per-turn cost. |
| [ ] | Token/context/pricing measurements | Partial: executions and timings reach the ledger/telemetry pipeline; tokens, context consumption, served model and API cost remain unknown. [Host execution tests][cursor-host-tests]. |
| [x] | Structured code review | Shared manual and automatic review workflows report findings through scoped MCP, retain discussion and remediation in the native conversation, and clean up reviewer sessions. [Owning workflows][cursor-host-tests]. |
| [ ] | Isolated utility generation | No Cursor isolated text/image generation or enforced tool-free utility path. |

Native plugins, managed skills, subagent control, remote control and turn
edit/delete/retry/archive remain unavailable. Cursor is desktop-only at companion
and sharing admission. These exclusions are intentional compatibility boundaries,
not feature implementations.

[cursor-host-tests]: ../client/backend/src/cursor/__tests__/host.spec.ts
[cursor-auth-tests]: ../client/backend/src/cursor/__tests__/connection.spec.ts
[cursor-billing-tests]: ../client/backend/src/cursor/__tests__/account-usage.spec.ts
[cursor-sidebar-tests]: ../client/vue/src/components/__tests__/RightWorkspacePanel.spec.ts
[cursor-shell-tests]: ../client/vue/src/components/__tests__/AppShell.workspace.spec.ts
[cursor-pane-tests]: ../client/vue/src/components/__tests__/AgentConversationPanel.spec.ts
[cursor-restart-tests]: ../client/backend/src/__tests__/server-startup-resume.spec.ts
[cursor-quota-tests]: ../client/backend/src/__tests__/server-auto-resume.spec.ts

[cursor-steering-tests]: ../client/backend/src/cursor/__tests__/steering.spec.ts
