import { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../test/uiRender'
import { CommandPalette } from './CommandPalette'
import { rememberCommand, type Command } from '../lib/commands'

function cmd(partial: Partial<Command> & Pick<Command, 'id' | 'title'>): Command {
  return { section: 'action', run: () => {}, ...partial }
}

const commands: Command[] = [
  cmd({ id: 'app.new-chat', title: 'Новая беседа' }),
  cmd({ id: 'app.settings', title: 'Открыть настройки', hotkey: 'mod+,' }),
  cmd({ id: 'chat:1', title: 'Миграция базы', section: 'chat' }),
  cmd({ id: 'project:1', title: 'Голос Чат', section: 'project' }),
  cmd({ id: 'task:1', title: 'VC-42 · Починить логин', section: 'task', keywords: ['#42', '42'], hint: 'Голос Чат' }),
  cmd({ id: 'machine:1', title: 'Консоль: ноутбук', section: 'machine' })
]

/** Поле ввода палитры. */
function input(): HTMLInputElement {
  return screen.getByRole('combobox') as HTMLInputElement
}

/** Названия видимых пунктов, сверху вниз. */
function items(): string[] {
  return screen.getAllByRole('option').map((node) => node.textContent ?? '')
}

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('закрытая палитра ничего не рисует', () => {
    render(<CommandPalette open={false} onClose={() => {}} commands={commands} />)
    expect(screen.queryByTestId('command-palette')).toBeNull()
  })

  it('открытая показывает разделы и ставит фокус в поле', () => {
    render(<CommandPalette open onClose={() => {}} commands={commands} />)
    expect(input()).toHaveFocus()
    for (const section of ['Действия', 'Беседы', 'Проекты', 'Задачи', 'Машины']) {
      expect(screen.getByText(section)).toBeInTheDocument()
    }
  })

  it('находит беседы, проекты, задачи и машины', () => {
    render(<CommandPalette open onClose={() => {}} commands={commands} />)
    fireEvent.change(input(), { target: { value: 'мигр' } })
    expect(items().join(' ')).toContain('Миграция базы')
    fireEvent.change(input(), { target: { value: 'голос' } })
    expect(items().join(' ')).toContain('Голос Чат')
    fireEvent.change(input(), { target: { value: 'ноут' } })
    expect(items().join(' ')).toContain('Консоль: ноутбук')
  })

  it('задача находится и по номеру «#42», и по названию', () => {
    render(<CommandPalette open onClose={() => {}} commands={commands} />)
    fireEvent.change(input(), { target: { value: '#42' } })
    expect(items()).toHaveLength(1)
    expect(items()[0]).toContain('Починить логин')
    fireEvent.change(input(), { target: { value: 'логин' } })
    expect(items()[0]).toContain('Починить логин')
  })

  it('совпавшие буквы подсвечены', () => {
    render(<CommandPalette open onClose={() => {}} commands={commands} />)
    fireEvent.change(input(), { target: { value: 'нас' } })
    const option = screen.getAllByRole('option').find((node) => node.textContent?.includes('Открыть настройки'))
    expect(option).toBeDefined()
    const marks = [...option!.querySelectorAll('mark.cmdk-hit')].map((node) => node.textContent)
    expect(marks.join('')).toBe('нас')
  })

  it('стрелки ведут выбор, Enter выполняет — мышь не нужна', () => {
    const run = vi.fn()
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={[cmd({ id: 'a', title: 'Первая' }), cmd({ id: 'b', title: 'Вторая', run })]}
      />
    )
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('выбор ходит по кругу', () => {
    render(<CommandPalette open onClose={() => {}} commands={[cmd({ id: 'a', title: 'Первая' }), cmd({ id: 'b', title: 'Вторая' })]} />)
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('выполнение закрывает палитру', () => {
    const onClose = vi.fn()
    const run = vi.fn()
    render(<CommandPalette open onClose={onClose} commands={[cmd({ id: 'a', title: 'Первая', run })]} />)
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(run).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('клик мышью выполняет команду', () => {
    const run = vi.fn()
    render(<CommandPalette open onClose={() => {}} commands={[cmd({ id: 'a', title: 'Первая', run })]} />)
    fireEvent.click(screen.getByRole('option'))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('Esc закрывает и возвращает фокус на открывашку', async () => {
    function Host(): JSX.Element {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Открыть</button>
          <CommandPalette open={open} onClose={() => setOpen(false)} commands={commands} />
        </>
      )
    }
    render(<Host />)
    const opener = screen.getByRole('button', { name: 'Открыть' })
    // Фокус на кнопке — как после настоящего клика: окно запоминает открывашку
    // именно по document.activeElement.
    opener.focus()
    fireEvent.click(opener)
    expect(input()).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull())
    expect(opener).toHaveFocus()
  })

  it('«Недавние» показываются сверху при пустом запросе и живут между открытиями', () => {
    rememberCommand('machine:1')
    const { unmount } = render(<CommandPalette open onClose={() => {}} commands={commands} />)
    expect(screen.getByText('Недавние')).toBeInTheDocument()
    expect(items()[0]).toContain('Консоль: ноутбук')
    unmount()
    // Новый рендер читает localStorage заново — как после перезагрузки страницы.
    render(<CommandPalette open onClose={() => {}} commands={commands} />)
    expect(items()[0]).toContain('Консоль: ноутбук')
  })

  it('выполненная команда попадает в «Недавние»', () => {
    const { unmount } = render(<CommandPalette open onClose={() => {}} commands={commands} />)
    fireEvent.change(input(), { target: { value: 'мигр' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    unmount()
    render(<CommandPalette open onClose={() => {}} commands={commands} />)
    expect(items()[0]).toContain('Миграция базы')
  })

  it('ничего не нашлось — так и написано', () => {
    render(<CommandPalette open onClose={() => {}} commands={commands} />)
    fireEvent.change(input(), { target: { value: 'щщщ' } })
    expect(screen.getByText('Ничего не найдено')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('выключенные команды не показываются', () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        commands={[cmd({ id: 'a', title: 'Доступная' }), cmd({ id: 'b', title: 'Недоступная', enabled: () => false })]}
      />
    )
    expect(items().join(' ')).toContain('Доступная')
    expect(items().join(' ')).not.toContain('Недоступная')
  })

  it('комбинация команды подписана в пункте', () => {
    render(<CommandPalette open onClose={() => {}} commands={commands} apple />)
    expect(screen.getByText('⌘,')).toBeInTheDocument()
  })

  it('500+ бесед не выводятся списком целиком и набор остаётся отзывчивым', () => {
    const many = Array.from({ length: 600 }, (_, i) =>
      cmd({ id: `chat:${i}`, title: `Разговор про миграцию базы номер ${i}`, section: 'chat' })
    )
    render(<CommandPalette open onClose={() => {}} commands={many} limitPerSection={8} />)
    expect(screen.getAllByRole('option')).toHaveLength(8)
    expect(screen.getByText(/и ещё 592/)).toBeInTheDocument()

    const started = performance.now()
    for (const query of ['р', 'ра', 'раз', 'разг', 'мигр', 'базы']) {
      fireEvent.change(input(), { target: { value: query } })
    }
    const spent = performance.now() - started
    // Шесть нажатий по 600 команд, включая перерисовку списка. Бюджет с запасом:
    // важно, что выдача ограничена и время не растёт с размером списка.
    expect(spent).toBeLessThan(2000)
    expect(screen.getAllByRole('option')).toHaveLength(8)
  })
})
