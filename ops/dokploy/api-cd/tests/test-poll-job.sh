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

set +e
MOCK_SLEEP_LOG="$TMP/sleep.log" PATH="$TMP/bin:$PATH" \
  /bin/sh "$ROOT/jobs/poll.job.sh" > "$TMP/job.out" 2>&1
status=$?
set -e

[[ "$status" == 73 ]] || fail "poll job did not stop at the deterministic delay"
[[ "$(cat "$TMP/sleep.log")" == 15 ]] || fail "poll job delay is not exactly 15 seconds"
grep -Fq 'exec /etc/dokploy/elevant/api-cd/elevant-api-cd' "$ROOT/jobs/poll.job.sh" || \
  fail "poll job controller path changed"
grep -Fq -- '--config /etc/dokploy/elevant/api-cd/config.env --poll' "$ROOT/jobs/poll.job.sh" || \
  fail "poll job controller arguments changed"

printf '%s: PASS\n' "$PROGRAM_NAME"
