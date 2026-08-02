// Регрессия авто-инъекции на кодовых описаниях задач.
//
// Три описания взяты из ранов, где инъекция вернула пустоту: CHAT-54 (список
// инструментов read/grep/edit и команд вроде `cat -n`), CHAT-68 (имена колонок и
// пути файлов), CHAT-70 (куски кода и строка `идет ${режим}`). Тексты лежат в
// __fixtures__/historicTasks.json дословно — переписанное описание проверяло бы
// не то, на чём инъекция молчала.
//
// Поиск идёт по настоящей docs/kb, а не по вымышленным документам: смысл
// проверки в том, что по реальному описанию находится реальная статья. Цена —
// тест может упасть после правки базы знаний; это ровно тот сигнал, ради
// которого он написан.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildKbAutoContext, KB_AUTO_CONTEXT_BUDGET } from './autoContext.js'
import { FileKnowledgeBaseService } from './service.js'
import { areaTouchesPath, kbTaskQuery } from './taskQuery.js'
import { PUBLIC_KB_VIEW } from './types.js'

interface HistoricTask {
  key: string
  title: string
  description: string
  acceptanceCriteria: string | null
}

const tasks: HistoricTask[] = JSON.parse(
  readFileSync(fileURLToPath(new URL('./__fixtures__/historicTasks.json', import.meta.url)), 'utf8')
)
const kb = new FileKnowledgeBaseService(fileURLToPath(new URL('../../../../docs/kb', import.meta.url)))

describe('авто-инъекция на кодовых описаниях задач', () => {
  it.each(tasks.map((task) => [task.key, task] as const))('%s получает непустой контекст', async (_key, task) => {
    const query = kbTaskQuery(task)
    const auto = await buildKbAutoContext(kb, query, PUBLIC_KB_VIEW)

    expect(auto.emptyReason).toBeNull()
    expect(auto.sections.length).toBeGreaterThan(0)
    expect(auto.text).toContain('## Контекст базы знаний voiceAIChat')
    expect(auto.text.length).toBeLessThanOrEqual(KB_AUTO_CONTEXT_BUDGET)
    // Осмысленность: хотя бы один выданный раздел про сервер или CI-ран, а не
    // случайная статья, которую вытянуло одно частотное слово.
    expect(auto.sections.some((section) => (section.relatedFiles ?? []).length > 0)).toBe(true)
  })

  it('CHAT-54 приводит к разделам про инструменты машины и ран', async () => {
    const task = tasks.find((item) => item.key === 'CHAT-54')!
    const auto = await buildKbAutoContext(kb, kbTaskQuery(task), PUBLIC_KB_VIEW)
    const docs = auto.sections.map((section) => section.documentId)
    expect(docs.some((id) => id === 'machines' || id === 'ci-runner' || id === 'llm')).toBe(true)
    // Упомянутые в описании пути должны быть задеты выданными разделами: именно
    // эта связь и делает контекст полезным для технической задачи.
    const paths = kbTaskQuery(task).paths
    expect(auto.sections.some((section) => (section.relatedFiles ?? []).some((area) => paths.some((path) => areaTouchesPath(area, path))))).toBe(true)
  })

  it('CHAT-68 приводит к разделу про расход CI-рана', async () => {
    const task = tasks.find((item) => item.key === 'CHAT-68')!
    const auto = await buildKbAutoContext(kb, kbTaskQuery(task), PUBLIC_KB_VIEW)
    expect(auto.sections.map((section) => section.documentId)).toContain('ci-runner')
  })

  it('CHAT-70 приводит к разделам про модели и UI, несмотря на ${…} в описании', async () => {
    const task = tasks.find((item) => item.key === 'CHAT-70')!
    const query = kbTaskQuery(task)
    expect(query.symbols).toEqual([])
    const auto = await buildKbAutoContext(kb, query, PUBLIC_KB_VIEW)
    const docs = auto.sections.map((section) => section.documentId)
    expect(docs.some((id) => id === 'llm' || id === 'ui' || id === 'clients')).toBe(true)
  })

  it('средний размер инъекции остаётся в пределах бюджета', async () => {
    const sizes = await Promise.all(tasks.map(async (task) => (await buildKbAutoContext(kb, kbTaskQuery(task), PUBLIC_KB_VIEW)).text.length))
    const average = sizes.reduce((sum, size) => sum + size, 0) / sizes.length
    expect(average).toBeLessThanOrEqual(KB_AUTO_CONTEXT_BUDGET)
    expect(Math.min(...sizes)).toBeGreaterThan(0)
  })
})
