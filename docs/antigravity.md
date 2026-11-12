# Antigravity Integration

`client/backend/src/antigravity` owns discovery of the Antigravity CLI (`agy`),
OAuth observations, and the provider replica. Execution runs through `agy acp`,
the CLI's ACP server; Korus never installs or downloads it. OAuth renewal stays
native, background checks suppress login UI, and child environments sanitize
Google credentials/projects and use temporary storage. A separate home is passed
to the CLI with `--gemini-dir`; sign-in is shared machine-wide. Home routing is
not a filesystem sandbox. Provider setup
serializes home changes and detection refreshes. Discovery accepts `agy` on PATH
or the executable named by `APP_ANTIGRAVITY_COMMAND`.

ACP process framing, directional request IDs, deadlines and process-group teardown
are owned by the shared `client/backend/src/acp` transport. Provider adapters
supply display labels and optional native login markers. Stderr is drained only
for marker recognition; diagnostics and login URLs are never exposed or retained.

Each agent owns a process/session with serialized prompts and bounded cancellation.
Cold replay validates session identity and rebuilds atomically: replay tool IDs
differ and later updates may reverse tool status. Unknown timestamps stay absent;
the private prompt journal preserves presentation metadata, never a second transcript.
Session MCP identity/review scope travels in bridge child environments under
`product.mcpServerName`, never shared configuration. Auxiliary generation uses a
separate session with MCP, built-ins and client filesystem requests disabled.

Native catalogs remain authoritative; Korus never impersonates an allowlisted
editor to expose third-party models. Native plan artifacts feed app-owned review,
with implementation in a separate accepted turn. [The plan](../plans/antigravity.md)
records transport evidence, model restrictions, attachment support and unsupported
capabilities.

Account quotas come from the runtime's `/usage` command, which it answers without
a model turn; the reply is text, so the quota section is parsed defensively and
anything unfamiliar shows no limits. Each read opens a short-lived hidden session,
so reads are shared and reused for two minutes. Quota windows carry the model group
as their label, and mobile does not list this engine because its clients cannot show
that label.

## Request pricing evidence

Antigravity executions carry the model selected in the session and, when the runtime
reports it, the per-turn token totals from `PromptResponse.usage`. The qualified
Google-hosted ACP 1.4.5 server populates it for completed, failed and cancelled
turns. Request coverage stays partial with `acp-request-evidence-unavailable`:
the ACP exposes no identity for each underlying model call, no served model or
billing tier, and no subagent consumption.

Measured turns on Gemini models are priced as an API-equivalent estimate at the
Google standard tier from the selected model, thinking-level suffix removed. Other
selected models, or turns without usage, return unavailable USD rather than zero.
`PromptResponse.usage` reports input inclusive of cached reads and leaves thoughts
out of output; Korus stores thoughts as part of output. Non-zero cached writes are unmodeled and leave the turn
unmeasured. `usage_update` (`used`/`size`) is context occupancy only and never
becomes consumption; neither does cumulative session `cost`.

The qualified executable reports protocol 2 with the v1-shaped wire contract. Its
bundled Python adapter is the evidence boundary; the public CLI, Python SDK and
Gemini Interactions API are different interfaces. The
[pinned public registry](https://github.com/agentclientprotocol/registry/blob/02b460362cfedf4d43b03df7aad6d79a353fe064/antigravity-acp/agent.json)
identifies the distribution. [Fixture provenance](../client/backend/src/antigravity/__tests__/fixtures/usage-capability.json)
records the archive hash and source locations. Fixtures are source-derived wire
shapes with synthetic numbers, not a live billing capture.

| Evidence | Public ACP surface | Pricing consequence |
| --- | --- | --- |
| Billable request identity and timestamp | Session ID and prompt correlation only | Request count stays unknown; a prompt can contain several calls and retries |
| Model and underlying API provider | Selected model in `configOptions`/`models`; no served-model report | Gemini selections map to the Google catalog; Anthropic, OpenAI and other routes stay unpriced |
| Token categories | `PromptResponse.usage`: input, output, cached read, cached write, thoughts | Standard-tier estimate per turn |
| Cache-write lifetimes | `cachedWriteTokens` is always 0 | No lifetime assumptions |
| Pricing context | Context window occupancy only | Context premiums are ignored, as for Codex |
| Served tier/mode | Session mode describes permissions | Standard tier assumed, never the requested one |
| Subagents | Turn usage covers the main trajectory | Subagent tokens are not priced |

The adapter-to-SQLite-to-`usage/get` workflow is repeatable with
`npm run test -w @workspace/backend -- antigravity/__tests__/session.spec.ts`.
It covers mixed model selections, context changes, optional schema totals,
duplicate/late events, cancellation, failure, history replay and ledger restart.
