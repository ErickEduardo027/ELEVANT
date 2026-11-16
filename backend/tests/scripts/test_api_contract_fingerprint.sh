#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)"
readonly REPOSITORY_ROOT
readonly CERTIFIER="$REPOSITORY_ROOT/backend/scripts/deployment/certify-api-image.sh"
readonly OPENAPI_TOOL="$REPOSITORY_ROOT/ops/dokploy/web-cd/openapi-tool.mjs"
readonly TRACKED_OPENAPI="$REPOSITORY_ROOT/packages/api-client/openapi/elevant-v1.json"
readonly REVISION="0123456789abcdef0123456789abcdef01234567"
readonly SOURCE="https://github.com/example/elevant"
readonly AUTHENTICATION_ISSUER="https://api.ci.elevant.test"
readonly AUTHENTICATION_AUDIENCE="elevant-ci-clients"
readonly AUTHENTICATION_SIGNING_KEY_BASE64="RUxFVkFOVCBzeW50aGV0aWMgc2lnbmluZyBtYXRlcmlhbCBmb3IgdGVzdHMgb25seSAyMDI2LTA5LTE2"
readonly AUTHENTICATION_ACCESS_TOKEN_MINUTES="15"

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
    arguments=("$@")
    require_environment() {
      local expected="$1"
      local index
      for ((index = 0; index + 1 < ${#arguments[@]}; index++)); do
        if [[ "${arguments[index]}" == --env && \
              "${arguments[index + 1]}" == "$expected" ]]; then
          return 0
        fi
      done
      echo "Missing docker environment: $expected" >&2
      exit 1
    }
    require_environment "Authentication__Issuer=$MOCK_AUTHENTICATION_ISSUER"
    require_environment "Authentication__Audience=$MOCK_AUTHENTICATION_AUDIENCE"
    require_environment "Authentication__SigningKeyBase64=$MOCK_AUTHENTICATION_SIGNING_KEY_BASE64"
    require_environment "Authentication__AccessTokenMinutes=$MOCK_AUTHENTICATION_ACCESS_TOKEN_MINUTES"
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
authorization_present=false
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
      if [[ "$2" == Authorization:* ]]; then
        authorization_present=true
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
if [[ "$url" == */api/v1/auth/session ]]; then
  [[ "$authorization_present" == false ]] || {
    echo "The unauthenticated session probe unexpectedly sent authorization." >&2
    exit 1
  }
  status="$MOCK_SESSION_STATUS"
  printf '%s\n' "$url" >> "$MOCK_SESSION_REQUEST_LOG"
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
export MOCK_AUTHENTICATION_ISSUER="$AUTHENTICATION_ISSUER"
export MOCK_AUTHENTICATION_AUDIENCE="$AUTHENTICATION_AUDIENCE"
export MOCK_AUTHENTICATION_SIGNING_KEY_BASE64="$AUTHENTICATION_SIGNING_KEY_BASE64"
export MOCK_AUTHENTICATION_ACCESS_TOKEN_MINUTES="$AUTHENTICATION_ACCESS_TOKEN_MINUTES"
export MOCK_SESSION_REQUEST_LOG="$temporary_root/session-requests.log"
export MOCK_SESSION_STATUS=401
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

openapi_sha256="$(node "$OPENAPI_TOOL" hash --file "$TRACKED_OPENAPI")"
export MOCK_SESSION_STATUS=200
expect_failure \
  "API session endpoint did not reject an unauthenticated request with HTTP 401." \
  bash "$CERTIFIER" mock:api "$REVISION" "$SOURCE" "$openapi_sha256"
export MOCK_SESSION_STATUS=401

expect_failure \
  "API OpenAPI fingerprint does not match the certified contract." \
  bash "$CERTIFIER" mock:api "$REVISION" "$SOURCE" \
    sha256:0000000000000000000000000000000000000000000000000000000000000000

output="$(bash "$CERTIFIER" mock:api "$REVISION" "$SOURCE" "$openapi_sha256")"
grep -Fqx API_IMAGE_CERTIFIED <<< "$output"
grep -Fqx 'http://127.0.0.1:49152/api/v1/auth/session' "$MOCK_SESSION_REQUEST_LOG"

echo "PASS: API certification enforces its OpenAPI fingerprint and unauthenticated session boundary."
