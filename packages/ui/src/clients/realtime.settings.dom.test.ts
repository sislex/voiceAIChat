// Внешние поводы перечитать настройки: соседняя вкладка, возвращение сервера
// после перезапуска и возвращение сети. Без них вкладка, чья загрузка пришлась
// на окно деплоя, так и живёт на дефолтах, пока человек не нажмёт «Повторить».

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createBrowserRealtime } from './realtime'
import { SETTINGS_UPDATE_KEY } from '../store/contracts'
import type { RealtimeHandlers } from '../runtime/appRuntime'

/** Пустые обработчики: тесту важен только `settingsChanged`. */
function handlers(): RealtimeHandlers {
  return new Proxy({ settingsChanged: vi.fn() } as unknown as RealtimeHandlers, {
    get: (target, prop) => Reflect.get(target, prop) ?? (() => {})
  })
}

afterEach(() => {
  delete (window as { realtime?: unknown }).realtime
})

describe('createBrowserRealtime — поводы перечитать настройки', () => {
  it('сигнал соседней вкладки', () => {
    const h = handlers()
    const stop = createBrowserRealtime()(h)

    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_UPDATE_KEY, newValue: '1' }))
    expect(h.settingsChanged).toHaveBeenCalledTimes(1)

    // Чужой ключ не будит домен настроек.
    window.dispatchEvent(new StorageEvent('storage', { key: 'vc.theme', newValue: 'dark' }))
    expect(h.settingsChanged).toHaveBeenCalledTimes(1)
    stop()
  })

  it('переподключение к серверу — но не первое подключение', () => {
    let connected: null | (() => void) = null
    const fire = (): void => { (connected as (() => void) | null)?.() }
    ;(window as { realtime?: unknown }).realtime = {
      onConnected: (cb: () => void) => { connected = cb; return () => { connected = null } },
      connected: () => true,
      onTaskPreparationNotificationsInvalidated: () => () => {}
    }
    const h = handlers()
    const stop = createBrowserRealtime()(h)

    fire() // первое подключение — настройки грузит bootstrap
    expect(h.settingsChanged).not.toHaveBeenCalled()

    fire() // сервер вернулся после перезапуска
    expect(h.settingsChanged).toHaveBeenCalledTimes(1)
    stop()
  })

  it('возвращение сети', () => {
    const h = handlers()
    const stop = createBrowserRealtime()(h)

    window.dispatchEvent(new Event('online'))
    expect(h.settingsChanged).toHaveBeenCalledTimes(1)

    // После отписки события больше не будят домен.
    stop()
    window.dispatchEvent(new Event('online'))
    expect(h.settingsChanged).toHaveBeenCalledTimes(1)
  })
})
