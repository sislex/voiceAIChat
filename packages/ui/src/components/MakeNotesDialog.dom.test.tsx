import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { createFakeApi } from '../test/fakeApi'
import { MakeNotesDialog } from './MakeNotesDialog'

function setup() {
  const api = createFakeApi([])
  const setNotes = vi.spyOn(api, 'make:setNotes')
  const applyTemplate = vi.spyOn(api, 'make:template')
  render(<MakeNotesDialog conversationId="make-1" api={api} onClose={() => {}} />)
  return { api, setNotes, applyTemplate }
}

async function waitUntilLoaded(): Promise<void> {
  await waitFor(() => expect(screen.getByLabelText('Заметки проекта')).toBeEnabled())
}

describe('MakeNotesDialog (roadmap-4 пп.6–7)', () => {
  // @testCase TC-1
  it('показывает четыре стека и независимую стилевую базу', async () => {
    setup()
    await waitUntilLoaded()

    const stackMenu = screen.getByRole('combobox', { name: 'Стек интерфейса' })
    expect(within(stackMenu).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'React', 'Angular', 'Чистый HTML + CSS + JS', 'Чистый HTML + CSS'
    ])
    expect(stackMenu).toHaveValue('html-js')

    const uiKitMenu = screen.getByRole('combobox', { name: 'Стилевая база' })
    expect(within(uiKitMenu).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Своя система', 'Bootstrap 5.3'
    ])
    expect(uiKitMenu).toHaveValue('none')
  })

  // @testCase TC-2
  it('сохраняет Bootstrap без подтверждения смены стека', async () => {
    const { setNotes, applyTemplate } = setup()
    await waitUntilLoaded()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Стилевая база' }), 'bootstrap')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(setNotes).toHaveBeenCalledWith({
      conversationId: 'make-1', notes: '', mode: 'balanced', stack: 'html-js', uiKit: 'bootstrap'
    }))
    expect(screen.queryByRole('dialog', { name: 'Смена стека' })).toBeNull()
    expect(applyTemplate).not.toHaveBeenCalled()
  })

  // @testCase TC-3
  it('меняет стек только в настройках и не заменяет файлы', async () => {
    const { setNotes, applyTemplate } = setup()
    await waitUntilLoaded()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Стек интерфейса' }), 'angular')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Смена стека' })).getByRole('button', { name: 'Только настройка' }))

    await waitFor(() => expect(setNotes).toHaveBeenCalledWith(expect.objectContaining({ stack: 'angular', uiKit: 'none' })))
    expect(applyTemplate).not.toHaveBeenCalled()
  })

  // @testCase TC-4
  it('меняет стек и применяет выбранный стартовый шаблон', async () => {
    const { setNotes, applyTemplate } = setup()
    await waitUntilLoaded()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Стек интерфейса' }), 'react')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Смена стека' })).getByRole('button', { name: 'Настройка + применить шаблон' }))

    await waitFor(() => expect(setNotes).toHaveBeenCalledWith(expect.objectContaining({ stack: 'react' })))
    expect(applyTemplate).toHaveBeenCalledWith({ conversationId: 'make-1', templateId: 'react' })
  })

  // @testCase TC-5
  it('закрывает подтверждение смены стека без сохранения', async () => {
    const { setNotes, applyTemplate } = setup()
    await waitUntilLoaded()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Стек интерфейса' }), 'angular')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    const confirm = screen.getByRole('dialog', { name: 'Смена стека' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Закрыть' }))

    expect(screen.queryByRole('dialog', { name: 'Смена стека' })).toBeNull()
    expect(setNotes).not.toHaveBeenCalled()
    expect(applyTemplate).not.toHaveBeenCalled()
  })

  // @testCase TC-7
  it('показывает ошибку сохранения и разрешает повторную попытку', async () => {
    const { api, setNotes } = setup()
    setNotes.mockRejectedValueOnce(new Error('Сервис настроек недоступен'))
    await waitUntilLoaded()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Стилевая база' }), 'bootstrap')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('Сервис настроек недоступен')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(setNotes).toHaveBeenCalledTimes(2))
    expect(await api['make:notes']({ conversationId: 'make-1' })).toMatchObject({ stack: 'html-js', uiKit: 'bootstrap' })
  })
})

const CONVERSATION = 'make-notes-test'
const choices = [
  ['React', 'react'],
  ['Angular', 'angular'],
  ['Чистый HTML + CSS + JS', 'html-js'],
  ['Чистый HTML + CSS', 'html']
] as const

afterEach(cleanup)

async function openWith(stack: 'html' | 'html-js' | 'react' | 'angular' = 'html-js', uiKit: 'none' | 'bootstrap' = 'none') {
  const api = createFakeApi([])
  await api['make:setNotes']({ conversationId: CONVERSATION, stack, uiKit })
  const onSaved = vi.fn()
  render(<MakeNotesDialog conversationId={CONVERSATION} api={api} onClose={() => {}} onSaved={onSaved} />)
  const menu = await screen.findByRole('combobox', { name: 'Стек интерфейса' })
  await waitFor(() => expect(menu).toBeEnabled())
  const uiKitMenu = screen.getByRole('combobox', { name: 'Стилевая база' })
  return { api, menu, uiKitMenu, onSaved }
}

describe('MakeNotesDialog — полный контракт настроек', () => {
  // @testCase TC-UI-01
  it('показывает четыре стека и отдельно восстанавливает Bootstrap', async () => {
    const { menu, uiKitMenu } = await openWith('html-js', 'bootstrap')
    expect(within(menu).getAllByRole('option').map((option) => option.textContent)).toEqual(choices.map(([title]) => title))
    expect(menu).toHaveValue('html-js')
    expect(uiKitMenu).toHaveValue('bootstrap')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  })

  // @testCase TC-UI-02
  it.each(choices)('преобразует пункт %s в stack=%s', async (title, stack) => {
    const initialStack = stack === 'html-js' ? 'react' : 'html-js'
    const { api, menu, onSaved } = await openWith(initialStack)
    const saveNotes = vi.spyOn(api, 'make:setNotes')
    await userEvent.selectOptions(menu, title)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    if (stack !== initialStack) {
      const confirm = await screen.findByTestId('make-stack-confirm')
      await userEvent.click(within(confirm).getByRole('button', { name: 'Только настройка' }))
    }
    await waitFor(() => expect(saveNotes).toHaveBeenLastCalledWith(expect.objectContaining({ stack, uiKit: 'none' })))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ stack, uiKit: 'none' }))
    expect(screen.getByText('Настройки проекта сохранены')).toBeInTheDocument()
  })

  // @testCase TC-INT-01
  it.each(choices)('применяет для %s шаблон вычисленного stack', async (title, stack) => {
    const initialStack = stack === 'react' ? 'angular' : 'react'
    const { api, menu } = await openWith(initialStack)
    const applyTemplate = vi.spyOn(api, 'make:template')
    await userEvent.selectOptions(menu, title)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    const confirm = await screen.findByTestId('make-stack-confirm')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Настройка + применить шаблон' }))
    await waitFor(() => expect(applyTemplate).toHaveBeenCalledWith({
      conversationId: CONVERSATION,
      templateId: stack === 'html-js' ? 'blank' : stack
    }))
  })

  // @testCase TC-NEG-01
  it('показывает ошибки загрузки, сохранения и шаблона и разрешает повторную попытку', async () => {
    const loadApi = createFakeApi([])
    vi.spyOn(loadApi, 'make:notes').mockRejectedValueOnce(new Error('load failed'))
    render(<MakeNotesDialog conversationId={CONVERSATION} api={loadApi} onClose={() => {}} />)
    expect(await screen.findByText('load failed')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Стек интерфейса' })).toBeDisabled()

    cleanup()
    const { api, uiKitMenu, onSaved } = await openWith('html-js')
    const save = vi.spyOn(api, 'make:setNotes').mockRejectedValueOnce(new Error('save failed'))
    await userEvent.selectOptions(uiKitMenu, 'bootstrap')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('save failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
    expect(onSaved).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    cleanup()
    const templateCase = await openWith('html-js')
    vi.spyOn(templateCase.api, 'make:template').mockRejectedValueOnce(new Error('template failed'))
    await userEvent.selectOptions(templateCase.menu, 'React')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await userEvent.click(within(await screen.findByTestId('make-stack-confirm')).getByRole('button', { name: 'Настройка + применить шаблон' }))
    expect(await screen.findByText('template failed')).toBeInTheDocument()
    expect(within(screen.getByTestId('make-stack-confirm')).getByRole('button', { name: 'Настройка + применить шаблон' })).toBeEnabled()
    expect(templateCase.onSaved).not.toHaveBeenCalled()
  })

  // @testCase TC-10
  it('сохраняет заметки и режим ассистента', async () => {
    const { api, onSaved } = await openWith()
    const ta = screen.getByLabelText('Заметки проекта')
    await userEvent.type(ta, '- акцент синий')
    await userEvent.click(screen.getByRole('radio', { name: /Дизайнер/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ notes: '- акцент синий', mode: 'designer', stack: 'html-js', uiKit: 'none' }))
    expect(await api['make:notes']({ conversationId: CONVERSATION })).toEqual({ notes: '- акцент синий', mode: 'designer', stack: 'html-js', uiKit: 'none' })
  })
})
