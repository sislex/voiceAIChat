import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MachineUtility } from './MachineUtility'
import { makeAgent, makeMachineOps, makePolicy } from '../test/fixtures'

// Мост PTY в jsdom не установлен, поэтому `kind: 'console'` собирается в
// однострочную MachineConsole — и подпись переключателя честно «Консоль».
const agents = [makeAgent({ id: 'm1', name: 'MacBook', version: '0.9.0' })]

describe('MachineUtility — общая шапка у всех трёх виджетов', () => {
  it('шапка с машиной есть и у консоли, и у проводника', async () => {
    const { unmount } = render(
      <MachineUtility tool={{ kind: 'console', agentId: 'm1' }} agents={agents} ops={makeMachineOps()} variant="embedded" />
    )
    expect(screen.getByTestId('utility-head')).toHaveTextContent('MacBook')
    unmount()

    render(
      <MachineUtility tool={{ kind: 'explorer', agentId: 'm1', dir: true }} agents={agents} ops={makeMachineOps()} variant="embedded" />
    )
    expect(await screen.findByTestId('utility-head')).toHaveTextContent('MacBook')
  })

  it('из консоли переключает в проводник, сохраняя машину и папку', async () => {
    const onSwitchUtility = vi.fn()
    render(
      <MachineUtility
        tool={{ kind: 'console', agentId: 'm1', path: '/home/dev/voiceAIChat' }}
        agents={agents}
        ops={makeMachineOps()}
        variant="embedded"
        onSwitchUtility={onSwitchUtility}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Проводник/ }))
    expect(onSwitchUtility).toHaveBeenCalledWith('explorer', 'm1', '/home/dev/voiceAIChat')
  })

  it('из проводника переключает обратно в консоль — в той папке, что открыта', async () => {
    const onSwitchUtility = vi.fn()
    render(
      <MachineUtility
        tool={{ kind: 'explorer', agentId: 'm1', path: '/home/dev', dir: true }}
        agents={agents}
        ops={makeMachineOps()}
        variant="embedded"
        onSwitchUtility={onSwitchUtility}
      />
    )
    // Папку берём из ответа агента (`fs.list` вернул свой cwd), а не из аргумента.
    await screen.findByText(/package\.json/)
    await userEvent.click(screen.getByRole('button', { name: /Консоль/ }))
    expect(onSwitchUtility).toHaveBeenCalledWith('console', 'm1', '/home/dev/voiceAIChat')
  })

  it('переключение уносит машину, выбранную в селекторе шапки', async () => {
    const onSwitchUtility = vi.fn()
    render(
      <MachineUtility
        tool={{ kind: 'console', agentId: 'm1' }}
        agents={[...agents, makeAgent({ id: 'm2', name: 'Сборочный сервер' })]}
        ops={makeMachineOps()}
        variant="embedded"
        onSwitchUtility={onSwitchUtility}
      />
    )
    await userEvent.selectOptions(screen.getByLabelText('Машина'), 'm2')
    await userEvent.click(screen.getByRole('button', { name: /Проводник/ }))
    expect(onSwitchUtility).toHaveBeenCalledWith('explorer', 'm2', undefined)
  })

  it('на машине без записи бейдж и пометка объясняют отсутствие кнопок правки', async () => {
    render(
      <MachineUtility
        tool={{ kind: 'explorer', agentId: 'm1', dir: true }}
        agents={[makeAgent({ id: 'm1', name: 'MacBook', policy: makePolicy({ allowWrite: false }) })]}
        ops={makeMachineOps()}
        variant="embedded"
      />
    )
    await screen.findByText(/package\.json/)
    expect(screen.getByTestId('utility-policy-write')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Загрузить/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Папка/ })).toBeNull()
    expect(screen.getByTestId('fs-readonly')).toBeInTheDocument()
  })
})
