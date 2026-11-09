---
title: Korus documentation
description: Use Korus, a harness orchestrator for Codex, Claude Code, Cursor, and Antigravity, to delegate tasks, coordinate agents, and review code.
---

# Korus documentation

<p class="docs-lead">Set up your coding agents, coordinate the work, and review the results in one workspace.</p>

Korus is a harness orchestrator for AI coding agents. Run Codex, Claude Code, Cursor, and Antigravity together, with conversations, repositories, browser previews, plans, and diffs beside the work.

<div class="docs-grid">
  <a class="docs-card" href="./getting-started/quickstart.html"><strong>Quickstart →</strong><span>Install Korus and take your first task through to a reviewed diff.</span></a>
  <a class="docs-card" href="./providers/"><strong>Provider guides →</strong><span>Connect your coding engines and choose one for each agent.</span></a>
  <a class="docs-card" href="./workflows/parallel-agents.html"><strong>Work with agents →</strong><span>Coordinate parallel work, isolate changes, and review the outcome.</span></a>
  <a class="docs-card" href="./troubleshooting/"><strong>Troubleshooting →</strong><span>Find the next step when setup, a conversation, or a workflow gets stuck.</span></a>
</div>

## Start with one task

Choose a repository and a small outcome. Ask an agent to inspect the relevant code, agree on the change, and run the appropriate checks. Review the full diff before committing.

Follow the [quickstart](./getting-started/quickstart) or the longer [first-task walkthrough](./getting-started/first-task).

## Build a team

Give each agent a clear responsibility and a working folder. Agents can share status and send messages through Korus's collaboration tools. Separate worktrees let multiple agents change the same repository independently.

Read [core concepts](./getting-started/core-concepts), [parallel agents](./workflows/parallel-agents), and [worktrees](./workflows/worktrees).

## Go from idea to delivery

Use a [Mission](./workflows/missions) to move through Requirements, Tickets, Implementation, Review, and Ship. Use [Code Review](./workflows/code-review) when you already have changes to assess. Explore an interface in [Design](./features/design) before coding, or use [Visualize](./features/visualize) to think through a system with diagrams.

## Choose your engine

Korus provides the workspace around your coding agent. Your selected provider supplies model access, account authentication, and usage limits. See the [provider guides](./providers/) for setup.

For issue-driven work, connect [GitHub, GitLab, or Linear](./providers/#connect-github-or-linear), [browse the backlog](./features/workspace#browse-and-start-backlog-work), and choose the code repository where the agent should work.

Use [Automations](./features/automations) to schedule recurring prompts in an agent or Quick Chat.

[Share a conversation](./features/conversations#share-a-conversation) to let a collaborator follow the work and suggest prompts. Use [Analytics](./features/workspace#understand-usage-and-performance) to compare token use, estimated API costs, and model performance.

Install and sync reusable workflows in [Settings → Skills](./providers/#manage-agent-skills). Bring Bitwarden or 1Password into the [in-app browser](./features/browser#use-your-password-manager), and [continue from your phone](./features/workspace#continue-from-your-phone) when you step away from the desktop.

::: tip Looking for developer documentation?
This guide covers using Korus. Architecture, protocol, frontend, and testing notes live in the repository's `docs/` directory.
:::
