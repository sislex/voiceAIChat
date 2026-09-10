import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(path, item.name)) : /\.tsx?$/.test(item.name) && !/\.(test|stories)\./.test(item.name) ? [join(path, item.name)] : [])
it('продуктовая панель не импортирует host, его store или другой продукт', () => {
 const offenders: string[] = []
 for (const file of walk(join(process.cwd(), 'src'))) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g)) {
   if (/^@voicechat\/(?:ui(?:\/|$)|web(?:\/|$)|app-shell(?:\/|$)|(?:make|image-studio|playwright-reader|web-reader)-app(?:\/|$))/.test(match[1]!) || /(?:^|\/)ui\/src\//.test(match[1]!)) offenders.push(file + ' -> ' + match[1])
  }
 }
 expect(offenders).toEqual([])
})
