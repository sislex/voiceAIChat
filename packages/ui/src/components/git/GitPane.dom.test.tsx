// Панель кода: проверяем поведение, а не разметку — клик по файлу открывает сравнение,
// правка требует подтверждения (его кликают, а не мокают), а запись выключается там,
// где сервер её всё равно запретит: занятый раном каталог, read-only копия, main.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { expectNoViolations } from '../../test/a11y'
import { makeGitBranches, makeGitChange, makeGitDiff, makeGitFile, makeGitStatus, makeGitTree, makeGitWorkspace } from '../../test/fixtures/git'
import { GitPane, type GitPaneApi } from './GitPane'
import type { GitWorkspaceStatus } from '@shared/gitWorkspace'

function api(over: Partial<GitPaneApi> = {}, status: GitWorkspaceStatus = makeGitStatus()): GitPaneApi {
  return {
    'projects:gitStatus': vi.fn(async () => status),
    'projects:gitBranches': vi.fn(async () => makeGitBranches()),
    'projects:gitDiff': vi.fn(async ({ path }) => makeGitDiff({ path })),
    // Уровни вложенные, как у настоящего `ls-tree`: путь ребёнка начинается с каталога.
    'projects:gitTree': vi.fn(async ({ dir }) => dir
      ? { ref: 'HEAD', dir, entries: [{ name: 'server', path: `${dir}/server`, kind: 'dir' as const, size: null }, { name: 'index.ts', path: `${dir}/index.ts`, kind: 'file' as const, size: 100 }] }
      : { ...makeGitTree(), dir }),
    'projects:gitFile': vi.fn(async ({ path }) => makeGitFile({ path })),
    'projects:gitSaveFile': vi.fn(async ({ path, content }) => ({
      file: { path, ref: null, content, size: content.length, truncated: false, binary: false },
      status
    })),
    'projects:gitCheckout': vi.fn(async () => ({ status, createdLocal: false })),
    'projects:gitCreateBranch': vi.fn(async () => ({ status, createdLocal: true })),
    'projects:gitCommit': vi.fn(async () => ({ status: { ...status, changes: [] }, sha: 'd'.repeat(40), staged: 1 })),
    'projects:gitPush': vi.fn(async () => ({ status, branch: 'CHAT-42', sha: 'd'.repeat(40) })),
    'projects:gitPull': vi.fn(async () => ({ status, mode: 'rebase' as const, pulled: 2 })),
    'projects:gitDiscard': vi.fn(async () => ({ status: { ...status, changes: [] }, reverted: 1, removed: 0 })),
    'projects:gitBranchChanges': vi.fn(async () => ({
      base: 'e'.repeat(40),
      changes: [{ path: 'apps/server/src/git/scripts.ts', oldPath: null, state: 'added' as const, staged: true, worktree: false }],
      truncated: false
    })),
    'projects:gitStage': vi.fn(async () => status),
    'projects:gitLog': vi.fn(async () => ({ commits: status.commitsAhead })),
    'projects:gitCommitDetail': vi.fn(async ({ sha }) => ({
      sha, subject: 'feat(git): панель кода', author: 'bob', at: 1788172791,
      files: [{ path: 'apps/server/src/index.ts', oldPath: null, state: 'modified' as const }],
      truncated: false
    })),
    'projects:gitGrep': vi.fn(async ({ query }) => ({
      query, matches: [{ path: 'apps/server/src/index.ts', line: 3, text: 'const app = await buildServer()' }], truncated: false
    })),
    'projects:gitFileBytes': vi.fn(async ({ path }) => ({ path, dataBase64: 'YQ==', size: 1 })),
    'projects:gitConflict': vi.fn(async ({ path }) => ({
      path,
      base: { path, ref: ':1:', content: 'общий предок\n', size: 14, truncated: false, binary: false },
      ours: { path, ref: ':2:', content: 'наша версия\n', size: 12, truncated: false, binary: false },
      theirs: { path, ref: ':3:', content: 'их версия\n', size: 10, truncated: false, binary: false }
    })),
    'projects:gitResolveConflict': vi.fn(async () => ({ ...status, changes: [] })),
    ...over
  } as GitPaneApi
}

const paint = (bridge: GitPaneApi = api()): ReturnType<typeof render> =>
  render(<GitPane projectId="p1" workspaceId="ws:ws-1" api={bridge} />)

describe('GitPane', () => {
  it('показывает ветку, отставание и список изменений', async () => {
    paint()
    expect(await screen.findByText('CHAT-42')).toBeInTheDocument()
    expect(screen.getByText('↑1 ↓0')).toBeInTheDocument()
    expect(screen.getByText('3 изменений')).toBeInTheDocument()
    const items = screen.getByTestId('git-change-list').querySelectorAll('li')
    expect(items).toHaveLength(3)
  })

  it('предупреждает, что незакоммиченные изменения остановят следующий CI-ран', async () => {
    paint()
    expect(await screen.findByText(/Следующий CI-ран задачи требует чистой рабочей копии/)).toBeInTheDocument()
  })

  it('клик по файлу открывает сравнение двух версий', async () => {
    const bridge = api()
    paint(bridge)
    fireEvent.click(await screen.findByText('apps/server/src/index.ts'))
    await waitFor(() => expect(screen.getByTestId('git-diff')).toBeInTheDocument())
    expect(bridge['projects:gitDiff']).toHaveBeenCalledWith({ id: 'p1', workspace: 'ws:ws-1', path: 'apps/server/src/index.ts' })
    // Слева — версия из ревизии, справа рабочая копия (в jsdom это фолбэк из двух <pre>).
    const fallback = screen.getByTestId('make-diff-fallback')
    expect(fallback.textContent).toContain('port: 8080')
    expect(fallback.textContent).toContain('port: 8787')
  })

  it('правка сохраняется только после подтверждения и уходит на сервер как есть', async () => {
    const bridge = api()
    paint(bridge)
    fireEvent.click(await screen.findByText('apps/server/src/index.ts'))
    await waitFor(() => expect(screen.getByTestId('git-diff')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Правка' }))
    const editor = await screen.findByLabelText('Содержимое apps/server/src/index.ts')
    fireEvent.change(editor, { target: { value: 'поправленный текст' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    // Подтверждение — настоящее окно из ConfirmProvider: его кликают.
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить файл' }))
    await waitFor(() => expect(bridge['projects:gitSaveFile']).toHaveBeenCalledWith({
      id: 'p1', workspace: 'ws:ws-1', path: 'apps/server/src/index.ts', content: 'поправленный текст'
    }))
  })

  it('коммит требует выбранных файлов и сообщения', async () => {
    const bridge = api()
    paint(bridge)
    await screen.findByTestId('git-change-list')
    const commit = screen.getByRole('button', { name: 'Закоммитить' })
    expect(commit).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }))
    expect(commit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Сообщение коммита'), { target: { value: 'fix: правка' } })
    expect(commit).toBeEnabled()
    fireEvent.click(commit)
    fireEvent.click(await screen.findByRole('button', { name: 'Создать коммит' }))
    await waitFor(() => expect(bridge['projects:gitCommit']).toHaveBeenCalledWith(expect.objectContaining({
      id: 'p1', workspace: 'ws:ws-1', message: 'fix: правка'
    })))
  })

  it('в защищённую ветку кнопка отправки выключена и объяснена', async () => {
    paint(api({}, makeGitStatus({ branch: 'main', ahead: 2 })))
    const push = await screen.findByRole('button', { name: 'Отправить ветку' })
    expect(push).toBeDisabled()
    expect(push).toHaveAttribute('title', expect.stringContaining('merge-ран'))
    expect(screen.getByText(/Ветка main защищена/)).toBeInTheDocument()
  })

  it('без коммитов сверх origin отправлять нечего', async () => {
    paint(api({}, makeGitStatus({ ahead: 0 })))
    const push = await screen.findByRole('button', { name: 'Отправить ветку' })
    expect(push).toBeDisabled()
    expect(push).toHaveAttribute('title', 'Нет коммитов для отправки')
  })

  it('занятый раном каталог: чтение есть, запись выключена, ран открывается ссылкой', async () => {
    const onOpenRun = vi.fn()
    const status = makeGitStatus({ ref: makeGitWorkspace({ busy: { kind: 'ci', runId: 'run-7', status: 'running' } }) })
    render(<GitPane projectId="p1" workspaceId="ws:ws-1" api={api({}, status)} onOpenRun={onOpenRun} />)
    expect(await screen.findByText(/Каталог занят CI-раном/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ветка…' })).toBeDisabled()
    expect(screen.getByLabelText('Сообщение коммита')).toBeDisabled()
    // Изменения видно: смотреть, что делает модель, полезно и во время рана.
    expect(screen.getByTestId('git-change-list')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть ран' }))
    expect(onOpenRun).toHaveBeenCalledWith('ci', 'run-7')
  })

  it('merge-клон объясняет, почему только чтение', async () => {
    // Причину теперь формулирует сервер и присылает в статусе: UI её не додумывает.
    const status = makeGitStatus({
      ref: makeGitWorkspace({ kind: 'merge-clone', writable: false, readOnlyReason: 'Merge-клоном управляет merge-ран: он только для чтения' })
    })
    paint(api({}, status))
    expect(await screen.findByText(/Merge-клоном управляет merge-ран/)).toBeInTheDocument()
  })

  it('проблема рабочей копии показывается объяснением и следующим шагом', async () => {
    const status = makeGitStatus({ problem: 'workspace_released', ref: makeGitWorkspace({ released: true }), changes: [] })
    paint(api({}, status))
    expect(await screen.findByText('Рабочая копия удалена cleanup-шагом рана')).toBeInTheDocument()
    // Техническая деталь спрятана в <details> — но текст «что делать» в DOM есть сразу.
    expect(screen.getByText(/Запустите ран задачи заново/)).toBeInTheDocument()
  })

  it('ошибка чтения состояния даёт «Повторить»', async () => {
    const bridge = api({ 'projects:gitStatus': vi.fn(async () => { throw new Error('машина не в сети') }) as never })
    paint(bridge)
    expect(await screen.findByText('Не удалось прочитать состояние рабочей копии')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(bridge['projects:gitStatus']).toHaveBeenCalledTimes(2))
  })

  it('detached HEAD виден в шапке', async () => {
    paint(api({}, makeGitStatus({ branch: null, detached: true })))
    expect(await screen.findByText(/detached @ a1b2c3d4/)).toBeInTheDocument()
  })

  it('диалог ветки показывает локальные и удалённые ветки, а грязное дерево — предупреждение', async () => {
    const bridge = api()
    paint(bridge)
    fireEvent.click(await screen.findByRole('button', { name: 'Ветка…' }))
    const dialog = await screen.findByTestId('git-branch-dialog')
    expect(dialog).toBeInTheDocument()
    expect(await screen.findByText(/3 незакоммиченных изменений/)).toBeInTheDocument()
    const select = await screen.findByLabelText('Ветка для переключения')
    expect(select.querySelectorAll('option')).toHaveLength(3)
    expect(select.textContent).toContain('только в origin')
    fireEvent.change(select, { target: { value: 'main' } })
    fireEvent.click(screen.getByRole('button', { name: 'Переключиться' }))
    await waitFor(() => expect(bridge['projects:gitCheckout']).toHaveBeenCalledWith({
      id: 'p1', workspace: 'ws:ws-1', branch: 'main', confirmDirty: true
    }))
  })

  it('вкладка «Файлы» показывает дерево, раскрывает каталог и открывает файл в правке', async () => {
    const bridge = api()
    paint(bridge)
    fireEvent.click(await screen.findByRole('tab', { name: 'Файлы' }))
    const tree = await screen.findByTestId('git-tree')
    // Первый уровень — уже прочитан: дерево грузится по уровням, а не целиком.
    expect(bridge['projects:gitTree']).toHaveBeenCalledWith({ id: 'p1', workspace: 'ws:ws-1', dir: '' })
    expect(tree.textContent).toContain('apps')
    expect(tree.textContent).toContain('package.json')
    fireEvent.click(screen.getByRole('button', { name: /apps/ }))
    await waitFor(() => expect(bridge['projects:gitTree']).toHaveBeenCalledWith({ id: 'p1', workspace: 'ws:ws-1', dir: 'apps' }))
    fireEvent.click(screen.getByRole('button', { name: /package\.json/ }))
    await waitFor(() => expect(bridge['projects:gitFile']).toHaveBeenCalledWith({ id: 'p1', workspace: 'ws:ws-1', path: 'package.json' }))
    // Файл без изменений сравнивать не с чем — открывается сразу в правке.
    expect(await screen.findByTestId('git-editor')).toBeInTheDocument()
  })

  it('пустая рабочая копия объясняет, что дальше', async () => {
    paint(api({}, makeGitStatus({ changes: [] })))
    expect(await screen.findByText('Рабочая копия чистая')).toBeInTheDocument()
  })

  it('без нарушений доступности', async () => {
    const { container } = paint()
    await screen.findByTestId('git-change-list')
    await expectNoViolations(container)
  })
})

describe('GitPane: правки, роль и origin', () => {
  it('несохранённая правка не теряется при переходе к другому файлу и помечается точкой', async () => {
    const bridge = api()
    paint(bridge)
    fireEvent.click(await screen.findByText('apps/server/src/index.ts'))
    await waitFor(() => expect(screen.getByTestId('git-diff')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Правка' }))
    fireEvent.change(await screen.findByLabelText('Содержимое apps/server/src/index.ts'), { target: { value: 'мой черновик' } })
    // Уходим на другой файл и возвращаемся.
    fireEvent.click(screen.getByText('docs/kb/ui.md'))
    await waitFor(() => expect(screen.getByTestId('git-diff')).toBeInTheDocument())
    // Точка в списке говорит, что правка жива.
    expect(screen.getByTitle('Есть несохранённая правка')).toBeInTheDocument()
    fireEvent.click(screen.getByText('apps/server/src/index.ts'))
    const editor = await screen.findByLabelText('Содержимое apps/server/src/index.ts')
    expect((editor as HTMLTextAreaElement).value).toBe('мой черновик')
  })

  it('роль без права записи: кнопки выключены и объясняют причину, а не молчат', async () => {
    const status = makeGitStatus({
      ref: makeGitWorkspace({ writable: false, readOnlyReason: 'Ваша роль не позволяет менять рабочую копию' })
    })
    paint(api({}, status))
    expect(await screen.findByText(/Ваша роль не позволяет менять рабочую копию/)).toBeInTheDocument()
    const commit = screen.getByRole('button', { name: 'Закоммитить' })
    expect(commit).toBeDisabled()
    const discard = screen.getByRole('button', { name: 'Отбросить' })
    expect(discard).toBeDisabled()
    expect(discard).toHaveAttribute('title', 'Ваша роль не позволяет менять рабочую копию')
  })

  it('«Подтянуть» появляется при отставании и не работает на грязном дереве', async () => {
    const dirty = makeGitStatus({ behind: 3 })
    paint(api({}, dirty))
    const pull = await screen.findByRole('button', { name: 'Подтянуть (3)' })
    expect(pull).toBeDisabled()
    expect(pull).toHaveAttribute('title', 'Сначала закоммитьте или отбросьте изменения')
  })

  it('на чистом дереве «Подтянуть» вызывает rebase после подтверждения', async () => {
    const clean = makeGitStatus({ behind: 2, changes: [] })
    const bridge = api({}, clean)
    paint(bridge)
    fireEvent.click(await screen.findByRole('button', { name: 'Подтянуть (2)' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Подтянуть' }))
    await waitFor(() => expect(bridge['projects:gitPull']).toHaveBeenCalledWith({ id: 'p1', workspace: 'ws:ws-1', mode: 'rebase' }))
  })

  it('«Обновить из origin» освежает ветки и состояние, не открывая диалог', async () => {
    const bridge = api()
    paint(bridge)
    fireEvent.click(await screen.findByRole('button', { name: 'Обновить из origin' }))
    await waitFor(() => expect(bridge['projects:gitBranches']).toHaveBeenCalledWith({ id: 'p1', workspace: 'ws:ws-1', refresh: true }))
    expect(screen.queryByTestId('git-branch-dialog')).not.toBeInTheDocument()
  })

  it('отбрасывание требует ввести имя ветки и только потом уходит на сервер', async () => {
    const bridge = api()
    paint(bridge)
    await screen.findByTestId('git-change-list')
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отбросить' }))
    // Кнопка подтверждения заперта, пока не введено имя ветки; в подвале кнопка с тем
    // же текстом, поэтому ищем именно внутри окна подтверждения.
    const dialog = await screen.findByRole('dialog')
    const confirmButton = within(dialog).getByRole('button', { name: 'Отбросить' })
    expect(confirmButton).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'CHAT-42' } })
    expect(confirmButton).toBeEnabled()
    fireEvent.click(confirmButton)
    await waitFor(() => expect(bridge['projects:gitDiscard']).toHaveBeenCalledWith(expect.objectContaining({
      id: 'p1', workspace: 'ws:ws-1', confirmText: 'CHAT-42'
    })))
  })
})

describe('GitPane: ветка, поиск, индекс и конфликты', () => {
  it('вкладка «Ветка» показывает, что задача меняет относительно базы', async () => {
    const bridge = api()
    paint(bridge)
    fireEvent.click(await screen.findByRole('tab', { name: 'Ветка' }))
    await waitFor(() => expect(bridge['projects:gitBranchChanges']).toHaveBeenCalledWith({ id: 'p1', workspace: 'ws:ws-1' }))
    expect(await screen.findByText(/общий предок с origin\/main/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('apps/server/src/git/scripts.ts'))
    // Сравнение идёт с базой ветки, а не с HEAD: иначе закоммиченное не видно.
    await waitFor(() => expect(bridge['projects:gitDiff']).toHaveBeenCalledWith({
      id: 'p1', workspace: 'ws:ws-1', path: 'apps/server/src/git/scripts.ts', base: 'e'.repeat(40)
    }))
  })

  it('поиск: имя фильтруется без сети, содержимое — по Enter через git grep', async () => {
    const bridge = api()
    paint(bridge)
    fireEvent.click(await screen.findByRole('tab', { name: 'Поиск' }))
    const input = await screen.findByLabelText('Поиск по файлам и содержимому')
    fireEvent.change(input, { target: { value: 'index' } })
    // Файл нашёлся среди известных путей — запроса к машине не было.
    expect(await screen.findByText('Файлы по имени')).toBeInTheDocument()
    expect(bridge['projects:gitGrep']).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Искать' }))
    await waitFor(() => expect(bridge['projects:gitGrep']).toHaveBeenCalledWith({ id: 'p1', workspace: 'ws:ws-1', query: 'index' }))
    expect(await screen.findByText(/apps\/server\/src\/index\.ts:3/)).toBeInTheDocument()
  })

  it('индекс: выбранные файлы добавляются и снимаются', async () => {
    const bridge = api()
    paint(bridge)
    await screen.findByTestId('git-change-list')
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }))
    fireEvent.click(screen.getByRole('button', { name: 'В индекс' }))
    await waitFor(() => expect(bridge['projects:gitStage']).toHaveBeenCalledWith(expect.objectContaining({ unstage: false })))
    fireEvent.click(screen.getByRole('button', { name: 'Из индекса' }))
    await waitFor(() => expect(bridge['projects:gitStage']).toHaveBeenCalledWith(expect.objectContaining({ unstage: true })))
  })

  it('у конфликтного файла есть трёхсторонний вид и выбор стороны', async () => {
    const conflicted = makeGitStatus({
      changes: [makeGitChange({ path: 'src/conflict.ts', state: 'conflict' })]
    })
    const bridge = api({}, conflicted)
    paint(bridge)
    fireEvent.click(await screen.findByText('src/conflict.ts'))
    await waitFor(() => expect(screen.getByTestId('git-diff')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Конфликт' }))
    const view = await screen.findByTestId('git-conflict')
    expect(view.textContent).toContain('Слева — наша версия, справа — их')
    // Общий предок по требованию: постоянно занимать им экран незачем.
    expect(screen.queryByTestId('git-conflict-base')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Показать общего предка' }))
    expect(await screen.findByTestId('git-conflict-base')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Оставить нашу' }))
    await waitFor(() => expect(bridge['projects:gitResolveConflict']).toHaveBeenCalledWith({
      id: 'p1', workspace: 'ws:ws-1', path: 'src/conflict.ts', side: 'ours'
    }))
  })

  it('история файла и состав коммита раскрываются по требованию', async () => {
    const bridge = api()
    paint(bridge)
    fireEvent.click(await screen.findByText('apps/server/src/index.ts'))
    await waitFor(() => expect(screen.getByTestId('git-diff')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'История файла' }))
    await waitFor(() => expect(bridge['projects:gitLog']).toHaveBeenCalledWith({
      id: 'p1', workspace: 'ws:ws-1', path: 'apps/server/src/index.ts'
    }))
    // Состав коммита — только по клику: пятьдесят команд ради непрочитанных строк не нужны.
    expect(bridge['projects:gitCommitDetail']).not.toHaveBeenCalled()
    const commits = await screen.findAllByTestId('git-commits')
    fireEvent.click(within(commits[commits.length - 1]!).getAllByRole('button')[0]!)
    await waitFor(() => expect(bridge['projects:gitCommitDetail']).toHaveBeenCalled())
  })

  it('файл можно скачать, даже если показать его нельзя', async () => {
    const createUrl = vi.fn(() => 'blob:git')
    const revokeUrl = vi.fn()
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl })
    const bridge = api()
    paint(bridge)
    fireEvent.click(await screen.findByText('apps/server/src/index.ts'))
    await waitFor(() => expect(screen.getByTestId('git-diff')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Скачать apps/server/src/index.ts' }))
    await waitFor(() => expect(bridge['projects:gitFileBytes']).toHaveBeenCalledWith({
      id: 'p1', workspace: 'ws:ws-1', path: 'apps/server/src/index.ts'
    }))
    expect(createUrl).toHaveBeenCalled()
  })
})
