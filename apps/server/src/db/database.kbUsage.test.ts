// Телеметрия обращений к базе знаний: монотонность курсора, агрегаты, изоляция.
// Главная ловушка проверяется отдельно: totals.chars НЕ должен размножаться по
// числу разделов обращения (для этого итоги считаются запросом без JOIN).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VoiceChatDb } from './database'

const U = 'admin'

function makeDb(): VoiceChatDb {
  let idCounter = 0
  let clock = 1_000
  return new VoiceChatDb(':memory:', { newId: () => `id-${++idCounter}`, now: () => (clock += 10) })
}

/** Обращение с двумя разделами: 300 + 200 символов текста, отданного модели. */
function twoSections(): Array<{ documentId: string; title: string; heading: string; anchor: string; sourcePath: string; chars: number }> {
  return [
    { documentId: 'protocol', title: 'Протокол', heading: 'WebSocket', anchor: 'websocket', sourcePath: 'docs/kb/protocol.md', chars: 300 },
    { documentId: 'llm', title: 'LLM', heading: 'Ходы', anchor: 'hody', sourcePath: 'docs/kb/llm.md', chars: 200 }
  ]
}

describe('VoiceChatDb — обращения к базе знаний', () => {
  let db: VoiceChatDb
  beforeEach(() => { db = makeDb() })
  afterEach(() => db.close())

  it('seq монотонен внутри разговора и не мешает соседнему чату', () => {
    const a = db.createConversation(U, 'A')
    const b = db.createConversation(U, 'B')
    const first = db.addKbUsage({ userId: U, conversationId: a.id, source: 'auto', query: 'q1', chars: 10 })
    const second = db.addKbUsage({ userId: U, conversationId: a.id, source: 'tool_search', query: 'q2', chars: 20 })
    const other = db.addKbUsage({ userId: U, conversationId: b.id, source: 'auto', query: 'q3', chars: 30 })
    expect([first.seq, second.seq]).toEqual([1, 2])
    expect(other.seq).toBe(1)
    expect(db.kbUsageReport(U, a.id)!.lastSeq).toBe(2)
  })

  it('totals.chars не дублируется при нескольких разделах одного обращения', () => {
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', query: 'ходы', chars: 500, injected: true, sections: twoSections() })
    const report = db.kbUsageReport(U, conv.id)!
    expect(report.totals.queries).toBe(1)
    expect(report.totals.chars).toBe(500) // а не 500 × 2 разделa
    expect(report.totals.estimatedTokens).toBe(125) // ceil(500/4)
    expect(report.totals.sections).toBe(2)
    expect(report.totals.documents).toBe(2)
  })

  it('агрегат группируется по documentId + anchor и различает источник', () => {
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', query: 'ходы', chars: 300, sections: [twoSections()[0]] })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'tool_document', query: 'ходы', chars: 300, sections: [twoSections()[0]] })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'tool_search', query: 'llm', chars: 200, sections: [twoSections()[1]] })
    const sections = db.kbUsageReport(U, conv.id)!.sections
    expect(sections).toHaveLength(2)
    const top = sections[0]
    expect(top).toMatchObject({ documentId: 'protocol', anchor: 'websocket', times: 2, autoTimes: 1, chars: 600 })
    expect(top.estimatedTokens).toBe(150) // 75 + 75
    expect(db.kbUsageReport(U, conv.id)!.totals.toolQueries).toBe(2)
  })

  it('attachKbUsageTurn дописывает итоги хода во все обращения этого хода', () => {
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', turnId: 't1', query: 'a', chars: 100 })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'tool_search', turnId: 't1', query: 'b', chars: 50 })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', turnId: 't2', query: 'c', chars: 40 })
    expect(db.attachKbUsageTurn({ turnId: 't1', messageId: 'm1', promptChars: 4000, turnInputTokens: 1200 })).toBe(2)
    const report = db.kbUsageReport(U, conv.id)!
    const t1 = report.recent.filter((q) => q.turnId === 't1')
    expect(t1.map((q) => q.messageId)).toEqual(['m1', 'm1'])
    expect(t1.every((q) => q.promptChars === 4000 && q.turnInputTokens === 1200)).toBe(true)
    // Промпт одного хода общий для его обращений — в итогах он учтён один раз.
    expect(report.totals.promptChars).toBe(4000)
  })

  it('удаление разговора уносит обращения и их разделы (каскад)', () => {
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', query: 'q', chars: 100, sections: twoSections() })
    db.deleteConversation(U, conv.id)
    expect(db.kbUsageReport(U, conv.id)).toBeNull()
  })

  it('чужой чат не отдаёт отчёт (изоляция по владельцу)', () => {
    db.createUser('bob', 'x', 'developer')
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', query: 'q', chars: 10 })
    expect(db.kbUsageReport('bob', conv.id)).toBeNull()
  })

  it('проектный агрегат виден участнику и считает чаты, а не участнику — null', () => {
    db.createUser('alice', 'x', 'developer')
    db.createUser('bob', 'x', 'developer')
    const project = db.createProject('alice', { name: 'P' })
    const a = db.createConversation('alice', 'A')
    const b = db.createConversation('alice', 'B')
    db.addKbUsage({ userId: 'alice', conversationId: a.id, projectId: project.id, source: 'auto', query: 'q', chars: 300, sections: [twoSections()[0]] })
    db.addKbUsage({ userId: 'alice', conversationId: b.id, projectId: project.id, source: 'tool_search', query: 'q', chars: 300, sections: [twoSections()[0]] })
    const report = db.kbUsageProjectReport('alice', project.id)!
    expect(report.totals.queries).toBe(2)
    expect(report.totals.chars).toBe(600)
    expect(report.sections[0]).toMatchObject({ documentId: 'protocol', times: 2, conversations: 2 })
    expect(report.conversations.map((c) => c.conversationId).sort()).toEqual([a.id, b.id].sort())
    expect(db.kbUsageProjectReport('bob', project.id)).toBeNull()
  })

  it('статусы empty/error попадают в итоги и не считаются доставленными', () => {
    const conv = db.createConversation(U, 'Чат')
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', status: 'empty', query: 'q', chars: 0 })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', status: 'error', query: 'q', chars: 0, error: 'kb упала' })
    db.addKbUsage({ userId: U, conversationId: conv.id, source: 'auto', query: 'q', chars: 10, injected: true })
    const totals = db.kbUsageReport(U, conv.id)!.totals
    expect(totals).toMatchObject({ queries: 3, delivered: 1, empty: 1, errors: 1 })
    expect(db.kbUsageReport(U, conv.id)!.recent[0].status).toBe('delivered')
  })
})

// Привязка обращений к CI-рану: отчёт по ране (лента) и по всем ранам задачи
// (модалка). Гейт у обоих — членство в проекте, поэтому чужому здесь null.
describe('VoiceChatDb — обращения к БЗ внутри CI-рана', () => {
  let db: VoiceChatDb
  beforeEach(() => {
    db = makeDb()
    db.createUser('alice', 'x', 'developer')
    db.createUser('bob', 'x', 'developer')
  })
  afterEach(() => db.close())

  /** Проект с задачей и двумя ранами по ней (у второго — свой чат). */
  function runs() {
    const project = db.createProject('alice', { name: 'P' })
    const board = db.getBoard('alice', project.id)!
    const task = db.createTask('alice', project.id, { title: 'T', columnId: board.columns[0].id })!
    const other = db.createTask('alice', project.id, { title: 'T2', columnId: board.columns[0].id })!
    const conv = db.createConversation('alice', 'Чат задачи')
    const mk = (taskId: string) => db.createCiRun({
      projectId: project.id, taskId, agentId: null, triggeredBy: 'alice', prevColumnId: null,
      conversationId: conv.id, slotProgress: { done: 0, total: 2, phase: 'В очереди' }
    })
    return { project, task, other, conv, first: mk(task.id), second: mk(task.id), foreign: mk(other.id) }
  }

  it('ci_run_id и ci_step_id сохраняются и возвращаются в обращении', () => {
    const { project, conv, first } = runs()
    const saved = db.addKbUsage({
      userId: 'alice', conversationId: conv.id, projectId: project.id, ciRunId: first.id, ciStepId: 'step-7',
      source: 'tool_search', query: 'ходы', chars: 300, sections: [twoSections()[0]]
    })
    expect(saved).toMatchObject({ ciRunId: first.id, ciStepId: 'step-7' })
    expect(db.kbUsageReport('alice', conv.id)!.recent[0]).toMatchObject({ ciRunId: first.id, ciStepId: 'step-7' })
  })

  it('режим БЗ рана — снимок настройки проекта на старте', () => {
    const project = db.createProject('alice', { name: 'P' })
    db.updateProject('alice', project.id, { ciKbContextMode: 'manual' })
    expect(db.getProject('alice', project.id)!.ciKbContextMode).toBe('manual')
    const board = db.getBoard('alice', project.id)!
    const task = db.createTask('alice', project.id, { title: 'T', columnId: board.columns[0].id })!
    const run = db.createCiRun({
      projectId: project.id, taskId: task.id, agentId: null, triggeredBy: 'alice', prevColumnId: null,
      kbContextMode: 'manual', slotProgress: { done: 0, total: 2, phase: 'В очереди' }
    })
    expect(run.kbContextMode).toBe('manual')
    // Смена настройки не переписывает уже созданный ран.
    db.updateProject('alice', project.id, { ciKbContextMode: 'off' })
    expect(db.getCiRunRaw(run.id)!.kbContextMode).toBe('manual')
  })

  it('отчёт по ране считает только его обращения', () => {
    const { project, conv, first, second } = runs()
    db.addKbUsage({ userId: 'alice', conversationId: conv.id, projectId: project.id, ciRunId: first.id, source: 'auto', query: 'q', chars: 300, sections: [twoSections()[0]] })
    db.addKbUsage({ userId: 'alice', conversationId: conv.id, projectId: project.id, ciRunId: first.id, source: 'tool_document', query: 'q', chars: 200, sections: [twoSections()[1]] })
    db.addKbUsage({ userId: 'alice', conversationId: conv.id, projectId: project.id, ciRunId: second.id, source: 'tool_search', query: 'q', chars: 100, sections: [twoSections()[0]] })
    // Обращение самого чата (без рана) в отчёт рана не попадает.
    db.addKbUsage({ userId: 'alice', conversationId: conv.id, projectId: project.id, source: 'auto', query: 'q', chars: 999 })

    const report = db.kbUsageRunReport('alice', first.id)!
    expect(report).toMatchObject({ runId: first.id, taskId: first.taskId, kbContextMode: 'auto', conversationId: conv.id })
    expect(report.totals).toMatchObject({ queries: 2, chars: 500, documents: 2, toolQueries: 1 })
    expect(report.recent).toHaveLength(2)
    expect(report.sections.map((s) => s.documentId).sort()).toEqual(['llm', 'protocol'])
  })

  it('отчёт по задаче суммирует все её раны и не берёт чужую задачу', () => {
    const { project, task, conv, first, second, foreign } = runs()
    db.addKbUsage({ userId: 'alice', conversationId: conv.id, projectId: project.id, ciRunId: first.id, source: 'auto', query: 'q', chars: 300, sections: [twoSections()[0]] })
    db.addKbUsage({ userId: 'alice', conversationId: conv.id, projectId: project.id, ciRunId: second.id, source: 'tool_search', query: 'q', chars: 200, sections: [twoSections()[0]] })
    db.addKbUsage({ userId: 'alice', conversationId: conv.id, projectId: project.id, ciRunId: foreign.id, source: 'auto', query: 'q', chars: 700, sections: [twoSections()[1]] })

    const report = db.kbUsageTaskReport('alice', project.id, task.id)!
    expect(report.runs).toBe(2)
    expect(report.totals).toMatchObject({ queries: 2, chars: 500, documents: 1 })
    expect(report.sections[0]).toMatchObject({ documentId: 'protocol', times: 2, autoTimes: 1 })
  })

  // Пробелы базы знаний: то, о чём модель сообщила сама (`kb-gaps`), и вопросы,
  // на которые база не ответила вовсе. Оба списка читает шаг актуализации.
  it('вопросы без ответа попадают в пробелы рана, отвеченные — нет', () => {
    const { project, conv, first, second } = runs()
    const usage = (query: string, status: 'empty' | 'error' | 'delivered', error?: string) => db.addKbUsage({
      userId: 'alice', conversationId: conv.id, projectId: project.id, ciRunId: first.id, source: 'tool_search',
      query, status, chars: status === 'delivered' ? 200 : 0, ...(error ? { error } : {})
    })
    usage('где живёт fix-loop', 'empty', 'в базе знаний ничего не нашлось')
    usage('где живёт fix-loop', 'empty', 'в базе знаний ничего не нашлось')
    usage('индекс сломан', 'error', 'индекс недоступен')
    usage('модель в цикле', 'delivered')
    // Тот же вопрос со второй попытки ответ дал — это не пробел.
    usage('токен хода', 'empty')
    usage('токен хода', 'delivered')
    // Обращение другого рана в этот список не лезет.
    db.addKbUsage({ userId: 'alice', conversationId: conv.id, projectId: project.id, ciRunId: second.id, source: 'auto', query: 'чужой ран', status: 'empty', chars: 0 })

    const gaps = db.kbUsageRunGaps(first.id)
    expect(gaps.map((g) => g.query)).toEqual(['где живёт fix-loop', 'индекс сломан'])
    expect(gaps[0].reason).toBe('в базе знаний ничего не нашлось')
    expect(gaps[1].reason).toBe('индекс недоступен')
    // Причина пишется всегда: пустая строка в БД не должна давать пустой пункт.
    db.addKbUsage({ userId: 'alice', conversationId: conv.id, projectId: project.id, ciRunId: second.id, source: 'auto', query: 'без причины', status: 'empty', chars: 0 })
    expect(db.kbUsageRunGaps(second.id).find((g) => g.query === 'без причины')!.reason).toBe('база знаний не ответила')
  })

  it('названный моделью пробел хранится один раз, повтор берёт более полный ответ', () => {
    const { first } = runs()
    db.addCiRunKbGaps(first.id, 'step-1', [
      { question: 'где живёт fix-loop', answer: 'в ci/modelHooks.ts', topic: 'ci-runner' },
      { question: 'кто снимает токен', answer: 'withKbTools' }
    ])
    // Fix-loop называет тот же пробел снова — дубля быть не должно.
    db.addCiRunKbGaps(first.id, 'step-2', [{ question: 'где живёт fix-loop', answer: 'хук attemptFix в ci/modelHooks.ts, лимиты в настройках CI' }])
    const gaps = db.ciRunKbGaps(first.id)
    expect(gaps).toHaveLength(2)
    expect(gaps[0]).toEqual({ question: 'где живёт fix-loop', answer: 'хук attemptFix в ci/modelHooks.ts, лимиты в настройках CI', topic: 'ci-runner' })
    expect(gaps[1].topic).toBeUndefined()
    // Короткий повтор не затирает более полный ответ.
    db.addCiRunKbGaps(first.id, 'step-3', [{ question: 'где живёт fix-loop', answer: 'там же' }])
    expect(db.ciRunKbGaps(first.id)[0].answer).toContain('лимиты в настройках CI')
  })

  it('чужому пользователю отчёты по ране и задаче недоступны (404 у роута)', () => {
    const { project, task, first } = runs()
    expect(db.kbUsageRunReport('bob', first.id)).toBeNull()
    expect(db.kbUsageTaskReport('bob', project.id, task.id)).toBeNull()
    // Несуществующие ран/задача — тоже null, а не пустой отчёт.
    expect(db.kbUsageRunReport('alice', 'нет-такого')).toBeNull()
    expect(db.kbUsageTaskReport('alice', project.id, 'нет-такой')).toBeNull()
  })
})
