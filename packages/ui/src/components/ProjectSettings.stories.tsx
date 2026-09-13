import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { userEvent, within } from '@storybook/test'
import { ProjectSettings } from './ProjectSettings'
import { makeSettingsProject } from '../test/fixtures/projectSettings'
import { withBridges } from '../test/storyBridges'
import { makeAgent } from '../test/fixtures'

const noop = (): void => {}
const meta: Meta<typeof ProjectSettings> = {
  title: 'Projects/ProjectSettings',
  component: ProjectSettings,
  decorators: [withBridges()],
  parameters: { layout: 'fullscreen' },
  args: {
    detail: makeSettingsProject(), agents: [],
    onUpdate: noop, onDelete: noop, onUpdateMemberRole: noop, onRemoveMember: noop,
    onLinkMachine: noop, onUnlinkMachine: noop, onSetMachinePath: noop,
    onSetReposRoot: noop, onSetMachineSsh: noop, onSetDefaultMachine: noop
  },
  render: args => {
    const [detail, setDetail] = useState(args.detail)
    return <div style={{ padding: 16 }}><ProjectSettings {...args} detail={detail} onUpdate={(_id, fields) => setDetail(current => ({ ...current, ...fields, defaultSkills: { ...current.defaultSkills, ...fields.defaultSkills } }))} /></div>
  }
}
export default meta
type Story = StoryObj<typeof ProjectSettings>
export const Overview: Story = {}
export const ValidationErrors: Story = {
  play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByLabelText('Git-репозиторий'), 'invalid-url') }
}
export const UnsavedChanges: Story = {
  play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByLabelText('Название проекта'), ' — черновик') }
}
export const Mobile: Story = {
  ...UnsavedChanges,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  decorators: [Story => <div style={{ width: 390, maxWidth: '100%' }}><Story /></div>]
}
export const ProductionResult: Story = {
  args: {
    activeTab: 'workflow',
    detail: makeSettingsProject({
      productionEnvironmentMode: 'legacy', productionAgentId: 'a1',
      productionCheckoutPath: '/srv/project', productionHealthCheckCommand: 'curl -fsS http://localhost/health',
      gitUrl: 'git@example.com:team/repo.git',
      machines: [{ agentId: 'a1', name: 'Production', path: '/srv/project', reposRoot: '/srv/repos', online: true, ownership: 'mine', sharedWithProject: true }]
    }),
    agents: [makeAgent({ id: 'a1', name: 'Production' })]
  },
  play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole('button', { name: 'Проверить production' })) }
}
export const MachinesMobile: Story = {
  args: {
    ...ProductionResult.args,
    activeTab: 'machines',
    detail: { ...ProductionResult.args!.detail!, defaultAgentId: 'a1' }
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  play: async ({ canvasElement }) => { await userEvent.click(within(canvasElement).getByRole('button', { name: 'Проверить путь: Папка проекта — Production' })) }
}

