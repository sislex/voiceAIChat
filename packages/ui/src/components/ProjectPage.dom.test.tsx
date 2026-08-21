import { describe, it, expect, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import userEvent from '@testing-library/user-event'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { ProjectNotFoundPage, ProjectPage, ProjectsEmptyPage, type ProjectSection } from './ProjectPage'
import { ReleaseCenter } from './releases/ReleaseCenter'
import { createFakeApi } from '../test/fakeApi'
import type { ProjectRelease, ProjectReleaseSummary } from '@voicechat/shared'

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
  it('в шапке имя проекта и три вкладки; активная помечена aria-selected', () => {
    renderPage('board')
    expect(screen.getByRole('heading', { name: 'Голос Чат' })).toBeInTheDocument()
    const items = within(tabs()).getAllByRole('tab')
    expect(items.map((t) => t.textContent)).toEqual(['Канбан', 'Релизы', 'Настройки'])
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
    expect(items[2]).toHaveAttribute('aria-selected', 'true')
    expect(items[2]?.className).toContain('on')
  })

  // Обещание роли tablist: раздел переключается стрелками, а не только мышью.
  it('стрелки переключают раздел', async () => {
    const { onSectionChange } = renderPage('board')
    within(tabs()).getByRole('tab', { name: 'Канбан' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onSectionChange).toHaveBeenLastCalledWith('releases')
  })

  it('стрелка влево из настроек возвращает на канбан', async () => {
    const { onSectionChange } = renderPage('settings')
    within(tabs()).getByRole('tab', { name: 'Настройки' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onSectionChange).toHaveBeenLastCalledWith('releases')
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


describe('ReleaseCenter — список, деплой и лента', () => {
  const prepared: ProjectRelease = {
    id: 'prepare-1', projectId: 'p1', version: '1.2.3', branch: 'release/1.2.3', sha: 'a'.repeat(40), status: 'ready', triggeredBy: 'admin', attempt: 1, previousReleaseId: null, createdAt: 1_700_000_000_000, releasedAt: null,
    steps: [
      { id: 'kb', kind: 'knowledge_base', status: 'passed', model: null, attempt: 1, log: 'kb ok', startedAt: 1000, finishedAt: 2000 },
      { id: 'test', kind: 'regression', status: 'passed', model: null, attempt: 1, log: 'tests ok', startedAt: 2000, finishedAt: 5000 }
    ]
  }
  const deployment: ProjectRelease = {
    ...prepared, id: 'deploy-1', status: 'released', previousReleaseId: prepared.id, releasedAt: 1_700_000_010_000,
    steps: [
      { id: 'skip', kind: 'regression', status: 'skipped', model: null, attempt: 2, log: 'done before', startedAt: null, finishedAt: 1000 },
      { id: 'switch', kind: 'switching', status: 'passed', model: null, attempt: 2, log: 'switched', startedAt: 1000, finishedAt: 2000 },
      { id: 'build', kind: 'building', status: 'passed', model: null, attempt: 2, log: 'built', startedAt: 2000, finishedAt: 6000 },
      { id: 'health', kind: 'health_check', status: 'passed', model: null, attempt: 2, log: 'healthy', startedAt: 6000, finishedAt: 7000 }
    ]
  }
  const preparedSummary: ProjectReleaseSummary = { id:prepared.id,branch:prepared.branch,sha:prepared.sha,status:prepared.status,previousReleaseId:null,createdAt:prepared.createdAt,durationMs:4000 }
  const deploymentSummary: ProjectReleaseSummary = { id:deployment.id,branch:deployment.branch,sha:deployment.sha,status:deployment.status,previousReleaseId:prepared.id,createdAt:deployment.createdAt,durationMs:6000 }
  const api = () => {
    const value = createFakeApi()
    value['releases:branches'] = vi.fn(async () => [{ branch: prepared.branch, version: prepared.version, sha: prepared.sha }])
    value['releases:list'] = vi.fn(async () => [deploymentSummary, preparedSummary])
    value['releases:get'] = vi.fn(async ({ releaseId }) => releaseId === deployment.id ? deployment : prepared)
    return value
  }

  it('показывает таблицу релизов, загружает список один раз и открывает подробную ленту отдельным запросом', async () => {
    const value=api()
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    expect(await screen.findByRole('columnheader', { name: 'Время сборки' })).toBeInTheDocument()
    expect(value['releases:list']).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByText('release/1.2.3'))
    expect(value['releases:get']).toHaveBeenCalledWith({projectId:'p1',releaseId:prepared.id})
    expect(await screen.findByText('База знаний')).toBeInTheDocument()
    expect(screen.getByText('Regression')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скачать лог' })).toBeInTheDocument()
  })

  it('показывает ожидание подробностей и игнорирует поздний ответ после повторного выбора', async () => {
    const second:ProjectRelease={...prepared,id:'prepare-2',version:'2.0.0',branch:'release/2.0.0',sha:'b'.repeat(40)}
    const secondSummary:ProjectReleaseSummary={id:second.id,branch:second.branch,sha:second.sha,status:second.status,previousReleaseId:null,createdAt:second.createdAt+1,durationMs:4000}
    let resolveFirst!:(release:ProjectRelease)=>void
    const firstRequest=new Promise<ProjectRelease>(resolve=>{resolveFirst=resolve})
    const value=api()
    value['releases:list']=vi.fn(async()=>[secondSummary,preparedSummary])
    value['releases:get']=vi.fn(({releaseId})=>releaseId===prepared.id?firstRequest:Promise.resolve(second))
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value}/>)
    await userEvent.click(await screen.findByText(prepared.branch))
    expect(screen.getByText('Загружаем подробности релиза…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button',{name:'← К списку'}))
    await userEvent.click(await screen.findByText(second.branch))
    expect(await screen.findByRole('heading',{name:second.branch})).toBeInTheDocument()
    resolveFirst(prepared)
    expect(screen.getByRole('heading',{name:second.branch})).toBeInTheDocument()
  })

  it('показывает ошибку загрузки подробностей и позволяет повторить запрос', async () => {
    const value=api()
    value['releases:get']=vi.fn().mockRejectedValueOnce(new Error('detail down')).mockResolvedValue(prepared)
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value}/>)
    await userEvent.click(await screen.findByText(prepared.branch))
    expect(await screen.findByText('Не удалось загрузить подробности релиза')).toBeInTheDocument()
    expect(screen.getByText('detail down')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button',{name:'Повторить'}))
    expect(await screen.findByRole('button',{name:'Скачать лог'})).toBeInTheDocument()
  })

  it('в деплое скрывает подготовительные skipped-шаги', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={api()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Деплой' }))
    await userEvent.click(await screen.findByText('Последний деплой'))
    expect(screen.queryByText('Regression')).not.toBeInTheDocument()
    expect(screen.getByText('Переключение checkout')).toBeInTheDocument()
    expect(screen.getByText('Сборка и обновление контейнеров')).toBeInTheDocument()
    expect(screen.getByText('Health-check')).toBeInTheDocument()
  })

  it('создаёт релиз только на машине проекта по умолчанию', async () => {
    const value = api()
    value['releases:createBranch'] = vi.fn(async ({ projectId, branch }) => ({ ...prepared, projectId, branch, version: branch.slice('release/'.length) }))
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner defaultAgentId="mac" machines={[{ agentId: 'other', name: 'Server', path: '/srv/app', reposRoot: '/srv/repos', online: true }, { agentId: 'mac', name: 'MacBook', path: '/Users/me/app', reposRoot: '/Users/me/repos', online: true }]} api={value} />)
    const machine = await screen.findByRole('combobox', { name: 'Машина проекта по умолчанию' })
    expect(machine).toHaveValue('mac')
    expect(within(machine).getByRole('option', { name: 'MacBook · online · машина проекта' })).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('1.2.3'), '2.0.0')
    await userEvent.click(screen.getByRole('button', { name: 'Собрать новый релиз' }))
    expect(value['releases:createBranch']).toHaveBeenCalledWith({ projectId: 'p1', branch: 'release/2.0.0', baseBranch: 'main' })
  })

  it('разрешает release checkout через reposRoot, если обычный checkout не настроен', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner defaultAgentId="mac" machines={[{ agentId: 'mac', name: 'MacBook', path: '', reposRoot: '/Users/me/repos', online: true }]} api={api()} />)
    expect(await screen.findByRole('combobox', { name: 'Машина проекта по умолчанию' })).toHaveValue('mac')
    expect(screen.queryByText(/root-директория/)).not.toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('1.2.3'), '2.0.0')
    expect(screen.getByRole('button', { name: 'Собрать новый релиз' })).toBeEnabled()
  })

  it('показывает пустое состояние после успешной загрузки списка', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={createFakeApi()}/>)
    expect(await screen.findByText('Релизов пока нет')).toBeInTheDocument()
    expect(screen.queryByTestId('skeleton-list')).not.toBeInTheDocument()
  })

  it('показывает загрузку и ошибки релизов и деплоев', async () => {
    const value = createFakeApi()
    const rejectReleases: Array<(reason: Error) => void> = []
    value['releases:list'] = vi.fn(() => new Promise<ProjectReleaseSummary[]>((_resolve, reject) => { rejectReleases.push(reject) }))
    value['releases:branches'] = vi.fn(async () => [])
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner api={value} />)
    expect(screen.getByTestId('skeleton-list')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Деплой' }))
    expect(screen.getByTestId('skeleton-list')).toBeInTheDocument()
    rejectReleases.forEach(reject => reject(new Error('network down')))
    expect(await screen.findByText('Не удалось загрузить деплои')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Релизы' }))
    expect(await screen.findByText('Не удалось загрузить релизы')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })

  it('назначает личную машину дефолтом, сначала привязав её к проекту', async () => {
    const value = api()
    value['projects:linkMachine'] = vi.fn(async () => ({}) as never)
    value['projects:setDefaultMachine'] = vi.fn(async () => ({}) as never)
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner machines={[]} agents={[{ id: 'personal', name: 'Мой Mac', online: true } as never]} api={value} />)
    const select = await screen.findByRole('combobox', { name: 'Машина проекта по умолчанию' })
    expect(within(select).getByRole('option', { name: 'Мой Mac · online · личная машина' })).toBeInTheDocument()
    await userEvent.selectOptions(select, 'personal')
    expect(value['projects:linkMachine']).toHaveBeenCalledWith({ id: 'p1', agentId: 'personal' })
    expect(value['projects:setDefaultMachine']).toHaveBeenCalledWith({ id: 'p1', agentId: 'personal' })
  })

  it('явно помечает сохранённую машину, которая стала недоступна', async () => {
    render(<ReleaseCenter projectId="p1" baseBranch="main" owner defaultAgentId="gone" machines={[]} agents={[]} api={api()} />)
    const select = await screen.findByRole('combobox', { name: 'Машина проекта по умолчанию' })
    expect(select).toHaveValue('gone')
    expect(within(select).getByRole('option', { name: 'Ранее выбранная машина · недоступна' })).toBeInTheDocument()
    expect(screen.getByText('Машина проекта по умолчанию не подключена к проекту.')).toBeInTheDocument()
  })
})
