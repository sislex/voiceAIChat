// Read-only просмотр проекта Make по ссылке `#/make-shared/<token>` (п.33): превью, файлы и снимки
// без права правок. Отдельный лёгкий экран, а не MakePane с флагом — у панели полсотни действий
// записи, и «спрятать всё» дороже и хрупче, чем показать три вкладки чтения.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeSharedState } from '@shared/make'
import { isMakeTextPath } from '@shared/make'
import { REST } from '@shared/protocol'
import { Button, ErrorState, Skeleton } from '@voicechat/ui-kit'
import { CodeEditor } from './CodeEditor'

interface Props {
  token: string
  api: Pick<RendererApi, 'make:shared' | 'make:sharedFile'>
  ensurePreview?: () => Promise<boolean>
  onBack: () => void
}

type Tab = 'preview' | 'code' | 'history'

type MakeTreeNode = { kind: 'dir'; name: string; path: string; children: MakeTreeNode[] } | { kind: 'file'; name: string; path: string }

/** Дерево из плоского списка путей: каталоги первыми, всё по алфавиту. */
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

export function MakeSharedView({ token, api, ensurePreview, onBack }: Props): JSX.Element {
  const [state, setState] = useState<MakeSharedState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('preview')
  const [previewReady, setPreviewReady] = useState(!ensurePreview)
  const [path, setPath] = useState<string | null>(null)
  const [content, setContent] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try { setState(await api['make:shared']({ token })) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [api, token])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (ensurePreview) void ensurePreview().then((ok) => setPreviewReady(ok)) }, [ensurePreview])
  const tree = useMemo(() => buildMakeTree((state?.files ?? []).map((f) => f.path)), [state])

  const open = async (p: string): Promise<void> => {
    setPath(p)
    try { setContent((await api['make:sharedFile']({ token, path: p })).content) } catch (e) { setContent(`// ${e instanceof Error ? e.message : String(e)}`) }
  }
  useEffect(() => { if (tab === 'code' && !path && state?.files.some((f) => f.path === 'index.html')) void open('index.html') }, [tab, path, state]) // eslint-disable-line react-hooks/exhaustive-deps

  const previewBase = REST.makeSharedPreview(token)
  return (
    <div className="make-shared" data-testid="make-shared">
      <header className="make-head make-shared-head" role="toolbar" aria-label="Проект (только чтение)">
        <Button size="sm" variant="ghost" onClick={onBack}>← Назад</Button>
        <strong className="make-shared-title">{state?.title ?? 'Проект'}</strong>
        <span className="make-shared-badge" title="Ссылка только для чтения: правки недоступны">только чтение{state?.owner ? ` · ${state.owner}` : ''}</span>
        <span className="make-head-spacer" />
        <div className="make-tabs" role="tablist" aria-label="Режим просмотра">
          {(['preview', 'code', 'history'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'make-tab on' : 'make-tab'} onClick={() => setTab(t)}>{t === 'preview' ? 'Превью' : t === 'code' ? 'Код' : 'Снимки'}</button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => window.open(`${previewBase}index.html`, '_blank', 'noopener')}>Открыть в новой вкладке</Button>
      </header>
      {error ? <ErrorState message="Проект недоступен" detail={error} onRetry={() => void load()} /> : !state ? <Skeleton height={200} /> : (
        <>
          {tab === 'preview' && (
            <div className="make-frame-host make-frame-host--desktop">
              {previewReady && <iframe className="make-frame" title="Превью проекта (только чтение)" src={`${previewBase}index.html?rev=${state.rev}`} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin" />}
            </div>
          )}
          {tab === 'code' && (
            <div className="make-code make-shared-code">
              <nav className="make-files" aria-label="Файлы проекта"><TreeList nodes={tree} selected={path} onOpen={(p) => void open(p)} /></nav>
              <div className="make-editor">
                {path ? <CodeEditor path={path} value={content} onChange={() => undefined} ariaLabel={`Содержимое ${path}`} readOnly /> : <p className="fsub">Выберите файл слева.</p>}
              </div>
            </div>
          )}
          {tab === 'history' && (
            <ul className="make-snaps" aria-label="Снимки проекта">
              {state.snapshots.length === 0 && <li className="fsub">Снимков пока нет.</li>}
              {state.snapshots.map((s) => <li key={s.id} className="make-snap"><strong>{s.label}</strong><small>{new Date(s.createdAt).toLocaleString('ru-RU')} · файлов: {s.files}</small></li>)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
