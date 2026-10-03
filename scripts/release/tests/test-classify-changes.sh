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
check ci-only '{"backend_validate":true,"database_release":false,"api_release":false,"aviam_validate":true,"public_validate":true,"aviam_release":false,"public_release":false}' '.github/workflows/backend-ci.yml' '.github/workflows/web-ci.yml'
check api-source '{"backend_validate":true,"database_release":true,"api_release":true,"aviam_release":true,"public_release":true}' 'backend/Elevant.Application/Operations/Service.cs'
check ef-migration '{"backend_validate":true,"database_release":true,"api_release":true,"aviam_release":true,"public_release":true}' 'database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/New.cs'
check private-only '{"backend_validate":false,"aviam_validate":true,"public_validate":false,"aviam_release":true,"public_release":false}' 'frontend/private-web/src/App.jsx'
check public-only '{"backend_validate":false,"aviam_validate":false,"public_validate":true,"aviam_release":false,"public_release":true}' 'frontend/public-web/src/app/page.tsx'
check shared-client '{"backend_validate":false,"aviam_validate":true,"public_validate":true,"aviam_release":true,"public_release":true}' 'packages/api-client/src/index.ts'
check ops-only '{"ops_validate":true,"database_release":false,"api_release":false,"aviam_release":false,"public_release":false}' 'ops/dokploy/firewall/elevant-firewall-apply'
check tests-only '{"backend_validate":true,"database_release":false,"api_release":false,"aviam_release":false,"public_release":false}' 'database/DevelopmentDB/tests/scripts/test_manifest.py'
check deleted-web-input '{"public_validate":true,"public_release":true}' 'frontend/public-web/src/lib/obsolete.ts'
check renamed-both-apps '{"aviam_release":true,"public_release":true}' 'frontend/private-web/src/old.ts' 'frontend/public-web/src/new.ts'

printf 'test-classify-changes.sh: PASS\n'
