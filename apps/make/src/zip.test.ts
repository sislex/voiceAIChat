import { describe, expect, it } from 'vitest'
import { buildStoredZip, crc32 } from './zip'

describe('zip', () => {
  it('crc32 совпадает с эталоном', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })

  it('архив содержит локальные заголовки, центральный каталог и EOCD с правильными смещениями', () => {
    const a = Buffer.from('hello')
    const b = Buffer.from('<h1>x</h1>')
    const zip = buildStoredZip([{ path: 'a.txt', data: a }, { path: 'dir/b.html', data: b }])
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    const eocd = zip.length - 22
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50)
    expect(zip.readUInt16LE(eocd + 10)).toBe(2)
    const cdOffset = zip.readUInt32LE(eocd + 16)
    expect(zip.readUInt32LE(cdOffset)).toBe(0x02014b50)
    // Смещение второго локального заголовка = размер первого (30 + имя + данные).
    const second = 30 + 'a.txt'.length + a.length
    expect(zip.readUInt32LE(second)).toBe(0x04034b50)
    expect(zip.readUInt32LE(second + 14)).toBe(crc32(b))
    expect(zip.subarray(second + 30, second + 30 + 'dir/b.html'.length).toString()).toBe('dir/b.html')
  })
})
