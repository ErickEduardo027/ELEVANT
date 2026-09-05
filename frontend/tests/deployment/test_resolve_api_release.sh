#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
FRONTEND_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly FRONTEND_ROOT
readonly RESOLVER="$FRONTEND_ROOT/scripts/deployment/resolve-api-release.sh"
TEST_ROOT="$(mktemp -d)"
readonly TEST_ROOT
trap 'rm -rf -- "$TEST_ROOT"' EXIT

readonly API_COMMIT=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
readonly API_DIGEST=3333333333333333333333333333333333333333333333333333333333333333
readonly BUNDLE_DIGEST=2222222222222222222222222222222222222222222222222222222222222222
readonly API_IMAGE="ghcr.io/example/elevant-api@sha256:$API_DIGEST"
readonly BUNDLE_REFERENCE="ghcr.io/example/elevant-api-release-manifest@sha256:$BUNDLE_DIGEST"

mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/repository/packages/api-client/openapi" "$TEST_ROOT/fixtures"

cat > "$TEST_ROOT/fixtures/manifest.json" <<EOF
{"schemaVersion":1,"environment":"Development","publishedAt":"2026-09-05T00:00:00Z","source":{"repository":"Example/ELEVANT","ref":"refs/heads/Development","commit":"$API_COMMIT","runId":"111111","runAttempt":1,"workflowUrl":"https://github.com/Example/ELEVANT/actions/runs/111111"},"images":{"api":"$API_IMAGE"},"compose":{"apiSha256":"$(printf '4%.0s' {1..64})"},"database":{},"endpoints":{"containerPort":8080,"livenessPath":"/health","readinessPath":"/health/ready","pingPath":"/api/v1/system/ping","swaggerPath":"/swagger/v1/swagger.json"}}
EOF
printf 'services: {}\n' > "$TEST_ROOT/fixtures/compose.yml"
cat > "$TEST_ROOT/repository/packages/api-client/openapi/source.json" <<EOF
{"sourceCommit":"$API_COMMIT","sourceRunId":"111111","apiImage":"$API_IMAGE","swaggerPath":"/swagger/v1/swagger.json"}
EOF
printf '%s\n' '{"info":{"title":"ELEVANT","version":"v1"},"openapi":"3.0.4"}' \
  > "$TEST_ROOT/repository/packages/api-client/openapi/elevant-v1.json"
cat > "$TEST_ROOT/validator.py" <<'PY'
#!/usr/bin/env python3
raise SystemExit(0)
PY

cat > "$TEST_ROOT/bin/docker" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$1 $2" in
  "pull ghcr.io/example/elevant-api-release-manifest:development-certified" | \
  "pull ghcr.io/example/elevant-api-release-manifest@sha256:"*)
    if [[ -n "${MOCK_PULL_COUNTER_FILE:-}" ]]; then
      count="$(<"$MOCK_PULL_COUNTER_FILE")"
      if [[ "$count" == 0 ]]; then
        printf '1\n' > "$MOCK_PULL_COUNTER_FILE"
        exit 1
      fi
    fi
    exit 0
    ;;
  "image inspect")
    format="$4"
    case "$format" in
      *RepoDigests*) printf '%s\n' "$MOCK_BUNDLE_REFERENCE" ;;
      *org.elevant.api.environment*) printf 'Development\n' ;;
      *org.elevant.api.manifest.schema*) printf '1\n' ;;
      *io.elevant.api-release.bundle-version*) printf '1\n' ;;
      *io.elevant.api-release.media-type*) printf 'application/vnd.elevant.api-release-bundle.v1\n' ;;
      *org.opencontainers.image.revision*) printf '%s\n' "$MOCK_API_COMMIT" ;;
      *org.opencontainers.image.source*) printf 'https://github.com/Example/ELEVANT\n' ;;
      *) exit 2 ;;
    esac
    ;;
  "create $MOCK_BUNDLE_REFERENCE") printf 'mock-container\n' ;;
  "cp mock-container:/manifest.json") cp "$MOCK_MANIFEST" "$3" ;;
  "cp mock-container:/compose/compose.development.api.yml") cp "$MOCK_COMPOSE" "$3" ;;
  "rm mock-container") exit 0 ;;
  *) printf 'unexpected docker invocation: %q ' "$@" >&2; printf '\n' >&2; exit 3 ;;
esac
SH
chmod +x "$TEST_ROOT/bin/docker" "$TEST_ROOT/validator.py"

run_resolver() {
  local output="$1"
  shift
  PATH="$TEST_ROOT/bin:$PATH" \
  MOCK_BUNDLE_REFERENCE="$BUNDLE_REFERENCE" \
  MOCK_API_COMMIT="$API_COMMIT" \
  MOCK_MANIFEST="$TEST_ROOT/fixtures/manifest.json" \
  MOCK_COMPOSE="$TEST_ROOT/fixtures/compose.yml" \
  ELEVANT_REPOSITORY_ROOT="$TEST_ROOT/repository" \
  ELEVANT_EXPECTED_REPOSITORY=Example/ELEVANT \
  ELEVANT_API_MANIFEST_VALIDATOR="$TEST_ROOT/validator.py" \
  ELEVANT_OPENAPI_TOOL="$FRONTEND_ROOT/../ops/dokploy/web-cd/openapi-tool.mjs" \
  ELEVANT_API_WAIT_SECONDS="${ELEVANT_API_WAIT_SECONDS:-0}" \
  ELEVANT_API_POLL_SECONDS="${ELEVANT_API_POLL_SECONDS:-1}" \
    bash "$RESOLVER" \
      ghcr.io/example/elevant-api-release-manifest:development-certified \
      "$output" "$@"
}

output="$TEST_ROOT/output"
run_resolver "$output" > "$TEST_ROOT/happy.out"
grep -Fqx "API_RELEASE_COMPATIBLE reference=$BUNDLE_REFERENCE" "$TEST_ROOT/happy.out"
grep -Fqx "$BUNDLE_REFERENCE" "$output/api-release-manifest-reference.txt"
grep -Eq '^sha256:[0-9a-f]{64}$' "$output/openapi.sha256"
cmp -s "$TEST_ROOT/fixtures/manifest.json" "$output/api-release-manifest.json"
printf 'PASS: compatible API release is resolved immutably\n'

printf '0\n' > "$TEST_ROOT/pull-counter"
MOCK_PULL_COUNTER_FILE="$TEST_ROOT/pull-counter" \
ELEVANT_API_WAIT_SECONDS=2 \
  run_resolver "$TEST_ROOT/retry-output" > "$TEST_ROOT/retry.out"
grep -Fq 'Waiting for the certified Development API bundle to become available.' \
  "$TEST_ROOT/retry.out"
grep -Fqx "API_RELEASE_COMPATIBLE reference=$BUNDLE_REFERENCE" "$TEST_ROOT/retry.out"
printf 'PASS: transient certified-alias pull failure is retried\n'

python3 - "$TEST_ROOT/repository/packages/api-client/openapi/source.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as stream:
    data = json.load(stream)
data["sourceCommit"] = "c" * 40
with open(path, "w", encoding="utf-8", newline="\n") as stream:
    json.dump(data, stream, separators=(",", ":"))
    stream.write("\n")
PY
if run_resolver "$TEST_ROOT/mismatch" >"$TEST_ROOT/mismatch.out" 2>"$TEST_ROOT/mismatch.err"; then
  echo "Resolver accepted an API provenance mismatch." >&2
  exit 1
fi
grep -Fq 'Timed out waiting for the API release required' "$TEST_ROOT/mismatch.err"
printf 'PASS: API client provenance mismatch is rejected\n'

if PATH="$TEST_ROOT/bin:$PATH" ELEVANT_EXPECTED_REPOSITORY=Example/ELEVANT \
  bash "$RESOLVER" ghcr.io/example/elevant-api-release-manifest:latest "$TEST_ROOT/invalid" \
  >"$TEST_ROOT/invalid.out" 2>"$TEST_ROOT/invalid.err"; then
  echo "Resolver accepted a mutable non-certified tag." >&2
  exit 1
fi
grep -Fq 'certified alias or an immutable GHCR digest' "$TEST_ROOT/invalid.err"
printf 'PASS: arbitrary mutable API reference is rejected\n'

mkdir "$TEST_ROOT/non-empty"
ln -s "$TEST_ROOT/fixtures/manifest.json" "$TEST_ROOT/non-empty/manifest.json"
if run_resolver "$TEST_ROOT/non-empty" >"$TEST_ROOT/non-empty.out" 2>"$TEST_ROOT/non-empty.err"; then
  echo "Resolver accepted a non-empty output directory." >&2
  exit 1
fi
grep -Fq 'output directory must be empty' "$TEST_ROOT/non-empty.err"

ln -s "$TEST_ROOT/fixtures" "$TEST_ROOT/output-link"
if run_resolver "$TEST_ROOT/output-link" >"$TEST_ROOT/output-link.out" 2>"$TEST_ROOT/output-link.err"; then
  echo "Resolver accepted a symbolic-link output directory." >&2
  exit 1
fi
grep -Fq 'output directory must not be a symbolic link' "$TEST_ROOT/output-link.err"
printf 'PASS: unsafe API release output targets are rejected\n'
