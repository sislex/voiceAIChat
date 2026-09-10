import type { BrowserFramePath } from './browserFrames'
import type { BrowserCommand, BrowserSelectorResult } from './types'

/** Полное чтение ограничено: сломанный cursor не должен держать прогон бесконечно. */
const CHUNK = 20_000
const MAX_CHUNKS = 10

export interface ScenarioText {
  text: string
  complete: boolean
  reason?: string
}

/** Читаем следующие части только пока они могут изменить вердикт ожидания. */
export async function readScenarioText(
  send: (command: BrowserCommand) => Promise<unknown>,
  expectation: { expectText?: string; expectAbsentText?: string; frame?: BrowserFramePath }
): Promise<ScenarioText> {
  let text = '', offset = 0, identity: string | undefined, total: number | undefined
  for (let part = 0; part < MAX_CHUNKS; part++) {
    const response = await send({ type: 'selector', ...(expectation.frame !== undefined ? { frame: expectation.frame } : {}), action: { kind: 'read', limit: CHUNK, ...(offset ? { offset } : {}) } })
    const read = response as BrowserSelectorResult | null
    if (!read || typeof read !== 'object' || read.ok !== true || typeof read.text !== 'string') {
      throw new Error(read?.error || 'Раннер не вернул подтверждённый текст страницы')
    }
    const currentIdentity = JSON.stringify([read.page?.url ?? null, read.frame?.url ?? null])
    if (part && (identity !== currentIdentity || total !== read.total)) {
      // Части разных документов нельзя склеивать в доказательство результата.
      return { text: '', complete: false, reason: 'Страница изменилась между частями чтения' }
    }
    identity = currentIdentity; total = read.total
    const span = read.nextOffset === undefined ? read.text.length : read.nextOffset - offset
    const marker = read.truncated && read.text.length === span + 1 && read.text.endsWith('…')
    if ((read.offset !== undefined && read.offset !== offset) || !Number.isSafeInteger(span) || span < 0 || span > CHUNK ||
        (read.text.length !== span && !marker)) {
      return { text: '', complete: false, reason: 'Раннер вернул неверное смещение текста' }
    }
    // read добавляет визуальное многоточие за лимитом; оно не часть документа
    // и не должно разрывать искомую фразу на границе двух порций.
    text += marker ? read.text.slice(0, -1) : read.text
    if (!read.truncated) {
      if (total !== undefined && total !== offset + span) return { text: '', complete: false, reason: 'Полнота текста не подтверждена раннером' }
      return { text, complete: true }
    }
    // Найденное запрещённое слово уже доказывает провал; положительное —
    // успех только тогда, когда не требуется ещё доказать отсутствие другого.
    if ((expectation.expectAbsentText && text.includes(expectation.expectAbsentText)) ||
        (!expectation.expectAbsentText && expectation.expectText && text.includes(expectation.expectText))) {
      return { text, complete: false }
    }
    if (!Number.isSafeInteger(read.nextOffset) || read.nextOffset !== offset + span || read.nextOffset! <= offset) {
      return { text, complete: false, reason: 'Раннер не предоставил продолжение текста' }
    }
    offset = read.nextOffset!
  }
  return { text, complete: false, reason: `Достигнут предел чтения ${CHUNK * MAX_CHUNKS} символов` }
}
