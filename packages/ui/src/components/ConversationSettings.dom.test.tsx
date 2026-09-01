import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { BUILTIN_PROJECT_TYPE_IDS, builtinProjectTypeChain } from '@voicechat/shared'
import { render } from '../test/uiRender'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { describe, expect, it, vi } from 'vitest'
import type { AgentInfo } from '@shared/agentProtocol'
import { ConversationSettings } from './ConversationSettings'
import type { ProjectDetail, ProjectSummary } from '@shared/projects'
import type { UserLlmAccess } from '@shared/llmAccess'
import { makeAgent, makeConversation } from '../test/fixtures'
import { contextLockReason, isContextToggleable } from '@shared/contextGating'
import type { ConversationContextSnapshot } from '@shared/types'

/** Снимок без собственных блоков промпта — базовая заготовка для тестов. */
const emptyTurnTotal = { chars: 0, approxTokens: 0, historyChars: 0, historyApproxTokens: 0, resumed: false }
const emptyPreview = { blocks: [], text: '', chars: 0, approxTokens: 0, omitted: ['Правила платформы добавляет CLI движка.'], costUsd: null, turnTotal: emptyTurnTotal, costByModel: [] }

const PREVIEW_TEXT = 'Обращение к пользователю: Тест.'

/**
 * Снимок контекста как его отдаёт сервер: два пункта (неотключаемая
 * безопасность и выключаемая персонализация) и предпросмотр промпта, который
 * пустеет вместе с выключенным пунктом — ровно как на сервере.
 */
function contextSnapshot(options: {
  personalizationEnabled?: boolean
  viewerRole?: 'admin' | 'developer'
  lastTurn?: false
  warnings?: Array<{ itemId: string | null; level: 'notice' | 'problem'; text: string }>
  changes?: Array<{ at: number; actor: string; itemId: string; enabled: boolean; value?: string }>
  turnSizes?: Array<{ at: string; model: string; chars: number; approxTokens: number; resumed: boolean; costUsd: number | null }>
  disallowedTools?: string[]
  cliMcpServers?: Array<{ name: string; detail: string; status: string }>
  owner?: string
  foreign?: boolean
  /** Цена постоянной части: из неё UI выводит экономию за ход. */
  costUsd?: number | null
  /** Итог хода вместе с историей — им проверяется строка сводки. */
  turnTotal?: { chars: number; approxTokens: number; historyChars: number; historyApproxTokens: number; resumed: boolean }
  /** Цена того же объёма на других моделях движка. */
  costByModel?: Array<{ model: string; costUsd: number }>
}): ConversationContextSnapshot {
  const on = options.personalizationEnabled ?? true
  const size = { chars: PREVIEW_TEXT.length, approxTokens: Math.ceil(PREVIEW_TEXT.length / 4) }
  const base = (id: string, title: string) => ({
    id, title, type: 'Контекст', source: 'Настройки пользователя', scope: 'Следующий ход', priority: '1',
    description: `Описание ${title}`, explanation: `Причина ${title}`, configured: true, available: true,
    toggleable: isContextToggleable(id), lockReason: contextLockReason(id)
  })
  return {
    schemaVersion: 1 as const, conversationId: 'c1', generatedAt: new Date(0).toISOString(), freshnessWarning: 'Тестовое предупреждение.',
    summary: { provider: 'claude' as const, model: 'opus', permissionMode: { value: 'plan' as const, displayName: 'Только планирование', explanation: 'Изменение данных отключено.' }, kbMode: { value: 'auto' as const, displayName: 'Автоматически', explanation: 'Документы выбираются по сообщению.' } },
    groups: [{ id: 'instructions', order: 1, title: 'Инструкции', description: '', items: [
      { ...base('platform-instructions', 'Правила платформы'), enabled: true, includedInNextTurn: true },
      { ...base('personalization', 'Предпочтения ответа'), enabled: on, includedInNextTurn: on, size }
    ] }],
    viewerRole: options.viewerRole ?? 'admin',
    owner: options.owner ?? 'admin',
    foreign: options.foreign ?? false,
    lastTurn: options.lastTurn === false ? null : {
      at: '12:41', provider: 'claude' as const, model: 'opus',
      prompt: 'Системный блок\n\nПользователь: почему падает гейт?',
      chars: 48, approxTokens: 12, resumed: true, attachments: 1, attachmentNames: ['схема.png'], kbSections: ['Соглашения']
    },
    turnSizes: options.turnSizes ?? [],
    changes: options.changes ?? [],
    disallowedTools: options.disallowedTools ?? [],
    cliMcpServers: options.cliMcpServers ?? [],
    warnings: options.warnings ?? [],
    promptPreview: on
      ? { blocks: [{ itemIds: ['personalization'], title: 'Персонализация', text: PREVIEW_TEXT, ...size }], text: PREVIEW_TEXT, ...size, omitted: ['Правила платформы и приложения добавляет CLI движка.'], costUsd: options.costUsd ?? null,
          turnTotal: options.turnTotal ?? { chars: PREVIEW_TEXT.length + 400, approxTokens: size.approxTokens + 100, historyChars: 400, historyApproxTokens: 100, resumed: false },
          costByModel: options.costByModel ?? [] }
      : { blocks: [], text: '', chars: 0, approxTokens: 0, omitted: ['Правила платформы и приложения добавляет CLI движка.'], costUsd: null,
          turnTotal: options.turnTotal ?? emptyTurnTotal, costByModel: [] }
  }
}

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

  it('показывает кнопку самодиагностики чата и запускает её', async () => {
    const onRun = vi.fn()
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} chatDiagnostics={{ running: false, onRun }} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    const card = screen.getByLabelText('Самодиагностика чата')
    fireEvent.click(within(card).getByRole('button', { name: 'Самодиагностика' }))
    expect(onRun).toHaveBeenCalledOnce()
  })

  it('показывает кнопку самодиагностики Консоли и запускает её', () => {
    const onRun = vi.fn()
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} consoleReaderDiagnostics={{ running: false, onRun }} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    const card = screen.getByLabelText('Самодиагностика Консоли')
    fireEvent.click(within(card).getByRole('button', { name: 'Самодиагностика' }))
    expect(onRun).toHaveBeenCalledOnce()
  })

  it('показывает кнопку самодиагностики Playwright Reader (и disabled во время прогона)', () => {
    const onRun = vi.fn()
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} playwrightReaderDiagnostics={{ running: true, onRun }} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    const card = screen.getByLabelText('Самодиагностика Playwright Reader')
    expect(within(card).getByRole('button', { name: 'Выполняется…' })).toBeDisabled()
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
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="developer" llmAccess={denied} settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Движок разговора' }), { target: { value: 'claude' } })
    const options = Array.from(screen.getByRole('combobox', { name: 'Модель разговора' }).querySelectorAll('option')).map((o) => o.value)
    expect(options).not.toContain('opus[1m]')
    expect(options).not.toContain('fable')
    expect(options).toEqual(['default', 'sonnet', 'haiku'])
  })

  it('без запретов роль user видит все модели: доступ решает llmAccess, а не роль', () => {
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="developer" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
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
    render(<ConversationSettings conversation={conv} agents={[agent]} role="developer" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByTestId('conv-mode-current')).toHaveTextContent('Только планирование')
    expect(screen.getByTestId('conv-mode-current')).toHaveTextContent('без своей машины')
  })

  it('показывает effective персональную машину, но сохраняет наследование', async () => {
    const conv = { ...conversation, execTarget: null, messageCount: 0 }
    const onSave = vi.fn().mockResolvedValue(undefined)
    const effective = { ...agent, isDefault: true, isEffective: true, effectiveSource: 'personal_default' as const }
    render(<ConversationSettings conversation={conv} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} fetchMachines={vi.fn().mockResolvedValue([effective])} defaultAgentId="m1" onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByRole('option', { name: 'Моя машина по умолчанию: Рабочая машина' })).toBeInTheDocument()
    expect(screen.getByText(/Рабочая машина — моя по умолчанию/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ execTarget: null })))
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


  it('привязка к проекту сохраняет персональное наследование и projectId', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const summary: ProjectSummary = { id: 'p1', name: 'Proj', description: '', typeId: BUILTIN_PROJECT_TYPE_IDS.software, typeChain: builtinProjectTypeChain(), gitUrl: null, technologies: [], skills: ['ts'], defaultSkills: { epic: [], story: [], task: [] }, createdBy: 'admin', createdAt: 1, updatedAt: 1, role: 'owner', commitPolicy: 'agent_commits', mergeTransport: 'local', agentPlanApprovalMode: 'manual' }

    const detail: ProjectDetail = { ...summary, members: [], machines: [{ agentId: 'm1', path: '/srv/p', reposRoot: '/srv/repos' }], defaultAgentId: 'm1' }
    const fetchProjectDetail = vi.fn().mockResolvedValue(detail)
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[summary]} fetchProjectDetail={fetchProjectDetail} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Проект разговора' }), { target: { value: 'p1' } })
    await waitFor(() => expect(fetchProjectDetail).toHaveBeenCalledWith('p1'))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', execTarget: null, workdir: null })))
  })

  it('проектный чат объединяет личные и проектные машины без дублей', async () => {
    const projectAgent = makeAgent({ id: 'p-machine', name: 'Проектная машина' })
    const conv = { ...conversation, projectId: 'p1' }
    const fetchMachines = vi.fn().mockResolvedValue([agent, agent, projectAgent])
    render(<ConversationSettings conversation={conv} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} fetchMachines={fetchMachines} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)

    const select = await screen.findByRole('combobox', { name: 'Машина разговора' })
    await waitFor(() => expect(select.querySelectorAll('option[value="m1"]')).toHaveLength(1))
    expect(select.querySelector('option[value="p-machine"]')).toHaveTextContent('Проектная машина')
    expect(fetchMachines).toHaveBeenCalledWith('c1', 'p1')
  })

  it('сбрасывает ранее выбранную недоступную машину и сообщает о потере доступа', async () => {
    const unavailable = makeAgent({ id: 'gone', name: 'Бывшая машина' })
    const conv = { ...conversation, execTarget: unavailable.id }
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ConversationSettings conversation={conv} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} fetchMachines={vi.fn().mockResolvedValue([agent])} onSave={onSave} onAddSkill={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByRole('status')).toHaveTextContent('больше недоступна')
    expect(screen.getByRole('combobox', { name: 'Машина разговора' })).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ execTarget: null })))
  })

  it('открывает использование БЗ из вкладки «Общее» без сохранения настроек', () => {
    const onOpenKbUsage = vi.fn()
    const onSave = vi.fn()
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={onSave} onAddSkill={vi.fn()} onOpenKbUsage={onOpenKbUsage} onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Общее' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Использование базы знаний' }))
    expect(onOpenKbUsage).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
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

  it('показывает понятную сводку, источники и пять пользовательских статусов', async () => {
    const item = (id: string, title: string, configured: boolean, available: boolean, includedInNextTurn: boolean, source = 'Настройки пользователя') => ({
      id, title, type: 'Контекст', source, scope: 'Следующий ход', priority: '1', description: `Описание ${title}`, explanation: `Причина ${title}`, configured, available, includedInNextTurn,
      toggleable: isContextToggleable(id), enabled: true, lockReason: contextLockReason(id)
    })
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null), 'conversations:contextSnapshot': vi.fn().mockResolvedValue({
      schemaVersion: 1 as const, conversationId: 'c1', generatedAt: new Date(0).toISOString(), freshnessWarning: 'Штатное пояснение актуальности.',
      summary: { provider: 'claude' as const, model: 'opus', permissionMode: { value: 'plan' as const, displayName: 'Только чтение', explanation: 'Тест' }, kbMode: { value: 'auto' as const, displayName: 'Автоматически', explanation: 'Тест' } },
      groups: [
        { id: 'conversation', order: 1, title: 'Настройки', description: '', items: [
          item('llm', 'Модель', true, true, true, 'Разговор'), item('machine', 'Машина', true, true, true, 'Проект'),
          { ...item('working-directory', 'Рабочая папка', true, true, true, 'Проект'), scope: '/very/long/project/path' },
          item('permission-mode', 'Режим', true, true, true, 'Настройки пользователя')
        ] },
        { id: 'knowledge', order: 2, title: 'Знания', description: '', items: [
          item('platform-instructions', 'Правила', true, true, true),
          item('personalization', 'Персональные инструкции', false, true, false),
          item('project-binding', 'Проект', true, false, false),
          item('conversation-history', 'История', true, true, false),
          item('knowledge-mode', 'База знаний', true, true, true),
          item('current-message', 'Текущее сообщение', false, false, false)
        ] },
        { id: 'skills', order: 3, title: 'Навыки', description: '', items: [item('skill-review', 'Review', true, true, false)] }
      ],
      viewerRole: 'admin' as const,
      owner: 'admin',
      foreign: false,
      lastTurn: null,
      turnSizes: [],
      changes: [],
      disallowedTools: [],
      cliMcpServers: [],
      warnings: [],
      promptPreview: emptyPreview
    }) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    expect(await screen.findByRole('heading', { name: 'Что получит ИИ в следующем сообщении' })).toBeInTheDocument()
    const launch = screen.getByRole('heading', { name: 'Как будет запущен ответ' }).closest('section')
    expect(launch).toHaveTextContent('claude')
    expect(launch).toHaveTextContent('opus')
    expect(launch).toHaveTextContent('Настройки проекта')
    expect(launch).toHaveTextContent('Переопределение чата')
    expect(launch).toHaveTextContent('Общие настройки')
    const knowledge = screen.getByRole('heading', { name: 'Что ИИ будет знать' }).closest('section')
    for (const status of ['Будет использовано', 'Доступно при необходимости', 'Не настроено', 'Недоступно', 'Определится после отправки']) expect(knowledge).toHaveTextContent(status)
    expect(knowledge).toHaveTextContent('Почему:')
    const extra = screen.getByText('Дополнительные возможности').closest('details')
    const technical = screen.getByText('Технические сведения').closest('details')
    expect(extra).not.toHaveAttribute('open')
    expect(technical).not.toHaveAttribute('open')
    expect(screen.queryByText('Машина недоступна')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Технические сведения'))
    expect(screen.getByText('Штатное пояснение актуальности.')).toBeInTheDocument()
    expect(screen.getAllByText(/configured:/).length).toBeGreaterThan(0)
  })

  it('показывает действие только для настроенной недоступной машины', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null), 'conversations:contextSnapshot': vi.fn().mockResolvedValue({
      schemaVersion: 1 as const, conversationId: 'c1', generatedAt: new Date(0).toISOString(), freshnessWarning: 'Не ошибка.',
      summary: { provider: 'codex' as const, model: '', permissionMode: { value: 'plan' as const, displayName: 'Только планирование', explanation: 'Тест' }, kbMode: { value: 'off' as const, displayName: 'Отключено', explanation: 'Тест' } },
      groups: [{ id: 'conversation', order: 1, title: 'Настройки', description: '', items: [{ id: 'machine', title: 'Машина', type: 'Настройка', source: 'Разговор', scope: 'offline', priority: '1', description: '10e', explanation: 'Машина отключена от сети.', configured: true, available: false, includedInNextTurn: false, toggleable: false, enabled: true, lockReason: 'info' as const }] }],
      viewerRole: 'admin' as const,
      owner: 'admin',
      foreign: false,
      lastTurn: null,
      turnSizes: [],
      changes: [],
      disallowedTools: [],
      cliMcpServers: [],
      warnings: [],
      promptPreview: emptyPreview
    }) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    expect((await screen.findByText('Машина недоступна')).closest('aside')).toHaveTextContent('Машина отключена от сети.')
    expect(screen.getByText('Модель из конфигурации CLI')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Перейти к настройкам разговора' }))
    expect(screen.getByRole('tab', { name: 'Общее' })).toHaveAttribute('aria-selected', 'true')
  })

  it('показывает контролируемое состояние неизвестной карточки и сохраняет канонический URL', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null), 'conversations:contextSnapshot': vi.fn().mockResolvedValue({ schemaVersion: 1 as const, conversationId: 'c1', generatedAt: new Date(0).toISOString(), freshnessWarning: 'Тестовое предупреждение.', summary: { provider: 'claude' as const, model: 'default', permissionMode: { value: 'plan' as const, displayName: 'Только планирование', explanation: 'Тест' }, kbMode: { value: 'auto' as const, displayName: 'Автоматически', explanation: 'Тест' } }, groups: [], viewerRole: 'admin' as const, owner: 'admin', foreign: false, lastTurn: null, turnSizes: [], changes: [], disallowedTools: [], cliMcpServers: [], warnings: [], promptPreview: emptyPreview }) } as never
    window.location.hash = '#/chat/c1/context/disappeared'
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Контекст и инструкции' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('heading', { name: 'Источник не найден' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/chat/c1/context/disappeared')
    fireEvent.click(screen.getByRole('button', { name: '← Ко всем источникам' }))
    expect(window.location.hash).toBe('#/chat/c1')
  })

  it('тумблер выключает пункт контекста, безопасность показывает замок с причиной', async () => {
    const setContextItem = vi.fn().mockImplementation(async ({ itemId, enabled }: { itemId: string; enabled: boolean }) => ({
      ...contextSnapshot({ personalizationEnabled: itemId === 'personalization' ? enabled : true }),
      conversationId: 'c1'
    }))
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})), 'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const toggle = await screen.findByRole('checkbox', { name: 'Учитывать «Предпочтения ответа» в этом разговоре' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'personalization', enabled: false }))
    // Снимок из ответа сервера заменяет прежний: статус и предпросмотр обновились одним ответом.
    const knowledge = screen.getByRole('heading', { name: 'Что ИИ будет знать' }).closest('section')!
    await waitFor(() => expect(within(knowledge).getByText('Выключено вами')).toBeInTheDocument())
    expect(screen.getByTestId('context-prompt-size')).toHaveTextContent('0 блок(ов)')

    // Правила платформы выключить нельзя — замок объясняет это словами.
    expect(screen.queryByRole('checkbox', { name: /Правила платформы/ })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Правила безопасности платформы/ })).toBeInTheDocument()

    // Список меняется на месте, окна не открывается — читалке нужно объявление.
    expect(screen.getByTestId('context-announce')).toHaveTextContent('Предпочтения ответа: выключено')
    expect(screen.getByTestId('context-announce')).toHaveTextContent('Блоков промпта: 0')
  })

  it('показывает итоговый текст промпта, его размер и чего в нём нет', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    expect(await screen.findByTestId('context-prompt-preview')).toHaveTextContent('Обращение к пользователю: Тест.')
    expect(screen.getByTestId('context-prompt-size')).toHaveTextContent('1 блок(ов)')
    expect(screen.getByTestId('context-prompt-size')).toHaveTextContent('≈8 токенов')
    // Вклад пункта виден и в списке: понятно, кто занимает место в промпте.
    expect(screen.getByRole('heading', { name: 'Что ИИ будет знать' }).closest('section')).toHaveTextContent('≈8 токенов · 31 символов')
    const omitted = screen.getByText('Чего в этом тексте нет').closest('details')!
    fireEvent.click(screen.getByText('Чего в этом тексте нет'))
    expect(within(omitted).getByText(/добавляет CLI движка/)).toBeInTheDocument()
  })

  it('поиск и фильтр сужают список, «Не попадёт» собирает исключённое с причиной', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({ personalizationEnabled: false })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    const knowledge = (await screen.findByRole('heading', { name: 'Что ИИ будет знать' })).closest('section')!

    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по источникам контекста' }), { target: { value: 'платформы' } })
    expect(knowledge).toHaveTextContent('Правила платформы')
    expect(knowledge).not.toHaveTextContent('Предпочтения ответа')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по источникам контекста' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Не попадёт' }))
    expect(knowledge).not.toHaveTextContent('Правила платформы')
    expect(knowledge).toHaveTextContent('Предпочтения ответа')

    const excluded = screen.getByTestId('context-excluded')
    expect(excluded).toHaveTextContent('Не попадёт в следующий ход')
    expect(within(excluded).getByText(/Вы выключили источник/)).toBeInTheDocument()
  })

  it('быстрая правка режима БЗ применяется сразу; режим доступа правит только админ', async () => {
    const setExecTarget = vi.fn().mockResolvedValue({ ...conversation, kbContextMode: 'off' })
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({ viewerRole: 'developer' })), 'conversations:setExecTarget': setExecTarget } as never
    const { unmount } = render(<ConversationSettings conversation={conversation} agents={[agent]} role="developer" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    expect(await screen.findByTestId('context-role-hint')).toHaveTextContent('не связано с безопасностью')
    // Режим доступа — безопасность: обычный пользователь его только видит.
    expect(screen.getByTestId('context-permission-readonly')).toHaveTextContent('Только планирование')
    expect(screen.queryByRole('combobox', { name: 'Режим доступа' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'База знаний' }), { target: { value: 'off' } })
    await waitFor(() => expect(setExecTarget).toHaveBeenCalledWith({ id: 'c1', execTarget: conversation.execTarget ?? null, kbContextMode: 'off' }))
    unmount()

    window.api = { ...window.api, 'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({ viewerRole: 'admin' })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    expect(await screen.findByTestId('context-role-hint')).toHaveTextContent('Вы администратор')
    expect(screen.getByRole('combobox', { name: 'Режим доступа' })).toBeInTheDocument()
  })

  it('подбор базы знаний считается по черновику, а не гадается снимком', async () => {
    const kbPreview = vi.fn().mockImplementation(async ({ draft }: { draft: string }) => draft.includes('сборк')
      ? { mode: 'auto' as const, text: '\n\n## База знаний\n### Сборка\nГейт запускается npm run gate.', chars: 60, approxTokens: 15, confidence: 'high' as const, sections: [{ documentId: 'conventions', title: 'Соглашения', anchor: 'гейт', chars: 60 }], emptyReason: null }
      : { mode: 'auto' as const, text: '', chars: 0, approxTokens: 0, confidence: null, sections: [], emptyReason: 'no-match' })
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})), 'conversations:contextKbPreview': kbPreview } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    const area = await screen.findByRole('textbox', { name: /Черновик сообщения/ })

    // Пустой черновик считать нечего — кнопка выключена.
    expect(screen.getByRole('button', { name: 'Показать подбор' })).toBeDisabled()
    fireEvent.change(area, { target: { value: 'Как запускается сборка?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Показать подбор' }))
    await waitFor(() => expect(kbPreview).toHaveBeenCalledWith({ id: 'c1', draft: 'Как запускается сборка?' }))
    const result = await screen.findByTestId('context-kb-result')
    expect(result).toHaveTextContent('Соглашения')
    expect(result).toHaveTextContent('≈15 токенов')
    expect(result).toHaveTextContent('Гейт запускается npm run gate.')

    // Нет совпадений — прямо об этом, а не пустое место.
    fireEvent.change(area, { target: { value: 'погода на выходных' } })
    fireEvent.click(screen.getByRole('button', { name: 'Показать подбор' }))
    expect(await screen.findByTestId('context-kb-empty')).toHaveTextContent('подходящих разделов не нашлось')

    // «Нашлось, но уверенность низкая» — другой ответ, чем «ничего не нашлось»:
    // документы есть, просто автоматически они не вставятся.
    kbPreview.mockResolvedValueOnce({ mode: 'auto' as const, text: '', chars: 0, approxTokens: 0, confidence: 'medium' as const, sections: [], emptyReason: 'low-confidence' })
    fireEvent.change(area, { target: { value: 'что-то расплывчатое' } })
    fireEvent.click(screen.getByRole('button', { name: 'Показать подбор' }))
    await waitFor(() => expect(screen.getByTestId('context-kb-empty')).toHaveTextContent('уверенность подбора низкая'))
  })

  it('массовые действия выключают всё необязательное и включают обратно', async () => {
    const off = new Set<string>()
    const setContextItem = vi.fn().mockImplementation(async ({ itemId, enabled }: { itemId: string; enabled: boolean }) => {
      if (enabled) off.delete(itemId)
      else off.add(itemId)
      return contextSnapshot({ personalizationEnabled: !off.has('personalization') })
    })
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})), 'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    // Пункт с замком в массовое действие не попадает: его и нельзя выключить.
    fireEvent.click(await screen.findByRole('button', { name: 'Выключить необязательное (1)' }))
    await waitFor(() => expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'personalization', enabled: false }))
    expect(setContextItem).not.toHaveBeenCalledWith(expect.objectContaining({ itemId: 'platform-instructions' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Включить всё (1)' }))
    await waitFor(() => expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'personalization', enabled: true }))
  })

  it('AGENTS.md читается только по просьбе и показывает цепочку от общей к конкретной', async () => {
    const agentsChain = vi.fn().mockResolvedValue({
      machineName: 'MacBook',
      workdir: '/Users/me/work/project',
      files: [
        { path: '/Users/me/AGENTS.md', text: '# Общие правила', chars: 15 },
        { path: '/Users/me/work/project/AGENTS.md', text: '# Правила проекта', chars: 17 }
      ]
    })
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})), 'conversations:agentsChain': agentsChain } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    // Само по себе чтение не запускается: файл лежит на чужой машине.
    expect(await screen.findByRole('heading', { name: 'Цепочка AGENTS.md' })).toBeInTheDocument()
    expect(agentsChain).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Прочитать с машины' }))
    await waitFor(() => expect(agentsChain).toHaveBeenCalledWith({ id: 'c1' }))
    const result = await screen.findByTestId('context-agents-result')
    expect(result).toHaveTextContent('MacBook')
    const paths = within(result).getAllByText(/AGENTS\.md/).map((node) => node.textContent ?? '')
    expect(paths[0]).toContain('/Users/me/AGENTS.md')
    expect(paths[1]).toContain('/Users/me/work/project/AGENTS.md')
  })

  it('без машины цепочка AGENTS.md объясняет причину, а не молчит', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})),
      'conversations:agentsChain': vi.fn().mockResolvedValue({ machineName: null, workdir: '/srv/app', files: [], unavailable: 'Машина недоступна: прочитать файлы её директории нельзя.' }) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Прочитать с машины' }))
    expect(await screen.findByTestId('context-agents-unavailable')).toHaveTextContent('Машина недоступна')
  })

  it('показывает факт прошлого хода: что действительно ушло модели', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    const meta = await screen.findByTestId('context-lastturn-meta')
    expect(meta).toHaveTextContent('≈12 токенов')
    expect(meta).toHaveTextContent('продолжение сессии движка')
    expect(meta).toHaveTextContent('вложения: схема.png')
    expect(meta).toHaveTextContent('Соглашения')
    // Текст под раскрытием: это факт, а не прогноз, и он бывает большим.
    fireEvent.click(screen.getByText('Показать отправленный текст'))
    expect(screen.getByTestId('context-lastturn-prompt')).toHaveTextContent('почему падает гейт')
  })

  it('без прошлого хода карточки факта нет, а предупреждения сервера видны и ведут к источнику', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        lastTurn: false,
        warnings: [
          { itemId: 'personalization', level: 'problem', text: 'Персонализация выключена, хотя предпочтения заданы.' },
          { itemId: null, level: 'notice', text: 'Инструкций чата выключено для этого разговора: 1.' }
        ]
      })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const warnings = await screen.findByTestId('context-warnings')
    expect(warnings).toHaveTextContent('Персонализация выключена')
    expect(warnings).toHaveTextContent('Инструкций чата выключено')
    expect(screen.queryByTestId('context-lastturn-meta')).not.toBeInTheDocument()

    // Предупреждение с источником ведёт прямо в его карточку.
    fireEvent.click(within(warnings).getByRole('button', { name: 'Открыть источник' }))
    expect(await screen.findByRole('heading', { name: 'Предпочтения ответа' })).toBeInTheDocument()
  })

  it('шапка отвечает «сколько уйдёт» без прокрутки, а факт хода сравнивается с прогнозом', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    const summary = await screen.findByTestId('context-summary')
    expect(summary).toHaveTextContent('≈8 токенов в 1 блок(ах)')
    expect(summary).toHaveTextContent('в прошлый ход ушло ≈12')
    expect(summary).toHaveTextContent('Выключено источников: 0 из 1')
    // Блок прогноза, которого нет в отправленном тексте, назван прямо.
    expect(screen.getByTestId('context-lastturn-diff')).toHaveTextContent('добавились блоки: Персонализация')
  })

  it('журнал изменений контекста показывает, кто и когда выключил источник', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        changes: [
          { at: new Date('2026-08-31T12:36:00Z').getTime(), actor: 'admin', itemId: 'personalization', enabled: true },
          { at: new Date('2026-08-31T12:35:00Z').getTime(), actor: 'marina', itemId: 'personalization', enabled: false }
        ]
      })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    const log = await screen.findByTestId('context-changes')
    expect(log).toHaveTextContent('Журнал изменений контекста')
    fireEvent.click(within(log).getByText('Журнал изменений контекста'))
    // Имя источника, а не id: журнал читают люди.
    const entries = within(log).getAllByRole('listitem').map((node) => node.textContent ?? '')
    expect(entries.some((text) => text.includes('admin · вернул:') && text.includes('Предпочтения ответа'))).toBe(true)
    expect(entries.some((text) => text.includes('marina · выключил:') && text.includes('Предпочтения ответа'))).toBe(true)
  })

  it('текст инструкции правится из инспектора и предупреждает, что настройка общая', async () => {
    const onSaveInstruction = vi.fn().mockResolvedValue(undefined)
    const instructions = [{ id: 'own', title: 'Своя инструкция', description: '', enabled: true, text: 'Отвечай по-русски.' }]
    const snapshotWithInstruction = () => {
      const base = contextSnapshot({})
      base.groups.push({ id: 'chat-instructions', order: 3, title: 'Инструкции чата', description: '', items: [
        // Пункт-инструкция собран литералом: у фабрики снимка своих инструкций нет.

        { id: 'instruction-own', title: 'Своя инструкция', type: 'Своя инструкция', source: 'Настройки пользователя', scope: 'Каждый ход', priority: '3',
          description: 'Текст пользователя.', explanation: 'Включена в настройках.', configured: true, available: true, includedInNextTurn: true,
          toggleable: true, enabled: true, lockReason: null, details: { 'Текст': 'Отвечай по-русски.' } }
      ] })
      return base
    }
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(snapshotWithInstruction()) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} chatInstructions={instructions} onSaveInstruction={onSaveInstruction} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    // Заголовок пункта встречается в нескольких списках — берём первую кнопку
    // «провалиться» с этим названием: все они ведут в одну карточку.
    const openItem = (await screen.findAllByRole('button', { name: /Своя инструкция/ }))[0]!
    fireEvent.click(openItem)
    const area = await screen.findByRole('textbox', { name: 'Текст инструкции' })
    expect(area).toHaveValue('Отвечай по-русски.')
    expect(screen.getByText(/подействует во всех ваших разговорах/)).toBeInTheDocument()

    // Пока текст не изменён — сохранять нечего.
    expect(screen.getByRole('button', { name: 'Сохранить текст' })).toBeDisabled()
    fireEvent.change(area, { target: { value: 'Отвечай кратко и по-русски.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить текст' }))
    await waitFor(() => expect(onSaveInstruction).toHaveBeenCalledWith('own', 'Отвечай кратко и по-русски.'))
  })

  it('копирует контекст из другого разговора и сбрасывает его одним действием', async () => {
    const copyContext = vi.fn().mockResolvedValue(contextSnapshot({ personalizationEnabled: false }))
    const setContextItem = vi.fn().mockResolvedValue(contextSnapshot({}))
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({ personalizationEnabled: false })),
      'conversations:copyContext': copyContext, 'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      otherConversations={[{ id: 'c2', title: 'Рабочий чат' }, { id: 'c3', title: 'Черновики' }]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    fireEvent.change(await screen.findByRole('combobox', { name: 'Скопировать контекст из разговора' }), { target: { value: 'c3' } })
    // Копирование перезаписывает набор целиком, поэтому спрашивает подтверждение.
    const dialog = await screen.findByRole('dialog', { name: 'Скопировать контекст?' })
    expect(dialog).toHaveTextContent('станет таким же, как в «Черновики»')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Скопировать' }))
    await waitFor(() => expect(copyContext).toHaveBeenCalledWith({ id: 'c1', fromConversationId: 'c3' }))
    expect(screen.getByTestId('context-announce')).toHaveTextContent('Контекст скопирован')

    // Сброс возвращает выключенное одним действием, а не по одному тумблеру.
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить контекст к обычному' }))
    await waitFor(() => expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'personalization', enabled: true }))
  })

  it('фильтр «Изменённые» берёт пункты из журнала, а «Сначала тяжёлые» меняет порядок', async () => {
    // В журнале только персонализация: фильтр обязан показать её одну.
    const snapshot = contextSnapshot({ changes: [{ at: 1, actor: 'admin', itemId: 'personalization', enabled: false }] })
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(snapshot) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    const section = (await screen.findByRole('heading', { name: 'Что ИИ будет знать' })).closest('section')!
    const openTitles = (): string[] => within(section).getAllByRole('button')
      .map((node) => node.textContent ?? '').filter((text) => text.includes('Почему:'))

    fireEvent.click(screen.getByRole('button', { name: 'Изменённые' }))
    expect(section).toHaveTextContent('Предпочтения ответа')
    expect(section).not.toHaveTextContent('Правила платформы')

    // Обычный порядок — как собрал сервер: правила платформы идут первыми.
    fireEvent.click(screen.getByRole('button', { name: 'Все' }))
    expect(openTitles()[0]).toContain('Правила платформы')

    // По размеру наверх поднимается единственный пункт с вкладом в промпт.
    fireEvent.click(screen.getByRole('button', { name: 'Сначала тяжёлые' }))
    expect(openTitles()[0]).toContain('Предпочтения ответа')
  })
  it('пресеты контекста: применение приводит набор к сохранённому, сохранение просит имя полем', async () => {
    const setContextItem = vi.fn().mockResolvedValue(contextSnapshot({ personalizationEnabled: false }))
    const onSavePresets = vi.fn().mockResolvedValue(undefined)
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})), 'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      contextPresets={[{ id: 'p1', name: 'Минимальный', disabled: ['personalization'] }]} onSavePresets={onSavePresets}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    fireEvent.change(await screen.findByRole('combobox', { name: 'Применить пресет контекста' }), { target: { value: 'p1' } })
    // Пресет применяется подтверждением предпросмотра, а не выбором в списке.
    fireEvent.click(within(await screen.findByTestId('context-preset-preview')).getByRole('button', { name: 'Применить пресет' }))
    await waitFor(() => expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'personalization', enabled: false }))
    expect(screen.getByTestId('context-announce')).toHaveTextContent('Пресет «Минимальный» применён')

    // Имя пресета вводится полем: window.prompt в проекте запрещён.
    expect(screen.getByRole('button', { name: 'Сохранить текущий' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Имя нового пресета контекста' }), { target: { value: 'Без БЗ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить текущий' }))
    await waitFor(() => expect(onSavePresets).toHaveBeenCalledWith([
      { id: 'p1', name: 'Минимальный', disabled: ['personalization'] },
      expect.objectContaining({ name: 'Без БЗ' })
    ]))
  })

  it('вложения черновика видны в предпросмотре, админ может смотреть как обычный пользователь', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      draftAttachments={[{ name: 'схема.png', status: 'ready' }, { name: 'лог.txt', status: 'processing' }]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    // Файлы приложены к неотправленному сообщению — серверный снимок их не знает.
    const draft = await screen.findByTestId('context-draft-attachments')
    expect(draft).toHaveTextContent('схема.png')
    expect(draft).toHaveTextContent('лог.txt (processing)')

    // Проверка политики глазами: админ переключается в вид обычного пользователя.
    expect(screen.getByRole('combobox', { name: 'Режим доступа' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Смотреть как обычный пользователь' }))
    expect(screen.getByTestId('context-role-hint')).toHaveTextContent('не связано с безопасностью')
    expect(screen.queryByRole('combobox', { name: 'Режим доступа' })).not.toBeInTheDocument()
    expect(screen.getByTestId('context-permission-readonly')).toBeInTheDocument()
  })

  it('пресеты можно удалить и импортировать файлом, импорт добавляет к существующим', async () => {
    const onSavePresets = vi.fn().mockResolvedValue(undefined)
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      contextPresets={[{ id: 'p1', name: 'Минимальный', disabled: ['personalization'] }]} onSavePresets={onSavePresets}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const list = await screen.findByTestId('context-presets')
    fireEvent.click(within(list).getByText('Пресеты контекста'))
    expect(within(list).getByText(/выключено источников: 1/)).toBeInTheDocument()

    // Удаление спрашивает подтверждение: список пресетов — данные человека.
    fireEvent.click(within(list).getByRole('button', { name: 'Удалить' }))
    const dialog = await screen.findByRole('dialog', { name: 'Удалить пресет?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(onSavePresets).toHaveBeenCalledWith([]))

    // Импорт добавляет к существующим, а не затирает чужую работу.
    const file = new File([JSON.stringify([{ name: 'Из файла', disabled: ['knowledge-mode'] }])], 'presets.json', { type: 'application/json' })
    const input = screen.getByLabelText('Импортировать пресеты контекста из файла')
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(onSavePresets).toHaveBeenCalledWith([
      { id: 'p1', name: 'Минимальный', disabled: ['personalization'] },
      expect.objectContaining({ name: 'Из файла', disabled: ['knowledge-mode'] })
    ]))
  })

  it('своя инструкция добавляется из инспектора, размер видно сразу', async () => {
    const onAddInstruction = vi.fn().mockResolvedValue(undefined)
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      chatInstructions={[]} onSaveInstruction={vi.fn()} onAddInstruction={onAddInstruction}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const add = await screen.findByRole('button', { name: 'Добавить инструкцию' })
    expect(add).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Название новой инструкции' }), { target: { value: 'Только факты' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст новой инструкции' }), { target: { value: 'Без вступлений.' } })
    // Размер постоянной подсказки видно до сохранения: она уходит каждым ходом.
    expect(screen.getByText(/15 символов, ≈4 токенов в каждом ходе/)).toBeInTheDocument()
    fireEvent.click(add)
    await waitFor(() => expect(onAddInstruction).toHaveBeenCalledWith('Только факты', 'Без вступлений.'))
  })

  it('границы блоков в предпросмотре включаются переключателем', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const preview = await screen.findByTestId('context-prompt-preview')
    expect(preview).not.toHaveTextContent('1. Персонализация')
    fireEvent.click(screen.getByRole('button', { name: 'Показать границы блоков' }))
    expect(screen.getByTestId('context-prompt-preview')).toHaveTextContent('1. Персонализация')
  })

  it('сравнение с другим разговором показывает отличия и ничего не меняет', async () => {
    const contextDiff = vi.fn().mockResolvedValue({
      otherId: 'c2', otherTitle: 'Рабочий чат',
      onlyHere: [{ itemId: 'personalization', title: 'Предпочтения ответа' }],
      onlyThere: [{ itemId: 'knowledge-mode', title: 'Автоматически' }],
      settings: [{ label: 'Модель', here: 'opus', there: 'sonnet' }]
    })
    const setContextItem = vi.fn()
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})), 'conversations:contextDiff': contextDiff, 'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      otherConversations={[{ id: 'c2', title: 'Рабочий чат' }]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    fireEvent.change(await screen.findByRole('combobox', { name: 'Сравнить контекст с разговором' }), { target: { value: 'c2' } })
    const card = await screen.findByTestId('context-diff')
    expect(card).toHaveTextContent('Отличия от «Рабочий чат»')
    expect(card).toHaveTextContent('здесь «opus», там «sonnet»')
    expect(card).toHaveTextContent('Выключено только здесь: Предпочтения ответа')
    expect(card).toHaveTextContent('Выключено только там: Автоматически')
    // Фраза не должна разрываться на узлы: иначе перед двоеточием пробел.
    expect(within(card).getByText('Выключено только здесь:')).toBeInTheDocument()
    // Сравнение ничего не меняет: тумблеры сервер не трогали.
    expect(setContextItem).not.toHaveBeenCalled()

    fireEvent.click(within(card).getByRole('button', { name: 'Закрыть сравнение' }))
    expect(screen.queryByTestId('context-diff')).not.toBeInTheDocument()
  })

  it('пресет переименовывается на месте, выключенные инструменты названы прямо', async () => {
    const onSavePresets = vi.fn().mockResolvedValue(undefined)
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({ disallowedTools: ['mcp__remote__bash', 'mcp__kb__search'] })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      contextPresets={[{ id: 'p1', name: 'Минимальный', disabled: ['personalization'] }]} onSavePresets={onSavePresets}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    // Ответ на «почему модель не читает файлы» — списком, а не поиском по пунктам.
    expect(await screen.findByTestId('context-disallowed')).toHaveTextContent('mcp__remote__bash, mcp__kb__search')

    const presets = screen.getByTestId('context-presets')
    fireEvent.click(within(presets).getByText('Пресеты контекста'))
    fireEvent.click(within(presets).getByRole('button', { name: 'Переименовать' }))
    const field = within(presets).getByRole('textbox', { name: 'Новое название пресета «Минимальный»' })
    fireEvent.change(field, { target: { value: 'Только безопасность' } })
    fireEvent.click(within(presets).getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSavePresets).toHaveBeenCalledWith([{ id: 'p1', name: 'Только безопасность', disabled: ['personalization'] }]))
  })

  it('Esc в поиске очищает строку, а не закрывает окно настроек', async () => {
    const onClose = vi.fn()
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const search = await screen.findByRole('searchbox', { name: 'Поиск по источникам контекста' })
    fireEvent.change(search, { target: { value: 'платформ' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search).toHaveValue('')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('пресет применяется к выбранным разговорам и подтверждает список', async () => {
    const setContextItem = vi.fn().mockResolvedValue(contextSnapshot({ personalizationEnabled: false }))
    const onCopyContextTo = vi.fn().mockResolvedValue(undefined)
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})), 'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      contextPresets={[{ id: 'p1', name: 'Минимальный', disabled: ['personalization'] }]} onSavePresets={vi.fn()}
      otherConversations={[{ id: 'c2', title: 'Рабочий чат' }, { id: 'c3', title: 'Черновики' }]}
      onCopyContextTo={onCopyContextTo}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const presets = await screen.findByTestId('context-presets')
    fireEvent.click(within(presets).getByText('Пресеты контекста'))
    // Пока чаты не отмечены, «к выбранным» нечего делать.
    expect(within(presets).getByRole('button', { name: 'Применить к выбранным (0)' })).toBeDisabled()

    fireEvent.click(within(presets).getByRole('checkbox', { name: 'Применять к разговору «Черновики»' }))
    fireEvent.click(within(presets).getByRole('button', { name: 'Применить к выбранным (1)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Применить пресет к выбранным?' })
    expect(dialog).toHaveTextContent('Черновики')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }))

    // Сначала текущий чат приводится к пресету, потом его набор копируется дальше.
    await waitFor(() => expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'personalization', enabled: false }))
    await waitFor(() => expect(onCopyContextTo).toHaveBeenCalledWith('c3', 'c1'))
    expect(onCopyContextTo).toHaveBeenCalledTimes(1)
  })

  it('из карточки инструкции можно уйти в общие настройки', async () => {
    const onOpenInstructionSettings = vi.fn()
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      chatInstructions={[]} onSaveInstruction={vi.fn()} onAddInstruction={vi.fn()} onOpenInstructionSettings={onOpenInstructionSettings}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть общие настройки инструкций' }))
    expect(onOpenInstructionSettings).toHaveBeenCalledOnce()
  })

  it('фильтр по группе сужает список, MCP движка и статус «выключено в настройках» видны', async () => {
    const snapshot = contextSnapshot({ cliMcpServers: [{ name: 'remote', detail: 'ws://agent', status: 'connected' }] })
    // Инструкция, выключенная в общих настройках: configured=false, но она есть.
    snapshot.groups.push({
      id: 'chat-instructions', order: 3, title: 'Инструкции чата', description: '', items: [{
        id: 'instruction-off', title: 'Выключенная всюду', type: 'Своя инструкция', source: 'Настройки пользователя',
        scope: 'Каждый ход', priority: '3', description: 'Текст пользователя.', explanation: 'Выключена в настройках.',
        configured: false, available: true, includedInNextTurn: false, toggleable: true, enabled: true, lockReason: null
      }]
    })
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(snapshot) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    // «Выключено в настройках» ≠ «Не настроено»: инструкция есть, но отключена везде.
    // «Инструкции чата» встречается и в свёртке, и в фильтре групп — берём свёртку.
    const instructions = (await screen.findByTestId('context-instructions-section'))
    expect(within(instructions).getByText('Выключено в настройках')).toBeInTheDocument()

    // Фильтр по группе: выбрали «Инструкции чата» — в списке знаний (его пункты
    // из другой группы) не осталось ничего.
    const knowledge = screen.getByRole('heading', { name: 'Что ИИ будет знать' }).closest('section')!
    expect(knowledge).toHaveTextContent('Правила платформы')
    fireEvent.change(screen.getByRole('combobox', { name: 'Фильтр по группе источников' }), { target: { value: 'chat-instructions' } })
    expect(knowledge).not.toHaveTextContent('Правила платформы')
    expect(knowledge).toHaveTextContent('Под фильтр и поиск ничего не подошло')
    // Сама группа инструкций при этом на месте.
    expect(within(instructions).getByText('Выключенная всюду')).toBeInTheDocument()

    // MCP-серверы движка — в технических сведениях: это то, что видит CLI.
    fireEvent.click(screen.getByText('Технические сведения'))
    expect(screen.getByTestId('context-cli-mcp')).toHaveTextContent('remote — connected')
  })

  it('чужой разговор помечен, инструменты машины выключаются вместе', async () => {
    const setContextItem = vi.fn().mockResolvedValue(contextSnapshot({ owner: 'marina', foreign: true }))
    const snapshot = contextSnapshot({ owner: 'marina', foreign: true })
    // Добавляем два включённых инструмента машины: их выключают одной кнопкой.
    snapshot.groups.push({
      id: 'capabilities', order: 4, title: 'MCP, приложения и плагины', description: '', items: (['bash', 'read'] as const).map((name) => ({
        id: `mcp-remote-${name}`, title: `remote:${name}`, type: 'MCP-инструмент', source: 'MCP remote', scope: 'Машина',
        priority: 'Возможность', description: 'Инструмент машины', explanation: 'Подключается для машины.',
        configured: true, available: true, includedInNextTurn: true, toggleable: true, enabled: true, lockReason: null
      }))
    })
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(snapshot), 'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]} fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    // Без пометки легко решить, что правишь свой контекст.
    const foreign = await screen.findByTestId('context-foreign')
    expect(foreign).toHaveTextContent('разговор пользователя')
    expect(foreign).toHaveTextContent('marina')
    expect(foreign).toHaveTextContent('в журнале останется ваш логин')

    // Чужой чат по умолчанию только читается: случайный клик не должен менять
    // работу другого человека.
    expect(screen.getByRole('button', { name: 'Выключить инструменты машины (2)' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Учитывать «Предпочтения ответа» в этом разговоре' })).toBeDisabled()

    fireEvent.click(within(foreign).getByRole('checkbox', { name: 'Разрешить изменения в этом разговоре' }))
    fireEvent.click(screen.getByRole('button', { name: 'Выключить инструменты машины (2)' }))
    await waitFor(() => expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'mcp-remote-bash', enabled: false }))
    expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'mcp-remote-read', enabled: false })
  })

  it('пресет по умолчанию для новых чатов и фильтр журнала по автору', async () => {
    const onSetDefaultPreset = vi.fn().mockResolvedValue(undefined)
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        changes: [
          { at: 3, actor: 'admin', itemId: 'personalization', enabled: false },
          { at: 2, actor: 'marina', itemId: 'knowledge-mode', enabled: false }
        ]
      })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      contextPresets={[{ id: 'p1', name: 'Минимальный', disabled: ['personalization'] }]} onSavePresets={vi.fn()}
      defaultPresetId={null} onSetDefaultPreset={onSetDefaultPreset}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const presets = await screen.findByTestId('context-presets')
    fireEvent.click(within(presets).getByText('Пресеты контекста'))
    fireEvent.change(within(presets).getByRole('combobox', { name: 'Пресет по умолчанию для новых разговоров' }), { target: { value: 'p1' } })
    await waitFor(() => expect(onSetDefaultPreset).toHaveBeenCalledWith('p1'))

    // Журнал двух авторов: фильтр отвечает на «что менял именно этот человек».
    const log = screen.getByTestId('context-changes')
    fireEvent.click(within(log).getByText('Журнал изменений контекста'))
    const actorsOf = (): string[] => within(log).getAllByRole('listitem').map((node) => node.textContent ?? '')
    expect(actorsOf().some((text) => text.includes('marina'))).toBe(true)
    fireEvent.change(within(log).getByRole('combobox', { name: 'Фильтр журнала по автору' }), { target: { value: 'admin' } })
    expect(actorsOf().some((text) => text.includes('marina'))).toBe(false)
    // Запись ведёт в карточку источника.
    fireEvent.click(within(log).getByRole('button', { name: 'Предпочтения ответа' }))
    expect(await screen.findByRole('heading', { name: 'Предпочтения ответа' })).toBeInTheDocument()
  })

  it('пресет применяется только после предпросмотра изменений', async () => {
    const setContextItem = vi.fn().mockResolvedValue(contextSnapshot({ personalizationEnabled: false }))
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})),
      'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      contextPresets={[{ id: 'p1', name: 'Минимальный', disabled: ['personalization'] }]} onSavePresets={vi.fn()}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    fireEvent.change(await screen.findByRole('combobox', { name: 'Применить пресет контекста' }), { target: { value: 'p1' } })
    // Выбор пресета сам ничего не меняет: сначала видно, что именно он сделает.
    const panel = await screen.findByTestId('context-preset-preview')
    expect(panel.textContent).toContain('выключит 1')
    expect(panel.textContent).toContain('Предпочтения ответа')
    expect(setContextItem).not.toHaveBeenCalled()

    fireEvent.click(within(panel).getByRole('button', { name: 'Применить пресет' }))
    await waitFor(() => expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'personalization', enabled: false }))
  })

  it('предпросмотр пресета закрывается по «Отмена», ничего не меняя', async () => {
    const setContextItem = vi.fn()
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})),
      'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      contextPresets={[{ id: 'p1', name: 'Минимальный', disabled: ['personalization'] }]} onSavePresets={vi.fn()}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Применить пресет контекста' }), { target: { value: 'p1' } })
    const panel = await screen.findByTestId('context-preset-preview')
    fireEvent.click(within(panel).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(screen.queryByTestId('context-preset-preview')).not.toBeInTheDocument())
    expect(setContextItem).not.toHaveBeenCalled()
  })

  it('запись журнала отменяется обратным переключением', async () => {
    const setContextItem = vi.fn().mockResolvedValue(contextSnapshot({}))
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      // Пункт выключен, и последняя запись журнала — про это же выключение:
      // только тогда «Отменить» вернёт то состояние, что написано в строке.
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        personalizationEnabled: false,
        changes: [{ at: 5, actor: 'admin', itemId: 'personalization', enabled: false }]
      })),
      'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const log = await screen.findByTestId('context-changes')
    fireEvent.click(within(log).getByRole('button', { name: 'Отменить' }))
    await waitFor(() => expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'personalization', enabled: true }))
  })

  it('показывает, что изменено с момента открытия, и возвращает как было', async () => {
    const setContextItem = vi.fn().mockResolvedValue(contextSnapshot({ personalizationEnabled: false }))
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})),
      'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Учитывать «Предпочтения ответа» в этом разговоре' }))
    const diff = await screen.findByTestId('context-session-diff')
    expect(diff.textContent).toContain('было включено, стало выключено')

    setContextItem.mockClear()
    fireEvent.click(within(diff).getByRole('button', { name: 'Вернуть как было при открытии' }))
    await waitFor(() => expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'personalization', enabled: true }))
  })

  it('поиск находит источник по тексту его блока и подсвечивает совпадение', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    // «Обращение» есть только в тексте блока промпта, не в названии источника.
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Поиск по источникам контекста' }), { target: { value: 'Обращение' } })
    expect(screen.getByTestId('context-found').textContent).toContain('Найдено: 1')
    const preview = screen.getByTestId('context-prompt-preview')
    expect(within(preview).getByText('Обращение').tagName).toBe('MARK')

    // Частая подстрока не должна разносить предпросмотр на тысячи узлов:
    // подсветок не больше лимита, а текст остаётся целым.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по источникам контекста' }), { target: { value: 'о' } })
    const marks = within(screen.getByTestId('context-prompt-preview')).getAllByText('о')
    expect(marks.length).toBeLessThanOrEqual(200)
    expect(screen.getByTestId('context-prompt-preview').textContent).toContain('Обращение к пользователю')
  })

  it('массовые действия ограничиваются выбранной группой', async () => {
    const setContextItem = vi.fn().mockResolvedValue(contextSnapshot({ personalizationEnabled: false }))
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})),
      'conversations:setContextItem': setContextItem } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    expect(screen.queryByTestId('context-group-bulk')).not.toBeInTheDocument()
    fireEvent.change(await screen.findByRole('combobox', { name: 'Фильтр по группе источников' }), { target: { value: 'instructions' } })
    const bulk = await screen.findByTestId('context-group-bulk')
    fireEvent.click(within(bulk).getByRole('button', { name: 'Выключить всё в «Инструкции» (1)' }))
    await waitFor(() => expect(setContextItem).toHaveBeenCalledWith({ id: 'c1', itemId: 'personalization', enabled: false }))
  })

  it('у тяжёлого источника видно долю и экономию от выключения', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({ costUsd: 0.008 })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    // Единственный блок промпта — этот пункт, значит доля 100% и вся стоимость.
    expect(await screen.findByText('тяжёлый · 100%')).toBeInTheDocument()
    expect(screen.getByText(/Выключение освободит ≈8 токенов, −\$0\.0080 за ход/)).toBeInTheDocument()
  })

  it('раскрытый раздел запоминается между открытиями', async () => {
    window.localStorage.removeItem('vc.context.sections')
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const section = await screen.findByTestId('context-excluded') as HTMLDetailsElement
    expect(section).not.toHaveAttribute('open')
    // Клик по summary в jsdom меняет атрибут, но событие `toggle` не рассылает
    // (браузер рассылает) — поэтому обработчик дёргаем событием напрямую.
    fireEvent.click(within(section).getByText('Не попадёт в следующий ход'))
    section.open = true
    fireEvent(section, new Event('toggle', { bubbles: false }))
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('vc.context.sections') ?? '{}')).toMatchObject({ excluded: true }))
  })

  it('сводка показывает итог хода вместе с историей', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        turnTotal: { chars: 8000, approxTokens: 2000, historyChars: 7800, historyApproxTokens: 1950, resumed: false }
      })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const total = await screen.findByTestId('context-turn-total')
    expect(total.textContent).toContain('Всего в следующий ход: ≈2000 токенов')
    expect(total.textContent).toContain('история — ≈1950')
  })

  it('при живой сессии движка итог хода объясняет, что история не уходит', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        turnTotal: { chars: 200, approxTokens: 50, historyChars: 0, historyApproxTokens: 0, resumed: true }
      })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    expect((await screen.findByTestId('context-turn-total')).textContent).toContain('история заново не уходит')
  })

  it('показывает цену того же объёма на других моделях', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        costUsd: 0.02, costByModel: [{ model: 'haiku', costUsd: 0.0013 }]
      })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    const models = await screen.findByTestId('context-cost-models')
    expect(models.textContent).toContain('haiku: ≈$0.0013 за ход')
  })

  it('Esc в карточке источника возвращает к списку', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    // Пункт встречается и в списке источников, и в сводке «не попадёт»:
    // открываем первый — тот, что в основном списке.
    fireEvent.click((await screen.findAllByRole('button', { name: /Предпочтения ответа/ }))[0]!)
    expect(await screen.findByRole('heading', { name: 'Предпочтения ответа' })).toBeInTheDocument()
    // Esc обрабатывает стек окон в фазе перехвата, поэтому событие шлём так же,
    // как браузер: на window с capture-слушателем стека.
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Предпочтения ответа' })).not.toBeInTheDocument())
    // Окно настроек при этом остаётся открытым: Esc вернул к списку, а не закрыл всё.
    expect(screen.getByTestId('conversation-settings-overlay')).toBeInTheDocument()
  })

  it('журнал фильтруется по источнику и выгружается в CSV', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        changes: [
          { at: 3, actor: 'admin', itemId: 'personalization', enabled: false },
          { at: 2, actor: 'admin', itemId: 'knowledge-mode', enabled: false }
        ]
      })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const log = await screen.findByTestId('context-changes')
    expect(within(log).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.change(within(log).getByRole('combobox', { name: 'Фильтр журнала по источнику' }), { target: { value: 'personalization' } })
    expect(within(log).getAllByRole('listitem')).toHaveLength(1)

    // Выгрузка не должна падать в jsdom: там нет createObjectURL по умолчанию.
    URL.createObjectURL = vi.fn().mockReturnValue('blob:csv')
    URL.revokeObjectURL = vi.fn()
    fireEvent.click(within(log).getByRole('button', { name: 'Экспорт журнала (CSV)' }))
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('в режиме границ блоков каждый блок копируется отдельно', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Показать границы блоков' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Скопировать блок' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PREVIEW_TEXT))
  })

  it('сводка для переписки и переход к самому тяжёлому источнику', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        turnTotal: { chars: 8000, approxTokens: 2000, historyChars: 7800, historyApproxTokens: 1950, resumed: false }
      })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Скопировать сводку' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(String(writeText.mock.calls[0]![0])).toContain('всего в ход ≈2000 токенов, история ≈1950')

    // Единственный пункт с размером — он же самый тяжёлый.
    fireEvent.click(screen.getByRole('button', { name: 'Самый тяжёлый: Предпочтения ответа' }))
    expect(await screen.findByRole('heading', { name: 'Предпочтения ответа' })).toBeInTheDocument()
  })

  it('журнал показывает смену настроек значением и фильтруется по виду события', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        changes: [
          { at: 4, actor: 'admin', itemId: 'permission-mode', enabled: true, value: 'plan' },
          { at: 3, actor: 'admin', itemId: 'personalization', enabled: false }
        ]
      })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const log = await screen.findByTestId('context-changes')
    const rows = (): string[] => within(log).getAllByRole('listitem').map((node) => node.textContent ?? '')
    expect(rows().some((text) => text.includes('изменил') && text.includes('plan'))).toBe(true)

    // Смену настройки нельзя «отменить» тумблером: у неё нет двух состояний.
    const settingRow = within(log).getAllByRole('listitem').find((node) => (node.textContent ?? '').includes('plan'))!
    expect(within(settingRow).queryByRole('button', { name: 'Отменить' })).not.toBeInTheDocument()

    fireEvent.change(within(log).getByRole('combobox', { name: 'Фильтр журнала по виду события' }), { target: { value: 'settings' } })
    expect(rows()).toHaveLength(1)
    fireEvent.change(within(log).getByRole('combobox', { name: 'Фильтр журнала по виду события' }), { target: { value: 'toggles' } })
    expect(rows().every((text) => !text.includes('plan'))).toBe(true)
  })

  it('показывает отличия набора от пресета по умолчанию', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({ personalizationEnabled: true })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      contextPresets={[{ id: 'p1', name: 'Минимальный', disabled: ['personalization'] }]} onSavePresets={vi.fn()}
      defaultPresetId="p1" onSetDefaultPreset={vi.fn()}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    // Пресет гасит персонализацию, а в разговоре она включена — это отличие.
    const diff = await screen.findByTestId('context-preset-diff')
    expect(diff.textContent).toContain('Отличия от пресета «Минимальный»')
    expect(diff.textContent).toContain('оставлено включённым 1')
  })

  it('раскрывает и сворачивает все разделы разом', async () => {
    window.localStorage.removeItem('vc.context.sections')
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({})) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Раскрыть все разделы' }))
    await waitFor(() => expect(screen.getByTestId('context-excluded')).toHaveAttribute('open'))
    expect(JSON.parse(window.localStorage.getItem('vc.context.sections') ?? '{}')).toMatchObject({ excluded: true, changes: true, technical: true })

    fireEvent.click(screen.getByRole('button', { name: 'Свернуть все' }))
    await waitFor(() => expect(screen.getByTestId('context-excluded')).not.toHaveAttribute('open'))
  })

  it('помечает включённый источник, текст которого в этом чате не уходит', async () => {
    // Инструкция включена и «уйдёт в следующий ход», но блока в промпте у неё
    // нет — так бывает, когда вид чата её не применяет.
    const base = contextSnapshot({})
    const withSilent: typeof base = {
      ...base,
      groups: [{ ...base.groups[0]!, items: [
        ...base.groups[0]!.items,
        { ...base.groups[0]!.items[1]!, id: 'instruction-console', title: 'Открывать терминал в чате', enabled: true, includedInNextTurn: true, toggleable: true, lockReason: null, size: null }
      ] }]
    }
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(withSilent) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    expect(await screen.findByText('в этом чате не уходит')).toBeInTheDocument()
  })

  it('доступность инспектора: список источников и карточка пункта', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        warnings: [{ itemId: 'personalization', level: 'problem', text: 'Проверьте персонализацию.' }],
        changes: [{ at: 2, actor: 'admin', itemId: 'personalization', enabled: false }]
      })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      contextPresets={[{ id: 'p1', name: 'Минимальный', disabled: ['personalization'] }]} onSavePresets={vi.fn()}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))
    await screen.findByTestId('context-summary')

    // Самый большой экран раздела до этого проверялся только сториз-прогоном.
    await expectNoViolations()
    expectLabelledIconButtons()

    // Карточка источника — второй экран инспектора, со своей разметкой.
    fireEvent.click((await screen.findAllByRole('button', { name: /Предпочтения ответа/ }))[0]!)
    await screen.findByRole('heading', { name: 'Предпочтения ответа' })
    await expectNoViolations()
  })

  it('в живой сессии движка видно, что настройки уходят повторно каждым ходом', async () => {
    window.api = { ...window.api, 'agents:listStorages': vi.fn().mockResolvedValue([]), 'conversations:getStorage': vi.fn().mockResolvedValue(null),
      'conversations:contextSnapshot': vi.fn().mockResolvedValue(contextSnapshot({
        costUsd: 0.004,
        turnTotal: { chars: 200, approxTokens: 50, historyChars: 0, historyApproxTokens: 0, resumed: true },
        turnSizes: [
          { at: '10:00', model: 'opus', chars: 400, approxTokens: 100, resumed: true, costUsd: null },
          { at: '10:05', model: 'opus', chars: 400, approxTokens: 100, resumed: true, costUsd: null }
        ]
      })) } as never
    render(<ConversationSettings conversation={conversation} agents={[agent]} role="admin" settings={settings} projects={[]}
      fetchProjectDetail={vi.fn().mockResolvedValue(null)} onSave={vi.fn()} onAddSkill={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Контекст и инструкции' }))

    const total = await screen.findByTestId('context-turn-total')
    expect(total.textContent).toContain('столько же уходит каждым следующим ходом')
    // Цена повтора — из серверной оценки, умноженной на число ходов.
    expect(total.textContent).toContain('$0.0080 за 2 прошедших ход(ов)')
  })

})
