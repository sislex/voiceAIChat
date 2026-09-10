import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
const manifest = {
  schemaVersion: 1,
  applicationId: 'make-ui',
  version: '1.2.0',
  apiVersion: '1.0.0',
  commit: 'a'.repeat(40),
  host: { minVersion: '1.0.0', maxVersionExclusive: '2.0.0' },
  entry: { path: 'panel-abc.js', integrity: 'sha384-' + 'a'.repeat(64) },
  styles: [{ path: 'style-abc.css', integrity: 'sha384-' + 'b'.repeat(64) }]
}
afterEach(() => {
  vi.unstubAllGlobals()
  document.head.querySelectorAll('script,link').forEach((node) => node.remove())
  vi.resetModules()
})
it('проверяет манифест и SRI, передаёт панели props через общий React', async () => {
  const { configureApplicationHost, createApplicationPanel } = await import(
    './applicationHost'
  )
  configureApplicationHost('https://host.test')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => manifest }))
  )
  const Panel = createApplicationPanel<{ title: string }>('make-ui')
  render(<Panel title="Моя мастерская" />)
  await waitFor(() =>
    expect(document.head.querySelector('link')?.integrity).toBe(
      manifest.styles[0].integrity
    )
  )
  fireEvent.load(document.head.querySelector('link')!)
  await waitFor(() =>
    expect(document.head.querySelector('script')?.integrity).toBe(
      manifest.entry.integrity
    )
  )
  expect(document.head.querySelector('script')?.src).toBe(
    'https://host.test/applications/make-ui/panel-abc.js'
  )
  const host = (
    window as unknown as {
      VoiceChatApplicationHost: {
        register: (
          id: string,
          version: string,
          commit: string,
          component: unknown
        ) => void
      }
    }
  ).VoiceChatApplicationHost
  host.register(
    'make-ui',
    manifest.version,
    manifest.commit,
    ({ title }: { title: string }) => <p>{title}</p>
  )
  fireEvent.load(document.head.querySelector('script')!)
  expect(await screen.findByText('Моя мастерская')).toBeVisible()
})
it('несовместимый API не исполняет скрипт и допускает повтор', async () => {
  const { configureApplicationHost, createApplicationPanel } = await import(
    './applicationHost'
  )
  configureApplicationHost('')
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ...manifest,
      host: { minVersion: '2.0.0', maxVersionExclusive: '3.0.0' }
    })
  }))
  vi.stubGlobal('fetch', fetch)
  const Panel = createApplicationPanel('make-ui')
  render(<Panel />)
  expect(await screen.findByRole('alert')).toHaveTextContent('API оболочки')
  expect(document.head.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
})
it('ошибка загрузки не размонтирует соседний чат', async () => {
  const { configureApplicationHost, createApplicationPanel } = await import(
    './applicationHost'
  )
  configureApplicationHost('')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 503 }))
  )
  const Panel = createApplicationPanel('make-ui')
  render(
    <>
      <textarea aria-label="Сообщение" defaultValue="Черновик" />
      <Panel />
    </>
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('503')
  expect(screen.getByRole('textbox')).toHaveValue('Черновик')
})
it('ошибка render панели сохраняет соседний чат и даёт перезапуск', async () => {
  const { configureApplicationHost, createApplicationPanel } = await import(
    './applicationHost'
  )
  configureApplicationHost('')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...manifest, styles: [] })
    }))
  )
  const Panel = createApplicationPanel('make-ui')
  render(
    <>
      <textarea aria-label="Сообщение" defaultValue="Сохранить черновик" />
      <Panel />
    </>
  )
  await waitFor(() =>
    expect(document.head.querySelector('script')).not.toBeNull()
  )
  const host = (
    window as unknown as {
      VoiceChatApplicationHost: {
        register(
          id: string,
          version: string,
          commit: string,
          component: unknown
        ): void
      }
    }
  ).VoiceChatApplicationHost
  host.register('make-ui', manifest.version, manifest.commit, () => {
    throw new Error('Ошибка несовместимой панели')
  })
  fireEvent.load(document.head.querySelector('script')!)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Ошибка приложения'
  )
  expect(screen.getByRole('textbox')).toHaveValue('Сохранить черновик')
  expect(
    screen.getByRole('button', { name: 'Перезапустить приложение' })
  ).toBeEnabled()
})
