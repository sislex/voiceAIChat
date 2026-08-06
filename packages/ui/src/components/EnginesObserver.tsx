// Объединённый наблюдатель агентских сессий: один пункт меню вместо двух
// (Claude Code / Codex). Внутри — переключатель движка в шапке и панель сводки
// расхода (модель · токены · оценка стоимости). Тело делегируется прежним
// наблюдателям CcObserver/CodexObserver (им добавлены слоты toolbar/banner),
// поэтому вся логика проектов/сессий/транскрипта переиспользуется как есть.

import { totalTokens, type SessionUsage } from '@voicechat/shared'
import { CcObserver, type CcObserverProps } from './CcObserver'
import { CodexObserver, type CodexObserverProps } from './CodexObserver'

export type ObserverEngine = 'claude' | 'codex'

/** Данные движка без общих для рамки полей (их задаёт объединённый компонент). */
type Bundle<P> = Omit<P, 'variant' | 'onClose' | 'toolbar' | 'banner' | 'title'> & {
  /** Сводка расхода активной сессии (null — сессия не выбрана). */
  usage: SessionUsage | null
}

export interface EnginesObserverProps {
  variant?: 'modal' | 'page'
  /** Активный движок. */
  engine: ObserverEngine
  /** Переключение движка (обычно — навигация на соответствующий маршрут). */
  onSwitchEngine: (engine: ObserverEngine) => void
  onClose: () => void
  claude: Bundle<CcObserverProps>
  codex: Bundle<CodexObserverProps>
}

/** Токены в человекочитаемом виде (1.2k / 15.0k). */
function kilo(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Стоимость: $0.0123 для мелких сумм, $0.12 для крупных. */
function money(usd: number): string {
  return `$${usd.toFixed(usd < 0.1 ? 4 : 2)}`
}

/** Переключатель движка в шапке. */
function EngineSwitch({
  engine,
  onSwitch
}: {
  engine: ObserverEngine
  onSwitch: (e: ObserverEngine) => void
}): JSX.Element {
  return (
    <span className="eng-switch" role="tablist" aria-label="Движок">
      <button
        className={engine === 'claude' ? 'eng-tab on' : 'eng-tab'}
        role="tab"
        aria-selected={engine === 'claude'}
        onClick={() => onSwitch('claude')}
      >
        🗂 Claude
      </button>
      <button
        className={engine === 'codex' ? 'eng-tab on' : 'eng-tab'}
        role="tab"
        aria-selected={engine === 'codex'}
        onClick={() => onSwitch('codex')}
      >
        🧭 Codex
      </button>
    </span>
  )
}

/** Панель сводки расхода: модель · токены (вход→выход) · оценка стоимости. */
function UsageBar({ usage }: { usage: SessionUsage | null }): JSX.Element {
  if (!usage || (!usage.model && totalTokens(usage) === 0)) {
    return (
      <div className="usagebar usagebar--empty" data-testid="usage-bar">
        <span className="usage-hint">Выберите сессию — здесь появятся модель, токены и стоимость.</span>
      </div>
    )
  }
  const total = totalTokens(usage)
  const inTok = usage.inputTokens ?? 0
  const outTok = usage.outputTokens ?? 0
  const cache = usage.cacheReadTokens ?? 0
  return (
    <div className="usagebar" data-testid="usage-bar">
      <span className="usage-chip" title="Модель, использованная в сессии">
        <span className="usage-k">Модель</span>
        <span className="usage-v">{usage.model ?? '—'}</span>
      </span>
      <span className="usage-chip" title={`вход ${inTok.toLocaleString('ru')} · выход ${outTok.toLocaleString('ru')}${cache ? ` · из кэша ${cache.toLocaleString('ru')}` : ''}`}>
        <span className="usage-k">Токены</span>
        <span className="usage-v">
          {kilo(total)} <span className="usage-sub">({kilo(inTok)} → {kilo(outTok)})</span>
        </span>
      </span>
      <span
        className="usage-chip"
        title={
          typeof usage.costUsd === 'number'
            ? 'Приблизительная оценка по прайс-таблице (CLI не сохраняет реальную стоимость сессии)'
            : 'Нет прайса для этой модели'
        }
      >
        <span className="usage-k">Стоимость ≈</span>
        <span className="usage-v">{typeof usage.costUsd === 'number' ? money(usage.costUsd) : '—'}</span>
      </span>
    </div>
  )
}

/** Объединённый наблюдатель: переключатель движка + сводка + тело активного движка. */
export function EnginesObserver({
  variant = 'modal',
  engine,
  onSwitchEngine,
  onClose,
  claude,
  codex
}: EnginesObserverProps): JSX.Element {
  const toolbar = <EngineSwitch engine={engine} onSwitch={onSwitchEngine} />
  const { usage: ccUsage, ...ccProps } = claude
  const { usage: cxUsage, ...cxProps } = codex

  if (engine === 'codex') {
    return (
      <CodexObserver
        {...cxProps}
        variant={variant}
        onClose={onClose}
        toolbar={toolbar}
        banner={<UsageBar usage={cxUsage} />}
        title="История LLM"
      />
    )
  }
  return (
    <CcObserver
      {...ccProps}
      variant={variant}
      onClose={onClose}
      toolbar={toolbar}
      banner={<UsageBar usage={ccUsage} />}
      title="История LLM"
    />
  )
}
