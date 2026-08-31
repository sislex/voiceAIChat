import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'test' ? [] : files(path)
    return /\.(ts|tsx)$/.test(name) && !/\.(test|stories)\.tsx?$/.test(name) ? [path] : []
  })
}

// Путь от самого файла, а не от cwd: тест одинаково работает и из пакета, и из корня.
const source = files(dirname(fileURLToPath(import.meta.url))).map((path) => readFileSync(path, 'utf8')).join('\n')

describe('граница модуля профиля', () => {
  it('не знает ни транспорта, ни платформы, ни хост-сторов', () => {
    // Модуль показывают два разных места — админка и страница «Мой аккаунт», —
    // и данные ему приносит хост портами. Прямое обращение к window или fetch
    // привязало бы карточку к одному из них.
    expect(source).not.toMatch(/\bwindow\.|\bfetch\(|WebSocket|EventSource|ipcRenderer|localStorage|document\./)
    expect(source).not.toMatch(/chatStore|projectsStore|settingsStore|adminStore\b/)
  })

  it('зависит только от общего ui-kit и модуля сессий', () => {
    const external = [...source.matchAll(/from\s*'([^'.][^']*)'/g)].map((m) => m[1]!)
    const allowed = new Set(['react', 'react-dom', '@voicechat/ui-kit', '@voicechat/sessions-app'])
    expect([...new Set(external)].filter((name) => !allowed.has(name))).toEqual([])
  })
})
