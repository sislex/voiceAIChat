import { describe, expect, it } from 'vitest'
import { versionChain } from './imageVersions'
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
