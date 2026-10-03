# Окружения: конфигурация модулей и переключение образов без пересборки

План `environments-v1`. Пользователь на странице релизов выбирает версии модулей, сохраняет их как
конфигурацию окружения, сравнивает с тем, что реально запущено на машине, и нажимает «Применить»:
переключаются только образы изменившихся сервисов, ничего не пересобирается. Любой образ можно
запустить на любой доступной пользователю машине — для тестовых стендов, регионов и распределения
нагрузки.

## Модель

- **Окружение** — именованный набор («prod-eu», «staging», «test-ivan») в проекте: своя
  конфигурация модулей, свои машины, свои настройки и секреты, своя база.
- **Конфигурация** — неизменяемая ревизия выбора: репозиторий модуля → версия и коммит из
  опубликованного выпуска (GitHub-релиз `vX.Y.Z` с `sislexa-release.json`,
  `docs/kb/features/release-composition.md`). Хранится в базе; «Применить» ссылается на ревизию.
- **Наблюдение** — что реально запущено на машине: сервис → образ, его ID, коммит из тега,
  здоровье. Сравнение «конфигурация ↔ наблюдение» даёт действие на каждый модуль.
- **Операция** — применение конфигурации: какие сервисы на какие образы переключены, проверка
  здоровья, итог, ссылка на предыдущую конфигурацию для отката.

Модули двух видов:

- **Сервисы со своим контейнером** (Make API, Web Reader, Playwright Reader, Kanban, Голос,
  Студия картинок, Identity, Billing, Analytics, LLM Runner) — переключаются сменой образа.
- **Вшитые в сборку Core** (npm-архивы контрактов, клиентов, core-ui) — без пересборки не
  сменить. Для них действие «нужен релиз Core»: состав релиза собирается со вкладки
  «Приложения» (уже работает), core-ui можно переключить и быстрым выпуском Browser UI.

## Этапы

| Этап | Ран | Результат |
| --- | --- | --- |
| 1 | `environments-v1` | Окружения и конфигурации на одной машине: сохранение, сравнение, «Применить» только изменившихся сервисов, откат. Прод — первое окружение. Выкат Core не откатывает переключённые сервисы. |
| 2 | `environments-v2` | Окружение целиком на любой доступной машине: проверка готовности машины, секреты и настройки окружения, отдельная база, создание стенда с нуля. |
| 3 | `environments-v3` | Модули одного окружения на разных машинах: адреса сервисов из размещения, связь между машинами через туннели агента, стенд из снимка прода, задачи плана на доске Kanban. |
| 4 | `environments-v4` | Несколько машин на модуль: балансировщик, поочерёдное применение, регионы. |

Порядок работы: задачи этапа с контрактами пишутся до старта его рана; после окончания этапа
интеграция сводит всё в рабочую версию, собирает релиз, выкатывает, проверяет на проде и только
потом пишет задачи и контракты следующего этапа (этот документ дополняется разделом этапа).
Задачи `B` — контракты, `C` — параллельная реализация, `U` — сквозная проверка.

**Каждая задача начинается от свежего `main` своего репозитория** в момент, когда её берут в
работу, а не от ветки другой задачи. Задача с зависимостью начинается от `main` после того, как
зависимость влита (C01 и C02 — после мержа B01 и выпуска `@voicechat/shared` 0.1.14). Если
`main` ушёл вперёд до сдачи, задача перебазируется на новый `main` и заново проходит свой гейт.
То же правило — для задач интегратора. Задачи с
пометкой «Claude» выполняет интегратор вне манифеста координатора, чтобы не занимать слоты
воркеров тем, что уже начато.

## Этап 1 — окружения на одной машине

### Предусловия (оператор, до выката этапа)

- Образы сервисов, которые должны переключаться, опубликованы в GHCR из репозиториев владельцев
  (`scripts/owner-release-publish.mjs --source`). Kanban 0.1.1, Make 1.3.1, Playwright Reader
  1.2.3 и Chromium уже там. Сервисы на локальных сборках (`/etc/voicechat/local-owner-images.yml`)
  в этапе 1 показываются как «локальная сборка» и не переключаются.

### Контракты

Общие типы — `packages/shared/src/environment.ts` (Core), выпуск `@voicechat/shared` 0.1.14;
копия в Kanban синхронизируется с архивом (`packages/shared/core-source.json`, тест расхождения).

```ts
/** Окружение проекта. В этапе 1 — ровно одна машина. */
export interface EnvironmentDefinition {
  id: string                 // slug [a-z][a-z0-9-]{1,39}, уникален в проекте
  projectId: string
  name: string
  machines: string[]         // agentId; этап 1: длина 1
  checkoutPath: string       // каталог compose на машине (для прода — VC_REPO_DIR)
  createdBy: string
  createdAt: number
  updatedAt: number
}

/** Выбранный выпуск модуля: идентичность — коммит. */
export interface ModuleSelection {
  repository: string         // https://github.com/sislex/<repo>
  version: string            // x.y.z
  commit: string             // 40 hex
}

/** Неизменяемая ревизия конфигурации окружения. */
export interface EnvironmentConfiguration {
  id: string
  environmentId: string
  revision: number           // 1, 2, … в пределах окружения
  modules: ModuleSelection[] // один выпуск на репозиторий
  note: string | null
  createdBy: string
  createdAt: number
}

/** Запущенный сервис на машине. */
export interface ObservedService {
  service: string            // имя сервиса compose
  image: string              // ссылка, с которой создан контейнер
  imageId: string            // sha256:…
  repository: string | null  // по имени образа ghcr.io/sislex/<имя> → репозиторий (OWNER_IMAGES)
  commit: string | null      // тег образа, если это 40 hex
  version: string | null     // по опубликованному выпуску этого коммита
  local: boolean             // образ не из GHCR (локальная сборка)
  healthy: boolean | null    // docker health; null — проверки нет
}

export interface EnvironmentObservation {
  environmentId: string
  machineId: string
  observedAt: number
  core: { version: string | null; commit: string | null }
  services: ObservedService[]
}

/** Действие по модулю при сравнении конфигурации с наблюдением. */
export type ModuleAction =
  | 'none'                   // уже запущено то, что выбрано
  | 'switch'                 // сервис переключится на образ выбранного выпуска
  | 'needs_core_release'     // модуль вшит в Core: нужен релиз Core
  | 'local_build'            // сервис на локальной сборке: в этапе 1 не переключается
  | 'unavailable'            // у выпуска нет образа для сервиса / выпуск не найден

export interface ModuleDiff {
  repository: string
  name: string
  services: string[]                        // сервисы compose, которые даёт модуль
  desired: { version: string; commit: string } | null
  actual: { version: string | null; commit: string | null } | null
  action: ModuleAction
  reason: string | null
}

export type EnvironmentOperationStatus =
  | 'pending' | 'pulling' | 'switching' | 'health_check' | 'succeeded' | 'failed' | 'rolled_back'

export interface EnvironmentOperationStep {
  service: string
  from: string | null        // образ до
  to: string                 // образ после
  status: 'pending' | 'running' | 'passed' | 'failed'
  log: string
}

export interface EnvironmentOperation {
  id: string
  environmentId: string
  configurationId: string
  previousConfigurationId: string | null
  status: EnvironmentOperationStatus
  steps: EnvironmentOperationStep[]
  startedBy: string
  startedAt: number
  finishedAt: number | null
  error: string | null
}

export function parseModuleSelections(value: unknown): ModuleSelection[]   // строгий разбор, без повторов репозитория
export function parseEnvironmentId(value: unknown): string                 // slug
```

База — Core владеет миграциями (`apps/server/src/db/schema.ts`, `schemaPg.ts`), копия в Kanban:

```sql
CREATE TABLE IF NOT EXISTS environments (
  id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL,
  machines_json TEXT NOT NULL, checkout_path TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS environment_configurations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, environment_id TEXT NOT NULL,
  revision INTEGER NOT NULL, modules_json TEXT NOT NULL, note TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE (project_id, environment_id, revision),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS environment_operations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, environment_id TEXT NOT NULL,
  configuration_id TEXT NOT NULL, previous_configuration_id TEXT,
  status TEXT NOT NULL, steps_json TEXT NOT NULL DEFAULT '[]', error TEXT,
  started_by TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,
  FOREIGN KEY (configuration_id) REFERENCES environment_configurations(id)
);
CREATE INDEX IF NOT EXISTS idx_environment_operations ON environment_operations(project_id, environment_id, started_at DESC);
```

Репозиторий `db.environments` (Core и копия Kanban):

```ts
listEnvironments(userId, projectId): Promise<EnvironmentDefinition[]>          // только участник проекта
getEnvironment(userId, projectId, environmentId): Promise<EnvironmentDefinition | null>
upsertEnvironment(userId, projectId, input: Omit<EnvironmentDefinition, 'projectId'|'createdBy'|'createdAt'|'updatedAt'>): Promise<EnvironmentDefinition>
addConfiguration(userId, projectId, environmentId, modules: ModuleSelection[], note: string | null): Promise<EnvironmentConfiguration> // revision = max+1 в транзакции
listConfigurations(userId, projectId, environmentId, limit?): Promise<EnvironmentConfiguration[]> // новые первыми
getConfiguration(userId, projectId, configurationId): Promise<EnvironmentConfiguration | null>
createOperation(userId, projectId, environmentId, configurationId, previousConfigurationId): Promise<EnvironmentOperation>
updateOperation(operationId, patch: Partial<Pick<EnvironmentOperation, 'status'|'steps'|'error'|'finishedAt'>>): Promise<void>
listOperations(userId, projectId, environmentId, limit?): Promise<EnvironmentOperation[]>
activeOperation(projectId, environmentId): Promise<EnvironmentOperation | null> // одна активная на окружение
```

Машинные скрипты — в Core, исполняются в чекауте окружения на машине (агентом, как
выкат релиза):

```
python3 scripts/prod/environment_observe.py
  → stdout: {"core": {"version", "commit"}, "services": [{"service","image","imageId","commit","local","healthy"}]}
  читает docker compose ps -a / docker inspect по проекту compose чекаута; ничего не меняет.

bash scripts/prod/environment-apply.sh --switches <file.json> --operation <id>
  file.json: {"<service>": "ghcr.io/sislex/<image>:<commit>", …}
  1) docker pull каждой ссылки (отказ — выход до переключения, exit 20);
  2) пишет /etc/voicechat/environment-overrides/<operation>.yml (image + pull_policy: never для
     переключаемых), добавляет в цепочку compose окружения как последний файл и запоминает его
     ссылкой /etc/voicechat/environment-overrides/current.yml;
  3) docker compose up -d --no-build --no-deps <сервисы>;
  4) ждёт healthy каждого (до 180 с), иначе возвращает прежний current.yml, поднимает прежние
     образы и выходит с exit 30;
  stdout построчно: {"service","status":"pulling|switching|healthy|failed|rolled_back","log"}.
```

Выкат релиза Core (`release-manager-deploy.sh`) берёт сервисы на запущенных образах — значит,
переключённые окружением сервисы не откатываются. Сервис, образ которого изменил сам релиз
(состав релиза), переключается на этот образ (`owner_image_switches.py`).

REST — Kanban (проксируется Core под `/api/projects`):

```
GET  /api/projects/:id/environments                                → EnvironmentDefinition[]
POST /api/projects/:id/environments  {id,name,machines,checkoutPath} → EnvironmentDefinition (владелец проекта)
GET  /api/projects/:id/environments/:env/configurations             → EnvironmentConfiguration[]
POST /api/projects/:id/environments/:env/configurations {modules,note} → EnvironmentConfiguration
     модули проверяются по опубликованным выпускам (ReleaseCompositionSource): версия и коммит существуют
POST /api/projects/:id/environments/:env/observe                    → EnvironmentObservation (запускает environment_observe.py)
GET  /api/projects/:id/environments/:env/diff?configurationId=…     → { observation, modules: ModuleDiff[] }
POST /api/projects/:id/environments/:env/apply {configurationId}    → 202 EnvironmentOperation
     409, если есть активная операция или конфигурация уже применена
GET  /api/projects/:id/environments/:env/operations                 → EnvironmentOperation[]
POST /api/projects/:id/environments/:env/rollback {operationId}     → 202 EnvironmentOperation (применяет previousConfigurationId)
```

Соответствие «модуль ↔ сервисы ↔ образ» берётся из манифеста выпуска (`images[].name`) и
compose чекаута (`image: ${SISLEXA_*_IMAGE:-<имя>:…}`), а «вшит в Core» — из того, что у модуля
есть пакеты в `vendor/` и нет сервисов. Прод при первом наблюдении получает окружение
`production` (машина и чекаут — из настроек production проекта) и конфигурацию ревизии 1,
равную наблюдению.

Интерфейс — core-ui, вкладка «Релизы → Приложения»:

- блок «Окружения»: список, у выбранного — таблица модулей «выбрано / запущено / действие»,
  «Сохранить конфигурацию», «Применить», ход операции по сервисам, история и «Откатить»;
- блок «Новый релиз из версий приложений» (бывшая «Сборка релиза…») — для вшитых модулей;
  кнопка из окружения «Собрать релиз Core для вшитых модулей» заполняет его выбором;
- «Быстрое переключение интерфейса (без выката)» — бывший «Browser UI · Production»;
- старый способ «Приложение / Окружение / Подготовить выпуск» свёрнут в
  «Отдельные выпуски приложений (старый способ)».

### Задачи этапа 1

| B01 | Core | — | Shared contracts of environments-v1 per docs/plans/environments.md section «Контракты» in packages/shared/src/environment.ts with strict parsers parseModuleSelections and parseEnvironmentId and tests; Core DB schema (sqlite and Postgres) for environments, environment_configurations and environment_operations plus db.environments repository with the listed methods, membership checks and transactional revision numbering, with repository tests on both engines; publish @voicechat/shared 0.1.14 archive with provenance and pin it in Core |
| C01 | Kanban | B01 | Kanban environments service and REST per docs/plans/environments.md: sync packages/shared copy and DB layer to @voicechat/shared 0.1.14 with an empty drift allowlist; EnvironmentManager that validates configurations against published releases, observes the machine by running scripts/prod/environment_observe.py in the environment checkout over the machine port, computes ModuleDiff (switch, needs_core_release, local_build, unavailable, none), applies a configuration by writing the switches file and running scripts/prod/environment-apply.sh with streamed steps, one active operation per environment, rollback to the previous configuration, and the implicit production environment on first observation; routes with project permissions; tests with a fake machine and fake GitHub |
| C02 | core-ui | B01 | Applications tab per docs/plans/environments.md section «Интерфейс»: Environments block (environment list, module table desired/actual/action, save configuration, apply with live per-service steps, history and rollback) over the C01 REST contract; rename the composer to «Новый релиз из версий приложений» and Browser UI to «Быстрое переключение интерфейса (без выката)»; collapse the per-application flow into «Отдельные выпуски приложений (старый способ)»; pin @voicechat/shared 0.1.14; DOM tests and a story; keep the ReleaseCenter chunk budget |

Задачи интегратора (Claude, вне манифеста):

- **C03 (Core): машинные скрипты** `environment_observe.py`, `environment-apply.sh` с тестами на
  поддельном docker и доработка `release-manager-deploy.sh` (сервисы, изменённые самим релизом,
  переключаются; переключённые окружением — сохраняются; цепочка compose включает
  `environment-overrides/current.yml`).
- **U01: сквозная проверка и выкат этапа**: мерж B01→C01/C02/C03, выпуск core-ui, Desktop и
  образа Kanban, закрепление в Core, релиз и выкат, проверка на проде: наблюдение прода,
  конфигурация, «Применить» для Kanban (переключение на тот же образ — пустая операция) и для
  тестовой смены версии, откат; затем раздел «Этап 2» этого документа с контрактами и новый ран.

### Итоги U01 (2026-10-02, прод 0.1.366)

Выпущены Core UI 1.4.11, Desktop 1.0.14 и Kanban 0.1.2, закреплены в Core (PR #298), выкат 0.1.366.
Наблюдение прода работает: окружение `production` и ревизия 1 созданы при первом наблюдении, Kanban
0.1.2 и Playwright Reader 1.2.3 — «выбрано = запущено». До выката исправлена цепочка compose в
`environment-apply.sh` (PR #300): Kanban запускает его без `COMPOSE_FILE`, а цепочка прода лежит в
`.env`. Найдено и вынесено в C12 этапа 2:

- «Применить» ревизию 1 отклоняется: «Configuration contains modules that cannot be switched» — в неё
  входят `unavailable`-модули (Identity, Billing, SDK, LLM Runner, UI Kit, сам Core);
- вшитые модули (SDK, UI Kit) помечены `unavailable` вместо `needs_core_release`;
- две опубликованные версии с образом есть только у Kanban, а переключение Kanban обрывает операцию,
  которую ведёт он сам; поэтому смену версии и откат на проде проверить нечем — после C12 нужна вторая
  опубликованная версия сервиса (например, Make) для U02.

### Готово, когда

- на проде во вкладке «Приложения» есть окружение `production` с модулями и действиями;
- сохранение конфигурации с другой версией Kanban и «Применить» переключают только Kanban, без
  сборки, с проверкой здоровья; «Откатить» возвращает прежний образ;
- выкат релиза Core после этого не откатывает переключённый Kanban.

## Этап 2 — окружение целиком на любой машине

Ран `environments-v2`. Владелец проекта создаёт новое окружение («staging», «test-ivan») на любой
машине проекта, к которой у него полный доступ, проверяет её готовность, задаёт настройки и
секреты окружения и нажимает «Создать стенд»: на машине появляется отдельный чекаут Core
выбранного релиза, отдельный проект compose со своей базой Postgres и своим томом данных,
поднимаются сервисы, затем модули переключаются на выбранные выпуски механизмом этапа 1.
Прод при этом не трогается.

Границы этапа:

- окружение по-прежнему живёт на **одной** машине (`machines.length === 1`); модули на разных
  машинах — этап 3;
- стенд слушает только `127.0.0.1:<порт>` машины и открывается через мост машины в Web Reader
  (`<agentId>.machine.internal:<порт>`, как feature-preview); публичный адрес и Caddy стенда —
  вопрос 3 к владельцу, этап 3;
- стенд собирается из `docker-compose.yml` Core с профилями `postgres` и `kanban` и в legacy-режиме
  компонентов (без `SISLEXA_COMPONENT_CONFIG`): Identity встроена в Core, отдельные сервисы
  Identity, Billing и Analytics из `deploy/compose.{identity,billing,analytics}.yml` и
  управляемая установка компонентов (`components:init`) в стенд этапа 2 не входят;
- окружение `production` и окружения этапа 1 остаются «внешними» (`external`): их чекаут, `.env`
  и `/etc/voicechat/*` ведёт оператор, этап 2 их настройки не показывает и не меняет.

### Что уже есть в коде (на что опирается этап)

- Машина достигается только через порт машин Kanban (`KanbanMachines`: `exec`, `execStream`,
  `fsWrite`, `fsMkdir`, `fsDelete`, `isOnline`, `platformOf`, `policyOf`, `gitAccess`), агент
  исполняет команду в shell; этап 1 так запускает `scripts/prod/environment_observe.py` и
  `environment-apply.sh` в чекауте (`sislexa-kanban/apps/server/src/environments/machine.ts`).
  Изменений в агенте этапу 2 не нужно.
- Корни на машине — зарегистрированное хранилище (`machine_storages`, marker
  `.voicechat/storage.json`), выбранное у машины проекта (`project_machines.storage_id`).
  Production и staging уже раскладываются как
  `<storage>/projects/<projectId>/environments/<kind>/{app,config,logs,artifacts,temporary/repository,environment.json}`
  (`managedEnvironmentPaths`, `parseEnvironmentManifest` в shared; `ManagedEnvironmentResolver`
  в Kanban проверяет marker, `allowedDirs`, запись и свободное место).
- Отдельный проект compose на машине уже умеет feature-preview Kanban
  (`apps/server/src/preview/manager.ts`): уникальное имя проекта, подбор свободного порта на
  `127.0.0.1` (диапазон 18000–19999), проверки Docker с кодами 69/70, открытие через мост
  машины в Web Reader (`FeaturePreviewSection.openInWebReader` в core-ui).
- `docker-compose.yml`: Postgres — профиль `postgres` с томом `vc-postgres` (имя тома зависит от
  проекта compose, значит у каждого проекта своя база); том `vc-data` назван жёстко
  `voicechat-server-data` (общий для всех проектов на машине); наружу публикуются только
  `voicechat` (`8787`) и `caddy` (`80`/`443`, `VC_PUBLIC_HOST:?` обязателен даже при
  выключенном сервисе); у `voicechat` смонтирован сокет деплоя `/run/voicechat`; из чекаута
  собираются `voicechat` и `automation-runner` (и выключенные профилями `machines`, `admin`).
  `ports: !override` и `build: !reset null` уже используются (`docker-compose.parallel.yml`,
  `environment-apply.sh`), значит нужен Compose ≥ 2.24.
- Секреты сегодня: `.env` чекаута (`VC_PG_PASSWORD`, `VC_DB_URL`, `VC_INTERNAL_TOKEN`,
  `VC_MCP_SECRET`, токены раннеров, SMTP, `VC_GITHUB_TOKEN`, upstream-ключи) и
  `/etc/voicechat/production.env` (`VC_REPO_DIR`, `COMPOSE_FILE`); в базе зашифрованно хранится
  только ключ Tailscale (`machine_vpn_networks.encrypted_secret`, AES-256-GCM с ключом
  `VC_VPN_SECRET_KEY` и AAD, `apps/server/src/machines/vpn/tailscale.ts`). Это образец для
  секретов окружения.
- Выкат прода (`voicechat-deploy`, `release-manager-deploy.sh`) завязан на машинные синглтоны
  (`/etc/voicechat/production.env`, `/var/lock/voicechat-deploy.lock`, том
  `voicechat-server-data`, порт 8787) — для стенда он не годится, у стенда свой скрипт.
- Релизы Core проекта — `project_releases` (`ready` — подготовлен и прошёл регрессию,
  `released` — выкачен), ветка `release/x.y.z`, точный `commit_sha`; `/api/health` отдаёт
  `{ok, application: {applicationId: 'core', commit}}` (проверка в `deploy.sh`).

**Найдено при разборе этапа 1 (проверить в U01):** `environment-apply.sh` берёт цепочку compose
только из переменной shell `COMPOSE_FILE` и экспортирует `COMPOSE_FILE=<прежнее>:current.yml`.
Kanban запускает его как `cd <чекаут> && bash …` без переменных, а на проде цепочка лежит в
`.env` чекаута (`docs/kb/deploy.md`, «External runner ownership»). Переменная shell сильнее
`.env`, поэтому при пустой переменной compose увидит **только** `current.yml`. Тесты C03 этого
не ловят: они задают `COMPOSE_FILE` явно. Исправление — задача C04 ниже, независимая от
остального этапа.

### Предусловия (до старта рана)

- U01 завершён: этап 1 выкачен и проверен на проде.
- Раздел написан, пока идёт U01; перед стартом рана интегратор сверяет его с итогами U01
  (в частности, с находкой про цепочку compose выше).
- B02 и C04 берутся в работу сразу; остальные задачи — от свежего `main` своего репозитория
  после мержа зависимостей из таблицы. Задачи Kanban и core-ui начинаются только после выпуска
  `@voicechat/shared` 0.1.15 (B02), Kanban — ещё и после B03 (копия слоя базы).

### Предусловия (оператор, до выката этапа)

- Ключ секретов окружений: `VC_ENVIRONMENT_SECRET_KEY` (64 hex, `openssl rand -hex 32`) в `.env`
  чекаута прода, с резервной копией вне машины. Потеря ключа не ломает стенды, но сохранённые
  секреты придётся ввести заново. Без ключа запись секретов отвечает `503`.
- Целевая машина: машина проекта с хранилищем `ready`, полным доступом владельца и агентом с
  мостом `http-proxy` (≥ 0.13.0); Docker и Compose ≥ 2.24 доступны пользователю агента без
  `sudo`; доступ к git-репозиторию проекта настроен (`gitAccess`); машина может скачивать
  `ghcr.io/sislex/*`. Linux x86_64 — основной вариант (образы владельцев собираются под
  linux/amd64, `docs/kb/deploy.md`, «Local owner image delivery»).
- Вход CLI раннеров (`claude auth login` в `runner-work`/`runner-personal` стенда) — ручной шаг
  после создания стенда, как на проде (`docker-compose.yml`, шапка).

### Решения этапа

1. **Режим окружения.** `mode: 'external'` — всё, что было в этапе 1 (каталог задаёт человек,
   настройки ведёт оператор). `mode: 'managed'` — стенд, который создаёт и удаляет Sislexa:
   каталог, имя проекта compose, порт и `.env` вычисляет Kanban, пользователь их не вводит.
   `production` всегда `external`.
2. **Раскладка стенда.**
   `<storage>/projects/<projectId>/environments/stands/<environmentId>/` с теми же `app`,
   `config` (0700), `logs`, `artifacts`, `temporary/repository` (чекаут Core) и
   `environment.json` (manifest `kind: 'stand'`). Подкаталог `stands/` не пересекается с
   каноническими `production`, `staging` и `previews`. Windows не поддерживается.
3. **Изоляция на машине.** Проект compose `sx-<environmentId>-<fnv1a32(projectId)>`, свой том
   данных `<проект>-server-data`, своя база — сервис `postgres` профиля `postgres` с томом
   `<проект>_vc-postgres`, `VC_DB_URL` на него. Core стенда публикуется только на
   `127.0.0.1:<порт>` из диапазона 17800–17999 (не пересекается с feature-preview), Caddy стенда
   выключен профилем `public`, сокет деплоя не монтируется. Оверлей —
   `deploy/compose.stand.yml` в Core.
4. **Настройки и секреты.** Каталог допустимых ключей — в shared (`ENVIRONMENT_SETTINGS`). Ключи,
   которые определяют изоляцию (`COMPOSE_*`, `VC_DB_URL`, порт, том, версия релиза…),
   зарезервированы и вычисляются. Секреты хранятся в базе зашифрованными (AES-256-GCM,
   `VC_ENVIRONMENT_SECRET_KEY` у Kanban, по образцу `encryptVpnSecret`), API их значения не
   возвращает никогда. Внутренние токены стенда генерируются (32 байта hex), пароль первого
   администратора задаёт владелец. На машину всё доставляется одним файлом
   `config/stand.env` (0600 в каталоге 0700), а `.env` чекаута — ссылка на него: так любой
   `docker compose` в чекауте (наблюдение, применение этапа 1) видит проект, цепочку и профили
   стенда без переменных shell.
5. **Готовность машины** проверяет Kanban своей пробой (Python stdlib), которую пишет в
   хранилище и запускает: до создания стенда чекаута Core на машине ещё нет, взять скрипт
   из него нельзя. Проба ничего не меняет, кроме временного файла записи.
6. **Создание стенда — операция** (`environment_operations.kind = 'provision'`) с этапами:
   готовность → каталоги и manifest → чекаут релиза Core → файл настроек → проверка вшитых
   модулей → `scripts/prod/environment-provision.sh` (сборка Core, загрузка образов, подъём,
   здоровье) → переключение модулей механизмом этапа 1 (`environment-apply.sh`). Повторное
   создание идемпотентно (тот же каталог, данные сохраняются). Удаление — операция
   `kind = 'remove'` (`environment-remove.sh`, данные удаляются только по явному флагу).
7. **Core в конфигурации.** Конфигурация получает необязательный выбор релиза Core
   (`core: {version, commit}`), проверяемый по `project_releases` проекта (`ready`/`released`,
   ветка `release/<version>`, точный коммит). Для стенда он обязателен; для `external` его смена
   по-прежнему делается релизом Core.

### Контракты

#### Общие типы — `packages/shared/src/environment.ts` и `manifests.ts`, `@voicechat/shared` 0.1.15

Добавления к этапу 1 (поля этапа 1 не меняются; новые поля в ответах — дополнительные):

```ts
/** environments-v2: who owns the environment checkout. */
export type EnvironmentMode = 'external' | 'managed'
/** Lifecycle of a managed stand. An external environment is always 'ready'. */
export type EnvironmentState = 'draft' | 'provisioning' | 'ready' | 'failed' | 'removing' | 'removed'

export interface EnvironmentDefinition {
  // …all environments-v1 fields; for 'managed' checkoutPath = managedStandPaths(...).repository
  mode: EnvironmentMode
  storageId: string | null        // managed: storage of machines[0] at creation; external: null
  state: EnvironmentState
  composeProject: string | null   // managed: environmentComposeProject(projectId, id)
  port: number | null             // managed: Core host port on 127.0.0.1, set by the first provision
}

/** Selected Core release; identity is the commit of release/<version>. */
export interface CoreSelection { version: string; commit: string }   // x.y.z, 40 hex

export interface EnvironmentConfiguration {
  // …environments-v1 fields
  core: CoreSelection | null      // required to provision a managed stand
}

export interface CoreDiff {
  desired: CoreSelection | null
  actual: { version: string | null; commit: string | null }     // observation.core
  action: 'none' | 'needs_core_release' | 'needs_provision'     // external | managed
}

export type EnvironmentOperationKind = 'apply' | 'provision' | 'remove'
export type EnvironmentOperationStatus =
  | 'pending' | 'preparing' | 'pulling' | 'building' | 'starting' | 'switching' | 'health_check'
  | 'removing' | 'succeeded' | 'failed' | 'rolled_back'
export const ACTIVE_ENVIRONMENT_OPERATION_STATUSES: readonly EnvironmentOperationStatus[] =
  ['pending', 'preparing', 'pulling', 'building', 'starting', 'switching', 'health_check', 'removing']

/** Stage steps of provision/remove; apply steps stay per compose service. */
export type EnvironmentStage =
  | 'readiness' | 'directories' | 'checkout' | 'settings' | 'modules'
  | 'config' | 'build' | 'pull' | 'start' | 'health' | 'switch' | 'down' | 'cleanup'

export interface EnvironmentOperationStep {
  // …environments-v1 fields; for kind 'stage': service = EnvironmentStage, from = null, to = short target
  kind?: 'service' | 'stage'      // absent = 'service' (rows written by environments-v1)
}

export interface EnvironmentOperation {
  // …environments-v1 fields
  kind: EnvironmentOperationKind  // rows written by environments-v1 read as 'apply'
}

export type MachineReadinessCheckId =
  | 'platform' | 'architecture' | 'policy' | 'storage' | 'root' | 'docker' | 'compose' | 'git'
  | 'python' | 'repository' | 'disk' | 'memory' | 'port' | 'project'
export interface MachineReadinessCheck { id: MachineReadinessCheckId; status: 'passed' | 'warning' | 'failed'; message: string }
export interface MachineReadiness {
  environmentId: string
  machineId: string
  checkedAt: number
  ready: boolean                  // no check is 'failed'
  port: number | null             // port the next provision will use
  checks: MachineReadinessCheck[] // every id exactly once, in the order above
}

export const ENVIRONMENT_PORT_RANGE = { from: 17800, to: 17999 } as const
export const ENVIRONMENT_MIN_FREE_BYTES = 20 * 1024 ** 3
export const ENVIRONMENT_MIN_MEMORY_BYTES = 4 * 1024 ** 3          // below: failed
export const ENVIRONMENT_RECOMMENDED_MEMORY_BYTES = 8 * 1024 ** 3  // below: warning
export const ENVIRONMENT_MIN_COMPOSE_VERSION = '2.24.0'

export interface EnvironmentSettingDefinition {
  key: string                     // [A-Z][A-Z0-9_]{1,63}
  label: string                   // Russian UI label
  secret: boolean
  required: boolean               // provision refuses while unset
  generated: boolean              // provision generates 32 random bytes as hex when unset
}
export const ENVIRONMENT_SETTINGS: readonly EnvironmentSettingDefinition[]
/** Computed by provisioning; never accepted from users. */
export const RESERVED_ENVIRONMENT_SETTINGS: readonly string[]

/** What the API returns; a secret value is never returned. */
export interface EnvironmentSettingView {
  key: string; label: string; secret: boolean; required: boolean; generated: boolean
  set: boolean
  value: string | null            // plain value of a non-secret setting; always null for secrets
  source: 'user' | 'generated' | null
  updatedBy: string | null
  updatedAt: number | null
}
export interface EnvironmentSettingPatch { key: string; value: string | null }   // null deletes
/** Storage row; for secrets value is ciphertext 'v1:<iv>:<tag>:<data>' (base64). Never sent to clients. */
export interface StoredEnvironmentSetting {
  key: string; secret: boolean; value: string; source: 'user' | 'generated'; updatedBy: string; updatedAt: number
}

export interface ManagedStandPaths {
  root: string; app: string; config: string; logs: string; artifacts: string
  temporary: string; repository: string; manifest: string
  envFile: string                 // <config>/stand.env
  overrides: string               // <config>/overrides (VC_ENVIRONMENT_OVERRIDES of the stand)
}

export function parseCoreSelection(value: unknown): CoreSelection | null
  // undefined/null → null; otherwise exactly {version, commit}, x.y.z and 40 hex, else throws
export function parseEnvironmentSettingsPatch(value: unknown): EnvironmentSettingPatch[]
  // array of 1..50 items {key, value}; unique keys; key in ENVIRONMENT_SETTINGS (throws
  // 'Unknown environment setting: K' / 'Reserved environment setting: K'); value null or a
  // string of 1..4096 chars without ', CR, LF, NUL ('Invalid value for K');
  // VC_ADMIN_PASSWORD at least 12 chars
export function managedStandPaths(storageRoot: string, projectId: string, environmentId: string, platform: string): ManagedStandPaths
  // <storageRoot>/projects/<projectId>/environments/stands/<environmentId>/…; throws for
  // platform 'win32' ('Stands are not supported on Windows') and for environmentId 'production'
export function environmentComposeProject(projectId: string, environmentId: string): string
  // `sx-${environmentId}-${fnv1a32(projectId) as 8 lowercase hex}`; pure, no node:crypto
export function environmentDataVolume(composeProject: string): string   // `${composeProject}-server-data`
```

Каталог `ENVIRONMENT_SETTINGS` (ключи взяты из `docker-compose.yml`):

| Ключ | Секрет | Обязателен | Генерируется |
| --- | --- | --- | --- |
| `VC_ADMIN_PASSWORD` | да | да | нет |
| `VC_PG_PASSWORD`, `VC_INTERNAL_TOKEN`, `VC_MCP_SECRET`, `VC_LLM_RUNNER_TOKEN`, `VC_TTS_RUNNER_TOKEN`, `VC_STT_RUNNER_TOKEN`, `VC_BROWSER_RUNNER_TOKEN`, `VC_AUTOMATION_RUNNER_TOKEN` | да | нет | да |
| `VC_SMTP_URL`, `VC_GITHUB_TOKEN`, `VC_CLAUDE_UPSTREAM_API_KEY` | да | нет | нет |
| `VC_PUBLIC_URL`, `VC_MAIL_FROM`, `VC_BROWSER_HOST_ALIASES`, `VC_DELEGATED_CHAT_ENABLED`, `VC_CLAUDE_GATEWAY_BACKEND`, `VC_CLAUDE_UPSTREAM_URL`, `VC_CLAUDE_UPSTREAM_AUTH`, `VC_CLAUDE_MODEL_MAP` | нет | нет | нет |

`RESERVED_ENVIRONMENT_SETTINGS` и их значения в `stand.env`:

```
VC_ENVIRONMENT_ID=<environmentId>
COMPOSE_PROJECT_NAME=<composeProject>
COMPOSE_FILE=docker-compose.yml:deploy/compose.stand.yml
COMPOSE_PROFILES=postgres,kanban
COMPOSE_PARALLEL_LIMIT=1
COMPOSE_BAKE=false
VC_STAND_PORT=<port>
VC_DATA_VOLUME=<composeProject>-server-data
VC_PUBLIC_HOST=127.0.0.1                      # satisfies caddy's ${VC_PUBLIC_HOST:?}; caddy is off
VC_ENVIRONMENT_OVERRIDES=<root>/config/overrides
VC_DB_URL=postgres://voicechat:<VC_PG_PASSWORD>@postgres:5432/voicechat
VC_KANBAN_MODE=remote
VC_RELEASE_VERSION=<core.version>
VC_RELEASE_COMMIT=<core.commit[0:12]>
```

`VC_PUBLIC_URL` по умолчанию — `http://127.0.0.1:<port>`. Строки файла — `KEY='value'`, по одной,
ключи по алфавиту; одинарные кавычки отключают подстановку `$` в compose, поэтому `'`, CR, LF и
NUL в значениях запрещены.

Manifest стенда (`parseEnvironmentManifest`): `kind` дополняется значением `'stand'`, поле
`environmentId` обязательно для `stand` и запрещено для остальных видов, `taskId` для `stand`
запрещён. Запись: `{formatVersion: 1, projectId, kind: 'stand', environmentId, machineId,
storageId, createdAt: ISO(env.createdAt)}`.

Шифрование секретов (Kanban, не shared): AES-256-GCM, ключ — `VC_ENVIRONMENT_SECRET_KEY`
(64 hex), случайный IV 12 байт, AAD `environment-setting:<projectId>:<environmentId>:<key>`, формат
`v1:<iv>:<tag>:<data>` в base64. Неверный или отсутствующий ключ — `503 Environment secret storage
is not configured`. Генерация, расшифровка и запись файла не попадают ни в логи, ни в шаги
операций.

#### База — `apps/server/src/db/schema.ts` (Postgres — из той же схемы через `schemaPg.ts`), копия в Kanban

Новые столбцы входят в `CREATE TABLE` для чистых баз и добавляются в `migrate()` для существующих
тем же способом, что остальные столбцы (`PRAGMA table_info` + `ALTER TABLE … ADD COLUMN`;
на Postgres проверить тестом `database.pgBootstrap.test.ts`):

```sql
ALTER TABLE environments ADD COLUMN mode TEXT NOT NULL DEFAULT 'external';
ALTER TABLE environments ADD COLUMN storage_id TEXT;
ALTER TABLE environments ADD COLUMN state TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE environments ADD COLUMN compose_project TEXT;
ALTER TABLE environments ADD COLUMN port INTEGER;
ALTER TABLE environment_configurations ADD COLUMN core_json TEXT;
ALTER TABLE environment_operations ADD COLUMN kind TEXT NOT NULL DEFAULT 'apply';

CREATE UNIQUE INDEX IF NOT EXISTS idx_environment_compose_project
  ON environments(compose_project) WHERE compose_project IS NOT NULL;

CREATE TABLE IF NOT EXISTS environment_settings (
  project_id TEXT NOT NULL, environment_id TEXT NOT NULL, key TEXT NOT NULL,
  secret INTEGER NOT NULL DEFAULT 0, value TEXT NOT NULL, source TEXT NOT NULL,
  updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, environment_id, key),
  FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id) ON DELETE CASCADE
);

-- One active operation per environment now covers the new active statuses.
DROP INDEX IF EXISTS idx_environment_active_operation;          -- in migrate(), both engines
CREATE UNIQUE INDEX IF NOT EXISTS idx_environment_active_operation_v2
  ON environment_operations(project_id, environment_id)
  WHERE status IN ('pending', 'preparing', 'pulling', 'building', 'starting', 'switching', 'health_check', 'removing');
```

`apps/server/src/db/ownership.ts`: `environment_settings` принадлежит домену `environments`,
бюджет чужих чтений остаётся 0.

#### Репозиторий `db.environments` (Core и копия Kanban)

Методы этапа 1 сохраняются; `definition`/`configuration`/`operation` читают новые столбцы
(`core_json` → `core`, отсутствующий `kind` → `'apply'`). `upsertEnvironment` отказывает, если
окружение с этим id уже `managed` (`Managed environment cannot be changed`). Новое:

```ts
addConfiguration(userId, projectId, environmentId, modules, note, core?: CoreSelection | null): Promise<EnvironmentConfiguration>
  // core проверяется parseCoreSelection; по умолчанию null
createManagedEnvironment(userId, projectId, input: { id: string; name: string; machineId: string; storageId: string; checkoutPath: string; composeProject: string }): Promise<EnvironmentDefinition>
  // владелец; id ≠ 'production'; новая строка mode 'managed', state 'draft', port null;
  // существующий id: managed в state 'draft' | 'removed' — обновляет name/machine/storage/path/project и
  // ставит 'draft'; иначе 'Environment already exists'
setEnvironmentState(projectId, environmentId, patch: { state?: EnvironmentState; port?: number | null }): Promise<void>
  // внутренний порт исполнителя; обновляет updated_at
managedPorts(machineId: string): Promise<number[]>
  // внутренний: порты managed-окружений этой машины во всех проектах, state ≠ 'removed'
listSettings(userId, projectId, environmentId): Promise<StoredEnvironmentSetting[]>          // участник
saveSettings(userId, projectId, environmentId, entries: Array<{ key: string; secret: boolean; value: string | null; source: 'user' | 'generated' }>): Promise<void>
  // владелец; одна транзакция; value null удаляет строку; отказ при активной операции ('Environment is busy')
readSettings(projectId, environmentId): Promise<StoredEnvironmentSetting[]>                 // внутренний, для исполнителя
createOperation(userId, projectId, environmentId, configurationId, previousConfigurationId, kind: EnvironmentOperationKind = 'apply'): Promise<EnvironmentOperation>
updateOperation(...)   // принимает новые статусы; activeOperation использует ACTIVE_ENVIRONMENT_OPERATION_STATUSES
```

#### Файлы и машинные скрипты — Core

`deploy/compose.stand.yml` (оверлей стенда; требует всех зарезервированных ключей):

```yaml
services:
  voicechat:
    ports: !override
      - "127.0.0.1:${VC_STAND_PORT:?Stand port is required}:8787"
    volumes: !override
      - vc-data:/data            # no host deploy socket in a stand
  caddy:
    profiles: ["public"]         # public address of a stand is environments-v3
volumes:
  vc-data:
    name: ${VC_DATA_VOLUME:?Stand data volume is required}
```

`scripts/prod/compose_env.py` — разбор `.env` чекаута без побочных эффектов, общий для скриптов:

```
python3 scripts/prod/compose_env.py get <KEY> [--file .env]
  → stdout: значение (кавычки '…' и "…" сняты) или пустая строка, если ключа нет; exit 0
  exit 3 — файл есть, но строка не разбирается (KEY=value, # комментарии, пустые строки)
python3 scripts/prod/compose_env.py chain [--file .env]
  → stdout: действующая цепочка compose: $COMPOSE_FILE из окружения процесса, иначе COMPOSE_FILE
    из .env, иначе docker-compose.yml (и docker-compose.override.yml, если он есть); exit 0
```

`scripts/prod/environment-apply.sh` (исправление C04): базовая цепочка — `compose_env.py chain`,
каталог переключений — `$VC_ENVIRONMENT_OVERRIDES`, иначе `VC_ENVIRONMENT_OVERRIDES` из `.env`,
иначе `/etc/voicechat/environment-overrides`. Экспортируемая цепочка — базовая плюс `current.yml`
ровно один раз. CLI, stdout и коды выхода этапа 1 не меняются.

```
bash scripts/prod/environment-provision.sh --operation <id>
  Запускается в чекауте стенда (<root>/temporary/repository), .env — ссылка на ../../config/stand.env.
  1) config: проверяет .env (exit 10): все RESERVED_ENVIRONMENT_SETTINGS заданы; COMPOSE_FILE
     начинается с docker-compose.yml:deploy/compose.stand.yml; COMPOSE_PROFILES содержит postgres
     и kanban; VC_DATA_VOLUME = "$COMPOSE_PROJECT_NAME-server-data" и ≠ voicechat-server-data;
     VC_STAND_PORT в 1024..65535; VC_RELEASE_COMMIT — префикс HEAD; чекаут ≠ VC_REPO_DIR из
     /etc/voicechat/production.env (если файл читается). Цепочка = COMPOSE_FILE из .env +
     $VC_ENVIRONMENT_OVERRIDES/current.yml, если он есть. `docker compose config --format json`
     проходит, и build есть только у voicechat и automation-runner (exit 10).
  2) build: VC_APPLICATION_VERSION=$VC_RELEASE_VERSION, VC_APPLICATION_COMMIT=$(git rev-parse HEAD),
     VC_APPLICATION_API_VERSION / _DATA_VERSION из apps/server/release.json (как deploy.sh);
     `docker compose build voicechat`, затем `docker compose build automation-runner`
     последовательно (exit 25).
  3) pull: `docker pull` каждого образа сервисов без build, которого нет локально (exit 20).
  4) start: `docker compose up -d --no-build --pull never --remove-orphans` (exit 30).
  5) health: до VC_ENVIRONMENT_START_TIMEOUT (по умолчанию 300 с) ждёт
     `curl -fsS http://127.0.0.1:$VC_STAND_PORT/api/health` с ok=true и application.commit = HEAD
     и healthy у всех контейнеров с healthcheck; иначе печатает `docker compose ps -a` и
     `logs --tail 50 voicechat` строками лога и выходит с exit 30. Контейнеры не снимаются —
     стенд новый, откатывать некуда; повтор операции идемпотентен.
  stdout построчно: {"stage":"config|build|pull|start|health","status":"running|passed|failed","log":"…"}
  exit: 0 — стенд здоров; 2 — аргументы; 10 — конфигурация стенда; 20 — pull; 25 — build; 30 — start/health.
  Секретов не печатает (значения .env в лог не попадают).

bash scripts/prod/environment-remove.sh --operation <id> [--delete-data]
  Запускается в чекауте стенда; та же проверка .env, что у provision (exit 10).
  1) down: `docker compose down --remove-orphans` (с --delete-data — ещё `--volumes`) (exit 30);
  2) volumes (только --delete-data): `docker volume rm -f "$VC_DATA_VOLUME"` и тома проекта
     `docker volume ls -q --filter label=com.docker.compose.project=$COMPOSE_PROJECT_NAME` (exit 30).
  Файлы не удаляет — каталог стенда удаляет Kanban после сверки manifest.
  stdout: {"stage":"down|volumes","status":"running|passed|failed","log":"…"}; exit 0 / 2 / 10 / 30.
```

#### Проба готовности — Kanban (`apps/server/src/environments/readinessProbe.ts`)

Kanban хранит пробу строкой (Python 3.8+, только stdlib), пишет её `fsWrite` в
`<storageRoot>/.voicechat/environment-readiness-<uuid>.py`, запускает и удаляет:

```
python3 <probe> --storage-root <abs> --storage-id <id> --environment-root <abs>
  --manifest-json <json> --compose-project <name> --port-range 17800-17999
  --exclude-ports <csv> [--port <current>] --git-url <url>
  --min-free-bytes N --min-memory-bytes N --recommended-memory-bytes N --min-compose 2.24.0
→ stdout: {"checks":[{"id","status","message"}],"port":<int|null>}
  exit 0 — проверки выполнены (даже с failed); exit 2 — неверные аргументы.
```

| Проверка | Как | Итог |
| --- | --- | --- |
| `platform` | `platform.system()` | Linux/Darwin — passed, иначе failed |
| `architecture` | `platform.machine()` | x86_64/amd64 — passed, иначе warning (образы linux/amd64) |
| `policy` | в Kanban, не в пробе: `policyOf(agent)` | `allowWrite`, сеть разрешена, корень стенда внутри `allowedDirs` |
| `storage` | marker содержит storage id, временный файл создаётся и удаляется | failed иначе |
| `root` | корня нет, или `environment.json` равен `--manifest-json` | иначе failed «каталог занят» |
| `docker` | `docker info` за 20 с | нет / нет прав / демон не запущен — failed с разным текстом |
| `compose` | `docker compose version --short` ≥ минимума | failed иначе |
| `git`, `python` | `git --version`; версия интерпретатора ≥ 3.8 | failed иначе |
| `repository` | `GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code <url> HEAD` за 30 с | failed иначе |
| `disk` | свободно на storage root ≥ минимума | failed иначе |
| `memory` | `/proc/meminfo` или `sysctl -n hw.memsize` | < 4 ГиБ failed, < 8 ГиБ warning |
| `port` | `--port`, если свободен или занят этим же проектом compose; иначе первый свободный (bind на 127.0.0.1) из диапазона без исключённых | нет свободного — failed |
| `project` | `docker compose ls --all --format json` | проект с этим именем при занятом чужом корне — failed |

`--exclude-ports` — `managedPorts(machineId)` без порта самого окружения.

#### REST — Kanban (проксируется Core под `/api/projects`)

```
POST /api/projects/:id/environments  {id, name, mode: 'managed', machines: [agentId]}
     → 200 EnvironmentDefinition (state 'draft'); владелец; без mode — поведение этапа 1.
     Машина — машина проекта (getProjectMachine) с хранилищем; canWriteAgent; не win32.
     400 Invalid environment target | 400 Stands are not supported on Windows | 403 Machine access required
     409 Machine storage is not configured | 409 Environment already exists
POST /api/projects/:id/environments/:env/readiness                      → 200 MachineReadiness
     владелец; 400 Environment is not managed; 403 Machine access required; 409 Environment machine is offline
GET  /api/projects/:id/environments/:env/settings                       → 200 EnvironmentSettingView[] (весь каталог, участник)
POST /api/projects/:id/environments/:env/settings {settings: EnvironmentSettingPatch[]} → 200 EnvironmentSettingView[]
     владелец; 400 Unknown/Reserved environment setting: K | Invalid value for K;
     409 External environment settings are managed by the operator; 409 Environment is busy;
     503 Environment secret storage is not configured
POST /api/projects/:id/environments/:env/configurations {modules, note, core?}   → 200 EnvironmentConfiguration
     core проверяется по project_releases проекта: не удалён, status ready|released,
     branch release/<version>, commit_sha = commit; иначе 400 Core release is not available
GET  /api/projects/:id/environments/:env/diff?configurationId=…         → {observation, modules, core: CoreDiff | null}
POST /api/projects/:id/environments/:env/apply {configurationId}        → как в этапе 1, плюс
     409 Configuration changes Core, если core.action ≠ 'none'; 409 Environment is not ready
     для managed в state ≠ 'ready'
POST /api/projects/:id/environments/:env/provision {configurationId}    → 202 EnvironmentOperation (kind 'provision')
     владелец; managed в state draft|failed|removed|ready; 400 Environment is not managed;
     400 Configuration has no Core release; 400 Required environment settings are missing: K,…;
     403 Machine access required; 404 Configuration not found; 409 Environment is busy;
     409 Environment machine is offline; 503 Environment secret storage is not configured
POST /api/projects/:id/environments/:env/remove {deleteData: boolean, confirm: string} → 202 EnvironmentOperation (kind 'remove')
     владелец; confirm = id окружения (400 Confirmation does not match); managed в state ready|failed
     (409 Environment cannot be removed); 409 External environment cannot be removed; 409 Environment is busy
POST /api/projects/:id/environments/:env/rollback                       → как в этапе 1; только kind 'apply'
```

Операция `remove` ссылается на последнюю конфигурацию окружения (`configuration_id` не NULL).

#### Создание стенда: порядок этапов операции `provision`

| Этап (`step.service`) | Статус операции | Что делает Kanban |
| --- | --- | --- |
| `readiness` | `preparing` | проба; failed — стоп; первый `port` сохраняется `setEnvironmentState` |
| `directories` | `preparing` | `install -d -m 0700 config config/overrides`, остальные каталоги 0755; `environment.json` пишется или сверяется (расхождение — стоп) |
| `checkout` | `preparing` | `git clone` gitUrl проекта в `temporary/repository`, если его нет (тот же скрипт, что `ensureCheckout` у ReleaseManager); `git fetch origin release/<v>`; fetched SHA = `core.commit`; `git checkout -B release/<v> <commit>`; дерево чистое |
| `settings` | `preparing` | генерирует недостающие `generated`-секреты (сохраняет зашифрованными, source `generated`), пишет `config/stand.env` через временный файл и `mv`, `ln -sfn ../../config/stand.env .env` в чекауте |
| `modules` | `preparing` | вшитые модули конфигурации совпадают с закреплёнными в чекауте (`pinnedApplications`); иначе стоп «Configuration needs a Core release for embedded modules» |
| `config` … `health` | `preparing` → `building` → `pulling` → `starting` → `health_check` | `environment-provision.sh` построчно, таймаут 60 мин |
| `switch` + шаги сервисов | `switching`, `health_check` | `diff` по конфигурации; переключения — `environment-apply.sh` этапа 1 (`kind: 'service'`) |

Успех — операция `succeeded`, окружение `ready`, наблюдение сохраняется как обычно. Любая ошибка —
операция `failed` с текстом, окружение `failed`, контейнеры остаются для разбора. Операция
`remove`: `down`/`volumes` из скрипта; при `deleteData` — этап `cleanup` удаляет корень стенда
после сверки `environment.json` (как remove у feature-preview); окружение `removed`, `port` →
`null`, настройки сохраняются.

#### Интерфейс — core-ui, блок «Окружения»

- «Новое окружение» (владелец): id, название, машина из машин проекта с хранилищем `ready`;
  создаёт `managed` в `draft`. У окружения — бейдж состояния (`Черновик`, `Создаётся`, `Готово`,
  `Ошибка`, `Удаляется`, `Удалено`) и для `external` — пометка «ведёт оператор».
- «Проверить машину»: список проверок с `passed/warning/failed`, порт стенда.
- «Настройки и секреты»: таблица каталога; секрет показывается как «задан / не задан /
  сгенерируется», значение секрета не отображается и не подставляется в поле; сохранение —
  только изменённые ключи; подсказка «применится при следующем создании стенда». Для
  `external` раздел скрыт.
- Конфигурация получает строку «Core»: выбор из релизов проекта `ready`/`released`
  (`releases:list`), в таблице модулей — строка Core с действием `CoreDiff`.
- «Создать стенд» / «Пересоздать стенд» (владелец, managed): выбранная конфигурация с Core,
  ход операции по этапам (`kind: 'stage'`) и по сервисам; «Удалить стенд» — подтверждение
  вводом id и флаг «Удалить данные (база и файлы)».
- «Открыть в Web Reader» для `managed` в `ready`: как `FeaturePreviewSection.openInWebReader` —
  Reader-чат с `http://<agentId>.machine.internal:<port>/`.
- Новые каналы мостика (`environmentsBridge.ts`): `environments:create`, `environments:readiness`,
  `environments:settings`, `environments:saveSettings`, `environments:provision`,
  `environments:remove`; при их отсутствии у хоста блок работает как в этапе 1.

### Задачи этапа 2

Таблица задач рана `environments-v2` лежит в [environments-v2.md](environments-v2.md): координатор
разбирает задачи из всего файла плана, поэтому задачи этапа 2 вынесены отдельно от уже сделанных
задач этапа 1. Описания задач ссылаются на разделы этого документа.

Задачи интегратора (Claude, вне манифеста):

- **U02: сквозная проверка и выкат этапа**: мерж B02→B03→C04→C05 (Core), C12→C06→C07→C08→C09
  (Kanban), C10→C11 (core-ui); выпуск образа Kanban и core-ui, закрепление в Core, релиз и выкат
  прода с `VC_ENVIRONMENT_SECRET_KEY`; проверка: на проде окружение `production` по-прежнему
  `external` и работает как в этапе 1, «Применить» её ревизии 1 отвечает «уже применено», а
  переключение Kanban на проде на другой выпуск и обратно доводит операцию до конца через рестарт (C12); на второй машине проекта (Linux x86_64) создаётся
  окружение `stage2-check`, готовность без `failed`, задан пароль администратора, «Создать
  стенд» с конфигурацией (Core — текущий релиз прода, модули — как на проде) доводит его до
  `ready`; стенд открывается в Web Reader и принимает вход; его база — свой контейнер Postgres
  и свой том; «Применить» другой версии Kanban переключает Kanban только на стенде; «Удалить
  стенд» с удалением данных убирает контейнеры, тома и каталог; затем раздел «Этап 3» этого
  документа после ответов владельца на вопросы ниже.

### Готово, когда

- на машине, где прод не запущен, владелец проекта создаёт стенд с нуля из интерфейса: проверка
  готовности, настройки и секреты, «Создать стенд» — без ssh и ручных команд, кроме входа CLI
  раннеров;
- стенд — отдельный проект compose со своей базой Postgres, своим томом данных и портом на
  `127.0.0.1`; ни создание, ни удаление стенда не меняет контейнеры, тома и файлы прода
  (`docker compose ps` прода, его `/api/health` и `voicechat-server-data` до и после совпадают);
- значения секретов не возвращаются ни одним маршрутом и не встречаются в логах операций, а
  `stand.env` на машине имеет права 0600;
- «Применить» и «Откатить» этапа 1 работают на стенде так же, как на проде;
- «Удалить стенд» с удалением данных оставляет машину без контейнеров, томов и каталога стенда.

### Риски и открытые вопросы этапа 2

- Агент обрывает команду по таймауту (`docs/kb/deploy.md`, «Почему нельзя звать `docker compose
  up -d --build` напрямую»). Сборка Core идёт отдельным этапом и может быть убита без вреда, но
  обрыв посреди `up -d` оставит контейнер в `Created`; у стенда нет сторожа прода. Лечение —
  повторное «Пересоздать стенд». Операция, оборванная рестартом Kanban, остаётся активной, как в
  этапе 1 (снимает оператор).
- Образы владельцев публикуются под linux/amd64; на Apple Silicon стенд пойдёт только через
  эмуляцию Docker Desktop, проба показывает `warning`.
- Сборка Core на машине стенда требует памяти и места (8 ГиБ прода не хватало для параллельных
  сборок); поэтому сборки последовательные и пороги пробы. Опубликованный образ Core в GHCR
  убрал бы сборку — отдельное решение, в этапе 2 его нет.
- Web Reader открывает стенд через HTTP-мост агента (5 МиБ, 10 с на запрос); WebSocket стенда
  через мост не проходит, полноценная работа — через companion-туннель или публичный адрес
  (вопрос 3, этап 3).
- Стенд не воспроизводит управляемую установку компонентов прода (Identity, Billing, Analytics
  отдельными сервисами, гранты `components:init`). Если стенд должен проверять именно её —
  нужен отдельный этап с секретами каталога компонентов и их ротацией.
- Бэкап базы стенда и ротация `VC_ENVIRONMENT_SECRET_KEY` не входят в этап.

## Этап 3 — модули окружения на разных машинах, снимок прода, план на доске

Ран `environments-v3`. Владелец проекта размещает модули одного управляемого окружения на
нескольких машинах проекта (Core и Postgres — на основной, например Make или Playwright Reader —
на другой), может создать стенд со снимком базы прода вместо пустой базы, а задачи прогонов
Delivery Control видны карточками на доске Kanban проекта.

### Ответы владельца (2026-10-03)

1. **Связь между машинами** — через API Sislexa и уже установленный на машинах агент: туннели
   агент ↔ сервер ↔ агент. Без VPN и без новых сетевых каналов.
2. **Данные окружения** — одна база Postgres окружения на основной машине, как общая база Core и
   Kanban на проде. Модули на других машинах ходят к ней через туннель. Каждый стенд по-прежнему
   изолирован от прода и других стендов.
3. **Публичный адрес** — в этом этапе нет; стенд открывается через мост машины в Web Reader.
4. **Снимок прода** — стенд можно создать с базой из снимка прода; секреты, сессии, токены машин
   и почта в снимок не попадают или затираются. По умолчанию база пустая.
5. **План на доске** — задачи прогонов Delivery Control публикуются карточками на доску проекта,
   статус и ссылки обновляются автоматически.

Границы этапа:

- только `managed`-окружения; `production` и `external` остаются на одной машине, как в этапах 1–2;
- один экземпляр модуля на окружение (несколько машин на модуль и балансировщик — этап 4);
- модуль переносится целиком, со всеми сервисами своего выпуска; Core, `postgres`,
  `automation-runner` и раннеры CLI всегда на основной машине (`machines[0]`);
- снимок — только база Postgres прода; том данных `voicechat-server-data` (файлы, вложения) в
  снимок не входит;
- карточки плана — только чтение на доске: статус ведёт Delivery Control.

### Что уже есть в коде (на что опирается этап)

- **Туннель TCP агент ↔ сервер ↔ агент** (протокол агента 0.10.0): `tunnel.listen`/`connect`/
  `data`/`end`/`close` (`sislex/agent` `apps/agent/src/connection.ts`), ретрансляция в Core
  `registry.createTunnel(id, sourceAgentId, targetAgentId, targetPort, authorize, onClose)`
  (`apps/server/src/agents/registry.ts`), RPC `machines.createTunnel` для Kanban
  (`KanbanMachines.createTunnel`). Сейчас им пользуются feature-preview и Storybook: туннель
  принадлежит пользователю, живёт в памяти, закрывается по простою 30 мин и при переподключении
  агента. Слушатель — `127.0.0.1` со случайным портом, контейнеры на bridge-сети Linux его не
  видят. Управления потоком (pause/resume) нет, данные — base64 в управляющем WebSocket.
- **HTTP-мост** (`http.request`, 5 МиБ, 10 с, без WebSocket) годится только для превью.
- **Адреса сервисов** в `docker-compose.yml` в основном записаны литералами
  (`VC_KANBAN_URL: http://kanban:8789`, `VC_CORE_URL: http://voicechat:8787`, …), общие секреты —
  `VC_INTERNAL_TOKEN`, `VC_MCP_SECRET`. Долгие связи (события machines, `exec-stream` и
  `/events` Kanban) требуют TCP, HTTP-моста мало.
- **Модель окружения**: `EnvironmentDefinition.machines: string[]`, но Kanban требует ровно одну
  машину и везде берёт `machines[0]`; у `ModuleSelection` нет машины.
- **Доска**: `POST /api/projects/:id/tasks` (с `Idempotency-Key`), `PATCH`, `move` в
  `sislexa-kanban` `routes/projects.ts`; перемещение в `development`/`preparation` запускает CI и
  подготовку Kanban; у задачи нет внешнего идентификатора. Вход в `/api/*` Kanban — только сессия
  пользователя через `/internal/whoami` Core; служебного входа для внешнего сервиса нет.
- **Delivery Control**: журнал событий `control_events` пишется в той же транзакции, что и
  состояние (`src/store.ts`), читается `GET /v1/events?after=&wait=` (long-poll, доступен токену
  оператора). У прогона нет `projectId` проекта Sislexa; таблица владельцев задач
  (`src/plan.ts`) не знает репозиторий агента.

### Предусловия (до старта рана)

- U02 закрыт: стенд `stage2-check` на MakBook M1 16 создан, проверен и удалён (Kanban 0.1.4).
- Интегратор добавляет владельца `Agent: 'agent'` в таблицу `src/plan.ts` Delivery Control и
  подготовку репозитория `sislex/agent` у воркеров — иначе задача C13 не разбирается.
- B04 и C13 берутся сразу; остальные — от свежего `main` после мержа зависимостей из таблицы.

### Предусловия (оператор, до выката этапа)

- Агент ≥ 0.21.0 (C13) на всех машинах, которые получат модули стенда, и на машине прода
  (снимок).
- Для синхронизации доски: токен интеграции проекта (B05) с правом `tasks:external` лежит у
  Delivery Control в приватном файле (`DELIVERY_BOARD_TOKEN_FILE`), прогоны размечены проектом.

### Решения этапа

1. **Размещение.** `ModuleSelection` получает необязательный `machineId` (машина из
   `environment.machines`); без него модуль на основной машине. Конфигурация с размещением
   допустима только для `managed`. Смена машины модуля — это пересоздание стенда, а не
   «Применить» (апплай этапа 1 по-прежнему меняет только образы на месте).
2. **Связи — служебные туннели.** Новая сущность «связь окружения»
   (`environment_links`: окружение, машина-клиент, машина-сервер, порт сервиса, порт слушателя).
   Связи принадлежат окружению, а не пользователю: Core хранит их в базе, держит без таймаута
   простоя, поднимает заново после переподключения агента и рестарта сервера, авторизует по
   существованию связи и состоянию окружения (`provisioning`/`ready`). Для каждого сервиса,
   который вызывают с другой машины, — одна связь; Postgres тоже идёт связью.
3. **Слушатель для контейнеров.** Агент 0.21.0 принимает в `tunnel.listen` адрес и порт:
   `host: 'docker-host'` слушает на адресе шлюза bridge-сети Docker (Linux `docker0`, Docker
   Desktop — `127.0.0.1`, контейнеры видят его как `host.docker.internal` через
   `extra_hosts: host-gateway`). Порт выбирает Kanban из диапазона 17000–17799 (проверка
   свободного порта пробой) и сохраняет в связи, чтобы адрес сервиса не менялся. Добавляется
   управление потоком (`tunnel.pause`/`tunnel.resume`, высокая отметка 4 МиБ на соединение).
4. **Адреса — из размещения.** Литералы адресов сервисов в `docker-compose.yml` становятся
   `${VAR:-<литерал>}` (поведение прода не меняется). Kanban вычисляет адреса для каждой машины
   (сервис на той же машине — имя compose, на другой — `http://host.docker.internal:<порт связи>`)
   и пишет их в `stand.env` машины как зарезервированные ключи. На машине модуля поднимается
   отдельный проект compose того же имени только с сервисами модуля (`COMPOSE_PROFILES` модуля,
   оверлей `deploy/compose.stand-module.yml`), на основной машине эти сервисы выключены.
5. **Одна база окружения** — Postgres основной машины; модули на других машинах получают
   `VC_DB_URL` через связь `postgres:5432`.
6. **Снимок прода.** Операция `provision` принимает `data: 'empty' | 'production-snapshot'`.
   Снимок снимает `scripts/prod/environment-snapshot.sh` на машине прода:
   `pg_dump -Fc` контейнера `postgres` с `--exclude-table-data` для таблиц из
   `scripts/prod/snapshot-exclude.txt` (сессии, токены агентов и машин, секреты VPN, секреты
   окружений, токены интеграций, коды почты, очереди писем — список генерируется из
   классификации `ownership.ts` и проверяется тестом). Файл (0600, каталог `artifacts` прода)
   передаётся на машину стенда разовой связью и удаляется на проде после передачи. На стенде этап
   `restore` (до `start`) восстанавливает его в пустую Postgres стенда, затем
   `scripts/prod/environment-sanitize.sql`: почты пользователей → `user-<id>@stand.invalid`,
   хэши паролей сброшены, первый администратор — из `VC_ADMIN_PASSWORD` стенда, настройки SMTP
   и внешние интеграции выключены. Снимок может запросить только владелец проекта; операция
   аудируется. Пересоздание стенда с данными снимок не повторяет без явного выбора.
7. **Задачи плана на доске.**
   - Kanban: внешняя ссылка задачи (`external_source`, `external_id`, `external_url`,
     уникально в проекте) и маршрут
     `PUT /api/projects/:id/external-tasks/:source/:externalId` (upsert заголовка, описания,
     состояния, ссылок, меток). Состояние переводится в колонку по `semantic_type` без побочных
     эффектов (не запускает CI, подготовку и уборку копий). Такие карточки помечены
     `externallyManaged`: пользователь не может их перемещать, только открыть ссылку.
   - Core: токены интеграции проекта (создаёт и отзывает владелец проекта; в базе только хэш;
     `whoami` отдаёт принципала `{kind: 'integration', projectId, scopes}`). Kanban пускает его
     только на маршрут внешних задач своего проекта.
   - Delivery Control: прогон получает `projectId` (поле плана/импорта), фоновый
     `board-sync` читает `/v1/events` с сохранённым курсором и делает upsert карточки
     `dc:<runId>:<taskId>` на каждое изменение задачи; состояние → колонка: `blocked`/`ready` →
     `backlog`, `running` → `development`, `submitted` → `manual_qa`, `done` → `done`,
     `failed` → `decision_required`; ссылка — ветка или коммит мержа в GitHub.

### Контракты

Общие типы (`packages/shared/src/environment.ts`, `@voicechat/shared` 0.1.16):

```ts
export interface ModuleSelection { repository: string; version: string; commit: string; machineId?: string }
export type EnvironmentData = 'empty' | 'production-snapshot'
export interface EnvironmentLink {
  id: string; environmentId: string; service: string
  clientMachineId: string; serverMachineId: string
  servicePort: number; listenPort: number
  state: 'pending' | 'open' | 'down'
}
export type EnvironmentStage = /* этап 2 */ | 'links' | 'snapshot' | 'restore'
export const ENVIRONMENT_LINK_PORT_RANGE = { min: 17000, max: 17799 } as const
export function parseModulePlacement(config: EnvironmentConfiguration, env: EnvironmentDefinition): string | null // текст ошибки или null
```

- `parseModulePlacement`: машина из `env.machines`; `external` с размещением — ошибка
  `Placement requires a managed environment`; у Core-модулей (вшитых в сборку) `machineId`
  запрещён — `Embedded modules run with Core`.
- `ProvisionInput` получает `data?: EnvironmentData` (по умолчанию `'empty'`).
- Внешние задачи (`packages/shared/src/projects.ts`):

```ts
export type ExternalTaskState = 'blocked' | 'ready' | 'running' | 'submitted' | 'done' | 'failed'
export interface ExternalTaskUpsert {
  title: string; description?: string; state: ExternalTaskState
  url?: string; labels?: string[]
}
export interface TaskExternalRef { source: string; externalId: string; url: string | null; managed: true }
// Task.external?: TaskExternalRef
export const EXTERNAL_TASK_COLUMN: Record<ExternalTaskState, ColumnSemanticType>
```

- Токены интеграции (`packages/shared/src/integrationTokens.ts`): `IntegrationTokenScope =
  'tasks:external'`, `IntegrationTokenView {id, projectId, name, scopes, createdAt, lastUsedAt}`;
  значение токена отдаётся один раз при создании.
- Протокол агента 0.21.0: `tunnel.listen {tunnelId, host?: 'loopback' | 'docker-host',
  port?: number}`, `tunnel.pause`/`tunnel.resume {tunnelId, connectionId}` в обе стороны;
  агент < 0.21.0 для связи окружения отклоняется с `Agent 0.21.0 or newer is required`.

Маршруты (Kanban, через прокси Core):

| Маршрут | Кто | Ответы |
| --- | --- | --- |
| `GET /api/projects/:id/environments/:env/links` | участник проекта | `EnvironmentLink[]` |
| `POST …/environments/:env/provision {configurationId, data?}` | владелец | этап 2 + `403 Production snapshot requires the project owner`, `409 Production environment is not available for snapshots` |
| `PUT /api/projects/:id/external-tasks/:source/:externalId` | токен интеграции `tasks:external` этого проекта | `200`/`201` `Task`; `403` для пользователя и чужого проекта; `400` по полям |
| `GET/POST/DELETE /api/projects/:id/integration-tokens` (Core) | владелец | `IntegrationTokenView[]`, при создании `{token}` один раз |

### Задачи этапа 3

Таблица задач рана `environments-v3` — в [environments-v3.md](environments-v3.md).

Задачи интегратора (Claude, вне манифеста):

- **U03: сквозная проверка и выкат этапа**: мерж B04→B05→C14→C15→C16 (Core), C13 (агент,
  выпуск 0.21.0 и обновление агентов на машинах), C17→C18→C19 (Kanban), C20 (core-ui), C21
  (Delivery Control); выпуски, закрепление в Core, релиз и выкат прода. Проверка: окружение
  `stage3-check` на двух машинах проекта (Core и Postgres — на MakBook M1 16, Make — на этом
  Mac) создаётся из снимка прода; в базе стенда нет сессий, токенов и настоящих почт; Make на
  второй машине отвечает Core, связь переживает переподключение агента и рестарт Core;
  «Применить» другой версии Make переключает её на второй машине; удаление стенда с данными
  убирает проекты compose, тома, каталоги и связи на обеих машинах; задачи прогона
  `environments-v3` видны на доске проекта и меняют колонки вслед за Delivery Control.

### Готово, когда

- модуль управляемого окружения работает на другой машине проекта, а Core и база — на основной,
  без ssh и ручных команд;
- связи между машинами идут только через агенты и сервер Sislexa, восстанавливаются сами после
  обрыва и закрываются при удалении стенда;
- стенд из снимка прода поднимается на данных прода, без секретов, сессий и настоящих почт, и
  ничего не отправляет наружу;
- прод не меняется ни созданием, ни удалением стенда (кроме временного файла снимка);
- задачи прогонов Delivery Control видны на доске и не двигаются руками.

### Риски и открытые вопросы этапа 3

- Весь трафик между машинами идёт через один WebSocket агента и сервер прода: пропускная
  способность и задержка ограничены, большие выгрузки модулей замедлят остальное. VPN — при
  росте трафика (этап 4).
- Связь агента с сервером прода сейчас по `http://` без TLS: снимок и трафик модулей идут
  открытым текстом. До выката U03 сервер для агентов должен быть доступен по `https://` или
  через существующий VPN машины; иначе снимок отключён настройкой.
- Рестарт Core рвёт все связи окружения до их восстановления (секунды); модули должны
  переживать временную недоступность Core и базы.
- Снимок большой базы передаётся долго; размер ограничен свободным местом прода и стенда
  (проба готовности проверяет оба).
- Карточки плана живут, пока жив проект; удаление прогона в Delivery Control карточки не
  удаляет (переводит в архив отдельной задачей при необходимости).

## Вопросы к владельцу на этапы 3–4

Ответы на вопросы 1–3 для этапа 3 — в разделе «Этап 3 → Ответы владельца»; для этапа 4 вопросы
остаются открытыми.

1. Связь сервисов между машинами: туннели агента Sislexa (есть, без внешних зависимостей) или
   VPN (WireGuard между машинами окружения). Рекомендация — туннели агента в этапе 3, VPN — при
   росте трафика.
2. Данные окружения с несколькими машинами: одна общая база Postgres окружения (проще, задержки
   между регионами) или база на регион с репликацией (сложнее). Рекомендация — общая база
   окружения в этапе 3, регионы с репликацией — отдельным планом.
3. Публичный адрес окружения: поддомен на окружение через Caddy на машине окружения или общий
   вход с маршрутизацией. Рекомендация — поддомен на окружение.
