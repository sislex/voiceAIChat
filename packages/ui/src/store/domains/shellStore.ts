// shellStore — состояние оболочки приложения (CHAT-236).
//
// Здесь нет ни сообщений, ни настроек разговора, ни проектов, ни машин, ни
// административных данных, ни активного хода модели: только то, что рисует
// сама оболочка — окна верхнего уровня, выдвижной сайдбар, очередь тостов и
// баннер последней ошибки.

import { createStoreCore, type Store } from '../createStore'
import { SIDEBAR_COLLAPSED_KEY } from '../contracts'

/**
 * Уведомление для тоста. Стор их только копит: показывает App (useToast), потому
 * что рисовать умеет React, а стор фреймворк-независим.
 */
export interface AppNotice {
  id: string
  kind: 'error' | 'success' | 'info'
  text: string
  /** Безопасный повтор операции: тост покажет кнопку «Повторить». */
  retry?: () => void
}

export interface ShellState {
  /** Открыт ли модал настроек. */
  settingsOpen: boolean
  /** Развёрнута ли панель консоли активности. */
  consoleOpen: boolean
  /** Выдвинут ли сайдбар на телефоне. */
  sidebarOpen: boolean
  /** Свёрнут ли сайдбар на десктопе (персист под прежним ключом). */
  sidebarCollapsed: boolean
  /** Открыта ли командная палитра (⌘K). */
  paletteOpen: boolean
  /** Открыта ли шпаргалка по горячим клавишам (?). */
  cheatSheetOpen: boolean
  /** Открыта ли панель «Использование БЗ». */
  kbUsageOpen: boolean
  /** Текст последней ошибки для баннера (null — нет). */
  error: string | null
  /** Готовое исправление к текущей ошибке: кнопка в баннере. */
  errorFix: { label: string; prompt: string; skipProjectSync?: boolean } | null
  /** Очередь уведомлений для тостов. */
  notices: AppNotice[]
}

export interface ShellActions {
  openSettings(): void
  closeSettings(): void
  toggleConsole(): void
  setSidebarOpen(open: boolean): void
  setSidebarCollapsed(collapsed: boolean): void
  setPaletteOpen(open: boolean): void
  setCheatSheetOpen(open: boolean): void
  openKbUsage(): void
  closeKbUsage(): void
  /** Показать баннер ошибки (голос, ход модели, загрузки). */
  setError(message: string | null): void
  dismissError(): void
  setErrorFix(fix: { label: string; prompt: string; skipProjectSync?: boolean } | null): void
  /** Поставить уведомление в очередь тостов. */
  notify(notice: Omit<AppNotice, 'id'>): void
  /** Ошибка вызова клиента: тост, плюс «Повторить», если повтор безопасен. */
  fail(err: unknown, retry?: () => void): void
  dismissNotice(id: string): void
  /** Сбросить состояние оболочки (logout). */
  reset(): void
}

export type ShellStore = Store<ShellState, ShellActions>


export interface ShellDeps {
  /** Постоянные настройки взгляда (свёрнутый сайдбар). */
  prefs?: { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }
}

function initialState(collapsed: boolean): ShellState {
  return {
    settingsOpen: false,
    consoleOpen: true,
    sidebarOpen: false,
    sidebarCollapsed: collapsed,
    paletteOpen: false,
    cheatSheetOpen: false,
    kbUsageOpen: false,
    error: null,
    errorFix: null,
    notices: []
  }
}

export function createShellStore(deps: ShellDeps = {}): ShellStore {
  const prefs = deps.prefs
  const core = createStoreCore<ShellState>(initialState(prefs?.get(SIDEBAR_COLLAPSED_KEY) === '1'))
  const { getState, setState } = core
  let noticeSeq = 0

  function notify(notice: Omit<AppNotice, 'id'>): void {
    noticeSeq += 1
    setState({ notices: [...getState().notices, { ...notice, id: `n${noticeSeq}` }] })
  }

  return {
    getState,
    subscribe: core.subscribe,
    dispose: core.dispose,
    actions: {
      openSettings: () => setState({ settingsOpen: true }),
      closeSettings: () => setState({ settingsOpen: false }),
      toggleConsole: () => setState({ consoleOpen: !getState().consoleOpen }),
      setSidebarOpen: (open) => setState({ sidebarOpen: open }),
      setSidebarCollapsed(collapsed) {
        prefs?.set(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
        setState({ sidebarCollapsed: collapsed })
      },
      setPaletteOpen: (open) => setState({ paletteOpen: open }),
      setCheatSheetOpen: (open) => setState({ cheatSheetOpen: open }),
      openKbUsage: () => setState({ kbUsageOpen: true }),
      closeKbUsage: () => setState({ kbUsageOpen: false }),
      // Своя ошибка без предложения гасит прежнее: кнопка «Исправить» от
      // старой причины к новой не относится.
      setError: (message) => setState({ error: message, errorFix: null }),
      dismissError: () => setState({ error: null, errorFix: null }),
      setErrorFix: (fix) => setState({ errorFix: fix }),
      notify,
      fail(err, retry) {
        notify({ kind: 'error', text: err instanceof Error ? err.message : String(err), ...(retry ? { retry } : {}) })
      },
      dismissNotice(id) {
        setState({ notices: getState().notices.filter((item) => item.id !== id) })
      },
      reset() {
        // Свёрнутость сайдбара переживает выход: это настройка взгляда, а не данные.
        core.resetState({ ...initialState(getState().sidebarCollapsed) })
      }
    }
  }
}

