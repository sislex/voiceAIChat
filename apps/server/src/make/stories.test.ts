import { describe, expect, it } from 'vitest'
import { extractHeadAssets, parseStoryFile, renderStoriesPage } from './stories'

describe('make stories', () => {
  it('parseStoryFile: имена стори из экспортов, title из default или имени файла', () => {
    const parsed = parseStoryFile('src/components/Button.stories.jsx', "export default { title: 'UI/Button' }\nexport const Primary = {}\nexport function Big() {}\nconst hidden = 1")
    expect(parsed).toEqual({ path: 'src/components/Button.stories.jsx', title: 'UI/Button', stories: ['Primary', 'Big'] })
    expect(parseStoryFile('Card.stories.tsx', 'export const A = {}').title).toBe('Card')
  })

  it('раннер берёт import map и стили из index.html, иначе дефолтный React-map', () => {
    const html = '<head><link rel="stylesheet" href="styles.css"><script type="importmap">{"imports":{"react":"https://x/react"}}</script></head>'
    const assets = extractHeadAssets(html)
    expect(assets.importMap).toContain('https://x/react')
    expect(assets.links).toContain('styles.css')
    expect(extractHeadAssets(null).importMap).toContain('esm.sh/react@18')
    const page = renderStoriesPage('src/A.stories.jsx', 'Primary', html)
    expect(page).toContain('"./src/A.stories.jsx"')
    expect(page).toContain('"Primary"')
    expect(page).toContain('vc-make.story')
    expect(page).toContain('vc-make.args')
    expect(page).toContain('enumOptions')
    expect(page).toContain('argTypes')
  })
})
