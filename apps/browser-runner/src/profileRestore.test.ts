// Круг 15: настройка проверки переживает перезапуск сессии. Человек выбирал
// «телефон, тёмная тема», перезапускал зависшую страницу и молча получал
// десктоп со светлой темой — то есть проверял совсем не то, что собирался.

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readReaderProfile, writeReaderProfile } from './profileState'

const device = { width: 390, height: 844, deviceScaleFactor: 3, touch: true, orientation: 'portrait' as const, preset: 'phone' }
const environment = { colorScheme: 'dark' as const, reducedMotion: 'no-preference' as const, forcedColors: 'none' as const, offline: false, geolocation: null, permissions: [] }

describe('профиль сессии', () => {
  it('сохраняет и возвращает устройство и среду', async () => {
    const path = await mkdtemp(join(tmpdir(), 'vc-profile-'))
    try {
      await writeReaderProfile(path, { cookies: [], device, environment })
      const saved = await readReaderProfile(path)
      expect(saved?.device).toMatchObject({ width: 390, touch: true })
      expect(saved?.environment).toMatchObject({ colorScheme: 'dark' })
    } finally { await rm(path, { recursive: true, force: true }) }
  })

  it('половинчатое состояние отбрасывается: применённое молча хуже отсутствующего', async () => {
    const path = await mkdtemp(join(tmpdir(), 'vc-profile-'))
    try {
      await writeReaderProfile(path, { cookies: [], device: { width: 390 } as never, environment: { colorScheme: 'dark' } as never })
      const saved = await readReaderProfile(path)
      expect(saved?.device).toBeUndefined()
      expect(saved?.environment).toBeUndefined()
    } finally { await rm(path, { recursive: true, force: true }) }
  })

  it('старый профиль без эмуляции читается как раньше', async () => {
    const path = await mkdtemp(join(tmpdir(), 'vc-profile-'))
    try {
      await writeReaderProfile(path, { cookies: [], url: 'https://a.b/' })
      const saved = await readReaderProfile(path)
      expect(saved?.url).toBe('https://a.b/')
      expect(saved?.device).toBeUndefined()
    } finally { await rm(path, { recursive: true, force: true }) }
  })
})
