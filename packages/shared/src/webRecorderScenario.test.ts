import { describe, expect, it } from 'vitest'
import { appendWebRecorderStep, normalizeWebRecorderStep, parseWebRecorderScenario } from './webRecorderScenario'
const step = { kind: 'type' as const, selector: '#name', text: 'Аня', sensitive: false }
describe('сохранённый сценарий Reader', () => {
  it('пропускает повреждённые элементы, сохраняя валидные', () => expect(parseWebRecorderScenario(JSON.stringify([null, 4, [], {}, step]))).toEqual([step]))
  it('отклоняет неверные флаги и поля', () => { for (const value of [{ ...step, sensitive: 'false' }, { ...step, submit: 'yes' }, { ...step, text: null }, { ...step, selector: ' ' }]) expect(normalizeWebRecorderStep(value)).toBeNull() })
  it('ограничивает размер полей', () => { expect(normalizeWebRecorderStep({ ...step, text: 'x'.repeat(2001) })).toBeNull(); expect(normalizeWebRecorderStep({ ...step, selector: 'x'.repeat(2001) })).toBeNull() })
  it('ограничивает список и размер JSON', () => { expect(parseWebRecorderScenario(JSON.stringify(Array(300).fill(step)))).toHaveLength(200); expect(parseWebRecorderScenario(' '.repeat(1_000_001))).toEqual([]) })
  it('удаляет секрет из импортированного старого шага', () => expect(parseWebRecorderScenario(JSON.stringify([{ ...step, sensitive: true, text: 'old-secret' }]))).toEqual([{ ...step, sensitive: true, text: '' }]))
  it('склеивает ввод в одном поле', () => expect(appendWebRecorderStep([step], { ...step, text: 'Анна' })).toEqual([{ ...step, text: 'Анна' }]))
  it('не склеивает разные поля или шаги после submit', () => { expect(appendWebRecorderStep([step], { ...step, selector: '#other' })).toHaveLength(2); expect(appendWebRecorderStep([{ ...step, submit: true }], step)).toHaveLength(2) })
  it('сохраняет финальный submit при склейке', () => expect(appendWebRecorderStep([step], { ...step, submit: true })).toEqual([{ ...step, submit: true }]))
  it('не добавляет шаг сверх лимита, но обновляет последнее поле', () => { expect(appendWebRecorderStep(Array(200).fill(step), { ...step, selector: '#other' })).toHaveLength(200); expect(appendWebRecorderStep(Array(200).fill(step), { ...step, text: 'final' }).at(-1)?.text).toBe('final') })
  it('не принимает click с submit и неверный JSON', () => { expect(normalizeWebRecorderStep({ ...step, kind: 'click', submit: true })).toBeNull(); for (const json of ['null','{}','[']) expect(parseWebRecorderScenario(json)).toEqual([]) })
})
