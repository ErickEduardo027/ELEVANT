#!/usr/bin/env bash
set -Eeuo pipefail

readonly REQUESTED_REFERENCE="${1:-}"
readonly API_SOURCE_COMMIT="${2:-}"
readonly OUTPUT_DIRECTORY="${3:-}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="${ELEVANT_REPOSITORY_ROOT:-$(cd -- "$SCRIPT_DIR/../../.." && pwd)}"
readonly DATABASE_MANIFEST_TOOL="$REPOSITORY_ROOT/database/DevelopmentDB/scripts/deployment/database_release_manifest.py"
readonly MAX_WAIT_SECONDS="${ELEVANT_DATABASE_WAIT_SECONDS:-1800}"
readonly POLL_SECONDS="${ELEVANT_DATABASE_POLL_SECONDS:-15}"
readonly EXPECTED_REPOSITORY="${ELEVANT_EXPECTED_REPOSITORY:-${GITHUB_REPOSITORY:-}}"

[[ "$REQUESTED_REFERENCE" =~ ^ghcr\.io/[a-z0-9_.-]+/elevant-db-release-manifest(:development-certified|@sha256:[0-9a-f]{64})$ ]] || {
  echo "A canonical database release bundle reference is required." >&2
  exit 1
}
[[ "$API_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
  echo "A canonical API source commit is required." >&2
  exit 1
}
[[ -n "$OUTPUT_DIRECTORY" ]] || {
  echo "An output directory is required." >&2
  exit 1
}
[[ "$EXPECTED_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "ELEVANT_EXPECTED_REPOSITORY or GITHUB_REPOSITORY is required." >&2
  exit 1
}
[[ "$MAX_WAIT_SECONDS" =~ ^[0-9]+$ && "$POLL_SECONDS" =~ ^[1-9][0-9]*$ ]] || {
  echo "Database wait and poll intervals must be non-negative integers." >&2
  exit 1
}
[[ -x "$DATABASE_MANIFEST_TOOL" || -f "$DATABASE_MANIFEST_TOOL" ]] || {
  echo "Database manifest validator is missing." >&2
  exit 1
}

install -d -m 0700 "$OUTPUT_DIRECTORY"
readonly IS_IMMUTABLE="$([[ "$REQUESTED_REFERENCE" == *@sha256:* ]] && echo true || echo false)"
readonly START_SECONDS="$SECONDS"

resolve_digest_reference() {
  local reference="$1"
  local repository digest_reference
  repository="${reference%@*}"
  if [[ "$repository" == "$reference" ]]; then
    repository="${reference%:*}"
  fi
  digest_reference="$(
    docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$reference" |
      grep -E "^${repository//./\.}@sha256:[0-9a-f]{64}$" |
      head -n 1
  )"
  [[ "$digest_reference" =~ ^ghcr\.io/[a-z0-9_.-]+/elevant-db-release-manifest@sha256:[0-9a-f]{64}$ ]] || {
    echo "Could not resolve the database bundle to an immutable digest." >&2
    return 1
  }
  printf '%s\n' "$digest_reference"
}

while true; do
  attempt_root="$(mktemp -d)"
  bundle_container=""
  cleanup_attempt() {
    if [[ -n "$bundle_container" ]]; then
      docker rm -f "$bundle_container" >/dev/null 2>&1 || true
      bundle_container=""
    fi
    rm -rf "$attempt_root"
  }

  docker pull "$REQUESTED_REFERENCE" >/dev/null
  immutable_reference="$(resolve_digest_reference "$REQUESTED_REFERENCE")"

  [[ "$(docker image inspect --format '{{index .Config.Labels "org.elevant.database.environment"}}' "$immutable_reference")" == Development ]] || {
    cleanup_attempt
    echo "Database bundle environment label is invalid." >&2
    exit 1
  }
  [[ "$(docker image inspect --format '{{index .Config.Labels "org.elevant.database.manifest.schema"}}' "$immutable_reference")" == 1 ]] || {
    cleanup_attempt
    echo "Database bundle schema label is invalid." >&2
    exit 1
  }
  [[ "$(docker image inspect --format '{{index .Config.Labels "io.elevant.database-release.bundle-version"}}' "$immutable_reference")" == 1 ]] || {
    cleanup_attempt
    echo "Database bundle version label is invalid." >&2
    exit 1
  }
  [[ "$(docker image inspect --format '{{index .Config.Labels "io.elevant.database-release.media-type"}}' "$immutable_reference")" == application/vnd.elevant.database-release-bundle.v1 ]] || {
    cleanup_attempt
    echo "Database bundle media type is invalid." >&2
    exit 1
  }

  bundle_container="$(docker create "$immutable_reference")"
  docker cp "$bundle_container:/manifest.json" "$attempt_root/manifest.json"
  docker cp "$bundle_container:/compose/compose.development.database.yml" \
    "$attempt_root/compose.development.database.yml"
  docker cp "$bundle_container:/compose/compose.development.release.yml" \
    "$attempt_root/compose.development.release.yml"
  docker rm "$bundle_container" >/dev/null
  bundle_container=""

  python3 "$DATABASE_MANIFEST_TOOL" validate \
    --manifest "$attempt_root/manifest.json" || {
      cleanup_attempt
      echo "Database bundle manifest is structurally invalid." >&2
      exit 1
    }

  manifest_repository="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["source"]["repository"])' "$attempt_root/manifest.json")"
  database_commit="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["source"]["commit"])' "$attempt_root/manifest.json")"
  [[ "$manifest_repository" == "$EXPECTED_REPOSITORY" ]] || {
    cleanup_attempt
    echo "Database bundle repository does not match the API repository." >&2
    exit 1
  }

  compatible=true
  cmp -s "$attempt_root/compose.development.database.yml" \
    "$REPOSITORY_ROOT/database/DevelopmentDB/compose.development.database.yml" || compatible=false
  cmp -s "$attempt_root/compose.development.release.yml" \
    "$REPOSITORY_ROOT/database/DevelopmentDB/compose.development.release.yml" || compatible=false
  python3 "$DATABASE_MANIFEST_TOOL" validate \
    --manifest "$attempt_root/manifest.json" \
    --repository-root "$REPOSITORY_ROOT" >/dev/null 2>&1 || compatible=false
  git -C "$REPOSITORY_ROOT" cat-file -e "${database_commit}^{commit}" 2>/dev/null || compatible=false
  if [[ "$compatible" == true ]]; then
    git -C "$REPOSITORY_ROOT" merge-base --is-ancestor \
      "$database_commit" "$API_SOURCE_COMMIT" || compatible=false
  fi

  if [[ "$compatible" == true ]]; then
    install -m 0600 "$attempt_root/manifest.json" \
      "$OUTPUT_DIRECTORY/database-release-manifest.json"
    install -m 0600 "$attempt_root/compose.development.database.yml" \
      "$OUTPUT_DIRECTORY/compose.development.database.yml"
    install -m 0600 "$attempt_root/compose.development.release.yml" \
      "$OUTPUT_DIRECTORY/compose.development.release.yml"
    printf '%s\n' "$immutable_reference" > \
      "$OUTPUT_DIRECTORY/database-release-manifest-reference.txt"
    cleanup_attempt
    echo "DATABASE_RELEASE_COMPATIBLE reference=$immutable_reference"
    exit 0
  fi

  cleanup_attempt
  if [[ "$IS_IMMUTABLE" == true ]]; then
    echo "The selected immutable database bundle is incompatible with this API source." >&2
    exit 1
  fi
  if (( SECONDS - START_SECONDS >= MAX_WAIT_SECONDS )); then
    echo "Timed out waiting for a compatible certified Development database bundle." >&2
    exit 1
  fi
  echo "Waiting for the certified Development database bundle required by this API source."
  sleep "$POLL_SECONDS"
done
