---
title: sisl-808-storage-idempotency-gaps
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# sisl-808-storage-idempotency-gaps

## Что сделано

Закрыты поисковые пробелы по `createSpace` и разделу File Storage: уточнены
координаторная граница, конкурентное создание, SQL-конфликт и совместимость с
legacy-дублями. Обязательные темы deploy, CI runner и testing operations сверены
с merge SHA и отмечены свежими.

## Что выяснили (факты, которых не было в KB)

`createSpace` для `chat` и `make-project` проходит через метод транзакции
метаданных. Memory-store выбирает каноническое пространство в сериализованной
транзакции; SQLite/Postgres используют уникальную `storage_space_refs` и после
конфликта читают победителя. `listSpaces` не скрывает старые дубли, а chat upload
использует тот же публичный вызов координатора.

## Куда занесено

- `docs/kb/architecture.md` — раздел `File storage service`.
- `docs/kb/data-auth.md` — раздел `Idempotent chat and Make spaces (SISL-808)`.
- `docs/kb/deploy.md`, `docs/kb/features/ci-runner.md`, `docs/kb/testing-operations.md` — обязательная сверка свежести.

## Открытые вопросы / что осталось

Автоматического объединения существующих дублей нет; ручная безопасная очистка
описана в `docs/kb/data-auth.md`.
