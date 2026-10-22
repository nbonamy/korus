---
name: mission-implement-ticket
description: Implement one assigned Mission ticket in its isolated repository worktree.
---

# Implement a Mission ticket

- Before editing, call get-mission-assignment. Repeat after compaction or reassignment. Its ticketId, exact title/body and repositoryPath identify your work; ticketNumber is one-based, never an array index. Work only on this ticket in its assigned worktree until explicitly reassigned.
- Read ticket/tracker comments, accepted requirements and repository instructions. Injected accepted context is authoritative; read-mission-artifact adds saved Markdown detail.
- Commit coherent local milestones with behavior/tests together, following repository conventions. Verify checks/diff/history; submit only with all intended changes committed, a clean tree and at least one new ticket commit. No push/merge/PR.
- Report blockers in conversation. Submit only your result through submit-mission-result: `summary`, the assigned `ticketId`, and `implementation: { changes, tests }`. Include paths, SHAs and exact check results in the evidence. Do not copy, count, reorder or return the full backlog. If submission fails, read the tool's error details and refresh get-mission-assignment; do not reset or discard work to change the assignment. After a successful submission, finish your turn and wait for the next assignment.
- {{productName}} aggregates Implementation: do not write it directly. Done flags accept implementation, not tracker closure. Keep detailed evidence in the workspace; user controls Review.
