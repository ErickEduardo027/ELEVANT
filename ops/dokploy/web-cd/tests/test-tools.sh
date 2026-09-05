#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PROGRAM_NAME="${0##*/}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
fail() { printf '%s: FAIL: %s\n' "$PROGRAM_NAME" "$*" >&2; exit 1; }
repeat() { printf '%*s' "$2" '' | tr ' ' "$1"; }
assert_failure() { local message="$1"; shift; if "$@" >/dev/null 2>"$TMP/error"; then fail "$message"; fi; }

mkdir "$TMP/state" "$TMP/bundle"
WEB_DIGEST="sha256:$(repeat b 64)"
API_BUNDLE="ghcr.io/example/elevant-api-release-manifest@sha256:$(repeat c 64)"
API_IMAGE="ghcr.io/example/elevant-api@sha256:$(repeat d 64)"
OPENAPI="sha256:$(repeat e 64)"

cat > "$TMP/bundle/compose.development.web.yml" <<'YAML'
name: elevant-dev-aviam-web
services:
  aviam-web:
    image: "${ELEVANT_AVIAM_WEB_IMAGE:?immutable image required}"
YAML
COMPOSE_SHA="$(sha256sum "$TMP/bundle/compose.development.web.yml" | awk '{print $1}')"
cat > "$TMP/bundle/manifest.json" <<JSON
{
  "schemaVersion":1,
  "environment":"Development",
  "application":"aviam-web",
  "source":{"repository":"Example/ELEVANT","ref":"refs/heads/Development","commit":"$(repeat a 40)","runId":"30","runAttempt":1,"workflowUrl":"https://github.com/Example/ELEVANT/actions/runs/30"},
  "images":{"web":"ghcr.io/example/elevant-private-web@$WEB_DIGEST"},
  "compose":{"webSha256":"$COMPOSE_SHA"},
  "api":{"requiredManifest":"$API_BUNDLE","requiredRunId":"20","requiredImage":"$API_IMAGE","openApiSha256":"$OPENAPI"},
  "build":{"configurationSha256":"sha256:$(repeat f 64)"},
  "endpoints":{"containerPort":8080,"healthPath":"/healthz","smokePaths":["/healthz","/","/dashboard"]},
  "publishedAt":"2026-09-05T00:00:00Z"
}
JSON

node "$ROOT/manifest-tool.mjs" validate --file "$TMP/bundle/manifest.json" --bundle-root "$TMP/bundle" \
  --application aviam-web --expected-repository Example/ELEVANT --expected-ref refs/heads/Development \
  --web-repository ghcr.io/example/elevant-private-web \
  --api-manifest-repository ghcr.io/example/elevant-api-release-manifest \
  --api-image-repository ghcr.io/example/elevant-api >/dev/null || fail "valid closed bundle was rejected"

mkdir "$TMP/public-bundle"
cat > "$TMP/public-bundle/compose.development.web.yml" <<'YAML'
name: elevant-dev-public-web
services:
  public-web:
    image: "${ELEVANT_PUBLIC_WEB_IMAGE:?immutable image required}"
YAML
PUBLIC_COMPOSE_SHA="$(sha256sum "$TMP/public-bundle/compose.development.web.yml" | awk '{print $1}')"
node -e '
  const fs=require("fs");
  const [source,target,composeSha]=process.argv.slice(1);
  const value=JSON.parse(fs.readFileSync(source));
  value.application="public-web";
  value.images.web=value.images.web.replace("elevant-private-web","elevant-public-web");
  value.compose.webSha256=composeSha;
  value.endpoints={containerPort:3000,healthPath:"/health",smokePaths:["/health","/","/login"]};
  fs.writeFileSync(target,JSON.stringify(value));
' "$TMP/bundle/manifest.json" "$TMP/public-bundle/manifest.json" "$PUBLIC_COMPOSE_SHA"
node "$ROOT/manifest-tool.mjs" validate --file "$TMP/public-bundle/manifest.json" --bundle-root "$TMP/public-bundle" \
  --application public-web --expected-repository Example/ELEVANT --expected-ref refs/heads/Development \
  --web-repository ghcr.io/example/elevant-public-web \
  --api-manifest-repository ghcr.io/example/elevant-api-release-manifest \
  --api-image-repository ghcr.io/example/elevant-api >/dev/null || fail "valid Public Web bundle was rejected"

cp "$TMP/bundle/manifest.json" "$TMP/manifest.saved"
node -e 'const fs=require("fs");const p=process.argv[1];const x=JSON.parse(fs.readFileSync(p));x.extra=true;fs.writeFileSync(p,JSON.stringify(x));' "$TMP/bundle/manifest.json"
assert_failure "manifest with an extra root key was accepted" node "$ROOT/manifest-tool.mjs" validate \
  --file "$TMP/bundle/manifest.json" --bundle-root "$TMP/bundle" --application aviam-web \
  --expected-repository Example/ELEVANT --expected-ref refs/heads/Development \
  --web-repository ghcr.io/example/elevant-private-web \
  --api-manifest-repository ghcr.io/example/elevant-api-release-manifest \
  --api-image-repository ghcr.io/example/elevant-api
mv "$TMP/manifest.saved" "$TMP/bundle/manifest.json"

printf '\n# changed bytes\n' >> "$TMP/bundle/compose.development.web.yml"
assert_failure "Compose payload hash mismatch was accepted" node "$ROOT/manifest-tool.mjs" validate \
  --file "$TMP/bundle/manifest.json" --bundle-root "$TMP/bundle" --application aviam-web \
  --expected-repository Example/ELEVANT --expected-ref refs/heads/Development \
  --web-repository ghcr.io/example/elevant-private-web \
  --api-manifest-repository ghcr.io/example/elevant-api-release-manifest \
  --api-image-repository ghcr.io/example/elevant-api

cat > "$TMP/openapi-a.json" <<'JSON'
{"paths":{"/ping":{"get":{"responses":{"200":{"description":"ok"}}}}},"openapi":"3.0.4"}
JSON
cat > "$TMP/openapi-b.json" <<'JSON'
{"openapi":"3.0.4","paths":{"/ping":{"get":{"responses":{"200":{"description":"ok"}}}}}}
JSON
HASH_A="$(node "$ROOT/openapi-tool.mjs" hash --file "$TMP/openapi-a.json")"
HASH_B="$(node "$ROOT/openapi-tool.mjs" hash --file "$TMP/openapi-b.json")"
[[ "$HASH_A" == "$HASH_B" && "$HASH_A" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "canonical OpenAPI hash is unstable"

cat > "$TMP/openapi-numbers-a.json" <<'JSON'
{"openapi":"3.0.4","x-values":{"integerFloat":1.0,"small":1e-7,"large":1e20}}
JSON
cat > "$TMP/openapi-numbers-b.json" <<'JSON'
{"x-values":{"large":100000000000000000000,"small":0.0000001,"integerFloat":1},"openapi":"3.0.4"}
JSON
[[ "$(node "$ROOT/openapi-tool.mjs" hash --file "$TMP/openapi-numbers-a.json")" == "$(node "$ROOT/openapi-tool.mjs" hash --file "$TMP/openapi-numbers-b.json")" ]] || fail "canonical OpenAPI number normalization is unstable"
printf '\357\273\277{"openapi":"3.0.4"}\n' > "$TMP/openapi-bom.json"
assert_failure "OpenAPI UTF-8 BOM was accepted" node "$ROOT/openapi-tool.mjs" hash --file "$TMP/openapi-bom.json"

cat > "$TMP/model-a.json" <<'JSON'
{"b":[2,1],"a":{"z":true,"y":null}}
JSON
cat > "$TMP/model-b.json" <<'JSON'
{"a":{"y":null,"z":true},"b":[2,1]}
JSON
[[ "$(node "$ROOT/compose-model-tool.mjs" hash --file "$TMP/model-a.json")" == "$(node "$ROOT/compose-model-tool.mjs" hash --file "$TMP/model-b.json")" ]] || fail "Compose hash depends on key order"

cat > "$TMP/web.env" <<ENV
ELEVANT_AVIAM_WEB_IMAGE="ghcr.io/example/elevant-private-web@sha256:$(repeat 1 64)"
RESTRICTED_SENTINEL="must-survive"
ENV
chmod 0600 "$TMP/web.env"
node "$ROOT/env-tool.mjs" set --file "$TMP/web.env" --key ELEVANT_AVIAM_WEB_IMAGE \
  --value "ghcr.io/example/elevant-private-web@sha256:$(repeat 2 64)"
grep -q 'RESTRICTED_SENTINEL="must-survive"' "$TMP/web.env" || fail "env tool changed an unrelated setting"
grep -q "sha256:$(repeat 2 64)" "$TMP/web.env" || fail "env tool did not replace the selected image"
[[ "$(stat -c '%a' "$TMP/web.env")" == 600 ]] || fail "env tool weakened environment mode"

node "$ROOT/state-tool.mjs" write --file "$TMP/state/current.json" \
  --set application=aviam-web --set status=succeeded --set stage=complete --set manifestDigest= \
  --set sourceCommit= --set sourceRunId= --set sourceRunAttempt= --set webImage= \
  --set webComposeSha256= --set apiManifest= --set apiRunId= --set apiImage= \
  --set openApiSha256= --set configurationSha256= --set rollbackStatus=not-required \
  --set messageCode=test --set updatedAt=2026-09-05T00:00:00Z --set workflowUrl=
[[ "$(node "$ROOT/state-tool.mjs" get --file "$TMP/state/current.json" --field application)" == aviam-web ]] || fail "state round trip failed"
[[ "$(stat -c '%a' "$TMP/state/current.json")" == 600 ]] || fail "state mode is not 0600"

cat > "$TMP/api-state.json" <<JSON
{"apiComposeSha256":"$(repeat 3 64)","apiImage":"$API_IMAGE","databaseManifest":"ghcr.io/example/elevant-db-release-manifest@sha256:$(repeat 4 64)","databaseRunId":"10","manifestDigest":"${API_BUNDLE#*@}","messageCode":"promotion_succeeded","migrationFingerprint":"sha256:$(repeat 5 64)","modelFingerprint":"sha256:$(repeat 6 64)","rollbackStatus":"not-required","sourceCommit":"$(repeat 7 40)","sourceRunAttempt":"1","sourceRunId":"20","stage":"complete","status":"succeeded","updatedAt":"2026-09-05T00:00:00Z","workflowUrl":"https://github.com/Example/ELEVANT/actions/runs/20"}
JSON
[[ "$(node "$ROOT/state-tool.mjs" validate-api-state --file "$TMP/api-state.json")" == "${API_BUNDLE#*@}"$'\t20\t'"$API_IMAGE" ]] || fail "API state validation failed"

printf '%s: PASS\n' "$PROGRAM_NAME"
