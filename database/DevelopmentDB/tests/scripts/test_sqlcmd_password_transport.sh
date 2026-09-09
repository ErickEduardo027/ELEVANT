#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
repository_root="$(cd "$root/../.." && pwd)"
runtime_scripts=(
  "$root/scripts/container/backup-development.sh"
  "$root/scripts/container/provision-development.sh"
  "$root/scripts/container/restore-check-development.sh"
  "$root/scripts/container/verify-development.sh"
)
compose_files=(
  "$root/compose.development.database.yml"
  "$root/compose.local.yml"
)
certifier="$root/scripts/certify-database-containers.ps1"
workflow="$repository_root/.github/workflows/backend-ci.yml"
password_option_re="(^|[[:space:]])[\"']?-P"
certifier_password_option_re="(^|[[:space:]])-P([[:space:]]|$)|['\"]-P"
certifier_wrapper_re='^[[:space:]]*-SqlcmdPassword \$passwords\.[A-Za-z]+[[:space:]]+`[[:space:]]*$'

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

for file in "${runtime_scripts[@]}" "${compose_files[@]}"; do
  [[ -f "$file" ]]
  if grep -nE -- "$password_option_re" "$file"; then
    fail "sqlcmd password option found in $file"
  fi
done

for unsafe in 'sqlcmd -P value' 'sqlcmd -Pvalue' "sqlcmd '-P' value" "sqlcmd '-Psecret'"; do
  grep -Eq -- "$password_option_re" <<<"$unsafe" ||
    fail "password option detector missed: $unsafe"
done

for unsafe in '-P secret' "'-Psecret'" '"-Psecret"'; do
  grep -Eq -- "$certifier_password_option_re" <<<"$unsafe" ||
    fail "certifier password option detector missed: $unsafe"
done
if grep -Eq -- "$certifier_password_option_re" <<<'-Password value'; then
  fail 'certifier password option detector rejected a normal PowerShell parameter'
fi

for wrapper_line in \
  $'        -SqlcmdPassword $passwords.Sa `\n' \
  $'        -SqlcmdPassword $passwords.Sa `\r\n'; do
  printf '%s' "$wrapper_line" | grep -Eq -- "$certifier_wrapper_re" ||
    fail 'scoped password wrapper detector must accept LF and CRLF'
done

for file in "${runtime_scripts[@]}"; do
  invocations="$(awk '
    index($0, "\"$sqlcmd_path\"") && !index($0, "[[") { count++ }
    END { print count + 0 }
  ' "$file")"
  bindings="$(grep -c 'SQLCMDPASSWORD=' "$file" || true)"
  [[ "$invocations" -gt 0 && "$bindings" -eq "$invocations" ]] ||
    fail "every sqlcmd invocation must have one password binding in $file"
done

grep -Fq 'export -n ELEVANT_DB_BACKUP_PASSWORD ELEVANT_DB_DBA_PASSWORD' \
  "$root/scripts/container/backup-development.sh"
grep -Fq 'export -n "${required[@]}" value password login' \
  "$root/scripts/container/provision-development.sh"
grep -Fq 'export -n probe_login probe_password' \
  "$root/scripts/container/provision-development.sh"
grep -Fq 'export -n ELEVANT_DB_DBA_PASSWORD' \
  "$root/scripts/container/restore-check-development.sh"
grep -Fq 'unset ELEVANT_DB_DBA_PASSWORD' \
  "$root/scripts/container/verify-development.sh"

for file in "${compose_files[@]}"; do
  invocations="$(grep -Fc '"$$SQLCMD" -S' "$file" || true)"
  bindings="$(grep -c 'SQLCMDPASSWORD=' "$file" || true)"
  [[ "$invocations" -gt 0 && "$bindings" -eq "$invocations" ]] ||
    fail "every Compose sqlcmd invocation must have one password binding in $file"
  grep -Fq 'HEALTH_PASSWORD="$${ELEVANT_DB_HEALTH_PASSWORD}"' "$file"
  grep -Fq 'unset HEALTH_PASSWORD' "$file"
  grep -Fq 'unset ELEVANT_DB_HEALTH_PASSWORD MSSQL_SA_PASSWORD;' "$file"
  if grep -nE 'SQLCMDPASSWORD="\$\$\{(ELEVANT_DB_[A-Z_]*PASSWORD|MSSQL_SA_PASSWORD)\}' "$file"; then
    fail "Compose must copy and unset the original password before sqlcmd in $file"
  fi
done
grep -Fq 'SA_PASSWORD="$${MSSQL_SA_PASSWORD}"' "$root/compose.local.yml"

[[ "$(grep -Fc "'--env', 'SQLCMDPASSWORD'," "$certifier")" -eq 4 ]] ||
  fail 'every containerized sqlcmd client must import SQLCMDPASSWORD by name'
[[ "$(grep -Fc 'Invoke-DockerWithSqlcmdPassword -Password' "$certifier")" -eq 2 ]] ||
  fail 'normal sqlcmd Docker calls must use the scoped password wrapper'
[[ "$(grep -Ec -- "$certifier_wrapper_re" "$certifier")" -eq 2 ]] ||
  fail 'expected-failure sqlcmd Docker calls must use the scoped password wrapper'
[[ "$(grep -Fc 'docker exec --env SQLCMDPASSWORD' "$certifier")" -eq 1 ]] ||
  fail 'docker exec sqlcmd readiness must import SQLCMDPASSWORD by name'
if grep -nE -- "$certifier_password_option_re" "$certifier"; then
  fail 'certification must not pass a sqlcmd password option'
fi

grep -Fq 'SQLCMDPASSWORD: "CI-Only_StrongPassword!2026"' "$workflow"
grep -Fq -- '--health-cmd "unset MSSQL_SA_PASSWORD; exec /opt/mssql-tools18/bin/sqlcmd' "$workflow"
if grep 'sqlcmd' "$workflow" | grep -Eq -- "$password_option_re"; then
  fail 'CI healthchecks must not pass a sqlcmd password option'
fi

if grep -nE -- '^[[:space:]]+-v([[:space:]\\]|$)' \
  "$root/scripts/container/provision-development.sh"; then
  fail 'provisioning credentials must not be sqlcmd argv values'
fi

echo SQLCMD_PASSWORD_TRANSPORT_OK
