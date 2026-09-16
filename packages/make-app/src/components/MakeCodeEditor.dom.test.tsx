import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as editorModule from '@voicechat/ui-foundation/components/CodeEditor'
import { CodeEditor } from './MakeCodeEditor'

afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'deviceMemory') })

// @testCase T6
it('uses the lite editor with limited memory and protects highlighted historical reading', () => {
  const base = vi.spyOn(editorModule, 'CodeEditor').mockImplementation(() => <div data-testid="full-editor" />)
  Object.defineProperty(navigator, 'deviceMemory', { value: 1, configurable: true })
  const onChange = vi.fn(), onSave = vi.fn()
  const { rerender } = render(<CodeEditor path="index.html" value="<h1>History</h1>" onChange={onChange} onSave={onSave} readOnly ariaLabel="History" />)
  const input = screen.getByLabelText('History')
  expect(input).toHaveAttribute('readonly')
  expect(document.querySelector('.make-highlight code')?.textContent).toBe('<h1>History</h1>')
  fireEvent.change(input, { target: { value: 'changed' } }); fireEvent.keyDown(input, { key: 'Tab' }); fireEvent.keyDown(input, { key: 's', ctrlKey: true })
  expect(onChange).not.toHaveBeenCalled(); expect(onSave).not.toHaveBeenCalled(); expect(base).not.toHaveBeenCalled()
  Reflect.deleteProperty(navigator, 'deviceMemory')
  rerender(<CodeEditor path="index.html" value="source" onChange={onChange} ariaLabel="Source" />)
  expect(screen.getByTestId('full-editor')).toBeInTheDocument()
})
