---
description: Connect Claude Code, choose its conversation home, sign in to the correct setup, and verify a Korus agent.
---

# Claude Code

Claude Code runs as an independent engine with its own authentication. Korus uses your installed Claude Code CLI when available, or its bundled runtime when there is no separate installation. A connection to another provider does not connect Claude Code.

## Install and choose a setup

1. Check Claude Code on the first connection screen or in **Settings → Claude Code**. When detected, select **Customize**, or use **Location → Customize** in Settings.
2. Select **Separate Korus chats** or **Use existing setup**.
3. For separate chats, leave **Reuse my existing skills** checked if you want to share existing Claude Code skills; uncheck it to keep skills separate too.
4. Select **Save**.

You do not need a separate CLI installation when the bundled runtime is available. If no runtime is detected, **Install** opens the [official Claude Code installation instructions](https://code.claude.com/docs/en/quickstart#step-1-install-claude-code). Install it on PATH and select the refresh icon. Detecting a runtime and signing in are separate steps.

### Separate Korus chats

With the standard installation, this uses `~/.korus/claude-home`. Claude authentication, saved conversations, and user configuration follow that home. Your usual terminal setup remains separate, so signing in there does not automatically sign in to Korus's setup.

**Reuse my existing skills** shares your existing Claude `skills` directory with the separate home. Changes are shared rather than copied once. This option does not import credentials, conversations, plugins, or the rest of your Claude configuration.

### Use existing setup

This uses your existing Claude home, normally `~/.claude`, or a configured existing location in Korus's launch environment. Korus can recognize the authentication already present there. Skills and user configuration are shared with Claude Code sessions outside Korus.

Check the path under **Location** after saving. Choosing an existing home does not turn its old conversations into Korus agents or copy them into a separate home.

::: warning Changing location after creating agents
Changing these choices later requires confirming removal of local Claude Code agents and Quick Chats from Korus. Their conversation files remain in the previous home, and switching back does not restore the agents. Read [Change the conversation location later](./index#change-the-conversation-location-later) before switching.
:::

## Connect Claude Code

1. Select **Connect Claude Code** on the first connection screen, or **Connect** under **Account** in **Settings → Claude Code**.
2. The connection dialog offers two sign-in commands: **Claude subscription** and **Anthropic Console (API billing)**. Choose the account type you intend to use and copy that command.
3. Paste the complete command into Terminal and run it. Complete Claude Code's sign-in flow.
4. Return to the Korus dialog and select **Refresh status**.
5. Check that Claude Code shows **Connected**. On first setup, select **Continue**; in Settings, check that **Enable engine** is on.

The displayed command targets the runtime Korus selected and includes the configuration-directory environment needed for your setup. Copy it in full, including any executable path: a plain terminal command may use a different installation or authenticate a different home.

Run **one** of the offered commands, not both. Claude Code manages the credentials; you do not paste credentials into Korus.

If the existing setup is already authenticated, Korus may recognize it immediately and close the dialog. You can re-enable a connected engine without another login.

## Verify a conversation

Create an agent in the folder you want to work in and choose **Claude Code** if an engine picker appears. Start with a small request:

> Read this repository's instructions and summarize how to run its checks. Do not change any files.

Confirm that the engine responds and uses the intended working folder before assigning implementation work. Review any permission requests in the conversation. Available models, effort levels, and permission modes depend on Claude Code; Codex controls do not all apply to Claude sessions.

## Conversation controls

For steering, forks, and goals, see [Conversations](../features/conversations). Steering waits for a tool boundary or following turn; forks require an idle conversation and keep the same working folder; goals require native hooks and do not support token budgets. Edit, retry, and delete turn actions remain unavailable.

Supported models offer **Fast** in the composer's speed selector. It uses additional provider billing outside subscription usage; check the model's option before enabling it. Choose normal speed to turn it off.

Use **Subagents** in the conversation header to follow Claude's native child tasks and open their individual threads. See [Follow native subagents](../workflows/parallel-agents#follow-native-subagents) for how this differs from a separate Korus teammate.

## Configure instructions, skills, and external tools

For personal instructions, open **Settings → Personalization**, choose **Claude Code**, and check the displayed instruction-file path. The file belongs to the selected Claude home. With **Use existing setup**, your edits also affect Claude Code outside Korus. Project instructions continue to apply in the working folder.

Configure Claude-specific external tools for the selected home or project using your Claude Code setup. When using a separate Korus home from Terminal, use the same configuration-directory prefix shown in the connection dialog so you are configuring the environment Korus actually uses.

The **Codex** section in **Settings → Plugins** manages Codex resources; it is not a Claude plugin manager. Selecting **Reuse my existing skills** for Claude does not share the Codex plugin catalog or copy MCP configuration from another provider.

Claude agents can use Korus's collaboration tools without installing Codex or configuring an extra server. See [Agent collaboration](../reference/agent-collaboration).

## Connection problems

| Symptom | What to do |
| --- | --- |
| No runtime is detected | Use **Install** to open the instructions, install Claude Code on PATH, then select the refresh icon. A packaged Korus installation can use its bundled runtime without a standalone CLI. |
| Your terminal is signed in, but Korus is not | Check **Location** and use the full login command copied from Korus, including its home prefix. |
| You finished terminal login, but the dialog is still open | Select **Refresh status**; terminal sign-in is not an automatic completion signal for this dialog. |
| Korus reports an authentication-check error | Check the detected runtime and use the complete login command for the selected home, then retry **Connect** and **Refresh status**. |
| A skill is missing | Check whether **Reuse my existing skills** is enabled and whether the skill belongs to Claude Code's existing home or the current project. |
| A plugin or MCP server works outside Korus only | Check which home or project owns its configuration. Sharing skills does not copy those settings. |
| Changing setup reports private skills already exist | Leave skill sharing disabled to preserve the separate home's skills. Korus does not overwrite them to enable reuse. |
| The engine is connected but absent when starting work | Check **Enable engine**. **Disconnect** signs out of the selected Claude setup; connect again if you used it. |

When reporting a problem, include the Korus version, location shown in Settings, account type, error text, and whether the failure occurs during installation, sign-in, conversation creation, or sending a prompt. Continue with [Troubleshooting](../troubleshooting/).
