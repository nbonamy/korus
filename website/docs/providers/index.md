---
description: Connect coding engines for agent work, and GitHub or Linear for backlog work.
---

# Provider guides

Korus can run different coding engines in the same team. Each engine has its own account, conversation location, and customization. Connecting one does not authenticate the others.

| Engine | Installation and sign-in |
| --- | --- |
| [Codex](./codex) | Uses an installed CLI, or ChatGPT's runtime on macOS; browser sign-in from Korus |
| [Claude Code](./claude-code) | Uses an installed CLI or Korus's bundled runtime; sign-in through a command copied from Korus |
| [Antigravity](#antigravity) | Install its runtime from Korus; native Google sign-in |

## Choose where each engine keeps its setup

Korus checks for an available runtime first. Installed Codex and Claude Code CLIs take precedence over their fallback runtimes. If an engine is missing, **Install** opens external instructions for Codex and Claude Code, or downloads the Antigravity runtime directly. The refresh icon rechecks detection. Codex and Claude Code reuse their existing setup by default. Select **Continue** when an engine is already connected, or **Customize** beneath it to choose a separate setup. Later, open its Settings page and select **Customize** beside **Location**.

There are two choices under **Conversations**:

| Choice | Conversations and sign-in | Skills and configuration |
| --- | --- | --- |
| **Separate Korus chats** | Korus uses its own provider home. Sign in for that setup, even if the engine already works in your terminal. | **Reuse my existing skills** can share skills with that home. Other provider configuration remains separate. |
| **Use existing setup** | Korus uses the provider home you already use outside Korus, including its sign-in and conversation storage. | Skills and configuration belong to that existing setup; changes can affect sessions outside Korus too. |

New Codex and Claude Code setups default to **Use existing setup**. **Separate Korus chats** uses its own sign-in; **Reuse my existing skills** controls skill sharing for that separate setup. Choose independently for each engine. Existing installations keep their saved choices; check **Location** to see the selected setup.

A provider home is the folder where that engine keeps its account state, conversations, and user configuration. With the standard Korus installation, separate homes are:

- Codex: `~/.korus/codex-home`
- Claude Code: `~/.korus/claude-home`
- Antigravity: `~/.korus/antigravity-home`

Existing setups normally use `~/.codex`, `~/.claude`, or `~/.gemini` for Antigravity. Custom launch environments can use different paths, so the path displayed under **Location** is the one to check when troubleshooting.

::: tip Separate chats can still share skills
**Reuse my existing skills** links to your existing provider skills rather than taking a one-time copy. Updates are shared in both directions. For Codex, this choice also shares the provider's plugins; other engines share skills only. It does not copy your sign-in or move your old conversations.
:::

Uncheck **Reuse my existing skills** if you want to manage those resources separately too. Repository instructions and project configuration still apply to the working folder you open.

## Connect and verify

1. Install the engine if needed, choose its conversation setup, then **Save**.
2. Follow the [Codex](./codex#connect-codex), [Claude Code](./claude-code#connect-claude-code), or [Antigravity](#antigravity) sign-in steps. **Detected** means the runtime is available; **Connected** means Korus recognizes the selected setup's authentication.
3. Connect at least one engine, then select **Continue** on the first connection screen.
4. In the engine's Settings page, check that **Account** shows **Connected** and **Enable engine** is on.
5. Start a small conversation and check that the engine can respond before assigning a larger task.

## Accounts and usage

Authentication, model availability, and usage limits belong to the selected provider. Connecting an account to Korus does not create a new model subscription or transfer one provider's access to another. Claude subscription sign-in and Anthropic Console API billing are separate choices in its connection dialog.

For usage recorded by Korus, open [Settings → Analytics](../features/workspace#understand-usage-and-performance). These local statistics are separate from your provider's remaining quota, credits, and billing.

## Antigravity

Select **Install** in Welcome or **Settings → Antigravity**. Korus downloads the appropriate runtime directly from Google, verifies it, and enables **Connect** when it is ready. A spinner appears during installation. No terminal commands or PATH changes are needed. Installation supports Apple Silicon and Intel Macs, and Linux and Windows on x64 and ARM64.

Antigravity uses Google's ACP runtime, independently of the editor and the `agy` CLI. If you prefer to install it yourself, the [ACP registry entry](https://github.com/agentclientprotocol/registry/blob/dc55a34900fdd60e5e97c1cbd7825c5a1df673fc/antigravity-acp/agent.json) lists platform downloads. Extract the runtime and its companion executable together into a directory on PATH (`agy_acp_server.par` and `localharness_external` on macOS/Linux, or their `.exe` versions on Windows). Make both executable on macOS/Linux, then select the refresh icon in Korus.

Once detected:

1. Select **Customize** to choose separate Korus chats or your existing setup. Antigravity's existing setup uses `GEMINI_HOME` when configured, otherwise `~/.gemini`.
2. Select **Connect Antigravity** in Welcome, or **Connect** in its Settings page, and complete the native Google sign-in flow. Credentials stay with Antigravity; do not paste them into chat.
3. Wait for **Connected**, enable the engine, and select it when creating an agent. Verify with a small read-only repository task.

Antigravity supports streaming conversations, history, approvals, interruption, native Plan mode, and Korus workflows including reviews, Missions, delegation, and automations. Review its proposed plan before accepting implementation. Model choices come from the ACP runtime and may differ from the editor's catalog; available effort variants appear in the model choices.

Desktop conversations accept images, WAV audio, PDFs, and UTF-8 text attachments. Antigravity attachments are unavailable for remote teams and browser-hosted sessions. Steering a running turn, goals, conversation forks, and edit/retry/delete turn actions are not available; queue a follow-up or interrupt instead. See [Conversations](../features/conversations) for shared controls.

## Connect GitHub or Linear

Korus detects GitHub CLI (`gh`) authenticated to github.com on the workspace host. During onboarding, connect Korus directly for faster access or choose **Use GitHub CLI**. Settings shows **Using GitHub CLI** with a **Connect** button for direct authorization. Canceling or disconnecting a direct GitHub connection returns to authenticated CLI access when available. Existing direct connections keep their account. CLI access supports repository, issue, and pull-request workflows; hosted GitHub MCP tools require a direct connection.

Coding engines and backlog integrations are separate choices. The selected engine runs the agent; GitHub or Linear supplies the work items.

Open **Settings → Integrations** and connect the service you want to use:

| Integration | Connect | Backlog source |
| --- | --- | --- |
| GitHub | Select **Connect**, copy the displayed device code, open GitHub, and authorize Korus. Return when authorization finishes. | A GitHub repository, with issues and pull requests. |
| Linear | Select **Connect**, complete sign-in and authorization in the browser, and return to Korus. Check for **Connected** and the expected account. | A Linear team or project, with issues. |

Linear does not require pasting an API key or registering your own OAuth application in Settings. **Cancel** stops an in-progress authorization; use **Connect** to retry. If the build reports that Linear sign-in is not configured, use a build with Linear configuration rather than entering credentials in chat. **Disconnect** removes Korus's connection to that service without disconnecting the other integration or your coding engines.

In backlog pickers, choose the provider first, then its **Repository** or **Team / project**. Browsing only offers connected providers; with one connected provider, the provider selector is hidden.

A Linear team or project identifies **where the issue lives**, not **where code runs**. Work started from a repository uses that repository. Without a repository context, choose a **Code repository** before starting. [Automations](../features/automations) schedule prompts independently of work sources; include the repository in the prompt when asking a Quick Chat to create an agent or worktree.

Git branches, commits, pushes, and pull requests still belong to the code repository. Linear supplies backlog work; it does not replace GitHub's pull-request workflow. See [Browse and start backlog work](../features/workspace#browse-and-start-backlog-work) and [Missions](../workflows/missions) for the entry points.

## Manage agent skills

Open **Settings → Skills** to give your coding agents reusable instructions for design, security, testing, and other work.

### Discover and install

The **Discover** tab offers individual skills and packs, including Security audit, Web design guidelines, Impeccable, Matt Pocock's skills, Superpowers, and pstack. Choose **Install** or **Install pack** to add one.

To bring another source, choose **Install skill** and paste a GitHub repository or skill-folder URL, a skills.sh skill URL, or a `skills add` command. When several coding agents are configured, select which should receive the installation. Packs install the skills they contain; check the source and instructions before using code or workflows from an unfamiliar author.

### Inspect and sync

The **Installed** tab includes skills installed through Korus and skills already present in your local coding-agent setups. Search by name or description, switch between **Personal** and **Built-in**, and check the provider icons to see where a skill is available.

Open a skill's **… → View skill** action to read its instructions. When installed copies differ, the viewer lets you inspect each version. Installing a skill does not by itself run its workflow; select or request the skill in a conversation when you want the agent to use it.

Choose **Sync** to make personal skills available across your configured local coding agents, or **Sync this skill** for one entry. Existing conflicting installations are preserved. If a provider still shows a conflict, decide which copy to keep, remove or rename the conflicting installation, and sync again. Remote computers manage their own skills.

### Refresh or remove

Use **Refresh** on a managed skill or pack in Discover to download its source again. In Installed, **Delete skill** asks for confirmation before removing that skill's installed folders across configured coding agents. **Uninstall** on a pack removes the skills Korus installed from that pack. Original sources of linked skills are kept, and built-in skills are protected from deletion.

Skills add instructions and workflows; your provider account still supplies model access. They are separate from browser extensions and coding-provider plugins.

## Choosing an engine

When multiple engines are available, choose an engine when starting new work. With only one available engine, Korus can use it without showing a picker. Models, reasoning controls, and permission choices depend on that engine.

An existing conversation stays with its provider. Connecting another engine does not convert it. To continue work with another engine, use [Hand off…](../features/conversations#hand-work-to-another-engine), which creates a replacement agent in the same workspace using a written handoff.

**Enable engine** controls whether Korus uses an engine without signing out. **Disconnect** signs out of the account in the selected provider home; saved conversations remain. With **Use existing setup**, that sign-out also affects the shared terminal setup. Korus prevents turning off the last active engine with the enable toggle; connect or enable another one first.

## Change the conversation location later

Choose the location before creating agents when possible. Switching between **Separate Korus chats** and **Use existing setup** after starting work has consequences:

1. Wait until the affected engine's local agents are idle. Finish or discard affected code reviews and finish affected Mission runs.
2. Open the engine's Settings page, choose **Customize**, select the new location, and select **Save**.
3. Review **Change conversation setup?** Korus reports how many local agents, including Quick Chats, will be removed.
4. Acknowledge the removal, then choose **Remove agents and switch** only if you intend to proceed.
5. Connect the new setup if needed and create new agents there.

Conversation files remain in the previous provider home. This action does not migrate them, and switching back does **not** restore the removed agents in Korus. Your repository folders and worktrees are not deleted by the location switch. Remote-team agents use their remote host's setup and are outside this local reset.

## If the connection behaves differently from your terminal

Compare the path under **Location** first. A working terminal sign-in, skill, or MCP server may belong to an existing home while Korus is using a separate one. Resolve installation and authentication errors in the engine's Settings page, then verify with a small conversation.

For additional help, record the engine, app version, displayed location, and exact error. Continue with [Troubleshooting](../troubleshooting/).
