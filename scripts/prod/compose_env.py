#!/usr/bin/env python3
"""Read checkout Compose settings without sourcing or interpolating shell code."""

import argparse
import os
from pathlib import Path
import re
import sys
import subprocess
from typing import Dict
from urllib.parse import urlsplit


def application_settings(values: Dict[str, str]) -> Dict[str, str]:
    """Derive local services; an external application never activates a container."""
    voice = values.get('VC_VOICE', 'on')
    if voice not in ('on', 'off'):
        raise ValueError('invalid_voice')
    result = {'VC_STT_RUNNER_URL': '', 'VC_TTS_RUNNER_URL': ''} if voice == 'off' else {}
    modes = {'make': 'MAKE', 'projects': 'KANBAN', 'web-reader': 'READER',
             'playwright-reader': 'PLAYWRIGHT_READER', 'image-studio': 'IMAGE_STUDIO'}
    profiles_by_app = {'make': 'make', 'projects': 'kanban', 'web-reader': 'reader',
                       'playwright-reader': 'playwright-reader', 'image-studio': 'image-studio'}
    managed = set(profiles_by_app.values()) | {'local-runner', 'voice-runner', 'browser-runner', 'automation-runner'}
    profiles = set(filter(None, values.get('COMPOSE_PROFILES', '').split(',')))
    if voice == 'off':
        if '*' in profiles:
            raise ValueError('voice_off_conflicts_with_all_profiles')
        profiles.discard('voice-runner')
    if 'VC_APPLICATIONS' not in values:
        # Preserve the former unprofiled services for legacy deployments.
        profiles.add('automation-runner')
        if voice == 'on':
            profiles.add('voice-runner')
        if 'compose.stand' not in values.get('COMPOSE_FILE', ''):
            profiles.update({'make', 'image-studio', 'playwright-reader', 'browser-runner'})
        if not (values.get('VC_LLM_RUNNER_CLAUDE_URL') and values.get('VC_LLM_RUNNER_CODEX_URL')):
            profiles.add('local-runner')
        return {**result, 'COMPOSE_PROFILES': ','.join(sorted(profiles))}
    selected = {}
    for item in values['VC_APPLICATIONS'].split(',') if values['VC_APPLICATIONS'] else []:
        name, separator, url = item.partition('=')
        name, url = name.strip(), url.strip()
        if name not in {*modes, 'chat', 'identity'} or name in selected:
            raise ValueError('invalid_applications')
        if separator:
            parsed = urlsplit(url)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or '?' in url or '#' in url:
                raise ValueError('invalid_application_url')
        selected[name] = not separator
    profiles -= managed
    for name, mode in modes.items():
        local = selected.get(name, False)
        result['VC_' + mode + '_MODE'] = 'remote' if local else 'off'
        if local:
            profiles.add(profiles_by_app[name])
    if selected.get('projects'):
        profiles.add('postgres')
    if selected.get('chat') and voice == 'on':
        profiles.add('voice-runner')
    if any(selected.get(name) for name in ('chat', 'make', 'projects', 'image-studio')) and not (values.get('VC_LLM_RUNNER_CLAUDE_URL') and values.get('VC_LLM_RUNNER_CODEX_URL')):
        profiles.add('local-runner')
    if selected.get('playwright-reader'):
        profiles.add('browser-runner')
    if selected.get('projects'):
        profiles.add('automation-runner')
    result['COMPOSE_PROFILES'] = ','.join(sorted(profiles))
    return result


def read_env(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    values = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)", line)
        if not match:
            raise ValueError(f"{path}:{number}: invalid assignment")
        key, value = match.groups()
        if value.startswith(("'", '"')):
            quoted = re.fullmatch(r"(['\"])(.*?)\1\s*(?:#.*)?", value)
            if not quoted:
                raise ValueError(f"{path}:{number}: invalid quoted value")
            value = quoted.group(2)
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
        values[key] = value
    return values


def chain(path: Path) -> str:
    value = os.environ.get("COMPOSE_FILE") or read_env(path).get("COMPOSE_FILE")
    if value:
        return value
    # Retain the existing Compose default-name discovery order.
    for name in ("compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"):
        if Path(name).is_file():
            stem = name.rsplit(".", 1)[0]
            overrides = [f"{stem}.override.{ext}" for ext in ("yaml", "yml")
                         if Path(f"{stem}.override.{ext}").is_file()]
            return ":".join([name] + overrides[:1])
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    get = commands.add_parser("get")
    get.add_argument("key")
    get.add_argument("--file", type=Path, default=Path(".env"))
    command = commands.add_parser("chain")
    command.add_argument("--file", type=Path, default=Path(".env"))
    generate = commands.add_parser('applications')
    generate.add_argument('--file', type=Path, default=Path('.env'))
    run = commands.add_parser('run')
    run.add_argument('--file', type=Path, default=Path('.env'))
    run.add_argument('args', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if args.command in ('applications', 'run'):
            values = read_env(args.file)
            values.update({k: v for k, v in os.environ.items() if k == 'COMPOSE_PROFILES' or k.startswith('VC_')})
            settings = application_settings(values)
            if args.command == 'run':
                environment = dict(os.environ)
                environment.update(values)
                environment.update(settings)
                arguments = args.args[1:] if args.args[:1] == ['--'] else args.args
                return subprocess.run(['docker', 'compose', *arguments], env=environment).returncode
            for key, value in settings.items():
                print(f'{key}={value}')
        else:
            print(read_env(args.file).get(args.key, "") if args.command == "get" else chain(args.file))
    except (ValueError, OSError) as error:
        print(error, file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
