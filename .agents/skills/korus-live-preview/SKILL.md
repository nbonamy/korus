---
name: korus-live-preview
description: Use when interactively dogfooding Korus from a worktree, with isolated Electron state, realistic fixtures, reload persistence, or branch-local backend changes.
---

# Korus Live Preview

Run the current worktree's real Electron renderer and daemon with isolated app
state. Use representative domain data and meaningful edge states. Automated tests
remain a separate gate from interactive product evaluation.

## Prepare the preview

1. Read `docs/testing.md` and, for visible UI, `docs/frontend.md`.
2. Inspect the worktree and choose the workflow states to exercise. Seeds must
   match current app-owned schemas.
3. Create a uniquely named temporary home outside the repository. Put the seed at
   `<preview-home>/state.json` (migrated on first start) or write `roster.json` and
   `settings.json` directly. Never use the user's normal Korus home.
4. For provider-dependent workflows, copy only the normal installation's
   `codex-home/auth.json` into the isolated home's `codex-home/auth.json` with
   restrictive permissions. Never read or print its contents. Otherwise let the
   user authenticate in the isolated preview.
5. Build the daemon with `npm run build:backend`, then start Electron in a
   persistent exec session using the pinned runtime below. Pass
   `--user-data-dir=<preview-home>/electron` to isolate Chromium state as well as
   backend state. Shared UI lives in `client/vue`.

The preview home contains synthetic state and may contain credentials. Keep it
out of Git and remove it after the session. Record the home, worktree and owned
process/session IDs together; cleanup must target only those resources.

## Pin the runtime

Inherited `APP_BACKEND_COMMAND`, `APP_BACKEND_ARGS`, `APP_BACKEND_SOCKET` and
`APP_BACKEND_MODE` can select another installation or daemon. The root dev command
pins the built backend executable and arguments. For an isolated preview, use:

```bash
APP_HOME=<preview-home> \
APP_BACKEND_MODE=bundled \
APP_BACKEND_SOCKET=<preview-home>/daemon.sock \
APP_BACKEND_COMMAND=<absolute-node-path> \
APP_BACKEND_ARGS=<absolute-worktree>/client/backend/dist/daemon.mjs,--stdio \
APP_BACKEND_WATCH_FILE= \
npm run start:electron -- --user-data-dir=<preview-home>/electron
```

Root `npm run dev` remains the normal Electron development command.
Choose installed SDK packages by default (`CODEX_APP_SDK_SOURCE=0`); use source
linking only when explicitly testing SDK source integration.

For a repeatable automated Design workflow, run:

```bash
npm run build:backend
node scripts/verify-design-workspace.mjs <evidence-directory>
```

This launches its own Electron shell and daemon, exercises authored designs,
writes a check report and screenshots, and cleans up its temporary home. `--live`
also submits a real provider brief and consumes provider usage.

Browser component fixtures in `client/vue/src/components/__tests__/fixtures/`
remain useful for isolated DOM and layout checks. They do not prove desktop
preload, daemon, native behavior or provider integration.

## Drive the real shell

Use the `korus-computer-use` procedure and Korus Computer Use tools for interactive
macOS control. Confirm the window belongs to the isolated profile before acting.
For automated runtime checks, follow the existing Electron smoke workflows with
Playwright. Allocate any CDP/Vite port through port `0`, bind it to loopback, and
retry allocation after `EADDRINUSE`; never stop another agent's server.

Navigate through the actual feature entry point. Confirm the seeded state is
visible, exercise meaningful transitions, and reload when persistence matters.
If state is missing, check seed validity, the owning daemon snapshot, executable
provenance, then renderer adoption. Fix failures at their owning boundary.
Keep subjective product evaluation with the user and state what is synthetic.

## Close the session

Stop only this preview's owned processes. Validate the exact temporary home path
before removing it, including copied authentication. Confirm Git contains no
preview state, credentials, build noise or generated screenshots. Report automated
gates separately from interactive and native evidence.
