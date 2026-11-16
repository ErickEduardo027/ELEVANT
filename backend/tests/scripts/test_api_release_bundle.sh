#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)"
readonly DOCKERFILE="$REPOSITORY_ROOT/backend/scripts/deployment/Dockerfile.api-release-bundle"
readonly REVISION="0123456789abcdef0123456789abcdef01234567"
readonly SOURCE="https://github.com/example/elevant"
readonly OPENAPI_SHA256="sha256:1111111111111111111111111111111111111111111111111111111111111111"

temporary_root="$(mktemp -d)"
image="elevant-api-release-bundle-test:${GITHUB_RUN_ID:-local}-${RANDOM}"
container=""
cleanup() {
  if [[ -n "$container" ]]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  docker image rm -f "$image" >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
}
trap cleanup EXIT

install -d "$temporary_root/context/compose" "$temporary_root/extracted/compose"
printf '{"schemaVersion":1}\n' > "$temporary_root/context/manifest.json"
printf 'services: {}\n' \
  > "$temporary_root/context/compose/compose.development.api.yml"

docker build --quiet \
  --build-arg VCS_REF="$REVISION" \
  --build-arg OCI_SOURCE="$SOURCE" \
  --build-arg OCI_CREATED=2026-09-15T00:00:00Z \
  --build-arg OPENAPI_SHA256="$OPENAPI_SHA256" \
  --file "$DOCKERFILE" \
  --tag "$image" \
  "$temporary_root/context" >/dev/null

inspect_label() {
  docker image inspect --format "{{index .Config.Labels \"$1\"}}" "$image"
}

[[ "$(inspect_label org.opencontainers.image.revision)" == "$REVISION" ]]
[[ "$(inspect_label org.opencontainers.image.source)" == "$SOURCE" ]]
[[ "$(inspect_label org.elevant.api.environment)" == Development ]]
[[ "$(inspect_label org.elevant.api.manifest.schema)" == 1 ]]
[[ "$(inspect_label io.elevant.api-release.bundle-version)" == 1 ]]
[[ "$(inspect_label io.elevant.api-release.media-type)" == \
  application/vnd.elevant.api-release-bundle.v1 ]]
[[ "$(inspect_label io.elevant.api-release.openapi-sha256)" == \
  "$OPENAPI_SHA256" ]]

container="$(docker create "$image")"
docker cp "$container:/manifest.json" "$temporary_root/extracted/manifest.json"
docker cp "$container:/compose/compose.development.api.yml" \
  "$temporary_root/extracted/compose/compose.development.api.yml"
cmp -s "$temporary_root/context/manifest.json" \
  "$temporary_root/extracted/manifest.json"
cmp -s "$temporary_root/context/compose/compose.development.api.yml" \
  "$temporary_root/extracted/compose/compose.development.api.yml"

echo "PASS: API release bundle preserves schema v1 payloads and OpenAPI fingerprint metadata."
