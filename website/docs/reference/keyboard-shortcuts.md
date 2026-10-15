---
description: Find contextual actions and keyboard shortcuts for agents and their workspace.
---

# Keyboard shortcuts

Use the command palette to find actions and the shortcut reference to look up key combinations. The shortcut tables below use macOS notation; the in-app reference shows your platform's bindings. Conversation controls can also have provider-specific shortcuts.

## Find an action

Open the **Command Palette** with **⌘Shift P** on macOS or **Ctrl+Shift+P** on Windows and Linux. Search for an action, use the arrow keys to select it, and press Enter. The available actions follow the selected agent and workspace, including Git operations, code review, simulators, and Settings. Unavailable actions show why they cannot run.

Open **View → Keyboard Shortcuts** for a searchable reference to actions and key combinations on your platform. **⌘Shift /** on macOS or **Ctrl+Shift+/** on Windows and Linux opens the same reference. This is separate from **⌘K**, which finds agents.

## Navigation

| Shortcut | Action |
| --- | --- |
| ⌘K | Open the agent picker. |
| ⌘N | Create a team. |
| ⌘1–9 | Select the corresponding agent in the active team. |
| Control Tab | Cycle forward through agents. |
| Control Shift Tab | Cycle backward through agents. |
| ⌘\` | Cycle teams. |

Hold Command briefly to reveal the quick agent shortcut hints.

## Active agent

| Shortcut | Action |
| --- | --- |
| ⌘P | Open the file picker. |
| ⌘G | Open Git changes. |
| ⌘B | Open the in-app Browser. |
| ⌘E | Edit the active agent. |
| ⌘D | Duplicate the active agent. This does not create an isolated Git worktree. |
| ⌘R | Restart the active agent with a fresh conversation. |
| ⌘Shift K | Compact the active session when it is idle. |
| ⌘W | Close the active agent. |
| ⌘Shift W | Close the active team; remote teams offer the applicable delete or disconnect flow. |
| ⌘Shift M | Toggle muting spoken announcements. |

Some shortcuts require an active agent workspace and are suspended while a modal dialog is open. Browser access requires a host that supports the embedded browser.

## Drafts and app

| Shortcut | Action |
| --- | --- |
| ⌘Shift X | Save the active prompt draft. |
| ⌘Shift V | Open saved prompt drafts. |
| ⌘, | Open Settings. |
| ⌘Q | Quit through Korus's app lifecycle flow. |

## AppShots

Press both Command keys simultaneously while the window you want to capture is in front. Korus attaches it to the active conversation's draft. Change or disable this shortcut in **Settings → AppShots**. See [AppShots](../features/conversations#attach-an-app-window-on-macos).

## Composer commands

Type `/` in the composer to discover commands. Availability depends on the engine:

| Command | Action |
| --- | --- |
| `/plan` | Enter Plan mode. |
| `/compact` | Compact conversation context in Codex or Claude Code. |
| `/review` | Open Korus's [Code Review](../workflows/code-review) workflow. |
| `/visualize` | Open [Visualize](../features/visualize). |
| `/delegate [task]` | Ask the current agent to hand off work to a new Korus teammate in a worktree. |
| `/worktree [task]` | Alias for `/delegate`. |

Apart from `/compact`, the commands above are shared across supported engines, including Antigravity. The composer's **+** menu includes **Review**, **Delegate**, and **Visualize**. See [Worktree delegation](../workflows/worktrees#delegate-implementation) for handoff and local-commit behavior.

Both Codex and Claude Code offer `/goal`. Claude goals have no token-budget support. Other composer controls and turn actions depend on the selected provider; see [Conversations](../features/conversations).
