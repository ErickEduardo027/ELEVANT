#!/usr/bin/env bash

# Shared predicates for CI release ownership. Keep these functions side-effect
# free: workflows and publication guards source this file under `set -e`.

elevant_is_unrecognized_backend_release_input_path() {
  local path="${1:-}"
  case "$path" in backend/*) ;; *) return 1 ;; esac
  case "$path" in
    *.md | */tests/* | */Tests/* | backend/*Tests/* | backend/*Tests.*/* | \
    backend/Dockerfile | backend/compose.development.api.yml | \
    backend/Elevant.sln | backend/Elevant.Api/* | \
    backend/Elevant.Application/* | backend/Elevant.Contracts/* | \
    backend/Elevant.Domain/* | backend/Elevant.Infrastructure/* | \
    backend/scripts/deployment/* | backend/scripts/restore-build-test.ps1)
      return 1 ;;
  esac
  return 0
}

elevant_is_unrecognized_database_release_input_path() {
  local path="${1:-}"
  case "$path" in database/DevelopmentDB/*) ;; *) return 1 ;; esac
  case "$path" in
    *.md | */tests/* | */Tests/* | */.gitkeep | \
    database/DevelopmentDB/.dockerignore | \
    database/DevelopmentDB/.env.example | \
    database/DevelopmentDB/.team-access.env.example | \
    database/DevelopmentDB/Dockerfile.* | \
    database/DevelopmentDB/compose.*.yml | \
    database/DevelopmentDB/Elevant.DatabaseTool/* | \
    database/DevelopmentDB/Elevant.Persistence/* | \
    database/DevelopmentDB/scripts/*)
      return 1 ;;
  esac
  return 0
}

elevant_is_api_build_input_path() {
  local path="${1:-}"
  case "$path" in
    *.md | */tests/* | */Tests/* | \
    backend/scripts/deployment/guard-api-publication.sh) return 1 ;;
  esac
  case "$path" in
    .dockerignore | \
    Directory.Build.props | \
    Directory.Packages.props | \
    NuGet.config | \
    dotnet-tools.json | \
    global.json | \
    backend/Dockerfile | \
    backend/compose.development.api.yml | \
    backend/Elevant.sln | \
    backend/Elevant.Api/* | \
    backend/Elevant.Application/* | \
    backend/Elevant.Contracts/* | \
    backend/Elevant.Domain/* | \
    backend/Elevant.Infrastructure/* | \
    backend/scripts/deployment/* | \
    packages/api-client/openapi/elevant-v1.json | \
    database/DevelopmentDB/Elevant.Persistence/*)
      return 0
      ;;
    *)
      elevant_is_unrecognized_backend_release_input_path "$path" ||
        elevant_is_unrecognized_database_release_input_path "$path"
      ;;
  esac
}

elevant_is_database_release_input_path() {
  local path="${1:-}"
  case "$path" in
    .dockerignore | Directory.Build.props | Directory.Packages.props | \
    NuGet.config | dotnet-tools.json | global.json | \
    backend/Elevant.sln | backend/Elevant.Api/* | \
    backend/Elevant.Application/* | backend/Elevant.Contracts/* | \
    backend/Elevant.Domain/* | backend/Elevant.Infrastructure/* | \
    database/DevelopmentDB/*)
      case "$path" in
        *.md | */tests/* | */Tests/* | */.gitkeep) return 1 ;;
      esac
      return 0
      ;;
  esac
  elevant_is_unrecognized_backend_release_input_path "$path" ||
    elevant_is_unrecognized_database_release_input_path "$path"
}

elevant_is_api_release_input_path() {
  elevant_is_api_build_input_path "${1:-}" || return 1
  case "${1:-}" in
    *.md | */tests/* | */Tests/*) return 1 ;;
  esac
  return 0
}

elevant_is_web_release_input_path() {
  local application="${1:-}" path="${2:-}"
  case "$path" in
    frontend/scripts/deployment/guard-web-publication.sh | \
    frontend/scripts/deployment/resolve-api-release.sh) return 1 ;;
  esac
  if elevant_is_api_release_input_path "$path"; then
    return 0
  fi
  case "$path" in
    packages/api-client/* | frontend/scripts/deployment/*)
      case "$path" in *.md | */tests/* | */Tests/* | packages/api-client/scripts/*) return 1 ;; esac
      return 0
      ;;
  esac
  if elevant_is_web_application_input_path "$application" "$path"; then
    case "$path" in *.md | */tests/* | */Tests/*) return 1 ;; esac
    return 0
  fi
  return 1
}

elevant_is_api_publication_superseding_path() {
  local path="${1:-}"
  if elevant_is_api_release_input_path "$path"; then
    return 0
  fi
  elevant_is_database_release_input_path "$path"
}

elevant_is_web_shared_input_path() {
  local path="${1:-}"
  if elevant_is_api_build_input_path "$path"; then
    return 0
  fi
  case "$path" in
    .github/workflows/web-ci.yml | \
    ops/dokploy/web-cd/openapi-tool.mjs | \
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
