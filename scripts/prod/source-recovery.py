#!/usr/bin/env python3
"""Version 2 trusted, detached Core source owner. Never builds or migrates data."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


def require(value):
    if not value:
        raise ValueError('source_contract_rejected')


def protected(name):
    path = Path(name)
    require(path.is_absolute() and path.resolve() == path)
    for item in (path, *path.parents):
        info = item.lstat()
        require(info.st_uid in (0, os.geteuid()) and not info.st_mode & 0o022)
    require(path.is_file() and path.stat().st_size <= 1048576)
    return path.read_bytes()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def save(path, value):
    encoded = json.dumps(value)
    require(len(encoded.encode()) <= 1048576)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.write-')
    try:
        with os.fdopen(fd, 'w') as out:
            out.write(encoded)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main():
    mode, filename, *pin = sys.argv[1:]
    require(mode in ('launch', 'execute'))
    raw = protected(filename)
    require(not Path(filename).stat().st_mode & 0o077 and len(raw) <= 16384)
    require(not pin or pin == [sha(raw)])
    envelope = json.loads(raw)
    require(set(envelope) == {'schemaVersion', 'operation', 'lease', 'verifyLeaseCommand', 'environment'})
    require(envelope['schemaVersion'] == 2)
    op, lease = envelope['operation'], envelope['lease']
    require(set(op) == {'id', 'runId', 'environment', 'releaseSetId', 'manifestHash', 'expectedCommit', 'expectedPreviousCommit', 'project', 'previous', 'target', 'healthUrl', 'compositionFiles'})
    for key in ('id', 'runId', 'releaseSetId', 'project'):
        require(isinstance(op[key], str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}', op[key]))
    for key, size in (('expectedCommit', 40), ('expectedPreviousCommit', 40), ('manifestHash', 64)):
        require(re.fullmatch('[a-f0-9]{%d}' % size, op[key]))
    require(op['environment'] in ('staging', 'production'))
    require(re.fullmatch(r'http://127\.0\.0\.1:[0-9]{1,5}/api/health', op['healthUrl']))
    require(isinstance(op['compositionFiles'], list) and len(op['compositionFiles']) <= 100)
    require(all(isinstance(item, dict) and set(item) == {'path', 'sha256'} for item in op['compositionFiles']))

    def artifacts():
        for item in op['compositionFiles'] + [op['previous'], op['target']]:
            require(sha(protected(item['path'])) == item['sha256'])
    require(set(lease) == {'id', 'runId', 'environment', 'releaseSetId', 'manifestHash', 'epoch', 'leaseId', 'expiresAt', 'action'})
    require(all(lease[key] == op[key] for key in ('id', 'runId', 'environment', 'releaseSetId', 'manifestHash')))
    require(type(lease['epoch']) is int and lease['epoch'] > 0)
    require(isinstance(lease['leaseId'], str) and 0 < len(lease['leaseId']) <= 96)
    require(lease['action'] in ('deploy', 'recover', 'reconcile', 'status'))
    command, environment = envelope['verifyLeaseCommand'], envelope['environment']
    require(isinstance(command, list) and 1 <= len(command) <= 20 and all(isinstance(x, str) and 0 < len(x) <= 4096 for x in command))
    require(Path(command[0]).is_absolute())
    require(isinstance(environment, dict) and set(environment) <= {'PATH', 'HOME', 'DELIVERY_CONTROL_URL', 'DELIVERY_RELEASE_VERIFIER_TOKEN_FILE'})
    require(all(isinstance(v, str) and len(v) <= 4096 for v in environment.values()))

    def authority():
        require(protected(filename) == raw)
        require(type(lease['expiresAt']) is int and lease['expiresAt'] > time.time() * 1000)
        with tempfile.TemporaryFile() as output:
            subprocess.run(command, input=json.dumps(lease).encode(), stdout=output, stderr=subprocess.DEVNULL, env=environment, timeout=10, check=True)
            require(output.tell() <= 4096)
            output.seek(0)
            receipt = json.load(output)
            require(receipt == {'valid': True, 'epoch': lease['epoch'], 'leaseId': lease['leaseId']})
            require(receipt['valid'] is True and type(receipt['epoch']) is int)
        require(lease['expiresAt'] > time.time() * 1000)

    root = Path(os.environ.get('VC_DEPLOY_OPERATIONS', '/var/lib/voicechat/deploy-operations'))
    require(root.is_absolute() and root.resolve() == root)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(root.stat().st_uid == os.geteuid() and not root.stat().st_mode & 0o077)
    path = root / (op['id'] + '.json')
    require(not path.is_symlink())
    lock_path = os.environ.get('VC_DEPLOY_LOCK', '/var/lock/voicechat-deploy.lock')
    require(Path(lock_path).is_absolute() and Path(lock_path).resolve() == Path(lock_path))
    # Every command inherits this locked description, including after owner death.
    with open(lock_path, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if mode == 'launch' else 0))
        authority()
        # Share reservation serialization with the legacy detached owner.
        with open(root / '.lock', 'a') as guard:
            fcntl.flock(guard, fcntl.LOCK_EX)
            require(not path.exists() or path.stat().st_size <= 1048576)
            record = json.loads(path.read_text()) if path.exists() else None
            if record:
                require(record.get('schemaVersion') == 2 and record['operation'] == op and record['hostLock'] == lock_path)
                require(lease['epoch'] >= record['epoch'])
                if lease['epoch'] == record['epoch']:
                    require(record['leaseId'] == lease['leaseId'] and record['action'] == lease['action'])
            if lease['action'] == 'status':
                require(record is not None)
                print(json.dumps(record)); return
            if not record:
                require(mode == 'launch' and lease['action'] == 'deploy')
                for other in root.glob('*.json'):
                    require(json.loads(other.read_text())['state'] not in ('accepted', 'running', 'uncertain'))
                record = dict(schemaVersion=2, operation=op, hostLock=lock_path, state='accepted', commands=[], launches={}, outcomes={})
            record.update(epoch=lease['epoch'], leaseId=lease['leaseId'], action=lease['action'])
            save(path, record)
            if mode == 'launch' and lease['action'] in ('deploy', 'recover'):
                action = lease['action']
                if action not in record['launches']:
                    if action == 'recover':
                        require(record['state'] == 'uncertain' and record.get('deploymentCompleted') and record.get('prepared'))
                        require(record['outcomes'].get('deploy', {}).get('exitCode') == 1)
                        require(all(c['completed'] for c in record['commands']))
                        require(lease['epoch'] > record['deployEpoch'])
                    record['launches'][action] = sha(raw)
                    save(path, record)
                    with open(os.environ.get('VC_DEPLOY_LOG', '/var/log/voicechat-deploy.log'), 'ab') as log:
                        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), 'execute', filename, sha(raw)], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
                print(json.dumps(record)); return
            if mode == 'execute':
                require(pin and record['launches'].get(lease['action']) == pin[0])

        def run(args, effect=False):
            authority()
            require(len(record['commands']) < 256)
            receipt = dict(argv=args, completed=False)
            record['commands'].append(receipt)
            if effect:
                record['state'] = 'uncertain'
            save(path, record)
            with tempfile.TemporaryFile() as output:
                child = subprocess.Popen(args, stdout=output, stderr=subprocess.DEVNULL, pass_fds=(lock.fileno(),))
                receipt['pid'] = child.pid
                save(path, record)
                code = child.wait()  # Never time out/unlock a live command.
                # A signalled CLI may leave daemon work in flight. Its process
                # exit is known, but command completion remains unknown.
                receipt.update(completed=code >= 0, exitCode=code, exitedAt=int(time.time()*1000))
                if code >= 0:
                    receipt['completedAt'] = receipt['exitedAt']
                save(path, record)
                require(output.tell() <= 1048576)
                output.seek(0)
                result = output.read()
            require(code == 0)
            return result

        def compose(which):
            artifacts()
            spec = op[which]
            require(set(spec) == {'path', 'sha256', 'image', 'validationSha256'})
            require(re.fullmatch(r'sha256:[a-f0-9]{64}', spec['image']))
            require(re.fullmatch('[a-f0-9]{64}', spec['validationSha256']))
            require(sha(protected(spec['path'])) == spec['sha256'])
            args = ['docker', 'compose', '-p', op['project'], '-f', spec['path']]
            config = json.loads(run(args + ['config', '--format', 'json']))
            require(config['services']['voicechat']['image'] == spec['image'])
            require(all('build' not in service for service in config['services'].values()))
            # Bind-mounted configuration must be a pinned file. Data lives in
            # existing named volumes; directory binds need a different protocol.
            files = {item['path'] for item in op['compositionFiles']}
            volumes = config.get('volumes', {})
            for service in config['services'].values():
                # Anonymous mounts and inherited volumes are not pinned storage.
                require(not service.get('volumes_from'))
                for mount in service.get('volumes', []):
                    require(mount['type'] in ('bind', 'volume', 'tmpfs'))
                    if mount['type'] == 'bind':
                        require(mount['source'] in files)
                    elif mount['type'] == 'volume':
                        require(isinstance(mount.get('source'), str) and mount['source'] in volumes)
            for kind in ('configs', 'secrets'):
                for item in config.get(kind, {}).values():
                    require('file' in item and item['file'] in files)
            # Compose must never create a replacement data volume during recovery.
            for volume in config.get('volumes', {}).values():
                require(isinstance(volume.get('name'), str) and volume['name'])
                available = json.loads(run(['docker', 'volume', 'inspect', volume['name']]))
                require(len(available) == 1 and available[0]['Name'] == volume['name'])
            image = json.loads(run(['docker', 'image', 'inspect', spec['image']]))[0]
            commit = op['expectedPreviousCommit'] if which == 'previous' else op['expectedCommit']
            require(image['Id'] == spec['image'] and image['Config']['Labels']['org.opencontainers.image.revision'] == commit)
            # Image VOLUME declarations otherwise create anonymous volumes even
            # when the resolved Compose configuration has no volume entry.
            declared = image['Config'].get('Volumes') or {}
            require(isinstance(declared, dict))
            covered = {mount['target'] for mount in config['services']['voicechat'].get('volumes', [])
                       if mount['type'] in ('bind', 'volume')}
            require(all(destination in covered for destination in declared))
            return args, config

        def composition(args):
            ids = run(args + ['ps', '-aq']).decode().split()
            require(ids)
            items = json.loads(run(['docker', 'inspect', *ids]))
            containers = {x['Id']: {'service': x['Config']['Labels']['com.docker.compose.service'], 'image': x['Image'], 'startedAt': x['State']['StartedAt']} for x in items if x['Config']['Labels']['com.docker.compose.service'] != 'voicechat'}
            ui = json.loads(run(['curl', '-fsS', '-m', '5', op['healthUrl'].replace('/api/health', '/ui/runtime.json')]))
            return {'containers': containers, 'uiSha256': sha(json.dumps(ui, sort_keys=True).encode())}

        def healthy(args, commit, image):
            artifacts()
            health = json.loads(run(['curl', '-fsS', '-m', '5', op['healthUrl']]))
            require(health.get('ok') is True and health['application']['applicationId'] == 'core' and health['application']['commit'] == commit)
            ids = run(args + ['ps', '-q', 'voicechat']).decode().split()
            require(len(ids) == 1)
            core = json.loads(run(['docker', 'inspect', *ids]))[0]
            require(core['Image'] == image and core['Config']['Labels']['com.docker.compose.service'] == 'voicechat')
            config_hash = run(args + ['config', '--hash', 'voicechat']).decode().split()
            require(len(config_hash) == 2 and config_hash[0] == 'voicechat')
            require(core['Config']['Labels']['com.docker.compose.config-hash'] == config_hash[1])
            run(args + ['exec', '-T', 'voicechat', 'node', '/app/scripts/component-readiness.mjs'])
            require(composition(args) == record['unaffected'])
            authority()

        try:
            require(all(c['completed'] for c in record['commands']))
            if record['state'] in ('succeeded', 'recovered'):
                if lease['action'] == 'reconcile':
                    which = 'previous' if record['state'] == 'recovered' else 'target'
                    args, config = compose(which)
                    require(sha(json.dumps(config, sort_keys=True).encode()) == record[which + 'Config'])
                    healthy(args, op['expectedPreviousCommit'] if which == 'previous' else op['expectedCommit'], op[which]['image'])
                    authority()
                    record['outcomes']['reconcile'] = {'exitCode': 2 if record['state'] == 'recovered' else 0, 'completedAt': int(time.time()*1000)}
                    save(path, record)
                print(json.dumps(record))
                if record['state'] == 'recovered':
                    sys.exit(2)
                return
            if lease['action'] == 'reconcile':
                # Observation only: no retry of an effect whose completion is unknown.
                require(record.get('recoveryCompleted'))
                args, config = compose('previous')
                require(sha(json.dumps(config, sort_keys=True).encode()) == record['previousConfig'])
                healthy(args, op['expectedPreviousCommit'], op['previous']['image'])
                record['state'] = 'recovered'
            elif lease['action'] == 'recover':
                require(record['state'] == 'uncertain' and record.get('prepared') and not record.get('recoveryStarted'))
                require(record.get('deploymentCompleted'))
                require(record['outcomes'].get('deploy', {}).get('exitCode') == 1)
                args, config = compose('previous')
                require(sha(json.dumps(config, sort_keys=True).encode()) == record['previousConfig'])
                require(composition(args) == record['unaffected'])
                authority()
                artifacts()
                record['recoveryStarted'] = True
                save(path, record)
                run(args + ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'voicechat'], True)
                record['recoveryCompleted'] = True
                save(path, record)
                healthy(args, op['expectedPreviousCommit'], op['previous']['image'])
                record['state'] = 'recovered'
            else:
                require(not record.get('prepared'))
                previous, pc = compose('previous')
                target, tc = compose('target')
                # Only the Core image may change; configuration/UI/data stay fixed.
                left, right = json.loads(json.dumps(pc)), json.loads(json.dumps(tc))
                left['services']['voicechat']['image'] = right['services']['voicechat']['image']
                require(left == right)
                record['unaffected'] = composition(previous)
                healthy(previous, op['expectedPreviousCommit'], op['previous']['image'])
                record.update(prepared=True, deployEpoch=lease['epoch'], previousConfig=sha(json.dumps(pc, sort_keys=True).encode()), targetConfig=sha(json.dumps(tc, sort_keys=True).encode()))
                save(path, record)
                try:
                    run(target + ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'voicechat'], True)
                finally:
                    last = record['commands'][-1]
                    record['deploymentCompleted'] = last['argv'] == target + ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'voicechat'] and last['completed']
                    save(path, record)
                healthy(target, op['expectedCommit'], op['target']['image'])
                record['state'] = 'succeeded'
            authority()
            record['finishedAction'] = lease['action']
            record['outcomes'][lease['action']] = {'exitCode': 2 if record['state'] == 'recovered' else 0, 'completedAt': int(time.time()*1000)}
            save(path, record)
        except Exception:
            record['state'] = 'uncertain'
            record['finishedAction'] = lease['action']
            record['outcomes'][lease['action']] = {'exitCode': 1, 'completedAt': int(time.time()*1000)}
            save(path, record)
            raise
        print(json.dumps(record))
        if record['state'] == 'recovered':
            sys.exit(2)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('source_operation_rejected_or_uncertain', file=sys.stderr)
        sys.exit(1)
