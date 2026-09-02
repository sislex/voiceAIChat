---
title: image-studio
date: 2026-09-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# image-studio

## Что сделано

- Студия картинок: сплит «чат + галерея» по образцу Make (`#/images`), kind/scope
  `images`, REST `/api/image-studio/*`, хранилище `ImageStudioStore`
  (data/image-studio/<convId>), генерация и правка через codex, автозахват
  картинок из ходов ассистента в галерею.
- Миграция CHECK по `conversations.scope`: пересборка таблицы, если DDL из
  sqlite_master содержит старый список без `images`.

## Что выяснили (факты, которых не было в KB)

- CLI-модель не может отдать PNG без права исполнения: генератору нужен
  `permissionMode: 'acceptEdits'` + `cwd=profileHome` + `IMAGE_HINT` в промпте;
  с `executionDisabled` codex отвечает текстом (это же означает, что ретушь
  `imageRetouchGenerator` с executionDisabled, вероятно, не работает живьём —
  не проверяли, чтобы не жечь лишние раны).
- CHECK по scope есть только в свежих БД (из schema.ts); в мигрированных ALTER
  добавлял колонку без CHECK — поэтому баг «CHECK constraint failed» виден
  только на новых инсталляциях.
- В dom-тестах jsdom нет `URL.createObjectURL`: миниатюрам нужен постоянный
  `aria-label`, а не имя из alt загрузившейся картинки.

## Куда занесено

- docs/kb/ui.md — раздел «Студия картинок»
- docs/kb/protocol.md — «Студия картинок (2026-09-03)»
- docs/kb/llm.md — «Генерация картинок для студии (2026-09-03)»
- docs/kb/data-auth.md — «CHECK по scope разговоров и его расширение»

## Открытые вопросы / что осталось

- Ретушь (`imageRetouchGenerator`) осталась на `executionDisabled` — проверить
  живьём и, если не работает, перевести на тот же режим, что студию.
