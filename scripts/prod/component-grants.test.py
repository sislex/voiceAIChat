"""Disposable registries exercise the maintenance boundary; no Docker is contacted."""
import contextlib
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
sys.dont_write_bytecode = True
from unittest.mock import patch
from urllib.request import urlopen

spec = importlib.util.spec_from_file_location("grants", Path(__file__).with_name("component-grants.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Fixture:
    def __init__(self, directory):
        self.root = Path(directory)
        self.uid, self.gid = os.getuid(), os.getgid()
        self.now = 1_800_000_000_000
        self.issues, self.revokes, self.verifies = 0, [], []
        self.issue_crash = self.switch_crash = self.verify_failure = False
        self.link = {"provider": "core", "consumer": "make",
                     "scopes": ["identity.verify", "make.core"], "ttlSeconds": 2592000}
        self.policy = {"schemaVersion": 1, "environmentId": "test",
                       "installationRoot": str(self.root), "stateDirectory": str(self.root / "journal"),
                       "deployLock": str(self.root / "deploy.lock"),
                       "services": {"core": {}, "make": {}}, "links": [self.link]}
        for name in ("core", "make"):
            for suffix in ("outgoing", "provider"):
                (self.root / name / suffix).mkdir(mode=0o700, parents=True)
        self.db = self.root / "core/provider/tokens.sqlite"
        with contextlib.closing(sqlite3.connect(self.db, isolation_level=None)) as c:
            c.executescript("PRAGMA user_version=1; CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); "
                            "CREATE TABLE tokens(id TEXT,consumer TEXT,scopes TEXT,digest TEXT,issued INTEGER,"
                            "expires INTEGER,revoked INTEGER);")
            c.execute("INSERT INTO metadata VALUES ('identity',?)", (json.dumps(["core", "test"]),))
        self.old = self.insert(self.now - 25 * 86400 * 1000)
        m.write_private(self.path(self.link), self.old, self.uid, self.gid)
        (self.root / "deploy.lock").touch(mode=0o600)
        self.engine = m.Renewal(self.policy, self, lambda: self.now)

    def insert(self, issued):
        token_id = secrets.token_hex(16)
        value = ("sc1_" + token_id + "_" + secrets.token_urlsafe(32) + "\n").encode()
        with contextlib.closing(sqlite3.connect(self.db, isolation_level=None)) as c:
            c.execute("INSERT INTO tokens VALUES (?,?,?,?,?,?,NULL)",
                      (token_id, "make", json.dumps(self.link["scopes"]), m.digest(value.strip()),
                       issued, issued + self.link["ttlSeconds"] * 1000))
        return value

    def guard(self):
        pass

    def readiness(self, service):
        return True

    def path(self, link):
        return self.root / "make/outgoing/core.token"

    def owner(self, link):
        return self.uid, self.gid

    def row(self, link, token):
        return m.registry_row(self.root / "core/provider", token, "core", "test")

    def pending(self, link, token_id):
        return self.root / "core/provider" / (".renew-" + token_id + ".token")

    def issued_secret(self, link, path):
        return m.secret(path, self.uid)

    def issue(self, link, output):
        self.issues += 1
        value = self.insert(self.now)
        if self.issue_crash == "before_file":
            raise RuntimeError("interrupted after registry insertion")
        if self.issue_crash == "no_file":
            return
        m.write_private(output, value, self.uid, self.gid)
        if self.issue_crash:
            raise RuntimeError("interrupted after exclusive file")

    def verify(self, link, expected):
        actual = self.row(link, m.secret(self.path(link), self.uid))
        self.verifies.append(actual["id"])
        if self.verify_failure:
            raise RuntimeError("unavailable")
        assert actual["id"] == expected["id"]
        assert self.row(link, self.old)["revoked"] is None

    def revoke(self, link, token_id):
        self.revokes.append(token_id)
        with contextlib.closing(sqlite3.connect(self.db, isolation_level=None)) as c:
            c.execute("UPDATE tokens SET revoked=? WHERE id=?", (self.now, token_id))

    def patch_row(self, column, value, token=None):
        with contextlib.closing(sqlite3.connect(self.db, isolation_level=None)) as c:
            c.execute(f"UPDATE tokens SET {column}=? WHERE id=?",
                      (value, self.row(self.link, token or self.old)["id"]))


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.f = Fixture(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_default_check_is_read_only_and_reports_due(self):
        before = {p: p.read_bytes() for p in self.f.root.rglob("*") if p.is_file()}
        result = self.f.engine.check()
        self.assertEqual((result["due"], result["expired"], result["critical"]), (1, 0, 0))
        self.assertEqual(self.f.issues, 0)
        self.assertFalse(self.f.engine.state.exists())
        self.assertEqual(before, {p: p.read_bytes() for p in self.f.root.rglob("*") if p.is_file()})

    def test_not_due_no_issuance(self):
        self.f.now -= 20 * 86400 * 1000
        self.assertEqual(self.f.engine.renew()["links"][0]["state"], "not_due")
        self.assertEqual(self.f.issues, 0)

    def test_expired_reported_but_never_automatically_repaired(self):
        self.f.now += 6 * 86400 * 1000
        self.assertEqual(self.f.engine.check()["expired"], 1)
        with self.assertRaisesRegex(m.Refused, "credential_expired"):
            self.f.engine.renew()
        self.assertEqual(self.f.issues, 0)

    def test_critical_threshold(self):
        self.f.now += 4 * 86400 * 1000
        self.assertEqual(self.f.engine.check()["critical"], 1)

    def test_revoked_refused(self):
        self.f.patch_row("revoked", self.f.now)
        with self.assertRaisesRegex(m.Refused, "credential_revoked"):
            self.f.engine.renew()
        self.assertEqual(self.f.issues, 0)

    def test_scope_ttl_and_consumer_drift_refused(self):
        for column, value in [("scopes", '["identity.verify"]'), ("consumer", "other"),
                              ("expires", self.f.now + 1)]:
            with self.subTest(column=column):
                original = self.f.row(self.f.link, self.f.old)[column]
                self.f.patch_row(column, value)
                with self.assertRaises(m.Refused):
                    self.f.engine.renew()
                self.f.patch_row(column, json.dumps(original) if column == "scopes" else original)
        self.assertEqual(self.f.issues, 0)

    def test_registry_environment_and_provider_bound(self):
        for identity in (["core", "other"], ["other", "test"]):
            with contextlib.closing(sqlite3.connect(self.f.db, isolation_level=None)) as c:
                c.execute("UPDATE metadata SET value=?", (json.dumps(identity),))
            with self.assertRaisesRegex(m.Refused, "registry_identity_mismatch"):
                self.f.engine.check()

    def test_private_mode_symlink_and_hardlink_refused(self):
        target = self.f.path(self.f.link)
        target.chmod(0o644)
        with self.assertRaises(m.Refused):
            self.f.engine.renew()
        target.chmod(0o600)
        os.link(target, self.f.root / "second")
        with self.assertRaises(m.Refused):
            self.f.engine.renew()
        (self.f.root / "second").unlink()
        target.rename(self.f.root / "original")
        target.symlink_to(self.f.root / "original")
        with self.assertRaises(m.Refused):
            self.f.engine.renew()

    def test_fresh_grant_switches_atomically_then_revokes_only_old(self):
        target = self.f.path(self.f.link)
        before = target.stat()
        self.f.engine.renew()
        after = target.stat()
        self.assertNotEqual(before.st_ino, after.st_ino)
        self.assertEqual((after.st_uid, after.st_gid, after.st_mode & 0o777), (self.f.uid, self.f.gid, 0o600))
        self.assertEqual(self.f.revokes, [self.f.row(self.f.link, self.f.old)["id"]])
        self.assertEqual(len(self.f.verifies), 1)
        self.assertEqual(self.f.engine.renew()["links"][0]["state"], "not_due")
        self.assertEqual(self.f.issues, 1)

    def test_interrupted_issuance_recovers_existing_file_without_reissue(self):
        self.f.issue_crash = True
        with self.assertRaises(RuntimeError):
            self.f.engine.renew()
        self.f.issue_crash = False
        self.f.engine.renew()
        self.assertEqual(self.f.issues, 1)
        self.assertEqual(len(self.f.revokes), 1)

    def test_unknown_issue_outcome_never_reissues(self):
        self.f.issue_crash = "before_file"
        with self.assertRaises(RuntimeError):
            self.f.engine.renew()
        with self.assertRaisesRegex(m.Refused, "issuance_outcome_unknown"):
            self.f.engine.renew()
        self.assertEqual(self.f.issues, 1)

    def test_successful_cli_without_output_is_not_reissued(self):
        self.f.issue_crash = "no_file"
        for _ in range(2):
            with self.assertRaisesRegex(m.Refused, "issuance_outcome_unknown"):
                self.f.engine.renew()
        self.assertEqual(self.f.issues, 1)
        self.assertEqual(self.f.path(self.f.link).read_bytes(), self.f.old)

    def test_interrupted_switch_recovers_without_reissue(self):
        original = m.save
        def interrupt(path, data):
            if data["phase"] == "switched":
                raise RuntimeError("process interrupted after rename")
            original(path, data)
        with patch.object(m, "save", interrupt):
            with self.assertRaises(RuntimeError):
                self.f.engine.renew()
        self.assertNotEqual(self.f.path(self.f.link).read_bytes(), self.f.old)
        self.f.engine.renew()
        self.assertEqual(self.f.issues, 1)
        self.assertEqual(len(self.f.revokes), 1)

    def test_interrupted_revocation_is_reconciled_without_reissue(self):
        original = m.save
        def interrupt(path, data):
            if data["phase"] == "complete":
                raise RuntimeError("process interrupted after revoke")
            original(path, data)
        with patch.object(m, "save", interrupt):
            with self.assertRaises(RuntimeError):
                self.f.engine.renew()
        self.f.engine.renew()
        self.assertEqual((self.f.issues, len(self.f.revokes)), (1, 1))

    def test_verification_failure_retains_both_and_requires_operator(self):
        self.f.verify_failure = True
        with self.assertRaisesRegex(m.Refused, "renewed_dependency_not_ready"):
            self.f.engine.renew()
        self.assertEqual(self.f.revokes, [])
        with self.assertRaisesRegex(m.Refused, "operator_recovery_required"):
            self.f.engine.renew()
        with self.assertRaisesRegex(m.Refused, "operator_recovery_required"):
            self.f.engine.check()
        self.assertEqual(self.f.issues, 1)

    def test_revoked_pending_token_cannot_be_resurrected(self):
        self.f.issue_crash = True
        with self.assertRaises(RuntimeError):
            self.f.engine.renew()
        pending = next((self.f.root / "core/provider").glob(".renew-*"))
        self.f.patch_row("revoked", self.f.now, pending.read_bytes())
        with self.assertRaisesRegex(m.Refused, "credential_revoked"):
            self.f.engine.renew()
        self.assertEqual(self.f.path(self.f.link).read_bytes(), self.f.old)

    def test_policy_change_during_recovery_refused(self):
        self.f.issue_crash = True
        with self.assertRaises(RuntimeError):
            self.f.engine.renew()
        self.f.policy["environmentId"] = "different"
        changed = m.Renewal(self.f.policy, self.f, lambda: self.f.now)
        with self.assertRaisesRegex(m.Refused, "pending_policy_changed"):
            changed.renew()

    def test_journal_and_reports_do_not_contain_plaintext_or_digests(self):
        result = self.f.engine.renew()
        journal = next(self.f.engine.state.glob("*.json")).read_text()
        self.assertNotIn(self.f.old.decode().strip(), journal + json.dumps(result))
        self.assertNotIn(m.digest(self.f.old.strip()), journal + json.dumps(result))
        self.assertNotIn(self.f.path(self.f.link).read_text().strip(), journal)

    def test_host_lock_refuses_second_process(self):
        with m.host_lock(self.f.policy["deployLock"]):
            with self.assertRaisesRegex(m.Refused, "deployment_or_renewal_active"):
                with m.host_lock(self.f.policy["deployLock"]):
                    self.fail("second lock acquired")

    def test_completed_journal_archives_on_next_due_rotation(self):
        self.f.engine.renew()
        self.f.now += 25 * 86400 * 1000
        self.f.old = self.f.path(self.f.link).read_bytes()
        self.f.engine.renew()
        self.assertEqual(self.f.issues, 2)
        self.assertEqual(len(list(self.f.engine.state.glob("*.json"))), 2)

    def test_running_consumer_reads_new_credential_without_restart(self):
        fixture = self.f
        class Consumer(BaseHTTPRequestHandler):
            def do_GET(self):
                row = fixture.row(fixture.link, m.secret(fixture.path(fixture.link), fixture.uid))
                self.send_response(200 if row["revoked"] is None and row["expires"] > fixture.now else 503)
                self.end_headers()
                self.wfile.write(json.dumps({"tokenId": row["id"]}).encode())

            def log_message(self, *_args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Consumer)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        address = "http://127.0.0.1:" + str(server.server_address[1])
        try:
            with urlopen(address, timeout=2) as response:
                before = json.load(response)["tokenId"]
            self.f.engine.renew()
            with urlopen(address, timeout=2) as response:
                after = json.load(response)["tokenId"]
            self.assertNotEqual(before, after)
            self.assertTrue(worker.is_alive())
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)


class DockerBoundaryTests(unittest.TestCase):
    def test_remote_daemon_is_refused_before_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(m.Refused, "local_docker_required"):
                m.DockerInstallation({"installationRoot": str(Path(directory).resolve()), "services": {},
                                     "dockerHost": "tcp://remote:2375"})

    def test_fixed_socket_and_clean_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DOCKER_HOST": "tcp://evil", "DOCKER_CONTEXT": "prod",
                                         "DOCKER_TLS_VERIFY": "1", "BUILDX_BUILDER": "remote"}):
                backend = m.DockerInstallation({"installationRoot": str(Path(directory).resolve()), "services": {},
                                               "dockerHost": "unix:///var/run/docker.sock"})
            with patch.object(m.subprocess, "run") as run:
                run.return_value = subprocess.CompletedProcess([], 0, b"id")
                self.assertEqual(backend.docker("info"), b"id")
                self.assertEqual(run.call_args.args[0][:3], ["docker", "--host", "unix:///var/run/docker.sock"])
                self.assertFalse(any(k.startswith(("DOCKER_", "BUILDX_")) for k in run.call_args.kwargs["env"]))

    def test_exact_directory_mounts_contract_and_policy_guards(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            services = {}
            configs = {}
            contract_bytes = {}
            for name, dependencies, grants in [
                ("core", [], [{"consumerId": "make", "scopes": ["identity.verify"], "maxTtlSeconds": 2592000}]),
                ("make", [{"applicationId": "core", "url": "http://core:8787",
                           "tokenFile": "/run/sislexa/outgoing/core.token"}], []),
            ]:
                folder = root / name
                folder.mkdir(mode=0o700)
                (folder / "provider").mkdir(mode=0o700)
                (folder / "outgoing").mkdir(mode=0o700)
                config = {"environmentId": "test", "registryDirectory": "/run/sislexa/provider",
                          "dependencies": dependencies, "grants": grants}
                raw = json.dumps(config).encode()
                m.write_private(folder / "config.json", raw, os.getuid(), os.getgid())
                contract_bytes[name] = json.dumps({"applicationId": name,
                    "dependencies": [{"applicationId": "core", "scopes": ["identity.verify"]}] if name == "make" else []}).encode()
                services[name] = {"uid": os.getuid(), "gid": os.getgid(), "container": name, "contract": "/app/contract.json",
                                  "cli": "/app/runtime/src/cli.ts", "cliSha256": "a" * 64,
                                  "configPath": str(folder / "config.json"), "providerDirectory": str(folder / "provider"),
                                  "outgoingDirectory": str(folder / "outgoing"),
                                  "mountSources": {suffix: str(folder / suffix) for suffix in ("config.json", "provider", "outgoing")},
                                  "configSha256": m.digest(raw), "contractSha256": m.digest(contract_bytes[name])}
            policy = {"installationRoot": str(root), "environmentId": "test", "services": services,
                      "dockerHost": "unix:///var/run/docker.sock", "dockerDaemonId": "expected",
                      "links": [{"provider": "core", "consumer": "make",
                                 "scopes": ["identity.verify"], "ttlSeconds": 2592000}]}
            mutations = {}
            def docker(*args):
                if args[0] == "info":
                    return b"expected"
                name = args[-1]
                mounts = [{"Type": "bind", "Source": str(root / name / suffix),
                           "Destination": "/run/sislexa/" + suffix, "RW": suffix == "provider"}
                          for suffix in ("config.json", "provider", "outgoing")]
                if mutations.get("fileBind"):
                    mounts.append({"Type": "bind", "Source": str(root / name / "outgoing/core.token"),
                                   "Destination": "/run/sislexa/outgoing/core.token", "RW": False})
                if mutations.get("wrongSource"):
                    mounts[-1]["Source"] = "/different"
                if mutations.get("rw"):
                    mounts[-1]["RW"] = True
                return "|".join(json.dumps(x) for x in (name + "-id", True, mounts)).encode()
            backend = m.DockerInstallation(policy)
            backend.docker = docker
            def execute(service, *args):
                if args[0] == "cat":
                    return contract_bytes[service]
                return json.dumps({"physical": "/app/runtime/src/cli.ts" if not mutations.get("cliAlias") else "/other/cli.ts",
                                   "sha256": "b" * 64 if mutations.get("cliBytes") else "a" * 64}).encode()
            backend.exec = execute
            backend.guard()
            for failure in ("fileBind", "wrongSource", "rw", "cliAlias", "cliBytes"):
                mutations[failure] = True
                with self.subTest(failure=failure), self.assertRaises(m.Refused):
                    backend.guard()
                mutations.clear()
            policy["links"][0]["scopes"] = ["make.core"]
            with self.assertRaisesRegex(m.Refused, "uncommissioned_dependency"):
                backend.guard()
            policy["links"][0]["scopes"] = ["identity.verify"]
            # A commissioned mount may retain its known lexical symlink, but its
            # canonical target is pinned separately and cannot silently drift.
            alias = root / "retained-make-provider"
            alias.symlink_to(root / "make/provider", target_is_directory=True)
            services["make"]["mountSources"]["provider"] = str(alias)
            original_docker = docker
            def aliased_docker(*args):
                raw = original_docker(*args)
                if args[0] != "inspect" or args[-1] != "make":
                    return raw
                values = raw.decode().split("|", 2)
                mounts = json.loads(values[2])
                next(x for x in mounts if x["Destination"] == "/run/sislexa/provider")["Source"] = str(alias)
                return (values[0] + "|" + values[1] + "|" + json.dumps(mounts)).encode()
            backend.docker = aliased_docker
            backend.guard()
            alias.unlink()
            alias.symlink_to(root / "core/provider", target_is_directory=True)
            with self.assertRaisesRegex(m.Refused, "commissioned_mount_target_changed"):
                backend.guard()


if __name__ == "__main__":
    unittest.main(verbosity=2)
