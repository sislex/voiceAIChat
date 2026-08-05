// In-memory реестр подключённых машин-агентов и выполнение команд на них.
// Не зависит от ws: сокет — минимальный интерфейс {send, close} (тестируемо).

import { randomUUID } from 'node:crypto'
import {
  evaluateAgentCommand,
  isToolAllowed,
  requiredVersion,
  AGENT_VERSION,
  DEFAULT_AGENT_POLICY,
  type AgentImageHost,
  type AgentPolicy,
  type AgentTelemetry,
  type AgentToServer,
  type FsOp,
  type FsResult,
  type ServerToAgent
} from '@voicechat/shared'

/** Минимальный интерфейс сокета агента (реальный ws.WebSocket ему соответствует). */
export interface AgentSocket {
  send(data: string): void
  close(): void
}

export interface ExecResult {
  exitCode: number | null
  output: string
  timedOut: boolean
}

/** События PTY, уходящие клиенту (подмножество ServerMessage). */
export type PtyEvent =
  | { t: 'pty.output'; ptyId: string; data: string }
  | { t: 'pty.exit'; ptyId: string; exitCode: number | null }
  | { t: 'pty.error'; ptyId: string; message: string }

/** Активная PTY-сессия: процесс живёт независимо от браузерской подписки. */
interface PtySession {
  agentId: string
  emit: ((e: PtyEvent) => void) | null
  output: string[]
  outputBytes: number
  /** Таймер простоя: тикает, пока к сеансу никто не подписан. */
  idleTimer: NodeJS.Timeout | null
}

/** Кап кольцевого буфера PTY: достаточно для восстановления экрана, но без роста памяти. */
const PTY_OUTPUT_CAP_BYTES = 200 * 1024
/**
 * Сколько сеанс живёт без подписчика: вкладку закрыли/браузер отвалился, и через
 * это время shell убивается сам, иначе забытые PTY копились бы до перезапуска.
 */
const PTY_IDLE_TTL_MS = 30 * 60_000
/** Кап буфера вывода одной команды — результат уходит в контекст модели. */
const OUTPUT_CAP_BYTES = 200 * 1024
/** Запас серверного страховочного таймаута сверх таймаута агента. */
const GUARD_EXTRA_MS = 10_000
/** Таймаут файловой операции проводника. */
const FS_TIMEOUT_MS = 10_000
/** Сообщение, когда агент не ответил на fs-операцию (частая причина — устаревший агент). */
const FS_NO_REPLY = 'Машина не ответила. Возможно, агент устарел — обновите его на машине.'

interface PendingExec {
  agentId: string
  chunks: string[]
  bytes: number
  truncated: boolean
  timer: NodeJS.Timeout
  resolve(result: ExecResult): void
  reject(err: Error): void
  /** Стриминговый режим: каждый chunk уходит сюда, не копится в буфере. */
  onChunk?: (data: string) => void
}

interface PendingFs {
  agentId: string
  timer: NodeJS.Timeout
  resolve(result: FsResult): void
  reject(err: Error): void
}

interface OnlineAgent {
  name: string
  socket: AgentSocket
  policy: AgentPolicy
  /** Версия подключённого агента (legacy без рапорта → '0.1.0'). */
  version: string
  imageHost?: AgentImageHost
}

export class AgentRegistry {
  private readonly online = new Map<string, OnlineAgent>()
  private readonly pending = new Map<string, PendingExec>()
  private readonly pendingFs = new Map<string, PendingFs>()
  private readonly ptys = new Map<string, PtySession>()
  private readonly telemetry = new Map<string, AgentTelemetry>()
  private readonly newId: () => string
  private readonly changeListeners = new Set<() => void>()

  constructor(deps: { newId?: () => string } = {}) {
    this.newId = deps.newId ?? (() => randomUUID())
  }

  register(
    agentId: string,
    name: string,
    socket: AgentSocket,
    policy = DEFAULT_AGENT_POLICY,
    version = '0.1.0',
    imageHost?: AgentImageHost
  ): void {
    // Повторное подключение с тем же токеном вытесняет старое соединение.
    const prev = this.online.get(agentId)
    if (prev) {
      this.unregister(agentId)
      try {
        prev.socket.close()
      } catch {
        /* уже закрыт */
      }
    }
    this.online.set(agentId, { name, socket, policy, version, imageHost })
    this.emitChange()
  }

  /** Раздача картинок машиной (undefined — офлайн или агент её не умеет). */
  imageHostOf(agentId: string): AgentImageHost | undefined {
    return this.online.get(agentId)?.imageHost
  }

  /** Обновляет данные раздачи (порт/адреса меняются на живом соединении). */
  setImageHost(agentId: string, imageHost: AgentImageHost): void {
    const a = this.online.get(agentId)
    if (!a) return
    a.imageHost = imageHost
    this.emitChange()
  }

  /** Версия подключённого агента (undefined — офлайн). */
  versionOf(agentId: string): string | undefined {
    return this.online.get(agentId)?.version
  }

  /** Последняя телеметрия онлайн-агента (undefined — нет данных/офлайн). */
  telemetryOf(agentId: string): AgentTelemetry | undefined {
    return this.telemetry.get(agentId)
  }

  /**
   * Платформа машины (`os.platform()` из последней телеметрии): 'win32' | 'linux' | …
   * undefined — телеметрия ещё не пришла (старый агент или первые секунды после
   * реконнекта). Нужно для MCP `bash`, чтобы правильно завернуть `cwd` под shell
   * машины (см. `mcp/remoteBashMcp.ts`).
   */
  platformOf(agentId: string): string | undefined {
    return this.telemetry.get(agentId)?.os.platform
  }

  /** Сохраняет свежую телеметрию агента и уведомляет подписчиков (пуш веб-клиенту). */
  private setTelemetry(agentId: string, t: AgentTelemetry): void {
    if (!this.online.has(agentId)) return
    this.telemetry.set(agentId, t)
    this.emitChange()
  }

  /**
   * Проверяет, что версия агента достаточна для тула. Если нет — шлёт агенту
   * сигнал об обновлении и возвращает ошибку (иначе null). Офлайн — null
   * (это обработают проверки «не в сети» в exec/runFs).
   */
  private versionError(agentId: string, tool: string): Error | null {
    const a = this.online.get(agentId)
    if (!a || isToolAllowed(a.version, tool)) return null
    this.send(agentId, { t: 'agent.updateAvailable', version: AGENT_VERSION })
    return new Error(
      `Агент на «${a.name}» устарел (v${a.version}). Нужна ≥ v${requiredVersion(tool)}. ` +
        `Обновите приложение на машине (в трее — «Проверить обновления»).`
    )
  }

  /** Убирает агента из онлайна и отклоняет все его незавершённые команды. */
  unregister(agentId: string): void {
    const had = this.online.delete(agentId)
    this.telemetry.delete(agentId)
    for (const [execId, p] of this.pending) {
      if (p.agentId !== agentId) continue
      this.pending.delete(execId)
      clearTimeout(p.timer)
      p.reject(new Error('Машина отключилась во время выполнения команды'))
    }
    for (const [opId, p] of this.pendingFs) {
      if (p.agentId !== agentId) continue
      this.pendingFs.delete(opId)
      clearTimeout(p.timer)
      p.reject(new Error('Машина отключилась'))
    }
    for (const [ptyId, sess] of this.ptys) {
      if (sess.agentId !== agentId) continue
      this.ptys.delete(ptyId)
      if (sess.idleTimer) clearTimeout(sess.idleTimer)
      try {
        sess.emit?.({ t: 'pty.error', ptyId, message: 'Машина отключилась' })
      } catch {
        /* слушатель не должен ронять реестр */
      }
    }
    if (had) this.emitChange()
  }

  /** Обновляет политику онлайн-агента и шлёт её ему. */
  updatePolicy(agentId: string, policy: AgentPolicy): void {
    const agent = this.online.get(agentId)
    if (!agent) return
    agent.policy = policy
    this.send(agentId, { t: 'agent.policy', policy })
  }

  /** Подписка на изменения онлайн-состава (register/unregister). */
  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb)
    return () => this.changeListeners.delete(cb)
  }

  private emitChange(): void {
    for (const cb of this.changeListeners) {
      try {
        cb()
      } catch {
        /* слушатель не должен ронять реестр */
      }
    }
  }

  isOnline(agentId: string): boolean {
    return this.online.has(agentId)
  }

  nameOf(agentId: string): string | undefined {
    return this.online.get(agentId)?.name
  }

  policyOf(agentId: string): AgentPolicy | undefined {
    return this.online.get(agentId)?.policy
  }

  onlineIds(): Set<string> {
    return new Set(this.online.keys())
  }

  /** Закрывает сокет агента (при удалении машины). */
  disconnect(agentId: string): void {
    const a = this.online.get(agentId)
    this.unregister(agentId)
    try {
      a?.socket.close()
    } catch {
      /* уже закрыт */
    }
  }

  /**
   * Выполняет команду на агенте: шлёт exec.start, копит вывод (с капом),
   * резолвится по exec.done/exec.error, дисконнекту или страховочному таймауту.
   * `signal` отменяет только эту команду (напр., оборвался HTTP-запрос claude).
   */
  exec(
    agentId: string,
    command: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<ExecResult> {
    const agent = this.online.get(agentId)
    if (!agent) return Promise.reject(new Error('Машина не в сети'))
    if (signal?.aborted) return Promise.reject(new Error('Команда отменена'))
    const ve = this.versionError(agentId, 'exec')
    if (ve) return Promise.reject(ve)

    // Серверная проверка политики (первый барьер; агент проверяет ещё раз локально).
    const verdict = evaluateAgentCommand(agent.policy, command)
    if (!verdict.allowed) {
      return Promise.reject(new Error(`Запрещено политикой машины: ${verdict.reason}`))
    }

    const execId = this.newId()
    return new Promise<ExecResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Агент не ответил даже со своим таймаутом — считаем команду зависшей.
        this.pending.delete(execId)
        signal?.removeEventListener('abort', onAbort)
        this.send(agentId, { t: 'exec.cancel', execId })
        resolve({ exitCode: null, output: this.output(entryRef), timedOut: true })
      }, timeoutMs + GUARD_EXTRA_MS)
      // Отмена только этой команды (без затрагивания других на той же машине).
      const onAbort = (): void => {
        if (!this.pending.delete(execId)) return
        clearTimeout(timer)
        this.send(agentId, { t: 'exec.cancel', execId })
        reject(new Error('Команда отменена'))
      }
      const entryRef: PendingExec = {
        agentId,
        chunks: [],
        bytes: 0,
        truncated: false,
        timer,
        resolve: (r) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(r)
        },
        reject: (e) => {
          signal?.removeEventListener('abort', onAbort)
          reject(e)
        }
      }
      this.pending.set(execId, entryRef)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.send(agentId, { t: 'exec.start', execId, command, timeoutMs })
    })
  }

  /**
   * Стриминговый exec: как exec(), но каждый chunk вывода уходит в onChunk по мере
   * поступления (агент уже шлёт exec.chunk потоком — здесь их не буферизуем, а
   * форвардим, как PTY-релей). Возвращает финальный exitCode/timedOut; output пуст
   * (полный лог собирает вызывающий из onChunk). Для потокового CI-лога.
   */
  execStream(
    agentId: string,
    command: string,
    timeoutMs: number,
    onChunk: (data: string) => void,
    signal?: AbortSignal
  ): Promise<ExecResult> {
    const agent = this.online.get(agentId)
    if (!agent) return Promise.reject(new Error('Машина не в сети'))
    if (signal?.aborted) return Promise.reject(new Error('Команда отменена'))
    const ve = this.versionError(agentId, 'exec')
    if (ve) return Promise.reject(ve)
    const verdict = evaluateAgentCommand(agent.policy, command)
    if (!verdict.allowed) {
      return Promise.reject(new Error(`Запрещено политикой машины: ${verdict.reason}`))
    }
    const execId = this.newId()
    return new Promise<ExecResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(execId)
        signal?.removeEventListener('abort', onAbort)
        this.send(agentId, { t: 'exec.cancel', execId })
        resolve({ exitCode: null, output: '', timedOut: true })
      }, timeoutMs + GUARD_EXTRA_MS)
      const onAbort = (): void => {
        if (!this.pending.delete(execId)) return
        clearTimeout(timer)
        this.send(agentId, { t: 'exec.cancel', execId })
        reject(new Error('Команда отменена'))
      }
      const entryRef: PendingExec = {
        agentId,
        chunks: [],
        bytes: 0,
        truncated: false,
        timer,
        onChunk,
        resolve: (r) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(r)
        },
        reject: (e) => {
          signal?.removeEventListener('abort', onAbort)
          reject(e)
        }
      }
      this.pending.set(execId, entryRef)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.send(agentId, { t: 'exec.start', execId, command, timeoutMs })
    })
  }

  // --- Файловый проводник по машине (по образцу exec, корреляция по opId) ---

  /** Отправляет файловую операцию агенту и ждёт fs.result/fs.error (по opId). */
  private runFs(agentId: string, make: (opId: string) => FsOp): Promise<FsResult> {
    if (!this.online.has(agentId)) return Promise.reject(new Error('Машина не в сети'))
    const ve = this.versionError(agentId, 'fs')
    if (ve) return Promise.reject(ve)
    const opId = this.newId()
    return new Promise<FsResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingFs.delete(opId)
        reject(new Error(FS_NO_REPLY))
      }, FS_TIMEOUT_MS)
      this.pendingFs.set(opId, { agentId, timer, resolve, reject })
      this.send(agentId, make(opId))
    })
  }

  fsList(agentId: string, path: string): Promise<FsResult> {
    return this.runFs(agentId, (opId) => ({ t: 'fs.list', opId, path }))
  }
  fsRead(agentId: string, path: string): Promise<FsResult> {
    return this.runFs(agentId, (opId) => ({ t: 'fs.read', opId, path }))
  }
  fsWrite(agentId: string, path: string, dataBase64: string): Promise<FsResult> {
    return this.runFs(agentId, (opId) => ({ t: 'fs.write', opId, path, dataBase64 }))
  }
  fsDelete(agentId: string, path: string): Promise<FsResult> {
    return this.runFs(agentId, (opId) => ({ t: 'fs.delete', opId, path }))
  }
  fsRename(agentId: string, from: string, to: string): Promise<FsResult> {
    return this.runFs(agentId, (opId) => ({ t: 'fs.rename', opId, from, to }))
  }
  fsMkdir(agentId: string, path: string): Promise<FsResult> {
    return this.runFs(agentId, (opId) => ({ t: 'fs.mkdir', opId, path }))
  }

  // --- Живой PTY-терминал по машине (релей, БЕЗ накопления вывода) ---

  /** Открывает PTY на агенте; вывод/выход/ошибки уходят через emit клиенту. */
  ptyStart(
    agentId: string,
    ptyId: string,
    cols: number,
    rows: number,
    cwd: string | undefined,
    emit: (e: PtyEvent) => void
  ): void {
    const existing = this.ptys.get(ptyId)
    if (existing) {
      if (existing.agentId !== agentId) {
        emit({ t: 'pty.error', ptyId, message: 'Идентификатор уже занят другим сеансом' })
        return
      }
      // Переподписка после закрытия модалки или reconnect браузера: shell не стартуем снова.
      existing.emit = emit
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer)
        existing.idleTimer = null
      }
      for (const data of existing.output) emit({ t: 'pty.output', ptyId, data })
      this.ptyResize(ptyId, cols, rows)
      return
    }
    if (!this.online.has(agentId)) {
      emit({ t: 'pty.error', ptyId, message: 'Машина не в сети' })
      return
    }
    const ve = this.versionError(agentId, 'pty')
    if (ve) {
      emit({ t: 'pty.error', ptyId, message: ve.message })
      return
    }
    this.ptys.set(ptyId, { agentId, emit, output: [], outputBytes: 0, idleTimer: null })
    this.send(agentId, { t: 'pty.start', ptyId, cols, rows, ...(cwd ? { cwd } : {}) })
  }

  /** Ввод пользователя (нажатия клавиш) в PTY. */
  ptyInput(ptyId: string, data: string): void {
    const sess = this.ptys.get(ptyId)
    if (sess) this.send(sess.agentId, { t: 'pty.input', ptyId, data })
  }

  /** Изменение размеров терминала. */
  ptyResize(ptyId: string, cols: number, rows: number): void {
    const sess = this.ptys.get(ptyId)
    if (sess) this.send(sess.agentId, { t: 'pty.resize', ptyId, cols, rows })
  }

  /**
   * Снимает только браузерскую подписку; процесс на машине и его буфер остаются
   * живы `PTY_IDLE_TTL_MS`, чтобы к сеансу можно было вернуться. Не вернулись —
   * сеанс убивается по таймеру простоя.
   */
  ptyDetach(ptyId: string): void {
    const sess = this.ptys.get(ptyId)
    if (!sess || !sess.emit) return
    sess.emit = null
    if (sess.idleTimer) clearTimeout(sess.idleTimer)
    sess.idleTimer = setTimeout(() => this.ptyKill(ptyId), PTY_IDLE_TTL_MS)
    sess.idleTimer.unref?.()
  }

  private appendPtyOutput(sess: PtySession, data: string): void {
    sess.output.push(data)
    sess.outputBytes += Buffer.byteLength(data)
    while (sess.outputBytes > PTY_OUTPUT_CAP_BYTES && sess.output.length > 1) {
      const removed = sess.output.shift()
      if (removed) sess.outputBytes -= Buffer.byteLength(removed)
    }
  }

  /** Закрытие PTY-сессии: явное действие пользователя или таймер простоя. */
  ptyKill(ptyId: string): void {
    const sess = this.ptys.get(ptyId)
    if (!sess) return
    this.ptys.delete(ptyId)
    if (sess.idleTimer) clearTimeout(sess.idleTimer)
    this.send(sess.agentId, { t: 'pty.kill', ptyId })
  }

  /** Отменяет все незавершённые команды агента (напр., ход Claude прерван). */
  cancelAll(agentId: string): void {
    for (const [execId, p] of this.pending) {
      if (p.agentId !== agentId) continue
      this.pending.delete(execId)
      clearTimeout(p.timer)
      this.send(agentId, { t: 'exec.cancel', execId })
      p.reject(new Error('Команда отменена'))
    }
  }

  /** Обрабатывает сообщение от агента (exec.* и fs.result/fs.error). */
  handleMessage(agentId: string, msg: AgentToServer): void {
    if (msg.t === 'agent.register') return // повторная регистрация — игнор
    if (msg.t === 'agent.setPolicy') return // обрабатывается в wsAgent (нужен owner/БД)
    if (msg.t === 'agent.telemetry') {
      this.setTelemetry(agentId, msg.telemetry)
      return
    }
    if (msg.t === 'agent.imageHost') {
      this.setImageHost(agentId, msg.imageHost)
      return
    }
    if (msg.t === 'fs.result' || msg.t === 'fs.error') {
      const pf = this.pendingFs.get(msg.opId)
      if (!pf || pf.agentId !== agentId) return
      this.pendingFs.delete(msg.opId)
      clearTimeout(pf.timer)
      if (msg.t === 'fs.result') pf.resolve(msg.result)
      else pf.reject(new Error(msg.message))
      return
    }
    if (msg.t === 'pty.output' || msg.t === 'pty.exit' || msg.t === 'pty.error') {
      const sess = this.ptys.get(msg.ptyId)
      if (!sess || sess.agentId !== agentId) return
      if (msg.t === 'pty.output') {
        this.appendPtyOutput(sess, msg.data)
        sess.emit?.({ t: 'pty.output', ptyId: msg.ptyId, data: msg.data })
      } else if (msg.t === 'pty.exit') {
        this.ptys.delete(msg.ptyId)
        if (sess.idleTimer) clearTimeout(sess.idleTimer)
        sess.emit?.({ t: 'pty.exit', ptyId: msg.ptyId, exitCode: msg.exitCode })
      } else {
        this.ptys.delete(msg.ptyId)
        if (sess.idleTimer) clearTimeout(sess.idleTimer)
        sess.emit?.({ t: 'pty.error', ptyId: msg.ptyId, message: msg.message })
      }
      return
    }
    const p = this.pending.get(msg.execId)
    if (!p || p.agentId !== agentId) return
    switch (msg.t) {
      case 'exec.chunk': {
        if (p.onChunk) {
          // Стриминговый ран: чанк уходит в лог сразу, буфер не растёт.
          p.onChunk(msg.data)
          return
        }
        if (p.truncated) return
        p.bytes += Buffer.byteLength(msg.data)
        if (p.bytes > OUTPUT_CAP_BYTES) {
          p.truncated = true
          p.chunks.push('\n…[вывод обрезан]')
          return
        }
        p.chunks.push(msg.data)
        return
      }
      case 'exec.done': {
        this.pending.delete(msg.execId)
        clearTimeout(p.timer)
        p.resolve({
          exitCode: msg.exitCode,
          output: this.output(p),
          timedOut: msg.timedOut === true
        })
        return
      }
      case 'exec.error': {
        this.pending.delete(msg.execId)
        clearTimeout(p.timer)
        p.reject(new Error(msg.message))
        return
      }
    }
  }

  private output(p: PendingExec): string {
    return p.chunks.join('')
  }

  private send(agentId: string, msg: ServerToAgent): void {
    const agent = this.online.get(agentId)
    if (!agent) return
    try {
      agent.socket.send(JSON.stringify(msg))
    } catch {
      /* сокет умер — дисконнект придёт своим чередом */
    }
  }
}
