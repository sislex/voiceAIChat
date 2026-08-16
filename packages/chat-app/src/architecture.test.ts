import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sources(path) : ['.ts', '.tsx'].includes(extname(path)) && !path.endsWith('.test.ts') ? [path] : []
  })
}

describe('chat-app architecture', () => {
  it('does not import host, projects internals, other stores or transports', () => {
    const forbidden = /(?:from\s+['"][^'"]*(?:packages\/ui|apps\/(?:web|desktop)|projects-app\/src|operationsStore|adminStore|shellStore)|\bfetch\s*\(|new\s+WebSocket|ipcRenderer|MediaStream|AudioContext|window\.)/
    for (const file of sources(join(process.cwd(), 'src'))) expect(readFileSync(file, 'utf8'), file).not.toMatch(forbidden)
  })
})
