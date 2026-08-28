import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import type { ProjectDetail, ProjectInvitation } from '@shared/projects'
import { BUILTIN_PROJECT_TYPES, BUILTIN_PROJECT_TYPE_IDS, builtinProjectTypeChain } from '@shared/projectTypes'
import { ProjectSettings, type ProjectSettingsProps } from './ProjectSettings'
import { createFakeCi } from '../test/fakeApi'

function detail(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'p1', name: 'Проект', description: '',
    typeId: BUILTIN_PROJECT_TYPE_IDS.software, typeChain: builtinProjectTypeChain(),
    gitUrl: null, technologies: [], skills: [],
    defaultSkills: { epic: [], story: [], task: [] }, createdBy: 'admin', createdAt: 1, updatedAt: 1,
    role: 'owner', commitPolicy: 'agent_commits', mergeTransport: 'local', agentPlanApprovalMode: 'manual',
    members: [{ username: 'admin', role: 'owner', addedAt: 1 }], machines: [], defaultAgentId: null,
    ...over
  } as ProjectDetail
}

function props(over: Partial<ProjectSettingsProps> = {}): ProjectSettingsProps {
  return {
    detail: detail(), agents: [],
    onUpdate: vi.fn(), onDelete: vi.fn(), onAddMember: vi.fn(), onUpdateMemberRole: vi.fn(), onRemoveMember: vi.fn(),
    onLinkMachine: vi.fn(), onUnlinkMachine: vi.fn(), onSetMachinePath: vi.fn(),
    onSetReposRoot: vi.fn(), onSetMachineSsh: vi.fn(), onSetDefaultMachine: vi.fn(),
    ...over
  }
}

const kbSelect = (): HTMLSelectElement => screen.getByLabelText('CI: база знаний в ране') as HTMLSelectElement

describe('ProjectSettings — режим базы знаний для CI-рана', () => {
  beforeEach(() => { window.ci = createFakeCi() })

  it('по умолчанию «авто» и пояснение говорит, что настройка про ран, а не про чат', async () => {
    render(<ProjectSettings {...props()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'LLM' }))
    expect(kbSelect().value).toBe('auto')
    const hint = screen.getByTestId('proj-ci-kb-hint').textContent ?? ''
    expect(hint).toContain('CI-ране')
    expect(hint).toContain('На чаты проекта настройка не влияет')
    expect(hint).toContain('следующему рану')
  })

  it('показывает сохранённое значение проекта', async () => {
    render(<ProjectSettings {...props({ detail: detail({ ciKbContextMode: 'manual' }) })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'LLM' }))
    expect(kbSelect().value).toBe('manual')
  })

  it('выбор режима уходит в onUpdate', async () => {
    const onUpdate = vi.fn()
    render(<ProjectSettings {...props({ onUpdate })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'LLM' }))
    await userEvent.selectOptions(kbSelect(), 'off')
    expect(onUpdate).toHaveBeenCalledWith('p1', { ciKbContextMode: 'off' })
  })

  it('участник (не владелец) режим не меняет', async () => {
    render(<ProjectSettings {...props({ detail: detail({ role: 'member' }) })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'LLM' }))
    expect(kbSelect()).toBeDisabled()
  })

  it('раскладывает настройки по вкладкам и сохраняет выбранную вкладку при обновлении detail', async () => {
    const view = render(<ProjectSettings {...props()} />)
    expect(screen.getByRole('tab', { name: 'Общее' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'LLM' }))
    expect(screen.getByTestId('project-llm-hint')).toHaveTextContent('чатам проекта сразу')
    expect(screen.queryByLabelText('Название проекта')).not.toBeInTheDocument()
    view.rerender(<ProjectSettings {...props({ detail: detail({ name: 'Обновлённый проект' }) })} />)
    expect(screen.getByRole('tab', { name: 'LLM' })).toHaveAttribute('aria-selected', 'true')
  })

  it('передаёт персональные права в выбор движка LLM проекта', async () => {
    render(<ProjectSettings {...props({ llmAccess: [{ provider: 'claude', modelId: '*' }] })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'LLM' }))
    const provider = screen.getByLabelText('Движок проекта') as HTMLSelectElement
    expect(provider).not.toHaveTextContent('Claude')
    expect(provider).toHaveTextContent('Codex')
  })

  it('показывает всех владельцев, текущего пользователя и защищает последнего', async () => {
    render(<ProjectSettings {...props({
      currentUsername: 'admin',
      detail: detail({
        members: [
          { username: 'admin', role: 'owner', addedAt: 1 },
          { username: 'bob', role: 'member', addedAt: 2 }
        ]
      })
    })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Участники' }))
    expect(screen.getByLabelText('Роль admin').closest('li')).toHaveTextContent('admin · вы · создатель')
    expect(screen.getByLabelText('Роль admin')).toBeDisabled()
    expect(screen.getByText(/Сначала назначьте другого владельца/)).toBeInTheDocument()
    expect(screen.getByLabelText('Убрать admin')).toBeDisabled()
  })

  it('назначение владельца требует подтверждения и вызывает смену роли', async () => {
    const onUpdateMemberRole = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<ProjectSettings {...props({
      onUpdateMemberRole,
      detail: detail({
        members: [
          { username: 'admin', role: 'owner', addedAt: 1 },
          { username: 'bob', role: 'member', addedAt: 2 }
        ]
      })
    })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Участники' }))
    const role = screen.getByLabelText('Роль bob')
    await userEvent.selectOptions(role, 'owner')
    expect(onUpdateMemberRole).not.toHaveBeenCalled()
    await userEvent.selectOptions(role, 'owner')
    expect(confirm).toHaveBeenCalled()
    expect(onUpdateMemberRole).toHaveBeenCalledWith('p1', 'bob', 'owner')
    confirm.mockRestore()
  })

  it('сохраняет http/https URL превью и откатывает невалидный адрес', async () => {
    const onUpdate = vi.fn()
    render(<ProjectSettings {...props({ detail: detail({ previewUrl: 'https://old.example/' }), onUpdate })} />)
    const input = screen.getByLabelText('URL веб-превью')
    await userEvent.clear(input)
    await userEvent.type(input, 'https://new.example/app')
    await userEvent.tab()
    expect(onUpdate).toHaveBeenCalledWith('p1', { previewUrl: 'https://new.example/app' })
    await userEvent.clear(input)
    await userEvent.type(input, 'file:///tmp/app')
    await userEvent.tab()
    expect(input).toHaveValue('https://old.example/')
  })

  it('переводит legacy production в managed только после preflight и отдельного подтверждения', async () => {
    const preflight = vi.fn(async () => ({
      ok: true, environment: 'production' as const, confirmationToken: 'token-1',
      paths: { repository: '/storage/projects/p1/environments/production/temporary/repository' },
      checks: { marker: { ok: true, message: 'ok' } }
    }))
    const updated = detail({ productionEnvironmentMode: 'managed' })
    const confirm = vi.fn(async () => updated)
    const onConfirmed = vi.fn()
    render(<ProjectSettings {...props({
      detail: detail({ productionEnvironmentMode: 'legacy', productionCheckoutPath: '/root/voiceAIChat' }),
      managedProductionApi: { 'releases:managedPreflight': preflight, 'releases:managedConfirm': confirm } as never,
      onManagedProductionConfirmed: onConfirmed
    })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Workflow и CI' }))
    await userEvent.click(screen.getByRole('button', { name: 'Проверить Managed production' }))
    expect(await screen.findByRole('status')).toHaveTextContent('/storage/projects/p1/environments/production/temporary/repository')
    expect(confirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить переход в Managed' }))
    expect(confirm).toHaveBeenCalledWith({ projectId: 'p1', confirmationToken: 'token-1' })
    expect(onConfirmed).toHaveBeenCalledWith(updated)
  })

  it('не показывает переход участнику и скрывает его для managed-проекта', async () => {
    const api = { 'releases:managedPreflight': vi.fn(), 'releases:managedConfirm': vi.fn() } as never
    const view = render(<ProjectSettings {...props({ detail: detail({ role: 'member', productionEnvironmentMode: 'legacy' }), managedProductionApi: api })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Workflow и CI' }))
    expect(screen.queryByRole('button', { name: 'Проверить Managed production' })).not.toBeInTheDocument()
    view.rerender(<ProjectSettings {...props({ detail: detail({ productionEnvironmentMode: 'managed' }), managedProductionApi: api })} />)
    expect(screen.queryByTestId('managed-production-transition')).not.toBeInTheDocument()
  })
})

describe('ProjectSettings — тестовые пользователи', () => {
  it('владелец добавляет учётку: заполнение и blur сохраняют список', async () => {
    const onUpdate = vi.fn()
    render(<ProjectSettings {...props({ onUpdate })} />)
    expect(screen.getByText('Тестовые пользователи не заведены')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить тестового пользователя' }))
    await userEvent.type(screen.getByLabelText('Логин тестового пользователя 1'), 'tester')
    await userEvent.type(screen.getByLabelText('Пароль тестового пользователя 1'), 'test-pass')
    await userEvent.tab()
    const last = onUpdate.mock.calls.at(-1)
    expect(last?.[1]).toEqual({ testUsers: [{ name: 'tester', password: 'test-pass' }] })
  })

  it('удаление учётки уходит в onUpdate без неё', async () => {
    const onUpdate = vi.fn()
    render(<ProjectSettings {...props({
      onUpdate,
      detail: detail({ testUsers: [{ name: 'tester', password: 'p' }, { name: 'viewer', password: '' }] })
    })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Удалить тестового пользователя 1' }))
    expect(onUpdate).toHaveBeenCalledWith('p1', { testUsers: [{ name: 'viewer', password: '' }] })
  })

  it('участник видит список без полей редактирования', async () => {
    render(<ProjectSettings {...props({
      detail: detail({ role: 'member', testUsers: [{ name: 'tester', password: 'p', role: 'admin', note: 'полный доступ' }] })
    })} />)
    expect(screen.getByText('tester — admin (полный доступ)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Логин тестового пользователя 1')).not.toBeInTheDocument()
  })
})

describe('ProjectSettings — тип проекта', () => {
  const generalChain = builtinProjectTypeChain(BUILTIN_PROJECT_TYPE_IDS.general)
  const types = BUILTIN_PROJECT_TYPES.map((node) => ({
    ...node, builtin: true, ownerId: null, status: 'published' as const,
    reviewNote: '', createdBy: 'system', createdAt: 0, updatedAt: 0
  }))

  it('владелец меняет тип, значение уходит в onUpdate', async () => {
    const onUpdate = vi.fn()
    render(<ProjectSettings {...props({ projectTypes: types, onUpdate })} />)
    await userEvent.selectOptions(screen.getByLabelText('Тип проекта'), BUILTIN_PROJECT_TYPE_IDS.general)
    expect(onUpdate).toHaveBeenCalledWith('p1', { typeId: BUILTIN_PROJECT_TYPE_IDS.general })
  })

  it('опции подписаны путём от корня — одноимённые подтипы различимы', () => {
    render(<ProjectSettings {...props({ projectTypes: types })} />)
    const select = screen.getByLabelText('Тип проекта') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.text)).toContain('Разработка ПО / Веб-приложение')
  })

  it('участник видит тип текстом, без селекта', () => {
    render(<ProjectSettings {...props({ projectTypes: types, detail: detail({ role: 'member' }) })} />)
    expect(screen.queryByLabelText('Тип проекта')).not.toBeInTheDocument()
    expect(screen.getByText('Разработка ПО')).toBeInTheDocument()
  })

  it('«Общий проект»: нет вкладок CI и машин, нет полей git, превью и тестовых учёток', () => {
    render(<ProjectSettings {...props({
      projectTypes: types,
      detail: detail({ typeId: BUILTIN_PROJECT_TYPE_IDS.general, typeChain: generalChain })
    })} />)
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Общее', 'LLM', 'Доска', 'Участники'])
    expect(screen.queryByLabelText('Git-репозиторий')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('URL веб-превью')).not.toBeInTheDocument()
    expect(screen.queryByText('Тестовые пользователи')).not.toBeInTheDocument()
    // И честно сказано, что осталось.
    expect(screen.getByText('только доска и задачи')).toBeInTheDocument()
  })

  it('у «Разработки ПО» вкладки и поля на месте', () => {
    render(<ProjectSettings {...props({ projectTypes: types })} />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent))
      .toEqual(['Общее', 'LLM', 'Доска', 'Workflow и CI', 'Участники', 'Машины'])
    expect(screen.getByLabelText('Git-репозиторий')).toBeInTheDocument()
    expect(screen.getByLabelText('URL веб-превью')).toBeInTheDocument()
  })
})

describe('ProjectSettings — приглашения участников', () => {
  const invitation = (over: Partial<ProjectInvitation> = {}): ProjectInvitation => ({
    id: 'inv1', projectId: 'p1', email: 'bob@example.com', invitedUsername: null,
    role: 'member', status: 'pending', invitedBy: 'admin',
    createdAt: 1, expiresAt: Date.parse('2026-09-04T00:00:00Z'), respondedAt: null, ...over
  })

  const open = async (over: Partial<ProjectSettingsProps> = {}) => {
    const result = render(<ProjectSettings {...props({ onInvite: vi.fn(), ...over })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Участники' }))
    return result
  }

  it('владелец приглашает по логину или email с выбранной ролью', async () => {
    const onInvite = vi.fn()
    await open({ onInvite })
    await userEvent.type(screen.getByLabelText('Логин или email'), '  bob@example.com  ')
    await userEvent.selectOptions(screen.getByLabelText('Роль'), 'owner')
    await userEvent.click(screen.getByRole('button', { name: 'Пригласить' }))
    // Адрес обрезан, роль передана.
    expect(onInvite).toHaveBeenCalledWith('p1', 'bob@example.com', 'owner')
    // Поле очищено — иначе повторное нажатие шлёт дубль.
    expect(screen.getByLabelText('Логин или email')).toHaveValue('')
  })

  it('пустой ввод не отправляется', async () => {
    const onInvite = vi.fn()
    await open({ onInvite })
    expect(screen.getByRole('button', { name: 'Пригласить' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Логин или email'), '   ')
    expect(onInvite).not.toHaveBeenCalled()
  })

  it('ожидающие показаны со сроком, отзыв и повторная отправка работают', async () => {
    const onRevokeInvitation = vi.fn()
    const onResendInvitation = vi.fn()
    await open({ invitations: [invitation()], onRevokeInvitation, onResendInvitation })
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Отправить снова' }))
    expect(onResendInvitation).toHaveBeenCalledWith('p1', 'inv1')
    await userEvent.click(screen.getByRole('button', { name: /Отозвать приглашение/ }))
    expect(onRevokeInvitation).toHaveBeenCalledWith('p1', 'inv1')
  })

  it('приглашённому по логину «отправить снова» не показываем — письма нет', async () => {
    await open({ invitations: [invitation({ email: null, invitedUsername: 'bob' })], onResendInvitation: vi.fn() })
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Отправить снова' })).not.toBeInTheDocument()
  })

  it('участник формы приглашения не видит', async () => {
    render(<ProjectSettings {...props({ onInvite: vi.fn(), detail: detail({ role: 'member' }) })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Участники' }))
    expect(screen.queryByLabelText('Логин или email')).not.toBeInTheDocument()
  })
})
