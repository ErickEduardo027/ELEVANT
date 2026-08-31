#!/usr/bin/env bash
set -Eeuo pipefail

readonly SOURCE_COMMIT="${1:-}"

[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
  echo "A canonical source commit is required." >&2
  exit 1
}
[[ -n "${REPOSITORY_TOKEN:-}" ]] || {
  echo "REPOSITORY_TOKEN is required." >&2
  exit 1
}

authorization="$(printf 'x-access-token:%s' "$REPOSITORY_TOKEN" | base64 -w 0)"
git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $authorization" \
  fetch --no-tags origin \
  '+refs/heads/Development:refs/remotes/origin/Development'
unset authorization REPOSITORY_TOKEN

development_tip="$(git rev-parse refs/remotes/origin/Development)"
if [[ "$development_tip" == "$SOURCE_COMMIT" ]]; then
  printf '%s\n' "$development_tip"
  exit 0
fi

git merge-base --is-ancestor "$SOURCE_COMMIT" "$development_tip" || {
  echo "Development no longer contains this workflow revision." >&2
  exit 1
}

changed_file_list="$(mktemp)"
trap 'rm -f "$changed_file_list"' EXIT
git diff --name-only --no-renames -z \
  "$SOURCE_COMMIT" "$development_tip" > "$changed_file_list"

while IFS= read -r -d '' path; do
  case "$path" in
    .github/workflows/backend-ci.yml | \
    backend/.dockerignore | \
    backend/Directory.Build.props | \
    backend/Directory.Packages.props | \
    backend/Dockerfile.database-release | \
    backend/Elevant.sln | \
    backend/NuGet.config | \
    backend/dotnet-tools.json | \
    backend/global.json | \
    backend/database/* | \
    backend/infrastructure/docker/compose.development.database.yml | \
    backend/infrastructure/docker/compose.development.release.yml | \
    backend/scripts/certify-database-containers.ps1 | \
    backend/scripts/deployment/* | \
    backend/src/Elevant.Application/* | \
    backend/src/Elevant.DatabaseTool/* | \
    backend/src/Elevant.Domain/* | \
    backend/src/Elevant.Infrastructure/* | \
    backend/src/Elevant.Api/Elevant.Api.csproj | \
    backend/src/Elevant.Api/packages.lock.json | \
    backend/tests/scripts/*)
      echo "A newer Development commit changes database-owned path: $path" >&2
      echo "This older run will not move mutable Development aliases." >&2
      exit 1
      ;;
  esac
done < "$changed_file_list"

printf '%s\n' "$development_tip"
