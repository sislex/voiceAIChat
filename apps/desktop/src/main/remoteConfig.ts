// Режим тонкого клиента: URL сервера, к которому подключается десктоп-renderer.
// null — локальный режим (claude/STT/TTS в main-процессе). Хранится в
// userData/remote.json.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function path(dir: string): string {
  return join(dir, 'remote.json')
}

/** Читает URL сервера (null — локальный режим). */
export function readServerUrl(dir: string): string | null {
  try {
    const o = JSON.parse(readFileSync(path(dir), 'utf8')) as { serverUrl?: unknown }
    return typeof o.serverUrl === 'string' && o.serverUrl ? o.serverUrl : null
  } catch {
    return null
  }
}

/** Сохраняет URL сервера; null/пусто — сброс в локальный режим. */
export function writeServerUrl(dir: string, url: string | null): void {
  mkdirSync(dir, { recursive: true })
  const serverUrl = url && url.trim() ? url.trim().replace(/\/$/, '') : null
  writeFileSync(path(dir), JSON.stringify({ serverUrl }, null, 2))
}
