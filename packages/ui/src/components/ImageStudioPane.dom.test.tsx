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

  it('пустая галерея объясняет следующий шаг', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    expect(await screen.findByText(/нарисуйте первую картинку/)).toBeInTheDocument()
  })
})
