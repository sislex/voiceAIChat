import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import { describe, expect, it, vi } from 'vitest'
import type { AgentInfo } from '@shared/agentProtocol'
import { ConversationSettings } from './ConversationSettings'
import type { ProjectDetail, ProjectSummary } from '@shared/projects'
import type { UserLlmAccess } from '@shared/llmAccess'
import { makeAgent, makeConversation } from '../test/fixtures'

// Машина и беседа — общие фикстуры: раньше беседа собиралась частичным литералом,
// и новое обязательное поле контракта в этом тесте не проявлялось.
const agent: AgentInfo = makeAgent({
  id: 'm1',
  name: 'Рабочая машина',
  createdAt: 1,
  version: '1',
  telemetry: undefined,
  policy: { allowedDirs: [], allowNetwork: true, allowWrite: true, denyPatterns: [], allowPatterns: [], skills: [{ name: 'build', command: 'npm run build' }] }
})
const conversation = makeConversation({ id: 'c1', title: 'Старое имя', messageCount: 0, execTarget: 'm1' })
const settings = { llmProvider: 'claude', model: 'opus[1m]', codexModel: 'gpt-5.6-sol', permissionMode: 'bypassPermissions' } as const

describe('ConversationSettings', () => {
  it('сохраняет название, машину, директорию и выбранные навыки', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const list = vi.fn().mockResolvedValue({ root: '/home/u', cwd: '/home/u/project', entries: [] })
    render(<ConversationSettings conversation={conversation} agents={[agent]} machineOps={{ list } as never} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Старое имя'), { target: { value: 'Новый чат' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /build/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }))
    await screen.findByText('/home/u/project')
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать эту папку' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: 'Новый чат', execTarget: 'm1', workdir: '/home/u/project', skillNames: ['build'], llmProvider: null, llmModel: null, permissionMode: null, kbContextMode: 'auto', projectId: null }))
  })

  it('добавляет новый навык выбранной машине', async () => {
    const onAddSkill = vi.fn().mockResolvedValue(undefined)
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={onAddSkill} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Название'), { target: { value: 'test' } })
    fireEvent.change(screen.getByPlaceholderText('Команда'), { target: { value: 'npm test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(onAddSkill).toHaveBeenCalledWith('m1', { name: 'test', command: 'npm test' }))
  })

  it('сохраняет движок и модель разговора', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Движок разговора' }), { target: { value: 'codex' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Модель разговора' }), { target: { value: 'gpt-5.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ title: 'Старое имя', execTarget: 'm1', workdir: null, skillNames: [], llmProvider: 'codex', llmModel: 'gpt-5.5', permissionMode: null, kbContextMode: 'auto', projectId: null }))
  })

  // Набор моделей задаёт персональный доступ (`llmAccess`), а не роль: запреты —
  // это данные пользователя, и админ правит их в карточке на `#/users/:name`.
  it('запреты доступа убирают opus/fable из выбора модели разговора', () => {
    const denied: UserLlmAccess[] = [{ provider: 'claude', modelId: 'opus[1m]' }, { provider: 'claude', modelId: 'fable' }]
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="user" llmAccess={denied} settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Движок разговора' }), { target: { value: 'claude' } })
    const options = Array.from(screen.getByRole('combobox', { name: 'Модель разговора' }).querySelectorAll('option')).map((o) => o.value)
    expect(options).not.toContain('opus[1m]')
    expect(options).not.toContain('fable')
    expect(options).toEqual(['default', 'sonnet', 'haiku'])
  })

  it('без запретов роль user видит все модели: доступ решает llmAccess, а не роль', () => {
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="user" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Движок разговора' }), { target: { value: 'claude' } })
    const options = Array.from(screen.getByRole('combobox', { name: 'Модель разговора' }).querySelectorAll('option')).map((o) => o.value)
    expect(options).toEqual(['default', 'opus[1m]', 'fable', 'sonnet', 'haiku'])
  })

  it('модели Claude в разговоре — то же меню, что в настройках', () => {
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    const options = Array.from(screen.getByRole('combobox', { name: 'Модель разговора' }).querySelectorAll('option'))
    expect(options.map((o) => o.value)).toEqual(['default', 'opus[1m]', 'fable', 'sonnet', 'haiku'])
    expect(options.map((o) => o.textContent)).toEqual([
      'Default (recommended)', 'Opus (1M context)', 'Fable', 'Sonnet', 'Haiku'
    ])
  })

  it('в списке движков нет пункта «по умолчанию» — только движки, предвыбран глобальный', () => {
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    const engine = screen.getByRole('combobox', { name: 'Движок разговора' }) as HTMLSelectElement
    const options = Array.from(engine.querySelectorAll('option')).map((o) => o.value)
    expect(options).toEqual(['claude', 'codex'])
    expect(engine.value).toBe('claude')
    // Поле модели видно всегда и зависит от движка.
    expect(screen.getByRole('combobox', { name: 'Модель разговора' })).toBeInTheDocument()
  })

  it('сохраняет режим прав разговора и показывает действующий режим', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    // До выбора наследуем общие настройки.
    expect(screen.getByTestId('conv-mode-current')).toHaveTextContent('Сейчас действует: Полный доступ')
    fireEvent.change(screen.getByRole('combobox', { name: 'Режим разговора' }), { target: { value: 'plan' } })
    expect(screen.getByTestId('conv-mode-current')).toHaveTextContent('Сейчас действует: Только планирование')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'plan' })))
  })

  it('роль user без машины видит, что действует только планирование', () => {
    const conv = { ...conversation, execTarget: null }
    render(<ConversationSettings conversation={conv} agents={[agent]} role="user" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByTestId('conv-mode-current')).toHaveTextContent('Только планирование')
    expect(screen.getByTestId('conv-mode-current')).toHaveTextContent('без своей машины')
  })

  it('предвыбирает машину по умолчанию в новом разговоре и помечает её в списке', () => {
    const conv = { ...conversation, execTarget: null, messageCount: 0 }
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ConversationSettings conversation={conv} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} defaultAgentId="m1" onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Рабочая машина — по умолчанию/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    return waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ execTarget: 'm1' })))
  })

  it('просит подтверждение при переходе из плана в полный доступ', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const conv = { ...conversation, permissionMode: 'plan' as const }
    render(<ConversationSettings conversation={conv} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Режим разговора' }), { target: { value: 'bypassPermissions' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    // Предупреждение дословно то же, что было в нативном диалоге.
    const dialog = await screen.findByTestId('confirm-dialog')
    expect(within(dialog).getByText('Перейти из планирования в «Полный доступ»? Агент сможет выполнять команды и изменять любые доступные файлы.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).toBeNull())
    expect(onSave).not.toHaveBeenCalled()
  })


  it('привязка к проекту подставляет машину/папку проекта и сохраняет projectId', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const summary: ProjectSummary = { id: 'p1', name: 'Proj', description: '', gitUrl: null, technologies: [], skills: ['ts'], defaultSkills: { epic: [], story: [], task: [] }, createdBy: 'admin', createdAt: 1, updatedAt: 1, role: 'owner', commitPolicy: 'agent_commits', mergeTransport: 'local', agentPlanApprovalMode: 'manual' }

    const detail: ProjectDetail = { ...summary, members: [], machines: [{ agentId: 'm1', path: '/srv/p', reposRoot: '/srv/repos' }], defaultAgentId: 'm1', productionAgentId: null }
    const fetchProjectDetail = vi.fn().mockResolvedValue(detail)
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[summary]} fetchProjectDetail={fetchProjectDetail} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Проект разговора' }), { target: { value: 'p1' } })
    await waitFor(() => expect(fetchProjectDetail).toHaveBeenCalledWith('p1'))
    await screen.findByText('/srv/p') // рабочая папка подставилась из проекта
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', execTarget: 'm1', workdir: '/srv/p' })))
  })

  it('подписи режимов БЗ соответствуют семантике «инструменты модели», а не «вручную»', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    const select = screen.getByRole('combobox', { name: 'Контекст базы знаний' })
    expect(within(select).getByRole('option', { name: 'Авто-контекст + инструменты модели' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'По запросу модели (только инструменты)' })).toBeInTheDocument()
    // Пояснение под селектом объясняет режим, а не повторяет его название.
    expect(screen.getByTestId('conv-kb-hint')).toHaveTextContent('подмешивает подходящие разделы')
    fireEvent.change(select, { target: { value: 'manual' } })
    expect(screen.getByTestId('conv-kb-hint')).toHaveTextContent('до чтения кода')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kbContextMode: 'manual' })))
  })

})
