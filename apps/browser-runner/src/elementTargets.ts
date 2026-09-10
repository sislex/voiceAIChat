import { DOM_HELPERS } from './domHelpers.js'

interface TargetPage {
  locator(selector: string): { evaluateAll(script: (nodes: unknown[], arg: unknown) => unknown, arg?: unknown): Promise<unknown> }
}
const identities = new Function('nodes', `${DOM_HELPERS}; return nodes.map(identityOf);`) as (nodes: unknown[], arg: unknown) => string[]
class StaleTargetError extends Error {}

/** DOM считает уникальность внутри своего root, а CSS Playwright проходит ещё
 * shadow roots. Уточняем совпадение самим движком, чтобы повторный клик попадал
 * именно в найденный узел. Служебный путь наружу не передаётся. */
export async function resolveElementTargets<T>(page: TargetPage, result: T): Promise<T> {
  const cache = new Map<string, Promise<string[]>>()
  const visit = async (value: unknown): Promise<void> => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { await Promise.all(value.map(visit)); return }
    const record = value as Record<string, unknown>
    if (typeof record.selector === 'string' && typeof record.__targetPath === 'string') {
      const selector = record.selector, path = record.__targetPath
      delete record.__targetPath
      let pending = cache.get(selector)
      if (!pending) { pending = page.locator(selector).evaluateAll(identities) as Promise<string[]>; cache.set(selector, pending) }
      const matches = await pending, index = matches.indexOf(path)
      // Единственный семантический селектор остаётся пригодным после вставки
      // соседнего узла: позиционный identity нужен лишь для неоднозначности.
      if (matches.length !== 1 && index < 0) throw new StaleTargetError('Элемент изменился во время чтения; повтори read/find/describe')
      if (matches.length > 1) { record.selector = `${selector} >> nth=${index}`; if ('stability' in record) record.stability = 'path' }
      if ('matches' in record) record.matches = 1
    }
    await Promise.all(Object.values(record).map(visit))
  }
  await visit(result)
  return result
}

/** SPA может заменить контрол между снимком DOM и уточнением локатора.
 * Перечитываем весь результат один раз, чтобы не склеивать две версии страницы. */
export async function readElementTargets<T>(page: TargetPage, read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await resolveElementTargets(page, await read()) }
    catch (error) { if (!(error instanceof StaleTargetError) || attempt > 0) throw error }
  }
}
