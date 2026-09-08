// Предохранитель исходящей очереди WS: переполнение рвёт соединение и сообщает, какие кадры его забили.
import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { attachWs } from './ws.js'

function fakeSocket(): WebSocket & { sent: string[]; bufferedAmount: number; terminate: ReturnType<typeof vi.fn> } {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const socket = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    sent: [] as string[],
    send(data: string | Buffer) { socket.sent.push(String(data)); socket.bufferedAmount += Buffer.byteLength(String(data)) },
    terminate: vi.fn(() => { socket.readyState = 3 }),
    on(event: string, cb: (...args: unknown[]) => void) { listeners.set(event, [...(listeners.get(event) ?? []), cb]) }
  }
  return socket as unknown as WebSocket & { sent: string[]; bufferedAmount: number; terminate: ReturnType<typeof vi.fn> }
}

describe('attachWs: очередь исходящих кадров ограничена', () => {
  it('пока клиент вычитывает — кадры уходят; переполнение рвёт сокет один раз и отдаёт счётчики по типам', async () => {
    const socket = fakeSocket()
    const onOverflow = vi.fn()
    const ctx = await attachWs(socket, {}, { maxBufferedBytes: 500, onOverflow })
    ctx.send({ t: 'board.changed', projectId: 'p' })
    socket.bufferedAmount = 0 // клиент прочитал
    ctx.send({ t: 'board.changed', projectId: 'p' })
    expect(socket.terminate).not.toHaveBeenCalled()
    for (let i = 0; i < 10; i++) ctx.send({ t: 'ci.log', runId: 'r', line: { runId: 'r', stepId: 's', seq: i, stream: 'stdout', chunk: 'x'.repeat(40), at: 0 } })
    expect(socket.terminate).toHaveBeenCalledTimes(1)
    expect(onOverflow).toHaveBeenCalledTimes(1)
    const info = onOverflow.mock.calls[0]![0] as { bufferedAmount: number; frames: Array<[string, number]> }
    expect(info.bufferedAmount).toBeGreaterThan(500)
    expect(info.frames[0]![0]).toBe('ci.log')
    const sentBefore = socket.sent.length
    ctx.send({ t: 'board.changed', projectId: 'p' })
    ctx.sendBinary(Buffer.from('a'))
    expect(socket.sent.length).toBe(sentBefore) // после разрыва в мёртвый сокет не пишем
  })
})
