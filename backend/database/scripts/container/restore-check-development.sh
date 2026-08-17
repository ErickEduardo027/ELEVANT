#!/usr/bin/env bash
set -Eeuo pipefail

backup_dir="/var/opt/mssql/backups"
server="${ELEVANT_SQL_SERVER:-elevant-dev-sql}"
sqlcmd_path="/opt/mssql-tools18/bin/sqlcmd"
if [[ ! -x "$sqlcmd_path" ]]; then
  sqlcmd_path="/opt/mssql-tools/bin/sqlcmd"
fi
if [[ -z "${ELEVANT_DB_DBA_PASSWORD:-}" ]]; then
  echo "ELEVANT_DB_DBA_PASSWORD is required." >&2
  exit 1
fi

latest_backup="$(find "$backup_dir" -maxdepth 1 -type f -name 'ElevantDevelopmentDb_*.bak' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
if [[ -z "$latest_backup" || "$latest_backup" != "$backup_dir/ElevantDevelopmentDb_"*.bak ]]; then
  echo "No valid Development backup was found." >&2
  exit 1
fi

"$sqlcmd_path" -S "$server" -U elevant_dev_dba -P "$ELEVANT_DB_DBA_PASSWORD" -C -b \
  -v "BACKUP_FILE=$latest_backup" \
  -i /opt/elevant-db-ops/sql/restore-check-development.sql
