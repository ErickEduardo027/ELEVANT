#!/usr/bin/env python3
"""Generate and validate the immutable Development database release manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
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


@dataclass(frozen=True)
class ManifestSourcePaths:
    """Source locations, relative to the selected checkout root by default."""

    database_compose: Path = DATABASE_COMPOSE
    release_compose: Path = RELEASE_COMPOSE
    migrations_directory: Path = MIGRATIONS_DIRECTORY
    model_snapshot: Path = MODEL_SNAPSHOT
    development_seed: Path = DEVELOPMENT_SEED


@dataclass(frozen=True)
class _ResolvedSourcePaths:
    database_compose: Path
    release_compose: Path
    migrations_directory: Path
    model_snapshot: Path
    development_seed: Path


def _fail(message: str) -> NoReturn:
    raise ManifestError(message)


def _sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def _sha256_file(path: Path) -> str:
    try:
        return _sha256_bytes(path.read_bytes())
    except FileNotFoundError as error:
        raise ManifestError(f"Required source file is missing: {path}") from error


def _select_source_root(
    backend_root: Path | None,
    repository_root: Path | None,
) -> Path:
    if backend_root is not None and repository_root is not None:
        _fail("Specify exactly one source root: backend_root or repository_root.")
    selected_root = repository_root if repository_root is not None else backend_root
    if selected_root is None:
        _fail("A source root is required to fingerprint checked-out sources.")
    resolved_root = selected_root.resolve()
    if not resolved_root.is_dir():
        _fail(f"Source root is missing or is not a directory: {resolved_root}")
    return resolved_root


def _resolve_within_source_root(
    source_root: Path,
    configured_path: Path,
    location: str,
) -> Path:
    candidate = (
        configured_path.resolve()
        if configured_path.is_absolute()
        else (source_root / configured_path).resolve()
    )
    try:
        candidate.relative_to(source_root)
    except ValueError as error:
        raise ManifestError(
            f"{location} must stay within the selected source root: {configured_path}"
        ) from error
    return candidate


def _resolve_source_paths(
    source_root: Path,
    source_paths: ManifestSourcePaths,
) -> _ResolvedSourcePaths:
    resolved = _ResolvedSourcePaths(
        database_compose=_resolve_within_source_root(
            source_root, source_paths.database_compose, "database compose path"
        ),
        release_compose=_resolve_within_source_root(
            source_root, source_paths.release_compose, "release compose path"
        ),
        migrations_directory=_resolve_within_source_root(
            source_root, source_paths.migrations_directory, "migrations directory"
        ),
        model_snapshot=_resolve_within_source_root(
            source_root, source_paths.model_snapshot, "model snapshot path"
        ),
        development_seed=_resolve_within_source_root(
            source_root, source_paths.development_seed, "Development seed path"
        ),
    )

    file_locations = {
        "database compose path": resolved.database_compose,
        "release compose path": resolved.release_compose,
        "model snapshot path": resolved.model_snapshot,
        "Development seed path": resolved.development_seed,
    }
    if len(set(file_locations.values())) != len(file_locations):
        _fail("Logical manifest sources must resolve to distinct files.")
    if not resolved.migrations_directory.is_dir():
        _fail(
            "Required migrations directory is missing: "
            f"{resolved.migrations_directory}"
        )
    if resolved.model_snapshot.parent != resolved.migrations_directory:
        _fail("The model snapshot must be a direct child of the migrations directory.")
    if resolved.development_seed.parent == resolved.migrations_directory:
        _fail("The Development seed must not be stored in the migrations directory.")
    return resolved


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


def _migration_sources(
    source_root: Path,
    migrations_root: Path,
    model_snapshot: Path,
) -> tuple[list[str], list[Path]]:
    candidate_files = sorted(
        path
        for path in migrations_root.glob("*.cs")
        if not path.name.endswith(".Designer.cs")
        and path.resolve() != model_snapshot
    )
    for source_file in candidate_files:
        _resolve_within_source_root(
            source_root,
            source_file,
            f"migration source {source_file.name}",
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


def _migration_fingerprint(source_files: list[Path]) -> str:
    digest = hashlib.sha256()
    for source_file in source_files:
        # Keep the historical logical label so moving an unchanged migration chain
        # from the legacy backend layout to the split database layout is fingerprint
        # neutral. Physical source paths are deliberately not part of schema v1.
        logical_path = (MIGRATIONS_DIRECTORY / source_file.name).as_posix()
        digest.update(logical_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(source_file.read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def _source_fingerprints(
    source_root: Path,
    source_paths: ManifestSourcePaths,
) -> dict[str, Any]:
    resolved = _resolve_source_paths(source_root, source_paths)
    migration_chain, migration_sources = _migration_sources(
        source_root,
        resolved.migrations_directory,
        resolved.model_snapshot,
    )
    return {
        "compose": {
            "databaseSha256": _sha256_file(
                resolved.database_compose
            ).removeprefix("sha256:"),
            "releaseSha256": _sha256_file(
                resolved.release_compose
            ).removeprefix("sha256:"),
        },
        "database": {
            "migrationIds": migration_chain,
            "migrationFingerprint": _migration_fingerprint(migration_sources),
            "modelFingerprint": _sha256_file(resolved.model_snapshot),
            "seedFingerprint": _sha256_file(resolved.development_seed),
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


def validate_manifest(
    document: Any,
    backend_root: Path | None = None,
    *,
    repository_root: Path | None = None,
    source_paths: ManifestSourcePaths | None = None,
) -> dict[str, Any]:
    if repository_root is not None and source_paths is None:
        _fail("repository_root requires explicit manifest source paths.")
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

    if backend_root is not None or repository_root is not None:
        source_root = _select_source_root(backend_root, repository_root)
        expected = _source_fingerprints(
            source_root,
            source_paths or ManifestSourcePaths(),
        )
        if manifest["compose"] != expected["compose"]:
            _fail("Compose fingerprints do not match the checked-out source.")
        if manifest["database"] != expected["database"]:
            _fail("Database fingerprints do not match the checked-out source.")

    return manifest


def generate_manifest(
    *,
    backend_root: Path | None = None,
    repository_root: Path | None = None,
    source_paths: ManifestSourcePaths | None = None,
    repository: str,
    ref: str,
    commit: str,
    run_id: str,
    run_attempt: int,
    operations_image: str,
    release_image: str,
    published_at: str | None = None,
) -> dict[str, Any]:
    if repository_root is not None and source_paths is None:
        _fail("repository_root requires explicit manifest source paths.")
    source_root = _select_source_root(backend_root, repository_root)
    selected_source_paths = source_paths or ManifestSourcePaths()
    fingerprints = _source_fingerprints(source_root, selected_source_paths)
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
    return validate_manifest(
        document,
        repository_root=source_root,
        source_paths=selected_source_paths,
    )


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


def _add_source_path_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--database-compose",
        type=Path,
        help=f"Database Compose path relative to the selected root (default: {DATABASE_COMPOSE}).",
    )
    parser.add_argument(
        "--release-compose",
        type=Path,
        help=f"Release Compose path relative to the selected root (default: {RELEASE_COMPOSE}).",
    )
    parser.add_argument(
        "--migrations-directory",
        type=Path,
        help=(
            "EF migrations directory relative to the selected root "
            f"(default: {MIGRATIONS_DIRECTORY})."
        ),
    )
    parser.add_argument(
        "--model-snapshot",
        type=Path,
        help=(
            "EF model snapshot relative to the selected root. When only the "
            "migrations directory is overridden, defaults to the standard snapshot "
            "filename inside that directory."
        ),
    )
    parser.add_argument(
        "--development-seed",
        type=Path,
        help=f"Development seed path relative to the selected root (default: {DEVELOPMENT_SEED}).",
    )


def _source_paths_from_arguments(arguments: argparse.Namespace) -> ManifestSourcePaths:
    migrations_directory = arguments.migrations_directory or MIGRATIONS_DIRECTORY
    if arguments.model_snapshot is not None:
        model_snapshot = arguments.model_snapshot
    elif arguments.migrations_directory is not None:
        model_snapshot = migrations_directory / MODEL_SNAPSHOT.name
    else:
        model_snapshot = MODEL_SNAPSHOT
    return ManifestSourcePaths(
        database_compose=arguments.database_compose or DATABASE_COMPOSE,
        release_compose=arguments.release_compose or RELEASE_COMPOSE,
        migrations_directory=migrations_directory,
        model_snapshot=model_snapshot,
        development_seed=arguments.development_seed or DEVELOPMENT_SEED,
    )


def _require_complete_repository_layout(arguments: argparse.Namespace) -> None:
    if arguments.repository_root is None:
        return
    required_paths = {
        "--database-compose": arguments.database_compose,
        "--release-compose": arguments.release_compose,
        "--migrations-directory": arguments.migrations_directory,
        "--model-snapshot": arguments.model_snapshot,
        "--development-seed": arguments.development_seed,
    }
    missing = [flag for flag, value in required_paths.items() if value is None]
    if missing:
        _fail(
            "--repository-root requires a complete explicit source layout; "
            f"missing={missing}."
        )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate = subparsers.add_parser("generate", help="Generate a validated manifest.")
    generate_root = generate.add_mutually_exclusive_group(required=True)
    generate_root.add_argument(
        "--backend-root",
        type=Path,
        help="Legacy backend checkout root.",
    )
    generate_root.add_argument(
        "--repository-root",
        type=Path,
        help="Repository root for an explicitly configured split layout.",
    )
    _add_source_path_arguments(generate)
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
    validate_root = validate.add_mutually_exclusive_group()
    validate_root.add_argument(
        "--backend-root",
        type=Path,
        help="Also require all source fingerprints to match this backend checkout.",
    )
    validate_root.add_argument(
        "--repository-root",
        type=Path,
        help="Also require fingerprints to match an explicitly configured repository checkout.",
    )
    _add_source_path_arguments(validate)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    arguments = parser.parse_args(argv)
    try:
        _require_complete_repository_layout(arguments)
        source_paths = _source_paths_from_arguments(arguments)
        if arguments.command == "generate":
            document = generate_manifest(
                backend_root=arguments.backend_root,
                repository_root=arguments.repository_root,
                source_paths=source_paths,
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
            if (
                arguments.backend_root is None
                and arguments.repository_root is None
                and source_paths != ManifestSourcePaths()
            ):
                _fail(
                    "Explicit source paths require --backend-root or --repository-root."
                )
            validate_manifest(
                _read_json(arguments.manifest),
                arguments.backend_root,
                repository_root=arguments.repository_root,
                source_paths=source_paths,
            )
            print(f"Database release manifest is valid: {arguments.manifest}")
    except ManifestError as error:
        print(f"database-release-manifest: ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
