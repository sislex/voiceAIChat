---
title: machines-roadmap-7
date: 2026-08-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# machines-roadmap-7 — каталог результатов чата

## Что сделано

- Заведён `docs/plans/machines-roadmap.md` (18 пунктов, порядок A→D, процедура проверки на стенде с реальным агентом).
- П.7: `ChatStorageView`/`chatStorageDirectories` в shared, `GET /api/conversations/:id/storage` отдаёт абсолютные каталоги и статус, `ChatStorageCard` (чип в шапке + карточка в настройках).

## Что выяснили

- Стенд: сервер и агент оба — `tsx src/index.ts`; `restart-stand.sh` теперь перезапускает оба и чистит lock агента.

## Куда занесено

- docs/kb/machines.md — «Каталог ChatAI по умолчанию» (абзац про ChatStorageCard).
