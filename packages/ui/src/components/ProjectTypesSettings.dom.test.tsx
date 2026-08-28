import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { ProjectTypesSettings, flattenTypeTree } from './ProjectTypesSettings'
import { expectNoViolations } from '../test/a11y'
import { BUILTIN_PROJECT_TYPES, BUILTIN_PROJECT_TYPE_IDS, type ProjectTypeNode } from '@shared/projectTypes'

const builtin: ProjectTypeNode[] = BUILTIN_PROJECT_TYPES.map((node) => ({
  ...node, builtin: true, ownerId: null, status: 'published' as const,
  reviewNote: '', createdBy: 'system', createdAt: 0, updatedAt: 0
}))

const own = (over: Partial<ProjectTypeNode> = {}): ProjectTypeNode => ({
  id: 'own1', parentId: BUILTIN_PROJECT_TYPE_IDS.software, name: 'Бэкенд-сервис',
  description: 'Из проекта «API»', features: { preview: false }, defaults: {},
  builtin: false, ownerId: 'bob', status: 'private', reviewNote: '',
  createdBy: 'bob', createdAt: 0, updatedAt: 0, ...over
})

describe('flattenTypeTree', () => {
  it('обходит от корней вглубь, встроенные впереди пользовательских', () => {
    const rows = flattenTypeTree([...builtin, own()])
    expect(rows.map((r) => `${r.depth}:${r.node.name}`)).toEqual([
      '0:Разработка ПО', '1:Веб-приложение', '1:Бэкенд-сервис', '0:Общий проект'
    ])
  })

  it('узел с недостающим родителем не теряется молча… он просто не всплывает', () => {
    // Сирота не попадает в обход от корней — это осознанно: показывать его без
    // цепочки некуда, а сервер такие узлы не отдаёт (родитель удаляется только
    // вместе с детьми).
    expect(flattenTypeTree([own({ parentId: 'нет-такого' })])).toEqual([])
  })
})

describe('ProjectTypesSettings', () => {
  it('показывает дерево со статусом и возможностями', () => {
    render(<ProjectTypesSettings types={[...builtin, own()]} currentUsername="bob" />)
    const items = screen.getAllByRole('listitem')
    expect(items.some((li) => li.textContent?.includes('встроенный'))).toBe(true)
    expect(screen.getByText(/Бэкенд-сервис/)).toBeInTheDocument()
    expect(screen.getByText(/личный/)).toBeInTheDocument()
    // У «Общего проекта» возможностей нет — так и написано.
    expect(screen.getAllByText('только доска и задачи').length).toBeGreaterThan(0)
  })

  it('свой личный узел можно отправить на утверждение и удалить', async () => {
    const onPublish = vi.fn()
    const onDelete = vi.fn()
    render(<ProjectTypesSettings types={[...builtin, own()]} currentUsername="bob" onPublish={onPublish} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'Отправить на утверждение' }))
    expect(onPublish).toHaveBeenCalledWith('own1')
    await userEvent.click(screen.getByRole('button', { name: /Удалить тип/ }))
    expect(onDelete).toHaveBeenCalledWith('own1')
  })

  it('чужие и встроенные узлы без кнопок управления', () => {
    render(<ProjectTypesSettings types={[...builtin, own({ ownerId: 'carol' })]} currentUsername="bob" onPublish={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Отправить на утверждение' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Удалить тип/ })).not.toBeInTheDocument()
  })

  it('опубликованный узел не удаляется, но публикацию можно отозвать', async () => {
    const onUnpublish = vi.fn()
    render(<ProjectTypesSettings types={[...builtin, own({ status: 'published' })]} currentUsername="bob" onUnpublish={onUnpublish} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Удалить тип/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Отозвать' }))
    expect(onUnpublish).toHaveBeenCalledWith('own1')
  })

  it('причина отказа видна автору', () => {
    render(<ProjectTypesSettings types={[own({ status: 'rejected', reviewNote: 'слишком узкий', parentId: null })]} currentUsername="bob" />)
    expect(screen.getByRole('note')).toHaveTextContent('Отклонено: слишком узкий')
  })

  it('создание подтипа передаёт имя и родителя', async () => {
    const onCreate = vi.fn()
    render(<ProjectTypesSettings types={builtin} currentUsername="bob" onCreate={onCreate} />)
    await userEvent.type(screen.getByLabelText('Название подтипа'), '  Мобильное  ')
    await userEvent.selectOptions(screen.getByLabelText('Родитель'), BUILTIN_PROJECT_TYPE_IDS.software)
    await userEvent.click(screen.getByRole('button', { name: 'Создать подтип' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'Мобильное', parentId: BUILTIN_PROJECT_TYPE_IDS.software })
  })

  it('пустой каталог объясняет следующий шаг', () => {
    render(<ProjectTypesSettings types={[]} currentUsername="bob" onCreate={vi.fn()} />)
    expect(within(screen.getByTestId('project-types-settings')).getByText('Типов пока нет')).toBeInTheDocument()
  })

  it('доступность экрана', async () => {
    render(<ProjectTypesSettings types={[...builtin, own()]} currentUsername="bob" onCreate={vi.fn()} onPublish={vi.fn()} onDelete={vi.fn()} />)
    await expectNoViolations()
  })
})

describe('ProjectTypesSettings — состояния загрузки', () => {
  it('первая загрузка показывает скелетон, а не «типов нет»', () => {
    render(<ProjectTypesSettings types={[]} status="loading" />)
    expect(screen.queryByText('Типов пока нет')).not.toBeInTheDocument()
  })

  it('ошибка отличается от пустоты и предлагает повторить', async () => {
    const onRetry = vi.fn()
    render(<ProjectTypesSettings types={[]} status="error" error="Сеть недоступна" onRetry={onRetry} />)
    // Раньше сбой загрузки выглядел как «типов нет» — и человек шёл создавать дубль.
    expect(screen.queryByText('Типов пока нет')).not.toBeInTheDocument()
    expect(screen.getByText('Не удалось загрузить типы проектов')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('ошибка при уже показанном списке не прячет данные', () => {
    render(<ProjectTypesSettings types={builtin} status="error" error="Сеть недоступна" currentUsername="bob" />)
    expect(screen.getByText('Список типов мог устареть')).toBeInTheDocument()
    // Дерево остаётся на экране: подменять его баннером — терять контекст.
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0)
  })
})

describe('ProjectTypesSettings — ошибка создания', () => {
  it('текст ошибки виден под полем, имя не теряется', async () => {
    const onCreate = vi.fn().mockResolvedValue('Такой тип уже есть')
    render(<ProjectTypesSettings types={builtin} currentUsername="bob" onCreate={onCreate} />)
    await userEvent.type(screen.getByLabelText('Название подтипа'), 'Дубль')
    await userEvent.click(screen.getByRole('button', { name: 'Создать подтип' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Такой тип уже есть')
    // Перенабирать имя заново незачем — ошибка чаще всего в нём.
    expect(screen.getByLabelText('Название подтипа')).toHaveValue('Дубль')
  })

  it('успех очищает поле и не оставляет ошибку', async () => {
    const onCreate = vi.fn().mockResolvedValue(null)
    render(<ProjectTypesSettings types={builtin} currentUsername="bob" onCreate={onCreate} />)
    await userEvent.type(screen.getByLabelText('Название подтипа'), 'Новый')
    await userEvent.click(screen.getByRole('button', { name: 'Создать подтип' }))
    await waitFor(() => expect(screen.getByLabelText('Название подтипа')).toHaveValue(''))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('правка имени убирает прежнюю ошибку', async () => {
    const onCreate = vi.fn().mockResolvedValue('Занято')
    render(<ProjectTypesSettings types={builtin} currentUsername="bob" onCreate={onCreate} />)
    await userEvent.type(screen.getByLabelText('Название подтипа'), 'X')
    await userEvent.click(screen.getByRole('button', { name: 'Создать подтип' }))
    await screen.findByRole('alert')
    await userEvent.type(screen.getByLabelText('Название подтипа'), 'Y')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
