import { describe, expect, it } from 'vitest'
import { canReadPreviewCache, canStorePreviewCache } from './previewCachePolicy.js'

describe('Кэш Reader не фиксирует сессию или персональные ответы', () => {
  it('разрешает GET обычной статики', () => expect(canReadPreviewCache('GET', {}, false)).toBe(true))
  it('не кэширует запросы с авторизацией сайта', () => expect(canReadPreviewCache('GET', { 'X-Preview-Authorization': 'Bearer fixture' }, false)).toBe(false))
  it('не использует общий ресурс после выдачи cookie сайтом', () => expect(canReadPreviewCache('GET', {}, true)).toBe(false))
  it.each(['no-cache', 'no-store', 'max-age=0', 'public, max-age = 0'])('уважает запрос повторной загрузки %s', value => {
    expect(canReadPreviewCache('GET', { 'cache-control': value }, false)).toBe(false)
  })
  it('учитывает старый Pragma: no-cache', () => expect(canReadPreviewCache('GET', { pragma: 'no-cache' }, false)).toBe(false))
  it('не выдаёт полное тело вместо Range', () => expect(canReadPreviewCache('GET', { range: 'bytes=0-10' }, false)).toBe(false))
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])('не читает кэш при %s', method => expect(canReadPreviewCache(method, {}, false)).toBe(false))
  it.each(['private', 'no-store', 'no-cache', 'max-age=0'])('не хранит запрещённый апстримом ответ %s', value => expect(canStorePreviewCache({ 'Cache-Control': value })).toBe(false))
  it('не теряет Set-Cookie на закэшированном ответе', () => expect(canStorePreviewCache({ 'Set-Cookie': ['session=fixture'] })).toBe(false))
  it('не смешивает представления Vary', () => expect(canStorePreviewCache({ vary: 'Accept-Language' })).toBe(false))
  it('разрешает неперсонализированную статику с публичным TTL', () => expect(canStorePreviewCache({ 'cache-control': 'public, max-age=3600' })).toBe(true))
})
