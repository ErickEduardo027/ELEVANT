#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)"
readonly CERTIFIER="$REPOSITORY_ROOT/backend/scripts/deployment/certify-api-image.sh"
readonly OPENAPI_TOOL="$REPOSITORY_ROOT/ops/dokploy/web-cd/openapi-tool.mjs"
readonly TRACKED_OPENAPI="$REPOSITORY_ROOT/packages/api-client/openapi/elevant-v1.json"
readonly REVISION="0123456789abcdef0123456789abcdef01234567"
readonly SOURCE="https://github.com/example/elevant"

temporary_root="$(mktemp -d)"
cleanup() {
  rm -rf "$temporary_root"
}
trap cleanup EXIT

install -d "$temporary_root/bin"

cat > "$temporary_root/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

case "${1:-}" in
  image)
    [[ "${2:-}" == inspect && "${3:-}" == --format ]]
    case "${4:-}" in
      *org.opencontainers.image.revision*) printf '%s\n' "$MOCK_REVISION" ;;
      *org.opencontainers.image.source*) printf '%s\n' "$MOCK_SOURCE" ;;
      *org.elevant.api.environment*) printf '%s\n' Development ;;
      *Config.User*) printf '%s\n' 65534:65534 ;;
      *) echo "Unexpected image inspection: ${4:-}" >&2; exit 1 ;;
    esac
    ;;
  run)
    printf '%s\n' mock-api-container
    ;;
  exec)
    printf '%s\n' 65534
    ;;
  port)
    printf '%s\n' 127.0.0.1:49152
    ;;
  container)
    printf '%s\n' true
    ;;
  logs | rm)
    ;;
  *)
    echo "Unexpected docker invocation: $*" >&2
    exit 1
    ;;
esac
EOF

cat > "$temporary_root/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

output=""
headers=""
origin=""
write_status=false
is_options=false
url="${!#}"

while (($#)); do
  case "$1" in
    --output)
      output="$2"
      shift 2
      ;;
    --dump-header)
      headers="$2"
      shift 2
      ;;
    --write-out)
      write_status=true
      shift 2
      ;;
    --request)
      [[ "$2" == OPTIONS ]] && is_options=true
      shift 2
      ;;
    --header)
      if [[ "$2" == Origin:* ]]; then
        origin="${2#Origin: }"
      fi
      shift 2
      ;;
    --max-time)
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

status=200
if [[ "$url" == */health/ready ]]; then
  status=503
fi
if [[ "$is_options" == true ]]; then
  status=204
fi

if [[ -n "$output" && "$output" != /dev/null ]]; then
  if [[ "$url" == */swagger/v1/swagger.json ]]; then
    cp "$MOCK_SWAGGER" "$output"
  else
    printf '{}\n' > "$output"
  fi
fi

if [[ -n "$headers" ]]; then
  printf 'HTTP/1.1 %s Mock\r\n' "$status" > "$headers"
  if [[ "$origin" != *.attacker.example ]]; then
    {
      printf 'Access-Control-Allow-Origin: %s\r\n' "$origin"
      printf 'Access-Control-Allow-Credentials: true\r\n'
      printf 'Access-Control-Allow-Methods: GET\r\n'
      printf 'Access-Control-Allow-Headers: Authorization,Content-Type\r\n'
    } >> "$headers"
  fi
  printf '\r\n' >> "$headers"
fi

if [[ "$write_status" == true ]]; then
  printf '%s' "$status"
fi
EOF

chmod +x "$temporary_root/bin/docker" "$temporary_root/bin/curl"

export MOCK_REVISION="$REVISION"
export MOCK_SOURCE="$SOURCE"
export MOCK_SWAGGER="$TRACKED_OPENAPI"
export PATH="$temporary_root/bin:$PATH"

expect_failure() {
  local expected_message="$1"
  shift
  local output

  if output="$("$@" 2>&1)"; then
    echo "Expected command to fail: $*" >&2
    exit 1
  fi
  grep -Fqx "$expected_message" <<< "$output"
}

expect_failure \
  "A canonical expected OpenAPI fingerprint is required." \
  bash "$CERTIFIER" mock:api "$REVISION" "$SOURCE"

expect_failure \
  "A canonical expected OpenAPI fingerprint is required." \
  bash "$CERTIFIER" mock:api "$REVISION" "$SOURCE" "${REVISION}000000000000000000000000"

expect_failure \
  "API OpenAPI fingerprint does not match the certified contract." \
  bash "$CERTIFIER" mock:api "$REVISION" "$SOURCE" \
    sha256:0000000000000000000000000000000000000000000000000000000000000000

openapi_sha256="$(node "$OPENAPI_TOOL" hash --file "$TRACKED_OPENAPI")"
output="$(bash "$CERTIFIER" mock:api "$REVISION" "$SOURCE" "$openapi_sha256")"
grep -Fqx API_IMAGE_CERTIFIED <<< "$output"

echo "PASS: API certification rejects malformed or mismatched OpenAPI fingerprints."
