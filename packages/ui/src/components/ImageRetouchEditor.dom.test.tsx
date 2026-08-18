import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImageRetouchEditor } from './ImageRetouchEditor'

const source = { uploadId: 'u1', path: '/tmp/original.png', name: 'original.png', mimeType: 'image/png', size: 10 }

function setup(): { retouch: ReturnType<typeof vi.fn> } {
  const retouch = vi.fn(async (arg) => ({ message: { id: 'm2', conversationId: arg.conversationId, role: 'ai', text: '', time: '12:00', createdAt: 1 }, image: { ...source, path: '/tmp/result.png', retouch: { source, selection: arg.selection, prompt: arg.prompt } } }))
  window.api = { ...window.api, 'images:retouch': retouch } as typeof window.api
  render(<ImageRetouchEditor src="data:image/png;base64,x" source={source} conversationId="c1" onClose={() => {}} onDone={() => {}} />)
  const image = screen.getByAltText('original.png')
  Object.defineProperties(image, {
    naturalWidth: { value: 1000 },
    naturalHeight: { value: 500 },
    clientWidth: { value: 500 },
    clientHeight: { value: 250 },
    getBoundingClientRect: { value: () => ({ left: 0, top: 0, width: 500, height: 250, right: 500, bottom: 250, x: 0, y: 0, toJSON: () => ({}) }) }
  })
  fireEvent.load(image)
  return { retouch }
}

describe('ImageRetouchEditor', () => {
  it('рисует rectangle в координатах оригинала и очищает его', async () => {
    const { retouch } = setup()
    const canvas = document.querySelector('canvas')!
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 25, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(canvas, { clientX: 150, clientY: 75, pointerId: 1, buttons: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    fireEvent.change(screen.getByLabelText('Описание ретуши'), { target: { value: 'убрать складку' } })
    fireEvent.click(screen.getByText('Очистить'))
    expect(screen.getByText('Выполнить ретушь')).toBeDisabled()
    fireEvent.pointerDown(canvas, { clientX: 50, clientY: 25, pointerId: 2, buttons: 1 })
    fireEvent.pointerMove(canvas, { clientX: 150, clientY: 75, pointerId: 2, buttons: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 2 })
    fireEvent.click(screen.getByText('Выполнить ретушь'))
    await waitFor(() => expect(retouch).toHaveBeenCalled())
    expect(retouch.mock.calls[0][0].selection).toEqual({ kind: 'rectangle', x: 100, y: 50, width: 200, height: 100 })
  })

  it('создаёт произвольное выделение лассо', async () => {
    const { retouch } = setup()
    fireEvent.click(screen.getByText('Лассо'))
    const canvas = document.querySelector('canvas')!
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 10, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 20, pointerId: 1, buttons: 1 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    fireEvent.change(screen.getByLabelText('Описание ретуши'), { target: { value: 'ретушь' } })
    fireEvent.click(screen.getByText('Выполнить ретушь'))
    await waitFor(() => expect(retouch).toHaveBeenCalled())
    expect(retouch.mock.calls[0][0].selection.kind).toBe('lasso')
    expect(retouch.mock.calls[0][0].selection.points).toHaveLength(3)
  })
})
