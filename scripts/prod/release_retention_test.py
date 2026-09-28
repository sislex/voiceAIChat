import importlib.util
import json
import pathlib
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location(
    "release_retention", pathlib.Path(__file__).with_name("release_retention.py")
)
assert SPEC and SPEC.loader
retention = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(retention)


class ReleaseRetentionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve() / "releases"
        self.root.mkdir()
        self.operations = pathlib.Path(self.temp.name).resolve() / "operations"
        self.operations.mkdir()
        for name in (
            "0.1.334-412d60c4",
            "0.1.335-ef88027c",
            "0.1.336-b1a5e170",
            "0.1.337-aaaabbbb",
        ):
            (self.root / name).mkdir()

    def test_keeps_latest_three_and_only_selects_matching_local_core_image(self):
        result = retention.plan(
            self.root,
            3,
            [str(self.root / "0.1.337-aaaabbbb")],
            self.operations,
            [
                "sislexa-s3-core:0.1.334-412d60c4f496",
                "ghcr.io/sislex/core:0.1.334-412d60c4f496",
                "sislexa-s3-billing:0.1.334-412d60c4f496",
            ],
        )
        self.assertEqual(result, [{
            "directory": "0.1.334-412d60c4",
            "images": ["sislexa-s3-core:0.1.334-412d60c4f496"],
        }])

    def test_protects_rollback_and_open_operation(self):
        old = self.root / "0.1.334-412d60c4"
        (self.operations / "open.json").write_text(json.dumps({
            "state": "uncertain", "request": {"repository": str(old)}
        }))
        self.assertEqual(retention.plan(
            self.root, 2, [str(self.root / "0.1.335-ef88027c")], self.operations, []
        ), [])
        (self.operations / "open.json").write_text(json.dumps({
            "state": "succeeded", "request": {"repository": str(old)}
        }))
        self.assertEqual(
            [row["directory"] for row in retention.plan(
                self.root, 2, [str(self.root / "0.1.335-ef88027c")], self.operations, []
            )],
            ["0.1.334-412d60c4"],
        )

    def test_rejects_symlinked_release_root_and_ignores_unmanaged_entries(self):
        (self.root / "notes.txt").write_text("keep")
        (self.root / "0.1.333-deadbeef").symlink_to(self.root / "0.1.334-412d60c4")
        self.assertEqual(len(retention.plan(self.root, 3, [], self.operations, [])), 1)
        link = pathlib.Path(self.temp.name) / "linked"
        link.symlink_to(self.root)
        with self.assertRaises(ValueError):
            retention.plan(link, 3, [], self.operations, [])

    def test_protects_release_referenced_by_compose_file_or_symlink(self):
        old = self.root / "0.1.334-412d60c4"
        current_link = pathlib.Path(self.temp.name) / "current"
        current_link.symlink_to(old)
        result = retention.plan(
            self.root, 3, [str(current_link), str(old / "docker-compose.yml")],
            self.operations, [],
        )
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
