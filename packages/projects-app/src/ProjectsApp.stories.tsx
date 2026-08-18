import type { Meta, StoryObj } from '@storybook/react'
import type { ProjectsClient } from './contracts'
import { ProjectsApp } from './ProjectsApp'
import { ProjectsProvider } from './store/ProjectsProvider'
import { createProjectsStore } from './store/projectsStore'

const client = new Proxy({}, { get: () => async () => [] }) as ProjectsClient
const store = createProjectsStore(client)
const meta = {
  title: 'Projects/Module harness',
  component: ProjectsApp,
  decorators: [(Story) => <ProjectsProvider store={store}><Story /></ProjectsProvider>],
  args: { route: { name: 'projects' }, render: ({ projectsLoaded }) => <p>{projectsLoaded ? 'Нет проектов' : 'Загрузка проектов…'}</p> }
} satisfies Meta<typeof ProjectsApp>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Loading: Story = { args: { render: () => <p role="status">Загрузка доски…</p> } }
export const KanbanLongCards: Story = { args: { render: () => <article><h2>Длинная карточка</h2><p>{'Описание задачи · '.repeat(24)}</p></article> } }
