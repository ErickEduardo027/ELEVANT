from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "scripts"
    / "deployment"
    / "api_release_manifest.py"
)
SPEC = importlib.util.spec_from_file_location("api_release_manifest", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
api_manifest = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api_manifest)


class ApiReleaseManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.repository_root = Path(self.temporary_directory.name) / "repository"
        self.compose = self.repository_root / "backend" / "compose.development.api.yml"
        self.compose.parent.mkdir(parents=True)
        self.compose.write_text(
            "services:\n  api:\n    image: ${ELEVANT_API_IMAGE}\n",
            encoding="utf-8",
            newline="\n",
        )
        self.database_manifest = self._database_manifest()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    @staticmethod
    def _database_manifest() -> dict[str, object]:
        return {
            "schemaVersion": 1,
            "environment": "Development",
            "publishedAt": "2026-08-31T02:00:00Z",
            "source": {
                "repository": "ErickEduardo027/ELEVANT",
                "ref": "refs/heads/Development",
                "commit": "b" * 40,
                "runId": "111111",
                "runAttempt": 1,
                "workflowUrl": "https://github.com/ErickEduardo027/ELEVANT/actions/runs/111111",
            },
            "images": {
                "ops": f"ghcr.io/erickeduardo027/elevant-db-ops@sha256:{'c' * 64}",
                "release": f"ghcr.io/erickeduardo027/elevant-db-release@sha256:{'d' * 64}",
            },
            "compose": {
                "databaseSha256": "e" * 64,
                "releaseSha256": "f" * 64,
            },
            "database": {
                "migrationIds": ["20260817200402_V1_01_Platform"],
                "migrationFingerprint": f"sha256:{'1' * 64}",
                "modelFingerprint": f"sha256:{'2' * 64}",
                "seedFingerprint": f"sha256:{'3' * 64}",
            },
        }

    def _generate(self) -> dict[str, object]:
        return api_manifest.generate_manifest(
            repository_root=self.repository_root,
            database_manifest=self.database_manifest,
            database_manifest_reference=(
                "ghcr.io/erickeduardo027/elevant-db-release-manifest"
                f"@sha256:{'4' * 64}"
            ),
            repository="ErickEduardo027/ELEVANT",
            ref="refs/heads/Development",
            commit="a" * 40,
            run_id="222222",
            run_attempt=2,
            api_image=f"ghcr.io/erickeduardo027/elevant-api@sha256:{'5' * 64}",
            published_at="2026-08-31T03:00:00Z",
        )

    def test_generates_strict_deterministic_schema_v1(self) -> None:
        first = self._generate()
        self.assertEqual(first, self._generate())
        self.assertEqual(
            set(first),
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
        self.assertEqual(first["schemaVersion"], 1)
        self.assertEqual(
            first["database"],
            {
                "requiredManifest": (
                    "ghcr.io/erickeduardo027/elevant-db-release-manifest"
                    f"@sha256:{'4' * 64}"
                ),
                "requiredRunId": "111111",
                "migrationFingerprint": f"sha256:{'1' * 64}",
                "modelFingerprint": f"sha256:{'2' * 64}",
            },
        )
        self.assertEqual(
            first["endpoints"],
            {
                "containerPort": 8080,
                "livenessPath": "/health",
                "readinessPath": "/health/ready",
                "pingPath": "/api/v1/system/ping",
                "swaggerPath": "/swagger/v1/swagger.json",
            },
        )
        api_manifest.validate_manifest(
            first,
            repository_root=self.repository_root,
        )

    def test_detects_compose_drift(self) -> None:
        document = self._generate()
        self.compose.write_text("services: {}\n", encoding="utf-8", newline="\n")
        with self.assertRaisesRegex(api_manifest.ManifestError, "Compose fingerprint"):
            api_manifest.validate_manifest(
                document,
                repository_root=self.repository_root,
            )

    def test_rejects_compose_path_outside_repository(self) -> None:
        outside = Path(self.temporary_directory.name) / "outside.yml"
        outside.write_text("services: {}\n", encoding="utf-8")
        with self.assertRaisesRegex(api_manifest.ManifestError, "must stay within"):
            api_manifest.generate_manifest(
                repository_root=self.repository_root,
                api_compose=outside,
                database_manifest=self.database_manifest,
                database_manifest_reference=(
                    "ghcr.io/erickeduardo027/elevant-db-release-manifest"
                    f"@sha256:{'4' * 64}"
                ),
                repository="ErickEduardo027/ELEVANT",
                ref="refs/heads/Development",
                commit="a" * 40,
                run_id="222222",
                run_attempt=1,
                api_image=f"ghcr.io/erickeduardo027/elevant-api@sha256:{'5' * 64}",
            )

    def test_rejects_mutable_image_and_database_references(self) -> None:
        document = self._generate()
        document["images"]["api"] = "ghcr.io/erickeduardo027/elevant-api:development"  # type: ignore[index]
        with self.assertRaisesRegex(api_manifest.ManifestError, "by digest"):
            api_manifest.validate_manifest(document)

        with self.assertRaisesRegex(api_manifest.ManifestError, "by digest"):
            api_manifest.generate_manifest(
                repository_root=self.repository_root,
                database_manifest=self.database_manifest,
                database_manifest_reference=(
                    "ghcr.io/erickeduardo027/elevant-db-release-manifest:development-certified"
                ),
                repository="ErickEduardo027/ELEVANT",
                ref="refs/heads/Development",
                commit="a" * 40,
                run_id="222222",
                run_attempt=1,
                api_image=f"ghcr.io/erickeduardo027/elevant-api@sha256:{'5' * 64}",
            )

    def test_rejects_database_from_another_repository(self) -> None:
        self.database_manifest["source"]["repository"] = "someone/else"  # type: ignore[index]
        self.database_manifest["source"]["workflowUrl"] = (  # type: ignore[index]
            "https://github.com/someone/else/actions/runs/111111"
        )
        with self.assertRaisesRegex(api_manifest.ManifestError, "match the API repository"):
            self._generate()

    def test_rejects_tampered_endpoint_and_unknown_field(self) -> None:
        endpoint_tamper = self._generate()
        endpoint_tamper["endpoints"]["readinessPath"] = "/health"  # type: ignore[index]
        with self.assertRaisesRegex(api_manifest.ManifestError, "endpoints must be exactly"):
            api_manifest.validate_manifest(endpoint_tamper)

        unknown = self._generate()
        unknown["connectionString"] = "forbidden"
        with self.assertRaisesRegex(api_manifest.ManifestError, "unexpected"):
            api_manifest.validate_manifest(unknown)

    def test_rejects_database_manifest_with_unknown_field(self) -> None:
        tampered = copy.deepcopy(self.database_manifest)
        tampered["secret"] = "forbidden"
        self.database_manifest = tampered
        with self.assertRaisesRegex(api_manifest.ManifestError, "unexpected"):
            self._generate()

    def test_cli_round_trip(self) -> None:
        database_path = self.repository_root / "database-manifest.json"
        output_path = self.repository_root / "api-manifest.json"
        database_path.write_text(json.dumps(self.database_manifest), encoding="utf-8")
        exit_code = api_manifest.main(
            [
                "generate",
                "--repository-root",
                str(self.repository_root),
                "--database-manifest",
                str(database_path),
                "--database-manifest-reference",
                "ghcr.io/erickeduardo027/elevant-db-release-manifest"
                f"@sha256:{'4' * 64}",
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
                "--api-image",
                f"ghcr.io/erickeduardo027/elevant-api@sha256:{'5' * 64}",
                "--published-at",
                "2026-08-31T03:00:00Z",
                "--output",
                str(output_path),
            ]
        )
        self.assertEqual(exit_code, 0)
        self.assertEqual(json.loads(output_path.read_text(encoding="utf-8")), self._generate())
        self.assertEqual(
            api_manifest.main(
                [
                    "validate",
                    "--manifest",
                    str(output_path),
                    "--repository-root",
                    str(self.repository_root),
                ]
            ),
            0,
        )


if __name__ == "__main__":
    unittest.main()
