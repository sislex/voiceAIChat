// MCP-эндпоинт для спавнутого claude: команды и файловые инструменты remote
// на выбранной машине-агенте; ход с проектом (query `project`) дополнительно
// видит машины проекта (инструмент `machines`) и может адресовать операцию
// любой из них параметром `machine`. Stateless: на каждый POST — свежие сервер
// и транспорт (без SSE и session-id). Доступ только по секрету процесса `k` —
// эндпоинт выполняет команды и не должен быть открыт даже на LAN.

import { z } from 'zod'
import { checkedBytes, confinedPath, makeFilePath, type MakeFileTransfer } from './makeFiles.js'
import type { HistoricalEvidence } from './historicalEvidence.js'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { DEFAULT_TOOL_OUTPUT_LIMITS, TOOL_OUTPUT_TRIM_MARK, imageMime, imageName, trimToolOutput } from '@voicechat/shared'
import type { ToolOutputLimits } from '@voicechat/shared'
import { AgentFsError } from '../agents/registry.js'
import type { MachinesService } from '../machines/service.js'
import { evaluatePlanModeCommand } from './planMode.js'
import { bashFileReadRejection, evaluateBashFileRead } from './bashFileRead.js'
import { processCommand, processTaskRoot } from './runProcesses.js'

export const REMOTE_BASH_MCP_PATH = '/mcp/remote-bash'

import { commandGateMessage, type CommandGate } from '../agents/commandGate.js'
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

/**
 * Приводит абсолютный путь к пути от `cwd`. Windows-путь сравниваем без учёта
 * регистра (там регистр не различает файлы), POSIX — как есть.
 */
function pathInsideCwd(base: string, absolute: string): string | undefined {
  const slashed = (p: string): string => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const windows = /^[A-Za-z]:/.test(base) || /^[A-Za-z]:/.test(absolute)
  const fold = (p: string): string => (windows ? p.toLowerCase() : p)
  const b = slashed(base)
  const a = slashed(absolute)
  if (fold(a) === fold(b)) return ''
  if (fold(a).startsWith(`${fold(b)}/`)) return a.slice(b.length + 1)
  return undefined
}

/**
 * Абсолютный путь на машине по пути, который назвала модель. Относительный
 * Relative paths use cwd; absolute paths must be inside cwd or a URL root.
 *
 * Абсолютные пути разрешены намеренно: модель видит их в промпте и в выводе
 * собственных bash-команд, а прежний глухой отказ «путь должен быть
 * относительным» она читала как «инструменты привязаны к чужому workspace» —
 * и уходила править файлы через shell. Так ран d2ba80bc (CHAT-108) закрылся
 * успехом, не создав ни одной правки. Rejections list cwd and all allowed roots.
 */
export function remotePath(cwd: string | undefined, inputPath: string, roots: readonly string[] = []): string {
  if (!cwd) throw new Error('Рабочая директория cwd не задана')
  validateRoots(roots)
  if (!inputPath || inputPath.includes('\0')) throw new Error('Путь не задан')
  const allowed = [cwd, ...roots]
  const rejection = () => new Error(
    `Путь за пределами рабочей директории запрещён: разрешённые корни — ${allowed.join(', ')}; ` +
      'передавай относительный путь от cwd или абсолютный внутри разрешённых корней'
  )
  if (inputPath.split(/[\\/]+/).includes('..')) throw rejection()
  let base = cwd
  let relativePath = inputPath
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(inputPath)) {
    const matched = allowed.find((root) => pathInsideCwd(root, inputPath) !== undefined)
    if (matched === undefined) throw rejection()
    base = matched
    relativePath = pathInsideCwd(base, inputPath)!
  }
  const clean = relativePath.split(/[\\/]+/).filter((part) => part && part !== '.').join('/')
  base = base.replace(/[\\/]+$/, '')
  return clean ? `${base}/${clean}` : base
}

/** URL roots are explicit directory grants, never relative paths or filesystem roots. */
function validateRoots(roots: readonly string[]): void {
  for (const root of roots) {
    const normalized = root.replace(/\\/g, '/')
    const parts = normalized.split('/').filter((part) => part && part !== '.')
    if (
      !/^(?:[A-Za-z]:\/|\/)/.test(normalized) ||
      root.includes('\0') || parts.includes('..') ||
      parts.length === 0 || (/^[A-Za-z]:/.test(normalized) && parts.length === 1)
    ) {
      throw new Error(`Недопустимый root: ${root}; нужен абсолютный каталог без .., не корень файловой системы`)
    }
  }
}

function fileText(dataBase64: string | undefined): string {
  if (dataBase64 === undefined) throw new Error('Агент не вернул содержимое файла')
  return Buffer.from(dataBase64, 'base64').toString('utf8')
}

/** MIME по сигнатуре, а не расширению: существующий TIFF с именем .jpg не картинка для MCP. */
function detectedImageMime(dataBase64: string): string | null {
  // Для сигнатуры достаточно первых 12 байт. Не декодируем второй полный Buffer:
  // сам base64 всё равно нужен MCP image-блоку, но лишняя копия крупного JPEG — нет.
  const data = Buffer.from(dataBase64.slice(0, 16), 'base64')
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.length >= 6 && (data.subarray(0, 6).toString('ascii') === 'GIF87a' || data.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif'
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

/** Только настоящий ENOENT разрешает пробовать следующий путь поиска изображения. */
function isFileNotFound(err: unknown): boolean {
  if (err instanceof AgentFsError && err.code) return err.code === 'ENOENT'
  // Совместимость с агентами до появления поля fs.error.code.
  return err instanceof Error && /(?:^|\W)ENOENT(?:\W|$)|no such file/i.test(err.message)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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

/** Машина проекта, доступная ходу помимо выбранной (из `project_machines`). */
export interface RemoteMcpMachine {
  agentId: string
  name: string
  /** Папка проекта на машине; пустая строка — папка не настроена. */
  path: string
}

/** Вложение текущего хода, доступное image по имени без раскрытия байтов в текст. */
export interface RemoteImageAttachment {
  path: string
  name: string
  uploadId?: string
  dataBase64: string
}

/** Короткоживущий контекст файлов хода; токен снимается при любом завершении. */
export class RemoteFileBroker {
  private readonly entries = new Map<string, RemoteImageAttachment[]>()
  register(token: string, attachments: RemoteImageAttachment[]): void { this.entries.set(token, attachments) }
  unregister(token: string): void { this.entries.delete(token) }
  get(token: string): RemoteImageAttachment[] | undefined { return this.entries.get(token) }
}

/**
 * `limits` — лимиты ответов инструментов (настройки CI, приведённые
 * `ciToolOutputLimits`). Читаются на КАЖДЫЙ запрос: эндпоинт stateless, а
 * настройку меняют без перезапуска сервера. Не передан — дефолты (тесты и
 * сборки без БД).
 */
/**
 * `projectMachines` — машины проекта по id из query-параметра `project`: с ним
 * ход получает инструмент `machines` и параметр `machine` у остальных
 * инструментов — операцию можно явно адресовать другой машине проекта.
 * Ограничение доступа проектом держится здесь: и сам `project`, и список машин
 * приходят не от модели, а от сервера (query собирает отправитель хода,
 * резолвер читает `project_machines`), модель выбирает только из этого списка.
 */
export function registerRemoteBashMcp(
  app: FastifyInstance,
  registry: MachinesService,
  secret: string,
  limits?: () => Promise<ToolOutputLimits>,
  projectMachines?: (projectId: string) => Promise<RemoteMcpMachine[]>,
  fileContexts?: (token: string) => RemoteImageAttachment[] | undefined,
  commandGate?: CommandGate,
  historicalEvidence?: HistoricalEvidence,
  makeFiles?: MakeFileTransfer
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
    scope.post<{ Querystring: { agent?: string; k?: string; cwd?: string; root?: string | string[]; ro?: string; project?: string; files?: string; conv?: string; evidence?: string; run?: string; stage?: string; make?: string; turn?: string } }>(
      REMOTE_BASH_MCP_PATH,
      async (req, reply) => {
        if (req.query.k !== secret) return reply.code(403).send({ error: 'forbidden' })
        const agentId = req.query.agent ?? ''
        const makeScoped = req.query.make === '1'
        const machineTools = !makeScoped || Boolean(agentId && req.query.cwd)
        const safePath = async (target: { agentId: string; cwd?: string }, path: string) => makeScoped
          ? confinedPath(registry, target.agentId, target.cwd, remotePath(target.cwd, path))
          : remotePath(target.cwd, path, rootsFor(target))
        const roots = req.query.root === undefined ? [] : [req.query.root].flat()
        try {
          validateRoots(roots)
        } catch (err) {
          return reply.code(400).send({ error: errorMessage(err) })
        }
        const rootsFor = (target: { agentId: string }): readonly string[] =>
          target.agentId === agentId ? roots : []
        // ro=1 — фаза плана CI: инструмент нужен для исследования рабочей копии,
        // но менять её нельзя (см. planMode.ts).
        const readOnly = req.query.ro === '1'
        // Машины проекта из query `project` (его дописывает сервер при отправке
        // хода, связанного с проектом). Сломанный резолвер не роняет ход: без
        // списка мост работает по-старому — только выбранная машина.
        let machines: RemoteMcpMachine[] = []
        if (!makeScoped && req.query.project && projectMachines) {
          try {
            machines = await projectMachines(req.query.project)
          } catch {
            machines = []
          }
        }
        /**
         * Куда идёт операция: без `machine` — выбранная машина хода и её cwd
         * (рабочая копия рана / каталог чата); с `machine` — названная машина
         * проекта и её папка проекта. Гейты readOnly/план проверяются ДО вызова
         * и от машины не зависят.
         */
        const resolveMachine = (machine?: string): { agentId: string; cwd?: string } => {
          const wanted = machine?.trim()
          if (!wanted) return { agentId, cwd: req.query.cwd }
          const found = machines.filter((m) => m.agentId === wanted || m.name === wanted)
          if (!found.length) {
            const known = machines.map((m) => `«${m.name}»`).join(', ')
            throw new Error(
              `Машина «${wanted}» не найдена среди машин проекта${known ? ` (доступны: ${known})` : ''}. ` +
                `Список — инструмент machines; без параметра machine операция идёт на выбранной машине.`
            )
          }
          if (found.length > 1) {
            throw new Error(
              `Имя «${wanted}» неоднозначно — укажи id машины: ${found.map((m) => `${m.agentId} («${m.name}»)`).join(', ')}`
            )
          }
          const m = found[0]
          if (m.agentId === agentId) return { agentId, cwd: req.query.cwd }
          if (!m.path) {
            throw new Error(
              `У машины «${m.name}» не настроена папка проекта — операции на ней недоступны. ` +
                `Задать папку можно в настройках проекта.`
            )
          }
          return { agentId: m.agentId, cwd: m.path }
        }
        // Параметр появляется в схемах только вместе со списком машин: ход вне
        // проекта видит прежние схемы и не гадает про недоступную возможность.
        // Тип — Record, а не объект с необязательным полем: `machine?: undefined`
        // ломает совместимость с ZodRawShape (index signature не терпит undefined).
        const machineParam: Record<string, z.ZodOptional<z.ZodString>> = {}
        if (machines.length) {
          machineParam.machine = z
            .string()
            .optional()
            .describe('Имя или id другой машины проекта (см. инструмент machines); без него — выбранная машина')
        }

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
          toolLimits = (await limits?.()) ?? DEFAULT_TOOL_OUTPUT_LIMITS
        } catch {
          /* настройки недоступны — работаем на дефолтах */
        }

        const server = new McpServer({ name: 'remote', version: '1.0.0' })
        server.registerTool(
          'historical_evidence_verify',
          {
            description: 'Сверяет SHA256 исходного исторического журнала, явно разрешённого текущему рану. Возвращает только хеш и размер, без содержимого и приватных путей. Требует подключённого источника и действующих полномочий рана.',
            inputSchema: { commandId: z.string().uuid().describe('ID команды из разрешённого набора доказательств рана') }
          },
          async ({ commandId }) => {
            const result = historicalEvidence
              ? await historicalEvidence.verify({
                token: req.query.evidence, projectId: req.query.project,
                agentId, cwd: req.query.cwd
              }, commandId)
              : { status: 'source_unavailable' as const }
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
              isError: result.status !== 'verified' || !result.matches
            }
          }
        )
        if (machineTools) server.registerTool(
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
                .describe('Таймаут в мс (по умолчанию 120000, максимум 300000)'),
              confirm: z
                .boolean()
                .optional()
                .describe('Только после явного согласия пользователя в чате: выполнить опасную команду (rm -rf, force-push, DROP …)'),
              ...machineParam
            }
          },
          async (args) => {
            const { command, timeout_ms } = args
            const confirm = (args as { confirm?: boolean }).confirm === true
            // Политика проекта/роли и подтверждение опасных команд (п.10) — до любого exec.
            if (commandGate) {
              const verdict = await commandGate({ command, projectId: req.query.project ?? null, source: 'chat', confirm })
              if (!verdict.allowed) return { content: [{ type: 'text' as const, text: commandGateMessage(verdict) }], isError: true }
            }
            // `machine` есть в схеме только у хода с проектом (условный спред не
            // виден типу шейпа) — достаём через сужение.
            const machine = (args as { machine?: string }).machine
            try {
              if (makeScoped) {
                // Arbitrary shell cannot be confined by cd. Only directory inspection is exposed.
                if (command.trim() === 'pwd') return { content: [{ type: 'text' as const, text: await safePath(resolveMachine(machine), '.') }] }
                const match = /^ls(?:\s+(-[la]+))?(?:\s+([a-zA-Z0-9_./-]+))?\s*$/.exec(command)
                if (!match) throw new Error('Make bash supports only pwd and ls [path]; use read/grep/edit and transfer tools')
                const target = resolveMachine(machine)
                const listing = await registry.fsList(target.agentId, await safePath(target, match[2] ?? '.'))
                return { content: [{ type: 'text' as const, text: trimToolOutput(JSON.stringify(listing), toolLimits.bashChars).text }] }
              }
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
              const target = resolveMachine(machine)
              const cwd = target.cwd
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
              // Kanban supplies ownership; policy/file-read checks above still inspect the original command.
              const processRoot = cwd && req.query.run && target.agentId === agentId ? processTaskRoot(cwd) : null
              const shellCommand = processRoot
                ? processCommand(command, cwd!, {}, timeoutMs, { root: processRoot, runId: req.query.run!, stage: req.query.stage ?? 'model', retain: true })
                : cwd ? `cd -- '${quoteCwd(cwd, registry.platformOf(target.agentId))}' && ${command}` : command
              const res = await registry.exec(target.agentId, shellCommand, timeoutMs + (processRoot ? 15_000 : 0), abort.signal, { source: 'chat', conversationId: req.query.conv ?? null })
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

        if (machineTools) server.registerTool(
          'read',
          {
            description:
              `Окно строк файла в рабочей директории (не весь файл): до ${toolLimits.readLines} строк и ${toolLimits.readChars} символов.`,
            inputSchema: {
              path: z.string().describe('Путь относительно cwd рана или абсолютный внутри него'),
              offset: z.number().int().min(1).optional().describe('Первая строка (с 1)'),
              // Кап окна — настройка: `.max()` считается на запрос, поэтому
              // заниженный лимит модель видит сразу в схеме инструмента.
              limit: z.number().int().min(1).max(toolLimits.readLines).optional()
                .describe(`Число строк (по умолчанию ${Math.min(DEFAULT_READ_LIMIT, toolLimits.readLines)}, максимум ${toolLimits.readLines})`),
              ...machineParam
            }
          },
          async (args) => {
            const { path, offset, limit } = args
            const machine = (args as { machine?: string }).machine
            try {
              const target = resolveMachine(machine)
              const result = await registry.fsRead(target.agentId, await safePath(target, path))
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
          'image',
          {
            description:
              'Читает JPEG/PNG/WebP/GIF как типизированное изображение для визуального просмотра и прямой передачи image-инструментам. ' +
              'Пути разрешаются в порядке: вложения текущего чата, cwd хода/чата, папка проекта, явно указанный абсолютный путь.',
            inputSchema: {
              path: z.string().min(1).describe('Имя вложения, относительный или абсолютный путь изображения'),
              ...machineParam
            }
          },
          async (args) => {
            const requested = args.path.trim()
            const machine = (args as { machine?: string }).machine
            try {
              const target = resolveMachine(machine)
              const attachments = req.query.files && fileContexts ? fileContexts(req.query.files) ?? [] : []
              const attachment = attachments.find((item) =>
                item.uploadId === requested || item.path === requested || item.name === requested || imageName(item.path) === requested
              )
              let dataBase64: string
              let resolvedPath: string
              if (attachment) {
                dataBase64 = makeScoped ? checkedBytes(attachment.dataBase64) : attachment.dataBase64
                resolvedPath = attachment.path
              } else {
                const absolute = /^(?:[A-Za-z]:[\\/]|[\\/])/.test(requested)
                const candidates: string[] = []
                if (!absolute && target.cwd) candidates.push(remotePath(target.cwd, requested))
                if (!absolute) {
                  const projectDir = machines.find((item) => item.agentId === target.agentId)?.path
                  if (projectDir && projectDir !== target.cwd) candidates.push(`${projectDir.replace(/[\\/]+$/, '')}/${requested}`)
                }
                if (absolute) candidates.push(requested)
                let found: Awaited<ReturnType<MachinesService['fsRead']>> | undefined
                let lastError: unknown
                for (const candidate of candidates) {
                  try {
                    found = await registry.fsRead(target.agentId, makeScoped ? await safePath(target, candidate) : candidate)
                    resolvedPath = candidate
                    break
                  } catch (err) {
                    if (!isFileNotFound(err)) {
                      throw new Error(`Не удалось прочитать файл «${candidate}» с машины: ${errorMessage(err)}`)
                    }
                    lastError = err
                  }
                }
                if (!found) {
                  throw new Error(`Файл «${requested}» не найден в доступных вложениях и директориях${lastError instanceof Error ? `: ${lastError.message}` : ''}`)
                }
                if (found.dataBase64 === undefined) {
                  throw new Error(`Агент вернул неполный ответ при чтении файла «${resolvedPath!}»: содержимое отсутствует`)
                }
                dataBase64 = makeScoped ? checkedBytes(found.dataBase64, found.truncated) : found.dataBase64
                resolvedPath = resolvedPath!
              }
              const mimeType = detectedImageMime(dataBase64)
              if (!mimeType) {
                throw new Error(`Файл «${resolvedPath!}» найден, но формат ${imageMime(resolvedPath!)} не поддерживается каналом изображений`)
              }
              return {
                content: [
                  { type: 'image' as const, data: dataBase64, mimeType },
                  { type: 'text' as const, text: `Изображение найдено: ${resolvedPath!}. Бинарные данные переданы отдельным типизированным блоком.` }
                ]
              }
            } catch (err) {
              return toolError(err)
            }
          }
        )

        if (machineTools) server.registerTool(
          'grep',
          {
            description:
              `Поиск grep в рабочей директории; до (${toolLimits.grepMatches}) совпадений и ${toolLimits.grepChars} символов. При обрезке сузь шаблон или путь.`,
            inputSchema: {
              pattern: z.string().min(1).describe('Шаблон grep'),
              path: z.string().optional().describe('Файл или каталог относительно cwd или абсолютный внутри него (по умолчанию cwd)'),
              glob: z.string().optional().describe('Необязательная маска файлов для --include'),
              maxMatches: z.number().int().min(1).max(toolLimits.grepMatches).optional()
                .describe(`Максимум совпадений (по умолчанию и максимум ${toolLimits.grepMatches})`),
              ...machineParam
            }
          },
          async (args) => {
            const { pattern, path, glob, maxMatches } = args
            const machine = (args as { machine?: string }).machine
            try {
              const machineTarget = resolveMachine(machine)
              const target = await safePath(machineTarget, path ?? '.')
              if (makeScoped) {
                const file = await registry.fsRead(machineTarget.agentId, target)
                const lines = fileText(checkedBytes(file.dataBase64, file.truncated)).split('\n')
                const matches = lines.flatMap((line, i) => line.includes(pattern) ? [String(i + 1) + ':' + line] : [])
                return { content: [{ type: 'text' as const, text: trimToolOutput(matches.slice(0, maxMatches ?? toolLimits.grepMatches).join('\n'), toolLimits.grepChars).text }] }
              }
              const include = glob ? ` --include=${quoteShell(glob)}` : ''
              const command = `grep -rn --binary-files=without-match${include} -- ${quoteShell(pattern)} ${quoteShell(target)}`
              const res = await registry.exec(machineTarget.agentId, command, DEFAULT_TIMEOUT_MS, abort.signal, { source: 'chat', conversationId: req.query.conv ?? null })
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

        if (machineTools) server.registerTool(
          'edit',
          {
            description: 'Точно заменяет строку в текстовом файле внутри рабочей директории рана.',
            inputSchema: {
              path: z.string().describe('Путь относительно cwd рана или абсолютный внутри него'),
              oldString: z.string().min(1).describe('Точный старый текст'),
              newString: z.string().describe('Новый текст'),
              replaceAll: z.boolean().optional().describe('Заменить все совпадения (по умолчанию false)'),
              ...machineParam
            }
          },
          async (args) => {
            const { path, oldString, newString, replaceAll } = args
            const machine = (args as { machine?: string }).machine
            try {
              if (readOnly) throw new Error('Отклонено: режим «План» — правки файлов запрещены')
              const target = resolveMachine(machine)
              const absolutePath = await safePath(target, path)
              const current = fileText((await registry.fsRead(target.agentId, absolutePath)).dataBase64)
              const count = current.split(oldString).length - 1
              if (count === 0) throw new Error('Текст oldString не найден')
              if (count > 1 && !replaceAll) {
                throw new Error(`Найдено ${count} вхождений oldString; уточните фрагмент или включите replaceAll`)
              }
              const updated = replaceAll
                ? current.split(oldString).join(newString)
                : current.replace(oldString, newString)
              await registry.fsWrite(target.agentId, absolutePath, Buffer.from(updated, 'utf8').toString('base64'))
              return { content: [{ type: 'text' as const, text: `Файл ${path} обновлён (${replaceAll ? count : 1} замен).` }] }
            } catch (err) {
              return toolError(err)
            }
          }
        )

        // Список машин проекта — только у хода с проектом: вне проекта модель
        // видит прежний набор инструментов и не гадает про недоступное.
        if (machines.length) {
          server.registerTool(
            'machines',
            {
              description:
                'Машины проекта: имя, онлайн-статус и папка проекта. Без параметра machine операции ' +
                'выполняются на выбранной машине; другой машине их адресует параметр machine у bash/read/image/grep/edit.',
              inputSchema: {}
            },
            async () => {
              const lines = machines.map((m) => {
                const marks = [registry.isOnline(m.agentId) ? 'в сети' : 'не в сети']
                if (m.agentId === agentId) marks.push('выбранная машина этого хода')
                return `- «${m.name}» (id ${m.agentId}) — ${marks.join('; ')}; папка проекта: ${m.path || 'не настроена'}`
              })
              return {
                content: [
                  {
                    type: 'text' as const,
                    text:
                      `Машины проекта:\n${lines.join('\n')}\n\n` +
                      `Без параметра machine операции выполняются на выбранной машине` +
                      `${req.query.cwd ? ` (рабочая директория: ${req.query.cwd})` : ''}.`
                  }
                ]
              }
            }
          )
        }

        if (makeScoped && req.query.conv && makeFiles && await makeFiles.available(req.query.conv)) {
          const conversation = req.query.conv
          const writeAllowed = () => { if (readOnly) throw new Error('Read-only plan: file transfers are forbidden') }
          const success = () => ({ content: [{ type: 'text' as const, text: 'File transferred' }] })
          server.registerTool('attachment_to_make', {
            description: 'Copy a chat attachment into the open Make project without exposing bytes.',
            inputSchema: { uploadId: z.string(), path: z.string() }
          }, async ({ uploadId, path }) => {
            try {
              writeAllowed()
              const attachment = (req.query.files && fileContexts ? fileContexts(req.query.files) : [])?.find(a => a.uploadId === uploadId)
              if (!attachment) throw new Error('Attachment not available in this turn')
              await makeFiles.write(conversation, makeFilePath(path), checkedBytes(attachment.dataBase64), req.query.turn)
              return success()
            } catch (err) { return toolError(err) }
          })
          if (machineTools) {
            server.registerTool('machine_to_make', {
              description: 'Copy a file from the configured machine folder into the Make project.',
              inputSchema: { machinePath: z.string(), path: z.string() }
            }, async ({ machinePath, path }) => {
              try {
                writeAllowed()
                const destination = makeFilePath(path)
                const file = await registry.fsRead(agentId, await safePath(resolveMachine(), machinePath))
                await makeFiles.write(conversation, destination, checkedBytes(file.dataBase64, file.truncated), req.query.turn)
                return success()
              } catch (err) { return toolError(err) }
            })
            server.registerTool('make_to_machine', {
              description: 'Copy a Make project file into the configured machine folder.',
              inputSchema: { path: z.string(), machinePath: z.string() }
            }, async ({ path, machinePath }) => {
              try {
                writeAllowed()
                const destination = await safePath(resolveMachine(), machinePath)
                const data = checkedBytes(await makeFiles.read(conversation, makeFilePath(path)))
                await registry.fsWrite(agentId, destination, data)
                return success()
              } catch (err) { return toolError(err) }
            })
          }
        }

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
