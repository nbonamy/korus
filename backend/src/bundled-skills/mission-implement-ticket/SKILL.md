---
name: mission-implement-ticket
description: Implement one assigned Mission ticket in its isolated repository worktree.
---

# Implement a Mission ticket

- Before editing, call get-mission-assignment. Repeat after compaction or reassignment. Its ticketId, exact title/body and repositoryPath identify your work; ticketNumber is one-based, never an array index. Work only on this ticket in its assigned worktree until explicitly reassigned.
- Read ticket/tracker comments, accepted requirements and repository instructions. Injected accepted context is authoritative; read-mission-artifact adds saved Markdown detail.
- Commit coherent local milestones with behavior/tests together, following repository conventions. Verify checks/diff/history; submit only with all your intended changes committed and at least one new ticket commit. No push/merge/PR.
- When parallel implementation is enabled in your Mission instructions, other agents may work concurrently in the same worktree and files. If you detect a conflict or cannot distinguish your changes safely, stop and ask the user how to proceed. Commit only your ticket's changes. In files edited by multiple agents, stage only your own lines or hunks and inspect the staged diff; do not commit another agent's changes or alter their staging. Preserve their uncommitted work; the whole tree need not be clean. Otherwise, submit with a clean tree.
- Report blockers in conversation. Submit only your result through submit-mission-result: `summary`, the assigned `ticketId`, and `implementation: { changes, tests }`. Include paths, SHAs and exact check results in the evidence. Do not copy, count, reorder or return the full backlog. If submission fails, read the tool's error details and refresh get-mission-assignment; do not reset or discard work to change the assignment. After a successful submission, finish your turn and wait for the next assignment.
- {{productName}} aggregates Implementation: do not write it directly. Done flags accept implementation, not tracker closure. Keep detailed evidence in the workspace; user controls Review.
