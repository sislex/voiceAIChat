// Сториз панели студии картинок: галерея с происхождением, пустое состояние,
// мультивыбор и ошибка загрузки. Мосты — без сети: список из фикстуры, байты —
// прозрачный пиксель (превью важно фактом, не содержимым).
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, fireEvent, userEvent, waitFor, within } from '@storybook/test'
import { ImageStudioPane } from './ImageStudioPane'
import { STUDIO_FILES, STUDIO_PIXEL_BASE64 } from '../test/fixtures/imageStudio'
import { imageStudioSetsKey, imageStudioStatusKey } from '../store/contracts'
import type { ImageStudioFile } from '@shared/imageStudio'

function storyApi(initial: ImageStudioFile[] = STUDIO_FILES, opts: { failList?: boolean; published?: boolean; passwordProtected?: boolean; trash?: Array<{ name: string; deletedAt: number }> } = {}) {
  let files = [...initial]
  let trashed: Array<{ file: ImageStudioFile; deletedAt: number }> = []
  return {
    'imgstudio:list': async () => {
      if (opts.failList) throw new Error('chat not found')
      return [...files]
    },
    'imgstudio:read': async ({ path }: { path: string }) => ({ path, dataBase64: STUDIO_PIXEL_BASE64 }),
    'imgstudio:upload': async ({ path }: { path: string }) => { files = [{ path, size: 3, updatedAt: Date.now() }, ...files]; return [...files] },
    // Удаление кладёт файл в корзину замыкания, восстановление достаёт его
    // обратно: иначе «Вернуть» в тосте показывает успех, а файл не возвращается,
    // и витрина врёт про поведение.
    'imgstudio:delete': async ({ path }: { path: string }) => {
      const gone = files.find((file) => file.path === path)
      if (gone) trashed = [{ file: gone, deletedAt: Date.now() }, ...trashed]
      files = files.filter((file) => file.path !== path)
      return [...files]
    },
    'imgstudio:rename': async ({ from, to }: { from: string; to: string }) => { files = files.map((file) => file.path === from ? { ...file, path: to } : file); return [...files] },
    'imgstudio:generate': async ({ prompt }: { prompt: string }) => { const file = { path: 'новая.png', size: prompt.length, updatedAt: Date.now() }; files = [file, ...files]; return { file, files: [...files] } },
    'imgstudio:edit': async ({ path }: { path: string }) => { const file = { path: path.replace('.png', '-2.png'), size: 10, updatedAt: Date.now() }; files = [file, ...files]; return { file, files: [...files] } },
    'imgstudio:cancel': async () => ({ cancelled: false }),
    'imgstudio:trash': async () => ({ items: [...(opts.trash ?? []), ...trashed.map((item) => ({ name: item.file.path, deletedAt: item.deletedAt }))] }),
    'imgstudio:restore': async ({ name }: { name: string }) => {
      const found = trashed.find((item) => item.file.path === name)
      if (found) {
        trashed = trashed.filter((item) => item !== found)
        files = [found.file, ...files]
      }
      return { name, files: [...files] }
    },
    'imgstudio:purge': async () => ({ removed: (opts.trash ?? []).length, items: [] }),
    'imgstudio:run': async () => ({ active: false }),
    'imgstudio:transfer': async ({ path }: { path: string }) => ({ name: path, files: [] }),
    'imgstudio:publish': async () => ({ url: '/g/deadbeefdeadbeefdeadbeefdeadbeef/', publishedAt: 1, views: 0, passwordProtected: false }),
    'imgstudio:publication': async () => (opts.published ? { url: '/g/deadbeefdeadbeefdeadbeefdeadbeef/', publishedAt: 1, views: 12, passwordProtected: Boolean(opts.passwordProtected) } : { url: null }),
    'imgstudio:unpublish': async () => ({ url: null })
  }
}

const meta: Meta<typeof ImageStudioPane> = {
  title: 'ImageStudio/ImageStudioPane',
  component: ImageStudioPane,
  args: { conversationId: 'story-conv', api: storyApi() as never },
  decorators: [(Story) => <div style={{ maxWidth: 520, minHeight: 480 }}><Story /></div>]
}
export default meta
type Story = StoryObj<typeof ImageStudioPane>

/** Галерея с правкой, оригиналом и загруженным руками файлом. */
export const Default: Story = {}

/** Пустая галерея: подсказка следующего шага и чипы-примеры промптов. */
export const Empty: Story = { args: { api: storyApi([]) as never } }

/** Режим множественного выбора с отмеченным файлом. */
export const MultiSelect: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Выбрать несколько' }))
    await userEvent.click(await canvas.findByRole('checkbox', { name: 'Выбрать кот.png' }))
    await waitFor(async () => { await canvas.findByRole('button', { name: 'Удалить выбранные (1)' }) })
  }
}

/** Галерея недоступна: ошибка с повтором вместо пустого экрана. */
export const LoadError: Story = { args: { api: storyApi([], { failList: true }) as never } }

/** Опубликованная галерея: ссылка со счётчиком просмотров, пароль, снятие. */
export const Published: Story = { args: { api: storyApi(STUDIO_FILES, { published: true }) as never } }

/** Публикация под паролем: кнопка показывает замок. */
export const PublishedWithPassword: Story = { args: { api: storyApi(STUDIO_FILES, { published: true, passwordProtected: true }) as never } }

/** Корзина с удалёнными: список и восстановление. */
export const WithTrash: Story = {
  args: { api: storyApi(STUDIO_FILES, { trash: [{ name: 'старый-кот.png', deletedAt: 1 }] }) as never },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /Корзина…/ }))
    await waitFor(async () => { await canvas.findByRole('button', { name: 'Восстановить старый-кот.png' }) })
  }
}

/** Мультивыбор из двух файлов: коллаж, избранное пачкой и шаблон имён. */
export const BatchActions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Выбрать несколько' }))
    await userEvent.click(await canvas.findByRole('button', { name: 'Выбрать все' }))
    await waitFor(async () => { await canvas.findByRole('button', { name: /Коллаж \(/ }) })
  }
}

/** Корзина с двумя файлами: восстановить всё или очистить навсегда. */
export const TrashWithPurge: Story = {
  args: { api: storyApi(STUDIO_FILES, { trash: [{ name: 'старый-кот.png', deletedAt: 1 }, { name: 'старый-пёс.png', deletedAt: 2 }] }) as never },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /Корзина…/ }))
    await waitFor(async () => { await canvas.findByRole('button', { name: 'Очистить корзину (2)' }) })
  }
}

/** Найденные дубликаты: копии отмечены, самый старый файл оставлен. */
export const Duplicates: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Найти дубликаты' }))
    await waitFor(async () => { await canvas.findByRole('button', { name: 'Готово' }) })
  }
}

/** Шпаргалка клавиш галереи: комбинация слева, смысл справа. */
export const KeysCheatSheet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Горячие клавиши галереи' }))
    await waitFor(async () => {
      const body = within(canvasElement.ownerDocument.body)
      await body.findByText('Клавиши галереи')
    })
  }
}

/** Перенос звёзд и заметок текстом — единственный путь между браузерами. */
export const MarksTransfer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Пометки…' }))
    await waitFor(async () => {
      const body = within(canvasElement.ownerDocument.body)
      await body.findByRole('textbox', { name: 'Пометки галереи в формате JSON' })
    })
  }
}

/** Контекстное меню карточки: частые действия без поиска нужной иконки. */
export const CardMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const thumb = await canvas.findByRole('button', { name: 'кот.png' })
    const card = thumb.closest('[data-path]') as HTMLElement
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 180, clientY: 220 }))
    await waitFor(async () => {
      const body = within(canvasElement.ownerDocument.body)
      await body.findByRole('menu', { name: 'Действия кот.png' })
    })
  }
}

/** Сетка, разбитая по датам: «Сегодня», «Вчера», «Раньше». */
export const GroupedByDay: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'По датам' }))
    await waitFor(async () => { await canvas.findByRole('button', { name: 'Без групп' }) })
  }
}

/** Сохранённый набор: чип возвращает прежний выбор одним нажатием. */
export const SavedSet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Выбрать несколько' }))
    await userEvent.click(await canvas.findByRole('checkbox', { name: 'Выбрать кот.png' }))
    await userEvent.type(await canvas.findByRole('textbox', { name: 'Имя набора' }), 'обложки')
    await userEvent.click(await canvas.findByRole('button', { name: 'Сохранить набор' }))
    await waitFor(async () => { await canvas.findByRole('button', { name: /обложки \(1\)/ }) })
  }
}

/**
 * Готовность и наборы: панель читает пометки из localStorage при монтировании,
 * поэтому сеем их в инициализаторе рендера, а не в эффекте декоратора.
 */
export const ReadyAndSets: Story = {
  decorators: [(Story) => {
    useState(() => {
      localStorage.setItem(imageStudioStatusKey('story-conv'), JSON.stringify({ 'кот.png': 'ready', 'пёс.png': 'draft' }))
      localStorage.setItem(imageStudioSetsKey('story-conv'), JSON.stringify({ обложки: ['кот.png'] }))
      return true
    })
    return <Story />
  }],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Кнопка порядка циклическая: подпись меняется на текущий режим, поэтому
    // жмём её, пока не дойдём до «Сначала готовые».
    for (let step = 0; step < 5; step += 1) {
      if (canvas.queryByRole('button', { name: 'Сначала готовые' })) break
      await userEvent.click(await canvas.findByRole('button', { name: /^(Сначала новые|По имени|По размеру|Сначала избранные)$/ }))
    }
    await canvas.findByRole('button', { name: 'Сначала готовые' })
    await userEvent.selectOptions(await canvas.findByRole('combobox', { name: 'Набор файлов' }), 'обложки')
    await waitFor(async () => { expect(await canvas.findByText('Показано 1 из 3')).toBeTruthy() })
  }
}

/**
 * Большая галерея: 120 файлов. Сетка рисует только видимое окно строк —
 * состояние, ради которого в панель добавлена виртуализация, и увидеть его
 * можно только на настоящей прокрутке (в jsdom высоты нулевые).
 */
export const HugeGallery: Story = {
  // Своя обёртка с фиксированной высотой: панель сама себе скроллер
  // (`.image-studio { overflow: auto }`), а без ограничения высоты прокручивается
  // страница витрины и окно строк не считается.
  decorators: [(Story) => <div style={{ maxWidth: 520, height: 520, display: 'flex' }}><Story /></div>],
  args: { api: storyApi(Array.from({ length: 120 }, (_, index) => ({ path: `кадр-${String(index + 1).padStart(3, '0')}.png`, size: 4096 + index, updatedAt: 1700000000000 - index * 60000 }))) as never }
}

/** Заметка к файлу правится отдельным окном — из меню карточки или клавишей `n`. */
export const NoteDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const card = (await canvas.findByRole('button', { name: 'кот.png' })).closest('[data-path]') as HTMLElement
    // Правый клик — событием: `userEvent.pointer` контекстное меню не рождает.
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 180, clientY: 220 }))
    await userEvent.click(await body.findByRole('menuitem', { name: /Заметка…|Изменить заметку/ }))
    fireEvent.change(await body.findByRole('textbox', { name: 'Заметка к кот.png' }), { target: { value: 'нужна для обложки' } })
  }
}

/** Виды галереи: сохранённые фильтры и порядок возвращаются одним нажатием. */
export const ViewsDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Окно уходит порталом в body — искать в нём, а не в канвасе сториз.
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await canvas.findByRole('button', { name: /^Виды…/ }))
    // Поле в окне-портале заполняем событием: `userEvent.type` доводит текст до
    // DOM, но React-состояние остаётся пустым, и кнопка сохранения не включается
    // (кнопка disabled — проверено в браузере).
    fireEvent.change(await body.findByRole('textbox', { name: 'Имя вида' }), { target: { value: 'обложки' } })
    await userEvent.click(await body.findByRole('button', { name: 'Запомнить нынешний вид' }))
    await waitFor(async () => { expect(await body.findByText('без условий')).toBeTruthy() })
  }
}
