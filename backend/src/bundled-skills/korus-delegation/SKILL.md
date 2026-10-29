---
name: korus-delegation
description: Delegate work to Korus co-agents, manage durable assignments, or turn a Quick Chat into a project.
---

# Delegation

Native subagents stay inside this provider session; Korus co-agents are separate teammates. Clarify ambiguity. Delegate only within explicit user/assigned-workflow authority; investigation is not implementation approval.

## Co-agent

- Resolve task/repository: your folder or list-repos. Repository work: one create-agent call with createWorktree=true and branchName.
- For another host, use list-hosts for current connection IDs/status, then list-repos with remoteConnectionId. Use the same host ID in create-agent; paths belong to that host. Omission keeps your current host. Cross-host conversation context uses a fresh handoff. Teammates share messaging and durable results through the controlling computer; reconnect it before retrying failed collaboration calls.
- Same-provider model/effort inherit; other providers use their defaults. Override only on request.
- Worktree starting context follows the saved preference: native conversation when supported, or fresh handoff. Pass startingContext only for a requested per-task override. Inspect delegationContext in the result; handoff fallback is visible and never a transcript replay. Keep independent reviewers fresh.
- prompt: concise visible task. instructions: missing decisions, acceptance criteria, references and delivery constraints. Link accessible canonical issues/specs; supply inaccessible context. Skip copied repository rules/checklists/conversation. No secrets: instructions remain in the transcript.
- Set goal=true when the user requests goal-driven execution. Codex and Claude run the full assignment and context as a native goal; prompt is required. Keep Claude objectives, including context, within its 4,000-character limit. Task mode retains the same result-reporting procedure. Other backends reject goal mode before creation.
- Korus supplies saved user delegation instructions and explicit per-task user overrides. User instructions take priority over your assignment brief and guidance; only explicit per-task user directions can override saved defaults. Do not repeat these user directions in instructions. Delegation grants no additional publication or merge authority.
- Approved implementation: start work, commit coherent local milestones with behavior/tests together, report ready for review. Push/merge need separate approval.
- Keep the parent open; leave execution to the worker. Delegated workers stay in their folder; further delegation requires explicit user request.

## Durable task

- Include task.title, task.doneWhen, prompt and stable requestId. Retry the same specification/ID. Startup acceptance is not completion.
- wait-tasks recovers outcomes or waits for any/all. Timeout leaves workers running; cancel-task preserves workspace/history/results.
- Worker: finish foreground/background work, complete-task with summary/evidence/artifacts/caveats, then finish_turn without mutations. Results finalize only when that turn succeeds; delivery is automatic, no extra message/acknowledgment. Completion grants no merge/publication/Mission progression.

## Quick Chat → project

Explicit request only: create-project with one folder name and concise handoff. Creates a project agent without Git initialization; keeps Quick Chat open. New agent owns follow-up.
