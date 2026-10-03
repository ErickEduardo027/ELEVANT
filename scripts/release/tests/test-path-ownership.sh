#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_DIR
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd -P)"
readonly REPOSITORY_ROOT
# shellcheck source-path=SCRIPTDIR
# shellcheck source=../path-ownership.sh
source "$SCRIPT_DIR/../path-ownership.sh"

fail() {
  printf 'test-path-ownership.sh: FAIL: %s\n' "$*" >&2
  exit 1
}

assert_true() {
  local function="$1"
  shift
  "$function" "$@" || fail "$function should accept: $*"
}

assert_false() {
  local function="$1"
  shift
  if "$function" "$@"; then
    fail "$function should reject: $*"
  fi
}

for path in \
  .dockerignore \
  Directory.Build.props \
  Directory.Packages.props \
  NuGet.config \
  dotnet-tools.json \
  global.json \
  backend/Dockerfile \
  backend/compose.development.api.yml \
  backend/Elevant.sln \
  backend/Elevant.Api/Features/Nested/File.cs \
  backend/Elevant.Application/Features/Nested/File.cs \
  backend/Elevant.Contracts/Features/Nested/File.cs \
  backend/Elevant.Domain/Features/Nested/File.cs \
  backend/Elevant.Infrastructure/Features/Nested/File.cs \
  backend/scripts/deployment/nested/file.sh \
  packages/api-client/openapi/elevant-v1.json \
  database/DevelopmentDB/Elevant.Persistence/Nested/File.cs; do
  assert_true elevant_is_api_build_input_path "$path"
done

for path in \
  .github/workflows/backend-ci.yml \
  scripts/release/path-ownership.sh \
  ops/dokploy/web-cd/openapi-tool.mjs \
  backend/Elevant.Api.Tests/Test.cs \
  database/DevelopmentDB/Elevant.DatabaseTool/change.cs \
  database/ProductionDB/.gitkeep \
  frontend/mobile-agent/app.ts \
  ops/dokploy/web-cd/manifest-tool.mjs \
  packages/api-client/openapi/source.json \
  docs/note.md; do
  assert_false elevant_is_api_build_input_path "$path"
done

assert_true elevant_is_api_publication_superseding_path \
  database/DevelopmentDB/Elevant.DatabaseTool/change.cs
assert_false elevant_is_api_publication_superseding_path .github/workflows/backend-ci.yml
assert_false elevant_is_api_publication_superseding_path database/ProductionDB/.gitkeep

assert_true elevant_is_database_release_input_path backend/Elevant.Application/Feature.cs
assert_true elevant_is_database_release_input_path database/DevelopmentDB/Elevant.Persistence/Migrations/New.cs
assert_false elevant_is_database_release_input_path database/DevelopmentDB/tests/scripts/test_manifest.py
assert_false elevant_is_database_release_input_path .github/workflows/backend-ci.yml
assert_true elevant_is_api_release_input_path backend/Elevant.Api/Features/Flight.cs
assert_false elevant_is_api_release_input_path .github/workflows/backend-ci.yml
assert_true elevant_is_web_release_input_path aviam-web frontend/private-web/src/App.jsx
assert_false elevant_is_web_release_input_path aviam-web frontend/private-web/tests/App.test.jsx
assert_false elevant_is_web_release_input_path public-web frontend/private-web/src/App.jsx
assert_true elevant_is_web_release_input_path public-web packages/api-client/src/index.ts

assert_true elevant_is_web_shared_input_path packages/api-client/src/index.ts
assert_true elevant_is_web_shared_input_path ops/dokploy/web-cd/openapi-tool.mjs
assert_true elevant_is_web_shared_input_path backend/Elevant.Application/Feature.cs
assert_false elevant_is_web_shared_input_path frontend/mobile-agent/app.ts

assert_true elevant_is_web_application_input_path aviam-web frontend/private-web/src/App.jsx
assert_false elevant_is_web_application_input_path aviam-web frontend/public-web/src/app/page.tsx
assert_true elevant_is_web_application_input_path public-web frontend/public-web/src/app/page.tsx
assert_false elevant_is_web_application_input_path public-web frontend/private-web/src/App.jsx

for workflow in \
  "$REPOSITORY_ROOT/.github/workflows/backend-ci.yml" \
  "$REPOSITORY_ROOT/.github/workflows/web-ci.yml"; do
  [[ "$(grep -Fxc '      group: development-api-web-release-publication' "$workflow")" == 1 ]] ||
    fail "API/web publication concurrency group drifted in $workflow"
  [[ "$(grep -Fxc '      queue: max' "$workflow")" == 1 ]] ||
    fail "API/web publication queue drifted in $workflow"
done

printf 'test-path-ownership.sh: PASS\n'
