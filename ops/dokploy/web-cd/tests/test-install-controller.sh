#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
fail() { printf '%s: FAIL: %s\n' "$PROGRAM_NAME" "$*" >&2; exit 1; }

mkdir -p "$TMP/etc/dokploy"
DEST="$TMP/etc/dokploy/elevant/web-cd"
mkdir "$TMP/no-node-bin"
cat > "$TMP/no-node-bin/node" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' invoked > "$NODE_SENTINEL"
exit 127
MOCK
chmod 0555 "$TMP/no-node-bin/node"

if ! NODE_SENTINEL="$TMP/node-invoked" PATH="$TMP/no-node-bin:$PATH" \
    ELEVANT_WEB_CD_INSTALL_TEST_MODE=1 ELEVANT_WEB_CD_INSTALL_TEST_ROOT="$TMP" \
    "$ROOT/install-controller" --destination "$DEST" > "$TMP/first.out"; then
  fail "installer required a working host Node runtime"
fi
[[ ! -e "$TMP/node-invoked" ]] || fail "installer invoked Node on the host"
grep -q 'No schedule or deployment was enabled' "$TMP/first.out" || fail "installer did not state its safe boundary"
for file in elevant-web-cd manifest-tool.mjs state-tool.mjs compose-model-tool.mjs openapi-tool.mjs env-tool.mjs verify-runtime jobs/aviam-web-poll.job.sh jobs/public-web-poll.job.sh; do
  [[ -x "$DEST/$file" && ! -L "$DEST/$file" ]] || fail "missing executable $file"
done
for app in aviam-web public-web; do
  [[ "$(stat -c '%a' "$DEST/config.$app.env")" == 600 ]] || fail "$app config mode is not 0600"
  [[ "$(stat -c '%a' "$DEST/state/$app")" == 700 ]] || fail "$app state mode is not 0700"
  grep -Fq 'ELEVANT_WEB_CD_EXPECTED_API_ORIGIN=https://REPLACE_PRIVATE_API_HOST' "$DEST/config.$app.env" || fail "$app installed config omitted the exact API origin"
  grep -Fq 'ELEVANT_WEB_CD_GLOBAL_LOCK=/etc/dokploy/elevant/web-cd/state/controller.lock' "$DEST/config.$app.env" || fail "$app installed config omitted the canonical shared lock"
done

printf '\n# PRESERVE_AVIAM\n' >> "$DEST/config.aviam-web.env"
printf '\n# PRESERVE_PUBLIC\n' >> "$DEST/config.public-web.env"
printf '%s\n' persistent > "$DEST/state/aviam-web/sentinel"
ELEVANT_WEB_CD_INSTALL_TEST_MODE=1 ELEVANT_WEB_CD_INSTALL_TEST_ROOT="$TMP" \
  "$ROOT/install-controller" --destination "$DEST" > "$TMP/second.out"
grep -q PRESERVE_AVIAM "$DEST/config.aviam-web.env" || fail "reinstall replaced AVIAM config"
grep -q PRESERVE_PUBLIC "$DEST/config.public-web.env" || fail "reinstall replaced Public config"
grep -q persistent "$DEST/state/aviam-web/sentinel" || fail "reinstall replaced state"
grep -q 'Preserved existing config.aviam-web.env' "$TMP/second.out" || fail "AVIAM preservation was not reported"
grep -q 'Preserved existing config.public-web.env' "$TMP/second.out" || fail "Public preservation was not reported"

rm "$DEST/verify-runtime"
ln -s "$ROOT/verify-runtime" "$DEST/verify-runtime"
if [[ -L "$DEST/verify-runtime" ]]; then
  if ELEVANT_WEB_CD_INSTALL_TEST_MODE=1 ELEVANT_WEB_CD_INSTALL_TEST_ROOT="$TMP" \
      "$ROOT/install-controller" --destination "$DEST" >/dev/null 2>&1; then
    fail "installer accepted a symlink destination"
  fi
fi

printf '%s: PASS\n' "$PROGRAM_NAME"
