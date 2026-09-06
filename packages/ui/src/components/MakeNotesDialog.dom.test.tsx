import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { createFakeApi } from '../test/fakeApi'
import { MakeNotesDialog } from './MakeNotesDialog'

const CONVERSATION = 'make-notes-test'
const choices = [
  ['React', 'react', 'none'],
  ['Angular', 'angular', 'none'],
  ['Bootstrap', 'html-js', 'bootstrap'],
  ['Чистый HTML + CSS + JS', 'html-js', 'none'],
  ['Чистый HTML + CSS', 'html', 'none']
] as const

afterEach(cleanup)

async function openWith(stack: 'html' | 'html-js' | 'react' | 'angular' = 'html-js', uiKit: 'none' | 'bootstrap' = 'none') {
  const api = createFakeApi([])
  await api['make:setNotes']({ conversationId: CONVERSATION, stack, uiKit })
  const onSaved = vi.fn()
  render(<MakeNotesDialog conversationId={CONVERSATION} api={api} onClose={() => {}} onSaved={onSaved} />)
  const menu = await screen.findByRole('combobox', { name: 'Стек интерфейса' })
  await waitFor(() => expect(menu).toBeEnabled())
  return { api, menu, onSaved }
}

describe('MakeNotesDialog (roadmap-4 пп.6–7)', () => {
  // @testCase TC-UI-01
  it('показывает единое меню из пяти вариантов в заданном порядке и восстанавливает сохранённый выбор', async () => {
    const { menu } = await openWith('html-js', 'bootstrap')
    expect(within(menu).getAllByRole('option').map((option) => option.textContent)).toEqual(choices.map(([title]) => title))
    expect(menu).toHaveValue('bootstrap')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()

    cleanup()
    const legacy = await openWith('react', 'bootstrap')
    expect(legacy.menu).toHaveValue('react')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  })

  // @testCase TC-UI-02
  it.each(choices)('преобразует пункт %s в stack=%s и uiKit=%s', async (title, stack, uiKit) => {
    const initialStack = stack === 'html-js' ? 'react' : 'html-js'
    const { api, menu, onSaved } = await openWith(initialStack)
    const saveNotes = vi.spyOn(api, 'make:setNotes')
    await userEvent.selectOptions(menu, title)
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    if (stack !== initialStack) {
      const confirm = await screen.findByTestId('make-stack-confirm')
      await userEvent.click(within(confirm).getByRole('button', { name: 'Только настройка' }))
    }
    await waitFor(() => expect(saveNotes).toHaveBeenLastCalledWith(expect.objectContaining({ stack, uiKit })))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ stack, uiKit }))
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
    const { api, menu, onSaved } = await openWith('html-js')
    const save = vi.spyOn(api, 'make:setNotes').mockRejectedValueOnce(new Error('save failed'))
    await userEvent.selectOptions(menu, 'Bootstrap')
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
