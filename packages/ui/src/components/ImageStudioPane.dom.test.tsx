import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import { ImageStudioPane } from './ImageStudioPane'
import type { ImageStudioFile } from '@shared/imageStudio'

/** Мосты панели: галерея в замыкании, как её отдал бы сервер. */
function makeApi(initial: Array<{ path: string }> = []) {
  let files: ImageStudioFile[] = initial.map((file, index) => ({ path: file.path, size: 10, updatedAt: index + 1 }))
  const generate = vi.fn(async ({ prompt }: { prompt: string }) => {
    const file = { path: 'изображение.png', size: prompt.length, updatedAt: Date.now() }
    files = [file, ...files]
    return { file, files: [...files] }
  })
  const edit = vi.fn(async ({ path }: { path: string; prompt: string }) => {
    const file = { path: path.replace('.png', '-2.png'), size: 10, updatedAt: Date.now() }
    files = [file, ...files]
    return { file, files: [...files] }
  })
  return {
    generate, edit,
    api: {
      'imgstudio:list': vi.fn(async () => [...files]),
      'imgstudio:read': vi.fn(async ({ path }: { path: string }) => ({ path, dataBase64: btoa('img') })),
      'imgstudio:upload': vi.fn(async ({ path }: { path: string }) => { files = [{ path, size: 3, updatedAt: Date.now() }, ...files]; return [...files] }),
      'imgstudio:delete': vi.fn(async ({ path }: { path: string }) => { files = files.filter((file) => file.path !== path); return [...files] }),
      'imgstudio:rename': vi.fn(async ({ from, to }: { from: string; to: string }) => { files = files.map((file) => file.path === from ? { ...file, path: to } : file); return [...files] }),
      'imgstudio:generate': generate,
      'imgstudio:edit': edit
    }
  }
}

describe('ImageStudioPane', () => {
  it('промпт без выбора рисует новую картинку, с выбором — правит выбранную', async () => {
    const { api, generate, edit } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'пёс в шляпе' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ conversationId: 'c1', prompt: 'пёс в шляпе' }))

    // Выбор картинки переключает то же поле в режим правки.
    // Кнопок с именем файла несколько (превью + переименовать/скачать/удалить):
    // выбор картинки — это клик по превью.
    // Имя кнопке-превью даёт alt загрузившейся картинки — ждём её.
    fireEvent.click(await screen.findByRole('button', { name: 'кот.png' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'добавь шляпу' } })
    fireEvent.click(screen.getByRole('button', { name: 'Изменить выбранную' }))
    await waitFor(() => expect(edit).toHaveBeenCalledWith({ conversationId: 'c1', path: 'кот.png', prompt: 'добавь шляпу' }))
  })

  it('удаление — с подтверждением, переименование — полем на карточке', async () => {
    const { api } = makeApi([{ path: 'логотип.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать логотип.png' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Новое имя файла' }), { target: { value: 'лого.png' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ок' }))
    await waitFor(() => expect(screen.getByText('лого.png')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Удалить лого.png' }))
    const confirmText = await screen.findByText('Удалить «лого.png»?')
    const overlay = confirmText.closest('.vc-dialog-overlay') as HTMLElement
    fireEvent.click(within(overlay).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(screen.queryByText('лого.png')).not.toBeInTheDocument())
  })

  it('Cmd+Enter в промпте запускает рисование, пресет размера дописывается в промпт', async () => {
    const { api, generate } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const promptField = await screen.findByRole('textbox', { name: 'Промпт для изображения' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Размер изображения' }), { target: { value: '1024×1024' } })
    fireEvent.change(promptField, { target: { value: 'закат' } })
    fireEvent.keyDown(promptField, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ conversationId: 'c1', prompt: 'закат\nРазмер изображения: 1024x1024' }))
  })

  it('перетаскивание файлов загружает их все разом', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')
    const drop = [new File(['a'], 'а.png', { type: 'image/png' }), new File(['b'], 'б.png', { type: 'image/png' })]
    // В jsdom у File нет arrayBuffer — доопределяем, поведение браузера от этого не меняется.
    for (const file of drop) Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
    fireEvent.drop(zone, { dataTransfer: { files: drop, types: ['Files'] } })
    await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Файлов: 2/)).toBeInTheDocument()
  })

  it('ошибка генерации остаётся баннером в панели, а не только тостом', async () => {
    const { api } = makeApi()
    api['imgstudio:generate'].mockRejectedValueOnce(new Error('AI не вернул файл изображения'))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'кот' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    // Тост исчезнет сам, баннер должен остаться в панели.
    await waitFor(() => expect(screen.getAllByText('AI не вернул файл изображения').length).toBeGreaterThan(0))
    expect(document.querySelector('.image-studio .vc-state--error')).not.toBeNull()
  })

  it('вариация и дубликат работают с карточки без промпта', async () => {
    const { api, edit } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Нарисовать вариацию кот.png' }))
    await waitFor(() => expect(edit).toHaveBeenCalledWith(expect.objectContaining({ path: 'кот.png' })))
    expect(edit.mock.calls[0]![0].prompt).toMatch(/вариант/)

    fireEvent.click(screen.getByRole('button', { name: 'Дублировать кот.png' }))
    await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: 'кот-копия.png' })))
  })

  it('при большой галерее появляются фильтр и сортировка', async () => {
    const { api } = makeApi(Array.from({ length: 8 }, (_, index) => ({ path: `файл-${index}.png` })))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const filterField = await screen.findByRole('textbox', { name: 'Фильтр по имени файла' })
    fireEvent.change(filterField, { target: { value: 'файл-3' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    fireEvent.change(filterField, { target: { value: 'нет такого' } })
    expect(await screen.findByText('Ничего не нашлось')).toBeInTheDocument()
  })

  it('использованный промпт остаётся чипом и подставляется кликом', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const promptField = await screen.findByRole('textbox', { name: 'Промпт для изображения' })
    fireEvent.change(promptField, { target: { value: 'кот в сапогах' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    await waitFor(() => expect((promptField as HTMLTextAreaElement).value).toBe(''))
    fireEvent.click(await screen.findByRole('button', { name: 'кот в сапогах' }))
    expect((promptField as HTMLTextAreaElement).value).toBe('кот в сапогах')
  })

  it('пустая галерея объясняет следующий шаг', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    expect(await screen.findByText(/нарисуйте первую картинку/)).toBeInTheDocument()
  })
})
