#!/usr/bin/env bash
set -Eeuo pipefail

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
normalized_dba_password="${ELEVANT_DB_DBA_PASSWORD^^}"
if [[ "$normalized_dba_password" == REPLACE_* ||
      "$normalized_dba_password" == PLACEHOLDER_* ||
      "$normalized_dba_password" == CHANGE_ME* ||
      "$normalized_dba_password" == CHANGEME* ]]; then
  echo "ELEVANT_DB_DBA_PASSWORD must replace the documented placeholder." >&2
  exit 1
fi

server="${ELEVANT_SQL_SERVER:-elevant-dev-sql}"
dba_password="$ELEVANT_DB_DBA_PASSWORD"
export -n ELEVANT_DB_DBA_PASSWORD normalized_dba_password server dba_password

SQLCMDPASSWORD="$dba_password" \
  "$sqlcmd_path" \
    -S "$server" \
    -U elevant_dev_dba \
    -d ElevantDevelopmentDb \
    -C -b -r 1 \
    -i /opt/elevant-db-ops/sql/install-development-diagram-support.sql
