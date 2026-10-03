#!/usr/bin/env python3
"""Machine-side stand lifecycle; settings are data, never executable shell."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from compose_env import read_env

RESERVED = '''VC_ENVIRONMENT_ID COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES
COMPOSE_PARALLEL_LIMIT COMPOSE_BAKE VC_STAND_PORT VC_DATA_VOLUME VC_PUBLIC_HOST
VC_ENVIRONMENT_OVERRIDES VC_DB_URL VC_KANBAN_MODE VC_RELEASE_VERSION VC_RELEASE_COMMIT'''.split()
PRODUCTION_ENV = Path('/etc/voicechat/production.env')


class Stand:
    def __init__(self, action, role='primary'):
        self.stage = 'config' if action == 'provision' else 'down'
        self.code = 10
        self.values = {}
        self.env = dict(os.environ)
        self.docker = os.environ.get('DOCKER', 'docker')
        self.role = role

    def emit(self, status, message=''):
        for value in sorted(set(self.values.values()), key=len, reverse=True):
            if value:
                message = message.replace(value, '[redacted]')
        print(json.dumps(dict(stage=self.stage, status=status, log=message)), flush=True)

    def run(self, *args, check=True, timeout=3600):
        result = subprocess.run(args, env=self.env, capture_output=True, text=True, timeout=timeout)
        if check and result.returncode:
            raise ValueError('command failed')
        return result

    def compose(self, *args, **kwargs):
        return self.run(self.docker, 'compose', *args, **kwargs)

    def config(self):
        self.values = read_env(Path('.env'))
        v = self.values
        if any(not v.get(key) for key in RESERVED):
            raise ValueError('missing settings')
        project = v['COMPOSE_PROJECT_NAME']
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', project) or project in ('voicechat', 'voiceaichat'):
            raise ValueError('unsafe project')
        if v['VC_DATA_VOLUME'] != project + '-server-data' or v['VC_DATA_VOLUME'] == 'voicechat-server-data':
            raise ValueError('unsafe volume')
        if self.role == 'primary' and (not v['VC_STAND_PORT'].isdigit() or not 1024 <= int(v['VC_STAND_PORT']) <= 65535):
            raise ValueError('invalid port')
        files = v['COMPOSE_FILE'].split(':')
        overlay = 'deploy/compose.stand.yml' if self.role == 'primary' else 'deploy/compose.stand-module.yml'
        if files[:2] != ['docker-compose.yml', overlay] or not all(files):
            raise ValueError('invalid chain')
        profiles = set(v['COMPOSE_PROFILES'].split(','))
        module_profiles = {'make', 'image-studio', 'reader', 'playwright-reader'}
        if (self.role == 'primary' and (not {'postgres', 'kanban'} <= profiles or profiles & {'public', '*'})) or \
                (self.role == 'module' and (len(profiles) != 1 or not profiles <= module_profiles)):
            raise ValueError('invalid profiles')
        if v['COMPOSE_PARALLEL_LIMIT'] != '1' or v['COMPOSE_BAKE'] != 'false':
            raise ValueError('unsafe build settings')
        if PRODUCTION_ENV.is_file() and os.access(PRODUCTION_ENV, os.R_OK):
            production = read_env(PRODUCTION_ENV).get('VC_REPO_DIR')
            if production and Path(production).resolve() == Path.cwd().resolve():
                raise ValueError('production checkout')
        self.head = self.run('git', 'rev-parse', 'HEAD').stdout.strip()
        if not re.fullmatch('[a-f0-9]{40}', self.head) or not re.fullmatch('[a-f0-9]{7,40}', v['VC_RELEASE_COMMIT']) or not self.head.startswith(v['VC_RELEASE_COMMIT']):
            raise ValueError('release mismatch')
        current = Path(v['VC_ENVIRONMENT_OVERRIDES']) / 'current.yml'
        if current.exists():
            files = [f for f in files if Path(f).resolve() != current.resolve()] + [str(current)]
        # Ambient Compose/VC settings cannot redirect the validated checkout.
        self.env = {k: val for k, val in os.environ.items() if not k.startswith(('COMPOSE_', 'VC_'))}
        self.env.update(v)
        self.env['COMPOSE_FILE'] = ':'.join(files)
        self.env['COMPOSE_PATH_SEPARATOR'] = ':'
        release = json.loads(Path('apps/server/release.json').read_text())
        self.env.update(VC_APPLICATION_VERSION=v['VC_RELEASE_VERSION'], VC_APPLICATION_COMMIT=self.head,
                        VC_APPLICATION_API_VERSION=str(release['apiVersion']),
                        VC_APPLICATION_DATA_VERSION=str(release['dataVersion']))
        self.model = json.loads(self.compose('config', '--format', 'json').stdout)
        services = self.model['services']
        expected_builds = {'voicechat', 'automation-runner'} if self.role == 'primary' else set()
        if {name for name, service in services.items() if service.get('build')} != expected_builds:
            raise ValueError('unexpected build services')
        if self.model.get('name') != project:
            raise ValueError('project mismatch')
        for volume in self.model.get('volumes', {}).values():
            if volume.get('name') == 'voicechat-server-data':
                raise ValueError('production volume')
        if self.model.get('volumes', {}).get('vc-data', {}).get('name') != v['VC_DATA_VOLUME']:
            raise ValueError('volume mismatch')
        if self.role == 'module':
            expected_services = {
                'make': {'make'},
                'image-studio': {'image-studio'},
                'reader': {'reader'},
                'playwright-reader': {'playwright-reader', 'browser-runner'},
            }[next(iter(profiles))]
            if set(services) != expected_services:
                raise ValueError('invalid module services')
        for name, service in services.items():
            if service.get('container_name') or service.get('network_mode') == 'host':
                raise ValueError('non-isolated service')
            if name == 'caddy':
                if service.get('profiles') != ['public']:
                    raise ValueError('public proxy enabled')
                continue
            for port in service.get('ports', []):
                if self.role == 'module' or name != 'voicechat' or port.get('host_ip') != '127.0.0.1' or str(port.get('published')) != v['VC_STAND_PORT'] or port.get('target') != 8787:
                    raise ValueError('unsafe published port')
            for mount in service.get('volumes', []):
                if mount.get('type') == 'bind' and any(mount.get(k, '').startswith('/run/voicechat') for k in ('source', 'target')):
                    raise ValueError('production socket')
            if self.role == 'module':
                hosts = service.get('extra_hosts', {})
                if not (hosts.get('host.docker.internal') == 'host-gateway' if isinstance(hosts, dict)
                        else 'host.docker.internal:host-gateway' in hosts):
                    raise ValueError('missing Docker host gateway')
        self.timeout = float(v.get('VC_ENVIRONMENT_START_TIMEOUT', os.environ.get('VC_ENVIRONMENT_START_TIMEOUT', '300')))
        if not 0 < self.timeout <= 3600:
            raise ValueError('invalid health timeout')

    def begin(self, stage, code):
        self.stage, self.code = stage, code
        self.emit('running')

    def active(self, service):
        return not service.get('profiles') or bool(set(service['profiles']) & set(self.values['COMPOSE_PROFILES'].split(',')))

    def healthy(self, timeout):
        if self.role == 'primary':
            response = self.run('curl', '-fsS', '--max-time', str(max(0.1, min(5, timeout))),
                                'http://127.0.0.1:' + self.values['VC_STAND_PORT'] + '/api/health', timeout=max(1, timeout))
            health = json.loads(response.stdout)
            if health.get('ok') is not True or health.get('application', {}).get('commit') != self.head:
                return False
        ids = self.compose('ps', '-a', '-q', timeout=10).stdout.split()
        if not ids:
            return False
        containers = json.loads(self.run(self.docker, 'inspect', *ids, timeout=10).stdout)
        seen = set()
        for item in containers:
            name = item.get('Config', {}).get('Labels', {}).get('com.docker.compose.service')
            seen.add(name)
            state = item.get('State', {})
            if state.get('Status') != 'running':
                return False
            configured = item.get('Config', {}).get('Healthcheck', {}).get('Test', [])
            if (configured and configured != ['NONE']) or 'Health' in state:
                if state.get('Health', {}).get('Status') != 'healthy':
                    return False
        return all(name in seen for name, service in self.model['services'].items() if self.active(service))

    def provision(self):
        self.begin('build', 25)
        for name in (('voicechat', 'automation-runner') if self.role == 'primary' else ()):
            self.compose('build', name)
        self.emit('passed')
        self.begin('pull', 20)
        images = {s['image'] for s in self.model['services'].values() if self.active(s) and not s.get('build')}
        for image in sorted(images):
            if self.run(self.docker, 'image', 'inspect', image, check=False).returncode:
                self.run(self.docker, 'pull', image)
        self.emit('passed')
        self.begin('start', 30)
        self.compose('up', '-d', '--no-build', '--pull', 'never', '--remove-orphans')
        self.emit('passed')
        self.begin('health', 30)
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            try:
                if self.healthy(deadline - time.monotonic()):
                    self.emit('passed')
                    return
            except (ValueError, OSError, subprocess.SubprocessError):
                pass
            time.sleep(min(2, max(0, deadline - time.monotonic())))
        diagnostics = (('ps', '-a'), ('logs', '--tail', '50', 'voicechat')) if self.role == 'primary' else (('ps', '-a'), ('logs', '--tail', '50'))
        for args in diagnostics:
            result = self.compose(*args, check=False, timeout=15)
            for line in (result.stdout + result.stderr).splitlines():
                self.emit('running', line)
        raise ValueError('health timeout')

    def remove(self, delete_data):
        self.begin('down', 30)
        self.compose('down', '--remove-orphans', *(['--volumes'] if delete_data else []))
        self.emit('passed')
        if delete_data:
            self.begin('volumes', 30)
            volumes = self.run(self.docker, 'volume', 'ls', '-q', '--filter',
                               'label=com.docker.compose.project=' + self.values['COMPOSE_PROJECT_NAME']).stdout.split()
            volumes = sorted(set(volumes + [self.values['VC_DATA_VOLUME']]))
            if 'voicechat-server-data' in volumes:
                raise ValueError('production volume')
            for volume in volumes:
                self.run(self.docker, 'volume', 'rm', '-f', volume)
            self.emit('passed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['provision', 'remove'])
    parser.add_argument('--operation', required=True)
    parser.add_argument('--role', choices=['primary', 'module'], default='primary')
    parser.add_argument('--delete-data', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}', args.operation) or (args.delete_data and args.action != 'remove'):
        return 2
    stand = Stand(args.action, args.role)
    try:
        if args.action == 'provision':
            stand.emit('running')
        stand.config()
        if args.action == 'provision':
            stand.emit('passed')
            stand.provision()
        else:
            stand.remove(args.delete_data)
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError):
        stand.emit('failed', 'Stand operation failed')
        return stand.code
    return 0


if __name__ == '__main__':
    sys.exit(main())
