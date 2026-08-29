import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WEB_RECORDER_MESSAGE_TYPE, WEB_RECORDER_PROTOCOL_VERSION } from '@shared/webRecorder'
import { WebReaderFrame, type WebReaderFramePlatform } from './WebReaderFrame'
import type { ReaderHostRegistration } from './hostBridge'

const type = WEB_RECORDER_MESSAGE_TYPE
const readyMessage = { type, kind: 'ready', protocolVersion: WEB_RECORDER_PROTOCOL_VERSION, conversationId: null, registrationId: null, capabilities: ['read'] }
const platform: WebReaderFramePlatform = {
  origin: window.location.origin,
  subscribeMessages: (listener) => {
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }
}

function frameEl(): HTMLIFrameElement {
  return screen.getByTitle('Web Reader') as HTMLIFrameElement
}
function emit(data: object, overrides: { origin?: string; source?: MessageEventSource | null } = {}): void {
  fireEvent(window, new MessageEvent('message', {
    origin: overrides.origin ?? window.location.origin,
    source: overrides.source === undefined ? frameEl().contentWindow : overrides.source,
    data
  }))
}

afterEach(() => cleanup())

describe('WebReaderFrame', () => {
  it('после handshake регистрирует host и отвечает init на том же origin', async () => {
    const register = vi.fn<(registration: ReaderHostRegistration | null) => void>()
    render(<WebReaderFrame platform={platform} conversationId="conv-1" conversationUrl="https://shop.example/" projectUrl={null} onSave={vi.fn()} onRegisterHost={register} />)
    const post = vi.spyOn(frameEl().contentWindow as Window, 'postMessage')
    emit(readyMessage)
    await waitFor(() => expect(register).toHaveBeenCalled())
    const registration = register.mock.calls.at(-1)?.[0]!
    expect(registration).toMatchObject({ conversationId: 'conv-1', registrationId: expect.any(String) })
    const [init, target] = post.mock.calls.find(([message]) => (message as { kind?: string }).kind === 'init')!
    expect(init).toMatchObject({ conversationId: 'conv-1', registrationId: registration.registrationId, previewUrl: 'https://shop.example/' })
    expect(target).toBe(window.location.origin)
  })

  it('игнорирует ready с чужим origin и от чужого окна', () => {
    const register = vi.fn()
    render(<WebReaderFrame platform={platform} conversationId="conv-1" conversationUrl={null} projectUrl={null} onSave={vi.fn()} onRegisterHost={register} />)
    emit(readyMessage, { origin: 'https://evil.test' })
    emit(readyMessage, { source: window })
    expect(register).not.toHaveBeenCalled()
  })

  it('не передаёт целевой URL до успешного выпуска preview-cookie', async () => {
    let release: (ok: boolean) => void = () => undefined
    const ensurePreview = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve }))
    render(<WebReaderFrame platform={platform} conversationId="conv-1" conversationUrl="https://shop.example/" projectUrl={null} ensurePreview={ensurePreview} onSave={vi.fn()} />)
    const post = vi.spyOn(frameEl().contentWindow as Window, 'postMessage')
    emit(readyMessage)
    expect(screen.getByRole('status')).toHaveTextContent('Подключение Web Preview')
    expect(post.mock.calls.some(([m]) => (m as { previewUrl?: string; url?: string }).previewUrl === 'https://shop.example/' || (m as { url?: string }).url === 'https://shop.example/')).toBe(false)
    release(true)
    await waitFor(() => expect(post.mock.calls.some(([m]) => (m as { kind?: string; url?: string }).kind === 'set-url' && (m as { url?: string }).url === 'https://shop.example/')).toBe(true))
    expect(ensurePreview).toHaveBeenCalledTimes(1)
  })

  it('отказ ensurePreview показывает ошибку, «Повторить» выпускает cookie заново', async () => {
    const ensurePreview = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(true)
    render(<WebReaderFrame platform={platform} conversationId="conv-1" conversationUrl={null} projectUrl="https://project.example/" ensurePreview={ensurePreview} onSave={vi.fn()} />)
    const post = vi.spyOn(frameEl().contentWindow as Window, 'postMessage')
    emit(readyMessage)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось подготовить'))
    expect(post.mock.calls.some(([m]) => (m as { url?: string }).url === 'https://project.example/')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(post.mock.calls.some(([m]) => (m as { kind?: string; url?: string }).kind === 'set-url' && (m as { url?: string }).url === 'https://project.example/')).toBe(true))
    expect(ensurePreview).toHaveBeenCalledTimes(2)
  })

  it('save-url и element-selected доходят только с актуальными ID', async () => {
    const onSave = vi.fn(async () => undefined)
    const register = vi.fn<(registration: ReaderHostRegistration | null) => void>()
    render(<WebReaderFrame platform={platform} conversationId="conv-1" conversationUrl={null} projectUrl={null} onSave={onSave} onRegisterHost={register} />)
    emit(readyMessage)
    await waitFor(() => expect(register).toHaveBeenCalled())
    const { registrationId } = register.mock.calls.at(-1)?.[0]!
    emit({ type, kind: 'save-url', conversationId: 'conv-1', registrationId: 'stale', url: 'https://old.example/' })
    expect(onSave).not.toHaveBeenCalled()
    emit({ type, kind: 'save-url', conversationId: 'conv-1', registrationId, url: 'https://new.example/' })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('https://new.example/'))
  })

  it('показывает понятную ленту действий и позволяет повторить шаг', async () => {
    const repeat = vi.fn()
    render(<WebReaderFrame platform={platform} conversationId="conv-1" conversationUrl={null} projectUrl={null} onSave={vi.fn()} actions={[{ id: 'a1', action: { kind: 'click', text: 'Купить' }, address: null, title: null }]} onRepeatAction={repeat} />)
    expect(screen.getByLabelText('Действия ассистента')).toHaveTextContent('Нажал Купить')
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(repeat).toHaveBeenCalledWith({ kind: 'click', text: 'Купить' })
  })

  it('размонтирование dispose-ит мост: регистрация снимается, pending закрывается', async () => {
    const register = vi.fn<(registration: ReaderHostRegistration | null) => void>()
    const view = render(<WebReaderFrame platform={platform} conversationId="conv-1" conversationUrl={null} projectUrl={null} onSave={vi.fn()} onRegisterHost={register} />)
    emit(readyMessage)
    await waitFor(() => expect(register).toHaveBeenCalled())
    const registration = register.mock.calls.at(-1)?.[0]!
    const pending = registration.run({ kind: 'open', url: 'https://shop.example/' })
    view.unmount()
    await expect(pending).resolves.toMatchObject({ ok: false, error: expect.stringContaining('закрыта') })
    expect(register.mock.calls.at(-1)?.[0]).toBeNull()
  })
})
