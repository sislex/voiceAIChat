import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from "@voicechat/ui-foundation/test/uiRender"
import type { ProjectInvitation } from '@shared/projects'
import { BUILTIN_PROJECT_TYPES, BUILTIN_PROJECT_TYPE_IDS, builtinProjectTypeChain } from '@shared/projectTypes'
import { ProjectSettings, projectFieldError, type ProjectSettingsProps } from './ProjectSettings'
import { expectNoViolations } from '@voicechat/ui-foundation/test/a11y'
import { installStoryBridges } from '../test/storyBridges'
import { createFakeCi } from '@voicechat/ui-foundation/test/fakeApi'

import { makeSettingsProject as detail } from '../test/fixtures/projectSettings'

function props(over: Partial<ProjectSettingsProps> = {}): ProjectSettingsProps {
  return {
    detail: detail(), agents: [],
    onUpdate: vi.fn(), onDelete: vi.fn(), onUpdateMemberRole: vi.fn(), onRemoveMember: vi.fn(),
    onLinkMachine: vi.fn(), onUnlinkMachine: vi.fn(), onSetMachinePath: vi.fn(),
    onSetReposRoot: vi.fn(), onSetMachineSsh: vi.fn(), onSetDefaultMachine: vi.fn(),
    ...over
  }
}

describe('Project settings accessibility and responsive contracts', () => {
  // @testCase TC-UI-01
  it('keeps tabs outside the single internal settings scroller', () => {
    render(<ProjectSettings {...props()} />)
    const root = screen.getByTestId('project-settings')
    const scroller = root.querySelector('.project-settings-scroll')
    expect(scroller).toHaveAttribute('role', 'tabpanel')
    expect(root.querySelector('.proj-settings-tabs-wrap')).not.toBe(scroller)
    expect(scroller).toContainElement(screen.getByLabelText('Название проекта'))
  })

  // @testCase TC-UI-02
  it('uses roving tabs, keyboard navigation and reveals the active mobile tab', async () => {
    const reveal = vi.fn()
    HTMLElement.prototype.scrollIntoView = reveal
    render(<ProjectSettings {...props()} />)
    const general = screen.getByRole('tab', { name: 'Общее' })
    expect(general).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(general, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Машины' })).toHaveAttribute('aria-selected', 'true')
    expect(reveal).toHaveBeenCalled()
  })

  // @testCase TC-REG-03
  it('has a tab heading and only references errors that exist', () => {
    render(<ProjectSettings {...props()} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Общее' })).toBeInTheDocument()
    const git = screen.getByLabelText('Git-репозиторий')
    expect(git).not.toHaveAttribute('aria-describedby')
    fireEvent.change(git, { target: { value: 'bad-url' } })
    const errorId = git.getAttribute('aria-describedby')
    expect(errorId).toBeTruthy()
    expect(document.getElementById(errorId!)).toHaveAttribute('role', 'alert')
  })

  // @testCase TC-REG-09
  it('does not dim project role text with opacity', async () => {
    render(<ProjectSettings {...props()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Участники' }))
    expect(screen.getByLabelText(/Роль /)).toHaveClass('sel')
    expect(screen.getByTestId('project-settings')).toHaveClass('proj-detail')
  })
})

describe('Project settings draft', () => {
  it('has accessible invalid and dirty form states', async () => {
    render(<ProjectSettings {...props()} />)
    fireEvent.change(screen.getByLabelText('Git-репозиторий'), { target: { value: 'bad-url' } })
    await expectNoViolations()
  })
  // @testCase TC-02
  it('keeps error descriptions in sync with rendered alerts', () => {
    render(<ProjectSettings {...props()} />)
    const cases = [
      { label: 'Название проекта', invalid: '', valid: 'Проект' },
      { label: 'Git-репозиторий', invalid: 'bad-url', valid: 'https://github.com/team/repo.git' },
      { label: 'URL веб-превью', invalid: 'bad-url', valid: 'https://preview.example' }
    ]

    for (const item of cases) {
      const field = screen.getByLabelText(item.label)
      expect(field).not.toHaveAttribute('aria-describedby')
      fireEvent.change(field, { target: { value: item.invalid } })
      const descriptionId = field.getAttribute('aria-describedby')
      expect(descriptionId).toBeTruthy()
      const alert = document.getElementById(descriptionId!)
      expect(alert).toHaveAttribute('role', 'alert')
      fireEvent.change(field, { target: { value: item.valid } })
      expect(field).not.toHaveAttribute('aria-describedby')
      expect(document.getElementById(descriptionId!)).toBeNull()
    }
  })

  // @testCase TC-05
  it('has one page heading followed by no skipped heading levels', () => {
    render(<ProjectSettings {...props()} />)
    const headings = screen.getAllByRole('heading')
    expect(headings.filter(heading => heading.tagName === 'H1')).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Настройки проекта')
    const levels = headings.map(heading => Number(heading.tagName.slice(1)))
    expect(levels.every((level, index) => index === 0 || level <= levels[index - 1]! + 1)).toBe(true)
  })

  it('checks legacy checkout and health without deploying', async () => {
    const bridges = installStoryBridges()
    const exec = vi.fn().mockResolvedValueOnce({ exitCode: 0, output: 'true', timedOut: false }).mockResolvedValueOnce({ exitCode: 1, output: 'connection refused', timedOut: false })
    bridges.fs.exec = exec
    render(<ProjectSettings {...props({ activeTab: 'workflow', detail: detail({
      productionAgentId: 'a1', productionCheckoutPath: "/srv/project's checkout",
      gitUrl: 'git@example.com:team/repo.git', productionHealthCheckCommand: 'curl -fsS http://localhost/health',
      machines: [{ agentId: 'a1', path: '/srv/project', reposRoot: '/srv/repos', online: true }]
    }) })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Проверить production' }))
    expect(await screen.findByText(/connection refused/)).toBeInTheDocument()
    expect(screen.getByText(/✓ Checkout:/)).toBeInTheDocument()
    expect(exec).toHaveBeenCalledTimes(2)
    expect(exec.mock.calls[0][1]).toContain("'/srv/project'\\''s checkout'")
    expect(exec.mock.calls[1][1]).toContain('curl -fsS')
  })

  // @testCase TC-UI-05
  it('runs a draft command on the project machine and limits displayed output', async () => {
    const bridges = installStoryBridges()
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, timedOut: false, output: Array.from({ length: 60 }, (_, i) => 'line-' + (i + 1)).join('\n') })
    bridges.fs.exec = exec
    const onUpdate = vi.fn()
    render(<ProjectSettings {...props({ activeTab: 'workflow', onUpdate, detail: detail({
      defaultAgentId: 'a1', testCommand: 'npm test',
      machines: [{ agentId: 'a1', path: '/srv/project', reposRoot: '/srv/repos', online: true }]
    }) })} />)
    fireEvent.change(screen.getByLabelText('Команда тестирования'), { target: { value: 'npm run test:unit' } })
    await userEvent.click(screen.getByRole('button', { name: 'Проверить на машине: Команда тестирования' }))
    expect(await screen.findByText(/line-50/)).not.toHaveTextContent('line-51')
    expect(exec.mock.calls[0][0]).toBe('a1')
    expect(exec.mock.calls[0][1]).toContain('npm run test:unit')
    expect(exec.mock.calls[0][3]).toBe('p1')
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('starts a login check without passing the password to the host action', async () => {
    const check = vi.fn().mockResolvedValue(undefined)
    render(<ProjectSettings {...props({ onCheckTestLogin: check, detail: detail({ previewUrl: 'https://test.example', testUsers: [{ name: 'tester', password: 'secret' }] }) })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Проверить вход: tester' }))
    expect(check).toHaveBeenCalledWith('p1', 'tester')
  })

  it.each([
    ['gitUrl', 'https://github.com/team/repo.git', false],
    ['gitUrl', 'git@github.com:team/repo.git', false],
    ['gitUrl', 'file:///repo', true],
    ['ciBaseBranch', 'has space', true],
    ['ciBranchTemplate', 'feature/{task_number}/{slug}', false],
    ['ciBranchTemplate', '{unknown}', true],
    ['ciBranchTemplate', '{slug}/{slug}', true],
    ['testCommand', '   ', true]
  ])('validates %s = %s', (field, value, invalid) => {
    expect(Boolean(projectFieldError(String(field), String(value)))).toBe(invalid)
  })

  // @testCase TC-REG-03
  it('collects fields, blocks invalid saves, cancels and warns before leaving', async () => {
    const onUpdate = vi.fn()
    render(<ProjectSettings {...props({ onUpdate })} />)
    fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Draft' } })
    await userEvent.click(screen.getByRole('tab', { name: 'LLM' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Общее' }))
    expect(screen.getByLabelText('Название проекта')).toHaveValue('Draft')
    fireEvent.change(screen.getByLabelText('Git-репозиторий'), { target: { value: 'invalid' } })
    expect(screen.getByLabelText('Git-репозиторий')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    expect(onUpdate).not.toHaveBeenCalled()
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    const resume = vi.fn()
    const leave = new CustomEvent('voicechat:before-navigate', { cancelable: true, detail: { target: '#/projects', resume } })
    fireEvent(window, leave)
    expect(leave.defaultPrevented).toBe(true)
    await userEvent.click(await screen.findByRole('button', { name: 'Отмена' }))
    expect(resume).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    expect(screen.getByLabelText('Название проекта')).toHaveValue('Проект')
    const cleanUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(cleanUnload)
    expect(cleanUnload.defaultPrevented).toBe(false)
    fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Saved' } })
    fireEvent.change(screen.getByLabelText('Git-репозиторий'), { target: { value: 'git@example.com:team/repo.git' } })
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith('p1', { name: 'Saved', gitUrl: 'git@example.com:team/repo.git' })
  })

  // @testCase TC-REG-05
  it('keeps the draft after a failed save and across server updates', async () => {
    const p = props({ onUpdate: vi.fn().mockRejectedValue(new Error('Save failed')) })
    const view = render(<ProjectSettings {...p} />)
    fireEvent.change(screen.getByLabelText('Название проекта'), { target: { value: 'Draft' } })
    view.rerender(<ProjectSettings {...p} detail={detail({ description: 'Server update' })} />)
    expect(screen.getByLabelText('Название проекта')).toHaveValue('Draft')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(screen.getByLabelText('Название проекта')).toHaveValue('Draft')
  })
})

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
    expect(onUpdate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onUpdate).toHaveBeenCalledWith('p1', { ciKbContextMode: 'off' })
  })

  it('участник (не владелец) режим не меняет', async () => {
    render(<ProjectSettings {...props({ detail: detail({ role: 'member' }) })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'LLM' }))
    expect(kbSelect()).toBeDisabled()
  })

  // @testCase TC-UI-04
  it('раскладывает настройки по вкладкам и сохраняет выбранную вкладку при обновлении detail', async () => {
    const view = render(<ProjectSettings {...props()} />)
    expect(screen.getByRole('tab', { name: 'Общее' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'LLM' }))
    expect(screen.getByTestId('project-llm-hint')).toHaveTextContent('чатам проекта сразу')
    expect(screen.queryByLabelText('Название проекта')).not.toBeInTheDocument()
    view.rerender(<ProjectSettings {...props({ detail: detail({ name: 'Обновлённый проект' }) })} />)
    expect(screen.getByRole('tab', { name: 'LLM' })).toHaveAttribute('aria-selected', 'true')
  })

  // @testCase TC-UI-02
  it('supports cyclic Arrow, Home and End navigation with a single roving tab stop', async () => {
    render(<ProjectSettings {...props()} />)
    const general = screen.getByRole('tab', { name: 'Общее' })
    general.focus()

    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'LLM' })).toHaveFocus())
    await userEvent.keyboard('{End}')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Машины' })).toHaveFocus())
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(general).toHaveFocus())
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Машины' })).toHaveFocus())
    await userEvent.keyboard('{Home}')
    await waitFor(() => expect(general).toHaveFocus())

    const tabs = screen.getAllByRole('tab')
    expect(tabs.filter(tab => tab.getAttribute('aria-selected') === 'true')).toEqual([general])
    expect(tabs.filter(tab => tab.tabIndex === 0)).toEqual([general])
  })

  it('передаёт персональные права в выбор движка LLM проекта', async () => {
    render(<ProjectSettings {...props({ llmAccess: [{ provider: 'claude', modelId: '*' }] })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'LLM' }))
    const provider = screen.getByLabelText('Движок проекта') as HTMLSelectElement
    expect(provider).not.toHaveTextContent('Claude')
    expect(provider).toHaveTextContent('Codex')
  })

  // @testCase TC-NEG-07
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

  it('удаление участника требует подтверждения с именем', async () => {
    const onRemoveMember = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<ProjectSettings {...props({ onRemoveMember, detail: detail({ members: [
      { username: 'admin', role: 'owner', addedAt: 1 },
      { username: 'bob', role: 'member', addedAt: 2 }
    ] }) })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Участники' }))
    await userEvent.click(screen.getByLabelText('Убрать bob'))
    expect(confirm).toHaveBeenLastCalledWith('Удалить участника bob из проекта?')
    expect(onRemoveMember).not.toHaveBeenCalled()
    await userEvent.click(screen.getByLabelText('Убрать bob'))
    expect(onRemoveMember).toHaveBeenCalledWith('p1', 'bob')
    confirm.mockRestore()
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
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onUpdate).toHaveBeenCalledWith('p1', { previewUrl: 'https://new.example/app' })
    await userEvent.clear(input)
    await userEvent.type(input, 'file:///tmp/app')
    await userEvent.tab()
    expect(input).toHaveValue('file:///tmp/app')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
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
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Пароль тестового пользователя 1')).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
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

  it('сужение возможностей спрашивает подтверждение и перечисляет потери', async () => {
    const onUpdate = vi.fn()
    render(<ProjectSettings {...props({ projectTypes: types, onUpdate })} />)
    await userEvent.selectOptions(screen.getByLabelText('Тип проекта'), BUILTIN_PROJECT_TYPE_IDS.general)
    // Молчаливое переключение выглядело бы как поломка: исчезают целые разделы.
    expect(onUpdate).not.toHaveBeenCalled()
    expect(await screen.findByText(/Станут недоступны/)).toHaveTextContent('Код, Merge')
    expect(screen.getByText(/Вкладки карточки:/)).toHaveTextContent('Лента рана')
    await userEvent.click(screen.getByRole('button', { name: 'Сменить тип' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('p1', { typeId: BUILTIN_PROJECT_TYPE_IDS.general }))
  })

  it('отказ в подтверждении оставляет прежний тип', async () => {
    const onUpdate = vi.fn()
    render(<ProjectSettings {...props({ projectTypes: types, onUpdate })} />)
    await userEvent.selectOptions(screen.getByLabelText('Тип проекта'), BUILTIN_PROJECT_TYPE_IDS.general)
    await userEvent.click(await screen.findByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(onUpdate).not.toHaveBeenCalled())
  })

  it('расширение возможностей показывает предпросмотр до сохранения', async () => {
    const onUpdate = vi.fn()
    render(<ProjectSettings {...props({
      projectTypes: types,
      onUpdate,
      detail: detail({ typeId: BUILTIN_PROJECT_TYPE_IDS.general, typeChain: builtinProjectTypeChain(BUILTIN_PROJECT_TYPE_IDS.general) })
    })} />)
    await userEvent.selectOptions(screen.getByLabelText('Тип проекта'), BUILTIN_PROJECT_TYPE_IDS.software)
    expect(await screen.findByText(/Включатся:/)).toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Сменить тип' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('p1', { typeId: BUILTIN_PROJECT_TYPE_IDS.software }))
    expect(screen.queryByText(/Станут недоступны/)).not.toBeInTheDocument()
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

  it('«Сохранить как подтип» просит имя и отдаёт его наверх', async () => {
    const onDeriveType = vi.fn()
    render(<ProjectSettings {...props({ projectTypes: types, onDeriveType })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить как подтип…' }))
    await userEvent.type(screen.getByLabelText('Название нового подтипа'), '  Мой шаблон  ')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onDeriveType).toHaveBeenCalledWith('p1', 'Мой шаблон')
    // Форма закрылась — повторное нажатие не отправит дубль.
    expect(screen.queryByLabelText('Название нового подтипа')).not.toBeInTheDocument()
  })

  it('участник сохранить подтип не может', () => {
    render(<ProjectSettings {...props({ projectTypes: types, onDeriveType: vi.fn(), detail: detail({ role: 'member' }) })} />)
    expect(screen.queryByRole('button', { name: 'Сохранить как подтип…' })).not.toBeInTheDocument()
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

describe('ProjectSettings — вкладка из адреса', () => {
  const generalChain = builtinProjectTypeChain(BUILTIN_PROJECT_TYPE_IDS.general)

  // @testCase TC-REG-05
  it('открывает вкладку, пришедшую от хоста, и не переключает её сама', async () => {
    const onTabChange = vi.fn()
    render(<ProjectSettings {...props({ activeTab: 'members', onTabChange })} />)
    expect(screen.getByRole('tab', { name: 'Участники' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'LLM' }))
    // Вкладку меняет адрес: компонент только просит хоста перейти.
    expect(onTabChange).toHaveBeenCalledWith('llm', undefined)
    expect(screen.getByRole('tab', { name: 'Участники' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'LLM' })).toHaveAttribute('aria-selected', 'false')
  })

  // @testCase TC-NEG-04
  it.each(['workflow', 'machines'] as const)('вкладку %s выключенной подсистемы заменяет на «Общее» без новой записи в истории', async (activeTab) => {
    const onTabChange = vi.fn()
    render(<ProjectSettings {...props({
      activeTab, onTabChange,
      detail: detail({ typeId: BUILTIN_PROJECT_TYPE_IDS.general, typeChain: generalChain })
    })} />)
    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('general', { replace: true }))
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
    await userEvent.selectOptions(screen.getByLabelText('Срок действия'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Пригласить' }))
    // Адрес обрезан, роль передана.
    expect(onInvite).toHaveBeenCalledWith('p1', 'bob@example.com', 'owner', 30)
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

  it('приглашённому по логину можно перевыпустить ссылку', async () => {
    await open({ invitations: [invitation({ email: null, invitedUsername: 'bob' })], onResendInvitation: vi.fn() })
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить снова' })).toBeInTheDocument()
  })

  it('участник формы приглашения не видит', async () => {
    render(<ProjectSettings {...props({ onInvite: vi.fn(), detail: detail({ role: 'member' }) })} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Участники' }))
    expect(screen.queryByLabelText('Логин или email')).not.toBeInTheDocument()
  })
})
