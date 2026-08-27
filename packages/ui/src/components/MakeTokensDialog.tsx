// Дизайн-токены проекта Make (п.23): CSS-переменные из `:root` в tokens.css/styles.css.
// Точечные правки значений без открытия кода: цвет — пикером, размер/шрифт — текстом.
// Пишем через тот же make:write, что и редактор, поэтому превью и снимки узнают о правке сами.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeProjectState } from '@shared/make'
import { MAKE_TOKENS_STARTER, parseCssTokens, pickTokensFile, removeCssToken, setCssToken, type MakeCssToken, type MakeTokenKind } from '@shared/makeTokens'
import { contrastPairs } from '@shared/wcagContrast'
import { parseFigmaTokens } from '@shared/figmaTokens'
import { applyDarkThemeBlock, buildDarkThemeBlock } from '@shared/darkTheme'
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
  /** Контраст пар «текст/акцент × фон» по WCAG (roadmap-4 п.25) — считается по черновику, чтобы видеть эффект правки сразу. */
  const pairs = useMemo(() => contrastPairs(tokens.map((t) => ({ name: t.name, value: draft[t.name] ?? t.value }))), [tokens, draft])
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

  /** Импорт из Figma (roadmap-4 п.26): JSON Variables / Tokens Studio / плоская карта → setCssToken по каждому. */
  const importRef = useRef<HTMLInputElement | null>(null)
  const importFigma = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      // В jsdom у File нет .text() — читаем через FileReader, в браузере это тот же путь.
      const text = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result ?? '')); r.onerror = () => reject(new Error('Не удалось прочитать файл')); r.readAsText(file) })
      const imported = parseFigmaTokens(text)
      if (imported.length === 0) { toast.error('В файле не нашлось токенов: ожидаю Figma Variables JSON, Tokens Studio или карту «--имя: значение»'); return }
      let out = css ?? ':root {\n}\n'
      for (const t of imported) out = setCssToken(out, t.name, t.value)
      await write(target ?? 'tokens.css', out, `Импортировано токенов: ${imported.length}`)
    } catch (e) { toast.error(e instanceof SyntaxError ? 'Файл не является корректным JSON' : describeError(e)) }
    finally { if (importRef.current) importRef.current.value = '' }
  }
  /** Тёмная тема одной кнопкой (roadmap-4 п.27): блок [data-theme=dark] из светлых цветовых токенов. */
  const generateDark = async (): Promise<void> => {
    if (!target || css === null) return
    const colors = tokens.filter((t) => t.kind === 'color').map((t) => ({ name: t.name, value: draft[t.name] ?? t.value }))
    if (colors.length === 0) { toast.error('Нет цветовых токенов — тёмную тему не из чего строить'); return }
    await write(target, applyDarkThemeBlock(css, buildDarkThemeBlock(colors)), `Тёмная тема: ${colors.length} токенов в [data-theme=dark] — включается атрибутом data-theme="dark" на <html>`)
  }
  const remove = async (name: string): Promise<void> => {
    if (!target || css === null) return
    await write(target, removeCssToken(css, name), `Токен ${name} удалён`)
  }

  const source = target ?? 'tokens.css'
  return (
    <Dialog className="make-dialog" padded title="Дизайн-токены" ariaLabel="Дизайн-токены" size="md" onClose={onClose} testId="make-tokens"
      footer={tokens.length > 0 ? <Button variant="primary" size="sm" disabled={changed.length === 0 || busy} loading={busy} onClick={() => void save()}>Сохранить{changed.length > 0 ? ` (${changed.length})` : ''}</Button> : undefined}>
      <p className="make-ideas-lead">CSS-переменные из <code>:root</code> файла <code>{source}</code>. Меняются здесь — подхватывают все компоненты; ассистент тоже использует их вместо жёстких значений.</p>
      {css === null ? <p className="fsub">Загрузка…</p> : tokens.length === 0 ? (
        <EmptyState title="Токенов пока нет" description="Создайте tokens.css со стартовым набором (цвета, отступы, радиус, шрифты) — он подключится в index.html." actionLabel="Создать tokens.css" onAction={() => void createStarter()} />
      ) : <>
        {pairs.length > 0 && (
          <section className="make-tokens-group make-contrast" aria-label="Контраст пар токенов" data-testid="make-contrast">
            <h4>Контраст (WCAG)</h4>
            <ul className="make-tokens" role="list">
              {pairs.map((p) => (
                <li key={`${p.fg}/${p.bg}`} className={`make-contrast-row${p.aa ? '' : p.aaLarge ? ' make-contrast-row--large' : ' make-contrast-row--bad'}`}>
                  <span className="make-contrast-swatch" style={{ background: draft[p.bg] ?? tokens.find((t) => t.name === p.bg)?.value, color: draft[p.fg] ?? tokens.find((t) => t.name === p.fg)?.value }} aria-hidden="true">Aa</span>
                  <code>{p.fg}</code> на <code>{p.bg}</code>
                  <strong className="make-contrast-ratio">{p.ratio.toFixed(2)}:1</strong>
                  <span className="make-contrast-level" title="AA — 4.5:1 для текста, 3:1 для крупного; AAA — 7:1">{p.aaa ? 'AAA' : p.aa ? 'AA' : p.aaLarge ? 'AA крупный' : 'мало'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {KIND_ORDER.filter((k) => tokens.some((t) => t.kind === k)).map((kind) => (
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
      </>}
      {css !== null && (
        <div className="make-token-tools">
          <input ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Файл Figma JSON" data-testid="make-figma-file" onChange={(e) => void importFigma(e.target.files?.[0])} />
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => importRef.current?.click()} title="Figma Variables JSON, Tokens Studio или карта «--имя: значение»">Импорт из Figma JSON</Button>
          {tokens.some((t) => t.kind === 'color') && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void generateDark()} title="Сгенерировать [data-theme=dark] из светлых цветов">Тёмная тема</Button>}
        </div>
      )}
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
