import { ErrorState } from '../i18n/ui'
import { mt, useMakeLocale, formatMakeDate, localizeMakeStackLabel, localizeMakeText, describeMakeError } from '../i18n'
import { MakeLanguageSelect } from './MakeLanguageSelect'
import type { MakeSharedViewProps } from '../panelContract'
// Read-only Make projects at #/make-shared/<token> (item 33): previews, files, and snapshots
// without editing. A small separate screen is easier to maintain than disabling MakePane's many
// write actions.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MakeSharedState } from '@shared/make'
import { isMakeTextPath, makeStackLabel } from '@shared/make'
import { REST } from '@shared/protocol'
import { Button, Skeleton } from '@voicechat/ui-kit'
import { CodeEditor } from './MakeCodeEditor'



type Tab = 'preview' | 'code' | 'history'

type MakeTreeNode = { kind: 'dir'; name: string; path: string; children: MakeTreeNode[] } | { kind: 'file'; name: string; path: string }

/** Build a tree from flat paths: directories first, then alphabetical order. */
export function buildMakeTree(paths: readonly string[]): MakeTreeNode[] {
  const root: MakeTreeNode[] = []
  for (const full of [...paths].sort()) {
    const parts = full.split('/')
    let level = root
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      if (i === parts.length - 1) { level.push({ kind: 'file', name, path }); return }
      let dir = level.find((n): n is Extract<MakeTreeNode, { kind: 'dir' }> => n.kind === 'dir' && n.path === path)
      if (!dir) { dir = { kind: 'dir', name, path, children: [] }; level.push(dir) }
      level = dir.children
    })
  }
  const order = (nodes: MakeTreeNode[]): MakeTreeNode[] => nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1)).map((n) => (n.kind === 'dir' ? { ...n, children: order(n.children) } : n))
  return order(root)
}

function TreeList({ nodes, selected, onOpen, depth = 0 }: { nodes: MakeTreeNode[]; selected: string | null; onOpen: (path: string) => void; depth?: number }): JSX.Element {
  useMakeLocale()
  return (
    <ul className="make-tree" role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((n) => (
        <li key={n.path} role="treeitem" aria-selected={n.kind === 'file' && n.path === selected} style={{ paddingLeft: depth * 12 }}>
          {n.kind === 'dir'
            ? <><span className="make-tree-dir">📁 {n.name}</span><TreeList nodes={n.children} selected={selected} onOpen={onOpen} depth={depth + 1} /></>
            : <button type="button" className={n.path === selected ? 'make-tree-file on' : 'make-tree-file'} onClick={() => onOpen(n.path)} disabled={!isMakeTextPath(n.path)}>{n.name}</button>}
        </li>
      ))}
    </ul>
  )
}

export function MakeSharedView({ token, api, ensurePreview, onBack }: MakeSharedViewProps): JSX.Element {
  const locale = useMakeLocale()
  const [state, setState] = useState<MakeSharedState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('preview')
  const [previewReady, setPreviewReady] = useState(!ensurePreview)
  const [path, setPath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  const canEdit = state?.role === 'editor'

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try { setState(await api['make:shared']({ token })) } catch (e) { setError(describeMakeError(e)) }
  }, [api, token])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (ensurePreview) void ensurePreview().then((ok) => setPreviewReady(ok)) }, [ensurePreview])
  const tree = useMemo(() => buildMakeTree((state?.files ?? []).map((f) => f.path)), [state])

  const open = async (p: string): Promise<void> => {
    setPath(p)
    try { const c = (await api['make:sharedFile']({ token, path: p })).content; setContent(c); setSaved(c) } catch (e) { setContent(`// ${describeMakeError(e)}`) }
  }
  useEffect(() => { if (tab === 'code' && !path && state?.files.some((f) => f.path === 'index.html')) void open('index.html') }, [tab, path, state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Editors (roadmap-3, item 6) write through /api/make/:id/file, where the server
  // checks named grants.
  const save = async (): Promise<void> => {
    if (!state || !path || !canEdit || content === saved) return
    setSaving(true)
    try { await api['make:write']({ conversationId: state.conversationId, path, content }); setSaved(content); await load() } catch (e) { setError(describeMakeError(e)) } finally { setSaving(false) }
  }
  const previewBase = REST.makeSharedPreview(token)
  return (
    <div lang={locale} className="make-shared" data-testid="make-shared">
      <header className="make-head make-shared-head" role="toolbar" aria-label={mt("projectReadOnly")}>
        <Button size="sm" variant="ghost" onClick={onBack}>{mt("back")}</Button>
        <strong className="make-shared-title">{state?.title ?? mt("project")}</strong>
        {state && <span className="make-stack-badge" aria-label={mt("projectStack")}>{localizeMakeStackLabel(makeStackLabel(state.stack, state.uiKit))}</span>}
        <span className="make-shared-badge" title={canEdit ? mt("youAreAnEditorAndCanChangeFiles") : mt("thisLinkIsReadOnlyEditingIsDisabled")}>{canEdit ? mt("editor") : mt("readOnly")}{state?.owner ? ` · ${state.owner}` : ''}</span>
        <span className="make-head-spacer" />
        <MakeLanguageSelect />
        <div className="make-tabs" role="tablist" aria-label={mt("viewMode")}>
          {(['preview', 'code', 'history'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'make-tab on' : 'make-tab'} onClick={() => setTab(t)}>{t === 'preview' ? mt("preview") : t === 'code' ? mt("code") : mt("snapshots")}</button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => window.open(`${previewBase}index.html`, '_blank', 'noopener')}>{mt("openInNewTab_97acdc")}</Button>
      </header>
      {error ? <ErrorState message={mt("projectUnavailable")} detail={error} onRetry={() => void load()} /> : !state ? <Skeleton height={200} /> : (
        <>
          {tab === 'preview' && (
            <div className="make-frame-host make-frame-host--desktop">
              {previewReady && <iframe className="make-frame" title={mt("projectPreviewReadOnly")} src={`${previewBase}index.html?rev=${state.rev}`} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads" />}
            </div>
          )}
          {tab === 'code' && (
            <div className="make-code make-shared-code">
              <nav className="make-files" aria-label={mt("projectFiles")}><TreeList nodes={tree} selected={path} onOpen={(p) => void open(p)} /></nav>
              <div className="make-editor">
                {path && canEdit && <div className="make-editor-head"><code>{path}</code><span className="make-head-spacer" /><Button size="sm" variant="primary" disabled={content === saved || saving} loading={saving} onClick={() => void save()}>{mt("save")}</Button></div>}
                {path ? <CodeEditor path={path} value={content} onChange={canEdit ? setContent : () => undefined} onSave={() => void save()} ariaLabel={mt("contentsOfValue", { p0: path })} readOnly={!canEdit} /> : <p className="fsub">{mt("selectAFileOnTheLeft")}</p>}
              </div>
            </div>
          )}
          {tab === 'history' && (
            <ul className="make-snaps" aria-label={mt("projectSnapshots")}>
              {state.snapshots.length === 0 && <li className="fsub">{mt("noSnapshotsSavedYet")}</li>}
              {state.snapshots.map((s) => <li key={s.id} className="make-snap"><strong>{localizeMakeText(s.label)}</strong><small>{formatMakeDate(s.createdAt)}{' '}{mt("files")}{' '}{s.files}</small></li>)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
