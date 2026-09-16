// Санитайзер патча настроек: граница между «человек поменял тумблер» и записью
// в БД. Настройки хранятся одной JSON-строкой и мержатся с прежними, поэтому
// принятый мусорный ключ остаётся в записи навсегда.

import { describe, expect, it } from 'vitest'
import { DEFAULT_CHAT_INSTRUCTIONS, DEFAULT_SETTINGS, sanitizeSettingsPatch } from './types'

import { initialOnboarding, parseOnboarding, onboardingTransition, ONBOARDING_STEPS } from './types'

// @testCase TC-CONTRACT-1
it('round-trips every onboarding state without changing unrelated settings', () => {
  const progress = initialOnboarding()
  for (const step of ONBOARDING_STEPS) progress.results[step] = { status: 'success', diagnostic: 'Verified' }
  const patch = sanitizeSettingsPatch({ onboarding: progress })
  expect(patch).toEqual({ onboarding: progress })
  expect({ ...DEFAULT_SETTINGS, ...patch, ...sanitizeSettingsPatch({ onboarding: null }) })
    .toEqual({ ...DEFAULT_SETTINGS, onboarding: null })
  expect(sanitizeSettingsPatch({ onboarding: { ...progress, version: 2 } })).toEqual({})
  expect(sanitizeSettingsPatch({ onboarding: { ...progress, results: {} } })).toEqual({})
})

// @testCase TC-STATE-1
it('recovers interrupted checks without replay and keeps independent successes on retry and skip', () => {
  let progress = onboardingTransition(initialOnboarding(), 'tts', { status: 'success', diagnostic: 'Played' })
  progress = onboardingTransition(progress, 'microphone', { status: 'checking', diagnostic: '' })
  const restored = parseOnboarding(JSON.parse(JSON.stringify(progress)), true)!
  expect(restored.results.microphone.status).toBe('warning')
  expect(restored.results.tts.status).toBe('success')
  const skipped = onboardingTransition(restored, 'microphone', { status: 'skipped', diagnostic: 'Skipped' })
  expect(skipped.results.tts.status).toBe('success')
  expect(skipped.results.voice.status).toBe('idle')
  expect(initialOnboarding().results.tts.status).toBe('idle')
  expect(parseOnboarding({ results: null })).toBeNull()
})

describe('sanitizeSettingsPatch', () => {
  it('пропускает известные поля и приводит модель Claude к алиасу', () => {
    expect(sanitizeSettingsPatch({ theme: 'dark', autoSpeak: true, model: 'claude-sonnet-4-5' }))
      .toEqual({ theme: 'dark', autoSpeak: true, model: 'sonnet' })
  })

  it('выбрасывает неизвестные ключи и значения не из набора', () => {
    expect(sanitizeSettingsPatch({ theme: 'нечто', llmProvider: 'gemini', permissionMode: 'root', hack: 1 })).toEqual({})
    expect(sanitizeSettingsPatch({ autoSpeak: 'да', generatedFilesTtlDays: 1.5 })).toEqual({})
  })

  it('различает null и мусор в полях-ссылках', () => {
    expect(sanitizeSettingsPatch({ defaultAgentId: null, execTarget: 'a1', workdir: 7 }))
      .toEqual({ defaultAgentId: null, execTarget: 'a1' })
  })

  it('нормализует инструкции чата и чистит список подсказок', () => {
    const patch = sanitizeSettingsPatch({
      chatInstructions: [{ ...DEFAULT_CHAT_INSTRUCTIONS[0], enabled: false }, { id: 'без названия' }],
      aiAssistPrompts: [{ id: 'p1', title: 'Свой', text: 'текст' }, 'мусор', { title: 'без id' }]
    })
    // Элемент без названия отбрасывается: список инструкций — не свалка.
    expect(patch.chatInstructions).toHaveLength(1)
    expect(patch.chatInstructions?.find((item) => item.id === DEFAULT_CHAT_INSTRUCTIONS[0].id)?.enabled).toBe(false)
    expect(patch.aiAssistPrompts).toEqual([{ id: 'p1', title: 'Свой', text: 'текст', enabled: true }])
  })

  it('не считает патчем не-объект', () => {
    expect(sanitizeSettingsPatch(null)).toEqual({})
    expect(sanitizeSettingsPatch('theme=dark')).toEqual({})
  })

  // Страж: новое поле Settings, о котором санитайзер не знает, молча перестало
  // бы сохраняться — настройка «есть в интерфейсе, но не переживает перезагрузку».
  it('пропускает каждое поле контракта', () => {
    const missing = Object.keys(DEFAULT_SETTINGS).filter((key) => {
      const value = DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS]
      return !(key in sanitizeSettingsPatch({ [key]: value }))
    })
    expect(missing).toEqual([])
  })
})
