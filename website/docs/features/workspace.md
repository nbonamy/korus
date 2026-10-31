---
description: Inspect files and Git changes, and run mobile simulators beside the conversation.
---

# Workspace & diffs

The workspace beside the conversation keeps the artifacts you need for decisions within reach.

Use its **+** menu to open **Files**, **Changes**, **Review**, **Design**, **Visualize**, **Simulator**, or **Browser** where supported. Tabs can be closed with their close button; right-click a tab for its tab actions. See [Design](./design) for interface proposals and the handoff to coding.

## Organize agents by activity

Open **Agent view** at the top of the sidebar and choose **Repository** to keep sessions grouped by project, or **Activity** to follow work across repositories.

Activity view groups agents into **Needs input**, **Done**, **Working**, and **Idle**. Check **Needs input** for questions and approvals, and **Done** for recent activity and unread updates. Agents move between sections as their state changes; a Done entry is not proof that its work is validated or ready to ship.

Unread updates show a dot in place of the elapsed-time indicator. Each section scrolls independently; use **Show more** to reach additional agents. In **Idle**, open **Sort idle agents** and choose **Repository** or **Recent activity**. Each team remembers its view and idle sorting choices.

### Follow all teams in Cockpit

Open **Cockpit** from the left rail to follow activity across teams without switching between them. Its shared sidebar groups agents by activity and shows Mission progress. Select an agent or Mission to open its conversation and work; local and SSH-hosted agents appear together, with host connection indicators for remote work.

## Documents and plans

Ask the agent to display Markdown in the side panel when a guide, report, or proposal should remain visible:

```text
Show the implementation proposal in the side panel so we can discuss each step.
```

Plans and displayed documents have their own tabs. Keep the artifact open while discussing revisions so feedback refers to a concrete result.

In a Mission, documents open one at a time in a centered dialog, keeping the Mission workflow in place behind it. When an agent requests a document, choose whether to open it.

Use **Outline** in a Markdown document to show its headings and jump to a section. It is available when the document has headings. For plan choices, section comments, and implementation approval, see [Interactive plans](./conversations#review-an-interactive-plan).

## Files and diffs

Open **Files** to browse the agent's folder, expand directories, or search by path. Select a file to preview it. On macOS, **⌘P** opens the quick file picker; type part of the path and select the result.

When available, **Open In** opens the selected project file in a detected editor or application. The file preview is for inspection; ask the agent to change a file or open it in your editor when you want to edit it yourself.

Clicking a file link in chat downloads the file when it is binary or too large to preview. Previewable text and images still open in the workspace. This fallback applies to chat file links; a missing or unreadable file still reports an error.

Open **Changes** or press **⌘G** to inspect Git diffs. The agent header's diff selector lets you choose the scope:

| Scope | What it shows |
| --- | --- |
| Uncommitted | The current repository changes; this is the initial selection. |
| Staged / Unstaged | The corresponding Git changes. |
| Last turn | The recorded diff for the latest turn, when available. |
| Branch | Changes against the available base reference. |
| Commits | A selected commit from the available catalog. |

The selector's menu also breaks the selected diff down by what each file is for: code, tests, documentation, and other files such as configuration, lock files, and assets. Korus works this out from file paths and names across common languages, including TypeScript, Python, Java, Go, and Rust, so there is nothing to configure.

The **Changes** pane lists files under the same groups by default; select a group header to fold or unfold it. Its refresh action reloads the selected diff. Its **…** menu controls staged, unstaged, and untracked sections when available, grouping by file type, word wrap, and expanding or collapsing files. Select a file in the diff to open its preview.

Use the full repository diff before delivery so earlier or unrelated edits are accounted for.

Select lines in a source or diff preview to attach a comment to the conversation. Use this for precise feedback on a change, then send the annotations with your next message.

## Run repository commands

Use the play button in the conversation header to open **Run profiles**, then **Choose commands…**. Korus finds scripts in `package.json` and targets in Makefiles and Justfiles. Search or filter by source file, then click a command to pin it. **Custom command** lets you supply a name, command, working directory relative to the worktree, and optional preview URL.

Choosing commands saves them without running them. Select a pinned command from the play menu to run it and inspect its output, state, and exit code. Use **Stop** to end a running command, or **Preview** when a URL and an owning-host browser are available.

Pinned commands are shared across a repository's worktrees, but each run uses the selected agent's checkout and host. Check those before starting. Closing the output dialog leaves the command running; restarting Korus's daemon does not restart saved commands. Keep credentials in the host's private configuration rather than command text.

## Browse Git history

Open **Git log** from the agent header's Git menu to browse the current branch's commits beside the conversation.

- Search commit messages to find relevant work, or choose **Load older commits** to continue through the history.
- Expand a commit to read its message and changed files, then select a file to inspect its historical diff inline.
- Use **Copy commit hash** when referring to an exact change in the conversation.
- Refresh the log after new commits or a branch change if the history is out of date.

Inspecting a historical diff does not switch branches, restore files, or change your working tree. Use **Changes** to return to the current work.

## Mobile simulators

Run an iOS simulator or Android emulator beside your conversation. Interact with the live screen yourself, or ask your agent to inspect the app, tap, swipe, type, and capture screenshots while you work on the code.

### Set up a device

Use the Korus desktop app with a local agent. Install the tools for your platform first:

- **iOS:** Xcode and an iOS simulator runtime on your Mac.
- **Android:** Android SDK Platform Tools and Emulator, with a configured virtual device.

Open **+ → Simulator** in the workspace, choose the platform when offered, and select a device. Korus boots it if needed and shows its live screen. The pane offers setup guidance if required tools are missing.

### Try the app together

Use the live screen to tap, swipe, and type. The pane also has controls for rotation, Home, Android Back, and copying a screenshot.

You can ask the agent to open a simulator and check a specific flow:

```text
Open the Android emulator and check the sign-in flow in our app.
Try an invalid password, then sign in. Take screenshots of anything
that needs fixing.
```

Each device is attached to one agent at a time. **Detach** releases it for another agent and leaves it running; **Power off** shuts it down. Neither erases its data.

Simulator access uses local virtual devices.

## Browse and start backlog work

Connect [GitHub, GitLab, or Linear](../providers/#connect-github-or-linear) in Settings first. Open **Backlog** from the left rail to browse work across sources, or use the repository's **Backlog** pane or **Create from…** issue picker for work in that repository.

Choose **GitHub**, **GitLab**, or **Linear** when several are connected, then a repository, GitLab project, or Linear **Team / project**. A repository's backlog stays scoped to its own hosting provider and project. Selecting a Linear source changes the issues shown while keeping the code repository context. GitLab uses `#` for issues and `!` for merge requests; Linear issues display their identifier, such as `ENG-42`, and their native workflow status.

The global Backlog also offers shortcuts for assigned issues, pull requests awaiting your review, and your own pull requests. Use the repository filters to include work inside or outside your repositories and organizations you administer. **Check feedback** starts an agent to inspect unresolved review comments on a pull request and summarize what needs attention.

Use the star beside a repository or Linear source to keep it in **Favorites**. Drag a favorite by its handle to reorder it, or focus the handle and use the up and down arrow keys. Favorites and their order are saved separately for each backlog provider. Removing a favorite does not disconnect the source or remove its agents.

In a repository backlog, search by issue identifier or title and use the state, assignee, and label filters to narrow the list. GitHub and GitLab let you switch between issues and pull requests or merge requests, and offer **Assigned to me** in the assignee filter. Open an item to read its details before assigning work. For an issue:

1. Choose **New agent** for a new agent and worktree, or **Existing agent** when offered. An existing agent keeps working on its current branch; Korus never creates or switches a branch or worktree for it.
2. For a new agent, choose the coding engine, model, and reasoning effort, and check the branch it will be created on.
3. Select **Investigate**, **Fix**, or **Custom** to prepare your own prompt.

For a pull request or merge request, **Existing agent** is offered only for agents already on its branch, so reviews and feedback run against the right code.

From the global Backlog, select items and start work, choose the destination **Team** and coding engine, and choose a **Code repository** for Linear. Each selected item starts a separate agent in a worktree. Korus does not infer a local clone from the Linear team or project name.

Assigned items link back to their agent. Korus's assignment and completion status tracks the agent's work; it does not by itself change an issue's status in GitHub, GitLab, or Linear, merge a pull request or merge request, or deploy code. Ask explicitly when you want an external issue updated.

## Commit and deliver

The agent header's Git action menu offers actions supported by the current branch and repository, including **Commit**, **Push**, **Merge**, and **Create PR** for GitHub or **Create MR** for GitLab. GitLab delivery creates a draft merge request; Korus tracks its merge or closure and offers worktree cleanup.

In **Commit**, review the message and change scope before choosing **Commit** or **Commit and push**. Staged changes are included. **Include unstaged changes** is on by default; **Include untracked files** is off by default. Turn off unstaged inclusion if you have deliberately staged only part of the work.

**Push** sends existing commits to the displayed destination. Uncommitted changes remain local. A remote and branch must be available; the push action becomes available when there are commits ahead to send.

Linked worktrees can also offer an update from their base branch. See [Worktrees](../workflows/worktrees) for merge and cleanup, and [Code Review](../workflows/code-review) for the separate structured review workflow. **Changes** is the diff viewer; **Review** runs the review workflow.

### Pull, update, or clean up

Use **Pull** in the Git menu to fetch changes from the current branch's upstream. **Settings → Git → Workflow** lets you choose merge, rebase, fast-forward only, or the repository's Git configuration for pulls, and a strategy for updates from the base branch. If an update conflicts, resolve the reported conflicts and inspect the diff before continuing.

**Revert changes** discards uncommitted work after confirmation. Including untracked files is off by default; leave it off unless you intend to delete those files too.

Use **Prune** to review local branches, remote branches, and linked worktrees for removal. Merged, unused local branches are selected by default; remote branches are opt-in. Review unmerged work and uncommitted or ignored files before confirming. Deleting a worktree removes its files and can leave agents without their working folders.

Worktrees with uncommitted changes are marked in red. The uncommitted-file count excludes Git-ignored files; check those files separately when deciding whether a checkout can be deleted. Choose **Run in background** to continue working during cleanup, then inspect the completion count and any failures before assuming every selected item was removed.

## Agent workspace state

Workspace tabs stay associated with their agent. Switching agents changes the context without combining their documents or browser work.

In a split conversation layout, the artifact sidebar follows the focused agent.

Drag the dividers to resize conversation panes, or focus a divider and use the arrow keys. Each team keeps its pane assignments, focused pane, and sizes across restarts.

Project creation, new worktrees, Mission startup, and worktree deletion show progress in one dialog. Choose **Run in background** to keep working while the operation continues; check its final result before depending on the new folder or cleanup.

## Continue from your phone

Download [Korus Mobile for iPhone](__PRODUCT_COMPANION_APP_STORE_URL__) to keep working away from your desk. Continue conversations, follow Missions, review code changes, and respond when an agent needs your attention.

The iPhone and Android companions connect to your computer's Korus workspace. Enable mobile access in **Settings → Connections** on the desktop, create a pairing invitation, then scan or enter its code on the phone and approve the device on the desktop. Keep the computer awake, running Korus, and connected to the internet for the phone to follow or send work.

The companion remembers multiple computers. Use **Connections** in mobile Settings to add or switch computers, rename a saved connection, or forget one you no longer use. Pairings start with the computer's name; renaming a connection changes the label on that phone. Forgetting removes its saved connection rather than deleting work on the computer. Revoke a lost device from the desktop.

On iPhone, enable **Live Activities** in mobile Settings to follow running work and requests for attention from the Lock Screen and Dynamic Island. The activity follows the selected computer across its teams, including Mission workers. Tap an agent row to return to its conversation. Allow Live Activities in iOS Settings if prompted; this control is separate from notification permission. Switching computers or turning Live Activities off ends the previous activity.

Use the mobile sidebar to browse one team or **All teams**, switch between repository and activity views, and create a team. Select an agent to follow its conversation, respond to requests, or send a follow-up. Mobile Settings also offers usage, follow-up behavior, notification controls, and optional app lock.

## Understand usage and performance

Open **Settings → Analytics** to see usage recorded by Korus:

- **Token activity** shows the past year across providers. This overview stays independent of the filters below it.
- **Usage** shows token totals, input and output, usage share, and trends. Choose **Cost** for estimated API costs in USD, or **Tokens → Ratio** for the input-token share. Choose a provider, a 7-, 30-, or 90-day window or custom dates, and group the results by provider, model, or repository. Repository totals combine worktrees, with separate entries for Missions and Quick Chats.
- **Model performance** compares time to first token and output speed when measurements are available. **N/A** means a measurement is unavailable, not zero.

The **Output speed over time** chart plots a separate line for each model. Use the date and provider filters to compare how measured generation speed changes across your work.

Cost estimates use recorded usage and historical model prices. Totals and shares include priced usage only; **Unavailable** means there is not enough pricing evidence, rather than that the work was free. These are API-price estimates, not your subscription charges or an invoice. The calculations stay on your computer.

Statistics cover recorded activity in Korus rather than importing earlier provider history; different providers may report different token details. Check your provider's account page for remaining quota and billing.

Statistics stay local, are retained for up to a year, and do not include conversation text. **Refresh** reloads the view. **Clear** asks for confirmation before deleting recorded statistics; it does not delete conversations, change provider quotas, or stop agents. See [Analytics privacy](../troubleshooting/faq#does-korus-upload-my-analytics) for the distinction from provider access.

## Review before delivery

Check the files changed, the intended scope, and the validation evidence. Ask for a [Code Review](../workflows/code-review) when you want another pass.
