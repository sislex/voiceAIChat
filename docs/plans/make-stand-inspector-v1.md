# make-stand-inspector-v1 — выделение элементов в кадрах стенда и историй

Ран `make-stand-inspector-v1`. Ветка задач — `dev`. Продолжение [make-stand-stories-v2](make-stand-stories-v2.md).

## Цель владельца

Во вкладках «Preview» (приложение стенда) и «Components» (Storybook рабочей копии) проекта Make щёлкнуть по
элементу и **залокейтить** его: проект, подпроект (пакет репозитория), компонент (имя и файл:строка), DOM-элемент.
Строка управления кадром в режиме стенда должна быть **той же, что у маленьких проектов Make**, с теми же
возможностями: ширины PC/Tablet/Phone/своя, три ширины рядом, выделение элемента ⌖, обновление ⟳,
комментарии к элементам 💬, скриншот, тема превью (светлая/тёмная/системная), язык документа, reduced
motion, медленная сеть, состояние элемента (hover/focus/active), консоль и сеть под кадром, панель стилей,
режим вопроса ❓, «⋯» и zen. Не применимо к стенду и прячется: публикация, загрузка файлов в проект,
хранилище/снимки маленького проекта, шаблоны.

Разработка должна идти **максимально параллельно**: задачи нарезаны по файлам, общие точки зафиксированы
контрактами ниже, зависимости — контрактные (`~`), где возможно.

## Уточнение владельца (2026-10-11)

Подключение стенда — это **настройка** беседы Make, а не отдельный вид. Переключатель «Small project / Project»
и шапка «Stand» с собственными вкладками уходят из основного вида: машина, стенд, ветка, подключение и
отключение, статус живого режима живут в диалоге настроек проекта (из «⋯» и из ⚙). Основной вид Make со
стендом **функционально не отличается** от Make с маленьким проектом: те же вкладки Preview / Code /
Components / Repository / History и та же строка управления, только данные берутся из рабочей копии на
стенде: Preview — приложение стенда, Components — истории Storybook рабочей копии, Code — файлы рабочей
копии, Repository — git рабочей копии (ветка, изменения, коммит, push), History — как для маленького проекта,
где применимо.

## Как это устроено сейчас

- Маленький проект: HTML превью отдаёт сервис Make (`/api/preview/make/<conversation>/…`) и перед `</body>`
  вклеивает `MAKE_INSPECTOR_SCRIPT` (`apps/make/src/routes.ts`). Панель `MakePane.tsx` общается с кадром
  через `postMessage`: `vc-make.inspect`, `vc-make.selected {selector, tag, text, html, id, className, styles}`,
  `vc-make.style`, `vc-make.text`, `vc-make.reorder`, `vc-make.state/restore`, `vc-make.env`, `vc-make.ready`,
  `vc-make.console`, `vc-make.network`, пины комментариев. Выбранный элемент показывается над кадром,
  подставляется в подсказку ассистенту, `MakeStylePanel` правит CSS проекта.
- Стенд: вкладка «Preview» — `<iframe>` в `MakeProjectStand.tsx` на `previewUrl` аренды прокси стенда
  (`http://<хост>:879x/…`, другой origin); вкладка «Stories» — `<iframe>` в `MakeProjectComponents.tsx` на
  `iframe.html?id=<story>` Storybook через прокси стенда или мост машины `/api/preview?url=…`. HTML отдают
  Vite/Storybook/Core UI, Make его не трогает: инспектора в кадре нет, кнопок управления нет.
- Core UI (React 18.3, `@vitejs/plugin-react` 4, Storybook 8 react-vite) в dev-сборке компилирует JSX через
  `jsxDEV`: у DOM-узла есть fiber (`__reactFiber$…`) с `_debugSource {fileName, lineNumber, columnNumber}`
  и `_debugOwner` (компонент-владелец, `type.name`). Этого достаточно для привязки к исходнику без
  изменений в core-ui. Компоненты базы стенда (не в живом режиме) собраны из пакетов — исходник недоступен.

## Решения

- **Инспектор — один и тот же скрипт** для маленьких проектов и кадров стенда. Make экспортирует его из
  пакета (`@sislexa/make` → `./inspector`) и отдаёт публичным маршрутом `GET /api/make/inspector.js`
  (без сессии, кэшируемый, с `ETag`). Для кадров стенда Core вклеивает `<script src="<origin ядра>/api/make/inspector.js">`
  в HTML-ответы прокси стенда и моста `/api/preview` (только `text/html`, только для аренд/мостов, выданных
  Make; остальные ответы проходят как есть). Скрипт принимает команды только от `window.parent`.
- **Локация элемента.** `vc-make.selected` дополняется полем `source`: `{ file, line, column, component,
  owners: [имена компонентов вверх по дереву, ≤ 5], package }`, где `file` — путь относительно корня
  рабочей копии (из `_debugSource.fileName`, с отрезанным корнем проекта `/@fs/`/абсолютного пути),
  `package` — первые два сегмента пути (`packages/ui`), как в группах «Stories». В Storybook добавляется
  `story: { id, title }` из `location`/`window.__STORYBOOK_PREVIEW__`. Без fiber-данных поле `source`
  отсутствует и панель пишет «компонент собран из пакета, исходник недоступен».
- **Одна строка управления.** Кадр стенда и кадр истории рендерятся тем же механизмом, что превью
  маленького проекта (`frameRef`, ширины, кадры-спутники, окружение, консоль/сеть, комментарии, стили),
  различается только источник кадра. Кнопки, не применимые к стенду, скрыты, а не задизейблены.
- **Действия с локацией.** Карточка выбранного элемента: проект → пакет → компонент (файл:строка) → DOM
  (`<tag> селектор «текст»`); кнопки «открыть в Code» (редактор рабочей копии на нужной строке),
  «в подсказку» (как «изменить значение» у маленьких проектов, но с файлом и строкой), «комментарий»,
  «стили» (предпросмотр inline как сейчас; запись — в CSS-файл рабочей копии, где найден селектор, иначе
  предложить файл пакета). Правка текста на месте и перетаскивание для React-кадров выключены: DOM ≠ исходник.
- **Стенд в настройках, вид один.** `MakePane` не ветвится на «маленький проект» и «проект»: источник
  данных (файлы маленького проекта или рабочая копия стенда) выбирается по настройкам беседы, а вкладки,
  строка управления и диалоги одни и те же. Пока стенд не подключён, вкладки Components/Repository работают
  как сейчас для маленького проекта.
- **Инструкция для пользователя**: подсказка на кнопке ⌖ в режиме стенда и раздел в базе знаний Make.

## Общий контракт (фиксируется планом, чтобы задачи шли параллельно)

- **Инспектор.** `apps/make/src/inspector.ts` экспортирует `MAKE_INSPECTOR_SOURCE` (чистый JS без обёртки) и
  `MAKE_INSPECTOR_SCRIPT` (`<script data-vc-make-inspector>` + source + `</script>`); `apps/make/src/routes.ts`
  импортирует их оттуда. Экспорт пакета `./inspector`. Маршрут `GET /api/make/inspector.js` —
  `application/javascript`, без аутентификации, `ETag`, `Cache-Control: public, max-age=300`.
- **Локация.** `apps/make/src/inspectorSource.ts` экспортирует чистую функцию
  `locateElement(node: Element, options: { href: string }): { source?: ElementSource; story?: { id: string; title?: string } }`
  (без DOM-зависимостей кроме переданного узла; fiber читается через `node[key]` для ключа с префиксом
  `__reactFiber$`), и `ELEMENT_SOURCE_SCHEMA` в `packages/make-contracts/src/messages.ts`:
  `source = { file: string, line: number, column?: number, component?: string, owners?: string[], package?: string }`,
  `story = { id: string, title?: string }`. Инспектор вызывает `locateElement` и добавляет его результат в
  `vc-make.selected`; старые поля без изменений. Функция включается в текст скрипта как строка
  (`INSPECTOR_SOURCE_LOCATOR` — IIFE без импортов), чтобы её можно было тестировать отдельно.
- **Инъекция в Core.** Аренда прокси стенда и мост получают флаг `inject: 'make-inspector'`:
  `standProxy.access(user, project, stand, host, port?, { inject?: 'make-inspector' })` и ответ `storybook/open`/
  `previewAccess` передают его; при флаге ответы `text/html` переписываются (тег `<script src="<scheme>://<host
  запроса>/api/make/inspector.js" data-vc-make-inspector>` перед `</head>`, иначе после `<body…>`), gzip/br/deflate
  распаковываются и заголовки `content-length`/`content-encoding` исправляются; при `Content-Security-Policy`,
  запрещающем внешний скрипт, тело не меняется; WebSocket и не-HTML проходят как есть.
- **Хост превью в Make.** `packages/make-app/src/components/MakePreviewHost.tsx` — компонент с пропсами
  `{ source: { kind: 'make', src: string } | { kind: 'frame', src: string, origin: string }, conversationId, features:
  { publish?: boolean, upload?: boolean, storage?: boolean, templates?: boolean, inlineEdit?: boolean, reorder?: boolean },
  onSelected?(selected: SelectedElement) }` и теми же возможностями, что у превью маленького проекта; выбранный
  элемент хранится в хосте и отдаётся наружу; `SelectedElement` = старые поля + `source?`/`story?`.
- **Карточка элемента.** `packages/make-app/src/components/MakeElementCard.tsx` с пропсами
  `{ selected: SelectedElement, projectName: string, actions: { openInCode?(file: string, line: number): void,
  addToPrompt(text: string): void, comment(selector: string): void, styles(): void } }`.
- **Настройки стенда.** `packages/make-app/src/components/MakeStandSettingsDialog.tsx` с пропсами
  `{ client, conversationId, projectId, api, localAgentId, onClose, onState(state: MakeStandResult | undefined) }`,
  содержит сегодняшнюю шапку `MakeProjectStand` целиком.
- Контракты `make-contracts` (кроме схемы `source`/`story`), маршруты Kanban и агент не меняются.

## Задачи интегратора (Claude, вне манифеста)

- Копия плана в `docs/plans/` репозитория Make до старта.
- После приёмки: выпуск Make → закрепление в Core → релиз ядра и деплой. Проверка на проде: «Проект 35» →
  настройки → стенд M2 → «Components» → ⌖ → клик по кнопке в истории ChatColumn → карточка показывает `packages/ui`,
  компонент, файл:строка, «открыть в Code» открывает файл на строке; «Preview» → ⌖ → клик → то же для
  живого компонента и «исходник недоступен» для базового; ширины, тема, консоль работают в обоих кадрах;
  шапки «Stand» и переключателя «Small project / Project» в основном виде нет.

| B01 | Make | B02~ | Shared inspector module and public route, per docs/plans/make-stand-inspector-v1.md «Общий контракт» (copy of the plan is in this repository): move the inspector body out of `apps/make/src/routes.ts` into `apps/make/src/inspector.ts` (`MAKE_INSPECTOR_SOURCE`, `MAKE_INSPECTOR_SCRIPT`), import it from routes, add the package export `./inspector` and the public route `GET /api/make/inspector.js` (`application/javascript`, `ETag`, `Cache-Control: public, max-age=300`, no session) registered for embedded and standalone Make; the inspector accepts `vc-make.*` commands only when `event.source === window.parent`; on click it calls the locator contract from B02 (`INSPECTOR_SOURCE_LOCATOR` string from `apps/make/src/inspectorSource.ts`; when the module is absent at merge time use a stub returning `{}` and leave a one-line TODO referencing B02) and spreads `source`/`story` into `vc-make.selected`; route tests and a DOM test that a message from a non-parent window is ignored; docs/kb/editor-preview-ui.md. Gate: `npm run gate:task -- --base <sha>`. |
| B02 | Make | — | Element locator for React dev builds, per docs/plans/make-stand-inspector-v1.md «Общий контракт» (copy of the plan is in this repository): `apps/make/src/inspectorSource.ts` exporting `locateElement(node, { href })` and the `INSPECTOR_SOURCE_LOCATOR` IIFE string with identical logic (one implementation, the string is produced from the function source and covered by a test that evaluates it): walk the React fiber of the node (`__reactFiber$*` key) up to the nearest fiber with `_debugSource`, return `file` relative to the working copy (strip `/@fs/`, the absolute root before `packages/` or `apps/`, Vite query strings), `line`, `column`, `component` (`_debugOwner.type.displayName|name`), `owners` (≤ 5 ancestors), `package` (first two path segments); in Storybook (`iframe.html` with an `id` query parameter) add `story: { id, title }` using `window.__STORYBOOK_PREVIEW__` when available; return `{}` without fiber data; add `ELEMENT_SOURCE_SCHEMA` (`source`, `story`) to `packages/make-contracts/src/messages.ts`; unit tests with fake fiber chains (nested owners, missing source, Vite `/@fs/` paths, Storybook URL). Gate: `npm run gate:task -- --base <sha>`. |
| B03 | Core | — | Stand proxy HTML injection, per docs/plans/make-stand-inspector-v1.md «Общий контракт» (copy of the plan is in Core): `apps/server/src/standProxy.ts` lease option `{ inject?: 'make-inspector' }` on `access(...)`, stored with the lease; for leases with the flag rewrite `text/html` upstream responses (buffer the body, decode gzip/br/deflate, insert `<script src="<scheme>://<incoming host>/api/make/inspector.js" data-vc-make-inspector></script>` before `</head>` or after `<body…>`, re-send with corrected `content-length` and without `content-encoding`), skip when `Content-Security-Policy` forbids external scripts or the body is not HTML; non-HTML, streaming and WebSocket upgrades pass through unchanged; tests with a fake upstream (plain, gzip, non-HTML, CSP, websocket, lease without flag); docs/kb/server-internals.md (stand proxy). Gate: `npm run gate:task -- --base <sha>`. |
| B04 | Core | B03~ | Machine-bridge injection and Make-issued leases, per docs/plans/make-stand-inspector-v1.md «Общий контракт» (copy of the plan is in Core): (1) the `/api/preview?url=…` bridge used by `storybook/open` for `stand:` workspaces (`apps/server/src/readerBridge/proxy.ts`, `routes/projectComponents.ts`) gets the same HTML rewrite as a shared helper `apps/server/src/htmlInject.ts` (export it so B03 can reuse it; if B03 lands first, switch B03 to the helper) applied only to sessions opened for Make; (2) `storybook/open` for `stand:` workspaces and `previewAccess` of `makeStand` (`server.ts`) request leases with `inject: 'make-inspector'`; other consumers keep today's behaviour; tests for both paths and for a non-Make lease staying untouched; docs/kb/server-internals.md. Gate: `npm run gate:task -- --base <sha>`. |
| B05 | Make | — | Preview host extraction, per docs/plans/make-stand-inspector-v1.md «Общий контракт» (copy of the plan is in this repository): move the preview frame machinery of `MakePane.tsx` (frame ref, width presets and custom width, three side-by-side widths with scroll sync, ⌖ inspect, ⟳, comments pins, screenshot, preview theme/language/reduced-motion/slow-network, element state, console and network panels, style panel, ❓ ask-only, «⋯», zen, open in new tab) into `packages/make-app/src/components/MakePreviewHost.tsx` with the props from the contract; the small-project preview renders through the host with identical behaviour (no visual or functional change; `features` all on); `source.kind === 'frame'` loads an arbitrary URL in the frame and talks to the injected inspector with `postMessage('*')` while checking `event.source`; `inlineEdit`/`reorder` features off disable `vc-make.text`/`vc-make.reorder` handling; existing MakePane DOM tests keep passing, new tests cover the frame source and the feature flags; docs/kb/editor-preview-ui.md. Gate: `npm run gate:task -- --base <sha>`. |
| B06 | Make | B02~, B05~ | Element location card and actions, per docs/plans/make-stand-inspector-v1.md «Решения» and «Общий контракт» (copy of the plan is in this repository): `packages/make-app/src/components/MakeElementCard.tsx` shows project → `source.package` → `source.component` with `file:line` (and the story title when present) → `<tag> selector «text»`, or «component built from a package, source unavailable» (with the package name when derivable) when `source` is missing; actions «open in Code», «add to prompt» (extends today's «change element value» text with file, line and component), «comment», «styles»; the card is rendered by the preview host above the frame in place of today's selected-element strip when `source` or `story` is present, today's strip remains for small projects without `source`; i18n ru/en; DOM tests for both renderings and all actions. Gate: `npm run gate:task -- --base <sha>`. |
| B07 | Make | — | Stand settings dialog, per docs/plans/make-stand-inspector-v1.md «Уточнение владельца» and «Общий контракт» (copy of the plan is in this repository): `packages/make-app/src/components/MakeStandSettingsDialog.tsx` hosts today's stand header from `MakeProjectStand.tsx` (machine/stand selector, new or existing branch, Connect/Disconnect, Refresh stand status, readiness and live state, errors) and the connected-repository link (`MakeConnectedProject.tsx`), reports the stand state through `onState`; `MakeProjectStand` keeps rendering its body (Preview/Code/Stories) unchanged for now so the dialog can ship independently; the dialog is reachable from the «⋯» menu and from the conversation ⚙ settings; DOM tests: connect, disconnect, status refresh, error display; i18n ru/en; docs/kb/project-mode.md. Gate: `npm run gate:task -- --base <sha>`. |
| B08 | Make | B05 | Stand frames through the preview host, per docs/plans/make-stand-inspector-v1.md «Решения» (copy of the plan is in this repository): the stand «Preview» (`state.previewUrl`) and the story frame of `MakeProjectComponents.tsx` (`frameUrl`) render through `MakePreviewHost` with `source.kind === 'frame'`, `features` hiding publish/upload/storage/templates and turning off `inlineEdit`/`reorder`; the Stories list, Storybook start/stop/restart/log and the Code editor keep working; the card from B06 appears when the host reports a selection with `source`/`story` (`onSelected`) — «open in Code» opens the working-copy file in the stand Code editor at the line; DOM tests for both frames (toolbar present, hidden controls, open-in-Code wiring); docs/kb/project-mode.md. Gate: `npm run gate:task -- --base <sha>`. |
| B09 | Make | B07~, B08 | One Make view with the stand as a setting, per docs/plans/make-stand-inspector-v1.md «Уточнение владельца» (copy of the plan is in this repository): (1) remove the «Small project / Project» source switch and the stand header from the main view; the pane derives its data source from the conversation settings (connected stand with a live working copy → stand source, otherwise small-project source) and opens `MakeStandSettingsDialog` from «⋯»/⚙; (2) the standard tabs serve the working copy when a stand is connected — Preview = stand application frame (B08), Components = stand Storybook (today's «Stories» tab contents), Code = working-copy file tree and editor with the existing stand file operations, Repository = working-copy git state (branch, changed files, commit, push, pull) with the existing stand git operations, History = as for small projects where the stand source supports it, otherwise an explanation; (3) the stand status (ready/installing/degraded) is a compact toolbar indicator that opens the settings dialog; the tooltip on ⌖ in stand mode explains the flow; (4) DOM tests: the same tab set with and without a stand, Components/Code/Repository backed by stand operations when connected, no stand header or source switch; i18n ru/en; docs/kb/project-mode.md and docs/kb/editor-preview-ui.md. Gate: `npm run gate:task -- --base <sha>`. |
