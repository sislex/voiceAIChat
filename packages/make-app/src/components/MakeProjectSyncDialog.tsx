import { Dialog, ErrorState, useToast } from '../i18n/ui'
import { mt, useMakeLocale } from '../i18n'
// The Make project-import dialog copies components and styles from the project machine's working
// directory into the workshop for assistant edits and previews. Repository writes belong to the Git
// workflow; direct writes would leave the shared copy dirty. Designs reach application code through
// task-card links. Each file link records its original hash to show whether the workshop or
// repository version has changed and needs importing again. The panel does not resolve machines or
// paths itself: the server finds the project machine and returns a readable 409 when it is missing
// or offline.

import { useCallback, useEffect, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeProjectFileEntry, MakeProjectLinkInfo, MakeProjectLinkStatus } from '@shared/make'
import { Button, EmptyState } from '@voicechat/ui-kit'

interface Props {
  conversationId: string
  api: Pick<RendererApi, 'make:projectFiles' | 'make:projectLinks' | 'make:projectPull'>
  onClose: () => void
}

/** Describe link status in user-facing terms rather than exposing contract codes. */
const STATUS_TEXT: Record<MakeProjectLinkStatus, string> = {
  get same() { return mt("matchesProject") },
  get edited_in_make() { return mt("changedInMake") },
  get changed_in_project() { return mt("changedInProjectPullAgain") },
  get both() { return mt("conflictChangedHereAndInProject") },
  get missing_in_project() { return mt("noLongerInProject") },
  get missing_in_make() { return mt("noLongerInWorkshop") }
}

export function MakeProjectSyncDialog({ conversationId, api, onClose }: Props): JSX.Element {
  useMakeLocale()
  const toast = useToast()
  const [dir, setDir] = useState('')
  const [entries, setEntries] = useState<MakeProjectFileEntry[]>([])
  const [links, setLinks] = useState<MakeProjectLinkInfo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (path: string): Promise<void> => {
    setError(null)
    try {
      const [nextEntries, nextLinks] = await Promise.all([
        api['make:projectFiles']({ conversationId, ...(path ? { path } : {}) }),
        api['make:projectLinks']({ conversationId })
      ])
      setEntries(nextEntries)
      setLinks(nextLinks)
      setDir(path)
    } catch (cause) {
      // A missing or offline machine is a project state, not a broken dialog. Show the server's
      // explanation and offer retry.
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api, conversationId])

  useEffect(() => { void load('') }, [load])

  const pull = useCallback(async (): Promise<void> => {
    if (!selected.length) return
    setBusy(true)
    try {
      const result = await api['make:projectPull']({ conversationId, paths: selected })
      setLinks(result.links)
      setSelected([])
      toast.success(mt("filesCopiedValue", { p0: result.links.length ? selected.length : 0 }))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api, conversationId, selected, toast])

  const toggle = (path: string, checked: boolean): void =>
    setSelected((prev) => checked ? [...prev, path] : prev.filter((item) => item !== path))
  const parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''

  return <Dialog title={mt("componentsFromProject_ac8316")} size="lg" padded onClose={onClose} testId="make-project-sync">
    {error
      ? <ErrorState message={error} onRetry={() => void load(dir)} />
      : <div className="make-sync">
          <section aria-label={mt("projectFilesOnMachine")}>
            <h3>{mt("projectFiles")}{dir ? ` · ${dir}` : ''}</h3>
            <div className="make-sync-list" role="list" data-testid="make-sync-files">
              {dir && <div role="listitem"><button type="button" className="make-sync-dir" onClick={() => void load(parent)}>{mt("back")}</button></div>}
              {entries.map((entry) => <div role="listitem" key={entry.path}>
                {entry.kind === 'dir'
                  ? <button type="button" className="make-sync-dir" onClick={() => void load(entry.path)}>📁 {entry.name}</button>
                  : <label className="make-sync-file">
                      <input type="checkbox" checked={selected.includes(entry.path)} disabled={busy} onChange={(event) => toggle(entry.path, event.target.checked)} />
                      <span>{entry.name}</span>
                    </label>}
              </div>)}
            </div>
            {entries.length === 0 && <EmptyState title={mt("directoryIsEmpty")} description={mt("selectAnotherProjectDirectory")} />}
            <div className="make-sync-actions">
              <Button size="sm" disabled={busy || selected.length === 0} loading={busy} onClick={() => void pull()}>{mt("copyToMake")}{selected.length})</Button>
            </div>
          </section>
          <section aria-label={mt("filesLinkedToProject")}>
            <h3>{mt("linkedFiles")}</h3>
            {links.length === 0
              ? <EmptyState title={mt("noFilesCopiedYet")} description={mt("selectFilesOnTheLeftAndCopyThemInto")} />
              : <div className="make-sync-list" role="list" data-testid="make-sync-links">
                  {links.map((link) => <div role="listitem" key={link.path} className="make-sync-link">
                    <span className="make-sync-path">{link.path}</span>
                    <span className="make-sync-status" data-status={link.status}>{STATUS_TEXT[link.status]}</span>
                  </div>)}
                </div>}
          </section>
        </div>}
  </Dialog>
}
