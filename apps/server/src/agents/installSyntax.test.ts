// Синтаксис сгенерированных установщиков. Обычные тесты грепают строки и не
// замечают сломанную конструкцию (реальный случай: `else` перед `elif` — скрипт
// раздавался, а на машине падал). Здесь скрипт реально скармливается `bash -n`.
//
// bash есть на dev-машинах и в CI-контейнере; если его нет — тест помечает себя
// пропущенным, а не падает.

import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAndroidInstallScript } from './androidInstall.js'
import { buildUnixInstallScript } from './unixInstall.js'

const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0

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

  it('сам детектор рабочий: битый скрипт не проходит', () => {
    // Текст ошибки у разных bash отличается — важно лишь, что она есть.
    expect(syntaxError('if true; then\nelse\nelif false; then\nfi\n', 'broken.sh')).toContain(
      'syntax error'
    )
  })
})
