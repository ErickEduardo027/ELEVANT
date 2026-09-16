#!/usr/bin/env bash

# Shared predicates for CI release ownership. Keep these functions side-effect
# free: workflows and publication guards source this file under `set -e`.

elevant_is_api_build_input_path() {
  local path="${1:-}"
  case "$path" in
    .github/workflows/backend-ci.yml | \
    .dockerignore | \
    Directory.Build.props | \
    Directory.Packages.props | \
    NuGet.config | \
    dotnet-tools.json | \
    global.json | \
    scripts/release/path-ownership.sh | \
    backend/Dockerfile | \
    backend/compose.development.api.yml | \
    backend/Elevant.sln | \
    backend/Elevant.Api/* | \
    backend/Elevant.Application/* | \
    backend/Elevant.Contracts/* | \
    backend/Elevant.Domain/* | \
    backend/Elevant.Infrastructure/* | \
    backend/scripts/deployment/* | \
    ops/dokploy/web-cd/openapi-tool.mjs | \
    packages/api-client/openapi/elevant-v1.json | \
    database/DevelopmentDB/Elevant.Persistence/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

elevant_is_api_publication_superseding_path() {
  local path="${1:-}"
  if elevant_is_api_build_input_path "$path"; then
    return 0
  fi
  case "$path" in
    database/DevelopmentDB/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

elevant_is_web_shared_input_path() {
  local path="${1:-}"
  if elevant_is_api_build_input_path "$path"; then
    return 0
  fi
  case "$path" in
    .github/workflows/web-ci.yml | \
    frontend/scripts/deployment/* | \
    frontend/tests/deployment/* | \
    packages/api-client/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

elevant_is_web_application_input_path() {
  local application="${1:-}" path="${2:-}"
  case "$application:$path" in
    aviam-web:frontend/private-web/* | \
    public-web:frontend/public-web/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}
