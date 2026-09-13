import type { ProjectDetail } from '@shared/projects'
import { BUILTIN_PROJECT_TYPE_IDS, builtinProjectTypeChain } from '@shared/projectTypes'

export function makeSettingsProject(over: Partial<ProjectDetail> = {}): ProjectDetail {
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
