#!/bin/sh
set -eu
# Runs only on a new volume. Secret values never appear in argv or SQL logs.
export MIGRATE_PASSWORD="$(cat /run/secrets/migrate)"
export INGEST_PASSWORD="$(cat /run/secrets/ingest)"
export BACKUP_PASSWORD="$(cat /run/secrets/backup)"
export READ_PASSWORD="$(cat /run/secrets/read)"
psql -X -v ON_ERROR_STOP=1 --username postgres --dbname telemetry >/dev/null 2>&1 <<'SQL'
\getenv migrate_password MIGRATE_PASSWORD
\getenv ingest_password INGEST_PASSWORD
\getenv backup_password BACKUP_PASSWORD
\getenv read_password READ_PASSWORD
CREATE ROLE telemetry_migrate LOGIN PASSWORD :'migrate_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 4;
CREATE ROLE telemetry_ingest LOGIN PASSWORD :'ingest_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 22;
CREATE ROLE telemetry_backup LOGIN PASSWORD :'backup_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2;
CREATE ROLE telemetry_read LOGIN PASSWORD :'read_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 22;
REVOKE ALL ON DATABASE telemetry FROM PUBLIC;
GRANT CONNECT ON DATABASE telemetry TO telemetry_migrate,telemetry_ingest,telemetry_backup,telemetry_read;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE,CREATE ON SCHEMA public TO telemetry_migrate;
GRANT USAGE ON SCHEMA public TO telemetry_ingest,telemetry_backup,telemetry_read;
ALTER DEFAULT PRIVILEGES FOR ROLE telemetry_migrate IN SCHEMA public GRANT SELECT ON TABLES TO telemetry_backup;
SQL
unset MIGRATE_PASSWORD INGEST_PASSWORD BACKUP_PASSWORD READ_PASSWORD
