// Сториз палитры: типовая выдача, поиск с подсветкой, задача по номеру, пустой
// результат, «недавние» и список на 600 бесед — тот случай, ради которого выдача
// ограничена. Команды передаются пропсом: реестр наполняют живые экраны, а в
// витрине их нет.
import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { userEvent, within } from '@storybook/test'
import { CommandPalette } from './CommandPalette'
import { Button } from '@voicechat/ui-kit'
import { rememberCommand, type Command, type CommandSection } from '../lib/commands'

function cmd(id: string, title: string, section: CommandSection, extra: Partial<Command> = {}): Command {
  return { id, title, section, run: () => {}, ...extra }
}

const COMMANDS: Command[] = [
  cmd('app.new-chat', 'Новая беседа', 'action'),
  cmd('app.mic', 'Говорить в микрофон', 'action', { hint: 'Удерживайте пробел', hotkey: 'Space' }),
  cmd('app.tts', 'Включить озвучку ответов', 'action'),
  cmd('app.theme', 'Тёмная тема', 'action'),
  cmd('app.settings', 'Открыть настройки', 'action'),
  cmd('app.kb', 'Открыть базу знаний', 'action'),
  cmd('app.palette', 'Командная палитра', 'action', { hotkey: 'mod+k' }),
  cmd('app.hotkeys', 'Горячие клавиши', 'action', { hotkey: '?' }),
  cmd('chat:1', 'Миграция базы на SQLite', 'chat'),
  cmd('chat:2', 'Поездка в Лиссабон', 'chat'),
  cmd('chat:3', 'Идеи для подарка', 'chat'),
  cmd('project:1', 'Голос Чат', 'project'),
  cmd('project:2', 'Внутренние инструменты', 'project'),
  cmd('task:1', 'GC-42 · Починить вход по паролю', 'task', { hint: 'Голос Чат', keywords: ['#42', '42'] }),
  cmd('task:2', 'GC-43 · Командная палитра', 'task', { hint: 'Голос Чат', keywords: ['#43', '43'] }),
  cmd('machine:1', 'Консоль: ноутбук', 'machine'),
  cmd('machine:2', 'Консоль: сервер сборки', 'machine')
]

/** 600 бесед: проверка, что выдача ограничена и список не превращается в простыню. */
const MANY: Command[] = [
  ...COMMANDS,
  ...Array.from({ length: 600 }, (_, i) => cmd(`chat:m${i}`, `Разговор про миграцию базы номер ${i}`, 'chat'))
]

const meta: Meta<typeof CommandPalette> = {
  title: 'UI/CommandPalette',
  component: CommandPalette,
  parameters: { layout: 'fullscreen' },
  args: { open: true, onClose: () => {}, commands: COMMANDS, apple: true }
}
export default meta
type Story = StoryObj<typeof CommandPalette>

/** Пустой запрос: разделы целиком. */
export const Sections: Story = {}

/** Набранный запрос: подсветка совпавших букв в разных разделах. */
export const Search: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(body.getByRole('combobox'), 'кп')
  }
}

/** Задача ищется по номеру: «#42». */
export const TaskByNumber: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(body.getByRole('combobox'), '#42')
  }
}

/** Ничего не нашлось — так и написано, а не пустой список. */
export const NothingFound: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(body.getByRole('combobox'), 'щщщ')
  }
}

/** «Недавние» сверху: они читаются из localStorage. */
export const Recent: Story = {
  render: (args) => {
    const [ready, setReady] = useState(false)
    useEffect(() => {
      rememberCommand('app.settings')
      rememberCommand('task:1')
      setReady(true)
    }, [])
    return ready ? <CommandPalette {...args} /> : <p style={{ padding: 20 }}>Готовим историю…</p>
  }
}

/** Список на 600 бесед: показываем первые, под группой — сколько скрыто. */
export const HugeList: Story = {
  args: { commands: MANY }
}

/** Подписи комбинаций в раскладке Windows/Linux. */
export const WindowsKeys: Story = {
  args: { apple: false }
}

/** Живая: открыть кнопкой, поискать, походить стрелками, закрыть Esc. */
export const Interactive: Story = {
  render: (args) => {
    const [open, setOpen] = useState(false)
    return (
      <div style={{ padding: 24 }}>
        <Button onClick={() => setOpen(true)}>Открыть палитру</Button>
        <CommandPalette {...args} open={open} onClose={() => setOpen(false)} />
      </div>
    )
  }
}
