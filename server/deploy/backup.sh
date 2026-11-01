#!/bin/sh
set -eu
umask 077
export PGUSER=telemetry_backup PGPASSWORD="$(cat /run/secrets/backup)"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-3}"
# Both connection and query deadlines bound stalled databases; no SQL/body logs.
export PGOPTIONS='-c statement_timeout=300000 -c lock_timeout=3000'
rotate() {
  now="${1:-$(date -u +%s)}"
  case "$now" in ''|*[!0-9]*) return 1;; esac
  cutoff=$((now-604800))
  for archive in /backups/*.dump /backups/*.partial.*; do
    [ -f "$archive" ] || continue
    epoch="${archive##*/}"; epoch="${epoch%%.*}"
    case "$epoch" in ''|*[!0-9]*) continue;; esac
    # Expire at seven days, including incomplete files left by a killed dump.
    if [ "$epoch" -le "$cutoff" ]; then rm -f "$archive" || return 1; fi
  done
  printf '%s\n' "$now" > /tmp/rotation-status
}
once() {
  rotate || return 1
  stamp="$(date -u +%s)"
  partial="$(mktemp "/backups/$stamp.partial.XXXXXX")"
  trap 'rm -f "$partial"' EXIT
  trap 'exit 1' HUP INT TERM
  if ! timeout 600 pg_dump --format=custom --no-owner --no-acl --file="$partial" >/dev/null 2>&1; then
    rm -f "$partial"
    return 1
  fi
  mv "$partial" "/backups/$stamp.${partial##*.}.dump" || return 1
  trap - EXIT HUP INT TERM
  printf '%s\n' "$stamp" > /tmp/backup-status
}
case "${1:-}" in
  rotate) rotate "${2:-}" ;;
  once) once ;;
  check)
    now="$(date -u +%s)"
    [ $((now-$(cat /tmp/rotation-status))) -lt 7200 ] && [ $((now-$(cat /tmp/backup-status))) -lt 93600 ] ;;
  loop)
    # Immediate backup at process start, daily thereafter; expiry runs hourly even
    # during database outages. Health, rather than logs, reports a stale backup.
    while :; do
      rotate
      now="$(date -u +%s)"
      last=0
      [ ! -f /tmp/backup-status ] || last="$(cat /tmp/backup-status)"
      if [ $((now-last)) -ge 86400 ]; then once || true; fi
      sleep 3600 & wait $!
    done ;;
  *) exit 1 ;;
esac
