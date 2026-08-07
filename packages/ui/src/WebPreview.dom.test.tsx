import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PREVIEW_INSPECTOR_MESSAGE_TYPE } from '@shared/previewInspector'
import { WebPreview } from './App'

const payload = {
  tag: 'div', id: 'hero', classes: [], dataAttributes: {}, selector: '#hero', ancestors: ['html','body','div#hero'],
  rect: { x: 0, y: 0, top: 0, right: 320, bottom: 120, left: 0, width: 320, height: 120 },
  pageUrl: 'https://example.test', viewport: { width: 800, height: 600 }, outerHTML: '<div id="hero"></div>', text: '',
  styles: { font:'',color:'',backgroundColor:'',margin:'',padding:'',border:'',width:'',height:'',position:'',display:'',flex:'',flexDirection:'',flexWrap:'',alignItems:'',justifyContent:'',gap:'',grid:'',gridTemplateColumns:'',gridTemplateRows:'',gridArea:'' }
}

describe('WebPreview inspector', () => {
  it('управляет режимом кнопкой и Alt+I, Esc выключает', async () => {
    render(<WebPreview conversationUrl="https://example.test" projectUrl={null} onSave={vi.fn()} />)
    const toggle = screen.getByRole('button', { name: /Инспектор/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.keyDown(window, { key: 'i', altKey: true })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('принимает только валидное сообщение от своего iframe', async () => {
    render(<WebPreview conversationUrl="https://example.test" projectUrl={null} onSave={vi.fn()} />)
    const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { type: PREVIEW_INSPECTOR_MESSAGE_TYPE, payload } }))
    await waitFor(() => expect(screen.getByTestId('preview-selection')).toHaveTextContent('div#hero'))
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.test', source: frame.contentWindow, data: { type: PREVIEW_INSPECTOR_MESSAGE_TYPE, payload: { ...payload, id: 'evil' } } }))
    expect(screen.getByTestId('preview-selection')).not.toHaveTextContent('evil')
  })
})
