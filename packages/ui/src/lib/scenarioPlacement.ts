import type { AutomatedQaScenario } from '@shared/qa'

/**
 * Куда положить записанный сценарий: заменить одноимённый или добавить в конец.
 *
 * Сравнение по имени работает, только если имя есть. У двух безымянных оно
 * совпадает, и второй молча заменял первый — записал два теста, остался один.
 * Безымянный поэтому всегда добавляется и получает имя по порядку.
 */
export function placeScenario(
  current: AutomatedQaScenario[],
  scenario: AutomatedQaScenario
): AutomatedQaScenario[] {
  const name = (scenario.name ?? '').trim()
  if (!name) {
    // Имя подбирается свободное, а не по длине набора: «Сценарий 2» мог уже быть
    // занят вручную, и сгенерированное имя создавало ровно тот дубль, ради
    // устранения которого эта функция и появилась.
    const taken = new Set(current.map((item) => (item.name ?? '').trim()))
    let index = current.length + 1
    while (taken.has(`Сценарий ${index}`)) index++
    return [...current, { ...scenario, name: `Сценарий ${index}` }]
  }
  const at = current.findIndex((item) => (item.name ?? '').trim() === name)
  const normalized = { ...scenario, name }
  return at >= 0 ? current.map((item, index) => (index === at ? normalized : item)) : [...current, normalized]
}
