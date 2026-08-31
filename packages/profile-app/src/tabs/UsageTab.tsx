// Использование: сколько потрачено, сколько токенов и как расход шёл по дням.

import { EmptyState, Sparkline, StatCard } from '@voicechat/ui-kit'
import type { ProfilePeriod, ProfileUsage } from '../contracts'
import { PERIOD_LABEL } from '../format'
import { formatTokens, formatUsd, spendPoints, spendTrend } from '../model'

export interface UsageTabProps {
  usage: ProfileUsage | null
  period: ProfilePeriod
  onSelectPeriod?: (period: ProfilePeriod) => void
}

const PERIODS: readonly ProfilePeriod[] = ['month', '7d', '30d', 'all']

export function UsageTab({ usage, period, onSelectPeriod }: UsageTabProps): JSX.Element {
  const points = usage ? spendPoints(usage) : []
  return (
    <section className="vcp-usage" data-testid="usage-tab">
      <div className="vcp-section-head">
        <div><h3>Использование</h3><p>Затраты, токены и ответы модели за период</p></div>
        {onSelectPeriod && (
          <select aria-label="Период расхода" value={period} onChange={(event) => onSelectPeriod(event.target.value as ProfilePeriod)}>
            {PERIODS.map((item) => <option key={item} value={item}>{PERIOD_LABEL[item]}</option>)}
          </select>
        )}
      </div>

      {!usage ? (
        <EmptyState icon="📊" title="Данных за период нет" description="Появятся после первого ответа модели." />
      ) : (
        <>
          <div className="vcp-usage__metrics">
            <StatCard
              label="Расход"
              value={formatUsd(usage.spendUsd, usage.spendIncomplete)}
              hint={(() => {
                const trend = spendTrend(usage.spendUsd, usage.previousSpendUsd)
                if (usage.spendIncomplete) return 'часть ответов без известного тарифа'
                // Сравнение только когда прошлый период был ненулевым: рост с
                // нуля процентом не выражается, и «+∞%» ничего не объясняет.
                return trend ? `${trend.up ? '↑' : '↓'} ${Math.round(trend.share * 100)}% к прошлому периоду` : undefined
              })()}
              tone={usage.spendIncomplete ? 'warning' : 'neutral'}
            />
            <StatCard label="Токены" value={formatTokens(usage.inputTokens + usage.outputTokens)} hint={`${formatTokens(usage.inputTokens)} вход · ${formatTokens(usage.outputTokens)} выход`} />
            {/* Доли «успешных» здесь быть не может: неудавшийся ход сообщения не
                создаёт, поэтому знаменателя не существует. Показываем прерванные. */}
            <StatCard label="Ответы модели" value={usage.messages} hint={usage.interrupted ? `${usage.interrupted} прервано` : undefined} />
          </div>

          <article className="vcp-card">
            <div className="vcp-card__title">
              <div><h3>Расход по периодам</h3><p>USD · {PERIOD_LABEL[period]}</p></div>
            </div>
            {points.length === 0
              ? <EmptyState compact icon="📈" title="Расхода за период нет" description="График появится, когда в периоде будут ответы модели." />
              : <Sparkline label={`Расход по периодам, USD, ${PERIOD_LABEL[period]}`} format={(value) => formatUsd(value)} points={points.map((point) => ({ label: point.bucket, value: point.spendUsd }))} />}
          </article>

          {usage.byModel.length > 0 && (
            <table className="vcp-table">
              <caption className="vcp-visually-hidden">Расход и токены по моделям</caption>
              <thead><tr><th scope="col">Модель</th><th scope="col">Вход</th><th scope="col">Выход</th><th scope="col">Расход</th></tr></thead>
              <tbody>
                {usage.byModel.map((item) => (
                  <tr key={item.model}>
                    <td>{item.model}</td>
                    <td>{formatTokens(item.inputTokens)}</td>
                    <td>{formatTokens(item.outputTokens)}</td>
                    <td>{formatUsd(item.spendUsd, item.incomplete)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  )
}
