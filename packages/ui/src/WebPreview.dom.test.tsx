import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PREVIEW_INSPECTOR_MESSAGE_TYPE } from '@shared/previewInspector'
import { PreviewPane } from './App'

const payload = {
  tag: 'div', id: 'hero', classes: [], dataAttributes: {}, selector: '#hero', ancestors: ['html','body','div#hero'],
  rect: { x: 0, y: 0, top: 0, right: 320, bottom: 120, left: 0, width: 320, height: 120 },
  pageUrl: 'https://example.test', viewport: { width: 800, height: 600 }, outerHTML: '<div id="hero"></div>', text: '',
  styles: { font:'',color:'',backgroundColor:'',margin:'',padding:'',border:'',width:'',height:'',position:'',display:'',flex:'',flexDirection:'',flexWrap:'',alignItems:'',justifyContent:'',gap:'',grid:'',gridTemplateColumns:'',gridTemplateRows:'',gridArea:'' }
}

describe('WebPreview inspector', () => {
  it('открывает same-origin proxy без Bearer-токена в URL', () => {
    localStorage.setItem('vc.session.token', 'main-bearer-secret')
    render(<PreviewPane conversationUrl="https://tehniks.by/" projectUrl={null} onSave={vi.fn()} />)
    const src = (screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement).getAttribute('src')
    expect(src).toBe('/api/preview?url=https%3A%2F%2Ftehniks.by%2F')
    expect(src).not.toContain('main-bearer-secret')
    localStorage.removeItem('vc.session.token')
  })

  it('управляет режимом кнопкой и Alt+I, Esc выключает', async () => {
    render(<PreviewPane conversationUrl="https://example.test" projectUrl={null} onSave={vi.fn()} />)
    const toggle = screen.getByRole('button', { name: /Выбор элемента/ })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.keyDown(window, { key: 'i', altKey: true })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('принимает только валидное сообщение от своего iframe', async () => {
    const onSelectElement = vi.fn()
    render(<PreviewPane conversationUrl="https://example.test" projectUrl={null} onSave={vi.fn()} onSelectElement={onSelectElement} />)
    const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { type: PREVIEW_INSPECTOR_MESSAGE_TYPE, payload } }))
    await waitFor(() => expect(onSelectElement).toHaveBeenCalledWith(payload))
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.test', source: frame.contentWindow, data: { type: PREVIEW_INSPECTOR_MESSAGE_TYPE, payload: { ...payload, id: 'evil' } } }))
    window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: window, data: { type: PREVIEW_INSPECTOR_MESSAGE_TYPE, payload: { ...payload, id: 'other-frame' } } }))
    expect(onSelectElement).toHaveBeenCalledTimes(1)
  })

  it('показывает обновление и открытие во внешней вкладке', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<PreviewPane conversationUrl="https://example.test/page" projectUrl={null} onSave={vi.fn()} />)
    const before = screen.getByTitle('Предпросмотр сайта')
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }))
    expect(screen.getByTitle('Предпросмотр сайта')).not.toBe(before)
    await userEvent.click(screen.getByRole('button', { name: 'Открыть в новой вкладке' }))
    expect(open).toHaveBeenCalledWith('https://example.test/page', '_blank', 'noopener,noreferrer')
  })
})
