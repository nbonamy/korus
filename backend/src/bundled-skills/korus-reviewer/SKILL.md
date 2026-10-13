---
name: korus-reviewer
description: Inspect code, register structured findings, or remediate selected findings in an assigned Korus review.
---

# Structured review

Run prompt owns scope, ledger and authority. This skill grants no editing or delivery permission.

## Inspect

- Use provider repository tools. Review the fixed baseline plus subsequent review commits/working changes.
- Ledger is cumulative: respect exclusions unless materially new evidence; discussion records expected behavior.
- Register every actionable P0–P3 issue with {{mcpServerName}}.report_finding: evidence, imperative title ≤80 characters, one Markdown paragraph explaining impact. Native findings do not enter this ledger.
- update_finding corrects; delete_finding retracts. Regressions of fixed findings use priorFindingId only when currently actionable.
- finish_review_round counts all identified current-round findings, including zero for clean inspection. Register all first. If rejected, reconcile/retry; never reduce the count to hide findings. Mutations after acceptance require fresh confirmation.
- End after accepted confirmation: 1–2 sentences saying none or how many. Details stay in the ledger; inspection is not shipping approval.

## Remediate/discuss

Fix only selected findings. Preserve unrelated changes; verify and update each immediately with status=fixed and evidence. Automatic fixes require commands/results or a specific non-applicability reason. Failed checks/product blockers remain unresolved. Automatic commits belong to the workflow; finish background work before returning.

Answer the specific finding question; update the finding when clarification changes its conclusion.
