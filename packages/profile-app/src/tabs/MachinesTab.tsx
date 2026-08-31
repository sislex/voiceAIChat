// Машины человека: состояние агента, ОС и версия.

import { Badge, Button, DefinitionList, EmptyState } from '@voicechat/ui-kit'
import type { ProfileCapabilities, ProfileMachine } from '../contracts'
import { machineOs, machineVersionState } from '../model'
import { formatAgo } from '../format'

export interface MachinesTabProps {
  machines: readonly ProfileMachine[]
  capabilities: ProfileCapabilities
  /** Актуальная версия агента; без неё «устарела» показывать не из чего. */
  latestVersion?: string
  now: number
  onUpdateMachine?: (machineId: string) => void
  /** Идёт обновление конкретной машины — кнопка ждёт ответа. */
  updatingId?: string | null
}

export function MachinesTab({ machines, capabilities, latestVersion, now, onUpdateMachine, updatingId }: MachinesTabProps): JSX.Element {
  if (machines.length === 0) {
    return <EmptyState icon="💻" title="Машин нет" description="Появятся, когда на компьютере будет установлен агент из раздела «Машины»." />
  }
  return (
    <section className="vcp-machines" data-testid="machines-tab">
      <ul role="list">
        {machines.map((machine) => {
          const state = machineVersionState(machine.version, latestVersion)
          const os = machineOs(machine)
          return (
            <li key={machine.id} className="vcp-machine">
              <span className="vcp-machine__ico" aria-hidden="true">{machine.online ? '▣' : '▱'}</span>
              <div className="vcp-machine__main">
                <h3>{machine.name}</h3>
                {/* Пары «подпись → значение», а не строка через точки: скринридер
                    читает их как свойства машины, а не как сплошной текст. */}
                <DefinitionList
                  inline
                  items={[
                    {
                      label: 'Состояние',
                      value: (
                        <>
                          <i className={machine.online ? 'vcp-dot vcp-dot--on' : 'vcp-dot'} aria-hidden="true" />
                          {machine.online ? 'онлайн' : formatAgo(machine.lastSeen, now)}
                        </>
                      )
                    },
                    { label: 'ОС', value: os ?? (machine.online ? 'неизвестна' : 'неизвестна (офлайн)') }
                  ]}
                />
              </div>
              {machine.version
                ? <Badge tone={state === 'outdated' ? 'warning' : 'success'} title={state === 'outdated' ? `Актуальная версия — ${latestVersion}` : undefined}>
                    {state === 'outdated' ? `${machine.version} → ${latestVersion}` : machine.version}
                  </Badge>
                : <Badge>версия неизвестна</Badge>}
              {capabilities.canUpdateMachines && onUpdateMachine && state === 'outdated' && (
                <Button size="sm" loading={updatingId === machine.id} onClick={() => onUpdateMachine(machine.id)}>Обновить</Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
