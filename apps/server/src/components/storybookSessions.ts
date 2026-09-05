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
}

/** Экранные последовательности в логе бесполезны: панель показывает текст, а не терминал. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r(?!\n)/g, '\n')
}

/** Ключ сессии — рабочая копия: на одну копию один Storybook, второй занял бы тот же порт. */
const keyOf = (agentId: string, workspaceId: string): string => `${agentId}::${workspaceId}`

export class StorybookSessions {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly deps: StorybookSessionsDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  /** Снимок для панели; сессии нет — «остановлен», а не пустой ответ. */
  snapshot(agentId: string, workspaceId: string, port?: number): ProjectStorybookSession {
    const session = this.sessions.get(keyOf(agentId, workspaceId))
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
      log: session?.log ?? ''
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
    const key = keyOf(input.agentId, input.workspaceId)
    const existing = this.sessions.get(key)
    if (existing && existing.state !== 'stopped' && existing.state !== 'failed' && this.deps.registry.ptyLive(existing.ptyId)) {
      return this.snapshot(input.agentId, input.workspaceId)
    }
    if (existing) this.stopSession(existing)
    if (!this.deps.registry.isOnline(input.agentId)) {
      throw new Error('Машина не в сети — Storybook запускать негде')
    }
    const port = this.pickPort(input.agentId, input.port)
    const command = `${(input.command ?? PROJECT_STORYBOOK_DEFAULT_COMMAND).trim()} --port ${port} --no-open --ci`
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
      probeTimer: null
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
    this.deps.registry.ptyInput(session.ptyId, `${command}\r`)
    this.scheduleProbe(session)
    return this.snapshot(input.agentId, input.workspaceId)
  }

  stop(agentId: string, workspaceId: string): ProjectStorybookSession {
    const session = this.sessions.get(keyOf(agentId, workspaceId))
    if (session) this.stopSession(session)
    return this.snapshot(agentId, workspaceId)
  }

  async restart(input: { agentId: string; workspaceId: string; path: string; command?: string; port?: number }): Promise<ProjectStorybookSession> {
    this.stop(input.agentId, input.workspaceId)
    return await this.start(input)
  }

  /** Живая проверка: панель опрашивает состояние, пока идёт сборка. */
  async refresh(agentId: string, workspaceId: string): Promise<ProjectStorybookSession> {
    const session = this.sessions.get(keyOf(agentId, workspaceId))
    if (session && session.state !== 'stopped' && !this.deps.registry.ptyLive(session.ptyId)) {
      this.markStopped(session)
    }
    return this.snapshot(agentId, workspaceId)
  }

  /** Индекс живого Storybook: он же список компонентов с настоящими id стори. */
  async index(agentId: string, workspaceId: string): Promise<unknown | null> {
    const session = this.sessions.get(keyOf(agentId, workspaceId))
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
    // Ctrl-C даёт dev-серверу закрыть порт; следом убиваем сеанс, иначе shell останется жить.
    if (this.deps.registry.ptyLive(session.ptyId)) {
      this.deps.registry.ptyInput(session.ptyId, '\x03')
      this.deps.registry.ptyKill(session.ptyId)
    }
    session.state = 'stopped'
    session.readyAt = null
    this.sessions.delete(keyOf(session.agentId, session.workspaceId))
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
