#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
files=(
  "$root/scripts/container/backup-development.sh"
  "$root/scripts/container/provision-development.sh"
  "$root/scripts/container/restore-check-development.sh"
  "$root/scripts/container/verify-development.sh"
  "$root/compose.development.database.yml"
  "$root/compose.local.yml"
)

for file in "${files[@]}"; do
  [[ -f "$file" ]]
  if grep -nE -- '(^|[[:space:]])-P([[:space:]]|$)' "$file"; then
    printf 'sqlcmd password option found in %s\n' "$file" >&2
    exit 1
  fi
  grep -q 'SQLCMDPASSWORD=' "$file"
done

if grep -nE -- '^[[:space:]]+-v([[:space:]\\]|$)' \
  "$root/scripts/container/provision-development.sh"; then
  echo 'provisioning credentials must not be sqlcmd argv values' >&2
  exit 1
fi

echo SQLCMD_PASSWORD_TRANSPORT_OK
