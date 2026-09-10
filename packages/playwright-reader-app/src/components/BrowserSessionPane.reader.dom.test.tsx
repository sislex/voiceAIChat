// Панель Playwright Reader: старт сессии, screencast-поллинг, навигация,
// клик по кадру с пересчётом координат и деградация без раннера. Мост browser — фейк.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RendererBrowserBridge } from '@shared/ipc'
import type { BrowserSessionMetadata } from '@shared/types'
import { BrowserSessionPane } from './BrowserSessionPane'

const meta = (over: Partial<BrowserSessionMetadata> = {}): BrowserSessionMetadata => ({
  id: 'c1', conversationId: 'c1', incarnation: 'inc-1', state: 'ready', activeTabId: 't1', tabs: [],
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }, currentUrl: 'https://a.b', title: null, ...over
})

function fakeBrowser(over: Partial<RendererBrowserBridge> = {}): RendererBrowserBridge {
  return {
    start: vi.fn(async () => meta()),
    command: vi.fn(async () => meta({ currentUrl: 'https://x.y' })),
    screenshot: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,QQ==' })),
    stop: vi.fn(async () => {}),
    ...over
  }
}

afterEach(cleanup)

describe('полный браузер внутри Web Reader', () => {
  it('открывает предыдущий URL в пустой сессии и сохраняет конечный адрес', async () => {
    const browser=fakeBrowser({start:vi.fn(async()=>meta({currentUrl:'about:blank'})),command:vi.fn(async()=>meta({currentUrl:'https://site.test/final'}))}),onPageChange=vi.fn(async()=>{})
    render(<BrowserSessionPane conversationId="c1" browser={browser} initialUrl="https://site.test/start" onPageChange={onPageChange}/>);
    await screen.findByAltText('Кадр Chromium');expect(browser.command).toHaveBeenCalledWith('c1',expect.objectContaining({command:{type:'navigate',url:'https://site.test/start'}}));await waitFor(()=>expect(onPageChange).toHaveBeenCalledWith('https://site.test/final'))
  })
  it('не уводит уже живую Chromium-сессию обратно на сохранённый URL', async () => {
    const browser=fakeBrowser();render(<BrowserSessionPane conversationId="c1" browser={browser} initialUrl="https://older.test/"/>);await screen.findByAltText('Кадр Chromium');expect(browser.command).not.toHaveBeenCalled()
  })
  it('метаданные кадра отражают переход модели и сохраняют логический URL', async () => {
    const browser=fakeBrowser({screenshot:vi.fn(async()=>({dataUrl:'data:image/jpeg;base64,QQ==',page:{url:'https://site.test/model',title:'Model'}}))}),onPageChange=vi.fn(async()=>{})
    render(<BrowserSessionPane conversationId="c1" browser={browser} onPageChange={onPageChange}/>);await waitFor(()=>expect((screen.getByLabelText('Адрес страницы') as HTMLInputElement).value).toBe('https://site.test/model'));await waitFor(()=>expect(onPageChange).toHaveBeenCalledWith('https://site.test/model'))
  })
  it('поздний кадр не затирает черновик адреса под курсором', async () => {
    let resolve!:(value:{dataUrl:string;page:{url:string;title:string}})=>void
    const browser=fakeBrowser({screenshot:vi.fn(()=>new Promise<{dataUrl:string;page:{url:string;title:string}}>(ok=>{resolve=ok}))});render(<BrowserSessionPane conversationId="c1" browser={browser}/>);await waitFor(()=>expect(browser.screenshot).toHaveBeenCalled());const input=screen.getByLabelText('Адрес страницы') as HTMLInputElement;fireEvent.focus(input);fireEvent.change(input,{target:{value:'new-site.test'}});await act(async()=>resolve({dataUrl:'data:image/jpeg;base64,QQ==',page:{url:'https://site.test/model',title:'Model'}}));expect(input.value).toBe('new-site.test')
  })
  it('пустая сессия предлагает Gmail и Instagram через обычные команды браузера', async () => {
    const browser=fakeBrowser({start:vi.fn(async()=>meta({currentUrl:'about:blank'}))});render(<BrowserSessionPane conversationId="c1" browser={browser}/>);fireEvent.click(await screen.findByText('Gmail'));await waitFor(()=>expect(browser.command).toHaveBeenCalledWith('c1',expect.objectContaining({command:{type:'navigate',url:'https://mail.google.com/'}})))
  })
  it('первый переход обновляет подпись вкладки без ложного предупреждения об origin', async () => {
    const browser=fakeBrowser({start:vi.fn(async()=>meta({currentUrl:'about:blank',tabs:[{id:'t1',url:'about:blank',title:'',active:true}]})),screenshot:vi.fn(async()=>({dataUrl:'data:image/jpeg;base64,QQ==',page:{url:'https://site.test/',title:'Первая страница'}}))})
    render(<BrowserSessionPane conversationId="c1" browser={browser}/>);await screen.findByRole('tab',{name:'Первая страница'});expect(screen.queryByText(/Страница ушла/)).toBeNull()
  })
  it('ошибка закрытия уже переключённого браузера не создаёт unhandled rejection', async () => {
    const browser=fakeBrowser({stop:vi.fn(async()=>{throw new Error('already switched')})});const rendered=render(<BrowserSessionPane conversationId="c1" browser={browser}/>);await screen.findByAltText('Кадр Chromium');rendered.unmount();await waitFor(()=>expect(browser.stop).toHaveBeenCalled())
  })
})
