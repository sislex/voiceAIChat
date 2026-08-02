// Панель «Использование БЗ»: что модель запрашивала в этом чате и во всех чатах
// проекта. Данные приходят пропсами (правило пакета: компонент сам не грузит),
// снапшот просит один эффект по conversationId, инкременты живут в сторе.
//
// Порядок пустых состояний важен и проверяется тестом: сначала «БЗ выключена для
// этого чата» (это настройка, а не сбой), затем «индекс недоступен» (тоже
// конфигурация — поэтому EmptyState, а не ErrorState), и только потом «обращений
// ещё не было». Если у выключенного чата есть история обращений, она показывается
// под баннером: числа не врут, просто новых не будет.

import { useEffect, useState } from 'react'
import type { KbContextMode } from '@shared/types'
import type { KbStatus } from '@shared/kb'
import { ToolFrame } from '../ToolFrame'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Skeleton, RefreshIndicator } from '../ui/Skeleton'
import { loadView, type LoadStatus } from '../../lib/loadState'
import type { KbUsageCache } from '../../lib/kbUsage'
import { KbUsageSummary } from './KbUsageSummary'
import { KbUsageSections } from './KbUsageSections'
import { KbUsageFeed } from './KbUsageFeed'

export type KbUsageTab = 'chat' | 'project'

export interface KbUsagePanelProps {
  conversationId: string
  /** Проект чата (null — вкладка «По проекту» объясняет, что привязки нет). */
  projectId?: string | null
  cache?: KbUsageCache
  projectCache?: KbUsageCache
  kbStatus?: KbStatus | null
  mode?: KbContextMode
  onLoad: (conversationId: string) => void
  onLoadProject?: (projectId: string) => void
  onClose: () => void
  /** Открыть раздел в базе знаний (#/kb/:documentId). */
  onOpenDocument?: (documentId: string, anchor: string) => void
  onOpenKnowledgeBase?: () => void
  /** Настройки разговора: там переключается режим БЗ. */
  onOpenConversationSettings?: () => void
  /** Названия чатов для ленты проектной вкладки. */
  titleOf?: (conversationId: string) => string | undefined
  /** Открыть ленту CI-рана (обращения рана помечены в ленте панели). */
  onOpenRun?: (runId: string) => void
}

function statusOf(cache: KbUsageCache | undefined): LoadStatus {
  if (cache?.loading) return 'loading'
  if (cache?.error) return 'error'
  return cache?.report ? 'ready' : 'loading'
}

export function KbUsagePanel(props: KbUsagePanelProps): JSX.Element {
  const { conversationId, projectId = null, cache, projectCache, kbStatus = null, mode = 'auto' } = props
  const [tab, setTab] = useState<KbUsageTab>('chat')

  // Снапшот чата — один раз на conversationId (инкременты приходят кадрами).
  useEffect(() => {
    props.onLoad(conversationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  useEffect(() => {
    if (tab === 'project' && projectId) props.onLoadProject?.(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, projectId])

  const active = tab === 'chat' ? cache : projectCache
  const report = active?.report ?? null
  const view = loadView(statusOf(active), report !== null)
  const modeOff = mode === 'off'
  const indexDown = kbStatus ? !kbStatus.available : report ? !report.available : false
  const hasQueries = (report?.totals.queries ?? 0) > 0

  const body = (): JSX.Element => {
    if (tab === 'project' && !projectId) {
      return (
        <EmptyState
          icon="🗂"
          title="Чат не привязан к проекту"
          description="Свяжите чат с проектом в его настройках — тогда здесь появится агрегат по всем чатам проекта."
          actionLabel={props.onOpenConversationSettings ? 'Настройки разговора' : undefined}
          onAction={props.onOpenConversationSettings}
          testId="kb-usage-no-project"
        />
      )
    }
    if (view.state === 'skeleton') return <Skeleton variant="list" count={4} height={64} lines={2} testId="kb-usage-skeleton" />
    if (view.state === 'error') {
      return <ErrorState message="Не удалось прочитать статистику базы знаний" detail={active?.error ?? null} onRetry={() => (tab === 'chat' ? props.onLoad(conversationId) : projectId && props.onLoadProject?.(projectId))} />
    }
    if (!report) return <EmptyState icon="📚" title="Данных пока нет" description="Статистика появится после первого обращения модели к базе знаний." />
    return (
      <>
        {view.staleError && <ErrorState compact message="Числа могли устареть: обновление не удалось" detail={active?.error ?? null} onRetry={() => props.onLoad(conversationId)} />}
        {view.refreshing && <p className="kbu-refresh"><RefreshIndicator label="Обновляем…" /></p>}
        {tab === 'chat' && modeOff && (
          <div className="kbu-banner" data-testid="kb-usage-off">
            <p>
              База знаний выключена для этого чата: сервер не подмешивает контекст, а инструменты
              mcp__kb__* модели не выданы. {hasQueries ? 'Ниже — обращения, которые уже были.' : ''}
            </p>
            {props.onOpenConversationSettings && (
              <Button size="sm" onClick={props.onOpenConversationSettings}>Настройки разговора</Button>
            )}
          </div>
        )}
        {indexDown && (
          <EmptyState
            compact
            icon="📚"
            title="База знаний недоступна"
            description="Индекс docs/kb пуст или не смонтирован на сервере — это настройка окружения, а не сбой запроса."
            testId="kb-usage-unavailable"
          />
        )}
        {!hasQueries && !modeOff && !indexDown && (
          <EmptyState
            icon="🔎"
            title="Обращений ещё не было"
            description={mode === 'manual'
              ? 'В режиме «по запросу модели» обращение появится, когда модель сама вызовет mcp__kb__*.'
              : 'Обращение появится, когда сервер подмешает контекст или модель вызовет mcp__kb__*.'}
            actionLabel={props.onOpenKnowledgeBase ? 'Открыть базу знаний' : undefined}
            onAction={props.onOpenKnowledgeBase}
            testId="kb-usage-none"
          />
        )}
        <KbUsageSummary
          totals={report.totals}
          mode={mode}
          toolEnabled={report.toolEnabled}
          status={kbStatus}
          {...(tab === 'project' ? { conversations: projectCache?.conversations?.length ?? 0 } : {})}
        />
        <KbUsageSections
          sections={report.sections}
          withConversations={tab === 'project'}
          {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
        />
        <KbUsageFeed
          queries={report.recent}
          {...(props.onOpenRun ? { onOpenRun: props.onOpenRun } : {})}
          {...(tab === 'project' ? { titleOf: (id: string) => props.titleOf?.(id) ?? projectCache?.conversations?.find((item) => item.conversationId === id)?.title } : {})}
        />
      </>
    )
  }

  return (
    <ToolFrame
      title="Использование базы знаний"
      variant="modal"
      testId="kb-usage-overlay"
      className="kbutool"
      onClose={props.onClose}
      actions={
        <>
          <Button size="sm" variant="secondary" onClick={() => (tab === 'chat' ? props.onLoad(conversationId) : projectId && props.onLoadProject?.(projectId))}>
            Обновить
          </Button>
          {props.onOpenKnowledgeBase && (
            <Button size="sm" variant="secondary" onClick={props.onOpenKnowledgeBase}>Открыть базу знаний</Button>
          )}
        </>
      }
    >
      <div className="kbu-body">
        <div className="kbu-tabs" role="tablist" aria-label="Область статистики">
          <button className={tab === 'chat' ? 'kbu-tab on' : 'kbu-tab'} role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
            Этот чат
          </button>
          <button className={tab === 'project' ? 'kbu-tab on' : 'kbu-tab'} role="tab" aria-selected={tab === 'project'} onClick={() => setTab('project')}>
            По проекту
          </button>
        </div>
        {body()}
      </div>
    </ToolFrame>
  )
}
