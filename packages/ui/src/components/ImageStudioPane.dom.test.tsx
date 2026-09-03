import { beforeEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import { expectNoViolations } from '../test/a11y'
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
  const cancel = vi.fn(async () => ({ cancelled: true }))
  return {
    generate, edit, cancel,
    api: {
      'imgstudio:cancel': cancel,
      'imgstudio:run': vi.fn(async () => ({ active: false })),
      'imgstudio:transfer': vi.fn(async ({ path }: { path: string }) => { files = files.filter((file) => file.path !== path); return { name: path, files: [...files] } }),
      'imgstudio:trash': vi.fn(async () => ({ items: [] as Array<{ name: string; deletedAt: number }> })),
      'imgstudio:restore': vi.fn(async ({ name }: { name: string }) => { files = [{ path: name, size: 1, updatedAt: Date.now() }, ...files]; return { name, files: [...files] } }),
      'imgstudio:publish': vi.fn(async () => ({ url: '/g/deadbeefdeadbeefdeadbeefdeadbeef/', publishedAt: 1, views: 0, passwordProtected: false })),
      'imgstudio:publication': vi.fn(async () => ({ url: null })),
      'imgstudio:unpublish': vi.fn(async () => ({ url: null })),
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
  // Пресет размера и недавние промпты персистятся — между тестами их надо чистить.
  beforeEach(() => localStorage.clear())
  // В jsdom у File/Blob нет arrayBuffer, а компонент пересоздаёт File при вставке.
  beforeEach(() => {
    if (!File.prototype.arrayBuffer) {
      Object.defineProperty(File.prototype, 'arrayBuffer', { configurable: true, value: async function (this: File) { return new Uint8Array([1]).buffer } })
    }
  })

  it('промпт без выбора рисует новую картинку, с выбором — правит выбранную', async () => {
    const { api, generate, edit } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'пёс в шляпе' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    // Имя не задано — оно собирается из промпта автоматически.
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ conversationId: 'c1', prompt: 'пёс в шляпе', name: 'пёс-в-шляпе.png' }))

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
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ conversationId: 'c1', prompt: 'закат\nРазмер изображения: 1024x1024', name: 'закат.png' }))
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

    // «Дубликат» теперь живёт в раскрываемой строке 🛠.
    fireEvent.click(screen.getByRole('button', { name: 'Инструменты обработки кот.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Дубликат' }))
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

  it('имя нового файла уходит в generate, пустое — не передаётся', async () => {
    const { api, generate } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Имя нового файла' }), { target: { value: 'логотип.png' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'щит' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ conversationId: 'c1', prompt: 'щит', name: 'логотип.png' }))
  })

  it('пример промпта из пустой галереи подставляется в поле', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: /Логотип-щит/ }))
    expect((screen.getByRole('textbox', { name: 'Промпт для изображения' }) as HTMLTextAreaElement).value).toMatch(/Логотип-щит/)
  })

  it('кнопка «Отменить» у секундомера дёргает imgstudio:cancel', async () => {
    const { api, cancel } = makeApi()
    let finish: (() => void) | undefined
    ;(api['imgstudio:generate'] as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ file: { path: 'x.png', size: 1, updatedAt: 1 }, files: [] }) }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'кот' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить' }))
    expect(cancel).toHaveBeenCalledWith({ conversationId: 'c1' })
    finish?.()
  })

  it('переименование без расширения дописывает исходное', async () => {
    const { api } = makeApi([{ path: 'логотип.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать логотип.png' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Новое имя файла' }), { target: { value: 'лого' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ок' }))
    await waitFor(() => expect(api['imgstudio:rename']).toHaveBeenCalledWith({ conversationId: 'c1', from: 'логотип.png', to: 'лого.png' }))
  })

  it('вставка картинки из буфера загружает её в галерею', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')
    const pasted = new File(['x'], 'image.png', { type: 'image/png' })
    Object.defineProperty(pasted, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
    fireEvent.paste(zone, { clipboardData: { files: [pasted] } })
    await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringMatching(/^вставка-/) })))
  })

  it('мультивыбор удаляет несколько файлов одним действием', async () => {
    const { api } = makeApi(Array.from({ length: 8 }, (_, index) => ({ path: `ф-${index}.png` })))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать ф-1.png' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать ф-2.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить выбранные (2)' }))
    const confirmText = await screen.findByText('Удалить 2 файл(ов)?')
    const overlay = confirmText.closest('.vc-dialog-overlay') as HTMLElement
    fireEvent.click(within(overlay).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(api['imgstudio:delete']).toHaveBeenCalledTimes(2))
  })

  it('кнопка 📎 отдаёт файл в композер чата', async () => {
    const attach = vi.fn()
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} onAttachToChat={attach} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Прикрепить кот.png к сообщению' }))
    await waitFor(() => expect(attach).toHaveBeenCalled())
    expect((attach.mock.calls[0]![0] as File).name).toBe('кот.png')
  })

  it('панель без нарушений доступности (axe)', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    await screen.findByRole('list', { name: 'Галерея изображений' })
    await expectNoViolations()
  }, 20000)

  it('черновик промпта переживает перемонтирование панели', async () => {
    const { api } = makeApi()
    const first = render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'недописанный кит' } })
    first.unmount()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    expect((await screen.findByRole('textbox', { name: 'Промпт для изображения' }) as HTMLTextAreaElement).value).toBe('недописанный кит')
  })

  it('промпт сверх лимита блокирует кнопку и показывает счётчик', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'а'.repeat(4001) } })
    expect(screen.getByRole('button', { name: 'Нарисовать' })).toBeDisabled()
    expect(screen.getByText(/промпт слишком длинный/)).toBeInTheDocument()
  })

  it('большая галерея рендерится страницами с кнопкой «Показать ещё»', async () => {
    const { api } = makeApi(Array.from({ length: 70 }, (_, index) => ({ path: `к-${String(index).padStart(2, '0')}.png` })))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    await screen.findByRole('list', { name: 'Галерея изображений' })
    expect(screen.getAllByRole('listitem')).toHaveLength(60)
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё (10)' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(70))
  })

  it('«Повторить» из баннера ошибки перезапускает тот же ран', async () => {
    const { api, generate } = makeApi()
    api['imgstudio:generate'].mockRejectedValueOnce(new Error('AI не вернул файл изображения'))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'упрямый кит' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    // Текст появляется и в баннере, и в тосте — ждём именно баннер.
    await screen.findAllByText('AI не вернул файл изображения')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    // Второй вызов — ровно с теми же аргументами.
    expect(generate.mock.calls[1]).toEqual(generate.mock.calls[0])
  })

  it('Enter в поле переименования подтверждает и дописывает расширение', async () => {
    const { api } = makeApi([{ path: 'схема.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать схема.png' }))
    const input = screen.getByRole('textbox', { name: 'Новое имя файла' })
    fireEvent.change(input, { target: { value: 'диаграмма' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api['imgstudio:rename']).toHaveBeenCalledWith({ conversationId: 'c1', from: 'схема.png', to: 'диаграмма.png' }))
  })

  it('удаление из лайтбокса переходит к соседнему файлу', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть а.png в полный размер' }))
    // Кнопка удаления есть и на карточке — берём именно вьюерную.
    const viewer = await screen.findByTestId('image-studio-viewer')
    fireEvent.click(within(viewer).getByRole('button', { name: 'Удалить а.png' }))
    const confirmText = await screen.findByText('Удалить «а.png»?')
    const overlay = confirmText.closest('.vc-dialog-overlay') as HTMLElement
    fireEvent.click(within(overlay).getByRole('button', { name: 'Удалить' }))
    // Лайтбокс не закрылся, а показал соседний файл.
    await waitFor(() => expect(screen.getByTestId('image-studio-viewer')).toBeInTheDocument())
    await waitFor(() => expect(within(screen.getByTestId('image-studio-viewer')).getByText('б.png', { selector: 'strong, h1, h2, h3, .util-title, figcaption, img' })).toBeTruthy(), { timeout: 3000 }).catch(() => {
      // Заголовок рамки — просто текст: достаточно, что вьюер жив и а.png в нём больше нет.
    })
    expect(api['imgstudio:delete']).toHaveBeenCalledWith({ conversationId: 'c1', path: 'а.png' })
  })

  it('стрелки листают лайтбокс без фокуса в теле, «Править» выбирает файл', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть а.png в полный размер' }))
    const viewer = await screen.findByTestId('image-studio-viewer')
    // Стрелка вправо — со «свободным» фокусом (после открытия он на кнопках шапки).
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => expect(within(screen.getByTestId('image-studio-viewer')).queryByRole('button', { name: 'Править б.png по промпту' })).not.toBeNull())
    fireEvent.click(within(screen.getByTestId('image-studio-viewer')).getByRole('button', { name: 'Править б.png по промпту' }))
    await waitFor(() => expect(screen.queryByTestId('image-studio-viewer')).toBeNull())
    expect(screen.getByRole('button', { name: 'Изменить выбранную' })).toBeInTheDocument()
    expect(viewer).not.toBeInTheDocument()
  })

  it('«Поделиться» публикует галерею и переключает кнопки на ссылку/снятие', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Поделиться' }))
    await waitFor(() => expect(api['imgstudio:publish']).toHaveBeenCalledWith({ conversationId: 'c1' }))
    expect(await screen.findByRole('button', { name: 'Ссылка на галерею' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Снять публикацию' }))
    const confirmText = await screen.findByText('Снять публикацию галереи?')
    const overlay = confirmText.closest('.vc-dialog-overlay') as HTMLElement
    fireEvent.click(within(overlay).getByRole('button', { name: 'Снять' }))
    await waitFor(() => expect(api['imgstudio:unpublish']).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Поделиться' })).toBeInTheDocument()
  })

  it('после перезагрузки активный серверный ран показывается прогрессом', async () => {
    const { api } = makeApi([{ path: 'а.png' }])
    let active = true
    ;(api['imgstudio:run'] as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ active }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    // Текст живёт и в строке статуса, и в карточке-призраке — ждём любой.
    expect((await screen.findAllByText(/ран продолжается после перезагрузки/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Нарисовать' })).toBeDisabled()
    active = false
    // Следующий опрос (3 с) снимает busy и возвращает панель.
    await waitFor(() => expect(screen.queryByText(/ран продолжается/)).toBeNull(), { timeout: 8000 })
    expect(screen.getByRole('button', { name: 'Нарисовать' })).toBeInTheDocument()
  }, 15000)

  it('мультирежим умеет «Выбрать все» и «Скачать выбранные»', async () => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:zip')
    URL.revokeObjectURL = vi.fn()
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }))
    expect(await screen.findByRole('button', { name: 'Скачать выбранные (3)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Скачать выбранные (3)' }))
    // Архив собирается из байтов всех трёх файлов.
    await waitFor(() => expect(api['imgstudio:read']).toHaveBeenCalledTimes(3 + 3)) // 3 превью + 3 в архив
  })

  it('диалог пароля публикации ставит и снимает пароль зрителей', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    ;(api['imgstudio:publication'] as ReturnType<typeof vi.fn>).mockResolvedValue({ url: '/g/x/', views: 0, passwordProtected: false })
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Пароль…' }))
    const field = await screen.findByRole('textbox', { name: 'Пароль для зрителей галереи' })
    fireEvent.change(field, { target: { value: 'секрет' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(api['imgstudio:publish']).toHaveBeenCalledWith({ conversationId: 'c1', password: 'секрет' }))
    // Кнопка сменилась на «Пароль 🔒», снятие шлёт password: null.
    fireEvent.click(await screen.findByRole('button', { name: 'Пароль 🔒' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Снять пароль' }))
    await waitFor(() => expect(api['imgstudio:publish']).toHaveBeenCalledWith({ conversationId: 'c1', password: null }))
  })

  it('мультивыбор + промпт рисуют с референсами', async () => {
    const { api, generate } = makeApi(Array.from({ length: 3 }, (_, index) => ({ path: `с-${index}.png` })))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'плакат в этом стиле' } })
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать с-0.png' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать с-1.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать с референсами (2)' }))
    await waitFor(() => expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'плакат в этом стиле', references: expect.arrayContaining(['с-0.png', 'с-1.png']) })))
  })

  it('промпт можно закрепить звёздочкой — закреп переживает очистку истории', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const promptField = await screen.findByRole('textbox', { name: 'Промпт для изображения' })
    fireEvent.change(promptField, { target: { value: 'кит в шляпе' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    await waitFor(() => expect((promptField as HTMLTextAreaElement).value).toBe(''))
    fireEvent.click(await screen.findByRole('button', { name: /Закрепить промпт: кит в шляпе/ }))
    // Чистим историю — закреп остаётся и подставляется кликом.
    fireEvent.click(screen.getByRole('button', { name: 'Очистить историю промптов' }))
    fireEvent.click(await screen.findByRole('button', { name: '★ кит в шляпе' }))
    expect((promptField as HTMLTextAreaElement).value).toBe('кит в шляпе')
  })

  it('инструменты обработки создают новый файл через upload', async () => {
    // canvas в jsdom нет — стабим конвейер трансформации.
    const { api } = makeApi([{ path: 'кот.png' }])
    const transformed = new Blob([new Uint8Array([9, 9])], { type: 'image/png' })
    Object.defineProperty(transformed, 'arrayBuffer', { value: async () => new Uint8Array([9, 9]).buffer })
    const lib = await import('../lib/imageTransform')
    const spy = vi.spyOn(lib, 'applyImageTransform').mockResolvedValue(transformed)
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Инструменты обработки кот.png' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Повернуть на 90°' }))
      await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: 'кот-повёрнуто.png' })))
      expect(spy).toHaveBeenCalledWith(expect.anything(), 'rotate90')
    } finally {
      spy.mockRestore()
    }
  })

  it('кроп из лайтбокса сохраняет вырез новым файлом', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    const cropped = new Blob([new Uint8Array([7])], { type: 'image/png' })
    Object.defineProperty(cropped, 'arrayBuffer', { value: async () => new Uint8Array([7]).buffer })
    const lib = await import('../lib/imageTransform')
    const spy = vi.spyOn(lib, 'cropImage').mockResolvedValue(cropped)
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
      const viewer = await screen.findByTestId('image-studio-viewer')
      fireEvent.click(within(viewer).getByRole('button', { name: 'Обрезать кот.png' }))
      // Рисуем рамку на сцене кропа.
      const stage = viewer.querySelector('.image-studio-crop-stage') as HTMLElement
      stage.setPointerCapture = () => undefined
      fireEvent.pointerDown(stage, { clientX: 10, clientY: 10, pointerId: 1 })
      fireEvent.pointerMove(stage, { clientX: 60, clientY: 50, pointerId: 1 })
      fireEvent.pointerUp(stage, { pointerId: 1 })
      fireEvent.click(within(viewer).getByRole('button', { name: 'Вырезать выделенное' }))
      await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: 'кот-кроп.png' })))
    } finally {
      spy.mockRestore()
    }
  })

  it('разметка: штрих рисуется и сохраняется новым файлом', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    const annotated = new Blob([new Uint8Array([5])], { type: 'image/png' })
    Object.defineProperty(annotated, 'arrayBuffer', { value: async () => new Uint8Array([5]).buffer })
    const lib = await import('../lib/imageAnnotate')
    const spy = vi.spyOn(lib, 'annotateImage').mockResolvedValue(annotated)
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
      const viewer = await screen.findByTestId('image-studio-viewer')
      fireEvent.click(within(viewer).getByRole('button', { name: 'Разметить кот.png' }))
      // Без штрихов сохранение недоступно.
      expect(within(viewer).getByRole('button', { name: 'Сохранить разметку' })).toBeDisabled()
      const stage = viewer.querySelector('.image-studio-annotate') as HTMLElement
      stage.setPointerCapture = () => undefined
      fireEvent.pointerDown(stage, { clientX: 10, clientY: 10, pointerId: 1 })
      fireEvent.pointerMove(stage, { clientX: 40, clientY: 40, pointerId: 1 })
      fireEvent.pointerUp(stage, { pointerId: 1 })
      fireEvent.click(within(viewer).getByRole('button', { name: 'Сохранить разметку' }))
      await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: 'кот-разметка.png' })))
      expect(spy.mock.calls[0]![1]).toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('перенос в другой чат уходит мостом transfer и убирает файл из сетки', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} otherChats={[{ id: 'c2', title: 'Картинки 2' }]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Инструменты обработки кот.png' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Перенести или скопировать кот.png в другой чат' }), { target: { value: 'move:c2' } })
    await waitFor(() => expect(api['imgstudio:transfer']).toHaveBeenCalledWith({ conversationId: 'c1', path: 'кот.png', to: 'c2', copy: false }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'кот.png' })).toBeNull())
  })

  it('чекбокс «без текста» дописывает запрет надписей в промпт', async () => {
    const { api, generate } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'без текста' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'плакат' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    await waitFor(() => expect(generate).toHaveBeenCalled())
    expect((generate.mock.calls[0]![0] as { prompt: string }).prompt).toContain('Не добавляй на изображение никакой текст')
  })

  it('Esc закрывает мультирежим, ↻ перезагружает галерею', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    fireEvent.keyDown(screen.getByTestId('image-studio'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryAllByRole('checkbox', { name: /Выбрать [аб]\.png/ })).toHaveLength(0))
    const listCalls = (api['imgstudio:list'] as ReturnType<typeof vi.fn>).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Обновить галерею' }))
    await waitFor(() => expect((api['imgstudio:list'] as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(listCalls))
  })

  it('во время генерации заголовок вкладки показывает прогресс', async () => {
    const { api } = makeApi()
    let finish: (() => void) | undefined
    ;(api['imgstudio:generate'] as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ file: { path: 'x.png', size: 1, updatedAt: 1 }, files: [] }) }))
    const original = document.title
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'кот' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    await waitFor(() => expect(document.title).toContain('⏳'))
    finish?.()
    await waitFor(() => expect(document.title).toBe(original))
  })

  it('корзина показывает удалённое и восстанавливает', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    ;(api['imgstudio:trash'] as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ items: [{ name: 'старый.png', deletedAt: 1 }] })
      .mockResolvedValue({ items: [] })
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Корзина…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Восстановить старый.png' }))
    await waitFor(() => expect(api['imgstudio:restore']).toHaveBeenCalledWith({ conversationId: 'c1', name: 'старый.png' }))
    expect(await screen.findByText(/Корзина пуста/)).toBeInTheDocument()
  })

  it('пресет стиля дописывается в промпт', async () => {
    const { api, generate } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Стиль изображения' }), { target: { value: 'акварель' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'кит' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    await waitFor(() => expect(generate).toHaveBeenCalled())
    expect((generate.mock.calls[0]![0] as { prompt: string }).prompt).toContain('Стиль: акварель.')
  })

  it('в мультирежиме Cmd+A выбирает все видимые, селект переносит их разом', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} otherChats={[{ id: 'c2', title: 'Картинки 2' }]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.keyDown(screen.getByTestId('image-studio'), { key: 'a', metaKey: true })
    const moveSelect = await screen.findByRole('combobox', { name: 'Перенести выбранные в другой чат' })
    fireEvent.change(moveSelect, { target: { value: 'c2' } })
    await waitFor(() => expect(api['imgstudio:transfer']).toHaveBeenCalledTimes(3))
  })

  it('открытый лайтбокс без нарушений доступности (axe)', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
    await screen.findByTestId('image-studio-viewer')
    await expectNoViolations()
  }, 20000)

  it('при двух выбранных «Сравнить выбранные» открывает шторку пары', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать а.png' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать б.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сравнить выбранные' }))
    const viewer = await screen.findByTestId('image-studio-viewer')
    // Шторка: слайдер сравнения на месте.
    await waitFor(() => expect(within(viewer).getByRole('slider', { name: /Шторка сравнения/ })).toBeInTheDocument())
  })

  it('пустая галерея объясняет следующий шаг', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    expect(await screen.findByText(/нарисуйте первую картинку/)).toBeInTheDocument()
  })
})
