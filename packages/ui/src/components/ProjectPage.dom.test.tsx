import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import userEvent from '@testing-library/user-event'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { ProjectNotFoundPage, ProjectPage, ProjectsEmptyPage, type ProjectSection } from './ProjectPage'

function renderPage(section: ProjectSection = 'board'): { onSectionChange: (s: ProjectSection) => void } {
  const onSectionChange = vi.fn()
  render(
    <ProjectPage projectName="Голос Чат" section={section} onSectionChange={onSectionChange}>
      <p>содержимое раздела</p>
    </ProjectPage>
  )
  return { onSectionChange }
}

const tabs = (): HTMLElement => screen.getByRole('tablist', { name: 'Разделы проекта' })

describe('ProjectPage — общая шапка страницы проекта', () => {
  it('в шапке имя проекта и две вкладки; активная помечена aria-selected', () => {
    renderPage('board')
    expect(screen.getByRole('heading', { name: 'Голос Чат' })).toBeInTheDocument()
    const items = within(tabs()).getAllByRole('tab')
    expect(items.map((t) => t.textContent)).toEqual(['Канбан', 'Настройки'])
    expect(items[0]).toHaveAttribute('aria-selected', 'true')
    expect(items[1]).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('содержимое раздела')).toBeInTheDocument()
  })

  // Страница проекта закрывается навигацией, а не крестиком: иначе Esc над
  // открытой карточкой задачи пришлось бы делить между карточкой и страницей.
  it('крестика закрытия в шапке нет', () => {
    renderPage('board')
    expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument()
  })

  it('клик по неактивной вкладке зовёт onSectionChange, по активной — нет', async () => {
    const { onSectionChange } = renderPage('board')
    await userEvent.click(within(tabs()).getByRole('tab', { name: 'Настройки' }))
    expect(onSectionChange).toHaveBeenCalledWith('settings')
    await userEvent.click(within(tabs()).getByRole('tab', { name: 'Канбан' }))
    expect(onSectionChange).toHaveBeenCalledTimes(1)
  })

  it('активная вкладка отмечена в разметке при входе в настройки', () => {
    renderPage('settings')
    const items = within(tabs()).getAllByRole('tab')
    expect(items[1]).toHaveAttribute('aria-selected', 'true')
    expect(items[1]?.className).toContain('on')
  })

  // Обещание роли tablist: раздел переключается стрелками, а не только мышью.
  it('стрелки переключают раздел', async () => {
    const { onSectionChange } = renderPage('board')
    within(tabs()).getByRole('tab', { name: 'Канбан' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onSectionChange).toHaveBeenLastCalledWith('settings')
  })

  it('стрелка влево из настроек возвращает на канбан', async () => {
    const { onSectionChange } = renderPage('settings')
    within(tabs()).getByRole('tab', { name: 'Настройки' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onSectionChange).toHaveBeenLastCalledWith('board')
  })

  it('без нарушений axe', async () => {
    renderPage('settings')
    await expectNoViolations()
    expectLabelledIconButtons()
  })
})

describe('ProjectPage — крайние случаи раздела', () => {
  it('проектов нет: пустое состояние ведёт создавать проект в сайдбаре', async () => {
    render(<ProjectsEmptyPage />)
    const page = screen.getByTestId('projects-empty')
    expect(within(page).getByText('Проектов пока нет')).toBeInTheDocument()
    expect(within(page).getByText(/\+ Проект/)).toBeInTheDocument()
    await expectNoViolations()
  })

  it('проекта из адреса нет: понятное сообщение, а не пустая доска', async () => {
    render(<ProjectNotFoundPage />)
    const page = screen.getByTestId('project-not-found')
    expect(within(page).getByRole('alert')).toHaveTextContent('Проект не найден')
    expect(within(page).queryByTestId('kanban-board')).not.toBeInTheDocument()
    await expectNoViolations()
  })
})
