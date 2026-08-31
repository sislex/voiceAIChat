// Фикстуры панели кода: рабочая копия задачи, состояние git, ветки и файлы.
// Типы — из `@shared`, поэтому новое обязательное поле контракта ловит `tsc`, а не
// глаз при чтении сториз.
import type {
  GitBranchList, GitFileChange, GitFileContent, GitFileDiff, GitTreeListing,
  GitWorkspaceRef, GitWorkspaceStatus
} from '@shared/gitWorkspace'
import { T0 } from './chat'

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

export function makeGitWorkspace(over: Partial<GitWorkspaceRef> = {}): GitWorkspaceRef {
  return {
    id: 'ws:ws-1',
    kind: 'task-workspace',
    projectId: 'p1',
    taskId: 't1',
    taskTitle: 'Панель кода: ветки, diff и коммит',
    taskSeq: 42,
    conversationId: null,
    agentId: 'm1',
    machineName: 'MacBook',
    path: '/srv/ChatAI/projects/p1/tasks/42',
    expectedBranch: 'CHAT-42',
    expectedSha: SHA,
    pushed: false,
    online: true,
    writable: true,
    readOnlyReason: null,
    busy: null,
    released: false,
    ...over
  }
}

export function makeGitChange(over: Partial<GitFileChange> = {}): GitFileChange {
  return { path: 'apps/server/src/index.ts', oldPath: null, state: 'modified', staged: false, worktree: true, ...over }
}

export function makeGitStatus(over: Partial<GitWorkspaceStatus> = {}): GitWorkspaceStatus {
  return {
    ref: makeGitWorkspace(),
    problem: null,
    detail: null,
    gitUrl: 'https://github.com/example/chatai.git',
    baseBranch: 'main',
    branch: 'CHAT-42',
    detached: false,
    head: SHA,
    upstream: 'origin/CHAT-42',
    ahead: 1,
    behind: 0,
    changes: [
      makeGitChange(),
      makeGitChange({ path: 'packages/ui/src/components/git/GitPane.tsx', state: 'untracked', worktree: false }),
      makeGitChange({ path: 'docs/kb/ui.md', state: 'modified', staged: true, worktree: false })
    ],
    changesTruncated: false,
    commitsAhead: [
      { sha: SHA, subject: 'feat(git): панель кода рабочей копии', author: 'bob', at: Math.floor(T0 / 1000) }
    ],
    ...over
  }
}

export function makeGitBranches(over: Partial<GitBranchList> = {}): GitBranchList {
  return {
    current: 'CHAT-42',
    branches: [
      { name: 'CHAT-42', remote: false, sha: SHA, upstream: 'origin/CHAT-42', ahead: 1, behind: 0, lastCommitAt: Math.floor(T0 / 1000), subject: 'feat(git): панель кода' },
      { name: 'main', remote: false, sha: 'b'.repeat(40), upstream: 'origin/main', ahead: 0, behind: 3, lastCommitAt: Math.floor(T0 / 1000) - 3600, subject: 'chore: слияние' },
      { name: 'origin/CHAT-41', remote: true, sha: 'c'.repeat(40), upstream: null, ahead: 0, behind: 0, lastCommitAt: Math.floor(T0 / 1000) - 7200, subject: 'fix: карточка задачи' }
    ],
    fetchedAt: null,
    ...over
  }
}

export function makeGitFile(over: Partial<GitFileContent> = {}): GitFileContent {
  return {
    path: 'apps/server/src/index.ts',
    ref: null,
    content: "import { buildServer } from './server.js'\n\nconst app = await buildServer()\nawait app.listen({ port: 8787 })\n",
    size: 120,
    truncated: false,
    binary: false,
    ...over
  }
}

export function makeGitDiff(over: Partial<GitFileDiff> = {}): GitFileDiff {
  return {
    path: 'apps/server/src/index.ts',
    oldPath: null,
    state: 'modified',
    original: makeGitFile({ ref: 'HEAD', content: "import { buildServer } from './server.js'\n\nconst app = await buildServer()\nawait app.listen({ port: 8080 })\n" }),
    modified: makeGitFile(),
    ...over
  }
}

export function makeGitTree(over: Partial<GitTreeListing> = {}): GitTreeListing {
  return {
    ref: 'HEAD',
    dir: '',
    entries: [
      { name: 'apps', path: 'apps', kind: 'dir', size: null },
      { name: 'packages', path: 'packages', kind: 'dir', size: null },
      { name: 'AGENTS.md', path: 'AGENTS.md', kind: 'file', size: 8123 },
      { name: 'package.json', path: 'package.json', kind: 'file', size: 2048 }
    ],
    ...over
  }
}
