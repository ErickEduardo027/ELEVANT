#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=path-ownership.sh
source "$script_dir/path-ownership.sh"

backend_validate=false database_release=false api_release=false
aviam_validate=false public_validate=false aviam_release=false public_release=false
ops_validate=false api_client_validate=false mobile_validate=false

while IFS= read -r -d '' path; do
  # A new repository boundary must be explicitly assigned. Do not silently
  # skip build tooling outside the known product, docs and support paths.
  case "$path" in
    backend/* | backend-prototipo/* | database/DevelopmentDB/* | \
    database/ProductionDB/.gitkeep | database/README.md | database/AGENTS.md | \
    frontend/private-web/* | frontend/public-web/* | frontend/mobile-agent/* | \
    frontend/scripts/deployment/* | frontend/tests/deployment/* | \
    frontend/README.md | frontend/AGENTS.md | \
    packages/api-client/* | packages/README.md | \
    packages/typescript-config/README.md | packages/eslint-config/README.md | \
    ops/dokploy/* | ops/AGENTS.md | \
    scripts/release/* | scripts/repository/* | scripts/vault/* | \
    scripts/setup/verify-prerequisites.ps1 | scripts/README.md | \
    docs/* | Vault/* | .obsidian/* | .github/ISSUE_TEMPLATE/* | \
    .github/BRANCH_PROTECTION.md | .github/CODEOWNERS.template | \
    .github/pull_request_template.md | \
    .github/workflows/backend-ci.yml | .github/workflows/web-ci.yml | \
    .github/workflows/api-client-ci.yml | .github/workflows/mobile-ci.yml | \
    .github/workflows/ops-config-ci.yml | .github/workflows/vault-ci.yml | \
    .github/workflows/secret-scan.yml | \
    .github/workflows/development-delivery.yml | \
    .github/workflows/pull-request-ci.yml | \
    .dockerignore | .editorconfig | .gitattributes | .gitignore | \
    AGENTS.md | CONTRIBUTING.md | LICENSE.md | README.md | SECURITY.md | \
    SETUP_REPORT.md | .1GUIA-PRUEBA-COMPLETA-PROTOTIPO.md | \
    INICIAR-PROTOTIPO.cmd | PREPARAR-PROTOTIPO.cmd | \
    PROBAR-PROTOTIPO.cmd | RESTABLECER-DATOS-PROTOTIPO.cmd | \
    Directory.Build.props | Directory.Packages.props | NuGet.config | \
    dotnet-tools.json | global.json | package.json | package-lock.json | \
    pnpm-workspace.yaml)
      ;;
    *)
      printf 'Unclassified repository path; update CI ownership: %q\n' "$path" >&2
      exit 2 ;;
  esac
  case "$path" in
    backend/* | database/* | .dockerignore | Directory.Build.props | \
    Directory.Packages.props | NuGet.config | dotnet-tools.json | global.json | \
    ops/dokploy/api-cd/* | ops/dokploy/web-cd/openapi-tool.mjs | \
    packages/api-client/openapi/* | packages/api-client/package.json | \
    packages/api-client/scripts/check-openapi.mjs | \
    packages/api-client/scripts/snapshot-utils.mjs | scripts/release/* | \
    .github/workflows/backend-ci.yml | .github/workflows/development-delivery.yml)
      backend_validate=true ;;
  esac
  if elevant_is_database_release_input_path "$path"; then database_release=true; fi
  if elevant_is_api_release_input_path "$path"; then api_release=true; fi

  if elevant_is_web_shared_input_path "$path" ||
     [[ "$path" == .github/workflows/backend-ci.yml ]] ||
     [[ "$path" == ops/dokploy/web-cd/* ]] ||
     [[ "$path" == .github/workflows/development-delivery.yml ]]; then
    aviam_validate=true
    public_validate=true
  fi
  if elevant_is_web_application_input_path aviam-web "$path"; then aviam_validate=true; fi
  if elevant_is_web_application_input_path public-web "$path"; then public_validate=true; fi
  if elevant_is_web_release_input_path aviam-web "$path"; then aviam_release=true; fi
  if elevant_is_web_release_input_path public-web "$path"; then public_release=true; fi

  case "$path" in
    ops/dokploy/* | database/DevelopmentDB/* | \
    backend/scripts/deployment/* | backend/compose.development.api.yml | \
    frontend/scripts/deployment/* | \
    frontend/private-web/compose.development.aviam-web.yml | \
    frontend/public-web/compose.development.public-web.yml | \
    packages/api-client/openapi/* | .dockerignore | \
    scripts/release/* | .github/workflows/ops-config-ci.yml)
      ops_validate=true ;;
  esac
  case "$path" in
    packages/api-client/* | backend/Elevant.Api/* | backend/Elevant.Contracts/* | \
    Directory.Build.props | Directory.Packages.props | NuGet.config | global.json | \
    frontend/private-web/.env.example | frontend/private-web/package.json | \
    frontend/private-web/package-lock.json | frontend/private-web/vite.config.js | \
    frontend/private-web/src/config/elevantApiClient.js | \
    frontend/private-web/tests/elevantApiClient.smoke.test.js | \
    frontend/public-web/.env.example | frontend/public-web/package.json | \
    frontend/public-web/package-lock.json | frontend/public-web/next.config.ts | \
    frontend/public-web/next-env.d.ts | frontend/public-web/tsconfig.json | \
    frontend/public-web/vitest.config.ts | frontend/public-web/src/lib/elevant-api.ts | \
    frontend/public-web/tests/unit/elevant-api-client.test.ts | \
    frontend/mobile-agent/.env.example | frontend/mobile-agent/app.json | \
    frontend/mobile-agent/eslint.config.js | frontend/mobile-agent/expo-env.d.ts | \
    frontend/mobile-agent/metro.config.js | frontend/mobile-agent/package.json | \
    frontend/mobile-agent/package-lock.json | frontend/mobile-agent/tsconfig.json | \
    frontend/mobile-agent/src/config/elevant-api.ts | \
    frontend/mobile-agent/tests/api-client.metro-smoke.ts | \
    .github/workflows/api-client-ci.yml)
      api_client_validate=true ;;
  esac
  case "$path" in
    frontend/mobile-agent/* | packages/api-client/* | .github/workflows/mobile-ci.yml)
      mobile_validate=true ;;
  esac
done

matrix() {
  local aviam="$1" public="$2" entries=''
  if [[ "$aviam" == true ]]; then
    entries='{"application":"aviam-web","directory":"frontend/private-web","imageName":"elevant-private-web","bundleName":"elevant-aviam-web-release-manifest","compose":"frontend/private-web/compose.development.aviam-web.yml"}'
  fi
  if [[ "$public" == true ]]; then
    [[ -n "$entries" ]] && entries+=,
    entries+='{"application":"public-web","directory":"frontend/public-web","imageName":"elevant-public-web","bundleName":"elevant-public-web-release-manifest","compose":"frontend/public-web/compose.development.public-web.yml"}'
  fi
  printf '{"include":[%s]}' "$entries"
}

printf '{"backend_validate":%s,"database_release":%s,"api_release":%s,"aviam_validate":%s,"public_validate":%s,"aviam_release":%s,"public_release":%s,"ops_validate":%s,"api_client_validate":%s,"mobile_validate":%s,"validation_matrix":%s,"release_matrix":%s}\n' \
  "$backend_validate" "$database_release" "$api_release" \
  "$aviam_validate" "$public_validate" "$aviam_release" "$public_release" \
  "$ops_validate" "$api_client_validate" "$mobile_validate" \
  "$(matrix "$aviam_validate" "$public_validate")" \
  "$(matrix "$aviam_release" "$public_release")"
