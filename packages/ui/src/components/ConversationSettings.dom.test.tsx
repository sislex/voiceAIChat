import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentInfo } from '@shared/agentProtocol'
import { ConversationSettings } from './ConversationSettings'

const agent: AgentInfo = {
  id: 'm1', name: 'Рабочая машина', online: true, createdAt: 1, lastSeen: 1, version: '1', telemetry: undefined,
  policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [{ name: 'build', command: 'npm run build' }] }
}
const conversation = { id: 'c1', title: 'Старое имя', createdAt: 1, updatedAt: 1, messageCount: 0, claudeSessionId: null, execTarget: 'm1', workdir: null, skillNames: [], lastExecTarget: null }

describe('ConversationSettings', () => {
  it('сохраняет название, машину, директорию и выбранные навыки', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const list = vi.fn().mockResolvedValue({ root: '/home/u', cwd: '/home/u/project', entries: [] })
    render(<ConversationSettings conversation={conversation} agents={[agent]} machineOps={{ list } as never} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Старое имя'), { target: { value: 'Новый чат' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /build/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }))
    await screen.findByText('/home/u/project')
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать эту папку' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: 'Новый чат', execTarget: 'm1', workdir: '/home/u/project', skillNames: ['build'] }))
  })

  it('добавляет новый навык выбранной машине', async () => {
    const onAddSkill = vi.fn().mockResolvedValue(undefined)
    render(<ConversationSettings conversation={conversation} agents={[agent]} onSave={vi.fn()} onAddSkill={onAddSkill} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Название'), { target: { value: 'test' } })
    fireEvent.change(screen.getByPlaceholderText('Команда'), { target: { value: 'npm test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(onAddSkill).toHaveBeenCalledWith('m1', { name: 'test', command: 'npm test' }))
  })
})
