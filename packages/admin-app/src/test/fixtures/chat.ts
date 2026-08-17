// Фикстуры чата: сообщения, активность хода, мета запроса, живые сегменты и
// образцы markdown. Правила те же, что у канбана (`components/kanban/fixtures.ts`):
// готовые синхронные объекты, никакой связи с `fakeApi`, все поля — типами
// `@shared`, поэтому расхождение фикстуры с протоколом ловит `tsc`, а не человек
// глазами на прод-скриншоте.
//
// Один источник правды для `*.dom.test.tsx` и сториз: состояние, которое раньше
// приходилось воспроизводить живым ходом модели (стрим, действия, прерванный
// ответ, картинка), теперь описывается объектом.

import type { ClaudeLogEntry, Message, TurnMeta, TurnUsage } from '@shared/types'
import type { TaskChatContext } from '@shared/projects'
import type { UploadInfo } from '@shared/ipc'
import { imageBlock } from '@shared/images'
import { toolBlock } from '@shared/tools'
import { formatQuestionsBlock } from '@shared/questions'
import type { LiveSegment } from '../../lib/view'

/** Единая точка отсчёта времени: фикстуры не зависят от «сейчас». */
export const T0 = 1_700_000_000_000

let seq = 0

/** Одна запись активности хода (по умолчанию — вызов инструмента). */
export function makeActivity(over: Partial<ClaudeLogEntry> = {}): ClaudeLogEntry {
  seq += 1
  return {
    kind: 'tool_use',
    summary: `Bash: команда ${seq}`,
    raw: `{"type":"assistant","n":${seq}}`,
    ...over
  }
}

/**
 * Три записи «как в консоли» БЕЗ смещений `at` — так выглядит активность старых
 * сообщений: чередовать её с абзацами нельзя, вид откатывается к `MessageActivity`.
 */
export const ACTIVITY_LEGACY: ClaudeLogEntry[] = [
  { kind: 'system', summary: 'model=opus · mode=default', raw: '{"type":"system"}' },
  { kind: 'tool_use', summary: 'Bash: ls -la', detail: 'ls -la', raw: '{"type":"assistant"}' },
  { kind: 'result', summary: 'Готово', raw: '{"type":"result"}' }
]

/**
 * Активность со смещениями и метками времени — её `MessageTimeline` чередует с
 * абзацами текста (`TEXT_WITH_ACTIVITY` рассчитан на эти смещения).
 */
export const ACTIVITY_INTERLEAVED: ClaudeLogEntry[] = [
  { kind: 'thinking', summary: 'Планирую правку', detail: 'Сначала посмотрю тесты', raw: '{"type":"thinking"}', at: 42, ts: T0 + 1_000 },
  { kind: 'tool_use', summary: 'Read: src/store/voiceStore.ts', detail: 'offset=1 limit=200', raw: '{"type":"assistant","tool":"Read"}', at: 42, ts: T0 + 2_500 },
  { kind: 'tool_result', summary: '✓ прочитано 200 строк', raw: '{"type":"user","tool_result":true}', at: 42, ts: T0 + 4_000 },
  { kind: 'tool_use', summary: 'Bash: npm run -w @voicechat/ui test', detail: 'npm run -w @voicechat/ui test', raw: '{"type":"assistant","tool":"Bash"}', at: 150, ts: T0 + 9_000 },
  { kind: 'tool_result', summary: '✓ 412 тестов прошли', detail: 'Test Files 61 passed', raw: '{"type":"user","tool_result":true}', at: 150, ts: T0 + 41_000 },
  { kind: 'result', summary: 'Готово: 2 файла изменено', raw: '{"type":"result","subtype":"success"}', at: 150, ts: T0 + 42_000 }
]

/** Текст ответа под `ACTIVITY_INTERLEAVED`: смещения 42 и 150 попадают на границы абзацев. */
export const TEXT_WITH_ACTIVITY = [
  'Разобрался: состояние гасилось до отправки кадра.',
  '',
  'Поправил переход в `voiceStore` и прогнал тесты пакета — красных нет.',
  '',
  'Осталось решить, показывать ли пользователю причину обрыва.'
].join('\n')

/** Живая активность незавершённого хода: последнее действие ещё без результата. */
export const ACTIVITY_LIVE: ClaudeLogEntry[] = [
  { kind: 'tool_use', summary: 'Grep: statusLine', raw: '{"type":"assistant"}', at: 0, ts: T0 + 500 },
  { kind: 'tool_result', summary: '✓ 3 совпадения', raw: '{"type":"user"}', at: 0, ts: T0 + 1_200 },
  { kind: 'tool_use', summary: 'Bash: npm run -w @voicechat/ui typecheck', raw: '{"type":"assistant"}', at: 0, ts: T0 + 2_000 }
]

/** Счётчики токенов (живые и финальные — тип один). */
export function makeUsage(over: Partial<TurnUsage> = {}): TurnUsage {
  return { inputTokens: 12_400, outputTokens: 356, cacheReadTokens: 89_100, ...over }
}

/**
 * Мета завершённого хода со всем, что показывает панель «Подробнее»: метрики,
 * параметры запроса, контекст сообщений и окружение (инструменты/навыки/MCP).
 */
export function makeTurnMeta(over: Partial<TurnMeta> = {}): TurnMeta {
  return {
    durationMs: 3400,
    numTurns: 2,
    costUsd: 0.0131,
    inputTokens: 1500,
    outputTokens: 320,
    cacheReadTokens: 900,
    model: 'sonnet',
    request: {
      provider: 'claude',
      model: 'sonnet',
      prompt: 'Как дела?',
      promptChars: 9,
      permissionMode: 'acceptEdits',
      cwd: '/repo',
      resumed: true,
      tools: ['Bash', 'Read', 'Edit'],
      slashCommands: ['review'],
      mcpServers: ['remote'],
      messages: [
        { role: 'u1', text: 'Первый вопрос' },
        { role: 'ai', text: 'Первый ответ' },
        { role: 'u1', text: 'Как дела?' }
      ]
    },
    ...over
  }
}

/** Реплика пользователя. */
export function makeUserMessage(over: Partial<Message> = {}): Message {
  seq += 1
  return {
    id: `u-${seq}`,
    conversationId: 'c',
    role: 'u1',
    text: 'Вопрос',
    time: '10:00',
    createdAt: T0 + seq * 1000,
    ...over
  }
}

/** Ответ модели (движок запечён в сообщение — подпись не меняется от настроек). */
export function makeAiMessage(over: Partial<Message> = {}): Message {
  seq += 1
  return {
    id: `a-${seq}`,
    conversationId: 'c',
    role: 'ai',
    engine: 'claude',
    text: 'Ответ',
    time: '10:01',
    createdAt: T0 + seq * 1000,
    ...over
  }
}

/** Минимальная лента: вопрос и ответ с markdown-разметкой. */
export function makeChatPair(): Message[] {
  return [
    makeUserMessage({ id: 'u1', text: 'Вопрос' }),
    makeAiMessage({ id: 'a1', text: 'Ответ **жирный**' })
  ]
}

/** Ответ, к которому модель приложила картинку (блок вырезается парсером). */
export function makeImageMessage(path = '/tmp/plot.svg', caption = 'Динамика ходов за неделю'): Message {
  return makeAiMessage({
    id: 'a-img',
    text: `Построил график:\n\n${imageBlock({ path, caption })}`,
    execTarget: 'm1'
  })
}

/** Ответ, открывающий встроенную утилиту машины (консоль/проводник). */
export function makeToolMessage(kind: 'console' | 'explorer' = 'console', agentId = 'm1'): Message {
  return makeAiMessage({
    id: `a-tool-${kind}`,
    text: `Открываю ${kind === 'console' ? 'консоль' : 'проводник'}:\n\n${toolBlock({ kind, agentId })}`,
    execTarget: agentId
  })
}

/** Ответ с уточняющими вопросами: под ним рисуется форма ответов. */
export function makeQuestionsMessage(over: Partial<Message> = {}): Message {
  return makeAiMessage({
    id: 'a-q',
    text: `Уточните, прежде чем я начну:\n\n${formatQuestionsBlock([
      { q: 'Какую БД взять?', options: ['SQLite', 'Postgres'] },
      { q: 'Что покрыть тестами?', options: ['стор', 'экраны', 'протокол'], multi: true }
    ])}`,
    ...over
  })
}

/** Длинная переписка: для проверки скролла и автоскролла ленты. */
export function makeLongThread(pairs = 12): Message[] {
  return Array.from({ length: pairs }, (_, i) => [
    makeUserMessage({ id: `lu${i}`, text: `Вопрос №${i + 1}: почему падает шаг ${i + 1}?`, time: `10:${String(i * 2).padStart(2, '0')}` }),
    makeAiMessage({
      id: `la${i}`,
      text: `Ответ №${i + 1}. Шаг падал из-за кэша npm — почистил и перезапустил.`,
      time: `10:${String(i * 2 + 1).padStart(2, '0')}`,
      meta: { activity: [makeActivity({ summary: `Bash: npm ci (попытка ${i + 1})` })], durationMs: 4200 + i * 100 }
    })
  ]).flat()
}

/** Живые сегменты транскрипта (что видно во время записи с диаризацией). */
export function makeLiveSegments(): LiveSegment[] {
  return [
    { speakerId: 1, text: 'Давай посмотрим, почему упал последний ран.' },
    { speakerId: 2, text: 'Кажется, шаг с тестами не дождался сборки.' }
  ]
}

/** Прикреплённый к следующему сообщению файл. */
/** Контекст чата задачи для шапки `TaskChatHeader` (по умолчанию — ран идёт). */
export function makeTaskChatContext(over: Partial<TaskChatContext> = {}): TaskChatContext {
  return {
    conversationId: 'c1',
    projectId: 'p1',
    projectName: 'Voice Chat',
    epic: { id: 'e1', title: 'Канбан', key: 'VC-1' },
    story: { id: 's1', title: 'Карточка чата', key: 'VC-2' },
    task: { id: 't1', title: 'Свернуть панели чата', key: 'VC-3', type: 'task' },
    columnName: 'Разработка',
    columnSemantic: 'development',
    agentId: 'a1',
    agentName: 'Прод-машина',
    workdir: '/root/VoiceAIChatRepos/chatai-3',
    run: { id: 'run-1', status: 'running', mode: 'plan', startedAt: 1_000, durationMs: null },
    ...over
  }
}

export function makeUpload(over: Partial<UploadInfo> = {}): UploadInfo {
  seq += 1
  return { id: `up-${seq}`, name: `скриншот-${seq}.png`, path: `/uploads/скриншот-${seq}.png`, mimeType: 'image/png', size: 0, ...over }
}

// --- Образцы markdown -----------------------------------------------------

/** Таблица GFM: выравнивание, инлайн-код, длинная ячейка. */
export const MD_TABLE = [
  '| Шаг | Статус | Длительность | Комментарий |',
  '| --- | :----: | -----------: | --- |',
  '| `npm ci` | ✓ | 42с | из кэша |',
  '| `npm run typecheck` | ✓ | 18с | — |',
  '| `npm test` | ✕ | 3м 12с | упал `ChatColumn.dom.test.tsx`, потому что фикстура ленты разъехалась с протоколом |'
].join('\n')

/** Длинный блок кода с подсветкой (rehype-highlight определяет язык сам). */
export const MD_CODE_LONG = [
  'Готовый обработчик:',
  '',
  '```ts',
  "import { transition } from '@shared/stateMachine'",
  '',
  'export interface TurnState {',
  '  voice: VoiceState',
  '  streaming: string',
  '  activity: ClaudeLogEntry[]',
  '}',
  '',
  '/** Применяет событие хода к состоянию, не трогая уже показанный текст. */',
  'export function applyTurnEvent(state: TurnState, event: VoiceEvent): TurnState {',
  '  const voice = transition(state.voice, event)',
  "  if (event.type === 'token') {",
  '    return { ...state, voice, streaming: state.streaming + event.text }',
  '  }',
  "  if (event.type === 'log') {",
  '    return { ...state, voice, activity: [...state.activity, event.entry] }',
  '  }',
  "  if (event.type === 'done') {",
  "    return { ...state, voice: 'idle' }",
  '  }',
  '  return { ...state, voice }',
  '}',
  '',
  '// Очень длинная строка без переносов проверяет горизонтальный скролл блока кода:',
  "const command = 'npm run -w @voicechat/ui typecheck && npm run -w @voicechat/ui test -- --reporter=verbose --coverage'",
  '```',
  '',
  'И короткий shell рядом:',
  '',
  '```bash',
  'git switch -c feature/24-storybook && npm run -w @voicechat/ui build-storybook',
  '```'
].join('\n')

/** Ссылки (открываются во внешнем браузере) и автоссылка GFM. */
export const MD_LINKS = [
  'Подробности — в [базе знаний](https://example.com/docs/kb/ui.md) и в',
  '[протоколе](https://example.com/docs/kb/protocol.md).',
  '',
  'Автоссылка: https://example.com/very/long/path/that/should/wrap/somewhere/in/the/bubble',
  '',
  'Сноска-ссылка на [тот же файл][kb].',
  '',
  '[kb]: https://example.com/docs/kb/ui.md'
].join('\n')

/** Чек-листы GFM (в т.ч. вложенный) и обычные списки. */
export const MD_CHECKLIST = [
  '### План',
  '',
  '- [x] Собрать общие фикстуры',
  '- [x] Сториз чата',
  '- [ ] Сториз CI-панели',
  '  - [x] `RunFeed`',
  '  - [ ] `CiConsole`',
  '- [ ] Смоук-сборка в CI',
  '',
  '1. Сначала фикстуры',
  '2. Потом сториз',
  '3. И только затем документация'
].join('\n')

/** Всё сразу: заголовки, цитата, `hr`, инлайн-код, зачёркивание, картинка-заглушка. */
export const MD_KITCHEN_SINK = [
  '# Итог хода',
  '',
  '## Что сделано',
  '',
  'Поправил `statusLine()` — теперь ~~строка статуса~~ подпись зависит от движка.',
  '',
  '> Важно: озвучка и распознавание остаются локальными.',
  '> Наружу уходит только текст запроса.',
  '',
  '---',
  '',
  MD_TABLE,
  '',
  MD_CHECKLIST,
  '',
  MD_CODE_LONG,
  '',
  MD_LINKS
].join('\n')

/** Стрим на середине слова — так текст приходит по токенам. */
export const STREAMING_TEXT = [
  'Смотрю на упавший шаг: `npm test` свалился на',
  '`ChatColumn.dom.test.tsx`. Похоже, дело в общей фикстуре ленты — сейчас пров'
].join(' ')
