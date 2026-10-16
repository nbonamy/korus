---
name: korus-dod
description: Use before handoff, commit, push, or declaring Korus work ready. Verify scope, tests, typecheck/lint, documentation, and worktree hygiene with proportional evidence.
---

# Korus Definition Of Done

Gather the smallest evidence that proves the change is ready. Add broader gates
only when the change crosses a boundary.

## Inspect

```bash
git status --short
git diff --check
```

Review the diff against the latest request. Account for every changed file and
preserve unrelated user changes.

## Verify

Run every applicable row. For release-only metadata and dependency preparation,
use the release row instead of the implementation rows:

| Change | Evidence |
| --- | --- |
| Docs/config only | `git diff --check` |
| Scoped code | Focused workspace test and affected workspace typecheck |
| Visible frontend | Scoped-code gates plus one targeted runtime, DOM, or screenshot check |
| Imports, exports, dependencies, CSS, or shared config | Relevant lint command |
| Cross-cutting | `npm run test:ai` and affected workspace typechecks |
| Coverage-sensitive | Focused coverage; use `npm run test:coverage` only when repository-wide evidence is needed |
| Release | Local metadata checks from `prepare-release`; release CI gates ordinary tests independently of Quality coverage. Report CI as pending at dispatch, not locally validated. |

The coverage gate is exactly 85% statements in every workspace, including
Electron. Lines, branches, and functions remain reported diagnostics. Meaningful
behavioral/regression tests and owning-boundary verification remain mandatory;
a coverage percentage alone is not proof of correctness.

Use package-local Vitest for focused tests:

```bash
npm run test -w <affected-workspace> -- <focused-file-or-pattern>
```

A passing gate remains valid until relevant inputs change. Stop rather than
commit or push when a required gate fails. Builds, packaging, signing, and
notarization belong to release workflows.

## Decide Documentation

Report either **Docs updated** when durable architecture, process, convention,
contract, or operator guidance changed, or **Docs not needed** when tests fully
specify a local behavior change. Update `CHANGELOG.md` only through an explicit
`update-changelog` or `prepare-release` flow.

## Audit And Report

Review the final diff and, when committing, the staged diff. Confirm it contains
only intended files, tests cover changed behavior, and no secrets, local data,
generated noise, or accidental changelog edits are included.

```text
DoD
- Scope: <change and boundary>
- Tests: <command and result>
- Typecheck/lint: <result or not applicable>
- Visual: <result or not applicable>
- Docs: <updated and why, or not needed>
- Worktree: <intended files only, or unrelated files preserved>
```
