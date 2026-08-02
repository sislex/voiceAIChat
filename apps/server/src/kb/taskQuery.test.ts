import { describe, expect, it } from 'vitest'
import { areaTouchesPath, kbCodeQuery, kbTaskQuery, KB_QUERY_CHARS, prepareKbQuery } from './taskQuery.js'

describe('prepareKbQuery', () => {
  it('оставляет прозу в лексической дорожке, а код уводит в свою', () => {
    const query = prepareKbQuery(
      'Правим чтение файлов в `apps/server/src/mcp/remoteBashMcp.ts`: вместо `cat -n` и `python3 - <<PY`\n' +
      'модель зовёт `fsRead`.\n```\nrm -rf /tmp/x\n```\n',
      'Remote-MCP: инструменты read/grep/edit'
    )
    expect(query.text).toContain('Remote-MCP: инструменты read/grep/edit')
    expect(query.text).toContain('Правим чтение файлов')
    // Блок кода в тему не входит: это не формулировка задачи.
    expect(query.text).not.toContain('rm -rf')
    expect(query.paths).toContain('apps/server/src/mcp/remoteBashMcp.ts')
    expect(query.symbols).toContain('fsRead')
    // Шум кодовых описаний: обычные слова и утилиты идентификаторами не считаем.
    expect(query.symbols).not.toContain('read')
    expect(query.symbols).not.toContain('python3')
  })

  it('не принимает подстановку в шаблоне за имя символа', () => {
    const query = prepareKbQuery('Показать `идет ${режим}` синим, без хода — только `${режим}`.')
    expect(query.symbols).toEqual([])
    expect(query.text).toContain('идет')
  })

  it('срезает хвост с номерами строк у пути', () => {
    const query = prepareKbQuery('Смотри `apps/server/src/kb/kbMcp.ts:74–93` и `apps/server/src/turns.ts:298`.')
    expect(query.paths).toEqual(['apps/server/src/kb/kbMcp.ts', 'apps/server/src/turns.ts'])
  })

  it('запрос по задаче начинается с заголовка и обрезан капом', () => {
    const query = kbTaskQuery({ title: 'Заголовок задачи', description: 'а'.repeat(4000), acceptanceCriteria: 'критерий' })
    expect(query.text.startsWith('Заголовок задачи')).toBe(true)
    expect(query.text.length).toBeLessThanOrEqual(KB_QUERY_CHARS)
  })

  it('пустая задача даёт пустые дорожки, а не строку из переводов строк', () => {
    expect(kbTaskQuery({ title: '', description: null, acceptanceCriteria: null })).toEqual({ text: '', paths: [], symbols: [] })
  })

  it('кодовая дорожка — это пути и символы одной строкой', () => {
    const query = prepareKbQuery('Правка `apps/server/src/ci/kbHit.ts`, функция `calculateKbHit`.')
    expect(kbCodeQuery(query)).toBe('apps/server/src/ci/kbHit.ts kbHit.ts calculateKbHit')
  })
})

describe('areaTouchesPath', () => {
  it('сопоставляет каталог из areas с файлом из задачи в обе стороны', () => {
    expect(areaTouchesPath('apps/server/src/ci', 'apps/server/src/ci/kbHit.ts')).toBe(true)
    expect(areaTouchesPath('apps/server/src/ci/modelHooks.ts', 'apps/server/src')).toBe(true)
    expect(areaTouchesPath('packages/ui/src/components/kanban', 'apps/server/src/ci')).toBe(false)
  })

  it('не считает совпадением пустой или звёздочный area', () => {
    expect(areaTouchesPath('**/*.ts', 'apps/server/src/ci/kbHit.ts')).toBe(false)
    expect(areaTouchesPath('', 'apps/server')).toBe(false)
  })
})
