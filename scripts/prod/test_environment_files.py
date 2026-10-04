"""File migration adapters: fake Docker, real archive stream and lifecycle order."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from environment_stand import Stand

HERE = Path(__file__).resolve().parent


class FilesTest(unittest.TestCase):
    def test_snapshot_and_delta(self):
        for since in (None, '2026-10-04T01:02:03Z'):
            with self.subTest(since=since), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                docker = root / 'docker'
                log = root / 'calls'
                docker.write_text("#!/usr/bin/env python3\nimport json,os,sys\nwith open(os.environ['ARG_LOG'],'a') as f: f.write(json.dumps(sys.argv[1:])+'\\n')\nif sys.argv[1]=='run': sys.stdout.buffer.write(b'archive-bytes')\n")
                docker.chmod(0o700)
                result = subprocess.run(['bash', str(HERE / 'environment-files-snapshot.sh'),
                    *(['--since', since] if since else []), str(root)],
                    env={**os.environ, 'DOCKER': str(docker), 'ARG_LOG': str(log)}, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                final = json.loads(result.stdout.splitlines()[-1])
                archive = Path(final['path'])
                self.assertEqual(stat.S_IMODE(archive.stat().st_mode), 0o600)
                self.assertEqual(final['size'], len(b'archive-bytes'))
                self.assertEqual(final['sha256'], hashlib.sha256(b'archive-bytes').hexdigest())
                calls = [json.loads(line) for line in log.read_text().splitlines()]
                self.assertEqual(calls[0], ['volume', 'inspect', 'voicechat-server-data'])
                self.assertIn('type=volume,src=voicechat-server-data,dst=/data,readonly', calls[1])
                self.assertIn('--rm', calls[1])
                self.assertEqual([a for a in calls[1] if a.startswith('--newer=')], ['--newer=' + since] if since else [])

    def test_failure_removes_partial_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            docker = root / 'docker'
            docker.write_text('#!/bin/sh\necho partial\nexit 1\n'); docker.chmod(0o700)
            result = subprocess.run(['bash', str(HERE / 'environment-files-snapshot.sh'), directory],
                env={**os.environ, 'DOCKER': str(docker)}, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(list(root.glob('environment-files.*')), [])

    def stand(self):
        stand = Stand('provision')
        stand.values = {'VC_DATA_VOLUME': 'test-server-data', 'COMPOSE_PROJECT_NAME': 'test', 'COMPOSE_PROFILES': 'postgres'}
        stand.model = {'services': {}}
        stand.timeout = 1
        return stand

    def test_restore_streams_base_then_delta_before_start(self):
        with tempfile.TemporaryDirectory() as directory:
            archives = [Path(directory) / name for name in ('base.tar', 'delta.tar')]
            for archive in archives: archive.write_bytes(archive.name.encode())
            stand = self.stand()
            events = []
            def run(*args, **kwargs):
                events.append(args)
                return subprocess.CompletedProcess(args, 0, '', '')
            def restore(args, **kwargs):
                events.append(('extract', kwargs['stdin'].read(), args))
                return subprocess.CompletedProcess(args, 0, b'', b'')
            with patch.object(stand, 'run', side_effect=run), patch.object(stand, 'healthy', return_value=True), patch('environment_stand.subprocess.run', side_effect=restore):
                stand.provision(files_archives=archives)
            extracts = [e for e in events if e[0] == 'extract']
            self.assertEqual([e[1] for e in extracts], [b'base.tar', b'delta.tar'])
            self.assertIn('type=volume,src=test-server-data,dst=/data', extracts[0][2])
            start = next(i for i, e in enumerate(events) if 'up' in e)
            self.assertTrue(all(events.index(e) < start for e in extracts))

    def test_extract_failure_never_starts_applications(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'files.tar'
            archive.write_bytes(b'invalid')
            stand = self.stand()
            with patch.object(stand, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')) as run, patch('environment_stand.subprocess.run', return_value=subprocess.CompletedProcess([], 1, b'', b'failed')):
                with self.assertRaises(ValueError): stand.provision(files_archives=[archive])
            self.assertFalse(any('up' in call.args for call in run.call_args_list))
            self.assertEqual(stand.stage, 'restore')
            self.assertEqual(stand.code, 28)

    def test_refuses_production_or_in_use_volume(self):
        stand = self.stand()
        stand.values['VC_DATA_VOLUME'] = 'voicechat-server-data'
        with self.assertRaises(ValueError): stand.restore_files(['missing'])
        stand = self.stand()
        with patch.object(stand, 'run', return_value=subprocess.CompletedProcess([], 0, 'running-container', '')):
            with self.assertRaises(ValueError): stand.restore_files(['missing'])


if __name__ == '__main__':
    unittest.main()
