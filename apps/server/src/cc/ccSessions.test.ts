import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listProjects, listSessions, readTranscript, sessionPath } from './ccSessions'

let base: string

function line(o: unknown): string {
  return JSON.stringify(o)
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cc-test-'))
  // Проект A: одна сессия с промптом и ответом.
  const a = join(base, '-Users-x-projA')
  mkdirSync(a, { recursive: true })
  writeFileSync(
    join(a, 's1.jsonl'),
    [
      line({ type: 'user', cwd: '/Users/x/projA', timestamp: '2026-07-08T10:00:00Z', message: { content: 'Привет проект A' } }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Ответ A' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } })
    ].join('\n')
  )
  // Проект B: две сессии.
  const b = join(base, '-Users-x-projB')
  mkdirSync(b, { recursive: true })
  writeFileSync(join(b, 's2.jsonl'), line({ type: 'user', cwd: '/Users/x/projB', message: { content: 'Б первая' } }))
  writeFileSync(join(b, 's3.jsonl'), line({ type: 'user', cwd: '/Users/x/projB', message: { content: 'Б вторая' } }))
})

afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('ccSessions', () => {
  it('listProjects: путь из cwd, имя и число сессий', () => {
    const projects = listProjects(base)
    const byPath = Object.fromEntries(projects.map((p) => [p.path, p]))
    expect(byPath['/Users/x/projA'].sessionCount).toBe(1)
    expect(byPath['/Users/x/projA'].name).toBe('projA')
    expect(byPath['/Users/x/projB'].sessionCount).toBe(2)
  })

  it('listSessions: заголовок из первой реплики', () => {
    const projB = listProjects(base).find((p) => p.name === 'projB')!
    const titles = listSessions(projB.slug, base).map((s) => s.title).sort()
    expect(titles).toEqual(['Б вторая', 'Б первая'])
  })

  it('readTranscript: плоский список записей', () => {
    const projA = listProjects(base).find((p) => p.name === 'projA')!
    const items = readTranscript(projA.slug, 's1', {}, base)
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool_use'])
    expect(items[2].text).toBe('Bash: ls')
  })

  it('защита от обхода пути', () => {
    expect(sessionPath('../etc', 'passwd', base)).toBeNull()
    expect(listSessions('../..', base)).toEqual([])
    expect(readTranscript('../x', 'y', {}, base)).toEqual([])
  })

  it('несуществующий каталог → пустой список', () => {
    expect(listProjects(join(base, 'нет'))).toEqual([])
  })
})
