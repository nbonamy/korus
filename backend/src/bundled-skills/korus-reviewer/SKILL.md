---
name: korus-reviewer
description: Inspect code, register structured findings, or remediate selected findings in an assigned Korus review.
---

# Structured review

Run prompt owns scope, ledger and authority. This skill grants no editing or delivery permission.

## Tool contracts

If tools are deferred or lack input schemas, load them with ToolSearch or your provider's tool discovery before calling them. Use the Korus MCP finding tools in this round. Native ReportFindings uses a different schema and does not save findings to the Korus ledger; summary, failure_scenario, category and verdict are not report_finding fields.

- report_finding requires priority (p0–p3 or P0–P3), an imperative title of at most 80 characters, and body with evidence and impact. Optional file is repository-relative; line/endLine are positive one-based integers. Example: `{"priority":"p2","title":"Validate ownership before writing","body":"An unowned request can write files.","file":"src/handler.ts","line":42}`.
- update_finding requires findingId. For a verified fix use `{"findingId":"<ledger ID>","status":"fixed","evidence":"npm test: 12 tests passed."}`. Corrections may set priority, title, body, file, line and endLine under the same constraints. Unknown keys, including outcome and note, are rejected.
- finish_review_round takes the total saved current-round findingCount. Example for a clean inspection: `{"findingCount":0}`.

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
