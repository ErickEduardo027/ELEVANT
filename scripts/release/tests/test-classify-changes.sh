#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
classifier="$root/scripts/release/classify-changes.sh"

check() {
  local name="$1" expected="$2"; shift 2
  local actual
  actual="$(printf '%s\0' "$@" | bash "$classifier")"
  EXPECTED="$expected" ACTUAL="$actual" node - "$name" <<'NODE'
const assert = require('node:assert/strict');
const expected = JSON.parse(process.env.EXPECTED);
const actual = JSON.parse(process.env.ACTUAL);
for (const [key, value] of Object.entries(expected)) {
  assert.equal(actual[key], value, `${process.argv[2]}: ${key}`);
}
NODE
}

check docs-only '{"backend_validate":false,"database_release":false,"api_release":false,"aviam_validate":false,"public_validate":false,"aviam_release":false,"public_release":false}' 'docs/note.md'
check agent-guides '{"backend_validate":false,"database_release":false,"api_release":false,"aviam_validate":false,"public_validate":false,"aviam_release":false,"public_release":false,"ops_validate":false,"api_client_validate":false,"mobile_validate":false}' 'AGENTS.md' 'CLAUDE.md'
check ci-only '{"backend_validate":true,"database_release":false,"api_release":false,"aviam_validate":true,"public_validate":true,"aviam_release":false,"public_release":false}' '.github/workflows/backend-ci.yml' '.github/workflows/web-ci.yml'
check backend-workflow '{"backend_validate":true,"aviam_validate":true,"public_validate":true,"api_release":false}' '.github/workflows/backend-ci.yml'
check api-source '{"backend_validate":true,"database_release":true,"api_release":true,"aviam_release":true,"public_release":true}' 'backend/Elevant.Application/Operations/Service.cs'
check new-backend-component '{"backend_validate":true,"database_release":true,"api_release":true,"aviam_release":true,"public_release":true}' 'backend/New.Runtime/Thing.cs'
check new-database-component '{"backend_validate":true,"database_release":true,"api_release":true,"aviam_release":true,"public_release":true}' 'database/DevelopmentDB/New.Runtime/Thing.cs'
check ef-migration '{"backend_validate":true,"database_release":true,"api_release":true,"aviam_release":true,"public_release":true}' 'database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/New.cs'
check ef-ops '{"ops_validate":true}' 'database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/New.cs'
check private-only '{"backend_validate":false,"aviam_validate":true,"public_validate":false,"aviam_release":true,"public_release":false}' 'frontend/private-web/src/App.jsx'
check public-only '{"backend_validate":false,"aviam_validate":false,"public_validate":true,"aviam_release":false,"public_release":true}' 'frontend/public-web/src/app/page.tsx'
check shared-client '{"backend_validate":false,"aviam_validate":true,"public_validate":true,"aviam_release":true,"public_release":true}' 'packages/api-client/src/index.ts'
check shared-client-mobile '{"api_client_validate":true,"mobile_validate":true}' 'packages/api-client/src/index.ts'
check openapi-schema '{"backend_validate":true,"ops_validate":true,"api_client_validate":true,"mobile_validate":true,"aviam_validate":true,"public_validate":true}' 'packages/api-client/openapi/elevant-api.v1.json'
check openapi-tool '{"backend_validate":true,"aviam_validate":true,"public_validate":true,"ops_validate":true}' 'ops/dokploy/web-cd/openapi-tool.mjs'
check web-control '{"aviam_validate":true,"public_validate":true,"ops_validate":true,"aviam_release":false,"public_release":false}' 'ops/dokploy/web-cd/elevant-web-cd'
check private-seam '{"api_client_validate":true,"aviam_validate":true,"public_validate":false}' 'frontend/private-web/src/config/elevantApiClient.js'
check public-seam '{"api_client_validate":true,"public_validate":true}' 'frontend/public-web/src/lib/elevant-api.ts'
check mobile-seam '{"api_client_validate":true,"mobile_validate":true}' 'frontend/mobile-agent/src/config/elevant-api.ts'
check client-tooling '{"aviam_validate":true,"public_validate":true,"aviam_release":false,"public_release":false}' 'packages/api-client/scripts/check-openapi.mjs'
check geo-generator '{"backend_validate":true,"aviam_validate":true,"public_validate":true,"aviam_release":false,"public_release":false}' 'scripts/geo/generate-do-territory.mjs'
check data-generator '{"backend_validate":true,"aviam_validate":false,"public_validate":false,"api_release":false}' 'scripts/data/generate-openflights-airlines.mjs'
check asset-generator '{"backend_validate":false,"aviam_validate":true,"public_validate":true,"aviam_release":false,"public_release":false}' 'scripts/assets/generate-service-illustrations.mjs'
check publication-guards '{"backend_validate":true,"api_release":false,"aviam_validate":true,"public_validate":true,"aviam_release":false,"public_release":false}' 'backend/scripts/deployment/guard-api-publication.sh' 'frontend/scripts/deployment/guard-web-publication.sh'
check ops-only '{"ops_validate":true,"database_release":false,"api_release":false,"aviam_release":false,"public_release":false}' 'ops/dokploy/firewall/elevant-firewall-apply'
check tests-only '{"backend_validate":true,"database_release":false,"api_release":false,"aviam_release":false,"public_release":false}' 'database/DevelopmentDB/tests/scripts/test_manifest.py'
check deleted-web-input '{"public_validate":true,"public_release":true}' 'frontend/public-web/src/lib/obsolete.ts'
check renamed-both-apps '{"aviam_release":true,"public_release":true}' 'frontend/private-web/src/old.ts' 'frontend/public-web/src/new.ts'

error_file="$(mktemp)"
trap 'rm -f -- "$error_file"' EXIT
for unknown in 'tooling/new-tool.js' '.github/workflows/unclassified.yml' 'packages/new-tool/src/index.ts'; do
  if printf '%s\0' "$unknown" | bash "$classifier" 2> "$error_file"; then
    echo "unknown external path unexpectedly passed classification: $unknown" >&2
    exit 1
  fi
  grep -Fq "$unknown" "$error_file"
done

printf 'test-classify-changes.sh: PASS\n'
