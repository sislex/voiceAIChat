import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { createFakeApi } from '../test/fakeApi'
import { MAKE_SCAFFOLD } from '@shared/make'
import { MakePane } from './MakePane'

const CONV = 'make-1'

function renderPane(overrides: Partial<Parameters<typeof MakePane>[0]> = {}) {
  const api = createFakeApi([])
  const listeners: Array<(m: { conversationId: string; rev: number; paths: string[] }) => void> = []
  const make = { onChanged: (cb: (m: { conversationId: string; rev: number; paths: string[] }) => void) => { listeners.push(cb); return () => {} } }
  const onInsertToChat = vi.fn()
  render(<MakePane conversationId={CONV} api={api} make={make} onInsertToChat={onInsertToChat} previewBase={`/api/preview/make/${CONV}/`} {...overrides} />)
  return { api, emit: (m: { conversationId: string; rev: number; paths: string[] }) => listeners.forEach((l) => l(m)), onInsertToChat }
}

describe('MakePane', () => {
  it('открывается на превью с iframe проекта; пресеты ширины и обновление меняют src', async () => {
    renderPane()
    const frame = await screen.findByTitle('Превью проекта') as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe(`/api/preview/make/${CONV}/index.html?rev=0`)
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    await userEvent.click(screen.getByRole('button', { name: 'Телефон' }))
    expect((screen.getByTitle('Превью проекта') as HTMLIFrameElement).style.width).toBe('390px')
    await userEvent.click(screen.getByRole('button', { name: 'Обновить превью' }))
    expect(screen.getByTitle('Превью проекта').getAttribute('src')).toContain('rev=1')
  })

  it('режим «Код»: дерево файлов, редактор, сохранение через кнопку и Ctrl+S', async () => {
    const { api } = renderPane()
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    const tree = screen.getByRole('navigation', { name: 'Файлы проекта' })
    expect(within(tree).getByRole('button', { name: /^index\.html/ })).toBeInTheDocument()
    const editor = await screen.findByLabelText('Содержимое index.html') as HTMLTextAreaElement
    expect(editor.value).toBe(MAKE_SCAFFOLD['index.html'])
    expect(screen.getByText('сохранено')).toBeInTheDocument()
    await userEvent.clear(editor)
    await userEvent.type(editor, '<h1>Привет</h1>')
    expect(screen.getByText('не сохранено')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getByText('сохранено')).toBeInTheDocument())
    expect((await api['make:read']({ conversationId: CONV, path: 'index.html' })).content).toBe('<h1>Привет</h1>')

    await userEvent.click(within(tree).getByRole('button', { name: /^styles\.css/ }))
    const css = await screen.findByLabelText('Содержимое styles.css')
    await userEvent.type(css, 'h1{{')
    await userEvent.keyboard('{Control>}s{/Control}')
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'styles.css' })).content).toBe(MAKE_SCAFFOLD['styles.css'] + 'h1{'))
  })

  it('make.changed перезагружает превью и содержимое файла, если редактор не грязный', async () => {
    const { api, emit } = renderPane()
    await screen.findByTitle('Превью проекта')
    await api['make:write']({ conversationId: CONV, path: 'index.html', content: '<p>от ассистента</p>' })
    emit({ conversationId: CONV, rev: 7, paths: ['index.html'] })
    await waitFor(() => expect(screen.getByTitle('Превью проекта').getAttribute('src')).toContain('rev=7'))
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    await waitFor(() => expect((screen.getByLabelText('Содержимое index.html') as HTMLTextAreaElement).value).toBe('<p>от ассистента</p>'))
  })

  it('«История»: снимки и откат; выбранный элемент превью уходит в чат', async () => {
    const { onInsertToChat } = renderPane()
    const frame = await screen.findByTitle('Превью проекта') as HTMLIFrameElement
    await userEvent.click(screen.getByRole('tab', { name: 'История' }))
    expect(screen.getByText('Снимков пока нет')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '+ Снимок' }))
    const nameInput = await screen.findByLabelText('Название снимка')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Мой снимок')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Мой снимок')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Вернуть' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Превью' }))
    const selected = { type: 'vc-make.selected', selector: 'main > h1', tag: 'h1', text: 'Новый проект', html: '<h1>Новый проект</h1>' }
    window.dispatchEvent(new MessageEvent('message', { data: selected, source: (await screen.findByTitle('Превью проекта') as HTMLIFrameElement).contentWindow ?? frame.contentWindow }))
    await screen.findByTestId('make-selected')
    await userEvent.click(screen.getByRole('button', { name: 'В чат' }))
    expect(onInsertToChat).toHaveBeenCalledWith(expect.stringContaining('main > h1'))
  })

  it('публикация: ссылка появляется в диалоге, снятие требует подтверждения', async () => {
    renderPane()
    await screen.findByTitle('Превью проекта')
    await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }))
    await userEvent.click(within(screen.getByTestId('make-publish')).getByRole('button', { name: 'Опубликовать' }))
    expect((await screen.findByTestId('make-public-url')).textContent).toContain('/p/tok123/')
    await userEvent.click(screen.getByRole('button', { name: 'Снять с публикации' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Снять' }))
    await waitFor(() => expect(screen.queryByTestId('make-public-url')).not.toBeInTheDocument())
  })

  it('проверка проекта показывает результат; шаблон применяется после подтверждения', async () => {
    const { api } = renderPane()
    await screen.findByTitle('Превью проекта')
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    await userEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    expect(await screen.findByTestId('make-issues')).toHaveTextContent('Проверка пройдена')
    await userEvent.click(screen.getByRole('button', { name: 'Шаблоны проекта' }))
    await userEvent.click(within(screen.getByTestId('make-templates')).getAllByRole('button', { name: 'Применить' })[1]!)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Применить' }).length).toBeGreaterThan(3))
    await userEvent.click(screen.getAllByRole('button', { name: 'Применить' }).at(-1)!)
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'index.html' })).content).toBe('<h1>landing</h1>'))
  })

  it('загрузка с диска: картинка уходит бинарно в img/, текст — как текст', async () => {
    const { api } = renderPane()
    await screen.findByTitle('Превью проекта')
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    const input = screen.getByTestId('make-upload-input') as HTMLInputElement
    await userEvent.upload(input, [
      new File([new Uint8Array([1, 2, 3])], 'My Logo.png', { type: 'image/png' }),
      new File(['body{}'], 'theme.css', { type: 'text/css' })
    ])
    await waitFor(async () => {
      const paths = (await api['make:state']({ conversationId: CONV })).files.map((f) => f.path)
      expect(paths).toEqual(expect.arrayContaining(['img/My-Logo.png', 'theme.css']))
    })
    expect((await api['make:read']({ conversationId: CONV, path: 'theme.css' })).content).toBe('body{}')
    await userEvent.click((await screen.findAllByRole('button', { name: /My-Logo\.png/ }))[0]!)
    expect(await screen.findByTestId('make-binary')).toContainElement(screen.getByRole('img', { name: 'Просмотр img/My-Logo.png' }))
  })

  it('drag-and-drop файлов в дерево загружает их; редактор подсвечивает синтаксис', async () => {
    const { api } = renderPane()
    await screen.findByTitle('Превью проекта')
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    const zone = screen.getByTestId('make-code')
    const file = new File(['h1{color:red}'], 'drop.css', { type: 'text/css' })
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' }
    fireEvent.dragOver(zone, { dataTransfer })
    expect(await screen.findByRole('status')).toHaveTextContent('Отпустите')
    fireEvent.drop(zone, { dataTransfer })
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'drop.css' })).content).toBe('h1{color:red}'))
    await userEvent.click((await screen.findAllByRole('button', { name: /drop\.css/ }))[0]!)
    await screen.findByLabelText('Содержимое drop.css')
    expect(document.querySelector('.make-highlight .hljs-selector-tag')?.textContent).toBe('h1')
  })

  it('поиск: фильтр дерева по имени и поиск по содержимому на Enter', async () => {
    const { api, emit } = renderPane()
    await screen.findByTitle('Превью проекта')
    const next = await api['make:write']({ conversationId: CONV, path: 'css/theme.css', content: 'body{color:teal}' })
    emit({ conversationId: CONV, rev: next.rev, paths: ['css/theme.css'] })
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    const input = screen.getByRole('searchbox', { name: 'Поиск по файлам проекта' })
    await userEvent.type(input, 'theme')
    expect(screen.queryAllByRole('button', { name: /^index\.html/ })).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: /theme\.css/ }).length).toBeGreaterThan(0)
    await userEvent.clear(input)
    await userEvent.type(input, 'teal{Enter}')
    const region = await screen.findByTestId('make-matches')
    expect(region).toHaveTextContent('Найдено: 1')
    await userEvent.click(within(region).getByRole('button', { name: /css\/theme\.css/ }))
    expect(await screen.findByLabelText('Содержимое css/theme.css')).toBeInTheDocument()
  })

  it('«Компоненты»: список сториз из *.stories.jsx, выбор стори открывает раннер, кнопка вставляет контекст в чат', async () => {
    const { api, emit, onInsertToChat } = renderPane()
    await screen.findByTitle('Превью проекта')
    const next = await api['make:write']({ conversationId: CONV, path: 'src/components/Button.stories.jsx', content: "export default { title: 'Button' }\nexport const Primary = {}\nexport const Small = {}" })
    emit({ conversationId: CONV, rev: next.rev, paths: ['src/components/Button.stories.jsx'] })
    await userEvent.click(screen.getByRole('tab', { name: 'Компоненты' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Small' }))
    const frame = await screen.findByTitle('Стори Small') as HTMLIFrameElement
    expect(frame.src).toContain('__stories__?file=src%2Fcomponents%2FButton.stories.jsx&story=Small')
    await userEvent.click(screen.getByRole('button', { name: 'Работать над компонентом' }))
    expect(onInsertToChat).toHaveBeenCalledWith(expect.stringContaining('компонентом Button'))
  })

  it('controls: args из раннера превращаются в поля, изменение уходит в iframe, «Сбросить» очищает', async () => {
    const { api, emit, onInsertToChat } = renderPane()
    await screen.findByTitle('Превью проекта')
    const next = await api['make:write']({ conversationId: CONV, path: 'src/B.stories.jsx', content: "export default { title: 'B' }\nexport const A = {}" })
    emit({ conversationId: CONV, rev: next.rev, paths: ['src/B.stories.jsx'] })
    await userEvent.click(screen.getByRole('tab', { name: 'Компоненты' }))
    const frame = await screen.findByTitle('Стори A') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    fireEvent(window, new MessageEvent('message', { data: { type: 'vc-make.story', story: 'A', args: { children: 'Кнопка', disabled: false, size: 2, onClick: '[function]' } }, source: frame.contentWindow }))
    const controls = await screen.findByTestId('make-controls')
    await userEvent.click(within(controls).getByLabelText('disabled'))
    expect(post).toHaveBeenLastCalledWith({ type: 'vc-make.args', args: { disabled: true } }, '*')
    await userEvent.clear(within(controls).getByLabelText('children'))
    await userEvent.type(within(controls).getByLabelText('children'), 'Ок')
    expect(post).toHaveBeenLastCalledWith({ type: 'vc-make.args', args: { disabled: true, children: 'Ок' } }, '*')
    expect(within(controls).getByText('[function]')).toBeInTheDocument()
    await userEvent.click(within(controls).getByRole('button', { name: 'Сохранить через ассистента' }))
    expect(onInsertToChat).toHaveBeenCalledWith(expect.stringContaining('"disabled":true'))
    await userEvent.click(within(controls).getByRole('button', { name: 'Сбросить' }))
    expect(post).toHaveBeenLastCalledWith({ type: 'vc-make.args', args: {} }, '*')
    expect((within(controls).getByLabelText('disabled') as HTMLInputElement).checked).toBe(false)
  })

  it('enum-подобный arg рисуется селектом с вариантами из других стори', async () => {
    const { api, emit } = renderPane()
    await screen.findByTitle('Превью проекта')
    const next = await api['make:write']({ conversationId: CONV, path: 'src/C.stories.jsx', content: "export default { title: 'C' }\nexport const A = {}" })
    emit({ conversationId: CONV, rev: next.rev, paths: ['src/C.stories.jsx'] })
    await userEvent.click(screen.getByRole('tab', { name: 'Компоненты' }))
    const frame = await screen.findByTitle('Стори A') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    fireEvent(window, new MessageEvent('message', { data: { type: 'vc-make.story', story: 'A', args: { variant: 'primary' }, options: { variant: ['primary', 'secondary', 'danger'] } }, source: frame.contentWindow }))
    const select = await screen.findByLabelText('variant') as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect([...select.options].map((o) => o.value)).toEqual(['primary', 'secondary', 'danger'])
    await userEvent.selectOptions(select, 'danger')
    expect(post).toHaveBeenLastCalledWith({ type: 'vc-make.args', args: { variant: 'danger' } }, '*')
  })

  it('свежий проект показывает стартовые идеи; клик вставляет промпт в чат; диалог «Идеи» группирует все', async () => {
    const { onInsertToChat } = renderPane()
    await screen.findByTitle('Превью проекта')
    const starters = await screen.findByTestId('make-starters')
    await userEvent.click(within(starters).getByRole('button', { name: /Лендинг SaaS/ }))
    expect(onInsertToChat).toHaveBeenCalledWith(expect.stringContaining('лендинг для SaaS'))
    await userEvent.click(screen.getByRole('button', { name: 'Идеи для старта' }))
    const dialog = await screen.findByTestId('make-ideas')
    expect(within(dialog).getByRole('heading', { name: 'React и компоненты' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /Игра 2048/ }))
    expect(onInsertToChat).toHaveBeenLastCalledWith(expect.stringContaining('2048'))
    await waitFor(() => expect(screen.queryByTestId('make-ideas')).not.toBeInTheDocument())
  })

  it('вкладки открытых файлов: открытие добавляет, закрытие активной переключает на соседнюю', async () => {
    renderPane()
    await screen.findByTitle('Превью проекта')
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    const tree = screen.getByRole('navigation', { name: 'Файлы проекта' })
    await userEvent.click(within(tree).getByRole('button', { name: /^index\.html/ }))
    await userEvent.click(within(tree).getByRole('button', { name: /^styles\.css/ }))
    const bar = await screen.findByRole('tablist', { name: 'Открытые файлы' })
    expect(within(bar).getAllByRole('tab').map((t) => t.textContent)).toEqual(['index.html', 'styles.css'])
    expect(within(bar).getByRole('tab', { name: 'styles.css' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(within(bar).getByRole('button', { name: 'Закрыть styles.css' }))
    expect(await screen.findByLabelText('Содержимое index.html')).toBeInTheDocument()
    expect(within(bar).getAllByRole('tab')).toHaveLength(1)
  })

  it('автосохранение пишет файл после паузы, а ошибка компиляции tsx попадает в маркеры/баннер', async () => {
    const { api, emit } = renderPane({ autosaveDelayMs: 30 })
    await screen.findByTitle('Превью проекта')
    const next = await api['make:write']({ conversationId: CONV, path: 'src/A.tsx', content: 'export const A = 1' })
    emit({ conversationId: CONV, rev: next.rev, paths: ['src/A.tsx'] })
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    await userEvent.click((await screen.findAllByRole('button', { name: /A\.tsx/ }))[0]!)
    const editor = await screen.findByLabelText('Содержимое src/A.tsx')
    await userEvent.type(editor, ' // SYNTAX_ERROR')
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'src/A.tsx' })).content).toContain('SYNTAX_ERROR'))
    expect(await screen.findByTestId('make-issues')).toHaveTextContent('Ошибка компиляции (строка 1)')
    expect(screen.getByText('сохранено')).toBeInTheDocument()
  })

  it('консоль превью: сообщения из iframe копятся, ошибки считаются и уходят в чат', async () => {
    const { onInsertToChat } = renderPane()
    const frame = await screen.findByTitle('Превью проекта') as HTMLIFrameElement
    const post = (level: string, text: string) => fireEvent(window, new MessageEvent('message', { data: { type: 'vc-make.console', level, text, at: 1 }, source: frame.contentWindow }))
    post('log', 'hello')
    post('error', 'Uncaught TypeError: x is not a function')
    expect(await screen.findByTestId('make-console-errors')).toHaveTextContent('1 ошибок')
    await userEvent.click(screen.getByRole('button', { name: /Консоль/ }))
    expect(screen.getByText('hello')).toBeInTheDocument()
    await userEvent.click(within(screen.getByTestId('make-console')).getByRole('button', { name: 'В чат' }))
    expect(onInsertToChat).toHaveBeenCalledWith(expect.stringContaining('TypeError'))
    await userEvent.click(screen.getByRole('button', { name: 'Очистить' }))
    expect(screen.queryByTestId('make-console-errors')).not.toBeInTheDocument()
  })

  it('ассеты: список бинарников с копированием пути; экспорт — два варианта; импорт по URL', async () => {
    const { api, emit } = renderPane()
    await screen.findByTitle('Превью проекта')
    const next = await api['make:upload']({ conversationId: CONV, path: 'img/a.png', dataBase64: 'AAAA' })
    emit({ conversationId: CONV, rev: next.rev, paths: ['img/a.png'] })
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ассеты (1)' }))
    const assets = await screen.findByTestId('make-assets')
    expect(within(assets).getByText('img/a.png')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Скачать проект (ZIP)' }))
    const exp = await screen.findByTestId('make-export')
    expect(within(exp).getByRole('button', { name: /Vite-проект/ })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Импорт проекта' }))
    const imp = await screen.findByTestId('make-import')
    await userEvent.type(within(imp).getByLabelText('Адрес страницы'), 'https://example.com/{Enter}')
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'index.html' })).content).toContain('импортировано из https://example.com/'))
    await waitFor(() => expect(screen.queryByTestId('make-import')).not.toBeInTheDocument())
  })

  it('история: «Сравнить» показывает отличия от снимка, «Вернуть файл» возвращает один файл', async () => {
    const { api, emit } = renderPane()
    await screen.findByTitle('Превью проекта')
    await api['make:snapshot']({ conversationId: CONV, label: 'до' })
    const next = await api['make:write']({ conversationId: CONV, path: 'index.html', content: '<h1>changed</h1>' })
    emit({ conversationId: CONV, rev: next.rev, paths: ['index.html'] })
    await userEvent.click(screen.getByRole('tab', { name: 'История' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Сравнить' }))
    const diff = await screen.findByTestId('make-diff')
    expect(within(diff).getByText('index.html')).toBeInTheDocument()
    expect(within(diff).getByText('изменён')).toBeInTheDocument()
    await userEvent.click(within(diff).getByRole('button', { name: 'index.html' }))
    const view = await screen.findByTestId('make-file-diff')
    expect(within(view).getByLabelText('Снимок')).toHaveTextContent('Новый проект')
    expect(within(view).getByLabelText('Сейчас')).toHaveTextContent('changed')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('make-file-diff')).not.toBeInTheDocument())
    await userEvent.click(within(diff).getByRole('button', { name: 'Вернуть файл' }))
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'index.html' })).content).toBe(MAKE_SCAFFOLD['index.html']))
  })

  it('ошибка в консоли сразу после правки → баннер «Исправить» отправляет текст ассистенту', async () => {
    const onAskAssistant = vi.fn()
    const { emit } = renderPane({ onAskAssistant })
    const frame = await screen.findByTitle('Превью проекта') as HTMLIFrameElement
    emit({ conversationId: CONV, rev: 5, paths: ['app.js'] })
    // Превью пересоздаётся (key=rev) — ждём новый iframe, иначе source не совпадёт с frameRef.
    await waitFor(() => expect(screen.getByTitle('Превью проекта')).not.toBe(frame))
    const frame2 = screen.getByTitle('Превью проекта') as HTMLIFrameElement
    fireEvent(window, new MessageEvent('message', { data: { type: 'vc-make.console', level: 'error', text: 'ReferenceError: foo is not defined', at: Date.now() }, source: frame2.contentWindow }))
    const banner = await screen.findByTestId('make-autofix')
    expect(banner).toHaveTextContent('ReferenceError')
    await userEvent.click(within(banner).getByRole('button', { name: 'Исправить' }))
    expect(onAskAssistant).toHaveBeenCalledWith(expect.stringContaining('foo is not defined'))
    await waitFor(() => expect(screen.queryByTestId('make-autofix')).not.toBeInTheDocument())
  })
})
