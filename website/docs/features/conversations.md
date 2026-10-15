---
description: Follow agent work, respond to approvals, and steer or queue instructions.
---

# Conversations

The conversation is where you describe the task, follow the agent's work, and give feedback.

## Send a prompt

Select the agent that owns the task, check its repository folder, and describe the desired outcome in the composer. Include success criteria and constraints:

```text
Add a filter to the issue list. Keep the current sorting, support an
empty result, and check the rendered interaction. Leave the change
uncommitted so I can review it.
```

Use the composer's available context controls to supply file mentions, skills, and attachments. Desktop Antigravity conversations support images, WAV audio, PDFs, and UTF-8 text; its remote-team and browser-hosted conversations do not support attachments. Each agent keeps its own conversation and draft as you switch agents.

Choose a model in the composer before sending when you need a particular provider model. Reasoning effort and service tier controls are Codex-specific; the choices shown depend on the provider's available catalog.

The composer's **+** menu includes **Review**, **Delegate**, and **Visualize** across supported engines. These open [Code Review](../workflows/code-review), request [worktree delegation](../workflows/worktrees#delegate-implementation), and open [Visualize](./visualize), respectively. The corresponding slash commands remain available.

After a response, the empty composer may suggest a follow-up. It is a hint, not a draft or a sent message; it does not replace anything you have typed. Enter the request you want to send.

## Attach an app window on macOS

AppShots lets you show the agent a window from another app.

1. Select the conversation you want to send it to in Korus.
2. Bring the other app's window to the front.
3. Press both Command keys at the same time. Korus returns to the front with the screenshot attached to your draft.
4. Check the image, add your request, and send it.

In **Settings → AppShots**, you can switch the shortcut to both Option keys or both Shift keys, choose **None** to disable it, and turn the capture sound on or off. Press the two keys together, rather than double-tapping one key.

Screen Recording permission is required for capture; check **Settings → General → System permissions** if it fails. The shortcut does not require Input Monitoring permission. Check that the screenshot contains only what you intend to share before sending it.

## Discuss before implementation

Use `/plan` to enter Plan mode, then explain what you want to decide before editing. Korus uses native Plan mode for Codex and Antigravity; for Claude Code, it supplies planning instructions to the conversation. Antigravity plan proposals open for review, and accepting one starts a separate implementation turn.

```text
First discuss the tradeoffs between extending this module and adding
a new one. Do not edit files until we agree on the approach.
```

Review the proposed plan and answer any questions before asking the agent to implement it.

### Review an interactive plan

In **Settings → Workflows → Plan mode**, enable **Use interactive plans** to review choices and comment on individual sections of a plan.

1. Read the plan in the workspace beside the conversation.
2. Choose the answers you want and turn on **Confirmed** for each choice. An answer marked **proposed** is the agent's suggestion, not your confirmation.
3. Use **Comment on this section** to request a specific change without retyping the section.
4. Choose **Revise** to send the confirmed answers and comments back for a revised plan, or **Approve** to start implementation.

Your draft feedback is saved as you work and remains available after reloading. If choices are unconfirmed, Korus warns before revision or approval. Go back to confirm them when they should guide the work; approving anyway authorizes implementation with those choices still open.

Keep planning and implementation separate: **Revise** asks for another proposal; **Approve** authorizes the agent to implement the plan.

## Follow the evidence

Korus renders messages, tool calls, command output, plans, approvals, and file changes. Use those details to check what the agent inspected and what it actually validated.

Open a document or diff in the workspace when you need to examine it while continuing the discussion.

## Steer, queue, or interrupt

| Action | Use it when |
| --- | --- |
| **Steer** | Correct or add a constraint to a running turn. |
| **Queue** | Save a follow-up for after the current turn. Inspect the pending prompt list if you need to edit or remove a queued instruction. |
| **Interrupt** | Stop the current turn before assigning a different direction. All supported engines offer interruption. |

For example, steer “Keep the current API; change only the implementation” into an active Codex task. Queue “Now update the guide for the final behavior” when documentation should follow the implementation.

Available actions depend on the conversation's provider and state. Check the control shown in the composer before sending a correction.

Antigravity does not support steering a running turn. Queue the follow-up or interrupt before changing direction.

Claude steering delivers input at a tool boundary or in a following turn; it does not immediately cancel a running tool. Use **Interrupt** when you need the active work to stop, then inspect any files or other side effects already produced.

## Respond to requests

Answer inline questions and inspect approval requests in the conversation. An agent awaiting input needs a response before it can proceed. Where an approval offers different scopes, choose the one appropriate to the action; the controls depend on your provider and permission settings.

Select text in a message to attach targeted feedback instead of retyping the passage. Image attachments also support annotations. Submit the resulting annotations with your next message, or on their own when the annotation contains the complete request.

Include a short explanation when changing a constraint so the agent can carry it into the rest of the task.

## Revisit a turn or manage context

Codex turn actions can edit, retry, delete, or fork from a turn. Use the action shown on the relevant message. These actions change the conversation's context; they do not roll back edits already made to the repository. Claude Code does not expose edit, retry, or delete turn actions.

Claude Code supports native conversation forks while idle, including from a completed turn when that boundary is available. The fork has independent conversation history but uses the same folder. It does not create a worktree or restore earlier file contents. If a turn cannot be used as a fork point, reload the conversation and choose an available completed boundary.

In Codex or Claude Code, use `/compact` or **Agent → Compact Session** when the conversation is long and you want a context summary. The agent must be idle for the shell's compact action. Codex also supports **Replace conversation with summary** from the agent context menu.

Right-click an agent for session actions:

- **Resume Session** opens the provider's saved conversation picker.
- **Restart Agent** starts a fresh conversation for the same agent and folder. It is not the way to reload the current history.
- **Fork**, when available, creates another conversation from existing context.

Antigravity supports saved history and **Resume Session**, but not conversation forks or edit, retry, delete, and compact actions.

For provider setup and capability differences, see the [provider guides](../providers/).

## Hand work to another engine

Use **Hand off…** to continue a workspace task with a new agent, including switching coding engines. You can also choose the same engine with a different model.

1. Wait until the agent is idle, then right-click it in the sidebar or Cockpit and choose **Hand off…**. The native **Agent** menu offers the same action.
2. Choose the destination **Coding agent** and **Model**, or keep **Provider default**.
3. Optionally add **Additional handoff instructions** describing what the current agent should emphasize in its note.
4. Choose **Hand off**. The current agent writes the note, and Korus replaces it with a new agent that starts work from that note.

The replacement keeps the same folder, branch, and uncommitted changes and uses the destination engine's default permissions. The source conversation remains available through **Source conversation** in the handoff dialog, alongside the **Saved handoff note**. This transfers a written summary rather than converting one provider's conversation history into another's.

Finish queued prompts, pending requests, active goals, reviews, and running delegated work before handing off. Quick Chats and Mission workers cannot use this action. **Hide** closes the progress dialog while the handoff continues. If it fails or is interrupted, inspect the saved note and available conversations before trying again.

For parallel work that keeps the original agent open and creates an isolated checkout, use [worktree delegation](../workflows/worktrees#delegate-implementation).

## Set a goal

In Codex and Claude Code conversations, use `/goal` to define an outcome the agent should keep working toward. Keep the condition concrete and inspect the resulting evidence before accepting it as done. Antigravity does not offer goals.

Claude goals use Claude Code's native goal behavior and require native goal hooks to be enabled. Claude goals do not support a token budget or live iteration counters. An interrupted goal can appear paused; a failed run or unverifiable goal state can appear blocked. Clearing a goal removes it rather than claiming it succeeded.

## Resume work

Korus restores durable workspace state when you return. Older messages load through conversation history; use the retry action if history loading reports a failure.

Its background daemon can keep agent work running after the desktop window closes. The host still needs to be running and connected; stopping the daemon or sleeping the host interrupts that availability. Check the conversation and current status before submitting another instruction.
