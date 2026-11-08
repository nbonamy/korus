# Provider Integration

A provider adapter supplies execution mechanisms; Korus owns coordination,
Missions, artifacts, interactive review and the shared conversation UI. Korus MCP
tools expose those app workflows to the model. Native shell/file tools still
belong to the provider: access to Korus MCP does not establish permission control
over native tools.

Use this checklist for each provider. An item is complete only for its stated
scope; partial or unsupported native behavior stays explicit and its controls
remain unavailable. The driver contract and capability catalog live in
[`AgentBackendDriver`](../core/src/backend-driver.ts) and
[`backend-capabilities`](../core/src/backend-capabilities.ts). Capability flags
are an admission boundary, not acceptance evidence.

| Check | Provider mechanism and acceptance boundary |
| --- | --- |
| [ ] Registration and policy | Declare driver coordination policy, lifecycle setup/install capabilities, normalized update inspection and renderer cache/presentation binding. Shared coordinators and controls consume these contracts rather than provider-name exceptions; prove policy with another registered provider fixture. |
| [ ] Runtime and authentication | Discovery, supported versions, explicit login/logout/cancel, account changes, updates and cleanup; no silent installation or account switching. |
| [ ] Instructions and MCP | Deliver app instructions and per-agent scoped app/hosted MCP endpoints; concurrent sessions cannot borrow another agent's identity. Qualify preapproval separately from connectivity. |
| [ ] Execution lifecycle | Stream and serialize turns; interrupt settles execution and pending requests before another turn starts. Steering changes the active turn only when supported; queueing or interrupt-and-resend is not native steering. |
| [ ] Models and controls | Discover native IDs and per-model reasoning/thinking/tier choices; validate selection and acknowledgments without inventing controls or claiming the served model. |
| [ ] Approvals and permissions | Register requests with the daemon, then reuse shared responses. Test allow/deny, duplicate/stale answers, teardown and permission scopes. Individual callbacks and permission-mode enforcement require separate evidence, including native file edits. |
| [ ] Attachments | Validate supported local files/images, preserve authored presentation on replay and reject unsupported/remote inputs before dispatch. |
| [ ] Plan mode and review | Confirm native mode or identify prompted semantics; restore normal mode. Reuse the shared sidebar's choices/comments and explicit decisions. A blocking native proposal is answered through its live request; a completed Markdown proposal uses follow-up prompts. |
| [ ] Goal mode | Define durable goal/update/clear and completion/continuation semantics. A prompt that mentions an objective is not proof of a goal execution lifecycle. |
| [ ] Compaction and context | Qualify manual compaction, automatic compaction, context reporting and summary-based session replacement separately. Preserve conversation identity where promised and report actual context/compaction events. |
| [ ] History and mutations | Load/list/read/resume saved sessions with workspace/account validation and no replay execution or usage. Fork, archive, edit, delete and retry are independent optional native operations; copying rendered messages does not create a native fork. |
| [ ] Recovery and auto-resume | Distinguish history reopening, connection recovery, startup continuation and quota-reset continuation. Preserve preferences, exact conversation/account targeting, durable one-shot delivery and explicit Stop/safety blocks. Never infer a reset deadline. |
| [ ] Conversation and tool display | Adapt text/thoughts, tool arguments/results/status, file diffs/locations and media to shared app-owned presentation. Prove rendering and actions through the actual conversation surface, including failure and replay. |
| [ ] Structured questions | Reuse the shared question lifecycle and native option IDs; cancellation and stale answers settle once. Interactive plan choices and ordinary textual questions are separate paths. |
| [ ] Usage, quota and failures | Separate execution timings, token/context measurements, request pricing and account billing. Keep unknowns unknown. Normalize actionable quota/auth/policy/transport failures without leaking diagnostics or retrying safety stops. |
| [ ] Auxiliary generation and review | Qualify isolated text/image generation, output schemas, cancellation and tool restrictions. Code review and app utilities may depend on these driver operations even when the app workflow uses MCP. Never fall back to another provider. |
| [ ] Compatibility and optional surfaces | Gate native skills/plugins/subagents/remote control independently. Preserve released companion/share/telemetry contracts; exclude unsupported providers until explicit negotiation permits them. |

Before enabling a control, verify its owning daemon/driver boundary, the shared
renderer action when applicable, and the failure/recovery path. Distinguish
subprocess fixtures, rendered app tests and native-provider measurements; a fixture
cannot qualify native behavior the provider has not emitted. ACP transport reuse
does not imply identical extensions or capabilities. Shared framing, MCP bridges,
request routing and UI belong in existing common owners; provider adapters retain
only their protocol/configuration differences. See [testing](testing.md) and
[protocol compatibility](protocol.md#mobile-compatibility).
