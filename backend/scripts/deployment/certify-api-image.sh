#!/usr/bin/env bash
set -Eeuo pipefail

readonly IMAGE="${1:-}"
readonly EXPECTED_REVISION="${2:-}"
readonly EXPECTED_SOURCE="${3:-}"
readonly PRIVATE_WEB_ORIGIN="https://private-web.elevant.test"
readonly PUBLIC_WEB_ORIGIN="https://public-web.elevant.test"

[[ -n "$IMAGE" ]] || {
  echo "An API image reference is required." >&2
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
  echo "API image revision label does not match the source commit." >&2
  exit 1
}
[[ "$(inspect_label org.opencontainers.image.source)" == "$EXPECTED_SOURCE" ]] || {
  echo "API image source label does not match the repository." >&2
  exit 1
}
[[ "$(inspect_label org.elevant.api.environment)" == Development ]] || {
  echo "API image environment label must be Development." >&2
  exit 1
}

configured_user="$(docker image inspect --format '{{.Config.User}}' "$IMAGE")"
[[ -n "$configured_user" && "$configured_user" != 0 && "$configured_user" != root ]] || {
  echo "API image must declare a non-root runtime user." >&2
  exit 1
}

container="$(docker run --detach --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --publish 127.0.0.1::8080 \
  --env ASPNETCORE_ENVIRONMENT=Development \
  --env ELEVANT_DATABASE_ENVIRONMENT=Development \
  --env 'ConnectionStrings__ElevantDatabase=Server=127.0.0.1,1;Initial Catalog=ElevantDevelopmentDb;User ID=elevant_dev_app;Password=CI-Only_AppPassword!2026;Encrypt=True;TrustServerCertificate=True;Connect Timeout=1' \
  --env "Cors__AllowedOrigins__0=$PRIVATE_WEB_ORIGIN" \
  --env "Cors__AllowedOrigins__1=$PUBLIC_WEB_ORIGIN" \
  "$IMAGE")"

container_uid="$(docker exec "$container" id -u)"
[[ "$container_uid" =~ ^[1-9][0-9]*$ ]] || {
  echo "API process is not running as a non-root UID." >&2
  exit 1
}

binding="$(docker port "$container" 8080/tcp | head -n 1)"
[[ "$binding" =~ ^127\.0\.0\.1:[0-9]+$ ]] || {
  echo "Could not resolve the loopback-only API certification port." >&2
  exit 1
}
base_url="http://$binding"

for _ in {1..60}; do
  if curl --silent --show-error --fail --max-time 2 \
    "$base_url/health" > "$response_root/liveness.json" 2>/dev/null; then
    break
  fi
  if ! docker container inspect --format '{{.State.Running}}' "$container" | grep -qx true; then
    docker logs "$container" >&2 || true
    echo "API container stopped during certification." >&2
    exit 1
  fi
  sleep 1
done

[[ "$(curl --silent --output "$response_root/liveness.json" --write-out '%{http_code}' --max-time 5 "$base_url/health")" == 200 ]] || {
  docker logs "$container" >&2 || true
  echo "API liveness endpoint did not return HTTP 200." >&2
  exit 1
}
[[ "$(curl --silent --output "$response_root/readiness.json" --write-out '%{http_code}' --max-time 10 "$base_url/health/ready")" == 503 ]] || {
  docker logs "$container" >&2 || true
  echo "API readiness endpoint must return HTTP 503 when SQL is unavailable." >&2
  exit 1
}
[[ "$(curl --silent --output "$response_root/ping.json" --write-out '%{http_code}' --max-time 5 "$base_url/api/v1/system/ping")" == 200 ]] || {
  docker logs "$container" >&2 || true
  echo "API ping endpoint did not return HTTP 200." >&2
  exit 1
}
[[ "$(curl --silent --output "$response_root/swagger.json" --write-out '%{http_code}' --max-time 5 "$base_url/swagger/v1/swagger.json")" == 200 ]] || {
  docker logs "$container" >&2 || true
  echo "Development OpenAPI document did not return HTTP 200." >&2
  exit 1
}

for origin in "$PRIVATE_WEB_ORIGIN" "$PUBLIC_WEB_ORIGIN"; do
  headers="$response_root/cors-$(basename -- "$origin").headers"
  status="$(curl --silent --output /dev/null --dump-header "$headers" \
    --write-out '%{http_code}' --max-time 5 --request OPTIONS \
    --header "Origin: $origin" \
    --header 'Access-Control-Request-Method: GET' \
    --header 'Access-Control-Request-Headers: Authorization, Content-Type' \
    "$base_url/api/v1/system/ping")"
  [[ "$status" == 204 ]] || {
    echo "API CORS preflight did not return HTTP 204 for an allowed origin." >&2
    exit 1
  }
  python3 - "$headers" "$origin" <<'PY'
from pathlib import Path
import sys

headers: dict[str, list[str]] = {}
for raw_line in Path(sys.argv[1]).read_text(encoding="iso-8859-1").splitlines():
    if ":" not in raw_line:
        continue
    name, value = raw_line.split(":", 1)
    headers.setdefault(name.casefold(), []).append(value.strip())

expected_origin = sys.argv[2]
if headers.get("access-control-allow-origin") != [expected_origin]:
    raise SystemExit("CORS allow-origin is not the exact requested origin.")
if headers.get("access-control-allow-credentials") != ["true"]:
    raise SystemExit("CORS credentials response is missing.")

methods = {
    item.strip().casefold()
    for value in headers.get("access-control-allow-methods", [])
    for item in value.split(",")
}
allowed_headers = {
    item.strip().casefold()
    for value in headers.get("access-control-allow-headers", [])
    for item in value.split(",")
}
if "get" not in methods:
    raise SystemExit("CORS preflight did not allow GET.")
if not {"authorization", "content-type"}.issubset(allowed_headers):
    raise SystemExit("CORS preflight did not allow the required headers.")
PY
done

unknown_headers="$response_root/cors-unknown.headers"
unknown_status="$(curl --silent --output /dev/null --dump-header "$unknown_headers" \
  --write-out '%{http_code}' --max-time 5 --request OPTIONS \
  --header "Origin: $PRIVATE_WEB_ORIGIN.attacker.example" \
  --header 'Access-Control-Request-Method: GET' \
  "$base_url/api/v1/system/ping")"
[[ "$unknown_status" == 204 ]] || {
  echo "API CORS middleware did not handle the rejected preflight safely." >&2
  exit 1
}
if grep -Eqi '^access-control-allow-(origin|credentials):' "$unknown_headers"; then
  echo "API CORS preflight allowed an unknown origin." >&2
  exit 1
fi

python3 - "$response_root/swagger.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    document = json.load(stream)
paths = document.get("paths")
if not isinstance(paths, dict) or "/api/v1/system/ping" not in paths:
    raise SystemExit("OpenAPI document does not contain the system ping path.")
PY

if docker logs "$container" 2>&1 | grep -Eq \
  'Applying migration|Acquiring an exclusive lock for migration|No migrations were applied'; then
  echo "API startup attempted to run the database migration workflow." >&2
  exit 1
fi

echo "API_IMAGE_CERTIFIED"
