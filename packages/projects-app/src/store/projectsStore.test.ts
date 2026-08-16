import type { Board, ProjectDetail, ProjectSummary } from '@shared/projects'
import type { ProjectsClient } from '../contracts'
import { createProjectsStore } from './projectsStore'

const project = (id: string): ProjectSummary => ({
  id, name: id, description: '', gitUrl: null, technologies: [], skills: [],
  defaultSkills: { epic: [], story: [], task: [] }, createdBy: 'u', createdAt: 1, updatedAt: 1,
  role: 'owner', commitPolicy: 'agent_commits', mergeTransport: 'local',
  agentPlanApprovalMode: 'manual'
})
const board = (projectId = 'p1'): Board => ({
  columns: [
    { id: 'todo', projectId, name: 'Todo', semanticType: 'backlog', position: 0, hidden: false, wipLimit: null, createdAt: 1 },
    { id: 'done', projectId, name: 'Done', semanticType: 'done', position: 1024, hidden: false, wipLimit: null, createdAt: 1 }
  ],
  tasks: [{
    id: 't1', projectId, columnId: 'todo', type: 'task', parentId: null, title: 'T', description: '',
    acceptanceCriteria: '', priority: 'medium', assignee: null, labels: [], skills: [], storyPoints: null,
    dueDate: null, flagged: false, seq: 1, position: 1024, createdAt: 1, updatedAt: 1
  }]
})
function fake(overrides: Partial<ProjectsClient> = {}): ProjectsClient {
  const detail = { ...project('p1'), members: [], machines: [], defaultAgentId: null } as ProjectDetail
  return {
    listProjects: vi.fn(async () => [project('p1')]), getProject: vi.fn(async () => detail),
    createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(),
    getBoard: vi.fn(async () => board()), subscribeBoard: vi.fn(() => vi.fn()),
    createColumn: vi.fn(), updateColumn: vi.fn(), deleteColumn: vi.fn(), reorderColumns: vi.fn(),
    createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), moveTask: vi.fn(),
    ensureTaskChat: vi.fn(), openTaskChat: vi.fn(), ...overrides
  } as ProjectsClient
}
describe('projects store', () => {
  it('owns loading and disposes its board subscription', async () => {
    const unsubscribe = vi.fn()
    const client = fake({ subscribeBoard: vi.fn(() => unsubscribe) })
    const store = createProjectsStore(client)
    await store.actions.loadProjects()
    await store.actions.openProject('p1')
    expect(store.getState().board?.tasks).toHaveLength(1)
    store.actions.closeProject()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it('drops a stale project response after switching projects', async () => {
    let resolve!: (value: ProjectDetail) => void
    const slow = new Promise<ProjectDetail>((done) => { resolve = done })
    const client = fake({
      getProject: vi.fn((id) => id === 'p1' ? slow : Promise.resolve({ ...project('p2'), members: [], machines: [], defaultAgentId: null })),
      getBoard: vi.fn(async (id) => board(id))
    })
    const store = createProjectsStore(client)
    const first = store.actions.openProject('p1')
    await store.actions.openProject('p2')
    resolve({ ...project('p1'), members: [], machines: [], defaultAgentId: null })
    await first
    expect(store.getState().activeProjectId).toBe('p2')
    expect(store.getState().projectDetail?.id).toBe('p2')
  })
  it('moves optimistically and ignores events from another project', async () => {
    let listener: ((event: { projectId: string; board: Board }) => void) | undefined
    const client = fake({ subscribeBoard: vi.fn((_id, next) => { listener = next; return vi.fn() }) })
    const store = createProjectsStore(client)
    await store.actions.openProject('p1')
    const promise = store.actions.moveTask('t1', 'done')
    expect(store.getState().board?.tasks[0]?.columnId).toBe('done')
    await promise
    listener?.({ projectId: 'p2', board: board('p2') })
    expect(store.getState().board?.tasks[0]?.projectId).toBe('p1')
  })
  it('rolls back and reconciles after a failed optimistic reorder', async () => {
    const client = fake({ reorderColumns: vi.fn(async () => { throw new Error('no') }) })
    const store = createProjectsStore(client)
    await store.actions.openProject('p1')
    await store.actions.reorderColumns(['done', 'todo'])
    expect(client.getBoard).toHaveBeenCalledTimes(2)
    expect(store.getState().board?.columns[0]?.id).toBe('todo')
  })
})
