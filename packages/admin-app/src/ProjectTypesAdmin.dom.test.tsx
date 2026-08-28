import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectTypesAdmin } from './ProjectTypesAdmin'
import type { ProjectTypeNode } from '@shared/projectTypes'

const node = (over: Partial<ProjectTypeNode> = {}): ProjectTypeNode => ({
  id: 'own1', parentId: 'type-software', name: 'Бэкенд-сервис',
  description: 'Из проекта «API»', features: { preview: false, ci: true }, defaults: {},
  builtin: false, ownerId: 'bob', status: 'pending', reviewNote: '',
  createdBy: 'bob', createdAt: 0, updatedAt: 0, ...over
})

describe('ProjectTypesAdmin', () => {
  it('пустая очередь объясняет, что здесь появится', () => {
    render(<ProjectTypesAdmin pending={[]} onReview={vi.fn()} />)
    expect(screen.getByText('Заявок нет')).toBeInTheDocument()
  })

  it('показывает заявку с автором и возможностями', () => {
    render(<ProjectTypesAdmin pending={[node()]} onReview={vi.fn()} />)
    expect(screen.getByText('Бэкенд-сервис')).toBeInTheDocument()
    expect(screen.getByText(/автор: bob/)).toBeInTheDocument()
    expect(screen.getByText('ci')).toBeInTheDocument()
  })

  it('утверждение уходит без причины', async () => {
    const onReview = vi.fn()
    render(<ProjectTypesAdmin pending={[node()]} onReview={onReview} />)
    await userEvent.click(screen.getByRole('button', { name: 'Утвердить' }))
    expect(onReview).toHaveBeenCalledWith({ id: 'own1', decision: 'approve' })
  })

  it('отклонить нельзя без причины — автору иначе нечего исправлять', async () => {
    const onReview = vi.fn()
    render(<ProjectTypesAdmin pending={[node()]} onReview={onReview} />)
    const reject = screen.getByRole('button', { name: 'Отклонить' })
    expect(reject).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Причина отказа'), '  слишком узкий  ')
    expect(reject).toBeEnabled()
    await userEvent.click(reject)
    expect(onReview).toHaveBeenCalledWith({ id: 'own1', decision: 'reject', note: 'слишком узкий' })
  })

  it('причина хранится по заявке, а не общая на очередь', async () => {
    const onReview = vi.fn()
    render(<ProjectTypesAdmin pending={[node(), node({ id: 'own2', name: 'Мобильное' })]} onReview={onReview} />)
    const fields = screen.getAllByLabelText('Причина отказа')
    await userEvent.type(fields[0], 'первая')
    expect(fields[1]).toHaveValue('')
    // Вторая заявка остаётся с выключенной кнопкой отказа.
    expect(screen.getAllByRole('button', { name: 'Отклонить' })[1]).toBeDisabled()
  })
})
