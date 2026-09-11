import { Dialog, useToast } from '../i18n/ui'
import { mt, useMakeLocale } from '../i18n'
// Make design tokens (item 23): edit :root variables in tokens.css/styles.css with color pickers or
// text fields. Use the same make:write bridge as the editor so preview refresh and snapshots follow
// the usual flow.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeProjectState } from '@shared/make'
import { MAKE_TOKENS_STARTER, parseCssTokens, pickTokensFile, removeCssToken, setCssToken, type MakeCssToken, type MakeTokenKind } from '@shared/makeTokens'
import { contrastPairs } from '@shared/wcagContrast'
import { parseFigmaTokens } from '@shared/figmaTokens'
import { applyDarkThemeBlock, buildDarkThemeBlock } from '@shared/darkTheme'
import { Button, EmptyState, IconButton } from '@voicechat/ui-kit'

interface Props {
  conversationId: string
  api: Pick<RendererApi, 'make:read' | 'make:write'>
  files: readonly string[]
  onClose: () => void
  /** Project state after writing; the panel updates its state and preview. */
  onWritten: (next: MakeProjectState) => void
}

const KIND_TITLE: Record<MakeTokenKind, string> = { get color() { return mt("colors") }, get size() { return mt("sizesAndSpacing") }, get font() { return mt("fonts") }, get other() { return mt("other") } }
const KIND_ORDER: MakeTokenKind[] = ['color', 'size', 'font', 'other']
const isHex6 = (v: string): boolean => /^#[0-9a-f]{6}$/i.test(v.trim())

function describeError(e: unknown): string { return e instanceof Error ? e.message : String(e) }

export function MakeTokensDialog({ conversationId, api, files, onClose, onWritten }: Props): JSX.Element {
  useMakeLocale()
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
  /** WCAG contrast for text/accent against background (roadmap-4, item 25), calculated from the draft for immediate feedback. */
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

  /** Create starter tokens.css and link it before the first stylesheet in index.html so all styles can use the tokens. */
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
      toast.success(mt("tokensCssCreatedAndLinkedInIndexHtml"))
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }

  const save = async (): Promise<void> => {
    if (!target || css === null) return
    let out = css
    for (const t of changed) out = setCssToken(out, t.name, draft[t.name]!)
    await write(target, out, mt("tokensUpdatedValueValue", { p0: changed.length, p1: target }))
    setDraft({})
  }

  const add = async (): Promise<void> => {
    const name = newName.trim().startsWith('--') ? newName.trim() : `--${newName.trim()}`
    if (!/^--[\w-]+$/.test(name) || !newValue.trim() || css === null) return
    const path = target ?? 'tokens.css'
    await write(path, setCssToken(css, name, newValue), mt("tokenValueAdded", { p0: name }))
    setNewName(''); setNewValue('')
  }

  /** Figma import (roadmap-4, item 26): map Variables, Tokens Studio, or flat JSON values through setCssToken. */
  const importRef = useRef<HTMLInputElement | null>(null)
  const importFigma = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      // jsdom File lacks text(), so use FileReader in both tests and browsers.
      const text = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result ?? '')); r.onerror = () => reject(new Error(mt("couldNotReadTheFile"))); r.readAsText(file) })
      const imported = parseFigmaTokens(text)
      if (imported.length === 0) { toast.error(mt("noTokensFoundInTheFileExpectedFigmaVariables")); return }
      let out = css ?? ':root {\n}\n'
      for (const t of imported) out = setCssToken(out, t.name, t.value)
      await write(target ?? 'tokens.css', out, mt("tokensImportedValue", { p0: imported.length }))
    } catch (e) { toast.error(e instanceof SyntaxError ? mt("theFileIsNotValidJson") : describeError(e)) }
    finally { if (importRef.current) importRef.current.value = '' }
  }
  /** One-click dark theme (roadmap-4, item 27): derive a [data-theme=dark] block from light-theme color tokens. */
  const generateDark = async (): Promise<void> => {
    if (!target || css === null) return
    const colors = tokens.filter((t) => t.kind === 'color').map((t) => ({ name: t.name, value: draft[t.name] ?? t.value }))
    if (colors.length === 0) { toast.error(mt("noColorTokensAreAvailableToBuildADark")); return }
    await write(target, applyDarkThemeBlock(css, buildDarkThemeBlock(colors)), mt("darkThemeValueTokensInDataThemeDarkEnable", { p0: colors.length }))
  }
  const remove = async (name: string): Promise<void> => {
    if (!target || css === null) return
    await write(target, removeCssToken(css, name), mt("tokenValueDeleted", { p0: name }))
  }

  const source = target ?? 'tokens.css'
  return (
    <Dialog className="make-dialog" padded title={mt("designTokenEditor")} ariaLabel={mt("designTokenEditor")} size="md" onClose={onClose} testId="make-tokens"
      footer={tokens.length > 0 ? <Button variant="primary" size="sm" disabled={changed.length === 0 || busy} loading={busy} onClick={() => void save()}>{mt("save")}{changed.length > 0 ? ` (${changed.length})` : ''}</Button> : undefined}>
      <p className="make-ideas-lead">{mt("cssVariablesFrom")}{' '}<code>:root</code>{' '}{mt("file_20510d")}{' '}<code>{source}</code>{mt("changesHereApplyToEveryComponentTheAssistantAlso")}</p>
      {css === null ? <p className="fsub">{mt("loadingData")}</p> : tokens.length === 0 ? (
        <EmptyState title={mt("noTokensYet")} description={mt("createTokensCssWithStarterColorsSpacingRadiiAnd")} actionLabel={mt("createTokensCss")} onAction={() => void createStarter()} />
      ) : <>
        {pairs.length > 0 && (
          <section className="make-tokens-group make-contrast" aria-label={mt("tokenPairContrast")} data-testid="make-contrast">
            <h4>{mt("contrastWcag")}</h4>
            <ul className="make-tokens" role="list">
              {pairs.map((p) => (
                <li key={`${p.fg}/${p.bg}`} className={`make-contrast-row${p.aa ? '' : p.aaLarge ? ' make-contrast-row--large' : ' make-contrast-row--bad'}`}>
                  <span className="make-contrast-swatch" style={{ background: draft[p.bg] ?? tokens.find((t) => t.name === p.bg)?.value, color: draft[p.fg] ?? tokens.find((t) => t.name === p.fg)?.value }} aria-hidden="true">Aa</span>
                  <code>{p.fg}</code>{' '}{mt("on_2d38cb")}{' '}<code>{p.bg}</code>
                  <strong className="make-contrast-ratio">{p.ratio.toFixed(2)}:1</strong>
                  <span className="make-contrast-level" title={mt("aaRequires451ForTextAnd3")}>{p.aaa ? 'AAA' : p.aa ? 'AA' : p.aaLarge ? mt("aaLargeText") : mt("low")}</span>
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
                  {kind === 'color' && isHex6(value) && <input type="color" aria-label={mt("colorValue", { p0: t.name })} value={value.trim().toLowerCase()} onChange={(e) => setDraft((d) => ({ ...d, [t.name]: e.target.value }))} />}
                  {kind === 'color' && !isHex6(value) && <span className="make-token-swatch" style={{ background: value }} aria-hidden="true" />}
                  <input className="make-token-value" aria-label={mt("valueValue", { p0: t.name })} value={value} onChange={(e) => setDraft((d) => ({ ...d, [t.name]: e.target.value }))} />
                  <IconButton size="sm" aria-label={mt("deleteValue", { p0: t.name })} title={mt("deleteToken")} disabled={busy} onClick={() => void remove(t.name)}>✕</IconButton>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      </>}
      {css !== null && (
        <div className="make-token-tools">
          <input ref={importRef} type="file" accept="application/json,.json" hidden aria-label={mt("figmaJsonFile")} data-testid="make-figma-file" onChange={(e) => void importFigma(e.target.files?.[0])} />
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => importRef.current?.click()} title={mt("figmaVariablesJsonTokensStudioOrANameValue")}>{mt("importFromFigmaJson")}</Button>
          {tokens.some((t) => t.kind === 'color') && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void generateDark()} title={mt("generateDataThemeDarkFromLightColors")}>{mt("darkTheme")}</Button>}
        </div>
      )}
      {css !== null && (
        <form className="make-token-add" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <input aria-label={mt("newTokenName")} placeholder={mt("name")} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input aria-label={mt("newTokenValue")} placeholder={mt("value")} value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          <Button size="sm" variant="secondary" type="submit" disabled={busy || !newName.trim() || !newValue.trim()}>{mt("token")}</Button>
        </form>
      )}
    </Dialog>
  )
}
