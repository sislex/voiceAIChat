// Обрезка логов исторических QA-попыток. Полный лог у каждой попытки складывался
// в многомегабайтный ответ состояния задачи: вкладка вставала, сервер выедал heap
// и уходил в цикл рестартов (прод, 2026-09-05, CHAT-412).

import { describe, it, expect } from 'vitest'
import { trimHistoricalRunLogs, QA_STATE_LOG_TAIL_CHARS } from './qaStateLogs.js'

const run = (id: string, log: string) => ({ id, log })

describe('логи QA-ранов в состоянии задачи', () => {
  it('активную и последнюю попытку отдаёт целиком, остальным оставляет хвост', () => {
    const long = 'x'.repeat(QA_STATE_LOG_TAIL_CHARS + 500) + 'КОНЕЦ'
    const result = trimHistoricalRunLogs([run('active', long), run('latest', long), run('old', long)], ['active', 'latest'])
    expect(result[0]!.log).toBe(long)
    expect(result[1]!.log).toBe(long)
    expect(result[2]!.log.length).toBe(QA_STATE_LOG_TAIL_CHARS)
    // Хвост, а не начало: интересен конец лога.
    expect(result[2]!.log.endsWith('КОНЕЦ')).toBe(true)
  })

  it('пустые идентификаторы не превращаются в «сохранить всё»', () => {
    const long = 'y'.repeat(10_000)
    const result = trimHistoricalRunLogs([run('a', long)], [null, undefined], 100)
    expect(result[0]!.log.length).toBe(100)
  })

  it('короткий лог не растёт и не портится', () => {
    const result = trimHistoricalRunLogs([run('a', 'коротко')], [], 100)
    expect(result[0]!.log).toBe('коротко')
  })
})
