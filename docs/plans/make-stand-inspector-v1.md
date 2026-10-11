# make-stand-inspector-v1 — выделение элементов в кадрах стенда и историй

Ран `make-stand-inspector-v1`. Ветка задач — `dev`. Продолжение [make-stand-stories-v2](make-stand-stories-v2.md).

## Цель владельца

Во вкладках «Preview» (приложение стенда) и «Stories» (Storybook рабочей копии) проекта Make щёлкнуть по
элементу и **залокейтить** его: проект, подпроект (пакет репозитория), компонент (имя и файл:строка), DOM-элемент.
Строка управления кадром в режиме стенда должна быть **той же, что у маленьких проектов Make**, с теми же
возможностями: ширины PC/Tablet/Phone/своя, три ширины рядом, выделение элемента ⌖, обновление ⟳,
комментарии к элементам 💬, скриншот, тема превью (светлая/тёмная/системная), язык документа, reduced
motion, медленная сеть, состояние элемента (hover/focus/active), консоль и сеть под кадром, панель стилей,
режим вопроса ❓, «⋯» и zen. Не применимо к стенду и прячется: публикация, загрузка файлов в проект,
хранилище/снимки маленького проекта, шаблоны.

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
- **Инструкция для пользователя**: подсказка на кнопке ⌖ в режиме стенда и раздел в базе знаний Make.

## Общий контракт

- `vc-make.selected` расширяется необязательным полем `source` (см. выше) и `story`; старые поля без изменений.
- `GET /api/make/inspector.js` — `application/javascript`, без аутентификации, `Cache-Control: public, max-age=300`,
  тело = текущий инспектор без обёртки `<script>`. Core вклеивает тег перед `</head>` (или в начало `<body>`,
  если `</head>` нет) только когда ответ `text/html` без `Content-Security-Policy`, запрещающего скрипт.
- Контракты `make-contracts`, маршруты Kanban и агент не меняются.

## Задачи интегратора (Claude, вне манифеста)

- Копия плана в `docs/plans/` репозитория Make до старта.
- После приёмки: выпуск Make → закрепление в Core → релиз ядра и деплой. Проверка на проде: «Проект 35» →
  стенд M2 → «Stories» → ⌖ → клик по кнопке в истории ChatColumn → карточка показывает `packages/ui`,
  компонент, файл:строка, «открыть в Code» открывает файл на строке; «Preview» стенда → ⌖ → клик → то же для
  живого компонента и «исходник недоступен» для базового; ширины, тема, консоль работают в обоих кадрах.

| B01 | Make | — | Shared inspector with element location, per docs/plans/make-stand-inspector-v1.md «Решения» and «Общий контракт» (copy of the plan is in this repository): (1) move the inspector body out of `apps/make/src/routes.ts` into `apps/make/src/inspector.ts` exported as `MAKE_INSPECTOR_SOURCE` (plain JS) and keep `MAKE_INSPECTOR_SCRIPT` as its `<script>` wrapper; add the package export `./inspector` and the public route `GET /api/make/inspector.js` (no session, `application/javascript`, `ETag`, `Cache-Control: public, max-age=300`), registered in both embedded and standalone Make; (2) the inspector accepts `vc-make.*` commands only when `event.source === window.parent`; (3) on click, add `source` to `vc-make.selected`: walk the React fiber of the clicked node (`__reactFiber$*`) up to the nearest fiber with `_debugSource`, report `{ file, line, column, component, owners, package }` where `file` is repository-relative (strip `/@fs/`, the working-copy root found as the segment before `packages/` or `apps/`, and Vite query strings), `component` is the owner component name (`_debugOwner.type.name|displayName`), `owners` up to 5 ancestors, `package` the first two path segments; in Storybook add `story: { id, title }` from the `id` query parameter and `window.__STORYBOOK_PREVIEW__` when available; omit `source` when no fiber data exists; (4) DOM tests for the fiber walk with a fake fiber chain and for the route; docs/kb/editor-preview-ui.md. Gate: `npm run gate:task -- --base <sha>`. |
| B02 | Core | — | Inspector injection for stand frames, per docs/plans/make-stand-inspector-v1.md «Общий контракт» (copy of the plan is in Core): (1) `apps/server/src/standProxy.ts` and the machine-bridge preview proxy used by `storybook/open` (`/api/preview?url=…`, see `apps/server/src/readerBridge/proxy.ts` and `routes/projectComponents.ts`) rewrite `text/html` responses: buffer the body (honouring `content-encoding` gzip/br/deflate, re-encode or drop the encoding and fix `content-length`), insert `<script src="<scheme>://<host of the incoming request>/api/make/inspector.js" data-vc-make-inspector></script>` before `</head>` (fallback: after `<body…>`), skip when a `Content-Security-Policy` header forbids external scripts or the body is not HTML; all other responses and WebSocket upgrades stream unchanged; (2) injection applies only to leases and bridge sessions created for Make (`storybook/open` for `stand:` workspaces and `previewAccess` of `makeStand`), controlled by a lease/session flag, default off for other consumers; (3) tests with a fake upstream for gzip HTML, plain HTML, non-HTML, CSP and WebSocket pass-through; docs/kb/server-internals.md (stand proxy) updated. Gate: `npm run gate:task -- --base <sha>`. |
| B03 | Make | B01 | Stand frames with the small-project toolbar and the element location card, per docs/plans/make-stand-inspector-v1.md «Цель владельца» and «Решения» (copy of the plan is in this repository): (1) extract the preview frame machinery of `MakePane.tsx` (frame ref, width presets and custom width, three side-by-side widths with scroll sync, ⌖ inspect, ⟳, comments pins, screenshot, preview theme/language/reduced-motion/slow-network, element state, console and network panels, style panel, ❓ ask-only, ⋯, zen) into a reusable preview host parameterised by the frame source, and render the stand «Preview» (`MakeProjectStand.tsx`, `state.previewUrl`) and «Stories» (`MakeProjectComponents.tsx`, `frameUrl`) frames through it with the same toolbar; hide (not disable) publish, upload, storage/snapshot and template controls in stand mode; keep the Stories list, Storybook controls and the Code editor as they are; (2) the selected-element card shows project (conversation project name) → `source.package` → `source.component` with `file:line` (and the story title in Stories) → `<tag> selector «text»`, with actions «open in Code» (open the working-copy file in the stand Code editor and scroll to the line), «add to prompt» (the existing «change element value» flow extended with file, line and component), «comment», «styles» (inline preview as today; writing goes to the working-copy CSS file where the selector is found, otherwise offer the package stylesheet); when `source` is missing show «component built from a package, source unavailable» with the package name when derivable; inline text editing and drag reorder are disabled for stand frames; (3) tooltip on ⌖ in stand mode explains the flow; i18n ru/en; DOM tests for the card, the open-in-Code action and hidden controls; docs/kb/project-mode.md and docs/kb/editor-preview-ui.md. Gate: `npm run gate:task -- --base <sha>`. |
