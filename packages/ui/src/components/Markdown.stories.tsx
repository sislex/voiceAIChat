// Сториз markdown-рендера ответов: то, на чём он ломается в первую очередь —
// таблицы GFM, длинный код с подсветкой и горизонтальным скроллом, ссылки
// (уходят во внешний браузер) и чек-листы. Образцы — общие фикстуры
// (`test/fixtures/chat.ts`), те же, что в dom-тестах.
import type { Meta, StoryObj } from '@storybook/react'
import { expect, userEvent, waitFor, within } from '@storybook/test'
import { Markdown } from './Markdown'
import { MD_CHECKLIST, MD_CODE_LONG, MD_KITCHEN_SINK, MD_LINKS, MD_TABLE } from '../test/fixtures'

const meta: Meta<typeof Markdown> = {
  title: 'Chat/Markdown',
  component: Markdown,
  // Пузырь ответа шириной как в чате: перенос строк и обрезание проверяются
  // только на реальной ширине.
  decorators: [(Story) => <div className="msg ai"><div className="bub" style={{ maxWidth: 720 }}><Story /></div></div>]
}
export default meta
type Story = StoryObj<typeof Markdown>

/** Таблица GFM: выравнивание колонок, инлайн-код и длинная ячейка. */
export const Table: Story = { args: { children: MD_TABLE } }

/**
 * Длинный код: подсветка (rehype-highlight сам определяет язык), кнопка
 * копирования в углу и строка без пробелов — она и проверяет скролл блока.
 */
export const LongCode: Story = { args: { children: MD_CODE_LONG } }

/** Ссылки: обычные, сноской и автоссылка GFM (все с target=_blank). */
export const Links: Story = { args: { children: MD_LINKS } }

/** Чек-листы, включая вложенный, и нумерованный список. */
export const Checklist: Story = { args: { children: MD_CHECKLIST } }

/** Всё сразу: заголовки, цитата, разделитель, зачёркивание, таблица, код. */
export const KitchenSink: Story = { args: { children: MD_KITCHEN_SINK } }

/**
 * Копирование кода: кнопка ⧉ читает текст блока из DOM и на 1.5с превращается
 * в ✓. В небезопасном контексте `navigator.clipboard` недоступен — тогда
 * работает fallback на `execCommand`, и подпись всё равно меняется.
 */
export const CopyCode: Story = {
  args: { children: MD_CODE_LONG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [copy] = canvas.getAllByRole('button', { name: 'Копировать код' })
    await userEvent.click(copy)
    // Подпись меняется не сразу: копирование асинхронное (и через 1.5с вернётся ⧉).
    await waitFor(() => expect(copy).toHaveTextContent('✓'))
  }
}
