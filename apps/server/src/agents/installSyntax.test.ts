// Синтаксис сгенерированных установщиков. Обычные тесты грепают строки и не
// замечают сломанную конструкцию (реальный случай: `else` перед `elif` — скрипт
// раздавался, а на машине падал). Здесь скрипт реально скармливается `bash -n`.
//
// bash есть на dev-машинах и в CI-контейнере; если его нет — тест помечает себя
// пропущенным, а не падает.

import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
