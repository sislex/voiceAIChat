import { beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../server.js'
import { loadConfig } from '../config.js'
import { VoiceChatDb } from '../db/database.js'
import { AgentRegistry } from '../agents/registry.js'
import { signToken } from '../users/accounts.js'

/**
 * Общая обвязка REST-тестов: свежий сервер на `:memory:`-БД перед каждым тестом.
 *
 * Вынесена из `rest.test.ts`, потому что тот файл дорос до 2503 строк и 138
 * тестов и стал критическим путём всего серверного набора: сам по себе он шёл
 * 23 с при 37 с на весь пакет. Vitest параллелит по файлам, а не по describe,
 * поэтому разрезка на `rest.*.test.ts` — единственный способ распараллелить эти
 * тесты; обвязка при этом обязана остаться одна на всех.
 *
 * Имя файла намеренно не оканчивается на `.test.ts`/`.spec.ts` — иначе он попал
 * бы в `include` конфига как тестовый файл без тестов.
 */
export const REST_SECRET = 'test-secret'
export const REST_ADMIN = 'admin'

export interface InjOpts {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  payload?: object | string
  headers?: Record<string, string>
}

export function setupRestHarness() {
  const sentMails: Array<{ to: string; subject: string; text: string; html?: string }> = []
  const triggerDeploy = vi.fn<() => Promise<{ status: 'accepted' | 'running'; message: string }>>()

  const harness = {
    app: undefined as unknown as FastifyInstance,
    db: undefined as unknown as VoiceChatDb,
    token: '',
    dataDir: '',
    agentRegistry: undefined as unknown as AgentRegistry,
    sentMails,
    triggerDeploy,
    SECRET: REST_SECRET,
    U: REST_ADMIN,
    inj(opts: InjOpts) {
      return harness.app.inject({
        ...opts,
        headers: { authorization: `Bearer ${harness.token}`, ...(opts.headers ?? {}) }
      })
    }
  }

  beforeEach(async () => {
    let id = 0
    let clock = 1000
    harness.db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
    harness.dataDir = join(tmpdir(), `vc-rest-test-${Date.now()}-${id}`)
    triggerDeploy.mockReset()
    harness.agentRegistry = new AgentRegistry()
    triggerDeploy.mockResolvedValue({ status: 'accepted', message: 'deployment started' })
    sentMails.length = 0
    // Явно изолируем каталоги моделей/голосов во временную папку — тесты удаления
    // не должны касаться реальных файлов репозитория.
    harness.app = await buildServer({
      mailer: { configured: true, send: async (m) => { sentMails.push(m) } },
      // Место входа: тесты не ходят в сеть, но проверяют, что ответ доезжает до сессии.
      geo: { resolve: async () => ({ country: 'RU', city: 'Москва', label: 'Москва, RU' }) },
      config: loadConfig({
        PORT: '0',
        VC_DATA_DIR: harness.dataDir,
        VC_MODELS_DIR: join(harness.dataDir, 'models'),
        VC_PIPER_VOICES_DIR: join(harness.dataDir, 'voices')
      }),
      db: harness.db,
      agentRegistry: harness.agentRegistry,
      sessionSecret: REST_SECRET,
      deployTrigger: { trigger: triggerDeploy }
    })
    harness.token = signToken({ name: REST_ADMIN, role: 'admin' }, REST_SECRET)
  })

  // Лимитеры входа живут в процессе: между тестами сбрасываем, чтобы порядок тестов не давал 429.
  beforeEach(() => { (harness.app as unknown as { resetLoginLimiters?: () => void }).resetLoginLimiters?.() })

  afterEach(async () => {
    await harness.app.close()
    harness.db.close()
  })

  return harness
}

/**
 * Тип обвязки выводится из фабрики, а не описывается руками: у `app.inject`
 * перегрузки, и `ReturnType<FastifyInstance['inject']>` выбирает цепочечный
 * `Chain`, а не `Promise<Response>` — ручная сигнатура на этом ломалась.
 */
export type RestHarness = ReturnType<typeof setupRestHarness>
