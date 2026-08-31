// Витрина панели кода: состояния, которые в живом приложении надо ловить ранами и
// офлайн-машинами. Данных из сети нет — панель получает `api` пропом, и здесь это
// фейк на тех же фикстурах, что в dom-тестах.
import type { Meta, StoryObj } from '@storybook/react'
import { userEvent, within } from '@storybook/test'
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
  'projects:gitPull': async () => ({ status, mode: 'rebase' as const, pulled: 2 }),
  'projects:gitDiscard': async () => ({ status, reverted: 1, removed: 0 }),
  'projects:gitBranchChanges': async () => ({
    base: 'e'.repeat(40),
    changes: [
      { path: 'apps/server/src/git/scripts.ts', oldPath: null, state: 'added' as const, staged: true, worktree: false },
      { path: 'packages/shared/src/gitWorkspace.ts', oldPath: null, state: 'added' as const, staged: true, worktree: false },
      { path: 'docs/kb/ui.md', oldPath: null, state: 'modified' as const, staged: true, worktree: false }
    ],
    truncated: false
  }),
  'projects:gitStage': async () => status,
  'projects:gitLog': async () => ({ commits: status.commitsAhead }),
  'projects:gitCommitDetail': async ({ sha }) => ({
    sha, subject: 'feat(git): панель кода', author: 'bob', at: 1788172791,
    files: [{ path: 'apps/server/src/index.ts', oldPath: null, state: 'modified' as const }],
    truncated: false
  }),
  'projects:gitGrep': async ({ query }) => ({
    query,
    matches: [
      { path: 'apps/server/src/index.ts', line: 3, text: 'const app = await buildServer()' },
      { path: 'packages/ui/src/App.tsx', line: 128, text: 'const GitPane = lazy(async () => {' }
    ],
    truncated: false
  }),
  'projects:gitFileBytes': async ({ path }) => ({ path, dataBase64: 'YQ==', size: 1 }),
  'projects:gitConflict': async ({ path }) => ({
    path,
    base: { path, ref: ':1:', content: 'общий предок\nстрока два\n', size: 24, truncated: false, binary: false },
    ours: { path, ref: ':2:', content: 'наша версия\nстрока два\n', size: 22, truncated: false, binary: false },
    theirs: { path, ref: ':3:', content: 'их версия\nстрока два\n', size: 20, truncated: false, binary: false }
  }),
  'projects:gitResolveConflict': async () => status,
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

/** Роль без `repository:write`: смотреть можно, кнопки записи объясняют отказ. */
export const RoleWithoutWriteAccess: Story = {
  args: {
    api: api(makeGitStatus({
      ref: makeGitWorkspace({ writable: false, readOnlyReason: 'Ваша роль не позволяет менять рабочую копию' })
    }))
  }
}

/** Ветка отстала от origin: появляется «Подтянуть», на грязном дереве — выключенная. */
export const BehindOrigin: Story = { args: { api: api(makeGitStatus({ behind: 3, ahead: 1 })) } }

/** Отстала и дерево чистое — подтянуть можно сразу. */
export const BehindOriginClean: Story = { args: { api: api(makeGitStatus({ behind: 3, ahead: 0, changes: [] })) } }

/** Изменения ветки против общего предка: главный вид, когда ревьюют работу модели. */
export const BranchChanges: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('tab', { name: 'Ветка' }))
  }
}

/** Поиск: имя фильтруется на месте, содержимое ищет git grep. */
export const Search: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('tab', { name: 'Поиск' }))
    await userEvent.type(await canvas.findByLabelText('Поиск по файлам и содержимому'), 'buildServer')
    await userEvent.click(canvas.getByRole('button', { name: 'Искать' }))
  }
}

/** Конфликт слияния: наша версия против их, общий предок — по требованию. */
export const Conflict: Story = {
  args: {
    api: api(makeGitStatus({
      changes: [{ path: 'apps/server/src/git/scripts.ts', oldPath: null, state: 'conflict', staged: false, worktree: true }]
    }))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByText('apps/server/src/git/scripts.ts'))
    await userEvent.click(await canvas.findByRole('tab', { name: 'Конфликт' }))
  }
}
