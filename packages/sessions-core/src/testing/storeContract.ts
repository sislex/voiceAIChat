// Исполняемый контракт хранилища. Именно он делает модуль переносимым: чужая
// реализация SessionStore считается годной ровно тогда, когда проходит этот
// набор. Раннер не задан — кейсы это просто функции, их гоняет и vitest, и
// node:test, и что угодно ещё; поэтому здесь нет ни импортов раннера, ни
// зависимостей.
import type { Awaitable, SessionStore } from '../ports'
import type { NewSession } from '../types'

/** Часы, которыми управляет контракт: реализация обязана брать время из них. */
export interface ContractClock {
  now(): number
  /** Перевести часы на абсолютную отметку. */
  set(ms: number): void
  /** Подвинуть часы вперёд. */
  advance(ms: number): void
}

export type StoreFactory = (clock: ContractClock) => Awaitable<SessionStore>

export interface ContractContext {
  store: SessionStore
  clock: ContractClock
}

export interface StoreContractCase {
  name: string
  run(ctx: ContractContext): Promise<void>
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assert(actual === expected, `${message}: получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)}`)
}

/** Стартовая отметка времени контракта — фиксированная, чтобы кейсы читались. */
export const CONTRACT_T0 = 1_700_000_000_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Часы для контракта: одна реализация на все раннеры. */
export function createContractClock(start = CONTRACT_T0): ContractClock {
  let current = start
  return {
    now: () => current,
    set: (ms) => { current = ms },
    advance: (ms) => { current += ms }
  }
}

const session = (sid: string, over: Partial<NewSession> = {}): NewSession => ({
  sid,
  user: 'u',
  ip: '10.0.0.1',
  userAgent: 'Chrome/128 Mac OS X',
  ttlMs: 30 * DAY,
  ...over
})

export const sessionStoreContract: StoreContractCase[] = [
  {
    name: 'создаёт сессию и отдаёт её по sid и в списке пользователя',
    async run({ store, clock }) {
      await store.create(session('a'))
      const one = await store.get('a')
      assert(one, 'сессия должна читаться по sid')
      equal(one.user, 'u', 'владелец')
      equal(one.createdAt, clock.now(), 'момент входа')
      equal(one.expiresAt, clock.now() + 30 * DAY, 'срок жизни')
      equal((await store.list('u')).length, 1, 'размер списка')
      equal((await store.list('другой')).length, 0, 'чужой пользователь не видит сессию')
    }
  },
  {
    name: 'повторный create с тем же sid не заводит вторую строку',
    async run({ store, clock }) {
      await store.create(session('a'))
      clock.advance(5 * HOUR)
      await store.create(session('a'))
      equal((await store.list('u')).length, 1, 'размер списка')
    }
  },
  {
    name: 'список отсортирован по свежести активности',
    async run({ store, clock }) {
      await store.create(session('a'))
      clock.advance(HOUR)
      await store.create(session('b'))
      clock.advance(HOUR)
      await store.create(session('c'))
      clock.advance(HOUR)
      await store.touch('a', { ttlMs: 30 * DAY })
      const order = (await store.list('u')).map((s) => s.sid).join(',')
      equal(order, 'a,c,b', 'порядок списка')
    }
  },
  {
    name: 'touch продлевает срок, но не чаще раза в минуту',
    async run({ store, clock }) {
      const start = clock.now()
      await store.create(session('a'))
      clock.advance(10_000)
      await store.touch('a', { ttlMs: 30 * DAY })
      equal((await store.get('a'))!.lastSeen, start, 'слишком частый touch игнорируется')
      clock.advance(2 * MINUTE)
      await store.touch('a', { ttlMs: 30 * DAY })
      const after = await store.get('a')
      equal(after!.lastSeen, clock.now(), 'активность обновлена')
      equal(after!.expiresAt, clock.now() + 30 * DAY, 'срок продлён')
    }
  },
  {
    name: 'истёкшая сессия не читается и не попадает в список, но строка о ней остаётся',
    async run({ store, clock }) {
      await store.create(session('a', { ttlMs: HOUR }))
      clock.advance(2 * HOUR)
      equal(await store.get('a'), null, 'истёкшая сессия недоступна')
      equal((await store.list('u')).length, 0, 'истёкшая сессия вне списка')
      equal(await store.has('a'), true, 'строка сохраняется до чистки')
    }
  },
  {
    name: 'отзыв гасит сессию, повторный отзыв возвращает false, воскресить нельзя',
    async run({ store, clock }) {
      await store.create(session('a'))
      clock.advance(HOUR)
      equal(await store.revoke('a'), true, 'первый отзыв')
      equal(await store.revoke('a'), false, 'повторный отзыв')
      equal(await store.get('a'), null, 'отозванная сессия недоступна')
      equal(await store.has('a'), true, 'строка отозванной сессии остаётся')
      clock.advance(HOUR)
      await store.create(session('a'))
      equal(await store.get('a'), null, 'create не воскрешает отозванную сессию')
      clock.advance(HOUR)
      await store.touch('a', { ttlMs: 30 * DAY })
      equal(await store.get('a'), null, 'touch не воскрешает отозванную сессию')
    }
  },
  {
    name: 'revokeAll гасит все сессии пользователя, кроме указанной и кроме чужих',
    async run({ store, clock }) {
      await store.create(session('a'))
      await store.create(session('b'))
      await store.create(session('c'))
      await store.create(session('d', { user: 'другой' }))
      clock.advance(HOUR)
      equal(await store.revokeAll('u', 'a'), 2, 'число отозванных')
      equal((await store.list('u')).map((s) => s.sid).join(','), 'a', 'осталась только текущая')
      equal((await store.list('другой')).length, 1, 'чужие сессии не тронуты')
      equal(await store.revokeAll('u', 'a'), 0, 'повторный вызов ничего не отзывает')
    }
  },
  {
    name: 'revokeAll без исключения гасит и текущую сессию',
    async run({ store }) {
      await store.create(session('a'))
      await store.create(session('b'))
      equal(await store.revokeAll('u', null), 2, 'число отозванных')
      equal((await store.list('u')).length, 0, 'живых сессий не осталось')
    }
  },
  {
    name: 'update меняет метку и доверие, снимает доверие и не трогает отозванные',
    async run({ store, clock }) {
      await store.create(session('a'))
      equal(await store.update('a', { label: 'Рабочий ноут' }), true, 'метка поставлена')
      equal((await store.get('a'))!.label, 'Рабочий ноут', 'метка сохранена')
      clock.advance(HOUR)
      await store.update('a', { trusted: true })
      equal((await store.get('a'))!.trustedAt, clock.now(), 'момент доверия')
      clock.advance(HOUR)
      await store.update('a', { trusted: false })
      equal((await store.get('a'))!.trustedAt, null, 'доверие снято')
      equal((await store.get('a'))!.label, 'Рабочий ноут', 'метка не потерялась')
      await store.revoke('a')
      equal(await store.update('a', { label: 'Другое' }), false, 'отозванную править нельзя')
      equal(await store.update('нет-такой', { label: 'x' }), false, 'несуществующую править нельзя')
    }
  },
  {
    name: 'prune убирает истёкшие и давно отозванные, живые оставляет',
    async run({ store, clock }) {
      await store.create(session('живая'))
      await store.create(session('истёкшая', { ttlMs: HOUR }))
      await store.create(session('свежеотозванная'))
      await store.create(session('давно-отозванная'))
      clock.advance(HOUR)
      await store.revoke('давно-отозванная')
      clock.advance(9 * DAY)
      await store.revoke('свежеотозванная')
      clock.advance(DAY)
      equal(await store.prune(), 2, 'число удалённых строк')
      equal(await store.has('живая'), true, 'живая сессия на месте')
      equal(await store.has('свежеотозванная'), true, 'недавний отзыв ещё хранится')
      equal(await store.has('истёкшая'), false, 'истёкшая удалена')
      equal(await store.has('давно-отозванная'), false, 'старый отзыв удалён')
    }
  },
  {
    name: 'конкурентные мутации не воскрешают и не теряют записи',
    async run({ store, clock }) {
      await store.create(session('a'))
      await store.create(session('b'))
      clock.advance(HOUR)
      // Отзыв и правка приходят одновременно: победить должен отзыв, потому что
      // после него сессии не существует — иначе правка «воскресит» её.
      const [revoked, updated] = await Promise.all([store.revoke('a'), store.update('a', { label: 'Гонка' })])
      equal(revoked, true, 'отзыв прошёл')
      equal(await store.get('a'), null, 'отозванная сессия не воскресает правкой')
      if (updated) equal(await store.has('a'), true, 'строка на месте, даже если правка успела раньше')
      // Два параллельных отзыва: успешным считается только один.
      const results = await Promise.all([store.revoke('b'), store.revoke('b')])
      equal(results.filter(Boolean).length, 1, 'ровно один успешный отзыв')
      equal((await store.list('u')).length, 0, 'живых сессий не осталось')
    }
  },
  {
    name: 'сохраняет метаданные устройства, переданные при входе',
    async run({ store }) {
      await store.create(session('a', { deviceKey: 'abc12345', platform: 'web', clientVersion: '1.2.3', geo: { country: 'RU', city: 'Москва', label: 'Москва, RU' } }))
      const one = (await store.get('a'))!
      equal(one.deviceKey, 'abc12345', 'ключ устройства')
      equal(one.platform, 'web', 'платформа')
      equal(one.clientVersion, '1.2.3', 'версия клиента')
      equal(one.geo?.label, 'Москва, RU', 'место')
    }
  }
]

/**
 * Прогоняет весь контракт, создавая свежее хранилище на каждый кейс. Годится,
 * когда раннер не нужен; в vitest удобнее разложить `sessionStoreContract`
 * по отдельным `it`, чтобы падал конкретный кейс, а не весь набор.
 */
export async function runSessionStoreContract(factory: StoreFactory): Promise<void> {
  for (const item of sessionStoreContract) {
    const clock = createContractClock()
    const store = await factory(clock)
    try {
      await item.run({ store, clock })
    } catch (error) {
      throw new Error(`контракт хранилища сессий, кейс «${item.name}»: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
