import { describe, expect, it, vi } from 'vitest'
import { runScenarioStep, scenarioProblems, type ScenarioSend } from './scenarioStep'
import type { AutomatedQaScenarioStep } from './qa'

const step: AutomatedQaScenarioStep = { id: 'one', title: 'Сохранить', action: { kind: 'click', selector: '#save' } }
const once = { expectTimeoutMs: 0 }
const reading = (response: unknown): ScenarioSend => async command => command.type === 'selector' && command.action.kind === 'read' ? response : { ok: true }
function paginated(value: string, frame?: string) {
  const send = vi.fn<ScenarioSend>(async command => {
    if (command.type !== 'selector' || command.action.kind !== 'read') return { ok: true }
    if (frame) expect(command.frame).toBe(frame)
    const offset = command.action.offset ?? 0, end = Math.min(offset + 20_000, value.length)
    return { ok: true, text: value.slice(offset, end) + (end < value.length ? '…' : ''), offset, total: value.length,
      ...(end < value.length ? { truncated: true, nextOffset: end } : {}), page: { url: 'https://project.test/' } }
  })
  return send
}

describe('подтверждённое исполнение сценария', () => {
  it.each([undefined, null, {}, { ok: 'true' }])('не объявляет успех без подтверждения действия: %j', async response => {
    expect(await runScenarioStep(step, async () => response)).toMatchObject({ ok: false, failure: 'action' })
  })
  it('принимает метаданные готовой сессии, но не остановленную сессию', async () => {
    expect(await runScenarioStep(step, async () => ({ incarnation: 'i', state: 'ready' }))).toMatchObject({ ok: true })
    expect(await runScenarioStep(step, async () => ({ incarnation: 'i', state: 'failed', error: { message: 'Chromium закрыт' } }))).toMatchObject({ ok: false, detail: 'Chromium закрыт' })
  })
  it.each([{ ok: false, error: 'Нет документа' }, { ok: true }, undefined])('ошибка чтения не подтверждает отсутствие: %j', async response => {
    expect(await runScenarioStep({ ...step, expectAbsentText: 'Ошибка' }, reading(response), once)).toMatchObject({ ok: false, failure: 'expectation', unverifiable: true })
  })
  it('находит положительное ожидание после первой порции и на границе порций', async () => {
    for (const start of [19_997, 40_001]) {
      expect(await runScenarioStep({ ...step, expectText: 'Новая задача создана' }, paginated('x'.repeat(start) + 'Новая задача создана'), once)).toMatchObject({ ok: true })
    }
  })
  it('запрещённый текст в продолжении проваливает проверку отсутствия', async () => {
    expect(await runScenarioStep({ ...step, expectAbsentText: 'Ошибка' }, paginated('x'.repeat(25_000) + 'Ошибка'), once)).toMatchObject({ ok: false, detail: expect.stringContaining('недопустимый текст') })
  })
  it('доказывает отсутствие только после полного чтения, сохраняя frame', async () => {
    const send = paginated('x'.repeat(40_001), '#preview')
    expect(await runScenarioStep({ ...step, action: { ...step.action, frame: '#preview' }, expectAbsentText: 'Ошибка' }, send, once)).toMatchObject({ ok: true })
    expect(send).toHaveBeenCalledTimes(4)
  })
  it('старый раннер без cursor оставляет отсутствие непроверенным', async () => {
    expect(await runScenarioStep({ ...step, expectAbsentText: 'Ошибка' }, reading({ ok: true, text: 'Начало…', truncated: true }), once)).toMatchObject({ ok: false, unverifiable: true })
  })
  it('предел большого документа не превращается в отсутствие текста', async () => {
    const send = paginated('x'.repeat(200_010) + 'Ошибка')
    expect(await runScenarioStep({ ...step, expectAbsentText: 'Ошибка' }, send, once)).toMatchObject({ ok: false, unverifiable: true, detail: expect.stringContaining('200000') })
    expect(send).toHaveBeenCalledTimes(11)
  })
  it('одновременные ожидания требуют дочитать запрещённый текст даже после найденного положительного', async () => {
    expect(await runScenarioStep({ ...step, expectText: 'Готово', expectAbsentText: 'Ошибка' }, paginated('Готово' + 'x'.repeat(30_000) + 'Ошибка'), once)).toMatchObject({ ok: false })
  })
  it('не склеивает разные страницы в положительное доказательство', async () => {
    const send = paginated('x'.repeat(20_000) + 'Готово')
    const altered: ScenarioSend = async command => {
      const result = await send(command) as Record<string, unknown>
      if (command.type === 'selector' && command.action.kind === 'read' && command.action.offset) result.page = { url: 'https://other.test/' }
      return result
    }
    expect(await runScenarioStep({ ...step, expectText: 'Готово' }, altered, once)).toMatchObject({ ok: false, unverifiable: true, detail: expect.stringContaining('изменилась') })
  })
  it('не зацикливается на повторяющемся cursor', async () => {
    expect(await runScenarioStep({ ...step, expectAbsentText: 'Ошибка' }, reading({ ok: true, text: '', truncated: true, nextOffset: 0 }), once)).toMatchObject({ ok: false, unverifiable: true })
  })
  it('ожидание не спит за пределом и не начинает ещё одно чтение после него', async () => {
    let clock = 0
    const send = vi.fn(reading({ ok: true, text: 'Загрузка' }))
    expect(await runScenarioStep({ ...step, expectText: 'Готово' }, send, { expectTimeoutMs: 100, pollMs: 250, now: () => clock, sleep: async ms => { clock += ms } })).toMatchObject({ ok: false })
    expect(clock).toBe(100)
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('неисполняемый payload обнаруживается до отправки в браузер и до сохранения', async () => {
    const invalid = { ...step, action: { kind: 'click' as const }, expectText: 'Готово' }
    const send = vi.fn<ScenarioSend>()
    expect(await runScenarioStep(invalid, send)).toMatchObject({ ok: false, unsupported: true, unverifiable: true })
    expect(send).not.toHaveBeenCalled()
    expect(scenarioProblems({ startUrl: 'https://project.test', steps: [invalid] })).toEqual([expect.stringContaining('некорректное действие')])
  })
})
