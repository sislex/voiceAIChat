---
title: app-shell-chat-271
date: 2026-08-18
machine: mac
author: alexeyrozhnov
---

# app-shell-chat-271

## Что сделано

- Зафиксировано фактическое состояние нового `@voicechat/app-shell`, composition API host и его проверок.

## Что выяснили (факты, которых не было в KB)

- Runtime разделяет lazy load, создание store и bootstrap, а cleanup выполняет независимо через `Promise.allSettled`.
- Новый registry подключён как публичный API `@voicechat/ui`, но legacy `App.tsx` и продуктовые реализации остаются живым host path.

## Куда занесено

- `docs/kb/ui.md`
- `docs/kb/architecture.md`
- `docs/kb/testing-operations.md`
- `docs/kb/operations-app.md`

## Открытые вопросы / что осталось

- Полное переключение web/desktop на `createApplication` и удаление legacy host в этом срезе не выполнены.
