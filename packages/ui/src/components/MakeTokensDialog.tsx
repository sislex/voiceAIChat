// Дизайн-токены проекта Make (п.23): CSS-переменные из `:root` в tokens.css/styles.css.
// Точечные правки значений без открытия кода: цвет — пикером, размер/шрифт — текстом.
// Пишем через тот же make:write, что и редактор, поэтому превью и снимки узнают о правке сами.
import { useEffect, useMemo, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeProjectState } from '@shared/make'
import { MAKE_TOKENS_STARTER, parseCssTokens, pickTokensFile, removeCssToken, setCssToken, type MakeCssToken, type MakeTokenKind } from '@shared/makeTokens'
import { Button, Dialog, EmptyState, IconButton, useToast } from '@voicechat/ui-kit'

interface Props {
  conversationId: string
  api: Pick<RendererApi, 'make:read' | 'make:write'>
  files: readonly string[]
  onClose: () => void
  /** Проект после записи — панель обновит состояние и превью. */
  onWritten: (next: MakeProjectState) => void
}

const KIND_TITLE: Record<MakeTokenKind, string> = { color: 'Цвета', size: 'Размеры и отступы', font: 'Шрифты', other: 'Прочее' }
const KIND_ORDER: MakeTokenKind[] = ['color', 'size', 'font', 'other']
const isHex6 = (v: string): boolean => /^#[0-9a-f]{6}$/i.test(v.trim())

function describeError(e: unknown): string { return e instanceof Error ? e.message : String(e) }

export function MakeTokensDialog({ conversationId, api, files, onClose, onWritten }: Props): JSX.Element {
  const toast = useToast()
  const target = useMemo(() => pickTokensFile(files), [files])
  const [css, setCss] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!target) { setCss(''); return }
    let alive = true
    api['make:read']({ conversationId, path: target }).then((r) => { if (alive) setCss(r.content) }).catch((e) => { if (alive) { setCss(''); toast.error(describeError(e)) } })
    return () => { alive = false }
  }, [api, conversationId, target, toast])

  const tokens: MakeCssToken[] = useMemo(() => parseCssTokens(css ?? ''), [css])
  const changed = tokens.filter((t) => draft[t.name] !== undefined && draft[t.name] !== t.value)

  const write = async (path: string, content: string, note: string): Promise<void> => {
    setBusy(true)
    try {
      const next = await api['make:write']({ conversationId, path, content })
      onWritten(next)
      setCss(content)
      toast.success(note)
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }

  /** Стартовый tokens.css + <link> в index.html перед первой таблицей стилей, чтобы токены были видны везде. */
  const createStarter = async (): Promise<void> => {
    setBusy(true)
    try {
      let next = await api['make:write']({ conversationId, path: 'tokens.css', content: MAKE_TOKENS_STARTER })
      if (files.includes('index.html')) {
        const index = (await api['make:read']({ conversationId, path: 'index.html' })).content
        if (!/href=["']\.?\/?tokens\.css["']/i.test(index)) {
          const link = '<link rel="stylesheet" href="tokens.css">'
          const patched = /<link[^>]*rel=["']stylesheet["'][^>]*>/i.test(index)
            ? index.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/i, (m) => `${link}\n  ${m}`)
            : index.replace(/<\/head>/i, `  ${link}\n</head>`)
          if (patched !== index) next = await api['make:write']({ conversationId, path: 'index.html', content: patched })
        }
      }
      onWritten(next)
      setCss(MAKE_TOKENS_STARTER)
      toast.success('tokens.css создан и подключён в index.html')
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }

  const save = async (): Promise<void> => {
    if (!target || css === null) return
    let out = css
    for (const t of changed) out = setCssToken(out, t.name, draft[t.name]!)
    await write(target, out, `Обновлено токенов: ${changed.length} → ${target}`)
    setDraft({})
  }

  const add = async (): Promise<void> => {
    const name = newName.trim().startsWith('--') ? newName.trim() : `--${newName.trim()}`
    if (!/^--[\w-]+$/.test(name) || !newValue.trim() || css === null) return
    const path = target ?? 'tokens.css'
    await write(path, setCssToken(css, name, newValue), `Токен ${name} добавлен`)
    setNewName(''); setNewValue('')
  }

  const remove = async (name: string): Promise<void> => {
    if (!target || css === null) return
    await write(target, removeCssToken(css, name), `Токен ${name} удалён`)
  }

  const source = target ?? 'tokens.css'
  return (
    <Dialog className="make-dialog" title="Дизайн-токены" ariaLabel="Дизайн-токены" size="md" onClose={onClose} testId="make-tokens"
      footer={tokens.length > 0 ? <Button variant="primary" size="sm" disabled={changed.length === 0 || busy} loading={busy} onClick={() => void save()}>Сохранить{changed.length > 0 ? ` (${changed.length})` : ''}</Button> : undefined}>
      <p className="make-ideas-lead">CSS-переменные из <code>:root</code> файла <code>{source}</code>. Меняются здесь — подхватывают все компоненты; ассистент тоже использует их вместо жёстких значений.</p>
      {css === null ? <p className="fsub">Загрузка…</p> : tokens.length === 0 ? (
        <EmptyState title="Токенов пока нет" description="Создайте tokens.css со стартовым набором (цвета, отступы, радиус, шрифты) — он подключится в index.html." actionLabel="Создать tokens.css" onAction={() => void createStarter()} />
      ) : KIND_ORDER.filter((k) => tokens.some((t) => t.kind === k)).map((kind) => (
        <section key={kind} className="make-tokens-group" aria-label={KIND_TITLE[kind]}>
          <h4>{KIND_TITLE[kind]}</h4>
          <ul className="make-tokens" role="list">
            {tokens.filter((t) => t.kind === kind).map((t) => {
              const value = draft[t.name] ?? t.value
              return (
                <li key={t.name} className="make-token">
                  <code className="make-token-name" title={`var(${t.name})`}>{t.name}</code>
                  {kind === 'color' && isHex6(value) && <input type="color" aria-label={`Цвет ${t.name}`} value={value.trim().toLowerCase()} onChange={(e) => setDraft((d) => ({ ...d, [t.name]: e.target.value }))} />}
                  {kind === 'color' && !isHex6(value) && <span className="make-token-swatch" style={{ background: value }} aria-hidden="true" />}
                  <input className="make-token-value" aria-label={`Значение ${t.name}`} value={value} onChange={(e) => setDraft((d) => ({ ...d, [t.name]: e.target.value }))} />
                  <IconButton size="sm" aria-label={`Удалить ${t.name}`} title="Удалить токен" disabled={busy} onClick={() => void remove(t.name)}>✕</IconButton>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {css !== null && (
        <form className="make-token-add" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <input aria-label="Имя нового токена" placeholder="--имя" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input aria-label="Значение нового токена" placeholder="значение" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          <Button size="sm" variant="secondary" type="submit" disabled={busy || !newName.trim() || !newValue.trim()}>+ Токен</Button>
        </form>
      )}
    </Dialog>
  )
}
