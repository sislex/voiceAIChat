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
    onUpdate: vi.fn(), onDelete: vi.fn(), onAddMember: vi.fn(), onRemoveMember: vi.fn(),
    onLinkMachine: vi.fn(), onUnlinkMachine: vi.fn(), onSetMachinePath: vi.fn(),
    onSetReposRoot: vi.fn(), onSetDefaultMachine: vi.fn(),
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
})
