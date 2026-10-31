---
description: Understand how agents share status and coordinate through Korus's built-in MCP tools.
---

# Agent collaboration

Korus supplies built-in collaboration and workspace tools to each agent through MCP, without manually adding a server URL or passing an agent ID.

## Coordinate work

Agents can discover teammates, show status, and send messages. Ask for coordination when an interface decision or shared dependency affects another agent's task:

```text
Ask the API agent to confirm the response shape for the issue list.
Send the proposed fields and wait for its decision before changing
the frontend contract.
```

Name the recipient, what it needs to decide or do, and the information to send. If agents have similar names, include their folder or another distinguishing detail.

A message sent to an idle teammate starts a turn in its conversation. Messages to a busy teammate are delivered after its current turn finishes. The receiving conversation identifies the sender, so you can inspect both the request and the response.

The sidebar shows an agent's short status while it works. An agent can also mark a completed diff ready for review or, on the repository's default branch, propose work. Choose **Implement**, **Delegate**, or **Mission** to start that work, or **Discard** to dismiss the proposal. Inspect the conversation and diff before deciding what to do.

Give each writing task an owner and a separate worktree when isolation is needed. A message coordinates intent; the actual diff and checks still establish the result.

## Native subagents and Korus teammates

A provider-native subagent works inside its parent provider session. A Korus teammate has its own identity, folder, and conversation in the team.

Specify which one you want when delegating:

| Request | Result |
| --- | --- |
| “Use native subagents to audit these three modules.” | Child work stays within the provider's parent session; it does not create separate Korus team agents. |
| “Create a Korus teammate in a worktree to implement the filter.” | A separate agent appears in the team, with its own folder and conversation. |

Native subagent availability follows the provider's tools and settings. For a substantial independent repository change, a dedicated Korus agent and worktree keep the outcome separately reviewable.

Give the new teammate a self-contained objective, scope, constraints, and validation requirement. Creation in a worktree creates the isolated workspace and starts the teammate with that prompt. See [Parallel agents](../workflows/parallel-agents) and [Worktrees](../workflows/worktrees).

## Durable delegated tasks

An agent can create a teammate with a tracked task: an objective, a completion condition, and a saved result containing evidence and caveats. This is an optional delegation mode; follow the work in the agents' conversations.

Ask the parent agent to check its delegated tasks or wait for their results. Saved assignments and outcomes remain available after a restart, even if automatic result delivery was interrupted. Waiting with a timeout does not cancel the worker. Review the saved evidence rather than treating an idle agent as proof of completion.

Ask the parent or worker to cancel a tracked task when it should stop. Cancellation preserves the agent, conversation, worktree, and recorded results; it does not undo file changes. A completed task does not authorize merging, publication, or advancing a Mission stage. Review its evidence and diff before delivery.

## Workspace tools

| Capability | What to ask |
| --- | --- |
| Documents | “Display this report in the side panel.” |
| Browser | “Open the local preview in your in-app browser and check the form.” |
| Visualize | Open Visualize, then ask for a diagram or a targeted canvas edit. |
| Computer Use | Enable it in Settings, then name the macOS app and task. |
| Work item status | Ask the assigned agent to report whether its GitHub, GitLab, or Linear work is in progress, blocked, ready for review, or completed. This tracks work in Korus, separately from the source issue's status. |

See [Workspace & diffs](../features/workspace), [Browser](../features/browser), [Visualize](../features/visualize), and [Computer Use](../features/computer-use) for the corresponding setup and interaction flows.

## Keep requests explicit

Tell the agent which teammate needs a decision or task and what outcome you expect. Review the resulting work through the receiving agent's conversation and artifacts.

Korus collaboration messages go to other Korus agents. Sending an email, Slack message, or GitHub or GitLab comment is a separate action through that service's integration; name that action explicitly when you want it.

Connecting Linear also makes its hosted tools available to agents through Korus. Ask explicitly when you want the agent to comment on an issue or change its Linear status; connecting the integration or finishing a Korus assignment is not itself that request.
