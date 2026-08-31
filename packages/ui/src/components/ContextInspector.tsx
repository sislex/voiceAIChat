import { useEffect, useMemo, useState, type SyntheticEvent } from 'react'
import type { AgentInfo } from '@shared/agentProtocol'
import { CONTEXT_LOCK_TEXT, skillNameForContextId } from '@shared/contextGating'
import { instructionIdForContextId, instructionText } from '@shared/chatInstructions'
import { KB_CONTEXT_MODES, PERMISSION_MODES } from '@shared/types'
import type { AgentsChainResult, ChatInstruction, ContextDiff, ContextKbPreview, ContextPreset, ContextSnapshotItem, ConversationContextSnapshot, KbContextMode, LlmProvider, PermissionMode, UserRole } from '@shared/types'
import type { ProjectSummary } from '@shared/projects'
import { Button, useConfirm, useToast } from '@voicechat/ui-kit'

type UserStatus = 'Будет использовано' | 'Доступно при необходимости' | 'Не настроено' | 'Недоступно' | 'Определится после отправки' | 'Выключено вами' | 'Выключено в настройках'
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
  /** Выбрать или снять навык разговора прямо из инспектора. */
  onToggleSkill?: (name: string, selected: boolean) => void
  /** Другие разговоры пользователя — источник для копирования контекста. */
  otherConversations?: Array<{ id: string; title: string }>
  /** Пресеты контекста пользователя: применить и сохранить текущий набор. */
  contextPresets?: ContextPreset[]
  onSavePresets?: (presets: ContextPreset[]) => Promise<void>
  /** Пресет, применяемый к новым разговорам (общая настройка пользователя). */
  defaultPresetId?: string | null
  onSetDefaultPreset?: (presetId: string | null) => Promise<void>
  /** Вложения черновика: они уйдут с сообщением, но снимку не видны. */
  draftAttachments?: Array<{ name: string; status?: string }>
  /** Инструкции чата из общих настроек — правятся здесь же, но действуют везде. */
  chatInstructions?: ChatInstruction[]
  /** Сохранить правку текста инструкции (общие настройки пользователя). */
  onSaveInstruction?: (id: string, text: string) => Promise<void>
  /** Добавить свою инструкцию чата в общие настройки пользователя. */
  onAddInstruction?: (title: string, text: string) => Promise<void>
  /** Открыть раздел «Инструкции» общих настроек (там их порядок и удаление). */
  onOpenInstructionSettings?: () => void
  /** Скопировать контекст текущего разговора в другой («применить к выбранным»). */
  onCopyContextTo?: (targetId: string, fromId: string) => Promise<void>
}

const dynamicIds = new Set(['current-message', 'knowledge-mode'])
const primaryIds = new Set(['platform-instructions', 'application-instructions', 'personalization', 'project-binding', 'knowledge-mode', 'conversation-history', 'current-message'])
/** Фильтр списка: показывать всё, только уходящее в ход или только исключённое. */
type ItemFilter = 'all' | 'included' | 'excluded' | 'touched'

function userStatus(item: ContextSnapshotItem): UserStatus {
  if (item.toggleable && !item.enabled) return 'Выключено вами'
  // Инструкция, выключенная в общих настройках, раньше выглядела как «Не
  // настроено» — а это разные вещи: она есть, но отключена во всех чатах.
  if (item.id.startsWith('instruction-') && !item.configured) return 'Выключено в настройках'
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
/**
 * С какой доли постоянной части пункт называется тяжёлым. Пятая часть — та
 * граница, за которой выключение одного источника заметно меняет и объём, и
 * счёт; ниже это шум на фоне остальных десяти пунктов.
 */
const HEAVY_ITEM_SHARE = 0.2
/** Ключ раскрытых разделов инспектора в localStorage. */
const OPEN_SECTIONS_KEY = 'vc.context.sections'
function sizeLabel(item: ContextSnapshotItem): string | null {
  if (!item.size || item.size.chars === 0) return null
  return `≈${item.size.approxTokens} токенов · ${item.size.chars} символов`
}
function detailIdFromHash(conversationId: string): string | null {
  const prefix = `#/chat/${encodeURIComponent(conversationId)}/context/`
  return window.location.hash.startsWith(prefix) ? decodeURIComponent(window.location.hash.slice(prefix.length).split(/[/?]/)[0] ?? '') : null
}
/**
 * Совпадение пункта с поисковой строкой: заголовок, описание, id, тип — и текст
 * блока, который этот пункт добавляет в промпт. Последнее важнее остального:
 * вопрос звучит как «почему модель знает про отпуск», а слово «отпуск» стоит
 * не в названии источника, а внутри персонализации или инструкции.
 */
function matchesQuery(item: ContextSnapshotItem, query: string, blockText = ''): boolean {
  if (!query.trim()) return true
  const needle = query.trim().toLowerCase()
  return [item.title, item.description, item.id, item.type, item.explanation, blockText].some((field) => field.toLowerCase().includes(needle))
}
/**
 * Разбивает текст на куски вокруг совпадений, чтобы подсветить найденное.
 * Возвращает пары «текст, совпадение ли» — рисование остаётся за компонентом.
 *
 * Число подсветок ограничено: на короткой подстроке вроде «ии» в семитысячном
 * тексте инструкции их выходит две с лишним тысячи (проверено в браузере), и
 * это столько же узлов DOM на каждый ввод символа. Дальше лимита текст идёт
 * целым куском — сама выдача остаётся полной, подсвечено только начало.
 */
const HIGHLIGHT_LIMIT = 200
function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const needle = query.trim().toLowerCase()
  if (!needle) return [{ text, hit: false }]
  const parts: Array<{ text: string; hit: boolean }> = []
  const lower = text.toLowerCase()
  let from = 0
  let hits = 0
  while (hits < HIGHLIGHT_LIMIT) {
    const at = lower.indexOf(needle, from)
    if (at === -1) break
    if (at > from) parts.push({ text: text.slice(from, at), hit: false })
    parts.push({ text: text.slice(at, at + needle.length), hit: true })
    from = at + needle.length
    hits += 1
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false })
  return parts
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
/**
 * Текст файла. `Blob.text()` есть в браузерах, но не в jsdom (тесты пакета
 * идут на нём), поэтому при его отсутствии читаем `FileReader` — он есть везде.
 */
function readTextFile(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'))
    reader.readAsText(file)
  })
}

/** Одна строка о контексте: движок, размер, стоимость и что выключено. */
function summaryLine(value: ConversationContextSnapshot): string {
  const disabled = value.groups.flatMap((group) => group.items).filter((item) => item.toggleable && !item.enabled)
  const cost = value.promptPreview.costUsd === null ? '' : `, ≈$${value.promptPreview.costUsd.toFixed(4)} за ход`
  return [
    `Контекст ${value.conversationId}: ${value.summary.provider} · ${value.summary.model || 'модель из конфигурации CLI'}`,
    `постоянная часть ≈${value.promptPreview.approxTokens} токенов в ${value.promptPreview.blocks.length} блок(ах)${cost}`,
    // Итог хода — та цифра, ради которой сводку и копируют в задачу: без неё
    // «постоянная часть ≈600» выглядит маленькой в чате, где история весит втрое больше.
    value.promptPreview.turnTotal.resumed
      ? `ход продолжает сессию движка, история заново не передаётся`
      : `всего в ход ≈${value.promptPreview.turnTotal.approxTokens} токенов, история ≈${value.promptPreview.turnTotal.historyApproxTokens}`,
    `режим доступа: ${value.summary.permissionMode.displayName}; база знаний: ${value.summary.kbMode.displayName}`,
    disabled.length ? `выключено: ${disabled.map((item) => item.title).join(', ')}` : 'выключенных источников нет'
  ].join('; ')
}
function roleHint(role: UserRole): string {
  return role === 'admin'
    ? 'Вы администратор: видны все сведения снимка и доступны любые настройки разговора.'
    : 'Доступны просмотр всего контекста и правка того, что не связано с безопасностью и другими людьми.'
}

export function ContextInspector(props: ContextInspectorProps): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [detailId, setDetailId] = useState<string | null>(() => detailIdFromHash(props.conversationId))
  useEffect(() => {
    const sync = (): void => setDetailId(detailIdFromHash(props.conversationId))
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [props.conversationId])
  // «/» ставит фокус в поиск по источникам — их два десятка, и мышью до поля
  // каждый раз далеко. В поле ввода клавиша не перехватывается: иначе в
  // черновике сообщения нельзя набрать слэш.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const field = document.querySelector<HTMLInputElement>('.context-filters input[type="search"]')
      if (!field) return
      event.preventDefault()
      field.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [snapshot, setSnapshot] = useState<ConversationContextSnapshot | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ItemFilter>('all')
  /** Порядок списка: по размеру вклада вместо порядка сборки промпта. */
  const [heavyFirst, setHeavyFirst] = useState(false)
  /** Показывать источники только выбранной группы; пусто — все. */
  const [groupFilter, setGroupFilter] = useState('')
  /**
   * Админ смотрит экран как обычный пользователь. Проверять политику «что видит
   * developer» иначе можно только вторым аккаунтом, а вопрос возникает часто.
   */
  const [asDeveloper, setAsDeveloper] = useState(false)
  /** Имя нового пресета: поле рядом с кнопкой, а не системный prompt. */
  const [presetName, setPresetName] = useState('')
  /** Показывать в предпросмотре границы блоков с их размером. */
  const [showBlockMarks, setShowBlockMarks] = useState(false)
  /** Черновик новой инструкции чата: название и текст. */
  const [newInstructionTitle, setNewInstructionTitle] = useState('')
  const [newInstructionText, setNewInstructionText] = useState('')
  /** Результат сравнения с другим разговором; null — не сравнивали. */
  const [diff, setDiff] = useState<ContextDiff | null>(null)
  /** Какой пресет переименовывают и новое имя. */
  const [renamingPreset, setRenamingPreset] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  /**
   * Явное разрешение править чужой разговор. Снимок админ видит сразу, а вот
   * тумблеры до этой галочки заблокированы: чужой контекст не должен меняться
   * случайным кликом.
   */
  const [allowForeignEdit, setAllowForeignEdit] = useState(false)
  /** Фильтр журнала по автору изменений; пусто — все. */
  const [logActor, setLogActor] = useState('')
  /** Фильтр журнала по источнику; пусто — все. В длинном журнале вопрос чаще
   *  звучит «что было с этим пунктом», чем «что делал этот человек». */
  const [logItem, setLogItem] = useState('')
  /** Разговоры, к которым применяем пресет «к выбранным». */
  const [bulkTargets, setBulkTargets] = useState<string[]>([])
  /**
   * Пресет, выбранный в списке, но ещё не применённый. Применение переключает
   * сразу десяток пунктов, а из имени пресета не видно, что именно изменится —
   * поэтому сначала показываем разницу, и только потом трогаем настройки.
   */
  const [pendingPreset, setPendingPreset] = useState<string | null>(null)
  /**
   * Состояние пунктов на момент открытия экрана. После серии правок вопрос
   * «что я вообще натворил» задают о своей сессии, а журнал показывает всю
   * историю разговора, включая чужие и вчерашние изменения.
   */
  const [openingState, setOpeningState] = useState<Record<string, boolean> | null>(null)
  /** Идут ли изменения тумблера/быстрой правки — на это время контролы блокируются. */
  const [busy, setBusy] = useState(false)
  /** Черновик сообщения и подбор базы знаний по нему (по кнопке, не на каждый ввод). */
  const [draft, setDraft] = useState('')
  const [kbPreview, setKbPreview] = useState<ContextKbPreview | null>(null)
  const [kbBusy, setKbBusy] = useState(false)
  /**
   * Короткое объявление результата действия для скринридера. Тост виден глазами,
   * но выключение источника меняет содержимое списка, а не открывает окно —
   * без aria-live человек с читалкой не узнаёт, что именно произошло.
   */
  const [announce, setAnnounce] = useState('')
  /** Черновик текста инструкции чата в detail: правится и сохраняется по кнопке. */
  const [instructionDraft, setInstructionDraft] = useState<string | null>(null)
  /** Цепочка AGENTS.md: читается только по явной просьбе — файл на чужой машине. */
  const [chain, setChain] = useState<AgentsChainResult | null>(null)
  const [chainBusy, setChainBusy] = useState(false)
  /**
   * Какие разделы раскрыты. Хранится между открытиями: инспектор закрывают и
   * открывают десятки раз за настройку, и каждый раз раскрывать «Журнал» и
   * «Пресеты» заново — работа, которую человек уже сделал.
   */
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem(OPEN_SECTIONS_KEY)
      return raw ? JSON.parse(raw) as Record<string, boolean> : {}
    } catch {
      return {}
    }
  })
  /** Свойства раскрывающегося раздела: раскрытие переживает закрытие окна. */
  const sectionProps = (id: string): { open: boolean; onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void } => ({
    open: openSections[id] ?? false,
    onToggle: (event) => {
      const open = event.currentTarget.open
      setOpenSections((prev) => {
        const next = { ...prev, [id]: open }
        try {
          window.localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(next))
        } catch {
          // приватный режим браузера: раскрытие просто не переживёт закрытие
        }
        return next
      })
    }
  })
  useEffect(() => {
    let alive = true
    setSnapshot(null); setSnapshotError(null); setOpeningState(null)
    void window.api['conversations:contextSnapshot']({ id: props.conversationId }).then((value) => {
      if (!alive) return
      if (!value) setSnapshotError('Разговор или источник больше недоступен.')
      else {
        setSnapshot(value)
        // Точка отсчёта для «что изменилось с момента открытия»: ставится один
        // раз на разговор, а не на каждый ответ сервера — иначе собственные
        // правки сравнивались бы сами с собой и разница всегда была бы пустой.
        setOpeningState((prev) => prev ?? Object.fromEntries(value.groups.flatMap((group) => group.items.map((item) => [item.id, item.enabled]))))
      }
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
      if (next) {
        setSnapshot(next)
        setAnnounce(`${item.title}: ${enabled ? 'учитывается' : 'выключено'}. Блоков промпта: ${next.promptPreview.blocks.length}, ≈${next.promptPreview.approxTokens} токенов.`)
      } else setSnapshotError('Разговор или источник больше недоступен.')
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
      const result = await window.api['conversations:contextKbPreview']({ id: props.conversationId, draft })
      setKbPreview(result)
      setAnnounce(result?.text
        ? `База знаний добавит ${result.sections.length} раздел(ов), ≈${result.approxTokens} токенов.`
        : 'База знаний для этого черновика ничего не добавит.')
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
      if (last) {
        setSnapshot(last)
        setAnnounce(`${enabled ? 'Включено' : 'Выключено'} источников: ${items.length}. Блоков промпта: ${last.promptPreview.blocks.length}, ≈${last.promptPreview.approxTokens} токенов.`)
      }
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

  /**
   * Человекочитаемый отчёт снимка. JSON годится для разбора, но в переписке и
   * в задаче читают текст: что уйдёт, что выключено и почему.
   */
  const markdownReport = (value: ConversationContextSnapshot): string => {
    const lines: string[] = [
      `# Контекст разговора ${value.conversationId}`,
      '',
      `Снимок: ${new Date(value.generatedAt).toLocaleString('ru-RU')} · роль: ${value.viewerRole}`,
      `Движок: ${value.summary.provider} · ${value.summary.model || 'модель из конфигурации CLI'}`,
      `Режим доступа: ${value.summary.permissionMode.displayName} · база знаний: ${value.summary.kbMode.displayName}`,
      ''
    ]
    if (value.warnings.length) {
      lines.push('## Предупреждения', '')
      for (const warning of value.warnings) lines.push(`- ${warning.level === 'problem' ? '❗' : '•'} ${warning.text}`)
      lines.push('')
    }
    lines.push(`## Блоки промпта (${value.promptPreview.blocks.length}, ≈${value.promptPreview.approxTokens} токенов)`, '')
    for (const block of value.promptPreview.blocks) {
      lines.push(`### ${block.title} (≈${block.approxTokens} токенов)`, '', '```', block.text, '```', '')
    }
    lines.push('## Источники', '')
    for (const group of value.groups) {
      lines.push(`### ${group.title}`, '')
      for (const entry of group.items) {
        lines.push(`- ${entry.enabled ? '[x]' : '[ ]'} **${entry.title}** — ${userStatus(entry)}; ${reasonFor(entry)}`)
      }
      lines.push('')
    }
    lines.push('## Чего в предпросмотре нет', '')
    for (const line of value.promptPreview.omitted) lines.push(`- ${line}`)
    if (value.promptPreview.costUsd !== null) {
      lines.push('', `Оценка стоимости постоянной части: ≈$${value.promptPreview.costUsd.toFixed(4)} за ход (только входные токены).`)
    }
    if (value.turnSizes.length) {
      lines.push('', '## Размер промпта по ходам', '')
      for (const entry of value.turnSizes) lines.push(`- ${entry.at} · ${entry.model || 'модель из конфигурации CLI'} · ≈${entry.approxTokens} токенов${entry.resumed ? ' (продолжение сессии)' : ''}`)
    }
    if (value.changes.length) {
      lines.push('', '## Журнал изменений контекста', '')
      for (const event of value.changes) {
        lines.push(`- ${new Date(event.at).toLocaleString('ru-RU')} · ${event.actor} · ${event.enabled ? 'вернул' : 'выключил'}: ${event.itemId}`)
      }
    }
    return lines.join('\n')
  }

  /**
   * Журнал в CSV. Разделитель — точка с запятой: Excel в русской локали читает
   * запятую как разделитель дробной части и складывает строку в одну ячейку.
   * Кавычки внутри поля удваиваются — иначе дата с точкой с запятой в тексте
   * разъедет таблицу.
   */
  const changesCsv = (value: ConversationContextSnapshot): string => {
    const cell = (text: string): string => `"${text.replace(/"/g, '""')}"`
    const rows = [['Время', 'Кто', 'Действие', 'Источник', 'ID источника'].map(cell).join(';')]
    for (const event of value.changes) {
      rows.push([
        new Date(event.at).toLocaleString('ru-RU'),
        event.actor,
        event.enabled ? 'вернул' : 'выключил',
        byId(event.itemId)?.title ?? event.itemId,
        event.itemId
      ].map(cell).join(';'))
    }
    return rows.join('\n')
  }

  /** Применить пресет: набор приводится к сохранённому, как при копировании. */
  const applyPreset = async (presetId: string): Promise<void> => {
    const preset = props.contextPresets?.find((entry) => entry.id === presetId)
    if (!preset || !snapshot) return
    const wanted = new Set(preset.disabled)
    const toDisable = toggleable.filter((item) => wanted.has(item.id) && item.enabled)
    const toEnable = toggleable.filter((item) => !wanted.has(item.id) && !item.enabled)
    setBusy(true)
    try {
      if (toDisable.length) await toggleMany(toDisable, false)
      if (toEnable.length) await toggleMany(toEnable, true)
      setAnnounce(`Пресет «${preset.name}» применён.`)
      toast.success(`Пресет «${preset.name}» применён`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * Сохранить текущий набор выключений как пресет. Имя вводится в поле рядом:
   * `window.prompt` в проекте запрещён — он не знает про тему и не кликается
   * в тестах.
   */
  const savePreset = async (): Promise<void> => {
    if (!props.onSavePresets || !snapshot || !presetName.trim()) return
    const disabled = toggleable.filter((item) => !item.enabled).map((item) => item.id)
    const next = [...(props.contextPresets ?? []), { id: `preset-${Date.now()}`, name: presetName.trim(), disabled }]
    setBusy(true)
    try {
      await props.onSavePresets(next)
      setPresetName('')
      toast.success('Пресет сохранён')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Импорт пресетов из файла. Разбираем и приводим к контракту здесь же: файл
   * пришёл извне, и доверять его форме нельзя. Существующие пресеты остаются —
   * импорт добавляет, а не затирает чужую работу.
   */
  const importPresets = async (file: File): Promise<void> => {
    if (!props.onSavePresets) return
    setBusy(true)
    try {
      const parsed = JSON.parse(await readTextFile(file)) as unknown
      const incoming = (Array.isArray(parsed) ? parsed : [])
        .filter((entry): entry is ContextPreset => typeof entry === 'object' && entry !== null && typeof (entry as ContextPreset).name === 'string')
        .map((entry, index) => ({
          id: `imported-${Date.now()}-${index}`,
          name: String(entry.name).trim().slice(0, 60) || 'Без названия',
          disabled: Array.isArray(entry.disabled) ? entry.disabled.filter((item): item is string => typeof item === 'string') : []
        }))
      if (!incoming.length) {
        toast.error('В файле нет пресетов в понятном формате')
        return
      }
      await props.onSavePresets([...(props.contextPresets ?? []), ...incoming])
      toast.success(`Импортировано пресетов: ${incoming.length}`)
    } catch (error) {
      toast.error(error instanceof Error ? `Не удалось прочитать файл: ${error.message}` : String(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Переименовать пресет. Раньше «ошибся в названии» означало удалить и
   * сохранить заново — вместе с потерей набора, если чат уже изменился.
   */
  const renamePreset = async (presetId: string): Promise<void> => {
    if (!props.onSavePresets || !renameValue.trim()) return
    setBusy(true)
    try {
      await props.onSavePresets((props.contextPresets ?? []).map((entry) => entry.id === presetId ? { ...entry, name: renameValue.trim() } : entry))
      setRenamingPreset(null)
      toast.success('Пресет переименован')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /** Удалить пресет: список у человека свой, и чистить его он должен сам. */
  const deletePreset = async (presetId: string): Promise<void> => {
    if (!props.onSavePresets) return
    const preset = props.contextPresets?.find((entry) => entry.id === presetId)
    if (!preset) return
    if (!(await confirm({ title: 'Удалить пресет?', message: `Пресет «${preset.name}» будет удалён. Настройки разговоров не изменятся.`, confirmLabel: 'Удалить', variant: 'danger' }))) return
    setBusy(true)
    try {
      await props.onSavePresets((props.contextPresets ?? []).filter((entry) => entry.id !== presetId))
      toast.success('Пресет удалён')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Добавить свою инструкцию чата. Пропс `onAddInstruction` отсутствует —
   * пользуемся тем же `onSaveInstruction`, но для нового id: хост сам решает,
   * как положить её в общие настройки.
   */
  const addInstruction = async (): Promise<void> => {
    if (!props.onAddInstruction || !newInstructionTitle.trim() || !newInstructionText.trim()) return
    setBusy(true)
    try {
      await props.onAddInstruction(newInstructionTitle.trim(), newInstructionText.trim())
      setNewInstructionTitle('')
      setNewInstructionText('')
      setReload((value) => value + 1)
      toast.success('Инструкция добавлена')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Применить пресет к отмеченным разговорам. Сначала приводим к пресету текущий
   * чат, затем копируем его набор в остальные тем же серверным путём: так все
   * получают одинаковое состояние, а не считают его каждый по-своему.
   */
  const applyPresetToTargets = async (presetId: string): Promise<void> => {
    const preset = props.contextPresets?.find((entry) => entry.id === presetId)
    if (!preset || !props.onCopyContextTo || bulkTargets.length === 0) return
    const titles = bulkTargets.map((id) => props.otherConversations?.find((entry) => entry.id === id)?.title ?? id).join(', ')
    if (!(await confirm({
      title: 'Применить пресет к выбранным?',
      message: `Пресет «${preset.name}» будет применён к этому разговору и к: ${titles}. Их текущие выключения будут заменены.`,
      confirmLabel: 'Применить'
    }))) return
    setBusy(true)
    try {
      await applyPreset(presetId)
      for (const targetId of bulkTargets) await props.onCopyContextTo(targetId, props.conversationId)
      setAnnounce(`Пресет «${preset.name}» применён к ${bulkTargets.length + 1} разговорам.`)
      toast.success(`Пресет применён к ${bulkTargets.length + 1} разговорам`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /** Сравнить контекст с другим разговором. Только чтение: ничего не меняет. */
  const compareWith = async (otherId: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api['conversations:contextDiff']({ id: props.conversationId, otherId })
      if (!result) {
        toast.error('Разговор больше недоступен')
        return
      }
      setDiff(result)
      setAnnounce(`Сравнение с «${result.otherTitle}»: различий в источниках ${result.onlyHere.length + result.onlyThere.length}, в настройках ${result.settings.length}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /** Полный сброс: все источники включены и переопределения сняты. */
  const resetAll = async (): Promise<void> => {
    if (disabledToggleable.length) await toggleMany(disabledToggleable, true)
    if (overridden.length) await quickSave({ llmProvider: null, llmModel: null, ...(snapshot?.viewerRole === 'admin' ? { permissionMode: null } : {}) })
    setAnnounce('Контекст сброшен: все источники включены, переопределения сняты.')
  }

  /**
   * Перенести набор выключений из другого разговора. Сервер приводит текущий
   * набор к образцу (а не объединяет), поэтому «скопировать» значит именно
   * «сделать так же».
   */
  const copyFrom = async (fromConversationId: string): Promise<void> => {
    // Перед переносом показываем, что изменится: «скопировать» перезаписывает
    // набор целиком, и без подтверждения это слишком тихое действие.
    const title = props.otherConversations?.find((entry) => entry.id === fromConversationId)?.title ?? 'выбранного разговора'
    if (!(await confirm({
      title: 'Скопировать контекст?',
      message: `Набор выключенных источников станет таким же, как в «${title}». Текущие выключения этого разговора (${disabledToggleable.length}) будут заменены.`,
      confirmLabel: 'Скопировать'
    }))) return
    setBusy(true)
    try {
      const next = await window.api['conversations:copyContext']({ id: props.conversationId, fromConversationId })
      if (next) {
        setSnapshot(next)
        setAnnounce(`Контекст скопирован. Блоков промпта: ${next.promptPreview.blocks.length}, ≈${next.promptPreview.approxTokens} токенов.`)
        toast.success('Контекст скопирован из выбранного разговора')
      } else setSnapshotError('Разговор или источник больше недоступен.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
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
  // Правка запрещена, пока чужой чат не разблокирован явно: одно условие на все
  // контролы, вместо проверки `foreign` в каждом обработчике. Объявлено до
  // ветки detail — она рендерится раньше основного списка.
  const locked = snapshot.foreign && !allowForeignEdit
  if (detailId && !detail) return <section className="context-detail"><Button size="sm" onClick={closeDetail}>← Ко всем источникам</Button><h2>Источник не найден</h2><p>Он мог стать недоступен после обновления конфигурации.</p></section>
  if (detail) {
    const block = snapshot.promptPreview.blocks.find((entry) => entry.itemIds.includes(detail.id))
    const skillName = skillNameForContextId(detail.id)
    const instructionId = instructionIdForContextId(detail.id)
    const instruction = instructionId ? props.chatInstructions?.find((entry) => entry.id === instructionId) : undefined
    // Базовый текст — эффективный: у встроенной без правки это стандартная
    // подсказка, и показать надо именно её, а не пустое поле.
    const baseText = instruction ? instructionText(instruction) : ''
    const draftText = instructionDraft ?? baseText
    const saveInstruction = async (): Promise<void> => {
      if (!instruction || !props.onSaveInstruction) return
      setBusy(true)
      try {
        await props.onSaveInstruction(instruction.id, draftText)
        setInstructionDraft(null)
        setReload((value) => value + 1)
        toast.success('Текст инструкции сохранён')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(false)
      }
    }
    return <section className="context-detail" aria-labelledby="context-detail-title">
      <Button size="sm" onClick={closeDetail}>← Ко всем источникам</Button>
      <header className="context-detail-head">
        <div>
          <span className="context-type">{detail.type}</span>
          <h2 id="context-detail-title">{detail.title}</h2>
          <p>{detail.description}</p>
        </div>
        {/* Ссылка на конкретный источник: обсуждая «почему модель это знает»,
            удобно дать адрес карточки, а не объяснять путь по вкладкам. */}
        <Button size="sm" variant="ghost" onClick={() => void copy(`${window.location.origin}${window.location.pathname}#/chat/${encodeURIComponent(props.conversationId)}/context/${encodeURIComponent(detail.id)}`, 'Ссылка')}>Скопировать ссылку</Button>
      </header>
      {detail.toggleable
        ? <label className="context-detail-toggle"><input type="checkbox" checked={detail.enabled} disabled={busy || locked} onChange={(event) => void toggleItem(detail, event.target.checked)} /><span>Учитывать в этом разговоре</span></label>
        : <p className="context-note" data-testid="context-lock-note">🔒 {CONTEXT_LOCK_TEXT[detail.lockReason ?? 'info']}</p>}
      {/* История именно этого источника: общий журнал внизу отвечает «что тут
          было», а человек в карточке спрашивает «что было с ним». */}
      {(() => {
        const own = snapshot.changes.filter((event) => event.itemId === detail.id)
        return own.length > 0 && <details className="context-omitted" data-testid="context-detail-history">
          <summary>История этого источника ({own.length}): выключали {own.filter((event) => !event.enabled).length} раз</summary>
          <ul>{own.map((event) => <li key={`${event.at}-${String(event.enabled)}`}>{new Date(event.at).toLocaleString('ru-RU')} · {event.actor} · {event.enabled ? 'вернул' : 'выключил'}</li>)}</ul>
        </details>
      })()}
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
      {/* Навык выбирается здесь же: раньше инспектор показывал «выбран/не выбран»
          и отправлял человека на другую вкладку менять то, что он уже видит. */}
      {skillName && props.onToggleSkill && <div className="context-detail-toggle">
        <label>
          <input type="checkbox" checked={props.selectedSkillNames.includes(skillName)} disabled={busy || locked} onChange={(event) => props.onToggleSkill!(skillName, event.target.checked)} />
          <span>Выбрать навык для этого разговора</span>
        </label>
        <small>Выбор не равен активации: навык применяется, когда сообщение к нему подходит.</small>
      </div>}
      {/* Текст инструкции чата живёт в общих настройках пользователя, поэтому
          правка отсюда действует во всех его разговорах — об этом сказано прямо. */}
      {instruction && props.onSaveInstruction && <section className="context-card" aria-labelledby="context-instruction-edit">
        <h3 id="context-instruction-edit">Текст инструкции</h3>
        <p className="context-note">Это общая настройка: правка подействует во всех ваших разговорах. Чтобы отключить инструкцию только здесь, снимите галочку выше.</p>
        <div className="context-kbdraft">
          <label>
            <span>Текст, который получает модель</span>
            <textarea rows={6} value={draftText} aria-label="Текст инструкции" onChange={(event) => setInstructionDraft(event.target.value)} />
            {/* Размер тут же: инструкция уходит в КАЖДОМ ходе, и «немного
                допишу» превращается в постоянную наценку на весь чат. */}
            <small data-testid="context-instruction-size">
              {draftText.length} символов, ≈{Math.ceil(draftText.length / 4)} токенов в каждом ходе
              {draftText.length > 2000 ? ' — это много для постоянной подсказки' : ''}
              {draftText.trim() ? '' : ' · пустой текст сохранять нечего'}
            </small>
          </label>
          <div className="context-actions">
            <Button size="sm" disabled={busy || locked || draftText === baseText || !draftText.trim()} onClick={() => void saveInstruction()}>Сохранить текст</Button>
            <Button size="sm" variant="ghost" disabled={draftText === baseText} onClick={() => setInstructionDraft(null)}>Вернуть как было</Button>
          </div>
        </div>
      </section>}
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
  // «Изменённые» — те, которых человек касался: по журналу, а не по догадке.
  const touched = new Set(snapshot.changes.map((event) => event.itemId))
  // Группа пункта: фильтр по ней спрашивают, когда ищут «где настройки БЗ»,
  // а не конкретный источник по названию.
  const groupOfItem = new Map(snapshotGroups.flatMap((group) => group.items.map((item) => [item.id, group.id])))
  // Текст блока по пункту: он же используется поиском, чтобы «почему модель
  // это знает» находилось по содержимому промпта, а не только по названию.
  const blockTextOf = (itemId: string): string => snapshot.promptPreview.blocks.find((block) => block.itemIds.includes(itemId))?.text ?? ''
  const visible = (item: ContextSnapshotItem): boolean => (!groupFilter || groupOfItem.get(item.id) === groupFilter)
    && matchesQuery(item, query, blockTextOf(item.id))
    && (filter === 'all'
      || (filter === 'touched'
        ? touched.has(item.id)
        : filter === 'included' ? item.includedInNextTurn : !item.includedInNextTurn))
  /** Порядок: по размеру вклада (тяжёлые сверху) либо как собрал сервер. */
  const ordered = (items: ContextSnapshotItem[]): ContextSnapshotItem[] =>
    heavyFirst ? [...items].sort((a, b) => (b.size?.chars ?? 0) - (a.size?.chars ?? 0)) : items
  const knowledgeItems = allItems.filter((item) => primaryIds.has(item.id) && visible(item))
  const additionalItems = allItems.filter((item) => (item.id === 'agents-chain' || item.id.startsWith('skill-') || item.id.startsWith('mcp-')) && visible(item))
  const instructionItems = allItems.filter((item) => item.id.startsWith('instruction-') && visible(item))
  // Отдельный список «не попадёт»: раньше это приходилось выяснять по статусам
  // каждой карточки, хотя вопрос «чего не будет» задают не реже обратного.
  const excludedItems = allItems.filter((item) => !item.includedInNextTurn && matchesQuery(item, query, blockTextOf(item.id)))
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
  /** Включённые инструменты удалённой машины: их выключают одним действием. */
  const machineTools = toggleable.filter((item) => item.id.startsWith('mcp-remote-') && item.enabled)
  const enabledToggleable = toggleable.filter((item) => item.enabled)
  const disabledToggleable = toggleable.filter((item) => !item.enabled)
  // Эффективная роль экрана: админ может смотреть как обычный пользователь.
  const effectiveRole: UserRole = asDeveloper ? 'developer' : snapshot.viewerRole
  /** Подпись размера группы: сколько места занимают её блоки в промпте. */
  const groupSize = (groupId: string): string => {
    const size = snapshotGroups.find((group) => group.id === groupId)?.size
    return size ? ` · ≈${size.approxTokens} токенов` : ''
  }
  const isAdmin = effectiveRole === 'admin'
  const preview = snapshot.promptPreview
  /**
   * Цена одного токена постоянной части — из суммы, которую посчитал сервер по
   * своему прайсу. Своей таблицы цен в UI нет и быть не должно: она разъедется
   * с админской. Нет прайса для модели — нет и оценки экономии.
   */
  const usdPerToken = preview.costUsd !== null && preview.approxTokens > 0 ? preview.costUsd / preview.approxTokens : null
  /**
   * Что даст выключение пункта. Размер сам по себе отвечает «сколько занимает»,
   * а решение принимают по «сколько освободится» — и в токенах, и в деньгах за
   * каждый ход. Считаем только для включённых: у выключенного экономии нет.
   */
  const savingsLabel = (item: ContextSnapshotItem): string | null => {
    if (!item.enabled || !item.toggleable || !item.size || item.size.approxTokens === 0) return null
    const money = usdPerToken === null ? '' : `, −$${(usdPerToken * item.size.approxTokens).toFixed(4)} за ход`
    return `Выключение освободит ≈${item.size.approxTokens} токенов${money}`
  }
  /** Самый тяжёлый источник постоянной части; null — размеров ни у кого нет. */
  const heaviestItem = allItems
    .filter((item) => (item.size?.approxTokens ?? 0) > 0)
    .sort((a, b) => (b.size?.approxTokens ?? 0) - (a.size?.approxTokens ?? 0))[0] ?? null
  /** Доля пункта в постоянной части: «тяжёлым» помечаем от пятой части и выше. */
  const heavyShare = (item: ContextSnapshotItem): number => preview.approxTokens > 0 && item.size ? item.size.approxTokens / preview.approxTokens : 0

  // `withToggle` — тумблер у пункта. В сводке «Не попадёт» его нет намеренно:
  // два чекбокса с одинаковой подписью на один пункт — путаница для скринридера,
  // поэтому управление живёт в основном списке, а сводка только объясняет.
  const itemCard = (item: ContextSnapshotItem, withToggle: boolean): JSX.Element => <div className="context-item" key={item.id}>
    {!withToggle
      ? <span className="context-lock" aria-hidden="true">·</span>
      : item.toggleable
        ? <label className="context-toggle" title={`Учитывать «${item.title}» в этом разговоре`}>
            <input type="checkbox" checked={item.enabled} disabled={busy || locked} aria-label={`Учитывать «${item.title}» в этом разговоре`} onChange={(event) => void toggleItem(item, event.target.checked)} />
          </label>
        : <span className="context-lock" role="img" aria-label={CONTEXT_LOCK_TEXT[item.lockReason ?? 'info']} title={CONTEXT_LOCK_TEXT[item.lockReason ?? 'info']}>🔒</span>}
    <button type="button" className="context-item-open" onClick={() => openDetail(item.id)}>
      <span className="context-item-main"><b>{item.title}</b>{heavyShare(item) >= HEAVY_ITEM_SHARE && <span className="context-heavy" title={`Пункт занимает ${Math.round(heavyShare(item) * 100)}% постоянной части промпта`}>тяжёлый · {Math.round(heavyShare(item) * 100)}%</span>}<small>{item.description}</small><small className="context-reason"><b>Почему:</b> {reasonFor(item)}</small>{sizeLabel(item) && <small className="context-size">{sizeLabel(item)}{savingsLabel(item) ? ` · ${savingsLabel(item)}` : ''}</small>}</span>
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
      <p className="context-summary" data-testid="context-summary">
        Сервер добавит ≈{preview.approxTokens} токенов в {preview.blocks.length} блок(ах){snapshot.lastTurn ? `; в прошлый ход ушло ≈${snapshot.lastTurn.approxTokens}` : ''}.
        {' '}Выключено источников: {disabledToggleable.length} из {toggleable.length}.
        {/* Итог хода: в длинном чате место занимает история, и без этой строки
            человек ищет экономию не там, где она есть. */}
        {/* Самый тяжёлый источник: сортировка по весу уже есть, но чаще нужен
            один переход к тому, что занимает больше всех. */}
        {heaviestItem && <Button size="sm" variant="ghost" onClick={() => openDetail(heaviestItem.id)}>Самый тяжёлый: {heaviestItem.title}</Button>}
        {' '}<span data-testid="context-turn-total">{preview.turnTotal.resumed
          ? `Ход продолжает сессию движка: история заново не уходит, всего ≈${preview.turnTotal.approxTokens} токенов.`
          : `Всего в следующий ход: ≈${preview.turnTotal.approxTokens} токенов, из них история — ≈${preview.turnTotal.historyApproxTokens}.`}</span>
      </p>
      {/* Чужой чат: без явной пометки легко решить, что правишь свой контекст. */}
      {snapshot.foreign && <div className="context-foreign" role="status" data-testid="context-foreign">
        <p>Это разговор пользователя <b>{snapshot.owner}</b>. Изменения попадут в его чат, и в журнале останется ваш логин.</p>
        {/* По умолчанию чужой чат только читается: случайный клик по тумблеру
            меняет работу другого человека, а не свою. */}
        <label>
          <input type="checkbox" checked={allowForeignEdit} onChange={(event) => setAllowForeignEdit(event.target.checked)} />
          <span>Разрешить изменения в этом разговоре</span>
        </label>
      </div>}
      <p className="context-role" data-testid="context-role-hint">
        {roleHint(effectiveRole)}
        {snapshot.viewerRole === 'admin' && <label className="context-asrole">
          <input type="checkbox" checked={asDeveloper} onChange={(event) => setAsDeveloper(event.target.checked)} />
          <span>Смотреть как обычный пользователь</span>
        </label>}
      </p>
    </header>
    {/* Предупреждения считает сервер: настройки формально верны, но вместе дают
        не то, чего ждёт человек. Проблемы идут раньше замечаний. */}
    {snapshot.warnings.length > 0 && <aside className={`context-warnings context-warnings--${snapshot.warnings[0]?.level ?? 'notice'}`} role={snapshot.warnings.some((entry) => entry.level === 'problem') ? 'alert' : 'status'} data-testid="context-warnings">
      <b>Стоит проверить</b>
      <ul>{snapshot.warnings.map((warning) => <li key={warning.text}>
        <span aria-hidden="true">{warning.level === 'problem' ? '❗' : '•'}</span> {warning.text}
        {warning.itemId && byId(warning.itemId) && <Button size="sm" variant="ghost" onClick={() => openDetail(warning.itemId!)}>Открыть источник</Button>}
      </li>)}</ul>
    </aside>}
    <nav className="context-toc" aria-label="Разделы контекста">
      {/* Страница длинная: без переходов до «Итогового текста» и списка источников
          приходится прокручивать мимо всего остального. */}
      {[['context-launch-title', 'Запуск'], ['context-prompt-title', 'Итоговый текст'], ['context-kb-title', 'База знаний'], ['context-agents-title', 'AGENTS.md'], ['context-knowledge-title', 'Источники'], ...(snapshot.lastTurn ? [['context-lastturn-title', 'Прошлый ход'] as const] : [])].map(([id, label]) =>
        <Button key={id} size="sm" variant="ghost" onClick={() => document.getElementById(id)?.scrollIntoView({ block: 'start' })}>{label}</Button>)}
    </nav>
    {machineProblem && <aside className="context-problem" role="alert"><div><b>Машина недоступна</b><p>{machine?.explanation || 'Настроенная машина сейчас недоступна.'}</p></div>{props.onOpenSettings && <Button size="sm" onClick={props.onOpenSettings}>Перейти к настройкам разговора</Button>}</aside>}
    <section className="context-card" aria-labelledby="context-launch-title">
      <h3 id="context-launch-title">Как будет запущен ответ</h3>
      <dl className="context-launch-grid">{launchValues.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd><small>Источник: {sourceLabel(entry.source ?? 'Серверный снимок')}</small></div>)}</dl>
      {workdir?.configured && !workdir.available && <p className="context-note">{workdir.explanation}</p>}
      {/* Сброс переопределений: строка «Источник: Переопределение чата» говорит,
          что значение своё, но вернуть наследование было можно только через
          другую вкладку. Режим доступа — безопасность, его сбрасывает админ. */}
      {(overridden.length > 0 || disabledToggleable.length > 0) && <div className="context-reset">
        <p>{overridden.length > 0 ? `Этот разговор переопределяет: ${overridden.join(', ')}.` : `Выключено источников: ${disabledToggleable.length}.`}</p>
        <div className="context-actions">
          {overridden.length > 0 && <Button size="sm" variant="ghost" disabled={busy || locked} onClick={() => void quickSave({
            llmProvider: null, llmModel: null, ...(isAdmin ? { permissionMode: null } : {})
          })}>Вернуть наследование</Button>}
          {/* Полный сброс: одно действие вместо «включить всё» + «вернуть
              наследование» по очереди — так чат возвращается к состоянию нового. */}
          <Button size="sm" variant="ghost" disabled={busy || locked} onClick={() => void resetAll()}>Сбросить контекст к обычному</Button>
        </div>
      </div>}
      <div className="context-quickedit">
        <label>
          <span>База знаний</span>
          <select aria-label="База знаний" value={snapshot.summary.kbMode.value} disabled={busy || locked} onChange={(event) => void quickSave({ kbContextMode: event.target.value as KbContextMode })}>
            {KB_CONTEXT_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
          </select>
          <small>{snapshot.summary.kbMode.explanation}</small>
        </label>
        <label>
          <span>Режим доступа</span>
          {isAdmin
            ? <select aria-label="Режим доступа" value={snapshot.summary.permissionMode.value} disabled={busy || locked} onChange={(event) => void quickSave({ permissionMode: event.target.value as PermissionMode })}>
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
        <p data-testid="context-prompt-size">Сервер добавит {preview.blocks.length} блок(ов): ≈{preview.approxTokens} токенов, {preview.chars} символов{preview.costUsd === null ? '' : `, ≈$${preview.costUsd.toFixed(4)} за ход`}. Снимок от {new Date(snapshot.generatedAt).toLocaleTimeString('ru-RU')}.</p>
        <div className="context-actions">
          <Button size="sm" disabled={!preview.text} onClick={() => void copy(preview.text, 'Текст')}>Скопировать текст</Button>
          <Button size="sm" variant="ghost" onClick={() => void copy(JSON.stringify(snapshot, null, 2), 'Снимок')}>Скопировать JSON снимка</Button>
          <Button size="sm" variant="ghost" onClick={() => download(`context-${props.conversationId}.json`, JSON.stringify(snapshot, null, 2), 'application/json')}>Скачать снимок</Button>
          <Button size="sm" variant="ghost" onClick={() => download(`context-${props.conversationId}.md`, markdownReport(snapshot), 'text/markdown')}>Скачать отчёт (Markdown)</Button>
          {/* Настройки могли измениться в другом окне или другим админом:
              снимок отражает момент открытия, и обновить его надо уметь. */}
          <Button size="sm" variant="ghost" disabled={busy || locked} onClick={() => setReload((value) => value + 1)}>Обновить снимок</Button>
          {/* Одна строка для задачи или переписки: «что уходит и сколько это
              стоит» без вложения файлов и без пересказа руками. */}
          <Button size="sm" variant="ghost" onClick={() => void copy(summaryLine(snapshot), 'Сводка')}>Скопировать сводку</Button>
          {/* Ссылка на саму вкладку: в переписке чаще нужен «вот этот экран»,
              а не конкретный источник. */}
          <Button size="sm" variant="ghost" onClick={() => void copy(`${window.location.origin}${window.location.pathname}#/chat/${encodeURIComponent(props.conversationId)}/context`, 'Ссылка')}>Скопировать ссылку на вкладку</Button>
          {/* Разметка блоков: без неё непонятно, где кончается одна подсказка и
              начинается другая — в промпте они склеены пустой строкой. */}
          <Button size="sm" variant={showBlockMarks ? 'primary' : 'ghost'} aria-pressed={showBlockMarks} onClick={() => setShowBlockMarks((value) => !value)}>Показать границы блоков</Button>
        </div>
      </div>
      {preview.text
        ? (query.trim()
            ? (() => {
                // При активном поиске показываем только те блоки, где он встречается:
                // искать глазами в двух тысячах символов — не работа для человека.
                const found = preview.blocks.filter((block) => block.text.toLowerCase().includes(query.trim().toLowerCase()))
                return found.length
                  ? <pre className="context-prompt" data-testid="context-prompt-preview">{highlightParts(found.map((block) => `— ${block.title} —\n${block.text}`).join('\n\n'), query).map((part, index) => part.hit
                      ? <mark key={index}>{part.text}</mark>
                      : <span key={index}>{part.text}</span>)}</pre>
                  : <p className="context-empty" data-testid="context-prompt-preview">В блоках промпта «{query.trim()}» не встречается.</p>
              })()
            : showBlockMarks
              // С границами блок становится единицей работы: его копируют
              // целиком, чтобы вставить в задачу или сравнить с ответом модели.
              ? <div data-testid="context-prompt-preview">{preview.blocks.map((block, index) => <div className="context-block" key={`${block.title}-${index}`}>
                  <div className="context-actions">
                    <b>{index + 1}. {block.title}</b>
                    <small>≈{block.approxTokens} токенов</small>
                    <Button size="sm" variant="ghost" onClick={() => void copy(block.text, 'Блок')}>Скопировать блок</Button>
                  </div>
                  <pre className="context-prompt">{block.text}</pre>
                </div>)}</div>
              : <pre className="context-prompt" data-testid="context-prompt-preview">{preview.text}</pre>)
        : <p className="context-empty">Своих блоков сервер не добавляет: в ход уйдут только история разговора и ваше сообщение.</p>}
      {/* Вложения черновика знает только клиент: снимок описывает сохранённое
          состояние, а файлы приложены к неотправленному сообщению. */}
      {(props.draftAttachments?.length ?? 0) > 0 && <p className="context-note" data-testid="context-draft-attachments">
        С сообщением уйдут вложения: {props.draftAttachments!.map((file) => `${file.name}${file.status && file.status !== 'ready' ? ` (${file.status})` : ''}`).join(', ')}.
      </p>}
      {/* Что модель НЕ сможет вызвать: по списку доступных возможностей этого
          не увидеть, а вопрос «почему она не читает файлы» задают именно так. */}
      {snapshot.disallowedTools.length > 0 && <p className="context-note" data-testid="context-disallowed">
        Инструменты выключены и не будут доступны модели: {snapshot.disallowedTools.join(', ')}.
      </p>}
      {/* Во что обойдётся тот же объём на других моделях движка: вопрос «а если
          перейти на модель попроще» задают, глядя ровно на эту цифру. */}
      {preview.costByModel.length > 0 && <details className="context-omitted" data-testid="context-cost-models">
        <summary>Тот же объём на других моделях</summary>
        <ul>{preview.costByModel.map((entry) => <li key={entry.model}>{entry.model}: ≈${entry.costUsd.toFixed(4)} за ход</li>)}</ul>
      </details>}
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
    {snapshot.lastTurn && <section className="context-card" aria-labelledby="context-lastturn-title">
      <h3 id="context-lastturn-title">Что ушло в прошлый ход</h3>
      {/* Снимок — прогноз на следующее сообщение. Здесь факт: ровно тот текст,
          который сервер отправил модели, из `meta.request` сохранённого ответа. */}
      <p className="context-note" data-testid="context-lastturn-meta">
        {snapshot.lastTurn.at} · {snapshot.lastTurn.provider} · {snapshot.lastTurn.model || 'модель из конфигурации CLI'} · ≈{snapshot.lastTurn.approxTokens} токенов, {snapshot.lastTurn.chars} символов
        {snapshot.lastTurn.resumed ? ' · продолжение сессии движка (история не пересобиралась)' : ' · история пересобиралась целиком'}
        {snapshot.lastTurn.attachments > 0 ? ` · вложения: ${snapshot.lastTurn.attachmentNames.join(', ') || snapshot.lastTurn.attachments}` : ''}
        {snapshot.lastTurn.kbSections.length ? ` · база знаний: ${snapshot.lastTurn.kbSections.join(', ')}` : ' · без автоконтекста базы знаний'}
      </p>
      {/* Что изменилось с того хода: сравниваем блоки прогноза с текстом,
          который реально ушёл. Дифф построчный не нужен — важно, какие блоки
          добавились или пропали, а не как переставились символы. */}
      {(() => {
        const sent = snapshot.lastTurn!.prompt
        const added = preview.blocks.filter((block) => !sent.includes(block.text.trim())).map((block) => block.title)
        return added.length > 0
          ? <p className="context-note" data-testid="context-lastturn-diff">С того хода добавились блоки: {added.join(', ')} — модель их ещё не видела.</p>
          : <p className="context-note" data-testid="context-lastturn-diff">Новых блоков с того хода нет: постоянная часть промпта та же.</p>
      })()}
      <details className="context-omitted"><summary>Показать отправленный текст</summary><pre className="context-prompt" data-testid="context-lastturn-prompt">{snapshot.lastTurn.prompt}</pre></details>
      <div className="context-actions"><Button size="sm" onClick={() => void copy(snapshot.lastTurn!.prompt, 'Текст')}>Скопировать отправленное</Button></div>
      {/* Рост контекста: «почему стало дороже» видно только в динамике, поэтому
          показываем размеры последних ходов, а не один текущий. */}
      {snapshot.turnSizes.length > 1 && <details className="context-omitted" data-testid="context-turnsizes">
        <summary>Как менялся размер промпта ({snapshot.turnSizes.length} ход(ов))</summary>
        <ul>{snapshot.turnSizes.map((entry, index) => <li key={`${entry.at}-${index}`}>
          {entry.at} · {entry.model || 'модель из конфигурации CLI'} · ≈{entry.approxTokens} токенов{entry.resumed ? ' · продолжение сессии' : ' · история пересобрана'}
        </li>)}</ul>
      </details>}
    </section>}
    <p className="context-announce" role="status" aria-live="polite" data-testid="context-announce">{announce}</p>
    <div className="context-filters" role="search">
      <input
        type="search"
        value={query}
        placeholder="Поиск по источникам контекста (/)"
        aria-label="Поиск по источникам контекста"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Esc чистит строку, а не закрывает окно настроек: пока фокус в
          // поиске, человек правит запрос, а не собирается уходить.
          if (event.key !== 'Escape' || !query) return
          event.stopPropagation()
          setQuery('')
        }}
      />
      {query.trim() && <span className="context-found" data-testid="context-found">Найдено: {allItems.filter((item) => matchesQuery(item, query, blockTextOf(item.id))).length}</span>}
      <label className="context-groupfilter">
        <span>Группа</span>
        <select aria-label="Фильтр по группе источников" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
          <option value="">все группы</option>
          {snapshotGroups.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
        </select>
      </label>
      <div className="context-filter-tabs" role="group" aria-label="Фильтр источников">
        {([['all', 'Все'], ['included', 'Попадёт в ход'], ['excluded', 'Не попадёт'], ['touched', 'Изменённые']] as const).map(([id, label]) =>
          <Button key={id} size="sm" variant={filter === id ? 'primary' : 'ghost'} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</Button>)}
        {/* Сортировка по размеру: когда промпт распух, первый вопрос — «кто
            занял место», и глазами по двум десяткам пунктов это не ищут. */}
        <Button size="sm" variant={heavyFirst ? 'primary' : 'ghost'} aria-pressed={heavyFirst} onClick={() => setHeavyFirst((value) => !value)}>Сначала тяжёлые</Button>
        {/* Свёрток на экране стало много: раскрывать по одной, чтобы найти
            нужное, — работа. Одна кнопка открывает и закрывает все. */}
        <Button size="sm" variant="ghost" onClick={() => {
          const sections = document.querySelectorAll<HTMLDetailsElement>('.context-inspector details.context-section')
          const shouldOpen = [...sections].some((section) => !section.open)
          sections.forEach((section) => { section.open = shouldOpen })
        }}>Развернуть / свернуть всё</Button>
      </div>
    </div>
    <section className="context-card" aria-labelledby="context-knowledge-title">
      <div className="context-cardhead">
        <h3 id="context-knowledge-title">Что ИИ будет знать</h3>
      {/* Что именно сделает пресет: имя вроде «минимальный» не говорит, какие
          десять пунктов оно выключит в этом конкретном разговоре. */}
      {pendingPreset && (() => {
        const preset = props.contextPresets?.find((entry) => entry.id === pendingPreset)
        if (!preset) return null
        const wanted = new Set(preset.disabled)
        const willDisable = toggleable.filter((item) => wanted.has(item.id) && item.enabled)
        const willEnable = toggleable.filter((item) => !wanted.has(item.id) && !item.enabled)
        return <div className="context-bulk" data-testid="context-preset-preview">
          <p>
            Пресет «{preset.name}»: выключит {willDisable.length}, вернёт {willEnable.length}
            {willDisable.length + willEnable.length === 0 ? ' — в этом разговоре уже так' : ''}.
          </p>
          {willDisable.length > 0 && <p className="context-note">Выключит: {willDisable.map((item) => item.title).join(', ')}.</p>}
          {willEnable.length > 0 && <p className="context-note">Вернёт: {willEnable.map((item) => item.title).join(', ')}.</p>}
          <div className="context-actions">
            <Button size="sm" disabled={busy || locked || willDisable.length + willEnable.length === 0} onClick={() => { const id = pendingPreset; setPendingPreset(null); void applyPreset(id) }}>Применить пресет</Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingPreset(null)}>Отмена</Button>
          </div>
        </div>
      })()}

        {/* Массовые действия: выключать десяток пунктов по одному — работа, а не
            выбор. «Всё необязательное» не трогает пункты с замком: их и нельзя. */}
        <div className="context-actions">
          <Button size="sm" variant="ghost" disabled={busy || locked || disabledToggleable.length === 0} onClick={() => void toggleMany(disabledToggleable, true)}>Включить всё ({disabledToggleable.length})</Button>
          <Button size="sm" variant="ghost" disabled={busy || locked || enabledToggleable.length === 0} onClick={() => void toggleMany(enabledToggleable, false)}>Выключить необязательное ({enabledToggleable.length})</Button>
          {/* Частый случай «пусть ничего не трогает на машине»: инструменты
              выключаются вместе, а не поштучно из каталога возможностей. */}
          {machineTools.length > 0 && <Button size="sm" variant="ghost" disabled={busy || locked} onClick={() => void toggleMany(machineTools, false)}>Выключить инструменты машины ({machineTools.length})</Button>}
          {/* Фильтр по группе выбран — значит человек работает именно с ней.
              Общие «включить всё» трогают весь разговор, и это не то, что он
              просил: выбрана группа — действуем в её границах. */}
          {groupFilter && (() => {
            const inGroup = toggleable.filter((item) => groupOfItem.get(item.id) === groupFilter)
            const offInGroup = inGroup.filter((item) => !item.enabled)
            const onInGroup = inGroup.filter((item) => item.enabled)
            const groupTitle = snapshotGroups.find((group) => group.id === groupFilter)?.title ?? 'группе'
            return <span className="context-group-bulk" data-testid="context-group-bulk">
              <Button size="sm" variant="ghost" disabled={busy || locked || offInGroup.length === 0} onClick={() => void toggleMany(offInGroup, true)}>Включить всё в «{groupTitle}» ({offInGroup.length})</Button>
              <Button size="sm" variant="ghost" disabled={busy || locked || onInGroup.length === 0} onClick={() => void toggleMany(onInGroup, false)}>Выключить всё в «{groupTitle}» ({onInGroup.length})</Button>
            </span>
          })()}
          {/* Настроить контекст один раз и переносить в другие чаты — обычная
              работа: раньше это означало щёлкать тумблеры заново по памяти. */}
          {/* Пресеты: набор выключений под именем. Настроил «минимальный контекст»
              один раз — применяешь к любому чату, а не щёлкаешь по памяти. */}
          {props.onSavePresets && <label className="context-copyfrom">
            <span>Пресет</span>
            <select aria-label="Применить пресет контекста" disabled={busy || locked} value="" onChange={(event) => { if (event.target.value) setPendingPreset(event.target.value) }}>
              <option value="">— выберите —</option>
              {(props.contextPresets ?? []).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
            <input
              type="text"
              value={presetName}
              placeholder="Имя пресета"
              aria-label="Имя нового пресета контекста"
              onChange={(event) => setPresetName(event.target.value)}
            />
            <Button size="sm" variant="ghost" disabled={busy || locked || !presetName.trim()} onClick={() => void savePreset()}>Сохранить текущий</Button>
            {/* Управление и перенос между инсталляциями: пресет — это данные
                пользователя, и увезти их файлом должно быть можно. */}
            {(props.contextPresets?.length ?? 0) > 0 && <Button size="sm" variant="ghost" disabled={busy || locked} onClick={() => download('context-presets.json', JSON.stringify(props.contextPresets ?? [], null, 2), 'application/json')}>Экспорт</Button>}
            <label className="context-import">
              <span>Импорт</span>
              <input type="file" accept="application/json,.json" aria-label="Импортировать пресеты контекста из файла" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPresets(file); event.target.value = '' }} />
            </label>
          </label>}
          {/* Сравнение — до копирования: вопрос «почему там работает, а здесь
              нет» задают раньше, чем готовы перезаписать свой набор. */}
          {(props.otherConversations?.length ?? 0) > 0 && <label className="context-copyfrom">
            <span>Сравнить с</span>
            <select aria-label="Сравнить контекст с разговором" disabled={busy || locked} value="" onChange={(event) => { if (event.target.value) void compareWith(event.target.value) }}>
              <option value="">— выберите —</option>
              {props.otherConversations!.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
            </select>
          </label>}
          {(props.otherConversations?.length ?? 0) > 0 && <label className="context-copyfrom">
            <span>Скопировать из</span>
            <select aria-label="Скопировать контекст из разговора" disabled={busy || locked} value="" onChange={(event) => { if (event.target.value) void copyFrom(event.target.value) }}>
              <option value="">— выберите разговор —</option>
              {props.otherConversations!.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
            </select>
          </label>}
        </div>
      </div>
      {itemList(ordered(knowledgeItems), 'Под фильтр и поиск ничего не подошло.')}
    </section>
    {props.onAddInstruction && <section className="context-card" aria-labelledby="context-newinstruction">
      <h3 id="context-newinstruction">Своя инструкция чата</h3>
      <p className="context-note">
        Текст уйдёт модели в каждом ходе всех ваших разговоров. Выключить в отдельном чате можно тумблером в списке ниже.
        {props.onOpenInstructionSettings && <>
          {' '}
          <Button size="sm" variant="ghost" onClick={props.onOpenInstructionSettings}>Открыть общие настройки инструкций</Button>
        </>}
      </p>
      <div className="context-kbdraft">
        <label>
          <span>Название</span>
          <input type="text" value={newInstructionTitle} aria-label="Название новой инструкции" onChange={(event) => setNewInstructionTitle(event.target.value)} />
        </label>
        <label>
          <span>Текст</span>
          <textarea rows={3} value={newInstructionText} aria-label="Текст новой инструкции" onChange={(event) => setNewInstructionText(event.target.value)} />
          <small>{newInstructionText.length} символов, ≈{Math.ceil(newInstructionText.length / 4)} токенов в каждом ходе</small>
        </label>
        <div className="context-actions">
          <Button size="sm" disabled={busy || locked || !newInstructionTitle.trim() || !newInstructionText.trim()} onClick={() => void addInstruction()}>Добавить инструкцию</Button>
        </div>
      </div>
    </section>}
    {instructionItems.length > 0 && <details className="context-section" data-testid="context-instructions-section" open><summary><span><b>Инструкции чата</b><small>Подсказки из общих настроек; здесь их можно выключить только для этого разговора{groupSize('chat-instructions')}</small></span><span className="context-count">{instructionItems.length}</span></summary>{itemList(ordered(instructionItems), 'Под фильтр и поиск ничего не подошло.')}</details>}
    <details className="context-section" data-testid="context-excluded" {...sectionProps('excluded')}><summary><span><b>Не попадёт в следующий ход</b><small>Выключенное вами, ненастроенное и недоступное — с причиной</small></span><span className="context-count">{excludedItems.length}</span></summary>{itemList(excludedItems, 'Всё найденное попадёт в следующий ход.', false)}</details>
    <details className="context-section" {...sectionProps('extra')}><summary><span><b>Дополнительные возможности</b><small>Навыки, MCP, приложения, плагины, машины и AGENTS.md</small></span><span className="context-count">{additionalItems.length}</span></summary>{itemList(ordered(additionalItems), 'Дополнительные возможности не обнаружены.')}</details>
    {diff && <section className="context-card" aria-labelledby="context-diff-title" data-testid="context-diff">
      <div className="context-cardhead">
        <h3 id="context-diff-title">Отличия от «{diff.otherTitle}»</h3>
        <Button size="sm" variant="ghost" onClick={() => setDiff(null)}>Закрыть сравнение</Button>
      </div>
      {diff.onlyHere.length === 0 && diff.onlyThere.length === 0 && diff.settings.length === 0
        ? <p className="context-empty">Контекст совпадает: те же источники и те же настройки запуска.</p>
        : <ul className="context-changelog">
            {diff.settings.map((entry) => <li key={entry.label}><b>{entry.label}</b>: здесь «{entry.here}», там «{entry.there}»</li>)}
            {/* Текст одной строкой: `<b>` внутри фразы разрывал её на узлы, и
                между «здесь» и двоеточием появлялся лишний пробел. */}
            {diff.onlyHere.map((entry) => <li key={`here-${entry.itemId}`}><b>Выключено только здесь:</b> {entry.title}</li>)}
            {diff.onlyThere.map((entry) => <li key={`there-${entry.itemId}`}><b>Выключено только там:</b> {entry.title}</li>)}
          </ul>}
    </section>}
    {(props.contextPresets?.length ?? 0) > 0 && <details className="context-section" data-testid="context-presets" {...sectionProps('presets')}>
      <summary><span><b>Пресеты контекста</b><small>Наборы выключений: применить, экспортировать или удалить</small></span><span className="context-count">{props.contextPresets!.length}</span></summary>
      {props.onSetDefaultPreset && <div className="context-bulk">
        <label>
          <span>Применять к новым разговорам</span>
          <select aria-label="Пресет по умолчанию для новых разговоров" value={props.defaultPresetId ?? ''} onChange={(event) => void props.onSetDefaultPreset!(event.target.value || null)}>
            <option value="">— не применять —</option>
            {props.contextPresets!.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        </label>
        <small>Новый чат сразу начнётся с этим набором: иначе «минимальный контекст» действует только после того, как про него вспомнят.</small>
      </div>}
      <ul className="context-changelog">{props.contextPresets!.map((preset) => <li key={preset.id}>
        {renamingPreset === preset.id
          ? <>
              <input
                type="text"
                value={renameValue}
                aria-label={`Новое название пресета «${preset.name}»`}
                onChange={(event) => setRenameValue(event.target.value)}
              />
              <Button size="sm" disabled={busy || locked || !renameValue.trim()} onClick={() => void renamePreset(preset.id)}>Сохранить</Button>
              <Button size="sm" variant="ghost" onClick={() => setRenamingPreset(null)}>Отмена</Button>
            </>
          : <>
              <b>{preset.name}</b> · выключено источников: {preset.disabled.length}
              <Button size="sm" variant="ghost" disabled={busy || locked} onClick={() => void applyPreset(preset.id)}>Применить</Button>
              {/* Один пресет обычно нужен нескольким чатам сразу: «к выбранным»
                  избавляет от обхода разговоров по одному. */}
              {props.onCopyContextTo && <Button size="sm" variant="ghost" disabled={busy || locked || bulkTargets.length === 0} onClick={() => void applyPresetToTargets(preset.id)}>Применить к выбранным ({bulkTargets.length})</Button>}
              <Button size="sm" variant="ghost" disabled={busy || locked} onClick={() => { setRenamingPreset(preset.id); setRenameValue(preset.name) }}>Переименовать</Button>
              <Button size="sm" variant="ghost" disabled={busy || locked} onClick={() => void deletePreset(preset.id)}>Удалить</Button>
            </>}
      </li>)}</ul>
      {(props.otherConversations?.length ?? 0) > 0 && props.onCopyContextTo && <div className="context-bulk" data-testid="context-bulk-targets">
        <b>Куда применять «к выбранным»</b>
        <div className="context-bulk-list">{props.otherConversations!.map((entry) => <label key={entry.id}>
          <input
            type="checkbox"
            checked={bulkTargets.includes(entry.id)}
            aria-label={`Применять к разговору «${entry.title}»`}
            onChange={(event) => setBulkTargets((prev) => event.target.checked ? [...prev, entry.id] : prev.filter((id) => id !== entry.id))}
          />
          <span>{entry.title}</span>
        </label>)}</div>
      </div>}
    </details>}
    {/* Что изменилось за это открытие экрана: журнал ниже показывает всю
        историю разговора, а «что я только что натворил» — вопрос про сессию. */}
    {(() => {
      if (!openingState) return null
      const changedNow = allItems.filter((item) => openingState[item.id] !== undefined && openingState[item.id] !== item.enabled)
      if (!changedNow.length) return null
      return <div className="context-bulk" data-testid="context-session-diff">
        <p>С момента открытия вы изменили пунктов: {changedNow.length}.</p>
        <ul>{changedNow.map((item) => <li key={item.id}>{item.title}: {openingState[item.id] ? 'было включено, стало выключено' : 'было выключено, стало включено'}</li>)}</ul>
        <div className="context-actions">
          <Button size="sm" variant="ghost" disabled={busy || locked} onClick={() => {
            // Возврат делаем теми же тумблерами, что и правку: сервер пишет
            // журнал сам, и откат остаётся видимым событием, а не тихой правкой.
            const back = changedNow.filter((item) => openingState[item.id])
            const off = changedNow.filter((item) => !openingState[item.id])
            void (async () => { if (back.length) await toggleMany(back, true); if (off.length) await toggleMany(off, false) })()
          }}>Вернуть как было при открытии</Button>
        </div>
      </div>
    })()}
    {snapshot.changes.length > 0 && <details className="context-section" data-testid="context-changes" {...sectionProps('changes')}><summary><span><b>Журнал изменений контекста</b><small>Кто и когда выключал или возвращал источники этого разговора</small></span><span className="context-count">{snapshot.changes.length}</span></summary>
      {/* Фильтр по автору: в чужом чате (или после админской правки) первый
          вопрос — «что менял именно этот человек». */}
      {new Set(snapshot.changes.map((event) => event.actor)).size > 1 && <div className="context-bulk">
        <label>
          <span>Кто менял</span>
          <select aria-label="Фильтр журнала по автору" value={logActor} onChange={(event) => setLogActor(event.target.value)}>
            <option value="">все</option>
            {[...new Set(snapshot.changes.map((event) => event.actor))].map((actor) => <option key={actor} value={actor}>{actor}</option>)}
          </select>
        </label>
      </div>}
      <div className="context-bulk">
        <label>
          <span>Какой источник</span>
          <select aria-label="Фильтр журнала по источнику" value={logItem} onChange={(event) => setLogItem(event.target.value)}>
            <option value="">все</option>
            {[...new Set(snapshot.changes.map((event) => event.itemId))].map((id) => <option key={id} value={id}>{byId(id)?.title ?? id}</option>)}
          </select>
        </label>
        {/* Журнал в задачу или в переписку с поддержкой: CSV открывается всем,
            в отличие от JSON снимка. */}
        <div className="context-actions">
          <Button size="sm" variant="ghost" onClick={() => download(`context-changes-${props.conversationId}.csv`, changesCsv(snapshot), 'text/csv')}>Экспорт журнала (CSV)</Button>
        </div>
      </div>
      <ul className="context-changelog">{snapshot.changes.filter((event) => (!logActor || event.actor === logActor) && (!logItem || event.itemId === logItem)).map((event, index, list) => {
        const item = byId(event.itemId)
        // Отменять можно только последнюю запись про этот пункт и только пока
        // состояние совпадает с ней: иначе «вернуть как было» вернуло бы не то
        // состояние, которое человек видит в строке журнала.
        const latest = list.findIndex((entry) => entry.itemId === event.itemId) === index
        const undoable = Boolean(item?.toggleable) && latest && item!.enabled === event.enabled && !locked
        return <li key={`${event.at}-${event.itemId}-${String(event.enabled)}`}>
          <b>{new Date(event.at).toLocaleString('ru-RU')}</b> · {event.actor} · {event.enabled ? 'вернул' : 'выключил'}:{' '}
          {item
            ? <Button size="sm" variant="ghost" onClick={() => openDetail(event.itemId)}>{item.title}</Button>
            : event.itemId}
          {undoable && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void toggleItem(item!, !event.enabled)}>Отменить</Button>}
        </li>
      })}</ul>
    </details>}
    <details className="context-section" {...sectionProps('technical')}><summary><span><b>Технические сведения</b><small>Диагностика снимка и исходные признаки</small></span><span className="context-count">{allItems.length}</span></summary><div className="context-technical">{snapshot.cliMcpServers.length > 0 && <dl data-testid="context-cli-mcp"><div><dt>MCP-серверы движка</dt><dd>{snapshot.cliMcpServers.map((server) => `${server.name} — ${server.status}`).join('; ')}</dd></div></dl>}<dl><div><dt>Время снимка</dt><dd>{new Date(snapshot.generatedAt).toLocaleString('ru-RU')}</dd></div><div><dt>Версия схемы</dt><dd>{snapshot.schemaVersion}</dd></div><div><dt>Роль смотрящего</dt><dd>{snapshot.viewerRole}</dd></div><div><dt>Актуальность</dt><dd>{snapshot.freshnessWarning}</dd></div></dl>{snapshotGroups.map((group) => <section key={group.id}><h4>{group.title}</h4><div className="context-tech-items">{group.items.map((item) => <button type="button" key={item.id} onClick={() => openDetail(item.id)}><b>{item.title}</b><small>ID: {item.id} · configured: {state(item.configured)} · available: {state(item.available)} · includedInNextTurn: {state(item.includedInNextTurn)} · enabled: {state(item.enabled)}</small></button>)}</div></section>)}</div></details>
  </section>
}
