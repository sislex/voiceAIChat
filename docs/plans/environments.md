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
| 3 | `environments-v3` | Модули одного окружения на разных машинах: адреса сервисов из размещения, защищённая связь между машинами. |
| 4 | `environments-v4` | Несколько машин на модуль: балансировщик, поочерёдное применение, регионы. |

Порядок работы: задачи этапа с контрактами пишутся до старта его рана; после окончания этапа
интеграция сводит всё в рабочую версию, собирает релиз, выкатывает, проверяет на проде и только
потом пишет задачи и контракты следующего этапа (этот документ дополняется разделом этапа).
Задачи `B` — контракты, `C` — параллельная реализация, `U` — сквозная проверка. Задачи с
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

### Готово, когда

- на проде во вкладке «Приложения» есть окружение `production` с модулями и действиями;
- сохранение конфигурации с другой версией Kanban и «Применить» переключают только Kanban, без
  сборки, с проверкой здоровья; «Откатить» возвращает прежний образ;
- выкат релиза Core после этого не откатывает переключённый Kanban.

## Вопросы к владельцу на этапы 3–4

1. Связь сервисов между машинами: туннели агента Sislexa (есть, без внешних зависимостей) или
   VPN (WireGuard между машинами окружения). Рекомендация — туннели агента в этапе 3, VPN — при
   росте трафика.
2. Данные окружения с несколькими машинами: одна общая база Postgres окружения (проще, задержки
   между регионами) или база на регион с репликацией (сложнее). Рекомендация — общая база
   окружения в этапе 3, регионы с репликацией — отдельным планом.
3. Публичный адрес окружения: поддомен на окружение через Caddy на машине окружения или общий
   вход с маршрутизацией. Рекомендация — поддомен на окружение.
