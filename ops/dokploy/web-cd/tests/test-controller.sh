#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d)"
REAL_NODE_BIN="$(command -v node)"
trap 'rm -rf -- "$TMP"' EXIT
fail() { printf '%s: FAIL: %s\n' "$PROGRAM_NAME" "$*" >&2; exit 1; }
repeat() { printf '%*s' "$2" '' | tr ' ' "$1"; }
assert_success() { local message="$1"; shift; "$@" >/dev/null 2>"$TMP/error" || { sed 's/^/  /' "$TMP/error" >&2; fail "$message"; }; }
assert_failure() { local message="$1"; shift; if "$@" >/dev/null 2>"$TMP/error"; then fail "$message"; fi; }

BUNDLE_DIGEST="sha256:$(repeat a 64)"
INITIAL_WEB_DIGEST="sha256:$(repeat 1 64)"
WEB_DIGEST="sha256:$(repeat b 64)"
API_BUNDLE_DIGEST="sha256:$(repeat c 64)"
API_IMAGE_DIGEST="sha256:$(repeat d 64)"
COMMIT="$(repeat e 40)"
INITIAL_COMMIT="$(repeat 2 40)"
OPENAPI_REPO=ghcr.io/example/elevant-api-release-manifest
API_REPO=ghcr.io/example/elevant-api
WEB_BUNDLE_REPO=ghcr.io/example/elevant-aviam-web-release-manifest
WEB_REPO=ghcr.io/example/elevant-private-web
API_BUNDLE="$OPENAPI_REPO@$API_BUNDLE_DIGEST"
API_IMAGE="$API_REPO@$API_IMAGE_DIGEST"
INITIAL_WEB_IMAGE="$WEB_REPO@$INITIAL_WEB_DIGEST"
PROBE_IMAGE="docker.io/curlimages/curl@sha256:$(repeat 9 64)"
API_ORIGIN=https://api.example.test

mkdir -p "$TMP/bundle" "$TMP/runtime/state/aviam-web/attempts" "$TMP/runtime/state/aviam-web/tmp" \
  "$TMP/runtime/state/aviam-web/compose/web" "$TMP/runtime/log/aviam-web" "$TMP/docker-config" "$TMP/live" "$TMP/mock-bin"
chmod 0700 "$TMP/runtime/state" "$TMP/runtime/state/aviam-web" "$TMP/runtime/state/aviam-web/attempts" \
  "$TMP/runtime/state/aviam-web/tmp" "$TMP/runtime/state/aviam-web/compose" \
  "$TMP/runtime/state/aviam-web/compose/web" "$TMP/runtime/log/aviam-web"

cat > "$TMP/openapi.json" <<'JSON'
{"openapi":"3.0.4","info":{"title":"Elevant API","version":"v1"},"paths":{"/api/v1/system/ping":{"get":{"operationId":"GetSystemPing"}}}}
JSON
OPENAPI_SHA="$(node "$ROOT/openapi-tool.mjs" hash --file "$TMP/openapi.json")"

cat > "$TMP/bundle/compose.development.web.yml" <<'YAML'
name: elevant-dev-aviam-web
services:
  aviam-web:
    image: "${ELEVANT_AVIAM_WEB_IMAGE:?immutable image required}"
    ports: ["127.0.0.1:18081:8080"]
YAML
cp "$TMP/bundle/compose.development.web.yml" "$TMP/live/docker-compose.yml"
COMPOSE_SHA="$(sha256sum "$TMP/bundle/compose.development.web.yml" | awk '{print $1}')"

write_manifest() {
  local commit="$1" run="$2" image="$3" api_manifest="${4:-$API_BUNDLE}" api_run="${5:-20}" api_image="${6:-$API_IMAGE}" openapi="${7:-$OPENAPI_SHA}"
  cat > "$TMP/bundle/manifest.json" <<JSON
{"schemaVersion":1,"environment":"Development","application":"aviam-web","source":{"repository":"Example/ELEVANT","ref":"refs/heads/Development","commit":"$commit","runId":"$run","runAttempt":1,"workflowUrl":"https://github.com/Example/ELEVANT/actions/runs/$run"},"images":{"web":"$image"},"compose":{"webSha256":"$COMPOSE_SHA"},"api":{"requiredManifest":"$api_manifest","requiredRunId":"$api_run","requiredImage":"$api_image","openApiSha256":"$openapi"},"build":{"configurationSha256":"sha256:$(repeat f 64)"},"endpoints":{"containerPort":8080,"healthPath":"/healthz","smokePaths":["/healthz","/","/dashboard"]},"publishedAt":"2026-09-05T00:00:00Z"}
JSON
}
write_manifest "$COMMIT" 30 "$WEB_REPO@$WEB_DIGEST"

cat > "$TMP/live/.env" <<ENV
ELEVANT_AVIAM_WEB_IMAGE="$INITIAL_WEB_IMAGE"
RESTRICTED_SENTINEL="never-print"
ENV
chmod 0600 "$TMP/live/.env"

write_api_state() {
  local run="$1" image="${2:-$API_IMAGE}" digest="${3:-$API_BUNDLE_DIGEST}"
  cat > "$TMP/api-state.json" <<JSON
{"apiComposeSha256":"$(repeat 1 64)","apiImage":"$image","databaseManifest":"ghcr.io/example/elevant-db-release-manifest@sha256:$(repeat 2 64)","databaseRunId":"10","manifestDigest":"$digest","messageCode":"promotion_succeeded","migrationFingerprint":"sha256:$(repeat 3 64)","modelFingerprint":"sha256:$(repeat 4 64)","rollbackStatus":"not-required","sourceCommit":"$(repeat 5 40)","sourceRunAttempt":"1","sourceRunId":"$run","stage":"complete","status":"succeeded","updatedAt":"2026-09-05T00:00:00Z","workflowUrl":"https://github.com/Example/ELEVANT/actions/runs/$run"}
JSON
  chmod 0600 "$TMP/api-state.json"
}
write_api_state 19

: > "$TMP/database.lock"; : > "$TMP/api.lock"; chmod 0600 "$TMP/database.lock" "$TMP/api.lock"
cat > "$TMP/config.env" <<ENV
ELEVANT_WEB_CD_APPLICATION=aviam-web
ELEVANT_WEB_CD_MANIFEST_REPOSITORY=$WEB_BUNDLE_REPO
ELEVANT_WEB_CD_MANIFEST_ALIAS=development-certified
ELEVANT_WEB_CD_EXPECTED_REPOSITORY=Example/ELEVANT
ELEVANT_WEB_CD_EXPECTED_REF=refs/heads/Development
ELEVANT_WEB_CD_WEB_REPOSITORY=$WEB_REPO
ELEVANT_WEB_CD_API_MANIFEST_REPOSITORY=$OPENAPI_REPO
ELEVANT_WEB_CD_API_IMAGE_REPOSITORY=$API_REPO
ELEVANT_WEB_CD_API_STATE=$TMP/api-state.json
ELEVANT_WEB_CD_API_LOCK=$TMP/api.lock
ELEVANT_WEB_CD_API_PROJECT=elevant-dev-api-test
ELEVANT_WEB_CD_API_SERVICE=api
ELEVANT_WEB_CD_API_CONTAINER_PORT=8080
ELEVANT_WEB_CD_API_OPENAPI_PATH=/swagger/v1/swagger.json
ELEVANT_WEB_CD_HTTP_PROBE_IMAGE=$PROBE_IMAGE
ELEVANT_WEB_CD_EXPECTED_API_ORIGIN=$API_ORIGIN
ELEVANT_WEB_CD_DATABASE_LOCK=$TMP/database.lock
ELEVANT_WEB_CD_DOCKER_CONFIG=$TMP/docker-config
ELEVANT_WEB_CD_PROJECT=elevant-dev-aviam-web-test
ELEVANT_WEB_CD_COMPOSE=$TMP/live/docker-compose.yml
ELEVANT_WEB_CD_ENV=$TMP/live/.env
ELEVANT_WEB_CD_SERVICE=aviam-web
ELEVANT_WEB_CD_IMAGE_ENV=ELEVANT_AVIAM_WEB_IMAGE
ELEVANT_WEB_CD_STATE_DIR=$TMP/runtime/state/aviam-web
ELEVANT_WEB_CD_LOG_DIR=$TMP/runtime/log/aviam-web
ELEVANT_WEB_CD_GLOBAL_LOCK=$TMP/runtime/state/controller.lock
ELEVANT_WEB_CD_LOCK_FILE=$TMP/runtime/state/aviam-web/controller.lock
ENV
chmod 0600 "$TMP/config.env"

cat > "$TMP/mock-bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
increment_counter() {
  local file="$1" value=0
  [[ ! -f "$file" ]] || value="$(<"$file")"
  value=$((value + 1))
  printf '%s\n' "$value" > "$file"
  printf '%s\n' "$value"
}
counter_selected() {
  local selected=",${1:-}," value="$2"
  [[ "$selected" == *",$value,"* ]]
}
record_last_success() {
  local checkpoint="$1" digest=missing
  if [[ -f "$MOCK_LAST_SUCCESS_STATE" ]]; then
    digest="$(sha256sum "$MOCK_LAST_SUCCESS_STATE" | awk '{print $1}')"
  fi
  printf 'LAST_SUCCESS:%s:%s\n' "$checkpoint" "$digest" >> "$MOCK_DOCKER_LOG"
}
printf 'image=%s|%s\n' "${ELEVANT_AVIAM_WEB_IMAGE:-}" "$*" >> "$MOCK_DOCKER_LOG"
case "${1:-} ${2:-}" in
  version*) exit 0 ;;
  pull*)
    if [[ -e "$MOCK_REGISTRY_DOWN" ]]; then
      printf '%s\n' REGISTRY_UNAVAILABLE >> "$MOCK_DOCKER_LOG"
      exit 69
    fi
    ;;
  create*) printf '%s\n' "${2:-}" > "$MOCK_LAST_CREATED"; printf '%064d\n' 0; exit 0 ;;
  rm*) exit 0 ;;
  cp*)
    source="${2#*:}"; destination="$3"
    case "$source" in
      /manifest.json) cp "$MOCK_BUNDLE/manifest.json" "$destination" ;;
      /compose/compose.development.web.yml) cp "$MOCK_BUNDLE/compose.development.web.yml" "$destination" ;;
      *) exit 1 ;;
    esac
    exit 0
    ;;
  "image inspect")
    format="$4"; reference="$5"
    case "$format" in
      *RepoDigests*) printf '%s@%s\n' "$MOCK_BUNDLE_REPO" "$MOCK_ACTIVE_BUNDLE_DIGEST" ;;
      *org.opencontainers.image.revision*)
        if [[ "$reference" == "$MOCK_BASELINE_WEB_IMAGE" ]]; then printf '%s\n' "$MOCK_BASELINE_COMMIT"; else printf '%s\n' "$MOCK_ACTIVE_COMMIT"; fi ;;
      *org.opencontainers.image.source*) printf '%s\n' 'https://github.com/Example/ELEVANT' ;;
      *io.elevant.application*) printf '%s\n' aviam-web ;;
      *io.elevant.environment*) printf '%s\n' Development ;;
      *io.elevant.source.run-id*)
        if [[ "$reference" == "$MOCK_BASELINE_WEB_IMAGE" ]]; then printf '%s\n' "$MOCK_BASELINE_RUN"; else printf '%s\n' "$MOCK_ACTIVE_RUN"; fi ;;
      *io.elevant.api.required-manifest*)
        if [[ "$reference" == "$MOCK_BASELINE_WEB_IMAGE" ]]; then printf '%s\n' "$MOCK_BASELINE_API_BUNDLE"; else printf '%s\n' "$MOCK_IMAGE_API_BUNDLE"; fi ;;
      *io.elevant.openapi.sha256*)
        if [[ "$reference" == "$MOCK_BASELINE_WEB_IMAGE" ]]; then printf '%s\n' "$MOCK_BASELINE_OPENAPI_SHA"; else printf '%s\n' "$MOCK_IMAGE_OPENAPI_SHA"; fi ;;
      *io.elevant.web.api-origin*) printf '%s\n' "$MOCK_API_ORIGIN_LABEL" ;;
      *io.elevant.web-release.schema-version*) printf '%s\n' 1 ;;
      *io.elevant.web-release.bundle-version*) printf '%s\n' 1 ;;
      *io.elevant.web-release.media-type*) printf '%s\n' application/vnd.elevant.web-release-bundle.v1 ;;
      *) printf 'unexpected inspect format: %s\n' "$format" >&2; exit 1 ;;
    esac
    ;;
  "compose version") exit 0 ;;
  "container ls")
    if [[ " $* " == *" label=com.docker.compose.project=elevant-dev-api-test "* ]]; then
      case "${MOCK_API_CONTAINER_COUNT:-1}" in
        0) : ;;
        1) printf '%064d\n' 9 ;;
        2) printf '%064d\n%064d\n' 9 7 ;;
        *) exit 1 ;;
      esac
    else
      printf '%064d\n' 8
    fi
    ;;
  "container inspect")
    if [[ "${5:-}" == "$(printf '%064d' 9)" ]]; then
      printf 'running|healthy|0|%s\n' "$MOCK_API_IMAGE"
    else
      runtime=""; [[ ! -f "$MOCK_RUNTIME_IMAGE" ]] || runtime="$(<"$MOCK_RUNTIME_IMAGE")"
      [[ -n "$runtime" ]] || runtime="$MOCK_DEFAULT_WEB_IMAGE"
      health_number="$(increment_counter "$MOCK_WEB_HEALTH_COUNT")"
      printf 'WEB_HEALTH:%s:%s\n' "$health_number" "$runtime" >> "$MOCK_DOCKER_LOG"
      record_last_success "health-$health_number"
      if counter_selected "$MOCK_FAIL_WEB_HEALTH_NUMBERS" "$health_number" || { [[ -n "$MOCK_FAIL_HEALTH_IMAGE" ]] && [[ "$runtime" == "$MOCK_FAIL_HEALTH_IMAGE" ]]; }; then
        printf 'running|unhealthy|0|%s\n' "$runtime"
      else
        printf 'running|healthy|0|%s\n' "$runtime"
      fi
    fi
    ;;
  "container exec")
    [[ "${4:-}" == wget ]]
    runtime=""; [[ ! -f "$MOCK_RUNTIME_IMAGE" ]] || runtime="$(<"$MOCK_RUNTIME_IMAGE")"
    smoke_number="$(increment_counter "$MOCK_WEB_SMOKE_COUNT")"
    printf 'WEB_SMOKE:%s:%s:%s\n' "$smoke_number" "$runtime" "${10:-}" >> "$MOCK_DOCKER_LOG"
    record_last_success "smoke-$smoke_number"
    printf 'SMOKE_EXECUTED:%s\n' "${10:-}" >> "$MOCK_DOCKER_LOG"
    if counter_selected "$MOCK_FAIL_WEB_SMOKE_NUMBERS" "$smoke_number"; then exit 22; fi
    ;;
  run*)
    [[ "${MOCK_PROBE_FAIL:-0}" == 0 ]] || exit 22
    cat "$MOCK_OPENAPI"
    ;;
  compose*)
    case " $* " in
      *" --format json "*) printf '%s\n' '{"name":"test","services":{"aviam-web":{"image":"${ELEVANT_AVIAM_WEB_IMAGE}"}}}' ;;
      *" config --quiet "*)
        config_number="$(increment_counter "$MOCK_WEB_COMPOSE_CONFIG_COUNT")"
        printf 'WEB_CONFIG:%s:%s\n' "$config_number" "${ELEVANT_AVIAM_WEB_IMAGE:-}" >> "$MOCK_DOCKER_LOG"
        if counter_selected "$MOCK_FAIL_WEB_COMPOSE_CONFIG_NUMBERS" "$config_number"; then exit 78; fi
        ;;
      *" up -d --pull never --no-build --no-deps --force-recreate aviam-web "*)
        up_number="$(increment_counter "$MOCK_WEB_UP_COUNT")"
        printf '%s\n' "${ELEVANT_AVIAM_WEB_IMAGE:-}" > "$MOCK_RUNTIME_IMAGE"
        printf 'WEB_UP:%s:%s\n' "$up_number" "${ELEVANT_AVIAM_WEB_IMAGE:-}" >> "$MOCK_DOCKER_LOG"
        record_last_success "up-$up_number"
        [[ "${MOCK_ARM_REGISTRY_OUTAGE:-0}" == 0 ]] || : > "$MOCK_REGISTRY_DOWN"
        if [[ "$MOCK_INTERRUPT_WEB_UP_NUMBER" == "$up_number" ]]; then
          kill -TERM "$PPID"
        fi
        if counter_selected "$MOCK_FAIL_WEB_UP_NUMBERS" "$up_number"; then exit 1; fi
        ;;
      *) exit 0 ;;
    esac
    ;;
  *) printf 'unexpected docker call: %s\n' "$*" >&2; exit 1 ;;
esac
MOCK
chmod 0555 "$TMP/mock-bin/docker"

cat > "$TMP/mock-node" <<'MOCK'
#!/usr/bin/env bash
set -eu
if [[ "${1:-}" == "$MOCK_STATE_TOOL" && "${2:-}" == write ]]; then
  count=0
  [[ ! -f "$MOCK_NODE_WRITE_COUNT" ]] || count="$(<"$MOCK_NODE_WRITE_COUNT")"
  count=$((count + 1))
  printf '%s\n' "$count" > "$MOCK_NODE_WRITE_COUNT"
  if [[ "$count" == "$MOCK_FAIL_STATE_WRITE_NUMBER" ]]; then exit 75; fi
  if [[ -n "$MOCK_SIGNAL_AFTER_STATE_FILE" && "${4:-}" == "$MOCK_SIGNAL_AFTER_STATE_FILE" ]]; then
    "$MOCK_REAL_NODE" "$@"
    status=$?
    if (( status == 0 )); then kill -TERM "$PPID"; fi
    exit "$status"
  fi
fi
exec "$MOCK_REAL_NODE" "$@"
MOCK
chmod 0555 "$TMP/mock-node"

cat > "$TMP/mock-bin/flock" <<'MOCK'
#!/usr/bin/env sh
printf '%s\n' "$*" >> "$MOCK_LOCK_LOG"
exit 0
MOCK
chmod 0555 "$TMP/mock-bin/flock"
: > "$TMP/docker.log"; : > "$TMP/lock.log"

controller() {
  MOCK_BUNDLE="$TMP/bundle" MOCK_OPENAPI="$TMP/openapi.json" MOCK_DOCKER_LOG="$TMP/docker.log" \
  MOCK_LOCK_LOG="$TMP/lock.log" MOCK_LAST_CREATED="$TMP/last-created" MOCK_BUNDLE_REPO="$WEB_BUNDLE_REPO" \
  MOCK_ACTIVE_BUNDLE_DIGEST="${ACTIVE_BUNDLE_DIGEST:-$BUNDLE_DIGEST}" MOCK_ACTIVE_COMMIT="${ACTIVE_COMMIT:-$COMMIT}" \
  MOCK_ACTIVE_RUN="${ACTIVE_RUN:-30}" MOCK_BASELINE_WEB_IMAGE="${BASELINE_WEB_IMAGE:-$INITIAL_WEB_IMAGE}" \
  MOCK_BASELINE_COMMIT="${BASELINE_COMMIT:-$INITIAL_COMMIT}" MOCK_BASELINE_RUN="${BASELINE_RUN:-29}" \
  MOCK_BASELINE_API_BUNDLE="${BASELINE_API_BUNDLE:-$API_BUNDLE}" MOCK_BASELINE_OPENAPI_SHA="${BASELINE_OPENAPI_SHA:-$OPENAPI_SHA}" \
  MOCK_IMAGE_API_BUNDLE="${IMAGE_API_BUNDLE:-$API_BUNDLE}" MOCK_IMAGE_OPENAPI_SHA="${IMAGE_OPENAPI_SHA:-$OPENAPI_SHA}" \
  MOCK_DEFAULT_WEB_IMAGE="${RUNTIME_WEB_IMAGE:-${BASELINE_WEB_IMAGE:-$INITIAL_WEB_IMAGE}}" \
  MOCK_API_BUNDLE="$API_BUNDLE" MOCK_API_IMAGE="${RUNTIME_API_IMAGE:-$API_IMAGE}" MOCK_OPENAPI_SHA="$OPENAPI_SHA" MOCK_OPENAPI="$TMP/openapi.json" MOCK_RUNTIME_IMAGE="$TMP/runtime-image" \
  MOCK_API_ORIGIN_LABEL="${IMAGE_API_ORIGIN:-$API_ORIGIN}" \
  MOCK_API_CONTAINER_COUNT="${API_CONTAINER_COUNT:-1}" \
  MOCK_PROBE_FAIL="${PROBE_FAIL:-0}" \
  MOCK_ARM_REGISTRY_OUTAGE="${ARM_REGISTRY_OUTAGE:-0}" MOCK_REGISTRY_DOWN="$TMP/registry-down" \
  MOCK_FAIL_HEALTH_IMAGE="${FAIL_HEALTH_IMAGE:-}" MOCK_FAIL_WEB_HEALTH_NUMBERS="${FAIL_WEB_HEALTH_NUMBERS:-}" \
  MOCK_FAIL_WEB_SMOKE_NUMBERS="${FAIL_WEB_SMOKE_NUMBERS:-}" MOCK_FAIL_WEB_UP_NUMBERS="${FAIL_WEB_UP_NUMBERS:-}" \
  MOCK_FAIL_WEB_COMPOSE_CONFIG_NUMBERS="${FAIL_WEB_COMPOSE_CONFIG_NUMBERS:-}" \
  MOCK_INTERRUPT_WEB_UP_NUMBER="${INTERRUPT_WEB_UP_NUMBER:-}" \
  MOCK_WEB_COMPOSE_CONFIG_COUNT="$TMP/web-config-count" MOCK_WEB_HEALTH_COUNT="$TMP/web-health-count" \
  MOCK_WEB_SMOKE_COUNT="$TMP/web-smoke-count" MOCK_WEB_UP_COUNT="$TMP/web-up-count" \
  MOCK_LAST_SUCCESS_STATE="$TMP/runtime/state/aviam-web/last-success.json" ELEVANT_WEB_CD_TEST_MODE=1 \
  MOCK_REAL_NODE="$REAL_NODE_BIN" MOCK_STATE_TOOL="$ROOT/state-tool.mjs" MOCK_NODE_WRITE_COUNT="$TMP/node-write-count" \
  MOCK_FAIL_STATE_WRITE_NUMBER="${FAIL_STATE_WRITE_NUMBER:-}" MOCK_SIGNAL_AFTER_STATE_FILE="${SIGNAL_AFTER_STATE_FILE:-}" \
  ELEVANT_WEB_CD_NODE_BIN="${CONTROLLER_NODE_BIN:-$REAL_NODE_BIN}" \
  ELEVANT_WEB_CD_TEST_DATABASE_LOCK="$TMP/database.lock" ELEVANT_WEB_CD_TEST_API_LOCK="$TMP/api.lock" \
  ELEVANT_WEB_CD_TEST_GLOBAL_LOCK="$TMP/runtime/state/controller.lock" \
  ELEVANT_WEB_CD_DOCKER_BIN="$TMP/mock-bin/docker" \
  ELEVANT_WEB_CD_WAIT_ATTEMPTS=1 ELEVANT_WEB_CD_WAIT_INTERVAL=0 PATH="$TMP/mock-bin:$PATH" \
    "$ROOT/elevant-web-cd" --app aviam-web --config "$TMP/config.env" "$@"
}

assert_failure "controller accepted one profile's config for another" env \
  ELEVANT_WEB_CD_TEST_MODE=1 ELEVANT_WEB_CD_DOCKER_BIN="$TMP/mock-bin/docker" \
  ELEVANT_WEB_CD_TEST_DATABASE_LOCK="$TMP/database.lock" ELEVANT_WEB_CD_TEST_API_LOCK="$TMP/api.lock" \
  ELEVANT_WEB_CD_TEST_GLOBAL_LOCK="$TMP/runtime/state/controller.lock" \
  PATH="$TMP/mock-bin:$PATH" \
  "$ROOT/elevant-web-cd" --app public-web --config "$TMP/config.env" --status

sed "s#^ELEVANT_WEB_CD_GLOBAL_LOCK=.*#ELEVANT_WEB_CD_GLOBAL_LOCK=$TMP/runtime/state/typo.lock#" \
  "$TMP/config.env" > "$TMP/bad-global-lock.env"
chmod 0600 "$TMP/bad-global-lock.env"
assert_failure "cross-profile global lock typo was accepted" env \
  ELEVANT_WEB_CD_TEST_MODE=1 ELEVANT_WEB_CD_TEST_DATABASE_LOCK="$TMP/database.lock" ELEVANT_WEB_CD_TEST_API_LOCK="$TMP/api.lock" \
  ELEVANT_WEB_CD_TEST_GLOBAL_LOCK="$TMP/runtime/state/controller.lock" \
  ELEVANT_WEB_CD_DOCKER_BIN="$TMP/mock-bin/docker" PATH="$TMP/mock-bin:$PATH" \
  "$ROOT/elevant-web-cd" --app aviam-web --config "$TMP/bad-global-lock.env" --status
grep -q 'canonical shared path' "$TMP/error" || fail "global lock typo failure was not explained"

sed "s#^ELEVANT_WEB_CD_DATABASE_LOCK=.*#ELEVANT_WEB_CD_DATABASE_LOCK=$TMP/database-typo.lock#" \
  "$TMP/config.env" > "$TMP/bad-database-lock.env"
chmod 0600 "$TMP/bad-database-lock.env"
assert_failure "database controller lock typo was accepted" env \
  ELEVANT_WEB_CD_TEST_MODE=1 ELEVANT_WEB_CD_TEST_DATABASE_LOCK="$TMP/database.lock" ELEVANT_WEB_CD_TEST_API_LOCK="$TMP/api.lock" \
  ELEVANT_WEB_CD_TEST_GLOBAL_LOCK="$TMP/runtime/state/controller.lock" \
  ELEVANT_WEB_CD_DOCKER_BIN="$TMP/mock-bin/docker" PATH="$TMP/mock-bin:$PATH" \
  "$ROOT/elevant-web-cd" --app aviam-web --config "$TMP/bad-database-lock.env" --status
grep -q 'canonical Database CD path' "$TMP/error" || fail "database lock typo failure was not explained"

sed "s#^ELEVANT_WEB_CD_API_LOCK=.*#ELEVANT_WEB_CD_API_LOCK=$TMP/api-typo.lock#" \
  "$TMP/config.env" > "$TMP/bad-api-lock.env"
chmod 0600 "$TMP/bad-api-lock.env"
assert_failure "API controller lock typo was accepted" env \
  ELEVANT_WEB_CD_TEST_MODE=1 ELEVANT_WEB_CD_TEST_DATABASE_LOCK="$TMP/database.lock" ELEVANT_WEB_CD_TEST_API_LOCK="$TMP/api.lock" \
  ELEVANT_WEB_CD_TEST_GLOBAL_LOCK="$TMP/runtime/state/controller.lock" \
  ELEVANT_WEB_CD_DOCKER_BIN="$TMP/mock-bin/docker" PATH="$TMP/mock-bin:$PATH" \
  "$ROOT/elevant-web-cd" --app aviam-web --config "$TMP/bad-api-lock.env" --status
grep -q 'canonical API CD path' "$TMP/error" || fail "API lock typo failure was not explained"

sed "s#^ELEVANT_WEB_CD_DATABASE_LOCK=.*#ELEVANT_WEB_CD_DATABASE_LOCK=$TMP/runtime/state/aviam-web/controller.lock#" \
  "$TMP/config.env" > "$TMP/colliding-lock.env"
chmod 0600 "$TMP/colliding-lock.env"
assert_failure "non-adjacent lock collision was accepted" env \
  ELEVANT_WEB_CD_TEST_MODE=1 ELEVANT_WEB_CD_TEST_DATABASE_LOCK="$TMP/runtime/state/aviam-web/controller.lock" ELEVANT_WEB_CD_TEST_API_LOCK="$TMP/api.lock" \
  ELEVANT_WEB_CD_TEST_GLOBAL_LOCK="$TMP/runtime/state/controller.lock" \
  ELEVANT_WEB_CD_DOCKER_BIN="$TMP/mock-bin/docker" PATH="$TMP/mock-bin:$PATH" \
  "$ROOT/elevant-web-cd" --app aviam-web --config "$TMP/colliding-lock.env" --status
grep -q 'pairwise distinct' "$TMP/error" || fail "pairwise lock failure was not explained"

sed 's#^ELEVANT_WEB_CD_EXPECTED_API_ORIGIN=.*#ELEVANT_WEB_CD_EXPECTED_API_ORIGIN=https://127.0.0.1#' \
  "$TMP/config.env" > "$TMP/loopback-origin.env"
chmod 0600 "$TMP/loopback-origin.env"
assert_failure "loopback API origin was accepted" env \
  ELEVANT_WEB_CD_TEST_MODE=1 ELEVANT_WEB_CD_TEST_DATABASE_LOCK="$TMP/database.lock" ELEVANT_WEB_CD_TEST_API_LOCK="$TMP/api.lock" \
  ELEVANT_WEB_CD_TEST_GLOBAL_LOCK="$TMP/runtime/state/controller.lock" \
  ELEVANT_WEB_CD_DOCKER_BIN="$TMP/mock-bin/docker" PATH="$TMP/mock-bin:$PATH" \
  "$ROOT/elevant-web-cd" --app aviam-web --config "$TMP/loopback-origin.env" --status
grep -q 'non-loopback HTTPS origin' "$TMP/error" || fail "invalid API origin failure was not explained"
for invalid_origin in http://api.example.test https://api.example.test/; do
  sed "s#^ELEVANT_WEB_CD_EXPECTED_API_ORIGIN=.*#ELEVANT_WEB_CD_EXPECTED_API_ORIGIN=$invalid_origin#" \
    "$TMP/config.env" > "$TMP/invalid-origin.env"
  chmod 0600 "$TMP/invalid-origin.env"
  assert_failure "non-canonical API origin was accepted: $invalid_origin" env \
    ELEVANT_WEB_CD_TEST_MODE=1 ELEVANT_WEB_CD_TEST_DATABASE_LOCK="$TMP/database.lock" ELEVANT_WEB_CD_TEST_API_LOCK="$TMP/api.lock" \
    ELEVANT_WEB_CD_TEST_GLOBAL_LOCK="$TMP/runtime/state/controller.lock" \
    ELEVANT_WEB_CD_DOCKER_BIN="$TMP/mock-bin/docker" PATH="$TMP/mock-bin:$PATH" \
    "$ROOT/elevant-web-cd" --app aviam-web --config "$TMP/invalid-origin.env" --status
done

IMAGE_API_ORIGIN=https://wrong-api.example.test
assert_failure "web image with a different API origin was accepted" controller --dry-run
grep -q 'API origin label mismatch' "$TMP/error" || fail "image API origin mismatch was not explained"
unset IMAGE_API_ORIGIN

# Exact API mismatch defers without creating an attempt or touching the image.
set +e
controller --dry-run >/dev/null 2>"$TMP/error"
status=$?
set -e
[[ "$status" == 2 ]] || fail "dry-run did not preserve API deferral rc=2"
grep -q 'deployment deferred' "$TMP/error" || fail "API deferral was not explained"
assert_success "poll did not safely defer an inactive API requirement" controller --poll
[[ ! -e "$TMP/runtime/state/aviam-web/current.json" ]] || fail "deferred poll created state"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$INITIAL_WEB_IMAGE\"" "$TMP/live/.env" || fail "deferred poll changed image"

write_api_state 20 "$API_REPO@sha256:$(repeat 0 64)"
assert_success "poll did not defer the wrong API image" controller --poll
[[ ! -e "$TMP/runtime/state/aviam-web/current.json" ]] || fail "wrong API image created an attempt"

write_api_state 20
API_CONTAINER_COUNT=0
assert_failure "missing API container was trusted" controller --dry-run
grep -q 'exactly one running API Compose container' "$TMP/error" || fail "missing API container failure was not explained"
API_CONTAINER_COUNT=2
assert_failure "multiple API containers were trusted" controller --dry-run
grep -q 'exactly one running API Compose container' "$TMP/error" || fail "multiple API container failure was not explained"
unset API_CONTAINER_COUNT
PROBE_FAIL=1
assert_failure "failed namespace probe was accepted" controller --dry-run
grep -q 'could not retrieve OpenAPI from the API container namespace' "$TMP/error" || fail "namespace probe failure was not explained"
unset PROBE_FAIL
RUNTIME_API_IMAGE="$API_REPO@sha256:$(repeat a 64)"
assert_failure "API container image different from accepted state was trusted" controller --dry-run
grep -q 'identity, image or health' "$TMP/error" || fail "API container identity failure was not explained"
unset RUNTIME_API_IMAGE
cp "$TMP/openapi.json" "$TMP/openapi.saved"
printf '%s\n' '{"openapi":"3.0.4","info":{"title":"drift","version":"v1"},"paths":{}}' > "$TMP/openapi.json"
assert_failure "live OpenAPI drift was accepted" controller --dry-run
grep -q 'OpenAPI differs' "$TMP/error" || fail "OpenAPI integrity failure was not explained"
mv "$TMP/openapi.saved" "$TMP/openapi.json"
assert_success "valid dry-run was rejected" controller --dry-run
grep -Fq -- '--filter label=com.docker.compose.project=elevant-dev-api-test --filter label=com.docker.compose.service=api' "$TMP/docker.log" || fail "API discovery did not use exact Compose labels"
grep -F '|run --rm ' "$TMP/docker.log" > "$TMP/probe.log"
grep -Fq -- "--network container:$(printf '%064d' 9)" "$TMP/probe.log" || fail "OpenAPI probe did not share the exact API namespace"
grep -Fq -- "$PROBE_IMAGE --fail --silent" "$TMP/probe.log" || fail "OpenAPI probe did not use the immutable probe image"
grep -Fq -- '--read-only --cap-drop ALL --security-opt no-new-privileges:true' "$TMP/probe.log" || fail "OpenAPI probe was not sufficiently constrained"
grep -Fq -- '--pids-limit 32 --memory 64m --cpus 0.10' "$TMP/probe.log" || fail "OpenAPI probe resource limits were omitted"
! grep -Fq '127.0.0.1:18080' "$TMP/probe.log" || fail "controller incorrectly used Dokploy loopback"
grep -Fq 'http://127.0.0.1:8080/swagger/v1/swagger.json' "$TMP/probe.log" || fail "probe did not request Swagger inside the API namespace"
! grep -Eq -- '(^|[[:space:]])(--publish|-p)([=[:space:]]|$)' "$TMP/probe.log" || fail "OpenAPI probe published a port"
! grep -Fq -- '--network elevant-dev-api-runtime' "$TMP/probe.log" || fail "OpenAPI probe joined the API network by name"
[[ "$(sed -n '1p' "$TMP/lock.log")" == '-n 7' ]] || fail "database lock was not acquired first"
[[ "$(sed -n '2p' "$TMP/lock.log")" == '-n 8' ]] || fail "API lock was not acquired second"
[[ "$(sed -n '3p' "$TMP/lock.log")" == '-n 9' ]] || fail "global web lock was not acquired third"
[[ "$(sed -n '4p' "$TMP/lock.log")" == '-n 10' ]] || fail "profile lock was not acquired last"

RUNTIME_WEB_IMAGE="$WEB_REPO@sha256:$(repeat 0 64)"
assert_failure "healthy container with the wrong web image was adopted" controller --adopt-current
grep -q 'does not use its configured image' "$TMP/error" || fail "adoption image mismatch was not explained"
unset RUNTIME_WEB_IMAGE
assert_success "healthy live baseline could not be adopted" controller --adopt-current
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/last-success.json" --field status)" == adopted ]] || fail "adoption was not persisted"
grep -Fq 'SMOKE_EXECUTED:http://127.0.0.1:8080/dashboard' "$TMP/docker.log" || fail "adoption omitted the AVIAM workflow smoke route"
assert_failure "a second baseline adoption was accepted" controller --adopt-current

assert_success "pause failed" controller --pause
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "pause marker was not created"
before="$(wc -l < "$TMP/docker.log")"; assert_success "paused poll was not a no-op" controller --poll; after="$(wc -l < "$TMP/docker.log")"
[[ "$before" == "$after" ]] || fail "paused poll invoked Docker"
assert_success "resume failed" controller --resume
[[ ! -e "$TMP/runtime/state/aviam-web/paused" ]] || fail "resume did not remove pause marker"

case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *)
    chmod 0644 "$TMP/live/.env"
    assert_failure "world-readable web environment was accepted" controller --dry-run
    chmod 0600 "$TMP/live/.env"
    ;;
esac

LIVE_COMPOSE_BEFORE="$(sha256sum "$TMP/live/docker-compose.yml" | awk '{print $1}')"
: > "$TMP/docker.log"
assert_success "compatible web promotion failed" controller --poll
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/last-success.json" --field status)" == succeeded ]] || fail "success was not persisted"
grep -q SMOKE_EXECUTED "$TMP/docker.log" || fail "promotion omitted in-container smoke"
grep -Fq 'SMOKE_EXECUTED:http://127.0.0.1:8080/dashboard' "$TMP/docker.log" || fail "promotion omitted the AVIAM workflow smoke route"
! grep -Eq '(^|[| ])down([ |]|$)' "$TMP/docker.log" || fail "controller invoked docker compose down"
grep -Fq 'up -d --pull never --no-build --no-deps --force-recreate aviam-web' "$TMP/docker.log" || fail "promotion did not forbid registry pulls"
! grep -Eq '\|compose .* pull( |$)' "$TMP/docker.log" || fail "promotion invoked an explicit Compose pull"
[[ "$(sha256sum "$TMP/live/docker-compose.yml" | awk '{print $1}')" == "$LIVE_COMPOSE_BEFORE" ]] || fail "controller rewrote live Compose"
grep -q 'RESTRICTED_SENTINEL="never-print"' "$TMP/live/.env" || fail "promotion damaged unrelated environment"

# A safe rollback drill promotes a new candidate B, proves rollback to the
# accepted baseline A, and re-promotes B without accepting B until every leg
# has passed. Each scenario starts from the exact same healthy A state.
DRILL_BUNDLE_DIGEST="sha256:$(repeat 3 64)"
DRILL_WEB_DIGEST="sha256:$(repeat 4 64)"
DRILL_WEB_IMAGE="$WEB_REPO@$DRILL_WEB_DIGEST"
DRILL_COMMIT="$(repeat 5 40)"
DRILL_RUN=31
DRILL_BASELINE_WEB_IMAGE="$WEB_REPO@$WEB_DIGEST"
DRILL_BASELINE_STATE="$TMP/drill-baseline-last-success.json"
DRILL_BASELINE_CURRENT="$TMP/drill-baseline-current.json"
cp "$TMP/runtime/state/aviam-web/last-success.json" "$DRILL_BASELINE_STATE"
cp "$TMP/runtime/state/aviam-web/current.json" "$DRILL_BASELINE_CURRENT"
DRILL_BASELINE_STATE_HASH="$(sha256sum "$DRILL_BASELINE_STATE" | awk '{print $1}')"
DRILL_BASELINE_CURRENT_HASH="$(sha256sum "$DRILL_BASELINE_CURRENT" | awk '{print $1}')"

reset_drill_fixture() {
  cp "$DRILL_BASELINE_STATE" "$TMP/runtime/state/aviam-web/last-success.json"
  cp "$DRILL_BASELINE_CURRENT" "$TMP/runtime/state/aviam-web/current.json"
  chmod 0600 "$TMP/runtime/state/aviam-web/last-success.json" "$TMP/runtime/state/aviam-web/current.json"
  rm -f "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" \
    "$TMP/registry-down" "$TMP/web-config-count" "$TMP/web-health-count" "$TMP/web-smoke-count" "$TMP/web-up-count" "$TMP/node-write-count"
  printf 'paused\n' > "$TMP/runtime/state/aviam-web/paused"
  chmod 0600 "$TMP/runtime/state/aviam-web/paused"
  node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_BASELINE_WEB_IMAGE"
  printf '%s\n' "$DRILL_BASELINE_WEB_IMAGE" > "$TMP/runtime-image"
  : > "$TMP/docker.log"
  : > "$TMP/error"
  unset FAIL_WEB_COMPOSE_CONFIG_NUMBERS FAIL_WEB_HEALTH_NUMBERS FAIL_WEB_SMOKE_NUMBERS FAIL_WEB_UP_NUMBERS INTERRUPT_WEB_UP_NUMBER \
    IMAGE_API_BUNDLE IMAGE_OPENAPI_SHA RUNTIME_API_IMAGE BASELINE_API_BUNDLE BASELINE_OPENAPI_SHA ARM_REGISTRY_OUTAGE \
    CONTROLLER_NODE_BIN FAIL_STATE_WRITE_NUMBER SIGNAL_AFTER_STATE_FILE
  ACTIVE_BUNDLE_DIGEST="$DRILL_BUNDLE_DIGEST"
  ACTIVE_COMMIT="$DRILL_COMMIT"
  ACTIVE_RUN="$DRILL_RUN"
  BASELINE_WEB_IMAGE="$DRILL_BASELINE_WEB_IMAGE"
  BASELINE_COMMIT="$COMMIT"
  BASELINE_RUN=30
  write_api_state 20
  write_manifest "$DRILL_COMMIT" "$DRILL_RUN" "$DRILL_WEB_IMAGE"
}

assert_no_drill_mutation() {
  local context="$1"
  ! grep -q '^WEB_UP:' "$TMP/docker.log" || fail "$context invoked Compose up"
  [[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "$context changed the runtime image"
  grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_BASELINE_WEB_IMAGE\"" "$TMP/live/.env" || fail "$context changed the web environment"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$DRILL_BASELINE_STATE_HASH" ]] || fail "$context changed last-success"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$DRILL_BASELINE_CURRENT_HASH" ]] || fail "$context changed current state"
}

assert_selector_failed_closed() {
  local context="$1"
  ! grep -Eq '\|pull( |$)' "$TMP/docker.log" || fail "$context pulled an image"
  ! grep -q '^WEB_UP:' "$TMP/docker.log" || fail "$context invoked Compose up"
  [[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "$context changed the runtime image"
  grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_BASELINE_WEB_IMAGE\"" "$TMP/live/.env" || fail "$context changed the web environment"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$DRILL_BASELINE_STATE_HASH" ]] || fail "$context changed last-success"
  [[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "$context unpaused the profile"
  [[ ! -e "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" ]] || fail "$context created a candidate attempt"
}

assert_only_docker_readiness_checks() {
  local context="$1"
  local -a calls=()
  mapfile -t calls < <(sed 's/^[^|]*|//' "$TMP/docker.log")
  [[ "${#calls[@]}" -eq 2 ]] || fail "$context performed more than Docker readiness checks"
  [[ "${calls[0]}" == version ]] || fail "$context did not limit Docker access to readiness checks"
  [[ "${calls[1]}" == "compose version" ]] || fail "$context did not limit Compose access to readiness checks"
}

assert_failed_drill_state() {
  local message_code="$1" stage="$2" rollback_status="$3" context="$4"
  local attempt="$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"
  [[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "$context unpaused the profile"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/current.json" --field status)" == failed ]] || fail "$context did not mark current failed"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/current.json" --field stage)" == "$stage" ]] || fail "$context recorded the wrong current stage"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/current.json" --field rollbackStatus)" == "$rollback_status" ]] || fail "$context recorded the wrong rollback status"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/current.json" --field messageCode)" == "$message_code" ]] || fail "$context recorded the wrong current message code"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$attempt" --field messageCode)" == "$message_code" ]] || fail "$context did not persist the digest attempt"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$DRILL_BASELINE_STATE_HASH" ]] || fail "$context changed last-success"
}

write_drill_state() {
  local file="$1" status="$2" stage="$3" rollback_status="$4" message_code="$5"
  local api_manifest="${6:-$API_BUNDLE}" api_run="${7:-20}" api_image="${8:-$API_IMAGE}" openapi="${9:-$OPENAPI_SHA}"
  local manifest_digest="${10:-$DRILL_BUNDLE_DIGEST}" web_image="${11:-$DRILL_WEB_IMAGE}"
  node "$ROOT/state-tool.mjs" write --file "$file" \
    --set application=aviam-web --set "status=$status" --set "stage=$stage" \
    --set "manifestDigest=$manifest_digest" --set "sourceCommit=$DRILL_COMMIT" \
    --set "sourceRunId=$DRILL_RUN" --set sourceRunAttempt=1 --set "webImage=$web_image" \
    --set "webComposeSha256=$COMPOSE_SHA" --set "apiManifest=$api_manifest" --set "apiRunId=$api_run" \
    --set "apiImage=$api_image" --set "openApiSha256=$openapi" \
    --set "configurationSha256=sha256:$(repeat f 64)" --set "rollbackStatus=$rollback_status" \
    --set "messageCode=$message_code" --set updatedAt=2026-09-05T00:00:00Z \
    --set "workflowUrl=https://github.com/Example/ELEVANT/actions/runs/$DRILL_RUN"
}

write_running_drill_attempt() {
  local file="$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"
  write_drill_state "$file" running drill-health not-required stage_running
  cp "$file" "$TMP/runtime/state/aviam-web/current.json"
  chmod 0600 "$file" "$TMP/runtime/state/aviam-web/current.json"
}

write_completed_drill_last_success() {
  write_drill_state "$TMP/runtime/state/aviam-web/last-success.json" succeeded complete succeeded promotion_with_rollback_drill_succeeded
  chmod 0600 "$TMP/runtime/state/aviam-web/last-success.json"
}

write_failed_finalization_drill_attempt() {
  local file="$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"
  write_drill_state "$file" failed interrupted failed rollback_drill_finalization_recovery_failed
  cp "$file" "$TMP/runtime/state/aviam-web/current.json"
  chmod 0600 "$file" "$TMP/runtime/state/aviam-web/current.json"
}

write_ordinary_running_attempt() {
  local stage="$1" api_manifest="${2:-$API_BUNDLE}" api_run="${3:-20}" api_image="${4:-$API_IMAGE}" openapi="${5:-$OPENAPI_SHA}"
  local file="$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"
  write_drill_state "$file" running "$stage" not-required stage_running "$api_manifest" "$api_run" "$api_image" "$openapi"
  cp "$file" "$TMP/runtime/state/aviam-web/current.json"
  chmod 0600 "$file" "$TMP/runtime/state/aviam-web/current.json"
}

write_failed_resume_state() {
  local stage="$1" message_code="$2"
  local file="$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"
  write_drill_state "$file" failed "$stage" failed "$message_code"
  cp "$file" "$TMP/runtime/state/aviam-web/current.json"
  chmod 0600 "$file" "$TMP/runtime/state/aviam-web/current.json"
}

write_torn_ordinary_finalization() {
  local attempt="$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"
  write_drill_state "$TMP/runtime/state/aviam-web/last-success.json" succeeded complete not-required promotion_succeeded
  write_drill_state "$TMP/runtime/state/aviam-web/current.json" succeeded complete not-required promotion_succeeded
  write_drill_state "$attempt" running smoke not-required stage_running
  chmod 0600 "$TMP/runtime/state/aviam-web/last-success.json" "$TMP/runtime/state/aviam-web/current.json" "$attempt"
}

write_adopted_drill_baseline() {
  local file="$1"
  node "$ROOT/state-tool.mjs" write --file "$file" \
    --set application=aviam-web --set status=adopted --set stage=adopted-current \
    --set manifestDigest= --set "sourceCommit=$COMMIT" --set sourceRunId=30 --set sourceRunAttempt= \
    --set "webImage=$DRILL_BASELINE_WEB_IMAGE" --set "webComposeSha256=$COMPOSE_SHA" \
    --set "apiManifest=$API_BUNDLE" --set apiRunId=20 --set "apiImage=$API_IMAGE" \
    --set "openApiSha256=$OPENAPI_SHA" --set configurationSha256= --set rollbackStatus=not-required \
    --set messageCode=baseline_adopted --set updatedAt=2026-09-05T00:00:00Z --set workflowUrl=
  chmod 0600 "$file"
}

# A failed candidate `docker compose ... config --quiet` is a hard preflight
# failure. The ordinal fault only fails that first candidate check, so a caller
# that accidentally continues cannot be rescued by a later successful API gate.
reset_drill_fixture
FAIL_WEB_COMPOSE_CONFIG_NUMBERS=1
CONFIG_DRY_RUN_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
CONFIG_DRY_RUN_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
CONFIG_DRY_RUN_ENV_HASH="$(sha256sum "$TMP/live/.env" | awk '{print $1}')"
: > "$TMP/docker.log"
assert_failure "dry-run reported success after candidate Compose config failed" controller --dry-run
! grep -q 'dry-run passed' "$TMP/error" || fail "failed Compose config produced a false dry-run PASS"
grep -Fq "WEB_CONFIG:1:$DRILL_WEB_IMAGE" "$TMP/docker.log" || fail "dry-run did not exercise the exact candidate Compose config fault"
[[ "$(grep -c '^WEB_CONFIG:' "$TMP/docker.log")" == 1 ]] || fail "dry-run continued after the failed candidate Compose config"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$CONFIG_DRY_RUN_LAST_HASH" ]] || fail "failed-config dry-run changed last-success"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$CONFIG_DRY_RUN_CURRENT_HASH" ]] || fail "failed-config dry-run changed current"
[[ "$(sha256sum "$TMP/live/.env" | awk '{print $1}')" == "$CONFIG_DRY_RUN_ENV_HASH" ]] || fail "failed-config dry-run changed the environment"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "failed-config dry-run changed the runtime image"
[[ ! -e "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" ]] || fail "failed-config dry-run created an attempt"
! grep -q '^WEB_UP:' "$TMP/docker.log" || fail "failed-config dry-run invoked Compose up"

# Ordinary poll persists a truthful preflight failure but must stop before the
# candidate image reaches the live environment or a Compose up is attempted.
reset_drill_fixture
rm -f "$TMP/runtime/state/aviam-web/paused"
FAIL_WEB_COMPOSE_CONFIG_NUMBERS=1
CONFIG_PROMOTION_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
CONFIG_PROMOTION_ENV_HASH="$(sha256sum "$TMP/live/.env" | awk '{print $1}')"
: > "$TMP/docker.log"
assert_failure "ordinary promotion continued after candidate Compose config failed" controller --poll
grep -Fq "WEB_CONFIG:1:$DRILL_WEB_IMAGE" "$TMP/docker.log" || fail "ordinary promotion did not exercise the exact candidate Compose config fault"
[[ "$(grep -c '^WEB_CONFIG:' "$TMP/docker.log")" == 1 ]] || fail "ordinary promotion continued past the failed candidate Compose config"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$CONFIG_PROMOTION_LAST_HASH" ]] || fail "failed-config promotion changed last-success"
[[ "$(sha256sum "$TMP/live/.env" | awk '{print $1}')" == "$CONFIG_PROMOTION_ENV_HASH" ]] || fail "failed-config promotion changed the environment"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "failed-config promotion changed the runtime image"
! grep -q '^WEB_UP:' "$TMP/docker.log" || fail "failed-config promotion invoked Compose up"
for state_file in "$TMP/runtime/state/aviam-web/current.json" "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"; do
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field status)" == failed ]] || fail "failed-config promotion state was not failed"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field stage)" == preflight ]] || fail "failed-config promotion state did not stop at preflight"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field rollbackStatus)" == not-required ]] || fail "failed-config promotion recorded a rollback"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field messageCode)" == preflight_failed ]] || fail "failed-config promotion recorded the wrong message code"
done

# The drill is manual-only: pause is mandatory and its explicit digest must be
# the exact immutable digest currently advertised by the configured alias.
reset_drill_fixture
rm -f "$TMP/runtime/state/aviam-web/paused"
assert_failure "unpaused rollback drill was accepted" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
grep -q 'requires the selected profile to be paused' "$TMP/error" || fail "unpaused drill rejection was not explained"
assert_no_drill_mutation "unpaused drill"

reset_drill_fixture
WRONG_DRILL_DIGEST="sha256:$(repeat 6 64)"
assert_failure "rollback drill accepted a digest different from its alias" controller --promote-with-rollback-drill "$WRONG_DRILL_DIGEST"
grep -q 'digest is not currently advertised' "$TMP/error" || fail "drill alias/digest mismatch was not explained"
assert_no_drill_mutation "alias/digest mismatch"

reset_drill_fixture
ACTIVE_RUN=30
write_manifest "$DRILL_COMMIT" 30 "$DRILL_WEB_IMAGE"
assert_failure "rollback drill accepted a candidate that was not newer" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
grep -q 'not strictly newer' "$TMP/error" || fail "non-new drill candidate rejection was not explained"
assert_no_drill_mutation "non-new drill candidate"

# The interrupted-attempt selector is a pre-registry trust boundary. Corrupt or
# unsafe current state must fail closed while the profile remains paused.
reset_drill_fixture
printf '{\n' > "$TMP/runtime/state/aviam-web/current.json"
chmod 0600 "$TMP/runtime/state/aviam-web/current.json"
assert_failure "rollback drill accepted corrupt current state" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
grep -q 'could not read current web attempt status' "$TMP/error" || fail "corrupt current state rejection was not explained"
assert_selector_failed_closed "corrupt current state"

# Retry is also an explicit selector entry point. If it starts unpaused with
# corrupt current state, it must create the fail-closed marker before returning
# and must not consult Docker or mutate any protected state.
reset_drill_fixture
rm -f "$TMP/runtime/state/aviam-web/paused"
printf '{\n' > "$TMP/runtime/state/aviam-web/current.json"
chmod 0600 "$TMP/runtime/state/aviam-web/current.json"
RETRY_CORRUPT_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
RETRY_CORRUPT_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
RETRY_CORRUPT_ENV_HASH="$(sha256sum "$TMP/live/.env" | awk '{print $1}')"
: > "$TMP/docker.log"
assert_failure "retry accepted corrupt unpaused current state" controller --retry "$DRILL_BUNDLE_DIGEST"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "corrupt unpaused retry did not create the pause marker"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$RETRY_CORRUPT_LAST_HASH" ]] || fail "corrupt unpaused retry changed last-success"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$RETRY_CORRUPT_CURRENT_HASH" ]] || fail "corrupt unpaused retry changed current"
[[ "$(sha256sum "$TMP/live/.env" | awk '{print $1}')" == "$RETRY_CORRUPT_ENV_HASH" ]] || fail "corrupt unpaused retry changed the environment"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "corrupt unpaused retry changed the runtime image"
[[ ! -e "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" ]] || fail "corrupt unpaused retry created a requested attempt"
assert_only_docker_readiness_checks "corrupt unpaused retry"

# The digest inside attempts/B.json is part of the state-file trust boundary.
# Retry cannot use terminal failed B state whose content actually declares C.
STATE_PATH_MISMATCH_DIGEST="sha256:$(repeat 2 64)"
reset_drill_fixture
rm -f "$TMP/runtime/state/aviam-web/paused"
write_drill_state "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" \
  failed health succeeded deployment_failed_rolled_back \
  "$API_BUNDLE" 20 "$API_IMAGE" "$OPENAPI_SHA" "$STATE_PATH_MISMATCH_DIGEST"
STATE_PATH_RETRY_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
STATE_PATH_RETRY_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
STATE_PATH_RETRY_ATTEMPT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')"
STATE_PATH_RETRY_ENV_HASH="$(sha256sum "$TMP/live/.env" | awk '{print $1}')"
: > "$TMP/registry-down"
: > "$TMP/docker.log"
assert_failure "retry trusted attempts/B state that declared digest C" controller --retry "$DRILL_BUNDLE_DIGEST"
grep -q 'manifest digest does not match its state path' "$TMP/error" || fail "terminal retry attempt path/digest mismatch was not explained"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "terminal retry attempt path/digest mismatch did not pause"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$STATE_PATH_RETRY_LAST_HASH" ]] || fail "terminal retry attempt path/digest mismatch changed last-success"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$STATE_PATH_RETRY_CURRENT_HASH" ]] || fail "terminal retry attempt path/digest mismatch changed current"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')" == "$STATE_PATH_RETRY_ATTEMPT_HASH" ]] || fail "terminal retry attempt path/digest mismatch rewrote the attempt"
[[ "$(sha256sum "$TMP/live/.env" | awk '{print $1}')" == "$STATE_PATH_RETRY_ENV_HASH" ]] || fail "terminal retry attempt path/digest mismatch changed the environment"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "terminal retry attempt path/digest mismatch changed the runtime image"
[[ ! -e "$TMP/runtime/state/aviam-web/attempts/${STATE_PATH_MISMATCH_DIGEST#sha256:}.json" ]] || fail "terminal retry attempt path/digest mismatch created state for C"
assert_only_docker_readiness_checks "terminal retry attempt path/digest mismatch"

# The same check applies when current is terminal B but its matching running
# attempts/B file declares C. Both drill and retry must stop before the alias.
for state_path_command in drill retry; do
  reset_drill_fixture
  write_torn_ordinary_finalization
  write_drill_state "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" \
    running drill-health not-required stage_running \
    "$API_BUNDLE" 20 "$API_IMAGE" "$OPENAPI_SHA" "$STATE_PATH_MISMATCH_DIGEST"
  node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
  printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
  if [[ "$state_path_command" == retry ]]; then rm -f "$TMP/runtime/state/aviam-web/paused"; fi
  STATE_PATH_RUNNING_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
  STATE_PATH_RUNNING_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
  STATE_PATH_RUNNING_ATTEMPT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')"
  STATE_PATH_RUNNING_ENV_HASH="$(sha256sum "$TMP/live/.env" | awk '{print $1}')"
  : > "$TMP/registry-down"
  : > "$TMP/docker.log"
  if [[ "$state_path_command" == drill ]]; then
    assert_failure "drill trusted running attempts/B state that declared digest C" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
  else
    assert_failure "retry trusted running attempts/B state that declared digest C" controller --retry "$DRILL_BUNDLE_DIGEST"
  fi
  grep -q 'manifest digest does not match its state path' "$TMP/error" || fail "$state_path_command running attempt path/digest mismatch was not explained"
  [[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "$state_path_command running attempt path/digest mismatch did not pause"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$STATE_PATH_RUNNING_LAST_HASH" ]] || fail "$state_path_command running attempt path/digest mismatch changed last-success"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$STATE_PATH_RUNNING_CURRENT_HASH" ]] || fail "$state_path_command running attempt path/digest mismatch changed current"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')" == "$STATE_PATH_RUNNING_ATTEMPT_HASH" ]] || fail "$state_path_command running attempt path/digest mismatch rewrote the attempt"
  [[ "$(sha256sum "$TMP/live/.env" | awk '{print $1}')" == "$STATE_PATH_RUNNING_ENV_HASH" ]] || fail "$state_path_command running attempt path/digest mismatch changed the environment"
  [[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "$state_path_command running attempt path/digest mismatch changed the runtime image"
  [[ ! -e "$TMP/runtime/state/aviam-web/attempts/${STATE_PATH_MISMATCH_DIGEST#sha256:}.json" ]] || fail "$state_path_command running attempt path/digest mismatch created state for C"
  assert_only_docker_readiness_checks "$state_path_command running attempt path/digest mismatch"
done

# Matching digest and status tuples are not enough: current and its attempt
# must agree on every immutable promotion field. Exercise both torn running and
# terminal pairs through poll and resume without allowing either path to heal,
# roll back, or accept the inconsistent state.
IMMUTABLE_MISMATCH_WEB_IMAGE="$WEB_REPO@sha256:$(repeat 6 64)"
IMMUTABLE_MISMATCH_API_MANIFEST="$OPENAPI_REPO@sha256:$(repeat 5 64)"
for immutable_pair in terminal-running terminal-terminal; do
  for immutable_command in poll resume; do
    reset_drill_fixture
    write_torn_ordinary_finalization
    if [[ "$immutable_pair" == terminal-running ]]; then
      write_drill_state "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" \
        running smoke not-required stage_running \
        "$API_BUNDLE" 20 "$API_IMAGE" "$OPENAPI_SHA" "$DRILL_BUNDLE_DIGEST" "$IMMUTABLE_MISMATCH_WEB_IMAGE"
    else
      write_drill_state "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" \
        succeeded complete not-required promotion_succeeded \
        "$IMMUTABLE_MISMATCH_API_MANIFEST" 20 "$API_IMAGE" "$OPENAPI_SHA" "$DRILL_BUNDLE_DIGEST" "$DRILL_WEB_IMAGE"
    fi
    node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
    printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
    if [[ "$immutable_command" == poll ]]; then rm -f "$TMP/runtime/state/aviam-web/paused"; fi
    IMMUTABLE_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
    IMMUTABLE_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
    IMMUTABLE_ATTEMPT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')"
    IMMUTABLE_ENV_HASH="$(sha256sum "$TMP/live/.env" | awk '{print $1}')"
    : > "$TMP/registry-down"
    : > "$TMP/docker.log"
    if [[ "$immutable_command" == poll ]]; then
      assert_failure "poll accepted $immutable_pair immutable state mismatch" controller --poll
    else
      assert_failure "resume accepted $immutable_pair immutable state mismatch" controller --resume
    fi
    grep -Eq 'immutable|conflict|do not match' "$TMP/error" || fail "$immutable_command $immutable_pair mismatch was not explained"
    [[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "$immutable_command $immutable_pair mismatch did not pause"
    [[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$IMMUTABLE_LAST_HASH" ]] || fail "$immutable_command $immutable_pair mismatch changed last-success"
    [[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$IMMUTABLE_CURRENT_HASH" ]] || fail "$immutable_command $immutable_pair mismatch changed current"
    [[ "$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')" == "$IMMUTABLE_ATTEMPT_HASH" ]] || fail "$immutable_command $immutable_pair mismatch changed the attempt"
    [[ "$(sha256sum "$TMP/live/.env" | awk '{print $1}')" == "$IMMUTABLE_ENV_HASH" ]] || fail "$immutable_command $immutable_pair mismatch changed the environment"
    [[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "$immutable_command $immutable_pair mismatch changed the runtime image"
    if [[ "$immutable_command" == poll ]]; then
      assert_only_docker_readiness_checks "$immutable_command $immutable_pair mismatch"
    else
      [[ ! -s "$TMP/docker.log" ]] || fail "$immutable_command $immutable_pair mismatch invoked Docker"
    fi
  done
done

# A torn drill can legitimately persist a terminal result to current before
# updating its still-running digest attempt. This includes both a contained B
# failure and the post-A/pre-B safe-baseline window. Neither mutable tuple
# difference is corruption: the exact B command must recover safely to A.
while IFS='|' read -r torn_current_stage torn_current_code torn_attempt_stage torn_attempt_rollback torn_context; do
  reset_drill_fixture
  write_drill_state "$TMP/runtime/state/aviam-web/current.json" \
    failed "$torn_current_stage" succeeded "$torn_current_code"
  write_drill_state "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" \
    running "$torn_attempt_stage" "$torn_attempt_rollback" stage_running
  chmod 0600 "$TMP/runtime/state/aviam-web/current.json" \
    "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"
  : > "$TMP/registry-down"
  : > "$TMP/docker.log"
  assert_failure "exact B rejected legitimate torn drill pair: $torn_context" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
  grep -q 'interrupted rollback drill restored last-success' "$TMP/error" || fail "$torn_context did not execute recovery"
  ! grep -qi 'conflict' "$TMP/error" || fail "$torn_context was classified as corrupt"
  assert_failed_drill_state rollback_drill_interrupted_rolled_back interrupted succeeded "$torn_context recovery"
  [[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "$torn_context recovery did not leave A running"
  grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_BASELINE_WEB_IMAGE\"" "$TMP/live/.env" || fail "$torn_context recovery did not configure A"
  mapfile -t torn_drill_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
  [[ "${#torn_drill_ups[@]}" == 1 && "${torn_drill_ups[0]}" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "$torn_context did not perform exactly one local A recovery"
  grep -Fq 'SMOKE_EXECUTED:http://127.0.0.1:8080/dashboard' "$TMP/docker.log" || fail "$torn_context recovery omitted smoke"
  ! grep -Eq '\|pull( |$)' "$TMP/docker.log" || fail "$torn_context recovery pulled an image"
  ! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "$torn_context recovery contacted the registry"
done <<'TORN_DRILL_PAIRS'
drill-health|rollback_drill_candidate_failed_rolled_back|drill-health|not-required|legitimate torn contained-candidate drill
drill-rollback|rollback_drill_interrupted_at_safe_baseline|drill-rollback|not-required|legitimate torn post-A/pre-B drill
drill-repromote|rollback_drill_interrupted_at_safe_baseline|drill-repromote|succeeded|legitimate torn started-repromotion drill
TORN_DRILL_PAIRS

case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *)
    reset_drill_fixture
    chmod 0644 "$TMP/runtime/state/aviam-web/current.json"
    assert_failure "rollback drill accepted unsafe current state mode" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
    grep -q 'restricted file must be owned by the controller UID with mode 0600' "$TMP/error" || fail "unsafe current mode rejection was not explained"
    assert_selector_failed_closed "unsafe current state mode"
    ;;
esac

# Current and its same-provenance attempt cannot disagree about whether the
# running operation is ordinary or a rollback drill. Both manual resume and an
# initially unpaused poll must reject the ambiguity without choosing a rollback.
for conflicting_running_command in resume poll; do
  reset_drill_fixture
  write_ordinary_running_attempt health
  write_drill_state "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" \
    running drill-health not-required stage_running
  chmod 0600 "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"
  node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
  printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
  if [[ "$conflicting_running_command" == poll ]]; then rm -f "$TMP/runtime/state/aviam-web/paused"; fi
  CONFLICTING_RUNNING_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
  CONFLICTING_RUNNING_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
  CONFLICTING_RUNNING_ATTEMPT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')"
  CONFLICTING_RUNNING_ENV_HASH="$(sha256sum "$TMP/live/.env" | awk '{print $1}')"
  : > "$TMP/registry-down"
  : > "$TMP/docker.log"
  if [[ "$conflicting_running_command" == resume ]]; then
    assert_failure "resume accepted conflicting ordinary/drill running state" controller --resume
  else
    assert_failure "poll accepted conflicting ordinary/drill running state" controller --poll
  fi
  [[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "$conflicting_running_command did not pause conflicting running state"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$CONFLICTING_RUNNING_LAST_HASH" ]] || fail "$conflicting_running_command changed last-success for conflicting running state"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$CONFLICTING_RUNNING_CURRENT_HASH" ]] || fail "$conflicting_running_command changed current for conflicting running state"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')" == "$CONFLICTING_RUNNING_ATTEMPT_HASH" ]] || fail "$conflicting_running_command changed the conflicting digest attempt"
  [[ "$(sha256sum "$TMP/live/.env" | awk '{print $1}')" == "$CONFLICTING_RUNNING_ENV_HASH" ]] || fail "$conflicting_running_command changed the environment for conflicting running state"
  [[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "$conflicting_running_command changed the runtime image for conflicting running state"
  if [[ "$conflicting_running_command" == resume ]]; then
    [[ ! -s "$TMP/docker.log" ]] || fail "resume invoked Docker for conflicting running state"
  else
    assert_only_docker_readiness_checks "poll with conflicting running state"
  fi
done

# A terminal A current can coexist with an orphaned running B attempt after a
# torn state write. Once alias B is advertised, poll must classify that attempt
# as a drill, pause, and refuse any generic rollback or WEB_UP.
reset_drill_fixture
rm -f "$TMP/runtime/state/aviam-web/paused"
write_drill_state "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" \
  running drill-health not-required stage_running
chmod 0600 "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"
ORPHAN_DRILL_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
ORPHAN_DRILL_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
ORPHAN_DRILL_ATTEMPT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')"
ORPHAN_DRILL_ENV_HASH="$(sha256sum "$TMP/live/.env" | awk '{print $1}')"
: > "$TMP/docker.log"
assert_failure "poll treated orphaned running drill B as an ordinary retry" controller --poll
grep -Eq 'running rollback drill|rollback drill is running' "$TMP/error" || fail "orphaned running drill rejection was not explained"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "orphaned running drill poll did not pause"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$ORPHAN_DRILL_LAST_HASH" ]] || fail "orphaned running drill poll changed last-success"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$ORPHAN_DRILL_CURRENT_HASH" ]] || fail "orphaned running drill poll changed current"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')" == "$ORPHAN_DRILL_ATTEMPT_HASH" ]] || fail "orphaned running drill poll changed its attempt"
[[ "$(sha256sum "$TMP/live/.env" | awk '{print $1}')" == "$ORPHAN_DRILL_ENV_HASH" ]] || fail "orphaned running drill poll changed the environment"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "orphaned running drill poll changed the runtime image"
! grep -q '^WEB_UP:' "$TMP/docker.log" || fail "orphaned running drill poll attempted a rollback or deployment"

# Even when B exactly matches the active API, its full API tuple must match A;
# otherwise the controller cannot prove a safe A rollback under the active API.
reset_drill_fixture
MISMATCH_API_BUNDLE_DIGEST="sha256:$(repeat 7 64)"
MISMATCH_API_BUNDLE="$OPENAPI_REPO@$MISMATCH_API_BUNDLE_DIGEST"
MISMATCH_API_IMAGE="$API_REPO@sha256:$(repeat 8 64)"
IMAGE_API_BUNDLE="$MISMATCH_API_BUNDLE"
RUNTIME_API_IMAGE="$MISMATCH_API_IMAGE"
write_api_state 21 "$MISMATCH_API_IMAGE" "$MISMATCH_API_BUNDLE_DIGEST"
write_manifest "$DRILL_COMMIT" "$DRILL_RUN" "$DRILL_WEB_IMAGE" "$MISMATCH_API_BUNDLE" 21 "$MISMATCH_API_IMAGE" "$OPENAPI_SHA"
assert_failure "rollback drill accepted a candidate/baseline API tuple mismatch" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
grep -q 'exact active API tuple' "$TMP/error" || fail "drill API tuple mismatch was not explained"
assert_no_drill_mutation "API tuple mismatch"
[[ ! -e "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" ]] || fail "API tuple mismatch created a digest attempt"

# Successful B -> A -> B drill: each leg recreates only the web service from
# local images, then proves exact health and all three certified smoke routes.
reset_drill_fixture
ARM_REGISTRY_OUTAGE=1
assert_success "safe rollback drill failed" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
mapfile -t drill_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#drill_ups[@]}" == 3 ]] || fail "rollback drill did not execute exactly three Compose up operations"
[[ "${drill_ups[0]}" == "$DRILL_WEB_IMAGE" && "${drill_ups[1]}" == "$DRILL_BASELINE_WEB_IMAGE" && "${drill_ups[2]}" == "$DRILL_WEB_IMAGE" ]] || fail "rollback drill order was not B -> A -> B"
[[ "$(grep -c ' up -d --pull never --no-build --no-deps --force-recreate aviam-web$' "$TMP/docker.log")" == 3 ]] || fail "rollback drill did not use --pull never on every Compose up"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "rollback drill pulled after the first live mutation"
! grep -Eq '\|compose .* pull( |$)' "$TMP/docker.log" || fail "rollback drill invoked an explicit Compose pull"
! grep -Eq '(^|[| ])down([ |]|$)' "$TMP/docker.log" || fail "rollback drill invoked docker compose down"
mapfile -t drill_health < <(sed -n 's/^WEB_HEALTH:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#drill_health[@]}" == 4 ]] || fail "rollback drill omitted a baseline or leg health check"
[[ "${drill_health[0]}" == "$DRILL_BASELINE_WEB_IMAGE" && "${drill_health[1]}" == "$DRILL_WEB_IMAGE" && "${drill_health[2]}" == "$DRILL_BASELINE_WEB_IMAGE" && "${drill_health[3]}" == "$DRILL_WEB_IMAGE" ]] || fail "rollback drill health checks did not follow A -> B -> A -> B"
mapfile -t drill_smoke < <(grep '^WEB_SMOKE:' "$TMP/docker.log")
[[ "${#drill_smoke[@]}" == 12 ]] || fail "rollback drill did not run every smoke path for baseline and all three legs"
for index in 0 1 2 6 7 8; do [[ "${drill_smoke[$index]}" == *":$DRILL_BASELINE_WEB_IMAGE:http://127.0.0.1:8080/"* ]] || fail "rollback drill smoke order omitted baseline A"; done
for index in 3 4 5 9 10 11; do [[ "${drill_smoke[$index]}" == *":$DRILL_WEB_IMAGE:http://127.0.0.1:8080/"* ]] || fail "rollback drill smoke order omitted candidate B"; done
[[ "$(grep -c '^LAST_SUCCESS:' "$TMP/docker.log")" == 19 ]] || fail "rollback drill checkpoints were incomplete"
! grep '^LAST_SUCCESS:' "$TMP/docker.log" | grep -Fvq ":$DRILL_BASELINE_STATE_HASH" || fail "rollback drill accepted B before the final verification completed"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "successful rollback drill did not leave B running"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_WEB_IMAGE\"" "$TMP/live/.env" || fail "successful rollback drill did not leave B configured"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "successful rollback drill unpaused the profile"
for state_file in "$TMP/runtime/state/aviam-web/current.json" "$TMP/runtime/state/aviam-web/last-success.json" "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"; do
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field manifestDigest)" == "$DRILL_BUNDLE_DIGEST" ]] || fail "successful drill state recorded the wrong digest"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field status)" == succeeded ]] || fail "successful drill state was not succeeded"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field stage)" == complete ]] || fail "successful drill state was not complete"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field rollbackStatus)" == succeeded ]] || fail "successful drill state did not prove rollback"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field messageCode)" == promotion_with_rollback_drill_succeeded ]] || fail "successful drill state recorded the wrong message code"
done

# The first operational drill starts from --adopt-current, whose real state has
# no release-manifest digest. Its healthy image/run baseline is still valid A.
reset_drill_fixture
write_adopted_drill_baseline "$TMP/runtime/state/aviam-web/last-success.json"
cp "$TMP/runtime/state/aviam-web/last-success.json" "$TMP/runtime/state/aviam-web/current.json"
chmod 0600 "$TMP/runtime/state/aviam-web/current.json"
ARM_REGISTRY_OUTAGE=1
assert_success "rollback drill rejected a real adopted baseline" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
mapfile -t adopted_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#adopted_ups[@]}" == 3 && "${adopted_ups[0]}" == "$DRILL_WEB_IMAGE" && "${adopted_ups[1]}" == "$DRILL_BASELINE_WEB_IMAGE" && "${adopted_ups[2]}" == "$DRILL_WEB_IMAGE" ]] || fail "adopted-baseline drill did not execute B -> A -> B"
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/last-success.json" --field status)" == succeeded ]] || fail "adopted-baseline drill did not accept B"
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/last-success.json" --field manifestDigest)" == "$DRILL_BUNDLE_DIGEST" ]] || fail "adopted-baseline drill recorded the wrong B digest"
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/last-success.json" --field rollbackStatus)" == succeeded ]] || fail "adopted-baseline drill did not prove rollback"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "adopted-baseline drill unpaused the profile"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "adopted-baseline drill pulled after mutation"

# A failure while proving A leaves the profile paused, preserves A as
# last-success, and truthfully reports that rollback could not be verified.
reset_drill_fixture
FAIL_WEB_HEALTH_NUMBERS=3
assert_failure "rollback drill rollback health failure was accepted" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
assert_failed_drill_state rollback_drill_rollback_failed rollback failed "rollback-stage failure"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "rollback-stage failure did not leave A selected at runtime"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_BASELINE_WEB_IMAGE\"" "$TMP/live/.env" || fail "rollback-stage failure did not leave A configured"

# Candidate B smoke failure is contained through the same verified A path.
reset_drill_fixture
FAIL_WEB_SMOKE_NUMBERS=4
assert_failure "rollback drill accepted first B smoke failure" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
assert_failed_drill_state rollback_drill_candidate_failed_rolled_back drill-smoke succeeded "first B smoke failure"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "first B smoke failure did not restore A"

# If the final B leg fails, the controller contains it by restoring A again.
reset_drill_fixture
FAIL_WEB_HEALTH_NUMBERS=4
assert_failure "rollback drill re-promotion health failure was accepted" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
assert_failed_drill_state rollback_drill_repromotion_failed_rolled_back drill-repromote-health succeeded "contained re-promotion failure"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "contained re-promotion failure did not restore A"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_BASELINE_WEB_IMAGE\"" "$TMP/live/.env" || fail "contained re-promotion failure did not configure A"
mapfile -t failed_repromote_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#failed_repromote_ups[@]}" == 4 && "${failed_repromote_ups[0]}" == "$DRILL_WEB_IMAGE" && "${failed_repromote_ups[1]}" == "$DRILL_BASELINE_WEB_IMAGE" && "${failed_repromote_ups[2]}" == "$DRILL_WEB_IMAGE" && "${failed_repromote_ups[3]}" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "failed re-promotion containment did not execute B -> A -> B -> A"

reset_drill_fixture
FAIL_WEB_SMOKE_NUMBERS=10
assert_failure "rollback drill accepted final B smoke failure" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
assert_failed_drill_state rollback_drill_repromotion_failed_rolled_back drill-repromote-smoke succeeded "final B smoke failure"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "final B smoke failure did not restore A"

# If that containment rollback also fails, the state must not claim recovery.
reset_drill_fixture
FAIL_WEB_HEALTH_NUMBERS=4,5
assert_failure "failed re-promotion and failed containment rollback were accepted" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
assert_failed_drill_state rollback_drill_repromotion_and_rollback_failed drill-repromote-health failed "uncontained re-promotion failure"

# An unexpected state persistence error after B starts is outside the explicit
# leg-failure branches. The ERR trap must still restore A and record containment.
reset_drill_fixture
CONTROLLER_NODE_BIN="$TMP/mock-node"
FAIL_STATE_WRITE_NUMBER=3
ARM_REGISTRY_OUTAGE=1
assert_failure "unexpected post-mutation persistence error returned success" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
assert_failed_drill_state rollback_drill_unexpected_error_rolled_back drill-health succeeded "unexpected persistence error"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "unexpected persistence error did not restore A"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_BASELINE_WEB_IMAGE\"" "$TMP/live/.env" || fail "unexpected persistence error did not configure A"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "unexpected persistence recovery contacted the unavailable registry"

# A later explicit invocation must also contain an attempt that was already
# persisted as running, which covers process death that cannot execute traps.
reset_drill_fixture
write_running_drill_attempt
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
: > "$TMP/registry-down"
: > "$TMP/docker.log"
assert_failure "pre-existing running drill attempt returned success" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
assert_failed_drill_state rollback_drill_interrupted_rolled_back interrupted succeeded "pre-existing running drill attempt"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "pre-existing running drill attempt did not restore A"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_BASELINE_WEB_IMAGE\"" "$TMP/live/.env" || fail "pre-existing running drill attempt did not configure A"
mapfile -t recovered_running_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#recovered_running_ups[@]}" == 1 && "${recovered_running_ups[0]}" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "pre-existing running drill attempt did not perform exactly one A recovery"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "pre-existing running drill recovery contacted the unavailable registry"

# Recovery is forbidden when the active API no longer equals the persisted
# A/B tuple. The controller records the gate failure but does not touch the web.
reset_drill_fixture
write_running_drill_attempt
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
write_api_state 21 "$MISMATCH_API_IMAGE" "$MISMATCH_API_BUNDLE_DIGEST"
: > "$TMP/registry-down"
: > "$TMP/docker.log"
assert_failure "running drill recovery ignored active API drift" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
for state_file in "$TMP/runtime/state/aviam-web/current.json" "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"; do
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field status)" == running ]] || fail "API-drifted recovery became terminal before recovery"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field stage)" == interrupted ]] || fail "API-drifted recovery did not record interrupted stage"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field rollbackStatus)" == not-required ]] || fail "API-drifted recovery falsely claimed rollback"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field messageCode)" == rollback_drill_interrupted_recovery_deferred ]] || fail "API-drifted recovery recorded the wrong deferred code"
done
grep -q 'recovery.*deferred' "$TMP/error" || fail "API-drifted recovery deferral was not explained"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "API-drifted recovery deferral unpaused the profile"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "API-drifted recovery changed the runtime image"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_WEB_IMAGE\"" "$TMP/live/.env" || fail "API-drifted recovery changed the web environment"
! grep -q '^WEB_UP:' "$TMP/docker.log" || fail "API-drifted recovery invoked Compose up"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "API-drifted recovery contacted the registry"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$DRILL_BASELINE_STATE_HASH" ]] || fail "API-drifted recovery changed last-success"

# Paused is fail-closed while recovery is pending; --resume must direct the
# operator to the exact running digest and cannot bypass the recovery gate.
: > "$TMP/docker.log"
assert_failure "resume bypassed a deferred running drill recovery" controller --resume
grep -q -- "recover it with --promote-with-rollback-drill $DRILL_BUNDLE_DIGEST" "$TMP/error" || fail "blocked resume did not name the exact recovery action"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "blocked resume removed the pause marker"
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/current.json" --field status)" == running ]] || fail "blocked resume changed the recoverable running state"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "blocked resume changed the runtime image"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_WEB_IMAGE\"" "$TMP/live/.env" || fail "blocked resume changed the web environment"
[[ ! -s "$TMP/docker.log" ]] || fail "blocked resume invoked Docker"

# Corrupt/unknown current status cannot be treated as safe-to-resume either.
cp "$TMP/runtime/state/aviam-web/current.json" "$TMP/deferred-current.json"
sed -i 's/"status":"running"/"status":"invalid"/' "$TMP/runtime/state/aviam-web/current.json"
grep -q '"status":"invalid"' "$TMP/runtime/state/aviam-web/current.json" || fail "invalid-status fixture was not created"
chmod 0600 "$TMP/runtime/state/aviam-web/current.json"
: > "$TMP/docker.log"
assert_failure "resume accepted current state with an invalid status" controller --resume
grep -q 'current web attempt status' "$TMP/error" || fail "invalid-status resume rejection was not explained"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "invalid-status resume removed the pause marker"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "invalid-status resume changed the runtime image"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_WEB_IMAGE\"" "$TMP/live/.env" || fail "invalid-status resume changed the web environment"
[[ ! -s "$TMP/docker.log" ]] || fail "invalid-status resume invoked Docker"
cp "$TMP/deferred-current.json" "$TMP/runtime/state/aviam-web/current.json"
chmod 0600 "$TMP/runtime/state/aviam-web/current.json"

# Once the exact API returns, the same digest can recover A locally. That
# terminal failed record is then an explicit-retry checkpoint, not a dead end.
write_api_state 20
rm -f "$TMP/web-health-count" "$TMP/web-smoke-count" "$TMP/web-up-count"
: > "$TMP/docker.log"
assert_failure "restored API did not trigger interrupted B recovery" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
assert_failed_drill_state rollback_drill_interrupted_rolled_back interrupted succeeded "restored-API running recovery"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "restored-API recovery did not restore A"
mapfile -t restored_api_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#restored_api_ups[@]}" == 1 && "${restored_api_ups[0]}" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "restored-API recovery did not perform exactly one A up"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "restored-API recovery was not offline"

rm -f "$TMP/registry-down" "$TMP/web-health-count" "$TMP/web-smoke-count" "$TMP/web-up-count"
: > "$TMP/docker.log"
ARM_REGISTRY_OUTAGE=1
assert_success "recovered drill digest could not be explicitly retried" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
mapfile -t retried_drill_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#retried_drill_ups[@]}" == 3 && "${retried_drill_ups[0]}" == "$DRILL_WEB_IMAGE" && "${retried_drill_ups[1]}" == "$DRILL_BASELINE_WEB_IMAGE" && "${retried_drill_ups[2]}" == "$DRILL_WEB_IMAGE" ]] || fail "recovered drill retry did not execute B -> A -> B"
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/last-success.json" --field status)" == succeeded ]] || fail "recovered drill retry did not accept B"
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/last-success.json" --field rollbackStatus)" == succeeded ]] || fail "recovered drill retry did not record rollback success"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "recovered drill retry unpaused the profile"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "recovered drill retry pulled after mutation"

# A different requested digest C cannot authorize recovery of running B. It
# must block without consulting C's alias or changing B, and name B explicitly.
reset_drill_fixture
write_running_drill_attempt
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
: > "$TMP/registry-down"
: > "$TMP/docker.log"
OTHER_DRILL_DIGEST="sha256:$(repeat 9 64)"
RUNNING_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
RUNNING_ATTEMPT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')"
assert_failure "new drill request did not block behind a different running digest" controller --promote-with-rollback-drill "$OTHER_DRILL_DIGEST"
grep -q "a different rollback drill digest is running; invoke --promote-with-rollback-drill $DRILL_BUNDLE_DIGEST" "$TMP/error" || fail "different-digest conflict did not name the required recovery command"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "different-digest conflict changed the runtime image"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_WEB_IMAGE\"" "$TMP/live/.env" || fail "different-digest conflict changed the web environment"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$RUNNING_CURRENT_HASH" ]] || fail "different-digest conflict changed current state"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')" == "$RUNNING_ATTEMPT_HASH" ]] || fail "different-digest conflict changed the running attempt"
[[ ! -e "$TMP/runtime/state/aviam-web/attempts/${OTHER_DRILL_DIGEST#sha256:}.json" ]] || fail "different-digest conflict created state for C"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "different-digest conflict unpaused the profile"
! grep -q '^WEB_UP:' "$TMP/docker.log" || fail "different-digest conflict invoked Compose up"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "different-digest conflict consulted C's alias"

# TERM in the narrow finalization window after last-success=B must recognize
# that final smoke already passed, revalidate B locally, and finish both states.
reset_drill_fixture
CONTROLLER_NODE_BIN="$TMP/mock-node"
SIGNAL_AFTER_STATE_FILE="$TMP/runtime/state/aviam-web/last-success.json"
ARM_REGISTRY_OUTAGE=1
assert_failure "TERM after last-success acceptance returned success" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
grep -q 'after final acceptance; completed state was reconciled' "$TMP/error" || fail "TERM finalization reconciliation was not reported"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "TERM finalization reconciliation unpaused the profile"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "TERM finalization reconciliation did not leave B running"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_WEB_IMAGE\"" "$TMP/live/.env" || fail "TERM finalization reconciliation did not leave B configured"
for state_file in "$TMP/runtime/state/aviam-web/current.json" "$TMP/runtime/state/aviam-web/last-success.json" "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"; do
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field status)" == succeeded ]] || fail "TERM finalization state was not succeeded"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field stage)" == complete ]] || fail "TERM finalization state was not complete"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field rollbackStatus)" == succeeded ]] || fail "TERM finalization state lost the proved rollback"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field messageCode)" == promotion_with_rollback_drill_succeeded ]] || fail "TERM finalization state recorded the wrong message code"
done
mapfile -t term_final_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#term_final_ups[@]}" == 4 && "${term_final_ups[0]}" == "$DRILL_WEB_IMAGE" && "${term_final_ups[1]}" == "$DRILL_BASELINE_WEB_IMAGE" && "${term_final_ups[2]}" == "$DRILL_WEB_IMAGE" && "${term_final_ups[3]}" == "$DRILL_WEB_IMAGE" ]] || fail "TERM finalization did not execute B -> A -> B -> B reconciliation"
[[ "$(grep -c ' up -d --pull never --no-build --no-deps --force-recreate aviam-web$' "$TMP/docker.log")" == 4 ]] || fail "TERM finalization reconciliation did not keep every Compose up registry-independent"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "TERM finalization reconciliation contacted the unavailable registry"

# persist_attempt must propagate failure of its first/current write. A failed
# current write cannot be masked by a later attempt write or a success log.
reset_drill_fixture
write_running_drill_attempt
write_completed_drill_last_success
PERSIST_FAILURE_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
PERSIST_FAILURE_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
PERSIST_FAILURE_ATTEMPT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')"
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
: > "$TMP/registry-down"
: > "$TMP/docker.log"
CONTROLLER_NODE_BIN="$TMP/mock-node"
FAIL_STATE_WRITE_NUMBER=1
assert_failure "first persist_attempt write failure was masked" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
grep -q 'could not persist current and attempt state' "$TMP/error" || fail "first persist_attempt write failure was not reported"
! grep -q 'completed state reconciled' "$TMP/error" || fail "failed persist_attempt logged successful reconciliation"
[[ "$(<"$TMP/node-write-count")" == 1 ]] || fail "persist_attempt continued after its first write failed"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$PERSIST_FAILURE_CURRENT_HASH" ]] || fail "failed current write changed current state"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')" == "$PERSIST_FAILURE_ATTEMPT_HASH" ]] || fail "failed current write still rewrote the digest attempt"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$PERSIST_FAILURE_LAST_HASH" ]] || fail "failed reconciliation changed final last-success B"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "failed reconciliation unpaused the profile"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "failed reconciliation did not leave accepted B running"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "failed reconciliation contacted the unavailable registry"

# If last-success B was already committed after final smoke but current/attempt
# were torn while still running, B is the safe final baseline. Reconcile and
# revalidate B locally instead of falsely rolling it back to the former A.
reset_drill_fixture
write_running_drill_attempt
write_completed_drill_last_success
TORN_LAST_SUCCESS_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
: > "$TMP/registry-down"
: > "$TMP/docker.log"
assert_success "torn drill finalization was not reconciled" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$TORN_LAST_SUCCESS_HASH" ]] || fail "torn finalization rewrote the already-final last-success"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "torn finalization reconciliation unpaused the profile"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "torn finalization reconciliation did not leave B running"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_WEB_IMAGE\"" "$TMP/live/.env" || fail "torn finalization reconciliation did not leave B configured"
for state_file in "$TMP/runtime/state/aviam-web/current.json" "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"; do
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field status)" == succeeded ]] || fail "torn finalization state was not succeeded"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field stage)" == complete ]] || fail "torn finalization state was not complete"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field rollbackStatus)" == succeeded ]] || fail "torn finalization state lost the proved rollback"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field messageCode)" == promotion_with_rollback_drill_succeeded ]] || fail "torn finalization state recorded the wrong message code"
done
mapfile -t torn_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#torn_ups[@]}" == 1 && "${torn_ups[0]}" == "$DRILL_WEB_IMAGE" ]] || fail "torn finalization did not locally revalidate exactly B"
grep -Fq '|run --rm --pull never ' "$TMP/docker.log" || fail "torn finalization API probe was not registry-independent"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "torn finalization reconciliation contacted the unavailable registry"

# A prior failed finalization reconciliation remains retryable by B even after
# the advertised alias advances to C. The accepted B record is revalidated
# locally and completed without any registry dependency.
reset_drill_fixture
write_failed_finalization_drill_attempt
write_completed_drill_last_success
FINALIZATION_RETRY_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
ADVANCED_ALIAS_DIGEST="sha256:$(repeat 0 64)"
ACTIVE_BUNDLE_DIGEST="$ADVANCED_ALIAS_DIGEST"
ACTIVE_COMMIT="$(repeat a 40)"
ACTIVE_RUN=32
BASELINE_WEB_IMAGE="$DRILL_WEB_IMAGE"
BASELINE_COMMIT="$DRILL_COMMIT"
BASELINE_RUN="$DRILL_RUN"
: > "$TMP/registry-down"
: > "$TMP/docker.log"
assert_success "failed finalization could not be retried offline after alias advance" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$FINALIZATION_RETRY_LAST_HASH" ]] || fail "offline finalization retry rewrote final last-success B"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "offline finalization retry unpaused the profile"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "offline finalization retry did not leave B running"
for state_file in "$TMP/runtime/state/aviam-web/current.json" "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"; do
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field status)" == succeeded ]] || fail "offline finalization retry state was not succeeded"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field stage)" == complete ]] || fail "offline finalization retry state was not complete"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field rollbackStatus)" == succeeded ]] || fail "offline finalization retry lost rollback proof"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field messageCode)" == promotion_with_rollback_drill_succeeded ]] || fail "offline finalization retry recorded the wrong message code"
done
mapfile -t finalization_retry_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#finalization_retry_ups[@]}" == 1 && "${finalization_retry_ups[0]}" == "$DRILL_WEB_IMAGE" ]] || fail "offline finalization retry did not locally revalidate exactly B"
grep -Fq '|run --rm --pull never ' "$TMP/docker.log" || fail "offline finalization retry API probe was not local-only"
! grep -Eq '\|pull( |$)' "$TMP/docker.log" || fail "offline finalization retry consulted the advanced alias"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "offline finalization retry contacted the unavailable registry"

# A real TERM after B mutates the live env is handled in-process: the trap
# restores and validates A, records the interrupted attempt, and stays paused.
reset_drill_fixture
INTERRUPT_WEB_UP_NUMBER=1
ARM_REGISTRY_OUTAGE=1
assert_failure "interrupted rollback drill returned success" controller --promote-with-rollback-drill "$DRILL_BUNDLE_DIGEST"
assert_failed_drill_state rollback_drill_interrupted_rolled_back drill-deploy succeeded "interrupted rollback drill"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "interrupted rollback drill did not restore A"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_BASELINE_WEB_IMAGE\"" "$TMP/live/.env" || fail "interrupted rollback drill did not configure A"
mapfile -t interrupted_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#interrupted_ups[@]}" == 2 && "${interrupted_ups[0]}" == "$DRILL_WEB_IMAGE" && "${interrupted_ups[1]}" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "interrupted rollback drill did not execute B -> A recovery"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "signal recovery contacted the unavailable registry after mutation"

# --resume cannot clear a pause that represents an uncontained rollback. This
# applies to the drill failure codes and to any ordinary rollbackStatus=failed.
while IFS='|' read -r blocked_stage blocked_code; do
  reset_drill_fixture
  write_failed_resume_state "$blocked_stage" "$blocked_code"
  BLOCKED_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
  BLOCKED_ATTEMPT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')"
  : > "$TMP/docker.log"
  assert_failure "resume cleared an uncontained failure: $blocked_code" controller --resume
  [[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "resume removed pause for $blocked_code"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$BLOCKED_CURRENT_HASH" ]] || fail "resume changed current for $blocked_code"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')" == "$BLOCKED_ATTEMPT_HASH" ]] || fail "resume changed attempt for $blocked_code"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$DRILL_BASELINE_STATE_HASH" ]] || fail "resume changed last-success for $blocked_code"
  [[ ! -s "$TMP/docker.log" ]] || fail "resume invoked Docker for $blocked_code"
done <<'BLOCKED_RESUME_CASES'
rollback|rollback_drill_rollback_failed
drill-repromote-health|rollback_drill_repromotion_and_rollback_failed
interrupted|rollback_drill_finalization_recovery_failed
health|deployment_and_rollback_failed
BLOCKED_RESUME_CASES

# Ordinary interrupted promotions use the normal rollback path, independent of
# candidate/baseline API tuple equality. The first resume contains and pauses;
# the second explicit resume acknowledges recovery and removes the pause.
for ordinary_stage in deploy health smoke; do
  reset_drill_fixture
  write_ordinary_running_attempt "$ordinary_stage" "$MISMATCH_API_BUNDLE" 21 "$MISMATCH_API_IMAGE" "$OPENAPI_SHA"
  write_api_state 21 "$MISMATCH_API_IMAGE" "$MISMATCH_API_BUNDLE_DIGEST"
  node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
  printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
  : > "$TMP/registry-down"
  : > "$TMP/docker.log"
  assert_failure "ordinary $ordinary_stage attempt was not contained on resume" controller --resume
  assert_failed_drill_state interrupted_attempt_rolled_back interrupted succeeded "ordinary $ordinary_stage resume recovery"
  [[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "ordinary $ordinary_stage recovery did not restore A"
  grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_BASELINE_WEB_IMAGE\"" "$TMP/live/.env" || fail "ordinary $ordinary_stage recovery did not configure A"
  mapfile -t ordinary_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
  [[ "${#ordinary_ups[@]}" == 1 && "${ordinary_ups[0]}" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "ordinary $ordinary_stage recovery did not perform exactly one A rollback"
  ! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "ordinary $ordinary_stage recovery contacted the registry"

  : > "$TMP/docker.log"
  assert_success "second resume stayed blocked after ordinary $ordinary_stage recovery" controller --resume
  [[ ! -e "$TMP/runtime/state/aviam-web/paused" ]] || fail "second resume did not remove pause after ordinary $ordinary_stage recovery"
  [[ ! -s "$TMP/docker.log" ]] || fail "second resume invoked Docker after ordinary $ordinary_stage recovery"
done

# If normal interrupted-attempt rollback cannot prove A healthy, the failed
# rollback is terminal for resume and the profile remains paused.
reset_drill_fixture
write_ordinary_running_attempt health "$MISMATCH_API_BUNDLE" 21 "$MISMATCH_API_IMAGE" "$OPENAPI_SHA"
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
FAIL_WEB_HEALTH_NUMBERS=1
: > "$TMP/registry-down"
: > "$TMP/docker.log"
assert_failure "failed ordinary rollback returned success from resume" controller --resume
assert_failed_drill_state interrupted_attempt_rollback_failed interrupted failed "failed ordinary resume rollback"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "failed ordinary rollback did not leave A selected"
FAILED_RESUME_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
: > "$TMP/docker.log"
assert_failure "second resume bypassed a failed ordinary rollback" controller --resume
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "failed ordinary rollback was unpaused"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$FAILED_RESUME_CURRENT_HASH" ]] || fail "blocked resume changed failed ordinary rollback state"
[[ ! -s "$TMP/docker.log" ]] || fail "blocked resume retried a failed ordinary rollback"

# Ordinary success finalization writes last-success B before current/attempt.
# A torn terminal/current + running/attempt pair is reconciled locally. An API
# tuple drift blocks that reconciliation without touching the web or the state.
reset_drill_fixture
write_torn_ordinary_finalization
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
BASELINE_WEB_IMAGE="$DRILL_WEB_IMAGE"
BASELINE_COMMIT="$DRILL_COMMIT"
BASELINE_RUN="$DRILL_RUN"
write_api_state 21 "$MISMATCH_API_IMAGE" "$MISMATCH_API_BUNDLE_DIGEST"
TORN_ORDINARY_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
TORN_ORDINARY_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
TORN_ORDINARY_ATTEMPT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')"
: > "$TMP/registry-down"
: > "$TMP/docker.log"
assert_failure "ordinary torn finalization ignored active API tuple drift" controller --resume
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "API-drifted ordinary finalization was unpaused"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$TORN_ORDINARY_LAST_HASH" ]] || fail "API-drifted ordinary finalization changed last-success"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$TORN_ORDINARY_CURRENT_HASH" ]] || fail "API-drifted ordinary finalization changed current"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')" == "$TORN_ORDINARY_ATTEMPT_HASH" ]] || fail "API-drifted ordinary finalization changed attempt"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "API-drifted ordinary finalization changed runtime B"
! grep -q '^WEB_UP:' "$TMP/docker.log" || fail "API-drifted ordinary finalization invoked Compose up"
! grep -Eq '\|pull( |$)' "$TMP/docker.log" || fail "API-drifted ordinary finalization contacted the registry"

reset_drill_fixture
write_torn_ordinary_finalization
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
BASELINE_WEB_IMAGE="$DRILL_WEB_IMAGE"
BASELINE_COMMIT="$DRILL_COMMIT"
BASELINE_RUN="$DRILL_RUN"
TORN_ORDINARY_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
: > "$TMP/registry-down"
: > "$TMP/docker.log"
assert_failure "ordinary torn finalization first resume returned success" controller --resume
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "ordinary torn finalization reconciliation unpaused immediately"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$TORN_ORDINARY_LAST_HASH" ]] || fail "ordinary torn finalization rewrote last-success B"
for state_file in "$TMP/runtime/state/aviam-web/current.json" "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"; do
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field status)" == succeeded ]] || fail "ordinary torn finalization state was not succeeded"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field stage)" == complete ]] || fail "ordinary torn finalization state was not complete"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field rollbackStatus)" == not-required ]] || fail "ordinary torn finalization recorded a false rollback"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field messageCode)" == promotion_succeeded ]] || fail "ordinary torn finalization state recorded the wrong message code"
done
mapfile -t torn_ordinary_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#torn_ordinary_ups[@]}" == 1 && "${torn_ordinary_ups[0]}" == "$DRILL_WEB_IMAGE" ]] || fail "ordinary torn finalization did not locally revalidate B"
grep -Fq '|run --rm --pull never ' "$TMP/docker.log" || fail "ordinary torn finalization API probe was not local-only"
! grep -Eq '\|pull( |$)' "$TMP/docker.log" || fail "ordinary torn finalization consulted the registry"
: > "$TMP/docker.log"
assert_success "second resume stayed blocked after ordinary finalization reconciliation" controller --resume
[[ ! -e "$TMP/runtime/state/aviam-web/paused" ]] || fail "second resume did not remove pause after ordinary finalization reconciliation"
[[ ! -s "$TMP/docker.log" ]] || fail "second resume invoked Docker after ordinary finalization reconciliation"

# A crash one write earlier leaves both current and attempt running even though
# last-success already proves B completed. Resume must reconcile B, not roll it
# back to A, and must keep the explicit pause until the next resume.
reset_drill_fixture
write_torn_ordinary_finalization
cp "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" \
  "$TMP/runtime/state/aviam-web/current.json"
chmod 0600 "$TMP/runtime/state/aviam-web/current.json"
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
BASELINE_WEB_IMAGE="$DRILL_WEB_IMAGE"
BASELINE_COMMIT="$DRILL_COMMIT"
BASELINE_RUN="$DRILL_RUN"
TORN_ORDINARY_RUNNING_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
: > "$TMP/registry-down"
: > "$TMP/docker.log"
assert_failure "running ordinary finalization first resume returned success" controller --resume
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "running ordinary finalization reconciliation unpaused immediately"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$TORN_ORDINARY_RUNNING_LAST_HASH" ]] || fail "running ordinary finalization rewrote last-success B"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "running ordinary finalization rolled runtime back from B"
for state_file in "$TMP/runtime/state/aviam-web/current.json" "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"; do
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field status)" == succeeded ]] || fail "running ordinary finalization state was not succeeded"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field stage)" == complete ]] || fail "running ordinary finalization state was not complete"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field rollbackStatus)" == not-required ]] || fail "running ordinary finalization recorded a false rollback"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field messageCode)" == promotion_succeeded ]] || fail "running ordinary finalization state recorded the wrong message code"
done
mapfile -t torn_ordinary_running_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#torn_ordinary_running_ups[@]}" == 1 && "${torn_ordinary_running_ups[0]}" == "$DRILL_WEB_IMAGE" ]] || fail "running ordinary finalization did not locally revalidate B"
grep -Fq '|run --rm --pull never ' "$TMP/docker.log" || fail "running ordinary finalization API probe was not local-only"
! grep -Eq '\|pull( |$)' "$TMP/docker.log" || fail "running ordinary finalization consulted the registry"
: > "$TMP/docker.log"
assert_success "second resume stayed blocked after running ordinary finalization reconciliation" controller --resume
[[ ! -e "$TMP/runtime/state/aviam-web/paused" ]] || fail "second resume did not remove pause after running ordinary finalization reconciliation"
[[ ! -s "$TMP/docker.log" ]] || fail "second resume invoked Docker after running ordinary finalization reconciliation"

# A terminal current file cannot hide its same-digest running attempt. Neither
# an explicit drill nor retry for newer C may bypass pending B or consult C.
PENDING_REQUEST_DIGEST="sha256:$(repeat 4 64)"
for pending_kind in ordinary drill; do
  for pending_command in promote-drill retry; do
    reset_drill_fixture
    if [[ "$pending_kind" == ordinary ]]; then
      write_torn_ordinary_finalization
    else
      write_running_drill_attempt
      write_completed_drill_last_success
      write_drill_state "$TMP/runtime/state/aviam-web/current.json" succeeded complete succeeded promotion_with_rollback_drill_succeeded
      chmod 0600 "$TMP/runtime/state/aviam-web/current.json"
    fi
    node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
    printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
    ACTIVE_BUNDLE_DIGEST="$PENDING_REQUEST_DIGEST"
    ACTIVE_COMMIT="$(repeat 4 40)"
    ACTIVE_RUN=34
    PENDING_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
    PENDING_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
    PENDING_ATTEMPT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')"
    PENDING_ENV_HASH="$(sha256sum "$TMP/live/.env" | awk '{print $1}')"
    PENDING_MARKER_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/paused" | awk '{print $1}')"
    : > "$TMP/registry-down"
    : > "$TMP/docker.log"
    if [[ "$pending_command" == promote-drill ]]; then
      assert_failure "$pending_kind pending B allowed drill C" controller --promote-with-rollback-drill "$PENDING_REQUEST_DIGEST"
    else
      assert_failure "$pending_kind pending B allowed retry C" controller --retry "$PENDING_REQUEST_DIGEST"
    fi
    if [[ "$pending_kind" == ordinary ]]; then
      grep -Fq -- '--resume' "$TMP/error" || fail "$pending_command did not direct ordinary pending B to resume"
    else
      grep -Fq -- "--promote-with-rollback-drill $DRILL_BUNDLE_DIGEST" "$TMP/error" || fail "$pending_command did not name pending drill digest B"
    fi
    [[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$PENDING_LAST_HASH" ]] || fail "$pending_kind pending B $pending_command changed last-success"
    [[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$PENDING_CURRENT_HASH" ]] || fail "$pending_kind pending B $pending_command changed current"
    [[ "$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')" == "$PENDING_ATTEMPT_HASH" ]] || fail "$pending_kind pending B $pending_command changed its attempt"
    [[ "$(sha256sum "$TMP/live/.env" | awk '{print $1}')" == "$PENDING_ENV_HASH" ]] || fail "$pending_kind pending B $pending_command changed the environment"
    [[ "$(sha256sum "$TMP/runtime/state/aviam-web/paused" | awk '{print $1}')" == "$PENDING_MARKER_HASH" ]] || fail "$pending_kind pending B $pending_command rewrote the pause marker"
    [[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "$pending_kind pending B $pending_command changed the runtime image"
    [[ ! -e "$TMP/runtime/state/aviam-web/attempts/${PENDING_REQUEST_DIGEST#sha256:}.json" ]] || fail "$pending_kind pending B $pending_command created an attempt for C"
    assert_only_docker_readiness_checks "$pending_kind pending B $pending_command"
  done
done

# A pre-existing pause always dominates automatic recovery. Poll must be an
# absolute no-op for either ordinary or drill running state until an operator
# invokes the corresponding explicit recovery command.
POLL_ADVANCED_ALIAS_DIGEST="sha256:$(repeat c 64)"
for paused_running_kind in ordinary drill; do
  reset_drill_fixture
  if [[ "$paused_running_kind" == ordinary ]]; then
    write_ordinary_running_attempt health "$MISMATCH_API_BUNDLE" 21 "$MISMATCH_API_IMAGE" "$OPENAPI_SHA"
  else
    write_running_drill_attempt
  fi
  node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
  printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
  ACTIVE_BUNDLE_DIGEST="$POLL_ADVANCED_ALIAS_DIGEST"
  ACTIVE_COMMIT="$(repeat d 40)"
  ACTIVE_RUN=33
  PAUSED_RUNNING_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
  PAUSED_RUNNING_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
  PAUSED_RUNNING_ATTEMPT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')"
  PAUSED_RUNNING_ENV_HASH="$(sha256sum "$TMP/live/.env" | awk '{print $1}')"
  PAUSED_RUNNING_MARKER_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/paused" | awk '{print $1}')"
  : > "$TMP/registry-down"
  : > "$TMP/docker.log"
  assert_success "paused poll did not skip $paused_running_kind running state" controller --poll
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$PAUSED_RUNNING_LAST_HASH" ]] || fail "paused $paused_running_kind poll changed last-success"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$PAUSED_RUNNING_CURRENT_HASH" ]] || fail "paused $paused_running_kind poll changed current"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json" | awk '{print $1}')" == "$PAUSED_RUNNING_ATTEMPT_HASH" ]] || fail "paused $paused_running_kind poll changed attempt"
  [[ "$(sha256sum "$TMP/live/.env" | awk '{print $1}')" == "$PAUSED_RUNNING_ENV_HASH" ]] || fail "paused $paused_running_kind poll changed the environment"
  [[ "$(sha256sum "$TMP/runtime/state/aviam-web/paused" | awk '{print $1}')" == "$PAUSED_RUNNING_MARKER_HASH" ]] || fail "paused $paused_running_kind poll rewrote the pause marker"
  [[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "paused $paused_running_kind poll changed the runtime image"
  [[ ! -s "$TMP/docker.log" ]] || fail "paused $paused_running_kind poll invoked Docker"
done

# Poll must classify and contain an interrupted ordinary promotion before it
# resolves an alias. Even if the advertised alias has advanced to C and the
# registry is unavailable, running B is rolled back locally to A and paused.
reset_drill_fixture
rm -f "$TMP/runtime/state/aviam-web/paused"
write_ordinary_running_attempt health "$MISMATCH_API_BUNDLE" 21 "$MISMATCH_API_IMAGE" "$OPENAPI_SHA"
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
ACTIVE_BUNDLE_DIGEST="$POLL_ADVANCED_ALIAS_DIGEST"
ACTIVE_COMMIT="$(repeat d 40)"
ACTIVE_RUN=33
: > "$TMP/registry-down"
: > "$TMP/docker.log"
assert_failure "poll resolved advanced alias before containing ordinary running B" controller --poll
assert_failed_drill_state interrupted_attempt_rolled_back interrupted succeeded "ordinary running poll recovery"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "ordinary running poll recovery did not pause"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "ordinary running poll recovery did not restore A"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$DRILL_BASELINE_WEB_IMAGE\"" "$TMP/live/.env" || fail "ordinary running poll recovery did not configure A"
mapfile -t ordinary_poll_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#ordinary_poll_ups[@]}" == 1 && "${ordinary_poll_ups[0]}" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "ordinary running poll recovery did not perform exactly one local A rollback"
! grep -Eq '\|pull( |$)' "$TMP/docker.log" || fail "ordinary running poll recovery consulted advanced alias C"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "ordinary running poll recovery contacted the registry"
: > "$TMP/docker.log"
assert_success "paused poll did not skip after ordinary running recovery" controller --poll
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "second poll removed the recovery pause"
[[ ! -s "$TMP/docker.log" ]] || fail "second poll invoked Docker despite the recovery pause"

# The same pre-registry selector must inspect a running digest attempt even
# when current was already finalized. If last-success proves final B, poll
# locally revalidates B instead of rolling it back or following alias C.
reset_drill_fixture
rm -f "$TMP/runtime/state/aviam-web/paused"
write_torn_ordinary_finalization
node "$ROOT/env-tool.mjs" set --file "$TMP/live/.env" --key ELEVANT_AVIAM_WEB_IMAGE --value "$DRILL_WEB_IMAGE"
printf '%s\n' "$DRILL_WEB_IMAGE" > "$TMP/runtime-image"
BASELINE_WEB_IMAGE="$DRILL_WEB_IMAGE"
BASELINE_COMMIT="$DRILL_COMMIT"
BASELINE_RUN="$DRILL_RUN"
ACTIVE_BUNDLE_DIGEST="$POLL_ADVANCED_ALIAS_DIGEST"
ACTIVE_COMMIT="$(repeat d 40)"
ACTIVE_RUN=33
POLL_TORN_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
: > "$TMP/registry-down"
: > "$TMP/docker.log"
assert_failure "poll resolved advanced alias before reconciling ordinary final B" controller --poll
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "ordinary final-B poll reconciliation did not pause"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$POLL_TORN_LAST_HASH" ]] || fail "ordinary final-B poll reconciliation rewrote last-success"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_WEB_IMAGE" ]] || fail "ordinary final-B poll reconciliation rolled B back"
for state_file in "$TMP/runtime/state/aviam-web/current.json" "$TMP/runtime/state/aviam-web/attempts/${DRILL_BUNDLE_DIGEST#sha256:}.json"; do
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field status)" == succeeded ]] || fail "ordinary final-B poll state was not succeeded"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field stage)" == complete ]] || fail "ordinary final-B poll state was not complete"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field rollbackStatus)" == not-required ]] || fail "ordinary final-B poll state recorded a false rollback"
  [[ "$(node "$ROOT/state-tool.mjs" get --file "$state_file" --field messageCode)" == promotion_succeeded ]] || fail "ordinary final-B poll state recorded the wrong message code"
done
mapfile -t ordinary_torn_poll_ups < <(sed -n 's/^WEB_UP:[0-9][0-9]*://p' "$TMP/docker.log")
[[ "${#ordinary_torn_poll_ups[@]}" == 1 && "${ordinary_torn_poll_ups[0]}" == "$DRILL_WEB_IMAGE" ]] || fail "ordinary final-B poll did not locally revalidate exactly B"
grep -Fq '|run --rm --pull never ' "$TMP/docker.log" || fail "ordinary final-B poll API probe was not local-only"
! grep -Eq '\|pull( |$)' "$TMP/docker.log" || fail "ordinary final-B poll consulted advanced alias C"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "ordinary final-B poll contacted the registry"
: > "$TMP/docker.log"
assert_success "paused poll did not skip after ordinary final-B reconciliation" controller --poll
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "second poll removed the final-B reconciliation pause"
[[ ! -s "$TMP/docker.log" ]] || fail "second poll invoked Docker despite the final-B reconciliation pause"

# Leave the original successful A baseline in place for the ordinary rollback
# regression cases below.
reset_drill_fixture
rm -f "$TMP/runtime/state/aviam-web/paused"
unset ACTIVE_BUNDLE_DIGEST ACTIVE_COMMIT ACTIVE_RUN BASELINE_WEB_IMAGE BASELINE_COMMIT BASELINE_RUN

baseline_state_hash="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
FAILED_BUNDLE_DIGEST="sha256:$(repeat 6 64)"; FAILED_WEB_IMAGE="$WEB_REPO@sha256:$(repeat 7 64)"; FAILED_COMMIT="$(repeat 8 40)"
ACTIVE_BUNDLE_DIGEST="$FAILED_BUNDLE_DIGEST"; ACTIVE_COMMIT="$FAILED_COMMIT"; ACTIVE_RUN=31
BASELINE_WEB_IMAGE="$WEB_REPO@$WEB_DIGEST"; BASELINE_COMMIT="$COMMIT"; BASELINE_RUN=30
FAIL_HEALTH_IMAGE="$FAILED_WEB_IMAGE"
ARM_REGISTRY_OUTAGE=1
write_manifest "$FAILED_COMMIT" 31 "$FAILED_WEB_IMAGE"
: > "$TMP/docker.log"
rm -f "$TMP/registry-down"

assert_failure "unhealthy candidate did not fail" controller --poll
grep -q 'rollback completed' "$TMP/error" || fail "successful rollback was not reported"
grep -Fq 'SMOKE_EXECUTED:http://127.0.0.1:8080/dashboard' "$TMP/docker.log" || fail "rollback omitted the AVIAM workflow smoke route"
! grep -q REGISTRY_UNAVAILABLE "$TMP/docker.log" || fail "rollback contacted the unavailable registry after env mutation"
[[ "$(<"$TMP/runtime-image")" == "$BASELINE_WEB_IMAGE" ]] || fail "rollback did not restore prior image"
grep -q "ELEVANT_AVIAM_WEB_IMAGE=\"$BASELINE_WEB_IMAGE\"" "$TMP/live/.env" || fail "rollback did not restore env image"
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/current.json" --field rollbackStatus)" == succeeded ]] || fail "rollback status was not recorded"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$baseline_state_hash" ]] || fail "rollback changed last-success"

unset ARM_REGISTRY_OUTAGE
rm -f "$TMP/registry-down"
up_before="$(grep -c ' up -d --pull never --no-build --no-deps --force-recreate aviam-web$' "$TMP/docker.log")"
assert_success "failed digest poll was not suppressed" controller --poll
up_after="$(grep -c ' up -d --pull never --no-build --no-deps --force-recreate aviam-web$' "$TMP/docker.log")"
[[ "$up_before" == "$up_after" ]] || fail "failed digest was automatically retried"
grep -q 'automatic retry is disabled' "$TMP/error" || fail "fail-stop decision was not explained"

# A syntactically readable matching attempt with a different digest is corrupt
# selector state. Poll must fail closed before alias resolution and protect the
# valid baseline/current state instead of attempting legacy containment.
reset_drill_fixture
rm -f "$TMP/runtime/state/aviam-web/paused"
CORRUPT_MATCHING_ATTEMPT="$TMP/runtime/state/aviam-web/attempts/${BUNDLE_DIGEST#sha256:}.json"
CORRUPT_ATTEMPT_DIGEST="sha256:$(repeat f 64)"
printf '{"status":"running","manifestDigest":"%s"}\n' "$CORRUPT_ATTEMPT_DIGEST" > "$CORRUPT_MATCHING_ATTEMPT"
chmod 0600 "$CORRUPT_MATCHING_ATTEMPT"
CORRUPT_ATTEMPT_LAST_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')"
CORRUPT_ATTEMPT_CURRENT_HASH="$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')"
CORRUPT_ATTEMPT_STATE_HASH="$(sha256sum "$CORRUPT_MATCHING_ATTEMPT" | awk '{print $1}')"
CORRUPT_ATTEMPT_ENV_HASH="$(sha256sum "$TMP/live/.env" | awk '{print $1}')"
: > "$TMP/docker.log"
assert_failure "poll accepted a matching attempt with a corrupt digest" controller --poll
grep -q 'matching web attempt digest conflicts with current state' "$TMP/error" || fail "corrupt attempt digest rejection was not explained"
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "corrupt attempt digest did not pause the profile"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/last-success.json" | awk '{print $1}')" == "$CORRUPT_ATTEMPT_LAST_HASH" ]] || fail "corrupt attempt digest changed last-success"
[[ "$(sha256sum "$TMP/runtime/state/aviam-web/current.json" | awk '{print $1}')" == "$CORRUPT_ATTEMPT_CURRENT_HASH" ]] || fail "corrupt attempt digest changed current"
[[ "$(sha256sum "$CORRUPT_MATCHING_ATTEMPT" | awk '{print $1}')" == "$CORRUPT_ATTEMPT_STATE_HASH" ]] || fail "corrupt attempt digest rewrote its state"
[[ "$(sha256sum "$TMP/live/.env" | awk '{print $1}')" == "$CORRUPT_ATTEMPT_ENV_HASH" ]] || fail "corrupt attempt digest changed the environment"
[[ "$(<"$TMP/runtime-image")" == "$DRILL_BASELINE_WEB_IMAGE" ]] || fail "corrupt attempt digest changed the runtime image"
assert_only_docker_readiness_checks "corrupt attempt digest"

printf '%s: PASS\n' "$PROGRAM_NAME"
