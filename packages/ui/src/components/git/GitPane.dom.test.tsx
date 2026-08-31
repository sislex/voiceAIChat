// Панель кода: проверяем поведение, а не разметку — клик по файлу открывает сравнение,
// правка требует подтверждения (его кликают, а не мокают), а запись выключается там,
// где сервер её всё равно запретит: занятый раном каталог, read-only копия, main.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { expectNoViolations } from '../../test/a11y'
import { makeGitBranches, makeGitDiff, makeGitFile, makeGitStatus, makeGitTree, makeGitWorkspace } from '../../test/fixtures/git'
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
    const status = makeGitStatus({ ref: makeGitWorkspace({ kind: 'merge-clone', writable: false }) })
    paint(api({}, status))
    expect(await screen.findByText(/это merge-клон, им управляет merge-ран/)).toBeInTheDocument()
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
