from __future__ import annotations

import copy
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


SCRIPT_DIRECTORY = Path(__file__).resolve().parents[2] / "scripts" / "deployment"
sys.path.insert(0, str(SCRIPT_DIRECTORY))

import database_release_manifest as release_manifest  # noqa: E402


class DatabaseReleaseManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.backend_root = Path(self.temporary_directory.name) / "backend"
        self._write(
            release_manifest.DATABASE_COMPOSE,
            "name: fixture-database\nservices: {}\n",
        )
        self._write(
            release_manifest.RELEASE_COMPOSE,
            "name: fixture-release\nservices: {}\n",
        )
        self._write(release_manifest.MODEL_SNAPSHOT, "// model snapshot\n")
        self._write(release_manifest.DEVELOPMENT_SEED, "// development seed\n")
        self._write(
            release_manifest.MIGRATIONS_DIRECTORY / "20260817200402_V1_01_Platform.cs",
            "// migration body\n",
        )
        self._write(
            release_manifest.MIGRATIONS_DIRECTORY
            / "20260817200402_V1_01_Platform.Designer.cs",
            "// migration designer\n",
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _write(self, relative_path: Path, contents: str) -> None:
        path = self.backend_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents, encoding="utf-8", newline="\n")

    def _generate(self) -> dict[str, object]:
        return release_manifest.generate_manifest(
            backend_root=self.backend_root,
            repository="ErickEduardo027/ELEVANT",
            ref="refs/heads/Development",
            commit="a" * 40,
            run_id="123456",
            run_attempt=2,
            operations_image=f"ghcr.io/erickeduardo027/elevant-db-ops@sha256:{'b' * 64}",
            release_image=f"ghcr.io/erickeduardo027/elevant-db-release@sha256:{'c' * 64}",
            published_at="2026-08-23T12:34:56Z",
        )

    def test_generates_deterministic_valid_manifest(self) -> None:
        first = self._generate()
        second = self._generate()

        self.assertEqual(first, second)
        self.assertEqual(first["schemaVersion"], 1)
        self.assertEqual(
            first["database"]["migrationIds"],  # type: ignore[index]
            ["20260817200402_V1_01_Platform"],
        )
        release_manifest.validate_manifest(first, self.backend_root)

    def test_rejects_mutable_image_reference(self) -> None:
        document = self._generate()
        document["images"]["release"] = (  # type: ignore[index]
            "ghcr.io/erickeduardo027/elevant-db-release:development"
        )

        with self.assertRaisesRegex(
            release_manifest.ManifestError, "must reference .* by digest"
        ):
            release_manifest.validate_manifest(document, self.backend_root)

    def test_rejects_non_development_ref(self) -> None:
        document = self._generate()
        document["source"]["ref"] = "refs/heads/main"  # type: ignore[index]

        with self.assertRaisesRegex(release_manifest.ManifestError, "source.ref"):
            release_manifest.validate_manifest(document, self.backend_root)

    def test_rejects_noncanonical_timestamp(self) -> None:
        document = self._generate()
        document["publishedAt"] = "2026-08-23 12:34:56Z"

        with self.assertRaisesRegex(release_manifest.ManifestError, "publishedAt"):
            release_manifest.validate_manifest(document, self.backend_root)

    def test_rejects_unknown_fields_to_keep_manifest_secret_free(self) -> None:
        document = self._generate()
        document["connectionString"] = "not-allowed"

        with self.assertRaisesRegex(release_manifest.ManifestError, "unexpected"):
            release_manifest.validate_manifest(document, self.backend_root)

    def test_detects_source_drift(self) -> None:
        document = self._generate()
        self._write(release_manifest.DEVELOPMENT_SEED, "// changed seed\n")

        with self.assertRaisesRegex(
            release_manifest.ManifestError, "Database fingerprints"
        ):
            release_manifest.validate_manifest(document, self.backend_root)

    def test_migration_source_content_changes_fingerprint(self) -> None:
        original = self._generate()
        self._write(
            release_manifest.MIGRATIONS_DIRECTORY / "20260817200402_V1_01_Platform.cs",
            "// modified migration body\n",
        )
        changed = self._generate()

        self.assertEqual(
            original["database"]["migrationIds"],  # type: ignore[index]
            changed["database"]["migrationIds"],  # type: ignore[index]
        )
        self.assertNotEqual(
            original["database"]["migrationFingerprint"],  # type: ignore[index]
            changed["database"]["migrationFingerprint"],  # type: ignore[index]
        )

    def test_cli_round_trip_and_rejects_tampered_json(self) -> None:
        output = Path(self.temporary_directory.name) / "manifest.json"
        output_capture = io.StringIO()
        error_capture = io.StringIO()
        with redirect_stdout(output_capture), redirect_stderr(error_capture):
            exit_code = release_manifest.main(
                [
                    "generate",
                    "--backend-root",
                    str(self.backend_root),
                    "--repository",
                    "ErickEduardo027/ELEVANT",
                    "--ref",
                    "refs/heads/Development",
                    "--commit",
                    "a" * 40,
                    "--run-id",
                    "123456",
                    "--run-attempt",
                    "2",
                    "--operations-image",
                    f"ghcr.io/erickeduardo027/elevant-db-ops@sha256:{'b' * 64}",
                    "--release-image",
                    f"ghcr.io/erickeduardo027/elevant-db-release@sha256:{'c' * 64}",
                    "--published-at",
                    "2026-08-23T12:34:56Z",
                    "--output",
                    str(output),
                ]
            )
        self.assertEqual(exit_code, 0)
        with redirect_stdout(output_capture), redirect_stderr(error_capture):
            valid_exit_code = release_manifest.main(
                [
                    "validate",
                    "--manifest",
                    str(output),
                    "--backend-root",
                    str(self.backend_root),
                ]
            )
        self.assertEqual(valid_exit_code, 0)

        tampered = copy.deepcopy(json.loads(output.read_text(encoding="utf-8")))
        tampered["compose"]["databaseSha256"] = "0" * 64
        output.write_text(json.dumps(tampered), encoding="utf-8")
        with redirect_stdout(output_capture), redirect_stderr(error_capture):
            invalid_exit_code = release_manifest.main(
                [
                    "validate",
                    "--manifest",
                    str(output),
                    "--backend-root",
                    str(self.backend_root),
                ]
            )
        self.assertEqual(invalid_exit_code, 1)
        self.assertIn("Compose fingerprints", error_capture.getvalue())


if __name__ == "__main__":
    unittest.main()
