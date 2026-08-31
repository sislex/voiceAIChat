// Токен исполнителя. Ценность теста не в разборе строки, а в двух свойствах,
// которые легко потерять правкой: сравнение за постоянное время не должно
// падать на разной длине (`timingSafeEqual` бросает на буферах разного размера),
// и хук обязан закрывать только `/v1/*`, иначе health станет недоступен.

import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { bearerToken, registerRunnerAuth, tokenMatches } from './auth'

const req = (authorization?: unknown): Parameters<typeof bearerToken>[0] =>
  ({ headers: authorization === undefined ? {} : { authorization } }) as Parameters<typeof bearerToken>[0]

describe('bearerToken', () => {
  it('достаёт токен и не зависит от регистра схемы', () => {
    expect(bearerToken(req('Bearer abc'))).toBe('abc')
    expect(bearerToken(req('bearer abc'))).toBe('abc')
    expect(bearerToken(req('BEARER abc'))).toBe('abc')
  })

  it('терпит несколько пробелов после схемы', () => {
    expect(bearerToken(req('Bearer   abc'))).toBe('abc')
  })

  it('без заголовка, с чужой схемой и с массивом значений — undefined', () => {
    expect(bearerToken(req())).toBeUndefined()
    expect(bearerToken(req('Basic abc'))).toBeUndefined()
    expect(bearerToken(req('Bearer'))).toBeUndefined()
    // Заголовок может прийти массивом — тогда это не строка и разбирать нечего.
    expect(bearerToken(req(['Bearer abc']))).toBeUndefined()
  })
})

describe('tokenMatches', () => {
  it('совпадение и несовпадение равной длины', () => {
    expect(tokenMatches('secret', 'secret')).toBe(true)
    expect(tokenMatches('secret', 'secret'.replace('t', 'T'))).toBe(false)
  })

  it('разная длина отвергается до timingSafeEqual, а не бросает', () => {
    // timingSafeEqual на буферах разного размера бросает — отсечка по длине обязательна.
    expect(() => tokenMatches('secret', 'sec')).not.toThrow()
    expect(tokenMatches('secret', 'sec')).toBe(false)
    expect(tokenMatches('secret', 'secret-long')).toBe(false)
  })

  it('пустой ожидаемый токен не открывает доступ', () => {
    expect(tokenMatches('', '')).toBe(false)
    expect(tokenMatches('', 'anything')).toBe(false)
    expect(tokenMatches('secret', undefined)).toBe(false)
  })

  it('сравнение работает на не-ASCII (буфер, а не длина строки)', () => {
    expect(tokenMatches('токен', 'токен')).toBe(true)
    expect(tokenMatches('токен', 'токеn')).toBe(false)
  })
})

describe('registerRunnerAuth', () => {
  async function app(token: string) {
    const instance = Fastify()
    registerRunnerAuth(instance, token)
    instance.get('/v1/models', async () => ({ ok: true }))
    instance.get('/health', async () => ({ ok: true }))
    await instance.ready()
    return instance
  }

  it('закрывает /v1/* и оставляет health открытым', async () => {
    const instance = await app('secret')
    try {
      expect((await instance.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
      expect((await instance.inject({ method: 'GET', url: '/v1/models' })).statusCode).toBe(401)
      const ok = await instance.inject({ method: 'GET', url: '/v1/models', headers: { authorization: 'Bearer secret' } })
      expect(ok.statusCode).toBe(200)
    } finally {
      await instance.close()
    }
  })

  it('неверный токен на /v1/* — 401 с телом unauthorized', async () => {
    const instance = await app('secret')
    try {
      const res = await instance.inject({ method: 'GET', url: '/v1/models', headers: { authorization: 'Bearer wrong' } })
      expect(res.statusCode).toBe(401)
      expect(res.json()).toEqual({ error: 'unauthorized' })
    } finally {
      await instance.close()
    }
  })
})
