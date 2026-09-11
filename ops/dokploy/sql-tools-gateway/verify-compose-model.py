#!/usr/bin/env python3
"""Compare the approved SQL gateway Compose with Dokploy's live Raw model."""

from __future__ import annotations

import argparse
import copy
import difflib
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile


PROJECT_NAME = "elevant-dev-sql-tools-gateway"
CONFIG_NAME = "haproxy_config"


class VerificationError(RuntimeError):
    """A fail-closed Compose verification error."""


def require_regular_file(raw_path: str, label: str) -> pathlib.Path:
    path = pathlib.Path(raw_path)
    if path.is_symlink() or not path.is_file():
        raise VerificationError(f"{label} must be a regular non-symlink file")
    return path.resolve()


def render_compose(compose_path: pathlib.Path) -> dict[str, object]:
    command = [
        "docker",
        "compose",
        "--profile",
        "*",
        "-p",
        PROJECT_NAME,
        "-f",
        str(compose_path),
        "config",
        "--format",
        "json",
    ]
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        detail = getattr(error, "stderr", "") or str(error)
        raise VerificationError(f"docker compose config failed: {detail.strip()}") from error

    try:
        model = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise VerificationError("docker compose returned invalid JSON") from error
    if not isinstance(model, dict):
        raise VerificationError("docker compose model must be a JSON object")
    return model


def normalized_model(
    model: dict[str, object],
    compose_path: pathlib.Path,
    config_path: pathlib.Path,
) -> dict[str, object]:
    normalized = copy.deepcopy(model)
    try:
        config = normalized["configs"][CONFIG_NAME]
        rendered_path = pathlib.Path(config["file"])
    except (KeyError, TypeError) as error:
        raise VerificationError("Compose model omitted the HAProxy config file") from error

    if not rendered_path.is_absolute():
        rendered_path = compose_path.parent / rendered_path
    if rendered_path.resolve() != config_path.resolve():
        raise VerificationError("Compose model resolves HAProxy config from an unexpected path")

    digest = hashlib.sha256(config_path.read_bytes()).hexdigest()
    config["file"] = f"sha256:{digest}"
    return normalized


def compare_models(args: argparse.Namespace) -> None:
    approved_compose = require_regular_file(
        args.approved_compose, "approved Compose"
    )
    approved_config = require_regular_file(
        args.approved_config, "approved HAProxy config"
    )
    live_compose = require_regular_file(args.live_compose, "live Compose")
    live_config = require_regular_file(args.live_config, "live HAProxy config")

    if approved_config.read_bytes() != live_config.read_bytes():
        raise VerificationError("live HAProxy config differs from the approved bytes")

    with tempfile.TemporaryDirectory(prefix="elevant-sql-gateway-model-") as temp:
        root = pathlib.Path(temp)
        code = root / "code"
        files = root / "files"
        code.mkdir()
        files.mkdir()
        staged_compose = code / "docker-compose.yml"
        staged_config = files / "haproxy.cfg"
        shutil.copy2(approved_compose, staged_compose)
        shutil.copy2(approved_config, staged_config)

        approved_model = normalized_model(
            render_compose(staged_compose), staged_compose, staged_config
        )

    live_model = normalized_model(
        render_compose(live_compose), live_compose, live_config
    )
    if approved_model != live_model:
        approved_json = json.dumps(approved_model, indent=2, sort_keys=True)
        live_json = json.dumps(live_model, indent=2, sort_keys=True)
        difference = "\n".join(
            difflib.unified_diff(
                approved_json.splitlines(),
                live_json.splitlines(),
                fromfile="approved-compose-model",
                tofile="live-compose-model",
                lineterm="",
            )
        )
        raise VerificationError(f"live Compose semantic drift detected\n{difference}")

    print("SQL_TOOLS_GATEWAY_COMPOSE_MODEL_EXACT")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--approved-compose", required=True)
    parser.add_argument("--approved-config", required=True)
    parser.add_argument("--live-compose", required=True)
    parser.add_argument("--live-config", required=True)
    return parser.parse_args()


def main() -> int:
    try:
        compare_models(parse_args())
    except VerificationError as error:
        print(f"verify-compose-model: ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
