#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly ROOT_DIR
readonly VERIFIER="$ROOT_DIR/verify-runtime"

fail() {
  printf '%s: FAIL: %s\n' "$PROGRAM_NAME" "$*" >&2
  exit 1
}

assert_success() {
  local message="$1"
  shift
  "$@" || fail "$message"
}

assert_failure() {
  local message="$1"
  shift
  if "$@"; then
    fail "$message"
  fi
}

assert_status() {
  local expected="$1" message="$2" actual
  shift 2
  if "$@"; then
    actual=0
  else
    actual=$?
  fi
  [[ "$actual" == "$expected" ]] || \
    fail "$message (expected=$expected actual=$actual)"
}

assert_log_line() {
  local expected="$1" message="$2"
  grep -Fxq -- "$expected" "$MOCK_LOG_PATH" || fail "$message"
}

assert_no_log_line() {
  local unexpected="$1" message="$2"
  if grep -Fxq -- "$unexpected" "$MOCK_LOG_PATH"; then
    fail "$message"
  fi
}

assert_no_exec() {
  local message="$1"
  if grep -Eq '^exec\|' "$MOCK_LOG_PATH"; then
    fail "$message"
  fi
}

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/elevant-verify-runtime-test.XXXXXX")"
[[ "$TEST_TMP" == *elevant-verify-runtime-test.* ]] || \
  fail "unsafe test temp path"
cleanup() {
  rm -rf -- "$TEST_TMP"
}
trap cleanup EXIT

readonly MOCK_BIN="$TEST_TMP/bin"
readonly MOCK_LOG_PATH="$TEST_TMP/docker.log"
mkdir -p -- "$MOCK_BIN"

cat > "$MOCK_BIN/docker" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${1:-}" == "container" ]] || {
  printf 'unexpected mocked docker command: %s\n' "$*" >&2
  exit 64
}
shift

case "${1:-}" in
  inspect)
    printf 'argv' >> "$MOCK_DOCKER_LOG"
    printf '|%s' "$@" >> "$MOCK_DOCKER_LOG"
    printf '\n' >> "$MOCK_DOCKER_LOG"
    printf 'inspect|%s\n' "${*: -1}" >> "$MOCK_DOCKER_LOG"
    case "$MOCK_DOCKER_SCENARIO" in
      exact-running|exec-failure)
        printf '%s %s\n' \
          eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
          true
        ;;
      exact-stopped)
        printf '%s %s\n' \
          eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
          false
        ;;
      service-one|service-zero|service-two|ls-failure|invalid-id)
        exit 1
        ;;
      *)
        printf 'unknown mock scenario: %s\n' "$MOCK_DOCKER_SCENARIO" >&2
        exit 64
        ;;
    esac
    ;;
  ls)
    printf 'argv' >> "$MOCK_DOCKER_LOG"
    printf '|%s' "$@" >> "$MOCK_DOCKER_LOG"
    printf '\n' >> "$MOCK_DOCKER_LOG"
    printf '%s\n' ls >> "$MOCK_DOCKER_LOG"
    case "$MOCK_DOCKER_SCENARIO" in
      # If the implementation incorrectly falls back from a stopped exact
      # container, this plausible task makes the test expose that ambiguity.
      exact-stopped|service-one)
        printf '%s\n' \
          8641bc8715518641bc8715518641bc8715518641bc8715518641bc8715518641
        ;;
      service-zero)
        ;;
      service-two)
        printf '%s\n' \
          8641bc8715518641bc8715518641bc8715518641bc8715518641bc8715518641 \
          aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        ;;
      ls-failure)
        exit 41
        ;;
      invalid-id)
        printf '%s\n' not-a-container-id
        ;;
      *)
        printf 'unexpected mocked docker container ls for scenario: %s\n' \
          "$MOCK_DOCKER_SCENARIO" >&2
        exit 64
        ;;
    esac
    ;;
  exec)
    printf 'exec|%s\n' "${2:-}" >> "$MOCK_DOCKER_LOG"
    printf 'exec-shape|%s|%s\n' "${3:-}" "${4:-}" >> "$MOCK_DOCKER_LOG"
    [[ "$#" == 5 && "${3:-}" == /bin/sh && "${4:-}" == -c && \
       "${5:-}" == *'RUNTIME_OK'* ]] || exit 65
    if [[ "$MOCK_DOCKER_SCENARIO" == "exec-failure" ]]; then
      exit 42
    fi
    printf '%s\n' RUNTIME_OK
    ;;
  *)
    printf 'unexpected mocked docker command: %s\n' "$*" >&2
    exit 64
    ;;
esac
MOCK
chmod 0755 "$MOCK_BIN/docker"

verify() {
  local scenario="$1" target="$2"
  : > "$MOCK_LOG_PATH"
  PATH="$MOCK_BIN:$PATH" \
  MOCK_DOCKER_LOG="$MOCK_LOG_PATH" \
  MOCK_DOCKER_SCENARIO="$scenario" \
    bash "$VERIFIER" --host-container "$target"
}

assert_failure "invalid container/service name reached Docker" \
  verify exact-running -dokploy
[[ ! -s "$MOCK_LOG_PATH" ]] || \
  fail "invalid container/service name invoked Docker"

assert_success "running exact container was rejected" \
  verify exact-running dokploy-exact
assert_log_line 'inspect|dokploy-exact' \
  "running exact container was not inspected"
assert_log_line \
  'argv|inspect|--format|{{.Id}} {{.State.Running}}|dokploy-exact' \
  "running exact container inspect arguments changed"
assert_no_log_line ls \
  "running exact container unexpectedly triggered Swarm discovery"
assert_log_line \
  'exec|eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' \
  "running exact container was not selected for docker exec"
assert_log_line 'exec-shape|/bin/sh|-c' \
  "runtime check was not passed through /bin/sh -c"

assert_failure "stopped exact container fell back to a Swarm service" \
  verify exact-stopped dokploy-stopped
assert_log_line 'inspect|dokploy-stopped' \
  "stopped exact container was not inspected"
assert_no_log_line ls \
  "stopped exact container triggered ambiguous Swarm discovery"
assert_no_exec \
  "stopped exact container executed a same-named Swarm task"

assert_success "single running Swarm task was rejected" \
  verify service-one dokploy
assert_log_line 'inspect|dokploy' \
  "Swarm service resolution did not check for an exact container first"
assert_log_line ls "Swarm service tasks were not enumerated"
assert_log_line \
  'argv|ls|--quiet|--no-trunc|--filter|label=com.docker.swarm.service.name=dokploy|--filter|status=running' \
  "Swarm task discovery arguments changed"
assert_log_line \
  'exec|8641bc8715518641bc8715518641bc8715518641bc8715518641bc8715518641' \
  "single running Swarm task was not selected for docker exec"

assert_failure "service with zero running tasks was accepted" \
  verify service-zero dokploy
assert_log_line ls "zero-task service was not enumerated"
assert_no_exec \
  "zero-task service reached docker exec"

assert_failure "service with two running tasks was accepted" \
  verify service-two dokploy
assert_log_line ls "multi-task service was not enumerated"
assert_no_exec \
  "multi-task service reached docker exec"

assert_failure "docker container ls failure was ignored" \
  verify ls-failure dokploy
assert_log_line ls "docker container ls failure scenario was not exercised"
assert_no_exec \
  "docker container ls failure reached docker exec"

assert_failure "invalid Swarm task ID was accepted" \
  verify invalid-id dokploy
assert_log_line ls "invalid task ID scenario was not enumerated"
assert_no_exec \
  "invalid task ID reached docker exec"

assert_status 42 "docker exec failure status was masked" \
  verify exec-failure dokploy-exact
assert_log_line \
  'exec|eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' \
  "docker exec failure scenario did not execute the selected container"

printf '%s: PASS\n' "$PROGRAM_NAME"
