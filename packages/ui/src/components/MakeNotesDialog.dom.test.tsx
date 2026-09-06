import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
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

    const stackGroup = screen.getByRole('group', { name: 'Стек интерфейса' })
    expect(within(stackGroup).getAllByRole('radio')).toHaveLength(4)
    expect(within(stackGroup).getByRole('radio', { name: 'Чистый HTML + CSS' })).toBeInTheDocument()
    expect(within(stackGroup).getByRole('radio', { name: 'Чистый HTML + CSS + JS' })).toBeChecked()
    expect(within(stackGroup).getByRole('radio', { name: 'React' })).toBeInTheDocument()
    expect(within(stackGroup).getByRole('radio', { name: 'Angular' })).toBeInTheDocument()

    const uiKitGroup = screen.getByRole('group', { name: 'Стилевая база' })
    expect(within(uiKitGroup).getAllByRole('radio')).toHaveLength(2)
    expect(within(uiKitGroup).getByRole('radio', { name: 'Своя система' })).toBeChecked()
    expect(within(uiKitGroup).getByRole('radio', { name: 'Bootstrap 5.3' })).toBeInTheDocument()
  })

  // @testCase TC-2
  it('сохраняет Bootstrap без подтверждения смены стека', async () => {
    const { setNotes, applyTemplate } = setup()
    await waitUntilLoaded()

    await userEvent.click(screen.getByRole('radio', { name: 'Bootstrap 5.3' }))
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

    await userEvent.click(screen.getByRole('radio', { name: 'Angular' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Смена стека' })).getByRole('button', { name: 'Только настройка' }))

    await waitFor(() => expect(setNotes).toHaveBeenCalledWith(expect.objectContaining({ stack: 'angular', uiKit: 'none' })))
    expect(applyTemplate).not.toHaveBeenCalled()
  })

  // @testCase TC-4
  it('меняет стек и применяет выбранный стартовый шаблон', async () => {
    const { setNotes, applyTemplate } = setup()
    await waitUntilLoaded()

    await userEvent.click(screen.getByRole('radio', { name: 'React' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Смена стека' })).getByRole('button', { name: 'Настройка + применить шаблон' }))

    await waitFor(() => expect(setNotes).toHaveBeenCalledWith(expect.objectContaining({ stack: 'react' })))
    expect(applyTemplate).toHaveBeenCalledWith({ conversationId: 'make-1', templateId: 'react' })
  })

  // @testCase TC-5
  it('закрывает подтверждение смены стека без сохранения', async () => {
    const { setNotes, applyTemplate } = setup()
    await waitUntilLoaded()

    await userEvent.click(screen.getByRole('radio', { name: 'Angular' }))
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

    await userEvent.click(screen.getByRole('radio', { name: 'Bootstrap 5.3' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    expect(await screen.findByText('Сервис настроек недоступен')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(setNotes).toHaveBeenCalledTimes(2))
    expect(await api['make:notes']({ conversationId: 'make-1' })).toMatchObject({ stack: 'html-js', uiKit: 'bootstrap' })
  })

  // @testCase TC-10
  it('сохраняет заметки и режим ассистента', async () => {
    const api = createFakeApi([])
    const onSaved = vi.fn()
    render(<MakeNotesDialog conversationId="make-1" api={api} onClose={() => {}} onSaved={onSaved} />)
    const ta = await screen.findByLabelText('Заметки проекта')
    await waitFor(() => expect(ta).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    await userEvent.type(ta, '- акцент синий')
    await userEvent.click(screen.getByRole('radio', { name: /Дизайнер/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ notes: '- акцент синий', mode: 'designer', stack: 'html-js', uiKit: 'none' }))
    expect(await api['make:notes']({ conversationId: 'make-1' })).toEqual({ notes: '- акцент синий', mode: 'designer', stack: 'html-js', uiKit: 'none' })
  })
})
