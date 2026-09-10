import { describe, expect, it } from 'vitest'
import { buildZip, crc32 } from './zipStore'

describe('zipStore', () => {
  it('crc32 совпадает с эталоном', () => {
    // Эталон "123456789" → 0xCBF43926 — классический тест-вектор CRC-32.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('архив несёт сигнатуры, количество файлов и UTF-8 имена', async () => {
    const blob = buildZip([
      { name: 'кот.png', data: new Uint8Array([1, 2, 3]) },
      { name: 'пёс.png', data: new Uint8Array([4]) }
    ])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50) // local header
    // EOCD — последние 22 байта: количество записей в обоих полях.
    const eocd = bytes.length - 22
    expect(view.getUint32(eocd, true)).toBe(0x06054b50)
    expect(view.getUint16(eocd + 8, true)).toBe(2)
    expect(view.getUint16(eocd + 10, true)).toBe(2)
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('кот.png')
  })
})
