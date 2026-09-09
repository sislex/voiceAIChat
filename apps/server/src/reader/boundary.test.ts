// Гейт границы Web Reader (docs/plans/web-reader-service.md, круг 1): прокси превью и MCP «browser»
// собирает `reader/module.ts`, `server.ts` зовёт его одной функцией и отдаёт состояние процесса портом
// `ReaderCore`. Список зависимостей зафиксирован снимком: новая зависимость — осознанное решение, потому
// что в отдельном процессе каждая станет RPC к ядру или своим клиентом. Токены ходов подписаны — брокера
// в памяти процесса больше нет ни у кого.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = join(__dirname, '..')
const server = readFileSync(join(srcDir, 'server.ts'), 'utf8')
const module = readFileSync(join(srcDir, 'reader', 'module.ts'), 'utf8')

function listTs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listTs(full))
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('граница Web Reader', () => {
  it('server.ts не собирает ридер сам: прокси превью, MCP «browser» и контекст Chromium — в reader/module.ts', () => {
    for (const marker of ['registerPreviewProxy(', 'registerPreviewMcp(', 'browserExecutor', 'browserScreenshot', 'clearPreviewCookies']) {
      expect(server, `server.ts содержит ${marker}`).not.toContain(marker)
      expect(module, `reader/module.ts не содержит ${marker}`).toContain(marker)
    }
    expect(server).toContain('createReaderModule(')
    expect(server).toContain('createLocalReaderCore(')
  })

  it('ReaderDeps — зафиксированный список того, что ридер берёт у ядра', () => {
    const block = /export interface ReaderDeps \{([\s\S]*?)\n\}/.exec(module)![1]!
    const keys = [...block.matchAll(/^\s+(\w+)[?]?:/gm)].map((m) => m[1]).sort()
    expect(keys).toEqual(['actionTimeoutMs', 'app', 'browser', 'core', 'db', 'machines', 'mcpSecret'])
  })

  it('токены ходов превью подписаны: in-memory брокера нет, ходы и хуки CI только выдают токен', () => {
    for (const file of listTs(srcDir)) {
      const text = readFileSync(file, 'utf8')
      expect(text, `${file} упоминает брокер токенов превью`).not.toMatch(/previewToolBroker|PreviewToolBroker/)
    }
    for (const file of ['turns.ts', 'ci/modelHooks.ts']) {
      const text = readFileSync(join(srcDir, file), 'utf8')
      expect(text).toContain('previewTurns')
      expect(text).not.toContain('previewTool.register')
    }
  })
})
