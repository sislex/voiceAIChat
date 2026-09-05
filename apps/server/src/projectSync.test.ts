// Повтор синхронизации общей копии с origin. Ошибка «Синхронизация с origin
// завершилась по таймауту» роняла подготовку целиком, и автопроход вставал до
// ручного «Повторить» — здесь зафиксировано, что именно повторяется, а что нет.

import { describe, it, expect } from 'vitest'
import { syncProjectWithRetry, type ProjectSyncExecResult } from './projectSync.js'

const SHA = 'a'.repeat(40)
const ok = (extra = ''): ProjectSyncExecResult => ({ exitCode: 0, output: `${extra}BASE_SHA=${SHA}\n`, timedOut: false })
const timeout = (): ProjectSyncExecResult => ({ exitCode: null, output: '', timedOut: true })
const noSleep = async (): Promise<void> => {}

describe('синхронизация проекта с origin', () => {
  it('возвращает SHA и строку автолечения с первой попытки', async () => {
    const result = await syncProjectWithRetry(async () => ok('AUTOHEAL=копия возвращена на main\n'), { sleep: noSleep })
    expect(result.baseSha).toBe(SHA)
    expect(result.autoHealed).toBe('копия возвращена на main')
  })

  it('повторяет таймаут и отдаёт результат следующей успешной попытки', async () => {
    const results = [timeout(), timeout(), ok()]
    let calls = 0
    const result = await syncProjectWithRetry(async () => results[calls++]!, { sleep: noSleep })
    expect(calls).toBe(3)
    expect(result.baseSha).toBe(SHA)
  })

  it('после исчерпания попыток отдаёт ошибку таймаута', async () => {
    let calls = 0
    await expect(syncProjectWithRetry(async () => { calls++; return timeout() }, { attempts: 2, sleep: noSleep }))
      .rejects.toThrow(/по таймауту/)
    expect(calls).toBe(2)
  })

  it('повторяет недоступную машину: агент успевает переподключиться', async () => {
    let calls = 0
    const result = await syncProjectWithRetry(async () => {
      calls++
      if (calls === 1) throw new Error('Машина не в сети')
      return ok()
    }, { sleep: noSleep })
    expect(calls).toBe(2)
    expect(result.baseSha).toBe(SHA)
  })

  it('осознанный отказ скрипта не повторяется: повтор его не лечит', async () => {
    let calls = 0
    await expect(syncProjectWithRetry(async () => {
      calls++
      return { exitCode: 66, output: 'Рабочая копия проекта содержит локальные изменения', timedOut: false }
    }, { sleep: noSleep })).rejects.toThrow(/локальные изменения/)
    expect(calls).toBe(1)
  })

  it('успешный код без SHA — ошибка, а не молчаливое продолжение на устаревшей копии', async () => {
    await expect(syncProjectWithRetry(async () => ({ exitCode: 0, output: 'ничего', timedOut: false }), { sleep: noSleep }))
      .rejects.toThrow(/не вернула SHA/)
  })

  it('между повторами выдерживается пауза', async () => {
    const delays: number[] = []
    let calls = 0
    await syncProjectWithRetry(async () => (++calls === 1 ? timeout() : ok()), {
      delayMs: 1500,
      sleep: async (ms) => { delays.push(ms) }
    })
    expect(delays).toEqual([1500])
  })
})
