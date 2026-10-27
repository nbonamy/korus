---
description: Understand teams, agents, conversations, repositories, worktrees, and Missions.
---

# Core concepts

Korus organizes the workspace around agents and the work you give them.

## Teams and agents

A **team** groups agents. An **agent** has an identity, a working folder, provider settings, and its own conversation. Selecting another agent changes the conversation you see while background work can continue.

Use names that communicate responsibility: implementation, documentation, or review, for example. A team groups work; it does not turn the members into one conversation or give them isolated files automatically.

## Quick Chats and project work

Use a Quick Chat to discuss an idea without first attaching it to a repository task. When the idea becomes implementation work, ask for a project or a dedicated agent with an explicit working folder.

The start-work menu can create a new project, open an existing folder, browse GitHub or GitLab repositories, or clone a repository URL. Opening a project gives the conversation concrete filesystem context. Creating a project folder and creating a Git worktree are different operations: worktrees require an existing Git repository.

## Provider setup and accounts

Each coding engine has a selected setup environment, including its authentication and configuration. Korus's **Customize** flow lets you keep that environment separate or use an existing provider setup. Configure each engine independently.

A provider home is different from an agent's working folder. The home controls the engine's setup; the working folder controls where the agent reads and changes project files.

See [Provider guides](../providers/) before switching a provider's location. Changing locations does not migrate conversations between them.

## Conversations

A conversation carries the instructions, questions, approvals, and evidence for an agent's task. Korus renders messages, tool calls, command output, plans, and file changes in the workspace.

Drafts and workspace state stay with the agent as you switch between conversations. Read [Conversations](../features/conversations) for sending, steering, and queued instructions.

## Repositories and worktrees

The working folder tells an agent where to work. A repository can have multiple **Git worktrees**, each with its own checkout and branch. Worktrees isolate file changes when agents work concurrently.

Agents in the same folder still share the same files. A separate conversation does not isolate a checkout.

## Workspace artifacts

The workspace beside the conversation holds documents, plans, files, diffs, and browser previews. Use these surfaces to inspect the work while keeping the discussion available.

Keep the selected agent and artifact context aligned. An agent's status summarizes its activity; the conversation, actual artifact, and validation evidence explain what it accomplished.

## Missions

A Mission is a staged outcome: Requirements, Tickets, Implementation, Review, and Ship. You review the stage artifacts as the work progresses. A Mission is useful when the goal needs shaping and coordinated implementation rather than a single prompt.

## Providers

The provider supplies the coding engine and model access. Korus supplies team coordination, workspace surfaces, and delivery workflows around it. Available controls can differ between engines.

See [Providers](../providers/) and [Missions](../workflows/missions).
