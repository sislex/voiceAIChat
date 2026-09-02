// Диалог «Из проекта» в панели Make: компоненты и стили копируются из рабочей
// директории машины проекта в мастерскую, правятся здесь (ассистент, превью) и
// возвращаются обратно кнопкой «Вернуть». Связь помнит хеш на момент
// копирования: сервер отклоняет возврат, если файл в репозитории уже изменился,
// и тогда пользователь решает — перезаписать или забрать свежую версию заново.
//
// Панель не знает ни машины, ни путей проекта: сервер сам находит машину
// проекта и отвечает словами (409), если её нет или она offline.

import { useCallback, useEffect, useState } from 'react'
import type { RendererApi } from '@shared/ipc'
import type { MakeProjectFileEntry, MakeProjectLinkInfo, MakeProjectLinkStatus } from '@shared/make'
import { Button, Dialog, EmptyState, ErrorState, useConfirm, useToast } from '@voicechat/ui-kit'

interface Props {
  conversationId: string
  api: Pick<RendererApi, 'make:projectFiles' | 'make:projectLinks' | 'make:projectPull' | 'make:projectPush'>
  onClose: () => void
}

/** Статус связи словами пользователя, а не кодом контракта. */
const STATUS_TEXT: Record<MakeProjectLinkStatus, string> = {
  same: 'совпадает с проектом',
  edited_in_make: 'изменён в Make — можно вернуть',
  changed_in_project: 'изменён в проекте — заберите заново',
  both: 'конфликт: изменён и здесь, и в проекте',
  missing_in_project: 'в проекте больше нет',
  missing_in_make: 'в мастерской больше нет'
}

export function MakeProjectSyncDialog({ conversationId, api, onClose }: Props): JSX.Element {
  const toast = useToast()
  const confirm = useConfirm()
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
      // Машины нет или offline: это не поломка диалога, а состояние проекта —
      // показываем словами сервера и даём повторить.
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
      toast.success(`Скопировано файлов: ${result.links.length ? selected.length : 0}`)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api, conversationId, selected, toast])

  const push = useCallback(async (paths?: string[]): Promise<void> => {
    setBusy(true)
    try {
      const result = await api['make:projectPush']({ conversationId, ...(paths ? { paths } : {}) })
      setLinks(result.links)
      toast.success(`Возвращено в проект: ${result.pushed.length}`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      // Конфликт — решение пользователя, а не тоста: перезапись сотрёт чужую
      // работу в репозитории, и по умолчанию мы её не делаем.
      if (message.includes('изменились после копирования')) {
        if (await confirm({
          title: 'Файлы в проекте изменились',
          message: 'После копирования их правили в репозитории. Вернуть версии из Make поверх этих правок?',
          confirmLabel: 'Перезаписать'
        })) {
          try {
            const forced = await api['make:projectPush']({ conversationId, ...(paths ? { paths } : {}), force: true })
            setLinks(forced.links)
            toast.success(`Возвращено с перезаписью: ${forced.pushed.length}`)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err))
          }
        }
      } else {
        toast.error(message)
      }
    } finally {
      setBusy(false)
    }
  }, [api, conversationId, confirm, toast])

  const toggle = (path: string, checked: boolean): void =>
    setSelected((prev) => checked ? [...prev, path] : prev.filter((item) => item !== path))
  const parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
  const returnable = links.filter((link) => link.status === 'edited_in_make' || link.status === 'both')

  return <Dialog title="Компоненты из проекта" size="lg" padded onClose={onClose} testId="make-project-sync">
    {error
      ? <ErrorState message={error} onRetry={() => void load(dir)} />
      : <div className="make-sync">
          <section aria-label="Файлы проекта на машине">
            <h3>Файлы проекта{dir ? ` · ${dir}` : ''}</h3>
            <div className="make-sync-list" role="list" data-testid="make-sync-files">
              {dir && <div role="listitem"><button type="button" className="make-sync-dir" onClick={() => void load(parent)}>← Назад</button></div>}
              {entries.map((entry) => <div role="listitem" key={entry.path}>
                {entry.kind === 'dir'
                  ? <button type="button" className="make-sync-dir" onClick={() => void load(entry.path)}>📁 {entry.name}</button>
                  : <label className="make-sync-file">
                      <input type="checkbox" checked={selected.includes(entry.path)} disabled={busy} onChange={(event) => toggle(entry.path, event.target.checked)} />
                      <span>{entry.name}</span>
                    </label>}
              </div>)}
            </div>
            {entries.length === 0 && <EmptyState title="Каталог пуст" description="Выберите другой каталог проекта." />}
            <div className="make-sync-actions">
              <Button size="sm" disabled={busy || selected.length === 0} loading={busy} onClick={() => void pull()}>Скопировать в Make ({selected.length})</Button>
            </div>
          </section>
          <section aria-label="Связанные с проектом файлы">
            <h3>Связанные файлы</h3>
            {links.length === 0
              ? <EmptyState title="Пока ничего не скопировано" description="Отметьте файлы слева и скопируйте их в Make — после правок их можно вернуть в проект." />
              : <div className="make-sync-list" role="list" data-testid="make-sync-links">
                  {links.map((link) => <div role="listitem" key={link.path} className="make-sync-link">
                    <span className="make-sync-path">{link.path}</span>
                    <span className="make-sync-status" data-status={link.status}>{STATUS_TEXT[link.status]}</span>
                    {(link.status === 'edited_in_make' || link.status === 'both') &&
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void push([link.path])}>Вернуть</Button>}
                  </div>)}
                </div>}
            {returnable.length > 1 && <div className="make-sync-actions">
              <Button size="sm" disabled={busy} onClick={() => void push()}>Вернуть всё изменённое ({returnable.length})</Button>
            </div>}
          </section>
        </div>}
  </Dialog>
}
