// Сырой ран CLI: spawn + построчная перекачка stdout/stderr в NDJSON-кадры.
//
// Главное свойство — исполнитель НЕ разбирает вывод. stream-json Claude и JSONL
// Codex парсит сервер (`packages/shared`), иначе протокол пришлось бы менять при
// каждом изменении формата CLI, а исполнитель — переразворачивать вместе с сервером.
//
// Второе свойство — ран не переживает своего клиента. Обрыв соединения гасит CLI
// сразу, а «клиент жив, но поток не читает» — по таймауту сироты: иначе брошенный
// ход сервера жёг бы токены подписки до конца своего разговора с моделью.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import type { LlmRunBody, LlmRunFrame, LlmRunKind } from '@voicechat/shared'
import { killCliChild } from '../cli/childKill.js'
import { claudeArgs, type SpawnFn } from '../cli/claudeCli.js'
import { cliProfileEnv } from '../cli/cliProfiles.js'
import { codexInvocation } from '../cli/codexCli.js'
import { prepareLlmAttachments } from '../cli/attachments.js'

/**
 * Приёмник кадров рана. Абстракция над `http.ServerResponse`: тест подсовывает
 * свой приёмник и проверяет сироту, не поднимая сокет с застрявшим чтением.
 */
export interface RunSink {
  /** Отдать кадр. `false` — данные легли в буфер: клиент их не читает. */
  write(chunk: string): boolean
  /** Клиент вычитал буфер. */
  onDrain(cb: () => void): void
  /** Соединение закрыто (клиент ушёл или упал). */
  onClose(cb: () => void): void
  end(): void
}

export interface RunManagerOptions {
  /** Инъекция spawn (в тестах — фейковый процесс, реальный CLI не запускается). */
  spawn?: SpawnFn
  claudeBin?: string
  codexBin?: string
  /** Изолированный HOME владельца запроса (профиль CLI). */
  profileHome?: (userId: string) => string
  /** Таймаут сироты; 0 — не следить (для тестов, которым это мешает). */
  orphanMs?: number
  /** Keep the HTTP body alive while the CLI is silent; 0 disables it in tests. */
  heartbeatMs?: number
  /** Диагностика (по умолчанию — stderr процесса). */
  log?: (message: string) => void
}

export const DEFAULT_ORPHAN_MS = 30_000
export const DEFAULT_HEARTBEAT_MS = 15_000

/**
 * Сколько ждём хвост stdout/stderr после выхода процесса. Обычно потоки
 * закрываются раньше, но если их держит открытыми внук CLI — кадр `exit` всё
 * равно должен уйти, иначе ход на сервере повиснет навсегда.
 */
export const STREAM_FLUSH_GRACE_MS = 2_000

interface ActiveRun {
  child: ChildProcess
  /** Погасить CLI (SIGTERM → SIGKILL). */
  kill(): void
}

function usableCwd(cwd: string | undefined): string | undefined {
  return cwd && existsSync(cwd) ? cwd : undefined
}

export class CodexThreadInUseError extends Error {
  readonly code = 'codex_thread_in_use'

  constructor() {
    super('Codex thread уже выполняется')
    this.name = 'CodexThreadInUseError'
  }
}

/** Реестр живых ранов: запуск, отмена по id, счётчик для health. */
export class RunManager {
  private readonly runs = new Map<string, ActiveRun>()
  /** Codex resume lease key → owning runId. */
  private readonly codexThreadLeases = new Map<string, string>()

  constructor(private readonly opts: RunManagerOptions = {}) {}

  /** Сколько ранов исполняется прямо сейчас. */
  get size(): number {
    return this.runs.size
  }

  /** Занят ли id: повторный запуск под тем же id сделал бы первый CLI неубиваемым. */
  has(id: string): boolean {
    return this.runs.has(id)
  }

  /**
   * Atomically reserves a resumed Codex thread before attachments or spawn are prepared.
   * Repeating the reservation for its owner is safe, which lets the HTTP route reserve
   * before opening the NDJSON response and `start` enforce the same invariant directly.
   */
  reserveCodexThread(body: LlmRunBody): boolean {
    const key = this.codexThreadKey(body)
    if (!key) return true
    const id = body.runId || ''
    const owner = this.codexThreadLeases.get(key)
    if (owner !== undefined) return owner === id
    this.codexThreadLeases.set(key, id)
    return true
  }

  private codexThreadKey(body: LlmRunBody): string | undefined {
    if (body.kind !== 'codex' || !body.sessionId) return undefined
    return JSON.stringify([body.userId || '', body.sessionId])
  }

  private releaseCodexThread(body: LlmRunBody, id: string): void {
    const key = this.codexThreadKey(body)
    if (key && this.codexThreadLeases.get(key) === id) this.codexThreadLeases.delete(key)
  }

  private log(message: string): void {
    ;(this.opts.log ?? ((m: string) => console.warn(`[llm-runner] ${m}`)))(message)
  }

  /**
   * Запускает CLI по запросу и льёт его вывод в `sink` кадрами NDJSON.
   * Возвращает id рана — им же адресуется `DELETE /v1/run/:id`.
   */
  start(body: LlmRunBody, sink: RunSink): string {
    const id = body.runId || randomUUID()
    const reservedBody = body.runId ? body : { ...body, runId: id }
    if (!this.reserveCodexThread(reservedBody)) {
      throw new CodexThreadInUseError()
    }
    const kind: LlmRunKind = body.kind === 'codex' ? 'codex' : 'claude'
    let prepared: ReturnType<typeof prepareLlmAttachments<LlmRunBody>>
    try {
      prepared = prepareLlmAttachments(reservedBody)
    } catch (err) {
      this.releaseCodexThread(reservedBody, id)
      throw err
    }
    let cleaned = false
    const cleanup = (): void => {
      if (cleaned) return
      cleaned = true
      prepared.cleanup()
      this.releaseCodexThread(reservedBody, id)
    }
    const cwd = usableCwd(prepared.request.cwd)
    const runBody: LlmRunBody = {
      ...prepared.request,
      ...(cwd ? { cwd } : { cwd: undefined })
    }
    const invocation =
      kind === 'codex'
        ? codexInvocation(runBody)
        : { args: claudeArgs(runBody), prompt: null as string | null }
    const bin = kind === 'codex' ? this.opts.codexBin ?? 'codex' : this.opts.claudeBin ?? 'claude'
    const orphanMs = this.opts.orphanMs ?? DEFAULT_ORPHAN_MS

    let closed = false
    const frame = (f: LlmRunFrame): boolean => (closed ? false : sink.write(JSON.stringify(f) + '\n'))

    let child: ChildProcess
    try {
      const home = runBody.userId ? this.opts.profileHome?.(runBody.userId) : undefined
      const spawnFn = this.opts.spawn ?? (nodeSpawn as unknown as SpawnFn)
      const options =
        runBody.cwd || home
          ? { ...(runBody.cwd ? { cwd: runBody.cwd } : {}), ...(home ? { env: cliProfileEnv(home) } : {}) }
          : undefined
      child = spawnFn(bin, invocation.args, options)
    } catch (err) {
      cleanup()
      // Текст ошибки в человеческий вид переводит сервер: у него есть контекст хода.
      frame({ t: 'err', s: err instanceof Error ? err.message : String(err) })
      frame({ t: 'exit', code: null })
      closed = true
      sink.end()
      return id
    }

    let heartbeatTimer: NodeJS.Timeout | undefined
    const stopHeartbeat = (): void => {
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
    }
    let orphanTimer: NodeJS.Timeout | undefined
    const disarm = (): void => {
      if (!orphanTimer) return
      clearTimeout(orphanTimer)
      orphanTimer = undefined
    }
    const finish = (code: number | null): void => {
      if (closed) return
      frame({ t: 'exit', code })
      closed = true
      stopHeartbeat()
      disarm()
      this.runs.delete(id)
      cleanup()
      sink.end()
    }
    const abandon = (reason: string): void => {
      if (closed) return
      closed = true
      stopHeartbeat()
      disarm()
      this.runs.delete(id)
      cleanup()
      this.log(`ран ${id} (${kind}): ${reason} — гасим CLI`)
      killCliChild(child)
      sink.end()
    }
    const arm = (): void => {
      if (orphanTimer || closed || orphanMs <= 0) return
      orphanTimer = setTimeout(() => abandon(`поток никто не читает ${orphanMs} мс`), orphanMs)
      orphanTimer.unref?.()
    }

    this.runs.set(id, { child, kill: () => void killCliChild(child) })
    sink.onDrain(disarm)
    sink.onClose(() => abandon('клиент отключился'))

    const send = (f: LlmRunFrame): void => {
      if (frame(f)) disarm()
      else arm()
    }

    // Blank NDJSON lines are ignored by existing clients and never become model output.
    // Do not keep filling a blocked socket or reset its orphan deadline with heartbeats.
    const heartbeatMs = this.opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
    if (heartbeatMs > 0) {
      heartbeatTimer = setInterval(() => {
        if (closed || orphanTimer) return
        if (!sink.write('\n')) arm()
      }, heartbeatMs)
      heartbeatTimer.unref?.()
    }

    child.on('error', (err) => {
      send({ t: 'err', s: err instanceof Error ? err.message : String(err) })
      finish(null)
    })

    if (invocation.prompt !== null) {
      try {
        child.stdin?.end(invocation.prompt)
      } catch {
        /* stdin недоступен — CLI сам ответит ошибкой */
      }
    }

    let openStreams = 0
    let exitCode: number | null = null
    let exited = false
    const streamClosed = (): void => {
      openStreams -= 1
      if (exited && openStreams === 0) finish(exitCode)
    }
    const pipe = (stream: Readable | null | undefined, t: 'out' | 'err'): void => {
      if (!stream) return
      openStreams += 1
      const rl = createInterface({ input: stream })
      rl.on('line', (s) => send({ t, s }))
      rl.on('close', streamClosed)
    }
    pipe(child.stdout, 'out')
    pipe(child.stderr, 'err')

    child.on('close', (code) => {
      exited = true
      exitCode = code
      this.runs.delete(id)
      if (openStreams === 0) {
        finish(code)
        return
      }
      const grace = setTimeout(() => finish(code), STREAM_FLUSH_GRACE_MS)
      grace.unref?.()
    })

    return id
  }

  /**
   * Отмена рана: SIGTERM → SIGKILL. Повторный вызов безопасен — `false` значит
   * «такого рана уже нет» (успел завершиться сам), а не ошибку.
   */
  cancel(id: string): boolean {
    const run = this.runs.get(id)
    if (!run) return false
    run.kill()
    return true
  }

  /** Гасит все раны (остановка процесса исполнителя). */
  cancelAll(): void {
    for (const id of [...this.runs.keys()]) this.cancel(id)
  }
}
