// Длительность этапа merge-рана. Незакрытый этап считался «до сейчас» без
// оглядки на сам ран, поэтому у упавшего рана «База знаний» показывала 95+
// минут спустя часы после остановки (ран CHAT-408). Сервер теперь закрывает
// этапы при финализации, но записи, сделанные до фикса, лечит уже эта функция.
import { describe, it, expect } from 'vitest'
import { stageDuration } from './MergeRunFeed'

describe('stageDuration', () => {
  it('готовую длительность берёт как есть', () => {
    expect(stageDuration({ durationMs: 41_000, startedAt: 1000 }, null, 900_000)).toBe(41_000)
  })

  it('у живого рана незакрытый этап считается до «сейчас»', () => {
    expect(stageDuration({ durationMs: null, startedAt: 1000 }, null, 61_000)).toBe(60_000)
  })

  it('у завершённого рана незакрытый этап останавливается на конце рана', () => {
    expect(stageDuration({ durationMs: null, startedAt: 1000 }, 31_000, 9_000_000)).toBe(30_000)
  })

  it('без начала длительности нет, а отрицательной она не бывает', () => {
    expect(stageDuration({ durationMs: null, startedAt: null }, 31_000)).toBeNull()
    expect(stageDuration({ durationMs: null, startedAt: 50_000 }, 31_000)).toBe(0)
  })
})
