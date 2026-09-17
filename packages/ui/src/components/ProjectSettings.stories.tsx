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
    return <div className="project-settings-story-host"><ProjectSettings {...args} detail={detail} onUpdate={(_id, fields) => setDetail(current => ({ ...current, ...fields, defaultSkills: { ...current.defaultSkills, ...fields.defaultSkills } }))} /></div>
  }
}
export default meta
type Story = StoryObj<typeof ProjectSettings>
const longDetail = makeSettingsProject({
  name: 'Проект с очень длинным названием для проверки мобильной геометрии',
  description: 'Длинное описание проекта не должно расширять документ за границы мобильного viewport.',
  gitUrl: 'git@example.com:team/repository-with-a-very-long-name.git',
  previewUrl: 'https://preview.example.com/projects/a-very-long-project-address',
  members: [
    { username: 'admin-with-a-very-long-username@example.com', role: 'owner', addedAt: 1 },
    { username: 'readonly-participant-with-long-name', role: 'member', addedAt: 2 }
  ],
  machines: [{
    agentId: 'a1', name: 'MacBook with a very long descriptive machine name',
    path: '/Users/developer/projects/a-very-long-project-directory/repository',
    reposRoot: '/Users/developer/projects', online: true, ownership: 'mine', sharedWithProject: true
  }],
  defaultAgentId: 'a1', testCommand: 'npm run test -- --filter=a-very-long-component-name'
})
const longAgents = [makeAgent({ id: 'a1', name: 'MacBook with a very long descriptive machine name' })]
const storyForTab = (activeTab: 'general' | 'llm' | 'board' | 'workflow' | 'members' | 'machines', mobile = false): Story => ({
  args: { activeTab, detail: longDetail, agents: longAgents },
  parameters: mobile ? { viewport: { defaultViewport: 'mobile1' } } : undefined
})

export const Overview: Story = { args: { detail: longDetail, agents: longAgents } }
export const General: Story = storyForTab('general')
export const Llm: Story = storyForTab('llm')
export const Board: Story = storyForTab('board')
export const Workflow: Story = storyForTab('workflow')
export const Members: Story = storyForTab('members')
export const Machines: Story = storyForTab('machines')
export const GeneralMobile: Story = storyForTab('general', true)
export const LlmMobile: Story = storyForTab('llm', true)
export const BoardMobile: Story = storyForTab('board', true)
export const WorkflowMobile: Story = storyForTab('workflow', true)
export const MembersMobile: Story = storyForTab('members', true)
export const MachinesResponsive: Story = storyForTab('machines', true)
export const ValidationErrors: Story = {
  play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByLabelText('Git-репозиторий'), 'invalid-url') }
}
export const UnsavedChanges: Story = {
  play: async ({ canvasElement }) => { await userEvent.type(within(canvasElement).getByLabelText('Название проекта'), ' — черновик') }
}
export const Mobile: Story = {
  ...UnsavedChanges,
  parameters: { viewport: { defaultViewport: 'mobile1' } }
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

