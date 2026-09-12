---
title: Backend изнутри: сборка, маршруты, сессии и сервисы
updated: 2026-09-12
checked: e1ce913f
areas:
  - apps/server/src
  - apps/image-studio/src
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
`/snapshots/:sid/restore`, `/reset`; все проверяют `core.conversation(uid, id)` (порт `MakeCore`, см. ниже) и
`assistantKind === 'make'`. Превью и ZIP — `/api/preview/make/:id/*` и `…/export.zip`: под
префиксом `/api/preview/` действует preview-cookie (`users/auth.ts`, `previewSession` принимает
`startsWith('/api/preview/make/')`). HTML отдаётся с CSP `default-src 'self' 'unsafe-inline'
'unsafe-eval' data: blob: https:; frame-ancestors 'self'` и инъекцией `MAKE_INSPECTOR_SCRIPT`.
ZIP — собственный писатель без сжатия (`make/zip.ts`). События — `MakeHub` (`make/hub.ts`),
сессия подписывается через `deps.make.subscribe` (как relay превью); владельца разговора для
MCP даёт `core.conversationOwner(id)`. Старый исследовательский план — `plans/figma-make-analog.md`.
Публикация: `.publish.json` в папке проекта + индекс `make/.published/<token>.json` → маршрут
`/p/:token/*` без auth (публикация переживает `reset`, повторный `publish` не меняет токен). Фоновая очистка (roadmap-2 п.16): `MakeWorkspaces.sweep(maxAgeMs = 30 дней)` обходит все проекты и удаляет снимки старше срока (кроме закреплённого в публикации и самого свежего) и PNG-снимки стори того же возраста; `server.ts` запускает её после старта и каждые 6 часов рядом с `GeneratedCleanupService` (не в VITEST), результат — в лог `make_sweep`.
**`.publish.json` пишется через временный файл и `rename`.** Счётчик просмотров
идёт фоном (`void countView(...)` в маршруте отдачи), а обычный `writeFile`
сначала усекает файл: читатель, попавший в это окно, получал обрезанный JSON и
`publishRaw` отвечал `null`. Хуже всего это било по `unpublish` — на `null` он
не удалял ни индекс, ни сам файл и возвращал успех, а ссылка `/p/<token>/`
оставалась живой. В гейте то же окно давало плавающий провал `rest.test.ts`
(«после снятия — 404», приходило 200). Поэтому: запись атомарна, `unpublish`
удаляет `.publish.json` в любом исходе, а при нечитаемом файле ищет записи
индекса обходом `make/.published/` по `conversationId`.

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

`registerPreviewProxy()` подключается из модуля Web Reader (`reader/module.ts`, см. раздел
«Web Reader» ниже) и обслуживает защищённый `/api/preview` — маршрут зарегистрирован как `all`, то есть
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

Текущее приложение доступно по `https://app.internal/` без операторского алиаса.
`ReaderCore.projectResource` доставляет ресурс встроенному Fastify через app.inject
(`readerBridge/projectResource.ts`), standalone вызывает тот же порт по RPC. Это
всегда своё ядро: путь не выбирает сетевой хост. Host имеет логическое значение
app.internal для генерируемых приложением абсолютных ссылок. Авторизация вложенной
страницы отдельная — только её Bearer/cookies, внешняя сессия не подставляется.
Бинарное тело сохраняется в base64-контракте, ответ ограничен 5 MiB.
`previewProjectLoader.ts` обрабатывает до пяти внутренних redirect с cookie/hash,
сохраняет метод/тело 307/308, ограничивает всю цепочку 10 секундами и прекращает её
после позднего ответа. Служебные /internal, /mcp и рекурсивные /api/preview закрыты;
встроенная diagnostics остаётся специальным разрешённым ресурсом. Ответы приложения
имеют private,no-store. UI канонизирует скопированный собственный URL до доставки;
сервер также распознаёт точный Host текущего запроса. Проверки: previewProject.test,
projectResource.test, previewProjectLoader.test, readerRemote.integration и
webReaderOwnProject/webReaderProject.e2e.test.ts (реальный вход без aliases).

Алиасы Web Reader читаются в `reader/module.ts` непосредственно из
`process.env.VC_BROWSER_HOST_ALIASES` при создании локального модуля. Передача
похожего поля через `loadConfig({...})` в тесте не меняет эту среду: in-process
стенд должен явно задать и затем восстановить переменную, как в
`e2e/webReaderModel.e2e.test.ts`. Созданный Web Reader-разговор имеет scope
`web-reader`; чтение `/api/conversations/:id` в таком стенде требует
`?scope=web-reader`, ответ содержит `{conversation, messages}`.

CSS разбирается PostCSS, значения — postcss-value-parser (`previewStyles.ts`):
переписываются настоящие url(), строковый @import и строковые источники image-set;
CSS escapes декодируются до URL. Комментарии и content-строки сохраняются,
fragment-only SVG-ссылки остаются локальными. Повреждённый CSS возвращается исходным.
Тот же разбор работает для внешней таблицы, style-блока и атрибута.
Srcset сканируется по URL/дескрипторам, поэтому запятые в data URL и именах файлов
не превращаются в разделители; imagesrcset у preload обрабатывается так же.
Проверки: `previewStyles.test.ts`, `e2e/webReaderStyles.e2e.test.ts`.

HTML разбирается `parse5` в `routes/previewHtml.ts`, правятся диапазоны исходных
атрибутов: entities декодируются перед разрешением URL, поддерживаются значения
без кавычек и `formaction`, строки скриптов/комментарии и `data-*` сохраняются.
Первый `<base href>` задаёт базу ресурсов и fetch/XHR; сами base удаляются, чтобы
относительные адреса прокси оставались на origin Reader. Якоря `#…` сохраняются,
`target=_blank|_parent|_top` заменяется на `_self`. Integrity у script/link снимается,
поскольку тело CSS/модуля меняет прокси; импорты inline `type=module` также
переписываются. `previewModules.ts` использует AST Acorn для настоящих импортов
(включая absolute URL, escapes, статические template literals и комментарии),
реэкспортов и ресурсов `new URL(..., import.meta.url)`. Это относится и к JS
публичного сайта без machine/alias; текст строк и комментариев сохраняется.
Явные mappings в inline import map переписываются в те же URL прокси.
Вставка context/inspector использует позиции настоящих head/body,
поэтому HTML-строки внутри JavaScript её не сбивают. Регрессии:
`previewHtml.test.ts`, реальные переходы/ресурсы Chromium —
`e2e/webReaderHtml.e2e.test.ts` (порт выбирается автоматически, без данных прода).

Cookies сайтов хранит `PreviewCookieStore` (`previewCookies.ts`, tough-cookie 5.1.2):
отдельный CookieJar пользователя в экземпляре Reader. Host-only, граница Path,
default-path, приоритет Max-Age над Expires, Secure и префиксы __Host-/__Secure-
повторяют правила браузера. Общие Domain `machine.internal`/`internal` не принимаются:
разные окружения машин не должны делить сессии. Повреждённые и больше 4096 символов
Set-Cookie пропускаются отдельно, регистр имени заголовка не важен. Cookies каждого
redirect сохраняются до следующего запроса. HTTP reset и MCP clearCookies используют
один контейнер модуля; закрытие сервера очищает его. Глобальные функции сохранены
только для старых чистых тестов, рабочие маршруты их не используют. Регрессии:
`previewCookies.test.ts`, `reader/module.cookies.test.ts`, `webReaderCookies.e2e.test.ts`.

Кэш ресурсов машины принадлежит экземпляру `registerPreviewProxy`, ключ включает
машину, пользователя и URL. Доступ и online проверяются до чтения/304; браузер
получает `private, no-cache`, чтобы отзыв прав замечался сразу. JSON не кэшируется.
`previewCachePolicy.ts` исключает запросы с cookie/Authorization сайта, повторную
загрузку и Range, а также ответы с private/no-store/no-cache, Vary и Set-Cookie;
более строгий upstream no-store сохраняется до браузера. Мутации очищают старые
ресурсы машины. HTTP-регрессии — `previewCache.integration.test.ts`, браузерные —
`e2e/webReaderCache.e2e.test.ts`.

Текстовый ответ декодирует `previewResponse.ts`: BOM имеет приоритет, затем HTTP
charset, meta charset/http-equiv HTML, декларация XML или CSS @charset; fallback
UTF-8. Переписанные HTML/CSS/JS всегда объявляются браузеру как UTF-8. JSON и бинарь
не проходят текстовое преобразование, в том числе при чтении собственного ядра.
Gzip/br/deflate распаковываются до переписывания в каждом транспорте; заголовок
Content-Encoding снимается, лимит 5 MiB проверяется и после распаковки. Повреждённый
поток, неподдерживаемое сжатие и превышение лимита возвращают понятную ошибку;
пустой HEAD/204 не отправляется в декомпрессор.

Общая политика redirect сохраняет PUT/HEAD и 307/308 с телом; 301/302 переводят
в GET только POST, 303 — всё кроме HEAD. После сброса тела удаляются его заголовки,
при смене origin — авторизация; неявный fragment наследуется, явный пустой сбрасывает
его. Локальный адрес машины и HTTP app.internal сначала возвращаются к логическому
origin, чтобы не потерять авторизацию собственного сайта. Не-HTTP redirect закрыт.
Проверки: `previewResponse.test.ts`, `previewResponse.integration.test.ts`,
`webReaderEncoding.e2e.test.ts`.

DOM-действия click/type/set используют `previewInteractions.ts`: выбирается
единственная видимая цель, а неоднозначность возвращает кандидатов вместо первого
случайного элемента. Учитываются disabled/fieldset, aria-disabled/inert, readonly,
maxlength, нетекстовые input и отключённые option/optgroup. Ввод проходит отменяемый
beforeinput и InputEvent; неверное число/дата не стирает прежнее значение. Click
воспроизводит pointer/mouse-последовательность и фокус. Set проверяет фактическое
состояние checkbox после отменяемого click; radio нельзя снять как checkbox.
Проверки: `previewInteractions.test.ts`, `webReaderInteractions.e2e.test.ts`.

`press` в прокси использует `previewKeyboard.ts`: dispatchEvent сам не запускает
нативные действия клавиши, поэтому после отменяемых keydown/keypress выполняются
ввод/удаление через beforeinput/input, выделение, Tab-порядок, Enter формы с
валидацией, Space checkbox и выбор option стрелками. Keyup отправляется и после
отмены keydown. Сочетания разбираются на key/code/модификаторы, ControlOrMeta
выбирает платформу; удаление не разрывает Unicode code point. У contenteditable
удаление не выходит за границы блока. Это ограниченная эмуляция, системные shortcut
и все действия редакторов она не заменяет; для них доступен полный Chromium.
Проверки: `previewKeyboard.test.ts`, `webReaderKeyboard.e2e.test.ts`.

Чтение `read/find/a11y` использует `previewReading.ts`: обход видимых текстовых
узлов исключает script/style, скрытое и инспектор; выбранный корень включается
в результат. Подписи учитывают aria-labelledby (все ID, включая скрытые ссылки),
aria-label, связанные label и alt иконок. Дерево доступности исключает aria-hidden
и inert, сообщает роли и состояния checked/expanded/selected/disabled/readonly/
required/invalid. Значения чувствительных input/textarea не попадают в read,
включая текстовое содержимое textarea. Это компактная DOM-модель, не полная
реализация алгоритма доступного имени браузера. Проверки — `previewReading.test.ts`
и `webReaderReading.e2e.test.ts`; типы дополнительных полей — `previewActions.ts`.

Контекст хранилищ (`previewStorage.ts`) сохраняет интерфейс Storage: свойства,
присваивание/delete, Object.keys/JSON, prototype/instanceof, стабильные методы,
DOMString и обязательные аргументы. Ключи native local/sessionStorage имеют префикс
логического origin; clear удаляет только его значения. События storage чужого
origin подавляются, свои получают логические key/url и правильный storageArea.
IndexedDB.open/deleteDatabase/databases и IDBDatabase.name используют те же
исходные имена поверх namespace; базы другого сайта не перечисляются. Если getter
localStorage запрещён браузером, остальные мосты продолжают запуск, а это хранилище
получает временный in-memory fallback. Chromium-проверки: `webReaderStorage.e2e.test.ts`.

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
фрагмент целевого адреса (`http://…/#/machines`) живёт внутри query `?url=`.
Context-шim канонизирует его в `location` через нативный `replaceState` до запуска
приложения, без дополнительного шага истории; после redirect используется конечный
URL ответа. Обёртки `pushState/replaceState` сохраняют настоящий hash и уведомляют
мост; hashchange/popstate тоже отправляют ready с логическим адресом (включая
очищенный hash). `pageInfo` и выбор элемента возвращают этот же адрес. После
pagehide/pageshow восстанавливается обработчик команд — BFCache не оставляет
живую страницу с отключённым мостом. Chromium: `webReaderNavigation.e2e.test.ts`.

Ресурсы, созданные JavaScript после загрузки, синхронно переписывает
`previewResources.ts`: URL-свойства DOM, setAttribute/NS, srcset, inner/outerHTML,
insertAdjacentHTML и ShadowRoot.innerHTML. MutationObserver здесь опоздал бы:
запрос начинается до его callback. Getter возвращает URL сайта; document.URL,
documentURI/baseURI следуют логическому SPA-адресу. SRI снимается с переписываемых
script/link. CSSOM, document.write и srcdoc этот слой пока не эмулирует.
Проверка реальной загрузки ресурсов — `e2e/webReaderResources.e2e.test.ts`.

Нативные формы и динамические ссылки обрабатывает `previewNavigation.ts` внутри
context-шима. GET собирает successful controls через `FormData(form, submitter)`
и заменяет query исходного action перед оборачиванием, иначе браузер удаляет
служебный `?url=`. Пустой action использует адрес текущей страницы; учитываются
formaction/formmethod. POST остаётся нативным (включая multipart и файлы), меняются
только action/target. Программный `form.submit()` проходит тот же маршрут.
Обработчики на window пропускают отменённые приложением события и dialog-формы.
Динамические ссылки, включая Shadow DOM, выбираются через composedPath и
оборачиваются перед default action. Якоря, download, специальные схемы и
модифицированные клики сохраняют отдельную нативную семантику. Проверки:
`previewNavigation.test.ts`, `e2e/webReaderForms.e2e.test.ts`.

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

По завершении сервер сохраняет AI message и метаданные в SQLite, обновляет conversation и отправляет `done`. Каждый возвращаемый `Conversation` содержит серверный агрегат стоимости сохранённых AI-сообщений: `costUsd` и `costStatus` (`known`, `partial`, `unknown`). Источник расчёта — `conversationCosts` в `apps/server/src/db/database.ts`: он связывает фактический `messages.engine` и `meta.model` с `model_prices`, используя `conversations.llm_model` только как fallback модели. Обычный вход равен `max(inputTokens - cacheReadTokens, 0)`, чтение и создание кэша и output тарифицируются отдельно. AI-ход считается известным только при числовых input/output (и, если присутствуют, cache) usage и найденном тарифе для provider/model; все известны — `known`, известна лишь часть — `partial`, нет ни одного известного или AI-ходов ещё нет — `unknown`. Для `partial`/`unknown` `costUsd` равен `null`, чтобы известная часть или отсутствие usage не выглядели полной нулевой суммой.

**Итог кэшируется в самой беседе** (`conversations.cost_usd`, `cost_status`, `cost_prices_stamp`, `cost_dirty`): полный агрегат сканирует все AI-сообщения беседы и разбирает JSON каждого, и на списке сайдбара это было 95% его времени (17.5 мс на 22 беседы, 353 мс на 158). Протухание ловят **триггеры** на `messages` (INSERT/UPDATE/DELETE → `cost_dirty = 1`), а не вызовы по коду: сообщения пишет десяток мест (ход, правка, откат, импорт legacy), и любое забытое давало бы устаревшую цену в списке — ошибку, которую никто не заметит. Смену прайса ловит `cost_prices_stamp` (`MAX(updated_at)` и число строк `model_prices` — второе нужно, чтобы заметить удаление цены). Триггеры снимаются в начале миграций и создаются в конце: пересборка `conversations` (DROP + RENAME) падает, пока жив триггер с телом, ссылающимся на эту таблицу. После кэша список стоит 0.6 мс на окно недели и 7 мс на все 158 бесед.

Список и поиск считают агрегаты одним batch-запросом для всех возвращаемых разговоров; одиночное чтение применяет тот же расчёт. Невалидный исторический JSON `messages.meta` изолируется через `json_valid`, а ошибка агрегации оставляет разговоры доступными со статусом `unknown`. Агрегат вычисляется из сохранённых сообщений при каждом чтении, поэтому восстанавливается после повторного открытия БД.

По cancel/error менеджер ходов снимает handle и очищает map. Пользовательский cancel после уже полученной дельты сохраняет partial как AI message с `meta.interrupted=true` и отправляет `done` с этим partial; поздний callback модели игнорируется. Тест не должен ждать пустой `done`, если мок успел отдать токен: такое ожидание держало Vitest до глобального 10-минутного timeout. Проверка identity текущего turn не позволяет позднему callback старого процесса удалить новый ход того же разговора.

Очередь разговора хранится в SQLite и исполняется сервером по одному элементу в FIFO-порядке. Завершение, ручная остановка и ошибка активного LLM-хода освобождают слот и вызывают следующий ожидающий элемент. При ошибке исходная реплика сохраняется в очереди со статусом `failed`, но пауза не включается: автоматическая выборка `takeQueuedTurn` рассматривает только `queued`, поэтому ошибочный элемент остаётся видимым для пользователя, не запускается повторно и не блокирует последующие сообщения. Идемпотентность по `messageId` и авторитетные снимки очереди защищают от дублей при повторной отправке и realtime-подтверждении. Источники — `apps/server/src/turns.ts` и методы очереди в `apps/server/src/db/database.ts`.

Пользовательские CLI-профили изолированы в `dataDir/cli-users/<base64url(логин)>/...`; `cliProfiles.ts` (переехал в `apps/llm-runner/src/cli/`) создаёт HOME/config и environment. Это не контейнерный root profile. Login status читается отдельно для каждого профиля.

## SQLite и репозитории данных

`VoiceChatDb` — синхронный адаптер `better-sqlite3`: ядро (`db/database.ts`) при создании выполняет идемпотентную DDL и миграции старых колонок и раздаёт доменные репозитории `db.chat`, `db.tasks`, `db.ci`, `db.machines`, `db.identity` и т.д. (`db/repos/<домен>.ts`, по одному владельцу на таблицу — `db/ownership.ts`). Маршруты и сервисы зовут методы адресно и асинхронно (`await db.projects.getProject(...)` — поля `db.<домен>` это `AsyncPort<Repo>`), а зависимости-интерфейсы в тестах описываются той же формой `{ projects: { getProject: async () => … } }`. Сообщения одного WS-сокета обрабатываются строго по очереди (`ws.ts`): обработчики асинхронны, а порядок `audio.start → чанки → audio.stop` — часть контракта. WAL разрешает читателям не блокировать обычную запись; foreign keys обеспечивают cascade для conversation/project children. Подробнее — [data-auth.md](data-auth.md#схема).

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


## Канбан-кластер: `kanban/module.ts`, порты `KanbanCore` и `KanbanService` (2026-09-07)

Проекты, доска, подготовка задач, раны CI (`ci/runManager.ts`, `ci/modelHooks.ts`), QA-стадии, релизы,
мерж-раны, автопилот, MCP канбана и CI-команд, оркестрация планов собираются одной функцией
`createKanbanModule(deps)` (`apps/server/src/kanban/module.ts`); `buildServer` зовёт её один раз. Граница
описана двумя портами (`docs/plans/kanban-service.md`):

- **`KanbanCore`** (`kanban/core.ts`) — что кластер берёт у *процесса* ядра: `machines` (узкий фасад
  `KanbanMachines` — `isOnline`, `exec`/`execStream`, `fs*`, `gitAccess`, тоннели; `AgentRegistry`
  удовлетворяет ему структурно), `kb` (файловый индекс базы знаний), `uploads.get`, `widgets` (снимок экрана
  виджета и мост UI для mcp__kanban__*), `ensureProjectMainCurrent`. Локальная реализация —
  `kanbanBridge/localCore.ts`. Доменные данные чужих доменов (`db.chat`, `db.identity`, `db.machines`, …)
  кластер читает сам: отдельный сервис канбана будет работать на той же базе.
- **`KanbanService`** (`kanban/service.ts`) — что ядро берёт у кластера: `runs` (лента кадров ранов и
  снимок для `ci.subscribe`), `board` (`changed` для соседей вроде Make и подписки доски, подготовки,
  QA-стадий, репозиториев задач, очереди улучшений), `notifications`. `BoardHub`/`NotificationHub`
  живут внутри модуля; `server.ts` обращается только к `kanban.service.*`.

Кадры самого ядра (журнал команд машины `machine.command`, тревоги watchdog, снимки браузерной проверки
`ci.log`) идут через шину `UserFrameHub` (`frameHub.ts`), а не через ленту канбана; WS-сессия подписана
на обе (`SessionDeps.frames`, `SessionDeps.ci`). Остальные зависимости кластера (`KanbanDeps`, 20 полей:
`db`, LLM-клиенты, `kbUsage`, `make.service`, адреса MCP, `mcpSecret`, `browserRunner`, `mailer`, тестовый
`ciExecutor`, …) — клиенты и настройки, которые отдельный процесс поднимет из своего env.

Гейт `kanban/boundary.test.ts` держит: маркеры сборки только в модуле, снимок ключей `KanbanDeps`,
аллоулист импортов-значений кластера из ядра (`db/database`, `kb/*`, `users/auth`, `llm/remoteClient`,
`manifests`, `mcp/previewMcp`), запрет типов состояния ядра вне `kanban/core.ts` и структурную проверку
фасада машин. Чистые функции подготовки (`parseQaPreparationResponse`, `taskPreparationModel`,
`taskPreparationFailure`) — `kanban/preparation.ts`, из `server.ts` реэкспорт. В `server.ts` из этого
блока остались git-панель (`GitWorkspaceService`), Storybook/компоненты проекта и watchdog машин.

**Режим `VC_KANBAN_MODE=remote` (2026-09-07).** Кластер работает отдельным процессом на той же базе
(только Postgres): точка входа `kanban/standalone/index.ts`, сборка `buildKanbanServer` (тот же
`loadConfig`, тот же `createKanbanModule`). Порт `KanbanCore` там реализует `HttpKanbanCore`: синхронные
чтения о машинах (`isOnline`, `nameOf`, `policyOf`, `telemetryOf`, …) отвечает зеркало `MachinesMirror`,
которое ядро наполняет пушем `POST /internal/machines` после каждого `AgentRegistry.onChange` (с задержкой
250 мс); `exec`/`execStream` идут потоковым NDJSON-эндпоинтом ядра `/internal/kanban/exec-stream` через
`node:http` (без таймаута тела, обрыв по `signal` отменяет команду); остальное — RPC `/internal/kanban/core`
(`kb.*`, `uploads.get`, `widgets.*`, `ensureProjectMainCurrent`, `machines.fs*`/`gitAccess`/тоннели).
Обратные вызовы тоннелей превью хранит канбан, ядро спрашивает их RPC `authorizeTunnel`/`tunnelClosed` на
`/internal/service` канбана (там же `snapshot` рана и `boardChanged` от Make). События кластера (кадры
ранов, доска, подготовка, QA-стадии, репозитории, улучшения, уведомления) канбан шлёт ядру пачками на
`/internal/kanban/events`; `kanbanBridge/remote.ts` воспроизводит их на локальных лентах `KanbanService`.
Вложения канбан читает через порт (`uploads.read`, байты base64) — общий том с ядром ему не нужен;
список живых превью для preview-MCP чата — `KanbanService.previews.list()`. Авторизация у канбана —
пересылкой в `/internal/whoami` ядра (`internal/forwardedAuth.ts`, кэш чтений 30 с); снаружи пути канбана идут только через прокси ядра `kanbanBridge/proxy.ts` (`KANBAN_PROXY_PREFIXES`),
где preHandler ядра уже проверил права проекта. Контракт протокола — `kanban/internal.ts`, транспорт RPC
общий с Make — `@voicechat/shared` (`internalRpc.ts`). Интеграционный тест границы —
`kanbanBridge/kanbanRemote.integration.test.ts`. Кадры самого ядра в этом режиме, как и во встроенном,
идут через `UserFrameHub`.

## Web Reader: самостоятельное приложение (2026-09-10)

`apps/web-reader` владеет прокси `/api/preview*`, переписыванием HTML/CSS/JS,
контейнером cookie и MCP `/mcp/preview`. `createReaderModule` собирает эти части;
ядро подключает его через публичный `@voicechat/web-reader` только в embedded.
`apps/web-recorder` — iframe-документ того же продукта: собирается внутрь образа
Web Reader и раздаётся под `/web-recorder/`. React-панель хоста остаётся отдельным
артефактом `web-reader-ui` (`packages/web-reader-app`).

`ReaderCore`, HTTP-клиент, RPC whitelist и подписанные токены вынесены в
`packages/web-reader-contracts`. Приложение не открывает БД и не импортирует
`apps/server`. `context` возвращает доступные машину, тестовых пользователей,
feature-preview окружения и проектную политику. `canUseMachine`, `machineOnline`
и `machineHttp` обращаются к реестру ядра; сам `machineHttp` повторно проверяет
доступ, поэтому прямой RPC не обходит разрешения. Контекст чужого разговора —
`null`. `projectResource` доставляет ресурсы `app.internal`, сохраняя отдельную
авторизацию вложенной страницы. `previewAction` обращается к WS relay ядра;
ключи Chromium, кадры CI и старые методы порта также остаются у владельца данных.
Локальная реализация — `apps/server/src/readerBridge/localCore.ts`.

Standalone `apps/web-reader/src/standalone/index.ts` слушает 8795. Ему нужны
`VC_CORE_URL`, `VC_INTERNAL_TOKEN`, `VC_MCP_SECRET` и адрес Playwright API
`VC_PLAYWRIGHT_READER_URL` (по умолчанию embedded API ядра). `VC_DB_URL` и общий том
ядра не нужны. Авторизация каждого API-запроса пересылается в `/internal/whoami`
с cookie/Bearer/CSRF без кэша прав. Ядро с `VC_READER_MODE=remote` и `VC_READER_URL`
проксирует `/api/preview*`, `/mcp/preview` и `/web-recorder*`; конкретные маршруты
Make сохраняют приоритет. `VC_READER_MCP_PUBLIC_BASE` переопределяет адрес MCP для
LLM; helper `reader/mcpBase.ts` общий для ядра и канбана. Cookie сайтов остаются
в памяти Reader, поэтому перезапуск сервиса сбрасывает входы в HTTP-прокси.

Chromium исполняет `PlaywrightReaderService` из `packages/playwright-reader-contracts`:
Web Reader вызывает приложение Playwright по HTTP, не включает его реализацию.
`packages/browser-contracts` содержит лёгкий клиент раннера и валидацию адресов;
ни один API-образ Reader не содержит движок Chromium или драйверы БД.
Токены `createPreviewTurnTokens(mcpSecret)` живут сутки, подписаны HMAC и работают
между процессами без регистрации в памяти. WS `PreviewActionRelay` создаёт ядро;
перенос библиотеки контрактов не переносит владение его подключениями.

Web Reader требует API ядра >=1.1.0; старое ядро без `context`/`machineHttp`
отвергается при проверке манифеста. Изолированный гейт — `gate:app -- web-reader`,
Playwright — `gate:app -- playwright-reader`; проверки UI-панелей имеют суффикс
`-ui`. Тесты `readerBridge/readerRemote.integration.test.ts` и
`playwrightReaderBridge/remote.integration.test.ts` проверяют HTTP-границы без общей
БД. `e2e/webReaderProject.e2e.test.ts` проверяет вход и deep link собственного
проекта в embedded и отдельном процессе Reader.

## Машины: модуль `machines/module.ts` и порт `MachinesService` (2026-09-07)

Реестр онлайн-подключений (`agents/registry.ts`), WebSocket компаньон-агентов `/agent`, REST машин и
установщиков (`routes/agents.ts`), политика команд, каталог ChatAI по умолчанию, журнал команд, watchdog и
перенос хранилищ собираются одной функцией `createMachinesModule(deps)` (`apps/server/src/machines/module.ts`);
наружу модуль отдаёт `{ machines, commandGate }`. Потребители — сессия, ходы, `mcp/remoteBashMcp`,
`mcp/consoleMcp`, git-панель, storybook-сессии, превью, админка, канбан (через `KanbanMachines`), Make (через
`MakeCore.machineFs`) — типизированы портом **`MachinesService`** (`machines/service.ts`): публичная
поверхность реестра без `register`/`unregister`; `AgentRegistry` удовлетворяет ему структурно. Синхронные
чтения (`isOnline`, `nameOf`, `versionOf`, `telemetryOf`, `ptyLive`, …) остаются синхронными — в режиме
отдельного процесса машин их будет отдавать зеркало. Полный лог долгой команды из чата модуль пишет в
artifacts привязанного хранилища через обратный вызов ядра `chatArtifacts` (хранилища разговора — знание
ядра). Гейт `machines/boundary.test.ts`: `server.ts` не собирает машины сам, `AgentRegistry` импортируют
только модуль машин и его части. План выделения в отдельный процесс — `docs/plans/machines-service.md`.

**Режим `VC_MACHINES_MODE=remote` (2026-09-07).** Реестр живёт в отдельном процессе машин
(`machines/standalone/index.ts`, `buildMachinesServer`, порт 8793, compose-профиль `machines`), а ядро
получает порт как `HttpMachines` (`machinesBridge/httpMachines.ts`): синхронные чтения — из зеркала, которое
процесс машин наполняет по постоянному WebSocket событий `/internal/events` (снимки машин и PTY-сессий,
события PTY, кадры владельцам, `agentReady`, журнал команд, запросы авторизации тоннелей); вызовы — RPC
`/internal/rpc` и потоковый exec `/internal/exec-stream` (общий формат `internal/execStream.ts`). Ошибки
файловых операций возвращаются с кодом и восстанавливаются как `AgentFsError`; буфер PTY (`ptyBufferText`) —
полный, по RPC у процесса машин (тип у порта допускает `Promise`, консольный MCP ждёт `await`). При обрыве шины все машины
считаются offline до переподключения. Ядро переправляет в процесс машин REST машин и установщики
(`MACHINES_PROXY_PREFIXES`, `machinesBridge/proxy.ts`) и **WebSocket компаньон-агентов `/agent`** — кадр в
кадр, с исходным IP в `x-forwarded-for` (Caddy остаётся без изменений). Авторизация REST у процесса машин —
пересылкой в `/internal/whoami` ядра (`internal/forwardedAuth.ts`, общая с канбаном). Канбан и Make в этом
режиме ничего не замечают: под фасадами `KanbanMachines`/`MakeCore.machineFs` стоит тот же порт. Контракт —
`machines/internal.ts`; интеграционный тест — `machinesBridge/machinesRemote.integration.test.ts`.
Внутренний API машин (`machines/internalApi.ts`) ядро поднимает и во встроенном режиме при заданном
`VC_INTERNAL_TOKEN` — так соседи (админка) берут машины у того процесса, где живёт реестр, одним клиентом.

**Админка отдельным процессом (`VC_ADMIN_MODE=remote`, 2026-09-07).** `admin/standalone/index.ts`
(`buildAdminServer`, порт 8794, compose-профиль `admin`): `routes/admin.ts` на общей базе, авторизация —
пересылкой в ядро, машины — `HttpMachines` к `VC_MACHINES_URL` или к ядру, Make — по RPC, деплой и живое
уведомление об отзыве сессии — RPC к ядру `/internal/admin/rpc` (`admin/internal.ts`). Ядро проксирует
`/api/admin/*` (типы проектов `/api/admin/project-types*` остаются у канбана — его роуты конкретнее);
проверку роли `users:manage` делает preHandler ядра до прокси. Тест —
`admin/standalone/adminRemote.integration.test.ts`.

## Студия картинок ↔ ядро: отдельное приложение (2026-09-09)

Галереи, корзина, метаданные, API генерации/правки и публикации `/g/*` живут в
`apps/image-studio` (`@voicechat/image-studio`). `createImageStudioModule` собирает embedded,
`src/standalone/server.ts` — отдельный Fastify. Каталог `<dataDir>/image-studio` и формат файлов
прежние. UI `ImageStudioPane`, маршрут `#/images`, мосты и поллинг остаются в `packages/ui`.

Порт `ImageStudioCore` (`apps/image-studio/src/core.ts`) даёт студии сведения о разговоре
(`id`, `title`, `assistantKind` с проверкой владельца), переименование, генерацию и чтение
результата LLM. `imageStudioBridge/localCore.ts` ядра реализует его над DB/LLM и ограниченным
чтением профиля пользователя; `standalone/httpCore.ts` — через HTTP. Пакет студии не импортирует
сервер, Make, DB или исполнителей: границу проверяют тесты с обеих сторон. Настройки модели,
LLM и ретушь обычного чата остаются у ядра.

Обратный порт `ImageStudioService` — `promptContext` и `captureImages`: контекст галереи для хода
и сохранение картинок из fenced-блоков ответа. В remote ядро вызывает
`/internal/image-studio/service` и не создаёт `ImageStudioStore`. Файлы исполнителя передаются
в base64 через `readGenerated`, поэтому общий диск с профилями CLI не нужен. В compose прежний
том сохранён для доступа к существующим галереям; для другой машины достаточно перенести
каталог галерей и обеспечить HTTP-связь с ядром.

Контракт — `packages/shared/src/imageStudioInternal.ts`: короткие методы идут в
`/internal/image-studio/core`, генерация — отдельным долгим запросом
`/internal/image-studio/generate`. Отмена разрывает HTTP и останавливает LLM; `preClose` отменяет
раны и закрывает приём новых генераций, включая запросы с ещё незавершённой проверкой доступа.
Кнопка отмены возвращает 410, при остановке процесса прокси также может вернуть 503.
Бюджет генерации — 10 минут, API допускает 20 МБ JSON, внутренний запрос — четыре референса
по 12 МБ в base64. Слот генерации и лимитер пароля локальны: один экземпляр на каталог.
Авторизацию каждого приватного запроса ядро проверяет через `/internal/whoami`, включая CSRF.

Дефолт dev/desktop — `VC_IMAGE_STUDIO_MODE=embedded`; в compose — `remote`, URL
`http://image-studio:8796`, общий `VC_INTERNAL_TOKEN`. Caddy и прокси ядра сохраняют публичные
пути `/api/image-studio/*` и `/g/*`. Интеграция
`apps/server/src/imageStudioBridge/remote.integration.test.ts` проверяет embedded и remote
на реальных HTTP-портах с разными каталогами данных ядра и студии.

### Image Studio selections, version graph, and MCP (2026-09-12)

Localized image operations live in `apps/image-studio/src/selection.ts`. Sharp
validates the source raster with a 64-megapixel ceiling, converts rectangle,
lasso, or monochrome mask selections into a bounded crop, and composites model
output through that mask. The final compositor copies every pixel outside the
selection from the decoded source. Extraction emits a transparent PNG; placement
resizes the extracted object when requested and alpha-composites it on a base
image. Foreground discovery and the magic wand analyze a copy capped at 1000 px
on its longest side, then map their result back to natural image coordinates.

The file sidecars form a version graph through `source`, `operation`,
`restoredFrom`, and optional selection bounds. Restore is non-destructive: the
historical bytes are copied into a new node whose parent is the currently viewed
node. Renaming a file rewrites references from descendants and restored nodes.
The same store methods back the UI routes and MCP tools, so assistant changes and
manual changes appear in one history.

`POST /mcp/image-studio` is a stateless Streamable HTTP MCP endpoint scoped by
the signed `k`, `user`, and `conv` query values. It verifies that the user owns
an `images` conversation before exposing `image_list`, `image_open`,
`image_find_objects`, `image_generate`, `image_edit`, `image_retouch`,
`image_extract`, `image_place`, `image_restore`, `image_rename`, and
`image_delete`. `image_open` returns actual image content to the model. Plan
mode appends `ro=1`: list, open, and object discovery stay available while every
mutating handler refuses the call. Model-backed generation and retouch share a
per-conversation active slot.

The core generator names the exact `/studio/...` paths of the source crop,
mask, and references in its prompt. These names match attachment `serverPath`
values, allowing the shared LLM-runner attachment preparer to replace them with
temporary readable files for both embedded and HTTP CLI execution.

## Make ↔ ядро: порты `MakeCore` и `MakeService` (2026-09-07)

Серверная часть Make уже выделена в workspace `apps/make` (`@voicechat/make`) и умеет
запускаться отдельно (`src/standalone/index.ts`). В compose это сервис `make:8788`, а ядро
использует `VC_MAKE_MODE=remote`; для dev/desktop сохраняется `embedded`. Границу пакетов
проверяют `apps/make/src/boundary.test.ts` и `apps/server/src/makeBridge/boundary.test.ts`.
UI Make остаётся в `packages/ui` и собирается общим web-клиентом; авторизация, разговоры,
членство и пользовательские WS-соединения принадлежат ядру.

- **`apps/make/src/core.ts` — `MakeCore`, «что Make нужно от ядра»**: разговор и его владелец, проект
  Make-разговора и членство (`isProjectViewer`), Make-разговоры владельца (квота), связи
  «дизайн ↔ карточка» (`taskLinks`, `linkTaskDesign`, `unlinkTaskDesign`, `linkableTasks`,
  `taskDesigns`), `project`, `userExists`, `boardChanged`, файловый мост машины только на чтение
  (`machineFs`). Реализации — `apps/server/src/makeBridge/localCore.ts` над DB/машинами/канбаном
  и `apps/make/src/standalone/httpCore.ts` через HTTP к ядру. `apps/make/src/routes.ts` и
  `apps/make/src/mcp.ts` принимают `core`, а не `db`,
  и **не импортируют** `db/`, `users/`, `agents/`, `turns` — гейт это проверяет по тексту импортов.
- **`apps/make/src/service.ts` — `MakeService`, «что ядру нужно от Make»**: `promptContext` (блок промпта
  Make-чата), `turnSnapshot` (id снимка «До правок» для `meta.makeSnapshotId`), `listFiles`
  (проверка путей `makeSources` цикла доработки в `routes/projects.ts`), `taskSources`
  (Make-источники рана CI и подготовки задачи), `adminStats`/`metrics` (админка), `sweep`,
  `subscribe` (кадры `make.changed`/`make.presence` для WS-сессии). `turns.ts`,
  `ci/modelHooks.ts`, `routes/projects.ts`, `routes/admin.ts` получают `make?: Pick<MakeService, …>`
  и ничего больше о Make не знают. Вне композиции процессов и адаптеров `makeBridge/`
  ядро импортирует из `@voicechat/make` только типы; исключения перечислены в гейте границы.
- **`apps/make/src/module.ts` — `createMakeModule({ dataDir, core, mcpSecret, mcpBaseUrl })`** собирает
  мастерские, шину, библиотеку, роуты и MCP и отдаёт `service`; его создаёт ядро в embedded
  или `buildMakeServer` в отдельном сервисе.
- **Scope-токены рана (`apps/make/src/taskScope.ts`)** — HMAC-SHA256 над JSON `{ userId, projectId, taskId,
  sources, expiresAt }` секретом MCP (`?k=`), TTL 30 мин, вместо прежнего `MakeTaskScopeBroker` в
  памяти процесса: токен выдаёт ядро (`MakeService.taskSources`), проверяет MCP Make
  (`verifyTaskScope`); в remote это разные процессы. Содержимое — заявка: MCP сверяет его с
  актуальными `taskDesigns`, проектом разговора и членством (`authorizeTaskSource`).
- **Make — отдельный пакет `apps/make` (`@voicechat/make`), круг 2 (2026-09-07).** Код мастерских,
  роутов и MCP физически живёт там; ядро импортирует только типы портов и `createMakeModule`
  (гейт `makeBridge/boundary.test.ts`), пакет Make не импортирует ядро, `better-sqlite3` и
  исполнителей (гейт `apps/make/src/boundary.test.ts`). Два режима у ядра (`config.makeMode`):
  `embedded` (по умолчанию — dev, desktop, тесты: `createMakeModule` в процессе ядра) и `remote`
  (`VC_MAKE_MODE=remote`, `VC_MAKE_URL`, `VC_INTERNAL_TOKEN`, `VC_MCP_SECRET`): Make — отдельный
  процесс `apps/make/src/standalone` (`buildMakeServer`), ядро получает `MakeService` из
  `makeBridge/remote.ts` — RPC к `/internal/service` Make за `promptContext`/`listFiles`/`adminStats`/
  `metrics`/`sweep`, `taskSources` считает само (нужны секрет и `makeMcpBaseUrl`), `turnSnapshot` и
  `subscribe` — локальная `MakeHub`, которую наполняют события от Make. Внутренний API ядра
  (`routes/internal.ts`, регистрируется только при `VC_INTERNAL_TOKEN`, не под `/api/`):
  `POST /internal/make/core` — RPC порта `MakeCore` над `LocalMakeCore` (белый список методов —
  `CORE_RPC_METHODS` в `apps/make/src/internal.ts`), `POST /internal/make/events` — события шины
  Make (`changed`/`presence`/`turnSnapshot` → `hub.apply`), `POST /internal/whoami` —
  аутентификация пересланного запроса тем же кодом, что preHandler `/api/*` (`authenticate` из
  `registerAuth`: Bearer → cookie → preview-cookie, CSRF для мутаций по cookie,
  `password_change_required`). Процесс Make авторизации не имеет: `standalone/auth.ts` пересылает
  `cookie`/`authorization`/`x-vc-csrf` вместе с методом и путём в `whoami`, чтения кэширует 30 с по
  токену и классу пути (`/api/preview/` отдельно), мутации — каждый раз; ядро недоступно → 503
  `core_unavailable`. MCP `/mcp/make` в `remote` слушает Make, поэтому исполнителю отдаётся
  `VC_MAKE_MCP_PUBLIC_BASE` (без него — `VC_MAKE_URL`), а секрет `?k=` общий. Контракт `MakeCore`
  (local vs http) и интеграция «ядро + Make на двух портах» — `makeBridge/core.contract.test.ts`,
  `makeBridge/remote.integration.test.ts`.
- **Попутно найдено:** квота Make на пользователя считалась по пустому списку — `listConversations`
  без `scope` отдаёт только `chat`, а Make-разговоры живут в scope `make`; `LocalMakeCore.
  makeConversationIdsOf` теперь запрашивает `scope: 'make'`.
- Общие утилиты, исторически лежавшие в `make/`, переехали: `SlidingWindowLimiter` и `parseStoryFile`
  — в `@voicechat/shared` (чистые; вход, приглашения, студия картинок, компоненты репозитория),
  SSRF-гард `assertPublicHost`/`isPublicAddress` — `util/publicHost.ts` ядра (`routes/previewProxy.ts`
  оборачивает его в `PreviewProxyError(403)`) и намеренная копия `apps/make/src/publicHost.ts`.

## Публикация Make: сериализация мутаций файла (2026-09-03)

Все изменения `.publish.json` разговора идут через `withPublishLock` в
`MakeWorkspaces` — промис-цепочка на разговор (`publish`, `unpublish`,
`countView`). Причина: `countView` зовётся fire-and-forget из маршрута отдачи
и с read-modify-write без блокировки воскрешал публикацию — читал состояние до
`unpublish`, писал обратно после повторного `publish`, файл возвращался к
старому токену, и `publishedTarget` свежей ссылки отвечал 404 (плавающий
провал теста `/p/<token>/` в полном гейте). Атомарного rename в
`writePublishRaw` для этого мало: он спасает от рваного чтения, но не от
lost-update. Регрессионный тест — «переопубликация не воскрешает старый токен»
в `workspace.test.ts` (красная проверка: без лока падает сразу).
