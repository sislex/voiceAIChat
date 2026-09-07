// `MachinesService` для ядра в режиме `VC_MACHINES_MODE=remote`: реестр живёт в отдельном процессе машин.
// Синхронные чтения (`isOnline`, `nameOf`, `policyOf`, `telemetryOf`, `ptyLive`, …) отвечает зеркало,
// которое процесс машин наполняет по постоянному WebSocket событий; вызовы — RPC и потоковый exec;
// события PTY приходят той же шиной и раздаются `emit`-подписчикам, зарегистрированным в `ptyStart`.
// Кадры владельцам (журнал команд, watchdog) процесс машин присылает сюда же — они уходят в шину кадров ядра.
import { WebSocket } from 'ws'
import type { AgentPolicy, ServerMessage } from '@voicechat/shared'
import { AgentFsError } from '../agents/registry.js'
import { execOverHttp } from '../internal/execStream.js'
import {
  MACHINES_INTERNAL_EVENTS_PATH, MACHINES_INTERNAL_EXEC_STREAM_PATH, MACHINES_INTERNAL_RPC_PATH,
  type MachineState, type MachinesClientMessage, type MachinesEvent, type MachinesRpcErrorBody, type MachinesSnapshot, type PtyState
} from '../machines/internal.js'
import type { MachineCommandReport, MachinesService, PtyEvent } from '../machines/service.js'

export interface HttpMachinesOptions {
  machinesUrl: string
  token: string
  /** Кадры владельцам машин — в шину кадров ядра. */
  publish: (message: ServerMessage, userId: string) => void
  fetchImpl?: typeof fetch
  log?: (level: 'info' | 'warn', message: string, extra?: Record<string, unknown>) => void
  /** Пауза перед переподключением шины событий. */
  reconnectMs?: number
}

/** Кап буфера вывода PTY на стороне ядра — как у реестра: хватает на восстановление экрана. */
const PTY_BUFFER_CAP_BYTES = 200 * 1024

class Listeners<T extends unknown[]> {
  private readonly set = new Set<(...args: T) => unknown>()
  add(cb: (...args: T) => unknown): () => void { this.set.add(cb); return () => { this.set.delete(cb) } }
  emit(...args: T): void { for (const cb of this.set) { try { void cb(...args) } catch { /* слушатель не должен ронять зеркало */ } } }
}

export class HttpMachines implements MachinesService {
  private machines = new Map<string, MachineState>()
  private ptys = new Map<string, PtyState>()
  private readonly ptyEmits = new Map<string, (e: PtyEvent) => void>()
  private readonly ptyBuffers = new Map<string, { chunks: string[]; bytes: number }>()
  private readonly changeListeners = new Listeners<[]>()
  private readonly readyListeners = new Listeners<[string]>()
  private readonly commandListeners = new Listeners<[MachineCommandReport]>()
  private readonly tunnelCallbacks = new Map<string, { authorize: () => Promise<boolean>; onClose?: () => Promise<void> }>()
  private readonly tunnelPorts = new Map<string, number>()
  private socket: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private stopped = false
  /** Когда пришёл последний снимок машин; null — шина ещё не подключалась. */
  connectedAt: number | null = null

  constructor(private readonly opts: HttpMachinesOptions) {}

  private log(level: 'info' | 'warn', message: string, extra?: Record<string, unknown>): void { this.opts.log?.(level, message, extra) }

  // --- шина событий ---

  /** Подключиться к шине событий процесса машин; переподключается сама, пока не вызван `stop`. */
  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.socket?.close()
    this.socket = null
  }

  private connect(): void {
    if (this.stopped) return
    const url = `${this.opts.machinesUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}${MACHINES_INTERNAL_EVENTS_PATH}`
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.opts.token}` } })
    this.socket = socket
    socket.on('open', () => { this.log('info', 'machines: шина событий подключена') })
    socket.on('message', (data: Buffer | string) => {
      let event: MachinesEvent
      try { event = JSON.parse(data.toString()) as MachinesEvent } catch { return }
      this.apply(event)
    })
    const retry = (): void => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.stopped || this.reconnectTimer) return
      this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect() }, this.opts.reconnectMs ?? 2_000)
      this.reconnectTimer.unref?.()
    }
    socket.on('close', () => { this.log('warn', 'machines: шина событий закрыта — машины считаются offline до переподключения'); this.applyMachines([]); retry() })
    socket.on('error', (error) => { this.log('warn', 'machines: ошибка шины событий', { err: error }) })
  }

  private send(message: MachinesClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  /** Применить событие процесса машин (публично — для тестов и повторного использования транспорта). */
  apply(event: MachinesEvent): void {
    switch (event.kind) {
      case 'machines': this.applyMachines(event.machines); break
      case 'ptys': this.ptys = new Map(event.ptys.map((p) => [p.ptyId, p])); for (const id of this.ptyBuffers.keys()) if (!this.ptys.has(id)) this.ptyBuffers.delete(id); break
      case 'pty': {
        const { ptyId } = event.event
        if (event.event.t === 'pty.output') this.appendPtyOutput(ptyId, event.event.data)
        else { this.ptys.delete(ptyId); this.ptyBuffers.delete(ptyId) }
        const emit = this.ptyEmits.get(ptyId)
        if (event.event.t !== 'pty.output') this.ptyEmits.delete(ptyId)
        try { emit?.(event.event) } catch { /* подписчик не должен ронять шину */ }
        break
      }
      case 'frame': this.opts.publish(event.message, event.userId); break
      case 'agentReady': this.readyListeners.emit(event.agentId); break
      case 'command': this.commandListeners.emit(event.report); break
      case 'tunnelAuthorize': {
        // Отвечаем только за свои тоннели: к шине могут быть подключены и другие процессы (админка), чужой отказ не должен опережать наш ответ.
        const cb = this.tunnelCallbacks.get(event.id)
        if (cb) void cb.authorize().catch(() => false).then((ok) => this.send({ kind: 'tunnelAuthorizeResult', requestId: event.requestId, ok }))
        break
      }
      case 'tunnelClosed': {
        const cb = this.tunnelCallbacks.get(event.id)
        this.tunnelCallbacks.delete(event.id)
        this.tunnelPorts.delete(event.id)
        void cb?.onClose?.()
        break
      }
    }
  }

  private applyMachines(list: MachineState[]): void {
    this.machines = new Map(list.map((m) => [m.id, m]))
    this.connectedAt = Date.now()
    this.changeListeners.emit()
  }

  private appendPtyOutput(ptyId: string, data: string): void {
    const buf = this.ptyBuffers.get(ptyId) ?? { chunks: [], bytes: 0 }
    buf.chunks.push(data)
    buf.bytes += Buffer.byteLength(data)
    while (buf.bytes > PTY_BUFFER_CAP_BYTES && buf.chunks.length > 1) buf.bytes -= Buffer.byteLength(buf.chunks.shift()!)
    this.ptyBuffers.set(ptyId, buf)
  }

  // --- RPC ---

  private async rpc<T>(method: string, args: unknown[], timeoutMs = 15_000): Promise<T> {
    let end = args.length
    while (end > 0 && args[end - 1] === undefined) end--
    const fetchImpl = this.opts.fetchImpl ?? fetch
    const res = await fetchImpl(`${this.opts.machinesUrl.replace(/\/+$/, '')}${MACHINES_INTERNAL_RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.token}` },
      body: JSON.stringify({ method, args: args.slice(0, end) }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { result: unknown } | MachinesRpcErrorBody
    if (!res.ok || 'error' in body) {
      const err = 'error' in body ? body : { error: `HTTP ${res.status}` }
      throw err.code ? new AgentFsError(err.error, err.code) : new Error(err.error)
    }
    return body.result as T
  }
  /** Долгие вызовы: файлы и git ждут возврата офлайн-машины, подтверждение тоннеля — человека. */
  private slow<T>(method: string, ...args: unknown[]): Promise<T> { return this.rpc<T>(method, args, 10 * 60_000) }
  private fire(method: string, ...args: unknown[]): void { void this.rpc(method, args).catch((error) => this.log('warn', `machines: ${method} не доставлен`, { err: error })) }

  // --- состояние (зеркало) ---
  isOnline(agentId: string): boolean { return this.machines.has(agentId) }
  onlineIds(): Set<string> { return new Set(this.machines.keys()) }
  nameOf(agentId: string): string | undefined { return this.machines.get(agentId)?.name }
  versionOf(agentId: string): string | undefined { return this.machines.get(agentId)?.version }
  platformOf(agentId: string): string | undefined { return this.machines.get(agentId)?.platform ?? this.machines.get(agentId)?.telemetry?.os.platform }
  policyOf(agentId: string): AgentPolicy | undefined { return this.machines.get(agentId)?.policy }
  telemetryOf(agentId: string) { return this.machines.get(agentId)?.telemetry }
  imageHostOf(agentId: string) { return this.machines.get(agentId)?.imageHost }
  waitForOnline(agentId: string, timeoutMs?: number): Promise<boolean> {
    if (this.machines.has(agentId)) return Promise.resolve(true)
    return this.slow<boolean>('waitForOnline', agentId, timeoutMs)
  }
  updatePolicy(agentId: string, policy: AgentPolicy): void { this.fire('updatePolicy', agentId, policy) }
  disconnect(agentId: string): void { this.fire('disconnect', agentId) }

  // --- события ---
  onChange(cb: () => void): () => void { return this.changeListeners.add(cb) }
  onAgentReady(cb: (agentId: string) => Promise<void>): () => void { return this.readyListeners.add(cb) }
  onCommand(cb: (rec: MachineCommandReport) => Promise<void>): () => void { return this.commandListeners.add(cb) }

  // --- команды и файлы ---
  private get stream() { return { baseUrl: this.opts.machinesUrl, token: this.opts.token, path: MACHINES_INTERNAL_EXEC_STREAM_PATH } }
  exec(agentId: string, command: string, timeoutMs: number, signal?: AbortSignal, meta?: Parameters<MachinesService['exec']>[4]) {
    return execOverHttp(this.stream, { agentId, command, timeoutMs, stream: false, ...(meta ? { meta } : {}) }, undefined, signal)
  }
  execStream(agentId: string, command: string, timeoutMs: number, onChunk: (data: string) => void, signal?: AbortSignal) {
    return execOverHttp(this.stream, { agentId, command, timeoutMs, stream: true }, onChunk, signal)
  }
  cancelAll(agentId: string): void { this.fire('cancelAll', agentId) }
  gitAccess(agentId: string, request: Parameters<MachinesService['gitAccess']>[1]) { return this.slow<Awaited<ReturnType<MachinesService['gitAccess']>>>('gitAccess', agentId, request) }
  fsList(agentId: string, path: string) { return this.slow<Awaited<ReturnType<MachinesService['fsList']>>>('fsList', agentId, path) }
  fsRead(agentId: string, path: string) { return this.slow<Awaited<ReturnType<MachinesService['fsRead']>>>('fsRead', agentId, path) }
  fsWrite(agentId: string, path: string, dataBase64: string) { return this.slow<Awaited<ReturnType<MachinesService['fsWrite']>>>('fsWrite', agentId, path, dataBase64) }
  fsMkdir(agentId: string, path: string) { return this.slow<Awaited<ReturnType<MachinesService['fsMkdir']>>>('fsMkdir', agentId, path) }
  fsDelete(agentId: string, path: string) { return this.slow<Awaited<ReturnType<MachinesService['fsDelete']>>>('fsDelete', agentId, path) }
  fsDeleteFileSafe(agentId: string, path: string) { return this.slow<Awaited<ReturnType<MachinesService['fsDeleteFileSafe']>>>('fsDeleteFileSafe', agentId, path) }
  fsTrash(agentId: string, path: string) { return this.slow<Awaited<ReturnType<MachinesService['fsTrash']>>>('fsTrash', agentId, path) }
  fsRename(agentId: string, from: string, to: string) { return this.slow<Awaited<ReturnType<MachinesService['fsRename']>>>('fsRename', agentId, from, to) }
  http(agentId: string, request: Parameters<MachinesService['http']>[1]) { return this.rpc<Awaited<ReturnType<MachinesService['http']>>>('http', [agentId, request], 30_000) }

  // --- PTY ---
  ptyStart(agentId: string, ptyId: string, cols: number, rows: number, cwd: string | undefined, emit: (e: PtyEvent) => void): void {
    this.ptyEmits.set(ptyId, emit)
    // Оптимистично считаем сессию живой до снимка от процесса машин: `ptyLive` спрашивают сразу после старта.
    if (!this.ptys.has(ptyId)) this.ptys.set(ptyId, { ptyId, agentId, context: null })
    void this.rpc('ptyStart', [agentId, ptyId, cols, rows, cwd]).catch((error) => {
      this.ptyEmits.delete(ptyId)
      this.ptys.delete(ptyId)
      emit({ t: 'pty.error', ptyId, message: error instanceof Error ? error.message : String(error) })
    })
  }
  ptyInput(ptyId: string, data: string): void { this.fire('ptyInput', ptyId, data) }
  ptyResize(ptyId: string, cols: number, rows: number): void { this.fire('ptyResize', ptyId, cols, rows) }
  ptyDetach(ptyId: string): void { this.ptyEmits.delete(ptyId); this.fire('ptyDetach', ptyId) }
  ptyKill(ptyId: string): void { this.ptyEmits.delete(ptyId); this.ptys.delete(ptyId); this.ptyBuffers.delete(ptyId); this.fire('ptyKill', ptyId) }
  ptyLive(ptyId: string): boolean { return this.ptys.has(ptyId) }
  /** Буфер вывода, увиденный этим ядром с момента подписки (процесс машин хранит полный). */
  ptyBufferText(ptyId: string): string | null { const buf = this.ptyBuffers.get(ptyId); return buf ? buf.chunks.join('') : (this.ptys.has(ptyId) ? '' : null) }
  ptyContextOf(ptyId: string) { return this.ptys.get(ptyId)?.context ?? null }

  // --- тоннели ---
  async createTunnel(id: string, sourceAgentId: string, targetAgentId: string, targetPort: number, authorize?: () => Promise<boolean>, onClose?: () => Promise<void>): Promise<number> {
    this.tunnelCallbacks.set(id, { authorize: authorize ?? (async () => true), ...(onClose ? { onClose } : {}) })
    try {
      const port = await this.slow<number>('createTunnel', id, sourceAgentId, targetAgentId, targetPort)
      this.tunnelPorts.set(id, port)
      return port
    } catch (error) { this.tunnelCallbacks.delete(id); throw error }
  }
  tunnelPort(id: string): number | null { return this.tunnelPorts.get(id) ?? null }
  closeTunnel(id: string): Promise<boolean> { this.tunnelPorts.delete(id); return this.rpc<boolean>('closeTunnel', [id]) }
  closeTunnelsForTarget(agentId: string): void { this.fire('closeTunnelsForTarget', agentId) }

  /** Полный снимок процесса машин (первичное заполнение зеркала до подключения шины). */
  async loadSnapshot(): Promise<void> {
    const snapshot = await this.rpc<MachinesSnapshot>('snapshot', [])
    this.ptys = new Map(snapshot.ptys.map((p) => [p.ptyId, p]))
    this.applyMachines(snapshot.machines)
  }
}
