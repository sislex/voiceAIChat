import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planQaScreenshotSweep, sweepQaScreenshots } from './qaScreenshots.js'

const DAY = 24 * 60 * 60_000

describe('planQaScreenshotSweep', () => {
  const now = 10 * DAY
  it('снимок без рана удаляется сразу — показать его негде', () => {
    expect(planQaScreenshotSweep([{ name: 'gone.png', modifiedAt: now }], { knownRunIds: new Set(), maxAgeMs: 30 * DAY, now })).toEqual(['gone.png'])
  })
  it('снимок живого рана держится, пока не состарится', () => {
    const known = new Set(['run-1'])
    expect(planQaScreenshotSweep([{ name: 'run-1.png', modifiedAt: now - DAY }], { knownRunIds: known, maxAgeMs: 7 * DAY, now })).toEqual([])
    expect(planQaScreenshotSweep([{ name: 'run-1.png', modifiedAt: now - 8 * DAY }], { knownRunIds: known, maxAgeMs: 7 * DAY, now })).toEqual(['run-1.png'])
  })
  it('чужие файлы в каталоге не трогаются', () => {
    expect(planQaScreenshotSweep([{ name: 'заметка.txt', modifiedAt: 0 }], { knownRunIds: new Set(), maxAgeMs: DAY, now })).toEqual([])
  })
})

describe('sweepQaScreenshots', () => {
  it('удаляет осиротевшие и старые, оставляет свежие', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-sweep-'))
    for (const name of ['run-1.png', 'run-2.png', 'orphan.png']) writeFileSync(join(dir, name), 'x')
    const old = new Date(Date.now() - 40 * DAY)
    utimesSync(join(dir, 'run-2.png'), old, old)
    const removed = sweepQaScreenshots({ dir, knownRunIds: new Set(['run-1', 'run-2']), maxAgeMs: 30 * DAY })
    expect(removed).toBe(2)
    expect(readdirSync(dir)).toEqual(['run-1.png'])
  })

  it('отсутствующий каталог — не ошибка', () => {
    expect(sweepQaScreenshots({ dir: join(tmpdir(), 'нет-такого-каталога-vc'), knownRunIds: new Set(), maxAgeMs: DAY })).toBe(0)
  })
})
