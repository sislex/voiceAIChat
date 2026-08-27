import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { createFakeApi } from '../test/fakeApi'
import { MakeUsageDialog, formatBytes } from './MakeUsageDialog'

const CONV = 'make-1'

describe('MakeUsageDialog', () => {
  it('форматирует байты', () => {
    expect(formatBytes(512)).toBe('512 Б')
    expect(formatBytes(3 * 1024)).toBe('3.0 КБ')
    expect(formatBytes(20 * 1048576)).toBe('20 МБ')
  })

  it('показывает занятое место, очистка требует подтверждения и удаляет выбранное', async () => {
    const api = createFakeApi([])
    await api['make:snapshot']({ conversationId: CONV, label: 'a' })
    await api['make:snapshot']({ conversationId: CONV, label: 'b' })
    await api['make:snapshot']({ conversationId: CONV, label: 'c' })
    await api['make:write']({ conversationId: CONV, path: 'img/unused.png', content: 'PNG' })
    const onChanged = vi.fn()
    render(<MakeUsageDialog conversationId={CONV} api={api} onClose={() => {}} onChanged={onChanged} />)
    expect(await screen.findByTestId('make-usage-total')).toHaveTextContent('из 64 МБ')
    expect(screen.getByText(/Снимки: 3/)).toBeInTheDocument()
    expect(screen.getByText(/Ассеты без ссылок \(1: img\/unused\.png\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Очистить' })).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox', { name: /Старые снимки/ }))
    const keep = screen.getByLabelText('Сколько снимков оставить')
    await userEvent.clear(keep)
    await userEvent.type(keep, '1')
    await userEvent.click(screen.getByRole('checkbox', { name: /Ассеты без ссылок/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Очистить' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect((await api['make:state']({ conversationId: CONV })).snapshots).toHaveLength(1)
    expect((await api['make:state']({ conversationId: CONV })).files.some((f) => f.path === 'img/unused.png')).toBe(false)
    await waitFor(() => expect(screen.getByText(/Снимки: 1/)).toBeInTheDocument())
  })
})
