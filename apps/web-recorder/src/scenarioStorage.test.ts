import { describe, expect, it } from 'vitest'
import { loadScenario, scenarioKey } from './scenarioStorage'
const step = { kind: 'click', selector: '#go', text: '', sensitive: false }
describe('адрес сценария', () => {
  it('разделяет hash-страницы и query', () => { expect(new Set(['https://app.test/#/projects','https://app.test/#/machines','https://app.test/?tab=a','https://app.test/?tab=b'].map(scenarioKey)).size).toBe(4) })
  it('переносит старый однозначный сценарий', () => expect(loadScenario('https://app.test/page', { getItem: key => key.includes('.v1:') ? JSON.stringify([step]) : null })).toEqual([step]))
  it('не переносит общий сценарий в неизвестную hash-страницу', () => expect(loadScenario('https://app.test/#/settings', { getItem: key => key.includes('.v1:') ? JSON.stringify([step]) : null })).toEqual([]))
  it('пустой новый сценарий не воскресает из legacy', () => expect(loadScenario('https://app.test/', { getItem: key => key.includes('.v2:') ? '[]' : JSON.stringify([step]) })).toEqual([]))
  it('отказ storage и неверный URL не ломают Reader', () => { expect(loadScenario('https://app.test/', { getItem() { throw Error('denied') } })).toEqual([]); expect(scenarioKey('javascript:alert(1)')).toBeNull() })
})

it('перенос удаляет старую запись с незамаскированным секретом', () => { const data = new Map([['voicechat.reader.scenario.v1:https://app.test/', JSON.stringify([{ ...step, kind: 'type', sensitive: true, text: 'old-secret' }])]]); loadScenario('https://app.test/', { getItem: key => data.get(key) ?? null, setItem: (key,value) => { data.set(key,value) }, removeItem: key => { data.delete(key) } }); expect([...data.keys()]).toEqual(['voicechat.reader.scenario.v2:https://app.test/']); expect([...data.values()].join('')).not.toContain('old-secret') })
