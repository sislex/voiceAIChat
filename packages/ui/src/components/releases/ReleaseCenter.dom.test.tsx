// Release Center behaviour added in the improvement cycles: version suggestion
// and validation, production markers, step status labels, settings panel and
// the mobile card layout hooks (data-label attributes).
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/uiRender'
import { createFakeApi } from '@voicechat/ui-foundation/test/fakeApi'
import type { ProjectRelease, ProjectReleaseSummary, ReleaseMachine } from '@voicechat/shared'
import { ReleaseCenter } from './ReleaseCenter'

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
const summary = (release: ProjectRelease): ProjectReleaseSummary => ({ id: release.id, branch: release.branch, sha: release.sha, status: release.status, previousReleaseId: release.previousReleaseId, createdAt: release.createdAt, durationMs: 4000 })
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
})
