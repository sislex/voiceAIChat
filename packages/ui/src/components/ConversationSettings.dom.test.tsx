import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentInfo } from '@shared/agentProtocol'
import { ConversationSettings } from './ConversationSettings'

const agent: AgentInfo = {
  id: 'm1', name: 'Рабочая машина', online: true, createdAt: 1, lastSeen: 1, version: '1', telemetry: undefined,
  policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [{ name: 'build', command: 'npm run build' }] }
}
const conversation = { id: 'c1', title: 'Старое имя', createdAt: 1, updatedAt: 1, messageCount: 0, claudeSessionId: null, execTarget: 'm1', workdir: null, skillNames: [], llmProvider: null, llmModel: null, permissionMode: null, lastExecTarget: null }
const settings = { llmProvider: 'claude', model: 'opus', codexModel: '', permissionMode: 'bypassPermissions' } as const

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
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: 'Новый чат', execTarget: 'm1', workdir: '/home/u/project', skillNames: ['build'], llmProvider: null, llmModel: null, permissionMode: null, kbContextMode: 'auto' }))
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
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: 'Старое имя', execTarget: 'm1', workdir: null, skillNames: [], llmProvider: 'codex', llmModel: 'gpt-5-codex', permissionMode: null, kbContextMode: 'auto' }))
  })

  it('роль user не видит модели opus/fable в выборе модели разговора', () => {
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="user" settings={settings} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Движок разговора' }), { target: { value: 'claude' } })
    const options = Array.from(screen.getByRole('combobox', { name: 'Модель разговора' }).querySelectorAll('option')).map((o) => o.value)
    expect(options).not.toContain('opus')
    expect(options).not.toContain('fable')
    expect(options).toContain('sonnet')
  })

  it('в списке движков нет пункта «по умолчанию» — только движки, предвыбран глобальный', () => {
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    const engine = screen.getByRole('combobox', { name: 'Движок разговора' }) as HTMLSelectElement
    const options = Array.from(engine.querySelectorAll('option')).map((o) => o.value)
    expect(options).toEqual(['claude', 'codex'])
    expect(engine.value).toBe('claude')
    // Поле модели видно всегда и зависит от движка.
    expect(screen.getByRole('combobox', { name: 'Модель разговора' })).toBeInTheDocument()
  })

  it('сохраняет режим прав разговора и показывает действующий режим', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    // До выбора наследуем общие настройки.
    expect(screen.getByTestId('conv-mode-current')).toHaveTextContent('Сейчас действует: Полный доступ')
    fireEvent.change(screen.getByRole('combobox', { name: 'Режим разговора' }), { target: { value: 'plan' } })
    expect(screen.getByTestId('conv-mode-current')).toHaveTextContent('Сейчас действует: Только планирование')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'plan' })))
  })

  it('роль user без машины видит, что действует только планирование', () => {
    const conv = { ...conversation, execTarget: null }
    render(<ConversationSettings conversation={conv} agents={[agent]} role="user" settings={settings} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByTestId('conv-mode-current')).toHaveTextContent('Только планирование')
    expect(screen.getByTestId('conv-mode-current')).toHaveTextContent('без своей машины')
  })

  it('предвыбирает машину по умолчанию в новом разговоре и помечает её в списке', () => {
    const conv = { ...conversation, execTarget: null, messageCount: 0 }
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ConversationSettings conversation={conv} agents={[agent]} role="admin" settings={settings} defaultAgentId="m1" onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Рабочая машина — по умолчанию/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    return waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ execTarget: 'm1' })))
  })

  it('просит подтверждение при переходе из плана в полный доступ', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const onSave = vi.fn().mockResolvedValue(undefined)
    const conv = { ...conversation, permissionMode: 'plan' as const }
    render(<ConversationSettings conversation={conv} agents={[agent]} role="admin" settings={settings} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Режим разговора' }), { target: { value: 'bypassPermissions' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

})
