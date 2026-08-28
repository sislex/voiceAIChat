import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RoleCommandPolicyEditor } from './RoleCommandPolicyEditor'

describe('RoleCommandPolicyEditor', () => {
  it('собирает паттерны по строкам и сохраняет только непустые роли', async () => {
    const onSave = vi.fn(async () => {})
    render(<RoleCommandPolicyEditor roles={{ tester: { denyPatterns: ['git push'], allowPatterns: [] } }} onSave={onSave} />)
    expect(screen.getByLabelText('Запрещённые команды для tester')).toHaveValue('git push')
    fireEvent.change(screen.getByLabelText('Запрещённые команды для observer'), { target: { value: 'rm\n\n docker ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ tester: { denyPatterns: ['git push'], allowPatterns: [] }, observer: { denyPatterns: ['rm', 'docker'], allowPatterns: [] } }))
    expect(await screen.findByRole('button', { name: '✓ Сохранено' })).toBeInTheDocument()
  })
})
