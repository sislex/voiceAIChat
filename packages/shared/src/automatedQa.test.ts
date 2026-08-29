import { describe, expect, it } from 'vitest'
import { automatedQaRemarks, parseAutomatedQaVerdict, type AutomatedQaVerdict } from './qa'

const verdict = (patch: Partial<AutomatedQaVerdict> = {}): AutomatedQaVerdict => ({
  mode: 'command', gatePassed: false, passed: false, summary: 'Команда автотестов завершилась с кодом 1',
  classification: 'implementation_defect', command: 'npm test', exitCode: 1, durationMs: 1000,
  logTail: 'FAIL src/a.test.ts', steps: [], screenshotUrl: null, ...patch
})

describe('parseAutomatedQaVerdict', () => {
  it('читает вердикт нового формата', () => {
    expect(parseAutomatedQaVerdict(verdict() as unknown as Record<string, unknown>)).toMatchObject({ mode: 'command', exitCode: 1 })
  })
  it('старый результат `{gatePassed}` вердиктом не считается', () => {
    // Раны до этого круга хранили в result только флаг гейта: панель обязана
    // показать их как есть, а не рисовать пустой блок вердикта.
    expect(parseAutomatedQaVerdict({ gatePassed: true })).toBeNull()
    expect(parseAutomatedQaVerdict(null)).toBeNull()
  })
  it('неизвестный режим отбрасывается', () => {
    expect(parseAutomatedQaVerdict({ mode: 'cypress', summary: 'что-то' })).toBeNull()
  })
})

describe('automatedQaRemarks', () => {
  it('в замечания уходит команда, код и хвост вывода', () => {
    const text = automatedQaRemarks(verdict())
    expect(text).toContain('npm test')
    expect(text).toContain('Код выхода: 1')
    expect(text).toContain('FAIL src/a.test.ts')
  })
  it('для сценария перечисляются только провалившиеся шаги', () => {
    const text = automatedQaRemarks(verdict({
      mode: 'playwright', command: 'http://localhost:5173', logTail: '',
      steps: [
        { id: 's1', title: 'Открыть доску', status: 'passed', detail: '', durationMs: 10 },
        { id: 's2', title: 'Создать задачу', status: 'failed', detail: 'локатор не найден', durationMs: 20 }
      ]
    }))
    expect(text).toContain('- Создать задачу: локатор не найден')
    expect(text).not.toContain('Открыть доску')
  })
})
