"""The release wrapper must pin services activated by the detached launcher."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SHA = 'b' * 40
BROWSER = 'ghcr.io/sislex/playwrightreader-browser:' + SHA


class ReleaseManagerProfilesTest(unittest.TestCase):
    def run_wrapper(self, voice='on'):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        helpers = root / 'scripts/prod'
        helpers.mkdir(parents=True)
        for name in ['compose_env.py', 'local_image_pins.py']:
            shutil.copyfile(HERE / name, helpers / name)
        (helpers / 'owner_image_switches.py').write_text('import json\nprint(json.dumps(' + repr({'browser-runner': BROWSER}) + '))\n')
        (root / 'production.env').write_text('VC_REPO_DIR=' + str(root) + '\nCOMPOSE_FILE=' + str(root / 'base.yml') + '\n')
        wrapper = (HERE / 'release-manager-deploy.sh').read_text()
        wrapper = wrapper.replace('/etc/voicechat/production.env', str(root / 'production.env'))
        wrapper = wrapper.replace('/etc/voicechat/release-overrides', str(root / 'overrides'))
        wrapper = wrapper.replace('/usr/local/bin/voicechat-deploy', str(root / 'launch'))
        (root / 'wrapper').write_text(wrapper)
        scripts = {
            'git': '#!/bin/sh\ncase "$*" in\n"rev-parse HEAD") echo ' + SHA + ';;\n"branch --show-current") echo release/1.0.0;;\n"status --porcelain --untracked-files=no") ;;\n*) exit 1;;\nesac\n',
            'launch': '#!/bin/sh\nprintf "%s\\n%s\\n" "$COMPOSE_PROFILES" "$COMPOSE_FILE" > "$FIXTURE_ROOT/launched"\n',
            'docker': r'''#!/usr/bin/env python3
import json, os, pathlib, sys
root=pathlib.Path(os.environ['FIXTURE_ROOT'])
args=sys.argv[1:]
with (root/'calls').open('a') as stream:
    stream.write(json.dumps({'args':args,'profiles':os.environ.get('COMPOSE_PROFILES','')})+'\n')
if args[:2]==['compose','config']:
    services={'voicechat':{'build':'.'}}
    if 'browser-runner' in os.environ.get('COMPOSE_PROFILES','').split(','):
        services['browser-runner']={'image':'obsolete-browser'}
    pins=list((root/'overrides').glob('*.yml'))
    if pins:
        content=pins[0].read_text()
        if 'browser-runner:' in content:
            services['browser-runner']={'image':'pinned-browser','pull_policy':'never'}
    print(json.dumps({'services':services}))
elif args[:2]==['image','inspect']:
    print('sha256:'+'a'*64)
elif args[:1]!=['pull']:
    raise SystemExit('Unexpected Docker invocation: '+repr(args))
''',
        }
        for name, content in scripts.items():
            path = root / name
            path.write_text(content); path.chmod(0o700)
        env = {k: v for k, v in os.environ.items() if not k.startswith('VC_') and k not in ['COMPOSE_PROFILES', 'COMPOSE_FILE']}
        env.update(PATH=str(root) + ':' + env['PATH'], FIXTURE_ROOT=str(root), VC_RELEASE_VERSION='1.0.0',
                   VC_RELEASE_EXPECTED_COMMIT=SHA, VC_VOICE=voice,
                   VC_LLM_RUNNER_CLAUDE_URL='http://runner', VC_LLM_RUNNER_CODEX_URL='http://runner')
        result = subprocess.run(['bash', str(root / 'wrapper')], cwd=root, env=env, capture_output=True, text=True)
        return result, root

    def test_profiled_browser_is_pinned_before_the_launcher(self):
        result, root = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [json.loads(line) for line in (root / 'calls').read_text().splitlines()]
        self.assertIn('browser-runner', calls[0]['profiles'].split(','))
        self.assertIn(['pull', BROWSER], [call['args'] for call in calls])
        pins = list((root / 'overrides').glob('*.yml'))
        self.assertEqual(len(pins), 1)
        self.assertIn('image: "' + BROWSER + '"', pins[0].read_text())
        self.assertIn('pull_policy: never', pins[0].read_text())
        self.assertEqual((root / 'launched').read_text().splitlines()[0], calls[0]['profiles'])

    def test_voice_off_is_respected_before_pin_generation(self):
        result, root = self.run_wrapper('off')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('voice-runner', (root / 'launched').read_text().splitlines()[0].split(','))

    def test_invalid_profiles_stop_before_any_docker_invocation(self):
        result, root = self.run_wrapper('invalid')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((root / 'calls').exists())
        self.assertFalse((root / 'launched').exists())


if __name__ == '__main__':
    unittest.main()
