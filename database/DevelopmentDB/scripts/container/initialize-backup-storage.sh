#!/usr/bin/env bash
set -Eeuo pipefail

backup_dir="/var/opt/mssql/backups"

if [[ "$(id -u)" != "0" ]]; then
  echo "Backup storage initialization must run as root in its isolated one-shot container." >&2
  exit 1
fi

install -d -o 10001 -g 10001 -m 0770 "$backup_dir"

owner="$(stat -c '%u:%g' "$backup_dir")"
mode="$(stat -c '%a' "$backup_dir")"
if [[ "$owner" != "10001:10001" || "$mode" != "770" ]]; then
  echo "Backup storage ownership or mode is not safe for the mssql runtime user." >&2
  exit 1
fi
