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

## Do I need GitHub or GitLab to use Korus? {#do-i-need-github-to-use-korus}

You can skip repository connections during onboarding and work in an existing local folder. Connect GitHub or GitLab.com in **Settings → Integrations** when you want repository browsing, issues, and pull-request or merge-request workflows. [Automations](../features/automations) do not require either service unless the scheduled task uses it.

## Does creating a new project create a Git worktree?

A project provides a working folder. A worktree is a checkout of an existing Git repository with its own branch. Ask for the operation you want and verify the resulting folder and Git state.

## What happens when I switch agents?

The selected conversation and workspace change. Background work can continue, and each agent retains its own draft and workspace context.

## Can work continue after I close the desktop app?

Enable **Settings → General → Keep Korus ready in the background** to let agents and automations keep running after you close the desktop window. The computer must stay awake. A question or approval can still require your response; check the conversation when you return.

## Does my provider receive repository context?

The selected coding provider receives the prompts and context used for its session, which can include file content, diffs, command output, and tool results. Consider the provider's own data policies when choosing what to share.

## Does Korus upload my analytics?

Local Analytics uses the usage ledger on your computer. Optional anonymous usage sharing is **off by default**, including after an upgrade. The panel above the composer offers **Close** to enable sharing or **Opt out** to keep it off. Your choice is saved. You can change it with **Share anonymous telemetry data** in **Settings → General → Advanced**. Sharing off means no telemetry requests.

If you enable sharing, hourly uploads send unsent or updated UTC-hour aggregates for the current day and preceding seven days, including local usage recorded before sharing was enabled. Pending reports survive restarts. They contain a random installation ID, UTC reporting day and hour, numeric app version, coarse operating system, and turns, inclusive input, cache-read input, output, and nullable estimated API-equivalent USD cost by driver and allowed catalog model. When measured, groups also include output tokens and active generation time for speed measurements, summed time to first output, and the corresponding measured-turn counts. These are hourly aggregates, never per-turn timing events. They exclude prompts, model responses, tool content, paths, project/repository/branch and agent details, accounts, device identifiers, and IP-address fields. No IP addresses are stored by the telemetry service or its delivery infrastructure; this does not describe your coding provider or other Korus services.

The random ID links your reports without being linked to your account; it does not make reports completely unlinkable. Usage summaries and the minimal ID/first-reported-day registry are kept indefinitely. Server backup copies rotate after seven days. The dashboard is private and shows aggregate metrics. Estimates are not billed spend or subscription charges; unavailable or incomplete measurements remain unknown.

**Clear** removes local statistics, which are retained for up to a year subject to a record limit. It does not stop sharing, remove accepted reports, delete conversations, or change provider quota or billing. Your selected provider still receives the prompts and context needed for its sessions. See the [complete privacy disclosure and field list](__PRODUCT_PRIVACY_URL__#optional-sharing) and [Usage and performance](../features/workspace#understand-usage-and-performance).

## Is a completed task already committed or deployed?

Check the agent's result and Git state. Implementation, validation, commit, push, pull-request creation, merge, and deployment are separate outcomes. Ask explicitly for the delivery action you want.

## When should I use a Mission?

Use a [Mission](../workflows/missions) for an outcome that needs requirements, an implementation breakdown, and explicit stage review. Use an ordinary conversation for a bounded task, or [Code Review](../workflows/code-review) for existing changes.
