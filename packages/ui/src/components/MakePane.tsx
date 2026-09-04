import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Button, Dialog, EmptyState, IconButton, useConfirm, useToast } from '@voicechat/ui-kit'
import type { RendererApi, RendererMakeBridge } from '@shared/ipc'
import type { EditorContextPayload } from '@shared/types'
import { formatUsd, type ConversationUsage } from '@shared/usageSummary'
import { pickTokensFile } from '@shared/makeTokens'
import { MAKE_AUTOSAVE_KEY, MAKE_FORMAT_ON_SAVE_KEY, MAKE_SPLIT_KEY, MAKE_SPLIT_PCT_KEY } from '../store/contracts'
import { makeNextSteps } from '@shared/makeNextSteps'
import { changedLines as diffLines } from '@shared/lineDiff'
import type { MakeReplacePreviewLine } from '@shared/makeSearch'
import { escapeMarkupText, replaceUniqueText } from '@shared/makeTextEdit'
import { reorderMarkup } from '@shared/makeReorder'
import { componentsWithoutStories, generateStoriesSource } from '@shared/makeStoriesGen'
import { loadImageData, pixelDiff } from '../lib/pixelDiff'
import { MakeMockTable, mockTableFor } from './MakeMockTable'
import { makeMockPrompt } from '@shared/makeMockPrompt'
import { MAKE_DEPLOY_TARGETS, type MakeDeployTarget } from '@shared/makeDeploy'
import { MAKE_SNAPSHOT_PREVIEW } from '@shared/make'
import { EMPTY_MAKE_SELECTION, pruneMakeSelection, toggleMakeSelection, type MakeSelectionState } from '@shared/makeSelection'
import { kilo } from '../lib/view'
import { REST } from '@shared/protocol'
import { CodeEditor, PHONE_EDITOR_QUERY, type EditorSelection } from './CodeEditor'
import { useMediaQuery } from '../lib/mediaQuery'
import { CodeDiff } from './CodeDiff'
import { MakeTokensDialog } from './MakeTokensDialog'
import { MakeUsageDialog } from './MakeUsageDialog'
import { MakeCommentsPanel } from './MakeCommentsPanel'
import { MakeNotesDialog } from './MakeNotesDialog'
import { MakeTaskLinksDialog } from './MakeTaskLinksDialog'
import { MakeProjectSyncDialog } from './MakeProjectSyncDialog'
import { MakeStylePanel, cssRule, type StyleValues } from './MakeStylePanel'
import { MakeControlField, type ArgType } from './MakeControls'
import { captureIframeScreenshot } from '../lib/makeScreenshot'
import { formatCode } from '../lib/formatCode'
import { a11yPrompt, runAxeInFrame, type A11yViolation } from '../lib/makeA11y'
import { pointInRect, usePointerDrag } from '../lib/dnd'
import { dirOfPath, moveTargetPath } from '../lib/makeTree'
import { pushHistory, readHistory, type FileVersion } from '../lib/fileHistory'
import { copyText } from '../lib/clipboard'
import { MAKE_COMMENTS_SYNC_PATH, MAKE_STARTER_GROUPS, MAKE_STARTER_PROMPTS, MAKE_SCAFFOLD, MAKE_TEMPLATES, isMakeTextPath, normalizeMakePath, type MakeCheckIssue, type MakeFileInfo, type MakeProjectState, type MakeSearchMatch, type MakeStoryFile, type MakeConsoleLine, type MakeNetworkEntry, type MakeStoryShot, type MakeLibraryItem, type MakeSnapshotDiff, type MakeImportMode, type MakeComment, type MakePresenceClient, type MakeTestFile } from '@shared/make'

// Правая панель инструмента Make (аналог Figma Make): проект разговора — статический
// сайт в рабочей папке сервера. Три режима: «Превью» (same-origin iframe поверх
// /api/preview/make/<conv>/, пресеты ширины, выбор элемента для правки через чат),
// «Код» (дерево файлов + редактор с сохранением) и «История» (снимки/откат/сброс).
// Ассистент меняет файлы MCP-инструментами; сервер шлёт `make.changed` — панель
// перезагружает превью и, если редактор не грязный, содержимое открытого файла.

export interface MakeSelectedElement {
  selector: string
  tag: string
  text: string
  html: string
  id?: string
  className?: string
  styles?: StyleValues
}

export interface MakePaneProps {
  conversationId: string
  api: Pick<RendererApi, 'make:state' | 'make:read' | 'make:write' | 'make:delete' | 'make:rename' | 'make:snapshot' | 'make:restore' | 'make:reset' | 'make:publish' | 'make:unpublish' | 'make:check' | 'make:template' | 'make:upload' | 'make:search' | 'make:stories' | 'make:snapshotDiff' | 'make:restoreFile' | 'make:import' | 'make:importUrl' | 'make:snapshotFile' | 'make:replace' | 'make:shots' | 'make:shot' | 'make:library' | 'make:libraryExport' | 'make:libraryInsert' | 'make:libraryRemove' | 'make:usage' | 'make:cleanup' | 'make:comments' | 'make:commentAdd' | 'make:commentUpdate' | 'make:commentRemove' | 'make:share' | 'make:unshare' | 'make:shareGrant' | 'make:presence' | 'make:tests' | 'make:notes' | 'make:setNotes' | 'make:taskLinks' | 'make:linkTask' | 'make:linkableTasks' | 'make:projectFiles' | 'make:projectLinks' | 'make:projectPull'>
  make?: RendererMakeBridge
  /** Вставить текст в поле ввода чата (просьба ассистенту про выбранный элемент). */
  onInsertToChat?: (text: string) => void
  /** Отправить сообщение ассистенту сразу (кнопка «Исправить» в баннере ошибок). */
  onAskAssistant?: (text: string) => void
  /** Приложить файл к сообщению чата (скриншот превью). */
  onAttachImage?: (file: File) => void
  /** Открытый файл и выделение — хост подмешивает в следующее сообщение чата (п.21). */
  onEditorContext?: (ctx: EditorContextPayload | null) => void
  /** Расход беседы проекта — суммарная стоимость в шапке (п.24). */
  usage?: ConversationUsage | null
  /** Идёт ход ассистента: на старте снимаем «до», по окончании (после правок) — «после» (roadmap-2 п.8). */
  turnActive?: boolean
  /** Текст последнего запроса пользователя — для самопроверки «Сверить с запросом» (roadmap-4 п.5). */
  lastRequest?: string | null
  /** Режим вопроса (roadmap-4 п.4): следующий ход пойдёт в «План» — только ответ, без правок. */
  askOnly?: boolean
  onAskOnlyChange?: (on: boolean) => void
  /** База превью; по умолчанию — REST.makePreview (тест подменяет). */
  previewBase?: string
  /**
   * Cookie-гейт превью: iframe не умеет слать Bearer, поэтому перед первой загрузкой
   * сервер выпускает preview-cookie (`session:ensurePreview`, как у Web Reader).
   */
  ensurePreview?: () => Promise<boolean>
  /** Открыть карточку связанной задачи на доске (диалог «Задачи проекта»). */
  onOpenTask?: (projectId: string, taskId: string) => void
  /** Задержка автосохранения; тесты уменьшают. */
  autosaveDelayMs?: number
}

type Mode = 'preview' | 'code' | 'stories' | 'history'
const MODE_LABEL: Record<Mode, string> = { preview: 'Превью', code: 'Код', stories: 'Компоненты', history: 'История' }
type Device = 'desktop' | 'tablet' | 'mobile' | 'all'
const DEVICE_WIDTH: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390, all: null }
const DEVICE_LABEL: Record<Device, string> = { desktop: 'Десктоп', tablet: 'Планшет', mobile: 'Телефон', all: 'Три ширины рядом' }
/** Три ширины рядом (roadmap-4 п.21): дополнительные кадры к основному; скролл синхронизируется через vc-make.state → vc-make.restore. */
const SYNC_WIDTHS = [820, 390]

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} КБ` : `${bytes} Б`
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Дерево: файлы группируются по первому каталогу, корневые — первыми. */
function groupFiles(files: MakeFileInfo[]): Array<{ dir: string; files: MakeFileInfo[] }> {
  const groups = new Map<string, MakeFileInfo[]>()
  for (const file of files) {
    const slash = file.path.indexOf('/')
    const dir = slash >= 0 ? file.path.slice(0, slash) : ''
    groups.set(dir, [...(groups.get(dir) ?? []), file])
  }
  return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'ru'))).map(([dir, list]) => ({ dir, files: list }))
}

export function MakePane({ conversationId, api, make, onInsertToChat, onAskAssistant, onAttachImage, onEditorContext, usage, turnActive = false, askOnly = false, onAskOnlyChange, lastRequest = null, previewBase, ensurePreview, onOpenTask, autosaveDelayMs = 1500 }: MakePaneProps): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
  const [mode, setMode] = useState<Mode>('preview')
  const [state, setState] = useState<MakeProjectState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<Device>('desktop')
  const [fullscreen, setFullscreen] = useState(false)
  const [inspect, setInspect] = useState(false)
  const [selected, setSelected] = useState<MakeSelectedElement | null>(null)
  // Последнее известное состояние страницы превью (скролл/hash) — восстанавливается после перезагрузки (п.11).
  const pageStateRef = useRef<{ x: number; y: number; hash: string } | null>(null)
  const syncFramesRef = useRef<Array<HTMLIFrameElement | null>>([])
  const syncMuteUntil = useRef(0)
  // Тема/язык превью (п.12): пересылаются в iframe и повторяются после каждой перезагрузки.
  const [previewScheme, setPreviewScheme] = useState<'auto' | 'light' | 'dark'>('auto')
  const [previewLang, setPreviewLang] = useState('')
  const envRef = useRef<{ scheme: 'auto' | 'light' | 'dark'; lang: string; state: 'hover' | 'focus' | 'active' | null; reducedMotion: boolean; slowMs: number }>({ scheme: 'auto', lang: '', state: null, reducedMotion: false, slowMs: 0 })
  /** Эмуляция окружения превью (roadmap-4 п.20): принудительное состояние выбранного элемента, reduced-motion, задержка моков. */
  const [forcedState, setForcedState] = useState<'hover' | 'focus' | 'active' | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [slowMs, setSlowMs] = useState(0)
  envRef.current = { scheme: previewScheme, lang: previewLang, state: forcedState, reducedMotion, slowMs }
  const sendEnv = (scheme = previewScheme, lang = previewLang, extra: { state?: 'hover' | 'focus' | 'active' | null; reducedMotion?: boolean; slowMs?: number } = {}): void => { frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.env', scheme, lang, state: forcedState, reducedMotion, slowMs, ...extra }, '*') }
  const cycleForcedState = (): void => { const order: Array<'hover' | 'focus' | 'active' | null> = [null, 'hover', 'focus', 'active']; const next = order[(order.indexOf(forcedState) + 1) % order.length] ?? null; setForcedState(next); sendEnv(previewScheme, previewLang, { state: next }) }
  const toggleReducedMotion = (): void => { const next = !reducedMotion; setReducedMotion(next); sendEnv(previewScheme, previewLang, { reducedMotion: next }) }
  const cycleSlowMs = (): void => { const next = slowMs === 0 ? 1500 : slowMs === 1500 ? 4000 : 0; setSlowMs(next); sendEnv(previewScheme, previewLang, { slowMs: next }) }
  const cycleScheme = (): void => { const next = previewScheme === 'auto' ? 'dark' : previewScheme === 'dark' ? 'light' : 'auto'; setPreviewScheme(next); sendEnv(next, previewLang) }
  // Опрос same-origin iframe: события scroll из родителя ненадёжны, а прямое чтение — всегда работает.
  useEffect(() => {
    const timer = setInterval(() => {
      const w = frameRef.current?.contentWindow
      try { if (w && w.document?.readyState === 'complete') pageStateRef.current = { x: w.scrollX, y: w.scrollY, hash: w.location.hash } } catch { /* чужой origin — не наш случай */ }
    }, 500)
    return () => clearInterval(timer)
  }, [])
  const restorePageState = (): void => {
    const w = frameRef.current?.contentWindow
    const s = pageStateRef.current
    if (!w || !s) return
    const apply = (): void => { try { if (s.hash && w.location.hash !== s.hash) w.location.hash = s.hash; w.scrollTo(s.x, s.y) } catch { /* ignore */ } }
    apply(); setTimeout(apply, 250); setTimeout(apply, 800)
  }
  const [styleOpen, setStyleOpen] = useState(false)
  const previewStyles = (values: StyleValues): void => { frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.style', values }, '*') }
  /** Дописать правило в главную таблицу стилей проекта (первый <link rel=stylesheet> из index.html, иначе styles.css). */
  const writeStyles = async (rule: string, values: StyleValues): Promise<void> => {
    try {
      let target = 'styles.css'
      try {
        const index = await api['make:read']({ conversationId, path: 'index.html' })
        const m = index.content.match(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"'#?]+)["']/i) ?? index.content.match(/<link[^>]*href=["']([^"'#?]+\.css)["'][^>]*rel=["']stylesheet["']/i)
        if (m?.[1] && !/^https?:/i.test(m[1])) target = m[1].replace(/^\.\//, '')
      } catch { /* нет index.html — пишем в styles.css */ }
      let css = ''
      try { css = (await api['make:read']({ conversationId, path: target })).content } catch { css = '' }
      const block = `\n/* Правка из панели стилей Make */\n${cssRule(rule, values)}`
      const next = await api['make:write']({ conversationId, path: target, content: css.replace(/\s*$/, '\n') + block })
      setState(next); setPreviewRev(next.rev)
      toast.success(`Правило ${rule} записано в ${target}`)
    } catch (e) { toast.error(describeError(e)) }
  }
  const [previewRev, setPreviewRev] = useState(0)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  // Вкладки открытых файлов (как в VS Code) и автосохранение с паузой — правки не теряются при переключении.
  const [tabs, setTabs] = useState<string[]>([])
  // Содержимое всех текстовых файлов — для моделей Monaco (резолв импортов). Перечитываем по rev.
  const [projectFiles, setProjectFiles] = useState<Array<{ path: string; content: string }>>([])
  useEffect(() => {
    if (mode !== 'code' || !state) return
    let cancelled = false
    const texts = state.files.filter((f) => isMakeTextPath(f.path) && f.size <= 512 * 1024)
    void Promise.all(texts.map((f) => api['make:read']({ conversationId, path: f.path }).then((r) => ({ path: f.path, content: r.content })).catch(() => null)))
      .then((list) => { if (!cancelled) setProjectFiles(list.filter((x): x is { path: string; content: string } => x !== null)) })
    return () => { cancelled = true }
  }, [mode, state?.rev, conversationId, api, state])
  const [autosave, setAutosave] = useState<boolean>(() => { try { return localStorage.getItem(MAKE_AUTOSAVE_KEY) !== 'off' } catch { return true } })
  const [formatOnSave, setFormatOnSave] = useState<boolean>(() => { try { return localStorage.getItem(MAKE_FORMAT_ON_SAVE_KEY) === 'on' } catch { return false } })
  const toggleFormatOnSave = (): void => { setFormatOnSave((v) => { const next = !v; try { localStorage.setItem(MAKE_FORMAT_ON_SAVE_KEY, next ? 'on' : 'off') } catch { /* приватный режим */ } return next }) }
  const toggleAutosave = (): void => { setAutosave((v) => { const next = !v; try { localStorage.setItem(MAKE_AUTOSAVE_KEY, next ? 'on' : 'off') } catch { /* приватный режим */ } return next }) }
  const [saving, setSaving] = useState(false)
  /** Превью готово к загрузке: cookie выпущена (или гейта нет). */
  const [previewReady, setPreviewReady] = useState(!ensurePreview)
  /** Диалог ввода имени (новый файл / переименование / подпись снимка) — вместо window.prompt. */
  const [ask, setAsk] = useState<{ title: string; label: string; initial: string; submit: string; onSubmit: (value: string) => void } | null>(null)
  const [askValue, setAskValue] = useState('')
  const [publishOpen, setPublishOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [issues, setIssues] = useState<MakeCheckIssue[] | null>(null)
  // Поиск: фильтр дерева по пути — мгновенно; по содержимому — запросом на Enter.
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<MakeSearchMatch[] | null>(null)
  const [searching, setSearching] = useState(false)
  // Сториз: список файлов *.stories.* и выбранная стори; раннер — отдельная страница превью.
  const [storyFiles, setStoryFiles] = useState<MakeStoryFile[] | null>(null)
  const [story, setStory] = useState<{ file: string; name: string } | null>(null)
  // Controls: args, которые раннер разрешил для стори, и переопределения из панели (в файл не пишутся).
  const [storyArgs, setStoryArgs] = useState<Record<string, unknown> | null>(null)
  const [argOverrides, setArgOverrides] = useState<Record<string, unknown>>({})
  const [argOptions, setArgOptions] = useState<Record<string, string[]>>({})
  const [argTypes, setArgTypes] = useState<Record<string, ArgType>>({})
  // Результаты play-функций (п.18): ключ file::story → passed/failed + ошибка.
  const [playResults, setPlayResults] = useState<Record<string, { status: 'passed' | 'failed'; ms: number; error?: string }>>({})
  const [ideasOpen, setIdeasOpen] = useState(false)
  // Консоль превью: строки из iframe (console.* и ошибки), сбрасываются при перезагрузке превью.
  const [consoleLines, setConsoleLines] = useState<MakeConsoleLine[]>([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [network, setNetwork] = useState<MakeNetworkEntry[]>([])
  const [bottomTab, setBottomTab] = useState<'console' | 'network'>('console')
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [tokensOpen, setTokensOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [taskLinksOpen, setTaskLinksOpen] = useState(false)
  /** Обмен с репозиторием проекта: компоненты и стили туда-обратно. */
  const [projectSyncOpen, setProjectSyncOpen] = useState(false)
  /** Строки открытого файла, изменённые последней записью ассистента (roadmap-4 п.9). */
  const [changedLines, setChangedLines] = useState<number[]>([])
  /** Таблица коллекции моков (roadmap-4 п.29): для mock/*.json с массивом объектов — вид «Таблица» по умолчанию. */
  const [mockView, setMockView] = useState<'table' | 'json'>('table')
  const mockTable = useMemo(() => (selectedPath ? mockTableFor(selectedPath, content) : null), [selectedPath, content])
  /** Сплит «код | превью» и zen-режим (roadmap-4 п.16): доля редактора хранится между сессиями. */
  const [split, setSplit] = useState<boolean>(() => { try { return localStorage.getItem(MAKE_SPLIT_KEY) === 'on' } catch { return false } })
  const [splitPct, setSplitPct] = useState<number>(() => { try { const v = Number(localStorage.getItem(MAKE_SPLIT_PCT_KEY)); return v >= 25 && v <= 80 ? v : 55 } catch { return 55 } })
  const [zen, setZen] = useState(false)
  const toggleSplit = (): void => setSplit((v) => { const next = !v; try { localStorage.setItem(MAKE_SPLIT_KEY, next ? 'on' : 'off') } catch { /* приватный режим */ } return next })
  const splitDrag = usePointerDrag()
  const codeRef = useRef<HTMLDivElement | null>(null)
  const beginSplitDrag = (e: React.PointerEvent<HTMLElement>): void => {
    const box = codeRef.current?.getBoundingClientRect()
    if (!box) return
    const tree = codeRef.current?.querySelector<HTMLElement>('.make-tree')?.getBoundingClientRect().width ?? 0
    let last = splitPct
    splitDrag.begin(e, {
      lift: null,
      immediate: true,
      onStart: () => undefined,
      onMove: (pt) => {
        const usable = box.width - tree
        last = Math.min(80, Math.max(25, Math.round(((pt.x - box.left - tree) / Math.max(1, usable)) * 100)))
        setSplitPct(last)
      },
      onDrop: () => { try { localStorage.setItem(MAKE_SPLIT_PCT_KEY, String(last)) } catch { /* приватный режим */ } },
      onCancel: () => undefined
    })
  }
  useEffect(() => {
    if (!zen) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setZen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [zen])
  /** Мультивыбор файлов в дереве (roadmap-4 п.10): Ctrl/Cmd-клик — переключить, Shift-клик — диапазон. */
  const [picked, setPicked] = useState<MakeSelectionState>(EMPTY_MAKE_SELECTION)
  /** Содержимое открытого файла на старте хода — база для diff: за ход ассистент может записать файл несколько раз. */
  const turnBaseRef = useRef<{ path: string | null; content: string }>({ path: null, content: '' })
  // Чипы «следующий шаг» (roadmap-4 п.8): показываем после завершения хода ассистента, пока пользователь не отправил следующий.
  const [nextStepsOpen, setNextStepsOpen] = useState(false)
  const prevTurnRef = useRef(false)
  useEffect(() => { if (prevTurnRef.current && !turnActive) setNextStepsOpen(true); if (turnActive) setNextStepsOpen(false); prevTurnRef.current = turnActive }, [turnActive])
  // Тесты компонентов (roadmap-4 п.3): *.test.tsx выполняются в скрытом iframe-раннере __tests__,
  // результаты приходят кадрами vc-make.test / vc-make.tests-done.
  const [testFiles, setTestFiles] = useState<MakeTestFile[]>([])
  const [runningTests, setRunningTests] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, Array<{ name: string; status: 'passed' | 'failed' | 'pending'; ms: number; error?: string }>>>({})
  const [testsOpen, setTestsOpen] = useState(false)
  const testQueueRef = useRef<string[]>([])
  const loadTests = useCallback(async (): Promise<void> => {
    try { setTestFiles((await api['make:tests']({ conversationId })).files) } catch { setTestFiles([]) }
  }, [api, conversationId])
  const runTests = (paths: string[]): void => {
    if (paths.length === 0) return
    setTestsOpen(true)
    setTestResults((prev) => { const next = { ...prev }; for (const p of paths) delete next[p]; return next })
    testQueueRef.current = paths.slice(1)
    setRunningTests(paths[0]!)
  }
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const d = e.data as { type?: string; file?: string; name?: string; status?: 'passed' | 'failed'; ms?: number; error?: string } | null
      if (!d || typeof d !== 'object' || !runningTests) return
      if (d.type === 'vc-make.test' && d.name && d.status) {
        setTestResults((prev) => ({ ...prev, [runningTests]: [...(prev[runningTests] ?? []), { name: d.name!, status: d.status!, ms: d.ms ?? 0, error: d.error }] }))
      } else if (d.type === 'vc-make.tests-done') {
        if (d.error) setTestResults((prev) => ({ ...prev, [runningTests]: [...(prev[runningTests] ?? []), { name: 'загрузка файла', status: 'failed', ms: 0, error: d.error }] }))
        const next = testQueueRef.current.shift() ?? null
        setRunningTests(next)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [runningTests])
  const failedTests = Object.entries(testResults).flatMap(([file, list]) => list.filter((r) => r.status === 'failed').map((r) => ({ file, ...r })))
  const testsPrompt = (): string => `Упали тесты компонентов:\n${failedTests.map((f) => `- ${f.file} › ${f.name}: ${f.error ?? ''}`).join('\n')}\nПрочитай тест и компонент (make_read_file), найди причину — в компоненте или в тесте — и исправь. `

  /** Файл, только что записанный ассистентом — вкладка коротко подсвечивается (roadmap-2 п.10). */
  const [flashPath, setFlashPath] = useState<string | null>(null)
  // Визуальный diff хода (roadmap-2 п.8): «до» снимаем при старте хода, «после» — когда ход кончился и
  // превью перезагрузилось после правок. Только если файлы менялись; хранится в памяти вкладки.
  const [turnDiff, setTurnDiff] = useState<{ before: string; after: string } | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const turnShotRef = useRef<{ before: string | null; changed: boolean; active: boolean }>({ before: null, changed: false, active: false })
  const snapPreview = async (): Promise<string | null> => {
    const doc = frameRef.current?.contentDocument
    if (!doc || typeof URL.createObjectURL !== 'function') return null
    try { return URL.createObjectURL(await captureIframeScreenshot({ doc, width: frameRef.current?.clientWidth }, 'turn.png')) } catch { return null }
  }
  useEffect(() => {
    const st = turnShotRef.current
    if (turnActive && !st.active) {
      st.active = true; st.changed = false; st.before = null
      turnBaseRef.current = { path: selectedPath, content: savedContent }
      void snapPreview().then((url) => { st.before = url })
    } else if (!turnActive && st.active) {
      st.active = false
      if (!st.changed || !st.before) return
      const before = st.before
      // Даём превью перезагрузиться по make.changed (key={previewRev}) и отрисоваться.
      const t = window.setTimeout(() => { void snapPreview().then((after) => { if (after) { setTurnDiff((prev) => { if (prev) { URL.revokeObjectURL(prev.before); URL.revokeObjectURL(prev.after) } return { before, after } }) } }) }, 1200)
      return () => window.clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnActive])
  const dismissDiff = (): void => { setTurnDiff((prev) => { if (prev) { URL.revokeObjectURL(prev.before); URL.revokeObjectURL(prev.after) } return null }); setDiffOpen(false) }
  // Самопроверка (roadmap-4 п.5): скриншот «после» + исходный запрос уходят ассистенту — он сверяет результат с заданием.
  const verifyResult = async (): Promise<void> => {
    if (!turnDiff || !onAttachImage) return
    const blob = await (await fetch(turnDiff.after)).blob()
    onAttachImage(new File([blob], 'after.png', { type: 'image/png' }))
    const ask = onAskAssistant ?? onInsertToChat
    ask?.(`Самопроверка: на скриншоте — превью после твоих правок. Исходный запрос: «${(lastRequest ?? '').slice(0, 300)}». Сверь результат с запросом: что сделано, что нет или сделано иначе; если что-то не так — исправь файлы и кратко перечисли правки. `)
  }
  const diffToChat = async (): Promise<void> => {
    if (!turnDiff || !onAttachImage) return
    for (const [key, name] of [['before', 'before.png'], ['after', 'after.png']] as const) {
      const blob = await (await fetch(turnDiff[key])).blob()
      onAttachImage(new File([blob], name, { type: 'image/png' }))
    }
    onInsertToChat?.('На скриншотах — превью до и после последней правки: ')
    toast.success('Оба скриншота добавлены во вложения')
  }
  // PWA в экспорте (п.35): манифест + service worker + иконка, ссылки инъектируются в копию index.html.
  const [exportPwa, setExportPwa] = useState(false)
  /** Хостинг для экспорта (roadmap-4 п.36): netlify.toml / vercel.json добавляются в архив. */
  const [exportDeploy, setExportDeploy] = useState<MakeDeployTarget | ''>('')
  const exportUrl = (vite: boolean): string => `${REST.makeExport(conversationId)}?${vite ? 'vite=1&' : ''}${exportPwa ? 'pwa=1&' : ''}${exportDeploy ? `deploy=${exportDeploy}` : ''}`.replace(/[?&]$/, '')
  // Телефон (п.34): дерево файлов заменяет выпадающий список, редактор — лёгкий (см. CodeEditor).
  const isPhone = useMediaQuery(PHONE_EDITOR_QUERY)
  // Комментарии к элементам (п.32): список грузим один раз при открытии панели, метки шлём в превью на каждый ready.
  const [comments, setComments] = useState<MakeComment[] | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const commentsRef = useRef<MakeComment[]>([])
  const sendPins = (list: MakeComment[] = commentsRef.current): void => {
    const open = list.filter((c) => !c.resolved)
    frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.pins', items: list.map((c) => ({ selector: c.selector, n: open.indexOf(c) + 1, text: c.text, resolved: c.resolved })) }, '*')
  }
  const applyComments = (list: MakeComment[]): void => {
    // Уведомление владельцу (roadmap-4 п.35): новые комментарии зрителей приходят по make.changed — показываем тост.
    const prevPending = new Set((commentsRef.current ?? []).filter((c) => c.status === 'pending').map((c) => c.id))
    const fresh = commentsRef.current ? list.filter((c) => c.status === 'pending' && !prevPending.has(c.id)) : []
    if (fresh.length) toast.info(fresh.length === 1 ? `Новый комментарий зрителя${fresh[0]!.guestName ? ` (${fresh[0]!.guestName})` : ''}: «${fresh[0]!.text.slice(0, 80)}» — на модерации` : `Новых комментариев зрителей: ${fresh.length} — на модерации`)
    commentsRef.current = list; setComments(list); sendPins(list)
  }
  useEffect(() => {
    let alive = true
    api['make:comments']({ conversationId }).then((r) => { if (alive) applyComments(r.comments) }).catch(() => { if (alive) applyComments([]) })
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])
  const commentAction = async (run: () => Promise<{ comments: MakeComment[] }>): Promise<void> => {
    try { applyComments((await run()).comments) } catch (e) { toast.error(describeError(e)) }
  }
  /** Текст, отредактированный в превью (п.17): ищем старый текст как уникальную подстроку одного файла и записываем новый. */
  const applyPreviewTextEdit = async (before: string, after: string): Promise<void> => {
    try {
      const found = (await api['make:search']({ conversationId, query: before.trim().split(/\s+/)[0] ?? before })).matches
      const candidates = Array.from(new Set(found.map((m) => m.path))).filter(isMakeTextPath)
      const hits: Array<{ path: string; next: string }> = []
      for (const path of candidates) {
        const { content } = await api['make:read']({ conversationId, path })
        const next = replaceUniqueText(content, before, escapeMarkupText(after))
        if (next) hits.push({ path, next })
      }
      if (hits.length !== 1) { toast.error(hits.length === 0 ? 'Не нашёл этот текст в исходнике ровно один раз — правка в превью не записана' : `Текст встречается в нескольких файлах (${hits.map((h) => h.path).join(', ')}) — поправьте в коде`); setPreviewRev((r) => r + 1); return }
      const hit = hits[0]!
      const next = await api['make:write']({ conversationId, path: hit.path, content: hit.next })
      setState(next)
      if (selectedPath === hit.path) { setContent(hit.next); setSavedContent(hit.next) }
      toast.success(`Текст записан в ${hit.path}`)
    } catch (e) { toast.error(describeError(e)) }
  }
  /** Перестановка секции из превью (п.18): оба фрагмента должны найтись в одном файле ровно по разу. */
  const applyPreviewReorder = async (moved: string, target: string, position: 'before' | 'after'): Promise<void> => {
    try {
      // Обработчик живёт в замыкании эффекта — состояние берём свежее, а не из пропсов рендера.
      const files = (await api['make:state']({ conversationId })).files.map((f) => f.path).filter((p) => /\.(html?|tsx|jsx)$/i.test(p))
      const hits: Array<{ path: string; next: string }> = []
      for (const path of files) {
        const { content } = await api['make:read']({ conversationId, path })
        const next = reorderMarkup(content, moved, target, position)
        if (next) hits.push({ path, next })
      }
      if (hits.length !== 1) { toast.error('Не удалось однозначно найти эти блоки в исходнике — порядок в файле не изменён'); setPreviewRev((r) => r + 1); return }
      const hit = hits[0]!
      const next = await api['make:write']({ conversationId, path: hit.path, content: hit.next })
      setState(next)
      if (selectedPath === hit.path) { setContent(hit.next); setSavedContent(hit.next) }
      toast.success(`Порядок записан в ${hit.path}`)
    } catch (e) { toast.error(describeError(e)) }
  }
  const highlightInPreview = (selector: string): void => { setMode('preview'); frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.highlight', selector }, '*') }
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importMode, setImportMode] = useState<MakeImportMode>('replace')
  const [importing, setImporting] = useState(false)
  const importZipRef = useRef<HTMLInputElement>(null)
  const [diffs, setDiffs] = useState<Record<string, MakeSnapshotDiff | 'loading'>>({})
  // Diff-вью одного файла: снимок ↔ текущее.
  const [fileDiff, setFileDiff] = useState<{ snapshotId: string; label: string; path: string; original: string; modified: string } | null>(null)
  const openFileDiff = async (snapshotId: string, label: string, path: string): Promise<void> => {
    try {
      const [orig, cur] = await Promise.all([
        api['make:snapshotFile']({ conversationId, snapshotId, path }).then((f) => f.content).catch(() => ''),
        api['make:read']({ conversationId, path }).then((f) => f.content).catch(() => '')
      ])
      setFileDiff({ snapshotId, label, path, original: orig, modified: cur })
    } catch (e) { toast.error(describeError(e)) }
  }
  const storyFrameRef = useRef<HTMLIFrameElement | null>(null)
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const d = e.data as { type?: string; args?: Record<string, unknown>; options?: Record<string, string[]>; argTypes?: Record<string, ArgType> } | null
      if (d?.type === 'vc-make.story' && e.source === storyFrameRef.current?.contentWindow) { setStoryArgs(d.args ?? {}); setArgOptions(d.options ?? {}); setArgTypes(d.argTypes ?? {}); setArgOverrides({}) }
      if (d?.type === 'vc-make.play' && e.source === storyFrameRef.current?.contentWindow) {
        const r = d as unknown as { file: string; story: string; status: 'passed' | 'failed'; ms: number; error?: string }
        setPlayResults((prev) => ({ ...prev, [`${r.file}::${r.story}`]: { status: r.status, ms: r.ms, error: r.error } }))
      }
      if (d?.type === 'vc-make.network' && e.source === frameRef.current?.contentWindow) {
        const n = d as unknown as MakeNetworkEntry
        setNetwork((prev) => [...prev.slice(-199), n])
      }
      if (d?.type === 'vc-make.console' && (e.source === frameRef.current?.contentWindow || e.source === storyFrameRef.current?.contentWindow)) {
        const line = d as unknown as MakeConsoleLine
        setConsoleLines((prev) => [...prev.slice(-199), { level: line.level, text: line.text, at: line.at }])
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  const setArg = (key: string, value: unknown): void => {
    const next = { ...argOverrides, [key]: value }
    setArgOverrides(next)
    storyFrameRef.current?.contentWindow?.postMessage({ type: 'vc-make.args', args: next }, '*')
  }
  const resetArgs = (): void => {
    setArgOverrides({})
    storyFrameRef.current?.contentWindow?.postMessage({ type: 'vc-make.args', args: {} }, '*')
  }
  const sendArgsToChat = (): void => {
    if (!story || !onInsertToChat || Object.keys(argOverrides).length === 0) return
    onInsertToChat(`В стори «${story.name}» (${story.file}) сделай args по умолчанию такими: ${JSON.stringify(argOverrides)}. `)
  }
  const [checking, setChecking] = useState(false)
  const openAsk = (title: string, label: string, initial: string, submit: string, onSubmit: (value: string) => void): void => { setAskValue(initial); setAsk({ title, label, initial, submit, onSubmit }) }
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  // Перетаскивание файлов с рабочего стола в дерево — та же загрузка, что и кнопкой.
  const [dropActive, setDropActive] = useState(false)
  const onDragOver = (e: DragEvent): void => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
    if (!dropActive) setDropActive(true)
  }
  const onDrop = (e: DragEvent): void => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault(); setDropActive(false)
    void uploadFiles(e.dataTransfer.files)
  }
  const dirty = content !== savedContent
  // Presence (roadmap-2 п.14): heartbeat раз в 15 с и при смене файла/грязности; список приходит WS-кадром
  // make.presence (или ответом heartbeat). Другая вкладка с несохранёнными правками того же файла — мягкая
  // блокировка: редактор read-only, чтобы две вкладки не затирали друг друга автосохранением.
  const clientIdRef = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  const [presence, setPresence] = useState<MakePresenceClient[]>([])
  const others = presence.filter((c) => c.clientId !== clientIdRef.current)
  const lockedBy = selectedPath ? others.find((c) => c.editing && c.path === selectedPath) ?? null : null
  useEffect(() => {
    if (!api['make:presence']) return
    let alive = true
    const beat = (): void => { void api['make:presence']({ conversationId, clientId: clientIdRef.current, path: mode === 'code' ? selectedPath : null, editing: mode === 'code' && dirty }).then((r) => { if (alive) setPresence(r.clients) }).catch(() => undefined) }
    beat()
    const t = window.setInterval(beat, 15_000)
    return () => { alive = false; window.clearInterval(t) }
  }, [api, conversationId, mode, selectedPath, dirty])
  useEffect(() => () => { void api['make:presence']?.({ conversationId, clientId: clientIdRef.current, path: null, editing: false, leave: true }).catch(() => undefined) }, [api, conversationId])
  useEffect(() => make?.onPresence?.((m) => { if (m.conversationId === conversationId) setPresence(m.clients) }), [make, conversationId])
  const base = previewBase ?? REST.makePreview(conversationId)

  const describeError = (e: unknown): string => (e instanceof Error ? e.message : String(e))

  const refresh = useCallback(async (): Promise<MakeProjectState | null> => {
    try {
      const next = await api['make:state']({ conversationId })
      setState(next)
      setError(null)
      return next
    } catch (e) {
      setError(describeError(e))
      return null
    }
  }, [api, conversationId])

  const openFile = useCallback(async (path: string): Promise<void> => {
    // Бинарник (картинка, шрифт) редактировать нельзя — показываем его просмотр вместо текста.
    setTabs((list) => (list.includes(path) ? list : [...list, path]))
    setChangedLines([])
    if (!isMakeTextPath(path)) { setSelectedPath(path); setContent(''); setSavedContent(''); return }
    try {
      const file = await api['make:read']({ conversationId, path })
      setSelectedPath(path)
      setContent(file.content)
      setSavedContent(file.content)
    } catch (e) {
      toast.error(describeError(e))
    }
  }, [api, conversationId, toast, loadTests])

  // Cookie-гейт превью — один раз на монтирование панели.
  useEffect(() => {
    if (!ensurePreview) return
    let cancelled = false
    void ensurePreview().then((ok) => { if (!cancelled) { setPreviewReady(true); if (!ok) setError('Не удалось подготовить превью: нет cookie сессии') } })
    return () => { cancelled = true }
  }, [ensurePreview])

  // Первая загрузка: состояние проекта и index.html в редакторе.
  useEffect(() => {
    let cancelled = false
    void refresh().then((next) => {
      if (cancelled || !next) return
      const entry = next.files.find((f) => f.path === 'index.html') ?? next.files.find((f) => isMakeTextPath(f.path))
      if (entry) void openFile(entry.path)
    })
    return () => { cancelled = true }
  }, [refresh, openFile])

  // Изменения от ассистента/другой вкладки: перезагрузить превью и дерево;
  // открытый файл обновляем только если пользователь его не правил.
  useEffect(() => {
    if (!make) return
    return make.onChanged((m) => {
      if (m.conversationId !== conversationId) return
      // Комментарии из другой вкладки/окна (roadmap-2 п.7): файлы не менялись — только перечитать список.
      if (m.paths.includes(MAKE_COMMENTS_SYNC_PATH)) { void api['make:comments']({ conversationId }).then((r) => applyComments(r.comments)).catch(() => undefined); return }
      if (turnShotRef.current.active) turnShotRef.current.changed = true
      setPreviewRev(m.rev)
      void refresh()
      if (selectedPath && m.paths.includes(selectedPath) && !dirty) {
        // Inline-diff (roadmap-4 п.9): сравниваем прежнее содержимое с тем, что записал ассистент.
        const base = turnBaseRef.current
        const before = base.path === selectedPath ? base.content : savedContent
        void api['make:read']({ conversationId, path: selectedPath }).then((file) => {
          setContent(file.content); setSavedContent(file.content)
          setChangedLines(turnShotRef.current.active ? diffLines(before, file.content) : [])
        }).catch(() => void openFile(selectedPath))
      }
      // Правки ассистента «на глазах» (roadmap-2 п.10): в режиме «Код» без несохранённых правок открываем
      // файл, который он только что записал, и подсвечиваем вкладку. MCP пишет файл целиком, поэтому
      // побайтовый стриминг невозможен — показываем результат каждой записи сразу.
      const written = m.paths.find((p) => isMakeTextPath(p) && !p.startsWith('.'))
      if (turnShotRef.current.active && written && !dirty && mode === 'code' && written !== selectedPath) {
        void openFile(written)
        setFlashPath(written)
        window.setTimeout(() => setFlashPath((cur) => (cur === written ? null : cur)), 1800)
      }
    })
  }, [make, conversationId, refresh, openFile, selectedPath, dirty, mode, savedContent, api])

  // Сообщения из превью: выбранный элемент (режим «Выбрать элемент»).
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const fromSync = syncFramesRef.current.some((f) => f?.contentWindow === event.source)
      if (event.source !== frameRef.current?.contentWindow && !fromSync) return
      const data = event.data as { type?: string; before?: string; after?: string; moved?: string; target?: string; position?: string; selector?: string; tag?: string; text?: string; html?: string; id?: string; className?: string; styles?: StyleValues } | null
      if (!data || typeof data !== 'object') return
      // Три ширины рядом (п.21): скролл любого кадра повторяют остальные; эхо гасим окном в 300 мс.
      if (data.type === 'vc-make.state' && typeof (data as { y?: unknown }).y === 'number') {
        const all = [frameRef.current?.contentWindow, ...syncFramesRef.current.map((f) => f?.contentWindow)].filter(Boolean) as Window[]
        const from = all.find((w) => w === event.source)
        if (from && all.length > 1 && Date.now() > syncMuteUntil.current) {
          syncMuteUntil.current = Date.now() + 300
          for (const w of all) if (w !== from) w.postMessage({ type: 'vc-make.restore', x: 0, y: (data as { y: number }).y }, '*')
        }
      }
      // Дополнительные кадры дают только скролл; выбор элемента, текст и прочее — от основного.
      if (fromSync) { if (data.type === 'vc-make.ready' && event.source) (event.source as Window).postMessage({ type: 'vc-make.env', ...envRef.current, state: null }, '*'); return }
      if (data.type === 'vc-make.state' && event.source === frameRef.current?.contentWindow) {
        const s = data as unknown as { x: number; y: number; hash: string }
        pageStateRef.current = { x: s.x, y: s.y, hash: s.hash }
      }
      if (data.type === 'vc-make.ready') {
        frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.inspect', enabled: inspect }, '*')
        if (commentsRef.current.length) sendPins()
        // Превью перезагрузилось (правка ассистента/своя) — вернуть скролл и якорь, чтобы не прыгать наверх.
        if (pageStateRef.current) frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.restore', ...pageStateRef.current }, '*')
        if (envRef.current.scheme !== 'auto' || envRef.current.lang || envRef.current.reducedMotion || envRef.current.slowMs) frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.env', ...envRef.current, state: null }, '*')
      } else if (data.type === 'vc-make.selected' && data.selector) {
        setSelected({ selector: data.selector, tag: data.tag ?? '', text: data.text ?? '', html: data.html ?? '', id: data.id, className: data.className, styles: data.styles })
        setStyleOpen(false)
      } else if (data.type === 'vc-make.text' && typeof data.before === 'string' && typeof data.after === 'string' && event.source === frameRef.current?.contentWindow) {
        void applyPreviewTextEdit(data.before, data.after)
      } else if (data.type === 'vc-make.reorder' && typeof data.moved === 'string' && typeof data.target === 'string' && event.source === frameRef.current?.contentWindow) {
        void applyPreviewReorder(data.moved, data.target, data.position === 'before' ? 'before' : 'after')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [inspect])

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.inspect', enabled: inspect }, '*')
  }, [inspect, previewRev])

  const [formatting, setFormatting] = useState(false)
  // Inline-команда (п.6, Cmd/Ctrl+I — ⌘K занят палитрой команд): выделенный фрагмент + инструкция → ассистенту,
  // правку он делает через make_write_file.
  const [selection, setSelection] = useState<EditorSelection | null>(null)
  const [inlineOpen, setInlineOpen] = useState(false)
  // Контекст редактора для чата: файл + выделение; при закрытии панели — сброс.
  useEffect(() => {
    if (!onEditorContext) return
    if (!selectedPath) { onEditorContext(null); return }
    onEditorContext(selection
      ? { path: selectedPath, startLine: selection.startLine, endLine: selection.endLine, snippet: selection.text.slice(0, 2000) }
      : { path: selectedPath })
  }, [selectedPath, selection, onEditorContext])
  useEffect(() => () => onEditorContext?.(null), [onEditorContext])
  // Локальная история правок текущего файла (п.7).
  const [historyOpen, setHistoryOpen] = useState(false)
  const localVersions: FileVersion[] = useMemo(() => (selectedPath && historyOpen ? readHistory(conversationId, selectedPath) : []), [conversationId, selectedPath, historyOpen, savedContent])
  const restoreLocal = (v: FileVersion): void => { setContent(v.content); setHistoryOpen(false); toast.info('Версия подставлена в редактор — сохраните, чтобы применить') }
  const [inlineText, setInlineText] = useState('')
  const inlineInputRef = useRef<HTMLInputElement>(null)
  const openInline = (): void => { if (!selectedPath || !onAskAssistant) return; setInlineOpen(true); setTimeout(() => inlineInputRef.current?.focus(), 0) }
  const sendInline = (): void => {
    if (!selectedPath || !onAskAssistant || !inlineText.trim()) return
    const where = selection ? `строки ${selection.startLine}–${selection.endLine}` : 'весь файл'
    const fragment = selection ? `\n\`\`\`\n${selection.text.slice(0, 4000)}\n\`\`\`\n` : '\n'
    onAskAssistant(`Файл ${selectedPath}, ${where}:${fragment}Задача: ${inlineText.trim()}. Измени только этот фрагмент (перечитай файл make_read_file и запиши целиком make_write_file), остальное не трогай. `)
    setInlineOpen(false); setInlineText('')
  }
  /** Prettier по кнопке/при сохранении: синтаксическая ошибка — тост, текст не трогаем. */
  const formatCurrent = useCallback(async (source: string, path: string, quiet = false): Promise<string> => {
    try {
      const formatted = await formatCode(path, source)
      if (formatted === null) { if (!quiet) toast.info('Для этого типа файла форматирование недоступно'); return source }
      return formatted
    } catch (e) { if (!quiet) toast.error(`Форматирование: ${describeError(e).split('\n')[0]}`); return source }
  }, [toast])
  const formatNow = async (): Promise<void> => {
    if (!selectedPath) return
    setFormatting(true)
    try { const next = await formatCurrent(content, selectedPath); if (next !== content) setContent(next) } finally { setFormatting(false) }
  }
  const save = useCallback(async (silent = false): Promise<void> => {
    if (!selectedPath || !dirty || saving) return
    setSaving(true)
    try {
      // «Формат при сохранении» — вручной Cmd+S/кнопка; автосохранение (silent) не переформатирует под руками.
      const body = formatOnSave && !silent ? await formatCurrent(content, selectedPath, true) : content
      if (body !== content) setContent(body)
      // Локальная история правок: запоминаем то, что было до перезаписи (к нему и хочется вернуться).
      if (savedContent) pushHistory(conversationId, selectedPath, savedContent)
      const next = await api['make:write']({ conversationId, path: selectedPath, content: body })
      setSavedContent(body)
      setState(next)
      setPreviewRev(next.rev)
      if (!silent) toast.success('Сохранено')
      // Ошибки компиляции jsx/tsx — маркерами в редакторе; баннер не трогаем, если всё чисто.
      if (/\.(jsx|tsx|ts)$/i.test(selectedPath)) {
        const { issues: found } = await api['make:check']({ conversationId })
        setIssues((prev) => (found.length > 0 ? found : prev === null ? null : found))
      }
    } catch (e) {
      toast.error(describeError(e))
    } finally {
      setSaving(false)
    }
  }, [api, conversationId, selectedPath, content, dirty, saving, toast, formatOnSave, formatCurrent, savedContent])
  // Автосохранение: пауза после последней правки.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (!autosave || !dirty || !selectedPath) return
    const timer = setTimeout(() => { void saveRef.current(true) }, autosaveDelayMs)
    return () => clearTimeout(timer)
  }, [autosave, dirty, content, selectedPath, autosaveDelayMs])
  const closeTab = (path: string): void => {
    const next = tabs.filter((t) => t !== path)
    setTabs(next)
    if (selectedPath === path) {
      const idx = tabs.indexOf(path)
      const neighbour = next[Math.min(idx, next.length - 1)]
      if (neighbour) void openFile(neighbour)
      else { setSelectedPath(null); setContent(''); setSavedContent('') }
    }
  }
  const markers = useMemo(() => (issues ?? []).filter((i) => i.path === selectedPath && i.line).map((i) => ({ line: i.line!, column: i.column, message: i.message, severity: i.severity })), [issues, selectedPath])

  // Ctrl/Cmd+S в редакторе — сохранить; Tab — отступ, а не переход фокуса.
  const createFile = (): void => openAsk('Новый файл', 'Путь файла (например, about.html или css/theme.css)', '', 'Создать', (raw) => void createFileAt(raw))
  const createFileAt = async (raw: string): Promise<void> => {
    const path = normalizeMakePath(raw)
    if (!path) { toast.error('Недопустимый путь файла'); return }
    if (state?.files.some((f) => f.path === path)) { toast.error('Такой файл уже есть'); return }
    try {
      const next = await api['make:write']({ conversationId, path, content: '' })
      setState(next)
      setPreviewRev(next.rev)
      await openFile(path)
      setMode('code')
    } catch (e) { toast.error(describeError(e)) }
  }

  // Загрузка файлов с диска: текст пишем как текст (его можно править в редакторе),
  // остальное — бинарно в base64. Картинки складываем в img/, чтобы корень не засорялся.
  const uploadInputRef = useRef<HTMLInputElement>(null)
  // FileReader, а не Blob.text()/arrayBuffer(): их нет в jsdom, а поведение одно.
  const readAs = <T extends string | ArrayBuffer>(file: File, mode: 'text' | 'buffer'): Promise<T> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as T)
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'))
    if (mode === 'text') reader.readAsText(file); else reader.readAsArrayBuffer(file)
  })
  const uploadFiles = async (list: FileList | null): Promise<void> => {
    if (!list || list.length === 0) return
    let last: MakeProjectState | null = null
    let uploaded = 0
    for (const file of Array.from(list)) {
      const name = file.name.replace(/\s+/g, '-')
      const isText = isMakeTextPath(name)
      const path = normalizeMakePath(isText || !/^image\//.test(file.type) ? name : `img/${name}`)
      if (!path) { toast.error(`Недопустимое имя файла: ${file.name}`); continue }
      try {
        if (isText) {
          last = await api['make:write']({ conversationId, path, content: await readAs<string>(file, 'text') })
        } else {
          const bytes = new Uint8Array(await readAs<ArrayBuffer>(file, 'buffer'))
          let binary = ''
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
          last = await api['make:upload']({ conversationId, path, dataBase64: btoa(binary) })
        }
        uploaded += 1
      } catch (e) { toast.error(`${file.name}: ${describeError(e)}`) }
    }
    if (last) { setState(last); setPreviewRev(last.rev) }
    if (uploaded > 0) toast.success(uploaded === 1 ? 'Файл загружен' : `Загружено файлов: ${uploaded}`)
    if (uploadInputRef.current) uploadInputRef.current.value = ''
  }

  const renameFile = (path: string): void => openAsk('Переименовать файл', 'Новый путь файла', path, 'Переименовать', (raw) => void renameFileTo(path, raw))
  // Перенос файла между папками указателем (мышь/палец): цель — группа папки под курсором или корень дерева.
  const drag = usePointerDrag()
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)
  const [treeLive, setTreeLive] = useState('')
  const treeRef = useRef<HTMLElement | null>(null)
  const dirUnderPointer = (p: { x: number; y: number }): string | null => {
    const groups = Array.from(treeRef.current?.querySelectorAll<HTMLElement>('.make-tree-group') ?? [])
    for (const g of groups) if (pointInRect(g.getBoundingClientRect(), p)) return g.dataset.dir ?? ''
    const tree = treeRef.current?.getBoundingClientRect()
    return tree && pointInRect(tree, p) ? '' : null
  }
  const beginFileDrag = (e: React.PointerEvent<HTMLElement>, path: string): void => {
    if (e.button !== 0) return
    const lift = e.currentTarget.closest<HTMLElement>('.make-tree-item')
    drag.begin(e, {
      lift,
      onStart: () => { setDragPath(path); setTreeLive(`Перенос ${path}: отпустите над папкой`) },
      onMove: (pt) => setDropDir(dirUnderPointer(pt)),
      onDrop: (pt) => {
        const dir = dirUnderPointer(pt)
        setDragPath(null); setDropDir(null)
        if (dir === null || dir === dirOfPath(path)) { setTreeLive('Перенос отменён'); return }
        const to = moveTargetPath(path, dir)
        setTreeLive(`${path} → ${to}`)
        void renameFileTo(path, to)
      },
      onCancel: () => { setDragPath(null); setDropDir(null); setTreeLive('Перенос отменён') }
    })
  }
  const renameFileTo = async (path: string, raw: string): Promise<void> => {
    if (raw === path) return
    const to = normalizeMakePath(raw)
    if (!to) { toast.error('Недопустимый путь файла'); return }
    try {
      const next = await api['make:rename']({ conversationId, from: path, to })
      setState(next)
      setPreviewRev(next.rev)
      if (selectedPath === path) setSelectedPath(to)
      setTabs((list) => list.map((t) => (t === path ? to : t)))
    } catch (e) { toast.error(describeError(e)) }
  }

  const deleteFile = async (path: string): Promise<void> => {
    const ok = await confirm({ title: `Удалить файл «${path}»?`, message: 'Состояние проекта можно вернуть из «Истории», если снимок был сохранён.', variant: 'danger', confirmLabel: 'Удалить' })
    if (!ok) return
    try {
      const next = await api['make:delete']({ conversationId, path })
      setState(next)
      setPreviewRev(next.rev)
      if (selectedPath === path) { setSelectedPath(null); setContent(''); setSavedContent('') }
      setTabs((list) => list.filter((t) => t !== path))
    } catch (e) { toast.error(describeError(e)) }
  }

  const takeSnapshot = (): void => openAsk('Новый снимок', 'Название снимка', 'Снимок пользователя', 'Сохранить', (label) => void takeSnapshotNamed(label))
  const takeSnapshotNamed = async (label: string): Promise<void> => {
    try {
      setState(await api['make:snapshot']({ conversationId, label }))
      toast.success('Снимок сохранён')
    } catch (e) { toast.error(describeError(e)) }
  }

  const restoreSnapshot = async (snapshotId: string, label: string): Promise<void> => {
    const ok = await confirm({ title: `Вернуть проект к снимку «${label}»?`, message: 'Текущее состояние сохранится отдельным снимком.', confirmLabel: 'Вернуть' })
    if (!ok) return
    try {
      const next = await api['make:restore']({ conversationId, snapshotId })
      setState(next)
      setPreviewRev(next.rev)
      if (selectedPath) void openFile(selectedPath)
      toast.success('Проект восстановлен')
    } catch (e) { toast.error(describeError(e)) }
  }

  const resetProject = async (): Promise<void> => {
    const ok = await confirm({ title: 'Сбросить проект к заготовке?', message: 'Все файлы заменятся стартовой страницей; текущее состояние сохранится снимком.', variant: 'danger', confirmLabel: 'Сбросить' })
    if (!ok) return
    try {
      const next = await api['make:reset']({ conversationId })
      setState(next)
      setPreviewRev(next.rev)
      await openFile('index.html')
    } catch (e) { toast.error(describeError(e)) }
  }

  // Адрес и пароль публикации (п.25): slug пустой → снять адрес; пароль пустой → не менять, «Снять пароль» → null.
  const [publishSlug, setPublishSlug] = useState<string | null>(null)
  const [publishPassword, setPublishPassword] = useState('')
  const publish = async (snapshotId: string | null = null, extra: { slug?: string | null; password?: string | null; allowComments?: boolean } = {}): Promise<void> => {
    try {
      setState(await api['make:publish']({ conversationId, snapshotId, ...extra }))
      setPublishPassword('')
      toast.success(extra.allowComments !== undefined ? (extra.allowComments ? 'Комментарии зрителей включены' : 'Комментарии зрителей выключены') : extra.password === null ? 'Пароль снят' : snapshotId ? 'Публикация закреплена за снимком' : state?.published ? 'Публикация обновлена' : 'Проект опубликован')
    } catch (e) { toast.error(describeError(e)) }
  }
  const publishOptions = (): { slug?: string | null; password?: string | null } => ({
    ...(publishSlug !== null ? { slug: publishSlug.trim() || null } : {}),
    ...(publishPassword ? { password: publishPassword } : {})
  })
  const [publishPick, setPublishPick] = useState<string>('')
  /** Сравнение версий публикации (roadmap-4 п.37): снимок из истории рядом с текущим состоянием + карта различий. */
  const [versionCompare, setVersionCompare] = useState<string | null>(null)
  const [versionDiff, setVersionDiff] = useState<{ url: string; mismatch: number } | null>(null)
  const versionFrames = useRef<{ a: HTMLIFrameElement | null; b: HTMLIFrameElement | null }>({ a: null, b: null })
  const computeVersionDiff = async (): Promise<void> => {
    const a = versionFrames.current.a?.contentDocument, b = versionFrames.current.b?.contentDocument
    if (!a || !b) return
    try {
      const [pa, pb] = await Promise.all([captureIframeScreenshot({ doc: a, width: 720 }, 'a.png'), captureIframeScreenshot({ doc: b, width: 720 }, 'b.png')])
      const ua = URL.createObjectURL(pa), ub = URL.createObjectURL(pb)
      try {
        const r = pixelDiff(await loadImageData(ua), await loadImageData(ub))
        const canvas = document.createElement('canvas'); canvas.width = r.width; canvas.height = r.height
        const ctx = canvas.getContext('2d'); if (!ctx) return
        const image = ctx.createImageData(r.width, r.height); image.data.set(r.diff); ctx.putImageData(image, 0, 0)
        setVersionDiff({ url: canvas.toDataURL('image/png'), mismatch: r.mismatch })
      } finally { URL.revokeObjectURL(ua); URL.revokeObjectURL(ub) }
    } catch (e) { toast.error(describeError(e)) }
  }
  const unpublish = async (): Promise<void> => {
    const ok = await confirm({ title: 'Снять проект с публикации?', message: 'Ссылка перестанет открываться.', variant: 'danger', confirmLabel: 'Снять' })
    if (!ok) return
    try { setState(await api['make:unpublish']({ conversationId })); toast.success('Публикация снята') } catch (e) { toast.error(describeError(e)) }
  }
  // Именной доступ (roadmap-3 п.6).
  const [grantUser, setGrantUser] = useState('')
  const [grantRole, setGrantRole] = useState<'editor' | 'viewer'>('viewer')
  const grant = async (user: string, role: 'editor' | 'viewer' | null): Promise<void> => {
    if (!user.trim()) return
    try { setState(await api['make:shareGrant']({ conversationId, user: user.trim(), role })); toast.success(role ? `Доступ для ${user.trim()}: ${role === 'editor' ? 'редактор' : 'зритель'}` : `Доступ ${user.trim()} убран`) } catch (e) { toast.error(describeError(e)) }
  }
  const copyShareLink = async (text: string): Promise<void> => { toast[(await copyText(text)) ? 'success' : 'error']('Ссылка скопирована') }
  // Read-only ссылка внутри ChatAI (п.33): создать/отозвать.
  const toggleShare = async (): Promise<void> => {
    try {
      setState(await (state?.shared ? api['make:unshare']({ conversationId }) : api['make:share']({ conversationId })))
      toast.success(state?.shared ? 'Ссылка для чтения отозвана' : 'Ссылка для чтения создана')
    } catch (e) { toast.error(describeError(e)) }
  }
  const copyPublicLink = async (): Promise<void> => {
    if (!state?.published) return
    try { await navigator.clipboard.writeText(new URL(state.published.slugUrl ?? state.published.url, window.location.origin).toString()); toast.success('Ссылка скопирована') } catch { toast.error('Не удалось скопировать') }
  }
  const runCheck = async (): Promise<void> => {
    setChecking(true)
    try { setIssues((await api['make:check']({ conversationId })).issues) } catch (e) { toast.error(describeError(e)) } finally { setChecking(false) }
  }
  const applyTemplate = async (templateId: string, title: string): Promise<void> => {
    const ok = await confirm({ title: `Применить шаблон «${title}»?`, message: 'Файлы проекта заменятся файлами шаблона; текущее состояние сохранится снимком.', confirmLabel: 'Применить' })
    if (!ok) return
    try {
      const next = await api['make:template']({ conversationId, templateId })
      setState(next)
      setPreviewRev(next.rev)
      setTemplatesOpen(false)
      await openFile('index.html')
      toast.success(`Шаблон «${title}» применён`)
    } catch (e) { toast.error(describeError(e)) }
  }

  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  /** Regex-режим и учёт регистра поиска/замены (roadmap-4 п.11); предпросмотр — строки «до → после» без записи. */
  const [searchRegex, setSearchRegex] = useState(false)
  const [matchCase, setMatchCase] = useState(false)
  const [replacePreview, setReplacePreview] = useState<MakeReplacePreviewLine[] | null>(null)
  const runReplace = async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    const ok = await confirm({ title: `Заменить «${q}» на «${replacement}» во всех файлах?`, message: 'Перед заменой сохранится снимок — откатить можно во вкладке «История».', confirmLabel: 'Заменить' })
    if (!ok) return
    setReplacing(true)
    try {
      const result = await api['make:replace']({ conversationId, query: q, replacement, matchCase, regex: searchRegex })
      setReplacePreview(null)
      setState(result.state); setPreviewRev(result.state.rev)
      if (selectedPath && isMakeTextPath(selectedPath)) await openFile(selectedPath)
      toast.success(result.replacements === 0 ? 'Совпадений нет' : `Заменено: ${result.replacements} в ${result.files} файлах`)
      setMatches(null)
    } catch (e) { toast.error(describeError(e)) } finally { setReplacing(false) }
  }
  const runSearch = async (): Promise<void> => {
    const q = query.trim()
    if (!q) { setMatches(null); return }
    setSearching(true)
    try { setMatches((await api['make:search']({ conversationId, query: q, regex: searchRegex, matchCase })).matches) } catch (e) { toast.error(describeError(e)) } finally { setSearching(false) }
  }
  const previewReplace = async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    setReplacing(true)
    try {
      const result = await api['make:replace']({ conversationId, query: q, replacement, matchCase, regex: searchRegex, dryRun: true })
      setReplacePreview(result.preview ?? [])
    } catch (e) { toast.error(describeError(e)) } finally { setReplacing(false) }
  }
  /** Автогенерация сториз (roadmap-4 п.23): компоненты без `*.stories.*` и создание файла по пропсам. */
  const orphanComponents = useMemo(() => componentsWithoutStories((state?.files ?? []).map((f) => f.path)), [state])
  const generateStories = async (path: string): Promise<void> => {
    try {
      const { content } = await api['make:read']({ conversationId, path })
      const gen = generateStoriesSource(path, content)
      if (!gen) { toast.error('В файле не нашёлся экспортируемый компонент (PascalCase)'); return }
      const next = await api['make:write']({ conversationId, path: gen.path, content: gen.content })
      setState(next); setPreviewRev(next.rev)
      toast.success(`Создан ${gen.path}`)
      await loadStories()
      setStory({ file: gen.path, name: 'Default' })
    } catch (e) { toast.error(describeError(e)) }
  }
  const loadStories = useCallback(async (): Promise<void> => {
    try {
      const { files } = await api['make:stories']({ conversationId })
      setStoryFiles(files)
      void loadTests()
      setStory((current) => {
        if (current && files.some((f) => f.path === current.file && f.stories.includes(current.name))) return current
        const first = files.find((f) => f.stories.length > 0)
        return first ? { file: first.path, name: first.stories[0]! } : null
      })
    } catch (e) { toast.error(describeError(e)) }
  }, [api, conversationId, toast])
  useEffect(() => { if (mode === 'stories') void loadStories() }, [mode, loadStories, state?.rev])
  // Визуальные снимки стори (п.16): PNG раннера через html2canvas → сервер; сравнение двух снимков рядом.
  const [shots, setShots] = useState<MakeStoryShot[]>([])
  const [shotsOpen, setShotsOpen] = useState(false)
  const [shooting2, setShooting2] = useState(false)
  const [compare, setCompare] = useState<[string, string] | null>(null)
  /** Визуальная регрессия (roadmap-4 п.24): карта различий выбранной пары снимков, считается в браузере. */
  const [shotDiff, setShotDiff] = useState<{ url: string; mismatch: number } | null>(null)
  useEffect(() => {
    setShotDiff(null)
    if (!compare || compare[0] === compare[1]) return
    let alive = true
    void (async () => {
      try {
        const [a, b] = await Promise.all([loadImageData(REST.makeShotImage(conversationId, compare[0])), loadImageData(REST.makeShotImage(conversationId, compare[1]))])
        const r = pixelDiff(a, b)
        const canvas = document.createElement('canvas')
        canvas.width = r.width; canvas.height = r.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const image = ctx.createImageData(r.width, r.height)
        image.data.set(r.diff)
        ctx.putImageData(image, 0, 0)
        if (alive) setShotDiff({ url: canvas.toDataURL('image/png'), mismatch: r.mismatch })
      } catch { /* нет canvas (jsdom) или снимок не загрузился — без карты различий */ }
    })()
    return () => { alive = false }
  }, [compare, conversationId])
  const loadShots = useCallback(async (): Promise<void> => { try { setShots((await api['make:shots']({ conversationId })).shots) } catch { /* нет снимков */ } }, [api, conversationId])
  useEffect(() => { if (mode === 'stories') void loadShots() }, [mode, loadShots])
  const takeStoryShot = async (): Promise<void> => {
    const doc = storyFrameRef.current?.contentDocument
    if (!doc || !story) return
    setShooting2(true)
    try {
      const file = await captureIframeScreenshot({ doc, width: storyFrameRef.current?.clientWidth }, 'story.png')
      const bytes = new Uint8Array(await new Promise<ArrayBuffer>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file) }))
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      const { shots: next } = await api['make:shot']({ conversationId, file: story.file, story: story.name, dataBase64: btoa(binary) })
      setShots(next); setShotsOpen(true)
      toast.success('Снимок стори сохранён')
    } catch (e) { toast.error(describeError(e)) } finally { setShooting2(false) }
  }
  const storyShots = useMemo(() => (story ? shots.filter((s) => s.file === story.file && s.story === story.name) : []), [shots, story])
  // Библиотека компонентов (п.17): экспорт текущей стори (компонент + сториз) и вставка в проект.
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [library, setLibrary] = useState<MakeLibraryItem[] | null>(null)
  const loadLibrary = async (): Promise<void> => { try { setLibrary((await api['make:library']({})).items) } catch (e) { toast.error(describeError(e)) } }
  const openLibrary = (): void => { setLibraryOpen(true); void loadLibrary() }
  const exportStoryToLibrary = async (): Promise<void> => {
    if (!story) return
    const component = story.file.replace(/\.stories\.(jsx|tsx)$/i, (_m, ext: string) => `.${ext}`)
    const name = component.slice(component.lastIndexOf('/') + 1).replace(/\.(jsx|tsx)$/i, '')
    const paths = [story.file, ...(state?.files.some((f) => f.path === component) ? [component] : [])]
    try {
      const { item } = await api['make:libraryExport']({ conversationId, name, paths })
      toast.success(`«${item.name}» сохранён в библиотеку (${item.files.length} файл.)`)
    } catch (e) { toast.error(describeError(e)) }
  }
  /** Весь дизайн-кит одним элементом (roadmap-2 п.13): компоненты со сториз + файл токенов. */
  const kitPaths = (): string[] => {
    const paths = (state?.files ?? []).map((f) => f.path)
    const comps = paths.filter((p) => /^src\/components\/.+\.(jsx|tsx)$/i.test(p))
    const tokens = pickTokensFile(paths)
    return tokens ? [...comps, tokens] : comps
  }
  const exportKitToLibrary = async (): Promise<void> => {
    const paths = kitPaths()
    if (paths.length === 0) return
    try {
      const { item } = await api['make:libraryExport']({ conversationId, name: `Дизайн-кит · ${paths.length} файл.`, paths })
      toast.success(`Кит «${item.name}» сохранён в библиотеку`)
      void loadLibrary()
    } catch (e) { toast.error(describeError(e)) }
  }
  const insertFromLibrary = async (item: MakeLibraryItem): Promise<void> => {
    const clash = item.files.filter((p) => state?.files.some((f) => f.path === p))
    if (clash.length > 0 && !(await confirm({ title: `Вставить «${item.name}»?`, message: `Файлы будут перезаписаны: ${clash.join(', ')}. Перед вставкой сохранится снимок.`, confirmLabel: 'Вставить' }))) return
    try {
      const { state: next, autoImported } = await api['make:libraryInsert']({ conversationId, slug: item.slug })
      setState(next); setPreviewRev(next.rev); setLibraryOpen(false)
      toast.success(autoImported.length ? `«${item.name}» добавлен; импорт в точку входа: ${autoImported.join(', ')}` : `«${item.name}» добавлен в проект`)
      if (selectedPath && isMakeTextPath(selectedPath)) void openFile(selectedPath)
      void loadStories()
    } catch (e) { toast.error(describeError(e)) }
  }
  const removeFromLibrary = async (item: MakeLibraryItem): Promise<void> => {
    if (!(await confirm({ title: `Удалить «${item.name}» из библиотеки?`, variant: 'danger', confirmLabel: 'Удалить' }))) return
    try { setLibrary((await api['make:libraryRemove']({ slug: item.slug })).items) } catch (e) { toast.error(describeError(e)) }
  }
  /** Публичная ссылка на стори (нужна публикация) — копируется в буфер. */
  const shareStory = async (): Promise<void> => {
    if (!story) return
    if (!state?.published) { toast.info('Публичная ссылка появится после публикации проекта (кнопка «Опубликовать»)'); setPublishOpen(true); return }
    const url = new URL(`${state.published.url}__stories__?file=${encodeURIComponent(story.file)}&story=${encodeURIComponent(story.name)}`, window.location.origin).toString()
    toast[(await copyText(url)) ? 'success' : 'error']('Ссылка на стори скопирована')
  }
  const sendStoryToChat = (): void => {
    if (!story || !onInsertToChat) return
    const component = story.file.slice(story.file.lastIndexOf('/') + 1).replace(/\.stories\.(jsx|tsx)$/i, '')
    onInsertToChat(`Работаем только над компонентом ${component} (${story.file.replace(/\.stories\./, '.')}, стори «${story.name}» в ${story.file}); другие файлы не трогай. `)
  }

  const sendSelectedToChat = (): void => {
    if (!selected || !onInsertToChat) return
    const text = `Измени элемент ${selected.selector}${selected.text ? ` («${selected.text.slice(0, 80)}»)` : ''}: `
    onInsertToChat(text)
    setInspect(false)
  }

  const groups = useMemo(() => groupFiles(state?.files ?? []), [state])
  const treeOrder = useMemo(() => groups.flatMap((g) => g.files.map((f) => f.path)), [groups])
  useEffect(() => { setPicked((sel) => (sel.paths.length ? pruneMakeSelection(sel, treeOrder) : sel)) }, [treeOrder])
  const bulkDelete = async (): Promise<void> => {
    const paths = picked.paths
    const ok = await confirm({ title: `Удалить ${paths.length} файлов?`, message: paths.join(', '), variant: 'danger', confirmLabel: 'Удалить' })
    if (!ok) return
    try {
      let next: MakeProjectState | null = null
      for (const path of paths) next = await api['make:delete']({ conversationId, path })
      if (next) { setState(next); setPreviewRev(next.rev) }
      if (selectedPath && paths.includes(selectedPath)) { setSelectedPath(null); setContent(''); setSavedContent('') }
      setTabs((list) => list.filter((t) => !paths.includes(t)))
      setPicked(EMPTY_MAKE_SELECTION)
      toast.success(`Удалено файлов: ${paths.length}`)
    } catch (e) { toast.error(describeError(e)) }
  }
  const bulkMove = (): void => openAsk('Перенести файлы в папку', 'Папка (пусто — корень)', dirOfPath(picked.paths[0] ?? ''), 'Перенести', (raw) => {
    const dir = raw.trim().replace(/^\/+|\/+$/g, '')
    void (async () => {
      for (const path of picked.paths) if (dirOfPath(path) !== dir) await renameFileTo(path, moveTargetPath(path, dir))
      setPicked(EMPTY_MAKE_SELECTION)
    })()
  })
  // «Свежий» проект — только файлы заготовки без правок: показываем стартовые идеи, как главная Figma Make.
  const isFresh = useMemo(() => {
    const files = state?.files
    if (!files || files.length === 0) return false
    const enc = new TextEncoder()
    return files.every((f) => f.path in MAKE_SCAFFOLD && f.size === enc.encode(MAKE_SCAFFOLD[f.path]!).length)
  }, [state])
  const useStarter = (prompt: string): void => { onInsertToChat?.(prompt); setIdeasOpen(false) }
  // Скриншот превью (или выбранного элемента) — во вложения чата: визуальный баг проще показать, чем описать.
  const [shooting, setShooting] = useState(false)
  // Доступность превью (п.13): axe внутри iframe, результат — панель под превью.
  const [a11y, setA11y] = useState<A11yViolation[] | null>(null)
  const [a11yBusy, setA11yBusy] = useState(false)
  const runA11y = async (): Promise<void> => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    setA11yBusy(true)
    try { setA11y(await runAxeInFrame(doc)) } catch (e) { toast.error(describeError(e)) } finally { setA11yBusy(false) }
  }
  useEffect(() => { setA11y(null) }, [previewRev])
  const showA11yTarget = (target: string): void => {
    const doc = frameRef.current?.contentDocument
    const el = target ? doc?.querySelector(target) : null
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    ;(el as HTMLElement).style.outline = '3px solid #f85149'
    setTimeout(() => { (el as HTMLElement).style.outline = '' }, 2000)
  }
  const screenshotToChat = async (): Promise<void> => {
    const doc = frameRef.current?.contentDocument
    if (!doc || !onAttachImage) return
    setShooting(true)
    try {
      const element = selected ? doc.querySelector(selected.selector) : null
      const file = await captureIframeScreenshot({ doc, element, width: frameRef.current?.clientWidth }, selected ? 'element.png' : 'preview.png')
      onAttachImage(file)
      if (onInsertToChat && !selected) onInsertToChat('На скриншоте превью: ')
      toast.success('Скриншот добавлен во вложения')
    } catch (e) { toast.error(describeError(e)) } finally { setShooting(false) }
  }
  useEffect(() => { setConsoleLines([]); setNetwork([]) }, [previewRev])
  const networkFailed = network.filter((n) => !n.ok).length
  // Итеративная правка: после перезагрузки превью (правка ассистента или своя) 8 секунд слушаем консоль;
  // появились ошибки — предлагаем «Исправить» одной кнопкой, текст ошибок уходит ассистенту сразу.
  const [autofix, setAutofix] = useState<{ rev: number; dismissed: boolean }>({ rev: 0, dismissed: false })
  const watchUntil = useRef(0)
  useEffect(() => { watchUntil.current = Date.now() + 8_000; setAutofix({ rev: previewRev, dismissed: false }) }, [previewRev])
  const recentErrors = consoleLines.filter((l) => l.level === 'error' && l.at <= watchUntil.current)
  const showAutofix = !autofix.dismissed && recentErrors.length > 0
  const askFix = (): void => {
    const text = `После последней правки в консоли превью ошибки:\n${recentErrors.slice(-5).map((l) => `- ${l.text.slice(0, 300)}`).join('\n')}\nНайди причину и исправь. `
    if (onAskAssistant) onAskAssistant(text); else onInsertToChat?.(text)
    setAutofix((a) => ({ ...a, dismissed: true }))
  }
  const consoleErrors = consoleLines.filter((l) => l.level === 'error').length
  const sendConsoleToChat = (): void => {
    const errors = consoleLines.filter((l) => l.level === 'error' || l.level === 'warn').slice(-5)
    if (!onInsertToChat || errors.length === 0) return
    onInsertToChat(`В консоли превью ошибки:\n${errors.map((l) => `- [${l.level}] ${l.text.slice(0, 300)}`).join('\n')}\nИсправь. `)
  }
  const sendNetworkToChat = (): void => {
    const failed = network.filter((n) => !n.ok).slice(-8)
    if (!onInsertToChat || failed.length === 0) return
    onInsertToChat(`В превью не загрузились ресурсы:\n${failed.map((n) => `- ${n.method} ${n.url} → ${n.status || 'сеть'}`).join('\n')}\nПоправь пути или запросы. `)
  }
  const assets = useMemo(() => (state?.files ?? []).filter((f) => !isMakeTextPath(f.path)), [state])
  const copyAsset = async (text: string, what: string): Promise<void> => { toast[(await copyText(text)) ? 'success' : 'error'](`${what} скопирован`) }
  const loadDiff = async (snapshotId: string): Promise<void> => {
    if (diffs[snapshotId]) { setDiffs((d) => { const next = { ...d }; delete next[snapshotId]; return next }); return }
    setDiffs((d) => ({ ...d, [snapshotId]: 'loading' }))
    try { const diff = await api['make:snapshotDiff']({ conversationId, snapshotId }); setDiffs((d) => ({ ...d, [snapshotId]: diff })) }
    catch (e) { toast.error(describeError(e)); setDiffs((d) => { const next = { ...d }; delete next[snapshotId]; return next }) }
  }
  const restoreFile = async (snapshotId: string, path: string): Promise<void> => {
    try {
      const next = await api['make:restoreFile']({ conversationId, snapshotId, path })
      setState(next); setPreviewRev(next.rev)
      if (selectedPath === path) await openFile(path)
      setDiffs((d) => { const n = { ...d }; delete n[snapshotId]; return n })
      toast.success(`Файл ${path} восстановлен`)
    } catch (e) { toast.error(describeError(e)) }
  }
  const runImport = async (kind: 'zip' | 'url', file?: File): Promise<void> => {
    setImporting(true)
    try {
      let next: MakeProjectState
      if (kind === 'zip') {
        if (!file) return
        const bytes = new Uint8Array(await new Promise<ArrayBuffer>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file) }))
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        next = await api['make:import']({ conversationId, dataBase64: btoa(binary), mode: importMode })
      } else {
        if (!importUrl.trim()) return
        next = await api['make:importUrl']({ conversationId, url: importUrl.trim(), mode: importMode })
      }
      setState(next); setPreviewRev(next.rev); setImportOpen(false); setMode('preview')
      toast.success(`Импортировано файлов: ${next.files.length}`)
    } catch (e) { toast.error(describeError(e)) } finally { setImporting(false); if (importZipRef.current) importZipRef.current.value = '' }
  }
  const frameWidth = DEVICE_WIDTH[device]
  const previewSrc = `${base}index.html?rev=${previewRev}`

  // Меню «⋯» (ревизия стилей): второстепенные действия убраны из шапки, чтобы она не переносилась
  // на две-четыре строки — особенно на телефоне. Закрывается по клику вне и по Esc.
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent): void => { if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false) }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [moreOpen])
  const item = (label: string, onClick: () => void, opts: { ariaLabel?: string; disabled?: boolean; title?: string } = {}): JSX.Element => (
    <button key={opts.ariaLabel ?? label} type="button" aria-label={opts.ariaLabel} title={opts.title} disabled={opts.disabled} onClick={() => { setMoreOpen(false); onClick() }}>{label}</button>
  )
  const header = (
    <div className="make-head" role="toolbar" aria-label="Панель проекта">
      <div className="make-tabs" role="tablist" aria-label="Режим панели">
        {(['preview', 'code', 'stories', 'history'] as Mode[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'make-tab on' : 'make-tab'} onClick={() => setMode(m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <span className="make-head-spacer" />
      {mode === 'preview' && (
        <>
          <div className="make-devices" role="group" aria-label="Ширина превью">
            {(['desktop', 'tablet', 'mobile', ...(isPhone ? [] : ['all' as Device])] as Device[]).map((d) => (
              <button key={d} type="button" aria-pressed={device === d} className={device === d ? 'make-device on' : 'make-device'} title={DEVICE_LABEL[d]} aria-label={DEVICE_LABEL[d]} onClick={() => setDevice(d)}>
                {d === 'desktop' ? 'ПК' : d === 'tablet' ? 'Планшет' : d === 'mobile' ? 'Телефон' : '⫼'}
              </button>
            ))}
          </div>
          <IconButton size="sm" aria-label="Выбрать элемент" title="Выбрать элемент на странице и попросить ассистента его изменить" aria-pressed={inspect} className={inspect ? 'make-inspect on' : undefined} onClick={() => setInspect((v) => !v)}>⌖</IconButton>
          <IconButton size="sm" aria-label="Обновить превью" title="Обновить превью" onClick={() => setPreviewRev((r) => r + 1)}>⟳</IconButton>
          <Button size="sm" variant={commentsOpen ? 'secondary' : 'ghost'} aria-pressed={commentsOpen} onClick={() => setCommentsOpen((v) => !v)} title="Комментарии к элементам превью">💬{comments && comments.some((c) => !c.resolved) ? ` ${comments.filter((c) => !c.resolved).length}` : ''}</Button>
        </>
      )}
      {mode === 'code' && (
        <>
          {!isPhone && <IconButton size="sm" aria-label="Превью рядом" title={split ? 'Скрыть превью рядом с кодом' : 'Показать превью рядом с кодом (границу можно перетаскивать)'} aria-pressed={split} onClick={toggleSplit}>◫</IconButton>}
          {!isPhone && <IconButton size="sm" aria-label="Zen-режим" title="Zen: только редактор, Esc — выйти" aria-pressed={zen} onClick={() => setZen(true)}>⛶</IconButton>}
          <Button size="sm" variant="ghost" onClick={() => void runCheck()} loading={checking}>Проверить</Button>
          <Button size="sm" variant="secondary" onClick={createFile}>+ Файл</Button>
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save()} title="Сохранить (Ctrl/Cmd+S)">{saving ? 'Сохраняю…' : 'Сохранить'}</Button>
        </>
      )}
      <input ref={uploadInputRef} type="file" multiple hidden aria-label="Загрузить файлы в проект" data-testid="make-upload-input" onChange={(e) => void uploadFiles(e.target.files)} />
      {mode === 'history' && <Button size="sm" variant="secondary" onClick={takeSnapshot}>+ Снимок</Button>}
      {mode === 'history' && <Button size="sm" variant="ghost" onClick={() => setUsageOpen(true)} title="Сколько места занимает проект и очистка снимков">Место</Button>}
      {mode === 'stories' && story && onInsertToChat && <Button size="sm" variant="primary" onClick={sendStoryToChat}>Работать над компонентом</Button>}
      {mode === 'stories' && story && <Button size="sm" variant="ghost" loading={shooting2} onClick={() => void takeStoryShot()} title="Сохранить PNG текущей стори, чтобы потом сравнить «до/после»">📸 Снимок</Button>}
      {mode === 'stories' && storyShots.length > 0 && <Button size="sm" variant="ghost" aria-expanded={shotsOpen} onClick={() => setShotsOpen((v) => !v)}>Снимки ({storyShots.length})</Button>}
      {mode === 'stories' && testFiles.length > 0 && <Button size="sm" variant={failedTests.length ? 'danger' : 'ghost'} loading={Boolean(runningTests)} onClick={() => runTests(testFiles.map((f) => f.path))} title="Запустить все *.test.tsx в раннере">Тесты ({testFiles.reduce((n, f) => n + f.names.length, 0)}){failedTests.length ? ` · ✗ ${failedTests.length}` : ''}</Button>}
      {others.length > 0 && <span className="make-presence" data-testid="make-presence" title={`Проект открыт ещё в ${others.length} ${others.length === 1 ? 'вкладке' : 'вкладках'}: ${others.map((c) => `${c.user}${c.path ? ` · ${c.path}${c.editing ? ' (правит)' : ''}` : ''}`).join('; ')}`}>👥 {others.length + 1}</span>}
      {usage && <span className="make-cost" data-testid="make-cost" title={`Расход на проект: ${usage.turns} ${usage.turns === 1 ? 'ход' : usage.turns < 5 ? 'хода' : 'ходов'} · ↓ ${kilo(usage.inputTokens)} · ↑ ${kilo(usage.outputTokens)}${usage.estimated ? ' · часть суммы — расчёт по тарифам' : ''}${usage.unpriced ? ` · без цены: ${usage.unpriced}` : ''}`}>{formatUsd(usage.costUsd, usage.estimated)}<small>{usage.turns} {usage.turns === 1 ? 'ход' : usage.turns < 5 ? 'хода' : 'ходов'}</small></span>}
      {onAskOnlyChange && <IconButton size="sm" aria-label="Только спросить" title={askOnly ? 'Режим вопроса: следующий ответ без правок файлов (нажмите, чтобы выключить)' : 'Только спросить: следующий ход ответит без правок файлов — дешевле и безопаснее'} aria-pressed={askOnly} className={askOnly ? 'make-inspect on' : undefined} onClick={() => onAskOnlyChange(!askOnly)}>❓</IconButton>}
      <Button size="sm" variant={state?.published ? 'secondary' : 'ghost'} onClick={() => setPublishOpen(true)} >{state?.published ? 'Опубликован' : 'Опубликовать'}</Button>
      <div className="make-more" ref={moreRef}>
        <IconButton size="sm" aria-label="Ещё" title="Ещё действия" aria-haspopup="true" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>⋯</IconButton>
        {moreOpen && (
          <div className="jcard-menu make-more-menu" role="group" aria-label="Ещё действия" data-testid="make-more-menu">
            {mode === 'preview' && <>
              {item(`Тема: ${previewScheme === 'auto' ? 'как в системе' : previewScheme === 'dark' ? 'тёмная' : 'светлая'}`, () => cycleScheme(), { ariaLabel: 'Тема превью', title: 'Переключить тему превью' })}
              {item(`Состояние элемента: ${forcedState ?? 'обычное'}`, () => cycleForcedState(), { ariaLabel: 'Состояние элемента', title: 'Показать выбранный элемент в :hover / :focus / :active — правила клонируются под принудительный класс', disabled: !selected })}
              {item(`Reduced motion: ${reducedMotion ? 'вкл' : 'выкл'}`, () => toggleReducedMotion(), { ariaLabel: 'Reduced motion', title: 'Эмулировать prefers-reduced-motion: анимации и переходы без длительности' })}
              {item(`Медленная сеть: ${slowMs === 0 ? 'выкл' : `${slowMs / 1000} с`}`, () => cycleSlowMs(), { ariaLabel: 'Медленная сеть', title: 'Задержка ответов fetch в превью (моки и данные), чтобы увидеть состояния загрузки' })}
              <label className="make-more-row"><span>Язык превью</span>
                <select className="make-lang" aria-label="Язык превью" value={previewLang} onChange={(e) => { setPreviewLang(e.target.value); sendEnv(previewScheme, e.target.value) }} title="Атрибут lang документа превью">
                  <option value="">авто</option>
                  {['ru', 'en', 'de', 'fr', 'es', 'zh', 'ar'].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              {item('♿ Проверить доступность', () => void runA11y(), { ariaLabel: 'Проверить доступность', disabled: a11yBusy, title: 'axe-core внутри превью: контраст, alt, подписи, заголовки' })}
              {onAttachImage && item(selected ? '📷 Скриншот элемента в чат' : '📷 Скриншот превью в чат', () => void screenshotToChat(), { ariaLabel: 'Скриншот превью в чат', disabled: shooting })}
              {item('↗ Открыть в новой вкладке', () => window.open(`${base}index.html`, '_blank', 'noopener'), { ariaLabel: 'Открыть в новой вкладке' })}
              <hr />
            </>}
            {mode === 'code' && <>
              {item('Загрузить файлы…', () => uploadInputRef.current?.click(), { ariaLabel: 'Загрузить' })}
              {item(`Ассеты${assets.length > 0 ? ` (${assets.length})` : ''}`, () => setAssetsOpen(true))}
              {item('Токены дизайна', () => setTokensOpen(true), { ariaLabel: 'Токены', title: 'Дизайн-токены: CSS-переменные :root — цвета, отступы, шрифты' })}
              {item('Библиотека компонентов', () => openLibrary(), { ariaLabel: 'Библиотека' })}
              {(onAskAssistant || onInsertToChat) && item('✦ Мок из описания', () => openAsk('Мок-данные из описания', 'Что за данные: например, «товары: название, цена, категория, 10 штук»', '', 'Сгенерировать', (desc) => { const n = /(\d{1,3})\s*(шт|запис|штук|элемент|строк)/i.exec(desc)?.[1]; const { prompt } = makeMockPrompt(desc, n ? { count: Number(n) } : {}); (onAskAssistant ?? onInsertToChat)!(prompt) }), { ariaLabel: 'Мок из описания', title: 'Ассистент создаст коллекцию mock/api/<имя>.json с правдоподобными записями' })}
              <hr />
            </>}
            {mode === 'stories' && <>
              {story && item('В библиотеку', () => void exportStoryToLibrary(), { title: 'Сохранить компонент и его сториз в личную библиотеку' })}
              {item('Библиотека компонентов', () => openLibrary(), { ariaLabel: 'Библиотека' })}
              {item('Галерея всех стори', () => window.open(REST.makeGalleryPage(conversationId), '_blank', 'noopener'), { ariaLabel: 'Галерея' })}
              {story && item('Ссылка на стори', () => void shareStory(), { ariaLabel: 'Поделиться',  title: state?.published ? 'Скопировать публичную ссылку на эту стори' : 'Сначала опубликуйте проект — ссылка будет без входа' })}
              <hr />
            </>}
            {item('🧠 Память проекта', () => setNotesOpen(true), { ariaLabel: 'Память проекта', title: 'Заметки для ассистента и режим «дизайнер / разработчик»' })}
            {item('🗂 Задачи проекта', () => setTaskLinksOpen(true), { ariaLabel: 'Задачи проекта', title: 'Связать открытую страницу с карточкой доски и увидеть уже связанные' })}
            {item('⇅ Компоненты из проекта', () => setProjectSyncOpen(true), { ariaLabel: 'Компоненты из проекта', title: 'Скопировать компоненты и стили из репозитория проекта и править их в Make' })}
            {onInsertToChat && item('✦ Идеи для старта', () => setIdeasOpen(true), { ariaLabel: 'Идеи для старта' })}
            {item('▤ Шаблоны проекта', () => setTemplatesOpen(true), { ariaLabel: 'Шаблоны проекта' })}
            {item('⇪ Импорт проекта', () => setImportOpen(true), { ariaLabel: 'Импорт проекта', title: 'Импорт: ZIP, страница по URL или репозиторий GitHub' })}
            {item('⇩ Скачать проект (ZIP)', () => setExportOpen(true), { ariaLabel: 'Скачать проект (ZIP)' })}
          </div>
        )}
      </div>
      <IconButton size="sm" aria-label={fullscreen ? 'Свернуть панель' : 'На весь экран'} title={fullscreen ? 'Свернуть панель' : 'На весь экран'} aria-pressed={fullscreen} onClick={() => setFullscreen((v) => !v)}>⛶</IconButton>
    </div>
  )

  return (
    <section className={`make-pane${fullscreen ? ' make-pane--fs' : ''}${zen && mode === 'code' ? ' make-pane--zen' : ''}`} aria-label="Проект Make" data-testid="make-pane">
      {header}
      {error && <p className="make-error" role="alert">{error}</p>}

      {mode === 'preview' && (
        <div className="make-preview" data-testid="make-preview">
          {turnDiff && (
            <div className="make-turn-diff" data-testid="make-turn-diff">
              <strong>Изменения последнего ответа</strong>
              <button type="button" className="make-turn-diff-thumbs" onClick={() => setDiffOpen(true)} title="Сравнить крупно">
                <span><img src={turnDiff.before} alt="Превью до правок" /><small>до</small></span>
                <span><img src={turnDiff.after} alt="Превью после правок" /><small>после</small></span>
              </button>
              <span className="make-head-spacer" />
              {onAttachImage && lastRequest && (onAskAssistant || onInsertToChat) && <Button size="sm" variant="secondary" onClick={() => void verifyResult()} title="Отправить ассистенту скриншот «после» и исходный запрос — пусть сверит и исправит">Сверить с запросом</Button>}
              {onAttachImage && <Button size="sm" variant="ghost" onClick={() => void diffToChat()}>В чат</Button>}
              <IconButton size="sm" aria-label="Скрыть сравнение" title="Скрыть" onClick={dismissDiff}>✕</IconButton>
            </div>
          )}
          {nextStepsOpen && (onAskAssistant || onInsertToChat) && (
            <div className="make-next" data-testid="make-next">
              <span className="make-next-label">Что дальше:</span>
              {makeNextSteps({ hasTokens: Boolean(pickTokensFile((state?.files ?? []).map((f) => f.path))) && (state?.files ?? []).some((f) => f.path === 'tokens.css' || f.path === 'styles.css'), hasTests: testFiles.length > 0, hasStories: (storyFiles?.length ?? 0) > 0, published: Boolean(state?.published), openComments: (comments ?? []).filter((c) => !c.resolved).length, a11yIssues: a11y ? a11y.length : null, files: state?.files.length ?? 0 }).map((s) => (
                <button key={s.id} type="button" className="make-next-chip" onClick={() => { setNextStepsOpen(false); (onAskAssistant ?? onInsertToChat)!(s.prompt) }}>{s.title}</button>
              ))}
              <IconButton size="sm" aria-label="Скрыть подсказки" title="Скрыть" onClick={() => setNextStepsOpen(false)}>✕</IconButton>
            </div>
          )}
          {selected && (
            <div className="make-selected" data-testid="make-selected">
              <code className="make-selected-sel" title={selected.selector}>&lt;{selected.tag}&gt; {selected.selector}</code>
              {selected.text && <span className="make-selected-text">«{selected.text.slice(0, 80)}»</span>}
              <span className="make-selected-actions">
                <Button size="sm" variant={styleOpen ? 'secondary' : 'ghost'} aria-expanded={styleOpen} onClick={() => setStyleOpen((v) => !v)}>Стили</Button>
                {onInsertToChat && <Button size="sm" variant="primary" onClick={sendSelectedToChat}>В чат</Button>}
                <IconButton size="sm" aria-label="Снять выбор" title="Снять выбор" onClick={() => { previewStyles({}); setSelected(null) }}>✕</IconButton>
              </span>
            </div>
          )}
          {selected && styleOpen && (
            <MakeStylePanel selector={selected.selector} id={selected.id} className={selected.className} computed={selected.styles ?? {}} onPreview={previewStyles} onWrite={writeStyles} onReset={() => previewStyles({})} />
          )}
          {isFresh && onInsertToChat && (
            <section className="make-starters" aria-label="Идеи для старта" data-testid="make-starters">
              <div className="make-starters-head">
                <strong>С чего начать</strong>
                <Button size="sm" variant="ghost" onClick={() => setIdeasOpen(true)}>Все идеи</Button>
              </div>
              <div className="make-starters-grid">
                {MAKE_STARTER_PROMPTS.slice(0, 6).map((item) => (
                  <button key={item.id} type="button" className="make-starter" onClick={() => useStarter(item.prompt)} title={item.prompt}>
                    <span className="make-starter-title">{item.title}</span>
                    <span className="make-starter-group">{MAKE_STARTER_GROUPS[item.group]}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className={commentsOpen ? 'make-preview-body make-preview-split' : 'make-preview-body'}>
          <div className={`make-frame-host make-frame-host--${device}`}>
            {previewReady && <iframe
              ref={frameRef}
              key={previewRev}
              className="make-frame"
              title="Превью проекта"
              src={previewSrc}
              onLoad={restorePageState}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
              style={frameWidth ? { width: `${frameWidth}px` } : device === 'all' ? { width: '1200px' } : undefined}
            />}
            {device === 'all' && previewReady && SYNC_WIDTHS.map((w, i) => (
              <iframe key={`${previewRev}-${w}`} ref={(el) => { syncFramesRef.current[i] = el }} className="make-frame make-frame--sync" title={`Превью ${w}px`} src={previewSrc} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin" style={{ width: `${w}px` }} />
            ))}
          </div>
          {commentsOpen && (
            <MakeCommentsPanel
              comments={comments ?? []}
              selected={selected ? { selector: selected.selector, tag: selected.tag, text: selected.text } : null}
              onAdd={(text) => commentAction(() => api['make:commentAdd']({ conversationId, selector: selected!.selector, elementLabel: `<${selected!.tag}> ${selected!.text.slice(0, 60)}`.trim(), text }))}
              onResolve={(id, resolved) => void commentAction(() => api['make:commentUpdate']({ conversationId, commentId: id, resolved }))}
              onApprove={(id) => void commentAction(() => api['make:commentUpdate']({ conversationId, commentId: id, status: 'approved' }))}
              onRemove={(id) => void commentAction(() => api['make:commentRemove']({ conversationId, commentId: id }))}
              onHighlight={highlightInPreview}
              onAskAssistant={onAskAssistant ?? onInsertToChat}
              onClose={() => setCommentsOpen(false)}
            />
          )}
          </div>
          {a11y !== null && (
            <section className={a11y.length ? 'make-a11y make-a11y--bad' : 'make-a11y'} aria-label="Проверка доступности" data-testid="make-a11y">
              <div className="make-a11y-head">
                <strong>{a11y.length === 0 ? '✓ Доступность: нарушений не найдено' : `Доступность: ${a11y.length} нарушений`}</strong>
                <span className="make-a11y-actions">
                  {a11y.length > 0 && (onAskAssistant || onInsertToChat) && <Button size="sm" variant="primary" onClick={() => { (onAskAssistant ?? onInsertToChat)!(a11yPrompt(a11y)) }}>Исправить</Button>}
                  <IconButton size="sm" aria-label="Скрыть результат проверки доступности" title="Скрыть" onClick={() => setA11y(null)}>✕</IconButton>
                </span>
              </div>
              {a11y.length > 0 && (
                <ul className="make-a11y-list">
                  {a11y.map((v) => (
                    <li key={v.id} className={`make-a11y-row make-a11y-row--${v.impact}`}>
                      <span className="make-a11y-impact">{v.impact}</span>
                      <button type="button" className="make-a11y-help" onClick={() => showA11yTarget(v.target)} title={v.target}>{v.help}</button>
                      <small>{v.nodes} элем.</small>
                      <a href={v.helpUrl} target="_blank" rel="noreferrer">?</a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {showAutofix && (
            <div className="make-autofix" role="alert" data-testid="make-autofix">
              <span>После правки в консоли {recentErrors.length === 1 ? 'ошибка' : `ошибок: ${recentErrors.length}`} — <code>{recentErrors[recentErrors.length - 1]!.text.slice(0, 120)}</code></span>
              <span className="make-autofix-actions">
                {(onAskAssistant || onInsertToChat) && <Button size="sm" variant="primary" onClick={askFix}>Исправить</Button>}
                <Button size="sm" variant="ghost" onClick={() => { setAutofix((a) => ({ ...a, dismissed: true })); setConsoleOpen(true) }}>Показать консоль</Button>
                <IconButton size="sm" aria-label="Скрыть предложение исправить" title="Скрыть" onClick={() => setAutofix((a) => ({ ...a, dismissed: true }))}>✕</IconButton>
              </span>
            </div>
          )}
          <section className={consoleOpen ? 'make-console make-console--open' : 'make-console'} aria-label="Консоль превью" data-testid="make-console">
            <div className="make-console-head">
              <span className="make-console-tabs">
                <button type="button" className={`make-console-toggle${bottomTab === 'console' ? ' on' : ''}`} aria-expanded={consoleOpen && bottomTab === 'console'} onClick={() => { if (bottomTab === 'console') setConsoleOpen((v) => !v); else { setBottomTab('console'); setConsoleOpen(true) } }}>
                  {consoleOpen && bottomTab === 'console' ? '▾' : '▸'} Консоль <span className="make-console-count">{consoleLines.length}</span>
                  {consoleErrors > 0 && <span className="make-console-errors" data-testid="make-console-errors">{consoleErrors} ошибок</span>}
                </button>
                <button type="button" className={`make-console-toggle${bottomTab === 'network' ? ' on' : ''}`} aria-expanded={consoleOpen && bottomTab === 'network'} onClick={() => { if (bottomTab === 'network') setConsoleOpen((v) => !v); else { setBottomTab('network'); setConsoleOpen(true) } }} data-testid="make-network-toggle">
                  {consoleOpen && bottomTab === 'network' ? '▾' : '▸'} Сеть <span className="make-console-count">{network.length}</span>
                  {networkFailed > 0 && <span className="make-console-errors" data-testid="make-network-failed">{networkFailed} не загрузилось</span>}
                </button>
              </span>
              <span className="make-console-actions">
                {onInsertToChat && bottomTab === 'console' && consoleErrors > 0 && <Button size="sm" variant="secondary" onClick={sendConsoleToChat}>В чат</Button>}
                {onInsertToChat && bottomTab === 'network' && networkFailed > 0 && <Button size="sm" variant="secondary" onClick={sendNetworkToChat}>В чат</Button>}
                {bottomTab === 'console' && consoleLines.length > 0 && <Button size="sm" variant="ghost" onClick={() => setConsoleLines([])}>Очистить</Button>}
                {bottomTab === 'network' && network.length > 0 && <Button size="sm" variant="ghost" onClick={() => setNetwork([])}>Очистить</Button>}
              </span>
            </div>
            {consoleOpen && bottomTab === 'network' && (
              <ol className="make-console-lines make-network" data-testid="make-network">
                {network.length === 0 && <li className="make-console-empty">Пусто — fetch/XHR из превью появятся здесь.</li>}
                {network.map((n, i) => (
                  <li key={`${n.at}-${i}`} className={`make-network-row${n.ok ? '' : ' make-network-row--bad'}`}>
                    <span className="make-network-status">{n.status || '—'}</span>
                    <span className="make-network-method">{n.method}</span>
                    <code className="make-network-url" title={n.url}>{n.url}</code>
                    <small>{n.ms} мс · {n.kind}</small>
                  </li>
                ))}
              </ol>
            )}
            {consoleOpen && bottomTab === 'console' && (
              <ol className="make-console-lines">
                {consoleLines.length === 0 && <li className="make-console-empty">Пусто — console.log и ошибки страницы появятся здесь.</li>}
                {consoleLines.map((l, i) => <li key={`${l.at}-${i}`} className={`make-console-line make-console-line--${l.level}`}><span className="make-console-level">{l.level}</span><code>{l.text}</code></li>)}
              </ol>
            )}
          </section>
        </div>
      )}

      {mode === 'code' && (
        <div ref={codeRef} className={`${dropActive ? 'make-code make-code--drop' : 'make-code'}${isPhone ? ' make-code--phone' : ''}${split && !isPhone ? ' make-code--split' : ''}${zen ? ' make-code--zen' : ''}`} style={split && !isPhone && !zen ? { gridTemplateColumns: `minmax(150px, 220px) ${splitPct}fr 6px ${100 - splitPct}fr` } : split && zen ? { gridTemplateColumns: `${splitPct}fr 6px ${100 - splitPct}fr` } : undefined} onDragOver={onDragOver} onDragLeave={() => setDropActive(false)} onDrop={onDrop} data-testid="make-code">
          <nav className={dragPath ? 'make-tree make-tree--dragging' : 'make-tree'} aria-label="Файлы проекта" ref={treeRef}>
            <span className="vc-sr-only" role="status" aria-live="polite" data-testid="make-tree-live">{treeLive}</span>
            <div className="make-search">
              <input
                type="search"
                className="make-search-input"
                aria-label="Поиск по файлам проекта"
                placeholder="Имя файла или текст… (Enter — по содержимому)"
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) setMatches(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch() } if (e.key === 'Escape') { setQuery(''); setMatches(null) } }}
              />
              {searching && <span className="make-search-state">ищу…</span>}
              <IconButton size="sm" aria-label="Регулярное выражение" title="Искать регулярным выражением" aria-pressed={searchRegex} onClick={() => setSearchRegex((v) => !v)}>.*</IconButton>
              <IconButton size="sm" aria-label="Учитывать регистр" title="Учитывать регистр" aria-pressed={matchCase} onClick={() => setMatchCase((v) => !v)}>Aa</IconButton>
              <IconButton size="sm" aria-label="Заменить по проекту" title="Поиск и замена во всех файлах" aria-pressed={replaceOpen} onClick={() => setReplaceOpen((v) => !v)}>⇄</IconButton>
            </div>
            {replaceOpen && (
              <div className="make-replace" data-testid="make-replace">
                <input type="text" className="make-search-input" aria-label="Заменить на" placeholder="Заменить на…" value={replacement} onChange={(e) => setReplacement(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runReplace() } }} />
                <Button size="sm" variant="ghost" disabled={!query.trim()} loading={replacing} onClick={() => void previewReplace()}>Предпросмотр</Button>
                <Button size="sm" variant="secondary" disabled={!query.trim()} loading={replacing} onClick={() => void runReplace()}>Заменить все</Button>
              </div>
            )}
            {replaceOpen && replacePreview !== null && (
              <div className="make-matches make-replace-preview" role="region" aria-label="Предпросмотр замены" data-testid="make-replace-preview">
                <p className="make-tree-dir">{replacePreview.length === 0 ? 'Совпадений нет' : `Изменится строк: ${replacePreview.length}`}</p>
                {replacePreview.map((row, i) => (
                  <button key={`${row.path}:${row.line}:${i}`} type="button" className="make-match" onClick={() => void openFile(row.path)} title={`${row.path}:${row.line}`}>
                    <span className="make-match-path">{row.path}<span className="make-match-line">:{row.line}</span></span>
                    <code className="make-match-text make-match-text--before">{row.before}</code>
                    <code className="make-match-text make-match-text--after">{row.after}</code>
                  </button>
                ))}
              </div>
            )}
            {matches !== null && (
              <div className="make-matches" role="region" aria-label="Результаты поиска" data-testid="make-matches">
                <p className="make-tree-dir">{matches.length === 0 ? 'Ничего не найдено' : `Найдено: ${matches.length}`}</p>
                {matches.map((m, i) => (
                  <button key={`${m.path}:${m.line}:${i}`} type="button" className="make-match" onClick={() => void openFile(m.path)} title={`${m.path}:${m.line}`}>
                    <span className="make-match-path">{m.path}<span className="make-match-line">:{m.line}</span></span>
                    <code className="make-match-text">{m.text}</code>
                  </button>
                ))}
              </div>
            )}
            {picked.paths.length > 0 && (
              <div className="make-bulk" role="toolbar" aria-label="Действия с выбранными файлами" data-testid="make-bulk">
                <span className="make-bulk-count">Выбрано: {picked.paths.length}</span>
                <Button size="sm" variant="secondary" onClick={bulkMove}>В папку…</Button>
                <Button size="sm" variant="danger" onClick={() => void bulkDelete()}>Удалить</Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked(EMPTY_MAKE_SELECTION)}>Снять</Button>
              </div>
            )}
            {dropActive && <p className="make-drop-hint" role="status">Отпустите, чтобы загрузить файлы в проект</p>}
            {groups.length === 0 && <EmptyState title="Файлов пока нет" description="Создайте файл, перетащите его сюда или попросите ассистента." />}
            {groups.map((group) => ({ ...group, files: group.files.filter((f) => !query.trim() || f.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })).filter((g) => g.files.length > 0).map((group) => (
              <div className={dropDir === group.dir && dragPath ? 'make-tree-group make-tree-group--drop' : 'make-tree-group'} key={group.dir || '/'} data-dir={group.dir}>
                {group.dir && <p className="make-tree-dir">📁 {group.dir}</p>}
                {group.files.map((file) => (
                  <div key={file.path} className={`make-tree-item${file.path === selectedPath ? ' on' : ''}${picked.paths.includes(file.path) ? ' make-tree-item--picked' : ''}${dragPath === file.path ? ' make-tree-item--drag' : ''}`} onPointerDown={(e) => beginFileDrag(e, file.path)}>
                    <button type="button" className="make-tree-file" aria-selected={picked.paths.includes(file.path) || undefined} onClick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) { e.preventDefault(); setPicked((sel) => toggleMakeSelection(sel, file.path, treeOrder, e.shiftKey ? 'range' : 'toggle')); return } void openFile(file.path) }} title={`${file.path} · ${formatSize(file.size)} · Ctrl/Shift-клик — выбрать несколько`}>
                      {group.dir ? file.path.slice(group.dir.length + 1) : file.path}
                    </button>
                    <span className="make-tree-actions">
                      <IconButton size="sm" aria-label={`Переименовать ${file.path}`} title="Переименовать" onClick={() => renameFile(file.path)}>✎</IconButton>
                      <IconButton size="sm" aria-label={`Удалить ${file.path}`} title="Удалить" onClick={() => void deleteFile(file.path)}>✕</IconButton>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </nav>
          <div className="make-editor">
            {lockedBy && (
              <div className="make-lock" role="status" data-testid="make-lock">🔒 Файл сейчас правится в другой вкладке ({lockedBy.user}) — здесь он только для чтения, чтобы автосохранение не затёрло правки.</div>
            )}
            {changedLines.length > 0 && <div className="make-changed-note" role="status">Подсвечены строки, изменённые ассистентом ({changedLines.length}) <button type="button" className="make-link" onClick={() => setChangedLines([])}>скрыть</button></div>}
            {isPhone && state && (
              <div className="make-file-picker">
                <select aria-label="Файл проекта" value={selectedPath ?? ''} onChange={(e) => { if (e.target.value) void openFile(e.target.value) }}>
                  {!selectedPath && <option value="">Выберите файл…</option>}
                  {state.files.filter((f) => isMakeTextPath(f.path)).map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
                </select>
                <Button size="sm" variant="secondary" onClick={createFile}>+ Файл</Button>
              </div>
            )}
            {issues !== null && (
              <div className={issues.some((i) => i.severity !== 'warning') ? 'make-issues make-issues--bad' : issues.length ? 'make-issues make-issues--warn' : 'make-issues'} role="status" data-testid="make-issues">
                {issues.length === 0 ? <span>✓ Проверка пройдена: index.html есть, ссылки на файлы проекта разрешаются.</span> : (
                  <>
                    {issues.every((i) => i.severity === 'warning') && <span>✓ Ошибок нет; замечания линтера ({issues.length}):</span>}
                    <ul>{issues.map((issue, i) => <li key={i} className={issue.severity === 'warning' ? 'make-issue--warn' : undefined}>{issue.severity === 'warning' ? '⚠ ' : ''}<button type="button" className="make-issue-path" onClick={() => void openFile(issue.path)}>{issue.path}{issue.line ? `:${issue.line}` : ''}</button> — {issue.message}{issue.rule ? <span className="make-issue-rule"> {issue.rule}</span> : null}</li>)}</ul>
                  </>
                )}
                <IconButton size="sm" aria-label="Скрыть результат проверки" title="Скрыть" onClick={() => setIssues(null)}>✕</IconButton>
              </div>
            )}
            {tabs.length > 0 && (
              <div className="make-tabs-bar" role="tablist" aria-label="Открытые файлы">
                {tabs.map((t) => (
                  <div key={t} className={`make-file-tab${t === selectedPath ? ' on' : ''}${t === flashPath ? ' make-file-tab--flash' : ''}`} data-testid={t === flashPath ? 'make-file-tab-flash' : undefined}>
                    <button type="button" role="tab" aria-selected={t === selectedPath} className="make-file-tab-name" onClick={() => void openFile(t)} title={t}>
                      {t.slice(t.lastIndexOf('/') + 1)}{t === selectedPath && dirty ? <span className="make-file-tab-dirty" aria-label="не сохранено">●</span> : null}
                    </button>
                    <IconButton size="sm" aria-label={`Закрыть ${t}`} title="Закрыть" onClick={() => closeTab(t)}>✕</IconButton>
                  </div>
                ))}
              </div>
            )}
            {selectedPath && !isMakeTextPath(selectedPath) ? (
              <>
                <div className="make-editor-head">
                  <code>{selectedPath}</code>
                  <span className="make-editor-state">{formatSize(state?.files.find((f) => f.path === selectedPath)?.size ?? 0)} · бинарный файл</span>
                </div>
                <div className="make-binary" data-testid="make-binary">
                  {/\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i.test(selectedPath)
                    ? <img src={`${base}${selectedPath}?rev=${previewRev}`} alt={`Просмотр ${selectedPath}`} />
                    : <EmptyState title="Файл не текстовый" description="Его нельзя править в редакторе, но он доступен в превью и в ZIP." />}
                  <code className="make-binary-ref">{selectedPath}</code>
                </div>
              </>
            ) : selectedPath ? (
              <>
                <div className="make-editor-head">
                  <code>{selectedPath}</code>
                  <span className="make-editor-tools">
                    <label className="make-autosave"><input type="checkbox" checked={autosave} onChange={toggleAutosave} /> автосохранение</label>
                    {mockTable && (
                      <span className="make-mock-view" role="group" aria-label="Вид мока">
                        <button type="button" className={mockView === 'table' ? 'make-tab on' : 'make-tab'} aria-pressed={mockView === 'table'} onClick={() => setMockView('table')}>Таблица</button>
                        <button type="button" className={mockView === 'json' ? 'make-tab on' : 'make-tab'} aria-pressed={mockView === 'json'} onClick={() => setMockView('json')}>JSON</button>
                      </span>
                    )}
                    <label className="make-autosave" title="Prettier перед сохранением по Cmd/Ctrl+S"><input type="checkbox" checked={formatOnSave} onChange={toggleFormatOnSave} /> формат при сохранении</label>
                    <Button size="sm" variant="ghost" loading={formatting} onClick={() => void formatNow()} title="Prettier (Shift+Alt+F в редакторе)">Форматировать</Button>
                    <Button size="sm" variant="ghost" aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)} title="Последние сохранённые версии этого файла в браузере">Версии</Button>
                    {onAskAssistant && <Button size="sm" variant="ghost" onClick={openInline} title="Cmd/Ctrl+I в редакторе: попросить ассистента изменить выделенное">✨ Правка ИИ{selection ? ` (${selection.endLine - selection.startLine + 1} стр.)` : ''}</Button>}
                    <span className={dirty ? 'make-editor-state dirty' : 'make-editor-state'}>{dirty ? 'не сохранено' : 'сохранено'}</span>
                  </span>
                </div>
                {historyOpen && (
                  <div className="make-local-history" data-testid="make-local-history">
                    {localVersions.length === 0
                      ? <span className="make-diff-note">Локальных версий пока нет — они появляются после сохранений в этом браузере.</span>
                      : localVersions.map((v, i) => (
                        <button key={v.at + ':' + i} type="button" className="make-local-version" onClick={() => restoreLocal(v)} title={v.content.slice(0, 200)}>
                          <span>{formatTime(v.at)}</span><small>{v.content.length} симв.</small>
                        </button>
                      ))}
                  </div>
                )}
                {inlineOpen && (
                  <div className="make-inline" data-testid="make-inline" role="dialog" aria-label="Правка выделенного ассистентом">
                    <span className="make-inline-scope">{selection ? `Строки ${selection.startLine}–${selection.endLine}` : 'Весь файл'}</span>
                    <input ref={inlineInputRef} type="text" aria-label="Что сделать с фрагментом" placeholder="Например: вынеси в отдельную функцию и добавь типы" value={inlineText} onChange={(e) => setInlineText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendInline() } if (e.key === 'Escape') setInlineOpen(false) }} />
                    <Button size="sm" variant="primary" disabled={!inlineText.trim()} onClick={sendInline}>Отправить</Button>
                    <IconButton size="sm" aria-label="Закрыть правку ИИ" title="Закрыть" onClick={() => setInlineOpen(false)}>✕</IconButton>
                  </div>
                )}
                {mockTable && mockView === 'table' ? (
                  <MakeMockTable path={selectedPath} value={content} onChange={(v) => setContent(v)} readOnly={Boolean(lockedBy)} />
                ) : (
                <CodeEditor path={selectedPath} value={content} onChange={(v) => { setContent(v); if (changedLines.length) setChangedLines([]) }} onSave={() => void save()} ariaLabel={`Содержимое ${selectedPath}`} markers={markers} projectFiles={projectFiles} onSelectionChange={setSelection} onInlineCommand={openInline} readOnly={Boolean(lockedBy)} changedLines={changedLines} />
                )}
              </>
            ) : (
              <EmptyState title="Выберите файл" description="Слева — файлы проекта. Правки сохраняются кнопкой или Ctrl/Cmd+S и сразу видны в превью." />
            )}
          </div>
          {split && !isPhone && (
            <>
              <div className="make-split-handle" role="separator" aria-label="Граница код/превью" aria-orientation="vertical" aria-valuenow={splitPct} onPointerDown={beginSplitDrag} />
              <div className="make-split-preview" data-testid="make-split-preview">
                <iframe key={previewRev} className="make-frame" title="Превью рядом" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups" src={previewSrc} />
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'stories' && (
        <div className="make-stories" data-testid="make-stories">
          <nav className="make-tree make-stories-list" aria-label="Компоненты и стори">
            {storyFiles === null && <p className="make-tree-dir">Загружаю…</p>}
            {storyFiles !== null && storyFiles.length === 0 && (
              <EmptyState
                title="Сториз пока нет"
                description="Добавьте рядом с компонентом файл <Имя>.stories.jsx (CSF: default { title, component, args } и именованные экспорты) или начните с шаблона «React-приложение + Storybook»."
                actionLabel="Шаблоны"
                onAction={() => setTemplatesOpen(true)}
              />
            )}
            {storyFiles?.map((file) => (
              <div className="make-tree-group" key={file.path}>
                <p className="make-tree-dir" title={file.path}>▣ {file.title}</p>
                {file.stories.map((name) => {
                  const on = story?.file === file.path && story.name === name
                  return (
                    <div className={on ? 'make-tree-item on' : 'make-tree-item'} key={name}>
                      <button type="button" className="make-tree-file" aria-current={on ? 'true' : undefined} onClick={() => setStory({ file: file.path, name })}>
                        {name}
                        {(() => { const r = playResults[`${file.path}::${name}`]; const has = file.withPlay?.includes(name); if (!has && !r) return null; return <span className={`make-play make-play--${r?.status ?? 'pending'}`} title={r ? (r.status === 'passed' ? `play прошёл за ${r.ms} мс` : `play упал: ${r.error ?? ''}`) : 'есть play-функция — запустится при открытии'}>{r ? (r.status === 'passed' ? '✓' : '✗') : '▷'}</span> })()}
                      </button>
                    </div>
                  )
                })}
                <div className="make-tree-item">
                  <button type="button" className="make-tree-file make-tree-file--dim" onClick={() => { void openFile(file.path); setMode('code') }}>✎ открыть сториз</button>
                </div>
              </div>
            ))}
            {storyFiles !== null && orphanComponents.length > 0 && (
              <div className="make-tree-group" data-testid="make-orphans">
                <p className="make-tree-dir" title="Компоненты, у которых ещё нет файла сториз">▢ Без сториз</p>
                {orphanComponents.map((path) => (
                  <div className="make-tree-item" key={path}>
                    <button type="button" className="make-tree-file make-tree-file--dim" onClick={() => void generateStories(path)} title={`Создать ${path.replace(/\.(tsx|jsx)$/i, '.stories.tsx')} по пропсам компонента`}>+ сториз для {path.slice(path.lastIndexOf('/') + 1)}</button>
                  </div>
                ))}
              </div>
            )}
          </nav>
          <div className="make-story-host">
            {runningTests && previewReady && <iframe key={runningTests} className="make-tests-frame" title={`Тесты ${runningTests}`} sandbox="allow-scripts allow-same-origin" src={`${base}__tests__?file=${encodeURIComponent(runningTests)}&rev=${previewRev}`} aria-hidden="true" />}
            {testsOpen && (
              <section className="make-tests" aria-label="Результаты тестов" data-testid="make-tests">
                <div className="make-tests-head">
                  <strong>Тесты компонентов</strong>
                  {runningTests && <small>выполняется {runningTests}…</small>}
                  <span className="make-head-spacer" />
                  {failedTests.length > 0 && (onAskAssistant || onInsertToChat) && <Button size="sm" variant="primary" onClick={() => (onAskAssistant ?? onInsertToChat)!(testsPrompt())}>Исправить</Button>}
                  <IconButton size="sm" aria-label="Закрыть результаты тестов" title="Закрыть" onClick={() => setTestsOpen(false)}>✕</IconButton>
                </div>
                <ul role="list">
                  {testFiles.map((f) => (
                    <li key={f.path} className="make-tests-file">
                      <div className="make-tests-file-head"><code>{f.path}</code><Button size="sm" variant="ghost" onClick={() => runTests([f.path])} disabled={Boolean(runningTests)}>Запустить</Button></div>
                      <ul role="list">
                        {(testResults[f.path] ?? f.names.map((n) => ({ name: n, status: 'pending' as const, ms: 0, error: undefined as string | undefined }))).map((r, i) => (
                          <li key={`${r.name}-${i}`} className={`make-test make-test--${r.status}`}>
                            <span>{r.status === 'passed' ? '✓' : r.status === 'failed' ? '✗' : '·'} {r.name}</span>{r.status !== 'pending' && <small>{r.ms} мс</small>}
                            {r.error && <pre>{r.error}</pre>}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {story && previewReady ? (
              <iframe
                ref={storyFrameRef}
                key={`${story.file}:${story.name}:${previewRev}`}
                className="make-story-frame"
                title={`Стори ${story.name}`}
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
                src={`${base}__stories__?file=${encodeURIComponent(story.file)}&story=${encodeURIComponent(story.name)}&rev=${previewRev}`}
              />
            ) : storyFiles && storyFiles.length > 0 ? (
              <EmptyState title="Выберите стори" description="Слева — компоненты проекта и их состояния." />
            ) : null}
            {story && playResults[`${story.file}::${story.name}`]?.status === 'failed' && (
              <div className="make-autofix" role="alert" data-testid="make-play-failed">
                <span>play-функция упала: <code>{playResults[`${story.file}::${story.name}`]!.error}</code></span>
                <span className="make-autofix-actions">
                  {(onAskAssistant || onInsertToChat) && <Button size="sm" variant="primary" onClick={() => (onAskAssistant ?? onInsertToChat)!(`В стори «${story.name}» (${story.file}) упала play-функция: ${playResults[`${story.file}::${story.name}`]!.error}. Найди причину (компонент или сам тест) и исправь. `)}>Исправить</Button>}
                </span>
              </div>
            )}
            {story && shotsOpen && storyShots.length > 0 && (
              <section className="make-shots" aria-label="Снимки стори" data-testid="make-shots">
                <div className="make-shots-strip">
                  {storyShots.map((s) => (
                    <button key={s.id} type="button" className={`make-shot${compare?.includes(s.id) ? ' on' : ''}`} title={`${formatTime(s.at)} · rev ${s.rev}`}
                      onClick={() => setCompare((c) => (!c ? [s.id, s.id] : c[0] === s.id ? null : [c[0] === c[1] ? c[0] : c[1], s.id]))}>
                      <img src={REST.makeShotImage(conversationId, s.id)} alt={`Снимок ${formatTime(s.at)}`} />
                      <small>{formatTime(s.at)}</small>
                    </button>
                  ))}
                  <span className="make-shots-hint">Клик — выбрать «до», второй клик — «после».</span>
                </div>
                {compare && compare[0] !== compare[1] && (
                  <div className="make-shots-compare" data-testid="make-shots-compare">
                    <figure><img src={REST.makeShotImage(conversationId, compare[0])} alt="До" /><figcaption>до</figcaption></figure>
                    <figure><img src={REST.makeShotImage(conversationId, compare[1])} alt="После" /><figcaption>после</figcaption></figure>
                    {shotDiff && (
                      <figure data-testid="make-shots-diff"><img src={shotDiff.url} alt="Карта различий" /><figcaption className={shotDiff.mismatch > 0.005 ? 'make-shots-diff--bad' : 'make-shots-diff--ok'}>{shotDiff.mismatch === 0 ? 'различий нет' : `отличается ${(shotDiff.mismatch * 100).toFixed(2)}% пикселей`}</figcaption></figure>
                    )}
                  </div>
                )}
              </section>
            )}
            {story && storyArgs && (
              <section className="make-controls" aria-label="Controls: args стори" data-testid="make-controls">
                <div className="make-controls-head">
                  <strong>Controls</strong>
                  <span className="make-controls-actions">
                    {Object.keys(argOverrides).length > 0 && <Button size="sm" variant="ghost" onClick={resetArgs}>Сбросить</Button>}
                    {onInsertToChat && Object.keys(argOverrides).length > 0 && <Button size="sm" variant="secondary" onClick={sendArgsToChat}>Сохранить через ассистента</Button>}
                  </span>
                </div>
                {Object.keys(storyArgs).length === 0 ? (
                  <p className="make-controls-empty">У стори нет args — добавьте их в default-экспорт или в саму стори.</p>
                ) : (
                  <div className="make-controls-grid">
                    {Object.entries(storyArgs).map(([key, base]) => (
                      <MakeControlField key={key} name={key} base={base} value={key in argOverrides ? argOverrides[key] : base} argType={argTypes[key]} enumOptions={argOptions[key]} onChange={(v) => setArg(key, v)} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}

      {mode === 'history' && (
        <div className="make-history">
          {(state?.snapshots.length ?? 0) === 0 ? (
            <EmptyState title="Снимков пока нет" description="Ассистент сохраняет снимок перед каждой правкой; свой снимок — кнопкой «+ Снимок»." />
          ) : (
            <ul className="make-snapshots" aria-label="Снимки проекта">
              {state!.snapshots.map((snap) => (
                <li key={snap.id} className="make-snapshot">
                  <span className="make-snapshot-meta">
                    <strong>{snap.label}</strong>
                    <small>{formatTime(snap.createdAt)} · файлов: {snap.files}</small>
                  </span>
                  <span className="make-snapshot-actions">
                    <Button size="sm" variant="ghost" onClick={() => void loadDiff(snap.id)} aria-expanded={Boolean(diffs[snap.id])}>{diffs[snap.id] ? 'Скрыть' : 'Сравнить'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => void restoreSnapshot(snap.id, snap.label)}>Вернуть</Button>
                    <Button size="sm" variant="ghost" onClick={() => void publish(snap.id)} title="Публичная ссылка будет отдавать именно эту версию">{state?.published?.snapshotId === snap.id ? 'Опубликована' : 'Опубликовать версию'}</Button>
                  </span>
                  {diffs[snap.id] === 'loading' && <p className="make-diff-note">Сравниваю…</p>}
                  {diffs[snap.id] && diffs[snap.id] !== 'loading' && (
                    <ul className="make-diff" aria-label={`Отличия от снимка ${snap.label}`} data-testid="make-diff">
                      {(diffs[snap.id] as MakeSnapshotDiff).files.filter((f) => f.status !== 'same').length === 0 && <li className="make-diff-note">Файлы совпадают с текущими.</li>}
                      {(diffs[snap.id] as MakeSnapshotDiff).files.filter((f) => f.status !== 'same').map((f) => (
                        <li key={f.path} className={`make-diff-row make-diff-row--${f.status}`}>
                          <span className="make-diff-status">{f.status === 'added' ? 'новый' : f.status === 'removed' ? 'удалён' : 'изменён'}</span>
                          {isMakeTextPath(f.path)
                            ? <button type="button" className="make-diff-file" onClick={() => void openFileDiff(snap.id, snap.label, f.path)} title="Показать сравнение"><code>{f.path}</code></button>
                            : <code>{f.path}</code>}
                          <small>{f.before !== null ? formatSize(f.before) : '—'} → {f.after !== null ? formatSize(f.after) : '—'}</small>
                          {f.status !== 'added' && <Button size="sm" variant="ghost" onClick={() => void restoreFile(snap.id, f.path)}>Вернуть файл</Button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="make-history-foot">
            <Button size="sm" variant="danger" onClick={() => void resetProject()}>Сбросить проект</Button>
          </div>
        </div>
      )}

      {fileDiff && (
        <Dialog className="make-dialog" padded title={`Сравнение: ${fileDiff.path}`} ariaLabel={`Сравнение ${fileDiff.path}`} size="lg" onClose={() => setFileDiff(null)} testId="make-file-diff"
          actions={<Button size="sm" variant="secondary" onClick={() => { void restoreFile(fileDiff.snapshotId, fileDiff.path); setFileDiff(null) }}>Вернуть файл из снимка</Button>}>
          <p className="make-ideas-lead">Слева — снимок «{fileDiff.label}», справа — текущая версия.</p>
          <CodeDiff path={fileDiff.path} original={fileDiff.original} modified={fileDiff.modified} />
        </Dialog>
      )}
      {libraryOpen && (
        <Dialog className="make-dialog" padded title="Библиотека компонентов" ariaLabel="Библиотека компонентов" size="md" onClose={() => setLibraryOpen(false)} testId="make-library">
          <p className="make-ideas-lead">Компоненты, сохранённые из ваших проектов. «Вставить» копирует файлы в текущий проект (снимок сохраняется); у кита файл токенов не затирает ваш — добавляются только недостающие переменные.</p>
          {kitPaths().length > 0 && <div className="make-ask-actions make-kit-actions"><Button size="sm" variant="secondary" onClick={() => void exportKitToLibrary()} title="Все компоненты со сториз и файл токенов — одним элементом библиотеки">Сохранить весь кит ({kitPaths().length} файл.)</Button></div>}
          {library === null ? <p className="make-diff-note">Загружаю…</p> : library.length === 0 ? (
            <EmptyState title="Библиотека пуста" description="Откройте стори во вкладке «Компоненты» и нажмите «В библиотеку»." />
          ) : (
            <ul className="make-assets" aria-label="Компоненты библиотеки">
              {library.map((item) => (
                <li key={item.slug} className="make-asset make-library-item">
                  <div className="make-asset-meta">
                    <strong>{item.name}{item.files.some((p) => p === 'tokens.css' || p === 'styles.css') && <span className="make-kit-badge" title="Содержит файл токенов">кит</span>}</strong>
                    <small>{item.files.join(', ')} · {formatSize(item.bytes)} · {formatTime(item.updatedAt)}</small>
                  </div>
                  <span className="make-asset-actions">
                    <Button size="sm" variant="primary" onClick={() => void insertFromLibrary(item)}>Вставить</Button>
                    <IconButton size="sm" aria-label={`Удалить ${item.name} из библиотеки`} title="Удалить из библиотеки" onClick={() => void removeFromLibrary(item)}>✕</IconButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
      {notesOpen && <MakeNotesDialog conversationId={conversationId} api={api} onClose={() => setNotesOpen(false)} />}
      {taskLinksOpen && <MakeTaskLinksDialog conversationId={conversationId} currentPath={selectedPath ?? ''} api={api} onOpenTask={onOpenTask} onClose={() => setTaskLinksOpen(false)} />}
      {projectSyncOpen && <MakeProjectSyncDialog conversationId={conversationId} api={api} onClose={() => setProjectSyncOpen(false)} />}
      {usageOpen && <MakeUsageDialog conversationId={conversationId} api={api} onClose={() => setUsageOpen(false)} onChanged={(next) => { setState(next); setPreviewRev(next.rev) }} />}
      {diffOpen && turnDiff && (
        <Dialog className="make-dialog" padded title="До и после" ariaLabel="До и после" size="lg" onClose={() => setDiffOpen(false)} testId="make-turn-diff-dialog">
          <div className="make-turn-diff-big">
            <figure><img src={turnDiff.before} alt="Превью до правок" /><figcaption>До</figcaption></figure>
            <figure><img src={turnDiff.after} alt="Превью после правок" /><figcaption>После</figcaption></figure>
          </div>
        </Dialog>
      )}
      {tokensOpen && state && <MakeTokensDialog conversationId={conversationId} api={api} files={state.files.map((f) => f.path)} onClose={() => setTokensOpen(false)} onWritten={(next) => { setState(next); setPreviewRev(next.rev) }} />}
      {assetsOpen && (
        <Dialog className="make-dialog" padded title="Ассеты проекта" ariaLabel="Ассеты проекта" size="md" onClose={() => setAssetsOpen(false)} testId="make-assets">
          <p className="make-ideas-lead">Картинки и другие бинарные файлы проекта. Путь или тег вставляются в буфер — дальше в код или в просьбу ассистенту.</p>
          {assets.length === 0 ? (
            <EmptyState title="Ассетов пока нет" description="Загрузите картинки кнопкой «Загрузить» или перетащите их в дерево файлов." actionLabel="Загрузить" onAction={() => { setAssetsOpen(false); uploadInputRef.current?.click() }} />
          ) : (
            <ul className="make-assets" aria-label="Список ассетов">
              {assets.map((f) => (
                <li key={f.path} className="make-asset">
                  <div className="make-asset-thumb">
                    {/\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i.test(f.path) ? <img src={`${base}${f.path}?rev=${previewRev}`} alt="" /> : <span>{f.path.split('.').pop()?.toUpperCase()}</span>}
                  </div>
                  <div className="make-asset-meta">
                    <code title={f.path}>{f.path}</code>
                    <small>{formatSize(f.size)}</small>
                  </div>
                  <span className="make-asset-actions">
                    <Button size="sm" variant="ghost" onClick={() => void copyAsset(f.path, 'Путь')}>Путь</Button>
                    <Button size="sm" variant="ghost" onClick={() => void copyAsset(`<img src="${f.path}" alt="">`, 'Тег')}>&lt;img&gt;</Button>
                    <IconButton size="sm" aria-label={`Удалить ${f.path}`} title="Удалить" onClick={() => void deleteFile(f.path)}>✕</IconButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
      {versionCompare && (
        <Dialog className="make-dialog make-version-dialog" padded title="Сравнение версий публикации" ariaLabel="Сравнение версий публикации" size="lg" onClose={() => { setVersionCompare(null); setVersionDiff(null) }} testId="make-version-compare"
          footer={<><Button size="sm" variant="secondary" onClick={() => void computeVersionDiff()}>Карта различий</Button>{versionDiff && <span className={versionDiff.mismatch > 0.005 ? 'make-shots-diff--bad' : 'make-shots-diff--ok'}>{versionDiff.mismatch === 0 ? 'различий нет' : `отличается ${(versionDiff.mismatch * 100).toFixed(2)}% пикселей`}</span>}</>}>
          <div className="make-version-grid">
            <figure><figcaption>Снимок «{state?.snapshots.find((s) => s.id === versionCompare)?.label ?? versionCompare}»</figcaption><iframe ref={(el) => { versionFrames.current.a = el }} title="Версия из истории" sandbox="allow-scripts allow-same-origin" src={`${base}${MAKE_SNAPSHOT_PREVIEW}/${encodeURIComponent(versionCompare)}/index.html`} /></figure>
            <figure><figcaption>Текущее состояние</figcaption><iframe ref={(el) => { versionFrames.current.b = el }} title="Текущая версия" sandbox="allow-scripts allow-same-origin" src={previewSrc} /></figure>
            {versionDiff && <figure data-testid="make-version-diff"><figcaption>Карта различий</figcaption><img src={versionDiff.url} alt="Карта различий версий" /></figure>}
          </div>
        </Dialog>
      )}
      {exportOpen && (
        <Dialog className="make-dialog" padded title="Скачать проект" ariaLabel="Скачать проект" size="sm" onClose={() => setExportOpen(false)} testId="make-export">
          <div className="make-export-options">
            <button type="button" className="make-idea" onClick={() => { window.open(exportUrl(false), '_blank', 'noopener'); setExportOpen(false) }}>
              <strong>Статика как есть</strong>
              <span>ZIP с файлами проекта — открывается двойным кликом по index.html или кладётся на любой хостинг.</span>
            </button>
            <button type="button" className="make-idea" onClick={() => { window.open(exportUrl(true), '_blank', 'noopener'); setExportOpen(false) }}>
              <strong>Vite-проект</strong>
              <span>Плюс package.json, vite.config и README: распаковать, <code>npm install</code>, <code>npm run dev</code> — и продолжать в своём редакторе.</span>
            </button>
          </div>
          <label className="make-export-pwa">Хостинг: <select aria-label="Хостинг для экспорта" value={exportDeploy} onChange={(e) => setExportDeploy(e.target.value as MakeDeployTarget | '')}><option value="">без конфига</option>{MAKE_DEPLOY_TARGETS.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select> <small>— в архив добавятся конфиг и DEPLOY.md</small></label>
          <label className="make-export-pwa"><input type="checkbox" checked={exportPwa} onChange={(e) => setExportPwa(e.target.checked)} /> Добавить PWA: манифест, service worker и иконку — сайт можно «установить» на телефон и открывать офлайн</label>
        </Dialog>
      )}
      {importOpen && (
        <Dialog className="make-dialog" padded title="Импорт проекта" ariaLabel="Импорт проекта" size="sm" onClose={() => setImportOpen(false)} testId="make-import" closeOnOverlay={false}>
          <p className="make-ideas-lead">Перед импортом сохранится снимок — откатиться можно во вкладке «История».</p>
          <fieldset className="make-import-mode">
            <legend>Как применить</legend>
            <label><input type="radio" name="make-import-mode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /> заменить проект</label>
            <label><input type="radio" name="make-import-mode" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} /> добавить к текущим файлам</label>
          </fieldset>
          <section className="make-import-block">
            <h3>ZIP-архив</h3>
            <p>Файлы проекта в корне архива или в одной общей папке; до 400 файлов по 2 МБ.</p>
            <input ref={importZipRef} type="file" accept=".zip,application/zip" aria-label="ZIP-архив проекта" data-testid="make-import-zip" disabled={importing} onChange={(e) => { const f = e.target.files?.[0]; if (f) void runImport('zip', f) }} />
          </section>
          <section className="make-import-block">
            <h3>Страница по адресу</h3>
            <p>Скачаем HTML и её стили/скрипты/картинки с того же домена — как стартовую точку для редизайна.</p>
            <div className="make-import-url">
              <input type="url" aria-label="Адрес страницы" placeholder="https://example.com/ или https://github.com/user/repo" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runImport('url') }} disabled={importing} />
              <Button size="sm" variant="primary" onClick={() => void runImport('url')} loading={importing} disabled={!importUrl.trim()}>Импортировать</Button>
            </div>
          </section>
        </Dialog>
      )}
      {ideasOpen && (
        <Dialog className="make-dialog" padded title="Идеи для старта" ariaLabel="Идеи для старта" size="md" onClose={() => setIdeasOpen(false)} testId="make-ideas">
          <p className="make-ideas-lead">Готовые промпты в духе Figma Make: клик вставляет текст в композер, дальше можно отредактировать и отправить.</p>
          {(Object.keys(MAKE_STARTER_GROUPS) as Array<keyof typeof MAKE_STARTER_GROUPS>).map((group) => (
            <section key={group} className="make-ideas-group">
              <h3>{MAKE_STARTER_GROUPS[group]}</h3>
              {MAKE_STARTER_PROMPTS.filter((i) => i.group === group).map((item) => (
                <button key={item.id} type="button" className="make-idea" onClick={() => useStarter(item.prompt)}>
                  <strong>{item.title}</strong>
                  <span>{item.prompt}</span>
                </button>
              ))}
            </section>
          ))}
        </Dialog>
      )}
      {publishOpen && (
        <Dialog className="make-dialog" padded title="Публикация проекта" ariaLabel="Публикация проекта" size="sm" onClose={() => setPublishOpen(false)} testId="make-publish">
          {state?.published ? (
            <div className="make-publish">
              <p className="fsub">Ссылка открывается без входа — у всех, кто её знает.{' '}
                {state.published.snapshotId
                  ? <>Закреплена версия <strong>«{state.published.snapshotLabel}»</strong> — правки не видны, пока публикацию не обновить.</>
                  : <>Файлы отдаются текущие: изменения видны сразу.</>}
              </p>
              <div className="make-publish-link">
                <code data-testid="make-public-url">{typeof window !== 'undefined' ? new URL(state.published.slugUrl ?? state.published.url, window.location.origin).toString() : (state.published.slugUrl ?? state.published.url)}</code>
                <Button size="sm" variant="secondary" onClick={() => void copyPublicLink()}>Копировать</Button>
                <Button size="sm" variant="ghost" onClick={() => window.open(state.published!.url, '_blank', 'noopener')}>Открыть</Button>
              </div>
              <div className="make-publish-pin">
                <label htmlFor="make-publish-pick">Что публиковать</label>
                <select id="make-publish-pick" value={publishPick || (state.published.snapshotId ?? '')} onChange={(e) => setPublishPick(e.target.value)}>
                  <option value="">Текущее состояние (обновляется сразу)</option>
                  {state.snapshots.map((s) => <option key={s.id} value={s.id}>Снимок: {s.label} · {formatTime(s.createdAt)}</option>)}
                </select>
              </div>
              <div className="make-publish-access">
                <label className="make-ask-field"><span>Адрес <small>/s/…/ — латиница, цифры, дефис</small></span><input className="tin" aria-label="Адрес публикации" placeholder="my-site" value={publishSlug ?? state.published.slug ?? ''} onChange={(e) => setPublishSlug(e.target.value.toLowerCase())} /></label>
                <label className="make-ask-field"><span>Пароль {state.published.passwordProtected ? <small>установлен</small> : <small>нет — открыто по ссылке</small>}</span><input className="tin" type="password" aria-label="Пароль публикации" placeholder={state.published.passwordProtected ? 'новый пароль' : 'без пароля'} value={publishPassword} onChange={(e) => setPublishPassword(e.target.value)} autoComplete="new-password" /></label>
                <p className="fsub make-publish-views">Просмотров: <strong data-testid="make-public-views">{state.published.views ?? 0}</strong></p>
                {(state.published.stats?.days.length ?? 0) > 0 && (
                  <div className="make-publish-stats" data-testid="make-publish-stats">
                    <div className="make-publish-bars" role="img" aria-label={`Просмотры за последние ${Math.min(14, state.published.stats!.days.length)} дней`}>
                      {state.published.stats!.days.slice(-14).map((d) => { const max = Math.max(...state.published!.stats!.days.slice(-14).map((x) => x.views), 1); return <span key={d.day} className="make-publish-bar" style={{ height: `${Math.max(8, Math.round((d.views / max) * 100))}%` }} title={`${d.day}: ${d.views}`} /> })}
                    </div>
                    {state.published.stats!.referers.length > 0 && <p className="fsub">Откуда приходят: {state.published.stats!.referers.slice(0, 5).map((r) => `${r.host} (${r.views})`).join(', ')}</p>}
                  </div>
                )}
              </div>
              {(state.published.history?.length ?? 0) > 1 && (
                <details className="make-publish-history" data-testid="make-publish-history">
                  <summary>История публикаций ({state.published.history!.length})</summary>
                  <ul role="list">
                    {[...state.published.history!].reverse().map((e, i) => (
                      <li key={`${e.at}-${i}`}>
                        <span>{formatTime(e.at)} · {e.snapshotId ? `снимок «${e.snapshotLabel}»` : 'текущее состояние'}</span>
                        {i === 0 ? <small>сейчас</small> : (e.snapshotId === null || state.snapshots.some((s) => s.id === e.snapshotId))
                          ? <><Button size="sm" variant="ghost" onClick={() => void publish(e.snapshotId, publishOptions())}>Вернуть</Button>{e.snapshotId && <Button size="sm" variant="ghost" onClick={() => setVersionCompare(e.snapshotId!)} title="Открыть эту версию и текущую рядом, с картой различий">Сравнить</Button>}</>
                          : <small>снимок удалён</small>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="make-ask-actions">
                <Button size="sm" variant="secondary" onClick={() => void publish((publishPick || state.published?.snapshotId) || null, publishOptions())}>Обновить публикацию</Button>
                {state.published.passwordProtected && <Button size="sm" variant="ghost" onClick={() => void publish((publishPick || state.published?.snapshotId) || null, { password: null })}>Снять пароль</Button>}
                <label className="make-autosave" title="На странице публикации появится кнопка «Комментарий»; сообщения зрителей попадают в модерацию в панели комментариев"><input type="checkbox" aria-label="Комментарии зрителей" checked={Boolean(state.published.allowComments)} onChange={(e) => void publish((publishPick || state.published?.snapshotId) || null, { allowComments: e.target.checked })} /> комментарии зрителей</label>
              </div>
              <div className="make-ask-actions"><Button size="sm" variant="danger" onClick={() => void unpublish()}>Снять с публикации</Button></div>
            </div>
          ) : (
            <div className="make-publish">
              <p className="fsub">Проект получит непубличную ссылку вида <code>/p/&lt;токен&gt;/</code>: открывается без входа, поисковикам не индексируется, снять можно в любой момент.</p>
              <div className="make-ask-actions"><Button size="sm" variant="primary" onClick={() => void publish()}>Опубликовать</Button></div>
            </div>
          )}
          <div className="make-share" data-testid="make-share">
            <h4>Только чтение внутри ChatAI</h4>
            {state?.shared ? (
              <>
                <p className="fsub">Коллеги с аккаунтом ChatAI увидят превью, код и снимки, но не смогут ничего менять.</p>
                <div className="make-publish-link">
                  <code data-testid="make-share-url">{typeof window !== 'undefined' ? `${window.location.origin}/${state.shared.url}` : state.shared.url}</code>
                  <Button size="sm" variant="secondary" onClick={() => void copyShareLink(typeof window !== 'undefined' ? `${window.location.origin}/${state.shared!.url}` : state.shared!.url)}>Копировать</Button>
                  <Button size="sm" variant="ghost" onClick={() => void toggleShare()}>Отозвать</Button>
                </div>
                <div className="make-grants" data-testid="make-grants">
                  <p className="fsub">Именной доступ: редактор правит файлы и снимки на странице проекта, зритель — только смотрит. Публикация и шаринг остаются за вами.</p>
                  {(state.shared.grants ?? []).length > 0 && (
                    <ul role="list">
                      {state.shared.grants!.map((g) => (
                        <li key={g.user}><code>{g.user}</code><span>{g.role === 'editor' ? 'редактор' : 'зритель'}</span>
                          <IconButton size="sm" aria-label={`Убрать доступ ${g.user}`} title="Убрать доступ" onClick={() => void grant(g.user, null)}>✕</IconButton></li>
                      ))}
                    </ul>
                  )}
                  <form className="make-grant-add" onSubmit={(e) => { e.preventDefault(); void grant(grantUser, grantRole); setGrantUser('') }}>
                    <input className="tin" aria-label="Имя пользователя" placeholder="логин" value={grantUser} onChange={(e) => setGrantUser(e.target.value)} />
                    <select aria-label="Роль" value={grantRole} onChange={(e) => setGrantRole(e.target.value as 'editor' | 'viewer')}><option value="viewer">зритель</option><option value="editor">редактор</option></select>
                    <Button size="sm" variant="secondary" type="submit" disabled={!grantUser.trim()}>Дать доступ</Button>
                  </form>
                </div>
              </>
            ) : <div className="make-ask-actions"><Button size="sm" variant="secondary" onClick={() => void toggleShare()}>Создать ссылку для чтения</Button></div>}
          </div>
        </Dialog>
      )}

      {templatesOpen && (
        <Dialog className="make-dialog" padded title="Шаблоны проекта" ariaLabel="Шаблоны проекта" size="md" onClose={() => setTemplatesOpen(false)} testId="make-templates">
          <ul className="make-templates" aria-label="Шаблоны">
            {MAKE_TEMPLATES.map((t) => (
              <li key={t.id} className="make-template">
                <span className="make-template-meta"><strong>{t.title}</strong><small>{t.description}</small></span>
                <Button size="sm" variant="secondary" onClick={() => void applyTemplate(t.id, t.title)}>Применить</Button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}

      {ask && (
        <Dialog className="make-dialog" padded title={ask.title} ariaLabel={ask.title} size="sm" onClose={() => setAsk(null)} testId="make-ask">
          <form className="make-ask" onSubmit={(e) => { e.preventDefault(); const value = askValue.trim(); setAsk(null); if (value) ask.onSubmit(value) }}>
            <label className="make-ask-field"><span>{ask.label}</span><input className="tin" autoFocus value={askValue} aria-label={ask.label} onChange={(e) => setAskValue(e.target.value)} /></label>
            <div className="make-ask-actions">
              <Button size="sm" variant="secondary" type="button" onClick={() => setAsk(null)}>Отмена</Button>
              <Button size="sm" variant="primary" type="submit" disabled={!askValue.trim()}>{ask.submit}</Button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  )
}
