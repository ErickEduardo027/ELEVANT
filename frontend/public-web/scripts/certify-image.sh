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

[[ -n "$IMAGE" ]] || { echo "A Public Web image reference is required." >&2; exit 1; }
[[ "$EXPECTED_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo "A canonical expected revision is required." >&2; exit 1; }
[[ "$EXPECTED_SOURCE" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "A canonical GitHub source URL is required." >&2; exit 1; }
[[ "$EXPECTED_API_MANIFEST" =~ ^ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[0-9a-f]{64}$ ]] || { echo "An immutable API manifest is required." >&2; exit 1; }
[[ "$EXPECTED_OPENAPI_SHA256" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "A canonical OpenAPI digest is required." >&2; exit 1; }
[[ "$EXPECTED_RUN_ID" =~ ^[1-9][0-9]*$ ]] || { echo "A positive source run ID is required." >&2; exit 1; }

VCS_REF="$EXPECTED_REVISION" \
ELEVANT_DEPLOYMENT_ID="$EXPECTED_REVISION" \
OCI_SOURCE="$EXPECTED_SOURCE" \
OCI_CREATED=2026-01-01T00:00:00Z \
REQUIRED_API_MANIFEST="$EXPECTED_API_MANIFEST" \
OPENAPI_SHA256="$EXPECTED_OPENAPI_SHA256" \
SOURCE_RUN_ID="$EXPECTED_RUN_ID" \
NEXT_PUBLIC_SITE_URL=https://certifier.elevant.invalid \
NEXT_PUBLIC_ELEVANT_API_URL="$EXPECTED_API_ORIGIN" \
NEXT_PUBLIC_PROTOTYPE_API_URL="$EXPECTED_API_ORIGIN" \
NEXT_PUBLIC_DEMO_FORM_MODE=preview \
  node frontend/public-web/scripts/validate-development-env.mjs >/dev/null

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

declare -A expected_labels=(
  [org.opencontainers.image.revision]="$EXPECTED_REVISION"
  [org.opencontainers.image.source]="$EXPECTED_SOURCE"
  [io.elevant.application]="public-web"
  [io.elevant.environment]="Development"
  [io.elevant.source.run-id]="$EXPECTED_RUN_ID"
  [io.elevant.api.required-manifest]="$EXPECTED_API_MANIFEST"
  [io.elevant.openapi.sha256]="$EXPECTED_OPENAPI_SHA256"
  [io.elevant.web.api-origin]="$EXPECTED_API_ORIGIN"
)

for label in "${!expected_labels[@]}"; do
  [[ "$(inspect_label "$label")" == "${expected_labels[$label]}" ]] || {
    echo "Public Web image label $label is missing or unexpected." >&2
    exit 1
  }
done

configured_user="$(docker image inspect --format '{{.Config.User}}' "$IMAGE")"
[[ -n "$configured_user" && "$configured_user" != 0 && "$configured_user" != root ]] || {
  echo "Public Web image must declare a non-root runtime user." >&2
  exit 1
}

container="$(docker run --detach --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=1700 \
  --tmpfs /app/frontend/public-web/.next/cache:rw,noexec,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=0700 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --publish 127.0.0.1::3000 \
  "$IMAGE")"

container_uid="$(docker exec "$container" id -u)"
[[ "$container_uid" =~ ^[1-9][0-9]*$ ]] || {
  echo "Public Web process is not running as a non-root UID." >&2
  exit 1
}

binding="$(docker port "$container" 3000/tcp | head -n 1)"
[[ "$binding" =~ ^127\.0\.0\.1:[0-9]+$ ]] || {
  echo "Could not resolve the loopback-only Public Web certification port." >&2
  exit 1
}
base_url="http://$binding"

for _ in {1..90}; do
  if curl --silent --show-error --fail --max-time 2 "$base_url/health" > "$response_root/health.json" 2>/dev/null; then
    break
  fi
  if ! docker container inspect --format '{{.State.Running}}' "$container" | grep -qx true; then
    docker logs "$container" >&2 || true
    echo "Public Web container stopped during certification." >&2
    exit 1
  fi
  sleep 1
done

health_status="$(curl --silent --output "$response_root/health.json" --dump-header "$response_root/health.headers" --write-out '%{http_code}' --max-time 5 "$base_url/health")"
[[ "$health_status" == 200 ]] || {
  docker logs "$container" >&2 || true
  echo "Public Web health endpoint did not return HTTP 200." >&2
  exit 1
}

python3 - "$response_root/health.json" "$response_root/health.headers" <<'PY'
import json
from pathlib import Path
import sys

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if payload != {"application": "Elevant.PublicWeb", "status": "ok"}:
    raise SystemExit("Public Web health payload is unexpected.")

headers = Path(sys.argv[2]).read_text(encoding="iso-8859-1").casefold()
if "cache-control: no-store" not in headers:
    raise SystemExit("Public Web health response must be non-cacheable.")
PY

for path in / /login /portal /portal/vuelos/certification-smoke; do
  output="$response_root/$(printf '%s' "$path" | tr '/' '_').html"
  status="$(curl --silent --output "$output" --write-out '%{http_code}' --max-time 10 "$base_url$path")"
  [[ "$status" == 200 ]] || {
    docker logs "$container" >&2 || true
    echo "Public Web smoke path $path returned HTTP $status." >&2
    exit 1
  }
done

root_headers="$response_root/root.headers"
curl --silent --output "$response_root/root.html" --dump-header "$root_headers" --max-time 10 "$base_url/"
python3 - "$root_headers" <<'PY'
from pathlib import Path
import sys

headers: dict[str, list[str]] = {}
for raw_line in Path(sys.argv[1]).read_text(encoding="iso-8859-1").splitlines():
    if ":" not in raw_line:
        continue
    name, value = raw_line.split(":", 1)
    headers.setdefault(name.casefold(), []).append(value.strip())

expected = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
}
for name, value in expected.items():
    if headers.get(name) != [value]:
        raise SystemExit(f"Public Web security header {name} is missing or unexpected.")

if "x-powered-by" in headers:
    raise SystemExit("Public Web must not expose the X-Powered-By header.")
PY
node "$REPOSITORY_ROOT/frontend/scripts/deployment/csp-tool.mjs" validate \
  --application public-web \
  --headers "$root_headers" \
  --api-origin "$EXPECTED_API_ORIGIN" >/dev/null

grep -Fq "data-dpl-id=\"$EXPECTED_REVISION\"" "$response_root/root.html" || {
  echo "Public Web HTML does not expose the expected deployment ID." >&2
  exit 1
}

unknown_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 "$base_url/__elevant_certification_missing__")"
[[ "$unknown_status" == 404 ]] || {
  echo "Public Web unknown routes must return HTTP 404." >&2
  exit 1
}

if docker exec "$container" grep -R -F -q 'http://localhost:4310' /app; then
  echo "Public Web release contains the forbidden prototype localhost fallback." >&2
  exit 1
fi
docker exec "$container" grep -R -F -q "$EXPECTED_API_ORIGIN" /app/frontend/public-web/.next || {
  echo "Public Web release does not contain the certified API origin." >&2
  exit 1
}

docker exec "$container" node /app/healthcheck.mjs
echo "PUBLIC_WEB_IMAGE_CERTIFIED"
