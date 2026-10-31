---
title: Локальная AI-ретушь изображений
updated: 2026-11-01
checked: a1a8f8a6
areas:
  - packages/shared/src/types.ts
  - packages/shared/src/ipc.ts
  - packages/shared/src/protocol.ts
  - apps/server/src/server.ts
  - apps/server/src/db/repos/chat.ts
---

# Локальная AI-ретушь изображений

## Core admission

`server.ts` rejects retouch with HTTP 503 `auxiliary_model_disabled` when
`chatTextOnly` is enabled. Otherwise it checks conversation ownership and obtains
attachment history through `db.chat.historyFiles`, before accepting the source
and references. Upload admission has a process-wide 300 requests/minute budget
and a 20 requests/minute per-user budget; rejection returns 429
`upload_rate_limit` with `retry-after`.

Module details: `image-studio:README.md`

## Доверенная граница и обработка

`POST /api/images/retouch` принимает только источник и референсы, уже
принадлежащие текущему разговору либо зарегистрированные в `UploadStore`
для того же пользователя и разговора. Проверка сравнивает `path`, `agentId`
и оба поля storage-ссылки: `spaceId` и `path`.
Редактор загружает новые референсы через `uploads:add` с `conversationId`.
При включённом сервисе и `chatFilesBackend=storage` сервер сохраняет файл в
`chat`-пространстве разговора; ретушь читает `file.storage` через
`fileStorage.readFile(userId, spaceId, path)` с проверкой доступа.
В режиме `machine` без явного `agentId` сервер разрешает машину разговора и
сохраняет файл в её `.voicechat_uploads`. Вложения без storage-ссылки и `agentId`
читаются из runner/server storage с ограниченными корнями, а удалённые — через
файловый API указанной доступной машины.

Image processing and the LLM retouch generator are public exports of the
Image Studio owner package; the former Core implementation files are removed.
Core calls `processImageRetouch` and `llmRetouchGenerator`, supplies authorized
attachment reads and saves the returned PNG through `saveRetouchedImage`.
Managed conversations write into their generated directory under a file lease;
the resulting attachment and image block are persisted as an AI chat message.
