// Инструменты БЗ для модели: доступ по секрету, форма выдачи и — главное —
// телеметрия. `deliveredChars` обязан совпадать с длиной текста, который реально
// ушёл модели: это единственное честное число в панели «Использование БЗ».

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { KbDocument, KbSearchResult } from '@voicechat/shared'
import { VoiceChatDb } from '../db/database.js'
import { createKbUsageTracker } from './usage.js'
import { KB_GAPS_FENCE, KB_GAP_RULE } from '@voicechat/shared'
import { registerKbMcp, kbToolBroker, sectionOf, kbToolHint, kbRunDirective, KB_DOCUMENT_CHAR_CAP, KB_MCP_PATH } from './kbMcp.js'
import type { KnowledgeBaseService } from './types.js'

const SECRET = 'test-secret'
const TURN = 'turn-token'
const U = 'admin'

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

const doc: KbDocument = {
  id: 'protocol',
  title: 'Протокол',
  kind: 'protocol',
  scope: 'usage',
  tags: [],
  packages: [],
  freshness: 'current',
  sourcePath: 'docs/kb/protocol.md',
  updated: '2026-07-27',
  body: '# Протокол\n\nВступление.\n\n## WebSocket\n\nКадры JSON.\n\n### Аудио\n\nБинарные кадры.\n\n## REST\n\nЗапрос-ответ.\n',
  symbols: [],
  protocols: [],
  areas: [],
  related: [],
  headings: [
    { title: 'Протокол', anchor: 'protokol', level: 1 },
    { title: 'WebSocket', anchor: 'websocket', level: 2 },
    { title: 'Аудио', anchor: 'audio', level: 3 },
    { title: 'REST', anchor: 'rest', level: 2 }
  ]
}

const hit: KbSearchResult = {
  documentId: 'protocol', chunkId: 'protocol#websocket', title: 'Протокол', heading: 'WebSocket',
  excerpt: 'Кадры JSON.', score: 12, matchTypes: ['symbol'], explanation: 'Точное совпадение символа',
  freshness: 'current', sourcePath: 'docs/kb/protocol.md', anchor: 'websocket', symbols: [], relatedFiles: []
}

function stubKb(over: Partial<KnowledgeBaseService> = {}): KnowledgeBaseService {
  return {
    status: () => ({ available: true, mode: 'source', searchMode: 'lexical', version: 'v', createdAt: 'now', documents: 1, chunks: 3, staleDocuments: 0 }),
    topics: () => [{ id: 'protocol', title: 'Протокол', kind: 'protocol', scope: 'usage', tags: [], packages: [], freshness: 'current', sourcePath: 'docs/kb/protocol.md' }],
    document: (id) => (id === 'protocol' ? doc : null),
    search: async () => [hit],
    context: async () => ({ query: '', confidence: 'low', autoInjectAllowed: false, sections: [], relatedFiles: [], relatedDocuments: [], staleWarnings: [], estimatedTokens: 0 }),
    ...over
  }
}

describe('kbMcp — инструменты базы знаний', () => {
  let app: FastifyInstance
  let db: VoiceChatDb
  let convId: string
  const triggerDeploy = vi.fn<() => Promise<{ status: 'accepted' | 'running'; message: string }>>()

  async function makeApp(kb: KnowledgeBaseService = stubKb(), deployTrigger: { trigger: typeof triggerDeploy } | undefined = { trigger: triggerDeploy }): Promise<void> {
    app = Fastify({ logger: false })
    registerKbMcp(app, { kb, secret: SECRET, usage: createKbUsageTracker({ db }), db, deployTrigger })
    await app.ready()
  }

  async function rpc(body: unknown, query = `?k=${SECRET}&turn=${TURN}`): Promise<{ statusCode: number; json: () => unknown }> {
    const res = await app.inject({ method: 'POST', url: `${KB_MCP_PATH}${query}`, headers: MCP_HEADERS, payload: body as object })
    return { statusCode: res.statusCode, json: () => res.json() }
  }

  async function call(name: string, args: Record<string, unknown> = {}, query?: string): Promise<{ text: string; isError?: boolean }> {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, query)
    const body = res.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    return { text: body.result.content.map((c) => c.text).join('\n'), isError: body.result.isError }
  }

  beforeEach(() => {
    let id = 0
    let clock = 1_000
    db = new VoiceChatDb(':memory:', { newId: () => `id-${++id}`, now: () => (clock += 10) })
    db.createUser(U, '', 'admin')
    triggerDeploy.mockReset()
    triggerDeploy.mockResolvedValue({ status: 'accepted', message: 'deployment started' })
    convId = db.createConversation(U, 'Чат').id
    kbToolBroker.register(TURN, { userId: U, conversationId: convId, projectId: null, turnId: 't1' })
  })
  afterEach(async () => {
    kbToolBroker.unregister(TURN)
    await app.close()
    db.close()
  })

  it('неверный секрет k → 403', async () => {
    await makeApp()
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, `?k=wrong&turn=${TURN}`)).statusCode).toBe(403)
  })

  it('tools/list показывает search, document и topics', async () => {
    await makeApp()
    const list = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const body = list.json() as { result: { tools: Array<{ name: string }> } }
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(['deploy_prod', 'document', 'machines', 'projects', 'runtime_context', 'search', 'topics', 'usage', 'user_settings'])
  })

  it('deploy_prod запускает host-side DeployTrigger для актуального admin и возвращает accepted', async () => {
    await makeApp()
    const result = await call('deploy_prod')
    expect(JSON.parse(result.text)).toEqual({ status: 'accepted', message: 'deployment started' })
    expect(result.isError).not.toBe(true)
    expect(triggerDeploy).toHaveBeenCalledOnce()
  })

  it('deploy_prod отказывает обычному пользователю без запуска', async () => {
    db.createUser('user', '', 'developer')
    kbToolBroker.register(TURN, { userId: 'user', conversationId: convId, projectId: null, turnId: 't1' })
    await makeApp()
    const result = await call('deploy_prod')
    expect(JSON.parse(result.text)).toMatchObject({ error: { code: 'forbidden' } })
    expect(result.isError).toBe(true)
    expect(triggerDeploy).not.toHaveBeenCalled()
  })

  it('deploy_prod перечитывает блокировку admin и отказывает без запуска', async () => {
    db.setUserBlocked(U, true)
    await makeApp()
    const result = await call('deploy_prod')
    expect(JSON.parse(result.text)).toMatchObject({ error: { code: 'forbidden' } })
    expect(result.isError).toBe(true)
    expect(triggerDeploy).not.toHaveBeenCalled()
  })

  it('deploy_prod возвращает running как штатный результат', async () => {
    triggerDeploy.mockResolvedValueOnce({ status: 'running', message: 'deployment already running' })
    await makeApp()
    const result = await call('deploy_prod')
    expect(JSON.parse(result.text)).toEqual({ status: 'running', message: 'deployment already running' })
    expect(result.isError).not.toBe(true)
  })

  it('deploy_prod возвращает структурированную ошибку недоступного host API', async () => {
    triggerDeploy.mockRejectedValueOnce(new Error('socket unavailable'))
    await makeApp()
    const result = await call('deploy_prod')
    expect(JSON.parse(result.text)).toEqual({
      error: { code: 'deploy_unavailable', message: 'Host-side deploy API недоступен.', detail: 'socket unavailable' }
    })
    expect(result.isError).toBe(true)
  })

  it('search пишет обращение с deliveredChars === длине отданного текста', async () => {
    await makeApp()
    const { text } = await call('search', { query: 'websocket' })
    const report = db.kbUsageReport(U, convId)!
    expect(report.recent).toHaveLength(1)
    expect(report.recent[0]).toMatchObject({ source: 'tool_search', status: 'delivered', chars: text.length, turnId: 't1' })
    expect(report.recent[0].sections[0]).toMatchObject({ documentId: 'protocol', anchor: 'websocket' })
  })

  it('document отдаёт раздел и пишет его точную длину', async () => {
    await makeApp()
    const { text } = await call('document', { documentId: 'protocol', anchor: 'websocket' })
    expect(text).toContain('Кадры JSON.')
    expect(text).toContain('Бинарные кадры.') // вложенный ### входит в раздел
    expect(text).not.toContain('Запрос-ответ.') // следующий ## — уже другой раздел
    const q = db.kbUsageReport(U, convId)!.recent[0]
    expect(q).toMatchObject({ source: 'tool_document', chars: text.length })
    expect(q.estimatedTokens).toBe(Math.ceil(text.length / 4))
  })

  it('раздел длиннее капа обрезается с пометкой', async () => {
    const long = { ...doc, body: `# Протокол\n\n## WebSocket\n\n${'я'.repeat(KB_DOCUMENT_CHAR_CAP + 500)}\n` }
    await makeApp(stubKb({ document: () => long }))
    const { text } = await call('document', { documentId: 'protocol', anchor: 'websocket' })
    expect(text).toContain('раздел обрезан')
    expect(text.length).toBeLessThan(KB_DOCUMENT_CHAR_CAP + 300)
  })

  it('неизвестный раздел → isError и обращение со статусом empty', async () => {
    await makeApp()
    const { isError } = await call('document', { documentId: 'protocol', anchor: 'нет-такого' })
    expect(isError).toBe(true)
    expect(db.kbUsageReport(U, convId)!.recent[0].status).toBe('empty')
  })

  it('topics отдаёт оглавление и считается отдельным источником', async () => {
    await makeApp()
    const { text } = await call('topics')
    expect(text).toContain('protocol · Протокол')
    expect(db.kbUsageReport(U, convId)!.recent[0]).toMatchObject({ source: 'tool_topics', chars: text.length })
  })

  it('просроченный ?turn= → isError без записи обращения', async () => {
    await makeApp()
    const { isError, text } = await call('search', { query: 'x' }, `?k=${SECRET}&turn=устаревший`)
    expect(isError).toBe(true)
    expect(text).toContain('Контекст хода недоступен')
    expect(db.kbUsageReport(U, convId)!.totals.queries).toBe(0)
  })

  it('после ответа не остаётся отложенных исключений (тело читает транспорт, не Fastify)', async () => {
    // Если тело запроса вычитает Fastify, hono/node-server внутри MCP-SDK через
    // 500 мс «дренирует» соединение и дёргает socket.destroySoon() — на сокете
    // от app.inject такого метода нет, и таймер валит весь прогон необработанным
    // исключением уже после того, как все тесты позеленели (см. тот же тест в
    // remoteBashMcp.test.ts — там эта грабля была вычищена раньше).
    await makeApp()
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).statusCode).toBe(200)

    const caught: Error[] = []
    const onUncaught = (err: Error): void => { caught.push(err) }
    process.on('uncaughtException', onUncaught)
    try {
      await new Promise((r) => setTimeout(r, 800))
    } finally {
      process.off('uncaughtException', onUncaught)
    }
    expect(caught.map((e) => e.message)).toEqual([])
  })

  it('падение поиска в БЗ → isError и обращение со статусом error', async () => {
    await makeApp(stubKb({ search: async () => { throw new Error('индекс сломан') } }))
    const { isError } = await call('search', { query: 'x' })
    expect(isError).toBe(true)
    expect(db.kbUsageReport(U, convId)!.recent[0]).toMatchObject({ status: 'error', error: 'индекс сломан' })
  })
})

describe('sectionOf', () => {
  it('без anchor отдаёт документ целиком', () => {
    const slice = sectionOf(doc)
    expect(slice?.text).toContain('Вступление.')
    expect(slice?.text).toContain('Запрос-ответ.')
    expect(slice?.truncated).toBe(false)
  })

  it('режет по заголовку того же уровня и включает вложенные', () => {
    const slice = sectionOf(doc, 'websocket')
    expect(slice?.heading).toBe('WebSocket')
    expect(slice?.text).toContain('Аудио')
    expect(slice?.text).not.toContain('REST')
  })

  it('неизвестный anchor → null', () => {
    expect(sectionOf(doc, 'нет')).toBeNull()
  })

  it('кап обрезает текст и поднимает флаг', () => {
    const slice = sectionOf({ ...doc, body: '# T\n\n## A\n\n' + 'x'.repeat(50) }, 'a', 10)
    expect(slice?.truncated).toBe(true)
    expect(slice?.text).toContain('раздел обрезан')
  })
})

describe('kbToolHint', () => {
  it('оба варианта требуют искать в БЗ до чтения кода', () => {
    for (const mode of ['auto', 'manual'] as const) {
      expect(kbToolHint(mode)).toContain('mcp__kb__search')
      expect(kbToolHint(mode)).toContain('в первую очередь')
    }
  })

  it('manual объясняет, что инструмент — единственный путь к базе', () => {
    expect(kbToolHint('manual')).toContain('единственный путь')
    expect(kbToolHint('auto')).toContain('добавлен автоматически')
  })
})

describe('kbRunDirective', () => {
  it('оба режима начинают с базы знаний и требуют закрыть её пробелы', () => {
    for (const mode of ['auto', 'manual'] as const) {
      const directive = kbRunDirective(mode)
      expect(directive).toContain('Начни работу с базы знаний проекта, а не с кода')
      expect(directive).toContain(KB_GAP_RULE)
      // В ране пишет не модель, а шаг воркфлоу — поэтому нужен формат блока.
      expect(directive).toContain('```' + KB_GAPS_FENCE)
      expect(directive).toContain('Актуализировать базу знаний')
    }
  })
})
