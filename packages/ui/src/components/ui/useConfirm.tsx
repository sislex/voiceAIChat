// useConfirm — подтверждение как обычный await, чтобы код по месту читался так же
// коротко, как с прежним нативным диалогом браузера:
//
//   if (!(await confirm({ title: 'Удалить «Задача A»?', variant: 'danger' }))) return
//
// Окно рисует провайдер (один на приложение, в корне App): вопрос приходит из
// любой глубины дерева, а Dialog поверх остальных окон встаёт сам — стек слоёв
// общий (useDialogStack), поэтому Esc достаётся именно подтверждению.

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog'

export type Confirm = (request: ConfirmRequest) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  // Ответ отдаём через промис вызывающего: он ждёт ровно одного решения.
  const resolveRef = useRef<((ok: boolean) => void) | null>(null)

  const settle = useCallback((ok: boolean): void => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setRequest(null)
    resolve?.(ok)
  }, [])

  const confirm = useCallback<Confirm>((next) => {
    // Прошлый вопрос ещё висит (двойной клик) — считаем его отменённым, иначе
    // его промис никогда не разрешится.
    resolveRef.current?.(false)
    setRequest(next)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && <ConfirmDialog {...request} onConfirm={() => settle(true)} onCancel={() => settle(false)} />}
    </ConfirmContext.Provider>
  )
}

/** Спросить подтверждение. Требует ConfirmProvider — в приложении он в корне App. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm: нет ConfirmProvider — оберните дерево в <ConfirmProvider>')
  return confirm
}
