// MCP-эндпоинт «Консоль с ассистентом»: инструменты ассистента пишут и читают ТУ ЖЕ
// живую PTY-сессию разговора, что видит пользователь (ptyId = `console:<conv>`).
// В отличие от remote-bash (одноразовый registry.exec) здесь общий терминал:
// команды/клавиши идут в живой shell, а вывод берётся из его кольцевого буфера.
// Stateless по образцу remoteBashMcp; доступ только по секрету процесса `k`.

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { consolePtyId } from '@voicechat/shared'
import type { AgentRegistry } from '../agents/registry.js'

export const CONSOLE_MCP_PATH = '/mcp/console'

const RUN_TIMEOUT_MS = 30_000
const READ_TAIL_CHARS = 4_000

/** Убирает ANSI/управляющие последовательности, чтобы отдать модели «что на экране». */
function stripAnsi(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[=>]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\r/g, '')
}

/** Известные спец-клавиши → байтовые последовательности терминала. */
const KEY_MAP: Record<string, string> = {
  enter: '\r', return: '\r', tab: '\t', esc: '\x1b', escape: '\x1b',
  backspace: '\x7f', delete: '\x1b[3~', space: ' ',
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D',
  home: '\x1b[H', end: '\x1b[F', pageup: '\x1b[5~', pagedown: '\x1b[6~',
  'ctrl+c': '\x03', 'ctrl+d': '\x04', 'ctrl+x': '\x18', 'ctrl+o': '\x0f',
  'ctrl+z': '\x1a', 'ctrl+l': '\x0c', 'ctrl+a': '\x01', 'ctrl+e': '\x05',
  'ctrl+k': '\x0b', 'ctrl+u': '\x15', 'ctrl+w': '\x17', 'ctrl+r': '\x12'
}

/** Необратимые/опасные команды: без confirm=true инструмент их не выполняет. */
const DESTRUCTIVE_RE = /(^|[\s;&|])(rm\s+-[a-z]*f|rm\s+-[a-z]*r|shred|mkfs|dd\s|:\s*\(\)\s*\{|sudo\s|git\s+push|git\s+reset\s+--hard|git\s+clean|drop\s+table|truncate\s|>\s*\/dev\/sd)/i

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function registerConsoleMcp(app: FastifyInstance, registry: AgentRegistry, secret: string): void {
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers()
    scope.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined))
    scope.post<{ Querystring: { conv?: string; k?: string; ro?: string } }>(
      CONSOLE_MCP_PATH,
      async (req, reply) => {
        if (req.query.k !== secret) return reply.code(403).send({ error: 'forbidden' })
        const conv = req.query.conv ?? ''
        const readOnly = req.query.ro === '1'
        const ptyId = consolePtyId(conv)
        const text = (t: string, isError = false): { content: { type: 'text'; text: string }[]; isError?: boolean } =>
          isError ? { content: [{ type: 'text' as const, text: t }], isError: true } : { content: [{ type: 'text' as const, text: t }] }
        const requireLive = (): string | null => (registry.ptyLive(ptyId) ? null : 'Консоль этого разговора не открыта: попроси пользователя открыть панель «Консоль» справа.')
        const planBlocked = (): { content: { type: 'text'; text: string }[]; isError?: boolean } =>
          text('Отклонено: режим «План» — ввод в терминал запрещён. Исследуй только чтением (console_read/console_context); ввод начнётся после одобрения плана.', true)

        const server = new McpServer({ name: 'console', version: '1.0.0' })

        server.registerTool('console_read', {
          description: 'Прочитать текущий экран консоли пользователя (последние строки вывода, без ANSI). Так ты видишь результат своих и пользовательских действий.',
          inputSchema: {}
        }, async () => {
          const live = requireLive()
          if (live) return text(live, true)
          const buf = registry.ptyBufferText(ptyId) ?? ''
          const screen = stripAnsi(buf).slice(-READ_TAIL_CHARS)
          return text(screen.trim() || '(экран пуст)')
        })

        server.registerTool('console_context', {
          description: 'Текущий контекст терминала: рабочий каталог (cwd), процесс в фокусе (shell/nano/vim/ssh) и активен ли полноэкранный TUI (altScreen). По нему решай: слать команду в shell или клавиши в программу.',
          inputSchema: {}
        }, async () => {
          const live = requireLive()
          if (live) return text(live, true)
          const ctx = registry.ptyContextOf(ptyId)
          if (!ctx) return text('Контекст пока неизвестен (агент ещё не сообщил cwd/процесс). Экран доступен через console_read.')
          const parts = [
            `cwd: ${ctx.cwd ?? 'неизвестно'}`,
            `в фокусе: ${ctx.foreground ?? 'неизвестно'}`,
            `полноэкранный TUI: ${ctx.altScreen ? 'да (используй console_keys, а не команды)' : 'нет (обычный shell)'}`
          ]
          return text(parts.join('\n'))
        })

        server.registerTool('console_run', {
          description: 'Выполнить shell-команду в живой консоли пользователя и вернуть её вывод и код выхода. Только для обычного shell (не когда открыт nano/vim/ssh-TUI — тогда console_keys). Необратимые команды (rm -rf, git push, sudo…) требуют confirm=true и предварительного согласия пользователя в чате.',
          inputSchema: {
            command: z.string().describe('Команда для shell пользователя'),
            confirm: z.boolean().optional().describe('true — пользователь подтвердил необратимую команду')
          }
        }, async (args) => {
          if (readOnly) return planBlocked()
          const live = requireLive()
          if (live) return text(live, true)
          const command = args.command
          if (DESTRUCTIVE_RE.test(command) && !args.confirm) {
            return text(`Команда выглядит необратимой: «${command}». Сначала спроси подтверждение у пользователя в чате, затем повтори с confirm=true.`, true)
          }
          const before = (registry.ptyBufferText(ptyId) ?? '').length
          const id = Math.abs((Date.now() ^ command.length) % 1_000_000).toString(36)
          const sentinel = `__VCEND_${id}_`
          registry.ptyInput(ptyId, `${command} ; printf '\\n${sentinel}%d__\\n' $?\r`)
          const re = new RegExp(`${sentinel}(\\d+)__`)
          const deadline = Date.now() + RUN_TIMEOUT_MS
          let tailRaw = ''
          let match: RegExpMatchArray | null = null
          while (Date.now() < deadline) {
            await sleep(150)
            tailRaw = (registry.ptyBufferText(ptyId) ?? '').slice(before)
            match = stripAnsi(tailRaw).match(re)
            if (match) break
          }
          const clean = stripAnsi(tailRaw)
          if (!match) {
            return text(`Команда не завершилась за ${RUN_TIMEOUT_MS / 1000}с (возможно, интерактивная или всё ещё идёт). Текущий экран:\n${clean.slice(-READ_TAIL_CHARS)}`, true)
          }
          const exit = match[1]
          // Вывод — между эхом команды и строкой-сентинелом.
          let body = clean.slice(0, clean.indexOf(match[0]))
          const nl = body.indexOf('\n')
          if (nl >= 0) body = body.slice(nl + 1) // убираем эхо введённой команды
          return text(`${body.trim()}\n[exit code: ${exit}]`.trim())
        })

        server.registerTool('console_input', {
          description: 'Ввести произвольный текст в консоль КАК ЕСТЬ, без Enter (например, набрать текст в nano). Для нажатия клавиш используй console_keys.',
          inputSchema: { data: z.string().describe('Текст для ввода в терминал') }
        }, async (args) => {
          if (readOnly) return planBlocked()
          const live = requireLive()
          if (live) return text(live, true)
          registry.ptyInput(ptyId, args.data)
          return text('Введено.')
        })

        server.registerTool('console_keys', {
          description: `Нажать спец-клавиши в консоли (для TUI: nano/vim/less/top). Доступно: ${Object.keys(KEY_MAP).join(', ')}. Пример выхода из nano с сохранением: ["ctrl+o","enter","ctrl+x"].`,
          inputSchema: { keys: z.array(z.string()).describe('Последовательность клавиш из списка') }
        }, async (args) => {
          if (readOnly) return planBlocked()
          const live = requireLive()
          if (live) return text(live, true)
          const unknown = args.keys.filter((k) => !(k.toLowerCase() in KEY_MAP))
          if (unknown.length) return text(`Неизвестные клавиши: ${unknown.join(', ')}. Доступно: ${Object.keys(KEY_MAP).join(', ')}.`, true)
          registry.ptyInput(ptyId, args.keys.map((k) => KEY_MAP[k.toLowerCase()]).join(''))
          return text('Отправлено.')
        })

        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        reply.raw.on('close', () => { void transport.close(); void server.close() })
        await server.connect(transport)
        await transport.handleRequest(req.raw, reply.raw, req.body)
      }
    )
  })
}
