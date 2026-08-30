# @voicechat/sessions-core

Ядро модуля «сессии и устройства»: типы, разбор устройства, политики срока
жизни и доверия, порт хранилища и **исполняемый контракт** к нему.

Пакет без зависимостей и без платформы — ни react, ни node-only API, ни
транспорта. Всё, что связано с приложением, приходит через порты.

## Что внутри

| Файл | Что даёт |
|---|---|
| `types.ts` | `DeviceSession`, `SessionPolicy`, `GeoInfo`, значения по умолчанию |
| `device.ts` | `parseUserAgent` → браузер, версия, ОС, класс устройства; `deviceIcon` |
| `deviceKey.ts` | `deviceKey` (стабильный ключ устройства), `normalizeIp`, `localGeo` |
| `policy.ts` | `ttlFor`, `isOnline`, `isTrusted`, `isStale`, `overLimit`, `isNewDevice`, `findTrustedDevice` |
| `presentation.ts` | `sortSessions`, `filterSessions`, `toView`, `durationOf` — подготовка списка к показу |
| `ports.ts` | `SessionStore`, `GeoResolver`, `Clock` |
| `memoryStore.ts` | `InMemorySessionStore` — референсная реализация хранилища |
| `testing/` | `sessionStoreContract` — набор кейсов, который обязана проходить любая реализация |

## Встроить в своё приложение

```ts
import { InMemorySessionStore, deviceKey, isNewDevice, ttlFor } from '@voicechat/sessions-core'

const store = new InMemorySessionStore()

export function login(user: string, req: { ip: string; userAgent: string }, remember: boolean): string {
  const known = store.list(user)
  if (isNewDevice(known, req)) notifyOwner(user, req)   // «вход с нового устройства»
  const sid = crypto.randomUUID()
  store.create({ sid, user, ip: req.ip, userAgent: req.userAgent, ttlMs: ttlFor({ remember }), deviceKey: deviceKey(req) })
  return sid
}
```

Своё хранилище (SQL, Redis, чужой сервис) реализует `SessionStore` и **обязано**
пройти контракт — иначе поведение разъедется с ядром в мелочах, которые всплывут
только в проде:

```ts
import { describe, it } from 'vitest'
import { createContractClock, sessionStoreContract } from '@voicechat/sessions-core/testing'

describe('моё хранилище сессий', () => {
  for (const item of sessionStoreContract) {
    it(item.name, async () => {
      const clock = createContractClock()
      await item.run({ store: createMyStore(clock.now), clock })
    })
  }
})
```

Время реализация берёт из своих часов, а не из аргументов: так один и тот же
набор проверяет и хранилище в памяти, и базу с подменёнными в тестах часами.
Живой пример адаптера — `apps/server/src/users/sessionStore.ts` в этом репозитории.

## Чего в ядре нет

Локализации (тексты живут в UI-модуле `@voicechat/sessions-app`), HTTP-роутов,
знания о cookie и токенах: ключ устройства не секрет и всегда проверяется вместе
с записью в хранилище.
