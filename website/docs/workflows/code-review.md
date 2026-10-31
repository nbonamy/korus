---
description: Run an independent review, inspect findings, and verify remediation.
---

# Code review

Use standalone Code Review when you already have changes to assess in an agent's Git workspace. It supports structured findings, your selection of fixes, and repeated review rounds. A [Mission](./missions#review-and-remediate) has a separate Review stage for its approved feature workflow.

## Before you start

Open the agent working in the checkout you want reviewed. Connect the provider that will do the review, and finish or pause other writers in that folder so the selected change remains stable. An independent reviewer uses the same checkout as the implementation agent; it does not create a worktree.

Choose a working diff, the latest commit, or a branch with changes against its base. Inspect the current folder and branch if the expected diff is missing.

## Start a review

1. Enter `/review` in the agent's composer to open Code Review. Add instructions after the command to focus the review, such as `/review Focus on authorization and data loss risks.`
2. Choose **Uncommitted changes** for the working diff, **Last commit** for the latest commit, or **Current branch** for changes against the base shown in the panel, including uncommitted changes. Unavailable scopes are disabled.
3. Choose **Independent reviewer** for a separate Review agent and fresh conversation, or **Current thread** to use the current agent's existing conversation. Current thread requires an existing provider session.
4. When using an independent reviewer, choose its connected provider. It can differ from the implementation agent's provider. Current thread uses the existing agent's provider.
5. Use the **Review model** picker to choose the model, reasoning effort, and processing speed where supported. Default keeps the existing reviewer defaults. Korus remembers your selections separately for each provider.
6. Click **Start review** and wait for the round to finish. Follow the separate Review agent when using independent mode.

Choose the scope deliberately. If the feature is committed on a branch, reviewing only uncommitted changes will miss those commits. Check the displayed base for a branch review before starting.

## Set reusable review instructions

In **Settings → Workflows → Code review**, save **Review instructions** for standards you want every reviewer to apply, such as checking authorization, compatibility, or migration safety. They accompany review agents, including automatic reviews and fresh rounds, alongside any instructions you supply for an individual review.

**Review findings with the original thread** controls whether independent reviewers should consult the implementation conversation when available. Turn it off when you want a review without that consultation.

## Automatic remediation

Enable **Automatic remediation** to let an independent reviewer find, fix, and check issues over several rounds. In **Configure**, choose which priorities to fix and the maximum number of rounds. The defaults are critical, high, and medium findings (P0–P2) and three rounds, including the final verification review.

Fixes stay uncommitted unless you enable **Commit after each fix round**. That option includes existing uncommitted changes in the reviewed workspace, not just the reviewer's fixes. Check the full diff before enabling it. Automatic review never pushes or merges.

Each round uses a fresh review conversation. When no findings remain at the selected priorities, Korus closes the temporary reviewer and sends the result to your original conversation, including any lower-priority findings left open.

Avoid editing the reviewed files while it runs. Failed checks, repeated findings, conflicting workspace changes, or reaching the round limit pause the review and return a partial report. Inspect that report and the diff before continuing manually.

Choose **Switch to manual** to take over decisions without interrupting the current turn. The active inspection or fix finishes, but Korus does not automatically start the next step. Inspect the findings and changes before deciding what to do next.

In manual mode, **Stop review** interrupts the active review or fix while keeping findings already collected. An interrupted inspection is incomplete; use **Retry review** to finish it. Stopping does not undo edits or local commits. Interrupting an automatic review pauses its loop; it stays paused after restarting Korus.

### Start from chat

You can explicitly ask your agent to **run an automatic review of my uncommitted
changes**, or of the current branch against a specified base. The agent starts
an independent reviewer with the calling thread's provider, model, and effort
unless you request overrides. It reuses your saved priority and round limits,
but local commits stay off unless you explicitly request them—even if the panel
previously had commits enabled.

The result returns to the same conversation. Ask specifically for an automatic review when you want fixes applied as well as findings reported.

## Inspect the findings

Findings are ordered by priority: critical (P0), high (P1), medium (P2), and low (P3). Read the reported impact and open the affected file where a location is available. Ask for clarification through the finding's discussion action before deciding whether to fix it.

All findings are initially included for remediation. Deselect any you do not want changed. These selections are your approval boundary: starting a review gathers findings; choosing remediation authorizes the selected fixes.

A review is evidence about the selected scope. It does not replace the tests, typechecks, or runtime checks needed for the feature. A round with no findings does not prove there are no defects.

## Remediate

Click **Remediate selected findings** to queue fixes for the included findings. The reviewer applies the changes in the reviewed checkout. Follow the pending, fixing, and fixed states, then inspect the resulting diff and recorded verification evidence.

If no findings are selected, choose **Complete review round**. Unselected findings are recorded as skipped. Remediation changes the files; it is separate from a later commit, merge, push, or deployment.

## Review again

Once the round and any selected fixes are complete, choose **Review again** for another pass over the same scope, or **Finish review** when you accept the result. The round tabs let you compare earlier findings and decisions while the session is active.

Enable **Commit changes** before either action when you want the review agent to create a local commit first. Review the full diff: this can include existing uncommitted work in the checkout, not only the reviewer's fixes. If the commit fails, the review stays open. This option does not push or merge.

An independent reviewer starts a fresh review conversation for the next round. Finishing removes the temporary Review agent and sends a handoff to the original agent describing the remediated findings. Finishing a current-thread review clears its active review panel while leaving the agent's conversation available.

The completion message includes the saved report's location. Use it to revisit the findings, your decisions, fixes, and verification results. If the report cannot be saved, the reviewer stays open so you can resolve the error.

Review state is saved while the session is active. If a round fails, read its error, resolve the provider or workspace problem, and use **Retry review** when offered. An existing active review must finish or stop before another starts for the same target. After interrupted work resumes, check the findings and actual files before authorizing more changes.

See [Workspace & diffs](../features/workspace) for inspecting the changes beside the conversation.

## Review from your phone

On iPhone or Android, open the agent's review controls to choose the scope and reviewer, including the model and supported speed. Inspect findings, discuss an issue, select fixes, and run another round or finish the review. The review runs in the computer's checkout, so keep that computer connected. These controls are separate from a Mission's Review stage.
