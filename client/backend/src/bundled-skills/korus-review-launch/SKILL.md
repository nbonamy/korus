---
name: korus-review-launch
description: Launch an explicitly requested automatic review and hand off the reviewed files.
---

# Automatic review

- Requires an explicit automatic-review request, not generic review/finish/ship or readiness.
- Resolve uncommitted vs branch scope/baseRef. Same-provider model/effort inherit; another provider uses its defaults. Overrides require user request; an explicit model without effort uses its default.
- Local commits require explicit approval even if saved settings enable them. autoCommit=true includes reviewed working changes and fixes; never authorizes push/merge.
- Once accepted, stop editing reviewed files and report startup, not completion. Reports arrive automatically; no relaunch-to-poll or nested review. A paused report is not shipping approval.
