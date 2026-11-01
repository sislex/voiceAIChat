---
title: Группы и архив бесед
updated: 2026-11-02
checked: 79d261e89
areas:
  - packages/shared/src/types.ts
  - packages/shared/src/protocol.ts
  - packages/shared/src/chatContract.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/db/schemaPg.ts
  - apps/server/src/db/database.ts
  - apps/server/src/db/repos/chat.ts
  - apps/server/src/routes/rest.ts
---

# Группы и архив бесед

## Модель и владение

Core хранит персональные группы в пределах пары tenant/user и публикует их контракт для клиентов. Системные выборки `all` и `archive` — стабильные идентификаторы фильтра, а не строки таблицы, поэтому их нельзя переименовать или удалить. Публичные модели и поля разговора находятся в `packages/shared/src/types.ts`; канонические REST-пути объявлены в `packages/shared/src/protocol.ts` и consumer artifact `packages/shared/src/chatContract.ts`.

User groups have persistent ordering and a conversation count. The catalog returns `{ groups }` containing only stored user groups, ordered by position and id. Its count is the number of memberships, without the scope, project, task-state or pagination filters of the conversation list; it can therefore differ from the visible list length. Разговор может одновременно состоять в нескольких пользовательских группах, но только пока он не архивирован. React-колонка групп, её store, адаптивная раскладка, доступные подписи и DOM/Component QA принадлежат отдельному репозиторию `sislex/sislexa-core-ui`; этот Core предоставляет контракт, transport и persistence.

## Хранение и инварианты

SQLite-схема в `apps/server/src/db/schema.ts` хранит группы отдельно от many-to-many membership и добавляет `conversations.archived_at`. Внешние ключи удаляют связи при удалении группы или разговора, не удаляя сам разговор при удалении группы. Уникальная позиция действует внутри tenant/user. `apps/server/src/db/schemaPg.ts` derives PostgreSQL DDL from the SQLite schema through `@sislexa/identity/storage-sql/schema` and adds the owner/archive index in `PG_EXTRA_SQL`. The SQLite upgrade in `apps/server/src/db/database.ts` adds the archive column when absent and creates that index.

Операции реализованы в `apps/server/src/db/repos/chat.ts`. Создание добавляет группу в конец. Перестановка принимает неотрицательную позицию, ограничивает её концом списка и в одной транзакции нормализует позиции всех групп владельца. Замена состава группы и замена membership разговора проверяют принадлежность всех сущностей текущим tenant/user и устраняют дубликаты.

Архивирование и очистка всех membership выполняются одной транзакцией с блокировкой строки разговора. Архивную беседу нельзя добавить в группу. Unarchiving sets `archivedAt` to null and installs exactly the submitted `groupIds` in the same transaction; it does not restore previous memberships. Thus `{ archived: false, groupIds: [] }` restores an ungrouped conversation, while a nonempty valid list restores it into those groups. `{ archived: true, groupIds: [...] }` is rejected before any mutation. Membership updates also refresh the conversation's `updatedAt`.

## REST и выборки

Маршруты в `apps/server/src/routes/rest.ts` предоставляют `GET/POST /api/conversation-groups`, `PATCH/DELETE /api/conversation-groups/:id` и `PUT /api/conversations/:id/membership`. PATCH меняет имя, позицию и при передаче `conversationIds` полностью заменяет состав группы. PUT всегда принимает полный `groupIds` и boolean `archived`. Пустые имена и неверные формы дают 400, конфликт архивного членства — 409, отсутствующая или чужая сущность — 404.

`GET /api/conversations` и поиск принимают `groupId`. Значение `all` возвращает только активные беседы, `archive` — только архивные, пользовательский id — только активные беседы этой группы. Неизвестный или чужой id группы даёт 404. The filter defaults to `all` when omitted and applies to both `/api/conversations` and `/api/conversations/search` (title/message-text search), not `/api/messages/search`. Both routes default to scope `chat`; `kanban` requires `projectId`, and project filtering in these repository queries applies only to that scope. Tenant and user restrictions remain in force. Task chats in `done` columns are hidden unless `includeCompleted` is enabled; chats in `cancelled` columns stay hidden even then, including in `archive`. Only the list route accepts `since`, the paired `beforeAt`/`beforeId` cursor, and `limit`; conversation search has no pagination parameters.

## Проверки

Контрактные, REST и persistence-регрессии находятся рядом с реализацией: `packages/shared/src/chatContract.test.ts`, `apps/server/src/routes/rest.conversations.test.ts`, `apps/server/src/db/database.test.ts` и `apps/server/src/db/schemaPg.test.ts`. The contract tests assert the published group paths and artifact digest. REST tests cover CRUD/order, duplicate membership ids, `all`/`archive` and custom-group lists, group-filtered conversation search, archive/unarchive results, foreign-owner rejection and reserved-id PATCH rejection. The file-backed restart test in `database.test.ts` is SQLite-only (`skipIf(ON_POSTGRES)`). `schemaPg.test.ts` checks generated tables, columns and indexes, not live PostgreSQL archive transactions. The archive lifecycle REST test checks sequential results; transaction boundaries and conversation row locking are verified in `ChatRepo`, rather than by a concurrent race test. UI-разметка и responsive-проверки остаются ответственностью UI-owner.
