#!/usr/bin/env python3
"""Fail-closed contract checks for the Development SQL tools gateway."""

from __future__ import annotations

import json
import pathlib
import re
import shutil
import subprocess
import tempfile


GATEWAY_ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPOSE_PATH = GATEWAY_ROOT / "compose.yml"
HAPROXY_PATH = GATEWAY_ROOT / "haproxy.cfg"
EXPECTED_IMAGE = (
    "docker.io/library/haproxy:3.2.23-alpine3.24@sha256:"
    "6343ce34a132a5dceaa24767d739df2bd519f8f7c1079ae39e4821334e8eb42e"
)


def render_compose() -> dict[str, object]:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = pathlib.Path(temp_dir)
        code = root / "code"
        files = root / "files"
        code.mkdir()
        files.mkdir()
        shutil.copy2(HAPROXY_PATH, files / "haproxy.cfg")

        # A Raw deploy deletes and recreates code/. The sibling files/ directory
        # must remain the source of the runtime configuration.
        shutil.rmtree(code)
        code.mkdir()
        staged_compose = code / "docker-compose.yml"
        shutil.copy2(COMPOSE_PATH, staged_compose)

        result = subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                str(staged_compose),
                "config",
                "--format",
                "json",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(result.stdout)


def main() -> None:
    for path in (COMPOSE_PATH, HAPROXY_PATH):
        raw = path.read_bytes()
        assert raw and b"\r" not in raw, f"{path.name}: empty or CRLF"

    config = render_compose()
    compose_text = COMPOSE_PATH.read_text(encoding="utf-8")
    assert "file: ../files/haproxy.cfg" in compose_text
    assert config["name"] == "elevant-dev-sql-tools-gateway"
    assert config["networks"] == {
        "data": {"name": "elevant-dev-data", "ipam": {}, "external": True}
    }
    assert set(config["services"]) == {"sql-tools-gateway"}

    service = config["services"]["sql-tools-gateway"]
    assert service["image"] == EXPECTED_IMAGE
    assert service["platform"] == "linux/amd64"
    assert service["pull_policy"] == "always"
    assert service["user"] == "65534:65534"
    assert service["read_only"] is True
    assert service["restart"] == "unless-stopped"
    assert service["cap_drop"] == ["ALL"]
    assert service.get("cap_add", []) == []
    assert service["security_opt"] == ["no-new-privileges:true"]
    assert service["pids_limit"] == 64
    assert service["mem_limit"] == "67108864"
    assert service["cpus"] == 0.1
    assert service["tmpfs"] == [
        "/tmp:rw,noexec,nosuid,nodev,size=8m,uid=65534,gid=65534,mode=0700"
    ]
    assert service["stop_grace_period"] == "15s"
    assert service["networks"] == {"data": None}
    assert not service.get("privileged", False)
    assert not service.get("environment")
    assert not service.get("secrets")
    assert not service.get("volumes")
    assert not service.get("devices")
    assert not service.get("pid")
    assert not service.get("ipc")
    assert not service.get("network_mode")

    assert service["ports"] == [
        {
            "mode": "ingress",
            "host_ip": "127.0.0.1",
            "target": 11433,
            "published": "11433",
            "protocol": "tcp",
        }
    ]
    assert service["configs"] == [
        {
            "source": "haproxy_config",
            "target": "/usr/local/etc/haproxy/haproxy.cfg",
        }
    ]
    config_source = config["configs"]["haproxy_config"]["file"]
    assert config_source.replace("\\", "/").endswith("/files/haproxy.cfg")
    assert service["logging"] == {
        "driver": "json-file",
        "options": {"max-file": "3", "max-size": "10m"},
    }

    assert service["healthcheck"] == {
        "test": [
            "CMD-SHELL",
            "kill -0 1 && nc -z -w 3 127.0.0.1 11433 && "
            "nc -z -w 3 elevant-dev-sql 1433",
        ],
        "interval": "15s",
        "timeout": "5s",
        "retries": 4,
        "start_period": "15s",
    }

    haproxy = HAPROXY_PATH.read_text(encoding="utf-8")
    assert re.search(r"(?m)^\s*mode tcp\s*$", haproxy)
    assert re.search(r"(?m)^\s*bind :11433\s*$", haproxy)
    assert re.search(
        r"(?m)^\s*server sql elevant-dev-sql:1433 check ", haproxy
    )
    assert "127.0.0.11:53" in haproxy
    assert not re.search(r"(?i)password|credential|connection.string", haproxy)

    serialized = json.dumps(config, sort_keys=True)
    for forbidden in (
        "0.0.0.0:11433",
        "dokploy-network",
        "docker.sock",
        "1433:1433",
        "traefik",
    ):
        assert forbidden not in serialized.lower(), forbidden

    print("SQL_TOOLS_GATEWAY_CONTRACT_OK")


if __name__ == "__main__":
    main()
