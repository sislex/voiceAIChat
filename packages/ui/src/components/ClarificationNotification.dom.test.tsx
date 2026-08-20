import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { expectNoViolations } from '../test/a11y'
import { clarificationNotification, longClarificationNotification } from '../test/fixtures'
import { ClarificationNotification, NotificationContainer } from './ClarificationNotification'

describe('ClarificationNotification', () => {
  it('показывает задачу, проект и вопрос и выполняет независимые действия', async () => {
    const onOpen = vi.fn(), onDismiss = vi.fn()
    render(<ClarificationNotification notification={clarificationNotification} onOpen={onOpen} onDismiss={onDismiss} />)
    expect(screen.getByText('Требуется уточнение ТЗ')).toBeInTheDocument()
    expect(screen.getByText(clarificationNotification.taskTitle)).toBeInTheDocument()
    expect(screen.getByText(`Проект: ${clarificationNotification.projectName}`)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Перейти к задаче' }))
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onOpen).toHaveBeenCalledWith(clarificationNotification)
    expect(onDismiss).toHaveBeenCalledWith(clarificationNotification)
  })

  it('не позволяет перейти по устаревшему вопросу и оставляет закрытие доступным', () => {
    render(<ClarificationNotification notification={clarificationNotification} state="stale" onOpen={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Перейти к задаче' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeEnabled()
  })

  it('показывает независимые уведомления списком и проходит axe', async () => {
    const { container } = render(<NotificationContainer notifications={[clarificationNotification, longClarificationNotification]} onOpen={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getAllByRole('article')).toHaveLength(2)
    await expectNoViolations(container)
  })

  it('не создаёт контейнер для закрытого состояния', () => {
    const { container } = render(<NotificationContainer notifications={[]} onOpen={vi.fn()} onDismiss={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

