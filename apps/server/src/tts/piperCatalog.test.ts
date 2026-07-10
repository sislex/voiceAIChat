import { describe, it, expect } from 'vitest'
import { piperCatalog, voiceUrls } from './piperCatalog'

describe('piperCatalog', () => {
  it('содержит русские голоса с человекочитаемыми метками', () => {
    const cat = piperCatalog()
    const irina = cat.find((v) => v.id === 'ru_RU-irina-medium')
    expect(irina?.label).toBe('Irina — русский (medium)')
    expect(cat.length).toBeGreaterThanOrEqual(3)
  })
})

describe('voiceUrls', () => {
  it('строит URL onnx и config из id', () => {
    const urls = voiceUrls('ru_RU-irina-medium')
    expect(urls).toEqual({
      onnx: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx',
      config:
        'https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx.json'
    })
  })

  it('null для некорректного id', () => {
    expect(voiceUrls('мусор')).toBeNull()
  })
})
