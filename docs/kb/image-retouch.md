---
title: Локальная AI-ретушь изображений
updated: 2026-10-07
areas:
  - packages/shared/src/imageRetouch.ts
  - packages/shared/src/types.ts
  - packages/shared/src/ipc.ts
  - packages/shared/src/protocol.ts
  - apps/server/src/server.ts
---

# Локальная AI-ретушь изображений

Module details: `image-studio:README.md`

## Доверенная граница и обработка

`POST /api/images/retouch` принимает только источник и референсы, уже
принадлежащие текущему разговору либо зарегистрированные в `UploadStore`.
Редактор загружает новые референсы через `uploads:add` с `conversationId`: если
явный `agentId` не передан, сервер разрешает машину разговора и сохраняет файл в
её `.voicechat_uploads`, поэтому оригинал и все референсы читаются с корректной
машины-источника. Вложения без `agentId` читаются из runner/server storage с
ограниченными корнями, а удалённые — через файловый API указанной доступной машины.

`apps/server/src/imageRetouch.ts` декодирует оригинал через Sharp, валидирует
геометрию и извлекает минимальный bounding crop. Генератор получает только этот
crop, локальную чёрно-белую маску, промпт и референсы; весь исходный кадр модели
не передаётся. Адаптер `llm/imageRetouchGenerator.ts` запускает Codex без
исполнения команд и принимает первый штатный image-блок результата.
