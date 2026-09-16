// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, cleanup } from '@testing-library/react'
import { render } from '../test/uiRender'
import { lazyScreen, sharedLoad } from './lazyScreen'
import { useState } from 'react'
import { Dialog } from '@voicechat/ui-kit'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

// @testCase TC-RECOVERY
it('turns a stalled load into a recoverable timeout', async () => {
  vi.useFakeTimers()
  const loader = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue('ready')
  const load = sharedLoad(loader, 1000)
  const failure = expect(load()).rejects.toThrow('слишком много времени')
  await vi.advanceTimersByTimeAsync(1000)
  await failure
  await expect(load()).resolves.toBe('ready')
})

// @testCase TC-INTENT
it('coalesces intent and activation and retries a rejected intent', async () => {
  let reject!: (error: Error) => void
  const loader = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail })).mockResolvedValue('ready')
  const load = sharedLoad(loader)
  const first = load()
  expect(load()).toBe(first)
  await Promise.resolve()
  reject(new Error('offline'))
  await expect(first).rejects.toThrow('offline')
  await expect(load()).resolves.toBe('ready')
  expect(loader).toHaveBeenCalledTimes(2)
})

// @testCase TC-RECOVERY
// @testCase TC-REGRESSION
it('keeps the shell and draft through a chunk failure and explicit retry', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const load = vi.fn().mockRejectedValueOnce(new Error('chunk 404')).mockResolvedValue({ default: () => <p>Optional ready</p> })
  const Optional = lazyScreen(load)
  render(<><textarea aria-label="Draft" defaultValue="Unsaved text" /><Optional /></>)
  await screen.findByRole('alert')
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved text')
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  await screen.findByText('Optional ready')
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved text')
  expect(load).toHaveBeenCalledTimes(2)
})

// @testCase TC-RECOVERY
it('bounds recovery attempts without reloading or dropping the shell', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const load = vi.fn().mockRejectedValue(new Error('stale chunk'))
  const Optional = lazyScreen(load)
  render(<><p>Shell</p><Optional /></>)
  for (let attempt = 0; attempt < 3; attempt++) {
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
  }
  await waitFor(() => expect(load).toHaveBeenCalledTimes(4))
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull()
  expect(screen.getByText('Shell')).toBeVisible()
})

// @testCase TC-UI
// @testCase TC-RECOVERY
it('keeps a pending modal closable without removing the shell or draft', async () => {
  const Optional = lazyScreen(() => new Promise<{ default: (props: { onClose: () => void }) => JSX.Element }>(() => {}), { frame: (content, props) => <Dialog title="Optional modal" onClose={props.onClose}>{content}</Dialog> })
  function Fixture(): JSX.Element {
    const [open, setOpen] = useState(true)
    return <><textarea aria-label="Draft" defaultValue="Retain draft" />{open && <Optional onClose={() => setOpen(false)} />}</>
  }
  render(<Fixture />)
  expect(screen.getByRole('dialog', { name: 'Optional modal' })).toBeVisible()
  expect(screen.getByRole('status', { name: 'Загрузка экрана' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Retain draft')
})

// @testCase TC-UI
it('exposes a named busy status while a module loads', async () => {
  const Optional = lazyScreen(() => new Promise<{ default: () => JSX.Element }>(() => {}))
  render(<Optional />)
  expect(screen.getByRole('status', { name: 'Загрузка экрана' })).toHaveAttribute('aria-busy', 'true')
})
