import unittest
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from unittest.mock import patch, Mock
from compose_env import application_settings, main


class ApplicationProfiles(unittest.TestCase):
    def test_billing_daily_policy_reaches_container_without_enabling_legacy_installs(self):
        docker = shutil.which('docker')
        if not docker or subprocess.run([docker, 'compose', 'version'], capture_output=True).returncode:
            self.skipTest('Docker Compose unavailable')
        root = Path(__file__).resolve().parents[2]
        amount, zone = 'BILLING_DAILY_USER_MICRO_USD', 'BILLING_DAILY_USER_TIME_ZONE'
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(('COMPOSE_', 'SISLEXA_', 'BILLING_'))}
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'billing.env'
            for settings, expected in [({}, {}),
                    ({amount: '5000000', zone: 'Europe/Minsk'}, {amount: '5000000', zone: 'Europe/Minsk'}),
                    ({amount: '0'}, {amount: '0'}),
                    ({amount: ''}, {amount: ''})]:
                with self.subTest(settings=settings):
                    config.write_text('SISLEXA_COMPONENTS_DIR=' + directory + '\n' +
                                      ''.join(f'{key}={value}\n' for key, value in settings.items()))
                    result = subprocess.run([docker, 'compose', '--env-file', str(config),
                        '-f', str(root / 'deploy/compose.billing.yml'), 'config', '--format', 'json'],
                        cwd=directory, env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    actual = json.loads(result.stdout)['services']['billing']['environment']
                    self.assertEqual({key: actual[key] for key in (amount, zone)
                                      if actual.get(key) is not None}, expected)

    def test_matrix(self):
        for applications, expected in [
            ('chat', {'local-runner', 'voice-runner'}),
            ('chat,make', {'make', 'local-runner', 'voice-runner'}),
            ('chat,make=https://make.example.org', {'local-runner', 'voice-runner'}),
            ('chat,web-reader,projects', {'reader', 'kanban', 'postgres', 'automation-runner', 'local-runner', 'voice-runner'}),
            ('', set()),
        ]:
            with self.subTest(applications=applications):
                result = application_settings({'VC_APPLICATIONS': applications})
                self.assertEqual(set(filter(None, result['COMPOSE_PROFILES'].split(','))), expected)
                self.assertEqual(result['VC_MAKE_MODE'], 'remote' if applications == 'chat,make' else 'off')

    def test_external_runner_and_stale_profiles(self):
        result = application_settings({'VC_APPLICATIONS': 'chat', 'COMPOSE_PROFILES': 'make,reader,public',
                                       'VC_LLM_RUNNER_CLAUDE_URL': 'http://runner', 'VC_LLM_RUNNER_CODEX_URL': 'http://runner'})
        self.assertEqual(result['COMPOSE_PROFILES'], 'public,voice-runner')
        self.assertEqual(result['VC_READER_MODE'], 'off')

    def test_caddy_routes_disabled_and_external_applications_through_core(self):
        upstreams = {'make': ('MAKE', 'make:8788'),
                     'playwright-reader': ('PLAYWRIGHT_READER', 'playwright-reader:8797'),
                     'image-studio': ('IMAGE_STUDIO', 'image-studio:8796')}
        for app, (key, upstream) in upstreams.items():
            for selector, expected in [('chat', 'voicechat:8787'),
                    ('chat,' + app, upstream),
                    ('chat,' + app + '=https://service.example.org', 'voicechat:8787')]:
                with self.subTest(app=app, selector=selector):
                    result = application_settings({'VC_APPLICATIONS': selector,
                        'VC_CADDY_' + key + '_UPSTREAM': 'stale:1234'})
                    self.assertEqual(result['VC_CADDY_' + key + '_UPSTREAM'], expected)
        self.assertFalse(any(key.startswith('VC_CADDY_') for key in application_settings({})))

    def test_legacy(self):
        result = application_settings({})
        self.assertNotIn('VC_MAKE_MODE', result)
        self.assertTrue({'make', 'image-studio', 'playwright-reader', 'local-runner', 'voice-runner'} <= set(result['COMPOSE_PROFILES'].split(',')))
        production = application_settings({'COMPOSE_PROFILES': 'postgres,kanban'})
        self.assertIn('make', production['COMPOSE_PROFILES'].split(','))
        stand = application_settings({'COMPOSE_FILE': 'docker-compose.yml:deploy/compose.stand.yml', 'COMPOSE_PROFILES': 'postgres,kanban'})
        self.assertNotIn('make', stand['COMPOSE_PROFILES'].split(','))

    def test_voice_off_removes_stale_voice_profiles_and_legacy_endpoints(self):
        for applications in (None, 'chat', 'chat,make'):
            with self.subTest(applications=applications):
                values = {'VC_VOICE': 'off', 'COMPOSE_PROFILES': 'postgres,public,voice-runner',
                          'VC_STT_RUNNER_URL': 'http://stt-runner:8791',
                          'VC_TTS_RUNNER_URL': 'http://tts-runner:8791'}
                if applications is not None:
                    values['VC_APPLICATIONS'] = applications
                result = application_settings(values)
                profiles = set(result['COMPOSE_PROFILES'].split(','))
                self.assertNotIn('voice-runner', profiles)
                self.assertTrue({'postgres', 'public'} <= profiles)
                self.assertEqual(result['VC_STT_RUNNER_URL'], '')
                self.assertEqual(result['VC_TTS_RUNNER_URL'], '')

    def test_chat_only_without_voice_uses_only_the_explicit_postgres_profile(self):
        result = application_settings({'VC_APPLICATIONS': 'chat', 'VC_VOICE': 'off',
                                       'COMPOSE_PROFILES': 'postgres',
                                       'VC_LLM_RUNNER_CLAUDE_URL': 'http://runner',
                                       'VC_LLM_RUNNER_CODEX_URL': 'http://runner'})
        self.assertEqual(result['COMPOSE_PROFILES'], 'postgres')

    def test_voice_defaults_on_and_explicit_on_preserves_endpoints(self):
        for voice in (None, 'on'):
            with self.subTest(voice=voice):
                values = {'VC_APPLICATIONS': 'chat'}
                if voice is not None:
                    values['VC_VOICE'] = voice
                result = application_settings(values)
                self.assertIn('voice-runner', result['COMPOSE_PROFILES'].split(','))
                self.assertNotIn('VC_STT_RUNNER_URL', result)
                self.assertNotIn('VC_TTS_RUNNER_URL', result)

    def test_invalid_voice_and_wildcard_conflict_are_rejected(self):
        for values in ({'VC_VOICE': 'false'}, {'VC_VOICE': ''},
                       {'VC_VOICE': 'off', 'COMPOSE_PROFILES': '*'}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                application_settings(values)

    def test_compose_adapter_passes_generated_settings_without_shell_evaluation(self):
        with patch('sys.argv', ['compose_env.py', 'run', '--', 'config', '--services']), \
                patch('compose_env.read_env', return_value={'VC_APPLICATIONS': 'chat,make=https://make.example.org'}), \
                patch('compose_env.os.environ', {}), \
                patch('compose_env.subprocess.run', return_value=Mock(returncode=0)) as run:
            self.assertEqual(main(), 0)
            args, kwargs = run.call_args
            self.assertEqual(args[0], ['docker', 'compose', 'config', '--services'])
            self.assertEqual(kwargs['env']['VC_MAKE_MODE'], 'off')
            self.assertEqual(kwargs['env']['COMPOSE_PROFILES'], 'local-runner,voice-runner')

    def test_invalid(self):
        for value in ('bad', 'make,make', 'make=http://example.org', 'make=https://u:p@example.org', 'make=https://example.org?x'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                application_settings({'VC_APPLICATIONS': value})


if __name__ == '__main__':
    unittest.main()
