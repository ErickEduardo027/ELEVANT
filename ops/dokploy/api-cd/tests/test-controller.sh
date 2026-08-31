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

readonly BUNDLE_DIGEST="sha256:$(repeat a 64)"
readonly API_DIGEST="sha256:$(repeat b 64)"
readonly DB_DIGEST="sha256:$(repeat d 64)"
readonly COMMIT="$(repeat c 40)"
readonly DB_COMMIT="$(repeat 5 40)"
readonly MIGRATION="sha256:$(repeat e 64)"
readonly MODEL="sha256:$(repeat f 64)"
readonly SEED="sha256:$(repeat 6 64)"
readonly API_MANIFEST_REPO=ghcr.io/example/elevant-api-release-manifest
readonly API_REPO=ghcr.io/example/elevant-api
readonly DB_REPO=ghcr.io/example/elevant-db-release-manifest

mkdir -p "$TMP/bundle" "$TMP/database-bundle" "$TMP/runtime/state/attempts" "$TMP/runtime/state/tmp" \
  "$TMP/runtime/state/compose/api" "$TMP/runtime/log" "$TMP/docker-config" \
  "$TMP/live" "$TMP/mock-bin"
cp "$ROOT/../database-cd/manifest-tool.mjs" "$TMP/database-manifest-tool.mjs"
chmod 0700 "$TMP/runtime/state" "$TMP/runtime/state/attempts" \
  "$TMP/runtime/state/tmp" "$TMP/runtime/state/compose" \
  "$TMP/runtime/state/compose/api" "$TMP/runtime/log"

cat > "$TMP/bundle/compose.development.api.yml" <<'YAML'
name: elevant-dev-api
services:
  api:
    image: "${ELEVANT_API_IMAGE:?immutable image required}"
    ports: ["127.0.0.1:18080:8080"]
YAML
cp "$TMP/bundle/compose.development.api.yml" "$TMP/live/docker-compose.yml"
API_COMPOSE_SHA="$(sha256sum "$TMP/bundle/compose.development.api.yml" | awk '{print $1}')"
cat > "$TMP/bundle/manifest.json" <<JSON
{
  "schemaVersion": 1,
  "environment": "Development",
  "source": {"repository":"Example/ELEVANT","ref":"refs/heads/Development","commit":"$COMMIT","runId":"30","runAttempt":1,"workflowUrl":"https://github.com/Example/ELEVANT/actions/runs/30"},
  "images": {"api":"$API_REPO@$API_DIGEST"},
  "compose": {"apiSha256":"$API_COMPOSE_SHA"},
  "database": {"requiredManifest":"$DB_REPO@$DB_DIGEST","requiredRunId":"20","migrationFingerprint":"$MIGRATION","modelFingerprint":"$MODEL"},
  "endpoints": {"containerPort":8080,"livenessPath":"/health","readinessPath":"/health/ready","pingPath":"/api/v1/system/ping","swaggerPath":"/swagger/v1/swagger.json"},
  "publishedAt": "2026-08-31T00:00:00Z"
}
JSON

cat > "$TMP/database-bundle/compose.development.database.yml" <<'YAML'
name: elevant-dev-database
services:
  sqlserver:
    image: mcr.microsoft.com/mssql/server@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
YAML
cat > "$TMP/database-bundle/compose.development.release.yml" <<'YAML'
name: elevant-dev-database-release
services:
  migrator:
    image: "${ELEVANT_DB_RELEASE_IMAGE}"
YAML
DB_COMPOSE_SHA="$(sha256sum "$TMP/database-bundle/compose.development.database.yml" | awk '{print $1}')"
DB_RELEASE_COMPOSE_SHA="$(sha256sum "$TMP/database-bundle/compose.development.release.yml" | awk '{print $1}')"
cat > "$TMP/database-bundle/manifest.json" <<JSON
{
  "schemaVersion": 1,
  "environment": "Development",
  "source": {"repository":"Example/ELEVANT","ref":"refs/heads/Development","commit":"$DB_COMMIT","runId":"20","runAttempt":1,"workflowUrl":"https://github.com/Example/ELEVANT/actions/runs/20"},
  "images": {"ops":"ghcr.io/example/elevant-db-ops@sha256:$(repeat 2 64)","release":"ghcr.io/example/elevant-db-release@sha256:$(repeat 4 64)"},
  "compose": {"databaseSha256":"$DB_COMPOSE_SHA","releaseSha256":"$DB_RELEASE_COMPOSE_SHA"},
  "database": {"migrationIds":["20260817200402_V1_01_Platform"],"migrationFingerprint":"$MIGRATION","modelFingerprint":"$MODEL","seedFingerprint":"$SEED"},
  "publishedAt": "2026-08-31T00:00:00Z"
}
JSON

cat > "$TMP/live/.env" <<ENV
ELEVANT_API_IMAGE="$API_REPO@$API_DIGEST"
RESTRICTED_SENTINEL="never-print"
ENV
chmod 0600 "$TMP/live/.env"
cat > "$TMP/database-state.json" <<JSON
{"api":"not-allowed"}
JSON
cat > "$TMP/database-state.json" <<JSON
{"databaseComposeSha256":"$(repeat 1 64)","manifestDigest":"$DB_DIGEST","messageCode":"promotion_succeeded","opsImage":"ghcr.io/example/elevant-db-ops@sha256:$(repeat 2 64)","releaseComposeSha256":"$(repeat 3 64)","releaseImage":"ghcr.io/example/elevant-db-release@sha256:$(repeat 4 64)","sourceCommit":"$(repeat 5 40)","sourceRunAttempt":"1","sourceRunId":"19","stage":"complete","status":"succeeded","updatedAt":"2026-08-31T00:00:00Z","workflowUrl":"https://github.com/Example/ELEVANT/actions/runs/19"}
JSON
chmod 0600 "$TMP/database-state.json"
: > "$TMP/database.lock"; chmod 0600 "$TMP/database.lock"

cat > "$TMP/config.env" <<ENV
ELEVANT_API_CD_MANIFEST_REPOSITORY=$API_MANIFEST_REPO
ELEVANT_API_CD_MANIFEST_ALIAS=development-certified
ELEVANT_API_CD_EXPECTED_REPOSITORY=Example/ELEVANT
ELEVANT_API_CD_EXPECTED_REF=refs/heads/Development
ELEVANT_API_CD_API_REPOSITORY=$API_REPO
ELEVANT_API_CD_DATABASE_MANIFEST_REPOSITORY=$DB_REPO
ELEVANT_API_CD_DATABASE_OPS_REPOSITORY=ghcr.io/example/elevant-db-ops
ELEVANT_API_CD_DATABASE_RELEASE_REPOSITORY=ghcr.io/example/elevant-db-release
ELEVANT_API_CD_DATABASE_STATE=$TMP/database-state.json
ELEVANT_API_CD_DATABASE_LOCK=$TMP/database.lock
ELEVANT_API_CD_DATABASE_MANIFEST_TOOL=$TMP/database-manifest-tool.mjs
ELEVANT_API_CD_DOCKER_CONFIG=$TMP/docker-config
ELEVANT_API_CD_PROJECT=elevant-dev-api-test
ELEVANT_API_CD_COMPOSE=$TMP/live/docker-compose.yml
ELEVANT_API_CD_ENV=$TMP/live/.env
ELEVANT_API_CD_STATE_DIR=$TMP/runtime/state
ELEVANT_API_CD_LOG_DIR=$TMP/runtime/log
ELEVANT_API_CD_LOCK_FILE=$TMP/runtime/state/controller.lock
ENV
chmod 0600 "$TMP/config.env"

cat > "$TMP/mock-bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"
case "${1:-} ${2:-}" in
  version*) exit 0 ;;
  pull*) exit 0 ;;
  create*) printf '%s\n' "${2:-}" > "$MOCK_LAST_CREATED"; printf '%064d\n' 0; exit 0 ;;
  rm*) exit 0 ;;
  cp*)
    source="${2#*:}"; destination="$3"; bundle="$MOCK_BUNDLE"
    case "$(<"$MOCK_LAST_CREATED")" in "$MOCK_DB_REPO@"*) bundle="$MOCK_DB_BUNDLE" ;; esac
    case "$source" in
      /manifest.json) cp "$bundle/manifest.json" "$destination" ;;
      /compose/compose.development.api.yml) cp "$bundle/compose.development.api.yml" "$destination" ;;
      /compose/compose.development.database.yml) cp "$bundle/compose.development.database.yml" "$destination" ;;
      /compose/compose.development.release.yml) cp "$bundle/compose.development.release.yml" "$destination" ;;
      *) exit 1 ;;
    esac
    exit 0
    ;;
  "image inspect")
    format="$4"; reference="$5"
    case "$format" in
      *RepoDigests*) printf '%s@%s\n' "$MOCK_API_MANIFEST_REPO" "$MOCK_BUNDLE_DIGEST" ;;
      *org.opencontainers.image.revision*) case "$reference" in "$MOCK_DB_REPO@"*) printf '%s\n' "$MOCK_DB_COMMIT" ;; *) printf '%s\n' "$MOCK_COMMIT" ;; esac ;;
      *org.opencontainers.image.source*) printf '%s\n' 'https://github.com/Example/ELEVANT' ;;
      *org.elevant.api.environment*) printf '%s\n' Development ;;
      *org.elevant.api.manifest.schema*) printf '%s\n' 1 ;;
      *io.elevant.api-release.bundle-version*) printf '%s\n' 1 ;;
      *io.elevant.api-release.media-type*) printf '%s\n' application/vnd.elevant.api-release-bundle.v1 ;;
      *org.elevant.database.environment*) printf '%s\n' Development ;;
      *org.elevant.database.manifest.schema*) printf '%s\n' 1 ;;
      *io.elevant.database-release.schema-version*) printf '%s\n' 1 ;;
      *io.elevant.database-release.bundle-version*) printf '%s\n' 1 ;;
      *io.elevant.database-release.media-type*) printf '%s\n' application/vnd.elevant.database-release-bundle.v1 ;;
      *) printf 'unexpected inspect format for %s\n' "$reference" >&2; exit 1 ;;
    esac
    exit 0
    ;;
  "compose version") exit 0 ;;
  "container ls") printf '%064d\n' 9 ;;
  "container inspect") printf '%s\n' 'running healthy 0' ;;
  "container exec")
    [[ "${4:-} ${5:-} ${6:-}" == 'dotnet Elevant.Api.dll --smoke-probe' ]] || exit 1
    printf '%s\n' SMOKE_PROBE_EXECUTED >> "$MOCK_DOCKER_LOG"
    ;;
  compose*)
    case " $* " in
      *" --format json "*) printf '%s\n' '{"name":"test","services":{"api":{"image":"${ELEVANT_API_IMAGE}"}}}' ;;
      *) exit 0 ;;
    esac
    ;;
  *) printf 'unexpected docker call: %s\n' "$*" >&2; exit 1 ;;
esac
MOCK
chmod 0555 "$TMP/mock-bin/docker"
cat > "$TMP/mock-bin/flock" <<'MOCK'
#!/usr/bin/env sh
exit 0
MOCK
chmod 0555 "$TMP/mock-bin/flock"
: > "$TMP/docker.log"

controller() {
  MOCK_DOCKER_LOG="$TMP/docker.log" MOCK_BUNDLE="$TMP/bundle" \
  MOCK_DB_BUNDLE="$TMP/database-bundle" MOCK_DB_REPO="$DB_REPO" \
  MOCK_DB_COMMIT="$DB_COMMIT" MOCK_LAST_CREATED="$TMP/last-created" \
  MOCK_API_MANIFEST_REPO="$API_MANIFEST_REPO" MOCK_BUNDLE_DIGEST="$BUNDLE_DIGEST" \
  MOCK_COMMIT="$COMMIT" ELEVANT_API_CD_TEST_MODE=1 \
  ELEVANT_API_CD_DOCKER_BIN="$TMP/mock-bin/docker" \
  ELEVANT_API_CD_WAIT_ATTEMPTS=1 ELEVANT_API_CD_WAIT_INTERVAL=0 \
  PATH="$TMP/mock-bin:$PATH" \
    "$ROOT/elevant-api-cd" --config "$TMP/config.env" "$@"
}

# The API manifest parser is closed and validates payload bytes.
assert_success "valid API bundle was rejected" \
  node "$ROOT/manifest-tool.mjs" validate --file "$TMP/bundle/manifest.json" \
    --bundle-root "$TMP/bundle" --expected-repository Example/ELEVANT \
    --expected-ref refs/heads/Development --api-repository "$API_REPO" \
    --database-manifest-repository "$DB_REPO"

cp "$TMP/bundle/manifest.json" "$TMP/bundle/manifest.saved"
node -e 'const fs=require("fs");const p=process.argv[1];const x=JSON.parse(fs.readFileSync(p));x.unexpected=true;fs.writeFileSync(p,JSON.stringify(x));' "$TMP/bundle/manifest.json"
assert_failure "manifest with an extra key was accepted" \
  node "$ROOT/manifest-tool.mjs" validate --file "$TMP/bundle/manifest.json" \
    --bundle-root "$TMP/bundle" --expected-repository Example/ELEVANT \
    --expected-ref refs/heads/Development --api-repository "$API_REPO" \
    --database-manifest-repository "$DB_REPO"
mv "$TMP/bundle/manifest.saved" "$TMP/bundle/manifest.json"

# A behind database is a deferral. Dry-run must preserve rc=2, while poll exits
# successfully without creating an attempt or changing the live image.
set +e
controller --dry-run >/dev/null 2>"$TMP/dry-run.error"
dry_run_status=$?
set -e
if [[ "$dry_run_status" != 2 ]]; then
  sed 's/^/  /' "$TMP/dry-run.error" >&2
  fail "dry-run masked database gate rc=2 as rc=$dry_run_status"
fi
grep -q 'deployment deferred' "$TMP/dry-run.error" || fail "dry-run did not explain the database deferral"
assert_success "poll did not safely defer a behind database" controller --poll
[[ ! -e "$TMP/runtime/state/current.json" ]] || fail "deferred poll created an attempt"
grep -q "ELEVANT_API_IMAGE=\"$API_REPO@$API_DIGEST\"" "$TMP/live/.env" || fail "deferred poll changed the API image"
grep -q 'never-print' "$TMP/live/.env" || fail "environment update damaged unrelated secrets"

assert_success "pause failed" controller --pause
[[ -f "$TMP/runtime/state/paused" ]] || fail "pause marker was not created"
before="$(wc -l < "$TMP/docker.log")"
assert_success "paused poll did not become a no-op" controller --poll
after="$(wc -l < "$TMP/docker.log")"
[[ "$before" == "$after" ]] || fail "paused poll invoked Docker"
assert_success "resume failed" controller --resume
[[ ! -e "$TMP/runtime/state/paused" ]] || fail "resume did not remove pause marker"

chmod 0644 "$TMP/live/.env"
assert_failure "world-readable restricted API environment was accepted" controller --dry-run
chmod 0600 "$TMP/live/.env"

# A compatible database promotion drives the complete deploy, health and
# in-container smoke path. This specifically prevents host-loopback regressions.
node -e 'const fs=require("fs");const p=process.argv[1];const x=JSON.parse(fs.readFileSync(p));x.sourceRunId="20";x.workflowUrl="https://github.com/Example/ELEVANT/actions/runs/20";fs.writeFileSync(p,JSON.stringify(x));' "$TMP/database-state.json"
assert_success "compatible API promotion failed" controller --poll
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/last-success.json" --field status)" == succeeded ]] ||
  fail "successful promotion did not persist last-success"
grep -q SMOKE_PROBE_EXECUTED "$TMP/docker.log" || fail "promotion did not run the in-container smoke probe"

# A corrupt last-success baseline must be contained as a rollback failure. It
# may not terminate before recording the failure and pausing future polls.
cat > "$TMP/runtime/state/last-success.json" <<'JSON'
{}
JSON
chmod 0600 "$TMP/runtime/state/last-success.json"
cat > "$TMP/runtime/state/attempts/${BUNDLE_DIGEST#sha256:}.json" <<'JSON'
{"status":"running"}
JSON
chmod 0600 "$TMP/runtime/state/attempts/${BUNDLE_DIGEST#sha256:}.json"
assert_success "corrupt rollback baseline escaped failure containment" controller --poll
[[ -f "$TMP/runtime/state/paused" ]] || fail "rollback failure did not pause the controller"
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/runtime/state/current.json" --field rollbackStatus)" == failed ]] ||
  fail "rollback failure was not recorded"

printf '%s: PASS\n' "$PROGRAM_NAME"
