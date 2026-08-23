#!/usr/bin/env python3
"""Generate and validate the immutable Development database release manifest."""

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
DEVELOPMENT_REF = "refs/heads/Development"
DEVELOPMENT_ENVIRONMENT = "Development"

DATABASE_COMPOSE = Path("infrastructure/docker/compose.development.database.yml")
RELEASE_COMPOSE = Path("infrastructure/docker/compose.development.release.yml")
MIGRATIONS_DIRECTORY = Path("src/Elevant.Infrastructure/Persistence/Migrations")
MODEL_SNAPSHOT = MIGRATIONS_DIRECTORY / "ElevantDbContextModelSnapshot.cs"
DEVELOPMENT_SEED = Path(
    "src/Elevant.Infrastructure/Persistence/Seed/DevelopmentDataSeeder.cs"
)

SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
MIGRATION_ID_RE = re.compile(r"^[0-9]{14}_[A-Za-z0-9_]+$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
RFC3339_UTC_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$"
)


class ManifestError(ValueError):
    """Raised when a release manifest violates the contract."""


def _fail(message: str) -> NoReturn:
    raise ManifestError(message)


def _sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def _sha256_file(path: Path) -> str:
    try:
        return _sha256_bytes(path.read_bytes())
    except FileNotFoundError as error:
        raise ManifestError(f"Required source file is missing: {path}") from error


def _expect_object(value: Any, location: str, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(f"{location} must be an object.")
    actual_keys = set(value)
    if actual_keys != keys:
        missing = sorted(keys - actual_keys)
        unexpected = sorted(actual_keys - keys)
        _fail(
            f"{location} has an invalid shape; missing={missing}, unexpected={unexpected}."
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


def _migration_sources(backend_root: Path) -> tuple[list[str], list[Path]]:
    migrations_root = backend_root / MIGRATIONS_DIRECTORY
    if not migrations_root.is_dir():
        _fail(f"Required migrations directory is missing: {migrations_root}")

    candidate_files = sorted(
        path
        for path in migrations_root.glob("*.cs")
        if not path.name.endswith(".Designer.cs")
        and path.name != MODEL_SNAPSHOT.name
    )
    invalid_files = [
        path.name
        for path in candidate_files
        if MIGRATION_ID_RE.fullmatch(path.stem) is None
    ]
    if invalid_files:
        _fail(f"Unexpected EF migration source names: {invalid_files}")
    migration_files = candidate_files
    migration_ids = [path.stem for path in migration_files]
    if not migration_ids:
        _fail("At least one EF migration is required.")
    if migration_ids != sorted(set(migration_ids)):
        _fail("EF migration identifiers must be unique and lexically ordered.")

    source_files: list[Path] = []
    for migration_file in migration_files:
        designer_file = migration_file.with_name(f"{migration_file.stem}.Designer.cs")
        if not designer_file.is_file():
            _fail(f"Migration designer is missing: {designer_file}")
        source_files.extend((migration_file, designer_file))

    return migration_ids, source_files


def _migration_fingerprint(backend_root: Path, source_files: list[Path]) -> str:
    digest = hashlib.sha256()
    for source_file in source_files:
        relative_path = source_file.relative_to(backend_root).as_posix().encode("utf-8")
        digest.update(relative_path)
        digest.update(b"\0")
        digest.update(source_file.read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def _source_fingerprints(backend_root: Path) -> dict[str, Any]:
    migration_chain, migration_sources = _migration_sources(backend_root)
    return {
        "compose": {
            "databaseSha256": _sha256_file(
                backend_root / DATABASE_COMPOSE
            ).removeprefix("sha256:"),
            "releaseSha256": _sha256_file(
                backend_root / RELEASE_COMPOSE
            ).removeprefix("sha256:"),
        },
        "database": {
            "migrationIds": migration_chain,
            "migrationFingerprint": _migration_fingerprint(
                backend_root, migration_sources
            ),
            "modelFingerprint": _sha256_file(backend_root / MODEL_SNAPSHOT),
            "seedFingerprint": _sha256_file(backend_root / DEVELOPMENT_SEED),
        },
    }


def _validate_timestamp(value: Any) -> str:
    timestamp = _expect_string(value, "publishedAt")
    if RFC3339_UTC_RE.fullmatch(timestamp) is None:
        _fail("publishedAt must be a UTC RFC 3339 timestamp ending in Z.")
    try:
        parsed = datetime.fromisoformat(timestamp.removesuffix("Z") + "+00:00")
    except ValueError as error:
        raise ManifestError("publishedAt is not a valid RFC 3339 timestamp.") from error
    if parsed.utcoffset() is None or parsed.utcoffset().total_seconds() != 0:
        _fail("publishedAt must be UTC.")
    return timestamp


def _validate_image_reference(value: Any, location: str, expected_repository: str) -> str:
    reference = _expect_string(value, location)
    prefix = f"{expected_repository}@"
    if not reference.startswith(prefix):
        _fail(f"{location} must reference {expected_repository} by digest.")
    digest = reference.removeprefix(prefix)
    _expect_pattern(digest, f"{location} digest", SHA256_RE)
    return reference


def validate_manifest(document: Any, backend_root: Path | None = None) -> dict[str, Any]:
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
        },
    )

    if type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != SCHEMA_VERSION:
        _fail(f"schemaVersion must be the integer {SCHEMA_VERSION}.")
    if manifest["environment"] != DEVELOPMENT_ENVIRONMENT:
        _fail(f"environment must be exactly {DEVELOPMENT_ENVIRONMENT}.")
    _validate_timestamp(manifest["publishedAt"])

    source = _expect_object(
        manifest["source"],
        "source",
        {"repository", "ref", "commit", "runId", "runAttempt", "workflowUrl"},
    )
    repository = _expect_pattern(source["repository"], "source.repository", REPOSITORY_RE)
    if source["ref"] != DEVELOPMENT_REF:
        _fail(f"source.ref must be exactly {DEVELOPMENT_REF}.")
    _expect_pattern(source["commit"], "source.commit", COMMIT_RE)

    run_id = _expect_pattern(
        source["runId"], "source.runId", re.compile(r"^[1-9][0-9]*$")
    )
    if type(source["runAttempt"]) is not int or source["runAttempt"] < 1:
        _fail("source.runAttempt must be a positive integer.")
    expected_run_url = f"https://github.com/{repository}/actions/runs/{run_id}"
    if source["workflowUrl"] != expected_run_url:
        _fail(f"source.workflowUrl must be exactly {expected_run_url}.")

    owner = repository.split("/", maxsplit=1)[0].lower()
    images = _expect_object(manifest["images"], "images", {"ops", "release"})
    _validate_image_reference(
        images["ops"], "images.ops", f"ghcr.io/{owner}/elevant-db-ops"
    )
    _validate_image_reference(
        images["release"], "images.release", f"ghcr.io/{owner}/elevant-db-release"
    )

    compose = _expect_object(
        manifest["compose"], "compose", {"databaseSha256", "releaseSha256"}
    )
    for fingerprint_name in ("databaseSha256", "releaseSha256"):
        _expect_pattern(
            compose[fingerprint_name], f"compose.{fingerprint_name}", SHA256_HEX_RE
        )

    database = _expect_object(
        manifest["database"],
        "database",
        {
            "migrationIds",
            "migrationFingerprint",
            "modelFingerprint",
            "seedFingerprint",
        },
    )
    migration_chain = database["migrationIds"]
    if not isinstance(migration_chain, list) or not migration_chain:
        _fail("database.migrationIds must be a non-empty array.")
    for index, migration_id in enumerate(migration_chain):
        _expect_pattern(
            migration_id, f"database.migrationIds[{index}]", MIGRATION_ID_RE
        )
    if migration_chain != sorted(set(migration_chain)):
        _fail("database.migrationIds must be unique and lexically ordered.")
    for fingerprint_name in (
        "migrationFingerprint",
        "modelFingerprint",
        "seedFingerprint",
    ):
        _expect_pattern(
            database[fingerprint_name], f"database.{fingerprint_name}", SHA256_RE
        )

    if backend_root is not None:
        expected = _source_fingerprints(backend_root.resolve())
        if manifest["compose"] != expected["compose"]:
            _fail("Compose fingerprints do not match the checked-out source.")
        if manifest["database"] != expected["database"]:
            _fail("Database fingerprints do not match the checked-out source.")

    return manifest


def generate_manifest(
    *,
    backend_root: Path,
    repository: str,
    ref: str,
    commit: str,
    run_id: str,
    run_attempt: int,
    operations_image: str,
    release_image: str,
    published_at: str | None = None,
) -> dict[str, Any]:
    fingerprints = _source_fingerprints(backend_root.resolve())
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
        "images": {
            "ops": operations_image,
            "release": release_image,
        },
        **fingerprints,
    }
    return validate_manifest(document, backend_root)


def _read_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as stream:
            return json.load(stream)
    except FileNotFoundError as error:
        raise ManifestError(f"Manifest is missing: {path}") from error
    except json.JSONDecodeError as error:
        raise ManifestError(f"Manifest is not valid JSON: {error}") from error


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
    generate.add_argument("--backend-root", type=Path, required=True)
    generate.add_argument("--repository", required=True)
    generate.add_argument("--ref", required=True)
    generate.add_argument("--commit", required=True)
    generate.add_argument("--run-id", required=True)
    generate.add_argument("--run-attempt", type=int, required=True)
    generate.add_argument("--operations-image", required=True)
    generate.add_argument("--release-image", required=True)
    generate.add_argument("--published-at")
    generate.add_argument("--output", type=Path, required=True)

    validate = subparsers.add_parser("validate", help="Validate an existing manifest.")
    validate.add_argument("--manifest", type=Path, required=True)
    validate.add_argument(
        "--backend-root",
        type=Path,
        help="Also require all source fingerprints to match this backend checkout.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "generate":
            document = generate_manifest(
                backend_root=arguments.backend_root,
                repository=arguments.repository,
                ref=arguments.ref,
                commit=arguments.commit,
                run_id=arguments.run_id,
                run_attempt=arguments.run_attempt,
                operations_image=arguments.operations_image,
                release_image=arguments.release_image,
                published_at=arguments.published_at,
            )
            _write_json(arguments.output, document)
            print(f"Generated validated database release manifest: {arguments.output}")
        else:
            validate_manifest(
                _read_json(arguments.manifest),
                arguments.backend_root.resolve() if arguments.backend_root else None,
            )
            print(f"Database release manifest is valid: {arguments.manifest}")
    except ManifestError as error:
        print(f"database-release-manifest: ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
