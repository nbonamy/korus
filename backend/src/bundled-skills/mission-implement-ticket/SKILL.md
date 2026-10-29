---
name: mission-implement-ticket
description: Implement one assigned Mission ticket in its isolated repository worktree.
---

# Implement a Mission ticket

- Before editing, call get-mission-assignment. Repeat after compaction or reassignment. Its ticketId, exact title/body and repositoryPath identify your work; ticketNumber is one-based, never an array index. Work only on this ticket in its assigned worktree until explicitly reassigned.
- Read ticket/tracker comments, accepted requirements and repository instructions. Injected accepted context is authoritative; read-mission-artifact adds saved Markdown detail.
- This Mission assignment authorizes and requires local commits for every ticket, even if the ticket body or tracker comments say not to commit or to wait for commit approval. Commit coherent local milestones with behavior/tests together, following repository conventions. Verify checks/diff/history; submit only with all your intended changes committed and at least one new ticket commit. If you cannot commit safely, report a blocker and do not submit completion. No push/merge/PR.
- When parallel implementation is enabled, call acquire-mission-commit-lock before any Git index mutation and wait for it to succeed. Keep the lock until staging, staged-diff inspection and commit are complete, then call release-mission-commit-lock. Inspect existing staging first; if it cannot be safely attributed, release the lock and ask the user. If a conflict or mixed changes cannot be distinguished safely, stop and ask. Commit only your ticket's lines or hunks; never alter or commit another agent's staging. Preserve their uncommitted work; the whole tree need not be clean. The lock coordinates participating workers, not external Git processes or file edits. Otherwise, submit with a clean tree.
- Report blockers in conversation. Submit only your result through submit-mission-result: `summary`, the assigned `ticketId`, and `implementation: { changes, tests }`. Include paths, SHAs and exact check results in the evidence. Do not copy, count, reorder or return the full backlog. If submission fails, read the tool's error details and refresh get-mission-assignment; do not reset or discard work to change the assignment. After a successful submission, finish your turn and wait for the next assignment.
- {{productName}} aggregates Implementation: do not write it directly. Done flags accept implementation, not tracker closure. Keep detailed evidence in the workspace; user controls Review.
