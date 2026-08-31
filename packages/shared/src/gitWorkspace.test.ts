// Выводы git в тестах — не выдуманные: они снимались с живого репозитория
// (`status --porcelain=v1 -z -b`, `for-each-ref`, `ls-tree -l`, `log --format`).
// Именно поэтому здесь есть неочевидные случаи: у переименования в `-z` первым идёт
// НОВЫЙ путь, а пути с пробелами приходят без кавычек.
import { describe, expect, it } from 'vitest'
import {
  buildGitWorkspaceId,
  gitChangeLabel,
  gitChangeShort,
  gitProblemMessage,
  isProtectedGitBranch,
  isSafeRepoRelativePath,
  isValidGitBranchName,
  isValidGitRef,
  normalizeCommitMessage,
  parseAheadBehind,
  parseGitLog,
  parseGitLsTree,
  parseGitRefs,
  parseGitStatusPorcelain,
  parseGitWorkspaceId,
  parseTrackSuffix,
  splitGitSections
} from './gitWorkspace'

describe('parseGitStatusPorcelain', () => {
  it('разбирает заголовок ветки с upstream и отставанием', () => {
    const { head } = parseGitStatusPorcelain('## main...origin/main [ahead 1, behind 2]\0')
    expect(head).toEqual({ branch: 'main', detached: false, upstream: 'origin/main', ahead: 1, behind: 2 })
  })

  it('ветка без upstream и без отставания', () => {
    const { head } = parseGitStatusPorcelain('## main\0')
    expect(head.branch).toBe('main')
    expect(head.upstream).toBeNull()
    expect(head.ahead).toBe(0)
  })

  it('detached HEAD', () => {
    const { head } = parseGitStatusPorcelain('## HEAD (no branch)\0 M a.txt\0')
    expect(head.detached).toBe(true)
    expect(head.branch).toBeNull()
  })

  it('разбирает реальный вывод: правка, переименование и два untracked с пробелом', () => {
    const raw = '## main\0 M keep.txt\0R  new.txt\0old.txt\0?? unt racked2.txt\0?? untracked.txt\0'
    const { changes } = parseGitStatusPorcelain(raw)
    expect(changes).toEqual([
      { path: 'keep.txt', oldPath: null, state: 'modified', staged: false, worktree: true },
      { path: 'new.txt', oldPath: 'old.txt', state: 'renamed', staged: true, worktree: false },
      { path: 'unt racked2.txt', oldPath: null, state: 'untracked', staged: false, worktree: false },
      { path: 'untracked.txt', oldPath: null, state: 'untracked', staged: false, worktree: false }
    ])
  })

  it('кириллица приходит как есть (core.quotepath=false), кавычек нет', () => {
    const { changes } = parseGitStatusPorcelain('## main\0 M с пробелом и кириллицей.txt\0')
    expect(changes[0].path).toBe('с пробелом и кириллицей.txt')
  })

  it('различает staged, unstaged и оба', () => {
    const { changes } = parseGitStatusPorcelain('M  a\0 M b\0MM c\0')
    expect(changes.map((c) => [c.staged, c.worktree])).toEqual([[true, false], [false, true], [true, true]])
  })

  it('конфликты и удаления', () => {
    const { changes } = parseGitStatusPorcelain('UU a\0AA b\0DD c\0D  d\0 D e\0A  f\0T  g\0')
    expect(changes.map((c) => c.state)).toEqual(['conflict', 'conflict', 'conflict', 'deleted', 'deleted', 'added', 'typechange'])
  })

  it('обрезает список по лимиту и говорит об этом', () => {
    const raw = '## main\0' + Array.from({ length: 5 }, (_, i) => ` M f${i}\0`).join('')
    const result = parseGitStatusPorcelain(raw, 3)
    expect(result.changes).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })

  it('пустой вывод — не ошибка', () => {
    expect(parseGitStatusPorcelain('')).toEqual({
      head: { branch: null, detached: false, upstream: null, ahead: 0, behind: 0 },
      changes: [],
      truncated: false
    })
  })
})

describe('parseGitRefs', () => {
  const raw = [
    'main\tcfdc6bf0e6411bddd682c6bd7186b536449721dc\torigin/main\t1788172791\t[ahead 1]\tahead',
    'origin/main\tb11faf10985ddee922203f5ea1bac902a853484e\t\t1788172777\t\tinit',
    'origin/HEAD\tb11faf10985ddee922203f5ea1bac902a853484e\t\t1788172777\t\tinit'
  ].join('\n')

  it('разбирает локальные и удалённые ветки одной командой', () => {
    const branches = parseGitRefs(raw)
    expect(branches).toHaveLength(2)
    expect(branches[0]).toEqual({
      name: 'main',
      remote: false,
      sha: 'cfdc6bf0e6411bddd682c6bd7186b536449721dc',
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
      lastCommitAt: 1788172791,
      subject: 'ahead'
    })
    expect(branches[1].remote).toBe(true)
    expect(branches[1].upstream).toBeNull()
  })

  it('origin/HEAD выбрасывается: это не ветка, а указатель', () => {
    expect(parseGitRefs(raw).some((b) => b.name === 'origin/HEAD')).toBe(false)
  })

  it('тема коммита с табуляцией не рвётся', () => {
    const branches = parseGitRefs('main\tabc1234\t\t0\t\tfix:\tтабуляция внутри темы')
    expect(branches[0].subject).toBe('fix:\tтабуляция внутри темы')
    expect(branches[0].lastCommitAt).toBeNull()
  })
})

describe('parseGitLsTree', () => {
  const raw = [
    '100644 blob acc3f37d21fe2d841c2e8d5c31000399c71c2dba       6\tahead.txt',
    '040000 tree 1111111111111111111111111111111111111111       -\tsrc',
    '100644 blob 975fbec8256d3e8a3797e7a3611380f27c49f4ac       2\tunt racked2.txt'
  ].join('\n')

  it('каталоги идут первыми, размер каталога — null', () => {
    const entries = parseGitLsTree(raw)
    expect(entries.map((e) => [e.name, e.kind, e.size])).toEqual([
      ['src', 'dir', null],
      ['ahead.txt', 'file', 6],
      ['unt racked2.txt', 'file', 2]
    ])
  })

  it('в подкаталоге имя берётся без префикса', () => {
    const entries = parseGitLsTree('100644 blob abc       10\tapps/server/index.ts', 'apps/server')
    expect(entries[0]).toEqual({ name: 'index.ts', path: 'apps/server/index.ts', kind: 'file', size: 10 })
  })

  it('чужие строки (submodule, мусор) отбрасываются', () => {
    expect(parseGitLsTree('160000 commit abc\tvendor\nмусор')).toEqual([])
  })
})

describe('parseGitLog', () => {
  it('разбирает формат %H\\t%an\\t%at\\t%s', () => {
    const raw = 'cfdc6bf0e6411bddd682c6bd7186b536449721dc\tt\t1788172791\tahead\nb11faf10985ddee922203f5ea1bac902a853484e\tt\t1788172777\tinit'
    expect(parseGitLog(raw)).toEqual([
      { sha: 'cfdc6bf0e6411bddd682c6bd7186b536449721dc', author: 't', at: 1788172791, subject: 'ahead' },
      { sha: 'b11faf10985ddee922203f5ea1bac902a853484e', author: 't', at: 1788172777, subject: 'init' }
    ])
  })

  it('строки без sha не попадают в результат', () => {
    expect(parseGitLog('fatal: your current branch does not have any commits yet')).toEqual([])
  })
})

describe('parseAheadBehind и parseTrackSuffix', () => {
  it('rev-list --left-right --count даёт ahead и behind', () => {
    expect(parseAheadBehind('1\t0')).toEqual({ ahead: 1, behind: 0 })
    expect(parseAheadBehind('3\t7\n')).toEqual({ ahead: 3, behind: 7 })
  })

  it('без upstream команда падает — считаем нулями', () => {
    expect(parseAheadBehind("fatal: no upstream configured for branch 'main'")).toEqual({ ahead: 0, behind: 0 })
  })

  it('суффикс отслеживания', () => {
    expect(parseTrackSuffix('ahead 2, behind 5')).toEqual({ ahead: 2, behind: 5 })
    expect(parseTrackSuffix('gone')).toEqual({ ahead: 0, behind: 0 })
  })
})

describe('splitGitSections', () => {
  it('делит составной вывод по маркерам и игнорирует посторонние строки', () => {
    const raw = 'warning: что-то от git\n==VC:head==\nmain\nabc123\n==VC:status==\n M a.txt\n'
    expect(splitGitSections(raw)).toEqual({ head: 'main\nabc123', status: ' M a.txt\n' })
  })

  it('имя секции может содержать цифры и подчёркивание: status_b64, content_b64', () => {
    const raw = '==VC:status_b64==\nQUJD\n==VC:content_b64==\nWFla\n==VC:done==\n'
    expect(splitGitSections(raw)).toEqual({ status_b64: 'QUJD', content_b64: 'WFla', done: '' })
  })

  it('маркер не содержит `>`: иначе политика машины без allowWrite запретит команду', () => {
    const marks = Object.keys(splitGitSections('==VC:one==\nx\n'))
    expect(marks).toEqual(['one'])
    expect('==VC:one==').not.toContain('>')
  })
})

describe('валидаторы', () => {
  it('имя ветки: допускаем обычные, отбиваем опасные', () => {
    for (const ok of ['main', 'feature/CHAT-181', 'fix_1.2', 'release/0.1.180']) {
      expect(isValidGitBranchName(ok), ok).toBe(true)
    }
    for (const bad of ['', '-force', '/leading', 'trailing/', 'a..b', 'a//b', 'ветка', 'a b', 'x.lock', 'a;rm -rf /', 'a$(id)', 'a'.repeat(201)]) {
      expect(isValidGitBranchName(bad), bad).toBe(false)
    }
  })

  it('ревизия допускает ~ и ^, но не `..`', () => {
    expect(isValidGitRef('HEAD~1')).toBe(true)
    expect(isValidGitRef('origin/main')).toBe(true)
    expect(isValidGitRef('HEAD^')).toBe(true)
    expect(isValidGitRef('a..b')).toBe(false)
    expect(isValidGitRef('--upload-pack=x')).toBe(false)
  })

  it('путь внутри репозитория: без выхода наружу и без .git', () => {
    for (const ok of ['a.txt', 'apps/server/src/index.ts', 'с кириллицей.md', 'a b/c d.txt']) {
      expect(isSafeRepoRelativePath(ok), ok).toBe(true)
    }
    for (const bad of ['', '/etc/passwd', 'C:\\win', '../../etc/passwd', 'a/../b', './a', 'a//b', '.git/config', 'a\\b', 'a\nb', 'x'.repeat(401)]) {
      expect(isSafeRepoRelativePath(bad), bad).toBe(false)
    }
  })

  it('сообщение коммита нормализуется, пустое и гигантское — отвергаются', () => {
    expect(normalizeCommitMessage('  fix: правка\r\nвторая строка  ')).toBe('fix: правка\nвторая строка')
    expect(normalizeCommitMessage('   ')).toBeNull()
    expect(normalizeCommitMessage('x'.repeat(4001))).toBeNull()
  })

  it('защищённые ветки: в них панель не пушит', () => {
    expect(isProtectedGitBranch('main')).toBe(true)
    expect(isProtectedGitBranch('master')).toBe(true)
    expect(isProtectedGitBranch('release/0.1.180')).toBe(true)
    expect(isProtectedGitBranch('feature/CHAT-181')).toBe(false)
  })
})

describe('id рабочей копии', () => {
  it('round-trip всех видов', () => {
    const refs = [
      { kind: 'ci-workspace' as const, ciWorkspaceId: 'ws-1' },
      { kind: 'task-repository' as const, taskRepositoryId: 'repo-1' },
      { kind: 'conversation' as const, conversationId: 'conv-1' },
      { kind: 'project-machine' as const, agentId: 'agent-1' }
    ]
    for (const ref of refs) expect(parseGitWorkspaceId(buildGitWorkspaceId(ref))).toEqual(ref)
  })

  it('id с двоеточием внутри значения не теряется', () => {
    expect(parseGitWorkspaceId('chat:a:b')).toEqual({ kind: 'conversation', conversationId: 'a:b' })
  })

  it('формы «произвольный путь на машине» нет: такой id не парсится', () => {
    for (const bad of ['machine:agent-1:/etc', 'path:/etc/passwd', '', 'ws', ':ws-1', 'ws:', 'unknown:x']) {
      expect(parseGitWorkspaceId(bad), bad).toBeNull()
    }
  })
})

describe('подписи', () => {
  it('у каждого состояния есть текст и короткий маркер', () => {
    for (const state of ['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflict', 'typechange'] as const) {
      expect(gitChangeLabel(state)).not.toBe('')
      expect(gitChangeShort(state)).not.toBe('')
    }
  })

  it('у каждой проблемы есть объяснение', () => {
    for (const problem of ['workspace_not_found', 'machine_missing', 'machine_offline', 'path_missing', 'not_a_repository', 'workspace_released', 'workspace_busy'] as const) {
      expect(gitProblemMessage(problem)).not.toBe('')
    }
  })
})
