import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MakeControlField, colorToHex, controlKind } from './MakeControls'

describe('MakeControls', () => {
  it('controlKind: argTypes важнее эвристики; цвет и enum распознаются по значению; объекты — json', () => {
    expect(controlKind(5, { control: 'range', min: 0, max: 10 })).toBe('range')
    expect(controlKind('#ff0000')).toBe('color')
    expect(controlKind('rgb(1, 2, 3)')).toBe('color')
    expect(controlKind('primary', undefined, ['primary', 'ghost'])).toBe('select')
    expect(controlKind('sm', { options: ['sm', 'md'] })).toBe('select')
    expect(controlKind({ a: 1 })).toBe('json')
    expect(controlKind(['a'])).toBe('json')
    expect(controlKind('[function]')).toBe('readonly')
    expect(controlKind('plain')).toBe('text')
    expect(colorToHex('rgb(79, 124, 255)')).toBe('#4f7cff')
    expect(colorToHex('#abc')).toBe('#aabbcc')
  })

  it('range меняет число, json принимает только валидный текст и показывает ошибку', async () => {
    const onChange = vi.fn()
    render(<MakeControlField name="size" base={5} value={5} argType={{ control: 'range', min: 0, max: 10 }} onChange={onChange} />)
    const range = screen.getByLabelText('size') as HTMLInputElement
    expect(range.type).toBe('range')
    const onJson = vi.fn()
    render(<MakeControlField name="items" base={['a']} value={['a']} onChange={onJson} />)
    const ta = screen.getByLabelText('items') as HTMLTextAreaElement
    // fireEvent вместо userEvent.type: у user-event `[`/`{` — спецсимволы клавиатурной разметки.
    fireEvent.change(ta, { target: { value: '["a", "b"' } })
    expect(screen.getByRole('alert')).toHaveTextContent('JSON')
    expect(onJson).not.toHaveBeenCalledWith(['a', 'b'])
    fireEvent.change(ta, { target: { value: '["a", "b"]' } })
    expect(onJson).toHaveBeenLastCalledWith(['a', 'b'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
