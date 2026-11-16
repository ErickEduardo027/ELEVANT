#!/usr/bin/env bash
set -Eeuo pipefail

readonly SOURCE_COMMIT="${1:-}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PATH_OWNERSHIP="$SCRIPT_DIR/../../../scripts/release/path-ownership.sh"

[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
  echo "A canonical source commit is required." >&2
  exit 1
}
[[ -n "${REPOSITORY_TOKEN:-}" ]] || {
  echo "REPOSITORY_TOKEN is required." >&2
  exit 1
}
[[ -f "$PATH_OWNERSHIP" && ! -L "$PATH_OWNERSHIP" ]] || {
  echo "The reviewed release path policy is unavailable." >&2
  exit 1
}
# shellcheck source=../../../scripts/release/path-ownership.sh
source "$PATH_OWNERSHIP"

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
  if elevant_is_api_publication_superseding_path "$path"; then
    echo "A newer Development commit changes API release input path: $path" >&2
    echo "This older run will not move the mutable Development API alias." >&2
    exit 1
  fi
done < "$changed_file_list"

printf '%s\n' "$development_tip"
