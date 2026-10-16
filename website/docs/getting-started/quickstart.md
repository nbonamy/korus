---
description: Install Korus, connect a provider, and complete a small repository task.
---

# Quickstart

Start with one repository, one agent, and a small change you can review.

## Install Korus

[Download Korus](__PRODUCT_DOWNLOAD_URL__) for your platform and launch it. See [Installation](./installation) for macOS Apple silicon, Windows x64, and Linux x64 / ARM64 instructions.

## Choose your provider's setup

Korus uses your existing Codex and Claude Code setup by default. Install your chosen engine if it is not detected. To keep Korus chats separate, select **Customize** beneath that engine and choose **Separate Korus chats**.

If your engine already shows **Connected**, select **Continue**. Otherwise, select **Connect** and complete its authentication steps first. You can manage each engine's setup later in Settings.

The [provider guides](../providers/) explain setup and sign-in, including bundled runtime options and [Antigravity installation](../providers/#antigravity). Model access and usage limits come from the provider account you connect.

At the GitHub step, connect Korus directly for faster GitHub access. If an authenticated GitHub CLI is detected, you can choose **Use GitHub CLI** instead. Otherwise, select **Skip for now** for a local repository task.

## Open your repository

Choose **Existing folder or repository…** from the empty workspace's start-work menu and select your local checkout. You can also open a GitHub repository or clone a repository URL from that menu.

If multiple engines are enabled, select the engine for the new conversation. Keep the default checkout for a small first task. To add another conversation for an open repository, use its **New session** plus button in the sidebar and choose the checkout or branch you want.

For a first task, use a repository whose current changes you understand. If other agents will also write to it, use [separate worktrees](../workflows/worktrees).

## Ask for a bounded change

For example:

```text
Inspect the settings screen and explain how it saves preferences.
Then add a helpful empty state where no preferences are available.
Follow the repository instructions and run the relevant checks.
```

Follow the conversation as the agent inspects files, proposes work, and runs commands. Respond when it asks for input or an approval.

## Review the result

Open the Git changes and inspect the full diff. Check what was validated and what remains unverified. Ask for corrections, or use [Code Review](../workflows/code-review) for an independent pass.

Before delivery, confirm these four things:

- The agent worked in the intended folder and branch.
- The complete diff contains only the change you requested.
- The reported checks exercised the behavior you changed.
- Any unfinished work or unverified behavior is stated clearly.

When the result is ready, ask for the commit or delivery action you want. A completed turn does not imply a commit, push, or deployment. Continue with [Your first task](./first-task) for a fuller walkthrough.
