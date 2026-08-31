// Витрина точки входа в раздел «Код»: какие рабочие копии бывают и как читается
// строка, когда машина офлайн или каталог занят раном.
import type { Meta, StoryObj } from '@storybook/react'
import { makeGitWorkspace } from '../../test/fixtures/git'
import { GitWorkspaceList } from './GitWorkspaceList'

const meta: Meta<typeof GitWorkspaceList> = {
  title: 'Git/GitWorkspaceList',
  component: GitWorkspaceList,
  parameters: { layout: 'fullscreen' },
  args: {
    status: 'ready',
    error: null,
    onOpen: () => {},
    onRetry: () => {},
    workspaces: [
      makeGitWorkspace(),
      makeGitWorkspace({
        id: 'ws:ws-2', taskId: 't2', taskSeq: 41, taskTitle: 'Карточка задачи: вкладки',
        expectedBranch: 'CHAT-41', pushed: true, busy: { kind: 'ci', runId: 'run-3', status: 'running' }
      }),
      makeGitWorkspace({
        id: 'repo:repo-1', kind: 'merge-clone', taskSeq: 40, taskTitle: 'Слияние ветки',
        path: '/srv/ChatAI/projects/p1/merge-clones/repository', writable: false, pushed: null, expectedBranch: null
      }),
      makeGitWorkspace({
        id: 'chat:conv-1', kind: 'chat-workspace', taskId: null, taskSeq: null, taskTitle: 'Разбор логов прода',
        conversationId: 'conv-1', path: '/srv/ChatAI/projects/p1/chats/conv-1/workspace/repository',
        expectedBranch: null, pushed: null
      }),
      makeGitWorkspace({
        id: 'project:m2', kind: 'project-worktree', taskId: null, taskSeq: null, taskTitle: null,
        machineName: 'Server', path: '/srv/ChatAI/projects/p1/worktree', online: false, expectedBranch: null, pushed: null
      })
    ]
  }
}
export default meta
type Story = StoryObj<typeof GitWorkspaceList>

export const List: Story = {}

/** Ранов ещё не было — копий нет, и текст ведёт к следующему шагу. */
export const Empty: Story = { args: { workspaces: [] } }

export const Loading: Story = { args: { workspaces: [], status: 'loading' } }

export const Failed: Story = { args: { workspaces: [], status: 'error', error: 'HTTP 500: не удалось прочитать список' } }
