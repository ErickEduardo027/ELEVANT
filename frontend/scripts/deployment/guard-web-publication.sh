#!/usr/bin/env bash
set -Eeuo pipefail

readonly APPLICATION="${1:-}"
readonly SOURCE_COMMIT="${2:-}"

[[ "$APPLICATION" == aviam-web || "$APPLICATION" == public-web ]] || {
  echo "Application must be aviam-web or public-web." >&2
  exit 1
}
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
trap 'rm -f -- "$changed_file_list"' EXIT
git diff --name-only --no-renames -z \
  "$SOURCE_COMMIT" "$development_tip" > "$changed_file_list"

while IFS= read -r -d '' path; do
  shared=false
  case "$path" in
    .github/workflows/web-ci.yml | \
    frontend/scripts/deployment/* | \
    frontend/tests/deployment/* | \
    packages/api-client/* | \
    backend/Elevant.Api/* | \
    backend/Elevant.Contracts/* )
      shared=true
      ;;
  esac

  owned=false
  if [[ "$APPLICATION" == aviam-web && "$path" == frontend/private-web/* ]]; then
    owned=true
  elif [[ "$APPLICATION" == public-web && "$path" == frontend/public-web/* ]]; then
    owned=true
  fi

  if [[ "$shared" == true || "$owned" == true ]]; then
    echo "A newer Development commit changes $APPLICATION release input path: $path" >&2
    echo "This older run will not move the mutable Development web alias." >&2
    exit 1
  fi
done < "$changed_file_list"

printf '%s\n' "$development_tip"
