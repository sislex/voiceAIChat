import { describe, expect, it } from 'vitest'
import { llmImageStudioGenerator } from './imageStudioGenerator.js'
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
  })
})
