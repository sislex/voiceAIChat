import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib'

export const COMPRESSION = { gzip: { level: 9 }, brotli: { quality: 11 } }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const runtime = { node: process.version, zlib: process.versions.zlib, brotli: process.versions.brotli }
const compress = bytes => ({
  gzip: gzipSync(bytes, COMPRESSION.gzip),
  brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: COMPRESSION.brotli.quality } })
})
const lengths = (bytes, compressed) => ({ raw: bytes.length, gzip: compressed.gzip.length, brotli: compressed.brotli.length })
export const sizes = bytes => lengths(bytes, compress(bytes))

// Cache compressed bytes, never inventories: every run still reads the build and
// parses its import graph. Corrupt or incompatible entries only cost recompression.
export function createCachedSizer(directory) {
  const fingerprint = hash(JSON.stringify({ schema: 1, compression: COMPRESSION, runtime }))
  const stats = { hits: 0, misses: 0, writeFailures: 0 }
  function measure(bytes) {
    const content = hash(bytes), path = join(directory, fingerprint + '-' + content + '.json')
    try {
      const entry = JSON.parse(readFileSync(path, 'utf8'))
      if (entry.fingerprint !== fingerprint || entry.content !== content) throw Error('Incompatible cache')
      const compressed = {}
      for (const [kind, decode] of [['gzip', gunzipSync], ['brotli', brotliDecompressSync]]) {
        compressed[kind] = Buffer.from(entry[kind].bytes, 'base64')
        if (hash(compressed[kind]) !== entry[kind].sha256 || !decode(compressed[kind], { maxOutputLength: bytes.length + 1 }).equals(bytes)) throw Error('Corrupt cache')
      }
      stats.hits++
      return lengths(bytes, compressed)
    } catch { /* Missing or invalid cache must never affect budget correctness. */ }
    stats.misses++
    const compressed = compress(bytes)
    const entry = { fingerprint, content, ...Object.fromEntries(Object.entries(compressed).map(([kind, value]) => [kind, { sha256: hash(value), bytes: value.toString('base64') }])) }
    const temporary = path + '.' + randomUUID() + '.tmp'
    try {
      mkdirSync(directory, { recursive: true })
      writeFileSync(temporary, JSON.stringify(entry), { flag: 'wx' })
      renameSync(temporary, path)
    } catch { stats.writeFailures++ }
    finally { try { rmSync(temporary, { force: true }) } catch { /* Read-only cache is optional. */ } }
    return lengths(bytes, compressed)
  }
  measure.stats = stats
  return measure
}
