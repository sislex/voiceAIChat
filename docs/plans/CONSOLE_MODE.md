# Фича: режим консоли (прозрачность работы агента)

> Живой документ. Каждый шаг самодостаточен, заканчивается **гейтом**
> (typecheck + тесты + при необходимости сборка). Не переходим к следующему шагу,
> пока гейт не зелёный. Прогресс отмечаем в чек-листе и журнале внизу.

## Цель

Добавить в чат настройку **«Режим консоли»**, при включении которой видно то же,
что в терминале Claude Code: команды инструментов (Bash/Read/Edit…), их статусы и
результаты (кратко), размышления (thinking), модель и режим (mode), а также
возможность раскрыть **сырой** stream-json каждого события. Показ — в
**сворачиваемой панели** (не мешает переписке).

**Решения (согласовано):**
- Содержание: структурированная активность **+** раскрытие сырого JSON по кнопке.
- Размещение: отдельная сворачиваемая панель.
- По умолчанию режим **выключен** (тумблер в настройках).

## Архитектурный обзор

Claude CLI уже запускается с `--output-format stream-json --verbose
--include-partial-messages`. Сейчас парсер (`parseStreamJsonLine`) достаёт только
текст ответа/session-id/result, остальное отбрасывается. Добавляем **параллельный**
разбор активности (не трогая существующий поток токенов):

```
claude CLI stream-json ──► parseStreamJsonLine  (delta/session/result)  → как сейчас
                        └► parseStreamJsonActivity (system/tool_use/…)   → claude.log (только в verbose)
```

- **shared**: `ClaudeLogEntry`, `parseStreamJsonActivity`, `Settings.showConsole`,
  протокол (`claude.send.verbose`, `ServerMessage claude.log`), ipc-контракт
  (`claude:log`, `onLog`, `verbose`).
- **server / desktop-main**: `LlmStreamHandlers.onActivity`, эмит `claude.log`
  только когда запрос помечен `verbose` (из настройки клиента).
- **@voicechat/ui**: состояние `consoleLog`, действия, тумблер настройки, компонент
  `ConsolePanel` (сворачиваемый; элемент раскрывается в сырой JSON).
- **web / desktop мосты**: доставка `claude:log` и передача `verbose` в `claude.send`.

Общий UI ⇒ фича автоматически появляется и в web, и в desktop.

## Definition of Done для шага (гейт)

1. `npm run -w <pkg> typecheck` — без ошибок в затронутых пакетах.
2. Тесты затронутых пакетов зелёные (`npm run -w <pkg> test`; desktop — `npm --prefix apps/desktop run test`).
3. Где применимо — сборка проходит (`vite build` / `electron-vite build`).
4. Отмечен шаг в чек-листе + запись в журнале.

---

## Шаги

### Ш1. Парсер активности (shared)
**Цель.** `parseStreamJsonActivity(line): ClaudeLogEntry | null` — по строке
stream-json даёт структурированную запись активности или null (для шумных/пустых).
**Изменения.**
- `types.ts`: `interface ClaudeLogEntry { kind; summary; detail?; raw }`,
  `type ClaudeLogKind = 'system'|'thinking'|'tool_use'|'tool_result'|'result'|'other'`.
- `streamJson.ts`: `parseStreamJsonActivity`. Разбирает:
  - `system/init` → `system` (model, permissionMode, число tools, cwd);
  - `assistant` message.content[]: `tool_use` → `tool_use` (имя + краткий ввод:
    Bash→command, Read/Edit/Write→file_path, иначе — сжатый JSON), `thinking` →
    `thinking`; `text` — пропускаем (это сам ответ);
  - `user` message.content[]: `tool_result` → `tool_result` (кратко + признак ошибки);
  - `result` → `result` (успех/ошибка, при наличии — длительность/ходы);
  - `stream_event` (партиалы-токены) — пропускаем (шум);
  - неизвестный top-level type → `other` (summary = type), raw сохраняем.
  - Каждая запись несёт `raw` = исходная строка (для раскрытия).
**Тесты.** `streamJson.test.ts` (+ кейсы): system→summary с model/mode; assistant с
tool_use(Bash) → команда в summary; thinking; user tool_result(is_error); result;
stream_event/пустое → null; невалидный JSON → null; raw сохраняется.
**Критерии.** typecheck+тесты shared зелёные.

### Ш2. Контракт протокола и ipc (shared)
**Цель.** Провести `verbose` в запрос и `claude.log` из сервера к клиенту.
**Изменения.**
- `types.ts`: `Settings.showConsole: boolean` (+ `DEFAULT_SETTINGS.showConsole=false`).
- `protocol.ts`: `claude.send` += `verbose?: boolean`; `ServerMessage` +=
  `{ t:'claude.log'; conversationId; entry: ClaudeLogEntry }`; `SERVER_MESSAGE_TYPES` += `'claude.log'`.
- `ipc.ts`: `IpcSendMap['claude:send']` += `verbose?`; `IpcEventMap['claude:log']`
  = `{ conversationId; entry }`; `IPC_EVENT_CHANNELS` += `'claude:log'`;
  `RendererClaudeBridge` += `onLog(cb): ()=>void`.
**Тесты.** `protocol.test.ts`: `claude.log` в `SERVER_MESSAGE_TYPES`. Тест БД на
дефолт `showConsole=false` (обновить существующие литералы Settings).
**Критерии.** typecheck shared; тесты shared зелёные (правки Settings-литералов
в server/desktop db.test — в Ш3/Ш4).

### Ш3. Сервер: эмит активности (verbose)
**Цель.** Сервер шлёт `claude.log` только когда запрос `verbose`.
**Изменения.**
- `claude/types.ts` (server): `LlmStreamHandlers.onActivity?(entry)`.
- `claudeCli.ts`: для каждой строки, если `handlers.onActivity`, вызвать
  `parseStreamJsonActivity` и эмитить.
- `session.ts`: при `msg.verbose` передавать `onActivity: entry => ctx.send({t:'claude.log', conversationId, entry})`.
- Обновить `db.test.ts` литерал Settings (+`showConsole`).
**Тесты.** `session.test.ts`: claude.send с `verbose:true` + мок, эмитящий activity,
→ клиент получает `claude.log`. Мок LlmClient дополнить вызовом `onActivity`.
**Критерии.** typecheck+тесты server зелёные.

### Ш4. Desktop-main: эмит активности (verbose)
**Цель.** Зеркально серверу через Electron IPC.
**Изменения.**
- `claude/types.ts` (desktop): `onActivity?`.
- `claudeCli.ts`: эмит activity.
- `claudeService.ts`: при `payload.verbose` → `deps.send('claude:log', {conversationId, entry})`.
- `preload/index.ts`: `claude:log` в подписках; `preload/index.d.ts` — тип окна.
- Обновить `db.test.ts` литерал Settings.
**Тесты.** desktop typecheck + существующие тесты зелёные (эмит IPC — вручную/смоук).
**Критерии.** typecheck+тесты desktop зелёные.

### Ш5. Мосты web + desktop
**Цель.** Доставить `claude:log` в стор и передать `verbose` в `claude.send`.
**Изменения.**
- web `bridges/index.ts`: `send` += `verbose`; `onLog` подписывается на ws `claude.log`.
- desktop `preload`: `window.claude.onLog` + проброс `verbose` в `claude:send` (payload уже несёт поле).
**Тесты.** web `bridges.test.ts`: `claude.send` кладёт `verbose`; onLog маппит ws-событие.
**Критерии.** typecheck+тесты web зелёные.

### Ш6. Стор @voicechat/ui
**Цель.** Хранить лог активности и управлять режимом.
**Изменения.**
- `AppState`: `consoleLog: ClaudeLogEntry[]`, `consoleOpen: boolean` (панель развёрнута).
- `StoreActions`: `applyClaudeLog(entry)`, `toggleConsole()`.
- `sendClaudePrompt`/deps: пробрасывать `verbose = settings.showConsole` в `window.claude.send`.
- `useVoiceStore`: подписка `window.claude.onLog → applyClaudeLog`.
- Сброс `consoleLog` при `selectConversation`/`newConversation`.
**Тесты.** `voiceStore.test.ts`: applyClaudeLog добавляет запись; verbose передаётся
в send при showConsole; сброс при switch.
**Критерии.** typecheck+тесты ui зелёные.

### Ш7. UI: ConsolePanel + тумблер настройки
**Цель.** Сворачиваемая панель активности; тумблер режима в настройках.
**Изменения.**
- `SettingsModal`: тумблер «Режим консоли» (`showConsole`).
- `ConsolePanel.tsx`: список `consoleLog`; иконка/цвет по `kind`; клик по записи
  раскрывает `raw` (моноширинно). Заголовок панели сворачивает/разворачивает.
- `App`: показывать панель, когда `settings.showConsole` (справа/снизу), пробросить
  `consoleLog`/`consoleOpen`/`toggleConsole`.
- Стили в `app.css`.
**Тесты.** dom-тест `ConsolePanel`: рендерит записи, раскрывает raw по клику;
`App`/Settings dom-тест: тумблер меняет `showConsole`.
**Критерии.** typecheck+тесты ui зелёные; `vite build` (web) ок.

### Ш8. Интеграция и приёмка
**Цель.** Собрать всё, проверить сквозной путь.
**Изменения.** нет (проверки).
**Тесты.** typecheck+тесты всех пакетов; сборки web + desktop; при возможности —
живой прогон (verbose-запрос → в панели видны команды/thinking/mode; раскрытие raw).
**Критерии.** всё зелёное; отметить фичу как готовую.

---

## Прогресс (чек-лист)

- [x] Ш1. Парсер активности (shared)
- [x] Ш2. Контракт протокола/ipc (shared)
- [x] Ш3. Сервер: эмит активности
- [x] Ш4. Desktop-main: эмит активности
- [x] Ш5. Мосты web + desktop
- [x] Ш6. Стор @voicechat/ui
- [x] Ш7. UI: ConsolePanel + тумблер
- [x] Ш8. Интеграция и приёмка

## Журнал прогресса

- **Ш1 (готово).** `types.ts`: `ClaudeLogKind` + `ClaudeLogEntry`. `streamJson.ts`:
  `parseStreamJsonActivity` — разбирает system/init (модель·режим·инструменты·cwd),
  assistant→tool_use (имя+краткий ввод: Bash→command, Read/Edit→file_path…) и
  thinking, user→tool_result (±ошибка), result (итог/длительность/ходы); текстовые
  блоки, stream_event, пустое/битое → null; неизвестный type → `other`. Каждая
  запись несёт `raw`. Тесты: +7 в `streamJson.test.ts`. Гейт: shared typecheck ✓,
  **87 тестов** ✓.
- **Ш2 (готово).** `types.ts`: `Settings.showConsole` (+дефолт `false`). `protocol.ts`:
  `claude.send.verbose?`, `ServerMessage` `claude.log`, `SERVER_MESSAGE_TYPES` += него.
  `ipc.ts`: `claude:send.verbose?`, событие `claude:log`, `IPC_EVENT_CHANNELS` += него,
  `RendererClaudeBridge.onLog`. Тест `protocol.test.ts`: claude.log в списке. Гейт:
  shared typecheck ✓, **88 тестов** ✓. (Литералы Settings в server/desktop db.test
  ещё без `showConsole` — правятся в Ш3/Ш4.)
- **Ш3 (готово).** server `LlmStreamHandlers.onActivity?`; `claudeCli` параллельно
  зовёт `parseStreamJsonActivity` и эмитит (только если `onActivity` задан);
  `session.ts` при `msg.verbose` шлёт `claude.log`. Правлен `db.test` литерал
  (`showConsole`). Тест `session.test`: verbose → приходит `claude.log`; без verbose
  — нет. Гейт: server typecheck ✓, **72 теста** ✓.
- **Ш4 (готово).** desktop `LlmStreamHandlers.onActivity?`; `claudeCli` импортит
  `parseStreamJsonActivity` из `@shared/streamJson` (без дублирования) и эмитит;
  `claudeService` при `payload.verbose` шлёт IPC `claude:log`; `preload` добавил
  `onLog`. Правлен `db.test` литерал. Гейт: desktop typecheck ✓, **84 теста**
  (+2 integration skipped) ✓.
- **Ш5 (готово).** web `bridges/index.ts`: `claude.send` несёт `verbose`, добавлен
  `onLog` (подписка на ws `claude.log`). Desktop preload `onLog` уже добавлен в Ш4,
  `send` шлёт весь payload (verbose проходит). Тест `bridges.test`: WsClient
  доставляет `claude.log` подписчику. Гейт: web typecheck ✓, **10 тестов** ✓.
- **Ш6 (готово).** `AppState.consoleLog/consoleOpen`, действия
  `applyClaudeLog` (с кэпом 500) и `toggleConsole`; `beginReply`/`sendClaudePrompt`
  пробрасывают `verbose = settings.showConsole`; сброс `consoleLog` при
  `selectConversation`/`newConversation`. `useVoiceStore`: подписка
  `window.claude.onLog → applyClaudeLog`. Тесты `voiceStore.test`: applyClaudeLog
  копит записи, toggleConsole, verbose=true при showConsole, сброс при switch;
  правлены 3 существующих ассерта send (+4-й арг verbose). Гейт: ui typecheck ✓,
  **102 теста** ✓.
- **Ш7 (готово).** `SettingsModal`: тумблер «Режим консоли» (`showConsole`).
  Новый `ConsolePanel.tsx`: сворачиваемая панель (третья колонка `app--console`),
  список записей с бейджем вида и цветной левой полосой по `kind`, клик по записи
  раскрывает `detail` + сырой `raw` (моноширинно). `App`: класс `app--console` и
  рендер панели при `settings.showConsole`. Стили в `app.css`. Тесты:
  `ConsolePanel.dom.test` (+5: рендер, раскрытие raw, свёрнутая, onToggle, пусто),
  `App.dom.test` (+1: тумблер включает панель и сохраняется). Гейт: ui typecheck ✓,
  **108 тестов** ✓, web `vite build` ✓.
- **Ш8 (готово).** Сквозной гейт: typecheck всех пакетов + desktop ✓; тесты
  server **72**, web **10**, ui **108**, desktop **84** (+2 integration) ✓;
  сборки web (`vite build`) и desktop (`electron-vite build`) ✓. Сквозное покрытие
  режима консоли: парсер активности (unit), эмит `claude.log` при verbose (server
  session.test), доставка по ws (bridges.test), стор (applyClaudeLog + проброс
  verbose), панель (ConsolePanel.dom + App.dom тумблер). Живой прогон с реальным
  Claude CLI — за пользователем (dev-сервер запускает он; фоновый сервер на 8787
  не поднимаю).
