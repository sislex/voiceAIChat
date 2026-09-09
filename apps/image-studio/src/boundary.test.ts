import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'

const src = __dirname
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((file) => file.isDirectory() ? walk(join(dir, file.name)) : [join(dir, file.name)])
}

it('студия не импортирует сервер, Make, БД или исполнителей: внутренний порт только через shared', () => {
  const forbidden: string[] = []
  for (const file of walk(src).filter((file) => file.endsWith('.ts'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
      const name = match[1]!
      if ((name.startsWith('.') && !resolve(dirname(file), name).startsWith(src + '/'))
        || (name.startsWith('@voicechat/') && name !== '@voicechat/shared')
        || ['better-sqlite3', 'pg', 'child_process', 'node:child_process'].includes(name)) {
        forbidden.push(`${relative(src, file)}: ${name}`)
      }
    }
  }
  expect(forbidden).toEqual([])
})
