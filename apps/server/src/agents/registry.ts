// In-memory реестр подключённых машин-агентов и выполнение команд на них.
// Не зависит от ws: сокет — минимальный интерфейс {send, close} (тестируемо).

import { randomUUID } from 'node:crypto'
import type { AgentToServer, ServerToAgent } from '@voicechat/shared'

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

/** Кап буфера вывода одной команды — результат уходит в контекст модели. */
const OUTPUT_CAP_BYTES = 200 * 1024
/** Запас серверного страховочного таймаута сверх таймаута агента. */
const GUARD_EXTRA_MS = 10_000

interface PendingExec {
  agentId: string
  chunks: string[]
  bytes: number
  truncated: boolean
  timer: NodeJS.Timeout
  resolve(result: ExecResult): void
  reject(err: Error): void
}

interface OnlineAgent {
  name: string
  socket: AgentSocket
}

export class AgentRegistry {
  private readonly online = new Map<string, OnlineAgent>()
  private readonly pending = new Map<string, PendingExec>()
  private readonly newId: () => string

  constructor(deps: { newId?: () => string } = {}) {
    this.newId = deps.newId ?? (() => randomUUID())
  }

  register(agentId: string, name: string, socket: AgentSocket): void {
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
    this.online.set(agentId, { name, socket })
  }

  /** Убирает агента из онлайна и отклоняет все его незавершённые команды. */
  unregister(agentId: string): void {
    this.online.delete(agentId)
    for (const [execId, p] of this.pending) {
      if (p.agentId !== agentId) continue
      this.pending.delete(execId)
      clearTimeout(p.timer)
      p.reject(new Error('Машина отключилась во время выполнения команды'))
    }
  }

  isOnline(agentId: string): boolean {
    return this.online.has(agentId)
  }

  nameOf(agentId: string): string | undefined {
    return this.online.get(agentId)?.name
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
   */
  exec(agentId: string, command: string, timeoutMs: number): Promise<ExecResult> {
    const agent = this.online.get(agentId)
    if (!agent) return Promise.reject(new Error('Машина не в сети'))

    const execId = this.newId()
    return new Promise<ExecResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Агент не ответил даже со своим таймаутом — считаем команду зависшей.
        this.pending.delete(execId)
        this.send(agentId, { t: 'exec.cancel', execId })
        resolve({ exitCode: null, output: this.output(entryRef), timedOut: true })
      }, timeoutMs + GUARD_EXTRA_MS)
      const entryRef: PendingExec = {
        agentId,
        chunks: [],
        bytes: 0,
        truncated: false,
        timer,
        resolve,
        reject
      }
      this.pending.set(execId, entryRef)
      this.send(agentId, { t: 'exec.start', execId, command, timeoutMs })
    })
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

  /** Обрабатывает сообщение от агента (exec.chunk/done/error). */
  handleMessage(agentId: string, msg: AgentToServer): void {
    if (msg.t === 'agent.register') return // повторная регистрация — игнор
    const p = this.pending.get(msg.execId)
    if (!p || p.agentId !== agentId) return
    switch (msg.t) {
      case 'exec.chunk': {
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
