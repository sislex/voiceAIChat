// MCP-эндпоинт для спавнутого claude: команды и файловые инструменты remote
// на выбранной машине-агенте. Stateless: на каждый POST — свежие сервер и
// транспорт (без SSE и session-id). Доступ только по секрету процесса `k` —
// эндпоинт выполняет команды и не должен быть открыт даже на LAN.

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { DEFAULT_TOOL_OUTPUT_LIMITS, TOOL_OUTPUT_TRIM_MARK, trimToolOutput } from '@voicechat/shared'
import type { ToolOutputLimits } from '@voicechat/shared'
import type { AgentRegistry } from '../agents/registry.js'
import { evaluatePlanModeCommand } from './planMode.js'
import { bashFileReadRejection, evaluateBashFileRead } from './bashFileRead.js'

export const REMOTE_BASH_MCP_PATH = '/mcp/remote-bash'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 300_000
const DEFAULT_READ_LIMIT = 400
const MAX_GREP_LINE_CHARS = 2_000

/**
 * Чем модели дочитать пропущенное. Метка обрезки обязана давать способ добрать
 * данные точечно: иначе модель повторит ту же команду и заплатит второй раз.
 */
const BASH_TRIM_HINT =
  'сузь вывод фильтром (grep/tail/--reporter=dot) или читай файлы инструментом read'

/**
 * Экранирует `cwd` для одинарных кавычек bash и, на win32-машине, нормализует
 * слэши: путь вида `C:\Users\x` бэкслешами ломается внутри одинарных кавычек
 * git-bash (MSYS-транслятор путей ждёт `/`), поэтому меняем их на прямые —
 * `C:/Users/x` bash с Windows понимает как обычный Windows-путь.
 */
export function quoteCwd(cwd: string, platform?: string): string {
  const normalized = platform === 'win32' ? cwd.replace(/\\/g, '/') : cwd
  return normalized.replace(/'/g, `'"'"'`)
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function remotePath(cwd: string | undefined, relativePath: string): string {
  if (!cwd) throw new Error('Рабочая директория cwd не задана')
  if (!relativePath || relativePath.includes('\0')) throw new Error('Путь не задан')
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(relativePath)) {
    throw new Error('Путь должен быть относительным к рабочей директории')
  }
  const parts = relativePath.split(/[\\/]+/)
  if (parts.includes('..')) throw new Error('Путь за пределами рабочей директории запрещён')
  const clean = parts.filter((part) => part && part !== '.').join('/')
  const base = cwd.replace(/[\\/]+$/, '')
  return clean ? `${base}/${clean}` : base
}

function fileText(dataBase64: string | undefined): string {
  if (dataBase64 === undefined) throw new Error('Агент не вернул содержимое файла')
  return Buffer.from(dataBase64, 'base64').toString('utf8')
}

/**
 * Окно строк файла с номерами и итогом «показаны строки A–B из N». Объём окна
 * капнут: по строкам (`limit`) и по символам (`maxChars`) — файл в одну строку на
 * 300 КБ иначе уезжал в контекст целиком и оплачивался на каждом следующем
 * запросе хода. Урезание по объёму помечается явно: молча урезанное окно модель
 * читает как полное.
 */
export function readWindow(text: string, offset: number, limit: number, maxChars = DEFAULT_TOOL_OUTPUT_LIMITS.readChars): string {
  const lines = text === '' ? [] : text.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const total = lines.length
  const startIndex = Math.min(offset - 1, total)
  const wantedEnd = Math.min(startIndex + limit, total)
  const shown: string[] = []
  let chars = 0
  let cutByChars = false
  for (let i = startIndex; i < wantedEnd; i++) {
    let line = `${i + 1}\t${lines[i]}`
    const room = maxChars - chars - 100
    if (room <= 0) {
      cutByChars = true
      break
    }
    if (line.length > room) {
      line = `${line.slice(0, Math.max(0, room - 1))}…`
      cutByChars = true
    }
    shown.push(line)
    chars += line.length + 1
    if (chars >= maxChars) {
      cutByChars = i + 1 < wantedEnd
      break
    }
  }
  const first = shown.length ? startIndex + 1 : 0
  const last = shown.length ? startIndex + shown.length : 0
  const cut = cutByChars
    ? ` ${TOOL_OUTPUT_TRIM_MARK}: окно урезано по объёму (лимит ${maxChars} символов), ` +
      `данные неполные — читай дальше со смещением ${last + 1}.⟧`
    : ''
  const tail = `Показаны строки ${first}–${last} из ${total}.${cut}`
  return shown.length ? `${shown.join('\n')}\n\n${tail}` : tail
}

function toolError(err: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    isError: true
  }
}

/**
 * `limits` — лимиты ответов инструментов (настройки CI, приведённые
 * `ciToolOutputLimits`). Читаются на КАЖДЫЙ запрос: эндпоинт stateless, а
 * настройку меняют без перезапуска сервера. Не передан — дефолты (тесты и
 * сборки без БД).
 */
export function registerRemoteBashMcp(
  app: FastifyInstance,
  registry: AgentRegistry,
  secret: string,
  limits?: () => ToolOutputLimits
): void {
  // Тело читает сам транспорт, поэтому маршрут живёт в своей области видимости
  // с парсером-пустышкой: Fastify отдаёт управление, не трогая поток.
  // Если тело вычитает Fastify, hono/node-server внутри MCP-SDK (он вешает
  // слушатель 'end' уже после этого) решит, что клиент недослал запрос, и через
  // 500 мс «дренирует» соединение — рвёт сокет после каждого вызова, а на
  // ненастоящем сокете (`app.inject` в тестах) падает с `socket.destroySoon is
  // not a function` в таймере, то есть необработанным исключением процесса.
  app.register(async (scope) => {
    // Снимаем унаследованные парсеры (в т.ч. общий JSON из server.ts) — иначе
    // Fastify ругается «content type parser already present» на своей копии.
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', (_req, _payload, done) => {
      done(null, undefined)
    })
    scope.post<{ Querystring: { agent?: string; k?: string; cwd?: string; ro?: string } }>(
      REMOTE_BASH_MCP_PATH,
      async (req, reply) => {
        if (req.query.k !== secret) return reply.code(403).send({ error: 'forbidden' })
        const agentId = req.query.agent ?? ''
        // ro=1 — фаза плана CI: инструмент нужен для исследования рабочей копии,
        // но менять её нельзя (см. planMode.ts).
        const readOnly = req.query.ro === '1'

        // Отмена команды именно этого запроса при обрыве (claude убит на barge-in),
        // не затрагивая параллельные команды на той же машине. Слушаем close ОТВЕТА,
        // а не запроса: у req.raw 'close' срабатывает сразу после чтения тела (до
        // ответа) и отменял бы команду преждевременно. У ответа 'close' с
        // незавершённой записью = клиент реально отвалился.
        const abort = new AbortController()
        reply.raw.on('close', () => {
          if (!reply.raw.writableEnded) abort.abort()
        })

        // Лимиты снимаем на запрос: их правят настройкой, а не пересборкой.
        // Сломанный источник настроек — не повод ронять ход: тогда дефолты.
        let toolLimits = DEFAULT_TOOL_OUTPUT_LIMITS
        try {
          toolLimits = limits?.() ?? DEFAULT_TOOL_OUTPUT_LIMITS
        } catch {
          /* настройки недоступны — работаем на дефолтах */
        }

        const server = new McpServer({ name: 'remote', version: '1.0.0' })
        server.registerTool(
          'bash',
          {
            description:
              `Shell-команда на машине пользователя; stdout, stderr и код выхода. Для файлов используй read/edit: ` +
              `cat/sed/head/tail и heredoc отклоняются. Вывод ограничен ${toolLimits.bashChars} символами; сужай его фильтром.`,
            inputSchema: {
              command: z.string().describe('Команда для /bin/bash'),
              timeout_ms: z
                .number()
                .optional()
                .describe('Таймаут в мс (по умолчанию 120000, максимум 300000)')
            }
          },
          async ({ command, timeout_ms }) => {
            try {
              if (readOnly) {
                const verdict = evaluatePlanModeCommand(command)
                if (!verdict.allowed) {
                  return {
                    content: [
                      {
                        type: 'text' as const,
                        text:
                          `Отклонено: режим «План» — ${verdict.reason}. Исследуй только чтением ` +
                          `(ls, git log/diff/status); файлы читай read, ищи grep; правки начнутся после одобрения плана.`
                      }
                    ],
                    isError: true
                  }
                }
              }
              const cwd = req.query.cwd
              // Чтение файла — работа инструмента read: он отдаёт окно строк, а
              // не файл целиком. Отказ идёт до exec и несёт готовую замену,
              // чтобы модель не гадала, чем заменить команду.
              const fileRead = evaluateBashFileRead(command, cwd)
              if (fileRead) {
                return {
                  content: [{ type: 'text' as const, text: bashFileReadRejection(fileRead) }],
                  isError: true
                }
              }
              const timeoutMs = Math.min(timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
              const shellCommand = cwd
                ? `cd -- '${quoteCwd(cwd, registry.platformOf(agentId))}' && ${command}`
                : command
              const res = await registry.exec(agentId, shellCommand, timeoutMs, abort.signal)
              const tail = `[exit code: ${res.exitCode ?? '?'}${res.timedOut ? ', таймаут' : ''}]`
              // Вывод сжимаем ДО приписки с кодом выхода: код и хвост лога —
              // самое ценное для fix-loop, и терять их из-за обрезки нельзя.
              const trimmed = trimToolOutput(res.output, toolLimits.bashChars, BASH_TRIM_HINT)
              return {
                content: [{ type: 'text', text: `${trimmed.text}\n${tail}`.trim() }],
                isError: res.exitCode !== 0
              }
            } catch (err) {
              return {
                content: [
                  { type: 'text', text: err instanceof Error ? err.message : String(err) }
                ],
                isError: true
              }
            }
          }
        )

        server.registerTool(
          'read',
          {
            description:
              `Окно строк файла в рабочей директории (не весь файл): до ${toolLimits.readLines} строк и ${toolLimits.readChars} символов.`,
            inputSchema: {
              path: z.string().describe('Путь относительно cwd рана'),
              offset: z.number().int().min(1).optional().describe('Первая строка (с 1)'),
              // Кап окна — настройка: `.max()` считается на запрос, поэтому
              // заниженный лимит модель видит сразу в схеме инструмента.
              limit: z.number().int().min(1).max(toolLimits.readLines).optional()
                .describe(`Число строк (по умолчанию ${Math.min(DEFAULT_READ_LIMIT, toolLimits.readLines)}, максимум ${toolLimits.readLines})`)
            }
          },
          async ({ path, offset, limit }) => {
            try {
              const result = await registry.fsRead(agentId, remotePath(req.query.cwd, path))
              const window = Math.min(limit ?? DEFAULT_READ_LIMIT, toolLimits.readLines)
              return {
                content: [{
                  type: 'text' as const,
                  text: readWindow(fileText(result.dataBase64), offset ?? 1, window, toolLimits.readChars)
                }]
              }
            } catch (err) {
              return toolError(err)
            }
          }
        )

        server.registerTool(
          'grep',
          {
            description:
              `Поиск grep в рабочей директории; до (${toolLimits.grepMatches}) совпадений и ${toolLimits.grepChars} символов. При обрезке сузь шаблон или путь.`,
            inputSchema: {
              pattern: z.string().min(1).describe('Шаблон grep'),
              path: z.string().optional().describe('Файл или каталог относительно cwd (по умолчанию cwd)'),
              glob: z.string().optional().describe('Необязательная маска файлов для --include'),
              maxMatches: z.number().int().min(1).max(toolLimits.grepMatches).optional()
                .describe(`Максимум совпадений (по умолчанию и максимум ${toolLimits.grepMatches})`)
            }
          },
          async ({ pattern, path, glob, maxMatches }) => {
            try {
              const target = remotePath(req.query.cwd, path ?? '.')
              const include = glob ? ` --include=${quoteShell(glob)}` : ''
              const command = `grep -rn --binary-files=without-match${include} -- ${quoteShell(pattern)} ${quoteShell(target)}`
              const res = await registry.exec(agentId, command, DEFAULT_TIMEOUT_MS, abort.signal)
              if (res.exitCode !== 0 && res.exitCode !== 1) {
                throw new Error(res.output.trim() || `grep завершился с кодом ${res.exitCode ?? '?'}`)
              }
              const cap = Math.min(maxMatches ?? toolLimits.grepMatches, toolLimits.grepMatches)
              const all = res.output ? res.output.split('\n').filter(Boolean) : []
              // Двойной кап: по числу совпадений и по объёму ответа. Список
              // режется по границе совпадения, а не посередине строки — иначе
              // модель читает обрубленный путь как настоящий. Сотня совпадений по
              // 2 КБ — это 200 КБ контекста, перечитываемых до конца хода.
              const matches: string[] = []
              let chars = 0
              let cutByChars = false
              for (const raw of all.slice(0, cap)) {
                const line = raw.length > MAX_GREP_LINE_CHARS ? `${raw.slice(0, MAX_GREP_LINE_CHARS - 1)}…` : raw
                if (chars + line.length + 1 > toolLimits.grepChars && matches.length) {
                  cutByChars = true
                  break
                }
                matches.push(line)
                chars += line.length + 1
              }
              const suffix = all.length > matches.length
                ? `\n\nПоказаны первые ${matches.length} из ${all.length} совпадений` +
                  `${cutByChars ? ` ${TOOL_OUTPUT_TRIM_MARK}: ответ упёрся в лимит объёма (${toolLimits.grepChars} символов), данные неполные — сузь шаблон или путь.⟧` : '. Данные неполные — сузь шаблон, если нужного нет.'}`
                : `\n\nНайдено совпадений: ${matches.length}.`
              return { content: [{ type: 'text' as const, text: `${matches.join('\n')}${suffix}`.trim() }] }
            } catch (err) {
              return toolError(err)
            }
          }
        )

        server.registerTool(
          'edit',
          {
            description: 'Точно заменяет строку в текстовом файле внутри рабочей директории рана.',
            inputSchema: {
              path: z.string().describe('Путь относительно cwd рана'),
              oldString: z.string().min(1).describe('Точный старый текст'),
              newString: z.string().describe('Новый текст'),
              replaceAll: z.boolean().optional().describe('Заменить все совпадения (по умолчанию false)')
            }
          },
          async ({ path, oldString, newString, replaceAll }) => {
            try {
              if (readOnly) throw new Error('Отклонено: режим «План» — правки файлов запрещены')
              const absolutePath = remotePath(req.query.cwd, path)
              const current = fileText((await registry.fsRead(agentId, absolutePath)).dataBase64)
              const count = current.split(oldString).length - 1
              if (count === 0) throw new Error('Текст oldString не найден')
              if (count > 1 && !replaceAll) {
                throw new Error(`Найдено ${count} вхождений oldString; уточните фрагмент или включите replaceAll`)
              }
              const updated = replaceAll
                ? current.split(oldString).join(newString)
                : current.replace(oldString, newString)
              await registry.fsWrite(agentId, absolutePath, Buffer.from(updated, 'utf8').toString('base64'))
              return { content: [{ type: 'text' as const, text: `Файл ${path} обновлён (${replaceAll ? count : 1} замен).` }] }
            } catch (err) {
              return toolError(err)
            }
          }
        )

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless: без session-id
          enableJsonResponse: true // обычный JSON-ответ вместо SSE
        })
        reply.hijack() // транспорт пишет в сырой res сам
        try {
          await server.connect(transport)
          // Без третьего аргумента: тело не разобрано, транспорт читает поток сам.
          await transport.handleRequest(req.raw, reply.raw)
        } catch (err) {
          // Иначе hijacked-ответ не завершится и MCP-клиент claude повиснет.
          if (!reply.raw.writableEnded) {
            try {
              reply.raw.writeHead(500, { 'content-type': 'application/json' })
              reply.raw.end(
                JSON.stringify({ error: err instanceof Error ? err.message : 'mcp transport error' })
              )
            } catch {
              /* соединение уже закрыто */
            }
          }
        }
      }
    )
  })
}
