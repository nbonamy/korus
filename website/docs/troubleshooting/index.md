---
description: Diagnose setup, provider, conversation, Git, and preview problems.
---

# Troubleshooting

Start with the action that failed and the error it produced. Preserve unfinished work before changing the setup or restarting a process.

## The app will not launch

Confirm you installed the build matching your platform and architecture. On macOS, move Korus to Applications; Windows builds are unsigned. Record the app version and any error shown during launch. See [Installation](../getting-started/installation) for platform-specific steps.

Development builds have additional runtime and SDK requirements described in the repository README.

## A provider will not connect

1. Open the failing engine's Settings page.
2. Check the selected setup location. A successful login in your normal command-line environment does not authenticate a separate Korus setup.
3. Complete the authentication flow for that selected location. A detected engine and a connected account are separate states.
4. Confirm the engine is enabled. The initial **Continue** button needs at least one installed, connected, enabled engine.

See the [provider guides](../providers/) for the engine's setup and sign-in steps. If Antigravity is not detected, check that its runtime and matching harness are both installed, then select the refresh icon. Include the selected provider and any custom runtime or provider home when reporting the error.

## My previous conversations are missing after changing setup

Check whether you changed **Location** between **Separate Korus chats** and **Use existing setup**. Those environments have different provider history and authentication. The location-switch flow can remove the affected local Korus agents and Quick Chats after you acknowledge it; it does not migrate their history into the new location.

Read the [provider setup overview](../providers/) before making another change. Preserve any repository edits independently of the conversation history.

## GitHub works in another app but not in Korus

Coding-provider authentication is separate from GitHub access. Korus can use GitHub CLI authenticated to github.com on the computer hosting the workspace, or its own GitHub connection. Check that the selected account can access the repository, then restart Korus if you changed the GitHub CLI account after launching it. If CLI access is unavailable, complete GitHub authorization in **Settings → Integrations**.

If you skipped GitHub during onboarding, local folder tasks still work. Connect GitHub when you need repository browsing or issue and pull-request workflows. Automations only need GitHub if their prompt calls for it.

## A task is waiting

Inspect the active conversation for a question, approval, queued instruction, or provider error. A waiting task may need a response before work can continue.

If it is actively running, steer or interrupt through the conversation controls as appropriate.

If a Mission is waiting for review, open the selected stage artifact and either provide feedback or accept the proposal. If standalone Code Review has findings, use its review/remediation flow rather than expecting a conversation message to finish the review automatically.

## A worktree or merge fails

Check the repository's status, branch, and existing worktrees. Keep dirty or unfinished work intact. Inspect the reported Git error and resolve the specific conflict before trying integration again.

## A browser preview is blank

Confirm the development server is running and the URL uses the correct port. Inspect the browser console and ask the agent to verify the route that failed. A successful build alone does not prove a page rendered.

The in-app Browser is separate from your Chrome browser and its existing tabs. Follow [Browser](../features/browser) when the task specifically needs Chrome or an existing browser login.

## A password manager will not fill a login

Check **Settings → Browser** to confirm the extension is installed and enabled. Open its toolbar popup, finish sign-in, and unlock the vault. Check that the saved login matches the page's address and grant any site access the extension needs. If Bitwarden reports missing desktop integration, enable browser integration in the Bitwarden desktop app.

Use the extension's **Update** or **Reinstall** action when needed, then reload the page. **Clear browsing data…** signs agents out of websites but preserves extension data; **Remove** uninstalls the extension and clears its Korus storage. See [Browser](../features/browser#use-your-password-manager).

## A skill is missing from an agent

Open **Settings → Skills → Installed** and inspect the provider icons for the skill. Use **Sync this skill** or **Sync** to make it available to your configured local agents. An existing conflicting copy is preserved; decide which copy to keep and remove or rename the conflict before syncing again. Remote teams use the skills installed on their own computer. See [Manage agent skills](../providers/#manage-agent-skills).

## Computer Use cannot act

Enable the capability in **Settings → Plugins**, then check **Settings → General → System permissions** for the required macOS access. Record whether discovery, a window observation, an interaction, or capture failed.

## Work stops when the app closes

Check **Settings → General → Keep Korus ready in the background** and its reported daemon status. Distinguish closing the desktop window from intentionally stopping the background service.

When you return, inspect the conversation for an approval, question, or provider error before submitting the same instruction again. Preventing sleep while agents run is a separate General setting.

## Report a problem

Include the app version, platform, provider, steps to reproduce, expected result, actual result, and exact error. Use a small reproduction and remove private account details, credentials, and repository content from shared logs or screenshots.
