// Storybook проекта, поднятый на машине пользователя: старт, готовность, лог, остановка.
//
// Почему PTY, а не exec: `exec` убивает всю группу процессов по таймауту (60 с у REST,
// свой таймаут у реестра), а нам нужен живой dev-сервер на часы. PTY-сессия реестра —
// единственный существующий «долгий процесс с логом и остановкой», и переподписка у неё
// уже работает: сервер держит подписчика сам, поэтому вкладку можно закрыть.
//
// Почему готовность проверяется по `/index.json`, а не по коду выхода: `storybook dev`
// печатает адрес задолго до того, как Vite соберёт первый бандл, и iframe, открытый
// раньше, ловит 504 от прокси (у моста агента таймаут 10 с). Проба заодно прогревает
// сервер, чтобы первая загрузка кадра не упиралась в этот таймаут.

import {
  PROJECT_STORYBOOK_DEFAULT_COMMAND, PROJECT_STORYBOOK_DEFAULT_PORT,
  type AgentHttpRequest, type AgentHttpResponse, type ProjectStorybookSession, type ProjectStorybookState
} from '@voicechat/shared'

export interface StorybookRegistry {
  ptyStart(agentId: string, ptyId: string, cols: number, rows: number, cwd: string | undefined, emit: (e: { t: string; ptyId: string; data?: string; message?: string }) => void): void
  ptyInput(ptyId: string, data: string): void
  ptyKill(ptyId: string): void
  ptyLive(ptyId: string): boolean
  http(agentId: string, request: AgentHttpRequest): Promise<AgentHttpResponse>
  isOnline(agentId: string): boolean
  nameOf(agentId: string): string | undefined
}

export interface StorybookSessionsDeps {
  registry: StorybookRegistry
  now?: () => number
  /** Пауза между пробами готовности; в тестах — короткая. */
  probeIntervalMs?: number
  /** Сколько ждём первой сборки, прежде чем признать запуск неудачным. */
  readyTimeoutMs?: number
}

/** Диапазон портов: 6006 занят у половины разработчиков вручную, поэтому ищем свободный. */
const PORT_FROM = PROJECT_STORYBOOK_DEFAULT_PORT
const PORT_TO = PROJECT_STORYBOOK_DEFAULT_PORT + 40
/** Хвост лога: больше в панели всё равно не читают, а память сессии не резиновая. */
const LOG_MAX_CHARS = 16_000
const PROBE_INTERVAL_MS = 3_000
const READY_TIMEOUT_MS = 300_000

interface Session {
  workspaceId: string
  agentId: string
  path: string
  ptyId: string
  port: number
  command: string
  state: ProjectStorybookState
  startedAt: number | null
  readyAt: number | null
  error: string | null
  log: string
  probeTimer: ReturnType<typeof setTimeout> | null
  /** Строка-сентинел завершения команды: по ней виден выход процесса в живом shell. */
  exitRe: RegExp
  /** Процесс запущен не нами: подхвачен по отвечающему порту. */
  adopted: boolean
}

/** Экранные последовательности в логе бесполезны: панель показывает текст, а не терминал. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r(?!\n)/g, '\n')
}

/**
 * Ключ сессии — рабочая копия вместе с её каталогом: на одну копию один Storybook
 * (второй занял бы тот же порт). Путь входит в ключ намеренно: у `project:<agentId>`
 * каталог меняется в настройках машины, и без пути панель показывала бы индекс
 * прежнего репозитория как свой.
 */
const keyOf = (agentId: string, workspaceId: string, path: string): string => `${agentId}::${workspaceId}::${path}`

export class StorybookSessions {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly deps: StorybookSessionsDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** Снимок для панели; сессии нет — «остановлен», а не пустой ответ. */
  snapshot(agentId: string, workspaceId: string, path: string, port?: number): ProjectStorybookSession {
    const session = this.sessions.get(keyOf(agentId, workspaceId, path))
    return {
      workspaceId,
      agentId,
      machineName: this.deps.registry.nameOf(agentId) ?? '',
      state: session?.state ?? 'stopped',
      port: session?.port ?? port ?? PORT_FROM,
      command: session?.command ?? PROJECT_STORYBOOK_DEFAULT_COMMAND,
      startedAt: session?.startedAt ?? null,
      readyAt: session?.readyAt ?? null,
      error: session?.error ?? null,
      log: session?.log ?? '',
      adopted: session?.adopted ?? false
    }
  }

  /** Свободный порт: занятые нашими же сессиями на этой машине исключаем. */
  private pickPort(agentId: string, requested?: number): number {
    const used = new Set([...this.sessions.values()].filter((s) => s.agentId === agentId && s.state !== 'stopped').map((s) => s.port))
    if (requested && requested >= 1 && requested <= 65_535 && !used.has(requested)) return requested
    for (let port = PORT_FROM; port <= PORT_TO; port++) if (!used.has(port)) return port
    return PORT_FROM
  }

  async start(input: { agentId: string; workspaceId: string; path: string; command?: string; port?: number }): Promise<ProjectStorybookSession> {
    const key = keyOf(input.agentId, input.workspaceId, input.path)
    const existing = this.sessions.get(key)
    if (existing && existing.state !== 'stopped' && existing.state !== 'failed' && this.deps.registry.ptyLive(existing.ptyId)) {
      return this.snapshot(input.agentId, input.workspaceId, input.path)
    }
    if (existing) this.stopSession(existing)
    if (!this.deps.registry.isOnline(input.agentId)) {
      throw new Error('Машина не в сети — Storybook запускать негде')
    }
    // Порт уже отвечает — значит Storybook подняли руками или он пережил перезапуск
    // сервера (сессии живут в памяти). Второй процесс на том же порту всё равно не
    // встал бы, поэтому подключаемся к существующему, а не плодим сироту.
    const adoptPort = input.port ?? PORT_FROM
    // Подхватываем только когда своих сессий на машине нет: иначе занятый порт — наш
    // же Storybook соседней копии, и «подключиться» к нему значило бы показать чужие
    // компоненты вместо запуска своего.
    const ownsMachine = [...this.sessions.values()].some((s) => s.agentId === input.agentId && s.state !== 'stopped')
    if (!ownsMachine && await this.storybookAnswers(input.agentId, adoptPort)) {
      const adopted: Session = {
        workspaceId: input.workspaceId, agentId: input.agentId, path: input.path,
        ptyId: `storybook:${input.workspaceId}`, port: adoptPort,
        command: (input.command ?? PROJECT_STORYBOOK_DEFAULT_COMMAND).trim(),
        state: 'running', startedAt: this.now(), readyAt: this.now(), error: null,
        log: `На порту ${adoptPort} уже отвечает Storybook — панель подключилась к нему.\n`,
        probeTimer: null, exitRe: /$^/, adopted: true
      }
      this.sessions.set(key, adopted)
      return this.snapshot(input.agentId, input.workspaceId, input.path)
    }
    const port = this.pickPort(input.agentId, input.port)
    const command = `${(input.command ?? PROJECT_STORYBOOK_DEFAULT_COMMAND).trim()} --port ${port} --no-open --ci`
    // Команда идёт в живой shell, и его выход `pty.exit` не наступает, когда падает
    // только она: без сентинела «npm error Missing script» выглядел бы как бесконечная
    // сборка. Приём тот же, что в console_run: `%d` в эхе ввода под `(\d+)` не подходит,
    // поэтому эхо не принимается за результат.
    const sentinel = `__VCSB_${Math.abs(Date.now() ^ port).toString(36)}_`
    const session: Session = {
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      path: input.path,
      ptyId: `storybook:${input.workspaceId}`,
      port,
      command,
      state: 'starting',
      startedAt: this.now(),
      readyAt: null,
      error: null,
      log: '',
      probeTimer: null,
      exitRe: new RegExp(`${sentinel}(\\d+)__`),
      adopted: false
    }
    this.sessions.set(key, session)
    this.deps.registry.ptyStart(input.agentId, session.ptyId, 160, 48, input.path, (event) => {
      if (event.t === 'pty.output' && typeof event.data === 'string') this.appendLog(session, event.data)
      if (event.t === 'pty.error') this.fail(session, event.message ?? 'Сеанс терминала прервался')
      if (event.t === 'pty.exit') {
        // Выход процесса до готовности — это отказ; после готовности — обычная остановка.
        if (session.state === 'starting') this.fail(session, 'Storybook завершился, не успев собраться — смотрите лог')
        else this.markStopped(session)
      }
    })
    this.deps.registry.ptyInput(session.ptyId, `${command} ; printf '\\n${sentinel}%d__\\n' $?\r`)
    this.scheduleProbe(session)
    return this.snapshot(input.agentId, input.workspaceId, input.path)
  }

  stop(agentId: string, workspaceId: string, path: string): ProjectStorybookSession {
    const session = this.sessions.get(keyOf(agentId, workspaceId, path))
    if (session) this.stopSession(session)
    return this.snapshot(agentId, workspaceId, path)
  }

  async restart(input: { agentId: string; workspaceId: string; path: string; command?: string; port?: number }): Promise<ProjectStorybookSession> {
    this.stop(input.agentId, input.workspaceId, input.path)
    return await this.start(input)
  }

  /** Живая проверка: панель опрашивает состояние, пока идёт сборка. */
  async refresh(agentId: string, workspaceId: string, path: string, adoptPort: number = PORT_FROM): Promise<ProjectStorybookSession> {
    const session = this.sessions.get(keyOf(agentId, workspaceId, path))
    if (session && session.state !== 'stopped' && !session.adopted && !this.deps.registry.ptyLive(session.ptyId)) {
      this.markStopped(session)
    }
    void adoptPort
    return this.snapshot(agentId, workspaceId, path)
  }

  /** Индекс живого Storybook: он же список компонентов с настоящими id стори. */
  async index(agentId: string, workspaceId: string, path: string): Promise<unknown | null> {
    const session = this.sessions.get(keyOf(agentId, workspaceId, path))
    if (!session || session.state !== 'running') return null
    const response = await this.request(session, '/index.json')
    if (!response || response.status !== 200) return null
    try {
      return JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8'))
    } catch {
      return null
    }
  }

  /** Остановка всех сессий (закрытие сервера, отключение машины). */
  dispose(agentId?: string): void {
    for (const session of [...this.sessions.values()]) {
      if (agentId && session.agentId !== agentId) continue
      this.stopSession(session)
    }
  }

  // --- внутреннее ---------------------------------------------------------

  private appendLog(session: Session, data: string): void {
    session.log = (session.log + stripAnsi(data)).slice(-LOG_MAX_CHARS)
    const exit = session.log.match(session.exitRe)
    if (!exit) return
    // Команда завершилась. До готовности это отказ (и код выхода — самая полезная
    // деталь), после готовности — обычная остановка dev-сервера.
    if (session.state === 'starting') {
      this.fail(session, exit[1] === '0'
        ? 'Команда запуска завершилась, не подняв Storybook — смотрите лог'
        : `Команда запуска завершилась с кодом ${exit[1]} — смотрите лог`)
    } else if (session.state === 'running') {
      this.markStopped(session)
    }
  }

  private fail(session: Session, message: string): void {
    session.state = 'failed'
    session.error = message
    session.readyAt = null
    if (session.probeTimer) clearTimeout(session.probeTimer)
    session.probeTimer = null
  }

  private markStopped(session: Session): void {
    session.state = 'stopped'
    session.readyAt = null
    if (session.probeTimer) clearTimeout(session.probeTimer)
    session.probeTimer = null
  }

  private stopSession(session: Session): void {
    if (session.probeTimer) clearTimeout(session.probeTimer)
    session.probeTimer = null
    if (session.adopted) {
      // Процесс не наш: сеанса терминала за ним нет, убивать чужое — не наше дело.
      this.sessions.delete(keyOf(session.agentId, session.workspaceId, session.path))
      return
    }
    // Ctrl-C даёт dev-серверу закрыть порт; следом убиваем сеанс, иначе shell останется жить.
    if (this.deps.registry.ptyLive(session.ptyId)) {
      this.deps.registry.ptyInput(session.ptyId, '\x03')
      this.deps.registry.ptyKill(session.ptyId)
    }
    session.state = 'stopped'
    session.readyAt = null
    this.sessions.delete(keyOf(session.agentId, session.workspaceId, session.path))
  }

  /** Отвечает ли на порту именно Storybook: `/index.json` с разбираемым телом. */
  private async storybookAnswers(agentId: string, port: number): Promise<boolean> {
    try {
      const response = await this.deps.registry.http(agentId, { method: 'GET', port, path: '/index.json', headers: {} })
      if (response.status < 200 || response.status >= 400) return false
      const body = JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8')) as { entries?: unknown; stories?: unknown }
      return typeof body === 'object' && body !== null && (body.entries !== undefined || body.stories !== undefined)
    } catch {
      return false
    }
  }

  private async request(session: Session, path: string): Promise<AgentHttpResponse | null> {
    try {
      return await this.deps.registry.http(session.agentId, { method: 'GET', port: session.port, path, headers: {} })
    } catch {
      return null
    }
  }

  private scheduleProbe(session: Session): void {
    const interval = this.deps.probeIntervalMs ?? PROBE_INTERVAL_MS
    const timeout = this.deps.readyTimeoutMs ?? READY_TIMEOUT_MS
    const tick = async (): Promise<void> => {
      session.probeTimer = null
      if (session.state !== 'starting') return
      if (!this.deps.registry.ptyLive(session.ptyId)) {
        this.fail(session, 'Сеанс с Storybook закрыт — процесс не запустился')
        return
      }
      const response = await this.request(session, '/index.json')
      if (session.state !== 'starting') return
      if (response && response.status >= 200 && response.status < 400) {
        session.state = 'running'
        session.readyAt = this.now()
        session.error = null
        return
      }
      if (session.startedAt !== null && this.now() - session.startedAt > timeout) {
        this.fail(session, 'Storybook не ответил за отведённое время — смотрите лог запуска')
        return
      }
      session.probeTimer = setTimeout(() => { void tick() }, interval)
      session.probeTimer.unref?.()
    }
    session.probeTimer = setTimeout(() => { void tick() }, interval)
    session.probeTimer.unref?.()
  }
}
