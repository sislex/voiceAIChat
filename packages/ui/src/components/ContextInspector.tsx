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
  const [viewMode, setViewMode] = useState<'blocks' | 'table'>(() => window.localStorage.getItem('context-inspector-view') === 'table' ? 'table' : 'blocks')
  const [toggling, setToggling] = useState<string | null>(null)
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
  const selectView = (mode: 'blocks' | 'table'): void => {
    setViewMode(mode)
    window.localStorage.setItem('context-inspector-view', mode)
  }
  const toggleItem = async (itemId: string, enabled: boolean): Promise<void> => {
    setToggling(itemId)
    try {
      const next = await window.api['conversations:setContextItem']({ id: props.conversationId, itemId, enabled })
      if (next) setSnapshot(next)
    } catch (error) { setSnapshotError(error instanceof Error ? error.message : String(error)) }
    finally { setToggling(null) }
  }

  if (snapshotError) return <section className="context-inspector context-error" role="alert"><h2>Не удалось загрузить сведения</h2><p>{snapshotError}</p><Button size="sm" onClick={() => setReload((value) => value + 1)}>Повторить</Button></section>
  if (!snapshot) return <section className="context-inspector context-loading" aria-busy="true"><h2>Формируем сведения для следующего сообщения…</h2><p>Проверяем настройки и доступность окружения.</p></section>
  if (detailId && !detail) return <section className="context-detail"><Button size="sm" onClick={closeDetail}>← Ко всем источникам</Button><h2>Источник не найден</h2><p>Он мог стать недоступен после обновления конфигурации.</p></section>
  if (detail) return <section className="context-detail" aria-labelledby="context-detail-title">
    <Button size="sm" onClick={closeDetail}>← Ко всем источникам</Button>
    <header><span className="context-type">{detail.type}</span><h2 id="context-detail-title">{detail.title}</h2><p>{detail.description}</p></header>
    {detail.toggleable
      ? <label className="context-toggle"><input type="checkbox" checked={detail.enabled} disabled={toggling === detail.id} onChange={(event) => void toggleItem(detail.id, event.target.checked)} /> Включено для следующих сообщений {detail.enabled ? '' : '· сейчас выключено'}</label>
      : <p className="context-muted">Этот пункт нельзя выключить: это правило безопасности или служебная информация.</p>}
    <dl className="context-metadata">
      <div><dt>Приоритет</dt><dd>{detail.priority}</dd></div><div><dt>Источник</dt><dd>{detail.source}</dd></div><div><dt>Область действия</dt><dd>{detail.scope}</dd></div>
      <div><dt>Настроено</dt><dd>{state(detail.configured)}</dd></div><div><dt>Доступно</dt><dd>{state(detail.available)}</dd></div><div><dt>Будет добавлено в следующий ход</dt><dd>{state(detail.includedInNextTurn)}</dd></div>
      <div><dt>Пояснение</dt><dd>{detail.explanation}</dd></div>
      {detail.details && Object.entries(detail.details).map(([key, value]) => { const text = Array.isArray(value) ? value.join(', ') : String(value ?? '—'); return <div key={key} className={text.includes('\n') ? 'context-meta-block' : undefined}><dt>{key}</dt><dd>{text.includes('\n') ? <pre className="context-pre">{text}</pre> : text}</dd></div> })}
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

  const itemCard = (item: ContextSnapshotItem): JSX.Element => <div className={item.toggleable && !item.enabled ? 'context-row context-row--off' : 'context-row'} key={item.id}>
    {item.toggleable
      ? <label className="context-check" title={item.enabled ? 'Выключить для следующих сообщений' : 'Включить для следующих сообщений'}><input type="checkbox" aria-label={`Включить «${item.title}» для следующих сообщений`} checked={item.enabled} disabled={toggling === item.id} onChange={(event) => void toggleItem(item.id, event.target.checked)} /></label>
      : <span className="context-check context-check--locked" title="Нельзя выключить" aria-label="Нельзя выключить">🔒</span>}
    <button type="button" className="context-item" onClick={() => openDetail(item.id)}>
      <span className="context-item-main"><b>{item.title}</b><small>{item.description}</small><small className="context-reason"><b>Почему:</b> {reasonFor(item)}</small></span>
      <span className="context-status">{userStatus(item)}</span><span aria-hidden="true">→</span>
    </button>
  </div>
  const available = allItems.filter((item) => item.available).length
  const included = allItems.filter((item) => item.includedInNextTurn).length

  return <section className={`context-inspector context-inspector--${viewMode}`} aria-labelledby="context-inspector-title">
    <header className="context-intro"><span className="context-eyebrow">Контекст и инструкции</span><h2 id="context-inspector-title">Что получит ИИ в следующем сообщении</h2><p>Здесь собраны эффективные настройки запуска и сведения, которые помогут ИИ ответить. Итог динамических источников определится после отправки текста.</p></header>
    <div className="context-toolbar">
      <dl className="context-totals"><div><dt>Количество источников и возможностей</dt><dd>{allItems.length}</dd></div><div><dt>Количество доступных сейчас</dt><dd>{available}</dd></div><div><dt>Будут использованы в следующем ходе</dt><dd>{included}</dd></div></dl>
      <div className="context-view-switch" role="group" aria-label="Вид инспектора"><button type="button" aria-pressed={viewMode === 'blocks'} onClick={() => selectView('blocks')}>Блоки</button><button type="button" aria-pressed={viewMode === 'table'} onClick={() => selectView('table')}>Таблицы</button></div>
    </div>
    {machineProblem && <aside className="context-problem" role="alert"><div><b>Машина недоступна</b><p>{machine?.explanation || 'Настроенная машина сейчас недоступна.'}</p></div>{props.onOpenSettings && <Button size="sm" onClick={props.onOpenSettings}>Перейти к настройкам разговора</Button>}</aside>}
    {viewMode === 'blocks' ? <>
      <section className="context-card" aria-labelledby="context-launch-title"><h3 id="context-launch-title">Как будет запущен ответ</h3><dl className="context-launch-grid">{launchValues.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd><small>Источник: {sourceLabel(entry.source ?? 'Серверный снимок')}</small></div>)}</dl>{workdir?.configured && !workdir.available && <p className="context-note">{workdir.explanation}</p>}</section>
      <section className="context-card" aria-labelledby="context-knowledge-title"><h3 id="context-knowledge-title">Что ИИ будет знать</h3><div className="context-items" role="list">{knowledgeItems.map((item) => <div role="listitem" key={item.id}>{itemCard(item)}</div>)}</div>{knowledgeItems.length === 0 && <p>Сведения о контексте пока отсутствуют.</p>}</section>
      <details className="context-section"><summary><span><b>Дополнительные возможности</b><small>Навыки, MCP, приложения, плагины, машины и AGENTS.md</small></span><span className="context-count">{additionalItems.length}</span></summary><div className="context-items" role="list">{additionalItems.map((item) => <div role="listitem" key={item.id}>{itemCard(item)}</div>)}</div>{additionalItems.length === 0 && <p className="context-empty">Дополнительные возможности не обнаружены.</p>}</details>
      <details className="context-section"><summary><span><b>Технические сведения</b><small>Диагностика снимка и исходные признаки</small></span><span className="context-count">{allItems.length}</span></summary><div className="context-technical"><dl><div><dt>Время снимка</dt><dd>{new Date(snapshot.generatedAt).toLocaleString('ru-RU')}</dd></div><div><dt>Версия схемы</dt><dd>{snapshot.schemaVersion}</dd></div><div><dt>Актуальность</dt><dd>{snapshot.freshnessWarning}</dd></div></dl>{snapshotGroups.map((group) => <section key={group.id}><h4>{group.title}</h4><div className="context-tech-items">{group.items.map((item) => <button type="button" key={item.id} onClick={() => openDetail(item.id)}><b>{item.title}</b><small>ID: {item.id} · configured: {state(item.configured)} · available: {state(item.available)} · includedInNextTurn: {state(item.includedInNextTurn)}</small></button>)}</div></section>)}</div></details>
    </> : <div className="context-tables">{snapshotGroups.map((group) => <section className="context-table-section" key={group.id} aria-labelledby={`context-table-${group.id}`}>
      <header><div><h3 id={`context-table-${group.id}`}>{group.title}</h3><p>{group.description}</p></div><span className="context-count">{group.items.length}</span></header>
      <div className="context-table-scroll"><table className="context-table">
        <thead><tr><th className="context-table-toggle" scope="col"><span className="sr-only">Включено</span></th><th scope="col">Источник</th><th scope="col">Описание</th><th scope="col">Состояние</th><th scope="col">В следующем ходе</th><th className="context-table-open" scope="col"><span className="sr-only">Подробнее</span></th></tr></thead>
        <tbody>{group.items.map((item) => <tr className={item.toggleable && !item.enabled ? 'context-table-row--off' : undefined} key={item.id}>
          <td className="context-table-toggle">{item.toggleable
            ? <input type="checkbox" aria-label={`Включить «${item.title}» для следующих сообщений`} checked={item.enabled} disabled={toggling === item.id} onChange={(event) => void toggleItem(item.id, event.target.checked)} />
            : <span title="Нельзя выключить" aria-label="Нельзя выключить">🔒</span>}</td>
          <th scope="row"><button type="button" className="context-table-title" onClick={() => openDetail(item.id)}>{item.title}</button><small>{sourceLabel(item.source)}</small></th>
          <td><span>{item.description}</span><small><b>Почему:</b> {reasonFor(item)}</small></td>
          <td><span className="context-status">{userStatus(item)}</span></td>
          <td>{item.includedInNextTurn ? 'Да' : 'Нет'}</td>
          <td className="context-table-open"><button type="button" aria-label={`Открыть сведения об источнике «${item.title}»`} onClick={() => openDetail(item.id)}>→</button></td>
        </tr>)}</tbody>
      </table></div>
    </section>)}</div>}
  </section>
}
