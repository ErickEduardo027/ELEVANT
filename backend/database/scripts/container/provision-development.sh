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

required=(
  MSSQL_SA_PASSWORD
  ELEVANT_DB_DBA_PASSWORD
  ELEVANT_DB_MIGRATOR_PASSWORD
  ELEVANT_DB_APP_PASSWORD
  ELEVANT_DB_SEEDER_PASSWORD
  ELEVANT_DB_HEALTH_PASSWORD
  ELEVANT_DB_BACKUP_PASSWORD
)

for variable_name in "${required[@]}"; do
  value="${!variable_name:-}"
  if [[ -z "$value" ]]; then
    echo "$variable_name is required." >&2
    exit 1
  fi
  if [[ ! "$value" =~ ^[A-Za-z0-9!@#%_+=:.,?-]{16,128}$ ]]; then
    echo "$variable_name must be 16-128 characters from the documented safe character set." >&2
    exit 1
  fi
done

server="${ELEVANT_SQL_SERVER:-elevant-dev-sql}"
login="elevant_dev_dba"
password="$ELEVANT_DB_DBA_PASSWORD"

for attempt in $(seq 1 60); do
  if "$sqlcmd_path" -S "$server" -U "$login" -P "$password" -C -b -Q "SELECT 1" -o /dev/null 2>/dev/null; then
    break
  fi

  login="sa"
  password="$MSSQL_SA_PASSWORD"
  if "$sqlcmd_path" -S "$server" -U "$login" -P "$password" -C -b -Q "SELECT 1" -o /dev/null 2>/dev/null; then
    break
  fi

  if [[ "$attempt" == "60" ]]; then
    echo "SQL Server did not become reachable with DBA or bootstrap credentials." >&2
    exit 1
  fi
  sleep 2
done

"$sqlcmd_path" \
  -S "$server" \
  -U "$login" \
  -P "$password" \
  -C -b \
  -v \
    "DBA_PASSWORD=$ELEVANT_DB_DBA_PASSWORD" \
    "MIGRATOR_PASSWORD=$ELEVANT_DB_MIGRATOR_PASSWORD" \
    "APP_PASSWORD=$ELEVANT_DB_APP_PASSWORD" \
    "SEEDER_PASSWORD=$ELEVANT_DB_SEEDER_PASSWORD" \
    "HEALTH_PASSWORD=$ELEVANT_DB_HEALTH_PASSWORD" \
    "BACKUP_PASSWORD=$ELEVANT_DB_BACKUP_PASSWORD" \
  -i /opt/elevant-db-ops/sql/provision-development.sql

"$sqlcmd_path" -S "$server" -U elevant_dev_dba -P "$ELEVANT_DB_DBA_PASSWORD" -C -b \
  -Q "SELECT 1; ALTER LOGIN [sa] DISABLE;" -o /dev/null
