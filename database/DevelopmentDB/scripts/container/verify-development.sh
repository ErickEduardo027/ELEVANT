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

dba_password="${ELEVANT_DB_DBA_PASSWORD}"
export -n ELEVANT_DB_DBA_PASSWORD dba_password
unset ELEVANT_DB_DBA_PASSWORD

SQLCMDPASSWORD="$dba_password" \
  "$sqlcmd_path" \
  -S "$server" \
  -d "$database_name" \
  -U elevant_dev_dba \
  -C -b -r 1 -l 15 \
  -i /opt/elevant-db-ops/sql/verify-development.sql

team_access_state="$(
  SQLCMDPASSWORD="$dba_password" \
    "$sqlcmd_path" \
    -S "$server" \
    -d "$database_name" \
    -U elevant_dev_dba \
    -C -b -h -1 -W -l 15 \
    -Q "SET NOCOUNT ON;
DECLARE @artifact_count int =
    (SELECT COUNT(*) FROM master.sys.server_principals WHERE [name] IN (N'elevant_dev_erick', N'elevant_dev_eliezer', N'elevant_dev_laisha')) +
    (SELECT COUNT(*) FROM sys.database_principals WHERE [name] IN (N'elevant_dev_team_editor', N'elevant_dev_erick', N'elevant_dev_eliezer', N'elevant_dev_laisha')) +
    (SELECT COUNT(*) FROM sys.objects AS objects INNER JOIN sys.schemas AS schemas ON schemas.[schema_id] = objects.[schema_id] WHERE schemas.[name] = N'dbo' AND objects.[name] IN (N'sysdiagrams', N'sp_upgraddiagrams', N'sp_helpdiagrams', N'sp_helpdiagramdefinition', N'sp_creatediagram', N'sp_renamediagram', N'sp_alterdiagram', N'sp_dropdiagram', N'fn_diagramobjects'));
SELECT CASE
    WHEN @artifact_count = 0 THEN N'absent'
    WHEN DATABASE_PRINCIPAL_ID(N'elevant_dev_team_editor') IS NOT NULL THEN N'present'
    ELSE N'partial'
END;"
)"
team_access_state="${team_access_state//$'\r'/}"
team_access_state="${team_access_state//[[:space:]]/}"

if [[ "$team_access_state" == "present" ]]; then
  SQLCMDPASSWORD="$dba_password" \
    "$sqlcmd_path" \
    -S "$server" \
    -d "$database_name" \
    -U elevant_dev_dba \
    -C -b -r 1 -l 15 \
    -i /opt/elevant-db-ops/sql/verify-development-team-access.sql
elif [[ "$team_access_state" == "absent" ]]; then
  echo "SKIP: Development team access has not been provisioned."
elif [[ "$team_access_state" == "partial" ]]; then
  echo "Development team access artifacts are partial; refusing to skip verification." >&2
  exit 1
else
  echo "Could not determine the Development team access artifact state." >&2
  exit 1
fi
