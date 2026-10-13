<p align="center">
  <img src="vue/assets/icon.png" width="112" height="112" alt="Korus app icon" />
</p>

<h1 align="center">Korus</h1>

<p align="center">
  <strong>Build with agents. From idea to delivery.</strong><br />
  Build with a team of coding agents—across repositories and machines.
</p>

<p align="center">
  <a href="#get-korus"><strong>Get Korus for macOS, Windows, and Linux</strong></a>
  ·
  <a href="https://meetkorus.dev">Website</a>
  ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img src="website/assets/app-screenshot.png" alt="Korus with repository-grouped agents, a conversation, and input-needed status, shown with demo data" width="960" />
</p>

Korus brings your coding agents into one workspace. Use one engine
on its own or run a mixed team: give agents their own conversations and
workspaces, see what everyone is doing, and step in when your input is needed.

Korus is free to use. Connect your provider accounts; provider subscriptions
and API usage are billed separately.

## One cockpit for the whole team

- **Run a real team** — Organize agents into teams, give each one a repository,
  identity, conversation, and durable workspace, then switch between them
  without interrupting their work.
- **Choose your engines** — Connect the coding providers you use. Use different
  engines for different agents; available controls reflect each engine's
  supported capabilities.
- **Work across machines** — Connect teams on other machines over SSH and
  manage their agents alongside local teams.
- **See the work, not a terminal stream** — Follow messages, plans, reasoning,
  tool calls, approvals, command output, file changes, and diffs in a native
  conversation UI.
- **Let agents collaborate** — Agents can discover teammates, share status,
  send messages, queue follow-up work, and coordinate through Korus's
  built-in MCP tools.
- **Browse without leaving** — Every agent can keep an in-app browser for
  research, local previews, and browser-based tools—even while another agent is
  selected.
- **Use the computer when code is not enough** — Opt-in Computer Use lets agents
  inspect and operate macOS applications while you keep the session visible.
- **Review with context** — Open Git changes, source files, turn-specific diffs,
  Markdown, execution plans, and Plan-mode proposals beside the conversation.
- **Keep Codex work accessible from your phone** — Pair Codex mobile with
  Korus's Codex connection while agents continue running through the background
  backend. This pairing is specific to Codex.
- **Bring your backlog** — Connect GitHub or Linear to browse issues, start
  agent work, or shape a Mission. Choose the code repository separately from a
  Linear team or project; GitHub remains the home for pull requests.
- **Schedule recurring work** — Send prompts to an existing agent or Quick Chat,
  or start a fresh Quick Chat each time. Choose daily, weekday, weekly, custom,
  or interval schedules, or ask an agent to create an automation from chat.

## From idea to delivery

- **Missions** — Shape a feature through Requirements, Tickets, Implementation,
  Review, and Ship. Approve the brief and tickets, follow workers across
  repositories, review findings, and deliver through pull requests or merges.
- **Delegate** — Discuss a task, then use `/delegate` (or `/worktree`) to send a
  self-contained handoff to a new Korus teammate in a dedicated worktree. Your
  original conversation stays open; pushing and merging remain separate decisions.
- **Review** — Use `/review` to assess a branch or uncommitted changes with an
  independent reviewer or the current agent. Inspect structured findings,
  choose which fixes to apply, and run another review round.
- **Visualize** — Use `/visualize` to explore designs on an editable diagram
  canvas beside the conversation. Annotate a shape to request a targeted change
  without losing your other edits.
- **Hand off** — Continue an idle task with a replacement agent, optionally
  switching engines or models. The current agent writes a handoff note; the
  replacement works in the same folder, with the source history still accessible.

Review, Delegate, and Visualize are also available from the composer's **+** menu.

## Built around your workflow

Create agents from repositories and give each one a prompt, then move freely
between active conversations: drafts, attachments,
queues, model settings, browser tabs, and sidebar state stay with the agent.

Queue a follow-up while an agent is working; Korus sends it when the current
turn finishes. Both Codex and Claude Code support steering; Claude receives the
update at a tool boundary or in a following turn, rather than immediately
interrupting a running tool. Claude also supports idle conversation forks in
the same folder and native goals; its goals do not support token budgets.

Keep two or four agents visible in split panes, with one shared artifact sidebar
following the focused agent. With the background backend enabled, closing the
desktop app leaves the team running. Saved workspace state is restored when
you return.

## Get Korus

Korus is available for macOS on Apple silicon, Windows x64, and Linux
x64/ARM64. Download it from [GitHub Releases](https://github.com/nbonamy/korus/releases).
Prereleases require manual downloads; automatic updates
on macOS and installed Windows copies follow stable releases only. Windows
installers are unsigned. Linux and portable Windows updates are manual.
To run from source, see [Development](#development).

1. Download a published installer for your platform and architecture from GitHub Releases.
2. Install and launch Korus:
   - **macOS:** Open the DMG and double-click Korus to install and launch it.
   - **Windows:** Run the installer, or extract the portable ZIP and launch Korus.
   - **Linux:** Install the DEB or RPM for your architecture, or extract the ZIP
     and launch Korus.
3. Install and connect a coding engine, then choose Continue. Only one connected
   engine is required. See the [provider guides](website/docs/providers/index.md)
   for installation and sign-in, including Antigravity's ACP runtime.
4. Create a team, add an agent from a repository, and start coding. When multiple
   engines are enabled, choose which one the agent uses.

By default, Korus keeps its conversations separate from your existing agent
chats. Choose Customize for an installed engine during setup
to use your existing setup instead. A separate setup requires its own sign-in.
You can also share existing provider skills with a separate setup. Settings shows
each engine's account, conversation location, and enabled state.

## Development

Requirements:

- macOS arm64, Windows x64, or Linux x64/arm64;
- Node 22.23.3 and npm 10.9.4 (the CI toolchain);
- a separately installed runtime for each coding engine you want to use.

```bash
npm ci
node node_modules/electron/install.js
npm run dev
```

Workspace manifests pin published Codex App SDK packages; the lockfile is the
release dependency boundary. No sibling checkout is required. SDK contributors
can explicitly set `CODEX_APP_SDK_SOURCE=1` for development source aliases.
Install Electron once before running parallel tests: its lazy first-import
download can otherwise race across workers on a clean checkout.

On Windows, run development from PowerShell with Node and npm installed. The
launcher invokes npm through Node, so it does not require a Unix shell or direct
execution of `npm.cmd`. Korus detects provider runtimes on PATH; **Install** in
Welcome and Settings opens external installation instructions. Provider runtimes
are not bundled with Korus or automatically installed by its build.

Focused project gates:

```bash
npm test
npm run test:coverage
npm run lint
npm run typecheck
```

Builds consume the pinned Computer Use artifact and verify its checksum. Set
`COMPUTER_USE_LOCAL=1` in `.env` to build the helper from a sibling
`computer-use` checkout instead.
Computer Use and AppShots are macOS-only. Windows and Linux builds skip the
Computer Use helper and do not package its native automation dependency.

macOS release packaging signs and notarizes by default. For local packaging
checks that do not need signing:

```bash
APP_SKIP_SIGNING=1 npm run package
```

Once the prepared release commit is pushed, **`npm run prerelease`** builds and
publishes a prerelease; **`npm run latest`** builds and publishes a stable release.
Both infer the version from package.json, create the missing version tag, and
monitor one GitHub workflow through
quality checks, all four platform builds, and publication. Installers are
uploaded by GitHub runners; there is no combined bundle or separate publishing
workflow.
See [GitHub desktop releases](docs/backend-architecture.md#github-desktop-releases)
for the target matrix, launch/monitor commands, signing setup, and publication.

### Native companion development

Run the relay on its own, in a separate terminal:

```bash
npm run dev:relay
```

It serves the plain `ws://localhost:<port>` address from `APP_COMPANION_RELAY_URL` (the
repository `.env` sets it) for the local daemon's laptop identity; plaintext is accepted
only on loopback and no certificate is involved. On start it prints its identity for
`APP_COMPANION_RELAY_PEER_ID`. Start the desktop app once beforehand so the laptop has an
identity. It rebuilds the relay bundle on every start.

The iOS companion connects to the owning laptop daemon through a WSS relay. The relay
is deployment configuration shared by the laptop and the phone build:

```bash
APP_COMPANION_RELAY_URL=wss://relay.example
APP_COMPANION_RELAY_PEER_ID=<relay identity printed by the relay at startup>
```

The daemon reads them at runtime (desktop app environment or `.env`); set them as GitHub
variables for the production pipeline. With a relay configured, Settings → Connections →
Mobile access offers Pair phone, which shows a short code like `K7QD-M2XP` (and a QR code
of it). Entering it in the companion app pairs the phone; a new phone then needs your
approval on the desktop, which grants it every team and prompt sending.

Relay operators build the standalone artifact with
`npm run build:relay -w @workspace/backend`. Container packaging lives in
`backend/companion-relay/`: supply a reviewed Node image pinned by digest, a valid
public TLS certificate, a persistent identity volume and admitted laptop PeerIds.
The compose configuration maps outbound-facing WSS port 443 to the container's
8443 listener. Health checks remain inside the container. Relay deployment and
native signing are separate from building these artifacts.

## Architecture

Korus separates the desktop shell from the long-running agent backend:

```text
Vue renderer → typed preload IPC → Electron main → daemon → backend driver
                                                          ├─ Codex app-server
                                                          ├─ Claude Agent SDK
                                                          └─ Antigravity ACP
```

Electron owns native desktop integration. `daemon` owns agent runtime state,
persistence, collaboration, backend processes, git, approvals, and background
work. The renderer consumes app-owned events rather than provider protocol
types.

## Documentation

- [User guide](website/docs/index.md): setup, providers, workflows, features, and troubleshooting.
- Run `npm run docs:dev` for a local VitePress preview, or `npm run test:docs`
  to build the public website and check its generated documentation links.
- [Architecture](docs/architecture.md)
- [Backend protocol](docs/protocol.md)
- [Codex integration](docs/codex.md)
- [Claude Code integration](docs/claude.md)
- [Antigravity integration](docs/backend-architecture.md#antigravity)
- [Agent collaboration and MCP](docs/mcp.md)
- [Frontend conventions](docs/frontend.md)
- [Testing](docs/testing.md)
- [Contributor agent instructions](AGENTS.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
