import { describe, it, expect, vi } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { NewProjectDialog, typeCascadeLevels } from './NewProjectDialog'
import { BUILTIN_PROJECT_TYPES, BUILTIN_PROJECT_TYPE_IDS, type ProjectTypeNode } from '@shared/projectTypes'
import { expectNoViolations } from '../test/a11y'

const builtin = (): ProjectTypeNode[] =>
  BUILTIN_PROJECT_TYPES.map((node) => ({
    ...node, builtin: true, ownerId: null, status: 'published' as const,
    reviewNote: '', createdBy: 'system', createdAt: 0, updatedAt: 0
  }))

describe('typeCascadeLevels', () => {
  it('первый уровень — корни; выбор узла с детьми открывает следующий', () => {
    const types = builtin()
    expect(typeCascadeLevels(types, []).length).toBe(1)
    expect(typeCascadeLevels(types, []).map((l) => l.map((t) => t.id))).toEqual([
      [BUILTIN_PROJECT_TYPE_IDS.software, BUILTIN_PROJECT_TYPE_IDS.general]
    ])
    const two = typeCascadeLevels(types, [BUILTIN_PROJECT_TYPE_IDS.software])
    expect(two.length).toBe(2)
    expect(two[1].map((t) => t.id)).toEqual([BUILTIN_PROJECT_TYPE_IDS.web])
  })

  it('у листа следующего уровня нет', () => {
    expect(typeCascadeLevels(builtin(), [BUILTIN_PROJECT_TYPE_IDS.general]).length).toBe(1)
  })

  it('три уровня: подтип подтипа открывает третий селект', () => {
    // Ровно то, что получается после «Сохранить проект как подтип» у веб-проекта.
    const deep: ProjectTypeNode[] = [...builtin(), {
      id: 'own-deep', parentId: BUILTIN_PROJECT_TYPE_IDS.web, name: 'Лендинги',
      description: '', features: {}, defaults: {}, builtin: false, ownerId: 'bob',
      status: 'private', reviewNote: '', createdBy: 'bob', createdAt: 0, updatedAt: 0
    }]
    const levels = typeCascadeLevels(deep, [BUILTIN_PROJECT_TYPE_IDS.software, BUILTIN_PROJECT_TYPE_IDS.web])
    expect(levels.length).toBe(3)
    expect(levels[2].map((t) => t.id)).toEqual(['own-deep'])
    // И четвёртого уровня не появляется: у листа детей нет.
    expect(typeCascadeLevels(deep, [BUILTIN_PROJECT_TYPE_IDS.software, BUILTIN_PROJECT_TYPE_IDS.web, 'own-deep']).length).toBe(3)
  })
})

describe('NewProjectDialog', () => {
  const setup = (over: Partial<Parameters<typeof NewProjectDialog>[0]> = {}) => {
    const onCreate = vi.fn()
    const onClose = vi.fn()
    render(<NewProjectDialog types={builtin()} onCreate={onCreate} onClose={onClose} {...over} />)
    return { onCreate, onClose }
  }

  it('без имени создать нельзя', async () => {
    setup()
    expect(screen.getByRole('button', { name: 'Создать' })).toBeDisabled()
  })

  it('создаёт проект без уточнения типа', async () => {
    const { onCreate } = setup()
    await userEvent.type(screen.getByLabelText('Название'), '  Лендинг  ')
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    // Имя обрезано, тип не выбран.
    expect(onCreate).toHaveBeenCalledWith('Лендинг', undefined)
  })

  it('каскад раскрывает подтип и передаёт именно его', async () => {
    const { onCreate } = setup()
    await userEvent.type(screen.getByLabelText('Название'), 'Веб')
    await userEvent.selectOptions(screen.getByLabelText('Тип проекта'), BUILTIN_PROJECT_TYPE_IDS.software)
    const refine = await screen.findByLabelText('Уточнение')
    await userEvent.selectOptions(refine, BUILTIN_PROJECT_TYPE_IDS.web)
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(onCreate).toHaveBeenCalledWith('Веб', BUILTIN_PROJECT_TYPE_IDS.web)
  })

  it('смена типа на верхнем уровне сбрасывает уточнение', async () => {
    const { onCreate } = setup()
    await userEvent.type(screen.getByLabelText('Название'), 'P')
    await userEvent.selectOptions(screen.getByLabelText('Тип проекта'), BUILTIN_PROJECT_TYPE_IDS.software)
    await userEvent.selectOptions(await screen.findByLabelText('Уточнение'), BUILTIN_PROJECT_TYPE_IDS.web)
    await userEvent.selectOptions(screen.getByLabelText('Тип проекта'), BUILTIN_PROJECT_TYPE_IDS.general)
    // Уровня уточнения у «Общего проекта» нет — прежний выбор не должен утечь.
    await waitFor(() => expect(screen.queryByLabelText('Уточнение')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
    expect(onCreate).toHaveBeenCalledWith('P', BUILTIN_PROJECT_TYPE_IDS.general)
  })

  it('предупреждает у кнопки о последнем месте', async () => {
    setup({ quota: { owned: 4, limit: 5, unlimited: false } })
    expect(screen.getByRole('status')).toHaveTextContent('Осталось одно место: 4 из 5 проектов')
    await userEvent.type(screen.getByLabelText('Название'), 'Последний')
    expect(screen.getByRole('button', { name: 'Создать' })).not.toBeDisabled()
  })

  it('при исчерпанной квоте объясняет причину и блокирует создание', async () => {
    const { onCreate } = setup({ quota: { owned: 5, limit: 5, unlimited: false } })
    await userEvent.type(screen.getByLabelText('Название'), 'Шестой')
    const button = screen.getByRole('button', { name: 'Создать' })
    expect(screen.getByRole('status')).toHaveTextContent('Лимит исчерпан: 5 из 5 проектов')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Квота собственных проектов исчерпана')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('показывает, что тип включает, и честно называет пустой набор', async () => {
    setup()
    await userEvent.selectOptions(screen.getByLabelText('Тип проекта'), BUILTIN_PROJECT_TYPE_IDS.software)
    const summary = screen.getByTestId('new-project-type-summary')
    // Возможности показаны чипами: у «Разработки ПО» включено всё шесть.
    expect(within(summary).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['git', 'машины', 'CI', 'QA', 'релизы', 'превью'])

    await userEvent.selectOptions(screen.getByLabelText('Тип проекта'), BUILTIN_PROJECT_TYPE_IDS.general)
    expect(within(screen.getByTestId('new-project-type-summary')).getByText('только доска и задачи')).toBeInTheDocument()
  })

  it('доступность окна', async () => {
    setup()
    await expectNoViolations()
  })
})
