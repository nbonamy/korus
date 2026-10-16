---
description: Give concurrent agents clear ownership and isolated working folders.
---

# Parallel agents

Use parallel agents to split an investigation or implementation into work that can be checked independently. Decide who owns each outcome before starting several writers.

## Choose the kind of agent

Korus supports two different forms of delegation:

| Agent | Use it for | Where to follow the work |
| --- | --- | --- |
| Native subagent | A bounded task inside the current Codex or Claude Code session, such as scanning different parts of a repository. | The parent agent's conversation and the provider's subagent activity. |
| Korus teammate, also called a co-agent | A separately named agent with its own folder and conversation, such as an implementation that needs a dedicated worktree. | Its own entry in the team's sidebar. |

Be explicit in the request. For example:

> Use three native subagents to audit authentication, persistence, and error handling. Keep the scan read-only and consolidate the findings here.

> Create a Korus teammate in a dedicated worktree on `feat/export-csv`. Give it the CSV export implementation and tests. Keep the investigation in this conversation.

The second request creates a separate Korus workspace. A native subagent request does not by itself create a Korus teammate or isolated Git checkout. Availability and behavior of native subagents depend on the selected provider.

## Follow native subagents

When a Codex or Claude agent starts native subagents, open **Subagents** in its conversation header to see their status and select an individual thread. This includes Claude tasks running in the background and completed work restored after a reload.

The child thread is for inspection; send follow-up instructions through the parent conversation. A child appearing completed is not a substitute for reviewing its result. Native child threads are separate from the Korus teammates listed in the team sidebar and do not by themselves isolate files in a worktree.

## Start separate Korus teammates

Before starting, connect the [provider](../providers/) each teammate will use and add the repository to the team.

1. Open the team and find the repository group in its sidebar.
2. Use the **+** beside the repository to open its new-session menu. Choose a new worktree for an isolated writer, or the offered default branch for a session in that checkout. The repository's **Create from…** action offers the broader branch/worktree selection.
3. Check the resulting folder and branch, and select the provider when that creation flow offers more than one. Use a recognizable agent name when creating teammates through the agent dialog or a delegation request.
4. Send a task that includes its outcome, allowed scope, dependencies, and verification requirements.
5. Repeat for other tasks, using a different worktree for each concurrent writer in the same repository.

You can also ask the current agent to create the teammates and provide their handoff prompts. A useful task brief is:

> Own CSV export in the API repository. Change only the export route and its tests. Coordinate the response format with the UI teammate before implementing it. Verify authorization and escaping. Leave the diff ready for review; do not commit or push.

Agents in the same checkout share files, even when their conversations are separate. Naming an agent or opening a new conversation does not isolate its changes.

## Coordinate and follow the work

Select each teammate in the sidebar to read its conversation and inspect its [workspace and diffs](../features/workspace). Agent status shows current activity; it is not proof that tests passed or that a change has shipped. Split conversation layouts let you follow several agents together.

Ask for coordination when tasks share an interface. Teammates can discover and message each other through [collaboration tools](../reference/agent-collaboration). For example, have the API owner send the agreed response shape to the UI owner before both start writing. Include which agent should make the final decision if they disagree.

Separate Korus teammates keep their own conversations and workspace associations. Follow-up instructions belong in the teammate doing the work. Do not assume feedback sent to the original agent reaches every worker automatically.

## Integrate the results

Choose one integration owner. For each worktree, inspect the diff, ask for validation evidence, and run [Code Review](./code-review) where useful. Merge in dependency order, then verify the combined behavior. Follow [Worktrees](./worktrees) for merge and cleanup controls.

After reviewing a delegated result, you can ask the agent that created the worker to close it once it is idle. Closing its worker preserves the worktree and branches; it does not merge, delete files, or perform Git cleanup. Request those delivery actions separately when you want them.

If two agents edit the same checkout or overlap unexpectedly, pause one writer, inspect the current diff, and assign ownership before continuing. Preserve the existing changes while resolving the overlap. If a teammate is blocked, send the missing decision or prerequisite to that teammate rather than launching a duplicate implementation.

For a larger feature that needs an approved brief, ticket dependencies, and repository delivery tracking, use a [Mission](./missions).
