---
description: Set up Codex with separate Korus chats or your existing environment, sign in, and configure skills and plugins.
---

# Codex

Korus uses the Codex CLI installed on your PATH. On macOS, it can also use the runtime included with ChatGPT in Applications when no standalone CLI is found. You still need an account with Codex access.

If Codex is not detected, use **Install** in Welcome or Settings to open the [official installation instructions](https://learn.chatgpt.com/docs/codex/cli#getting-started), then select the refresh icon. An explicitly configured runtime takes precedence over automatic detection.

## Choose a separate or existing setup

Korus defaults to your existing Codex setup and recognizes its sign-in. If Codex shows **Connected**, select **Continue**. To choose a separate setup, select **Customize** beneath it on the first connection screen. If you are already in the workspace, open **Settings → Codex → Location → Customize**.

For a separate environment:

1. Select **Separate Korus chats**.
2. Leave **Reuse my existing skills** checked to share your existing Codex skills and plugins, or uncheck it to manage them separately.
3. Select **Save**.

When you choose **Separate Korus chats**, Korus uses `~/.korus/codex-home` with the standard installation. Your normal Codex conversations and account configuration remain in their existing home. The separate setup requires its own sign-in; Korus does not copy your existing credentials.

For your existing environment:

1. Select **Use existing setup**.
2. Select **Save**.
3. Check the location displayed in Settings. It normally points to `~/.codex`, or the existing home configured in Korus's launch environment.

Korus can use the authentication and configuration already present there. If that setup is signed out, connect it using the steps below. This choice shares the provider home; it does not import old conversations as Korus agents or move them into a separate home.

::: warning Changing location after creating agents
Changing between these choices removes local Codex agents and Quick Chats from Korus after explicit confirmation. Their history stays in the old home, and switching back does not restore those agents. Read [Change the conversation location later](./index#change-the-conversation-location-later) first.
:::

## Connect Codex

1. Select **Connect Codex** on the first connection screen, or **Connect** under **Account** in **Settings → Codex**.
2. Complete the browser sign-in with the account you want Korus to use.
3. Return to Korus and wait for the account to show **Connected**. While sign-in is pending, **Cancel sign-in** lets you stop and retry.
4. If this is your first engine, choose **Continue** to proceed with setup. Otherwise, check that **Enable engine** is on in Settings.

If your selected existing setup is already authenticated, Korus can recognize it without another browser login. A connected engine that was disabled can be enabled again without signing out.

## Verify the first conversation

Create an agent in the working folder you want to use. Choose **Codex** if an engine picker appears, then select an available model and reasoning level from the conversation controls.

Start with a request such as:

> Read this repository's instructions and summarize how to run its checks. Do not change any files.

Check that Codex responds and uses the intended folder. If a tool needs approval, review the request in the conversation. A successful sign-in alone does not prove that every repository, model, or external tool is available.

## Permissions and configuration

Korus reads Codex configuration from the home shown under **Location**, together with applicable project configuration and instructions. Model, reasoning, and speed choices made in Korus take precedence for that agent.

**Permissions are explicitly set by Korus.** New agents default to **Full access**, unless Codex requirements restrict it. Choose a different preset using the permission control in the conversation composer:

| Preset | What it allows |
| --- | --- |
| **Ask for approval** | Uses Codex's workspace-write sandbox. Requests that need additional permission pause for your decision. |
| **Approve for me** | Uses the same workspace-write sandbox, with Codex's automatic reviewer deciding approval requests. |
| **Full access** | Runs without the Codex filesystem sandbox or tool-approval prompts. Your operating-system permissions still apply. |

Korus applies an available preset when creating a conversation. When loading or resuming one, it reapplies the agent's saved preset if the conversation differs. Changing the preset updates the conversation settings. Editing sandbox or approval defaults in your Codex configuration does **not** replace this agent-level choice, even if you configured read-only access there.

Codex's enforced requirements remain authoritative. If a requested preset is unavailable, Korus uses a compatible preset, preferring **Approve for me**, then **Ask for approval**, then **Full access**. If none is compatible, Korus leaves sandbox and approval settings to Codex's effective configuration. A Korus selection cannot bypass provider or organization restrictions.

## Credits and banked resets

Open **Settings → Codex** to view the connected account's **Credits** and **Banked resets** when available. These are provider account balances, not a separate Korus subscription.

Use **Refresh** to check banked resets. If an available reset offers **Use reset**, review the confirmation before applying it: this spends one reset to restore eligible Codex usage limits. Account and runtime support determine which details and actions appear.

## Skills, plugins, and MCP servers

With **Separate Korus chats → Reuse my existing skills** enabled, Codex shares the `skills` and `plugins` resources from your existing Codex home. This is live sharing: installing or editing a shared resource can affect Codex sessions outside Korus too.

The rest of the provider setup stays separate. For example, an MCP server configured only in your normal Codex configuration is not copied by checking **Reuse my existing skills**. Configure it for the home shown in Korus, or choose **Use existing setup** if you intend to share the full setup.

With reuse disabled, install the resources you need into the Korus Codex home. If Korus reports that private skills or plugins already exist when enabling sharing, leave sharing disabled to preserve them rather than treating reuse as an automatic merge.

Korus supplies its collaboration tools automatically; no extra server setup is needed to coordinate teammates. See [Agent collaboration](../reference/agent-collaboration).

## Customize Codex

For the **Separate Korus chats** setup on macOS:

1. Install the ChatGPT desktop app if you want to use its Codex customization interface.
2. Open **Settings → Codex** and select **Launch ChatGPT**. **Settings → Plugins → Install Codex Plugins and MCP Servers** uses the same launch action.
3. If ChatGPT is already running, Korus offers to quit and relaunch it for the separate Korus Codex home.
4. Manage the desired skills, plugins, or other Codex configuration there, then return to Korus and verify it in a conversation. For sandbox and approval behavior, the [Korus permission preset](#permissions-and-configuration) takes precedence where permitted.

::: info Existing setup and ChatGPT launch
The current **Launch ChatGPT** action targets Korus's separate Codex home. If you chose **Use existing setup**, customize the existing Codex environment you selected rather than assuming this launch action opens it. Check **Location** before comparing settings.
:::

To edit personal instructions, open **Settings → Personalization**, choose **Codex**, and check the displayed instruction-file path. These edits follow the selected Codex home; with **Use existing setup**, they also affect your setup outside Korus.

## Connection problems

| Symptom | What to check |
| --- | --- |
| Codex is signed in in your terminal, but Korus asks for sign-in | Compare homes under **Location**. A separate Korus home needs its own authentication. |
| The first screen says **Detected**, but work cannot start | Detection confirms the runtime, not authentication. Complete **Connect Codex**. |
| Browser sign-in remains pending | Finish the flow in the browser or select **Cancel sign-in** and retry. |
| A skill, plugin, or MCP server is missing | Check the selected home and whether resource reuse is enabled. Skills/plugin sharing does not copy all provider configuration. |
| Codex is not detected | Install the CLI on PATH, or on macOS check that ChatGPT is installed in Applications with its Codex runtime, then select the refresh icon. Check any configured runtime path too. |
| The engine is connected but unavailable for new work | Turn on **Enable engine**. **Disconnect** signs out of the selected Codex setup; connect again if you used it. |

When reporting a problem, include the Korus version, displayed location, runtime choice, and the error message. See [Troubleshooting](../troubleshooting/) for the wider diagnostic checklist.
