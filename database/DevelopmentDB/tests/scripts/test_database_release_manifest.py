from __future__ import annotations

import copy
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


DEVELOPMENT_DATABASE_ROOT = Path(__file__).resolve().parents[2]
DEPLOYMENT_SCRIPT_DIRECTORY = DEVELOPMENT_DATABASE_ROOT / "scripts" / "deployment"
sys.path.insert(0, str(DEPLOYMENT_SCRIPT_DIRECTORY))

import database_release_manifest as release_manifest  # noqa: E402


CANONICAL_SOURCE_PATHS = release_manifest.ManifestSourcePaths()
DEVELOPMENT_SEED_PASSWORDS = (
    CANONICAL_SOURCE_PATHS.development_seed.parent
    / "DevelopmentAccountPasswords.cs"
)
EXPECTED_SCHEMA_V1_FIXTURE_MIGRATION_FINGERPRINT = (
    "sha256:4b9a8e46167ce2fa0441b2fd49e09896242d06b21a38895d6c51a443bd2fc14d"
)


class DatabaseReleaseManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.repository_root = Path(self.temporary_directory.name) / "repository"
        self._write_fixture(CANONICAL_SOURCE_PATHS)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _write_fixture(
        self,
        source_paths: release_manifest.ManifestSourcePaths,
    ) -> None:
        self._write_at(
            source_paths.database_compose,
            "name: fixture-database\nservices: {}\n",
        )
        self._write_at(
            source_paths.release_compose,
            "name: fixture-release\nservices: {}\n",
        )
        self._write_at(source_paths.model_snapshot, "// model snapshot\n")
        self._write_at(source_paths.development_seed, "// development seed\n")
        self._write_at(DEVELOPMENT_SEED_PASSWORDS, "// password policy\n")
        self._write_at(
            source_paths.migrations_directory
            / "20260817200402_V1_01_Platform.cs",
            "// migration body\n",
        )
        self._write_at(
            source_paths.migrations_directory
            / "20260817200402_V1_01_Platform.Designer.cs",
            "// migration designer\n",
        )

    def _write(self, relative_path: Path, contents: str) -> None:
        self._write_at(relative_path, contents)

    def _write_at(self, relative_path: Path, contents: str) -> None:
        path = self.repository_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents, encoding="utf-8", newline="\n")

    def _generate(
        self,
        *,
        source_paths: release_manifest.ManifestSourcePaths | None = None,
    ) -> dict[str, object]:
        return release_manifest.generate_manifest(
            repository_root=self.repository_root,
            source_paths=source_paths,
            repository="ErickEduardo027/ELEVANT",
            ref="refs/heads/Development",
            commit="a" * 40,
            run_id="123456",
            run_attempt=2,
            operations_image=f"ghcr.io/erickeduardo027/elevant-db-ops@sha256:{'b' * 64}",
            release_image=f"ghcr.io/erickeduardo027/elevant-db-release@sha256:{'c' * 64}",
            published_at="2026-08-23T12:34:56Z",
        )

    def _canonical_cli_source_arguments(self) -> list[str]:
        return [
            "--repository-root",
            str(self.repository_root),
            "--database-compose",
            str(CANONICAL_SOURCE_PATHS.database_compose),
            "--release-compose",
            str(CANONICAL_SOURCE_PATHS.release_compose),
            "--migrations-directory",
            str(CANONICAL_SOURCE_PATHS.migrations_directory),
            "--model-snapshot",
            str(CANONICAL_SOURCE_PATHS.model_snapshot),
            "--development-seed",
            str(CANONICAL_SOURCE_PATHS.development_seed),
        ]

    def test_generates_deterministic_schema_v1_manifest(self) -> None:
        first = self._generate()
        second = self._generate()

        self.assertEqual(first, second)
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
            },
        )
        self.assertEqual(first["schemaVersion"], 1)
        self.assertEqual(
            first["database"]["migrationIds"],  # type: ignore[index]
            ["20260817200402_V1_01_Platform"],
        )
        self.assertEqual(
            first["database"]["migrationFingerprint"],  # type: ignore[index]
            EXPECTED_SCHEMA_V1_FIXTURE_MIGRATION_FINGERPRINT,
        )
        release_manifest.validate_manifest(
            first,
            repository_root=self.repository_root,
        )

    def test_canonical_layout_detects_source_drift(self) -> None:
        document = self._generate()
        self._write(
            CANONICAL_SOURCE_PATHS.model_snapshot,
            "// changed model snapshot\n",
        )

        with self.assertRaisesRegex(
            release_manifest.ManifestError, "Database fingerprints"
        ):
            release_manifest.validate_manifest(
                document,
                repository_root=self.repository_root,
            )

    def test_rejects_partial_source_path_overrides(self) -> None:
        error_capture = io.StringIO()
        with redirect_stderr(error_capture):
            exit_code = release_manifest.main(
                [
                    "generate",
                    "--repository-root",
                    str(self.repository_root),
                    "--database-compose",
                    str(CANONICAL_SOURCE_PATHS.database_compose),
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
                    "--output",
                    str(self.repository_root / "manifest.json"),
                ]
            )
        self.assertEqual(exit_code, 1)
        self.assertIn("complete layout", error_capture.getvalue())

    def test_rejects_overlapping_logical_sources(self) -> None:
        overlapping = release_manifest.ManifestSourcePaths(
            database_compose=CANONICAL_SOURCE_PATHS.database_compose,
            release_compose=CANONICAL_SOURCE_PATHS.database_compose,
            migrations_directory=CANONICAL_SOURCE_PATHS.migrations_directory,
            model_snapshot=CANONICAL_SOURCE_PATHS.model_snapshot,
            development_seed=CANONICAL_SOURCE_PATHS.development_seed,
        )
        with self.assertRaisesRegex(release_manifest.ManifestError, "distinct files"):
            self._generate(source_paths=overlapping)

    def test_rejects_sources_outside_root_and_incomplete_checkout(self) -> None:
        outside_seed = Path(self.temporary_directory.name) / "outside-seed.cs"
        outside_seed.write_text("// outside\n", encoding="utf-8")
        escaping = release_manifest.ManifestSourcePaths(
            database_compose=CANONICAL_SOURCE_PATHS.database_compose,
            release_compose=CANONICAL_SOURCE_PATHS.release_compose,
            migrations_directory=CANONICAL_SOURCE_PATHS.migrations_directory,
            model_snapshot=CANONICAL_SOURCE_PATHS.model_snapshot,
            development_seed=outside_seed,
        )
        with self.assertRaisesRegex(release_manifest.ManifestError, "must stay within"):
            self._generate(source_paths=escaping)

        (self.repository_root / CANONICAL_SOURCE_PATHS.development_seed).unlink()
        with self.assertRaisesRegex(
            release_manifest.ManifestError, "Required source file is missing"
        ):
            self._generate()

    def test_rejects_migration_symlink_that_escapes_source_root(self) -> None:
        outside_migration = (
            Path(self.temporary_directory.name) / "outside" / "migration.cs"
        )
        outside_migration.parent.mkdir(parents=True)
        outside_migration.write_text("// outside migration\n", encoding="utf-8")
        linked_migration = (
            self.repository_root
            / CANONICAL_SOURCE_PATHS.migrations_directory
            / "20260817200403_Outside.cs"
        )
        try:
            os.symlink(outside_migration, linked_migration)
        except OSError as error:
            self.skipTest(f"Symlinks are unavailable on this platform: {error}")

        with self.assertRaisesRegex(
            release_manifest.ManifestError,
            "migration source 20260817200403_Outside.cs must stay within",
        ):
            self._generate()

    def test_rejects_migration_designer_symlink_that_escapes_source_root(self) -> None:
        outside_designer = (
            Path(self.temporary_directory.name) / "outside" / "migration.Designer.cs"
        )
        outside_designer.parent.mkdir(parents=True)
        outside_designer.write_text("// outside designer\n", encoding="utf-8")
        linked_designer = (
            self.repository_root
            / CANONICAL_SOURCE_PATHS.migrations_directory
            / "20260817200402_V1_01_Platform.Designer.cs"
        )
        linked_designer.unlink()
        try:
            os.symlink(outside_designer, linked_designer)
        except OSError as error:
            self.skipTest(f"Symlinks are unavailable on this platform: {error}")

        with self.assertRaisesRegex(
            release_manifest.ManifestError,
            "migration designer 20260817200402_V1_01_Platform.Designer.cs "
            "must stay within",
        ):
            self._generate()

    def test_rejects_mutable_image_reference(self) -> None:
        document = self._generate()
        document["images"]["release"] = (  # type: ignore[index]
            "ghcr.io/erickeduardo027/elevant-db-release:development"
        )

        with self.assertRaisesRegex(
            release_manifest.ManifestError, "must reference .* by digest"
        ):
            release_manifest.validate_manifest(
                document,
                repository_root=self.repository_root,
            )

    def test_rejects_non_development_ref(self) -> None:
        document = self._generate()
        document["source"]["ref"] = "refs/heads/main"  # type: ignore[index]

        with self.assertRaisesRegex(release_manifest.ManifestError, "source.ref"):
            release_manifest.validate_manifest(
                document,
                repository_root=self.repository_root,
            )

    def test_rejects_noncanonical_timestamp(self) -> None:
        document = self._generate()
        document["publishedAt"] = "2026-08-23 12:34:56Z"

        with self.assertRaisesRegex(release_manifest.ManifestError, "publishedAt"):
            release_manifest.validate_manifest(
                document,
                repository_root=self.repository_root,
            )

    def test_rejects_unknown_fields_to_keep_manifest_secret_free(self) -> None:
        document = self._generate()
        document["connectionString"] = "not-allowed"

        with self.assertRaisesRegex(release_manifest.ManifestError, "unexpected"):
            release_manifest.validate_manifest(
                document,
                repository_root=self.repository_root,
            )

    def test_detects_development_seed_drift(self) -> None:
        document = self._generate()
        self._write(CANONICAL_SOURCE_PATHS.development_seed, "// changed seed\n")

        with self.assertRaisesRegex(
            release_manifest.ManifestError, "Database fingerprints"
        ):
            release_manifest.validate_manifest(
                document,
                repository_root=self.repository_root,
            )

    def test_detects_development_seed_helper_drift(self) -> None:
        document = self._generate()
        self._write(DEVELOPMENT_SEED_PASSWORDS, "// changed password policy\n")

        with self.assertRaisesRegex(
            release_manifest.ManifestError, "Database fingerprints"
        ):
            release_manifest.validate_manifest(
                document,
                repository_root=self.repository_root,
            )

    def test_migration_source_content_changes_fingerprint(self) -> None:
        original = self._generate()
        self._write(
            CANONICAL_SOURCE_PATHS.migrations_directory
            / "20260817200402_V1_01_Platform.cs",
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

    def test_canonical_cli_round_trip_and_rejects_tampered_json(self) -> None:
        output = Path(self.temporary_directory.name) / "manifest.json"
        output_capture = io.StringIO()
        error_capture = io.StringIO()
        with redirect_stdout(output_capture), redirect_stderr(error_capture):
            exit_code = release_manifest.main(
                [
                    "generate",
                    *self._canonical_cli_source_arguments(),
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
        self.assertEqual(exit_code, 0, error_capture.getvalue())
        with redirect_stdout(output_capture), redirect_stderr(error_capture):
            valid_exit_code = release_manifest.main(
                [
                    "validate",
                    "--manifest",
                    str(output),
                    *self._canonical_cli_source_arguments(),
                ]
            )
        self.assertEqual(valid_exit_code, 0, error_capture.getvalue())
        self.assertEqual(json.loads(output.read_text(encoding="utf-8")), self._generate())

        tampered = copy.deepcopy(json.loads(output.read_text(encoding="utf-8")))
        tampered["compose"]["databaseSha256"] = "0" * 64
        output.write_text(json.dumps(tampered), encoding="utf-8")
        with redirect_stdout(output_capture), redirect_stderr(error_capture):
            invalid_exit_code = release_manifest.main(
                [
                    "validate",
                    "--manifest",
                    str(output),
                    *self._canonical_cli_source_arguments(),
                ]
            )
        self.assertEqual(invalid_exit_code, 1)
        self.assertIn("Compose fingerprints", error_capture.getvalue())


if __name__ == "__main__":
    unittest.main()
