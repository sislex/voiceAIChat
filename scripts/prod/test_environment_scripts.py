import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

from environment_observe import describe_container, observe

HERE = os.path.dirname(os.path.abspath(__file__))
COMMIT = "b" * 40
KANBAN = "ghcr.io/sislex/sislexa-kanban:" + COMMIT


def container(service, image, image_id="sha256:" + "1" * 64, health=None, env=None):
    state = {"Status": "running", **({"Health": {"Status": health}} if health else {})}
    return {"Config": {"Labels": {"com.docker.compose.service": service}, "Image": image, "Env": env or []}, "Image": image_id, "State": state}


class ObserveTest(unittest.TestCase):
    def test_owner_image_commit_local_build_and_health(self):
        self.assertEqual(describe_container(container("kanban", KANBAN, health="healthy")),
                         {"service": "kanban", "image": KANBAN, "imageId": "sha256:" + "1" * 64, "commit": COMMIT, "local": False, "healthy": True})
        local = describe_container(container("identity", "sislexa-s4-identity:1.4.3-642bd692455f"))
        self.assertEqual((local["commit"], local["local"], local["healthy"]), (None, True, None))
        self.assertTrue(describe_container(container("make", "sha256:" + "f" * 64))["local"])
        # Started by image ID, but the ID is the published owner image.
        pinned = describe_container(container("make", "sha256:" + "f" * 64), ["ghcr.io/sislex/make-api:" + COMMIT, "local/make:1"])
        self.assertEqual((pinned["commit"], pinned["local"]), (COMMIT, False))

    def test_core_release_is_reported_apart_from_services(self):
        result = observe([container("voicechat", "voicechat-server", env=["VC_RELEASE_VERSION=0.1.361", "VC_RELEASE_COMMIT=9ce7ad8d87eb"]), container("kanban", KANBAN)])
        self.assertEqual(result["core"], {"version": "0.1.361", "commit": "9ce7ad8d87eb"})
        self.assertEqual([row["service"] for row in result["services"]], ["kanban"])


FAKE_DOCKER = r'''#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "pull "*) [[ "$2" == *"$FAKE_MISSING"* && -n "$FAKE_MISSING" ]] && exit 1; exit 0 ;;
  "compose up") echo "chain=$COMPOSE_FILE" >> "$FAKE_LOG"; exit 0 ;;
  "compose ps") echo "c-$4" ;;
  "inspect --format") echo "$FAKE_STATE" ;;
esac
exit 0
'''


class ApplyTest(unittest.TestCase):
    def run_apply(self, switches, state="running healthy", missing="", compose_file="docker-compose.yml", checkout_files=None,
                  overrides_from_env=False, repeat=False):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root)
        os.chmod(root, 0o700)
        fake = os.path.join(root, "docker")
        with open(fake, "w") as handle:
            handle.write(FAKE_DOCKER)
        os.chmod(fake, stat.S_IRWXU)
        switches_file = os.path.join(root, "switches.json")
        with open(switches_file, "w") as handle:
            json.dump(switches, handle)
        log = os.path.join(root, "docker.log")
        env = {**os.environ, "DOCKER": fake, "FAKE_LOG": log, "FAKE_STATE": state, "FAKE_MISSING": missing,
               "VC_ENVIRONMENT_OVERRIDES": os.path.join(root, "overrides"), "VC_ENVIRONMENT_HEALTH_TIMEOUT": "3"}
        env.pop("COMPOSE_FILE", None)
        if compose_file is not None:
            env["COMPOSE_FILE"] = compose_file.replace("{root}", root)
        if overrides_from_env:
            env.pop("VC_ENVIRONMENT_OVERRIDES")
        checkout = os.path.join(root, "checkout")
        os.mkdir(checkout)
        for name, content in (checkout_files or {}).items():
            with open(os.path.join(checkout, name), "w") as handle:
                handle.write(content.replace("{root}", root))
        result = subprocess.run(["bash", os.path.join(HERE, "environment-apply.sh"), "--switches", switches_file, "--operation", "op1"],
                                capture_output=True, text=True, env=env, cwd=checkout)
        if repeat and result.returncode == 0:
            env["COMPOSE_FILE"] = next(line[6:] for line in Path(log).read_text().splitlines() if line.startswith("chain="))
            result = subprocess.run(["bash", os.path.join(HERE, "environment-apply.sh"), "--switches", switches_file, "--operation", "op2"],
                                    capture_output=True, text=True, env=env, cwd=checkout)
        calls = Path(log).read_text().splitlines() if os.path.exists(log) else []
        steps = [json.loads(line) for line in result.stdout.splitlines()]
        return result, calls, steps, os.path.join(root, "overrides")

    def test_switches_only_the_listed_service_without_building(self):
        result, calls, steps, overrides = self.run_apply({"kanban": KANBAN})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("pull " + KANBAN, calls)
        self.assertIn("compose up -d --no-build --no-deps kanban", calls)
        self.assertIn("chain=docker-compose.yml:" + os.path.join(overrides, "current.yml"), calls)
        self.assertEqual([s["status"] for s in steps], ["pulling", "switching", "healthy"])
        override = Path(overrides, "current.yml").read_text()
        self.assertIn('kanban:\n    build: !reset null\n    image: "' + KANBAN + '"\n    pull_policy: never', override)

    def test_the_installed_env_chain_is_kept_when_the_process_has_none(self):
        chain = "/srv/repo/docker-compose.yml:/etc/voicechat/local-owner-images.yml"
        result, calls, _, overrides = self.run_apply({"kanban": KANBAN}, compose_file=None,
                                                    checkout_files={".env": "COMPOSE_PROJECT_NAME=voiceaichat\nCOMPOSE_FILE=" + chain + "\n", "docker-compose.yml": "services: {}\n"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("chain=" + chain + ":" + os.path.join(overrides, "current.yml"), calls)

    def test_compose_default_files_are_kept_without_any_chain(self):
        result, calls, _, overrides = self.run_apply({"kanban": KANBAN}, compose_file=None,
                                                    checkout_files={"docker-compose.yml": "services: {}\n", "docker-compose.override.yml": "services: {}\n"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("chain=docker-compose.yml:docker-compose.override.yml:" + os.path.join(overrides, "current.yml"), calls)

    def test_process_chain_and_overrides_win_over_dotenv(self):
        result, calls, _, overrides = self.run_apply({"kanban": KANBAN}, compose_file="base.yml:process.yml",
            checkout_files={".env": "COMPOSE_FILE=ignored.yml\nVC_ENVIRONMENT_OVERRIDES={root}/ignored\n"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("chain=base.yml:process.yml:" + os.path.join(overrides, "current.yml"), calls)
        self.assertFalse(Path(overrides).with_name("ignored").exists())

    def test_overrides_directory_from_dotenv(self):
        result, calls, _, overrides = self.run_apply({"kanban": KANBAN}, overrides_from_env=True,
            checkout_files={".env": 'VC_ENVIRONMENT_OVERRIDES="{root}/overrides"\n'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("chain=docker-compose.yml:" + os.path.join(overrides, "current.yml"), calls)
        self.assertTrue(os.path.islink(os.path.join(overrides, "current.yml")))

    def test_repeated_apply_keeps_current_once_and_last(self):
        result, calls, steps, overrides = self.run_apply({"kanban": KANBAN}, repeat=True,
            compose_file="docker-compose.yml:{root}/overrides/current.yml:owner.yml:{root}/overrides/current.yml")
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = "chain=docker-compose.yml:owner.yml:" + os.path.join(overrides, "current.yml")
        self.assertEqual([line for line in calls if line.startswith("chain=")], [expected, expected])
        self.assertEqual(os.readlink(os.path.join(overrides, "current.yml")), os.path.join(overrides, "op2.yml"))
        self.assertEqual([s["status"] for s in steps], ["pulling", "switching", "healthy"])

    def test_invalid_dotenv_changes_nothing(self):
        result, calls, steps, overrides = self.run_apply({"kanban": KANBAN}, compose_file=None,
            checkout_files={".env": "broken assignment\n"})
        self.assertEqual(result.returncode, 2)
        self.assertEqual((calls, steps), ([], []))
        self.assertFalse(os.path.exists(overrides))

    def test_no_chain_changes_nothing(self):
        result, calls, _, overrides = self.run_apply({"kanban": KANBAN}, compose_file=None)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(calls, [])
        self.assertFalse(os.path.exists(overrides))

    def test_a_failed_pull_switches_nothing(self):
        result, calls, steps, overrides = self.run_apply({"kanban": KANBAN}, missing="sislexa-kanban")
        self.assertEqual(result.returncode, 20)
        self.assertFalse(any(call.startswith("compose up") for call in calls))
        self.assertFalse(os.path.exists(os.path.join(overrides, "current.yml")))

    def test_an_unhealthy_service_rolls_back(self):
        result, calls, steps, overrides = self.run_apply({"kanban": KANBAN}, state="running unhealthy")
        self.assertEqual(result.returncode, 30)
        self.assertEqual(steps[-1]["status"], "rolled_back")
        self.assertFalse(os.path.exists(os.path.join(overrides, "current.yml")))

    def test_mutable_or_core_references_are_refused(self):
        for switches in ({"kanban": "ghcr.io/sislex/sislexa-kanban:latest"}, {"voicechat": KANBAN}, {}):
            result, calls, _, _ = self.run_apply(switches)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(calls, [])


class ComposeEnvTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.env = dict(os.environ)
        self.env.pop("COMPOSE_FILE", None)

    def run_command(self, *args):
        return subprocess.run(["python3", os.path.join(HERE, "compose_env.py"), *args],
                              cwd=self.root, env=self.env, capture_output=True, text=True)

    def test_get_quotes_comments_duplicates_and_literal_shell(self):
        (self.root / "settings.env").write_text("# comment\n\nexport KEY=old\nKEY='a # b' # comment\nDOUBLE=\"c=d\"\nRAW=a#b # comment\nLITERAL=$(touch marker)\n")
        for key, value in (("KEY", "a # b"), ("DOUBLE", "c=d"), ("RAW", "a#b"),
                           ("LITERAL", "$(touch marker)"), ("MISSING", "")):
            result = self.run_command("get", key, "--file", "settings.env")
            self.assertEqual((result.returncode, result.stdout), (0, value + "\n"), result.stderr)
        self.assertFalse((self.root / "marker").exists())

    def test_missing_file_and_empty_chain(self):
        for args in (("get", "KEY"), ("chain",)):
            result = self.run_command(*args)
            self.assertEqual((result.returncode, result.stdout), (0, "\n"))

    def test_invalid_file_returns_three_without_stdout(self):
        for content in ("invalid", "KEY='unterminated", 'KEY="value" trailing', "1KEY=value"):
            (self.root / ".env").write_text(content)
            for args in (("get", "MISSING"), ("chain",)):
                result = self.run_command(*args)
                self.assertEqual((result.returncode, result.stdout), (3, ""), result.stderr)

    def test_chain_precedence_and_custom_file(self):
        (self.root / "settings.env").write_text('COMPOSE_FILE="base.yml:owner.yml"\n')
        result = self.run_command("chain", "--file", "settings.env")
        self.assertEqual((result.returncode, result.stdout), (0, "base.yml:owner.yml\n"))
        self.env["COMPOSE_FILE"] = "process.yml"
        result = self.run_command("chain", "--file", "settings.env")
        self.assertEqual((result.returncode, result.stdout), (0, "process.yml\n"))

    def test_default_base_with_optional_override(self):
        (self.root / "docker-compose.yml").touch()
        result = self.run_command("chain")
        self.assertEqual((result.returncode, result.stdout), (0, "docker-compose.yml\n"))
        (self.root / "docker-compose.override.yml").touch()
        result = self.run_command("chain")
        self.assertEqual((result.returncode, result.stdout), (0, "docker-compose.yml:docker-compose.override.yml\n"))


# Include stand lifecycle contracts in the existing tooling gate.
from test_environment_stands import StandTest, StandComposeTest


if __name__ == "__main__":
    unittest.main()
