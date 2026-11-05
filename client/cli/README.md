# Korus CLI

Diagnose Korus and get help from a coding agent, even when the desktop app cannot open.

```sh
npx korus-cli@latest doctor
npx korus-cli@latest triage
```

Requires Node.js 26 or newer. Runs independently of Electron and the Korus backend.

- **doctor** checks your installation, saved state and available connections. Each coding client has a section with its version, authentication status and home directory. It is read-only. Optional services and warnings do not cause a failing exit status; errors do. Use `--json` for structured output or `NO_COLOR=1` for plain text.
- **triage** gathers local diagnostics and opens an installed, authenticated client: Claude Code, Codex, then Antigravity. Describe the problem after the command, or use `--agent` to choose a client. Recovery actions require your approval. Use `--no-launch` to prepare diagnostics without opening a client.
- **logs** reads redacted logs; `--follow` streams new entries, including after log rotation. It works in terminals and pipes. Combine `--follow --json` for newline-delimited JSON. Use `--lines` for the initial tail and `--since` or `--agent` to filter entries.
- **support bundle** creates a local diagnostics folder for you to review before sharing. Logs require `--include-logs`. Nothing is uploaded.
- **backend status**, **backend start**, **backend restart**, and **backend stop** inspect or control an installed macOS background service. Changes require confirmation.
- **agents list** and **missions list** inspect live metadata when available and fall back to saved state. Use `--offline` to read saved state directly.

Run `npx korus-cli@latest --help` for all options. To install the `korus` command:

```sh
npm install --global korus-cli
korus doctor
```

Exit codes: `0` for success, empty results or a declined confirmation; `1` for an operational error; `2` for invalid usage or missing non-interactive confirmation; `130` for Ctrl+C; `143` for SIGTERM. Triage forwards the launched client’s exit status.
