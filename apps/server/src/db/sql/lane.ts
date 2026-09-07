// «Полоса» для методов репозиториев над SQLite: вызовы через порты выполняются по одному, в
// порядке поступления. Раньше это давал сам синхронный драйвер — тело метода выполнялось целиком
// при вызове, и два запроса не могли одновременно прочитать max(position) и вставить одинаковые
// строки. Асинхронные тела (общий код с Postgres) сами по себе этого не гарантируют: между
// await'ами внутрь просочился бы соседний вызов. У Postgres полосы нет — там атомарность
// многошаговых методов дают транзакции и ограничения базы, а параллелизм и есть цель.
//
// Повторный вход (метод порта зовёт другой порт из своего контекста) проходит без ожидания —
// иначе взаимная блокировка; контекст передаёт AsyncLocalStorage. Свободная полоса запускает
// тело синхронно: первый запрос метода выполняется до возврата промиса, и порядок вызовов равен
// порядку выполнения даже без await у вызывающего.

import { AsyncLocalStorage } from 'node:async_hooks'

export interface Lane {
  run<T>(fn: () => Promise<T> | T): Promise<T>
  /** Сколько вызовов сейчас выполняется или ждёт — для диагностики и тестов. */
  readonly pending: number
  /** Дождаться, пока полоса опустеет: закрытие базы не должно обрывать поставленные в очередь вызовы. */
  idle(): Promise<void>
}

export function createLane(): Lane {
  const als = new AsyncLocalStorage<true>()
  let tail: Promise<void> = Promise.resolve()
  let pending = 0
  return {
    get pending() { return pending },
    async idle() { while (pending > 0) await tail },
    run<T>(fn: () => Promise<T> | T): Promise<T> {
      if (als.getStore()) return (async () => fn())()
      const exec = (): Promise<T> => als.run(true, () => (async () => fn())())
      pending++
      const result = pending === 1 ? exec() : tail.then(exec, exec)
      tail = result.then(() => {}, () => {}).then(() => { pending-- })
      return result
    }
  }
}
