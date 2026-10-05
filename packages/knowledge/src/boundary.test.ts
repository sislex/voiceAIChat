import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('has no Core implementation, persistence, process or network dependencies', () => {
  const root = fileURLToPath(new URL('.', import.meta.url))
  for (const name of readdirSync(root).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
    const code = readFileSync(join(root, name), 'utf8')
    const imports = [...code.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map(match => match[1])
    for (const specifier of imports) {
      expect(specifier, name).not.toMatch(/apps\/server|^\.\.\/|node:(?:fs|child_process|http|https|net)|fastify|identity/)
    }
  }
})
