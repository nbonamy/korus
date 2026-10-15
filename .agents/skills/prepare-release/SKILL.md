---
name: prepare-release
description: Prepare and launch a Korus release with the latest SDK changes published to npm and consumed by Korus, then audit changes, confirm version/channel, validate, push, and dispatch the GitHub build. Use when asked to prepare or cut a release, including $prepare-release.
---

# Prepare Release

Read the GitHub desktop release section in `docs/backend-architecture.md` for
commands, required environments/secrets, target limitations, and recovery.
The build source is an immutable remote tag. Dependencies
come from published packages and `package-lock.json`, never a live sibling SDK.

## Publish and consume the SDK first

1. Require a clean Korus worktree. Preserve existing changes and stop if dirty.
2. Identify the latest completed `codex-app-sdk` changes intended for this release.
   Compare their source commit with npm's published version and `gitHead`; the
   currently locked version or a working local SDK build is not proof they ship.
   Resolve unfinished or ambiguous SDK scope with Nicolas before proceeding.
3. If those changes are unpublished, release a new SDK version through the SDK
   repository's release workflow and required gates. Coordinate with its active
   owner rather than running a competing release. Obtain SDK publication approval
   if it has not already been given; pause Korus preparation until publication
   is verified. Reuse an existing published version only if it includes all the
   intended changes. Never republish an existing version.
4. Verify every consumed `@codex-app-sdk/*` package is available from npm at the
   selected version, with registry provenance covering the intended SDK commit.
   Install the selected version with normal `npm install --save-exact` commands
   in each consuming workspace, preserving dependencies versus devDependencies.
   For example, `npm install --save-exact @codex-app-sdk/backend@<version>
   @codex-app-sdk/core@<version> -w backend`; use `--save-dev` for core's SDK
   devDependency. Derive the other package/workspace pairs from the manifests.
   Let npm update both manifests and `package-lock.json`; never manually edit,
   delete entries from, or reconstruct the lockfile. Do not substitute manifest
   edits followed by `--package-lock-only` for these dependency installs.
   Use the installed npm directly. If an install fails or leaves old pins,
   diagnose that command instead of patching the lockfile or repeatedly trying
   equivalent installs. Verify the resulting declarations and lock entries once.
   Preserve the local-development opt-in; release dependencies
   must resolve to npm tarballs, not sibling paths, source aliases, or local
   overrides.
5. Record this dependency-only diff for the changelog audit. Keep it uncommitted
   until the Korus version/channel is confirmed; include it in release prep.

## Audit and confirm version and channel

1. Read and execute `../update-changelog/SKILL.md`, passing the recorded SDK
   dependency refresh as its only allowed pre-existing diff. Require audited
   user-visible outcomes, app/SDK baselines, the locked SDK release's Git provenance,
   and an exact semantic-version recommendation. Stop if the audit recommends no release.
2. Present the evidence and recommendation before Korus version edits. An explicit
   user-supplied version can be used after checking it against the audit.
   Otherwise obtain confirmation of the recommended version. Require a plain
   semantic version greater than the current one and an unused Git tag.
3. Confirm the release channel alongside the version: **prerelease** (manual
   downloads, no auto-update) or **latest** (stable, advances auto-update). Use
   an explicitly supplied choice; otherwise ask before preparing. Do not infer
   latest from "release" or "publish".

Nicolas's confirmation of the version and channel is the authorization to
prepare, commit, push, and launch the release. Do not ask a second time. If he
asked for local-only preparation, stop before pushing and hand him the command.

## Freeze and check release metadata locally

Move reviewed Unreleased notes under `## [<version>] - YYYY-MM-DD`. Update
the root and five workspace package versions and internal `@workspace/*`
dependencies together using `apply_patch`. Then run:

```bash
npm install --package-lock-only --ignore-scripts
npm run release-notes:generate
npm run release-notes:check
git diff --check
git status --short
```

The lockfile-only command above refreshes app-version metadata after SDK
installation; npm remains the sole lockfile writer. CI validates the clean
install with the Node/npm versions declared in the release workflow. Only CHANGELOG.md,
the six package manifests, package-lock.json, and
vue/src/generated/release-notes.json may change unless Nicolas explicitly includes
another change in the release commit. When resuming preparation, reuse completed
audit and verification results whose inputs have not changed.

The independent Quality workflow owns lint/typechecks, the full test suite under
coverage, script tests, and the five 85% statement gates against published SDK
packages. It runs on every push and retains coverage reports. Releases run ordinary
workspace and script tests without coverage before builds and publication. The
workflows are independent; Quality failures do not block releases. Do not repeat
CI gates locally during release prep.
Use focused local checks only to investigate a specific failure or when Nicolas
explicitly requests local validation. Keep the release test gate enabled;
a failing release test blocks builds and publication.

Use `korus-dod` and review the staged diff, then commit with
`chore: release prep`. Report the audited SDK version and Git
provenance from the exact npm package, not the sibling HEAD.
Tag creation belongs to the release command, not preparation.

## Push, launch, and hand back

Push the release commit to the default branch and verify its remote SHA. Then run
exactly one command for the confirmed channel:

- Prerelease: `npm run prerelease`
- Stable/latest: `npm run latest`

It requires the clean, pushed default branch, creates the missing remote
`v<version>` tag at HEAD, dispatches one GitHub workflow from that tag (quality →
four platform builds → publish) and watches it. The final job stages the
installers on a draft and publishes the channel. The independent Quality workflow
runs from pushes; the release command does not dispatch it again.

Build and publication take roughly 20 minutes. Run the command in the background,
capture the run ID and URL once dispatch is confirmed, then end the turn so Nicolas
can continue other work. Leave the workflow running; do not occupy the conversation
with polling or wait for publication unless he explicitly asks for monitoring.
On a later request to check progress, inspect that exact run or resume with
`npm run release:watch -- <run-id>`; do not dispatch another build.

On failure, report the failed job and the log excerpt the command printed. Ask
before retrying with `gh run rerun <run-id> --failed`, then resume watching. A
published release is immutable: rebuilt installers cannot replace it, so a fix
after publication means a new version. Never move the version tag.

Only when explicitly asked for build-only validation, use `npm run release:build`;
it dispatches the current pushed branch and never publishes.

Prereleases stay manual-download-only. Latest enables macOS and installed
Windows auto-updates; Linux and portable Windows remain manual. Coordinate the
legacy macOS feed bridge only for an explicitly approved stable cutover.
Native runtime smoke checks do not prove GUI installation, login, or updates;
report outstanding native checks honestly.

## Handoff

Distinguish prepared, committed, pushed, built, draft-staged, native-tested,
published prerelease, and published stable.
At launch, report version/channel, commit/tag, SDK version/provenance, local
metadata checks, and the Actions run URL; clearly state that CI quality checks,
builds, and publication are pending.
After a requested completion check, include the release URL and outstanding native
target checks. Celebrate a completed
publication through `finish_turn`; preparation or staging alone is not publication.
