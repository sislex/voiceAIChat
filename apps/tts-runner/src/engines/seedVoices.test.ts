import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedVoices } from './seedVoices'

async function dirWith(files: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vc-seed-'))
  for (const f of files) await writeFile(join(dir, f), f)
  return dir
}

describe('seedVoices', () => {
  it('копирует полные пары в пустой каталог, неполные пропускает', async () => {
    const seed = await dirWith(['a.onnx', 'a.onnx.json', 'broken.onnx'])
    const voices = join(await mkdtemp(join(tmpdir(), 'vc-voices-')), 'voices')
    expect(await seedVoices(voices, seed)).toEqual(['a'])
    expect((await readdir(voices)).sort()).toEqual(['a.onnx', 'a.onnx.json'])
  })

  it('не трогает каталог, где уже есть голос, и молчит без seed-каталога', async () => {
    const seed = await dirWith(['a.onnx', 'a.onnx.json'])
    const voices = await dirWith(['user.onnx', 'user.onnx.json'])
    expect(await seedVoices(voices, seed)).toEqual([])
    expect((await readdir(voices)).sort()).toEqual(['user.onnx', 'user.onnx.json'])
    expect(await seedVoices(voices, undefined)).toEqual([])
    const empty = join(await mkdtemp(join(tmpdir(), 'vc-e-')), 'v'); await mkdir(empty)
    expect(await seedVoices(empty, join(tmpdir(), 'definitely-missing-seed'))).toEqual([])
  })
})
