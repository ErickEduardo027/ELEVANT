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

latest_backup="$(find "$backup_dir" -regextype posix-extended -maxdepth 1 -type f \
  -regex '.*/ElevantDevelopmentDb_[0-9]{8}T[0-9]{15}Z_[0-9a-f]{12}\.bak' \
  -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
if [[ ! "$latest_backup" =~ ^/var/opt/mssql/backups/ElevantDevelopmentDb_[0-9]{8}T[0-9]{15}Z_[0-9a-f]{12}\.bak$ ]]; then
  echo "No valid Development backup was found." >&2
  exit 1
fi
restore_check_token="$(tr -d '-' </proc/sys/kernel/random/uuid | cut -c1-12)"
if [[ ! "$restore_check_token" =~ ^[0-9a-f]{12}$ ]]; then
  echo "Could not generate a safe restore-check token." >&2
  exit 1
fi

SQLCMDPASSWORD="${ELEVANT_DB_DBA_PASSWORD}" \
  "$sqlcmd_path" -S "$server" -U elevant_dev_dba -C -b \
  -v "BACKUP_FILE=$latest_backup" "RESTORE_CHECK_TOKEN=$restore_check_token" \
  -i /opt/elevant-db-ops/sql/restore-check-development.sql
