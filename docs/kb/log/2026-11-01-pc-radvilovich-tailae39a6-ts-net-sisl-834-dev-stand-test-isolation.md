---
title: sisl-834-dev-stand-test-isolation
date: 2026-11-01
machine: pc-radvilovich-tailae39a6-ts-net
author: unknown
---

# sisl-834-dev-stand-test-isolation

## Что сделано

- Fixture `scripts/dev-stand-local.test.mjs` теперь явно очищает унаследованный
  `PORT`, прежде чем запускать stand с Core UI на `VC_WEB_PORT`.

## Что выяснили (факты, которых не было в KB)

- Fake-сервис выбирает `process.env.PORT || process.env.VC_WEB_PORT`. Core UI не
  задаёт `PORT`, поэтому значение из окружения gate worker заставляло его
  слушать чужой порт; stand проверял назначенный UI port и истекал по readiness.
- Проблема воспроизводится изолированно при ambient `PORT`; увеличивать таймаут
  или ослаблять assertions не требуется.

## Куда занесено

- `docs/kb/testing-operations.md`, раздел `Dev stand focused checks (C02)`.

## Открытые вопросы / что осталось

- Нет.
