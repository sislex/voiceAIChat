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
import { kbToolHint } from '@voicechat/shared'
import type { KbView, KnowledgeBaseService } from './types.js'
import { PUBLIC_KB_VIEW } from './types.js'
import type { KbUsageTracker } from './usage.js'
import type { VoiceChatDb } from '../db/database.js'
import type { DeployTrigger } from '../routes/admin.js'
import { registerKbTools, kbToolBroker, type KbToolEntry } from '../../../../packages/knowledge/src/mcp.js'
export { kbToolBroker, kbRunDirective, sectionOf, KB_DOCUMENT_CHAR_CAP, type KbToolEntry, type KbSectionSlice } from '../../../../packages/knowledge/src/mcp.js'

export const KB_MCP_PATH = '/mcp/kb'

// Системный хинт CLI теперь общий с исполнителем (packages/shared) — реэкспорт
// оставлен, чтобы прежние импорты `kbToolHint` из этого модуля продолжали работать.
export { kbToolHint }

export interface RegisterKbMcpOptions {
  kb: KnowledgeBaseService
  secret: string
  usage?: KbUsageTracker
  /** БД нужна личным инструментам; доступ всё равно привязан к entry.userId. */
  db?: VoiceChatDb
  /**
   * Вид пользователя хода: без него модель видит только общий раздел
   * «Использование» (безопасный дефолт — инструмент не должен обходить доступ).
   */
  viewOf?: (entry: KbToolEntry) => Promise<KbView>
  /**
   * Живое состояние машин (реестр агентов): в БД его нет — статус, версия и ОС
   * известны только по текущему подключению. Не передан → инструмент «machines»
   * отдаёт машины без онлайн-полей.
   */
  agents?: {
    isOnline(agentId: string): boolean
    versionOf(agentId: string): string | undefined
    platformOf(agentId: string): string | undefined
  }
  /** Host-side деплой; вызывается только после живой проверки admin в БД. */
  deployTrigger?: DeployTrigger
}

export function registerKbMcp(app: FastifyInstance, opts: RegisterKbMcpOptions): void {
  const { kb, secret, usage } = opts
  // Тело читает сам транспорт, поэтому маршрут живёт в своей области видимости с
  // парсером-пустышкой: Fastify отдаёт управление, не трогая поток. Если тело
  // вычитает Fastify, hono/node-server внутри MCP-SDK (слушатель 'end' он вешает
  // уже после этого) решит, что клиент недослал запрос, и через 500 мс
  // «дренирует» соединение — рвёт сокет после каждого вызова, а на ненастоящем
  // сокете (`app.inject` в тестах) падает с `socket.destroySoon is not a
  // function` в таймере, то есть необработанным исключением процесса.
  app.register(async (scope) => {
    // Снимаем унаследованные парсеры (в т.ч. общий JSON из server.ts) — иначе
    // Fastify ругается «content type parser already present» на своей копии.
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', (_req, _payload, done) => {
      done(null, undefined)
    })
    scope.post<{ Querystring: { k?: string; turn?: string } }>(KB_MCP_PATH, async (req, reply) => {
      if (req.query.k !== secret) return reply.code(403).send({ error: 'forbidden' })
      const entry = kbToolBroker.get(req.query.turn ?? '')

      // Вид считаем один раз на запрос: он же гейт доступа к знаниям проекта.
      const view: KbView = await (entry && opts.viewOf ? opts.viewOf(entry) : PUBLIC_KB_VIEW)

      const server = new McpServer({ name: 'kb', version: '1.0.0' })
      /** Ход уже завершён (или токен чужой) — читать БЗ не от чьего имени. */
      const noContext = { content: [{ type: 'text' as const, text: 'Контекст хода недоступен: обращение к базе знаний не записано.' }], isError: true }
      registerKbTools(server, kb, view, entry, usage)

      if (!entry?.coreReadOnly) {
      server.registerTool(
        'runtime_context',
        {
          description:
            'Актуальный контекст этого хода: чат, привязанный проект и эффективные настройки LLM. ' +
            'Возвращает только данные, доступные владельцу текущего хода; секреты и настройки других пользователей не выдаются.',
          inputSchema: {}
        },
        async () => {
          if (!entry) return noContext
          const project = entry.projectId
            ? `Проект: ${entry.runtimeContext?.projectName ?? 'без имени'} (id: ${entry.projectId})`
            : 'Чат не привязан к проекту.'
          const git = entry.runtimeContext?.projectGitUrl ? `Git-репозиторий: ${entry.runtimeContext.projectGitUrl}` : ''
          const llm = entry.runtimeContext?.llm
            ? `LLM: ${entry.runtimeContext.llm.provider} / ${entry.runtimeContext.llm.model || 'по умолчанию CLI'}; источник: ${entry.runtimeContext.llm.source}.`
            : ''
          const text = [project, git, llm].filter(Boolean).join('\n')
          return { content: [{ type: 'text', text }] }
        }
      )

      server.registerTool(
        'user_settings',
        {
          description:
            'Настройки владельца текущего чата. Возвращает только настройки этого пользователя; ' +
            'персональные токены и секреты никогда не включаются.',
          inputSchema: {}
        },
        async () => {
          if (!entry) return noContext
          if (!entry.runtimeContext?.userSettings) {
            return { content: [{ type: 'text', text: 'Снимок пользовательских настроек для этого хода недоступен.' }], isError: true }
          }
          return { content: [{ type: 'text', text: JSON.stringify(entry.runtimeContext.userSettings, null, 2) }] }
        }
      )

      // Личные operational-инструменты получают идентификатор пользователя только из
      // записи хода. Аргумент userId намеренно отсутствует, чтобы CLI не мог
      // подменить область данных.
      server.registerTool('usage', {
        description: 'Личный расход моделей: итоги, динамика, модели и чаты. Показывает только владельца текущего хода.',
        inputSchema: {
          unit: z.enum(['hour', 'day', 'week']).default('day'),
          from: z.number().optional().describe('Unix-время в миллисекундах'),
          to: z.number().optional().describe('Unix-время в миллисекундах'),
          conversationId: z.string().optional()
        }
      }, async ({ unit, from, to, conversationId }) => {
        if (!entry || !opts.db) return noContext
        if (conversationId && !await opts.db.chat.getConversation(entry.userId, conversationId)) {
          return { content: [{ type: 'text', text: 'Этот чат недоступен владельцу текущего хода.' }], isError: true }
        }
        return { content: [{ type: 'text', text: JSON.stringify(await opts.db.chat.usageReport(entry.userId, unit, from, to, conversationId), null, 2) }] }
      })
      server.registerTool('machines', {
        description: 'Подключённые машины владельца: статус, ОС, версия и политика команд. Токены машин не возвращаются.',
        inputSchema: {}
      }, async () => {
        if (!entry || !opts.db) return noContext
        const settings = await opts.db.settings.getSettings(entry.userId)
        const machines = (await opts.db.machines.listAgents(entry.userId)).map((agent) => ({
          id: agent.id, name: agent.name, online: opts.agents?.isOnline(agent.id) ?? false,
          version: opts.agents?.versionOf(agent.id) ?? null, os: opts.agents?.platformOf(agent.id) ?? null,
          policy: agent.policy, isDefault: settings.defaultAgentId === agent.id
        }))
        return { content: [{ type: 'text', text: JSON.stringify(machines, null, 2) }] }
      })
      server.registerTool('deploy_prod', {
        description:
          'Запустить штатный production-деплой для запроса «обнови прод». Пользователь определяется из текущего хода; ' +
          'инструмент доступен только актуальному незаблокированному admin и не принимает токены, команды или аргументы.',
        inputSchema: {}
      }, async () => {
        if (!entry || !opts.db) return noContext
        const user = await opts.db.identity.getUser(entry.userId)
        if (!user || user.blocked || user.role !== 'admin') {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: { code: 'forbidden', message: 'Для запуска production-деплоя нужна актуальная роль admin.' } }) }],
            isError: true
          }
        }
        if (!opts.deployTrigger) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: { code: 'deploy_unavailable', message: 'Host-side deploy API не настроен.' } }) }],
            isError: true
          }
        }
        try {
          const result = await opts.deployTrigger.trigger()
          return { content: [{ type: 'text', text: JSON.stringify(result) }] }
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err)
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: { code: 'deploy_unavailable', message: 'Host-side deploy API недоступен.', detail } }) }],
            isError: true
          }
        }
      })

      server.registerTool('projects', {
        description: 'Проекты, где владелец текущего хода участник: участники, машины, доска и безопасные настройки CI.',
        inputSchema: {}
      }, async () => {
        if (!entry || !opts.db) return noContext
        const projects = (await Promise.all((await opts.db.projects.listProjects(entry.userId)).map(async (summary) => {
          const project = await opts.db!.projects.getProject(entry.userId, summary.id)
          if (!project) return null
          const { ciExecAuthRef: _secret, ...safe } = project
          return safe
        }))).filter(Boolean)
        return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] }
      })

      }

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      reply.hijack()
      try {
        await server.connect(transport)
        // Без третьего аргумента: тело не разобрано, транспорт читает поток сам.
        await transport.handleRequest(req.raw, reply.raw)
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
  })
}
