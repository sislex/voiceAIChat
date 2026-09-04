import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isBrowserShotName, nextBrowserShotIndex, planBrowserShotSweep, readBrowserShot, saveBrowserShot, sweepBrowserShots } from './checkShots.js'

let root = ''
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = '' })
const dir = (): string => (root = mkdtempSync(join(tmpdir(), 'vc-browser-shots-')))

describe('имя кадра', () => {
  it('принимает только номер с расширением png', () => {
    expect(isBrowserShotName('3.png')).toBe(true)
    // Обход каталога и чужие расширения в путь к файлу попадать не должны.
    for (const name of ['../secret.png', 'a.png', '3.png.txt', '3.PNG', '']) expect(isBrowserShotName(name)).toBe(false)
  })

  it('нумерация продолжает максимум и не переиспользует дырки', () => {
    expect(nextBrowserShotIndex([])).toBe(1)
    expect(nextBrowserShotIndex(['1.png', '4.png', 'мусор'])).toBe(5)
  })
})

describe('сохранение и чтение кадра', () => {
  it('кладёт файл в каталог рана и отдаёт ссылку ленты', () => {
    const root = dir()
    const first = saveBrowserShot(root, 'run-1', Buffer.from('одна'))
    expect(first).toMatchObject({ name: '1.png', url: '/api/ci/runs/run-1/browser-shots/1.png' })
    expect(saveBrowserShot(root, 'run-1', Buffer.from('вторая'))?.name).toBe('2.png')
    expect(readBrowserShot(root, 'run-1', '2.png')?.toString()).toBe('вторая')
  })

  it('чужое имя и отсутствующий файл читаются как null', () => {
    const root = dir()
    saveBrowserShot(root, 'run-1', Buffer.from('одна'))
    expect(readBrowserShot(root, 'run-1', '../../etc/passwd')).toBeNull()
    expect(readBrowserShot(root, 'run-1', '9.png')).toBeNull()
  })
})

describe('уборка кадров', () => {
  it('удаляет каталоги исчезнувших ранов и старые', () => {
    expect(planBrowserShotSweep(
      [{ runId: 'живой', modifiedAt: 900 }, { runId: 'старый', modifiedAt: 100 }, { runId: 'удалённый', modifiedAt: 1000 }],
      { knownRunIds: new Set(['живой', 'старый']), maxAgeMs: 500, now: 1000 }
    )).toEqual(['старый', 'удалённый'])
  })

  it('на диске каталог удаляется целиком, отсутствие корня не ошибка', () => {
    const root = dir()
    saveBrowserShot(root, 'run-1', Buffer.from('одна'))
    mkdirSync(join(root, 'run-2'))
    writeFileSync(join(root, 'run-2', '1.png'), 'вторая')
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(root, 'run-2'), old, old)

    expect(sweepBrowserShots({ root, knownRunIds: new Set(['run-1', 'run-2']), maxAgeMs: 1000 })).toBe(1)
    expect(readdirSync(root)).toEqual(['run-1'])
    expect(sweepBrowserShots({ root: join(root, 'нет'), knownRunIds: new Set(), maxAgeMs: 1000 })).toBe(0)
  })
})
