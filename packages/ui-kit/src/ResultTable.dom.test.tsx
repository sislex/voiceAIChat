import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultTable } from './ResultTable'

const rows = [
  { id: 'a', name: 'Поиск по заголовку диалога', result: 'Пройдено', tone: 'success' as const },
  { id: 'b', name: 'Навигация с клавиатуры', result: 'В работе', tone: 'running' as const, detail: 'шаг 3 из 4' }
]

describe('ResultTable', () => {
  it('это настоящая таблица с именем и заголовками колонок', () => {
    render(<ResultTable rows={rows} caption="Сценарии Component QA" />)
    expect(screen.getByRole('table', { name: 'Сценарии Component QA' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Проверка' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Результат' })).toBeInTheDocument()
  })

  it('название проверки — заголовок своей строки: читалка связывает его с результатом', () => {
    render(<ResultTable rows={rows} caption="Сценарии" />)
    const header = screen.getByRole('rowheader', { name: /Поиск по заголовку диалога/ })
    expect(header).toBeInTheDocument()
  })

  it('результат окрашен тоном, а не сырым статусом', () => {
    render(<ResultTable rows={rows} caption="Сценарии" />)
    expect(screen.getByText('Пройдено')).toHaveClass('vc-results__result--success')
    expect(screen.getByText('В работе')).toHaveClass('vc-results__result--running')
  })

  it('подробность стоит под названием, а не в колонке результата', () => {
    render(<ResultTable rows={rows} caption="Сценарии" />)
    expect(screen.getByText('шаг 3 из 4')).toHaveClass('vc-results__detail')
  })

  it('подпись колонки результата переопределяется', () => {
    render(<ResultTable rows={rows} caption="Сценарии" resultLabel="Вердикт" />)
    expect(screen.getByRole('columnheader', { name: 'Вердикт' })).toBeInTheDocument()
  })
})
