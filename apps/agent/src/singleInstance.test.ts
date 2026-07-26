import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireInstanceLock, lockPath, releaseLock } from './singleInstance.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vc-lock-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Никого живого — удобно для проверки «протухшей» блокировки. */
const nobodyAlive = () => false
const everyoneAlive = () => true
const noSleep = (): void => {}

describe('lockPath', () => {
  it('имя зависит от токена, но самого токена не содержит', () => {
    const p = lockPath('секретный-токен-123', dir)
    expect(p.startsWith(dir)).toBe(true)
    expect(p).not.toContain('секретный-токен-123')
    expect(p).toBe(lockPath('секретный-токен-123', dir))
  })

  it('разные токены — разные файлы (две машины на одном хосте разрешены)', () => {
    expect(lockPath('a', dir)).not.toBe(lockPath('b', dir))
  })
})

describe('acquireInstanceLock', () => {
  it('первый агент занимает блокировку и пишет туда свой pid', () => {
    const res = acquireInstanceLock('tok', { dir, pid: 111 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(readFileSync(res.path, 'utf8')).toBe('111')
  })

  it('второй агент при живом первом не запускается', () => {
    acquireInstanceLock('tok', { dir, pid: 111, isAlive: everyoneAlive })
    const second = acquireInstanceLock('tok', {
      dir,
      pid: 222,
      isAlive: everyoneAlive,
      sleep: noSleep,
      waitMs: 0
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.heldByPid).toBe(111)
  })

  it('протухшая блокировка (владелец мёртв) забирается', () => {
    acquireInstanceLock('tok', { dir, pid: 111 })
    const second = acquireInstanceLock('tok', { dir, pid: 222, isAlive: nobodyAlive })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(readFileSync(second.path, 'utf8')).toBe('222')
  })

  it('мусор в файле считается протухшей блокировкой', () => {
    const p = lockPath('tok', dir)
    writeFileSync(p, 'не число')
    const res = acquireInstanceLock('tok', { dir, pid: 222, isAlive: everyoneAlive })
    expect(res.ok).toBe(true)
  })

  it('повторный вызов из того же процесса не блокирует сам себя', () => {
    acquireInstanceLock('tok', { dir, pid: 111, isAlive: everyoneAlive })
    const again = acquireInstanceLock('tok', { dir, pid: 111, isAlive: everyoneAlive })
    expect(again.ok).toBe(true)
  })

  it('ждёт освобождения: при обновлении новый агент стартует раньше, чем ушёл старый', () => {
    acquireInstanceLock('tok', { dir, pid: 111 })
    let alive = true
    const sleeps: number[] = []
    const res = acquireInstanceLock('tok', {
      dir,
      pid: 222,
      // Старый агент «умирает» после первой паузы.
      isAlive: () => alive,
      sleep: (ms) => {
        sleeps.push(ms)
        alive = false
      },
      waitMs: 1000
    })
    expect(sleeps.length).toBeGreaterThan(0) // подождали, а не сдались сразу
    expect(res.ok).toBe(true)
  })

  it('сдаётся по истечении ожидания, а не висит вечно', () => {
    acquireInstanceLock('tok', { dir, pid: 111 })
    let slept = 0
    const res = acquireInstanceLock('tok', {
      dir,
      pid: 222,
      isAlive: everyoneAlive,
      sleep: () => (slept += 1),
      waitMs: 1000
    })
    expect(res.ok).toBe(false)
    expect(slept).toBeGreaterThan(0)
    expect(slept).toBeLessThan(100) // ожидание конечно
  })

  it('EPERM (процесс чужой) считается живым — лучше не запускаться', () => {
    acquireInstanceLock('tok', { dir, pid: 111 })
    const res = acquireInstanceLock('tok', {
      dir,
      pid: 222,
      isAlive: () => true,
      sleep: noSleep,
      waitMs: 0
    })
    expect(res.ok).toBe(false)
  })
})

describe('releaseLock', () => {
  it('снимает свою блокировку', () => {
    const res = acquireInstanceLock('tok', { dir, pid: 111 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    res.release()
    expect(existsSync(res.path)).toBe(false)
  })

  it('чужую блокировку не трогает', () => {
    const p = lockPath('tok', dir)
    writeFileSync(p, '999')
    releaseLock(p, 111)
    expect(readFileSync(p, 'utf8')).toBe('999')
  })

  it('повторный release не падает', () => {
    const res = acquireInstanceLock('tok', { dir, pid: 111 })
    if (!res.ok) return
    res.release()
    expect(() => res.release()).not.toThrow()
  })

  it('после release место свободно для следующего агента', () => {
    const first = acquireInstanceLock('tok', { dir, pid: 111 })
    if (!first.ok) return
    first.release()
    const second = acquireInstanceLock('tok', { dir, pid: 222, isAlive: everyoneAlive })
    expect(second.ok).toBe(true)
  })
})
