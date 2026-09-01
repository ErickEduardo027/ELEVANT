#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
fail() { printf '%s: FAIL: %s\n' "$PROGRAM_NAME" "$*" >&2; exit 1; }

mkdir -p "$TMP/etc/dokploy"
DEST="$TMP/etc/dokploy/elevant/api-cd"
mkdir "$TMP/no-node-bin"
cat > "$TMP/no-node-bin/node" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' invoked > "$NODE_SENTINEL"
exit 127
MOCK
chmod 0555 "$TMP/no-node-bin/node"
if ! NODE_SENTINEL="$TMP/node-invoked" PATH="$TMP/no-node-bin:$PATH" \
    ELEVANT_API_CD_INSTALL_TEST_MODE=1 ELEVANT_API_CD_INSTALL_TEST_ROOT="$TMP" \
    "$ROOT/install-controller" --destination "$DEST" > "$TMP/first.out"; then
  fail "installer required a working host Node runtime"
fi
[[ ! -e "$TMP/node-invoked" ]] || fail "installer invoked Node on the host"
grep -q 'No schedule or deployment was enabled' "$TMP/first.out" || fail "installer did not state its safe boundary"
for file in elevant-api-cd manifest-tool.mjs state-tool.mjs compose-model-tool.mjs env-tool.mjs verify-runtime jobs/poll.job.sh; do [[ -x "$DEST/$file" && ! -L "$DEST/$file" ]] || fail "missing executable $file"; done
[[ "$(stat -c '%a' "$DEST/config.env")" == 600 ]] || fail "config.env mode is not 0600"
[[ "$(stat -c '%a' "$DEST/state")" == 700 ]] || fail "state directory mode is not 0700"

printf '\n# PRESERVE_ME\n' >> "$DEST/config.env"
ELEVANT_API_CD_INSTALL_TEST_MODE=1 ELEVANT_API_CD_INSTALL_TEST_ROOT="$TMP" \
  "$ROOT/install-controller" --destination "$DEST" > "$TMP/second.out"
grep -q PRESERVE_ME "$DEST/config.env" || fail "reinstall replaced config.env"
grep -q 'Preserved existing config.env' "$TMP/second.out" || fail "reinstall did not report preservation"

rm "$DEST/verify-runtime"
ln -s "$ROOT/verify-runtime" "$DEST/verify-runtime"
if [[ -L "$DEST/verify-runtime" ]]; then
  if ELEVANT_API_CD_INSTALL_TEST_MODE=1 ELEVANT_API_CD_INSTALL_TEST_ROOT="$TMP" \
      "$ROOT/install-controller" --destination "$DEST" >/dev/null 2>&1; then
    fail "installer accepted a symlink destination"
  fi
fi

printf '%s: PASS\n' "$PROGRAM_NAME"
