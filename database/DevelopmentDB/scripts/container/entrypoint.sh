#!/usr/bin/env bash
set -Eeuo pipefail

case "${1:-}" in
  initialize-backup-storage)
    exec /opt/elevant-db-ops/initialize-backup-storage.sh
    ;;
  provision-development)
    exec /opt/elevant-db-ops/provision-development.sh
    ;;
  backup-development)
    exec /opt/elevant-db-ops/backup-development.sh
    ;;
  restore-check-development)
    exec /opt/elevant-db-ops/restore-check-development.sh
    ;;
  verify-development)
    exec /opt/elevant-db-ops/verify-development.sh
    ;;
  *)
    echo "Usage: entrypoint.sh <initialize-backup-storage|provision-development|backup-development|restore-check-development|verify-development>" >&2
    exit 2
    ;;
esac
