import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Dialog } from '../ui/Dialog'
import { useConfirm } from '../ui/useConfirm'
import { useToast } from '../ui/Toast'
import { copyText } from '../../lib/clipboard'
import { WandIcon } from '../icons'
import type { ModifierPrompt } from '@shared/types'

export type { ModifierPrompt }
export type Suggestion = { id: string; text: string }
export type Block = { id: string; text: string }
export type GenerateParams = { prompt: string; modifiers: ModifierPrompt[]; signal: AbortSignal }

export interface Labels {
  title: string; settingsTitle: string; close: string; settings: string; back: string
  promptLabel: string; promptPlaceholder: string; preview: string; collapse: string; expand: string
  copy: string; clearAll: string; clearConfirm: string; cancelConfirm: string; loading: string
  empty: string; error: string; retry: string; remove: string; replace: string; add: string
  blocks: string; moveUp: string; moveDown: string; refine: string; apply: string
  addPrompt: string; edit: string; view: string; save: string; cancel: string; delete: string
  deleteConfirm: string; titleLabel: string; textLabel: string; enabled: string; noPrompts: string
  duplicateTitle: string; requiredText: string; tooLong: string; maxBlocks: string; generate: string
  confirm: string; copied: string
}

const RU: Labels = {
  title: 'AI-помощник формулировки', settingsTitle: 'Настройки подсказок', close: 'Закрыть', settings: 'Настройки', back: 'Назад',
  promptLabel: 'Что нужно сформулировать', promptPlaceholder: 'Опишите, какой текст вам нужен…', preview: 'Собранный текст', collapse: 'Свернуть', expand: 'Развернуть',
  copy: 'Копировать', clearAll: 'Очистить всё', clearConfirm: 'Удалить все собранные абзацы?', cancelConfirm: 'Отменить сборку?', loading: 'Генерирую варианты…',
  empty: 'Вариантов нет', error: 'Не удалось получить варианты', retry: 'Повторить', remove: 'Удалить', replace: 'Заменить', add: 'Добавить',
  blocks: 'Абзацы результата', moveUp: 'Вверх', moveDown: 'Вниз', refine: 'На доработку', apply: 'Применить', addPrompt: 'Добавить промпт',
  edit: 'Изменить', view: 'Просмотр', save: 'Сохранить', cancel: 'Отмена', delete: 'Удалить', deleteConfirm: 'Удалить этот промпт?', titleLabel: 'Название',
  textLabel: 'Текст промпта', enabled: 'Активен', noPrompts: 'Дополнительных подсказок пока нет.', duplicateTitle: 'Название должно быть уникальным', requiredText: 'Введите текст промпта',
  tooLong: 'Текст слишком длинный', maxBlocks: 'Достигнут лимит абзацев', generate: 'Предложить варианты',
  confirm: 'Подтвердить', copied: 'Скопировано'
}

export interface PromptBuilderProps {
  open: boolean
  initialValue?: string
  prompts: ModifierPrompt[]
  onPromptsChange?: (next: ModifierPrompt[]) => void
  generate: (params: GenerateParams) => Promise<Suggestion[]>
  onApply: (text: string) => void
  onClose: () => void
  joinSeparator?: string
  maxBlocks?: number
  debounceMs?: number
  labels?: Partial<Labels>
}

type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
type Editor = { id: string | null; title: string; text: string } | null
const id = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

export function PromptBuilder({ open, initialValue: _initialValue = '', prompts, onPromptsChange, generate, onApply, onClose, joinSeparator = '\n\n', maxBlocks = 12, labels }: PromptBuilderProps): JSX.Element | null {
  void _initialValue
  const l = { ...RU, ...labels }
  const confirm = useConfirm()
  const toast = useToast()
  const [mode, setMode] = useState<'builder' | 'settings'>('builder')
  const [prompt, setPrompt] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [collapsed, setCollapsed] = useState(false)
  const [localPrompts, setLocalPrompts] = useState(prompts)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const wasOpen = useRef(false)
  const generationRef = useRef<AbortController | null>(null)
  const assembled = useMemo(() => blocks.map((b) => b.text).join(joinSeparator), [blocks, joinSeparator])
  const active = useMemo(() => localPrompts.filter((p) => p.enabled), [localPrompts])
  const activeKey = active.map((p) => `${p.id}:${p.text}`).join('|')

  useEffect(() => {
    if (open && !wasOpen.current) {
      setMode('builder'); setPrompt(''); setSuggestions([]); setBlocks([]); setStatus('idle'); setCollapsed(false); setEditor(null); setLocalPrompts(prompts)
    }
    wasOpen.current = open
  }, [open, prompts])

  useEffect(() => { if (!open) setLocalPrompts(prompts) }, [open, prompts])

  useEffect(() => {
    generationRef.current?.abort()
    generationRef.current = null
    setSuggestions([])
    setStatus('idle')
  }, [open, prompt, activeKey])

  useEffect(() => () => generationRef.current?.abort(), [])

  const generateSuggestions = (): void => {
    const text = prompt.trim()
    if (!open || !text || status === 'loading') return
    generationRef.current?.abort()
    const controller = new AbortController()
    generationRef.current = controller
    setSuggestions([])
    setStatus('loading')
    void generate({ prompt: text, modifiers: active, signal: controller.signal }).then((next) => {
      if (controller.signal.aborted) return
      generationRef.current = null
      setSuggestions(next)
      setStatus(next.length ? 'ready' : 'empty')
    }).catch(() => {
      if (controller.signal.aborted) return
      generationRef.current = null
      setStatus('error')
    })
  }

  // Dialog ждёт синхронный обработчик, а подтверждение — промис: закрываем после ответа.
  const requestClose = (): void => { void confirmClose() }
  const confirmClose = async (): Promise<void> => {
    if (mode === 'settings' && editor) { setEditor(null); return }
    if (blocks.length && !(await confirm({ title: l.cancelConfirm, confirmLabel: l.confirm, cancelLabel: l.back }))) return
    onClose()
  }
  const changePrompts = (next: ModifierPrompt[]): void => { setLocalPrompts(next); onPromptsChange?.(next) }
  const move = <T,>(items: T[], index: number, delta: number): T[] => { const next = [...items]; const [item] = next.splice(index, 1); next.splice(index + delta, 0, item); return next }
  const saveEditor = (): void => {
    if (!editor) return
    const title = editor.title.trim(), text = editor.text.trim()
    if (!text || text.length > 2000 || localPrompts.some((p) => p.id !== editor.id && p.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase())) return
    changePrompts(editor.id ? localPrompts.map((p) => p.id === editor.id ? { ...p, title, text } : p) : [...localPrompts, { id: id(), title, text, enabled: true }])
    setEditor(null)
  }
  const editorError = editor ? (!editor.text.trim() ? l.requiredText : editor.text.length > 2000 ? l.tooLong : localPrompts.some((p) => p.id !== editor.id && p.title.trim().toLocaleLowerCase() === editor.title.trim().toLocaleLowerCase()) ? l.duplicateTitle : '') : ''

  if (!open) return null
  // Окно живёт в общей рамке Dialog: фокус, Esc, клик по фону и полный экран на
  // телефоне — оттуда; здесь только две колонки сборки и раздел настроек.
  return <Dialog
    size="lg"
    testId="prompt-builder"
    title={mode === 'builder' ? l.title : l.settingsTitle}
    closeLabel={l.close}
    onClose={requestClose}
    initialFocusRef={promptRef}
    actions={mode === 'builder'
      ? <IconButton className="pb-icon" onClick={() => setMode('settings')} aria-label={l.settings} title={l.settings}>⚙</IconButton>
      : <Button size="sm" onClick={() => { setEditor(null); setMode('builder') }}>{l.back}</Button>}
  >
      {mode === 'builder' ? <div className="pb-builder">
        <section className="pb-column pb-generation">
          <label className="pb-label">{l.promptLabel}<span className="pb-prompt-wrap"><textarea ref={promptRef} rows={4} value={prompt} placeholder={l.promptPlaceholder} onChange={(e) => setPrompt(e.target.value)} /><IconButton className="pb-generate" variant="primary" loading={status === 'loading'} disabled={!prompt.trim()} onClick={generateSuggestions} aria-label={l.generate} title={l.generate}><WandIcon /></IconButton></span></label>
          {blocks.length > 0 && <div className="pb-preview"><div className="pb-row"><strong>{l.preview}</strong><div><Button size="sm" onClick={() => setCollapsed(!collapsed)}>{collapsed ? l.expand : l.collapse}</Button><Button size="sm" onClick={() => void copyText(assembled).then((ok) => { if (ok) toast.success(l.copied) })}>{l.copy}</Button><Button size="sm" onClick={() => void confirm({ title: l.clearConfirm, variant: 'danger', confirmLabel: l.clearAll, cancelLabel: l.cancel }).then((ok) => { if (ok) setBlocks([]) })}>{l.clearAll}</Button></div></div>{!collapsed && <div data-testid="prompt-preview">{assembled}</div>}</div>}
          <div className="pb-status" aria-live="polite">{status === 'loading' ? l.loading : status === 'empty' ? l.empty : status === 'error' ? <>{l.error} <Button size="sm" onClick={generateSuggestions}>{l.retry}</Button></> : null}</div>
          {status === 'loading' && <div className="pb-skeletons" aria-hidden="true"><i/><i/><i/></div>}
          <div className="pb-list">{suggestions.map((s) => <article className="pb-item" key={s.id}><p>{s.text}</p><div><Button size="sm" aria-label={`${l.remove}: ${s.text}`} onClick={() => setSuggestions((all) => all.filter((x) => x.id !== s.id))}>{l.remove}</Button><Button size="sm" onClick={() => setPrompt(s.text)}>{l.replace}</Button><Button size="sm" disabled={blocks.length >= maxBlocks} title={blocks.length >= maxBlocks ? l.maxBlocks : undefined} onClick={() => setBlocks((all) => [...all, { id: id(), text: s.text }])}>{l.add}</Button></div></article>)}</div>
        </section>
        <section className="pb-column pb-blocks"><h3>{l.blocks}</h3><div className="pb-list">{blocks.map((b, index) => <article className="pb-item" key={b.id}><p>{b.text}</p><div><Button size="sm" aria-label={`${l.remove}: ${b.text}`} onClick={() => setBlocks((all) => all.filter((x) => x.id !== b.id))}>{l.remove}</Button><Button size="sm" disabled={index === 0} onClick={() => setBlocks((all) => move(all, index, -1))}>{l.moveUp}</Button><Button size="sm" disabled={index === blocks.length - 1} onClick={() => setBlocks((all) => move(all, index, 1))}>{l.moveDown}</Button><Button size="sm" onClick={() => { setBlocks((all) => all.filter((x) => x.id !== b.id)); setPrompt(b.text); promptRef.current?.focus() }}>{l.refine}</Button></div></article>)}</div><Button variant="primary" className="pb-apply" disabled={!blocks.length} onClick={() => { onApply(assembled); onClose() }}>{l.apply}</Button></section>
      </div> : <section className="pb-settings">
        {localPrompts.length === 0 && <div className="pb-empty">{l.noPrompts}</div>}
        <div className="pb-list">{localPrompts.map((item, index) => <article className="pb-item pb-modifier" key={item.id}>
          <label className="pb-switch"><input type="checkbox" checked={item.enabled} aria-label={`${l.enabled}: ${item.title}`} onChange={(e) => changePrompts(localPrompts.map((p) => p.id === item.id ? { ...p, enabled: e.target.checked } : p))}/><span/></label>
          <div><strong>{item.title}</strong><p className={expanded === item.id ? '' : 'pb-ellipsis'}>{item.text}</p></div>
          <div><Button size="sm" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{l.view}</Button>{!item.readonly && <><Button size="sm" onClick={() => setEditor({ id: item.id, title: item.title, text: item.text })}>{l.edit}</Button>{onPromptsChange && <Button size="sm" onClick={() => void confirm({ title: l.deleteConfirm, variant: 'danger', confirmLabel: l.delete, cancelLabel: l.cancel }).then((ok) => { if (ok) changePrompts(localPrompts.filter((p) => p.id !== item.id)) })}>{l.delete}</Button>}</>}<Button size="sm" disabled={index === 0} onClick={() => changePrompts(move(localPrompts, index, -1))}>{l.moveUp}</Button><Button size="sm" disabled={index === localPrompts.length - 1} onClick={() => changePrompts(move(localPrompts, index, 1))}>{l.moveDown}</Button></div>
        </article>)}</div>
        {editor && <div className="pb-editor"><label>{l.titleLabel}<input value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })}/></label><label>{l.textLabel}<textarea rows={5} value={editor.text} onChange={(e) => setEditor({ ...editor, text: e.target.value })}/></label>{editorError && <p role="alert">{editorError}</p>}<div><Button size="sm" onClick={() => setEditor(null)}>{l.cancel}</Button><Button size="sm" disabled={!!editorError} onClick={saveEditor}>{l.save}</Button></div></div>}
        {onPromptsChange && !editor && <Button variant="primary" className="pb-add-prompt" onClick={() => setEditor({ id: null, title: '', text: '' })}>{l.addPrompt}</Button>}
      </section>}
  </Dialog>
}
