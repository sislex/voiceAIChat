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


class OwnerImageRetentionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name).resolve()

    def checkout(self, name, compose, env=None, deploy=None):
        path = self.base / name
        (path / "deploy").mkdir(parents=True)
        (path / "docker-compose.yml").write_text(compose)
        if deploy:
            (path / "deploy" / "compose.identity.yml").write_text(deploy)
        if env is not None:
            (path / ".env").write_text(env)
        return path

    def test_removes_only_owner_tags_no_kept_checkout_or_container_names(self):
        current = self.checkout("current", "image: ${SISLEXA_MAKE_IMAGE:-ghcr.io/sislex/make-api:new}\n  image: ${SISLEXA_KANBAN_IMAGE:-sislexa-kanban:k2}\n",
                                env="VC_GITHUB_TOKEN=secret-value\nSISLEXA_READER_IMAGE=ghcr.io/sislex/webreader-api:pinned\n",
                                deploy="image: ${SISLEXA_IDENTITY_IMAGE:-ghcr.io/sislex/identity:id1}\n")
        rollback = self.checkout("rollback", "image: ghcr.io/sislex/make-api:old\n  image: sislexa-kanban:k1\n")
        texts = retention.compose_texts(current) + retention.compose_texts(rollback)
        # Secrets of .env never enter the texts: only the image override lines do.
        self.assertFalse(any("secret-value" in text for text in texts))
        tags = ["ghcr.io/sislex/make-api:new", "ghcr.io/sislex/make-api:old", "ghcr.io/sislex/make-api:older",
                "sislexa-kanban:k2", "sislexa-kanban:k1", "sislexa-kanban:k0", "ghcr.io/sislex/webreader-api:pinned",
                "ghcr.io/sislex/identity:id1", "ghcr.io/sislex/llm-runner:stopped", "postgres:16-alpine", "sislexa-s3-core:0.1.1-abc"]
        self.assertEqual(retention.owner_image_plan(tags, ["ghcr.io/sislex/llm-runner:stopped"], texts),
                         ["ghcr.io/sislex/make-api:older", "sislexa-kanban:k0"])

    def test_cli_plans_releases_and_owner_images_from_kept_checkouts_and_compose_chain(self):
        root = self.base / "releases"
        root.mkdir()
        operations = self.base / "operations"
        operations.mkdir()
        for name, tag in (("0.1.1-aaaaaaaa", "t1"), ("0.1.2-bbbbbbbb", "t2"), ("0.1.3-cccccccc", "t3")):
            path = root / name
            path.mkdir()
            (path / "docker-compose.yml").write_text(f"image: sislexa-kanban:{tag}\n")
        override = self.base / "llm-runner-external.yml"
        override.write_text("image: ghcr.io/sislex/llm-runner:ext\n")
        env = self.base / "production.env"
        env.write_text(f"VC_REPO_DIR={root / '0.1.3-cccccccc'}\n")
        in_use = self.base / "in-use"
        in_use.write_text("")
        import subprocess, sys
        result = subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name("release_retention.py")),
            "--root", str(root), "--keep", "2", "--current", str(root / "0.1.3-cccccccc"), "--production-env", str(env),
            "--operations", str(operations), "--compose-file", f"{root / '0.1.3-cccccccc' / 'docker-compose.yml'}:{override}", "--in-use", str(in_use)],
            input="sislexa-kanban:t1\nsislexa-kanban:t2\nsislexa-kanban:t3\nghcr.io/sislex/llm-runner:ext\nghcr.io/sislex/llm-runner:gone\n",
            capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout), {
            "releases": [{"directory": "0.1.1-aaaaaaaa", "images": []}],
            # t1 belonged only to the removed release; the override keeps its llm-runner tag.
            "ownerImages": ["ghcr.io/sislex/llm-runner:gone", "sislexa-kanban:t1"]
        })


if __name__ == "__main__":
    unittest.main()
