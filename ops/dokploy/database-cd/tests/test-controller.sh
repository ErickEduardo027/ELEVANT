#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly ROOT_DIR
readonly CONTROLLER="$ROOT_DIR/elevant-database-cd"
readonly MANIFEST_TOOL="$ROOT_DIR/manifest-tool.mjs"
readonly COMPOSE_MODEL_TOOL="$ROOT_DIR/compose-model-tool.mjs"
readonly STATE_TOOL="$ROOT_DIR/state-tool.mjs"

fail() {
  printf '%s: FAIL: %s\n' "$PROGRAM_NAME" "$*" >&2
  exit 1
}

assert_equal() {
  local expected="$1" actual="$2" message="$3"
  [[ "$actual" == "$expected" ]] || \
    fail "$message (expected=$expected actual=$actual)"
}

assert_success() {
  local message="$1"
  shift
  "$@" || fail "$message"
}

assert_failure() {
  local message="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail "$message"
  fi
}

database_operation_count() {
  if [[ ! -f "$MOCK_LOG" ]]; then
    printf '0\n'
    return
  fi
  grep -c ' run --rm --no-deps ' "$MOCK_LOG" || true
}

assert_failure_without_database_operation() {
  local message="$1" before after
  shift
  before="$(database_operation_count)"
  if "$@" >/dev/null 2>&1; then
    fail "$message"
  fi
  after="$(database_operation_count)"
  assert_equal "$before" "$after" \
    "$message; rejection occurred after a database operation"
}

assert_success_with_one_database_operation() {
  local message="$1" before after
  shift
  before="$(database_operation_count)"
  "$@" || fail "$message"
  after="$(database_operation_count)"
  assert_equal "$((before + 1))" "$after" \
    "$message; command did not execute exactly one database operation"
}

NODE_BIN="$(command -v node 2>/dev/null || true)"
[[ -n "$NODE_BIN" ]] || fail "node is required"
REAL_FLOCK_BIN="$(command -v flock 2>/dev/null || true)"

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/elevant-database-cd-test.XXXXXX")"
[[ "$TEST_TMP" == *elevant-database-cd-test.* ]] || fail "unsafe test temp path"
cleanup() {
  rm -rf -- "$TEST_TMP"
}
trap cleanup EXIT

INSTALL_ROOT="$TEST_TMP/install-root"
INSTALL_DESTINATION="$INSTALL_ROOT/etc/dokploy/elevant/database-cd"
mkdir -p "$INSTALL_ROOT/etc/dokploy"
chmod 0700 "$INSTALL_ROOT" "$INSTALL_ROOT/etc" "$INSTALL_ROOT/etc/dokploy"
ELEVANT_CD_INSTALL_TEST_MODE=1 \
ELEVANT_CD_INSTALL_TEST_ROOT="$INSTALL_ROOT" \
  bash "$ROOT_DIR/install-controller" --destination "$INSTALL_DESTINATION" \
  >/dev/null
for installed_file in elevant-database-cd manifest-tool.mjs compose-model-tool.mjs \
  state-tool.mjs \
  verify-runtime jobs/poll.job.sh jobs/backup.job.sh jobs/restore-check.job.sh \
  config.env.example README.md config.env; do
  [[ -f "$INSTALL_DESTINATION/$installed_file" && \
     ! -L "$INSTALL_DESTINATION/$installed_file" ]] || \
    fail "installer inventory is incomplete or contains a symlink"
done
case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *)
    for installed_file in elevant-database-cd manifest-tool.mjs \
      compose-model-tool.mjs state-tool.mjs \
      verify-runtime jobs/poll.job.sh jobs/backup.job.sh jobs/restore-check.job.sh; do
      assert_equal "$(id -u):$(id -g):555" \
        "$(stat -c '%u:%g:%a' -- "$INSTALL_DESTINATION/$installed_file")" \
        "installer executable mode is incorrect"
    done
    for installed_file in config.env.example README.md; do
      assert_equal "$(id -u):$(id -g):444" \
        "$(stat -c '%u:%g:%a' -- "$INSTALL_DESTINATION/$installed_file")" \
        "installer read-only template mode is incorrect"
    done
    assert_equal "$(id -u):$(id -g):600" \
      "$(stat -c '%u:%g:%a' -- "$INSTALL_DESTINATION/config.env")" \
      "installer did not create a restricted placeholder config"
    ;;
esac

MOCK_BIN="$TEST_TMP/bin"
MOCK_LOG="$TEST_TMP/docker.log"
MOCK_OPS_LOG="$TEST_TMP/docker-ops.log"
MOCK_FLOCK_LOG="$TEST_TMP/flock.log"
MOCK_MANIFEST_FILE="$TEST_TMP/manifest.json"
MOCK_DATABASE_PAYLOAD="$TEST_TMP/compose.development.database.yml"
MOCK_RELEASE_PAYLOAD="$TEST_TMP/compose.development.release.yml"
MOCK_IMAGE_REVISIONS="$TEST_TMP/image-revisions.txt"
DOCKER_CONFIG_DIR="$TEST_TMP/docker-config"
STATE_DIR="$TEST_TMP/state"
LOG_DIR="$TEST_TMP/log"
DATABASE_COMPOSE="$TEST_TMP/database-compose.yml"
DATABASE_ENV="$TEST_TMP/database.env"
RELEASE_COMPOSE="$TEST_TMP/release-compose.yml"
RELEASE_ENV="$TEST_TMP/release.env"
CONFIG_FILE="$TEST_TMP/config.env"
mkdir -p "$MOCK_BIN" "$DOCKER_CONFIG_DIR" "$STATE_DIR/attempts" \
  "$STATE_DIR/tmp" "$STATE_DIR/compose/database" \
  "$STATE_DIR/compose/release" "$LOG_DIR"
chmod 0700 "$DOCKER_CONFIG_DIR" "$STATE_DIR" "$STATE_DIR/attempts" \
  "$STATE_DIR/tmp" "$STATE_DIR/compose" "$STATE_DIR/compose/database" \
  "$STATE_DIR/compose/release" "$LOG_DIR"
printf '%s\n' '# Dokploy formatting' 'x-elevant-test-semantic: stable' \
  'services: {sqlserver: {image: example.invalid/sql:immutable}}' \
  > "$DATABASE_COMPOSE"
printf '%s\n' '# Dokploy formatting' 'x-elevant-test-semantic: stable' \
  'services: {migrator: {image: example.invalid/release:immutable}}' \
  > "$RELEASE_COMPOSE"
printf '%s\n' 'services:' '  sqlserver:' \
  '    image: example.invalid/sql:immutable' 'x-elevant-test-semantic: stable' \
  > "$MOCK_DATABASE_PAYLOAD"
printf '%s\n' 'services:' '  migrator:' \
  '    image: example.invalid/release:immutable' 'x-elevant-test-semantic: stable' \
  > "$MOCK_RELEASE_PAYLOAD"
printf '%s\n' 'SECRET_VALUE=not-a-real-secret' > "$DATABASE_ENV"
printf '%s\n' 'OTHER_SECRET=not-a-real-secret' > "$RELEASE_ENV"
chmod 0600 "$DATABASE_ENV" "$RELEASE_ENV"

export MOCK_LOG MOCK_OPS_LOG MOCK_MANIFEST_FILE MOCK_DATABASE_PAYLOAD \
  MOCK_RELEASE_PAYLOAD MOCK_IMAGE_REVISIONS MOCK_FLOCK_LOG
export MOCK_MANIFEST_REPOSITORY="ghcr.io/example/elevant-db-release-manifest"
export MOCK_OPS_REPOSITORY="ghcr.io/example/elevant-db-ops"
export MOCK_RELEASE_REPOSITORY="ghcr.io/example/elevant-db-release"
export MOCK_SOURCE="https://github.com/Example/ELEVANT"
export MOCK_FAIL_MATCH=""
export MOCK_FAIL_ALL=0
export MOCK_FLOCK_FAIL=0
export MOCK_MANIFEST_SCHEMA_LABEL=1
export MOCK_RELEASE_SCHEMA_LABEL=1
export MOCK_BUNDLE_VERSION_LABEL=1
export MOCK_MEDIA_TYPE_LABEL=application/vnd.elevant.database-release-bundle.v1

cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$MOCK_LOG"
joined="$*"
if [[ "$joined" == *"run --rm --no-deps backup"* ]]; then
  printf '%s\n' "${ELEVANT_DB_OPS_IMAGE:-missing}" >> "$MOCK_OPS_LOG"
fi
if [[ "${MOCK_FAIL_ALL:-0}" == "1" ]]; then
  exit 42
fi
if [[ -n "${MOCK_FAIL_MATCH:-}" && "$joined" == *"$MOCK_FAIL_MATCH"* ]]; then
  exit 42
fi
case "${1:-}" in
  version)
    exit 0
    ;;
  pull)
    exit 0
    ;;
  image)
    [[ "${2:-}" == "inspect" ]] || exit 64
    format="${4:-}"
    if [[ "$format" == *RepoDigests* ]]; then
      printf '%s@%s\n' "$MOCK_MANIFEST_REPOSITORY" "$MOCK_DIGEST"
    elif [[ "$format" == *org.opencontainers.image.revision* ]]; then
      image_ref="${*: -1}"
      revision="$(awk -F '|' -v ref="$image_ref" '$1 == ref { value=$2 } END { print value }' \
        "$MOCK_IMAGE_REVISIONS")"
      printf '%s\n' "${revision:-$MOCK_COMMIT}"
    elif [[ "$format" == *org.opencontainers.image.source* ]]; then
      printf '%s\n' "$MOCK_SOURCE"
    elif [[ "$format" == *org.elevant.database.environment* ]]; then
      printf '%s\n' Development
    elif [[ "$format" == *org.elevant.database.manifest.schema* ]]; then
      printf '%s\n' "${MOCK_MANIFEST_SCHEMA_LABEL-1}"
    elif [[ "$format" == *io.elevant.database-release.schema-version* ]]; then
      printf '%s\n' "${MOCK_RELEASE_SCHEMA_LABEL-1}"
    elif [[ "$format" == *io.elevant.database-release.bundle-version* ]]; then
      printf '%s\n' "${MOCK_BUNDLE_VERSION_LABEL-1}"
    elif [[ "$format" == *io.elevant.database-release.media-type* ]]; then
      printf '%s\n' "${MOCK_MEDIA_TYPE_LABEL-application/vnd.elevant.database-release-bundle.v1}"
    else
      printf 'unexpected image inspect format: %s\n' "$format" >&2
      exit 64
    fi
    ;;
  create)
    [[ "${2:-}" == "$MOCK_MANIFEST_REPOSITORY@$MOCK_DIGEST" ]] || exit 65
    printf '%s\n' manifest-container
    ;;
  cp)
    case "${2:-}" in
      *:/manifest.json)
        command cp -- "$MOCK_MANIFEST_FILE" "${3:?destination required}"
        ;;
      *:/compose/compose.development.database.yml)
        command cp -- "$MOCK_DATABASE_PAYLOAD" "${3:?destination required}"
        ;;
      *:/compose/compose.development.release.yml)
        command cp -- "$MOCK_RELEASE_PAYLOAD" "${3:?destination required}"
        ;;
      *) exit 66 ;;
    esac
    ;;
  rm)
    exit 0
    ;;
  compose)
    if [[ "$joined" == *" config "* && "$joined" == *"--format json"* ]]; then
      compose_file=""
      previous=""
      for argument in "$@"; do
        if [[ "$previous" == "-f" ]]; then
          compose_file="$argument"
          break
        fi
        previous="$argument"
      done
      [[ -n "$compose_file" ]] || exit 67
      semantic="$(awk -F ': *' '/^x-elevant-test-semantic:/{print $2; exit}' \
        "$compose_file")"
      printf '{"x-elevant-test-semantic":"%s"}\n' "$semantic"
    fi
    exit 0
    ;;
  *)
    printf 'unexpected mocked docker command: %s\n' "$*" >&2
    exit 64
    ;;
esac
MOCK
chmod 0755 "$MOCK_BIN/docker"

cat > "$MOCK_BIN/flock" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MOCK_FLOCK_LOG"
exit_code="${MOCK_FLOCK_FAIL:-0}"
[[ "$exit_code" =~ ^([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$ ]] || \
  exit 64
exit "$exit_code"
MOCK
chmod 0755 "$MOCK_BIN/flock"

database_hash="$(sha256sum -- "$MOCK_DATABASE_PAYLOAD" | awk '{print $1}')"
release_hash="$(sha256sum -- "$MOCK_RELEASE_PAYLOAD" | awk '{print $1}')"
CACHED_DATABASE_COMPOSE="$STATE_DIR/compose/database/$database_hash.yml"
CACHED_RELEASE_COMPOSE="$STATE_DIR/compose/release/$release_hash.yml"

repeat_hex() {
  local character="$1"
  printf '%*s' 64 '' | tr ' ' "$character"
}

make_manifest() {
  local commit="$1" ops_hex="$2" release_hex="$3" run_id="$4"
  printf '%s|%s\n' "$MOCK_OPS_REPOSITORY@sha256:$ops_hex" "$commit" \
    >> "$MOCK_IMAGE_REVISIONS"
  printf '%s|%s\n' "$MOCK_RELEASE_REPOSITORY@sha256:$release_hex" "$commit" \
    >> "$MOCK_IMAGE_REVISIONS"
  cat > "$MOCK_MANIFEST_FILE" <<EOF
{
  "schemaVersion": 1,
  "environment": "Development",
  "source": {
    "repository": "Example/ELEVANT",
    "ref": "refs/heads/Development",
    "commit": "$commit",
    "runId": "$run_id",
    "runAttempt": 1,
    "workflowUrl": "https://github.com/Example/ELEVANT/actions/runs/$run_id"
  },
  "images": {
    "ops": "$MOCK_OPS_REPOSITORY@sha256:$ops_hex",
    "release": "$MOCK_RELEASE_REPOSITORY@sha256:$release_hex"
  },
  "compose": {
    "databaseSha256": "$database_hash",
    "releaseSha256": "$release_hash"
  },
  "database": {
    "migrationIds": ["20260817200402_V1_01_Platform"],
    "migrationFingerprint": "sha256:$(repeat_hex d)",
    "modelFingerprint": "sha256:$(repeat_hex e)",
    "seedFingerprint": "sha256:$(repeat_hex f)"
  },
  "publishedAt": "2026-08-23T00:00:00Z"
}
EOF
  chmod 0600 "$MOCK_MANIFEST_FILE"
}

cat > "$CONFIG_FILE" <<EOF
ELEVANT_CD_MANIFEST_REPOSITORY=$MOCK_MANIFEST_REPOSITORY
ELEVANT_CD_MANIFEST_ALIAS=development-certified
ELEVANT_CD_EXPECTED_REPOSITORY=Example/ELEVANT
ELEVANT_CD_EXPECTED_REF=refs/heads/Development
ELEVANT_CD_OPS_REPOSITORY=$MOCK_OPS_REPOSITORY
ELEVANT_CD_RELEASE_REPOSITORY=$MOCK_RELEASE_REPOSITORY
ELEVANT_CD_DOCKER_CONFIG=$DOCKER_CONFIG_DIR
ELEVANT_CD_DATABASE_PROJECT=elevant-dev-database-test
ELEVANT_CD_DATABASE_COMPOSE=$DATABASE_COMPOSE
ELEVANT_CD_DATABASE_ENV=$DATABASE_ENV
ELEVANT_CD_RELEASE_PROJECT=elevant-dev-database-release-test
ELEVANT_CD_RELEASE_COMPOSE=$RELEASE_COMPOSE
ELEVANT_CD_RELEASE_ENV=$RELEASE_ENV
ELEVANT_CD_STATE_DIR=$STATE_DIR
ELEVANT_CD_LOG_DIR=$LOG_DIR
ELEVANT_CD_LOCK_FILE=$STATE_DIR/controller.lock
ELEVANT_CD_GITHUB_TOKEN_FILE=
ELEVANT_CD_GITHUB_API_URL=https://api.github.com
EOF
chmod 0600 "$CONFIG_FILE"

controller() {
  PATH="$MOCK_BIN:$PATH" \
  ELEVANT_CD_TEST_MODE=1 \
  ELEVANT_CD_DOCKER_BIN="$MOCK_BIN/docker" \
  ELEVANT_CD_NODE_BIN="$NODE_BIN" \
    bash "$CONTROLLER" --config "$CONFIG_FILE" "$@"
}

controller_with_real_flock() {
  local flock_path real_flock_dir
  [[ -n "$REAL_FLOCK_BIN" ]] || fail "real flock is required"
  real_flock_dir="$(dirname -- "$REAL_FLOCK_BIN")"
  flock_path="$real_flock_dir"
  if [[ -n "${REAL_FLOCK_TEST_BIN_DIR:-}" ]]; then
    flock_path="$REAL_FLOCK_TEST_BIN_DIR:$flock_path"
  fi
  PATH="$flock_path:$MOCK_BIN:$PATH" \
  ELEVANT_CD_TEST_MODE=1 \
  ELEVANT_CD_DOCKER_BIN="$MOCK_BIN/docker" \
  ELEVANT_CD_NODE_BIN="$NODE_BIN" \
    bash "$CONTROLLER" --config "$CONFIG_FILE" "$@"
}

manifest_validate_fixture() {
  "$NODE_BIN" "$MANIFEST_TOOL" validate \
    --file "$MANIFEST_TEST_BUNDLE/manifest.json" \
    --bundle-root "$MANIFEST_TEST_BUNDLE" \
    --expected-repository Example/ELEVANT \
    --expected-ref refs/heads/Development \
    --ops-repository "$MOCK_OPS_REPOSITORY" \
    --release-repository "$MOCK_RELEASE_REPOSITORY" "$@"
}

commit_one="$(printf '1%.0s' {1..40})"
export MOCK_COMMIT="$commit_one"
MOCK_DIGEST="sha256:$(repeat_hex a)"
export MOCK_DIGEST
make_manifest "$commit_one" "$(repeat_hex 1)" "$(repeat_hex 2)" 1001

# The JSON model hash is stable across formatting and recursively reordered
# object keys. Array order remains semantically significant.
COMPOSE_MODEL_A="$TEST_TMP/compose-model-a.json"
COMPOSE_MODEL_B="$TEST_TMP/compose-model-b.json"
COMPOSE_MODEL_CHANGED="$TEST_TMP/compose-model-changed.json"
cat > "$COMPOSE_MODEL_A" <<'EOF'
{
  "services": {
    "migrator": {
      "replicas": 1,
      "profiles": ["operations", "maintenance"],
      "environment": {"B": "two", "A": "one"}
    }
  },
  "name": "elevant"
}
EOF
cat > "$COMPOSE_MODEL_B" <<'EOF'
{"name":"elevant","services":{"migrator":{"environment":{"A":"one","B":"two"},"profiles":["operations","maintenance"],"replicas":1.0}}}
EOF
cat > "$COMPOSE_MODEL_CHANGED" <<'EOF'
{"services":{"migrator":{"profiles":["maintenance","operations"],"replicas":1,"environment":{"B":"two","A":"one"}}},"name":"elevant"}
EOF
canonical_model='{"name":"elevant","services":{"migrator":{"environment":{"A":"one","B":"two"},"profiles":["operations","maintenance"],"replicas":1}}}'
expected_model_hash="$(printf '%s' "$canonical_model" | sha256sum | awk '{print $1}')"
model_hash_a="$("$NODE_BIN" "$COMPOSE_MODEL_TOOL" hash --file "$COMPOSE_MODEL_A")"
model_hash_b="$("$NODE_BIN" "$COMPOSE_MODEL_TOOL" hash --file "$COMPOSE_MODEL_B")"
model_hash_changed="$("$NODE_BIN" "$COMPOSE_MODEL_TOOL" hash \
  --file "$COMPOSE_MODEL_CHANGED")"
assert_equal "$expected_model_hash" "$model_hash_a" \
  "Compose model hash is not based on the canonical JSON representation"
assert_equal "$model_hash_a" "$model_hash_b" \
  "Compose model hash changed across equivalent JSON formatting or key order"
[[ "$model_hash_a" != "$model_hash_changed" ]] || \
  fail "Compose model hash ignored semantically significant array order"
EMPTY_COMPOSE_MODEL="$TEST_TMP/compose-model-empty.json"
: > "$EMPTY_COMPOSE_MODEL"
assert_failure "Compose model tool accepted an empty input" \
  "$NODE_BIN" "$COMPOSE_MODEL_TOOL" hash --file "$EMPTY_COMPOSE_MODEL"
assert_failure "Compose model tool accepted unsupported arguments" \
  "$NODE_BIN" "$COMPOSE_MODEL_TOOL" hash "$COMPOSE_MODEL_A"
case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *)
    ln -s -- "$COMPOSE_MODEL_A" "$TEST_TMP/compose-model-link.json"
    assert_failure "Compose model tool accepted a symlink" \
      "$NODE_BIN" "$COMPOSE_MODEL_TOOL" hash \
      --file "$TEST_TMP/compose-model-link.json"
    ;;
esac

# Exercise the manifest validator independently so malformed bundles cannot be
# hidden by controller, Docker, or label validation failures.
MANIFEST_TEST_BUNDLE="$TEST_TMP/manifest-tool-bundle"
mkdir -p "$MANIFEST_TEST_BUNDLE"
cp -- "$MOCK_MANIFEST_FILE" "$MANIFEST_TEST_BUNDLE/manifest.json"
cp -- "$MOCK_DATABASE_PAYLOAD" \
  "$MANIFEST_TEST_BUNDLE/compose.development.database.yml"
cp -- "$MOCK_RELEASE_PAYLOAD" \
  "$MANIFEST_TEST_BUNDLE/compose.development.release.yml"
assert_success "manifest tool rejected a valid immutable bundle" \
  manifest_validate_fixture
assert_equal "$commit_one" "$(manifest_validate_fixture --get source.commit)" \
  "manifest tool returned the wrong nested field"
printf '%s\n' unexpected > "$MANIFEST_TEST_BUNDLE/unexpected.txt"
assert_failure "manifest tool accepted an unexpected bundle payload" \
  manifest_validate_fixture
rm -f -- "$MANIFEST_TEST_BUNDLE/unexpected.txt"
mv -- "$MANIFEST_TEST_BUNDLE/compose.development.release.yml" \
  "$TEST_TMP/missing-release-payload"
assert_failure "manifest tool accepted a bundle with a missing payload" \
  manifest_validate_fixture
mv -- "$TEST_TMP/missing-release-payload" \
  "$MANIFEST_TEST_BUNDLE/compose.development.release.yml"
cp -- "$MANIFEST_TEST_BUNDLE/manifest.json" "$TEST_TMP/outside-manifest.json"
assert_failure "manifest tool accepted a manifest outside its bundle root" \
  "$NODE_BIN" "$MANIFEST_TOOL" validate \
  --file "$TEST_TMP/outside-manifest.json" \
  --bundle-root "$MANIFEST_TEST_BUNDLE" \
  --expected-repository Example/ELEVANT \
  --expected-ref refs/heads/Development \
  --ops-repository "$MOCK_OPS_REPOSITORY" \
  --release-repository "$MOCK_RELEASE_REPOSITORY"
cp -- "$MANIFEST_TEST_BUNDLE/compose.development.database.yml" \
  "$TEST_TMP/database-payload.backup"
printf '%s\n' '# tampered' >> \
  "$MANIFEST_TEST_BUNDLE/compose.development.database.yml"
assert_failure "manifest tool accepted a database Compose hash mismatch" \
  manifest_validate_fixture
mv -f -- "$TEST_TMP/database-payload.backup" \
  "$MANIFEST_TEST_BUNDLE/compose.development.database.yml"
cp -- "$MANIFEST_TEST_BUNDLE/manifest.json" "$TEST_TMP/manifest.backup"
sed -i 's/"schemaVersion": 1,/"schemaVersion": 1, "unexpected": true,/' \
  "$MANIFEST_TEST_BUNDLE/manifest.json"
assert_failure "manifest tool accepted an unexpected manifest field" \
  manifest_validate_fixture
mv -f -- "$TEST_TMP/manifest.backup" "$MANIFEST_TEST_BUNDLE/manifest.json"
assert_failure "manifest tool accepted a duplicate option" \
  manifest_validate_fixture --get source.commit --get source.ref
case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *)
    mv -- "$MANIFEST_TEST_BUNDLE/compose.development.release.yml" \
      "$TEST_TMP/release-payload.symlink-target"
    ln -s -- "$TEST_TMP/release-payload.symlink-target" \
      "$MANIFEST_TEST_BUNDLE/compose.development.release.yml"
    assert_failure "manifest tool accepted a symlinked bundle payload" \
      manifest_validate_fixture
    rm -f -- "$MANIFEST_TEST_BUNDLE/compose.development.release.yml"
    mv -- "$TEST_TMP/release-payload.symlink-target" \
      "$MANIFEST_TEST_BUNDLE/compose.development.release.yml"
    ;;
esac

baseline_commit="$(printf '0%.0s' {1..40})"
baseline_ops="$MOCK_OPS_REPOSITORY@sha256:$(repeat_hex 9)"
baseline_release="$MOCK_RELEASE_REPOSITORY@sha256:$(repeat_hex a)"
printf '%s|%s\n' "$baseline_ops" "$baseline_commit" >> "$MOCK_IMAGE_REVISIONS"
printf '%s|%s\n' "$baseline_release" "$baseline_commit" >> "$MOCK_IMAGE_REVISIONS"
printf '%s\n' "ELEVANT_DB_OPS_IMAGE=$baseline_ops" \
  'SECRET_VALUE=not-a-real-secret' > "$DATABASE_ENV"
printf '%s\n' "ELEVANT_DB_RELEASE_IMAGE=$baseline_release" \
  'OTHER_SECRET=not-a-real-secret' > "$RELEASE_ENV"
chmod 0600 "$DATABASE_ENV" "$RELEASE_ENV"

# An artifact carrying only earlier schema labels, omitting the bundle label,
# or advertising the legacy manifest media type must fail before any SQL.
export MOCK_MANIFEST_SCHEMA_LABEL=""
assert_failure_without_database_operation \
  "controller accepted legacy-only artifact schema labels" \
  controller --dry-run
export MOCK_MANIFEST_SCHEMA_LABEL=1
export MOCK_BUNDLE_VERSION_LABEL=""
assert_failure_without_database_operation \
  "controller accepted an artifact without the bundle-version label" \
  controller --dry-run
export MOCK_BUNDLE_VERSION_LABEL=1
export MOCK_MEDIA_TYPE_LABEL=application/vnd.elevant.database-release-manifest.v1+json
assert_failure_without_database_operation \
  "controller accepted the legacy manifest media type" \
  controller --dry-run
export MOCK_MEDIA_TYPE_LABEL=application/vnd.elevant.database-release-bundle.v1

cp -- "$MOCK_RELEASE_PAYLOAD" "$TEST_TMP/release-payload.backup"
printf '%s\n' '# tampered' >> "$MOCK_RELEASE_PAYLOAD"
assert_failure_without_database_operation \
  "controller accepted a tampered release Compose payload" \
  controller --dry-run
mv -f -- "$TEST_TMP/release-payload.backup" "$MOCK_RELEASE_PAYLOAD"

assert_success "valid dry-run failed" controller --dry-run
assert_equal 0 "$(grep -c ' run --rm --no-deps ' "$MOCK_LOG" || true)" \
  "dry-run executed a database operation"

case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *)
    chmod 0644 "$DATABASE_ENV"
    assert_failure "controller accepted a world-readable database environment" \
      controller --dry-run
    chmod 0600 "$DATABASE_ENV"
    ;;
esac

printf '%s\n' 'ELEVANT_DB_OPS_IMAGE=ghcr.io/example/elevant-db-ops:development' \
  'SECRET_VALUE=not-a-real-secret' > "$DATABASE_ENV"
assert_failure "baseline adoption accepted a mutable live image" \
  controller --adopt-current
assert_equal 0 "$(grep -c ' run --rm --no-deps ' "$MOCK_LOG" || true)" \
  "invalid baseline adoption executed a database operation"
printf '%s\n' "ELEVANT_DB_OPS_IMAGE=$baseline_ops" \
  'SECRET_VALUE=not-a-real-secret' > "$DATABASE_ENV"
chmod 0600 "$DATABASE_ENV"

printf '%s\n' 'ELEVANT_DB_OPS_IMAGE="unterminated' \
  'SECRET_VALUE=not-a-real-secret' > "$DATABASE_ENV"
assert_failure_without_database_operation \
  "baseline adoption accepted an unmatched opening quote" \
  controller --adopt-current
printf '%s\n' "ELEVANT_DB_OPS_IMAGE=$baseline_ops\"" \
  'SECRET_VALUE=not-a-real-secret' > "$DATABASE_ENV"
assert_failure_without_database_operation \
  "baseline adoption accepted an unmatched closing quote" \
  controller --adopt-current
printf '%s\n' "ELEVANT_DB_OPS_IMAGE=\"$baseline_ops\" suffix" \
  'SECRET_VALUE=not-a-real-secret' > "$DATABASE_ENV"
assert_failure_without_database_operation \
  "baseline adoption accepted content after a quoted value" \
  controller --adopt-current
printf '%s\n' "ELEVANT_DB_OPS_IMAGE=\"$baseline_ops\"" \
  "ELEVANT_DB_OPS_IMAGE=\"$baseline_ops\"" \
  'SECRET_VALUE=not-a-real-secret' > "$DATABASE_ENV"
assert_failure_without_database_operation \
  "baseline adoption accepted a duplicate image definition" \
  controller --adopt-current
printf '%s\n' "ELEVANT_DB_OPS_IMAGE=\"$baseline_ops\"" \
  'SECRET_VALUE=not-a-real-secret' > "$DATABASE_ENV"
printf '%s\n' "ELEVANT_DB_RELEASE_IMAGE=$baseline_release" \
  'OTHER_SECRET=not-a-real-secret' > "$RELEASE_ENV"
chmod 0600 "$DATABASE_ENV" "$RELEASE_ENV"

assert_success "live baseline adoption failed" controller --adopt-current
assert_equal adopted "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$STATE_DIR/last-success.json" --field status)" \
  "adoption did not persist last-success"
assert_equal "" "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$STATE_DIR/last-success.json" --field manifestDigest)" \
  "live baseline incorrectly consumed the candidate manifest"
assert_equal "$baseline_ops" "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$STATE_DIR/last-success.json" --field opsImage)" \
  "adoption did not normalize the live quoted immutable ops image"
assert_equal "$baseline_release" "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$STATE_DIR/last-success.json" --field releaseImage)" \
  "adoption did not preserve the live unquoted immutable release image"
assert_equal 3 "$(grep -c ' run --rm --no-deps ' "$MOCK_LOG")" \
  "adoption did not run verify, backup, and restore-check exactly once"
assert_failure "baseline adoption was not one-time" controller --adopt-current

# A database Compose render failure in the promotion preflight must propagate
# through run_stage and stop before backup, migration, or any other SQL action.
: > "$MOCK_LOG"
commit_two="$(printf '2%.0s' {1..40})"
export MOCK_COMMIT="$commit_two"
MOCK_DIGEST="sha256:$(repeat_hex b)"
export MOCK_DIGEST
make_manifest "$commit_two" "$(repeat_hex 3)" "$(repeat_hex 4)" 1002
export MOCK_FAIL_MATCH="--profile operations config --quiet"
assert_failure "database Compose preflight failure was masked" controller --poll
preflight_attempt="$STATE_DIR/attempts/${MOCK_DIGEST#sha256:}.json"
assert_equal failed "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$preflight_attempt" --field status)" \
  "preflight failure did not persist a failed attempt"
assert_equal preflight "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$preflight_attempt" --field stage)" \
  "database Compose render failure escaped the preflight stage"
assert_equal 0 "$(grep -c ' run --rm --no-deps ' "$MOCK_LOG" || true)" \
  "database Compose preflight failure executed a database operation"
export MOCK_FAIL_MATCH=""

# Restore the first valid candidate; adopting the live baseline must not have
# consumed it, and the failed superseded candidate must not block promotion.
export MOCK_COMMIT="$commit_one"
MOCK_DIGEST="sha256:$(repeat_hex a)"
export MOCK_DIGEST
make_manifest "$commit_one" "$(repeat_hex 1)" "$(repeat_hex 2)" 1001
: > "$MOCK_LOG"
: > "$MOCK_OPS_LOG"
assert_success "certified promotion failed" controller --poll
assert_equal 6 "$(grep -c ' run --rm --no-deps ' "$MOCK_LOG")" \
  "promotion did not execute exactly six database operations"
expected_order=$'backup\nmigrator\nseeder-development\nverify-development\nbackup\nrestore-check'
actual_order="$(grep ' run --rm --no-deps ' "$MOCK_LOG" | \
  sed -E 's/.* run --rm --no-deps ([^ ]+)$/\1/')"
assert_equal "$expected_order" "$actual_order" "promotion stage order changed"
expected_backup_ops=$'ghcr.io/example/elevant-db-ops@sha256:'"$(repeat_hex 9)"$'\n'$'ghcr.io/example/elevant-db-ops@sha256:'"$(repeat_hex 1)"
assert_equal "$expected_backup_ops" "$(cat "$MOCK_OPS_LOG")" \
  "pre-backup did not use the adopted ops digest before the candidate digest"
accepted_attempt="$STATE_DIR/attempts/${MOCK_DIGEST#sha256:}.json"
rm -f -- "$accepted_attempt"
assert_success "idempotent poll failed to reconcile accepted state" controller --poll
assert_equal succeeded "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$accepted_attempt" --field status)" \
  "accepted state was not reconciled without database operations"
assert_equal 6 "$(grep -c ' run --rm --no-deps ' "$MOCK_LOG")" \
  "second poll repeated an accepted manifest"

for cached_compose in "$CACHED_DATABASE_COMPOSE" "$CACHED_RELEASE_COMPOSE"; do
  [[ -f "$cached_compose" && ! -L "$cached_compose" ]] || \
    fail "promotion did not retain a regular immutable Compose cache entry"
done
case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *)
    for cached_compose in "$CACHED_DATABASE_COMPOSE" "$CACHED_RELEASE_COMPOSE"; do
      assert_equal "$(id -u):600" "$(stat -c '%u:%a' -- "$cached_compose")" \
        "cached Compose payload ownership or mode is incorrect"
    done
    ;;
esac

# Scheduled operations depend only on the accepted, content-addressed database
# Compose. Invalid database entries fail closed; release cache state is ignored.
mv -- "$CACHED_DATABASE_COMPOSE" "$TEST_TMP/cached-database.backup"
assert_failure_without_database_operation \
  "scheduled backup accepted a missing database Compose cache entry" \
  controller --backup
assert_failure_without_database_operation \
  "scheduled restore-check accepted a missing database Compose cache entry" \
  controller --restore-check
mv -- "$TEST_TMP/cached-database.backup" "$CACHED_DATABASE_COMPOSE"

cp -- "$CACHED_DATABASE_COMPOSE" "$TEST_TMP/cached-database.backup"
printf '%s\n' '# tampered' >> "$CACHED_DATABASE_COMPOSE"
assert_failure_without_database_operation \
  "scheduled backup accepted a tampered database Compose cache entry" \
  controller --backup
assert_failure_without_database_operation \
  "scheduled restore-check accepted a tampered database Compose cache entry" \
  controller --restore-check
mv -f -- "$TEST_TMP/cached-database.backup" "$CACHED_DATABASE_COMPOSE"

case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *)
    chmod 0644 "$CACHED_DATABASE_COMPOSE"
    assert_failure_without_database_operation \
      "scheduled backup accepted an over-permissive Compose cache entry" \
      controller --backup
    assert_failure_without_database_operation \
      "scheduled restore-check accepted an over-permissive Compose cache entry" \
      controller --restore-check
    chmod 0600 "$CACHED_DATABASE_COMPOSE"
    ;;
esac

mv -- "$CACHED_RELEASE_COMPOSE" "$TEST_TMP/cached-release.backup"
assert_success_with_one_database_operation \
  "scheduled backup depended on a missing release Compose cache entry" \
  controller --backup
assert_success_with_one_database_operation \
  "scheduled restore-check depended on a missing release Compose cache entry" \
  controller --restore-check
mv -- "$TEST_TMP/cached-release.backup" "$CACHED_RELEASE_COMPOSE"

cp -- "$CACHED_RELEASE_COMPOSE" "$TEST_TMP/cached-release.backup"
printf '%s\n' '# tampered' >> "$CACHED_RELEASE_COMPOSE"
assert_success_with_one_database_operation \
  "scheduled backup depended on release Compose cache integrity" \
  controller --backup
assert_success_with_one_database_operation \
  "scheduled restore-check depended on release Compose cache integrity" \
  controller --restore-check
mv -f -- "$TEST_TMP/cached-release.backup" "$CACHED_RELEASE_COMPOSE"

case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *)
    chmod 0644 "$CACHED_RELEASE_COMPOSE"
    assert_success_with_one_database_operation \
      "scheduled backup depended on release Compose cache permissions" \
      controller --backup
    assert_success_with_one_database_operation \
      "scheduled restore-check depended on release Compose cache permissions" \
      controller --restore-check
    chmod 0600 "$CACHED_RELEASE_COMPOSE"
    ;;
esac

assert_success_with_one_database_operation \
  "scheduled backup wrapper failed" controller --backup
assert_success_with_one_database_operation \
  "scheduled restore wrapper failed" controller --restore-check
after_scheduled_operations="$(database_operation_count)"

assert_success "pause failed" controller --pause
: > "$MOCK_FLOCK_LOG"
before_paused_docker_commands="$(wc -l < "$MOCK_LOG")"
mv -- "$DATABASE_COMPOSE" "$TEST_TMP/paused-database-compose.backup"
mv -- "$DATABASE_ENV" "$TEST_TMP/paused-database-env.backup"
mv -- "$RELEASE_COMPOSE" "$TEST_TMP/paused-release-compose.backup"
mv -- "$RELEASE_ENV" "$TEST_TMP/paused-release-env.backup"
export MOCK_FAIL_ALL=1
assert_success "paused poll failed" controller --poll
assert_success "paused backup failed" controller --backup
assert_success "paused restore-check failed" controller --restore-check
assert_equal '-E 75 -n 9' "$(sed -n '1p' "$MOCK_FLOCK_LOG")" \
  "poll did not retain a non-blocking lock"
assert_equal '-E 75 -w 900 9' "$(sed -n '2p' "$MOCK_FLOCK_LOG")" \
  "scheduled backup did not use the bounded maintenance wait"
assert_equal '-E 75 -w 900 9' "$(sed -n '3p' "$MOCK_FLOCK_LOG")" \
  "scheduled restore-check did not use the bounded maintenance wait"
assert_equal "$after_scheduled_operations" "$(database_operation_count)" \
  "paused command executed SQL"
assert_equal "$before_paused_docker_commands" "$(wc -l < "$MOCK_LOG")" \
  "paused command contacted Docker"
export MOCK_FAIL_ALL=0
mv -- "$TEST_TMP/paused-database-compose.backup" "$DATABASE_COMPOSE"
mv -- "$TEST_TMP/paused-database-env.backup" "$DATABASE_ENV"
mv -- "$TEST_TMP/paused-release-compose.backup" "$RELEASE_COMPOSE"
mv -- "$TEST_TMP/paused-release-env.backup" "$RELEASE_ENV"
assert_success "resume failed" controller --resume

commit_three="$(printf '3%.0s' {1..40})"
export MOCK_COMMIT="$commit_three"
MOCK_DIGEST="sha256:$(repeat_hex c)"
export MOCK_DIGEST
make_manifest "$commit_three" "$(repeat_hex 5)" "$(repeat_hex 6)" 1003
export MOCK_FAIL_MATCH="run --rm --no-deps migrator"
assert_failure "migration failure was not propagated" controller --poll
failed_attempt="$STATE_DIR/attempts/${MOCK_DIGEST#sha256:}.json"
assert_equal failed "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$failed_attempt" --field status)" \
  "failed promotion was not persisted"
failed_run_count="$(grep -c ' run --rm --no-deps ' "$MOCK_LOG")"
assert_success "poll of failed manifest should stop without retry" controller --poll
assert_equal "$failed_run_count" "$(grep -c ' run --rm --no-deps ' "$MOCK_LOG")" \
  "failed manifest was retried automatically"
export MOCK_FAIL_MATCH=""
assert_failure "retry accepted a non-advertised digest" \
  controller --retry "sha256:$(repeat_hex 9)"
assert_success "explicit retry of failed manifest failed" \
  controller --retry "$MOCK_DIGEST"
assert_equal succeeded "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$failed_attempt" --field status)" \
  "explicit retry did not reach success"

# A manually rerun older workflow may repoint a mutable discovery alias. It
# must never move the accepted database state backwards or execute SQL.
before_stale="$(grep -c ' run --rm --no-deps ' "$MOCK_LOG")"
stale_commit="$(printf '5%.0s' {1..40})"
export MOCK_COMMIT="$stale_commit"
MOCK_DIGEST="sha256:$(repeat_hex e)"
export MOCK_DIGEST
make_manifest "$stale_commit" "$(repeat_hex a)" "$(repeat_hex b)" 1002
assert_success "stale workflow run did not stop as a safe no-op" controller --poll
assert_equal "$before_stale" "$(grep -c ' run --rm --no-deps ' "$MOCK_LOG")" \
  "stale workflow run executed a database operation"
[[ ! -e "$STATE_DIR/attempts/${MOCK_DIGEST#sha256:}.json" ]] || \
  fail "stale workflow run created an attempt record"

commit_four="$(printf '4%.0s' {1..40})"
export MOCK_COMMIT="$commit_four"
MOCK_DIGEST="sha256:$(repeat_hex d)"
export MOCK_DIGEST
make_manifest "$commit_four" "$(repeat_hex 7)" "$(repeat_hex 8)" 1004
interrupted_attempt="$STATE_DIR/attempts/${MOCK_DIGEST#sha256:}.json"
"$NODE_BIN" "$STATE_TOOL" write --file "$interrupted_attempt" \
  --set status=running --set stage=migrate \
  --set "manifestDigest=$MOCK_DIGEST" --set "sourceCommit=$MOCK_COMMIT" \
  --set "opsImage=$MOCK_OPS_REPOSITORY@sha256:$(repeat_hex 7)" \
  --set "releaseImage=$MOCK_RELEASE_REPOSITORY@sha256:$(repeat_hex 8)" \
  --set messageCode=stage_running --set updatedAt=2026-08-23T00:00:00Z \
  --set workflowUrl=https://github.com/Example/ELEVANT/actions/runs/1004
before_interrupted="$(grep -c ' run --rm --no-deps ' "$MOCK_LOG")"
assert_success "interrupted manifest poll did not stop safely" controller --poll
assert_equal failed "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$interrupted_attempt" --field status)" \
  "interrupted attempt was not made explicitly failed"
assert_equal "$before_interrupted" "$(grep -c ' run --rm --no-deps ' "$MOCK_LOG")" \
  "interrupted attempt was automatically resumed"

# A mutable image reference is rejected by the JSON validator before any SQL.
sed -i 's#elevant-db-ops@sha256:[0-9a-f]*#elevant-db-ops:development#' \
  "$MOCK_MANIFEST_FILE"
assert_failure "manifest validator accepted a mutable database image" \
  controller --dry-run
make_manifest "$commit_four" "$(repeat_hex 7)" "$(repeat_hex 8)" 1004

# Dokploy-only formatting changes are tolerated, but semantic drift is fail-closed.
printf '%s\n' '# drift' >> "$DATABASE_COMPOSE"
assert_success "dry-run rejected formatting-only Compose drift" controller --dry-run
assert_success_with_one_database_operation \
  "scheduled backup rejected formatting-only database Compose drift" \
  controller --backup
sed -i 's/x-elevant-test-semantic: stable/x-elevant-test-semantic: changed/' \
  "$DATABASE_COMPOSE"
assert_failure_without_database_operation \
  "dry-run accepted semantic live database Compose drift" \
  controller --dry-run
assert_failure_without_database_operation \
  "scheduled backup accepted semantic live database Compose drift" \
  controller --backup
assert_failure_without_database_operation \
  "scheduled restore-check accepted semantic live database Compose drift" \
  controller --restore-check
sed -i 's/x-elevant-test-semantic: changed/x-elevant-test-semantic: stable/' \
  "$DATABASE_COMPOSE"

printf '%s\n' '# drift' >> "$RELEASE_COMPOSE"
assert_success "dry-run rejected formatting-only release Compose drift" \
  controller --dry-run
sed -i 's/x-elevant-test-semantic: stable/x-elevant-test-semantic: changed/' \
  "$RELEASE_COMPOSE"
assert_failure_without_database_operation \
  "dry-run accepted semantic live release Compose drift" \
  controller --dry-run
assert_success_with_one_database_operation \
  "scheduled backup depended on live release Compose semantics" \
  controller --backup
assert_success_with_one_database_operation \
  "scheduled restore-check depended on live release Compose semantics" \
  controller --restore-check
sed -i 's/x-elevant-test-semantic: changed/x-elevant-test-semantic: stable/' \
  "$RELEASE_COMPOSE"

# Database-only scheduled commands do not require a live release deployment.
mv -- "$RELEASE_COMPOSE" "$TEST_TMP/live-release-compose.backup"
mv -- "$RELEASE_ENV" "$TEST_TMP/live-release-env.backup"
assert_failure_without_database_operation \
  "dry-run accepted missing live release Compose and environment files" \
  controller --dry-run
assert_success_with_one_database_operation \
  "scheduled backup required live release Compose or environment files" \
  controller --backup
assert_success_with_one_database_operation \
  "scheduled restore-check required live release Compose or environment files" \
  controller --restore-check
mv -- "$TEST_TMP/live-release-compose.backup" "$RELEASE_COMPOSE"
mv -- "$TEST_TMP/live-release-env.backup" "$RELEASE_ENV"

export MOCK_FLOCK_FAIL=75
lock_failure_operations="$(database_operation_count)"
if controller --backup > /dev/null 2> "$TEST_TMP/maintenance-lock.err"; then
  fail "scheduled backup ignored a maintenance lock timeout"
fi
grep -Fq 'timed out waiting for another ELEVANT database operation' \
  "$TEST_TMP/maintenance-lock.err" || \
  fail "scheduled backup lock timeout was not explained"
assert_equal "$lock_failure_operations" "$(database_operation_count)" \
  "maintenance lock timeout executed a database operation"

if controller --poll > /dev/null 2> "$TEST_TMP/poll-lock.err"; then
  fail "poll ignored lock contention"
fi
grep -Fq 'another ELEVANT database operation is running' \
  "$TEST_TMP/poll-lock.err" || \
  fail "poll lock contention was not explained"
assert_equal "$lock_failure_operations" "$(database_operation_count)" \
  "poll lock contention executed a database operation"
export MOCK_FLOCK_FAIL=0

export MOCK_FLOCK_FAIL=64
lock_failure_operations="$(database_operation_count)"
if controller --backup > /dev/null 2> "$TEST_TMP/flock-error.err"; then
  fail "scheduled backup ignored an internal flock error"
fi
grep -Fq 'could not acquire the ELEVANT database lock (flock exit=64)' \
  "$TEST_TMP/flock-error.err" || \
  fail "internal flock error was misreported as lock contention"
assert_equal "$lock_failure_operations" "$(database_operation_count)" \
  "internal flock error executed a database operation"
export MOCK_FLOCK_FAIL=0

case "$(uname -s)" in
  Linux)
    wait_for_marker() {
      local marker="$1"
      local attempt
      for attempt in {1..500}; do
        [[ -e "$marker" ]] && return 0
        sleep 0.01
      done
      return 1
    }

    wait_for_child_bounded() {
      local child_pid="$1"
      local max_attempts="$2"
      local attempt
      for ((attempt = 0; attempt < max_attempts; attempt += 1)); do
        if ! kill -0 "$child_pid" 2>/dev/null; then
          wait "$child_pid" || return $?
          return 0
        fi
        sleep 0.01
      done
      return 124
    }

    wait_for_flock_waiter() {
      local waiter_pid="$1"
      local attempt
      for attempt in {1..500}; do
        if awk -v expected_pid="$waiter_pid" '
          $2 == "->" &&
          $3 == "FLOCK" &&
          $6 == expected_pid { found = 1 }
          END { exit !found }
        ' /proc/locks; then
          return 0
        fi
        if [[ -r "/proc/$waiter_pid/wchan" ]] &&
          grep -Fq 'locks_lock_inode_wait' "/proc/$waiter_pid/wchan"; then
          return 0
        fi
        sleep 0.01
      done
      return 1
    }

    hold_real_lock_until_released() {
      local ready_marker="$1"
      local release_marker="$2"
      local attempt
      exec 8<>"$STATE_DIR/controller.lock"
      "$REAL_FLOCK_BIN" -x 8
      : > "$ready_marker"
      for attempt in {1..1000}; do
        [[ -e "$release_marker" ]] && return 0
        sleep 0.01
      done
      return 70
    }

    real_flock_test_bin="$TEST_TMP/real-flock-bin"
    mkdir -p -- "$real_flock_test_bin"
    cat > "$real_flock_test_bin/flock" <<'REAL_FLOCK_WRAPPER'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$$" > "${REAL_FLOCK_CALL_MARKER:?}"
exec "${ELEVANT_TEST_REAL_FLOCK:?}" "$@"
REAL_FLOCK_WRAPPER
    chmod 0755 "$real_flock_test_bin/flock"
    export REAL_FLOCK_TEST_BIN_DIR="$real_flock_test_bin"
    export ELEVANT_TEST_REAL_FLOCK="$REAL_FLOCK_BIN"

    lock_ready="$TEST_TMP/poll-lock-ready"
    lock_release="$TEST_TMP/poll-lock-release"
    poll_flock_called="$TEST_TMP/poll-flock-called"
    hold_real_lock_until_released "$lock_ready" "$lock_release" &
    lock_holder=$!
    wait_for_marker "$lock_ready" || \
      fail "poll lock holder did not become ready"

    lock_failure_operations="$(database_operation_count)"
    export REAL_FLOCK_CALL_MARKER="$poll_flock_called"
    controller_with_real_flock --poll \
      > /dev/null 2> "$TEST_TMP/real-poll-lock.err" &
    poll_pid=$!
    if ! wait_for_marker "$poll_flock_called"; then
      : > "$lock_release"
      wait "$lock_holder" || true
      kill "$poll_pid" 2>/dev/null || true
      wait "$poll_pid" 2>/dev/null || true
      fail "poll did not invoke real flock"
    fi

    if wait_for_child_bounded "$poll_pid" 200; then
      poll_status=0
    else
      poll_status=$?
    fi
    if (( poll_status == 124 )); then
      : > "$lock_release"
      wait "$lock_holder" || true
      kill "$poll_pid" 2>/dev/null || true
      wait "$poll_pid" 2>/dev/null || true
      fail "poll waited for a real busy lock"
    fi
    if kill -0 "$lock_holder" 2>/dev/null; then
      poll_holder_was_locked=1
    else
      poll_holder_was_locked=0
    fi
    : > "$lock_release"
    wait "$lock_holder" || fail "poll lock holder failed awaiting release"
    (( poll_holder_was_locked == 1 )) || \
      fail "poll did not fail before the real lock was released"
    (( poll_status != 0 )) || fail "poll ignored real lock contention"
    assert_equal "$lock_failure_operations" "$(database_operation_count)" \
      "real poll lock contention executed a database operation"

    lock_ready="$TEST_TMP/maintenance-lock-ready"
    lock_release="$TEST_TMP/maintenance-lock-release"
    maintenance_flock_called="$TEST_TMP/maintenance-flock-called"
    hold_real_lock_until_released "$lock_ready" "$lock_release" &
    lock_holder=$!
    wait_for_marker "$lock_ready" || \
      fail "maintenance lock holder did not become ready"

    maintenance_operations="$(database_operation_count)"
    export REAL_FLOCK_CALL_MARKER="$maintenance_flock_called"
    controller_with_real_flock --backup \
      > "$TEST_TMP/real-maintenance-lock.out" \
      2> "$TEST_TMP/real-maintenance-lock.err" &
    maintenance_pid=$!
    if ! wait_for_marker "$maintenance_flock_called"; then
      : > "$lock_release"
      wait "$lock_holder" || true
      kill "$maintenance_pid" 2>/dev/null || true
      wait "$maintenance_pid" 2>/dev/null || true
      fail "scheduled backup did not invoke real flock"
    fi

    maintenance_flock_pid="$(< "$maintenance_flock_called")"
    [[ "$maintenance_flock_pid" =~ ^[0-9]+$ ]] || \
      fail "real flock wrapper did not record a valid PID"
    if ! wait_for_flock_waiter "$maintenance_flock_pid"; then
      : > "$lock_release"
      wait "$lock_holder" || true
      kill "$maintenance_pid" 2>/dev/null || true
      wait "$maintenance_pid" 2>/dev/null || true
      fail "scheduled backup never became a real flock waiter"
    fi
    kill -0 "$maintenance_pid" 2>/dev/null || \
      fail "scheduled backup exited while registered as a flock waiter"
    assert_equal "$maintenance_operations" "$(database_operation_count)" \
      "scheduled backup executed before the real lock was released"

    : > "$lock_release"
    wait "$lock_holder" || \
      fail "maintenance lock holder failed before explicit release"
    if wait_for_child_bounded "$maintenance_pid" 500; then
      maintenance_status=0
    else
      maintenance_status=$?
    fi
    if (( maintenance_status == 124 )); then
      kill "$maintenance_pid" 2>/dev/null || true
      wait "$maintenance_pid" 2>/dev/null || true
      fail "scheduled backup did not finish after the real lock was released"
    fi
    (( maintenance_status == 0 )) || \
      fail "scheduled backup failed after the real lock was released"
    assert_equal "$((maintenance_operations + 1))" \
      "$(database_operation_count)" \
      "scheduled backup did not execute exactly once after lock release"

    unset REAL_FLOCK_CALL_MARKER REAL_FLOCK_TEST_BIN_DIR \
      ELEVANT_TEST_REAL_FLOCK
    ;;
  *) ;;
esac

assert_success "status failed on valid atomic state" controller --status
grep -Fq 'SECRET_VALUE' "$LOG_DIR/controller.log" && \
  fail "controller log leaked an environment secret name"

printf '%s: PASS\n' "$PROGRAM_NAME"
