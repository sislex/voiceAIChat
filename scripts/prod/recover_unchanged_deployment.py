"""Operator recovery after a known Compose failure that changed no containers."""

import argparse
import copy
from datetime import datetime
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit


def verify_health_target(record, containers):
    """Bind the operation's health URL to this local Core container, not a peer."""
    url = record['request']['healthUrl']
    target = urlsplit(url)
    try:
        address = ipaddress.ip_address(target.hostname or '')
        port = target.port if target.port is not None else 80
    except ValueError:
        raise ValueError('health_target_not_local_core') from None
    if (target.scheme != 'http' or not address.is_loopback or '%' in str(address)
            or target.username is not None or target.password is not None
            or target.path != '/api/health' or target.query or target.fragment
            or any(character.isspace() or ord(character) < 32 for character in url)
            or not 0 < port <= 65535):
        raise ValueError('health_target_not_local_core')
    cores = [c for c in containers if c['Config']['Labels'].get('com.docker.compose.service') == 'voicechat']
    if len(cores) != 1:
        raise ValueError('health_target_not_bound_to_core')
    core = cores[0]
    ports = [value.partition('=')[2] for value in core['Config'].get('Env', []) if value.startswith('PORT=')]
    internal = ports[0] if len(ports) == 1 else '8787' if not ports else ''
    if not internal.isdigit() or not 0 < int(internal) <= 65535:
        raise ValueError('health_target_not_bound_to_core')
    bindings = core.get('NetworkSettings', {}).get('Ports', {}).get(f'{int(internal)}/tcp') or []
    for binding in bindings:
        try:
            published = ipaddress.ip_address(binding['HostIp'])
        except (KeyError, ValueError):
            continue
        if (binding.get('HostPort') == str(port) and published.version == address.version
                and (published == address or published.is_unspecified)):
            return
    raise ValueError('health_target_not_bound_to_core')


def verify_local_docker(run, environment):
    """Published port evidence is valid only for a daemon on this host."""
    context = json.loads(run(['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']))
    if not isinstance(context, str) or not context:
        raise ValueError('local_docker_required')
    endpoints = [environment.get('DOCKER_HOST', ''), context]
    for endpoint in filter(None, endpoints):
        parsed = urlsplit(endpoint)
        if parsed.scheme != 'unix' or parsed.netloc or not parsed.path.startswith('/'):
            raise ValueError('local_docker_required')


class NoHealthRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        raise ValueError('health_redirect_refused')


def read_health(url):
    # A proxy or redirect could silently replace the verified local target.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoHealthRedirect())
    with opener.open(url, timeout=10) as response:
        return json.load(response)


def recover_record(record, containers, health, project, expected_services):
    """Refuse unknown completion, fenced delivery and any runtime transition."""
    if (record.get('state') != 'uncertain' or record.get('phase') != 'deploying'
            or type(record.get('exitCode')) is not int or not 0 < record['exitCode'] < 128
            or record.get('composeCompleted') or record['request'].get('delivery')
            or record['request'].get('deliveryFenceSha256')):
        raise ValueError('operation_requires_other_recovery')
    previous = record.get('previousCommit', '')
    if not re.fullmatch('[a-f0-9]{40}', previous):
        raise ValueError('previous_commit_missing')
    application = health.get('application', {})
    if health.get('ok') is not True or application.get('applicationId') != 'core' or application.get('commit') != previous:
        raise ValueError('previous_runtime_not_healthy')
    expected = set(expected_services)
    if not expected or 'voicechat' not in expected or len(expected) != len(expected_services):
        raise ValueError('invalid_expected_services')
    services = {}
    for container in containers:
        labels = container['Config']['Labels']
        name = labels['com.docker.compose.service']
        if labels.get('com.docker.compose.project') != project or name in services:
            raise ValueError('unexpected_container')
        state = container['State']
        if (state.get('Running') is not True or state.get('Paused') or state.get('Restarting')
                or state.get('Health', {}).get('Status', 'healthy') != 'healthy'):
            raise ValueError('container_not_healthy')
        for timestamp in [container['Created'], state['StartedAt']]:
            # Docker emits nanoseconds; Python 3.9/3.10 accept only millisecond
            # or microsecond fractions. Journal boundaries are milliseconds.
            normalized = re.sub(r'\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)',
                                lambda match: '.' + match[1][:6].ljust(6, '0'), timestamp)
            value = datetime.fromisoformat(normalized.replace('Z', '+00:00'))
            if value.tzinfo is None or value.timestamp() * 1000 >= record['createdAt']:
                raise ValueError('container_changed_after_operation')
        services[name] = {key: container[key] for key in ['Id', 'Image', 'Created']}
        services[name]['StartedAt'] = state['StartedAt']
    if set(services) != expected:
        raise ValueError('container_set_changed')
    verify_health_target(record, containers)
    result = copy.deepcopy(record)
    now = int(time.time() * 1000)
    result.update(state='recovered', observedCommit=previous, reconciled=True, updatedAt=now)
    result['operatorRecovery'] = {'reason': 'unchanged-containers-after-known-failure',
        'project': project, 'verifiedAt': now, 'containers': services}
    # Keep the failed command's exit code and absent composeCompleted flag intact.
    return result


def private_directory(path):
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError('noncanonical_operation_directory')
    stat = path.stat()
    if stat.st_uid != os.geteuid() or stat.st_mode & 0o077:
        raise ValueError('operation_directory_not_private')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operations', type=Path, default=Path('/var/lib/voicechat/deploy-operations'))
    parser.add_argument('--operation', required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--services', required=True, help='Comma-separated pre-deployment service inventory')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}', args.operation):
        raise ValueError('invalid_operation_id')
    private_directory(args.operations)
    path = args.operations / (args.operation + '.json')
    if path.is_symlink() or path.stat().st_mode & 0o077 or path.stat().st_uid != os.geteuid():
        raise ValueError('operation_file_not_private')
    initial = json.loads(path.read_text())
    lock_path = initial['request']['hostLock']
    # The operator command owns the existing host lock; it never starts Docker
    # mutations or runs concurrently with the deployment launcher.
    with os.fdopen(os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600), 'a') as host_lock:
        fcntl.flock(host_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with os.fdopen(os.open(args.operations / '.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600), 'a') as journal_lock:
            fcntl.flock(journal_lock, fcntl.LOCK_EX)
            record = json.loads(path.read_text())
            if record != initial:
                raise ValueError('operation_changed')
            if type(record.get('pid')) is not int or record['pid'] <= 1:
                raise ValueError('invalid_deployment_pid')
            try:
                os.kill(record['pid'], 0)
            except ProcessLookupError:
                pass
            else:
                raise ValueError('deployment_process_still_exists')
            run = lambda argv: subprocess.check_output(argv, text=True, timeout=30).strip()
            verify_local_docker(run, os.environ)
            ids = run(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + args.project]).splitlines()
            if not ids:
                raise ValueError('containers_missing')
            containers = json.loads(run(['docker', 'inspect', *ids]))
            verify_health_target(record, containers)
            health = read_health(record['request']['healthUrl'])
            result = recover_record(record, containers, health, args.project, args.services.split(','))
            core = next(c for c in containers if c['Config']['Labels']['com.docker.compose.service'] == 'voicechat')
            run(['docker', 'exec', core['Id'], 'node', '/app/scripts/component-readiness.mjs'])
            if args.apply:
                # An independent receipt preserves the complete original failure.
                # Root *.json files are operation records scanned by the launcher.
                receipts = args.operations / 'operator-recoveries'
                receipts.mkdir(mode=0o700, exist_ok=True)
                private_directory(receipts)
                receipt = receipts / (args.operation + '.json')
                with os.fdopen(os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
                    json.dump({'before': record, 'after': result}, stream)
                    stream.flush(); os.fsync(stream.fileno())
                receipt_directory = os.open(receipts, os.O_RDONLY)
                try: os.fsync(receipt_directory)
                finally: os.close(receipt_directory)
                fd, temporary = tempfile.mkstemp(prefix='.recovery-', dir=args.operations)
                try:
                    with os.fdopen(fd, 'w') as stream:
                        json.dump(result, stream); stream.flush(); os.fsync(stream.fileno())
                    os.replace(temporary, path)
                    directory = os.open(args.operations, os.O_RDONLY)
                    try: os.fsync(directory)
                    finally: os.close(directory)
                finally:
                    if os.path.exists(temporary): os.unlink(temporary)
            print(json.dumps({'operationId': args.operation, 'verified': True, 'applied': args.apply,
                'state': result['state'], 'observedCommit': result['observedCommit'], 'services': len(containers)}))


if __name__ == '__main__':
    main()
