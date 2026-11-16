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
    .dockerignore | \
    Directory.Build.props | \
    Directory.Packages.props | \
    NuGet.config | \
    dotnet-tools.json | \
    global.json | \
    backend/Elevant.sln | \
    backend/Elevant.Application/* | \
    backend/Elevant.Domain/* | \
    backend/Elevant.Infrastructure/* | \
    backend/Elevant.Api/Elevant.Api.csproj | \
    backend/Elevant.Api/packages.lock.json | \
    database/DevelopmentDB/*)
      echo "A newer Development commit changes database-owned path: $path" >&2
      echo "This older run will not move mutable Development aliases." >&2
      exit 1
      ;;
  esac
done < "$changed_file_list"

printf '%s\n' "$development_tip"
