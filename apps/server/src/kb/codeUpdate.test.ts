// Актуализация базы знаний по изменениям кода: разбор дифа, выбор задетых
// статей по areas, разбор ответа модели, текст промпта. Чистые функции —
// ни CLI, ни машины здесь нет.

import { describe, it, expect } from 'vitest'
import {
  areaMatchesFile, formatKbUpdateSummary, KB_UPDATE_TIMEOUT_MS, kbUpdatePrompt, parseDiffBundle, parseKbUpdateOutput, pickAffectedDocs
} from './codeUpdate.js'

describe('KB_UPDATE_TIMEOUT_MS', () => {
  it('даёт модели двадцать минут на актуализацию базы знаний', () => {
    expect(KB_UPDATE_TIMEOUT_MS).toBe(20 * 60 * 1000)
  })
})

const BUNDLE = `===FILES===
apps/server/src/ci/runManager.ts
docs/kb/features/ci-runner.md
===STAT===
 2 files changed, 40 insertions(+)
===PATCH===
diff --git a/apps/server/src/ci/runManager.ts b/apps/server/src/ci/runManager.ts
+код
`

describe('parseDiffBundle', () => {
  it('разбирает секции скрипта сбора дифа', () => {
    const changes = parseDiffBundle(BUNDLE)
    expect(changes.unavailable).toBe(false)
    expect(changes.files).toEqual(['apps/server/src/ci/runManager.ts', 'docs/kb/features/ci-runner.md'])
    expect(changes.stat).toContain('2 files changed')
    expect(changes.patch).toContain('+код')
  })

  it('без репозитория или базовой ветки диф считается недоступным', () => {
    expect(parseDiffBundle('===NOGIT===').unavailable).toBe(true)
    expect(parseDiffBundle('===NOBASE===').unavailable).toBe(true)
    expect(parseDiffBundle('').unavailable).toBe(true)
  })

  it('пустой список файлов — валидный диф без изменений', () => {
    const changes = parseDiffBundle('===FILES===\n===STAT===\n===PATCH===\n')
    expect(changes.unavailable).toBe(false)
    expect(changes.files).toEqual([])
  })
})

describe('выбор задетых статей по areas', () => {
  const docs = [
    { id: 'a', title: 'CI-раннер', areas: ['apps/server/src/ci'] },
    { id: 'b', title: 'Протокол', areas: ['packages/shared/src/protocol.ts'] },
    { id: 'c', title: 'База знаний', areas: ['apps/server/src/kb', 'docs/kb'] }
  ]

  it('каталог из areas ловит файл под ним, файл — сам себя', () => {
    expect(areaMatchesFile('apps/server/src/ci', 'apps/server/src/ci/runManager.ts')).toBe(true)
    expect(areaMatchesFile('./docs/kb/', 'docs/kb/README.md')).toBe(true)
    expect(areaMatchesFile('packages/shared/src/protocol.ts', 'packages/shared/src/protocol.ts')).toBe(true)
    expect(areaMatchesFile('apps/server/src/ci', 'apps/server/src/kb/service.ts')).toBe(false)
  })

  it('статья без пересечения не выбирается, самая задетая идёт первой', () => {
    const picked = pickAffectedDocs(['apps/server/src/kb/codeUpdate.ts', 'docs/kb/kb-workflow.md', 'apps/server/src/ci/runManager.ts'], docs)
    expect(picked.map((d) => d.id)).toEqual(['c', 'a'])
  })

  it('число статей капается', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, title: `T${i}`, areas: ['src'] }))
    expect(pickAffectedDocs(['src/index.ts'], many, 3)).toHaveLength(3)
  })
})

describe('parseKbUpdateOutput', () => {
  const document = {
    id: '',
    title: 'CI',
    kind: 'subsystem',
    tags: ['ci'],
    areas: ['apps/server/src/ci'],
    body: '# CI'
  }
  const reply = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
    note: 'обновил',
    nothingToUpdate: false,
    topics: ['ci-runner'],
    documents: [document],
    ...overrides
  })

  it('разбирает чистый JSON полного контракта', () => {
    const out = parseKbUpdateOutput(reply())
    expect(out).toMatchObject({ note: 'обновил', nothingToUpdate: false, topics: ['ci-runner'] })
    expect(out.documents).toHaveLength(1)
  })

  it('разбирает фактический ответ merge-рана: отчёт перед единственным json fence и хвост после него', () => {
    const out = parseKbUpdateOutput(`Файловые темы обновлены, проверка вернула { ok: true }.
\`\`\`json
${reply()}
\`\`\`
Готово.`)
    expect(out.documents[0]?.title).toBe('CI')
  })

  it('разбирает единственный fence без метки, если внутри объект ожидаемого формата', () => {
    expect(parseKbUpdateOutput(`Отчёт
\`\`\`
${reply()}
\`\`\``).topics).toEqual(['ci-runner'])
  })

  it('отклоняет несколько JSON-кандидатов как неоднозначный ответ', () => {
    expect(() => parseKbUpdateOutput(`\`\`\`json
${reply()}
\`\`\`
\`\`\`json
${reply({ note: 'второй' })}
\`\`\``)).toThrow(/несколько JSON-кандидатов/)
  })

  it('различает отсутствие JSON и синтаксически повреждённый JSON', () => {
    expect(() => parseKbUpdateOutput('совсем не json')).toThrow(/JSON не найден/)
    expect(() => parseKbUpdateOutput('Перед ответом\n```json\n{"note":\n```')).toThrow(/синтаксически повреждён/)
  })

  it('валидирует обязательные поля корня и типы topics', () => {
    expect(() => parseKbUpdateOutput(JSON.stringify({ nothingToUpdate: false, topics: [], documents: [] }))).toThrow(/поле note/)
    expect(() => parseKbUpdateOutput(reply({ topics: ['ci-runner', 1] }))).toThrow(/topics/)
  })

  it('отклоняет nothingToUpdate=true при наличии documents', () => {
    expect(() => parseKbUpdateOutput(reply({ nothingToUpdate: true }))).toThrow(/nothingToUpdate=true.*documents/)
  })

  it.each([
    ['id', { ...document, id: 1 }],
    ['title', { ...document, title: '' }],
    ['kind', { ...document, kind: 'dangerous' }],
    ['tags', { ...document, tags: ['ci', 1] }],
    ['areas', { ...document, areas: 'apps/server' }],
    ['body', { ...document, body: '' }]
  ])('отклоняет документ с невалидным обязательным полем %s', (field, invalid) => {
    expect(() => parseKbUpdateOutput(reply({ documents: [document, invalid] }))).toThrow(new RegExp(`documents\\[1\\].*${field}`))
  })

  it('ничего не обновляет только по явному согласованному флагу', () => {
    const out = parseKbUpdateOutput(reply({ nothingToUpdate: true, topics: [], documents: [] }))
    expect(out.nothingToUpdate).toBe(true)
  })
})

describe('kbUpdatePrompt', () => {
  const changes = parseDiffBundle(BUNDLE)

  it('в режиме шага рана требует править темы репозитория и не коммитить', () => {
    const prompt = kbUpdatePrompt({
      projectName: 'ChatAI',
      workdir: '/repos/chatai/44/slug',
      taskTitle: 'Новый шаг',
      baseLabel: 'базовая ветка main',
      changes,
      affected: [{ id: 'doc-1', title: 'CI-раннер', areas: ['apps/server/src/ci'] }],
      editFileTopics: true
    })
    expect(prompt).toContain('docs/kb/*.md')
    expect(prompt).toContain('node scripts/kb.mjs touch')
    expect(prompt).toContain('npm run kb:index')
    expect(prompt).toContain('НЕ коммить')
    expect(prompt).toContain('doc-1 · CI-раннер')
    expect(prompt).toContain('apps/server/src/ci/runManager.ts')
    expect(prompt).toContain('ровно один JSON-объект')
    expect(prompt).toContain('Не добавляй markdown fences')
    expect(prompt).toContain('любые символы до/после JSON')
  })

  it('пробелы базы знаний идут в промпт: с найденным ответом и без него', () => {
    const prompt = kbUpdatePrompt({
      projectName: 'ChatAI',
      workdir: '/repos/chatai/80/slug',
      baseLabel: 'базовая ветка main',
      changes,
      affected: [],
      editFileTopics: true,
      gaps: [
        { question: 'где живёт fix-loop', answer: 'хук attemptFix в ci/modelHooks.ts', topic: 'ci-runner' },
        { question: 'формат блока kb-gaps', reason: 'в базе знаний ничего не нашлось' }
      ]
    })
    expect(prompt).toContain('Пробелы базы знаний в этом ране (2)')
    expect(prompt).toContain('выяснено: хук attemptFix в ci/modelHooks.ts')
    expect(prompt).toContain('куда писать по мнению модели: ci-runner')
    // Ответа нет — шаг обязан найти его в коде, а не переписать вопрос в статью.
    expect(prompt).toContain('в базе знаний ничего не нашлось')
    expect(prompt).toContain('найди его в коде')
    // Три требования: правка раздела, сверка с кодом, запрет догадок.
    expect(prompt).toContain('ДОПОЛНИ существующий раздел')
    expect(prompt).toContain('сверь факт')
    expect(prompt).toContain('лучше записанной догадки')
    expect(prompt).toContain('На пробелы базы знаний это исключение не распространяется')
  })

  it('без пробелов блока нет, а nothingToUpdate остаётся без оговорки', () => {
    const prompt = kbUpdatePrompt({
      projectName: 'ChatAI', workdir: '/repos', baseLabel: 'базовая ветка main', changes, affected: [], editFileTopics: true
    })
    expect(prompt).not.toContain('Пробелы базы знаний')
    expect(prompt).not.toContain('это исключение не распространяется')
  })

  it('диф собран и пуст, но пробелы есть — шаг пишет только их', () => {
    const prompt = kbUpdatePrompt({
      projectName: 'ChatAI',
      workdir: '/repos',
      baseLabel: 'базовая ветка main',
      changes: { files: [], stat: '', patch: '', unavailable: false },
      affected: [],
      editFileTopics: true,
      gaps: [{ question: 'кто снимает токен БЗ', answer: 'withKbTools во всех выходах хода' }]
    })
    expect(prompt).toContain('Изменений кода в ветке нет')
    expect(prompt).not.toContain('собери его сам')
    expect(prompt).toContain('кто снимает токен БЗ')
  })

  it('в режиме только чтения файлы трогать запрещено, диф модель собирает сама', () => {
    const prompt = kbUpdatePrompt({
      projectName: 'ChatAI',
      workdir: '/root/voiceAIChat',
      baseLabel: 'abc1234',
      changes: { files: [], stat: '', patch: '', unavailable: true },
      affected: [],
      editFileTopics: false
    })
    expect(prompt).toContain('Файлы репозитория не меняй')
    expect(prompt).toContain('git diff --stat abc1234')
    expect(prompt).not.toContain('kb:index')
  })
})

describe('formatKbUpdateSummary', () => {
  it('различает «нечего обновлять» и запись', () => {
    expect(formatKbUpdateSummary({ note: 'только тесты', nothingToUpdate: true, topics: [], documents: [] }, [])).toContain('Нечего обновлять')
    const msg = formatKbUpdateSummary({ note: '', nothingToUpdate: false, topics: ['ci-runner'], documents: [] }, [{ title: 'CI', action: 'updated' }])
    expect(msg).toContain('ci-runner')
    expect(msg).toContain('CI (обновлена)')
  })
})
