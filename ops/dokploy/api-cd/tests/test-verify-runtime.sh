#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
fail() { printf '%s: FAIL: %s\n' "$PROGRAM_NAME" "$*" >&2; exit 1; }

mkdir "$TMP/bin"
cat > "$TMP/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s|%s\n' "${1:-}" "$*" >> "$MOCK_LOG"
case "${1:-} ${2:-}" in
  "container inspect")
    target="${@: -1}"
    case "$MOCK_SCENARIO:$target" in
      exact:dokploy-exact) printf '%064d true\n' 1 ;;
      stopped:dokploy-stopped) printf '%064d false\n' 2 ;;
      *) exit 1 ;;
    esac
    ;;
  "container ls")
    case "$MOCK_SCENARIO" in
      service-one) printf '%064d\n' 3 ;;
      service-two) printf '%064d\n%064d\n' 3 4 ;;
      service-zero) : ;;
      invalid-id) printf 'not-an-id\n' ;;
      *) exit 1 ;;
    esac
    ;;
  "container exec")
    [[ "$MOCK_SCENARIO" != exec-failure ]] || exit 42
    printf '%s\n' RUNTIME_OK
    ;;
  *) exit 1 ;;
esac
MOCK
chmod 0555 "$TMP/bin/docker"
: > "$TMP/log"

verify() { MOCK_SCENARIO="$1" MOCK_LOG="$TMP/log" PATH="$TMP/bin:$PATH" "$ROOT/verify-runtime" --host-container "$2"; }
verify exact dokploy-exact | grep -q RUNTIME_OK || fail "exact running container was rejected"
for module in manifest-tool.mjs state-tool.mjs compose-model-tool.mjs env-tool.mjs; do
  grep -Fq "node --check /etc/dokploy/elevant/api-cd/$module" "$TMP/log" || \
    fail "inside-Dokploy Node validation is missing for $module"
done
if verify stopped dokploy-stopped >/dev/null 2>&1; then fail "stopped exact container was accepted"; fi
verify service-one dokploy | grep -q RUNTIME_OK || fail "single Swarm task was rejected"
if verify service-two dokploy >/dev/null 2>&1; then fail "multiple Swarm tasks were accepted"; fi
if verify service-zero dokploy >/dev/null 2>&1; then fail "zero Swarm tasks were accepted"; fi
if verify invalid-id dokploy >/dev/null 2>&1; then fail "invalid Swarm task ID was accepted"; fi
before="$(wc -l < "$TMP/log")"
if verify exact -dokploy >/dev/null 2>&1; then fail "invalid target name was accepted"; fi
after="$(wc -l < "$TMP/log")"
[[ "$before" == "$after" ]] || fail "invalid target reached Docker"

printf '%s: PASS\n' "$PROGRAM_NAME"
