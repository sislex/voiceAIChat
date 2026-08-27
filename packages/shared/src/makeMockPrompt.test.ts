import { describe, expect, it } from 'vitest'
import { makeMockPrompt, mockSlug } from './makeMockPrompt'

describe('makeMockPrompt', () => {
  it('mockSlug транслитерирует и чистит', () => {
    expect(mockSlug('Товары магазина')).toBe('tovary-magazina')
    expect(mockSlug('  ')).toBe('items')
    expect(mockSlug('Users & Roles!')).toBe('users-roles')
  })
  it('собирает путь из первого слова и запрос с форматом коллекции и fetch-адресом', () => {
    const r = makeMockPrompt('товары: название, цена, категория', { count: 8 })
    expect(r.path).toBe('mock/api/tovary.json')
    expect(r.prompt).toContain('{"$collection": true, "$body": [ … ]}')
    expect(r.prompt).toContain('8 правдоподобных записей')
    expect(r.prompt).toContain('fetch("api/tovary")')
    expect(makeMockPrompt('x', { path: 'mock/api/orders.json' }).path).toBe('mock/api/orders.json')
  })
})
