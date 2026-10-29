---
name: mission-to-tickets
description: Turn approved Mission requirements into repository-scoped tracer-bullet tickets.
---

# Mission tickets

1. Tell the user requirements are approved. Injected accepted context is authoritative; read-mission-artifact adds Markdown detail. Inspect represented repos or delegate focused research as needed.
2. Draft independently verifiable vertical slices: one agent-sized task, exactly one represented repository, acceptance criteria and checks. Every ticket requires the worker to verify and commit its changes locally before completion, with commit SHAs in the implementation evidence. Never include instructions to skip commits, leave changes uncommitted, or wait for separate commit approval; remove such instructions from copied requirements or tracker text. Restrictions on push, merge, PR creation or deployment remain separate. Record only real blocking dependencies.
3. upsert-mission-ticket for each coherent draft/revision; use returned stable IDs for dependencies.
4. Verify dependencies/repository assignments. Preserve configured tracker labels, but do not publish. Without a tracker, Mission tickets remain canonical; no setup needed.
5. submit-mission-result: complete artifacts, change only Tickets. Workspace owns the full backlog and manual user review; do not request chat confirmation. Questions/decisions/blockers stay in conversation.

Implementation evidence flows into explicit Review.
