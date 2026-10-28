# Changelog

All notable Korus changes are recorded here.

## Unreleased

## [0.45.1] - 2026-10-27

### Improvements and fixes

- **Analytics by repository:** Compare usage across repositories, with worktrees
  grouped under their repository and separate entries for Missions and Quick Chats.
- Count Analytics activity and date ranges in your local timezone.
- Keep Analytics charts steady while you read; refresh on demand or when returning
  to the screen.

## [0.45.0] - 2026-10-27

### New features

- **Backlog shortcuts:** Jump to assigned issues, PRs awaiting your review, your
  own PRs, and work inside or outside your repositories, including organizations
  you administer.
- **PR feedback:** Start an agent to check your pull requests for unresolved
  review comments and summarize what needs attention.
- **Usage menus:** See tokens and cost from the chat menu, or a Mission breakdown
  by lead, repository, and total.
- **Implementation models:** Choose the provider, model, reasoning effort, and
  service tier when starting Mission implementation or assigning work.
- **iPhone Duo simulator:** Embed the foldable simulator, switch between folded
  and unfolded layouts, and see a loading indicator while the device changes shape.
- **Mission handoffs:** The lead receives an update when all tickets are implemented
  and when repository agents finish review fixes.
- **Mobile reviews:** Read the final verdict and finish a Mission review from
  your phone.
- **Mobile diffs:** Filter changed files by code, tests, documentation, or other
  file types.

### Improvements and fixes

- Show Mission activity consistently on desktop and mobile, with notifications
  only for blocking questions and approvals.
- Include the repository and branch in notifications for unnamed agents.
- Show costs for more models and remove synthetic Claude entries from Analytics.
- Sort chart legends and tooltips by their displayed values, highest first.
- Keep the startup loading screen visible while the background service reconnects.
- Fix Quick Open missing tracked files inside ignored folders.
- Keep agents beside the conversation on wide iOS and Android screens.
- Recover saved mobile pairing after unlocking the phone, and preserve reasoning
  effort when switching models.
- Refresh syntax highlighting in conversation code blocks.
- **Codex 0.164.0:** Update compatibility with the latest supported Codex CLI.
  Some older conversations remain readable and accept new messages, but individual
  turns can no longer be edited, retried, or deleted.

## [0.44.0] - 2026-10-26

### New features

- **Composer mentions:** Pick skills, agents, plugins, and files from suggestions
  to insert reference chips that stay intact in drafts, queued prompts, and edited
  messages. Typed or pasted `$skill` and `@name` remain plain text.
- **Mission and agent models:** Ask for a specific provider, model, reasoning
  effort, or service tier when starting a Mission or creating an agent.
- **Diff summaries for agents:** Ask an agent to break down added and removed
  lines by code, tests, documentation, and other files in a working tree, branch,
  or commit.

### Improvements and fixes

- Move **Commits** below the file-type breakdown in the diff menu.

## [0.43.0] - 2026-10-26

### New features

- **Conversation sharing:** Invite collaborators with a link or code to follow a
  conversation and suggest prompts for you to edit and send. Works across agent
  providers; stop sharing to revoke access.
- **Start a Mission from chat:** Use `/mission` or **+ → Mission** to turn your
  conversation into a Mission brief.
- **Delete repository:** Remove a local repository, its linked worktrees, and all
  associated agents across teams from the sidebar, with typed-name confirmation.
- **Changes by file type:** See code, tests, documentation, and other changes
  separately, including the last turn. Click a category to open its review.

### Improvements and fixes

- Keep Mission finding-reporting tools available across stage changes and open
  the correct Mission lead when launching a review from mobile.
- Remove older completed Claude tasks from the execution plan while keeping
  unfinished work visible.
- Use compact, automatically focused inputs for joining conversations, renaming
  agents, and continuing on a branch.
- Open the worktree setup guide directly from Settings.

## [0.42.0] - 2026-10-25

### New features

- Connect GitLab.com alongside GitHub, using a direct connection or an existing
  GitLab CLI login. Discover and clone projects from desktop and mobile, browse
  issues and merge requests, and start agent work or Missions from them.
- Create draft GitLab merge requests and follow them through merge or closure
  and worktree cleanup. Direct GitLab connections also make the official GitLab
  MCP tools available to agents.
- Compare estimated API costs in Analytics, with USD trends and breakdowns by
  provider or model. Estimates use available usage and historical model prices;
  usage without enough pricing evidence stays unavailable rather than counting
  as free. Explore input/output token ratios alongside token totals.
- Follow missions from the mobile apps: see each mission's stage and ticket
  progress, open the agent working on a ticket or the one leading the mission and talk
  to it, then return to the mission. Accept a finished ticket and move a completed
  implementation on to review from the phone, then read the review's findings,
  choose which to fix, and launch remediation. Shipping stays on the desktop.
- Close every artifact tab at once from the workspace tab menu.

### Improvements and fixes

- Keep Mission delivery and worktree cleanup in sync: merging marks the repository
  as shipped, closes agents from a removed worktree, and remembers that the
  worktree no longer needs deleting when the Mission is removed.
- Restore the live Working timer for Codex turns when the provider omits a start
  timestamp, and retain it through subsequent updates.
- Clear Claude's completed execution plan when the next turn starts, while keeping
  unfinished tasks visible.
- Clone GitHub and GitLab repositories over SSH first, with an HTTPS fallback and
  clearer authentication failures.
- Match repository work by its full remote identity, keeping projects with the
  same name separate and showing work from the repository's own provider.
- Recover phone connections faster after relay interruptions and let users open
  their saved connections from the unreachable-computer screen.
- Display conversation images on mobile when their Markdown paths use angle brackets.

## [0.41.1] - 2026-10-24

### New features

- Expand the artifact pane to fill the workspace, then restore its previous
  width without losing conversation drafts.
- Open detached developer tools for the current in-app browser tab from its menu.

### Improvements and fixes

- Group Claude's tool work under Working and Done disclosures, keeping the final
  response separate from progress updates.
- Show elapsed time while agents work and after a turn finishes. Restored Claude
  conversations retain turn durations when valid timing is available.
- Keep Add project and Quick chat beside each other in the Activity sidebar.

## [0.41.0] - 2026-10-24

### New features

- Install Bitwarden and 1Password in the in-app browser from Settings. Open your
  vault from the browser toolbar, and update, disable, reinstall or remove each
  extension independently.
- Save custom review instructions in Settings > Workflows. They accompany every
  review agent, including automatic reviews and fresh rounds.
- Track output speed over time in Analytics, with a separate line for each model.
- Select Image Gen from the skill picker in Claude and other non-Codex agents.
- The mobile companion remembers multiple computers, supports renaming and
  forgetting saved connections, and uses your computer's name when pairing.
- Browse agents across all teams and create teams from the mobile sidebar.

### Improvements and fixes

- All agents share browser accounts, cookies and extensions. Existing per-agent
  website sessions are not migrated; sign in again after upgrading.
- Clear browsing data across agents without removing extensions or their saved data.
- Accept a suggested follow-up in an empty composer with Right Arrow or Space,
  as well as Tab. Accepting the suggestion fills the draft without sending it.
- Mobile composers offer follow-up suggestions, and mobile Settings groups account,
  preference and app information more clearly.
- Dismiss stale mobile questions without retry errors.
- Suppress phone alerts for the exact conversation being viewed in the focused
  desktop window.

## [0.40.0] - 2026-10-23

### New features

- Install and manage coding-agent skills from Settings. Discover curated skills
  and packs, install from GitHub or skills.sh, and sync skills across configured
  agents. Browse existing installations, read skill documents, refresh managed
  packs, and delete personal skills with confirmation while protecting system skills.
- Featured skills include Cloudflare's Security audit, Vercel's Web design
  guidelines, Impeccable, Matt Pocock's skills, Superpowers, and pstack.
- Automatically resume conversations after a usage limit resets. A compact
  composer drawer shows the reset time and a saved Auto-resume toggle, enabled
  by default. Pending resumes survive restarts and cancel when you send a prompt
  or start a different conversation.

### Improvements and fixes

- Completed execution plans stay closed after a restart and clear when the next
  turn starts.
- Sending a message shows "other agent" while the recipient's name is unknown.

## [0.39.3] - 2026-10-23

### Improvements and fixes

- Claude Code's native task lists appear in the execution-plan panel, with live
  progress updates and restored progress when reopening a conversation.
- Worktree deletion shows its progress without a stale close-confirmation title.
  Agents without a custom name use their normal display name when confirming closure.

## [0.39.2] - 2026-10-23

### New features

- Run project and worktree creation, Mission startup, and worktree deletion in
  the background while continuing to use Korus.
- Filter the GitHub backlog by issues or pull requests, and choose Assigned to me
  directly from the assignee filter.

### Improvements and fixes

- Closing an agent with worktree cleanup immediately removes it from the roster
  and selects another teammate from the same repository when available. Failed
  cleanup restores the agent for retry without replacing your current selection.
- Concurrent worktree creation in the same repository avoids Git lock conflicts.
- Recent backlog sorting uses repository timestamps when issue activity is
  unavailable, instead of falling back to alphabetical order.
- Starting work uses a more compact dialog, with provider and source choices
  alongside repository selection.
- Menus consistently indicate the current selection across backlog views,
  repository sorting, and conversation layouts.

## [0.39.1] - 2026-10-22

### Improvements and fixes

- The file explorer shows workspace folders reliably in large projects. Folders
  load on expansion, and large listings offer Load more instead of silently
  omitting entries.
- Search finds files in unopened folders, with pagination for large result sets.
- Refresh the explorer to discover newly created files while keeping folders open.

## [0.39.0] - 2026-10-22

### New features

- Resize conversation panes with draggable dividers or keyboard controls. Team
  layouts, assigned agents, focused panes, and split sizes persist across restarts.
- Include read-only diagrams in interactive plans and comment on each diagram.
- Review Mission requirements with annotations and question answers, regardless
  of the interactive-plan workflow setting.
- Choose the implementation provider, model, and reasoning effort in a Start
  implementation dialog, independently of the Mission lead's provider.

### Improvements and fixes

- Mission stage handoffs wait for the lead's active turn to finish, preventing
  approved requirements from leaving Tickets queued and the lead stuck working.
- Mission workers retain their ticket assignments and receive actionable errors
  when submitting results, allowing corrections after a failed submission.
- Agent names remain visible in narrow conversation headers while repository
  and branch details truncate first.
- Question cards fill the conversation width and resize with the sidebar and pane.
- Concurrent operations on a new Codex agent share conversation initialization,
  preventing missing-rollout errors when starting work from an issue.
- Quitting the desktop app uses the native shutdown sequence reliably.
- Reading a conversation clears its mobile notification. Read events stay silent,
  and later alerts replace earlier notifications for the same conversation.
- Merge-report recipients follow the sidebar's manual agent order.
- Browse files directly from an empty file pane, and open local Markdown links
  in workspace tabs without replacing the app.

## [0.38.0] - 2026-10-22

### New features

- Claude and other non-Codex agents can generate images through Codex and display
  the results inline in their replies.
- Send merge reports to another agent in the same repository when a branch has
  no originating agent. Reporting stays off until you choose a recipient.
- Configure the models available from each provider with an administrator-managed
  `requirements.json` file, shared by desktop and mobile.
- Connect native Android companions with encrypted pairing and push notifications.
- On mobile, open existing projects from the connected host, duplicate agents,
  and rename agents from their conversation.

### Improvements and fixes

- Large mobile conversations, including image-heavy histories, transfer with
  compression instead of failing at the uncompressed response limit.
- Mobile conversations retain loaded history, drafts, attachments, and streaming
  replies across refreshes and reconnects, catching up without reloading the
  whole conversation. Slow conversation requests no longer disconnect the session.
- Mobile recovery is more reliable after brief backgrounding, with quieter
  connection indicators and clearer conversation-loading feedback.
- Restarting a Claude agent clears its old conversation, and newly forked
  conversations display their inherited history immediately.
- Review agents receive the full skill instructions and explicit errors for
  unsupported finding-update fields, preventing fixes from going unrecorded.
- Tool activity titles use readable names without MCP prefixes, underscores,
  or hyphens; shell commands keep their original text.

## [0.37.1] - 2026-10-16

### Improvements and fixes

- Creating and editing automations saves correctly without an object-cloning error.
- Analytics records token usage and output speed for the first turn in new Codex
  conversations. Previously unmeasured turns remain unchanged.
- Git diff controls use the same background as the other header controls.

## [0.37.0] - 2026-10-16

### New features

- Get started with your existing Codex and Claude CLI sign-ins and settings.
  New setups reuse your CLI configuration by default; saved choices and existing
  conversations stay intact. Separate setups remain available with their own sign-in.
- Use an authenticated GitHub CLI for repositories, backlog, and pull requests
  without signing in again. Direct GitHub access remains available, and canceling
  or disconnecting it preserves available CLI access. Hosted GitHub MCP requires
  a direct connection.

### Improvements and fixes

- Onboarding highlights separate setups that still need sign-in and warns before
  continuing without connecting them.
- GitHub and Linear connection flows load independently.
- Switching Codex configurations refreshes plugin availability, avoiding
  tool startup failures such as `node_repl`.
- Independent review threads use `👀 <thread name>`, or the branch name when
  the source thread has no custom name.

## [0.36.3] - 2026-10-16

### New features

- Choose the provider, model, and reasoning effort when launching backlog work.
  Start an individual ticket directly from its play button, and follow worktree
  creation progress for single or multiple agents.

### Improvements and fixes

- Activity view shortcuts follow the visible agent order. Hold Command to show
  shortcut numbers in place of other indicators. Needs input, Done, and Working
  sections put the longest-waiting agents first.
- Ticket details stay vertically centered at a fixed viewport-relative height,
  with a pinned header and scrollable description.
- New Mission workers inherit the main Mission agent's provider, model,
  reasoning effort, and speed setting. Same-provider delegated helpers also
  preserve the creator's speed setting.

## [0.36.2] - 2026-10-16

### Improvements

- Sort Idle agents in Activity view by repository order or recent activity.
  Each team remembers its choice, and agents animate into the new order.

## [0.36.1] - 2026-10-16

### New features

- View Claude's native subagents from the conversation header and open their
  individual threads, including background progress and completed work after a
  reload.
- Use Claude without a separate CLI installation through Korus's bundled
  runtime. On macOS, Codex can also use the runtime included with ChatGPT when
  no standalone CLI is available. Installed CLIs still take precedence.

### Improvements and fixes

- The Activity sidebar has a Done section, elapsed-time indicators, and
  independently scrollable sections with a Show more control. Unread dots take
  priority over elapsed times.
- Analytics uses shared provider, date, and grouping controls across its charts.
  The activity overview stays independent of those filters.
- Repository image icons save correctly, with a square crop preview and subtly
  rounded corners in the sidebar, conversation header, and Cockpit.
- Dark and system appearance stay consistent across native window chrome,
  provider icons, button hovers, and the conversation background. Switching from
  Dark to System follows the operating system again.

## [0.36.0] - 2026-10-15

### New features

- Organize the agent sidebar by Activity, with Needs input, Recently active,
  Working, and Idle sections. Agents animate between sections, and each team
  remembers your organization choice.
- Explore local usage statistics in Settings → Analytics, with token activity,
  usage trends, provider and model breakdowns, and comparisons of time to first
  token and output speed. Keep up to a year of statistics and clear them at any
  time.
- Use Fast mode for supported Claude models from the existing speed selector.
- Delegating agents can close their own idle workers while preserving their
  worktrees and branches.

### Improvements and fixes

- Recently active agents show unread indicators, and idle agents are ordered by
  their latest activity.
- The browser annotation Send button keeps its primary styling and stays on one
  line in narrow panels.

## [0.35.1] - 2026-10-15

### New features

- Check remaining Codex and Claude usage and reset times from mobile Settings.
- Create projects from your phone using a new repository, GitHub, or a repository
  URL. Browse GitHub branches or create a new branch in its own worktree.

### Improvements and fixes

- Mobile reconnects silently after brief interruptions and app switching, keeping
  your conversation visible. A Reconnect action appears after five seconds if
  recovery takes longer.
- Relay connections recover more reliably during active use.
- Push notifications open the correct conversation, including while reconnecting.
- Send image-only prompts from your phone, open image links, and view images
  returned by tools. Image previews stay stable as conversations update and reload.
- Project creation and worktree cleanup use consistent mobile sheets with clear
  progress, searchable repository and branch lists, and simpler navigation.
- Worktree cleanup only offers to delete the matching remote branch, protecting
  main and other inherited upstream branches on desktop and mobile.

## [0.35.0] - 2026-10-14

### New features

- Pair Korus Mobile for iPhone from Settings → Connections to follow your
  agents, send prompts, and respond to questions and approvals away from your
  desktop, without a VPN or router configuration.
- Manage paired phones individually and revoke access from the desktop.
- Open Git log from the Git menu to browse the current branch's history,
  search commit messages, and inspect changed files and historical diffs inline.

### Improvements and fixes

- The command palette includes simulator and review workspace actions.
- Delegate from the composer's + menu immediately using saved settings;
  add task details after `/delegate` when needed.
- Clear an agent's name directly from its text field.
- Long Claude conversations load in bounded pages, with oversized content
  available on demand. Unread activity stays synchronized across desktop and phone.
- Conversations keep their reading position while scrolling, and completed
  tool-only replies show their message actions.
- Simulator views recover cleanly when apps restart or a view ends.
- Mobile conversations load large histories reliably, retain visible content
  while reconnecting, and offer recovery when rendering fails.
- The mobile unlock screen matches the connecting screen without layout jumps,
  with a five-minute grace period when returning from another app.

## [0.34.0] - 2026-10-13

### New features

- Find contextual actions in the command palette with Cmd/Ctrl+Shift+P,
  and browse a searchable keyboard shortcut reference from the View menu.
- Branch current changes into a new worktree with an idle agent, preserving
  staged and unstaged work and moving untracked files without creating a commit.
- Favorite GitHub repositories and Linear sources in Backlog, with saved
  per-provider ordering and drag-and-drop reordering.
- Choose a fresh handoff or a native Codex/Claude conversation fork when
  delegating work, with reusable instructions and per-task overrides.
- Review plans with inline choices and section comments. Confirm your answers,
  request revisions, and approve implementation with feedback preserved on reload.
- Switch automatic reviews to manual while the current turn continues, or
  stop a review while keeping its findings for later.
- Save, search, rename, and reopen named bookmarks in the built-in browser.
- Navigate Markdown documents with an optional heading outline.
- Install the Antigravity runtime directly from provider setup.
- View Codex credits and banked resets in Settings, and redeem an available
  reset with explicit confirmation.

### Improvements and fixes

- Simulator video reconnects automatically after pauses without losing the
  device attachment or replaying interrupted gestures.
- Merge cleanup is enabled by default and remembers your worktree and branch
  deletion choices.
- Additional fields in saved workspace data no longer prevent startup.
- Delegation instructions stay attached to the correct turn when queued or
  overlapping turns complete. Favorites saves preserve other providers' ordering.
- Selected review findings and delegated tasks use concise visible prompts,
  keeping supporting context out of the conversation's main text.
- Workflow guidance loads on demand to keep agent context smaller.

## [0.33.0] - 2026-10-09

### New features

- Use Antigravity alongside Codex and Claude Code, with provider setup,
  streaming conversations, history, approvals, planning, and code reviews.
- Commit changes from completed reviews before finishing the review or starting
  another round.
- Choose a backend, model, and reasoning effort when starting backlog work,
  with branch-safe reuse of existing agents.

### Improvements and fixes

- Codex and Claude Code detection, execution, and upgrades use the same runtime
  selection, avoiding mismatches between nvm installations.
- Merge cleanup deletes both the local branch and its matching origin branch.
  Newer remote work is preserved, and cleanup failures remain visible without
  treating a successful merge as failed.
- Review setup uses consistent headings and shows additional instructions only
  when supplied, as a compact read-only preview.
- Issue descriptions render as Markdown. Start work dialogs stay within the
  window, use standard provisioning progress, and preserve permission defaults.
- Preserve saved agent records for providers unsupported by the current build.

## [0.32.0] - 2026-10-09

### New features

- Choose how Git pulls and updates from the base branch: merge, rebase, or
  fast-forward only. Pull can also follow your existing Git configuration.
- Prune a repository from the Git menu, with local branches, remote branches,
  and linked worktrees in one place. Merged, unused local branches are selected
  by default; remote branches are opt-in. Review unmerged work and files before
  confirming their deletion.
- Check installed Codex and Claude Code versions and upgrade supported
  installations from Settings. Upgrades wait for busy agents to finish.
- Add instructions after `/review` to focus the reviewer on what matters to you.

### Improvements and fixes

- Git menu actions are grouped for easier scanning.
- Claude and simulator tool activity shows clearer, action-specific labels.
- Delegated agents receive explicit implementation approval in their handoff,
  avoiding redundant confirmation requests.
- The built-in browser recovers from failed page loads and opens `about:blank`
  without an error.
- Dialog content stays left-aligned while footer actions remain right-aligned.

## [0.31.0] - 2026-10-08

### New features

- Open iOS simulators and Android emulators beside a conversation, with live
  device screens, touch input, rotation, and hardware controls. Agents can attach
  to a local simulator, inspect its screen, and interact with your app.
- See words appear as you speak with live on-device dictation on supported Macs.
  Dictation replaces the waveform with text, responds sooner, and preserves
  your draft when you stop or cancel.
- Agents can switch the built-in browser between device presets and custom
  viewport dimensions to check responsive layouts.
- Recently active Cockpit cards show the first line of the agent's latest
  response, including Codex summaries when available, with activity time as
  the fallback.

### Improvements and fixes

- Korus detects your installed Codex and Claude Code through PATH. Welcome and
  Settings offer official installation links and a refresh control when an
  engine is missing. Codex is no longer bundled or installed automatically.
- Question and approval cards have a clearer, more consistent layout. Selecting
  a suggested answer advances the question without an extra confirmation click.
- Opening an existing folder goes straight to the workspace, and repository
  indicators recognize its actual default branch.
- Claude agents reliably show their working status, with simpler tool labels.
- Review findings accept uppercase priority labels instead of rejecting them.

## [0.30.0] - 2026-10-07

### New features

- Open documents and browser tabs return after restarting Korus, with each
  agent's selected tab, pane visibility, and widths restored. Unsaved documents
  remain available until their tabs are closed.
- Save an unsaved document to a Markdown file from its tab, with the agent's
  repository as the default destination. Closing the saved tab keeps the file.
- Choose Queue or Steer as the default follow-up behavior in General settings.
  While an agent is working, Enter and the send button use that choice;
  Cmd/Ctrl+Enter uses the other action.

### Improvements and fixes

- Settings have clearer sections, more consistent controls, and easier-to-scan
  engine status and remote connections. Background service controls live in
  the Advanced section.
- Voice settings have a dedicated page with selectable voice tiles and
  individual previews.
- Automation editing uses a more compact layout with weekday buttons and a
  clearer next-run preview.
- Dark-theme settings controls use consistent container colors.
- Late tool results no longer cause new assistant activity to appear above
  the conversation's compaction divider.

## [0.29.0] - 2026-10-07

### New features

- Interactive HTML previews in assistant messages support charts, small tools,
  and other visual explanations directly in the conversation. Resize previews,
  inspect their source, or copy and download the HTML.
- Pull the current branch's upstream from the Git menu. If the pull produces
  conflicts, the agent receives a request to resolve them.
- Revert uncommitted changes from the Git menu, with confirmation and an option
  to include unversioned files, off by default.
- Enable or disable automations directly from the automation list.
- Windows and Linux Help menus include About Korus and Check for Updates.
  Platforms without automatic updates open the latest release downloads.

### Improvements and fixes

- Celebration effects are chosen randomly by Korus, without consecutive repeats.
- The model picker lists models directly, with supported reasoning efforts in
  each model's submenu. Selecting a model preserves a compatible effort;
  choosing an effort selects both together.
- A quieter team rail, consistent navigation states and headers, and lighter
  menu typography improve navigation. The sidebar shows the selected team's
  name, and teams named Korus use the app logo.
- Cockpit cards show provider icons when multiple backends are enabled. Idle
  sidebar indicators stay hidden until the individual agent is hovered.
- Image annotations are preserved when sending a prompt. Measurement
  annotations can be submitted without a comment.
- Delegated agents display explicit model selections correctly and use their
  provider's saved permissions before the first prompt.
- Agents load Korus's HTML, Visualize, Computer Use, and Mission guidance on
  demand through a shared tool, without needing filesystem access to skills.
- Automation storage is protected against overwrites by incompatible older
  builds. Removing a target conversation disables its schedules and marks
  abandoned runs as failed instead of leaving them stuck.
- Local SDK development resolves transcription helpers from the selected SDK
  checkout instead of a hard-coded root dependency path.

## [0.28.1] - 2026-10-06

### Improvements and fixes

- Press Tab in an empty composer to accept a suggested follow-up prompt, ready
  to edit or send. Accepting a suggestion does not send it automatically.
- Composer placeholders use a lighter color to distinguish suggestions from
  your draft.

## [0.28.0] - 2026-10-06

### New features

- Automations send recurring prompts to an existing agent or Quick Chat, or
  start a fresh Quick Chat each time. Existing conversations keep their model
  and permissions; new chats can use a provider, model, and reasoning effort
  of your choice.
- Schedule daily, weekday, weekly, or custom recurrences with a next-run
  preview. Calendar schedules follow your local timezone across daylight
  saving changes; interval schedules remain available.
- Ask an agent to create an automation directly from chat, including requests
  such as "every day at 8 AM." Scheduled work runs while the owning Korus
  daemon is running.

### Improvements and fixes

- The automation editor groups conversation, schedule, and model settings in
  compact sections. Agent choices include their repository, long chat titles
  truncate, and the automation list adapts to smaller windows.
- AppShots captures a specific window of the frontmost app, keeping its
  screenshot and accessibility context aligned.
- The macOS AppShots hotkey no longer requires Input Monitoring permission.

### Compatibility

- Scheduled prompts replace repository-based automation loops. Existing loop
  definitions are not migrated and must be recreated; their agents and
  worktrees are preserved.

## [0.27.2] - 2026-10-06

### New features

- Agents suggest useful follow-up prompts in the empty composer after finishing
  a turn. Suggestions stay with their conversation without changing your draft
  or sending anything automatically.

### Improvements and fixes

- A redesigned macOS installer lets you double-click Korus to install and launch
  it. Installations requiring administrator access are handed off to Finder
  without changing the existing app.
- Website download links follow the latest stable release for each platform.

## [0.27.1] - 2026-10-06

### New features

- Ask a project thread to launch an automatic review. Korus starts an independent
  reviewer using the thread's provider, model, and effort by default, without
  changing saved review preferences. This requires an explicit request; local
  commits remain off unless requested.
- Desktop distribution now includes Windows x64 installers and Linux x64/ARM64
  packages alongside macOS ARM64. GitHub prereleases are manual downloads;
  macOS and installed Windows copies receive automatic updates from stable
  GitHub releases. Windows installers are unsigned; Linux and portable Windows
  use manual package updates.

### Improvements and fixes

- Packaged apps include a private Node runtime, so desktop startup no longer
  requires a system Node installation. Korus waits for workspace state before
  showing onboarding, avoiding a false welcome screen while connecting.
- Claude authentication failures now update connection settings and finish the
  failed turn with a useful error. Retrying after an external login rechecks
  authentication instead of relying on a stale disconnected state.
- Codex can now see attached file paths, with attachment chips preserved when
  reopening conversation history.
- Claude tool searches show the search query and progress, and all providers
  use the same Korus collaboration-tool namespace.
- Restored native window controls and menu access during onboarding. Windows
  gains a subtle window border and more reliable Codex setup; Linux gains
  corrected packaged icons, native dependencies, and window startup behavior.
- The website offers platform-aware download choices, explicit Linux
  architecture selection, and narrated workflow videos with shared playback
  controls.

## [0.27.0] - 2026-10-05

### New features

- Automatic code review can now review, fix, and verify findings over multiple
  rounds with an independent Codex or Claude reviewer. Configure the priority
  threshold and round limit; Korus reports fixed and remaining findings back
  to the original conversation. Local commits after each fix round are optional
  and off by default. Enabling them includes existing reviewed working changes;
  automatic review never pushes or merges.
- Choose the independent reviewer's provider, model, and reasoning effort.
  Korus remembers these selections and automatic-review settings. Current-thread
  reviews keep the working agent's model and remain available in manual mode.
- Completed reviews save a report with findings, priorities, verification
  evidence, and round session references. Handoffs show a concise outcome in
  chat while keeping detailed results in context.

### Improvements and fixes

- Reviewers must explicitly confirm their finding count before a round can
  finish, preventing an unfinished inspection from appearing clean. Claude
  reviewers can access the review tools and inherit the configured approval
  defaults. Retrying a failed review preserves its settings.
- Claude file-edit approvals now describe the requested action and show the
  before/after text or replacement contents. The sidebar's Input state clears
  after the last pending approval is resolved, and review tools have clearer
  activity labels.
- Conversations recover missed completion events after reconnecting instead of
  remaining stuck on Thinking. Completed Codex turns without an assistant
  message show Empty response, and conversation history loading indicators stay
  synchronized.
- Pasting text into the Codex composer now preserves native undo and redo.
- Mission workspaces now share chat's header, sidebar control, surface styling,
  and shadow, with aligned workflow and conversation subheaders. The agent
  sidebar keeps a usable minimum width, and long project names truncate without
  displacing their icons.
- Opening Review from the command or composer menu clears the conversation's
  ready-for-review flag.
- The website's review preview now illustrates findings and fix selection, and
  responsive cards no longer overlap at narrower widths.

## [0.26.2] - 2026-10-05

### Improvements

- Remote engine settings now use compact, single-line rows for accounts,
  connection actions, and enable toggles, with host actions kept at the top.
- New installations use `/<` as the default team's name and avatar. Existing
  team names are unchanged.

## [0.26.1] - 2026-10-04

### Improvements

- Refreshed the team rail with a clock icon for Automations and a compact,
  outlined Korus logo for the menu.
- The background daemon now identifies itself as `korusd` and includes a
  matching executable launcher. Existing daemon version output remains
  recognized during upgrades.

## [0.26.0] - 2026-10-04

### New features

- Codex Claw is now Korus, with a new macOS icon and a refreshed website and
  guides at meetkorus.dev. Desktop downloads and update checks now use the new
  domain.
- Connect Linear in Settings and use team or project issues alongside GitHub
  as a backlog source. Start agents, plan Missions, and configure automations
  against an explicitly chosen code repository. Agents can access Linear's
  issue tools without treating a Linear project as a Git repository.
- Use `/delegate` or its `/worktree` alias to hand a task to a new teammate in
  a dedicated worktree while keeping the original conversation open. The
  current agent prepares the handoff; detailed instructions stay out of the
  visible chat prompt. Delegation does not automatically merge the work.
- Delegated tasks can save structured results, wait for workers, and cancel
  assigned work. Saved outcomes survive restarts and are delivered back to
  the parent without treating completion as permission to merge or advance
  a Mission.
- Claude conversations now support steering during active work, native forks
  from completed turns, and native goals. Steering is delivered at tool or
  response boundaries rather than immediately interrupting generation; forks
  currently require an idle conversation in the same folder.
- Open Review, Delegate, and Visualize directly from the composer's + menu,
  with grouped actions and Goal mode above Plan mode.
- Mission shipping now offers Update from the base branch and checks for new
  base commits before merging, so branch updates and conflict resolution can
  happen in the worktree before delivery.

### Improvements and fixes

- Plain text entered in the in-app browser address bar now runs a Google
  search. Normal navigation redirects no longer surface an aborted-load error.
  Unsupported chat file previews, including videos, download instead of
  opening an empty sidebar pane.
- Closing a dirty worktree now offers an explicit confirmation to discard
  uncommitted changes, including untracked files, rather than refusing deletion.
- Existing review contexts reopen after reconnecting or restarting. Mission
  review reruns no longer fail on an empty previous artifact; Mission workers
  retain their tools and can receive a new ticket assignment, and queued work
  no longer causes a false Mission failure.
- Chat panes keep a 480px minimum width beside artifacts. Open In menus escape
  clipped panes, engine icons disappear when leaving the sidebar, and the
  text-selection action is labeled Annotate.
- Codex startup and reconnect use asynchronous runtime discovery, avoiding
  blocking shell probes. Idle notifications no longer falsely mark turns as
  interrupted, and late completions do not clear newer work. Conversation
  lists avoid duplicate entries, and failing SDK listeners no longer reject
  unrelated requests.
- Chat Markdown is only reparsed when its text changes, reducing repeated
  rendering work while responses stream.
- Retrying an initial backend connection failure now restores event updates.
  Structured secrets and prompt content are redacted from diagnostic logs.

### Upgrade notes

- Korus uses `~/.korus` instead of `~/.codex-claw`; existing data is not migrated
  automatically. To retain an earlier setup, copy it while the app is closed
  and update saved absolute paths, including separate provider homes.
- The desktop app is now `Korus.app`, the daemon is `korusd`, and configuration
  environment variables use the `APP_` prefix instead of `CODEX_CLAW_`.

## [0.25.2] - 2026-10-03

### Fixes

- The sidebar's Input label now clears when a Codex question or approval is
  answered, returning to Working or Idle without waiting for another activity
  update. It remains visible if another request still needs a response.

## [0.25.1] - 2026-10-03

### New features

- Use Hand off from an agent's context menu or the Agent menu to continue its
  work with a new Codex or Claude agent in the same workspace. Choose the
  engine and model, optionally add instructions, and let the current agent
  write a handoff note before Korus closes it and starts its replacement.
  Hand off is available for idle workspace agents after pending work is resolved.
- Identify each agent's engine by hovering over the sidebar or focusing it
  with the keyboard. Icons appear beside the right-aligned status without
  reserving space when hidden, and are omitted when only one engine is enabled.

### Improvements and fixes

- Disconnect in Settings now signs out of Codex or Claude in the configured
  home, including on SSH hosts, instead of only disabling the engine.
  Reconnecting opens the sign-in flow. The separate enable toggle preserves
  sign-in, and the Codex-only Log out action has been removed from the user menu.
- Selecting an agent focuses its composer, including after a cold conversation
  finishes loading. Clicking controls in another split pane keeps their focus.
- Merging a worktree no longer reports failure just because its remote-tracking
  branch is behind. If branch or worktree cleanup cannot finish, Korus reports
  the successful merge separately from the cleanup warning.

## [0.25.0] - 2026-10-03

### New features

- Work with two agents side by side or stacked, or four agents in a grid.
  Split panes replace attached-agent sidebar tabs. Each team keeps its layout
  while switching teams, and one shared artifact sidebar follows the focused
  agent without closing when that agent has no open tabs.
- Use Codex, Claude Code, or both. Setup detects installed engines, offers
  installation and sign-in, and lets each engine use a separate Korus home or
  its existing setup. New setups separate chats while reusing existing skills.
  Engine pickers appear only when more than one engine is available.
- Manage each engine's account, conversation location, skill sharing, and
  enabled status in Settings, with engine connection controls on SSH hosts too.
  Changing conversation location requires explicit acknowledgment before
  removing that engine's local agents and Quick Chats from Korus.
- See Codex and Claude subscription usage together in the user menu, including
  remaining allowance and reset times. API-billed Claude accounts have no
  subscription quota row.
- Drag supported file and web links from conversations into the sidebar to
  open their content in a new tab.
- Model, reasoning-effort, service-tier, and approval or permission choices
  become defaults for new agents and Quick Chats using the same engine,
  without changing existing agents.
- Agents waiting for a response or approval show a prominent blue Input label
  in the sidebar.

### Improvements and fixes

- Codex and Claude tool approvals use a consistent card in the composer,
  preserving the draft, attachments, and caret when the request is resolved.
- Free-text Other answers to agent questions are immediately editable and grow
  as you type.
- Split composers no longer steal focus or selection from one another during
  background updates.
- For engines without steering, including Claude Code, the steering shortcut
  sends through the normal queue path and the queue shelf's Steer action is
  disabled.
- Fixed Codex Device Pairing in Settings so Allow connections reaches the
  backend instead of silently remaining off.
- Engine connection checks are cached for the session and refreshed by explicit
  connection or setup actions. Startup returns to setup when no engine is
  available, and Korus prevents disabling the last active engine.
- Claude authentication, saved conversations, skills, plans, and personalized
  instructions follow the configured Claude home. Codex personalization also
  follows its selected home.
- Repository skills no longer disappear when a global catalog refresh arrives;
  skill updates stay scoped to their engine and folder. Exact skill aliases
  rank ahead of substring matches.
- Composer action menus respect the app's theme colors.

### Upgrade notes

- App state migrates automatically from `state.json` to separate roster,
  settings, and visualization files after creating a verified backup. Older
  Korus builds cannot open the migrated state directly; downgrading requires
  restoring the pre-migration backup.
- Closing a Quick Chat now deletes its provider session, with archive as a
  fallback when deletion is unavailable. Closing a regular agent still archives
  its conversation.

## [0.24.1] - 2026-09-27

### Improvements and fixes

- Fixed an application freeze when attaching an agent whose conversation had
  not yet been opened since launch.

## [0.24.0] - 2026-09-27

### New features

- Attach another agent to the current agent from its context menu to open its
  conversation and composer in a sidebar tab. Its files, diffs, and reviews open
  alongside it; selecting the attached agent returns to its containing workspace.
- Attached conversations have a collapsible header with status and Git stats
  in compact mode, and Git and Open In controls when expanded.

### Improvements and fixes

- Agents can move between teams while working or waiting for input without
  interrupting their session. Moving either agent breaks its sidebar attachment,
  and failed moves now show an error message.
- Sending a prompt resumes following the conversation as replies stream in.
  Scrolling away pauses following, and the jump-to-bottom button reflects the
  actual scroll position.
- Enter now submits typed answers to agent questions; Shift+Enter inserts a
  newline.
- Escape no longer interrupts a conversation pane that has been removed.
- Model selector submenu text is more compact.
- Independent review handoffs no longer request a redundant summary of fixes
  already shown to the user.

## [0.23.3] - 2026-09-26

### Improvements and fixes

- Cmd+Enter now submits typed answers to agent questions, while Enter still
  inserts a newline.

## [0.23.2] - 2026-09-26

### Improvements and fixes

- Model, reasoning-effort, and service-tier choices now persist across restarts
  and stay selected when an older thread reports its settings. Queued prompts
  keep the choices captured when they were submitted.
- The model submenu closes after a model is selected.

## [0.23.1] - 2026-09-26

### Improvements and fixes

- Empty-composer Send stays disabled instead of sending an implicit “continue.”
- Remote team actions distinguish connecting to an existing team, disconnecting
  it locally without confirmation, and deleting it on the host. Deleting the
  host’s last team now offers to disconnect instead.

## [0.23.0] - 2026-09-26

### New features

- Goal mode can now be toggled from the composer menu. Goal and Plan modes are
  mutually exclusive, whichever entry point activates them.
- Changed-file headers in Git diffs can open the full file directly in a
  workspace tab.

### Improvements and fixes

- App, composer, model, and suggestion menus now use consistent spacing,
  typography, icon emphasis, and selected-state treatment.
- The backend selector above an empty composer now uses the full shelf row.
- Go to Agent now shows each repository's chosen icon, falls back to the
  branch or worktree glyph, and uses the chat icon for Quick Chats.
- Added and removed line backgrounds now extend across the full horizontally
  scrolled Git diff.

## [0.22.1] - 2026-09-26

### Improvements and fixes

- Quick Chats can preview absolute file links such as shared memory and
  instruction files even though they do not have a project workspace.
- Claude Code keeps live tool calls and the following answer in one message
  when conversation history refreshes during generation.
- Saved-draft actions remain available through their keyboard shortcuts and
  the Edit menu without duplicating them in the composer menu.

## [0.22.0] - 2026-09-26

### New features

- Choose Codex or Claude Code across agent creation flows, including worktrees,
  work items, projects, and repository URLs. Fresh chats can switch before the
  first prompt, and independent reviews can use a different backend. The
  selector stays hidden when only one backend is enabled.
- Save a prompt or selected text for later with ⇧⌘X, then search and restore
  persistent drafts with ⇧⌘V.
- SSH connections can install Claude Code and show its sign-in status with
  guided authentication steps in Settings.
- Reviewers can add, correct, or retract structured findings across turns
  while a review remains open.
- The new Agent menu groups edit, duplicate, fork, compact, compress, resume,
  and restart actions in the same order as the agent context menu.

### Improvements and fixes

- An empty, idle composer can send “continue”; a restored interrupted turn
  resumes through its dedicated action without adding a user prompt.
- Git diff menu statistics align with the main indicator, and the selected
  scope is easier to distinguish.
- Repository URL acquisition accepts SSH addresses and keeps the selected
  backend through agent creation.
- Remote Codex sign-in distinguishes unavailable status from a required
  sign-in, and Claude settings stay in sync with remote hosts.
- Independent reviews with no remediated findings now say that no code changes
  were made.

## [0.21.1] - 2026-09-25

### New features

- The in-app browser now offers page zoom controls and a device toolbar with
  responsive, phone, tablet, desktop, and custom viewport sizes.
- Capture the visible browser page or a selected area directly to the clipboard.

### Improvements and fixes

- Code reviews end with a short, natural summary while keeping the detailed
  findings in the Review pane. After an independent review, the original agent
  receives a concise, programmatic list of remediated findings.

## [0.21.0] - 2026-09-25

### New features

- Visualize diagrams now open on a persistent canvas. Edit supported Mermaid
  shapes, annotate selected elements for the agent, and export the canvas as a
  PNG. SVG and generated-image diagrams remain image elements on the canvas.
- Visualize diagrams now belong to their Git repository instead of the agent
  that created them. Agents in linked worktrees share diagrams and editable
  canvases, which remain available after a worktree agent is removed.
- Browser tabs can copy their current URL or open it in the system browser.
  The address bar also offers an open-external action on hover or focus.

### Improvements and fixes

- Creating a project from a Quick Chat now shows progress through folder
  creation, agent setup, and the first prompt.
- In-app browser pages remain visible beneath Korus menus and dialogs instead
  of disappearing when an overlay opens. The empty browser surface is white
  and no longer shows a loading message.
- Tool-opened browser pages now keep the requested URL in the address bar,
  and resizing the workspace no longer stalls when the pointer crosses the
  embedded browser.
- Workspace tab labels collapse before their close buttons, keeping the close
  action available until tabs reach icon-only width.
- Selecting `/goal` opens a composer mode for the objective rather than sending
  an empty goal immediately. Slash-menu keyboard selection now distinguishes
  Tab completion from Enter activation.
- The conversation shows “Working” when hidden Korus tool activity is the only
  visible sign of an active turn, and skill reads show the skill name instead
  of `SKILL.md`.

## [0.20.7] - 2026-09-24

### New features

- Turn a Quick Chat into a project on request. Codex Korus creates the
  folder and a project agent, hands over the conversation's decisions, and
  keeps the original Quick Chat available.

### Improvements and fixes

- Projects can use ordinary folders without Git. New projects start with an
  empty folder, and folder agents stay separate from Quick chats.
- Quick Chats can access Korus tools, including project creation.
- Codex Korus uses its own Computer Use tools instead of the bundled alternative;
  older Computer Use calls also have readable activity labels.
- Workspace tabs keep a stable height when labels appear or collapse, and
  multi-target tool titles display their overflow count consistently.

## [0.20.6] - 2026-09-24

### Improvements and fixes

- Single free-text questions now use a compact input-and-send layout. In
  multi-question cards, the primary action follows Back in the footer.

## [0.20.5] - 2026-09-24

### Improvements and fixes

- File tabs can copy either an absolute or a repository-relative path. Their
  tooltips wait longer, and the conversation keeps a readable width beside the
  workspace.
- The Git indicator says “No changes” when the selected diff is empty, and
  weekly usage limits show a live time-to-reset countdown.
- Visualize is available from an empty workspace, even before a diagram session
  exists, and opens the same flow as `/visualize`.
- Completed work can offer review at the handoff, while status updates and
  turn-completion calls no longer clutter conversation or execution previews.
- App and chat controls no longer select their labels when clicked. Completed
  earlier turns no longer retain a stale streaming indicator.

## [0.20.4] - 2026-09-24

### New features

- Right-click workspace tabs to copy a file path, close that tab, or close the
  other tabs.

### Improvements and fixes

- Workspace tabs shrink to icons before scrolling is needed, with navigation
  controls for overflow and a full-title tooltip on hover.
- Browser menus and tab menus now appear above the native browser view instead
  of being hidden behind it.

## [0.20.3] - 2026-09-23

### Improvements and fixes

- Removed the Command-R shortcut for Restart Agent to prevent accidental restarts;
  the action remains available from the menu.
- Increased the backend event buffer to reduce the chance of losing a large
  conversation update during a burst. Recovery from a fully saturated buffer
  remains a separate issue.

## [0.20.2] - 2026-09-23

### Improvements and fixes

- Codex blocking questions now use the conversation composer instead of a narrow
  inline tool card. Answering restores the composer and leaves the completed
  answer in the transcript.
- Asynchronous questions return the normal composer after their turn and remain
  available through a Pending question control. They can be reopened or
  dismissed, and a new prompt no longer revives an obsolete question.
- Question responses still reach their conversation if a request event was
  missed, and review invitations clear when the user submits a new prompt
  without clearing other proposed actions.

## [0.20.1] - 2026-09-23

### New features

- Start a Mission from an open GitHub issue in any repository represented by its
  team. The issue picker opens on the first available repository, and the issue
  details become the Mission's starting context.

### Improvements and fixes

- Missions now belong to their team. Closing a team also removes its Missions
  and workers while leaving Mission worktrees on disk, with the effect stated
  in the confirmation dialog.
- Restarting Codex Korus restores the selected Mission workspace instead of
  showing its lead as an ordinary agent thread.

## [0.20.0] - 2026-09-22

### New features

- Missions guide work from requirements and tickets through implementation,
  Review, and Ship in a dedicated workspace. Stage artifacts, agent progress,
  repository worktrees, and delivery actions stay together. Mission Review
  presents selectable findings, repository-specific fixes, a Changes tab, and
  a fresh review run; shipping does not require fixing every finding.
- The new Review pane can review uncommitted or branch changes with the current
  agent or an independent reviewer. Triage findings, discuss them in chat,
  apply selected fixes as a batch, and run another round that remembers skipped
  findings and checks accepted fixes for regressions.
- `/visualize` opens a persistent diagram workspace beside the conversation.
  Agents can suggest, create, edit, and delete Mermaid, SVG, or generated-image
  visualizations; thumbnails, zoom, and pan make them easy to inspect.
- Agents can propose moving implementation into a dedicated worktree through
  an inline action that the user can accept or dismiss. Co-agents inherit the
  originating model and reasoning effort unless explicitly changed.
- Worktree branches can be updated with the latest base-branch changes before
  merging, with progress and a conflict-resolution handoff to the agent.

### Improvements and fixes

- The Git diff indicator now defaults to uncommitted changes, remembers its
  selected mode per agent, and changes mode without opening the diff pane.
- Manual worktree creation uses the same staged progress experience as agent
  creation. Merge and cleanup report retained folders without losing the
  completed work, and shared worktrees are not offered for deletion while
  another agent still uses them.
- Agent status clears at turn completion, and status, announcements,
  celebrations, and proposed actions can complete together with fewer tool
  steps. Review invitations appear when uncommitted work is ready for review.
- Generated images remain visible outside collapsed assistant work and can be
  copied directly. Codex questions now use an in-conversation answer composer
  with simpler choices and an explicit cancel action.
- Visualize tools remain discoverable throughout an agent session while their
  actions still require the matching open pane. Long-running backend requests
  use operation-specific timeouts to avoid premature failures.

## [0.19.5] - 2026-09-18

### Improvements and fixes

- File links in conversations can now preview files anywhere on the agent's
  local or remote host, including shared instructions and other resources
  outside the repository.
- `/compact` is passed through to Codex instead of opening Korus's retired
  session-compression dialog. Slash-command suggestions now appear only when
  `/` is the first character in the prompt.
- Delegation instructions now distinguish engine-native subagents from separate
  Korus co-agents, asking for clarification when a request is ambiguous.
- The selected agent row preserves the sidebar's translucent background.

## [0.19.4] - 2026-09-18

### New features

- Select text in a conversation, add a comment, and carry it into the next
  prompt as a compact, removable annotation. Annotation drafts stay with their
  agent across navigation, survive failed submissions, and keep their detailed
  context out of the visible user message.

### Improvements and fixes

- Agent creation, navigation, announcements, and celebrations now respect the
  initiating or receiving client instead of leaking shared selection state
  across desktop, web, or remote clients.
- Plan reviews, queued prompts, approvals, and questions remain scoped to the
  correct agent and conversation. Replayed plans no longer create duplicate
  reviews, and cancelled Claude permission requests clear promptly.
- Interrupted and failed Codex work groups are labeled as stopped or failed
  instead of appearing completed.

## [0.19.3] - 2026-09-15

### Improvements and fixes

- Plan Review now opens reliably for plans returned through Codex Plan mode.
  Implement Plan closes the review before submitting exactly one implementation
  prompt, and the footer actions use the standard priority and ordering.
- Live Codex execution plans once again appear in the conversation mini panel.
  The right-workspace add menu no longer includes the redundant Backlog entry.

## [0.19.2] - 2026-09-15

### New features

- Press Command-K to search and jump to any agent across teams. Results show
  repository and team context, prioritize unread agents and then recent
  activity, and switch teams automatically when needed.
- Remote teams can now create Git projects, browse existing folders, and clone
  GitHub repositories directly on their devbox. Connection settings detect
  mismatched Korus and Codex versions, upgrade both managed runtimes together,
  and support ChatGPT device-code sign-in without moving tokens through Korus.
- Personalization settings can edit the global developer instructions used by
  Codex or Claude, with an explicit option to replace both. Git settings now
  accept custom guidance for generated commit messages and pull request titles
  and descriptions.

### Improvements and fixes

- Codex conversations use reasoning summaries as activity labels and correctly
  reopen a completed work group when an asynchronous answer resumes the turn.
  Codex memory support is enabled for new app-server sessions.
- Queued prompts are delivered only once when turn completion and idle events
  arrive together.
- Remote folder selection is more compact and direct, while longer remote
  discovery, authentication, prompt, and repository operations have enough
  time to finish without spurious request timeouts.
- Active-team rail indicators now pulse by brightness without fading, and Git
  worktree initialization is grouped with the rest of the Git settings.

## [0.19.1] - 2026-09-14

- Computer Use actions can now observe their settled result in the same call, wait for expected text, and type, replace, or submit directly into a targeted field without foregrounding the app.
- Computer Use now recovers cleanly from lost observations without repeating delivered actions, returns more compact contextual state, and opts into screenshots only when visual context is useful.

## [0.19.0] - 2026-09-14

### New features

- Backlog and Agents now have separate global rail entries. Backlog remains the
  operator inbox for connected work, while the new agent Cockpit shows every
  agent grouped by team or ranked by current and recent activity, with quick
  prompts available directly from each card.
- Codex agents can ask non-blocking questions inline while continuing to work.
  Option and free-text answers stay attached to the question and restore with
  conversation history.
- Computer Use is upgraded to v2.0.1 with explicit window selection, stable
  element observations and state diffs, combined accessibility and screenshot
  capture, plus keyboard shortcuts, drag, paste, text selection, secondary
  actions, and right or middle clicks.

### Improvements and fixes

- Returning to a previously viewed conversation now restores its rendered
  history and scroll position across agent and team switches.
- Cockpit Recent mode prioritizes agents currently working before idle agents,
  and persisted activity times keep its ordering meaningful after restart.
  Team icons show active work without overriding unread indicators.
- Asynchronous questions and active-turn state now reconcile correctly after a
  restart. Optional questions no longer leave agents waiting for input, and
  graceful SDK shutdown gives provider history time to flush.
- Context-compaction markers now settle cleanly and retain their position among
  surrounding activity. Duplicate skill mentions are suppressed, and composer
  menu chevrons align consistently.
- Refined the Cockpit layout menu, title hierarchy, and Backlog rail icon for a
  denser, quieter workspace.

## [0.18.0] - 2026-09-13

### New features

- Connected GitHub accounts now give Codex and Claude agents access to
  GitHub's hosted MCP tools through Korus-managed, automatically refreshed
  credentials. Korus avoids duplicate GitHub tool surfaces while preserving the
  ChatGPT connector as a fallback when its own GitHub connection is unavailable.
- Create an empty Git-backed project directly from the Add Project menu.
- Choose which changes to review from the agent header: the current branch,
  all uncommitted work, unstaged or staged changes, the latest turn, or an
  individual recent commit.

### Improvements and fixes

- Switching teams now updates immediately and shows the selected conversation's
  loading state instead of blocking navigation or briefly appearing empty.
- Git statistics refresh while an active agent edits files, and Git reviews now
  load reliably without clone errors or hiding valid branch and commit diffs.
- Assistant activity keeps its original order around final responses, and
  generated media produced during a turn stays grouped with its collapsible
  work details.

## [0.17.0] - 2026-09-08

### New features

- Compress Session starts a fresh conversation with a condensed handoff of
  completed work, key decisions, and next steps. The original conversation is
  archived, and the new session keeps the agent's model and reasoning settings.
- Closing or restarting a Codex agent now archives its retired session. Resume
  Session searches both active and archived conversations in the agent's folder
  and restores archived sessions when selected.
- Save favorite model, reasoning-effort, and speed combinations directly from
  the model menu. Favorites can be reordered or removed in a dedicated dialog.
- The bundled Codex runtime now includes GPT-6-Astra where available to your
  account.

### Improvements and fixes

- Codex conversations now group assistant work by turn, with clearer separation
  between intermediate activity and the final response.
- Improved conversation loading after restart, with automatic retries for
  transient failures and a visible Retry screen when history cannot be loaded.
  Missing optional skill metadata no longer prevents conversations from loading.
- Editing, deleting, retrying, and forking conversation turns now use the
  provider's authoritative history. Long rollback operations have more time to
  finish, and action failures remain visible without discarding the session.
- Fixed first-prompt and Thinking indicator flicker during new conversation
  creation, duplicate user messages, and duplicate compaction indicators.
- Restored queued prompts above the composer, cancellation, and follow-up
  actions. Model selection keeps the menu open to choose reasoning effort, and
  favorites correctly apply Fast mode.
- Merge now checks that branches include the latest target-branch commit
  before merging. Squash-merge cleanup no longer prevents a
  requested push, and merge and pull-request dialogs warn about uncommitted work.
- Automated work selection now considers eligible items across the configured
  repositories before creating agents and isolated worktrees. Completed workers
  remain available for review or continuation.
- Spoken acknowledgments can be limited to dictated prompts, and acknowledgments
  that will not play are labeled as skipped. Celebrations only play for the
  selected agent.
- Agent headers avoid repeating unnamed agents' branch names and show their
  repository context immediately after creation. Update badges no longer appear
  while merely checking for updates.
- Removed the obsolete Bench, legacy backlog and issue-creation screens, and
  Prepare Work flow. Temporarily hidden the unstable current-turn diff summary
  above the composer.

## [0.16.0] - 2026-09-03

### New features

- Agents can now speak a brief acknowledgment when work starts and an optional
  completion cue through on-device neural voices on macOS. Voice, agent scope,
  foreground-only behavior, previews, and a global mute shortcut are available
  in Settings.
- Delegated Git work can now report back to its parent agent when creating a
  pull request or merging directly. Korus asks the worker for a final handoff,
  shows the handoff phase in progress, and lets the operation continue in the
  background.
- Korus now tracks pull requests created for agents and flags them when they are
  merged or closed, with guided cleanup for the agent, worktree, and local
  branch while preserving work from unmerged pull requests.

### Improvements and fixes

- Repository and agent drag-and-drop are now distinct: repositories move with
  all their agents, while agents can only be reordered inside their repository.
- The active sidebar session is easier to distinguish from other sessions.
- Agent celebrations now respect the celebration setting and vary their visual
  effect instead of always showing confetti.
- Rolling back a long, paginated Codex conversation now uses the current Codex
  revert protocol and refreshes the retained history correctly.

## [0.15.2] - 2026-09-02

### Improvements and fixes

- Composer chips and rendered mentions now align cleanly with the surrounding
  text.
- The empty right workspace no longer shows a redundant Backlog shortcut;
  repository work remains available from the new-tab menu.

## [0.15.1] - 2026-09-02

### Improvements and fixes

- Resumed goals now continue running across restarts, remain visibly marked as
  working between turns, and leave the composer shelf once complete.
- Korus agents now receive explicit guidance for single-call worktree
  delegation, persistent Markdown presentation, and meaningful celebrations,
  making those existing workflows more reliable to invoke.

## [0.15.0] - 2026-09-02

### New features

- Agents can now delegate work as one complete handoff: create an isolated
  worktree, start another agent with initial instructions, and show staged
  setup progress while the agent gets ready.
- New worktrees can now initialize before an agent starts. Repository-owned
  `.agents/worktree` scripts take precedence, while Auto-detect can copy local
  environment files and restore Node.js, Python, and Go dependencies. Settings
  can limit initialization to repository instructions or disable it entirely.

### Improvements and fixes

- Work assignment and worktree creation now use clearer new-agent and
  existing-agent choices, allow branch names to be edited, and offer to reuse
  an existing worktree instead of surfacing a raw Git error.
- Cockpit repository rows now link directly to GitHub instead of showing an
  ambiguous agent-launch control.
- Closing an agent now gives linked-worktree cleanup enough time to finish
  without timing out.
- Plain code blocks now preserve their original line breaks when no syntax
  highlighter is available.

## [0.14.3] - 2026-09-02

### Improvements and fixes

- Agents are now explicitly prompted to celebrate releases, hard fixes, major
  features, migrations, and genuine breakthroughs, making configured visual
  celebrations more reliable after meaningful accomplishments.

## [0.14.2] - 2026-09-01

### New features

- Starting work from an issue or pull request now shows a staged preparation
  view while Codex Korus creates the branch or isolated worktree, starts the
  session, and hands over the work context.
- Inline conversation images now open or focus a reusable image workspace tab,
  while the explicit maximize control opens the stock fullscreen viewer.

### Improvements and fixes

- Older conversation history now prefetches as the transcript reaches the top,
  avoids duplicate requests, and preserves the visible scroll position as
  earlier messages arrive.
- Initial ChatGPT connection now uses a smooth edge-to-edge progress indicator.

## [0.14.1] - 2026-09-01

### Improvements and fixes

- Update checks now show live checking and downloading progress in the header
  before an update is ready to install.

## [0.14.0] - 2026-09-01

### New features

- Loops are now Automations throughout Codex Korus, with existing saved loops,
  execution history, and work assignments migrated automatically.
- GitHub can now be connected directly from first-run onboarding or the
  repository picker through a secure browser authorization flow.
- Experimental Linux x64 builds now bundle the matching Codex runtime while
  keeping macOS-only Computer Use and Appshots features disabled.

### Improvements and fixes

- First-run setup now provides a consistent ChatGPT and optional GitHub
  onboarding experience, ending with a single celebratory completion screen.
- Generated images now render through an app-scoped local-media protocol,
  restoring image previews without exposing arbitrary local files.
- Long and restored conversations now omit unnecessary historical tool
  payloads, reducing synchronization size while preserving the genuine latest
  messages when older history loads.
- The GitHub repository picker now keeps a stable height across loading, empty,
  filtered, and populated states.

## [0.13.0] - 2026-08-30

### New features

- Computer Use now provides an on-demand operating guide and semantic
  Accessibility targeting for dialogs and native menus, including safe menu
  dismissal without moving the physical pointer.

### Improvements and fixes

- Computer Use now bundles helper 0.3.0 with absolute screenshot coordinate
  metadata, a guarded physical-click fallback for Electron controls, and
  automatic virtual-cursor cleanup after inactivity.
- Form dialogs now share one compact, labels-above-fields layout, while the
  legacy File → New Agent action and Command-T shortcut have been removed in
  favor of contextual repository and session entry points.
- Team rail avatars and the new-team control now use a consistent square shape,
  with a cleaner focus ring and a clearer unread indicator.
- Agents created through MCP now use repository identity instead of accepting a
  separate agent avatar; custom names remain optional.

## [0.12.0] - 2026-08-30

### New features

- Sessions is now organized around repositories, branches, worktrees, and chats,
  with collapsible repository groups, persistent custom repository icons, and
  compact controls for starting work where it belongs.
- Projects can now be added from a local folder, a GitHub repository, or a
  repository URL, then opened from a branch, pull request, or issue without
  leaving Korus.
- Repository work can now continue in an existing session on a branch or start
  in a new isolated session and worktree, with branch-aware worktree creation
  and assignment directly from the Sessions workflow.
- Workspace-free Quick Chats now provide persistent conversations for work that
  does not belong to a repository.
- Team agents can now be mentioned in prompts with stable `@` suggestions, and
  agents can trigger optional, user-controlled celebration effects for the
  moments that deserve them.

### Improvements and fixes

- Long conversations now synchronize with bounded snapshot and transcript
  payloads, keep retry progress out of durable history, and use Codex 0.151.0's
  stable image-aware compaction support to reclaim substantially more context.
- Fast mode now remains enabled for a conversation after Korus restarts.
- Agent editing is now limited to an optional display name, while unnamed
  sessions consistently use their branch or conversation title.
- ChatGPT integrations now offer to quit an already-running normal instance
  before relaunching it with Korus's isolated Codex home.
- Cockpit now shows unread indicators for teams containing unread sessions,
  native Edit menu actions are restored, subagent conversations recover from
  oversized-history failures, and recalled prompts no longer depend on browser
  text selection.

## [0.11.1] - 2026-08-14

### Improvements and fixes

- Closing an agent now preserves its provider conversation in history instead
  of archiving the Codex thread.
- Completed assignments whose source work item remains open now return to
  Backlog, keeping Cockpit counts and available work consistent.

## [0.11.0] - 2026-08-14

### New features

- Cockpit is now a cross-repository backlog-first operator inbox, with
  repository navigation, All/Backlog/WIP/Focus views, an Assigned to me
  default, and true paginated GitHub results.
- Multiple issues can be selected and launched together into a chosen team;
  each item gets its own automatically named background agent and isolated
  worktree without additional setup dialogs.

### Improvements and fixes

- Repository recency now follows open issue and pull-request activity, Cockpit
  automatically falls back to the most useful non-empty view, and completed or
  orphaned assignments no longer distort active-work counts.

## [0.10.2] - 2026-08-12

### Improvements and fixes

- Repository backlog assignments now stay attached to their agents and are
  grouped as in progress, blocked, ready for review, or completed; agents can
  update that lifecycle with a visible note, while users can jump to the owner
  or clear the assignment and optionally close its agent.
- Closing an agent that uses a linked worktree now offers safe cleanup of the
  worktree and local branch, with an explicit option to delete the tracked
  remote branch; backlog work also reuses existing branches and worktrees when
  possible.
- Queued prompts can now be edited directly in the composer, including
  atomically steering the revised prompt with Command/Ctrl+Enter.
- Backlog issue and pull-request links now open directly in the system browser,
  duplicated work starts in the background without stealing focus, and action
  popovers remain open until dismissed with a click.

## [0.10.1] - 2026-08-12

### New features

- Agent responses can now open interactive visualizations in a dedicated,
  sandboxed workspace tab.

## [0.10.0] - 2026-08-12

### New features

- A new repository Backlog workspace lets you browse, search, and filter GitHub
  issues and pull requests, then prefill a custom prompt or dispatch focused
  investigate, fix, feedback, and review actions to the current agent or an
  isolated duplicate; work can stay in the current folder or use a new
  worktree, while pull requests check out their actual head branch.

### Improvements and fixes

- Conversation titles now stay aligned with Korus agent names, including agent
  renames, and closing an agent archives its Codex conversation.
- Git status refreshes are now limited to meaningful active-agent and Git
  lifecycle events, avoiding redundant background requests and stale results.
- Long code lines in conversations now wrap instead of overflowing the message
  pane.

## [0.9.1] - 2026-08-11

### New features

- The Git workflow menu can now create and switch to a branch in the current
  folder or a new worktree, automatically keeping the agent attached to the
  resulting workspace.
- Commit and pull-request dialogs can now ask Codex to draft concise messages
  from the selected changes without creating a visible conversation.
- Previously submitted prompts can now be recalled from the composer for quick
  reuse or editing.

### Improvements and fixes

- Settings are now organized around Codex and Claude Code, with clearer plugin
  ownership and Codex Device Pairing labels.
- Git dialogs and other app dialogs now use consistent compact actions,
  repository context, progress feedback, and completion states.

## [0.9.0] - 2026-08-11

### New features

- The agent header now provides a complete Git workflow for committing selected
  staged, unstaged, or untracked changes, pushing branches, creating draft pull
  requests, and merging or squashing branches with safe worktree cleanup and
  visible progress, success, and retry states.
- Experimental Claude Code agents can now be enabled from General → Advanced,
  using the installed Claude Code runtime with its own model, effort, permission,
  attachment, context-usage, compaction, tool-detail, and conversation-history
  support.
- Agent workspaces now include a searchable file browser and Command-P quick
  open, while workspace-local files can open safely in the in-app browser.
- Image workspace tabs now support native trackpad pinch-to-zoom around the
  pointer.

### Improvements and fixes

- Long conversations now prefetch older history before reaching the top and
  preserve chronological placement without briefly showing stale content at the
  bottom; restored local Markdown images also render again.
- Git workflow refreshes no longer spend GitHub API quota checking for pull
  requests, and rate-limit failures now report when creation can be retried.
- New Codex conversations retain their workspace classification when opened in
  ChatGPT, plugin skills use friendly plugin-qualified names, and narrow
  tool-call rows truncate cleanly instead of overflowing.

## [0.8.1] - 2026-08-09

### Improvements and fixes

- What’s New now lets you browse notes from every previous Codex Korus release.

## [0.8.0] - 2026-08-09

### New features

- Subagents are now visible from the agent header, with live and completed
  workers grouped in a compact menu and each conversation opening in its own
  workspace tab.

### Improvements and fixes

- Prompts submitted remotely now appear in the conversation without requiring
  a reload.
- File and diff previews, including Review, now scroll horizontally when long
  lines extend beyond the workspace pane.

## [0.7.0] - 2026-08-09

### New features

- Agents and project files can now be opened directly in installed editors,
  Finder, or terminals, with each agent remembering its preferred application.
- Unread agent activity is now visible in the agent list, team rail, and macOS
  Dock badge so completed work and requests are easier to locate.
- Every composer image can now keep its own saved annotation draft, be reopened
  for edits, and submit grouped feedback for multiple images in one prompt.
- Code blocks in conversations now include a dedicated copy action.

### Improvements and fixes

- Image annotation now keeps the in-app browser behind its modal, uses explicit
  Clear, Cancel, and counted Save actions, and supports Command+Enter to save.
- The selected agent now remains active after reconnecting to the backend, and
  the Chrome plugin configuration is restored correctly at startup.
- Unread Dock badges no longer retain stale counts, and Command-number hints
  disappear as soon as a real Command shortcut is used.
- Generated images now use the correct tool presentation and support reliable
  fullscreen viewing and downloads, while pasted images retain their previews.
- Empty completed responses now show a clear fallback, and interrupted or
  restored turns no longer leave tool activity displayed as running forever.

## [0.6.1] - 2026-08-07

### New features

- Codex Korus now shares ChatGPT's installed skills and plugins by default,
  explicitly asks existing installs before migrating their resource folders,
  and provides a General → Advanced setting for fresh or copied isolation.
- The prompt composer now grows with longer messages until twelve lines are
  visible, then scrolls internally.
- Pressing Escape twice within two seconds now interrupts an active response,
  even when the composer does not have focus.

### Improvements and fixes

- Changing skills and plugin sharing now keeps the desktop app open while a
  blocking reconnect screen safely restarts the backend and refreshes
  conversations, resource catalogs, and workspace state.
- Dialogs now use consistent body padding without double-spacing forms,
  including the create and edit forms for teams and agents.
- Computer Use activity now identifies the target app, control, coordinates,
  window, or display, including dedicated presentation for screenshots and
  Screen Recording permission requests.
- Absolute file links outside an agent repository now open as read-only tabs in
  that agent's sidebar workspace.
- Passive Computer Use checks, app discovery, permission requests, and
  screenshots no longer display the blue virtual cursor over the desktop.

## [0.6.0] - 2026-08-06

### New features

- Codex Korus now bundles its local Codex app-server executable, while remote
  agents continue using the Codex installation on their remote host.
- Existing Codex conversations can now be forked into a new agent from the
  agent menu or from a specific user or assistant message.
- Image annotation now lets you mark up a composer image with arrows,
  rectangles, numbered comments, zoom, color inspection, and Retina-aware
  measurements, then send the annotated image and feedback together.
- Appshots capture the frontmost macOS window directly into the active agent
  with a configurable dual-Command, dual-Option, or dual-Shift hotkey and an
  optional confirmation sound.
- Computer Use can now capture a target application window or macOS display as
  an image, with Screen Recording permission surfaced in Settings.
- Clicking an image in a conversation now opens it in a dedicated per-agent
  workspace tab.

### Improvements and fixes

- Execution plans now keep a stable Task list heading and show the model's
  plan-update title as a separate, full-width block below the header.
- Duplicated and forked agents now appear directly below their source agent.
- Conversations now open with less initial history while older turns remain
  available on demand.
- Historical image attachments render previews again, and selected attachments
  stay contained within the composer.
- Web searches now use their own tool presentation, while new SDK tool kinds
  keep their intended identity instead of falling back to a generic tool.
- Message actions are disabled while an agent is busy, controlled composer
  caret movement is preserved, and user-message presentation is more
  consistent.

## [0.5.1] - 2026-08-04

### Improvements and fixes

- Dialog close buttons now sit closer to the top-right corner, and dialogs
  without footers keep their rounded bottom corners.

## [0.5.0] - 2026-08-04

### New features

- Added an in-app What’s New dialog, available from the native Help menu and
  lower-left account menu, with release notes verified during release packaging.

### Improvements and fixes

- Long conversations now load progressively, keep only recent messages mounted
  until you scroll upward, and use less memory across long sessions.
- Large conversations no longer retransmit and redraw their full transcript for
  routine agent selection, prompt, status, or background-state updates.
- Mobile remote access can keep a plugged-in Mac awake, with streamlined
  connection, pairing, and device controls in Settings.
- Added keyboard shortcuts for opening Settings and compacting the active
  agent's context.
- Holding Command now reveals numbered shortcuts for the first nine agents in
  the active team, and Command+1 through Command+9 switches directly to them.
- Inactive agent transcripts now remain warm for 15 minutes before they are
  eligible for eviction.
- Conversations now preserve submitted `/review` commands and open external
  links correctly, while Git status is analyzed when an agent is first shown.
- Restored conversations no longer briefly show a stale execution plan while
  their message history is loading.

## [0.4.0] - 2026-08-03

### New features

- Turn-aware file links now open edit targets in their own diff tabs, while
  read and create targets continue to open source tabs.
- Agent workspaces retain per-turn diff tabs and fall back to the current Git
  review when a link has no usable turn context.
- Added a Plugins settings page with opt-in Computer Use and Chrome controls,
  ChatGPT handoff, and a catalog of common integrations.
- Markdown previews now open as tabs in the right sidebar.
- Chrome availability stays in sync with ChatGPT.
- Execution plans can be dismissed and reopened from the agent header.
- Browser and plan annotations now support voice recording and transcription.

### Improvements and fixes

- Browser annotations now dismiss on outside click and immediately resume
  element selection while annotation mode remains active.
- Plan reviews now support compact inline comments, batch refinement, clear
  confirmation, and a locked review state while a revised plan is generated;
  they now open as agent workspace tabs instead of replacing the sidebar.
- Fixed macOS voice transcription in development builds by resolving the
  bundled Apple Speech helper from the linked SDK assets.

## [0.3.1] - 2026-08-02

### New features

- Added macOS update checks, a Codex Korus menu action, a downloaded-update
  badge, and install-and-relaunch flow.
- Added the signed desktop release publishing workflow and update feed.
- Added live file activity in conversations and clickable file targets for
  reads, edits, and creates.
- Published the Codex Korus landing page with release downloads and product
  documentation.

### Improvements and fixes

- Computer Use MCP tools are hidden until explicitly enabled, while plugin
  settings persist across launches and apply to new and resumed conversations.
- Refined Plugins and Integrations settings cards, banners, spacing, and
  dialog presentation.

- Update checks now run at startup and once per hour in packaged builds.
- Git review now includes untracked files and keeps the change statistics
  visible alongside long filenames.
- File activity no longer opens files unexpectedly; explicit file targets remain
  available from the conversation.
- Preserved conversation workspace context while navigating between agents.
- Refined exploration labels and made right-sidebar resize affordances subtler.

## [0.3.0] - 2026-08-02

### New features

- In-app browser with agent-specific tabs, annotations, and tools that continue
  working while another agent is selected.
- Native macOS Computer Use tools for agents to inspect and operate desktop
  applications.
- Git workspace review, source previews, streamlined agent setup, compact agent
  lists, and a refined native macOS shell.
- ChatGPT authentication, mobile device pairing, Fast mode, and clearer Korus
  tool presentation.
- Per-agent drafts, attachments, queues, model settings, and side-panel state.
- Prompt automation through the `codex-Korus://` deep-link protocol.
- Sender labels and cleaner message bubbles for agent-to-agent collaboration.

### Improvements and fixes

- Made agent switching immediate and kept the interface responsive with several
  agents streaming concurrently.
- Reduced conversation rendering, catalog loading, snapshot processing, and
  long-session memory overhead; inactive transcripts now unload safely after
  five minutes and reload on demand.
- Prevented backend event-stream overload and output-backpressure crashes.
- Stabilized queued and steered prompt submission, attachments, compaction
  state, background-agent selection, and app-server reconnection.
- Preserved live tool calls, drafts, queues, and conversation state across agent
  switches and background activity.
- Fixed GitHub token refresh, device pairing, Fast mode hydration, catalog
  flicker, status clearing, and tool presentation regressions.

## [0.2.0] - 2026-06-18

### New features

- Always-on background agents through the `Korusd` daemon, including automatic
  daemon upgrades when the desktop app is updated.
- SSH connections to remote Korus instances with remote teams, agents, loops,
  and work integrations.
- Conversation history and resume, source and Git diff previews, agent Git
  statistics, and repository worktree selection.
- System permission controls and sleep prevention while agents are working.

### Improvements and fixes

- Made agent and team state survive desktop restarts while background work
  continues in the daemon.
- Improved remote connection recovery, conversation hydration, agent restart
  behavior, and packaged runtime discovery.
- Fixed direct teammate delivery, GitHub authentication in packaged builds,
  snapshot consistency, and scoped file previews.

## [0.1.0] - 2026-06-05

### New features

- Native Codex conversations with streaming messages, tools, approvals,
  questions, plans, goals, context usage, queues, steering, and interruption.
- Teams, multiple agents, Bench templates, agent messaging, avatars, themes,
  settings, keyboard shortcuts, file mentions, skills, and dictation.
- Claude CLI conversations and transcript hydration behind a provider-neutral
  backend contract.
- Cockpit, GitHub backlog connections, work assignments, automation loops,
  Markdown previews, and source worktree creation.

### Improvements and fixes

- Stabilized thread persistence, status updates, tool ordering, user-input
  handling, compaction, message actions, native menus, and packaged Codex paths.
