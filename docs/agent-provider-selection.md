# Choosing The Coding Agent

How Korus picks Codex, Claude Code or Antigravity for new work.

## Rules

- Providers are peers; any subset may be connected on a host. Installation, process
  health and authentication are distinct. Choices come from the owning host's
  `providerConnections`, never legacy enable flags or backend process health.
- With several connected engines, creation surfaces show a selector; with one, it is
  used automatically and the selector is hidden; with none, new work is rejected and
  Settings offers connection. Existing chats stay accessible.
- Surfaces differ in presentation, not policy. Dialogs (New agent, worktree,
  project, branch/work-item, repository URL) carry a conditional `BackendSelector`;
  direct actions (new session on main, open folder, Quick Chat, duplicate agent,
  new Mission) create immediately and let the user choose on the empty chat. An explicit selection
  carries through acquisition and progress dialogs. Assigning to an existing session
  never implies a provider change.
- **Duplicate** defaults to the source backend and accepts an explicit available backend;
  changing it applies the target provider’s defaults to the fresh agent. **Fork** keeps
  the source backend. **MCP creation** (`create-agent`,
  `create-project`) takes an optional backend defaulting to the caller's. Same-provider
  helpers inherit the caller's model, effort and explicit service tier; cross-provider
  creation uses the target provider's defaults instead.
- **Missions:** new workers inherit the main Mission agent's current provider,
  model, reasoning effort and service tier, not the assigned team member's profile.
  The first Mission agent starts from the selected orchestrator member. Tickets
  approval may persist an independent implementation provider, model and reasoning
  effort. Cross-provider workers use the target provider's defaults. The daemon
  validates provider availability and the selection against the host's filtered
  catalog before worktree creation and each worker launch. Implementation workers,
  including reused workers and retries, use that selection; the lead and Review
  retain their configuration and conversations.
- **Review:** the reviewer's provider is an independent choice (Claude can review
  Codex work and vice versa). The panel remembers provider, model, effort and
  automation preferences. `start_automatic_review` inherits the caller's
  provider/model/effort and uses saved preferences only for priority threshold and
  round limit. Changing provider never transfers provider-specific conversation IDs
  or incompatible model settings.
- Validation gives a clear error for an unavailable explicit provider instead of
  silently using another.

## Host Requirements

An operator can limit the model choices offered by desktop and mobile with
`$APP_HOME/requirements.json` (normally `~/.korus/requirements.json`). The daemon
reads this optional file at startup, independently of saved preferences, and never
rewrites it. Restart the daemon after editing it. Invalid JSON, unknown fields or
providers, and invalid model lists stop startup with an error.

For a demo that offers only Codex Luna:

```json
{
  "models": {
    "codex": ["gpt-6-luna"],
    "claude": [],
    "antigravity": []
  }
}
```

Entries match provider catalog model identifiers (`model` or `id`), not display
names. Omitted providers keep their full catalog; an empty list disables that
provider for new work while preserving its conversations. Settings cannot re-enable
a provider disabled by requirements. Filtered catalogs retain an allowed provider
default or select the first remaining model as the default. Catalog updates use the
same filter, so discovery cannot restore excluded choices. Each host owns its
requirements; remote clients receive the owning host's filtered catalog and
availability. The file controls Korus model choices, not the provider's own CLI or
native subagents.

## Switching Before The First Prompt

A fresh conversation can change backend from a composer-shelf control, even after
creation chose one. Eligibility means **a fresh conversation before its first
submitted prompt**, not merely an empty message list: loading, provider-session,
history-bearing forks and running conversations are not switchable. The persisted
`hasSubmittedPrompt` marker locks selection even if the first submission failed
before a session existed; restart clears it with the old session.

Switching is an app-owned operation that updates provider and compatible defaults
together and releases any eagerly created empty provider session (the renderer
cannot swap a label over another provider's session). It refreshes model catalog,
reasoning, permission and capability controls, clears incompatible defaults, keeps
draft text and attachments (revalidating attachment support), and keeps model IDs and
approval settings provider-scoped. Sending waits for an outstanding switch, and late
catalog responses from the former provider are ignored. Antigravity effort is encoded
in native model IDs; separate effort, thinking-budget and service-tier settings do
not apply.

## Connection State

`core/agent-backends` resolves connected providers and fresh-agent eligibility;
`AppShell` provides the choices once through `backend-selection`. `daemon` owns
connection observations, published in snapshots but never persisted: installation and
authentication are checked once per backend startup and cached, routine reads reuse
them, and explicit connect, install or home/runtime changes refresh them. A
provider-reported auth failure updates the observation immediately
(`provider.authenticationChanged`) without touching the saved enabled preference, and
new-work admission re-probes engines last seen disconnected, so a login completed
outside Korus is picked up on retry. There is no continuous monitoring; remote hosts
report their own connections.

- Manual choices are remembered per client and host; an unavailable remembered engine
  falls back for new work without overwriting the preference. Existing conversations,
  delegated work, duplicates without an explicit backend, forks and persisted automations
  keep their engine and never silently switch on auth loss. Automations persist their backend for filtering and
  execution (filtering uses a tool-free, non-persisted Claude query) and fail before
  provisioning when it is disconnected.
- Enablement is persisted separately (`providerEnabled`); availability requires
  installed, authenticated **and** enabled. Toggling never probes or signs out. A host
  rejects disabling its last available engine. With no available engine, startup shows
  setup even for an existing workspace; setup can enable an already-authenticated
  engine without another login. Disabling preserves histories, drafts, queues and
  running turns, blocks new work, and pending Korus prompts resume on re-enable.
  Credential renewal and sign-in stay with the provider runtimes.
