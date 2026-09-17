import { describe, expect, it } from 'vitest'
import { ZOOM_MEMORY_KEY, loadZoomFor, saveZoomFor } from './zoomMemory'

const memory = (): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } => {
  const data: Record<string, string> = {}
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value } }
}

describe('zoomMemory: масштаб текста запоминается по сайту', () => {
  it('сохраняет масштаб для host и отдаёт 100 для других сайтов и пустого адреса', () => {
    const storage = memory()
    saveZoomFor('https://docs.example/page', 130, storage)
    expect(loadZoomFor('https://docs.example/other', storage)).toBe(130)
    expect(loadZoomFor('https://shop.example/', storage)).toBe(100)
    expect(loadZoomFor(null, storage)).toBe(100)
  })
  it('100% забывает сайт, значения зажимаются в 50–200, мусор в хранилище игнорируется', () => {
    const storage = memory()
    saveZoomFor('https://docs.example/', 400, storage)
    expect(loadZoomFor('https://docs.example/', storage)).toBe(200)
    saveZoomFor('https://docs.example/', 100, storage)
    expect(JSON.parse(storage.data[ZOOM_MEMORY_KEY])).toEqual({})
    storage.data[ZOOM_MEMORY_KEY] = '[1,2]'
    expect(loadZoomFor('https://docs.example/', storage)).toBe(100)
    storage.data[ZOOM_MEMORY_KEY] = '{"docs.example": "big"}'
    expect(loadZoomFor('https://docs.example/', storage)).toBe(100)
  })
})
