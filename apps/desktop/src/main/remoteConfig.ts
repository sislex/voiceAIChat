// Режим тонкого клиента: URL сервера, к которому подключается десктоп-renderer.
// null — сервер ещё не настроен (claude/STT/TTS в main-процессе). Хранится в
// userData/remote.json.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function path(dir: string): string {
  return join(dir, 'remote.json')
}

/** Читает URL сервера (null — сервер ещё не настроен). */
export function readServerUrl(dir: string): string | null {
  try {
    const o = JSON.parse(readFileSync(path(dir), 'utf8')) as { serverUrl?: unknown }
    return typeof o.serverUrl === 'string' && o.serverUrl ? o.serverUrl : null
  } catch {
    return null
  }
}

/** Сохраняет URL сервера; null/пусто — сброс адреса сервера. */
export function writeServerUrl(dir: string, url: string | null): void {
  mkdirSync(dir, { recursive: true })
  const serverUrl = url && url.trim() ? url.trim().replace(/\/$/, '') : null
  writeFileSync(
    path(dir),
    JSON.stringify({ serverUrl, migratedServerUrls: readMigratedServerUrls(dir) }, null, 2)
  )
}

function readMigratedServerUrls(dir: string): string[] {
  try {
    const o = JSON.parse(readFileSync(path(dir), 'utf8')) as { migratedServerUrls?: unknown }
    return Array.isArray(o.migratedServerUrls)
      ? o.migratedServerUrls.filter((v): v is string => typeof v === 'string')
      : []
  } catch {
    return []
  }
}

/** Успешно ли legacy-данные уже отправлялись на этот сервер. */
export function isDesktopMigrationDone(dir: string, serverUrl: string): boolean {
  return readMigratedServerUrls(dir).includes(serverUrl.replace(/\/$/, ''))
}

/** Помечает сервер импортированным, не меняя выбранный URL. */
export function markDesktopMigrationDone(dir: string, serverUrl: string): void {
  const normalized = serverUrl.replace(/\/$/, '')
  const migratedServerUrls = [...new Set([...readMigratedServerUrls(dir), normalized])]
  mkdirSync(dir, { recursive: true })
  writeFileSync(path(dir), JSON.stringify({ serverUrl: readServerUrl(dir), migratedServerUrls }, null, 2))
}

export interface DesktopEnrollmentFlow {
  revealWindow: () => void
  enroll: (deepLink: string) => Promise<void>
  parse: (deepLink: string) => { serverUrl: string } | null
  currentServerUrl: () => string | null
  applyServerUrl: (url: string) => void
  reportError: (error: unknown) => void
}

/** Окно должно появиться до любой сети: enrollment может ждать недоступный сервер. */
export async function runDesktopEnrollment(value: string, flow: DesktopEnrollmentFlow): Promise<void> {
  flow.revealWindow()
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'voicechat-login:' && parsed.hostname === 'open') return

    const enrollment = flow.parse(value)
    await flow.enroll(value)
    if (enrollment && flow.currentServerUrl() !== enrollment.serverUrl) {
      flow.applyServerUrl(enrollment.serverUrl)
    }
  } catch (error) {
    flow.reportError(error)
    flow.revealWindow()
  }
}
