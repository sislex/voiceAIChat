import { describe, expect, it } from 'vitest'
import { tokenMatches } from './auth.js'

describe('tokenMatches', () => {
  it('верный токен', () => {
    expect(tokenMatches('токен', 'токен')).toBe(true)
  })

  it('чужой, пустой и незаданный токен', () => {
    expect(tokenMatches('токен', 'другой')).toBe(false)
    expect(tokenMatches('токен', undefined)).toBe(false)
    expect(tokenMatches('токен', '')).toBe(false)
    // Незаданный токен исполнителя не должен открывать API «пустым» Bearer.
    expect(tokenMatches('', '')).toBe(false)
  })

  it('разная длина не роняет постоянное сравнение', () => {
    expect(tokenMatches('короткий', 'сильно-длиннее')).toBe(false)
  })
})
