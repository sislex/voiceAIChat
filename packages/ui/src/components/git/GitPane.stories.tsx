// Витрина панели кода: состояния, которые в живом приложении надо ловить ранами и
// офлайн-машинами. Данных из сети нет — панель получает `api` пропом, и здесь это
// фейк на тех же фикстурах, что в dom-тестах.
import type { Meta, StoryObj } from '@storybook/react'
import type { GitWorkspaceStatus } from '@shared/gitWorkspace'
import { makeGitBranches, makeGitDiff, makeGitFile, makeGitStatus, makeGitTree, makeGitWorkspace } from '../../test/fixtures/git'
import { GitPane, type GitPaneApi } from './GitPane'

const api = (status: GitWorkspaceStatus, over: Partial<GitPaneApi> = {}): GitPaneApi => ({
  'projects:gitStatus': async () => status,
  'projects:gitBranches': async () => makeGitBranches(),
  'projects:gitDiff': async ({ path }) => makeGitDiff({ path }),
  'projects:gitTree': async ({ dir }) => ({ ...makeGitTree(), dir }),
  'projects:gitFile': async ({ path }) => makeGitFile({ path }),
  'projects:gitSaveFile': async ({ path, content }) => ({
    file: { path, ref: null, content, size: content.length, truncated: false, binary: false },
    status
  }),
  'projects:gitCheckout': async () => ({ status, createdLocal: false }),
  'projects:gitCreateBranch': async () => ({ status, createdLocal: true }),
  'projects:gitCommit': async () => ({ status: { ...status, changes: [] }, sha: 'd'.repeat(40), staged: 1 }),
  'projects:gitPush': async () => ({ status, branch: status.branch ?? 'CHAT-42', sha: 'd'.repeat(40) }),
  ...over
}) as GitPaneApi

const meta: Meta<typeof GitPane> = {
  title: 'Git/GitPane',
  component: GitPane,
  parameters: { layout: 'fullscreen' },
  args: { projectId: 'p1', workspaceId: 'ws:ws-1', api: api(makeGitStatus()) }
}
export default meta
type Story = StoryObj<typeof GitPane>

/** Обычная работа: ветка задачи, три изменения, есть что коммитить. */
export const Changes: Story = {}

/** Всё закоммичено — следующий CI-ран пройдёт проверку чистого дерева. */
export const Clean: Story = { args: { api: api(makeGitStatus({ changes: [], ahead: 1 })) } }

/** Каталог занят раном: смотреть можно, менять нельзя. */
export const BusyByRun: Story = {
  args: {
    api: api(makeGitStatus({ ref: makeGitWorkspace({ busy: { kind: 'ci', runId: 'run-7', status: 'running' } }) })),
    onOpenRun: () => {}
  }
}

/** Merge-клон: им управляет merge-ран, правки запрещены. */
export const MergeCloneReadOnly: Story = {
  args: { api: api(makeGitStatus({ ref: makeGitWorkspace({ kind: 'merge-clone', writable: false }) })) }
}

/** На main панель не пушит: туда ведут merge-ран и релизы. */
export const ProtectedBranch: Story = { args: { api: api(makeGitStatus({ branch: 'main', ahead: 2 })) } }

/** Detached HEAD: коммитить можно, но видно, что ветки нет. */
export const DetachedHead: Story = { args: { api: api(makeGitStatus({ branch: null, detached: true, ahead: 0 })) } }

/** Каталог снесён cleanup-шагом рана — объяснение и следующий шаг. */
export const WorkspaceReleased: Story = {
  args: { api: api(makeGitStatus({ problem: 'workspace_released', changes: [], ref: makeGitWorkspace({ released: true }) })) }
}

/** Машина офлайн: состояние читается прямо с неё, поэтому его просто нет. */
export const MachineOffline: Story = {
  args: { api: api(makeGitStatus({ problem: 'machine_offline', changes: [], ref: makeGitWorkspace({ online: false }) })) }
}

/** Много изменений: список обрезан сервером, и панель об этом говорит. */
export const TruncatedChanges: Story = {
  args: {
    api: api(makeGitStatus({
      changesTruncated: true,
      changes: Array.from({ length: 12 }, (_, index) => ({
        path: `packages/ui/src/components/file-${index}.tsx`,
        oldPath: null,
        state: index % 4 === 0 ? 'untracked' as const : index % 5 === 0 ? 'conflict' as const : 'modified' as const,
        staged: index % 3 === 0,
        worktree: true
      }))
    }))
  }
}

/** Ошибка чтения состояния: экран не пустой, а с «Повторить». */
export const ReadFailed: Story = {
  args: { api: api(makeGitStatus(), { 'projects:gitStatus': (async () => { throw new Error('Машина не в сети') }) as never }) }
}
