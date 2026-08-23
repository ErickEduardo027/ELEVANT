#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly ROOT_DIR
readonly CONTROLLER="$ROOT_DIR/elevant-database-cd"
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

NODE_BIN="$(command -v node 2>/dev/null || true)"
[[ -n "$NODE_BIN" ]] || fail "node is required"

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
for installed_file in elevant-database-cd manifest-tool.mjs state-tool.mjs \
  verify-runtime jobs/poll.job.sh jobs/backup.job.sh jobs/restore-check.job.sh \
  config.env.example README.md config.env; do
  [[ -f "$INSTALL_DESTINATION/$installed_file" && \
     ! -L "$INSTALL_DESTINATION/$installed_file" ]] || \
    fail "installer inventory is incomplete or contains a symlink"
done
case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *)
    for installed_file in elevant-database-cd manifest-tool.mjs state-tool.mjs \
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
MOCK_MANIFEST_FILE="$TEST_TMP/manifest.json"
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
  "$STATE_DIR/tmp" "$LOG_DIR"
chmod 0700 "$DOCKER_CONFIG_DIR" "$STATE_DIR" "$STATE_DIR/attempts" \
  "$STATE_DIR/tmp" "$LOG_DIR"
printf '%s\n' 'services: {sqlserver: {image: example.invalid/sql:immutable}}' \
  > "$DATABASE_COMPOSE"
printf '%s\n' 'services: {migrator: {image: example.invalid/release:immutable}}' \
  > "$RELEASE_COMPOSE"
printf '%s\n' 'SECRET_VALUE=not-a-real-secret' > "$DATABASE_ENV"
printf '%s\n' 'OTHER_SECRET=not-a-real-secret' > "$RELEASE_ENV"
chmod 0600 "$DATABASE_ENV" "$RELEASE_ENV"

export MOCK_LOG MOCK_OPS_LOG MOCK_MANIFEST_FILE MOCK_IMAGE_REVISIONS
export MOCK_MANIFEST_REPOSITORY="ghcr.io/example/elevant-db-release-manifest"
export MOCK_OPS_REPOSITORY="ghcr.io/example/elevant-db-ops"
export MOCK_RELEASE_REPOSITORY="ghcr.io/example/elevant-db-release"
export MOCK_SOURCE="https://github.com/Example/ELEVANT"
export MOCK_FAIL_MATCH=""
export MOCK_FLOCK_FAIL=0

cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$MOCK_LOG"
joined="$*"
if [[ "$joined" == *"run --rm --no-deps backup"* ]]; then
  printf '%s\n' "${ELEVANT_DB_OPS_IMAGE:-missing}" >> "$MOCK_OPS_LOG"
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
      printf '%s\n' 1
    elif [[ "$format" == *io.elevant.database-release.schema-version* ]]; then
      printf '%s\n' 1
    elif [[ "$format" == *io.elevant.database-release.media-type* ]]; then
      printf '%s\n' application/vnd.elevant.database-release-manifest.v1+json
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
    command cp -- "$MOCK_MANIFEST_FILE" "${3:?destination required}"
    ;;
  rm)
    exit 0
    ;;
  compose)
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
[[ "${MOCK_FLOCK_FAIL:-0}" != "1" ]]
MOCK
chmod 0755 "$MOCK_BIN/flock"

database_hash="$(sha256sum -- "$DATABASE_COMPOSE" | awk '{print $1}')"
release_hash="$(sha256sum -- "$RELEASE_COMPOSE" | awk '{print $1}')"

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

commit_one="$(printf '1%.0s' {1..40})"
export MOCK_COMMIT="$commit_one"
MOCK_DIGEST="sha256:$(repeat_hex a)"
export MOCK_DIGEST
make_manifest "$commit_one" "$(repeat_hex 1)" "$(repeat_hex 2)" 1001
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

assert_success "live baseline adoption failed" controller --adopt-current
assert_equal adopted "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$STATE_DIR/last-success.json" --field status)" \
  "adoption did not persist last-success"
assert_equal "" "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$STATE_DIR/last-success.json" --field manifestDigest)" \
  "live baseline incorrectly consumed the candidate manifest"
assert_equal "$baseline_ops" "$("$NODE_BIN" "$STATE_TOOL" get \
  --file "$STATE_DIR/last-success.json" --field opsImage)" \
  "adoption did not capture the live immutable ops image"
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
export MOCK_FAIL_MATCH="-p elevant-dev-database-test -f $DATABASE_COMPOSE --profile operations config --quiet"
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

assert_success "scheduled backup wrapper failed" controller --backup
assert_success "scheduled restore wrapper failed" controller --restore-check
assert_equal 8 "$(grep -c ' run --rm --no-deps ' "$MOCK_LOG")" \
  "scheduled operations did not use controller wrappers"

assert_success "pause failed" controller --pause
assert_success "paused poll failed" controller --poll
assert_equal 8 "$(grep -c ' run --rm --no-deps ' "$MOCK_LOG")" \
  "paused poll executed SQL"
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

# Live Compose drift is fail-closed.
printf '%s\n' '# drift' >> "$DATABASE_COMPOSE"
assert_failure "dry-run accepted live Compose drift" controller --dry-run
assert_failure "scheduled backup accepted live Compose drift" controller --backup
printf '%s\n' 'services: {sqlserver: {image: example.invalid/sql:immutable}}' \
  > "$DATABASE_COMPOSE"

export MOCK_FLOCK_FAIL=1
assert_failure "controller ignored lock contention" controller --backup
export MOCK_FLOCK_FAIL=0

assert_success "status failed on valid atomic state" controller --status
grep -Fq 'SECRET_VALUE' "$LOG_DIR/controller.log" && \
  fail "controller log leaked an environment secret name"

printf '%s: PASS\n' "$PROGRAM_NAME"
