---
title: machines-roadmap-9
date: 2026-08-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# machines-roadmap-9 — Monaco в проводнике, diff, корзина

## Что сделано

- `fs.trash` в контракте агента, `fileOps.ts:fsTrash`, `registry.fsTrash` (гейт `fs-trash` 0.15.0), `POST /api/agents/:id/fs/trash`, мост `trash`, `AGENT_VERSION` → 0.15.0.
- Проводник: `CodeEditor` вместо textarea, «Показать изменения» (`CodeDiff`), «В корзину» + полоса «Вернуть».
- Починен fs-мост: заголовки через `sessionHeaders()` (раньше 403 csrf на любую мутацию при cookie-сессии).
- `MonacoCodeEditor`: ведущие слэши абсолютного пути срезаются перед `file:///`.

## Что выяснили

- Проверка на стенде поймала два бага, которых не видели unit-тесты: CSRF в fs-мосте и падение Monaco на абсолютном пути.

## Куда занесено

- docs/kb/machines.md — «Просмотр и правка файлов», «Версии и гейтинг возможностей».
