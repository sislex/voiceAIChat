import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MachineUtilityHeader, policyBadges } from './MachineUtilityHeader'
import { makeAgent, makeOfflineAgent, makePolicy } from '../test/fixtures'

describe('MachineUtilityHeader — машина видна всегда', () => {
  it('единственную машину называет и без селектора: имя, «в сети» и версия агента', () => {
    render(
      <MachineUtilityHeader
        agents={[makeAgent({ id: 'm1', name: 'MacBook', version: '0.9.0' })]}
        agentId="m1"
        onAgentChange={vi.fn()}
        kind="console"
      />
    )
    // Раньше при одной машине шапка была пустой — где работаешь, видно не было.
    expect(screen.queryByLabelText('Машина')).toBeNull()
    const machine = screen.getByTestId('utility-machine')
    expect(machine).toHaveTextContent('MacBook')
    expect(machine).toHaveTextContent('в сети')
    expect(machine).toHaveTextContent('агент 0.9.0')
  })

  it('офлайн-машину показывает как «не в сети» и объясняет это подсказкой', () => {
    render(
      <MachineUtilityHeader
        agents={[makeOfflineAgent({ id: 'm2', name: 'Домашний ПК' })]}
        agentId="m2"
        onAgentChange={vi.fn()}
        kind="explorer"
      />
    )
    const machine = screen.getByTestId('utility-machine')
    expect(machine).toHaveTextContent('Домашний ПК')
    expect(machine).toHaveTextContent('не в сети')
    expect(screen.getByTitle(/не подключён/)).toBeInTheDocument()
  })

  it('при нескольких машинах селектор переключает машину', async () => {
    const onAgentChange = vi.fn()
    render(
      <MachineUtilityHeader
        agents={[makeAgent({ id: 'm1', name: 'MacBook' }), makeAgent({ id: 'm2', name: 'Сборочный сервер' })]}
        agentId="m1"
        onAgentChange={onAgentChange}
        kind="explorer"
      />
    )
    await userEvent.selectOptions(screen.getByLabelText('Машина'), 'm2')
    expect(onAgentChange).toHaveBeenCalledWith('m2')
  })
})

describe('MachineUtilityHeader — бейджи политики', () => {
  const restricted = makeAgent({
    id: 'm1',
    policy: makePolicy({ allowWrite: false, allowNetwork: false, allowedDirs: ['/srv/build', '/tmp'] })
  })

  it('показывает, что запрещено, и объясняет каждый запрет подсказкой', () => {
    render(<MachineUtilityHeader agents={[restricted]} agentId="m1" onAgentChange={vi.fn()} kind="explorer" />)
    expect(screen.getByTestId('utility-policy-write')).toHaveTextContent('только чтение')
    // Именно тут объяснение, почему у проводника нет кнопок изменения файлов.
    expect(screen.getByTestId('utility-policy-write')).toHaveAttribute(
      'title',
      expect.stringContaining('этих кнопок нет')
    )
    expect(screen.getByTestId('utility-policy-network')).toHaveTextContent('сеть запрещена')
    expect(screen.getByTestId('utility-policy-dirs')).toHaveTextContent('каталоги ограничены')
    // Подсказка перечисляет сами каталоги: «ограничены» без списка бесполезно.
    expect(screen.getByTestId('utility-policy-dirs')).toHaveAttribute(
      'title',
      expect.stringContaining('/srv/build, /tmp')
    )
  })

  it('машине без запретов бейджей не рисует', () => {
    render(<MachineUtilityHeader agents={[makeAgent({ id: 'm1' })]} agentId="m1" onAgentChange={vi.fn()} kind="explorer" />)
    expect(screen.queryByTestId('utility-policy')).toBeNull()
    expect(policyBadges(makeAgent({ id: 'm1' }).policy)).toEqual([])
  })
})

describe('MachineUtilityHeader — переключатель и ссылка в «Машины»', () => {
  const agents = [makeAgent({ id: 'm1', name: 'MacBook' })]

  it('открытая утилита нажата, вторая переключает', async () => {
    const onSwitch = vi.fn()
    render(
      <MachineUtilityHeader
        agents={agents}
        agentId="m1"
        onAgentChange={vi.fn()}
        kind="explorer"
        onSwitch={onSwitch}
      />
    )
    expect(screen.getByRole('button', { name: /Проводник/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: /Проводник/ }))
    expect(onSwitch).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /Терминал/ }))
    expect(onSwitch).toHaveBeenCalledWith('console')
  })

  it('подпись консольной кнопки задаёт виджет: без PTY это «Консоль»', () => {
    render(
      <MachineUtilityHeader
        agents={agents}
        agentId="m1"
        onAgentChange={vi.fn()}
        kind="console"
        consoleLabel="Консоль"
        onSwitch={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /Консоль/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Терминал/ })).toBeNull()
  })

  it('без обработчиков ни переключателя, ни ссылки в «Машины» нет', () => {
    render(<MachineUtilityHeader agents={agents} agentId="m1" onAgentChange={vi.fn()} kind="console" />)
    expect(screen.queryByRole('group', { name: 'Что открыто на машине' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Машины/ })).toBeNull()
  })

  it('ссылка ведёт в раздел «Машины» — там правится политика', async () => {
    const onOpenMachines = vi.fn()
    render(
      <MachineUtilityHeader
        agents={agents}
        agentId="m1"
        onAgentChange={vi.fn()}
        kind="console"
        onOpenMachines={onOpenMachines}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Машины/ }))
    expect(onOpenMachines).toHaveBeenCalledTimes(1)
  })
})
