---
name: korus-desktop-update
description: Build and install a signed macOS Korus desktop update, restart the installed desktop and its owned daemon, or check the latest guarded replacement.
---

# Desktop Update

Use the bundled [updater](scripts/update.py) for the local installed macOS app and
its owned stdio daemon. Remote hosts and independent daemon services use their
own deployment tools.

From the source checkout, choose one command:

```bash
python3 .agents/skills/korus-desktop-update/scripts/update.py deploy
python3 .agents/skills/korus-desktop-update/scripts/update.py restart
python3 .agents/skills/korus-desktop-update/scripts/update.py status
```

- `deploy` builds, signs, notarizes and smoke-tests the current working tree, then
  stages the replacement. Validate source changes with `korus-dod` first; a clean
  or committed tree is not required. Use `--repo` for another approved checkout.
- `restart` stages an identical copy of the installed app without rebuilding.
- `status` reads the latest transaction's startup checks and rollback outcome.

Use existing restart/deployment authorization and explain the brief mobile
reconnection and possible interruption of active tasks. Discussing the workflow
or reading status does not authorize activation.

The switch delay defaults to **30 seconds**. Once the command returns `armed`,
report activation as pending and finish the provider turn promptly. Independent
one-shot installer and recovery LaunchAgents perform the switch after the turn
ends. After reconnect, check `status`: `complete` confirms startup and pairing;
`rolled_back` means the previous app was restored; `recovery_failed` requires
operator intervention. Exercise the updated feature separately.

Credentials stay in the existing private `.env`/Keychain setup. Transactions,
logs and sensitive profile backups live under `$APP_HOME/desktop-updates` (or the
product's default home), outside Git checkouts. Keep provider history in place and
retain backups until cleanup is requested. Sanitize logs before sharing; process
diagnostics show only PID, PPID and executable names because arguments can contain
credentials. Consult `--help` for explicit path overrides.
