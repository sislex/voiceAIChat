---
title: Backend изнутри: сборка, маршруты, сессии и сервисы
updated: 2026-08-27
checked: faea13cf
areas:
  - apps/server/src
---

# Backend изнутри: сборка, маршруты, сессии и сервисы

Backend — Fastify 5 на TypeScript ESM. Он не выпускает JS-артефакт: production и development запускают `tsx src/index.ts`, поэтому относительные импорты в исходниках имеют расширение `.js`, несмотря на физические `.ts`.

## Запуск и dependency injection

`index.ts` загружает `ServerConfig`, создаёт каталоги/SQLite, CLI-клиенты, STT/TTS engines и вызывает `buildServer()`, затем `listen()`. `server.ts` не слушает порт и подходит для тестов.

`BuildOptions` позволяет внедрить `db`, `claude`, `codex`, `sttEngine`, `ttsEngine`, `createWsHandlers`, `sessionSecret` и конфигурацию. По умолчанию `server.ts` сам решает, чем будут `claude`/`codex`: локальным `spawn`-клиентом или `RemoteLlmClient` поверх HTTP. Тем же конфигом он поднимает `RunnerFsClient`, если заданы `VC_LLM_RUNNER_CLAUDE_URL` и/или `VC_LLM_RUNNER_CODEX_URL`: это отдельный HTTP-клиент для профильных файловых API исполнителя. Новый внешний процесс/ресурс должен получить такую точку инъекции; иначе unit/integration-тест случайно запустит реальный CLI или затронет диск.

Порядок регистрации: auth/public guard, REST, admin/projects/agents/KB, gateway/MCP, websocket plugin и статические файлы. `/api/*` по умолчанию требует bearer token; исключения перечислены централизованно в `isPublic`. Нельзя делать новый публичный route побочным эффектом порядка plugins.

## HTTP-поверхность

Группы маршрутов:

| Группа | Назначение |
|---|---|
| health/session | Health, login, me, logout. |
| conversations/messages | CRUD, поиск, настройка проекта/status, редактирование сообщений, desktop migration. |
| settings/system | Пользовательские настройки, capabilities CPU/RAM. |
| STT/TTS | Статус, каталог, скачивание/удаление моделей и голосов. |
| uploads/files | Вложения и ограниченное чтение файлов, созданных CLI; при вынесенном исполнителе чтение картинок идёт через его `/v1/files/read`. |
| LLM tooling | MCP list, login status, Claude Code/Codex sessions и resume; `/api/auth/status`, `/api/cc/*`, `/api/cx/*` проксируются в файловые/auth API исполнителя. |
| agents | CRUD машин, token/policy/update/install bundles, exec и файловые операции. |
| admin | Пользователи, роли, блокировка, deny-list моделей, read-only просмотр машин/истории, user/global usage, LLM engines/health и model prices. Личные usage/access остаются вне admin domain. |
| projects | Проекты, участники, машины, default machine, канбан columns/tasks. |
| KB | Status, topics, lexical/semantic search, context и чтение документа. |
| preview | Same-origin прокси внешнего HTTP/HTTPS-сайта для iframe. |

### Серверный снимок контекста разговора

Защищённый `GET /api/conversations/:id/context-snapshot` в `apps/server/src/routes/rest.ts` формирует preview сохранённого контекста следующего хода. Effective LLM разрешается атомарно по цепочке: явные provider/model разговора → собственная `ci_llm_config` привязанного проекта → пользовательские настройки. Проектная конфигурация читается только при отсутствии override provider разговора; если выбранный уровень не задаёт модель, fallback берётся из пользовательской модели соответствующего provider.

Одна вычисленная пара попадает и в `summary`, и в элемент `llm` группы `conversation`. Для элемента сервер ставит `source` соответственно «Разговор», «Проект» или «Настройки пользователя», а `explanation` различает явное переопределение и наследование с конкретного уровня. Контрактные сценарии приоритета и наследования закреплены в `apps/server/src/routes/rest.test.ts`.

## Граница отдельного Make-подобного продукта

**Make (с 2026-08-26) — аналог Figma Make внутри чата.** Проект разговора — рабочая папка
`<dataDir>/make/<conversationId>/` (`apps/server/src/make/workspace.ts`, класс `MakeWorkspaces`):
статические файлы + служебный `.snapshots/<id>/{meta.json,files/}`. Пути нормализует
`normalizeMakePath` (`@voicechat/shared/make`): без `..`, скрытых сегментов и спецсимволов,
глубина ≤ 8; символические ссылки внутри проекта отвергаются; лимиты `MAKE_LIMITS`
(2 МБ/файл, 400 файлов, 50 снимков). `rev` — счётчик изменений в памяти процесса.
REST (`routes/make.ts`): `GET/PUT/DELETE /api/make/:id[/file]`, `/rename`, `/snapshots`,
`/snapshots/:sid/restore`, `/reset`; все проверяют `db.getConversation(uid, id)` и
`assistantKind === 'make'`. Превью и ZIP — `/api/preview/make/:id/*` и `…/export.zip`: под
префиксом `/api/preview/` действует preview-cookie (`users/auth.ts`, `previewSession` принимает
`startsWith('/api/preview/make/')`). HTML отдаётся с CSP `default-src 'self' 'unsafe-inline'
'unsafe-eval' data: blob: https:; frame-ancestors 'self'` и инъекцией `MAKE_INSPECTOR_SCRIPT`.
ZIP — собственный писатель без сжатия (`make/zip.ts`). События — `MakeHub` (`make/hub.ts`),
сессия подписывается через `deps.make.subscribe` (как relay превью); владельца разговора для
MCP даёт `db.conversationOwner(id)`. Старый исследовательский план — `plans/figma-make-analog.md`.
Публикация: `.publish.json` в папке проекта + индекс `make/.published/<token>.json` → маршрут
`/p/:token/*` без auth (публикация переживает `reset`, повторный `publish` не меняет токен). Фоновая очистка (roadmap-2 п.16): `MakeWorkspaces.sweep(maxAgeMs = 30 дней)` обходит все проекты и удаляет снимки старше срока (кроме закреплённого в публикации и самого свежего) и PNG-снимки стори того же возраста; `server.ts` запускает её после старта и каждые 6 часов рядом с `GeneratedCleanupService` (не в VITEST), результат — в лог `make_sweep`.
`publish(id, {snapshotId})` закрепляет публикацию за снимком (`snapshotId/snapshotLabel` в `.publish.json`):
`publicFile()` читает файлы из `.snapshots/<id>/files`, транспиляция кэшируется по ключу `conv@snapshot`;
`publish(id)` без снимка возвращает «живую» публикацию текущих файлов (п.26).
`check()` — статика: ошибки компиляции jsx/tsx/ts (`compileDiagnostics` в `make/transpile.ts` → `kind: 'compile-error'`
со `line/column`), нет `index.html`, битые `href/src/url()` на файлы проекта (относительно файла,
`..` учитывается через `resolveRelativeRef`; якоря `#id`, `data:`, `mailto:`, `//` пропускаются),
пустые файлы, `http://`-скрипты. `applyTemplate(id)` заменяет файлы шаблоном `MAKE_TEMPLATES`
со снимком «Перед шаблоном «…»». `snapshotDiff(id, sid)` сравнивает файлы снимка с текущими побайтно
(added/removed/changed/same), `restoreFile(id, sid, path)` возвращает один файл. `importFiles(id, files, mode)`
— общий вход для импорта ZIP (`make/zipRead.ts`: store+deflate, срез общей папки, пропуск скрытых и
`__MACOSX`) и страницы по URL (`make/importUrl.ts`: HTML → index.html, same-origin css/js/img → `assets/`,
ссылки переписаны, чужие домены и `<a href>` — абсолютные; хосты проверяет `assertPublicHost` из
`previewProxy.ts`, лимиты 30 файлов × 2 МБ); перед импортом — снимок, `replace` очищает проект.
`exportZip(id, {vite})` добавляет `package.json` (react/react-dom при jsx/tsx, typescript при ts),
`vite.config.js`, `tsconfig.json`, `.gitignore`, `README.md` — только если таких файлов нет в проекте.
**React без сборки** (`make/transpile.ts`): при отдаче превью и публикации файлы `.jsx/.tsx/.ts`
прогоняются через `esbuild.transform` (esm, jsx automatic, target es2020), относительные импорты без
расширения дополняются существующим файлом (`rewriteRelativeImports`), ошибка компиляции отдаётся
модулем `throw new Error('Ошибка компиляции …')` — превью живо, текст виден в консоли/раннере. Кэш
`(conv, path) → {rev, code}` на 500 записей. React берётся из esm.sh через import map в index.html
(`MAKE_REACT_IMPORT_MAP`, шаблоны `react` и `react-ts` — второй на TSX с типизированными пропсами и
`*.stories.tsx`). **Сториз** (`make/stories.ts`): `parseStoryFile` — имена
стори регуляркой по экспортам (код не исполняется на сервере), `renderStoriesPage` — HTML раннера
для `GET /api/preview/make/:id/__stories__?file=&story=`; `GET /api/make/:id/stories`,
**Библиотека компонентов** (п.17, `make/library.ts`): `<dataDir>/make-library/<base64url(login)>/<slug>/{meta.json,
files/…}`; `GET /api/make/library`, `POST /api/make/:id/library {name, paths}` (файлы читаются из проекта),
`POST /api/make/:id/library/:slug/insert` (→ `importFiles(merge)` со снимком), `DELETE /api/make/library/:slug`;
slug — транслит имени (`librarySlug`). `GET/POST /api/make/:id/shots` (визуальные снимки стори: PNG снимает клиент, сервер хранит в `.shots/<id>.png` +
`meta.json`, ≤10 на стори, отдаёт `…/__shots__/<id>.png`; `.shots` не входит в список файлов и переживает reset;
серверный Playwright для авто-снимков отложен — в прод-образе нет браузеров), `GET /api/preview/make/:id/__gallery__` (`renderGalleryPage` — сетка iframe-ов на раннер; те же `__stories__` и
`__gallery__` отдаются и на публикации `/p/<token>/…` без входа, п.15) и
`GET /api/make/:id/search?q=` (`MakeWorkspaces.stories/search`, поиск без регистра, ≤200 совпадений).

Текущий `/api/preview` нельзя считать файловым или artifact-preview сервером: это аутентифицированный same-origin прокси внешнего HTTP/HTTPS. Его SSRF-ограничения и механизм iframe описаны ниже; отдельному продукту понадобятся собственные storage, ревизии, builder и изолированный runtime, которых сейчас в сервере нет.

Канонические строки находятся в `packages/shared/src/protocol.ts`. Реализация разделена между `routes/rest.ts`, `routes/agents.ts`, `routes/admin.ts`, `routes/projects.ts`, `kb/routes.ts`, `users/auth.ts` и `anthropic/gateway.ts`.

Каждый запрос к пользовательским данным получает имя через `uid(req)`. Проверки членства/владения выполняются до чтения или мутации. Admin guard использует роль из разрешённой сессии, не имя из URL. Выделение `@voicechat/admin-app` не меняло реализации `routes/admin.ts`, SQLite, auth model или runner protocol; host лишь адаптирует существующие маршруты к transport-neutral frontend contract.

## Прокси веб-превью

`registerPreviewProxy()` подключается из `server.ts` после основной REST-поверхности
и обслуживает защищённый `/api/preview` — маршрут зарегистрирован как `all`, то есть
обслуживает любой метод, а не только GET первичной загрузки страницы. Реализация в
`routes/previewProxy.ts` принимает только HTTP/HTTPS и не позволяет превью стать
SSRF-мостом: до запроса и в DNS-lookup все адреса имени должны быть публичными;
loopback, unspecified, private, link-local, multicast/reserved IPv4 и IPv6 ULA
отвергаются. Каждое из максимум пяти перенаправлений проходит ту же проверку.

Один внешний ответ ждут не дольше 10 секунд и читают максимум 5 MiB. Для HTML,
XHTML и CSS прокси переписывает URL ресурсов, ссылок, форм, постеров и `srcset`
обратно в `/api/preview`, сохраняя навигацию и зависимые ресурсы внутри проверяемой
границы; `url(...)` переписывается не только в самостоятельных CSS-ответах, но и в
`<style>`-блоках HTML и в inline `style=""`-атрибутах. Перед отправкой он снимает
`X-Frame-Options`, CSP и cookies, пересчитывает
длину изменённого тела и отдаёт исходный status; ошибки загрузки возвращаются как
структурированный JSON. В HTML перед закрывающим `body` (либо в конец документа)
вставляется автономный same-origin скрипт: он обслуживает инспектор, DOM-действия и
запись пользовательских действий через `postMessage`, а на `pagehide` снимает их
обработчики. UI-поведение и семантика сценариев — в [ui.md](ui.md#веб-превью), путь
контракта — в `packages/shared/src/protocol.ts`.

Динамический сетевой трафик страницы тоже не покидает `/api/preview`: context shim
(`previewContextScript`, вставляется в начало `<head>`) переопределяет `window.fetch`,
`XMLHttpRequest.prototype.open`, `navigator.sendBeacon` и `history.pushState/replaceState`.
Каждый URL резолвится относительно текущей страницы внешнего сайта (база берётся из
`?url=` текущего `location.href`, при недоступности — из URL, с которым рендерился
документ) и, если он http/https и ещё не обёрнут, заворачивается в
`/api/preview?url=<encoded>`; fetch сохраняет метод, тело и заголовки и форсирует
`credentials: 'same-origin'`, чтобы preview-cookie дошла до гейта. Перехват
`location.assign/replace/href` — best-effort через `Object.defineProperty` в
`try/catch`: в реальных браузерах интерфейс `Location` целиком `[LegacyUnforgeable]`
и не переопределяется, поэтому прямое присваивание `location.href` шим не ловит —
SPA-навигацию держит перехват History API и серверное переписывание ссылок.
`Authorization`, выставленный самой страницей, шим переименовывает в
`x-preview-authorization` (иначе Bearer-гейт ChatAI принял бы его за токен ChatAI и
ответил 401), а роут возвращает его апстриму как `authorization`. Deep-link:
фрагмент целевого адреса (`http://…/#/machines`) живёт внутри query `?url=` и в
`location` iframe-документа не попадает — в конце context-шима он восстанавливается
(`location.hash = target.hash`, только если у документа hash ещё пуст), поэтому
hash-роутеры вложенных SPA открывают нужный маршрут.

Границы прокси-подхода (проверено живьём на instagram.com): SPA с
**history-роутером** (маршрут из `location.pathname`) через превью не поднимаются —
документ живёт на `/api/preview?url=…`, роутер не матчит свой маршрут и приложение
остаётся на сплэше; подделать `pathname` нельзя, интерфейс `Location` целиком
`[LegacyUnforgeable]` (hash-роутеры при этом работают — см. deep-link выше).
Второе: динамически создаваемые `<script src>`/`<link>` (лоадеры крупных сайтов)
уходят мимо шима напрямую на их CDN — они загружаются (CSP снят), но такие
под-запросы не проходят через `/api/preview`. Такие сайты — ниша playwright-reader
(реальный браузер), а не веб-прокси.

Роут принимает тело запроса любого content-type сырым буфером (JSON, multipart,
бинарь) — парсеры остального API не затронуты: внутри `registerPreviewProxy()` свой
fastify-scope с `removeAllContentTypeParsers()` и catch-all `'*'`-парсером. Заголовки
входящего запроса пробрасываются апстриму через `upstreamRequestHeaders()`, кроме
hop-by-hop, адресации и авторизации/сессии ChatAI: `cookie`, `authorization`,
`host`, `origin`, `referer`, `accept-encoding`, `sec-*`, `x-forwarded-*` и т.п.
наружу не уходят; `content-type` уходит как есть. Conditional-заголовки
(`if-none-match`, `if-modified-since` и родня) тоже отбрасываются, а из ответа
вырезаются `etag`/`last-modified` (`DROPPED_RESPONSE_HEADERS`): валидаторы описывают
апстримное тело, после инъекций оно другое, и 304 от апстрима залипал бы в кэше
браузера как HTML с устаревшими шимами — Vite-окружения с их `etag` на `index.html`
воспроизводили это стабильно. SSRF-проверка (`assertPublicHost`
плюс кастомный DNS-lookup) выполняется в `get()` на каждый проксируемый запрос —
включая переписанные fetch/XHR/beacon и каждый redirect-хоп, исключений нет.

`/api/preview` защищён, но не Bearer-токеном в query (тот попал бы в лог/историю
браузера) — авторизация идёт через отдельную HttpOnly-cookie `vc_preview_session`
(`Path=/api/preview`, `SameSite=Strict`, ставится без `Max-Age` — то есть session-cookie,
не переживает закрытие браузера). В `apps/server/src/users/auth.ts` функция
`previewSession()` читает эту cookie, но только когда путь запроса точно равен
`/api/preview`; глобальный auth `preHandler` пробует Bearer, а при его отсутствии —
эту cookie, так что на любом другом защищённом REST-пути cookie не работает и нужен
`Authorization: Bearer`. Cookie выпускают два роута: `POST /api/session/login` при
входе и `POST /api/session/preview`, который переиздаёт её из уже действующего
Bearer-токена без пароля — он покрывает сессии, восстановленные из `localStorage`
без повторного login, и повторные визиты после перезапуска браузера, когда
session-cookie от предыдущего входа уже пропала; без этого второго роута такие
сессии получали 401 на любом сайте в превью. Оба пути лежат под публичным префиксом
`/api/session/` (`isPublic()`), поэтому `/api/session/preview` проверяет Bearer сам и
без него отвечает 401 без cookie. `POST /api/session/logout` снимает cookie через
`Max-Age=0`. На клиенте мостовой `session.ensurePreview()` вызывает только
`PreviewPane`, которая в приложении уже не монтируется; живая панель Web Reader
(`WebReaderHost` → iframe рекордера) идёт в `/api/preview` без клиентского гейта и
полагается на cookie от login — подробности флоу в [ui.md](ui.md#веб-превью).

## WebSocket `/ws`

`ws.ts` отвечает только за framing и routing: JSON управляющие сообщения, binary PCM, lifecycle сокета. `createSession()` создаёт per-connection handlers и владеет STT/TTS session, подписками tail, PTY relay и cleanup.

При подключении сервер отправляет активные LLM turns. Обрыв сокета закрывает микрофон, TTS, observer-tail и PTY подписки, но не модельный turn. Все callback-и должны быть сняты в одном cleanup, иначе reconnect удвоит события. В интеграционных тестах `ws.close()` только начинает closing handshake: перед `app.close()` нужно дождаться события `close`, поскольку именно оно запускает session cleanup. Локальные Fastify, WebSocket и SQLite ресурсы регистрируются в `afterEach`, чтобы assertion или timeout не оставляли worker с живым listener.

STT session аккумулирует PCM, конвертирует в WAV и вызывает engine. TTS session сериализует запросы, возвращает аудио/ошибки и поддерживает cancel. Resource capabilities проверяются сервером до запуска тяжёлого процесса.

## Процесс-глобальные ходы

`turns.ts` хранит по одному активному ходу на conversation id. `start()` выбирает Claude/Codex client, строит запрос с cwd/profile/MCP и подписывается на token/activity/usage. Partial хранится в памяти и транслируется всем заинтересованным соединениям.

По завершении сервер сохраняет AI message и метаданные в SQLite, обновляет conversation и отправляет `done`. По cancel/error снимает handle и очищает map. Пользовательский cancel после уже полученной дельты сохраняет partial как AI message с `meta.interrupted=true` и отправляет `done` с этим partial; поздний callback модели игнорируется. Тест не должен ждать пустой `done`, если мок успел отдать токен: такое ожидание держало Vitest до глобального 10-минутного timeout. Проверка identity текущего turn не позволяет позднему callback старого процесса удалить новый ход того же разговора.

Пользовательские CLI-профили изолированы в `dataDir/cli-users/<base64url(логин)>/...`; `cliProfiles.ts` (переехал в `apps/llm-runner/src/cli/`) создаёт HOME/config и environment. Это не контейнерный root profile. Login status читается отдельно для каждого профиля.

## SQLite и репозитории данных

`VoiceChatDb` — синхронный адаптер `better-sqlite3`. При создании выполняет идемпотентную DDL и миграции старых колонок. WAL разрешает читателям не блокировать обычную запись; foreign keys обеспечивают cascade для conversation/project children.

Таблицы: `users`, `settings`, `conversations`, `messages`, `speakers`, `agents`, `projects`, `project_members`, `project_machines`, `kanban_columns`, `tasks`. JSON-поля (`skills`, technologies, policy, message meta, settings) кодируются/декодируются на границе DB.

Составные операции проектов и reorder/move задач выполняются транзакциями. Позиции имеют REAL и могут вставляться между соседями; при исчерпании промежутков порядок нормализуется. `BoardHub` хранит только listeners и после мутации заставляет подписчиков перечитать board — сама доска остаётся в SQLite.

При первой новой БД сидируется `admin`; пароль берётся из `VC_ADMIN_PASSWORD`, пустой допустим только как явно выбранная конфигурация. Пароли хешируются `scrypt`, machine tokens — SHA-256; сырой token возвращается только при создании/регенерации.

## Uploads и файлы

`UploadStore` выдаёт вложению непрозрачный id и хранит его местоположение. Если запрос `POST /api/uploads` содержит разговор с `chat_storage_bindings`, сервер через `resolveManagedChatStorage` повторно проверяет владельца и online-состояние машины, зарегистрированный storage и marker, а затем пишет файл через `AgentRegistry.fsWrite` в `<chatRoot>/attachments`. Явный `agentId`, не совпадающий с binding, отклоняется. Для разговора без binding сохраняются совместимые режимы `<root>/.voicechat_uploads` выбранной машины и `VC_DATA_DIR/uploads` без машины; недоступный managed storage диагностируется без legacy-fallback. В prompt передаётся фактический абсолютный путь, а не клиентское имя; ограничения размера и нормализация пути применяются до записи. Реализация resolver и построения каталогов находится в `apps/server/src/uploads.ts`.

Перед ходом `TurnManager` читает удалённый файл через `fs.read`, регистрирует его байты в короткоживущем контексте `remote:image` именно для выбранного `agentId` и передаёт исполнителю как `LlmAttachment` с `preserveServerPath=true`. Контракт поля находится в `packages/shared/src/llm.ts`: runner не заменяет авторитетный путь машины временным Linux-путём в prompt, поэтому модель передаёт Windows- или POSIX-путь remote-инструментам без изменений. Для визуального анализа самим Claude/Codex CLI `apps/llm-runner/src/run/rawRun.ts` создаёт отдельную временную копию и добавляет в prompt явное соответствие «путь машины → копия runner». Каталог копии живёт до завершения, ошибки или отмены рана и затем удаляется; постоянный исходник на машине UploadStore при этом не удаляет.

Файл не кладётся в SQLite: `MessageAttachment` из `packages/shared/src/types.ts` хранит только `uploadId`, абсолютный `path`, имя, MIME-тип, размер, машину и необязательную подпись. `messages.attachments` содержит JSON такого массива; миграция добавляет колонку, а чтение отбрасывает битые или неполные элементы, чтобы старая история не ломала ленту. `POST /api/uploads` возвращает те же метаданные (включая фактический путь), после чего UI сохраняет их на пользовательской реплике через `messages:add`.

Раздел «Файлы чата» не имеет отдельного реестра и восстанавливает список из истории: `collectChatFiles` в `packages/shared/src/images.ts` берёт сохранённые вложения и корректные результаты `parseImages` из текста сообщений (служебные `image`-блоки и локальные markdown-картинки). Один физический файл определяется парой `agentId` и пути; дубли объединяются, но у элемента остаются все `messageIds`. Поэтому одинаковое имя на разных машинах не сливается, а доступность и открытие всегда проверяются на машине-источнике.

`serverFiles.ts` остаётся локальной границей безопасности для режима без вынесенного исполнителя: он разрешает чтение только внутри allowlisted roots пользовательского CLI-профиля/генерируемых данных, запрещает traversal/symlink escape, директории и файлы больше 32 MiB. Если `buildServer()` собрал `RunnerFsClient`, `routes/rest.ts` и `imageRelocate.ts` сначала идут в `/v1/files/read` исполнителя и только при отсутствии remote-режима читают локальный диск.

Для `remote:image` чтение с машины ограничено теми же 32 MiB в `apps/agent/src/fileOps.ts`. Бинарные данные `fs.read` передаются base64 в одном WebSocket-сообщении; сервер явно разрешает кадр до 48 MiB (32 MiB превращаются примерно в 42,7 MiB base64 плюс JSON), а ожидание файлового ответа агента ограничено 30 секундами. MCP-маршрут не буферизует входное HTTP-тело Fastify: его читает `StreamableHTTPServerTransport`. При поиске изображения только `ENOENT` разрешает перейти к следующему кандидату пути; таймаут, отключение машины, `fs.error` другого типа и `fs.result` без `dataBase64` возвращаются как отдельные ошибки и не маскируются сообщением «файл не найден». MIME JPEG/PNG/GIF/WebP определяется по первым 12 декодированным байтам, поэтому мост не создаёт второй полный `Buffer` крупного изображения; исходный base64 остаётся необходимым содержимым типизированного MCP `image`-блока и в текст ответа не попадает.

Изображения, созданные моделью на исполнителе, `imageRelocate.ts` переносит для managed-разговора в `<chatRoot>/.generated`; `TurnManager` перед записью заново разрешает binding и storage. Результат объявляется image-блоком с абсолютным путём машины и `agentId` binding. Ошибка managed-проверки или записи превращается в диагностику без копирования в `.generated_images`; прежнее размещение сохраняется только для разговора без binding. Источником байтов служит абстракция `readServerFile(userId, path)`, которая читает диск сервера либо профиль пользователя на исполнителе.

Локальная ретушь реализована отдельно в `imageRetouch.ts`. Sharp декодирует оригинал, валидирует rectangle/lasso и извлекает минимальный bounding crop; LLM получает вложениями только PNG crop, локальную чёрно-белую маску и необязательные референсы. Ответ обязан быть поддерживаемым растром точного размера crop; затем сервер проверяет средний перепад на внутренней границе, копирует RGBA из ответа только для белых пикселей маски и отдельным проходом сравнивает каждый пиксель вне полной маски с декодированным оригиналом. Поэтому служебный красный canvas UI в обработку не попадает. Любая ошибка генерации, формата, размера, стыка или outside-проверки прекращает запрос до `db.addMessage`. Для managed-разговора успешный PNG сохраняется через `saveRetouchedImage` в `<chatRoot>/.generated` на машине binding; сообщение получает абсолютный путь, правильный `agentId` и `MessageAttachment.retouch`. Совместимое размещение в `.generated_images` машины источника или профиля сервера применяется только без managed binding.

Явная публикация временного managed-результата выполняется `POST /api/artifacts/publish`. Маршрут принимает только непосредственный файл из `<chatRoot>/.generated` на машине binding и дополнительно требует, чтобы тот же путь с `agentId` уже встречался во вложениях или image-блоках текущего авторизованного разговора. Байты копируются в `<chatRoot>/artifacts`: занятое имя по умолчанию получает числовой суффикс, а замена разрешена лишь при `overwrite: true`. Результат сохраняется отдельным AI-сообщением и вложением; контракт находится в `packages/shared/src/imageRetouch.ts`, маршрут — в `apps/server/src/server.ts`.

Временные managed-файлы очищает `GeneratedCleanupService`: пользовательский `Settings.generatedFilesTtlDays` принимает целое значение 1–3650 и по умолчанию равен безопасным 30 дням. Один проход использует снимок TTL, перечисляет только непосредственные элементы `<chatRoot>/.generated`, удаляет лишь обычные файлы с `mtime < now - TTL` через специализированную нерекурсивную операцию агента и пропускает каталоги, симлинки, небезопасные имена, свежие файлы, ссылки актуальных сообщений и файлы под lease ретуши/публикации. `attachments`, `artifacts`, `.generated_images` и sibling-пути в обход не попадают. Ошибки binding, offline-машины и файловой системы сохраняются в `generated_cleanup_retry`; `ENOENT` считается достигнутым конечным состоянием. Итог каждого запуска — структурированные счётчики `checked`, `deleted`, `skipped`, `deferred` с `runId`.

Штатная модельная картинка хранится в AI-сообщении компактным fenced-блоком ```image с абсолютным путём, `agentId` и подписью; `MessageImage` получает её байты только при рендеринге. При наличии сохранённого provider-session следующий ход идёт через resume и в prompt попадает лишь новая реплика. После сброса/отсутствия session `TurnManager` пересобирает prompt из всех `messages.text` через `buildConversationPrompt`. При этом функция вырезает из AI-реплик корректные служебные ```image-блоки и локальные markdown-картинки через `parseImages`: это метаданные для UI, а не контекст следующего хода. Inline data-URL (`data:image/...;base64,...`) или иной base64 в тексте AI-сообщения не преобразуется и будет повторно отправлен модели. `parseImages` вырезает только локальные markdown-картинки и корректные ```image-блоки; внешние URL и data-URL остаются в markdown.

## LLM и MCP

`ClaudeCli` и `CodexCli` реализуют общий `LlmClient` (`@voicechat/shared`, `llm.ts`): spawn, поток событий, cancel. Сами классы лежат в `apps/llm-runner/src/cli/`; сервер либо импортирует их из `@voicechat/llm-runner/cli` и спавнит локально, либо использует третью реализацию того же интерфейса — `llm/remoteClient.ts` (`RemoteLlmClient`), который шлёт ход по HTTP в контейнер-исполнитель (`POST /v1/run`, NDJSON, отмена — `DELETE /v1/run/:id`). В Docker этот transport смотрит на внутренние сервисы `runner-work` и `runner-personal`; серверный образ собственных `claude`/`codex` бинарников больше не содержит. Для соседних профильных задач у сервера есть отдельный клиент `llm/runnerFsClient.ts`: он проксирует `/api/auth/status`, `/api/cc/*`, `/api/cx/*`, `/api/files/read` и live-tail CC/Codex в `/v1/auth/status`, `/v1/fs/*` и `/v1/files/read`, переподключая SSE с `Last-Event-ID`. Разбор потока для удалённого транспорта живёт в `llm/sinks.ts`, выбор реализаций идёт по `VC_LLM_RUNNER_URL`/`VC_LLM_RUNNER_CLAUDE_URL`/`VC_LLM_RUNNER_CODEX_URL` в `config.ts`; подробности — `docs/kb/llm.md`. MCP-конфигурация Claude может включать `remoteBashMcp`, который адресует команду выбранной машине через registry.

`/mcp/remote-bash` реализован SDK MCP и предоставляет bash в рамках выбранного agent id. Он не обходит policy/version/online checks registry. База MCP-URL для исполнителя берётся из `VC_MCP_PUBLIC_BASE`, а без env остаётся loopback `http://127.0.0.1:<PORT>` — так dev и Vitest не требуют отдельной адресации. Входящий `/v1/messages` — отдельный Anthropic-compatible gateway для Claude Code: backend либо upstream HTTP, либо локальный Codex; LAN-only проверка защищает незапароленный endpoint.

Observer-модули как код живут и на сервере, и в исполнителе, но источником истины для профилей CLI в remote-режиме является исполнитель: именно он читает JSONL-сессии из `~/.claude/projects` и `~/.codex/sessions`, строит список/транскрипт и tail через watcher/SSE, а сервер только проксирует результат. Resume по-прежнему создаёт/связывает разговор, а не запускает второй backend storage.

## STT, TTS и ресурсы

`system/resources.ts` читает cgroup v1/v2 лимиты CPU/RAM с fallback на host. `capabilities.ts` сравнивает их с default или `VC_MIN_MEM_STT/TTS`. Недоступность отражается в API и блокирует запуск.

Сервер не запускает Whisper и не имеет доступа к STT-моделям. `RemoteSttClient` проксирует PCM и lifecycle в защищённый WS `stt-runner /v1/transcribe`; runner единолично владеет `whisper-cli`, моделями, временными WAV, очередью, лимитами и очисткой. Недоступность runner меняет только `capabilities.stt`, не TTS или текстовый чат.

Синтез вынесен в отдельный `@voicechat/tts-runner`: только этот процесс запускает Piper или macOS `say`, владеет каталогом голосов и временными WAV. Внутренний ресурсный API `/v1/runs` защищён Bearer-токеном: создание и статус возвращают JSON-ресурс, WAV читается отдельно через `/v1/runs/:runId/audio`, отмена — `DELETE /v1/runs/:runId`. Runner ограничивает длину текста, очередь, конкурентность, время процесса и размер WAV, а после старта очищает оставшиеся временные файлы.

Сервер использует только `TtsClient` (`RemoteTtsClient` в runtime, `FakeTtsClient` в тестах). `ttsSession` сохраняет браузерную FIFO-очередь и прежний кадр `tts.audio`, связывает активную фразу с `runId` и отменяет её при barge-in или закрытии WebSocket. Если URL или токен runner не настроены, capabilities помечает только TTS недоступным; STT и текстовый чат не блокируются.

Piper доступен только при бинарнике и валидной паре `.onnx` + `.onnx.json`; на macOS `say` остаётся альтернативой. Фактически выбранные engine и voice фиксируются в ресурсе запуска.

## Конфигурация

Приоритет путей: env → найденный артефакт монорепо (кроме Vitest) → каталог данных/default executable. Основные переменные: `PORT`, `HOST`, `VC_DATA_DIR`, `VC_MODELS_DIR`, `VC_WHISPER_CLI`, `VC_PIPER_BIN`, `VC_PIPER_ARGS`, `VC_PIPER_VOICES_DIR`, `VC_WEB_DIR`, `VC_AGENT_APP`, `VC_DESKTOP_APP`, `VC_KB_ROOT`, `VC_KB_RERANK_PROVIDER`, `VC_MCP_PUBLIC_BASE`, `VC_ADMIN_PASSWORD`, `VC_MIN_MEM_STT`, `VC_MIN_MEM_TTS`, `VC_CLAUDE_GATEWAY_BACKEND`, `VC_CLAUDE_UPSTREAM_URL`, `VC_CLAUDE_UPSTREAM_API_KEY`, `VC_CLAUDE_UPSTREAM_AUTH`, `VC_CLAUDE_MODEL_MAP`, `VC_LLM_RUNNER_URL`, `VC_LLM_RUNNER_CLAUDE_URL`, `VC_LLM_RUNNER_CODEX_URL`, `VC_LLM_RUNNER_TOKEN`, `VC_LLM_RUNNER_TIMEOUT_MS`.

Под Vitest autodiscovery отключён, чтобы тест удаления модели/голоса не затронул реальные repo assets.

## Проверка

HTTP-тесты используют `app.inject()`, WS-тесты — временно слушающий Fastify и `ws` client, DB — `:memory:`. Spawn/fetch/fs/resources передаются как зависимости. Реальные Claude, Codex, Whisper и Piper в тестах не запускаются.

Гейт: `npm run -w @voicechat/server typecheck && npm run -w @voicechat/server test`.

**Валидация моков по JSON Schema (roadmap-4 п.31).** Файл коллекции `mock/**.json` может содержать `$schema`; `applyCollectionRequest` (`@shared/makeMock`) перед POST/PUT/PATCH прогоняет тело через `validateJsonSchema` (`@shared/jsonSchemaLite` — подмножество: `type`, `required`, `properties`, `enum`, `minLength/maxLength`, `minimum/maximum`, `pattern`, `format: email`, `items`, `additionalProperties: false`), для PATCH `required` игнорируется. Ошибки — ответ 422 `{ error: 'validation', issues: [{ path, message }] }`, файл не меняется. Подсказка модели (`MAKE_ASSISTANT_HINT`) описывает это поле.

**Auth-мок (roadmap-4 п.32).** Файл мока с полем `$auth` обрабатывает `applyAuthMock` (`@shared/makeMock`): `{ users: [{ username|login|email, password, … }], cookie? }` — POST сравнивает учётные данные, отвечает 200 с `user` (без пароля, слитым в объектное `$body`) и заголовком `Set-Cookie: vc_mock_session=<login>; Path=/; SameSite=Lax`, иначе 401 (не POST — 405); `{ require: true }` — без cookie 401, с ней в объектное `$body` подставляется `user: { username }`; `{ logout: true }` — 204 с `Max-Age=0`. `resolveMock` получил параметр `cookieHeader`, все три маршрута моков (GET превью, не-GET превью, публикация) передают `req.headers.cookie`; `sendMock` пробрасывает `set-cookie` как любой заголовок ответа. Это учебная имитация входа для прототипов, не защита данных.
