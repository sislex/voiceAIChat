import { expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectMachine } from '@shared/projects'
import { render } from '../test/uiRender'
import { makeAgent } from '../test/fixtures'
import { ProjectMachinesSettings } from './ProjectMachinesSettings'

const own: ProjectMachine = { agentId: 'a1', name: 'Mac', owner: 'alice', ownership: 'mine', online: true, sharedWithProject: true, isMyDefault: true, canUse: true, load: 0, path: '/old', reposRoot: '/repos', sshHost: 'mac.local', sshUser: 'alice' }
const other: ProjectMachine = { ...own, agentId: 'a2', name: 'CI', owner: 'bob', ownership: 'other', isMyDefault: false }
const setup = (onSave = vi.fn(async () => undefined)) => render(<ProjectMachinesSettings projectId="p1" machines={[own, other]} agents={[makeAgent({ id: 'a1', name: 'Mac' })]} onShare={vi.fn()} onSave={onSave} onSetDefault={vi.fn()} />)

it('показывает две таблицы, подписи и readonly-конфигурацию чужой машины', () => {
  setup()
  expect(screen.getByRole('heading', { name: 'Мои машины' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Машины, предоставленные проекту' })).toBeInTheDocument()
  expect(screen.getByLabelText('Папка проекта: CI')).toHaveAttribute('readonly')
  expect(screen.getAllByText('Папка проекта', { selector: 'label' })).toHaveLength(2)
  expect(screen.getByLabelText('Подсказка: SSH hostname/IP — Mac')).toHaveAttribute('title', expect.stringContaining('SSH-подключения'))
  expect(screen.getByLabelText('Подсказка: SSH hostname/IP — CI')).toHaveAttribute('tabindex', '0')
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
