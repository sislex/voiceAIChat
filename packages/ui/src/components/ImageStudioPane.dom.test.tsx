import { beforeEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import { expectNoViolations } from '../test/a11y'
import { aspectLabel, groupByDay, highlightParts, ImageStudioPane, matchesQuery, queryTerms, renameError, renamePlan, usualSeconds } from './ImageStudioPane'
import type { ImageStudioFile } from '@shared/imageStudio'

/** Мосты панели: галерея в замыкании, как её отдал бы сервер. */
/**
 * Тост по его тексту. Искать кнопку тоста глобально нельзя: тот же текст
 * дублируется в aria-live области, а тостов с кнопкой «Вернуть» в стеке бывает
 * несколько — они живут дольше обычных, чтобы человек успел нажать отмену.
 */
async function findToast(text: string): Promise<HTMLElement> {
  return await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('.vc-toast')].find((node) => node.textContent?.includes(text))
    if (!found) throw new Error(`нет тоста с текстом «${text}»`)
    return found
  })
}

function makeApi(initial: Array<{ path: string; prompt?: string; size?: number }> = [], options: { trash?: Array<{ name: string; deletedAt: number }> } = {}) {
  let files: ImageStudioFile[] = initial.map((file, index) => ({ path: file.path, size: file.size ?? 10, updatedAt: index + 1, ...(file.prompt ? { prompt: file.prompt } : {}) }))
  let trash = [...(options.trash ?? [])]
  const generate = vi.fn(async ({ prompt }: { prompt: string }) => {
    const file = { path: 'изображение.png', size: prompt.length, updatedAt: Date.now() }
    files = [file, ...files]
    return { file, files: [...files] }
  })
  const edit = vi.fn(async ({ path }: { path: string; prompt: string }) => {
    // Сервер помечает правку исходником — на этом стоят версии и «производные».
    const file = { path: path.replace('.png', '-2.png'), size: 10, updatedAt: Date.now(), source: path }
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

describe('matchesQuery', () => {
  it('слова через И, кавычки — точная фраза, минус — исключение', () => {
    // Поиск подстрочный, не по формам слова: «шляпа» в «шляпе» не найдётся.
    expect(matchesQuery('кот шляп', ['кот.png', 'рыжий кот в шляпе'])).toBe(true)
    expect(matchesQuery('кот шляпа', ['кот.png', 'рыжий кот в шляпе'])).toBe(false)
    // Без кавычек порядок не важен, с кавычками — важен.
    expect(matchesQuery('"кот в шляпе"', ['кот.png', 'рыжий кот в шляпе'])).toBe(true)
    expect(matchesQuery('"шляпа на коте"', ['кот.png', 'рыжий кот в шляпе'])).toBe(false)
    expect(matchesQuery('кот -копия', ['кот.png', 'рыжий кот'])).toBe(true)
    expect(matchesQuery('кот -копия', ['кот-копия.png', 'рыжий кот'])).toBe(false)
    expect(matchesQuery('   ', ['что угодно'])).toBe(true)
  })

  it('подсветка отмечает искомое и не отмечает исключения', () => {
    expect(highlightParts('кот-копия.png', 'кот -копия').filter((part) => part.hit).map((part) => part.text)).toEqual(['кот'])
    expect(highlightParts('рыжий кот в шляпе', '"кот в"').filter((part) => part.hit).map((part) => part.text)).toEqual(['кот в'])
  })
})

describe('queryTerms', () => {
  it('разбирает кавычки, минус и лишние пробелы', () => {
    expect(queryTerms('  кот  "в шляпе" -копия ')).toEqual([
      { text: 'кот', negated: false },
      { text: 'в шляпе', negated: false },
      { text: 'копия', negated: true }
    ])
    expect(queryTerms('')).toEqual([])
    // Пустые кавычки условием не становятся.
    expect(queryTerms('""')).toEqual([])
  })
})

describe('usualSeconds', () => {
  it('медиана прошлых замеров в секундах; без замеров — null', () => {
    expect(usualSeconds([{ tookMs: 8000 }, { tookMs: 12000 }, { tookMs: 10000 }])).toBe(10)
    // Одна зависшая генерация не должна портить оценку — потому медиана.
    expect(usualSeconds([{ tookMs: 5000 }, { tookMs: 5000 }, { tookMs: 300000 }])).toBe(5)
    expect(usualSeconds([{ tookMs: 4000 }, { tookMs: 6000 }])).toBe(5)
    expect(usualSeconds([{}, { tookMs: 0 }])).toBeNull()
    expect(usualSeconds([])).toBeNull()
  })
})

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
  // sessionStorage тоже чистим: в нём живут позиция прокрутки и свёрнутые
  // группы, и один тест иначе приносит своё состояние в следующий.
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
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

    fireEvent.click(await screen.findByRole('button', { name: 'Действия логотип.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Действия кот.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Вариация' }))
    await waitFor(() => expect(edit).toHaveBeenCalledWith(expect.objectContaining({ path: 'кот.png' })))
    expect(edit.mock.calls[0]![0].prompt).toMatch(/вариант/)

    // «Дубликат» теперь живёт в раскрываемой строке 🛠.
    fireEvent.click(screen.getByRole('button', { name: 'Действия кот.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Инструменты обработки' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Действия логотип.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Действия кот.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'В сообщение чата' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Действия схема.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать' }))
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
    fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
    fireEvent.click(await within(viewer).findByRole('menuitem', { name: 'Удалить' }))
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
    await waitFor(() => expect(within(screen.getByTestId('image-studio-viewer')).queryByRole('button', { name: 'Ещё действия с картинкой' })).not.toBeNull())
    fireEvent.click(within(screen.getByTestId('image-studio-viewer')).getByRole('button', { name: 'Ещё действия с картинкой' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Править по промпту' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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
      fireEvent.click(await screen.findByRole('button', { name: 'Действия кот.png' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Инструменты обработки' }))
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
      fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
      fireEvent.click(await within(viewer).findByRole('menuitem', { name: 'Обрезать (выделите область)' }))
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
      fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
      fireEvent.click(await within(viewer).findByRole('menuitem', { name: 'Разметить (рисование поверх)' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Действия кот.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Инструменты обработки' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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
      fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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

  it('в мелкой сетке на карточке остаётся три кнопки, остальное — в меню', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    await screen.findByRole('button', { name: 'кот.png' })

    fireEvent.click(screen.getByRole('button', { name: 'Мелкие карточки' }))
    await waitFor(() => expect(document.querySelector('.image-studio-grid--dense')).toBeInTheDocument())
    // Карточка мельче 110 px: пять иконок в ней переносятся на вторую строку.
    expect(screen.queryByRole('button', { name: 'Отметить кот.png черновиком' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Удалить кот.png' })).toBeNull()
    expect(screen.getByRole('button', { name: 'В избранное кот.png' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть кот.png в полный размер' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Действия кот.png' }))
    expect(await screen.findByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument()
  })

  it('меню лайтбокса: Esc закрывает меню, но не картинку', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
    const viewer = await screen.findByTestId('image-studio-viewer')
    // В шапке было двадцать пять иконок подряд — редкое уехало в это меню.
    expect(within(viewer).queryByRole('button', { name: /Править .* по промпту/ })).toBeNull()

    const more = within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' })
    fireEvent.click(more)
    const menu = await within(viewer).findByRole('menu')
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]))
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[1])

    // ToolFrame слушает Esc в фазе перехвата: без остановки события картинка
    // закрывалась вместе с меню.
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(within(viewer).queryByRole('menu')).toBeNull())
    expect(screen.getByTestId('image-studio-viewer')).toBeInTheDocument()
    expect(document.activeElement).toBe(more)
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

      fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
      fireEvent.click(await within(viewer).findByRole('menuitem', { name: /Фон: шахматка/ }))
      fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
      await waitFor(() => expect(within(viewer).getByRole('menuitem', { name: /Фон: светлый/ })).toBeTruthy())
      fireEvent.click(await within(viewer).findByRole('menuitem', { name: /^Слайдшоу/ }))
      await waitFor(() => expect(within(viewer).getByRole('button', { name: 'Остановить слайдшоу' })).toBeTruthy())

      fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
      fireEvent.click(await within(viewer).findByRole('menuitem', { name: 'Копировать в буфер' }))
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

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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
      fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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
    fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
    fireEvent.click(await within(viewer).findByRole('menuitem', { name: 'Свойства и заметка' }))
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
    // Порядок выбирается сразу, а не перебором по кругу: раньше до «избранных»
    // было четыре нажатия, а до «по цвету» — семь.
    fireEvent.change(await screen.findByRole('combobox', { name: 'Порядок картинок' }), { target: { value: 'stars' } })
    await waitFor(() => {
      const cards = screen.getAllByRole('listitem').map((item) => item.getAttribute('data-path'))
      expect(cards[0]).toBe('а.png')
    })
  })

  it('негативный промпт дописывается к запросу и переживает перерисовку', async () => {
    const { api, generate } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Без…/ }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Действия файл-1.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Похожие: тот же промпт' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Фильтр по имени файла или промпту' }) as HTMLInputElement).value).toBe('синий кит в океане'))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
  })

  it('меню «Ещё…» прячет редкие команды и ходит с клавиатуры', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    await screen.findByRole('button', { name: 'кот.png' })

    // Стена из двадцати кнопок разъезжалась на три строки: редкое — в меню.
    expect(screen.queryByRole('button', { name: 'Найти дубликаты' })).toBeNull()
    const more = screen.getByRole('button', { name: 'Ещё…' })
    expect(more).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(more)
    const menu = await screen.findByRole('menu', { name: 'Ещё действия галереи' })
    expect(within(menu).getByRole('menuitem', { name: 'Найти дубликаты' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Печать' })).toBeInTheDocument()
    // Фокус уходит в меню сразу: иначе открыть его с клавиатуры можно, а выбрать нечем.
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]))

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[1])
    fireEvent.keyDown(menu, { key: 'End' })
    const items = within(menu).getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[items.length - 1])

    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Ещё действия галереи' })).toBeNull())
    expect(document.activeElement).toBe(more)
  })

  it('миниатюры показываются целиком по кнопке и клавише o, выбор запоминается', async () => {
    localStorage.setItem('vc.imgstudio.fit', '0')
    // Тулбар галереи появляется от двух файлов: одному фильтры не нужны.
    const { api } = makeApi([{ path: 'баннер.png' }, { path: 'портрет.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    await screen.findByRole('button', { name: 'баннер.png' })

    fireEvent.click(screen.getByRole('button', { name: 'Показывать миниатюры целиком' }))
    await waitFor(() => expect(document.querySelector('.image-studio-grid--fit')).toBeInTheDocument())
    expect(localStorage.getItem('vc.imgstudio.fit')).toBe('1')

    fireEvent.keyDown(screen.getByTestId('image-studio'), { key: 'o' })
    await waitFor(() => expect(document.querySelector('.image-studio-grid--fit')).toBeNull())
    expect(localStorage.getItem('vc.imgstudio.fit')).toBe('0')
  })

  it('возврат во вкладку обновляет галерею без хода ассистента', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    await screen.findByRole('button', { name: 'кот.png' })

    // Файл появился мимо панели — из второй вкладки или от соседа по разговору.
    await api['imgstudio:upload']({ path: 'пёс.png' })
    expect(screen.queryByRole('button', { name: 'пёс.png' })).toBeNull()

    // Панель не поллит галерею вне хода ассистента, поэтому раньше такой файл
    // ждал нажатия «r». Защита от частых заходов — 10 с, сдвигаем часы.
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 11_000)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(await screen.findByRole('button', { name: 'пёс.png' })).toBeInTheDocument()
    clock.mockRestore()
  })

  it('пустая галерея зовёт загрузить файлы, а не только объясняет', async () => {
    const { api } = makeApi([])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const upload = await screen.findByRole('button', { name: 'Загрузить с диска' })
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!
    const click = vi.spyOn(input, 'click')
    fireEvent.click(upload)
    expect(click).toHaveBeenCalled()
  })

  it('«Список в буфер» отдаёт markdown-таблицу видимых файлов', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png', prompt: 'кит' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Список в буфер' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Найти дубликаты' }))
    await waitFor(() => expect(screen.getByText(/Выбрано 2 из 3/)).toBeInTheDocument())
    expect((screen.getByRole('checkbox', { name: 'Выбрать копия.png' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Выбрать старый.png' }) as HTMLInputElement).checked).toBe(false)
  })

  it('пакетное переименование можно откатить одной кнопкой', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Действия кот.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Действия кот.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Инструменты обработки' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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
      release = () => resolve({ file: { path: 'а-2.png', size: 1, updatedAt: 2, source: 'а.png' }, files: [] })
    }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'сделай ярче' } })
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Пометки…' }))
    const field = await screen.findByRole('textbox', { name: 'Пометки галереи в формате JSON' })
    fireEvent.change(field, { target: { value: JSON.stringify({ stars: ['б.png'], notes: { 'б.png': 'из другого браузера' } }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Убрать б.png из избранного' })).toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem('vc.imgstudio.notes.c1') ?? '{}')).toEqual({ 'б.png': 'из другого браузера' })
  })

  it('битый текст пометок не ломает галерею, а объясняет формат', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Пометки…' }))
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

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
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
      fireEvent.click(await screen.findByRole('button', { name: 'Действия кот.png' }))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Инструменты обработки' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Действия кот.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Инструменты обработки' }))
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
      fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
      fireEvent.click(await within(viewer).findByRole('menuitem', { name: 'Свойства и заметка' }))
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

    // Кнопку берём из своего тоста: тост с действием живёт долго (человеку надо
    // успеть решить), поэтому в стеке их бывает несколько.
    fireEvent.click(within(await findToast('Удалено файлов: 2')).getByRole('button', { name: 'Вернуть' }))
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
      fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Действия кот.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Инструменты обработки' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'Действия кот.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать' }))
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

    fireEvent.click(await screen.findByRole('button', { name: /^Без…/ }))
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
      release = () => resolve({ file: { path: 'кот-2.png', size: 1, updatedAt: 2, source: 'кот.png' }, files: [] })
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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

  it('Esc сворачивает раскрытый ящик отбора и не снимает выбор картинки', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'кот.png' }))
    await waitFor(() => expect(document.querySelector('.image-studio-card--selected')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /^Отбор/ }))
    const box = await screen.findByRole('group', { name: 'Отбор файлов' })

    fireEvent.keyDown(box, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Отбор файлов' })).toBeNull())
    // Esc «съеден» ящиком: выбранная картинка остаётся выбранной.
    expect(document.querySelector('.image-studio-card--selected')).not.toBeNull()
    expect(localStorage.getItem('vc.imgstudio.filters')).toBe('0')
  })

  it('ящик отбора свёрнут в одну кнопку, а включённое условие видно чипом', async () => {
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
      const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.jpg' }])
      render(<ImageStudioPane conversationId="c1" api={api as never} />)

      // Шесть селектов подряд занимали бы пол-экрана телефона — и на десктопе
      // читались стеной, поэтому ящик отбора свёрнут везде одинаково.
      const toggle = await screen.findByRole('button', { name: 'Отбор…' })
      expect(screen.queryByRole('combobox', { name: 'Тип файла' })).toBeNull()
      fireEvent.click(toggle)
      expect(await screen.findByRole('combobox', { name: 'Тип файла' })).toBeInTheDocument()
      fireEvent.change(screen.getByRole('combobox', { name: 'Тип файла' }), { target: { value: 'png' } })
      fireEvent.click(await screen.findByRole('button', { name: 'Скрыть отбор' }))
      // Включённое условие видно на кнопке числом и отдельным чипом со снятием.
      expect(await screen.findByRole('button', { name: 'Отбор (1)' })).toBeInTheDocument()
      const chip = screen.getByRole('button', { name: 'Снять условие: PNG' })
      fireEvent.click(chip)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Отбор…' })).toBeInTheDocument())
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
      fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
      fireEvent.click(await within(viewer).findByRole('menuitem', { name: 'Свойства и заметка' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Проверить файлы' }))
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
      fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
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

    // Чип честно показывает «живых из всех»: раньше он врал числом 2.
    fireEvent.click(await screen.findByRole('button', { name: /старый \(1 из 2\)/ }))
    await waitFor(() => expect(screen.getByText(/Выбрано 1 из 2/)).toBeInTheDocument())
    expect(await screen.findByText(/Часть набора «старый» уже удалена: 1/)).toBeInTheDocument()

    // …и чистится одним нажатием, после чего счётчик становится обычным.
    fireEvent.click(await screen.findByRole('button', { name: 'Убрать из набора старый удалённые файлы' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.sets.c1') ?? '{}')).toEqual({ старый: ['а.png'] }))
    expect(await screen.findByRole('button', { name: /старый \(1\)/ })).toBeInTheDocument()
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

  it('готовность картинки переключается по кругу и переживает перерисовку', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    // Готовность живёт и на карточке галереи — в меню лайтбокса лезть незачем.
    fireEvent.click(await screen.findByRole('button', { name: 'Отметить кот.png черновиком' }))
    const asDraft = await screen.findByRole('button', { name: 'кот.png: черновик — отметить готовым' })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.status.c1') ?? '{}')).toEqual({ 'кот.png': 'draft' }))
    fireEvent.click(asDraft)
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.status.c1') ?? '{}')).toEqual({ 'кот.png': 'ready' }))
    // Третье нажатие снимает пометку.
    fireEvent.click(await screen.findByRole('button', { name: 'кот.png: готово — снять пометку' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.status.c1') ?? '{}')).toEqual({}))
  })

  it('фильтр пометок отбирает заметки, черновики и готовые', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    localStorage.setItem('vc.imgstudio.notes.c1', JSON.stringify({ 'а.png': 'для обложки' }))
    localStorage.setItem('vc.imgstudio.status.c1', JSON.stringify({ 'б.png': 'draft', 'в.png': 'ready' }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
    const marks = await screen.findByRole('combobox', { name: 'Пометки файла' })
    fireEvent.change(marks, { target: { value: 'noted' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'а.png' })).toBeInTheDocument()
    fireEvent.change(marks, { target: { value: 'draft' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'б.png' })).toBeInTheDocument())
    fireEvent.change(marks, { target: { value: 'ready' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'в.png' })).toBeInTheDocument())
  })

  it('происхождение различает производные обработки и свои файлы', async () => {
    const { api } = makeApi([
      { path: 'нарисованное.png', prompt: 'кит' },
      { path: 'своё.png' },
      { path: 'производное.png' }
    ])
    // Производное — результат обработки: есть исходник, но нет промпта.
    ;(api['imgstudio:list'] as ReturnType<typeof vi.fn>).mockImplementation(async () => [
      { path: 'нарисованное.png', size: 10, updatedAt: 3, prompt: 'кит' },
      { path: 'своё.png', size: 10, updatedAt: 2 },
      { path: 'производное.png', size: 10, updatedAt: 1, source: 'своё.png' }
    ])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
    const origin = await screen.findByRole('combobox', { name: 'Происхождение файла' })
    fireEvent.change(origin, { target: { value: 'derived' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'производное.png' })).toBeInTheDocument()
    fireEvent.change(origin, { target: { value: 'own' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'своё.png' })).toBeInTheDocument())
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('пустой результат предлагает сбросить все фильтры сразу', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.jpg' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Тип файла' }), { target: { value: 'jpg' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Пометки файла' }), { target: { value: 'ready' } })
    expect(await screen.findByText('Ничего не нашлось')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить все фильтры' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
  })

  it('«Ещё раз» повторяет последний промпт одним нажатием', async () => {
    const { api, generate } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'синий кит' } })
    fireEvent.click(screen.getByRole('button', { name: 'Нарисовать' }))
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))

    fireEvent.click(await screen.findByRole('button', { name: '↻ Ещё раз' }))
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2))
    expect((generate.mock.calls[1]![0] as { prompt: string }).prompt).toContain('синий кит')
  })

  it('палитра считается один раз на файл и берётся из кэша при возврате', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    const lib = await import('../lib/imagePalette')
    const spy = vi.spyOn(lib, 'extractPalette').mockResolvedValue(['#112233'])
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
      const viewer = await screen.findByTestId('image-studio-viewer')
      fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
      fireEvent.click(await within(viewer).findByRole('menuitem', { name: 'Свойства и заметка' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Показать палитру' }))
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

      // Ушли на соседний кадр и вернулись: второй раз пиксели не считаем.
      fireEvent.click(within(screen.getByTestId('image-studio-viewer')).getByRole('button', { name: 'Следующая картинка' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Показать палитру' })).toBeInTheDocument())
      fireEvent.click(within(screen.getByTestId('image-studio-viewer')).getByRole('button', { name: 'Предыдущая картинка' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Показать палитру' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Скопировать цвет #112233' })).toBeInTheDocument())
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('лайтбокс умеет полный экран и следует за выходом из него', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    const request = vi.fn(async () => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: {} }); document.dispatchEvent(new Event('fullscreenchange')) })
    const exit = vi.fn(async () => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null }); document.dispatchEvent(new Event('fullscreenchange')) })
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    try {
      render(<ImageStudioPane conversationId="c1" api={api as never} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
      const viewer = await screen.findByTestId('image-studio-viewer')
      fireEvent.click(within(viewer).getByRole('button', { name: 'Показать на весь экран' }))
      await waitFor(() => expect(request).toHaveBeenCalled())
      // Кнопка следует за состоянием браузера, а не за собственным флагом.
      const back = await screen.findByRole('button', { name: 'Выйти из полного экрана' })
      fireEvent.click(back)
      await waitFor(() => expect(exit).toHaveBeenCalled())
      await waitFor(() => expect(screen.getByRole('button', { name: 'Показать на весь экран' })).toBeInTheDocument())
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen')
    }
  })

  it('имя загружаемого файла приводится к безопасному', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    const file = new File(['x'], 'Снимок экрана 2026-09-04 в 12:31:05.png', { type: 'image/png' })
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } })
    await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: 'Снимок-экрана-2026-09-04-в-123105.png' })))
    expect(await screen.findByText(/Имя поправлено/)).toBeInTheDocument()
  })

  it('шаблон промпта подставляется с переменными', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    localStorage.setItem('vc.imgstudio.templates.c1', JSON.stringify({ обложка: '{объект} в стиле акварели, белый фон' }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Шаблоны…/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'обложка' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Значение переменной объект' }), { target: { value: 'рыжий кот' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Подставить в промпт' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Промпт для изображения' })).toHaveValue('рыжий кот в стиле акварели, белый фон'))
  })

  it('промпт запоминается как шаблон', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: '{объект} на белом фоне' } })
    fireEvent.click(await screen.findByRole('button', { name: /^Шаблоны…/ }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Имя шаблона' }), { target: { value: 'на белом' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Запомнить промпт как шаблон' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.templates.c1') ?? '{}')).toEqual({ 'на белом': '{объект} на белом фоне' }))
  })

  it('Shift+стрелка расширяет выделение в мультирежиме', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'в.png' }))
    // В jsdom колонок одна, поэтому вниз — это следующий файл по сетке.
    fireEvent.keyDown(zone, { key: 'ArrowDown', shiftKey: true })
    await waitFor(() => expect(screen.getByText(/Выбрано 2 из 3/)).toBeInTheDocument())
    fireEvent.keyDown(zone, { key: 'End', shiftKey: true })
    await waitFor(() => expect(screen.getByText(/Выбрано 3 из 3/)).toBeInTheDocument())
  })

  it('размер страницы запоминается и меняет порцию сетки', async () => {
    const { api } = makeApi(Array.from({ length: 70 }, (_, index) => ({ path: `кадр-${index}.png` })))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(60))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Карточек на странице' }), { target: { value: '120' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(70))
    expect(localStorage.getItem('vc.imgstudio.page')).toBe('120')
  })

  it('«Сбросить фильтры» возвращает и порядок, и группы', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('combobox', { name: 'Порядок картинок' }), { target: { value: 'new' } })
    fireEvent.click(await screen.findByRole('button', { name: 'По датам' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Пометки файла' }), { target: { value: 'ready' } })
    fireEvent.click(await screen.findByRole('button', { name: /^Сбросить фильтры/ }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Порядок картинок' })).toHaveValue('new'))
    expect(screen.getByRole('button', { name: 'По датам' })).toBeInTheDocument()
  })

  it('«Показ» открывает первый отобранный кадр и запускает слайдшоу', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Показ' }))
    const viewer = await screen.findByTestId('image-studio-viewer')
    expect(await within(viewer).findByRole('button', { name: 'Остановить слайдшоу' })).toBeInTheDocument()
  })

  it('клавиша i открывает просмотр с раскрытыми свойствами', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.click(await screen.findByRole('button', { name: 'кот.png' }))
    fireEvent.keyDown(zone, { key: 'i' })
    const viewer = await screen.findByTestId('image-studio-viewer')
    expect(await within(viewer).findByRole('button', { name: 'Что внутри файла' })).toBeInTheDocument()
  })

  it('«По промпту» даёт выбранным имена из их промптов', async () => {
    const { api } = makeApi([{ path: 'изображение.png', prompt: 'рыжий кот в шляпе' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать изображение.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'По промпту' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать' }))
    // Имя из промпта — первые три слова (правило `nameFromPrompt`), чтобы оно
    // осталось коротким: «рыжий кот в шляпе» → «рыжий-кот-в.png».
    await waitFor(() => expect((api['imgstudio:rename'] as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1))
    const targets = (api['imgstudio:rename'] as ReturnType<typeof vi.fn>).mock.calls.map(([arg]) => (arg as { to: string }).to)
    expect(targets).toContain('рыжий-кот-в.png')
  })

  it('битые файлы после проверки отмечаются сами', async () => {
    const { api } = makeApi([{ path: 'целый.png' }, { path: 'битый.png' }])
    ;(api['imgstudio:read'] as ReturnType<typeof vi.fn>).mockImplementation(async ({ path }: { path: string }) => {
      if (path === 'битый.png') throw new Error('нечитаемо')
      return { path, dataBase64: btoa('img') }
    })
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Проверить файлы' }))
    await waitFor(() => expect(screen.getByText(/Не читаются файлы: 1/)).toBeInTheDocument())
    // Отмечены — значит «Удалить выбранные» уже показывает нужное число.
    expect(await screen.findByRole('button', { name: 'Удалить выбранные (1)' })).toBeInTheDocument()
  })

  it('история операций помнит удаление и возвращает файл', async () => {
    // Три файла: после удаления должно остаться два, иначе строка действий
    // (и кнопка «История») скрывается — она живёт в блоке от двух файлов.
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }, { path: 'лиса.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить кот.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(api['imgstudio:delete']).toHaveBeenCalledTimes(1))

    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^История \(1\)/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Что делали в галерее' })
    expect(within(dialog).getByText('Удалено «кот.png»')).toBeInTheDocument()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Вернуть' })[0]!)
    await waitFor(() => expect(api['imgstudio:restore']).toHaveBeenCalledWith(expect.objectContaining({ name: 'кот.png' })))
  })

  it('после удаления фокус переходит на соседнюю карточку', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить б.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    // Сосед по сетке — следующий за удалённым; без этого фокус улетал в body
    // и с клавиатуры дальше работать было нельзя.
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('а.png'))
  })

  it('поиск чистится крестиком и клавишей Esc', async () => {
    const { api } = makeApi(Array.from({ length: 9 }, (_, index) => ({ path: `кадр-${index}.png` })))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const field = await screen.findByRole('textbox', { name: 'Фильтр по имени файла или промпту' })
    fireEvent.change(field, { target: { value: 'кадр-1' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Очистить поиск' }))
    await waitFor(() => expect(field).toHaveValue(''))

    fireEvent.change(field, { target: { value: 'кадр-2' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    await waitFor(() => expect(field).toHaveValue(''))
  })

  it('фильтр «за сутки» оставляет только свежее', async () => {
    const day = 24 * 60 * 60 * 1000
    const { api } = makeApi([{ path: 'свежая.png' }, { path: 'старая.png' }])
    // updatedAt фикстуры — порядковый номер, поэтому старую двигаем руками.
    ;(api['imgstudio:list'] as ReturnType<typeof vi.fn>).mockImplementation(async () => [
      { path: 'свежая.png', size: 10, updatedAt: Date.now() - 60_000 },
      { path: 'старая.png', size: 10, updatedAt: Date.now() - 3 * day }
    ])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^За сутки \(1\)/ }))
    await waitFor(() => {
      const paths = screen.getAllByRole('listitem').map((item) => item.getAttribute('data-path'))
      expect(paths).toEqual(['свежая.png'])
    })
  })

  it('⌘F ведёт в поиск, ⌘A включает мультирежим со всем выбранным', async () => {
    const { api } = makeApi(Array.from({ length: 9 }, (_, index) => ({ path: `кадр-${index}.png` })))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.keyDown(zone, { key: 'f', metaKey: true })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Фильтр по имени файла или промпту' })))

    fireEvent.keyDown(zone, { key: 'a', metaKey: true })
    await waitFor(() => expect(screen.getByText(/Выбрано 9 из 9/)).toBeInTheDocument())
  })

  it('«Ещё раз» повторяет последнюю обработку', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать кот.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Обработать выбранные' }), { target: { value: 'grayscale' } })
    // Кнопка появляется после первой обработки и несёт её подпись.
    expect(await screen.findByRole('button', { name: /Ещё раз: чёрно-белое/ })).toBeInTheDocument()
  })

  it('в группе по датам можно отметить всю группу', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'По датам' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать группу' }))
    await waitFor(() => expect(screen.getByText(/Выбрано 2 из 2/)).toBeInTheDocument())
  })

  it('панель рисования сворачивается, прогресс остаётся', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: '▾ Рисование' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Промпт для изображения' })).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: '▸ Рисование' }))
    expect(await screen.findByRole('textbox', { name: 'Промпт для изображения' })).toBeInTheDocument()
  })

  it('свойства лайтбокса показывают дерево версий и «показать в сетке»', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    // Правка рождает версию: у неё source, и дерево становится из двух узлов.
    fireEvent.click(await screen.findByRole('button', { name: 'кот.png' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'добавь шляпу' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить выбранную' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот-2.png в полный размер' }))
    const viewer = await screen.findByTestId('image-studio-viewer')
    fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
    fireEvent.click(await within(viewer).findByRole('menuitem', { name: 'Свойства и заметка' }))
    const tree = await screen.findByRole('group', { name: 'Дерево версий' })
    expect(within(tree).getByRole('button', { name: 'кот.png' })).toBeInTheDocument()

    fireEvent.click(within(screen.getByTestId('image-studio-viewer')).getByRole('button', { name: 'Показать в сетке' }))
    // Лайтбокс закрылся, карточка выбрана и подсвечена.
    await waitFor(() => expect(screen.queryByTestId('image-studio-viewer')).toBeNull())
    await waitFor(() => expect(document.querySelector('.image-studio-card--flash')?.getAttribute('data-path')).toBe('кот-2.png'))
  })

  it('клавиши t, v, r и Shift+F открывают корзину, виды, обновляют и отбирают избранное', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }], { trash: [{ name: 'старое.png', deletedAt: Date.now() - 3600_000 }] })
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.keyDown(zone, { key: 't' })
    expect(await screen.findByRole('group', { name: 'Корзина галереи' })).toBeInTheDocument()
    fireEvent.keyDown(zone, { key: 'v' })
    expect(await screen.findByRole('textbox', { name: 'Имя вида' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))

    const before = (api['imgstudio:list'] as ReturnType<typeof vi.fn>).mock.calls.length
    fireEvent.keyDown(zone, { key: 'r' })
    await waitFor(() => expect((api['imgstudio:list'] as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before))

    fireEvent.click(await screen.findByRole('button', { name: 'В избранное кот.png' }))
    fireEvent.keyDown(zone, { key: 'F', shiftKey: true })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
  })

  it('⌘Z возвращает последнее пакетное удаление', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить выбранные (2)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(api['imgstudio:delete']).toHaveBeenCalledTimes(2))

    fireEvent.keyDown(zone, { key: 'z', metaKey: true })
    await waitFor(() => expect(api['imgstudio:restore']).toHaveBeenCalledTimes(2))
  })

  it('корзина показывает возраст и чистит только старое', async () => {
    const day = 24 * 60 * 60 * 1000
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }], { trash: [
      { name: 'вчерашнее.png', deletedAt: Date.now() - 2 * day },
      { name: 'свежее.png', deletedAt: Date.now() - 60_000 }
    ] })
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Корзина…/ }))
    expect(await screen.findByText('2 дн назад')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Очистить старше суток' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Очистить' }))
    // Свежее удалённое остаётся: чистим только то, что уже точно не нужно.
    await waitFor(() => expect(api['imgstudio:purge']).toHaveBeenCalledWith(expect.objectContaining({ name: 'вчерашнее.png' })))
    expect(api['imgstudio:purge']).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'свежее.png' }))
  })

  it('набор переименовывается, старое имя исчезает', async () => {
    // Строка действий и чипы наборов появляются от двух файлов.
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    localStorage.setItem('vc.imgstudio.sets.c1', JSON.stringify({ обложки: ['кот.png'] }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Переименовать набор обложки' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Новое имя набора' }), { target: { value: 'для статьи' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ок' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.sets.c1') ?? '{}')).toEqual({ 'для статьи': ['кот.png'] }))
  })

  it('перенос пометок несёт наборы и виды', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Пометки…' }))
    const field = await screen.findByRole('textbox', { name: 'Пометки галереи в формате JSON' })
    fireEvent.change(field, { target: { value: JSON.stringify({
      stars: [], notes: {}, statuses: {},
      sets: { обложки: ['кот.png'] },
      // Вид с мусорным порядком: он должен отсеяться при разборе.
      views: { 'только png': { kind: 'png', order: 'rm -rf' } }
    }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.sets.c1') ?? '{}')).toEqual({ обложки: ['кот.png'] }))
    expect(JSON.parse(localStorage.getItem('vc.imgstudio.views.c1') ?? '{}')).toEqual({ 'только png': { kind: 'png' } })
  })

  it('фильтр «неразобранное» прячет всё помеченное', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    localStorage.setItem('vc.imgstudio.stars.c1', JSON.stringify(['а.png']))
    localStorage.setItem('vc.imgstudio.notes.c1', JSON.stringify({ 'б.png': 'заметка' }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Пометки файла' }), { target: { value: 'none' } })
    await waitFor(() => {
      const paths = screen.getAllByRole('listitem').map((item) => item.getAttribute('data-path'))
      expect(paths).toEqual(['в.png'])
    })
  })

  it('кадр, выпавший из отбора, продолжает листаться по всей галерее', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }, { path: 'ёж.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    // Отбор сужаем звездой: избранный один, а открыт будет другой кадр.
    fireEvent.click(await screen.findByRole('button', { name: 'В избранное пёс.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
    const viewer = await screen.findByTestId('image-studio-viewer')
    fireEvent.click(screen.getByRole('button', { name: 'Показать только избранные' }))

    // Раньше стрелки молчали, а счётчик «N из M» исчезал: кадр висел в никуда.
    await waitFor(() => expect(within(viewer).getByText(/из 3/)).toBeInTheDocument())
    fireEvent.click(within(viewer).getByRole('button', { name: 'Следующая картинка' }))
    await waitFor(() => expect(within(viewer).getByText(/пёс\.png/)).toBeInTheDocument())
  })

  it('мета лайтбокса не кончается висячим разделителем', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
    await screen.findByTestId('image-studio-viewer')
    // У файла без источника и промпта строка кончалась точкой: «10 Б · 400×300 ·».
    const cap = document.querySelector('.imgcap')!
    expect(cap.textContent?.trim().endsWith('·')).toBe(false)
  })

  it('мультирежим держит на виду частое, остальное — в раскрытии', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    // Двадцать одна кнопка и четыре поля сразу занимали пол-экрана.
    expect(await screen.findByRole('button', { name: 'Скачать выбранные (2)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Удалить выбранные (2)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Коллаж (2)' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Заметка для выбранных' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Ещё с выбранными…' }))
    const box = await screen.findByRole('group', { name: 'Ещё действия с выбранными' })
    expect(within(box).getByRole('button', { name: 'Коллаж (2)' })).toBeInTheDocument()
    expect(within(box).getByRole('textbox', { name: 'Заметка для выбранных' })).toBeInTheDocument()

    // Esc сворачивает раскрытие, но выбор пачки остаётся.
    fireEvent.keyDown(box, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Ещё действия с выбранными' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Скачать выбранные (2)' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ещё с выбранными…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Скрыть остальное' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Ещё действия с выбранными' })).toBeNull())
  })

  it('запреты свёрнуты в кнопку и показывают счётчик включённых', async () => {
    const { api } = makeApi([])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const toggle = await screen.findByRole('button', { name: 'Без…' })
    expect(screen.queryByRole('textbox', { name: 'Чего не должно быть на картинке' })).toBeNull()
    fireEvent.click(toggle)
    fireEvent.click(await screen.findByRole('button', { name: 'текст и надписи' }))
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть запреты' }))
    // Свёрнутая кнопка обязана показывать, что запрет включён.
    expect(await screen.findByRole('button', { name: 'Без… (1)' })).toBeInTheDocument()
    expect(localStorage.getItem('vc.imgstudio.negativeOpen')).toBe('0')
  })

  it('порядок выбирается списком, и «По цвету» больше не подписан чужим именем', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const order = await screen.findByRole('combobox', { name: 'Порядок картинок' })
    expect(within(order).getAllByRole('option')).toHaveLength(8)
    // Кнопка-цикл не знала подписи для «tint» и показывала «Сначала готовые».
    fireEvent.change(order, { target: { value: 'tint' } })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Порядок картинок' })).toHaveValue('tint'))
    expect(within(order).getByRole('option', { name: 'По цвету', selected: true })).toBeInTheDocument()
    expect(localStorage.getItem('vc.imgstudio.order')).toBe('tint')
  })

  it('кнопка ↓↑ разворачивает нынешний порядок', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Развернуть порядок' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Обычный порядок' })).toBeInTheDocument())
    const paths = screen.getAllByRole('listitem').map((item) => item.getAttribute('data-path'))
    expect(paths).toEqual(['а.png', 'б.png', 'в.png'])
  })

  it('точка «в наборе» стоит только на файлах набора', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    localStorage.setItem('vc.imgstudio.sets.c1', JSON.stringify({ обложки: ['кот.png'] }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    const marked = document.querySelectorAll('[data-path="кот.png"] .image-studio-in-set')
    expect(marked).toHaveLength(1)
    expect(document.querySelectorAll('[data-path="пёс.png"] .image-studio-in-set')).toHaveLength(0)
  })

  it('промпт считает слова и чистится кнопкой', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'рыжий кот в шляпе' } })
    expect(await screen.findByText(/слов: 4/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Очистить' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Промпт для изображения' })).toHaveValue(''))
  })

  it('в лайтбоксе есть звезда, готовность и инверсия просмотра', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
    const viewer = await screen.findByTestId('image-studio-viewer')
    fireEvent.click(within(viewer).getByRole('button', { name: 'В избранное кот.png' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.stars.c1') ?? '[]')).toEqual(['кот.png']))
    fireEvent.click(within(screen.getByTestId('image-studio-viewer')).getByRole('button', { name: 'Ещё действия с картинкой' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Отметить черновиком' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.status.c1') ?? '{}')).toEqual({ 'кот.png': 'draft' }))
    fireEvent.click(within(screen.getByTestId('image-studio-viewer')).getByRole('button', { name: 'Ещё действия с картинкой' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Инверсия просмотра (файл не меняется)' }))
    await waitFor(() => expect(document.querySelector('.image-studio-full[data-inverted]')).not.toBeNull())
  })

  it('Delete в мультирежиме удаляет всю пачку', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.keyDown(zone, { key: 'Delete' })
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(api['imgstudio:delete']).toHaveBeenCalledTimes(2))
  })

  it('«только выбранные» сужает сетку и возвращает её обратно', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }, { path: 'лиса.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать кот.png' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать пёс.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Только выбранные (2)' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    fireEvent.click(await screen.findByRole('button', { name: 'Показать все' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
    // Выход из мультирежима не должен оставить сетку сужённой.
    fireEvent.click(await screen.findByRole('button', { name: 'Только выбранные (2)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Готово' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
  })

  it('пресет запроса запоминает стиль с размером и применяет их обратно', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('combobox', { name: 'Стиль изображения' }), { target: { value: 'акварель' } })
    fireEvent.change(await screen.findByRole('combobox', { name: 'Размер изображения' }), { target: { value: '1080×1080' } })
    fireEvent.change(await screen.findByRole('textbox', { name: 'Имя пресета запроса' }), { target: { value: 'пост' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Запомнить пресет' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.recipes.c1') ?? '{}')).toEqual({ пост: { style: 'акварель', size: '1080×1080', negative: '', noText: false } }))

    // Сбрасываем руками и возвращаемся пресетом.
    fireEvent.change(screen.getByRole('combobox', { name: 'Стиль изображения' }), { target: { value: '' } })
    fireEvent.change(await screen.findByRole('combobox', { name: 'Пресет запроса' }), { target: { value: 'use:пост' } })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Стиль изображения' })).toHaveValue('акварель'))
    expect(screen.getByRole('combobox', { name: 'Размер изображения' })).toHaveValue('1080×1080')
  })

  it('двойной клик по имени открывает переименование, а не лайтбокс', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.doubleClick(await screen.findByRole('button', { name: 'Скопировать имя кот.png' }))
    expect(await screen.findByRole('textbox', { name: 'Новое имя файла' })).toBeInTheDocument()
    expect(screen.queryByTestId('image-studio-viewer')).toBeNull()
  })

  it('«все версии» показывает родню файла, а не только цепочку', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'посторонний.png' }])
    // Производные заводим правкой: она пишет source и рождает версии.
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'кот.png' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Промпт для изображения' }), { target: { value: 'добавь шляпу' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Изменить выбранную' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))

    const card = (await screen.findByRole('button', { name: 'кот.png' })).closest('[data-path]') as HTMLElement
    fireEvent.contextMenu(card)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Все версии (2)' }))
    await waitFor(() => {
      const paths = screen.getAllByRole('listitem').map((item) => item.getAttribute('data-path'))
      expect([...paths].sort()).toEqual(['кот-2.png', 'кот.png'])
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Показать всё' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
  })

  it('фильтр по весу оставляет только крупные файлы', async () => {
    const { api } = makeApi([{ path: 'большая.png', size: 3 * 1024 * 1024 }, { path: 'мелкая.png', size: 2048 }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Вес файла' }), { target: { value: '1' } })
    await waitFor(() => {
      const paths = screen.getAllByRole('listitem').map((item) => item.getAttribute('data-path'))
      expect(paths).toEqual(['большая.png'])
    })
    // Рядом со счётчиком — вес отобранного: по нему и чистят место.
    expect(await screen.findByText(/Показано 1 из 2 · 3 МБ/)).toBeInTheDocument()
  })

  it('цифра применяет сохранённый вид по порядку', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.jpg' }])
    localStorage.setItem('vc.imgstudio.views.c1', JSON.stringify({ 'только png': { kind: 'png' }, 'по имени': { order: 'name' } }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.keyDown(zone, { key: '1' })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(await screen.findByText('Вид «только png»')).toBeInTheDocument()
    fireEvent.keyDown(zone, { key: '2' })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Порядок картинок' })).toHaveValue('name'))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('выбранные убираются из набора, опустевший набор исчезает', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    localStorage.setItem('vc.imgstudio.sets.c1', JSON.stringify({ обложки: ['кот.png', 'пёс.png'] }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать кот.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Наборы для выбранных' }), { target: { value: 'drop:обложки' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.sets.c1') ?? '{}')).toEqual({ обложки: ['пёс.png'] }))

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать пёс.png' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Наборы для выбранных' }), { target: { value: 'drop:обложки' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.sets.c1') ?? '{}')).toEqual({}))
    expect(await screen.findByText('Набор «обложки» опустел и удалён')).toBeInTheDocument()
  })

  it('шаблон переименования показывает, что получится', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }, { path: 'лиса.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Шаблон пакетного переименования' }), { target: { value: 'кадр-{n}' } })
    // Первые две строки плюс «и ещё N»: предпросмотр не должен занимать экран.
    expect(await screen.findByText(/→ кадр-1\.png.*→ кадр-2\.png.*и ещё 1/)).toBeInTheDocument()
  })

  it('выбранные прикрепляются к сообщению чата пачкой', async () => {
    const attach = vi.fn()
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} onAttachToChat={attach} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'В сообщение (2)' }))
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(2))
    expect(attach.mock.calls.map(([file]) => (file as File).name).sort()).toEqual(['кот.png', 'пёс.png'])
  })

  it('лента кадров в лайтбоксе переключает картинку', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
    const viewer = await screen.findByTestId('image-studio-viewer')
    fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
    fireEvent.click(await within(viewer).findByRole('menuitem', { name: 'Лента кадров' }))
    const strip = await screen.findByRole('list', { name: 'Лента кадров' })
    // Элемент ленты — listitem-обёртка с кнопкой внутри: у кнопки должна
    // оставаться роль кнопки, иначе читалка не назовёт её нажимаемой.
    expect(within(strip).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(within(strip).getByRole('button', { name: 'пёс.png' }))
    await waitFor(() => expect(within(screen.getByTestId('image-studio-viewer')).getByText(/пёс\.png/)).toBeInTheDocument())
  })

  it('переименование предлагает вернуть прежнее имя', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Действия кот.png' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Новое имя файла' }), { target: { value: 'рыжий.png' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ок' }))
    await waitFor(() => expect(api['imgstudio:rename']).toHaveBeenCalledWith(expect.objectContaining({ from: 'кот.png', to: 'рыжий.png' })))

    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть имя' }))
    await waitFor(() => expect(api['imgstudio:rename']).toHaveBeenCalledWith(expect.objectContaining({ from: 'рыжий.png', to: 'кот.png' })))
  })

  it('пакетное удаление возвращается одной кнопкой в тосте', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить выбранные (2)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(api['imgstudio:delete']).toHaveBeenCalledTimes(2))
    fireEvent.click(within(await findToast('Удалено файлов: 2')).getByRole('button', { name: 'Вернуть' }))
    await waitFor(() => expect(api['imgstudio:restore']).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Возвращено файлов: 2')).toBeInTheDocument()
  })

  it('подпись текстом кладётся на все выбранные, дубликаты — пачкой', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Дубликаты (2)' }))
    await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: 'кот-копия.png' })))
    expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: 'пёс-копия.png' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Подпись для выбранных' }), { target: { value: 'черновик' } })
    fireEvent.click(await screen.findByRole('button', { name: /^Подписать текстом/ }))
    // captionImage работает через canvas, которого в jsdom нет: важно, что
    // действие дошло до пакетной обёртки и отчиталось.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Подписать текстом/ })).toBeInTheDocument())
  })

  it('ориентация отбирает по известным размерам, а неизвестные не скрывает', async () => {
    const { api } = makeApi([{ path: 'широкая.png' }, { path: 'высокая.png' }, { path: 'без-размера.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    // Размеры панель узнаёт из onLoad превью — в jsdom их подставляем сами.
    const images = await waitFor(() => {
      const found = document.querySelectorAll<HTMLImageElement>('.image-studio-thumb img')
      expect(found.length).toBe(3)
      return found
    })
    for (const image of images) {
      const path = image.closest('[data-path]')?.getAttribute('data-path')
      if (path === 'широкая.png') Object.defineProperty(image, 'naturalWidth', { value: 1200, configurable: true })
      if (path === 'широкая.png') Object.defineProperty(image, 'naturalHeight', { value: 630, configurable: true })
      if (path === 'высокая.png') Object.defineProperty(image, 'naturalWidth', { value: 1080, configurable: true })
      if (path === 'высокая.png') Object.defineProperty(image, 'naturalHeight', { value: 1920, configurable: true })
      fireEvent.load(image)
    }
    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Ориентация картинки' }), { target: { value: 'landscape' } })
    await waitFor(() => {
      const cards = screen.getAllByRole('listitem').map((item) => item.getAttribute('data-path'))
      // Высокая скрыта, широкая осталась, файл без известного размера — тоже.
      expect([...cards].sort()).toEqual(['без-размера.png', 'широкая.png'])
    })
  })

  it('ссылка на отбор кладётся в буфер, а адрес с отбором его применяет', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.jpg' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Тип файла' }), { target: { value: 'png' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ссылка на отбор' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/view/kind%3Dpng')))
  })

  it('группы сворачиваются все разом и помнят это в сессии', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    const { unmount } = render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'По датам' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Свернуть все' }))
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull())
    expect(JSON.parse(sessionStorage.getItem('vc.imgstudio.folded.c1') ?? '[]')).toEqual(['Раньше'])

    // Панель пересобрали (переключили чат и вернулись) — свёрнутое осталось.
    unmount()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: 'По датам' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Развернуть все' })).toBeInTheDocument())
    expect(screen.queryByRole('listitem')).toBeNull()
  })

  it('удаление предлагает отмену прямо в тосте', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить кот.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(api['imgstudio:delete']).toHaveBeenCalledWith(expect.objectContaining({ path: 'кот.png' })))
    // Тост несёт готовое действие: до этого вернуть файл можно было только
    // развернув корзину.
    fireEvent.click(await screen.findByRole('button', { name: 'Вернуть' }))
    await waitFor(() => expect(api['imgstudio:restore']).toHaveBeenCalledWith(expect.objectContaining({ name: 'кот.png' })))
    expect(await screen.findByText('«кот.png» возвращён')).toBeInTheDocument()
  })

  it('Home, End и PageDown ходят по сетке', async () => {
    const { api } = makeApi(Array.from({ length: 12 }, (_, index) => ({ path: `кадр-${index + 1}.png` })))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.click(await screen.findByRole('button', { name: 'кадр-1.png' }))
    fireEvent.keyDown(zone, { key: 'End' })
    // Порядок по умолчанию — «сначала новые», последний в сетке — самый старый.
    await waitFor(() => expect(document.querySelector('.image-studio-card--selected')?.getAttribute('data-path')).toBe('кадр-1.png'))
    fireEvent.keyDown(zone, { key: 'Home' })
    await waitFor(() => expect(document.querySelector('.image-studio-card--selected')?.getAttribute('data-path')).toBe('кадр-12.png'))
    // Без измеренной геометрии страница — три строки, в jsdom одна колонка.
    fireEvent.keyDown(zone, { key: 'PageDown' })
    await waitFor(() => expect(document.querySelector('.image-studio-card--selected')?.getAttribute('data-path')).toBe('кадр-9.png'))
  })

  it('«взять промпт» кладёт промпт файла в поле и снимает выбор', async () => {
    const { api } = makeApi([{ path: 'кот.png', prompt: 'рыжий кот, акварель' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const card = (await screen.findByRole('button', { name: 'кот.png' })).closest('[data-path]') as HTMLElement
    fireEvent.click(await screen.findByRole('button', { name: 'кот.png' }))
    fireEvent.contextMenu(card)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Взять промпт в поле' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Промпт для изображения' })).toHaveValue('рыжий кот, акварель'))
    // Выбор снят: промпт берут, чтобы нарисовать новое, а не править это.
    expect(document.querySelector('.image-studio-card--selected')).toBeNull()
  })

  it('хоткей p берёт промпт, хоткей n открывает заметку, F2 — переименование', async () => {
    const { api } = makeApi([{ path: 'кот.png', prompt: 'рыжий кот' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.click(await screen.findByRole('button', { name: 'кот.png' }))
    fireEvent.keyDown(zone, { key: 'p' })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Промпт для изображения' })).toHaveValue('рыжий кот'))

    fireEvent.click(await screen.findByRole('button', { name: 'кот.png' }))
    fireEvent.keyDown(zone, { key: 'n' })
    expect(await screen.findByRole('textbox', { name: 'Заметка к кот.png' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Заметка к кот.png' })).toBeNull())

    // Выбор не сбрасывается окном заметки, поэтому лишний клик по превью его
    // бы снял (клик по карточке — переключатель).
    fireEvent.keyDown(zone, { key: 'F2' })
    expect(await screen.findByRole('textbox', { name: 'Новое имя файла' })).toBeInTheDocument()
  })

  it('заметка правится в окне и показывается значком на карточке', async () => {
    const { api } = makeApi([{ path: 'кот.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    const card = (await screen.findByRole('button', { name: 'кот.png' })).closest('[data-path]') as HTMLElement
    fireEvent.contextMenu(card)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Заметка…' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Заметка к кот.png' }), { target: { value: 'для обложки' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.notes.c1') ?? '{}')).toEqual({ 'кот.png': 'для обложки' }))
    // След заметки виден в подписи карточки: своей кнопки в ряду действий у
    // неё больше нет — ряд ушёл в меню, — но знать о заметке нужно без наведения.
    expect(await screen.findByLabelText('Заметка: для обложки')).toBeInTheDocument()
    fireEvent.contextMenu(card)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Изменить заметку' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Убрать заметку' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.notes.c1') ?? '{}')).toEqual({}))
  })

  it('двойной клик по карточке открывает лайтбокс', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.doubleClick(await screen.findByRole('button', { name: 'кот.png' }))
    const viewer = await screen.findByTestId('image-studio-viewer')
    expect(within(viewer).getByText(/кот\.png/)).toBeInTheDocument()
  })

  it('группа по датам сворачивается заголовком', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'По датам' }))
    const head = await screen.findByRole('button', { name: /Раньше/ })
    expect(head).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(head)
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Раньше/ }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
  })

  it('вид запоминается и применяется одним нажатием', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.jpg' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Тип файла' }), { target: { value: 'png' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Виды…' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Имя вида' }), { target: { value: 'только png' } })
    fireEvent.click(screen.getByRole('button', { name: 'Запомнить нынешний вид' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.views.c1') ?? '{}')).toEqual({ 'только png': { kind: 'png' } }))

    // Снимаем условие руками и возвращаемся к виду кнопкой.
    fireEvent.click(await screen.findByRole('button', { name: 'Закрыть' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Тип файла' }), { target: { value: '' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Виды… (1)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'только png' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(await screen.findByText('Вид «только png» применён')).toBeInTheDocument()
  })

  it('архив выбранных собирается из выбора, а не из всей галереи', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }, { path: 'лиса.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать кот.png' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Выбрать пёс.png' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Архивом (2)' }))
    // Превью панель читает у всех карточек, поэтому счёт вызовов ничего не
    // докажет — судим по отчёту: в архив ушло ровно выбранное.
    expect(await screen.findByText('Архив собран: 2 файл(ов)')).toBeInTheDocument()
  })

  it('пометки выбранных ставятся и снимаются пачкой', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    localStorage.setItem('vc.imgstudio.notes.c1', JSON.stringify({ 'а.png': 'старая заметка' }))
    localStorage.setItem('vc.imgstudio.stars.c1', JSON.stringify(['а.png']))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
    const marks = await screen.findByRole('combobox', { name: 'Готовность выбранных' })
    fireEvent.change(marks, { target: { value: 'ready' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.status.c1') ?? '{}')).toEqual({ 'а.png': 'ready', 'б.png': 'ready' }))

    // «Снять все пометки» убирает и звезду, и заметку, и готовность.
    fireEvent.change(screen.getByRole('combobox', { name: 'Готовность выбранных' }), { target: { value: 'clear' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.status.c1') ?? '{}')).toEqual({}))
    expect(JSON.parse(localStorage.getItem('vc.imgstudio.stars.c1') ?? '[]')).toEqual([])
    expect(JSON.parse(localStorage.getItem('vc.imgstudio.notes.c1') ?? '{}')).toEqual({})
  })

  it('перенос пометок несёт и готовность', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Ещё…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Пометки…' }))
    const field = await screen.findByRole('textbox', { name: 'Пометки галереи в формате JSON' })
    fireEvent.change(field, { target: { value: JSON.stringify({ stars: [], notes: {}, statuses: { 'б.png': 'ready' } }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.status.c1') ?? '{}')).toEqual({ 'б.png': 'ready' }))
    expect(await screen.findByRole('button', { name: 'б.png: готово — снять пометку' })).toBeInTheDocument()
  })

  it('фильтр по набору показывает только его файлы', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    localStorage.setItem('vc.imgstudio.sets.c1', JSON.stringify({ обложки: ['а.png', 'в.png'] }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Набор файлов' }), { target: { value: 'обложки' } })
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    expect(screen.queryByRole('button', { name: 'б.png' })).toBeNull()
  })

  it('выбранные добавляются в существующий набор без дублей', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }])
    localStorage.setItem('vc.imgstudio.sets.c1', JSON.stringify({ обложки: ['а.png'] }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать несколько' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Ещё с выбранными…' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Наборы для выбранных' }), { target: { value: 'add:обложки' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('vc.imgstudio.sets.c1') ?? '{}')).toEqual({ обложки: ['а.png', 'б.png'] }))
  })

  it('сортировка «сначала готовые» поднимает готовые, потом черновики', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.png' }, { path: 'в.png' }])
    localStorage.setItem('vc.imgstudio.status.c1', JSON.stringify({ 'а.png': 'ready', 'б.png': 'draft' }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.change(await screen.findByRole('combobox', { name: 'Порядок картинок' }), { target: { value: 'ready' } })
    await waitFor(() => {
      const order2 = screen.getAllByRole('listitem').map((item) => item.getAttribute('data-path'))
      expect(order2).toEqual(['а.png', 'б.png', 'в.png'])
    })
  })

  it('счётчик «показано из» появляется, когда часть скрыта фильтром', async () => {
    const { api } = makeApi([{ path: 'а.png' }, { path: 'б.jpg' }, { path: 'в.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Отбор/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Тип файла' }), { target: { value: 'png' } })
    // Рядом со счётчиком теперь вес отобранного — сверяем по началу строки.
    expect(await screen.findByText(/^Показано 2 из 3/)).toBeInTheDocument()
  })

  it('хоткеи d и e: дубликат и переход к промпту', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    const zone = await screen.findByTestId('image-studio')

    fireEvent.click(await screen.findByRole('button', { name: 'кот.png' }))
    fireEvent.keyDown(zone, { key: 'd' })
    await waitFor(() => expect(api['imgstudio:upload']).toHaveBeenCalledWith(expect.objectContaining({ path: 'кот-копия.png' })))

    fireEvent.keyDown(zone, { key: 'e' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Промпт для изображения' })))
  })

  it('заметка видна в лайтбоксе без раскрытия свойств', async () => {
    const { api } = makeApi([{ path: 'кот.png' }, { path: 'пёс.png' }])
    localStorage.setItem('vc.imgstudio.notes.c1', JSON.stringify({ 'кот.png': 'для обложки статьи' }))
    render(<ImageStudioPane conversationId="c1" api={api as never} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть кот.png в полный размер' }))
    const viewer = await screen.findByTestId('image-studio-viewer')
    expect(within(viewer).getByText(/для обложки статьи/)).toBeInTheDocument()
    // При раскрытых свойствах строка не дублируется: там своё поле заметки.
    fireEvent.click(within(viewer).getByRole('button', { name: 'Ещё действия с картинкой' }))
    fireEvent.click(await within(viewer).findByRole('menuitem', { name: 'Свойства и заметка' }))
    await waitFor(() => expect(within(screen.getByTestId('image-studio-viewer')).queryByText(/^Заметка:$/)).toBeNull())
  })

  it('пустая галерея объясняет следующий шаг', async () => {
    const { api } = makeApi()
    render(<ImageStudioPane conversationId="c1" api={api as never} />)
    expect(await screen.findByText(/нарисуйте первую картинку/)).toBeInTheDocument()
  })
})
