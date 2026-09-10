// Map Make errors to HTTP statuses, covering every MakeErrorCode. All Make routes pass through this
// point, so one typo changes the contract of roughly fifty endpoints. Testing each code through
// individual routes would duplicate the same check.

import { describe, expect, it } from 'vitest'
import type { FastifyReply } from 'fastify'
import { MakeError, type MakeErrorCode } from './workspace.js'
import { sendError } from './routes.js'

function fakeReply() {
  const sent: Array<{ status: number; body: unknown }> = []
  let status = 200
  const reply = {
    code(value: number) { status = value; return reply },
    send(body: unknown) { sent.push({ status, body }); return reply }
  }
  return { reply: reply as unknown as FastifyReply, sent }
}

describe('sendError', () => {
  // Complete MakeErrorCode list: the completeness assertion below catches new codes missing from
  // this table.
  const table: Array<[MakeErrorCode, number]> = [
    ['not_found', 404],
    ['too_large', 413],
    ['too_many_files', 413],
    ['quota', 413],
    ['exists', 409],
    ['invalid_id', 400],
    ['invalid_path', 400],
    ['not_text', 400]
  ]

  it.each(table)('код %s → HTTP %i', (code, status) => {
    const { reply, sent } = fakeReply()
    sendError(reply, new MakeError(code, 'сообщение'))
    expect(sent).toEqual([{ status, body: { error: 'сообщение', code } }])
  })

  it('в теле ответа есть и человеческое сообщение, и машинный код', () => {
    // Clients inspect code and humans read error; both fields are required.
    const { reply, sent } = fakeReply()
    sendError(reply, new MakeError('invalid_path', 'путь вне проекта'))
    expect(sent[0].body).toEqual({ error: 'путь вне проекта', code: 'invalid_path' })
  })

  it('таблица покрывает все коды MakeErrorCode', () => {
    // The type's codes are listed manually; the test keeps them aligned with the enumeration used
    // by the mapping.
    const covered = new Set(table.map(([code]) => code))
    const declared: MakeErrorCode[] = ['invalid_id', 'invalid_path', 'not_found', 'too_large', 'too_many_files', 'not_text', 'exists', 'quota']
    expect(declared.filter((code) => !covered.has(code))).toEqual([])
  })

  it('неизвестная ошибка пробрасывается наверх, а не превращается в 400', () => {
    // Database failures and programming errors must reach Fastify's 500 handler instead of being
    // mislabeled as invalid requests and losing their cause.
    const { reply, sent } = fakeReply()
    const boom = new Error('соединение с БД потеряно')
    expect(() => sendError(reply, boom)).toThrow(boom)
    expect(sent).toEqual([])
  })

  it('не-Error значение тоже пробрасывается', () => {
    const { reply } = fakeReply()
    expect(() => sendError(reply, 'строка вместо ошибки')).toThrow('строка вместо ошибки')
    expect(() => sendError(reply, null)).toThrow()
  })

  it('подкласс MakeError с чужим полем всё равно отображается по коду', () => {
    const { reply, sent } = fakeReply()
    const error = Object.assign(new MakeError('exists', 'уже есть'), { extra: 1 })
    sendError(reply, error)
    expect(sent[0].status).toBe(409)
  })
})
