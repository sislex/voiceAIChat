// Редактор кода панели Make. В браузере — Monaco (движок VS Code), лениво; в jsdom (тесты и
// axe-прогон сториз) Monaco не поднимается — там textarea с подсветкой highlight.js поверх <pre>.
// Оба варианта держат один контракт: value/onChange/onSave и aria-label «Содержимое <файл>».
import { Suspense, lazy, useMemo, useRef, type KeyboardEvent } from 'react'
import { highlightCode } from '../lib/codeHighlight'

export interface CodeEditorProps {
  path: string
  value: string
  onChange: (next: string) => void
  onSave?: () => void
  ariaLabel: string
  /** Маркеры ошибок (строка с 1) — подчёркивание в Monaco; фолбэк их не рисует. */
  markers?: EditorMarker[]
  /** Остальные текстовые файлы проекта — модели для резолва импортов (переход к определению). */
  projectFiles?: ReadonlyArray<{ path: string; content: string }>
  /** Выделение изменилось (для inline-команды ассистенту); null — пустое. */
  onSelectionChange?: (sel: EditorSelection | null) => void
  /** Cmd/Ctrl+I в редакторе — «сделай с выделенным…» (⌘K занят палитрой команд приложения). */
  onInlineCommand?: () => void
  /** Только чтение (read-only шаринг, п.33): правки и сохранение отключены. */
  readOnly?: boolean
  /** Строки, изменённые последней правкой ассистента (roadmap-4 п.9) — подсвечиваются в Monaco. */
  changedLines?: number[]
}

export interface EditorSelection { startLine: number; endLine: number; text: string }

export interface EditorMarker { line: number; column?: number; message: string }

import { useMediaQuery } from '../lib/mediaQuery'

const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)

/** Телефонная ширина для редактора (п.34): Monaco на узком экране с виртуальной клавиатурой неудобен и тяжёл. */
export const PHONE_EDITOR_QUERY = '(max-width: 600px)'

/** Лёгкий редактор (textarea + подсветка) вместо Monaco: в jsdom и на телефоне. */
export function shouldUseFallbackEditor(jsdom: boolean, phone: boolean): boolean {
  return jsdom || phone
}
const MonacoCodeEditor = lazy(() => import('./code/MonacoCodeEditor'))

export function CodeEditor(props: CodeEditorProps): JSX.Element {
  const phone = useMediaQuery(PHONE_EDITOR_QUERY)
  if (shouldUseFallbackEditor(isJsdom, phone)) return <FallbackEditor {...props} />
  return (
    <Suspense fallback={<FallbackEditor {...props} />}>
      <MonacoCodeEditor {...props} />
    </Suspense>
  )
}

/** Textarea + подсветка: прозрачный textarea поверх <pre> с теми же метриками, скролл синхронизирован. */
export function FallbackEditor({ path, value, onChange, onSave, ariaLabel, onSelectionChange, onInlineCommand, readOnly }: CodeEditorProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const highlightRef = useRef<HTMLPreElement | null>(null)
  const highlighted = useMemo(() => highlightCode(value, path), [value, path])
  const syncScroll = (): void => {
    const ta = textareaRef.current, pre = highlightRef.current
    if (ta && pre) { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft }
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); onSave?.(); return }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') { event.preventDefault(); onInlineCommand?.(); return }
    if (event.key === 'Tab') {
      event.preventDefault()
      const el = event.currentTarget
      const start = el.selectionStart, end = el.selectionEnd
      const next = value.slice(0, start) + '  ' + value.slice(end)
      onChange(next)
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2 })
    }
  }
  return (
    <div className="make-editor-body">
      <pre ref={highlightRef} className="make-highlight" aria-hidden="true"><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
      <textarea
        ref={textareaRef}
        readOnly={readOnly}
        className="make-textarea"
        aria-label={ariaLabel}
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onScroll={syncScroll}
        onSelect={(e) => {
          const el = e.currentTarget
          if (!onSelectionChange) return
          if (el.selectionStart === el.selectionEnd) { onSelectionChange(null); return }
          const before = value.slice(0, el.selectionStart).split('\n').length
          const lines = value.slice(el.selectionStart, el.selectionEnd).split('\n').length
          onSelectionChange({ startLine: before, endLine: before + lines - 1, text: value.slice(el.selectionStart, el.selectionEnd) })
        }}
      />
    </div>
  )
}
