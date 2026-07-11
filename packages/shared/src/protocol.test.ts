import { describe, it, expect } from 'vitest'
import { CLIENT_MESSAGE_TYPES, REST, SERVER_MESSAGE_TYPES } from './protocol'

describe('контракт протокола', () => {
  it('списки типов сообщений уникальны и непусты', () => {
    expect(new Set(CLIENT_MESSAGE_TYPES).size).toBe(CLIENT_MESSAGE_TYPES.length)
    expect(new Set(SERVER_MESSAGE_TYPES).size).toBe(SERVER_MESSAGE_TYPES.length)
    expect(CLIENT_MESSAGE_TYPES.length).toBeGreaterThan(0)
    expect(SERVER_MESSAGE_TYPES.length).toBeGreaterThan(0)
  })

  it('покрывает прежние IPC-возможности (STT/Claude/TTS/аудио/скачивание)', () => {
    for (const t of ['audio.start', 'audio.stop', 'claude.send', 'tts.speak', 'stt.download'])
      expect(CLIENT_MESSAGE_TYPES).toContain(t)
    for (const t of ['stt.partial', 'stt.final', 'claude.token', 'claude.done', 'tts.audio'])
      expect(SERVER_MESSAGE_TYPES).toContain(t)
  })

  it('содержит claude.log (режим консоли)', () => {
    expect(SERVER_MESSAGE_TYPES).toContain('claude.log')
  })

  it('REST-пути строятся корректно', () => {
    expect(REST.conversations).toBe('/api/conversations')
    expect(REST.conversation('abc')).toBe('/api/conversations/abc')
    expect(REST.messages('x')).toBe('/api/conversations/x/messages')
    expect(REST.ttsVoiceDownload('ru_RU-irina-medium')).toContain('ru_RU-irina-medium')
  })
})
