---
title: Интерфейс: React, store, remote-мосты и голосовой UX
updated: 2026-07-27
checked: 49465ae
areas:
  - packages/ui/src
  - apps/web/src
---

# Интерфейс: React, store, remote-мосты и голосовой UX

`packages/ui` — один React-интерфейс для браузера и Electron. `apps/web` только вычисляет URL сервера, вызывает `installRemoteBridges()` до первого импорта состояния приложения, монтирует `<App/>` и подключает CSS. Поэтому продуктовые экраны, состояние и поведение всегда меняются в `packages/ui`.

## Слои

```text
App/components → useVoiceStore → voiceStore actions → window.* bridges
                                                  ↘ audio/TTS helpers
web/desktop host → installRemoteBridges → HTTP + WebSocket → server
```

`voiceStore.ts` — обычное замыкание с `getState`, `subscribe`, `actions`; React в нём отсутствует. `useVoiceStore.ts` адаптирует подписку к React. Такая граница позволяет тестировать сложные сценарии без DOM, а компоненты — через Testing Library и fake bridges.

## Состояние приложения

Состояние сгруппировано по областям, хотя хранится одним объектом:

- сессия: `authRequired`, `currentUser`, `authError`;
- голос: текущее состояние автомата, live STT segments, микрофоны, настройки, модель и capabilities;
- разговор: список, активный id, сообщения, draft, attachments, поиск, streaming reply, active turns/activity/usage;
- TTS: голоса, каталог, загрузки, активное сообщение и очередь воспроизведения;
- LLM/диагностика: MCP servers, login status, console log;
- машины: агенты, окно управления, utility console/explorer;
- наблюдатели: Claude Code и Codex projects/sessions/transcripts;
- администрирование: пользователи, usage, разговоры и сообщения выбранного пользователя;
- проекты: список, sidebar filter, detail, board и loading;
- поверхности UI: settings/users/machines/projects/board/utility open flags.

Начальное состояние не считается серверной истиной. `init()` определяет наличие session bridge, выполняет `/me`, затем параллельно/последовательно загружает настройки, capabilities, модели, голоса, проекты, разговоры, машины, MCP и auth status. При отсутствии авторизации показывает `LoginScreen`; после login повторяет инициализацию защищённых данных.

## Разговор и ход модели

`newConversation`, `selectConversation`, rename/delete/search работают через `window.api`. Выбор разговора загружает сообщения и восстанавливает его индивидуальные настройки. Фильтр проекта хранится в localStorage и ограничивает sidebar, но не меняет владение данными на сервере.

`submitText()` валидирует draft/attachments, фиксирует цель выполнения, сохраняет пользовательское сообщение и отправляет LLM-запрос. Поток `claude.token/activity/usage` обновляет live-состояние только соответствующего разговора. Если пользователь переключился в другой чат, генерация продолжается в `activeTurns`; возврат показывает накопленный partial.

`claude.done` использует уже сохранённое сервером сообщение, когда оно пришло в событии, и не создаёт дубль. Error/cancel очищают только относящийся к ходу live-state. `executePlan` и `answerQuestions` превращают выбор пользователя в новый запрос по контракту служебных блоков.

Сообщения можно редактировать и удалять через REST. Экспорт в Markdown/JSON выполняется чистыми shared-функциями и browser download bridge.

## Голосовой конвейер

`browserAudio.ts` получает MediaStream выбранного устройства. Worklet/source переводит вход в mono PCM16 требуемой частоты и шлёт бинарные чанки. RMS поступает в VAD и индикатор.

Все переходы выполняются через shared `transition()`. Store исполняет эффекты: start/stop capture, начать/закончить STT, послать prompt, поставить TTS в очередь. Ручное присваивание voice-state вне перехода опасно: ломает barge-in и тесты автомата.

Partial STT обновляет живые сегменты; final формирует draft/сообщение и запускает thinking в зависимости от режима. Hands-free использует пороги и таймеры `vad.ts`. Во время speaking обнаружение речи вызывает barge-in: плеер и серверный TTS отменяются, начинается новый захват.

Текст LLM режется на законченные произносимые фразы по мере стрима. `ttsPlayer` гарантирует последовательное воспроизведение, учитывает source-complete и завершает состояние лишь после последнего аудио. Markdown, code fences и служебные блоки не озвучиваются.

## Компоненты и поверхности

`App.tsx` соединяет основной layout и глобальные popup-поверхности. `Sidebar` показывает разговоры, поиск, фильтр проекта и lifecycle status. `ChatColumn` рендерит timeline, streaming response, activity/usage и edit/delete действия. `VoiceBar` содержит композер, вложения, микрофон и cancel.

`SettingsModal` управляет STT/TTS, моделями/голосами, аудиоустройством и поведением. Недоступные по памяти capabilities не просто скрываются: сервер всё равно является последним gate.

`MachineStatus`, `AgentCard`, `AgentCommands` обслуживают регистрацию, токен, policy, install/update и диагностику. `MachineUtility` выбирает `MachineConsole` или `FileExplorer`; `MachineTerminal` использует xterm и PTY bridge.

`CcObserver` и `CodexObserver` отображают внешние CLI-сессии и могут возобновить их как разговор. `UsersAdmin` доступен admin. `ProjectsOverlay`, `ProjectBoard`, `TaskCard` реализуют членство, машины и канбан.

`KnowledgeBase` показывает статус, темы, поиск и документы серверной read-only KB. `QuestionsForm` рендерит одиночный/множественный выбор. `MessageImage` читает файл сервера или машины согласно источнику. `Markdown` поддерживает GFM и подсветку.

## Popup и доступность

`PopupFrame` владеет overlay, `role=dialog`, Escape и закрытием по фону. Инструментальные окна оборачиваются в `ToolFrame`, который добавляет заголовок и fullscreen. Не создавать отдельную реализацию модалки.

Иконка-кнопка без видимой подписи обязана иметь `aria-label` и `title`. Формы должны иметь связанные label, ошибки — видимый текст. Мобильная версия поддерживает выдвижной sidebar и полноэкранные popup.

Авторастущие textarea используют `useAutoGrow`: высота берётся из `scrollHeight`, ограничивается 2–4 строками, затем включается scroll. Это учитывает как переносы, так и явные переводы строк.

## Remote-слой

`remote/session.ts` хранит bearer token в localStorage. `httpApi.ts` добавляет Authorization, декодирует ошибки и очищает сессию при 401. `wsClient.ts` строит ws/wss URL, передаёт токен, переподключается и восстанавливает подписки. `decode.ts` проверяет JSON/бинарные события до передачи в callbacks.

`remote/index.ts` устанавливает все `window.*` мосты и связывает события сокета со store callbacks. Установка должна произойти до монтирования `App`, иначе store увидит отсутствующие мосты.

`VITE_SERVER_URL` задаёт отдельный backend. Пустая строка означает same-origin; Vite dev проксирует API/WS, production server раздаёт web build. URL нормализуется без завершающего `/`.

## Тестирование UI

Логика store тестируется прямыми действиями с подставленными мостами и детерминированными таймерами. DOM-тесты используют `src/test/fakeApi.ts`; проверяют цепочку «действие пользователя → вызов bridge → новое состояние экрана». Аудио/VAD/TTS тестируются как отдельные чистые модули.

Гейт: `npm run -w @voicechat/ui typecheck && npm run -w @voicechat/ui test`. При CSS, host-init или сборке дополнительно `npm run -w @voicechat/web build`.
