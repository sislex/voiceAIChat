import { describe, expect, it } from 'vitest'
import { mockJsonToTable, newMockRow, serializeMockJson, stringToCell, tableToMockJson } from './mockTable'

describe('mockTable', () => {
  const file = { $collection: true, $status: 200, $body: [{ id: 1, name: 'Анна', admin: true }, { name: 'Борис', id: 2, tags: ['a'] }] }
  it('JSON → таблица: id первой колонкой, объединение ключей, конверт сохранён', () => {
    const t = mockJsonToTable(file)!
    expect(t.columns).toEqual(['id', 'name', 'admin', 'tags'])
    expect(t.rows[1]).toEqual({ id: '2', name: 'Борис', admin: '', tags: '["a"]' })
    expect(t.envelope).toEqual({ $collection: true, $status: 200 })
    expect(t.bare).toBe(false)
  })
  it('таблица → JSON восстанавливает типы и пропускает пустые ячейки', () => {
    const t = mockJsonToTable(file)!
    t.rows.push({ ...newMockRow(t), name: 'Вера', admin: 'false', tags: '' })
    const json = tableToMockJson(t) as { $body: unknown[]; $collection: boolean }
    expect(json.$collection).toBe(true)
    expect(json.$body[2]).toEqual({ id: 3, name: 'Вера', admin: false })
    expect(serializeMockJson(json)).toContain('"$body": [')
  })
  it('голый массив остаётся массивом; не-таблицы — null', () => {
    const t = mockJsonToTable([{ id: 'a' }])!
    expect(t.bare).toBe(true)
    expect(tableToMockJson(t)).toEqual([{ id: 'a' }])
    expect(mockJsonToTable({ $body: 'x' })).toBeNull()
    expect(mockJsonToTable([1, 2])).toBeNull()
  })
  it('stringToCell', () => {
    expect(stringToCell('12')).toBe(12); expect(stringToCell('true')).toBe(true); expect(stringToCell('null')).toBeNull(); expect(stringToCell('{"a":1}')).toEqual({ a: 1 }); expect(stringToCell('{oops')).toBe('{oops'); expect(stringToCell('текст')).toBe('текст')
  })
})
