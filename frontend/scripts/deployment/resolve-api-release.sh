#!/usr/bin/env bash
set -Eeuo pipefail

readonly REQUESTED_REFERENCE="${1:-}"
readonly OUTPUT_DIRECTORY="${2:-}"
readonly REPOSITORY_ROOT="${ELEVANT_REPOSITORY_ROOT:-$(pwd)}"
readonly EXPECTED_REPOSITORY="${ELEVANT_EXPECTED_REPOSITORY:-}"
readonly SOURCE_COMMIT="${ELEVANT_SOURCE_COMMIT:-}"
readonly API_CLIENT_SOURCE="${ELEVANT_API_CLIENT_SOURCE:-$REPOSITORY_ROOT/packages/api-client/openapi/source.json}"
readonly OPENAPI_DOCUMENT="${ELEVANT_OPENAPI_DOCUMENT:-$REPOSITORY_ROOT/packages/api-client/openapi/elevant-v1.json}"
readonly API_MANIFEST_VALIDATOR="${ELEVANT_API_MANIFEST_VALIDATOR:-$REPOSITORY_ROOT/backend/scripts/deployment/api_release_manifest.py}"
readonly OPENAPI_TOOL="${ELEVANT_OPENAPI_TOOL:-$REPOSITORY_ROOT/ops/dokploy/web-cd/openapi-tool.mjs}"
readonly PATH_OWNERSHIP="${ELEVANT_RELEASE_PATH_POLICY:-$REPOSITORY_ROOT/scripts/release/path-ownership.sh}"
readonly MAX_WAIT_SECONDS="${ELEVANT_API_WAIT_SECONDS:-1800}"
readonly POLL_SECONDS="${ELEVANT_API_POLL_SECONDS:-15}"

[[ "$REQUESTED_REFERENCE" =~ ^ghcr\.io/[a-z0-9_.-]+/elevant-api-release-manifest(:development-certified|@sha256:[0-9a-f]{64})$ ]] || {
  echo "The API release reference must be the certified alias or an immutable GHCR digest." >&2
  exit 1
}
[[ -n "$OUTPUT_DIRECTORY" && "$OUTPUT_DIRECTORY" == /* ]] || {
  echo "An absolute output directory is required." >&2
  exit 1
}
[[ "$EXPECTED_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "ELEVANT_EXPECTED_REPOSITORY is required." >&2
  exit 1
}
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ELEVANT_SOURCE_COMMIT must be a canonical commit." >&2
  exit 1
}
[[ "$MAX_WAIT_SECONDS" =~ ^[0-9]+$ && "$POLL_SECONDS" =~ ^[1-9][0-9]*$ ]] || {
  echo "API wait and poll intervals must be non-negative integers." >&2
  exit 1
}
for file in "$API_CLIENT_SOURCE" "$OPENAPI_DOCUMENT" "$API_MANIFEST_VALIDATOR" "$OPENAPI_TOOL" "$PATH_OWNERSHIP"; do
  [[ -f "$file" && ! -L "$file" ]] || {
    echo "Required API contract input is missing or is a symlink: $file" >&2
    exit 1
  }
done
# shellcheck source-path=SCRIPTDIR
# shellcheck source=../../../scripts/release/path-ownership.sh
source "$PATH_OWNERSHIP"
[[ "$(git -C "$REPOSITORY_ROOT" rev-parse --is-inside-work-tree)" == true ]] || {
  echo "The API release resolver requires a Git worktree." >&2
  exit 1
}
[[ "$(git -C "$REPOSITORY_ROOT" rev-parse HEAD)" == "$SOURCE_COMMIT" ]] || {
  echo "ELEVANT_SOURCE_COMMIT must match the checked-out repository HEAD." >&2
  exit 1
}
git -C "$REPOSITORY_ROOT" cat-file -e "$SOURCE_COMMIT^{commit}" 2>/dev/null || {
  echo "The checked-out source commit is unavailable." >&2
  exit 1
}

umask 077
if [[ -L "$OUTPUT_DIRECTORY" ]]; then
  echo "API release output directory must not be a symbolic link." >&2
  exit 1
fi
if [[ -e "$OUTPUT_DIRECTORY" ]]; then
  [[ -d "$OUTPUT_DIRECTORY" ]] || {
    echo "API release output path must be a directory." >&2
    exit 1
  }
  if find "$OUTPUT_DIRECTORY" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
    echo "API release output directory must be empty." >&2
    exit 1
  fi
  chmod 0700 "$OUTPUT_DIRECTORY"
else
  install -d -m 0700 "$OUTPUT_DIRECTORY"
fi
IS_IMMUTABLE="$([[ "$REQUESTED_REFERENCE" == *@sha256:* ]] && echo true || echo false)"
readonly IS_IMMUTABLE
readonly START_SECONDS="$SECONDS"
readonly EXPECTED_OWNER="${EXPECTED_REPOSITORY%%/*}"
readonly EXPECTED_BUNDLE_REPOSITORY="ghcr.io/${EXPECTED_OWNER,,}/elevant-api-release-manifest"
OPENAPI_SHA256="$(node "$OPENAPI_TOOL" hash --file "$OPENAPI_DOCUMENT")"
readonly OPENAPI_SHA256
[[ "$OPENAPI_SHA256" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "OpenAPI fingerprint tool returned an invalid digest." >&2
  exit 1
}
api_client_contract_output="$(
  python3 - "$API_CLIENT_SOURCE" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    source = json.load(stream)

if set(source) != {"schemaVersion", "openApiSha256", "swaggerPath"}:
    raise SystemExit("API client source shape is invalid")
if type(source["schemaVersion"]) is not int or source["schemaVersion"] != 1:
    raise SystemExit("API client source schemaVersion is invalid")
if not re.fullmatch(r"sha256:[0-9a-f]{64}", source["openApiSha256"]):
    raise SystemExit("API client OpenAPI fingerprint is invalid")
if source["swaggerPath"] != "/swagger/v1/swagger.json":
    raise SystemExit("API client Swagger path is invalid")

print(source["openApiSha256"])
print(source["swaggerPath"])
PY
)" || {
  echo "API client source contract is invalid." >&2
  exit 1
}
api_client_contract_output="${api_client_contract_output//$'\r'/}"
mapfile -t api_client_contract <<<"$api_client_contract_output"
[[ "${#api_client_contract[@]}" -eq 2 ]] || {
  echo "API client source contract proof has an invalid shape." >&2
  exit 1
}
readonly EXPECTED_OPENAPI_SHA256="${api_client_contract[0]}"
readonly EXPECTED_SWAGGER_PATH="${api_client_contract[1]}"
[[ "$EXPECTED_OPENAPI_SHA256" == "$OPENAPI_SHA256" ]] || {
  echo "API client OpenAPI fingerprint does not match the checked-in document." >&2
  exit 1
}

resolve_digest_reference() {
  local reference="$1"
  local digest_reference
  digest_reference="$(
    docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$reference" |
      grep -E "^${EXPECTED_BUNDLE_REPOSITORY//./\.}@sha256:[0-9a-f]{64}$" |
      head -n 1
  )"
  [[ "$digest_reference" =~ ^ghcr\.io/[a-z0-9_.-]+/elevant-api-release-manifest@sha256:[0-9a-f]{64}$ ]] || {
    echo "Could not resolve the API bundle to an immutable digest." >&2
    return 1
  }
  printf '%s\n' "$digest_reference"
}

api_lineage_status() {
  local candidate="$1" changed_file_list path
  local api_input_changed=false
  git -C "$REPOSITORY_ROOT" cat-file -e "$candidate^{commit}" 2>/dev/null || return 2

  if git -C "$REPOSITORY_ROOT" merge-base --is-ancestor "$candidate" "$SOURCE_COMMIT"; then
    changed_file_list="$(mktemp)"
    if ! git -C "$REPOSITORY_ROOT" diff --name-only --no-renames -z \
      "$candidate" "$SOURCE_COMMIT" > "$changed_file_list"; then
      rm -f -- "$changed_file_list"
      return 2
    fi
    while IFS= read -r -d '' path; do
      if elevant_is_api_build_input_path "$path"; then
        api_input_changed=true
        break
      fi
    done < "$changed_file_list"
    rm -f -- "$changed_file_list"
    [[ "$api_input_changed" == false ]] || return 1
    return 0
  fi

  if git -C "$REPOSITORY_ROOT" merge-base --is-ancestor "$SOURCE_COMMIT" "$candidate"; then
    return 0
  fi
  return 2
}

while true; do
  attempt_root="$(mktemp -d)"
  bundle_container=""
  cleanup_attempt() {
    if [[ -n "$bundle_container" ]]; then
      docker rm -f "$bundle_container" >/dev/null 2>&1 || true
      bundle_container=""
    fi
    rm -rf -- "$attempt_root"
  }
  trap cleanup_attempt EXIT

  if ! docker pull "$REQUESTED_REFERENCE" >/dev/null; then
    cleanup_attempt
    trap - EXIT
    if [[ "$IS_IMMUTABLE" == true ]]; then
      echo "The selected immutable API bundle could not be pulled." >&2
      exit 1
    fi
    if (( SECONDS - START_SECONDS >= MAX_WAIT_SECONDS )); then
      echo "Timed out waiting for the certified Development API bundle." >&2
      exit 1
    fi
    echo "Waiting for the certified Development API bundle to become available."
    sleep "$POLL_SECONDS"
    continue
  fi
  if ! immutable_reference="$(resolve_digest_reference "$REQUESTED_REFERENCE")"; then
    cleanup_attempt
    trap - EXIT
    if [[ "$IS_IMMUTABLE" == true ]]; then
      echo "The selected immutable API bundle could not be resolved." >&2
      exit 1
    fi
    if (( SECONDS - START_SECONDS >= MAX_WAIT_SECONDS )); then
      echo "Timed out resolving the certified Development API bundle." >&2
      exit 1
    fi
    echo "Waiting for the certified Development API bundle digest."
    sleep "$POLL_SECONDS"
    continue
  fi

  [[ "$(docker image inspect --format '{{index .Config.Labels "org.elevant.api.environment"}}' "$immutable_reference")" == Development ]] || {
    cleanup_attempt
    echo "API bundle environment label is invalid." >&2
    exit 1
  }
  [[ "$(docker image inspect --format '{{index .Config.Labels "org.elevant.api.manifest.schema"}}' "$immutable_reference")" == 1 ]] || {
    cleanup_attempt
    echo "API bundle schema label is invalid." >&2
    exit 1
  }
  [[ "$(docker image inspect --format '{{index .Config.Labels "io.elevant.api-release.bundle-version"}}' "$immutable_reference")" == 1 ]] || {
    cleanup_attempt
    echo "API bundle version label is invalid." >&2
    exit 1
  }
  [[ "$(docker image inspect --format '{{index .Config.Labels "io.elevant.api-release.media-type"}}' "$immutable_reference")" == application/vnd.elevant.api-release-bundle.v1 ]] || {
    cleanup_attempt
    echo "API bundle media type is invalid." >&2
    exit 1
  }
  bundle_openapi_sha256="$(docker image inspect --format '{{index .Config.Labels "io.elevant.api-release.openapi-sha256"}}' "$immutable_reference")"
  if [[ "$bundle_openapi_sha256" == '<no value>' ]]; then
    bundle_openapi_sha256=""
  fi
  if [[ -n "$bundle_openapi_sha256" && ! "$bundle_openapi_sha256" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    cleanup_attempt
    echo "API bundle OpenAPI fingerprint label is malformed." >&2
    exit 1
  fi

  bundle_container="$(docker create "$immutable_reference")"
  docker cp "$bundle_container:/manifest.json" "$attempt_root/api-release-manifest.json"
  docker cp "$bundle_container:/compose/compose.development.api.yml" \
    "$attempt_root/compose.development.api.yml"
  docker rm "$bundle_container" >/dev/null
  bundle_container=""

  PYTHONDONTWRITEBYTECODE=1 python3 "$API_MANIFEST_VALIDATOR" validate \
    --manifest "$attempt_root/api-release-manifest.json" >/dev/null || {
      cleanup_attempt
      echo "API release manifest is structurally invalid." >&2
      exit 1
    }

  compatible=true
  [[ "$bundle_openapi_sha256" == "$EXPECTED_OPENAPI_SHA256" ]] || compatible=false
  validation_output="$(python3 - \
    "$attempt_root/api-release-manifest.json" \
    "$EXPECTED_REPOSITORY" \
    "$immutable_reference" \
    "$EXPECTED_SWAGGER_PATH" <<'PY'
import json
import re
import sys

manifest_path, repository, immutable_reference, expected_swagger_path = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as stream:
    manifest = json.load(stream)

if manifest["source"]["repository"] != repository:
    raise SystemExit("API repository mismatch")
if expected_swagger_path != manifest["endpoints"]["swaggerPath"]:
    raise SystemExit("Swagger path mismatch")
if not re.fullmatch(r"ghcr\.io/[a-z0-9_.-]+/elevant-api@sha256:[0-9a-f]{64}", manifest["images"]["api"]):
    raise SystemExit("API image is not immutable")
print(manifest["source"]["commit"])
print(manifest["source"]["runId"])
print(manifest["images"]["api"])
print(immutable_reference)
PY
  )" || compatible=false
  validation_output="${validation_output//$'\r'/}"

  if [[ "$compatible" == true ]]; then
    mapfile -t proof_lines <<<"$validation_output"
    [[ "${#proof_lines[@]}" -eq 4 ]] || {
      cleanup_attempt
      echo "API compatibility proof has an invalid shape." >&2
      exit 1
    }
    lineage_status=0
    api_lineage_status "${proof_lines[0]}" || lineage_status=$?
    if [[ "$lineage_status" -eq 1 ]]; then
      compatible=false
    elif [[ "$lineage_status" -ne 0 ]]; then
      cleanup_attempt
      echo "API release source is not comparable with the checked-out Development commit." >&2
      exit 1
    fi
  fi

  if [[ "$compatible" == true ]]; then
    image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$immutable_reference")"
    image_source="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' "$immutable_reference")"
    [[ "$image_revision" == "${proof_lines[0]}" ]] || compatible=false
    [[ "$image_source" == "https://github.com/$EXPECTED_REPOSITORY" ]] || compatible=false
  fi

  if [[ "$compatible" == true ]]; then
    install -m 0600 "$attempt_root/api-release-manifest.json" \
      "$OUTPUT_DIRECTORY/api-release-manifest.json"
    install -m 0600 "$attempt_root/compose.development.api.yml" \
      "$OUTPUT_DIRECTORY/compose.development.api.yml"
    printf '%s\n' "${proof_lines[3]}" > \
      "$OUTPUT_DIRECTORY/api-release-manifest-reference.txt"
    printf '%s\n' "$OPENAPI_SHA256" > "$OUTPUT_DIRECTORY/openapi.sha256"
    cleanup_attempt
    trap - EXIT
    echo "API_RELEASE_COMPATIBLE reference=${proof_lines[3]}"
    exit 0
  fi

  cleanup_attempt
  trap - EXIT
  if [[ "$IS_IMMUTABLE" == true ]]; then
    echo "The selected immutable API bundle does not match the checked-in API contract." >&2
    exit 1
  fi
  if (( SECONDS - START_SECONDS >= MAX_WAIT_SECONDS )); then
    echo "Timed out waiting for the API release required by the checked-in API contract." >&2
    exit 1
  fi
  echo "Waiting for the certified Development API bundle required by the checked-in API contract."
  sleep "$POLL_SECONDS"
done
