import type { PtySessionSnapshot, PtySessionStore, PtySessionTab } from '../components/machine'

/**
 * Список открытых вкладок терминала. Хранится вне React: утилиту закрывают и
 * открывают заново, а сеанс на сервере продолжает жить по своему `ptyId` —
 * вернуться в него можно, только если id пережил размонтирование компонента.
 */
const STORAGE_KEY = 'voicechat.ptySessions'

function newPtyId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  return g.crypto?.randomUUID ? g.crypto.randomUUID() : `pty-${Date.now()}-${Math.round(performance.now())}`
}

const EMPTY: PtySessionSnapshot = { tabs: [], activeId: null }

/** Читает вкладки прошлой загрузки страницы: сеансы на сервере переживают F5. */
function load(): PtySessionSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<PtySessionSnapshot>
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter(
          (t): t is PtySessionTab => !!t && typeof t.ptyId === 'string' && typeof t.agentId === 'string'
        )
      : []
    const active = tabs.some((t) => t.ptyId === parsed.activeId) ? parsed.activeId : undefined
    return { tabs, activeId: active ?? tabs[0]?.ptyId ?? null }
  } catch {
    // localStorage недоступен или в нём мусор — начинаем с чистого списка.
    return EMPTY
  }
}

function save(snapshot: PtySessionSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // приватный режим/SSR: вкладки просто не переживут перезагрузку страницы
  }
}

export interface CreatePtySessionStoreOptions {
  /** Сохранять вкладки в localStorage (общий стор приложения — да, тесты — нет). */
  persist?: boolean
  newId?: () => string
}

export function createPtySessionStore(opts: CreatePtySessionStoreOptions = {}): PtySessionStore {
  const persist = opts.persist ?? false
  const nextId = opts.newId ?? newPtyId
  const listeners = new Set<() => void>()
  let state: PtySessionSnapshot = persist ? load() : EMPTY

  const set = (next: PtySessionSnapshot): void => {
    state = next
    if (persist) save(state)
    for (const cb of [...listeners]) cb()
  }

  const add = (agentId: string, cwd?: string): string => {
    const tab: PtySessionTab = { ptyId: nextId(), agentId, ...(cwd ? { cwd } : {}) }
    set({ tabs: [...state.tabs, tab], activeId: tab.ptyId })
    return tab.ptyId
  }

  return {
    snapshot: () => state,
    subscribe: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    open: (agentId, cwd) => {
      // Точное совпадение каталога — та же вкладка; без каталога подойдёт любой
      // сеанс этой машины (переключатель машин не должен плодить вкладки).
      const same =
        state.tabs.find((t) => t.agentId === agentId && (t.cwd ?? '') === (cwd ?? '')) ??
        (cwd ? undefined : state.tabs.find((t) => t.agentId === agentId))
      if (!same) return add(agentId, cwd)
      if (state.activeId !== same.ptyId) set({ tabs: state.tabs, activeId: same.ptyId })
      return same.ptyId
    },
    create: (agentId, cwd) => add(agentId, cwd),
    activate: (ptyId) => {
      if (state.activeId === ptyId || !state.tabs.some((t) => t.ptyId === ptyId)) return
      set({ tabs: state.tabs, activeId: ptyId })
    },
    close: (ptyId) => {
      if (!state.tabs.some((t) => t.ptyId === ptyId)) return
      const tabs = state.tabs.filter((t) => t.ptyId !== ptyId)
      const activeId = state.activeId === ptyId ? (tabs[tabs.length - 1]?.ptyId ?? null) : state.activeId
      set({ tabs, activeId })
    }
  }
}

/** Общий стор приложения: один на страницу, переживает закрытие утилиты и F5. */
export const ptySessionStore = createPtySessionStore({ persist: true })
