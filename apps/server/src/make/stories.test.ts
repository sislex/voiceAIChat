import { describe, expect, it } from 'vitest'
import { extractHeadAssets, parseStoryFile, renderStoriesPage } from './stories'
import { parseTestFile, renderTestsPage } from './stories'

describe('make stories', () => {
  it('parseStoryFile: имена стори из экспортов, title из default или имени файла', () => {
    const parsed = parseStoryFile('src/components/Button.stories.jsx', "export default { title: 'UI/Button' }\nexport const Primary = {}\nexport function Big() {}\nconst hidden = 1")
    expect(parsed).toEqual({ path: 'src/components/Button.stories.jsx', title: 'UI/Button', stories: ['Primary', 'Big'], withPlay: [] })
    expect(parseStoryFile('Card.stories.tsx', 'export const A = {}').title).toBe('Card')
    const withPlay = parseStoryFile('B.stories.jsx', "export const A = {}\nexport const B = { play: async ({ canvasElement }) => {} }\nexport const C = {}")
    expect(withPlay.withPlay).toEqual(['B'])
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
    expect(page).toContain('vc-make.play')
  })

  it('parseTestFile и раннер тестов: имена test(), компонент рядом, страница шлёт vc-make.test (roadmap-4 п.3)', () => {
    const t = parseTestFile('src/components/Button.test.tsx', "test('рендерит подпись', async (t) => {})\ntest(\"клик\", async (t) => {})", new Set(['src/components/Button.tsx', 'src/components/Button.test.tsx']))
    expect(t).toEqual({ path: 'src/components/Button.test.tsx', names: ['рендерит подпись', 'клик'], component: 'src/components/Button.tsx' })
    const html = renderTestsPage('src/components/Button.test.tsx', null)
    expect(html).toContain("window.test = (name, fn)")
    expect(html).toContain("'vc-make.test'")
    expect(html).toContain("'vc-make.tests-done'")
    expect(html).toContain('./src/components/Button.test.tsx')
  })
})
