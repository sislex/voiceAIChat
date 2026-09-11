import { Dialog, useConfirm, useToast } from '../i18n/ui'
import { mt, useMakeLocale, formatMakeDate, localizeMakeText, localizeMakeStackLabel, describeMakeError, makeTurnLabel } from '../i18n'
import { MakeLanguageSelect } from './MakeLanguageSelect'
import { readBrowserBlob } from '@voicechat/ui-foundation/lib/browserResources'
import type { MakePaneProps } from '../panelContract'
export type { MakePaneProps } from '../panelContract'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Button, EmptyState, IconButton } from '@voicechat/ui-kit'
import { formatUsd } from '@shared/usageSummary'
import { pickTokensFile } from '@shared/makeTokens'
import { MAKE_AUTOSAVE_KEY, MAKE_FORMAT_ON_SAVE_KEY, MAKE_SPLIT_KEY, MAKE_SPLIT_PCT_KEY } from '@voicechat/ui-foundation/persistence'
import { makeNextSteps } from '@shared/makeNextSteps'
import { changedLines as diffLines } from '@shared/lineDiff'
import type { MakeReplacePreviewLine } from '@shared/makeSearch'
import { escapeMarkupText, replaceUniqueText } from '@shared/makeTextEdit'
import { reorderMarkup } from '@shared/makeReorder'
import { componentsWithoutStories, generateStoriesSource } from '@shared/makeStoriesGen'
import { loadImageData, pixelDiff } from '@voicechat/ui-foundation/lib/pixelDiff'
import { MakeMockTable, mockTableFor } from './MakeMockTable'
import { makeMockPrompt } from '@shared/makeMockPrompt'
import { MAKE_DEPLOY_TARGETS, type MakeDeployTarget } from '@shared/makeDeploy'
import { MAKE_SNAPSHOT_PREVIEW } from '@shared/make'
import { EMPTY_MAKE_SELECTION, pruneMakeSelection, toggleMakeSelection, type MakeSelectionState } from '@shared/makeSelection'
import { kilo } from '@voicechat/ui-foundation/lib/view'
import { REST } from '@shared/protocol'
import { MakeProjectComponents } from './MakeProjectComponents'
import { PHONE_EDITOR_QUERY, type EditorSelection } from '@voicechat/ui-foundation/components/CodeEditor'
import { CodeEditor } from './MakeCodeEditor'
import { useMediaQuery } from '@voicechat/ui-foundation/lib/mediaQuery'
import { CodeDiff } from './MakeCodeEditor'
import { MakeTokensDialog } from './MakeTokensDialog'
import { MakeUsageDialog } from './MakeUsageDialog'
import { MakeCommentsPanel } from './MakeCommentsPanel'
import { MakeNotesDialog } from './MakeNotesDialog'
import { MakeTaskLinksDialog } from './MakeTaskLinksDialog'
import { MakeProjectSyncDialog } from './MakeProjectSyncDialog'
import { MakeStylePanel, cssRule, type StyleValues } from './MakeStylePanel'
import { MakeControlField, type ArgType } from './MakeControls'
import { captureIframeScreenshot } from '../lib/makeScreenshot'
import { formatCode } from '@voicechat/ui-foundation/lib/formatCode'
import { a11yPrompt, a11yHelp, a11yImpact, runAxeInFrame, type A11yViolation } from '../lib/makeA11y'
import { pointInRect, usePointerDrag } from '@voicechat/ui-foundation/lib/dnd'
import { dirOfPath, moveTargetPath } from '../lib/makeTree'
import { pushHistory, readHistory, type FileVersion } from '@voicechat/ui-foundation/lib/fileHistory'
import { copyText } from '@voicechat/ui-foundation/lib/clipboard'
import { MAKE_COMMENTS_SYNC_PATH, MAKE_STARTER_GROUPS, MAKE_STARTER_PROMPTS, MAKE_SCAFFOLD, MAKE_TEMPLATES, isMakeTemplateCompatible, makeStackLabel, isMakeTextPath, normalizeMakePath, type MakeCheckIssue, type MakeFileInfo, type MakeProjectState, type MakeSearchMatch, type MakeStoryFile, type MakeConsoleLine, type MakeNetworkEntry, type MakeStoryShot, type MakeLibraryItem, type MakeSnapshotDiff, type MakeImportMode, type MakeComment, type MakePresenceClient, type MakeTestFile, type MakeProjectNotes } from '@shared/make'

// Make's project panel, similar to Figma Make: the conversation's static site lives in a server
// workshop. Preview mode uses a same-origin iframe at /api/preview/make/<conv>/ with width presets
// and element selection for chat-driven edits. Code mode has a file tree and editor; History
// supports snapshots, restore, and reset. Assistant MCP edits trigger make.changed, refreshing the
// preview and any open file without unsaved edits.

export interface MakeSelectedElement {
  selector: string
  tag: string
  text: string
  html: string
  id?: string
  className?: string
  styles?: StyleValues
}

type Mode = 'preview' | 'code' | 'stories' | 'project' | 'history'
const MODE_LABEL: Record<Mode, string> = { get preview() { return mt("preview") }, get code() { return mt("code") }, get stories() { return mt("components") }, get project() { return mt("repository") }, get history() { return mt("history") } }
type Device = 'desktop' | 'tablet' | 'mobile' | 'all'
const DEVICE_WIDTH: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390, all: null }
const DEVICE_LABEL: Record<Device, string> = { get desktop() { return mt("desktop") }, get tablet() { return mt("tablet") }, get mobile() { return mt("phone") }, get all() { return mt("threeWidthsSideBySide") } }
/** Three side-by-side widths (roadmap-4, item 21): extra frames synchronize scrolling through vc-make.state and vc-make.restore. */
const SYNC_WIDTHS = [820, 390]

function formatSize(bytes: number): string {
  return bytes >= 1024 ? mt("valueKb", { p0: (bytes / 1024).toFixed(1) }) : mt("valueB", { p0: bytes })
}

function formatTime(ms: number): string {
  return formatMakeDate(ms)
}

/** Group the file tree by the first directory, with root files first. */
function groupFiles(files: MakeFileInfo[]): Array<{ dir: string; files: MakeFileInfo[] }> {
  const groups = new Map<string, MakeFileInfo[]>()
  for (const file of files) {
    const slash = file.path.indexOf('/')
    const dir = slash >= 0 ? file.path.slice(0, slash) : ''
    groups.set(dir, [...(groups.get(dir) ?? []), file])
  }
  return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'ru'))).map(([dir, list]) => ({ dir, files: list }))
}

export function MakePane({ conversationId, api, make, onInsertToChat, onAskAssistant, onAttachImage, onEditorContext, usage, turnActive = false, askOnly = false, onAskOnlyChange, lastRequest = null, previewBase, ensurePreview, localAgentId, onOpenTask, projectId = null, autosaveDelayMs = 1500 }: MakePaneProps): JSX.Element {
  const locale = useMakeLocale()
  const toast = useToast()
  const confirm = useConfirm()
  const [mode, setMode] = useState<Mode>('preview')
  const [state, setState] = useState<MakeProjectState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<Device>('desktop')
  const [fullscreen, setFullscreen] = useState(false)
  const [inspect, setInspect] = useState(false)
  const [selected, setSelected] = useState<MakeSelectedElement | null>(null)
  // Restore the preview's last known scroll position and hash after reload (item 11).
  const pageStateRef = useRef<{ x: number; y: number; hash: string } | null>(null)
  const syncFramesRef = useRef<Array<HTMLIFrameElement | null>>([])
  const syncMuteUntil = useRef(0)
  // Preview theme and language (item 12): send them to the iframe again after every reload.
  const [previewScheme, setPreviewScheme] = useState<'auto' | 'light' | 'dark'>('auto')
  const [previewLang, setPreviewLang] = useState('')
  const envRef = useRef<{ scheme: 'auto' | 'light' | 'dark'; lang: string; state: 'hover' | 'focus' | 'active' | null; reducedMotion: boolean; slowMs: number }>({ scheme: 'auto', lang: '', state: null, reducedMotion: false, slowMs: 0 })
  /** Preview environment emulation (roadmap-4, item 20): forced element state, reduced motion, and mock delay. */
  const [forcedState, setForcedState] = useState<'hover' | 'focus' | 'active' | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [slowMs, setSlowMs] = useState(0)
  envRef.current = { scheme: previewScheme, lang: previewLang, state: forcedState, reducedMotion, slowMs }
  const sendEnv = (scheme = previewScheme, lang = previewLang, extra: { state?: 'hover' | 'focus' | 'active' | null; reducedMotion?: boolean; slowMs?: number } = {}): void => { frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.env', scheme, lang, state: forcedState, reducedMotion, slowMs, ...extra }, '*') }
  const cycleForcedState = (): void => { const order: Array<'hover' | 'focus' | 'active' | null> = [null, 'hover', 'focus', 'active']; const next = order[(order.indexOf(forcedState) + 1) % order.length] ?? null; setForcedState(next); sendEnv(previewScheme, previewLang, { state: next }) }
  const toggleReducedMotion = (): void => { const next = !reducedMotion; setReducedMotion(next); sendEnv(previewScheme, previewLang, { reducedMotion: next }) }
  const cycleSlowMs = (): void => { const next = slowMs === 0 ? 1500 : slowMs === 1500 ? 4000 : 0; setSlowMs(next); sendEnv(previewScheme, previewLang, { slowMs: next }) }
  const cycleScheme = (): void => { const next = previewScheme === 'auto' ? 'dark' : previewScheme === 'dark' ? 'light' : 'auto'; setPreviewScheme(next); sendEnv(next, previewLang) }
  // Poll the same-origin iframe directly because parent-side scroll events are unreliable.
  useEffect(() => {
    const timer = setInterval(() => {
      const w = frameRef.current?.contentWindow
      try { if (w && w.document?.readyState === 'complete') pageStateRef.current = { x: w.scrollX, y: w.scrollY, hash: w.location.hash } } catch { /* Cross-origin frames are outside this workflow. */ }
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
  /** Append a rule to the project's main stylesheet: the first stylesheet link in index.html, or styles.css as fallback. */
  const writeStyles = async (rule: string, values: StyleValues): Promise<void> => {
    try {
      let target = 'styles.css'
      try {
        const index = await api['make:read']({ conversationId, path: 'index.html' })
        const m = index.content.match(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"'#?]+)["']/i) ?? index.content.match(/<link[^>]*href=["']([^"'#?]+\.css)["'][^>]*rel=["']stylesheet["']/i)
        if (m?.[1] && !/^https?:/i.test(m[1])) target = m[1].replace(/^\.\//, '')
      } catch { /* Without index.html, write to styles.css. */ }
      let css = ''
      try { css = (await api['make:read']({ conversationId, path: target })).content } catch { css = '' }
      const block = `\n/* Edited in the Make style panel */\n${cssRule(rule, values)}`
      const next = await api['make:write']({ conversationId, path: target, content: css.replace(/\s*$/, '\n') + block })
      setState(next); setPreviewRev(next.rev)
      toast.success(mt("ruleValueSavedToValue", { p0: rule, p1: target }))
    } catch (e) { toast.error(describeError(e)) }
  }
  const [previewRev, setPreviewRev] = useState(0)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  // Open-file tabs and debounced autosave preserve edits when switching files, as in VS Code.
  const [tabs, setTabs] = useState<string[]>([])
  // All text file contents for Monaco models and import resolution; reload on revision changes.
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
  const toggleFormatOnSave = (): void => { setFormatOnSave((v) => { const next = !v; try { localStorage.setItem(MAKE_FORMAT_ON_SAVE_KEY, next ? 'on' : 'off') } catch { /* Private browsing. */ } return next }) }
  const toggleAutosave = (): void => { setAutosave((v) => { const next = !v; try { localStorage.setItem(MAKE_AUTOSAVE_KEY, next ? 'on' : 'off') } catch { /* Private browsing. */ } return next }) }
  const [saving, setSaving] = useState(false)
  /** The preview can load once its cookie has been issued, or when no gate is configured. */
  const [previewReady, setPreviewReady] = useState(!ensurePreview)
  /** Name-entry dialog for new files, renaming, and snapshot labels, replacing window.prompt. */
  const [ask, setAsk] = useState<{ title: string; label: string; initial: string; submit: string; onSubmit: (value: string) => void } | null>(null)
  const [askValue, setAskValue] = useState('')
  const [publishOpen, setPublishOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [issues, setIssues] = useState<MakeCheckIssue[] | null>(null)
  // Filter tree paths immediately; search file contents on Enter.
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<MakeSearchMatch[] | null>(null)
  const [searching, setSearching] = useState(false)
  // Story files and the selected story; the runner is a separate preview page.
  const [storyFiles, setStoryFiles] = useState<MakeStoryFile[] | null>(null)
  const [story, setStory] = useState<{ file: string; name: string } | null>(null)
  // Controls store runner-accepted story args and panel overrides without writing them to files.
  const [storyArgs, setStoryArgs] = useState<Record<string, unknown> | null>(null)
  const [argOverrides, setArgOverrides] = useState<Record<string, unknown>>({})
  const [argOptions, setArgOptions] = useState<Record<string, string[]>>({})
  const [argTypes, setArgTypes] = useState<Record<string, ArgType>>({})
  // Play-function results (item 18): map file::story to passed/failed and any error.
  const [playResults, setPlayResults] = useState<Record<string, { status: 'passed' | 'failed'; ms: number; error?: string }>>({})
  const [ideasOpen, setIdeasOpen] = useState(false)
  // Preview console messages and errors from the iframe, cleared on preview reload.
  const [consoleLines, setConsoleLines] = useState<MakeConsoleLine[]>([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [network, setNetwork] = useState<MakeNetworkEntry[]>([])
  const [bottomTab, setBottomTab] = useState<'console' | 'network'>('console')
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [tokensOpen, setTokensOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [projectSettings, setProjectSettings] = useState<MakeProjectNotes | null>(null)
  useEffect(() => { void api['make:notes']({ conversationId }).then(setProjectSettings).catch(() => undefined) }, [api, conversationId])
  const [taskLinksOpen, setTaskLinksOpen] = useState(false)
  /** Synchronize components and styles with the project repository in both directions. */
  const [projectSyncOpen, setProjectSyncOpen] = useState(false)
  /** Open-file lines changed by the assistant's latest write (roadmap-4, item 9). */
  const [changedLines, setChangedLines] = useState<number[]>([])
  /** Mock collection tables (roadmap-4, item 29): use table view by default for mock/*.json arrays of objects. */
  const [mockView, setMockView] = useState<'table' | 'json'>('table')
  const mockTable = useMemo(() => (selectedPath ? mockTableFor(selectedPath, content) : null), [selectedPath, content])
  /** Code/preview split and zen mode (roadmap-4, item 16): persist the editor's size across sessions. */
  const [split, setSplit] = useState<boolean>(() => { try { return localStorage.getItem(MAKE_SPLIT_KEY) === 'on' } catch { return false } })
  const [splitPct, setSplitPct] = useState<number>(() => { try { const v = Number(localStorage.getItem(MAKE_SPLIT_PCT_KEY)); return v >= 25 && v <= 80 ? v : 55 } catch { return 55 } })
  const [zen, setZen] = useState(false)
  const toggleSplit = (): void => setSplit((v) => { const next = !v; try { localStorage.setItem(MAKE_SPLIT_KEY, next ? 'on' : 'off') } catch { /* Private browsing. */ } return next })
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
      onDrop: () => { try { localStorage.setItem(MAKE_SPLIT_PCT_KEY, String(last)) } catch { /* Private browsing. */ } },
      onCancel: () => undefined
    })
  }
  useEffect(() => {
    if (!zen) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setZen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [zen])
  /** File tree multiselect (roadmap-4, item 10): Ctrl/Cmd-click toggles one file; Shift-click selects a range. */
  const [picked, setPicked] = useState<MakeSelectionState>(EMPTY_MAKE_SELECTION)
  /** Open-file content at turn start is the diff baseline because the assistant may rewrite it several times during one turn. */
  const turnBaseRef = useRef<{ path: string | null; content: string }>({ path: null, content: '' })
  // Next-step chips (roadmap-4, item 8): show after the assistant finishes until the user sends
  // another turn.
  const [nextStepsOpen, setNextStepsOpen] = useState(false)
  const prevTurnRef = useRef(false)
  useEffect(() => { if (prevTurnRef.current && !turnActive) setNextStepsOpen(true); if (turnActive) setNextStepsOpen(false); prevTurnRef.current = turnActive }, [turnActive])
  // Component tests (roadmap-4, item 3): run *.test.tsx in a hidden __tests__ iframe and receive
  // vc-make.test / vc-make.tests-done messages.
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
        if (d.error) setTestResults((prev) => ({ ...prev, [runningTests]: [...(prev[runningTests] ?? []), { name: mt("fileUpload"), status: 'failed', ms: 0, error: d.error }] }))
        const next = testQueueRef.current.shift() ?? null
        setRunningTests(next)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [runningTests])
  const failedTests = Object.entries(testResults).flatMap(([file, list]) => list.filter((r) => r.status === 'failed').map((r) => ({ file, ...r })))
  const testsPrompt = (): string => mt("componentTestsFailedValueReadTheTestAndComponent", { p0: failedTests.map((f) => `- ${f.file} › ${f.name}: ${f.error ?? ''}`).join('\n') })

  /** Briefly highlight the tab of a file just written by the assistant (roadmap-2, item 10). */
  const [flashPath, setFlashPath] = useState<string | null>(null)
  // Visual turn diff (roadmap-2, item 8): capture before the turn and after it finishes and the
  // edited preview reloads. Only capture turns that changed files, keeping images in tab memory.
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
      // Allow the preview to reload through make.changed with key={previewRev}, then render.
      const t = window.setTimeout(() => { void snapPreview().then((after) => { if (after) { setTurnDiff((prev) => { if (prev) { URL.revokeObjectURL(prev.before); URL.revokeObjectURL(prev.after) } return { before, after } }) } }) }, 1200)
      return () => window.clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnActive])
  const dismissDiff = (): void => { setTurnDiff((prev) => { if (prev) { URL.revokeObjectURL(prev.before); URL.revokeObjectURL(prev.after) } return null }); setDiffOpen(false) }
  // Self-check (roadmap-4, item 5): send the after screenshot and original request to the assistant
  // for comparison.
  const verifyResult = async (): Promise<void> => {
    if (!turnDiff || !onAttachImage) return
    const blob = await readBrowserBlob(turnDiff.after)
    onAttachImage(new File([blob], 'after.png', { type: 'image/png' }))
    const ask = onAskAssistant ?? onInsertToChat
    ask?.(mt("selfCheckTheScreenshotShowsThePreviewAfterYour", { p0: (lastRequest ?? '').slice(0, 300) }))
  }
  const diffToChat = async (): Promise<void> => {
    if (!turnDiff || !onAttachImage) return
    for (const [key, name] of [['before', 'before.png'], ['after', 'after.png']] as const) {
      const blob = await readBrowserBlob(turnDiff[key])
      onAttachImage(new File([blob], name, { type: 'image/png' }))
    }
    onInsertToChat?.(mt("theScreenshotsShowThePreviewBeforeAndAfterThe"))
    toast.success(mt("bothScreenshotsAttached"))
  }
  // PWA export (item 35): inject manifest, service-worker, and icon links into the archived copy of
  // index.html.
  const [exportPwa, setExportPwa] = useState(false)
  /** Export hosting configuration (roadmap-4, item 36): add netlify.toml or vercel.json to the archive. */
  const [exportDeploy, setExportDeploy] = useState<MakeDeployTarget | ''>('')
  const exportUrl = (vite: boolean): string => `${REST.makeExport(conversationId)}?${vite ? 'vite=1&' : ''}${exportPwa ? 'pwa=1&' : ''}${exportDeploy ? `deploy=${exportDeploy}` : ''}`.replace(/[?&]$/, '')
  // Phone layout (item 34): replace the file tree with a dropdown and use the lightweight editor;
  // see CodeEditor.
  const isPhone = useMediaQuery(PHONE_EDITOR_QUERY)
  // Element comments (item 32): load the list when the panel opens and send markers whenever the
  // preview reports ready.
  const [comments, setComments] = useState<MakeComment[] | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const commentsRef = useRef<MakeComment[]>([])
  const sendPins = (list: MakeComment[] = commentsRef.current): void => {
    const open = list.filter((c) => !c.resolved)
    frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.pins', items: list.map((c) => ({ selector: c.selector, n: open.indexOf(c) + 1, text: c.text, resolved: c.resolved })) }, '*')
  }
  const applyComments = (list: MakeComment[]): void => {
    // Owner notifications (roadmap-4, item 35): show a toast for new viewer comments received
    // through make.changed.
    const prevPending = new Set((commentsRef.current ?? []).filter((c) => c.status === 'pending').map((c) => c.id))
    const fresh = commentsRef.current ? list.filter((c) => c.status === 'pending' && !prevPending.has(c.id)) : []
    if (fresh.length) toast.info(fresh.length === 1 ? mt("newViewerCommentValueValueAwaitingModeration", { p0: fresh[0]!.guestName ? ` (${fresh[0]!.guestName})` : '', p1: fresh[0]!.text.slice(0, 80) }) : mt("newViewerCommentsValueAwaitingModeration", { p0: fresh.length }))
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
  /** Preview text edits (item 17): find the old text as a unique substring in one file, then write the replacement. */
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
      if (hits.length !== 1) { toast.error(hits.length === 0 ? mt("couldNotFindExactlyOneOccurrenceOfThisText") : mt("theTextAppearsInMultipleFilesValueEditIt", { p0: hits.map((h) => h.path).join(', ') })); setPreviewRev((r) => r + 1); return }
      const hit = hits[0]!
      const next = await api['make:write']({ conversationId, path: hit.path, content: hit.next })
      setState(next)
      if (selectedPath === hit.path) { setContent(hit.next); setSavedContent(hit.next) }
      toast.success(mt("textSavedToValue", { p0: hit.path }))
    } catch (e) { toast.error(describeError(e)) }
  }
  /** Reorder preview sections (item 18): both fragments must occur exactly once in the same file. */
  const applyPreviewReorder = async (moved: string, target: string, position: 'before' | 'after'): Promise<void> => {
    try {
      // The handler is captured by an effect; read current state rather than stale render props.
      const files = (await api['make:state']({ conversationId })).files.map((f) => f.path).filter((p) => /\.(html?|tsx|jsx)$/i.test(p))
      const hits: Array<{ path: string; next: string }> = []
      for (const path of files) {
        const { content } = await api['make:read']({ conversationId, path })
        const next = reorderMarkup(content, moved, target, position)
        if (next) hits.push({ path, next })
      }
      if (hits.length !== 1) { toast.error(mt("couldNotUniquelyIdentifyTheseBlocksInTheSource")); setPreviewRev((r) => r + 1); return }
      const hit = hits[0]!
      const next = await api['make:write']({ conversationId, path: hit.path, content: hit.next })
      setState(next)
      if (selectedPath === hit.path) { setContent(hit.next); setSavedContent(hit.next) }
      toast.success(mt("orderSavedToValue", { p0: hit.path }))
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
  // Single-file diff between a snapshot and the current version.
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
    onInsertToChat(mt("inStoryValueValueSetTheDefaultArgsTo", { p0: story.name, p1: story.file, p2: JSON.stringify(argOverrides) }))
  }
  const [checking, setChecking] = useState(false)
  const openAsk = (title: string, label: string, initial: string, submit: string, onSubmit: (value: string) => void): void => { setAskValue(initial); setAsk({ title, label, initial, submit, onSubmit }) }
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  // Dropping desktop files onto the tree uses the same upload flow as the button.
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
  // Presence (roadmap-2, item 14): send heartbeats every 15 seconds and when the current file or
  // unsaved state changes. Receive tab lists through make.presence or heartbeat responses. If
  // another tab has unsaved edits to the same file, make this editor read-only to prevent
  // conflicting autosaves.
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

  const describeError = describeMakeError

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
    // Show a viewer for binary images and fonts instead of a text editor.
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

  // Run the preview cookie gate once per panel mount.
  useEffect(() => {
    if (!ensurePreview) return
    let cancelled = false
    void ensurePreview().then((ok) => { if (!cancelled) { setPreviewReady(true); if (!ok) setError(mt("couldNotPrepareThePreviewSessionCookieIsMissing")) } })
    return () => { cancelled = true }
  }, [ensurePreview])

  // Initial load: fetch project state and open index.html in the editor.
  useEffect(() => {
    let cancelled = false
    void refresh().then((next) => {
      if (cancelled || !next) return
      const entry = next.files.find((f) => f.path === 'index.html') ?? next.files.find((f) => isMakeTextPath(f.path))
      if (entry) void openFile(entry.path)
    })
    return () => { cancelled = true }
  }, [refresh, openFile])

  // Assistant or other-tab changes refresh the preview and file tree. Refresh the open file only
  // when it has no user edits.
  useEffect(() => {
    if (!make) return
    return make.onChanged((m) => {
      if (m.conversationId !== conversationId) return
      // Comments changed in another tab or window (roadmap-2, item 7): reload only the list because
      // files did not change.
      if (m.paths.includes(MAKE_COMMENTS_SYNC_PATH)) { void api['make:comments']({ conversationId }).then((r) => applyComments(r.comments)).catch(() => undefined); return }
      if (turnShotRef.current.active) turnShotRef.current.changed = true
      setPreviewRev(m.rev)
      void refresh()
      if (selectedPath && m.paths.includes(selectedPath) && !dirty) {
        // Inline diff (roadmap-4, item 9): compare the previous content with the assistant's write.
        const base = turnBaseRef.current
        const before = base.path === selectedPath ? base.content : savedContent
        void api['make:read']({ conversationId, path: selectedPath }).then((file) => {
          setContent(file.content); setSavedContent(file.content)
          setChangedLines(turnShotRef.current.active ? diffLines(before, file.content) : [])
        }).catch(() => void openFile(selectedPath))
      }
      // Visible assistant edits (roadmap-2, item 10): in Code mode without unsaved edits, open the
      // file just written and highlight its tab. MCP writes whole files, so show each completed
      // write rather than a byte stream.
      const written = m.paths.find((p) => isMakeTextPath(p) && !p.startsWith('.'))
      if (turnShotRef.current.active && written && !dirty && mode === 'code' && written !== selectedPath) {
        void openFile(written)
        setFlashPath(written)
        window.setTimeout(() => setFlashPath((cur) => (cur === written ? null : cur)), 1800)
      }
    })
  }, [make, conversationId, refresh, openFile, selectedPath, dirty, mode, savedContent, api])

  // Preview messages include the element selected in picker mode.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const fromSync = syncFramesRef.current.some((f) => f?.contentWindow === event.source)
      if (event.source !== frameRef.current?.contentWindow && !fromSync) return
      const data = event.data as { type?: string; before?: string; after?: string; moved?: string; target?: string; position?: string; selector?: string; tag?: string; text?: string; html?: string; id?: string; className?: string; styles?: StyleValues } | null
      if (!data || typeof data !== 'object') return
      // Three side-by-side widths (item 21): mirror scrolling between frames and suppress echoes
      // for 300 ms.
      if (data.type === 'vc-make.state' && typeof (data as { y?: unknown }).y === 'number') {
        const all = [frameRef.current?.contentWindow, ...syncFramesRef.current.map((f) => f?.contentWindow)].filter(Boolean) as Window[]
        const from = all.find((w) => w === event.source)
        if (from && all.length > 1 && Date.now() > syncMuteUntil.current) {
          syncMuteUntil.current = Date.now() + 300
          for (const w of all) if (w !== from) w.postMessage({ type: 'vc-make.restore', x: 0, y: (data as { y: number }).y }, '*')
        }
      }
      // Extra frames only contribute scroll state; selection, text edits, and other actions come
      // from the main frame.
      if (fromSync) { if (data.type === 'vc-make.ready' && event.source) (event.source as Window).postMessage({ type: 'vc-make.env', ...envRef.current, state: null }, '*'); return }
      if (data.type === 'vc-make.state' && event.source === frameRef.current?.contentWindow) {
        const s = data as unknown as { x: number; y: number; hash: string }
        pageStateRef.current = { x: s.x, y: s.y, hash: s.hash }
      }
      if (data.type === 'vc-make.ready') {
        frameRef.current?.contentWindow?.postMessage({ type: 'vc-make.inspect', enabled: inspect }, '*')
        if (commentsRef.current.length) sendPins()
        // Restore scroll position and hash after any preview reload to avoid jumping to the top.
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
  // Inline command (item 6): Cmd/Ctrl+I sends the selected fragment and instruction to the
  // assistant, which edits through make_write_file. Cmd+K is reserved for the command palette.
  const [selection, setSelection] = useState<EditorSelection | null>(null)
  const [inlineOpen, setInlineOpen] = useState(false)
  // Chat editor context contains the file and selection; clear it when the panel closes.
  useEffect(() => {
    if (!onEditorContext) return
    if (!selectedPath) { onEditorContext(null); return }
    onEditorContext(selection
      ? { path: selectedPath, startLine: selection.startLine, endLine: selection.endLine, snippet: selection.text.slice(0, 2000) }
      : { path: selectedPath })
  }, [selectedPath, selection, onEditorContext])
  useEffect(() => () => onEditorContext?.(null), [onEditorContext])
  // Local edit history for the current file (item 7).
  const [historyOpen, setHistoryOpen] = useState(false)
  const localVersions: FileVersion[] = useMemo(() => (selectedPath && historyOpen ? readHistory(conversationId, selectedPath) : []), [conversationId, selectedPath, historyOpen, savedContent])
  const restoreLocal = (v: FileVersion): void => { setContent(v.content); setHistoryOpen(false); toast.info(mt("versionLoadedIntoTheEditorSaveToApplyIt")) }
  const [inlineText, setInlineText] = useState('')
  const inlineInputRef = useRef<HTMLInputElement>(null)
  const openInline = (): void => { if (!selectedPath || !onAskAssistant) return; setInlineOpen(true); setTimeout(() => inlineInputRef.current?.focus(), 0) }
  const sendInline = (): void => {
    if (!selectedPath || !onAskAssistant || !inlineText.trim()) return
    const where = selection ? mt("linesValueValue", { p0: selection.startLine, p1: selection.endLine }) : mt("entireFile")
    const fragment = selection ? `\n\`\`\`\n${selection.text.slice(0, 4000)}\n\`\`\`\n` : '\n'
    onAskAssistant(mt("fileValueValueValueTaskValueChangeOnlyThis", { p0: selectedPath, p1: where, p2: fragment, p3: inlineText.trim() }))
    setInlineOpen(false); setInlineText('')
  }
  /** Run Prettier on demand or on save. On syntax errors, show a toast and preserve the text. */
  const formatCurrent = useCallback(async (source: string, path: string, quiet = false): Promise<string> => {
    try {
      const formatted = await formatCode(path, source)
      if (formatted === null) { if (!quiet) toast.info(mt("formattingIsUnavailableForThisFileType")); return source }
      return formatted
    } catch (e) { if (!quiet) toast.error(mt("formattingValue", { p0: describeError(e).split('\n')[0] })); return source }
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
      // Format only on explicit Cmd+S or button saves; silent autosave must not reformat while the
      // user types.
      const body = formatOnSave && !silent ? await formatCurrent(content, selectedPath, true) : content
      if (body !== content) setContent(body)
      // Local history retains the content before overwriting it, so users can restore that version.
      if (savedContent) pushHistory(conversationId, selectedPath, savedContent)
      const next = await api['make:write']({ conversationId, path: selectedPath, content: body })
      setSavedContent(body)
      setState(next)
      setPreviewRev(next.rev)
      if (!silent) toast.success(mt("saved"))
      // Show JSX/TSX compilation issues as editor markers; leave the banner alone when there are no
      // issues.
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
  // Autosave after a pause following the latest edit.
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
  const markers = useMemo(() => (issues ?? []).filter((i) => i.path === selectedPath && i.line).map((i) => ({ line: i.line!, column: i.column, message: localizeMakeText(i.message), severity: i.severity })), [issues, selectedPath, locale])

  // Ctrl/Cmd+S saves in the editor; Tab indents instead of moving focus.
  const createFile = (): void => openAsk(mt("newFile"), mt("filePathForExampleAboutHtmlOrCssTheme"), '', mt("create"), (raw) => void createFileAt(raw))
  const createFileAt = async (raw: string): Promise<void> => {
    const path = normalizeMakePath(raw)
    if (!path) { toast.error(mt("invalidFilePath")); return }
    if (state?.files.some((f) => f.path === path)) { toast.error(mt("thisFileAlreadyExists")); return }
    try {
      const next = await api['make:write']({ conversationId, path, content: '' })
      setState(next)
      setPreviewRev(next.rev)
      await openFile(path)
      setMode('code')
    } catch (e) { toast.error(describeError(e)) }
  }

  // Disk uploads: write text as editable text and other files as base64 binary data. Put images
  // under img/ to keep the root tidy.
  const uploadInputRef = useRef<HTMLInputElement>(null)
  // Use FileReader because jsdom lacks Blob.text()/arrayBuffer(); behavior is equivalent.
  const readAs = <T extends string | ArrayBuffer>(file: File, mode: 'text' | 'buffer'): Promise<T> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as T)
    reader.onerror = () => reject(reader.error ?? new Error(mt("couldNotReadTheFile")))
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
      if (!path) { toast.error(mt("invalidFileNameValue", { p0: file.name })); continue }
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
    if (uploaded > 0) toast.success(uploaded === 1 ? mt("fileUploaded") : mt("filesUploadedValue", { p0: uploaded }))
    if (uploadInputRef.current) uploadInputRef.current.value = ''
  }

  const renameFile = (path: string): void => openAsk(mt("renameFile"), mt("newFilePath"), path, mt("rename"), (raw) => void renameFileTo(path, raw))
  // Move files with mouse or touch: target the folder group under the pointer or the tree root.
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
      onStart: () => { setDragPath(path); setTreeLive(mt("movingValueDropItOnAFolder", { p0: path })) },
      onMove: (pt) => setDropDir(dirUnderPointer(pt)),
      onDrop: (pt) => {
        const dir = dirUnderPointer(pt)
        setDragPath(null); setDropDir(null)
        if (dir === null || dir === dirOfPath(path)) { setTreeLive(mt("moveCancelled")); return }
        const to = moveTargetPath(path, dir)
        setTreeLive(`${path} → ${to}`)
        void renameFileTo(path, to)
      },
      onCancel: () => { setDragPath(null); setDropDir(null); setTreeLive(mt("moveCancelled")) }
    })
  }
  const renameFileTo = async (path: string, raw: string): Promise<void> => {
    if (raw === path) return
    const to = normalizeMakePath(raw)
    if (!to) { toast.error(mt("invalidFilePath")); return }
    try {
      const next = await api['make:rename']({ conversationId, from: path, to })
      setState(next)
      setPreviewRev(next.rev)
      if (selectedPath === path) setSelectedPath(to)
      setTabs((list) => list.map((t) => (t === path ? to : t)))
    } catch (e) { toast.error(describeError(e)) }
  }

  const deleteFile = async (path: string): Promise<void> => {
    const ok = await confirm({ title: mt("deleteFileValue", { p0: path }), message: mt("youCanRestoreTheProjectFromHistoryIfA"), variant: 'danger', confirmLabel: mt("delete") })
    if (!ok) return
    try {
      const next = await api['make:delete']({ conversationId, path })
      setState(next)
      setPreviewRev(next.rev)
      if (selectedPath === path) { setSelectedPath(null); setContent(''); setSavedContent('') }
      setTabs((list) => list.filter((t) => t !== path))
    } catch (e) { toast.error(describeError(e)) }
  }

  const takeSnapshot = (): void => openAsk(mt("newSnapshot"), mt("snapshotName"), mt("userSnapshot"), mt("save"), (label) => void takeSnapshotNamed(label))
  const takeSnapshotNamed = async (label: string): Promise<void> => {
    try {
      setState(await api['make:snapshot']({ conversationId, label }))
      toast.success(mt("snapshotSaved"))
    } catch (e) { toast.error(describeError(e)) }
  }

  const restoreSnapshot = async (snapshotId: string, label: string): Promise<void> => {
    const ok = await confirm({ title: mt("restoreTheProjectToSnapshotValue", { p0: label }), message: mt("theCurrentStateWillBeSavedAsASeparate"), confirmLabel: mt("restore") })
    if (!ok) return
    try {
      const next = await api['make:restore']({ conversationId, snapshotId })
      setState(next)
      setPreviewRev(next.rev)
      if (selectedPath) void openFile(selectedPath)
      toast.success(mt("projectRestored"))
    } catch (e) { toast.error(describeError(e)) }
  }

  const resetProject = async (): Promise<void> => {
    const ok = await confirm({ title: mt("resetTheProjectToTheStarterTemplate"), message: mt("allFilesWillBeReplacedWithTheStarterPage"), variant: 'danger', confirmLabel: mt("reset") })
    if (!ok) return
    try {
      const next = await api['make:reset']({ conversationId })
      setState(next)
      setPreviewRev(next.rev)
      await openFile('index.html')
    } catch (e) { toast.error(describeError(e)) }
  }

  // Publication address and password (item 25): an empty slug removes the address; an empty
  // password preserves it, while explicit password removal sends null.
  const [publishSlug, setPublishSlug] = useState<string | null>(null)
  const [publishPassword, setPublishPassword] = useState('')
  const publish = async (snapshotId: string | null = null, extra: { slug?: string | null; password?: string | null; allowComments?: boolean } = {}): Promise<void> => {
    try {
      setState(await api['make:publish']({ conversationId, snapshotId, ...extra }))
      setPublishPassword('')
      toast.success(extra.allowComments !== undefined ? (extra.allowComments ? mt("viewerCommentsEnabled") : mt("viewerCommentsDisabled")) : extra.password === null ? mt("passwordRemoved") : snapshotId ? mt("publicationPinnedToASnapshot") : state?.published ? mt("publicationUpdated") : mt("projectPublished"))
    } catch (e) { toast.error(describeError(e)) }
  }
  const publishOptions = (): { slug?: string | null; password?: string | null } => ({
    ...(publishSlug !== null ? { slug: publishSlug.trim() || null } : {}),
    ...(publishPassword ? { password: publishPassword } : {})
  })
  const [publishPick, setPublishPick] = useState<string>('')
  /** Publication version comparison (roadmap-4, item 37): show a historical snapshot beside current content with a difference map. */
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
    const ok = await confirm({ title: mt("unpublishTheProject"), message: mt("theLinkWillStopWorking"), variant: 'danger', confirmLabel: mt("unpublish") })
    if (!ok) return
    try { setState(await api['make:unpublish']({ conversationId })); toast.success(mt("projectUnpublished")) } catch (e) { toast.error(describeError(e)) }
  }
  // Named access (roadmap-3, item 6).
  const [grantUser, setGrantUser] = useState('')
  const [grantRole, setGrantRole] = useState<'editor' | 'viewer'>('viewer')
  const grant = async (user: string, role: 'editor' | 'viewer' | null): Promise<void> => {
    if (!user.trim()) return
    try { setState(await api['make:shareGrant']({ conversationId, user: user.trim(), role })); toast.success(role ? mt("accessForValueValue", { p0: user.trim(), p1: role === 'editor' ? mt("editor") : mt("viewer") }) : mt("accessForValueRemoved", { p0: user.trim() })) } catch (e) { toast.error(describeError(e)) }
  }
  const copyShareLink = async (text: string): Promise<void> => { toast[(await copyText(text)) ? 'success' : 'error'](mt("linkCopied")) }
  // Create or revoke a read-only ChatAI link (item 33).
  const toggleShare = async (): Promise<void> => {
    try {
      setState(await (state?.shared ? api['make:unshare']({ conversationId }) : api['make:share']({ conversationId })))
      toast.success(state?.shared ? mt("readOnlyLinkRevoked") : mt("readOnlyLinkCreated"))
    } catch (e) { toast.error(describeError(e)) }
  }
  const copyPublicLink = async (): Promise<void> => {
    if (!state?.published) return
    try { await navigator.clipboard.writeText(new URL(state.published.slugUrl ?? state.published.url, window.location.origin).toString()); toast.success(mt("linkCopied")) } catch { toast.error(mt("couldNotCopy")) }
  }
  const runCheck = async (): Promise<void> => {
    setChecking(true)
    try { setIssues((await api['make:check']({ conversationId })).issues) } catch (e) { toast.error(describeError(e)) } finally { setChecking(false) }
  }
  const applyTemplate = async (templateId: string, title: string): Promise<void> => {
    const ok = await confirm({ title: mt("applyTemplateValue", { p0: title }), message: mt("projectFilesWillBeReplacedWithTemplateFilesThe"), confirmLabel: mt("apply") })
    if (!ok) return
    try {
      const next = await api['make:template']({ conversationId, templateId })
      setState(next)
      setPreviewRev(next.rev)
      setTemplatesOpen(false)
      await openFile('index.html')
      toast.success(mt("templateValueApplied", { p0: title }))
    } catch (e) { toast.error(describeError(e)) }
  }

  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  /** Regex and case-sensitive search/replace (roadmap-4, item 11); preview before/after lines without writing. */
  const [searchRegex, setSearchRegex] = useState(false)
  const [matchCase, setMatchCase] = useState(false)
  const [replacePreview, setReplacePreview] = useState<MakeReplacePreviewLine[] | null>(null)
  const runReplace = async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    const ok = await confirm({ title: mt("replaceValueWithValueInAllFiles", { p0: q, p1: replacement }), message: mt("aSnapshotWillBeSavedBeforeReplacingYouCan"), confirmLabel: mt("replace") })
    if (!ok) return
    setReplacing(true)
    try {
      const result = await api['make:replace']({ conversationId, query: q, replacement, matchCase, regex: searchRegex })
      setReplacePreview(null)
      setState(result.state); setPreviewRev(result.state.rev)
      if (selectedPath && isMakeTextPath(selectedPath)) await openFile(selectedPath)
      toast.success(result.replacements === 0 ? mt("noMatches") : mt("replacementsValueInValueFiles", { p0: result.replacements, p1: result.files }))
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
  /** Automatic story generation (roadmap-4, item 23): find components without story files and generate stories from their props. */
  const orphanComponents = useMemo(() => componentsWithoutStories((state?.files ?? []).map((f) => f.path)), [state])
  const generateStories = async (path: string): Promise<void> => {
    try {
      const { content } = await api['make:read']({ conversationId, path })
      const gen = generateStoriesSource(path, content)
      if (!gen) { toast.error(mt("noExportedComponentWithAPascalcaseNameFoundIn")); return }
      const next = await api['make:write']({ conversationId, path: gen.path, content: gen.content })
      setState(next); setPreviewRev(next.rev)
      toast.success(mt("createdValue", { p0: gen.path }))
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
  // Visual story snapshots (item 16): send html2canvas runner PNGs to the server and compare two
  // snapshots side by side.
  const [shots, setShots] = useState<MakeStoryShot[]>([])
  const [shotsOpen, setShotsOpen] = useState(false)
  const [shooting2, setShooting2] = useState(false)
  const [compare, setCompare] = useState<[string, string] | null>(null)
  /** Visual regression (roadmap-4, item 24): compute a difference map for the selected snapshot pair in the browser. */
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
      } catch { /* Omit the difference map when canvas is unavailable in jsdom or an image failed to load. */ }
    })()
    return () => { alive = false }
  }, [compare, conversationId])
  const loadShots = useCallback(async (): Promise<void> => { try { setShots((await api['make:shots']({ conversationId })).shots) } catch { /* No snapshots. */ } }, [api, conversationId])
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
      toast.success(mt("storyScreenshotSaved"))
    } catch (e) { toast.error(describeError(e)) } finally { setShooting2(false) }
  }
  const storyShots = useMemo(() => (story ? shots.filter((s) => s.file === story.file && s.story === story.name) : []), [shots, story])
  // Component library (item 17): export the current component and its stories, or insert saved
  // files into the project.
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
      toast.success(mt("valueSavedToTheLibraryValueFiles", { p0: item.name, p1: item.files.length }))
    } catch (e) { toast.error(describeError(e)) }
  }
  /** Save a complete design kit as one library item (roadmap-2, item 13): components, stories, and tokens. */
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
      const { item } = await api['make:libraryExport']({ conversationId, name: mt("designKitValueFiles", { p0: paths.length }), paths })
      toast.success(mt("kitValueSavedToTheLibrary", { p0: item.name }))
      void loadLibrary()
    } catch (e) { toast.error(describeError(e)) }
  }
  const insertFromLibrary = async (item: MakeLibraryItem): Promise<void> => {
    const clash = item.files.filter((p) => state?.files.some((f) => f.path === p))
    if (clash.length > 0 && !(await confirm({ title: mt("insertValue", { p0: item.name }), message: mt("theseFilesWillBeOverwrittenValueASnapshotWill", { p0: clash.join(', ') }), confirmLabel: mt("insert") }))) return
    try {
      const { state: next, autoImported } = await api['make:libraryInsert']({ conversationId, slug: item.slug })
      setState(next); setPreviewRev(next.rev); setLibraryOpen(false)
      toast.success(autoImported.length ? mt("valueAddedEntryPointImportValue", { p0: item.name, p1: autoImported.join(', ') }) : mt("valueAddedToTheProject", { p0: item.name }))
      if (selectedPath && isMakeTextPath(selectedPath)) void openFile(selectedPath)
      void loadStories()
    } catch (e) { toast.error(describeError(e)) }
  }
  const removeFromLibrary = async (item: MakeLibraryItem): Promise<void> => {
    if (!(await confirm({ title: mt("deleteValueFromTheLibrary", { p0: item.name }), variant: 'danger', confirmLabel: mt("delete") }))) return
    try { setLibrary((await api['make:libraryRemove']({ slug: item.slug })).items) } catch (e) { toast.error(describeError(e)) }
  }
  /** Copy a public story link to the clipboard; requires a publication. */
  const shareStory = async (): Promise<void> => {
    if (!story) return
    if (!state?.published) { toast.info(mt("thePublicLinkBecomesAvailableAfterPublishingTheProject")); setPublishOpen(true); return }
    const url = new URL(`${state.published.url}__stories__?file=${encodeURIComponent(story.file)}&story=${encodeURIComponent(story.name)}`, window.location.origin).toString()
    toast[(await copyText(url)) ? 'success' : 'error'](mt("storyLinkCopied"))
  }
  const sendStoryToChat = (): void => {
    if (!story || !onInsertToChat) return
    const component = story.file.slice(story.file.lastIndexOf('/') + 1).replace(/\.stories\.(jsx|tsx)$/i, '')
    onInsertToChat(mt("workOnlyOnComponentValueValueStoryValueIn", { p0: component, p1: story.file.replace(/\.stories\./, '.'), p2: story.name, p3: story.file }))
  }

  const sendSelectedToChat = (): void => {
    if (!selected || !onInsertToChat) return
    const text = mt("changeElementValueValue", { p0: selected.selector, p1: selected.text ? ` («${selected.text.slice(0, 80)}»)` : '' })
    onInsertToChat(text)
    setInspect(false)
  }

  const groups = useMemo(() => groupFiles(state?.files ?? []), [state])
  const treeOrder = useMemo(() => groups.flatMap((g) => g.files.map((f) => f.path)), [groups])
  useEffect(() => { setPicked((sel) => (sel.paths.length ? pruneMakeSelection(sel, treeOrder) : sel)) }, [treeOrder])
  const bulkDelete = async (): Promise<void> => {
    const paths = picked.paths
    const ok = await confirm({ title: mt("deleteValueFiles", { p0: paths.length }), message: paths.join(', '), variant: 'danger', confirmLabel: mt("delete") })
    if (!ok) return
    try {
      let next: MakeProjectState | null = null
      for (const path of paths) next = await api['make:delete']({ conversationId, path })
      if (next) { setState(next); setPreviewRev(next.rev) }
      if (selectedPath && paths.includes(selectedPath)) { setSelectedPath(null); setContent(''); setSavedContent('') }
      setTabs((list) => list.filter((t) => !paths.includes(t)))
      setPicked(EMPTY_MAKE_SELECTION)
      toast.success(mt("filesDeletedValue", { p0: paths.length }))
    } catch (e) { toast.error(describeError(e)) }
  }
  const bulkMove = (): void => openAsk(mt("moveFilesToFolder"), mt("folderLeaveEmptyForRoot"), dirOfPath(picked.paths[0] ?? ''), mt("move"), (raw) => {
    const dir = raw.trim().replace(/^\/+|\/+$/g, '')
    void (async () => {
      for (const path of picked.paths) if (dirOfPath(path) !== dir) await renameFileTo(path, moveTargetPath(path, dir))
      setPicked(EMPTY_MAKE_SELECTION)
    })()
  })
  // A fresh project contains only unmodified starter files; show starting ideas, as on Figma Make's
  // home screen.
  const isFresh = useMemo(() => {
    const files = state?.files
    if (!files || files.length === 0) return false
    const enc = new TextEncoder()
    return files.every((f) => f.path in MAKE_SCAFFOLD && f.size === enc.encode(MAKE_SCAFFOLD[f.path]!).length)
  }, [state])
  const useStarter = (prompt: string): void => { onInsertToChat?.(localizeMakeText(prompt)); setIdeasOpen(false) }
  // Attach a preview or selected-element screenshot to chat so visual bugs can be shown directly.
  const [shooting, setShooting] = useState(false)
  // Preview accessibility (item 13): run axe inside the iframe and display results below it.
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
      if (onInsertToChat && !selected) onInsertToChat(mt("theScreenshotShowsThePreview"))
      toast.success(mt("screenshotAttached"))
    } catch (e) { toast.error(describeError(e)) } finally { setShooting(false) }
  }
  useEffect(() => { setConsoleLines([]); setNetwork([]) }, [previewRev])
  const networkFailed = network.filter((n) => !n.ok).length
  // Iterative fixes: listen to the preview console for eight seconds after a reload. If errors
  // appear, offer a fix action that sends them directly to the assistant.
  const [autofix, setAutofix] = useState<{ rev: number; dismissed: boolean }>({ rev: 0, dismissed: false })
  const watchUntil = useRef(0)
  useEffect(() => { watchUntil.current = Date.now() + 8_000; setAutofix({ rev: previewRev, dismissed: false }) }, [previewRev])
  const recentErrors = consoleLines.filter((l) => l.level === 'error' && l.at <= watchUntil.current)
  const showAutofix = !autofix.dismissed && recentErrors.length > 0
  const askFix = (): void => {
    const text = mt("errorsAppearedInThePreviewConsoleAfterTheLatest", { p0: recentErrors.slice(-5).map((l) => `- ${l.text.slice(0, 300)}`).join('\n') })
    if (onAskAssistant) onAskAssistant(text); else onInsertToChat?.(text)
    setAutofix((a) => ({ ...a, dismissed: true }))
  }
  const consoleErrors = consoleLines.filter((l) => l.level === 'error').length
  const sendConsoleToChat = (): void => {
    const errors = consoleLines.filter((l) => l.level === 'error' || l.level === 'warn').slice(-5)
    if (!onInsertToChat || errors.length === 0) return
    onInsertToChat(mt("errorsInThePreviewConsoleValueFixThem", { p0: errors.map((l) => `- [${l.level}] ${l.text.slice(0, 300)}`).join('\n') }))
  }
  const sendNetworkToChat = (): void => {
    const failed = network.filter((n) => !n.ok).slice(-8)
    if (!onInsertToChat || failed.length === 0) return
    onInsertToChat(mt("resourcesFailedToLoadInThePreviewValueFix", { p0: failed.map((n) => `- ${n.method} ${n.url} → ${n.status || mt("network")}`).join('\n') }))
  }
  const assets = useMemo(() => (state?.files ?? []).filter((f) => !isMakeTextPath(f.path)), [state])
  const copyAsset = async (text: string, what: string): Promise<void> => { toast[(await copyText(text)) ? 'success' : 'error'](mt("valueCopied", { p0: what })) }
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
      toast.success(mt("fileValueRestored", { p0: path }))
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
      toast.success(mt("filesImportedValue", { p0: next.files.length }))
    } catch (e) { toast.error(describeError(e)) } finally { setImporting(false); if (importZipRef.current) importZipRef.current.value = '' }
  }
  const frameWidth = DEVICE_WIDTH[device]
  const previewSrc = `${base}index.html?rev=${previewRev}`

  // Overflow menu: move secondary actions out of the header to prevent wrapping onto several rows,
  // especially on phones. Close on outside click or Escape.
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
    <div className="make-head" role="toolbar" aria-label={mt("projectPanel")}>
      <div className="make-tabs" role="tablist" aria-label={mt("panelMode")}>
        {(['preview', 'code', 'stories', ...(projectId ? ['project' as Mode] : []), 'history'] as Mode[]).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'make-tab on' : 'make-tab'} onClick={() => setMode(m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      {projectSettings && <button type="button" className="make-stack-badge" aria-label={mt("projectSettingsValue", { p0: localizeMakeStackLabel(makeStackLabel(projectSettings.stack, projectSettings.uiKit)) })} onClick={() => setNotesOpen(true)}>{localizeMakeStackLabel(makeStackLabel(projectSettings.stack, projectSettings.uiKit))}</button>}
      <span className="make-head-spacer" />
      <MakeLanguageSelect />
      {mode === 'preview' && (
        <>
          <div className="make-devices" role="group" aria-label={mt("previewWidth")}>
            {(['desktop', 'tablet', 'mobile', ...(isPhone ? [] : ['all' as Device])] as Device[]).map((d) => (
              <button key={d} type="button" aria-pressed={device === d} className={device === d ? 'make-device on' : 'make-device'} title={DEVICE_LABEL[d]} aria-label={DEVICE_LABEL[d]} onClick={() => setDevice(d)}>
                {d === 'desktop' ? mt("pc") : d === 'tablet' ? mt("tablet") : d === 'mobile' ? mt("phone") : '⫼'}
              </button>
            ))}
          </div>
          <IconButton size="sm" aria-label={mt("selectElement")} title={mt("selectAnElementOnThePageAndAskThe")} aria-pressed={inspect} className={inspect ? 'make-inspect on' : undefined} onClick={() => setInspect((v) => !v)}>⌖</IconButton>
          <IconButton size="sm" aria-label={mt("refreshPreview")} title={mt("refreshPreview")} onClick={() => setPreviewRev((r) => r + 1)}>⟳</IconButton>
          <Button size="sm" variant={commentsOpen ? 'secondary' : 'ghost'} aria-pressed={commentsOpen} onClick={() => setCommentsOpen((v) => !v)} title={mt("commentsOnPreviewElements")}>💬{comments && comments.some((c) => !c.resolved) ? ` ${comments.filter((c) => !c.resolved).length}` : ''}</Button>
        </>
      )}
      {mode === 'code' && (
        <>
          {!isPhone && <IconButton size="sm" aria-label={mt("sideBySidePreview")} title={split ? mt("hideThePreviewBesideTheCode") : mt("showThePreviewBesideTheCodeDragTheDivider")} aria-pressed={split} onClick={toggleSplit}>◫</IconButton>}
          {!isPhone && <IconButton size="sm" aria-label={mt("zenMode")} title={mt("zenEditorOnlyPressEscToExit")} aria-pressed={zen} onClick={() => setZen(true)}>⛶</IconButton>}
          <Button size="sm" variant="ghost" onClick={() => void runCheck()} loading={checking}>{mt("check")}</Button>
          <Button size="sm" variant="secondary" onClick={createFile}>{mt("file")}</Button>
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save()} title={mt("saveCtrlCmdS")}>{saving ? mt("saving") : mt("save")}</Button>
        </>
      )}
      <input ref={uploadInputRef} type="file" multiple hidden aria-label={mt("uploadFilesToProject")} data-testid="make-upload-input" onChange={(e) => void uploadFiles(e.target.files)} />
      {mode === 'history' && <Button size="sm" variant="secondary" onClick={takeSnapshot}>{mt("snapshot")}</Button>}
      {mode === 'history' && <Button size="sm" variant="ghost" onClick={() => setUsageOpen(true)} title={mt("projectStorageUsageAndSnapshotCleanup")}>{mt("storage")}</Button>}
      {mode === 'stories' && story && onInsertToChat && <Button size="sm" variant="primary" onClick={sendStoryToChat}>{mt("workOnComponent")}</Button>}
      {mode === 'stories' && story && <Button size="sm" variant="ghost" loading={shooting2} onClick={() => void takeStoryShot()} title={mt("saveAPngOfTheCurrentStoryToCompare")}>{mt("screenshot")}</Button>}
      {mode === 'stories' && storyShots.length > 0 && <Button size="sm" variant="ghost" aria-expanded={shotsOpen} onClick={() => setShotsOpen((v) => !v)}>{mt("screenshots")}{storyShots.length})</Button>}
      {mode === 'stories' && testFiles.length > 0 && <Button size="sm" variant={failedTests.length ? 'danger' : 'ghost'} loading={Boolean(runningTests)} onClick={() => runTests(testFiles.map((f) => f.path))} title={mt("runAllTestTsxFilesInTheRunner")}>{mt("tests")}{testFiles.reduce((n, f) => n + f.names.length, 0)}){failedTests.length ? ` · ✗ ${failedTests.length}` : ''}</Button>}
      {others.length > 0 && <span className="make-presence" data-testid="make-presence" title={mt("projectAlsoOpenInValueValueValue", { p0: others.length, p1: others.length === 1 ? mt("tab") : mt("tabs"), p2: others.map((c) => `${c.user}${c.path ? ` · ${c.path}${c.editing ? mt("editing") : ''}` : ''}`).join('; ') })}>👥 {others.length + 1}</span>}
      {usage && <span className="make-cost" data-testid="make-cost" title={mt("projectUsageValueValueValueValueValueValue", { p0: usage.turns, p1: makeTurnLabel(usage.turns), p2: kilo(usage.inputTokens), p3: kilo(usage.outputTokens), p4: usage.estimated ? mt("partOfTheAmountIsEstimatedFromRates") : '', p5: usage.unpriced ? mt("unpricedValue", { p0: usage.unpriced }) : '' })}>{formatUsd(usage.costUsd, usage.estimated)}<small>{usage.turns} {makeTurnLabel(usage.turns)}</small></span>}
      {onAskOnlyChange && <IconButton size="sm" aria-label={mt("askOnly")} title={askOnly ? mt("questionModeTheNextResponseWillNotEditFiles") : mt("askOnlyTheNextTurnAnswersWithoutEditingFiles")} aria-pressed={askOnly} className={askOnly ? 'make-inspect on' : undefined} onClick={() => onAskOnlyChange(!askOnly)}>❓</IconButton>}
      <Button size="sm" variant={state?.published ? 'secondary' : 'ghost'} onClick={() => setPublishOpen(true)} >{state?.published ? mt("published") : mt("publish")}</Button>
      <div className="make-more" ref={moreRef}>
        <IconButton size="sm" aria-label={mt("more")} title={mt("moreActions")} aria-haspopup="true" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>⋯</IconButton>
        {moreOpen && (
          <div className="jcard-menu make-more-menu" role="group" aria-label={mt("moreActions")} data-testid="make-more-menu">
            {mode === 'preview' && <>
              {item(mt("themeValue", { p0: previewScheme === 'auto' ? mt("system") : previewScheme === 'dark' ? mt("dark") : mt("light") }), () => cycleScheme(), { ariaLabel: mt("previewTheme"), title: mt("switchPreviewTheme") })}
              {item(mt("elementStateValue", { p0: forcedState ?? mt("normal") }), () => cycleForcedState(), { ariaLabel: mt("elementState"), title: mt("showTheSelectedElementInHoverFocusActiveBy"), disabled: !selected })}
              {item(`Reduced motion: ${reducedMotion ? mt("on") : mt("off")}`, () => toggleReducedMotion(), { ariaLabel: 'Reduced motion', title: mt("emulatePrefersReducedMotionWithZeroDurationAnimationsAnd") })}
              {item(mt("slowNetworkValue", { p0: slowMs === 0 ? mt("off") : mt("valueS", { p0: slowMs / 1000 }) }), () => cycleSlowMs(), { ariaLabel: mt("slowNetwork"), title: mt("delayFetchResponsesInThePreviewMocksAndData") })}
              <label className="make-more-row"><span>{mt("previewLanguage")}</span>
                <select className="make-lang" aria-label={mt("previewLanguage")} value={previewLang} onChange={(e) => { setPreviewLang(e.target.value); sendEnv(previewScheme, e.target.value) }} title={mt("thePreviewDocumentSLangAttribute")}>
                  <option value="">{mt("auto")}</option>
                  {['ru', 'en', 'de', 'fr', 'es', 'zh', 'ar'].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              {item(mt("checkAccessibility"), () => void runA11y(), { ariaLabel: mt("checkAccessibility_307c02"), disabled: a11yBusy, title: mt("axeCoreInThePreviewContrastAltTextLabels") })}
              {onAttachImage && item(selected ? mt("attachElementScreenshotToChat") : mt("attachPreviewScreenshotToChat"), () => void screenshotToChat(), { ariaLabel: mt("attachPreviewScreenshotToChat_ef08c9"), disabled: shooting })}
              {item(mt("openInNewTab"), () => window.open(`${base}index.html`, '_blank', 'noopener'), { ariaLabel: mt("openInNewTab_97acdc") })}
              <hr />
            </>}
            {mode === 'code' && <>
              {item(mt("uploadFiles"), () => uploadInputRef.current?.click(), { ariaLabel: mt("upload") })}
              {item(mt("assetsValue", { p0: assets.length > 0 ? ` (${assets.length})` : '' }), () => setAssetsOpen(true))}
              {item(mt("designTokens"), () => setTokensOpen(true), { ariaLabel: mt("tokens"), title: mt("designTokensRootCssVariablesForColorsSpacingAnd") })}
              {item(mt("componentLibrary"), () => openLibrary(), { ariaLabel: mt("library") })}
              {(onAskAssistant || onInsertToChat) && item(mt("mockFromDescription"), () => openAsk(mt("mockDataFromDescription"), mt("describeTheDataForExampleProductsNamePriceCategory"), '', mt("generate"), (desc) => { const n = /(\d{1,3})\s*(шт|запис|штук|элемент|строк|items?|records?|rows?)/i.exec(desc)?.[1]; const { prompt } = makeMockPrompt(desc, { ...(n ? { count: Number(n) } : {}), translate: localizeMakeText }); (onAskAssistant ?? onInsertToChat)!(prompt) }), { ariaLabel: mt("mockFromDescription_48dcff"), title: mt("theAssistantCreatesMockApiNameJsonWithRealistic") })}
              <hr />
            </>}
            {mode === 'stories' && <>
              {story && item(mt("saveToLibrary"), () => void exportStoryToLibrary(), { title: mt("saveTheComponentAndItsStoriesToYourPersonal") })}
              {item(mt("componentLibrary"), () => openLibrary(), { ariaLabel: mt("library") })}
              {item(mt("galleryOfAllStories"), () => window.open(`${REST.makeGalleryPage(conversationId)}?makeLocale=${locale}`, '_blank', 'noopener'), { ariaLabel: mt("gallery") })}
              {story && item(mt("storyLink"), () => void shareStory(), { ariaLabel: mt("share"),  title: state?.published ? mt("copyAPublicLinkToThisStory") : mt("publishTheProjectFirstToCreateALinkThat") })}
              <hr />
            </>}
            {item(mt("projectSettings_9dd366"), () => setNotesOpen(true), { ariaLabel: mt("projectSettings"), title: mt("stackStyleFoundationAssistantModeAndNotes") })}
            {item(mt("projectTasks"), () => setTaskLinksOpen(true), { ariaLabel: mt("projectTasks_121d1a"), title: mt("linkTheOpenPageToABoardTaskAnd") })}
            {item(mt("componentsFromProject"), () => setProjectSyncOpen(true), { ariaLabel: mt("componentsFromProject_ac8316"), title: mt("copyComponentsAndStylesFromTheProjectRepositoryAnd") })}
            {onInsertToChat && item(mt("starterIdeas"), () => setIdeasOpen(true), { ariaLabel: mt("starterIdeas_199213") })}
            {item(mt("projectTemplates"), () => setTemplatesOpen(true), { ariaLabel: mt("projectTemplates_0a30aa") })}
            {item(mt("importProject"), () => setImportOpen(true), { ariaLabel: mt("importProject_f8374a"), title: mt("importAZipPageUrlOrGithubRepository") })}
            {item(mt("downloadProjectZip"), () => setExportOpen(true), { ariaLabel: mt("downloadProjectZip_ee103e") })}
          </div>
        )}
      </div>
      <IconButton size="sm" aria-label={fullscreen ? mt("collapsePanel") : mt("fullScreen")} title={fullscreen ? mt("collapsePanel") : mt("fullScreen")} aria-pressed={fullscreen} onClick={() => setFullscreen((v) => !v)}>⛶</IconButton>
    </div>
  )

  return (
    <section lang={locale} className={`make-pane${fullscreen ? ' make-pane--fs' : ''}${zen && mode === 'code' ? ' make-pane--zen' : ''}`} aria-label={mt("makeProject")} data-testid="make-pane">
      {header}
      {error && <p className="make-error" role="alert">{describeMakeError(error)}</p>}

      {mode === 'preview' && (
        <div className="make-preview" data-testid="make-preview">
          {turnDiff && (
            <div className="make-turn-diff" data-testid="make-turn-diff">
              <strong>{mt("changesFromTheLatestResponse")}</strong>
              <button type="button" className="make-turn-diff-thumbs" onClick={() => setDiffOpen(true)} title={mt("enlargeComparison")}>
                <span><img src={turnDiff.before} alt={mt("previewBeforeChanges")} /><small>{mt("before")}</small></span>
                <span><img src={turnDiff.after} alt={mt("previewAfterChanges")} /><small>{mt("after")}</small></span>
              </button>
              <span className="make-head-spacer" />
              {onAttachImage && lastRequest && (onAskAssistant || onInsertToChat) && <Button size="sm" variant="secondary" onClick={() => void verifyResult()} title={mt("sendTheAssistantTheAfterScreenshotAndOriginalRequest")}>{mt("compareWithRequest")}</Button>}
              {onAttachImage && <Button size="sm" variant="ghost" onClick={() => void diffToChat()}>{mt("toChat")}</Button>}
              <IconButton size="sm" aria-label={mt("hideComparison")} title={mt("hide")} onClick={dismissDiff}>✕</IconButton>
            </div>
          )}
          {nextStepsOpen && (onAskAssistant || onInsertToChat) && (
            <div className="make-next" data-testid="make-next">
              <span className="make-next-label">{mt("nextSteps")}</span>
              {makeNextSteps({ hasTokens: Boolean(pickTokensFile((state?.files ?? []).map((f) => f.path))) && (state?.files ?? []).some((f) => f.path === 'tokens.css' || f.path === 'styles.css'), hasTests: testFiles.length > 0, hasStories: (storyFiles?.length ?? 0) > 0, published: Boolean(state?.published), openComments: (comments ?? []).filter((c) => !c.resolved).length, a11yIssues: a11y ? a11y.length : null, files: state?.files.length ?? 0 }).map((s) => (
                <button key={s.id} type="button" className="make-next-chip" onClick={() => { setNextStepsOpen(false); (onAskAssistant ?? onInsertToChat)!(localizeMakeText(s.prompt)) }}>{localizeMakeText(s.title)}</button>
              ))}
              <IconButton size="sm" aria-label={mt("hideSuggestions")} title={mt("hide")} onClick={() => setNextStepsOpen(false)}>✕</IconButton>
            </div>
          )}
          {selected && (
            <div className="make-selected" data-testid="make-selected">
              <code className="make-selected-sel" title={selected.selector}>&lt;{selected.tag}&gt; {selected.selector}</code>
              {selected.text && <span className="make-selected-text">«{selected.text.slice(0, 80)}»</span>}
              <span className="make-selected-actions">
                <Button size="sm" variant={styleOpen ? 'secondary' : 'ghost'} aria-expanded={styleOpen} onClick={() => setStyleOpen((v) => !v)}>{mt("styles")}</Button>
                {onInsertToChat && <Button size="sm" variant="primary" onClick={sendSelectedToChat}>{mt("toChat")}</Button>}
                <IconButton size="sm" aria-label={mt("clearSelection")} title={mt("clearSelection")} onClick={() => { previewStyles({}); setSelected(null) }}>✕</IconButton>
              </span>
            </div>
          )}
          {selected && styleOpen && (
            <MakeStylePanel selector={selected.selector} id={selected.id} className={selected.className} computed={selected.styles ?? {}} onPreview={previewStyles} onWrite={writeStyles} onReset={() => previewStyles({})} />
          )}
          {isFresh && onInsertToChat && (
            <section className="make-starters" aria-label={mt("starterIdeas_199213")} data-testid="make-starters">
              <div className="make-starters-head">
                <strong>{mt("gettingStarted")}</strong>
                <Button size="sm" variant="ghost" onClick={() => setIdeasOpen(true)}>{mt("allIdeas")}</Button>
              </div>
              <div className="make-starters-grid">
                {MAKE_STARTER_PROMPTS.slice(0, 6).map((item) => (
                  <button key={item.id} type="button" className="make-starter" onClick={() => useStarter(item.prompt)} title={localizeMakeText(item.prompt)}>
                    <span className="make-starter-title">{localizeMakeText(item.title)}</span>
                    <span className="make-starter-group">{localizeMakeText(MAKE_STARTER_GROUPS[item.group])}</span>
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
              title={mt("projectPreview")}
              src={previewSrc}
              onLoad={restorePageState}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads"
              style={frameWidth ? { width: `${frameWidth}px` } : device === 'all' ? { width: '1200px' } : undefined}
            />}
            {device === 'all' && previewReady && SYNC_WIDTHS.map((w, i) => (
              <iframe key={`${previewRev}-${w}`} ref={(el) => { syncFramesRef.current[i] = el }} className="make-frame make-frame--sync" title={mt("previewAtValuePx", { p0: w })} src={previewSrc} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads" style={{ width: `${w}px` }} />
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
            <section className={a11y.length ? 'make-a11y make-a11y--bad' : 'make-a11y'} aria-label={mt("accessibilityCheck")} data-testid="make-a11y">
              <div className="make-a11y-head">
                <strong>{a11y.length === 0 ? mt("accessibilityNoViolationsFound") : mt("accessibilityValueViolations", { p0: a11y.length })}</strong>
                <span className="make-a11y-actions">
                  {a11y.length > 0 && (onAskAssistant || onInsertToChat) && <Button size="sm" variant="primary" onClick={() => { (onAskAssistant ?? onInsertToChat)!(a11yPrompt(a11y)) }}>{mt("fix")}</Button>}
                  <IconButton size="sm" aria-label={mt("hideAccessibilityResults")} title={mt("hide")} onClick={() => setA11y(null)}>✕</IconButton>
                </span>
              </div>
              {a11y.length > 0 && (
                <ul className="make-a11y-list">
                  {a11y.map((v) => (
                    <li key={v.id} className={`make-a11y-row make-a11y-row--${v.impact}`}>
                      <span className="make-a11y-impact">{a11yImpact(v.impact)}</span>
                      <button type="button" className="make-a11y-help" onClick={() => showA11yTarget(v.target)} title={v.target}>{a11yHelp(v)}</button>
                      <small>{v.nodes}{' '}{mt("elements")}</small>
                      <a href={v.helpUrl} target="_blank" rel="noreferrer">?</a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {showAutofix && (
            <div className="make-autofix" role="alert" data-testid="make-autofix">
              <span>{mt("afterTheChangeTheConsoleHas")}{' '}{recentErrors.length === 1 ? mt("anError") : mt("errorsValue", { p0: recentErrors.length })} — <code>{recentErrors[recentErrors.length - 1]!.text.slice(0, 120)}</code></span>
              <span className="make-autofix-actions">
                {(onAskAssistant || onInsertToChat) && <Button size="sm" variant="primary" onClick={askFix}>{mt("fix")}</Button>}
                <Button size="sm" variant="ghost" onClick={() => { setAutofix((a) => ({ ...a, dismissed: true })); setConsoleOpen(true) }}>{mt("showConsole")}</Button>
                <IconButton size="sm" aria-label={mt("hideFixSuggestion")} title={mt("hide")} onClick={() => setAutofix((a) => ({ ...a, dismissed: true }))}>✕</IconButton>
              </span>
            </div>
          )}
          <section className={consoleOpen ? 'make-console make-console--open' : 'make-console'} aria-label={mt("previewConsole")} data-testid="make-console">
            <div className="make-console-head">
              <span className="make-console-tabs">
                <button type="button" className={`make-console-toggle${bottomTab === 'console' ? ' on' : ''}`} aria-expanded={consoleOpen && bottomTab === 'console'} onClick={() => { if (bottomTab === 'console') setConsoleOpen((v) => !v); else { setBottomTab('console'); setConsoleOpen(true) } }}>
                  {consoleOpen && bottomTab === 'console' ? '▾' : '▸'}{' '}{mt("console")}{' '}<span className="make-console-count">{consoleLines.length}</span>
                  {consoleErrors > 0 && <span className="make-console-errors" data-testid="make-console-errors">{consoleErrors}{' '}{mt("errors")}</span>}
                </button>
                <button type="button" className={`make-console-toggle${bottomTab === 'network' ? ' on' : ''}`} aria-expanded={consoleOpen && bottomTab === 'network'} onClick={() => { if (bottomTab === 'network') setConsoleOpen((v) => !v); else { setBottomTab('network'); setConsoleOpen(true) } }} data-testid="make-network-toggle">
                  {consoleOpen && bottomTab === 'network' ? '▾' : '▸'}{' '}{mt("network_b3c4b1")}{' '}<span className="make-console-count">{network.length}</span>
                  {networkFailed > 0 && <span className="make-console-errors" data-testid="make-network-failed">{networkFailed}{' '}{mt("failedToLoad")}</span>}
                </button>
              </span>
              <span className="make-console-actions">
                {onInsertToChat && bottomTab === 'console' && consoleErrors > 0 && <Button size="sm" variant="secondary" onClick={sendConsoleToChat}>{mt("toChat")}</Button>}
                {onInsertToChat && bottomTab === 'network' && networkFailed > 0 && <Button size="sm" variant="secondary" onClick={sendNetworkToChat}>{mt("toChat")}</Button>}
                {bottomTab === 'console' && consoleLines.length > 0 && <Button size="sm" variant="ghost" onClick={() => setConsoleLines([])}>{mt("clear")}</Button>}
                {bottomTab === 'network' && network.length > 0 && <Button size="sm" variant="ghost" onClick={() => setNetwork([])}>{mt("clear")}</Button>}
              </span>
            </div>
            {consoleOpen && bottomTab === 'network' && (
              <ol className="make-console-lines make-network" data-testid="make-network">
                {network.length === 0 && <li className="make-console-empty">{mt("noRequestsYetPreviewFetchXhrRequestsWillAppear")}</li>}
                {network.map((n, i) => (
                  <li key={`${n.at}-${i}`} className={`make-network-row${n.ok ? '' : ' make-network-row--bad'}`}>
                    <span className="make-network-status">{n.status || '—'}</span>
                    <span className="make-network-method">{n.method}</span>
                    <code className="make-network-url" title={n.url}>{n.url}</code>
                    <small>{n.ms}{' '}{mt("ms")}{' '}{n.kind}</small>
                  </li>
                ))}
              </ol>
            )}
            {consoleOpen && bottomTab === 'console' && (
              <ol className="make-console-lines">
                {consoleLines.length === 0 && <li className="make-console-empty">{mt("noConsoleOutputYetPageLogsAndErrorsWill")}</li>}
                {consoleLines.map((l, i) => <li key={`${l.at}-${i}`} className={`make-console-line make-console-line--${l.level}`}><span className="make-console-level">{l.level}</span><code>{l.text}</code></li>)}
              </ol>
            )}
          </section>
        </div>
      )}

      {mode === 'code' && (
        <div ref={codeRef} className={`${dropActive ? 'make-code make-code--drop' : 'make-code'}${isPhone ? ' make-code--phone' : ''}${split && !isPhone ? ' make-code--split' : ''}${zen ? ' make-code--zen' : ''}`} style={split && !isPhone && !zen ? { gridTemplateColumns: `minmax(150px, 220px) ${splitPct}fr 6px ${100 - splitPct}fr` } : split && zen ? { gridTemplateColumns: `${splitPct}fr 6px ${100 - splitPct}fr` } : undefined} onDragOver={onDragOver} onDragLeave={() => setDropActive(false)} onDrop={onDrop} data-testid="make-code">
          <nav className={dragPath ? 'make-tree make-tree--dragging' : 'make-tree'} aria-label={mt("projectFiles")} ref={treeRef}>
            <span className="vc-sr-only" role="status" aria-live="polite" data-testid="make-tree-live">{treeLive}</span>
            <div className="make-search">
              <input
                type="search"
                className="make-search-input"
                aria-label={mt("searchProjectFiles")}
                placeholder={mt("fileNameOrTextEnterSearchesContents")}
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) setMatches(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch() } if (e.key === 'Escape') { setQuery(''); setMatches(null) } }}
              />
              {searching && <span className="make-search-state">{mt("searching")}</span>}
              <IconButton size="sm" aria-label={mt("regularExpression")} title={mt("searchWithARegularExpression")} aria-pressed={searchRegex} onClick={() => setSearchRegex((v) => !v)}>.*</IconButton>
              <IconButton size="sm" aria-label={mt("matchCase")} title={mt("matchCase")} aria-pressed={matchCase} onClick={() => setMatchCase((v) => !v)}>Aa</IconButton>
              <IconButton size="sm" aria-label={mt("replaceAcrossProject")} title={mt("findAndReplaceInAllFiles")} aria-pressed={replaceOpen} onClick={() => setReplaceOpen((v) => !v)}>⇄</IconButton>
            </div>
            {replaceOpen && (
              <div className="make-replace" data-testid="make-replace">
                <input type="text" className="make-search-input" aria-label={mt("replaceWith")} placeholder={mt("replaceWith_8ee87c")} value={replacement} onChange={(e) => setReplacement(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runReplace() } }} />
                <Button size="sm" variant="ghost" disabled={!query.trim()} loading={replacing} onClick={() => void previewReplace()}>{mt("previewChanges")}</Button>
                <Button size="sm" variant="secondary" disabled={!query.trim()} loading={replacing} onClick={() => void runReplace()}>{mt("replaceAll")}</Button>
              </div>
            )}
            {replaceOpen && replacePreview !== null && (
              <div className="make-matches make-replace-preview" role="region" aria-label={mt("replacementPreview")} data-testid="make-replace-preview">
                <p className="make-tree-dir">{replacePreview.length === 0 ? mt("noMatches") : mt("linesToChangeValue", { p0: replacePreview.length })}</p>
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
              <div className="make-matches" role="region" aria-label={mt("searchResults")} data-testid="make-matches">
                <p className="make-tree-dir">{matches.length === 0 ? mt("nothingFound") : mt("matchesValue", { p0: matches.length })}</p>
                {matches.map((m, i) => (
                  <button key={`${m.path}:${m.line}:${i}`} type="button" className="make-match" onClick={() => void openFile(m.path)} title={`${m.path}:${m.line}`}>
                    <span className="make-match-path">{m.path}<span className="make-match-line">:{m.line}</span></span>
                    <code className="make-match-text">{m.text}</code>
                  </button>
                ))}
              </div>
            )}
            {picked.paths.length > 0 && (
              <div className="make-bulk" role="toolbar" aria-label={mt("selectedFileActions")} data-testid="make-bulk">
                <span className="make-bulk-count">{mt("selected")}{' '}{picked.paths.length}</span>
                <Button size="sm" variant="secondary" onClick={bulkMove}>{mt("moveToFolder")}</Button>
                <Button size="sm" variant="danger" onClick={() => void bulkDelete()}>{mt("delete")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked(EMPTY_MAKE_SELECTION)}>{mt("unpublish")}</Button>
              </div>
            )}
            {dropActive && <p className="make-drop-hint" role="status">{mt("dropToUploadFilesToTheProject")}</p>}
            {groups.length === 0 && <EmptyState title={mt("noFilesYet")} description={mt("createAFileDragOneHereOrAskThe")} />}
            {groups.map((group) => ({ ...group, files: group.files.filter((f) => !query.trim() || f.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) })).filter((g) => g.files.length > 0).map((group) => (
              <div className={dropDir === group.dir && dragPath ? 'make-tree-group make-tree-group--drop' : 'make-tree-group'} key={group.dir || '/'} data-dir={group.dir}>
                {group.dir && <p className="make-tree-dir">📁 {group.dir}</p>}
                {group.files.map((file) => (
                  <div key={file.path} className={`make-tree-item${file.path === selectedPath ? ' on' : ''}${picked.paths.includes(file.path) ? ' make-tree-item--picked' : ''}${dragPath === file.path ? ' make-tree-item--drag' : ''}`} onPointerDown={(e) => beginFileDrag(e, file.path)}>
                    <button type="button" className="make-tree-file" aria-selected={picked.paths.includes(file.path) || undefined} onClick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) { e.preventDefault(); setPicked((sel) => toggleMakeSelection(sel, file.path, treeOrder, e.shiftKey ? 'range' : 'toggle')); return } void openFile(file.path) }} title={mt("valueValueCtrlShiftClickToSelectMultipleFiles", { p0: file.path, p1: formatSize(file.size) })}>
                      {group.dir ? file.path.slice(group.dir.length + 1) : file.path}
                    </button>
                    <span className="make-tree-actions">
                      <IconButton size="sm" aria-label={mt("renameValue", { p0: file.path })} title={mt("rename")} onClick={() => renameFile(file.path)}>✎</IconButton>
                      <IconButton size="sm" aria-label={mt("deleteValue", { p0: file.path })} title={mt("delete")} onClick={() => void deleteFile(file.path)}>✕</IconButton>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </nav>
          <div className="make-editor">
            {lockedBy && (
              <div className="make-lock" role="status" data-testid="make-lock">{mt("thisFileIsBeingEditedInAnotherTab")}{lockedBy.user}{mt("andIsReadOnlyHereToPreventAutosaveFrom")}</div>
            )}
            {changedLines.length > 0 && <div className="make-changed-note" role="status">{mt("linesChangedByTheAssistantAreHighlighted")}{changedLines.length}) <button type="button" className="make-link" onClick={() => setChangedLines([])}>{mt("hide_b95774")}</button></div>}
            {isPhone && state && (
              <div className="make-file-picker">
                <select aria-label={mt("projectFile")} value={selectedPath ?? ''} onChange={(e) => { if (e.target.value) void openFile(e.target.value) }}>
                  {!selectedPath && <option value="">{mt("selectAFile")}</option>}
                  {state.files.filter((f) => isMakeTextPath(f.path)).map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
                </select>
                <Button size="sm" variant="secondary" onClick={createFile}>{mt("file")}</Button>
              </div>
            )}
            {issues !== null && (
              <div className={issues.some((i) => i.severity !== 'warning') ? 'make-issues make-issues--bad' : issues.length ? 'make-issues make-issues--warn' : 'make-issues'} role="status" data-testid="make-issues">
                {issues.length === 0 ? <span>{mt("checksPassedIndexHtmlExistsAndProjectFileLinks")}</span> : (
                  <>
                    {issues.every((i) => i.severity === 'warning') && <span>{mt("noErrorsLinterWarnings")}{issues.length}):</span>}
                    <ul>{issues.map((issue, i) => <li key={i} className={issue.severity === 'warning' ? 'make-issue--warn' : undefined}>{issue.severity === 'warning' ? '⚠ ' : ''}<button type="button" className="make-issue-path" onClick={() => void openFile(issue.path)}>{issue.path}{issue.line ? `:${issue.line}` : ''}</button> — {localizeMakeText(issue.message)}{issue.rule ? <span className="make-issue-rule"> {issue.rule}</span> : null}</li>)}</ul>
                  </>
                )}
                <IconButton size="sm" aria-label={mt("hideCheckResults")} title={mt("hide")} onClick={() => setIssues(null)}>✕</IconButton>
              </div>
            )}
            {tabs.length > 0 && (
              <div className="make-tabs-bar" role="tablist" aria-label={mt("openFiles")}>
                {tabs.map((t) => (
                  <div key={t} className={`make-file-tab${t === selectedPath ? ' on' : ''}${t === flashPath ? ' make-file-tab--flash' : ''}`} data-testid={t === flashPath ? 'make-file-tab-flash' : undefined}>
                    <button type="button" role="tab" aria-selected={t === selectedPath} className="make-file-tab-name" onClick={() => void openFile(t)} title={t}>
                      {t.slice(t.lastIndexOf('/') + 1)}{t === selectedPath && dirty ? <span className="make-file-tab-dirty" aria-label={mt("unsaved")}>●</span> : null}
                    </button>
                    <IconButton size="sm" aria-label={mt("closeValue", { p0: t })} title={mt("close")} onClick={() => closeTab(t)}>✕</IconButton>
                  </div>
                ))}
              </div>
            )}
            {selectedPath && !isMakeTextPath(selectedPath) ? (
              <>
                <div className="make-editor-head">
                  <code>{selectedPath}</code>
                  <span className="make-editor-state">{formatSize(state?.files.find((f) => f.path === selectedPath)?.size ?? 0)}{' '}{mt("binaryFile")}</span>
                </div>
                <div className="make-binary" data-testid="make-binary">
                  {/\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i.test(selectedPath)
                    ? <img src={`${base}${selectedPath}?rev=${previewRev}`} alt={mt("viewValue", { p0: selectedPath })} />
                    : <EmptyState title={mt("notATextFile")} description={mt("thisFileCannotBeEditedHereButIsAvailable")} />}
                  <code className="make-binary-ref">{selectedPath}</code>
                </div>
              </>
            ) : selectedPath ? (
              <>
                <div className="make-editor-head">
                  <code>{selectedPath}</code>
                  <span className="make-editor-tools">
                    <label className="make-autosave"><input type="checkbox" checked={autosave} onChange={toggleAutosave} />{' '}{mt("autosave")}</label>
                    {mockTable && (
                      <span className="make-mock-view" role="group" aria-label={mt("mockView")}>
                        <button type="button" className={mockView === 'table' ? 'make-tab on' : 'make-tab'} aria-pressed={mockView === 'table'} onClick={() => setMockView('table')}>{mt("table")}</button>
                        <button type="button" className={mockView === 'json' ? 'make-tab on' : 'make-tab'} aria-pressed={mockView === 'json'} onClick={() => setMockView('json')}>JSON</button>
                      </span>
                    )}
                    <label className="make-autosave" title={mt("runPrettierBeforeSavingWithCmdCtrlS")}><input type="checkbox" checked={formatOnSave} onChange={toggleFormatOnSave} />{' '}{mt("formatOnSave")}</label>
                    <Button size="sm" variant="ghost" loading={formatting} onClick={() => void formatNow()} title={mt("prettierShiftAltFInTheEditor")}>{mt("format")}</Button>
                    <Button size="sm" variant="ghost" aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)} title={mt("recentVersionsOfThisFileSavedInThisBrowser")}>{mt("versions")}</Button>
                    {onAskAssistant && <Button size="sm" variant="ghost" onClick={openInline} title={mt("cmdCtrlIInTheEditorAskTheAssistant")}>{mt("aiEdit")}{selection ? mt("valueLines", { p0: selection.endLine - selection.startLine + 1 }) : ''}</Button>}
                    <span className={dirty ? 'make-editor-state dirty' : 'make-editor-state'}>{dirty ? mt("unsaved") : mt("saved_f3f98e")}</span>
                  </span>
                </div>
                {historyOpen && (
                  <div className="make-local-history" data-testid="make-local-history">
                    {localVersions.length === 0
                      ? <span className="make-diff-note">{mt("noLocalVersionsYetTheyAppearAfterSavingIn")}</span>
                      : localVersions.map((v, i) => (
                        <button key={v.at + ':' + i} type="button" className="make-local-version" onClick={() => restoreLocal(v)} title={v.content.slice(0, 200)}>
                          <span>{formatTime(v.at)}</span><small>{v.content.length}{' '}{mt("characters")}</small>
                        </button>
                      ))}
                  </div>
                )}
                {inlineOpen && (
                  <div className="make-inline" data-testid="make-inline" role="dialog" aria-label={mt("askTheAssistantToEditTheSelection")}>
                    <span className="make-inline-scope">{selection ? mt("linesValueValue_d43716", { p0: selection.startLine, p1: selection.endLine }) : mt("entireFile_b7f501")}</span>
                    <input ref={inlineInputRef} type="text" aria-label={mt("whatShouldChangeInThisSection")} placeholder={mt("forExampleExtractASeparateFunctionAndAddTypes")} value={inlineText} onChange={(e) => setInlineText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendInline() } if (e.key === 'Escape') setInlineOpen(false) }} />
                    <Button size="sm" variant="primary" disabled={!inlineText.trim()} onClick={sendInline}>{mt("send")}</Button>
                    <IconButton size="sm" aria-label={mt("closeAiEdit")} title={mt("close")} onClick={() => setInlineOpen(false)}>✕</IconButton>
                  </div>
                )}
                {mockTable && mockView === 'table' ? (
                  <MakeMockTable path={selectedPath} value={content} onChange={(v) => setContent(v)} readOnly={Boolean(lockedBy)} />
                ) : (
                <CodeEditor path={selectedPath} value={content} onChange={(v) => { setContent(v); if (changedLines.length) setChangedLines([]) }} onSave={() => void save()} ariaLabel={mt("contentsOfValue", { p0: selectedPath })} markers={markers} projectFiles={projectFiles} onSelectionChange={setSelection} onInlineCommand={openInline} readOnly={Boolean(lockedBy)} changedLines={changedLines} />
                )}
              </>
            ) : (
              <EmptyState title={mt("selectFile")} description={mt("projectFilesAreOnTheLeftSaveWithThe")} />
            )}
          </div>
          {split && !isPhone && (
            <>
              <div className="make-split-handle" role="separator" aria-label={mt("codePreviewDivider")} aria-orientation="vertical" aria-valuenow={splitPct} onPointerDown={beginSplitDrag} />
              <div className="make-split-preview" data-testid="make-split-preview">
                <iframe key={previewRev} className="make-frame" title={mt("sideBySidePreview")} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads" src={previewSrc} />
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'stories' && (
        <div className="make-stories" data-testid="make-stories">
          <nav className="make-tree make-stories-list" aria-label={mt("componentsAndStories")}>
            {storyFiles === null && <p className="make-tree-dir">{mt("loading")}</p>}
            {storyFiles !== null && storyFiles.length === 0 && (
              <EmptyState
                title={mt("noStoriesYet")}
                description={mt("addANameStoriesJsxFileBesideTheComponent")}
                actionLabel={mt("templates")}
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
                        {(() => { const r = playResults[`${file.path}::${name}`]; const has = file.withPlay?.includes(name); if (!has && !r) return null; return <span className={`make-play make-play--${r?.status ?? 'pending'}`} title={r ? (r.status === 'passed' ? mt("playPassedInValueMs", { p0: r.ms }) : mt("playFailedValue", { p0: r.error ?? '' })) : mt("includesAPlayFunctionThatRunsWhenOpened")}>{r ? (r.status === 'passed' ? '✓' : '✗') : '▷'}</span> })()}
                      </button>
                    </div>
                  )
                })}
                <div className="make-tree-item">
                  <button type="button" className="make-tree-file make-tree-file--dim" onClick={() => { void openFile(file.path); setMode('code') }}>{mt("openStories")}</button>
                </div>
              </div>
            ))}
            {storyFiles !== null && orphanComponents.length > 0 && (
              <div className="make-tree-group" data-testid="make-orphans">
                <p className="make-tree-dir" title={mt("componentsWithoutAStoriesFile")}>{mt("withoutStories")}</p>
                {orphanComponents.map((path) => (
                  <div className="make-tree-item" key={path}>
                    <button type="button" className="make-tree-file make-tree-file--dim" onClick={() => void generateStories(path)} title={mt("createValueFromComponentProps", { p0: path.replace(/\.(tsx|jsx)$/i, '.stories.tsx') })}>{mt("storiesFor")}{' '}{path.slice(path.lastIndexOf('/') + 1)}</button>
                  </div>
                ))}
              </div>
            )}
          </nav>
          <div className="make-story-host">
            {runningTests && previewReady && <iframe key={runningTests} className="make-tests-frame" title={mt("testsForValue", { p0: runningTests })} sandbox="allow-scripts allow-same-origin" src={`${base}__tests__?file=${encodeURIComponent(runningTests)}&rev=${previewRev}&makeLocale=${locale}`} aria-hidden="true" />}
            {testsOpen && (
              <section className="make-tests" aria-label={mt("testResults")} data-testid="make-tests">
                <div className="make-tests-head">
                  <strong>{mt("componentTests")}</strong>
                  {runningTests && <small>{mt("running")}{' '}{runningTests}…</small>}
                  <span className="make-head-spacer" />
                  {failedTests.length > 0 && (onAskAssistant || onInsertToChat) && <Button size="sm" variant="primary" onClick={() => (onAskAssistant ?? onInsertToChat)!(testsPrompt())}>{mt("fix")}</Button>}
                  <IconButton size="sm" aria-label={mt("closeTestResults")} title={mt("close")} onClick={() => setTestsOpen(false)}>✕</IconButton>
                </div>
                <ul role="list">
                  {testFiles.map((f) => (
                    <li key={f.path} className="make-tests-file">
                      <div className="make-tests-file-head"><code>{f.path}</code><Button size="sm" variant="ghost" onClick={() => runTests([f.path])} disabled={Boolean(runningTests)}>{mt("run")}</Button></div>
                      <ul role="list">
                        {(testResults[f.path] ?? f.names.map((n) => ({ name: n, status: 'pending' as const, ms: 0, error: undefined as string | undefined }))).map((r, i) => (
                          <li key={`${r.name}-${i}`} className={`make-test make-test--${r.status}`}>
                            <span>{r.status === 'passed' ? '✓' : r.status === 'failed' ? '✗' : '·'} {r.name}</span>{r.status !== 'pending' && <small>{r.ms}{' '}{mt("ms_bbb0e8")}</small>}
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
                title={mt("storyValue", { p0: story.name })}
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads"
                src={`${base}__stories__?file=${encodeURIComponent(story.file)}&story=${encodeURIComponent(story.name)}&rev=${previewRev}&makeLocale=${locale}`}
              />
            ) : storyFiles && storyFiles.length > 0 ? (
              <EmptyState title={mt("selectAStory")} description={mt("projectComponentsAndTheirStatesAreOnTheLeft")} />
            ) : null}
            {story && playResults[`${story.file}::${story.name}`]?.status === 'failed' && (
              <div className="make-autofix" role="alert" data-testid="make-play-failed">
                <span>{mt("playFunctionFailed")}{' '}<code>{playResults[`${story.file}::${story.name}`]!.error}</code></span>
                <span className="make-autofix-actions">
                  {(onAskAssistant || onInsertToChat) && <Button size="sm" variant="primary" onClick={() => (onAskAssistant ?? onInsertToChat)!(mt("inStoryValueValueThePlayFunctionFailedValue", { p0: story.name, p1: story.file, p2: playResults[`${story.file}::${story.name}`]!.error }))}>{mt("fix")}</Button>}
                </span>
              </div>
            )}
            {story && shotsOpen && storyShots.length > 0 && (
              <section className="make-shots" aria-label={mt("storyScreenshots")} data-testid="make-shots">
                <div className="make-shots-strip">
                  {storyShots.map((s) => (
                    <button key={s.id} type="button" className={`make-shot${compare?.includes(s.id) ? ' on' : ''}`} title={`${formatTime(s.at)} · rev ${s.rev}`}
                      onClick={() => setCompare((c) => (!c ? [s.id, s.id] : c[0] === s.id ? null : [c[0] === c[1] ? c[0] : c[1], s.id]))}>
                      <img src={REST.makeShotImage(conversationId, s.id)} alt={mt("screenshotValue", { p0: formatTime(s.at) })} />
                      <small>{formatTime(s.at)}</small>
                    </button>
                  ))}
                  <span className="make-shots-hint">{mt("clickToSelectBeforeThenClickAgainToSelect")}</span>
                </div>
                {compare && compare[0] !== compare[1] && (
                  <div className="make-shots-compare" data-testid="make-shots-compare">
                    <figure><img src={REST.makeShotImage(conversationId, compare[0])} alt={mt("before_1520dc")} /><figcaption>{mt("before")}</figcaption></figure>
                    <figure><img src={REST.makeShotImage(conversationId, compare[1])} alt={mt("after_47e080")} /><figcaption>{mt("after")}</figcaption></figure>
                    {shotDiff && (
                      <figure data-testid="make-shots-diff"><img src={shotDiff.url} alt={mt("differenceMap")} /><figcaption className={shotDiff.mismatch > 0.005 ? 'make-shots-diff--bad' : 'make-shots-diff--ok'}>{shotDiff.mismatch === 0 ? mt("noDifferences") : mt("valueOfPixelsDiffer", { p0: (shotDiff.mismatch * 100).toFixed(2) })}</figcaption></figure>
                    )}
                  </div>
                )}
              </section>
            )}
            {story && storyArgs && (
              <section className="make-controls" aria-label={mt("controlsStoryArgs")} data-testid="make-controls">
                <div className="make-controls-head">
                  <strong>{mt('controls')}</strong>
                  <span className="make-controls-actions">
                    {Object.keys(argOverrides).length > 0 && <Button size="sm" variant="ghost" onClick={resetArgs}>{mt("reset")}</Button>}
                    {onInsertToChat && Object.keys(argOverrides).length > 0 && <Button size="sm" variant="secondary" onClick={sendArgsToChat}>{mt("saveThroughAssistant")}</Button>}
                  </span>
                </div>
                {Object.keys(storyArgs).length === 0 ? (
                  <p className="make-controls-empty">{mt("thisStoryHasNoArgsAddThemToThe")}</p>
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

      {mode === 'project' && projectId && (
        <MakeProjectComponents
          localAgentId={localAgentId}
          projectId={projectId}
          api={api}
          ensurePreview={ensurePreview ? async () => { await ensurePreview() } : undefined}
          onOpenTask={onOpenTask}
          onInsertToChat={onInsertToChat}
        />
      )}

      {mode === 'history' && (
        <div className="make-history">
          {(state?.snapshots.length ?? 0) === 0 ? (
            <EmptyState title={mt("noSnapshotsYet")} description={mt("theAssistantSavesASnapshotBeforeEveryChangeUse")} />
          ) : (
            <ul className="make-snapshots" aria-label={mt("projectSnapshots")}>
              {state!.snapshots.map((snap) => (
                <li key={snap.id} className="make-snapshot">
                  <span className="make-snapshot-meta">
                    <strong>{localizeMakeText(snap.label)}</strong>
                    <small>{formatTime(snap.createdAt)}{' '}{mt("files")}{' '}{snap.files}</small>
                  </span>
                  <span className="make-snapshot-actions">
                    <Button size="sm" variant="ghost" onClick={() => void loadDiff(snap.id)} aria-expanded={Boolean(diffs[snap.id])}>{diffs[snap.id] ? mt("hide") : mt("compare")}</Button>
                    <Button size="sm" variant="secondary" onClick={() => void restoreSnapshot(snap.id, snap.label)}>{mt("restore")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void publish(snap.id)} title={mt("thePublicLinkWillServeThisExactVersion")}>{state?.published?.snapshotId === snap.id ? mt("publishedVersion") : mt("publishVersion")}</Button>
                  </span>
                  {diffs[snap.id] === 'loading' && <p className="make-diff-note">{mt("comparing")}</p>}
                  {diffs[snap.id] && diffs[snap.id] !== 'loading' && (
                    <ul className="make-diff" aria-label={mt("differencesFromSnapshotValue", { p0: snap.label })} data-testid="make-diff">
                      {(diffs[snap.id] as MakeSnapshotDiff).files.filter((f) => f.status !== 'same').length === 0 && <li className="make-diff-note">{mt("filesMatchTheCurrentVersion")}</li>}
                      {(diffs[snap.id] as MakeSnapshotDiff).files.filter((f) => f.status !== 'same').map((f) => (
                        <li key={f.path} className={`make-diff-row make-diff-row--${f.status}`}>
                          <span className="make-diff-status">{f.status === 'added' ? mt("new") : f.status === 'removed' ? mt("deleted") : mt("modified")}</span>
                          {isMakeTextPath(f.path)
                            ? <button type="button" className="make-diff-file" onClick={() => void openFileDiff(snap.id, snap.label, f.path)} title={mt("showComparison")}><code>{f.path}</code></button>
                            : <code>{f.path}</code>}
                          <small>{f.before !== null ? formatSize(f.before) : '—'} → {f.after !== null ? formatSize(f.after) : '—'}</small>
                          {f.status !== 'added' && <Button size="sm" variant="ghost" onClick={() => void restoreFile(snap.id, f.path)}>{mt("restoreFile")}</Button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="make-history-foot">
            <Button size="sm" variant="danger" onClick={() => void resetProject()}>{mt("resetProject")}</Button>
          </div>
        </div>
      )}

      {fileDiff && (
        <Dialog className="make-dialog" padded title={mt("comparisonValue", { p0: fileDiff.path })} ariaLabel={mt("compareValue", { p0: fileDiff.path })} size="lg" onClose={() => setFileDiff(null)} testId="make-file-diff"
          actions={<Button size="sm" variant="secondary" onClick={() => { void restoreFile(fileDiff.snapshotId, fileDiff.path); setFileDiff(null) }}>{mt("restoreFileFromSnapshot")}</Button>}>
          <p className="make-ideas-lead">{mt("leftSnapshot")}{fileDiff.label}{mt("rightCurrentVersion")}</p>
          <CodeDiff path={fileDiff.path} original={fileDiff.original} modified={fileDiff.modified} />
        </Dialog>
      )}
      {libraryOpen && (
        <Dialog className="make-dialog" padded title={mt("componentLibrary")} ariaLabel={mt("componentLibrary")} size="md" onClose={() => setLibraryOpen(false)} testId="make-library">
          <p className="make-ideas-lead">{mt("componentsSavedFromYourProjectsInsertCopiesFilesInto")}</p>
          {kitPaths().length > 0 && <div className="make-ask-actions make-kit-actions"><Button size="sm" variant="secondary" onClick={() => void exportKitToLibrary()} title={mt("allComponentsWithStoriesAndTheTokenFileAs")}>{mt("saveEntireKit")}{kitPaths().length}{' '}{mt("files_586373")}</Button></div>}
          {library === null ? <p className="make-diff-note">{mt("loading")}</p> : library.length === 0 ? (
            <EmptyState title={mt("libraryIsEmpty")} description={mt("openAStoryInComponentsAndClickSaveTo")} />
          ) : (
            <ul className="make-assets" aria-label={mt("libraryComponents")}>
              {library.map((item) => (
                <li key={item.slug} className="make-asset make-library-item">
                  <div className="make-asset-meta">
                    <strong>{item.name}{item.files.some((p) => p === 'tokens.css' || p === 'styles.css') && <span className="make-kit-badge" title={mt("includesATokenFile")}>{mt("kit")}</span>}</strong>
                    <small>{item.files.join(', ')} · {formatSize(item.bytes)} · {formatTime(item.updatedAt)}</small>
                  </div>
                  <span className="make-asset-actions">
                    <Button size="sm" variant="primary" onClick={() => void insertFromLibrary(item)}>{mt("insert")}</Button>
                    <IconButton size="sm" aria-label={mt("deleteValueFromLibrary", { p0: item.name })} title={mt("deleteFromLibrary")} onClick={() => void removeFromLibrary(item)}>✕</IconButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
      {notesOpen && <MakeNotesDialog conversationId={conversationId} api={api} onClose={() => setNotesOpen(false)} onSaved={setProjectSettings} />}
      {taskLinksOpen && <MakeTaskLinksDialog conversationId={conversationId} currentPath={selectedPath ?? ''} api={api} onOpenTask={onOpenTask} onClose={() => setTaskLinksOpen(false)} />}
      {projectSyncOpen && <MakeProjectSyncDialog conversationId={conversationId} api={api} onClose={() => setProjectSyncOpen(false)} />}
      {usageOpen && <MakeUsageDialog conversationId={conversationId} api={api} onClose={() => setUsageOpen(false)} onChanged={(next) => { setState(next); setPreviewRev(next.rev) }} />}
      {diffOpen && turnDiff && (
        <Dialog className="make-dialog" padded title={mt("beforeAndAfter")} ariaLabel={mt("beforeAndAfter")} size="lg" onClose={() => setDiffOpen(false)} testId="make-turn-diff-dialog">
          <div className="make-turn-diff-big">
            <figure><img src={turnDiff.before} alt={mt("previewBeforeChanges")} /><figcaption>{mt("before_1520dc")}</figcaption></figure>
            <figure><img src={turnDiff.after} alt={mt("previewAfterChanges")} /><figcaption>{mt("after_47e080")}</figcaption></figure>
          </div>
        </Dialog>
      )}
      {tokensOpen && state && <MakeTokensDialog conversationId={conversationId} api={api} files={state.files.map((f) => f.path)} onClose={() => setTokensOpen(false)} onWritten={(next) => { setState(next); setPreviewRev(next.rev) }} />}
      {assetsOpen && (
        <Dialog className="make-dialog" padded title={mt("projectAssets")} ariaLabel={mt("projectAssets")} size="md" onClose={() => setAssetsOpen(false)} testId="make-assets">
          <p className="make-ideas-lead">{mt("imagesAndOtherBinaryProjectFilesCopyAPath")}</p>
          {assets.length === 0 ? (
            <EmptyState title={mt("noAssetsYet")} description={mt("uploadImagesWithUploadOrDragThemIntoThe")} actionLabel={mt("upload")} onAction={() => { setAssetsOpen(false); uploadInputRef.current?.click() }} />
          ) : (
            <ul className="make-assets" aria-label={mt("assetList")}>
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
                    <Button size="sm" variant="ghost" onClick={() => void copyAsset(f.path, mt("path"))}>{mt("path")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void copyAsset(`<img src="${f.path}" alt="">`, mt("tag"))}>&lt;img&gt;</Button>
                    <IconButton size="sm" aria-label={mt("deleteValue", { p0: f.path })} title={mt("delete")} onClick={() => void deleteFile(f.path)}>✕</IconButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
      {versionCompare && (
        <Dialog className="make-dialog make-version-dialog" padded title={mt("comparePublishedVersions")} ariaLabel={mt("comparePublishedVersions")} size="lg" onClose={() => { setVersionCompare(null); setVersionDiff(null) }} testId="make-version-compare"
          footer={<><Button size="sm" variant="secondary" onClick={() => void computeVersionDiff()}>{mt("differenceMap")}</Button>{versionDiff && <span className={versionDiff.mismatch > 0.005 ? 'make-shots-diff--bad' : 'make-shots-diff--ok'}>{versionDiff.mismatch === 0 ? mt("noDifferences") : mt("valueOfPixelsDiffer", { p0: (versionDiff.mismatch * 100).toFixed(2) })}</span>}</>}>
          <div className="make-version-grid">
            <figure><figcaption>{mt("snapshot_713977")}{state?.snapshots.find((s) => s.id === versionCompare)?.label ?? versionCompare}»</figcaption><iframe ref={(el) => { versionFrames.current.a = el }} title={mt("versionFromHistory")} sandbox="allow-scripts allow-same-origin" src={`${base}${MAKE_SNAPSHOT_PREVIEW}/${encodeURIComponent(versionCompare)}/index.html`} /></figure>
            <figure><figcaption>{mt("currentState")}</figcaption><iframe ref={(el) => { versionFrames.current.b = el }} title={mt("currentVersion")} sandbox="allow-scripts allow-same-origin" src={previewSrc} /></figure>
            {versionDiff && <figure data-testid="make-version-diff"><figcaption>{mt("differenceMap")}</figcaption><img src={versionDiff.url} alt={mt("versionDifferenceMap")} /></figure>}
          </div>
        </Dialog>
      )}
      {exportOpen && (
        <Dialog className="make-dialog" padded title={mt("downloadProject")} ariaLabel={mt("downloadProject")} size="sm" onClose={() => setExportOpen(false)} testId="make-export">
          <div className="make-export-options">
            <button type="button" className="make-idea" onClick={() => { window.open(exportUrl(false), '_blank', 'noopener'); setExportOpen(false) }}>
              <strong>{mt("staticFilesAsIs")}</strong>
              <span>{mt("zipWithProjectFilesOpenIndexHtmlDirectlyOr")}</span>
            </button>
            <button type="button" className="make-idea" onClick={() => { window.open(exportUrl(true), '_blank', 'noopener'); setExportOpen(false) }}>
              <strong>{mt("viteProject")}</strong>
              <span>{mt("includesPackageJsonViteConfigAndReadmeExtractThe")}{' '}<code>npm install</code>, <code>npm run dev</code>{' '}{mt("andContinueInYourOwnEditor")}</span>
            </button>
          </div>
          <label className="make-export-pwa">{mt("hosting")}{' '}<select aria-label={mt("exportHostingTarget")} value={exportDeploy} onChange={(e) => setExportDeploy(e.target.value as MakeDeployTarget | '')}><option value="">{mt("noConfiguration")}</option>{MAKE_DEPLOY_TARGETS.map((t) => <option key={t.id} value={t.id}>{localizeMakeText(t.title)}</option>)}</select> <small>{mt("addsConfigurationAndDeployMdToTheArchive")}</small></label>
          <label className="make-export-pwa"><input type="checkbox" checked={exportPwa} onChange={(e) => setExportPwa(e.target.checked)} />{' '}{mt("addPwaSupportManifestServiceWorkerAndIconTo")}</label>
        </Dialog>
      )}
      {importOpen && (
        <Dialog className="make-dialog" padded title={mt("importProject_f8374a")} ariaLabel={mt("importProject_f8374a")} size="sm" onClose={() => setImportOpen(false)} testId="make-import" closeOnOverlay={false}>
          <p className="make-ideas-lead">{mt("aSnapshotWillBeSavedBeforeImportingYouCan")}</p>
          <fieldset className="make-import-mode">
            <legend>{mt("importMode")}</legend>
            <label><input type="radio" name="make-import-mode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} />{' '}{mt("replaceProject")}</label>
            <label><input type="radio" name="make-import-mode" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} />{' '}{mt("addToExistingFiles")}</label>
          </fieldset>
          <section className="make-import-block">
            <h3>{mt("zipArchive")}</h3>
            <p>{mt("projectFilesAtTheArchiveRootOrInsideOne")}</p>
            <input ref={importZipRef} type="file" accept=".zip,application/zip" aria-label={mt("projectZipArchive")} data-testid="make-import-zip" disabled={importing} onChange={(e) => { const f = e.target.files?.[0]; if (f) void runImport('zip', f) }} />
          </section>
          <section className="make-import-block">
            <h3>{mt("pageUrl")}</h3>
            <p>{mt("downloadHtmlAndItsStylesScriptsAndImagesFrom")}</p>
            <div className="make-import-url">
              <input type="url" aria-label={mt("pageAddress")} placeholder={mt("httpsExampleComOrHttpsGithubComUserRepo")} value={importUrl} onChange={(e) => setImportUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runImport('url') }} disabled={importing} />
              <Button size="sm" variant="primary" onClick={() => void runImport('url')} loading={importing} disabled={!importUrl.trim()}>{mt("import")}</Button>
            </div>
          </section>
        </Dialog>
      )}
      {ideasOpen && (
        <Dialog className="make-dialog" padded title={mt("starterIdeas_199213")} ariaLabel={mt("starterIdeas_199213")} size="md" onClose={() => setIdeasOpen(false)} testId="make-ideas">
          <p className="make-ideas-lead">{mt("readyToUsePromptsInspiredByFigmaMakeClick")}</p>
          {(Object.keys(MAKE_STARTER_GROUPS) as Array<keyof typeof MAKE_STARTER_GROUPS>).map((group) => (
            <section key={group} className="make-ideas-group">
              <h3>{localizeMakeText(MAKE_STARTER_GROUPS[group])}</h3>
              {MAKE_STARTER_PROMPTS.filter((i) => i.group === group).map((item) => (
                <button key={item.id} type="button" className="make-idea" onClick={() => useStarter(item.prompt)}>
                  <strong>{localizeMakeText(item.title)}</strong>
                  <span>{localizeMakeText(item.prompt)}</span>
                </button>
              ))}
            </section>
          ))}
        </Dialog>
      )}
      {publishOpen && (
        <Dialog className="make-dialog" padded title={mt("publishProject")} ariaLabel={mt("publishProject")} size="sm" onClose={() => setPublishOpen(false)} testId="make-publish">
          {state?.published ? (
            <div className="make-publish">
              <p className="fsub">{mt("anyoneWithTheLinkCanOpenItWithoutSigning")}{' '}
                {state.published.snapshotId
                  ? <>{mt("pinnedVersion")}{' '}<strong>«{state.published.snapshotLabel}»</strong>{' '}{mt("changesRemainHiddenUntilYouUpdateThePublication")}</>
                  : <>{mt("servesCurrentFilesChangesAppearImmediately")}</>}
              </p>
              <div className="make-publish-link">
                <code data-testid="make-public-url">{typeof window !== 'undefined' ? new URL(state.published.slugUrl ?? state.published.url, window.location.origin).toString() : (state.published.slugUrl ?? state.published.url)}</code>
                <Button size="sm" variant="secondary" onClick={() => void copyPublicLink()}>{mt("copy")}</Button>
                <Button size="sm" variant="ghost" onClick={() => window.open(`${state.published!.url}?makeLocale=${locale}`, '_blank', 'noopener')}>{mt("open_125957")}</Button>
              </div>
              <div className="make-publish-pin">
                <label htmlFor="make-publish-pick">{mt("whatToPublish")}</label>
                <select id="make-publish-pick" value={publishPick || (state.published.snapshotId ?? '')} onChange={(e) => setPublishPick(e.target.value)}>
                  <option value="">{mt("currentStateUpdatesImmediately")}</option>
                  {state.snapshots.map((s) => <option key={s.id} value={s.id}>{mt("snapshot_849324")}{' '}{localizeMakeText(s.label)} · {formatTime(s.createdAt)}</option>)}
                </select>
              </div>
              <div className="make-publish-access">
                <label className="make-ask-field"><span>{mt("address")}{' '}<small>{mt("sLatinLettersDigitsAndHyphens")}</small></span><input className="tin" aria-label={mt("publicationAddress")} placeholder="my-site" value={publishSlug ?? state.published.slug ?? ''} onChange={(e) => setPublishSlug(e.target.value.toLowerCase())} /></label>
                <label className="make-ask-field"><span>{mt("password")}{' '}{state.published.passwordProtected ? <small>{mt("set")}</small> : <small>{mt("noneAnyoneWithTheLinkCanOpenIt")}</small>}</span><input className="tin" type="password" aria-label={mt("publicationPassword")} placeholder={state.published.passwordProtected ? mt("newPassword") : mt("noPassword")} value={publishPassword} onChange={(e) => setPublishPassword(e.target.value)} autoComplete="new-password" /></label>
                <p className="fsub make-publish-views">{mt("views")}{' '}<strong data-testid="make-public-views">{state.published.views ?? 0}</strong></p>
                {(state.published.stats?.days.length ?? 0) > 0 && (
                  <div className="make-publish-stats" data-testid="make-publish-stats">
                    <div className="make-publish-bars" role="img" aria-label={mt("viewsOverTheLastValueDays", { p0: Math.min(14, state.published.stats!.days.length) })}>
                      {state.published.stats!.days.slice(-14).map((d) => { const max = Math.max(...state.published!.stats!.days.slice(-14).map((x) => x.views), 1); return <span key={d.day} className="make-publish-bar" style={{ height: `${Math.max(8, Math.round((d.views / max) * 100))}%` }} title={`${d.day}: ${d.views}`} /> })}
                    </div>
                    {state.published.stats!.referers.length > 0 && <p className="fsub">{mt("referrers")}{' '}{state.published.stats!.referers.slice(0, 5).map((r) => `${r.host} (${r.views})`).join(', ')}</p>}
                  </div>
                )}
              </div>
              {(state.published.history?.length ?? 0) > 1 && (
                <details className="make-publish-history" data-testid="make-publish-history">
                  <summary>{mt("publicationHistory")}{state.published.history!.length})</summary>
                  <ul role="list">
                    {[...state.published.history!].reverse().map((e, i) => (
                      <li key={`${e.at}-${i}`}>
                        <span>{formatTime(e.at)} · {e.snapshotId ? mt("snapshotValue", { p0: e.snapshotLabel }) : mt("currentState_f6ce32")}</span>
                        {i === 0 ? <small>{mt("now")}</small> : (e.snapshotId === null || state.snapshots.some((s) => s.id === e.snapshotId))
                          ? <><Button size="sm" variant="ghost" onClick={() => void publish(e.snapshotId, publishOptions())}>{mt("restore")}</Button>{e.snapshotId && <Button size="sm" variant="ghost" onClick={() => setVersionCompare(e.snapshotId!)} title={mt("openThisVersionBesideTheCurrentOneWithA")}>{mt("compare")}</Button>}</>
                          : <small>{mt("snapshotDeleted")}</small>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="make-ask-actions">
                <Button size="sm" variant="secondary" onClick={() => void publish((publishPick || state.published?.snapshotId) || null, publishOptions())}>{mt("updatePublication")}</Button>
                {state.published.passwordProtected && <Button size="sm" variant="ghost" onClick={() => void publish((publishPick || state.published?.snapshotId) || null, { password: null })}>{mt("removePassword")}</Button>}
                <label className="make-autosave" title={mt("thePublishedPageWillHaveACommentButtonViewer")}><input type="checkbox" aria-label={mt("viewerComments")} checked={Boolean(state.published.allowComments)} onChange={(e) => void publish((publishPick || state.published?.snapshotId) || null, { allowComments: e.target.checked })} />{' '}{mt("viewerComments_1674ce")}</label>
              </div>
              <div className="make-ask-actions"><Button size="sm" variant="danger" onClick={() => void unpublish()}>{mt("unpublishProject")}</Button></div>
            </div>
          ) : (
            <div className="make-publish">
              <p className="fsub">{mt("theProjectWillReceiveAnUnlistedLinkSuchAs")}{' '}<code>{mt("pToken")}</code>{mt("noSignInRequiredExcludedFromSearchIndexingAnd")}</p>
              <div className="make-ask-actions"><Button size="sm" variant="primary" onClick={() => void publish()}>{mt("publish")}</Button></div>
            </div>
          )}
          <div className="make-share" data-testid="make-share">
            <h4>{mt("readOnlyAccessInChatai")}</h4>
            {state?.shared ? (
              <>
                <p className="fsub">{mt("colleaguesWithAChataiAccountCanSeeThePreview")}</p>
                <div className="make-publish-link">
                  <code data-testid="make-share-url">{typeof window !== 'undefined' ? `${window.location.origin}/${state.shared.url}` : state.shared.url}</code>
                  <Button size="sm" variant="secondary" onClick={() => void copyShareLink(typeof window !== 'undefined' ? `${window.location.origin}/${state.shared!.url}` : state.shared!.url)}>{mt("copy")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => void toggleShare()}>{mt("revoke")}</Button>
                </div>
                <div className="make-grants" data-testid="make-grants">
                  <p className="fsub">{mt("namedAccessEditorsCanChangeFilesAndSnapshotsOn")}</p>
                  {(state.shared.grants ?? []).length > 0 && (
                    <ul role="list">
                      {state.shared.grants!.map((g) => (
                        <li key={g.user}><code>{g.user}</code><span>{g.role === 'editor' ? mt("editor") : mt("viewer")}</span>
                          <IconButton size="sm" aria-label={mt("removeAccessForValue", { p0: g.user })} title={mt("removeAccess")} onClick={() => void grant(g.user, null)}>✕</IconButton></li>
                      ))}
                    </ul>
                  )}
                  <form className="make-grant-add" onSubmit={(e) => { e.preventDefault(); void grant(grantUser, grantRole); setGrantUser('') }}>
                    <input className="tin" aria-label={mt("username")} placeholder={mt("username_1fd2f9")} value={grantUser} onChange={(e) => setGrantUser(e.target.value)} />
                    <select aria-label={mt("role")} value={grantRole} onChange={(e) => setGrantRole(e.target.value as 'editor' | 'viewer')}><option value="viewer">{mt("viewer")}</option><option value="editor">{mt("editor")}</option></select>
                    <Button size="sm" variant="secondary" type="submit" disabled={!grantUser.trim()}>{mt("grantAccess")}</Button>
                  </form>
                </div>
              </>
            ) : <div className="make-ask-actions"><Button size="sm" variant="secondary" onClick={() => void toggleShare()}>{mt("createReadOnlyLink")}</Button></div>}
          </div>
        </Dialog>
      )}

      {templatesOpen && (
        <Dialog className="make-dialog" padded title={mt("projectTemplates_0a30aa")} ariaLabel={mt("projectTemplates_0a30aa")} size="md" onClose={() => setTemplatesOpen(false)} testId="make-templates">
          <ul className="make-templates" aria-label={mt("templates")}>
            {MAKE_TEMPLATES.filter((t) => !projectSettings || isMakeTemplateCompatible(t, projectSettings.stack)).map((t) => (
              <li key={t.id} className="make-template">
                <span className="make-template-meta"><strong>{localizeMakeText(t.title)}</strong><small>{localizeMakeText(t.description)}</small></span>
                <Button size="sm" variant="secondary" onClick={() => void applyTemplate(t.id, localizeMakeText(t.title))}>{mt("apply")}</Button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}

      {ask && (
        <Dialog className="make-dialog" padded title={ask.title} ariaLabel={ask.title} size="sm" onClose={() => setAsk(null)} testId="make-ask">
          <form className="make-ask" onSubmit={(e) => { e.preventDefault(); const value = askValue.trim(); setAsk(null); if (value) ask.onSubmit(value) }}>
            <label className="make-ask-field"><span>{localizeMakeText(ask.label)}</span><input className="tin" autoFocus value={askValue} aria-label={localizeMakeText(ask.label)} onChange={(e) => setAskValue(e.target.value)} /></label>
            <div className="make-ask-actions">
              <Button size="sm" variant="secondary" type="button" onClick={() => setAsk(null)}>{mt("cancel")}</Button>
              <Button size="sm" variant="primary" type="submit" disabled={!askValue.trim()}>{ask.submit}</Button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  )
}
