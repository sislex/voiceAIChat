// MCP-эндпоинт «kb»: инструменты модели для чтения базы знаний. Без них метрика
// «сколько раз модель запросила БЗ» невозможна — сервер лишь подмешивает контекст
// в промпт, а сама модель раньше в БЗ не заходила.
//
// Устройство как у ci-эндпоинта: stateless (свежий McpServer на POST), доступ по
// секрету процесса `?k=`, конкретный ход адресуется токеном `?turn=` через
// in-memory брокер. Токен обязателен: без него нельзя понять, чью телеметрию
// писать, а Bearer-токена у CLI нет.

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { KbDocument } from '@voicechat/shared'
import type { KbView, KnowledgeBaseService } from './types.js'
import { PUBLIC_KB_VIEW } from './types.js'
import type { KbUsageTracker } from './usage.js'
import { KB_CONTEXT_HEADING } from './autoContext.js'

export const KB_MCP_PATH = '/mcp/kb'

/** Кап на длину одного раздела: без него один вызов вливает в контекст всю БЗ. */
export const KB_DOCUMENT_CHAR_CAP = 8000

/**
 * Ход, от имени которого модель читает БЗ (регистрирует turns.ts, а для работы
 * модели в CI-ране — ci/modelHooks.ts).
 */
export interface KbToolEntry {
  userId: string
  /**
   * Чат хода. `null` — ход CI-рана без связанного чата: инструменты работают
   * (база read-only), телеметрию писать некуда — она молча пропускается.
   */
  conversationId: string | null
  projectId: string | null
  turnId: string
  /** Ход внутри CI-рана: ран и шаг его ленты — для отчётов по ране и задаче. */
  ciRunId?: string | null
  ciStepId?: string | null
}

/** In-memory брокер: токен хода → контекст. Токен живёт ровно один ход. */
class KbToolBroker {
  private readonly map = new Map<string, KbToolEntry>()
  register(token: string, entry: KbToolEntry): void {
    this.map.set(token, entry)
  }
  unregister(token: string): void {
    this.map.delete(token)
  }
  get(token: string): KbToolEntry | undefined {
    return this.map.get(token)
  }
  /** Только для тестов: сколько токенов держим (проверка на утечку). */
  size(): number {
    return this.map.size
  }
}

export const kbToolBroker = new KbToolBroker()

/**
 * Политика «БЗ в первую очередь» для системного промпта. Формулировка — приоритет,
 * а не справка: сначала поиск по базе знаний, затем раздел целиком, и только потом
 * чтение кода. Источник истины при расхождении — код (см. docs/kb/kb-workflow.md).
 *
 * Два варианта одного текста: в `auto` блок контекста уже вставлен в промпт, в
 * `manual` инструмент — единственный путь модели к базе знаний.
 */
export function kbToolHint(mode: 'auto' | 'manual'): string {
  const common =
    `База знаний проекта — в первую очередь. Прежде чем читать код, найди тему: ` +
    `mcp__kb__search по задаче, затем mcp__kb__document на найденный раздел ` +
    `(mcp__kb__topics — оглавление). Так дешевле, чем исследовать файлы заново. ` +
    `При расхождении базы знаний и кода источник истины — код: правь и то, и другое.`
  return mode === 'manual'
    ? `${common}\n\nАвтоматический контекст базы знаний для этого разговора выключен ` +
        `(режим «по запросу модели»): инструменты mcp__kb__* — единственный путь к ней.`
    : `${common}\n\nБлок «Контекст базы знаний voiceAIChat» ниже добавлен автоматически ` +
        `по теме запроса — он не полный, за подробностями иди инструментами.`
}

/**
 * Требование «сначала база знаний, потом код» для работы модели в CI-ране. В
 * отличие от `kbToolHint` (системный хинт CLI, справка об инструментах) это
 * часть ЗАДАНИЯ: ран начинается с исследования проекта по базе знаний, и только
 * потом модель идёт в файлы.
 */
export function kbRunDirective(mode: 'auto' | 'manual'): string {
  const common =
    'Начни работу с базы знаний проекта, а не с кода: найди тему задачи через mcp__kb__search, ' +
    'прочитай найденные разделы через mcp__kb__document (mcp__kb__topics — оглавление) ' +
    'и только потом открывай файлы. При расхождении базы знаний и кода источник истины — код.'
  return mode === 'manual'
    ? `${common} Авто-контекст базы знаний для этого рана выключен: инструменты mcp__kb__* — единственный путь к ней.`
    : `${common} Блок «${KB_CONTEXT_HEADING.replace(/^#+\s*/, '')}» ниже добавлен автоматически по теме задачи и не полон — за подробностями иди инструментами.`
}

/** Устойчивый anchor раздела — та же схема, что в индексе (service.ts). */
function slug(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
}

export interface KbSectionSlice {
  heading: string
  anchor: string
  text: string
  /** Текст обрезан капом — модель должна знать, что видит не весь раздел. */
  truncated: boolean
}

/**
 * Вырезка раздела документа по anchor: от его заголовка до следующего заголовка
 * того же или более высокого уровня. Без anchor — документ целиком. Чистая
 * функция: тестируется отдельно от транспорта.
 */
export function sectionOf(doc: KbDocument, anchor?: string, cap = KB_DOCUMENT_CHAR_CAP): KbSectionSlice | null {
  const lines = doc.body.split(/\r?\n/)
  const clamp = (heading: string, resolved: string, body: string): KbSectionSlice => {
    const trimmed = body.trim()
    const truncated = trimmed.length > cap
    return {
      heading,
      anchor: resolved,
      text: truncated ? `${trimmed.slice(0, cap)}\n\n[…раздел обрезан: показаны первые ${cap} символов]` : trimmed,
      truncated
    }
  }
  if (!anchor) return clamp(doc.title, '', doc.body)
  let level = 0
  let heading = ''
  const out: string[] = []
  for (const line of lines) {
    const match = /^(#{1,4})\s+(.+)$/.exec(line)
    if (!heading) {
      if (match && slug(match[2].trim()) === anchor) {
        level = match[1].length
        heading = match[2].trim()
      }
      continue
    }
    if (match && match[1].length <= level) break
    out.push(line)
  }
  if (!heading) return null
  return clamp(heading, anchor, out.join('\n'))
}

export interface RegisterKbMcpOptions {
  kb: KnowledgeBaseService
  secret: string
  usage?: KbUsageTracker
  /**
   * Вид пользователя хода: без него модель видит только общий раздел
   * «Использование» (безопасный дефолт — инструмент не должен обходить доступ).
   */
  viewOf?: (entry: KbToolEntry) => KbView
}

export function registerKbMcp(app: FastifyInstance, opts: RegisterKbMcpOptions): void {
  const { kb, secret, usage } = opts
  app.post<{ Querystring: { k?: string; turn?: string } }>(KB_MCP_PATH, async (req, reply) => {
    if (req.query.k !== secret) return reply.code(403).send({ error: 'forbidden' })
    const entry = kbToolBroker.get(req.query.turn ?? '')

    // Вид считаем один раз на запрос: он же гейт доступа к знаниям проекта.
    const view: KbView = entry && opts.viewOf ? opts.viewOf(entry) : PUBLIC_KB_VIEW

    const server = new McpServer({ name: 'kb', version: '1.0.0' })
    /** Ход уже завершён (или токен чужой) — читать БЗ не от чьего имени. */
    const noContext = { content: [{ type: 'text' as const, text: 'Контекст хода недоступен: обращение к базе знаний не записано.' }], isError: true }
    const open = (source: 'tool_search' | 'tool_document' | 'tool_topics', query: string) =>
      entry && usage
        ? usage.begin(
            {
              userId: entry.userId,
              conversationId: entry.conversationId,
              projectId: entry.projectId,
              turnId: entry.turnId,
              ciRunId: entry.ciRunId ?? null,
              ciStepId: entry.ciStepId ?? null,
              source
            },
            query
          )
        : undefined

    server.registerTool(
      'search',
      {
        description:
          'Поиск по базе знаний проекта voiceAIChat (фичи, подсистемы, протоколы, подходы). ' +
          'Возвращает разделы с id вида documentId#anchor — их читают инструментом document.',
        inputSchema: { query: z.string().describe('Тема, символ, путь или протокол'), limit: z.number().optional().describe('Сколько разделов вернуть (по умолчанию 8)') }
      },
      async ({ query, limit }) => {
        if (!entry) return noContext
        const handle = open('tool_search', query)
        try {
          const found = await kb.search({ query, limit: limit && limit > 0 ? Math.min(limit, 20) : 8 }, view)
          if (!found.length) {
            handle?.empty('no-match')
            return { content: [{ type: 'text', text: 'В базе знаний ничего не нашлось. Дальше — по коду.' }] }
          }
          const blocks = found.map(
            (item) =>
              `- ${item.documentId}${item.anchor ? `#${item.anchor}` : ''} · ${item.title} / ${item.heading}\n` +
              `  ${item.sourcePath} · ${item.explanation}\n  ${item.excerpt}`
          )
          const text = blocks.join('\n')
          handle?.complete({
            deliveredChars: text.length,
            injected: true,
            sections: found.map((item, index) => ({
              documentId: item.documentId,
              title: item.title,
              heading: item.heading,
              anchor: item.anchor,
              sourcePath: item.sourcePath,
              chars: blocks[index].length,
              score: item.score,
              matchTypes: item.matchTypes,
              freshness: item.freshness
            }))
          })
          return { content: [{ type: 'text', text }] }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          handle?.fail(message)
          return { content: [{ type: 'text', text: `Поиск по базе знаний не удался: ${message}` }], isError: true }
        }
      }
    )

    server.registerTool(
      'document',
      {
        description:
          'Раздел базы знаний целиком. documentId — из search или topics; anchor — раздел внутри документа ' +
          `(без anchor вернётся весь документ). Длинный текст обрезается на ${KB_DOCUMENT_CHAR_CAP} символах.`,
        inputSchema: { documentId: z.string().describe('id документа базы знаний'), anchor: z.string().optional().describe('anchor раздела (часть после #)') }
      },
      async ({ documentId, anchor }) => {
        if (!entry) return noContext
        const label = `${documentId}${anchor ? `#${anchor}` : ''}`
        const handle = open('tool_document', label)
        try {
          const doc = kb.document(documentId, view)
          const slice = doc ? sectionOf(doc, anchor) : null
          if (!doc || !slice) {
            handle?.empty('no-match')
            return { content: [{ type: 'text', text: `Раздел ${label} в базе знаний не найден.` }], isError: true }
          }
          const text = `# ${doc.title} / ${slice.heading}\nИсточник: ${doc.sourcePath}${slice.anchor ? `#${slice.anchor}` : ''}\n\n${slice.text}`
          handle?.complete({
            deliveredChars: text.length,
            injected: true,
            sections: [{
              documentId: doc.id,
              title: doc.title,
              heading: slice.heading,
              anchor: slice.anchor,
              sourcePath: doc.sourcePath,
              chars: text.length,
              freshness: doc.freshness
            }]
          })
          return { content: [{ type: 'text', text }] }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          handle?.fail(message)
          return { content: [{ type: 'text', text: `Чтение базы знаний не удалось: ${message}` }], isError: true }
        }
      }
    )

    server.registerTool(
      'topics',
      { description: 'Оглавление базы знаний: все документы с типом, тегами и путём к источнику.', inputSchema: {} },
      async () => {
        if (!entry) return noContext
        const handle = open('tool_topics', 'оглавление')
        try {
          const topics = kb.topics(view)
          if (!topics.length) {
            handle?.empty('no-match')
            return { content: [{ type: 'text', text: 'База знаний пуста.' }] }
          }
          const text = topics.map((item) => `- ${item.id} · ${item.title} (${item.kind}) — ${item.sourcePath}`).join('\n')
          handle?.complete({ deliveredChars: text.length, injected: true })
          return { content: [{ type: 'text', text }] }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          handle?.fail(message)
          return { content: [{ type: 'text', text: `Оглавление базы знаний недоступно: ${message}` }], isError: true }
        }
      }
    )

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    reply.hijack()
    try {
      await server.connect(transport)
      await transport.handleRequest(req.raw, reply.raw, req.body)
    } catch (err) {
      if (!reply.raw.writableEnded) {
        try {
          reply.raw.writeHead(500, { 'content-type': 'application/json' })
          reply.raw.end(JSON.stringify({ error: err instanceof Error ? err.message : 'mcp transport error' }))
        } catch {
          /* соединение уже закрыто */
        }
      }
    }
  })
}
