#!/usr/bin/env bash
set -Eeuo pipefail

database_name="ElevantDevelopmentDb"
server="${ELEVANT_SQL_SERVER:-elevant-dev-sql}"
sqlcmd_path="/opt/mssql-tools18/bin/sqlcmd"

if [[ ! -x "$sqlcmd_path" ]]; then
  sqlcmd_path="/opt/mssql-tools/bin/sqlcmd"
fi
if [[ ! -x "$sqlcmd_path" ]]; then
  echo "sqlcmd is not available in the approved SQL operations image." >&2
  exit 1
fi
if [[ -z "${ELEVANT_DB_DBA_PASSWORD:-}" ]]; then
  echo "ELEVANT_DB_DBA_PASSWORD is required." >&2
  exit 1
fi

exec "$sqlcmd_path" \
  -S "$server" \
  -d "$database_name" \
  -U elevant_dev_dba \
  -P "$ELEVANT_DB_DBA_PASSWORD" \
  -C -b -r 1 -l 15 \
  -i /opt/elevant-db-ops/sql/verify-development.sql
