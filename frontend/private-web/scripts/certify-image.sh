#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)"
readonly SCRIPT_DIR REPOSITORY_ROOT

IMAGE="$1"
EXPECTED_REVISION="$2"
EXPECTED_SOURCE="$3"
EXPECTED_API_ORIGIN="$4"
EXPECTED_API_MANIFEST="$5"
EXPECTED_OPENAPI_SHA256="$6"
EXPECTED_RUN_ID="$7"
EXPECTED_HR_DEMO_MODE="dashboard-read-only"
readonly IMAGE EXPECTED_REVISION EXPECTED_SOURCE EXPECTED_API_ORIGIN
readonly EXPECTED_API_MANIFEST EXPECTED_OPENAPI_SHA256 EXPECTED_RUN_ID EXPECTED_HR_DEMO_MODE

[[ "$EXPECTED_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "A canonical expected revision is required." >&2; exit 1; }
[[ "$EXPECTED_SOURCE" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "A canonical GitHub source URL is required." >&2; exit 1; }
[[ "$EXPECTED_API_MANIFEST" =~ ^ghcr\.io/[a-z0-9_.-]+/elevant-api-release-manifest@sha256:[0-9a-f]{64}$ ]] || { echo "An immutable Development API manifest reference is required." >&2; exit 1; }
[[ "$EXPECTED_OPENAPI_SHA256" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "A canonical OpenAPI SHA-256 is required." >&2; exit 1; }
[[ "$EXPECTED_RUN_ID" =~ ^[1-9][0-9]*$ ]] || { echo "A positive source run ID is required." >&2; exit 1; }

NEXT_PUBLIC_ELEVANT_API_URL="$EXPECTED_API_ORIGIN" \
NEXT_PUBLIC_PROTOTYPE_API_URL="$EXPECTED_API_ORIGIN" \
NEXT_PUBLIC_HR_DEMO_MODE="$EXPECTED_HR_DEMO_MODE" \
  node frontend/private-web/scripts/validate-development-env.mjs >/dev/null

container=""
response_root="$(mktemp -d)"
cleanup() {
  if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  rm -rf -- "$response_root"
}
trap cleanup EXIT

expect_label() {
  if [[ "$(docker image inspect --format "{{index .Config.Labels \"$1\"}}" "$IMAGE")" != "$2" ]]; then
    echo "AVIAM Web image label $1 does not match its certified input." >&2
    exit 1
  fi
}
expect_label org.opencontainers.image.revision "$EXPECTED_REVISION"
expect_label org.opencontainers.image.source "$EXPECTED_SOURCE"
expect_label io.elevant.application aviam-web
expect_label io.elevant.environment Development
expect_label io.elevant.source.run-id "$EXPECTED_RUN_ID"
expect_label io.elevant.api.required-manifest "$EXPECTED_API_MANIFEST"
expect_label io.elevant.openapi.sha256 "$EXPECTED_OPENAPI_SHA256"
expect_label io.elevant.web.api-origin "$EXPECTED_API_ORIGIN"
expect_label io.elevant.web.hr-demo-mode "$EXPECTED_HR_DEMO_MODE"

[[ "$(docker image inspect --format '{{.Config.User}}' "$IMAGE")" == "101:101" ]] || {
  echo "AVIAM Web image must declare its non-root runtime user." >&2; exit 1;
}
[[ "$(docker image inspect --format '{{json .Config.Cmd}}' "$IMAGE")" == '["node","server.js"]' ]] || {
  echo "AVIAM Web image must run the standalone Next server." >&2; exit 1;
}

container="$(docker run --detach --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,uid=101,gid=101 \
  --tmpfs /app/frontend/private-web/.next/cache:rw,noexec,nosuid,nodev,size=128m,uid=101,gid=101 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --publish 127.0.0.1::8080 \
  "$IMAGE")"
[[ "$(docker exec "$container" id -u)" == 101 ]] || {
  echo "AVIAM Web server is not running as the certified UID." >&2; exit 1;
}
binding="$(docker port "$container" 8080/tcp | head -n 1)"
[[ "$binding" =~ ^127\.0\.0\.1:[0-9]+$ ]] || {
  echo "Could not resolve the loopback-only AVIAM Web certification port." >&2; exit 1;
}
base_url="http://$binding"

healthy=false
for _ in {1..45}; do
  if curl --silent --show-error --fail --max-time 2 "$base_url/healthz" >"$response_root/healthz" 2>/dev/null; then
    healthy=true
    break
  fi
  if ! docker container inspect --format '{{.State.Running}}' "$container" | grep -qx true; then
    docker logs "$container" >&2 || true
    echo "AVIAM Web container stopped during certification." >&2
    exit 1
  fi
  sleep 1
done
# Command substitution discards trailing newlines, which can hide a static asset
# shadowing the Next route after public/ is copied into the runtime image.
printf '%s' ok > "$response_root/expected-healthz"
if [[ "$healthy" != true ]] || ! cmp -s "$response_root/healthz" "$response_root/expected-healthz"; then
  docker logs "$container" >&2 || true
  echo "AVIAM Web health route did not return the exact two-byte marker." >&2
  exit 1
fi

root_status="$(curl --silent --show-error --max-time 10 \
  --dump-header "$response_root/root.headers" \
  --output "$response_root/index.html" \
  --write-out '%{http_code}' "$base_url/")"
[[ "$root_status" == 200 ]] || { echo "AVIAM Web root did not return HTTP 200." >&2; exit 1; }
grep -Fq '<html' "$response_root/index.html" || {
  echo "AVIAM Web did not render an HTML document." >&2; exit 1;
}
for route in /dashboard /admin-occ/dashboard /contratos /finanzas /gestion-humana/attendance /superadmin; do
  status="$(curl --silent --show-error --max-time 10 --output "$response_root/route.html" \
    --write-out '%{http_code}' "$base_url$route")"
  [[ "$status" == 200 ]] || {
    echo "AVIAM Web route $route did not render through Next (HTTP $status)." >&2
    exit 1
  }
done
for old in index.html dashboard.html contracts.html finance.html; do
  case "$old" in
    index.html) destination=/login ;;
    dashboard.html) destination=/admin-occ/dashboard ;;
    contracts.html) destination=/contratos ;;
    finance.html) destination=/finanzas ;;
  esac
  status="$(curl --silent --show-error --max-time 5 \
    --dump-header "$response_root/redirect.headers" --output /dev/null \
    --write-out '%{http_code}' "$base_url/$old")"
  if [[ "$status" != 308 ]] || ! grep -Fqi "location: $destination" "$response_root/redirect.headers"; then
    echo "AVIAM Web historical entry /$old did not redirect to $destination." >&2
    exit 1
  fi
done
[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 \
  "$base_url/missing-next-route")" == 404 ]] || {
  echo "Unknown AVIAM Web routes must return HTTP 404." >&2; exit 1;
}

curl --silent --show-error --fail --max-time 5 \
  --output "$response_root/favicon.png" "$base_url/brand/elevant-logo.png" || {
  echo "AVIAM Web brand icon could not be loaded." >&2; exit 1;
}
cmp -s "$response_root/favicon.png" \
  "$REPOSITORY_ROOT/frontend/private-web/public/brand/elevant-logo.png" || {
  echo "AVIAM Web brand icon did not match the reviewed asset." >&2; exit 1;
}
for asset in brand/elevant-mark-light.png brand/elevant-mark-dark.png \
  brand/airlines/{american-airlines,united,delta,jetblue,avianca,iberia}.png \
  images/login-airport-{light,dark}{,-sky}.webp; do
  curl --silent --show-error --fail --max-time 10 \
    --output "$response_root/auth-asset" "$base_url/$asset" || {
    echo "AVIAM Web login asset $asset could not be loaded." >&2; exit 1;
  }
  cmp -s "$response_root/auth-asset" "$REPOSITORY_ROOT/frontend/private-web/public/$asset" || {
    echo "AVIAM Web login asset $asset differs from the reviewed source." >&2; exit 1;
  }
done
node "$SCRIPT_DIR/verify-auth-motion.mjs" "$base_url"
for asset in maplibre-gl-worker.mjs maplibre-gl-shared.mjs; do
  curl --silent --show-error --fail --max-time 10 \
    --dump-header "$response_root/$asset.headers" \
    --output "$response_root/$asset" \
    "$base_url/assets/maplibre/$asset" || {
    echo "AVIAM Web MapLibre asset $asset could not be loaded." >&2; exit 1;
  }
  grep -Eqi '^content-type:.*(javascript|ecmascript)' "$response_root/$asset.headers" || {
    echo "AVIAM Web MapLibre asset $asset has an invalid content type." >&2; exit 1;
  }
  cmp -s "$response_root/$asset" \
    "$REPOSITORY_ROOT/frontend/private-web/node_modules/maplibre-gl/dist/$asset" || {
    echo "AVIAM Web MapLibre asset $asset did not match the locked package." >&2; exit 1;
  }
done
for header in content-security-policy permissions-policy referrer-policy \
  strict-transport-security x-content-type-options x-frame-options; do
  grep -Eqi "^$header:" "$response_root/root.headers" || {
    echo "AVIAM Web response is missing the $header security header." >&2
    exit 1
  }
done
node "$REPOSITORY_ROOT/frontend/scripts/deployment/csp-tool.mjs" validate \
  --application aviam-web --headers "$response_root/root.headers" \
  --api-origin "$EXPECTED_API_ORIGIN" >/dev/null
grep -Eqi '^cache-control:.*no-store' "$response_root/root.headers" || {
  echo "AVIAM Web HTML must not be cached." >&2; exit 1;
}
node - "$response_root/root.headers" "$response_root/index.html" <<'NODE'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const headers = fs.readFileSync(process.argv[2], 'utf8');
const html = fs.readFileSync(process.argv[3], 'utf8');
const nonce = headers.match(/script-src[^;\r\n]*'nonce-([^']+)'/i)?.[1];
assert(nonce, 'CSP must contain a request nonce');
assert(html.includes('nonce="' + nonce + '"'), 'Next scripts must carry that request nonce');
NODE

asset_path="$(grep -Eo '/_next/static/[^"]+\.js' "$response_root/index.html" | head -n 1 || true)"
[[ "$asset_path" == /_next/static/* ]] || {
  echo "AVIAM Web document does not reference a versioned Next asset." >&2; exit 1;
}
[[ "$(curl --silent --show-error --max-time 5 \
  --dump-header "$response_root/asset.headers" --output /dev/null \
  --write-out '%{http_code}' "$base_url$asset_path")" == 200 ]] || {
  echo "AVIAM Web versioned asset did not return HTTP 200." >&2; exit 1;
}
grep -Eqi '^cache-control:.*immutable' "$response_root/asset.headers" || {
  echo "AVIAM Web versioned assets must use immutable caching." >&2; exit 1;
}

static_root=/app/frontend/private-web/.next/static
docker exec "$container" grep -R -Fq -- "$EXPECTED_API_ORIGIN" "$static_root" || {
  echo "AVIAM Web bundle does not contain the certified API origin." >&2; exit 1;
}
docker exec "$container" grep -R -Fq -- "$EXPECTED_HR_DEMO_MODE" "$static_root" || {
  echo "AVIAM Web bundle does not contain the certified HR demo mode." >&2; exit 1;
}
docker exec "$container" grep -R -Fq -- 'Agentes de rampa activos' "$static_root" || {
  echo "AVIAM Web bundle does not contain the connected HR dashboard." >&2; exit 1;
}
if docker exec "$container" grep -R -Fq -- 'Datos sintéticos · Solo lectura' "$static_root"; then
  echo "AVIAM Web bundle still contains the retired synthetic-data banner." >&2; exit 1;
fi
if docker exec "$container" grep -R -Fq -- 'http://localhost:4310' "$static_root"; then
  echo "AVIAM Web bundle leaked the local prototype origin." >&2; exit 1;
fi
if [[ -n "$(docker exec "$container" find "$static_root" -type f -name '*.map' -print -quit)" ]]; then
  echo "AVIAM Web release image must not contain source maps." >&2; exit 1;
fi
echo "AVIAM_WEB_IMAGE_CERTIFIED"
