#!/usr/bin/env sh
set -eu

command_name="${1:-}"

case "$command_name" in
  migrate)
    dotnet /app/database-tool/Elevant.DatabaseTool.dll verify-target
    exec /app/efbundle
    ;;
  seed-development)
    exec dotnet /app/database-tool/Elevant.DatabaseTool.dll seed-development
    ;;
  verify-target)
    exec dotnet /app/database-tool/Elevant.DatabaseTool.dll verify-target
    ;;
  *)
    echo "Usage: container-entrypoint.sh <migrate|seed-development|verify-target>" >&2
    exit 2
    ;;
esac
