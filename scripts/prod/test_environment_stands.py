"""Stand lifecycle contracts; no daemon or listener is started."""
import json
import os
import re
import secrets
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from environment_stand import Stand, RESERVED

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
HEAD = 'a' * 40
SECRET = secrets.token_hex(24)
PROJECT = os.environ.get('COMPOSE_PROJECT_NAME', 'dc_133bc946698c4a70ae585365')
PORT = os.environ.get('DELIVERY_PORTS', '23000').replace(',', ' ').split()[0]

FAKE = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
with open(os.environ['FAKE_LOG'], 'a') as out:
    out.write(json.dumps({'tool': pathlib.Path(sys.argv[0]).name, 'args': args,
        'metadata': {k:v for k,v in os.environ.items() if k.startswith('VC_APPLICATION_')},
        'chain': os.environ.get('COMPOSE_FILE')}) + '\n')
if os.environ.get('NO_NATIVE') and args[:1] == ['pull'] and '--platform' not in args:
    print('no matching manifest for linux/arm64/v8 in the manifest list entries', file=sys.stderr)
    sys.exit(1)
fail = os.environ.get('FAIL', '')
if fail and ' '.join(args).startswith(fail):
    print(os.environ.get('SECRET', ''), file=sys.stderr)
    sys.exit(1)
if pathlib.Path(sys.argv[0]).name == 'git': print('a' * 40)
elif pathlib.Path(sys.argv[0]).name == 'curl':
    print(json.dumps({'ok': not os.environ.get('HEALTH_NOT_OK'), 'application': {'commit': os.environ.get('HEALTH_COMMIT', 'a'*40)}}))
elif args == ['compose', 'config', '--format', 'json']:
    print(pathlib.Path('model.json').read_text())
elif args[:2] == ['image', 'inspect']: sys.exit(0 if os.environ.get('CACHED') else 1)
elif args == ['compose', 'ps', '-a', '-q']: print('container1 container2 container3')
elif 'psql' in args and '-Atqc' in args: print(os.environ.get('DB_TABLE_COUNT', '0'))
elif args[0] == 'inspect':
    model = json.loads(pathlib.Path('model.json').read_text())
    print(json.dumps([{'Config': {'Labels': {'com.docker.compose.service': name},
        'Healthcheck': {'Test': ['CMD', 'true']}}, 'State': {'Status': 'running',
        'Health': {'Status': os.environ.get('HEALTH', 'healthy')}}}
        for name in model['services'] if name != 'caddy' and name != os.environ.get('MISSING_SERVICE')]))
elif args[:2] == ['volume', 'ls']: print(os.environ.get('VOLUMES', ''))
elif args[:2] in (['compose', 'ps'], ['compose', 'logs']): print(os.environ['SECRET'])
'''


class StandTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name in ('docker', 'curl', 'git'):
            script = self.bin / name
            script.write_text(FAKE)
            script.chmod(0o700)
        (self.root / 'apps/server').mkdir(parents=True)
        (self.root / 'apps/server/release.json').write_text('{"apiVersion":"1.2.0","dataVersion":3}')
        self.values = dict(zip(RESERVED, ['stand', PROJECT, 'docker-compose.yml:deploy/compose.stand.yml',
            'postgres,kanban', '1', 'false', PORT, PROJECT + '-server-data', '127.0.0.1',
            str(self.root / 'overrides'), 'postgres://stand', 'remote', '1.2.3', HEAD[:12]]))
        self.values['SECRET'] = SECRET
        self.model = {'name': PROJECT, 'services': {'voicechat': {'build': {'context': '.'}},
            'automation-runner': {'build': {'context': '.'}}, 'postgres': {'image': 'postgres:16'},
            'caddy': {'profiles': ['public'], 'image': 'caddy:2'}},
            'volumes': {'vc-data': {'name': PROJECT + '-server-data'}}}
        self.env = {**os.environ, 'PATH': str(self.bin) + ':' + os.environ['PATH'],
            'DOCKER': str(self.bin / 'docker'), 'FAKE_LOG': str(self.root / 'calls'),
            'VC_ENVIRONMENT_START_TIMEOUT': '0.05', 'SECRET': SECRET}

    def invoke(self, action='provision', args=None, role='primary', **env):
        (self.root / '.env').write_text(''.join(k + "='" + v + "'\n" for k, v in self.values.items()))
        (self.root / 'model.json').write_text(json.dumps(self.model))
        (self.root / 'calls').write_text('')
        result = subprocess.run(['bash', str(HERE / ('environment-' + action + '.sh')),
            *(args if args is not None else ['--operation', 'op1', '--role', role])], cwd=self.root,
            env={**self.env, **env}, capture_output=True, text=True)
        self.assertNotIn(SECRET, result.stdout + result.stderr)
        rows = [json.loads(line) for line in result.stdout.splitlines()]
        for row in rows:
            self.assertEqual(set(row), {'stage', 'status', 'log'})
        calls = [json.loads(line) for line in (self.root / 'calls').read_text().splitlines()]
        return result.returncode, rows, calls

    def test_success_stages_metadata_and_sequential_builds(self):
        code, rows, calls = self.invoke(COMPOSE_FILE='production.yml', VC_DATA_VOLUME='voicechat-server-data')
        self.assertEqual(code, 0)
        self.assertEqual([(r['stage'], r['status']) for r in rows],
            [(stage, status) for stage in ('config', 'build', 'pull', 'start', 'health') for status in ('running', 'passed')])
        builds = [c for c in calls if c['args'][:2] == ['compose', 'build']]
        self.assertEqual([c['args'][-1] for c in builds], ['voicechat', 'automation-runner'])
        self.assertEqual(builds[0]['metadata'], {'VC_APPLICATION_VERSION': '1.2.3',
            'VC_APPLICATION_COMMIT': HEAD, 'VC_APPLICATION_API_VERSION': '1.2.0', 'VC_APPLICATION_DATA_VERSION': '3'})
        self.assertTrue(all(c['chain'] == self.values['COMPOSE_FILE'] for c in builds))
        self.assertIn(['compose', 'up', '-d', '--no-build', '--pull', 'never', '--remove-orphans'], [c['args'] for c in calls])
        self.assertNotIn(['pull', 'caddy:2'], [c['args'] for c in calls])

    def test_snapshot_restore_precedes_start_and_refuses_nonempty_database(self):
        snapshot = self.root / 'snapshot.dump'
        snapshot.write_bytes(b'archive')
        self.values['VC_ADMIN_PASSWORD'] = 'stand-only-password'
        code, rows, calls = self.invoke(args=['--operation', 'op1', '--snapshot', str(snapshot)], DB_TABLE_COUNT='0')
        self.assertEqual(code, 0)
        stages = [r['stage'] for r in rows]
        self.assertLess(stages.index('restore'), stages.index('start'))
        self.assertEqual(sum('pg_restore' in c['args'] for c in calls), 1)
        self.assertEqual(sum('psql' in c['args'] and '-Atqc' not in c['args'] for c in calls), 1)
        self.assertNotIn('stand-only-password', json.dumps(calls))

        code, rows, calls = self.invoke(args=['--operation', 'op1', '--snapshot', str(snapshot)], DB_TABLE_COUNT='1')
        self.assertEqual(code, 28)
        self.assertEqual(rows[-1]['stage'], 'restore')
        self.assertFalse(any('pg_restore' in c['args'] for c in calls))

    def test_all_failure_codes_and_fail_fast(self):
        for failure, code, stage in [('compose config', 10, 'config'), ('compose build voicechat', 25, 'build'),
                ('compose build automation-runner', 25, 'build'), ('pull', 20, 'pull'), ('compose up', 30, 'start')]:
            with self.subTest(failure=failure):
                actual, rows, _ = self.invoke(FAIL=failure)
                self.assertEqual(actual, code)
                self.assertEqual((rows[-1]['stage'], rows[-1]['status']), (stage, 'failed'))
        for action in ('provision', 'remove'):
            self.assertEqual(self.invoke(action, args=[])[0], 2)
            self.assertEqual(self.invoke(action, args=['--operation', '../bad'])[0], 2)

    def test_env_validation_for_both_commands(self):
        original = dict(self.values)
        invalid = [(key, '') for key in RESERVED] + [('VC_STAND_PORT', '1023'), ('VC_STAND_PORT', '65536'),
            ('VC_RELEASE_COMMIT', 'badcommit'), ('VC_DATA_VOLUME', 'voicechat-server-data'),
            ('COMPOSE_FILE', 'docker-compose.yml:deploy/compose.stand.yml-evil'), ('COMPOSE_PROFILES', 'kanban'),
            ('COMPOSE_PROFILES', 'postgres,kanban,public')]
        for action in ('provision', 'remove'):
            for key, value in invalid:
                with self.subTest(action=action, key=key, value=value):
                    self.values = {**original, key: value}
                    code, _, calls = self.invoke(action)
                    self.assertEqual(code, 10)
                    self.assertFalse(any(c['tool'] == 'docker' for c in calls))
        self.values = original

    def test_resolved_production_volume_and_unexpected_build_refused(self):
        self.model['volumes']['other'] = {'name': 'voicechat-server-data'}
        self.assertEqual(self.invoke()[0], 10)
        del self.model['volumes']['other']
        self.model['services']['postgres']['build'] = {'context': '.'}
        self.assertEqual(self.invoke()[0], 10)

    def test_resolved_ports_and_deploy_socket_are_refused(self):
        service = self.model['services']['voicechat']
        service['ports'] = [{'host_ip': '0.0.0.0', 'published': PORT, 'target': 8787}]
        self.assertEqual(self.invoke()[0], 10)
        del service['ports']
        service['volumes'] = [{'type': 'bind', 'source': '/run/voicechat', 'target': '/run/voicechat'}]
        self.assertEqual(self.invoke('remove')[0], 10)

    def test_malformed_env_never_reaches_docker(self):
        self.invoke()
        (self.root / '.env').write_text('SECRET="unterminated\n')
        (self.root / 'calls').write_text('')
        result = subprocess.run(['bash', str(HERE / 'environment-provision.sh'), '--operation', 'op1'],
            cwd=self.root, env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 10)
        self.assertEqual((self.root / 'calls').read_text(), '')
        self.assertNotIn('unterminated', result.stdout + result.stderr)

    def test_production_checkout_is_refused(self):
        self.invoke()
        production = self.root / 'production.env'
        production.write_text('VC_REPO_DIR=' + str(self.root))
        previous = Path.cwd()
        try:
            os.chdir(self.root)
            with patch('environment_stand.PRODUCTION_ENV', production):
                with self.assertRaisesRegex(ValueError, 'production checkout'):
                    Stand('provision').config()
        finally:
            os.chdir(previous)

    def test_health_failures_and_redacted_diagnostics(self):
        for env in ({'HEALTH': 'unhealthy'}, {'HEALTH_COMMIT': 'b'*40}, {'FAIL': '-fsS'}, {'HEALTH_NOT_OK': '1'}, {'MISSING_SERVICE': 'postgres'}):
            code, rows, calls = self.invoke(**env)
            self.assertEqual(code, 30)
            self.assertEqual(rows[-1]['stage'], 'health')
            self.assertTrue(any('[redacted]' in r['log'] for r in rows))
            self.assertIn(['compose', 'logs', '--tail', '50', 'voicechat'], [c['args'] for c in calls])
            self.assertFalse(any(c['args'][:2] == ['compose', 'down'] for c in calls))

    def test_cached_images_and_override_chain(self):
        override = Path(self.values['VC_ENVIRONMENT_OVERRIDES'])
        override.mkdir()
        (override / 'current.yml').touch()
        code, _, calls = self.invoke(CACHED='1')
        self.assertEqual(code, 0)
        self.assertFalse(any(c['args'][0] == 'pull' for c in calls))
        self.assertTrue(any(c['chain'] == self.values['COMPOSE_FILE'] + ':' + str(override / 'current.yml') for c in calls))

    def test_amd64_only_images_are_pulled_for_emulation(self):
        code, _, calls = self.invoke(NO_NATIVE='1')
        self.assertEqual(code, 0)
        pulls = [c['args'] for c in calls if c['args'][:1] == ['pull']]
        self.assertEqual(pulls, [['pull', 'postgres:16'], ['pull', '--platform', 'linux/amd64', 'postgres:16']])

    def test_module_role_has_no_build_or_core_health(self):
        self.values['COMPOSE_FILE'] = 'docker-compose.yml:deploy/compose.stand-module.yml'
        self.values['COMPOSE_PROFILES'] = 'make'
        self.model = {'name': PROJECT, 'services': {'make': {
            'image': 'example/make:1', 'extra_hosts': {'host.docker.internal': 'host-gateway'}}},
            'volumes': {'vc-data': {'name': PROJECT + '-server-data'}}}
        code, rows, calls = self.invoke(role='module')
        self.assertEqual(code, 0)
        self.assertEqual([(r['stage'], r['status']) for r in rows],
            [(stage, status) for stage in ('config', 'build', 'pull', 'start', 'health') for status in ('running', 'passed')])
        self.assertFalse(any(c['args'][:2] == ['compose', 'build'] for c in calls))
        self.assertFalse(any(c['tool'] == 'curl' for c in calls))

    def test_module_role_rejects_unsafe_models_and_settings(self):
        self.values['COMPOSE_FILE'] = 'docker-compose.yml:deploy/compose.stand-module.yml'
        self.values['COMPOSE_PROFILES'] = 'make'
        safe = {'image': 'example/make:1', 'extra_hosts': {'host.docker.internal': 'host-gateway'}}
        self.model = {'name': PROJECT, 'services': {'make': safe},
            'volumes': {'vc-data': {'name': PROJECT + '-server-data'}}}
        for mutation in ('core', 'postgres', 'extra', 'port', 'build', 'gateway', 'profiles', 'chain'):
            with self.subTest(mutation=mutation):
                self.model['services'] = {'make': dict(safe)}
                self.values['COMPOSE_PROFILES'] = 'make'
                self.values['COMPOSE_FILE'] = 'docker-compose.yml:deploy/compose.stand-module.yml'
                if mutation in ('core', 'postgres'):
                    self.model['services'][mutation if mutation == 'postgres' else 'voicechat'] = dict(safe)
                elif mutation == 'extra': self.model['services']['reader'] = dict(safe)
                elif mutation == 'port': self.model['services']['make']['ports'] = [{'published': 8788, 'target': 8788}]
                elif mutation == 'build': self.model['services']['make']['build'] = {'context': '.'}
                elif mutation == 'gateway': self.model['services']['make'].pop('extra_hosts')
                elif mutation == 'profiles': self.values['COMPOSE_PROFILES'] = 'make,reader'
                else: self.values['COMPOSE_FILE'] = 'docker-compose.yml:deploy/compose.stand.yml'
                self.assertEqual(self.invoke(role='module')[0], 10)

    def test_link_ports_publish_only_listed_loopback_targets(self):
        self.values['VC_STAND_LINK_PORTS'] = 'postgres:5432:17100'
        self.model['services']['postgres']['ports'] = [{'host_ip': '127.0.0.1', 'published': '17100', 'target': 5432}]
        code, _, calls = self.invoke()
        self.assertEqual(code, 0)
        links = self.root / 'overrides' / 'stand-links.yml'
        self.assertIn('      - "127.0.0.1:17100:5432"', links.read_text())
        chain = next(c['chain'] for c in calls if c['args'][:2] == ['compose', 'config'])
        self.assertTrue(chain.endswith(str(links)))
        for mutation in ('unlisted', 'public', 'range', 'malformed', 'duplicate'):
            with self.subTest(mutation=mutation):
                self.values['VC_STAND_LINK_PORTS'] = 'postgres:5432:17100'
                self.model['services']['postgres']['ports'] = [{'host_ip': '127.0.0.1', 'published': '17100', 'target': 5432}]
                if mutation == 'unlisted': self.model['services']['postgres']['ports'][0]['published'] = '17101'
                elif mutation == 'public': self.model['services']['postgres']['ports'][0]['host_ip'] = '0.0.0.0'
                elif mutation == 'range': self.values['VC_STAND_LINK_PORTS'] = 'postgres:5432:17900'
                elif mutation == 'malformed': self.values['VC_STAND_LINK_PORTS'] = 'postgres:5432'
                else: self.values['VC_STAND_LINK_PORTS'] = 'postgres:5432:17100,make:8788:17100'
                self.assertEqual(self.invoke()[0], 10)

    def test_module_machine_runs_several_modules(self):
        self.values['COMPOSE_FILE'] = 'docker-compose.yml:deploy/compose.stand-module.yml'
        self.values['COMPOSE_PROFILES'] = 'make,reader'
        self.values['VC_STAND_LINK_PORTS'] = 'make:8788:17200,reader:8790:17201'
        safe = {'image': 'example/module:1', 'extra_hosts': {'host.docker.internal': 'host-gateway'}}
        self.model = {'name': PROJECT, 'services': {
            'make': {**safe, 'ports': [{'host_ip': '127.0.0.1', 'published': '17200', 'target': 8788}]},
            'reader': {**safe, 'ports': [{'host_ip': '127.0.0.1', 'published': '17201', 'target': 8790}]}},
            'volumes': {'vc-data': {'name': PROJECT + '-server-data'}}}
        self.assertEqual(self.invoke(role='module')[0], 0)

    def test_remove_keep_data_delete_data_and_errors(self):
        code, rows, calls = self.invoke('remove')
        self.assertEqual(code, 0)
        self.assertEqual([r['stage'] for r in rows], ['down', 'down'])
        self.assertIn(['compose', 'down', '--remove-orphans'], [c['args'] for c in calls])
        self.assertFalse(any(c['args'][0] == 'volume' for c in calls))
        args = ['--operation', 'op1', '--delete-data']
        code, rows, calls = self.invoke('remove', args=args, VOLUMES=PROJECT + '_postgres')
        self.assertEqual(code, 0)
        self.assertEqual([r['stage'] for r in rows], ['down', 'down', 'volumes', 'volumes'])
        self.assertIn(['compose', 'down', '--remove-orphans', '--volumes'], [c['args'] for c in calls])
        self.assertIn(['volume', 'rm', '-f', PROJECT + '-server-data'], [c['args'] for c in calls])
        self.assertIn(['volume', 'rm', '-f', PROJECT + '_postgres'], [c['args'] for c in calls])
        for failure in ('compose down', 'volume ls', 'volume rm'):
            self.assertEqual(self.invoke('remove', args=args, FAIL=failure)[0], 30)
        code, _, calls = self.invoke('remove', args=args, VOLUMES='voicechat-server-data')
        self.assertEqual(code, 30)
        self.assertFalse(any(c['args'][:2] == ['volume', 'rm'] for c in calls))
        self.assertTrue((self.root / '.env').exists())


class StandComposeTest(unittest.TestCase):
    def test_production_defaults_match_literal_urls(self):
        docker = shutil.which('docker')
        if not docker or subprocess.run([docker, 'compose', 'version'], capture_output=True).returncode:
            self.skipTest('Docker Compose unavailable')
        source = (ROOT / 'docker-compose.yml').read_text()
        variables = ('VC_CORE_URL', 'VC_KANBAN_URL', 'VC_MAKE_URL', 'VC_READER_URL',
            'VC_PLAYWRIGHT_READER_URL', 'VC_IMAGE_STUDIO_URL', 'VC_LLM_RUNNER_CLAUDE_URL',
            'VC_LLM_RUNNER_CODEX_URL', 'VC_LLM_RUNNER_HEALTH_URL', 'VC_TTS_RUNNER_URL',
            'VC_STT_RUNNER_URL', 'VC_BROWSER_RUNNER_URL', 'VC_MCP_PUBLIC_BASE',
            'VC_KANBAN_MCP_PUBLIC_BASE', 'VC_MAKE_MCP_PUBLIC_BASE', 'VC_READER_MCP_PUBLIC_BASE')
        legacy = source
        for variable in variables:
            legacy = re.sub(r'\$\{' + variable + r':-([^}]+)\}', r'\1', legacy)
        with tempfile.TemporaryDirectory() as directory:
            current = Path(directory) / 'current.yml'
            literal = Path(directory) / 'literal.yml'
            current.write_text(source)
            literal.write_text(legacy)
            env = {k: v for k, v in os.environ.items() if not k.startswith(('COMPOSE_', 'VC_'))}
            # Caddy requires a public host even when its profile is off; any value works for both files.
            env['VC_PUBLIC_HOST'] = 'stand.test'
            def config(path):
                result = subprocess.run([docker, 'compose', '-f', str(path), 'config', '--format', 'json'],
                    cwd=ROOT, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout)
            self.assertEqual(config(current), config(literal))

    def test_real_compose_overlay(self):
        docker = shutil.which('docker')
        if not docker:
            self.skipTest('Docker unavailable')
        available = subprocess.run([docker, 'compose', 'version'], capture_output=True, text=True)
        if available.returncode:
            self.skipTest('Docker Compose unavailable')
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / 'stand.env'
            env_file.write_text('VC_STAND_PORT=' + PORT + '\nVC_DATA_VOLUME=' + PROJECT + '-server-data\nVC_PUBLIC_HOST=127.0.0.1\n')
            env = {k: v for k, v in os.environ.items() if not k.startswith(('COMPOSE_', 'VC_'))}
            result = subprocess.run([docker, 'compose', '--project-name', PROJECT, '--env-file', str(env_file),
                '-f', 'docker-compose.yml', '-f', 'deploy/compose.stand.yml', '--profile', 'public',
                'config', '--format', 'json'], cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            model = json.loads(result.stdout)
            core = model['services']['voicechat']
            self.assertEqual([(p['host_ip'], str(p['published']), p['target']) for p in core['ports']], [('127.0.0.1', PORT, 8787)])
            self.assertEqual(model['services']['caddy']['profiles'], ['public'])
            self.assertEqual([(v['type'], v['source'], v['target']) for v in core['volumes']], [('volume', 'vc-data', '/data')])
            self.assertFalse(any(s.get('ports') for name, s in model['services'].items() if name not in ('voicechat', 'caddy')))
            self.assertEqual(model['volumes']['vc-data']['name'], PROJECT + '-server-data')
            # The primary runs only the modules whose profiles Kanban lists.
            def services(*profiles):
                args = [a for p in profiles for a in ('--profile', p)]
                listed = subprocess.run([docker, 'compose', '--project-name', PROJECT, '--env-file', str(env_file),
                    '-f', 'docker-compose.yml', '-f', 'deploy/compose.stand.yml', *args, 'config', '--services'],
                    cwd=ROOT, env=env, capture_output=True, text=True)
                self.assertEqual(listed.returncode, 0, listed.stderr)
                return set(listed.stdout.split())
            modules = {'make', 'image-studio', 'reader', 'playwright-reader', 'browser-runner'}
            self.assertEqual(services('postgres', 'kanban') & modules, set())
            self.assertEqual(services('postgres', 'kanban', 'reader') & modules, {'reader'})
            self.assertEqual(services('postgres', 'kanban', 'make', 'playwright-reader') & modules, {'make', 'playwright-reader', 'browser-runner'})


if __name__ == '__main__':
    unittest.main()
