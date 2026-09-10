import {
  normalizeBrowserEvaluateOptions,
  type BrowserEvaluateOptions,
  type BrowserInspectResult
} from '@voicechat/shared'
import type { Page, Frame, CDPSession, JSHandle } from 'playwright'
import { EVALUATION_SERIALIZER } from './evaluationValue.js'

type Outcome = BrowserInspectResult
interface EvaluationHolder {
  run(): Promise<Outcome>
  cancel(): void
}
const active = new WeakSet<Page>()
export const isEvaluating = (page: Page): boolean => active.has(page)
// Сначала создаём holder и только затем вызываем run. Иначе синхронный цикл
// не даст получить ссылку, через которую можно завершить ожидающий RPC.
const factory = new Function(
  'code',
  EVALUATION_SERIALIZER +
    String.raw`
  let cancel;
  const cancelled = new Promise(resolve => cancel = () => resolve({ok:false,timedOut:true,error:'Превышен лимит времени evaluate. Асинхронные операции страницы могут продолжиться; проверьте состояние перед повтором.'}));
  return {
    run: () => {
      const work = Promise.resolve().then(() => globalThis.eval(code)).then(serialize).catch(error => ({ok:false,error:String(error).slice(0,2000)}));
      return Promise.race([work, cancelled]);
    }, cancel: () => cancel()
  };
`
) as (code: string) => EvaluationHolder

// Вложенный документ может делить renderer с родителем или жить отдельно.
// Прерываем тот процесс, в котором реально исполняется выбранный frame.
async function interruptionSession(page: Page, frame: Frame): Promise<CDPSession> {
  let target: Frame | null = frame
  while (target && target !== page.mainFrame()) {
    try {
      return await page.context().newCDPSession(target)
    } catch (error) {
      if (!String(error).includes('does not have a separate CDP session')) throw error
      target = target.parentFrame()
    }
  }
  return page.context().newCDPSession(page)
}
function timeoutResult(): Outcome {
  return {
    ok: false,
    timedOut: true,
    error:
      'Превышен лимит времени evaluate. Асинхронные операции страницы могут продолжиться; проверьте состояние перед повтором.'
  }
}
const bounded = async <T,>(work: Promise<T>, ms = 500): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work.catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
export async function runEvaluation(
  page: Page,
  frame: Frame,
  options: BrowserEvaluateOptions,
  dialogOpen: () => boolean = () => false
): Promise<Outcome> {
  let code: string, timeoutMs: number
  try {
    ;({ code, timeoutMs } = normalizeBrowserEvaluateOptions(options))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Некорректный evaluate' }
  }
  if (active.has(page)) return { ok: false, error: 'Во вкладке уже выполняется evaluate' }
  active.add(page)
  let cdp: CDPSession | undefined,
    handle: JSHandle<EvaluationHolder> | undefined,
    expired = false,
    disposed = false,
    timer: ReturnType<typeof setInterval> | undefined
  const releaseHandle = async () => {
    if (handle && !disposed) {
      disposed = true
      await bounded(handle.dispose())
    }
  }
  const started = performance.now()
  try {
    cdp = await interruptionSession(page, frame)
    let previous = performance.now(),
      consumed = 0
    const deadline = new Promise<Outcome>((resolve) => {
      timer = setInterval(() => {
        const now = performance.now()
        if (!dialogOpen()) consumed += now - previous
        previous = now
        if (consumed < timeoutMs) return
        expired = true
        clearInterval(timer)
        void (async () => {
          await bounded(cdp!.send('Runtime.terminateExecution'))
          if (handle) await bounded(handle.evaluate((holder) => holder.cancel()))
          resolve(timeoutResult())
        })()
      }, 25)
    })
    const work = (async () => {
      handle = await frame.evaluateHandle(factory, code)
      if (expired) {
        await handle.evaluate((holder) => holder.cancel()).catch(() => undefined)
        return timeoutResult()
      }
      return handle.evaluate((holder) => holder.run())
    })()
      .catch((error) => (expired ? timeoutResult() : { ok: false, error: String(error).slice(0, 2000) }))
      .finally(releaseHandle)
    const result = await Promise.race([work, deadline])
    return { ...result, elapsedMs: Math.round(performance.now() - started) }
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 2000) }
  } finally {
    if (timer) clearInterval(timer)
    await releaseHandle()
    if (cdp) await bounded(cdp.detach())
    active.delete(page)
  }
}
