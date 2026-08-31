// Cookie сессии, CSRF и устройства.
//
// Эти строки описывают инцидент 31.08.2026, а тестов на них не было. Один и тот
// же прод виден и как `https://<ip>` через Caddy, и как `http://<ip>:8787`
// напрямую; браузер различает cookie по хосту, а не по схеме, и `Secure`-cookie
// с обычным именем по правилу «Leave Secure Cookies Alone» затеняла http-версию
// навсегда. Снаружи это выглядело как «сессия не работает»: любая перезагрузка
// возвращала экран входа. Лечится разведением имён по схеме — и это ровно то,
// что здесь закреплено, чтобы не вернулось.

import { describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import {
  CSRF_COOKIE,
  DEVICE_COOKIE,
  SESSION_COOKIE,
  clearLegacySessionCookies,
  clearSessionCookies,
  deviceCookie,
  sessionCookies,
  uid
} from './auth.js'

const req = (options: { https?: boolean; forwarded?: string; cookie?: string } = {}): FastifyRequest => ({
  headers: {
    ...(options.forwarded === undefined ? {} : { 'x-forwarded-proto': options.forwarded }),
    ...(options.cookie === undefined ? {} : { cookie: options.cookie })
  },
  protocol: options.https ? 'https' : 'http'
}) as unknown as FastifyRequest

/** Разбор строки Set-Cookie в имя, значение и множество атрибутов. */
function parse(header: string) {
  const [pair, ...attrs] = header.split(';').map((part) => part.trim())
  const [name, ...value] = pair.split('=')
  const map = new Map<string, string>()
  for (const attr of attrs) { const [k, ...v] = attr.split('='); map.set(k.toLowerCase(), v.join('=')) }
  return { name, value: value.join('='), attrs: map, has: (a: string) => map.has(a.toLowerCase()) }
}

describe('sessionCookies', () => {
  it('по http имена обычные и без флага Secure', () => {
    const [session, csrf] = sessionCookies(req(), 'tok', 'csrf', 3600).map(parse)
    expect(session.name).toBe(SESSION_COOKIE)
    expect(csrf.name).toBe(CSRF_COOKIE)
    expect(session.has('secure')).toBe(false)
    expect(csrf.has('secure')).toBe(false)
  })

  it('по https имена получают префикс __Secure- и флаг Secure', () => {
    // Суть лечения инцидента: имена двух схем гарантированно разные, поэтому
    // затенять друг друга они не могут.
    const [session, csrf] = sessionCookies(req({ https: true }), 'tok', 'csrf', 3600).map(parse)
    expect(session.name).toBe('__Secure-' + SESSION_COOKIE)
    expect(csrf.name).toBe('__Secure-' + CSRF_COOKIE)
    expect(session.has('secure')).toBe(true)
    expect(csrf.has('secure')).toBe(true)
  })

  it('схему определяет x-forwarded-proto — прод стоит за Caddy', () => {
    const [session] = sessionCookies(req({ forwarded: 'https' }), 'tok', 'csrf', 60).map(parse)
    expect(session.name).toBe('__Secure-' + SESSION_COOKIE)
    // И наоборот: заголовок перекрывает протокол соединения.
    const [plain] = sessionCookies(req({ https: true, forwarded: 'http' }), 'tok', 'csrf', 60).map(parse)
    expect(plain.name).toBe(SESSION_COOKIE)
  })

  it('сессионная cookie HttpOnly, а CSRF — нет: её читает клиент', () => {
    const [session, csrf] = sessionCookies(req(), 'tok', 'csrf', 60).map(parse)
    expect(session.has('httponly')).toBe(true)
    expect(csrf.has('httponly')).toBe(false)
  })

  it('обе cookie SameSite=Strict и на корневом пути', () => {
    for (const cookie of sessionCookies(req(), 'tok', 'csrf', 60).map(parse)) {
      expect(cookie.attrs.get('samesite')).toBe('Strict')
      expect(cookie.attrs.get('path')).toBe('/')
    }
  })

  it('значения токена и CSRF попадают в свои cookie', () => {
    const [session, csrf] = sessionCookies(req(), 'токен-сессии', 'токен-csrf', 60).map(parse)
    expect(session.value).toBe('токен-сессии')
    expect(csrf.value).toBe('токен-csrf')
  })

  it('maxAgeSec null даёт сессионную cookie без Max-Age', () => {
    // «Запомнить меня» выключено: cookie живёт до закрытия браузера.
    for (const cookie of sessionCookies(req(), 'tok', 'csrf', null).map(parse)) {
      expect(cookie.has('max-age')).toBe(false)
    }
  })

  it('maxAgeSec число попадает в Max-Age обеих cookie', () => {
    for (const cookie of sessionCookies(req(), 'tok', 'csrf', 2_592_000).map(parse)) {
      expect(cookie.attrs.get('max-age')).toBe('2592000')
    }
  })
})

describe('clearLegacySessionCookies', () => {
  it('по http не делает ничего — незащищённый origin чужую Secure-cookie не удалит', () => {
    expect(clearLegacySessionCookies(req())).toEqual([])
  })

  it('по https гасит старую пару с ОБЫЧНЫМИ именами', () => {
    // Разовое лечение: у вошедших до разведения имён лежит Secure-cookie с
    // обычным именем, и удалить её может только защищённый origin.
    const cleared = clearLegacySessionCookies(req({ https: true })).map(parse)
    expect(cleared.map((c) => c.name)).toEqual([SESSION_COOKIE, CSRF_COOKIE])
    for (const cookie of cleared) expect(cookie.attrs.get('max-age')).toBe('0')
  })
})

describe('clearSessionCookies', () => {
  it('по http гасит обычную пару', () => {
    const cleared = clearSessionCookies(req()).map(parse)
    expect(cleared.map((c) => c.name)).toEqual([SESSION_COOKIE, CSRF_COOKIE])
    for (const cookie of cleared) expect(cookie.attrs.get('max-age')).toBe('0')
  })

  it('по https гасит и защищённую пару, и старую обычную — выход обязан завершать сессию целиком', () => {
    const cleared = clearSessionCookies(req({ https: true })).map(parse)
    expect(cleared.map((c) => c.name)).toEqual([
      '__Secure-' + SESSION_COOKIE, '__Secure-' + CSRF_COOKIE, SESSION_COOKIE, CSRF_COOKIE
    ])
    for (const cookie of cleared) expect(cookie.attrs.get('max-age')).toBe('0')
  })

  it('гашение сохраняет HttpOnly у сессионной cookie', () => {
    // Иначе браузер сочтёт это другой cookie и старую не удалит.
    const [session, csrf] = clearSessionCookies(req()).map(parse)
    expect(session.has('httponly')).toBe(true)
    expect(csrf.has('httponly')).toBe(false)
  })
})

describe('deviceCookie', () => {
  it('SameSite=Lax, чтобы переживать переходы по ссылкам из писем', () => {
    // Strict убил бы доверие устройства при заходе по ссылке из письма.
    const cookie = parse(deviceCookie(req(), 'секрет'))
    expect(cookie.attrs.get('samesite')).toBe('Lax')
    expect(cookie.has('httponly')).toBe(true)
  })

  it('живёт дольше сессии — доверие переживает выход и перелогин', () => {
    const cookie = parse(deviceCookie(req(), 'секрет'))
    expect(Number(cookie.attrs.get('max-age'))).toBe(400 * 24 * 60 * 60)
  })

  it('по https получает префикс и Secure, по http — нет', () => {
    expect(parse(deviceCookie(req({ https: true }), 's')).name).toBe('__Secure-' + DEVICE_COOKIE)
    expect(parse(deviceCookie(req({ https: true }), 's')).has('secure')).toBe(true)
    expect(parse(deviceCookie(req(), 's')).name).toBe(DEVICE_COOKIE)
    expect(parse(deviceCookie(req(), 's')).has('secure')).toBe(false)
  })

  it('секрет попадает в значение как есть', () => {
    expect(parse(deviceCookie(req(), 'abc-123')).value).toBe('abc-123')
  })
})

describe('uid', () => {
  it('возвращает имя пользователя сессии', () => {
    const request = { user: { name: 'alice', role: 'developer' } } as unknown as FastifyRequest
    expect(uid(request)).toBe('alice')
  })

  it('без пользователя бросает, а не отдаёт пустую строку', () => {
    // Пустой id молча увёл бы запись в чужие/ничьи данные.
    expect(() => uid({ user: null } as unknown as FastifyRequest)).toThrow(/нет аутентифицированного пользователя/)
  })
})
