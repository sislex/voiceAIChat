import { useEffect, useRef, useState } from 'react'
import type { BrowserDownloadInfo } from '@shared/browserDownloads'
import { Button } from '@voicechat/ui-kit'
import { browserDownloadBytes, listAllBrowserDownloads, type DownloadSend } from '../lib/browserDownloads'
import { scenarioCommandError } from '@shared/scenarioStep'

const STATES = { downloading: 'Скачивается…', completed: 'Готово', canceled: 'Отменено', failed: 'Не удалось скачать' }
export function BrowserDownloadsPane({
  downloads,
  count,
  onCommand
}: {
  downloads: BrowserDownloadInfo[]
  count: number
  onCommand: DownloadSend
}): JSX.Element {
  const [items, setItems] = useState(downloads)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const alive = useRef(true)
  const command = useRef(onCommand)
  command.current = onCommand
  const revision = JSON.stringify(downloads)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    let current = true
    void listAllBrowserDownloads((value) => command.current(value)).then(
      (result) => {
        if (current) {
          setItems(result)
          setError('')
        }
      },
      (error) => {
        if (current) setError(error instanceof Error ? error.message : 'Список не получен')
      }
    )
    return () => {
      current = false
    }
  }, [revision, count, refresh])
  const perform = async (
    item: BrowserDownloadInfo,
    action: 'save' | 'cancelDownload' | 'deleteDownload'
  ): Promise<void> => {
    if (busy.has(item.id)) return
    setBusy((value) => new Set(value).add(item.id))
    setError('')
    try {
      if (action === 'save') {
        const bytes = await browserDownloadBytes(
          (value) => command.current(value),
          item,
          () => alive.current
        )
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = item.filename
        try {
          document.body.append(anchor)
          anchor.click()
        } finally {
          anchor.remove()
          // Браузеру нужно успеть принять Blob, прежде чем освобождать URL.
          const revoke = URL.revokeObjectURL.bind(URL)
          setTimeout(() => revoke(url), 1000)
        }
      } else {
        const result = await command.current({ type: action, downloadId: item.id })
        const failure = scenarioCommandError(result)
        const confirmed =
          result &&
          typeof result === 'object' &&
          'ok' in result &&
          result.ok === true &&
          (action === 'deleteDownload'
            ? 'deletedDownloadId' in result && result.deletedDownloadId === item.id
            : 'download' in result &&
              typeof result.download === 'object' &&
              result.download !== null &&
              'id' in result.download &&
              result.download.id === item.id)
        if (failure || !confirmed) throw new Error(failure ?? 'Изменение скачивания не подтверждено')
        if (alive.current) setRefresh((value) => value + 1)
      }
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : 'Действие не выполнено')
    } finally {
      if (alive.current)
        setBusy((value) => {
          const next = new Set(value)
          next.delete(item.id)
          return next
        })
    }
  }
  return (
    <section className="playwright-downloads" aria-label="Скачивания">
      <div className="playwright-downloads-header">
        <strong>Скачивания</strong>
        <Button size="sm" variant="ghost" onClick={() => setRefresh((value) => value + 1)}>
          Обновить список
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!items.length && <p>Здесь появятся файлы, скачанные со страницы.</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.filename}</strong>
              <span>
                {STATES[item.state]}
                {item.bytes !== undefined ? ` · ${item.bytes.toLocaleString('ru-RU')} Б` : ''}
              </span>
              {item.error && <span>{item.error}</span>}
            </div>
            {item.state === 'completed' && (
              <Button
                size="sm"
                disabled={busy.has(item.id)}
                aria-label={`Скачать ${item.filename}`}
                onClick={() => void perform(item, 'save')}
              >
                {busy.has(item.id) ? 'Сохраняется…' : 'Скачать'}
              </Button>
            )}
            {item.state === 'downloading' && (
              <Button
                size="sm"
                disabled={busy.has(item.id)}
                aria-label={`Отменить скачивание ${item.filename}`}
                onClick={() => void perform(item, 'cancelDownload')}
              >
                Отменить
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy.has(item.id)}
              aria-label={`Удалить скачивание ${item.filename}`}
              onClick={() => void perform(item, 'deleteDownload')}
            >
              Удалить
            </Button>
          </li>
        ))}
      </ul>
      <p className="playwright-downloads-note">
        Файлы доступны до перезапуска браузера. Сохраните нужные файлы на устройство.
      </p>
    </section>
  )
}
