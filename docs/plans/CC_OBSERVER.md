# Фича: Проводник Claude Code (read-only просмотр сессий + live-tail)

> Живой документ. Каждый шаг самодостаточен, заканчивается **гейтом**
> (typecheck + тесты затронутых пакетов; где нужно — сборка). Не переходим
> к следующему шагу, пока гейт не зелёный. Прогресс — в чек-листе и журнале внизу.

## Цель

Переключаться по проектам, где запускается Claude Code, и смотреть **read-only**
историю сообщений и работу агента, плюс **live-слежение** за активной сессией.

**Согласовано:** только просмотр + live-tail; локальный сценарий (сервер/desktop
на той же машине, где Claude Code). «Продолжение сессии» — вне скоупа (отдельно позже).

## Источник данных (проверено)

`~/.claude/projects/<слаг>/<session-id>.jsonl` — по файлу на разговор. Строки:
- `user`: `message.content` = строка (промпт) **или** массив с `tool_result`
  (`{tool_use_id, content, is_error}`);
- `assistant`: `message.content` = массив блоков `text` / `thinking{thinking}` /
  `tool_use{id,name,input}`;
- у событий есть `cwd` (реальный путь проекта — берём отсюда, не из слага) и `timestamp`;
- служебные типы (`queue-operation`, `attachment`, `last-prompt`, `summary`) — пропускаем.
- **Внимание:** файлы бывают крупные (до ~10 МБ) — для списка читаем только «голову»
  файла (cwd + первый промпт), полный разбор — при открытии транскрипта.

## Архитектурный обзор

```
~/.claude/projects ──► ccStore (fs, server+desktop) ──► REST/IPC: projects/sessions/transcript
                    └► fs.watch активной сессии ──────► WS/IPC live-tail (новые CcItem)
@shared: типы CcProject/CcSession/CcItem + parseCcTranscript (persisted jsonl → CcItem[])
@voicechat/ui: режим «Проводник» (проекты → сессии → транскрипт) + live-индикатор
```

Общий UI ⇒ фича появляется и в web, и в desktop. Бэкенд-модуль общий по логике,
транспорт разный (server: REST+WS; desktop: IPC+события).

## Definition of Done для шага (гейт)
1. `npm run typecheck` (+ `typecheck:desktop`) без ошибок в затронутом.
2. Тесты затронутых пакетов зелёные.
3. Где применимо — сборки (web `vite build`, desktop `electron-vite build`).
4. Отметка в чек-листе + запись в журнале.

---

## Шаги

### Ш1. Парсер и типы (shared)
**Цель.** `parseCcTranscript(text): CcItem[]` + типы.
**Изменения.** `@shared`: `CcProject`, `CcSession`, `CcItem`/`CcItemKind`;
`parseCcTranscript` (плоский список: user/assistant-text/thinking/tool_use/tool_result;
служебные → пропуск; краткий ввод инструмента как в консоли; ts из timestamp).
**Тесты.** Фикстуры строк: user-строка, assistant text+tool_use (двумя item),
user tool_result(is_error), thinking, битая строка → пропуск.
**Критерии.** shared typecheck+тесты зелёные.

### Ш2. Бэкенд-модуль чтения (server + desktop)
**Цель.** Чистый модуль `ccSessions`: `listProjects()`, `listSessions(slug)`,
`readTranscript(slug, id, {limit})`. Путь проектов из env/`~/.claude/projects`.
**Изменения.** server `src/cc/ccSessions.ts`, desktop `main/cc/ccSessions.ts`
(логика общая; путь к каталогу инъектируется для тестов). Проект: slug, path (cwd
из первой строки новейшей сессии), name, sessionCount, lastActivity. Сессия: id,
title (первый user-текст), updatedAt (mtime), sizeBytes. Транскрипт: последние
`limit` CcItem.
**Тесты.** Временный каталог с фикстур-jsonl: projects/sessions/transcript.
**Критерии.** server+desktop typecheck+тесты зелёные.

### Ш3. Контракт: IPC/REST/протокол (shared)
**Цель.** Каналы `cc:projects`, `cc:sessions`, `cc:transcript` + live-tail.
**Изменения.** `ipc.ts` `IpcInvokeMap` += три канала (+ `IPC_CHANNELS`);
событие `cc:tail` в `IpcEventMap` (+ `IPC_EVENT_CHANNELS`); мост-метод подписки/
старта tail. `protocol.ts`: REST-пути + WS-сообщения `cc.tail.*` (start/stop/item).
**Тесты.** protocol.test: `cc.tail` в списках. **Критерии.** shared typecheck+тесты.

### Ш4. Сервер: REST + WS live-tail
**Цель.** REST endpoints + WS-подписка на активную сессию (fs.watch → новые CcItem).
**Изменения.** `routes/rest.ts`: GET projects/sessions/transcript. `session.ts` (или
новый ws-обработчик): `cc.tail.start {slug,id}` → fs.watch, дочитывает хвост, шлёт
`cc.tail.item`; `cc.tail.stop`. **Тесты.** rest.test: projects/transcript; tail —
смоук (watch мокается/по возможности). **Критерии.** server typecheck+тесты.

### Ш5. Desktop-main: IPC + события live-tail
**Цель.** Зеркально серверу через Electron IPC.
**Изменения.** `ipc/handlers.ts` += cc-хендлеры; сервис tail (fs.watch → `deps.send('cc:tail', item)`);
`preload`: подписка `cc:tail`, старт/стоп. **Тесты.** desktop typecheck + существующие.
**Критерии.** desktop typecheck+тесты.

### Ш6. Мосты web + desktop
**Цель.** Доставить cc-вызовы и live-tail в UI.
**Изменения.** web `httpApi` (три GET) + `bridges/index` (WS `cc.tail.*`, метод `ccTail`);
desktop preload `window.cc` (invoke + onTail + start/stop). **Тесты.** web bridges.test:
`cc.tail.item` доставляется подписчику. **Критерии.** web typecheck+тесты.

### Ш7. Стор @voicechat/ui
**Цель.** Состояние проводника + действия + live.
**Изменения.** `AppState`: `ccProjects`, `ccSessions`, `ccTranscript`, `ccActiveProject`,
`ccActiveSession`, `ccLive`. Действия: `openObserver`/`closeObserver`, `loadCcProjects`,
`selectCcProject`, `selectCcSession` (грузит транскрипт + запускает tail),
`applyCcTailItem`, стоп tail при смене/закрытии. **Тесты.** voiceStore.test: выбор
проекта→сессии грузит транскрипт (fake api); applyCcTailItem добавляет item.
**Критерии.** ui typecheck+тесты.

### Ш8. UI: Проводник Claude Code
**Цель.** Трёхпанельный вид + вход из сайдбара + live-индикатор.
**Изменения.** Кнопка «Claude Code» в `Sidebar`; `CcObserver.tsx` (панели
проекты|сессии|транскрипт; транскрипт — Markdown для user/assistant + активность
для tool_use/tool_result/thinking; бейдж live). `App`: рендер режима. Стили.
**Тесты.** dom-тест `CcObserver`: рендерит проекты/сессии/транскрипт; клик выбирает.
**Критерии.** ui typecheck+тесты; web `vite build`.

### Ш9. Интеграция и приёмка
**Цель.** Собрать всё, живой прогон на реальных `~/.claude/projects`.
**Тесты.** typecheck+тесты всех пакетов; сборки web+desktop; живой прогон
(проекты видны, транскрипт читается, live-tail дописывает активную сессию).
**Критерии.** всё зелёное.

---

## Прогресс (чек-лист)

- [x] Ш1. Парсер и типы (shared)
- [x] Ш2. Бэкенд-модуль чтения (server + desktop)
- [x] Ш3. Контракт IPC/REST/протокол
- [x] Ш4. Сервер: REST + WS live-tail
- [x] Ш5. Desktop-main: IPC + события
- [x] Ш6. Мосты web + desktop
- [x] Ш7. Стор @voicechat/ui
- [x] Ш8. UI: Проводник Claude Code
- [x] Ш9. Интеграция и приёмка

## Журнал прогресса

- **Ш1 (готово).** `@shared/cc.ts`: типы `CcProject`/`CcSession`/`CcItem`/`CcItemKind`;
  `parseCcLine` (user-строка/text/tool_result±ошибка; assistant text/thinking/tool_use
  с кратким вводом; служебные/битые → []), `parseCcTranscript` (плоский список),
  `ccSessionTitle`, `ccCwdFromHead`. Тесты: +8. Гейт: shared typecheck ✓, **105 тестов** ✓.
- **Ш2 (готово).** `ccSessions.ts` (server + desktop-зеркало): `listProjects/listSessions/
  readTranscript` + `watchTranscript` (Ш4); путь из `VC_CC_DIR`/`~/.claude/projects`;
  cwd — из «головы» новейшей сессии; защита от обхода пути. Тесты (temp-fikстура): +5.
  Гейт: server+desktop typecheck ✓, server **84** ✓.
- **Ш3 (готово).** ipc: `cc:projects/sessions/transcript` (+`IPC_CHANNELS`), событие
  `cc:tail` (+events), send `cc:tailStart/Stop`, мост `RendererCcBridge`. protocol:
  `cc.tail.start/stop` (client), `cc.tail` (server) + REST-пути. protocol.test: +1.
  Гейт: shared **106** ✓.
- **Ш4 (готово).** server REST `GET /api/cc/projects[/…]`; WS `cc.tail.start/stop` →
  `watchTranscript` (fs.watch, дочитка хвоста, партиал-строки) → `cc.tail`. rest.test:
  +1 (temp `VC_CC_DIR`). Гейт: server **85** ✓.
- **Ш5 (готово).** desktop handlers cc:*; `ccService` (ipcMain.on tailStart/Stop →
  `cc:tail`); preload `window.cc` + подписка. Гейт: desktop typecheck ✓, **87** ✓.
- **Ш6 (готово).** web httpApi (3 GET) + `makeCcBridge` (WS) + `window.cc`; fakeApi cc.
  bridges.test: +1 (cc.tail). Гейт: web **11** ✓.
- **Ш7 (готово).** store: `ccOpen/ccProjects/ccSessions/ccTranscript/ccProjectSlug/
  ccSessionId`; `openObserver/closeObserver/selectCcProject/selectCcSession/
  applyCcTailItems`; deps `ccTailStart/Stop`; `useVoiceStore` подписка onTail. Тест: +1.
  Гейт: ui **144** ✓.
- **Ш8 (готово).** `CcObserver.tsx` (проекты|сессии|транскрипт; Markdown для user/
  assistant, компактные строки для активности; LIVE-индикатор). Кнопка «Claude Code» в
  сайдбаре; `App` рендер; стили. Тест dom: +4. Гейт: ui **148** ✓.
- **Ш9 (готово).** Гейт всех: typecheck все+desktop ✓; тесты shared **106**, ui **148**,
  server **85**, web **11**, desktop **87** ✓; сборки web+desktop ✓. Живой прогон:
  подняли сервер временно → GET /api/cc/projects вернул **11 реальных проектов**;
  в Chrome Проводник показал проекты → сессии voiceAIChat → транскрипт (Вы/Claude/
  ДУМАЕТ, Markdown) + LIVE-индикатор; ошибок в консоли нет. Сервер/Vite погашены.
  *Прим.:* фактический live-append не провоцировал (не пишу в реальные сессии); логика
  fs.watch покрыта кодом/юнит-уровнем.
