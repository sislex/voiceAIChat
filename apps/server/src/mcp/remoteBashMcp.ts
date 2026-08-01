// MCP-эндпоинт для спавнутого claude: команды и файловые инструменты remote
// на выбранной машине-агенте. Stateless: на каждый POST — свежие сервер и
// транспорт (без SSE и session-id). Доступ только по секрету процесса `k` —
// эндпоинт выполняет команды и не должен быть открыт даже на LAN.

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { AgentRegistry } from '../agents/registry.js'
import { evaluatePlanModeCommand } from './planMode.js'

export const REMOTE_BASH_MCP_PATH = '/mcp/remote-bash'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 300_000
const DEFAULT_READ_LIMIT = 400
const MAX_READ_LIMIT = 2_000
const MAX_READ_RESPONSE_CHARS = 100_000
const DEFAULT_GREP_MATCHES = 100
const MAX_GREP_MATCHES = 1_000
const MAX_GREP_LINE_CHARS = 2_000

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

export function readWindow(text: string, offset: number, limit: number): string {
  const lines = text === '' ? [] : text.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const total = lines.length
  const startIndex = Math.min(offset - 1, total)
  const wantedEnd = Math.min(startIndex + limit, total)
  const shown: string[] = []
  let chars = 0
  for (let i = startIndex; i < wantedEnd; i++) {
    let line = `${i + 1}\t${lines[i]}`
    const room = MAX_READ_RESPONSE_CHARS - chars - 100
    if (room <= 0) break
    if (line.length > room) line = `${line.slice(0, Math.max(0, room - 1))}…`
    shown.push(line)
    chars += line.length + 1
    if (chars >= MAX_READ_RESPONSE_CHARS) break
  }
  const first = shown.length ? startIndex + 1 : 0
  const last = shown.length ? startIndex + shown.length : 0
  const tail = `Показаны строки ${first}–${last} из ${total}.`
  return shown.length ? `${shown.join('\n')}\n\n${tail}` : tail
}

function toolError(err: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
    isError: true
  }
}

export function registerRemoteBashMcp(
  app: FastifyInstance,
  registry: AgentRegistry,
  secret: string
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

        const server = new McpServer({ name: 'remote', version: '1.0.0' })
        server.registerTool(
          'bash',
          {
            description:
              'Выполняет shell-команду на машине пользователя (не на сервере). ' +
              'Для команд (git, npm, тесты), не для чтения и правки файлов. Возвращает stdout+stderr и код выхода.',
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
              const timeoutMs = Math.min(timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
              const cwd = req.query.cwd
              const shellCommand = cwd
                ? `cd -- '${quoteCwd(cwd, registry.platformOf(agentId))}' && ${command}`
                : command
              const res = await registry.exec(agentId, shellCommand, timeoutMs, abort.signal)
              const tail = `[exit code: ${res.exitCode ?? '?'}${res.timedOut ? ', таймаут' : ''}]`
              return {
                content: [{ type: 'text', text: `${res.output}\n${tail}`.trim() }],
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
            description: 'Читает окно строк текстового файла внутри рабочей директории рана.',
            inputSchema: {
              path: z.string().describe('Путь относительно cwd рана'),
              offset: z.number().int().min(1).optional().describe('Первая строка (с 1)'),
              limit: z.number().int().min(1).max(MAX_READ_LIMIT).optional()
                .describe(`Число строк (по умолчанию ${DEFAULT_READ_LIMIT})`)
            }
          },
          async ({ path, offset, limit }) => {
            try {
              const result = await registry.fsRead(agentId, remotePath(req.query.cwd, path))
              return {
                content: [{
                  type: 'text' as const,
                  text: readWindow(fileText(result.dataBase64), offset ?? 1, limit ?? DEFAULT_READ_LIMIT)
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
            description: 'Ищет текст системным grep внутри рабочей директории рана.',
            inputSchema: {
              pattern: z.string().min(1).describe('Шаблон grep'),
              path: z.string().optional().describe('Файл или каталог относительно cwd (по умолчанию cwd)'),
              glob: z.string().optional().describe('Необязательная маска файлов для --include'),
              maxMatches: z.number().int().min(1).max(MAX_GREP_MATCHES).optional()
                .describe(`Максимум совпадений (по умолчанию ${DEFAULT_GREP_MATCHES})`)
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
              const cap = maxMatches ?? DEFAULT_GREP_MATCHES
              const all = res.output ? res.output.split('\n').filter(Boolean) : []
              const matches = all.slice(0, cap).map((line) =>
                line.length > MAX_GREP_LINE_CHARS ? `${line.slice(0, MAX_GREP_LINE_CHARS - 1)}…` : line
              )
              const suffix = all.length > matches.length
                ? `\n\nПоказаны первые ${matches.length} из ${all.length} совпадений.`
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
