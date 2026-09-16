// Круг 7: почему действие не сработало. Playwright говорит «Timeout 5000ms
// exceeded», и модель повторяла тот же клик; у каждой из этих бед свой
// следующий шаг, и именно он отсутствовал в сообщении.

import { describe, expect, it } from 'vitest'
import { classifyActionError } from './actionErrors'

describe('разбор отказа действия', () => {
  it('исчезнувший элемент просит найти его заново, а не повторить клик', () => {
    const failure = classifyActionError('stale_element_ref: Найдите элемент заново через find')
    expect(failure.kind).toBe('detached')
    expect(failure.advice).toContain('заново')
  })

  it('неоднозначный селектор просит уточнения, а не первого попавшегося узла', () => {
    expect(classifyActionError('Error: strict mode violation: locator resolved to 3 elements').kind).toBe('ambiguous')
    expect(classifyActionError('Найдено несколько доступных элементов (4). Уточните селектор через find.').kind).toBe('ambiguous')
  })

  it('перехват клика объясняется перекрытием и отправляет в measure', () => {
    const failure = classifyActionError('<div class="overlay">…</div> intercepts pointer events')
    expect(failure.kind).toBe('covered')
    expect(failure.advice).toContain('measure')
  })

  it('выключенный элемент отличается от отсутствующего', () => {
    expect(classifyActionError('element is not enabled').kind).toBe('disabled')
    expect(classifyActionError('Доступный элемент не найден').kind).toBe('not-found')
  })

  it('уход страницы во время действия называется своими словами', () => {
    expect(classifyActionError('Execution context was destroyed, most likely because of a navigation').kind).toBe('navigated')
  })

  it('таймаут ожидания отправляет ждать сеть, а не тыкать снова', () => {
    const failure = classifyActionError('locator.click: Timeout 5000ms exceeded.\nCall log:\n - waiting for locator("#save")')
    expect(failure.kind).toBe('timeout')
    expect(failure.advice).toContain('network')
  })

  it('незнакомая ошибка отдаётся первой строкой, без выдуманного совета', () => {
    const failure = classifyActionError('Protocol error (Runtime.callFunctionOn): Target closed\nstack…')
    expect(failure).toEqual({ kind: 'other', reason: 'Protocol error (Runtime.callFunctionOn): Target closed' })
  })
})
