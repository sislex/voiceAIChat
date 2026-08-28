// Ограничитель частоты (п.39): скользящее окно на ключ (обычно userId). Импорт ZIP/URL — самая
// дорогая операция Make (распаковка, сеть, запись сотен файлов), поэтому её нельзя дёргать в цикле.
// Чистый класс с инъекцией часов — тестируется без таймеров.

export interface RateLimitVerdict { ok: boolean; remaining: number; retryAfterSec: number }

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}

  /** Учитывает попытку и говорит, можно ли; при отказе — через сколько секунд освободится слот. */
  /** Сброс всех окон — для тестов, где один процесс и один IP обслуживают много сценариев. */
  reset(): void { this.hits.clear() }
  /** Забыть один ключ — после успешного входа окно по имени начинается заново. */
  forget(key: string): void { this.hits.delete(key) }

  hit(key: string): RateLimitVerdict {
    const t = this.now()
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs)
    if (list.length >= this.limit) {
      this.hits.set(key, list)
      return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((list[0]! + this.windowMs - t) / 1000)) }
    }
    list.push(t)
    this.hits.set(key, list)
    // Не даём карте расти бесконечно: ключи без свежих попаданий выбрасываем при каждом сотом вызове.
    if (this.hits.size > 1000) for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k)
    return { ok: true, remaining: this.limit - list.length, retryAfterSec: 0 }
  }
}
