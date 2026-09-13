---
title: chat-457-shell-kb
date: 2026-09-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# chat-457-shell-kb

## Что сделано

Проверены и зафиксированы изменения оболочки CHAT-457: пользовательские предпочтения сайдбара и история команд, а также уточнённый контракт Development Brief. Обновлена свежесть тем и перегенерирован индекс БЗ.

## Что выяснили (факты, которых не было в KB)

Реестр команд реализован в `packages/ui-foundation/src/lib/commands.ts` и экспортируется для хоста и загружаемых приложений через `@voicechat/ui-foundation/runtime`. Development Brief принимает ровно один JSON-объект `schemaVersion=2`; строковая ссылка решения сохраняется, `null` удаляется как отсутствие ссылки, несовместимые типы отклоняются строгой проверкой.

## Куда занесено

- `docs/kb/ui.md`
- `docs/kb/features/task-preparation.md`

## Открытые вопросы / что осталось

Нет.
