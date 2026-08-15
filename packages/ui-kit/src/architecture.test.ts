import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const forbidden = [
  /@voicechat\/ui(?:\/|['"])/,
  /(?:^|\/)apps\//,
  /voiceStore|useVoiceStore/,
  /(?:^|\/)remote\//,
  /window\s*\.\s*(?:api|ci|fs|files|agents|pty|audio|stt|tts|claude|codex|kb)\b/,
  /\b(?:new\s+WebSocket|EventSource\s*\(|from\s+['"]electron)/i,
  /(?:^|\/)ChatAI(?:\/|['"])/,
  /(?:bridge|transport|http)(?:\/|['"])/i
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sourceFiles(path)
    return ['.ts', '.tsx'].includes(extname(entry.name)) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')
      ? [path]
      : []
  })
}

describe('ui-kit architecture boundary', () => {
  it('contains no imports or runtime access to forbidden product and transport layers', () => {
    const violations: string[] = []
    for (const file of sourceFiles(ROOT)) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of forbidden) {
        if (pattern.test(source)) violations.push(`${file}: ${pattern}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('exposes styles and components only through declared package exports', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { exports: Record<string, string> }
    expect(pkg.exports).toEqual({ '.': './src/index.ts', './styles.css': './src/styles.css' })
  })
})
