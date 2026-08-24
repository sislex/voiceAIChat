import type { RendererApi, RendererBoardBridge } from '@shared/ipc'
import type { ProjectsClient } from '@voicechat/projects-app'

export function createProjectsClient(api: RendererApi, board?: RendererBoardBridge): ProjectsClient {
  return {
    listProjects: () => api['projects:list'](),
    getProject: (projectId) => api['projects:get']({ id: projectId }),
    createProject: (input) => api['projects:create'](input),
    updateProject: (projectId, input) => api['projects:update']({ id: projectId, ...input }),
    deleteProject: (projectId) => api['projects:delete']({ id: projectId }),
    getBoard: (projectId, options) => api['board:get']({ id: projectId, includeCompleted: options?.includeCompleted }),
    subscribeBoard: (projectId, listener) => {
      if (!board) return () => undefined
      const stopChanged = board.onChanged(listener)
      const stopConnected = board.onConnected(() => {
        board.subscribe(projectId)
        listener({ projectId, reason: 'reconnected' })
      })
      board.subscribe(projectId)
      return () => { stopChanged(); stopConnected(); board.unsubscribe() }
    },
    createColumn: (projectId, input) => api['columns:create']({ projectId, name: input.name }),
    updateColumn: async (projectId, columnId, patch) => {
      if (patch.hidden !== undefined) await api['columns:setHidden']({ projectId, columnId, hidden: patch.hidden })
      if (patch.name !== undefined || patch.wipLimit !== undefined) {
        await api['columns:rename']({ projectId, columnId, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.wipLimit !== undefined ? { wipLimit: patch.wipLimit } : {}) })
      }
    },
    deleteColumn: (projectId, columnId) => api['columns:delete']({ projectId, columnId }),
    reorderColumns: (projectId, order) => api['columns:reorder']({ projectId, order }),
    createTask: (projectId, input) => api['tasks:create']({ projectId, columnId: input.columnId ?? '', title: input.title, description: input.description, acceptanceCriteria: input.acceptanceCriteria, type: input.type, parentId: input.parentId, priority: input.priority, assignee: input.assignee, agentId: input.agentId, labels: input.labels, skills: input.skills, storyPoints: input.storyPoints, dueDate: input.dueDate }),
    updateTask: (projectId, taskId, patch) => api['tasks:update']({ projectId, taskId, title: patch.title, description: patch.description, acceptanceCriteria: patch.acceptanceCriteria, type: patch.type, parentId: patch.parentId, priority: patch.priority, assignee: patch.assignee, agentId: patch.agentId, labels: patch.labels, skills: patch.skills, storyPoints: patch.storyPoints, dueDate: patch.dueDate, flagged: patch.flagged }),
    deleteTask: (projectId, taskId) => api['tasks:delete']({ projectId, taskId }),
    moveTask: async (projectId, taskId, columnId, afterId, beforeId) => { await api['tasks:move']({ projectId, taskId, columnId, afterId, beforeId }) },
    ensureTaskChat: async (projectId, taskId) => {
      const conversation = await api['tasks:openChat']({ projectId, taskId })
      return { conversationId: conversation.id }
    },
    openTaskChat: async (projectId, taskId) => {
      const conversation = await api['tasks:openChat']({ projectId, taskId })
      return { conversationId: conversation.id }
    }
  }
}
