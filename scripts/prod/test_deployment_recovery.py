"""Unchanged-runtime recovery must preserve failed deployment evidence."""

import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from recover_unchanged_deployment import main, recover_record


class UnchangedDeploymentRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.record = {
            'schemaVersion': 1, 'operationId': 'op1', 'state': 'uncertain',
            'phase': 'deploying', 'exitCode': 1, 'pid': 12345,
            'previousCommit': 'a' * 40, 'createdAt': 1760000000000,
            'request': {'expectedCommit': 'b' * 40, 'healthUrl': 'http://127.0.0.1/health'},
        }
        self.health = {'ok': True, 'application': {'applicationId': 'core', 'commit': 'a' * 40}}
        self.containers = [{
            'Id': name, 'Image': 'sha256:' + 'c' * 64, 'Created': '2025-01-01T00:00:00Z',
            'Config': {'Labels': {'com.docker.compose.project': 'production', 'com.docker.compose.service': name}},
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

            def run(argv, **kwargs):
                calls.append(argv)
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
                        patch('recover_unchanged_deployment.urllib.request.urlopen', return_value=io.BytesIO(json.dumps(self.health).encode())):
                    main()
                return json.loads(output.getvalue())

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
            self.assertTrue(all(call[1] in ['ps', 'inspect', 'exec'] for call in calls))


if __name__ == '__main__':
    unittest.main()
