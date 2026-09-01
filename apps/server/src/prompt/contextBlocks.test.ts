import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '@voicechat/shared'
import type { ChatInstruction, UserPersonalization } from '@voicechat/shared'
import { effectiveChatInstructions } from '@voicechat/shared'
import { agentsChainDirs, ageFromBirth, buildContextBlocks, promptCostUsd, personalizationLines, personalizationPromptBlock, projectContextBlock, taskContextBlock } from './contextBlocks.js'

const empty: UserPersonalization = DEFAULT_SETTINGS.personalization

describe('contextBlocks — блоки промпта общие у хода и у снимка', () => {
  it('пустая персонализация не даёт блока: в промпт нечего добавлять', () => {
    expect(personalizationLines(empty, new Date('2026-08-31T00:00:00Z'))).toEqual([])
    expect(personalizationPromptBlock(empty, new Date('2026-08-31T00:00:00Z'))).toBeNull()
  })

  it('возраст считается из даты рождения, а не показывается годом', () => {
    // Панель раньше печатала «Дата рождения 01.09.1990», хотя модель получала
    // возраст. Инспектор обещает «вот что получит ИИ» — расхождение недопустимо.
    const p: UserPersonalization = { ...empty, birthYear: 1990, birthMonth: 9, birthDay: 1 }
    expect(ageFromBirth(p, new Date('2026-08-31T00:00:00Z'))).toBe(35)
    expect(ageFromBirth(p, new Date('2026-09-01T00:00:00Z'))).toBe(36)
    expect(personalizationLines(p, new Date('2026-08-31T00:00:00Z'))).toEqual([
      'Возраст пользователя: 35 лет; адаптируй сложность только когда это уместно.'
    ])
  })

  it('стиль и тон по умолчанию молчат, заданные — попадают в текст', () => {
    const p: UserPersonalization = { ...empty, preferredName: 'Алексей', responseStyle: 'brief', tone: 'business', responseLanguage: 'русский' }
    expect(personalizationLines(p, new Date())).toEqual([
      'Обращение к пользователю: Алексей.',
      'Обычный язык ответа: русский; явная просьба в текущем сообщении имеет приоритет.',
      'Стиль ответа: кратко.',
      'Тон общения: деловой.'
    ])
  })

  it('недоступный проект даёт тот же текст, что и ход модели', () => {
    expect(projectContextBlock(null, null)).toBeNull()
    expect(projectContextBlock(null, 'p-1')).toBe(
      '## Контекст проекта «неизвестный проект»\nID проекта: p-1\nПроект больше недоступен этому пользователю.'
    )
  })

  it('блоки идут в порядке сборки промпта и знают свой размер', () => {
    const instructions: ChatInstruction[] = [
      { id: 'own', title: 'Своя', description: '', enabled: true, text: 'Всегда отвечай по-русски.' }
    ]
    const blocks = buildContextBlocks({
      personalization: { ...empty, preferredName: 'Алексей' },
      instructions: effectiveChatInstructions(instructions),
      project: null,
      projectId: null,
      now: new Date()
    })
    expect(blocks.map((block) => block.itemIds)).toEqual([['personalization'], ['instruction-own']])
    expect(blocks[1]?.text).toBe('Всегда отвечай по-русски.')
    expect(blocks[1]?.chars).toBe('Всегда отвечай по-русски.'.length)
    expect(blocks[1]?.approxTokens).toBe(Math.ceil('Всегда отвечай по-русски.'.length / 4))
  })

  it('склеенная подсказка консоль+проводник принадлежит обоим пунктам', () => {
    // Стандартные «терминал» и «проводник» без правок дают модели один текст.
    // Инспектор привязывал блок по индексу и на склейке не находил ничего —
    // человек проваливался в пункт и не видел, какой текст за ним стоит.
    const instructions = effectiveChatInstructions(DEFAULT_SETTINGS.chatInstructions)
    const blocks = buildContextBlocks({ personalization: empty, instructions, project: null, projectId: null, now: new Date() })
    const merged = blocks.find((block) => block.itemIds.length > 1)
    expect(merged?.itemIds).toEqual(['instruction-console', 'instruction-explorer'])
    // Правка одной из них разрывает склейку: у каждой снова свой текст.
    const edited = instructions.map((item) => item.kind === 'console' ? { ...item, text: 'Свой текст про терминал.' } : item)
    const split = buildContextBlocks({ personalization: empty, instructions: edited, project: null, projectId: null, now: new Date() })
    expect(split.every((block) => block.itemIds.length === 1)).toBe(true)
    expect(split.find((block) => block.itemIds[0] === 'instruction-console')?.text).toBe('Свой текст про терминал.')
  })

  it('каталоги AGENTS.md идут от корня к рабочей директории', () => {
    // Порядок важен: CLI применяет цепочку «от общей к конкретной», и панель
    // обязана показывать её в том же порядке, иначе читается наоборот.
    expect(agentsChainDirs('/Users/alex/work/project')).toEqual([
      '/', '/Users', '/Users/alex', '/Users/alex/work', '/Users/alex/work/project'
    ])
    // Хвостовой слэш не создаёт лишнего уровня.
    expect(agentsChainDirs('/srv/app/')).toEqual(['/', '/srv', '/srv/app'])
  })

  it('выключенная в этом чате инструкция в блоки не попадает', () => {
    const instructions: ChatInstruction[] = [
      { id: 'own', title: 'Своя', description: '', enabled: true, text: 'Текст.' },
      { id: 'off', title: 'Выключенная', description: '', enabled: true, text: 'Не должно попасть.' }
    ]
    const blocks = buildContextBlocks({
      personalization: empty,
      instructions: effectiveChatInstructions(instructions, ['instruction-off']),
      project: null,
      projectId: null,
      now: new Date()
    })
    expect(blocks.map((block) => block.text)).toEqual(['Текст.'])
  })
  it('стоимость постоянной части: известная модель, тариф из таблицы, иначе null', () => {
    // Модель Claude знает общий прайс — цена берётся оттуда.
    const sonnet = promptCostUsd('claude', 'sonnet', 1000, [])
    expect(sonnet).not.toBeNull()
    expect(sonnet!).toBeGreaterThan(0)

    // Общий прайс знает и часть моделей Codex, поэтому «своя» модель для
    // проверки таблицы берётся такая, которой в нём заведомо нет.
    const price = {
      provider: 'codex', model: 'внутренняя-модель', inputPerMillion: 2, cachedInputPerMillion: 1,
      cacheWritePerMillion: 1, outputPerMillion: 8, sourceUrl: '', effectiveAt: 0, updatedAt: 0
    }
    expect(promptCostUsd('codex', 'внутренняя-модель', 1_000_000, [price])).toBeCloseTo(2, 6)
    // Модель Codex из общего прайса тоже считается — без таблицы.
    expect(promptCostUsd('codex', 'gpt-5.6-luna', 1_000_000, [])).not.toBeNull()

    // Ни там, ни там — null: «—» честнее выдуманной суммы.
    expect(promptCostUsd('codex', 'неизвестная-модель', 1000, [price])).toBeNull()
    // Пустая модель (codex берёт её из своего config.toml) и нулевые токены — тоже null.
    expect(promptCostUsd('codex', '', 1000, [price])).toBeNull()
    expect(promptCostUsd('claude', 'sonnet', 0, [])).toBeNull()
  })
})

describe('taskContextBlock', () => {
  const context = {
    task: { key: 'CHAT-1', title: 'Починить гейт' },
    epic: { key: 'EP-1', title: 'Качество' },
    story: null,
    columnName: 'В работе',
    columnSemantic: 'wip',
    agentName: 'macbook',
    workdir: '/repo',
    run: { status: 'failed', mode: 'plan' }
  }

  it('собирает те же строки, что уходят в ход, и добавляет постановку', () => {
    const text = taskContextBlock({ context, description: 'Гейт красный', acceptanceCriteria: 'Зелёный гейт', designLines: ['Макет: /d.png'] })!
    expect(text.startsWith('## Контекст задачи')).toBe(true)
    expect(text).toContain('Задача: CHAT-1 · Починить гейт')
    expect(text).toContain('Эпик: EP-1 · Качество')
    // История отсутствует — строки для неё нет вовсе, а не «История: —».
    expect(text).not.toContain('История:')
    expect(text).toContain('Этап разработки: В работе (wip)')
    expect(text).toContain('Последний CI-ран: failed, режим план')
    expect(text).toContain('Описание задачи: Гейт красный')
    expect(text).toContain('Критерии приёмки: Зелёный гейт')
    expect(text).toContain('Макет: /d.png')
  })

  it('попадает в предпросмотр отдельным блоком после проекта', () => {
    const blocks = buildContextBlocks({
      personalization: empty,
      instructions: [],
      project: null,
      projectId: null,
      taskContext: taskContextBlock({ context }),
      now: new Date(0)
    })
    const task = blocks.find((block) => block.itemIds.includes('task-context'))
    expect(task?.title).toBe('Контекст задачи')
    expect(task?.text).toContain('CHAT-1')
  })
})

describe('makeContext в предпросмотре', () => {
  it('идёт последним блоком — как в промпте хода', () => {
    const blocks = buildContextBlocks({
      personalization: empty,
      instructions: [],
      project: null,
      projectId: null,
      makeContext: '## Проект Make\nТокены: --accent: #f00',
      now: new Date(0)
    })
    expect(blocks[blocks.length - 1]).toMatchObject({ title: 'Контекст проекта Make', itemIds: ['make-context'] })
  })

  it('пустой контекст блока не даёт: в промпт нечего добавлять', () => {
    const blocks = buildContextBlocks({ personalization: empty, instructions: [], project: null, projectId: null, makeContext: '', now: new Date(0) })
    expect(blocks.some((block) => block.itemIds.includes('make-context'))).toBe(false)
  })
})
