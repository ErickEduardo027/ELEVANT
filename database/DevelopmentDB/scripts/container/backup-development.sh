#!/usr/bin/env bash
set -Eeuo pipefail

backup_dir="/var/opt/mssql/backups"
database_name="ElevantDevelopmentDb"
server="${ELEVANT_SQL_SERVER:-elevant-dev-sql}"
timestamp="$(date -u +%Y%m%dT%H%M%S%NZ)_$(tr -d '-' </proc/sys/kernel/random/uuid | cut -c1-12)"
backup_file="${backup_dir}/${database_name}_${timestamp}.bak"
working_file="${backup_file}.partial"
sqlcmd_path="/opt/mssql-tools18/bin/sqlcmd"

if [[ ! -x "$sqlcmd_path" ]]; then
  sqlcmd_path="/opt/mssql-tools/bin/sqlcmd"
fi
if [[ -z "${ELEVANT_DB_BACKUP_PASSWORD:-}" || -z "${ELEVANT_DB_DBA_PASSWORD:-}" ]]; then
  echo "ELEVANT_DB_BACKUP_PASSWORD and ELEVANT_DB_DBA_PASSWORD are required." >&2
  exit 1
fi
if [[ -e "$backup_file" || -e "$working_file" ]]; then
  echo "Refusing to overwrite an existing Development backup path." >&2
  exit 1
fi
trap 'rm -f -- "$working_file"' EXIT

SQLCMDPASSWORD="${ELEVANT_DB_BACKUP_PASSWORD}" \
  "$sqlcmd_path" -S "$server" -U elevant_dev_backup -C -b \
  -v "BACKUP_FILE=$working_file" \
  -i /opt/elevant-db-ops/sql/backup-development.sql

SQLCMDPASSWORD="${ELEVANT_DB_DBA_PASSWORD}" \
  "$sqlcmd_path" -S "$server" -U elevant_dev_dba -C -b \
  -Q "RESTORE VERIFYONLY FROM DISK = N'$working_file' WITH CHECKSUM;"

mv -- "$working_file" "$backup_file"
trap - EXIT

mapfile -t backups < <(find "$backup_dir" -regextype posix-extended -maxdepth 1 -type f \
  -regex ".*/${database_name}_[0-9]{8}T[0-9]{15}Z_[0-9a-f]{12}\\.bak" \
  -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
if (( ${#backups[@]} > 7 )); then
  for obsolete in "${backups[@]:7}"; do
    if [[ "$obsolete" == "$backup_dir/${database_name}_"*.bak ]]; then
      rm -f -- "$obsolete"
    fi
  done
fi
