---
description: Answers to common questions about accounts, local state, agents, and delivery.
---

# Frequently asked questions

## Does Korus include model access?

Use your connected coding provider's account and plan. Korus supplies the workspace; the provider determines model availability and usage limits.

## Which desktop platforms are supported?

Choose macOS Apple silicon, Windows x64, or Linux x64 / ARM64 from [Downloads](__PRODUCT_DOWNLOAD_URL__). Computer Use and AppShots are macOS-only.

## Do agents share files?

Agents using the same folder share its files. Use separate [worktrees](../workflows/worktrees) for concurrent writers in one repository.

## Does “Separate Korus chats” mean a separate model subscription?

It selects a separate provider setup environment for Korus's chats, sign-in, and configuration. You still use a provider account with the model access you need. Each engine makes this setup choice independently.

See [Provider guides](../providers/) for the exact account, skills, and plugin boundaries.

## Why do I need to sign in when my CLI is already connected?

Check the engine's selected setup location. A separate Korus environment has its own authentication; **Use existing setup** selects the provider environment already configured on this computer. Signing in to one engine does not authenticate the others.

## Do I need GitHub to use Korus?

You can skip GitHub onboarding and work in an existing local folder. Connect GitHub in **Settings → Integrations** when you want GitHub repository browsing or issue and pull-request workflows. [Automations](../features/automations) do not require GitHub unless the scheduled task uses it.

## Does creating a new project create a Git worktree?

A project provides a working folder. A worktree is a checkout of an existing Git repository with its own branch. Ask for the operation you want and verify the resulting folder and Git state.

## What happens when I switch agents?

The selected conversation and workspace change. Background work can continue, and each agent retains its own draft and workspace context.

## Can work continue after I close the desktop app?

Enable **Settings → General → Keep Korus ready in the background** to let agents and automations keep running after you close the desktop window. The computer must stay awake. A question or approval can still require your response; check the conversation when you return.

## Does my provider receive repository context?

The selected coding provider receives the prompts and context used for its session, which can include file content, diffs, command output, and tool results. Consider the provider's own data policies when choosing what to share.

## Does Korus upload my analytics?

Usage statistics in **Settings → Analytics** stay local; Korus does not send them to a hosted analytics service. They record usage and timing with provider, model, and workspace identifiers, not message contents. Statistics are retained for up to a year and can be deleted with **Clear**.

This is separate from sending prompts and repository context to your selected coding provider. Clearing statistics does not delete conversations or change provider account usage. See [Usage and performance](../features/workspace#understand-usage-and-performance).

## Is a completed task already committed or deployed?

Check the agent's result and Git state. Implementation, validation, commit, push, pull-request creation, merge, and deployment are separate outcomes. Ask explicitly for the delivery action you want.

## When should I use a Mission?

Use a [Mission](../workflows/missions) for an outcome that needs requirements, an implementation breakdown, and explicit stage review. Use an ordinary conversation for a bounded task, or [Code Review](../workflows/code-review) for existing changes.
