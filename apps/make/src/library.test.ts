import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MakeLibrary, librarySlug } from './library'

describe('MakeLibrary', () => {
  it('slug из имени: латиница, транслит кириллицы, без расширения', () => {
    expect(librarySlug('Button.tsx')).toBe('button')
    expect(librarySlug('Карточка товара')).toBe('kartochka-tovara')
    expect(librarySlug('!!!')).toBe('component')
  })

  it('save/list/files/remove изолированы по пользователю; повторный save перезаписывает', async () => {
    const lib = new MakeLibrary(await mkdtemp(join(tmpdir(), 'vc-lib-')))
    const files = [{ path: 'src/components/Button.tsx', data: Buffer.from('export const Button = 1') }, { path: 'src/components/Button.stories.tsx', data: Buffer.from('export default {}') }]
    const item = await lib.save('ann', 'Button', files, 'conv-1')
    expect(item).toMatchObject({ slug: 'button', name: 'Button', bytes: 40, files: ['src/components/Button.tsx', 'src/components/Button.stories.tsx'] })
    expect((await lib.list('ann')).map((i) => i.slug)).toEqual(['button'])
    expect(await lib.list('bob')).toEqual([])
    expect((await lib.files('ann', 'button')).map((f) => f.path).sort()).toEqual(['src/components/Button.stories.tsx', 'src/components/Button.tsx'])
    await lib.save('ann', 'Button', [{ path: 'Button.tsx', data: Buffer.from('v2') }], 'conv-2')
    expect((await lib.files('ann', 'button')).map((f) => f.path)).toEqual(['Button.tsx'])
    await expect(lib.files('bob', 'button')).rejects.toMatchObject({ code: 'not_found' })
    await lib.remove('ann', 'button')
    expect(await lib.list('ann')).toEqual([])
  })
})
