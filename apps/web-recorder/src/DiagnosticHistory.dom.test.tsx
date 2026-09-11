// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DiagnosticHistory } from './DiagnosticHistory'
const steps = [{ requestId: '1', action: 'read', ok: true, durationMs: 12 }, { requestId: '2', action: 'click', ok: false, durationMs: 28 }]
afterEach(() => { cleanup(); if (vi.isFakeTimers()) { vi.runOnlyPendingTimers(); vi.useRealTimers() } vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('summarizes successes, failures and total duration', () => { render(<DiagnosticHistory steps={steps} />); expect(screen.getByText(/Успешно: 1 · Ошибок: 1 · Всего: 40 мс/)).toBeTruthy() })
it('searches actions case-insensitively and clears with Escape', () => {
  render(<DiagnosticHistory steps={steps} />); const search = screen.getByRole('textbox'); fireEvent.change(search, { target: { value: ' READ ' } }); expect(screen.getAllByRole('listitem')).toHaveLength(1)
  fireEvent.keyDown(search, { key: 'Escape' }); expect(screen.getAllByRole('listitem')).toHaveLength(2)
})
it('combines failed-only filtering and search with no-match feedback', () => {
  render(<DiagnosticHistory steps={steps} />); fireEvent.click(screen.getByRole('checkbox')); expect(screen.getAllByRole('listitem')).toHaveLength(1)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'read' } }); expect(screen.getByRole('status').textContent).toBe('Нет подходящих действий.')
})
it('collapses details while preserving the summary and filters', () => {
  render(<DiagnosticHistory steps={steps} />); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Скрыть детали диагностики' }))
  expect(screen.queryByRole('list')).toBeNull(); expect(screen.getByText(/Всего: 40 мс/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Показать детали диагностики' })); expect(screen.getAllByRole('listitem')).toHaveLength(1)
})
it('exports complete history even when the display is filtered', () => {
  vi.useFakeTimers(); const blobs: unknown[] = []; vi.stubGlobal('Blob', class { constructor(parts: unknown[]) { blobs.push(parts[0]) } }); const create = vi.fn(() => 'blob:test'); vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<DiagnosticHistory steps={steps} />); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Скачать диагностику' }))
  expect(JSON.parse(String(blobs[0]))).toMatchObject({ total: 2, failed: 1, durationMs: 40, steps })
})
it('shows empty results and disables empty export', () => {
  render(<DiagnosticHistory steps={[]} />); expect(screen.getByRole('status').textContent).toBe('Результатов пока нет.'); expect((screen.getByRole('button', { name: 'Скачать диагностику' }) as HTMLButtonElement).disabled).toBe(true)
})
it('reports download failures without losing results', () => {
  vi.stubGlobal('URL', { createObjectURL: () => { throw new Error('blocked') } }); render(<DiagnosticHistory steps={steps} />); fireEvent.click(screen.getByRole('button', { name: 'Скачать диагностику' }))
  expect(screen.getByRole('alert').textContent).toContain('Не удалось'); expect(screen.getAllByRole('listitem')).toHaveLength(2)
})
