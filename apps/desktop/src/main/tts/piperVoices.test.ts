import { describe, it, expect } from 'vitest'
import { piperVoiceFile, piperVoiceLabel, piperVoicesFromFiles } from './piperVoices'

describe('piperVoiceFile', () => {
  it('добавляет .onnx; пустой id → голос по умолчанию', () => {
    expect(piperVoiceFile('ru_RU-irina-medium')).toBe('ru_RU-irina-medium.onnx')
    expect(piperVoiceFile('')).toBe('ru_RU-irina-medium.onnx')
    expect(piperVoiceFile('x.onnx')).toBe('x.onnx')
  })
})

describe('piperVoiceLabel', () => {
  it('строит человекочитаемое имя из id', () => {
    expect(piperVoiceLabel('ru_RU-irina-medium')).toBe('Irina — русский (medium)')
    expect(piperVoiceLabel('en_US-amy-low')).toBe('Amy — English (low)')
  })
  it('неизвестный формат → сам id', () => {
    expect(piperVoiceLabel('странное')).toBe('странное')
  })
})

describe('piperVoicesFromFiles', () => {
  it('берёт только .onnx и делает метки', () => {
    const voices = piperVoicesFromFiles([
      'ru_RU-irina-medium.onnx',
      'ru_RU-irina-medium.onnx.json',
      'en_US-amy-low.onnx',
      'readme.txt'
    ])
    expect(voices).toEqual([
      { id: 'ru_RU-irina-medium', label: 'Irina — русский (medium)' },
      { id: 'en_US-amy-low', label: 'Amy — English (low)' }
    ])
  })
})
