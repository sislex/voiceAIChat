// Синтаксис сгенерированных установщиков. Обычные тесты грепают строки и не
// замечают сломанную конструкцию (реальный случай: `else` перед `elif` — скрипт
// раздавался, а на машине падал). Здесь скрипт реально скармливается `bash -n`.
//
// bash есть на dev-машинах и в CI-контейнере; если его нет — тест помечает себя
// пропущенным, а не падает.

import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAndroidInstallScript } from './androidInstall.js'
import { buildUnixInstallScript } from './unixInstall.js'

const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0
const hasPython = spawnSync('python3', ['-c', 'exit(0)']).status === 0
const prodInstall = readFileSync(new URL('../../../../scripts/prod/install.sh', import.meta.url), 'utf8')

/** `bash -n` над текстом скрипта: возвращает stderr, пустая строка — синтаксис ок. */
function syntaxError(script: string, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vc-syntax-'))
  const file = join(dir, name)
  writeFileSync(file, script)
  try {
    execFileSync('bash', ['-n', file], { stdio: 'pipe' })
    return ''
  } catch (err) {
    const e = err as { stderr?: Buffer }
    return e.stderr?.toString() ?? 'неизвестная ошибка синтаксиса'
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Регрессия: установщики проверяют скачанный бандл через `node --check`, а тот
 * выбирает модульную систему ПО РАСШИРЕНИЮ. С временным именем «…cjs.new» он
 * падает с ERR_UNKNOWN_FILE_EXTENSION, и обновление отменялось на любой машине
 * («скачанный скрипт битый»). Проверяем настоящим запуском node.
 */
describe('установщики: временное имя бандла годится для node --check', () => {
  /** Имена файлов после `--check` в тексте скрипта. */
  function checkedNames(script: string): string[] {
    const out: string[] = []
    for (const m of script.matchAll(/--check\s+\S*?([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)/g)) {
      out.push(m[1])
    }
    return out
  }

  const scripts = {
    android: buildAndroidInstallScript('https://h'),
    linux: buildUnixInstallScript('https://h', 'linux'),
    macos: buildUnixInstallScript('https://h', 'macos')
  }

  for (const [os, script] of Object.entries(scripts)) {
    it(`${os}: node --check принимает это имя`, () => {
      const names = checkedNames(script)
      expect(names.length).toBeGreaterThan(0)
      const dir = mkdtempSync(join(tmpdir(), 'vc-check-'))
      try {
        for (const name of names) {
          const file = join(dir, name)
          writeFileSync(file, 'module.exports = 1\n')
          const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
          expect(res.stderr, `${name}: node не понял расширение`).not.toContain(
            'ERR_UNKNOWN_FILE_EXTENSION'
          )
          expect(res.status, `${name}: node --check упал`).toBe(0)
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})

describe.skipIf(!hasBash)('установщики: синтаксис bash', () => {
  const cases: Array<[string, string]> = [
    ['install-android.sh', buildAndroidInstallScript('https://host.example')],
    ['install-linux.sh', buildUnixInstallScript('https://host.example', 'linux')],
    ['install-macos.sh', buildUnixInstallScript('https://host.example', 'macos')]
  ]

  for (const [name, script] of cases) {
    it(`${name} разбирается bash без ошибок`, () => {
      expect(syntaxError(script, name)).toBe('')
    })
  }

  it('prod install.sh разбирается bash без ошибок', () => {
    expect(syntaxError(prodInstall, 'prod-install.sh')).toBe('')
  })

  it('сам детектор рабочий: битый скрипт не проходит', () => {
    // Текст ошибки у разных bash отличается — важно лишь, что она есть.
    expect(syntaxError('if true; then\nelse\nelif false; then\nfi\n', 'broken.sh')).toContain(
      'syntax error'
    )
  })
})

describe.skipIf(!hasBash)('Unix-установщик: определение свежей версии Node.js', () => {
  const scripts: Array<[string, string, string]> = [
    ['linux', buildUnixInstallScript('https://host.example', 'linux'), 'v26.8.1'],
    ['macos', buildUnixInstallScript('https://host.example', 'macos'), 'v22.23.2']
  ]

  it.each(scripts)('%s дочитывает index.json при pipefail и сохраняет свою политику', (_os, script, expected) => {
    const assignment = script.match(/^  NVER="\$\((.+)\)"$/m)?.[1]
    expect(assignment, 'команда определения NVER не найдена').toBeDefined()
    expect(assignment).not.toContain('head -1')
    expect(assignment).not.toContain('head -n 1')

    const dir = mkdtempSync(join(tmpdir(), 'vc-node-version-'))
    const producer = join(dir, 'index.cjs')
    writeFileSync(
      producer,
      [
        "const { writeSync } = require('node:fs')",
        `writeSync(1, '{"version":"v26.8.1"}\\n')`,
        `writeSync(1, '{"version":"v22.23.2"}\\n')`,
        `writeSync(1, '{"version":"v22.23.1"}\\n')`,
        `for (let i = 0; i < 100000; i++) writeSync(1, '{"version":"v21.7.3"}\\n')`
      ].join('\n')
    )

    try {
      const pipeline = assignment!.replace(
        'curl -fsSL https://nodejs.org/dist/index.json',
        'node "$1"'
      )
      const result = spawnSync(
        'bash',
        ['-c', `set -euo pipefail
NVER="$(${pipeline})"
printf '%s' "$NVER"`, 'bash', producer],
        { encoding: 'utf8' }
      )
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(expected)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function nodeSection(script: string): string {
  const start = script.indexOf('# --- Node.js')
  const end = script.indexOf('# --- Свежий скрипт агента')
  return 'AGENT_DIR="$HOME/.voicechat-agent"\nmkdir -p "$AGENT_DIR"\n'+script.slice(start, end)
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

describe.skipIf(!hasBash)('macOS installer: executable Node recovery', () => {
  const section = nodeSection(buildUnixInstallScript('https://host.example', 'macos'))

  function fixture(downloadedVersion: string) {
    const home = mkdtempSync(join(tmpdir(), 'vc-macos-node-'))
    const bin = join(home, 'bin')
    const agentBin = join(home, '.voicechat-agent', 'node', 'bin')
    execFileSync('mkdir', ['-p', bin, agentBin])
    writeExecutable(join(bin, 'node'), '#!/usr/bin/env bash\necho v16.13.0\n')
    writeExecutable(join(agentBin, 'node'), '#!/usr/bin/env bash\necho dyld: Symbol not found: __libcpp_verbose_abort >&2\nexit 1\n')
    const downloaded = join(home, 'downloaded-node')
    const downloadedBody = downloadedVersion === '<exit 1>'
      ? '#!/usr/bin/env bash\nexit 1\n'
      : '#!/usr/bin/env bash\necho '+downloadedVersion+'\n'
    writeExecutable(downloaded, downloadedBody)
    writeExecutable(join(bin, 'curl'), '#!/usr/bin/env bash\ncase "$*" in\n  *index.json*) printf \'%s\\n\' \'{"version":"v26.8.1"}\' \'{"version":"v22.23.2"}\' \'{"version":"v22.23.1"}\' ;;\n  *) previous=""; for arg in "$@"; do [ "$previous" = "-o" ] && : > "$arg"; previous="$arg"; done ;;\nesac\n')
    writeExecutable(join(bin, 'tar'), '#!/usr/bin/env bash\nprevious=""\nfor arg in "$@"; do [ "$previous" = "-C" ] && target="$arg"; previous="$arg"; done\nmkdir -p "$target/bin"\ncp "$DOWNLOADED_NODE" "$target/bin/node"\nchmod +x "$target/bin/node"\n')
    writeExecutable(join(bin, 'sw_vers'), '#!/usr/bin/env bash\necho 12.0.1\n')
    return { home, bin, downloaded, agentBin }
  }


  it('переиспользует абсолютный системный Node 22+ без загрузки', () => {
    const home = mkdtempSync(join(tmpdir(), 'vc-macos-system-node-'))
    const bin = join(home, 'bin')
    execFileSync('mkdir', ['-p', bin])
    writeExecutable(join(bin, 'node'), '#!/usr/bin/env bash\necho v22.23.2\n')
    writeExecutable(join(bin, 'curl'), '#!/usr/bin/env bash\necho unexpected curl >&2\nexit 88\n')
    try {
      const result = spawnSync('bash', ['-c', section], {
        encoding: 'utf8', env: { ...process.env, HOME: home, PATH: bin+':/usr/bin:/bin' }
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('/bin/node (v22.23.2)')
      expect(result.stderr).not.toContain('unexpected curl')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('заменяет падающий с dyld portable Node проверенным v22', () => {
    const f = fixture('v22.23.2')
    try {
      const result = spawnSync('bash', ['-c', section], {
        encoding: 'utf8',
        env: { ...process.env, HOME: f.home, PATH: f.bin+':/usr/bin:/bin', DOWNLOADED_NODE: f.downloaded }
      })
      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).toContain('dyld: Symbol not found')
      expect(result.stderr).toContain('portable Node повреждён')
      expect(readFileSync(join(f.agentBin, 'node'), 'utf8')).toContain('v22.23.2')
    } finally {
      rmSync(f.home, { recursive: true, force: true })
    }
  })

  it.each(['garbage', 'v21.7.0', '', '<exit 1>'])('не принимает скачанный Node %s и останавливается до следующего этапа', (version) => {
    const f = fixture(version)
    const marker = join(f.home, 'after-node')
    try {
      const result = spawnSync('bash', ['-c', section+'\nprintf reached > "$MARKER"'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: f.home, PATH: f.bin+':/usr/bin:/bin', DOWNLOADED_NODE: f.downloaded, MARKER: marker }
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('macOS 12.0.1')
      expect(result.stderr).toContain('v22.23.2')
      expect(result.stderr).toContain('причина:')
      expect(() => readFileSync(marker)).toThrow()
    } finally {
      rmSync(f.home, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!hasPython)('prod deploy API: синтаксис Python', () => {
  it('встроенный в install.sh host API компилируется', () => {
    const match = /cat >\/usr\/local\/lib\/voicechat\/deploy-api\.py <<'PY'\n([\s\S]*?)\nPY\n/.exec(prodInstall)
    expect(match, 'Python-блок deploy API не найден').not.toBeNull()
    const result = spawnSync('python3', ['-c', 'import sys; compile(sys.stdin.read(), "deploy-api.py", "exec")'], {
      input: match![1],
      encoding: 'utf8'
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})
