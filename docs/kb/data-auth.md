---
title: Данные и доступ: SQLite, пользователи, роли
updated: 2026-07-26
checked: 829f43e
areas:
  - apps/server/src/db
  - apps/server/src/users
  - apps/server/src/uploads.ts
  - apps/server/src/routes/admin.ts
  - packages/shared/src/types.ts
  - packages/shared/src/admin.ts
---

# Данные и доступ: SQLite, пользователи, роли

## Схема

`apps/server/src/db/schema.ts` — единая строка DDL, идемпотентная (`IF NOT EXISTS`),
выполняется при каждом старте; отдельного механизма миграций нет. `PRAGMA
journal_mode = WAL`, `foreign_keys = ON`.

| Таблица | Смысл |
|---|---|
| `conversations` | разговор: `title`, таймстемпы, `claude_session_id` (для `--resume`), `user_id`, `exec_target` (изменяемая цель новых ходов чата) |
| `messages` | `role` (`u<N>` для говорящих, `ai`), `text`, `engine`, `meta` (JSON `TurnMeta`), `exec_target` (неизменяемый снимок цели выполнения), каскад по разговору |
| `speakers` | метки говорящих внутри разговора |
| `settings` | key-value, значения — JSON-строки |
| `agents` | машины: `token_hash`, `last_seen`, `policy` (JSON), `user_id` |
| `users` | `name` (PK и он же id владельца), `password_hash`, `role`, `blocked` |

Файл БД — `<dataDir>/voicechat.db` (в Docker `/data`). Тесты работают на
`:memory:` через `BuildOptions.db`. Вложения — `apps/server/src/uploads.ts`
(`POST /api/uploads` → id, путь резолвится в промпт для модели).

**У desktop своя копия схемы** (`apps/desktop/src/main/db/schema.ts`) — меняя одну,
проверь вторую (см. `architecture.md`, раздел про осознанную дубликацию).

## Пользователи и роли

`UserRole = 'admin' | 'user'` (`packages/shared/src/types.ts`). Роль ограничивает
доступные модели: `isModelAllowed` / `modelsForRole` / `clampModelForRole` —
зажим применяется на сервере в `turns.ts`, а не только в UI.

Первый запуск на пустой БД создаёт `admin`; пароль берётся из
`VC_ADMIN_PASSWORD` (пусто — без пароля). Если БД уже существует, переменная
ничего не меняет — пароль правится в UI (Настройки → Пользователи). Хеширование —
`apps/server/src/users/passwords.ts`.

## Сессии и авторизация запросов

`POST /api/session/login` → подписанный токен (секрет — `<dataDir>` файл, либо
эфемерный; в тестах инъектируется `sessionSecret`). Клиент шлёт
`Authorization: Bearer …` во все `/api/*` и передаёт токен в WS. Глобальный
`preHandler` (`users/auth.ts`) наполняет `req.user`, проверяет блокировку; список
публичных путей — функция `isPublic` там же. Админские роуты — `requireAdmin`
(403 для не-админа).

**Изоляция данных — по логину**: `uid(req)` возвращает `req.user.name`, и разговоры,
машины и ходы фильтруются по нему. Добавляя роут, работающий с данными
пользователя, обязательно фильтруй по `uid(req)` — забытый фильтр открывает чужие
разговоры. В desktop мостa сессии нет → `authRequired = false` и экран логина не
показывается.

## Админка

`/api/admin/users*` (`routes/admin.ts`, типы в `packages/shared/src/admin.ts`):
список, создание/удаление, блокировка, отчёт по использованию
(`UsageReport`/`UsageUnit`), просмотр чужих разговоров и сообщений. UI —
`packages/ui/src/components/UsersAdmin.tsx`.

## Чтение файлов с диска сервера (`/api/files/read`)

Нужно для картинок, которые создаёт сам CLI. Роут отдаёт файл **только** если его
реальный путь лежит внутри «своей» области пользователя: профиль CLI
(`<dataDir>/cli-users/<base64url(логин)>`), каталог загрузок и заданный им
`settings.workdir`. Проверка — `apps/server/src/serverFiles.ts`, и делается она
**после `realpathSync`**: иначе симлинк внутри профиля превращается в чтение любого
файла контейнера. Чужой путь, системный файл и несуществующий дают одинаковый 404 —
по ответу не должно быть видно, что где лежит. Лимит `SERVER_FILE_MAX_BYTES` 32 МБ
(больше → 413). Расширяешь список корней — помни, что это единственная граница.
