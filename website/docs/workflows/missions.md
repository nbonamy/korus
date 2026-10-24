---
description: Shape and ship a feature through explicit stages and reviewable artifacts.
---

# Missions

A Mission turns a feature into a staged workflow with an approved brief, repository-owned tickets, implementation evidence, review findings, and delivery tracking.

Use a direct agent conversation for a focused fix or investigation. Use a Mission when you want explicit requirements and ticket approval before implementation, especially when the feature spans repositories. Mission workers are separate Korus agents; they are not simply native subagents of the conversation where you started.

## Prepare the team

Connect the [providers](../providers/) the team will use. Add at least one repository-backed agent to the team before creating a Mission. For a feature spanning an API and a frontend, add an agent for each repository to that same team. Tickets can only target repositories represented in the Mission's team.

Check those repositories have Git history and can create worktrees. Have their setup instructions, dependency requirements, and verification commands available to the agents.

## Create the Mission

1. Select the team where the feature belongs.
2. Click **New mission** in the sidebar. If the team already has Missions, use the **+** beside **Missions**.
3. In the Mission conversation, describe the desired outcome, constraints, and how you will know it works. During Requirements, you can also use **Choose an issue…** to supply an issue from a connected GitHub or Linear integration. Choose the provider first, then its repository or **Team / project**, and select the issue.
4. Work with the Mission lead until the Requirements artifact is specific enough to approve.

For example:

> Add CSV export to the reporting page. The API and web repositories are in this team. Only authorized users can export; preserve the current filters; escape spreadsheet formulas. Success means a browser download with the expected rows plus API authorization and escaping tests. Do not add scheduled exports.

A selected issue supplies context for Requirements. A Linear team or project does not select an execution repository, and Mission tickets are not automatically exported as Linear issues. Review the code-repository assignment on each Mission ticket before approving implementation. GitHub still owns any pull requests created during Ship.

## Follow the stages

| Stage | What you do |
| --- | --- |
| Requirements | Review the problem, scope, and acceptance criteria. Request changes, then approve the brief. |
| Tickets | Inspect each ticket's repository, acceptance criteria, verification, and dependencies. Approve the backlog to start implementation. |
| Implementation | Follow ticket progress and inspect worker conversations and evidence. Continue to Review when all tickets are done. |
| Review | Inspect the review summary, repository diffs, and structured findings. Remediate selected findings, then approve the review. |
| Ship | Deliver each affected repository through a pull request or local merge. |

The stage rail, artifact workbench, and conversation stay together in the Mission surface. Select an earlier stage to inspect its accepted artifact; viewing it does not move the workflow backward.

## Approve Requirements and Tickets

Wait for a proposal, read it, and give feedback before choosing **Approve and continue**. In Requirements, select text to leave inline comments and send them to the lead. In Tickets, open a ticket card to inspect its details and comment on the relevant text. You can also request changes directly in chat.

Approving Requirements starts ticket shaping. When the tickets are ready, the **Start implementation** dialog lets you choose the coding agent, model, and reasoning effort for implementation independently of the Mission lead. Inspect repository assignments and dependencies, then confirm to create isolated Mission worktrees and start the workers. This is the point where code work begins.

Mission startup shows provisioning progress. **Run in background** lets you return to other conversations while it prepares the workspaces and workers.

## Follow implementation

Korus creates one Mission worktree per affected repository. Tickets in the same repository run sequentially with a repository worker; ready tickets in different repositories can run concurrently. Dependencies can keep a ticket waiting even when its repository worker is idle.

Open a ticket to inspect its evidence or select its worker conversation for clarification. Workers record changes and verification as they complete their tickets. Implementation results advance automatically; there is no separate manual approval for every completed ticket. The explicit human review follows the completed implementation.

Use **Stop ticket** when a running task needs to halt, or **Retry ticket** after a failed or stopped task's blocker is resolved. Stopping does not undo files already changed. Once every ticket has completed and evidence is available, choose **Continue to Review**.

## Review and remediate

The Mission Review stage assesses the implemented feature against the approved requirements. Its **Changes** tab lets you select a repository and inspect its branch or uncommitted diff. Its **Review** tab holds the summary and structured findings.

1. Inspect each finding's repository, location, impact, and priority. Use **Chat about finding** when you need clarification.
2. Select the findings to fix, then choose **Fix N selected**. The affected repository workers apply and verify the fixes in the Mission worktrees. Unselected findings are skipped during this remediation batch.
3. Read the recorded fix evidence. Once remediation finishes, use **Re-run review** if you want another assessment.
4. When the result is acceptable, choose **Approve and continue** to reach Ship.

This review is part of the Mission. The separate conversation command [`/review`](./code-review) has its own reviewer and rounds and does not approve a Mission stage.

## Ship each repository

Ship shows a delivery card for each affected repository. Commit any remaining intended changes, then use its Git controls to create a pull request or merge. Check the branch, destination, title/message, and cleanup choices before confirming. Follow [Worktrees](./worktrees#review-and-merge) for merge prerequisites and cleanup behavior.

When the destination has advanced, use **Update from main** in the delivery card's Git controls; the label follows the repository's base branch name. Korus merges the base into the Mission branch. Resolve any conflicts in the Mission worktree and rerun the relevant checks, then return to Ship and refresh the Git state before merging. Updating the branch does not itself deliver the Mission.

The Mission completes when every affected repository has a recorded pull request or merge. A created pull request can still need review and merging. Mission completion does not mean the code was deployed.

## Resume or clean up

Mission stages, accepted artifacts, run status, worktree mappings, and delivery results are saved. Return to the Mission from its team's sidebar to continue. Read a failure's error and fix the underlying setup, provider, or Git issue before retrying. If a stage has no active run or proposal, **Continue mission** can resume it when offered.

To remove a Mission, open its sidebar context menu and choose delete. The confirmation explains that Mission conversations and artifacts will be removed. **Keep worktrees** removes the Mission while preserving its checkouts. **Delete mission and worktrees** also removes the Mission worktrees and local branches and discards uncommitted changes. Preserve anything you still need before choosing that option.
