// Ключ изолированного Chromium к прокси превью. Проверяется отдельно от хука:
// ключ даёт доступ к машинам пользователя, поэтому важно, что он не работает
// ни на одном другом маршруте API.
import { describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { previewRunUser } from './auth.js'
import { PREVIEW_RUN_COOKIE, PreviewRunKeys } from '../browser/machinePreview.js'
import type { VoiceChatDb } from '../db/database.js'

const req = (cookie: string): FastifyRequest => ({ headers: { cookie } }) as unknown as FastifyRequest

const dbWith = (user: { name: string; role: string; blocked?: boolean } | null): VoiceChatDb =>
  ({ getUser: () => user }) as unknown as VoiceChatDb

describe('пользователь ключа Chromium', () => {
  it('авторизует владельца ключа на пути прокси', () => {
    const keys = new PreviewRunKeys()
    const key = keys.issue('alice')
    expect(previewRunUser(dbWith({ name: 'alice', role: 'developer' }), req(`${PREVIEW_RUN_COOKIE}=${key}`), '/api/preview', keys))
      .toEqual({ name: 'alice', role: 'developer' })
  })

  it('на других маршрутах ключ бесполезен', () => {
    const keys = new PreviewRunKeys()
    const key = keys.issue('alice')
    const db = dbWith({ name: 'alice', role: 'developer' })
    for (const url of ['/api/conversations', '/api/preview/reset-cookies', '/api/projects']) {
      expect(previewRunUser(db, req(`${PREVIEW_RUN_COOKIE}=${key}`), url, keys)).toBeNull()
    }
  })

  it('без cookie, с чужим ключом и для заблокированного пользователя доступа нет', () => {
    const keys = new PreviewRunKeys()
    const key = keys.issue('alice')
    expect(previewRunUser(dbWith({ name: 'alice', role: 'developer' }), req('другое=1'), '/api/preview', keys)).toBeNull()
    expect(previewRunUser(dbWith({ name: 'alice', role: 'developer' }), req(`${PREVIEW_RUN_COOKIE}=подделка`), '/api/preview', keys)).toBeNull()
    expect(previewRunUser(dbWith({ name: 'alice', role: 'developer', blocked: true }), req(`${PREVIEW_RUN_COOKIE}=${key}`), '/api/preview', keys)).toBeNull()
    expect(previewRunUser(dbWith(null), req(`${PREVIEW_RUN_COOKIE}=${key}`), '/api/preview', keys)).toBeNull()
  })
})
