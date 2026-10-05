"""Regression guard for re-running a web publication without rebuilding it."""

from pathlib import Path
import unittest


WORKFLOW = (Path(__file__).resolve().parents[3] / ".github" / "workflows" /
            "web-ci.yml")


class WebArtifactRetryTests(unittest.TestCase):
    def test_image_artifact_is_stable_within_run_and_replaceable_on_rebuild(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        artifact_name = ("web-image-${{ matrix.application }}-"
                         "${{ github.run_id }}")
        self.assertEqual(2, workflow.count("name: " + artifact_name + "\n"))
        upload = workflow.split("- name: Upload the exact certified image", 1)[1]
        upload = upload.split("publish_development_release:", 1)[0]
        self.assertIn("overwrite: true", upload)


if __name__ == "__main__":
    unittest.main()
