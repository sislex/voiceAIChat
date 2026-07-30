import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CiTaskSettings } from './CiTaskSettings'
import { createFakeCi } from '../../test/fakeApi'

describe('CiTaskSettings', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  it('показывает унаследованные движок и модель и сохраняет переопределение', async () => {
    render(<CiTaskSettings projectId="p1" taskId="t1" />)
    await waitFor(() => expect(screen.getByLabelText('Движок модели')).toHaveValue('claude'))
    expect(screen.getAllByText('унаследовано').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Движок модели'), { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить движок и модель' }))
    await waitFor(() => expect(screen.getByText('переопределено')).toBeInTheDocument())
  })

  it('возвращает настройку проекта: кнопка сброса видна только при переопределении', async () => {
    render(<CiTaskSettings projectId="p1" taskId="t1" />)
    await waitFor(() => expect(screen.getByLabelText('Движок модели')).toHaveValue('claude'))
    expect(screen.queryByRole('button', { name: 'Вернуть настройку проекта' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Движок модели'), { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить движок и модель' }))
    const reset = await screen.findByRole('button', { name: 'Вернуть настройку проекта' })

    fireEvent.click(reset)
    await waitFor(() => expect(screen.getByLabelText('Движок модели')).toHaveValue('claude'))
    expect(screen.queryByRole('button', { name: 'Вернуть настройку проекта' })).not.toBeInTheDocument()
    expect(screen.getAllByText('унаследовано').length).toBeGreaterThan(0)
  })
})
