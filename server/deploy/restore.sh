#!/bin/sh
set -eu
# Restore requires an explicit separate DB name; never overwrite live telemetry.
[ -n "${PGDATABASE:-}" ] && [ "${#PGDATABASE}" -le 63 ] || exit 1
case "$PGDATABASE" in telemetry|postgres|template0|template1|*[!a-z0-9_]*|[0-9_]*) exit 1;; esac
case "${1:-}" in ''|*[!a-zA-Z0-9.]*) exit 1;; esac
archive="/backups/$1"
[ -f "$archive" ] || exit 1
export PGUSER=telemetry_migrate PGPASSWORD="$(cat /run/secrets/migrate)"
export PGOPTIONS='-c statement_timeout=300000 -c lock_timeout=3000'
count="$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null)"
[ "$count" = 0 ] || exit 1
# Single transaction: failed/corrupt restores cannot leave a partial snapshot.
timeout 600 pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$PGDATABASE" "$archive" >/dev/null 2>&1
