import { describe, expect, it } from 'vitest'
import { describeProjectFeatures, projectPromptBlock, projectPromptLines } from './promptContext.js'
import { builtinProjectTypeChain, BUILTIN_PROJECT_TYPE_IDS, type ProjectSummary } from '@voicechat/shared'

const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 'p1', name: 'Проект', description: '',
  typeId: BUILTIN_PROJECT_TYPE_IDS.software, typeChain: builtinProjectTypeChain(),
  gitUrl: null, technologies: [], skills: [],
  defaultSkills: { epic: [], story: [], task: [] },
  createdBy: 'alice', createdAt: 1, updatedAt: 1, role: 'owner',
  commitPolicy: 'agent_commits', mergeTransport: 'local', agentPlanApprovalMode: 'manual',
  ...over
} as ProjectSummary)

describe('контекст проекта для промпта', () => {
  it('тип и подсистемы идут сразу после id', () => {
    const lines = projectPromptLines(project({ gitUrl: 'git@example', technologies: ['ts'] }))
    expect(lines[0]).toBe('ID проекта: p1')
    expect(lines[1]).toBe('Тип проекта: Разработка ПО')
    // Без этой строки модель предлагает CI там, где он выключен.
    expect(lines[2]).toBe('Доступные подсистемы: git, machines, ci, qa, releases, preview')
    expect(lines).toContain('Git-репозиторий: git@example')
  })

  it('у проекта без подсистем это сказано прямо', () => {
    const lines = projectPromptLines(project({ typeChain: builtinProjectTypeChain(BUILTIN_PROJECT_TYPE_IDS.general) }))
    expect(lines[2]).toBe('Доступные подсистемы: нет (только доска и задачи)')
  })

  it('пустые поля не превращаются в пустые строки', () => {
    expect(projectPromptLines(project())).toEqual([
      'ID проекта: p1',
      'Тип проекта: Разработка ПО',
      'Доступные подсистемы: git, machines, ci, qa, releases, preview'
    ])
  })

  it('блок несёт имя проекта заголовком', () => {
    expect(projectPromptBlock(project({ name: 'Редизайн' }))).toContain('## Контекст проекта «Редизайн»')
  })

  it('описание возможностей читается человеком', () => {
    expect(describeProjectFeatures({ git: true, ci: false })).toBe('git')
    expect(describeProjectFeatures({ git: false })).toBe('нет (только доска и задачи)')
  })
})
