import type { Meta, StoryObj } from '@storybook/react'
import { expect, fn, userEvent, within } from '@storybook/test'
import type { ProjectMachine } from '@shared/projects'
import { makeAgent, makeOfflineAgent } from '../test/fixtures'
import { ProjectMachinesSettings } from './ProjectMachinesSettings'

const machines: ProjectMachine[] = [
  { agentId: 'mine-online', name: 'Мой Mac', owner: 'alice', ownership: 'mine', online: true, sharedWithProject: true, isMyDefault: true, canUse: true, load: 1, path: '/Users/alice/project', reposRoot: '/Users/alice/VoiceAIChatRepos', sshHost: 'mac.local', sshUser: 'alice' },
  { agentId: 'mine-offline', name: 'Домашний ПК', owner: 'alice', ownership: 'mine', online: false, sharedWithProject: false, isMyDefault: false, canUse: true, load: 0, path: '', reposRoot: '', sshHost: '', sshUser: '' },
  { agentId: 'shared', name: 'CI — очень длинное название машины для проверки переноса', owner: 'bob', ownership: 'other', online: true, sharedWithProject: true, isMyDefault: false, canUse: true, load: 3, path: '/srv/checkouts/project/with/a/very/long/path', reposRoot: '/srv/VoiceAIChatRepos', sshHost: 'ci.internal.example.test', sshUser: 'runner' },
  { agentId: 'unavailable', name: 'Недоступная', owner: 'carol', ownership: 'other', online: false, sharedWithProject: true, isMyDefault: false, canUse: false, unavailableReason: 'владелец больше не участник', load: 0, path: '/opt/project', reposRoot: '/opt/repos', sshHost: '10.0.0.8', sshUser: 'deploy' }
]
const meta: Meta<typeof ProjectMachinesSettings> = {
  title: 'Project Settings/Machines', component: ProjectMachinesSettings,
  args: {
    projectId: 'p1', machines,
    agents: [makeAgent({ id: 'mine-online', name: 'Мой Mac' }), makeOfflineAgent({ id: 'mine-offline', name: 'Домашний ПК' })],
    onShare: fn(), onSave: fn(async () => undefined), onSetDefault: fn()
  }
}
export default meta
type Story = StoryObj<typeof ProjectMachinesSettings>
export const Overview: Story = {}
export const EmptyTables: Story = { args: { machines: [], agents: [] } }
export const Loading: Story = { render: () => <div role="status">Загрузка машин…</div> }
export const LoadError: Story = { render: () => <div role="alert">Не удалось загрузить машины</div> }
export const SaveError: Story = { args: { onSave: fn(async () => { throw new Error('HTTP 500') }) } }
export const ShareAndEdit: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Предоставить текущему проекту: Домашний ПК'))
    await expect(args.onShare).toHaveBeenCalledWith('p1', 'mine-offline', true)
    const path = canvas.getByLabelText('Папка проекта: Мой Mac')
    await userEvent.clear(path); await userEvent.type(path, '/new/project{Enter}')
    await expect(args.onSave).toHaveBeenCalledWith('p1', 'mine-online', 'path', '/new/project', expect.anything())
    await expect(canvas.getByLabelText('Папка проекта: CI — очень длинное название машины для проверки переноса')).toHaveAttribute('readonly')
  }
}
export const PersonalDefault: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByLabelText('По умолчанию: CI — очень длинное название машины для проверки переноса'))
    await expect(args.onSetDefault).toHaveBeenCalledWith('p1', 'shared')
  }
}
