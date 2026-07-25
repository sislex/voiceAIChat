import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentInfo } from '@shared/agentProtocol'
import { ConversationSettings } from './ConversationSettings'

const agent: AgentInfo = {
  id: 'm1', name: 'Рабочая машина', online: true, createdAt: 1, lastSeen: 1, version: '1', telemetry: undefined,
  policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [{ name: 'build', command: 'npm run build' }] }
}
const conversation = { id: 'c1', title: 'Старое имя', createdAt: 1, updatedAt: 1, messageCount: 0, claudeSessionId: null, execTarget: 'm1', workdir: null, skillNames: [], llmProvider: null, llmModel: null, lastExecTarget: null }
const settings = { llmProvider: 'claude', model: 'opus', codexModel: '' } as const

describe('ConversationSettings', () => {
  it('сохраняет название, машину, директорию и выбранные навыки', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const list = vi.fn().mockResolvedValue({ root: '/home/u', cwd: '/home/u/project', entries: [] })
    render(<ConversationSettings conversation={conversation} agents={[agent]} machineOps={{ list } as never} role="admin" settings={settings} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Старое имя'), { target: { value: 'Новый чат' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /build/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }))
    await screen.findByText('/home/u/project')
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать эту папку' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: 'Новый чат', execTarget: 'm1', workdir: '/home/u/project', skillNames: ['build'], llmProvider: null, llmModel: null }))
  })

  it('добавляет новый навык выбранной машине', async () => {
    const onAddSkill = vi.fn().mockResolvedValue(undefined)
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} onSave={vi.fn()} onAddSkill={onAddSkill} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Название'), { target: { value: 'test' } })
    fireEvent.change(screen.getByPlaceholderText('Команда'), { target: { value: 'npm test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(onAddSkill).toHaveBeenCalledWith('m1', { name: 'test', command: 'npm test' }))
  })

  it('сохраняет движок и модель разговора', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Движок разговора' }), { target: { value: 'codex' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Модель разговора' }), { target: { value: 'gpt-5-codex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: 'Старое имя', execTarget: 'm1', workdir: null, skillNames: [], llmProvider: 'codex', llmModel: 'gpt-5-codex' }))
  })

  it('роль user не видит модели opus/fable в выборе модели разговора', () => {
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="user" settings={settings} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Движок разговора' }), { target: { value: 'claude' } })
    const options = Array.from(screen.getByRole('combobox', { name: 'Модель разговора' }).querySelectorAll('option')).map((o) => o.value)
    expect(options).not.toContain('opus')
    expect(options).not.toContain('fable')
    expect(options).toContain('sonnet')
  })
})
