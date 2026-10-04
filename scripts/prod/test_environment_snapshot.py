"""Production snapshot contracts and optional PostgreSQL restore verification."""
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class SnapshotTest(unittest.TestCase):
    def test_fake_docker_receives_every_exclusion_and_result_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake = root / 'docker'
            log = root / 'args.json'
            # psql answers the foreign-key closure: the listed tables plus one dependent table.
            fake.write_text("#!/usr/bin/env python3\nimport json,os,sys\nargs=sys.argv[1:]\n"
                            "if 'psql' in args:\n"
                            "    sql=args[-1]\n"
                            "    open(os.environ['ARG_LOG']+'.sql','w').write(sql)\n"
                            "    print('\\n'.join(sorted(os.environ['LISTED'].split(',')+['project_machines'])))\n"
                            "    sys.exit(0)\n"
                            "open(os.environ['ARG_LOG'],'w').write(json.dumps(args))\nprint('fake-custom-archive', end='')\n")
            fake.chmod(0o700)
            listed = [line for line in (HERE / 'snapshot-exclude.txt').read_text().splitlines() if line]
            result = subprocess.run(['bash', str(HERE / 'environment-snapshot.sh'), str(root)],
                env={**os.environ, 'PATH': str(root) + ':' + os.environ['PATH'], 'ARG_LOG': str(log), 'LISTED': ','.join(listed)},
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            rows = [json.loads(line) for line in result.stdout.splitlines()]
            final = rows[-1]
            output = Path(final['path'])
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            self.assertEqual(final['size'], output.stat().st_size)
            self.assertRegex(final['sha256'], r'^[a-f0-9]{64}$')
            args = json.loads(log.read_text())
            excluded = {a.removeprefix('--exclude-table-data=public.') for a in args if a.startswith('--exclude-table-data=')}
            self.assertEqual(excluded, set(listed) | {'project_machines'})
            sql = Path(str(log) + '.sql').read_text()
            for name in listed:
                self.assertIn("'" + name + "'", sql)
            self.assertIn('confrelid', sql)
            self.assertEqual(args[:3], ['compose', 'exec', '-T'])
            self.assertIn('-Fc', args)

    @unittest.skipUnless(os.environ.get('VC_TEST_DB_URL'), 'VC_TEST_DB_URL is not configured')
    def test_postgres_fixture_has_no_excluded_rows_or_real_email(self):
        """Supervisor fixture is expected to have been restored and sanitized by the test harness."""
        url = os.environ['VC_TEST_DB_URL']
        excluded = [line for line in (HERE / 'snapshot-exclude.txt').read_text().splitlines() if line]
        sql = "SELECT COALESCE(sum(n_live_tup),0) FROM pg_stat_user_tables WHERE relname IN (" + \
              ','.join("'" + name + "'" for name in excluded) + ");"
        rows = subprocess.run(['psql', url, '-Atqc', sql], check=True, capture_output=True, text=True).stdout.strip()
        self.assertEqual(rows, '0')
        real = subprocess.run(['psql', url, '-Atqc',
            "SELECT count(*) FROM users WHERE email IS NOT NULL AND email NOT LIKE 'user-%@stand.invalid'"],
            check=True, capture_output=True, text=True).stdout.strip()
        self.assertEqual(real, '0')


if __name__ == '__main__':
    unittest.main()
