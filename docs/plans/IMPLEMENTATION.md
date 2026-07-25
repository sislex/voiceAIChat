# План реализации: веб-версия + серверная версия (STT/TTS-сервер)

> Живой документ для продолжения имплементации. Каждая фаза — самодостаточна,
> заканчивается **гейтом** (typecheck + тесты + сборка + ручная проверка). Не
> переходим к следующей фазе, пока гейт не зелёный. Отмечай прогресс в чек-листе.

## Контекст и цель

Сейчас есть монолитное **Electron**-приложение (React-renderer + Node-main:
SQLite, Whisper STT, Claude CLI, Piper TTS, всё через IPC). Нужно:

1. Вынести текущее приложение в отдельную папку (`apps/desktop`) — оно продолжает
   работать как есть.
2. Сделать **серверное приложение** (`apps/server`) — отвечает за распознавание
   (Whisper) и синтез речи (Piper), стримит результат клиентам; к нему могут
   подключаться веб/десктоп/мобильные клиенты. Плюс держит Claude CLI + SQLite,
   чтобы тонкие клиенты (браузер, мобайл) были полнофункциональны.
3. Сделать **веб-версию** (`apps/web`) — браузерный клиент, подключается к серверу.

Сейчас делаем **web + server**. Desktop/mobile-клиенты — позже (протокол уже под них).

## Архитектура

```
voiceAIChat/                     # корень монорепо (npm workspaces)
  packages/
    shared/                      # @voicechat/shared: типы, контракт протокола,
                                 #   чистая логика (stateMachine, sentences, prompt,
                                 #   streamJson-парсер, pcm-утилиты, format)
  apps/
    desktop/                     # текущий Electron (перенесён из ./src)
    server/                      # @voicechat/server: Claude + SQLite + Whisper + Piper
    web/                         # @voicechat/web: React SPA (клиент сервера)
```

**Транспорт клиент↔сервер:**
- **HTTP REST** (`/api/...`) — запрос/ответ (разговоры, сообщения, настройки,
  статус модели, список/каталог голосов, запуск скачивания голоса/модели).
- **WebSocket** (`/ws`) — стриминг:
  - client→server: `audio.start{sampleRate}`, бинарные аудио-чанки (Int16 PCM),
    `audio.stop`, `claude.send{conversationId,segments}`, `claude.cancel`,
    `tts.speak{text,voice}`, `tts.cancel`.
  - server→client: `stt.partial{segments,text}`, `stt.final{...}`, `stt.error`,
    `claude.token{delta}`, `claude.done{text}`, `claude.error`, бинарный WAV
    (или `tts.audio` c бинарным payload), `tts.error`, `tts.voiceProgress/Done/Error`,
    `stt.downloadProgress/Done/Error`.
  - Аудио — бинарными WS-кадрами (ArrayBuffer), метаданные — JSON-кадрами.

Существующие каналы `shared/ipc.ts` мапятся на протокол ~1:1 — переиспользуем
семантику. Абстракции `SttEngine`/`LlmClient`/`TtsEngine`/`DiarizationEngine` и
`VoiceChatDb` переносятся в сервер без изменений; сервисы (сейчас на `ipcMain`)
переписываются на транспорт-абстракцию.

## Ключевые решения (допущения)

- Монорепо на **npm workspaces** (без дополнительных инструментов).
- Сервер = полноценный бэкенд (STT+TTS ядро + Claude + DB). Клиенты тонкие.
- v1 — **localhost**, без авторизации. Для LAN — TODO: HTTPS (getUserMedia требует
  secure context вне localhost).
- Electron-desktop **не переписываем** — переносим и сохраняем рабочим.
- Модели Whisper/голоса Piper и Python-рантайм: сервер использует свой каталог
  (можно указать путь на уже скачанные, чтобы не тянуть повторно).
- Node ≥ 20, TypeScript, Vitest везде. Сервер: Fastify (или express) + `ws`.
- Окружение сборки: сохраняются известные обходы (`CPLUS_INCLUDE_PATH` для
  нативных сборок better-sqlite3/whisper.cpp — см. память проекта).

---

## Прогресс (чек-лист)

- [x] Ф0. Монорепо: workspaces + перенос Electron в `apps/desktop` + `packages/shared`
- [x] Ф1. Контракт протокола в `packages/shared` (типы REST/WS) + тесты
- [x] Ф2. Каркас сервера: HTTP + WS, health, статик SPA
- [x] Ф3. Сервер: БД (разговоры/сообщения/настройки) — REST
- [x] Ф4. Сервер: Claude — WS-стрим
- [x] Ф5. Сервер: STT (Whisper) — аудио WS → партиалы/финал
- [x] Ф6. Сервер: TTS (Piper) — текст → аудио-стрим + голоса/каталог/скачивание
- [x] Ф7. Веб: каркас SPA (переиспользование UI + стор)
- [x] Ф8. Веб: HTTP-мост `api` + Claude по WS
- [x] Ф9. Веб: аудиозахват → STT сервера
- [x] Ф10. Веб: воспроизведение TTS сервера + голоса/настройки/скачивание
- [x] Ф11. Интеграция и приёмка (полный цикл через сервер)

---

## Общий Definition of Done для фазы (гейт)

1. `npm run -w <pkg> typecheck` — без ошибок (во всех затронутых пакетах).
2. `npm run -w <pkg> test` — все тесты зелёные.
3. Сборка затронутых пакетов проходит.
4. Ручная/скриптовая проверка результата фазы (smoke), описанная в фазе.
5. Существующий **desktop** остаётся рабочим (его тесты зелёные).

---

## Ф0 — Монорепо и перенос

**Цель.** Превратить репозиторий в монорепо, перенести Electron-приложение в
`apps/desktop`, завести `packages/shared`. Ничего не сломать.

**Шаги.**
1. Корневой `package.json`: `"private": true`, `"workspaces": ["packages/*","apps/*"]`.
   Корневые скрипты-агрегаторы (`typecheck`, `test`, `build` по воркспейсам).
2. Создать `apps/desktop/`, перенести туда: `src/`, `electron.vite.config.ts`,
   `electron-builder.yml`, `tsconfig*.json`, `vitest.config.ts`, `.eslintrc.cjs`,
   `.prettierrc.json`, `resources/`, `models/` (или оставить модели на месте и
   указать путь), `index.html` и текущий `package.json` (как `apps/desktop/package.json`,
   имя `@voicechat/desktop`). Обновить относительные пути в конфигах.
3. Завести `packages/shared/` (`@voicechat/shared`) с `package.json`, `tsconfig`,
   `vitest`. Пока пустой (наполним в Ф1).
4. `.venv-piper/`, `models/`, `resources/piper-*`, `release/`, `out/`, `node_modules/`
   — вынести в корневой `.gitignore` с новыми путями.
5. `npm install` в корне (workspaces linkуют пакеты).

**Тесты.** Прогнать существующий набор desktop из нового расположения.

**Критерии приёмки.**
- `npm run -w @voicechat/desktop test` — все прежние тесты зелёные (≈203).
- `npm run -w @voicechat/desktop build` — сборка проходит.
- `npm run -w @voicechat/desktop start` — Electron-приложение запускается, работает
  как раньше (STT/Claude/TTS).
- `packages/shared` собирается (пустой) и подключается как зависимость.

---

## Ф1 — Контракт протокола в `packages/shared`

**Цель.** Единый источник типов и контракта клиент↔сервер; вынести чистую логику,
переиспользуемую и сервером, и клиентами.

**Шаги.**
1. Перенести/скопировать в `packages/shared/src`:
   - `types.ts` (Message, Conversation, Settings, TtsVoiceInfo, CatalogVoice, …).
   - Чистые модули: `stateMachine.ts`, `sentences.ts`, `prompt.ts` (buildPrompt),
     `streamJson.ts` (парсер), `format.ts` (whisper stdout), `pcm.ts`
     (resample/float→int16/chunker), `textPrep.ts`. (Из `apps/desktop/src/{shared,main,renderer}`.)
   - `protocol.ts` — **новый**: типы REST (пути, request/response) и WS-сообщений
     (union по `t`), бинарные соглашения для аудио.
2. Desktop и будущие server/web импортируют из `@voicechat/shared` (desktop —
   постепенно, не ломая; на этой фазе достаточно, чтобы shared экспортировал типы,
   а desktop продолжал использовать свои копии или переключился).
3. Перенести соответствующие unit-тесты (stateMachine, sentences, pcm, prompt,
   streamJson, format, textPrep) в `packages/shared`.

**Тесты.** Все перенесённые unit-тесты в `packages/shared` зелёные.

**Критерии приёмки.**
- `npm run -w @voicechat/shared test` — зелёные (перенесённые тесты чистой логики).
- `npm run -w @voicechat/shared typecheck` — чисто.
- `protocol.ts` покрывает все текущие IPC-каналы (проверка соответствия — тест-список).
- Desktop по-прежнему зелёный.

---

## Ф2 — Каркас сервера

**Цель.** Поднять HTTP+WS сервер, отдающий health и (позже) статику SPA.

**Шаги.**
1. `apps/server` (`@voicechat/server`): Fastify + `ws` (или `@fastify/websocket`),
   TS, Vitest. Конфиг порта (env `PORT`, дефолт 8787).
2. `GET /api/health` → `{ ok: true, version }`.
3. WS-эндпоинт `/ws`: приём/отправка JSON-кадров + бинарных; каркас маршрутизации
   по `t`; per-connection состояние.
4. Отдача статики из `apps/web/dist` (когда появится).
5. Логгер, graceful shutdown, dispose ресурсов.

**Тесты.**
- REST: `GET /api/health` → 200 (supertest/`fastify.inject`).
- WS: подключение, echo-пинг, разбор JSON/бинарных кадров (ws-клиент в тесте).

**Критерии приёмки.**
- `npm run -w @voicechat/server test` — зелёные.
- `npm run -w @voicechat/server dev` — сервер поднимается, `curl /api/health` → ok.

---

## Ф3 — Сервер: БД (разговоры/сообщения/настройки)

**Цель.** Перенести `VoiceChatDb` на сервер, выставить REST.

**Шаги.**
1. Перенести `apps/desktop/src/main/db/*` в `apps/server/src/db/` (или общий пакет).
   БД-файл в каталоге данных сервера (env `DATA_DIR`).
2. REST:
   - `GET /api/conversations`
   - `POST /api/conversations` `{title?}`
   - `GET /api/conversations/:id` → `{conversation, messages}`
   - `PATCH /api/conversations/:id` `{title}`
   - `DELETE /api/conversations/:id`
   - `POST /api/conversations/:id/messages` `{role,text,time}` → Message
   - `GET /api/settings` / `PUT /api/settings`
3. Handlers — тонкие обёртки над `VoiceChatDb` (переиспользовать логику `handlers.ts`).

**Тесты.**
- Роуты через `fastify.inject` на `:memory:`-БД: CRUD разговоров, сообщения,
  каскадное удаление, персист настроек, сериализуемость.
- Контракт: набор путей ↔ `protocol.ts`.

**Критерии приёмки.**
- `test` зелёные. `curl` создаёт/читает разговор; настройки сохраняются между
  перезапусками сервера (файл БД).

---

## Ф4 — Сервер: Claude (WS-стрим)

**Цель.** Стриминг ответа Claude по WS, session-id per разговор, модель из настроек.

**Шаги.**
1. Перенести `apps/desktop/src/main/claude/*` (ClaudeCli, streamJson, prompt) в
   `apps/server/src/claude/`.
2. WS: на `claude.send{conversationId,segments}` — сервис берёт sessionId/модель из
   БД, спавнит `claude`, шлёт `claude.token`/`claude.done`/`claude.error`,
   сохраняет sessionId. `claude.cancel` — отмена.
3. Один активный запрос на соединение; отмена предыдущего.

**Тесты.**
- Unit ClaudeCli (мок-spawn) — перенести.
- Сервис: мок-`LlmClient` → корректные WS-кадры (token/done/error), запись sessionId
  в БД (мок/`:memory:`).
- Интеграционный (skipIf нет `claude`): реальный короткий запрос → непустой `done`.

**Критерии приёмки.**
- `test` зелёные (+ интеграционный при наличии CLI). Через ws-клиент: `claude.send`
  → приходят токены и `done`.

---

## Ф5 — Сервер: STT (Whisper)

**Цель.** Приём аудио по WS, распознавание, стрим партиалов/финала.

**Шаги.**
1. Перенести `apps/desktop/src/main/stt/*` (WhisperEngine, wav, models, format,
   download, sttService — адаптировать на WS-транспорт) в `apps/server/src/stt/`.
   Диаризацию-заглушку тоже.
2. WS: `audio.start{sampleRate}` → сброс буфера; бинарные кадры → накопление PCM;
   `audio.stop` → финал. Периодические партиалы. Ответы: `stt.partial/final/error`.
3. `GET /api/stt/status` (наличие модели). `POST /api/stt/download` + прогресс по WS.

**Тесты.**
- Unit (wav/format/models/download) — перенести.
- Сервис STT: мок-`SttEngine` + фейковые аудио-кадры → корректные `stt.*` кадры.
- Интеграционный (skipIf нет модели/бинаря): подать WAV-сэмпл (macOS `say` фикстура,
  ru) → `stt.final` содержит ключевые слова.

**Критерии приёмки.**
- `test` зелёные (+ интеграционный). Через ws-клиент: поток PCM → приходит финал.

---

## Ф6 — Сервер: TTS (Piper)

**Цель.** Синтез речи по WS (по предложениям), отдача аудио клиенту; голоса/каталог/скачивание.

**Шаги.**
1. Перенести `apps/desktop/src/main/tts/*` (PiperTtsEngine, SayTtsEngine fallback,
   ttsService — FIFO-очередь, voices/catalog/download, textPrep) в `apps/server/src/tts/`.
   Учесть бандл/пути Piper (venv/standalone python) — конфиг env.
2. WS: `tts.speak{text,voice}` → синтез → бинарный WAV-кадр (`tts.audio`); `tts.cancel`.
   `tts.voiceProgress/Done/Error` для скачивания.
3. REST: `GET /api/tts/voices`, `GET /api/tts/catalog`, `POST /api/tts/voices/:id/download`.

**Тесты.**
- Unit (textPrep, sayVoices/piperVoices, piperCatalog, voiceDownload, sayTts/piperTts
  на мок-spawn) — перенести.
- Сервис TTS: мок-`TtsEngine` → бинарные аудио-кадры в порядке очереди.
- Интеграционный (skipIf нет piper): `tts.speak` → непустой WAV.

**Критерии приёмки.**
- `test` зелёные (+ интеграционный). ws-клиент: `tts.speak` → приходит WAV, играбелен.

---

## Ф7 — Веб: каркас SPA

**Цель.** React-SPA (Vite), переиспользующая UI и стор из desktop-renderer.

**Шаги.**
1. `apps/web` (`@voicechat/web`): Vite + React + TS + Vitest (jsdom).
2. Переиспользовать компоненты/стили/стор из `apps/desktop/src/renderer` — вынести
   общие UI-части в `packages/shared` **или** импортировать напрямую (решить: для
   чистоты — вынести презентационные компоненты в `packages/ui`; для скорости —
   импорт из desktop). **Решение по умолчанию:** скопировать renderer в `apps/web/src`,
   а стор/чистую логику брать из `@voicechat/shared` (со временем дедуплицировать).
3. Стор `useVoiceStore` уже принимает зависимости — подготовить точку внедрения
   мостов (`api/audio/stt/claude/tts`) через web-реализации (Ф8–Ф10).

**Тесты.**
- RTL: рендер каркаса, стор с мок-мостами (переиспользовать `fakeApi`-подход).

**Критерии приёмки.**
- `npm run -w @voicechat/web dev` — SPA открывается; `test`/`typecheck` зелёные.

---

## Ф8 — Веб: мост `api` (REST) + Claude (WS)

**Цель.** Браузерные реализации `window.api` (fetch) и `window.claude` (WS).

**Шаги.**
1. `apps/web/src/bridges/httpApi.ts` — реализует `RendererApi` через `fetch` к `/api`.
2. `apps/web/src/bridges/ws.ts` — единый WS-клиент (реконнект, JSON+бинарь), поверх
   него `claudeBridge` (send/cancel + onToken/onDone/onError).
3. Внедрить в стор: текстовый чат (submitText → claude.send → токены → стрим/озвучка
   позже). История/настройки через REST.

**Тесты.**
- Мок `fetch`/WS: bridge вызывает нужные пути/кадры; стор проходит цикл (мок).
- e2e-стор: отправка текста → thinking → (мок токенов) → сообщение сохранено.

**Критерии приёмки.**
- В браузере: создать разговор, отправить текст, получить стрим ответа Claude,
  история сохраняется (сервер БД). `test`/`typecheck` зелёные.

---

## Ф9 — Веб: аудиозахват → STT сервера

**Цель.** Микрофон в браузере → PCM по WS → распознавание на сервере → live-блок.

**Шаги.**
1. Переиспользовать `audio/pcm.ts`, `audioCapture.ts`, worklet из desktop-renderer
   (они уже браузерные). `browserAudio` шлёт чанки в WS (`audio.*`) вместо `window.audio`.
2. Подписка на `stt.partial/final/error` → стор (`applySttPartial/Final/Error`).
3. Баннер отсутствия модели + скачивание (WS-прогресс), статус через REST.

**Тесты.**
- Unit pcm/чанкинг — уже есть (в shared). Мост аудио: мок WS — отправляются кадры.
- Стор STT-путь (есть).

**Критерии приёмки.**
- В браузере (localhost): нажать микрофон, сказать фразу → live-блок наполняется,
  финал фиксируется, уходит в Claude. `test` зелёные.

---

## Ф10 — Веб: воспроизведение TTS + голоса/настройки/скачивание

**Цель.** Ответ озвучивается в браузере голосом сервера (Piper), с паузами/кнопкой.

**Шаги.**
1. `ttsBridge`: `tts.speak/cancel` по WS; приём бинарных WAV-кадров → `ttsPlayer`
   (переиспользовать очередь+пауза 0.5с из desktop-renderer, Web Audio).
2. Стриминговая озвучка по предложениям (логика в сторе уже есть), кнопка ▶ на ответах,
   «Далее пример кода» (уже в `sentences`/`textPrep`).
3. Настройки: реальные голоса (`GET /api/tts/voices`), каталог + скачивание
   (`/api/tts/catalog`, `POST download`, WS-прогресс), модель Whisper, диаризация, микрофон.

**Тесты.**
- Мост TTS (мок WS + мок AudioContext): кадры → очередь воспроизведения.
- Стор TTS-путь и replay (есть).

**Критерии приёмки.**
- В браузере: ответ Claude озвучивается голосом Piper (сервер), пауза между
  предложениями, кнопка 🔊 повторяет; выбор/скачивание голосов работает.

---

## Ф11 — Интеграция и приёмка

**Цель.** Полный цикл в браузере через сервер.

**Шаги.**
1. Корневые скрипты: `npm run dev` (поднять server + web), `npm run build`.
2. Документация запуска (README монорепо): как поднять сервер и открыть веб.
3. Прогон всех тестов во всех пакетах; smoke полного цикла.

**Критерии приёмки (общая приёмка).**
- `npm test` (агрегатор) — все пакеты зелёные, включая интеграционные при наличии
  окружения.
- Браузер (localhost) через сервер: **голос → Whisper (сервер) → Claude (сервер) →
  ответ в чате (markdown+подсветка) → озвучка (Piper, сервер) в браузере**; история
  и настройки сохраняются на сервере между перезапусками.
- Desktop-приложение по-прежнему собирается, тестируется и работает.
- Сервер запускается автономно; протокол задокументирован (готов для desktop/mobile).

---

## Журнал прогресса

- **Ф0 (готово):** монорепо на npm workspaces. Desktop перенесён в `apps/desktop`
  (переименован в `@voicechat/desktop`), работает из нового места: typecheck ✓,
  203 теста ✓, build ✓. `.venv-piper` оставлен в корне и симлинкован в
  `apps/desktop/.venv-piper` (абсолютные shebang'и). whisper.cpp пересобран под
  новый путь (rpath). **Desktop намеренно ИСКЛЮЧЁН из workspaces** (root
  `npm install` не трогает его node_modules с ручной сборкой whisper). Workspaces =
  `packages/shared` (+ будущие `apps/server`, `apps/web`). Запуск desktop-тестов:
  `npm run test:desktop`.

- **Ф1 (готово):** `packages/shared` наполнен. Перенесены чистые модули (types,
  stateMachine, sentences, pcm, prompt, streamJson, format, textPrep) + их тесты
  (**74 теста** зелёные), typecheck чист. Добавлен `protocol.ts` — REST-пути (`REST`),
  WS-сообщения (`ClientMessage`/`ServerMessage` union + списки типов), `SttSegmentWire`,
  `SttUpdate`, `SttStatus`, `AddMessageArgs`, `ConversationWithMessages`. Контракт
  покрывает прежние IPC-возможности (тест `protocol.test.ts`). Desktop пока
  использует свои копии этих модулей (дедупликация — позже, не срочно).
  **Следующее (Ф2):** `apps/server` — Fastify + ws, `/api/health`, каркас `/ws`.
- **Ф2–Ф6 (готово):** `apps/server` (@voicechat/server) — Fastify + @fastify/websocket.
  **60 тестов** зелёные, typecheck ✓. Реализовано: `/api/health`; WS `/ws` с
  per-connection сессией (`session.ts`); БД (VoiceChatDb) + REST (conversations/
  messages/settings); Claude по WS (ClaudeCli, session-id в БД, модель из настроек);
  STT по WS (`WhisperEngine` **спавнит whisper-cli напрямую** — путь `VC_WHISPER_CLI`,
  переиспользует сборку desktop; партиалы/финал; диаризация-заглушка; `/api/stt/status`;
  `stt.download`); TTS по WS (Piper/say через `makeTtsEngine`, FIFO-очередь → `tts.audio`
  base64; `/api/tts/voices`, `/api/tts/catalog`, `tts.downloadVoice`). Конфиг — env
  (`PORT`, `VC_DATA_DIR`, `VC_MODELS_DIR`, `VC_WHISPER_CLI`, `VC_PIPER_BIN`,
  `VC_PIPER_ARGS`, `VC_PIPER_VOICES_DIR`). Запуск: `npm run -w @voicechat/server dev`.
  Реальные STT/TTS на сервере требуют путей к whisper-cli/piper через env (интеграции
  на моках; реальные прогонки — при настроенном окружении).
- **Ф7–Ф11 (готово):** `apps/web` (@voicechat/web) — React SPA (Vite), клиент сервера.
  **96 тестов** зелёные, typecheck ✓, `vite build` ✓ (527 модулей). Реализовано:
  - Переиспользован **весь UI+стор renderer** без изменений (скопирован в `src/`;
    `@shared/*` → локальная копия `src/shared` контрактов, `@voicechat/shared` →
    alias на исходники пакета).
  - **Мосты `window.*`** поверх REST+WS (`src/bridges/`): `httpApi.ts` — `RendererApi`
    через `fetch` (все каналы conversations/messages/settings/stt-status/tts-voices/
    catalog, 404→null для `conversations:get`); `wsClient.ts` — устойчивый WS
    (типизированный по `ClientMessage`/`ServerMessage`, очередь до open, авто-reconnect,
    роутинг по `msg.t`); `index.ts` — `installBridges()` собирает audio/stt/claude/tts
    мосты (audio-чанки → бинарные WS-кадры; `tts.audio` base64 → ArrayBuffer через
    `decode.ts`). Контракт провода гарантирован общими типами (компилятор ловит
    рассинхрон с сервером).
  - `main.tsx` вызывает `installBridges()` до монтирования; стор читает `window.*` как
    в Electron. Dev: `vite` с прокси `/api`→8787, `/ws`→ws://8787. Прод-адрес сервера —
    `VITE_SERVER_URL` (по умолчанию тот же origin).
  - Тесты: 88 перенесённых из renderer (UI/стор/логика) + 8 новых на мосты
    (`bridges.test.ts`: очередь/роутинг/бинарь WS, REST-запросы, base64→ArrayBuffer).
  - **Приёмка Ф11:** запущены реальные `@voicechat/server` (8787) + `vite` (5274);
    REST проверены curl (health/settings/stt-status/tts-voices/conversations — все 200);
    прокси Vite `/api`→сервер работает; **живой WS-цикл** через `ws`-клиент:
    `tts.speak` (say/Milena) → `tts.audio` = валидный WAV 120 КБ (RIFF). Полный
    UI-прогон в браузере через Chrome-расширение недоступен в этой среде (расширение не
    подключено) — проверять вручную: `npm run -w @voicechat/server start` +
    `npm run -w @voicechat/web dev`, открыть указанный Vite URL.
  - **Известное ограничение:** микрофон в браузере вне `localhost` требует HTTPS
    (secure context) — для LAN/мобилки добавить TLS (см. Заметки).

## Исправления после приёмки

- **Скачивание модели переживает рефреш страницы.** Раньше загрузка была привязана
  к WS-соединению: при обновлении страницы старый сокет закрывался, прогресс терялся,
  а новое соединение о загрузке не знало (файл при этом дописывался в фон, т.к.
  `ctx.send` защищён `readyState===OPEN` и не роняет цикл). Введён процесс-глобальный
  `ModelDownloadManager` (`stt/downloadManager.ts`): держит единственную активную
  загрузку и её состояние, рассылает события всем подписчикам, при подписке во время
  активной загрузки сразу отдаёт текущий процент. Сессия подписывается в новом
  `WsHandlers.onOpen` (WS-мост) и отписывается в `onClose` (сама загрузка продолжается).
  `stt.download` теперь идемпотентен (повторный клик/реконнект не рестартит). После
  рефреша UI восстанавливает прогресс-бар автоматически, без повторного клика (стор
  входит в `downloading` по первому же живому `stt.downloadProgress`). +5 тестов.

## Доработки веб-версии (фичи чата)

Добавлено в `apps/web` (+ поддержка на сервере). Тесты: shared 76, server 67, web 100.
- **Многострочный ввод.** `VoiceBar`: `input` → `textarea` (автовысота, max-height со
  скроллом). Enter — отправить, Shift+Enter — новая строка.
- **Остановка запроса.** Кнопка «стоп» в состоянии `thinking` → `cancelRequest`
  (отмена запроса к Claude + возврат в `idle`). Машина состояний: `reset` из thinking.
- **Правка запроса + перегенерация.** Инлайн-редактор на сообщениях пользователя
  (✏️): `editMessage` удаляет правимое сообщение и все последующие (БД+лента), шлёт
  исправленный текст и генерирует новый ответ (ChatGPT-стиль). *Ограничение:* Claude
  `--resume` продолжает ту же серверную сессию — переписка Claude не «перематывается»,
  исправленная реплика идёт как продолжение (видимая история корректна).
- **Удаление сообщений.** Кнопка 🗑 на каждом сообщении → `messages:delete`
  (REST `DELETE /api/conversations/:id/messages/:mid`, `db.deleteMessage`).
- **Вложения (любые файлы).** REST `POST /api/uploads` (base64, bodyLimit 64 МБ) →
  `UploadStore` (сохранение на диск сервера, реестр id→путь). В UI — кнопка 📎,
  drag-drop и вставка из буфера (скриншоты), чипы вложений. `claude.send` несёт id
  вложений; сессия резолвит их в пути, `buildPrompt` добавляет просьбу прочитать файлы
  — Claude Code читает их своими инструментами (изображения — визуально). В историю
  попадает пометка «📎 имена файлов».
- **Автоозвучка (настройка).** `Settings.autoSpeak` (по умолчанию **выкл**) в обеих
  копиях shared; тумблер в `SettingsModal`. Авто-TTS-пайплайн в сторе гейтится
  `autoSpeakActive()`; ручная кнопка 🔊 на ответе работает всегда.

## Единый UI (дедупликация desktop ↔ web)

Общий интерфейс вынесен в пакет — desktop и web используют **один и тот же UI**.
- **`@voicechat/ui`** (`packages/ui`): React-приложение (`App`, components, store, lib,
  audio, styles) + тесты. Транспорт-нейтрально: читает мосты `window.*`. Экспорт: `App`
  и `@voicechat/ui/styles.css`. **92 теста.**
- **Контракт `ipc`** (`RendererApi` и мосты) вынесен в `@voicechat/shared/ipc` (был
  продублирован в `src/shared/ipc.ts` обоих приложений). Алиас `@shared` во всех
  потребителях → `packages/shared/src` (импорты `@shared/*` внутри UI/desktop-main не
  переписывались — сменились только алиасы).
- **`apps/web`** и **`apps/desktop/src/renderer`** стали тонкими: `main.tsx` +
  `import App from '@voicechat/ui'`. Мосты внедряет каждое приложение по-своему
  (desktop — preload/Electron IPC, web — `installBridges`/REST+WS). Дубли UI удалены.
  Алиасы `@voicechat/ui`/`@shared` заданы в `vite.config` и `electron.vite.config`
  (desktop вне workspaces → path-алиасы, сборка whisper не затронута).
- **Паритет desktop-main:** зеркалированы серверные фичи — `messages:delete`
  (+`db.deleteMessage`), `uploads:add` (`UploadStore` в `userData/uploads`), вложения
  в `claude:send` (пути в промпт через `buildPrompt`), `autoSpeak` (авто из настроек).
  Многострочный ввод, стоп, правка, скролл — из общего UI «бесплатно».
- **Итог тестов:** shared 76, ui 92, server 67, web 9, desktop 86. Typecheck чист,
  сборки web (vite) и desktop (electron-vite) проходят, whisper-cli цел.

## Заметки/риски

- **getUserMedia вне localhost** требует HTTPS — для LAN добавить самоподписанный
  сертификат (отдельная под-задача, не в v1-скоупе).
- **Нативные сборки** (better-sqlite3 под Node сервера, whisper.cpp): нужен
  `CPLUS_INCLUDE_PATH` и cmake на этой машине (см. память проекта). Сервер использует
  ABI Node (не Electron) — пересобрать better-sqlite3 под Node.
- **Piper на сервере**: переиспользовать standalone-python/венв; путь через env.
- **Дедупликация UI**: сначала копия renderer в web ради скорости; после Ф11 —
  вынести презентационные компоненты в общий пакет (доп. задача).
- **Одновременный запуск desktop и server** делят модели/венв — вынести в общий
  каталог данных или дублировать (решить в Ф5/Ф6, по умолчанию — общий каталог через env).
