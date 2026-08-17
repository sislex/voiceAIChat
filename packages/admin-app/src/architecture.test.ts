import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('admin-app boundary', () => {
  it('has no host stores, platform apps, direct transports or secret persistence', () => {
    const source = files(join(process.cwd(), 'src'))
      .filter((path) => !/\.(test|stories)\.tsx?$/.test(path) && !path.includes('/test/'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    expect(source).not.toMatch(/chatStore|projectsStore|operationsStore|settingsStore|window\.|\bfetch\(|WebSocket|EventSource|ipcRenderer|apps\/(web|desktop)|localStorage|sessionStorage/)
    expect(source).not.toMatch(/from ['"][^'"]*packages\/ui|from ['"][^'"]*\/src\//)
  })
})
