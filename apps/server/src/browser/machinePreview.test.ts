import { describe, it, expect } from 'vitest'
import { PreviewRunKeys, isMachinePreviewUrl, machinePreviewUrl } from './machinePreview.js'

describe('адрес машины для изолированного Chromium', () => {
  it('машина уходит в прокси превью, публичный адрес остаётся прежним', () => {
    expect(machinePreviewUrl('http://voicechat:8787/', 'http://agent-1.machine.internal:5173/board'))
      .toBe('http://voicechat:8787/api/preview?url=http%3A%2F%2Fagent-1.machine.internal%3A5173%2Fboard')
    expect(machinePreviewUrl('http://voicechat:8787', 'https://example.test/page'))
      .toBe('https://example.test/page')
  })

  it('признак адреса машины не путается с похожим хостом', () => {
    expect(isMachinePreviewUrl('http://agent-1.machine.internal:5173/')).toBe(true)
    expect(isMachinePreviewUrl('http://machine.internal.example.test/')).toBe(false)
    expect(isMachinePreviewUrl('не адрес')).toBe(false)
  })
})

describe('ключи доступа Chromium к прокси превью', () => {
  it('ключ один на пользователя и продлевается вместо выдачи второго', () => {
    const keys = new PreviewRunKeys(1000)
    const first = keys.issue('alice', 0)
    expect(keys.issue('alice', 500)).toBe(first)
    expect(keys.size()).toBe(1)
    expect(keys.userOf(first, 1200)).toBe('alice')
  })

  it('истёкший ключ никого не авторизует и забывается', () => {
    const keys = new PreviewRunKeys(1000)
    const key = keys.issue('alice', 0)
    expect(keys.userOf(key, 1001)).toBeNull()
    expect(keys.size()).toBe(0)
  })

  it('отзыв закрывает доступ, чужой и пустой ключ не авторизуют', () => {
    const keys = new PreviewRunKeys()
    const key = keys.issue('alice')
    keys.revoke('alice')
    expect(keys.userOf(key)).toBeNull()
    expect(keys.userOf('подделка')).toBeNull()
    expect(keys.userOf(undefined)).toBeNull()
  })
})
