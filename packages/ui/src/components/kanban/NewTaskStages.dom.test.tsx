import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AttemptList, CheckList, MetricTiles, StageCard, StageRail } from './NewTaskStages'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'

const cycle: TaskReworkCycleViewModel = {
  id: 'c2', sequence: 2, description: 'Компактный статус\nПоказывать рядом с сообщением', criteria: ['Виден скринридеру'],
  makeSources: [], attachments: [], createdBy: 'alex', createdAt: Date.UTC(2026, 8, 7), preparationRunId: null, status: 'submitted'
}

describe('NewTaskStages', () => {
  it('рисует этап с номером, статусом дизайна, workflow и доработками цикла', () => {
    const select = vi.fn()
    render(<StageRail>
      <StageCard number={1} status="success" eyebrow="Этап 1" title="Исходная постановка" sourceTitle="Источник" sourceText="Описание задачи" connector />
      <StageCard number={2} status="running" eyebrow="Этап 2" title="Доработка 2" workflow={['Подготовка', 'Development']} cycle={cycle} onSelect={select} details={<p>Лента</p>} />
    </StageRail>)
    expect(screen.getByText('Успешно')).toBeTruthy()
    expect(screen.getByText('Выполняется')).toBeTruthy()
    expect(screen.getByText('Источник')).toBeTruthy()
    expect(screen.getByText('Текущий workflow задачи')).toBeTruthy()
    // Первая строка описания — заголовок доработки, критерии — отдельной строкой.
    expect(screen.getByText('Компактный статус')).toBeTruthy()
    expect(screen.getByText('Критерии: Виден скринридеру')).toBeTruthy()
    // Живой этап раскрыт по умолчанию, у невыбранного есть «Показать».
    expect(screen.getByText('Лента').closest('details')).toHaveAttribute('open')
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }))
    expect(select).toHaveBeenCalledOnce()
  })

  it('список попыток переключает выбранную и молчит при одной попытке', () => {
    const select = vi.fn()
    const { rerender } = render(<AttemptList ariaLabel="Попытки" selectedId="a" onSelect={select} attempts={[{ id: 'a', label: 'Попытка 1', status: 'failed', at: 1 }, { id: 'b', label: 'Попытка 2', status: 'success', at: 2 }]} />)
    expect(screen.getByRole('button', { name: /Попытка 1/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Попытка 2/ }))
    expect(select).toHaveBeenCalledWith('b')
    rerender(<AttemptList ariaLabel="Попытки" attempts={[{ id: 'a', label: 'Попытка 1', status: 'failed' }]} />)
    expect(screen.queryByRole('group', { name: 'Попытки' })).toBeNull()
  })

  it('проверки и метрики подписаны', () => {
    render(<><CheckList checks={[{ id: 'a', title: 'Контракт', note: 'Пройдено', ok: true }, { id: 'b', title: 'Тесты', note: 'Требует внимания', ok: false }]} /><MetricTiles items={[{ label: 'Время', value: '42:18' }]} /></>)
    expect(screen.getByText('Контракт')).toBeTruthy()
    expect(screen.getByText('Требует внимания')).toBeTruthy()
    expect(screen.getByText('42:18')).toBeTruthy()
  })
})
