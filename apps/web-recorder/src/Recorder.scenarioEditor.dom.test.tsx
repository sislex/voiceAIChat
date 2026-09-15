// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WEB_RECORDER_MESSAGE_TYPE as type, WEB_RECORDER_PROTOCOL_VERSION as protocolVersion } from '@shared/webRecorder'
import { Recorder } from './Recorder'
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })
function mount() {
  const post = vi.spyOn(window, 'postMessage'); render(<Recorder />)
  fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: window, data: { type, kind: 'init', protocolVersion, conversationId: 'c', registrationId: 'r', capabilities: [], previewUrl: 'https://initial.test/path' } }))
  return { post, address: screen.getByRole('textbox', { name: 'Адрес превью' }) as HTMLInputElement }
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const change = (name: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
it('adds both kinds, numbers steps and reports missing selectors', () => {
  mount(); click('Добавить клик'); click('Добавить ввод')
  expect(screen.getByText('Шагов: 2 / 200')).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Селектор шага 1' }).getAttribute('aria-invalid')).toBe('true')
  expect((screen.getByRole('button', { name: 'Запустить' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('textbox', { name: 'Значение шага 2' })).toBeTruthy()
})
it('duplicates, undoes and redoes a step', () => {
  mount(); click('Добавить клик'); change('Селектор шага 1', '#button'); click('Дублировать шаг 1')
  expect((screen.getByRole('textbox', { name: 'Селектор шага 2' }) as HTMLInputElement).value).toBe('#button')
  click('Отменить правку'); expect(screen.queryByRole('textbox', { name: 'Селектор шага 2' })).toBeNull()
  click('Повторить правку'); expect(screen.getByRole('textbox', { name: 'Селектор шага 2' })).toBeTruthy()
})
it('edits submit and resets incompatible fields when switching action kind', () => {
  mount(); click('Добавить ввод'); change('Значение шага 1', 'hello')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Enter после шага 1' })); expect(screen.getByText('⏎ submit')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Действие шага 1' }), { target: { value: 'click' } })
  expect(screen.queryByText('⏎ submit')).toBeNull(); expect(screen.queryByRole('textbox', { name: 'Значение шага 1' })).toBeNull()
})
it('clears temporary secrets when their selector changes and keeps them out of undo history', () => {
  mount(); click('Добавить ввод'); change('Значение шага 1', 'discard me')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Секрет шага 1' }))
  expect((screen.getByRole('button', { name: 'Отменить правку' }) as HTMLButtonElement).disabled).toBe(true)
  const secret = screen.getByLabelText('Секретное значение шага 1') as HTMLInputElement
  fireEvent.change(secret, { target: { value: 'temporary' } }); change('Селектор шага 1', '#other')
  expect(secret.value).toBe(''); click('Отменить правку'); expect(secret.value).toBe('')
})
it('can undo clearing all steps', () => {
  mount(); click('Добавить клик'); click('Очистить'); expect(screen.getByText('Шагов: 0 / 200')).toBeTruthy()
  click('Отменить правку'); expect(screen.getByRole('textbox', { name: 'Селектор шага 1' })).toBeTruthy()
})
