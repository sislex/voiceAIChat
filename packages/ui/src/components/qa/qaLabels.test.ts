// Сторож против сырых английских статусов в панелях карточки задачи.
//
// Круг 3 нашёл в `GenericQaStageRunPanel` строку `<strong>{run.status}</strong>`:
// пользователю показывали «running» и «gate_failed» — отладочный вывод вместо
// состояния этапа. Тот же класс дефекта уже ловили у улучшений («new»,
// «development»). Ловим его текстом исходника: поведенческий тест такое видит
// только если конкретный статус попал в фикстуру.
//
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FILES = [
  '../qa/ComponentQaPanel.tsx',
  '../qa/QaStageRunPanel.tsx',
  '../qa/ManualQaPanel.tsx',
  '../kanban/TaskModal.tsx',
  '../kanban/TaskPreparationTab.tsx'
]

/** Статусы, которые приходят с сервера и обязаны показываться подписью. */
const RAW_STATUSES = [
  'queued', 'running', 'passed', 'failed', 'blocked', 'cancelled',
  'awaiting_input', 'gate_failed', 'interrupted', 'stale', 'skipped'
]

function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
}

describe('панели карточки не печатают сырой статус', () => {
  it.each(FILES)('%s не выводит status как текст', (file) => {
    const code = source(file)
    // Ищем именно вывод в разметку: `{run.status}`, `{item.status}` и т.п.
    // Законны: сравнения (`run.status === 'failed'`), индексация таблицы
    // подписей (`LABELS[run.status]`) и значение атрибута (`data-status={…}`) —
    // последнее отсекает `=` в lookbehind.
    const printed = [...code.matchAll(/(?<![\w$\].=])\{\s*([\w.?]*\bstatus)\s*\}/g)].map((match) => match[1])
    expect(printed, 'статус выводится в разметку без подписи').toEqual([])
  })

  it.each(FILES)('%s не содержит английский статус в русском литерале', (file) => {
    const code = source(file)
    // Строковые литералы разметки: 'Статус: running' и подобное.
    const offenders: string[] = []
    for (const match of code.matchAll(/>([^<>{}]*[А-Яа-яЁё][^<>{}]*)</g)) {
      const text = match[1]!
      for (const raw of RAW_STATUSES) {
        if (new RegExp(`\\b${raw}\\b`).test(text)) offenders.push(`${raw}: ${text.trim().slice(0, 60)}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
