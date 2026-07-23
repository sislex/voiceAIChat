import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listCxProjects,
  listCxSessions,
  readCxTranscript,
  resolveCxSessionPath
} from './codexSessions'

let base: string

const ID_A = '019f8ac3-23fe-7c11-914e-43447a041b30'
const ID_B1 = '019cb066-0a35-7132-982b-cd301535a17b'
const ID_B2 = '019cb06b-6a6c-7bf0-bba7-8b9c23f62886'

function meta(cwd: string, id: string): string {
  return JSON.stringify({
    timestamp: '2026-07-22T16:00:00.000Z',
    type: 'session_meta',
    payload: { session_id: id, id, timestamp: '2026-07-22T16:00:00.000Z', cwd }
  })
}
function ev(payload: unknown): string {
  return JSON.stringify({ timestamp: '2026-07-22T17:00:00.000Z', type: 'event_msg', payload })
}
/** Пишет rollout-файл в каталог даты. */
function writeRollout(day: string, id: string, cwd: string, userText: string, extra: string[] = []): void {
  const dir = join(base, ...day.split('/'))
  mkdirSync(dir, { recursive: true })
  const body = [meta(cwd, id), ev({ type: 'user_message', message: userText }), ...extra].join('\n')
  writeFileSync(join(dir, `rollout-2026-07-22T17-00-00-${id}.jsonl`), body)
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cx-test-'))
  // Проект A: одна сессия с ответом.
  writeRollout('2026/07/22', ID_A, '/Users/x/projA', 'Привет A', [
    ev({ type: 'agent_message', message: 'Ответ A', phase: 'final_answer' })
  ])
  // Проект B: две сессии в разных датах.
  writeRollout('2026/06/12', ID_B1, '/Users/x/projB', 'Б первая')
  writeRollout('2026/07/22', ID_B2, '/Users/x/projB', 'Б вторая')
})

afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('codexSessions', () => {
  it('listCxProjects: группировка по cwd, имя и число сессий', () => {
    const byCwd = Object.fromEntries(listCxProjects(base).map((p) => [p.cwd, p]))
    expect(byCwd['/Users/x/projA'].sessionCount).toBe(1)
    expect(byCwd['/Users/x/projA'].name).toBe('projA')
    expect(byCwd['/Users/x/projB'].sessionCount).toBe(2)
  })

  it('listCxSessions: сессии проекта с заголовком из первой реплики', () => {
    const titles = listCxSessions('/Users/x/projB', base)
      .map((s) => s.title)
      .sort()
    expect(titles).toEqual(['Б вторая', 'Б первая'])
  })

  it('resolveCxSessionPath: находит файл по id (глоб по дереву дат)', () => {
    expect(resolveCxSessionPath(ID_A, base)).toContain(`-${ID_A}.jsonl`)
    expect(resolveCxSessionPath('нет-такого', base)).toBeNull()
  })

  it('readCxTranscript: плоский список записей по id', () => {
    const items = readCxTranscript(ID_A, {}, base)
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant'])
    expect(items[1].text).toBe('Ответ A')
  })

  it('защита id от обхода пути', () => {
    expect(resolveCxSessionPath('../../etc', base)).toBeNull()
    expect(resolveCxSessionPath('a/b', base)).toBeNull()
    expect(readCxTranscript('../x', {}, base)).toEqual([])
  })

  it('несуществующий каталог → пустой список', () => {
    expect(listCxProjects(join(base, 'нет'))).toEqual([])
  })
})
