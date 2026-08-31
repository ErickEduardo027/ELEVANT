#!/usr/bin/env python3
"""Generate and validate immutable ELEVANT Development API release manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, NoReturn


SCHEMA_VERSION = 1
DEVELOPMENT_ENVIRONMENT = "Development"
DEVELOPMENT_REF = "refs/heads/Development"
API_COMPOSE = Path("backend/compose.development.api.yml")

LIVENESS_PATH = "/health"
READINESS_PATH = "/health/ready"
PING_PATH = "/api/v1/system/ping"
SWAGGER_PATH = "/swagger/v1/swagger.json"
CONTAINER_PORT = 8080

SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
POSITIVE_INTEGER_RE = re.compile(r"^[1-9][0-9]*$")
MIGRATION_ID_RE = re.compile(r"^[0-9]{14}_[A-Za-z0-9_]+$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
RFC3339_UTC_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$"
)


class ManifestError(ValueError):
    """Raised when an API release manifest violates the public contract."""


def _fail(message: str) -> NoReturn:
    raise ManifestError(message)


def _expect_object(value: Any, location: str, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(f"{location} must be an object.")
    actual = set(value)
    if actual != keys:
        _fail(
            f"{location} has an invalid shape; "
            f"missing={sorted(keys - actual)}, unexpected={sorted(actual - keys)}."
        )
    return value


def _expect_string(value: Any, location: str) -> str:
    if not isinstance(value, str) or not value:
        _fail(f"{location} must be a non-empty string.")
    return value


def _expect_pattern(value: Any, location: str, pattern: re.Pattern[str]) -> str:
    text = _expect_string(value, location)
    if pattern.fullmatch(text) is None:
        _fail(f"{location} has an invalid value.")
    return text


def _validate_timestamp(value: Any, location: str = "publishedAt") -> str:
    timestamp = _expect_string(value, location)
    if RFC3339_UTC_RE.fullmatch(timestamp) is None:
        _fail(f"{location} must be a UTC RFC 3339 timestamp ending in Z.")
    try:
        parsed = datetime.fromisoformat(timestamp.removesuffix("Z") + "+00:00")
    except ValueError as error:
        raise ManifestError(f"{location} is not a valid RFC 3339 timestamp.") from error
    if parsed.utcoffset() is None or parsed.utcoffset().total_seconds() != 0:
        _fail(f"{location} must be UTC.")
    return timestamp


def _select_source_root(repository_root: Path | None) -> Path:
    if repository_root is None:
        _fail("A repository root is required to fingerprint checked-out sources.")
    root = repository_root.resolve()
    if not root.is_dir():
        _fail(f"Source root is missing or is not a directory: {root}")
    return root


def _resolve_within_root(root: Path, configured_path: Path, location: str) -> Path:
    candidate = (
        configured_path.resolve()
        if configured_path.is_absolute()
        else (root / configured_path).resolve()
    )
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ManifestError(
            f"{location} must stay within the selected source root: {configured_path}"
        ) from error
    if not candidate.is_file():
        _fail(f"Required source file is missing: {candidate}")
    return candidate


def _api_compose_sha256(repository_root: Path, api_compose: Path) -> str:
    compose_path = _resolve_within_root(repository_root, api_compose, "API Compose path")
    return hashlib.sha256(compose_path.read_bytes()).hexdigest()


def _validate_source(value: Any, location: str = "source") -> dict[str, Any]:
    source = _expect_object(
        value,
        location,
        {"repository", "ref", "commit", "runId", "runAttempt", "workflowUrl"},
    )
    repository = _expect_pattern(
        source["repository"], f"{location}.repository", REPOSITORY_RE
    )
    if source["ref"] != DEVELOPMENT_REF:
        _fail(f"{location}.ref must be exactly {DEVELOPMENT_REF}.")
    _expect_pattern(source["commit"], f"{location}.commit", COMMIT_RE)
    run_id = _expect_pattern(
        source["runId"], f"{location}.runId", POSITIVE_INTEGER_RE
    )
    if type(source["runAttempt"]) is not int or source["runAttempt"] < 1:
        _fail(f"{location}.runAttempt must be a positive integer.")
    expected_url = f"https://github.com/{repository}/actions/runs/{run_id}"
    if source["workflowUrl"] != expected_url:
        _fail(f"{location}.workflowUrl must be exactly {expected_url}.")
    return source


def _validate_digest_reference(
    value: Any,
    location: str,
    expected_repository: str,
) -> str:
    reference = _expect_string(value, location)
    prefix = f"{expected_repository}@"
    if not reference.startswith(prefix):
        _fail(f"{location} must reference {expected_repository} by digest.")
    _expect_pattern(reference.removeprefix(prefix), f"{location} digest", SHA256_RE)
    return reference


def _database_provenance(
    document: Any,
    *,
    expected_repository: str,
    immutable_reference: str,
) -> dict[str, str]:
    """Validate the database bundle manifest and select its compatibility proof."""

    database_manifest = _expect_object(
        document,
        "database manifest",
        {
            "schemaVersion",
            "environment",
            "publishedAt",
            "source",
            "images",
            "compose",
            "database",
        },
    )
    if (
        type(database_manifest["schemaVersion"]) is not int
        or database_manifest["schemaVersion"] != 1
    ):
        _fail("database manifest schemaVersion must be the integer 1.")
    if database_manifest["environment"] != DEVELOPMENT_ENVIRONMENT:
        _fail("database manifest environment must be exactly Development.")
    _validate_timestamp(database_manifest["publishedAt"], "database manifest publishedAt")

    source = _validate_source(database_manifest["source"], "database manifest source")
    if source["repository"] != expected_repository:
        _fail("database manifest source.repository must match the API repository.")

    owner = expected_repository.split("/", maxsplit=1)[0].lower()
    _validate_digest_reference(
        immutable_reference,
        "database immutable reference",
        f"ghcr.io/{owner}/elevant-db-release-manifest",
    )

    images = _expect_object(database_manifest["images"], "database manifest images", {"ops", "release"})
    _validate_digest_reference(
        images["ops"],
        "database manifest images.ops",
        f"ghcr.io/{owner}/elevant-db-ops",
    )
    _validate_digest_reference(
        images["release"],
        "database manifest images.release",
        f"ghcr.io/{owner}/elevant-db-release",
    )

    compose = _expect_object(
        database_manifest["compose"],
        "database manifest compose",
        {"databaseSha256", "releaseSha256"},
    )
    for name in ("databaseSha256", "releaseSha256"):
        _expect_pattern(
            compose[name], f"database manifest compose.{name}", SHA256_HEX_RE
        )

    database = _expect_object(
        database_manifest["database"],
        "database manifest database",
        {
            "migrationIds",
            "migrationFingerprint",
            "modelFingerprint",
            "seedFingerprint",
        },
    )
    migration_ids = database["migrationIds"]
    if not isinstance(migration_ids, list) or not migration_ids:
        _fail("database manifest database.migrationIds must be a non-empty array.")
    for index, migration_id in enumerate(migration_ids):
        _expect_pattern(
            migration_id,
            f"database manifest database.migrationIds[{index}]",
            MIGRATION_ID_RE,
        )
    if migration_ids != sorted(set(migration_ids)):
        _fail("database manifest database.migrationIds must be unique and ordered.")
    for name in ("migrationFingerprint", "modelFingerprint", "seedFingerprint"):
        _expect_pattern(
            database[name], f"database manifest database.{name}", SHA256_RE
        )

    return {
        "requiredManifest": immutable_reference,
        "requiredRunId": source["runId"],
        "migrationFingerprint": database["migrationFingerprint"],
        "modelFingerprint": database["modelFingerprint"],
    }


def validate_manifest(
    document: Any,
    *,
    repository_root: Path | None = None,
    api_compose: Path = API_COMPOSE,
) -> dict[str, Any]:
    manifest = _expect_object(
        document,
        "manifest",
        {
            "schemaVersion",
            "environment",
            "publishedAt",
            "source",
            "images",
            "compose",
            "database",
            "endpoints",
        },
    )
    if type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != SCHEMA_VERSION:
        _fail(f"schemaVersion must be the integer {SCHEMA_VERSION}.")
    if manifest["environment"] != DEVELOPMENT_ENVIRONMENT:
        _fail(f"environment must be exactly {DEVELOPMENT_ENVIRONMENT}.")
    _validate_timestamp(manifest["publishedAt"])

    source = _validate_source(manifest["source"])
    owner = source["repository"].split("/", maxsplit=1)[0].lower()

    images = _expect_object(manifest["images"], "images", {"api"})
    _validate_digest_reference(
        images["api"], "images.api", f"ghcr.io/{owner}/elevant-api"
    )

    compose = _expect_object(manifest["compose"], "compose", {"apiSha256"})
    _expect_pattern(compose["apiSha256"], "compose.apiSha256", SHA256_HEX_RE)

    database = _expect_object(
        manifest["database"],
        "database",
        {
            "requiredManifest",
            "requiredRunId",
            "migrationFingerprint",
            "modelFingerprint",
        },
    )
    _validate_digest_reference(
        database["requiredManifest"],
        "database.requiredManifest",
        f"ghcr.io/{owner}/elevant-db-release-manifest",
    )
    _expect_pattern(
        database["requiredRunId"], "database.requiredRunId", POSITIVE_INTEGER_RE
    )
    _expect_pattern(
        database["migrationFingerprint"],
        "database.migrationFingerprint",
        SHA256_RE,
    )
    _expect_pattern(
        database["modelFingerprint"], "database.modelFingerprint", SHA256_RE
    )

    endpoints = _expect_object(
        manifest["endpoints"],
        "endpoints",
        {
            "containerPort",
            "livenessPath",
            "readinessPath",
            "pingPath",
            "swaggerPath",
        },
    )
    expected_endpoints = {
        "containerPort": CONTAINER_PORT,
        "livenessPath": LIVENESS_PATH,
        "readinessPath": READINESS_PATH,
        "pingPath": PING_PATH,
        "swaggerPath": SWAGGER_PATH,
    }
    if endpoints != expected_endpoints:
        _fail(f"endpoints must be exactly {expected_endpoints}.")

    if repository_root is not None:
        root = _select_source_root(repository_root)
        expected_sha = _api_compose_sha256(root, api_compose)
        if compose["apiSha256"] != expected_sha:
            _fail("API Compose fingerprint does not match the checked-out source.")

    return manifest


def generate_manifest(
    *,
    repository_root: Path,
    api_compose: Path = API_COMPOSE,
    database_manifest: dict[str, Any],
    database_manifest_reference: str,
    repository: str,
    ref: str,
    commit: str,
    run_id: str,
    run_attempt: int,
    api_image: str,
    published_at: str | None = None,
) -> dict[str, Any]:
    root = _select_source_root(repository_root)
    database = _database_provenance(
        database_manifest,
        expected_repository=repository,
        immutable_reference=database_manifest_reference,
    )
    document: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "environment": DEVELOPMENT_ENVIRONMENT,
        "publishedAt": published_at
        or datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "source": {
            "repository": repository,
            "ref": ref,
            "commit": commit,
            "runId": run_id,
            "runAttempt": run_attempt,
            "workflowUrl": f"https://github.com/{repository}/actions/runs/{run_id}",
        },
        "images": {"api": api_image},
        "compose": {"apiSha256": _api_compose_sha256(root, api_compose)},
        "database": database,
        "endpoints": {
            "containerPort": CONTAINER_PORT,
            "livenessPath": LIVENESS_PATH,
            "readinessPath": READINESS_PATH,
            "pingPath": PING_PATH,
            "swaggerPath": SWAGGER_PATH,
        },
    }
    return validate_manifest(document, repository_root=root, api_compose=api_compose)


def _read_json(path: Path, location: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as stream:
            return json.load(stream)
    except FileNotFoundError as error:
        raise ManifestError(f"{location} is missing: {path}") from error
    except json.JSONDecodeError as error:
        raise ManifestError(f"{location} is not valid JSON: {error}") from error


def _write_json(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(document, indent=2, sort_keys=True, ensure_ascii=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate = subparsers.add_parser("generate", help="Generate a validated manifest.")
    generate.add_argument("--repository-root", type=Path, required=True)
    generate.add_argument("--api-compose", type=Path, default=API_COMPOSE)
    generate.add_argument("--database-manifest", type=Path, required=True)
    generate.add_argument("--database-manifest-reference", required=True)
    generate.add_argument("--repository", required=True)
    generate.add_argument("--ref", required=True)
    generate.add_argument("--commit", required=True)
    generate.add_argument("--run-id", required=True)
    generate.add_argument("--run-attempt", type=int, required=True)
    generate.add_argument("--api-image", required=True)
    generate.add_argument("--published-at")
    generate.add_argument("--output", type=Path, required=True)

    validate = subparsers.add_parser("validate", help="Validate an existing manifest.")
    validate.add_argument("--manifest", type=Path, required=True)
    validate.add_argument("--repository-root", type=Path)
    validate.add_argument("--api-compose", type=Path, default=API_COMPOSE)
    return parser


def main(arguments: list[str] | None = None) -> int:
    parser = _build_parser()
    parsed = parser.parse_args(arguments)
    try:
        if parsed.command == "generate":
            document = generate_manifest(
                repository_root=parsed.repository_root,
                api_compose=parsed.api_compose,
                database_manifest=_read_json(
                    parsed.database_manifest, "Database manifest"
                ),
                database_manifest_reference=parsed.database_manifest_reference,
                repository=parsed.repository,
                ref=parsed.ref,
                commit=parsed.commit,
                run_id=parsed.run_id,
                run_attempt=parsed.run_attempt,
                api_image=parsed.api_image,
                published_at=parsed.published_at,
            )
            _write_json(parsed.output, document)
            return 0

        validate_manifest(
            _read_json(parsed.manifest, "API manifest"),
            repository_root=parsed.repository_root,
            api_compose=parsed.api_compose,
        )
        return 0
    except ManifestError as error:
        print(f"api_release_manifest: ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
