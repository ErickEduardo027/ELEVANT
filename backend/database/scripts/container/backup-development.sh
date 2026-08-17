#!/usr/bin/env bash
set -Eeuo pipefail

backup_dir="/var/opt/mssql/backups"
database_name="ElevantDevelopmentDb"
server="${ELEVANT_SQL_SERVER:-elevant-dev-sql}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_dir}/${database_name}_${timestamp}.bak"
sqlcmd_path="/opt/mssql-tools18/bin/sqlcmd"

if [[ ! -x "$sqlcmd_path" ]]; then
  sqlcmd_path="/opt/mssql-tools/bin/sqlcmd"
fi
if [[ -z "${ELEVANT_DB_BACKUP_PASSWORD:-}" || -z "${ELEVANT_DB_DBA_PASSWORD:-}" ]]; then
  echo "ELEVANT_DB_BACKUP_PASSWORD and ELEVANT_DB_DBA_PASSWORD are required." >&2
  exit 1
fi

"$sqlcmd_path" -S "$server" -U elevant_dev_backup -P "$ELEVANT_DB_BACKUP_PASSWORD" -C -b \
  -v "BACKUP_FILE=$backup_file" \
  -i /opt/elevant-db-ops/sql/backup-development.sql

"$sqlcmd_path" -S "$server" -U elevant_dev_dba -P "$ELEVANT_DB_DBA_PASSWORD" -C -b \
  -Q "RESTORE VERIFYONLY FROM DISK = N'$backup_file' WITH CHECKSUM;"

mapfile -t backups < <(find "$backup_dir" -maxdepth 1 -type f -name "${database_name}_*.bak" -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
if (( ${#backups[@]} > 7 )); then
  for obsolete in "${backups[@]:7}"; do
    if [[ "$obsolete" == "$backup_dir/${database_name}_"*.bak ]]; then
      rm -f -- "$obsolete"
    fi
  done
fi
