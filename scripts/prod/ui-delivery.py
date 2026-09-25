#!/usr/bin/env python3
"""Controlled UI effects under ui-deploy.sh's existing host lock.

The operator supplies a private immutable envelope, never model-selected commands.
The actual installation/activation still belongs to browser-ui-release.mjs.
"""
import fcntl
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def protected(value, directory=False, private=False):
    path = pathlib.Path(value)
    assert path.is_absolute() and path.resolve() == path
    for item in (path, *path.parents):
        info = item.lstat()
        assert info.st_uid in (0, os.geteuid()) and not info.st_mode & 0o022
        assert (stat.S_ISDIR(info.st_mode) if item != path or directory else stat.S_ISREG(info.st_mode))
    if private:
        assert not path.stat().st_mode & 0o077
    return path


def durable(path, value):
    fd, name = tempfile.mkstemp(prefix='.ui-write-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(canonical(value)); stream.flush(); os.fsync(stream.fileno())
        os.replace(name, path)
        parent = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def identifier(value):
    return isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}', value)


def release(value):
    return value is None or isinstance(value, str) and re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-[a-f0-9]{40}', value)


def command(argv, env, payload=None, timeout=120):
    # Keep output private and bounded without buffering arbitrary child output.
    with tempfile.TemporaryFile() as output:
        result = subprocess.run(argv, input=payload, stdout=output, stderr=subprocess.DEVNULL,
                                env=env, timeout=timeout, pass_fds=(9,))
        size = output.tell()
        assert result.returncode == 0 and size <= 1024 * 1024
        output.seek(0)
        return output.read().decode()


def main():
    mode, argument = sys.argv[1:]
    lock = pathlib.Path(os.environ.get('VC_DEPLOY_LOCK', '/var/lock/voicechat-deploy.lock'))
    held, actual = os.fstat(9), lock.lstat()
    assert stat.S_ISREG(actual.st_mode) and (held.st_dev, held.st_ino) == (actual.st_dev, actual.st_ino)
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    root = pathlib.Path(os.environ.get('VC_UI_DELIVERY_OPERATIONS', '/var/lib/voicechat/ui-delivery'))
    if not root.exists():
        assert mode != 'delivery-status'
        protected(root.parent, directory=True)
        root.mkdir(mode=0o700)
    protected(root, directory=True, private=True)
    journal_path = root / 'journal.json'
    journal = json.loads(journal_path.read_text()) if journal_path.exists() else {'epoch': 0, 'active': None, 'operations': {}}
    if mode == 'delivery-status':
        assert identifier(argument)
        print(canonical(journal['operations'][argument])); return
    assert mode == 'delivery'
    path = protected(argument, private=True)
    assert path.stat().st_size <= 16384
    envelope = json.loads(path.read_text())
    assert set(envelope) == {'schemaVersion', 'operation', 'lease', 'verifyLeaseCommand', 'environment'} and envelope['schemaVersion'] == 1
    operation, lease = envelope['operation'], envelope['lease']
    assert set(operation) == {'id', 'manifestHash', 'expectedCoreCommit', 'expectedGeneration', 'expectedActive', 'targetRelease', 'action', 'sourceDirectory', 'manifestSha256'}
    assert identifier(operation['id']) and re.fullmatch('[a-f0-9]{64}', operation['manifestHash'])
    assert re.fullmatch('[a-f0-9]{40}', operation['expectedCoreCommit'])
    assert operation['expectedGeneration'] is None or isinstance(operation['expectedGeneration'], str) and 0 < len(operation['expectedGeneration']) <= 100
    assert release(operation['expectedActive']) and release(operation['targetRelease'])
    assert operation['action'] in ('install', 'activate')
    if operation['action'] == 'install':
        assert operation['targetRelease'] and isinstance(operation['sourceDirectory'], str) and pathlib.Path(operation['sourceDirectory']).is_absolute()
        assert re.fullmatch('[a-f0-9]{64}', operation['manifestSha256'])
    else:
        assert operation['sourceDirectory'] is None and operation['manifestSha256'] is None
    assert set(lease) == {'id', 'epoch', 'leaseId', 'expiresAt', 'action', 'runId', 'environment', 'releaseSetId', 'manifestHash'}
    assert lease['id'] == operation['id'] and lease['manifestHash'] == operation['manifestHash']
    assert all(identifier(lease[key]) for key in ('id', 'leaseId', 'runId', 'releaseSetId'))
    assert type(lease['epoch']) is int and lease['epoch'] > 0 and type(lease['expiresAt']) is int
    assert lease['action'] in ('deploy', 'reconcile') and lease['environment'] in ('staging', 'production')
    verifier, environment = envelope['verifyLeaseCommand'], envelope['environment']
    assert isinstance(verifier, list) and 1 <= len(verifier) <= 20 and all(isinstance(v, str) and 0 < len(v) <= 4096 for v in verifier)
    protected(verifier[0])
    assert isinstance(environment, dict) and set(environment) <= {'PATH', 'HOME', 'DELIVERY_CONTROL_URL', 'DELIVERY_RELEASE_VERIFIER_TOKEN_FILE'}
    assert all(isinstance(v, str) and len(v) <= 4096 for v in environment.values())

    def verify():
        assert lease['expiresAt'] > int(time.time() * 1000)
        receipt = json.loads(command(verifier, environment, canonical(lease).encode(), 10))
        assert isinstance(receipt, dict) and set(receipt) == {'valid', 'epoch', 'leaseId'}
        assert receipt['valid'] is True and type(receipt['epoch']) is int and receipt['epoch'] == lease['epoch'] and receipt['leaseId'] == lease['leaseId']
        assert lease['expiresAt'] > int(time.time() * 1000)

    docker = str(protected(os.environ.get('VC_UI_DOCKER', '/usr/bin/docker')))
    process_env = {k: os.environ[k] for k in ('PATH', 'HOME') if k in os.environ}

    def invoke(*args):
        verify()
        return command([docker, *args], process_env)

    verify()
    ident = operation['id']
    identity = digest({'operation': operation, **{k: lease[k] for k in ('runId', 'environment', 'releaseSetId')}})
    record = journal['operations'].get(ident)
    assert lease['epoch'] >= journal['epoch'] and (not journal['active'] or journal['active'] == ident)
    assert record is None or record['identity'] == identity
    assert record is not None or lease['action'] == 'deploy'
    container = invoke('compose', 'ps', '-q', 'voicechat').strip()
    assert re.fullmatch('[a-f0-9]{64}', container)
    container_identity = invoke('inspect', '--format', '{{.Id}} {{.Image}} {{.State.StartedAt}} {{.State.Running}}', container).strip()
    assert re.fullmatch(container + r' sha256:[a-f0-9]{64} \S+ true', container_identity)
    contract = json.loads(invoke('exec', '--user', 'node', container, 'node', '--import', 'tsx', 'scripts/browser-ui-release.mjs', 'describe'))
    assert contract == {'schemaVersion': 1, 'kind': 'sislexa-browser-ui-owner', 'version': 2, 'intentBoundGeneration': True, 'manifestBytes': True}
    health_url = os.environ.get('VC_HEALTH_URL', 'http://127.0.0.1:8787/api/health')
    assert health_url.startswith('http://127.0.0.1:') or health_url.startswith('http://localhost:')

    def inspect():
        verify()
        with urllib.request.urlopen(health_url, timeout=5) as response:
            health = json.loads(response.read(65537))
        assert health.get('ok') is True and health.get('application', {}).get('applicationId') == 'core'
        assert health['application']['commit'] == operation['expectedCoreCommit']
        observed = json.loads(invoke('exec', '--user', 'node', container, 'node', '--import', 'tsx', 'scripts/browser-ui-release.mjs', 'inspect'))
        runtime = observed['runtime']
        assert runtime['generation'] == runtime['configuredGeneration']
        assert invoke('compose', 'ps', '-q', 'voicechat').strip() == container
        assert invoke('inspect', '--format', '{{.Id}} {{.Image}} {{.State.StartedAt}} {{.State.Running}}', container).strip() == container_identity
        return observed

    before = inspect()
    if record is None:
        assert before['runtime']['generation'] == operation['expectedGeneration'] and before['runtime']['active'] == operation['expectedActive']
        record = {'schemaVersion': 1, 'operationId': ident, 'manifestHash': operation['manifestHash'], 'identity': identity,
                  'operation': operation, 'coreContainer': container_identity, 'state': 'prepared'}
        journal['operations'][ident] = record
    assert record['coreContainer'] == container_identity
    journal['epoch'] = lease['epoch']; journal['active'] = ident
    durable(journal_path, journal)
    actor = 'delivery:' + ident + ':' + identity
    staging = record.get('staging')
    assert staging is None or re.fullmatch(r'/tmp/browser-ui\.[a-zA-Z0-9]{8}', staging)
    terminal_verified = False
    try:
        if record['state'] == 'prepared' and lease['action'] == 'deploy':
            if operation['targetRelease'] == operation['expectedActive']:
                record['state'] = 'noop'
            else:
                args = ['activate', '--release', operation['targetRelease'] or 'bundled']
                if operation['action'] == 'install':
                    source = protected(operation['sourceDirectory'], directory=True)
                    for item in source.rglob('*'):
                        protected(item, directory=item.is_dir())
                    manifest = (source / 'manifest.json').read_bytes()
                    assert hashlib.sha256(manifest).hexdigest() == operation['manifestSha256'] and json.loads(manifest)['id'] == operation['targetRelease']
                    staging = invoke('exec', '--user', 'node', container, 'mktemp', '-d', '/tmp/browser-ui.XXXXXXXX').strip()
                    assert re.fullmatch(r'/tmp/browser-ui\.[a-zA-Z0-9]{8}', staging)
                    record['staging'] = staging; durable(journal_path, journal)
                    invoke('cp', str(source) + '/.', container + ':' + staging + '/')
                    invoke('exec', container, 'chown', '-R', '-h', 'node:node', staging)
                    args = ['install', '--directory', staging, '--manifest-sha256', operation['manifestSha256'], '--target-release', operation['targetRelease']]
                verify()
                record['state'] = 'activation-started'; durable(journal_path, journal)
                output = json.loads(invoke('exec', '--user', 'node', container, 'node', '--import', 'tsx', 'scripts/browser-ui-release.mjs', *args,
                    '--expected-generation', canonical(operation['expectedGeneration']), '--expected-active', canonical(operation['expectedActive']), '--actor', actor))
                assert output['active'] == operation['targetRelease'] and output['actor'] == actor
                record['generation'] = output['generation']; record['state'] = 'activated'; durable(journal_path, journal)
        after = inspect()
        runtime, activation = after['runtime'], after['activation']
        if record['state'] != 'noop':
            if runtime['active'] == operation['targetRelease'] and activation and activation['actor'] == actor and activation['generation'] == runtime['generation']:
                record['state'] = 'succeeded'; record['generation'] = runtime['generation']
            elif record['state'] in ('prepared', 'recovered') and runtime['generation'] == operation['expectedGeneration'] and runtime['active'] == operation['expectedActive']:
                record['state'] = 'recovered'
            else:
                record['state'] = 'uncertain'
        else:
            assert runtime['generation'] == operation['expectedGeneration'] and runtime['active'] == operation['targetRelease']
        verify()
        terminal_verified = True
        record['runtime'] = runtime; record['observedAt'] = int(time.time() * 1000)
        durable(journal_path, journal)
    finally:
        record['cleanup'] = 'complete'
        if staging:
            # Disposable staging cleanup is allowed after revocation; it never
            # touches the installed release/activation or grants new authority.
            try:
                command([docker, 'exec', container, 'rm', '-rf', '--', staging], process_env, timeout=10)
                record.pop('staging', None)
            except Exception:
                record['cleanup'] = 'failed'
        if terminal_verified and record['state'] in ('succeeded', 'noop', 'recovered') and record['cleanup'] == 'complete':
            journal['active'] = None
        durable(journal_path, journal)
    assert record['cleanup'] == 'complete'
    print(canonical(record))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.stderr.write('ui_delivery_rejected; inspect operation before retrying\n')
        sys.exit(1)
