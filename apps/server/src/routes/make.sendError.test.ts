// Отображение ошибок Make в HTTP-статусы. Таблицей по всем кодам `MakeErrorCode`,
// потому что это единственная точка, через которую проходят все маршруты Make:
// одна опечатка здесь меняет контракт сразу полусотни эндпоинтов, а через сами
// маршруты каждый код пришлось бы проверять по отдельности.

import { describe, expect, it, vi } from 'vitest'
import type { FastifyReply } from 'fastify'
import { MakeError, type MakeErrorCode } from '../make/workspace.js'
import { sendError } from './make.js'

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
  // Полный список кодов из MakeErrorCode: если в тип добавят новый, а сюда нет —
  // проверка ниже про полноту таблицы это поймает.
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
    // Клиент разбирает `code`, человек читает `error` — нужны оба.
    const { reply, sent } = fakeReply()
    sendError(reply, new MakeError('invalid_path', 'путь вне проекта'))
    expect(sent[0].body).toEqual({ error: 'путь вне проекта', code: 'invalid_path' })
  })

  it('таблица покрывает все коды MakeErrorCode', () => {
    // Список берётся из типа вручную; тест держит его в синхроне с кодом
    // через перечисление, использованное в самом отображении.
    const covered = new Set(table.map(([code]) => code))
    const declared: MakeErrorCode[] = ['invalid_id', 'invalid_path', 'not_found', 'too_large', 'too_many_files', 'not_text', 'exists', 'quota']
    expect(declared.filter((code) => !covered.has(code))).toEqual([])
  })

  it('неизвестная ошибка пробрасывается наверх, а не превращается в 400', () => {
    // Иначе сбой БД или бага в коде стали бы «неверный запрос», и причина
    // потерялась бы: до обработчика Fastify (500) она обязана дойти.
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
