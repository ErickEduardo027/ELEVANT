#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)"
readonly REPOSITORY_ROOT

readonly IMAGE="${1:-}"
readonly EXPECTED_REVISION="${2:-}"
readonly EXPECTED_SOURCE="${3:-}"
readonly EXPECTED_API_ORIGIN="${4:-}"
readonly EXPECTED_API_MANIFEST="${5:-}"
readonly EXPECTED_OPENAPI_SHA256="${6:-}"
readonly EXPECTED_RUN_ID="${7:-}"
readonly EXPECTED_HR_DEMO_MODE="dashboard-read-only"

[[ -n "$IMAGE" ]] || {
  echo "An AVIAM Web image reference is required." >&2
  exit 1
}
[[ "$EXPECTED_REVISION" =~ ^[0-9a-f]{40}$ ]] || {
  echo "A canonical expected revision is required." >&2
  exit 1
}
[[ "$EXPECTED_SOURCE" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  echo "A canonical GitHub source URL is required." >&2
  exit 1
}
[[ "$EXPECTED_API_MANIFEST" =~ ^ghcr\.io/[a-z0-9_.-]+/elevant-api-release-manifest@sha256:[0-9a-f]{64}$ ]] || {
  echo "An immutable Development API manifest reference is required." >&2
  exit 1
}
[[ "$EXPECTED_OPENAPI_SHA256" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "A canonical OpenAPI SHA-256 is required." >&2
  exit 1
}
[[ "$EXPECTED_RUN_ID" =~ ^[1-9][0-9]*$ ]] || {
  echo "A positive source run ID is required." >&2
  exit 1
}

VITE_ELEVANT_API_URL="$EXPECTED_API_ORIGIN" \
VITE_PROTOTYPE_API_URL="$EXPECTED_API_ORIGIN" \
VITE_HR_DEMO_MODE="$EXPECTED_HR_DEMO_MODE" \
  node frontend/private-web/scripts/validate-development-env.mjs >/dev/null

container=""
response_root="$(mktemp -d)"
cleanup() {
  if [[ -n "$container" ]]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  rm -rf "$response_root"
}
trap cleanup EXIT

inspect_label() {
  docker image inspect --format "{{index .Config.Labels \"$1\"}}" "$IMAGE"
}

[[ "$(inspect_label org.opencontainers.image.revision)" == "$EXPECTED_REVISION" ]] || {
  echo "AVIAM Web image revision label does not match the source commit." >&2
  exit 1
}
[[ "$(inspect_label org.opencontainers.image.source)" == "$EXPECTED_SOURCE" ]] || {
  echo "AVIAM Web image source label does not match the repository." >&2
  exit 1
}
[[ "$(inspect_label io.elevant.application)" == "aviam-web" ]] || {
  echo "AVIAM Web image application label is invalid." >&2
  exit 1
}
[[ "$(inspect_label io.elevant.environment)" == "Development" ]] || {
  echo "AVIAM Web image environment label must be Development." >&2
  exit 1
}
[[ "$(inspect_label io.elevant.source.run-id)" == "$EXPECTED_RUN_ID" ]] || {
  echo "AVIAM Web image source run label is invalid." >&2
  exit 1
}
[[ "$(inspect_label io.elevant.api.required-manifest)" == "$EXPECTED_API_MANIFEST" ]] || {
  echo "AVIAM Web image API prerequisite label is invalid." >&2
  exit 1
}
[[ "$(inspect_label io.elevant.openapi.sha256)" == "$EXPECTED_OPENAPI_SHA256" ]] || {
  echo "AVIAM Web image OpenAPI label is invalid." >&2
  exit 1
}
[[ "$(inspect_label io.elevant.web.api-origin)" == "$EXPECTED_API_ORIGIN" ]] || {
  echo "AVIAM Web image API origin label is invalid." >&2
  exit 1
}
[[ "$(inspect_label io.elevant.web.hr-demo-mode)" == "$EXPECTED_HR_DEMO_MODE" ]] || {
  echo "AVIAM Web image HR demo mode label is invalid." >&2
  exit 1
}

configured_user="$(docker image inspect --format '{{.Config.User}}' "$IMAGE")"
[[ -n "$configured_user" && "$configured_user" != 0 && "$configured_user" != root ]] || {
  echo "AVIAM Web image must declare a non-root runtime user." >&2
  exit 1
}

container="$(docker run --detach --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --publish 127.0.0.1::8080 \
  "$IMAGE")"

container_uid="$(docker exec "$container" id -u)"
[[ "$container_uid" =~ ^[1-9][0-9]*$ ]] || {
  echo "AVIAM Web process is not running as a non-root UID." >&2
  exit 1
}

docker exec "$container" nginx -t >/dev/null

binding="$(docker port "$container" 8080/tcp | head -n 1)"
[[ "$binding" =~ ^127\.0\.0\.1:[0-9]+$ ]] || {
  echo "Could not resolve the loopback-only AVIAM Web certification port." >&2
  exit 1
}
base_url="http://$binding"

healthy=false
for _ in {1..45}; do
  if curl --silent --show-error --fail --max-time 2 \
    "$base_url/healthz" >"$response_root/healthz" 2>/dev/null; then
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
[[ "$healthy" == true ]] || {
  docker logs "$container" >&2 || true
  echo "AVIAM Web health endpoint did not become ready." >&2
  exit 1
}

[[ "$(tr -d '\r\n' <"$response_root/healthz")" == ok ]] || {
  echo "AVIAM Web health endpoint did not return its physical marker." >&2
  exit 1
}

root_status="$(curl --silent --show-error --max-time 5 \
  --dump-header "$response_root/root.headers" \
  --output "$response_root/index.html" \
  --write-out '%{http_code}' "$base_url/")"
[[ "$root_status" == 200 ]] || {
  echo "AVIAM Web root did not return HTTP 200." >&2
  exit 1
}
curl --silent --show-error --fail --max-time 5 \
  --output "$response_root/favicon.png" "$base_url/brand/elevant-logo.png" || {
  echo "AVIAM Web brand icon could not be loaded." >&2
  exit 1
}
cmp -s "$response_root/favicon.png" \
  "$REPOSITORY_ROOT/frontend/private-web/public/brand/elevant-logo.png" || {
  echo "AVIAM Web brand icon did not match the reviewed asset." >&2
  exit 1
}

for route in /dashboard.html /contracts.html /finance.html; do
  [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 "$base_url$route")" == 200 ]] || {
    echo "AVIAM Web historical entry $route did not return HTTP 200." >&2
    exit 1
  }
done

for route in /dashboard /admin-occ/dashboard; do
  deep_file="$response_root/deep-${route//\//-}.html"
  deep_status="$(curl --silent --show-error --max-time 5 \
    --output "$deep_file" --write-out '%{http_code}' "$base_url$route")"
  if [[ "$deep_status" != 200 ]] || ! cmp -s "$response_root/index.html" "$deep_file"; then
    echo "AVIAM Web deep route $route did not fall back to the SPA entry." >&2
    exit 1
  fi
done

[[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 \
  "$base_url/assets/elevant-certification-missing.js")" == 404 ]] || {
  echo "Missing AVIAM Web assets must return HTTP 404." >&2
  exit 1
}

for header in content-security-policy permissions-policy referrer-policy x-content-type-options x-frame-options; do
  grep -Eqi "^${header}:" "$response_root/root.headers" || {
    echo "AVIAM Web response is missing the ${header} security header." >&2
    exit 1
  }
done
node "$REPOSITORY_ROOT/frontend/scripts/deployment/csp-tool.mjs" validate \
  --application aviam-web \
  --headers "$response_root/root.headers" \
  --api-origin "$EXPECTED_API_ORIGIN" >/dev/null
grep -Eqi '^cache-control:.*no-store' "$response_root/root.headers" || {
  echo "AVIAM Web HTML must not be cached." >&2
  exit 1
}

asset_path="$(grep -Eo '(src|href)="/assets/[^"]+"' "$response_root/index.html" \
  | head -n 1 | cut -d '"' -f 2 || true)"
[[ "$asset_path" =~ ^/assets/ ]] || {
  echo "AVIAM Web root does not reference a versioned asset." >&2
  exit 1
}
[[ "$(curl --silent --show-error --max-time 5 \
  --dump-header "$response_root/asset.headers" \
  --output /dev/null --write-out '%{http_code}' "$base_url$asset_path")" == 200 ]] || {
  echo "AVIAM Web versioned asset did not return HTTP 200." >&2
  exit 1
}
grep -Eqi '^cache-control:.*immutable' "$response_root/asset.headers" || {
  echo "AVIAM Web versioned assets must use immutable caching." >&2
  exit 1
}

mkdir "$response_root/html"
docker cp "$container:/usr/share/nginx/html/." "$response_root/html/"
grep -R --binary-files=text -Fq -- "$EXPECTED_API_ORIGIN" "$response_root/html" || {
  echo "AVIAM Web bundle does not contain the certified API origin." >&2
  exit 1
}
grep -R --binary-files=text -Fq -- "$EXPECTED_HR_DEMO_MODE" "$response_root/html" || {
  echo "AVIAM Web bundle does not contain the certified HR demo mode." >&2
  exit 1
}
grep -R --binary-files=text -Fq -- 'Datos sintéticos · Solo lectura' "$response_root/html" || {
  echo "AVIAM Web bundle does not contain the permanent synthetic-data banner." >&2
  exit 1
}
if grep -R --binary-files=text -Fq -- 'http://localhost:4310' "$response_root/html"; then
  echo "AVIAM Web bundle leaked the local prototype origin." >&2
  exit 1
fi
if find "$response_root/html" -type f -name '*.map' -print -quit | grep -q .; then
  echo "AVIAM Web release image must not contain source maps." >&2
  exit 1
fi

echo "AVIAM_WEB_IMAGE_CERTIFIED"
