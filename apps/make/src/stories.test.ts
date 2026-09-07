import { describe, expect, it } from 'vitest'
import { extractHeadAssets, parseStoryFile, renderStoriesPage } from './stories'
import { parseTestFile, renderGalleryPage, renderTestsPage, storyUsageSnippets } from './stories'

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

describe('storyUsageSnippets / витрина (roadmap-4 п.28)', () => {
  it('берёт JSX стрелочных стори и import компонента; объектные стори — только import', () => {
    const src = "import { Button } from './Button'\nexport default { title: 'Button', component: Button }\nexport const Primary = () => <Button variant=\"primary\">Ок</Button>\nexport const Wide = (args) => (\n  <Button {...args} />\n)\nexport const Args = { args: { label: 'x' } }\n"
    const u = storyUsageSnippets('src/components/Button.stories.tsx', src)
    expect(u.Primary).toBe("import { Button } from './src/components/Button'\n\n<Button variant=\"primary\">Ок</Button>")
    expect(u.Wide).toBe("import { Button } from './src/components/Button'\n\n<Button {...args} />")
    expect(u.Args).toBe("import { Button } from './src/components/Button'\n\n<Button label=\"x\" />")
  })
  it('CSF3-объекты: args default-экспорта сливаются с args стори, children — внутрь тега', () => {
    const src = "import { Button } from './Button.tsx'\n\nexport default { title: 'Button', component: Button, args: { children: 'Кнопка', variant: 'primary', width: 160 } }\n\nexport const Secondary = { args: { variant: 'secondary' } }\nexport const Plain = {}\n"
    const u = storyUsageSnippets('src/components/Button.stories.tsx', src)
    expect(u.Secondary).toBe("import { Button } from './src/components/Button'\n\n<Button variant=\"secondary\" width={160}>Кнопка</Button>")
    expect(u.Plain).toBe("import { Button } from './src/components/Button'\n\n<Button variant=\"primary\" width={160}>Кнопка</Button>")
  })
  it('renderGalleryPage: поиск, data-search и блок кода', () => {
    const html = renderGalleryPage([{ path: 'src/components/Button.stories.tsx', title: 'Button', stories: ['Primary'] }], '/p/x/', 'Витрина', { 'src/components/Button.stories.tsx': { Primary: '<Button />' } })
    expect(html).toContain('aria-label="Поиск по витрине"')
    expect(html).toContain('data-search="button primary src/components/button.stories.tsx"')
    expect(html).toContain('<details class="code"><summary>Код</summary><pre>&lt;Button /></pre>')
  })
})
