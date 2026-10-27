---
description: Isolate implementation in a separate Git checkout and integrate it after review.
---

# Worktrees

A Git worktree gives an agent a separate checkout and branch while keeping it attached to the same repository.

## Before you start

Use a worktree for concurrent implementation, an experiment, or a change you want to keep separate from the current checkout. The folder must belong to a Git repository with a usable base branch. A plain project folder needs Git initialization before it can have worktrees.

A worktree has its own files, index, and checked-out branch. It shares the repository's Git history and remotes. Creating one does not automatically copy uncommitted edits, installed dependencies, ignored environment files, or running services from your original checkout. To move unfinished edits, use [Branch current work](#move-current-work-to-a-new-branch).

Korus's **Worktree initialization** setting controls extra setup. **Auto-detect** uses repository setup instructions when available; otherwise it can copy local environment files and detect dependency setup. **Repo instructions only** limits setup to the repository's instructions, while **Disabled** skips initialization. Reusing an existing worktree does not rerun initialization. Check what was prepared rather than assuming every required service is ready.

## Create one from the sidebar

1. Open a team with an agent in the repository.
2. Use the **+** beside that repository group and choose the new-worktree option.
3. In **New Worktree**, choose **Start from** and enter a branch such as `feat/export-csv`. Check the destination folder wherever the creation flow lets you change it. If Korus offers an existing worktree, verify its path and branch before reusing it.
4. Create the worktree and send the implementation task to the new session. Provider selection is part of the start-work flow; the worktree dialog handles the branch and checkout.

When creating an agent through the agent dialog, the equivalent choice is **Repository**, then **Work in… → New Worktree…**.

Korus displays provisioning progress. Choose **Run in background** to keep working while it prepares the checkout and agent. When it finishes, check the new agent's folder and branch before asking it to edit files. Worktree deletion can also run in the background; inspect the result before assuming cleanup is complete.

## Delegate implementation

Let the current conversation shape a task first, then submit `/delegate` to hand off the agreed work. `/worktree` is an alias. You can include a specific task:

```text
/delegate Implement the agreed CSV export flow and its tests. Keep commits local and report back for review.
```

These commands work across supported coding engines. The composer's **+ → Delegate** action submits the delegation request immediately using your saved settings. To add task-specific instructions first, type them after `/delegate` in the composer. The original agent and conversation remain open.

### Choose the starting context

Open **Settings → Workflows → Delegation** to choose how delegated work starts:

- **Handoff** starts a fresh conversation with a task brief and your delegation instructions.
- **Fork** carries the current conversation's context and decisions into the new agent using Codex or Claude Code's conversation fork. Switching providers or using an engine without fork support falls back to a handoff.

Use **Delegation instructions** for reusable requirements, such as running focused tests before reporting back. Instructions supplied for an individual task take priority. The forked conversation is independent; it does not change the original conversation.

You can also request delegation in plain language:

> Create a Korus teammate in a dedicated worktree on `feat/export-csv`. Implement the agreed export flow, add the relevant tests, and leave the changes ready for review.

When Korus offers **Start implementation in a worktree?** above the composer, the checkmark sends a delegation request to the current agent. That agent creates the separate teammate using the selected starting context. The dismiss button removes the proposal. Accepting this proposal starts implementation; it does not approve a later merge or push.

Continue the implementation discussion with the new agent so its instructions, changes, and evidence stay together. This creates a Korus teammate, rather than a [native subagent](./parallel-agents#choose-the-kind-of-agent).

The delegation instructions ask the teammate to commit at coherent milestones and keep those commits local. Delegation does not authorize a push or merge; specify any stricter delivery constraint in the task.

## Move current work to a new branch

Use **Branch** in the agent header's Git menu when you have already started editing and want to continue in an isolated checkout.

1. Wait for the source agent to become idle and stop other writers sharing its folder.
2. Choose **Branch**, enter a new branch name, and select **Branch** to confirm.
3. Follow the progress as Korus creates the worktree, moves the changes, prepares a new agent, and cleans the moved changes out of the original checkout.
4. Open the new agent and inspect its folder, branch, and diff before continuing.

The move preserves staged and unstaged changes and transfers untracked files without creating a commit. The source branch's existing commits do not change. Ignored files and running services are not transferred; check the new worktree's setup before running the project.

If the move needs recovery, inspect the reported paths and use **Retry** or **Resume** for that operation. Keep any reported recovery copies and retained source files until you have verified the destination. Do not start a second move to work around an unfinished one.

## Verify the workspace

Ask the agent to follow the repository's setup instructions: install dependencies, provide the required local configuration, and use separate service ports when another checkout is running. Keep credentials out of prompts and committed files. Verify a preview is actually using the worktree before judging its behavior.

If provisioning fails, read the reported phase and error. Check whether a branch or folder was already created before retrying; reuse the correct existing worktree rather than creating a second copy of the same task.

## Review and merge

1. Review the [diff](../features/workspace) and checks. Run [Code Review](./code-review) if the change needs an independent pass.
2. Commit the intended changes through the agent's Git controls. A merge includes committed changes; remaining uncommitted edits are not included.
3. Open the merge action and verify the destination branch. Choose **Merge commit** to preserve the branch's commits, or **Squash and merge** and enter a single commit message.
4. Decide whether to **Delete worktree after merging** and **Delete branch after removing worktree**. Keep them when you need follow-up work. Where offered, **Report back** sends the outcome to the delegating agent.
5. Choose **Merge** for local integration, or **Merge and push** to also update the remote. Alternatively, create a GitHub pull request or draft GitLab merge request instead of merging locally.

Korus remembers your cleanup choices. Check them before each merge: deleting the worktree closes its agent, and branch cleanup can remove both the local branch and its matching remote branch. Keep them when more work is planned.

The destination checkout must be clean, and the feature branch must include the latest destination commits. If Korus requests a branch update, update from the base, resolve conflicts, and rerun the relevant checks before merging.

When merge cleanup removes the worktree, Korus closes the associated agent after the delivery completes. Retaining the worktree keeps it available for further work. A cleanup warning can mean the merge succeeded while a folder remains; inspect that warning before retrying the merge.

If a push fails after a successful local merge, use **Retry push**. The local merge already exists. Keep a worktree that contains unfinished work, and resolve Git errors before choosing deletion.
