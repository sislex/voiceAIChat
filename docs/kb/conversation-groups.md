---
title: Группы и архив бесед
updated: 2026-09-29
checked: 4242196b
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

Пользовательские группы имеют сохраняемый порядок и счётчик бесед. Разговор может одновременно состоять в нескольких пользовательских группах, но только пока он не архивирован. React-колонка групп, её store, адаптивная раскладка, доступные подписи и DOM/Component QA принадлежат отдельному репозиторию `sislex/sislexa-core-ui`; этот Core предоставляет контракт, transport и persistence.

## Хранение и инварианты

SQLite-схема в `apps/server/src/db/schema.ts` хранит группы отдельно от many-to-many membership и добавляет `conversations.archived_at`. Внешние ключи удаляют связи при удалении группы или разговора, не удаляя сам разговор при удалении группы. Уникальная позиция действует внутри tenant/user. PostgreSQL получает эквивалентную схему через `apps/server/src/db/schemaPg.ts`; upgrade старой SQLite-базы добавляет архивную колонку и индекс в `apps/server/src/db/database.ts`.

Операции реализованы в `apps/server/src/db/repos/chat.ts`. Создание добавляет группу в конец. Перестановка принимает неотрицательную позицию, ограничивает её концом списка и в одной транзакции нормализует позиции всех групп владельца. Замена состава группы и замена membership разговора проверяют принадлежность всех сущностей текущим tenant/user и устраняют дубликаты.

Архивирование и очистка всех membership выполняются одной транзакцией с блокировкой строки разговора. Архивную беседу нельзя добавить в группу. Разархивирование устанавливает `archivedAt` в null, но прежние связи не восстанавливает: клиент при необходимости назначает группы заново.

## REST и выборки

Маршруты в `apps/server/src/routes/rest.ts` предоставляют `GET/POST /api/conversation-groups`, `PATCH/DELETE /api/conversation-groups/:id` и `PUT /api/conversations/:id/membership`. PATCH меняет имя, позицию и при передаче `conversationIds` полностью заменяет состав группы. PUT всегда принимает полный `groupIds` и boolean `archived`. Пустые имена и неверные формы дают 400, конфликт архивного членства — 409, отсутствующая или чужая сущность — 404.

`GET /api/conversations` и поиск принимают `groupId`. Значение `all` возвращает только активные беседы, `archive` — только архивные, пользовательский id — только активные беседы этой группы. Неизвестный или чужой id группы даёт 404. Фильтр сочетается с существующими scope/project, tenant, completed-task, search и pagination условиями.

## Проверки

Контрактные, REST и persistence-регрессии находятся рядом с реализацией: `packages/shared/src/chatContract.test.ts`, `apps/server/src/routes/rest.conversations.test.ts`, `apps/server/src/db/database.test.ts` и `apps/server/src/db/schemaPg.test.ts`. Они фиксируют CRUD и порядок, множественное членство, системные выборки, поиск, изоляцию владельцев, атомарный архивный цикл и сохранность после рестарта. UI-разметка и responsive-проверки остаются ответственностью UI-owner.
