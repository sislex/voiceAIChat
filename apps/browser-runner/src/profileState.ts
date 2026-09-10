import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BrowserContext } from 'playwright'
import type { BrowserViewport } from '@voicechat/shared'

type Cookies = Awaited<ReturnType<BrowserContext['cookies']>>
export interface ReaderProfileState { cookies: Cookies; url?: string; viewport?: BrowserViewport; origins?: string[] }
const NAME = '.reader-state.json'
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
const validViewport = (v: unknown): v is BrowserViewport => record(v) && typeof v.width === 'number' && Number.isInteger(v.width) && v.width >= 320 && v.width <= 3840 && typeof v.height === 'number' && Number.isInteger(v.height) && v.height >= 240 && v.height <= 2160 && typeof v.deviceScaleFactor === 'number' && Number.isFinite(v.deviceScaleFactor) && v.deviceScaleFactor >= 1 && v.deviceScaleFactor <= 3

/** Сессионные cookie Chromium не пишет как постоянные: сохраняем их вместе с
 * последним адресом. Пароли/токены не выводятся в диагностику и ответы API. */
export async function readReaderProfile(path: string): Promise<ReaderProfileState | null> {
  try {
    const file = join(path, NAME)
    if ((await stat(file)).size > 16 * 1024 * 1024) return null
    const value: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!record(value) || !Array.isArray(value.cookies)) return null
    const cookies = value.cookies.filter((c: unknown): c is Cookies[number] => record(c) && typeof c.name === 'string' && typeof c.value === 'string' && typeof c.domain === 'string' && typeof c.path === 'string' && typeof c.expires === 'number' && Number.isFinite(c.expires) && typeof c.httpOnly === 'boolean' && typeof c.secure === 'boolean' && typeof c.sameSite === 'string' && ['Strict', 'Lax', 'None'].includes(c.sameSite) && (c.partitionKey === undefined || typeof c.partitionKey === 'string'))
    return { cookies, ...(Array.isArray(value.origins) ? { origins: value.origins.filter((origin: unknown): origin is string => typeof origin === 'string' && /^https?:\/\//.test(origin)).flatMap(origin => { try { return [new URL(origin).origin] } catch { return [] } }) } : {}), ...(typeof value.url === 'string' && value.url.length <= 16000 ? { url: value.url } : {}), ...(validViewport(value.viewport) ? { viewport: value.viewport } : {}) }
  } catch { return null }
}

/** Атомарная замена оставляет предыдущий читаемый файл при прерванной записи. */
export async function writeReaderProfile(path: string, value: ReaderProfileState): Promise<void> {
  const temporary = join(path, `${NAME}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, join(path, NAME))
  } finally { await rm(temporary, { force: true }).catch(() => undefined) }
}
