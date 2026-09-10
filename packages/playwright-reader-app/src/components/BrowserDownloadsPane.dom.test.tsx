import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BrowserDownloadInfo } from '@shared/browserDownloads'
import { BrowserDownloadsPane } from './BrowserDownloadsPane'
const item: BrowserDownloadInfo = {
  id: 'd',
  tabId: 't',
  filename: 'Отчёт.txt',
  url: 'https://site.test/file',
  state: 'completed',
  bytes: 3,
  startedAt: 1
}
const list = (items: BrowserDownloadInfo[] = []) => ({ ok: true, downloads: items, offset: 0, total: items.length })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('показывает файл, размер и сохраняет подтверждённые байты', async () => {
  const create = vi.fn(() => 'blob:download'),
    revoke = vi.fn(),
    clicked = vi.fn()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = create
      static override revokeObjectURL = revoke
    }
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked(this.download, this.href)
  })
  const command = vi.fn(async (value) =>
    value.type === 'downloads'
      ? list([item])
      : { ok: true, download: item, encoding: 'base64', base64: 'YWJj', offset: 0, total: 3 }
  )
  render(<BrowserDownloadsPane downloads={[item]} count={1} onCommand={command} />)
  await waitFor(() => expect(command).toHaveBeenCalled())
  expect(screen.getByText('Готово · 3 Б')).toBeVisible()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Отчёт.txt' }))
  })
  expect(clicked).toHaveBeenCalledWith('Отчёт.txt', 'blob:download')
  expect(create).toHaveBeenCalledTimes(1)
})
it('ошибка чтения не создаёт файл на устройстве', async () => {
  const create = vi.fn()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = create
    }
  )
  const command = vi.fn(async (value) =>
    value.type === 'downloads' ? list([item]) : { ok: false, error: 'stale_download' }
  )
  render(<BrowserDownloadsPane downloads={[item]} count={1} onCommand={command} />)
  await waitFor(() => expect(command).toHaveBeenCalled())
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Отчёт.txt' }))
  })
  expect(screen.getByRole('alert')).toHaveTextContent('stale_download')
  expect(create).not.toHaveBeenCalled()
})
it('отмена и удаление требуют подтверждения, затем обновляют список', async () => {
  const pending = { ...item, bytes: undefined, state: 'downloading' as const },
    canceled = { ...item, bytes: undefined, state: 'canceled' as const }
  let items = [pending as BrowserDownloadInfo]
  const command = vi.fn(async (value) => {
    if (value.type === 'downloads') return list(items)
    if (value.type === 'cancelDownload') {
      items = [canceled]
      return { ok: true, download: canceled }
    }
    items = []
    return { ok: true, deletedDownloadId: item.id }
  })
  render(<BrowserDownloadsPane downloads={[pending]} count={1} onCommand={command} />)
  await waitFor(() => expect(command).toHaveBeenCalled())
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Отменить скачивание Отчёт.txt' }))
  })
  expect(screen.getByText('Отменено')).toBeVisible()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Удалить скачивание Отчёт.txt' }))
  })
  expect(screen.queryByText('Отчёт.txt')).toBeNull()
})
it('старый ready не выдаётся за удаление файла', async () => {
  const command = vi.fn(async (value) =>
    value.type === 'downloads' ? list([item]) : { incarnation: 'i', state: 'ready' }
  )
  render(<BrowserDownloadsPane downloads={[item]} count={1} onCommand={command} />)
  await waitFor(() => expect(command).toHaveBeenCalled())
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Удалить скачивание Отчёт.txt' }))
  })
  expect(screen.getByRole('alert')).toHaveTextContent('не подтверждено')
  expect(screen.getByText('Отчёт.txt')).toBeVisible()
})
it('закрытая панель не сохраняет поздний ответ', async () => {
  const create = vi.fn()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = create
    }
  )
  let finish!: (value: unknown) => void
  const command = vi.fn(async (value) =>
    value.type === 'downloads'
      ? list([item])
      : new Promise((resolve) => {
          finish = resolve
        })
  )
  const view = render(<BrowserDownloadsPane downloads={[item]} count={1} onCommand={command} />)
  await waitFor(() => expect(command).toHaveBeenCalled())
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Скачать Отчёт.txt' }))
  })
  view.unmount()
  await act(async () => {
    finish({ ok: true, download: item, encoding: 'base64', base64: 'YWJj', offset: 0, total: 3 })
  })
  expect(create).not.toHaveBeenCalled()
})
