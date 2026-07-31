import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { render } from '../test/uiRender'
import { HotkeysCheatSheet } from './HotkeysCheatSheet'
import type { Command } from '../lib/commands'

function cmd(partial: Partial<Command> & Pick<Command, 'id' | 'title'>): Command {
  return { section: 'action', run: () => {}, ...partial }
}

const commands: Command[] = [
  cmd({ id: 'app.mic', title: 'Говорить в микрофон', hotkey: 'Space', hotkeyNote: 'удержание' }),
  cmd({ id: 'app.stop', title: 'Отменить ответ модели', hotkey: 'Escape' }),
  cmd({ id: 'app.palette', title: 'Командная палитра', hotkey: 'mod+k' }),
  cmd({ id: 'app.hotkeys', title: 'Горячие клавиши', hotkey: '?' }),
  cmd({ id: 'app.kb', title: 'Открыть базу знаний' }),
  cmd({ id: 'chat:1', title: 'Миграция базы', section: 'chat' })
]

describe('HotkeysCheatSheet', () => {
  it('закрытая ничего не рисует', () => {
    render(<HotkeysCheatSheet open={false} onClose={() => {}} commands={commands} />)
    expect(screen.queryByTestId('hotkeys-sheet')).toBeNull()
  })

  it('генерируется из реестра: показывает только команды с комбинацией', () => {
    render(<HotkeysCheatSheet open onClose={() => {}} commands={commands} />)
    expect(screen.getByText('Говорить в микрофон')).toBeInTheDocument()
    expect(screen.getByText('Командная палитра')).toBeInTheDocument()
    // У «Открыть базу знаний» комбинации нет — в шпаргалке её быть не должно.
    expect(screen.queryByText('Открыть базу знаний')).toBeNull()
  })

  it('на macOS рисует ⌘, на остальных — Ctrl', () => {
    const { unmount } = render(<HotkeysCheatSheet open onClose={() => {}} commands={commands} apple />)
    expect(screen.getByText('⌘K')).toBeInTheDocument()
    unmount()
    render(<HotkeysCheatSheet open onClose={() => {}} commands={commands} apple={false} />)
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument()
  })

  it('подписывает клавиши без символа и поясняет удержание', () => {
    render(<HotkeysCheatSheet open onClose={() => {}} commands={commands} apple={false} />)
    expect(screen.getByText('Пробел')).toBeInTheDocument()
    expect(screen.getByText('Esc')).toBeInTheDocument()
    expect(screen.getByText('удержание')).toBeInTheDocument()
  })

  it('показывает и то, что сейчас недоступно: это документация, а не список применимого', () => {
    render(
      <HotkeysCheatSheet
        open
        onClose={() => {}}
        commands={[cmd({ id: 'app.mic', title: 'Говорить в микрофон', hotkey: 'Space', enabled: () => false })]}
      />
    )
    expect(screen.getByText('Говорить в микрофон')).toBeInTheDocument()
  })

  it('группирует по разделам реестра', () => {
    render(
      <HotkeysCheatSheet
        open
        onClose={() => {}}
        commands={[...commands, cmd({ id: 'machine:1', title: 'Консоль: ноутбук', section: 'machine', hotkey: 'mod+j' })]}
      />
    )
    expect(screen.getByText('Действия')).toBeInTheDocument()
    expect(screen.getByText('Машины')).toBeInTheDocument()
  })

  it('Esc закрывает', () => {
    const onClose = vi.fn()
    render(<HotkeysCheatSheet open onClose={onClose} commands={commands} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('без комбинаций в реестре — честная пустота, а не пустое окно', () => {
    render(<HotkeysCheatSheet open onClose={() => {}} commands={[cmd({ id: 'a', title: 'Без клавиши' })]} />)
    expect(screen.getByText('Горячих клавиш пока нет')).toBeInTheDocument()
  })
})
