// Release Center behaviour added in the improvement cycles: version suggestion
// and validation, production markers, step status labels, settings panel and
// the mobile card layout hooks (data-label attributes).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/uiRender'
import { createFakeApi } from '@voicechat/ui-foundation/test/fakeApi'
import type { ProjectRelease, ProjectReleaseSummary, ReleaseMachine } from '@voicechat/shared'
import { ReleaseCenter, githubWebUrl, typicalDurationMs } from './ReleaseCenter'

const machines: ReleaseMachine[] = [{ agentId: 'mac', name: 'MacBook', ownership: 'mine', access: 'owner', online: true, path: '/app', reposRoot: '', eligible: true, unavailableReason: null }]
const prepared: ProjectRelease = {
  id: 'prep-300', projectId: 'p1', version: '0.1.300', branch: 'release/0.1.300', sha: 'a'.repeat(40), status: 'ready', triggeredBy: 'admin', attempt: 1, previousReleaseId: null, createdAt: 1_700_000_000_000, releasedAt: null,
  steps: [
    { id: 'kb', kind: 'knowledge_base', status: 'passed', model: null, attempt: 1, log: 'kb ok', startedAt: 1000, finishedAt: 2000 },
    { id: 'test', kind: 'regression', status: 'skipped', model: null, attempt: 1, log: '', startedAt: null, finishedAt: 2000 }
  ]
}
const older: ProjectRelease = { ...prepared, id: 'prep-299', version: '0.1.299', branch: 'release/0.1.299', sha: 'b'.repeat(40) }
const deployment: ProjectRelease = {
  ...prepared, id: 'deploy-300', status: 'released', previousReleaseId: prepared.id, releasedAt: 1_700_000_010_000,
  steps: [{ id: 'health', kind: 'health_check', status: 'passed', model: null, attempt: 2, log: 'healthy', startedAt: 6000, finishedAt: 7000 }]
}
const summary = (release: ProjectRelease, over: Partial<ProjectReleaseSummary> = {}): ProjectReleaseSummary => ({ id: release.id, branch: release.branch, sha: release.sha, status: release.status, previousReleaseId: release.previousReleaseId, createdAt: release.createdAt, durationMs: 4000, attempt: release.attempt, ...over })
function api() {
  const value = createFakeApi()
  value['releases:machines'] = vi.fn(async () => ({ machines, lastAgentId: 'mac' }))
  value['releases:branches'] = vi.fn(async () => [prepared, older].map((item) => ({ branch: item.branch, version: item.version, sha: item.sha })))
  value['releases:list'] = vi.fn(async () => [summary(deployment), summary(prepared), summary(older)])
  value['releases:get'] = vi.fn(async ({ releaseId }) => [deployment, prepared, older].find((item) => item.id === releaseId) ?? null)
  value['releases:createBranch'] = vi.fn(async ({ branch }) => ({ ...prepared, id: 'prep-new', branch, version: branch.slice('release/'.length), status: 'preparing' as const, steps: [] }))
  return value
}

describe('ReleaseCenter — версия, production и мобильная раскладка', () => {
  // The remembered tab must not leak between tests: a deploy-tab test would
  // otherwise open the next one on «Деплой».
  beforeEach(() => window.localStorage.removeItem('vc.releases.tab'))
  it('подсказывает следующую версию и подставляет её кнопкой', async () => {
    const value = api()
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    const input = await screen.findByLabelText('Новая версия')
    expect(input).toHaveAttribute('placeholder', '0.1.301')
    expect(screen.getByRole('button', { name: 'Собрать новый релиз' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '0.1.301' }))
    expect(input).toHaveValue('0.1.301')
    expect(screen.getByText('Ветка release/0.1.301 от main.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Собрать новый релиз' }))
    expect(value['releases:createBranch']).toHaveBeenCalledWith({ projectId: 'p1', branch: 'release/0.1.301', baseBranch: 'main', agentId: 'mac' })
  })

  it('объясняет неверный формат и существующую версию, не давая собрать', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} />)
    const input = await screen.findByLabelText('Новая версия')
    await userEvent.type(input, '01.2')
    expect(screen.getByRole('alert')).toHaveTextContent('Формат версии: x.y.z')
    expect(screen.getByRole('button', { name: 'Собрать новый релиз' })).toBeDisabled()
    await userEvent.clear(input)
    await userEvent.type(input, '0.1.300')
    expect(screen.getByRole('alert')).toHaveTextContent('release/0.1.300 уже существует')
    expect(screen.getByRole('button', { name: 'Собрать новый релиз' })).toBeDisabled()
  })

  it('помечает релиз в production в списке, в выборе деплоя и меняет подпись кнопки', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} />)
    const row = (await screen.findByText('release/0.1.300')).closest('tr')!
    expect(row).toHaveTextContent('в production')
    // Its branch cannot be deleted while it is what production runs.
    expect(within(row).getByRole('button', { name: 'Удалить' })).toBeDisabled()
    expect(within(screen.getByText('release/0.1.299').closest('tr')!).getByRole('button', { name: 'Удалить' })).toBeEnabled()
    await userEvent.click(screen.getByRole('tab', { name: 'Деплой' }))
    const select = screen.getByRole('combobox', { name: 'Релиз' })
    expect(within(select).getByRole('option', { name: /release\/0\.1\.300.*сейчас в production/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Задеплоить повторно' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('уже в production')
    await userEvent.selectOptions(select, 'release/0.1.299')
    expect(screen.getByRole('status')).toHaveTextContent('откат production с release/0.1.300 на release/0.1.299')
    expect(screen.getByRole('button', { name: 'Задеплоить' })).toBeInTheDocument()
  })

  it('статусы шагов подписаны по-русски, пропущенный шаг отмечен', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} />)
    await userEvent.click(await screen.findByText('release/0.1.300'))
    expect(await screen.findByText('Пройден')).toBeInTheDocument()
    expect(screen.getByText('Пропущен')).toBeInTheDocument()
    expect(screen.queryByText('passed')).toBeNull()
    expect(screen.getByText('Машина сборки')).toBeInTheDocument()
  })

  it('настройки лимитов открываются панелью и сохраняются в проект', async () => {
    const value = api()
    value['projects:update'] = vi.fn(async () => ({}) as never)
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    const toggle = await screen.findByRole('button', { name: 'Настройки' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    const form = screen.getByRole('form', { name: 'Лимиты этапов релиза' })
    const health = within(form).getByLabelText('Health-check, сек.')
    await userEvent.clear(health)
    await userEvent.type(health, '900')
    await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }))
    expect(value['projects:update']).toHaveBeenCalledWith({ id: 'p1', releaseTimeouts: expect.objectContaining({ healthCheckMs: 900_000 }) })
    expect(await screen.findByText('Лимиты сохранены.')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Лимиты этапов релиза' })).toBeNull()
  })

  it('ячейки таблиц несут подписи колонок для карточной раскладки телефона', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} />)
    const row = (await screen.findByText('release/0.1.300')).closest('tr')!
    expect(row.querySelectorAll('td[data-label]')).toHaveLength(5)
    expect(row.querySelector('td[data-label="Статус"]')).toHaveTextContent('Готов')
    await userEvent.click(screen.getByRole('tab', { name: 'Деплой' }))
    const history = screen.getAllByRole('row').find((item) => item.getAttribute('aria-label')?.startsWith('Деплой'))!
    expect(history.querySelector('td[data-label="Длительность"]')).toBeInTheDocument()
    expect(within(history).getByText('Опубликован')).toHaveClass('release-status')
  })

  it('переключатель вида — сегмент с aria-pressed внутри общей колонки', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} />)
    const group = screen.getByRole('group', { name: 'Вид выпуска' })
    expect(within(group).getByRole('button', { name: 'Весь проект' })).toHaveAttribute('aria-pressed', 'true')
    expect(group.parentElement).toHaveClass('release-shell')
  })

  it('показывает причину ошибки и номер попытки прямо в списке и в карточке последнего деплоя', async () => {
    const value = api()
    const failedDeploy: ProjectRelease = { ...deployment, id: 'deploy-fail', status: 'failed', attempt: 3, createdAt: deployment.createdAt + 1 }
    value['releases:list'] = vi.fn(async () => [summary(failedDeploy, { failure: 'Health-check: фактическая длительность 1200 с, лимит 1200 с.' }), summary(deployment), summary(prepared), summary(older, { status: 'failed', failure: 'Regression завершилась с ошибкой' })])
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    const row = (await screen.findByText('release/0.1.299')).closest('tr')!
    expect(within(row).getByText('Regression завершилась с ошибкой')).toHaveClass('release-failure')
    await userEvent.click(screen.getByRole('tab', { name: 'Деплой' }))
    const last = screen.getByRole('button', { name: /Последний деплой/ })
    expect(last).toHaveTextContent('попытка 3')
    expect(last).toHaveTextContent('Health-check: фактическая длительность')
    // Production is still the older successful deploy — its own card stays visible.
    expect(screen.getByRole('button', { name: /Сейчас в production/ })).toHaveTextContent('release/0.1.300')
  })

  it('блокирует новую сборку и деплой, пока предыдущие ещё идут', async () => {
    const value = api()
    value['releases:list'] = vi.fn(async () => [summary({ ...deployment, id: 'deploy-live', status: 'health_check', createdAt: deployment.createdAt + 1 }), summary(deployment), summary({ ...prepared, id: 'prep-live', branch: 'release/0.1.302', status: 'checking' }), summary(prepared)])
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    const input = await screen.findByLabelText('Новая версия')
    await userEvent.type(input, '0.1.303')
    expect(screen.getByRole('button', { name: 'Собрать новый релиз' })).toBeDisabled()
    expect(screen.getByText(/Идёт сборка release\/0\.1\.302/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Деплой' }))
    expect(screen.getByRole('button', { name: /Задеплоить/ })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Идёт деплой release/0.1.300 (Health-check)')
  })

  it('длинные списки раскрываются постранично', async () => {
    const value = api()
    const many = Array.from({ length: 45 }, (_, index) => summary({ ...prepared, id: `prep-${index}`, branch: `release/0.2.${index}`, createdAt: prepared.createdAt - index }))
    value['releases:list'] = vi.fn(async () => many)
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    await screen.findByText('release/0.2.0')
    expect(screen.getAllByRole('row')).toHaveLength(21)
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё (25)' }))
    expect(screen.getAllByRole('row')).toHaveLength(41)
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё (5)' }))
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).toBeNull()
  })

  it('в подробностях есть ссылки на GitHub: коммит, ветка и сравнение с production', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner gitUrl="git@github.com:sislex/voiceAIChat.git" api={api()} />)
    await userEvent.click(await screen.findByText('release/0.1.299'))
    expect(await screen.findByRole('link', { name: 'Коммит на GitHub ↗' })).toHaveAttribute('href', `https://github.com/sislex/voiceAIChat/commit/${'b'.repeat(40)}`)
    expect(screen.getByRole('link', { name: 'Изменения относительно production ↗' })).toHaveAttribute('href', `https://github.com/sislex/voiceAIChat/compare/${'a'.repeat(12)}...${'b'.repeat(12)}`)
    expect(githubWebUrl('https://github.com/sislex/voiceAIChat')).toBe('https://github.com/sislex/voiceAIChat')
    expect(githubWebUrl('https://gitlab.com/x/y.git')).toBeNull()
  })

  it('помнит последнюю открытую вкладку', async () => {
    window.localStorage.removeItem('vc.releases.tab')
    const first = render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Деплой' }))
    expect(window.localStorage.getItem('vc.releases.tab')).toBe('deploy')
    first.unmount()
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} />)
    expect(await screen.findByRole('tab', { name: 'Деплой' })).toHaveAttribute('aria-selected', 'true')
    window.localStorage.removeItem('vc.releases.tab')
  })

  it('упавший деплой повторяется из подробностей той же веткой', async () => {
    const value = api()
    const failedDeploy: ProjectRelease = { ...deployment, id: 'deploy-fail', status: 'failed', attempt: 2, createdAt: deployment.createdAt + 1 }
    value['releases:list'] = vi.fn(async () => [summary(failedDeploy, { failure: 'Health-check не дождался' }), summary(deployment), summary(prepared)])
    value['releases:get'] = vi.fn(async ({ releaseId }) => [failedDeploy, deployment, prepared].find((item) => item.id === releaseId) ?? null)
    value['releases:deploy'] = vi.fn(async ({ branch }) => ({ ...deployment, id: 'deploy-new', branch, status: 'queued' as const, attempt: 3 }))
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Деплой' }))
    await userEvent.click(screen.getByRole('button', { name: /Последний деплой/ }))
    expect(await screen.findByText('попытка 2', { exact: false })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Повторить деплой' }))
    expect(value['releases:deploy']).toHaveBeenCalledWith({ projectId: 'p1', branch: 'release/0.1.300' })
    expect(await screen.findByText('попытка 3', { exact: false })).toBeInTheDocument()
    // The deploy detail links back to the preparation it was made from.
    await userEvent.click(screen.getByRole('button', { name: 'Сборка релиза' }))
    expect(await screen.findByText('Машина сборки')).toBeInTheDocument()
  })

  it('упавшую сборку можно удалить и собрать заново одним подтверждённым действием', async () => {
    const value = api()
    const failed: ProjectRelease = { ...older, status: 'failed', steps: [{ id: 'reg', kind: 'regression', status: 'failed', model: null, attempt: 1, log: 'FAIL tests', startedAt: 1, finishedAt: 2 }] }
    value['releases:list'] = vi.fn(async () => [summary(deployment), summary(prepared), summary(failed, { failure: 'FAIL tests' })])
    value['releases:get'] = vi.fn(async ({ releaseId }) => [deployment, prepared, failed].find((item) => item.id === releaseId) ?? null)
    value['releases:delete'] = vi.fn(async () => ({ deleted: true as const }))
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    await userEvent.click(await screen.findByText('release/0.1.299'))
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить и собрать заново' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Собрать release/0.1.299 заново?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Удалить и собрать' }))
    await screen.findByText('Сборка начата')
    expect(value['releases:delete']).toHaveBeenCalledWith({ projectId: 'p1', releaseId: 'prep-299', branch: 'release/0.1.299' })
    expect(value['releases:createBranch']).toHaveBeenCalledWith({ projectId: 'p1', branch: 'release/0.1.299', baseBranch: 'main', agentId: 'mac' })
  })

  it('SHA копируется кнопкой с тостом, даты в списке относительные с полной датой в title', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} />)
    const cell = (await screen.findByText('release/0.1.300')).closest('tr')!.querySelector('td[data-label="Дата"] time')!
    expect(cell).toHaveAttribute('title')
    expect(cell.textContent).not.toBe('')
    await userEvent.click(screen.getByText('release/0.1.300'))
    await userEvent.click(await screen.findByRole('button', { name: /SHA aaaaaaaaaaaa/ }))
    expect(writeText).toHaveBeenCalledWith('a'.repeat(40))
    expect(await screen.findByText('SHA скопирован')).toBeInTheDocument()
  })

  it('вкладки переключаются стрелками и показывают число готовых релизов', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} />)
    const releases = await screen.findByRole('tab', { name: 'Релизы' })
    releases.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Деплой' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('· готовых: 2')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Релизы' })).toHaveAttribute('aria-selected', 'true')
  })

  it('живёт событиями release.updated: перечитывает список и подробности, объявляет завершение тостом', async () => {
    const listeners: Array<(m: { projectId: string; releaseId: string; status: 'ready' | 'released' | 'failed' | 'checking' }) => void> = []
    ;(window as { board?: unknown }).board = { onReleaseUpdated: (cb: (typeof listeners)[number]) => { listeners.push(cb); return () => undefined }, onReconnect: () => () => undefined }
    const value = api()
    const running: ProjectRelease = { ...prepared, id: 'prep-302', branch: 'release/0.1.302', version: '0.1.302', status: 'checking', steps: [{ id: 'reg', kind: 'regression', status: 'running', model: null, attempt: 1, log: 'vitest…', startedAt: 1, finishedAt: null }] }
    let list = [summary(running, { durationMs: null }), summary(deployment), summary(prepared)]
    value['releases:list'] = vi.fn(async () => list)
    value['releases:get'] = vi.fn(async ({ releaseId }) => [running, deployment, prepared].find((item) => item.id === releaseId) ?? null)
    try {
      render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
      await screen.findByText('release/0.1.302')
      expect(value['releases:list']).toHaveBeenCalledTimes(1)
      expect(listeners).toHaveLength(1)
      // The build finishes: the server pushes one frame, the list is re-read once and the outcome is announced.
      running.status = 'ready'
      running.steps[0]!.status = 'passed'
      list = [summary({ ...running, status: 'ready' }), summary(deployment), summary(prepared)]
      listeners[0]!({ projectId: 'p1', releaseId: 'prep-302', status: 'ready' })
      await waitFor(() => expect(value['releases:list']).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('Сборка release/0.1.302 готова')).toBeInTheDocument()
      // Frames of other projects are ignored.
      listeners[0]!({ projectId: 'other', releaseId: 'x', status: 'failed' })
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(value['releases:list']).toHaveBeenCalledTimes(2)
    } finally {
      delete (window as { board?: unknown }).board
    }
  })

  it('ненастроенный production объясняет, чего не хватает, и ведёт в настройки', async () => {
    const open = vi.fn()
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} production={{ ready: false, mode: 'legacy', missing: ['production-машина', 'команда деплоя'] }} onOpenSettings={open} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Деплой' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Не хватает: production-машина, команда деплоя.')
    expect(screen.getByRole('button', { name: /Задеплоить/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Открыть настройки проекта' }))
    expect(open).toHaveBeenCalledOnce()
  })

  it('настроенный production показывает машину и режим', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} production={{ ready: true, mode: 'managed', missing: [], machineName: 'Prod 89', healthCheckCommand: 'curl health' }} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Деплой' }))
    expect(screen.getByText('Prod 89')).toBeInTheDocument()
    expect(screen.getByText(/Managed MachineStorage · health-check: curl health/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Задеплоить/ })).toBeEnabled()
  })

  it('фильтры и поиск сужают список релизов', async () => {
    const value = api()
    value['releases:list'] = vi.fn(async () => [summary(deployment), summary(prepared), summary(older, { status: 'failed', failure: 'FAIL' })])
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    await screen.findByText('release/0.1.300')
    await userEvent.click(screen.getByRole('button', { name: /^Ошибки/ }))
    expect(screen.queryByText('release/0.1.300')).toBeNull()
    expect(screen.getByText('release/0.1.299')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'В production' }))
    expect(screen.getByText('release/0.1.300')).toBeInTheDocument()
    expect(screen.queryByText('release/0.1.299')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Все' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск по версии или SHA' }), '0.1.29')
    expect(screen.queryByText('release/0.1.300')).toBeNull()
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Поиск по версии или SHA' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск по версии или SHA' }), 'zzz')
    expect(screen.getByText('Под фильтр ничего не попало.')).toBeInTheDocument()
  })

  it('оценка длительности идущего рана берётся из прошлых успешных', async () => {
    expect(typicalDurationMs([{ id: 'a', branch: 'b', sha: '', status: 'released', previousReleaseId: 'x', createdAt: 1, durationMs: 600_000 }, { id: 'b', branch: 'b', sha: '', status: 'failed', previousReleaseId: 'x', createdAt: 1, durationMs: 100 }, { id: 'c', branch: 'b', sha: '', status: 'released', previousReleaseId: 'x', createdAt: 1, durationMs: 300_000 }])).toBe(450_000)
    expect(typicalDurationMs([])).toBeNull()
    const value = api()
    value['releases:list'] = vi.fn(async () => [summary({ ...prepared, id: 'prep-live', branch: 'release/0.1.301', status: 'checking' }, { durationMs: 60_000 }), summary(prepared, { durationMs: 240_000 }), summary(older, { durationMs: 300_000 })])
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    const row = (await screen.findByText('release/0.1.301')).closest('tr')!
    expect(row).toHaveTextContent('обычно ≈ 4 мин 30 с, осталось ≈ 3 мин 30 с')
  })

  it('скачивает лог строки, нормализует ввод версии и сбрасывает лимиты к умолчаниям', async () => {
    const value = api()
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    const row = (await screen.findByText('release/0.1.300')).closest('tr')!
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    await userEvent.click(within(row).getByRole('button', { name: 'Лог' }))
    await waitFor(() => expect(value['releases:get']).toHaveBeenCalledWith({ projectId: 'p1', releaseId: 'prep-300' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    click.mockRestore()
    // «release/0.1.305» pasted into the version field is a plain version.
    await userEvent.type(screen.getByLabelText('Новая версия'), 'release/0.1.305')
    expect(screen.getByText('Ветка release/0.1.305 от main.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Собрать новый релиз' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Настройки' }))
    const form = screen.getByRole('form', { name: 'Лимиты этапов релиза' })
    const health = within(form).getByLabelText('Health-check, сек.')
    await userEvent.clear(health)
    expect(within(form).getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    await userEvent.click(within(form).getByRole('button', { name: 'Сбросить к умолчаниям' }))
    expect(health).toHaveValue(1800)
    expect(within(form).getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  })

  it('переход через несколько версий назван в подсказке деплоя', async () => {
    const value = api()
    const mid: ProjectRelease = { ...older, id: 'prep-2995', branch: 'release/0.1.298', version: '0.1.298', sha: 'c'.repeat(40) }
    value['releases:branches'] = vi.fn(async () => [prepared, older, mid].map((item) => ({ branch: item.branch, version: item.version, sha: item.sha })))
    value['releases:list'] = vi.fn(async () => [summary(deployment), summary(prepared), summary(older), summary(mid)])
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Деплой' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Релиз' }), 'release/0.1.298')
    expect(screen.getByRole('status')).toHaveTextContent('откат production с release/0.1.300 на release/0.1.298 (минуя 1 версию)')
  })
})
