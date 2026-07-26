// Единственность агента на машине.
//
// Два агента с одним токеном — худший из отказов: каждая регистрация вытесняет
// предыдущее соединение, вытесненный переподключается и вытесняет обратно. Машина
// при этом выглядит онлайн, а команды уходят то в один процесс, то в другой.
// Раньше от этого защищал только установщик; теперь отказывается сам агент.
//
// Механизм — pid-файл, создаваемый атомарно (флаг 'wx'). Почему не flock: он
// требует нативной зависимости, а агент бандлится в один .cjs и работает в Termux.
// Плата за pid-файл — «протухшая» блокировка после падения процесса, поэтому
// живость владельца проверяется явно (`kill(pid, 0)`).
//
// Ключ блокировки — ТОКЕН машины, а не каталог: та же машина, поставленная дважды
// в разные каталоги (ровно этот случай и ловили вживую), обязана конфликтовать.
// Два агента с разными токенами на одном хосте при этом разрешены.

import { createHash } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface LockDeps {
  /** Каталог для файла блокировки (по умолчанию os.tmpdir()). */
  dir?: string
  /** Свой pid (для тестов). */
  pid?: number
  /** Жив ли процесс (по умолчанию process.kill(pid, 0)). */
  isAlive?: (pid: number) => boolean
  /** Пауза между попытками (по умолчанию сон через Atomics.wait). */
  sleep?: (ms: number) => void
  /** Сколько ждать освобождения (по умолчанию WAIT_MS). */
  waitMs?: number
}

/**
 * Сколько ждём, пока уйдёт предыдущий агент. Нужно из-за обновления: переключатель
 * гасит старый процесс и сразу поднимает новый, и тот может успеть увидеть ещё
 * живого предшественника. Без ожидания обновление оставило бы машину без агента.
 */
export const WAIT_MS = 10_000
const POLL_MS = 250

export type LockResult =
  | { ok: true; path: string; release: () => void }
  | { ok: false; path: string; heldByPid: number }

/** Путь файла блокировки: имя — от хеша токена, сам токен на диск не попадает. */
export function lockPath(token: string, dir: string = tmpdir()): string {
  const key = createHash('sha256').update(token).digest('hex').slice(0, 16)
  return join(dir, `voicechat-agent-${key}.lock`)
}

/** Блокирующий сон без зависимостей (агент на старте всё равно ничего не делает). */
function sleepSync(ms: number): void {
  const shared = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(shared, 0, 0, ms)
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM — процесс есть, но чужой: считаем живым (лучше не запускаться).
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

/** pid из файла блокировки; null — файла нет или он мусорный (значит протух). */
function readHolder(path: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(path, 'utf8').trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * Пытается занять блокировку под этот токен. Возвращает `ok: false`, если другой
 * живой агент уже работает, — вызывающий должен спокойно выйти, а не падать.
 */
export function acquireInstanceLock(token: string, deps: LockDeps = {}): LockResult {
  const path = lockPath(token, deps.dir)
  const myPid = deps.pid ?? process.pid
  const isAlive = deps.isAlive ?? defaultIsAlive
  const sleep = deps.sleep ?? sleepSync
  const waitMs = deps.waitMs ?? WAIT_MS

  const deadline = waitMs
  let waited = 0
  for (;;) {
    try {
      // 'wx' — создать или упасть: атомарно, без гонки «проверил-записал».
      writeFileSync(path, String(myPid), { flag: 'wx' })
      return { ok: true, path, release: () => releaseLock(path, myPid) }
    } catch {
      const holder = readHolder(path)
      if (holder === null || holder === myPid || !isAlive(holder)) {
        // Владельца нет, он это мы, или он умер, не убрав файл — забираем.
        try {
          writeFileSync(path, String(myPid))
        } catch {
          return { ok: false, path, heldByPid: holder ?? 0 }
        }
        // Гонка двух стартующих агентов: победил тот, чей pid остался в файле.
        if (readHolder(path) !== myPid) continue
        return { ok: true, path, release: () => releaseLock(path, myPid) }
      }
      if (waited >= deadline) return { ok: false, path, heldByPid: holder }
      sleep(POLL_MS)
      waited += POLL_MS
    }
  }
}

/** Снимает блокировку, только если она всё ещё наша (чужую не трогаем). */
export function releaseLock(path: string, myPid: number): void {
  if (readHolder(path) !== myPid) return
  try {
    rmSync(path, { force: true })
  } catch {
    /* файл уже убрали — не мешаем выходу */
  }
}
