import { expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectMachine } from '@shared/projects'
import { render } from '../test/uiRender'
import { makeAgent } from '../test/fixtures'
import { ProjectMachinesSettings, machineReadiness } from './ProjectMachinesSettings'

const own: ProjectMachine = { agentId: 'a1', name: 'Mac', owner: 'alice', ownership: 'mine', online: true, sharedWithProject: true, isMyDefault: true, canUse: true, load: 0, path: '/old', reposRoot: '/repos', sshHost: 'mac.local', sshUser: 'alice' }
const other: ProjectMachine = { ...own, agentId: 'a2', name: 'CI', owner: 'bob', ownership: 'other', isMyDefault: false }
const offline: ProjectMachine = { ...own, agentId: 'a3', name: 'PC', owner: 'alice', online: false, sharedWithProject: false, isMyDefault: false, path: '', reposRoot: '' }
const setup = (onSave = vi.fn(async () => undefined), onSetDefault = vi.fn()) => render(<ProjectMachinesSettings projectId="p1" machines={[own, other, offline]} agents={[makeAgent({ id: 'a1', name: 'Mac' }), makeAgent({ id: 'a3', name: 'PC', online: false })]} onShare={vi.fn()} onSave={onSave} onSetDefault={onSetDefault} />)

it('показывает две таблицы, подписи и readonly-конфигурацию чужой машины', () => {
  setup()
  expect(screen.getByRole('heading', { name: 'Мои машины' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Машины, предоставленные проекту' })).toBeInTheDocument()
  expect(screen.getByLabelText('Папка проекта: CI')).toHaveAttribute('readonly')
  expect(screen.getAllByText('Папка проекта', { selector: 'label' })).toHaveLength(2)
  expect(screen.getByLabelText('Подсказка: SSH hostname/IP — Mac')).toHaveAttribute('title', expect.stringContaining('SSH-подключения'))
  expect(screen.getByLabelText('Подсказка: SSH hostname/IP — CI')).toHaveAttribute('tabindex', '0')
})
it('разрешает редактировать конфигурацию собственной машины без предоставления проекту', async () => {
  const save = vi.fn(async () => undefined)
  const unsharedOnline = { ...offline, online: true }
  render(<ProjectMachinesSettings projectId="p1" machines={[unsharedOnline]} agents={[makeAgent({ id: 'a3', name: 'PC' })]} onShare={vi.fn()} onSave={save} onSetDefault={vi.fn()} />)
  const input = screen.getByLabelText('Папка проекта: PC')
  expect(input).not.toHaveAttribute('readonly')
  await userEvent.type(input, '/work{Enter}')
  expect(save).toHaveBeenCalledWith('p1', 'a3', 'path', '/work', expect.objectContaining({ agentId: 'a3', sharedWithProject: false, path: '/work' }))
})

it('сохраняет по Enter один раз и не отправляет неизменённое значение по blur', async () => {
  const save = vi.fn(async () => undefined); setup(save)
  const input = screen.getByLabelText('Папка проекта: Mac')
  await userEvent.click(input); await userEvent.tab()
  expect(save).not.toHaveBeenCalled()
  await userEvent.clear(input); await userEvent.type(input, '/new{Enter}')
  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith('p1', 'a1', 'path', '/new', expect.objectContaining({ agentId: 'a1', path: '/new' }))
})
it('показывает ошибку сохранения', async () => {
  setup(vi.fn(async () => { throw new Error('fail') }))
  const input = screen.getByLabelText('SSH-пользователь: Mac')
  await userEvent.clear(input); await userEvent.type(input, 'root{Enter}')
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить')
})

it('фильтрует каждую таблицу независимо и начинает с online', async () => {
  setup()
  const mineFilter = screen.getByLabelText('Фильтр машин: Мои машины')
  const sharedFilter = screen.getByLabelText('Фильтр машин: Машины, предоставленные проекту')
  expect(mineFilter).toHaveValue('online')
  expect(sharedFilter).toHaveValue('online')
  expect(screen.queryByText('PC')).not.toBeInTheDocument()
  await userEvent.selectOptions(mineFilter, 'offline')
  expect(screen.getByText('PC')).toBeInTheDocument()
  expect(screen.queryByText('Mac')).not.toBeInTheDocument()
  expect(sharedFilter).toHaveValue('online')
  await userEvent.selectOptions(mineFilter, 'all')
  expect(screen.getByText('Mac')).toBeInTheDocument()
  expect(screen.getByText('PC')).toBeInTheDocument()
})

it('показывает статус слева от имени, владельца под ним и готовность с причиной', async () => {
  setup()
  expect(screen.getAllByLabelText('Online')).toHaveLength(2)
  expect(screen.getByText('alice')).toBeInTheDocument()
  expect(screen.queryByRole('columnheader', { name: 'Владелец' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('columnheader', { name: /^Готовность/ })).toHaveLength(2)
  await userEvent.selectOptions(screen.getByLabelText('Фильтр машин: Мои машины'), 'offline')
  expect(screen.getByLabelText(/Не готова: Offline; не заполнена «Папка проекта»; не заполнен «Корень Feature Run»/)).toHaveClass('proj-status-dot--not-ready')
  expect(screen.getByLabelText('Offline')).toHaveClass('proj-status-dot--offline')
  expect(screen.getByLabelText('Offline')).toHaveAttribute('title', 'Offline')
  expect(screen.getByLabelText('Offline')).toHaveAttribute('tabindex', '0')
  await userEvent.hover(screen.getByLabelText('Offline'))
  expect(screen.getByRole('tooltip')).toHaveTextContent('Offline')
  expect(screen.getByRole('tooltip').parentElement).toBe(document.body)
})

it('объясняет, что загрузка — число активных CI-запусков', () => {
  setup()
  const loads = screen.getAllByLabelText('Загрузка: 0. Количество активных CI-запусков, назначенных этой машине')
  expect(loads).toHaveLength(2)
  expect(loads[0]).toHaveTextContent('Загрузка: 0')
  expect(loads[0]).toHaveAttribute('tabindex', '0')
})

it.each([
  [true, '/project', '/repos', true, 'Готова'],
  [false, '/project', '/repos', false, 'Offline'],
  [true, '', '/repos', false, 'Папка проекта'],
  [true, '/project', '', false, 'Корень Feature Run'],
  [true, '', '', false, 'Папка проекта']
] as const)('вычисляет готовность для online=%s path=%s reposRoot=%s', (online, path, reposRoot, ready, reason) => {
  const result = machineReadiness({ online, path, reposRoot })
  expect(result.ready).toBe(ready)
  expect(result.tooltip).toContain(reason)
  if (!path && !reposRoot) expect(result.tooltip).toContain('Корень Feature Run')
})

it('разрешает выбрать собственную online-машину без предоставления проекту', async () => {
  const setDefault = vi.fn()
  const unsharedOnline = { ...offline, online: true }
  render(<ProjectMachinesSettings projectId="p1" machines={[unsharedOnline]} agents={[makeAgent({ id: 'a3', name: 'PC' })]} onShare={vi.fn()} onSave={vi.fn()} onSetDefault={setDefault} />)
  const radio = screen.getByLabelText('По умолчанию: PC')
  expect(radio).toBeEnabled()
  await userEvent.click(radio)
  expect(setDefault).toHaveBeenCalledWith('p1', 'a3')
})

it('показывает все назначения, меняет storage и сбрасывает override отдельно', async () => {
  const recommendations = {
    projectWorkdir: '/a/projects/p1/worktree', reposRoot: '/a/projects/p1/repositories', mergeClones: '/a/projects/p1/merge-clones',
    production: '/a/projects/p1/environments/production', staging: '/a/projects/p1/environments/staging',
    featurePreview: '/a/projects/p1/environments/previews', taskWorkspace: '/a/projects/p1/tasks'
  } as const
  const directories = Object.fromEntries(Object.entries(recommendations).map(([kind, path]) => [kind, { path, override: kind === 'mergeClones' }])) as NonNullable<ProjectMachine['directories']>
  const machine: ProjectMachine = { ...own, storageId: 's1', storage: { id: 's1', machineId: 'a1', rootPath: '/a', status: 'ready', formatVersion: 1 }, availableStorages: [
    { id: 's1', machineId: 'a1', rootPath: '/a', status: 'ready', formatVersion: 1, primary: true },
    { id: 's2', machineId: 'a1', rootPath: '/b', status: 'ready', formatVersion: 1 }
  ], directories, recommendations }
  const configure = vi.fn(async () => undefined); const reset = vi.fn(async () => undefined)
  render(<ProjectMachinesSettings projectId="p1" machines={[machine]} agents={[makeAgent({ id: 'a1', name: 'Mac' })]} onShare={vi.fn()} onSave={vi.fn()} onSetDefault={vi.fn()} onConfigureStorage={configure} onResetDirectory={reset} />)
  expect(screen.getByLabelText('Production: Mac')).toHaveValue(recommendations.production)
  await userEvent.selectOptions(screen.getByLabelText('MachineStorage: Mac'), 's2')
  expect(configure).toHaveBeenCalledWith('p1', 'a1', 's2', directories)
  await userEvent.click(screen.getByRole('button', { name: 'Сбросить' }))
  expect(reset).toHaveBeenCalledWith('p1', 'a1', 'mergeClones')
})

it('владелец выбирает уровень доступа предоставленной машины, участник видит пометку «только чтение» (п.18)', async () => {
  const onSetShareAccess = vi.fn()
  const mineMachine: ProjectMachine = { ...own, agentId: 'm1', name: 'Мак', sharedWithProject: true, shareAccess: 'full' }
  const sharedMachine: ProjectMachine = { ...other, agentId: 'm2', name: 'Чужая', sharedWithProject: true, shareAccess: 'read' }
  render(<ProjectMachinesSettings projectId="p1" machines={[mineMachine, sharedMachine]} agents={[makeAgent({ id: 'm1', name: 'Мак' })]} onShare={vi.fn()} onSetShareAccess={onSetShareAccess} onSave={vi.fn()} onSetDefault={vi.fn()} onConfigureStorage={vi.fn()} onResetDirectory={vi.fn()} />)
  const select = screen.getByLabelText('Доступ участников к машине Мак')
  expect(select).toHaveValue('full')
  fireEvent.change(select, { target: { value: 'read' } })
  expect(onSetShareAccess).toHaveBeenCalledWith('p1', 'm1', 'read')
  // у чужой машины участник видит пометку с пояснением, а не переключатель
  expect(screen.getByTitle(/Владелец разрешил только чтение/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Доступ участников к машине Чужая')).toBeNull()
})
