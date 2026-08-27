import { describe, expect, it } from 'vitest'
import { clearHistory, pushHistory, readHistory, type HistoryStorage } from './fileHistory'

const mem = (): HistoryStorage => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: (k) => { m.delete(k) } } }

describe('fileHistory', () => {
  it('хранит до 20 версий, новые сверху, дубли подряд не пишет, очистка работает', () => {
    const s = mem()
    for (let i = 0; i < 25; i++) pushHistory('c', 'a.js', `v${i}`, s, 1000 + i)
    const list = readHistory('c', 'a.js', s)
    expect(list).toHaveLength(20)
    expect(list[0]).toEqual({ at: 1024, content: 'v24' })
    expect(pushHistory('c', 'a.js', 'v24', s, 2000)).toHaveLength(20)
    expect(readHistory('c', 'a.js', s)[0]!.at).toBe(1024)
    clearHistory('c', 'a.js', s)
    expect(readHistory('c', 'a.js', s)).toEqual([])
  })
  it('очень большие файлы в историю не попадают', () => {
    const s = mem()
    expect(pushHistory('c', 'big.txt', 'x'.repeat(200_001), s)).toEqual([])
  })
})
