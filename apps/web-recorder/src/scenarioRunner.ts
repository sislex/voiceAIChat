import { normalizeWebRecorderStep, WEB_RECORDER_SCENARIO_LIMITS } from '@shared/webRecorderScenario'
import { isPreviewDomAction, type PreviewDomAction } from '@shared/previewActions'
import type { WebRecorderScenarioStep } from '@shared/webRecorder'

export interface ScenarioProgress {
  status: 'running' | 'passed' | 'failed' | 'cancelled'
  completed: number
  total: number
  error?: string
}
interface Outcome { ok: boolean; error?: string }
interface Options {
  send: (requestId: string, action: PreviewDomAction) => void
  newId: () => string
  onProgress: (progress: ScenarioProgress) => void
  timeoutMs?: number
  settleMs?: number
}

/** Один запуск владеет своими ответами и ожиданиями; отмена освобождает все таймеры. */
export function createScenarioRunner(options: Options) {
  let active: AbortController | null = null
  let ready = false
  let closed = false
  const pending = new Map<string, (outcome: Outcome) => void>()
  const readyListeners = new Set<() => void>()
  let sequence = 0
  const timeout = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0 ? Math.min(options.timeoutMs!, 120_000) : 12_000
  const settle = Math.min(timeout / 2, Number.isFinite(options.settleMs) && options.settleMs! >= 0 ? options.settleMs! : 50)
  const report = (progress: ScenarioProgress): void => {
    // An observer cannot strand an active run or prevent cancellation cleanup.
    try { options.onProgress(progress) } catch { /* Playback owns its lifecycle. */ }
  }
  const wait = <T>(signal: AbortSignal, register: (resolve: (value: T) => void) => () => void, error: string): Promise<T> => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error(String(signal.reason))); return }
    let cleanup = () => {}
    const finish = (value?: T, failure?: Error) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort); cleanup()
      if (failure) reject(failure); else resolve(value as T)
    }
    const abort = () => finish(undefined, new Error(String(signal.reason)))
    const timer = setTimeout(() => finish(undefined, new Error(error)), timeout)
    signal.addEventListener('abort', abort, { once: true })
    cleanup = register(value => finish(value))
  })
  const waitReady = async (signal: AbortSignal): Promise<void> => {
    if (ready) return
    await wait<void>(signal, resolve => { const listener = () => resolve(); readyListeners.add(listener); return () => readyListeners.delete(listener) }, 'Страница не загрузилась за время ожидания.')
  }
  const cancel = (reason = 'Запуск остановлен пользователем.'): void => { active?.abort(reason) }
  return {
    isRunning: () => active !== null,
    setReady(value: boolean) { ready = value; if (value) for (const listener of [...readyListeners]) listener() },
    receive(requestId: string, outcome: Outcome): boolean { if (!outcome || typeof outcome.ok !== 'boolean' || (outcome.error !== undefined && typeof outcome.error !== 'string')) return false; const resolve = pending.get(requestId); if (!resolve) return false; resolve(outcome); return true },
    cancel,
    dispose() { closed = true; cancel('Reader закрыт — запуск отменён.') },
    async run(steps: readonly WebRecorderScenarioStep[], secrets: Readonly<Record<number, string>>): Promise<Outcome> {
      if (closed) return { ok: false, error: 'Reader закрыт.' }
      if (active) return { ok: false, error: 'Сценарий уже выполняется.' }
      // Проверяем весь снимок до первого действия: поздний пустой пароль не должен
      // оставлять форму или заказ наполовину выполненными.
      const actions: PreviewDomAction[] = []
      let validation: string | undefined
      const total = Array.isArray(steps) ? steps.length : 0
      if (!Array.isArray(steps) || !steps.length || steps.length > WEB_RECORDER_SCENARIO_LIMITS.steps) validation = 'Сценарий должен содержать от 1 до 200 шагов.'
      for (const [index, value] of (validation ? [] : steps).entries()) {
        const step = normalizeWebRecorderStep(value)
        if (!step) { validation = `Шаг ${index + 1}: проверьте действие, селектор и значение.`; break }
        const text = step.sensitive ? secrets?.[index] ?? '' : step.text
        if (typeof text !== 'string') { validation = `Шаг ${index + 1}: значение должно быть строкой.`; break }
        if (step.kind === 'type' && step.sensitive && !text) { validation = `Шаг ${index + 1}: введите секретное значение перед запуском (оно не сохраняется).`; break }
        const action = step.kind === 'click' ? { kind: 'click', selector: step.selector } : { kind: 'type', selector: step.selector, text, ...(step.submit ? { submit: true } : {}) }
        if (!step.selector.trim() || !isPreviewDomAction(action)) { validation = `Шаг ${index + 1}: проверьте селектор и значение.`; break }
        actions.push(action)
      }
      if (validation) { report({ status: 'failed', completed: 0, total, error: validation }); return { ok: false, error: validation } }
      const controller = active = new AbortController()
      const signal = controller.signal
      let completed = 0
      report({ status: 'running', completed, total: actions.length })
      try {
        for (const action of actions) {
          await waitReady(signal)
          if (signal.aborted) throw new Error(String(signal.reason))
          const id = 'local-' + options.newId() + '-' + ++sequence
          const outcome = await wait<Outcome>(signal, resolve => {
            pending.set(id, resolve)
            // Отправка отложена до установки cleanup, включая синхронный тестовый транспорт.
            queueMicrotask(() => { if (signal.aborted || !pending.has(id)) return; try { options.send(id, action) } catch { resolve({ ok: false, error: 'Не удалось передать шаг странице.' }) } })
            return () => { pending.delete(id) }
          }, `Шаг ${completed + 1}: страница не ответила за время ожидания.`)
          if (!outcome.ok) throw new Error(`Шаг ${completed + 1}: ${outcome.error ?? 'действие не выполнено.'}`)
          // Даём сообщению page-loading от клика/submit дойти до shell, затем
          // ждём новый ready; фиксированная пауза не заменяет готовность страницы.
          await wait<void>(signal, resolve => { const timer = setTimeout(resolve, settle); return () => clearTimeout(timer) }, 'Не удалось завершить шаг.')
          await waitReady(signal)
          completed++
          report({ status: 'running', completed, total: actions.length })
        }
        report({ status: 'passed', completed, total: actions.length })
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось выполнить сценарий.'
        report({ status: signal.aborted ? 'cancelled' : 'failed', completed, total: actions.length, error: message })
        return { ok: false, error: message }
      } finally { if (active === controller) active = null }
    }
  }
}
