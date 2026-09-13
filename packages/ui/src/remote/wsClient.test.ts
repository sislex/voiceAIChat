import { afterEach, expect, it, vi } from 'vitest'
import { WsClient } from './wsClient'
const sockets: FakeSocket[] = []
class FakeSocket {
  static OPEN = 1
  readyState = 0
  binaryType = ''
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage = null
  onerror = null
  constructor() { sockets.push(this) }
  send() {}
  open() { this.readyState = 1; this.onopen?.() }
  close() { this.readyState = 3; this.onclose?.() }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); sockets.length = 0 })
// @testCase TC6
it('does not report authentication reconnect as a lost-connection episode', () => {
  vi.stubGlobal('WebSocket', FakeSocket)
  const client = new WsClient('ws://test')
  sockets[0]!.open()
  client.reconnect()
  const disconnected = vi.fn()
  client.onDisconnected(disconnected)
  expect(disconnected).not.toHaveBeenCalled()
  sockets[1]!.open()
  sockets[1]!.close()
  expect(disconnected).toHaveBeenCalledOnce()
  client.close()
})

// @testCase TC6
it('manual retry cancels the scheduled reconnect and cannot start parallel sockets', () => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeSocket)
  const client = new WsClient('ws://test')
  const disconnected = vi.fn()
  client.onDisconnected(disconnected)
  sockets[0]!.open()
  sockets[0]!.close()
  expect(disconnected).toHaveBeenCalledOnce()
  client.retry()
  client.retry()
  vi.advanceTimersByTime(2000)
  expect(sockets).toHaveLength(2)
  sockets[1]!.open()
  expect(client.isConnected()).toBe(true)
  client.close()
  vi.advanceTimersByTime(2000)
  expect(sockets).toHaveLength(2)
})
