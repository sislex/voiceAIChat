---
title: Frontend-модуль Administration: граница, store и подключение
updated: 2026-09-20
checked: 7ed88f46
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

Host adapter `createAdminClient` в `packages/ui/src/clients/browser.ts` переводит методы `AdminClient` в существующие `RendererApi` bridges. REST bridge в `packages/ui/src/remote/httpApi.ts` передаёт параметры серверной выборки пользователей, массовый отзыв сессий, операции с кодом сброса и выборки журнала. Формы маршрутов централизованы в `packages/shared/src/adminRoute.ts`, а IPC-контракт — в `packages/shared/src/ipc.ts`.

`SessionPort` отделяет обновление собственной учётной записи от admin state. После изменения роли текущего пользователя store просит host перечитать сессию и личный LLM access. Если admin-роль потеряна, состояние немедленно очищается и host закрывает административный экран.

## Store и lifecycle

`PerformanceDashboard` reads connectivity through the public UI Kit
`useOnlineStatus` hook. Its optional `onlineSource` prop lets a standalone host
inject a snapshot/subscription source; the default source follows browser online
and offline events. The panel owns no browser listeners. Unknown connectivity
does not display an offline warning, and subscriptions are released on unmount.
This is a connectivity hint; API failures still use the dashboard's error state.

`createAdminStore` в `src/store/adminStore.ts` создаёт React-независимый store с `getState`, `subscribe`, actions и идемпотентным `dispose`. Он не импортирует другие stores. Состояние включает список и выбор пользователя, usage и общую сводку, deny-list, разговоры и сообщения, engines, health results, model prices и состояния загрузки/ошибок.

Выбор пользователя защищён возрастающим request token: ответы предыдущего выбора не применяются после быстрого переключения. `closeUsers`, `reset` и `dispose` очищают административные данные; runtime также сбрасывает домен при logout, expiration и смене пользователя. Пустой deny-list означает полный доступ и доступен как стабильная модульная константа `EMPTY_LLM_ACCESS`.

Мутации пользователей, engines и model prices выполняются через client, после чего соответствующий список перечитывается. Список пользователей загружается серверными страницами: начальная загрузка ограничена, `loadUsersPage` обслуживает фильтры и «Показать ещё», а stale-ответы после смены query отбрасываются. При deep link выбранный пользователь при необходимости дочитывается точным поиском. `bulkUsers` последовательно блокирует, разблокирует или отзывает сессии выбранных людей и затем обновляет список.

Engine health хранится отдельно по id и запускается только явным admin REST-действием, а не Operations realtime. Удаление engine убирает health result только после успешного удаления. UI подтверждает блокировку и destructive actions; предлагаемые роли — `admin`, `developer`, `tester`, `observer`, без legacy `user`. Описания ролей приходят из `ROLE_DESCRIPTIONS` в `packages/shared/src/auth.ts`; сервер транзакционно не позволяет снять роль у последнего администратора.

## Маршруты и ленивое подключение

`src/routes.ts` разбирает и строит `#/users`, query-параметры поиска, роли, состояния и сортировки, deep links пользователя и вкладок `access`, `machines`, `usage`, `history`, `sessions`, а также `#/users/engines` и `#/users/prices`. Повреждённый encoding и чужие маршруты возвращают `null`; параметры списка сохраняются в hash URL, поэтому представление можно переслать ссылкой.

`packages/ui/src/App.tsx` загружает `UsersAdmin` динамическим `import('@voicechat/admin-app')` и показывает fallback через `Suspense`. Перед открытием host проверяет `session.currentUser.role === 'admin'`; прямой переход non-admin безопасно возвращает на корневой маршрут. Обычный bootstrap не вызывает admin endpoints: `AppRuntime.openAdmin` загружает домен только при фактическом открытии раздела.

## UI и проверки

`src/styles.css` импортирует только стили `@voicechat/ui-kit`, использует theme tokens и имеет mobile breakpoint; пакет не зависит от полного host `app.css`. При ширине до 720 px список становится вертикальными карточками с меню действий, а фильтры раскрываются из строки поиска. Массовые действия используют один `useConfirm`, перечисляют логины и для выборки больше пяти требуют ввести её размер.

Карточка пользователя переиспользует `@voicechat/profile-app` и отдельной вкладкой монтирует `AdminSessions` на базе `@voicechat/sessions-app`: доступны завершение одной сессии и всех, кроме текущей. История умеет запросить последние 50 результатов входа и экспортировать видимые записи в CSV. Код сброса показывается открытым только сразу после выдачи; затем UI хранит лишь срок, позволяет скопировать выданный код и отозвать активный. Страница тарифов проверяет точность до двух знаков, предупреждает о нулевой цене и загружает историю изменений из security journal.

Storybook общего UI подхватывает `AdminApp.stories.tsx`; матрица дополнена поиском и фильтрами, массовыми действиями, карточкой с сессиями и мобильными карточками.

Пакет имеет собственные команды `typecheck` и `test`, JSDOM setup, DOM/a11y, routes, store и architecture tests. Архитектурный тест запрещает host stores, platform apps, прямые transport API, browser storage и глубокие импорты host source. Пакет входит в канонический `npm run verify:frontend`; общий gate дополнительно проверяет публичные exports, CSS-изоляцию, Storybook-матрицу и role-gated lazy import Administration. `affected-check` запускает дорогие frontend build gates только для frontend-влияния.

## Инвайт-ссылки и копирование

Host передаёт в `UsersAdmin` абсолютную базу инвайта как `window.location.origin + window.location.pathname`; модуль добавляет hash-маршрут `#/invite/<URL-encoded token>`. Источники формирования ссылки — `packages/ui/src/App.tsx` и `packages/admin-app/src/users/InvitesPanel.tsx`.

Для каждого инвайта `InvitesPanel` выводит клавиатурно доступную кнопку с доступным именем, содержащим токен. Копирование через `packages/admin-app/src/clipboard.ts` сначала ожидает `navigator.clipboard.writeText`, а при отсутствии API или отказе создаёт временный readonly textarea и вызывает `document.execCommand('copy')`; временный узел удаляется в любом исходе. Успешное состояние «Скопировано» ставится только при результате `true`, привязано к токену строки и сбрасывается через 1,5 секунды; завершение более старой попытки не перезаписывает новую. Если оба способа не сработали, у соответствующего инвайта появляется сообщение с `role="alert"` о ручном копировании без ложного успешного состояния.
