import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import type { ProjectDetail } from '@shared/projects'
import { ProjectSettings, type ProjectSettingsProps } from './ProjectSettings'
import { createFakeCi } from '../test/fakeApi'

function detail(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'p1', name: 'Проект', description: '', gitUrl: null, technologies: [], skills: [],
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
