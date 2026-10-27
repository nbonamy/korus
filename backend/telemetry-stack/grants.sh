#!/bin/sh
set -eu
export PGUSER=telemetry_migrate PGPASSWORD="$(cat /run/secrets/migrate)"
# Ingestion has no DDL, parent deletion, registry update or migration access.
psql -X -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
GRANT SELECT,INSERT,UPDATE ON install_days TO telemetry_ingest;
GRANT SELECT,INSERT,DELETE ON usage_daily TO telemetry_ingest;
GRANT SELECT,INSERT ON installs TO telemetry_ingest;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO telemetry_backup;
GRANT SELECT ON installs,install_days,usage_daily TO telemetry_read;
SQL
