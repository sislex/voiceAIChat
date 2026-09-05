import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { createFakeApi } from '../test/fakeApi'
import { MakeNotesDialog } from './MakeNotesDialog'

describe('MakeNotesDialog (roadmap-4 пп.6–7)', () => {
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
