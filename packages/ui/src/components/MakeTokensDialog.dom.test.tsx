import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { createFakeApi } from '../test/fakeApi'
import { MakeTokensDialog } from './MakeTokensDialog'

const CONV = 'make-1'

describe('MakeTokensDialog', () => {
  it('без токенов предлагает создать tokens.css и подключает его в index.html', async () => {
    const api = createFakeApi([])
    const onWritten = vi.fn()
    render(<MakeTokensDialog conversationId={CONV} api={api} files={['index.html', 'styles.css']} onClose={() => {}} onWritten={onWritten} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Создать tokens.css' }))
    await waitFor(() => expect(onWritten).toHaveBeenCalled())
    expect((await api['make:read']({ conversationId: CONV, path: 'tokens.css' })).content).toContain('--accent')
    const index = (await api['make:read']({ conversationId: CONV, path: 'index.html' })).content
    expect(index.indexOf('tokens.css')).toBeGreaterThan(-1)
    expect(index.indexOf('tokens.css')).toBeLessThan(index.indexOf('styles.css'))
    expect(await screen.findByRole('region', { name: 'Цвета' })).toBeInTheDocument()
  })

  it('правит значение токена на месте, добавляет и удаляет токены', async () => {
    const api = createFakeApi([])
    await api['make:write']({ conversationId: CONV, path: 'styles.css', content: `/* база */\n:root {\n  --accent: #4f7cff;\n  --gap: 8px;\n}\n.a { color: var(--accent) }\n` })
    const onWritten = vi.fn()
    render(<MakeTokensDialog conversationId={CONV} api={api} files={['index.html', 'styles.css']} onClose={() => {}} onWritten={onWritten} />)
    const gap = await screen.findByLabelText('Значение --gap')
    await userEvent.clear(gap)
    await userEvent.type(gap, '12px')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить (1)' }))
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'styles.css' })).content).toBe(`/* база */\n:root {\n  --accent: #4f7cff;\n  --gap: 12px;\n}\n.a { color: var(--accent) }\n`))

    await userEvent.type(screen.getByLabelText('Имя нового токена'), 'radius')
    await userEvent.type(screen.getByLabelText('Значение нового токена'), '10px')
    await userEvent.click(screen.getByRole('button', { name: '+ Токен' }))
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'styles.css' })).content).toContain('--radius: 10px;'))
    expect(within(screen.getByRole('region', { name: 'Размеры и отступы' })).getByLabelText('Значение --radius')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Удалить --accent' }))
    await waitFor(async () => expect((await api['make:read']({ conversationId: CONV, path: 'styles.css' })).content).not.toContain('--accent: #4f7cff'))
  })
})
