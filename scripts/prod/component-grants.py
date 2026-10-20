#!/usr/bin/env python3
"""Commissioned component credential maintenance. Default mode is read-only."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
import time

DUE_SECONDS = 7 * 86400
CRITICAL_SECONDS = 48 * 3600
TOKEN = re.compile(rb"sc1_([a-f0-9]{32})_[A-Za-z0-9_-]{43}\n?")
IDENTIFIER = re.compile(r"[a-z][a-z0-9-]*")


class Refused(Exception):
    """Only fixed, non-secret diagnostic codes cross the CLI boundary."""


def require(condition, code):
    if not condition:
        raise Refused(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private(path, uid, directory=False):
    path = Path(path)
    info = path.lstat()
    require(not path.is_symlink() and info.st_uid == uid and not info.st_mode & 0o077,
            "unsafe_private_storage")
    require(stat.S_ISDIR(info.st_mode) if directory else
            stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "unsafe_private_storage")
    return info


def secret(path, uid):
    info = private(path, uid)
    require(info.st_size <= 256, "invalid_credential_file")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino), "credential_changed")
        value = os.read(fd, 257)
    finally:
        os.close(fd)
    require(TOKEN.fullmatch(value) is not None, "invalid_credential_file")
    return value


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_private(path, value, uid, gid):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        if (os.geteuid(), os.getegid()) != (uid, gid):
            os.fchown(fd, uid, gid)
        with os.fdopen(fd, "wb", closefd=False) as out:
            out.write(value)
            out.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    fsync_directory(Path(path).parent)


def save(path, data):
    temporary = Path(str(path) + ".next")
    # A leftover .next is evidence of an interrupted write, not permission to overwrite.
    write_private(temporary, (json.dumps(data, sort_keys=True) + "\n").encode(),
                  os.geteuid(), os.getegid())
    os.replace(temporary, path)
    fsync_directory(Path(path).parent)


@contextlib.contextmanager
def host_lock(path):
    # Share the existing deployment lock. Never truncate or replace its inode.
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "unsafe_deployment_lock")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused("deployment_or_renewal_active") from None
        yield
    finally:
        os.close(fd)


def registry_row(directory, token, provider, environment):
    db = Path(directory) / "tokens.sqlite"
    require(db.is_file() and not db.is_symlink(), "missing_provider_registry")
    with contextlib.closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)) as connection:
        connection.execute("PRAGMA query_only=ON")
        require(connection.execute("PRAGMA user_version").fetchone()[0] == 1,
                "unknown_registry_version")
        identity = connection.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()
        require(identity and json.loads(identity[0]) == [provider, environment], "registry_identity_mismatch")
        connection.row_factory = sqlite3.Row
        row = connection.execute("SELECT id, consumer, scopes, issued, expires, revoked "
                                 "FROM tokens WHERE digest=?", (digest(token.strip()),)).fetchone()
    require(row is not None, "credential_not_registered")
    result = dict(row)
    result["scopes"] = json.loads(result["scopes"])
    return result


def validate_row(row, link, now, allow_expired=False):
    require(row["consumer"] == link["consumer"] and row["scopes"] == link["scopes"],
            "credential_scope_or_consumer_drift")
    require(row["expires"] - row["issued"] == link["ttlSeconds"] * 1000,
            "credential_ttl_drift")
    require(row["revoked"] is None, "credential_revoked")
    require(row["issued"] <= now, "credential_from_future")
    if not allow_expired:
        require(row["expires"] > now, "credential_expired")


class DockerInstallation:
    """Only the local commissioned daemon and existing provider CLI may mutate."""
    def __init__(self, policy):
        self.policy = policy
        self.root = Path(policy["installationRoot"])
        self.services = policy["services"]
        self.ids = {}
        require(self.root.is_absolute() and self.root.resolve() == self.root, "unsafe_installation_root")
        private(self.root, os.geteuid(), True)
        require(policy["dockerHost"].startswith("unix:///"), "local_docker_required")
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(("DOCKER_", "BUILDX_"))}

    def docker(self, *args):
        result = subprocess.run(["docker", "--host", self.policy["dockerHost"], *args],
                                env=self.env, capture_output=True, timeout=35)
        require(result.returncode == 0, "docker_operation_failed")
        return result.stdout

    def exec(self, service, *args):
        item = self.services[service]
        return self.docker("exec", "--user", f'{item["uid"]}:{item["gid"]}',
                           self.ids[service], *args)

    def config(self, service):
        item = self.services[service]
        path = Path(item["configPath"])
        private(path, item["uid"])
        raw = path.read_bytes()
        require(digest(raw) == item["configSha256"], "commissioned_config_changed")
        data = json.loads(raw)
        require(data["environmentId"] == self.policy["environmentId"]
                and data["registryDirectory"] == "/run/sislexa/provider", "config_identity_mismatch")
        return data

    def guard(self):
        require(self.docker("info", "--format", "{{.ID}}").decode().strip()
                == self.policy["dockerDaemonId"], "docker_daemon_changed")
        for service, item in self.services.items():
            raw = self.docker("inspect", "--format",
                              '{{json .Id}}|{{json .State.Running}}|{{json .Mounts}}',
                              item["container"]).decode().strip().split("|", 2)
            container, running, mounts = map(json.loads, raw)
            require(running is True and (service not in self.ids or self.ids[service] == container),
                    "service_container_changed")
            self.ids[service] = container
            expected = {"config.json": ("configPath", False), "provider": ("providerDirectory", True),
                        "outgoing": ("outgoingDirectory", False)}
            for suffix, (field, writable) in expected.items():
                destination = "/run/sislexa/" + suffix
                canonical = Path(item[field])
                require(canonical.is_absolute() and canonical.resolve() == canonical, "unsafe_commissioned_path")
                source = item["mountSources"][suffix]
                require(Path(source).is_absolute() and Path(source).resolve() == canonical,
                        "commissioned_mount_target_changed")
                matches = [m for m in mounts if m["Destination"] == destination]
                require(len(matches) == 1 and matches[0]["Type"] == "bind"
                        and matches[0]["Source"] == source
                        and matches[0]["RW"] is writable, "component_mount_mismatch")
                require(not any(m["Destination"].startswith(destination + "/") for m in mounts),
                        "nested_component_mount")
            private(item["providerDirectory"], item["uid"], True)
            private(item["outgoingDirectory"], item["uid"], True)
            for suffix in ("tokens.sqlite", "tokens.sqlite-wal", "tokens.sqlite-shm"):
                path = Path(item["providerDirectory"]) / suffix
                if path.exists():
                    private(path, item["uid"])
            contract_raw = self.exec(service, "cat", item["contract"])
            require(digest(contract_raw) == item["contractSha256"], "commissioned_contract_changed")
            cli = json.loads(self.exec(service, "node", "-e",
                "const f=require('node:fs'),c=require('node:crypto'),p=process.argv[1];"
                "process.stdout.write(JSON.stringify({physical:f.realpathSync(p),"
                "sha256:c.createHash('sha256').update(f.readFileSync(p)).digest('hex')}));", item["cli"]))
            require(cli["physical"] == item["cli"] and cli["sha256"] == item["cliSha256"],
                    "commissioned_cli_changed")
            contract = json.loads(contract_raw)
            require(contract["applicationId"] == service, "contract_identity_mismatch")
            config = self.config(service)
            actual = []
            for dependency in config["dependencies"]:
                provider = dependency["applicationId"]
                require(dependency["tokenFile"] == f"/run/sislexa/outgoing/{provider}.token",
                        "unexpected_outgoing_path")
                required = next((d for d in contract["dependencies"] if d["applicationId"] == provider), None)
                require(required is not None, "undeclared_dependency")
                actual.append((provider, tuple(required["scopes"])))
            approved = [(l["provider"], tuple(l["scopes"])) for l in self.policy["links"]
                        if l["consumer"] == service]
            require(sorted(actual) == sorted(approved), "uncommissioned_dependency")
        for link in self.policy["links"]:
            grants = self.config(link["provider"])["grants"]
            grant = next((g for g in grants if g["consumerId"] == link["consumer"]), None)
            require(grant is not None and grant["scopes"] == link["scopes"]
                    and grant["maxTtlSeconds"] == link["ttlSeconds"], "grant_policy_drift")

    def path(self, link):
        return Path(self.services[link["consumer"]]["outgoingDirectory"]) / (link["provider"] + ".token")

    def owner(self, link):
        item = self.services[link["consumer"]]
        return item["uid"], item["gid"]

    def row(self, link, token):
        return registry_row(Path(self.services[link["provider"]]["providerDirectory"]), token,
                            link["provider"], self.policy["environmentId"])

    def issue(self, link, output):
        service = link["provider"]
        item = self.services[service]
        inside = "/run/sislexa/provider/" + output.name
        self.exec(service, "node", "--import", "tsx", item["cli"], "issue",
                  "--contract", item["contract"], "--config", "/run/sislexa/config.json",
                  "--consumer", link["consumer"], "--scopes", ",".join(link["scopes"]),
                  "--ttl", str(link["ttlSeconds"]), "--out", inside)

    def pending(self, link, old_id):
        return Path(self.services[link["provider"]]["providerDirectory"]) / (".renew-" + old_id + ".token")

    def issued_secret(self, link, path):
        return secret(path, self.services[link["provider"]]["uid"])

    def revoke(self, link, token_id):
        item = self.services[link["provider"]]
        self.exec(link["provider"], "node", "--import", "tsx", item["cli"], "revoke",
                  "--contract", item["contract"], "--config", "/run/sislexa/config.json",
                  "--id", token_id)

    def verify(self, link, expected):
        # Tokens stay inside the consumer. Only booleans leave it. No service import/start.
        script = """
const fs=require('node:fs');const [provider,consumer,environment,id,scopes,port]=process.argv.slice(1);
const c=JSON.parse(fs.readFileSync('/run/sislexa/config.json','utf8'));
const d=c.dependencies.find(x=>x.applicationId===provider);
const token=fs.readFileSync(d.tokenFile,'utf8').trim();
(async()=>{const r=await fetch(d.url+'/v1/component/authorize',{method:'POST',redirect:'error',
 headers:{authorization:'Bearer '+token,'content-type':'application/json'},
 body:JSON.stringify({scopes:JSON.parse(scopes)}),signal:AbortSignal.timeout(5000)});
 const p=await r.json();const a=r.ok&&p.tokenId===id&&p.consumerId===consumer&&p.providerId===provider
 &&p.environmentId===environment&&p.expiresAt>Date.now()&&JSON.stringify(p.scopes)===scopes;
 const ready=await fetch('http://127.0.0.1:'+port+'/v1/ready',
 {redirect:'error',signal:AbortSignal.timeout(5000)});const b=await ready.json();
 const ok=a&&b.dependencies?.some(x=>x.applicationId===provider&&x.ok===true);
 process.stdout.write(JSON.stringify({ok:!!ok}));process.exitCode=ok?0:1;
})().catch(()=>{process.stdout.write('{"ok":false}');process.exitCode=1;});
"""
        result = self.exec(link["consumer"], "node", "-e", script, link["provider"], link["consumer"],
                           self.policy["environmentId"], expected["id"], json.dumps(link["scopes"], separators=(",", ":")),
                           str(self.services[link["consumer"]]["port"]))
        require(json.loads(result).get("ok") is True, "renewed_dependency_not_ready")

    def readiness(self, service):
        script = """
fetch('http://127.0.0.1:'+process.argv[1]+'/v1/ready',
{redirect:'error',signal:AbortSignal.timeout(5000)}).then(async r=>{
 const b=await r.json();process.stdout.write(JSON.stringify({ready:r.ok&&b.ok===true}));
}).catch(()=>process.stdout.write('{"ready":false}'));
"""
        return json.loads(self.exec(service, "node", "-e", script,
                                    str(self.services[service]["port"])))["ready"] is True


def validate_policy(policy):
    require(policy["schemaVersion"] == 1 and policy["environmentId"], "invalid_policy")
    require(Path(policy["stateDirectory"]).is_absolute() and Path(policy["deployLock"]).is_absolute(),
            "invalid_policy_paths")
    services = policy["services"]
    require(services and all(IDENTIFIER.fullmatch(s) for s in services), "invalid_service_ids")
    pairs = [(l["consumer"], l["provider"]) for l in policy["links"]]
    require(pairs and len(set(pairs)) == len(pairs), "duplicate_links")
    for link in policy["links"]:
        require(link["consumer"] in services and link["provider"] in services
                and link["scopes"] and len(set(link["scopes"])) == len(link["scopes"])
                and 2 * DUE_SECONDS < link["ttlSeconds"] <= 30 * 86400, "invalid_link_policy")


class Renewal:
    def __init__(self, policy, backend, now=None):
        validate_policy(policy)
        self.policy, self.backend = policy, backend
        self.now = now or (lambda: int(time.time() * 1000))
        self.state = Path(policy["stateDirectory"])
        self.policy_hash = digest(json.dumps(policy, sort_keys=True).encode())

    def inspect(self, link):
        uid, gid = self.backend.owner(link)
        path = self.backend.path(link)
        info = private(path, uid)
        require(info.st_gid == gid and stat.S_IMODE(info.st_mode) == 0o600, "credential_owner_or_mode_drift")
        token = secret(path, uid)
        row = self.backend.row(link, token)
        validate_row(row, link, self.now(), allow_expired=True)
        return token, row

    def check(self):
        self.backend.guard()
        rows = []
        for link in self.policy["links"]:
            _, row = self.inspect(link)
            seconds = (row["expires"] - self.now()) // 1000
            rows.append({"provider": link["provider"], "consumer": link["consumer"],
                         "tokenId": row["id"], "expiresAt": row["expires"],
                         "remainingSeconds": seconds, "expired": seconds <= 0,
                         "due": seconds <= DUE_SECONDS, "critical": seconds <= CRITICAL_SECONDS})
        last_success = None
        if self.state.exists():
            private(self.state, os.geteuid(), True)
            for link in self.policy["links"]:
                journal = self.state / (link["consumer"] + "--" + link["provider"] + ".json")
                if journal.exists():
                    private(journal, os.geteuid())
                    completed = json.loads(journal.read_text())
                    require(completed["phase"] == "complete", "operator_recovery_required")
                    last_success = max(last_success or 0, completed["completedAt"])
        readiness = [{"applicationId": service, "ready": self.backend.readiness(service)}
                     for service in self.policy["services"]]
        return {"state": "checked", "links": rows, "due": sum(r["due"] for r in rows),
                "expired": sum(r["expired"] for r in rows), "critical": sum(r["critical"] for r in rows),
                "lastSuccessfulRenewalAt": last_success, "components": readiness,
                "ready": all(row["ready"] for row in readiness)}

    def renew(self):
        self.backend.guard()
        # Refuse known expiry/revocation anywhere before the first mutation.
        for link in self.policy["links"]:
            _, row = self.inspect(link)
            validate_row(row, link, self.now())
        self.state.mkdir(mode=0o700, exist_ok=True)
        private(self.state, os.geteuid(), True)
        results = []
        for link in self.policy["links"]:
            journal = self.state / (link["consumer"] + "--" + link["provider"] + ".json")
            current, row = self.inspect(link)
            previous = None
            if journal.exists():
                private(journal, os.geteuid())
                previous = json.loads(journal.read_text())
                require(previous["policySha256"] == self.policy_hash, "pending_policy_changed")
                if previous["phase"] == "complete":
                    require(row["id"] == previous["newId"], "credential_changed_after_renewal")
                    if row["expires"] - self.now() > DUE_SECONDS * 1000:
                        results.append({"consumer": link["consumer"], "provider": link["provider"], "state": "not_due"})
                        continue
                    archived = self.state / (journal.stem + "." + previous["oldId"] + ".json")
                    require(not archived.exists(), "journal_archive_exists")
                    os.rename(journal, archived)
                    fsync_directory(self.state)
                    previous = None
            if previous is None and row["expires"] - self.now() > DUE_SECONDS * 1000:
                results.append({"consumer": link["consumer"], "provider": link["provider"], "state": "not_due"})
                continue
            validate_row(row, link, self.now())
            self.rotate(link, journal, previous, current, row)
            results.append({"consumer": link["consumer"], "provider": link["provider"], "state": "renewed"})
        return {"state": "renewed", "links": results}

    def rotate(self, link, journal, intent, current, current_row):
        uid, gid = self.backend.owner(link)
        target = self.backend.path(link)
        if intent is None:
            intent = {"policySha256": self.policy_hash, "consumer": link["consumer"],
                      "provider": link["provider"], "oldId": current_row["id"],
                      "oldExpiresAt": current_row["expires"], "phase": "issuing"}
            save(journal, intent)  # Durable before the only issuance attempt.
            self.backend.guard()
            self.backend.issue(link, self.backend.pending(link, intent["oldId"]))
        require(intent["phase"] in ("issuing", "issued", "switched", "verified"), "operator_recovery_required")
        pending = self.backend.pending(link, intent["oldId"])
        require(pending.exists(), "issuance_outcome_unknown")
        candidate = self.backend.issued_secret(link, pending)
        row = self.backend.row(link, candidate)
        validate_row(row, link, self.now())
        require(row["id"] != intent["oldId"], "renewal_did_not_issue_new_grant")
        require(intent.get("newId", row["id"]) == row["id"], "pending_credential_changed")
        require(current_row["id"] in (intent["oldId"], row["id"]), "outgoing_credential_changed")
        intent.update(newId=row["id"], newExpiresAt=row["expires"])
        if intent["phase"] == "issuing":
            intent["phase"] = "issued"
            save(journal, intent)
        backup = self.state / (journal.stem + "." + intent["oldId"] + ".previous")
        if current_row["id"] == intent["oldId"]:
            require(intent["phase"] == "issued", "outgoing_credential_changed")
            if not backup.exists():
                write_private(backup, current, uid, gid)
            require(secret(backup, uid) == current, "backup_credential_changed")
            temporary = target.with_name(".renew-" + intent["oldId"] + ".next")
            if not temporary.exists():
                write_private(temporary, candidate, uid, gid)
            require(secret(temporary, uid) == candidate, "replacement_credential_changed")
            self.backend.guard()
            require(secret(target, uid) == current, "outgoing_credential_changed")
            os.replace(temporary, target)
            fsync_directory(target.parent)
        else:
            require(backup.exists(), "missing_prior_credential_backup")
        if intent["phase"] != "verified":
            intent["phase"] = "switched"
            save(journal, intent)
            try:
                self.backend.guard()
                self.backend.verify(link, row)
            except Exception:
                intent["phase"] = "verification_failed"
                save(journal, intent)
                raise Refused("renewed_dependency_not_ready") from None
            intent["phase"] = "verified"
            save(journal, intent)
        old = self.backend.row(link, secret(backup, uid))
        require(old["id"] == intent["oldId"] and old["consumer"] == link["consumer"]
                and old["scopes"] == link["scopes"], "prior_credential_changed")
        self.backend.guard()
        require(secret(target, uid) == candidate, "outgoing_credential_changed")
        if old["revoked"] is None:
            self.backend.revoke(link, intent["oldId"])
        require(self.backend.row(link, secret(backup, uid))["revoked"] is not None, "revocation_not_confirmed")
        intent.update(phase="complete", completedAt=self.now())
        save(journal, intent)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", nargs="?", choices=("check", "renew"), default="check")
    parser.add_argument("--policy", required=True)
    args = parser.parse_args()
    try:
        private(args.policy, os.geteuid())
        policy = json.loads(Path(args.policy).read_text())
        validate_policy(policy)
        with host_lock(policy["deployLock"]):
            engine = Renewal(policy, DockerInstallation(policy))
            result = engine.renew() if args.mode == "renew" else engine.check()
        print(json.dumps(result, sort_keys=True))
        return 2 if result.get("critical", 0) or result.get("ready") is False else 0
    except Refused as error:
        print(json.dumps({"state": "refused", "reason": str(error)}))
    except Exception:
        print(json.dumps({"state": "refused", "reason": "maintenance_failed"}))
    return 1


if __name__ == "__main__":
    sys.exit(main())
