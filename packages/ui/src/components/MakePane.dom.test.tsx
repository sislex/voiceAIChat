import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { createFakeApi } from '../test/fakeApi'
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
    expect(editor.value).toBe('<h1>Новый проект</h1>')
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
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'styles.css' })).content).toBe('body{}h1{'))
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
})
