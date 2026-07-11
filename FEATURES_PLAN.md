# План: новые фичи (голос, агент, разговоры, качество жизни)

> Живой документ. Каждый шаг самодостаточен, заканчивается **гейтом**
> (typecheck + тесты затронутых пакетов; где нужно — сборка). Не переходим к
> следующему шагу, пока гейт не зелёный. Прогресс — в чек-листе и журнале внизу.

## Принципы

- Общий UI (`@voicechat/ui`) ⇒ фича автоматически появляется и в web, и в desktop.
- Данные/настройки — через `@shared` (типы) + оба бэка (server WS / desktop IPC).
- Гейт шага: `npm run typecheck` (+`typecheck:desktop`) и тесты затронутых пакетов
  (`npm run -w <pkg> test`; desktop — `npm run test:desktop`). Сборки — на этапах с
  заметными изменениями UI.
- **Порядок** — от изолированного и дешёвого к сложному и рискованному, чтобы
  быстро набирать зелёные шаги. Самое объёмное (VAD/hands-free) — в конце, оно
  вероятнее всего потребует итераций.

---

## Фаза 1 — Разговоры и контент

### Ш1. Переименование разговора вручную
**Цель.** Двойной клик / кнопка ✎ на разговоре → инлайн-ввод названия.
**Изменения.**
- `store`: действие `renameConversation(id, title)` → `api['conversations:rename']`
  (IPC/REST уже есть) + `refreshConversations()`.
- `Sidebar`: инлайн-редактор названия (по ✎ или двойному клику), Enter — сохранить,
  Esc — отмена; пустое название игнорируем.
- `App`: проброс `onRename`.
**Тесты.** `voiceStore.test`: renameConversation зовёт api и обновляет список.
`App.dom.test` (или `Sidebar.dom.test`): правка названия → api вызван, заголовок обновился.
**Критерии.** ui typecheck+тесты зелёные; переименование видно в списке и заголовке.

### Ш2. Копирование ответа и блоков кода
**Цель.** Кнопка «копировать» на ответах ассистента и на каждом code-fence.
**Изменения.**
- `Markdown`: кастомный рендер `pre` с кнопкой Copy (clipboard API), «Скопировано» на ~1.5с.
- `ChatColumn`: кнопка 📋 в `mfoot` ответа ассистента (копирует исходный markdown).
- Стили в `app.css`.
**Тесты.** `Markdown.dom.test`: pre содержит кнопку копирования; клик зовёт
`navigator.clipboard.writeText` (мок). `ChatColumn.dom.test`: кнопка копирования у ответа.
**Критерии.** ui typecheck+тесты зелёные.

### Ш3. Поиск по разговорам и сообщениям
**Цель.** Поле поиска в сайдбаре: фильтрует по названию и содержимому сообщений.
**Изменения.**
- db (server+desktop): `searchConversations(query): Conversation[]` (LIKE по title +
  EXISTS по messages.text), регистронезависимо.
- IPC: `conversations:search { query } → Conversation[]` (invoke/REST + мосты).
- `store`: `searchQuery`, действие `setSearchQuery`; при непустом — грузим результаты
  поиска, иначе — обычный список.
- `Sidebar`: поле ввода поиска сверху списка.
**Тесты.** db.test (server+desktop): поиск по title и по тексту сообщения; пустой
запрос → все. `voiceStore.test`: setSearchQuery грузит отфильтрованный список.
**Критерии.** typecheck+тесты server/desktop/ui зелёные.

### Ш4. Экспорт разговора (Markdown / JSON)
**Цель.** Кнопка «экспорт» разговора → скачивание .md или .json.
**Изменения.**
- `@shared`: чистая `conversationToMarkdown(conv, messages)` и `conversationToJson(...)`.
- `store`: действие `exportConversation(format)` — берёт активные messages, формирует
  Blob и триггерит скачивание (через инъектируемый `download(name, mime, data)` дефолт —
  `<a download>`; в тестах мок).
- `App`/`ChatColumn` header: меню/кнопки экспорта.
**Тесты.** `@shared` format.test: markdown/json содержат реплики в порядке.
`voiceStore.test`: exportConversation зовёт download с корректным именем/mime.
**Критерии.** shared+ui typecheck+тесты зелёные.

---

## Фаза 2 — Качество жизни

### Ш5. Тёмная тема
**Цель.** Переключатель темы; палитра через CSS-переменные; сохранение в настройках.
**Изменения.**
- `@shared`: `Settings.theme: 'light' | 'dark'` (дефолт `light`).
- `app.css`: вынести палитру в `:root` CSS-переменные, `[data-theme="dark"]` — оверрайд;
  заменить хардкод-цвета на `var(--…)` в ключевых блоках.
- `App`: проставлять `data-theme` на корневой `.app`.
- `SettingsModal`: тумблер темы. (Иконка 🌙/☀ в сайдбаре — опционально быстрый тумблер.)
**Тесты.** db.test (server+desktop): дефолт `theme='light'` (обновить литералы Settings).
`App.dom.test`: тумблер темы меняет `data-theme` и сохраняется.
**Критерии.** typecheck+тесты всех затронутых зелёные; web `vite build` ок.

### Ш6. Горячие клавиши
**Цель.** Пробел (удержание) = push-to-talk запись; Esc = стоп/отмена.
**Изменения.**
- `useVoiceStore`/новый hook `useHotkeys`: глобальные keydown/keyup (игнорировать, когда
  фокус в input/textarea). Space-hold → startVoice/ stopVoice; Esc → cancelRequest/stopSpeak.
- Подсказка в UI (title/hint).
**Тесты.** `useHotkeys` dom-тест (или через App.dom): keydown Space (не в поле ввода) →
startVoice; keyup → stopVoice; Esc → cancel. Ввод в textarea Space не триггерит запись.
**Критерии.** ui typecheck+тесты зелёные.

### Ш7. Онбординг первого запуска
**Цель.** Если модель Whisper не скачана и/или нет голосов — приветственный мастер.
**Изменения.**
- `store`: производное `needsOnboarding` (нет модели / первый запуск — флаг в настройках
  `onboarded: boolean`).
- `OnboardingModal`: шаги «скачать модель» → «выбрать/скачать голос» → «готово»
  (переиспользует существующие действия download). Кнопка «пропустить» ставит `onboarded`.
**Тесты.** `App.dom.test`: при `modelPresent=false`+не onboarded — модал показан;
«пропустить» ставит настройку и прячет.
**Критерии.** ui+shared typecheck+тесты зелёные.

---

## Фаза 3 — Работа с агентом

### Ш8. Permission-режим агента
**Цель.** Выбор режима прав: `default` / `acceptEdits` / `plan` / `bypassPermissions`.
**Изменения.**
- `@shared`: `Settings.permissionMode` (дефолт — текущий фактический; проверить, что
  CLI принимает) + список для меню.
- `LlmRequest` (+server/desktop `claude/types`): поле `permissionMode`.
- claudeCli (оба): добавить `--permission-mode <mode>` в args.
- session/claudeService: брать режим из настроек.
- `SettingsModal`: select режима + краткое пояснение.
**Тесты.** claudeCli.test (server+desktop): args содержат `--permission-mode`.
db.test: дефолт настройки. `SettingsModal` — опции присутствуют.
**Критерии.** typecheck+тесты server/desktop/shared/ui зелёные.

### Ш9. Стоимость и токены хода
**Цель.** Показывать под ответом: длительность, ходы, стоимость (если есть).
**Изменения.**
- streamJson `parseStreamJsonLine`: расширить `result` полями `durationMs?`, `numTurns?`,
  `costUsd?`, `usage?` (in/out tokens).
- Протокол/IPC: `claude.done` += `meta?: { durationMs?; numTurns?; costUsd?; … }`;
  либо новое событие `claude.result`. (Решим: расширить `claude.done` — меньше сущностей.)
- `store`: хранить `lastTurnMeta`/привязать к сообщению; проброс в UI.
- `ChatColumn`: строка меты под ответом (мелким шрифтом), скрыта если данных нет.
**Тесты.** streamJson.test: result парсит cost/turns/duration/usage. protocol.test:
поле в `claude.done`. voiceStore.test: done с meta сохраняет мету.
**Критерии.** typecheck+тесты shared/server/desktop/ui зелёные.

### Ш10. Рабочая директория (cwd) сессии
**Цель.** Указать каталог, в котором Claude Code работает (доступ к репозиторию).
**Изменения.**
- `@shared`: `Settings.workdir: string | null`.
- claudeCli (оба): пробросить `cwd` в `spawn(cmd, args, { cwd })` (если задан и существует).
- `LlmRequest.cwd?`; session/claudeService берут из настроек.
- `SettingsModal`: поле пути (desktop — можно диалог выбора каталога позже; пока текст).
**Тесты.** claudeCli.test: spawn получает `{ cwd }`, когда задан; не падает без него.
db.test: дефолт `workdir=null`.
**Критерии.** typecheck+тесты server/desktop/shared/ui зелёные.

### Ш11. MCP-серверы / инструменты (read-only показ)
**Цель.** Показать подключённые MCP-серверы/инструменты (прозрачность). Полное
включение/выключение инструментов — stretch.
**Изменения.**
- server/desktop: `listMcpServers()` через `claude mcp list --json` (или парс текстового
  вывода); эндпоинт `mcp:list → { servers: {name; status}[] }` (invoke/REST + мосты).
- `store`: `mcpServers`, грузим при init.
- `SettingsModal` или `ConsolePanel`: секция «MCP-серверы» со статусом.
**Тесты.** unit на парсер вывода `claude mcp list`. store: init грузит список (мок).
**Критерии.** typecheck+тесты зелёные. Если формат вывода нестабилен — деградация к
пустому списку без ошибок (залогировать).

---

## Фаза 4 — Голос и аудио (ядро)

### Ш12. Barge-in голосом во время озвучки
**Цель.** Пользователь заговорил во время TTS → озвучка обрывается, начинается запись.
**Изменения.**
- Уже есть ручной barge-in (`mic_press` в `speaking`). Добавить **автоматический**:
  во время `speaking` слушать микрофон (лёгкий VAD по энергии кадров) → при устойчивой
  речи вызвать тот же путь, что `startVoice` (переход speaking→listening + cancelTts).
- Порог/длительность — константы; фича гейтится настройкой `bargeIn: boolean`.
**Тесты.** stateMachine уже покрывает speaking→listening. Новый unit на VAD-детектор
(энергия кадров → «речь началась»). store: событие «речь при speaking» → переход.
**Критерии.** typecheck+тесты зелёные. Живой прогон (при наличии сервера) — опционально.

### Ш13. Hands-free режим + VAD (авто-пауза)
**Цель.** Непрерывный диалог: старт записи один раз, авто-финализация после ~2с тишины,
после ответа — снова слушаем (пока hands-free включён).
**Изменения.**
- `@shared`: `Settings.handsFree: boolean`.
- VAD-детектор тишины (переиспользовать детектор из Ш12): в `listening` при тишине ≥N мс
  → `stopVoice` автоматически.
- `store`: после `speaking_done`/idle, если `handsFree` — авто `startVoice`.
- UI: индикатор режима hands-free; кнопка выхода.
**Тесты.** VAD unit (тишина → сигнал стопа). store: в handsFree после ответа авто-старт
записи; тишина в listening → авто-стоп → пайплайн ответа. Защита от петли при пустом STT.
**Критерии.** typecheck+тесты зелёные; при возможности — живой прогон.

---

## Прогресс (чек-лист)

- [x] Ш1. Переименование разговора
- [x] Ш2. Копирование ответа/кода
- [x] Ш3. Поиск по разговорам/сообщениям
- [x] Ш4. Экспорт разговора
- [x] Ш5. Тёмная тема
- [x] Ш6. Горячие клавиши
- [x] Ш7. Онбординг первого запуска
- [x] Ш8. Permission-режим агента
- [x] Ш9. Стоимость/токены хода
- [x] Ш10. Рабочая директория (cwd)
- [x] Ш11. MCP-серверы (показ)
- [x] Ш12. Barge-in голосом
- [x] Ш13. Hands-free + VAD

## Журнал прогресса

- **Ш1 (готово).** store `renameConversation(id,title)` (trim, пустое → no-op,
  `conversations:rename` + refresh). `Sidebar`: инлайн-input (кнопка ✎ / двойной клик,
  Enter/blur — сохранить, Esc — отмена), кнопка ✎ рядом с ✕. `App` проброс `onRename`.
  Стили `.renbtn/.crow-actions/.ctitle-edit`. Мост rename уже был (REST web + IPC
  desktop). Тесты: store (+2: rename/пустое), App.dom (+1: ✎→ввод→Enter). Гейт: ui
  typecheck ✓, **112 тестов** ✓.
- **Ш2 (готово).** `lib/clipboard.ts` (`copyText` с fallback на execCommand).
  `Markdown`: кастомный `pre` → `CodeBlock` с кнопкой Copy (читает `textContent` по ref,
  «✓» на 1.5с). `ChatColumn`: кнопка 📋 на ответах ассистента (копирует исходный
  markdown). Стили `.codewrap/.copycode`. Тесты: Markdown.dom (+1: копия кода),
  ChatColumn.dom (+2: копия ответа/только ai). Гейт: ui typecheck ✓, **115 тестов** ✓.
- **Ш3 (готово).** Сквозной поиск. db (server+desktop): `searchConversations(q)` —
  `ulower()` (регистронезависимо для кириллицы) + LIKE по title и EXISTS по messages.text,
  экранирование `%_\`. IPC `conversations:search` (+`IPC_CHANNELS`), REST
  `GET /api/conversations/search?q=` (статик-роут до `:id`), web httpApi + desktop handler.
  fakeApi: поиск. store: `searchQuery`+`setSearchQuery`, `refreshConversations` учитывает
  запрос. `Sidebar`: поле поиска + «Ничего не найдено». Тесты: db ×2 (+1 каждый),
  rest (+1: search vs :id), store (+1), App.dom (+1). Гейт: typecheck все+desktop ✓;
  shared 88, ui **117**, server 74, web 10, desktop 85 ✓.
- **Ш4 (готово).** `@shared/export.ts`: `conversationToMarkdown`, `conversationToJson`,
  `exportFileName` (слаг, unicode). store: `exportConversation(format)` + инъектируемый
  `download` (дефолт — `<a download>` + Blob). `ChatColumn`: кнопка ⇩ + меню Markdown/JSON
  в шапке (только при наличии сообщений). Стили `.exportbtn/.exportmenu/.mhead-right`.
  Тесты: shared export (+4), store (+1), ChatColumn.dom (+2). Гейт: shared 92, ui **120**
  typecheck+тесты ✓, web `vite build` ✓.
- **Ш5 (готово).** `Settings.theme` (дефолт `light`). `app.css`: семантические токены
  `:root` (--bg/panel/surface/text/text-dim/border/border-soft/accent) + `[data-theme=dark]`
  оверрайд; безопасная замена доминирующих хардкод-цветов на `var(--…)` по всему файлу +
  точечный dark-блок для пузырей/ховеров/чипов/инлайн-кода. `App`: `data-theme` на `.app`.
  `SettingsModal`: тумблер «Тёмная тема». db.test литералы +`theme`. Тесты: App.dom (+1).
  Гейт: typecheck все+desktop ✓; shared 92, ui **121**, server 74, web 10, desktop 85 ✓;
  web `vite build` ✓. *Прим.:* второстепенные акценты (спикер-чипы, баннеры ошибок)
  оставлены цветными — читаются и на тёмном.
- **Ш6 (готово).** `lib/useHotkeys.ts`: глобальные keydown/keyup, пробел (hold, без
  автоповтора) → push-to-talk, Esc → стоп/отмена; игнор при фокусе в INPUT/TEXTAREA/
  contenteditable; слушатели один раз, колбэки через ref. `App`: подключение (Esc по
  состоянию: thinking/speaking → cancelRequest, listening → stopVoice; выключено при
  открытом модале). Подсказка в статус-строке idle. Тесты: useHotkeys (+4). Гейт: ui
  typecheck ✓, **125 тестов** ✓.
- **Ш7 (готово).** `Settings.onboarded` (дефолт `false`). store `completeOnboarding()`
  (→ `onboarded:true`). `OnboardingModal`: приветствие + шаг модели (скачать/прогресс/✓) +
  шаг голоса + «Начать/Пропустить»; не блокирует жёстко. `App`: показ при `!onboarded`,
  хоткеи выключены во время мастера. Стили `.onboarding/.ob-*`. Тестовый `seededApi`
  ставит `onboarded:true` (иначе оверлей перекрывал бы все App.dom-тесты). db.test
  литералы +`onboarded`. Тесты: App.dom (+2). Гейт: typecheck все+desktop ✓; shared 92,
  ui **127**, server 74, web 10, desktop 85 ✓; web build ✓.
- **Ш8 (готово).** CLI-флаг проверен: `--permission-mode` принимает
  acceptEdits/auto/bypassPermissions/manual/dontAsk/plan (нет `default`). `@shared`:
  `PermissionMode` = bypassPermissions|acceptEdits|plan (безопасный для `-p` набор),
  `PERMISSION_MODES`, `Settings.permissionMode` (дефолт `bypassPermissions` — сохраняет
  текущее поведение). `LlmRequest.permissionMode?` (server+desktop); claudeCli (оба)
  добавляет `--permission-mode`, если задан. session/claudeService берут из настроек.
  `SettingsModal`: select «Права агента». Тесты: claudeCli ×2 (+1 каждый: флаг есть/нет),
  db.test литералы +`permissionMode`. Гейт: typecheck все+desktop ✓; server **75**,
  desktop **86**, shared 92, ui 127, web 10 ✓.
- **Ш9 (готово).** `@shared`: `TurnMeta` (durationMs/numTurns/costUsd/in/out tokens).
  `parseStreamJsonLine.result` += `meta` (парс `duration_ms`/`num_turns`/`total_cost_usd`/
  `usage`) — в shared И в desktop-копии streamJson. `onDone(text, meta?)` (server+desktop
  types + claudeCli `done()`). Протокол `claude.done.meta?`, IPC `claude:done.meta?`,
  web-мост onDone пробрасывает meta. store: `lastTurnMeta` + `applyClaudeDone(text,meta)`,
  сброс при новом ходе/смене разговора; `useVoiceStore` передаёт meta. `view.formatTurnMeta`
  («7.2с · 2 хода · $0.0131 · 1.2k→0.4k ток.»). `ChatColumn`: строка меты под последним
  ответом. Тесты: streamJson ×2 (+1 каждый), store (+1), ChatColumn.dom (+1). Гейт:
  typecheck все+desktop ✓; shared **93**, ui **129**, server 75, web 10, desktop 86 ✓;
  web build ✓.
- **Ш10 (готово).** `Settings.workdir: string|null` (дефолт null). `LlmRequest.cwd?`
  (оба types); `SpawnFn` += `options?{cwd}`; claudeCli (оба) → `spawn(cmd,args,{cwd})`,
  когда задан. session/claudeService: берут `workdir` из настроек и передают `cwd` только
  если каталог существует (`existsSync`). `SettingsModal`: текстовое поле пути. Тесты:
  claudeCli ×2 (+1 каждый: cwd передан/undefined), db.test литералы +`workdir`. Гейт:
  typecheck все+desktop ✓; server **76**, desktop **87**, shared 93, ui 129, web 10 ✓.
- **Ш11 (готово).** `@shared/mcp.ts`: `McpServer` + `parseMcpList` (терпит «No MCP
  servers», health-строку; разделитель статуса « - » с пробелами, чтобы не ломаться о
  `-y`). IPC `mcp:list`, REST `GET /api/mcp/servers`, web httpApi + desktop handler.
  server `claude/mcp.ts` и desktop `claude/mcp.ts`: `execFile('claude',['mcp','list'])`
  → parse, ошибки → []. store: `mcpServers` + `refreshMcpServers()` в init (best-effort).
  `SettingsModal`: секция «MCP-серверы» со статусом ✓/✗. desktop main wired. Тесты:
  shared mcp (+4), server mcp (+3), store (+1). Гейт: typecheck все+desktop ✓; shared
  **97**, ui **130**, server **79**, web 10, desktop 87 ✓; web+desktop build ✓.
- **Ш12 (готово).** `lib/vad.ts`: `rms(frame)` + `VadDetector` (порог+гистерезис по
  сериям речевых/тихих кадров, события speech-start/end). `Settings.bargeIn` (дефолт
  false). `AudioController.monitor(deviceId,onEnergy)` — отдельный захват энергии БЕЗ
  стрима в STT (не кормит STT звуком TTS); реализация в browserAudio. store: `applyMicEnergy`
  (VAD → при speaking+bargeIn speech-start → `startVoice` = barge-in), `syncBargeMonitor`
  держит монитор включённым в speaking (через `dispatchVoice`). `SettingsModal`: тумблер
  «Перебивание голосом». Тесты: vad (+8), store barge-in (+2), db литералы. Гейт: typecheck
  все+desktop ✓; ui **137**, shared 97, server 79, web 10, desktop 87 ✓. *Прим.:* пороги
  VAD/эхоподавление требуют живой калибровки (getUserMedia echoCancellation on).
- **Ш13 (готово).** `Settings.handsFree` (дефолт false). `AudioController.start` += опция
  `onEnergy`; browserAudio считает `rms` каждого чанка обычного захвата → авто-пауза.
  store: отдельный `handsVad` (сброс при старте записи); `applyMicEnergy` в listening при
  handsFree на speech-end → `stopVoice` (авто-финализация); `dispatchVoice` при speaking→idle
  и handsFree планирует авто-`startVoice` (пауза `HANDS_FREE_GAP_MS=400`), без петли на
  пустом STT (сброс идёт через reset/error, не speaking_done). `SettingsModal`: тумблер
  «Режим hands-free». Тесты: store (+3: авто-пауза, без handsFree, авто-старт после ответа);
  правлен тест захвата (start += onEnergy); db литералы +`handsFree`. Гейт: typecheck
  все+desktop ✓; ui **140**, shared 97, server 79, web 10, desktop 87 ✓; web+desktop build ✓.

---

## Итог

Все 13 шагов закрыты. Сводный гейт: typecheck (5 пакетов + desktop) чист; тесты
**shared 97, ui 140, server 79, web 10, desktop 87 (+2 skipped)**; сборки web (vite) и
desktop (electron-vite) проходят. Живая калибровка порогов VAD и проверка
эхоподавления при hands-free/barge-in — за живым прогоном (dev-сервер запускает
пользователь).
