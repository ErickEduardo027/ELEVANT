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

declare -A password_owners=()
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
  if [[ -n "${password_owners[$value]+present}" ]]; then
    echo "$variable_name must not reuse the password from ${password_owners[$value]}." >&2
    exit 1
  fi
  password_owners["$value"]="$variable_name"
done

server="${ELEVANT_SQL_SERVER:-elevant-dev-sql}"
login=""
password=""
readiness_query="
SET NOCOUNT ON;
IF DB_ID(N'ElevantDevelopmentDb') IS NULL
BEGIN
  SELECT 1;
END
ELSE
BEGIN
  EXEC(N'USE [ElevantDevelopmentDb]; SELECT 1;');
END;"

can_provision_with() {
  local probe_login="$1"
  local probe_password="$2"

  SQLCMDPASSWORD="${probe_password}" "$sqlcmd_path" \
    -S "$server" \
    -d master \
    -U "$probe_login" \
    -C -b \
    -Q "$readiness_query" \
    -o /dev/null 2>/dev/null
}

for attempt in $(seq 1 60); do
  if can_provision_with elevant_dev_dba "$ELEVANT_DB_DBA_PASSWORD"; then
    login="elevant_dev_dba"
    password="$ELEVANT_DB_DBA_PASSWORD"
    break
  fi

  if can_provision_with sa "$MSSQL_SA_PASSWORD"; then
    login="sa"
    password="$MSSQL_SA_PASSWORD"
    break
  fi

  if [[ "$attempt" == "60" ]]; then
    echo "SQL Server and ElevantDevelopmentDb did not become ready with DBA or bootstrap credentials." >&2
    exit 1
  fi
  sleep 2
done

if [[ -z "$login" || -z "$password" ]]; then
  echo "SQL Server credential selection did not complete safely." >&2
  exit 1
fi

SQLCMDPASSWORD="${password}" \
DBA_PASSWORD="${ELEVANT_DB_DBA_PASSWORD}" \
MIGRATOR_PASSWORD="${ELEVANT_DB_MIGRATOR_PASSWORD}" \
APP_PASSWORD="${ELEVANT_DB_APP_PASSWORD}" \
SEEDER_PASSWORD="${ELEVANT_DB_SEEDER_PASSWORD}" \
HEALTH_PASSWORD="${ELEVANT_DB_HEALTH_PASSWORD}" \
BACKUP_PASSWORD="${ELEVANT_DB_BACKUP_PASSWORD}" \
"$sqlcmd_path" \
  -S "$server" \
  -U "$login" \
  -C -b \
  -i /opt/elevant-db-ops/sql/provision-development.sql

if ! SQLCMDPASSWORD="${ELEVANT_DB_DBA_PASSWORD}" \
  "$sqlcmd_path" -S "$server" -U elevant_dev_dba -C -b \
  -Q "SELECT 1;" -o /dev/null 2>/dev/null; then
  echo "Declared Development DBA credentials failed verification; sa remains unchanged." >&2
  exit 1
fi

sa_disabled="$(SQLCMDPASSWORD="${ELEVANT_DB_DBA_PASSWORD}" \
  "$sqlcmd_path" -S "$server" -U elevant_dev_dba -C -b -h -1 -W \
  -Q "SET NOCOUNT ON; SELECT [is_disabled] FROM sys.sql_logins WHERE [name] = N'sa';")"
if [[ "$sa_disabled" == "0" ]]; then
  SQLCMDPASSWORD="${MSSQL_SA_PASSWORD}" \
    "$sqlcmd_path" -S "$server" -U sa -C -b -Q "ALTER LOGIN [sa] DISABLE;" -o /dev/null
elif [[ "$sa_disabled" != "1" ]]; then
  echo "Could not verify the sa login state after provisioning." >&2
  exit 1
fi
