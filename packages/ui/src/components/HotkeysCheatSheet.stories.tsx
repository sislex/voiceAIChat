// Сториз шпаргалки: одна и та же выдача в двух раскладках — ⌘ на macOS и Ctrl на
// остальных. Список генерируется из реестра команд, поэтому «данные» здесь — это
// набор команд с объявленными комбинациями.
import type { Meta, StoryObj } from '@storybook/react'
import { HotkeysCheatSheet } from './HotkeysCheatSheet'
import type { Command, CommandSection } from '../lib/commands'

function cmd(id: string, title: string, section: CommandSection, hotkey: string, note?: string): Command {
  return { id, title, section, hotkey, ...(note ? { hotkeyNote: note } : {}), run: () => {} }
}

const COMMANDS: Command[] = [
  cmd('app.mic', 'Говорить в микрофон', 'action', 'Space', 'удержание'),
  cmd('app.stop', 'Остановить запись или отменить ответ', 'action', 'Escape'),
  cmd('app.palette', 'Командная палитра', 'action', 'mod+k'),
  cmd('app.hotkeys', 'Горячие клавиши', 'action', '?'),
  cmd('machine:1', 'Консоль машины', 'machine', 'mod+j')
]

const meta: Meta<typeof HotkeysCheatSheet> = {
  title: 'UI/HotkeysCheatSheet',
  component: HotkeysCheatSheet,
  parameters: { layout: 'fullscreen' },
  args: { open: true, onClose: () => {}, commands: COMMANDS }
}
export default meta
type Story = StoryObj<typeof HotkeysCheatSheet>

/** macOS: ⌘ и модификаторы без плюсов. */
export const MacOs: Story = { args: { apple: true } }

/** Windows/Linux: Ctrl+K. */
export const WindowsLinux: Story = { args: { apple: false } }

/** Ни одна команда не объявила комбинацию. */
export const Empty: Story = { args: { commands: [], apple: false } }
