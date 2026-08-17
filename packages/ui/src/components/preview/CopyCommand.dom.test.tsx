import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { CopyCommand } from './CopyCommand'
import { copyText } from '../../lib/clipboard'

vi.mock('../../lib/clipboard', () => ({ copyText: vi.fn() }))
const copy = vi.mocked(copyText)

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('CopyCommand', () => {
  it('copies the exact displayed command and temporarily reports success', async () => {
    vi.useFakeTimers()
    copy.mockResolvedValue(true)
    const command = 'ssh  -N -L 18000:127.0.0.1:18001 user@example.test '
    render(<CopyCommand command={command} />)
    fireEvent.click(screen.getByRole('button', { name: 'Копировать команду' }))
    expect(screen.getByRole('button')).toBeDisabled()
    await act(async () => { await Promise.resolve() })
    expect(copy).toHaveBeenCalledWith(command)
    expect(screen.getByRole('button', { name: 'Скопировано' })).toBeInTheDocument()
    expect(screen.getByText('Команда скопирована')).toHaveAttribute('aria-live', 'polite')
    await vi.advanceTimersByTimeAsync(2_000)
    expect(screen.getByRole('button', { name: 'Копировать команду' })).toBeEnabled()
  })

  it('keeps the command selectable and permits retry after failure', async () => {
    copy.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<CopyCommand command="ssh exact" />)
    fireEvent.click(screen.getByRole('button', { name: 'Копировать команду' }))
    expect(await screen.findByText('Не удалось скопировать команду', { selector: 'small' })).toBeInTheDocument()
    expect(screen.getByText('ssh exact')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Копировать команду' }))
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(2))
  })

  it('resets stale async state when the command changes or disappears', async () => {
    let resolve!: (value: boolean) => void
    copy.mockReturnValue(new Promise((done) => { resolve = done }))
    const view = render(<CopyCommand command="ssh old" />)
    fireEvent.click(screen.getByRole('button'))
    view.rerender(<CopyCommand command="ssh new" />)
    resolve(true)
    await waitFor(() => expect(screen.getByText('ssh new')).toBeInTheDocument())
    expect(screen.queryByText('Скопировано')).not.toBeInTheDocument()
    view.rerender(<CopyCommand command={null} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not update after unmount while copying', async () => {
    let resolve!: (value: boolean) => void
    copy.mockReturnValue(new Promise((done) => { resolve = done }))
    const view = render(<CopyCommand command="ssh pending" />)
    fireEvent.click(screen.getByRole('button'))
    view.unmount()
    resolve(true)
    await Promise.resolve()
    expect(copy).toHaveBeenCalledOnce()
  })
})
