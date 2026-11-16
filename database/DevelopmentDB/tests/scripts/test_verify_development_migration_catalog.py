from __future__ import annotations

import re
import unittest
from pathlib import Path


DEVELOPMENT_DATABASE_ROOT = Path(__file__).resolve().parents[2]


class VerifyDevelopmentMigrationCatalogTests(unittest.TestCase):
    def test_diagnostic_expected_history_matches_ordered_ef_migrations(self) -> None:
        migration_directory = (
            DEVELOPMENT_DATABASE_ROOT
            / "Elevant.Persistence"
            / "Persistence"
            / "Migrations"
        )
        migrations = {
            path.stem
            for path in migration_directory.glob("*.cs")
            if path.name != "ElevantDbContextModelSnapshot.cs"
            and not path.name.endswith(".Designer.cs")
        }
        diagnostic = (
            DEVELOPMENT_DATABASE_ROOT
            / "scripts"
            / "diagnostics"
            / "verify-development.sql"
        ).read_text(encoding="utf-8")
        expected_history = set(
            re.findall(r"\(N'([0-9]{14}_[^']+)'\)", diagnostic)
        )

        self.assertEqual(migrations, expected_history)


if __name__ == "__main__":
    unittest.main()
