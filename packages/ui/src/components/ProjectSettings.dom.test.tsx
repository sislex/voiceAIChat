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

  it('по умолчанию «авто» и пояснение говорит, что настройка про ран, а не про чат', () => {
    render(<ProjectSettings {...props()} />)
    expect(kbSelect().value).toBe('auto')
    const hint = screen.getByTestId('proj-ci-kb-hint').textContent ?? ''
    expect(hint).toContain('CI-ране')
    expect(hint).toContain('На чаты проекта настройка не влияет')
    expect(hint).toContain('следующему рану')
  })

  it('показывает сохранённое значение проекта', () => {
    render(<ProjectSettings {...props({ detail: detail({ ciKbContextMode: 'manual' }) })} />)
    expect(kbSelect().value).toBe('manual')
  })

  it('выбор режима уходит в onUpdate', async () => {
    const onUpdate = vi.fn()
    render(<ProjectSettings {...props({ onUpdate })} />)
    await userEvent.selectOptions(kbSelect(), 'off')
    expect(onUpdate).toHaveBeenCalledWith('p1', { ciKbContextMode: 'off' })
  })

  it('участник (не владелец) режим не меняет', () => {
    render(<ProjectSettings {...props({ detail: detail({ role: 'member' }) })} />)
    expect(kbSelect()).toBeDisabled()
  })
})
