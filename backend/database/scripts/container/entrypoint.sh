#!/usr/bin/env bash
set -Eeuo pipefail

case "${1:-}" in
  provision-development)
    exec /opt/elevant-db-ops/provision-development.sh
    ;;
  backup-development)
    exec /opt/elevant-db-ops/backup-development.sh
    ;;
  restore-check-development)
    exec /opt/elevant-db-ops/restore-check-development.sh
    ;;
  *)
    echo "Usage: entrypoint.sh <provision-development|backup-development|restore-check-development>" >&2
    exit 2
    ;;
esac
