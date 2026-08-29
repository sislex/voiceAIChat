import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import type { BrowserCommandRequest } from '@voicechat/shared'
import { registerRunnerAuth } from './security.js'
import { BrowserSessionManager, type StartSessionRequest } from './sessionManager.js'

const playwrightVersion = createRequire(import.meta.url)('playwright/package.json') as { version?: string }

/** Что health знает о браузере: есть ли исполняемый файл и запускается ли он. */
export interface BrowserProbe {
  ok: boolean
  browser: { present: boolean; version: string | null; error?: string }
  launch: { ok: boolean; error?: string }
}

export interface BuildBrowserRunnerOptions {
  token: string
  profilesRoot: string
  sessions?: BrowserSessionManager
  /** Подмена проверки браузера в тестах: настоящий запуск там не нужен. */
  probe?: () => Promise<BrowserProbe>
  /** Простой, после которого сессия закрывается сборщиком; 0 — не убирать. */
  idleMs?: number
}

/**
 * Успешный запуск кэшируется: поднимать Chromium на каждый health-запрос (у
 * compose это раз в полминуты) незачем. Неуспешный не кэшируется — сбой может
 * быть разовым, и сервис должен уметь вернуться в строй сам.
 */
let cachedProbe: BrowserProbe | null = null
async function defaultProbe(): Promise<BrowserProbe> {
  if (cachedProbe) return cachedProbe
  const version = (playwrightVersion as { version?: string }).version ?? null
  let executable = ''
  try { executable = chromium.executablePath() } catch (error) {
    return { ok: false, browser: { present: false, version, error: error instanceof Error ? error.message.split('\n')[0] : 'no executable path' }, launch: { ok: false } }
  }
  if (!existsSync(executable)) {
    // Ровно этот случай: образ и пакет разъехались по версии.
    return { ok: false, browser: { present: false, version, error: `Исполняемый файл браузера не найден: ${executable}` }, launch: { ok: false } }
  }
  try {
    const browser = await chromium.launch({ headless: true })
    await browser.close()
  } catch (error) {
    return { ok: false, browser: { present: true, version }, launch: { ok: false, error: error instanceof Error ? error.message.split('\n')[0] : 'launch failed' } }
  }
  cachedProbe = { ok: true, browser: { present: true, version }, launch: { ok: true } }
  return cachedProbe
}

/** Через сколько простоя сессия считается брошенной. */
const DEFAULT_IDLE_MS = 30 * 60_000
const SWEEP_EVERY_MS = 5 * 60_000

export async function buildBrowserRunner(options: BuildBrowserRunnerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const sessions = options.sessions ?? new BrowserSessionManager(options.profilesRoot)
  registerRunnerAuth(app, options.token)

  // Сессию закрывает явный `stop`, но его никто не зовёт, если пользователь
  // просто закрыл вкладку, а ран оборвался: Chromium жил до перезапуска
  // контейнера. Сборщик закрывает брошенные и удаляет их профили.
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const sweeper = idleMs > 0 ? setInterval(() => { void sessions.sweepIdle(idleMs).catch(() => undefined) }, SWEEP_EVERY_MS) : null
  sweeper?.unref?.()
  app.addHook('onClose', async () => { if (sweeper) clearInterval(sweeper) })

  // Health обязан проверять то, ради чего сервис существует. Раньше он отвечал
  // литералами `present: true, launch.ok: true`, поэтому контейнер с
  // несовпадающей версией браузера считался здоровым, а падала только первая
  // сессия — с разъехавшимися версиями Playwright это и произошло.
  app.get('/v1/health', async (_request, reply) => {
    const probe = await options.probe?.() ?? await defaultProbe()
    if (!probe.ok) reply.code(503)
    return { ...probe, sessions: sessions.count() }
  })
  app.post<{ Body: StartSessionRequest }>('/v1/sessions', async (request, reply) => {
    try { return await sessions.start(request.body) }
    catch (error) { return reply.code(503).send({ error: 'start_failed', message: error instanceof Error ? error.message : 'unknown error' }) }
  })
  app.post<{ Params: { id: string }; Body: BrowserCommandRequest }>('/v1/sessions/:id/commands', async (request, reply) => {
    try {
      const result = await sessions.command(request.params.id, request.body)
      if (Buffer.isBuffer(result)) return reply.type('image/png').send(result)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'internal'
      const status = message === 'not_found' ? 404 : message.startsWith('stale_') ? 409 : 422
      return reply.code(status).send({ error: message })
    }
  })
  app.delete<{ Params: { id: string } }>('/v1/sessions/:id', async (request) => ({ stopped: await sessions.stop(request.params.id) }))
  app.addHook('onClose', async () => sessions.close())
  return app
}
