---
title: Frontend-модуль Administration: граница, store и подключение
updated: 2026-09-01
checked: 65c889af
areas:
  - packages/admin-app
  - packages/ui/src/App.tsx
  - packages/ui/src/clients
  - packages/ui/src/runtime/appRuntime.ts
  - packages/shared/src/ipc.ts
---

# Frontend-модуль Administration: граница, store и подключение

## Публичная граница

Workspace `@voicechat/admin-app` находится в `packages/admin-app`. Публичный корень `src/index.ts` экспортирует `UsersAdmin`, фабрику store, транспортно-независимые контракты и admin route parser/builder; второй export — `./styles.css`. Host и другие пакеты не должны импортировать внутренние файлы пакета. Отдельного deploy или собственного shell у Administration нет.

Пакету принадлежат управление пользователями, ролями и блокировками, персональный deny-list моделей, read-only просмотр разговоров и сообщений выбранного пользователя, его usage и отдельная общая сводка, CRUD LLM engines с явным health-check и CRUD model prices. Личные настройки и usage текущего пользователя, Operations, Projects и Chat остаются у своих доменов. Административный просмотр не переносит чужие разговоры в Chat и не открывает terminal, Console или Explorer.

## Контракты и transport adapter

Источник интерфейсов — `packages/admin-app/src/contracts.ts`. `AdminClient` описывает существующие admin users/access/history/usage, engines/health и model-prices операции без привязки к HTTP, IPC или браузеру. Пакет не обращается к `window`, `fetch`, WebSocket, Electron API или browser storage.

Host adapter `createAdminClient` в `packages/ui/src/clients/browser.ts` переводит методы `AdminClient` в существующие `RendererApi` bridges. REST bridge остаётся в `packages/ui/src/remote/httpApi.ts`; backend и REST-контракты не менялись. В IPC map добавлен `admin:updateUserRole`, который использует существующее серверное обновление пользователя.

`SessionPort` отделяет обновление собственной учётной записи от admin state. После изменения роли текущего пользователя store просит host перечитать сессию и личный LLM access. Если admin-роль потеряна, состояние немедленно очищается и host закрывает административный экран.

## Store и lifecycle

`createAdminStore` в `src/store/adminStore.ts` создаёт React-независимый store с `getState`, `subscribe`, actions и идемпотентным `dispose`. Он не импортирует другие stores. Состояние включает список и выбор пользователя, usage и общую сводку, deny-list, разговоры и сообщения, engines, health results, model prices и состояния загрузки/ошибок.

Выбор пользователя защищён возрастающим request token: ответы предыдущего выбора не применяются после быстрого переключения. `closeUsers`, `reset` и `dispose` очищают административные данные; runtime также сбрасывает домен при logout, expiration и смене пользователя. Пустой deny-list означает полный доступ и доступен как стабильная модульная константа `EMPTY_LLM_ACCESS`.

Мутации пользователей, engines и model prices выполняются через client, после чего соответствующий список перечитывается. Engine health хранится отдельно по id и запускается только явным admin REST-действием, а не Operations realtime. Удаление engine убирает health result только после успешного удаления. UI подтверждает блокировку и destructive actions; предлагаемые роли — `admin`, `developer`, `tester`, `observer`, без legacy `user`.

## Маршруты и ленивое подключение

`src/routes.ts` разбирает и строит `#/users`, deep links пользователя и вкладок `access`, `machines`, `usage`, `history`, а также `#/users/engines` и `#/users/prices`. Повреждённый encoding и чужие маршруты возвращают `null`.

`packages/ui/src/App.tsx` загружает `UsersAdmin` динамическим `import('@voicechat/admin-app')` и показывает fallback через `Suspense`. Перед открытием host проверяет `session.currentUser.role === 'admin'`; прямой переход non-admin безопасно возвращает на корневой маршрут. Обычный bootstrap не вызывает admin endpoints: `AppRuntime.openAdmin` загружает домен только при фактическом открытии раздела.

## UI и проверки

`src/styles.css` импортирует только стили `@voicechat/ui-kit`, использует theme tokens и имеет mobile breakpoint; пакет не зависит от полного host `app.css`. Storybook общего UI подхватывает `AdminApp.stories.tsx`; обязательная матрица включает overview, empty usage и access matrix с wildcard-доступом модели.

Пакет имеет собственные команды `typecheck` и `test`, JSDOM setup, DOM/a11y, routes, store и architecture tests. Архитектурный тест запрещает host stores, platform apps, прямые transport API, browser storage и глубокие импорты host source. Пакет входит в канонический `npm run verify:frontend`; общий gate дополнительно проверяет публичные exports, CSS-изоляцию, Storybook-матрицу и role-gated lazy import Administration. `affected-check` запускает дорогие frontend build gates только для frontend-влияния.

## Инвайт-ссылки и копирование

Host передаёт в `UsersAdmin` абсолютную базу инвайта как `window.location.origin + window.location.pathname`; модуль добавляет hash-маршрут `#/invite/<URL-encoded token>`. Источники формирования ссылки — `packages/ui/src/App.tsx` и `packages/admin-app/src/users/InvitesPanel.tsx`.

Для каждого инвайта `InvitesPanel` выводит клавиатурно доступную кнопку с доступным именем, содержащим токен. Копирование через `packages/admin-app/src/clipboard.ts` сначала ожидает `navigator.clipboard.writeText`, а при отсутствии API или отказе создаёт временный readonly textarea и вызывает `document.execCommand('copy')`; временный узел удаляется в любом исходе. Успешное состояние «Скопировано» ставится только при результате `true`, привязано к токену строки и сбрасывается через 1,5 секунды; завершение более старой попытки не перезаписывает новую. Если оба способа не сработали, у соответствующего инвайта появляется сообщение с `role="alert"` о ручном копировании без ложного успешного состояния.
