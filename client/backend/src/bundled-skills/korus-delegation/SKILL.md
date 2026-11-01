---
name: korus-delegation
description: Create Korus co-agents, manage durable assignments, or turn a Quick Chat into a project. Not needed for messages to existing teammates.
---

# Delegation

Native subagents stay inside this provider session; Korus co-agents are separate teammates. Clarify ambiguity. Delegate only within explicit user/assigned-workflow authority; investigation is not implementation approval.

## Co-agent

- Resolve task/repositories: your folder or list-repos. Call create-agent with a targets array, including for a single repository. Repository work uses shared createWorktree=true and branchName. Optional featureLabel supplies an initial saved display label for that branch group; an existing user label is preserved. Each target supplies repoPath, optional host/name/destination, and its own prompt; omit prompt to prepare an idle agent.
- For another host, use list-hosts for current connection IDs/status, then list-repos with remoteConnectionId. Use the same host ID in the target’s remoteConnectionId; paths belong to that host. Omission keeps your current host. Cross-host conversation context uses a fresh handoff. Teammates share messaging and durable results through the controlling computer; reconnect it before retrying failed collaboration calls.
- Shared selection, startingContext, planMode, goal and instructions are defaults. Targets can override them; selection merges field by field for the same provider. Changing provider uses that provider’s defaults rather than carrying the shared model across engines. Override execution choices only on request.
- Worktree starting context follows the saved preference: native conversation when supported, or fresh handoff. Pass startingContext only for a requested per-task override. Inspect delegationContext in the result; handoff fallback is visible and never a transcript replay. Keep independent reviewers fresh.
- prompt: concise visible task. instructions: missing decisions, acceptance criteria, references and delivery constraints. Link accessible canonical issues/specs; supply inaccessible context. Skip copied repository rules/checklists/conversation. No secrets: instructions remain in the transcript.
- Set planMode=true only when the user explicitly asks the worker to plan first. The first prompt runs in provider Plan mode; the worker produces the interactive plan and waits for user approval before implementation. A plan alone is not a completed implementation assignment. Requires prompt; cannot be combined with goal.
- Set goal=true only when the user explicitly requests goal-driven execution. Codex and Claude run the full assignment and context as a native goal; prompt is required. Keep Claude objectives, including context, within its 4,000-character limit. Task mode retains the same result-reporting procedure. Other backends reject goal mode before creation. Leave both modes off unless explicitly requested.
- Korus supplies saved user delegation instructions and explicit per-task user overrides. User instructions take priority over your assignment brief and guidance; only explicit per-task user directions can override saved defaults. Do not repeat these user directions in instructions. Delegation grants no additional publication or merge authority.
- Approved implementation: start work, commit coherent local milestones with behavior/tests together, report ready for review. Push/merge need separate approval.
- Results are returned per target in input order, including for one target. Successful creations survive another target’s failure. Inspect every result; a failed result with agentId identifies an existing worker to recover instead of recreating. Otherwise check for retained worktrees before retrying only failed targets. Creation never changes the user’s sidebar organization choice.
- Keep the parent open; leave execution to the worker. Delegated workers stay in their folder; further delegation requires explicit user request.

## Durable task

- For tracked assignments, include task.title, task.doneWhen, prompt and a distinct stable requestId inside each target. These fields are unnecessary for idle workspace preparation. Retry the same specification/ID. Startup acceptance is not completion.
- wait-tasks recovers outcomes or waits for any/all. Timeout leaves workers running; cancel-task preserves workspace/history/results.
- Worker: finish foreground/background work, complete-task with summary/evidence/artifacts/caveats, then finish_turn without mutations. Results finalize only when that turn succeeds; delivery is automatic, no extra message/acknowledgment. Completion grants no merge/publication/Mission progression.

## Quick Chat → project

Explicit request only: create-project with one folder name and concise handoff. Creates a project agent without Git initialization; keeps Quick Chat open. New agent owns follow-up.
