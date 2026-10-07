# Core KB section assignment (Core `origin/dev` 287cdab3)

## Rules for C01 (read before editing Core topics)

1. Rows whose owner is `core`: leave the section unchanged.
2. Rows with an owner module and an empty «Core keeps»: delete the whole section.
3. Rows with an owner module and a non-empty «Core keeps»: the column is only a hint of WHAT stays.
   Keep the original Core sentences that describe it — verbatim, with their details (routes, status
   codes, roles, tables, transactions, env vars, file paths in `apps/server` or `packages/shared`).
   Remove only the sentences about the module's own code. Never replace the section with the hint
   text: losing Core facts is worse than keeping one module sentence.
4. Module links are module-level only, one line per module: «Module details: `<module>:README.md`»,
   placed right after the topic's `# ` title (never before it, never with an anchor).
5. A topic left without Core content becomes: the `# ` title, one sentence saying the knowledge
   moved to the module, and the module link.


| Core topic | Section | Status | Owner module | Core keeps |
|---|---|---|---|---|
| projects.md | ## Что это | covered | kanban |  |
| projects.md | ## Tenant ownership | partial | kanban | Selected-team check for live WebSocket commands in the Core session; PUT /api/projects/:id/tenant transfer of project-bound conversations |
| projects.md | ## Квота собственных проектов | partial | kanban | Admin quota setting surface (admin) |
| projects.md | ## Типы проектов | partial | kanban | Feature gating in apps/server/src/users/auth.ts (projectFeatureForRequest, 409 feature_unavailable); packages/shared/src/projectTypes.ts contract |
| projects.md | ## Дизайн из Make в карточке | partial | kanban | Contract in packages/shared/src/projects.ts |
| projects.md | ## Маршруты вкладок карточки задачи | partial | core-ui |  |
| projects.md | ## Приглашения участников | partial | kanban | Signup attach of invitations (attachInvitationsToNewUser) and public /api/session/invitation preview gating |
| projects.md | ## Критерии приёмки | partial | kanban |  |
| projects.md | ## Шапка карточки задачи | uncovered | core-ui |  |
| projects.md | ## Выпадающие меню чатов и канбана | uncovered | core-ui |  |
| projects.md | ## Данные и доступ | covered | kanban |  |
| projects.md | ### Проект при создании обычного разговора | partial | kanban | POST /api/conversations projectId validation and createConversation snapshot |
| projects.md | ## Миграция системных колонок workflow | covered | kanban |  |
| projects.md | ## Вычисляемая колонка «Улучшения» | partial | kanban |  |
| projects.md | ## Лёгкая доска и точечные обновления (производительность) | partial | kanban |  |
| projects.md | ## Контракт (REST + WS + мост) | partial | kanban | Contract registries packages/shared/src/projects.ts, protocol.ts, ipc.ts |
| projects.md | ## Порядок карточек в разработке | covered | kanban |  |
| projects.md | ## Завершённые задачи уходят с доски (как в Jira) | partial | kanban | board.subscribe includeCompleted flag handling in the Core WS session; isCompletedHidden/compareTasksInColumn in packages/shared |
| projects.md | ## Настройки проекта | partial | core-ui |  |
| projects.md | ## Чаты завершённых задач скрыты из списка бесед | core-only | core | Whole section |
| projects.md | ## Создание задачи по запросу ассистента | partial | kanban | task-launch prompt parsing, TurnMeta.taskLaunches and message meta persistence (packages/shared, Core turns) |
| projects.md | ## Реалтайм (BoardHub) | partial | kanban | board.subscribe/unsubscribe handling in apps/server/src/session.ts |
| projects.md | ## Фронтенд | uncovered | core-ui |  |
| projects.md | ### Прокрутка доски при обновлениях | uncovered | core-ui |  |
| projects.md | ### Фильтры исполнителей канбана | uncovered | core-ui |  |
| projects.md | ### Board search and keyboard navigation (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Column navigator (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Active filter strip (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Compact task-card metadata (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Child task progress (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Task update freshness (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Board snapshot status (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Visible board summary (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Visible board text export (2026-09-12) | uncovered | core-ui |  |
| projects.md | ### Board diagnostics snapshot (2026-09-12) | uncovered | core-ui |  |
| projects.md | ### WIP capacity feedback (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Column empty states (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Board density (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Task card keyboard contract (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Due-date windows (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Priority overview (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Board keyboard help (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Collapsible board columns (2026-09-11) | uncovered | core-ui |  |
| projects.md | ### Меню колонки | uncovered | core-ui |  |
| projects.md | ### Универсальный ассистент виджета | partial | core-ui | Widget assistant gateway and @voicechat/shared/widgetAssistant contract |
| projects.md | ### Описание задачи: маркдаун в просмотре, поле в правке | uncovered | core-ui |  |
| projects.md | ### Прокрутка доски | uncovered | core-ui |  |
| projects.md | ### Перетаскивание карточек и колонок | uncovered | core-ui |  |
| projects.md | ## Что помнить | partial | kanban |  |
| projects.md | ## Папка на машину, машина по умолчанию, связь с чатом (итерация 2) | partial | kanban | Conversation project binding (POST /api/conversations/:id/project) and chat machine/skills inheritance in turns |
| projects.md | ## Epic / Story / Task | partial | kanban |  |
| projects.md | ## Навыки по умолчанию, навыки карточки и связанный чат | partial | kanban | openOrCreateTaskChat conversation creation and chat-side skill/engine inheritance |
| projects.md | ### Новая и legacy-версия карточки | partial | core-ui |  |
| projects.md | ### Что карточка грузит при открытии | uncovered | core-ui |  |
| projects.md | ## Доступ к открытому проекту отозвали | uncovered | core-ui |  |
| projects.md | ## Смена роли доходит до открытой страницы | partial | kanban | project.membership frame emitted by the Core WS session |
| projects.md | ## Повторный переход по принятой ссылке приглашения | covered | kanban |  |
| projects.md | ## Смену роли проговариваем | uncovered | core-ui |  |
| projects.md | ## Отказ по опубликованному типу объясняется, а не маскируется | covered | kanban |  |
| projects.md | ## «Сохранить как подтип» — отказ участнику объясняется | covered | kanban |  |
| projects.md | ## Раздел «Код»: рабочие копии проекта (2026-08-31) | partial | kanban | repository:write permission in apps/server/src/users/auth.ts |
| projects.md | ## Компоненты проекта в Make и быстрый тикет к слиянию (2026-09-05) | partial | kanban | repository:write gate for /api/projects/:id/components* (users/auth.ts) |
| projects.md | ## Автопроход: что происходит при провале этапа | partial | kanban |  |
| projects.md | ## Автопилот ассистента виден и правится в инспекторе контекста | partial | core-ui | kanbanAssistant:setAutonomy bridge and Conversation.assistantAutonomy contract |
| projects.md | ## Активность карточки: комментарии, ворклог, история (как в Jira) | partial | kanban |  |
| projects.md | ## Ленивая загрузка доски | uncovered | core-ui |  |
| ui.md | ## Core UI owner and consumer boundary | core-only | core | Whole section |
| ui.md | ## Story ownership after repository extraction | core-only | core | Whole section |
| ui.md | ## External UI library ownership | core-only | core | Whole section |
| ui.md | ## Неблокирующий мастер первого запуска | partial | core-ui |  |
| ui.md | ## Независимые артефакты продуктовых панелей | partial | core-ui | Core frontend preparation verifies owner-built panel manifests/integrity |
| ui.md | ## Мобильная раскладка раздела «Проекты» | uncovered | core-ui |  |
| ui.md | ## Reader workspace-пакеты | partial | web-reader |  |
| ui.md | ### Живые действия и безопасность Web Reader | partial | web-reader |  |
| ui.md | ### Мастерская: общий враппер консоли и студии картинок | uncovered | core-ui |  |
| ui.md | ## Слои | partial | core-ui |  |
| ui.md | ### Фактическая граница `@voicechat/chat-app` | partial | core-ui |  |
| ui.md | ### Создание обычного разговора с проектом | uncovered | core-ui |  |
| ui.md | ## Действия с сохранёнными сообщениями | uncovered | core-ui |  |
| ui.md | ## Административная страница тарифов | partial | core-ui |  |
| ui.md | ## Состояние приложения | partial | core-ui |  |
| ui.md | ### Адаптивный композер VoiceBar | uncovered | core-ui |  |
| ui.md | ### Общий Sidebar: разделы, controls и desktop resize | partial | core-ui |  |
| ui.md | ### Сохранность пользовательских настроек (почему их «сбрасывало» после деплоя) | partial | core-ui |  |
| ui.md | ### Темы интерфейса | partial | core-ui |  |
| ui.md | ### Панель Playwright Reader на телефоне и на компьютере | partial | playwright-reader |  |
| ui.md | ### Тестовые идентификаторы (`data-testid`) | uncovered | core-ui |  |
| ui.md | ### Вертикальная сетка настроек разговора | uncovered | core-ui |  |
| ui.md | ### Инспектор контекста разговора | uncovered | core-ui |  |
| ui.md | ## Админка пользователей и стоимости моделей | partial | core-ui |  |
| ui.md | ## Маршруты (hash-роутер) | partial | core-ui |  |
| ui.md | ## Общий переключатель Sidebar | uncovered | core-ui |  |
| ui.md | ## Прокрутка канбан-доски | uncovered | core-ui |  |
| ui.md | ## Отдельный режим Web Reader | partial | web-reader |  |
| ui.md | ## Отдельный режим Playwright Reader | partial | playwright-reader |  |
| ui.md | ## Отдельный режим «Консоль с ассистентом» | uncovered | core-ui |  |
| ui.md | ## Панель кода: git в рабочей копии задачи и сессии (2026-08-31) | partial | core-ui |  |
| ui.md | ## Отдельный режим «Make — веб-проект с ассистентом» | partial | make |  |
| ui.md | ## Разговор и ход модели | partial | core-ui |  |
| ui.md | ### Состояние активного запроса в ленте и композере | partial | core-ui |  |
| ui.md | ## Список бесед обновляется по событиям | uncovered | core-ui |  |
| ui.md | ## Индекс бесед грузится по требованию | partial | core-ui |  |
| ui.md | ## Голосовой конвейер | uncovered | core-ui |  |
| ui.md | ## Компоненты и поверхности | uncovered | core-ui |  |
| ui.md | ### Адаптивный композер `VoiceBar` | uncovered | core-ui |  |
| ui.md | ## Web Reader — отдельная страница | partial | web-reader |  |
| ui.md | ## Скролл экрана: у документа его нет | uncovered | core-ui |  |
| ui.md | ## Свёрнутые панели чата | uncovered | core-ui |  |
| ui.md | ## Панель «Использование БЗ» | partial | core-ui |  |
| ui.md | ## Модальные окна, popup и доступность | uncovered | ui |  |
| ui.md | ## Горячие клавиши, командная палитра и шпаргалка | partial | core-ui |  |
| ui.md | ## Аудит доступности и производительности (2026-09-15) | uncovered | core-ui |  |
| ui.md | ## Опрос сервера и видимость вкладки | uncovered | ui |  |
| ui.md | ## Ленивые чанки главного бандла | uncovered | core-ui |  |
| ui.md | ## Библиотека универсальных примитивов @voicechat/ui-kit | uncovered | ui |  |
| ui.md | ### Язык панелей рана (ui-kit) | uncovered | ui |  |
| ui.md | ### Строительные блоки карточки (ui-kit) | uncovered | ui |  |
| ui.md | ## Пакет @voicechat/projects-app: контракты, store и маршруты | partial | kanban |  |
| ui.md | ## Кнопки | uncovered | ui |  |
| ui.md | ## Состояния загрузки, пустоты и ошибки | uncovered | ui |  |
| ui.md | ## Подтверждения и уведомления | uncovered | ui |  |
| ui.md | ## Выбор начала разработки | uncovered | core-ui |  |
| ui.md | ## Remote-слой | uncovered | core-ui |  |
| ui.md | ## Тестирование UI | partial | core-ui |  |
| ui.md | ## Витрина Storybook | partial | core-ui |  |
| ui.md | ## AI-помощник формулировки | uncovered | core-ui |  |
| ui.md | ## Веб-рекордер | partial | web-reader |  |
| ui.md | ### Независимый Веб-рекордер и контракт хоста | partial | web-reader |  |
| ui.md | ### Действия модели в превью (mcp__browser__*) | partial | web-reader |  |
| ui.md | ### Запись и повторный запуск сценария | partial | web-reader |  |
| ui.md | ### Model-facing Web Reader audits | partial | web-reader |  |
| ui.md | ### Edit-режим: правки страницы в браузере клиента | uncovered | web-reader |  |
| ui.md | ### Маршрутные чтения и общий кэш | uncovered | core-ui |  |
| ui.md | ### Действия hover, scroll, press и скриншот области | partial | web-reader |  |
| ui.md | ### Тестирование фич: errors, wait, back, edits, сессии и сценарии | partial | web-reader |  |
| ui.md | ### Паритет с браузерным плагином: журналы, evaluate, drag, формы, viewport, a11y | partial | web-reader |  |
| ui.md | ### Тестовые окружения проекта в Web Reader | partial | web-reader |  |
| ui.md | ## Граница `@voicechat/operations-app` | partial | core-ui |  |
| ui.md | ## App Shell и состояние composition host после CHAT-271 | partial | core-ui |  |
| ui.md | ### UI performance telemetry (CHAT-469) | uncovered | core-ui | Contract/policy packages/shared/src/uiPerformance.ts and server-side ingestion |
| ui.md | ## Граница `@voicechat/admin-app` | partial | core-ui |  |
| ui.md | ## Интерактивная песочница компонентов в Storybook | uncovered | core-ui |  |
| ui.md | ## Быстрые фильтры доски читаются как элементы управления | uncovered | core-ui |  |
| ui.md | ## Безопасная зона под стеком тостов | uncovered | ui |  |
| ui.md | ## Коды ошибок сервера пишутся через пробел | uncovered | core-ui |  |
| ui.md | ## Карточка человека одна на админку и «Мой аккаунт» | uncovered | core-ui |  |
| ui.md | ## Свои данные: `/api/me/profile` и `/api/me/security` | core-only | core | Whole section |
| ui.md | ## Служебные маршруты админки — не логины | partial | core-ui |  |
| ui.md | ## Формат дат живёт в `@voicechat/shared` | core-only | core | Whole section |
| ui.md | ## Иконочная кнопка в строке действий не растягивается | uncovered | core-ui |  |
| ui.md | ## Приглашение у вошедшего — модальное окно, а не экран | uncovered | core-ui |  |
| ui.md | ## Регресс вёрстки между 0.1.177 и 0.1.179: слияние снесло стили | uncovered | core-ui |  |
| ui.md | ## Слияние app.css легко «топит» блок в медиазапросе (2026-09-06) | uncovered | core-ui |  |
| ui.md | ## Модификаторы `.app--*` проверяются тестом | uncovered | core-ui |  |
| ui.md | ## Главное действие экрана — `variant="primary"` | uncovered | core-ui |  |
| ui.md | ## Ленты карточки задачи говорят одним языком | uncovered | core-ui |  |
| ui.md | ## Логи показывают цвет, а не escape-последовательности | uncovered | core-ui | parseAnsi in packages/shared |
| ui.md | ## Вкладки «Настройки» и QA: подписи и состояния | uncovered | core-ui | QA label maps in packages/shared |
| ui.md | ## Вкладка «Подготовка к разработке»: форма запуска | uncovered | core-ui |  |
| ui.md | ## `--card-bg` не существовало, а фолбэк срабатывал всегда | uncovered | core-ui |  |
| ui.md | ## Панель есть у каждой вкладки, включая «Общее» | uncovered | core-ui |  |
| ui.md | ## Черновик новой задачи — то же окно, но другая форма | uncovered | core-ui |  |
| ui.md | ## Промежуточная ширина и последние диалекты раскрытия | uncovered | core-ui |  |
| ui.md | ## Палитра доски: токены вместо пары «светлый hex + тёмный hex» | uncovered | core-ui |  |
| ui.md | ## Шапка колонки и пустой экран под фильтром | uncovered | core-ui |  |
| ui.md | ## Контраст на доске: аватар и «+ Создать» | uncovered | core-ui |  |
| ui.md | ## Генерируемый цвет нельзя использовать как цвет текста | uncovered | core-ui |  |
| ui.md | ## Копирование сохранённых сообщений | uncovered | core-ui |  |
| ui.md | ## Make: компоненты и стили из репозитория проекта (только чтение) | partial | make |  |
| ui.md | ## Студия картинок: сплит «чат + галерея разговора» | uncovered | image-studio |  |
| ui.md | ## Новая карточка задачи: контракт циклов доработки | uncovered | core-ui |  |
| ui.md | ## Стеки интерфейса и UI Kit в Make | partial | make |  |
| ui.md | ## Progressive account page loading | uncovered | core-ui |  |
| ui.md | ## Маршрутные чтения и сессионный кэш | uncovered | core-ui |  |
| ui.md | ## Reader: мобильная панель и живые кадры (CHAT-456, 16.09.2026) | partial | playwright-reader |  |
| operations-app.md | ## Что выделено | partial | core-ui |  |
| operations-app.md | ## Контракты и границы | partial | core-ui |  |
| operations-app.md | ## Store и lifecycle | partial | core-ui |  |
| operations-app.md | ## Routes и навигация | partial | core-ui |  |
| operations-app.md | ## Paths, стили и проверки | uncovered | core-ui |  |
| admin-app.md | ## Публичная граница | partial | core-ui |  |
| admin-app.md | ## Контракты и transport adapter | partial | core-ui |  |
| admin-app.md | ## Store и lifecycle | partial | core-ui |  |
| admin-app.md | ## Маршруты и ленивое подключение | partial | core-ui |  |
| admin-app.md | ## UI и проверки | partial | core-ui |  |
| admin-app.md | ## Инвайт-ссылки и копирование | partial | core-ui |  |
| conversation-groups.md | ## Модель и владение | core-only | core | Whole section |
| conversation-groups.md | ## Хранение и инварианты | core-only | core | Whole section |
| conversation-groups.md | ## REST и выборки | core-only | core | Whole section |
| conversation-groups.md | ## Проверки | core-only | core | Whole section |
| architecture.md | ## Core frontend ownership | core-only | core | Whole section |
| architecture.md | ## Direct external libraries | core-only | core | Whole section |
| architecture.md | ## Границы Reader-модулей | partial | playwright-reader | Data and authorization through PlaywrightReaderCore (Core); applicationHost panel loading with manifest/SRI |
| architecture.md | ## Ключевое разделение ответственности | core-only | core | Whole section |
| architecture.md | ## Платформенно-независимый frontend runtime | partial | core-ui |  |
| architecture.md | ## Единый контейнер popup | uncovered | core-ui |  |
| architecture.md | ## Tool repository ownership | core-only | core | Whole section |
| architecture.md | ### Managed component runtime | core-only | core | Whole section |
| architecture.md | ### Machine and Desktop artifacts | core-only | core | Whole section |
| clients.md | ## Core UI distribution | core-only | core | Whole section |
| clients.md | ## Independent browser chat hosts | core-only | core | Whole section |
| clients.md | ## Independent Agent and Desktop owners | core-only | core | Whole section |
| clients.md | ## Reader bundles | partial | web-reader |  |
| clients.md | ## Browser (`apps/web`) | partial | core-ui |  |
| clients.md | ## Agent tray (`apps/agent-tray`) | partial | agent |  |
| clients.md | ## Login application (`apps/login-application`) | partial | agent |  |
| clients.md | ## Где делать изменение | core-only | core | Whole section |
| machines.md | ## Agent artifact ownership | core-only | core | Whole section |
| machines.md | ## Подключение и жизненный цикл | partial | agent | Server registration (agents/wsAgent.ts, AgentRegistry), install routes and machine deletion (DELETE /api/agents/:id) |
| machines.md | ## Enrollment первой машины | partial | agent | Server enrollment (login_enrollments table, consume rules) |
| machines.md | ## Tailscale VPN management (CHAT-465) | partial | agent | packages/shared/src/vpn.ts contract, /api/agents/*/vpn routes and machine_vpn_networks storage |
| machines.md | ### Environment machine-to-machine grants (C23) | core-only | core | Whole section |
| machines.md | ### System preparation and privileged protection | partial | agent |  |
| machines.md | ### Verification and acceptance limits | uncovered | agent | Integration-marker scan apps/server/src/ci/integrationTests.ts and server machines/vpn/service.test.ts coverage |
| machines.md | ## Установка и обновление агента (одна команда на ОС) | partial | agent | Installer routes apps/server/src/agents/*Install.ts and packages/shared/src/agentInstall.ts |
| machines.md | ## Мастер подключения | uncovered | core-ui |  |
| machines.md | ## Версии и гейтинг возможностей | core-only | core | Whole section |
| machines.md | ## Быстрый запуск навыков | uncovered | core-ui |  |
| machines.md | ## Живой PTY-терминал | partial | agent |  |
| machines.md | ## Однострочная консоль машины (MachineConsole) | uncovered | core-ui |  |
| machines.md | ## Git в рабочей копии на машине (2026-08-31) | partial | core-ui |  |
| machines.md | ## Проводник и файловые операции | partial | core-ui | REST /api/agents/:id/fs* routes relaying to the agent |
| machines.md | ### Просмотр и правка файлов | uncovered | core-ui | GET /api/agents/:id/fs/preview route and TOOL_MIN_VERSION in packages/shared/src/version.ts |
| machines.md | ## Раздача картинок машиной | partial | agent |  |
| machines.md | ## Loopback HTTP-мост тестовых окружений (http.request) | partial | agent | Preview authorization (MachinesRepo.canUseAgentForPreview, /api/preview routing) |
| machines.md | ## Телеметрия | partial | agent |  |
| machines.md | ## macOS — грабли | core-only | core | Whole section |
| machines.md | ## Windows — грабли | partial | agent |  |
| machines.md | ## Termux (Android) — грабли | partial | agent |  |
| machines.md | ## Шапка утилиты машины (MachineUtilityHeader) | uncovered | core-ui |  |
| machines.md | ## Связка проводника и терминала | uncovered | core-ui |  |
| machines.md | ## Жизненный цикл PTY-сеанса | core-only | core | Whole section |
| machines.md | ## Operations read model и lifecycle | partial | core-ui |  |
| machines.md | ## Dev stand processes | core-only | core | Whole section |
| server-internals.md | ## Граница отдельного Make-подобного продукта | partial | make |  |
| server-internals.md | ## Прокси веб-превью | partial | web-reader |  |
| server-internals.md | ## Канбан: только сервис `sislexa-kanban`, в ядре — порты и мост (2026-09-30) | core-only | core | Whole section |
| server-internals.md | ## Web Reader: самостоятельное приложение (2026-09-10) | partial | web-reader | Core readerBridge/localCore.ts and VC_READER_MODE switching |
| server-internals.md | ## Make ↔ ядро: порты `MakeCore` и `MakeService` (2026-09-07) | partial | make | Core makeBridge (apps/server/src/makeBridge/localCore.ts) and VC_MAKE_MODE switching |
| server-internals.md | ## Публикация Make: сериализация мутаций файла (2026-09-03) | uncovered | make |  |
| server-internals.md | ## Persistent environment links | core-only | core | Whole section |
| testing-operations.md | ## Core UI test ownership | core-only | core | Whole section |
| testing-operations.md | ### Shared chat exact-artifact acceptance (U10) | core-only | core | Whole section |
| testing-operations.md | ## Extracted application test ownership | core-only | core | Whole section |
| testing-operations.md | ## Лимит одного теста: 60 секунд во фронтенде | uncovered | core-ui |  |
| testing-operations.md | ## Проверки Reader frontend | partial | web-reader | Root frontend-quality.mjs/affected-check scripts |
| testing-operations.md | ## Известные дефекты dev-режима браузера (2026-08-24) | uncovered | core-ui |  |
| testing-operations.md | ## Замер расхода CI-ранов | core-only | core | Whole section |
| testing-operations.md | ## Проверки Operations frontend | partial | core-ui |  |
| testing-operations.md | ## Проверки Administration frontend | partial | core-ui |  |
| testing-operations.md | ## Проверки App Shell | partial | core-ui |  |
| testing-operations.md | ## E2E Make в реальном Chromium (2026-08-27) | core-only | core | Whole section |
| testing-operations.md | ## Мобильный прогон обходит и доску, и карточку задачи | core-only | core | Whole section |
| testing-operations.md | ## Порог целей нажатия смотрит и ширину — у кнопок без подписи | core-only | core | Whole section |
| testing-operations.md | ## Экраны приглашений в прогоне снимков требуют живого токена | core-only | core | Whole section |
| testing-operations.md | ## Прогон снимков дошёл до чата и настроек | core-only | core | Whole section |
| deploy.md | ## Dev stand gateway and Core component (C02) | core-only | core | Whole section |
| deploy.md | ## Managed environment secret storage | core-only | core | Whole section |
| deploy.md | ## Core UI owner rollout (2026-09-22) | core-only | core | Whole section |
| deploy.md | ## Development preview operation | core-only | core | Whole section |
| deploy.md | ### Операторские алиасы Web Reader | core-only | core | Whole section |
| deploy.md | ## Браузерный раннер в docker compose | core-only | core | Whole section |
| deploy.md | ## S2 Make frontend runtime correction (2026-09-27) | core-only | core | Whole section |
| deploy.md | ## Окружения: наблюдение и переключение образов (environments-v1, C03) | core-only | core | Whole section |
| deploy.md | ## Managed stands | core-only | core | Whole section |
| image-retouch.md | ## Пользовательский поток | uncovered | image-studio |  |
| image-retouch.md | ## Доверенная граница и обработка | uncovered | image-studio | UploadStore/uploads:add attachment storage and machine resolution |
| image-retouch.md | ## Результат и история | uncovered | image-studio |  |
