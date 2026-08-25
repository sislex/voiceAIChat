import { useEffect, useState } from 'react'
import type { AgentInfo } from '@shared/agentProtocol'
import type { ContextSnapshotItem, ConversationContextSnapshot, KbContextMode, LlmProvider, PermissionMode } from '@shared/types'
import type { ProjectSummary } from '@shared/projects'
import { Button } from '@voicechat/ui-kit'

type UserStatus = 'Будет использовано' | 'Доступно при необходимости' | 'Не настроено' | 'Недоступно' | 'Определится после отправки'
export interface ContextInspectorProps { conversationId: string; provider: LlmProvider; model: string; permissionMode: PermissionMode; kbMode: KbContextMode; agent?: AgentInfo; workdir: string | null; project?: ProjectSummary; selectedSkillNames: string[]; onOpenSettings?: () => void }

const dynamicIds = new Set(['current-message', 'knowledge-mode'])
const primaryIds = new Set(['platform-instructions', 'application-instructions', 'personalization', 'project-binding', 'knowledge-mode', 'conversation-history', 'current-message'])

function userStatus(item: ContextSnapshotItem): UserStatus {
  if (dynamicIds.has(item.id) || item.id.startsWith('skill-')) return 'Определится после отправки'
  if (item.includedInNextTurn) return 'Будет использовано'
  if (!item.configured) return 'Не настроено'
  if (!item.available) return 'Недоступно'
  return 'Доступно при необходимости'
}
function sourceLabel(source: string): string {
  if (source === 'Разговор' || source === 'Настройки разговора') return 'Переопределение чата'
  if (source === 'Проект') return 'Настройки проекта'
  if (source === 'Настройки пользователя') return 'Общие настройки'
  if (source === 'Эффективная политика сервера' || source === 'Резолвер сервера') return 'Автоматически'
  return source
}
function reasonFor(item: ContextSnapshotItem): string {
  if (item.id === 'current-message') return 'Текст станет известен после отправки сообщения.'
  if (item.id === 'knowledge-mode' && item.configured) return 'Подходящие документы выбираются по тексту отправляемого сообщения.'
  if (item.id.startsWith('skill-')) return item.configured ? 'Навык выбран, но активируется только при подходящем сообщении.' : 'Навык доступен и может быть выбран для разговора.'
  return item.explanation || (item.includedInNextTurn ? 'Сервер включил источник в следующий ход.' : !item.configured ? 'Источник не настроен.' : !item.available ? 'Источник сейчас недоступен.' : 'Источник доступен модели по необходимости.')
}
function detailIdFromHash(conversationId: string): string | null {
  const prefix = `#/chat/${encodeURIComponent(conversationId)}/context/`
  return window.location.hash.startsWith(prefix) ? decodeURIComponent(window.location.hash.slice(prefix.length).split(/[/?]/)[0] ?? '') : null
}

export function ContextInspector(props: ContextInspectorProps): JSX.Element {
  const [detailId, setDetailId] = useState<string | null>(() => detailIdFromHash(props.conversationId))
  useEffect(() => {
    const sync = (): void => setDetailId(detailIdFromHash(props.conversationId))
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [props.conversationId])
  const [snapshot, setSnapshot] = useState<ConversationContextSnapshot | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let alive = true
    setSnapshot(null); setSnapshotError(null)
    void window.api['conversations:contextSnapshot']({ id: props.conversationId }).then((value) => {
      if (!alive) return
      if (!value) setSnapshotError('Разговор или источник больше недоступен.')
      else setSnapshot(value)
    }).catch((error) => { if (alive) setSnapshotError(error instanceof Error ? error.message : String(error)) })
    return () => { alive = false }
  }, [props.conversationId, reload])

  const snapshotGroups = snapshot?.groups ?? []
  const allItems = snapshotGroups.flatMap((group) => group.items)
  const byId = (id: string): ContextSnapshotItem | undefined => allItems.find((entry) => entry.id === id)
  const detail = detailId ? byId(detailId) : undefined
  const openDetail = (id: string): void => { window.location.hash = `/chat/${encodeURIComponent(props.conversationId)}/context/${encodeURIComponent(id)}`; setDetailId(id) }
  const closeDetail = (): void => { window.location.hash = `/chat/${encodeURIComponent(props.conversationId)}`; setDetailId(null) }
  const state = (value: boolean): string => value ? 'Да' : 'Нет'

  if (snapshotError) return <section className="context-inspector context-error" role="alert"><h2>Не удалось загрузить сведения</h2><p>{snapshotError}</p><Button size="sm" onClick={() => setReload((value) => value + 1)}>Повторить</Button></section>
  if (!snapshot) return <section className="context-inspector context-loading" aria-busy="true"><h2>Формируем сведения для следующего сообщения…</h2><p>Проверяем настройки и доступность окружения.</p></section>
  if (detailId && !detail) return <section className="context-detail"><Button size="sm" onClick={closeDetail}>← Ко всем источникам</Button><h2>Источник не найден</h2><p>Он мог стать недоступен после обновления конфигурации.</p></section>
  if (detail) return <section className="context-detail" aria-labelledby="context-detail-title">
    <Button size="sm" onClick={closeDetail}>← Ко всем источникам</Button>
    <header><span className="context-type">{detail.type}</span><h2 id="context-detail-title">{detail.title}</h2><p>{detail.description}</p></header>
    <dl className="context-metadata">
      <div><dt>Приоритет</dt><dd>{detail.priority}</dd></div><div><dt>Источник</dt><dd>{detail.source}</dd></div><div><dt>Область действия</dt><dd>{detail.scope}</dd></div>
      <div><dt>Настроено</dt><dd>{state(detail.configured)}</dd></div><div><dt>Доступно</dt><dd>{state(detail.available)}</dd></div><div><dt>Будет добавлено в следующий ход</dt><dd>{state(detail.includedInNextTurn)}</dd></div>
      <div><dt>Пояснение</dt><dd>{detail.explanation}</dd></div>
      {detail.details && Object.entries(detail.details).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(', ') : String(value ?? '—')}</dd></div>)}
    </dl>
  </section>

  const llm = byId('llm')
  const machine = byId('machine')
  const workdir = byId('working-directory')
  const permission = byId('permission-mode')
  const knowledgeItems = allItems.filter((item) => primaryIds.has(item.id))
  const additionalItems = allItems.filter((item) => item.id === 'agents-chain' || item.id.startsWith('skill-') || item.id.startsWith('mcp-'))
  const machineProblem = Boolean(machine?.configured && !machine.available)
  const launchValues = [
    { label: 'ИИ', value: snapshot.summary.provider, source: llm?.source },
    { label: 'Модель', value: snapshot.summary.model || 'Модель из конфигурации CLI', source: llm?.source },
    { label: 'Машина', value: machineProblem ? 'Недоступно' : machine?.description || 'Не настроена', source: machine?.source },
    { label: 'Рабочая папка', value: workdir?.scope || workdir?.description || 'Не настроена', source: workdir?.source },
    { label: 'Режим доступа', value: snapshot.summary.permissionMode.displayName, source: permission?.source }
  ]

  const itemCard = (item: ContextSnapshotItem): JSX.Element => <button type="button" className="context-item" key={item.id} onClick={() => openDetail(item.id)}>
    <span className="context-item-main"><b>{item.title}</b><small>{item.description}</small><small className="context-reason"><b>Почему:</b> {reasonFor(item)}</small></span>
    <span className="context-status">{userStatus(item)}</span><span aria-hidden="true">→</span>
  </button>

  return <section className="context-inspector" aria-labelledby="context-inspector-title">
    <header className="context-intro"><span className="context-eyebrow">Контекст и инструкции</span><h2 id="context-inspector-title">Что получит ИИ в следующем сообщении</h2><p>Здесь собраны эффективные настройки запуска и сведения, которые помогут ИИ ответить. Итог динамических источников определится после отправки текста.</p></header>
    {machineProblem && <aside className="context-problem" role="alert"><div><b>Машина недоступна</b><p>{machine?.explanation || 'Настроенная машина сейчас недоступна.'}</p></div>{props.onOpenSettings && <Button size="sm" onClick={props.onOpenSettings}>Перейти к настройкам разговора</Button>}</aside>}
    <section className="context-card" aria-labelledby="context-launch-title"><h3 id="context-launch-title">Как будет запущен ответ</h3><dl className="context-launch-grid">{launchValues.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd><small>Источник: {sourceLabel(entry.source ?? 'Серверный снимок')}</small></div>)}</dl>{workdir?.configured && !workdir.available && <p className="context-note">{workdir.explanation}</p>}</section>
    <section className="context-card" aria-labelledby="context-knowledge-title"><h3 id="context-knowledge-title">Что ИИ будет знать</h3><div className="context-items" role="list">{knowledgeItems.map((item) => <div role="listitem" key={item.id}>{itemCard(item)}</div>)}</div>{knowledgeItems.length === 0 && <p>Сведения о контексте пока отсутствуют.</p>}</section>
    <details className="context-section"><summary><span><b>Дополнительные возможности</b><small>Навыки, MCP, приложения, плагины, машины и AGENTS.md</small></span><span className="context-count">{additionalItems.length}</span></summary><div className="context-items" role="list">{additionalItems.map((item) => <div role="listitem" key={item.id}>{itemCard(item)}</div>)}</div>{additionalItems.length === 0 && <p className="context-empty">Дополнительные возможности не обнаружены.</p>}</details>
    <details className="context-section"><summary><span><b>Технические сведения</b><small>Диагностика снимка и исходные признаки</small></span><span className="context-count">{allItems.length}</span></summary><div className="context-technical"><dl><div><dt>Время снимка</dt><dd>{new Date(snapshot.generatedAt).toLocaleString('ru-RU')}</dd></div><div><dt>Версия схемы</dt><dd>{snapshot.schemaVersion}</dd></div><div><dt>Актуальность</dt><dd>{snapshot.freshnessWarning}</dd></div></dl>{snapshotGroups.map((group) => <section key={group.id}><h4>{group.title}</h4><div className="context-tech-items">{group.items.map((item) => <button type="button" key={item.id} onClick={() => openDetail(item.id)}><b>{item.title}</b><small>ID: {item.id} · configured: {state(item.configured)} · available: {state(item.available)} · includedInNextTurn: {state(item.includedInNextTurn)}</small></button>)}</div></section>)}</div></details>
  </section>
}
