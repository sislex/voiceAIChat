import { describe, expect, it, vi } from 'vitest'
import { runReaderModelRequest, readReaderErrors } from './webReaderModelRequest'
import type { PreviewErrorsResult } from '@shared/previewActions'
import type { PreviewActionOutcome } from '@voicechat/web-reader-app'
import type { ReaderHostRegistration } from '@voicechat/web-reader-app'
const registration = (run: ReaderHostRegistration['run']): ReaderHostRegistration => ({ conversationId: 'qa', registrationId: 'first', capabilities: [], run, beginDiagnostics() {}, endDiagnostics() {} })
const errorsResult = (messages: string[]): PreviewErrorsResult => ({ page: { url: 'https://test.example/', title: 'QA' }, total: messages.length, errors: messages.map(message => ({ kind: 'error', message, at: 0 })) })
const request = (reg: ReaderHostRegistration | null) => ({ conversationId: 'qa', activeConversationId: 'qa', registration: reg, activeRegistrationId: 'first', readerRoute: true, action: { kind: 'read' as const } })
describe('Reader: результат запроса модели', () => {
  it('результат сохраняет исходный registrationId после смены активной регистрации', async () => {
    let finish!: (value: { ok: boolean }) => void
    const options = request(registration(() => new Promise(resolve => { finish = resolve })))
    const result = runReaderModelRequest(options); options.registration = { ...options.registration!, registrationId: 'second' }; finish({ ok: true })
    await expect(result).resolves.toMatchObject({ ok: true, registrationId: 'first' })
  })
  it('ошибка исполнителя не оставляет модель без ответа', async () => {
    await expect(runReaderModelRequest(request(registration(async () => { throw new Error('gone') })))).resolves.toMatchObject({ ok: false, registrationId: 'first' })
  })
  it('чужой разговор не вызывает исполнителя', async () => {
    const run = vi.fn(async () => ({ ok: true })); const options = { ...request(registration(run)), activeConversationId: 'other' }
    expect((await runReaderModelRequest(options)).ok).toBe(false); expect(run).not.toHaveBeenCalled()
  })
  it('неактивная вкладка не исполняет команду', async () => {
    const run = vi.fn(async () => ({ ok: true })); const options = { ...request(registration(run)), activeRegistrationId: 'other-tab' }
    expect((await runReaderModelRequest(options)).ok).toBe(false); expect(run).not.toHaveBeenCalled()
  })
  it('согласованная регистрация выполняет open без предварительного сохранения host-ом', async () => {
    const run = vi.fn(async () => ({ ok: true, result: { url: 'https://final.test/' } }))
    expect(await runReaderModelRequest({ ...request(registration(run)), action: { kind: 'open', url: 'https://start.test/' } })).toMatchObject({ ok: true, result: { url: 'https://final.test/' } })
    expect(run).toHaveBeenCalledOnce()
  })
})

describe('Reader: диагностика текущей страницы', () => {
  it('старый ответ не меняет ошибку новой страницы', async () => {
    let current = true, finish!: (value: PreviewActionOutcome) => void
    const pending = readReaderErrors(registration(() => new Promise(resolve => { finish = resolve })), () => current)
    current = false; finish({ ok: true, result: errorsResult(['old']) })
    await expect(pending).resolves.toBeUndefined()
  })
  it('отказ и исключение моста не очищают известную ошибку', async () => {
    expect(await readReaderErrors(registration(async () => ({ ok: false })), () => true)).toBeUndefined()
    expect(await readReaderErrors(registration(async () => { throw Error('gone') }), () => true)).toBeUndefined()
  })
  it('только успешный список без ошибок очищает прежнее сообщение', async () => {
    expect(await readReaderErrors(registration(async () => ({ ok: true })), () => true)).toBeUndefined()
    expect(await readReaderErrors(registration(async () => ({ ok: true, result: errorsResult([]) })), () => true)).toBeNull()
    expect(await readReaderErrors(registration(async () => ({ ok: true, result: errorsResult(['new']) })), () => true)).toBe('new')
  })
})
