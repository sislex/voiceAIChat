import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

const src = join(__dirname, '..')
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((file) => file.isDirectory() ? walk(join(dir, file.name)) : [join(dir, file.name)])
}

it('ядро не владеет хранилищем и роутами галереи, подключает реализацию только при сборке процесса', () => {
  for (const old of ['images/studio.ts', 'routes/imageStudio.ts', 'llm/imageStudioGenerator.ts']) {
    expect(existsSync(join(src, old)), old).toBe(false)
  }
  const forbidden: string[] = []
  for (const file of walk(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const rel = relative(src, file)
    if (rel === 'server.ts' || rel.startsWith('imageStudioBridge/')) continue
    for (const match of readFileSync(file, 'utf8').matchAll(/(?:^import\s+(type\s+)?[^;]*?from\s*|import\s*\()\s*['"]@voicechat\/image-studio[^'"]*['"]/gm)) {
      if (!match[1]) forbidden.push(rel)
    }
  }
  expect(forbidden).toEqual([])
})
