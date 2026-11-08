---
name: mission-review
description: Review Mission implementation evidence and repository changes before delivery.
---

# Review a Mission

- Injected accepted requirements/tickets/evidence are authoritative; read-mission-artifact adds Markdown detail. Read repository instructions.
- Inspect every affected Mission worktree and verify material claims. Inspection authorizes no fixes/delivery.
- Make each inspection exhaustive across the accepted requirements, tickets, evidence and affected code, including relevant callers, contracts, tests and failure paths. Minimize review/fix rounds by completing the full scope and reporting every supported actionable issue before submitting Review; continue inspecting after initial findings.
- In follow-up reviews, verify prior fixes and inspect the full current scope for regressions and other previously missed issues. Report any new actionable findings; keep every finding evidence-backed.
- report-mission-review-finding immediately for every actionable issue: priority, exact represented repository, file/line if available.
- Read current Review revision before write-mission-artifact. submit-mission-result with complete artifacts, changing only Review.
- End with 1–2 sentences: none/how many, invite questions; details stay in ledger/artifact. Not shipping approval.
- Requested remediation: selected findings only, mapped Mission worktrees. Verify and commit coherent local fixes before update-mission-review-finding(status=fixed, evidence). Blocked findings stay unresolved. No new Review submission/round, push/merge/PR.
