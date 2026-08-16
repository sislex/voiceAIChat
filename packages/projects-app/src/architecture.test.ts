import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name)
  if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path)
  return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name) ? [path] : []
})
describe('projects package boundary', () => {
  it('does not reach into the host or transports', () => {
    const forbidden = [
      /@voicechat\/ui(?:\/|['"])/, /voiceStore|useVoiceStore/, /apps\/(?:web|desktop)/,
      /\bwindow\s*[.[]/, /\bfetch\s*\(/, /\bnew\s+WebSocket\b/, /ipcRenderer/,
      /from\s+['"]electron/
    ]
    for (const file of sources(root)) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of forbidden) expect(source, `${file} contains ${pattern}`).not.toMatch(pattern)
    }
  })
  it('keeps a small public export map', () => {
    const manifest = JSON.parse(readFileSync(join(root, '..', 'package.json'), 'utf8')) as { exports: Record<string, string> }
    expect(Object.keys(manifest.exports)).toEqual(['.', './styles.css'])
  })
})
