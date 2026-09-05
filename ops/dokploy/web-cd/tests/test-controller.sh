#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d)"
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
  local commit="$1" run="$2" image="$3"
  cat > "$TMP/bundle/manifest.json" <<JSON
{"schemaVersion":1,"environment":"Development","application":"aviam-web","source":{"repository":"Example/ELEVANT","ref":"refs/heads/Development","commit":"$commit","runId":"$run","runAttempt":1,"workflowUrl":"https://github.com/Example/ELEVANT/actions/runs/$run"},"images":{"web":"$image"},"compose":{"webSha256":"$COMPOSE_SHA"},"api":{"requiredManifest":"$API_BUNDLE","requiredRunId":"20","requiredImage":"$API_IMAGE","openApiSha256":"$OPENAPI_SHA"},"build":{"configurationSha256":"sha256:$(repeat f 64)"},"endpoints":{"containerPort":8080,"healthPath":"/healthz","smokePaths":["/healthz","/","/dashboard"]},"publishedAt":"2026-09-05T00:00:00Z"}
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
      *io.elevant.api.required-manifest*) printf '%s\n' "$MOCK_API_BUNDLE" ;;
      *io.elevant.openapi.sha256*) printf '%s\n' "$MOCK_OPENAPI_SHA" ;;
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
      if [[ -n "$MOCK_FAIL_HEALTH_IMAGE" && "$runtime" == "$MOCK_FAIL_HEALTH_IMAGE" ]]; then
        printf 'running|unhealthy|0|%s\n' "$runtime"
      else
        printf 'running|healthy|0|%s\n' "$runtime"
      fi
    fi
    ;;
  "container exec")
    [[ "${4:-}" == wget ]]
    printf 'SMOKE_EXECUTED:%s\n' "${10:-}" >> "$MOCK_DOCKER_LOG"
    ;;
  run*)
    [[ "${MOCK_PROBE_FAIL:-0}" == 0 ]] || exit 22
    cat "$MOCK_OPENAPI"
    ;;
  compose*)
    case " $* " in
      *" --format json "*) printf '%s\n' '{"name":"test","services":{"aviam-web":{"image":"${ELEVANT_AVIAM_WEB_IMAGE}"}}}' ;;
      *" up -d --pull never --no-build --no-deps --force-recreate aviam-web "*)
        printf '%s\n' "${ELEVANT_AVIAM_WEB_IMAGE:-}" > "$MOCK_RUNTIME_IMAGE"
        [[ "${MOCK_ARM_REGISTRY_OUTAGE:-0}" == 0 ]] || : > "$MOCK_REGISTRY_DOWN"
        ;;
      *) exit 0 ;;
    esac
    ;;
  *) printf 'unexpected docker call: %s\n' "$*" >&2; exit 1 ;;
esac
MOCK
chmod 0555 "$TMP/mock-bin/docker"

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
  MOCK_DEFAULT_WEB_IMAGE="${RUNTIME_WEB_IMAGE:-${BASELINE_WEB_IMAGE:-$INITIAL_WEB_IMAGE}}" \
  MOCK_API_BUNDLE="$API_BUNDLE" MOCK_API_IMAGE="${RUNTIME_API_IMAGE:-$API_IMAGE}" MOCK_OPENAPI_SHA="$OPENAPI_SHA" MOCK_OPENAPI="$TMP/openapi.json" MOCK_RUNTIME_IMAGE="$TMP/runtime-image" \
  MOCK_API_ORIGIN_LABEL="${IMAGE_API_ORIGIN:-$API_ORIGIN}" \
  MOCK_API_CONTAINER_COUNT="${API_CONTAINER_COUNT:-1}" \
  MOCK_PROBE_FAIL="${PROBE_FAIL:-0}" \
  MOCK_ARM_REGISTRY_OUTAGE="${ARM_REGISTRY_OUTAGE:-0}" MOCK_REGISTRY_DOWN="$TMP/registry-down" \
  MOCK_FAIL_HEALTH_IMAGE="${FAIL_HEALTH_IMAGE:-}" ELEVANT_WEB_CD_TEST_MODE=1 \
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

cat > "$TMP/runtime/state/aviam-web/last-success.json" <<'JSON'
{}
JSON
chmod 0600 "$TMP/runtime/state/aviam-web/last-success.json"
cat > "$TMP/runtime/state/aviam-web/attempts/${FAILED_BUNDLE_DIGEST#sha256:}.json" <<'JSON'
{"status":"running"}
JSON
chmod 0600 "$TMP/runtime/state/aviam-web/attempts/${FAILED_BUNDLE_DIGEST#sha256:}.json"
assert_success "rollback failure escaped containment" controller --poll
[[ -f "$TMP/runtime/state/aviam-web/paused" ]] || fail "rollback failure did not pause profile"
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/aviam-web/current.json" --field rollbackStatus)" == failed ]] || fail "rollback failure was not recorded"

printf '%s: PASS\n' "$PROGRAM_NAME"
