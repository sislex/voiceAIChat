import { describe, expect, it } from 'vitest'
import { automatedQaRemarks, automatedQaStartUrlProblem, isPrivateNetworkHost, parseAutomatedQaVerdict, type AutomatedQaVerdict } from './qa'

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

describe('isPrivateNetworkHost (круг 29)', () => {
  it('правило одно на редактор и на SSRF-гейт раннера', () => {
    for (const host of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.1.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1']) {
      expect(isPrivateNetworkHost(host)).toBe(true)
    }
    // Публичные адреса и имена проходят: наш собственный стенд — голый IP.
    for (const host of ['89.125.68.35', '8.8.8.8', 'example.com', '2606:4700::1111']) {
      expect(isPrivateNetworkHost(host)).toBe(false)
    }
  })

  it('IPv6 в скобках разбирается: раньше shared про `::` не знал вовсе', () => {
    expect(isPrivateNetworkHost('[::1]')).toBe(true)
    expect(automatedQaStartUrlProblem('http://[::1]:8787/')).toContain('внутренних сетей')
  })
})

describe('ошибки страницы в вердикте', () => {
  it('разбираются и уходят в замечания: без них разработчик видит шаг, но не причину', () => {
    const parsed = parseAutomatedQaVerdict(verdict({
      mode: 'playwright', pageErrors: ['Uncaught TypeError: columns is undefined']
    }) as unknown as Record<string, unknown>)
    expect(parsed?.pageErrors).toEqual(['Uncaught TypeError: columns is undefined'])
    expect(automatedQaRemarks(parsed!)).toContain('Uncaught TypeError: columns is undefined')
  })

  it('мусор вместо списка не ломает разбор старого рана', () => {
    const parsed = parseAutomatedQaVerdict({ ...verdict(), pageErrors: [1, 'ошибка', null] } as unknown as Record<string, unknown>)
    expect(parsed?.pageErrors).toEqual(['ошибка'])
    expect(parseAutomatedQaVerdict(verdict() as unknown as Record<string, unknown>)?.pageErrors).toBeUndefined()
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

describe('automatedQaStartUrlProblem', () => {
  it('пустой адрес не ругается — человек ещё не начал вводить', () => {
    expect(automatedQaStartUrlProblem('')).toBeNull()
    expect(automatedQaStartUrlProblem('   ')).toBeNull()
  })
  it('внешний адрес проходит', () => {
    expect(automatedQaStartUrlProblem('https://example.com/#/projects/p1')).toBeNull()
  })
  it('localhost и приватные сети объясняются, а не просто отклоняются', () => {
    // Раннер живёт на сервере: SSRF-гейт validatePublicUrl режет такие адреса,
    // и до круга 10 владелец узнавал об этом только при первом прогоне.
    expect(automatedQaStartUrlProblem('http://localhost:5173')).toContain('не ходит в localhost')
    expect(automatedQaStartUrlProblem('http://127.0.0.1:8787')).toContain('внутренних сетей')
    expect(automatedQaStartUrlProblem('http://192.168.1.10')).toContain('внутренних сетей')
    expect(automatedQaStartUrlProblem('http://10.0.0.5')).toContain('внутренних сетей')
    expect(automatedQaStartUrlProblem('http://172.16.0.1')).toContain('внутренних сетей')
  })
  it('публичный адрес в том же диапазоне первых октетов не путается с приватным', () => {
    expect(automatedQaStartUrlProblem('http://172.32.0.1')).toBeNull()
    expect(automatedQaStartUrlProblem('http://11.0.0.1')).toBeNull()
  })
  it('не-http и мусор объясняются по-разному', () => {
    expect(automatedQaStartUrlProblem('file:///etc/passwd')).toContain('только адреса http')
    expect(automatedQaStartUrlProblem('просто текст')).toContain('полный адрес с протоколом')
  })
})
