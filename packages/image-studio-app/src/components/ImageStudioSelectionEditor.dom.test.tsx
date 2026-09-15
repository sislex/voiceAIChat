import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '../../../ui/src/test/uiRender'
import { ImageStudioSelectionEditor } from './ImageStudioSelectionEditor'

describe('ImageStudioSelectionEditor', () => {
  it('creates a natural-pixel rectangle for localized model retouch', async () => {
    const onRetouch = vi.fn(async () => {})
    render(<ImageStudioSelectionEditor path="portrait.png" src="data:image/png;base64,AA==" onRetouch={onRetouch} onExtract={async () => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Рамка' }))
    const image = screen.getByRole('img', { name: 'portrait.png' }) as HTMLImageElement
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1000 },
      naturalHeight: { configurable: true, value: 500 },
      getBoundingClientRect: { configurable: true, value: () => ({ left: 10, top: 20, right: 510, bottom: 270, width: 500, height: 250, x: 10, y: 20, toJSON: () => ({}) }) }
    })
    fireEvent.load(image)
    const stage = image.closest('.image-studio-selection-stage') as HTMLElement
    fireEvent.pointerDown(stage, { clientX: 110, clientY: 70, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 310, clientY: 170, pointerId: 1 })
    fireEvent.pointerUp(stage, { pointerId: 1 })
    fireEvent.change(screen.getByRole('textbox', { name: 'Что изменить' }), { target: { value: 'убрать блик на очках' } })
    fireEvent.click(screen.getByRole('button', { name: 'Изменить только выделенное' }))
    expect(onRetouch).toHaveBeenCalledWith({ kind: 'rectangle', x: 200, y: 100, width: 400, height: 200 }, 'убрать блик на очках')
  })

  it('keeps all selection actions reachable in a single scrollable surface', () => {
    render(<ImageStudioSelectionEditor path="portrait.png" src="data:image/png;base64,AA==" onRetouch={async () => {}} onExtract={async () => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: 'Волшебная палочка' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Найти объекты' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Извлечь объект отдельно' })).toBeDisabled()
    expect(document.querySelector('.image-studio-selection')).toBeInTheDocument()
  })
})
