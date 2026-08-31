import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Avatar, avatarContrast, initials } from './Avatar'
import { Badge } from './Badge'
import { StatCard } from './StatCard'
import { Tabs } from './Tabs'
import { SearchField } from './SearchField'
import { Switch } from './Switch'
import { StickyActionBar } from './StickyActionBar'
import { Sparkline, sparklinePaths } from './Sparkline'
import { Toolbar } from './Toolbar'
import { DefinitionList } from './DefinitionList'

describe('Avatar', () => {
  it('инициалы — до двух букв, разделители логина учитываются', () => {
    expect(initials('alexey')).toBe('AL')
    expect(initials('anna.k')).toBe('AK')
    expect(initials('s_orlov')).toBe('SO')
  })

  it('цвет фона держит контраст с белой подписью не ниже AA', () => {
    // Проверяем сам подбор светлоты: при фиксированных 42% зелёные тона давали 3.06:1.
    for (let hue = 0; hue < 360; hue += 15) {
      const best = [...Array(31).keys()].map((step) => 42 - step).find((lightness) => avatarContrast(hue, lightness) >= 4.5)
      expect(best, `тон ${hue}`).toBeDefined()
    }
  })

  it('фотография заменяет инициалы и не дублирует имя для скринридера', () => {
    render(<Avatar username="marina" photoUrl="https://example.test/marina.png" testId="ava-photo" />)
    const image = screen.getByTestId('ava-photo').querySelector('img')!
    expect(image).toHaveAttribute('src', 'https://example.test/marina.png')
    expect(image).toHaveAttribute('alt', '')
    expect(screen.getByTestId('ava-photo')).not.toHaveTextContent('MA')
  })

  it('рисует круг с инициалами и подписью-подсказкой', () => {
    render(<Avatar username="marina" testId="ava" />)
    expect(screen.getByTestId('ava')).toHaveTextContent('MA')
    expect(screen.getByTestId('ava')).toHaveAttribute('title', 'marina')
  })
})

describe('Badge', () => {
  it('тон задаёт класс, а не цвет в разметке', () => {
    render(<Badge tone="danger" testId="b">заблокирован</Badge>)
    expect(screen.getByTestId('b')).toHaveClass('vc-badge--danger')
    expect(screen.getByTestId('b').getAttribute('style')).toBeNull()
  })
})

describe('StatCard', () => {
  it('без подсказки вторая строка не рисуется', () => {
    const { container } = render(<StatCard label="Всего" value={24} />)
    expect(container.querySelector('.vc-stat__hint')).toBeNull()
  })

  it('тон подсказки виден классом', () => {
    const { container } = render(<StatCard label="Расход" value="$842" hint="78% бюджета" tone="warning" />)
    expect(container.querySelector('.vc-stat__hint')).toHaveClass('vc-stat__hint--warning')
  })
})

describe('Tabs', () => {
  const items = [
    { id: 'overview', label: 'Обзор' },
    { id: 'machines', label: 'Машины', count: 3 },
    { id: 'usage', label: 'Использование' }
  ]

  it('активная вкладка помечена и связана с панелью', () => {
    render(<Tabs items={items} activeId="machines" onChange={() => {}} label="Разделы" panelId="panel" />)
    const active = screen.getByRole('tab', { selected: true })
    expect(active).toHaveTextContent('Машины')
    expect(active).toHaveAttribute('aria-controls', 'panel')
    expect(within(active).getByText('3')).toBeInTheDocument()
  })

  it('стрелки и Home/End ходят по вкладкам по кругу', async () => {
    const onChange = vi.fn()
    render(<Tabs items={items} activeId="machines" onChange={onChange} label="Разделы" />)
    screen.getByRole('tab', { selected: true }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('usage')
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('overview')
    await userEvent.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('overview')
    await userEvent.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('usage')
  })

  it('в таб-порядке ровно одна вкладка: остальные достигаются стрелками', () => {
    render(<Tabs items={items} activeId="machines" onChange={() => {}} label="Разделы" />)
    const focusable = screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)
    expect(focusable).toHaveLength(1)
  })

  it('скрытая вкладка не рисуется', () => {
    render(<Tabs items={[...items, { id: 'secret', label: 'Скрытая', hidden: true }]} activeId="overview" onChange={() => {}} label="Разделы" />)
    expect(screen.queryByRole('tab', { name: /Скрытая/ })).toBeNull()
  })
})

describe('SearchField', () => {
  it('поле названо и очищается кнопкой', async () => {
    const onChange = vi.fn()
    render(<SearchField value="мар" onChange={onChange} label="Имя пользователя" />)
    expect(screen.getByLabelText('Имя пользователя')).toHaveValue('мар')
    await userEvent.click(screen.getByRole('button', { name: 'Очистить: Имя пользователя' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('пустое поле кнопки очистки не показывает', () => {
    render(<SearchField value="" onChange={() => {}} label="Имя пользователя" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('Switch', () => {
  it('объявляется как переключатель и сообщает новое состояние', async () => {
    const onChange = vi.fn()
    render(<Switch checked={false} onChange={onChange} label="Доступ к Claude" />)
    const control = screen.getByRole('switch', { name: 'Доступ к Claude' })
    expect(control).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(control)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('выключенный переключатель не срабатывает', async () => {
    const onChange = vi.fn()
    render(<Switch checked onChange={onChange} label="Доступ" disabled />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('StickyActionBar', () => {
  it('скрытая полоса не объявляется скринридеру, открытая — статус', () => {
    const { rerender } = render(
      <StickyActionBar open={false} title="Есть несохранённые изменения"><button type="button">Сохранить</button></StickyActionBar>
    )
    expect(screen.getByTestId('sticky-action-bar')).toHaveAttribute('aria-hidden', 'true')
    rerender(<StickyActionBar open title="Есть несохранённые изменения" hint="Доступ изменён"><button type="button">Сохранить</button></StickyActionBar>)
    const bar = screen.getByTestId('sticky-action-bar')
    expect(bar).toHaveAttribute('aria-hidden', 'false')
    expect(bar).toHaveAttribute('role', 'status')
    expect(bar).toHaveTextContent('Доступ изменён')
  })
})

describe('Sparkline', () => {
  it('путь заливки замыкается по нижней границе', () => {
    const { line, area } = sparklinePaths([1, 5, 3], 800, 160)
    expect(line.startsWith('M')).toBe(true)
    expect(area.endsWith('Z')).toBe(true)
    expect(area).toContain('L800 160')
  })

  it('одна точка не даёт NaN: график остаётся видимым', () => {
    const { line } = sparklinePaths([7], 800, 160)
    expect(line).not.toContain('NaN')
  })

  it('пустой ряд не рисует путей', () => {
    expect(sparklinePaths([], 800, 160)).toEqual({ line: '', area: '' })
  })

  it('график объявляется текстом: период и пик', () => {
    render(
      <Sparkline
        label="Расход по дням, USD"
        format={(value) => `$${value.toFixed(2)}`}
        points={[{ label: '1 авг', value: 2 }, { label: '2 авг', value: 9 }, { label: '3 авг', value: 4 }]}
      />
    )
    const image = screen.getByRole('img')
    expect(image).toHaveAccessibleName(/Расход по дням, USD/)
    expect(image).toHaveAccessibleName(/с 1 авг по 3 авг/)
    expect(image).toHaveAccessibleName(/максимум \$9\.00 — 2 авг/)
  })
})

describe('Toolbar', () => {
  it('сводка объявляется скринридеру только когда её просят живой', () => {
    const { rerender } = render(<Toolbar summary="6 пользователей" testId="tb" />)
    expect(screen.getByTestId('tb').querySelector('[role="status"]')).toBeNull()
    rerender(<Toolbar summary="1 пользователь" live testId="tb" />)
    expect(screen.getByRole('status')).toHaveTextContent('1 пользователь')
  })

  it('без действий правая часть не рисуется', () => {
    const { container } = render(<Toolbar summary="12 разрешено" />)
    expect(container.querySelector('.vc-toolbar__actions')).toBeNull()
  })
})

describe('DefinitionList', () => {
  it('пары связаны как dt/dd, а не слиты в строку текста', () => {
    render(<DefinitionList testId="dl" items={[{ label: 'ОС', value: 'macOS 15.6' }, { label: 'Версия', value: '2.8.1' }]} />)
    const list = screen.getByTestId('dl')
    expect(list.querySelectorAll('dt')).toHaveLength(2)
    expect(list.querySelectorAll('dd')[0]).toHaveTextContent('macOS 15.6')
  })

  it('пустое значение скрывается по требованию, а не показывается пустотой', () => {
    render(<DefinitionList testId="dl" items={[{ label: 'ОС', value: '', hideWhenEmpty: true }, { label: 'Версия', value: '2.8.1' }]} />)
    expect(screen.getByTestId('dl').querySelectorAll('dt')).toHaveLength(1)
  })
})
