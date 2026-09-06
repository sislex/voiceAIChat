// Живое состояние QA-этапа без опроса сервера.
//
// Панели этапов держали `usePolling` на 1,5–2 секунды всё время, пока ран активен:
// один открытый таск давал десятки запросов `…/qa/integration` в минуту, и это было
// видно в логах прода. Теперь сервер шлёт адресный кадр `qa.stage.updated`, а панель
// перечитывает свой снимок только по нему — тем же приёмом, что вкладка подготовки
// (`TaskPreparationTab`) с `preparation.run.updated`.
//
// Опрос остаётся ровно одним запасным вариантом: моста доски нет (desktop-сборка без
// WS). Иначе события хватает: сервер эмитит их на старте, завершении, отмене, ответе
// и на каждом переходе рана.

import { useEffect } from 'react'
import type { QaRunStage } from '@shared/qa'
import { usePolling } from '../../lib/usePolling'

/** Серия событий одного рана схлопывается в один запрос снимка. */
const DEBOUNCE_MS = 400

export interface QaStageUpdatesOptions {
  projectId: string
  taskId: string
  /** Этап панели; кадры соседних этапов игнорируются. */
  stage: QaRunStage
  /** Перечитать снимок панели. */
  onUpdate: () => void
  /** Ран активен: без моста доски это единственный признак, что нужен опрос. */
  active: boolean
  /** Интервал запасного опроса, когда моста нет. */
  intervalMs?: number
}

export function useQaStageUpdates({ projectId, taskId, stage, onUpdate, active, intervalMs = 2000 }: QaStageUpdatesOptions): void {
  const bridged = Boolean(typeof window !== 'undefined' && window.board?.onQaStageUpdated)

  useEffect(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.board
    if (!bridge?.onQaStageUpdated) return
    let timer: number | null = null
    const schedule = (): void => {
      if (timer !== null) return
      timer = window.setTimeout(() => { timer = null; onUpdate() }, DEBOUNCE_MS)
    }
    const off = bridge.onQaStageUpdated((event) => {
      if (event.projectId === projectId && event.taskId === taskId && event.stage === stage) schedule()
    })
    // Реконнект мог пропустить события — сверяемся полностью, а не ждём следующего.
    const offReconnect = bridge.onReconnect?.(() => onUpdate())
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      off?.()
      offReconnect?.()
    }
  }, [projectId, taskId, stage, onUpdate])

  usePolling(onUpdate, { enabled: !bridged && active, intervalMs })
}
