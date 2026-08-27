// MCP-эндпоинт Make: инструменты ассистента читают и пишут файлы проекта разговора
// (`mcp__make__*`). Stateless по образцу consoleMcp: свежий сервер на POST, доступ
// по секрету процесса `k`, разговор — query `conv`, ход — query `turn`. Перед первой
// правкой в ходе снимается снимок «до правок ассистента» — так у пользователя есть
// история, к которой можно откатиться (аналог версий Figma Make). После каждой
// мутации владелец получает `make.changed`, и превью справа перезагружается.

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { MAKE_LIMITS } from '@voicechat/shared'
import { MakeError, type MakeWorkspaces } from '../make/workspace.js'
import type { MakeHub } from '../make/hub.js'

export const MAKE_MCP_PATH = '/mcp/make'

export interface MakeMcpDeps {
  workspaces: MakeWorkspaces
  hub: MakeHub
  /** Владелец разговора (для адресации make.changed); null — разговора нет. */
  ownerOf(conversationId: string): string | null
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }
const text = (t: string, isError = false): ToolResult =>
  isError ? { content: [{ type: 'text', text: t }], isError: true } : { content: [{ type: 'text', text: t }] }

const describeError = (error: unknown): string =>
  error instanceof MakeError ? error.message : error instanceof Error ? error.message : String(error)

export function registerMakeMcp(app: FastifyInstance, deps: MakeMcpDeps, secret: string): void {
  // Ход → снимок уже сделан: один снимок на ход, а не на каждую запись файла.
  const snapshotDone = new Set<string>()

  app.register(async (scope) => {
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined))
    scope.post<{ Querystring: { conv?: string; k?: string; turn?: string; ro?: string; note?: string } }>(
      MAKE_MCP_PATH,
      async (req, reply) => {
        if (req.query.k !== secret) return reply.code(403).send({ error: 'forbidden' })
        const conv = req.query.conv ?? ''
        const turn = req.query.turn ?? ''
        const readOnly = req.query.ro === '1'
        const note = (req.query.note ?? '').trim().slice(0, 80)
        const owner = deps.ownerOf(conv)
        if (!owner) return reply.code(404).send({ error: 'conversation not found' })
        const { workspaces, hub } = deps

        const planBlocked = (): ToolResult =>
          text('Отклонено: режим «План» — файлы проекта менять нельзя. Исследуй проект чтением (make_list_files/make_read_file); правки начнутся после одобрения плана.', true)

        /** Снимок «до правок ассистента» один раз за ход; затем — рассылка изменения. */
        const beforeMutation = async (): Promise<void> => {
          const key = `${conv}:${turn}`
          if (turn && !snapshotDone.has(key)) {
            snapshotDone.add(key)
            if (snapshotDone.size > 5_000) snapshotDone.clear()
            const snapped = await workspaces.snapshot(conv, note ? `До правок: «${note}»` : 'До правок ассистента')
            if (snapped.snapshots[0]) hub.rememberTurnSnapshot(turn, snapped.snapshots[0].id)
          }
        }
        const afterMutation = (paths: string[]): void => {
          hub.changed(owner, conv, workspaces.rev(conv), paths)
        }

        const server = new McpServer({ name: 'make', version: '1.0.0' })

        server.registerTool('make_list_files', {
          description: 'Список файлов проекта Make (путь и размер). Проект — статический сайт: index.html — точка входа, рядом css/js/картинки. Начни с этого инструмента, чтобы понять, что уже есть.',
          inputSchema: {}
        }, async () => {
          try {
            await workspaces.ensure(conv)
            const files = await workspaces.list(conv)
            if (files.length === 0) return text('(проект пуст)')
            return text(files.map((f) => `${f.path} (${f.size} байт)`).join('\n'))
          } catch (error) { return text(describeError(error), true) }
        })

        server.registerTool('make_read_file', {
          description: 'Прочитать текстовый файл проекта целиком (html/css/js/json/svg/md…).',
          inputSchema: { path: z.string().describe('Путь относительно корня проекта, например index.html или css/app.css') }
        }, async (args) => {
          try {
            const file = await workspaces.read(conv, args.path)
            return text(file.content)
          } catch (error) { return text(describeError(error), true) }
        })

        server.registerTool('make_write_file', {
          description: `Создать или полностью перезаписать файл проекта. Передавай ПОЛНОЕ содержимое файла (не diff). Лимит ${Math.round(MAKE_LIMITS.maxFileBytes / 1024)} КБ на файл. Превью пользователя обновится автоматически.`,
          inputSchema: {
            path: z.string().describe('Путь относительно корня проекта'),
            content: z.string().describe('Полное содержимое файла')
          }
        }, async (args) => {
          if (readOnly) return planBlocked()
          try {
            await workspaces.ensure(conv)
            await beforeMutation()
            const state = await workspaces.write(conv, args.path, args.content)
            afterMutation([args.path])
            // Авто-проверка (roadmap-2 п.1): замечания по записанному файлу сразу в ответе инструмента —
            // модели не нужно помнить про make_check, а ошибка компиляции видна до следующего шага.
            const issues = (await workspaces.check(conv).catch(() => [])).filter((i) => i.path === args.path)
            const tail = issues.length ? `\nЗамечания по файлу (исправь перед завершением):\n${issues.map((i) => `- ${i.message}`).join('\n')}` : ''
            return text(`Записано: ${args.path} (${Buffer.byteLength(args.content, 'utf8')} байт). Файлов в проекте: ${state.files.length}.${tail}`)
          } catch (error) { return text(describeError(error), true) }
        })

        server.registerTool('make_apply_changes', {
          description: 'Записать НЕСКОЛЬКО файлов одной транзакцией (и при необходимости удалить). Если хоть один записанный файл не компилируется, все изменения откатываются и возвращаются ошибки. Используй для связанных правок (компонент + сториз + стили) вместо серии make_write_file.',
          inputSchema: {
            files: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(30).describe('Полное содержимое каждого файла'),
            delete: z.array(z.string()).max(30).optional().describe('Пути файлов, которые удалить')
          }
        }, async (args) => {
          if (readOnly) return planBlocked()
          try {
            await workspaces.ensure(conv)
            await beforeMutation()
            const result = await workspaces.applyChanges(conv, args.files, args.delete ?? [])
            afterMutation([...args.files.map((f) => f.path), ...(args.delete ?? [])])
            if (result.rolledBack) return text(`Изменения откачены: ошибка компиляции.\n${result.issues.map((i) => `- ${i.path}: ${i.message}`).join('\n')}`, true)
            const warn = result.issues.length ? `\nЗамечания:\n${result.issues.map((i) => `- ${i.path}: ${i.message}`).join('\n')}` : ''
            return text(`Записано файлов: ${args.files.length}${args.delete?.length ? `, удалено: ${args.delete.length}` : ''}. Файлов в проекте: ${result.state.files.length}.${warn}`)
          } catch (error) { return text(describeError(error), true) }
        })

        server.registerTool('make_edit_file', {
          description: 'Точечная правка: заменить фрагмент текста в файле, не переписывая его целиком. Фрагмент должен встречаться ровно один раз (или передай all=true). Экономит токены на больших файлах.',
          inputSchema: {
            path: z.string(),
            find: z.string().describe('Точный текст, который заменить (с переносами и отступами как в файле)'),
            replace: z.string().describe('Новый текст'),
            all: z.boolean().optional().describe('Заменить все вхождения')
          }
        }, async (args) => {
          if (readOnly) return planBlocked()
          try {
            await workspaces.ensure(conv)
            await beforeMutation()
            const { replaced } = await workspaces.editFile(conv, args.path, args.find, args.replace, args.all ?? false)
            afterMutation([args.path])
            const issues = (await workspaces.check(conv).catch(() => [])).filter((i) => i.path === args.path)
            const tail = issues.length ? `\nЗамечания по файлу:\n${issues.map((i) => `- ${i.message}`).join('\n')}` : ''
            return text(`Заменено вхождений: ${replaced} в ${args.path}.${tail}`)
          } catch (error) { return text(describeError(error), true) }
        })

        server.registerTool('make_remember', {
          description: 'Записать в заметки проекта решение, которого нужно придерживаться дальше (палитра, структура, договорённости с пользователем). Заметки попадают в контекст каждого следующего хода.',
          inputSchema: { note: z.string().min(3).max(500).describe('Одна короткая формулировка') }
        }, async (args) => {
          if (readOnly) return planBlocked()
          try { const n = await workspaces.appendNote(conv, args.note); return text(`Записано. Заметок: ${n.notes.split('\n').filter(Boolean).length}.`) } catch (error) { return text(describeError(error), true) }
        })

        server.registerTool('make_delete_file', {
          description: 'Удалить файл проекта.',
          inputSchema: { path: z.string().describe('Путь относительно корня проекта') }
        }, async (args) => {
          if (readOnly) return planBlocked()
          try {
            await beforeMutation()
            const state = await workspaces.delete(conv, args.path)
            afterMutation([args.path])
            return text(`Удалено: ${args.path}. Файлов в проекте: ${state.files.length}.`)
          } catch (error) { return text(describeError(error), true) }
        })

        server.registerTool('make_rename_file', {
          description: 'Переименовать или переместить файл проекта. Ссылки на него в других файлах обнови сам (make_write_file).',
          inputSchema: { from: z.string().describe('Текущий путь'), to: z.string().describe('Новый путь') }
        }, async (args) => {
          if (readOnly) return planBlocked()
          try {
            await beforeMutation()
            await workspaces.rename(conv, args.from, args.to)
            afterMutation([args.from, args.to])
            return text(`Переименовано: ${args.from} → ${args.to}.`)
          } catch (error) { return text(describeError(error), true) }
        })

        server.registerTool('make_check', {
          description: 'Статическая проверка проекта: нет ли index.html, битых ссылок href/src/url() на отсутствующие файлы, пустых файлов и http-скриптов. Вызывай после правок вместо попыток открыть страницу.',
          inputSchema: {}
        }, async () => {
          try {
            const issues = await workspaces.check(conv)
            if (issues.length === 0) return text('Проверка пройдена: index.html есть, все ссылки на файлы проекта разрешаются.')
            return text(issues.map((i) => `${i.path}: ${i.message}`).join('\n'), true)
          } catch (error) { return text(describeError(error), true) }
        })

        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        reply.raw.on('close', () => { void transport.close(); void server.close() })
        await server.connect(transport)
        await transport.handleRequest(req.raw, reply.raw, req.body)
      }
    )
  })
}
