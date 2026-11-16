#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
fail() { printf '%s: FAIL: %s\n' "$PROGRAM_NAME" "$*" >&2; exit 1; }

mkdir "$TMP/bin"
cat > "$TMP/bin/sleep" <<'MOCK'
#!/bin/sh
set -eu
printf '%s\n' "$*" > "$MOCK_SLEEP_LOG"
exit 73
MOCK
chmod 0555 "$TMP/bin/sleep"

check_job() {
  local app="$1" delay="$2" file
  file="$ROOT/jobs/$app-poll.job.sh"
  set +e
  MOCK_SLEEP_LOG="$TMP/$app.sleep" PATH="$TMP/bin:$PATH" /bin/sh "$file" > "$TMP/$app.out" 2>&1
  status=$?
  set -e
  [[ "$status" == 73 ]] || fail "$app job did not stop at its deterministic delay"
  [[ "$(cat "$TMP/$app.sleep")" == "$delay" ]] || fail "$app delay is not $delay seconds"
  grep -Fq 'exec /etc/dokploy/elevant/web-cd/elevant-web-cd' "$file" || fail "$app controller path changed"
  grep -Fq -- "--app $app" "$file" || fail "$app selector is missing"
  grep -Fq -- "--config /etc/dokploy/elevant/web-cd/config.$app.env" "$file" || fail "$app config path changed"
  grep -Fq -- '--poll' "$file" || fail "$app poll argument is missing"
}

check_job aviam-web 30
check_job public-web 45
printf '%s: PASS\n' "$PROGRAM_NAME"
