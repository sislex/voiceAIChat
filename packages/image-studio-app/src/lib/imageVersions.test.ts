import { describe, expect, it } from 'vitest'
import { versionChain, versionFamily } from './imageVersions'
import type { ImageStudioFile } from '@shared/imageStudio'

const f = (path: string, source?: string, updatedAt = 1): ImageStudioFile => ({ path, size: 1, updatedAt, ...(source ? { source } : {}) })

describe('versionChain', () => {
  it('строит нить вверх до корня и вниз к потомку', () => {
    const files = [f('a.png'), f('b.png', 'a.png', 2), f('c.png', 'b.png', 3)]
    expect(versionChain(files, 'b.png')).toEqual(['a.png', 'b.png', 'c.png'])
    expect(versionChain(files, 'a.png')).toEqual(['a.png', 'b.png', 'c.png'])
  })

  it('ветвление вниз берёт раннего потомка, циклы не зацикливают', () => {
    const files = [f('a.png'), f('b.png', 'a.png', 5), f('early.png', 'a.png', 2)]
    expect(versionChain(files, 'a.png')).toEqual(['a.png', 'early.png'])
    // Искусственный цикл a→b→a.
    const cyclic = [f('a.png', 'b.png'), f('b.png', 'a.png')]
    expect(versionChain(cyclic, 'a.png')).toEqual(['b.png', 'a.png'])
    expect(versionChain(files, 'нет.png')).toEqual([])
  })
})

describe('versionFamily', () => {
  const file = (path: string, source?: string, updatedAt = 1): ImageStudioFile => ({ path, size: 1, updatedAt, ...(source ? { source } : {}) })

  it('собирает и предков, и все ветви потомков', () => {
    const files = [file('кот.png'), file('кот-2.png', 'кот.png', 2), file('кот-3.png', 'кот.png', 3), file('кот-2-crop.png', 'кот-2.png', 4)]
    // Из любой точки родня одна и та же.
    expect(versionFamily(files, 'кот-2-crop.png')).toEqual(['кот.png', 'кот-2.png', 'кот-3.png', 'кот-2-crop.png'])
    expect(versionFamily(files, 'кот.png')).toEqual(['кот.png', 'кот-2.png', 'кот-3.png', 'кот-2-crop.png'])
  })

  it('одиночка — сам себе родня, отсутствующий файл даёт пустоту', () => {
    expect(versionFamily([file('один.png')], 'один.png')).toEqual(['один.png'])
    expect(versionFamily([file('один.png')], 'нет.png')).toEqual([])
  })

  it('цикл в source не вешает обход', () => {
    const files = [file('а.png', 'б.png'), file('б.png', 'а.png')]
    expect(versionFamily(files, 'а.png').length).toBeLessThanOrEqual(2)
  })
})
