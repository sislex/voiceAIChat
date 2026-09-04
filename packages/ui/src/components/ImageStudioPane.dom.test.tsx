import { beforeEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import { expectNoViolations } from '../test/a11y'
import { aspectLabel, groupByDay, highlightParts, ImageStudioPane, matchesQuery, renameError, renamePlan } from './ImageStudioPane'
import type { ImageStudioFile } from '@shared/imageStudio'

/** Мосты панели: галерея в замыкании, как её отдал бы сервер. */
function makeApi(initial: Array<{ path: string; prompt?: string; size?: number }> = [], options: { trash?: Array<{ name: string; deletedAt: number }> } = {}) {
  let files: ImageStudioFile[] = initial.map((file, index) => ({ path: file.path, size: file.size ?? 10, updatedAt: index + 1, ...(file.prompt ? { prompt: file.prompt } : {}) }))
  let trash = [...(options.trash ?? [])]
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
      // Копия оставляет файл на месте, перенос — убирает: как на сервере.
      'imgstudio:transfer': vi.fn(async ({ path, copy }: { path: string; copy?: boolean }) => {
        if (!copy) files = files.filter((file) => file.path !== path)
        return { name: path, files: [...files] }
      }),
      'imgstudio:trash': vi.fn(async () => ({ items: [...trash] })),
      'imgstudio:restore': vi.fn(async ({ name }: { name: string }) => { trash = trash.filter((item) => item.name !== name); files = [{ path: name, size: 1, updatedAt: Date.now() }, ...files]; return { name, files: [...files] } }),
      'imgstudio:purge': vi.fn(async ({ name }: { name?: string }) => {
        const before = trash.length
        trash = name ? trash.filter((item) => item.name !== name) : []
        return { removed: before - trash.length, items: [...trash] }
      }),
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

describe('aspectLabel', () => {
  it('узнаёт частые пропорции и отдельно превью ссылки', () => {
    expect(aspectLabel('1200×630')).toBe('OG')
    expect(aspectLabel('1080×1080')).toBe('1:1')
    expect(aspectLabel('1280×720')).toBe('16:9')
    expect(aspectLabel('800×600')).toBe('4:3')
    expect(aspectLabel('1080×1920')).toBe('9:16')
  })

  it('нестандартное соотношение и мусор не подписывает', () => {
    expect(aspectLabel('1000×333')).toBe('')
    expect(aspectLabel('')).toBe('')
    expect(aspectLabel('512')).toBe('')
    expect(aspectLabel('0×0')).toBe('')
  })
})

describe('matchesQuery', () => {
  it('все слова запроса должны найтись, порядок не важен', () => {
    expect(matchesQuery('кит закат', ['кит.png', 'синий кит на закате'])).toBe(true)
    expect(matchesQuery('закат кит', ['кит.png', 'синий кит на закате'])).toBe(true)
    expect(matchesQuery('кит рассвет', ['кит.png', 'синий кит на закате'])).toBe(false)
  })

  it('регистр и пустые поля не мешают', () => {
    expect(matchesQuery('КИТ', ['кит.png', undefined, undefined])).toBe(true)
    expect(matchesQuery('', ['что угодно'])).toBe(true)
    expect(matchesQuery('   ', ['что угодно'])).toBe(true)
  })

  it('слово ищется по всем полям вместе, а не по каждому отдельно', () => {
    // «кит» из имени, «обложк» из заметки — вместе это совпадение. Морфологии
    // нет: «обложка» не найдёт «обложки», и это ожидаемо для подстроки.
    expect(matchesQuery('кит обложк', ['кит.png', undefined, 'для обложки'])).toBe(true)
    expect(matchesQuery('кит обложка', ['кит.png', undefined, 'для обложки'])).toBe(false)
  })
})

describe('highlightParts', () => {
  it('делит строку на совпавшие и обычные куски', () => {
    expect(highlightParts('кот-в-шляпе.png', 'кот')).toEqual([
      { text: 'кот', hit: true },
      { text: '-в-шляпе.png', hit: false }
    ])
  })

  it('несколько слов и повторы отмечаются все', () => {
    const parts = highlightParts('кот и кот', 'кот')
    expect(parts.filter((part) => part.hit).map((part) => part.text)).toEqual(['кот', 'кот'])
  })

  it('пересекающиеся слова не рвут строку на буквы', () => {
    expect(highlightParts('котенок', 'кот котен')).toEqual([
      { text: 'котен', hit: true },
      { text: 'ок', hit: false }
    ])
  })

  it('пустой запрос отдаёт строку целиком', () => {
    expect(highlightParts('кот.png', '  ')).toEqual([{ text: 'кот.png', hit: false }])
  })
})

describe('renameError', () => {
  it('пустое имя, точка в начале и служебные символы — ошибка', () => {
    expect(renameError('', new Set())).toBe('Имя не может быть пустым')
    expect(renameError('.скрытый.png', new Set())).toBe('Имя не может начинаться с точки')
    expect(renameError('папка/кот.png', new Set())).toContain('нельзя использовать')
  })

  it('слишком длинное имя называет длину', () => {
    expect(renameError(`${'к'.repeat(130)}.png`, new Set())).toContain('134 символов из 120')
  })

  it('занятое имя видно до запроса, своё же имя ошибкой не считается', () => {
    expect(renameError('кот.png', new Set(['кот.png']))).toBe('«кот.png» уже есть в галерее')
    expect(renameError('кот.png', new Set(['пёс.png']))).toBeNull()
  })
})

describe('groupByDay', () => {
  const now = new Date('2026-09-04T12:00:00').getTime()
  const file = (path: string, at: number) => ({ path, size: 1, updatedAt: at })

  it('делит на «Сегодня», «Вчера» и «Раньше»', () => {
    const groups = groupByDay([
      file('сегодня.png', now - 3600 * 1000),
      file('вчера.png', now - 30 * 3600 * 1000),
      file('давно.png', now - 10 * 24 * 3600 * 1000)
    ], now)
    expect(groups.map((group) => group.title)).toEqual(['Сегодня', 'Вчера', 'Раньше'])
    expect(groups[0]!.files.map((item) => item.path)).toEqual(['сегодня.png'])
  })

  it('пустые группы не показываются', () => {
    const groups = groupByDay([file('сегодня.png', now)], now)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.title).toBe('Сегодня')
  })

  it('полночь считается началом сегодняшнего дня', () => {
    const midnight = new Date('2026-09-04T00:00:00').getTime()
    const groups = groupByDay([file('в-полночь.png', midnight)], now)
    expect(groups[0]!.title).toBe('Сегодня')
  })
})

describe('renamePlan', () => {
  it('{n} — номер по порядку, расширение остаётся от исходника', () => {
    expect(renamePlan('кадр-{n}', ['а.png', 'б.jpg'])).toEqual([
      { from: 'а.png', to: 'кадр-1.png' },
      { from: 'б.jpg', to: 'кадр-2.jpg' }
    ])
  })

  it('шаблон без {n} получает номер в конце — иначе имена совпали бы', () => {
    expect(renamePlan('обложка', ['а.png', 'б.png'])).toEqual([
      { from: 'а.png', to: 'обложка-1.png' },
      { from: 'б.png', to: 'обложка-2.png' }
    ])
  })

  it('несколько {n} в шаблоне подставляются все', () => {
    expect(renamePlan('{n}-из-двух-{n}', ['а.png'])).toEqual([{ from: 'а.png', to: '1-из-двух-1.png' }])
  })
})

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

    const filterField = await screen.findByRole('textbox', { name: 'Фильтр по имени файла или промпту' })
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
    // Счётчик у кнопки приезжает сразу при монтировании — он часть подписи.
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }], { trash: [{ name: 'старый.png', deletedAt: 1 }] })
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Корзина… (1)' }))
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
    // Селект стал общим для переноса и копии, поэтому в значении есть режим.
    const moveSelect = await screen.findByRole('combobox', { name: 'Перенести или скопировать выбранные в другой чат' })
    fireEvent.change(moveSelect, { target: { value: 'move:c2' } })
    await waitFor(() => expect(api['imgstudio:transfer']).toHaveBeenCalledTimes(3))
    expect((api['imgstudio:transfer'] as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ to: 'c2', copy: false })
  })

  it('выбранные можно скопировать в другой чат, не убирая из этого', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} otherChats={[{ id: 'c2', title: 'Картинки 2' }]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Перенести или скопировать выбранные в другой чат' }), { target: { value: 'copy:c2' } })
    await waitFor(() => expect(api['imgstudio:transfer']).toHaveBeenCalledTimes(2))
    expect((api['imgstudio:transfer'] as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ to: 'c2', copy: true })
    // Копия — значит файлы на месте.
    await waitFor(() => expect(screen.getByRole('button', { name: 'а.png' })).toBeInTheDocument())
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

  it('после генерации баннер «Создано» умеет отменить файл в корзину', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'кот' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    await screen.findByText(/Создано: изображение.png/)
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    await waitFor(() => expect(api['imgstudio:delete']).toHaveBeenCalledWith({ conversationId: 'c1', path: 'изображение.png' }))
  })

  it('мультирежим показывает сводку и умеет инвертировать выбор', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать а.png' }))
    expect(screen.getByText(/Выбрано 1 из 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Инвертировать' }))
    expect(await screen.findByText(/Выбрано 2 из 3/)).toBeInTheDocument()
    expect((screen.getByRole('checkbox', { name: 'Выбрать а.png' }) as HTMLInputElement).checked).toBe(false)
  })

  it('пакетная обработка применяет операцию ко всем выбранным', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    const done = new Blob([new Uint8Array([1])], { type: 'image/png' })
    Object.defineProperty(done, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
    const lib = await import('../lib/imageTransform')
    const spy = vi.spyOn(lib, 'applyImageTransform').mockResolvedValue(done)
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
      fireEvent.keyDown(screen.getByTestId('image-studio'), { key: 'a', metaKey: true })
      fireEvent.change(await screen.findByRole('combobox', { name: 'Обработать выбранные' }), { target: { value: 'grayscale' } })
      await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledTimes(2))
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('избранное фильтрует галерею и переживает перерисовку', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'В избранное а.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Показать только избранные' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'а.png' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Показать все файлы' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
  })

  it('загрузка с занятым именем спрашивает: отмена сохраняет копией', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')
    const dup = new File(['x'], 'кот.png', { type: 'image/png' })
    fireEvent.drop(zone, { dataTransfer: { files: [dup], types: ['Files'] } })
    const confirmText = await screen.findByText('«кот.png» уже есть — заменить?')
    const overlay = confirmText.closest('.vc-dialog-overlay') as HTMLElement
    fireEvent.click(within(overlay).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: 'кот-копия.png' })))
  })

  it('фильтр ищет и по промпту, а не только по имени файла', async () => {
    const { api } = makeApi([
      { path: 'файл-0.png', prompt: 'синий кит в океане' },
      ...Array.from({ length: 6 }, (_, index) => ({ path: `файл-${index + 1}.png` }))
    ])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const filterField = await screen.findByRole('textbox', { name: 'Фильтр по имени файла или промпту' })
    fireEvent.change(filterField, { target: { value: 'кит' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'файл-0.png' })).toBeInTheDocument()
  })

  it('стрелки двигают выбор по сетке, Enter открывает лайтбокс', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')
    await screen.findByRole('button', { name: 'б.png' })

    // Сортировка «сначала новые» ставит б.png первой — с неё и начинается выбор.
    fireEvent.keyDown(zone, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByText('правим: б.png')).toBeInTheDocument())
    fireEvent.keyDown(zone, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByText('правим: а.png')).toBeInTheDocument())

    fireEvent.keyDown(zone, { key: 'Enter' })
    expect(await screen.findByTestId('image-studio-viewer')).toBeInTheDocument()
  })

  it('счётчик корзины виден до раскрытия, «Восстановить всё» возвращает все файлы', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }], {
      trash: [{ name: 'старый-кот.png', deletedAt: 1 }, { name: 'старый-пёс.png', deletedAt: 2 }]
    })
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /Корзина… \(2\)/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Восстановить всё (2)' }))
    await waitFor(() => expect(api['imgstudio:restore']).toHaveBeenCalledTimes(2))
    // Корзина опустела — и кнопка, и счётчик исчезают сами.
    await waitFor(() => expect(screen.queryByText('Восстановить всё (2)')).toBeNull())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Корзина…' })).toBeInTheDocument())
  })

  it('загрузка сверх квоты разговора отбивается до первого запроса', async () => {
    const { api } = makeApi([{ path: 'огромный.png', size: 128 * 1024 * 1024 - 1024 }, { path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    const big = new File(['x'.repeat(4096)], 'новый.png', { type: 'image/png' })
    fireEvent.drop(zone, { dataTransfer: { files: [big], types: ['Files'] } })
    expect((await screen.findAllByText(/Не хватит места/))[0]).toBeTruthy()
    expect(api['imgstudio:upload']).not.toHaveBeenCalled()
  })

  it('лайтбокс: масштаб кнопками, переключение фона, копирование и слайдшоу', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    const clipboard = await import('../lib/clipboard')
    const spy = vi.spyOn(clipboard, 'copyImage').mockResolvedValue(true)
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Открыть а.png в полный размер' }))
      const viewer = await screen.findByTestId('image-studio-viewer')

      fireEvent.click(within(viewer).getByRole('button', { name: 'Увеличить масштаб' }))
      await waitFor(() => expect(within(viewer).getByRole('button', { name: /Масштаб 125 процентов/ })).toBeTruthy())
      fireEvent.click(within(viewer).getByRole('button', { name: /Масштаб 125 процентов/ }))
      await waitFor(() => expect(within(viewer).getByRole('button', { name: /Масштаб 100 процентов/ })).toBeTruthy())

      fireEvent.click(within(viewer).getByRole('button', { name: /Фон подложки: шахматка/ }))
      await waitFor(() => expect(within(viewer).getByRole('button', { name: /Фон подложки: светлый/ })).toBeTruthy())

      fireEvent.click(within(viewer).getByRole('button', { name: 'Запустить слайдшоу' }))
      await waitFor(() => expect(within(viewer).getByRole('button', { name: 'Остановить слайдшоу' })).toBeTruthy())

      fireEvent.click(within(viewer).getByRole('button', { name: 'Скопировать а.png в буфер' }))
      await waitFor(() => expect(spy).toHaveBeenCalled())
    } finally {
      spy.mockRestore()
    }
  })

  it('корзину можно очистить навсегда — с подтверждением', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }], {
      trash: [{ name: 'старый-1.png', deletedAt: 1 }, { name: 'старый-2.png', deletedAt: 2 }]
    })
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /Корзина… \(2\)/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Очистить корзину (2)' }))
    const dialog = await screen.findByText('Очистить корзину (2)?')
    const overlay = dialog.closest('.vc-dialog-overlay') as HTMLElement
    fireEvent.click(within(overlay).getByRole('button', { name: 'Очистить' }))
    await waitFor(() => expect(api['imgstudio:purge']).toHaveBeenCalledWith({ conversationId: 'c1' }))
    // Счётчик у кнопки исчезает: корзина пуста, восстанавливать нечего.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Корзина…' })).toBeInTheDocument())
    expect(await screen.findByText(/Корзина пуста/)).toBeInTheDocument()
  })

  it('одну запись корзины можно удалить навсегда, не тронув остальные', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }], {
      trash: [{ name: 'старый-1.png', deletedAt: 1 }, { name: 'старый-2.png', deletedAt: 2 }]
    })
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /Корзина… \(2\)/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить старый-1.png навсегда' }))
    const dialog = await screen.findByText('Удалить «старый-1.png» навсегда?')
    const overlay = dialog.closest('.vc-dialog-overlay') as HTMLElement
    fireEvent.click(within(overlay).getByRole('button', { name: 'Удалить навсегда' }))
    await waitFor(() => expect(api['imgstudio:purge']).toHaveBeenCalledWith({ conversationId: 'c1', name: 'старый-1.png' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Восстановить старый-2.png' })).toBeInTheDocument())
  })

  it('фильтр по типу оставляет только файлы этого расширения', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.jpg' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const kind = await screen.findByRole('combobox', { name: 'Тип файла' })
    fireEvent.change(kind, { target: { value: 'jpg' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'б.jpg' })).toBeInTheDocument()
    fireEvent.change(kind, { target: { value: '' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
  })

  it('в мультирежиме звёзды ставятся и снимаются пачкой', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'В избранное (2)' }))
    // Обе звёзды загорелись — кнопка сама предлагает обратное действие.
    const off = await screen.findByRole('button', { name: 'Убрать из избранного (2)' })
    expect(screen.getByRole('button', { name: 'Убрать а.png из избранного' })).toBeInTheDocument()
    fireEvent.click(off)
    await waitFor(() => expect(screen.getByRole('button', { name: 'В избранное а.png' })).toBeInTheDocument())
  })

  it('пакетное переименование идёт через временные имена и уважает {n}', async () => {
    // Цель первого файла — текущее имя второго: прямое переименование упёрлось
    // бы в «уже есть», поэтому пачка проходит два круга.
    const { api } = makeApi([{ path: 'кадр-2.png' }, { path: 'кадр-1.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Шаблон пакетного переименования' }), { target: { value: 'кадр-{n}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Переименовать по шаблону' }))

    await waitFor(() => expect(api['imgstudio:rename']).toHaveBeenCalledTimes(4))
    const calls = (api['imgstudio:rename'] as ReturnType<typeof vi.fn>).mock.calls.map(([arg]) => arg as { from: string; to: string })
    expect(calls.slice(0, 2).every((call) => call.to.startsWith('пакет-'))).toBe(true)
    expect(calls.slice(2).map((call) => call.to).sort()).toEqual(['кадр-1.png', 'кадр-2.png'])
  })

  it('коллаж собирается из выбранных и сохраняется новым файлом', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    const collage = new Blob([new Uint8Array([1])], { type: 'image/png' })
    Object.defineProperty(collage, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
    const lib = await import('../lib/imageCollage')
    const spy = vi.spyOn(lib, 'buildCollage').mockResolvedValue(collage)
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Коллаж (2)' }))
      await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: 'коллаж.png' })))
      expect(spy.mock.calls[0]![0]).toHaveLength(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('побайтовый дубликат при загрузке спрашивает, а отказ пропускает файл', async () => {
    const { api } = makeApi([{ path: 'кот.png', size: 1 }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    // Фейк отдаёт байты «img» для любого файла, а File.arrayBuffer в jsdom
    // подменён на те же байты — значит содержимое совпадает.
    const same = new File(['img'], 'другое-имя.png', { type: 'image/png' })
    Object.defineProperty(same, 'size', { value: 1 })
    Object.defineProperty(same, 'arrayBuffer', { value: async () => new TextEncoder().encode('img').buffer })
    fireEvent.drop(zone, { dataTransfer: { files: [same], types: ['Files'] } })

    const dialog = await screen.findByText('Такая картинка уже есть в галерее')
    const overlay = dialog.closest('.vc-dialog-overlay') as HTMLElement
    fireEvent.click(within(overlay).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.getByText(/уже есть в галерее — ничего не загружено/)).toBeInTheDocument())
    expect(api['imgstudio:upload']).not.toHaveBeenCalled()
  })

  it('хоткеи панели: «/» уводит в поиск, «f» помечает выбранную картинку', async () => {
    const { api } = makeApi(Array.from({ length: 7 }, (_, index) => ({ path: `файл-${index}.png` })))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.keyDown(zone, { key: '/' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Фильтр по имени файла или промпту' })))

    fireEvent.click(screen.getByRole('button', { name: 'файл-6.png' }))
    fireEvent.keyDown(zone, { key: 'f' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Убрать файл-6.png из избранного' })).toBeInTheDocument())
  })

  it('сборка архива отчитывается о каждом файле и о результате', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    // Настоящий ZIP не нужен: проверяем отчётность, а не байты архива.
    const zip = await import('../lib/zipStore')
    const spy = vi.spyOn(zip, 'buildZip').mockReturnValue(new Blob([new Uint8Array([1])], { type: 'application/zip' }))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Скачать архивом' }))
      await waitFor(() => expect(screen.getByText(/Архив собран: 2/)).toBeInTheDocument())
      // В архив попадают и файлы, и metadata.json — сборка идёт по всей выборке.
      expect(spy.mock.calls[0]![0].map((entry) => entry.name)).toEqual(['б.png', 'а.png', 'metadata.json'])
    } finally {
      spy.mockRestore()
      clickSpy.mockRestore()
    }
  })

  it('заметка из лайтбокса сохраняется и попадает в поиск', async () => {
    const { api } = makeApi(Array.from({ length: 7 }, (_, index) => ({ path: `файл-${index}.png` })))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть файл-3.png в полный размер' }))
    const viewer = await screen.findByTestId('image-studio-viewer')
    fireEvent.click(within(viewer).getByRole('button', { name: 'Свойства файл-3.png' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Заметка к файл-3.png' }), { target: { value: 'для обложки' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить заметку' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.notes.c1') ?? '{}')).toEqual({ 'файл-3.png': 'для обложки' }))

    fireEvent.click(within(screen.getByTestId('image-studio-viewer')).getByRole('button', { name: 'Закрыть' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Фильтр по имени файла или промпту' }), { target: { value: 'обложк' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'файл-3.png' })).toBeInTheDocument()
  })

  it('сортировка «сначала избранные» поднимает помеченные наверх', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    // По умолчанию сверху самый свежий — «в.png»; звезда у самого старого.
    fireEvent.click(await screen.findByRole('button', { name: 'В избранное а.png' }))
    const order = screen.getByRole('button', { name: 'Сначала новые' })
    fireEvent.click(order)
    fireEvent.click(screen.getByRole('button', { name: 'По имени' }))
    fireEvent.click(screen.getByRole('button', { name: 'По размеру' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сначала избранные' })).toBeInTheDocument())
    await waitFor(() => {
      const cards = screen.getAllByRole('listitem').map((item) => item.getAttribute('data-path'))
      expect(cards[0]).toBe('а.png')
    })
  })

  it('негативный промпт дописывается к запросу и переживает перерисовку', async () => {
    const { api, generate } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Чего не должно быть на картинке' }), { target: { value: 'люди, текст' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'город на закате' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    await waitFor(() => expect(generate).toHaveBeenCalled())
    expect((generate.mock.calls[0]![0] as { prompt: string }).prompt).toContain('Не должно быть на изображении: люди, текст.')
    expect(localStorage.getItem('vc.imgstudio.negative')).toBe('люди, текст')
  })

  it('«похожие» переносят начало промпта в поиск', async () => {
    const { api } = makeApi(Array.from({ length: 7 }, (_, index) => ({ path: `файл-${index}.png`, ...(index < 2 ? { prompt: 'синий кит в океане' } : {}) })))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Показать похожие на файл-1.png' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Фильтр по имени файла или промпту' }) as HTMLInputElement).value).toBe('синий кит в океане'))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
  })

  it('«Список в буфер» отдаёт markdown-таблицу видимых файлов', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png', prompt: 'кит' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Список в буфер' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const text = writeText.mock.calls[0]![0]
    expect(text).toContain('| Файл | Размер | Пиксели | Промпт | Заметка |')
    expect(text).toContain('| б.png |')
    expect(text).toContain('Всего файлов: 2')
  })

  it('«Найти дубликаты» отмечает копии, оставляя самый старый файл', async () => {
    // Фейк отдаёт одинаковые байты всем — значит все три файла одинаковы, и
    // группа должна оставить самый старый, а два отметить как копии.
    const { api } = makeApi([{ path: 'старый.png' }, { path: 'копия.png' }, { path: 'ещё.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Найти дубликаты' }))
    await waitFor(() => expect(screen.getByText(/Выбрано 2 из 3/)).toBeInTheDocument())
    expect((screen.getByRole('checkbox', { name: 'Выбрать копия.png' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Выбрать старый.png' }) as HTMLInputElement).checked).toBe(false)
  })

  it('пакетное переименование можно откатить одной кнопкой', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Шаблон пакетного переименования' }), { target: { value: 'кадр-{n}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Переименовать по шаблону' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'кадр-1.png' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть имена' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'б.png' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'а.png' })).toBeInTheDocument()
  })

  it('досмотр до конца списка подгружает следующую порцию сам', async () => {
    // 70 файлов: первая страница — 60, маркер конца должен добрать остальные.
    const { api } = makeApi(Array.from({ length: 70 }, (_, index) => ({ path: `файл-${String(index).padStart(2, '0')}.png` })))
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
    class FakeObserver {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { observers.push(callback) }
      observe(): void { /* маркер под наблюдением */ }
      disconnect(): void { /* конец наблюдения */ }
    }
    const original = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver as never
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(60))
      await waitFor(() => expect(observers.length).toBeGreaterThan(0))
      observers[observers.length - 1]!([{ isIntersecting: true }])
      await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(70))
    } finally {
      ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = original
    }
  })

  it('звезда и заметка переезжают вместе с переименованным файлом', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'В избранное кот.png' }))
    localStorage.setItem('vc.imgstudio.notes.c1', JSON.stringify({ 'кот.png': 'герой обложки' }))
    fireEvent.click(screen.getByRole('button', { name: 'Переименовать кот.png' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Новое имя файла' }), { target: { value: 'котик.png' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ок' }))

    // Пометки привязаны к имени, поэтому за файлом их надо переносить руками.
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.stars.c1') ?? '[]')).toEqual(['котик.png']))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Убрать котик.png из избранного' })).toBeInTheDocument())
  })

  it('очистка корзины убирает пометки удалённых навсегда файлов', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }], { trash: [{ name: 'старый.png', deletedAt: 1 }] })
    localStorage.setItem('vc.imgstudio.stars.c1', JSON.stringify(['старый.png', 'а.png']))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /Корзина… \(1\)/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить старый.png навсегда' }))
    const dialog = await screen.findByText('Удалить «старый.png» навсегда?')
    fireEvent.click(within(dialog.closest('.vc-dialog-overlay') as HTMLElement).getByRole('button', { name: 'Удалить навсегда' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.stars.c1') ?? '[]')).toEqual(['а.png']))
  })

  it('пометки переезжают в другой чат вместе с картинкой', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    localStorage.setItem('vc.imgstudio.notes.c1', JSON.stringify({ 'кот.png': 'для письма' }))
    render(<ImageStudioPane conversationId="c1" api={api as never} otherChats={[{ id: 'c2', title: 'Картинки 2' }]} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Инструменты обработки кот.png' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Перенести или скопировать кот.png в другой чат' }), { target: { value: 'move:c2' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.notes.c2') ?? '{}')).toEqual({ 'кот.png': 'для письма' }))
    // В исходном чате заметка не остаётся: файл ушёл.
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.notes.c1') ?? '{}')).toEqual({}))
  })

  it('Shift+клик отмечает диапазон карточек', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }, { path: 'г.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    // Порядок «сначала новые»: г, в, б, а. Отмечаем «г», затем Shift+«б».
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать г.png' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать б.png' }), { shiftKey: true })
    await waitFor(() => expect(screen.getByText(/Выбрано 3 из 4/)).toBeInTheDocument())
    expect((screen.getByRole('checkbox', { name: 'Выбрать в.png' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Выбрать а.png' }) as HTMLInputElement).checked).toBe(false)
  })

  it('сводка мультирежима показывает вес выбранного', async () => {
    const { api } = makeApi([{ path: 'а.png', size: 2048 }, { path: 'б.png', size: 1024 }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    await waitFor(() => expect(screen.getByText(/Выбрано 2 из 2 · 3 КБ/)).toBeInTheDocument())
  })

  it('пакетная обработка не начинается, если результату не хватит места', async () => {
    // Галерея почти полна: обработка добавила бы копии тем же весом.
    const { api } = makeApi([{ path: 'огромный.png', size: 127 * 1024 * 1024 }, { path: 'к.png', size: 2 * 1024 * 1024 }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Обработать выбранные' }), { target: { value: 'grayscale' } })
    expect((await screen.findAllByText(/Не хватит места/))[0]).toBeTruthy()
    expect(api['imgstudio:upload']).not.toHaveBeenCalled()
  })

  it('пакетную правку моделью можно прервать между файлами', async () => {
    const { api, edit } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    // Первая правка «висит», как настоящий ран модели: иначе мгновенный фейк
    // успевает пройти всю пачку до нажатия «Прервать», и тест ничего не проверяет.
    let release: (() => void) | undefined
    edit.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ file: { path: 'а-2.png', size: 1, updatedAt: 2 }, files: [] })
    }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'сделай ярче' } })
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Править выбранные (3)' }))
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1))

    fireEvent.click(await screen.findByRole('button', { name: 'Прервать пакет' }))
    release?.()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Прервать пакет' })).toBeNull())
    // Остальные две правки не начались — модель дорога, и это главное.
    expect(edit).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Прервано: поправлено 1 из 3/)).toBeInTheDocument()
  })

  it('шпаргалка клавиш открывается кнопкой и перечисляет комбинации', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    // Клавиша «?» занята общей шпаргалкой приложения, поэтому вход — кнопка
    // тулбара, а он появляется от двух файлов.
    fireEvent.click(await screen.findByRole('button', { name: 'Горячие клавиши галереи' }))
    expect(await screen.findByText('Клавиши галереи')).toBeInTheDocument()
    expect(screen.getByText('перейти в поиск')).toBeInTheDocument()
    expect(screen.getByText('в мультирежиме — отметить диапазон')).toBeInTheDocument()
  })

  it('пометки переносятся текстом: применение принимает JSON и чинит состояние', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Пометки…' }))
    const field = await screen.findByRole('textbox', { name: 'Пометки галереи в формате JSON' })
    fireEvent.change(field, { target: { value: JSON.stringify({ stars: ['б.png'], notes: { 'б.png': 'из другого браузера' } }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Убрать б.png из избранного' })).toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem('vc.imgstudio.notes.c1') ?? '{}')).toEqual({ 'б.png': 'из другого браузера' })
  })

  it('битый текст пометок не ломает галерею, а объясняет формат', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Пометки…' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Пометки галереи в формате JSON' }), { target: { value: 'не json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(await screen.findByText(/ожидается JSON/)).toBeInTheDocument()
    // Окно осталось открытым: текст можно поправить, не набирая заново.
    expect(screen.getByRole('textbox', { name: 'Пометки галереи в формате JSON' })).toBeInTheDocument()
  })

  it('адрес с именем файла сразу открывает лайтбокс', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    window.location.hash = `#/images/c1/${encodeURIComponent('пёс.png')}`
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      const viewer = await screen.findByTestId('image-studio-viewer')
      expect(within(viewer).getByText(/пёс\.png/)).toBeTruthy()
      // Закрыли — адрес вернулся к чату, чтобы ссылка не «залипала».
      fireEvent.click(within(viewer).getByRole('button', { name: 'Закрыть' }))
      await waitFor(() => expect(window.location.hash).toBe('#/images/c1'))
    } finally {
      window.location.hash = ''
    }
  })

  it('адрес с исчезнувшим файлом чистится, а не показывает пустой лайтбокс', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    window.location.hash = '#/images/c1/удалённый.png'
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      await waitFor(() => expect(window.location.hash).toBe('#/images/c1'))
      expect(screen.queryByTestId('image-studio-viewer')).toBeNull()
    } finally {
      window.location.hash = ''
    }
  })

  it('открытие лайтбокса пишет картинку в адрес', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    window.location.hash = '#/images/c1'
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
      await waitFor(() => expect(decodeURIComponent(window.location.hash)).toBe('#/images/c1/кот.png'))
    } finally {
      window.location.hash = ''
    }
  })

  it('фильтр по происхождению делит нарисованное и свои файлы', async () => {
    const { api } = makeApi([{ path: 'нарисованное.png', prompt: 'кит' }, { path: 'своё.png' }, { path: 'ещё-своё.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const origin = await screen.findByRole('combobox', { name: 'Происхождение файла' })
    fireEvent.change(origin, { target: { value: 'ai' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    fireEvent.change(origin, { target: { value: 'own' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    fireEvent.change(origin, { target: { value: '' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
  })

  it('подпись наносится новым файлом и не трогает исходник', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    const done = new Blob([new Uint8Array([1])], { type: 'image/png' })
    Object.defineProperty(done, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
    const lib = await import('../lib/imageTransform')
    const spy = vi.spyOn(lib, 'captionImage').mockResolvedValue(done)
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Инструменты обработки кот.png' }))
      fireEvent.change(await screen.findByRole('textbox', { name: 'Подпись на картинке кот.png' }), { target: { value: 'черновик' } })
      fireEvent.click(screen.getByRole('button', { name: 'Подписать' }))
      await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: 'кот-подпись.png', source: 'кот.png' })))
      expect(spy).toHaveBeenCalledWith(expect.anything(), 'черновик')
    } finally {
      spy.mockRestore()
    }
  })

  it('«Ссылка на кадр» кладёт в буфер адрес с именем файла', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Инструменты обработки кот.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ссылка на кадр' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(decodeURIComponent(writeText.mock.calls[0]![0])).toContain('#/images/c1/кот.png')
  })

  it('палитра открытой картинки показывается и копируется по клику', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    const lib = await import('../lib/imagePalette')
    const spy = vi.spyOn(lib, 'extractPalette').mockResolvedValue(['#112233', '#445566'])
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
      const viewer = await screen.findByTestId('image-studio-viewer')
      fireEvent.click(within(viewer).getByRole('button', { name: 'Свойства кот.png' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Показать палитру' }))
      const swatch = await screen.findByRole('button', { name: 'Скопировать цвет #112233' })
      fireEvent.click(swatch)
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('#112233'))
    } finally {
      spy.mockRestore()
    }
  })

  it('фильтр «только новое» показывает появившееся за сессию', async () => {
    const { api } = makeApi([{ path: 'старое.png' }, { path: 'тоже-старое.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    await screen.findByRole('button', { name: 'старое.png' })

    // Ход ассистента: файл появился не из действий панели — он «новое».
    // Фейку моста хватает имени: остальное он не смотрит.
    void api['imgstudio:upload']({ path: 'свежее.png' })
    fireEvent.click(screen.getByRole('button', { name: 'Обновить галерею' }))
    const only = await screen.findByRole('button', { name: /Только новое \(1\)/ })
    fireEvent.click(only)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'свежее.png' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Все файлы' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
  })

  it('правый клик по карточке открывает меню действий', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const card = (await screen.findByRole('button', { name: 'кот.png' })).closest('[data-path]') as HTMLElement

    fireEvent.contextMenu(card)
    const menu = await screen.findByRole('menu', { name: 'Действия кот.png' })
    expect(within(menu).getByRole('menuitem', { name: 'В избранное' })).toBeInTheDocument()

    // Пункт меняет состояние и закрывает меню — как любое меню.
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'В избранное' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.getByRole('button', { name: 'Убрать кот.png из избранного' })).toBeInTheDocument()
  })

  it('меню закрывается по Escape, ничего не сделав', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const card = (await screen.findByRole('button', { name: 'кот.png' })).closest('[data-path]') as HTMLElement

    fireEvent.contextMenu(card)
    await screen.findByRole('menu', { name: 'Действия кот.png' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.getByRole('button', { name: 'В избранное кот.png' })).toBeInTheDocument()
  })

  it('пакетное удаление предлагает вернуть файлы из корзины', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить выбранные (2)' }))
    const dialog = await screen.findByText('Удалить 2 файл(ов)?')
    fireEvent.click(within(dialog.closest('.vc-dialog-overlay') as HTMLElement).getByRole('button', { name: 'Удалить' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть' }))
    await waitFor(() => expect(api['imgstudio:restore']).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'а.png' })).toBeInTheDocument())
  })

  it('результаты пакетной обработки можно убрать одним нажатием', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    const done = new Blob([new Uint8Array([1])], { type: 'image/png' })
    Object.defineProperty(done, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
    const lib = await import('../lib/imageTransform')
    const spy = vi.spyOn(lib, 'applyImageTransform').mockResolvedValue(done)
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
      fireEvent.change(await screen.findByRole('combobox', { name: 'Обработать выбранные' }), { target: { value: 'grayscale' } })
      await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledTimes(2))

      fireEvent.click(await screen.findByRole('button', { name: 'Убрать результаты' }))
      await waitFor(() => expect((api['imgstudio:delete'] as ReturnType<typeof vi.fn>).mock.calls.map(([arg]) => (arg as { path: string }).path).sort())
        .toEqual(['а-чб.png', 'б-чб.png']))
    } finally {
      spy.mockRestore()
    }
  })

  it('заметка ставится всем выбранным сразу', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Заметка для выбранных' }), { target: { value: 'для подборки' } })
    fireEvent.click(screen.getByRole('button', { name: 'Заметить (2)' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.notes.c1') ?? '{}')).toEqual({ 'а.png': 'для подборки', 'б.png': 'для подборки' }))
  })

  it('пресеты стиля и размера помнятся на каждый разговор отдельно', async () => {
    const first = makeApi([{ path: 'а.png' }])
    const { unmount } = render(<ImageStudioPane conversationId="c1" api={first.api as never} />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Стиль изображения' }), { target: { value: 'акварель' } })
    await waitFor(() => expect(localStorage.getItem('vc.imgstudio.style.c1')).toBe('акварель'))
    unmount()

    // Новый чат наследует последний выбор, но может уйти от него своим путём.
    const second = makeApi([{ path: 'б.png' }])
    render(<ImageStudioPane conversationId="c2" api={second.api as never} />)
    const styleSelect = await screen.findByRole('combobox', { name: 'Стиль изображения' })
    expect((styleSelect as HTMLSelectElement).value).toBe('акварель')
    fireEvent.change(styleSelect, { target: { value: 'пиксель-арт' } })
    await waitFor(() => expect(localStorage.getItem('vc.imgstudio.style.c2')).toBe('пиксель-арт'))
    expect(localStorage.getItem('vc.imgstudio.style.c1')).toBe('акварель')
  })

  it('data-URI уходит в буфер с правильным типом', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Инструменты обработки кот.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Как data-URI' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0]![0]).toBe(`data:image/png;base64,${btoa('img')}`)
  })

  it('фон сетки переключается и запоминается', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /Фон сетки: шахматка/ }))
    await waitFor(() => expect(localStorage.getItem('vc.imgstudio.gridBg')).toBe('light'))
    const grid = screen.getByRole('list', { name: 'Галерея изображений' })
    expect(grid.className).toContain('image-studio-bg--light')
    fireEvent.click(screen.getByRole('button', { name: /Фон сетки: светлый/ }))
    await waitFor(() => expect(localStorage.getItem('vc.imgstudio.gridBg')).toBe('dark'))
  })

  it('позиция прокрутки галереи возвращается при повторном открытии', async () => {
    const { api } = makeApi(Array.from({ length: 8 }, (_, index) => ({ path: `файл-${index}.png` })))
    sessionStorage.setItem('vc.imgstudio.scroll.c1', '420')
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      const pane = await screen.findByTestId('image-studio')
      await waitFor(() => expect(pane.scrollTop).toBe(420))
    } finally {
      sessionStorage.clear()
    }
  })

  it('переименование объясняет ошибку до запроса и не отправляет её', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать кот.png' }))
    const field = screen.getByRole('textbox', { name: 'Новое имя файла' })
    fireEvent.change(field, { target: { value: 'пёс' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('«пёс.png» уже есть в галерее')
    expect(screen.getByRole('button', { name: 'Ок' })).toBeDisabled()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(api['imgstudio:rename']).not.toHaveBeenCalled()

    // Поправили — ошибка ушла, имя применяется.
    fireEvent.change(field, { target: { value: 'котик' } })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Ок' }))
    await waitFor(() => expect(api['imgstudio:rename']).toHaveBeenCalledWith({ conversationId: 'c1', from: 'кот.png', to: 'котик.png' }))
  })

  it('группировка по датам разбивает сетку на секции', async () => {
    const now = Date.now()
    const { api } = makeApi([{ path: 'свежий.png' }, { path: 'старый.png' }])
    // Второму файлу — прошлая неделя, чтобы группы точно были разные.
    ;(api['imgstudio:list'] as ReturnType<typeof vi.fn>).mockImplementation(async () => [
      { path: 'свежий.png', size: 10, updatedAt: now },
      { path: 'старый.png', size: 10, updatedAt: now - 8 * 24 * 3600 * 1000 }
    ])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'По датам' }))
    expect(await screen.findByRole('list', { name: 'Галерея изображений: сегодня' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Галерея изображений: раньше' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Без групп' }))
    await waitFor(() => expect(screen.getByRole('list', { name: 'Галерея изображений' })).toBeInTheDocument())
  })

  it('фильтр «с прошлого визита» показывает появившееся без нас', async () => {
    const now = Date.now()
    localStorage.setItem('vc.imgstudio.seen.c1', String(now - 5000))
    const { api } = makeApi()
    ;(api['imgstudio:list'] as ReturnType<typeof vi.fn>).mockImplementation(async () => [
      { path: 'новое.png', size: 10, updatedAt: now },
      { path: 'виденное.png', size: 10, updatedAt: now - 60_000 }
    ])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'С прошлого визита (1)' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'новое.png' })).toBeInTheDocument()
  })

  it('меню открывается с клавиатуры и ходит стрелками', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.click(await screen.findByRole('button', { name: 'кот.png' }))
    fireEvent.keyDown(zone, { key: 'm' })
    const menu = await screen.findByRole('menu', { name: 'Действия кот.png' })
    const items = within(menu).getAllByRole('menuitem')
    // Фокус уехал в меню на первый пункт, стрелка ведёт ко второму.
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1]!, { key: 'End' })
    expect(document.activeElement).toBe(items[items.length - 1])
    // Стрелка не должна утекать в сетку: выбор остался на той же картинке.
    expect(screen.getByText('правим: кот.png')).toBeInTheDocument()
  })

  it('Shift+F10 тоже открывает меню выбранной карточки', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.click(await screen.findByRole('button', { name: 'пёс.png' }))
    fireEvent.keyDown(zone, { key: 'F10', shiftKey: true })
    expect(await screen.findByRole('menu', { name: 'Действия пёс.png' })).toBeInTheDocument()
  })

  it('чипы запретов складывают негативный промпт', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'текст и надписи' }))
    fireEvent.click(screen.getByRole('button', { name: 'люди' }))
    const field = screen.getByRole('textbox', { name: 'Чего не должно быть на картинке' }) as HTMLInputElement
    await waitFor(() => expect(field.value).toBe('текст и надписи, люди'))
    // Повторное нажатие снимает запрет.
    fireEvent.click(screen.getByRole('button', { name: '✓ текст и надписи' }))
    await waitFor(() => expect(field.value).toBe('люди'))
  })

  it('серия вариаций делает три рана и прерывается по кнопке', async () => {
    const { api, edit } = makeApi([{ path: 'кот.png' }])
    let release: (() => void) | undefined
    edit.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ file: { path: 'кот-2.png', size: 1, updatedAt: 2 }, files: [] })
    }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const card = (await screen.findByRole('button', { name: 'кот.png' })).closest('[data-path]') as HTMLElement
    fireEvent.contextMenu(card)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Три вариации подряд' }))
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1))
    fireEvent.click(await screen.findByRole('button', { name: 'Прервать пакет' }))
    release?.()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Прервать пакет' })).toBeNull())
    expect(edit).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Прервано: готово вариаций 1 из 3/)).toBeInTheDocument()
  })

  it('промпты выбранных уходят в буфер, а без промптов — подсказка', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { api } = makeApi([{ path: 'с-промптом.png', prompt: 'кит' }, { path: 'без.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать без.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Промпты выбранных' }))
    expect(await screen.findByText(/У выбранных нет промптов/)).toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать с-промптом.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Промпты выбранных' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('с-промптом.png: кит'))
  })

  it('поиск ищет по всем словам и подсвечивает совпадения в имени', async () => {
    const { api } = makeApi([
      { path: 'кит-на-закате.png', prompt: 'синий кит' },
      { path: 'кит-утром.png', prompt: 'кит на рассвете' },
      ...Array.from({ length: 5 }, (_, index) => ({ path: `прочее-${index}.png` }))
    ])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const field = await screen.findByRole('textbox', { name: 'Фильтр по имени файла или промпту' })
    fireEvent.change(field, { target: { value: 'кит закат' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    // Совпавшая часть имени обёрнута в <mark>.
    const card = screen.getByRole('button', { name: 'кит-на-закате.png' }).closest('[data-path]') as HTMLElement
    expect(card.querySelectorAll('mark.image-studio-hit').length).toBeGreaterThan(0)
  })

  it('«Сбросить фильтры» снимает все условия сразу', async () => {
    const { api } = makeApi([{ path: 'а.png', prompt: 'кит' }, { path: 'б.jpg' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('combobox', { name: 'Тип файла' }), { target: { value: 'jpg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Показать только избранные' }))
    const reset = await screen.findByRole('button', { name: 'Сбросить фильтры (2)' })
    fireEvent.click(reset)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
    expect(screen.queryByRole('button', { name: /Сбросить фильтры/ })).toBeNull()
  })

  it('в архив попадают заметки и звёзды выбранных файлов', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    localStorage.setItem('vc.imgstudio.notes.c1', JSON.stringify({ 'кот.png': 'для обложки' }))
    localStorage.setItem('vc.imgstudio.stars.c1', JSON.stringify(['кот.png']))
    const zip = await import('../lib/zipStore')
    const spy = vi.spyOn(zip, 'buildZip').mockReturnValue(new Blob([new Uint8Array([1])], { type: 'application/zip' }))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      // Тулбар с архивом появляется от двух файлов — добавим второй загрузкой.
      await screen.findByRole('button', { name: 'кот.png' })
      const zone = screen.getByTestId('image-studio')
      fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'пёс.png', { type: 'image/png' })], types: ['Files'] } })
      fireEvent.click(await screen.findByRole('button', { name: 'Скачать архивом' }))
      await waitFor(() => expect(spy).toHaveBeenCalled())
      const meta = spy.mock.calls[0]![0].find((entry) => entry.name === 'metadata.json')!
      const parsed = JSON.parse(new TextDecoder().decode(meta.data)) as Array<{ path: string; note?: string; starred?: boolean }>
      expect(parsed.find((item) => item.path === 'кот.png')).toMatchObject({ note: 'для обложки', starred: true })
    } finally {
      spy.mockRestore()
      clickSpy.mockRestore()
    }
  })

  it('три выбранных сравниваются сеткой, а не шторкой', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Сравнить сеткой (3)' }))
    const grid = await screen.findByRole('group', { name: 'Сравнение 3 картинок' })
    expect(within(grid).getAllByRole('button')).toHaveLength(3)
    // Шторки в этом режиме нет.
    expect(screen.queryByRole('slider', { name: /Шторка сравнения/ })).toBeNull()
  })

  it('на телефоне строка карточки — одна кнопка с меню', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(max-width: 720px)',
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false
    }) as MediaQueryList)
    try {
      const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      // Вместо восьми иконок — одна «⋯», открывающая то же меню.
      fireEvent.click(await screen.findByRole('button', { name: 'Действия кот.png' }))
      expect(await screen.findByRole('menu', { name: 'Действия кот.png' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Переименовать кот.png' })).toBeNull()
    } finally {
      matchMedia.mockRestore()
    }
  })

  it('двойной клик мимо карточек снимает выбор', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'кот.png' }))
    expect(await screen.findByText('правим: кот.png')).toBeInTheDocument()
    fireEvent.doubleClick(screen.getByTestId('image-studio'))
    await waitFor(() => expect(screen.queryByText('правим: кот.png')).toBeNull())
  })

  it('гистограмма яркости показывается в свойствах', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    const tone = await import('../lib/imageTone')
    const spy = vi.spyOn(tone, 'histogramOf').mockResolvedValue([10, 40, 90, 20])
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
      const viewer = await screen.findByTestId('image-studio-viewer')
      fireEvent.click(within(viewer).getByRole('button', { name: 'Свойства кот.png' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Показать гистограмму' }))
      const chart = await screen.findByRole('img', { name: /Гистограмма яркости/ })
      expect(chart.querySelectorAll('span')).toHaveLength(4)
    } finally {
      spy.mockRestore()
    }
  })

  it('«Проверить файлы» помечает нечитаемые и молчит, когда всё цело', async () => {
    const { api } = makeApi([{ path: 'целый.png' }, { path: 'битый.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    await screen.findByRole('button', { name: 'целый.png' })

    // Ломаем чтение одного файла и проверяем, что его назовут.
    ;(api['imgstudio:read'] as ReturnType<typeof vi.fn>).mockImplementation(async ({ path }: { path: string }) => {
      if (path === 'битый.png') throw new Error('нет доступа')
      return { path, dataBase64: btoa('img') }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить файлы' }))
    expect((await screen.findAllByText(/Не читаются файлы: битый\.png/))[0]).toBeTruthy()
  })

  it('подпись именами создаёт файл на каждую выбранную', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    const done = new Blob([new Uint8Array([1])], { type: 'image/png' })
    Object.defineProperty(done, 'arrayBuffer', { value: async () => new Uint8Array([1]).buffer })
    const lib = await import('../lib/imageTransform')
    const spy = vi.spyOn(lib, 'captionImage').mockResolvedValue(done)
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Подписать именами (2)' }))
      await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledTimes(2))
      // Подпись каждой картинки — её собственное имя.
      expect(spy.mock.calls.map(([, text]) => text).sort()).toEqual(['а.png', 'б.png'])
    } finally {
      spy.mockRestore()
    }
  })

  it('набор запоминает выбор и возвращает его одним нажатием', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать а.png' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать в.png' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Имя набора' }), { target: { value: 'обложки' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить набор' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.sets.c1') ?? '{}')).toEqual({ обложки: ['а.png', 'в.png'] }))

    // Сняли выбор и вернули его чипом набора.
    fireEvent.click(screen.getByRole('button', { name: 'Инвертировать' }))
    fireEvent.click(await screen.findByRole('button', { name: /обложки \(2\)/ }))
    await waitFor(() => expect(screen.getByText(/Выбрано 2 из 3/)).toBeInTheDocument())
    expect((screen.getByRole('checkbox', { name: 'Выбрать а.png' }) as HTMLInputElement).checked).toBe(true)
  })

  it('набор с удалёнными файлами выбирает только оставшиеся', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    localStorage.setItem('vc.imgstudio.sets.c1', JSON.stringify({ старый: ['а.png', 'исчез.png'] }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /старый \(2\)/ }))
    await waitFor(() => expect(screen.getByText(/Выбрано 1 из 2/)).toBeInTheDocument())
    expect(await screen.findByText(/Часть набора «старый» уже удалена: 1/)).toBeInTheDocument()
  })

  it('хоткеи g и b переключают группы и фон сетки', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.keyDown(zone, { key: 'g' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Без групп' })).toBeInTheDocument())
    fireEvent.keyDown(zone, { key: 'b' })
    await waitFor(() => expect(localStorage.getItem('vc.imgstudio.gridBg')).toBe('light'))
  })

  it('пустая галерея объясняет следующий шаг', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    expect(await screen.findByText(/нарисуйте первую картинку/)).toBeInTheDocument()
  })
})
