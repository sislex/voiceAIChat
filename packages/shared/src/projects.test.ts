import { describe, it, expect } from 'vitest'
import { canTransitionWorkflow, chatStorageDirectories, compareTasksInColumn, DEFAULT_DONE_RETENTION_DAYS, isCompletedHidden, issueKey, normalizeAcceptanceCriteria, normalizeTaskRunOutcome, projectKey, QA_WORKFLOW, recommendedChatStoragePath, recommendedEnvironmentPath, recommendedPreviewEnvironmentPath, recommendedTaskTestEnvironmentPath, managedChatAttachmentsPath, managedChatArtifactsPath, managedChatTemporaryPath, MANAGED_ENVIRONMENT_DIRECTORIES, validateStorageRelativePath, normalizeMachineStoragePath, isMachineStoragePathAllowed, recommendedMachineStoragePath, managedCiWorkspacePaths, managedPreviewEnvironmentPaths, managedEnvironmentPaths, managedMergeClonePaths, managedChatWorkspacePaths, recommendedProjectMachineDirectories, validateProjectMachineDirectories,
  sanitizeProjectTestUsers,
  designPromptLines, taskMakeSources, type TaskDesignLink
} from './projects'
import { queryWidgetItems } from './widgetAssistant'

const DAY = 24 * 60 * 60 * 1000
const T0 = 1_700_000_000_000

describe('QA workflow semantics', () => {
  it('keeps the canonical sequence independent of display names', () => {
    expect(QA_WORKFLOW).toEqual([
      'backlog', 'preparation', 'ready', 'development', 'component_qa',
      'integration_tests', 'automated_qa', 'manual_qa', 'awaiting_merge', 'merge', 'done'
    ])
  })
  it('requires a user decision to leave decision_required', () => {
    expect(canTransitionWorkflow('decision_required', 'development', 'automation')).toBe(false)
    expect(canTransitionWorkflow('decision_required', 'development', 'user')).toBe(true)
    expect(canTransitionWorkflow('backlog', 'development', 'user')).toBe(false)
    expect(canTransitionWorkflow('awaiting_merge', 'merge', 'automation')).toBe(true)
    expect(canTransitionWorkflow('merge', 'done', 'automation')).toBe(true)
    expect(canTransitionWorkflow('awaiting_merge', 'done', 'automation')).toBe(false)
  })
})

describe('normalizeTaskRunOutcome', () => {
  it.each(['failed', 'blocked', 'timeout', 'gate_failed', 'interrupted', 'decision_required'])(`%s является ошибкой`, (status) => {
    expect(normalizeTaskRunOutcome(status)).toBe('failure')
  })

  it.each(['queued', 'running', 'awaiting_input', 'waiting_for_answer', 'validating'])(`%s заменяет старую ошибку активным процессом`, (status) => {
    expect(normalizeTaskRunOutcome(status)).toBe('active')
  })

  it.each([['success', 'success'], ['passed', 'success'], ['completed', 'success'], ['skipped', 'skipped'], ['stale', 'skipped'], ['cancelled', 'cancelled']] as const)(`%s нормализуется в %s`, (status, outcome) => {
    expect(normalizeTaskRunOutcome(status)).toBe(outcome)
  })
})

describe('normalizeAcceptanceCriteria', () => {
  it('нумерует непустые абзацы и нормализует старые номера', () => {
    expect(normalizeAcceptanceCriteria('Первый\n\n7. Второй\n7) Третий')).toBe(
      '1. Первый\n2. Второй\n3. Третий'
    )
  })

  it('идемпотентна и не превращает вложенное Markdown-содержимое в критерии', () => {
    const markdown = [
      '1. Критерий со справкой',
      '   - вложенный пункт',
      '   > цитата',
      '   ```ts',
      '   const ok = true',
      '   ```',
      '2. Следующий'
    ].join('\n')
    expect(normalizeAcceptanceCriteria(markdown)).toBe(markdown)
    expect(normalizeAcceptanceCriteria(normalizeAcceptanceCriteria(markdown))).toBe(markdown)
  })

  it('убирает номера и checkbox-маркеры из вставленного текста', () => {
    expect(normalizeAcceptanceCriteria('1. 4. Первый\n- [ ] Второй')).toBe('1. Первый\n2. Второй')
  })
})

describe('isCompletedHidden — когда завершённая задача уходит с доски', () => {
  it('незавершённая задача не скрывается никогда', () => {
    expect(isCompletedHidden(null, 0, T0)).toBe(false)
    expect(isCompletedHidden(undefined, 14, T0 + 999 * DAY)).toBe(false)
  })

  it('пустой порог — не скрывать', () => {
    expect(isCompletedHidden(T0, null, T0 + 999 * DAY)).toBe(false)
    expect(isCompletedHidden(T0, undefined, T0 + 999 * DAY)).toBe(false)
  })

  it('порог 0 — убрать в конце дня, а не в ту же секунду', () => {
    // Карточку в «Готово» переносит и CI-раннер после успешного мержа: исчезнуть
    // мгновенно она не имеет права — иначе работа пропадает с доски без следа.
    const endOfDay = new Date(T0).setHours(24, 0, 0, 0)
    expect(isCompletedHidden(T0, 0, T0)).toBe(false)
    expect(isCompletedHidden(T0, 0, endOfDay - 1)).toBe(false)
    expect(isCompletedHidden(T0, 0, endOfDay)).toBe(true)
  })

  it('дефолтные 14 дней: на 13-й день видна, на 14-й уже нет', () => {
    expect(DEFAULT_DONE_RETENTION_DAYS).toBe(14)
    expect(isCompletedHidden(T0, DEFAULT_DONE_RETENTION_DAYS, T0 + 13 * DAY)).toBe(false)
    expect(isCompletedHidden(T0, DEFAULT_DONE_RETENTION_DAYS, T0 + 14 * DAY)).toBe(true)
  })

  it('мусорный порог читается как «не скрывать»', () => {
    expect(isCompletedHidden(T0, Number.NaN, T0 + 999 * DAY)).toBe(false)
    expect(isCompletedHidden(T0, -1, T0 + 999 * DAY)).toBe(false)
  })
})

describe('порядок задач в колонке', () => {
  const task = (id: string, doneAt: number | null, position: number) => ({ id, doneAt, position, createdAt: 1 })

  it('в done сортирует по времени входа, а fallback без метки стабилен', () => {
    expect([
      task('old', 10, 1024),
      task('new', 20, 2048),
      task('legacy-b', null, 2048),
      task('legacy-a', null, 1024)
    ].sort((a, b) => compareTasksInColumn(a, b, 'done')).map((item) => item.id))
      .toEqual(['new', 'old', 'legacy-a', 'legacy-b'])
  })

  it('в development сортирует по убыванию приоритета и стабильно сохраняет ручной порядок', () => {
    const withPriority = (id: string, priority: 'low' | 'medium' | 'high' | 'urgent', position: number) =>
      ({ ...task(id, null, position), priority })
    expect([
      withPriority('low', 'low', 1024),
      withPriority('high-late', 'high', 2048),
      withPriority('urgent', 'urgent', 4096),
      withPriority('high-early', 'high', 1024)
    ].sort((a, b) => compareTasksInColumn(a, b, 'development')).map((item) => item.id))
      .toEqual(['urgent', 'high-early', 'high-late', 'low'])
  })

  it('в остальных колонках сохраняет ручной порядок', () => {
    expect([task('late', 20, 2048), task('early', 10, 1024)]
      .sort((a, b) => compareTasksInColumn(a, b, 'testing')).map((item) => item.id))
      .toEqual(['early', 'late'])
  })
})

describe('ключ задачи', () => {
  it('строится из имени проекта и номера', () => {
    expect(projectKey('Voice Chat')).toBe('VC')
    expect(issueKey('Voice Chat', { seq: 42 })).toBe('VC-42')
  })
})

describe('portable storage paths', () => {
  it('builds isolated paths for all chat and environment contexts', () => {
    expect(recommendedChatStoragePath({ kind: 'chat', conversationId: 'c-1' })).toBe('chats/c-1')
    expect(recommendedChatStoragePath({ kind: 'project', projectId: 'p-1', conversationId: 'c-1' })).toBe('projects/p-1/chats/c-1')
    expect(recommendedChatStoragePath({ kind: 'task', projectId: 'p-1', taskId: 't-1', conversationId: 'c-1' })).toBe('projects/p-1/tasks/t-1/chats/c-1')
    expect(recommendedEnvironmentPath('p-1', 'production')).toBe('projects/p-1/environments/production')
    expect(recommendedTaskTestEnvironmentPath('p-1', 't-1')).toBe('projects/p-1/tasks/t-1/environments/test')
    expect(recommendedPreviewEnvironmentPath('p-1', 't-1', 'pr-1')).toBe('projects/p-1/tasks/t-1/environments/preview/pr-1')
    expect(managedChatAttachmentsPath('chats/c-1')).toBe('chats/c-1/attachments')
    expect(managedChatArtifactsPath('chats/c-1')).toBe('chats/c-1/artifacts')
    expect(managedChatTemporaryPath('chats/c-1')).toBe('chats/c-1/.generated')
    expect(MANAGED_ENVIRONMENT_DIRECTORIES).toEqual(['app', 'config', 'logs', 'artifacts', 'temporary/repository'])
  })

  it('builds canonical absolute managed preview paths for POSIX and Windows', () => {
    expect(managedPreviewEnvironmentPaths('/storage', 'p1', 't1', 'pr1', 'linux')).toEqual({
      previewRoot: '/storage/projects/p1/tasks/t1/environments/preview/pr1',
      app: '/storage/projects/p1/tasks/t1/environments/preview/pr1/app',
      config: '/storage/projects/p1/tasks/t1/environments/preview/pr1/config',
      logs: '/storage/projects/p1/tasks/t1/environments/preview/pr1/logs',
      artifacts: '/storage/projects/p1/tasks/t1/environments/preview/pr1/artifacts',
      temporary: '/storage/projects/p1/tasks/t1/environments/preview/pr1/temporary',
      repository: '/storage/projects/p1/tasks/t1/environments/preview/pr1/temporary/repository',
      manifest: '/storage/projects/p1/tasks/t1/environments/preview/pr1/environment.json'
    })
    expect(managedPreviewEnvironmentPaths('C:\\VoiceChat', 'p1', 't1', 'pr1', 'win32').repository)
      .toBe('C:\\VoiceChat\\projects\\p1\\tasks\\t1\\environments\\preview\\pr1\\temporary\\repository')
  })

  it('builds isolated managed chat workspace paths', () => {
    expect(managedChatWorkspacePaths('/storage', 'p-1', 'c-1', 'linux')).toEqual({
      root: '/storage/projects/p-1/chats/c-1/workspace',
      repository: '/storage/projects/p-1/chats/c-1/workspace/repository',
      manifest: '/storage/projects/p-1/chats/c-1/workspace/workspace.json'
    })
    expect(managedChatWorkspacePaths('C:\\Storage', 'p-1', 'c-1', 'win32').repository)
      .toBe('C:\\Storage\\projects\\p-1\\chats\\c-1\\workspace\\repository')
    expect(() => managedChatWorkspacePaths('/storage', '../escape', 'c-1', 'linux')).toThrow(/safe relative path/)
  })

  it('rejects absolute paths and traversal', () => {
    expect(() => validateStorageRelativePath('/etc/passwd')).toThrow()
    expect(() => validateStorageRelativePath('chats/../secret')).toThrow()
  })
})

describe('machine storage root paths', () => {
  it('normalizes POSIX, Windows, UNC and MSYS paths', () => {
    expect(normalizeMachineStoragePath('/Users/me/ChatAI/', 'darwin')).toBe('/Users/me/ChatAI')
    expect(normalizeMachineStoragePath('c:/Users/me/ChatAI/', 'win32')).toBe('C:\\Users\\me\\ChatAI')
    expect(normalizeMachineStoragePath('/c/Users/me/ChatAI', 'win32')).toBe('C:\\Users\\me\\ChatAI')
    expect(normalizeMachineStoragePath('\\\\server\\share\\ChatAI', 'win32')).toBe('\\\\server\\share\\ChatAI')
  })

  it('builds managed CI paths without mixing platform separators', () => {
    const cases = [
      ['/data/ChatAI', '/data/ChatAI/projects/p1/tasks/t1/environments/test/temporary/repository/P-1'],
      ['/data/data/com.termux/files/home/ChatAI', '/data/data/com.termux/files/home/ChatAI/projects/p1/tasks/t1/environments/test/temporary/repository/P-1'],
      ['/Users/me/ChatAI', '/Users/me/ChatAI/projects/p1/tasks/t1/environments/test/temporary/repository/P-1'],
      ['C:\\Users\\me\\ChatAI', 'C:\\Users\\me\\ChatAI\\projects\\p1\\tasks\\t1\\environments\\test\\temporary\\repository\\P-1'],
      ['\\\\server\\share\\ChatAI', '\\\\server\\share\\ChatAI\\projects\\p1\\tasks\\t1\\environments\\test\\temporary\\repository\\P-1'],
      ['/c/Users/me/ChatAI', '/c/Users/me/ChatAI/projects/p1/tasks/t1/environments/test/temporary/repository/P-1']
    ] as const
    for (const [root, expectedWorkspace] of cases) {
      const paths = managedCiWorkspacePaths(root, 'p1', 't1', 'P-1')
      expect(paths.workspace).toBe(expectedWorkspace)
      expect(paths.repository).toBe(expectedWorkspace.replace(/[\\\\/]P-1$/, ''))
      expect(paths.npmCacheDir).toContain('.npm-cache')
    }
  })

  it('rejects roots, relative and non-normalized paths and enforces allowedDirs boundaries', () => {
    expect(() => normalizeMachineStoragePath('/', 'linux')).toThrow(/Корень/)
    expect(() => normalizeMachineStoragePath('C:\\', 'win32')).toThrow(/Корень/)
    expect(() => normalizeMachineStoragePath('/safe/../escape', 'linux')).toThrow(/нормализован/)
    expect(isMachineStoragePathAllowed('/safe/ChatAI', ['/safe'], 'linux')).toBe(true)
    expect(isMachineStoragePathAllowed('/safety/ChatAI', ['/safe'], 'linux')).toBe(false)
  })

  it('builds the platform recommendation from the reported home directory', () => {
    expect(recommendedMachineStoragePath('darwin', '/Users/me')).toBe('/Users/me/ChatAI')
    expect(recommendedMachineStoragePath('win32', 'C:\\Users\\me')).toBe('C:\\Users\\me\\ChatAI')
  })

  it.each([
    ['linux', '/home/u/ChatAI', '/home/u/ChatAI/projects/p-1/worktree'],
    ['android', '/data/data/com.termux/files/home/ChatAI', '/data/data/com.termux/files/home/ChatAI/projects/p-1/worktree'],
    ['darwin', '/Users/u/ChatAI', '/Users/u/ChatAI/projects/p-1/worktree'],
    ['win32', 'C:\\Users\\u\\ChatAI', 'C:\\Users\\u\\ChatAI\\projects\\p-1\\worktree']
  ])('builds all project assignments for %s', (platform, root, expected) => {
    const paths = recommendedProjectMachineDirectories(root, 'p-1', platform)
    expect(paths.projectWorkdir).toBe(expected)
    expect(new Set(Object.values(paths)).size).toBe(7)
  })

  it('preserves explicit overrides and rejects managed tampering and conflicts', () => {
    const paths = recommendedProjectMachineDirectories('/srv/ChatAI', 'p-1', 'linux')
    const assignments = Object.fromEntries(Object.entries(paths).map(([kind, path]) => [kind, { path, override: false }])) as Parameters<typeof validateProjectMachineDirectories>[0]
    assignments.projectWorkdir = { path: '/legacy/project', override: true }
    expect(validateProjectMachineDirectories(assignments, '/srv/ChatAI', 'p-1', 'linux').projectWorkdir).toEqual({ path: '/legacy/project', override: true })
    assignments.production = { path: '/srv/ChatAI/projects/p-1/other', override: false }
    expect(() => validateProjectMachineDirectories(assignments, '/srv/ChatAI', 'p-1', 'linux')).toThrow(/не совпадает/)
    assignments.production = { path: assignments.staging.path, override: true }
    assignments.staging = { ...assignments.staging, override: true }
    expect(() => validateProjectMachineDirectories(assignments, '/srv/ChatAI', 'p-1', 'linux')).toThrow(/совпадают/)
    assignments.production = { path: '/custom', override: true }
    assignments.staging = { path: '/custom/nested', override: true }
    expect(() => validateProjectMachineDirectories(assignments, '/srv/ChatAI', 'p-1', 'linux')).toThrow(/пересекаются/)
  })
})

describe('managed production and staging paths', () => {
  it.each([
    ['/data/ChatAI', 'linux', '/'],
    ['C:\\ChatAI', 'win32', '\\']
  ])('builds complete isolated layouts for %s', (storageRoot, platform, separator) => {
    const production = managedEnvironmentPaths(storageRoot, 'p-1', 'production', platform)
    const staging = managedEnvironmentPaths(storageRoot, 'p-1', 'staging', platform)
    expect(production.repository).toBe(`${production.root}${separator}temporary${separator}repository`)
    expect(production.manifest).toBe(`${production.root}${separator}environment.json`)
    expect(Object.values(production)).not.toContain(staging.root)
    expect(production.root.startsWith(staging.root + separator)).toBe(false)
    expect(staging.root.startsWith(production.root + separator)).toBe(false)
  })
  it('rejects traversal project ids', () => {
    expect(() => managedEnvironmentPaths('/safe/ChatAI', '../escape', 'production', 'linux')).toThrow(/safe relative path/)
  })
})

describe('managed merge clone paths', () => {
  it.each([
    ['/home/u/ChatAI', 'linux', '/home/u/ChatAI/projects/p-1/merge-clones/repository'],
    ['/data/data/com.termux/files/home/ChatAI', 'linux', '/data/data/com.termux/files/home/ChatAI/projects/p-1/merge-clones/repository'],
    ['/Users/u/ChatAI', 'darwin', '/Users/u/ChatAI/projects/p-1/merge-clones/repository'],
    ['C:\\Users\\u\\ChatAI', 'win32', 'C:\\Users\\u\\ChatAI\\projects\\p-1\\merge-clones\\repository'],
    ['\\\\server\\share\\ChatAI', 'win32', '\\\\server\\share\\ChatAI\\projects\\p-1\\merge-clones\\repository'],
    ['/c/Users/u/ChatAI', 'win32', 'C:\\Users\\u\\ChatAI\\projects\\p-1\\merge-clones\\repository']
  ])('строит изолированный путь для %s', (root, platform, expected) => {
    const paths = managedMergeClonePaths(root, 'p-1', platform)
    expect(paths.repository).toBe(expected)
    expect(paths.repository).not.toContain('/tasks/')
    expect(paths.repository).not.toContain('\\tasks\\')
  })
  it('отклоняет traversal в projectId', () => {
    expect(() => managedMergeClonePaths('/safe/ChatAI', '../escape', 'linux')).toThrow(/safe relative path/)
  })
})

describe('widget query contract', () => {
  it('ищет семантические элементы, фильтрует kind и ограничивает выдачу', () => {
    const items = [
      { id: 'e1', kind: 'epic', title: 'UI', version: '1', data: { description: 'Интерфейс' } },
      { id: 't1', kind: 'task', title: 'API', version: '2', data: { labels: ['ui'] } }
    ]
    expect(queryWidgetItems(items, 'ui', ['epic'], 10).map((item) => item.id)).toEqual(['e1'])
    expect(queryWidgetItems(items, 'интерфейс', [], 1).map((item) => item.id)).toEqual(['e1'])
  })
})

describe('sanitizeProjectTestUsers', () => {
  it('нормализует записи и опускает пустые role/note', () => {
    expect(sanitizeProjectTestUsers([
      { name: 'tester', password: 'p', role: 'admin', note: '' },
      { name: 'viewer', password: '' }
    ])).toEqual([
      { name: 'tester', password: 'p', role: 'admin' },
      { name: 'viewer', password: '' }
    ])
  })

  it('отклоняет не-массив, пустое имя, не-строковый пароль и переполнение', () => {
    expect(() => sanitizeProjectTestUsers('x')).toThrow()
    expect(() => sanitizeProjectTestUsers([{ name: '  ', password: 'p' }])).toThrow()
    expect(() => sanitizeProjectTestUsers([{ name: 'a', password: 5 }])).toThrow()
    expect(() => sanitizeProjectTestUsers([{ name: 'a', password: 'x'.repeat(300) }])).toThrow()
    expect(() => sanitizeProjectTestUsers(Array.from({ length: 33 }, (_, i) => ({ name: 'u' + i, password: '' })))).toThrow()
  })
})

describe('chatStorageDirectories', () => {
  it('строит абсолютные каталоги чата под корнем POSIX', () => {
    expect(chatStorageDirectories('/home/bob/ChatAI/', 'chats/c1')).toEqual({
      chatRoot: '/home/bob/ChatAI/chats/c1',
      attachments: '/home/bob/ChatAI/chats/c1/attachments',
      artifacts: '/home/bob/ChatAI/chats/c1/artifacts',
      generated: '/home/bob/ChatAI/chats/c1/.generated'
    })
  })

  it('для Windows-корня использует обратный слэш и отклоняет небезопасный относительный путь', () => {
    expect(chatStorageDirectories('C:\\Users\\bob\\ChatAI', 'projects/p1/chats/c1').attachments).toBe('C:\\Users\\bob\\ChatAI\\projects\\p1\\chats\\c1\\attachments')
    expect(() => chatStorageDirectories('/x', '../etc')).toThrow()
    expect(() => chatStorageDirectories('', 'chats/c1')).toThrow()
  })
})

describe('designPromptLines', () => {
  const link = (over: Partial<TaskDesignLink> = {}): TaskDesignLink => ({
    id: 'l1', taskId: 't1', conversationId: 'c1', conversationTitle: 'Проект 1', conversationOwner: 'alice',
    mode: 'files', paths: ['index.html'], path: 'index.html', label: '', createdAt: T0, createdBy: 'alice', ...over
  })
  const preview = (id: string, path: string): string => `/api/preview/make/${id}/${path}`

  it('сортирует проекты и точные пути детерминированно', () => {
    expect(taskMakeSources([
      link({ conversationId: 'c2', paths: ['src/App.tsx', 'index.html', 'src/App.tsx'] }),
      link({ conversationId: 'c1', mode: 'whole_project', paths: [], path: '' })
    ])).toEqual([
      { name: 'make_design_1', conversationId: 'c1', title: 'Проект 1', mode: 'whole_project', paths: [] },
      { name: 'make_design_2', conversationId: 'c2', title: 'Проект 1', mode: 'files', paths: ['index.html', 'src/App.tsx'] }
    ])
  })

  it('передаёт точные файлы через MCP без preview URL', () => {
    expect(designPromptLines([link()], preview)).toEqual([
      'Дизайн: «Проект 1» — Make-проект c1, точные файлы: index.html; чтение через make_design_1.make_read_file'
    ])
    expect(designPromptLines([link({ mode: 'whole_project', paths: [], path: '' })], preview)[0]).toContain('проект целиком')
    expect(designPromptLines([link()], preview)[0]).not.toContain('/api/preview')
  })

  it('подпись связи важнее имени Make-проекта: экран называют по задаче', () => {
    expect(designPromptLines([link({ label: 'Экран оплаты' })], preview)[0]).toContain('«Экран оплаты»')
  })
})
