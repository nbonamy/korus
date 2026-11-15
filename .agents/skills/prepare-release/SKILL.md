---
name: prepare-release
description: Prepare and launch a Korus release with the latest SDK changes published to npm and consumed by Korus, then audit changes, confirm version/channel, validate, push, and dispatch the GitHub build. Use when asked to prepare or cut a release, including $prepare-release.
---

# Prepare Release

Read the GitHub desktop release section in `docs/backend-architecture.md` for
commands, required environments/secrets, target limitations, and recovery.
The build source is an immutable remote tag. Dependencies
come from published packages and `package-lock.json`, never a live sibling SDK.

## Desktop release scope

Inspect the starting worktree and distinguish desktop release inputs from unrelated
work. Uncommitted server, website, mobile and engineering-documentation changes
are warning-only: explain that they are excluded from the release tag and continue
without requiring their owner to commit, or asking for confirmation. Preserve
their files and staging state; do not stash, discard or absorb them.

Require desktop source, shared runtime contracts, native desktop resources, root
dependency/lock files and build/release tooling to be committed before dispatch.
Classify shared files by their actual consumers; a console-only contract is not a
desktop input merely because it lives in `core`. Unknown/shared changes need a
targeted dependency check, not a blanket clean-worktree rule. The release command
recognizes the known independent areas and defaults other paths to desktop scope.

If a release metadata file also contains another owner's edits, stage only the
reviewed release hunks or coordinate that overlapping file. Independent work may
continue during preparation. Coordinate real server compatibility dependencies
when a desktop change needs them; unrelated dirty server files alone are not a
deployment dependency. Builds use the pushed commit, never the local dirty files.

## Publish and consume required SDK releases first

The release dependency chain is:

`@korus-dev/codex-sdk` → `@korus-dev/multi-agent-sdk` →
`@korus-dev/agent-ui-sdk` → Korus.

The chain determines dependency order, not a mandatory publication cascade.
Publish an SDK only to ship its own changes or change its published dependency
contract. Inspect the **published package's** `dependencies` and
`peerDependencies`, not only the sibling checkout's version or devDependencies:

- A downstream SDK with an exact runtime dependency needs a release to adopt a
  different upstream version.
- An unchanged downstream SDK whose peer range accepts the new upstream version
  can keep its existing published release. A devDependency pin records what its
  checkout builds/tests against; changing that pin alone does not require an npm
  release. Do not narrow a compatible peer range just to force a cascade.
- Downstream code changes or a peer range that excludes the selected upstream
  version require a downstream release, after validation against that version.

For example, Multi 0.28.2 can be consumed with existing UI 0.27.4 because UI's
published peer range `^0.27.1 || ^0.28.0` accepts it. Publish Multi, update Korus's
exact Multi pin, and retain UI 0.27.4. A Codex change requires a Multi release
when Multi must update its exact Codex dependency; assess UI's peer compatibility
separately. Each repository has its own version; never assume SDK versions match.

1. Apply the desktop release scope above. Record unrelated changes and warn;
   resolve uncommitted desktop inputs before preparing release metadata.
2. Identify the intended changes in `codex-sdk`, `multi-agent-sdk` and
   `agent-ui-sdk`. Compare each source commit with npm's published version and
   `gitHead`; when npm omits `gitHead`, use the published package's npm provenance
   attestation, matching its package digest and source commit. A local version,
   Git tag, successful publish workflow or working build is not proof the package
   is installable from npm. Documentation/tooling-only commits do not require an
   SDK release for Korus. Determine which SDKs actually need publication from
   their shipped changes and published dependency contracts. Reuse compatible
   published peers. Resolve unfinished or ambiguous scope with Nicolas first.
3. Obtain approval for any SDK publication not already authorized. Coordinate
   with each repository's active owner rather than running competing releases.
   Publish only required releases, in dependency order, using each repository's
   required gates. For a downstream release, install the published upstream
   version with an exact normal npm pin in the appropriate dependency section,
   preserving compatible peer ranges, and validate before publishing. For a
   reused peer-compatible release, validate the selected installed combination
   through the existing release checks; do not bump or publish that SDK just to
   refresh its devDependency. Verify registry availability and commit provenance
   before using a new version; npm processing may continue after a successful
   workflow. Never republish an existing version.
4. Verify all three selected `@korus-dev` SDK versions are available from npm,
   cover the intended changes, and have compatible published runtime dependency
   and peer constraints. Unchanged compatible SDK versions may remain selected.
   Install the selected versions in every consuming Korus workspace using normal
   `npm install --save-exact` commands, preserving dependencies versus
   devDependencies (`--save-dev` for core's SDK devDependencies). Derive the
   package/workspace pairs from the manifests. Let npm update both manifests and
   `package-lock.json`; never manually edit, delete entries from, or reconstruct
   the lockfile. Do not substitute manifest edits followed by
   `--package-lock-only` for these dependency installs. If an install fails or
   leaves old pins, diagnose that command rather than patching the lockfile or
   repeatedly trying equivalent installs.
5. Verify the installed dependency tree and lock entries, including transitive
   Codex SDK resolution, once. Release inputs must resolve to published npm
   tarballs, never sibling paths, local tarball candidates, source aliases or
   overrides. Preserve the local-development opt-in separately. Record each SDK
   version and Git provenance and the dependency-only diff for the changelog
   audit. Keep the Korus diff uncommitted until its version/channel is confirmed.

## Audit and confirm version and channel

1. Read and execute `../update-changelog/SKILL.md`, passing the recorded SDK
   dependency refresh, release commits and npm provenance for all three SDK
   repositories, and the unrelated paths excluded by the desktop scope. Audit
   the independent SDK repositories, not the legacy monorepo. Require audited
   user-visible outcomes, app/SDK baselines, the locked SDK releases' Git provenance,
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
the root and declared workspace package versions and internal `@workspace/*`
dependencies together using `apply_patch`. Preserve the independently released
`client/cli` package version; update its internal core dependency with the desktop. Then run:

```bash
npm install --package-lock-only --ignore-scripts
npm run release-notes:generate
npm run release-notes:check
git diff --check
git status --short
```

The lockfile-only command above refreshes app-version metadata after SDK
installation; npm remains the sole lockfile writer. CI validates the clean
install with the Node/npm versions declared in the release workflow. Preparation
edits only CHANGELOG.md, the root and declared workspace package manifests,
package-lock.json, and client/vue/src/generated/release-notes.json unless Nicolas
explicitly includes another change in the release commit. Unrelated dirty files
may remain and must not enter that commit. When resuming preparation, reuse completed
audit and verification results whose inputs have not changed.

The independent Quality workflow owns lint/typechecks, the full test suite under
coverage, script tests, and every workspace's 85% statement gate against published SDK
packages. It runs on branch pushes, PRs and manual dispatch, excluding tag pushes,
and retains coverage reports. Releases run ordinary workspace and script tests
without coverage before builds and publication. The
workflows are independent; Quality failures do not block releases. Do not repeat
CI gates locally during release prep.
Use focused local checks only to investigate a specific failure or when Nicolas
explicitly requests local validation. Keep the release test gate enabled;
a failing release test blocks builds and publication.

Use `korus-dod` and review the staged diff, then commit with
`chore: release prep`. Report the audited SDK versions and Git
provenance from the exact npm package, not the sibling HEAD.
Tag creation belongs to the release command, not preparation.

## Push, launch, and hand back

Push the release commit to the default branch and verify its remote SHA. Then run
exactly one command for the confirmed channel:

- Prerelease: `npm run prerelease`
- Stable/latest: `npm run latest`

It requires committed desktop inputs on the pushed default branch, warns about
unrelated uncommitted work, creates the missing remote
`v<version>` tag at HEAD, dispatches one GitHub workflow from that tag (quality →
four platform builds → publish) and watches it. The final job stages the
installers on a draft and publishes the channel. The independent Quality workflow
runs from branch pushes; the release command does not dispatch it again.

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
At launch, report version/channel, commit/tag, SDK versions/provenance, local
metadata checks, and the Actions run URL; clearly state that CI quality checks,
builds, and publication are pending.
After a requested completion check, include the release URL and outstanding native
target checks. Celebrate a completed
publication through `finish_turn`; preparation or staging alone is not publication.
