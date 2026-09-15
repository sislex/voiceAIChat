// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScenarioTransfer } from './ScenarioTransfer'
const steps = [{ kind: 'click' as const, selector: '#go', text: '', sensitive: false }]
const json = JSON.stringify({ format: 'web-reader-scenario', version: 1, pageUrl: 'https://source.test/', steps })
afterEach(cleanup)
const select = (text = json) => fireEvent.change(screen.getByLabelText('Файл сценария JSON'), { target: { files: [{ size: text.length, text: async () => text }] } })
it('stages imported steps until explicit application to the current page', async () => {
  const onImport = vi.fn(); render(<ScenarioTransfer pageUrl="https://target.test/" steps={[]} disabled={false} onImport={onImport} />)
  select(); await screen.findByRole('group', { name: 'Проверка импорта' }); expect(onImport).not.toHaveBeenCalled()
  expect(screen.getByText(/https:\/\/source.test/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Применить к текущей странице' })); expect(onImport).toHaveBeenCalledWith(steps)
})
it('cancels without mutation and accepts the same file again', async () => {
  const onImport = vi.fn(); render(<ScenarioTransfer pageUrl="https://target.test/" steps={steps} disabled={false} onImport={onImport} />)
  select(); await screen.findByRole('group'); fireEvent.click(screen.getByRole('button', { name: 'Отменить импорт' })); expect(onImport).not.toHaveBeenCalled()
  select(); await screen.findByRole('group'); expect((screen.getByLabelText('Файл сценария JSON') as HTMLInputElement).value).toBe('')
})
it('preserves the scenario on invalid files and clears the error on retry', async () => {
  const onImport = vi.fn(); render(<ScenarioTransfer pageUrl="https://target.test/" steps={steps} disabled={false} onImport={onImport} />)
  select('bad'); await screen.findByRole('alert'); expect(onImport).not.toHaveBeenCalled()
  select(); await screen.findByRole('group'); expect(screen.queryByRole('alert')).toBeNull()
})
it('drops a pending read after navigation', async () => {
  let finish!: (text: string) => void
  const props = { steps, disabled: false, onImport: vi.fn() }; const view = render(<ScenarioTransfer {...props} pageUrl="https://first.test/" />)
  fireEvent.change(screen.getByLabelText('Файл сценария JSON'), { target: { files: [{ size: 10, text: () => new Promise<string>(resolve => { finish = resolve }) }] } })
  view.rerender(<ScenarioTransfer {...props} pageUrl="https://second.test/" />); finish(json)
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull()); expect(screen.queryByRole('group')).toBeNull()
})
