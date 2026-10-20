"""Unchanged-runtime recovery must preserve failed deployment evidence."""

import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.request

from recover_unchanged_deployment import main, recover_record, verify_local_docker, read_health, NoHealthRedirect


class UnchangedDeploymentRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.record = {
            'schemaVersion': 1, 'operationId': 'op1', 'state': 'uncertain',
            'phase': 'deploying', 'exitCode': 1, 'pid': 12345,
            'previousCommit': 'a' * 40, 'createdAt': 1760000000000,
            'request': {'expectedCommit': 'b' * 40, 'healthUrl': 'http://127.0.0.1:8787/api/health'},
        }
        self.health = {'ok': True, 'application': {'applicationId': 'core', 'commit': 'a' * 40}}
        self.containers = [{
            'Id': name, 'Image': 'sha256:' + 'c' * 64, 'Created': '2025-01-01T00:00:00Z',
            'Config': {'Labels': {'com.docker.compose.project': 'production', 'com.docker.compose.service': name}, 'Env': ['PORT=8787']},
            'NetworkSettings': {'Ports': {'8787/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '8787'}]}} if name == 'voicechat' else {'Ports': {}},
            'State': {'Running': True, 'StartedAt': '2025-01-02T00:00:00Z', 'Health': {'Status': 'healthy'}},
        } for name in ['voicechat', 'postgres']]

    def recover(self):
        return recover_record(self.record, self.containers, self.health, 'production', ['voicechat', 'postgres'])

    def test_known_failure_recovers_without_claiming_success_or_modifying_input(self):
        before = copy.deepcopy(self.record)
        result = self.recover()
        self.assertEqual(self.record, before)
        self.assertEqual(result['state'], 'recovered')
        self.assertEqual(result['exitCode'], 1)
        self.assertNotIn('composeCompleted', result)
        self.assertEqual(result['observedCommit'], 'a' * 40)
        self.assertEqual(set(result['operatorRecovery']['containers']), {'voicechat', 'postgres'})

    def test_health_from_one_stack_cannot_clear_another_stacks_inventory(self):
        # Both stacks run the same old commit; only the operation's target port
        # distinguishes its health from an unrelated unchanged Compose project.
        self.containers[0]['NetworkSettings']['Ports']['8787/tcp'][0]['HostPort'] = '18787'
        with self.assertRaisesRegex(ValueError, 'health_target_not_bound_to_core'):
            self.recover()

    def test_local_core_bindings_accept_exact_and_same_family_wildcards(self):
        for host, published in [('127.0.0.1', '127.0.0.1'), ('127.0.0.1', '0.0.0.0'),
                                ('[::1]', '::1'), ('[::1]', '::')]:
            with self.subTest(host=host, published=published):
                self.record['request']['healthUrl'] = f'http://{host}:18787/api/health'
                self.containers[0]['Config']['Env'] = ['PORT=8799']
                self.containers[0]['NetworkSettings']['Ports'] = {'8799/tcp': [{'HostIp': published, 'HostPort': '18787'}]}
                self.assertEqual(self.recover()['state'], 'recovered')
        self.containers[0]['Config']['Env'] = []
        self.record['request']['healthUrl'] = 'http://127.0.0.1:8787/api/health'
        self.containers[0]['NetworkSettings']['Ports'] = {'8787/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '8787'}]}
        self.assertEqual(self.recover()['state'], 'recovered')

    def test_unbound_ambiguous_and_indirect_health_targets_are_refused(self):
        for target in ['http://localhost:8787/api/health', 'http://192.0.2.1:8787/api/health',
                       'https://127.0.0.1:8787/api/health', 'http://user:password@127.0.0.1:8787/api/health',
                       'http://127.0.0.1:8787/api/health?redirect=other', 'http://127.0.0.1:8787/api/health#other',
                       'http://127.0.0.1:8787/other', 'http://127.0.0.1:0/api/health',
                       'http://127.0.0.1:\n8787/api/health']:
            with self.subTest(target=target), patch.dict(self.record['request'], healthUrl=target), self.assertRaises(ValueError):
                self.recover()
        core = self.containers[0]
        for ports in [{}, {'8787/tcp': None}, {'8799/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '8787'}]},
                      {'8787/tcp': [{'HostIp': '::', 'HostPort': '8787'}]},
                      {'8787/tcp': [{'HostIp': '127.0.0.2', 'HostPort': '8787'}]}]:
            with self.subTest(ports=ports), patch.dict(core['NetworkSettings'], Ports=ports), self.assertRaises(ValueError):
                self.recover()
        for env in [['PORT=invalid'], ['PORT=8787', 'PORT=8799']]:
            with patch.dict(core['Config'], Env=env), self.assertRaises(ValueError):
                self.recover()

    def test_remote_docker_cannot_supply_port_binding_evidence_for_local_health(self):
        for context, environment in [
            ('ssh://other-host', {}), ('tcp://192.0.2.1:2375', {}),
            ('unix:///var/run/docker.sock', {'DOCKER_HOST': 'tcp://192.0.2.1:2375'}),
            ('unix://other-host/socket', {}), ('', {}), (None, {}),
        ]:
            with self.subTest(context=context, environment=environment), self.assertRaisesRegex(ValueError, 'local_docker_required'):
                verify_local_docker(lambda argv: json.dumps(context), environment)
        calls = []
        verify_local_docker(lambda argv: calls.append(argv) or json.dumps('unix:///var/run/docker.sock'), {})
        self.assertEqual(calls, [['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']])

    def test_health_request_disables_proxies_and_refuses_redirects(self):
        opener = Mock()
        opener.open.return_value = io.BytesIO(json.dumps(self.health).encode())
        with patch('recover_unchanged_deployment.urllib.request.build_opener', return_value=opener) as build:
            self.assertEqual(read_health(self.record['request']['healthUrl']), self.health)
        handlers = build.call_args.args
        self.assertEqual(len(handlers), 2)
        self.assertIsInstance(handlers[0], urllib.request.ProxyHandler)
        self.assertEqual(handlers[0].proxies, {})
        self.assertIsInstance(handlers[1], NoHealthRedirect)
        for status in [301, 302, 303, 307, 308]:
            with self.subTest(status=status), self.assertRaisesRegex(ValueError, 'health_redirect_refused'):
                handlers[1].redirect_request(None, None, status, 'redirect', {}, 'http://127.0.0.1:18787/api/health')
        opener.open.assert_called_once_with(self.record['request']['healthUrl'], timeout=10)

    def test_unknown_completion_success_and_fenced_operations_cannot_be_cleared(self):
        for changes in [
            {'exitCode': None}, {'exitCode': 0}, {'exitCode': -9}, {'exitCode': True},
            {'exitCode': 137}, {'exitCode': 143},
            {'state': 'running'}, {'phase': 'preparing'}, {'composeCompleted': True},
            {'previousCommit': 'short'}, {'request': {'delivery': {'epoch': 1}}},
            {'request': {'deliveryFenceSha256': 'f' * 64}},
        ]:
            with self.subTest(changes=changes), patch.dict(self.record, changes), self.assertRaises(ValueError):
                self.recover()

    def test_docker_nanosecond_timestamps_on_older_host_python(self):
        self.containers[0]['Created'] = '2025-01-01T00:00:00.880113768Z'
        self.containers[0]['State']['StartedAt'] = '2025-01-02T00:00:00.964297217Z'
        self.assertEqual(self.recover()['state'], 'recovered')
        self.containers[0]['State']['StartedAt'] = '2026-01-01T00:00:00.964297217Z'
        with self.assertRaisesRegex(ValueError, 'container_changed_after_operation'):
            self.recover()

    def test_changed_or_unhealthy_runtime_is_refused(self):
        for changes in [
            {'Running': False}, {'Paused': True}, {'Restarting': True},
            {'Health': {'Status': 'unhealthy'}}, {'StartedAt': '2026-01-01T00:00:00Z'},
        ]:
            with self.subTest(changes=changes), patch.dict(self.containers[0]['State'], changes), self.assertRaises(ValueError):
                self.recover()
        with patch.dict(self.containers[0], {'Created': '2026-01-01T00:00:00Z'}), self.assertRaises(ValueError):
            self.recover()
        for health in [{}, {'ok': True, 'application': {'applicationId': 'core', 'commit': 'b' * 40}}]:
            with self.assertRaises(ValueError):
                recover_record(self.record, self.containers, health, 'production', ['voicechat', 'postgres'])

    def test_missing_extra_duplicate_and_foreign_containers_are_refused(self):
        for containers in [self.containers[:1], self.containers + [self.containers[0]]]:
            with self.assertRaises(ValueError):
                recover_record(self.record, containers, self.health, 'production', ['voicechat', 'postgres'])
        labels = self.containers[1]['Config']['Labels']
        for changes in [{'com.docker.compose.project': 'other'}, {'com.docker.compose.service': 'unexpected'}]:
            with patch.dict(labels, changes), self.assertRaises(ValueError):
                self.recover()
        for expected in [[], ['voicechat'], ['voicechat', 'voicechat', 'postgres']]:
            with self.assertRaises(ValueError):
                recover_record(self.record, self.containers, self.health, 'production', expected)

    def test_cli_dry_run_apply_and_receipt_keep_the_operation_directory_scannable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            os.chmod(root, 0o700)
            self.record['request']['hostLock'] = str(root / 'host.lock')
            path = root / 'op1.json'
            path.write_text(json.dumps(self.record)); path.chmod(0o600)
            calls = []
            health_reads = []

            def run(argv, **kwargs):
                calls.append(argv)
                if argv[1] == 'context': return json.dumps('unix:///var/run/docker.sock')
                if argv[1] == 'ps': return 'voicechat\npostgres\n'
                if argv[1] == 'inspect': return json.dumps(self.containers)
                self.assertEqual(argv, ['docker', 'exec', 'voicechat', 'node', '/app/scripts/component-readiness.mjs'])
                return 'ready'

            def invoke(apply=False):
                argv = ['recover', '--operations', str(root), '--operation', 'op1',
                        '--project', 'production', '--services', 'voicechat,postgres'] + (['--apply'] if apply else [])
                output = io.StringIO()
                with patch('sys.argv', argv), patch('sys.stdout', output), \
                        patch('recover_unchanged_deployment.os.kill', side_effect=ProcessLookupError), \
                        patch('recover_unchanged_deployment.subprocess.check_output', side_effect=run), \
                        patch.dict(os.environ, {}, clear=True), \
                        patch('recover_unchanged_deployment.read_health', side_effect=lambda url: health_reads.append(url) or self.health):
                    main()
                return json.loads(output.getvalue())

            with patch.dict(self.containers[0]['NetworkSettings'], Ports={}), \
                    self.assertRaisesRegex(ValueError, 'health_target_not_bound_to_core'):
                invoke(True)
            self.assertEqual(health_reads, [])
            self.assertFalse(any(call[1] == 'exec' for call in calls))
            self.assertEqual(json.loads(path.read_text()), self.record)
            self.assertFalse((root / 'operator-recoveries').exists())
            self.assertFalse(invoke()['applied'])
            self.assertEqual(json.loads(path.read_text()), self.record)
            self.assertFalse((root / 'operator-recoveries').exists())
            self.assertTrue(invoke(True)['applied'])
            self.assertEqual(json.loads(path.read_text())['state'], 'recovered')
            receipt = root / 'operator-recoveries/op1.json'
            self.assertEqual(json.loads(receipt.read_text())['before'], self.record)
            self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(root.glob('*.json')), [path])
            with self.assertRaisesRegex(ValueError, 'operation_requires_other_recovery'):
                invoke(True)
            self.assertTrue(all(call[1] in ['context', 'ps', 'inspect', 'exec'] for call in calls))


if __name__ == '__main__':
    unittest.main()
