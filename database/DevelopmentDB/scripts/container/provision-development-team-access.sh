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
  ELEVANT_DB_DBA_PASSWORD
  ELEVANT_DB_TEAM_ERICK_PASSWORD
  ELEVANT_DB_TEAM_ELIEZER_PASSWORD
  ELEVANT_DB_TEAM_LAISHA_PASSWORD
)

for variable_name in "${required[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "$variable_name is required." >&2
    exit 1
  fi
done

declare -A password_owners=()
password_variables=(
  ELEVANT_DB_TEAM_ERICK_PASSWORD
  ELEVANT_DB_TEAM_ELIEZER_PASSWORD
  ELEVANT_DB_TEAM_LAISHA_PASSWORD
)
special_character_pattern='[!@#%_+=:.,?-]'

for password_variable in "${password_variables[@]}"; do
  password_value="${!password_variable}"

  if [[ ! "$password_value" =~ ^[A-Za-z0-9!@#%_+=:.,?-]{16,128}$ ]]; then
    echo "$password_variable must be 16-128 characters from the documented safe character set." >&2
    exit 1
  fi
  if [[ ! "$password_value" =~ [A-Z] ||
        ! "$password_value" =~ [a-z] ||
        ! "$password_value" =~ [0-9] ||
        ! "$password_value" =~ $special_character_pattern ]]; then
    echo "$password_variable must contain uppercase, lowercase, numeric, and special characters." >&2
    exit 1
  fi
  normalized_password="${password_value^^}"
  if [[ "$normalized_password" == REPLACE_* ||
        "$normalized_password" == PLACEHOLDER_* ||
        "$normalized_password" == CHANGE_ME* ||
        "$normalized_password" == CHANGEME* ]]; then
    echo "$password_variable must replace the documented placeholder." >&2
    exit 1
  fi
  if [[ -n "${password_owners[$password_value]+present}" ]]; then
    echo "$password_variable must not reuse the password from ${password_owners[$password_value]}." >&2
    exit 1
  fi
  password_owners["$password_value"]="$password_variable"
done

normalized_dba_password="${ELEVANT_DB_DBA_PASSWORD^^}"
if [[ "$normalized_dba_password" == REPLACE_* ||
      "$normalized_dba_password" == PLACEHOLDER_* ||
      "$normalized_dba_password" == CHANGE_ME* ||
      "$normalized_dba_password" == CHANGEME* ]]; then
  echo "ELEVANT_DB_DBA_PASSWORD must replace the documented placeholder." >&2
  exit 1
fi
if [[ -n "${password_owners[$ELEVANT_DB_DBA_PASSWORD]+present}" ]]; then
  echo "A team password must not reuse ELEVANT_DB_DBA_PASSWORD." >&2
  exit 1
fi

server="${ELEVANT_SQL_SERVER:-elevant-dev-sql}"
dba_password="$ELEVANT_DB_DBA_PASSWORD"

export -n "${required[@]}" variable_name password_variable password_value
export -n normalized_password normalized_dba_password password_variables server dba_password
export -n special_character_pattern

SQLCMDPASSWORD="$dba_password" \
ELEVANT_DB_TEAM_ERICK_PASSWORD="${ELEVANT_DB_TEAM_ERICK_PASSWORD}" \
ELEVANT_DB_TEAM_ELIEZER_PASSWORD="${ELEVANT_DB_TEAM_ELIEZER_PASSWORD}" \
ELEVANT_DB_TEAM_LAISHA_PASSWORD="${ELEVANT_DB_TEAM_LAISHA_PASSWORD}" \
"$sqlcmd_path" \
  -S "$server" \
  -U elevant_dev_dba \
  -d master \
  -C -b -r 1 \
  -i /opt/elevant-db-ops/sql/provision-development-team-access.sql

verify_login_if_enabled() {
  local login_name="$1"
  local login_password="$2"
  local enabled

  enabled="$(
    SQLCMDPASSWORD="$dba_password" \
      "$sqlcmd_path" -S "$server" -U elevant_dev_dba -d master \
      -C -b -h -1 -W \
      -Q "SET NOCOUNT ON; SELECT CONVERT(int, 1 - is_disabled) FROM sys.sql_logins WHERE name = N'$login_name';"
  )"
  enabled="${enabled//$'\r'/}"

  if [[ "$enabled" == "1" ]]; then
    SQLCMDPASSWORD="$login_password" \
      "$sqlcmd_path" -S "$server" -U "$login_name" -d ElevantDevelopmentDb \
      -C -b -Q "SET NOCOUNT ON; SELECT 1;" -o /dev/null
  elif [[ "$enabled" != "0" ]]; then
    echo "Could not verify the enabled state for $login_name." >&2
    exit 1
  fi
}

verify_login_if_enabled elevant_dev_erick "$ELEVANT_DB_TEAM_ERICK_PASSWORD"
verify_login_if_enabled elevant_dev_eliezer "$ELEVANT_DB_TEAM_ELIEZER_PASSWORD"
verify_login_if_enabled elevant_dev_laisha "$ELEVANT_DB_TEAM_LAISHA_PASSWORD"

echo "Development team access provisioned and verified for three individual SQL logins."
