#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
fail() { printf '%s: FAIL: %s\n' "$PROGRAM_NAME" "$*" >&2; exit 1; }

mkdir "$TMP/state"
node "$ROOT/state-tool.mjs" write --file "$TMP/state/current.json" \
  --set status=succeeded --set stage=complete --set manifestDigest= \
  --set sourceCommit= --set sourceRunId= --set sourceRunAttempt= \
  --set apiImage= --set apiComposeSha256= --set databaseManifest= \
  --set databaseRunId= --set migrationFingerprint= --set modelFingerprint= \
  --set rollbackStatus=not-required --set messageCode=test \
  --set updatedAt=2026-08-31T00:00:00Z --set workflowUrl=
[[ "$(stat -c '%a' "$TMP/state/current.json")" == 600 ]] || fail "state mode is not 0600"
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/state/current.json" --field status)" == succeeded ]] || fail "state round trip failed"

cat > "$TMP/model-a.json" <<'JSON'
{"b":[2,1],"a":{"z":true,"y":null}}
JSON
cat > "$TMP/model-b.json" <<'JSON'
{"a":{"y":null,"z":true},"b":[2,1]}
JSON
[[ "$(node "$ROOT/compose-model-tool.mjs" hash --file "$TMP/model-a.json")" == "$(node "$ROOT/compose-model-tool.mjs" hash --file "$TMP/model-b.json")" ]] || fail "canonical Compose hashing depends on object key order"

cat > "$TMP/api.env" <<'ENV'
ELEVANT_API_IMAGE="ghcr.io/example/elevant-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
SECRET_VALUE="must-survive"
ENV
chmod 0600 "$TMP/api.env"
output="$(node "$ROOT/env-tool.mjs" set --file "$TMP/api.env" --key ELEVANT_API_IMAGE --value ghcr.io/example/elevant-api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)"
[[ -z "$output" ]] || fail "env tool printed restricted content"
grep -q 'SECRET_VALUE="must-survive"' "$TMP/api.env" || fail "env tool changed an unrelated value"
grep -q 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' "$TMP/api.env" || fail "env tool did not update the image"
[[ "$(stat -c '%a' "$TMP/api.env")" == 600 ]] || fail "env tool weakened file mode"

printf '%s: PASS\n' "$PROGRAM_NAME"
