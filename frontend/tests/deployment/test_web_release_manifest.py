from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "scripts"
    / "deployment"
    / "web_release_manifest.py"
)
SPEC = importlib.util.spec_from_file_location("web_release_manifest", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
web_manifest = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(web_manifest)


class WebReleaseManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name) / "repository"
        self.compose = self.root / "frontend/private-web/compose.development.aviam-web.yml"
        self.compose.parent.mkdir(parents=True)
        self.compose.write_text(
            "services:\n  web:\n    image: ${ELEVANT_AVIAM_WEB_IMAGE}\n",
            encoding="utf-8",
            newline="\n",
        )
        self.configuration = self.root / "artifacts/configuration.json"
        self.configuration.parent.mkdir(parents=True)
        self.configuration.write_text(
            '{"apiOrigin":"https://api.example.test"}\n',
            encoding="utf-8",
            newline="\n",
        )
        self.openapi = {"openapi": "3.0.4", "info": {"version": "v1", "title": "ELEVANT"}}
        self.openapi_file = self.root / "openapi.json"
        self.openapi_file.write_text(json.dumps(self.openapi), encoding="utf-8")
        self.openapi_tool = (
            Path(__file__).resolve().parents[3]
            / "ops"
            / "dokploy"
            / "web-cd"
            / "openapi-tool.mjs"
        )
        self.api_manifest = self._api_manifest()
        self.api_client_source = {
            "sourceCommit": "b" * 40,
            "sourceRunId": "111111",
            "apiImage": f"ghcr.io/erickeduardo027/elevant-api@sha256:{'3' * 64}",
            "swaggerPath": "/swagger/v1/swagger.json",
        }

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    @staticmethod
    def _api_manifest() -> dict[str, object]:
        return {
            "schemaVersion": 1,
            "environment": "Development",
            "publishedAt": "2026-09-05T00:00:00Z",
            "source": {
                "repository": "ErickEduardo027/ELEVANT",
                "ref": "refs/heads/Development",
                "commit": "b" * 40,
                "runId": "111111",
                "runAttempt": 1,
                "workflowUrl": "https://github.com/ErickEduardo027/ELEVANT/actions/runs/111111",
            },
            "images": {
                "api": f"ghcr.io/erickeduardo027/elevant-api@sha256:{'3' * 64}"
            },
            "compose": {"apiSha256": "4" * 64},
            "database": {
                "requiredManifest": (
                    "ghcr.io/erickeduardo027/elevant-db-release-manifest"
                    f"@sha256:{'5' * 64}"
                ),
                "requiredRunId": "99999",
                "migrationFingerprint": f"sha256:{'6' * 64}",
                "modelFingerprint": f"sha256:{'7' * 64}",
            },
            "endpoints": {
                "containerPort": 8080,
                "livenessPath": "/health",
                "readinessPath": "/health/ready",
                "pingPath": "/api/v1/system/ping",
                "swaggerPath": "/swagger/v1/swagger.json",
            },
        }

    def _generate(self, application: str = "aviam-web") -> dict[str, object]:
        image_name = "elevant-private-web" if application == "aviam-web" else "elevant-public-web"
        return web_manifest.generate_manifest(
            repository_root=self.root,
            compose=self.compose,
            application=application,
            api_manifest=self.api_manifest,
            api_manifest_reference=(
                "ghcr.io/erickeduardo027/elevant-api-release-manifest"
                f"@sha256:{'2' * 64}"
            ),
            api_client_source=self.api_client_source,
            openapi_file=self.openapi_file,
            openapi_tool=self.openapi_tool,
            openapi_sha256=self._openapi_digest(),
            configuration_file=self.configuration,
            repository="ErickEduardo027/ELEVANT",
            ref="refs/heads/Development",
            commit="a" * 40,
            run_id="222222",
            run_attempt=2,
            web_image=f"ghcr.io/erickeduardo027/{image_name}@sha256:{'1' * 64}",
            published_at="2026-09-05T01:00:00Z",
        )

    def test_generates_closed_deterministic_aviam_manifest(self) -> None:
        first = self._generate()
        self.assertEqual(first, self._generate())
        self.assertEqual(
            set(first),
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
        self.assertEqual(
            first["endpoints"],
            {
                "containerPort": 8080,
                "healthPath": "/healthz",
                "smokePaths": ["/healthz", "/", "/dashboard"],
            },
        )
        self.assertEqual(first["api"]["requiredRunId"], "111111")  # type: ignore[index]
        self.assertTrue(first["api"]["openApiSha256"].startswith("sha256:"))  # type: ignore[index]

    def test_generates_public_endpoint_contract(self) -> None:
        self.compose = self.root / "frontend/public-web/compose.development.public-web.yml"
        self.compose.parent.mkdir(parents=True, exist_ok=True)
        self.compose.write_text("services:\n  web: {}\n", encoding="utf-8")
        document = self._generate("public-web")
        self.assertEqual(
            document["endpoints"],
            {
                "containerPort": 3000,
                "healthPath": "/health",
                "smokePaths": ["/health", "/", "/login"],
            },
        )

    def test_canonical_openapi_hash_ignores_object_key_order(self) -> None:
        first = self._generate()["api"]["openApiSha256"]  # type: ignore[index]
        self.openapi = {"info": {"title": "ELEVANT", "version": "v1"}, "openapi": "3.0.4"}
        self.openapi_file.write_text(json.dumps(self.openapi), encoding="utf-8")
        second = self._generate()["api"]["openApiSha256"]  # type: ignore[index]
        self.assertEqual(first, second)

    def test_rejects_openapi_fingerprint_drift(self) -> None:
        with self.assertRaisesRegex(web_manifest.ManifestError, "does not match"):
            web_manifest.generate_manifest(
                repository_root=self.root,
                compose=self.compose,
                application="aviam-web",
                api_manifest=self.api_manifest,
                api_manifest_reference=(
                    "ghcr.io/erickeduardo027/elevant-api-release-manifest"
                    f"@sha256:{'2' * 64}"
                ),
                api_client_source=self.api_client_source,
                openapi_file=self.openapi_file,
                openapi_tool=self.openapi_tool,
                openapi_sha256=f"sha256:{'9' * 64}",
                configuration_file=self.configuration,
                repository="ErickEduardo027/ELEVANT",
                ref="refs/heads/Development",
                commit="a" * 40,
                run_id="222222",
                run_attempt=2,
                web_image=(
                    "ghcr.io/erickeduardo027/elevant-private-web"
                    f"@sha256:{'1' * 64}"
                ),
                published_at="2026-09-05T01:00:00Z",
            )

    def test_rejects_api_client_provenance_drift(self) -> None:
        self.api_client_source["sourceCommit"] = "c" * 40
        with self.assertRaisesRegex(web_manifest.ManifestError, "sourceCommit"):
            self._generate()
        self.api_client_source["sourceCommit"] = "b" * 40
        self.api_client_source["apiImage"] = (
            f"ghcr.io/erickeduardo027/elevant-api@sha256:{'8' * 64}"
        )
        with self.assertRaisesRegex(web_manifest.ManifestError, "image does not match"):
            self._generate()

    def test_rejects_mutable_references_and_unknown_fields(self) -> None:
        document = self._generate()
        document["images"]["web"] = "ghcr.io/erickeduardo027/elevant-private-web:latest"  # type: ignore[index]
        with self.assertRaisesRegex(web_manifest.ManifestError, "by digest"):
            web_manifest.validate_manifest(document, application="aviam-web")

        unknown = self._generate()
        unknown["secret"] = "forbidden"
        with self.assertRaisesRegex(web_manifest.ManifestError, "unexpected"):
            web_manifest.validate_manifest(unknown, application="aviam-web")

    def test_detects_compose_and_configuration_drift(self) -> None:
        document = self._generate()
        self.compose.write_text("services: {}\n", encoding="utf-8")
        with self.assertRaisesRegex(web_manifest.ManifestError, "Compose fingerprint"):
            web_manifest.validate_manifest(
                document,
                application="aviam-web",
                repository_root=self.root,
                compose=self.compose,
                configuration_file=self.configuration,
            )

        self.compose.write_text(
            "services:\n  web:\n    image: ${ELEVANT_AVIAM_WEB_IMAGE}\n",
            encoding="utf-8",
            newline="\n",
        )
        self.configuration.write_text('{"apiOrigin":"https://changed.example.test"}\n', encoding="utf-8")
        with self.assertRaisesRegex(web_manifest.ManifestError, "configuration fingerprint"):
            web_manifest.validate_manifest(
                document,
                application="aviam-web",
                repository_root=self.root,
                compose=self.compose,
                configuration_file=self.configuration,
            )

    def test_cli_round_trip(self) -> None:
        api_manifest_file = self.root / "api-manifest.json"
        client_source_file = self.root / "source.json"
        openapi_file = self.root / "openapi.json"
        output_file = self.root / "web-manifest.json"
        api_manifest_file.write_text(json.dumps(self.api_manifest), encoding="utf-8")
        client_source_file.write_text(json.dumps(self.api_client_source), encoding="utf-8")
        openapi_file.write_text(json.dumps(self.openapi), encoding="utf-8")

        code = web_manifest.main(
            [
                "generate",
                "--repository-root",
                str(self.root),
                "--compose",
                str(self.compose),
                "--application",
                "aviam-web",
                "--api-manifest",
                str(api_manifest_file),
                "--api-manifest-reference",
                f"ghcr.io/erickeduardo027/elevant-api-release-manifest@sha256:{'2' * 64}",
                "--api-client-source",
                str(client_source_file),
                "--openapi",
                str(openapi_file),
                "--openapi-tool",
                str(self.openapi_tool),
                "--openapi-sha256",
                self._openapi_digest(openapi_file),
                "--configuration-file",
                str(self.configuration),
                "--repository",
                "ErickEduardo027/ELEVANT",
                "--ref",
                "refs/heads/Development",
                "--commit",
                "a" * 40,
                "--run-id",
                "222222",
                "--run-attempt",
                "2",
                "--web-image",
                f"ghcr.io/erickeduardo027/elevant-private-web@sha256:{'1' * 64}",
                "--published-at",
                "2026-09-05T01:00:00Z",
                "--output",
                str(output_file),
            ]
        )
        self.assertEqual(code, 0)
        self.assertEqual(
            web_manifest.main(
                [
                    "validate",
                    "--manifest",
                    str(output_file),
                    "--application",
                    "aviam-web",
                    "--repository-root",
                    str(self.root),
                    "--compose",
                    str(self.compose),
                    "--configuration-file",
                    str(self.configuration),
                ]
            ),
            0,
        )

    def test_node_controller_consumer_accepts_python_manifest(self) -> None:
        bundle = self.root / "bundle"
        bundle.mkdir()
        (bundle / "manifest.json").write_text(
            json.dumps(self._generate(), sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        (bundle / "compose.development.web.yml").write_bytes(self.compose.read_bytes())
        consumer = (
            Path(__file__).resolve().parents[3]
            / "ops"
            / "dokploy"
            / "web-cd"
            / "manifest-tool.mjs"
        )
        result = subprocess.run(
            [
                "node",
                str(consumer),
                "validate",
                "--file",
                str(bundle / "manifest.json"),
                "--bundle-root",
                str(bundle),
                "--application",
                "aviam-web",
                "--expected-repository",
                "ErickEduardo027/ELEVANT",
                "--expected-ref",
                "refs/heads/Development",
                "--web-repository",
                "ghcr.io/erickeduardo027/elevant-private-web",
                "--api-manifest-repository",
                "ghcr.io/erickeduardo027/elevant-api-release-manifest",
                "--api-image-repository",
                "ghcr.io/erickeduardo027/elevant-api",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "VALID")

    def _openapi_digest(self, path: Path | None = None) -> str:
        result = subprocess.run(
            ["node", str(self.openapi_tool), "hash", "--file", str(path or self.openapi_file)],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()


if __name__ == "__main__":
    unittest.main()
