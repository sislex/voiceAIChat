import { describe, expect, it, vi } from 'vitest'
import { llmImageStudioGenerator } from './generator.js'
import { imageBlock } from '@voicechat/shared'
import type { LlmClient, LlmRequest, LlmStreamHandlers } from '../claude/types.js'

function fakeClient(onSend: (req: LlmRequest) => string): LlmClient {
  return {
    send: (req: LlmRequest, handlers: LlmStreamHandlers) => {
      queueMicrotask(() => handlers.onDone(onSend(req)))
      return { cancel: () => {} }
    }
  } as unknown as LlmClient
}

describe('llmImageStudioGenerator', () => {
  it('асинхронный отказ исполнителя завершает запрос ошибкой', async () => {
    const generate = llmImageStudioGenerator({
      client: { send: async () => { throw new Error('runner unavailable') } } as unknown as LlmClient,
      userId: 'u1', model: 'gpt-5', readGenerated: async () => null
    })
    await expect(generate({ prompt: 'кот' })).rejects.toThrow('runner unavailable')
  })

  it('отмена во время соединения не оставляет запущенный позднее LLM', async () => {
    let connected: (handle: { cancel(): void }) => void = () => {}
    let cancel = () => {}
    const cancelled = vi.fn()
    const send = vi.fn(() => new Promise<{ cancel(): void }>((resolve) => { connected = resolve }))
    const generate = llmImageStudioGenerator({
      client: { send } as unknown as LlmClient, userId: 'u1', model: 'gpt-5', readGenerated: async () => null
    })
    const result = generate({ prompt: 'кот', onCancel: (fn) => { cancel = fn } })
    const rejected = expect(result).rejects.toThrow('Генерация отменена')
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    cancel()
    await rejected
    connected({ cancel: cancelled })
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce())
  })

  it('разрешает инструменты (acceptEdits + cwd) и читает файл из image-блока', async () => {
    let seen: LlmRequest | undefined
    const generate = llmImageStudioGenerator({
      client: fakeClient((req) => {
        seen = req
        return `Готово.\n${imageBlock({ path: '/home/u/арт.png' })}`
      }),
      userId: 'u1',
      model: 'gpt-5',
      cwd: '/home/u',
      readGenerated: async (path) => path === '/home/u/арт.png' ? { dataBase64: Buffer.from('png-данные').toString('base64') } : null
    })
    const result = await generate({ prompt: 'нарисуй кота' })
    expect(result.toString()).toBe('png-данные')
    // Без права исполнения CLI-модель не может создать PNG — режим и cwd обязаны дойти до запроса.
    expect(seen?.permissionMode).toBe('acceptEdits')
    expect(seen?.cwd).toBe('/home/u')
    expect(seen?.executionDisabled).toBeUndefined()
    // Формат fenced-блока модель сама не знает — подсказка обязана быть в промпте.
    expect(seen?.prompt).toContain('```image')
  })

  it('правка прикладывает исходник, а ответ без image-блока — понятная ошибка', async () => {
    const source = Buffer.from('исходник')
    let seen: LlmRequest | undefined
    const generate = llmImageStudioGenerator({
      client: fakeClient((req) => {
        seen = req
        return 'Не смог нарисовать.'
      }),
      userId: 'u1',
      model: 'gpt-5',
      readGenerated: async () => null
    })
    await expect(generate({ prompt: 'перекрась', source, sourceName: 'кот.png' })).rejects.toThrow('AI не вернул файл изображения')
    expect(seen?.attachments?.[0]?.runnerName).toBe('кот.png')
    expect(seen?.attachments?.[0]?.dataBase64).toBe(source.toString('base64'))
    expect(seen?.prompt).toContain('/studio/кот.png')
  })

  it('называет в промпте серверные пути всех вложений для подмены исполнителем', async () => {
    let seen: LlmRequest | undefined
    const generate = llmImageStudioGenerator({
      client: fakeClient((req) => {
        seen = req
        return imageBlock({ path: '/home/u/ретушь.png' })
      }),
      userId: 'u1',
      model: 'gpt-5',
      readGenerated: async () => ({ dataBase64: Buffer.from('retouched').toString('base64') })
    })
    await generate({
      prompt: 'выровняй тон',
      source: Buffer.from('crop'),
      sourceName: 'selection.png',
      mask: Buffer.from('mask'),
      targetSize: { width: 120, height: 80 },
      references: [{ name: 'образец.png', data: Buffer.from('reference') }]
    })
    expect(seen?.prompt).toContain('/studio/selection.png')
    expect(seen?.prompt).toContain('/studio/mask.png')
    expect(seen?.prompt).toContain('/studio/reference-1-образец.png')
    expect(seen?.attachments?.map((item) => item.serverPath)).toEqual([
      '/studio/selection.png',
      '/studio/mask.png',
      '/studio/reference-1-образец.png'
    ])
  })
})
