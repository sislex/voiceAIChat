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
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import type { LlmRunBody, LlmRunFrame, LlmRunKind } from '@voicechat/shared'
import { killCliChild } from '../cli/childKill.js'
import { claudeArgs, type SpawnFn } from '../cli/claudeCli.js'
import { cliProfileEnv } from '../cli/cliProfiles.js'
import { codexInvocation } from '../cli/codexCli.js'

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
  /** Диагностика (по умолчанию — stderr процесса). */
  log?: (message: string) => void
}

export const DEFAULT_ORPHAN_MS = 30_000

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

/** Реестр живых ранов: запуск, отмена по id, счётчик для health. */
export class RunManager {
  private readonly runs = new Map<string, ActiveRun>()

  constructor(private readonly opts: RunManagerOptions = {}) {}

  /** Сколько ранов исполняется прямо сейчас. */
  get size(): number {
    return this.runs.size
  }

  /** Занят ли id: повторный запуск под тем же id сделал бы первый CLI неубиваемым. */
  has(id: string): boolean {
    return this.runs.has(id)
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
    const kind: LlmRunKind = body.kind === 'codex' ? 'codex' : 'claude'
    const invocation =
      kind === 'codex'
        ? codexInvocation(body)
        : { args: claudeArgs(body), prompt: null as string | null }
    const bin = kind === 'codex' ? this.opts.codexBin ?? 'codex' : this.opts.claudeBin ?? 'claude'
    const orphanMs = this.opts.orphanMs ?? DEFAULT_ORPHAN_MS

    let closed = false
    const frame = (f: LlmRunFrame): boolean => (closed ? false : sink.write(JSON.stringify(f) + '\n'))

    let child: ChildProcess
    try {
      const home = body.userId ? this.opts.profileHome?.(body.userId) : undefined
      const spawnFn = this.opts.spawn ?? (nodeSpawn as unknown as SpawnFn)
      const options =
        body.cwd || home
          ? { ...(body.cwd ? { cwd: body.cwd } : {}), ...(home ? { env: cliProfileEnv(home) } : {}) }
          : undefined
      child = spawnFn(bin, invocation.args, options)
    } catch (err) {
      // Текст ошибки в человеческий вид переводит сервер: у него есть контекст хода.
      frame({ t: 'err', s: err instanceof Error ? err.message : String(err) })
      frame({ t: 'exit', code: null })
      closed = true
      sink.end()
      return id
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
      disarm()
      this.runs.delete(id)
      sink.end()
    }
    const abandon = (reason: string): void => {
      if (closed) return
      closed = true
      disarm()
      this.runs.delete(id)
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
      // Буфер не ушёл клиенту — включаем часы сироты; ушёл — выключаем.
      if (frame(f)) disarm()
      else arm()
    }

    child.on('error', (err) => {
      send({ t: 'err', s: err instanceof Error ? err.message : String(err) })
      finish(null)
    })

    // Промпт codex всегда идёт через stdin: полный контекст со схемами tools
    // легко превышает ARG_MAX (spawn E2BIG).
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
      // Построчно и сразу: буферизовать вывод нельзя — сервер стримит эти строки
      // дальше в браузер как дельты ответа.
      rl.on('line', (s) => send({ t, s }))
      rl.on('close', streamClosed)
    }
    pipe(child.stdout, 'out')
    pipe(child.stderr, 'err')

    child.on('close', (code) => {
      exited = true
      exitCode = code
      // Процесса больше нет — отменять нечего, даже если хвост stdout ещё течёт.
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
