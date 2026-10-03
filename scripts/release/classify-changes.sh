#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=path-ownership.sh
source "$script_dir/path-ownership.sh"

backend_validate=false database_release=false api_release=false
aviam_validate=false public_validate=false aviam_release=false public_release=false
ops_validate=false api_client_validate=false mobile_validate=false

while IFS= read -r -d '' path; do
  case "$path" in
    backend/* | database/* | .dockerignore | Directory.Build.props | \
    Directory.Packages.props | NuGet.config | dotnet-tools.json | global.json | \
    ops/dokploy/api-cd/* | scripts/release/* | \
    .github/workflows/backend-ci.yml | .github/workflows/development-delivery.yml)
      backend_validate=true ;;
  esac
  if elevant_is_database_release_input_path "$path"; then database_release=true; fi
  if elevant_is_api_release_input_path "$path"; then api_release=true; fi

  if elevant_is_web_shared_input_path "$path" ||
     [[ "$path" == .github/workflows/development-delivery.yml ]]; then
    aviam_validate=true
    public_validate=true
  fi
  if elevant_is_web_application_input_path aviam-web "$path"; then aviam_validate=true; fi
  if elevant_is_web_application_input_path public-web "$path"; then public_validate=true; fi
  if elevant_is_web_release_input_path aviam-web "$path"; then aviam_release=true; fi
  if elevant_is_web_release_input_path public-web "$path"; then public_release=true; fi

  case "$path" in
    ops/dokploy/* | database/DevelopmentDB/scripts/deployment/* | \
    database/DevelopmentDB/compose.* | frontend/scripts/deployment/* | \
    scripts/release/* | .github/workflows/ops-config-ci.yml)
      ops_validate=true ;;
    packages/api-client/* | backend/Elevant.Api/* | backend/Elevant.Contracts/* | \
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
