// Сториз страницы проекта: общая шапка с вкладками и оба раздела как
// содержимое, плюс крайние случаи раздела (нет проектов, проект не найден).
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { KanbanBoard } from './kanban'
import { makeBoard, makeDefaultColumns, makeMembers, makeTask, noopHandlers } from './kanban/fixtures'
import { ProjectNotFoundPage, ProjectPage, ProjectsEmptyPage, type ProjectSection } from './ProjectPage'

const meta: Meta<typeof ProjectPage> = {
  title: 'Projects/ProjectPage',
  component: ProjectPage,
  args: { projectName: 'Голос Чат', section: 'board', onSectionChange: () => {} }
}
export default meta
type Story = StoryObj<typeof ProjectPage>

const board = makeBoard(makeDefaultColumns(), [
  makeTask({ id: 'k1', title: 'Переключатель разделов', columnId: 'col-backlog' }),
  makeTask({ id: 'k2', title: 'Убрать страницу-список', columnId: 'col-ready', priority: 'high' })
])

/** Раздел «Канбан»: доска как содержимое общей шапки. */
export const Board: Story = {
  render: (args) => (
    <ProjectPage {...args}>
      <KanbanBoard
        projectName={args.projectName}
        board={board}
        loading={false}
        members={makeMembers('admin', 'bob')}
        currentUser="admin"
        {...noopHandlers()}
      />
    </ProjectPage>
  )
}

/** Раздел «Настройки»: то же место в шапке, другое содержимое. */
export const Settings: Story = {
  args: { section: 'settings' },
  render: (args) => (
    <ProjectPage {...args}>
      <div className="proj-detail">
        <p className="proj-field-label">Описание</p>
        <p>Голосовой клиент для Claude Code и Codex.</p>
      </div>
    </ProjectPage>
  )
}

/** Живой переключатель: вкладка меняет содержимое, шапка остаётся на месте. */
export const Switchable: Story = {
  render: (args) => {
    const [section, setSection] = useState<ProjectSection>('board')
    return (
      <ProjectPage {...args} section={section} onSectionChange={setSection}>
        {section === 'board' ? (
          <KanbanBoard
            projectName={args.projectName}
            board={board}
            loading={false}
            members={makeMembers('admin')}
            currentUser="admin"
            {...noopHandlers()}
          />
        ) : (
          <div className="proj-detail">
            <p className="proj-field-label">Описание</p>
            <p>Голосовой клиент для Claude Code и Codex.</p>
          </div>
        )}
      </ProjectPage>
    )
  }
}

/** Проектов нет вообще: создать можно только в сайдбаре. */
export const NoProjects: StoryObj = { render: () => <ProjectsEmptyPage /> }

/** id из адреса не найден: удалён или нет доступа. */
export const NotFound: StoryObj = { render: () => <ProjectNotFoundPage /> }
