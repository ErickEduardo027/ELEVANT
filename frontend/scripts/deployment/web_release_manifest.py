#!/usr/bin/env python3
"""Generate and validate immutable ELEVANT Development web release manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, NoReturn


SCHEMA_VERSION = 1
ENVIRONMENT = "Development"
DEVELOPMENT_REF = "refs/heads/Development"
APPLICATIONS: dict[str, dict[str, Any]] = {
    "aviam-web": {
        "containerPort": 8080,
        "healthPath": "/healthz",
        "smokePaths": ["/healthz", "/", "/dashboard"],
        "imageName": "elevant-private-web",
    },
    "public-web": {
        "containerPort": 3000,
        "healthPath": "/health",
        "smokePaths": ["/health", "/", "/login"],
        "imageName": "elevant-public-web",
    },
}

SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
SHA256_HEX_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
POSITIVE_INTEGER_RE = re.compile(r"^[1-9][0-9]*$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
RFC3339_UTC_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$"
)


class ManifestError(ValueError):
    """Raised when a web release manifest violates the protocol."""


def _fail(message: str) -> NoReturn:
    raise ManifestError(message)


def _object(value: Any, location: str, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(f"{location} must be an object.")
    actual = set(value)
    if actual != keys:
        _fail(
            f"{location} has an invalid shape; "
            f"missing={sorted(keys - actual)}, unexpected={sorted(actual - keys)}."
        )
    return value


def _string(value: Any, location: str) -> str:
    if not isinstance(value, str) or not value or any(ord(char) < 32 for char in value):
        _fail(f"{location} must be a non-empty string without control characters.")
    return value


def _pattern(value: Any, location: str, pattern: re.Pattern[str]) -> str:
    text = _string(value, location)
    if pattern.fullmatch(text) is None:
        _fail(f"{location} has an invalid value.")
    return text


def _regular_file(path: Path, location: str, maximum: int = 1024 * 1024) -> Path:
    try:
        stat = path.lstat()
    except FileNotFoundError as error:
        raise ManifestError(f"{location} is missing: {path}") from error
    if path.is_symlink() or not path.is_file() or stat.st_size < 1 or stat.st_size > maximum:
        _fail(f"{location} must be a regular non-symlink file between 1 and {maximum} bytes.")
    return path


def _load_json(path: Path, location: str, maximum: int = 1024 * 1024) -> Any:
    file_path = _regular_file(path, location, maximum)
    raw = file_path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        _fail(f"{location} must not contain a UTF-8 BOM.")
    try:
        return json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ManifestError(f"{location} must be valid UTF-8 JSON.") from error


def _timestamp(value: Any, location: str = "publishedAt") -> str:
    text = _string(value, location)
    if RFC3339_UTC_RE.fullmatch(text) is None:
        _fail(f"{location} must be a UTC RFC 3339 timestamp ending in Z.")
    try:
        parsed = datetime.fromisoformat(text.removesuffix("Z") + "+00:00")
    except ValueError as error:
        raise ManifestError(f"{location} must be a valid timestamp.") from error
    if parsed.utcoffset() is None or parsed.utcoffset().total_seconds() != 0:
        _fail(f"{location} must be UTC.")
    return text


def _source(value: Any, location: str = "source") -> dict[str, Any]:
    source = _object(
        value,
        location,
        {"repository", "ref", "commit", "runId", "runAttempt", "workflowUrl"},
    )
    repository = _pattern(source["repository"], f"{location}.repository", REPOSITORY_RE)
    if source["ref"] != DEVELOPMENT_REF:
        _fail(f"{location}.ref must be exactly {DEVELOPMENT_REF}.")
    _pattern(source["commit"], f"{location}.commit", COMMIT_RE)
    run_id = _pattern(source["runId"], f"{location}.runId", POSITIVE_INTEGER_RE)
    if type(source["runAttempt"]) is not int or source["runAttempt"] < 1:
        _fail(f"{location}.runAttempt must be a positive integer.")
    expected_url = f"https://github.com/{repository}/actions/runs/{run_id}"
    if source["workflowUrl"] != expected_url:
        _fail(f"{location}.workflowUrl must be exactly {expected_url}.")
    return source


def _digest_reference(value: Any, location: str, repository: str) -> str:
    reference = _string(value, location)
    prefix = f"{repository}@"
    if not reference.startswith(prefix):
        _fail(f"{location} must reference {repository} by digest.")
    _pattern(reference.removeprefix(prefix), f"{location} digest", SHA256_RE)
    return reference


def _canonical_json_sha256(document: Any) -> str:
    payload = json.dumps(
        document,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _configuration_sha256(configuration_file: Path) -> str:
    document = _load_json(configuration_file, "build configuration", 64 * 1024)
    if not isinstance(document, dict) or not document:
        _fail("build configuration must be a non-empty JSON object.")
    return _canonical_json_sha256(document)


def _openapi_sha256(openapi_file: Path, openapi_tool: Path) -> str:
    document = _load_json(openapi_file, "OpenAPI document", 4 * 1024 * 1024)
    if not isinstance(document, dict):
        _fail("OpenAPI document must be a JSON object.")
    tool = _regular_file(openapi_tool, "OpenAPI fingerprint tool", 256 * 1024)
    try:
        completed = subprocess.run(
            ["node", str(tool), "hash", "--file", str(openapi_file)],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ManifestError("OpenAPI fingerprint tool could not be executed.") from error
    digest = completed.stdout.strip()
    if completed.returncode != 0 or SHA256_RE.fullmatch(digest) is None:
        detail = completed.stderr.strip()
        suffix = f" ({detail})" if detail else ""
        _fail(f"OpenAPI fingerprint tool failed{suffix}.")
    return digest


def _api_provenance(
    *,
    api_manifest: Any,
    api_manifest_reference: str,
    api_client_source: Any,
    openapi_sha256: str,
    actual_openapi_sha256: str,
    repository: str,
) -> dict[str, str]:
    manifest = _object(
        api_manifest,
        "API manifest",
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
    if type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != 1:
        _fail("API manifest schemaVersion must be the integer 1.")
    if manifest["environment"] != ENVIRONMENT:
        _fail("API manifest environment must be exactly Development.")
    _timestamp(manifest["publishedAt"], "API manifest publishedAt")
    api_source = _source(manifest["source"], "API manifest source")
    if api_source["repository"] != repository:
        _fail("API manifest source.repository must match the web repository.")

    owner = repository.split("/", maxsplit=1)[0].lower()
    required_manifest = _digest_reference(
        api_manifest_reference,
        "API immutable manifest reference",
        f"ghcr.io/{owner}/elevant-api-release-manifest",
    )
    images = _object(manifest["images"], "API manifest images", {"api"})
    api_image = _digest_reference(
        images["api"], "API manifest images.api", f"ghcr.io/{owner}/elevant-api"
    )
    endpoints = _object(
        manifest["endpoints"],
        "API manifest endpoints",
        {"containerPort", "livenessPath", "readinessPath", "pingPath", "swaggerPath"},
    )

    client_source = _object(
        api_client_source,
        "API client source",
        {"schemaVersion", "openApiSha256", "swaggerPath"},
    )
    if (
        type(client_source["schemaVersion"]) is not int
        or client_source["schemaVersion"] != 1
    ):
        _fail("API client schemaVersion must be the integer 1.")
    client_openapi_sha256 = _pattern(
        client_source["openApiSha256"],
        "API client openApiSha256",
        SHA256_RE,
    )
    if client_source["swaggerPath"] != "/swagger/v1/swagger.json":
        _fail("API client swaggerPath must be /swagger/v1/swagger.json.")
    if client_source["swaggerPath"] != endpoints["swaggerPath"]:
        _fail("API client swaggerPath does not match the required API release.")
    _pattern(openapi_sha256, "OpenAPI fingerprint", SHA256_RE)
    _pattern(actual_openapi_sha256, "calculated OpenAPI fingerprint", SHA256_RE)
    if client_openapi_sha256 != openapi_sha256:
        _fail("API client OpenAPI fingerprint does not match the required API release.")
    if openapi_sha256 != actual_openapi_sha256:
        _fail("OpenAPI fingerprint does not match the selected document.")

    return {
        "requiredManifest": required_manifest,
        "requiredRunId": api_source["runId"],
        "requiredImage": api_image,
        "openApiSha256": openapi_sha256,
    }


def validate_manifest(
    document: Any,
    *,
    application: str,
    repository_root: Path | None = None,
    compose: Path | None = None,
    configuration_file: Path | None = None,
) -> dict[str, Any]:
    if application not in APPLICATIONS:
        _fail(f"application must be one of {sorted(APPLICATIONS)}.")
    manifest = _object(
        document,
        "manifest",
        {
            "schemaVersion",
            "environment",
            "application",
            "source",
            "images",
            "compose",
            "api",
            "build",
            "endpoints",
            "publishedAt",
        },
    )
    if type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != 1:
        _fail("schemaVersion must be the integer 1.")
    if manifest["environment"] != ENVIRONMENT:
        _fail("environment must be exactly Development.")
    if manifest["application"] != application:
        _fail("application does not match the selected release.")
    _timestamp(manifest["publishedAt"])

    source = _source(manifest["source"])
    owner = source["repository"].split("/", maxsplit=1)[0].lower()
    app = APPLICATIONS[application]
    images = _object(manifest["images"], "images", {"web"})
    _digest_reference(
        images["web"], "images.web", f"ghcr.io/{owner}/{app['imageName']}"
    )

    compose_section = _object(manifest["compose"], "compose", {"webSha256"})
    _pattern(compose_section["webSha256"], "compose.webSha256", SHA256_HEX_RE)
    api = _object(
        manifest["api"],
        "api",
        {"requiredManifest", "requiredRunId", "requiredImage", "openApiSha256"},
    )
    _digest_reference(
        api["requiredManifest"],
        "api.requiredManifest",
        f"ghcr.io/{owner}/elevant-api-release-manifest",
    )
    _pattern(api["requiredRunId"], "api.requiredRunId", POSITIVE_INTEGER_RE)
    _digest_reference(
        api["requiredImage"], "api.requiredImage", f"ghcr.io/{owner}/elevant-api"
    )
    _pattern(api["openApiSha256"], "api.openApiSha256", SHA256_RE)
    build = _object(manifest["build"], "build", {"configurationSha256"})
    _pattern(build["configurationSha256"], "build.configurationSha256", SHA256_RE)

    endpoints = _object(
        manifest["endpoints"], "endpoints", {"containerPort", "healthPath", "smokePaths"}
    )
    expected_endpoints = {
        "containerPort": app["containerPort"],
        "healthPath": app["healthPath"],
        "smokePaths": app["smokePaths"],
    }
    if endpoints != expected_endpoints:
        _fail(f"endpoints must be exactly {expected_endpoints}.")

    if repository_root is not None:
        if compose is None:
            _fail("compose path is required with repository root.")
        root = repository_root.resolve()
        if not root.is_dir():
            _fail(f"repository root is not a directory: {root}")
        compose_path = compose.resolve() if compose.is_absolute() else (root / compose).resolve()
        try:
            compose_path.relative_to(root)
        except ValueError as error:
            raise ManifestError("Compose path must stay inside the repository root.") from error
        raw = _regular_file(compose_path, "web Compose").read_bytes()
        if hashlib.sha256(raw).hexdigest() != compose_section["webSha256"]:
            _fail("web Compose fingerprint does not match checked-out source.")
    if configuration_file is not None:
        if _configuration_sha256(configuration_file) != build["configurationSha256"]:
            _fail("build configuration fingerprint does not match.")
    return manifest


def generate_manifest(
    *,
    repository_root: Path,
    compose: Path,
    application: str,
    api_manifest: dict[str, Any],
    api_manifest_reference: str,
    api_client_source: dict[str, Any],
    openapi_file: Path,
    openapi_tool: Path,
    openapi_sha256: str,
    configuration_file: Path,
    repository: str,
    ref: str,
    commit: str,
    run_id: str,
    run_attempt: int,
    web_image: str,
    published_at: str | None = None,
) -> dict[str, Any]:
    if application not in APPLICATIONS:
        _fail(f"application must be one of {sorted(APPLICATIONS)}.")
    _pattern(repository, "repository", REPOSITORY_RE)
    if ref != DEVELOPMENT_REF:
        _fail(f"ref must be exactly {DEVELOPMENT_REF}.")
    _pattern(commit, "commit", COMMIT_RE)
    _pattern(run_id, "run ID", POSITIVE_INTEGER_RE)
    if type(run_attempt) is not int or run_attempt < 1:
        _fail("run attempt must be a positive integer.")
    owner = repository.split("/", maxsplit=1)[0].lower()
    app = APPLICATIONS[application]
    _digest_reference(web_image, "web image", f"ghcr.io/{owner}/{app['imageName']}")

    root = repository_root.resolve()
    compose_path = compose.resolve() if compose.is_absolute() else (root / compose).resolve()
    try:
        compose_path.relative_to(root)
    except ValueError as error:
        raise ManifestError("Compose path must stay inside the repository root.") from error
    compose_sha = hashlib.sha256(_regular_file(compose_path, "web Compose").read_bytes()).hexdigest()
    api = _api_provenance(
        api_manifest=api_manifest,
        api_manifest_reference=api_manifest_reference,
        api_client_source=api_client_source,
        openapi_sha256=openapi_sha256,
        actual_openapi_sha256=_openapi_sha256(openapi_file, openapi_tool),
        repository=repository,
    )
    timestamp = published_at or datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    document: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "environment": ENVIRONMENT,
        "application": application,
        "source": {
            "repository": repository,
            "ref": ref,
            "commit": commit,
            "runId": run_id,
            "runAttempt": run_attempt,
            "workflowUrl": f"https://github.com/{repository}/actions/runs/{run_id}",
        },
        "images": {"web": web_image},
        "compose": {"webSha256": compose_sha},
        "api": api,
        "build": {"configurationSha256": _configuration_sha256(configuration_file)},
        "endpoints": {
            "containerPort": app["containerPort"],
            "healthPath": app["healthPath"],
            "smokePaths": app["smokePaths"],
        },
        "publishedAt": timestamp,
    }
    validate_manifest(
        document,
        application=application,
        repository_root=root,
        compose=compose_path,
        configuration_file=configuration_file,
    )
    return document


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    generate = subparsers.add_parser("generate")
    generate.add_argument("--repository-root", type=Path, required=True)
    generate.add_argument("--compose", type=Path, required=True)
    generate.add_argument("--application", choices=sorted(APPLICATIONS), required=True)
    generate.add_argument("--api-manifest", type=Path, required=True)
    generate.add_argument("--api-manifest-reference", required=True)
    generate.add_argument("--api-client-source", type=Path, required=True)
    generate.add_argument("--openapi", type=Path, required=True)
    generate.add_argument("--openapi-tool", type=Path, required=True)
    generate.add_argument("--openapi-sha256", required=True)
    generate.add_argument("--configuration-file", type=Path, required=True)
    generate.add_argument("--repository", required=True)
    generate.add_argument("--ref", required=True)
    generate.add_argument("--commit", required=True)
    generate.add_argument("--run-id", required=True)
    generate.add_argument("--run-attempt", type=int, required=True)
    generate.add_argument("--web-image", required=True)
    generate.add_argument("--published-at")
    generate.add_argument("--output", type=Path, required=True)

    validate = subparsers.add_parser("validate")
    validate.add_argument("--manifest", type=Path, required=True)
    validate.add_argument("--application", choices=sorted(APPLICATIONS), required=True)
    validate.add_argument("--repository-root", type=Path)
    validate.add_argument("--compose", type=Path)
    validate.add_argument("--configuration-file", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "generate":
            document = generate_manifest(
                repository_root=args.repository_root,
                compose=args.compose,
                application=args.application,
                api_manifest=_load_json(args.api_manifest, "API manifest"),
                api_manifest_reference=args.api_manifest_reference,
                api_client_source=_load_json(args.api_client_source, "API client source", 64 * 1024),
                openapi_file=args.openapi,
                openapi_tool=args.openapi_tool,
                openapi_sha256=args.openapi_sha256,
                configuration_file=args.configuration_file,
                repository=args.repository,
                ref=args.ref,
                commit=args.commit,
                run_id=args.run_id,
                run_attempt=args.run_attempt,
                web_image=args.web_image,
                published_at=args.published_at,
            )
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(
                json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
                encoding="utf-8",
                newline="\n",
            )
        else:
            document = _load_json(args.manifest, "web manifest")
            validate_manifest(
                document,
                application=args.application,
                repository_root=args.repository_root,
                compose=args.compose,
                configuration_file=args.configuration_file,
            )
        return 0
    except (ManifestError, OSError, ValueError) as error:
        print(f"web-release-manifest: ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
