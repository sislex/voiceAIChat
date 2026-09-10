import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// Vitest и tsx по-разному сохраняют имена вложенных функций. Проверяем
// тот же запуск, которым приложение пользуется вне тестового транспилятора.
it('боевой tsx передаёт вложенные console args из настоящего Chromium', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('./test/readerDiagnosticsRuntime.ts', import.meta.url))],
    { timeout: 8000 }
  )
  expect(stdout).toContain('tsx console arguments verified')
}, 10000)
