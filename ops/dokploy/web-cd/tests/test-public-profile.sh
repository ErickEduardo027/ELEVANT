#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
fail() { printf '%s: FAIL: %s\n' "$PROGRAM_NAME" "$*" >&2; exit 1; }
repeat() { printf '%*s' "$2" '' | tr ' ' "$1"; }

BUNDLE_REPO=ghcr.io/example/elevant-public-web-release-manifest
WEB_REPO=ghcr.io/example/elevant-public-web
API_BUNDLE="ghcr.io/example/elevant-api-release-manifest@sha256:$(repeat 1 64)"
API_IMAGE="ghcr.io/example/elevant-api@sha256:$(repeat 2 64)"
INITIAL_WEB_IMAGE="$WEB_REPO@sha256:$(repeat 7 64)"
WEB_IMAGE="$WEB_REPO@sha256:$(repeat 3 64)"
BUNDLE_DIGEST="sha256:$(repeat 4 64)"
COMMIT="$(repeat 5 40)"
INITIAL_COMMIT="$(repeat 8 40)"
PROBE_IMAGE="docker.io/curlimages/curl@sha256:$(repeat 9 64)"
API_ORIGIN=https://api.example.test

mkdir -p "$TMP/bundle" "$TMP/state/public-web/attempts" "$TMP/state/public-web/tmp" \
  "$TMP/state/public-web/compose/web" "$TMP/log/public-web" "$TMP/docker-config" "$TMP/live" "$TMP/bin"
chmod 0700 "$TMP/state" "$TMP/state/public-web" "$TMP/state/public-web/attempts" "$TMP/state/public-web/tmp" \
  "$TMP/state/public-web/compose" "$TMP/state/public-web/compose/web" "$TMP/log/public-web"
cat > "$TMP/openapi.json" <<'JSON'
{"openapi":"3.0.4","info":{"title":"Elevant","version":"v1"},"paths":{}}
JSON
OPENAPI_SHA="$(node "$ROOT/openapi-tool.mjs" hash --file "$TMP/openapi.json")"
cat > "$TMP/bundle/compose.development.web.yml" <<'YAML'
name: elevant-dev-public-web
services:
  public-web:
    image: "${ELEVANT_PUBLIC_WEB_IMAGE:?immutable image required}"
    ports: ["127.0.0.1:18082:3000"]
YAML
cp "$TMP/bundle/compose.development.web.yml" "$TMP/live/docker-compose.yml"
COMPOSE_SHA="$(sha256sum "$TMP/bundle/compose.development.web.yml" | awk '{print $1}')"
cat > "$TMP/bundle/manifest.json" <<JSON
{"schemaVersion":1,"environment":"Development","application":"public-web","source":{"repository":"Example/ELEVANT","ref":"refs/heads/Development","commit":"$COMMIT","runId":"40","runAttempt":1,"workflowUrl":"https://github.com/Example/ELEVANT/actions/runs/40"},"images":{"web":"$WEB_IMAGE"},"compose":{"webSha256":"$COMPOSE_SHA"},"api":{"requiredManifest":"$API_BUNDLE","requiredRunId":"20","requiredImage":"$API_IMAGE","openApiSha256":"$OPENAPI_SHA"},"build":{"configurationSha256":"sha256:$(repeat 6 64)"},"endpoints":{"containerPort":3000,"healthPath":"/health","smokePaths":["/health","/","/login"]},"publishedAt":"2026-09-05T00:00:00Z"}
JSON
cat > "$TMP/live/.env" <<ENV
ELEVANT_PUBLIC_WEB_IMAGE="$INITIAL_WEB_IMAGE"
SENTINEL="preserve"
ENV
chmod 0600 "$TMP/live/.env"
cat > "$TMP/api-state.json" <<JSON
{"apiComposeSha256":"$(repeat 7 64)","apiImage":"$API_IMAGE","databaseManifest":"ghcr.io/example/elevant-db-release-manifest@sha256:$(repeat 8 64)","databaseRunId":"10","manifestDigest":"${API_BUNDLE#*@}","messageCode":"promotion_succeeded","migrationFingerprint":"sha256:$(repeat 9 64)","modelFingerprint":"sha256:$(repeat a 64)","rollbackStatus":"not-required","sourceCommit":"$(repeat b 40)","sourceRunAttempt":"1","sourceRunId":"20","stage":"complete","status":"succeeded","updatedAt":"2026-09-05T00:00:00Z","workflowUrl":"https://github.com/Example/ELEVANT/actions/runs/20"}
JSON
chmod 0600 "$TMP/api-state.json"
: > "$TMP/db.lock"; : > "$TMP/api.lock"; chmod 0600 "$TMP/db.lock" "$TMP/api.lock"
cat > "$TMP/config.env" <<ENV
ELEVANT_WEB_CD_APPLICATION=public-web
ELEVANT_WEB_CD_MANIFEST_REPOSITORY=$BUNDLE_REPO
ELEVANT_WEB_CD_MANIFEST_ALIAS=development-certified
ELEVANT_WEB_CD_EXPECTED_REPOSITORY=Example/ELEVANT
ELEVANT_WEB_CD_EXPECTED_REF=refs/heads/Development
ELEVANT_WEB_CD_WEB_REPOSITORY=$WEB_REPO
ELEVANT_WEB_CD_API_MANIFEST_REPOSITORY=ghcr.io/example/elevant-api-release-manifest
ELEVANT_WEB_CD_API_IMAGE_REPOSITORY=ghcr.io/example/elevant-api
ELEVANT_WEB_CD_API_STATE=$TMP/api-state.json
ELEVANT_WEB_CD_API_LOCK=$TMP/api.lock
ELEVANT_WEB_CD_API_PROJECT=elevant-dev-api-test
ELEVANT_WEB_CD_API_SERVICE=api
ELEVANT_WEB_CD_API_CONTAINER_PORT=8080
ELEVANT_WEB_CD_API_OPENAPI_PATH=/swagger/v1/swagger.json
ELEVANT_WEB_CD_HTTP_PROBE_IMAGE=$PROBE_IMAGE
ELEVANT_WEB_CD_EXPECTED_API_ORIGIN=$API_ORIGIN
ELEVANT_WEB_CD_DATABASE_LOCK=$TMP/db.lock
ELEVANT_WEB_CD_DOCKER_CONFIG=$TMP/docker-config
ELEVANT_WEB_CD_PROJECT=elevant-dev-public-web-test
ELEVANT_WEB_CD_COMPOSE=$TMP/live/docker-compose.yml
ELEVANT_WEB_CD_ENV=$TMP/live/.env
ELEVANT_WEB_CD_SERVICE=public-web
ELEVANT_WEB_CD_IMAGE_ENV=ELEVANT_PUBLIC_WEB_IMAGE
ELEVANT_WEB_CD_STATE_DIR=$TMP/state/public-web
ELEVANT_WEB_CD_LOG_DIR=$TMP/log/public-web
ELEVANT_WEB_CD_GLOBAL_LOCK=$TMP/state/controller.lock
ELEVANT_WEB_CD_LOCK_FILE=$TMP/state/public-web/controller.lock
ENV
chmod 0600 "$TMP/config.env"

cat > "$TMP/bin/flock" <<'MOCK'
#!/usr/bin/env sh
exit 0
MOCK
cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$MOCK_LOG"
case "${1:-} ${2:-}" in
  version*|pull*|"compose version") exit 0 ;;
  create*) printf '%064d\n' 0 ;;
  rm*) exit 0 ;;
  cp*)
    case "${2#*:}" in
      /manifest.json) cp "$MOCK_BUNDLE/manifest.json" "$3" ;;
      /compose/compose.development.web.yml) cp "$MOCK_BUNDLE/compose.development.web.yml" "$3" ;;
      *) exit 1 ;;
    esac ;;
  "image inspect")
    format="$4"; reference="$5"
    case "$format" in
      *RepoDigests*) printf '%s@%s\n' "$MOCK_BUNDLE_REPO" "$MOCK_BUNDLE_DIGEST" ;;
      *org.opencontainers.image.revision*)
        if [[ "$reference" == "$MOCK_BASELINE_WEB_IMAGE" ]]; then printf '%s\n' "$MOCK_BASELINE_COMMIT"; else printf '%s\n' "$MOCK_COMMIT"; fi ;;
      *org.opencontainers.image.source*) printf '%s\n' https://github.com/Example/ELEVANT ;;
      *io.elevant.application*) printf '%s\n' public-web ;;
      *io.elevant.environment*) printf '%s\n' Development ;;
      *io.elevant.source.run-id*)
        if [[ "$reference" == "$MOCK_BASELINE_WEB_IMAGE" ]]; then printf '%s\n' 39; else printf '%s\n' 40; fi ;;
      *io.elevant.api.required-manifest*) printf '%s\n' "$MOCK_API_BUNDLE" ;;
      *io.elevant.openapi.sha256*) printf '%s\n' "$MOCK_OPENAPI_SHA" ;;
      *io.elevant.web.api-origin*) printf '%s\n' "$MOCK_API_ORIGIN" ;;
      *io.elevant.web-release.schema-version*|*io.elevant.web-release.bundle-version*) printf '%s\n' 1 ;;
      *io.elevant.web-release.media-type*) printf '%s\n' application/vnd.elevant.web-release-bundle.v1 ;;
      *) exit 1 ;;
    esac ;;
  "container ls")
    if [[ " $* " == *" label=com.docker.compose.project=elevant-dev-api-test "* ]]; then printf '%064d\n' 9; else printf '%064d\n' 8; fi
    ;;
  "container inspect")
    if [[ "${5:-}" == "$(printf '%064d' 9)" ]]; then
      printf 'running|healthy|0|%s\n' "$MOCK_API_IMAGE"
    else
      runtime=""; [[ ! -f "$MOCK_RUNTIME_IMAGE" ]] || runtime="$(<"$MOCK_RUNTIME_IMAGE")"
      [[ -n "$runtime" ]] || runtime="$MOCK_BASELINE_WEB_IMAGE"
      printf 'running|healthy|0|%s\n' "$runtime"
    fi
    ;;
  "container exec")
    [[ "$4" == node && "$5" == -e ]]
    printf '%s\n' "PUBLIC_NODE_SMOKE:${7:-}" >> "$MOCK_LOG"
    ;;
  run*) cat "$MOCK_OPENAPI" ;;
  compose*)
    case " $* " in
      *" --format json "*) printf '%s\n' '{"name":"test","services":{"public-web":{"image":"${ELEVANT_PUBLIC_WEB_IMAGE}"}}}' ;;
      *" up -d --pull never --no-build --no-deps --force-recreate public-web "*) printf '%s\n' "${ELEVANT_PUBLIC_WEB_IMAGE:-}" > "$MOCK_RUNTIME_IMAGE" ;;
      *) : ;;
    esac ;;
  *) exit 1 ;;
esac
MOCK
chmod 0555 "$TMP/bin/docker" "$TMP/bin/flock"
: > "$TMP/docker.log"

MOCK_OPENAPI="$TMP/openapi.json" MOCK_BUNDLE="$TMP/bundle" MOCK_LOG="$TMP/docker.log" \
MOCK_BUNDLE_REPO="$BUNDLE_REPO" MOCK_BUNDLE_DIGEST="$BUNDLE_DIGEST" MOCK_COMMIT="$COMMIT" \
MOCK_BASELINE_WEB_IMAGE="$INITIAL_WEB_IMAGE" MOCK_BASELINE_COMMIT="$INITIAL_COMMIT" \
MOCK_API_BUNDLE="$API_BUNDLE" MOCK_API_IMAGE="$API_IMAGE" MOCK_OPENAPI_SHA="$OPENAPI_SHA" MOCK_API_ORIGIN="$API_ORIGIN" \
MOCK_RUNTIME_IMAGE="$TMP/runtime-image" \
ELEVANT_WEB_CD_TEST_MODE=1 ELEVANT_WEB_CD_DOCKER_BIN="$TMP/bin/docker" \
ELEVANT_WEB_CD_TEST_DATABASE_LOCK="$TMP/db.lock" ELEVANT_WEB_CD_TEST_API_LOCK="$TMP/api.lock" \
ELEVANT_WEB_CD_TEST_GLOBAL_LOCK="$TMP/state/controller.lock" \
ELEVANT_WEB_CD_WAIT_ATTEMPTS=1 ELEVANT_WEB_CD_WAIT_INTERVAL=0 PATH="$TMP/bin:$PATH" \
  "$ROOT/elevant-web-cd" --app public-web --config "$TMP/config.env" --adopt-current >/dev/null
grep -Fq 'PUBLIC_NODE_SMOKE:http://127.0.0.1:3000/login' "$TMP/docker.log" || fail "Public adoption omitted the login smoke route"
: > "$TMP/docker.log"

MOCK_OPENAPI="$TMP/openapi.json" MOCK_BUNDLE="$TMP/bundle" MOCK_LOG="$TMP/docker.log" \
MOCK_BUNDLE_REPO="$BUNDLE_REPO" MOCK_BUNDLE_DIGEST="$BUNDLE_DIGEST" MOCK_COMMIT="$COMMIT" \
MOCK_BASELINE_WEB_IMAGE="$INITIAL_WEB_IMAGE" MOCK_BASELINE_COMMIT="$INITIAL_COMMIT" \
MOCK_API_BUNDLE="$API_BUNDLE" MOCK_API_IMAGE="$API_IMAGE" MOCK_OPENAPI_SHA="$OPENAPI_SHA" MOCK_API_ORIGIN="$API_ORIGIN" \
MOCK_RUNTIME_IMAGE="$TMP/runtime-image" \
ELEVANT_WEB_CD_TEST_MODE=1 ELEVANT_WEB_CD_DOCKER_BIN="$TMP/bin/docker" \
ELEVANT_WEB_CD_TEST_DATABASE_LOCK="$TMP/db.lock" ELEVANT_WEB_CD_TEST_API_LOCK="$TMP/api.lock" \
ELEVANT_WEB_CD_TEST_GLOBAL_LOCK="$TMP/state/controller.lock" \
ELEVANT_WEB_CD_WAIT_ATTEMPTS=1 ELEVANT_WEB_CD_WAIT_INTERVAL=0 PATH="$TMP/bin:$PATH" \
  "$ROOT/elevant-web-cd" --app public-web --config "$TMP/config.env" --poll >/dev/null

[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/state/public-web/last-success.json" --field status)" == succeeded ]] || fail "Public profile did not persist success"
grep -q PUBLIC_NODE_SMOKE "$TMP/docker.log" || fail "Public profile did not use Node in-container smoke"
grep -Fq 'PUBLIC_NODE_SMOKE:http://127.0.0.1:3000/login' "$TMP/docker.log" || fail "Public promotion omitted the login smoke route"
grep -Fq 'up -d --pull never --no-build --no-deps --force-recreate public-web' "$TMP/docker.log" || fail "Public promotion allowed an implicit pull"
grep -Fq -- "--network container:$(printf '%064d' 9)" "$TMP/docker.log" || fail "Public profile did not probe the API namespace"
[[ ! -e "$TMP/state/aviam-web" ]] || fail "Public profile created AVIAM state"
grep -q 'SENTINEL="preserve"' "$TMP/live/.env" || fail "Public profile damaged unrelated environment"

printf '%s: PASS\n' "$PROGRAM_NAME"
