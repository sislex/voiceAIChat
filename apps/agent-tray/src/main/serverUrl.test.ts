import { describe, it, expect } from 'vitest'
import { httpBaseFromWs } from './serverUrl'

describe('httpBaseFromWs', () => {
  it('ws→http, wss→https, путь /agent отбрасывается', () => {
    expect(httpBaseFromWs('ws://h:8787/agent')).toBe('http://h:8787')
    expect(httpBaseFromWs('wss://example.com/agent')).toBe('https://example.com')
    expect(httpBaseFromWs('ws://127.0.0.1:8791')).toBe('http://127.0.0.1:8791')
  })
  it('мусор → пустая строка', () => {
    expect(httpBaseFromWs('не-url')).toBe('')
  })
})
