// Единое правило переходов состояний экрана: loading → (data | empty | error).
//
// До него каждый экран решал сам, и получались две болезни. Первая — мигание:
// при повторной загрузке уже показанного списка контент подменялся скелетоном,
// хотя данные никуда не девались. Вторая — «пусто вместо сломалось»: ошибка
// загрузки нигде не показывалась, список просто оставался пустым.
//
// Правило: скелетон — только на первой загрузке (данных ещё нет), дальше данные
// остаются на экране, а факт обновления показывает неблокирующий индикатор
// (`RefreshIndicator` рядом со `Skeleton`).

/** Состояние запроса: как его хранит стор или локальный `useState`. */
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Что рисует экран: скелетон, ошибка, пустота или сами данные. */
export type ViewState = 'skeleton' | 'error' | 'empty' | 'data'

export interface LoadView {
  state: ViewState
  /** Данные показаны, но запрос ещё идёт — место для неблокирующего индикатора. */
  refreshing: boolean
  /** Ошибка при уже показанных данных — баннер над содержимым, а не вместо него. */
  staleError: boolean
}

/**
 * Разбор состояния в то, что показывает экран.
 *
 * `idle` без данных — тоже скелетон: запрос обычно уходит в эффекте при
 * монтировании, и показать на один кадр «Пусто» было бы неправдой.
 */
export function loadView(status: LoadStatus, hasData: boolean): LoadView {
  if (!hasData) {
    if (status === 'error') return { state: 'error', refreshing: false, staleError: false }
    if (status === 'ready') return { state: 'empty', refreshing: false, staleError: false }
    return { state: 'skeleton', refreshing: false, staleError: false }
  }
  return {
    state: 'data',
    refreshing: status === 'loading',
    staleError: status === 'error'
  }
}
