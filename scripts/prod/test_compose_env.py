import unittest
from unittest.mock import patch, Mock
from compose_env import application_settings, main


class ApplicationProfiles(unittest.TestCase):
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

    def test_legacy(self):
        result = application_settings({})
        self.assertNotIn('VC_MAKE_MODE', result)
        self.assertTrue({'make', 'image-studio', 'playwright-reader', 'local-runner', 'voice-runner'} <= set(result['COMPOSE_PROFILES'].split(',')))
        production = application_settings({'COMPOSE_PROFILES': 'postgres,kanban'})
        self.assertIn('make', production['COMPOSE_PROFILES'].split(','))
        stand = application_settings({'COMPOSE_FILE': 'docker-compose.yml:deploy/compose.stand.yml', 'COMPOSE_PROFILES': 'postgres,kanban'})
        self.assertNotIn('make', stand['COMPOSE_PROFILES'].split(','))

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
