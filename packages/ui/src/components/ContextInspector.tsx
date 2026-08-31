import { useEffect, useMemo, useState } from 'react'
import type { AgentInfo } from '@shared/agentProtocol'
import { CONTEXT_LOCK_TEXT } from '@shared/contextGating'
import { KB_CONTEXT_MODES, PERMISSION_MODES } from '@shared/types'
import type { AgentsChainResult, ContextKbPreview, ContextSnapshotItem, ConversationContextSnapshot, KbContextMode, LlmProvider, PermissionMode, UserRole } from '@shared/types'
import type { ProjectSummary } from '@shared/projects'
import { Button, useToast } from '@voicechat/ui-kit'

type UserStatus = 'Будет использовано' | 'Доступно при необходимости' | 'Не настроено' | 'Недоступно' | 'Определится после отправки' | 'Выключено вами'
export interface ContextInspectorProps {
  conversationId: string
  provider: LlmProvider
  model: string
  permissionMode: PermissionMode
  kbMode: KbContextMode
  agent?: AgentInfo
  workdir: string | null
  project?: ProjectSummary
  selectedSkillNames: string[]
  onOpenSettings?: () => void
  /** Текущая машина разговора — быстрая правка сохраняет её без изменений. */
  execTarget?: string | null
  /** Быстрая правка применена: у окна настроек свой черновик, его надо обновить. */
  onQuickEdit?: (value: { kbContextMode?: KbContextMode; permissionMode?: PermissionMode | null; llmProvider?: LlmProvider | null; llmModel?: string | null }) => void
}

const dynamicIds = new Set(['current-message', 'knowledge-mode'])
const primaryIds = new Set(['platform-instructions', 'application-instructions', 'personalization', 'project-binding', 'knowledge-mode', 'conversation-history', 'current-message'])
/** Фильтр списка: показывать всё, только уходящее в ход или только исключённое. */
type ItemFilter = 'all' | 'included' | 'excluded'

function userStatus(item: ContextSnapshotItem): UserStatus {
  if (item.toggleable && !item.enabled) return 'Выключено вами'
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
  if (item.toggleable && !item.enabled) return 'Вы выключили источник для этого разговора — в промпт он не попадёт.'
  if (item.id === 'current-message') return 'Текст станет известен после отправки сообщения.'
  if (item.id === 'knowledge-mode' && item.configured) return 'Подходящие документы выбираются по тексту отправляемого сообщения.'
  if (item.id.startsWith('skill-')) return item.configured ? 'Навык выбран, но активируется только при подходящем сообщении.' : 'Навык доступен и может быть выбран для разговора.'
  return item.explanation || (item.includedInNextTurn ? 'Сервер включил источник в следующий ход.' : !item.configured ? 'Источник не настроен.' : !item.available ? 'Источник сейчас недоступен.' : 'Источник доступен модели по необходимости.')
}
/** «≈120 токенов · 480 символов» — вклад пункта в промпт; null — вклада нет. */
function sizeLabel(item: ContextSnapshotItem): string | null {
  if (!item.size || item.size.chars === 0) return null
  return `≈${item.size.approxTokens} токенов · ${item.size.chars} символов`
}
function detailIdFromHash(conversationId: string): string | null {
  const prefix = `#/chat/${encodeURIComponent(conversationId)}/context/`
  return window.location.hash.startsWith(prefix) ? decodeURIComponent(window.location.hash.slice(prefix.length).split(/[/?]/)[0] ?? '') : null
}
/** Совпадение пункта с поисковой строкой: заголовок, описание, id и тип. */
function matchesQuery(item: ContextSnapshotItem, query: string): boolean {
  if (!query.trim()) return true
  const needle = query.trim().toLowerCase()
  return [item.title, item.description, item.id, item.type, item.explanation].some((field) => field.toLowerCase().includes(needle))
}
/**
 * Почему автоконтекста не будет. Причину считает подборщик (`emptyReason`), и
 * они разные по смыслу: «ничего не нашлось» и «нашлось, но уверенность низкая» —
 * это разные ответы на вопрос «а почему модель не получит документы».
 */
function kbEmptyText(preview: ContextKbPreview): string {
  if (preview.mode !== 'auto') return 'Режим базы знаний — не «Авто»: автоматический контекст не добавляется, но модель может искать сама инструментами.'
  switch (preview.emptyReason) {
    case 'kb-unavailable': return 'База знаний сейчас недоступна — автоматический контекст не добавится.'
    case 'empty-query': return 'Введите черновик сообщения: подбор считается по его тексту.'
    case 'low-confidence': return 'Подходящие разделы нашлись, но уверенность подбора низкая — автоматически они не добавятся. Модель сможет запросить их инструментами базы знаний.'
    case 'budget': return 'Найденные разделы не поместились в бюджет автоконтекста — они не добавятся.'
    default: return 'Для такого сообщения подходящих разделов не нашлось — автоматический контекст не добавится.'
  }
}
function roleHint(role: UserRole): string {
  return role === 'admin'
    ? 'Вы администратор: видны все сведения снимка и доступны любые настройки разговора.'
    : 'Доступны просмотр всего контекста и правка того, что не связано с безопасностью и другими людьми.'
}

export function ContextInspector(props: ContextInspectorProps): JSX.Element {
  const toast = useToast()
  const [detailId, setDetailId] = useState<string | null>(() => detailIdFromHash(props.conversationId))
  useEffect(() => {
    const sync = (): void => setDetailId(detailIdFromHash(props.conversationId))
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [props.conversationId])
  const [snapshot, setSnapshot] = useState<ConversationContextSnapshot | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ItemFilter>('all')
  /** Идут ли изменения тумблера/быстрой правки — на это время контролы блокируются. */
  const [busy, setBusy] = useState(false)
  /** Черновик сообщения и подбор базы знаний по нему (по кнопке, не на каждый ввод). */
  const [draft, setDraft] = useState('')
  const [kbPreview, setKbPreview] = useState<ContextKbPreview | null>(null)
  const [kbBusy, setKbBusy] = useState(false)
  /** Цепочка AGENTS.md: читается только по явной просьбе — файл на чужой машине. */
  const [chain, setChain] = useState<AgentsChainResult | null>(null)
  const [chainBusy, setChainBusy] = useState(false)
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
  const allItems = useMemo(() => snapshotGroups.flatMap((group) => group.items), [snapshotGroups])
  const byId = (id: string): ContextSnapshotItem | undefined => allItems.find((entry) => entry.id === id)
  const detail = detailId ? byId(detailId) : undefined
  const openDetail = (id: string): void => { window.location.hash = `/chat/${encodeURIComponent(props.conversationId)}/context/${encodeURIComponent(id)}`; setDetailId(id) }
  const closeDetail = (): void => { window.location.hash = `/chat/${encodeURIComponent(props.conversationId)}`; setDetailId(null) }
  const state = (value: boolean): string => value ? 'Да' : 'Нет'

  // Тумблер пункта: сервер возвращает свежий снимок, поэтому пересчитанные
  // includedInNextTurn и предпросмотр промпта приходят одним ответом.
  const toggleItem = async (item: ContextSnapshotItem, enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      const next = await window.api['conversations:setContextItem']({ id: props.conversationId, itemId: item.id, enabled })
      if (next) setSnapshot(next)
      else setSnapshotError('Разговор или источник больше недоступен.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  // Быстрая правка настроек разговора прямо из инспектора: человек уже видит,
  // что уйдёт модели, и логично менять это здесь, а не уходя на другую вкладку.
  const quickSave = async (patch: { kbContextMode?: KbContextMode; permissionMode?: PermissionMode | null; llmProvider?: LlmProvider | null; llmModel?: string | null }): Promise<void> => {
    setBusy(true)
    try {
      await window.api['conversations:setExecTarget']({ id: props.conversationId, execTarget: props.execTarget ?? null, ...patch })
      props.onQuickEdit?.(patch)
      setReload((value) => value + 1)
      toast.success('Настройка применена к этому разговору')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  // Подбор БЗ считается по кнопке: запрос идёт в индекс и может быть небыстрым,
  // а на каждый набранный символ он был бы и бесполезен, и дорог.
  const previewKb = async (): Promise<void> => {
    setKbBusy(true)
    try {
      setKbPreview(await window.api['conversations:contextKbPreview']({ id: props.conversationId, draft }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setKbBusy(false)
    }
  }

  // Массовое переключение: по одному пункту за раз (сервер отдаёт свежий снимок
  // на каждый вызов), последний ответ и становится состоянием экрана.
  const toggleMany = async (items: ContextSnapshotItem[], enabled: boolean): Promise<void> => {
    setBusy(true)
    try {
      let last: ConversationContextSnapshot | null = null
      for (const item of items) {
        last = await window.api['conversations:setContextItem']({ id: props.conversationId, itemId: item.id, enabled })
      }
      if (last) setSnapshot(last)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const readAgentsChain = async (): Promise<void> => {
    setChainBusy(true)
    try {
      setChain(await window.api['conversations:agentsChain']({ id: props.conversationId }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setChainBusy(false)
    }
  }

  /** Скачать снимок файлом: в поддержку удобнее приложить файл, а не буфер. */
  const download = (name: string, text: string, type: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  }

  const copy = async (text: string, what: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} скопирован${what.endsWith('т') ? '' : 'а'} в буфер обмена`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  if (snapshotError) return <section className="context-inspector context-error" role="alert"><h2>Не удалось загрузить сведения</h2><p>{snapshotError}</p><Button size="sm" onClick={() => setReload((value) => value + 1)}>Повторить</Button></section>
  if (!snapshot) return <section className="context-inspector context-loading" aria-busy="true"><h2>Формируем сведения для следующего сообщения…</h2><p>Проверяем настройки и доступность окружения.</p></section>
  if (detailId && !detail) return <section className="context-detail"><Button size="sm" onClick={closeDetail}>← Ко всем источникам</Button><h2>Источник не найден</h2><p>Он мог стать недоступен после обновления конфигурации.</p></section>
  if (detail) {
    const block = snapshot.promptPreview.blocks.find((entry) => entry.itemIds.includes(detail.id))
    return <section className="context-detail" aria-labelledby="context-detail-title">
      <Button size="sm" onClick={closeDetail}>← Ко всем источникам</Button>
      <header><span className="context-type">{detail.type}</span><h2 id="context-detail-title">{detail.title}</h2><p>{detail.description}</p></header>
      {detail.toggleable
        ? <label className="context-detail-toggle"><input type="checkbox" checked={detail.enabled} disabled={busy} onChange={(event) => void toggleItem(detail, event.target.checked)} /><span>Учитывать в этом разговоре</span></label>
        : <p className="context-note" data-testid="context-lock-note">🔒 {CONTEXT_LOCK_TEXT[detail.lockReason ?? 'info']}</p>}
      <dl className="context-metadata">
        <div><dt>Приоритет</dt><dd>{detail.priority}</dd></div><div><dt>Источник</dt><dd>{detail.source}</dd></div><div><dt>Область действия</dt><dd>{detail.scope}</dd></div>
        <div><dt>Настроено</dt><dd>{state(detail.configured)}</dd></div><div><dt>Доступно</dt><dd>{state(detail.available)}</dd></div><div><dt>Будет добавлено в следующий ход</dt><dd>{state(detail.includedInNextTurn)}</dd></div>
        {detail.inheritance && <div><dt>Наследование</dt><dd>{detail.inheritance.overriddenFrom ? `Переопределено чатом (без переопределения было бы: ${detail.inheritance.overriddenFrom})` : detail.inheritance.inheritedFrom ? `Унаследовано: ${detail.inheritance.inheritedFrom}` : detail.inheritance.effective}</dd></div>}
        {sizeLabel(detail) && <div><dt>Размер в промпте</dt><dd>{sizeLabel(detail)}</dd></div>}
        <div><dt>Пояснение</dt><dd>{detail.explanation}</dd></div>
        {detail.details && Object.entries(detail.details)
          // Текст, который ниже показан карточкой с переносами и копированием,
          // в метаданных не дублируем: одно и то же двумя способами читается хуже.
          .filter(([, value]) => !(block && typeof value === 'string' && value.trim() === block.text.trim()))
          .map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(', ') : String(value ?? '—')}</dd></div>)}
      </dl>
      {block && <section className="context-card" aria-labelledby="context-detail-block">
        <h3 id="context-detail-block">Текст в промпте следующего хода</h3>
        {block.itemIds.length > 1 && <p className="context-note">Одна подсказка на несколько источников ({block.title}) — модели уходит общий текст.</p>}
        <pre className="context-prompt">{block.text}</pre>
        <div className="context-actions"><Button size="sm" onClick={() => void copy(block.text, 'Текст')}>Скопировать текст</Button></div>
      </section>}
    </section>
  }

  const llm = byId('llm')
  const machine = byId('machine')
  const workdir = byId('working-directory')
  const permission = byId('permission-mode')
  const visible = (item: ContextSnapshotItem): boolean => matchesQuery(item, query)
    && (filter === 'all' || (filter === 'included' ? item.includedInNextTurn : !item.includedInNextTurn))
  const knowledgeItems = allItems.filter((item) => primaryIds.has(item.id) && visible(item))
  const additionalItems = allItems.filter((item) => (item.id === 'agents-chain' || item.id.startsWith('skill-') || item.id.startsWith('mcp-')) && visible(item))
  const instructionItems = allItems.filter((item) => item.id.startsWith('instruction-') && visible(item))
  // Отдельный список «не попадёт»: раньше это приходилось выяснять по статусам
  // каждой карточки, хотя вопрос «чего не будет» задают не реже обратного.
  const excludedItems = allItems.filter((item) => !item.includedInNextTurn && matchesQuery(item, query))
  const machineProblem = Boolean(machine?.configured && !machine.available)
  const launchValues = [
    { label: 'ИИ', value: snapshot.summary.provider, source: llm?.source },
    { label: 'Модель', value: snapshot.summary.model || 'Модель из конфигурации CLI', source: llm?.source },
    { label: 'Машина', value: machineProblem ? 'Недоступно' : machine?.description || 'Не настроена', source: machine?.source },
    { label: 'Рабочая папка', value: workdir?.scope || workdir?.description || 'Не настроена', source: workdir?.source },
    { label: 'Режим доступа', value: snapshot.summary.permissionMode.displayName, source: permission?.source }
  ]
  // Что именно переопределено — из `inheritance` снимка, а не из догадки UI.
  const overridden = allItems
    .filter((item) => item.inheritance?.overriddenFrom && (item.id !== 'permission-mode' || snapshot.viewerRole === 'admin'))
    .map((item) => item.title)
  const toggleable = allItems.filter((item) => item.toggleable)
  const enabledToggleable = toggleable.filter((item) => item.enabled)
  const disabledToggleable = toggleable.filter((item) => !item.enabled)
  const isAdmin = snapshot.viewerRole === 'admin'
  const preview = snapshot.promptPreview

  // `withToggle` — тумблер у пункта. В сводке «Не попадёт» его нет намеренно:
  // два чекбокса с одинаковой подписью на один пункт — путаница для скринридера,
  // поэтому управление живёт в основном списке, а сводка только объясняет.
  const itemCard = (item: ContextSnapshotItem, withToggle: boolean): JSX.Element => <div className="context-item" key={item.id}>
    {!withToggle
      ? <span className="context-lock" aria-hidden="true">·</span>
      : item.toggleable
        ? <label className="context-toggle" title={`Учитывать «${item.title}» в этом разговоре`}>
            <input type="checkbox" checked={item.enabled} disabled={busy} aria-label={`Учитывать «${item.title}» в этом разговоре`} onChange={(event) => void toggleItem(item, event.target.checked)} />
          </label>
        : <span className="context-lock" role="img" aria-label={CONTEXT_LOCK_TEXT[item.lockReason ?? 'info']} title={CONTEXT_LOCK_TEXT[item.lockReason ?? 'info']}>🔒</span>}
    <button type="button" className="context-item-open" onClick={() => openDetail(item.id)}>
      <span className="context-item-main"><b>{item.title}</b><small>{item.description}</small><small className="context-reason"><b>Почему:</b> {reasonFor(item)}</small>{sizeLabel(item) && <small className="context-size">{sizeLabel(item)}</small>}</span>
      <span className="context-status">{userStatus(item)}</span><span aria-hidden="true">→</span>
    </button>
  </div>

  const itemList = (items: ContextSnapshotItem[], empty: string, withToggle = true): JSX.Element => <>
    <div className="context-items" role="list">{items.map((item) => <div role="listitem" key={item.id}>{itemCard(item, withToggle)}</div>)}</div>
    {items.length === 0 && <p className="context-empty">{empty}</p>}
  </>

  return <section className="context-inspector" aria-labelledby="context-inspector-title">
    <header className="context-intro">
      <span className="context-eyebrow">Контекст и инструкции</span>
      <h2 id="context-inspector-title">Что получит ИИ в следующем сообщении</h2>
      <p>Здесь собраны эффективные настройки запуска и сведения, которые помогут ИИ ответить. Итог динамических источников определится после отправки текста.</p>
      <p className="context-role" data-testid="context-role-hint">{roleHint(snapshot.viewerRole)}</p>
    </header>
    {machineProblem && <aside className="context-problem" role="alert"><div><b>Машина недоступна</b><p>{machine?.explanation || 'Настроенная машина сейчас недоступна.'}</p></div>{props.onOpenSettings && <Button size="sm" onClick={props.onOpenSettings}>Перейти к настройкам разговора</Button>}</aside>}
    <section className="context-card" aria-labelledby="context-launch-title">
      <h3 id="context-launch-title">Как будет запущен ответ</h3>
      <dl className="context-launch-grid">{launchValues.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd><small>Источник: {sourceLabel(entry.source ?? 'Серверный снимок')}</small></div>)}</dl>
      {workdir?.configured && !workdir.available && <p className="context-note">{workdir.explanation}</p>}
      {/* Сброс переопределений: строка «Источник: Переопределение чата» говорит,
          что значение своё, но вернуть наследование было можно только через
          другую вкладку. Режим доступа — безопасность, его сбрасывает админ. */}
      {overridden.length > 0 && <div className="context-reset">
        <p>Этот разговор переопределяет: {overridden.join(', ')}.</p>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void quickSave({
          llmProvider: null, llmModel: null, ...(isAdmin ? { permissionMode: null } : {})
        })}>Вернуть наследование</Button>
      </div>}
      <div className="context-quickedit">
        <label>
          <span>База знаний</span>
          <select aria-label="База знаний" value={snapshot.summary.kbMode.value} disabled={busy} onChange={(event) => void quickSave({ kbContextMode: event.target.value as KbContextMode })}>
            {KB_CONTEXT_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
          </select>
          <small>{snapshot.summary.kbMode.explanation}</small>
        </label>
        <label>
          <span>Режим доступа</span>
          {isAdmin
            ? <select aria-label="Режим доступа" value={snapshot.summary.permissionMode.value} disabled={busy} onChange={(event) => void quickSave({ permissionMode: event.target.value as PermissionMode })}>
                {PERMISSION_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
              </select>
            : <output data-testid="context-permission-readonly">{snapshot.summary.permissionMode.displayName}</output>}
          <small>{isAdmin ? snapshot.summary.permissionMode.explanation : 'Режим доступа относится к безопасности: его определяют роль, политика машины и общие настройки.'}</small>
        </label>
      </div>
    </section>
    <section className="context-card" aria-labelledby="context-prompt-title">
      <h3 id="context-prompt-title">Итоговый текст для модели</h3>
      <div className="context-prompt-head">
        <p data-testid="context-prompt-size">Сервер добавит {preview.blocks.length} блок(ов): ≈{preview.approxTokens} токенов, {preview.chars} символов.</p>
        <div className="context-actions">
          <Button size="sm" disabled={!preview.text} onClick={() => void copy(preview.text, 'Текст')}>Скопировать текст</Button>
          <Button size="sm" variant="ghost" onClick={() => void copy(JSON.stringify(snapshot, null, 2), 'Снимок')}>Скопировать JSON снимка</Button>
          <Button size="sm" variant="ghost" onClick={() => download(`context-${props.conversationId}.json`, JSON.stringify(snapshot, null, 2), 'application/json')}>Скачать снимок</Button>
        </div>
      </div>
      {preview.text
        ? <pre className="context-prompt" data-testid="context-prompt-preview">{preview.text}</pre>
        : <p className="context-empty">Своих блоков сервер не добавляет: в ход уйдут только история разговора и ваше сообщение.</p>}
      <details className="context-omitted"><summary>Чего в этом тексте нет</summary><ul>{preview.omitted.map((line) => <li key={line}>{line}</li>)}</ul></details>
    </section>
    <section className="context-card" aria-labelledby="context-kb-title">
      <h3 id="context-kb-title">Что добавит база знаний</h3>
      <div className="context-kbdraft">
        <label>
          <span>Черновик сообщения</span>
          <textarea value={draft} rows={3} placeholder="Вставьте или напишите то, что собираетесь спросить" onChange={(event) => setDraft(event.target.value)} />
          <small>Подбор зависит от текста сообщения, поэтому в снимке его нет: проверьте черновиком, не отправляя.</small>
        </label>
        <div className="context-actions">
          <Button size="sm" disabled={kbBusy || !draft.trim()} loading={kbBusy} onClick={() => void previewKb()}>Показать подбор</Button>
        </div>
      </div>
      {kbPreview && (kbPreview.text
        ? <div data-testid="context-kb-result">
            <p className="context-note">Уверенность: {kbPreview.confidence ?? '—'} · ≈{kbPreview.approxTokens} токенов · разделов: {kbPreview.sections.length}</p>
            <ul className="context-kbsections">{kbPreview.sections.map((section) => <li key={`${section.documentId}#${section.anchor ?? ''}`}>{section.title} <small>{section.documentId}{section.anchor ? `#${section.anchor}` : ''} · {section.chars} символов</small></li>)}</ul>
            <pre className="context-prompt">{kbPreview.text}</pre>
            <div className="context-actions"><Button size="sm" onClick={() => void copy(kbPreview.text, 'Текст')}>Скопировать текст</Button></div>
          </div>
        : <p className="context-empty" data-testid="context-kb-empty">{kbEmptyText(kbPreview)}</p>)}
    </section>
    <section className="context-card" aria-labelledby="context-agents-title">
      <div className="context-cardhead">
        <h3 id="context-agents-title">Цепочка AGENTS.md</h3>
        <Button size="sm" disabled={chainBusy} loading={chainBusy} onClick={() => void readAgentsChain()}>Прочитать с машины</Button>
      </div>
      <p className="context-note">Файлы читает исполнитель в рабочей директории, поэтому снимок их не раскрывает. Прочитать можно здесь — по вашей просьбе, с машины разговора.</p>
      {chain && (chain.unavailable
        ? <p className="context-empty" data-testid="context-agents-unavailable">{chain.unavailable}</p>
        : chain.files.length === 0
          ? <p className="context-empty" data-testid="context-agents-empty">В {chain.workdir} и выше файлов AGENTS.md нет — модель их не получит.</p>
          : <div data-testid="context-agents-result">
              <p className="context-note">Машина: {chain.machineName ?? '—'} · директория: {chain.workdir} · файлов: {chain.files.length} (от общей к конкретной)</p>
              {chain.files.map((file) => <details key={file.path} className="context-agentfile">
                <summary>{file.path} <small>{file.error ? file.error : `${file.chars} символов`}</small></summary>
                {file.text !== null && <pre className="context-prompt">{file.text}</pre>}
              </details>)}
            </div>)}
    </section>
    <div className="context-filters" role="search">
      <input type="search" value={query} placeholder="Поиск по источникам контекста" aria-label="Поиск по источникам контекста" onChange={(event) => setQuery(event.target.value)} />
      <div className="context-filter-tabs" role="group" aria-label="Фильтр источников">
        {([['all', 'Все'], ['included', 'Попадёт в ход'], ['excluded', 'Не попадёт']] as const).map(([id, label]) =>
          <Button key={id} size="sm" variant={filter === id ? 'primary' : 'ghost'} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</Button>)}
      </div>
    </div>
    <section className="context-card" aria-labelledby="context-knowledge-title">
      <div className="context-cardhead">
        <h3 id="context-knowledge-title">Что ИИ будет знать</h3>
        {/* Массовые действия: выключать десяток пунктов по одному — работа, а не
            выбор. «Всё необязательное» не трогает пункты с замком: их и нельзя. */}
        <div className="context-actions">
          <Button size="sm" variant="ghost" disabled={busy || disabledToggleable.length === 0} onClick={() => void toggleMany(disabledToggleable, true)}>Включить всё ({disabledToggleable.length})</Button>
          <Button size="sm" variant="ghost" disabled={busy || enabledToggleable.length === 0} onClick={() => void toggleMany(enabledToggleable, false)}>Выключить необязательное ({enabledToggleable.length})</Button>
        </div>
      </div>
      {itemList(knowledgeItems, 'Под фильтр и поиск ничего не подошло.')}
    </section>
    {instructionItems.length > 0 && <details className="context-section" open><summary><span><b>Инструкции чата</b><small>Подсказки из общих настроек; здесь их можно выключить только для этого разговора</small></span><span className="context-count">{instructionItems.length}</span></summary>{itemList(instructionItems, 'Под фильтр и поиск ничего не подошло.')}</details>}
    <details className="context-section" data-testid="context-excluded"><summary><span><b>Не попадёт в следующий ход</b><small>Выключенное вами, ненастроенное и недоступное — с причиной</small></span><span className="context-count">{excludedItems.length}</span></summary>{itemList(excludedItems, 'Всё найденное попадёт в следующий ход.', false)}</details>
    <details className="context-section"><summary><span><b>Дополнительные возможности</b><small>Навыки, MCP, приложения, плагины, машины и AGENTS.md</small></span><span className="context-count">{additionalItems.length}</span></summary>{itemList(additionalItems, 'Дополнительные возможности не обнаружены.')}</details>
    <details className="context-section"><summary><span><b>Технические сведения</b><small>Диагностика снимка и исходные признаки</small></span><span className="context-count">{allItems.length}</span></summary><div className="context-technical"><dl><div><dt>Время снимка</dt><dd>{new Date(snapshot.generatedAt).toLocaleString('ru-RU')}</dd></div><div><dt>Версия схемы</dt><dd>{snapshot.schemaVersion}</dd></div><div><dt>Роль смотрящего</dt><dd>{snapshot.viewerRole}</dd></div><div><dt>Актуальность</dt><dd>{snapshot.freshnessWarning}</dd></div></dl>{snapshotGroups.map((group) => <section key={group.id}><h4>{group.title}</h4><div className="context-tech-items">{group.items.map((item) => <button type="button" key={item.id} onClick={() => openDetail(item.id)}><b>{item.title}</b><small>ID: {item.id} · configured: {state(item.configured)} · available: {state(item.available)} · includedInNextTurn: {state(item.includedInNextTurn)} · enabled: {state(item.enabled)}</small></button>)}</div></section>)}</div></details>
  </section>
}
