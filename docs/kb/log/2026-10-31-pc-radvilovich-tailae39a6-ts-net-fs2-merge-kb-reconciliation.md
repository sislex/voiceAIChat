---
title: fs2-merge-kb-reconciliation
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# fs2-merge-kb-reconciliation

## Что сделано

- Сверены с merge SHA все 13 обязательных тем и обновлена их отметка `checked`.
- Подтверждены и сохранены сведения FS-2 о SQL-метаданных, Core REST/runtime, чат-вложениях и развёртывании.
- Перегенерирован индекс файловой базы знаний.

## Что выяснили (факты, которых не было в KB)

- Архитектурная граница проходит между независимым `packages/file-storage` и host-интеграцией в `apps/server/src/fileStorage/`.
- SQL-транзакции метаданных сериализуются через `storage_lock`; один контракт проверяет memory- и SQL-реализации.
- Чатовый backend выбирается настройкой `chatFilesBackend`; storage-ссылки переживают перезапуск в JSON истории сообщений.
- Core опрашивает узлы при старте и каждые 15 секунд, исключая узел из пула после двух последовательных ошибок.

## Куда занесено

- docs/kb/architecture.md
- docs/kb/data-auth.md
- docs/kb/deploy.md
- docs/kb/server-internals.md
- обязательные смежные темы из отчёта `kb:check --strict` сверены с их tracked areas.

## Открытые вопросы / что осталось

- PostgreSQL-контракт выполняется только при заданном `VC_TEST_DB_URL`; развёртывание узлов остаётся операторской задачей.
