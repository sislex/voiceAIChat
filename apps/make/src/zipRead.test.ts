import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { buildStoredZip } from './zip'
import { readZip, stripCommonRoot } from './zipRead'

describe('zipRead', () => {
  it('читает архив, собранный нашим писателем (store), срезает общую папку и пропускает служебное', () => {
    const zip = buildStoredZip([
      { path: 'site/index.html', data: Buffer.from('<h1>a</h1>') },
      { path: 'site/css/a.css', data: Buffer.from('b{}') },
      { path: 'site/.DS_Store', data: Buffer.from('x') },
      { path: '__MACOSX/site/._index.html', data: Buffer.from('x') }
    ])
    const entries = readZip(zip)
    expect(entries.map((e) => e.path).sort()).toEqual(['css/a.css', 'index.html'])
    expect(entries.find((e) => e.path === 'index.html')!.data.toString()).toBe('<h1>a</h1>')
  })

  it('deflate-запись распаковывается; не-ZIP → понятная ошибка', () => {
    // Exercise readZip's inflate path with a method-8 archive built from a store archive and
    // compressed entry data.
    const payload = Buffer.from('body{color:red}')
    const compressed = deflateRawSync(payload)
    const zip = buildStoredZip([{ path: 'a.css', data: compressed }])
    // Patch the compression method at offset 8 in the local header and 10 in the central header,
    // plus the uncompressed size.
    zip.writeUInt16LE(8, 8)
    const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    zip.writeUInt16LE(8, cd + 10)
    zip.writeUInt32LE(payload.length, cd + 24)
    expect(readZip(zip)[0]!.data.toString()).toBe('body{color:red}')
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow(/не ZIP/)
  })

  it('stripCommonRoot не трогает архив с файлами в корне', () => {
    const entries = [{ path: 'index.html', data: Buffer.alloc(0) }, { path: 'src/a.js', data: Buffer.alloc(0) }]
    expect(stripCommonRoot(entries).map((e) => e.path)).toEqual(['index.html', 'src/a.js'])
  })
})
