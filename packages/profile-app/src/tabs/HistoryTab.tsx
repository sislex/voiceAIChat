// История: журнал безопасности с фильтром по группе событий и выгрузкой в CSV.

import { useState } from 'react'
import { Button, EmptyState } from '@voicechat/ui-kit'
import type { ProfileSecurityEvent } from '../contracts'
import { formatDateTime } from '../format'
import { securityEventsToCsv, shortUserAgent } from '../model'
import { isAlarming, securityGroup, type SecurityGroup } from '../securityLabels'

export interface HistoryTabProps {
  events: readonly ProfileSecurityEvent[] | null
  userName: string
  onExportCsv?: (filename: string, csv: string) => void
}

const GROUPS: Array<{ id: SecurityGroup; label: string }> = [
  { id: 'all', label: 'Все события' },
  { id: 'auth', label: 'Входы и сессии' },
  { id: 'account', label: 'Изменения учётки' },
  { id: 'machines', label: 'Машины' }
]

export function HistoryTab({ events, userName, onExportCsv }: HistoryTabProps): JSX.Element {
  const [group, setGroup] = useState<SecurityGroup>('all')
  if (events === null) return <p className="vcp-loading">Загружаем журнал…</p>
  const visible = group === 'all' ? events : events.filter((event) => securityGroup(event.type) === group)

  return (
    <section className="vcp-history" data-testid="history-tab">
      <div className="vcp-section-head">
        <div><h3>Журнал безопасности</h3><p>Входы, изменения учётки и подключения машин</p></div>
        <div className="vcp-history__filters">
          <select aria-label="Тип событий" value={group} onChange={(event) => setGroup(event.target.value as SecurityGroup)}>
            {GROUPS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          {onExportCsv && visible.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onExportCsv(`security-${userName}.csv`, securityEventsToCsv(visible, formatDateTime))}>
              Экспорт CSV
            </Button>
          )}
        </div>
      </div>

      {visible.length === 0
        ? <EmptyState icon="🛡" title="Событий пока нет" description="Входы, выходы, неудачные попытки и смена пароля появятся здесь." />
        : (
          <ul className="vcp-audit" role="list">
            {visible.map((event) => (
              <li key={event.id} className={isAlarming(event.type) ? 'vcp-audit__item vcp-audit__item--bad' : 'vcp-audit__item'}>
                <time dateTime={new Date(event.at).toISOString()}>{formatDateTime(event.at)}</time>
                <div>
                  <h3>{event.label}</h3>
                  <p>{[event.details, event.ip, shortUserAgent(event.userAgent)].filter(Boolean).join(' · ')}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
